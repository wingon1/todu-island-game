// Particles.js — object pools for cloud puffs, bouncing coins, and floating
// "+N" labels. Pooling avoids GC stutter on a 60fps mobile target.
import * as THREE from 'three';
import { gameState, ITEM_VALUE } from './GameState.js';

const POOL = { coins: 20, particles: 50 };

export class Particles {
  constructor(scene, camera, canvas, labelLayer, audio) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.labelLayer = labelLayer;
    this.audio = audio;

    this.puffs = [];
    this.coins = [];
    this.labels = [];

    this._initPuffs();
    this._initCoins();
    this._initLabels();

    // Single aggregated income label: sums sales that land close together so
    // the "+coins" text doesn't stack/overlap.
    this._incomeEl = document.createElement('div');
    this._incomeEl.className = 'coin-label';
    this._incomeEl.style.fontSize = '24px';
    this._incomeEl.style.opacity = '0';
    this.labelLayer.appendChild(this._incomeEl);
    this._income = { sum: 0, hold: 0, t: 0, x: 0, y: 0, active: false };

    this._tmpVec = new THREE.Vector3();
  }

  // Add a coin amount to the running income label (re-anchored to worldPos).
  addIncome(value, worldPos) {
    const s = this._project(worldPos);
    this._income.sum += value;
    this._income.x = s.x;
    this._income.y = s.y;
    this._income.hold = 0.55; // window to keep summing before it floats off
    this._income.t = 0;
    this._income.active = true;
    this._incomeEl.textContent = `+${this._income.sum}`;
    this._incomeEl.style.left = `${s.x}px`;
    this._incomeEl.style.top = `${s.y}px`;
    this._incomeEl.style.transform = 'translate(-50%, -50%)';
    this._incomeEl.style.opacity = '1';
  }

  // --- Cloud puffs (upgrade VFX) ----------------------------------------
  _initPuffs() {
    const geo = new THREE.SphereGeometry(0.22, 8, 6);
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    for (let i = 0; i < POOL.particles; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false;
      m.castShadow = false;
      m.renderOrder = 5;
      this.scene.add(m);
      this.puffs.push({ mesh: m, active: false, life: 0, vel: new THREE.Vector3() });
    }
  }

  burstPuff(position, count = 12, color = 0xffffff) {
    let spawned = 0;
    for (const p of this.puffs) {
      if (spawned >= count) break;
      if (p.active) continue;
      p.active = true;
      p.life = 0;
      p.mesh.visible = true;
      p.mesh.position.copy(position);
      p.mesh.scale.setScalar(0.4 + Math.random() * 0.3);
      p.mesh.material.color.setHex(color);
      p.mesh.material.opacity = 0.95;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.1 + Math.random() * 1.3;
      p.vel.set(Math.cos(angle) * speed, 0.6 + Math.random() * 1.4, Math.sin(angle) * speed);
      spawned++;
    }
  }

  // --- Coins (bounce then auto-collect) ---------------------------------
  _initCoins() {
    const geo = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      metalness: 0.4,
      roughness: 0.35,
      emissive: 0x6b5300,
      emissiveIntensity: 0.25,
      flatShading: true,
    });
    for (let i = 0; i < POOL.coins; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = Math.PI / 2;
      m.visible = false;
      m.castShadow = true;
      m.renderOrder = 4;
      this.scene.add(m);
      this.coins.push({
        mesh: m,
        active: false,
        phase: 'idle',
        t: 0,
        start: new THREE.Vector3(),
        peak: 0,
        value: 0,
      });
    }
  }

  spawnCoin(position, value = 5) {
    for (const c of this.coins) {
      if (c.active) continue;
      c.active = true;
      c.phase = 'bounce';
      c.t = 0;
      c.value = value;
      c.start.copy(position);
      c.mesh.position.copy(position);
      c.mesh.visible = true;
      c.mesh.scale.setScalar(1);
      if (this.audio) this.audio.coinRegister();
      return;
    }
  }

  // --- Floating "+N" labels (DOM divs over the canvas) ------------------
  _initLabels() {
    for (let i = 0; i < POOL.coins + 6; i++) {
      const el = document.createElement('div');
      el.className = 'coin-label';
      el.style.opacity = '0';
      this.labelLayer.appendChild(el);
      this.labels.push({ el, active: false, t: 0, x: 0, y: 0 });
    }
  }

  // Spawn a floating label at a screen position derived from a world position.
  spawnLabel(worldPos, text, color = '#ffd700') {
    const screen = this._project(worldPos);
    for (const l of this.labels) {
      if (l.active) continue;
      l.active = true;
      l.t = 0;
      l.x = screen.x;
      l.y = screen.y;
      l.el.textContent = text;
      l.el.style.color = color;
      l.el.style.left = `${screen.x}px`;
      l.el.style.top = `${screen.y}px`;
      l.el.style.opacity = '1';
      return;
    }
  }

  // Project a world position to label-layer pixel coords.
  _project(worldPos) {
    this._tmpVec.copy(worldPos).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((this._tmpVec.x + 1) / 2) * rect.width,
      y: ((-this._tmpVec.y + 1) / 2) * rect.height,
    };
  }

  // Public helper: world -> screen for other systems (e.g., harvest flight).
  worldToScreen(worldPos) {
    return this._project(worldPos);
  }

  // --- Per-frame update --------------------------------------------------
  update(dt, onCoinCollected) {
    // Puffs.
    for (const p of this.puffs) {
      if (!p.active) continue;
      p.life += dt;
      const k = p.life / 0.5;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.y -= 1.5 * dt;
      p.mesh.scale.addScalar(dt * 1.6);
      p.mesh.material.opacity = Math.max(0, 0.95 * (1 - k));
      if (k >= 1) {
        p.active = false;
        p.mesh.visible = false;
      }
    }

    // Coins.
    for (const c of this.coins) {
      if (!c.active) continue;
      c.mesh.rotation.y += 3 * dt;
      if (c.phase === 'bounce') {
        c.t += dt;
        const dur = 0.5;
        const k = Math.min(1, c.t / dur);
        // Parabolic single bounce.
        const h = 4 * 0.7 * k * (1 - k); // peak ~0.7 units
        c.mesh.position.y = c.start.y + h + 0.1;
        if (k >= 1) {
          c.phase = 'collect';
          c.t = 0;
          c.collectStart = c.mesh.position.clone();
        }
      } else if (c.phase === 'collect') {
        c.t += dt;
        const dur = 0.45;
        const k = Math.min(1, c.t / dur);
        // Arc up toward the coin counter (top-ish of viewport center-left).
        const target = this._coinTargetWorld();
        c.mesh.position.lerpVectors(c.collectStart, target, k);
        c.mesh.position.y += Math.sin(k * Math.PI) * 0.8;
        c.mesh.scale.setScalar(1 - 0.6 * k);
        if (k >= 1) {
          c.active = false;
          c.mesh.visible = false;
          c.mesh.scale.setScalar(1);
          if (onCoinCollected) onCoinCollected(c.value);
          // Add to the single aggregated income label (instead of stacking).
          this.addIncome(c.value, c.collectStart);
        }
      }
    }

    // Labels.
    for (const l of this.labels) {
      if (!l.active) continue;
      l.t += dt;
      const k = Math.min(1, l.t / 1.0);
      l.el.style.transform = `translate(-50%, -50%) translateY(${-60 * k}px)`;
      l.el.style.opacity = String(1 - k);
      if (k >= 1) {
        l.active = false;
        l.el.style.opacity = '0';
      }
    }

    // Aggregated income label: hold (keep summing) then float up & fade.
    if (this._income.active) {
      if (this._income.hold > 0) {
        this._income.hold -= dt;
      } else {
        this._income.t += dt;
        const k = Math.min(1, this._income.t / 0.9);
        this._incomeEl.style.transform = `translate(-50%, -50%) translateY(${-60 * k}px)`;
        this._incomeEl.style.opacity = String(1 - k);
        if (k >= 1) {
          this._income.active = false;
          this._income.sum = 0;
          this._incomeEl.style.opacity = '0';
        }
      }
    }
  }

  // A world-space point that, when projected, lands near the coin counter.
  _coinTargetWorld() {
    // Just push coins toward the bottom-front of the island where they fade.
    if (!this._coinTarget) this._coinTarget = new THREE.Vector3(-2.4, 1.6, 2.6);
    return this._coinTarget;
  }

  resetAll() {
    for (const p of this.puffs) {
      p.active = false;
      p.mesh.visible = false;
    }
    for (const c of this.coins) {
      c.active = false;
      c.mesh.visible = false;
    }
    for (const l of this.labels) {
      l.active = false;
      l.el.style.opacity = '0';
    }
    this._income.active = false;
    this._income.sum = 0;
    this._incomeEl.style.opacity = '0';
  }
}
