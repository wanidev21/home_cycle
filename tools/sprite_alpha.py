"""AI가 만든 스프라이트 PNG의 '가짜 투명 배경'을 진짜 알파로 바꾼다.

이미지 생성 AI는 투명 배경을 요청받으면 알파 채널을 만드는 대신
**체크무늬를 픽셀로 그려서** 내놓는 일이 잦다. 그대로 게임에 얹으면
투명해야 할 자리에 회색 격자가 그려진다.

    .venv\\Scripts\\python tools\\sprite_alpha.py static\\cockpit-arms.png

세 단계로 지운다. 전부 "테두리에서 연결된 것만" 또는 "주변이 배경인 것만"이라
그림 안쪽의 흰 글자·로고·하이라이트는 살아남는다.

  1) 테두리에서 flood fill — 배경의 대부분
  2) 갇힌 영역 — 케이블 고리 안처럼 바깥과 이어지지 않는 조각
  3) 잔재 — 흐려져 점점이 남은 것

주의: Pillow가 필요하다. 게임 실행에는 쓰이지 않는 도구라
requirements.txt에는 넣지 않는다. 필요할 때만 `pip install pillow`.
"""
import sys
from collections import deque
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow가 필요합니다:  .venv\\Scripts\\python -m pip install pillow")

NEUTRAL_TOL = 20      # r,g,b가 이만큼 안에서 같으면 무채색 (원본 노이즈 감안)
BG_FLOOR = 150        # 이보다 밝은 무채색은 배경 후보. 테두리를 보고 자동 조정된다
MIN_POCKET = 150      # 갇힌 조각이 이보다 크면 배경으로 본다
SPECKLE_R = 2
SPECKLE_NEED = 0.62   # 주변 5x5의 이 비율이 배경이면 잔재로 본다


_floor = BG_FLOOR


def bg_like(p):
    if p[3] == 0:
        return False
    r, g, b = p[:3]
    return max(r, g, b) - min(r, g, b) < NEUTRAL_TOL and (r + g + b) / 3 >= _floor


def pick_floor(px, w, h):
    """테두리를 보고 배경 밝기의 하한을 정한다.

    고정값을 쓰면 배경이 조금만 어두워도(원본에 따라 150까지 내려간다)
    flood fill이 거기서 막혀 체크무늬가 절반만 지워진다.
    """
    vals = []
    for x in range(0, w, 2):
        for y in (0, h - 1):
            p = px[x, y]
            if max(p[:3]) - min(p[:3]) < NEUTRAL_TOL:
                vals.append(sum(p[:3]) / 3)
    for y in range(0, h, 2):
        for x in (0, w - 1):
            p = px[x, y]
            if max(p[:3]) - min(p[:3]) < NEUTRAL_TOL:
                vals.append(sum(p[:3]) / 3)
    if not vals:
        return BG_FLOOR
    vals.sort()
    low = vals[len(vals) // 20]          # 아래쪽 5%
    return max(120, min(BG_FLOOR, low - 12))


def flood_from_edges(px, w, h):
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    n = 0
    while q:
        x, y = q.popleft()
        if not (0 <= x < w and 0 <= y < h) or seen[y * w + x]:
            continue
        p = px[x, y]
        if p[3] == 0:
            seen[y * w + x] = 1
            continue
        if not bg_like(p):
            continue
        seen[y * w + x] = 1
        px[x, y] = (0, 0, 0, 0)
        n += 1
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return n


def clear_pockets(px, w, h):
    """바깥과 이어지지 않아 flood fill이 닿지 못한 배경 조각."""
    seen = bytearray(w * h)
    n = 0
    for sy in range(h):
        for sx in range(w):
            if seen[sy * w + sx] or not bg_like(px[sx, sy]):
                continue
            comp, q = [], deque([(sx, sy)])
            seen[sy * w + sx] = 1
            while q:
                x, y = q.popleft()
                comp.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and bg_like(px[nx, ny]):
                        seen[ny * w + nx] = 1
                        q.append((nx, ny))
            if len(comp) >= MIN_POCKET:
                for x, y in comp:
                    px[x, y] = (0, 0, 0, 0)
                n += len(comp)
    return n


def clear_speckles(px, w, h):
    """흐려져 점점이 남은 잔재. 주변이 대부분 배경일 때만 지운다.

    글자나 로고처럼 어두운 그림에 둘러싸인 가는 선은 이 조건을 못 넘는다.
    한 번에 판정하고 한 번에 지운다 — 지우면서 판정하면 새로 뚫린 구멍이
    다음 픽셀의 조건을 만족시켜 그림 전체로 번진다.
    """
    doomed = []
    for y in range(h):
        for x in range(w):
            if not bg_like(px[x, y]):
                continue
            tot = hit = 0
            for dy in range(-SPECKLE_R, SPECKLE_R + 1):
                for dx in range(-SPECKLE_R, SPECKLE_R + 1):
                    nx, ny = x + dx, y + dy
                    if not (0 <= nx < w and 0 <= ny < h):
                        continue
                    tot += 1
                    q = px[nx, ny]
                    if q[3] == 0 or bg_like(q):
                        hit += 1
            if tot and hit / tot >= SPECKLE_NEED:
                doomed.append((x, y))
    for x, y in doomed:
        px[x, y] = (0, 0, 0, 0)
    return len(doomed)


def strip(path: Path):
    global _floor
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    _floor = pick_floor(px, w, h)
    edge = flood_from_edges(px, w, h)
    pocket = clear_pockets(px, w, h)
    speck = clear_speckles(px, w, h)
    im.save(path)
    total = edge + pocket + speck
    print(f"{path.name}: {w}x{h}  하한 {_floor:.0f}  배경 {edge} + 갇힌 조각 {pocket}"
          f" + 잔재 {speck} = {total}px ({100 * total / (w * h):.0f}%)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for arg in sys.argv[1:]:
        strip(Path(arg))
