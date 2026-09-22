# 2.5D 맵 넣는 법

맵 하나 = 폴더 하나.

```
static/maps/
├── index.json          ← 메뉴에 나올 목록
└── coastal/
    ├── map.json        ← 이 맵의 정의
    ├── sky.png         ← 레이어 그림 (없으면 대체 그림이 들어간다)
    ├── far.png
    ├── mid.png
    ├── near.png
    └── road.png
```

## 1) 그림

**가로로 길게, 좌우 끝이 이어지게.** 왼쪽 끝과 오른쪽 끝을 붙였을 때 경계가 보이면
달리는 내내 그 줄이 주기적으로 지나간다. 폭은 2048~4096px 정도가 무난하다.

| 레이어 | 무엇 | 배경 | 화면에서의 높이 |
|--------|------|------|----------------|
| `sky`  | 하늘·구름 | 불투명 | 화면 위 62% |
| `far`  | 산·바다·먼 스카이라인 | **투명** | 아래끝이 지평선, 높이 30% |
| `mid`  | 건물·나무 | **투명** | 아래끝이 지평선, 높이 26% |
| `near` | 가드레일·표지판·전봇대 | **투명** | 아래끝이 지평선, 높이 17% |
| `road` | 노면 | 불투명 | 지평선에서 화면 아래까지 |

sky와 road 말고는 **알파가 있어야** 뒤 레이어가 비친다. 체크무늬를 픽셀로 그려주는
생성기가 많으니 `tools\sprite_alpha.py`로 진짜 알파로 바꿔서 넣을 것.

## 2) map.json

```json
{
  "name": "해안도로",
  "layers": {
    "sky": "maps/coastal/sky.png",
    "far": "maps/coastal/far.png",
    "mid": "maps/coastal/mid.png",
    "near": "maps/coastal/near.png",
    "road": "maps/coastal/road.png"
  },
  "scrollSpeed": { "sky": 0.02, "far": 0.1, "mid": 0.4, "near": 0.8, "road": 1.0 }
}
```

`layers`의 경로는 `/static/` 기준이다. 선택 항목:

- `pxPerM` — 1m 달릴 때 도로가 움직이는 픽셀 (기본 14). 너무 빠르면 뭉개지고 느리면 안 달리는 것 같다.
- `layout` — 레이어별 `{ "anchor": "top"|"horizon"|"horizonTop", "height": 0~1 }`로 위 표를 덮어쓴다.
- `roadMode` — `"toward"`로 두면 도로를 가로가 아니라 **세로로** 흘린다 (위에서 내려다본 노면 그림용).
- `placeholder` — 그림이 없을 때 쓸 대체 색 `{ sky:[3색], far, mid, near, road, lane }`.

## 3) index.json에 한 줄

```json
[{ "id": "coastal", "name": "해안도로" }]
```

여기 들어간 것만 메뉴의 맵 고르는 줄에 나온다.
