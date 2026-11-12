// Bricks and mortar, doors and windows. Bricks come on pallets, mortar in bags,
// doors and windows in flat wooden crates. With the trowel you set them one at a
// time. Every wall keeps its own grid, set by its first brick, so courses line up
// and corners bond, but every brick still sits a little off.
import * as THREE from 'three';
import { world, CANNON, GROUP, MASK, MAT } from './physics.js';
import { terrainHeight } from './terrain.js';
import { game } from './game.js';
import { TEX } from './textures.js';
import { audio } from './audio.js';
import { particles } from './particles.js';
import { clamp } from './util.js';
import { Piece } from './items.js';

// Big clay bricks (real 215 mm ones felt tiny), 10 mm joints.
export const BRICK = { l: 0.39, h: 0.13, d: 0.19, mass: 8 };
const U = 0.2;         // half a brick plus a joint: the grid step along and across a wall
const MY = 0.14;       // one course: a brick plus a joint
const SET_TIME = 30;   // seconds until mortar has set
const JOIN_DIST = 4;   // a brick laid on the ground this close to a wall joins its grid
const REACH = 3;
export const HAND_MAX = 8, MORTAR_MAX = 60, BAG = 20;
export const PALLET = 48;
const KNOCKS = 4;

// Things you set into a wall: L grid cells along it, H courses high (the top course is the lintel).
export const FIT = {
  door: { L: 6, H: 16, label: 'Door' }, // 1.2 m: you are 68 cm wide and need room to get through
  window: { L: 5, H: 9, label: 'Window' },
};

// hold: a door or window you are carrying (only one at a time)
// halves: the other half of a brick you broke for a half-brick gap, kept for the next one
export const supplies = { bricks: 0, halves: 0, mortar: 0, hold: null };
export const walls = [];
const things = new Set(); // pallets, bags, crates and loose bricks lying around
const doors = new Set();

const rnd = (a) => (Math.random() - 0.5) * 2 * a;
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);
const WET = new THREE.Color(0x67625b), DRY = new THREE.Color(0xa9a396);

let brickGeo, brickMat, brickMesh, mortarMesh, ghost;
const CAP = 8000;
const recs = []; // instance index → brick

// A brick's own colour: mostly warm reds, now and then a dark burnt one or a pale one.
function brickColor(out = new THREE.Color()) {
  const r = Math.random();
  if (r < 0.06) return out.setHSL(0.03, 0.35, 0.2 + Math.random() * 0.05, THREE.SRGBColorSpace);
  if (r < 0.12) return out.setHSL(0.06, 0.45, 0.48 + Math.random() * 0.06, THREE.SRGBColorSpace);
  return out.setHSL(0.02 + Math.random() * 0.03, 0.42 + Math.random() * 0.14, 0.37 + Math.random() * 0.09, THREE.SRGBColorSpace);
}

// ───────── walls ─────────

class Wall {
  constructor(x, y0, z, yaw) {
    this.o = { x, z };
    this.y0 = y0;
    this.yaw = yaw;
    this.ex = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); // along the first brick
    this.ez = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));  // across it
    this.cells = new Map();
    this.bricks = new Set(); // bricks and fittings
  }
  world(lx, lz, out = new THREE.Vector3()) {
    return out.set(this.o.x + this.ex.x * lx + this.ez.x * lz, 0, this.o.z + this.ex.z * lx + this.ez.z * lz);
  }
  grid(p) {
    const dx = p.x - this.o.x, dz = p.z - this.o.z;
    return { x: (dx * this.ex.x + dz * this.ex.z) / U, y: (p.y - this.y0) / MY, z: (dx * this.ez.x + dz * this.ez.z) / U };
  }
  dir(n) { return { x: n.x * this.ex.x + n.z * this.ex.z, z: n.x * this.ez.x + n.z * this.ez.z }; }
  // distance on the ground from p to the nearest brick
  near(p) {
    let best = Infinity;
    for (const b of this.bricks) best = Math.min(best, Math.hypot(b.pos.x - p.x, b.pos.z - p.z) - (b.L - 2) * U * 0.5);
    return best;
  }
}

const key = (x, z, y) => `${x},${z},${y}`;
const BLOCKED = 'Something is in the way';
// the grid cells something L long covers: along x (o = 0) or along z (o = 1)
const cellsOf = (o, ix, iz, L) => Array.from({ length: L }, (_, k) => (o ? [ix, iz + k] : [ix + k, iz]));
// its centre on the wall's grid
const centre = (o, ix, iz, L) => (o ? [(ix + 0.5) * U, (iz + L / 2) * U] : [(ix + L / 2) * U, (iz + 0.5) * U]);
// its footprint corners on the grid
function corners(o, ix, iz, L) {
  const [x0, x1] = o ? [ix * U, (ix + 1) * U] : [ix * U, (ix + L) * U];
  const [z0, z1] = o ? [iz * U, (iz + L) * U] : [iz * U, (iz + 1) * U];
  return [[x0, z0], [x1, z0], [x0, z1], [x1, z1]];
}
function groundUnder(w, o, ix, iz, L) {
  let hmin = Infinity, hmax = -Infinity;
  for (const [lx, lz] of corners(o, ix, iz, L)) {
    w.world(lx, lz, _v);
    const h = terrainHeight(_v.x, _v.z);
    hmin = Math.min(hmin, h);
    hmax = Math.max(hmax, h);
  }
  return [hmin, hmax];
}

