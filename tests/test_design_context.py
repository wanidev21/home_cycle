"""docs/DESIGN-CONTEXT.md가 조용히 낡지 않게 지킨다.

디자인 담당(클로디)은 이 문서만 보고 사양을 쓴다. 문서에 적힌 element id나
CSS 토큰 이름이 실제 소스에서 바뀌었는데 문서가 그대로면, 없는 요소를 가리키는
사양이 돌아온다. 이름이 바뀌면 여기서 잡는다.
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "docs" / "DESIGN-CONTEXT.md"
HTML = ROOT / "templates" / "game.html"
JS = ROOT / "static" / "render3d.js"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def backticked(pattern: str) -> set[str]:
    """문서에서 `...` 안에 있는 것 중 패턴에 맞는 것."""
    return {m for m in re.findall(r"`([^`]+)`", read(DOC)) if re.fullmatch(pattern, m)}


def test_doc_exists_and_is_short_enough_to_paste():
    assert DOC.exists()
    lines = read(DOC).count("\n")
    assert lines < 260, f"{lines}줄 — 요약본이 코드만큼 길어지면 넘기는 의미가 없다"


def test_element_ids_still_exist():
    html = read(HTML)
    # 색상 hex(#ff6a2b)와 설명용 자리표시자(#id)는 element id가 아니다
    ids = {i for i in backticked(r"#[a-zA-Z][\w-]*")
           if i != "#id" and not re.fullmatch(r"#[0-9a-fA-F]{3,8}", i)}
    missing = [i for i in ids if f'id="{i[1:]}"' not in html]
    assert not missing, f"문서에 있는데 game.html에 없는 id: {sorted(missing)}"


def test_css_tokens_still_exist():
    html = read(HTML)
    missing = [t for t in backticked(r"--[a-z][a-z0-9-]*") if f"{t}:" not in html]
    assert not missing, f"문서에 있는데 game.html에 없는 CSS 토큰: {sorted(missing)}"


def test_event_kinds_still_handled():
    """문서의 이벤트 표에 적힌 kind는 프론트엔드가 실제로 처리해야 한다."""
    html = read(HTML)
    from pedalquest.achievements import ACHIEVEMENTS  # noqa: F401  (achievement 이벤트는 별도 경로)
    kinds = {k for k in backticked(r"[a-z]+_[a-z_]+") if k != "session_log"}
    handled = set(re.findall(r'case "([a-z_]+)":', html)) | set(re.findall(r'kind === "([a-z_]+)"', html))
    missing = [k for k in kinds if k not in handled]
    assert not missing, f"문서가 말하는데 game.html이 처리하지 않는 이벤트: {sorted(missing)}"


@pytest.mark.parametrize("name,path", [("THEMES", HTML), ("T3", JS)])
def test_theme_tables_still_named_as_documented(name, path):
    assert re.search(rf"\b(const|let)\s+{name}\s*=", read(path)), f"{name} 테이블 이름이 바뀌었다"


def test_documented_theme_keys_exist():
    html = read(HTML)
    for key in ("city", "suburb", "mountain", "beach"):
        assert re.search(rf"^\s+{key}: \{{", html, re.M), f"THEMES에 {key} 없음"
