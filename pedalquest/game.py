"""게임 엔진: 모드, 관성 물리, 스테이지, 고스트."""
import asyncio
import time

from . import achievements
from .arcade import ArcadeRace, advance
from .physics import calc_calories, step_speed
from .records import should_save

STAGES = {
    1: {
        "name": "🌆 도시 평지", "distance_m": 3000, "theme": "city",
        "terrain": [{"end_km": 3.0, "factor": 1.0}],
        "stars": {"3": 420, "2": 510, "1": 630},
    },
    2: {
        "name": "🌄 언덕길", "distance_m": 3000, "theme": "suburb",
        "terrain": [
            {"end_km": 1.0, "factor": 1.0},
            {"end_km": 2.0, "factor": 0.6},
            {"end_km": 3.0, "factor": 1.3},
        ],
        "stars": {"3": 480, "2": 570, "1": 720},
    },
    3: {
        "name": "⛰ 산악 코스", "distance_m": 5000, "theme": "mountain",
        "terrain": [
            {"end_km": 1.0, "factor": 1.0},
            {"end_km": 2.5, "factor": 0.6},
            {"end_km": 3.5, "factor": 1.4},
            {"end_km": 4.5, "factor": 0.7},
            {"end_km": 5.0, "factor": 1.2},
        ],
        "stars": {"3": 840, "2": 990, "1": 1260},
    },
    4: {
        "name": "⚡ 스프린트", "distance_m": 2000, "theme": "city",
        "terrain": [{"end_km": 2.0, "factor": 1.0}],
        "stars": {"3": 250, "2": 280, "1": 330},
    },
    5: {
        "name": "🏆 그란폰도", "distance_m": 7000, "theme": "beach",
        "terrain": [
            {"end_km": 1.5, "factor": 1.0},
            {"end_km": 3.0, "factor": 0.8},
            {"end_km": 4.0, "factor": 1.3},
            {"end_km": 5.5, "factor": 0.85},
            {"end_km": 6.5, "factor": 1.0},
            {"end_km": 7.0, "factor": 0.6},
        ],
        "stars": {"3": 1080, "2": 1260, "1": 1590},
    },
}

BLEND_M = 50            # 지형 경계 앞뒤 보간 구간
AUTO_PAUSE_SEC = 5.0    # 프리 모드: 정지 상태가 이만큼 지속되면 자동 일시정지
OVERTAKE_HYSTERESIS_M = 2.0
FREE_THEMES = [(2, "city"), (5, "suburb"), (8, "mountain"), (10, "beach")]


def free_theme(distance_m: float) -> str:
    km = (distance_m / 1000) % 10
    for end, theme in FREE_THEMES:
        if km < end:
            return theme
    return "city"


