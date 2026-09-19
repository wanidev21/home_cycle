# PedalQuest 🚴

실내 홈싸이클 + BLE 케이던스 센서로 즐기는 태블릿 자전거 게임.

## 설치 (처음 한 번)

```powershell
py -3.13 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 실행

```powershell
.venv\Scripts\activate
python main.py          # 실제 센서
python main.py --mock   # 센서 없이 (키보드 ↑↓ 로 RPM 조절)
```

터미널에 표시되는 주소(`http://192.168.x.x:18400`)를 태블릿 브라우저에 입력.

### 처음 실행할 때
- Windows 방화벽 창이 뜨면 **개인 네트워크 허용**.
- 태블릿이 접속 안 되면: PC 와이파이 네트워크 프로필을 "개인"으로, 같은 와이파이인지 확인.
- 태블릿 **화면 자동 잠금 "안 함"** 권장.

### 센서
- XOSS G+를 크랭크 암에 고정, **케이던스 모드**로 설정.
- 서버 실행 후 페달을 몇 바퀴 돌리면 자동으로 찾아 연결하고 주소를 저장.
- 다른 센서로 바꾸면 메뉴의 "센서 다시 찾기".

## 조작
- 페달 = 속도. 멈추면 관성으로 서서히 선다.
- 플레이 중 화면 터치 = 일시정지 (PC: 스페이스).
- 프리 라이딩은 5초 멈추면 자동 일시정지, 다시 밟으면 이어서.
- 🍄 아케이드 레이스: 아이템은 **평소보다 RPM을 확 올려 2초 유지**하면 발동 (아이템 칸 터치 / PC는 Enter).
- `--mock` 기록은 `records-mock.db`에 따로 저장.

## 테스트

```powershell
python -m pytest -q
```

데이터: `%USERPROFILE%\.pedalquest\` (config.json, records.db)
