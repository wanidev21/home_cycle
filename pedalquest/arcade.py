"""아케이드 레이스: AI 라이벌, 아이템, 코인, 부스트 발판, 개 추격 이벤트.

달리는 중 입력은 페달뿐이므로 아이템은 "스퍼트"(평소보다 RPM을 확 올려 2초 유지)로 사용한다.
태블릿의 아이템 칸을 터치해도 사용 가능.
"""
import math
import random

from .physics import step_speed, target_speed

COUNTDOWN_SEC = 3.0
VIEW_AHEAD_M = 450
SPURT_HOLD_SEC = 2.0
COIN_MIN_SPEED = 12.0      # km/h. 이보다 느리면 코인을 놓친다
MAX_COIN_BOOST = 10        # 코인 1개당 속도 +1%, 최대 10%
SLIP_DECEL = 15.0          # km/h/s
DOG_START_GAP = 12.0
DOG_TIME = 12.0
DOG_ESCAPE_GAP = 45.0
DOG_REWARD = 5
COIN_LOSS = 3
LAST_SPURT_M = 300

ITEMS = {
    "turbo":     {"name": "터보", "emoji": "🚀", "desc": "5초간 속도 +35%"},
    "banana":    {"name": "바나나", "emoji": "🍌", "desc": "뒤에 떨어뜨려 라이벌을 미끄러뜨림"},
    "shield":    {"name": "바람막이", "emoji": "🛡", "desc": "12초간 오르막 영향 절반 + 바나나 방어"},
    "magnet":    {"name": "드래프트 자석", "emoji": "🧲", "desc": "6초간 앞 선수에게 끌려감"},
    "star":      {"name": "무적 스퍼트", "emoji": "⭐", "desc": "8초간 빨라지고 부딪힌 라이벌을 튕겨냄"},
    "lightning": {"name": "번개", "emoji": "⚡", "desc": "앞선 라이벌 전원 3초간 감속"},
}
# (1등일 때 가중치, 꼴찌일 때 가중치) — 뒤처질수록 강한 아이템 (마리오카트 방식)
ITEM_WEIGHTS = {
    "banana": (45, 5), "shield": (30, 10), "turbo": (20, 30),
    "magnet": (5, 20), "star": (0, 22), "lightning": (0, 13),
}
EFFECT_SEC = {"turbo": 5.0, "shield": 12.0, "magnet": 6.0, "star": 8.0, "slip": 1.6, "pad": 2.0}

RIVALS = [
    {"id": "r1", "name": "민준", "color": "#3a86ff", "persona": "climber"},
    {"id": "r2", "name": "서연", "color": "#8338ec", "persona": "sprinter"},
    {"id": "r3", "name": "도윤", "color": "#06d6a0", "persona": "steady"},
    {"id": "r4", "name": "하은", "color": "#ffbe0b", "persona": "starter"},
    {"id": "r5", "name": "지호", "color": "#ef476f", "persona": "steady"},
]
PERSONA_LABEL = {"climber": "오르막 강자", "sprinter": "막판 스퍼터", "steady": "꾸준형", "starter": "초반 질주형"}
SKILL_SPREAD = [0.86, 0.93, 0.99, 1.05, 1.12]   # 내 평소 RPM 대비 라이벌 실력
RIVAL_LANES = [-0.62, 0.62, -0.3, 0.3, -0.85]


def pick_item(rank_frac: float, rng: random.Random) -> str:
    """rank_frac: 0=1등, 1=꼴찌."""
    names = list(ITEM_WEIGHTS)
    weights = [a + (b - a) * rank_frac for a, b in ITEM_WEIGHTS.values()]
    return rng.choices(names, weights=weights)[0]


def advance(speed: float, rpm: float, factor: float, boost: float, slipping: bool, dt: float) -> float:
    v = step_speed(speed, rpm, factor, dt, boost)
    if slipping:
        v = max(target_speed(rpm, factor) * boost, v - SLIP_DECEL * dt)
    return max(0.0, v)


def tick_effects(effects: dict, dt: float):
    for k in list(effects):
        effects[k] -= dt
        if effects[k] <= 0:
            del effects[k]


def crossed(prev: float, cur: float, d: float) -> bool:
    return prev < d <= cur


class Rival:
    def __init__(self, spec: dict, skill_rpm: float, lane: float, rng: random.Random):
        self.id = spec["id"]
        self.name = spec["name"]
        self.color = spec["color"]
        self.persona = spec["persona"]
        self.skill = skill_rpm
        self.lane = lane
        self.distance = 0.0
        self.speed = 0.0
        self.rpm = 0.0
        self.effects: dict[str, float] = {}
        self.item: str | None = None
        self.item_timer = 0.0
        self.finished_at: float | None = None
        self.phase = rng.random() * 10


