"""캐릭터 원화(art/chr/<스타일>/) → 화면에 쓸 웹 크기 이미지(static/chr/).

원화는 1792x1008짜리 4MB 묶음이라 그대로 태블릿에 내려보낼 게 못 된다.
여기서 화면별로 필요한 부분만 잘라 쓸 만한 크기로 줄인다.

    .venv\\Scripts\\python tools\\chr_art.py            # 기본 스타일
    .venv\\Scripts\\python tools\\chr_art.py --style photo

스타일이 두 벌 있다. 결과 파일 이름은 같으니 **전환은 이 명령 한 줄**이고
game.html은 건드릴 게 없다.

  anime — 셀 셰이딩 일러스트. 검은 스포츠브라 + 레깅스, 분홍 로드바이크.
  photo — 실사풍. 분홍 저지 + 포니테일, 회색 로드바이크.

기본은 anime다. 게임 월드가 셀 셰이딩 저폴리라 실사 인물을 얹으면 혼자 붕 뜬다.
메뉴 카드만 놓고 보면 photo도 좋으니 취향이면 위 명령으로 바꾸면 된다.

어둡게 깔거나 그라데이션을 얹는 건 **여기서 하지 않는다** — CSS에서 한다.
그래야 색을 만질 때마다 이미지를 다시 만들 필요가 없다.
"""
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow가 필요합니다:  .venv\\Scripts\\python -m pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "chr"
DST = ROOT / "static" / "chr"

# 모드 버튼은 실제로 가로:세로가 약 1.85:1이다. 그보다 세로로 긴 그림을 넣으면
# background-size:cover가 위아래를 잘라내 인물의 머리가 날아간다 (한 번 그렇게 만들었다).
# 카드 비율에 맞춰 잘라두면 CSS의 background-position은 center로 두면 된다.
CARD = (740, 400)
HERO = (1240, 400)   # 결과 화면 머리띠. 대화상자 폭 620px의 2배 × 3.1:1

# 스타일 → [(원화, 결과 이름, 자를 상자, 결과 크기)]. 상자는 원화(1792x1008) 좌표.
STYLES = {
    "anime": [
        # 프리 라이딩 — 오른쪽으로 달려나가는 옆모습. 열린 길이 "끝없는 길"과 맞는다.
        ("side-right.jpg", "mode-free.jpg", (95, 60, 1705, 930), CARD),
        # 스테이지 — 반대로 향한 옆모습. 두 카드가 나란히 놓여도 구도가 겹치지 않는다.
        ("side-left.jpg", "mode-stage.jpg", (105, 50, 1715, 920), CARD),
        # 아케이드 — 정면. 달려드는 구도라 레이스에 맞는다.
        ("front.jpg", "mode-arcade.jpg", (85, 40, 1695, 910), CARD),
        # 영상 라이딩 — 위에서 내려다본 구도. 드론 영상 느낌.
        ("topdown.jpg", "mode-video.jpg", (95, 120, 1705, 990), CARD),
        # 결과 — 뒷모습. 플레이 중 후방 시점과 같은 구도라 "방금 탄 그 사람"으로 읽힌다.
        ("back.jpg", "result-hero.jpg", (0, 40, 1792, 618), HERO),
    ],
    # photo 쪽은 옆모습만 자전거가 통째로 보인다. 나머지는 상반신 위주라
    # 카드에서도 인물이 크게 들어오도록 상자를 좁게 잡았다.
    "photo": [
        ("side-right.jpg", "mode-free.jpg", (95, 10, 1705, 880), CARD),
        ("topdown.jpg", "mode-stage.jpg", (300, 20, 1760, 810), CARD),
        ("front.jpg", "mode-arcade.jpg", (60, 30, 1670, 900), CARD),
        ("back.jpg", "mode-video.jpg", (120, 0, 1730, 870), CARD),
        ("back.jpg", "result-hero.jpg", (0, 40, 1792, 618), HERO),
    ],
}
DEFAULT_STYLE = "anime"


def main(argv):
    style = DEFAULT_STYLE
    if argv[:1] == ["--style"]:
        style = argv[1] if len(argv) > 1 else ""
    elif argv:
        sys.exit(__doc__)
    if style not in STYLES:
        sys.exit(f"스타일은 {' / '.join(STYLES)} 중 하나입니다 (받은 값: {style!r})")

    src_dir = SRC / style
    crops = STYLES[style]
    missing = sorted({c[0] for c in crops if not (src_dir / c[0]).exists()})
    if missing:
        sys.exit(f"원화가 없습니다: {', '.join(missing)}  ({src_dir})")

    DST.mkdir(parents=True, exist_ok=True)
    for src_name, out_name, box, size in crops:
        im = Image.open(src_dir / src_name).convert("RGB").crop(box)
        im = im.resize(size, Image.LANCZOS)
        out = DST / out_name
        im.save(out, "JPEG", quality=82, optimize=True, progressive=True)
        print(f"{out.relative_to(ROOT)}  {size[0]}x{size[1]}  {out.stat().st_size // 1024}KB")
    print(f"\n스타일: {style}")


if __name__ == "__main__":
    main(sys.argv[1:])
