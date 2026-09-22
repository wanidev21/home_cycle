// ============================================================
// PedalQuest 2.5D 패럴랙스 렌더러
//
// 3D 월드 대신, 가로로 긴 그림 다섯 장을 서로 다른 속도로 흘려 깊이를 만든다.
// 캐릭터 스프라이트와 화풍을 맞추려면 세상도 그림이어야 한다는 쪽의 답.
//
// 레이어 (뒤 → 앞):
//   sky  하늘        ×0.02
//   far  원경 산·바다 ×0.1
//   mid  중경 건물·나무 ×0.4
//   near 근경 가드레일·표지판 ×0.8
//   road 도로면       ×1.0
//
// 그 위에 3인칭 스프라이트(rider3p.js) 또는 1인칭 콕핏(cockpit.js)을 얹는다.
// 둘 다 #game 캔버스에 그리므로 여기서도 같은 ctx를 쓴다 — 3D처럼 별도 캔버스가 없다.
//
// game.html의 전역(W, H, ctx, disp, view, camMode, clamp, drawRider, ...)을 그대로 쓴다.
// ============================================================

const LAYERS = ["sky", "far", "mid", "near", "road"];

// 지도 JSON이 scrollSpeed를 안 주면 이 값. 숫자는 "도로가 1m 갈 때 이 레이어는 몇 m 가나".
const DEFAULT_SPEED = { sky: 0.02, far: 0.1, mid: 0.4, near: 0.8, road: 1.0 };

// 레이어를 화면 어디에 놓나. 지도 JSON의 layout으로 덮어쓸 수 있다.
//   full       화면 전체를 덮는다       (한 장이 통째로 한 화면인 그림. height 무시)
//   top        위끝을 화면 맨 위에      height = 화면 높이 대비 그리는 높이
//   horizon    아래끝을 지평선에        (원경·중경·근경이 지평선 위에 선다)
//   horizonTop 위끝을 지평선에          (도로가 지평선에서 아래로 깔린다)
//
// 레이어를 따로 그린 맵은 horizon 계열을, 1920x1080 한 화면으로 합성해 받은 맵은
// full을 쓴다. 후자는 지평선이 그림 안에 그려져 있으므로 맵의 horizon 값도 같이 받는다.
const DEFAULT_LAYOUT = {
  sky: { anchor: "top", height: 0.62 },
  far: { anchor: "horizon", height: 0.30 },
  mid: { anchor: "horizon", height: 0.26 },
  near: { anchor: "horizon", height: 0.17 },
  road: { anchor: "horizonTop", height: 0.60 },
};

// 도로가 1m 갈 때 화면이 움직이는 픽셀. 지도에서 pxPerM으로 덮어쓸 수 있다.
// 30km/h(8.3m/s)에 약 120px/s — 너무 빠르면 그림이 뭉개지고 느리면 안 달리는 것 같다.
const DEFAULT_PX_PER_M = 14;

const TILE_W = 1024;   // 대체 그림(placeholder) 한 장의 폭
const TILE_H = 512;

const state = {
  map: null,          // 지금 지도의 정의
  id: null,
  imgs: {},           // 레이어 → Image 또는 대체 캔버스
  index: [],          // 고를 수 있는 지도 목록 [{id, name}]
  ready: false,
};

// ------------------------------------------------------------
// 지도 불러오기
// ------------------------------------------------------------
// 지도 하나는 static/maps/<id>/map.json. layers의 경로는 /static/ 기준이다
// (사양서 예시가 "maps/coastal/sky.png" 꼴이라 그대로 맞췄다).
async function loadIndex() {
  try {
    const r = await fetch("/static/maps/index.json");
    const list = r.ok ? await r.json() : [];
    // 목록은 "coastal" 같은 문자열도, {id, name} 꼴도 받는다.
    state.index = (Array.isArray(list) ? list : [])
      .map((m) => (typeof m === "string" ? { id: m, name: m } : m))
      .filter((m) => m && m.id);
  } catch (e) {
    state.index = [];
  }
  return state.index;
}

