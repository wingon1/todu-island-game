// main.js — Vite entry. Sets up the renderer, orthographic diorama camera,
// lighting, the game loop, resize handling, tap raycasting, and wires all
// systems together.
import * as THREE from 'three';
import { gameState, FINAL_STAGE, STAGES } from './GameState.js';
import { audio } from './Audio.js';
import { Particles } from './Particles.js';
import { Island } from './Island.js';
import { Store } from './Store.js';
import { AnimalManager } from './Animal.js';
import { WorkerManager } from './Worker.js';
import { FacilityManager } from './Facility.js';
import { UI, itemIconSVG } from './UI.js';

// ---------------------------------------------------------------------------
// Renderer (covers only the top 65% of the screen height).
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game-canvas');
const canvasWrap = document.getElementById('canvas-wrap');
const labelLayer = document.getElementById('label-layer');

// Create the renderer defensively. Some browsers/devices fail to provide a
// WebGL context (hardware acceleration disabled, sandboxed env, blocklisted
// GPU). Instead of throwing an uncaught error, show a friendly notice.
function showWebGLError() {
  const gate = document.getElementById('start-gate');
  if (gate) {
    gate.innerHTML = `
      <h1>😢 WebGL을 켤 수 없어요</h1>
      <p>이 브라우저에서 3D 그래픽(WebGL) 컨텍스트를 만들지 못했습니다.
      게임 코드 문제가 아니라 브라우저의 <b>하드웨어 가속</b>이 꺼져 있을 때 발생해요.</p>
      <div style="text-align:left;font-size:14px;font-weight:600;opacity:.85;max-width:320px;line-height:1.7">
        <b>해결 방법 (Chrome 기준)</b><br/>
        1. 설정 → 시스템 → <b>"가능한 경우 하드웨어 가속 사용"</b> 켜기<br/>
        2. <b>chrome://gpu</b> 에서 WebGL 상태 확인<br/>
        3. <b>chrome://flags</b> 에서 "Override software rendering list" → Enabled<br/>
        4. 브라우저를 완전히 종료 후 재시작<br/><br/>
        그래도 안 되면 다른 브라우저(Chrome/Edge/Safari 최신 버전)나
        하드웨어 가속을 지원하는 기기에서 열어 주세요.
      </div>
      <div class="hint">WebGL renderer could not be created on this device.</div>`;
    gate.style.display = 'flex';
  }
}

function isWebGLAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
}

let renderer = null;
try {
  if (!isWebGLAvailable()) throw new Error('WebGL not available');
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'default',
    failIfMajorPerformanceCaveat: false, // allow software (SwiftShader) fallback
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
} catch (err) {
  console.error('[Cozy Island] WebGL init failed:', err);
  showWebGLError();
  throw err; // stop the rest of setup; the notice is already shown
}

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe9f5, 55, 120);

// ---------------------------------------------------------------------------
// Orthographic diorama camera at a classic isometric angle.
// ---------------------------------------------------------------------------
const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
// Classic iso angle (45° azimuth / 35.26° elevation), kept FIXED. The camera
// freely pans/zooms over the map: we move a ground look-target + a zoom value,
// keeping a constant offset so the angle never changes.
const camDist = 18;
const camOffH = camDist * 0.82; // camera height (constant)

// Free-camera state ---------------------------------------------------------
const camTarget = new THREE.Vector3(gameState.config.viewShift || 0, 0.6, 0);
let view = gameState.config.viewW || 9.5; // ortho half-width (zoom control)
const VIEW_MIN = 5;
const VIEW_MAX = 18;
// How far the look-target may roam (covers both islands + a margin).
const BOUND = { minX: -8, maxX: 20, minZ: -22, maxZ: 20 };
let breatheT = 0;

// Smooth focus animation (on stage change) and pan inertia.
let focusing = false;
const focusPos = new THREE.Vector3();
let focusView = view;
const panVel = new THREE.Vector2(0, 0); // world (x,z) glide per frame

let viewAspect = 1;
function computeAspect() {
  return window.innerWidth / (window.innerHeight * 0.83);
}
function setProjection() {
  const halfW = view;
  const halfH = view / viewAspect;
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}
function onResize() {
  viewAspect = computeAspect();
  renderer.setSize(window.innerWidth, window.innerHeight * 0.83, false);
  canvasWrap.style.height = '83%';
  setProjection();
}
window.addEventListener('resize', onResize);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Place the camera from the current target + zoom (call every frame).
function applyCamera() {
  view = clamp(view, VIEW_MIN, VIEW_MAX);
  camTarget.x = clamp(camTarget.x, BOUND.minX, BOUND.maxX);
  camTarget.z = clamp(camTarget.z, BOUND.minZ, BOUND.maxZ);
  camera.position.set(
    camTarget.x + camDist,
    camOffH + Math.sin(breatheT) * 0.03,
    camTarget.z + camDist
  );
  camera.lookAt(camTarget.x, 0.6, camTarget.z);
  setProjection();
}

