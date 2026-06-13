// toon.js — shared helpers for the toon look. The gradient map is generated
// programmatically via DataTexture (no external image), satisfying the
// zero-external-assets constraint.
import * as THREE from 'three';

let _gradient = null;
export function getToonGradient() {
  if (_gradient) return _gradient;
  // 4-step ramp from dark to light.
  const colors = new Uint8Array([90, 140, 200, 255]);
  const tex = new THREE.DataTexture(colors, colors.length, 1, THREE.RedFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  _gradient = tex;
  return tex;
}

// Convenience: a toon material with the shared gradient.
// Note: MeshToonMaterial does not support `flatShading`, so we strip it out
// (callers pass it uniformly; it's a no-op for toon shading anyway).
export function toonMat(color, extra = {}) {
  const { flatShading, ...rest } = extra;
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: getToonGradient(),
    ...rest,
  });
}

// --- Shared, recognizable low-poly item meshes ------------------------------
// Built around a ~0.26-unit footprint; callers scale per use. Used by the
// store shelf and the shore collectibles so an item always looks the same.

// Each builder returns an outer group whose contents are lifted so the model
// rests on a surface (its lowest point ≈ y=0). Callers may scale/spin the
// outer group freely without the item sinking into the shelf/sand.
export function makeAcorn() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 9), toonMat(0xddb074));
  body.scale.set(1, 1.1, 1);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 8), toonMat(0xcf9a59));
  tip.position.y = -0.14;
  tip.rotation.x = Math.PI; // point downward
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.135, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.5),
    toonMat(0x7a4a24)
  );
  cap.position.y = 0.07;
  const capRim = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.12, 0.04, 12), toonMat(0x6b4020));
  capRim.position.y = 0.06;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6), toonMat(0x4a3018));
  stem.position.y = 0.16;
  inner.add(body, tip, cap, capRim, stem);
  inner.position.y = 0.2; // rest on surface
  g.add(inner);
  return g;
}

export function makeBanana() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  const banana = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.05, 8, 12, Math.PI * 1.1), toonMat(0xffd23f));
  banana.rotation.z = Math.PI * 0.95;
  inner.add(banana);
  for (const a of [0.05, Math.PI * 1.05]) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), toonMat(0x6b4f1a));
    tip.position.set(Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0);
    inner.add(tip);
  }
  inner.rotation.y = 0.3;
  inner.position.y = 0.22; // lift so the curved bunch sits above the surface
  g.add(inner);
  return g;
}

// Simple fish: body, tail, eyes only.
export function makeFish() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  const c = 0x5fb6e0;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 9), toonMat(c));
  body.scale.set(1.5, 1.0, 0.7);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.16, 4), toonMat(c));
  tail.scale.set(1, 1, 0.3);
  tail.rotation.z = -Math.PI / 2; // apex toward body, wide edge outward
  tail.position.x = -0.21;
  inner.add(body, tail);
  for (const zz of [0.06, -0.06]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), new THREE.MeshBasicMaterial({ color: 0x232323 }));
    eye.position.set(0.14, 0.03, zz);
    inner.add(eye);
  }
  inner.position.y = 0.12;
  g.add(inner);
  return g;
}

// Clearly-visible scallop: a faceted pink dome with a CLOSED bottom (so there
// is no hollow dark interior casting an odd shadow) and a hinge nub.
export function makeShell() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  const mat = toonMat(0xffc0cb);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
    mat
  );
  dome.scale.set(1.25, 0.8, 1.0); // low segments give a ridged-shell look
  inner.add(dome);
  // Flat disc cap closing the underside.
  const cap = new THREE.Mesh(new THREE.CircleGeometry(0.2, 10), mat);
  cap.rotation.x = Math.PI / 2; // lie flat, normal pointing down
  cap.scale.set(1.25, 1.0, 1.0);
  cap.position.y = 0.005;
  inner.add(cap);
  const hinge = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), toonMat(0xff9bb0));
  hinge.position.set(0, 0.04, -0.18);
  inner.add(hinge);
  g.add(inner);
  return g;
}

// Flower: stem + petals + center.
export function makeFlower() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.22, 5), toonMat(0x4fae5a));
  stem.position.y = 0.11;
  inner.add(stem);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), toonMat(0x5fc56a));
  leaf.scale.set(1.6, 0.4, 0.8);
  leaf.position.set(0.06, 0.1, 0);
  inner.add(leaf);
  const petalMat = toonMat(0xff7eb6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), petalMat);
    petal.scale.set(1, 0.45, 0.7);
    petal.position.set(Math.cos(a) * 0.09, 0.27, Math.sin(a) * 0.09);
    inner.add(petal);
  }
  const center = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), toonMat(0xffe14a));
  center.position.y = 0.28;
  inner.add(center);
  g.add(inner);
  return g;
}

// Honey: a little jar with a lid and a honey dipper.
export function makeHoney() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.26, 12), toonMat(0xf2a83a));
  jar.position.y = 0.14;
  inner.add(jar);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.06, 12), toonMat(0xb9742a));
  lid.position.y = 0.3;
  inner.add(lid);
  const shine = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), toonMat(0xffd98a));
  shine.scale.set(0.5, 1.4, 0.3);
  shine.position.set(-0.07, 0.15, 0.09);
  inner.add(shine);
  g.add(inner);
  return g;
}

// Registry: add a resource's mesh by registering its builder here.
export const ITEM_MESH = {
  acorn: makeAcorn,
  banana: makeBanana,
  fish: makeFish,
  shell: makeShell,
  flower: makeFlower,
  honey: makeHoney,
};

export function makeItem(type) {
  const builder = ITEM_MESH[type] || makeAcorn;
  return builder();
}

// Recursively dispose a mesh hierarchy and remove it from its parent.
export function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  });
  if (obj.parent) obj.parent.remove(obj);
}