async function loadMap(id) {
  state.ready = false;
  state.id = id;
  let map = null;
  try {
    const r = await fetch(`/static/maps/${id}/map.json`);
    if (r.ok) map = await r.json();
  } catch (e) { /* 아래에서 기본값으로 */ }
  state.map = normalize(map || { name: id }, id);

  // 그림은 한 장씩 따로 받는다. 한 장이 없다고 지도 전체가 날아가면 안 된다 —
  // 없는 레이어는 코드로 그린 대체 그림으로 채운다 (그림이 도착하기 전에도 달릴 수 있게).
  const paths = state.map.layers;
  await Promise.all(LAYERS.map(async (name) => {
    const src = paths[name];
    state.imgs[name] = src ? await loadImage(`/static/${src}`) || placeholder(name) : placeholder(name);
  }));
  state.ready = true;
  return state.map;
}

// 맵 정의를 한 가지 모양으로 맞춘다.
// 디자인 쪽에서 받는 meta는 레이어마다 객체를 준다:
//     "layers": { "sky": { "file": "layer1_sky.jpg", "speed": 0.02, "position": "full" } }
// 우리가 쓰는 모양은 경로와 속도가 따로다:
//     "layers": { "sky": "maps/x/sky.png" },  "scrollSpeed": { "sky": 0.02 }
// 둘 다 받아서 후자로 바꾼다 — 받은 파일을 손으로 옮겨 적지 않아도 되게.
function normalize(map, id) {
  const out = { ...map, layers: {}, scrollSpeed: { ...(map.scrollSpeed || {}) }, layout: { ...(map.layout || {}) } };
  out.name = map.name || map.map || id;
  for (const name of LAYERS) {
    const v = (map.layers || {})[name];
    if (!v) continue;
    if (typeof v === "string") { out.layers[name] = v; continue; }
    // 객체 모양: file은 맵 폴더 기준 파일명으로 온다
    if (v.file) out.layers[name] = `maps/${id}/${v.file}`;
    if (v.speed !== undefined && out.scrollSpeed[name] === undefined) out.scrollSpeed[name] = v.speed;
    // position 해석. "bottom"(도로)만 다르다 — 도로 그림은 노면으로 꽉 찬 한 장이라
    // 화면 전체에 깔면 다른 레이어를 다 덮는다. 지평선 아래 띠로 눌러 넣어야 바닥이 된다.
    // "mid-upper"·"bottom-strip" 같은 값은 "내용이 그림 안 어디쯤에 있다"는 설명일 뿐,
    // 그림 자체는 한 화면이므로 full과 같다.
    if (v.position && !out.layout[name]) {
      out.layout[name] = { anchor: v.position === "bottom" ? "horizonTop" : "full", height: 1 };
    }
  }
  return out;
}

function loadImage(url) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => { console.warn(`[parallax] 레이어 그림 없음: ${url} — 대체 그림을 씁니다`); res(null); };
    img.src = url;
  });
}

// ------------------------------------------------------------
// 대체 그림 — 그림이 오기 전에도 달릴 수 있게 코드로 그린다.
// **좌우 끝이 이어져야 한다.** 가로 그라데이션이나 아무 데나 찍은 무늬는 이으면
// 경계가 보인다. 그래서 세로 그라데이션 + 폭을 정수로 나누는 주기의 무늬만 쓴다.
// ------------------------------------------------------------
function paletteOf() {
  return (state.map && state.map.placeholder) || {
    sky: ["#3f7fc4", "#8fc0e4", "#dbe8f0"],
    far: "#6b86a8",
    mid: "#4f7a58",
    near: "#8d9298",
    road: "#4a4e55",
    lane: "#f0e6c8",
  };
}