// Can it go here? Returns { ok, why, bed } — bed: mortar under it, down to the ground.
function check(w, o, ix, iz, iy, L, H) {
  const cells = cellsOf(o, ix, iz, L);
  for (let c = iy; c < iy + H; c++) {
    for (const [x, z] of cells) if (w.cells.has(key(x, z, c))) return { ok: false, why: BLOCKED };
  }
  const [hmin, hmax] = groundUnder(w, o, ix, iz, L);
  const bottom = w.y0 + iy * MY + 0.005;
  if (bottom < hmax - 0.03) return { ok: false, why: 'The ground is in the way' };
  // you, standing where it would go (distance from you to its footprint, on the wall's grid)
  const pl = game.player.body.position, feet = pl.y - 0.34;
  const g = w.grid(pl), [[x0, z0], , , [x1, z1]] = corners(o, ix, iz, L);
  const dx = Math.max(x0 - g.x * U, 0, g.x * U - x1), dz = Math.max(z0 - g.z * U, 0, g.z * U - z1);
  if (Math.hypot(dx, dz) < 0.36 && bottom < feet + 1.75 && bottom + H * MY > feet - 0.05) return { ok: false, why: 'You are standing there' };
  if (cells.some(([x, z]) => w.cells.has(key(x, z, iy - 1)))) return { ok: true, bed: 0 };
  if (w.plinth && iy === 0) return { ok: true, bed: 0 }; // a house on a stone plinth: level under the first course
  const gap = bottom - hmin;
  if (bottom - hmax <= 0.12 && gap <= 0.2) return { ok: true, bed: Math.max(0, gap) };
  return { ok: false, why: 'Nothing under it' };
}

// What you would set, from what you aim at.
// mode: 0 a brick along, 1 turned a quarter, 2 a half brick. Carrying a door or window: 0/1 = along/turned.
export function target(a, mode) {
  if (!a.point || a.dist > REACH) return null;
  const kind = supplies.hold || 'brick';
  const L = supplies.hold ? FIT[kind].L : mode === 2 ? 1 : 2;
  const H = supplies.hold ? FIT[kind].H : 1;
  const turn = mode === 1 ? 1 : 0;
  let w, o, ix, iz, iy;
  // butt it against an end face, else centre it on the nearest grid line
  const place = (f, nl, side) => {
    if (o === 0) {
      ix = side && Math.abs(nl.x) > Math.abs(nl.z) ? (nl.x > 0 ? Math.floor(f.x) : Math.floor(f.x) - (L - 1)) : Math.round(f.x - L / 2);
      iz = Math.floor(f.z);
    } else {
      iz = side && Math.abs(nl.z) > Math.abs(nl.x) ? (nl.z > 0 ? Math.floor(f.z) : Math.floor(f.z) - (L - 1)) : Math.round(f.z - L / 2);
      ix = Math.floor(f.x);
    }
  };
  if (a.brick) {
    const b = a.brick;
    w = b.wall;
    if (a.normal.y < -0.7) return null;
    o = (b.o + turn) % 2;
    const nl = w.dir(a.normal);
    const face = a.normal.y > 0.7 ? 'top' : Math.abs(b.o ? nl.x : nl.z) > Math.abs(b.o ? nl.z : nl.x) ? 'face' : 'end';
    if (face === 'face') {
      // the broad face of a wall (you can't see the top of a high one): go on top of that column
      const f = w.grid(_v.copy(a.point).addScaledVector(a.normal, -U * 0.5));
      place(f, nl, false);
      iy = b.iy + 1;
      while (iy < b.iy + 40 && cellsOf(o, ix, iz, L).some(([x, z]) => w.cells.has(key(x, z, iy)))) iy++;
    } else {
      const f = w.grid(_v.copy(a.point).addScaledVector(a.normal, U * 0.5));
      place(f, nl, face === 'end');
      iy = Math.floor(f.y);
    }
  } else if (a.ground) {
    w = null;
    let best = JOIN_DIST;
    for (const x of walls) { const d = x.near(a.point); if (d < best) { best = d; w = x; } }
    if (w) {
      o = turn;
      place(w.grid(a.point), { x: 0, z: 0 }, false);
      // the lowest course that clears the ground here
      iy = Math.ceil((groundUnder(w, o, ix, iz, L)[1] - 0.035 - w.y0) / MY - 1e-6);
    } else {
      // a new wall: the first brick lies across your view (turned: along it)
      const yaw = game.player.yaw;
      o = turn;
      [ix, iz, iy] = [0, 0, 0];
      const [cx, cz] = centre(o, 0, 0, L);
      const t = new Wall(0, 0, 0, yaw);
      w = new Wall(a.point.x - t.ex.x * cx - t.ez.x * cz, 0, a.point.z - t.ex.z * cx - t.ez.z * cz, yaw);
      w.y0 = groundUnder(w, o, 0, 0, L)[1] - 0.02;
    }
  } else return null;
  const res = check(w, o, ix, iz, iy, L, H);
  // a whole brick doesn't fit, but half of one does (next to a frame, at the end of a course): use a half
  if (!res.ok && res.why === BLOCKED && kind === 'brick' && L === 2) {
    const g = w.grid(a.point);
    const cells = cellsOf(o, ix, iz, 2).sort(([ax, az], [bx, bz]) => Math.hypot(ax + 0.5 - g.x, az + 0.5 - g.z) - Math.hypot(bx + 0.5 - g.x, bz + 0.5 - g.z));
    for (const [cx, cz] of cells) {
      const half = check(w, o, cx, cz, iy, 1, 1);
      if (half.ok) return { w, o, ix: cx, iz: cz, iy, L: 1, H, kind, auto: true, ...half };
    }
  }
  return { w, o, ix, iz, iy, L, H, kind, ...res };
}

// ───────── bricks ─────────

function bucketBody(pos) {
  const bx = Math.floor(pos.x / 2), bz = Math.floor(pos.z / 2), k = `${bx},${bz}`;
  let b = bucketBody.map.get(k);
  if (!b) {
    b = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: MAT.brick, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: MASK.ALL });
    b.position.set(bx * 2, 0, bz * 2);
    b.brickWall = true;
    world.addBody(b);
    bucketBody.map.set(k, b);
  }
  return b;
}
bucketBody.map = new Map();