// Snap the camera straight to a stage's framing (load / replay).
function setCameraToStage() {
  camTarget.set(gameState.config.viewShift || 0, 0.6, 0);
  view = gameState.config.viewW || 9.5;
  focusing = false;
  panVel.set(0, 0);
}

// Begin a smooth focus toward a stage's framing (on upgrade).
function focusOn(stage) {
  const cfg = STAGES[stage] || gameState.config;
  focusPos.set(cfg.viewShift || 0, 0.6, 0);
  focusView = cfg.viewW || 9.5;
  focusing = true;
}

// Project a screen point to the ground plane (y = 0.6).
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.6);
const _ndc = new THREE.Vector2();
const _hit = new THREE.Vector3();
function groundAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  return raycaster.ray.intersectPlane(_groundPlane, _hit) ? _hit.clone() : null;
}

onResize();
applyCamera();

// ---------------------------------------------------------------------------
// Lighting — one shadow-casting sun + soft fill.
// ---------------------------------------------------------------------------
const sun = new THREE.DirectionalLight(0xfff4dc, 1.5);
sun.position.set(12, 20, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -13;
sun.shadow.camera.right = 13;
sun.shadow.camera.top = 13;
sun.shadow.camera.bottom = -13;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0008;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x9bc77a, 0.7));
scene.add(new THREE.AmbientLight(0xffffff, 0.25));

// ---------------------------------------------------------------------------
// Systems.
// ---------------------------------------------------------------------------
const restoredFromSave = gameState.load();
const particles = new Particles(scene, camera, canvas, labelLayer, audio);
const island = new Island(scene);
const store = new Store(scene);

const animals = new AnimalManager(scene, store, particles, audio, {
  requestSell: (type) => {
    const value = gameState.sell(type);
    if (value) {
      store.refreshShelf();
      particles.spawnCoin(store.getCoinSpawnPosition(), value);
      scheduleSave();
      return value;
    }
    return false;
  },
});

// Hired part-timers (alba) that automate harvest/stock and stand in as clerks.
const workers = new WorkerManager(scene, island, store, particles, audio, {
  onHarvest: (type, worldPos) => flyHarvest(worldPos, type),
  onStock: () => {
    store.refreshShelf();
    scheduleSave();
  },
});

// Stage-5 production facilities: auto-produce resources into the inventory.
const facilities = new FacilityManager(scene, island, audio, {
  onProduce: (item, _pos, count) => {
    for (let i = 0; i < count; i++) gameState.addToInventory(item);
    ui.bumpChip(item);
    scheduleSave();
  },
});

let paused = true; // until Start tapped
let gameOver = gameState.stage >= FINAL_STAGE && gameState.finalSaleDone;

const ui = new UI({
  audio,
  onStart: () => startGame(),
  onUpgrade: () => doUpgrade(),
  onStock: () => doStock(),
  onReplay: () => doReplay(),
  onHire: (type) => doHire(type),
  onTestMoney: () => doTestMoney(),
  onFacilityHire: (id) => doFacilityHire(id),
});

function restoreWorldFromState() {
  island.reset();
  for (let s = 2; s <= gameState.stage; s++) island.applyUnlocks(s);
  store.build(gameState.stage);
  workers.reset();
  facilities.reset();
  animals.reset();
  setCameraToStage();
  applyCamera();
}

restoreWorldFromState();
if (gameOver) {
  paused = true;
  queueMicrotask(() => ui.showVictory());
}

// ---------------------------------------------------------------------------
// Tap / click harvesting via raycaster.
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function handleTap(clientX, clientY) {
  if (paused || gameOver) return;
  const rect = canvas.getBoundingClientRect();
  if (clientY > rect.bottom) return; // tap in UI panel
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  // Facility station tapped -> open its hire/upgrade popup.
  const fHits = raycaster.intersectObjects(island.getFacilityHits(), false);
  if (fHits.length) {
    ui.openFacility(fHits[0].object.userData.facility);
    return;
  }

  const hits = raycaster.intersectObjects(island.getHitMeshes(), false);
  if (hits.length === 0) return;
  const obj = hits[0].object;

  if (obj.userData.node) {
    const result = island.harvestNode(obj.userData.node);
    if (result) {
      audio.harvestPop();
      flyHarvest(result.worldPos, result.type);
    }
  } else if (obj.userData.shore) {
    const result = island.harvestShore(obj.userData.shore);
    if (result) {
      audio.harvestPop();
      flyHarvest(result.worldPos, result.type);
    }
  }
}

