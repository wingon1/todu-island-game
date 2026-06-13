// UI.js — top HUD (coins + inventory as item icons), bottom button panel,
// and the victory overlay. Pure DOM; reads from GameState.
import { gameState, ALBA_TYPES, ALBA_INFO, TEST_MODE } from './GameState.js';

// --- Recognizable 2D item icons (match the 3D models) ----------------------
export function coinIconSVG() {
  return `<svg class="hud-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="ic_coin" cx="40%" cy="33%" r="72%">
      <stop offset="0%" stop-color="#fff7c8"/><stop offset="55%" stop-color="#ffd24a"/><stop offset="100%" stop-color="#dca200"/>
    </radialGradient></defs>
    <circle cx="16" cy="16" r="13" fill="url(#ic_coin)" stroke="#b87f00" stroke-width="2"/>
    <circle cx="16" cy="16" r="9.2" fill="none" stroke="#c79b08" stroke-width="1.3" opacity="0.8"/>
    <text x="16" y="21.3" text-anchor="middle" font-size="14" font-weight="900" fill="#9c6b00" font-family="sans-serif">$</text>
    <ellipse cx="11.6" cy="11" rx="3.4" ry="2.1" fill="#ffffff" opacity="0.55"/>
  </svg>`;
}

// Registry of icon builders — add a resource's HUD icon by registering here.
export const ITEM_ICON = {
  acorn: () => acornIconSVG(),
  banana: () => bananaIconSVG(),
  fish: () => fishIconSVG(),
  shell: () => shellIconSVG(),
  flower: () => flowerIconSVG(),
  honey: () => honeyIconSVG(),
};

export function itemIconSVG(type) {
  const fn = ITEM_ICON[type] || ITEM_ICON.acorn;
  return fn();
}

function flowerIconSVG() {
  return `<svg class="hud-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <rect x="15" y="16" width="2" height="13" rx="1" fill="#4fae5a"/>
    <path d="M16 22 C12 21 10 24 11 26 C14 26 16 24 16 22 Z" fill="#5fc56a"/>
    <g fill="#ff7eb6">
      <ellipse cx="16" cy="7" rx="3.4" ry="4.6"/><ellipse cx="16" cy="17" rx="3.4" ry="4.6"/>
      <ellipse cx="11" cy="12" rx="4.6" ry="3.4"/><ellipse cx="21" cy="12" rx="4.6" ry="3.4"/>
      <ellipse cx="12.4" cy="8.4" rx="3.6" ry="3.6"/><ellipse cx="19.6" cy="8.4" rx="3.6" ry="3.6"/>
      <ellipse cx="12.4" cy="15.6" rx="3.6" ry="3.6"/><ellipse cx="19.6" cy="15.6" rx="3.6" ry="3.6"/>
    </g>
    <circle cx="16" cy="12" r="3.4" fill="#ffe14a" stroke="#f0c020" stroke-width="0.8"/>
  </svg>`;
}

function honeyIconSVG() {
  return `<svg class="hud-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="ic_ho" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffce6e"/><stop offset="1" stop-color="#ef9c25"/></linearGradient></defs>
    <rect x="7" y="11" width="18" height="17" rx="3" fill="url(#ic_ho)" stroke="#cf8420" stroke-width="1"/>
    <rect x="6" y="7.5" width="20" height="5" rx="2" fill="#b9742a"/>
    <rect x="10.5" y="14" width="11" height="9" rx="1.5" fill="#fff3d6" opacity="0.85"/>
    <text x="16" y="21.5" text-anchor="middle" font-size="6.5" font-weight="800" fill="#cf8420" font-family="sans-serif">HONEY</text>
  </svg>`;
}

function acornIconSVG() {
  return `<svg class="hud-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="ic_acB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ecc48d"/><stop offset="1" stop-color="#c1894a"/></linearGradient>
      <linearGradient id="ic_acC" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8c5c2e"/><stop offset="1" stop-color="#5c3816"/></linearGradient>
    </defs>
    <path d="M16 31 C9.4 31 8 22.6 9 16.4 L23 16.4 C24 22.6 22.6 31 16 31 Z" fill="url(#ic_acB)" stroke="#a8783f" stroke-width="0.8"/>
    <ellipse cx="12.6" cy="21" rx="2.2" ry="4.4" fill="#ffffff" opacity="0.2"/>
    <path d="M6.8 13.4 C6.8 8.3 25.2 8.3 25.2 13.4 C25.2 16.6 19.6 17.3 16 17.3 C12.4 17.3 6.8 16.6 6.8 13.4 Z" fill="url(#ic_acC)" stroke="#4c2f14" stroke-width="0.6"/>
    <g fill="#6e4520"><circle cx="11" cy="13.2" r="0.7"/><circle cx="14" cy="14.4" r="0.7"/><circle cx="18" cy="14.4" r="0.7"/><circle cx="21" cy="13.2" r="0.7"/><circle cx="13" cy="11.6" r="0.6"/><circle cx="19" cy="11.6" r="0.6"/></g>
    <rect x="14.8" y="3.6" width="2.4" height="5.4" rx="1.2" fill="#4a3018"/>
  </svg>`;
}

