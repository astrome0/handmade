// People you hire on the phone. A bricklayer raises the walls you started (your
// first course is his plan), or builds whole houses from the plans you mark out:
// walls, doors and windows, then the roof. He fetches bricks, mortar, crates and
// roofing sheets himself, walks around walls and trees, and goes through doors.
import * as THREE from 'three';
import { world, CANNON, GROUP } from './physics.js';
import { terrainHeight, road } from './terrain.js';
import { game } from './game.js';
import { trees } from './world.js';
import { TEX } from './textures.js';
import { audio } from './audio.js';
import { walls, site, workerLay, workerFit, workerKnock, BRICK, FitCrate } from './masonry.js';
import { pieces, Piece } from './items.js';
import { clamp } from './util.js';
import { spend, WAGE } from './money.js';
import { standY, ROW_TIME, roofHere, roomOf, ownHouse } from './village.js';
import { car } from './car.js';

const { U, MY, key, cellsOf, centre, check, things, doors } = site;
const SPEED = 1.5, CARRY = 8, BAG = 20;
const LAY_TIME = 1.1, KNOCK_TIME = 1.8, TAKE_TIME = 0.9, MIX_TIME = 2.2, FIT_TIME = 2.4, SHEET_TIME = 1.6;
export const houses = []; // house plans being built (village.js fills this)
const SITE_DIST = 15; // walls this close to you when you give the order are his site
export const HEIGHTS = { windows: 6, full: 17 }; // courses: up to the window sills, up to the lintels

export const crew = [];
const listeners = new Set();
export const onCrewChange = (fn) => listeners.add(fn);
const changed = () => listeners.forEach((fn) => fn());
const reserved = new Set(); // brick spots a worker is on his way to

const NAMES = ['Karel', 'Tonda', 'Pepa', 'Mirek', 'Franta', 'Jirka', 'Honza', 'Vašek', 'Láďa', 'Standa'];
let nameIdx = Math.floor(Math.random() * NAMES.length);

// ───────── the model ─────────

const pick = (a) => a[Math.floor(Math.random() * a.length)];

// A person: a worker (hi-vis vest, hard hat) or a villager (own clothes and hair).
export function personMesh({ worker = true, scale = 1 } = {}) {
  const M = (o) => new THREE.MeshStandardMaterial(o);
  const shirtCol = worker ? pick([0x6a2f2a, 0x2f4f6a, 0x4a5a2c, 0x5a4636]) : pick([0xc0563e, 0x3d6f9e, 0xe0c25a, 0x6d8f4e, 0x9a5c8e, 0xe8e2d6, 0x37515f]);
  const m = {
    skin: M({ color: pick([0xd9a07a, 0xc98f68, 0xe2b08c, 0xa8724f]), roughness: 0.7 }),
    shirt: M({ color: shirtCol, roughness: 0.9 }),
    vest: M({ color: 0xff7a1a, emissive: 0x3a1500, roughness: 0.6 }),
    stripe: M({ color: 0xe6e6e0, roughness: 0.3, metalness: 0.2 }),
    pants: M({ color: worker ? 0x2f3b55 : pick([0x2f3b55, 0x4a3a2c, 0x3b3f44, 0x6b5a45]), roughness: 0.9 }),
    boots: M({ color: 0x2a2420, roughness: 0.8 }),
    hat: M({ color: worker ? 0xf2c12e : pick([0x3a2a1e, 0x1e1a18, 0x8a5a2e, 0xc9a66b, 0x6b6560]), roughness: worker ? 0.4 : 0.9 }),
  };
  const g = new THREE.Group();
  const box = (parent, w, h, d, x, y, z, mat) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, y, z);
    b.castShadow = true;
    parent.add(b);
    return b;
  };
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.1, 0.92, 0);
    g.add(hip);
    box(hip, 0.15, 0.84, 0.17, 0, -0.42, 0, m.pants);
    box(hip, 0.16, 0.1, 0.27, 0, -0.87, 0.04, m.boots);
    return hip;
  });
  const body = new THREE.Group(); // bends forward when he works
  body.position.y = 0.92;
  g.add(body);
  box(body, 0.42, 0.62, 0.24, 0, 0.31, 0, m.shirt);
  if (worker) {
    box(body, 0.44, 0.48, 0.26, 0, 0.3, 0, m.vest);
    box(body, 0.445, 0.05, 0.265, 0, 0.18, 0, m.stripe);
    box(body, 0.445, 0.05, 0.265, 0, 0.36, 0, m.stripe);
  }
  // neck from the top of the shirt (0.62) into the head, so it never floats
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 10), m.skin);
  neck.position.y = 0.66;
  body.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.82;
  body.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), m.skin);
  face.scale.set(1, 1.12, 1);
  face.castShadow = true;
  head.add(face);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2a211c, roughness: 0.5 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), eyeMat);
    eye.position.set(s * 0.042, 0.015, 0.108);
    head.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 0.03), m.skin);
  nose.position.set(0, -0.015, 0.12);
  head.add(nose);
  // a hard hat, or hair
  const hat = new THREE.Mesh(new THREE.SphereGeometry(worker ? 0.135 : 0.126, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.hat);
  hat.position.set(0, worker ? 0.05 : 0.02, worker ? 0 : -0.01);
  if (!worker) hat.scale.set(1, 1.05, 1.08);
  hat.castShadow = true;
  head.add(hat);
  if (worker) {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 16), m.hat);
    brim.position.set(0, 0.05, 0.03);
    head.add(brim);
  }
  const arms = [-1, 1].map((s) => {
    const sh = new THREE.Group();
    sh.position.set(s * 0.28, 0.58, 0);
    body.add(sh);
    box(sh, 0.11, 0.56, 0.12, 0, -0.28, 0, m.shirt);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), m.skin);
    hand.position.y = -0.6;
    sh.add(hand);
    return sh;
  });
  // the bricks he carries, held in front against his chest
  const load = new THREE.Group();
  load.position.set(0, 0.2, 0.32);
  body.add(load);
  const bm = new THREE.MeshStandardMaterial({ map: TEX.brick, color: 0xa85a40, roughness: 0.9 });
  for (let i = 0; i < 4; i++) box(load, BRICK.l * 0.9, BRICK.h * 0.9, BRICK.d * 0.9, 0, i * 0.125, 0, bm);
  load.visible = false;
  // a door/window crate, or a roofing sheet, carried on edge in front of him
  const crate = box(body, 0.9, 0.7, 0.1, 0, 0.2, 0.36, M({ map: TEX.grain, color: 0xc4a274, roughness: 0.85 }));
  crate.visible = false;
  const sheet = box(body, 0.9, 1.6, 0.03, 0, 0.35, 0.36, M({ map: TEX.sheet, color: 0x8a3428, roughness: 0.55, metalness: 0.25 }));
  sheet.visible = false;
  g.scale.setScalar(scale);
  return { g, legs, arms, body, head, load, crate, sheet };
}

