// Store.js — builds the three store tiers, manages shelf slots and disposes
// old meshes on upgrade to keep GPU memory flat.
import * as THREE from 'three';
import { toonMat, disposeObject, makeItem } from './toon.js';
import { gameState, ITEM_COLORS } from './GameState.js';

const COLORS = {
  woodDark: 0x8b5e3c,
  woodLight: 0xc49a6c,
  tentA: 0xff8c42,
  tentB: 0xfff3e0,
  thatch: 0xd9b15a,
  log: 0x9c6b3f,
  parasol: 0xff6f61,
  icebox: 0xbfe5f0,
  bench: 0xb07a4a,
  sign: 0xfff3e0,
};

const GRASS_Y = 0.64;

export class Store {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.set(0, GRASS_Y, -1.0);
    this.group.scale.setScalar(1.3); // suit the island scale
    this.scene.add(this.group);

    this.structure = null; // current tier mesh group (disposable)
    this.shelfSlotMeshes = []; // small platforms marking slots
    this.shelfItems = []; // { mesh, type } item meshes currently shown
    this.slotPositions = []; // local Vector3 positions for items

    this._zoomCb = null;
    this.build(1);
  }

  // Obstacle circles (world x,z,r) for the store footprint + Stage-5 furniture.
  getObstacles() {
    const p = this.group.position;
    const s = this.group.scale.x; // uniform scale
    const obs = [{ x: p.x, z: p.z, r: 2.4 }];
    if (gameState.stage >= 5) {
      obs.push({ x: p.x + 3.0 * s, z: p.z + 0.8 * s, r: 1.5 }); // camper van
      obs.push({ x: p.x - 3.5 * s, z: p.z + 1.2 * s, r: 1.4 }); // picnic table
    }
    return obs;
  }

  // World position customers walk to (front of the counter).
  getServePosition() {
    // Right at the front of the counter so customers buy at the stall.
    return new THREE.Vector3(this.group.position.x, 0.64, this.group.position.z + 2.0);
  }

  // World position where coins spawn on a sale.
  getCoinSpawnPosition() {
    return new THREE.Vector3(this.group.position.x, 1.9, this.group.position.z + 1.0);
  }

  // Bench / waiting position (stage 3 has a real bench).
  getBenchPosition(i = 0) {
    return new THREE.Vector3(this.group.position.x + 3.0, 0.64, this.group.position.z + 1.4 + i * 0.0);
  }

  build(stage) {
    this._disposeStructure();
    this.structure = new THREE.Group();

    // Registry of per-stage builders — add a stage by registering one here.
    // Falls back to the highest defined builder for stages beyond the list.
    if (!this._builders) {
      this._builders = {
        1: () => this._buildStall(),
        2: () => this._buildTent(),
        3: () => this._buildThatch(),
        4: () => this._buildGardenStall(),
        5: () => this._buildGardenCafe(),
      };
    }
    const keys = Object.keys(this._builders).map(Number);
    const use = this._builders[stage] || this._builders[Math.max(...keys.filter((k) => k <= stage))] || this._builders[Math.max(...keys)];
    use();

    this.group.add(this.structure);
    this._buildShelfSlots(gameState.shelfCapacity);
    this.refreshShelf();
  }

  _disposeStructure() {
    if (this.structure) {
      disposeObject(this.structure);
      this.structure = null;
    }
    for (const s of this.shelfSlotMeshes) disposeObject(s);
    this.shelfSlotMeshes = [];
    for (const it of this.shelfItems) disposeObject(it.mesh);
    this.shelfItems = [];
  }

  // --- Stage 1: wooden box stall ----------------------------------------
  _buildStall() {
    const s = this.structure;
    // Crate display table.
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.7), toonMat(COLORS.woodLight, { flatShading: true }));
    crate.position.set(0, 0.25, 0.2);
    crate.castShadow = true;
    crate.receiveShadow = true;
    s.add(crate);
    // Crate plank lines (two darker strips).
    for (const x of [-0.4, 0.4]) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.72), toonMat(COLORS.woodDark, { flatShading: true }));
      plank.position.set(x, 0.25, 0.2);
      s.add(plank);
    }
    // Checkout counter (small box behind).
    const counter = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.5), toonMat(COLORS.woodDark, { flatShading: true }));
    counter.position.set(0.9, 0.3, -0.4);
    counter.castShadow = true;
    s.add(counter);

    this._shelfTopY = 0.5;
    this._shelfZ = 0.2;
    this._shelfWidth = 1.2;
  }

  // --- Stage 2: striped fabric tent --------------------------------------
  _buildTent() {
    const s = this.structure;
    // Deep counter base so display goods sit forward of the roof.
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 1.3), toonMat(COLORS.woodLight, { flatShading: true }));
    base.position.set(0, 0.27, 0.4);
    base.castShadow = true;
    base.receiveShadow = true;
    s.add(base);

    // Striped tent roof from alternating boxes on a slight slope, set back.
    const roof = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.1, 1.4),
        toonMat(i % 2 === 0 ? COLORS.tentA : COLORS.tentB, { flatShading: true })
      );
      stripe.position.set(-1.0 + i * 0.4, 0, 0);
      roof.add(stripe);
    }
    roof.position.set(0, 1.7, -0.35);
    roof.rotation.x = -0.18;
    roof.castShadow = true;
    s.add(roof);

    // Tent posts.
    for (const x of [-1.05, 1.05]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 6), toonMat(COLORS.woodDark, { flatShading: true }));
      post.position.set(x, 0.9, -0.7);
      post.castShadow = true;
      s.add(post);
    }

    // (Parasol removed per request.)

    // Insulated icebox.
    const icebox = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), toonMat(COLORS.icebox, { flatShading: true }));
    icebox.position.set(-1.2, 0.25, 0.6);
    icebox.castShadow = true;
    s.add(icebox);

    this._shelfTopY = 0.55;
    this._shelfZ = 0.75; // forward of the roofline
    this._shelfWidth = 1.7;
  }

  // --- Stage 3: rustic thatch convenience store --------------------------
  _buildThatch() {
    const s = this.structure;
    // Log walls set well back, so the roof above them does not cover the
    // front shelf where goods are displayed.
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 0.25), toonMat(COLORS.log, { flatShading: true }));
    backWall.position.set(0, 0.7, -0.9);
    backWall.castShadow = true;
    s.add(backWall);
    for (const x of [-1.25, 1.25]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.6, 7), toonMat(COLORS.woodDark, { flatShading: true }));
      log.position.set(x, 0.8, -0.7);
      log.castShadow = true;
      s.add(log);
    }

    // Deep counter that reaches forward so display goods sit in front.
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.55, 1.5), toonMat(COLORS.woodLight, { flatShading: true }));
    counter.position.set(0, 0.27, 0.45);
    counter.castShadow = true;
    counter.receiveShadow = true;
    s.add(counter);

    // Thatched straw roof — pulled back over the walls and lifted so it never
    // overlaps the forward shelf in the isometric view.
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 1.7, 1.1, 8), toonMat(COLORS.thatch, { flatShading: true }));
    roof.position.set(0, 2.35, -0.7);
    roof.castShadow = true;
    s.add(roof);
    const roof2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 1.35, 0.5, 8), toonMat(0xc99a45, { flatShading: true }));
    roof2.position.set(0, 2.85, -0.7);
    s.add(roof2);

    // Cozy wooden signpost planted in the ground in front of the shop.
    const signGroup = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 1.25, 7), toonMat(COLORS.woodDark, { flatShading: true }));
    post.position.y = 0.62;
    signGroup.add(post);
    // Back board (frame) + lighter plank face.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.6, 0.07), toonMat(COLORS.woodDark, { flatShading: true }));
    frame.position.set(0, 1.15, 0);
    signGroup.add(frame);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.46, 0.06), toonMat(COLORS.woodLight, { flatShading: true }));
    plank.position.set(0, 1.15, 0.05);
    signGroup.add(plank);
    // Warm accent stripe carved across the plank.
    const accent = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.04), toonMat(COLORS.tentA, { flatShading: true }));
    accent.position.set(0, 1.05, 0.08);
    signGroup.add(accent);
    signGroup.position.set(-1.9, 0, 1.5); // planted on the grass, front-left
    signGroup.traverse((c) => (c.castShadow = true));
    s.add(signGroup);

    // Cozy waiting bench off to the side.
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.45), toonMat(COLORS.bench, { flatShading: true }));
    seat.position.y = 0.4;
    bench.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 0.08), toonMat(COLORS.bench, { flatShading: true }));
    back.position.set(0, 0.62, -0.18);
    bench.add(back);
    for (const bx of [-0.45, 0.45]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.4, 0.09), toonMat(COLORS.woodDark, { flatShading: true }));
      leg.position.set(bx, 0.2, 0);
      bench.add(leg);
    }
    bench.position.set(2.6, 0, 1.7);
    bench.traverse((c) => (c.castShadow = true));
    s.add(bench);

    this._shelfTopY = 0.55;
    this._shelfZ = 0.95; // forward, in front of the roofline
    this._shelfWidth = 2.0;
  }

  // --- Stage 4: cozy LOG CABIN shop (a clear step up from the thatch) -----
  _buildLogCabin() {
    const s = this.structure;
    const logDark = 0x9c6b3f;
    const logLight = 0xbf935f;

    // Stacked-log back wall.
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 2.7, 9), toonMat(i % 2 ? logDark : logLight, { flatShading: true }));
      log.rotation.z = Math.PI / 2;
      log.position.set(0, 0.5 + i * 0.32, -0.9);
      log.castShadow = true;
      s.add(log);
    }
    // Stacked-log side walls.
    for (const x of [-1.32, 1.32]) {
      for (let i = 0; i < 4; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.5, 8), toonMat(i % 2 ? logDark : logLight, { flatShading: true }));
        log.rotation.x = Math.PI / 2;
        log.position.set(x, 0.5 + i * 0.32, -0.25);
        log.castShadow = true;
        s.add(log);
      }
    }

    // Warm counter + worktop trim.
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.55, 1.3), toonMat(COLORS.woodLight, { flatShading: true }));
    counter.position.set(0, 0.28, 0.55);
    counter.castShadow = true;
    counter.receiveShadow = true;
    s.add(counter);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.1, 1.4), toonMat(0xd8b27a, { flatShading: true }));
    top.position.set(0, 0.58, 0.55);
    s.add(top);

    // Tidy pitched plank roof (gable) — neat shingled look, set back & high.
    for (const dir of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.16, 2.0), toonMat(0xb5673b, { flatShading: true }));
      slab.position.set(dir * 0.82, 2.0, -0.5);
      slab.rotation.z = -dir * 0.52; // slope up toward the ridge (peak, not valley)
      slab.castShadow = true;
      s.add(slab);
      // plank lines
      for (let k = -1; k <= 1; k++) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.02, 0.06), toonMat(0x8c4d2a, { flatShading: true }));
        line.position.set(dir * 0.82, 2.02, -0.5 + k * 0.55);
        line.rotation.z = -dir * 0.52;
        s.add(line);
      }
    }
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 2.0), toonMat(0x8c4d2a, { flatShading: true }));
    ridge.position.set(0, 2.62, -0.5);
    s.add(ridge);
    // Little chimney with smoke puffs.
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.55, 0.3), toonMat(0xa05a3a, { flatShading: true }));
    chimney.position.set(0.95, 2.45, -0.7);
    chimney.castShadow = true;
    s.add(chimney);
    for (let i = 0; i < 3; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.1 + i * 0.03, 7, 6), toonMat(0xf2efe9, { flatShading: true }));
      puff.position.set(0.95 + i * 0.06, 2.85 + i * 0.22, -0.7);
      s.add(puff);
    }

    // Shop sign mounted up under the roof's front edge (tucked inward, raised).
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.08), toonMat(COLORS.woodDark, { flatShading: true }));
    beam.position.set(0, 1.89, 0.6);
    s.add(beam);
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 0.07), toonMat(0xfff0d6, { flatShading: true }));
    signBoard.position.set(0, 1.58, 0.52);
    signBoard.castShadow = true;
    s.add(signBoard);
    const signTrim = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.09), toonMat(COLORS.accent || 0xff8c42, { flatShading: true }));
    signTrim.position.set(0, 1.34, 0.53);
    s.add(signTrim);

    // Two little stools out front.
    for (const x of [-1.7, 1.7]) {
      const stool = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 10), toonMat(0xc88a4a, { flatShading: true }));
      seat.position.y = 0.42;
      stool.add(seat);
      for (let l = 0; l < 3; l++) {
        const a = (l / 3) * Math.PI * 2;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 5), toonMat(COLORS.woodDark, { flatShading: true }));
        leg.position.set(Math.cos(a) * 0.14, 0.21, Math.sin(a) * 0.14);
        stool.add(leg);
      }
      stool.position.set(x, 0, 1.5);
      stool.traverse((c) => (c.castShadow = true));
      s.add(stool);
    }

    this._shelfTopY = 0.6;
    this._shelfZ = 1.0;
    this._shelfWidth = 2.5;
  }

  _buildGardenStall() {
    this._buildLogCabin();
  }

  // --- Stage 5: log cabin + cozy camper van & picnic table beside it -----
  _buildGardenCafe() {
    this._buildLogCabin();
    this._buildCamper();
    this._buildPicnic();
  }

  _buildCamper() {
    const s = this.structure;
    const camper = new THREE.Group();
    // Tucked behind the cabin on the right, nestled among the oak trees
    // (oaks ~world (4.5,-3) & (0,-4.8)); a touch smaller and turned to show
    // more of its side.
    camper.position.set(3.0, 0, 0.8); // (x,y,z) local — nudged down (toward front)
    camper.rotation.y = 0.1; // turn so the DOOR side faces the camera
    camper.scale.setScalar(0.85); // slightly smaller
    s.add(camper);
    const teal = 0x6fc7c0;
    const cream = 0xfff3e0;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.0, 1.0), toonMat(cream, { flatShading: true }));
    body.position.y = 0.75;
    body.castShadow = true;
    camper.add(body);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.34, 1.02), toonMat(teal, { flatShading: true }));
    stripe.position.y = 0.62;
    camper.add(stripe);
    // Rounded roof (half cylinder), flattened into a low dome.
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.72, 12, 1, false, 0, Math.PI), toonMat(teal, { flatShading: true }));
    roof.rotation.z = Math.PI / 2;
    roof.scale.set(0.55, 1, 1); // squash the arc -> flatter dome
    roof.position.y = 1.25;
    roof.castShadow = true;
    camper.add(roof);
    // Cab (front).
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.95), toonMat(cream, { flatShading: true }));
    cab.position.set(1.05, 0.6, 0);
    camper.add(cab);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.8), toonMat(0xbfe9f5, { flatShading: true }));
    windshield.position.set(1.31, 0.75, 0);
    camper.add(windshield);
    // Side window + a clear door (on the +z side that faces the camera).
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.06), toonMat(0xbfe9f5, { flatShading: true }));
    win.position.set(-0.32, 0.85, 0.51);
    camper.add(win);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.74, 0.05), toonMat(0x5fb0aa, { flatShading: true }));
    door.position.set(0.42, 0.62, 0.51);
    camper.add(door);
    const doorWin = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.05), toonMat(0xbfe9f5, { flatShading: true }));
    doorWin.position.set(0.42, 0.84, 0.53);
    camper.add(doorWin);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.05), toonMat(0x2f3a38, { flatShading: true }));
    handle.position.set(0.18, 0.6, 0.55);
    camper.add(handle);
    // Wheels.
    for (const wx of [0.7, -0.55]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.16, 12), toonMat(0x3a3330, { flatShading: true }));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.24, 0.5);
      camper.add(wheel);
      const wheel2 = wheel.clone();
      wheel2.position.z = -0.5;
      camper.add(wheel2);
    }
    // Awning: ONE solid canopy slab + stripes floating just above it with
    // gaps, so no faces are coplanar/overlapping (avoids z-fighting shimmer).
    const awning = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.05, 0.3), toonMat(cream, { flatShading: true }));
    awning.add(canopy);
    for (let i = 0; i < 4; i++) {
      const st2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.32), toonMat(0xff8fc0, { flatShading: true }));
      st2.position.set(-0.3 + i * 0.2, 0.045, 0); // raised above the slab, gapped
      awning.add(st2);
    }
    awning.position.set(-0.1, 1.05, 0.86);
    awning.rotation.x = 0.55;
    camper.add(awning);
    camper.traverse((c) => (c.castShadow = true));
  }

  _buildPicnic() {
    const s = this.structure;
    const g = new THREE.Group();
    // Left-front corner: opposite the camper, in front of the palms, off paths.
    g.position.set(-3.5, 0, 1.2);
    s.add(g);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.7), toonMat(0xc88a4a, { flatShading: true }));
    top.position.y = 0.6;
    g.add(top);
    for (const z of [-0.5, 0.5]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.26), toonMat(0xb5793c, { flatShading: true }));
      bench.position.set(0, 0.34, z);
      g.add(bench);
    }
    for (const sx of [-0.55, 0.55]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.7), toonMat(COLORS.woodDark, { flatShading: true }));
      leg.position.set(sx, 0.3, 0);
      g.add(leg);
    }
    // (Parasol removed per request.)
    g.traverse((c) => (c.castShadow = true));
  }

  // --- Shelf slots -------------------------------------------------------
  _buildShelfSlots(count) {
    this.slotPositions = [];
    const w = this._shelfWidth;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = -w / 2 + t * w;
      // Two rows if more than 3 slots.
      let z = this._shelfZ;
      let yOff = 0;
      let xPos = x;
      if (count > 3) {
        const row = i < Math.ceil(count / 2) ? 0 : 1;
        const perRow = Math.ceil(count / 2);
        const idxInRow = i % perRow;
        const tt = perRow === 1 ? 0.5 : idxInRow / (perRow - 1);
        xPos = -w / 2 + tt * w;
        // Keep the front row on the counter top (it must not poke past the
        // front lip) and push the back row inward, with enough separation that
        // the baskets/crates never overlap one another.
        z = this._shelfZ + (row === 0 ? 0.0 : -0.4);
        yOff = 0;
      }
      const pos = new THREE.Vector3(xPos, this._shelfTopY + 0.05 + yOff, z);
      this.slotPositions.push(pos);
    }
  }

  _makeItemMesh(type) {
    const mesh = makeItem(type);
    mesh.scale.setScalar(0.95);
    mesh.traverse((c) => (c.castShadow = true));
    return mesh;
  }

  // A small pile of the item (1..3) so a bigger stock looks fuller.
  _pileItems(g, type, count, topY) {
    const n = Math.min(3, Math.max(1, count));
    const offs = [
      [0, 0],
      [-0.05, 0.04],
      [0.05, -0.03],
    ];
    for (let i = 0; i < n; i++) {
      const it = makeItem(type);
      it.scale.setScalar(0.42);
      it.position.set(offs[i][0], topY + i * 0.012, offs[i][1]);
      g.add(it);
    }
  }

  _makeBasketMesh(type, count) {
    const mode = gameState.shelfDisplayMode ? gameState.shelfDisplayMode() : 'basket';
    const g = new THREE.Group();

    if (mode === 'crate') {
      // Level 2: a tidy wooden CRATE — solid body with proud corner posts and
      // banding so no faces sit coplanar (avoids z-fighting shimmer).
      const wood = toonMat(0xcaa06e, { flatShading: true });
      const dark = toonMat(0x8b5e3c, { flatShading: true });
      // Solid body.
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.26), wood);
      body.position.y = 0.12;
      g.add(body);
      // Corner posts clearly proud of the body faces.
      for (const sx of [-0.155, 0.155]) {
        for (const sz of [-0.135, 0.135]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.24, 0.04), dark);
          post.position.set(sx, 0.12, sz);
          g.add(post);
        }
      }
      // Front & back banding rails, raised off the body surface.
      for (const sz of [-0.155, 0.155]) {
        for (const sy of [0.07, 0.17]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.02), dark);
          rail.position.set(0, sy, sz);
          g.add(rail);
        }
      }
      this._pileItems(g, type, count, 0.25);
    } else {
      // Level 1: a cute round woven BASKET (small footprint).
      const tan = toonMat(0xddab68, { flatShading: true });
      const tanD = toonMat(0xb9844a, { flatShading: true });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.11, 0.15, 12), tan);
      body.position.y = 0.075;
      g.add(body);
      for (const ry of [0.035, 0.1]) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.025, 12), tanD);
        ring.position.y = ry;
        g.add(ring);
      }
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.024, 6, 16), tanD);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.15;
      g.add(rim);
      this._pileItems(g, type, count, 0.16);
    }

    g.userData.count = count;
    g.traverse((c) => (c.castShadow = true));
    return g;
  }

  // Sync displayed item meshes with gameState.shelf.
  refreshShelf() {
    if (gameState.shelfDisplayMode && gameState.shelfDisplayMode() !== 'single') {
      this._refreshBasketShelf();
      return;
    }
    // Remove extras.
    while (this.shelfItems.length > gameState.shelf.length) {
      const it = this.shelfItems.pop();
      disposeObject(it.mesh);
    }
    // Update / add.
    for (let i = 0; i < gameState.shelf.length; i++) {
      const type = gameState.shelf[i];
      const pos = this.slotPositions[i] || this.slotPositions[this.slotPositions.length - 1];
      if (this.shelfItems[i] && this.shelfItems[i].type === type) {
        // ok
      } else {
        if (this.shelfItems[i]) disposeObject(this.shelfItems[i].mesh);
        const mesh = this._makeItemMesh(type);
        this.group.add(mesh);
        this.shelfItems[i] = { mesh, type, t: Math.random() * Math.PI * 2 };
      }
      this.shelfItems[i].mesh.position.set(pos.x, pos.y, pos.z);
    }
  }

  _refreshBasketShelf() {
    const counts = gameState.stockCounts();
    const entries = gameState.availableItems.filter((type) => counts[type] > 0).map((type) => ({ type, count: counts[type] }));
    while (this.shelfItems.length > entries.length) {
      const it = this.shelfItems.pop();
      disposeObject(it.mesh);
    }
    for (let i = 0; i < entries.length; i++) {
      const { type, count } = entries[i];
      const pos = this.slotPositions[i] || this.slotPositions[this.slotPositions.length - 1];
      const cur = this.shelfItems[i];
      if (!cur || cur.type !== type || cur.count !== count || !cur.basket) {
        if (cur) disposeObject(cur.mesh);
        const mesh = this._makeBasketMesh(type, count);
        this.group.add(mesh);
        this.shelfItems[i] = { mesh, type, count, basket: true, t: Math.random() * Math.PI * 2 };
      }
      this.shelfItems[i].mesh.position.set(pos.x, pos.y + 0.02, pos.z);
    }
  }

  update(dt, elapsed) {
    // Gentle bob on shelf items.
    for (let i = 0; i < this.shelfItems.length; i++) {
      const it = this.shelfItems[i];
      const pos = this.slotPositions[i] || this.slotPositions[this.slotPositions.length - 1];
      if (!pos) continue;
      // Baskets/crates stay planted; only loose single items gently bob.
      if (it.basket) {
        it.mesh.position.y = pos.y + 0.02;
      } else {
        it.mesh.position.y = pos.y + Math.sin(elapsed * 2 + i) * 0.02;
      }
    }
  }

  reset() {
    this.build(1);
  }
}
