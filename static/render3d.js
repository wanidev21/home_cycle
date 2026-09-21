// PedalQuest 3D 렌더러 (Three.js, 베타)
// game.html의 전역 상태(disp, S, track, elevAt, themeAt ...)를 그대로 읽어서 그린다.
// 메뉴·HUD·WebSocket·사운드는 game.html(DOM)이 담당하고, 여기서는 그림만 그린다.
// 라이벌·고스트·코인 같은 움직이는 것은 3D 위치를 화면 좌표로 바꿔 기존 2D 그림 함수로 겹쳐 그린다.
import * as THREE from "./vendor/three.module.min.js";

THREE.ColorManagement.enabled = false;   // 색 값을 2D와 똑같이 (sRGB 그대로)

const N = 170;           // 버퍼가 감당하는 최대 도로 세그먼트 수 (≈510m)
const N_MIN = 80;        // 저사양에서 줄일 수 있는 하한 (≈240m)
const FOG_NEAR = 40;
const FOG_SPAN = 0.92;   // 안개 끝 = 그리는 거리 × 이 비율 (끊긴 데가 안 보이게)
// 태블릿(PowerVR GE8320)마다 성능이 달라 미리 정할 수 없다 → 실제 프레임 시간을 보고 조절한다.
const FPS_TARGET_LOW = 27, FPS_TARGET_HIGH = 45;
const PIXEL_STEPS = [0.9, 0.75, 0.62, 0.5, 0.4];
// 터치 기기는 보수적으로 시작해서 여유가 있으면 올라간다 (첫 몇 초가 버벅이지 않게)
const COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
let drawN = COARSE ? 120 : N;   // 지금 그리는 세그먼트 수
let pixelStep = COARSE ? 1 : 0; // PIXEL_STEPS 인덱스 (터치 기기)
let frameMs = 16.7;      // 지수 이동평균
let qualityAt = 0;       // 마지막으로 품질을 바꾼 시각
let wakeAt3d = 0;        // 화면이 돌아온 직후 몇 프레임은 표본에서 제외
addEventListener("visibilitychange", () => { if (!document.hidden) wakeAt3d = performance.now() + 1500; });
const RW = 2.2;          // 도로 반폭(m) — game.html ROAD_W와 같음
const FOV = 58;          // 2D 투영(F = 0.9H)과 같은 화각
const PITCH = Math.atan(0.0444);   // 살짝 내려다봄 → 지평선이 화면 46% 높이 (2D와 같음)
const BUILD_VARIANTS = [[10, 18, 12], [14, 28, 14], [8, 12, 10]];   // [폭, 높이, 깊이] m

// 테마 팔레트 (Gemini 아트 디렉션 기반). sky = [위, 중간, 지평선], 지평선 색 = 안개 색
const T3 = {
  city: {
    sky: ["#3d7cc4", "#87ceeb", "#d4ecf6"], ground: ["#9fb596", "#98ae8f"], verge: ["#b8bcbe", "#b1b5b7"],
    road: ["#555a61", "#52575e"], edge: "#f2f2ec", lane: "#f2cc55", sun: "#fff3da", sunI: 1.0, hemi: ["#d6ecff", "#7d8a74"], hemiI: 0.85,
    dir: [-20, 95, 25], fog: 1.15,     // 정오
  },
  suburb: {
    sky: ["#3f86d0", "#87ceeb", "#dcf1f8"], ground: ["#a8d08d", "#a0c886"], verge: ["#8dbe74", "#87b76e"],
    road: ["#555a60", "#52575d"], edge: "#f4f4ee", lane: "#f2cc55", sun: "#fff3da", sunI: 0.95, hemi: ["#d6ecff", "#6f8a5f"], hemiI: 0.9,
    dir: [-65, 70, 40], fog: 1.15,     // 오후, 좌상 45°
  },
  mountain: {   // 노을
    sky: ["#4a4b8c", "#ff8a5c", "#ffc79c"], ground: ["#8b5a2b", "#855628"], verge: ["#a7896a", "#a08365"],
    road: ["#708090", "#6b7a8a"], edge: "#f6ece2", lane: "#f6ece2", sun: "#ffb27a", sunI: 0.85, hemi: ["#ffc8a8", "#5a4030"], hemiI: 0.82,
    dir: [95, 22, -15], fog: 0.8,      // 석양, 오른쪽에서 낮게
  },
  beach: {      // 아침
    sky: ["#72c8ee", "#b8ecf6", "#e0ffff"], ground: ["#f4c890", "#efc28a"], verge: ["#f8dcae", "#f3d6a8"],
    road: ["#d3d3d3", "#cdcdcd"], edge: "#ffffff", lane: "#8a8f96", sun: "#fffbe8", sunI: 0.9, hemi: ["#e8fbff", "#c8a878"], hemiI: 1.08,
    dir: [-95, 28, -10], fog: 1.15,    // 아침, 왼쪽에서 낮게
  },
  night: {      // 아케이드: 레트로 신스웨이브
    sky: ["#05060a", "#0b0c10", "#241a3a"], ground: ["#1f2833", "#1c242e"], verge: ["#2a3442", "#27303d"],
    road: ["#222222", "#202020"], edge: "#66fcf1", lane: "#ff4fd8", sun: "#b9a6ff", sunI: 0.3, hemi: ["#5a4a9a", "#101820"], hemiI: 0.4,
    dir: [0, 60, 40], fog: 0.55,       // 야간: 네온 말고는 빛이 없다
  },
};
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
for (const t of Object.values(T3)) t.fog = hexRgb(t.sky[2]);

