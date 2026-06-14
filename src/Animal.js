// Animal.js — customer spawning, waypoint pathing, state machine, waddle,
// and a pooled set of reusable animal models (pool size 6, max 3 concurrent).
import * as THREE from 'three';
import { toonMat, makeItem, disposeObject } from './toon.js';
import { gameState, ITEM_COLORS, MAX_CUSTOMERS } from './GameState.js';

// Species registry — add a customer species by adding one entry.
// ear.pos gives the RIGHT ear (left is mirrored on x). Omitting ear/tail uses
// sensible defaults.
const SPECIES = {
  squirrel: { body: 0xc8773c, belly: 0xf0d6b0, tail: { scale: [0.9, 1.7, 0.8], pos: [0, 0.6, -0.36] } },
  monkey: { body: 0x8b6b4a, belly: 0xe8c9a0, ear: { scale: [1.3, 1.3, 0.6], pos: [0.24, 0.82, 0.02] }, tail: { scale: [0.4, 0.9, 0.4], pos: [0, 0.45, -0.32] } },
  rabbit: { body: 0xf3ede4, belly: 0xffffff, ear: { scale: [0.6, 2.2, 0.6], pos: [0.1, 1.15, 0.0] }, tail: { scale: [0.5, 0.5, 0.5], pos: [0, 0.35, -0.3] } },
  cat: { body: 0xb8b0a8, belly: 0xf2efe9, ear: { scale: [0.8, 1.4, 0.5], pos: [0.14, 1.04, 0.02] }, tail: { scale: [0.35, 1.4, 0.35], pos: [0.1, 0.45, -0.33] } },
  bear: { body: 0x8a5a3c, belly: 0xd8b48a, ear: { scale: [1.15, 1.15, 0.8], pos: [0.2, 1.06, 0.02] }, tail: { scale: [0.4, 0.4, 0.4], pos: [0, 0.4, -0.34] } },
  fox: { body: 0xe07a36, belly: 0xf6ead8, ear: { scale: [0.7, 1.7, 0.5], pos: [0.17, 1.08, 0.02] }, tail: { scale: [0.75, 1.6, 0.75], pos: [0, 0.42, -0.4] } },
};
const DEFAULT_EAR = { scale: [1, 1, 1], pos: [0.16, 1.0, 0.02] };
const DEFAULT_TAIL = { scale: [0.7, 1.3, 0.7], pos: [0, 0.45, -0.32] };

const STATE = {
  WALK_IN: 'walk_in',
  WAIT: 'wait',
  LEAVE_HAPPY: 'leave_happy',
  LEAVE_SAD: 'leave_sad',
};

export class AnimalManager {
  constructor(scene, store, particles, audio, callbacks) {
    this.scene = scene;
    this.store = store;
    this.particles = particles;
    this.audio = audio;
    this.callbacks = callbacks; // { requestSell(type) -> value|false }

    this.pool = [];
    this.spawnTimer = 4; // first one arrives a little sooner
    this.activeCount = 0;
    this._usedSlots = new Set(); // stable serve-slot indices (no overlap)

    this._buildPool();
  }

  _buildPool() {
    // Pool sized to the concurrent cap so spawns never allocate at runtime.
    for (let i = 0; i < MAX_CUSTOMERS; i++) {
      const c = this._makeCustomer();
      c.group.visible = false;
      this.scene.add(c.group);
      this.pool.push(c);
    }
  }

