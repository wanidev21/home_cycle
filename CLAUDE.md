# PedalQuest - 실내 싸이클 게임

## 프로젝트 개요

일반 실내 홈싸이클에 BLE 케이던스 센서를 달고, 페달을 밟으면 화면 속 자전거가 달리는 게임.
PC가 센서 데이터를 받아 게임을 돌리고, 태블릿 브라우저에서 플레이.
싸이클 앞에 태블릿을 거치하고 페달만 밟으면 된다.

**LLM/외부 API 없음. 유일한 추가 하드웨어: BLE 케이던스 센서 1개.**
(나중에 추가할 "AI 라이벌"은 규칙 기반 컴퓨터 선수이며 LLM이 아님 → 맨 아래 "향후 계획")

**핵심 플로우:**
```
페달 밟기 → BLE 센서가 크랭크 회전 감지 → PC가 블루투스로 누적 회전수 수신
→ CadenceCalculator가 RPM 계산 → 게임 엔진이 관성 물리로 속도/거리 계산
→ WebSocket으로 태블릿에 전송 → 태블릿 브라우저 Canvas에서 1인칭(핸들바) 시점 렌더링
```

## 핵심 원칙

- **진짜 타는 느낌**: 이 프로젝트의 최우선 목표. 아래 세 가지가 핵심.
  - **관성**: 페달을 멈추면 뚝 서지 않고 서서히 감속. 내리막은 안 밟아도 굴러간다. 오르막은 금방 선다.
  - **시점**: 기본은 **1인칭**(내 핸들바와 손, 페달 박자에 맞춰 올라오는 무릎). `V`키/시점 버튼으로 뒤에서 보는 시점과 전환. 둘 다 의사 3D(pseudo-3D)라 언덕이 눈에 보인다.
  - **동기화**: 화면 속 다리 회전이 내 실제 RPM과 일치. 속도에 따라 바람 소리가 커진다.
- **페달 = 유일한 입력**: RPM이 목표 속도를 결정. 메뉴 조작만 터치.
- **태블릿 브라우저**: 앱 설치 없음. 같은 와이파이에서 브라우저 열고 주소 입력하면 끝.
- **짧은 세션**: 한 판 10~20분. 스테이지 기준 시간도 이 범위에 맞춤.
- **기록이 쌓이는 재미**: 오늘 얼마나 탔는지, 최고 속도, 총 거리, 업적, 고스트.
- **센서 없이 개발 가능**: mock 모드는 **실제 센서와 같은 형식의 데이터(누적 회전수, 1Hz)** 를 만들어 같은 계산 경로를 탄다. 그래야 mock에서 통과한 게 실제 센서에서도 동작한다.

## 하드웨어 요구사항

| 항목 | 필요 여부 | 설명 | 예상 가격 |
|------|----------|------|----------|
| BLE 케이던스 센서 | 필수 | **XOSS G+ (보유, 쿠팡)**. BLE+ANT+ 듀얼, 표준 CSC 서비스(0x1816). 표준 CSC면 어떤 브랜드든 동작 | - |
| PC 블루투스 | 필수 | 현재 PC: Broadcom BCM20702 (BT 4.0 USB) — BLE 지원, 사용 가능 | 0원 |
| 태블릿 | 필수 | 와이파이 + 브라우저만 되면 OK. 이미 보유 | 0원 |
| 태블릿 거치대 | 권장 | 싸이클 핸들에 부착 | ~10,000원 |

**센서 부착:** XOSS G+를 크랭크 암(페달 연결 봉)에 고무밴드로 고정. 자석 불필요 (가속도 센서 내장).
**센서 모드:** XOSS G+는 속도/케이던스 겸용. **반드시 케이던스 모드**여야 크랭크 데이터가 나온다 (모드 전환 방법은 제품 설명서 확인). 속도 모드면 연결은 되는데 RPM이 안 나온다 → 서버 로그에 "크랭크 데이터 없음" 경고 출력. 진단: `.venv\Scripts\python tools\sensor_check.py` (페달 돌리며 실행 → 원시 crank/wheel 값 출력).

## 기술 스택

- **Python 3.13** (전용 venv) — 이 PC에는 Microsoft Store판 3.13이 설치돼 있음
- **pycycling 0.4.1**: CSC 측정값 파서 (`CyclingSpeedCadenceService`)
- **bleak 3.x**: BLE 통신
- **FastAPI + uvicorn**: 게임 서버
- **websockets**: 실시간 게임 상태 전송
- **HTML5 Canvas + JavaScript + Web Audio API**: 렌더링/사운드 (이미지·사운드 파일 없이 코드로 그림)
- **SQLite**: 기록/업적 저장

### requirements.txt

```
pycycling>=0.4.1
bleak>=3.0,<4
fastapi>=0.110.0
uvicorn>=0.29.0
jinja2>=3.1.0
websockets>=12.0
pytest>=8.0
```

> ⚠ bleak은 버전마다 API가 크게 바뀌었다 (`BLEDevice.metadata` 제거 등). 아래 코드는 **pycycling 0.4.1 + bleak 3.0.2 소스를 직접 확인**하고 작성함. 인터넷 예제 코드(구버전 API)를 그대로 가져오지 말 것.

### 환경 세팅 (Windows)

