import pytest

from pedalquest.arcade import ITEMS, ArcadeRace, pick_item
from pedalquest.config import Config
from pedalquest.game import STAGES, GameEngine, blended_factor, stage_segments
from pedalquest.records import Records


class FakeSensor:
    def __init__(self):
        self.rpm = 0.0

    def get_rpm(self):
        return self.rpm

    def get_status(self):
        return {"connected": True, "message": "fake", "cadence_rpm": self.rpm}


@pytest.fixture
def env(tmp_path):
    records = Records(tmp_path / "t.db")
    sensor = FakeSensor()
    game = GameEngine(Config(), sensor, records)
    yield game, sensor, records
    records.close()


DT = 1 / 30


def run(game, seconds, events=None):
    for _ in range(int(seconds / DT)):
        game.tick(DT)
        if events is not None:
            events.extend(game.pop_events())
        if game.state == "finished":
            break


def make_race(stage_id=3, skill=65, seed=1):
    stage = STAGES[stage_id]
    segs = stage_segments(stage)
    return ArcadeRace(stage, skill, lambda d: blended_factor(segs, d), seed)


def test_countdown_then_go(env):
    game, sensor, _ = env
    game.start_arcade(1, seed=1)
    sensor.rpm = 70
    events = []
    run(game, 2.5, events)
    assert game.state == "countdown" and game.distance_m == 0
    run(game, 1.0, events)
    assert game.state == "playing"
    assert any(e["kind"] == "race_go" for e in events)


def test_full_race_is_close_and_saves_record(env):
    game, sensor, records = env
    game.start_arcade(3, seed=7)
    sensor.rpm = 65                       # 기본 실력(기록 없음 → 65)과 같은 페이스
    events = []
    max_spread = 0.0
    for _ in range(int(1800 / DT)):
        game.tick(DT)
        events.extend(game.pop_events())
        if game.state == "playing" and game.distance_m > 500:
            gaps = sorted(abs(r["distance_m"] - game.distance_m) for r in game.race.riders())
            max_spread = max(max_spread, gaps[2])   # 중간 라이벌과의 거리
        if game.state == "finished":
            break
    assert game.state == "finished"
    r = game.result
    assert r["finished"] and 1 <= r["rank"] <= 6
    assert r["coins"] > 0
    assert max_spread < 200, "고무줄 효과로 중간 라이벌은 가까이 있어야 함"
    assert any(e["kind"] == "item_get" for e in events)
    assert any(e["kind"] == "dog_start" for e in events)
    assert any(e["kind"] in ("dog_escape", "dog_caught") for e in events)
    saved = records.list_records()[0]
    assert saved["mode"] == "arcade" and saved["rank"] == r["rank"] and saved["coins"] == r["coins"]
    assert records.best_stage_record(3) is None      # 아케이드는 스테이지 최고기록과 분리


def test_spurt_uses_item(env):
    game, sensor, _ = env
    game.start_arcade(1, seed=3)
    sensor.rpm = 65
    run(game, 3.2)
    game.race.item = "turbo"
    run(game, 5)
    assert game.race.item == "turbo"              # 평소 페이스로는 발동 안 함
    sensor.rpm = 95                               # 스퍼트
    run(game, 2.5)
    assert game.race.item is None
    assert "turbo" in game.race.effects


def test_turbo_makes_player_faster(env):
    game, sensor, _ = env
    game.start_arcade(1, seed=3)
    sensor.rpm = 70
    run(game, 25)
    base = game.speed_kmh
    game.race.effects["turbo"] = 5
    run(game, 4)
    assert game.speed_kmh > base * 1.25


def test_item_use_by_tap_command(env):
    game, sensor, _ = env
    game.start_arcade(1, seed=3)
    run(game, 3.2)
    game.race.item = "shield"
    game.use_item()
    assert "shield" in game.race.effects


