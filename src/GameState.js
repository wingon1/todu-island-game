// GameState.js — single source of truth + central registries.
// Designed to be EXTENSIBLE: add a resource by adding one ITEMS entry, add a
// stage by adding one STAGES entry (with its `unlocks`), add an alba by adding
// one ALBA_INFO entry. Other modules read these registries.

// --- Resource registry ------------------------------------------------------
// Add a new resource here; mesh (toon.js ITEM_MESH) and icon (UI.js ITEM_ICON)
// are registered in their own files keyed by the same id.
export const ITEMS = {
  acorn: { color: 0x8b5e3c, css: '#8b5e3c', label: 'Acorn', value: 6 },
  banana: { color: 0xffd23f, css: '#ffd23f', label: 'Banana', value: 9 },
  fish: { color: 0x6fc3df, css: '#6fc3df', label: 'Fish', value: 14 },
  shell: { color: 0xffb6c1, css: '#ffb6c1', label: 'Shell', value: 11 },
  flower: { color: 0xff7eb6, css: '#ff7eb6', label: 'Flower', value: 18 },
  honey: { color: 0xf2a83a, css: '#f2a83a', label: 'Honey', value: 24 },
};
export const ITEM_TYPES = Object.keys(ITEMS);
// Derived maps kept for backward-compatible imports.
export const ITEM_COLORS = Object.fromEntries(ITEM_TYPES.map((t) => [t, ITEMS[t].color]));
export const ITEM_CSS_COLORS = Object.fromEntries(ITEM_TYPES.map((t) => [t, ITEMS[t].css]));
export const ITEM_LABELS = Object.fromEntries(ITEM_TYPES.map((t) => [t, ITEMS[t].label]));
export const ITEM_VALUE = Object.fromEntries(ITEM_TYPES.map((t) => [t, ITEMS[t].value]));

// --- Stage registry ---------------------------------------------------------
// `unlocks` are feature ids the Island/Store know how to build (see Island
// FEATURE_BUILDERS). `viewW` is the camera frustum half-width (zoom) for the
// stage. To add Stage 6: append an entry and register its store/map builders.
export const STAGES = {
  1: { name: 'Wooden\nStall', shelfSlots: 2, items: ['acorn'], customers: ['squirrel'], upgradeCost: 50, unlocks: [], viewW: 9.5, viewShift: 0 },
  2: { name: 'Fabric\nTent', shelfSlots: 4, items: ['acorn', 'banana'], customers: ['squirrel', 'monkey'], upgradeCost: 300, unlocks: ['palms'], viewW: 9.5, viewShift: 0 },
  3: { name: 'Thatch\nStore', shelfSlots: 6, items: ['acorn', 'banana', 'fish', 'shell'], customers: ['squirrel', 'monkey', 'rabbit', 'cat'], upgradeCost: 1000, unlocks: ['shore'], viewW: 9.5, viewShift: 0 },
  4: { name: 'Garden\nStall', shelfSlots: 8, items: ['acorn', 'banana', 'fish', 'shell', 'flower'], customers: ['squirrel', 'monkey', 'rabbit', 'cat', 'bear'], upgradeCost: 3000, unlocks: ['island2', 'bridge', 'flowerbeds'], viewW: 14.0, viewShift: 7.0 },
  5: { name: 'Garden\nCafé', shelfSlots: 10, items: ['acorn', 'banana', 'fish', 'shell', 'flower', 'honey'], customers: ['squirrel', 'monkey', 'rabbit', 'cat', 'bear', 'fox'], upgradeCost: null, unlocks: ['fountain', 'beehives', 'stonepath', 'upperIsland', 'lowerIsland'], viewW: 15.0, viewShift: 7.5 },
};
// Highest defined stage = final tier (auto-updates when stages are added).
export const FINAL_STAGE = Math.max(...Object.keys(STAGES).map(Number));

// ====== TEST MODE ======
// Hidden local toggle. Tap the stage pill 7 times quickly to switch this on/off
// for the current browser only.
export const TEST_MODE_KEY = 'cozy-island-test-mode';
export function isTestModeEnabled() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(TEST_MODE_KEY) === '1';
  } catch (e) {
    return false;
  }
}
export function setTestModeEnabled(enabled) {
  try {
    if (enabled) localStorage.setItem(TEST_MODE_KEY, '1');
    else localStorage.removeItem(TEST_MODE_KEY);
  } catch (e) {
    /* storage unavailable — ignore */
  }
}
export const TEST_MODE = isTestModeEnabled();
export const COIN_MULTIPLIER = 1;
const SAVE_KEY = 'cozy-island-tycoon-save-v1';

