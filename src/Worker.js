// Worker.js — hired part-timers (alba), shown as detailed cat workers.
//  • Harvester: a yellow cat in a straw hat + apron. Level gates which resource
//    tiers it collects (Lv1->tier1 ... Lv5->all); Lv6 = faster.
//  • Stocker: a grey cat in a red cap + apron. Auto-stocks an even variety.
// Extensible: add a role to ROLE_DEFS + GameState ALBA_INFO and wire it below.
import * as THREE from 'three';
import { toonMat } from './toon.js';
import { gameState, ITEM_TIER } from './GameState.js';

const ROLE_DEFS = {
  harvester: { body: 0xf2c94c, belly: 0xfff1c0, hat: 'straw', hatColor: 0xd9b25a, apron: 0xfff6e0 },
  stocker: { body: 0xb8b0a8, belly: 0xeeeae3, hat: 'cap', hatColor: 0xd6433a, apron: 0xf3f0ea },
};

export class WorkerManager {
  constructor(scene, island, store, particles, audio, callbacks) {
    this.scene = scene;
    this.island = island;
    this.store = store;
    this.particles = particles;
    this.audio = audio;
    this.callbacks = callbacks; // { onHarvest(type,worldPos), onStock() }
    this.workers = {};
    this._tmp = new THREE.Vector3();
  }

