// Island.js — procedural island, water, trees and shore nodes. Owns harvest
// nodes and exposes their meshes for raycasting from main.js.
import * as THREE from 'three';
import { toonMat, makeItem, disposeObject } from './toon.js';
import { gameState, STAGES } from './GameState.js';

const COLORS = {
  grass: 0x7ec850,
  grassDark: 0x6cb344,
  sand: 0xfbe6a3,
  water: 0xa8d8ea,
  trunk: 0x8b5e3c,
  leaf: 0x4fae5a,
  leafLight: 0x6fc56a,
  palmTrunk: 0xc49a6c,
  palmLeaf: 0x5fb85a,
};

export class Island {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Harvest nodes: { mesh(group), type, ready, timer, interval, readyMesh, basePos }
    this.nodes = [];
    this.shoreNodes = [];
    this.shoreActive = false;
    this.shoreTimer = 0;

    // Second island & misc feature refs (built on demand via applyUnlocks).
    this.island2 = null;
    this.island2GrassY = 0.64;
    this.bridgeGroup = null;
    this.fountain = null;
    this._enabledFeatures = new Set();
    this._cloudCovers = {};
    this._mistTexture = null;

    this._water = null;
    this._buildWater();
    this._buildIsland();
    this._buildOakTrees();
    this._buildPalmTrees();
    this._buildShoreAnchors();
    this._buildCloudCovers();

