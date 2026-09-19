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
    app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
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
