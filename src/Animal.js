// Animal.js — customer spawning, waypoint pathing, state machine, waddle,
// and a pooled set of reusable animal models (pool size 6, max 3 concurrent).
import * as THREE from 'three';
import { toonMat, makeItem, disposeObject } from './toon.js';
import { gameState, ITEM_COLORS } from './GameState.js';

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

    this._buildPool();
  }

  _buildPool() {
    for (let i = 0; i < 6; i++) {
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
    // are not hidden inside the opaque cloud.
    const itemHolder = new THREE.Group();
    // Raised toward the cloud centre (items are base-aligned, so they would
    // otherwise hang low) and pushed in front of the cloud.
    itemHolder.position.set(0, 0.04, 0.34);
    bubble.add(itemHolder);
    // Raised above the head (clears tall rabbit ears) and shifted left.
    bubble.position.set(-0.4, 1.95, 0);
    bubble.visible = false;
    group.add(bubble);

    return {
      group,
      parts: { body, belly, head, earL, earR, tail, bodyMat, bellyMat },
      bubble,
      itemHolder,
      itemMesh: null,
      state: STATE.WALK_IN,
      active: false,
      species: 'squirrel',
      desired: 'acorn',
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

  _makeItemPrimitive(type) {
    // Same recognizable model as the shelf/shore, shrunk to fit the bubble.
    const mesh = makeItem(type);
    mesh.scale.setScalar(0.62);
    return mesh;
  }

  _setDesired(c, type) {
    c.desired = type;
    if (c.itemMesh) {
      disposeObject(c.itemMesh);
      c.itemMesh = null;
    }
    const m = this._makeItemPrimitive(type);
    c.itemHolder.add(m);
    c.itemMesh = m;
  }

  spawn() {
    if (this.activeCount >= 3) return;
    const c = this.pool.find((p) => !p.active);
    if (!c) return;

    const species = gameState.availableCustomers[Math.floor(Math.random() * gameState.availableCustomers.length)];
    this._applySpecies(c, species);
    this._setDesired(c, gameState.randomDesiredItem());

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
    // Slight horizontal offset so 3 customers don't overlap exactly.
    const lane = (this.activeCount - 1) * 1.0;
    serve.x += lane;

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
        // Clerk alba speeds up customer arrivals.
        this.spawnTimer = 8 * gameState.clerkSpawnFactor();
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
        if (c.itemMesh) c.itemMesh.rotation.y += dt * 2;

        // Try to buy if item is on the shelf.
        const value = this.callbacks.requestSell(c.desired);
        if (value) {
          // Success!
          c.state = STATE.LEAVE_HAPPY;
          c.bubble.visible = false;
          this._setExit(c);
          // Coin spawns handled by callback via main (particles).
        } else if (c.waitTimer <= 0) {
          // Disappointed leave.
          c.state = STATE.LEAVE_SAD;
          c.bubble.visible = false;
          // Small "×" puff.
          this.particles.burstPuff(c.group.position.clone().setY(1.0), 5, 0xff7a7a);
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
    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  reset() {
    for (const c of this.pool) {
      if (c.active) this._despawn(c);
    }
    this.activeCount = 0;
    this.spawnTimer = 4;
  }
}

export { STATE };