    // Feature registry — add a map feature by registering a builder here and
    // listing its id in a stage's `unlocks` (GameState STAGES).
    this._featureBuilders = {
      palms: () => this._enablePalms(),
      shore: () => this._enableShore(),
      island2: () => this._buildIsland2(),
      bridge: () => this._buildBridge(),
      pond: () => this._buildPond(),
      flowerbeds: () => this._buildFlowerbeds(),
      fountain: () => this._buildFountain(),
      beehives: () => this._buildBeehives(),
      stonepath: () => this._buildStonePath(),
      upperIsland: () => this._buildUpperIsland(),
      lowerIsland: () => this._buildLowerIsland(),
    };
    // Facility stations (world positions + hit meshes), built at Stage 5.
    this.facilityStations = {}; // id -> { pos: Vector3, hit: Mesh }
  }

  // Enable every feature a stage unlocks (idempotent).
  applyUnlocks(stage) {
    const cfg = STAGES[stage];
    if (!cfg || !cfg.unlocks) return;
    for (const f of cfg.unlocks) {
      if (this._enabledFeatures.has(f)) continue;
      const fn = this._featureBuilders[f];
      if (fn) {
        fn();
        this._enabledFeatures.add(f);
      }
    }
  }

  // Apply all unlocks up to and including a stage (used on replay/jumps).
  applyAllUnlocksUpTo(stage) {
    for (let s = 1; s <= stage; s++) this.applyUnlocks(s);
  }

  // --- Water plane with inline GLSL wave ---------------------------------
  _buildWater() {
    const geo = new THREE.PlaneGeometry(90, 90, 80, 80);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.water,
      flatShading: true,
      transparent: true,
      opacity: 0.96,
      metalness: 0.0,
      roughness: 0.75,
    });
    // Inject a subtle vertex wave (amplitude 0.05, period ~3s).
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      this._waterUniforms = shader.uniforms;
      shader.vertexShader =
        'uniform float uTime;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float w = sin((position.x * 0.6 + uTime * 2.094)) * 0.05
                   + cos((position.z * 0.7 + uTime * 2.094)) * 0.05;
           transformed.y += w;`
        );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -0.15;
    mesh.receiveShadow = true;
    this._water = mesh;
    this.group.add(mesh);
  }

  // Warp a disc/cylinder's cross-section by angle for an organic, non-circular
  // coastline. The same deterministic factor is used for shadow/sand/grass so
  // their irregular outlines stay concentric.
  _warpCoast(geo, opts = {}) {
    const amp = opts.amp ?? 0.13;
    const ph = opts.phase ?? 0;
    const fr = opts.freqs ?? [3, 5, 7, 2];
    const pos = geo.attributes && geo.attributes.position;
    if (!pos || !pos.count) return; // safe no-op (e.g. in tests)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 1e-4) continue;
      const a = Math.atan2(z, x);
      const f =
        1 +
        amp * Math.sin(fr[0] * a + 0.6 + ph) +
        amp * 0.6 * Math.sin(fr[1] * a + 1.7 + ph) +
        amp * 0.45 * Math.sin(fr[2] * a + 3.1 + ph) +
        amp * 0.3 * Math.sin(fr[3] * a - 0.9 + ph);
      pos.setX(i, x * f);
      pos.setZ(i, z * f);
    }
    pos.needsUpdate = true;
    if (geo.computeVertexNormals) geo.computeVertexNormals();
  }

  // A handful of rounded pebbles for sand detail.
  _scatterPebbles(group, count, minR, maxR, scaleZ, y) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = minR + Math.random() * (maxR - minR);
      const peb = new THREE.Mesh(
        new THREE.SphereGeometry(0.12 + Math.random() * 0.1, 7, 6),
        toonMat(0xc9c0b2, { flatShading: true })
      );
      peb.scale.set(1, 0.5, 1);
      peb.position.set(Math.cos(a) * r, y, Math.sin(a) * r * scaleZ);
      peb.castShadow = true;
      group.add(peb);
    }
  }

  // --- Island landmass (grass core + sand ring + drop shadow) ------------
  _buildIsland() {
    // Bounds (world units).
    this.sandRadius = 8.5;
    this.grassRadius = 6.6;
    this.coastScaleZ = 0.78;

    // Drop shadow disc baked as a flat translucent plane.
    const shadowGeo = new THREE.CircleGeometry(9.1, 64);
    shadowGeo.rotateX(-Math.PI / 2);
    this._warpCoast(shadowGeo);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x274a3a,
      transparent: true,
      opacity: 0.22,
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.scale.set(1, 1, this.coastScaleZ);
    shadow.position.y = -0.13;
    this.group.add(shadow);

    const warp = { amp: 0.13, phase: 0, freqs: [3, 5, 7, 2] };

    // Sand ring — FLAT top at y≈0.5 (organic outline, smooth high-seg rim).
    const sandGeo = new THREE.CylinderGeometry(8.3, this.sandRadius, 1.0, 72);
    this._warpCoast(sandGeo, warp);
    const sand = new THREE.Mesh(sandGeo, toonMat(COLORS.sand, { flatShading: true }));
    sand.scale.set(1, 1, this.coastScaleZ);
    sand.position.y = 0.0;
    sand.receiveShadow = true;
    sand.castShadow = true;
    this.group.add(sand);

    // Grass core — FLAT top at y≈0.645 (the surface everything stands on).
    const grassGeo = new THREE.CylinderGeometry(6.45, this.grassRadius, 1.05, 72);
    this._warpCoast(grassGeo, warp);
    const grass = new THREE.Mesh(grassGeo, toonMat(COLORS.grass, { flatShading: true }));
    grass.scale.set(1, 1, this.coastScaleZ);
    grass.position.y = 0.12;
    grass.receiveShadow = true;
    grass.castShadow = true;
    this.group.add(grass);

    // Pebbles resting ON the sand, well inside the coastline (not over water).
    this._scatterPebbles(this.group, 9, 5.6, 6.9, this.coastScaleZ, 0.5);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.4;
      const r = 3.2 + Math.random() * 1.8;
      const tuft = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.38, 6),
        toonMat(COLORS.grassDark, { flatShading: true })
      );
      tuft.position.set(Math.cos(a) * r, 0.7, Math.sin(a) * r * this.coastScaleZ);
      tuft.castShadow = true;
      this.group.add(tuft);
    }
  }

  _grassY() {
    return 0.64; // top surface of grass core
  }

  // --- Camera auto-framing helpers --------------------------------------
  // Points around the coastline used to fill the viewport vertically.
  getVerticalFillPoints() {
    const pts = [];
    const r = this.sandRadius;
    const sz = this.coastScaleZ;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0.5, Math.sin(a) * r * sz));
    }
    return pts;
  }

  // Important objects that must always stay on-screen (trees + shore items).
  getKeyPoints() {
    const pts = [];
    const top = this._grassY();
    for (const [x, z] of this._treeSpots || []) pts.push(new THREE.Vector3(x, top + 2.4, z));
    for (const [x, z] of this.shoreSpots || []) pts.push(new THREE.Vector3(x, 0.3, z));
    return pts;
  }

  // --- Oak trees (3) -> acorns -------------------------------------------
  _buildOakTrees() {
    // Out near the grass edge, in the back/side so they sit well away from the
    // store and clear of the central front path the customers walk in on.
    // Oaks spread wider apart so the palms behind them stay visible.
    const spots = [
      [-5.5, -2.0],
      [5.5, -2.0],
      [0, -4.6],
    ];
    this._treeSpots = spots.slice();
    for (const [x, z] of spots) {
      const tree = this._makeOak();
      tree.position.set(x, this._grassY(), z);
      this.group.add(tree);
      this._registerNode(tree, 'acorn', 8, 0xffd700);
    }
  }

  _makeOak() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 0.9, 7),
      toonMat(COLORS.trunk, { flatShading: true })
    );
    trunk.position.y = 0.45;
    trunk.castShadow = true;
    g.add(trunk);

    // Rounded blocky canopy from a few spheres.
    const canopyMat = toonMat(COLORS.leaf, { flatShading: true });
    const canopyMatL = toonMat(COLORS.leafLight, { flatShading: true });
    const blobs = [
      [0, 1.15, 0, 0.62, canopyMat],
      [0.34, 1.0, 0.1, 0.42, canopyMatL],
      [-0.32, 1.05, -0.08, 0.4, canopyMatL],
      [0.05, 1.4, -0.05, 0.4, canopyMat],
    ];
    for (const [bx, by, bz, r, m] of blobs) {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), m);
      blob.position.set(bx, by, bz);
      blob.castShadow = true;
      g.add(blob);
    }
    return g;
  }

  // --- Palm trees (2, appear stage 2) -> bananas -------------------------
  _buildPalmTrees() {
    // Up at the back, onto the sand ring, so they rise above the store.
    const spots = [
      [-4.6, -4.2],
      [2.6, -5.4],
    ];
    this._treeSpots = (this._treeSpots || []).concat(spots);
    this.palmGroup = new THREE.Group();
    this.palmGroup.visible = false;
    this.group.add(this.palmGroup);

    for (const [x, z] of spots) {
      const palm = this._makePalm();
      palm.position.set(x, this._grassY(), z);
      this.palmGroup.add(palm);
      this._registerNode(palm, 'banana', 10, 0xffd23f, /*disabled=*/ true);
    }
  }

  _makePalm() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 1.3, 7),
      toonMat(COLORS.palmTrunk, { flatShading: true })
    );
    trunk.position.y = 0.65;
    trunk.rotation.z = 0.12;
    trunk.castShadow = true;
    g.add(trunk);

    // Fronds: flat, wide blades radiating from the crown with the BROAD face
    // up/outward, each drooping slightly at the tip.
    const leafMat = toonMat(COLORS.palmLeaf, { flatShading: true });
    const crownY = 1.3;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.position.set(0, crownY, 0);
      pivot.rotation.y = a;
      // thin in Y (so the broad face points up/out), long in X, wide in Z.
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.06, 0.36), leafMat);
      leaf.position.set(0.55, -0.04, 0); // reach outward from the crown
      leaf.rotation.z = -0.32; // droop the outer tip down
      leaf.castShadow = true;
      // a slim center rib for a little detail
      const rib = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.08, 0.05), toonMat(0x4a9a4f, { flatShading: true }));
      rib.position.copy(leaf.position);
      rib.rotation.z = leaf.rotation.z;
      pivot.add(leaf, rib);
      g.add(pivot);
    }
    // Crown hub hiding the frond bases.
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), leafMat);
    crown.position.y = crownY;
    crown.castShadow = true;
    g.add(crown);
    // Banana cluster hint near the top.
    const banana = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 6, 5),
      toonMat(0xffd23f, { flatShading: true })
    );
    banana.position.set(0, 1.18, 0.18);
    g.add(banana);
    return g;
  }

  _buildShoreAnchors() {
    // Positions on the sand ring where fish/shells appear in stage 3.
    // On the front sand ring (toward the camera), spread across the front and
    // clear of the trees, so fish/shells are clearly visible.
    this.shoreSpots = [
      [4.8, 5.5],
      [-4.8, 5.5],
      [6.8, 2.5],
      [-6.8, 2.5],
    ];
  }

  // Register a harvestable node with a "ready" indicator that is an actual
  // item model floating above it (not a generic ball).
  _registerNode(group, type, interval, indicatorColor, disabled = false, base = true) {
    const ready = new THREE.Group();
    const item = makeItem(type); // 'acorn' or 'banana'
    item.scale.setScalar(1.25);
    item.traverse((c) => (c.castShadow = true));
    ready.add(item);
    // A soft glow disc behind it to read as "ready to collect".
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0.28 })
    );
    ready.add(glow);
    ready.position.set(0, 1.7, 0);
    ready.visible = false;
    group.add(ready);

    // Invisible larger hit target for easy tapping.
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 6, 5),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(0, 1.1, 0);
    group.add(hit);

    const node = {
      group,
      type,
      interval,
      timer: disabled ? 0 : interval,
      ready: false,
      readyMesh: ready,
      hit,
      disabled,
      base, // base nodes (oak/palm) survive reset; feature nodes are rebuilt
      worldPos: new THREE.Vector3(),
    };
    hit.userData.node = node;
    ready.userData.node = node;
    this.nodes.push(node);
  }

  _enablePalms() {
    this.palmGroup.visible = true;
    for (const n of this.nodes) {
      if (n.type === 'banana' && n.disabled) {
        n.disabled = false;
        n.timer = n.interval;
      }
    }
  }

  _enableShore() {
    this._clearCloudCover('shore');
    this.shoreActive = true;
    this._spawnShoreItem();
    this._spawnShoreItem();
    this.shoreTimer = 12;
  }

  // --- Locked-region cloud covers ---------------------------------------
  _getMistTexture() {
    if (this._mistTexture) return this._mistTexture;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0.0, 'rgba(255,255,255,0.96)');
    grad.addColorStop(0.56, 'rgba(255,255,255,0.82)');
    grad.addColorStop(0.84, 'rgba(255,255,255,0.42)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    this._mistTexture = new THREE.CanvasTexture(canvas);
    this._mistTexture.needsUpdate = true;
    this._mistTexture.minFilter = THREE.LinearFilter;
    this._mistTexture.magFilter = THREE.LinearFilter;
    return this._mistTexture;
  }

  _makeCloudCover(key, x, z, radiusX, radiusZ, _count, y = 1.25) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.userData.baseY = y;
    g.userData.phase = Math.random() * Math.PI * 2;
    const mistMat = new THREE.MeshBasicMaterial({
      color: 0xf8fbff,
      map: this._getMistTexture(),
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mist = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mistMat);
    mist.userData.mistPlane = true;
    mist.rotation.x = -Math.PI / 2;
    mist.scale.set(radiusX * 1.18, radiusZ * 1.18, 1);
    mist.position.y = y - 0.28;
    g.add(mist);
    const mist2 = mist.clone();
    mist2.userData.mistPlane = true;
    mist2.material = mistMat.clone();
    mist2.material.opacity = 0.82;
    mist2.scale.set(radiusX * 1.55, radiusZ * 1.48, 1);
    mist2.position.y = y - 0.38;
    mist2.rotation.z = 0.35;
    g.add(mist2);
    this.group.add(g);
    this._cloudCovers[key] = g;
    return g;
  }

  _buildCloudCovers() {
    this._clearAllCloudCovers();
    return; // Fog covers disabled for now.
    // Permanent far-water haze: any area outside the currently playable
    // islands stays softly hidden instead of showing empty ocean.
    this._makeCloudCover('outerWest', -22, 0, 8.5, 28, 18, 1.0);
    this._makeCloudCover('outerEast', 35, 0, 7.5, 28, 18, 1.0);
    this._makeCloudCover('outerNorth', 0, -35, 26, 8.0, 18, 1.0);
    this._makeCloudCover('outerSouth', 0, 32, 26, 8.0, 18, 1.0);
    // Top water just beyond the open main island; removed once the upper
    // production island opens.
    this._makeCloudCover('northWater', 0, -10.2, 9.6, 1.15, 10, 1.0);
    // Beach/near-water collectibles are hidden until Stage 3.
    this._makeCloudCover('shore', 0, 8.2, 9.0, 1.1, 13, 1.05);
    // Future right-side garden island is hidden until Stage 4.
    this._makeCloudCover('island2', 16.5, 0, 5.0, 5.4, 17, 1.35);
    // Future production islands and surrounding water are hidden until Stage 5.
    this._makeCloudCover('upperIsland', 0, -18, 9.6, 7.2, 17, 1.25);
    this._makeCloudCover('lowerIsland', 0, 16, 7.2, 5.7, 14, 1.12);
  }

  _clearCloudCover(key) {
    const g = this._cloudCovers[key];
    if (!g) return;
    disposeObject(g);
    delete this._cloudCovers[key];
  }

  _clearAllCloudCovers() {
    for (const key of Object.keys(this._cloudCovers || {})) this._clearCloudCover(key);
  }

  // --- Second island & garden features (Stage 4+) -----------------------
  // Distinct from the main island: rounder (csz ~0.92), with a different
  // organic coastline (warp phase/freqs) and a domed, chunky top.
  _buildIsland2() {
    if (this.island2) return;
    this._clearCloudCover('island2');
    const g = new THREE.Group();
    g.position.set(15.0, 0, 0); // closer to the main island
    this.island2 = g;
    this.group.add(g);
    const csz = 0.92;
    const warp2 = { amp: 0.16, phase: 2.1, freqs: [2, 4, 5, 3] };

    const shadowGeo = new THREE.CircleGeometry(5.9, 56);
    shadowGeo.rotateX(-Math.PI / 2);
    this._warpCoast(shadowGeo, warp2);
    const shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: 0x274a3a, transparent: true, opacity: 0.22 }));
    shadow.scale.set(1, 1, csz);
    shadow.position.y = -0.13;
    g.add(shadow);

    const sandGeo = new THREE.CylinderGeometry(5.3, 5.4, 1.0, 64);
    this._warpCoast(sandGeo, warp2);
    const sand = new THREE.Mesh(sandGeo, toonMat(COLORS.sand, { flatShading: true }));
    sand.scale.set(1, 1, csz);
    sand.position.y = 0.0;
    sand.receiveShadow = true;
    sand.castShadow = true;
    g.add(sand);

    const grassGeo = new THREE.CylinderGeometry(4.05, 4.1, 1.05, 64);
    this._warpCoast(grassGeo, warp2);
    const grass = new THREE.Mesh(grassGeo, toonMat(COLORS.grass, { flatShading: true }));
    grass.scale.set(1, 1, csz);
    grass.position.y = 0.12;
    grass.receiveShadow = true;
    grass.castShadow = true;
    g.add(grass);

    this._scatterPebbles(g, 6, 3.6, 4.2, csz, 0.5);
  }

  _buildBridge() {
    const g = new THREE.Group();
    this.group.add(g);
    this.bridgeGroup = g;
    const x0 = 9.0; // main-island edge
    const x1 = 12.2; // second-island edge
    const n = 8;
    for (let i = 0; i < n; i++) {
      const x = x0 + (i / (n - 1)) * (x1 - x0);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 1.5), toonMat(COLORS.palmTrunk, { flatShading: true }));
      plank.position.set(x, 0.6, 0); // raised to the island-edge height
      plank.castShadow = true;
      g.add(plank);
    }
    for (const z of [-0.75, 0.75]) {
      for (const x of [x0, (x0 + x1) / 2, x1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 5), toonMat(COLORS.trunk, { flatShading: true }));
        post.position.set(x, 0.84, z);
        post.castShadow = true;
        g.add(post);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.06, 0.06), toonMat(COLORS.trunk, { flatShading: true }));
      rail.position.set((x0 + x1) / 2, 1.08, z);
      g.add(rail);
    }
    // Short support legs down to the water so the raised deck reads naturally.
    for (const x of [x0 + 0.3, x1 - 0.3]) {
      for (const z of [-0.6, 0.6]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 5), toonMat(COLORS.trunk, { flatShading: true }));
        leg.position.set(x, 0.2, z);
        g.add(leg);
      }
    }
  }

  _buildPond() {
    this._buildIsland2();
    const pond = new THREE.Mesh(
      new THREE.CircleGeometry(1.3, 24),
      new THREE.MeshStandardMaterial({ color: 0x5fb6e0, transparent: true, opacity: 0.9, roughness: 0.5 })
    );
    pond.rotation.x = -Math.PI / 2;
    pond.scale.set(1.3, 1, 0.9);
    pond.position.set(-1.8, 0.67, 1.6);
    this.island2.add(pond);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const stone = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), toonMat(0xb9b0a4, { flatShading: true }));
      stone.position.set(-1.8 + Math.cos(a) * 1.7, 0.66, 1.6 + Math.sin(a) * 1.25);
      stone.scale.y = 0.6;
      this.island2.add(stone);
    }
  }

  _buildFlowerbeds() {
    this._buildIsland2();
    // Two HARVESTABLE flower spots (planted straight on the grass — no dirt).
    const nodeSpots = [[1.8, -1.2], [1.6, 1.6]];
    for (const [x, z] of nodeSpots) {
      const bed = new THREE.Group();
      bed.position.set(x, this.island2GrassY, z);
      this.island2.add(bed);
      for (let i = 0; i < 3; i++) {
        const f = makeItem('flower'); // pink harvestable bloom
        f.scale.setScalar(0.8);
        f.position.set((i - 1) * 0.22, 0, (i % 2) * 0.12 - 0.06);
        f.traverse((c) => (c.castShadow = true));
        bed.add(f);
      }
      this._registerNode(bed, 'flower', 9, 0xff7eb6, false, false);
    }
    // Decorative pastel flowers filling the rest of the grass.
    this._scatterFlowers(nodeSpots);

    const garden = new THREE.Group();
    garden.position.set(3.0, this.island2GrassY, -0.2);
    this.island2.add(garden);
    for (const x of [-0.55, 0.55]) {
      const fence = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.95), toonMat(0xc49a6c, { flatShading: true }));
      fence.position.set(x, 0.14, 0);
      fence.castShadow = true;
      garden.add(fence);
    }
    for (const z of [-0.42, 0.42]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.08), toonMat(0x8b5e3c, { flatShading: true }));
      rail.position.set(0, 0.28, z);
      rail.castShadow = true;
      garden.add(rail);
    }
    for (let i = 0; i < 5; i++) {
      const f = this._makeDecoFlower(i % 2 ? 0xffb6d5 : 0xffe9a3);
      f.position.set(-0.38 + (i % 3) * 0.38, 0, -0.2 + Math.floor(i / 3) * 0.35);
      f.scale.setScalar(0.78);
      garden.add(f);
    }
    const can = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.18), toonMat(0x9fd3e8, { flatShading: true }));
    can.position.set(0.72, 0.14, 0.32);
    can.castShadow = true;
    garden.add(can);
    this._addFacilityStation(this.island2, 'flowerGarden', 2.35, this.island2GrassY, 0.75);
  }

  // Pastel decorative flowers (pink / yellow / sky-blue) scattered on the grass.
  _makeDecoFlower(color) {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 5), toonMat(0x5fb85a, { flatShading: true }));
    stem.position.y = 0.1;
    g.add(stem);
    const petalMat = toonMat(color, { flatShading: true });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), petalMat);
      p.scale.set(1, 0.5, 0.75);
      p.position.set(Math.cos(a) * 0.08, 0.24, Math.sin(a) * 0.08);
      g.add(p);
    }
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), toonMat(0xfff0b0, { flatShading: true }));
    c.position.y = 0.25;
    g.add(c);
    g.traverse((o) => (o.castShadow = true));
    return g;
  }

  _scatterFlowers(nodeSpots) {
    const colors = [0xffb6d5, 0xffe9a3, 0xb8e0f5]; // pastel pink / yellow / sky-blue
    const csz = 0.92;
    // Keep clear of the apiary, beehive and the 2 harvestable spots.
    const avoid = [[-1.4, 1.3, 1.7], [-1.9, -1.5, 1.0]];
    for (const [x, z] of nodeSpots) avoid.push([x, z, 0.7]);
    let placed = 0;
    let tries = 0;
    while (placed < 30 && tries < 500) {
      tries++;
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 3.0;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r * csz;
      if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
      const f = this._makeDecoFlower(colors[placed % colors.length]);
      f.position.set(x, this.island2GrassY, z);
      f.scale.setScalar(0.55 + Math.random() * 0.3);
      f.rotation.y = Math.random() * Math.PI * 2;
      this.island2.add(f);
      placed++;
    }
  }

  _buildBeehives() {
    this._buildIsland2();
    // Single beehive, back-left, clear of the fountain and flower beds.
    const spots = [[-1.9, -1.5]];
    for (const [x, z] of spots) {
      const hive = new THREE.Group();
      hive.position.set(x, this.island2GrassY, z);
      this.island2.add(hive);
      for (let i = 0; i < 3; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.32 - 0.02 * i, 0.34 - 0.02 * i, 0.18, 10), toonMat(i % 2 ? 0xf2c14a : 0xe0a838, { flatShading: true }));
        seg.position.y = 0.1 + i * 0.18;
        seg.castShadow = true;
        hive.add(seg);
      }
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.36, 0.2, 10), toonMat(0xcf8420, { flatShading: true }));
      top.position.y = 0.1 + 3 * 0.18;
      hive.add(top);
      this._registerNode(hive, 'honey', 11, 0xf2a83a, false, false);
    }
    const apiary = new THREE.Group();
    apiary.position.set(-2.25, this.island2GrassY, 2.25);
    this.island2.add(apiary);
    this.apiaryBees = [];
    const boxMat = toonMat(0xe0a838, { flatShading: true });
    const trimMat = toonMat(0x8b5e3c, { flatShading: true });
    const hiveBox = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.65), boxMat);
    hiveBox.position.y = 0.32;
    hiveBox.castShadow = true;
    apiary.add(hiveBox);
    for (let i = 0; i < 3; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.05, 0.68), trimMat);
      stripe.position.y = 0.16 + i * 0.16;
      apiary.add(stripe);
    }
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.05), toonMat(0x5b3a20, { flatShading: true }));
    slot.position.set(0, 0.32, 0.35);
    apiary.add(slot);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.1, 0.76), trimMat);
    roof.position.y = 0.64;
    roof.castShadow = true;
    apiary.add(roof);
    for (let i = 0; i < 5; i++) {
      const bee = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), toonMat(0xf2c14a, { flatShading: true }));
      body.scale.set(1.25, 0.8, 0.8);
      bee.add(body);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.055, 0.055), toonMat(0x5b3a20, { flatShading: true }));
      stripe.position.x = 0.02;
      bee.add(stripe);
      const wingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65, depthWrite: false });
      for (const sx of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), wingMat);
        wing.scale.set(0.8, 0.18, 0.55);
        wing.position.set(0, 0.035, sx * 0.04);
        bee.add(wing);
      }
      bee.userData = { phase: i * 1.35, radius: 0.58 + (i % 2) * 0.22, speed: 0.8 + i * 0.08 };
      apiary.add(bee);
      this.apiaryBees.push(bee);
    }
    this._addFacilityStation(this.island2, 'honeyApiary', -0.4, this.island2GrassY, 2.95);
  }

  _buildFountain() {
    // Fountain removed by design; this feature id remains as a no-op so old
    // saves and stage unlock data stay compatible.
    this._buildIsland2();
  }

  // Stage 5: a cobbled stone walkway (rounded stepping-stone tiles).
  _buildStonePath() {
    const matA = toonMat(0xbfb8ac, { flatShading: true });
    const matB = toonMat(0xa8a094, { flatShading: true });
    this._stonePathGroup = new THREE.Group();
    this.group.add(this._stonePathGroup);

    // Main island: sparse stepping stones up the customer corridor.
    const mainPts = [];
    for (let z = 4.6; z >= 1.0; z -= 1.15) mainPts.push([Math.sin(z * 0.7) * 0.45, z]);
    this._layStones(this._stonePathGroup, mainPts, 0.72, matA, matB);

    // Second island: a couple of stones leading in to the apiary.
    if (this.island2) {
      const ip = [];
      for (let z = 3.3; z >= 1.4; z -= 1.0) ip.push([-1.4 + (z - 1.4) * 0.15, z]);
      this._layStones(this.island2, ip, this.island2GrassY + 0.08, matA, matB);
    }
  }

  _layStones(parent, pts, y, matA, matB) {
    pts.forEach(([x, z], i) => {
      const r = 0.3 + Math.random() * 0.07;
      const stone = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.08, 7), i % 2 ? matA : matB);
      stone.position.set(x, y, z); // lifted clear of the ground (no z-fighting)
      stone.rotation.y = Math.random() * Math.PI;
      stone.scale.set(1.05, 1, 0.85); // slightly oval, flat tile
      stone.receiveShadow = true;
      parent.add(stone);
    });
  }

  // --- Stage 5: upper & lower production islands ------------------------------
  // Generic landmass (sand + grass) into a group.
  _landmass(group, sandR, grassR, csz, warp) {
    const sandGeo = new THREE.CylinderGeometry(sandR - 0.2, sandR, 1.0, 56);
    this._warpCoast(sandGeo, warp);
    const sand = new THREE.Mesh(sandGeo, toonMat(COLORS.sand, { flatShading: true }));
    sand.scale.set(1, 1, csz);
    sand.receiveShadow = true;
    sand.castShadow = true;
    group.add(sand);
    const grassGeo = new THREE.CylinderGeometry(grassR - 0.2, grassR, 1.05, 56);
    this._warpCoast(grassGeo, warp);
    const grass = new THREE.Mesh(grassGeo, toonMat(COLORS.grass, { flatShading: true }));
    grass.scale.set(1, 1, csz);
    grass.position.y = 0.12;
    grass.receiveShadow = true;
    group.add(grass);
  }

  // A plank bridge running along Z (connects main island to upper/lower).
  _buildZBridge(x, z0, z1) {
    const g = new THREE.Group();
    this.group.add(g);
    const n = Math.max(4, Math.round(Math.abs(z1 - z0) / 0.42));
    for (let i = 0; i < n; i++) {
      const z = z0 + (i / (n - 1)) * (z1 - z0);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.46), toonMat(COLORS.palmTrunk, { flatShading: true }));
      plank.position.set(x, 0.6, z);
      plank.castShadow = true;
      g.add(plank);
    }
    for (const sx of [-0.75, 0.75]) {
      for (const z of [z0, (z0 + z1) / 2, z1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 5), toonMat(COLORS.trunk, { flatShading: true }));
        post.position.set(x + sx, 0.84, z);
        g.add(post);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, Math.abs(z1 - z0)), toonMat(COLORS.trunk, { flatShading: true }));
      rail.position.set(x + sx, 1.08, (z0 + z1) / 2);
      g.add(rail);
    }
    return g;
  }

  // Register a facility station: an invisible hit target (for tapping) + record
  // its world position (for the worker + production feedback).
  _addFacilityStation(group, id, lx, ly, lz) {
    const hit = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(lx, ly + 0.8, lz);
    hit.userData.facility = id;
    group.add(hit);
    const pos = new THREE.Vector3(group.position.x + lx, group.position.y + ly, group.position.z + lz);
    this.facilityStations[id] = { pos, hit };
  }

  _buildUpperIsland() {
    if (this.upperIsland) return;
    this._clearCloudCover('upperIsland');
    this._clearCloudCover('northWater');
    const g = new THREE.Group();
    g.position.set(0, 0, -18);
    this.upperIsland = g;
    this.group.add(g);
    const csz = 0.85;
    const warp = { amp: 0.12, phase: 1.1, freqs: [3, 4, 6, 2] };
    this._landmass(g, 7.0, 5.6, csz, warp);
    const gy = 0.64;

    // Bridge to the main island (main top edge ~ z -7).
    this.upperBridge = this._buildZBridge(0, -7.2, -12.0);

    // Oak trees in the centre, palm trees toward the outer (sea) edge.
    for (const [x, z] of [[-2.0, -1.2], [2.0, -1.2], [0, 0.4]]) {
      const t = this._makeOak();
      t.position.set(x, gy, z);
      t.scale.setScalar(0.9);
      g.add(t);
    }
    for (const [x, z] of [[-4.0, -2.6], [4.0, -2.6], [-3.4, 1.2], [3.4, 1.2]]) {
      const p = this._makePalm();
      p.position.set(x, gy, z);
      p.scale.setScalar(0.85);
      g.add(p);
    }
    // Facility stations: acorn (centre), banana (sea side).
    this._addFacilityStation(g, 'acornFarm', -1.2, gy, 2.0);
    this._addFacilityStation(g, 'bananaFarm', 3.0, gy, 2.4);
  }

  _buildLowerIsland() {
    if (this.lowerIsland) return;
    this._clearCloudCover('lowerIsland');
    const g = new THREE.Group();
    g.position.set(0, 0, 16);
    this.lowerIsland = g;
    this.group.add(g);
    const csz = 0.85;
    const warp = { amp: 0.14, phase: 2.6, freqs: [2, 4, 5, 3] };
    this._landmass(g, 4.2, 3.0, csz, warp); // very small
    const gy = 0.64;

    // Bridge to the main island (main bottom edge ~ z +7).
    this.lowerBridge = this._buildZBridge(0, 7.2, 12.6);

    // Left: fish farm — a very simple inverted-triangle boat silhouette.
    const boat = new THREE.Group();
    boat.position.set(-2.25, 0.18, 5.55);
    boat.rotation.y = 0.12;
    g.add(boat);
    const hullMat = toonMat(0xb5793c, { flatShading: true });
    const trimMat = toonMat(0x8b5e3c, { flatShading: true });

    const hullShape = new THREE.Shape();
    hullShape.moveTo(-1.15, 0.36);
    hullShape.lineTo(1.15, 0.36);
    hullShape.lineTo(0.72, -0.18);
    hullShape.lineTo(-0.72, -0.18);
    hullShape.lineTo(-1.15, 0.36);
    const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
      depth: 0.58,
      bevelEnabled: false,
    });
    hullGeo.center();
    hullGeo.rotateX(-Math.PI / 2);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = 0.26;
    hull.castShadow = true;
    boat.add(hull);

    const rim = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.08, 0.62), trimMat);
    rim.position.y = 0.52;
    rim.castShadow = true;
    boat.add(rim);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.48), toonMat(0xc49a6c, { flatShading: true }));
    seat.position.y = 0.62;
    seat.castShadow = true;
    boat.add(seat);

    // Worker stands on the lower/front island edge, facing down toward the
    // water so the bear's face stays visible from the isometric camera.
    this._addFacilityStation(g, 'fishFarm', -1.55, gy, 2.1);
    const fishBox = new THREE.Group();
    fishBox.position.set(-0.25, gy, 2.32);
    fishBox.rotation.y = -0.25;
    g.add(fishBox);
    const crateMat = toonMat(0xc49a6c, { flatShading: true });
    const crateDark = toonMat(0x8b5e3c, { flatShading: true });
    const crateBase = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.32, 0.52), crateMat);
    crateBase.position.y = 0.16;
    crateBase.castShadow = true;
    fishBox.add(crateBase);
    for (const z of [-0.29, 0.29]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.09, 0.05), crateDark);
      rail.position.set(0, 0.36, z);
      rail.castShadow = true;
      fishBox.add(rail);
    }
    for (const x of [-0.38, 0.38]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.52), crateDark);
      rail.position.set(x, 0.36, 0);
      rail.castShadow = true;
      fishBox.add(rail);
    }
    const fishPileMat = toonMat(0x6fc3df, { flatShading: true });
    const fishPileDark = toonMat(0x4aa0cf, { flatShading: true });
    for (let i = 0; i < 7; i++) {
      const lump = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 5), i % 2 ? fishPileMat : fishPileDark);
      lump.scale.set(1.45, 0.42, 0.62);
      lump.position.set(-0.24 + (i % 4) * 0.16, 0.46 + Math.floor(i / 4) * 0.05, -0.13 + (i % 3) * 0.12);
      lump.rotation.y = (i % 2 ? -0.5 : 0.45);
      lump.castShadow = true;
      fishBox.add(lump);
    }

    // Right: clam harvesting — otters float farther out on the water.
    this._addFacilityStation(g, 'clamFarm', 5.85, 0.05, 0.85);
  }

  // Facility hit meshes (tappable) and world positions.
  getFacilityHits() {
    return Object.values(this.facilityStations).map((s) => s.hit);
  }
  getFacilityPos(id) {
    return this.facilityStations[id] ? this.facilityStations[id].pos : null;
  }

  // Obstacle circles (world x,z,r) that workers should path around.
  getObstacles() {
    const obs = [];
    for (const s of this._treeSpots || []) obs.push({ x: s[0], z: s[1], r: 1.05 });
    // Legacy fountain obstacle (currently disabled by design).
    if (this.fountain && this.island2) {
      obs.push({
        x: this.island2.position.x + this.fountain.position.x,
        z: this.island2.position.z + this.fountain.position.z,
        r: 1.6,
      });
    }
    return obs;
  }

  // Unified list of currently-harvestable targets (for alba workers).
  getReadyTargets() {
    const out = [];
    for (const n of this.nodes) {
      if (!n.disabled && n.ready) {
        const p = new THREE.Vector3();
        n.group.getWorldPosition(p);
        out.push({ kind: 'node', ref: n, pos: p });
      }
    }
    for (const s of this.shoreNodes) {
      if (s.active && s.mesh) {
        out.push({ kind: 'shore', ref: s, pos: s.mesh.getWorldPosition(new THREE.Vector3()) });
      }
    }
    return out;
  }

  harvestTarget(t) {
    return t.kind === 'shore' ? this.harvestShore(t.ref) : this.harvestNode(t.ref);
  }

  // Return all currently tappable hit meshes.
  getHitMeshes() {
    const meshes = [];
    for (const n of this.nodes) {
      if (!n.disabled) meshes.push(n.hit);
    }
    for (const s of this.shoreNodes) {
      if (s.active) meshes.push(s.hit);
    }
    return meshes;
  }

  // Try to harvest at a node. Returns { type, worldPos } or null.
  harvestNode(node) {
    if (node.disabled || !node.ready) return null;
    node.ready = false;
    node.readyMesh.visible = false;
    node.timer = node.interval;
    node.group.getWorldPosition(node.worldPos);
    const pos = node.worldPos.clone();
    pos.y += 1.4;
    // Pop bounce kick on the ready mesh group.
    node._pop = 0.0;
    return { type: node.type, worldPos: pos };
  }

  harvestShore(shore) {
    if (!shore.active) return null;
    shore.active = false;
    shore.mesh.visible = false;
    shore.hit.visible = false;
    const pos = shore.mesh.getWorldPosition(new THREE.Vector3());
    pos.y += 0.6;
    return { type: shore.type, worldPos: pos };
  }

  _spawnShoreItem() {
    // Find a free shore node or create the hit target for a new one.
    let shore = this.shoreNodes.find((s) => !s.active);
    if (!shore) {
      if (this.shoreNodes.length >= this.shoreSpots.length) return;
      const hit = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 6, 5),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      this.group.add(hit);
      shore = { mesh: null, hit, type: 'fish', active: false, spin: 0 };
      hit.userData.shore = shore;
      this.shoreNodes.push(shore);
    }

    // Build a fresh, recognizable mesh for the chosen type (dispose any old).
    const type = Math.random() < 0.5 ? 'fish' : 'shell';
    if (shore.mesh) disposeObject(shore.mesh);
    const mesh = makeItem(type);
    mesh.scale.setScalar(1.6);
    mesh.traverse((c) => (c.castShadow = true));
    this.group.add(mesh);
    shore.mesh = mesh;
    shore.type = type;

    const spot = this.shoreSpots[this.shoreNodes.indexOf(shore) % this.shoreSpots.length];
    const y = 0.5; // sit on the sand surface (items are base-aligned)
    mesh.position.set(spot[0], y, spot[1]);
    shore.hit.position.set(spot[0], y + 0.25, spot[1]);
    mesh.visible = true;
    shore.hit.visible = true;
    shore.active = true;
  }

  update(dt, elapsed, onAutoReady) {
    // Water animation.
    if (this._waterUniforms) this._waterUniforms.uTime.value = elapsed;
    for (const cover of Object.values(this._cloudCovers)) {
      const ph = cover.userData.phase || 0;
      cover.position.y = Math.sin(elapsed * 0.75 + ph) * 0.035;
      cover.rotation.y = Math.sin(elapsed * 0.18 + ph) * 0.025;
    }
    if (this.apiaryBees) {
      for (const bee of this.apiaryBees) {
        const ph = bee.userData.phase || 0;
        const r = bee.userData.radius || 0.6;
        const t = elapsed * (bee.userData.speed || 0.9) + ph;
        bee.position.set(Math.cos(t) * r, 0.72 + Math.sin(t * 1.7) * 0.12, Math.sin(t) * r * 0.65);
        bee.rotation.y = -t + Math.PI / 2;
      }
    }

    // Harvest timers.
    for (const n of this.nodes) {
      if (n.disabled) continue;
      if (!n.ready) {
        n.timer -= dt;
        if (n.timer <= 0) {
          n.ready = true;
          n.readyMesh.visible = true;
          n._pop = 0;
        }
      }
      // Ready indicator bob + pop-in.
      if (n.ready) {
        if (n._pop < 1) n._pop = Math.min(1, n._pop + dt * 4);
        const s = 0.6 + 0.4 * this._easeOutBack(n._pop);
        n.readyMesh.scale.setScalar(s);
        n.readyMesh.position.y = 1.7 + Math.sin(elapsed * 3) * 0.06;
        n.readyMesh.rotation.y += dt * 2;
      }
    }

    // Shore spawning (stage 3).
    if (this.shoreActive) {
      this.shoreTimer -= dt;
      if (this.shoreTimer <= 0) {
        this.shoreTimer = 12;
        this._spawnShoreItem();
      }
      for (const s of this.shoreNodes) {
        if (s.active) {
          s.spin += dt;
          s.mesh.position.y = 0.5 + Math.sin(s.spin * 2.5) * 0.05;
          s.mesh.rotation.y += dt * 1.2;
        }
      }
    }
  }

  _easeOutBack(x) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  reset() {
    // Drop feature nodes (flower/honey) — their meshes live under island2 and
    // are disposed below; keep only base nodes (oak/palm).
    this.nodes = this.nodes.filter((n) => n.base);
    for (const n of this.nodes) {
      if (n.type === 'banana') {
        n.disabled = true;
        n.timer = 0;
      } else {
        n.disabled = false;
        n.timer = n.interval;
      }
      n.ready = false;
      n.readyMesh.visible = false;
    }
    this.palmGroup.visible = false;
    this.shoreActive = false;
    this.shoreTimer = 12;
    for (const s of this.shoreNodes) {
      s.active = false;
      if (s.mesh) s.mesh.visible = false;
      s.hit.visible = false;
    }

    // Tear down Stage 4/5 features so a replay starts clean.
    if (this.island2) {
      disposeObject(this.island2);
      this.island2 = null;
    }
    if (this.bridgeGroup) {
      disposeObject(this.bridgeGroup);
      this.bridgeGroup = null;
    }
    if (this._stonePathGroup) {
      disposeObject(this._stonePathGroup);
      this._stonePathGroup = null;
    }
    for (const grp of ['upperIsland', 'lowerIsland', 'upperBridge', 'lowerBridge']) {
      if (this[grp]) {
        disposeObject(this[grp]);
        this[grp] = null;
      }
    }
    this.facilityStations = {};
    this.fountain = null;
    this.apiaryBees = [];
    this._enabledFeatures.clear();
    this._buildCloudCovers();
  }
}