```powershell
py -3.13 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 아키텍처

```
  [실내 싸이클]
       │
  [BLE 센서 (XOSS G+)]
       │ Bluetooth Low Energy (약 1Hz 알림)
       ▼
  ┌─────────────────────────────────────────┐
  │               PC (서버)                  │
  │                                         │
  │  ┌─────────────┐  get_rpm()  ┌────────┐ │
  │  │ sensor.py    │◀───────────│game.py │ │
  │  │ BLE 수신     │   (매 틱)   │관성물리 │ │
  │  │ + Cadence    │            └───┬────┘ │
  │  │   Calculator │                │      │
  │  └─────────────┘         ┌──────▼─────┐ │
  │                          │ server.py  │ │
  │                          │ WS 30fps   │ │
  │                          └──────┬─────┘ │
  └─────────────────────────────────┼───────┘
                                    │ WiFi (ws://PC아이피:18400/ws)
                                    ▼
                          ┌──────────────────┐
                          │  태블릿 브라우저   │
                          │  pseudo-3D Canvas │
                          └──────────────────┘
```

**센서 → 엔진은 pull 방식.** 엔진이 매 틱 `sensor.get_rpm()`을 호출한다. 센서는 페달을 멈추면 알림을 안 보내거나 같은 값만 보내므로, push 콜백 방식으로는 "정지"를 감지할 수 없다. `get_rpm()`이 PC 시계 기준 타임아웃으로 0을 돌려준다.

**pywebview 사용 안 함.** PC는 터미널에서 서버만 실행. 화면은 태블릿 브라우저.

### main.py

```python
import sys
import socket
import asyncio
import uvicorn
from pedalquest.config import Config
from pedalquest.records import Records
from pedalquest.sensor import SensorManager, MockSensorManager
from pedalquest.game import GameEngine
from pedalquest.server import create_app


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


def log_task_error(task: asyncio.Task):
    """백그라운드 task 예외가 조용히 묻히지 않게."""
    if not task.cancelled() and task.exception():
        print(f"❌ 백그라운드 작업 오류: {task.exception()!r}")


async def main():
    config = Config.load()
    records = Records()
    mock = "--mock" in sys.argv

    if mock:
        print("⚠ Mock 모드: 센서 없이 키보드(↑↓)로 테스트")
        sensor = MockSensorManager()
    else:
        sensor = SensorManager(config)

    game = GameEngine(config, sensor, records)
    app = create_app(config, game, sensor, records, mock=mock)

    sensor.start()  # 내부에서 task 생성, 재스캔 시 task 교체
    game_task = asyncio.create_task(game.run_loop())
    game_task.add_done_callback(log_task_error)

    ip = get_lan_ip()
    print(f"\n🚴 PedalQuest 서버 시작!")
    print(f"📱 태블릿에서 접속: http://{ip}:{config.web_port}")
    print(f"💻 PC에서 접속: http://localhost:{config.web_port}")
    print(f"\nCtrl+C로 종료\n")

    server = uvicorn.Server(uvicorn.Config(
        app, host="0.0.0.0", port=config.web_port, log_level="warning"
    ))
    try:
        await server.serve()
    finally:
        await sensor.stop()
        game_task.cancel()


if __name__ == "__main__":
    asyncio.run(main())
```

## BLE 센서 (sensor.py)

### CadenceCalculator (순수 로직, 단위 테스트 대상)

CSC 측정값의 크랭크 데이터는 두 값이다:
- `cumulative_crank_revs`: 누적 회전수 (**16비트**, 65536에서 0으로 돌아감)
- `last_crank_event_time`: **마지막으로 크랭크가 돈 시각** (1/1024초, **16비트**, 약 64초마다 돌아감). 현재 시각이 아님!

그래서 페달을 멈추면 같은 값이 반복되거나 알림이 끊긴다 → 센서 데이터만으로는 정지를 알 수 없고, **PC 시계로 판단**해야 한다.

```python
import time


class CadenceCalculator:
    """CSC 누적 크랭크 데이터 → RPM."""
    STOP_TIMEOUT_MIN = 2.5   # 초. 이 시간 동안 회전 증가가 없으면 정지
    STOP_TIMEOUT_MAX = 4.0   # 느린 회전(저RPM)은 주기×1.5까지 기다리되 상한
    RESET_GAP = 30.0         # 오래 쉬었다 다시 밟으면 기준점 재설정 (시간 오버플로우로 인한 RPM 튐 방지)
    MAX_RPM = 200.0

    def __init__(self):
        self.reset()

    def reset(self):
        """재연결 시 반드시 호출."""
        self._revs = None
        self._evt = None
        self._last_inc_wall = None  # 회전수가 마지막으로 증가한 PC 시각
        self._period = None         # 최근 1회전 주기(초)
        self._rpm = 0.0

    def feed(self, revs, event_time, now=None):
        now = time.monotonic() if now is None else now
        if revs is None or event_time is None:
            return
        stale = self._last_inc_wall is not None and now - self._last_inc_wall > self.RESET_GAP
        if self._revs is None or stale:
            if self._revs is None or revs != self._revs:
                self._revs, self._evt, self._last_inc_wall = revs, event_time, now
            return
        rev_diff = (revs - self._revs) % 65536
        if rev_diff == 0:
            return  # 같은 데이터 반복 (정지 중이거나 아직 1회전 미만)
        time_diff = ((event_time - self._evt) % 65536) / 1024.0
        self._revs, self._evt, self._last_inc_wall = revs, event_time, now
        if time_diff <= 0 or rev_diff > 20:
            return  # 비정상 값 무시
        rpm = rev_diff / time_diff * 60.0
        if rpm <= self.MAX_RPM:
            self._rpm = rpm
            self._period = time_diff / rev_diff

    def get_rpm(self, now=None) -> float:
        now = time.monotonic() if now is None else now
        if self._last_inc_wall is None:
            return 0.0
        timeout = self.STOP_TIMEOUT_MIN
        if self._period:
            timeout = min(self.STOP_TIMEOUT_MAX, max(timeout, self._period * 1.5))
        if now - self._last_inc_wall > timeout:
            self._rpm = 0.0
        return self._rpm
```

검증 완료된 시나리오 (tests/test_cadence.py로 옮길 것):
- 80 RPM 연속 + 회전수/시간 **동시 16비트 오버플로우** → 80 유지
- 페달 정지 → 약 3초 후 0
- 70초 휴식 후 90 RPM 재개 → 튀는 값 없이 90
- 60 / 30 RPM 전환 → 정상 반영

### 실제 센서 (SensorManager)

```python
import asyncio
from bleak import BleakClient, BleakScanner
from pycycling.cycling_speed_cadence_service import CyclingSpeedCadenceService

CSC_SERVICE_UUID = "00001816-0000-1000-8000-00805f9b34fb"


class SensorManager:
    def __init__(self, config):
        self.config = config
        self.calc = CadenceCalculator()
        self.connected = False
        self.status_msg = "대기"
        self._task: asyncio.Task | None = None
        self._crank_warned = False

    # --- 수명 관리 ---
    def start(self):
        self._task = asyncio.create_task(self._run())
        self._task.add_done_callback(log_task_error)

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def rescan(self):
        """POST /api/sensor/scan. 연결 루프와 스캔이 동시에 돌면 Windows BLE가 오류를 내므로
        기존 task를 완전히 멈춘 뒤 저장된 주소를 지우고 다시 시작."""
        await self.stop()
        self.config.sensor_address = None
        self.config.save()
        self.start()

    # --- 스캔 ---
    async def scan_for_sensor(self) -> str | None:
        self.status_msg = "센서 검색 중 (페달을 돌려주세요)"
        print("🔍 BLE 센서 검색 중... (페달을 몇 바퀴 돌려주세요)")
        found = await BleakScanner.discover(timeout=10, return_adv=True)
        for device, adv in found.values():
            uuids = [u.lower() for u in (adv.service_uuids or [])]
            # 이름 매칭은 쓰지 않는다: "s3", "cad" 같은 문자열은 다른 기기 이름과 겹친다
            if CSC_SERVICE_UUID in uuids:
                print(f"✅ 센서 발견: {device.name} ({device.address})")
                return device.address
        print("❌ 센서를 찾을 수 없습니다. 5초 후 재시도")
        return None

    # --- 연결 루프 ---
    async def _run(self):
        address = self.config.sensor_address
        while not address:
            address = await self.scan_for_sensor()
            if not address:
                await asyncio.sleep(5)
        self.config.sensor_address = address   # 다음 실행부터 스캔 생략
        self.config.save()

        while True:
            try:
                self.status_msg = "연결 중"
                async with BleakClient(address, timeout=15) as client:
                    self.calc.reset()
                    csc = CyclingSpeedCadenceService(client)
                    csc.set_csc_measurement_handler(self._on_measurement)
                    await csc.enable_csc_measurement_notifications()
                    self.connected = True
                    self.status_msg = "연결됨"
                    print(f"🔗 센서 연결됨: {address}")
                    while client.is_connected:
                        await asyncio.sleep(0.5)
                print("⚠ 센서 연결 끊김, 재연결 시도...")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"⚠ 센서 오류: {e!r}, 5초 후 재연결...")
            self.connected = False
            self.status_msg = "재연결 중"
            await asyncio.sleep(5)

    def _on_measurement(self, m):
        # pycycling CSCMeasurement 필드: cumulative_wheel_revs, last_wheel_event_time,
        #                               cumulative_crank_revs, last_crank_event_time
        if m.cumulative_crank_revs is None:
            if not self._crank_warned:
                print("⚠ 크랭크 데이터 없음 — 센서가 속도 모드일 수 있습니다. 케이던스 모드로 바꿔주세요.")
                self._crank_warned = True
            return
        self.calc.feed(m.cumulative_crank_revs, m.last_crank_event_time)

    # --- 조회 ---
    def get_rpm(self) -> float:
        return self.calc.get_rpm()

    def get_status(self) -> dict:
        return {"connected": self.connected, "message": self.status_msg,
                "cadence_rpm": round(self.get_rpm(), 1)}