let renderer, scene, camera, fog, hemi, sun, cockpit, gauge, gaugeCtx, gaugeTex;
let hands = [];
let terrain, tPos, tCol, tUv, finishMesh;
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
// --- 2D에 있던 길가 소품의 저폴리 판 (3D가 기본 렌더러라 같은 풍경이 나와야 한다) ---
function makeSign() {          // 네온 간판 (색은 인스턴스마다 다르게 칠한다)
  return merge([
    part(new THREE.BoxGeometry(0.22, 4.2, 0.22), "#3a3f47", 0, 2.1, 0),
    part(new THREE.BoxGeometry(2.2, 2.3, 0.18), "#ffffff", 0, 5.3, 0),
  ]);
}
function makeBusStop() {
  const ps = [part(new THREE.BoxGeometry(4.2, 0.22, 2.0), "#2f343c", 0, 2.9, 0)];
  for (const dx of [-1.9, 1.9]) ps.push(part(new THREE.BoxGeometry(0.16, 2.9, 0.16), "#4b525c", dx, 1.45, 0));
  ps.push(part(new THREE.BoxGeometry(3.6, 1.7, 0.08), "#9fc4dd", 0, 1.9, -0.9));
  ps.push(part(new THREE.BoxGeometry(3.0, 0.22, 0.5), "#6a7381", 0, 1.0, 0.3));
  return merge(ps);
}
function makeTrafficLight() {
  return merge([
    part(new THREE.CylinderGeometry(0.08, 0.1, 4.6, 5), "#3d434b", 0, 2.3, 0),
    part(new THREE.BoxGeometry(0.66, 1.6, 0.4), "#23272e", 0, 5.4, 0),
    part(new THREE.SphereGeometry(0.17, 6, 5), "#ff4d4f", 0, 5.95, 0.2),
    part(new THREE.SphereGeometry(0.17, 6, 5), "#6b5a1f", 0, 5.4, 0.2),
    part(new THREE.SphereGeometry(0.17, 6, 5), "#1f5a33", 0, 4.85, 0.2),
  ]);
}
function makeFence() {
  const ps = [];
  for (let k = 0; k < 6; k++) ps.push(part(new THREE.BoxGeometry(0.1, 1.1, 0.1), "#e9ecef", -1.3 + k * 0.52, 0.55, 0));
  for (const ry of [0.78, 0.36]) ps.push(part(new THREE.BoxGeometry(2.8, 0.09, 0.07), "#e9ecef", 0, ry, 0));
  return merge(ps);
}
function makeMailbox() {
  return merge([
    part(new THREE.CylinderGeometry(0.06, 0.07, 1.2, 5), "#6a7078", 0, 0.6, 0),
    part(new THREE.BoxGeometry(0.6, 0.85, 0.45), "#e03131", 0, 1.6, 0),
    part(new THREE.BoxGeometry(0.36, 0.12, 0.05), "#1b1b1f", 0, 1.78, 0.24),
  ]);
}
function makeFlowerBed() {
  const ps = [part(new THREE.SphereGeometry(1.2, 7, 4), "#4c8f46", 0, 0.1, 0, 0, 0, 1, 0.35, 0.8)];
  const tones = ["#ff8fa3", "#ffd166", "#c77dff", "#ffffff"];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    ps.push(part(new THREE.SphereGeometry(0.13, 5, 4), tones[k % 4],
      Math.cos(a) * 0.85, 0.38 + (k % 3) * 0.06, Math.sin(a) * 0.55));
  }
  return merge(ps);
}
function makeGuardrail() {
  const ps = [];
  for (const dx of [-1.5, 0, 1.5]) ps.push(part(new THREE.BoxGeometry(0.12, 1.0, 0.12), "#8d949c", dx, 0.5, 0));
  for (const ry of [1.02, 0.6]) ps.push(part(new THREE.BoxGeometry(3.4, 0.16, 0.09), "#c0c6cc", 0, ry, 0));
  return merge(ps);
}
function makeWarnSign() {
  return merge([
    part(new THREE.CylinderGeometry(0.06, 0.07, 2.2, 5), "#6a7078", 0, 1.1, 0),
    part(new THREE.ConeGeometry(0.85, 1.4, 3), "#ffd700", 0, 2.85, 0),
    part(new THREE.BoxGeometry(0.14, 0.5, 0.04), "#1b1b1f", 0, 2.75, 0.1),
  ]);
}
function makeWaterfall() {
  const ps = [part(new THREE.BoxGeometry(1.5, 0.5, 1.2), "#7d8894", 0, 4.2, 0)];
  for (let k = 0; k < 3; k++) ps.push(part(new THREE.BoxGeometry(0.34, 4.2, 0.1), "#9ecbff", (k - 1) * 0.42, 2.0, 0.05));
  ps.push(part(new THREE.SphereGeometry(0.7, 6, 4), "#eaf4ff", 0, 0.12, 0.1, 0, 0, 1, 0.4, 0.8));
  return merge(ps);
}
function makeSurfboard() {
  return merge([
    part(new THREE.SphereGeometry(0.34, 6, 5), "#f8f9fa", 0, 1.35, 0, 0, 0, 1, 4.0, 0.35),
    part(new THREE.BoxGeometry(0.62, 0.22, 0.12), "#ef476f", 0, 1.5, 0),
  ]);
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

// 바닥 타원 그림자: 오브젝트가 땅에 붙어 보이게. 종류마다 밑동 크기가 다르다 (미터)
const SHADOW_R = {
  tree: 1.5, treeCity: 1.3, pine: 1.4, rock: 1.1, house: 4.2, lamp: 0.45, palm: 1.2,
  parasol: 1.3, sign: 0.5, busstop: 2.1, light: 0.4, fence: 1.5, mailbox: 0.35,
  flowers: 1.2, rail: 1.7, warn: 0.4, falls: 0.9, surf: 0.45,
  bld0: 5.5, bld1: 7.5, bld2: 4.5,
};

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
// 몸통·다리는 넣지 않는다 (도형으로 만든 몸은 부자연스러움 — 페달 박자는 카메라 흔들림으로 표현).
// 후드를 잡은 손·팔뚝만 넣는다: 핸들바만 떠 있으면 내 몸이 없는 것처럼 보인다.
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
  // 손: 후드를 감싼 장갑 + 몸 쪽으로 빠지며 화면 밖으로 나가는 팔뚝
  const glove = new THREE.MeshLambertMaterial({ color: 0x565d69, flatShading: true });   // 2D 장갑색(#4a515c)과 같은 계열
  const knuck = new THREE.MeshLambertMaterial({ color: 0x6d7583, flatShading: true });
  const skin = new THREE.MeshLambertMaterial({ color: 0xd9a77f, flatShading: true });
  const sleeve = new THREE.MeshLambertMaterial({ color: 0xff6b35, flatShading: true });  // ME.jersey
  hands = [];
  for (const s of [-1, 1]) {
    const h = new THREE.Group();
    // 후드를 잡은 장갑만 넣고 팔뚝은 넣지 않는다.
    // 팔을 원기둥으로 이으면 카메라에 가까운 쪽이 굵어져 기둥처럼 보이고 드롭을 가린다.
    // 실제 1인칭 시야에서도 팔뚝은 화면 아래로 빠져 거의 보이지 않는다.
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.026, 0.078), glove);
    back.position.set(s * 0.212, 0.03, -0.072);
    back.rotation.x = -0.35;                        // 후드 기울기를 따라 감싼다
    back.rotation.z = s * 0.12;
    h.add(back);
    for (let k = 0; k < 3; k++) {                   // 손등 너클
      const kn = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 6, 5), knuck);
      kn.position.set(s * 0.212 + (k - 1) * 0.016, 0.042, -0.101 + k * 0.002);
      kn.scale.set(1, 0.8, 1.2);
      h.add(kn);
    }
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 6, 5), glove);
    thumb.scale.set(1.1, 0.85, 1.7);
    thumb.position.set(s * 0.19, 0.024, -0.086);    // 안쪽으로 감은 엄지
    h.add(thumb);
    // 팔뚝: 후드에서 화면 아래 바깥 모서리로 빠져나간다.
    // 예전에 안쪽(화면 가운데)으로 모았더니 기둥 두 개처럼 보이고 드롭을 가렸다.
    // 팔꿈치는 카메라에 훨씬 가까워서, 실제 간격이 좁아도 화면에서는 더 벌어져 보인다.
    const seg = (x1, y1, z1, x2, y2, z2, r1, r2, mat) => {
      const from = new THREE.Vector3(x1, y1, z1), dir = new THREE.Vector3(x2, y2, z2).sub(from);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, dir.length(), 7), mat);
      mesh.position.copy(from).addScaledVector(dir, 0.5);
      mesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      return mesh;
    };
    // 후드 쪽 절반 = 맨살, 화면 밖 쪽 절반 = 저지 소매
    h.add(seg(s * 0.207, 0.018, -0.045, s * 0.203, -0.062, 0.115, 0.021, 0.030, skin));
    h.add(seg(s * 0.203, -0.062, 0.115, s * 0.198, -0.150, 0.300, 0.030, 0.040, sleeve));
    g.add(h);
    hands.push(h);
  }
  g.position.set(0, -0.17, -0.6);
  return g;
}

