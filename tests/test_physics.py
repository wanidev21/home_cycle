import pytest

from pedalquest.game import STAGES, blended_factor, stage_segments
from pedalquest.physics import calc_calories, step_speed, target_speed


@pytest.mark.parametrize("rpm,kmh", [(40, 16.2), (60, 22.4), (80, 27.7), (100, 32.4), (120, 36.7)])
def test_speed_curve(rpm, kmh):
    assert target_speed(rpm) == pytest.approx(kmh, abs=0.1)


def test_zero_rpm_flat_is_zero():
    assert target_speed(0, 1.0) == 0


def test_coast_to_stop_on_flat_takes_about_12s():
    v, t = 25.0, 0.0
    while v > 0.5:
        v = step_speed(v, 0, 1.0, 1 / 30)
        t += 1 / 30
    assert 10 < t < 14


def test_downhill_coasts_without_pedaling():
    v = 0.0
    for _ in range(30 * 60):
        v = step_speed(v, 0, 1.4, 1 / 30)
    assert v == pytest.approx(20, abs=0.1)


def test_uphill_stops_faster_than_flat():
    def stop_time(f):
        v, t = 20.0, 0.0
        while v > 0.5:
            v = step_speed(v, 0, f, 1 / 30)
            t += 1 / 30
        return t
    assert stop_time(0.6) < stop_time(1.0) / 2


def test_calories():
    assert calc_calories(0, 60) == 0
    assert calc_calories(70, 60, 70) == pytest.approx(6.8 * 70 * 3.5 / 200, rel=1e-6)


def simulate_stage(stage, rpm, dt=1 / 30):
    segs = stage_segments(stage)
    d = v = t = 0.0
    while d < stage["distance_m"]:
        v = step_speed(v, rpm, blended_factor(segs, d), dt)
        d += v / 3.6 * dt
        t += dt
    return t


# 기준 케이던스: 홈싸이클은 저항이 가벼워 90~110 RPM이 흔하다 (실측 평균 113).
STAR_CADENCE = {"3": 90, "2": 75, "1": 60}
SPRINT_CADENCE = {"3": 105, "2": 90, "1": 75}


@pytest.mark.parametrize("sid", list(STAGES))
def test_star_thresholds_match_target_cadence(sid):
    """기준 RPM으로 일정하게 타면 해당 별을 받는다. 여유는 모든 스테이지에서 10~30초로 통일.
    물리 상수를 바꾸면 이 테스트가 깨진다 → 별 기준도 다시 시뮬레이션할 것."""
    stage = STAGES[sid]
    cadences = SPRINT_CADENCE if sid == 4 else STAR_CADENCE
    for stars, rpm in cadences.items():
        t = simulate_stage(stage, rpm)
        limit = stage["stars"][stars]
        assert t <= limit, f"stage {sid} {stars}★ @ {rpm}rpm: {t:.0f}s > {limit}s"
        assert t > limit - 30, f"stage {sid} {stars}★ 기준이 너무 느슨함: {t:.0f}s vs {limit}s"


@pytest.mark.parametrize("sid", list(STAGES))
def test_stage_fits_session_length(sid):
    """한 판 10~20분 원칙: 가장 느린 기준(★1 RPM)으로도 22분을 넘지 않는다."""
    stage = STAGES[sid]
    slow = (SPRINT_CADENCE if sid == 4 else STAR_CADENCE)["1"]
    assert simulate_stage(stage, slow) <= 22 * 60


def test_star_gaps_are_ordered():
    for sid, stage in STAGES.items():
        s = stage["stars"]
        assert s["3"] < s["2"] < s["1"], f"stage {sid} 별 기준 역전"


def test_blended_factor_is_continuous():
    segs = stage_segments(STAGES[3])
    prev = blended_factor(segs, 0)
    for d in range(0, 5000):
        f = blended_factor(segs, d)
        assert abs(f - prev) < 0.02
        prev = f
