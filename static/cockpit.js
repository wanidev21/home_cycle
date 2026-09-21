// ============================================================
// PedalQuest 1인칭 콕핏 — 모바일 게임 애니메이션 스타일
// game.html의 전역(H, W, ctx, disp, clamp, lerp, mod, NUM_FONT)을 그대로 쓴다.
// 2D·3D 어느 렌더러를 쓰든 이 함수가 1인칭 콕핏을 전부 그린다
// (3D 쪽 콕핏 메시는 숨긴다 — 핸들바·속도계를 두 번 그리면 겹친다).
// 스타일을 갈아끼울 때는 이 파일만 바꾸면 된다.
// ============================================================
//
// 스타일 키워드: 블루아카이브/니케/에픽세븐 급 모바일 게임 일러스트
// - 굵은 외곽선 (dark outline, 2-3px)
// - 셀 셰이딩 (베이스 → 그림자 → 하이라이트, 3톤)
// - 깔끔한 곡선, 매끄러운 실루엣
// - 장갑/저지에 디테일 (스티칭, 로고, 패턴)
//
// 통합: templates/game.html의 drawCockpit(now, o)를 이 코드로 교체
// ============================================================

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

  // ================================================================
  // 1) 앞바퀴
  // ================================================================
  const wheelCy = by + 6 * u;
  const wheelRx = 4.2 * u;
  const wheelRy = 24 * u;

  // 타이어 외곽선 (두꺼운 아웃라인)
  ctx.beginPath();
  ctx.ellipse(cx, wheelCy, wheelRx + OL * 0.5, wheelRy + OL * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#0a0a0a";
  ctx.fill();

  // 타이어 본체
  ctx.beginPath();
  ctx.ellipse(cx, wheelCy, wheelRx, wheelRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#1e2024";
  ctx.fill();

  // 타이어 트레드 (속도에 맞춰 흘러감)
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, wheelCy, wheelRx, wheelRy, 0, 0, Math.PI * 2);
  ctx.clip();
  const tread = mod(disp.dist * 40, 3.2) * u;
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let yy = wheelCy - wheelRy + tread; yy < by + 20 * u; yy += 3.2 * u) {
    ctx.fillRect(cx - wheelRx * 0.6, yy, wheelRx * 1.2, 0.7 * u);
  }
  // 림 하이라이트
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(cx - wheelRx * 0.85, wheelCy - wheelRy, wheelRx * 0.22, wheelRy * 2);
  // 가운데 하이라이트 (림 반사)
  ctx.fillStyle = "rgba(200,220,255,0.08)";
  ctx.fillRect(cx - wheelRx * 0.15, wheelCy - wheelRy * 0.7, wheelRx * 0.3, wheelRy * 1.4);
  ctx.restore();

  // ================================================================
  // 2) 무릎 (크랭크 각도 연동)
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

  // ================================================================
  // 3) 자전거 프레임 (탑튜브 + 헤드튜브 + 스템)
  // ================================================================
  // 헤드튜브 외곽선
  ctx.beginPath();
  ctx.moveTo(cx - 2.6 * u, by - 28 * u);
  ctx.lineTo(cx + 2.6 * u, by - 28 * u);
  ctx.lineTo(cx + 4 * u, by + 2 * u);
  ctx.lineTo(cx - 4 * u, by + 2 * u);
  ctx.closePath();
  ctx.fillStyle = "#0a0c10";
  ctx.fill();

  // 헤드튜브 본체 (셀 셰이딩 — 카본 느낌)
  ctx.beginPath();
  ctx.moveTo(cx - 2.2 * u, by - 27 * u);
  ctx.lineTo(cx + 2.2 * u, by - 27 * u);
  ctx.lineTo(cx + 3.6 * u, by + 1 * u);
  ctx.lineTo(cx - 3.6 * u, by + 1 * u);
  ctx.closePath();
  const frameFill = cellGrad(cx, by - 27 * u, by + 1 * u, "#3a3e48", "#252830", "#16181c");
  ctx.fillStyle = frameFill;
  ctx.fill();
  // 카본 하이라이트 라인
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 0.7 * u;
  ctx.beginPath();
  ctx.moveTo(cx - 1.5 * u, by - 26 * u);
  ctx.lineTo(cx - 2.5 * u, by);
  ctx.stroke();

  // 스템 (핸들바 아래)
  ctx.fillStyle = "#1d2025";
  ctx.beginPath();
  ctx.moveTo(cx - 2.2 * u, by - 35 * u);
  ctx.lineTo(cx + 2.2 * u, by - 35 * u);
  ctx.lineTo(cx + 3 * u, by - 24 * u);
  ctx.lineTo(cx - 3 * u, by - 24 * u);
  ctx.closePath();
  fillAndStroke("#1d2025", "#0a0c10", OL_THIN);

  // ================================================================
  // 4) 핸들바
  // ================================================================
  const barY = by - 30 * u;

  // 핸들바 외곽선 (두꺼운 라인)
  ctx.strokeStyle = "#0a0a0a";
  ctx.lineWidth = 3.2 * u;
  ctx.beginPath();
  ctx.moveTo(cx - 22 * u, barY - 3 * u);
  ctx.quadraticCurveTo(cx - 20 * u, barY + 1.2 * u, cx - 12 * u, barY + 0.8 * u);
  ctx.lineTo(cx + 12 * u, barY + 0.8 * u);
  ctx.quadraticCurveTo(cx + 20 * u, barY + 1.2 * u, cx + 22 * u, barY - 3 * u);
  ctx.stroke();

  // 핸들바 본체
  ctx.strokeStyle = TAPE;
  ctx.lineWidth = 2.4 * u;
  ctx.beginPath();
  ctx.moveTo(cx - 22 * u, barY - 3 * u);
  ctx.quadraticCurveTo(cx - 20 * u, barY + 1.2 * u, cx - 12 * u, barY + 0.8 * u);
  ctx.lineTo(cx + 12 * u, barY + 0.8 * u);
  ctx.quadraticCurveTo(cx + 20 * u, barY + 1.2 * u, cx + 22 * u, barY - 3 * u);
  ctx.stroke();

  // 핸들바 하이라이트
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 0.5 * u;
  ctx.beginPath();
  ctx.moveTo(cx - 11 * u, barY + 0.2 * u);
  ctx.lineTo(cx + 11 * u, barY + 0.2 * u);
  ctx.stroke();

  // 스템 클램프
  ctx.beginPath();
  ctx.roundRect
    ? ctx.roundRect(cx - 2.8 * u, barY - 2 * u, 5.6 * u, 4.6 * u, 0.6 * u)
    : ctx.rect(cx - 2.8 * u, barY - 2 * u, 5.6 * u, 4.6 * u);
  fillAndStroke("#2a2e35", "#0a0c10", OL_THIN);
  // 볼트 디테일
  for (const dy of [-0.6, 1.2]) {
    ctx.fillStyle = "#444850";
    ctx.beginPath();
    ctx.arc(cx, barY + dy * u, 0.5 * u, 0, Math.PI * 2);
    ctx.fill();
  }

  // ================================================================
  // 5) 속도계 (스템 마운트)
  // ================================================================
  const gw = 13 * u, gh = 6.6 * u, gy = barY - 9.8 * u;

  // 마운트 바
  ctx.fillStyle = "#1a1e24";
  ctx.fillRect(cx - 1.2 * u, gy + gh - 0.5 * u, 2.4 * u, 4.2 * u);

  // 속도계 외곽선
  ctx.beginPath();
  ctx.roundRect
    ? ctx.roundRect(cx - gw / 2 - OL * 0.3, gy - OL * 0.3, gw + OL * 0.6, gh + OL * 0.6, 1.4 * u)
    : ctx.rect(cx - gw / 2 - OL * 0.3, gy - OL * 0.3, gw + OL * 0.6, gh + OL * 0.6);
  ctx.fillStyle = "#0a0a0a";
  ctx.fill();

  // 속도계 본체
  ctx.beginPath();
  ctx.roundRect
    ? ctx.roundRect(cx - gw / 2, gy, gw, gh, 1.2 * u)
    : ctx.rect(cx - gw / 2, gy, gw, gh);
  ctx.fillStyle = "#121418";
  ctx.fill();

  // LCD 화면
  ctx.fillStyle = "#c9d6c4";
  ctx.fillRect(cx - gw / 2 + 0.8 * u, gy + 0.8 * u, gw - 1.6 * u, gh - 1.6 * u);

  // 속도 텍스트
  ctx.fillStyle = "#1b2219";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(3.3 * u)}px ${NUM_FONT}`;
  ctx.fillText(disp.speed.toFixed(1), cx - 1.6 * u, gy + gh * 0.52);
  ctx.font = `600 ${Math.round(1.25 * u)}px system-ui`;
  ctx.fillText("km/h", cx + 4 * u, gy + gh * 0.72);

  // LCD 반사광 (모바일 게임 느낌)
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(cx - gw / 2 + 1 * u, gy + 1 * u);
  ctx.lineTo(cx + gw / 2 - 1 * u, gy + 1 * u);
  ctx.lineTo(cx + gw / 2 - 3 * u, gy + gh * 0.4);
  ctx.lineTo(cx - gw / 2 + 1 * u, gy + gh * 0.4);
  ctx.closePath();
  ctx.fill();

  // ================================================================
  // 6) 팔 + 장갑 (메인 비주얼!)
  // ================================================================
  for (const s of [-1, 1]) {
    const hx = cx + s * 21 * u, hy = barY - 2.2 * u;     // 손 (후드 위)
    const ex = cx + s * 33 * u, ey = by - 4 * u;          // 팔꿈치
    const sx = cx + s * 44 * u, sy = by + 16 * u;         // 어깨

    // --- 방향 벡터 (팔뚝) ---
    const nx = -(hy - ey), ny = hx - ex, nl = Math.hypot(nx, ny);
    const px = nx / nl, py = ny / nl;

    // =====================
    // 6-a) 소매 (저지 색)
    // =====================
    // 소매 외곽선
    ctx.strokeStyle = JERSEY.outline;
    ctx.lineWidth = 16 * u;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(lerp(sx, ex, 0.84), lerp(sy, ey, 0.84));
    ctx.stroke();

    // 소매 본체
    ctx.strokeStyle = JERSEY.base;
    ctx.lineWidth = 15 * u;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(lerp(sx, ex, 0.82), lerp(sy, ey, 0.82));
    ctx.stroke();

    // 소매 그림자 (아래쪽)
    ctx.strokeStyle = JERSEY.shadow;
    ctx.lineWidth = 15 * u;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(lerp(sx, ex, 0.4), lerp(sy, ey, 0.4));
    ctx.lineTo(lerp(sx, ex, 0.82), lerp(sy, ey, 0.82));
    ctx.stroke();
    ctx.lineCap = "round";

    // 소매 줄무늬 (브랜드 포인트)
    ctx.strokeStyle = o.stripe || "#ffffff";
    ctx.lineWidth = 15.2 * u;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(lerp(sx, ex, 0.68), lerp(sy, ey, 0.68));
    ctx.lineTo(lerp(sx, ex, 0.74), lerp(sy, ey, 0.74));
    ctx.stroke();
    ctx.lineCap = "round";

    // 소매 하이라이트 (윗면)
    ctx.strokeStyle = JERSEY.highlight;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 5 * u;
    ctx.beginPath();
    ctx.moveTo(lerp(sx, ex, 0.1), lerp(sy, ey, 0.1));
    ctx.lineTo(lerp(sx, ex, 0.6), lerp(sy, ey, 0.6));
    ctx.stroke();
    ctx.globalAlpha = 1;

    // =====================
    // 6-b) 팔뚝 (피부)
    // =====================
    const armW_e = 6.5 * u;   // 팔꿈치 쪽 (가까우니까 굵게)
    const armW_h = 3.2 * u;   // 손목 쪽 (멀으니까 가늘게)

    // 팔뚝 외곽선
    ctx.beginPath();
    ctx.moveTo(ex + px * (armW_e + OL * 0.4), ey + py * (armW_e + OL * 0.4));
    ctx.lineTo(hx + px * (armW_h + OL * 0.4), hy + py * (armW_h + OL * 0.4));
    ctx.lineTo(hx - px * (armW_h + OL * 0.4), hy - py * (armW_h + OL * 0.4));
    ctx.lineTo(ex - px * (armW_e + OL * 0.4), ey - py * (armW_e + OL * 0.4));
    ctx.closePath();
    ctx.fillStyle = SKIN.outline;
    ctx.fill();

    // 팔뚝 본체 (셀 셰이딩)
    ctx.beginPath();
    ctx.moveTo(ex + px * armW_e, ey + py * armW_e);
    ctx.lineTo(hx + px * armW_h, hy + py * armW_h);
    ctx.lineTo(hx - px * armW_h, hy - py * armW_h);
    ctx.lineTo(ex - px * armW_e, ey - py * armW_e);
    ctx.closePath();
    ctx.fillStyle = cellGrad(
      (hx + ex) / 2, Math.min(hy, ey), Math.max(hy, ey),
      SKIN.highlight, SKIN.base, SKIN.shadow
    );
    ctx.fill();

    // 팔뚝 하이라이트 (모바일 게임 특유의 림 라이트)
    const rimSide = s > 0 ? 1 : -1;
    ctx.fillStyle = "rgba(255,240,220,0.15)";
    ctx.beginPath();
    ctx.moveTo(ex + px * armW_e * rimSide * 0.9, ey + py * armW_e * rimSide * 0.9);
    ctx.lineTo(hx + px * armW_h * rimSide * 0.9, hy + py * armW_h * rimSide * 0.9);
    ctx.lineTo(hx + px * armW_h * rimSide * 0.4, hy + py * armW_h * rimSide * 0.4);
    ctx.lineTo(ex + px * armW_e * rimSide * 0.4, ey + py * armW_e * rimSide * 0.4);
    ctx.closePath();
    ctx.fill();

    // 팔꿈치 → 소매 전환부 (그림자)
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.ellipse(
      lerp(ex, hx, -0.08), lerp(ey, hy, -0.08),
      armW_e * 1.1, armW_e * 0.4,
      Math.atan2(hy - ey, hx - ex), 0, Math.PI * 2
    );
    ctx.fill();

    // =====================
    // 6-c) 장갑 (핵심 비주얼!)
    // =====================

    // 브레이크 후드 (장갑 아래에 살짝 보임)
    ctx.fillStyle = "#15171a";
    ctx.beginPath();
    ctx.ellipse(hx + s * 0.4 * u, hy - 2.6 * u, 1.8 * u, 2.6 * u, s * 0.2, 0, Math.PI * 2);
    ctx.fill();

    // 장갑 전체 실루엣 외곽선
    ctx.fillStyle = GLOVE.outline;
    ctx.beginPath();
    ctx.ellipse(hx, hy + 0.4 * u, 4.6 * u, 4.2 * u, s * 0.45, 0, Math.PI * 2);
    ctx.fill();

    // 장갑 본체 (셀 셰이딩)
    const gloveFill = cellGrad(hx, hy - 3 * u, hy + 4 * u, GLOVE.highlight, GLOVE.base, GLOVE.shadow);
    ctx.fillStyle = gloveFill;
    ctx.beginPath();
    ctx.ellipse(hx, hy + 0.4 * u, 4.2 * u, 3.8 * u, s * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // 너클 (관절 돌기 — 3개)
    for (let k = -1; k <= 1; k++) {
      // 너클 하이라이트 (위)
      ctx.fillStyle = GLOVE.highlight;
      ctx.beginPath();
      ctx.ellipse(
        hx + k * 1.4 * u - s * 0.5 * u, hy - 2.0 * u,
        1.0 * u, 0.55 * u, 0, 0, Math.PI * 2
      );
      ctx.fill();
      // 너클 그림자 (아래)
      ctx.fillStyle = GLOVE.shadow;
      ctx.beginPath();
      ctx.ellipse(
        hx + k * 1.4 * u - s * 0.5 * u, hy - 1.3 * u,
        0.9 * u, 0.4 * u, 0, 0, Math.PI * 2
      );
      ctx.fill();
    }

    // 손가락 관절선 (스티칭 디테일)
    ctx.strokeStyle = GLOVE.accent;
    ctx.lineWidth = OL_THIN * 0.6;
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.arc(
        hx + k * 1.4 * u - s * 0.5 * u, hy - 1.6 * u,
        0.7 * u, 0, Math.PI
      );
      ctx.stroke();
    }

    // 장갑 로고 (저지 색 포인트)
    ctx.fillStyle = GLOVE.logo;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(
      hx - s * 0.3 * u, hy + 1.2 * u,
      1.5 * u, 0.8 * u, s * 0.3, 0, Math.PI * 2
    );
    ctx.fill();
    ctx.globalAlpha = 1;

    // 장갑 메시 패턴 (통풍구 느낌)
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 0.3 * u;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.moveTo(hx + k * 1.2 * u, hy - 3 * u);
      ctx.lineTo(hx + k * 1.2 * u + s * 0.5 * u, hy + 2 * u);
      ctx.stroke();
    }

    // 장갑 전체 하이라이트 (모바일 게임 광택)
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.beginPath();
    ctx.ellipse(
      hx - s * 1.2 * u, hy - 0.8 * u,
      2.2 * u, 1.2 * u, s * 0.35, 0, Math.PI * 2
    );
    ctx.fill();

    // 벨크로 밴드 (손목)
    ctx.fillStyle = "#333338";
    ctx.beginPath();
    const wristX = hx + s * 1 * u, wristY = hy + 2.8 * u;
    ctx.ellipse(wristX, wristY, 3.5 * u, 1.2 * u, s * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = GLOVE.outline;
    ctx.lineWidth = OL_THIN * 0.7;
    ctx.stroke();
    // 벨크로 디테일
    ctx.fillStyle = "#444448";
    ctx.beginPath();
    ctx.ellipse(wristX - s * 0.5 * u, wristY - 0.2 * u, 1.8 * u, 0.6 * u, s * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  // ================================================================
  // 7) 방어막 효과 (아케이드)
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

// ============================================================
// shadeColor: hex 색상의 밝기를 percent%만큼 조절
// drawCockpit 바깥에 선언해야 함 (또는 전역 유틸)
// ============================================================
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