function writeInstance(r) {
  const sx = (r.L * U - 0.01) / BRICK.l; // a half brick is a squashed whole one
  _m.compose(r.pos, r.quat, _s.set(sx, 1, 1));
  brickMesh.setMatrixAt(r.idx, _m);
  brickMesh.setColorAt(r.idx, r.color);
  // the mortar around it: joints all round, and a bed down to the ground for the first course
  const top = r.pos.y + BRICK.h / 2 + 0.005;
  const bottom = r.pos.y - BRICK.h / 2 - 0.005 - r.bed;
  _v.copy(r.pos).setY((top + bottom) / 2);
  _q.setFromAxisAngle(UP, r.wall.yaw + (r.o ? Math.PI / 2 : 0));
  _m.compose(_v, _q, _s.set(r.L / 2, (top - bottom) / MY, 1));
  mortarMesh.setMatrixAt(r.idx, _m);
  mortarMesh.setColorAt(r.idx, _c.copy(DRY).lerp(WET, clamp(r.wet / SET_TIME, 0, 1) ** 0.6));
  brickMesh.instanceMatrix.needsUpdate = mortarMesh.instanceMatrix.needsUpdate = true;
  brickMesh.instanceColor.needsUpdate = mortarMesh.instanceColor.needsUpdate = true;
}

function claim(r) {
  const w = r.wall;
  if (!walls.includes(w)) walls.push(w);
  for (let c = r.iy; c < r.iy + r.H; c++) for (const [x, z] of cellsOf(r.o, r.ix, r.iz, r.L)) w.cells.set(key(x, z, c), r);
  w.bricks.add(r);
}

function release(r) {
  const w = r.wall;
  for (let c = r.iy; c < r.iy + r.H; c++) for (const [x, z] of cellsOf(r.o, r.ix, r.iz, r.L)) w.cells.delete(key(x, z, c));
  w.bricks.delete(r);
  if (!w.bricks.size) walls.splice(walls.indexOf(w), 1);
  r.dead = true;
}

// exact: a loaded brick ({ pos, quat, color, wet }), put back just as it was
function addBrick(t, exact) {
  if (brickMesh.count >= CAP) { game.hud.toast('That is as many bricks as this world can hold'); return null; }
  const { w, o, ix, iz, iy, L, bed } = t;
  let pos, quat;
  if (exact) ({ pos, quat } = exact);
  else {
    const [lx, lz] = centre(o, ix, iz, L);
    pos = w.world(lx + rnd(0.004), lz + rnd(0.004));
    pos.y = w.y0 + iy * MY + MY / 2 + rnd(0.0025);
    // nobody lays them perfectly: a few millimetres and a fraction of a degree off
    quat = new THREE.Quaternion().setFromEuler(_e.set(rnd(0.006), w.yaw + (o ? Math.PI / 2 : 0) + rnd(0.012), rnd(0.006)));
  }
  const r = { kind: 'brick', wall: w, o, ix, iz, iy, L, H: 1, bed, pos, quat, color: exact?.color ?? brickColor(), wet: exact ? exact.wet : SET_TIME, hits: 0, idx: brickMesh.count++ };
  mortarMesh.count = brickMesh.count;
  recs[r.idx] = r;
  claim(r);
  writeInstance(r);

  const body = bucketBody(pos);
  r.shape = new CANNON.Box(new CANNON.Vec3((L * U - 0.01) / 2, BRICK.h / 2 + 0.005, BRICK.d / 2));
  r.shape.brick = r;
  r.body = body;
  body.addShape(r.shape, new CANNON.Vec3(pos.x - body.position.x, pos.y - body.position.y, pos.z - body.position.z), new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w));
  if (r.wet > 0) wet.add(r);
  return r;
}

function removeBrick(r) {
  release(r);
  r.body.removeShape(r.shape);
  wet.delete(r);
  // keep the instances packed: the last one moves into the gap
  const last = brickMesh.count - 1;
  if (r.idx !== last) {
    const m = recs[last];
    m.idx = r.idx;
    recs[r.idx] = m;
    writeInstance(m);
  }
  recs.length = last;
  brickMesh.count = mortarMesh.count = last;
  brickMesh.instanceMatrix.needsUpdate = mortarMesh.instanceMatrix.needsUpdate = true;
}

const hasAbove = (r) => cellsOf(r.o, r.ix, r.iz, r.L).some(([x, z]) => r.wall.cells.has(key(x, z, r.iy + r.H)));

// ───────── doors and windows ─────────

let FM = null;
function fitMats() {
  if (FM) return FM;
  const M = (o) => new THREE.MeshStandardMaterial(o);
  FM = {
    frame: M({ map: TEX.grain, color: 0xe9e1cf, roughness: 0.7 }),
    // stained wood: dark green read as black in the shade
    leaf: M({ map: TEX.grain, color: 0xb07a4a, roughness: 0.6 }),
    panel: M({ map: TEX.grain, color: 0x94623a, roughness: 0.65 }),
    lintel: M({ map: TEX.grain, color: 0x8a6a48, roughness: 0.85 }),
    metal: M({ color: 0xb8a77a, roughness: 0.35, metalness: 0.35 }),
    sill: M({ color: 0x9c9a92, roughness: 0.9 }),
    glass: M({ color: 0xbcd6e0, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.28, depthWrite: false }),
  };
  return FM;
}

