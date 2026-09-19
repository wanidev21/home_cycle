// PedalQuest 3D 렌더러 (Three.js, 베타)
// game.html의 전역 상태(disp, S, track, elevAt, themeAt ...)를 그대로 읽어서 그린다.
// 메뉴·HUD·WebSocket·사운드는 game.html(DOM)이 담당하고, 여기서는 그림만 그린다.
// 라이벌·고스트·코인 같은 움직이는 것은 3D 위치를 화면 좌표로 바꿔 기존 2D 그림 함수로 겹쳐 그린다.
import * as THREE from "./vendor/three.module.min.js";

THREE.ColorManagement.enabled = false;   // 색 값을 2D와 똑같이 (sRGB 그대로)

const N = 170;           // 그릴 도로 세그먼트 수 (≈510m)
const RW = 2.2;          // 도로 반폭(m) — game.html ROAD_W와 같음
const FOV = 58;          // 2D 투영(F = 0.9H)과 같은 화각
const PITCH = Math.atan(0.0444);   // 살짝 내려다봄 → 지평선이 화면 46% 높이 (2D와 같음)
const BUILD_VARIANTS = [[10, 18, 12], [14, 28, 14], [8, 12, 10]];   // [폭, 높이, 깊이] m

// 테마 팔레트 (Gemini 아트 디렉션 기반). sky = [위, 중간, 지평선], 지평선 색 = 안개 색
const T3 = {
  city: {
    sky: ["#3d7cc4", "#87ceeb", "#d4ecf6"], ground: ["#9fb596", "#98ae8f"], verge: ["#b8bcbe", "#b1b5b7"],
    road: ["#555a61", "#52575e"], edge: "#f2f2ec", lane: "#f2cc55", sun: "#fff3da", sunI: 1.5, hemi: ["#d6ecff", "#7d8a74"], hemiI: 1.1,
  },
  suburb: {
    sky: ["#3f86d0", "#87ceeb", "#dcf1f8"], ground: ["#a8d08d", "#a0c886"], verge: ["#8dbe74", "#87b76e"],
    road: ["#555a60", "#52575d"], edge: "#f4f4ee", lane: "#f2cc55", sun: "#fff3da", sunI: 1.5, hemi: ["#d6ecff", "#6f8a5f"], hemiI: 1.1,
  },
  mountain: {   // 노을
    sky: ["#4a4b8c", "#ff8a5c", "#ffc79c"], ground: ["#8b5a2b", "#855628"], verge: ["#a7896a", "#a08365"],
    road: ["#708090", "#6b7a8a"], edge: "#f6ece2", lane: "#f6ece2", sun: "#ffb27a", sunI: 1.7, hemi: ["#ffc8a8", "#5a4030"], hemiI: 0.9,
  },
  beach: {      // 아침
    sky: ["#72c8ee", "#b8ecf6", "#e0ffff"], ground: ["#f4c890", "#efc28a"], verge: ["#f8dcae", "#f3d6a8"],
    road: ["#d3d3d3", "#cdcdcd"], edge: "#ffffff", lane: "#8a8f96", sun: "#fffbe8", sunI: 1.5, hemi: ["#e8fbff", "#c8a878"], hemiI: 1.2,
  },
  night: {      // 아케이드: 레트로 신스웨이브
    sky: ["#05060a", "#0b0c10", "#241a3a"], ground: ["#1f2833", "#1c242e"], verge: ["#2a3442", "#27303d"],
    road: ["#222222", "#202020"], edge: "#66fcf1", lane: "#ff4fd8", sun: "#b9a6ff", sunI: 0.8, hemi: ["#5a4a9a", "#101820"], hemiI: 0.9,
  },
};
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
for (const t of Object.values(T3)) t.fog = hexRgb(t.sky[2]);

let renderer, scene, camera, fog, hemi, sun, cockpit, gauge, gaugeCtx, gaugeTex;
let terrain, tPos, tCol, finishMesh;
let bgCanvas, bgCtx, bgTex, bgKey = "";
const inst = {};
const xs = new Float32Array(N + 2), ys = new Float32Array(N + 2), zs = new Float32Array(N + 2);
let baseIdx = 0, camZ = 0, pos0 = 0;
const v3 = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();

