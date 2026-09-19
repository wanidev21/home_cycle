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