// Built at its own origin: bottom centre, x along the wall, z across it.
function fitMesh(kind) {
  const F = fitMats(), g = new THREE.Group(), spec = FIT[kind];
  const len = spec.L * U - 0.01, tall = spec.H * MY - 0.01, d = BRICK.d;
  const add = (parent, w, h, dd, x, y, z, mat, shadow = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const open = tall - BRICK.h - 0.01; // the opening, under the lintel
  add(g, len, BRICK.h, d, 0, open + 0.005 + BRICK.h / 2, 0, F.lintel); // wooden lintel: bricks go on top
  add(g, len, 0.07, d, 0, open - 0.035, 0, F.frame);                     // head of the frame
  for (const s of [-1, 1]) add(g, 0.07, open - 0.07, d, s * (len / 2 - 0.035), (open - 0.07) / 2, 0, F.frame);
  const inner = len - 0.14;
  const out = { group: g };
  if (kind === 'door') {
    add(g, len, 0.02, d, 0, 0.01, 0, F.sill); // threshold
    const pivot = new THREE.Group();
    pivot.position.set(-inner / 2, 0, 0);
    g.add(pivot);
    const h = open - 0.07 - 0.03;
    const leaf = add(pivot, inner - 0.006, h, 0.045, inner / 2, 0.02 + h / 2, 0, F.leaf);
    for (const y of [0.55, 1.45]) add(leaf, inner - 0.2, 0.62, 0.012, 0, y - h / 2 - 0.02, 0.026, F.panel);
    add(leaf, 0.03, 0.03, 0.12, inner / 2 - 0.08, 1.0 - h / 2 - 0.02, 0, F.metal); // handle, both sides
    add(leaf, 0.12, 0.025, 0.025, inner / 2 - 0.12, 1.0 - h / 2 - 0.02, 0.06, F.metal);
    add(leaf, 0.12, 0.025, 0.025, inner / 2 - 0.12, 1.0 - h / 2 - 0.02, -0.06, F.metal);
    Object.assign(out, { pivot, leaf, leafSize: [inner - 0.006, h, 0.045] });
  } else {
    add(g, len, 0.06, d, 0, 0.03, 0, F.frame);                                // bottom of the frame
    add(g, len + 0.08, 0.04, 0.09, 0, 0.0, d / 2 + 0.03, F.sill);             // sill outside
    const gh = open - 0.07 - 0.06;
    add(g, 0.05, gh, 0.06, 0, 0.06 + gh / 2, 0, F.frame);                     // mullion
    add(g, inner, 0.05, 0.06, 0, 0.06 + gh * 0.62, 0, F.frame);               // transom
    add(g, inner, gh, 0.01, 0, 0.06 + gh / 2, 0, F.glass, false);
  }
  return out;
}

// exact: a loaded door or window ({ pos, quat, open }), put back just as it was
function addFitting(t, exact) {
  const { w, o, ix, iz, iy, L, H, kind } = t;
  let pos, quat;
  if (exact) ({ pos, quat } = exact);
  else {
    const [lx, lz] = centre(o, ix, iz, L);
    pos = w.world(lx, lz);
    pos.y = w.y0 + iy * MY + 0.005;
    const yaw = w.yaw + (o ? Math.PI / 2 : 0) + rnd(0.004);
    quat = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  }
  const m = fitMesh(kind);
  m.group.position.copy(pos);
  m.group.quaternion.copy(quat);
  game.scene.add(m.group);
  const r = { kind, wall: w, o, ix, iz, iy, L, H, bed: t.bed, pos, quat, wet: 0, hits: 0, ...m };

  // physics: the frame (or the whole window) is fixed; a door's leaf has its own body so it can swing
  const len = L * U - 0.01, tall = H * MY - 0.01, d = BRICK.d, open = tall - BRICK.h - 0.01;
  r.body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: MAT.brick, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: MASK.ALL });
  r.body.position.set(pos.x, pos.y, pos.z);
  r.body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  const box = (b, hx, hy, hz, x, y, z) => { const s = new CANNON.Box(new CANNON.Vec3(hx, hy, hz)); s.brick = r; b.addShape(s, new CANNON.Vec3(x, y, z)); return s; };
  if (kind === 'window') box(r.body, len / 2, tall / 2, d / 2, 0, tall / 2, 0);
  else {
    box(r.body, len / 2, (tall - open + 0.07) / 2, d / 2, 0, (open - 0.07 + tall) / 2, 0);
    for (const s of [-1, 1]) box(r.body, 0.035, (open - 0.07) / 2, d / 2, s * (len / 2 - 0.035), (open - 0.07) / 2, 0);
    r.leafBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: MAT.brick, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: MASK.ALL });
    box(r.leafBody, r.leafSize[0] / 2, r.leafSize[1] / 2, r.leafSize[2] / 2, 0, 0, 0).leaf = true;
    world.addBody(r.leafBody);
    r.open = !!exact?.open;
    r.angle = r.open ? 1.65 : 0;
    doors.add(r);
    syncLeaf(r);
  }
  world.addBody(r.body);
  claim(r);
  return r;
}

function syncLeaf(r) {
  r.pivot.rotation.y = r.angle;
  r.group.updateMatrixWorld(true);
  r.leaf.getWorldPosition(_v);
  r.leaf.getWorldQuaternion(_q);
  r.leafBody.position.set(_v.x, _v.y, _v.z);
  r.leafBody.quaternion.set(_q.x, _q.y, _q.z, _q.w);
  r.leafBody.aabbNeedsUpdate = true;
}

function removeFitting(r) {
  release(r);
  world.removeBody(r.body);
  if (r.leafBody) world.removeBody(r.leafBody);
  doors.delete(r);
  game.scene.remove(r.group);
}

export function toggleDoor(r) {
  r.open = !r.open;
  audio.door(!r.open);
}

// ───────── what the trowel and hammer do ─────────