// Tier of each resource = the first stage at which it appears. Used to gate
// what the harvester alba can collect by its level.
export const ITEM_TIER = {};
for (const sNum of Object.keys(STAGES).map(Number).sort((a, b) => a - b)) {
  for (const it of STAGES[sNum].items) if (ITEM_TIER[it] === undefined) ITEM_TIER[it] = sNum;
}

// --- Part-timer (alba) registry --------------------------------------------
// Clerk removed for now (no effect yet) — can be re-added later.
export const ALBA_TYPES = ['harvester', 'stocker'];
export const ALBA_INFO = {
  // Harvester: Lv1..5 unlock resource tiers 1..5; Lv6 = speed boost.
  harvester: { label: 'Harvester', kr: '수확 알바', baseCost: 120, costMul: 1.6, maxLevel: 6 },
  // Stocker: improves refill speed and late-game batch stocking.
  stocker: { label: 'Stocker', kr: '진열 알바', baseCost: 150, costMul: 1.7, maxLevel: 5 },
};

// Concurrent-customer cap for performance. Each customer is ~20 small
// low-poly meshes; with the rest of the scene, ~18 concurrent stays within a
// comfortable 60fps budget on mid-range mobile. The per-stage formula adds 2
// each stage and is clamped to this cap, so stages can grow indefinitely.
export const MAX_CUSTOMERS = 18;
export const BASE_CUSTOMERS = 3; // stage 1 concurrent customers

// --- Production facilities (Stage 5 upper/lower islands) --------------------
// Hire a worker to auto-produce one resource over time; level raises the rate.
// rate (items/sec) = base + (level-1)*perLevel. Balance values are tunable.
export const FACILITIES = {
  acornFarm: { item: 'acorn', kr: '도토리 농장', base: 0.45, perLevel: 0.25, baseCost: 800, costMul: 1.7, maxLevel: 8 },
  bananaFarm: { item: 'banana', kr: '바나나 농장', base: 0.35, perLevel: 0.22, baseCost: 1200, costMul: 1.7, maxLevel: 8 },
  fishFarm: { item: 'fish', kr: '물고기 양식장', base: 0.28, perLevel: 0.18, baseCost: 2000, costMul: 1.7, maxLevel: 8 },
  clamFarm: { item: 'shell', kr: '조개 수확장', base: 0.3, perLevel: 0.18, baseCost: 1800, costMul: 1.7, maxLevel: 8 },
  flowerGarden: { item: 'flower', kr: '꽃 정원', base: 0.22, perLevel: 0.15, baseCost: 2600, costMul: 1.7, maxLevel: 8 },
  honeyApiary: { item: 'honey', kr: '꿀 양봉장', base: 0.14, perLevel: 0.11, baseCost: 3600, costMul: 1.7, maxLevel: 8 },
};
export const FACILITY_IDS = Object.keys(FACILITIES);

export const SHELF_DISPLAY_UPGRADES = [
  { level: 1, id: 'basket', kr: '바구니 진열', stage: 4, cost: 800, desc: '같은 상품을 아기자기한 바구니로 정리해요' },
  { level: 2, id: 'crate', kr: '상자 진열', stage: 5, cost: 2500, desc: '후반 상품을 나무 상자로 깔끔하게 정리해요' },
];

export class GameState {
  constructor() {
    this.reset();
  }

  reset() {
    this.stage = 1;
    this.coins = 0;
    this.inventory = Object.fromEntries(ITEM_TYPES.map((t) => [t, 0]));
    this.shelf = [];

    this.lifetimeCoins = 0;
    this.customersServed = 0;
    this.startTime = performance.now();

    this.gameOver = false;
    this.finalSaleDone = false;

    this.alba = Object.fromEntries(ALBA_TYPES.map((t) => [t, 0]));
    this.facilities = Object.fromEntries(FACILITY_IDS.map((id) => [id, 0]));
    this.shelfDisplayLevel = 0;
  }

  get config() {
    return STAGES[this.stage];
  }
  get shelfCapacity() {
    return this.config.shelfSlots;
  }
  get availableItems() {
    return this.config.items;
  }
  get availableCustomers() {
    return this.config.customers;
  }
  get isFinalStage() {
    return this.stage >= FINAL_STAGE;
  }