// 페달 박자에 맞춘 미세 그립 (좌우 반대 위상) + 오르막이면 바 탑으로 손 이동.
// 몸 전체를 움직이지 않고 손·팔만 움직인다.
let gripT3d = 0;
function updateHands(climbing) {
  gripT3d += ((climbing ? 1 : 0) - gripT3d) * 0.06;
  for (let i = 0; i < hands.length; i++) {
    const side = i === 0 ? -1 : 1;
    const phase = disp.angle + i * Math.PI;
    const push = clamp(disp.rpm / 110, 0, 1);
    // 오르막: 후드에서 바 탑으로 (안쪽·위·뒤로)
    hands[i].position.x = Math.cos(phase) * 0.0016 * push - side * 0.055 * gripT3d;
    hands[i].position.y = Math.sin(phase) * 0.003 * push + 0.012 * gripT3d;
    hands[i].position.z = 0.055 * gripT3d;
  }
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
  // 컨텍스트를 잃으면 그리기를 멈추고 2D에게 넘긴다 (기본 렌더러라 멈추면 게임이 끝난다)
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    window.R3D.on = false;
    if (typeof window.onGfxLost === "function") window.onGfxLost();
  });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  scene = new THREE.Scene();
  fog = new THREE.Fog(0xd4ecf6, FOG_NEAR, 470);
  scene.fog = fog;
  setFog();
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
  tUv = new Float32Array(quads * 6 * 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("color", new THREE.BufferAttribute(tCol, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("uv", new THREE.BufferAttribute(tUv, 2).setUsage(THREE.DynamicDrawUsage));
  terrain = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: grainTexture(), vertexColors: true, depthWrite: false, depthTest: false,
  }));
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
  addInstanced("sign", makeSign(), lambert(), 40);
  addInstanced("busstop", makeBusStop(), lambert(), 20);
  addInstanced("light", makeTrafficLight(), lambert(), 20);
  addInstanced("fence", makeFence(), lambert(), 50);
  addInstanced("mailbox", makeMailbox(), lambert(), 30);
  addInstanced("flowers", makeFlowerBed(), lambert(), 40);
  addInstanced("rail", makeGuardrail(), lambert(), 60);
  addInstanced("warn", makeWarnSign(), lambert(), 25);
  addInstanced("falls", makeWaterfall(), lambert(), 20);
  addInstanced("surf", makeSurfboard(), lambert(), 25);
  const bmat = new THREE.MeshLambertMaterial({ map: windowTexture(), flatShading: true });
  BUILD_VARIANTS.forEach((v, i) => addInstanced("bld" + i, makeBuilding(v), bmat, 40));

  // 그림자는 지형(renderOrder -10) 위, 오브젝트(0) 아래에 깔린다
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false, depthTest: false,
  });
  const shadowGeo = new THREE.CircleGeometry(1, 10);
  shadowGeo.rotateX(-Math.PI / 2);
  shadowGeo.scale(1, 1, 0.42);              // 위에서 비스듬히 보므로 앞뒤로 납작하게
  const sh = addInstanced("shadow", shadowGeo, shadowMat, 460);
  sh.renderOrder = -5;

  addInstanced("riderKit", makeRiderKit(), lambert(), 8);
  addInstanced("riderBody", makeRiderBody(), lambert(), 8);
  addInstanced("riderThigh", makeThigh(), lambert(), 16);
  addInstanced("riderCalf", makeCalf(), lambert(), 16);

  cockpit = buildCockpit();
  camera.add(cockpit);
  resize();
}

