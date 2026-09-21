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