```

> `log_task_error`는 공용 유틸(예: `pedalquest/util.py`)로 두고 main.py와 공유.

### Mock 센서 (개발용)

실제 센서처럼 **누적 회전수 + 이벤트 시각을 약 1Hz로 만들어** 같은 `CadenceCalculator`에 넣는다.

```python
import time


class MockSensorManager:
    def __init__(self):
        self.calc = CadenceCalculator()
        self.target_rpm = 0.0
        self.connected = True
        self._revs = 0
        self._evt = 0
        self._task = None

    def start(self):
        self._task = asyncio.create_task(self._run())
        self._task.add_done_callback(log_task_error)

    async def stop(self):
        if self._task:
            self._task.cancel()

    async def rescan(self):
        pass

    def set_rpm(self, rpm: float):   # WebSocket {"command": "mock_rpm"}
        self.target_rpm = max(0.0, min(150.0, rpm))

    async def _run(self):
        next_rev = None
        while True:
            now = time.monotonic()
            if self.target_rpm > 0:
                period = 60.0 / self.target_rpm
                if next_rev is None:
                    next_rev = now + period
                while next_rev <= now:
                    self._revs = (self._revs + 1) % 65536
                    self._evt = int(next_rev * 1024) % 65536
                    next_rev += period
            else:
                next_rev = None
            self.calc.feed(self._revs, self._evt, now)
            await asyncio.sleep(1.0)   # 실제 센서와 같은 알림 주기

    def get_rpm(self) -> float:
        return self.calc.get_rpm()

    def get_status(self) -> dict:
        return {"connected": True, "message": "Mock", "cadence_rpm": round(self.get_rpm(), 1)}
