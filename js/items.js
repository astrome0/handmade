// Wood pieces: logs and planks. Every piece is a real physics body, and every
// cut keeps whatever crooked length you made it.
import * as THREE from 'three';
import { world, CANNON, GROUP, MASK, MAT } from './physics.js';
import { game } from './game.js';
import { TEX } from './textures.js';

export const pieces = new Set();
export const DENSITY = 560; // kg/m³, fresh pine-ish
const UP = new CANNON.Vec3(0, 1, 0);
const OAK = new THREE.Color(0.86, 0.7, 0.55);
const M = {};
export { M as woodMats };
let nextId = 1;

export function initItems() {
  M.bark = new THREE.MeshStandardMaterial({ map: TEX.bark, roughness: 0.95 });
  M.end = new THREE.MeshStandardMaterial({ map: TEX.end, roughness: 0.85 });
  M.grain = new THREE.MeshStandardMaterial({ map: TEX.grain, roughness: 0.78 });
  M.plankEnd = new THREE.MeshStandardMaterial({ map: TEX.grain, color: 0xa88a64, roughness: 0.9 });
  M.sheet = new THREE.MeshStandardMaterial({ map: TEX.sheet, color: 0x8a3428, roughness: 0.55, metalness: 0.25 });
  M.sheetEdge = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.5, metalness: 0.3 });
}

// Painted steel roofing: the texture holds one wave, repeated every 7.6 cm across.
export function sheetGeometry(w, t, len) {
  const g = new THREE.BoxGeometry(w, len, t);
  const uv = g.attributes.uv;
  for (let i = 16; i < 24; i++) uv.setXY(i, (uv.getX(i) * w) / 0.076, uv.getY(i) * len);
  return g;
}

export function logGeometry(r, len) {
  const g = new THREE.CylinderGeometry(r, r, len, 14, 1);
  const uv = g.attributes.uv, side = 15 * 2, u0 = Math.random(), v0 = Math.random();
  for (let i = 0; i < side; i++) uv.setXY(i, u0 + (uv.getX(i) * Math.PI * 2 * r) / 0.45, v0 + (uv.getY(i) * len) / 0.9);
  return g;
}

function plankGeometry(w, t, len) {
  const g = new THREE.BoxGeometry(w, len, t);
  const uv = g.attributes.uv;
  const sizes = [[t, len], [t, len], [w, t], [w, t], [w, len], [w, len]];
  const u0 = Math.random(), v0 = Math.random();
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, u0 + (uv.getX(i) * sizes[f][0]) / 0.22, v0 + uv.getY(i) * sizes[f][1]);
    }
  }
  return g;
}

export class Piece {
  // kind: 'log' {r, len} | 'plank' or 'sheet' (roofing) {w, t, len}. Length always runs along local Y.
  constructor(kind, dims, pos, quat) {
    this.id = nextId++;
    this.kind = kind;
    this.r = dims.r || 0;
    this.w = dims.w || 0;
    this.t = dims.t || 0;
    this.len = dims.len;
    this.tint = dims.tint ?? 0.88 + Math.random() * 0.22;
    this.species = dims.species ?? 'pine'; // 'pine' | 'oak': oak is darker and worth more
    this.nails = [];        // nails stuck in this piece
    this.joints = new Set(); // nail joints touching this piece
    this.anchored = false;  // post driven into the ground
    this.drive = 0;
    this.falling = false;   // a tree that is still coming down

    this.mesh = this.buildMesh();
    this.mesh.userData.piece = this;
    game.scene.add(this.mesh);

    const shape = kind === 'log'
      ? new CANNON.Cylinder(this.r, this.r, this.len, 12)
      : new CANNON.Box(new CANNON.Vec3(this.w / 2, this.len / 2, this.t / 2));
    this.body = new CANNON.Body({
      mass: this.mass,
      material: MAT.wood,
      collisionFilterGroup: GROUP.PIECE,
      collisionFilterMask: MASK.ALL,
      linearDamping: 0.05,
      angularDamping: 0.15,
      allowSleep: true,
      sleepSpeedLimit: 0.15,
      sleepTimeLimit: 0.6,
    });
    this.body.addShape(shape);
    this.body.position.set(pos.x, pos.y, pos.z);
    if (quat) this.body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    this.body.piece = this;
    world.addBody(this.body);
    pieces.add(this);
    this.sync();
  }

