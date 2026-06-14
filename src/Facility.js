// Facility.js — Stage 5 production facilities. Each hired facility shows a
// worker character that loops an idle animation in place and auto-produces its
// resource over time (rate scales with level). No pathfinding (cheap).
import * as THREE from 'three';
import { toonMat, makeItem, disposeObject } from './toon.js';
import { gameState, FACILITY_IDS, FACILITIES } from './GameState.js';

export class FacilityManager {
  constructor(scene, island, audio, callbacks) {
    this.scene = scene;
    this.island = island;
    this.audio = audio;
    this.callbacks = callbacks; // { onProduce(item, worldPos, count) }
    this.workers = {}; // id -> { group, parts }
    this._acc = {};
  }

  // --- character building -------------------------------------------------
  _critter(bodyColor, bellyColor, headScale = 1) {
    const g = new THREE.Group();
    const bodyMat = toonMat(bodyColor, { flatShading: true });
    const bellyMat = toonMat(bellyColor, { flatShading: true });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), bodyMat);
    body.scale.set(1, 1.15, 0.95);
    body.position.y = 0.36;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24 * headScale, 10, 8), bodyMat);
    head.position.set(0, 0.8, 0.05);
    head.castShadow = true;
    g.add(head);
    for (const ex of [-0.09, 0.09]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 5), new THREE.MeshBasicMaterial({ color: 0x2a221c }));
      eye.position.set(ex, 0.83, 0.23 * headScale);
      g.add(eye);
    }
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), bellyMat);
    snout.position.set(0, 0.77, 0.26 * headScale);
    g.add(snout);
    return { group: g, body, head, bodyMat, bellyMat };
  }

  _denimOveralls(g) {
    const denim = toonMat(0x3f6ea5, { flatShading: true });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.05), denim);
    panel.position.set(0, 0.3, 0.27);
    g.add(panel);
    for (const ex of [-0.1, 0.1]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.04), denim);
      strap.position.set(ex, 0.52, 0.24);
      strap.rotation.x = -0.2;
      g.add(strap);
    }
  }

  _squirrelEarsTail(g, mat) {
    for (const ex of [-0.13, 0.13]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.13, 5), mat);
      ear.position.set(ex, 0.99, 0.05);
      g.add(ear);
    }
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mat);
    tail.scale.set(0.8, 1.6, 0.8);
    tail.position.set(0, 0.6, -0.32);
    tail.castShadow = true;
    g.add(tail);
  }

  _makeAxeSquirrel() {
    const c = this._critter(0xc8773c, 0xf0d6b0);
    this._squirrelEarsTail(c.group, c.bodyMat);
    this._denimOveralls(c.group);
    // Axe in front, on a swinging pivot.
    const arm = new THREE.Group();
    arm.position.set(0.2, 0.5, 0.18);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), toonMat(0x8b5e3c, { flatShading: true }));
    handle.position.set(0, -0.18, 0);
    arm.add(handle);
    const headAxe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.06), toonMat(0xc9ccd0, { flatShading: true }));
    headAxe.position.set(0.06, -0.4, 0);
    arm.add(headAxe);
    c.group.add(arm);
    c.group.scale.setScalar(1.2);
    c.swing = arm;
    return c;
  }

  _makeCartSquirrel() {
    const c = this._critter(0xe0a368, 0xf6e6c8); // lighter squirrel
    this._squirrelEarsTail(c.group, c.bodyMat);
    this._denimOveralls(c.group);
    // A little cart pulled behind.
    const cart = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.32, 0.5), toonMat(0xb5793c, { flatShading: true }));
    box.position.y = 0.32;
    cart.add(box);
    for (let i = 0; i < 4; i++) {
      const ban = makeItem('banana');
      ban.scale.setScalar(0.55);
      ban.position.set(-0.15 + (i % 2) * 0.3, 0.5, -0.12 + Math.floor(i / 2) * 0.2);
      cart.add(ban);
    }
    for (const sx of [-0.32, 0.32]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 10), toonMat(0x3a3330, { flatShading: true }));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(sx, 0.16, 0);
      cart.add(wheel);
    }
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 5), toonMat(0x8b5e3c, { flatShading: true }));
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, 0.34, 0.4);
    cart.add(shaft);
    cart.position.set(0, 0, -0.55);
    cart.traverse((o) => (o.castShadow = true));
    c.group.add(cart);
    c.group.scale.setScalar(1.2);
    return c;
  }

  _makeFisherBear() {
    const c = this._critter(0x8a5a3c, 0xd8b48a, 1.05);
    // round bear ears
    for (const ex of [-0.16, 0.16]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), c.bodyMat);
      ear.position.set(ex, 1.0, 0.04);
      c.group.add(ear);
    }
    // straw hat
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 14), toonMat(0xd9b25a, { flatShading: true }));
    brim.position.set(0, 0.98, 0.04);
    c.group.add(brim);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.5), toonMat(0xd9b25a, { flatShading: true }));
    crown.scale.set(1, 0.8, 1);
    crown.position.set(0, 0.99, 0.04);
    c.group.add(crown);
    // Fishing rod: held forward; the whole bear is rotated toward the sea at
    // placement time, so this points out over the water.
    const rod = new THREE.Group();
    rod.position.set(0.18, 0.58, 0.18);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 1.05, 6), toonMat(0x6b4f1a, { flatShading: true }));
    pole.position.set(0, 0.26, 0.48);
    pole.rotation.x = 1.02;
    rod.add(pole);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), toonMat(0x6b4f1a, { flatShading: true }));
    tip.position.set(0, 0.5, 0.93);
    rod.add(tip);
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.55, 4), toonMat(0xeeeeee, {}));
    line.position.set(0, 0.18, 0.98);
    rod.add(line);
    const bobber = new THREE.Mesh(new THREE.SphereGeometry(0.055, 7, 5), toonMat(0xff6f61, { flatShading: true }));
    bobber.position.set(0, -0.12, 1.0);
    rod.add(bobber);
    c.group.add(rod);

    // Small round limbs so the fisher reads as a cute bear.
    for (const ex of [-0.27, 0.27]) {
      const arm = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), c.bodyMat);
      arm.scale.set(0.78, 1.15, 0.82);
      arm.position.set(ex, 0.52, 0.16);
      arm.castShadow = true;
      c.group.add(arm);
    }
    for (const ex of [-0.13, 0.13]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 6), c.bodyMat);
      foot.scale.set(1.1, 0.58, 1.25);
      foot.position.set(ex, 0.08, 0.14);
      foot.castShadow = true;
      c.group.add(foot);
    }
    c.group.scale.setScalar(1.35);
    c.swing = rod;
    return c;
  }

  _makeOtters() {
    const g = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const o = this._critter(0x9c6b46, 0xe6cfa8, 0.9);
      // lay the otter on its back, floating
      o.group.rotation.x = -1.3;
      o.group.position.set((i - 0.5) * 0.7, 0.18, 0);
      o.group.scale.setScalar(0.85);
      // a shell resting on the belly
      const shell = makeItem('shell');
      shell.scale.setScalar(0.5);
      shell.position.set(0, 0.55, 0.2);
      o.group.add(shell);
      g.add(o.group);
    }
    g.userData.otters = true;
    return { group: g };
  }

  _build(id) {
    if (id === 'acornFarm') return this._makeAxeSquirrel();
    if (id === 'bananaFarm') return this._makeCartSquirrel();
    if (id === 'fishFarm') return this._makeFisherBear();
    return this._makeOtters();
  }

  _ensure(id) {
    if (!this.workers[id]) {
      const w = this._build(id);
      const p = this.island.getFacilityPos(id);
      if (p) w.group.position.set(p.x, id === 'clamFarm' ? 0.2 : 0.64, p.z);
      if (id === 'fishFarm') w.group.rotation.y = 0;
      w.home = w.group.position.clone();
      this.scene.add(w.group);
      this.workers[id] = w;
    }
    this.workers[id].group.visible = true;
    return this.workers[id];
  }

  _animate(id, w, dt, elapsed) {
    if (id === 'acornFarm' && w.swing) {
      // chop: swing the axe arm down and up
      w.swing.rotation.x = -0.4 + Math.abs(Math.sin(elapsed * 4)) * 1.2;
    } else if (id === 'bananaFarm') {
      // amble back and forth along x
      const dx = Math.sin(elapsed * 0.8) * 1.6;
      w.group.position.x = w.home.x + dx;
      w.group.rotation.y = Math.cos(elapsed * 0.8) >= 0 ? Math.PI / 2 : -Math.PI / 2;
      w.group.position.y = 0.64 + Math.abs(Math.sin(elapsed * 6)) * 0.04;
    } else if (id === 'fishFarm') {
      w.group.position.y = 0.64 + Math.sin(elapsed * 1.5) * 0.025; // standing on the island edge
      if (w.swing) w.swing.rotation.x = Math.sin(elapsed * 2) * 0.25;
    } else if (id === 'clamFarm') {
      w.group.position.y = 0.18 + Math.sin(elapsed * 1.3) * 0.05; // float
      w.group.rotation.z = Math.sin(elapsed * 0.9) * 0.06;
    }
  }

  update(dt, elapsed) {
    for (const id of FACILITY_IDS) {
      if (gameState.facilityLevel(id) <= 0) continue;
      const w = this._ensure(id);
      this._animate(id, w, dt, elapsed);
      this._acc[id] = (this._acc[id] || 0) + gameState.facilityRate(id) * dt;
      const got = Math.floor(this._acc[id]);
      if (got > 0) {
        this._acc[id] -= got;
        const pos = this.island.getFacilityPos(id);
        if (this.callbacks.onProduce) this.callbacks.onProduce(FACILITIES[id].item, pos, got);
      }
    }
  }

  reset() {
    for (const id of Object.keys(this.workers)) {
      disposeObject(this.workers[id].group);
    }
    this.workers = {};
    this._acc = {};
  }
}