function bananaIconSVG() {
  return `<svg class="hud-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="ic_ba" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#ffe781"/><stop offset="1" stop-color="#f1bb1c"/></linearGradient></defs>
    <path d="M6.5 6 C8.5 19 14 25.6 26.6 26.6 C29.2 26.8 29.2 23.2 26.8 22.5 C16.6 20.9 12.6 15.4 11.4 6.4 C10.9 3.4 7.5 3.1 6.5 6 Z" fill="url(#ic_ba)" stroke="#d6a000" stroke-width="1.2"/>
    <path d="M9 8.4 C11 18 16 23 24.6 24.6" fill="none" stroke="#fff4b4" stroke-width="1.2" opacity="0.75"/>
    <circle cx="26.6" cy="24.4" r="1.9" fill="#7a5a1c"/>
    <circle cx="7.3" cy="6.2" r="1.7" fill="#5e3f12"/>
  </svg>`;
}

function fishIconSVG() {
  return `<svg class="hud-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="ic_fi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#93d2ef"/><stop offset="1" stop-color="#4aa0cf"/></linearGradient></defs>
    <path d="M21 16 L31 9.8 C29.8 14 29.8 18 31 22.2 Z" fill="#4aa0cf"/>
    <path d="M11.5 9.6 Q15 5.6 18.5 9.8" fill="#69bce4"/>
    <ellipse cx="13" cy="16" rx="11" ry="6.7" fill="url(#ic_fi)" stroke="#3a8fc2" stroke-width="0.8"/>
    <path d="M14 9.8 C16 12 16 20 14 22.2" fill="none" stroke="#bce6f7" stroke-width="1" opacity="0.6"/>
    <circle cx="8.2" cy="14.6" r="2.2" fill="#ffffff"/>
    <circle cx="7.8" cy="14.6" r="1.15" fill="#232323"/>
  </svg>`;
}

function shellIconSVG() {
  return `<svg class="hud-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="ic_sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffdbe2"/><stop offset="1" stop-color="#ff9fb2"/></linearGradient></defs>
    <path d="M16 5 C7 5 3.6 15.5 4 26 L28 26 C28.4 15.5 25 5 16 5 Z" fill="url(#ic_sh)" stroke="#ef8499" stroke-width="1"/>
    <g stroke="#f08aa0" stroke-width="1.1" fill="none" opacity="0.85">
      <path d="M16 7 L16 26"/><path d="M16 7 L9 25"/><path d="M16 7 L23 25"/><path d="M16 7 L5.6 23"/><path d="M16 7 L26.4 23"/>
    </g>
    <ellipse cx="16" cy="7.4" rx="3" ry="2" fill="#ffc2cd"/>
  </svg>`;
}

const HARVESTER_UNLOCK_TEXT = {
  1: '도토리',
  2: '바나나',
  3: '해변',
  4: '꽃',
  5: '꿀',
  6: '속도↑',
};

function albaButtonText(type, level, cost) {
  const maxLevel = ALBA_INFO[type]?.maxLevel ?? level;
  if (cost === null || level >= maxLevel) return `Lv${level} · MAX`;
  const next = level + 1;
  if (type === 'harvester') return `Lv${next} ${HARVESTER_UNLOCK_TEXT[next] || '강화'} · ${cost}`;
  if (type === 'stocker') return `자동진열 · ${cost}`;
  return `Lv${next} · ${cost}`;
}

export class UI {
  constructor({ onUpgrade, onStock, onReplay, onStart, onHire, onTestMoney, audio }) {
    this.audio = audio;
    this.onUpgrade = onUpgrade;
    this.onStock = onStock;
    this.onReplay = onReplay;
    this.onStart = onStart;
    this.onHire = onHire;
    this.onTestMoney = onTestMoney;

    this.coinValueEl = document.getElementById('coin-value');
    const coinIcon = document.getElementById('coin-icon');
    if (coinIcon) coinIcon.innerHTML = coinIconSVG();
    this.stagePillEl = document.getElementById('stage-pill');
    this.invGridEl = document.getElementById('inventory-grid');
    this.upgradeBtn = document.getElementById('upgrade-btn');
    this.upgradeCostEl = document.getElementById('upgrade-cost');
    this.stockBtn = document.getElementById('stock-btn');

    this.victoryEl = document.getElementById('victory');
    this.vCoins = document.getElementById('v-coins');
    this.vCustomers = document.getElementById('v-customers');
    this.vTime = document.getElementById('v-time');
    this.replayBtn = document.getElementById('replay-btn');

    this.startGate = document.getElementById('start-gate');
    this.startBtn = document.getElementById('start-btn');

    this._chipEls = {};
    this._lastCoins = -1;
    this._lastInv = {};

    this._bindButton(this.upgradeBtn, () => {
      this.audio?.uiTap();
      this.onUpgrade();
    });
    this._bindButton(this.stockBtn, () => {
      this.audio?.uiTap();
      this.onStock();
    });
    this._bindButton(this.replayBtn, () => {
      this.audio?.uiTap();
      this.hideVictory();
      this.onReplay();
    });
    this._bindButton(this.startBtn, () => {
      this.onStart();
      this.startGate.style.display = 'none';
    });

    // Test-only: top up coins to reach the next stage quickly.
    const testBtn = document.getElementById('test-money');
    if (testBtn) {
      if (!TEST_MODE) {
        testBtn.style.display = 'none'; // hidden when test mode is off
        const row = testBtn.closest('.panel-top');
        if (row) row.style.display = 'none';
      } else {
        const row = testBtn.closest('.panel-top');
        if (row) row.style.display = 'flex';
        this._bindButton(testBtn, () => {
          this.audio?.uiTap();
          this.onTestMoney && this.onTestMoney();
        });
      }
    }

    // Alba hire buttons (data-driven from ALBA_TYPES).
    this.hireEls = {};
    for (const type of ALBA_TYPES) {
      const btn = document.getElementById(`hire-${type}`);
      const cost = document.getElementById(`cost-${type}`);
      if (!btn) continue;
      this.hireEls[type] = { btn, cost };
      this._bindButton(btn, () => {
        this.audio?.uiTap();
        this.onHire && this.onHire(type);
      });
    }

    this._buildInventoryChips();
  }