```

## 게임 콘셉트

### 모드 1: 프리 라이딩 (기본)
끝없는 길. 거리에 따라 테마가 바뀐다 (도시 → 교외 → 산길 → 해변 → 반복).
산길 구간은 완만한 오르막/내리막이 1km마다 번갈아 나온다 (factor 0.85 ↔ 1.15).
**자동 일시정지:** 속도 0이 5초 지속되면 paused, 다시 밟으면 자동 재개.

### 모드 2: 스테이지 챌린지
정해진 거리를 완주. 지형(오르막/내리막)이 있고, 완주 시간으로 ★~★★★.
자동 일시정지 없음 (시간이 계속 흐름). 수동 일시정지는 허용.
**고스트 옵션:** 해당 스테이지에 기록이 있으면 "내 최고 기록 고스트와 경쟁"을 켤 수 있다.

별 기준은 관성 물리를 포함해 **일정 RPM으로 탔을 때의 완주 시간**을 시뮬레이션해서 정함:
★★★ = 평균 75 RPM, ★★ = 60 RPM, ★ = 45 RPM (스프린트만 90/75/60).

| 스테이지 | 이름 | 거리 | 특징 | ★★★ | ★★ | ★ |
|---------|------|------|------|-----|-----|---|
| 1 | 🌆 도시 평지 | 3km | 워밍업, 전 구간 평지 | 7:00 | 8:30 | 10:30 |
| 2 | 🌄 언덕길 | 3km | 중반 오르막 → 후반 내리막 | 8:00 | 9:30 | 12:00 |
| 3 | ⛰ 산악 코스 | 5km | 오르막·내리막 연속 | 14:00 | 16:30 | 21:00 |
| 4 | ⚡ 스프린트 | 2km | 짧고 빠르게 | 4:10 | 4:40 | 5:30 |
| 5 | 🏆 그란폰도 | 7km | 끝까지 버텨라. 마지막 0.5km 급오르막 | 18:00 | 21:00 | 26:30 |

★ 기준 시간 안에 못 들어와도 완주는 기록된다 (stars=0).

### 모드 3: 고스트 (스테이지 옵션)
고스트 = 같은 스테이지 **최고 기록**의 `session_log`(1초 간격 누적 거리)를 재생하는 반투명 자전거.
- 고스트보다 먼저 완주 → 승리 (`ghost_buster` 업적)
- 추월/추월당함 순간 이벤트 + 화면 효과
- 프리 라이딩에는 고스트 없음 (비교 기준이 없으므로)

### 모드 4: 🍄 아케이드 레이스 (arcade.py)
스테이지 코스(1~5) 위에서 AI 라이벌 5명과 경주. 마리오카트 스타일 요소. **달리는 중 입력은 페달뿐**이라는 원칙에 맞춰 설계.
- **카운트다운** 3초 → 출발 (state `"countdown"`)
- **AI 라이벌:** 규칙 기반. 실력 = 최근 5세션 평균 RPM × (0.86~1.12). 성격: 오르막 강자 / 막판 스퍼터 / 꾸준형 / 초반 질주형.
  **고무줄 효과:** ±30m 밖이면 거리에 비례해 뒤처진 라이벌 최대 +40%, 앞선 라이벌 최대 −25% → 평소 페이스면 끝까지 접전.
- **아이템 박스** 450m마다. 순위가 낮을수록 강한 아이템 (⭐무적, ⚡번개). 라이벌도 터보·바나나 사용.
- **아이템 사용 = 페달 스퍼트:** 평소 RPM(20초 이동평균)보다 max(×1.2, +12) 이상을 **2초 유지**. 아이템 칸 터치 / PC `Enter`도 가능.
- 아이템: 🚀터보(5초 +35%) · 🍌바나나 · 🛡바람막이(12초 오르막 절반+방어) · 🧲자석(6초) · ⭐무적(8초, 부딪힌 라이벌 튕김) · ⚡번개(앞선 라이벌 3초 감속)
- **코인** 240m마다 3개, 12km/h 이상으로 지나가야 획득. 1개당 속도 +1% (최대 10%). 미끄러지면 −3.
- **부스트 발판** 700m마다 2초 +30% · **드래프팅** 앞 선수 1.5~10m 뒤 +8%
- **🐕 개 추격** 코스당 1~2회: 12m 뒤에서 (내 평소 속도×1.25)로 12초 추격. 잡히면 미끄러짐+코인 −3, 따돌리면 코인 +5.
- 기록은 mode `"arcade"`로 저장(coins, rank 포함). **스테이지 최고기록·고스트와 분리.** 속도 업적(스피드 데몬) 제외.
- 업적 추가: 🏁 첫 우승, 🪙 코인 수집가(누적 100), 🐕 탈출 성공

### Mock 기록 분리
`--mock` 실행 시 `records-mock.db`를 사용. 키보드 테스트 기록이 실제 기록을 오염시키지 않는다.

## 게임 엔진 (game.py)

### RPM → 목표 속도

```python
import math

def target_speed(rpm: float, terrain_factor: float = 1.0) -> float:
    """
    RPM → 목표 km/h. 로그 곡선: 고RPM일수록 증가폭이 줄어듦 (공기저항 느낌).
      20 RPM →  8.9    40 RPM → 16.2    60 RPM → 22.4
      80 RPM → 27.7   100 RPM → 32.4   120 RPM → 36.7   150 RPM → 42.2
    terrain_factor: 1.0=평지, <1 오르막, >1 내리막
    내리막은 안 밟아도 (factor-1)*50 km/h로 굴러간다 (factor 1.4 → 20km/h).
    """
    base = 40 * math.log(rpm / 80 + 1) if rpm > 0 else 0.0
    coast = max(0.0, (terrain_factor - 1.0) * 50)
    return max(base * terrain_factor, coast)
```

### 관성 물리 (매 틱)

```python
ACCEL = 3.0        # km/h/s  가속
COAST_DECEL = 2.0  # km/h/s  평지에서 페달 멈췄을 때 감속 (25km/h → 약 12초 후 정지)

def step_speed(speed: float, rpm: float, terrain_factor: float, dt: float) -> float:
    tgt = target_speed(rpm, terrain_factor)
    if tgt > speed:
        return min(tgt, speed + ACCEL * dt)
    if rpm == 0:
        if terrain_factor > 1.0:
            decel = 1.0                                          # 내리막: 천천히
        else:
            decel = COAST_DECEL + (1.0 - terrain_factor) * 8     # 오르막: 빨리 선다
    else:
        decel = ACCEL                                            # 밟는 중 RPM만 낮춤
    return max(tgt, speed - decel * dt)
