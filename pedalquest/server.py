"""FastAPI + WebSocket 서버."""
import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .achievements import ACHIEVEMENTS
from .game import STAGES
from .util import get_lan_ip, log_task_error

ROOT = Path(__file__).resolve().parent.parent
SEND_TIMEOUT = 0.5


def create_app(config, game, sensor, records, mock: bool = False) -> FastAPI:
    clients: set[WebSocket] = set()

    async def send(ws: WebSocket, text: str) -> bool:
        try:
            await asyncio.wait_for(ws.send_text(text), SEND_TIMEOUT)
            return True
        except Exception:
            return False

    async def broadcast_loop():
        interval = 1.0 / config.game.tick_rate
        loop = asyncio.get_running_loop()
        next_at = loop.time()
        while True:
            next_at = max(next_at + interval, loop.time() - interval)
            await asyncio.sleep(max(0.0, next_at - loop.time()))
            if not clients:
                game.pop_events()  # 보는 사람 없으면 이벤트 버림
                continue
            messages = [json.dumps(e, ensure_ascii=False) for e in game.pop_events()]
            messages.append(json.dumps(game.get_state(), ensure_ascii=False))
            targets = list(clients)
            results = await asyncio.gather(*(send_all(ws, messages) for ws in targets))
            for ws, ok in zip(targets, results):
                if not ok:
                    clients.discard(ws)

    async def send_all(ws, messages) -> bool:
        for m in messages:
            if not await send(ws, m):
                return False
        return True

    @asynccontextmanager
    async def lifespan(app):
        task = asyncio.create_task(broadcast_loop())
        task.add_done_callback(log_task_error)
        yield
        task.cancel()

    app = FastAPI(lifespan=lifespan)

    class RevalidatingStatic(StaticFiles):
        """브라우저가 예전 파일을 계속 쓰지 않게 매번 서버에 확인시킨다.

        game.html은 render3d.js를 동적 import로 불러오는데, 크롬이 이 모듈을 강하게
        캐시해서 코드를 고쳐도 태블릿에는 예전 버전이 그대로 뜬다 ("고쳤는데 안 바뀌네").
        no-cache는 다운로드를 막는 게 아니라 "바뀌었는지 물어보고 안 바뀌었으면 304"라서
        같은 와이파이에서는 비용이 사실상 없다.
        """

        async def get_response(self, path, scope):
            resp = await super().get_response(path, scope)
            resp.headers["Cache-Control"] = "no-cache"
            return resp

    app.mount("/static", RevalidatingStatic(directory=ROOT / "static"), name="static")
    templates = Jinja2Templates(directory=ROOT / "templates")

    def handle_command(msg: dict):
        cmd = msg.get("command")
        if cmd == "start_free":
            game.start_free()
        elif cmd == "start_stage":
            try:
                game.start_stage(int(msg.get("stage_id")), bool(msg.get("ghost")))
            except (TypeError, ValueError):
                pass
        elif cmd == "start_arcade":
            try:
                game.start_arcade(int(msg.get("stage_id")))
            except (TypeError, ValueError):
                pass
        elif cmd == "use_item":
            game.use_item()
        elif cmd == "pause":
            game.pause()
        elif cmd == "resume":
            game.resume()
        elif cmd == "stop":
            game.stop()
        elif cmd == "menu":
            game.to_menu()
        elif cmd == "mock_rpm" and mock:
            try:
                sensor.set_rpm(float(msg.get("rpm", 0)))
            except (TypeError, ValueError):
                pass

    @app.get("/")
    async def index(request: Request):
        return templates.TemplateResponse(request, "game.html", {"mock": mock})

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        clients.add(ws)
        try:
            while True:
                text = await ws.receive_text()
                try:
                    msg = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if isinstance(msg, dict):
                    handle_command(msg)
        except WebSocketDisconnect:
            pass
        finally:
            clients.discard(ws)

    @app.get("/api/health")
    async def health():
        return {"ok": True, "mock": mock, "sensor": sensor.get_status(), "clients": len(clients)}

    @app.get("/api/records")
    async def list_records(limit: int = 50):
        return records.list_records(limit)

    @app.get("/api/stages")
    async def stages():
        bests = records.stage_bests()
        return [
            {"id": sid, **s, "best_sec": bests.get(sid, {}).get("best_sec"),
             "best_stars": bests.get(sid, {}).get("best_stars")}
            for sid, s in STAGES.items()
        ]

    @app.get("/api/achievements")
    async def list_achievements():
        unlocked = records.unlocked()
        return [{"id": aid, **a, "unlocked_at": unlocked.get(aid)} for aid, a in ACHIEVEMENTS.items()]

    @app.get("/api/videos")
    async def list_videos():
        """영상 라이딩 코스 목록. static/video/courses.json + 실제로 있는 파일만."""
        return video_courses()

    @app.get("/api/stats")
    async def stats():
        return records.stats()

    @app.post("/api/sensor/scan")
    async def sensor_scan():
        await sensor.rescan()
        return {"ok": True}

    @app.get("/api/connection-info")
    async def connection_info():
        return {"url": f"http://{get_lan_ip()}:{config.web_port}"}

    return app


VIDEO_DIR = ROOT / "static" / "video"
DEFAULT_FILMED_KMH = 20.0


def video_courses() -> list[dict]:
    """촬영 영상 목록. 파일이 있는 것만 돌려준다 (courses.json이 낡아도 깨지지 않게).

    filmed_kmh = 촬영할 때의 평균 속도. 재생 속도를 여기에 맞춰 조절한다.
    """
    if not VIDEO_DIR.exists():
        return []
    meta = {}
    cfg = VIDEO_DIR / "courses.json"
    if cfg.exists():
        try:
            for row in json.loads(cfg.read_text(encoding="utf-8")):
                meta[row["file"]] = row
        except (ValueError, KeyError) as e:
            print(f"⚠ courses.json을 읽지 못했습니다: {e}")
    out = []
    for f in sorted(VIDEO_DIR.glob("*.mp4")):
        m = meta.get(f.name, {})
        out.append({
            "file": f.name,
            "url": f"/static/video/{f.name}",
            "name": m.get("name") or f.stem,
            "filmed_kmh": float(m.get("filmed_kmh") or DEFAULT_FILMED_KMH),
            "note": m.get("note", ""),
            "size_mb": round(f.stat().st_size / 1e6, 1),
        })
    return out