function placeholder(name) {
  const c = document.createElement("canvas");
  c.width = TILE_W; c.height = TILE_H;
  const g = c.getContext("2d");
  const p = paletteOf();
  const period = TILE_W / 8;        // 폭을 정확히 나눈다 → 이어 붙여도 어긋나지 않는다

  if (name === "sky") {
    const grad = g.createLinearGradient(0, 0, 0, TILE_H);
    grad.addColorStop(0, p.sky[0]); grad.addColorStop(0.55, p.sky[1]); grad.addColorStop(1, p.sky[2]);
    g.fillStyle = grad; g.fillRect(0, 0, TILE_W, TILE_H);
  } else if (name === "far") {
    // 사인 두 개를 더한 능선. 주기가 폭을 정수로 나누므로 이어진다.
    g.fillStyle = p.far;
    g.beginPath(); g.moveTo(0, TILE_H);
    for (let x = 0; x <= TILE_W; x += 4) {
      const t = (x / TILE_W) * Math.PI * 2;
      const y = TILE_H * 0.45 - Math.sin(t * 2) * TILE_H * 0.18 - Math.sin(t * 5 + 1) * TILE_H * 0.08;
      g.lineTo(x, y);
    }
    g.lineTo(TILE_W, TILE_H); g.closePath(); g.fill();
  } else if (name === "mid") {
    // 건물·나무를 주기마다 번갈아. 한 주기 안에서만 그리므로 이음매가 없다.
    for (let i = 0; i < 8; i++) {
      const x = i * period;
      g.fillStyle = p.mid;
      if (i % 2) {
        const w = period * 0.42, h = TILE_H * (0.45 + (i % 3) * 0.12);
        g.fillRect(x + period * 0.28, TILE_H - h, w, h);
      } else {
        g.beginPath();
        g.moveTo(x + period * 0.5, TILE_H * 0.32);
        g.lineTo(x + period * 0.78, TILE_H);
        g.lineTo(x + period * 0.22, TILE_H);
        g.closePath(); g.fill();
      }
    }
  } else if (name === "near") {
    g.fillStyle = p.near;
    g.fillRect(0, TILE_H * 0.55, TILE_W, TILE_H * 0.06);          // 가드레일 가로대
    for (let i = 0; i < 16; i++) {                                 // 기둥
      g.fillRect(i * (TILE_W / 16) + 6, TILE_H * 0.55, 10, TILE_H * 0.45);
    }
  } else {
    g.fillStyle = p.road; g.fillRect(0, 0, TILE_W, TILE_H);
    g.fillStyle = p.lane;
    for (let i = 0; i < 8; i++) g.fillRect(i * period + period * 0.25, TILE_H * 0.46, period * 0.5, 6);
  }
  return c;
}

// ------------------------------------------------------------
// 그리기
// ------------------------------------------------------------
function layerBox(name) {
  const lay = (state.map.layout && state.map.layout[name]) || DEFAULT_LAYOUT[name];
  if (lay.anchor === "full") return { y: 0, h: H };
  const hz = horizonY();
  const h = H * lay.height;
  if (lay.anchor === "top") return { y: 0, h };
  if (lay.anchor === "horizonTop") return { y: hz, h: Math.max(h, H - hz) };
  return { y: hz - h, h };   // "horizon" — 아래끝이 지평선
}

// 이 맵의 지평선. 한 화면으로 합성해 받은 맵은 지평선이 그림에 그려져 있으므로
// 맵이 알려준 값을 쓴다 (안 주면 게임 기본값). 라이벌·코인 투영도 이걸 따라야
// 그림 속 길과 같은 높이에 선다.
function horizonY() {
  return state.map && state.map.horizon ? H * state.map.horizon : HORIZON;
}

// 한 레이어를 가로로 이어 붙여 화면을 채운다.
function drawLayer(name, dist) {
  const img = state.imgs[name];
  if (!img) return;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;

  const box = layerBox(name);
  const speed = (state.map.scrollSpeed || {})[name] ?? DEFAULT_SPEED[name];
  const pxPerM = state.map.pxPerM || DEFAULT_PX_PER_M;

  // **타일 크기와 위치를 정수로 맞춘다.** 소수 좌표로 붙여 그리면 타일 경계마다
  // 세로 줄이 생긴다 (캔버스가 가장자리를 보간하면서 1px이 비거나 겹친다).
  // 실제로 화면 한가운데에 줄이 그어졌다.
  const h = Math.max(1, Math.round(box.h));
  const y = Math.round(box.y);
  const w = Math.max(2, Math.round(iw * (h / ih)));   // 높이를 맞추면 폭은 따라온다

  // 끝에 닿으면 처음으로. 음수 나머지를 피하려고 한 번 더 더한다 (뒤로 갈 때).
  let off = Math.round((dist * pxPerM * speed)) % w;
  if (off < 0) off += w;

  // 도로만은 세로로 흘릴 수도 있다 ("toward"). 앞으로 나아가는 느낌은 가로 스크롤로는
  // 안 나오므로, 위에서 내려다본 노면 그림을 받으면 이쪽으로 바꾼다.
  if (name === "road" && state.map.roadMode === "toward") {
    let voff = Math.round((dist * pxPerM * speed)) % h;
    if (voff < 0) voff += h;
    for (let ry = y - h + voff; ry < H; ry += h) {
      for (let x = 0; x < W; x += w) ctx.drawImage(img, x, ry, w, h);
    }
    return;
  }

  for (let x = -off; x < W; x += w) ctx.drawImage(img, x, y, w, h);
}