```

상수들은 실제 타보면서 조정. 조정하면 스테이지 별 기준도 다시 시뮬레이션할 것.

### 루프 규칙

- 틱: `tick_rate`(30Hz). `dt`는 실측 시간 사용 (`time.monotonic()` 차이), 과도한 dt는 0.1초로 제한.
- 거리: `distance_m += speed_kmh / 3.6 * dt * speed_multiplier`
- 경과 시간: playing 상태에서만 증가
- 평균 RPM: **페달링 중(rpm>0)인 시간만** 평균 (쉬는 시간이 평균을 깎지 않게)
- `session_log`: 1초마다 누적 거리(m) 기록 → 고스트용
- 기록 저장 조건: 거리 200m 이상 **그리고** 경과 60초 이상 (실수로 누른 시작/종료 제외)

### 칼로리

```python
def calc_calories(rpm: float, seconds: float, weight_kg: float = 70) -> float:
    """MET 기반 추정 (정확하지 않음, 재미용)"""
    if rpm <= 0:
        return 0.0
    met = 3.5 if rpm < 40 else 5.5 if rpm < 60 else 6.8 if rpm < 80 else 8.5 if rpm < 100 else 10.0
    return met * weight_kg * 3.5 / 200 / 60 * seconds
```

### 스테이지 지형 데이터

```python
STAGES = {
    1: {
        "name": "🌆 도시 평지", "distance_m": 3000, "theme": "city",
        "terrain": [{"end_km": 3.0, "factor": 1.0}],
        "stars": {"3": 420, "2": 510, "1": 630},
    },
    2: {
        "name": "🌄 언덕길", "distance_m": 3000, "theme": "suburb",
        "terrain": [
            {"end_km": 1.0, "factor": 1.0},
            {"end_km": 2.0, "factor": 0.6},
            {"end_km": 3.0, "factor": 1.3},
        ],
        "stars": {"3": 480, "2": 570, "1": 720},
    },
    3: {
        "name": "⛰ 산악 코스", "distance_m": 5000, "theme": "mountain",
        "terrain": [
            {"end_km": 1.0, "factor": 1.0},
            {"end_km": 2.5, "factor": 0.6},
            {"end_km": 3.5, "factor": 1.4},
            {"end_km": 4.5, "factor": 0.7},
            {"end_km": 5.0, "factor": 1.2},
        ],
        "stars": {"3": 840, "2": 990, "1": 1260},
    },
    4: {
        "name": "⚡ 스프린트", "distance_m": 2000, "theme": "city",
        "terrain": [{"end_km": 2.0, "factor": 1.0}],
        "stars": {"3": 250, "2": 280, "1": 330},
    },
    5: {
        "name": "🏆 그란폰도", "distance_m": 7000, "theme": "beach",
        "terrain": [
            {"end_km": 1.5, "factor": 1.0},
            {"end_km": 3.0, "factor": 0.8},
            {"end_km": 4.0, "factor": 1.3},
            {"end_km": 5.5, "factor": 0.85},
            {"end_km": 6.5, "factor": 1.0},
            {"end_km": 7.0, "factor": 0.6},
        ],
        "stars": {"3": 1080, "2": 1260, "1": 1590},
    },
}
```

지형 경계에서 factor가 뚝 바뀌면 어색하므로 **경계 앞뒤 50m는 선형 보간**.

### 게임 상태 (WebSocket, 30fps)

`riders`는 나 외의 선수 목록. 지금은 고스트만 들어가지만, 나중에 AI 라이벌도 같은 형식으로 추가한다.

```python
def get_state(self) -> dict:
    return {
        "type": "state",
        "mode": self.mode,               # "free", "stage"
        "state": self.state,             # "waiting", "playing", "paused", "finished"
        "sensor": self.sensor.get_status(),
        "cadence_rpm": round(self.cadence_rpm, 1),
        "speed_kmh": round(self.speed_kmh, 1),
        "distance_m": round(self.distance_m, 1),
        "elapsed_sec": round(self.elapsed_sec, 1),
        "calories": round(self.calories, 1),
        "max_speed": round(self.max_speed, 1),
        "avg_rpm": round(self._calc_avg_rpm(), 1),
        "terrain_factor": round(self._get_terrain_factor(), 3),
        "theme": self._get_theme(),
        "stage": self.current_stage,     # None 또는 {"id", "name", "distance_m", "stars"}
        "riders": [                      # 고스트 / (향후) AI 라이벌
            # {"id": "ghost", "name": "내 최고기록", "kind": "ghost", "distance_m": 1234.5}
        ],
    }
```

시간 문자열 포맷(mm:ss)은 클라이언트에서. 한 번만 일어나는 일은 별도 메시지:
```python
{"type": "event", "kind": "achievement", "id": "5km_club", "name": "📍 5km 클럽"}
{"type": "event", "kind": "overtake", "rider": "ghost"}       # 내가 추월
{"type": "event", "kind": "overtaken", "rider": "ghost"}      # 추월당함
{"type": "event", "kind": "stage_finish", "elapsed_sec": 452.3, "stars": 2, "new_best": true}
{"type": "event", "kind": "theme_change", "theme": "mountain"}
```

## 업적 시스템

| ID | 이름 | 조건 |
|----|------|------|
| first_ride | 🚲 첫 라이딩 | 저장 조건을 만족한 첫 세션 |
| 5km_club | 📍 5km 클럽 | 한 세션에 5km |
| 10km_club | 🏅 10km 클럽 | 한 세션에 10km |
| speed_demon | ⚡ 스피드 데몬 | 최고 속도 40km/h (평지 137RPM, 내리막 1.4에서 83RPM) |
| calorie_burner | 🔥 칼로리 버너 | 한 세션에 150kcal (80RPM 약 18분) |
| rpm_machine | 🔄 RPM 머신 | 5분 이상 세션에서 페달링 평균 RPM 80 이상 |
| three_stars | ⭐ 퍼펙트 | 스테이지 ★★★ |
| ghost_buster | 👻 고스트 버스터 | 고스트보다 먼저 완주 |
| streak_3 | 🔥 3일 연속 | 3일 연속 라이딩 (로컬 날짜 기준) |
| streak_7 | 🔥🔥 7일 연속 | 7일 연속 라이딩 |
| total_100km | 🌍 100km 돌파 | 누적 거리 100km |

거리/속도/칼로리 업적은 **달성 순간** DB에 해금하고 이벤트로 알린다. 나머지는 기록 저장 직후 체크.

## 데이터베이스 (SQLite)

경로: `%USERPROFILE%\.pedalquest\records.db`

**시각은 로컬 시간으로 저장한다.** SQLite `CURRENT_TIMESTAMP`는 UTC라서 한국 오전 0~9시 기록이 전날로 잡혀 연속 일수 계산이 틀어진다. Python에서 `datetime.now().isoformat(timespec="seconds")`를 넣는다.

```sql
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL,            -- "free" | "stage"
    stage_id INTEGER,
    distance_m REAL NOT NULL,
    elapsed_sec REAL NOT NULL,
    avg_speed REAL,
    max_speed REAL,
    avg_rpm REAL,
    calories REAL,
    stars INTEGER,
    finished INTEGER DEFAULT 0,    -- 스테이지 완주 여부 (고스트는 완주 기록만 사용)
    session_log TEXT,              -- JSON 배열: 1초 간격 누적 거리(m)
    created_at TEXT NOT NULL       -- 로컬 시간 ISO 문자열
);