// ───────── finding a way: a small grid around the trip, walls and trees blocked ─────────

const NAV = 0.3, PAD = 6;

export function findPath(from, to) {
  const x0 = Math.min(from.x, to.x) - PAD, z0 = Math.min(from.z, to.z) - PAD;
  const nx = Math.ceil((Math.max(from.x, to.x) + PAD - x0) / NAV) + 1, nz = Math.ceil((Math.max(from.z, to.z) + PAD - z0) / NAV) + 1;
  if (nx * nz > 90000) return [to.clone()];
  const blocked = new Uint8Array(nx * nz);
  const mark = (x, z, r) => {
    const i0 = Math.max(0, Math.floor((x - r - x0) / NAV)), i1 = Math.min(nx - 1, Math.ceil((x + r - x0) / NAV));
    const j0 = Math.max(0, Math.floor((z - r - z0) / NAV)), j1 = Math.min(nz - 1, Math.ceil((z + r - z0) / NAV));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = x0 + i * NAV, cz = z0 + j * NAV;
      if ((cx - x) ** 2 + (cz - z) ** 2 <= r * r) blocked[j * nx + i] = 1;
    }
  };
  for (const t of trees) {
    if (!t.alive || t.x < x0 - 1 || t.x > x0 + nx * NAV + 1 || t.z < z0 - 1 || t.z > z0 + nz * NAV + 1) continue;
    mark(t.x, t.z, t.r + 0.35);
  }
  // the pickup is in the way too (a row of circles along it: it is 4.6 m long, 2 m wide with the fenders)
  for (let k = -2.2; k <= 2.2; k += 0.55) {
    const p = car.body.pointToWorldFrame(new CANNON.Vec3(k, 0, 0));
    if (p.x > x0 - 2 && p.x < x0 + nx * NAV + 2 && p.z > z0 - 2 && p.z < z0 + nz * NAV + 2) mark(p.x, p.z, 1.15);
  }
  // walls from knee height up block him; doors don't (he opens them)
  const v = new THREE.Vector3();
  for (const w of walls) {
    for (const r of w.bricks) {
      if (r.kind === 'door' || r.iy + r.H - 1 < 2 || r.iy > 12) continue;
      for (const [cx, cz] of cellsOf(r.o, r.ix, r.iz, r.L)) {
        w.world((cx + 0.5) * U, (cz + 0.5) * U, v);
        if (v.x < x0 - 1 || v.x > x0 + nx * NAV + 1 || v.z < z0 - 1 || v.z > z0 + nz * NAV + 1) continue;
        mark(v.x, v.z, 0.38);
      }
    }
  }
  const cell = (p) => [clamp(Math.round((p.x - x0) / NAV), 0, nx - 1), clamp(Math.round((p.z - z0) / NAV), 0, nz - 1)];
  // the nearest free cell (he may start or end right next to a wall)
  const free = ([i, j]) => {
    for (let r = 0; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < nx && b < nz && !blocked[b * nx + a]) return [a, b];
    }
    return null;
  };
  const s = free(cell(from)), e = free(cell(to));
  if (!s || !e) return null;
  // A*, 8 neighbours
  const N = nx * nz, g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const si = s[1] * nx + s[0], ei = e[1] * nx + e[0];
  const h = (i) => { const dx = Math.abs((i % nx) - e[0]), dz = Math.abs(Math.floor(i / nx) - e[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  const open = [si];
  const f = new Float32Array(N).fill(Infinity);
  g[si] = 0; f[si] = h(si);
  let found = false, steps = 0;
  while (open.length && steps++ < 40000) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const c = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (c === ei) { found = true; break; }
    closed[c] = 1;
    const ci = c % nx, cj = Math.floor(c / nx);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const a = ci + di, b = cj + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const n = b * nx + a;
      if (blocked[n] || closed[n]) continue;
      if (di && dj && (blocked[cj * nx + a] || blocked[b * nx + ci])) continue; // no cutting corners
      const ng = g[c] + (di && dj ? 1.414 : 1);
      if (ng < g[n]) {
        if (g[n] === Infinity) open.push(n);
        g[n] = ng; f[n] = ng + h(n); came[n] = c;
      }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let c = ei; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  // straighten it: keep only the corners where a straight walk would hit something
  const sees = (a, b) => {
    const ax = a % nx, az = Math.floor(a / nx), bx = b % nx, bz = Math.floor(b / nx);
    const n = Math.max(Math.abs(bx - ax), Math.abs(bz - az)) * 2;
    for (let k = 1; k < n; k++) {
      const x = Math.round(ax + ((bx - ax) * k) / n), z = Math.round(az + ((bz - az) * k) / n);
      if (blocked[z * nx + x]) return false;
    }
    return true;
  };
  const out = [];
  let anchor = cells[0];
  for (let k = 1; k < cells.length; k++) {
    if (!sees(anchor, cells[k])) { anchor = cells[k - 1]; out.push(anchor); }
  }
  const pts = out.map((c) => new THREE.Vector3(x0 + (c % nx) * NAV, 0, z0 + Math.floor(c / nx) * NAV));
  pts.push(to.clone());
  return pts;
}

// ───────── the plan: raise the walls you started ─────────

// Your first course is the plan: every grid column with something in course 0.
function footprint(w) {
  const cols = new Map();
  for (const r of w.bricks) {
    if (r.iy !== 0) continue;
    for (const [x, z] of cellsOf(r.o, r.ix, r.iz, r.L)) cols.set(`${x},${z}`, { x, z, o: r.o });
  }
  return cols;
}

// The next brick to lay: the lowest free, supported spot, in running bond, corners bonded.
// sources: [{ w, cols, height, start, skip }] — cols: the columns to build (Map "x,z" → {x, z, o}),
// start: the first course to build (0 for a plan, 1 when your first course is there),
// skip: "x,z,c" cells kept free for doors and windows.
// Nobody works on top of another: a spot within SPOT_HARD of where someone else is laying is taken
// off the list (all of them → WAIT: he makes room and looks again in a moment); within SPOT_SOFT of
// someone it comes last in its course.
const SPOT_HARD = 0.95, SPOT_SOFT = 1.9, APART = 0.6;
const WAIT = { wait: true };
function nextBrick(sources, from, self) {
  let best = null, hard = 0;
  const others = [];
  for (const o of crew) {
    if (o === self || o.leaving) continue;
    if (o.task) others.push({ x: o.task.pos.x, z: o.task.pos.z, hard: true });
    others.push({ x: o.pos.x, z: o.pos.z, hard: false });
  }
  for (const { w, cols, height, start, skip } of sources) {
    const has = (x, z) => cols.has(`${x},${z}`);
    const under = (x, z, c) => c === 0 || w.cells.has(key(x, z, c - 1));
    for (let c = start; c < height; c++) {
      if (best && best.iy < c) break;
      for (const col of cols.values()) {
        const { x, z } = col;
        const k = key(x, z, c);
        if (w.cells.has(k) || skip?.has(k) || reserved.has(w.id + k) || !under(x, z, c)) continue;
        const corner = (has(x + 1, z) || has(x - 1, z)) && (has(x, z + 1) || has(x, z - 1));
        const o = corner ? (col.o + c) % 2 : col.o;
        const step = o ? [0, 1] : [1, 0];
        const okCell = (cx, cz) => has(cx, cz) && !w.cells.has(key(cx, cz, c)) && !skip?.has(key(cx, cz, c)) && !reserved.has(w.id + key(cx, cz, c)) && under(cx, cz, c);
        // a whole brick that doesn't sit exactly on the one below it (that would be stack bond)
        const same = (sx, sz) => { const b = w.cells.get(key(sx, sz, c - 1)); return b && b.kind === 'brick' && b.L === 2 && b.o === o && b.ix === sx && b.iz === sz; };
        let t = null;
        for (const dir of [1, -1]) {
          const sx = dir > 0 ? x : x - step[0], sz = dir > 0 ? z : z - step[1];
          const ox = sx + step[0], oz = sz + step[1];
          if (okCell(sx, sz) && okCell(ox, oz) && !same(sx, sz)) { t = { w, o, ix: sx, iz: sz, iy: c, L: 2 }; break; }
        }
        t ??= { w, o, ix: x, iz: z, iy: c, L: 1 };
        const [lx, lz] = centre(t.o, t.ix, t.iz, t.L);
        t.pos = w.world(lx, lz);
        t.pos.y = w.y0 + c * MY;
        let crowd = 0, blocked = false;
        for (const o of others) {
          const dd = Math.hypot(o.x - t.pos.x, o.z - t.pos.z);
          if (o.hard && dd < SPOT_HARD) { blocked = true; break; }
          if (dd < SPOT_SOFT) crowd = 1;
        }
        if (blocked) { hard++; continue; }
        const d = t.pos.distanceToSquared(from) + crowd * 400; // (400 = 20 m: a crowded spot is the last choice)
        if (!best || c < best.iy || d < best.d) best = { ...t, d };
      }
    }
  }
  return best ?? (hard ? WAIT : null);
}

// How many other workers stand near a point (to pick the side of a wall with room).
function crowdAt(self, p) {
  let n = 0;
  for (const o of crew) if (o !== self && !o.leaving && Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 1.3) n++;
  return n;
}

const spotsOf = (t) => cellsOf(t.o, t.ix, t.iz, t.L).map(([x, z]) => t.w.id + key(x, z, t.iy));

// ───────── house plans: what's next on a house ─────────
// A house (village.js) gives: id, wall, cols, height, skip, fits [{kind, o, ix, iz, iy, L, H, placed}],
// state, wallsDone(), startRoof(), roof [{done, pos, stand}], addSheet(i), finish().

const fitReady = (h, f) => f.iy === 0 || cellsOf(f.o, f.ix, f.iz, f.L).every(([x, z]) => h.wall.cells.has(key(x, z, f.iy - 1)));

function houseJob(from, carry, self) {
  // whatever is already in his arms goes in first
  if (carry) {
    for (const h of houses) {
      if (h.state === 'done') continue;
      if (carry === 'sheet' && h.roof) {
        const i = h.roof.findIndex((s, k) => !s.done && !reserved.has(`${h.id}:r${k}`));
        if (i >= 0) return { type: 'sheet', h, i };
      } else if (carry !== 'sheet') {
        const i = h.fits.findIndex((f, k) => f.kind === carry && !f.placed && !reserved.has(`${h.id}:f${k}`) && fitReady(h, f));
        if (i >= 0) return { type: 'fit', h, f: h.fits[i], i };
      }
    }
  }
  let wait = null;
  for (const h of houses) {
    if (h.state === 'done') continue;
    h.wall.id ??= `h${h.id}:`;
    for (let i = 0; i < h.fits.length; i++) {
      const f = h.fits[i];
      if (!f.placed && !reserved.has(`${h.id}:f${i}`) && fitReady(h, f)) return { type: 'fit', h, f, i };
    }
    const t = nextBrick([{ w: h.wall, cols: h.cols, height: h.height, start: 0, skip: h.skip }], from, self);
    if (t === WAIT) { wait ??= 'Making room for the others'; continue; }
    if (t) return { type: 'brick', t };
    if (!h.wallsDone()) { wait ??= 'Waiting for the others to finish'; continue; }
    h.startRoof();
    const i = h.roof.findIndex((s, k) => !s.done && !reserved.has(`${h.id}:r${k}`));
    if (i >= 0) return { type: 'sheet', h, i };
    if (h.roof.every((s) => s.done)) { h.finish(); continue; }
    wait ??= 'Waiting for the others to finish';
  }
  return wait ? { type: 'wait', msg: wait } : null;
}

// A floor somebody paid for, whose walls are up and that nobody is laying yet (the nearest one).
function floorJob(from) {
  let best = null, bd = Infinity;
  for (const h of houses) {
    for (const p of h.floors) {
      if (p.worker || p.rows >= p.total || !h.wallsDone()) continue;
      const d = h.centre.distanceToSquared(from);
      if (d < bd) { bd = d; best = { h, p }; }
    }
  }
  return best;
}

// a roofing sheet lying around that nobody is holding or has nailed down
const looseSheet = (from) => {
  let best = null, bd = Infinity;
  for (const p of pieces) {
    if (p.kind !== 'sheet' || p.held || p.dead || p.joints.size || p.body.type === CANNON.Body.STATIC || reserved.has(`sheet${p.id}`)) continue;
    const d = (p.body.position.x - from.x) ** 2 + (p.body.position.z - from.z) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
};

// ───────── a worker ─────────

let nextWallId = 1;
const wallId = (w) => (w.id ??= `w${nextWallId++}:`);

export class Worker {
  // saved: a loaded game (he is already here, where he was)
  constructor(trade, saved) {
    this.name = saved?.name ?? NAMES[nameIdx++ % NAMES.length];
    this.trade = trade;
    this.m = personMesh();
    this.carry = null; // 'door' | 'window' | 'sheet'
    game.scene.add(this.m.g);
    // he arrives on foot from the end of the road
    const p = saved ?? road.approach[road.approach.length - 1];
    this.pos = new THREE.Vector3(p.x, terrainHeight(p.x, p.z), p.z);
    this.yaw = -Math.PI / 2;
    this.bricks = 0;
    this.halves = 0;
    this.mortar = 0;
    this.order = null;
    this.path = null;
    this.state = 'idle';
    this.t = 0;
    this.ph = 0;
    this.status = 'On his way to you';
    this.thinkT = 0;
    this.body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: GROUP.PLAYER | GROUP.PIECE });
    this.body.addShape(new CANNON.Cylinder(0.25, 0.25, 1.7, 8), new CANNON.Vec3(0, 0.85, 0));
    this.body.worker = this;
    this.body.position.set(this.pos.x, this.pos.y, this.pos.z);
    world.addBody(this.body);
    if (saved) {
      this.yaw = this.yawGoal = saved.yaw;
      Object.assign(this, { bricks: saved.bricks, halves: saved.halves, mortar: saved.mortar, carry: saved.carry, unpaid: saved.unpaid, order: saved.order });
      this.status = this.order ? 'Back to work' : 'Waiting for orders';
      this.thinkT = 0.5 + Math.random();
      return;
    }
    this.goTo(this.nearYou(), 'arrive');
  }

  nearYou() {
    const p = game.player.body.position;
    const d = new THREE.Vector3(this.pos.x - p.x, 0, this.pos.z - p.z);
    if (d.lengthSq() < 0.01) d.set(1, 0, 0);
    let i = crew.indexOf(this);
    if (i < 0) i = crew.length;
    d.setLength(1.8).applyAxisAngle(new THREE.Vector3(0, 1, 0), (i % 6) * 0.7); // not all on one spot
    return new THREE.Vector3(p.x + d.x, 0, p.z + d.z);
  }

  setStatus(s) {
    if (s === this.status) return;
    this.status = s;
    changed();
  }

  goTo(target, then) {
    this.path = findPath(this.pos, target);
    this.after = then;
    if (!this.path) { this.state = 'idle'; this.thinkT = 1.5; return false; }
    this.state = 'walk';
    return true;
  }

  // ── orders from the phone ──
  raise(height) {
    const p = game.player.body.position;
    const site_ = walls.filter((w) => [...w.bricks].some((b) => Math.hypot(b.pos.x - p.x, b.pos.z - p.z) < SITE_DIST));
    if (!site_.length) return 'Lay the first course of your walls yourself, then he raises them.';
    site_.forEach(wallId);
    this.order = { walls: site_, height };
    this.release();
    this.state = 'idle';
    this.thinkT = 0;
    this.setStatus('Starting');
    return null;
  }
  // the walls you built near you get a roof: he levels them first, then rafters and the sheets you bought
  roofIt() {
    const { house, wall, room, why } = roofHere(game.player.body.position);
    if (why) return why;
    if (wall) wallId(wall);
    this.order = { kind: 'roof', house: house ?? wall.house ?? null, wall, height: room?.height };
    this.release();
    this.state = 'idle';
    this.thinkT = 0;
    this.setStatus('Starting');
    return null;
  }
  buildHouses() {
    if (!houses.some((h) => h.state !== 'done')) return 'Mark out a house first (Village app).';
    this.order = { kind: 'houses' };
    this.release();
    this.state = 'idle';
    this.thinkT = 0;
    this.setStatus('Starting');
    return null;
  }
  // let go: he puts down what he carries and walks back up the road
  leave() {
    if (this.leaving) return;
    this.order = null;
    this.release();
    if (this.carry) this.putDown();
    this.leaving = true;
    this.setStatus('Going home');
    const p = road.approach[road.approach.length - 1];
    if (!this.goTo(new THREE.Vector3(p.x, 0, p.z), () => this.gone())) this.gone();
  }
  gone() {
    game.scene.remove(this.m.g);
    world.removeBody(this.body);
    crew.splice(crew.indexOf(this), 1);
    changed();
  }

  stop() {
    this.order = null;
    this.release();
    this.goTo(this.nearYou(), 'arrive');
    this.setStatus('Coming to you');
  }
  release() {
    this.dropFloor();
    if (this.task) for (const s of spotsOf(this.task)) reserved.delete(s);
    if (this.job?.key) reserved.delete(this.job.key);
    this.task = null;
    this.job = null;
  }

  // ── what to do next ──
  think() {
    this.thinkT = 2;
    if (this.leaving) return;
    if (this.unpaid) {
      // as soon as there is money again, he takes his hour's pay and goes back to work
      if (spend(WAGE, `Wages · ${this.name}`)) this.unpaid = false;
      else { this.release(); this.setStatus('Not paid — waiting for his wages'); return; }
    }
    // a floor somebody paid for comes first (unless he is raising your own walls)
    if (!this.order || this.order.kind === 'houses') {
      const fj = floorJob(this.pos);
      if (fj) return this.doFloor(fj);
    }
    if (!this.order) { this.setStatus('Waiting for orders'); return; }
    if (this.order.kind === 'roof') return this.doRoof();
    let t;
    if (this.order.kind === 'houses') {
      const job = houseJob(this.pos, this.carry, this);
      if (!job) {
        this.setStatus('Done: every house is built');
        game.hud.toast(`${this.name}: all the houses are built.`);
        this.order = null;
        this.goTo(this.nearYou(), 'arrive');
        return;
      }
      if (job.type === 'wait') { this.setStatus(job.msg); this.thinkT = 0.7; return; }
      if (job.type === 'fit') return this.doFit(job);
      if (job.type === 'sheet') return this.doSheet(job);
      if (this.carry) this.putDown(); // bricks need both hands
      t = job.t;
      if (this.bricks <= 0 || this.mortar <= 0) return this.fetch();
    } else {
      if (this.bricks <= 0 || this.mortar <= 0) return this.fetch();
      t = nextBrick(this.order.walls.map((w) => ({ w, cols: footprint(w), height: this.order.height, start: 1 })), this.pos, this);
      if (t === WAIT) { this.setStatus('Making room for the others'); this.thinkT = 0.7; return; }
      if (!t) {
        this.setStatus('Done: the walls are up');
        game.hud.toast(`${this.name}: the walls are up to ${this.order.height === HEIGHTS.full ? 'full height' : 'the windows'}.`);
        this.order = null;
        this.goTo(this.nearYou(), 'arrive');
        return;
      }
    }
    this.layAt(t);
  }

  // "Roof it": your own walls are levelled first (bricks that stick up come off, gaps and low spots are
  // filled), then they become a house; then the next sheet nobody is on, until they are all on
  doRoof() {
    const o = this.order;
    if (!o.house && o.wall.house) o.house = o.wall.house; // (another worker finished the levelling)
    if (!o.house) {
      const w = o.wall, room = w.room;
      // off the top first: the highest brick over the line (nothing is ever on top of it)
      let top = null;
      for (const b of w.bricks) {
        if (b.kind !== 'brick' || b.iy < room.height || spotsOf({ ...b, w }).some((s) => reserved.has(s))) continue;
        const d = b.pos.distanceToSquared(this.pos);
        if (!top || b.iy > top.iy || (b.iy === top.iy && d < top.d)) top = { r: b, iy: b.iy, d };
      }
      if (top) {
        const r = top.r;
        return this.layAt({ w, o: r.o, ix: r.ix, iz: r.iz, iy: r.iy, L: r.L, pos: r.pos.clone(), knock: r });
      }
      // then up to the line all round, gaps in the first course too
      const t = nextBrick([{ w, cols: room.cols, height: room.height, start: 0, skip: room.skip }], this.pos, this);
      if (t === WAIT) { this.setStatus('Making room for the others'); this.thinkT = 0.7; return; }
      if (t) {
        // ground higher than that course (the wall starts above it there): nothing to lay, don't walk over
        const c = check(t.w, t.o, t.ix, t.iz, t.iy, t.L, 1);
        if (!c.ok && c.why === 'The ground is in the way') {
          for (const [x, z] of cellsOf(t.o, t.ix, t.iz, t.L)) room.skip.add(key(x, z, t.iy));
          this.thinkT = 0;
          return;
        }
        if (this.carry) this.putDown(); // bricks need both hands
        if (this.bricks <= 0 || this.mortar <= 0) return this.fetch();
        return this.layAt(t);
      }
      // someone is still on a brick here: wait for him
      if ([...reserved].some((s) => s.startsWith(w.id))) { this.setStatus('Waiting for the others to finish'); this.thinkT = 0.7; return; }
      o.house = w.house = ownHouse(w, room);
    }
    const r = o.house;
    if (r.state === 'plan') r.startRoof();
    const i = r.roof.findIndex((s, k) => !s.done && !reserved.has(`${r.id}:r${k}`));
    if (i >= 0) return this.doSheet({ h: r, i });
    if (r.roof.some((s) => !s.done)) { this.setStatus('Waiting for the others to finish'); this.thinkT = 0.7; return; }
    if (r.state !== 'done') { r.finish(); game.hud.toast(`${this.name}: the roof is on!`); }
    this.setStatus('Done: the roof is on');
    this.order = null;
    this.goTo(this.nearYou(), 'arrive');
  }

  // the floor: in through the door, to the back wall, and lay it row by row towards the door
  doFloor({ h, p }) {
    if (this.carry) this.putDown();
    p.worker = this;
    this.floorJob = { h, p };
    this.setStatus('Laying the floor');
    const spot = h.wall.world((p.x0 + p.x1) / 2, this.floorZ(p));
    if (!this.goTo(spot, () => { this.state = 'floor'; this.t = ROW_TIME; })) {
      this.dropFloor();
      this.setStatus('Can\'t get to the floor');
    }
  }
  // where he stands: a step in front of the boards he laid last (the unlaid side, towards the door)
  floorZ(p) { return clamp(p.z1 - p.rows * p.pitch - 0.45, p.z0 + 0.05, p.z1 - 0.3); }
  dropFloor() {
    const j = this.floorJob;
    if (j && j.p.worker === this) j.p.worker = null;
    this.floorJob = null;
  }
  finishFloor() {
    const { h } = this.floorJob;
    this.dropFloor();
    this.state = 'idle';
    this.thinkT = 0.3;
    game.hud.toast(`${this.name}: the floor in ${h.the} is laid.`);
  }

  // bricks and mortar
  fetch() {
    if (this.bricks <= 0) { // (a spare half is kept for the next half-brick gap, but he needs whole ones)
      const pal = nearest([...things].filter((t) => t.kind === 'pallet' && t.count > 0), this.pos);
      if (!pal) { this.setStatus('Waiting for bricks — order a pallet'); return; }
      this.setStatus('Fetching bricks');
      this.goTo(beside(pal.body.position, this.pos, 0.95, this.slotNo()), () => {
        if (pal.dead || pal.count <= 0) return this.think();
        const n = Math.min(CARRY, pal.count);
        pal.count -= n;
        pal.fit();
        this.bricks = Math.max(0, this.bricks) + n;
        this.state = 'take'; this.t = TAKE_TIME;
        if (this.near()) audio.brick();
      });
      return;
    }
    if (this.mortar <= 0) {
      const bag = nearest([...things].filter((t) => t.kind === 'bag'), this.pos);
      if (!bag) { this.setStatus('Waiting for mortar — order a bag'); return; }
      this.setStatus('Mixing mortar');
      this.goTo(beside(bag.body.position, this.pos, 0.8, this.slotNo()), () => {
        if (bag.dead) return this.think();
        bag.remove();
        this.mortar = BAG;
        this.state = 'mix'; this.t = MIX_TIME;
        if (this.near()) audio.bag();
      });
    }
  }

  // stand beside the wall, on whichever side he can get to, and do something there
  reach(pos, across, dist, then) {
    const sides = [1, -1].map((s) => new THREE.Vector3(pos.x + across.x * s * dist, 0, pos.z + across.z * s * dist))
      .sort((a, b) => a.distanceToSquared(this.pos) - b.distanceToSquared(this.pos));
    if (Math.hypot(this.pos.x - sides[0].x, this.pos.z - sides[0].z) < 0.3) { then(); return true; }
    for (const s of sides) if (this.goTo(s, then)) return true;
    return false;
  }

  // a door or window: fetch its crate, carry it over, set it
  doFit(job) {
    const { h, f, i } = job;
    this.job = { key: `${h.id}:f${i}` };
    reserved.add(this.job.key);
    if (this.carry && this.carry !== f.kind) this.putDown();
    if (this.carry !== f.kind) {
      const crate = nearest([...things].filter((t) => t.kind === 'crate' && t.fit === f.kind && !reserved.has(`crate${t.body.id}`)), this.pos);
      if (!crate) { this.release(); this.setStatus(`Waiting for a ${f.kind} — order one in the shop`); return; }
      this.setStatus(`Fetching a ${f.kind}`);
      reserved.add(`crate${crate.body.id}`);
      this.goTo(beside(crate.body.position, this.pos, 1.0, this.slotNo()), () => {
        reserved.delete(`crate${crate.body.id}`);
        if (crate.dead) return this.release();
        crate.remove();
        this.carry = f.kind;
        this.state = 'take'; this.t = TAKE_TIME;
        this.release(); // think again: the fit is still free, or someone else set it
      });
      return;
    }
    const [lx, lz] = centre(f.o, f.ix, f.iz, f.L);
    const pos = h.wall.world(lx, lz);
    pos.y = h.wall.y0 + f.iy * MY;
    this.setStatus(`Setting the ${f.kind}`);
    const ok = this.reach(pos, f.o ? h.wall.ex : h.wall.ez, 0.9, () => {
      this.state = 'fit'; this.t = FIT_TIME; this.face(pos);
      this.fitJob = job;
    });
    if (!ok) { this.release(); this.setStatus('Can\'t get to the wall'); }
  }

  // put down what he carries (it isn't needed now): a crate goes back on the ground, a sheet too
  putDown() {
    const at = { x: this.pos.x + Math.sin(this.yaw) * 0.8, y: terrainHeight(this.pos.x, this.pos.z) + 0.2, z: this.pos.z + Math.cos(this.yaw) * 0.8 };
    if (this.carry === 'sheet') new Piece('sheet', { w: 1.0, t: 0.012, len: 2.0 }, at, new CANNON.Quaternion().setFromEuler(Math.PI / 2, this.yaw, 0, 'YXZ'));
    else if (this.carry) new FitCrate(this.carry, at, new CANNON.Quaternion().setFromEuler(0, this.yaw, 0));
    this.carry = null;
  }

  finishFit() {
    const { h, f } = this.fitJob;
    this.fitJob = null;
    const r = workerFit({ w: h.wall, o: f.o, ix: f.ix, iz: f.iz, iy: f.iy, L: f.L, H: f.H, kind: f.kind });
    this.release();
    if (!r) return;
    f.placed = true;
    f.rec = r;
    this.carry = null;
    if (this.near()) audio.thud(0.6);
  }

  // the roof: fetch a roofing sheet, climb up and nail it on
  doSheet(job) {
    const { h, i } = job;
    this.job = { key: `${h.id}:r${i}` };
    reserved.add(this.job.key);
    if (this.carry && this.carry !== 'sheet') this.putDown();
    if (!this.carry) {
      const s = looseSheet(this.pos);
      if (!s) { this.release(); this.setStatus('Waiting for roofing sheets — order some'); return; }
      this.setStatus('Fetching a roofing sheet');
      reserved.add(`sheet${s.id}`);
      this.goTo(beside(s.body.position, this.pos, 0.9, this.slotNo()), () => {
        reserved.delete(`sheet${s.id}`);
        if (s.dead || s.held || s.joints.size) return this.release();
        s.destroy();
        this.carry = 'sheet';
        this.state = 'take'; this.t = TAKE_TIME;
        this.release();
      });
      return;
    }
    const slot = h.roof[i];
    this.setStatus('Putting the roof on');
    if (!this.goTo(slot.stand, () => { this.state = 'roof'; this.t = SHEET_TIME; this.face(slot.pos); this.roofJob = job; })) {
      this.release();
      this.setStatus('Can\'t get to the roof');
    }
  }

  finishSheet() {
    const { h, i } = this.roofJob;
    this.roofJob = null;
    this.release();
    if (h.roof[i].done) return;
    h.addSheet(i);
    this.carry = null;
    if (this.near()) audio.nailHit?.(true);
  }

  layAt(t) {
    const across = t.o ? t.w.ex : t.w.ez;
    // the side of the wall that is nearer and has fewer people on it
    const sides = [1, -1].map((s) => new THREE.Vector3(t.pos.x + across.x * s * 0.75, 0, t.pos.z + across.z * s * 0.75))
      .sort((a, b) => (a.distanceToSquared(this.pos) + crowdAt(this, a) * 9) - (b.distanceToSquared(this.pos) + crowdAt(this, b) * 9));
    this.task = t;
    for (const s of spotsOf(t)) reserved.add(s);
    this.setStatus(t.knock ? `Levelling your walls · knocking off a brick in course ${t.iy + 1}` : `${this.order.kind === 'roof' ? 'Levelling your walls · ' : ''}Laying bricks · course ${t.iy + 1} of ${this.order.height ?? HEIGHTS.full}`);
    const lay = () => { this.state = 'lay'; this.t = t.knock ? KNOCK_TIME : LAY_TIME; this.face(t.pos); };
    if (Math.hypot(this.pos.x - t.pos.x, this.pos.z - t.pos.z) < 1.0 && this.path === null) return lay();
    for (const s of sides) if (this.goTo(s, lay)) return;
    this.release();
    this.setStatus('Can\'t get to the wall');
  }

  finishLay() {
    const t = this.task;
    this.release();
    if (!t) return;
    if (t.knock) {
      // it comes off whole: he keeps it for a low spot
      if (!workerKnock(t.knock, this.near())) return;
      if (t.L === 1) this.halves++;
      else this.bricks = Math.max(0, this.bricks) + 1;
      return;
    }
    const r = workerLay(t, this.near());
    if (!r) {
      // something got in the way (you, standing there): try the next one
      // (levelling: a spot that won't take a brick, like ground too far down, is left out, or he'd try forever)
      if (t.w.room) for (const [x, z] of cellsOf(t.o, t.ix, t.iz, t.L)) t.w.room.skip.add(key(x, z, t.iy));
      return;
    }
    if (t.L === 1 && this.halves) this.halves--;
    else if (t.L === 1) { this.bricks--; this.halves++; }
    else this.bricks--;
    this.mortar--;
  }

  near() { return this.pos.distanceTo(game.camera.position) < 14; }
  slotNo() { return Math.max(0, crew.indexOf(this)); } // 0, 1, 2…: his place in the crew (to fan out round a pallet)

  // Two workers never stand on top of each other: whoever isn't walking is pushed aside a little.
  // (A walker is never pushed: two heading for the same spot would tug at each other and never arrive.)
  keepApart(dt) {
    if (this.state === 'walk' || this.state === 'floor') return;
    for (const o of crew) {
      if (o === this || o.leaving || o.inCar) continue;
      let dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d = Math.hypot(dx, dz);
      if (d >= APART) continue;
      if (d < 1e-3) { const a = this.slotNo() * 2.4; dx = Math.cos(a); dz = Math.sin(a); d = 0; } else { dx /= d; dz /= d; }
      // (he pushes half; if the other is walking he gets out of his way fully)
      const push = (APART - d) * Math.min(1, dt * 6) * (o.state === 'walk' ? 1 : 0.5);
      this.pos.x += dx * push;
      this.pos.z += dz * push;
    }
  }
  face(p) { this.yawGoal = Math.atan2(p.x - this.pos.x, p.z - this.pos.z); }

  update(dt) {
    const a = this.m;
    let walking = false;
    if (this.state === 'walk') {
      const wp = this.path[0];
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.08) {
        this.path.shift();
        if (!this.path.length) {
          this.path = null;
          this.state = 'idle';
          this.thinkT = 0.3;
          const then = this.after;
          this.after = null;
          if (typeof then === 'function') then();
          else if (then === 'arrive') { this.setStatus(this.order ? this.status : 'Waiting for orders'); this.face(game.player.body.position); }
        }
      } else {
        const s = Math.min(d, SPEED * dt);
        this.pos.x += (dx / d) * s;
        this.pos.z += (dz / d) * s;
        this.yawGoal = Math.atan2(dx, dz);
        walking = true;
        // doors open as he comes to them
        for (const r of doors) if (!r.open && r.pos.distanceTo(this.pos) < 1.3) r.open = true;
      }
    } else if (this.state === 'take' || this.state === 'mix' || this.state === 'lay' || this.state === 'fit' || this.state === 'roof') {
      this.t -= dt;
      if (this.t <= 0) {
        if (this.state === 'lay') this.finishLay();
        else if (this.state === 'fit') this.finishFit();
        else if (this.state === 'roof') this.finishSheet();
        this.state = 'idle';
        this.thinkT = 0.15;
      }
    } else if (this.state === 'floor' && this.floorJob) {
      const { h, p } = this.floorJob;
      this.t -= dt;
      if (this.t <= 0) {
        h.layRow(p, true);
        this.t = ROW_TIME;
        if (p.rows >= p.total) this.finishFloor();
      }
      if (this.state === 'floor') {
        // he works his way back to the door, a step ahead of the boards
        const goal = h.wall.world((p.x0 + p.x1) / 2, this.floorZ(p));
        const k = Math.min(1, dt * 3), dx = goal.x - this.pos.x, dz = goal.z - this.pos.z;
        this.pos.x += dx * k;
        this.pos.z += dz * k;
        walking = Math.hypot(dx, dz) > 0.06;
        this.face(h.wall.world((p.x0 + p.x1) / 2, p.z1 - p.rows * p.pitch + 0.3));
      }
    } else if (this.state === 'floor') {
      this.state = 'idle'; // (the job was taken away from him)
    } else if (this.state === 'idle') {
      this.thinkT -= dt;
      if (this.thinkT <= 0) this.think();
    }

    this.keepApart(dt);
    this.pos.y = standY(this.pos.x, this.pos.z); // (on a house's plinth, if he's on one)
    if (this.yawGoal !== undefined) {
      let dy = this.yawGoal - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += clamp(dy, -dt * 8, dt * 8);
    }
    // the kinematic body follows him, so you bump into him instead of walking through
    if (dt > 0) this.body.velocity.set((this.pos.x - this.body.position.x) / dt, 0, (this.pos.z - this.body.position.z) / dt);
    this.body.position.set(this.pos.x, this.pos.y, this.pos.z);

    // ── animation ──
    a.g.position.copy(this.pos);
    a.g.rotation.y = this.yaw;
    this.ph += dt * (walking ? 8 : 0);
    const sw = walking ? Math.sin(this.ph) : 0;
    // a crate or a sheet in his arms (a real boolean: three.js only hides `visible === false`, not null)
    const big = !!this.carry && this.state !== 'fit' && this.state !== 'roof';
    const carrying = !big && this.bricks > 0 && this.state !== 'lay' && this.state !== 'floor';
    a.legs[0].rotation.x = sw * 0.55;
    a.legs[1].rotation.x = -sw * 0.55;
    a.load.visible = carrying;
    a.load.children.forEach((b, i) => { b.visible = i < Math.ceil(this.bricks / 2); });
    a.crate.visible = big && this.carry !== 'sheet';
    a.sheet.visible = big && this.carry === 'sheet';
    let bend = 0, armR = -sw * 0.5, armL = sw * 0.5;
    if (carrying) { armR = armL = -1.15; }
    if (big) { armR = armL = -0.9; }
    if (this.state === 'fit' || this.state === 'roof') {
      // lift it into place: up high for the roof
      const T = this.state === 'fit' ? FIT_TIME : SHEET_TIME, u = 1 - this.t / T;
      const lift = this.state === 'roof' ? -2.6 : -1.3;
      armR = armL = lift * Math.sin(Math.min(1, u * 1.6) * Math.PI / 2) + Math.sin(u * 30) * 0.06;
      a.head.rotation.x = this.state === 'roof' ? -0.5 * Math.sin(u * Math.PI) : 0;
    } else a.head.rotation.x = 0;
    if (this.state === 'lay' && this.task) {
      // reach for the spot: low courses bend him down, high ones lift his arms
      const u = 1 - this.t / LAY_TIME, h = this.task.pos.y - this.pos.y;
      const reach = Math.sin(u * Math.PI);
      bend = clamp(0.9 - h * 0.7, 0, 0.9) * reach;
      armR = (-0.6 - clamp(h - 0.6, 0, 1.6)) * reach - 0.2;
      armL = -0.3 * reach;
    } else if (this.state === 'mix') {
      armR = -0.8 + Math.sin(this.t * 9) * 0.35;
      bend = 0.35;
    } else if (this.state === 'take') {
      bend = 0.6 * Math.sin((1 - this.t / TAKE_TIME) * Math.PI);
      armR = armL = -0.9;
    } else if (this.state === 'floor') {
      // bent over the boards, hammering
      bend = 0.85;
      armR = -1.0 + Math.sin(this.t * 14) * 0.45;
      armL = -0.5;
    }
    a.body.rotation.x = bend;
    a.arms[1].rotation.x = armR;
    a.arms[0].rotation.x = armL;
  }
}