// ---------------------------------------------------------------------------
// Camera input: drag to pan (with inertia), pinch / wheel to zoom, short tap
// harvests. One finger = pan; two fingers = pinch-zoom.
// ---------------------------------------------------------------------------
canvas.style.touchAction = 'none';
const pointers = new Map(); // id -> {x, y}
let dragGrab = null; // world ground point under the finger
let dragMoved = false;
let dragStart = null;
let pinchPrevDist = 0;
const DRAG_THRESHOLD = 8; // px before a press becomes a drag (vs a tap)

function twoPointerInfo() {
  const [a, b] = [...pointers.values()];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}

canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  focusing = false;
  panVel.set(0, 0);
  if (pointers.size === 1) {
    dragMoved = false;
    dragStart = { x: e.clientX, y: e.clientY };
    applyCamera();
    dragGrab = groundAt(e.clientX, e.clientY);
  } else if (pointers.size === 2) {
    dragGrab = null; // stop panning, start pinch
    pinchPrevDist = twoPointerInfo().dist;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size >= 2) {
    const info = twoPointerInfo();
    if (pinchPrevDist > 0 && info.dist > 0) {
      applyCamera();
      const before = groundAt(info.mx, info.my);
      view = clamp(view * (pinchPrevDist / info.dist), VIEW_MIN, VIEW_MAX);
      applyCamera();
      const after = groundAt(info.mx, info.my);
      if (before && after) {
        camTarget.x += before.x - after.x;
        camTarget.z += before.z - after.z;
      }
    }
    pinchPrevDist = info.dist;
    return;
  }

  if (dragGrab) {
    if (!dragMoved && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > DRAG_THRESHOLD) {
      dragMoved = true;
    }
    if (dragMoved) {
      applyCamera();
      const cur = groundAt(e.clientX, e.clientY);
      if (cur) {
        const dx = dragGrab.x - cur.x;
        const dz = dragGrab.z - cur.z;
        camTarget.x += dx;
        camTarget.z += dz;
        panVel.set(dx, dz); // remember last move for inertia
      }
    }
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  const wasSingle = pointers.size === 1;
  pointers.delete(e.pointerId);
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}

  if (wasSingle) {
    if (!dragMoved) handleTap(e.clientX, e.clientY); // a tap -> harvest
    // else: keep panVel for inertia glide
    dragGrab = null;
  } else if (pointers.size === 1) {
    // Lifted one finger of a pinch — resume panning with the remaining one.
    const [p] = [...pointers.values()];
    applyCamera();
    dragGrab = groundAt(p.x, p.y);
    dragMoved = true;
    dragStart = { x: p.x, y: p.y };
    pinchPrevDist = 0;
  }
  if (pointers.size === 0) pinchPrevDist = 0;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    focusing = false;
    applyCamera();
    const before = groundAt(e.clientX, e.clientY);
    view = clamp(view * Math.exp(e.deltaY * 0.0012), VIEW_MIN, VIEW_MAX);
    applyCamera();
    const after = groundAt(e.clientX, e.clientY);
    if (before && after) {
      camTarget.x += before.x - after.x;
      camTarget.z += before.z - after.z;
    }
  },
  { passive: false }
);

// ---------------------------------------------------------------------------
// Harvest flight: a DOM dot flies along a quadratic Bézier to the inventory.
// ---------------------------------------------------------------------------
const appEl = document.getElementById('app');
function flyHarvest(worldPos, type) {
  const start = particles.worldToScreen(worldPos); // viewport coords (canvas at top)
  const chip = ui._chipEls[type]?.chip;
  let tx = window.innerWidth / 2;
  let ty = window.innerHeight * 0.8;
  if (chip) {
    const r = chip.getBoundingClientRect();
    tx = r.left + r.width / 2;
    ty = r.top + r.height / 2;
  }

  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:0;top:0;width:22px;height:22px;
    z-index:25;pointer-events:none;transform:translate(-50%,-50%);will-change:transform;
    filter:drop-shadow(0 2px 3px rgba(80,50,20,.4));`;
  el.innerHTML = itemIconSVG(type); // real item icon, not a colored dot
  appEl.appendChild(el);

  const sx = start.x;
  const sy = start.y;
  // Control point: midpoint raised ~100px.
  const cx = (sx + tx) / 2;
  const cy = Math.min(sy, ty) - 100;

  const dur = 600;
  const t0 = performance.now();
  function step(now) {
    const k = Math.min(1, (now - t0) / dur);
    const mt = 1 - k;
    const x = mt * mt * sx + 2 * mt * k * cx + k * k * tx;
    const y = mt * mt * sy + 2 * mt * k * cy + k * k * ty;
    el.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px) scale(${1 - 0.3 * k})`;
    if (k < 1) {
      requestAnimationFrame(step);
    } else {
      el.remove();
      gameState.addToInventory(type);
      ui.bumpChip(type);
      scheduleSave();
    }
  }
  // Use translate from origin; set initial.
  el.style.transform = `translate(-50%,-50%) translate(${sx}px,${sy}px)`;
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Game actions.
// ---------------------------------------------------------------------------
let saveDirty = false;
let saveTimer = 0;