CREATE TABLE IF NOT EXISTS achievements (
    id TEXT PRIMARY KEY,
    unlocked_at TEXT NOT NULL      -- 로컬 시간
);

CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total_distance_m REAL DEFAULT 0,
    total_calories REAL DEFAULT 0,
    total_sessions INTEGER DEFAULT 0,
    total_time_sec REAL DEFAULT 0
);
INSERT OR IGNORE INTO stats (id) VALUES (1);
```

## WebSocket + API (server.py)

서버 → 클라이언트: `{"type":"state"}` 30fps + `{"type":"event"}` 발생 시
클라이언트 → 서버: 명령 JSON

```python
{"command": "start_free"}
{"command": "start_stage", "stage_id": 3, "ghost": true}
{"command": "pause"}
{"command": "resume"}
{"command": "stop"}                   # 저장 조건 만족 시 기록 저장 → finished (결과 화면)
{"command": "menu"}                   # finished → waiting
{"command": "mock_rpm", "rpm": 80}    # mock 모드에서만 허용
```

브로드캐스트: 서버에 하나의 broadcast task가 연결된 모든 WebSocket에 state를 보낸다. 느린 클라이언트 하나 때문에 전체가 막히지 않게 전송 실패/타임아웃 시 해당 연결만 제거.

API 엔드포인트:
- `GET /` — 게임 HTML (Jinja2로 `mock` 여부 주입)
- `GET /static/...` — nosleep 등 정적 파일
- `GET /api/health` — 서버 + 센서 상태
- `GET /api/records` — 기록 목록 (session_log 제외)
- `GET /api/stages` — 스테이지 정보 + 내 최고 기록/별
- `GET /api/achievements` — 업적 목록 (해금 여부 포함)
- `GET /api/stats` — 누적 통계 + 오늘 거리 + 연속 일수
- `POST /api/sensor/scan` — 센서 재스캔 (`sensor.rescan()`)
- `GET /api/connection-info` — 태블릿 접속 URL

## 게임 화면 (templates/game.html)

HTML5 Canvas 단일 파일 (nosleep 스크립트만 static). 이미지·사운드 파일 없이 전부 코드로 그린다.

### 시점: pseudo-3D (1인칭 기본 / 후방 전환)

카메라 두 개(`CAMS.fp` 눈높이 1.55m, `CAMS.tp` 뒤 4.5m·높이 2.4m). 선택은 브라우저 localStorage `pq.cam`에 저장. 메뉴 배경은 항상 후방 시점. 고전 레이싱 게임(OutRun) 방식의 **세그먼트 투영**:
도로를 짧은 세그먼트(예: 2m)로 나누고, 카메라 앞 N개 세그먼트를 원근 투영해 뒤에서 앞으로 그린다.
- **언덕**: `terrain_factor`로 세그먼트 높이 변화 → 오르막이면 도로가 위로 솟아 보이고, 내리막이면 앞이 꺼진다.
- **완만한 커브**: 시각 효과용으로만 (게임 로직엔 영향 없음). 속도감과 몰입감을 크게 올린다.
- **길가 오브젝트**: 테마별 (건물/가로등, 나무/집, 바위/산, 야자수/바다). 세그먼트에 배치, 투영 크기로 그림.
- **배경**: 하늘 그라데이션 + 먼 산/스카이라인 (느린 패럴랙스). 오프스크린 Canvas에 미리 그려 캐싱.
- **테마 전환**: 두 테마를 1~2초 크로스페이드.

### 3D 렌더러 (베타, `static/render3d.js`)

메뉴 오른쪽 위 "그래픽" 칩 또는 `G`키로 2D ↔ 3D 전환 (localStorage `pq.gfx`, 기본 2D).
- Three.js 0.186.0을 `static/vendor/`에 넣어 오프라인으로 사용 (CDN 없음, MIT 라이선스 파일 포함).
- 트랙 데이터(언덕·커브·테마)는 2D와 같은 전역 함수(`elevAt`, `curveAt`, `themeAt`)를 읽는다. 지형은 먼 곳→가까운 곳 순서로 칠해 깊이 버퍼 없이 언덕을 가린다.
- 길가 오브젝트는 기본 도형으로 만든 저폴리 모델 + `InstancedMesh` (종류별 그리기 1번).
- 라이벌·고스트·코인·아이템·결승 아치·(후방 시점의) 내 자전거는 3D 위치를 화면 좌표로 투영해 기존 2D 그림 함수로 `#game` 캔버스에 겹쳐 그린다.
- 1인칭 콕핏은 카메라 자식(핸들바·후드·스템·속도계). 몸(손·무릎)은 넣지 않음.
- 테마 팔레트는 Gemini 아트 디렉션 기반 (산=노을, 해변=아침, 아케이드=야간 신스웨이브).
- 저사양 태블릿(Lenovo TB-X606F, PowerVR GE8320) 대비: 터치 기기는 0.75배 해상도, 안티앨리어싱 끔, 안개로 거리 제한. HUD에 FPS 표시.