function nearest(list, p) {
  let best = null, bd = Infinity;
  for (const t of list) {
    const q = t.body.position, d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
// a spot next to something, on the side he comes from; idx fans several workers out round it
function beside(p, from, dist, idx = 0) {
  const d = new THREE.Vector3(from.x - p.x, 0, from.z - p.z);
  if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
  d.setLength(dist);
  if (idx > 0) d.applyAxisAngle(new THREE.Vector3(0, 1, 0), (idx % 2 ? 1 : -1) * Math.ceil(idx / 2) * 0.5);
  return new THREE.Vector3(p.x + d.x, 0, p.z + d.z);
}

// Other trades (lumberjack.js) put their kind of worker in here.
export const TRADES = { bricklayer: Worker };

export function hire(trade = 'bricklayer') {
  const w = new TRADES[trade](trade);
  crew.push(w);
  changed();
  game.hud.toast(`${w.name} is on his way from the road`);
  return w;
}

// ───────── a village that was already there (start modes) ─────────

// Build a marked-out house right now: the same bricks, bond, doors, windows and roof the crew would
// put up, in a moment. Returns false if something got in the way (then the house is left as it is).
export function buildNow(h) {
  h.wall.id ??= `h${h.id}:`;
  const from = h.centre;
  for (let guard = 0; guard < 5000; guard++) {
    for (const f of h.fits) {
      if (f.placed || !fitReady(h, f)) continue;
      const r = workerFit({ w: h.wall, o: f.o, ix: f.ix, iz: f.iz, iy: f.iy, L: f.L, H: f.H, kind: f.kind });
      if (r) { f.placed = true; f.rec = r; }
    }
    const t = nextBrick([{ w: h.wall, cols: h.cols, height: h.height, start: 0, skip: h.skip }], from);
    if (!t) break;
    if (!workerLay(t, false)) return false;
  }
  if (!h.wallsDone()) return false;
  h.startRoof();
  h.roof.forEach((_, i) => h.addSheet(i));
  return true;
}

// Workers who already work for you, standing around near a spot, waiting for orders.
export function hireHere(n, near) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = near.x + Math.cos(a) * 1.6, z = near.z + Math.sin(a) * 1.6;
    crew.push(new Worker('bricklayer', { x, z, yaw: a + Math.PI, bricks: 0, halves: 0, mortar: 0, carry: null, unpaid: false, order: null }));
  }
  changed();
}