  buildMesh() {
    let mesh;
    if (this.kind === 'log') {
      mesh = new THREE.Mesh(logGeometry(this.r, this.len), [M.bark, M.end, M.end]);
    } else if (this.kind === 'sheet') {
      mesh = new THREE.Mesh(sheetGeometry(this.w, this.t, this.len), [M.sheetEdge, M.sheetEdge, M.sheetEdge, M.sheetEdge, M.sheet, M.sheet]);
    } else {
      const face = M.grain.clone();
      face.color.setScalar(this.tint);
      if (this.species === 'oak') face.color.multiply(OAK);
      mesh = new THREE.Mesh(plankGeometry(this.w, this.t, this.len), [face, face, M.plankEnd, M.plankEnd, face, face]);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  get volume() { return this.kind === 'log' ? Math.PI * this.r * this.r * this.len : this.w * this.t * this.len; }
  get mass() { return this.kind === 'sheet' ? this.w * this.len * 4.5 : this.volume * DENSITY; } // steel sheet: 4.5 kg/m²
  get label() {
    if (this.kind === 'sheet') return 'Roofing sheet';
    const sp = this.species === 'oak' ? 'Oak' : 'Pine';
    return this.kind === 'log' ? (this.anchored ? `${sp} post` : `${sp} log`) : `${sp} plank`;
  }

  axis(out = new CANNON.Vec3()) { return this.body.quaternion.vmult(UP, out); }

  // world position of one end: side = -1 bottom, +1 top (along local Y)
  end(side, out = new CANNON.Vec3()) {
    this.body.pointToWorldFrame(new CANNON.Vec3(0, (side * this.len) / 2, 0), out);
    return out;
  }

  sync() {
    const b = this.body;
    if (b.type === CANNON.Body.STATIC) {
      this.mesh.position.copy(b.position);
      this.mesh.quaternion.copy(b.quaternion);
    } else {
      this.mesh.position.copy(b.interpolatedPosition);
      this.mesh.quaternion.copy(b.interpolatedQuaternion);
    }
  }

  makeStatic() {
    const b = this.body;
    b.type = CANNON.Body.STATIC;
    b.mass = 0;
    b.updateMassProperties();
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.aabbNeedsUpdate = true;
  }

  makeDynamic() {
    const b = this.body;
    b.type = CANNON.Body.DYNAMIC;
    b.mass = this.mass;
    b.updateMassProperties();
    b.aabbNeedsUpdate = true;
    b.wakeUp();
  }

  destroy() {
    world.removeBody(this.body);
    game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    if (this.kind === 'plank') this.mesh.material[0].dispose();
    pieces.delete(this);
    this.dead = true;
  }
}

// Saw straight across at the point you aimed. Returns the two new pieces.
export function crossCut(p, worldPoint) {
  const lp = p.body.pointToLocalFrame(new CANNON.Vec3(worldPoint.x, worldPoint.y, worldPoint.z));
  const L = p.len, y = Math.max(-L / 2, Math.min(L / 2, lp.y));
  const kerf = 0.003;
  const L1 = y + L / 2 - kerf / 2, L2 = L / 2 - y - kerf / 2;
  if (L1 < 0.08 || L2 < 0.08) return null;
  const parts = [[-L / 2 + L1 / 2, L1], [L / 2 - L2 / 2, L2]].map(([c, len]) => {
    const pos = p.body.position.vadd(p.body.quaternion.vmult(new CANNON.Vec3(0, c, 0)));
    const n = new Piece(p.kind, { r: p.r, w: p.w, t: p.t, len, tint: p.tint, species: p.species }, pos, p.body.quaternion);
    n.body.velocity.copy(p.body.velocity);
    n.body.angularVelocity.copy(p.body.angularVelocity);
    return n;
  });
  p.destroy();
  return parts;
}

// Saw a log lengthwise into planks. Every plank comes out a little different.
export function ripLog(p) {
  const n = Math.max(2, Math.min(4, Math.round((p.r * 2) / 0.13)));
  const t0 = 0.034;
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = Math.min(p.r * 1.7, 0.12 + Math.random() * 0.05);
    const t = t0 + (Math.random() - 0.5) * 0.008;
    const len = p.len - Math.random() * 0.03;
    const z = (i - (n - 1) / 2) * (t0 + 0.008);
    const twist = new CANNON.Quaternion().setFromAxisAngle(UP, (Math.random() - 0.5) * 0.06);
    const q = p.body.quaternion.mult(twist);
    const pos = p.body.position.vadd(p.body.quaternion.vmult(new CANNON.Vec3(0, 0, z)));
    out.push(new Piece('plank', { w, t, len, species: p.species }, pos, q));
  }
  p.destroy();
  return out;
}