  // Support both touch and mouse for desktop debugging.
  _bindButton(el, handler) {
    let touched = false;
    el.addEventListener(
      'touchstart',
      (e) => {
        touched = true;
      },
      { passive: true }
    );
    el.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (el.disabled) return;
      handler();
    });
    el.addEventListener('mouseup', (e) => {
      if (touched) {
        touched = false;
        return;
      }
      if (el.disabled) return;
      handler();
    });
  }

  _buildInventoryChips() {
    this.invGridEl.innerHTML = '';
    this._chipEls = {};
  }

  _ensureChip(type) {
    if (this._chipEls[type]) return this._chipEls[type];
    const chip = document.createElement('div');
    chip.className = 'hud-item';
    const icon = document.createElement('span');
    icon.innerHTML = itemIconSVG(type);
    const count = document.createElement('span');
    count.textContent = '0';
    chip.appendChild(icon);
    chip.appendChild(count);
    this.invGridEl.appendChild(chip);
    this._chipEls[type] = { chip, count };
    return this._chipEls[type];
  }

  bumpChip(type) {
    const c = this._chipEls[type];
    if (!c) return;
    c.chip.classList.add('bump');
    setTimeout(() => c.chip.classList.remove('bump'), 130);
  }

  // Called every frame (cheap; guarded against redundant DOM writes).
  update() {
    if (gameState.coins !== this._lastCoins) {
      this.coinValueEl.textContent = String(gameState.coins);
      this._lastCoins = gameState.coins;
    }

    // Inventory chips — show only item types available this stage.
    for (const type of gameState.availableItems) {
      const { count } = this._ensureChip(type);
      const v = gameState.inventory[type];
      if (this._lastInv[type] !== v) {
        count.textContent = String(v);
        this._lastInv[type] = v;
      }
    }

    // Stage pill.
    const pillText = gameState.config.name.replace('\n', '<br/>');
    if (this.stagePillEl.dataset.txt !== pillText) {
      this.stagePillEl.innerHTML = pillText;
      this.stagePillEl.dataset.txt = pillText;
    }

    // Upgrade button.
    const cost = gameState.config.upgradeCost;
    if (cost === null) {
      this.upgradeBtn.disabled = true;
      this.upgradeBtn.classList.remove('affordable');
      this.upgradeCostEl.textContent = 'Max tier!';
      this.upgradeBtn.firstChild.textContent = 'MAX STORE ';
    } else {
      this.upgradeCostEl.textContent = `${cost} coins`;
      this.upgradeBtn.firstChild.textContent = 'UPGRADE STORE ';
      const can = gameState.canUpgrade();
      this.upgradeBtn.disabled = !can;
      this.upgradeBtn.classList.toggle('affordable', can);
    }

    // Stock button: show only when inventory has sellable items & a free slot.
    const hasStockable =
      gameState.hasEmptyShelfSlot() &&
      gameState.availableItems.some((t) => gameState.inventory[t] > 0);
    this.stockBtn.disabled = !hasStockable;
    this.stockBtn.style.display = hasStockable ? '' : 'none';

    // Alba hire buttons: show level + next cost / MAX, highlight when affordable.
    for (const type of ALBA_TYPES) {
      const el = this.hireEls[type];
      if (!el) continue;
      const lvl = gameState.albaLevel(type);
      const cst = gameState.albaCost(type);
      el.cost.textContent = albaButtonText(type, lvl, cst);
      if (cst === null) {
        el.btn.disabled = true;
        el.btn.classList.remove('afford');
      } else {
        const can = gameState.canHireAlba(type);
        el.btn.disabled = !can;
        el.btn.classList.toggle('afford', can);
      }
    }
  }

  showVictory() {
    this.vCoins.textContent = String(gameState.lifetimeCoins);
    this.vCustomers.textContent = String(gameState.customersServed);
    this.vTime.textContent = gameState.elapsedString();
    this.victoryEl.classList.add('show');
  }

  hideVictory() {
    this.victoryEl.classList.remove('show');
  }
}