def test_player_banana_slips_rival_behind():
    race = make_race(skill=65)
    race.player_d = 300
    race.item = "banana"
    race.use_item()
    r = race.rivals[0]
    r.distance, r.speed = 294, 25        # 바나나(297m) 바로 뒤
    race.update_rivals(1.0, 10)
    assert "slip" in r.effects
    assert any(e["kind"] == "rival_slip" for e in race.pop_events())


def test_rival_banana_slips_player_unless_shielded():
    race = make_race()
    race.coins = 5
    race._drop_hazard(100, 0.3, "r1")
    race.after_player_move(90, 110, 25, 65, DT)
    assert "slip" in race.effects and race.coins == 2
    race2 = make_race()
    race2.effects["shield"] = 5
    race2._drop_hazard(100, 0.3, "r1")
    race2.after_player_move(90, 110, 25, 65, DT)
    assert "slip" not in race2.effects


def test_slow_player_misses_coins():
    race = make_race()
    first = race.coins_list[0][1]
    race.after_player_move(first - 1, first + 1, 8, 30, DT)
    assert race.coins == 0
    second = race.coins_list[1][1]
    race.after_player_move(second - 1, second + 1, 20, 60, DT)
    assert race.coins == 1


def test_dog_escape_requires_effort():
    def chase(speed):
        race = make_race(stage_id=1, skill=65)
        race.dog = {"gap": 12.0, "t": 12.0}
        d = 1000.0
        for _ in range(int(13 / DT)):
            nd = d + speed / 3.6 * DT
            race.after_player_move(d, nd, speed, 65, DT)
            d = nd
            if race.dog is None:
                break
        return race.dogs_escaped, race.dogs_caught
    assert chase(23.9) == (0, 1)     # 평소 속도(65rpm)면 잡힘
    assert chase(30.0) == (1, 0)     # 힘내면 탈출


def test_last_place_gets_stronger_items():
    import random
    rng = random.Random(0)
    first = [pick_item(0.0, rng) for _ in range(2000)]
    last = [pick_item(1.0, rng) for _ in range(2000)]
    assert "star" not in first and "lightning" not in first
    assert last.count("star") + last.count("lightning") > 500
    assert set(first) | set(last) <= set(ITEMS)


def test_arcade_state_shape(env):
    game, _, _ = env
    game.start_arcade(2, seed=1)
    s = game.get_state()
    assert s["state"] == "countdown"
    a = s["arcade"]
    for key in ("countdown", "item", "spurt", "coins", "rank", "riders_total", "drafting", "effects", "dog", "objects", "leaderboard"):
        assert key in a
    assert len([r for r in s["riders"] if r["kind"] == "ai"]) == 5
    assert any(o["t"] == "coin" for o in a["objects"])


# --- AI 라이벌 성격/스태미나 ---

def test_persona_pace_curves():
    from pedalquest.arcade import PERSONAS, persona_pace
    starter, sprinter = PERSONAS["starter"], PERSONAS["sprinter"]
    assert persona_pace(0.1, starter) > 1.05          # 초반 질주형은 앞에서 빠르다
    assert persona_pace(0.9, starter) < 1.0           # 뒤에선 처진다
    assert persona_pace(0.1, sprinter) < 1.0          # 스퍼터는 초반에 아낀다
    assert persona_pace(0.99, sprinter) > 1.1         # 막판에 터뜨린다
    steady = PERSONAS["steady"]
    assert all(0.95 <= persona_pace(f / 20, steady) <= 1.05 for f in range(21))


def _run_race(stage_id=3, player_rpm=75, seed=5, limit=2500):
    from pedalquest.arcade import advance
    stage = STAGES[stage_id]
    segs = stage_segments(stage)
    race = ArcadeRace(stage, player_rpm, lambda d: blended_factor(segs, d), seed)
    d = v = t = 0.0
    events = []
    while d < race.total and t < limit:
        f = blended_factor(segs, d)
        boost, ef = race.player_boost(f)
        v = advance(v, player_rpm, ef, boost, "slip" in race.effects, DT)
        prev, d, t = d, d + v / 3.6 * DT, t + DT
        race.after_player_move(prev, d, v, player_rpm, DT)
        race.update_rivals(DT, t)
        events.extend(race.pop_events())
    return race, events, t


