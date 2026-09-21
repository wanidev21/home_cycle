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


# --- 고스트 로그 저장 효율 ---

def stage_rec(stage_id, elapsed, log, finished=1):
    return rec(mode="stage", stage_id=stage_id, elapsed_sec=elapsed,
               distance_m=3000, finished=finished, session_log=log)


def test_only_best_stage_record_keeps_ghost_log(records):
    slow = list(range(0, 3000, 5))
    fast = list(range(0, 3000, 6))
    records.save_record(stage_rec(1, 600, slow))
    assert records.best_stage_record(1)["session_log"] == slow
    records.save_record(stage_rec(1, 500, fast))          # 신기록
    assert records.best_stage_record(1)["session_log"] == fast
    logs = [r["session_log"] for r in
            records.conn.execute("SELECT session_log FROM records WHERE stage_id=1")]
    assert logs.count("[]") == 1, "예전 기록의 고스트 로그가 지워지지 않음"


def test_slower_record_does_not_replace_ghost(records):
    fast = list(range(0, 3000, 6))
    records.save_record(stage_rec(1, 500, fast))
    records.save_record(stage_rec(1, 700, list(range(0, 3000, 4))))
    assert records.best_stage_record(1)["session_log"] == fast


def test_other_stages_keep_their_own_ghost(records):
    records.save_record(stage_rec(1, 500, [1, 2, 3]))
    records.save_record(stage_rec(2, 400, [4, 5, 6]))
    records.save_record(stage_rec(1, 450, [7, 8, 9]))
    assert records.best_stage_record(2)["session_log"] == [4, 5, 6]


def test_ghost_log_stored_as_whole_meters(records):
    records.save_record(stage_rec(1, 500, [10.44, 20.61, 30.5]))
    assert records.best_stage_record(1)["session_log"] == [10, 21, 30]


def test_recent_avg_rpm_allows_high_cadence(records):
    for _ in range(3):
        records.save_record(rec(avg_rpm=113))
    assert records.recent_avg_rpm() == pytest.approx(113)
    records2 = records
    assert records2.recent_avg_rpm(limit=0, default=65) == 65


# --- 영상 라이딩 코스 목록 ---

def test_video_courses_lists_only_files_that_exist(tmp_path, monkeypatch):
    """courses.json이 낡아서 없는 파일을 가리켜도 목록이 깨지면 안 된다."""
    import json as _json
    from pedalquest import server

    vd = tmp_path / "video"
    vd.mkdir()
    (vd / "hangang.mp4").write_bytes(b"x" * 2_000_000)
    (vd / "courses.json").write_text(_json.dumps([
        {"file": "hangang.mp4", "name": "한강", "filmed_kmh": 22, "note": "여의도→반포"},
        {"file": "sold.mp4", "name": "지운 영상", "filmed_kmh": 18},
    ]), encoding="utf-8")
    monkeypatch.setattr(server, "VIDEO_DIR", vd)

    rows = server.video_courses()
    assert [r["file"] for r in rows] == ["hangang.mp4"]
    assert rows[0]["name"] == "한강" and rows[0]["filmed_kmh"] == 22
    assert rows[0]["url"] == "/static/video/hangang.mp4"
    assert rows[0]["size_mb"] == 2.0


def test_video_course_without_metadata_gets_a_default(tmp_path, monkeypatch):
    from pedalquest import server
    vd = tmp_path / "video"
    vd.mkdir()
    (vd / "raw_clip.mp4").write_bytes(b"x")
    monkeypatch.setattr(server, "VIDEO_DIR", vd)
    row = server.video_courses()[0]
    assert row["name"] == "raw_clip"
    assert row["filmed_kmh"] == server.DEFAULT_FILMED_KMH


def test_missing_video_dir_is_not_an_error(tmp_path, monkeypatch):
    from pedalquest import server
    monkeypatch.setattr(server, "VIDEO_DIR", tmp_path / "nope")
    assert server.video_courses() == []
