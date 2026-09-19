import json
from dataclasses import dataclass, field, asdict
from pathlib import Path

from .util import data_dir


@dataclass
class GameConfig:
    tick_rate: int = 30
    speed_multiplier: float = 1.0


@dataclass
class Config:
    web_port: int = 18400
    sensor_address: str | None = None
    user_weight_kg: float = 70
    game: GameConfig = field(default_factory=GameConfig)
    path: Path | None = field(default=None, repr=False, compare=False)

    @classmethod
    def load(cls, path: Path | None = None) -> "Config":
        path = path or data_dir() / "config.json"
        cfg = cls(path=path)
        if path.exists():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as e:
                print(f"⚠ 설정 파일을 읽을 수 없어 기본값 사용: {e}")
                raw = {}
            cfg.web_port = int(raw.get("web_port", cfg.web_port))
            cfg.sensor_address = raw.get("sensor_address")
            cfg.user_weight_kg = float(raw.get("user_weight_kg", cfg.user_weight_kg))
            g = raw.get("game", {})
            cfg.game = GameConfig(
                tick_rate=int(g.get("tick_rate", 30)),
                speed_multiplier=float(g.get("speed_multiplier", 1.0)),
            )
        else:
            cfg.save()
        return cfg

    def save(self):
        if not self.path:
            return
        data = asdict(self)
        data.pop("path")
        self.path.write_text(json.dumps(data, ensure_ascii=False, indent=4), encoding="utf-8")