### 내 자전거와 라이더

- 1인칭(`drawCockpit`): 핸들바·후드를 잡은 손, 스템 위 속도계, 앞바퀴, 크랭크 각도로 번갈아 올라오는 무릎. 페달링에 맞춘 좌우 흔들림 + 속도 비례 노면 진동.
- 후방(`drawRider`): 화면 하단 중앙, 뒤에서 본 모습 (Canvas path로 그림).
- **크랭크 각도는 클라이언트가 실제 RPM으로 적분** → 다리 움직임이 내 페달과 같은 박자.
- RPM 0 + 속도 > 0 (관성 주행): 다리 정지, 프리휠 "틱틱" 소리.
- 오르막: 몸을 살짝 앞으로 숙이고 좌우 흔들림 증가.
- 고속: 화면 가장자리 속도선, 카메라 미세 흔들림.

### 다른 선수 (riders)

- 고스트: 반투명 흰색 자전거. 나와의 거리 차이를 도로 위 위치로 투영 (앞에 있으면 멀리 보임).
- 화면 밖(뒤)에 있으면 하단에 "고스트 -45m" 표시.

### HUD

- 크게: 속도(km/h), RPM (목표 구간 색 표시)
- 작게: 거리, 경과 시간, 칼로리
- 스테이지: 상단 진행 바 (지형 고저 미니맵 + 내 위치 + 고스트 위치), 현재 페이스 기준 예상 별
- 센서 연결 상태 아이콘 (끊기면 크게 경고)

### 부드러운 움직임

서버 상태는 30Hz로 오지만 네트워크 지터가 있다. 클라이언트는 `requestAnimationFrame`으로 그리고,
마지막 상태의 `speed_kmh`로 거리를 외삽한 뒤 새 상태가 오면 부드럽게 보정한다 (순간이동 금지).

### 사운드 (Web Audio API, 파일 없음)

- 바람 소리: 필터링한 화이트노이즈, 볼륨 ∝ 속도²
- 프리휠 틱: 관성 주행 중
- 업적/추월/완주 효과음: 짧은 합성음
- 브라우저 정책상 **"시작" 버튼 터치 시 AudioContext 활성화**

### 태블릿 화면 꺼짐 방지 (중요)

페달만 밟고 화면을 안 만지니 자동 잠금이 걸린다. Wake Lock API는 HTTPS 전용이라 `http://192.168...`에서는 동작하지 않는다.
1. **가장 확실함:** 태블릿 설정 → 화면 자동 잠금 "안 함" (또는 최대 시간). 첫 화면에 안내 문구 표시.
2. **보조:** NoSleep.js 방식 (음소거된 짧은 동영상을 숨겨서 반복 재생). "시작" 터치 시 활성화. 라이브러리 파일은 `static/`에 넣어 외부 요청 없이 제공.

### 메뉴/조작

- 태블릿 = 터치: 큰 버튼 (땀 흘리며 누르기 쉽게). 플레이 중 화면 아무 곳이나 터치 → 일시정지 메뉴.
- 화면: 메인(오늘 거리·연속 일수·모드 선택) → 스테이지 선택(별·최고기록·고스트 토글) → 플레이 → 결과(기록, 새 업적)
- 가로 화면 기준, 세로면 "가로로 돌려주세요".

**mock 모드 키보드 (PC 브라우저):**
```
↑: 목표 RPM +10
↓: 목표 RPM -10
스페이스: 일시정지/재개
```

### WebSocket 자동 재연결

태블릿 화면 꺼짐/백그라운드 시 끊긴다:
```javascript
function connectWS() {
    ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = onMessage;
    ws.onclose = () => setTimeout(connectWS, 1000);
}
```
재연결되면 서버 상태(`state`)를 그대로 받아 이어서 표시 (게임은 서버에서 계속 돌고 있음).

## 프로젝트 구조

```
cycle/
├── CLAUDE.md
├── main.py
├── pedalquest/
│   ├── __init__.py
│   ├── util.py            # log_task_error 등
│   ├── config.py          # 설정 load/save
│   ├── sensor.py          # CadenceCalculator + BLE 센서 + Mock
│   ├── physics.py         # target_speed, step_speed, calc_calories (순수 함수)
│   ├── game.py            # 게임 엔진 (모드, 상태, 스테이지, 고스트)
│   ├── records.py         # SQLite 기록/통계
│   ├── achievements.py    # 업적 조건 체크
│   └── server.py          # FastAPI + WebSocket
├── templates/
│   └── game.html          # 게임 화면 (Canvas)
├── static/
│   └── nosleep.min.js
├── tests/
│   ├── test_cadence.py    # 오버플로우, 정지 감지, 휴식 후 재개
│   ├── test_physics.py    # 속도 곡선, 관성, 스테이지 별 기준 시뮬레이션
│   └── test_records.py    # 로컬 시간, 연속 일수, 저장 조건
├── requirements.txt
└── README.md
```

