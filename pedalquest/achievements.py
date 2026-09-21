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
    # --- 확장 ---
    "20km_club":       {"name": "🚵 20km 클럽",    "desc": "한 세션에 20km"},
    "spin_master":     {"name": "🌀 스핀 마스터",   "desc": "10분 이상, 페달링 평균 RPM 100 이상"},
    "non_stop":        {"name": "⏱ 논스톱",        "desc": "스테이지를 5초도 쉬지 않고 완주"},
    "all_stages":      {"name": "🗺 코스 정복",     "desc": "스테이지 5개 전부 완주"},
    "all_three_stars": {"name": "👑 그랜드슬램",    "desc": "모든 스테이지 ★★★"},
    "podium":          {"name": "🥉 포디움",        "desc": "아케이드 레이스 3위 안"},
    "item_master":     {"name": "🎁 아이템 마스터", "desc": "한 레이스에서 아이템 5개 사용"},
    "early_bird":      {"name": "🌅 아침 라이더",   "desc": "오전 5~8시에 라이딩"},
    "night_owl":       {"name": "🌙 야간 라이더",   "desc": "밤 10시 이후에 라이딩"},
    "streak_14":       {"name": "🔥🔥🔥 2주 연속",  "desc": "14일 연속 라이딩"},
    "total_500km":     {"name": "🌏 500km 돌파",   "desc": "누적 거리 500km"},
}
STAGE_COUNT = 5

# 업적 화면 탭. 25개가 한 줄로 늘어서면 찾기 어려워 묶어서 보여준다.
CATEGORIES = [("distance", "거리"), ("intensity", "강도"), ("stage", "스테이지"),
              ("arcade", "아케이드"), ("habit", "습관")]
_BY_CATEGORY = {
    "distance":  ["5km_club", "10km_club", "20km_club", "total_100km", "total_500km"],
    "intensity": ["speed_demon", "calorie_burner", "rpm_machine", "spin_master"],
    "stage":     ["three_stars", "ghost_buster", "non_stop", "all_stages", "all_three_stars"],
    "arcade":    ["arcade_win", "podium", "coin_collector", "dog_escape", "item_master"],
    "habit":     ["first_ride", "streak_3", "streak_7", "streak_14", "early_bird", "night_owl"],
}
for _cat, _ids in _BY_CATEGORY.items():
    for _aid in _ids:
        ACHIEVEMENTS[_aid]["cat"] = _cat


def check_live(distance_m: float, max_speed: float, calories: float) -> list[str]:
    """플레이 중 달성 순간 알리는 업적."""
    ids = []
    if distance_m >= 5000:
        ids.append("5km_club")
    if distance_m >= 10000:
        ids.append("10km_club")
    if max_speed >= 40:
        ids.append("speed_demon")
    if distance_m >= 20000:
        ids.append("20km_club")
    if calories >= 150:
        ids.append("calorie_burner")
    return ids


def check_session_end(summary: dict, records) -> list[str]:
    """기록 저장 직후 체크. summary: 저장된 기록 + ghost_won."""
    ids = ["first_ride"]
    avg_rpm = summary.get("avg_rpm") or 0
    if summary["elapsed_sec"] >= 300 and avg_rpm >= 80:
        ids.append("rpm_machine")
    if summary["elapsed_sec"] >= 600 and avg_rpm >= 100:
        ids.append("spin_master")
    hour = summary.get("hour")
    if hour is not None:
        if 5 <= hour < 8:
            ids.append("early_bird")
        elif hour >= 22 or hour < 3:
            ids.append("night_owl")
    if summary.get("stars") == 3:
        ids.append("three_stars")
    if summary.get("mode") == "stage" and summary.get("finished"):
        if summary.get("coast_time", 99) < 5:
            ids.append("non_stop")
        bests = records.stage_bests()
        if len(bests) >= STAGE_COUNT:
            ids.append("all_stages")
            if all((b.get("best_stars") or 0) >= 3 for b in bests.values()):
                ids.append("all_three_stars")
    if summary.get("ghost_won"):
        ids.append("ghost_buster")
    if summary.get("mode") == "arcade" and summary.get("finished"):
        rank = summary.get("rank")
        if rank == 1:
            ids.append("arcade_win")
        if rank is not None and rank <= 3:
            ids.append("podium")
    if (summary.get("items_used") or 0) >= 5:
        ids.append("item_master")
    streak = records.streak_days()
    if streak >= 3:
        ids.append("streak_3")
    if streak >= 7:
        ids.append("streak_7")
    if streak >= 14:
        ids.append("streak_14")
    stats = records.stats()
    if stats["total_distance_m"] >= 100_000:
        ids.append("total_100km")
    if stats["total_distance_m"] >= 500_000:
        ids.append("total_500km")
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
