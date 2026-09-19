import asyncio
import sys

import uvicorn

from pedalquest.config import Config
from pedalquest.game import GameEngine
from pedalquest.records import Records
from pedalquest.sensor import MockSensorManager, SensorManager
from pedalquest.server import create_app
from pedalquest.util import data_dir, get_lan_ip, log_task_error


async def main():
    config = Config.load()
    mock = "--mock" in sys.argv
    # mock(키보드) 기록은 실제 기록과 섞이지 않게 별도 파일
    records = Records(data_dir() / "records-mock.db") if mock else Records()

    if mock:
        print("⚠ Mock 모드: 센서 없이 키보드(↑↓)로 테스트")
        sensor = MockSensorManager()
    else:
        sensor = SensorManager(config)

    game = GameEngine(config, sensor, records)
    app = create_app(config, game, sensor, records, mock=mock)

    sensor.start()
    game_task = asyncio.create_task(game.run_loop())
    game_task.add_done_callback(log_task_error)

    ip = get_lan_ip()
    print("\n🚴 PedalQuest 서버 시작!")
    print(f"📱 태블릿에서 접속: http://{ip}:{config.web_port}")
    print(f"💻 PC에서 접속: http://localhost:{config.web_port}")
    print("\nCtrl+C로 종료\n")

    server = uvicorn.Server(uvicorn.Config(
        app, host="0.0.0.0", port=config.web_port, log_level="warning"
    ))
    try:
        await server.serve()
    finally:
        game_task.cancel()
        await sensor.stop()
        records.close()


if __name__ == "__main__":
    if sys.platform == "win32":
        # Windows 콘솔에서 이모지 출력 시 인코딩 오류 방지
        sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