  _makeWorker(role) {
    const def = ROLE_DEFS[role];
    const g = new THREE.Group();
    const bodyMat = toonMat(def.body, { flatShading: true });
    const bellyMat = toonMat(def.belly, { flatShading: true });
    const darkMat = toonMat(0x4a3a2a, { flatShading: true });

    // Torso + belly.
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 9), bodyMat);
    body.scale.set(1, 1.15, 0.95);
    body.position.y = 0.34;
    body.castShadow = true;
    g.add(body);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), bellyMat);
    belly.scale.set(1, 1.1, 0.7);
    belly.position.set(0, 0.32, 0.18);
    g.add(belly);

    // Head.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 9), bodyMat);
    head.position.set(0, 0.75, 0.05);
    head.castShadow = true;
    g.add(head);
    // Cat ears (cones).
    for (const ex of [-0.13, 0.13]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.16, 5), bodyMat);
      ear.position.set(ex, 0.96, 0.04);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 5), toonMat(0xffc7d0, { flatShading: true }));
      inner.position.set(ex, 0.95, 0.07);
      g.add(ear, inner);
    }
    // Eyes with highlight + nose + whiskers.
    for (const ex of [-0.09, 0.09]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0x2a221c }));
      eye.position.set(ex, 0.78, 0.25);
      g.add(eye);
      const hi = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      hi.position.set(ex + 0.012, 0.795, 0.275);
      g.add(hi);
    }
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), bellyMat);
    snout.scale.set(1.2, 0.8, 0.9);
    snout.position.set(0, 0.71, 0.27);
    g.add(snout);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), toonMat(0xe07a8a, { flatShading: true }));
    nose.position.set(0, 0.72, 0.33);
    g.add(nose);

    // Tail — one long tapered tail that sweeps up and back.
    const tailLen = 0.62;
    const tailRot = -0.6;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.09, tailLen, 8), bodyMat);
    tail.position.set(0, 0.48, -0.32);
    tail.rotation.x = tailRot;
    tail.castShadow = true;
    g.add(tail);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), bellyMat);
    tip.position.set(0, 0.48 + Math.cos(tailRot) * (tailLen / 2), -0.32 + Math.sin(tailRot) * (tailLen / 2));
    g.add(tip);

    // Apron — thin, on the FRONT only (a small bib + skirt), no rear band.
    const apronMat = toonMat(def.apron, { flatShading: true });
    const bib = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.03), apronMat);
    bib.position.set(0, 0.46, 0.255);
    g.add(bib);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.03), apronMat);
    skirt.position.set(0, 0.28, 0.265);
    g.add(skirt);
    // Thin shoulder straps.
    for (const ex of [-0.09, 0.09]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.03), apronMat);
      strap.position.set(ex, 0.55, 0.22);
      strap.rotation.x = -0.22;
      g.add(strap);
    }
    // Small pocket line.
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.02), toonMat(0xcdbfa6, { flatShading: true }));
    pocket.position.set(0, 0.24, 0.285);
    g.add(pocket);

    // Hat.
    const hatMat = toonMat(def.hatColor, { flatShading: true });
    if (def.hat === 'cap') {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hatMat);
      dome.position.set(0, 0.9, 0.04);
      dome.castShadow = true;
      g.add(dome);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.2), hatMat);
      brim.position.set(0, 0.89, 0.24);
      g.add(brim);
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), hatMat);
      btn.position.set(0, 1.06, 0.04);
      g.add(btn);
    } else {
      // straw hat: wide flat brim + low rounded crown
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16), hatMat);
      brim.position.set(0, 0.92, 0.04);
      brim.castShadow = true;
      g.add(brim);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.5), hatMat);
      crown.scale.set(1, 0.8, 1);
      crown.position.set(0, 0.93, 0.04);
      g.add(crown);
      const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.05, 14), toonMat(0xe07a8a, { flatShading: true }));
      ribbon.position.set(0, 0.97, 0.04);
      g.add(ribbon);
    }

    // Paws.
    for (const fx of [-0.11, 0.11]) {
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), bellyMat);
      paw.position.set(fx, 0.06, 0.12);
      paw.scale.set(1, 0.7, 1.3);
      g.add(paw);
    }

    g.scale.setScalar(1.2);
    g.visible = false;
    this.scene.add(g);
    return { group: g, role, target: null, path: [], cd: 0, prog: 0, cycleIdx: 0, _homeVec: null };
  }

  _home(role) {
    const p = this.store.group.position;
    if (role === 'stocker') return new THREE.Vector3(p.x - 1.7, 0.64, p.z + 1.9);
    return new THREE.Vector3(p.x + 2.0, 0.64, p.z + 2.4); // harvester idle spot
  }

  _ensure(role) {
    if (!this.workers[role]) this.workers[role] = this._makeWorker(role);
    const w = this.workers[role];
    if (!w.group.visible) {
      w.group.visible = true;
      w.group.position.copy(this._home(role));
    }
    return w;
  }

  _moveToward(w, target, dt, speed) {
    const pos = w.group.position;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    w.prog += dt;
    if (dist > 1e-3) w.group.rotation.y = Math.atan2(dx, dz);
    w.group.position.y = 0.64 + Math.abs(Math.sin(w.prog * Math.PI * 6) * 0.05) * 1.2;
    const step = speed * dt;
    if (dist <= step) {
      pos.x = target.x;
      pos.z = target.z;
      return true;
    }
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    return false;
  }

  update(dt, elapsed) {
    if (gameState.albaLevel('harvester') > 0) this._updateHarvester(dt);
    if (gameState.albaLevel('stocker') > 0) this._updateStocker(dt, elapsed);
  }

  _updateHarvester(dt) {
    const w = this._ensure('harvester');
    if (w.cycleIdx === undefined) w.cycleIdx = 0;
    w.cd -= dt;
    const idle = () => this._moveToward(w, w._homeVec || (w._homeVec = this._home('harvester')), dt, 1.4);

    if (!w.target) {
      if (w.cd > 0) return idle();
      // Round-robin over the obtainable items (gated by harvester level/tier),
      // in order: acorn -> banana -> fish -> ... -> loop. One at a time.
      const maxTier = gameState.harvesterMaxTier();
      const allowed = gameState.availableItems.filter((t) => (ITEM_TIER[t] || 99) <= maxTier);
      if (allowed.length === 0) return idle();
      const currentType = allowed[w.cycleIdx % allowed.length];
      // Only the current item in the cycle; if none ready, WAIT for it.
      const targets = this.island.getReadyTargets().filter((t) => t.ref.type === currentType);
      if (targets.length === 0) return idle();
      const pos = w.group.position;
      targets.sort((a, b) => a.pos.distanceToSquared(pos) - b.pos.distanceToSquared(pos));
      w.target = targets[0];
      // If the target is on the OTHER island, route over the bridge.
      w.path = this._bridgePath(pos, w.target.pos);
    }

    // Walk any bridge waypoints first, then approach the target.
    if (w.path && w.path.length) {
      if (this._steerToward(w, w.path[0], dt, 2.0)) w.path.shift();
      return;
    }
    const gp = this._tmp.set(w.target.pos.x, 0.64, w.target.pos.z);
    if (this._steerToward(w, gp, dt, 2.0)) {
      const res = this.island.harvestTarget(w.target);
      w.target = null;
      w.path = [];
      w.cd = gameState.harvesterPeriod() || 4;
      if (res) {
        if (this.audio) this.audio.harvestPop();
        if (this.callbacks.onHarvest) this.callbacks.onHarvest(res.type, res.worldPos);
        w.cycleIdx += 1; // advance to the next item only after a real harvest
      }
    }
  }

  // Returns bridge waypoints if `from` and `to` are on different islands,
  // otherwise an empty array. Bridge spans world x≈9..12.2 at z≈0.
  _bridgePath(from, to) {
    const mid = 10.6; // between the two islands
    const fromI2 = from.x > mid;
    const toI2 = to.x > mid;
    if (fromI2 === toI2) return [];
    const A = new THREE.Vector3(9.2, 0.64, 0); // main-island bridge mouth
    const B = new THREE.Vector3(12.0, 0.64, 0); // second-island bridge mouth
    return fromI2 ? [B, A] : [A, B];
  }

  // World obstacle circles to avoid: trees + fountain (Island) and the store
  // footprint + camper/picnic (Store).
  _obstacleList() {
    const obs = this.island.getObstacles ? this.island.getObstacles() : [];
    if (this.store.getObstacles) return obs.concat(this.store.getObstacles());
    return obs;
  }

  // Seek `target` while steering around obstacle circles (repulsion + a
  // tangential push so the worker goes AROUND rather than into things).
  _steerToward(w, target, dt, speed) {
    const pos = w.group.position;
    let dx = target.x - pos.x;
    let dz = target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= speed * dt) {
      pos.x = target.x;
      pos.z = target.z;
      return true;
    }
    dx /= dist;
    dz /= dist;

    let ax = 0;
    let az = 0;
    for (const o of this._obstacleList()) {
      // Don't avoid the obstacle we're actually heading to (our target).
      if (Math.hypot(o.x - target.x, o.z - target.z) < o.r + 0.3) continue;
      const ox = o.x - pos.x;
      const oz = o.z - pos.z;
      const od = Math.hypot(ox, oz);
      const R = o.r + 0.9; // obstacle radius + worker half-width + margin
      if (od > 1e-3 && od < R) {
        const push = (R - od) / R;
        ax += (-ox / od) * push; // repel away from the obstacle
        az += (-oz / od) * push;
        // tangential component, choosing the side that points toward the goal
        const perpx = -oz / od;
        const perpz = ox / od;
        const side = perpx * dx + perpz * dz >= 0 ? 1 : -1;
        ax += perpx * side * push * 1.2;
        az += perpz * side * push * 1.2;
      }
    }

    let mx = dx + ax * 2.6;
    let mz = dz + az * 2.6;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;

    const step = speed * dt;
    w.prog += dt;
    w.group.rotation.y = Math.atan2(mx, mz);
    w.group.position.y = 0.64 + Math.abs(Math.sin(w.prog * Math.PI * 6) * 0.05) * 1.2;
    pos.x += mx * step;
    pos.z += mz * step;
    return false;
  }

  _updateStocker(dt, elapsed) {
    const w = this._ensure('stocker');
    this._settle(w, w._homeVec || (w._homeVec = this._home('stocker')), dt, elapsed);
    w.cd -= dt;
    if (w.cd <= 0) {
      w.cd = gameState.stockerPeriod() || 1.5;
      const t = gameState.stockOne();
      if (t && this.callbacks.onStock) this.callbacks.onStock();
    }
  }

  _settle(w, home, dt, elapsed) {
    const pos = w.group.position;
    const dx = home.x - pos.x;
    const dz = home.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.06) {
      const step = 1.6 * dt;
      w.prog += dt;
      w.group.rotation.y = Math.atan2(dx, dz);
      pos.x += (dx / dist) * Math.min(step, dist);
      pos.z += (dz / dist) * Math.min(step, dist);
      w.group.position.y = 0.64 + Math.abs(Math.sin(w.prog * Math.PI * 6) * 0.05) * 1.2;
    } else {
      w.group.rotation.y = Math.PI; // face the front
      w.group.position.y = 0.64 + Math.sin(elapsed * 3) * 0.03;
    }
  }

  reset() {
    for (const role of Object.keys(this.workers)) {
      const w = this.workers[role];
      w.group.visible = false;
      w.target = null;
      w.path = [];
      w.cd = 0;
      w.cycleIdx = 0;
      w._homeVec = null;
    }
  }
}
