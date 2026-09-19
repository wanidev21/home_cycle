import asyncio
import socket
from datetime import datetime
from pathlib import Path


def data_dir() -> Path:
    d = Path.home() / ".pedalquest"
    d.mkdir(parents=True, exist_ok=True)
    return d


def now_local_iso() -> str:
    """SQLite CURRENT_TIMESTAMP(UTC) 대신 로컬 시간."""
    return datetime.now().isoformat(timespec="seconds")


def log_task_error(task: asyncio.Task):
    """백그라운드 task 예외가 조용히 묻히지 않게."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc:
        print(f"❌ 백그라운드 작업 오류: {exc!r}")


def get_lan_ip() -> str:
    """실제 와이파이 IP. gethostbyname(gethostname())은 Windows에서
    WSL/Hyper-V/VPN 가상 어댑터 IP를 돌려주는 경우가 많아 쓰지 않는다."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # UDP라 실제 패킷은 안 나감. 라우팅 조회만
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()
