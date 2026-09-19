from datetime import date

import pytest

from pedalquest.records import Records, should_save


@pytest.fixture
def records(tmp_path):
    r = Records(tmp_path / "t.db")
    yield r
    r.close()


def rec(**kw):
    base = {"mode": "free", "distance_m": 1000, "elapsed_sec": 300, "calories": 20}
    base.update(kw)
    return base


def test_should_save_threshold():
    assert not should_save(150, 600)
    assert not should_save(1000, 30)
    assert should_save(200, 60)


def test_stats_accumulate(records):
    records.save_record(rec())
    records.save_record(rec(distance_m=500))
    s = records.stats()
    assert s["total_distance_m"] == 1500
    assert s["total_sessions"] == 2


def test_created_at_is_local_time(records):
    from datetime import datetime
    records.save_record(rec())
    created = records.list_records()[0]["created_at"]
    assert abs((datetime.fromisoformat(created) - datetime.now()).total_seconds()) < 5


def test_streak(records):
    for d in ("2026-09-10", "2026-09-11", "2026-09-12", "2026-09-14"):
        records.save_record(rec(), created_at=f"{d}T07:30:00")
    assert records.streak_days(date(2026, 9, 14)) == 1
    assert records.streak_days(date(2026, 9, 13)) == 3   # 오늘 아직 안 탔으면 어제부터
    assert records.streak_days(date(2026, 9, 16)) == 0


def test_best_stage_record_uses_finished_only(records):
    records.save_record(rec(mode="stage", stage_id=1, elapsed_sec=100, finished=False, session_log=[1]))
    records.save_record(rec(mode="stage", stage_id=1, elapsed_sec=500, finished=True, session_log=[1, 2]))
    records.save_record(rec(mode="stage", stage_id=1, elapsed_sec=450, finished=True, session_log=[3, 4]))
    best = records.best_stage_record(1)
    assert best["elapsed_sec"] == 450
    assert best["session_log"] == [3, 4]


def test_unlock_once(records):
    assert records.unlock("first_ride")
    assert not records.unlock("first_ride")