function resize() {
  if (!renderer) return;
  const coarse = COARSE;
  // 저사양 태블릿(PowerVR GE8320) 대비: 터치 기기는 0.75배 해상도로 그리고 늘림
  renderer.setPixelRatio(coarse ? PIXEL_STEPS[pixelStep] : Math.min(window.devicePixelRatio || 1, 1.25));
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
// 노면·지면 질감: 자갈이 박힌 아스팔트 느낌의 회색 잡티. 밝기 1 근처라 정점 색을 흐리지 않고
// 결만 얹는다 (최종색 = 텍스처 x 정점색). 캔버스로 한 번 만들어 올리면 매 프레임 비용은 0.
function grainTexture() {
  const n = 128, c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d");
  g.fillStyle = "#e0e0e0"; g.fillRect(0, 0, n, n);
  // 큰 얼룩이 먼저. 1cm짜리 알갱이는 멀어지면 밉맵에 평균으로 묻혀 아무것도 안 보인다
  // → 실제로 보는 거리(10~60m)에서 읽히도록 0.5~2m 크기의 얼룩을 깐다.
  for (let i = 0; i < 46; i++) {
    const v = 202 + Math.floor(Math.random() * 46), r = 7 + Math.random() * 17;
    const x = Math.random() * n, y = Math.random() * n;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${v},${v},${v},0.85)`);
    gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = gr;
    for (const [ox, oy] of [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n]]) {   // 이음매가 안 보이게
      g.save(); g.translate(ox, oy);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }
  for (let i = 0; i < 6; i++) {               // 진행 방향으로 난 자국 (보수 자국·바퀴 자국)
    const v = 198 + Math.floor(Math.random() * 30), x = Math.random() * n, w = 2 + Math.random() * 5;
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.fillRect(x, 0, w, n);
  }
  for (let i = 0; i < 2200; i++) {            // 잔 알갱이 (가까이서만 보임)
    const v = 196 + Math.floor(Math.random() * 60);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.random() * n, Math.random() * n, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const UV_SCALE = 7.5;      // m 당 텍스처 1칸. 얼룩 하나가 대략 0.5~2m

function quadAt(xL1, xR1, y1, z1, xL2, xR2, y2, z2, c, uL, uR, v1, v2) {
  const o = qi * 18, o2 = qi * 12;
  const P = tPos, C = tCol, U = tUv;
  // 두 삼각형: (L1,R1,R2) (L1,R2,L2)
  P[o] = xL1; P[o + 1] = y1; P[o + 2] = z1;   P[o + 3] = xR1; P[o + 4] = y1; P[o + 5] = z1;   P[o + 6] = xR2; P[o + 7] = y2; P[o + 8] = z2;
  P[o + 9] = xL1; P[o + 10] = y1; P[o + 11] = z1; P[o + 12] = xR2; P[o + 13] = y2; P[o + 14] = z2; P[o + 15] = xL2; P[o + 16] = y2; P[o + 17] = z2;
  for (let k = 0; k < 6; k++) { C[o + k * 3] = c[0]; C[o + k * 3 + 1] = c[1]; C[o + k * 3 + 2] = c[2]; }
  // UV는 카메라가 아니라 도로 기준(가로 = 중심에서의 거리, 세로 = 실제 주행거리)이라
  // 달려도 무늬가 화면에 붙어 따라오지 않는다
  U[o2] = uL; U[o2 + 1] = v1;   U[o2 + 2] = uR; U[o2 + 3] = v1;   U[o2 + 4] = uR; U[o2 + 5] = v2;
  U[o2 + 6] = uL; U[o2 + 7] = v1;  U[o2 + 8] = uR; U[o2 + 9] = v2;  U[o2 + 10] = uL; U[o2 + 11] = v2;
  qi++;
}
function emptyQuad() { tPos.fill(0, qi * 18, qi * 18 + 18); qi++; }
const rgbCache = {};
const c01 = (hex) => rgbCache[hex] || (rgbCache[hex] = hexRgb(hex).map((v) => v / 255));

function adaptQuality(dt, now) {
  // 탭이 숨겨져 있으면 rAF가 1Hz로 떨어진다. 그 프레임을 성능으로 착각하면 돌아왔을 때
  // 품질이 바닥에 고정된다 → 표본에서 뺀다. 단, dt 임계값으로 거르면 안 된다:
  // 4~7fps인 진짜 느린 기기의 dt(0.14~0.25초)와 겹쳐서 정작 조절이 필요한 기기를 놓친다.
  if (document.hidden || now < wakeAt3d || dt > 0.6) { qualityAt = now; return; }
  frameMs += (dt * 1000 - frameMs) * 0.12;
  if (now - qualityAt < 1200) return;
  const fps = 1000 / frameMs;
  const coarse = COARSE;
  if (fps < FPS_TARGET_LOW) {
    if (drawN > N_MIN) { drawN = Math.max(N_MIN, drawN - 15); setFog(); }
    else if (coarse && pixelStep < PIXEL_STEPS.length - 1) { pixelStep++; resize(); }
    else return;
    qualityAt = now;
  } else if (fps > FPS_TARGET_HIGH) {
    if (coarse && pixelStep > 0) { pixelStep--; resize(); }
    else if (drawN < N) { drawN = Math.min(N, drawN + 10); setFog(); }
    else return;
    qualityAt = now;
  }
}

let fogMul = 1;
function setFog() {
  fog.near = FOG_NEAR;
  fog.far = Math.max(120, drawN * SEG * FOG_SPAN * fogMul);
  if (window.R3D) window.R3D.drawDist = drawN * SEG;
}

function render(dt, now) {
  adaptQuality(dt, now);
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
  // 해 방향도 테마마다 다르다 — 방향이 하나면 노을 팔레트여도 정오처럼 보인다
  const d0 = tp.dir || tc.dir, d1 = tc.dir;
  sun.position.set(lerp(d0[0], d1[0], themeFade), lerp(d0[1], d1[1], themeFade), lerp(d0[2], d1[2], themeFade));
  fogMul = lerp(tp.fog ?? 1, tc.fog ?? 1, themeFade);
  setFog();
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
  for (let n = 0; n <= drawN; n++) {
    const d = (baseIdx + n) * SEG;
    xs[n] = x; ys[n] = elevAt(d) - e0; zs[n] = -(d - camZ);
    x += dx; dx += curveAt(baseIdx + n);
  }

  // 지형 (먼 곳부터)
  qi = 0;
  const padIdx = new Set();
  if (arc) for (const o of arc.objects) if (o.t === "pad") { const k = Math.floor(o.d / SEG); padIdx.add(k); padIdx.add(k + 1); }
  for (let n = drawN - 1; n >= 0; n--) {
    const idx = baseIdx + n;
    const t = T3[paletteKey(themeAt(idx * SEG))];
    const st = mod(Math.floor(idx / 3), 2);
    const x1 = xs[n], y1 = ys[n], z1 = Math.min(zs[n], 0.5), x2 = xs[n + 1], y2 = ys[n + 1], z2 = zs[n + 1];
    const va = (idx * SEG) / UV_SCALE, vb = va + SEG / UV_SCALE;
    const Q = (l, r, c) => quadAt(x1 + l, x1 + r, y1, z1, x2 + l, x2 + r, y2, z2, c,
                                  l / UV_SCALE, r / UV_SCALE, va, vb);
    Q(-400, 400, c01(t.ground[st]));
    Q(-RW * 1.32, RW * 1.32, c01(t.verge[st]));
    Q(-RW, RW, c01(t.road[st]));
    Q(-RW * 0.95, -RW * 0.91, c01(t.edge));
    Q(RW * 0.91, RW * 0.95, c01(t.edge));
    if (mod(idx, 4) < 2) Q(-RW * 0.016, RW * 0.016, c01(t.lane)); else emptyQuad();
    if (padIdx.has(idx)) Q(-RW * 0.55, RW * 0.55, Math.floor(now / 150) % 2 === mod(idx, 2) ? c01("#00e5ff") : c01("#0096c7")); else emptyQuad();
  }
  terrain.geometry.setDrawRange(0, qi * 6);           // 줄어든 세그먼트는 아예 안 보냄
  terrain.geometry.attributes.position.updateRanges = [{ start: 0, count: qi * 6 * 3 }];
  terrain.geometry.attributes.color.updateRanges = [{ start: 0, count: qi * 6 * 3 }];
  terrain.geometry.attributes.uv.updateRanges = [{ start: 0, count: qi * 6 * 2 }];
  terrain.geometry.attributes.position.needsUpdate = true;
  terrain.geometry.attributes.color.needsUpdate = true;
  terrain.geometry.attributes.uv.needsUpdate = true;

  // 결승선
  const fin = track && track.finish;
  finishMesh.visible = false;
  if (fin) {
    const n = (fin - baseIdx * SEG) / SEG;
    if (n > 0 && n < drawN) {
      const i = Math.floor(n), t = n - i;
      finishMesh.position.set(lerp(xs[i], xs[i + 1], t), lerp(ys[i], ys[i + 1], t) + 0.01, lerp(zs[i], zs[i + 1], t));
      finishMesh.visible = true;
    }
  }

  resetInstances();
  placeScenery();
  placeRiders(fp);
  finalizeInstances();

  // 콕핏
  cockpit.visible = fp;
  if (fp) {
    updateHands(climbing);
    updateGauge(dt);
  }

  renderer.render(scene, camera);
  drawOverlay(dt, now, fp, cam, fx);
}

// --- 인스턴스 배치 (풍경과 라이더가 같은 카운터를 쓴다) ---
const cnt = {};
function resetInstances() { for (const k in inst) cnt[k] = 0; }
function finalizeInstances() {
  for (const k in inst) {
    const m = inst[k];
    m.count = cnt[k];
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}
// 같은 종류라도 개체마다 밝기·색조를 조금씩 흔든다 (공짜인데 "복붙" 느낌이 사라진다).
// 색을 안 주면 instanceColor가 0(검정)으로 남는 인스턴스가 생기므로 항상 채운다.
function jitter(seed, color) {
  const a = hash(seed * 7.3), b = hash2(seed * 3.1);
  const l = 0.95 + a * 0.1;                        // 밝기 ±5%
  if (color) col.set(color); else col.setRGB(1, 1, 1);
  col.r *= l * (1 + (b - 0.5) * 0.06);             // 색조도 살짝 (따뜻/차갑게)
  col.g *= l;
  col.b *= l * (1 - (b - 0.5) * 0.06);
  return col;
}
function putShadow(px, py, pz, r) {
  const m = inst.shadow;
  if (cnt.shadow >= m.instanceMatrix.count) return;
  q.setFromAxisAngle(up, 0);
  sc3.set(r * 1.2, 1, r * 1.2);
  m4.compose(v3.set(px + r * 0.15, py + 0.02, pz), q, sc3);   // 광원 반대쪽으로 살짝
  m.setMatrixAt(cnt.shadow, m4);
  cnt.shadow++;
}
function put(name, px, py, pz, s, rotY, color) {
  const m = inst[name];
  if (cnt[name] >= m.instanceMatrix.count) return;
  q.setFromAxisAngle(up, rotY);
  sc3.set(s, s, s);
  m4.compose(v3.set(px, py, pz), q, sc3);
  m.setMatrixAt(cnt[name], m4);
  m.setColorAt(cnt[name], jitter(px * 13.7 + pz * 0.31, color));
  cnt[name]++;
  const r = SHADOW_R[name];
  if (r) putShadow(px, py, pz, r * s);
}

// ---------------------------------------------------------------------
// 3D 라이더 (라이벌 + 후방 시점의 나). 2D 그림을 얹던 걸 실제 입체로 바꾼다.
// 메시 4개로 나눈 이유:
//   body  = 저지·헬멧. 흰 정점 → instanceColor로 선수 색을 입힌다.
//   kit   = 자전거·반바지·신발. 색이 고정이라 tint하면 안 된다 (파란 저지에 파란 다리가 된다).
//   thigh/calf = 크랭크 각도로 매 프레임 각도가 바뀌므로 따로.
// 그리기는 4번뿐이라 선수가 6명이든 1명이든 비용이 같다.
// ---------------------------------------------------------------------
const RD = {
  wheelR: 0.335, hipY: 0.95, hipZ: 0.07, hipX: 0.105, shoulder: 0.40,
  crankY: 0.32, crankZ: -0.03, pedalR: 0.17, thigh: 0.42, calf: 0.44,
};
// 성격별 실루엣 (키는 같게, 폭만 바꾼다 — 키가 달라지면 거리 판단이 흐려진다)
const RIDER_SHAPE = {
  climber:  { sh: 0.90, hip: 0.88, leg: 0.85, lean: 0.05 },
  sprinter: { sh: 1.10, hip: 1.05, leg: 1.15, lean: -0.02 },
  steady:   { sh: 1.00, hip: 1.00, leg: 1.00, lean: 0.00 },
  starter:  { sh: 0.95, hip: 0.95, leg: 0.95, lean: 0.09 },
  attacker: { sh: 1.04, hip: 1.00, leg: 1.08, lean: 0.07 },
  me:       { sh: 1.00, hip: 1.00, leg: 1.00, lean: 0.02 },
};
const LEAN_BASE = 0.52;          // 라디안. 도로 자전거의 기본 상체 각도

function makeRiderBody() {       // 원점 = 엉덩이. instanceColor가 저지색을 입힌다
  const h = 0.40;
  // 허리에서 어깨로 벌어지는 사다리꼴. 4면 원기둥을 45° 돌리면 각진 통이 된다.
  const torso = new THREE.CylinderGeometry(0.155, 0.10, h, 4);
  torso.rotateY(Math.PI / 4);
  const shoulder = new THREE.CylinderGeometry(0.155, 0.145, 0.11, 4);
  shoulder.rotateY(Math.PI / 4);
  return merge([
    part(torso, "#ffffff", 0, h / 2, 0, 0, 0, 1.45, 1, 1.05),
    part(shoulder, "#ffffff", 0, h + 0.03, -0.01, 0, 0, 1.5, 1, 1.1),   // 어깨가 제일 넓다
    // 헬멧: 뒤에서 보면 앞뒤로 긴 물방울
    part(new THREE.SphereGeometry(0.1, 7, 6), "#ffffff", 0, h + 0.17, -0.02, 0, 0, 1.05, 0.92, 1.45),
  ]);
}
function makeRiderKit() {        // 원점 = 땅. 색 고정 (tint 안 함)
  const R = RD, ps = [];
  for (const wz of [0.52, -0.55]) {                                                 // 바퀴
    const g = new THREE.TorusGeometry(R.wheelR, 0.05, 4, 14);
    g.rotateY(Math.PI / 2);
    ps.push(part(g, "#1b1b1f", 0, R.wheelR, wz));
  }
  ps.push(part(new THREE.BoxGeometry(0.06, 0.06, 1.0), "#2b2f37", 0, R.wheelR + 0.28, 0));          // 탑튜브
  ps.push(part(new THREE.BoxGeometry(0.06, 0.62, 0.06), "#2b2f37", 0, R.wheelR + 0.02, 0.4, 0.45));  // 시트튜브
  ps.push(part(new THREE.BoxGeometry(0.06, 0.66, 0.06), "#2b2f37", 0, R.wheelR + 0.06, -0.5, -0.3)); // 헤드튜브
  // 뒤에서 보이는 삼각형: 시트스테이·체인스테이가 뒷바퀴 양옆으로 벌어진다 → "자전거"로 읽힌다
  for (const sx of [-1, 1]) {
    ps.push(part(new THREE.BoxGeometry(0.035, 0.58, 0.035), "#2b2f37", sx * 0.055, R.wheelR + 0.16, 0.3, 0.62, sx * 0.12));
    ps.push(part(new THREE.BoxGeometry(0.035, 0.5, 0.035), "#2b2f37", sx * 0.05, R.wheelR - 0.14, 0.28, 1.25, sx * 0.1));
  }
  ps.push(part(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 6), "#4a5058", 0, R.wheelR, 0.52, 0, Math.PI / 2));  // 뒤 허브
  ps.push(part(new THREE.BoxGeometry(0.44, 0.05, 0.06), "#17191d", 0, R.hipY - 0.06, -0.58));       // 핸들바
  ps.push(part(new THREE.BoxGeometry(0.13, 0.05, 0.26), "#15171b", 0, R.hipY - 0.1, R.hipZ + 0.06)); // 안장
  ps.push(part(new THREE.BoxGeometry(0.30, 0.16, 0.30), "#23263a", 0, R.hipY - 0.04, R.hipZ));       // 반바지
  return merge(ps);
}
const makeThigh = () => merge([part(new THREE.CylinderGeometry(0.075, 0.062, RD.thigh, 5), "#d9a77f", 0, -RD.thigh / 2, 0)]);
const makeCalf = () => merge([
  part(new THREE.CylinderGeometry(0.058, 0.042, RD.calf, 5), "#d9a77f", 0, -RD.calf / 2, 0),
  part(new THREE.BoxGeometry(0.09, 0.05, 0.19), "#f2f2f2", 0, -RD.calf - 0.02, -0.03),   // 신발
]);

const down = new THREE.Vector3(0, -1, 0);
const xAxis = new THREE.Vector3(1, 0, 0);
// 엉덩이~페달 2관절 풀이. 전부 YZ 평면(옆에서 본 면)이라 2D 삼각법으로 충분하다.
function kneeAt(hy, hz, py, pz) {
  const dy = py - hy, dz = pz - hz;
  const L1 = RD.thigh, L2 = RD.calf;
  const d = Math.min(Math.max(Math.hypot(dy, dz), Math.abs(L1 - L2) + 0.02), L1 + L2 - 0.02);
  const base = Math.atan2(dz, dy);
  const a1 = Math.acos(Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
  const ang = base - a1;                       // 무릎은 앞(-z)으로 꺾인다
  return [hy + Math.cos(ang) * L1, hz + Math.sin(ang) * L1];
}
function putLimb(name, px, py, pz, ty, tz, thick) {
  const m = inst[name];
  if (cnt[name] >= m.instanceMatrix.count) return;
  v3.set(0, ty - py, tz - pz).normalize();
  q.setFromUnitVectors(down, v3);
  sc3.set(thick, 1, thick);
  m4.compose(v3.set(px, py, pz), q, sc3);
  m.setMatrixAt(cnt[name], m4);
  cnt[name]++;
}

function placeRiders(fp) {
  const riders = [];
  for (const r of (S && S.riders) || []) {
    if (r.kind === "ai") riders.push({ d: r.distance_m, lane: r.lane || 0, color: r.color, a: riderAngles[r.id] || 0, shape: r.persona_id });
  }
  if (!fp) riders.push({ d: pos0, lane: 0, color: ME.jersey, a: disp.angle, shape: "me" });
  for (const r of riders) {
    if (r.d - camZ < 2.0) continue;            // 카메라에 붙으면 화면을 다 덮는다
    const w = worldAt(r.d, r.lane);
    if (!w) continue;
    const [px, py, pz] = w;
    const sp = RIDER_SHAPE[r.shape] || RIDER_SHAPE.steady;

    putShadow(px, py, pz, 0.62);
    // 자전거 + 반바지
    let m = inst.riderKit;
    if (cnt.riderKit < m.instanceMatrix.count) {
      q.setFromAxisAngle(up, 0);
      sc3.set(sp.hip, 1, 1);
      m4.compose(v3.set(px, py, pz), q, sc3);
      m.setMatrixAt(cnt.riderKit, m4);
      cnt.riderKit++;
    }
    // 상체 (엉덩이에서 앞으로 숙임)
    m = inst.riderBody;
    if (cnt.riderBody < m.instanceMatrix.count) {
      q.setFromAxisAngle(xAxis, -(LEAN_BASE + sp.lean * 3));   // -x 회전 = 머리가 진행 방향(-z)으로
      sc3.set(sp.sh, 1, 1);
      m4.compose(v3.set(px, py + RD.hipY, pz + RD.hipZ), q, sc3);
      m.setMatrixAt(cnt.riderBody, m4);
      col.set(r.color);
      m.setColorAt(cnt.riderBody, col);
      cnt.riderBody++;
    }
    // 다리: 크랭크 각도로 매 프레임 계산 (내 RPM과 박자가 맞아야 한다)
    for (const side of [-1, 1]) {
      const ang = r.a + (side < 0 ? 0 : Math.PI);
      const hy = py + RD.hipY - 0.06, hz = pz + RD.hipZ;
      const ppy = py + RD.crankY + Math.cos(ang) * RD.pedalR;
      const ppz = pz + RD.crankZ + Math.sin(ang) * RD.pedalR;
      const [ky, kz] = kneeAt(hy, hz, ppy, ppz);
      const hx = px + side * RD.hipX * sp.hip;
      putLimb("riderThigh", hx, hy, hz, ky, kz, sp.leg);
      putLimb("riderCalf", hx, ky, kz, ppy, ppz, sp.leg);
    }
  }
}

// 길가 오브젝트 배치 (2D drawSprites와 같은 규칙: 세그먼트 번호 해시로 결정 → 매번 같은 자리)
function placeScenery() {
  for (let n = 1; n < drawN; n++) {
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
      else if (h < 0.34) put("sign", px(3 + v * 3), py, pz, 1, side < 0 ? 0 : Math.PI, `hsl(${Math.floor(v * 360)},80%,55%)`);
      else if (h < 0.37) put("busstop", px(3.5), py, pz, 1, side < 0 ? 0 : Math.PI);
      else if (h < 0.40) put("light", px(1.6), py, pz, 1, side < 0 ? 0 : Math.PI);
    } else if (theme === "suburb") {
      if (h < 0.2) put("tree", px(2 + v * 7), py, pz, 0.85 + v * 0.6, rot);
      else if (h < 0.25) put("house", px(9 + v * 4), py, pz, 1, side < 0 ? Math.PI / 2 : -Math.PI / 2, ["#ffffff", "#e8eef6", "#fff0e8"][Math.floor(v * 3)]);
      else if (h < 0.30) put("fence", px(2.2), py, pz, 1, 0);
      else if (h < 0.33) put("mailbox", px(1.6), py, pz, 1, rot);
      else if (h < 0.36) put("flowers", px(2 + v * 2), py, pz, 0.8 + v * 0.5, rot);
    } else if (theme === "mountain") {
      if (h < 0.28) put("pine", px(2 + v * 9), py, pz, 0.9 + v * 0.9, rot);
      else if (h < 0.36) put("rock", px(1.5 + v * 3), py, pz, 0.6 + v, rot);
      else if (h < 0.42) put("rail", px(1.5), py, pz, 1, 0);
      else if (h < 0.45) put("warn", px(1.7), py, pz, 1, side < 0 ? 0 : Math.PI);
      else if (h < 0.48) put("falls", px(6 + v * 5), py, pz, 0.8 + v * 0.8, side < 0 ? 0 : Math.PI);
    } else if (theme === "beach") {
      if (h < 0.12) put("palm", px(2.5 + v * 5), py, pz, 0.9 + v * 0.5, rot);
      else if (h < 0.17) put("parasol", px(4 + v * 6), py, pz, 1, rot, v > 0.5 ? "#ffffff" : "#8fd0ff");
      else if (h < 0.21) put("surf", px(3 + v * 3), py, pz, 1, rot, v > 0.5 ? "#ffd166" : "#f8f9fa");
    }
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

// 3D 몸 위에 겹치는 2D 요소: 이름표, 어택 오라, 터보 불꽃 등
function drawRiderFx(p, o) {
  const m = p.m;
  if (o.flame) {
    const fl = 0.3 + Math.random() * 0.25;
    ctx.fillStyle = "rgba(255,140,0,0.85)";
    ctx.beginPath(); ctx.moveTo(p.x - 0.14 * m, p.y - 0.12 * m); ctx.lineTo(p.x + 0.14 * m, p.y - 0.12 * m); ctx.lineTo(p.x, p.y + fl * m); ctx.fill();
  }
  if (o.aura) {
    const t = performance.now(), cy = p.y - 0.5 * m, pulse = 0.6 + 0.25 * Math.sin(t / 110);
    const g = ctx.createRadialGradient(p.x, cy, 0.08 * m, p.x, cy, 1.15 * m);
    g.addColorStop(0, `rgba(255,176,96,${0.4 * pulse})`);
    g.addColorStop(1, "rgba(255,140,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(p.x, cy, 1.15 * m, 1.0 * m, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,192,128,${0.55 * pulse})`;
    ctx.lineWidth = Math.max(1, 0.03 * m);
    for (let i = 0; i < 4; i++) {
      const ly = p.y - (0.22 + i * 0.24) * m, len = (0.35 + ((t / 260 + i * 0.27) % 1) * 0.55) * m;
      ctx.beginPath(); ctx.moveTo(p.x + 0.5 * m, ly); ctx.lineTo(p.x + 0.5 * m + len, ly); ctx.stroke();
    }
  }
  if (o.bubble) {
    ctx.fillStyle = "rgba(120,220,255,0.18)"; ctx.strokeStyle = "rgba(160,235,255,0.8)"; ctx.lineWidth = 0.03 * m;
    ctx.beginPath(); ctx.ellipse(p.x, p.y - 0.75 * m, 0.62 * m, 0.95 * m, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  if (o.dizzy) {
    ctx.font = `${Math.round(0.25 * m)}px system-ui`; ctx.textAlign = "center";
    ctx.fillText("💫", p.x + Math.sin(performance.now() / 120) * 0.15 * m, p.y - 1.6 * m);
  }
}
function drawRiderTag(p, r) {
  const o = riderOpts(r);
  drawRiderFx(p, { flame: o.flame, aura: o.aura, dizzy: o.dizzy });
  if (p.m > 18 && o.label) {
    const fs = clamp(0.2 * p.m, 11, 20);
    ctx.globalAlpha = o.fade ? 0.65 : 1;
    ctx.font = `800 ${fs}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.strokeText(o.label, p.x, p.y - 1.75 * p.m);
    ctx.fillStyle = o.labelColor || r.color;
    ctx.fillText(o.label, p.x, p.y - 1.75 * p.m);
    ctx.globalAlpha = 1;
  }
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
  // 몸은 3D 메시가 그린다 (placeRiders). 여기서는 이름표와 이펙트만 겹친다.
  for (const r of (S && S.riders) || []) {
    if (r.kind === "ai") add(r.distance_m, r.lane, (p) => { if (p.m > 1) drawRiderTag(p, r); });
    else if (r.kind === "ghost" && r.distance_m > pos0 + 1.5) add(r.distance_m, -0.4, (p) => drawRider(p.x, p.y, p.m, disp.angle * 0.97 + 1, GHOST));
  }
  if (track && track.finish) {
    add(track.finish, 0, (p) => drawFinishArch(p.x, p.y, p.m, p.m * RW));
  }
  if (!fp) {   // 내 몸도 3D. 아이템 이펙트만 겹쳐 그린다
    add(pos0, 0, (p) => drawRiderFx(p, {
      flame: !!(fx.turbo || fx.pad || fx.star), rainbow: !!fx.star,
      bubble: !!fx.shield, dizzy: !!fx.slip,
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

// drawDist: 지금 그리는 거리(m). HUD가 매 초 읽어 표시한다.
window.R3D = { init, render, resize, on: false, drawDist: 0,   // init()의 setFog()가 채운다
  quality: () => ({ drawN, pixelStep, fps: Math.round(1000 / frameMs) }) };
