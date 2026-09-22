// ============================================================
// PedalQuest 3인칭 라이더 — 스프라이트 시트
//
// 뒤에서 본 내 모습을 그려둔 프레임 묶음으로 재생한다.
// 2D·3D 어느 렌더러를 쓰든 이 함수가 화면 맨 위에 겹쳐 그린다
// (3D에서는 원래 내 몸을 3D 메시로 세우는데, 스프라이트가 준비되면 그쪽을 끈다).
//
// game.html의 전역(H, W, ctx, disp, clamp)을 그대로 쓴다.
//
// 시트가 없으면 아무것도 하지 않고 false를 돌려준다 → 부르는 쪽이 기존
// drawRider(도형으로 그린 라이더)로 넘어간다. 그림 파일 하나 없다고
// 화면에서 내가 사라지면 안 된다.
// ============================================================

// 시트는 알파가 있는 lossy WebP다 (원본 PNG는 20MB, WebP는 3.6MB — art/에 원본이 있고
// tools/sprite_pack.py가 만든다). 터치 기기는 절반 크기를 받는다: 스프라이트를 약 420px
// 높이로만 그리므로 절반이면 충분하고, 디코딩이 73MB → 18MB로 줄어 저사양 태블릿이 버틴다.
// PC는 약 940px 높이로 그려서 원본(칸 684px)도 이미 확대해 쓰는 중이라 줄이면 흐려진다.
const R3P_SMALL = matchMedia("(pointer: coarse)").matches;
const R3P_SHEET = `/static/cyclist-spritesheet${R3P_SMALL ? "-half" : ""}.webp`;
const R3P_META = "/static/cyclist-sprite-meta.json";

// ── 배치 ──
// 시트 한 칸은 세로로 긴 그림이라 높이로 맞춘다. 가로가 너무 넓어지면(세로로
// 납작한 화면) 폭으로 한 번 더 조인다.
const R3P_HEIGHT = 0.70;     // 화면 높이 대비 스프라이트 높이 (앞이 가리지 않을 만큼)
const R3P_MAX_WIDTH = 0.34;  // 화면 폭 대비 상한
const R3P_BOTTOM = 1.0;      // 스프라이트 아래끝이 놓일 화면 높이 (1 = 화면 맨 아래)

// ── 재생 속도 ──
// 시트는 크랭크 한 바퀴가 아니라 영상을 통째로 잘라온 것이라(프레임 수가
// 한 바퀴와 맞아떨어지지 않는다) 크랭크 각도에 맞물릴 수 없다.
// 그래서 속도에 비례해 재생한다: R3P_REF_SPEED에서 원본 fps 그대로 돈다.
const R3P_REF_SPEED = 24;    // km/h
const R3P_RATE_MAX = 2.4;    // 너무 빨리 돌면 깜빡이는 것처럼 보인다
const R3P_STOP_SPEED = 0.8;  // km/h. 이보다 느리면 아예 멈춘다

const r3pSheet = { img: null, meta: null, ok: false, warned: false };
let r3pFrameT = 0, r3pPrevNow = 0;

(function loadRider3p() {
  const img = new Image();
  img.onload = () => { r3pSheet.img = img; r3pReady(); };
  img.onerror = () => {
    console.warn(`[rider3p] 스프라이트 시트를 못 읽었습니다: ${R3P_SHEET} — 도형으로 그린 라이더로 대신합니다`);
    r3pSheet.img = null;
  };
  img.src = R3P_SHEET;

  fetch(R3P_META)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { r3pSheet.meta = m; r3pReady(); })
    .catch(() => { r3pSheet.meta = null; });
})();

// 시트와 메타가 둘 다 오면 칸 크기를 확정한다.
// 메타의 frameWidth/Height는 참고값으로만 쓴다 — 시트를 나중에 줄이거나 키우면
// 어긋나는데, 실제로 잘라야 하는 건 "이미지를 cols×rows로 나눈 칸"이다.
function r3pReady() {
  const { img, meta } = r3pSheet;
  if (!img || !meta) return;
  const cols = meta.cols | 0, rows = meta.rows | 0;
  const frames = (meta.frames | 0) || cols * rows;
  if (cols < 1 || rows < 1 || frames < 1) return;
  const fw = img.naturalWidth / cols, fh = img.naturalHeight / rows;
  if (!fw || !fh) return;
  // 메타의 frameWidth/Height는 **비율만** 본다. 크기는 달라도 된다 — 태블릿은 절반 크기
  // 시트를 받으므로 칸도 절반이다. 비율까지 어긋나면 cols/rows가 틀린 것이라 알린다.
  if (!r3pSheet.warned && meta.frameWidth && meta.frameHeight) {
    const want = meta.frameWidth / meta.frameHeight;
    if (Math.abs(fw / fh - want) > 0.02) {
      console.warn(`[rider3p] 메타 비율(${meta.frameWidth}x${meta.frameHeight})과 실제 칸(${fw.toFixed(1)}x${fh.toFixed(1)})이 다릅니다. cols/rows를 확인하세요.`);
      r3pSheet.warned = true;
    }
  }
  Object.assign(r3pSheet, { cols, rows, frames, fw, fh, fps: meta.fps || 12, ok: true });
}