def free_segments(distance_m: float) -> list[tuple[float, float]]:
    """프리 모드 지형: 현재 주기(10km)의 (end_m, factor) 목록. 산길은 1km마다 오르막/내리막 교대."""
    base = int(distance_m // 10000) * 10000
    segs = [(base + 5000, 1.0)]
    for i in range(3):
        segs.append((base + 6000 + i * 1000, 0.85 if i % 2 == 0 else 1.15))
    segs.append((base + 10000, 1.0))
    return segs


def blended_factor(segments: list[tuple[float, float]], d: float, prev_factor: float = 1.0) -> float:
    """구간 경계 앞뒤 BLEND_M에서 선형 보간."""
    prev_end, prev_f = None, prev_factor
    for end, f in segments:
        if d < end:
            if prev_end is not None and d < prev_end + BLEND_M:
                t = (d - (prev_end - BLEND_M)) / (2 * BLEND_M)
                return prev_f + (f - prev_f) * t
            if d > end - BLEND_M:
                nxt = next((nf for ne, nf in segments if ne > end), None)
                if nxt is not None:
                    t = (d - (end - BLEND_M)) / (2 * BLEND_M)
                    return f + (nxt - f) * t
            return f
        prev_end, prev_f = end, f
    return segments[-1][1] if segments else 1.0


def stage_segments(stage: dict) -> list[tuple[float, float]]:
    return [(t["end_km"] * 1000, t["factor"]) for t in stage["terrain"]]


def stars_for(stage: dict, elapsed_sec: float) -> int:
    for n in (3, 2, 1):
        if elapsed_sec <= stage["stars"][str(n)]:
            return n
    return 0


class GameEngine:
    def __init__(self, config, sensor, records):
        self.config = config
        self.sensor = sensor
        self.records = records
        self.events: list[dict] = []
        self.mode: str | None = None
        self.state = "waiting"
        self.result: dict | None = None
        self._reset_session()

    # --- 세션 ---
    def _reset_session(self):
        self.cadence_rpm = 0.0
        self.speed_kmh = 0.0
        self.distance_m = 0.0
        self.elapsed_sec = 0.0
        self.calories = 0.0
        self.max_speed = 0.0
        self.rpm_time_sum = 0.0     # ∫rpm dt (페달링 중)
        self.pedal_time = 0.0
        self.session_log: list[float] = []
        self.stage_id: int | None = None
        self.auto_paused = False
        self.idle_time = 0.0
        self.theme = "city"
        self.ghost: dict | None = None  # {"log": [...], "elapsed_sec": float, "ahead": bool|None}
        self.race: ArcadeRace | None = None
        self.live_unlocked: set[str] = set()

    def emit(self, event: dict):
        self.events.append({"type": "event", **event} if "type" not in event else event)

    def pop_events(self) -> list[dict]:
        ev, self.events = self.events, []
        return ev

    def start_free(self):
        self._reset_session()
        self.mode, self.state, self.result = "free", "playing", None
        self.theme = free_theme(0)

    def start_stage(self, stage_id: int, ghost: bool = False):
        if stage_id not in STAGES:
            return
        self._reset_session()
        self.mode, self.state, self.result = "stage", "playing", None
        self.stage_id = stage_id
        self.theme = STAGES[stage_id]["theme"]
        if ghost:
            best = self.records.best_stage_record(stage_id)
            if best and best["session_log"]:
                self.ghost = {"log": best["session_log"], "elapsed_sec": best["elapsed_sec"], "ahead": None}

    def start_arcade(self, stage_id: int, seed=None):
        if stage_id not in STAGES:
            return
        self._reset_session()
        self.mode, self.state, self.result = "arcade", "countdown", None
        self.stage_id = stage_id
        stage = STAGES[stage_id]
        self.theme = stage["theme"]
        segs = stage_segments(stage)
        self.race = ArcadeRace(stage, self.records.recent_avg_rpm(), lambda d: blended_factor(segs, d), seed)

    def use_item(self):
        if self.race and self.state == "playing":
            self.race.use_item()

    def pause(self):
        if self.state == "playing":
            self.state = "paused"
            self.auto_paused = False

    def resume(self):
        if self.state == "paused":
            self.state = "playing"
            self.auto_paused = False
            self.idle_time = 0.0

    def stop(self):
        if self.state in ("playing", "paused", "countdown"):
            self._finish(finished=False)

    def to_menu(self):
        if self.state in ("finished", "waiting"):
            self._reset_session()
            self.mode, self.state, self.result = None, "waiting", None

    # --- 루프 ---
    async def run_loop(self):
        interval = 1.0 / self.config.game.tick_rate
        last = next_at = time.monotonic()
        while True:
            # Windows 타이머는 sleep을 길게 잡으므로 목표 시각 기준으로 잰다
            next_at = max(next_at + interval, time.monotonic() - interval)
            await asyncio.sleep(max(0.0, next_at - time.monotonic()))
            now = time.monotonic()
            dt = min(now - last, 0.1)
            last = now
            self.tick(dt)

    def terrain_factor(self) -> float:
        if self.mode in ("stage", "arcade") and self.stage_id:
            return blended_factor(stage_segments(STAGES[self.stage_id]), self.distance_m)
        if self.mode == "free":
            return blended_factor(free_segments(self.distance_m), self.distance_m)
        return 1.0

    def tick(self, dt: float):
        self.cadence_rpm = self.sensor.get_rpm()
        if self.state == "paused":
            if self.auto_paused and self.cadence_rpm > 0:
                self.resume()
            else:
                return
        if self.state == "countdown":
            self.race.countdown -= dt
            if self.race.countdown <= 0:
                self.race.countdown = 0.0
                self.state = "playing"
                self.emit({"kind": "race_go"})
            return
        if self.state != "playing":
            return

        rpm = self.cadence_rpm
        factor = self.terrain_factor()
        if self.race:
            boost, eff_factor = self.race.player_boost(factor)
            self.speed_kmh = advance(self.speed_kmh, rpm, eff_factor, boost, "slip" in self.race.effects, dt)
        else:
            self.speed_kmh = step_speed(self.speed_kmh, rpm, factor, dt)
        prev_distance = self.distance_m
        self.distance_m += self.speed_kmh / 3.6 * dt * self.config.game.speed_multiplier
        self.elapsed_sec += dt
        self.calories += calc_calories(rpm, dt, self.config.user_weight_kg)
        self.max_speed = max(self.max_speed, self.speed_kmh)
        if rpm > 0:
            self.rpm_time_sum += rpm * dt
            self.pedal_time += dt
        while len(self.session_log) < int(self.elapsed_sec):
            self.session_log.append(round(self.distance_m, 1))

        # 아케이드는 아이템으로 속도가 부풀려지므로 속도 업적 제외
        live_speed = 0.0 if self.race else self.max_speed
        for aid in achievements.check_live(self.distance_m, live_speed, self.calories):
            if aid not in self.live_unlocked:
                self.live_unlocked.add(aid)
                for ev in achievements.unlock_new(self.records, [aid]):
                    self.emit(ev)

        if self.mode == "free":
            theme = free_theme(self.distance_m)
            if theme != self.theme:
                self.theme = theme
                self.emit({"kind": "theme_change", "theme": theme})
            if self.speed_kmh < 0.1 and rpm <= 0:
                self.idle_time += dt
                if self.idle_time >= AUTO_PAUSE_SEC:
                    self.state = "paused"
                    self.auto_paused = True
            else:
                self.idle_time = 0.0

        if self.race:
            self.race.after_player_move(prev_distance, self.distance_m, self.speed_kmh, rpm, dt)
            self.race.update_rivals(dt, self.elapsed_sec)
            for ev in self.race.pop_events():
                self.emit(ev)
                if ev["kind"] == "dog_escape":
                    for a in achievements.unlock_new(self.records, ["dog_escape"]):
                        self.emit(a)

        if self.mode in ("stage", "arcade"):
            if self.mode == "stage":
                self._update_ghost()
            if self.distance_m >= STAGES[self.stage_id]["distance_m"]:
                self.distance_m = STAGES[self.stage_id]["distance_m"]
                if self.race:
                    self.race.finish_player(self.elapsed_sec)
                self._finish(finished=True)

    # --- 고스트 ---
    def ghost_distance(self) -> float | None:
        if not self.ghost:
            return None
        log = self.ghost["log"]
        total = STAGES[self.stage_id]["distance_m"]
        if self.elapsed_sec >= self.ghost["elapsed_sec"]:
            return float(total)
        # log[i] = (i+1)초 시점 거리
        t = self.elapsed_sec
        i = int(t)
        prev = log[i - 1] if 0 < i <= len(log) else 0.0
        nxt = log[i] if i < len(log) else float(total)
        return min(float(total), prev + (nxt - prev) * (t - i))

    def _update_ghost(self):
        gd = self.ghost_distance()
        if gd is None:
            return
        diff = self.distance_m - gd
        ahead = self.ghost["ahead"]
        if diff > OVERTAKE_HYSTERESIS_M and ahead is not True:
            if ahead is False:
                self.emit({"kind": "overtake", "rider": "ghost"})
            self.ghost["ahead"] = True
        elif diff < -OVERTAKE_HYSTERESIS_M and ahead is not False:
            if ahead is True:
                self.emit({"kind": "overtaken", "rider": "ghost"})
            self.ghost["ahead"] = False

    # --- 종료 ---
    def _calc_avg_rpm(self) -> float:
        return self.rpm_time_sum / self.pedal_time if self.pedal_time > 0 else 0.0

    def _finish(self, finished: bool):
        stage = STAGES.get(self.stage_id) if self.mode == "stage" else None
        race = self.race
        stars = stars_for(stage, self.elapsed_sec) if (stage and finished) else None
        prev_best = self.records.stage_bests().get(self.stage_id) if stage else None
        ghost_won = bool(finished and self.ghost and self.elapsed_sec < self.ghost["elapsed_sec"])
        summary = {
            "mode": self.mode,
            "stage_id": self.stage_id,
            "distance_m": round(self.distance_m, 1),
            "elapsed_sec": round(self.elapsed_sec, 1),
            "avg_speed": round(self.distance_m / 1000 / (self.elapsed_sec / 3600), 1) if self.elapsed_sec > 0 else 0,
            "max_speed": round(self.max_speed, 1),
            "avg_rpm": round(self._calc_avg_rpm(), 1),
            "calories": round(self.calories, 1),
            "stars": stars,
            "finished": finished if (stage or self.race) else False,
            "coins": self.race.coins if self.race else None,
            "rank": self.race.rank() if (self.race and finished) else None,
            "session_log": self.session_log if self.mode != "arcade" else [],
        }
        saved = should_save(self.distance_m, self.elapsed_sec)
        new_achievements = []
        if saved:
            self.records.save_record(summary)
            ids = achievements.check_session_end({**summary, "ghost_won": ghost_won}, self.records)
            new_achievements = achievements.unlock_new(self.records, ids)

        result = {k: v for k, v in summary.items() if k != "session_log"}
        result.update({
            "saved": saved,
            "ghost_won": ghost_won if self.ghost else None,
            "new_best": bool(stage and finished and (not prev_best or self.elapsed_sec < prev_best["best_sec"])),
            "new_achievements": [a["id"] for a in new_achievements],
        })
        if race:
            result.update({
                "riders_total": len(race.rivals) + 1, "items_used": race.items_used,
                "dogs_escaped": race.dogs_escaped, "dogs_caught": race.dogs_caught,
                "leaderboard": race.leaderboard() if finished else None,
            })
        self.result = result
        self.state = "finished"
        self.speed_kmh = 0.0
        if stage and finished:
            self.emit({"kind": "stage_finish", **result})
        if race and finished:
            self.emit({"kind": "race_finish", "rank": result["rank"]})
        for ev in new_achievements:
            self.emit(ev)

    # --- 상태 ---
    def get_state(self) -> dict:
        stage = None
        if self.stage_id:
            s = STAGES[self.stage_id]  # 스테이지·아케이드 공통 코스 정보
            stage = {"id": self.stage_id, "name": s["name"], "distance_m": s["distance_m"],
                     "stars": s["stars"], "terrain": s["terrain"]}
        riders = []
        gd = self.ghost_distance()
        if gd is not None:
            riders.append({"id": "ghost", "name": "내 최고기록", "kind": "ghost", "distance_m": round(gd, 1)})
        if self.race:
            riders += self.race.riders()
        return {
            "type": "state",
            "mode": self.mode,
            "state": self.state,
            "auto_paused": self.auto_paused,
            "sensor": self.sensor.get_status(),
            "cadence_rpm": round(self.cadence_rpm, 1),
            "speed_kmh": round(self.speed_kmh, 2),
            "distance_m": round(self.distance_m, 2),
            "elapsed_sec": round(self.elapsed_sec, 2),
            "calories": round(self.calories, 1),
            "max_speed": round(self.max_speed, 1),
            "avg_rpm": round(self._calc_avg_rpm(), 1),
            "terrain_factor": round(self.terrain_factor(), 3),
            "theme": self.theme,
            "stage": stage,
            "riders": riders,
            "heart_rate": None,
            "arcade": self.race.state() if self.race else None,
            "result": self.result,
        }