// Click with the trowel.
export function layBrick(t) {
  if (!t) return;
  if (!t.ok) { game.hud.toast(t.why); return; }
  if (t.kind !== 'brick') {
    addFitting(t);
    supplies.hold = null;
    audio.thud(0.6);
    game.hud.toast(`The ${FIT[t.kind].label.toLowerCase()} is in. Lay bricks right over its lintel.`);
    return;
  }
  const half = t.L === 1;
  if (supplies.bricks <= 0 && !(half && supplies.halves > 0)) { game.hud.toast('No bricks in your hands. Take some from a pallet (E).'); return; }
  if (supplies.mortar <= 0) { game.hud.toast('No mortar. Mix a bag of mortar (E).'); return; }
  const r = addBrick(t);
  if (!r) return;
  if (half && supplies.halves > 0) supplies.halves--;
  else if (half) {
    // tap it in two with the edge of the trowel; keep the other half for the next gap
    supplies.bricks--;
    supplies.halves++;
    audio.stoneHit();
  } else supplies.bricks--;
  supplies.mortar--;
  game.hud.setBricks(supplies.bricks);
  audio.lay();
  particles.emit('dirt', _v.copy(r.pos).setY(r.pos.y - BRICK.h / 2), UP, 2);
}

// Right click with the trowel: a brick in wet mortar comes back to your hands.
export function takeBack(r) {
  if (!r) return;
  if (r.kind !== 'brick') { game.hud.toast('Knock it out with the hammer.'); return; }
  if (r.wet <= 0) { game.hud.toast('The mortar has set. Knock it out with the hammer.'); return; }
  if (hasAbove(r)) { game.hud.toast('Take the bricks above it off first.'); return; }
  if (r.L === 2 && supplies.bricks >= HAND_MAX) { game.hud.toast('Your hands are full.'); return; }
  removeBrick(r);
  if (r.L === 1) supplies.halves++;
  else supplies.bricks++;
  game.hud.setBricks(supplies.bricks);
  audio.brick();
}

// The hammer on a set brick (or a door or window): a few hits and it comes loose.
export function knockBrick(r, point, normal) {
  audio.stoneHit();
  particles.emit('dirt', point, normal, 4);
  if (hasAbove(r)) { game.hud.toast(`Knock out the bricks above it first.`); return; }
  if (++r.hits < (r.wet > 0 ? 1 : KNOCKS)) return;
  if (r.kind === 'brick') {
    removeBrick(r);
    const lb = new LooseBrick(r.pos, r.quat, r.color, r.L === 1);
    lb.body.velocity.set(-normal.x * 1.2, 0.8, -normal.z * 1.2);
  } else {
    // the frame comes out whole and goes back in its crate, on the ground in front of the wall
    removeFitting(r);
    _v.copy(r.pos).addScaledVector(normal, 0.8);
    new FitCrate(r.kind, { x: _v.x, y: terrainHeight(_v.x, _v.z) + 0.1, z: _v.z }, new CANNON.Quaternion(r.quat.x, r.quat.y, r.quat.z, r.quat.w));
    game.hud.toast(`The ${FIT[r.kind].label.toLowerCase()} came out.`);
  }
}

export function brickInfo(r) {
  if (r.kind === 'door') return 'Door';
  if (r.kind === 'window') return 'Window';
  const n = [...r.wall.bricks].filter((b) => b.kind === 'brick').length;
  const what = r.L === 1 ? 'Half brick' : 'Brick';
  return r.wet > 0 ? `${what} · mortar setting ${Math.round((1 - r.wet / SET_TIME) * 100)}%` : `Brick wall · ${n} ${n === 1 ? 'brick' : 'bricks'}`;
}

// ───────── things you take bricks, mortar, doors and windows from ─────────

function palletMesh(count) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ map: TEX.grain, color: 0xb59468, roughness: 0.9 });
  const box = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  for (const z of [-0.34, 0, 0.34]) box(1.0, 0.09, 0.09, 0, 0.045, z);
  for (let i = 0; i < 7; i++) box(0.12, 0.022, 0.8, -0.42 + i * 0.14, 0.101, 0);
  // the bricks, 2 × 4 a layer, bottom layer first, so taking from the end of the list takes from the top
  const inst = new THREE.InstancedMesh(brickGeo, brickMat, Math.max(1, count));
  let k = 0;
  for (let layer = 0; k < count; layer++) {
    for (let i = 0; i < 2 && k < count; i++) {
      for (let j = 0; j < 4 && k < count; j++, k++) {
        _v.set(-0.2 + i * 0.4 + rnd(0.006), 0.112 + layer * (BRICK.h + 0.004) + BRICK.h / 2, -0.3 + j * 0.2 + rnd(0.006));
        _q.setFromAxisAngle(UP, rnd(0.02));
        inst.setMatrixAt(k, _m.compose(_v, _q, _s.set(1, 1, 1)));
        inst.setColorAt(k, brickColor(_c));
      }
    }
  }
  inst.count = count;
  inst.castShadow = inst.receiveShadow = true;
  g.add(inst);
  g.userData.inst = inst;
  return g;
}

function labelTexture(lines, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 256, 160);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '600 46px Outfit, system-ui, sans-serif';
  x.fillText(lines[0], 128, 62);
  x.font = '500 26px Outfit, system-ui, sans-serif';
  x.fillText(lines[1], 128, 112);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let bagLabel = null;
function bagMesh() {
  bagLabel ??= labelTexture(['MORTAR', '25 kg · mix with water'], '#d9cdb0', '#4a3b28');
  const paper = new THREE.MeshStandardMaterial({ color: 0xd9cdb0, roughness: 0.95 });
  const top = new THREE.MeshStandardMaterial({ map: bagLabel, roughness: 0.95 });
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.4), [paper, paper, top, paper, paper, paper]);
  m.position.y = 0.06;
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  // a slumped, half-full bag: rounded edges
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 10).rotateX(Math.PI / 2), paper);
    e.position.set(s * 0.3, 0.06, 0);
    e.castShadow = true;
    g.add(e);
  }
  return g;
}

