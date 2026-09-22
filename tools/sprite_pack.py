"""3인칭 스프라이트 시트 원본(PNG) → 브라우저에 내려보낼 WebP 두 벌.

    .venv\\Scripts\\python tools\\sprite_pack.py art\\cyclist-spritesheet.png

받은 원본은 2664x6840 PNG 20MB였다. 두 가지가 문제다:
  1) 와이파이로 20MB를 받아야 한다.
  2) 디코딩하면 2664*6840*4 = 약 73MB가 메모리에 올라간다. 저사양 태블릿
     (PowerVR GE8320)에서 이건 위험하다 — 이 프로젝트는 이미 크롬이 WebGL
     컨텍스트를 회수하는 걸 겪었다.

알파가 있는 lossy WebP로 바꾸면 20MB → 약 3.7MB가 된다. 해상도는 안 줄인다:
PC(1080p, DPR 1.5)에서 스프라이트는 약 940px 높이로 그려지는데 원본 칸이 684px라
이미 확대해서 쓰는 중이다. 더 줄이면 PC에서 흐려진다.

메모리는 **태블릿용 절반 크기**를 따로 만들어 푼다. 터치 기기는 스프라이트를
약 420px 높이로만 그리므로 절반(342px)이면 충분하고, 디코딩도 73MB → 18MB가 된다.
어느 쪽을 받을지는 rider3p.js가 pointer:coarse로 고른다.
"""
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow가 필요합니다:  .venv\\Scripts\\python -m pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "static"
STEM = "cyclist-spritesheet"
QUALITY = 90        # 알파가 있는 lossy WebP. 82까지 내려도 크게 다르지 않지만 여유를 뒀다


def main(argv):
    if not argv:
        sys.exit(__doc__)
    src = Path(argv[0])
    if not src.exists():
        sys.exit(f"원본이 없습니다: {src}")

    im = Image.open(src).convert("RGBA")
    for suffix, img in (("", im), ("-half", im.resize((im.width // 2, im.height // 2), Image.LANCZOS))):
        out = OUT / f"{STEM}{suffix}.webp"
        img.save(out, "WEBP", quality=QUALITY, method=6)
        print(f"{out.relative_to(ROOT)}  {img.width}x{img.height}  "
              f"{out.stat().st_size / 1e6:.2f}MB  (디코딩 {img.width * img.height * 4 / 1e6:.0f}MB)")


if __name__ == "__main__":
    main(sys.argv[1:])