// 지금 스프라이트로 그리나. 부르는 쪽이 3D 메시를 끌지 결정할 때도 같은 답을 써야 한다
// — 한쪽만 보고 판단하면 라이더가 둘로 보이거나 아예 사라진다.
//
// 메뉴 배경도 뒷모습으로 그리지만(fp가 아님) 거기엔 스프라이트를 쓰지 않는다.
// 메뉴는 화면 전체에 어두운 막이 덮여 있어서 큰 인물이 검은 덩어리로만 보인다.
function rider3pActive() {
  return r3pSheet.ok && typeof view !== "undefined" && view === "game";
}

// 재생 위치를 앞으로 돌린다. 속도가 0이면 제자리에 선다.
function r3pAdvance(now) {
  // 음수 dt를 막는다 — 콕핏에서 겪은 것과 같은 함정이다.
  const dt = r3pPrevNow ? clamp((now - r3pPrevNow) / 1000, 0, 0.1) : 0;
  r3pPrevNow = now;
  if (disp.speed <= R3P_STOP_SPEED) return;
  const rate = Math.min(R3P_RATE_MAX, disp.speed / R3P_REF_SPEED);
  r3pFrameT = (r3pFrameT + dt * r3pSheet.fps * rate) % r3pSheet.frames;
}

// 3인칭 라이더를 그린다. 그렸으면 true, 시트가 없어 못 그렸으면 false.
// o: drawRider와 같은 옵션 중 이펙트만 쓴다 (flame, bubble, rainbow, dizzy, tilt, standing).
function drawRiderSprite(now, o = {}) {
  if (!rider3pActive()) return false;
  r3pAdvance(now);

  const { img, cols, fw, fh } = r3pSheet;
  const i = Math.floor(r3pFrameT) % r3pSheet.frames;
  const sx = (i % cols) * fw, sy = Math.floor(i / cols) * fh;

  // 화면에 놓을 크기 — 높이 기준, 폭이 넘치면 조인다
  let dh = H * R3P_HEIGHT, dw = dh * (fw / fh);
  if (dw > W * R3P_MAX_WIDTH) { dw = W * R3P_MAX_WIDTH; dh = dw * (fh / fw); }

  // 페달 박자에 맞춘 좌우 흔들림 + 속도에 비례한 노면 진동.
  // 콕핏과 같은 감각이어야 시점을 바꿔도 같은 자전거를 탄 느낌이 난다.
  const u = dh / 100;
  const sway = Math.sin(disp.angle) * (o.standing ? 1.6 : 0.6) * u;
  const buzz = disp.speed > 3
    ? Math.sin(now / 23) * Math.sin(now / 37) * clamp(disp.speed / 40, 0, 1) * 0.4 * u
    : 0;
  const cx = W / 2 + sway;
  const by = H * R3P_BOTTOM + buzz;
  const dx = cx - dw / 2, dy = by - dh;

  ctx.save();
  if (o.tilt) { ctx.translate(cx, by); ctx.rotate(o.tilt); ctx.translate(-cx, -by); }

  // 부스트 불꽃은 자전거 뒤에서 뿜으므로 스프라이트보다 먼저
  if (o.flame) {
    const fl = (0.3 + Math.random() * 0.25) * dh * 0.18;
    ctx.fillStyle = "rgba(255,140,0,0.85)";
    ctx.beginPath();
    ctx.moveTo(cx - 0.05 * dw, by - 0.02 * dh); ctx.lineTo(cx + 0.05 * dw, by - 0.02 * dh); ctx.lineTo(cx, by + fl);
    ctx.fill();
    ctx.fillStyle = "rgba(255,230,90,0.9)";
    ctx.beginPath();
    ctx.moveTo(cx - 0.025 * dw, by - 0.02 * dh); ctx.lineTo(cx + 0.025 * dw, by - 0.02 * dh); ctx.lineTo(cx, by + fl * 0.6);
    ctx.fill();
  }

  // ⭐무적: 색을 돌린다. filter를 못 쓰는 브라우저면 그냥 원래 색으로 나온다.
  const canFilter = typeof ctx.filter === "string";
  if (o.rainbow && canFilter) ctx.filter = `hue-rotate(${Math.round(now / 4) % 360}deg) saturate(1.4)`;
  ctx.drawImage(img, sx, sy, fw, fh, dx, dy, dw, dh);
  if (o.rainbow && canFilter) ctx.filter = "none";

  if (o.bubble) {   // 🛡바람막이
    ctx.fillStyle = "rgba(120,220,255,0.18)";
    ctx.strokeStyle = "rgba(160,235,255,0.8)";
    ctx.lineWidth = Math.max(1, 0.5 * u);
    ctx.beginPath();
    ctx.ellipse(cx, by - dh * 0.45, dw * 0.62, dh * 0.52, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
  if (o.dizzy) {
    ctx.font = `${Math.round(9 * u)}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText("💫", cx + Math.sin(now / 120) * 6 * u, dy + 6 * u);
  }
  ctx.restore();
  return true;
}
