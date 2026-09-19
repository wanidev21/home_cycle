"""업적 정의 + 조건 체크."""

ACHIEVEMENTS = {
    "first_ride":     {"name": "🚲 첫 라이딩",    "desc": "첫 세션 완료"},
    "5km_club":       {"name": "📍 5km 클럽",     "desc": "한 세션에 5km"},
    "10km_club":      {"name": "🏅 10km 클럽",    "desc": "한 세션에 10km"},
    "speed_demon":    {"name": "⚡ 스피드 데몬",   "desc": "최고 속도 40km/h"},
    "calorie_burner": {"name": "🔥 칼로리 버너",   "desc": "한 세션에 150kcal"},
    "rpm_machine":    {"name": "🔄 RPM 머신",     "desc": "5분 이상, 페달링 평균 RPM 80 이상"},
    "three_stars":    {"name": "⭐ 퍼펙트",        "desc": "스테이지 ★★★"},
    "ghost_buster":   {"name": "👻 고스트 버스터", "desc": "고스트보다 먼저 완주"},
    "streak_3":       {"name": "🔥 3일 연속",      "desc": "3일 연속 라이딩"},
    "streak_7":       {"name": "🔥🔥 7일 연속",    "desc": "7일 연속 라이딩"},
    "total_100km":    {"name": "🌍 100km 돌파",   "desc": "누적 거리 100km"},
    "arcade_win":     {"name": "🏁 첫 우승",       "desc": "아케이드 레이스 1등"},
    "coin_collector": {"name": "🪙 코인 수집가",   "desc": "누적 코인 100개"},
    "dog_escape":     {"name": "🐕 탈출 성공",     "desc": "쫓아오는 개를 따돌림"},
}


def check_live(distance_m: float, max_speed: float, calories: float) -> list[str]:
    """플레이 중 달성 순간 알리는 업적."""
    ids = []
    if distance_m >= 5000:
        ids.append("5km_club")
    if distance_m >= 10000:
        ids.append("10km_club")
    if max_speed >= 40:
        ids.append("speed_demon")
    if calories >= 150:
        ids.append("calorie_burner")
    return ids


def check_session_end(summary: dict, records) -> list[str]:
    """기록 저장 직후 체크. summary: 저장된 기록 + ghost_won."""
    ids = ["first_ride"]
    if summary["elapsed_sec"] >= 300 and (summary.get("avg_rpm") or 0) >= 80:
        ids.append("rpm_machine")
    if summary.get("stars") == 3:
        ids.append("three_stars")
    if summary.get("ghost_won"):
        ids.append("ghost_buster")
    if summary.get("mode") == "arcade" and summary.get("finished") and summary.get("rank") == 1:
        ids.append("arcade_win")
    streak = records.streak_days()
    if streak >= 3:
        ids.append("streak_3")
    if streak >= 7:
        ids.append("streak_7")
    stats = records.stats()
    if stats["total_distance_m"] >= 100_000:
        ids.append("total_100km")
    if stats["total_coins"] >= 100:
        ids.append("coin_collector")
    return ids


def unlock_new(records, ids: list[str]) -> list[dict]:
    """DB에 해금하고, 이번에 새로 해금된 것만 이벤트로 반환."""
    events = []
    for aid in ids:
        if records.unlock(aid):
            events.append({"type": "event", "kind": "achievement", "id": aid, **ACHIEVEMENTS[aid]})
    return events