데이터: `%USERPROFILE%\.pedalquest\` (config.json, records.db)

## 설정 (`%USERPROFILE%\.pedalquest\config.json`)

```json
{
    "web_port": 18400,
    "sensor_address": null,
    "user_weight_kg": 70,
    "game": {
        "tick_rate": 30,
        "speed_multiplier": 1.0
    }
}
```

`sensor_address`는 첫 스캔 성공 시 자동 저장. 다른 센서로 바꾸려면 재스캔.

## 구현 순서

1. **config.py + records.py + util.py** — 설정, SQLite, 테스트.
2. **sensor.py** — CadenceCalculator(테스트 먼저) + Mock + BLE.
3. **physics.py + game.py** — 관성 물리, 모드, 스테이지. 별 기준 시뮬레이션 테스트.
4. **server.py + main.py** — `python main.py --mock` → 브라우저에서 state JSON 수신 확인.
5. **game.html 1단계** — 메뉴 + HUD + 단순 pseudo-3D 도로(평지). mock으로 속도감 확인.
6. **game.html 2단계** — 언덕, 테마/길가 오브젝트, 라이더 페달 애니메이션, 사운드.
7. **achievements.py** — 업적 해금 + 알림.
8. **고스트** — session_log 재생, 추월 이벤트.
9. **태블릿 테스트** — 같은 와이파이 접속, 화면 꺼짐 방지, 30fps 확인.
10. **(센서 도착 후)** 실제 센서 연결 → 관성/속도 상수 체감 튜닝 → 별 기준 재시뮬레이션.

## 주의사항

- **0.0.0.0 바인딩 필수**: 태블릿 접근용.
- **Windows 방화벽**: 첫 실행 시 뜨는 허용 창에서 "개인 네트워크" 허용. 안 뜨면 관리자 PowerShell에서:
  `netsh advfirewall firewall add rule name="PedalQuest" dir=in action=allow protocol=TCP localport=18400 profile=private`
  PC의 와이파이 네트워크 프로필이 "공용"이면 태블릿 접속이 막힌다 → "개인"으로 변경.
- **BLE 연결 불안정**: 끊김 → 자동 재연결 (구현됨). 재연결 시 `calc.reset()` 필수. UI에 연결 상태 표시.
- **센서 활성화**: XOSS G+는 페달을 몇 바퀴 돌려야 BLE 광고 시작 → "페달을 돌려주세요" 안내.
- **센서 알림은 약 1Hz**: RPM 변화는 최대 1초 늦게 반영된다. 관성 물리가 이를 자연스럽게 가려준다.
- **백그라운드 task 예외**: `asyncio.create_task`의 예외는 조용히 묻힌다. 반드시 `add_done_callback(log_task_error)`.
- **asyncio 구조**: bleak/pycycling/FastAPI 전부 같은 이벤트 루프. 스레드 없음.
- **Canvas 성능**: 태블릿에서 30fps 안 나오면 투영 세그먼트 수를 줄이고, 배경은 오프스크린 캐싱.
- **mock 모드 필수**: 센서 도착 전 전체 개발/테스트 가능해야 함.

## 테스트 체크리스트

**자동 테스트 (`pytest`):**
- [ ] CadenceCalculator: 16비트 오버플로우, 정지 → 0, 장시간 휴식 후 재개
- [ ] 물리: 속도 곡선 값, 평지 관성 정지 시간, 내리막 관성 속도
- [ ] 스테이지별 75/60/45 RPM 시뮬레이션 시간이 별 기준과 일치
- [ ] 기록: 로컬 시간 저장, 연속 일수, 200m/60초 미만 미저장

**센서 없이 (mock):**
- [ ] `python main.py --mock` → 서버 시작 + 올바른 와이파이 IP 표시
- [ ] PC 브라우저 `localhost:18400` → 게임 화면
- [ ] ↑↓ → RPM/속도 변화, RPM 0 → 서서히 감속 후 정지
- [ ] 태블릿 `http://PC아이피:18400` → 접속, 터치 메뉴 동작
- [ ] 10분 이상 플레이해도 태블릿 화면 안 꺼짐
- [ ] 프리라이딩 → 도로/길가 스크롤, 테마 전환, 자동 일시정지
- [ ] 스테이지 → 오르막 느려짐·언덕이 보임, 내리막 굴러감
- [ ] 종료 → 기록 저장 + 목록 확인, 업적 알림
- [ ] 고스트 → 추월 이벤트, 승패

**센서 연결 후:**
- [ ] 센서 스캔 → 발견 → 주소 저장 → 재시작 시 바로 연결
- [ ] 페달 → RPM 표시, 다리 애니메이션이 실제 박자와 일치
- [ ] 페달 정지 → 약 3초 후 RPM 0, 자전거는 관성으로 감속
- [ ] 센서 전원 끔/켬 → 자동 재연결
- [ ] 20분 연속 플레이 → 안정적

## 향후 계획 (지금은 구현하지 않음)

전체 보완 후보 목록과 퍼포먼스 판단은 **ROADMAP.md** 참고 (실제 영상 라이딩, 한강 코스, 대회 모드 등).

### AI 라이벌
규칙 기반 컴퓨터 선수와 함께 달리기 (LLM 아님, 오프라인 동작).
- 선수마다 성격: 기본 RPM, 지구력(후반 페이스 저하), 오르막 강/약, 막판 스퍼트
- 내 실력(최근 기록 평균)에 맞춰 난이도 자동 조정 → 항상 "아슬아슬하게" 이기거나 지도록
- `riders` 배열에 `{"kind": "ai", ...}`로 추가하면 렌더링/추월 이벤트는 고스트와 같은 코드로 동작
- 추후: 순위, 리그/시즌, 라이벌별 전적

### 심박수 (갤럭시 워치, 선택 기능)
워치는 케이던스 센서를 대신할 수 없다 (손목으로는 크랭크 회전을 정확히 못 잰다). 대신 **심박수** 입력용으로 쓸 수 있다.
- 쓸 곳: HUD 심박수·심박존 표시, 심박 기반 칼로리(MET보다 정확), 기록에 평균/최대 심박, AI 라이벌 난이도 조정 참고
- 방법: 표준 BLE 심박 서비스(0x180D)로 워치 심박을 내보내야 함. 워치 기본 기능 또는 Wear OS 심박 방송 앱 필요 → **워치 모델 확인 후 실제로 PC에서 스캔되는지 먼저 테스트**
- 주의: PC 동글(BCM20702, BT 4.0)이 케이던스 센서 + 워치 동시 연결을 안정적으로 버티는지 확인 필요
- 없어도 게임은 완전히 동작해야 함 (`heart_rate`는 항상 null 허용)