class ArcadeRace:
    def __init__(self, stage: dict, player_skill_rpm: float, factor_fn, seed=None):
        self.rng = random.Random(seed)
        self.stage = stage
        self.total = float(stage["distance_m"])
        self.factor_fn = factor_fn
        self.skill = player_skill_rpm
        self.countdown = COUNTDOWN_SEC
        skills = [player_skill_rpm * s for s in SKILL_SPREAD]
        self.rng.shuffle(skills)
        self.rivals = [Rival(spec, sk, lane, self.rng) for spec, sk, lane in zip(RIVALS, skills, RIVAL_LANES)]

        self.player_d = 0.0
        self.player_speed = 0.0
        self.player_finished = False
        self.player_finished_at = 0.0
        self.item: str | None = None
        self.effects: dict[str, float] = {}
        self.coins = 0
        self.items_used = 0
        self.spurt = 0.0
        self.baseline_rpm = max(45.0, player_skill_rpm * 0.9)
        self.drafting = False
        self.dog: dict | None = None
        self.dogs_escaped = 0
        self.dogs_caught = 0
        self.last_spurt_announced = False
        self.first_finisher_announced = False
        self.events: list[dict] = []
        self._build_course()

    # --- 코스 오브젝트 ---
    def _build_course(self):
        t = int(self.total)
        self.boxes = [float(d) for d in range(250, t - 150, 450)]
        self.pads = [float(d) for d in range(550, t - 100, 700) if all(abs(d - b) > 60 for b in self.boxes)]
        self.coins_list: list[tuple[int, float]] = []
        cid = 0
        for g in range(120, t - 60, 240):
            if any(abs(g - x) < 40 for x in self.boxes + self.pads):
                continue
            for k in range(3):
                self.coins_list.append((cid, float(g + k * 5)))
                cid += 1
        self.collected: set[int] = set()
        n_dogs = 1 if self.total <= 3000 else 2
        lo, hi = 0.3, 0.8
        self.dog_triggers = sorted(self.total * (lo + (hi - lo) * (i + self.rng.random()) / n_dogs) for i in range(n_dogs))
        self.hazards: list[dict] = []   # 바나나 {"id", "d", "lane", "owner"}
        self._hazard_seq = 0

    def emit(self, kind: str, **data):
        self.events.append({"kind": kind, **data})

    def pop_events(self) -> list[dict]:
        ev, self.events = self.events, []
        return ev

    # --- 순위 ---
    def rank(self) -> int:
        if self.player_finished:
            return 1 + sum(1 for r in self.rivals if r.finished_at is not None)
        return 1 + sum(1 for r in self.rivals if r.finished_at is not None or r.distance > self.player_d)

    def _rank_frac(self) -> float:
        return (self.rank() - 1) / len(self.rivals)

    # --- 플레이어 ---
    def spurt_threshold(self) -> float:
        return max(self.baseline_rpm * 1.2, self.baseline_rpm + 12, 45.0)

    def player_boost(self, factor: float) -> tuple[float, float]:
        """엔진이 속도 계산 전에 호출. (목표속도 배율, 적용할 지형계수)"""
        e = self.effects
        boost = 1 + 0.01 * min(self.coins, MAX_COIN_BOOST)
        if "turbo" in e:
            boost *= 1.35
        if "star" in e:
            boost *= 1.25
        if "pad" in e:
            boost *= 1.3
        if "magnet" in e:
            ahead = any(0 < r.distance - self.player_d < 100 for r in self.rivals if r.finished_at is None)
            boost *= 1.2 if ahead else 1.08
        if self.drafting:
            boost *= 1.08
        if "slip" in e:
            boost *= 0.5
        if factor < 1 and ("shield" in e or "star" in e):
            factor += (1 - factor) * 0.5
        return boost, factor

    def use_item(self):
        it = self.item
        if not it:
            return
        self.item = None
        self.spurt = 0.0
        self.items_used += 1
        if it in ("turbo", "shield", "magnet", "star"):
            self.effects[it] = EFFECT_SEC[it]
            self.effects.pop("slip", None)
        elif it == "banana":
            self._drop_hazard(self.player_d - 3, 0.0, "player")
        elif it == "lightning":
            hit = [r for r in self.rivals if r.finished_at is None and r.distance > self.player_d]
            for r in hit:
                r.effects["slip"] = 3.0
                r.effects.pop("turbo", None)
            self.emit("lightning", count=len(hit))
        self.emit("item_use", item=it, **ITEMS[it])

    def _drop_hazard(self, d: float, lane: float, owner: str):
        if d <= 0:
            return
        self._hazard_seq += 1
        self.hazards.append({"id": self._hazard_seq, "d": d, "lane": lane, "owner": owner})

    def _lose_coins(self) -> int:
        lost = min(self.coins, COIN_LOSS)
        self.coins -= lost
        return lost

    def after_player_move(self, prev: float, d: float, speed: float, rpm: float, dt: float):
        self.player_d = d
        self.player_speed = speed
        tick_effects(self.effects, dt)

        # 스퍼트 → 아이템 사용
        thr = self.spurt_threshold()
        if self.item and rpm >= thr:
            self.spurt += dt
            if self.spurt >= SPURT_HOLD_SEC:
                self.use_item()
        else:
            self.spurt = max(0.0, self.spurt - dt * 2)
            if rpm > 0:
                self.baseline_rpm += (rpm - self.baseline_rpm) * min(1.0, dt / 20)

        # 아이템 박스
        for b in self.boxes:
            if crossed(prev, d, b) and self.item is None:
                self.item = pick_item(self._rank_frac(), self.rng)
                self.emit("item_get", item=self.item, **ITEMS[self.item])
        # 부스트 발판
        for p in self.pads:
            if crossed(prev, d, p):
                self.effects["pad"] = EFFECT_SEC["pad"]
                self.emit("boost_pad")
        # 코인
        for cid, cd in self.coins_list:
            if cid not in self.collected and crossed(prev, d, cd):
                if speed >= COIN_MIN_SPEED:
                    self.collected.add(cid)
                    self.coins += 1
                else:
                    self.collected.add(cid)   # 놓친 코인은 사라짐
                    self.emit("coin_missed")
        # 라이벌이 떨어뜨린 바나나
        for h in list(self.hazards):
            if h["owner"] != "player" and crossed(prev, d, h["d"]):
                self.hazards.remove(h)
                if "shield" in self.effects or "star" in self.effects:
                    self.emit("blocked")
                else:
                    self.effects["slip"] = EFFECT_SEC["slip"]
                    self.emit("slip", coins_lost=self._lose_coins())
        # 무적 스퍼트: 부딪힌 라이벌 튕겨냄
        if "star" in self.effects:
            for r in self.rivals:
                if r.finished_at is None and abs(r.distance - d) < 3 and "slip" not in r.effects:
                    r.effects["slip"] = EFFECT_SEC["slip"]
                    self.emit("bump", name=r.name)
        # 드래프팅: 앞 선수 1.5~10m 뒤
        self.drafting = any(1.5 < r.distance - d < 10 for r in self.rivals if r.finished_at is None)

        # 개 추격
        for t in list(self.dog_triggers):
            if crossed(prev, d, t):
                self.dog_triggers.remove(t)
                if self.dog is None:
                    self.dog = {"gap": DOG_START_GAP, "t": DOG_TIME}
                    self.emit("dog_start")
        if self.dog:
            dog_speed = max(18.0, target_speed(self.skill, 1.0) * 1.25) * min(1.0, self.factor_fn(d))
            self.dog["gap"] += (speed - dog_speed) / 3.6 * dt
            self.dog["t"] -= dt
            if self.dog["gap"] <= 0:
                self.dog = None
                self.dogs_caught += 1
                self.effects["slip"] = EFFECT_SEC["slip"]
                self.emit("dog_caught", coins_lost=self._lose_coins())
            elif self.dog["t"] <= 0 or self.dog["gap"] >= DOG_ESCAPE_GAP:
                self.dog = None
                self.dogs_escaped += 1
                self.coins += DOG_REWARD
                self.emit("dog_escape", coins=DOG_REWARD)

        if not self.last_spurt_announced and d >= self.total - LAST_SPURT_M:
            self.last_spurt_announced = True
            self.emit("last_spurt")

    # --- 라이벌 ---
    def update_rivals(self, dt: float, elapsed: float):
        for r in self.rivals:
            if r.finished_at is not None:
                continue
            tick_effects(r.effects, dt)
            frac = r.distance / self.total
            noise = 1 + 0.05 * math.sin(elapsed * 0.3 + r.phase) + 0.03 * math.sin(elapsed * 1.1 + r.phase * 2)
            rpm = r.skill * noise
            factor = self.factor_fn(r.distance)
            if r.persona == "climber" and factor < 1:
                factor += (1 - factor) * 0.45
            elif r.persona == "sprinter":
                rpm *= 1.15 if frac > 0.85 else 0.97
            elif r.persona == "starter":
                rpm *= 1.12 if frac < 0.25 else 0.95 if frac > 0.6 else 1.0
            r.rpm = rpm

            # 고무줄 효과: 너무 앞서면 느려지고, 너무 뒤처지면 빨라진다 → 항상 접전
            # ±30m 안은 실력대로. 그 밖은 거리에 비례해 보정 (뒤처지면 최대 +40%, 앞서면 최대 -25%)
            gap = r.distance - self.player_d
            if self.player_finished:
                band = 1.0
            elif gap > 30:
                band = 1 - min(1.0, (gap - 30) / 200) * 0.25
            elif gap < -30:
                band = 1 + min(1.0, (-gap - 30) / 200) * 0.40
            else:
                band = 1.0
            boost = band
            if "turbo" in r.effects:
                boost *= 1.3
            if "pad" in r.effects:
                boost *= 1.3
            if "slip" in r.effects:
                boost *= 0.5
            others = [x.distance for x in self.rivals if x is not r and x.finished_at is None]
            if not self.player_finished:
                others.append(self.player_d)
            if any(1.5 < o - r.distance < 10 for o in others):
                boost *= 1.06

            prev = r.distance
            r.speed = advance(r.speed, rpm, factor, boost, "slip" in r.effects, dt)
            r.distance += r.speed / 3.6 * dt

            for b in self.boxes:
                if crossed(prev, r.distance, b) and r.item is None:
                    r.item = self.rng.choice(["turbo", "turbo", "banana"])
                    r.item_timer = self.rng.uniform(2, 8)
            for p in self.pads:
                if crossed(prev, r.distance, p):
                    r.effects["pad"] = EFFECT_SEC["pad"]
            for h in list(self.hazards):
                if h["owner"] != r.id and crossed(prev, r.distance, h["d"]):
                    self.hazards.remove(h)
                    r.effects["slip"] = EFFECT_SEC["slip"]
                    if h["owner"] == "player":
                        self.emit("rival_slip", name=r.name)

            if r.item:
                r.item_timer -= dt
                if r.item_timer <= 0:
                    if r.item == "turbo":
                        r.effects["turbo"] = 4.0
                    else:
                        self._drop_hazard(r.distance - 3, r.lane, r.id)
                        if 0 < r.distance - self.player_d < 150 and not self.player_finished:
                            self.emit("rival_banana", name=r.name)
                    r.item = None

            if r.distance >= self.total:
                r.distance = self.total
                r.finished_at = elapsed
                if not self.first_finisher_announced and not self.player_finished:
                    self.first_finisher_announced = True
                    self.emit("rival_finish", name=r.name)

    def finish_player(self, elapsed: float):
        self.player_finished = True
        self.player_finished_at = elapsed

    # --- 상태 ---
    def riders(self) -> list[dict]:
        return [{
            "id": r.id, "name": r.name, "kind": "ai", "color": r.color, "lane": r.lane,
            "persona": PERSONA_LABEL[r.persona], "distance_m": round(r.distance, 1),
            "rpm": round(r.rpm), "finished": r.finished_at is not None,
            "effect": "slip" if "slip" in r.effects else "turbo" if ("turbo" in r.effects or "pad" in r.effects) else None,
        } for r in self.rivals]

    def leaderboard(self) -> list[dict]:
        rows = [{"name": "나", "color": "#ff6b35", "is_player": True, "d": self.player_d,
                 "done": 0 if self.player_finished else 1, "t": self.player_finished_at}]
        for r in self.rivals:
            rows.append({"name": r.name, "color": r.color, "is_player": False, "d": r.distance,
                         "done": 0 if r.finished_at is not None else 1, "t": r.finished_at or 0})
        rows.sort(key=lambda x: (x["done"], x["t"] if x["done"] == 0 else 0, -x["d"]))
        return [{"name": x["name"], "color": x["color"], "is_player": x["is_player"],
                 "gap_m": round(x["d"] - self.player_d), "finished": x["done"] == 0} for x in rows]

    def objects(self) -> list[dict]:
        lo, hi = self.player_d - 5, self.player_d + VIEW_AHEAD_M
        out = []
        out += [{"t": "box", "d": b} for b in self.boxes if lo < b < hi]
        out += [{"t": "pad", "d": p} for p in self.pads if lo < p < hi]
        out += [{"t": "coin", "d": cd} for cid, cd in self.coins_list if cid not in self.collected and lo < cd < hi]
        out += [{"t": "banana", "d": round(h["d"], 1), "lane": h["lane"]} for h in self.hazards if lo < h["d"] < hi]
        return out

    def state(self) -> dict:
        return {
            "countdown": round(self.countdown, 2),
            "item": self.item,
            "item_info": ITEMS.get(self.item) if self.item else None,
            "spurt": round(min(1.0, self.spurt / SPURT_HOLD_SEC), 2),
            "spurt_rpm": round(self.spurt_threshold()),
            "coins": self.coins,
            "rank": self.rank(),
            "riders_total": len(self.rivals) + 1,
            "drafting": self.drafting,
            "effects": {k: round(v, 1) for k, v in self.effects.items()},
            "dog": {"gap": round(self.dog["gap"], 1), "t": round(self.dog["t"], 1)} if self.dog else None,
            "objects": self.objects(),
            "leaderboard": self.leaderboard(),
        }