// ---------------------------------------------------------------------
// 저폴리 지오메트리 (여러 조각을 하나로 합쳐 색을 정점에 칠함 → 인스턴스 1번 그리기)
// ---------------------------------------------------------------------
function part(geo, color, tx = 0, ty = 0, tz = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.scale(sx, sy, sz);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(tx, ty, tz);
  const c = hexRgb(color).map((v) => v / 255), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set(c, i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  for (const k of Object.keys(g.attributes)) if (!["position", "color"].includes(k)) g.deleteAttribute(k);
  return g;
}
function merge(parts) {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const P = new Float32Array(n * 3), C = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) { P.set(p.attributes.position.array, o); C.set(p.attributes.color.array, o); o += p.attributes.position.array.length; }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(P, 3));
  g.setAttribute("color", new THREE.BufferAttribute(C, 3));
  g.computeVertexNormals();   // 인덱스 없는 삼각형 → 면마다 평평한 음영 (저폴리 느낌)
  return g;
}
const lambert = (opts = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...opts });

function makeTree(dark, mid) {
  return merge([
    part(new THREE.CylinderGeometry(0.16, 0.26, 3, 5), "#5b4331", 0, 1.5, 0),
    part(new THREE.IcosahedronGeometry(1.8, 0), dark, 0, 3.8, 0),
    part(new THREE.IcosahedronGeometry(1.25, 0), mid, -0.7, 4.6, 0.3),
    part(new THREE.IcosahedronGeometry(1.1, 0), mid, 0.8, 3.4, -0.4),
  ]);
}
function makePine() {
  const ps = [part(new THREE.CylinderGeometry(0.15, 0.2, 1.4, 5), "#4e3726", 0, 0.7, 0)];
  for (let i = 0; i < 4; i++) ps.push(part(new THREE.ConeGeometry(2 - i * 0.42, 2.4, 6), i % 2 ? "#2f6a3c" : "#285a35", 0, 1.9 + i * 1.3, 0));
  return merge(ps);
}
function makeRock() {
  return merge([part(new THREE.DodecahedronGeometry(1, 0), "#8d877e", 0, 0.45, 0, 0, 0, 1.3, 0.75, 1.1)]);
}
function makeHouse() {
  const roof = new THREE.CylinderGeometry(4.4, 4.4, 8.4, 3, 1);   // 삼각기둥 지붕
  return merge([
    part(new THREE.BoxGeometry(7, 3.4, 8), "#f1e3c8", 0, 1.7, 0),
    part(roof, "#a8403a", 0, 3.4 + 1.2, 0, -Math.PI / 2, 0, 1.1, 1, 0.55),
    part(new THREE.BoxGeometry(1.1, 2.1, 0.1), "#5a4636", 0, 1.05, 4.02),
    part(new THREE.BoxGeometry(1, 1, 0.1), "#7fb0d6", 2.1, 2.1, 4.02),
    part(new THREE.BoxGeometry(1, 1, 0.1), "#7fb0d6", -2.1, 2.1, 4.02),
  ]);
}
function makeLamp() {
  return merge([
    part(new THREE.CylinderGeometry(0.07, 0.1, 5.8, 5), "#41464e", 0, 2.9, 0),
    part(new THREE.BoxGeometry(1.3, 0.1, 0.1), "#41464e", 0.6, 5.75, 0),
    part(new THREE.BoxGeometry(0.7, 0.16, 0.3), "#2c3036", 1.1, 5.7, 0),
    part(new THREE.BoxGeometry(0.56, 0.04, 0.22), "#fff4cf", 1.1, 5.6, 0),
  ]);
}
function makePalm() {
  const ps = [];
  for (let i = 0; i < 5; i++) ps.push(part(new THREE.CylinderGeometry(0.2, 0.24, 1.5, 5), i % 2 ? "#8a6a45" : "#7d5f3d", i * 0.12, 0.75 + i * 1.4, 0, 0, -0.06 * i));
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2, leaf = new THREE.ConeGeometry(0.5, 3.4, 4);
    const g = part(leaf, k % 2 ? "#2f8a47" : "#3fa257", 0, 0, 0, 0, 0, 1, 1, 0.25);
    g.rotateZ(-1.9); g.rotateY(a); g.translate(0.6 + Math.cos(a) * 1.4, 7.2, -Math.sin(a) * 1.4);
    ps.push(g);
  }
  return merge(ps);
}
function makeParasol() {
  return merge([
    part(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 4), "#777777", 0, 1.2, 0),
    part(new THREE.ConeGeometry(1.5, 0.8, 8), "#ff6b6b", 0, 2.6, 0),
  ]);
}
// 건물: 흰 벽 + 어두운 창문 격자 텍스처 (인스턴스 색으로 벽 색만 바꿈)
let windowTex = null;
function windowTexture() {
  if (windowTex) return windowTex;
  const c = document.createElement("canvas"); c.width = 32; c.height = 32;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 32, 32);
  g.fillStyle = "#3a4a60"; g.fillRect(7, 7, 18, 19);
  g.fillStyle = "#5c6e86"; g.fillRect(7, 7, 18, 6);
  windowTex = new THREE.CanvasTexture(c);
  windowTex.wrapS = windowTex.wrapT = THREE.RepeatWrapping;
  windowTex.magFilter = THREE.NearestFilter;
  return windowTex;
}
function makeBuilding([w, h, d]) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const uv = g.attributes.uv, nrm = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ny = nrm.getY(i), nx = nrm.getX(i);
    if (Math.abs(ny) > 0.5) { uv.setXY(i, 0.02, 0.02); continue; }       // 지붕·바닥: 벽색
    const across = Math.abs(nx) > 0.5 ? d : w;
    uv.setXY(i, uv.getX(i) * across / 2.6, uv.getY(i) * h / 3.2);
  }
  return g;
}