function scheduleSave() {
  saveDirty = true;
}

function flushSave() {
  if (!saveDirty) return;
  gameState.save();
  saveDirty = false;
}

window.addEventListener('pagehide', () => {
  gameState.save();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') gameState.save();
});

function startGame() {
  audio.init();
  audio.resume();
  if (paused && !gameOver && !restoredFromSave) {
    gameState.startTime = performance.now();
  }
  paused = false;
}

function doUpgrade() {
  if (!gameState.canUpgrade()) return;
  const newStage = gameState.stage + 1;
  if (!gameState.upgrade()) return;

  // Cloud puff + sound.
  const p = store.getCoinSpawnPosition();
  particles.burstPuff(p, 14, 0xffffff);
  audio.stageUpgrade();

  // Rebuild store mesh for the new tier (disposes old meshes).
  store.build(newStage);
  // Enable whatever this stage unlocks (data-driven; see STAGES.unlocks).
  island.applyUnlocks(newStage);
  // Smoothly focus the camera on the new stage's area (then free to roam).
  focusOn(newStage);
  scheduleSave();
}

function doHire(type) {
  if (gameState.hireAlba(type)) {
    audio.coinRegister();
    scheduleSave();
  }
}

function doFacilityHire(id) {
  if (gameState.hireFacility(id)) {
    audio.coinRegister();
    ui.refreshFacility(id);
    scheduleSave();
  }
}

// Test helper: grant enough coins to afford the next upgrade right away.
function doTestMoney() {
  const cost = gameState.config.upgradeCost; // null at final stage
  const grant = Math.max(2000, (cost || 0) + 200);
  gameState.coins += grant;
  audio.coinRegister();
  scheduleSave();
}

function doStock() {
  let stocked = false;
  while (gameState.hasEmptyShelfSlot()) {
    const t = gameState.stockOne();
    if (!t) break;
    stocked = true;
  }
  if (stocked) {
    store.refreshShelf();
    audio.uiTap();
    scheduleSave();
  }
}

function doReplay() {
  gameState.reset();
  island.reset();
  store.reset();
  animals.reset();
  workers.reset();
  facilities.reset();
  particles.resetAll();
  ui._buildInventoryChips();
  ui._lastCoins = -1;
  ui._lastInv = {};
  gameOver = false;
  paused = false;
  setCameraToStage();
  applyCamera();
  gameState.startTime = performance.now();
  gameState.clearSave();
  scheduleSave();
}

// ---------------------------------------------------------------------------
// Main loop.
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;

  // --- Free camera: inertia glide + smooth stage focus, then place it. ---
  breatheT += dt * ((Math.PI * 2) / 4);
  if (pointers.size === 0 && (Math.abs(panVel.x) > 1e-4 || Math.abs(panVel.y) > 1e-4)) {
    camTarget.x += panVel.x;
    camTarget.z += panVel.y;
    panVel.multiplyScalar(0.9); // friction
  }
  if (focusing) {
    const k = Math.min(1, dt * 3);
    camTarget.x += (focusPos.x - camTarget.x) * k;
    camTarget.z += (focusPos.z - camTarget.z) * k;
    view += (focusView - view) * k;
    if (Math.abs(focusPos.x - camTarget.x) < 0.05 && Math.abs(view - focusView) < 0.05) focusing = false;
  }
  applyCamera();

  if (!paused && !gameOver) {
    island.update(dt, elapsed);
    store.update(dt, elapsed);
    animals.update(dt, elapsed, true);
    workers.update(dt, elapsed);
    facilities.update(dt, elapsed);

    // Victory: first sale of the final resource at the final stage.
    if (gameState.stage >= FINAL_STAGE && gameState.finalSaleDone) {
      gameOver = true;
      paused = true;
      ui.showVictory();
      scheduleSave();
    }
  } else {
    // Keep water gently animating even on the start/victory screens.
    island.update(0, elapsed);
    store.update(0, elapsed);
  }

  // Particles always update (coins/labels finishing their arcs).
  particles.update(dt, () => {});

  saveTimer += dt;
  if (saveTimer >= 2) {
    saveTimer = 0;
    flushSave();
  }

  ui.update();
  renderer.render(scene, camera);
}

animate();

// Expose a few handles for debugging in the console.
window.__game = { gameState, island, store, animals, workers, facilities, particles };
