r"""센서 진단: 스캔 → 연결 → 원시 CSC 데이터 출력.

    .venv\Scripts\python tools\sensor_check.py [초]

페달을 돌리면서 실행. 크랭크 값이 늘어나면 케이던스 모드, 휠 값만 나오면 속도 모드.
"""
import asyncio
import sys
import time

from bleak import BleakClient, BleakScanner
from pycycling.cycling_speed_cadence_service import CyclingSpeedCadenceService

sys.path.insert(0, __file__.rsplit("tools", 1)[0])
from pedalquest.sensor import CSC_SERVICE_UUID, CadenceCalculator  # noqa: E402


async def main(duration: float):
    print("🔍 20초간 스캔... (페달을 계속 돌려주세요)")
    found = await BleakScanner.discover(timeout=20, return_adv=True)
    csc = []
    for device, adv in found.values():
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        is_csc = CSC_SERVICE_UUID in uuids
        name = device.name or adv.local_name or "(이름 없음)"
        print(f"  {'✅' if is_csc else '  '} {name}  {device.address}  RSSI {adv.rssi}  CSC={is_csc}  uuids={uuids}")
        # 진단용이라 이름도 본다 (광고에 서비스 UUID를 안 넣는 센서 확인용)
        if is_csc or "xoss" in name.lower():
            csc.append(device)
    print(f"(전체 BLE 기기 {len(found)}개 중 CSC 센서 {len(csc)}개)")
    if not csc:
        print("❌ CSC 센서 없음. 페달을 돌리고 다시 실행하거나, 폰 앱(XOSS/Zwift)과 연결돼 있다면 끊어주세요.")
        return

    dev = csc[0]
    calc = CadenceCalculator()
    t0 = time.monotonic()

    def on_measurement(m):
        calc.feed(m.cumulative_crank_revs, m.last_crank_event_time)
        print(f"[{time.monotonic() - t0:5.1f}s] crank={m.cumulative_crank_revs} "
              f"crank_t={m.last_crank_event_time}  wheel={m.cumulative_wheel_revs} "
              f"wheel_t={m.last_wheel_event_time}  → RPM {calc.get_rpm():.1f}")

    print(f"\n🔗 {dev.name} 연결 중...")
    async with BleakClient(dev.address, timeout=15) as client:
        svc = CyclingSpeedCadenceService(client)
        svc.set_csc_measurement_handler(on_measurement)
        await svc.enable_csc_measurement_notifications()
        print(f"연결됨. {duration:.0f}초 동안 데이터 수신 — 페달을 돌려주세요!\n")
        await asyncio.sleep(duration)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    asyncio.run(main(float(sys.argv[1]) if len(sys.argv) > 1 else 30))
