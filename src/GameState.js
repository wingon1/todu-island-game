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
  2: { name: 'Fabric\nTent', shelfSlots: 4, items: ['acorn', 'banana'], customers: ['squirrel', 'monkey'], upgradeCost: 200, unlocks: ['palms'], viewW: 9.5, viewShift: 0 },
  3: { name: 'Thatch\nStore', shelfSlots: 6, items: ['acorn', 'banana', 'fish', 'shell'], customers: ['squirrel', 'monkey', 'rabbit', 'cat'], upgradeCost: 600, unlocks: ['shore'], viewW: 9.5, viewShift: 0 },
  4: { name: 'Garden\nStall', shelfSlots: 8, items: ['acorn', 'banana', 'fish', 'shell', 'flower'], customers: ['squirrel', 'monkey', 'rabbit', 'cat', 'bear'], upgradeCost: 1500, unlocks: ['island2', 'bridge', 'flowerbeds'], viewW: 14.0, viewShift: 7.0 },
  5: { name: 'Garden\nCafé', shelfSlots: 10, items: ['acorn', 'banana', 'fish', 'shell', 'flower', 'honey'], customers: ['squirrel', 'monkey', 'rabbit', 'cat', 'bear', 'fox'], upgradeCost: null, unlocks: ['fountain', 'beehives', 'stonepath'], viewW: 15.0, viewShift: 7.5 },
};
// Highest defined stage = final tier (auto-updates when stages are added).
export const FINAL_STAGE = Math.max(...Object.keys(STAGES).map(Number));
// The resource whose first sale at the final stage wins the game.
export const FINAL_ITEM = 'honey';

// ====== TEST MODE ======
// Flip this ONE flag: true = ×5 coins + "TEST +$" button shown;
// false = normal balance (×1) + the test button is hidden. Ship with false.
export const TEST_MODE = false;
export const COIN_MULTIPLIER = TEST_MODE ? 5 : 1;
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
  // Stocker: single level; auto-stocks the shelf with an even variety.
  stocker: { label: 'Stocker', kr: '진열 알바', baseCost: 150, costMul: 1.7, maxLevel: 1 },
};

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
    if (this.stage >= FINAL_STAGE && type === FINAL_ITEM && !this.finalSaleDone) {
      this.finalSaleDone = true;
    }
    return value;
  }

  randomDesiredItem() {
    const items = this.availableItems;
    return items[Math.floor(Math.random() * items.length)];
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
    return this.albaLevel('stocker') <= 0 ? null : 1.5;
  }
  clerkSpawnFactor() {
    return Math.max(0.45, 1 - this.albaLevel('clerk') * 0.12);
  }
  clerkBonus() {
    return this.albaLevel('clerk') * 0.12;
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
        finalSaleDone: this.finalSaleDone,
        alba: this.alba,
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
      this.finalSaleDone = !!d.finalSaleDone;
      this.alba = Object.assign(Object.fromEntries(ALBA_TYPES.map((t) => [t, 0])), d.alba || {});
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
