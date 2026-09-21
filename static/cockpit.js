// ============================================================
// PedalQuest 1인칭 콕핏 — 스프라이트 + 코드 혼합
//
// 팔·손·핸들바는 그려둔 PNG를 쓴다 (도형으로는 나오지 않는 질감).
// 무릎은 아직 코드로 그린다: 무릎 PNG에 도로 배경과 핸들바가 같이 찍혀 있어
// 3D 월드 위에 얹으면 도로가 두 겹이 되고 핸들바가 둘이 된다.
// 배경이 지워진 다리 PNG가 생기면 아래 kneeL/kneeR가 자동으로 그쪽을 쓴다.
//
// game.html의 전역(H, W, ctx, disp, clamp, NUM_FONT)을 그대로 쓴다.
// 2D·3D 어느 렌더러를 쓰든 이 함수가 1인칭 콕핏을 전부 그린다.
// ============================================================

// 스프라이트는 있으면 쓰고 없으면 건너뛴다. 하나가 없다고 콕핏 전체가 사라지면 안 된다.
const COCKPIT_SPRITES = {
  arms: "/static/cockpit-arms.png",
  kneeL: "/static/knee-left.png",
  kneeR: "/static/knee-right.png",
};
const cockpitImg = {};
for (const [key, url] of Object.entries(COCKPIT_SPRITES)) {
  const img = new Image();
  img.onerror = () => { img.missing = true; };
  img.src = url;
  cockpitImg[key] = img;
}
// naturalWidth는 로드가 끝나야 0이 아니다 → 이 한 줄이 "쓸 수 있나"의 전부
const usable = (img) => !!(img && !img.missing && img.naturalWidth);
const SHOW_KNEES = true;
// 무릎 스프라이트 배치. 그림 속 무릎은 가로 63% / 세로 70% 지점에 있다.
const KNEE_WIDTH = 0.44;        // 화면 폭 대비
const KNEE_AT_X = 0.15;         // 화면 가운데에서 좌우로 이만큼
const KNEE_AT_Y = 0.93;         // 페달이 아래일 때의 무릎 높이 (낮게 — 높으면 반바지가 바 위로 올라온다)
const KNEE_LIFT = 0.085;        // 페달이 위로 올 때 들리는 양
const KNEE_IN_SPRITE_X = 0.63;
const KNEE_IN_SPRITE_Y = 0.70;
const KNEE_CLIP_ABOVE = 2;      // 핸들바보다 이만큼(u) 위까지만 무릎이 보인다
// 팔 스프라이트 배치. 그림 속 핸들바는 이미지 높이의 약 54% 지점에 있다.
const ARMS_WIDTH = 0.74;     // 화면 폭 대비
const BAR_AT_Y = 0.70;       // 핸들바가 놓일 화면 높이 (0=위, 1=아래)
const BAR_IN_SPRITE = 0.54;

