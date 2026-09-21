import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path

from .util import data_dir, now_local_iso

SCHEMA = """
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL,
    stage_id INTEGER,
    distance_m REAL NOT NULL,
    elapsed_sec REAL NOT NULL,
    avg_speed REAL,
    max_speed REAL,
    avg_rpm REAL,
    calories REAL,
    stars INTEGER,
    finished INTEGER DEFAULT 0,
    coins INTEGER,
    rank INTEGER,
    session_log TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS achievements (
    id TEXT PRIMARY KEY,
    unlocked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total_distance_m REAL DEFAULT 0,
    total_calories REAL DEFAULT 0,
    total_sessions INTEGER DEFAULT 0,
    total_time_sec REAL DEFAULT 0
);
INSERT OR IGNORE INTO stats (id) VALUES (1);
"""

MIN_SAVE_DISTANCE_M = 200
MIN_SAVE_ELAPSED_SEC = 60


def should_save(distance_m: float, elapsed_sec: float) -> bool:
    return distance_m >= MIN_SAVE_DISTANCE_M and elapsed_sec >= MIN_SAVE_ELAPSED_SEC


class Records:
    def __init__(self, db_path: Path | str | None = None):
        self.db_path = str(db_path or data_dir() / "records.db")
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self._migrate()
        self.conn.commit()

    def _migrate(self):
        """예전 DB에 새 컬럼 추가."""
        cols = {r["name"] for r in self.conn.execute("PRAGMA table_info(records)")}
        for name in ("coins", "rank"):
            if name not in cols:
                self.conn.execute(f"ALTER TABLE records ADD COLUMN {name} INTEGER")

    def close(self):
        self.conn.close()

    # --- 기록 ---
    def save_record(self, rec: dict, created_at: str | None = None) -> int:
        created_at = created_at or now_local_iso()
        cur = self.conn.execute(
            """INSERT INTO records (mode, stage_id, distance_m, elapsed_sec, avg_speed, max_speed,
                   avg_rpm, calories, stars, finished, coins, rank, session_log, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                rec["mode"], rec.get("stage_id"), rec["distance_m"], rec["elapsed_sec"],
                rec.get("avg_speed"), rec.get("max_speed"), rec.get("avg_rpm"), rec.get("calories"),
                rec.get("stars"), int(bool(rec.get("finished"))), rec.get("coins"), rec.get("rank"),
                json.dumps([int(round(x)) for x in (rec.get("session_log") or [])]), created_at,
            ),
        )
        if rec.get("stage_id") and rec.get("finished"):
            self._prune_ghost_logs(rec["stage_id"])
        self.conn.execute(
            """UPDATE stats SET total_distance_m = total_distance_m + ?,
                   total_calories = total_calories + ?, total_sessions = total_sessions + 1,
                   total_time_sec = total_time_sec + ? WHERE id = 1""",
            (rec["distance_m"], rec.get("calories") or 0, rec["elapsed_sec"]),
        )
        self.conn.commit()
        return cur.lastrowid

    def _prune_ghost_logs(self, stage_id: int):
        """고스트로 쓰이는 건 스테이지별 최고 기록 하나뿐이다. 나머지 로그는 버려서
        DB가 세션마다 10KB씩 불어나지 않게 한다."""
        self.conn.execute(
            """UPDATE records SET session_log='[]'
               WHERE mode='stage' AND stage_id=? AND session_log != '[]'
                 AND id != (SELECT id FROM records WHERE mode='stage' AND stage_id=? AND finished=1
                            ORDER BY elapsed_sec ASC, id ASC LIMIT 1)""",
            (stage_id, stage_id),
        )

    def list_records(self, limit: int = 50) -> list[dict]:
        rows = self.conn.execute(
            """SELECT id, mode, stage_id, distance_m, elapsed_sec, avg_speed, max_speed, avg_rpm,
                      calories, stars, finished, coins, rank, created_at
               FROM records ORDER BY id DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def best_stage_record(self, stage_id: int) -> dict | None:
        """완주한 기록 중 가장 빠른 것 (고스트용, session_log 포함)."""
        row = self.conn.execute(
            """SELECT * FROM records WHERE mode='stage' AND stage_id=? AND finished=1
               ORDER BY elapsed_sec ASC LIMIT 1""",
            (stage_id,),
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["session_log"] = json.loads(d["session_log"] or "[]")
        return d

    def stage_bests(self) -> dict[int, dict]:
        rows = self.conn.execute(
            """SELECT stage_id, MIN(elapsed_sec) AS best_sec, MAX(stars) AS best_stars
               FROM records WHERE mode='stage' AND finished=1 GROUP BY stage_id"""
        ).fetchall()
        return {r["stage_id"]: {"best_sec": r["best_sec"], "best_stars": r["best_stars"]} for r in rows}

    def recent_avg_rpm(self, limit: int = 5, default: float = 65.0) -> float:
        """AI 라이벌 난이도용: 최근 세션들의 평균 페달링 RPM.
        홈싸이클은 110 RPM대도 흔하므로 상한을 넉넉히 둔다 (예전 100 상한은 라이벌을
        실제 실력보다 약하게 만들었다)."""
        rows = self.conn.execute(
            "SELECT avg_rpm FROM records WHERE avg_rpm > 0 ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        if not rows:
            return default
        return max(45.0, min(135.0, sum(r["avg_rpm"] for r in rows) / len(rows)))

    # --- 업적 ---
    def unlock(self, achievement_id: str) -> bool:
        """새로 해금했으면 True."""
        cur = self.conn.execute(
            "INSERT OR IGNORE INTO achievements (id, unlocked_at) VALUES (?, ?)",
            (achievement_id, now_local_iso()),
        )
        self.conn.commit()
        return cur.rowcount > 0

    def unlocked(self) -> dict[str, str]:
        return {r["id"]: r["unlocked_at"] for r in self.conn.execute("SELECT * FROM achievements")}

    # --- 통계 ---
    def ride_dates(self) -> set[date]:
        rows = self.conn.execute("SELECT DISTINCT substr(created_at, 1, 10) AS d FROM records")
        return {date.fromisoformat(r["d"]) for r in rows}

    def streak_days(self, today: date | None = None) -> int:
        """오늘(오늘 안 탔으면 어제)부터 거꾸로 연속으로 탄 날 수."""
        today = today or date.today()
        dates = self.ride_dates()
        day = today if today in dates else today - timedelta(days=1)
        n = 0
        while day in dates:
            n += 1
            day -= timedelta(days=1)
        return n

    def today_distance_m(self, today: date | None = None) -> float:
        today = today or date.today()
        row = self.conn.execute(
            "SELECT COALESCE(SUM(distance_m), 0) AS s FROM records WHERE substr(created_at, 1, 10) = ?",
            (today.isoformat(),),
        ).fetchone()
        return row["s"]

    def stats(self) -> dict:
        d = dict(self.conn.execute("SELECT * FROM stats WHERE id = 1").fetchone())
        d.pop("id")
        d["today_distance_m"] = self.today_distance_m()
        d["streak_days"] = self.streak_days()
        d["total_coins"] = self.conn.execute("SELECT COALESCE(SUM(coins), 0) AS c FROM records").fetchone()["c"]
        return d
