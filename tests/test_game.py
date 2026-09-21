import pytest

from pedalquest.config import Config
from pedalquest.game import STAGES, GameEngine
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


def run(game, seconds, dt=1 / 30):
    for _ in range(int(seconds / dt)):
        game.tick(dt)
        if game.state == "finished":
            break


def test_free_ride_moves_and_auto_pauses(env):
    game, sensor, _ = env
    game.start_free()
    sensor.rpm = 80
    run(game, 60)
    assert game.distance_m > 300
    sensor.rpm = 0
    run(game, 25)
    assert game.state == "paused" and game.auto_paused
    elapsed = game.elapsed_sec
    run(game, 10)
    assert game.elapsed_sec == elapsed          # 자동 일시정지 중 시간 멈춤
    sensor.rpm = 60
    run(game, 1)
    assert game.state == "playing"


def test_stage_finish_saves_record_and_achievements(env):
    game, sensor, records = env
    game.start_stage(1)
    sensor.rpm = 100          # ★★★ 기준(90 RPM)보다 빠르게
    run(game, 900)
    assert game.state == "finished"
    assert game.result["finished"] and game.result["stars"] == 3
    assert game.result["new_best"]
    kinds = {e["kind"] for e in game.pop_events()}
    assert "stage_finish" in kinds and "achievement" in kinds
    assert records.best_stage_record(1)["session_log"]
    assert "first_ride" in records.unlocked() and "three_stars" in records.unlocked()


def test_short_session_not_saved(env):
    game, sensor, records = env
    game.start_free()
    sensor.rpm = 80
    run(game, 20)
    game.stop()
    assert game.state == "finished" and not game.result["saved"]
    assert records.list_records() == []


def test_ghost_race(env):
    game, sensor, records = env
    game.start_stage(4)
    sensor.rpm = 70
    run(game, 900)
    slow_time = game.result["elapsed_sec"]
    game.to_menu()

    game.start_stage(4, ghost=True)
    assert game.ghost is not None
    sensor.rpm = 60                  # 초반엔 고스트보다 느림
    run(game, 60)
    assert game.get_state()["riders"][0]["distance_m"] > game.distance_m
    sensor.rpm = 110                 # 추월
    run(game, 900)
    events = game.pop_events()
    assert any(e["kind"] == "overtake" for e in events)
    assert game.result["ghost_won"] and game.result["elapsed_sec"] < slow_time
    assert "ghost_buster" in records.unlocked()


def test_uphill_is_slower(env):
    game, sensor, _ = env
    game.start_stage(2)
    sensor.rpm = 70
    run(game, 60)
    flat_speed = game.speed_kmh
    while game.distance_m < 1300:
        game.tick(1 / 30)
    assert game.speed_kmh < flat_speed * 0.7


def test_state_shape(env):
    game, _, _ = env
    game.start_stage(3)
    s = game.get_state()
    for key in ("mode", "state", "sensor", "cadence_rpm", "speed_kmh", "distance_m", "elapsed_sec",
                "terrain_factor", "theme", "stage", "riders", "heart_rate"):
        assert key in s
    assert s["stage"]["distance_m"] == STAGES[3]["distance_m"]


# --- 확장 업적 / 고스트 로그 ---

def test_free_ride_does_not_store_ghost_log(env):
    game, sensor, records = env
    game.start_free()
    sensor.rpm = 80
    run(game, 120)
    game.stop()
    row = records.conn.execute("SELECT session_log FROM records ORDER BY id DESC LIMIT 1").fetchone()
    assert row["session_log"] == "[]", "프리 라이딩은 고스트가 없으므로 로그를 저장하지 않는다"


def test_non_stop_achievement_needs_continuous_pedalling(env):
    game, sensor, records = env
    game.start_stage(4)
    sensor.rpm = 110
    run(game, 600)
    assert game.state == "finished" and game.result["finished"]
    assert "non_stop" in records.unlocked()


def test_stopping_mid_stage_loses_non_stop(env):
    game, sensor, records = env
    game.start_stage(4)
    sensor.rpm = 110
    run(game, 60)
    sensor.rpm = 0
    run(game, 10)          # 쉼
    sensor.rpm = 110
    run(game, 600)
    assert game.result["finished"]
    assert "non_stop" not in records.unlocked()


def test_time_of_day_achievements():
    from pedalquest.achievements import check_session_end

    class FakeRecords:
        def streak_days(self): return 1
        def stats(self): return {"total_distance_m": 0, "total_coins": 0}
        def stage_bests(self): return {}

    base = {"mode": "free", "elapsed_sec": 400, "avg_rpm": 70, "finished": False}
    assert "early_bird" in check_session_end({**base, "hour": 6}, FakeRecords())
    assert "night_owl" in check_session_end({**base, "hour": 23}, FakeRecords())
    assert "night_owl" in check_session_end({**base, "hour": 1}, FakeRecords())
    day = check_session_end({**base, "hour": 14}, FakeRecords())
    assert "early_bird" not in day and "night_owl" not in day


def test_grand_slam_needs_every_stage_three_starred():
    from pedalquest.achievements import check_session_end

    class FakeRecords:
        def __init__(self, bests): self.bests = bests
        def streak_days(self): return 1
        def stats(self): return {"total_distance_m": 0, "total_coins": 0}
        def stage_bests(self): return self.bests

    summary = {"mode": "stage", "elapsed_sec": 400, "finished": True, "stars": 3, "coast_time": 99}
    four = {i: {"best_stars": 3} for i in range(1, 5)}
    assert "all_stages" not in check_session_end(summary, FakeRecords(four))
    five = {i: {"best_stars": 3} for i in range(1, 6)}
    ids = check_session_end(summary, FakeRecords(five))
    assert "all_stages" in ids and "all_three_stars" in ids
    mixed = {**five, 3: {"best_stars": 2}}
    ids = check_session_end(summary, FakeRecords(mixed))
    assert "all_stages" in ids and "all_three_stars" not in ids