// A flat wooden crate with the door or window inside: slats over a label.
const CRATE = { door: [2.3, 1.3], window: [1.3, 1.1] }; // length, width
const crateLabels = {};
function crateMesh(kind) {
  const [len, wid] = CRATE[kind];
  crateLabels[kind] ??= labelTexture([kind === 'door' ? 'DOOR' : 'WINDOW', 'with frame · handle with care'], '#e8dcc0', '#4a3b28');
  const wood = new THREE.MeshStandardMaterial({ map: TEX.grain, color: 0xc4a274, roughness: 0.85 });
  const g = new THREE.Group();
  const box = (w, h, d, x, y, z, mat = wood) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  box(len, 0.12, wid, 0, 0.06, 0, new THREE.MeshStandardMaterial({ color: 0xd9ccb0, roughness: 0.9 }));
  for (const s of [-1, 1]) {
    box(len, 0.15, 0.08, 0, 0.075, s * (wid / 2 - 0.04));
    box(0.08, 0.15, wid, s * (len / 2 - 0.04), 0.075, 0);
  }
  for (const x of [-0.3, 0.3]) box(0.1, 0.02, wid, x * len, 0.155, 0);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), new THREE.MeshStandardMaterial({ map: crateLabels[kind], roughness: 0.9 }));
  label.rotation.x = -Math.PI / 2;
  label.position.set(0, 0.151, 0);
  g.add(label);
  return g;
}

class Thing {
  constructor(mesh, pos, quat, mass, half, tag) {
    this.mesh = mesh;
    game.scene.add(mesh);
    this.body = new CANNON.Body({ mass, material: MAT.wood, collisionFilterGroup: GROUP.PIECE, collisionFilterMask: MASK.ALL, allowSleep: true, sleepSpeedLimit: 0.15 });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(...half)), new CANNON.Vec3(0, tag === 'loose' ? 0 : half[1], 0));
    this.body.position.set(pos.x, pos.y, pos.z);
    if (quat) this.body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    this.body.thing = this;
    this.kind = tag;
    world.addBody(this.body);
    things.add(this);
    this.sync();
  }
  sync() {
    this.mesh.position.copy(this.body.interpolatedPosition);
    this.mesh.quaternion.copy(this.body.interpolatedQuaternion);
  }
  remove() {
    world.removeBody(this.body);
    game.scene.remove(this.mesh);
    things.delete(this);
    this.dead = true;
  }
}

export class BrickPallet extends Thing {
  constructor(pos, quat, count = PALLET) {
    super(palletMesh(count), pos, quat, 20 + count * BRICK.mass, [0.5, 0.06, 0.4], 'pallet');
    this.count = count;
    this.fit();
  }
  // The hitbox is only as tall as the bricks still on it (or you'd stand on bricks that are gone).
  fit() {
    const b = this.body, hy = (0.112 + Math.ceil(this.count / 8) * (BRICK.h + 0.004)) / 2;
    b.removeShape(b.shapes[0]);
    b.addShape(new CANNON.Box(new CANNON.Vec3(0.5, hy, 0.4)), new CANNON.Vec3(0, hy, 0));
    b.mass = 20 + this.count * BRICK.mass;
    b.updateMassProperties();
    b.wakeUp();
    this.mesh.userData.inst.count = this.count;
  }
}

export class MortarBag extends Thing {
  constructor(pos, quat) { super(bagMesh(), pos, quat, 25, [0.33, 0.06, 0.2], 'bag'); }
}

export class FitCrate extends Thing {
  constructor(fit, pos, quat) {
    const [len, wid] = CRATE[fit];
    super(crateMesh(fit), pos, quat, fit === 'door' ? 45 : 30, [len / 2, 0.08, wid / 2], 'crate');
    this.fit = fit;
  }
}

export class LooseBrick extends Thing {
  constructor(pos, quat, color, half = false) {
    const m = new THREE.Mesh(brickGeo, brickMat.clone());
    m.material.color.copy(color ?? brickColor());
    m.castShadow = m.receiveShadow = true;
    const l = half ? U - 0.01 : BRICK.l;
    m.scale.x = l / BRICK.l;
    super(m, pos, quat, BRICK.mass * (half ? 0.5 : 1), [l / 2, BRICK.h / 2, BRICK.d / 2], 'loose');
    this.half = half;
  }
}

// E on a pallet, a bag, a crate or a loose brick.
export function takeFrom(t) {
  if (t.kind === 'bag') {
    if (supplies.mortar > MORTAR_MAX - BAG) { game.hud.toast('Your bucket is still full of mortar.'); return; }
    supplies.mortar += BAG;
    t.remove();
    audio.bag();
    game.hud.toast(`Mixed a bag of mortar: enough for ${supplies.mortar} bricks`);
    return;
  }
  if (t.kind === 'crate') {
    if (supplies.hold) { game.hud.toast(`You are already carrying a ${supplies.hold}.`); return; }
    supplies.hold = t.fit;
    t.remove();
    audio.pickup?.();
    game.hud.toast(`Carrying a ${t.fit}. Take the trowel (5) and set it into a wall.`);
    return;
  }
  if (t.kind === 'pallet' && t.count <= 0) {
    // an empty pallet comes apart into its three runners: wood you can use
    const b = t.body;
    t.remove();
    for (const z of [-0.34, 0, 0.34]) {
      const p = b.pointToWorldFrame(new CANNON.Vec3(0, 0.08, z));
      new Piece('plank', { w: 0.09, t: 0.09, len: 1.0 }, p, b.quaternion.mult(new CANNON.Quaternion().setFromEuler(0, 0, Math.PI / 2)));
    }
    audio.woodKnock();
    game.hud.toast('Took the empty pallet apart: 3 pieces of wood');
    return;
  }
  if (t.kind === 'loose' && t.half) {
    t.remove();
    supplies.halves++;
    audio.brick();
    return;
  }
  const room = HAND_MAX - supplies.bricks;
  if (room <= 0) { game.hud.toast(`You can carry ${HAND_MAX} bricks at a time.`); return; }
  if (t.kind === 'loose') {
    t.remove();
    supplies.bricks++;
  } else {
    const n = Math.min(room, t.count);
    t.count -= n;
    supplies.bricks += n;
    t.fit();
    game.hud.toast(`Took ${n} bricks${t.count ? ` (${t.count} left on the pallet)` : ' — the pallet is empty'}`);
  }
  game.hud.setBricks(supplies.bricks);
  audio.brick();
}