function addInstanced(name, geo, mat, cap) {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = 0;
  scene.add(m);
  inst[name] = m;
  return m;
}

// ---------------------------------------------------------------------
// 1인칭 콕핏 (카메라 자식 → 화면에 고정). 기하도형으로 만든 저폴리 모델
// 몸(손·무릎)은 넣지 않음: 도형으로 만든 몸은 부자연스러움. 페달 박자는 카메라 흔들림으로 표현
// ---------------------------------------------------------------------
function buildCockpit() {
  const g = new THREE.Group();
  g.name = "cockpit";
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c1f24, flatShading: true });
  const frame = new THREE.MeshLambertMaterial({ color: 0x2b2f37, flatShading: true });
  const alu = new THREE.MeshLambertMaterial({ color: 0x3a3f47, flatShading: true });
  // 탑 (가로 바)
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.4, 8), dark);
  bar.rotation.z = Math.PI / 2; g.add(bar);
  // 드롭: 바 끝에서 앞으로 나갔다가 아래·뒤로 휘어 내려옴
  for (const s of [-1, 1]) {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * 0.2, 0, 0), new THREE.Vector3(s * 0.212, -0.004, -0.06),
      new THREE.Vector3(s * 0.216, -0.05, -0.1), new THREE.Vector3(s * 0.214, -0.11, -0.07), new THREE.Vector3(s * 0.21, -0.13, 0.0),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(path, 10, 0.0125, 6), dark));
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 0.075), alu);   // 브레이크 후드
    hood.position.set(s * 0.212, 0.014, -0.075); hood.rotation.x = -0.35; g.add(hood);
  }
  // 스템 (바 가운데 → 몸 쪽 조향축) + 헤드셋 캡
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.034, 0.11), frame);
  stem.position.set(0, -0.012, 0.055); stem.rotation.x = 0.12; g.add(stem);
  const clamp = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 8), alu);
  clamp.rotation.z = Math.PI / 2; g.add(clamp);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.05, 8), alu);
  cap.position.set(0, -0.03, 0.11); g.add(cap);
  // 탑튜브 (몸 쪽 아래로)
  const tt = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.6, 6), frame);
  tt.position.set(0, -0.2, 0.33); tt.rotation.x = -1.0; g.add(tt);
  // 속도계: 앞으로 나온 마운트 + 몸 쪽으로 기울인 화면
  const mount = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.01, 0.08), alu);
  mount.position.set(0, 0.004, -0.045); g.add(mount);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.014, 0.085), dark);
  body.position.set(0, 0.018, -0.085); body.rotation.x = 0.45; g.add(body);
  gauge = document.createElement("canvas"); gauge.width = 128; gauge.height = 96;
  gaugeCtx = gauge.getContext("2d");
  gaugeTex = new THREE.CanvasTexture(gauge);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.072), new THREE.MeshBasicMaterial({ map: gaugeTex }));
  screen.position.set(0, 0.0262, -0.085); screen.rotation.x = -Math.PI / 2 + 0.45; g.add(screen);
  g.position.set(0, -0.17, -0.6);
  return g;
}
let gaugeTimer = 0;
function updateGauge(dt) {
  if ((gaugeTimer -= dt) > 0) return;
  gaugeTimer = 0.2;
  const c = gaugeCtx;
  c.fillStyle = "#c9d6c4"; c.fillRect(0, 0, 128, 96);
  c.fillStyle = "#1b2219"; c.textAlign = "center"; c.textBaseline = "middle";
  c.font = "700 44px Bahnschrift, 'Roboto Condensed', system-ui";
  c.fillText(disp.speed.toFixed(1), 64, 40);
  c.font = "600 16px system-ui";
  c.fillText(`km/h · ${Math.round(disp.rpm)} rpm`, 64, 78);
  gaugeTex.needsUpdate = true;
}

