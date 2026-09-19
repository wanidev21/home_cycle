"""BLE 케이던스 센서 + Mock.

CSC 크랭크 데이터:
- cumulative_crank_revs: 누적 회전수 (16비트)
- last_crank_event_time: 마지막으로 크랭크가 돈 시각 (1/1024초, 16비트). 현재 시각이 아님!
페달을 멈추면 같은 값이 반복되거나 알림이 끊기므로 정지는 PC 시계로 판단한다.
"""
import asyncio
import time

from .util import log_task_error

CSC_SERVICE_UUID = "00001816-0000-1000-8000-00805f9b34fb"


class CadenceCalculator:
    """CSC 누적 크랭크 데이터 → RPM."""
    STOP_TIMEOUT_MIN = 2.5   # 초. 이 시간 동안 회전 증가가 없으면 정지
    STOP_TIMEOUT_MAX = 4.0   # 느린 회전은 주기×1.5까지 기다리되 상한
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
            self._task = None
        self.connected = False

    async def rescan(self):
        """연결 루프와 스캔이 동시에 돌면 Windows BLE가 오류를 내므로
        기존 task를 완전히 멈춘 뒤 저장된 주소를 지우고 다시 시작."""
        await self.stop()
        self.config.sensor_address = None
        self.config.save()
        self.start()

    # --- 스캔 ---
    async def scan_for_sensor(self) -> str | None:
        from bleak import BleakScanner

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
        from bleak import BleakClient
        from pycycling.cycling_speed_cadence_service import CyclingSpeedCadenceService

        address = self.config.sensor_address
        while not address:
            try:
                address = await self.scan_for_sensor()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"⚠ 스캔 오류: {e!r} (블루투스가 켜져 있는지 확인)")
                self.status_msg = "블루투스 오류"
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
                print(f"⚠ 센서 오류: {e!r}, 5초 후 재연결... (페달을 돌려 센서를 깨워주세요)")
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
                "cadence_rpm": round(self.get_rpm(), 1), "mock": False}


class MockSensorManager:
    """실제 센서처럼 누적 회전수 + 이벤트 시각을 약 1Hz로 만들어 같은 CadenceCalculator에 넣는다."""

    def __init__(self):
        self.calc = CadenceCalculator()
        self.target_rpm = 0.0
        self.connected = True
        self._revs = 0
        self._evt = int(time.monotonic() * 1024) % 65536
        self._task: asyncio.Task | None = None

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
            self._task = None

    async def rescan(self):
        pass

    def set_rpm(self, rpm: float):
        self.target_rpm = max(0.0, min(150.0, float(rpm)))

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
        return {"connected": True, "message": "Mock", "cadence_rpm": round(self.get_rpm(), 1),
                "mock": True, "target_rpm": self.target_rpm}