// E with a door or window in your hands and nothing to take: put it down in front of you.
export function putDown(at, yaw) {
  const f = supplies.hold;
  if (!f) return false;
  supplies.hold = null;
  new FitCrate(f, { x: at.x, y: terrainHeight(at.x, at.z) + 0.15, z: at.z }, new CANNON.Quaternion().setFromEuler(0, yaw, 0));
  audio.drop(0.8);
  return true;
}

export function thingInfo(t) {
  if (t.kind === 'pallet') return t.count ? `Pallet of bricks · ${t.count} left` : 'Empty pallet';
  if (t.kind === 'bag') return 'Mortar mix · 25 kg';
  if (t.kind === 'crate') return t.fit === 'door' ? 'Door with frame · 1.2 × 2.2 m' : 'Window with frame · 1.0 × 1.25 m';
  return 'Brick';
}

// For the delivery truck: what an item looks like on the bed, and the real thing it becomes.
export function cargoMesh(it) {
  if (it.kind === 'pallet') return palletMesh(it.count);
  if (it.kind === 'door' || it.kind === 'window') return crateMesh(it.kind);
  return bagMesh();
}
export function spawnCargo(it, pos, quat) {
  if (it.kind === 'pallet') return new BrickPallet(pos, quat, it.count);
  if (it.kind === 'door' || it.kind === 'window') return new FitCrate(it.kind, pos, quat);
  return new MortarBag(pos, quat);
}

// ───────── setup and every frame ─────────

const wet = new Set();

export function initMasonry() {
  brickGeo = new THREE.BoxGeometry(BRICK.l, BRICK.h, BRICK.d);
  brickMat = new THREE.MeshStandardMaterial({ map: TEX.brick, roughness: 0.92 });
  brickMesh = new THREE.InstancedMesh(brickGeo, brickMat, CAP);
  mortarMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2 * U, MY, BRICK.d - 0.014), new THREE.MeshStandardMaterial({ roughness: 1 }), CAP);
  for (const m of [brickMesh, mortarMesh]) {
    m.count = 0;
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;
    m.setColorAt(0, _c.set(1, 1, 1));
    game.scene.add(m);
  }
  ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.4, depthWrite: false }));
  ghost.renderOrder = 3;
  ghost.visible = false;
  game.scene.add(ghost);
}

// A new game: a starter pallet, two bags, a door and a window at camp, next to the nails.
export function spawnStarter() {
  const at = (x, z, yaw) => [{ x, y: terrainHeight(x, z) + 0.02, z }, new CANNON.Quaternion().setFromEuler(0, yaw, 0)];
  new BrickPallet(...at(-4.2, -2.4, 0.3), 32);
  new MortarBag(...at(-3.2, -3.5, -0.2));
  new MortarBag(...at(-3.0, -3.6, 0.5)).body.position.y += 0.15;
  new FitCrate('door', ...at(-5.6, -0.6, 1.2));
  new FitCrate('window', ...at(-5.9, 1.6, 1.0));
}

export function showGhost(t) {
  if (!t) { ghost.visible = false; return; }
  const [lx, lz] = centre(t.o, t.ix, t.iz, t.L);
  t.w.world(lx, lz, ghost.position);
  ghost.position.y = t.w.y0 + t.iy * MY + (t.H * MY) / 2;
  ghost.scale.set(t.L * U - 0.01, t.H * MY - 0.01, t.kind === 'brick' ? BRICK.d : BRICK.d + 0.01);
  ghost.quaternion.setFromAxisAngle(UP, t.w.yaw + (t.o ? Math.PI / 2 : 0));
  ghost.material.color.set(t.ok ? 0xfff1c4 : 0xff6a50);
  ghost.visible = true;
}

export function updateMasonry(dt) {
  for (const t of things) t.sync();
  for (const r of wet) {
    r.wet = Math.max(0, r.wet - dt);
    writeInstance(r);
    if (r.wet <= 0) wet.delete(r);
  }
  for (const r of doors) {
    const goal = r.open ? 1.65 : 0;
    if (r.angle === goal) continue;
    r.angle += clamp(goal - r.angle, -dt * 2.6, dt * 2.6);
    syncLeaf(r);
  }
}

// A village that was already there: its mortar set long ago.
export function setAllDry() {
  for (const r of wet) { r.wet = 0; writeInstance(r); }
  wet.clear();
}

// ───────── saving and loading ─────────

const r4 = (v) => Math.round(v * 1e4) / 1e4, r5 = (v) => Math.round(v * 1e5) / 1e5;
const vec = (v) => [r4(v.x), r4(v.y), r4(v.z)];
const rot = (q) => [r5(q.x), r5(q.y), r5(q.z), r5(q.w)];