// ---------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------
function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  scene = new THREE.Scene();
  fog = new THREE.Fog(0xd4ecf6, 40, 470);
  scene.fog = fog;
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.08, 700);
  camera.rotation.order = "YXZ";
  scene.add(camera);
  hemi = new THREE.HemisphereLight(0xd6ecff, 0x7d8a74, 1.1);
  sun = new THREE.DirectionalLight(0xfff3da, 1.5);
  sun.position.set(-50, 70, 60);   // 카메라 뒤 왼쪽 위 → 보이는 면이 밝게 (하늘의 해는 연출용)
  scene.add(hemi, sun);
  // 콕핏에도 빛이 닿도록 카메라에 약한 조명
  const fill = new THREE.DirectionalLight(0xffffff, 1.4);
  fill.position.set(-0.5, 1, 0.5);
  camera.add(fill);

  // 지형: 세그먼트마다 [땅, 갓길, 도로, 가장자리선×2, 중앙선, 가속발판] 사각형. 먼 곳→가까운 곳 순서로 칠함(깊이 대신)
  const quads = N * 7;
  tPos = new Float32Array(quads * 6 * 3);
  tCol = new Float32Array(quads * 6 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("color", new THREE.BufferAttribute(tCol, 3).setUsage(THREE.DynamicDrawUsage));
  terrain = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, depthWrite: false, depthTest: false }));
  terrain.frustumCulled = false;
  terrain.renderOrder = -10;
  scene.add(terrain);

  // 결승선 체크무늬
  const fc = document.createElement("canvas"); fc.width = 20; fc.height = 2;
  const fg = fc.getContext("2d");
  for (let i = 0; i < 20; i++) for (let j = 0; j < 2; j++) { fg.fillStyle = (i + j) % 2 ? "#111" : "#fff"; fg.fillRect(i, j, 1, 1); }
  const ft = new THREE.CanvasTexture(fc); ft.magFilter = THREE.NearestFilter;
  finishMesh = new THREE.Mesh(new THREE.PlaneGeometry(RW * 2, 1.2), new THREE.MeshBasicMaterial({ map: ft, depthTest: false, depthWrite: false }));
  finishMesh.rotation.x = -Math.PI / 2; finishMesh.renderOrder = -9; finishMesh.visible = false;
  scene.add(finishMesh);

  // 배경 (하늘 + 먼 산): 화면 고정 텍스처
  bgCanvas = document.createElement("canvas");
  bgCtx = bgCanvas.getContext("2d");
  bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.wrapS = THREE.RepeatWrapping;
  scene.background = bgTex;

  // 길가 오브젝트 (인스턴싱 → 종류마다 그리기 1번)
  addInstanced("tree", makeTree("#2e6a33", "#428f40"), lambert(), 120);
  addInstanced("treeCity", makeTree("#2b5a36", "#3b7a43"), lambert(), 60);
  addInstanced("pine", makePine(), lambert(), 140);
  addInstanced("rock", makeRock(), lambert(), 80);
  addInstanced("house", makeHouse(), lambert(), 40);
  addInstanced("lamp", makeLamp(), lambert(), 80);
  addInstanced("palm", makePalm(), lambert(), 60);
  addInstanced("parasol", makeParasol(), lambert(), 40);
  const bmat = new THREE.MeshLambertMaterial({ map: windowTexture(), flatShading: true });
  BUILD_VARIANTS.forEach((v, i) => addInstanced("bld" + i, makeBuilding(v), bmat, 40));

  cockpit = buildCockpit();
  camera.add(cockpit);
  resize();
}