// 도로 위의 것들 — 라이벌·고스트·코인·아이템 상자·바나나·결승 아치.
// 2.5D 배경에는 3D 투영이 없으니 **평지 기준**으로 직접 투영한다. 언덕은 반영하지
// 않는다 (배경 그림 자체가 언덕을 그리지 않으므로 맞춰봐야 따로 논다).
// 먼 것부터 그려야 가까운 것이 위에 온다.
function drawWorld(fp) {
  const camBack = fp ? 0.3 : 4.5, camH = fp ? 1.55 : 2.4;
  const camZ = disp.dist - camBack;
  const minZ = fp ? 3.5 : 1.2;              // 카메라에 붙으면 화면을 다 덮는다
  const list = [];
  const add = (d, lane, draw) => {
    const z = d - camZ;
    if (z < minZ) return;
    const sc = F / z;
    if (sc < 1) return;
    list.push({ z, sc, x: W / 2 + lane * ROAD_W * sc, y: horizonY() + sc * camH, draw });
  };

  const arc = S && S.arcade;
  if (arc) {
    for (const o of arc.objects || []) {
      if (o.t === "coin") add(o.d, 0, (p) => drawCoin(p.x, p.y, p.sc, o.d));
      else if (o.t === "box") for (const lane of [-0.6, 0, 0.6]) add(o.d, lane, (p) => drawItemBox(p.x, p.y, p.sc, o.d + lane));
      else if (o.t === "banana") add(o.d, o.lane || 0, (p) => drawBanana(p.x, p.y, p.sc));
    }
  }
  for (const r of (S && S.riders) || []) {
    if (r.kind === "ai") add(r.distance_m, r.lane || 0, (p) => drawRider(p.x, p.y, p.sc, riderAngles[r.id] || 0, riderOpts(r)));
    else if (r.kind === "ghost" && r.distance_m > disp.dist + 1.5) {
      add(r.distance_m, -0.4, (p) => drawRider(p.x, p.y, p.sc, disp.angle * 0.97 + 1, GHOST));
    }
  }
  if (track && track.finish) add(track.finish, 0, (p) => drawFinishArch(p.x, p.y, p.sc, p.sc * ROAD_W));

  list.sort((a, b) => b.z - a.z);
  for (const it of list) it.draw(it);
}

function render(dt, now) {
  ctx.clearRect(0, 0, W, H);
  if (!state.ready) return;
  const fp = view === "game" && camMode === "fp";
  const dist = view === "game" ? disp.dist : ambientDist;
  const fx = (S && S.arcade && S.arcade.effects) || {};

  for (const name of LAYERS) drawLayer(name, dist);
  drawWorld(fp);

  const climbing = factorAt(dist) < 0.8 && disp.rpm > 0;
  const meOpts = {
    ...ME, standing: climbing,
    flame: !!(fx.turbo || fx.pad || fx.star), rainbow: !!fx.star, bubble: !!fx.shield,
    tilt: fx.slip ? Math.sin(now / 60) * 0.25 : 0, dizzy: !!fx.slip,
  };
  if (fp) drawCockpit(now, meOpts);
  else if (!drawRiderSprite(now, meOpts)) drawRider(W / 2, H * 0.94, H * 0.28, disp.angle, meOpts);

  drawPost(dt, fx);
}

window.PX25 = {
  on: false,
  render,
  loadMap,
  loadIndex,
  resize: () => {},                       // 대체 그림은 화면 크기와 무관하다 — 다시 만들 게 없다
  maps: () => state.index,
  current: () => (state.map ? { id: state.id, name: state.map.name } : null),
};