// ctx.wallIndex: Map(wall → number), filled with the house walls already (village.js);
// every other wall that has something in it is added here.
export function saveMasonry(ctx) {
  for (const w of walls) if (!ctx.wallIndex.has(w)) ctx.wallIndex.set(w, ctx.wallIndex.size);
  const wallList = [...ctx.wallIndex.keys()].map((w) => ({ x: r4(w.o.x), z: r4(w.o.z), y0: r4(w.y0), yaw: r5(w.yaw) }));
  const bricks = [], fits = [];
  for (const w of walls) {
    const wi = ctx.wallIndex.get(w);
    for (const r of w.bricks) {
      if (r.kind === 'brick') {
        // [wall, o, ix, iz, iy, L, bed, pos×3, quat×4, colour, wet]
        bricks.push([wi, r.o, r.ix, r.iz, r.iy, r.L, r4(r.bed), ...vec(r.pos), ...rot(r.quat), r.color.getHex(), Math.round(r.wet * 10) / 10]);
      } else {
        fits.push({ wall: wi, kind: r.kind, o: r.o, ix: r.ix, iz: r.iz, iy: r.iy, L: r.L, H: r.H, bed: r4(r.bed ?? 0), pos: vec(r.pos), quat: rot(r.quat), open: !!r.open });
      }
    }
  }
  const lying = [...things].filter((t) => !t.dead).map((t) => {
    const b = t.body, s = { kind: t.kind, pos: vec(b.position), quat: rot(b.quaternion) };
    if (t.kind === 'pallet') s.count = t.count;
    if (t.kind === 'crate') s.fit = t.fit;
    if (t.kind === 'loose') { s.half = t.half; s.color = t.mesh.material.color.getHex(); }
    return s;
  });
  return { walls: wallList, bricks, fits, things: lying, supplies: { ...supplies } };
}

// ctx.walls: number → wall, with the house walls already in it (village.js made them).
export function loadMasonry(d, ctx) {
  d.walls.forEach((s, i) => { ctx.walls[i] ??= new Wall(s.x, s.y0, s.z, s.yaw); });
  for (const b of d.bricks) {
    const [wi, o, ix, iz, iy, L, bed, px, py, pz, qx, qy, qz, qw, col, wetT] = b;
    addBrick({ w: ctx.walls[wi], o, ix, iz, iy, L, bed }, {
      pos: new THREE.Vector3(px, py, pz), quat: new THREE.Quaternion(qx, qy, qz, qw), color: new THREE.Color().setHex(col), wet: wetT,
    });
  }
  for (const f of d.fits) {
    addFitting({ w: ctx.walls[f.wall], o: f.o, ix: f.ix, iz: f.iz, iy: f.iy, L: f.L, H: f.H, kind: f.kind, bed: f.bed },
      { pos: new THREE.Vector3(...f.pos), quat: new THREE.Quaternion(...f.quat), open: f.open });
  }
  for (const s of d.things) {
    const pos = { x: s.pos[0], y: s.pos[1], z: s.pos[2] }, quat = new CANNON.Quaternion(...s.quat);
    const t = s.kind === 'pallet' ? new BrickPallet(pos, quat, s.count)
      : s.kind === 'bag' ? new MortarBag(pos, quat)
      : s.kind === 'crate' ? new FitCrate(s.fit, pos, quat)
      : new LooseBrick(pos, quat, new THREE.Color().setHex(s.color), s.half);
    t.body.sleep();
  }
  Object.assign(supplies, d.supplies);
  game.hud.setBricks(supplies.bricks);
}

// ───────── for workers (workers.js) ─────────

export const site = { U, MY, key, cellsOf, centre, check, things, doors, Wall, fitMats };

// A worker sets a door or window he carried over.
export function workerFit(t) {
  const c = check(t.w, t.o, t.ix, t.iz, t.iy, t.L, t.H);
  if (!c.ok) return null;
  return addFitting({ ...t, bed: c.bed });
}

// A worker lays a brick: same as yours, from his own supplies.
export function workerLay(t, near) {
  const c = check(t.w, t.o, t.ix, t.iz, t.iy, t.L, 1);
  if (!c.ok) return null;
  const r = addBrick({ ...t, H: 1, bed: c.bed });
  if (r && near) audio.lay();
  return r;
}

// A worker knocks a brick off the top of a wall (levelling it for a roof): it comes away whole.
export function workerKnock(r, near) {
  if (r.dead || r.kind !== 'brick' || hasAbove(r)) return false;
  removeBrick(r);
  if (near) audio.stoneHit();
  particles.emit('dirt', r.pos, UP, 3);
  return true;
}

// Every brick and fitting of a wall onto another grid (your own walls becoming a house: village.js).
// cell(x, z) → [x, z] on the new grid; turn: the new grid is a quarter turn off, so "along" flips.
// Nothing moves in the world: only which cells each one fills.
export function regrid(from, to, cell, turn) {
  const list = [...from.bricks];
  for (const r of list) {
    const cs = cellsOf(r.o, r.ix, r.iz, r.L).map(([x, z]) => cell(x, z));
    r.wall = to;
    if (turn) r.o = 1 - r.o;
    r.ix = Math.min(...cs.map((c) => c[0]));
    r.iz = Math.min(...cs.map((c) => c[1]));
  }
  from.cells.clear();
  from.bricks.clear();
  walls.splice(walls.indexOf(from), 1);
  for (const r of list) claim(r);
}

export const masonryDebug = {
  walls, things, supplies, recs, doors, get count() { return brickMesh.count; },
  // tests: put something straight onto a wall's grid, as if laid by hand
  put(w, o, ix, iz, iy, L = 2, kind = 'brick') {
    const H = kind === 'brick' ? 1 : FIT[kind].H;
    const t = { w, o, ix, iz, iy, L, H, kind, ...check(w, o, ix, iz, iy, L, H) };
    if (!t.ok) return t.why;
    if (kind === 'brick') { supplies.bricks++; supplies.mortar++; }
    layBrick(t);
    return true;
  },
  newWall: (x, z, yaw) => { const w = new Wall(x, 0, z, yaw); w.y0 = terrainHeight(x, z) + 0.02; return w; },
};