function resize() {
  if (!renderer) return;
  const coarse = matchMedia("(pointer: coarse)").matches;
  // 저사양 태블릿(PowerVR GE8320) 대비: 터치 기기는 0.75배 해상도로 그리고 늘림
  renderer.setPixelRatio(coarse ? 0.75 : Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  bgKey = "";
}

// ---------------------------------------------------------------------
// 배경 합성: 하늘 그라데이션 + 해 + 먼 산(2D bgLayer 재사용). 테마 전환 중엔 섞어서 다시 그림
// ---------------------------------------------------------------------
function paintBg(ctx2, key, alpha) {
  const t = T3[key], w = bgCanvas.width, h = bgCanvas.height, hz = h * (HORIZON / H);
  ctx2.globalAlpha = alpha;
  const gr = ctx2.createLinearGradient(0, 0, 0, hz);
  gr.addColorStop(0, t.sky[0]); gr.addColorStop(0.62, t.sky[1]); gr.addColorStop(1, t.sky[2]);
  ctx2.fillStyle = gr; ctx2.fillRect(0, 0, w, hz + 1);
  ctx2.fillStyle = t.sky[2]; ctx2.fillRect(0, hz, w, h - hz);
  for (const sx of [w * 0.39, w * 0.89]) {        // 텍스처가 반씩 보이므로 해를 두 번
    const sy = hz * 0.42, r = hz * 0.9;
    const sun2 = ctx2.createRadialGradient(sx, sy, 0, sx, sy, r);
    sun2.addColorStop(0, "rgba(255,248,225,0.85)"); sun2.addColorStop(0.05, "rgba(255,244,214,0.5)");
    sun2.addColorStop(0.3, "rgba(255,236,200,0.12)"); sun2.addColorStop(1, "rgba(255,236,200,0)");
    ctx2.fillStyle = sun2; ctx2.fillRect(0, 0, w, hz);
  }
  const clouds = cloudLayer();
  if (key !== "night") ctx2.drawImage(clouds, 0, 0, w, clouds.height * (w / clouds.width));
  const baseTheme = key === "night" ? "mountain" : key;
  const img = bgLayer(baseTheme, t.fog, "3d-" + key);
  const ih = img.height * (w / img.width);
  if (key === "night") ctx2.filter = "brightness(0.25) saturate(0.6)";
  ctx2.drawImage(img, 0, hz - ih + 1, w, ih);
  ctx2.filter = "none";
  // 지평선 아지랑이
  const hzG = ctx2.createLinearGradient(0, hz - h * 0.12, 0, hz);
  const f = t.fog;
  hzG.addColorStop(0, `rgba(${f[0]},${f[1]},${f[2]},0)`); hzG.addColorStop(1, `rgba(${f[0]},${f[1]},${f[2]},0.55)`);
  ctx2.fillStyle = hzG; ctx2.fillRect(0, hz - h * 0.12, w, h * 0.12);
  ctx2.globalAlpha = 1;
}
function updateBg(cur, prev, fade) {
  const w = Math.max(64, Math.round(W)), h = Math.max(64, Math.round(H / 2));
  const key = fade >= 1 ? `${cur}|${w}` : `${prev}|${cur}|${Math.round(fade * 10)}|${w}`;
  if (key === bgKey) return;
  bgKey = key;
  if (bgCanvas.width !== w || bgCanvas.height !== h) { bgCanvas.width = w; bgCanvas.height = h; }
  if (fade < 1) paintBg(bgCtx, prev, 1);
  paintBg(bgCtx, cur, fade < 1 ? fade : 1);
  bgTex.needsUpdate = true;
}

// ---------------------------------------------------------------------
// 한 프레임
// ---------------------------------------------------------------------
function paletteKey(theme) { return S && S.mode === "arcade" ? "night" : theme; }

let qi = 0;
function quadAt(xL1, xR1, y1, z1, xL2, xR2, y2, z2, c) {
  const o = qi * 18;
  const P = tPos, C = tCol;
  // 두 삼각형: (L1,R1,R2) (L1,R2,L2)
  P[o] = xL1; P[o + 1] = y1; P[o + 2] = z1;   P[o + 3] = xR1; P[o + 4] = y1; P[o + 5] = z1;   P[o + 6] = xR2; P[o + 7] = y2; P[o + 8] = z2;
  P[o + 9] = xL1; P[o + 10] = y1; P[o + 11] = z1; P[o + 12] = xR2; P[o + 13] = y2; P[o + 14] = z2; P[o + 15] = xL2; P[o + 16] = y2; P[o + 17] = z2;
  for (let k = 0; k < 6; k++) { C[o + k * 3] = c[0]; C[o + k * 3 + 1] = c[1]; C[o + k * 3 + 2] = c[2]; }
  qi++;
}
function emptyQuad() { tPos.fill(0, qi * 18, qi * 18 + 18); qi++; }
const rgbCache = {};
const c01 = (hex) => rgbCache[hex] || (rgbCache[hex] = hexRgb(hex).map((v) => v / 255));

function render(dt, now) {
  const pos = view === "game" ? disp.dist : ambientDist;
  const fp = view === "game" && camMode === "fp";
  const cam = CAMS[fp ? "fp" : "tp"];
  camZ = pos - cam.back; pos0 = pos;
  const arc = S && S.arcade, fx = arc ? arc.effects : {};

  // 테마 (2D와 같은 전역 상태를 진행시킴)
  themeFade = Math.min(1, themeFade + dt / 1.8);
  const curK = paletteKey(curTheme), prevK = paletteKey(prevTheme);
  const tc = T3[curK], tp = T3[prevK];
  updateBg(curK, prevK, themeFade);
  const fogC = mix(tp.fog, tc.fog, themeFade);
  fog.color.setRGB(fogC[0] / 255, fogC[1] / 255, fogC[2] / 255);
  // 최신 Three.js는 빛을 물리 단위로 계산(÷π) → 예전 세기의 약 π배
  hemi.color.set(tc.hemi[0]); hemi.groundColor.set(tc.hemi[1]); hemi.intensity = tc.hemiI * 2.4;
  sun.color.set(tc.sun); sun.intensity = tc.sunI * 1.6;
  baseIdx = Math.floor(camZ / SEG);
  bgOffset += curveAt(baseIdx) * disp.speed * dt * 900;
  bgTex.offset.x = mod(bgOffset / (W * 2), 1);
  bgTex.repeat.x = 0.5;

  // 카메라: 페달 박자 흔들림 + 노면 진동 + (미끄러짐) 기울기
  const climbing = factorAt(pos) < 0.8 && disp.rpm > 0;
  const bob = Math.sin(disp.angle * 2) * (fp ? 0.008 : 0.015) * clamp(disp.speed / 20, 0, 1);
  const buzz = disp.speed > 3 ? Math.sin(now / 23) * Math.sin(now / 37) * clamp(disp.speed / 40, 0, 1) * 0.004 : 0;
  camera.position.set(fp ? Math.sin(disp.angle) * (climbing ? 0.02 : 0.007) : 0, cam.h + bob + buzz, 0);
  camera.rotation.set(-PITCH, 0, (fp ? Math.sin(disp.angle) * (climbing ? 0.012 : 0.004) : 0) + (fp && fx.slip ? Math.sin(now / 60) * 0.12 : 0));

  // 도로 중심선 (2D와 같은 커브 누적)
  const e0 = elevAt(pos);
  const basePct = (camZ - baseIdx * SEG) / SEG;
  let x = 0, dx = -curveAt(baseIdx) * basePct;
  for (let n = 0; n <= N; n++) {
    const d = (baseIdx + n) * SEG;
    xs[n] = x; ys[n] = elevAt(d) - e0; zs[n] = -(d - camZ);
    x += dx; dx += curveAt(baseIdx + n);
  }

  // 지형 (먼 곳부터)
  qi = 0;
  const padIdx = new Set();
  if (arc) for (const o of arc.objects) if (o.t === "pad") { const k = Math.floor(o.d / SEG); padIdx.add(k); padIdx.add(k + 1); }
  for (let n = N - 1; n >= 0; n--) {
    const idx = baseIdx + n;
    const t = T3[paletteKey(themeAt(idx * SEG))];
    const st = mod(Math.floor(idx / 3), 2);
    const x1 = xs[n], y1 = ys[n], z1 = Math.min(zs[n], 0.5), x2 = xs[n + 1], y2 = ys[n + 1], z2 = zs[n + 1];
    const Q = (l, r, c) => quadAt(x1 + l, x1 + r, y1, z1, x2 + l, x2 + r, y2, z2, c);
    Q(-400, 400, c01(t.ground[st]));
    Q(-RW * 1.32, RW * 1.32, c01(t.verge[st]));
    Q(-RW, RW, c01(t.road[st]));
    Q(-RW * 0.95, -RW * 0.91, c01(t.edge));
    Q(RW * 0.91, RW * 0.95, c01(t.edge));
    if (mod(idx, 4) < 2) Q(-RW * 0.016, RW * 0.016, c01(t.lane)); else emptyQuad();
    if (padIdx.has(idx)) Q(-RW * 0.55, RW * 0.55, Math.floor(now / 150) % 2 === mod(idx, 2) ? c01("#00e5ff") : c01("#0096c7")); else emptyQuad();
  }
  terrain.geometry.attributes.position.needsUpdate = true;
  terrain.geometry.attributes.color.needsUpdate = true;

  // 결승선
  const fin = track && track.finish;
  finishMesh.visible = false;
  if (fin) {
    const n = (fin - baseIdx * SEG) / SEG;
    if (n > 0 && n < N) {
      const i = Math.floor(n), t = n - i;
      finishMesh.position.set(lerp(xs[i], xs[i + 1], t), lerp(ys[i], ys[i + 1], t) + 0.01, lerp(zs[i], zs[i + 1], t));
      finishMesh.visible = true;
    }
  }

  placeScenery();

  // 콕핏
  cockpit.visible = fp;
  if (fp) {
    updateGauge(dt);
  }

  renderer.render(scene, camera);
  drawOverlay(dt, now, fp, cam, fx);
}

// 길가 오브젝트 배치 (2D drawSprites와 같은 규칙: 세그먼트 번호 해시로 결정 → 매번 같은 자리)
function placeScenery() {
  const cnt = {};
  for (const k in inst) cnt[k] = 0;
  const put = (name, px, py, pz, s, rotY, color) => {
    const m = inst[name];
    if (cnt[name] >= m.instanceMatrix.count) return;
    q.setFromAxisAngle(up, rotY);
    sc3.set(s, s, s);
    m4.compose(v3.set(px, py, pz), q, sc3);
    m.setMatrixAt(cnt[name], m4);
    if (color) { col.set(color); m.setColorAt(cnt[name], col); }
    cnt[name]++;
  };
  for (let n = 1; n < N; n++) {
    const idx = baseIdx + n;
    const theme = themeAt(idx * SEG);
    const h = hash(idx), v = hash3(idx), side = hash2(idx) < 0.5 ? -1 : 1;
    const px = (off) => xs[n + 1] + side * (RW + off), py = ys[n + 1], pz = zs[n + 1];
    const rot = v * 6.28;
    if (theme === "city") {
      if (idx % 8 === 0) {
        for (const sd of [-1, 1]) put("lamp", xs[n + 1] + sd * (RW + 1.0), py, pz, 1, sd < 0 ? 0 : Math.PI);
      } else if (h < 0.22) {
        const b = Math.floor(v * 3) % 3, w = BUILD_VARIANTS[b][0];
        const bc = ["#9aa5b1", "#b8a48e", "#8593a3", "#c2b6a3", "#6f7f91", "#a89f96"][Math.floor(v * 6) % 6];
        put("bld" + b, px(10 + v * 8 + w / 2 - 3), py, pz, 1, 0, bc);
      } else if (h < 0.3) put("treeCity", px(2.5), py, pz, 0.85 + v * 0.6, rot);
    } else if (theme === "suburb") {
      if (h < 0.2) put("tree", px(2 + v * 7), py, pz, 0.85 + v * 0.6, rot);
      else if (h < 0.25) put("house", px(9 + v * 4), py, pz, 1, side < 0 ? Math.PI / 2 : -Math.PI / 2, ["#ffffff", "#e8eef6", "#fff0e8"][Math.floor(v * 3)]);
    } else if (theme === "mountain") {
      if (h < 0.28) put("pine", px(2 + v * 9), py, pz, 0.9 + v * 0.9, rot);
      else if (h < 0.36) put("rock", px(1.5 + v * 3), py, pz, 0.6 + v, rot);
    } else if (theme === "beach") {
      if (h < 0.12) put("palm", px(2.5 + v * 5), py, pz, 0.9 + v * 0.5, rot);
      else if (h < 0.17) put("parasol", px(4 + v * 6), py, pz, 1, rot, v > 0.5 ? "#ffffff" : "#8fd0ff");
    }
  }
  for (const k in inst) {
    const m = inst[k];
    m.count = cnt[k];
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------
// 2D 오버레이: 라이벌·고스트·코인·아이템·(후방 시점의) 내 자전거 + 결승 아치 + 비네팅/속도선
// ---------------------------------------------------------------------
const halfTan = Math.tan((FOV * Math.PI) / 360);
function worldAt(d, lane = 0) {
  const n = (d - baseIdx * SEG) / SEG;
  if (n < 0 || n >= N) return null;
  const i = Math.floor(n), t = n - i;
  return [lerp(xs[i], xs[i + 1], t) + lane * RW, lerp(ys[i], ys[i + 1], t), lerp(zs[i], zs[i + 1], t)];
}
function project(p) {
  v3.set(p[0], p[1], p[2]).applyMatrix4(camera.matrixWorldInverse);
  const depth = -v3.z;
  if (depth < 0.6) return null;
  v3.applyMatrix4(camera.projectionMatrix);
  return { x: (v3.x + 1) / 2 * W, y: (1 - v3.y) / 2 * H, m: (H / 2) / (halfTan * depth), depth };
}

function drawOverlay(dt, now, fp, cam, fx) {
  ctx.clearRect(0, 0, W, H);
  camera.updateMatrixWorld();
  const list = [];
  const minDepth = fp ? 3.5 : 0.6;   // 1인칭: 핸들바보다 가까운 건 안 그림 (콕핏 위에 겹쳐 보이므로)
  const add = (d, lane, draw) => { const w = worldAt(d, lane); const p = w && project(w); if (p && p.depth > minDepth) list.push({ p, draw }); };
  const arc = S && S.arcade;
  if (arc) {
    for (const o of arc.objects) {
      if (o.t === "coin") add(o.d, 0, (p) => drawCoin(p.x, p.y, p.m, o.d));
      else if (o.t === "box") for (const lane of [-0.6, 0, 0.6]) add(o.d, lane, (p) => drawItemBox(p.x, p.y, p.m, o.d + lane));
      else if (o.t === "banana") add(o.d, o.lane || 0, (p) => drawBanana(p.x, p.y, p.m));
    }
  }
  for (const r of (S && S.riders) || []) {
    if (r.kind === "ai") add(r.distance_m, r.lane, (p) => { if (p.m > 1) drawRider(p.x, p.y, p.m, riderAngles[r.id] || 0, riderOpts(r)); });
    else if (r.kind === "ghost" && r.distance_m > pos0 + 1.5) add(r.distance_m, -0.4, (p) => drawRider(p.x, p.y, p.m, disp.angle * 0.97 + 1, GHOST));
  }
  if (track && track.finish) {
    add(track.finish, 0, (p) => drawFinishArch(p.x, p.y, p.m, p.m * RW));
  }
  if (!fp) {
    const climbing = factorAt(pos0) < 0.8 && disp.rpm > 0;
    add(pos0, 0, (p) => drawRider(p.x, p.y, p.m, disp.angle, {
      ...ME, standing: climbing,
      flame: !!(fx.turbo || fx.pad || fx.star), rainbow: !!fx.star, bubble: !!fx.shield,
      tilt: fx.slip ? Math.sin(now / 60) * 0.25 : 0, dizzy: !!fx.slip,
    }));
  }
  list.sort((a, b) => b.p.depth - a.p.depth);
  for (const it of list) it.draw(it.p);
  if (fp && fx.shield) {
    const g = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, W * 0.7);
    g.addColorStop(0, "rgba(120,220,255,0)"); g.addColorStop(1, "rgba(120,220,255,0.35)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  drawPost(dt, fx);
}

window.R3D = { init, render, resize, on: false };
