"""크로마키로 딴 PNG의 **가장자리에 남은 초록**을 뺀다.

    .venv\\Scripts\\python tools\\despill.py static\\maps\\hanriver\\layer3_mid.png ...

초록 배경 앞에서 딴 그림은 윤곽의 반투명 픽셀에 초록이 섞여 남는다. 그대로 얹으면
나무와 벤치 둘레에 초록 테두리가 보인다 (한강 맵에서 실제로 mid는 반투명 픽셀의
100%, near는 44%가 초록 과다였다).

**불투명한 픽셀은 건드리지 않는다.** 이 맵은 버드나무와 잔디로 가득해서 전체에
despill을 걸면 진짜 초록까지 빠진다. 키잉 잔재는 알파가 0도 255도 아닌
가장자리에만 있으므로 거기만 손본다.

방법: 그 픽셀의 g가 r·b보다 튀어 있으면 max(r, b) 쪽으로 끌어내린다.
색조는 유지되고 초록 기운만 빠진다.
"""
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow가 필요합니다:  .venv\\Scripts\\python -m pip install pillow")

STRENGTH = 1.0   # 1.0 = g를 max(r,b)까지 완전히 끌어내린다


def despill(path: Path) -> int:
    im = Image.open(path).convert("RGBA")
    px = im.load()
    w, h = im.size
    fixed = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0 or a == 255:
                continue                      # 속과 완전한 바깥은 그대로 둔다
            cap = max(r, b)
            if g > cap:
                px[x, y] = (r, int(g + (cap - g) * STRENGTH), b, a)
                fixed += 1
    if fixed:
        im.save(path)
    return fixed


def main(argv):
    if not argv:
        sys.exit(__doc__)
    for arg in argv:
        p = Path(arg)
        if not p.exists():
            print(f"없음: {p}")
            continue
        n = despill(p)
        print(f"{p}  가장자리 {n}픽셀에서 초록 제거")


if __name__ == "__main__":
    main(sys.argv[1:])