  totalInventory() {
    return ITEM_TYPES.reduce((sum, t) => sum + this.inventory[t], 0);
  }
  hasEmptyShelfSlot() {
    return this.shelf.length < this.shelfCapacity;
  }
  addToInventory(type) {
    if (this.inventory[type] === undefined) return;
    this.inventory[type] += 1;
  }

  // Stock one item, balancing the shelf for VARIETY: pick the available type
  // that is currently least represented on the shelf (tie -> most inventory).
  stockOne() {
    if (!this.hasEmptyShelfSlot()) return null;
    const pool = this.availableItems.filter((t) => this.inventory[t] > 0);
    if (pool.length === 0) return null;
    const onShelf = {};
    for (const s of this.shelf) onShelf[s] = (onShelf[s] || 0) + 1;
    pool.sort((a, b) => {
      const da = onShelf[a] || 0;
      const db = onShelf[b] || 0;
      if (da !== db) return da - db; // fewer on shelf first
      return this.inventory[b] - this.inventory[a];
    });
    const type = pool[0];
    this.inventory[type] -= 1;
    this.shelf.push(type);
    return type;
  }

  sell(type) {
    const idx = this.shelf.indexOf(type);
    if (idx === -1) return false;
    this.shelf.splice(idx, 1);
    let value = (ITEM_VALUE[type] || 5) * COIN_MULTIPLIER;
    value = Math.round(value * (1 + this.clerkBonus()));
    this.coins += value;
    this.lifetimeCoins += value;
    this.customersServed += 1;
    return value;
  }

  randomDesiredItem() {
    const items = this.availableItems;
    return items[Math.floor(Math.random() * items.length)];
  }

  // How many items this customer will try to buy: 1 .. (number of item types).
  // Higher stages make "big buyers" more likely (the +1 chance grows).
  customerBuyCount() {
    const maxN = this.availableItems.length;
    const p = Math.min(0.85, 0.15 + (this.stage - 1) * 0.12); // chance to add one more
    let count = 1;
    while (count < maxN && Math.random() < p) count++;
    return count;
  }

  // A shopping list of item types (length = customerBuyCount).
  makeShoppingList() {
    const n = this.customerBuyCount();
    const list = [];
    for (let i = 0; i < n; i++) list.push(this.randomDesiredItem());
    return list;
  }

  canUpgrade() {
    const cost = this.config.upgradeCost;
    return cost !== null && this.coins >= cost;
  }
  upgrade() {
    const cost = this.config.upgradeCost;
    if (cost === null || this.coins < cost) return false;
    this.coins -= cost;
    this.stage += 1;
    return true;
  }

  // --- Alba helpers ---------------------------------------------------------
  albaLevel(type) {
    return this.alba[type] || 0;
  }
  albaCost(type) {
    const info = ALBA_INFO[type];
    const lvl = this.albaLevel(type);
    if (lvl >= info.maxLevel) return null;
    return Math.round(info.baseCost * Math.pow(info.costMul, lvl));
  }
  canHireAlba(type) {
    const cost = this.albaCost(type);
    return cost !== null && this.coins >= cost;
  }
  hireAlba(type) {
    const cost = this.albaCost(type);
    if (cost === null || this.coins < cost) return false;
    this.coins -= cost;
    this.alba[type] += 1;
    return true;
  }
  harvesterPeriod() {
    const lvl = this.albaLevel('harvester');
    if (lvl <= 0) return null;
    return lvl >= 6 ? 2.0 : 4.0; // Lv6 is the speed upgrade
  }
  // Highest resource tier the harvester may collect (Lv1->tier1 ... Lv5+->all).
  harvesterMaxTier() {
    return Math.min(this.albaLevel('harvester'), FINAL_STAGE);
  }
  stockerPeriod() {
    const lvl = this.albaLevel('stocker');
    if (lvl <= 0) return null;
    return [null, 1.5, 1.2, 0.9, 0.9, 0.75][lvl] || 0.75;
  }
  stockerBatchSize() {
    const lvl = this.albaLevel('stocker');
    if (lvl <= 0) return 0;
    if (lvl >= 5) return 3;
    if (lvl >= 4) return 2;
    return 1;
  }
  stockCounts() {
    const out = Object.fromEntries(ITEM_TYPES.map((t) => [t, 0]));
    for (const type of this.shelf) if (out[type] !== undefined) out[type] += 1;
    return out;
  }
  shelfDisplayMode() {
    if (this.shelfDisplayLevel >= 2) return 'crate';
    if (this.shelfDisplayLevel >= 1) return 'basket';
    return 'single';
  }
  nextShelfDisplayUpgrade() {
    return SHELF_DISPLAY_UPGRADES.find((u) => u.level === this.shelfDisplayLevel + 1) || null;
  }
  canBuyShelfDisplayUpgrade() {
    const up = this.nextShelfDisplayUpgrade();
    return !!up && this.stage >= up.stage && this.coins >= up.cost;
  }
  buyShelfDisplayUpgrade() {
    const up = this.nextShelfDisplayUpgrade();
    if (!up || this.stage < up.stage || this.coins < up.cost) return false;
    this.coins -= up.cost;
    this.shelfDisplayLevel = up.level;
    return true;
  }
  clerkSpawnFactor() {
    return Math.max(0.45, 1 - this.albaLevel('clerk') * 0.12);
  }
  clerkBonus() {
    return this.albaLevel('clerk') * 0.12;
  }