def test_rivals_attack_and_tire():
    race, events, _ = _run_race()
    assert any(e["kind"] == "rival_attack" for e in events), "라이벌이 한 번도 치고 나가지 않음"
    assert any(r.stamina < 0.7 for r in race.rivals), "스태미나가 전혀 닳지 않음"
    assert all(r.stamina >= 0.0 for r in race.rivals)


def test_rivals_are_not_clones():
    """같은 시드라도 라이벌끼리는 서로 다른 페이스로 달린다 (랜덤워크 + 고무줄 강도)."""
    race, _, _ = _run_race()
    dists = sorted(r.distance for r in race.rivals)
    assert dists[-1] - dists[0] > 20, "라이벌이 한 덩어리로 붙어다님"
    assert len({round(r.rubber, 3) for r in race.rivals}) == 5


def test_race_is_close_regardless_of_player_pace():
    for rpm in (60, 90, 115):
        race, _, _ = _run_race(stage_id=2, player_rpm=rpm, seed=11)
        gaps = [abs(r.distance - race.player_d) for r in race.rivals]
        assert min(gaps) < 120, f"{rpm}rpm: 가장 가까운 라이벌이 {min(gaps):.0f}m"


def test_rival_uses_turbo_when_just_behind_player():
    race = make_race(stage_id=1)
    r = race.rivals[0]
    race.player_d, r.distance, r.speed = 500.0, 470.0, 25.0   # 플레이어 30m 뒤
    r.item, r.item_timer = "turbo", 10.0                      # 아직 최대 보유시간 전
    race.update_rivals(DT, 30)
    assert r.item is None and "turbo" in r.effects


def test_rival_holds_turbo_when_it_would_be_wasted():
    race = make_race(stage_id=1)
    r = race.rivals[0]
    race.player_d, r.distance, r.speed = 200.0, 600.0, 25.0   # 한참 앞 → 아껴둔다
    r.item, r.item_timer = "turbo", 10.0
    race.update_rivals(DT, 30)
    assert r.item == "turbo"


def test_pass_events_do_not_spam():
    """나란히 달릴 때 추월 알림이 초당 여러 번 나오면 안 된다."""
    race = make_race(stage_id=1)
    r = race.rivals[0]
    r.speed = 25.0
    kinds = []
    for i in range(int(20 / DT)):
        race.player_d = 500.0
        r.distance = 500.0 + (5 if (i // 30) % 2 else -5)      # 1초마다 앞뒤 교대
        race._track_pass(r, r.distance - race.player_d, DT)
        kinds += [e["kind"] for e in race.pop_events()]
    assert 0 < len(kinds) <= 4, f"20초 동안 추월 알림 {len(kinds)}회"


def test_spurt_threshold_stays_reachable_for_fast_riders():
    """평소 케이던스가 높아도 스퍼트 요구치가 불가능해지면 안 된다."""
    race = make_race(stage_id=1)
    for base in (50, 70, 90, 113, 130):
        race.baseline_rpm = base
        extra = race.spurt_threshold() - base
        assert 9 <= extra <= 19, f"평소 {base} RPM -> +{extra:.0f} RPM 요구"
    race.baseline_rpm = 20                      # 워밍업 중이어도 최소 기준은 있다
    assert race.spurt_threshold() >= 50


def test_riders_expose_attack_and_tired_flags():
    """프론트엔드 이펙트(오라/페이드)는 이 두 필드를 읽는다."""
    race = make_race(stage_id=1)
    r = race.rivals[0]
    row = race.riders()[0]
    assert row["attacking"] is False and row["tired"] is False
    r.attack, r.stamina = 5.0, 0.1
    row = race.riders()[0]
    assert row["attacking"] is True and row["tired"] is True
    r.effects["turbo"] = 3.0          # 아이템 효과와 겹쳐도 각각 살아 있어야 한다
    row = race.riders()[0]
    assert row["effect"] == "turbo" and row["attacking"] is True
