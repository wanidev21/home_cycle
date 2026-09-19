"""속도/관성/칼로리 계산 (순수 함수)."""
import math

ACCEL = 3.0        # km/h/s  가속
COAST_DECEL = 2.0  # km/h/s  평지에서 페달 멈췄을 때 감속 (25km/h → 약 12초 후 정지)


def target_speed(rpm: float, terrain_factor: float = 1.0) -> float:
    """
    RPM → 목표 km/h. 로그 곡선: 고RPM일수록 증가폭이 줄어듦.
      20 → 8.9   40 → 16.2   60 → 22.4   80 → 27.7   100 → 32.4   120 → 36.7   150 → 42.2
    terrain_factor: 1.0=평지, <1 오르막, >1 내리막.
    내리막은 안 밟아도 (factor-1)*50 km/h로 굴러간다.
    """
    base = 40 * math.log(rpm / 80 + 1) if rpm > 0 else 0.0
    coast = max(0.0, (terrain_factor - 1.0) * 50)
    return max(base * terrain_factor, coast)


def step_speed(speed: float, rpm: float, terrain_factor: float, dt: float, boost: float = 1.0) -> float:
    """boost: 아케이드 아이템/드래프팅 등의 목표 속도 배율."""
    tgt = target_speed(rpm, terrain_factor) * boost
    if tgt > speed:
        accel = ACCEL * (2.0 if boost > 1.15 else 1.0)   # 터보류는 확 치고 나가게
        return min(tgt, speed + accel * dt)
    if rpm <= 0:
        if terrain_factor > 1.0:
            decel = 1.0                                        # 내리막: 천천히
        else:
            decel = COAST_DECEL + (1.0 - terrain_factor) * 8   # 오르막: 빨리 선다
    else:
        decel = ACCEL                                          # 밟는 중 RPM만 낮춤
    return max(tgt, speed - decel * dt)


def calc_calories(rpm: float, seconds: float, weight_kg: float = 70) -> float:
    """MET 기반 추정 (재미용)."""
    if rpm <= 0:
        return 0.0
    met = 3.5 if rpm < 40 else 5.5 if rpm < 60 else 6.8 if rpm < 80 else 8.5 if rpm < 100 else 10.0
    return met * weight_kg * 3.5 / 200 / 60 * seconds