function drawCockpit(now, o) {
  const u = Math.min(H, W * 0.62) / 100;
  const climbing = o.standing;
  const sway = Math.sin(disp.angle) * (climbing ? 1.4 : 0.5) * u;
  const buzz = disp.speed > 3
    ? Math.sin(now / 23) * Math.sin(now / 37) * clamp(disp.speed / 40, 0, 1) * 0.35 * u
    : 0;
  const cx = W / 2 + sway, by = H + buzz;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // ── 색상 팔레트 (셀 셰이딩 3톤) ──
  const SKIN = {
    base: "#e8b896",
    shadow: "#c9946e",
    highlight: "#fad4b8",
    outline: "#8a5a3a",
  };
  const GLOVE = {
    base: "#2a2a2a",
    shadow: "#151515",
    highlight: "#4a4a4a",
    accent: "#555555",       // 스티칭 선
    logo: o.jersey || "#ff6b35",    // 장갑 로고 = 저지 색
    outline: "#0a0a0a",
  };
  const JERSEY = {
    base: o.jersey || "#ff6b35",
    shadow: shadeColor(o.jersey || "#ff6b35", -30),
    highlight: shadeColor(o.jersey || "#ff6b35", 40),
    outline: shadeColor(o.jersey || "#ff6b35", -50),
  };
  const SHORTS = {
    base: o.shorts || "#1a1c20",
    shadow: "#0e0f12",
    highlight: "#2e3038",
    outline: "#08090b",
  };
  const TAPE = o.rainbow ? `hsl(${(now / 4) % 360},90%,55%)` : "#1a1c20";
  const OL = 1.8 * u;  // 기본 외곽선 두께
  const OL_THIN = 0.8 * u;  // 디테일 외곽선

  // ── 유틸: 외곽선 + 채우기 그리기 ──
  function fillAndStroke(fillColor, outlineColor, lineW) {
    ctx.fillStyle = fillColor;
    ctx.fill();
    if (outlineColor && lineW > 0) {
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = lineW;
      ctx.stroke();
    }
  }

  // ── 유틸: 셀 셰이딩 그라데이션 (위→아래, 하이라이트→베이스→그림자) ──
  function cellGrad(x, y1, y2, hi, base, shadow) {
    const g = ctx.createLinearGradient(x, y1, x, y2);
    g.addColorStop(0, hi);
    g.addColorStop(0.35, base);
    g.addColorStop(1, shadow);
    return g;
  }

  // 팔 스프라이트 위치를 먼저 잡는다. 무릎을 어디서 자를지(핸들바 높이) 알아야 한다.
  const arms = cockpitImg.arms;
  const armsOk = usable(arms);
  const aw = W * ARMS_WIDTH;
  const ah = armsOk ? aw * (arms.naturalHeight / arms.naturalWidth) : 0;
  const ax = W / 2 - aw / 2 + sway * 1.2;
  const ay = H * BAR_AT_Y - ah * BAR_IN_SPRITE + buzz;
  const barY = armsOk ? ay + ah * BAR_IN_SPRITE : by - 30 * u;

  // ================================================================
  // 1) 무릎 — 팔보다 먼저 (팔이 위에 와야 한다)
  // ================================================================
  if (!SHOW_KNEES) {
    // 그려 넣지 않는다 (아래 주석 참고)
  } else if (usable(cockpitImg.kneeL) && usable(cockpitImg.kneeR)) {
    // 바 위로 삐져나온 반바지는 자른다. 실제로도 핸들바가 허벅지를 가린다.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, barY - KNEE_CLIP_ABOVE * u, W, H);
    ctx.clip();
    for (const side of [-1, 1]) {
      // knee-left.png는 다리가 그림의 *오른쪽*에 있다 → 화면 오른쪽에 쓴다.
      // 두 장은 서로 좌우 반전본이라 반대쪽은 knee-right.png가 맞는다.
      const img = side < 0 ? cockpitImg.kneeR : cockpitImg.kneeL;
      const a = disp.angle + (side < 0 ? 0 : Math.PI);
      const lift = (1 - Math.cos(a)) / 2;            // 0(페달 아래) ~ 1(위)
      const kw = W * KNEE_WIDTH;
      const kh = kw * (img.naturalHeight / img.naturalWidth);
      // 그림 속 무릎이 화면의 목표 지점에 오도록 역산 (팔 스프라이트와 같은 방식)
      const ankX = side < 0 ? 1 - KNEE_IN_SPRITE_X : KNEE_IN_SPRITE_X;
      const kx = W * (0.5 + side * KNEE_AT_X) - kw * ankX + sway;
      const ky = H * KNEE_AT_Y - kh * KNEE_IN_SPRITE_Y + buzz - lift * H * KNEE_LIFT;
      const dance = climbing ? Math.sin(a) * W * 0.018 : 0;
      ctx.drawImage(img, kx + dance, ky, kw, kh);
    }
    ctx.restore();
  } else {
    // ================================================================
    for (const side of [-1, 1]) {
      const a = disp.angle + (side < 0 ? 0 : Math.PI);
      const lift = (1 - Math.cos(a)) / 2;   // 0(아래) ~ 1(위)
      const ky = by + 10 * u - lift * 24 * u;
      const kx = cx + side * (13 + lift * 2) * u;

      // --- 허벅지 (반바지) ---
      const thighTop = ky + 3.6 * u;
      const thighBot = by + 26 * u;
      const thighW = 6.8 * u;

      // 외곽선 먼저
      ctx.beginPath();
      ctx.moveTo(kx - thighW - OL * 0.3, thighTop);
      ctx.lineTo(kx + thighW + OL * 0.3, thighTop);
      ctx.lineTo(kx + side * 3 * u + 9.5 * u, thighBot);
      ctx.lineTo(kx + side * 3 * u - 9.5 * u, thighBot);
      ctx.closePath();
      ctx.fillStyle = SHORTS.outline;
      ctx.fill();

      // 반바지 본체 (셀 셰이딩)
      ctx.beginPath();
      ctx.moveTo(kx - thighW, thighTop);
      ctx.lineTo(kx + thighW, thighTop);
      ctx.lineTo(kx + side * 3 * u + 9 * u, thighBot);
      ctx.lineTo(kx + side * 3 * u - 9 * u, thighBot);
      ctx.closePath();
      ctx.fillStyle = cellGrad(kx, thighTop, thighBot, SHORTS.highlight, SHORTS.base, SHORTS.shadow);
      ctx.fill();

      // 반바지 밑단 라인 (디테일)
      ctx.strokeStyle = SHORTS.highlight;
      ctx.lineWidth = OL_THIN;
      ctx.beginPath();
      ctx.moveTo(kx - thighW + 0.5 * u, thighTop + 1 * u);
      ctx.lineTo(kx + thighW - 0.5 * u, thighTop + 1 * u);
      ctx.stroke();

      // 반바지 사이드 스트라이프 (저지 색 포인트)
      ctx.fillStyle = JERSEY.base;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(
        kx + side * (thighW - 1.2 * u), thighTop + 2 * u,
        side * 1.0 * u, (thighBot - thighTop) * 0.5
      );
      ctx.globalAlpha = 1;

      // --- 무릎 (피부) ---
      // 외곽선
      ctx.beginPath();
      ctx.ellipse(kx, ky + 1.5 * u, 6.6 * u, 3.3 * u, 0, Math.PI, 0);
      ctx.lineTo(kx + 6.8 * u, ky + 4.2 * u);
      ctx.lineTo(kx - 6.8 * u, ky + 4.2 * u);
      ctx.closePath();
      ctx.fillStyle = SKIN.outline;
      ctx.fill();

      // 무릎 본체 (셀 셰이딩)
      ctx.beginPath();
      ctx.ellipse(kx, ky + 1.5 * u, 6.2 * u, 3 * u, 0, Math.PI, 0);
      ctx.lineTo(kx + 6.4 * u, ky + 4 * u);
      ctx.lineTo(kx - 6.4 * u, ky + 4 * u);
      ctx.closePath();
      ctx.fillStyle = cellGrad(kx, ky - 1 * u, ky + 4 * u, SKIN.highlight, SKIN.base, SKIN.shadow);
      ctx.fill();

      // 무릎 하이라이트 (반사광 — 모바일 게임 특유의 광택)
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.ellipse(kx - side * 1.5 * u, ky + 0.8 * u, 2.5 * u, 1.3 * u, side * 0.2, 0, Math.PI * 2);
      ctx.fill();

      // 무릎뼈 그림자 (은은하게)
      ctx.fillStyle = "rgba(0,0,0,0.10)";
      ctx.beginPath();
      ctx.ellipse(kx + side * 2 * u, ky + 1.8 * u, 2.2 * u, 1.2 * u, 0, 0, Math.PI * 2);
      ctx.fill();
    }

  }

  // ================================================================
  // 2) 팔 + 손 + 핸들바 (스프라이트)
  // ================================================================
  // 화면 높이로 맞추면 팔이 화면을 다 덮는다. 폭으로 맞추고, 그림 속 핸들바가
  // 화면의 BAR_AT_Y 높이에 오도록 세로 위치를 역산했다 (위에서 계산).
  if (armsOk) ctx.drawImage(arms, ax, ay, aw, ah);

  // ================================================================
  // 3) 속도계 — 코드로 그린다 (숫자가 매 프레임 바뀌므로)
  // ================================================================
  const gw = 13 * u, gh = 6.6 * u;
  const gx = W / 2 + sway, gy = barY - gh - 1.5 * u;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(gx - gw / 2, gy, gw, gh, 1.2 * u);
  else ctx.rect(gx - gw / 2, gy, gw, gh);
  ctx.fillStyle = "#0a0a0a";
  ctx.fill();
  ctx.strokeStyle = "#000"; ctx.lineWidth = OL_THIN; ctx.stroke();
  ctx.fillStyle = "#c9d6c4";
  ctx.fillRect(gx - gw / 2 + 0.9 * u, gy + 0.9 * u, gw - 1.8 * u, gh - 1.8 * u);
  ctx.fillStyle = "#1b2219";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(3.3 * u)}px ${NUM_FONT}`;
  ctx.fillText(disp.speed.toFixed(1), gx - 1.6 * u, gy + gh * 0.5);
  ctx.font = `600 ${Math.round(1.25 * u)}px system-ui`;
  ctx.fillText("km/h", gx + 4 * u, gy + gh * 0.72);
  ctx.fillStyle = "rgba(255,255,255,0.10)";   // 유리 반사
  ctx.beginPath();
  ctx.moveTo(gx - gw / 2 + 1.1 * u, gy + 1.1 * u);
  ctx.lineTo(gx + gw / 2 - 1.1 * u, gy + 1.1 * u);
  ctx.lineTo(gx + gw / 2 - 3 * u, gy + gh * 0.42);
  ctx.lineTo(gx - gw / 2 + 1.1 * u, gy + gh * 0.42);
  ctx.closePath(); ctx.fill();

  // ================================================================
  // 4) 방어막 (아케이드)
  // ================================================================
  if (o.bubble) {
    const g = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, W * 0.7);
    g.addColorStop(0, "rgba(120,220,255,0)");
    g.addColorStop(0.7, "rgba(120,220,255,0.10)");
    g.addColorStop(1, "rgba(120,220,255,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.restore();
}

// hex 색상의 밝기를 percent%만큼 조절
function shadeColor(hex, percent) {
  if (!hex || hex.charAt(0) !== "#") return hex;
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  r = Math.min(255, Math.max(0, r + Math.round(r * percent / 100)));
  g = Math.min(255, Math.max(0, g + Math.round(g * percent / 100)));
  b = Math.min(255, Math.max(0, b + Math.round(b * percent / 100)));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
}
