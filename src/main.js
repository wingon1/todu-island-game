// main.js — Vite entry. Sets up the renderer, orthographic diorama camera,
// lighting, the game loop, resize handling, tap raycasting, and wires all
// systems together.
import * as THREE from 'three';
import { gameState, FINAL_STAGE } from './GameState.js';
import { audio } from './Audio.js';
import { Particles } from './Particles.js';
import { Island } from './Island.js';
import { Store } from './Store.js';
import { AnimalManager } from './Animal.js';
import { WorkerManager } from './Worker.js';
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
// Position so we look down at 45° azimuth / 35.26° elevation (classic iso).
const camDist = 18;
const camBase = new THREE.Vector3(camDist, camDist * 0.82, camDist);
camera.position.copy(camBase);
camera.lookAt(0, 0.6, 0);

let zoomFactor = 1; // for snap-zoom on upgrade
let targetZoom = 1;

// Per-stage framing — driven by STAGES[stage].viewW / viewShift so a new stage
// only needs config (no camera code changes). Values lerp on stage change.
const FRUSTUM_HALF_H = 9.0;
let frustumHalfW = gameState.config.viewW; // current (animated)
let viewShiftX = gameState.config.viewShift; // current pan along +x
let targetFrustumW = frustumHalfW;
let targetShiftX = viewShiftX;

function updateFrustum() {
  const w = window.innerWidth;
  const h = window.innerHeight * 0.79; // top 79% (canvas)
  const aspect = w / h;

  let halfH = Math.max(FRUSTUM_HALF_H, frustumHalfW / aspect);
  halfH *= zoomFactor;
  const halfW = halfH * aspect;

  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();

  renderer.setSize(w, h, false);
  canvasWrap.style.height = '79%';
}

window.addEventListener('resize', updateFrustum);
updateFrustum();

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
});

function restoreWorldFromState() {
  island.reset();
  for (let s = 2; s <= gameState.stage; s++) island.applyUnlocks(s);
  store.build(gameState.stage);
  workers.reset();
  animals.reset();
  frustumHalfW = gameState.config.viewW;
  viewShiftX = gameState.config.viewShift;
  targetFrustumW = frustumHalfW;
  targetShiftX = viewShiftX;
  updateFrustum();
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

// Pointer bindings (touch + mouse for desktop debugging).
let touchHandled = false;
canvas.addEventListener(
  'touchstart',
  (e) => {
    touchHandled = true;
    const t = e.changedTouches[0];
    handleTap(t.clientX, t.clientY);
  },
  { passive: true }
);
canvas.addEventListener('mousedown', (e) => {
  if (touchHandled) {
    touchHandled = false;
    return;
  }
  handleTap(e.clientX, e.clientY);
});

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

  // Cloud puff + sound + snap zoom.
  const p = store.getCoinSpawnPosition();
  particles.burstPuff(p, 14, 0xffffff);
  audio.stageUpgrade();
  targetZoom = 0.9;
  zoomSnapTimer = 0;

  // Rebuild store mesh for the new tier (disposes old meshes).
  store.build(newStage);
  // Enable whatever this stage unlocks (data-driven; see STAGES.unlocks).
  island.applyUnlocks(newStage);
  // Retarget the camera zoom/pan for the new stage.
  applyStageCamera();
  scheduleSave();
}

// Read the current stage's framing config; the loop lerps toward it.
function applyStageCamera() {
  targetFrustumW = gameState.config.viewW;
  targetShiftX = gameState.config.viewShift;
}

function doHire(type) {
  if (gameState.hireAlba(type)) {
    audio.coinRegister();
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
  particles.resetAll();
  ui._buildInventoryChips();
  ui._lastCoins = -1;
  ui._lastInv = {};
  gameOver = false;
  paused = false;
  zoomFactor = 1;
  targetZoom = 1;
  // Back to the starting stage's framing.
  frustumHalfW = gameState.config.viewW;
  viewShiftX = gameState.config.viewShift;
  targetFrustumW = frustumHalfW;
  targetShiftX = viewShiftX;
  updateFrustum();
  gameState.startTime = performance.now();
  gameState.clearSave();
  scheduleSave();
}

// ---------------------------------------------------------------------------
// Main loop.
// ---------------------------------------------------------------------------
let zoomSnapTimer = 999;
const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;

  // Per-stage camera zoom (frustum) + pan (toward the second island) easing.
  let frustumChanged = false;
  if (Math.abs(frustumHalfW - targetFrustumW) > 0.002) {
    frustumHalfW += (targetFrustumW - frustumHalfW) * Math.min(1, dt * 2.5);
    frustumChanged = true;
  }
  if (Math.abs(viewShiftX - targetShiftX) > 0.002) {
    viewShiftX += (targetShiftX - viewShiftX) * Math.min(1, dt * 2.5);
  }

  // Camera breathe (slow sine on y) + pan along +x toward the active area.
  camera.position.x = camBase.x + viewShiftX;
  camera.position.y = camBase.y + Math.sin((elapsed / 4) * Math.PI * 2) * 0.03;
  camera.position.z = camBase.z;
  camera.lookAt(viewShiftX, 0.6, 0);

  // Snap-zoom easing.
  if (targetZoom !== 1) {
    zoomSnapTimer += dt;
    if (zoomSnapTimer > 0.12) targetZoom = 1; // begin easing back after the punch
  }
  if (Math.abs(zoomFactor - targetZoom) > 0.001) {
    zoomFactor += (targetZoom - zoomFactor) * Math.min(1, dt * 8);
    frustumChanged = true;
  }
  if (frustumChanged) updateFrustum();

  if (!paused && !gameOver) {
    island.update(dt, elapsed);
    store.update(dt, elapsed);
    animals.update(dt, elapsed, true);
    workers.update(dt, elapsed);

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
window.__game = { gameState, island, store, animals, workers, particles };