  _makeCustomer() {
    const group = new THREE.Group();

    // Body (round). Materials are recolored per species on spawn.
    const bodyMat = toonMat(0xffffff, { flatShading: true });
    const bellyMat = toonMat(0xffffff, { flatShading: true });
    const darkMat = toonMat(0x4a3a2a, { flatShading: true });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), bodyMat);
    body.scale.set(1, 1.15, 1);
    body.position.y = 0.36;
    body.castShadow = true;
    group.add(body);

    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), bellyMat);
    belly.position.set(0, 0.3, 0.18);
    belly.scale.set(1, 1.1, 0.7);
    group.add(belly);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), bodyMat);
    head.position.set(0, 0.78, 0.04);
    head.castShadow = true;
    group.add(head);

    // Eyes.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2a221c });
    for (const ex of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), eyeMat);
      eye.position.set(ex, 0.82, 0.24);
      group.add(eye);
    }
    // Snout.
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), bellyMat);
    snout.position.set(0, 0.74, 0.27);
    group.add(snout);

    // Ears (two), recolored & repositioned per species.
    const earL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), bodyMat);
    const earR = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), bodyMat);
    earL.position.set(-0.16, 1.0, 0.02);
    earR.position.set(0.16, 1.0, 0.02);
    group.add(earL, earR);

    // Tail (big & blocky — prominent for squirrels).
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), bodyMat);
    tail.position.set(0, 0.45, -0.32);
    tail.scale.set(0.7, 1.3, 0.7);
    tail.castShadow = true;
    group.add(tail);

    // Feet.
    const footMat = darkMat;
    for (const fx of [-0.13, 0.13]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), footMat);
      foot.position.set(fx, 0.05, 0.1);
      foot.scale.set(1, 0.6, 1.4);
      group.add(foot);
    }

    // Thought bubble: cloud sphere + item primitive holder.
    const bubble = new THREE.Group();
    const cloud = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 10, 8),
      new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
    );
    cloud.scale.set(1.2, 0.95, 1);
    bubble.add(cloud);
    // single small tail puff
    {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
      );
      puff.position.set(-0.16, -0.26, 0);
      bubble.add(puff);
    }
    // Item holder sits in FRONT of the cloud (toward the camera) so the goods
    // are not hidden inside the opaque cloud. Items are laid out in a row.
    const itemHolder = new THREE.Group();
    // Items are bbox-centered, but their tall thin tops (stems/lids) bias the
    // visual weight downward — so lift the whole row up into the bubble centre.
    itemHolder.position.set(0, 0.12, 0.34);
    bubble.add(itemHolder);
    // Raised above the head (clears tall rabbit ears) and shifted left.
    bubble.position.set(-0.4, 1.95, 0);
    bubble.visible = false;
    group.add(bubble);

    return {
      group,
      parts: { body, belly, head, earL, earR, tail, bodyMat, bellyMat },
      bubble,
      bubbleCloud: cloud,
      itemHolder,
      itemMeshes: [], // one mesh per shopping-list item (left→right)
      boughtIndex: 0,
      state: STATE.WALK_IN,
      active: false,
      species: 'squirrel',
      wantList: [],
      boughtAny: false,
      waypoints: [],
      wpIndex: 0,
      walkProgress: 0,
      waitTimer: 0,
      exitTarget: new THREE.Vector3(),
      baseScale: 1.4, // ~0.7x of the previous size
    };
  }

  _applySpecies(c, species) {
    c.species = species;
    const cfg = SPECIES[species] || SPECIES.squirrel;
    c.parts.bodyMat.color.setHex(cfg.body);
    c.parts.bellyMat.color.setHex(cfg.belly);

    const { earL, earR, tail } = c.parts;
    const ear = cfg.ear || DEFAULT_EAR;
    earL.scale.set(ear.scale[0], ear.scale[1], ear.scale[2]);
    earR.scale.set(ear.scale[0], ear.scale[1], ear.scale[2]);
    earL.position.set(-ear.pos[0], ear.pos[1], ear.pos[2]);
    earR.position.set(ear.pos[0], ear.pos[1], ear.pos[2]);
    const t = cfg.tail || DEFAULT_TAIL;
    tail.scale.set(t.scale[0], t.scale[1], t.scale[2]);
    tail.position.set(t.pos[0], t.pos[1], t.pos[2]);
  }

  // Build the bubble's item row: one recognizable item per shopping-list entry,
  // laid out left→right in order, and widen the cloud to fit them.
  _buildBubbleRow(c, list) {
    for (const m of c.itemMeshes) disposeObject(m);
    c.itemMeshes = [];
    const n = Math.max(1, list.length);
    const spacing = 0.32;
    for (let i = 0; i < list.length; i++) {
      const m = makeItem(list[i]);
      m.scale.setScalar(0.5);
      m.position.set((i - (n - 1) / 2) * spacing, 0, 0);
      // Vertically center each item by its bounding box — items are
      // base-aligned and vary in height (flat shell/fish would sit too low).
      if (THREE.Box3) {
        const box = new THREE.Box3().setFromObject(m);
        const cy = (box.min.y + box.max.y) / 2;
        if (Number.isFinite(cy)) m.position.y = -cy;
      }
      c.itemHolder.add(m);
      c.itemMeshes.push(m);
    }
    // Cloud width is proportional to the item COUNT: 1 item = a small round
    // bubble, and each extra item widens it by one item-slot (height stays).
    c.bubbleCloud.scale.set(1.05 + (n - 1) * (spacing / 0.52), 0.95, 1);
  }

  // Mark the item at `index` as bought (fade/scale it out, keep order intact).
  _markBought(c, index) {
    const m = c.itemMeshes[index];
    if (m) m.visible = false;
  }

  spawn() {
    if (this.activeCount >= gameState.maxCustomers()) return;
    const c = this.pool.find((p) => !p.active);
    if (!c) return;

    const species = gameState.availableCustomers[Math.floor(Math.random() * gameState.availableCustomers.length)];
    this._applySpecies(c, species);
    // Shopping list of 1..N items (more likely to be big at higher stages).
    c.wantList = gameState.makeShoppingList();
    c.boughtAny = false;
    c.boughtIndex = 0;
    this._buildBubbleRow(c, c.wantList); // wide bubble showing items in order

    // Waypoints: edge -> mid -> serve position.
    // Spawn at the front coast (toward the camera) near the centre, then walk
    // straight up the open corridor to the store — clear of the side trees.
    const edge = new THREE.Vector3((Math.random() * 2 - 1) * 2.4, 0.64, 6.6 + Math.random() * 1.0);
    const serve = this.store.getServePosition();
    const mid = new THREE.Vector3(
      (edge.x + serve.x) / 2 + (Math.random() - 0.5),
      0.64,
      (edge.z + serve.z) / 2 + 0.6
    );
    // Give this customer the lowest FREE serve slot (stable while it stands),
    // then place it in a centered grid in front of the store so no two
    // customers overlap.
    let slot = 0;
    while (this._usedSlots.has(slot)) slot++;
    this._usedSlots.add(slot);
    c.slot = slot;
    const perRow = Math.min(6, Math.max(1, gameState.maxCustomers()));
    const col = slot % perRow;
    const row = Math.floor(slot / perRow);
    serve.x += (col - (perRow - 1) / 2) * 1.15;
    serve.z += row * 1.25;

    c.waypoints = [edge.clone(), mid, serve];
    c.wpIndex = 0;
    c.group.position.copy(edge);
    c.walkProgress = 0;
    c.waitTimer = 0;
    c.state = STATE.WALK_IN;
    c.bubble.visible = false;
    c.group.visible = true;
    c.group.scale.setScalar(c.baseScale);
    c.active = true;
    this.activeCount++;

    if (this.audio) this.audio.customerArrive();
  }

  _faceTowards(c, target, dt) {
    const dx = target.x - c.group.position.x;
    const dz = target.z - c.group.position.z;
    if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return;
    const targetRot = Math.atan2(dx, dz);
    let diff = targetRot - c.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    c.group.rotation.y += diff * Math.min(1, dt * 10);
  }

  update(dt, elapsed, spawnEnabled) {
    if (spawnEnabled) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        // Faster arrivals at higher stages (per GameState formula).
        this.spawnTimer = gameState.customerSpawnInterval();
        this.spawn();
      }
    }

    for (const c of this.pool) {
      if (!c.active) continue;

      if (c.state === STATE.WALK_IN) {
        this._walk(c, dt, () => {
          // Arrived at store front.
          c.state = STATE.WAIT;
          c.waitTimer = 6;
          c.bubble.visible = true;
        });
        // Waddle.
        this._waddle(c, dt);
      } else if (c.state === STATE.WAIT) {
        c.waitTimer -= dt;
        // Bubble bob (raised above the head) + keep it facing the camera so the
        // item in front of the cloud is always visible, regardless of facing.
        c.bubble.position.y = 1.95 + Math.sin(elapsed * 3) * 0.05;
        c.bubble.rotation.y = Math.PI / 4 - c.group.rotation.y;
        for (const m of c.itemMeshes) if (m.visible) m.rotation.y += dt * 2;

        // Buy through the shopping list, one item at a time, as each comes up
        // on the shelf. Patience renews per item so big buyers can finish.
        const want = c.wantList && c.wantList.length ? c.wantList[0] : null;
        const value = want ? this.callbacks.requestSell(want) : false;
        if (value) {
          c.boughtAny = true;
          this._markBought(c, c.boughtIndex); // fade out the bought item in the row
          c.boughtIndex++;
          c.wantList.shift();
          if (c.wantList.length === 0) {
            // Done shopping — leave happy.
            c.state = STATE.LEAVE_HAPPY;
            c.bubble.visible = false;
            this._setExit(c);
          } else {
            c.waitTimer = 5; // renew patience for the next item
          }
        } else if (c.waitTimer <= 0) {
          // Ran out of patience: leave happy if they bought anything, else sad.
          c.bubble.visible = false;
          if (c.boughtAny) {
            c.state = STATE.LEAVE_HAPPY;
          } else {
            c.state = STATE.LEAVE_SAD;
            this.particles.burstPuff(c.group.position.clone().setY(1.0), 5, 0xff7a7a);
          }
          this._setExit(c);
        }
      } else if (c.state === STATE.LEAVE_HAPPY || c.state === STATE.LEAVE_SAD) {
        this._faceTowards(c, c.exitTarget, dt);
        const done = this._moveToward(c, c.exitTarget, dt, 1.6);
        this._waddle(c, dt);
        if (done) this._despawn(c);
      }
    }
  }

  _setExit(c) {
    // Walk off toward a random edge.
    // Walk back out toward the front coast, down the central corridor.
    c.exitTarget = new THREE.Vector3((Math.random() * 2 - 1) * 2.6, 0.64, 8.0 + Math.random() * 1.5);
  }

  _walk(c, dt, onArrive) {
    const target = c.waypoints[c.wpIndex];
    this._faceTowards(c, target, dt);
    const done = this._moveToward(c, target, dt, 1.4);
    if (done) {
      c.wpIndex++;
      if (c.wpIndex >= c.waypoints.length) {
        onArrive();
      }
    }
  }

  _moveToward(c, target, dt, speed) {
    const pos = c.group.position;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    const step = speed * dt;
    c.walkProgress += dt;
    if (dist <= step) {
      pos.x = target.x;
      pos.z = target.z;
      return true;
    }
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    return false;
  }

  _waddle(c, dt) {
    const B = c.baseScale;
    const osc = Math.sin(c.walkProgress * Math.PI * 6);
    c.group.position.y = 0.64 + Math.abs(osc) * 0.05 * B;
    // Squash & stretch on X around the base scale (volume-ish conserving).
    c.group.scale.set(B * (1 + osc * 0.06), B, B * (1 - osc * 0.06));
  }

  _despawn(c) {
    c.active = false;
    c.group.visible = false;
    c.group.scale.setScalar(c.baseScale);
    c.group.position.y = 0.64;
    if (c.slot !== undefined && c.slot >= 0) {
      this._usedSlots.delete(c.slot);
      c.slot = -1;
    }
    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  reset() {
    for (const c of this.pool) {
      if (c.active) this._despawn(c);
    }
    this._usedSlots.clear();
    this.activeCount = 0;
    this.spawnTimer = 4;
  }
}

export { STATE };
