"""3인칭 스프라이트 시트 원본(PNG) → 브라우저에 내려보낼 WebP 두 벌.

    .venv\\Scripts\\python tools\\sprite_pack.py art\\cyclist-spritesheet.png

두 벌을 만든다. 어느 쪽을 받을지는 rider3p.js가 pointer:coarse로 고른다.

  PC (기준 화면)  cyclist-spritesheet.webp       lossless, 원본 해상도, 약 10MB
  태블릿 (저사양) cyclist-spritesheet-half.webp  lossy q90, 절반 해상도, 약 1.4MB

**PC는 손실 압축을 쓰지 않는다.** 이 프로젝트의 기준 화면은 PC 모니터고
(RTX 2060 / 1920x1080), 거기서 10MB 받는 것도 디코딩된 73MB를 들고 있는 것도
아무 문제가 아니다. lossless WebP는 원본 PNG와 **픽셀이 같으면서** 20MB → 10MB다.
q90 lossy도 재봤지만 보이는 영역에서 평균 2/255·최대 37의 오차가 남았다 —
아낄 이유가 없는 손실이다.

해상도도 PC에서는 안 줄인다: 1080p·DPR 1.5에서 스프라이트가 약 940px 높이로
그려지는데 원본 칸이 684px라 이미 확대해서 쓰는 중이다.

태블릿만 절반으로 줄인다. 거기서는 약 420px 높이로만 그리므로 절반(342px)이면
충분하고, 디코딩이 73MB → 18MB로 떨어져 저사양 기기가 버틴다.
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
HALF_QUALITY = 90   # 태블릿용 절반 시트만 손실 압축. 이미 절반으로 줄인 뒤라 차이가 안 보인다


def main(argv):
    if not argv:
        sys.exit(__doc__)
    src = Path(argv[0])
    if not src.exists():
        sys.exit(f"원본이 없습니다: {src}")

    im = Image.open(src).convert("RGBA")
    half = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    jobs = [
        ("", im, dict(lossless=True, method=6)),
        ("-half", half, dict(quality=HALF_QUALITY, method=6)),
    ]
    for suffix, img, kw in jobs:
        out = OUT / f"{STEM}{suffix}.webp"
        img.save(out, "WEBP", **kw)
        how = "lossless" if kw.get("lossless") else f"q{kw['quality']}"
        print(f"{out.relative_to(ROOT)}  {img.width}x{img.height}  {how}  "
              f"{out.stat().st_size / 1e6:.2f}MB  (디코딩 {img.width * img.height * 4 / 1e6:.0f}MB)")


if __name__ == "__main__":
    main(sys.argv[1:])