  // --- Customer flow scaling (income grows with stage) ----------------------
  // +2 concurrent customers per stage, capped for performance.
  maxCustomers() {
    return Math.min(MAX_CUSTOMERS, BASE_CUSTOMERS + (this.stage - 1) * 2);
  }
  // Arrivals get faster each stage so the extra slots actually fill up.
  customerSpawnInterval() {
    const base = Math.max(1.6, 7 / (1 + (this.stage - 1) * 0.4));
    return base * this.clerkSpawnFactor();
  }

  // --- Production facilities -------------------------------------------------
  facilityLevel(id) {
    return this.facilities[id] || 0;
  }
  facilityCost(id) {
    const f = FACILITIES[id];
    const lv = this.facilityLevel(id);
    if (lv >= f.maxLevel) return null;
    return Math.round(f.baseCost * Math.pow(f.costMul, lv));
  }
  canHireFacility(id) {
    const c = this.facilityCost(id);
    return c !== null && this.coins >= c;
  }
  hireFacility(id) {
    const c = this.facilityCost(id);
    if (c === null || this.coins < c) return false;
    this.coins -= c;
    this.facilities[id] += 1;
    return true;
  }
  facilityRate(id) {
    const f = FACILITIES[id];
    const lv = this.facilityLevel(id);
    return lv <= 0 ? 0 : f.base + (lv - 1) * f.perLevel;
  }

  // --- Save / load (localStorage) ------------------------------------------
  save() {
    try {
      const data = {
        v: 1,
        stage: this.stage,
        coins: this.coins,
        inventory: this.inventory,
        shelf: this.shelf,
        lifetimeCoins: this.lifetimeCoins,
        customersServed: this.customersServed,
        elapsed: this.elapsedSeconds(),
        finalSaleDone: false,
        alba: this.alba,
        facilities: this.facilities,
        shelfDisplayLevel: this.shelfDisplayLevel,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      /* storage unavailable — ignore */
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || d.v !== 1) return false;
      this.stage = Math.min(Math.max(1, d.stage || 1), FINAL_STAGE);
      this.coins = d.coins || 0;
      this.inventory = Object.assign(Object.fromEntries(ITEM_TYPES.map((t) => [t, 0])), d.inventory || {});
      this.shelf = Array.isArray(d.shelf)
        ? d.shelf.filter((t) => this.availableItems.includes(t)).slice(0, this.shelfCapacity)
        : [];
      this.lifetimeCoins = d.lifetimeCoins || 0;
      this.customersServed = d.customersServed || 0;
      this.finalSaleDone = false;
      this.alba = Object.assign(Object.fromEntries(ALBA_TYPES.map((t) => [t, 0])), d.alba || {});
      this.facilities = Object.assign(Object.fromEntries(FACILITY_IDS.map((id) => [id, 0])), d.facilities || {});
      this.shelfDisplayLevel = Math.min(2, Math.max(0, d.shelfDisplayLevel || 0));
      this.startTime = performance.now() - (d.elapsed || 0) * 1000;
      return true;
    } catch (e) {
      return false;
    }
  }

  clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  elapsedSeconds() {
    return (performance.now() - this.startTime) / 1000;
  }
  elapsedString() {
    const s = Math.floor(this.elapsedSeconds());
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }
}

export const gameState = new GameState();