// ───────── saving and loading ─────────

const r4 = (v) => Math.round(v * 1e4) / 1e4;

// Whatever he was in the middle of starts over (he thinks again); what he carries, he keeps.
// A worker who was let go and is walking home isn't saved.
export function saveCrew(ctx) {
  return crew.filter((w) => !w.leaving).map((w) => ({
    name: w.name, trade: w.trade, x: r4(w.pos.x), z: r4(w.pos.z), yaw: r4(w.yaw),
    bricks: w.bricks, halves: w.halves, mortar: w.mortar, carry: w.carry, unpaid: !!w.unpaid,
    order: !w.order ? null : w.order.kind === 'houses' ? { kind: 'houses' } : w.order.kind === 'lumber' || w.order.kind === 'paint' || w.order.kind === 'road' ? { ...w.order }
      : w.order.kind === 'roof' ? (w.order.house ? { kind: 'roof', house: houses.indexOf(w.order.house) } : { kind: 'roof', wall: ctx.wallIndex.get(w.order.wall) })
      : { walls: w.order.walls.filter((x) => ctx.wallIndex.has(x)).map((x) => ctx.wallIndex.get(x)), height: w.order.height },
    ...w.saveMore?.(),
  }));
}

export function loadCrew(list, ctx) {
  for (const s of list) {
    let order = s.order;
    if (order?.walls) {
      const ws = order.walls.map((i) => ctx.walls[i]).filter((w) => w && walls.includes(w));
      ws.forEach(wallId);
      order = ws.length ? { walls: ws, height: order.height } : null;
    }
    if (order?.kind === 'roof') {
      // a house (levelled already), or your walls: he works out the same plan again
      const h = houses[order.house], w = ctx.walls[order.wall];
      if (h) order = { kind: 'roof', house: h };
      else if (w && walls.includes(w) && !(w.room ??= roomOf(w)).why) { wallId(w); order = { kind: 'roof', house: null, wall: w, height: w.room.height }; }
      else order = null;
    }
    crew.push(new (TRADES[s.trade] ?? Worker)(s.trade, { ...s, order }));
  }
  changed();
}

export function updateWorkers(dt) {
  for (const w of [...crew]) w.update(dt); // (one may leave for good during his update)
}

export function workerInfo(w) { return `${w.name} · ${w.trade} · $${WAGE}/h · ${w.status}${w.cash > 0 ? ` · holding $${w.cash} of yours (E: ask for it)` : ''}`; }
