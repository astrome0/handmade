// The village. You mark out house plans on the ground (phone → Village); your crew
// builds them: walls, door and windows, then a roof. When a house is finished a
// family moves in. They walk around the village by day and go home at night, when
// their windows glow. Every finished house gets a footpath to the road.
import * as THREE from 'three';
import { world, CANNON, GROUP, MASK, MAT, rayClosest } from './physics.js';
import { terrainHeight, roadDist, road } from './terrain.js';
import { game } from './game.js';
import { trees, addPath, clearGrassWhere } from './world.js';
import { TEX } from './textures.js';
import { audio } from './audio.js';
import { walls, site, BRICK, regrid } from './masonry.js';
import { woodMats, sheetGeometry } from './items.js';
import { houses, personMesh, findPath } from './workers.js';
import { clamp, rng } from './util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { spend, money } from './money.js';
import { streetDist, nearestSidewalk, OUT as STREET_HALF } from './streets.js';

const { U, MY, key, cellsOf, Wall } = site;
const HEIGHT = 17; // courses: the top of the door and window lintels

// ───────── plans ─────────
// nx × nz grid cells (0.2 m). side: 0 front (with the door), 1 right, 2 back, 3 left; at: cells from the corner.
export const PLANS = {
  cottage: {
    name: 'Cottage', size: '4 × 3 m', nx: 20, nz: 15,
    fits: [{ kind: 'door', side: 0, at: 7 }, { kind: 'window', side: 1, at: 5 }, { kind: 'window', side: 3, at: 5 }, { kind: 'window', side: 2, at: 8 }],
  },
  family: {
    name: 'Family house', size: '6 × 5 m', nx: 30, nz: 25,
    fits: [
      { kind: 'door', side: 0, at: 12 }, { kind: 'window', side: 0, at: 3 }, { kind: 'window', side: 0, at: 22 },
      { kind: 'window', side: 1, at: 4 }, { kind: 'window', side: 1, at: 16 }, { kind: 'window', side: 3, at: 4 },
      { kind: 'window', side: 3, at: 16 }, { kind: 'window', side: 2, at: 6 }, { kind: 'window', side: 2, at: 19 },
    ],
  },
};
const FITS = { door: { L: 6, H: 16, iy: 0 }, window: { L: 5, H: 9, iy: 6 } };

// What a plan needs, for the phone.
export function needs(plan) {
  const cells = 2 * plan.nx + 2 * (plan.nz - 2);
  let fitCells = 0;
  for (const f of plan.fits) fitCells += FITS[f.kind].L * FITS[f.kind].H;
  const bricks = Math.round((cells * HEIGHT - fitCells) / 2 * 1.08);
  return {
    bricks, mortar: Math.ceil(bricks / 20),
    doors: plan.fits.filter((f) => f.kind === 'door').length,
    windows: plan.fits.filter((f) => f.kind === 'window').length,
    sheets: roofLayout(plan.nx * U, plan.nz * U).slots.length,
  };
}

// ───────── the roof: one slope, high at the front ─────────

function roofLayout(W, D) {
  const rise = 0.2 + D * 0.15, over = 0.3;
  const d = new THREE.Vector3(0, -rise, D).normalize();        // down the slope (local)
  const n = new THREE.Vector3(0, D, rise).normalize();         // up out of the roof
  const S = (D + 2 * over) / d.z;                              // slope length
  const top = new THREE.Vector3(0, rise + over * (rise / D), -over); // top edge (y above the wall top)
  const cols = Math.ceil((W + 2 * over) / 0.95), rows = Math.ceil(S / 1.85);
  const slots = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = -over + (W + 2 * over) * (c + 0.5) / cols;
    // (overlapping sheets sit a hair apart, or they flicker through each other)
    const p = top.clone().addScaledVector(d, Math.min(S - 1.0, (S * (r + 0.5)) / rows)).addScaledVector(n, 0.09 + r * 0.006 + (c % 2) * 0.003);
    p.x = x;
    slots.push({ local: p, row: r });
  }
  return { rise, d, n, S, slots, over };
}

// A roof on top of walls: the band, the gable ends, rafters, and the slots for the sheets.
// f: a frame (a masonry Wall: o, y0, yaw, world()) with its corner at the front left, x along the
// front wall, z into the house; W × D the outside of the walls, top their height over f.y0.
function raiseRoof(f, W, D, top) {
  const lay = roofLayout(W, D);
  const g = new THREE.Group();
  g.position.set(f.o.x, f.y0 + top, f.o.z);
  g.rotation.y = f.yaw;
  game.scene.add(g);
  const wood = new THREE.MeshStandardMaterial({ map: TEX.grain, color: 0xa47a52, roughness: 0.85 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  // a wooden band on the front wall, as high as the roof is up there
  add(new THREE.BoxGeometry(W, lay.rise, U - 0.01), wood, W / 2, lay.rise / 2, U / 2);
  // gable ends: triangles of boards on the side walls
  const tri = new THREE.Shape();
  tri.moveTo(0, 0); tri.lineTo(D, 0); tri.lineTo(0, lay.rise); tri.closePath();
  for (const x of [U / 2, W - U / 2]) {
    const gm = add(new THREE.ExtrudeGeometry(tri, { depth: U - 0.02, bevelEnabled: false }), wood, x - (U - 0.02) / 2, 0, 0);
    gm.rotation.y = -Math.PI / 2;
    gm.position.x = x + (U - 0.02) / 2;
  }
  // rafters along the slope, about a metre apart
  const n = Math.max(3, Math.round(W / 1.0) + 1);
  const len = lay.S;
  const rq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), lay.d);
  for (let i = 0; i < n; i++) {
    const x = 0.06 + (W - 0.12) * i / (n - 1);
    const r = add(new THREE.BoxGeometry(0.06, 0.14, len), wood, x, 0, 0);
    r.quaternion.copy(rq);
    r.position.set(x, lay.rise * (1 + lay.over / D) - 0.0, -lay.over).addScaledVector(lay.d, len / 2).addScaledVector(lay.n, 0.02);
  }
  // physics for the roof sheets as they go on
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: MAT.brick, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: MASK.ALL });
  world.addBody(body);
  // (−x keeps the basis right-handed: −x × down-the-slope = up out of the roof)
  const sq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), lay.d, lay.n));
  const at = (lx, ly, lz) => { const p = f.world(lx, lz); p.y = f.y0 + ly; return p; };
  const roof = lay.slots.map((s) => {
    // where he stands to put it up: on the ground in front or behind, under the sheet
    const back = s.local.z > D / 2;
    return { ...s, done: false, q: sq, pos: at(s.local.x, top + s.local.y, s.local.z), stand: at(clamp(s.local.x, 0.4, W - 0.4), 0, back ? D + 0.85 : -0.85) };
  });
  return { roof, roofGroup: g, roofWood: wood, roofBody: body };
}

// One sheet nailed on (o: a house or a hand-built roof, with roof, roofGroup, roofBody).
function nailSheet(o, i, tilt) {
  const s = o.roof[i];
  if (s.done) return false;
  s.done = true;
  const m = new THREE.Mesh(sheetGeometry(1.0, 0.012, 2.0), [woodMats.sheetEdge, woodMats.sheetEdge, woodMats.sheetEdge, woodMats.sheetEdge, woodMats.sheet, woodMats.sheet]);
  m.position.copy(s.local);
  m.quaternion.copy(s.q);
  // nobody nails them on perfectly straight (a loaded one keeps its tilt)
  s.tilt = tilt ?? (Math.random() - 0.5) * 0.012;
  m.rotateZ(s.tilt);
  m.castShadow = m.receiveShadow = true;
  o.roofGroup.add(m);
  s.mesh = m; // (paint.js paints it)
  o.roofGroup.updateMatrixWorld(true);
  const p = new THREE.Vector3(), q = new THREE.Quaternion();
  m.getWorldPosition(p);
  m.getWorldQuaternion(q);
  o.roofBody.addShape(new CANNON.Box(new CANNON.Vec3(0.5, 1.0, 0.02)), new CANNON.Vec3(p.x, p.y, p.z), new CANNON.Quaternion(q.x, q.y, q.z, q.w));
  return true;
}

// No grass inside walls (a plinth would hide most of it, but not the tall tufts). f, W, D as in raiseRoof.
function clearGrassIn(f, W, D) {
  const pad = 0.15;
  const corners = [[0, 0], [W, 0], [0, D], [W, D], [W / 2, D / 2]].map(([a, b]) => f.world(a, b));
  clearGrassWhere(corners.map((p) => p.x), corners.map((p) => p.z), (x, z) => {
    const dx = x - f.o.x, dz = z - f.o.z, lx = dx * f.ex.x + dz * f.ex.z, lz = dx * f.ez.x + dz * f.ez.z;
    return lx > -pad && lx < W + pad && lz > -pad && lz < D + pad;
  });
}

// ───────── a house ─────────

let nextId = 1;
const SURNAMES = ['Novák', 'Svoboda', 'Dvořák', 'Černý', 'Procházka', 'Kučera', 'Veselý', 'Horák', 'Němec', 'Pokorný', 'Marek', 'Pospíšil'];
export const village = { name: 'Borovice', founded: null, planning: null, people: [] };
const listeners = new Set();
export const onVillageChange = (fn) => listeners.add(fn);
const changed = () => listeners.forEach((fn) => fn());

class House {
  // plinth: it stands on a stone base, level on top (start-mode houses: the land is never that flat)
  constructor(plan, x, y0, z, yaw, plinth = false) {
    this.id = nextId++;
    this.plan = plan;
    this.wall = new Wall(x, y0, z, yaw);
    this.wall.id = `h${this.id}:`;
    this.plinth = plinth;
    this.wall.plinth = plinth;
    this.floors = []; // wooden floor patches (see "floors" below)
    this.height = plan.height ?? HEIGHT; // (your own house: as high as you built it)
    this.state = 'plan';
    this.roof = null;
    this.family = null;
    const { nx, nz } = plan;
    // the columns to build: all round the edge
    this.cols = new Map();
    for (let x_ = 0; x_ < nx; x_++) for (const z_ of [0, nz - 1]) this.cols.set(`${x_},${z_}`, { x: x_, z: z_, o: 0 });
    for (let z_ = 1; z_ < nz - 1; z_++) for (const x_ of [0, nx - 1]) this.cols.set(`${x_},${z_}`, { x: x_, z: z_, o: 1 });
    // doors and windows: where they go on the grid, and the cells kept free for them
    // (your own house's fits say their own iy/L/H: you set them where you liked)
    this.fits = plan.fits.map((f) => {
      const s = { ...FITS[f.kind], ...f };
      const [o, ix, iz] = f.side === 0 ? [0, f.at, 0] : f.side === 2 ? [0, f.at, nz - 1] : f.side === 1 ? [1, nx - 1, f.at] : [1, 0, f.at];
      return { kind: f.kind, side: f.side, o, ix, iz, iy: s.iy, L: s.L, H: s.H, placed: false };
    });
    this.skip = new Set(plan.none ?? []); // (the crew leaves those alone too)
    for (const f of this.fits) for (let c = f.iy; c < f.iy + f.H; c++) for (const [cx, cz] of cellsOf(f.o, f.ix, f.iz, f.L)) this.skip.add(key(cx, cz, c));
    this.none = new Set(plan.none ?? []); // (your own house: cells nothing can be laid in, see ownHouse)
    this.total = this.cols.size * this.height - this.none.size;
    // (a plinth shows where it goes by itself; your own walls are already there)
    this.chalk = plinth || plan.own ? new THREE.Group() : chalkLines(this);
    if (plinth) buildPlinth(this);
    houses.push(this);
    changed();
  }

  local(lx, ly, lz) { const p = this.wall.world(lx, lz); p.y = this.wall.y0 + ly; return p; }
  get centre() { return this.local(this.plan.nx * U / 2, 0, this.plan.nz * U / 2); }
  // for messages: "the cottage", "your house" (not "the your house")
  get the() { return this.plan.own ? 'your house' : `the ${this.plan.name.toLowerCase()}`; }

  progress() {
    let n = 0;
    for (const { x, z } of this.cols.values()) for (let c = 0; c < this.height; c++) if (this.wall.cells.has(key(x, z, c))) n++;
    return n / this.total;
  }

  wallsDone() {
    for (const { x, z } of this.cols.values()) for (let c = 0; c < this.height; c++) if (!this.wall.cells.has(key(x, z, c)) && !this.none.has(key(x, z, c))) return false;
    return true;
  }

  // The walls are up: no grass grows inside the house (a plinth would hide most of it, but not the tall tufts).
  clearGrass() { clearGrassIn(this.wall, this.plan.nx * U, this.plan.nz * U); }

  // Rafters and the wooden gable ends go up first; then the sheets, one by one.
  // (paint.js: roofWood is the band and gables, they get the frames' colour)
  startRoof() {
    if (this.roof) return;
    this.clearGrass();
    Object.assign(this, raiseRoof(this.wall, this.plan.nx * U, this.plan.nz * U, this.height * MY));
    this.state = 'roof';
    changed();
  }

  addSheet(i, tilt) {
    if (nailSheet(this, i, tilt)) changed();
  }

  // The last sheet is on: the chalk goes, a path is worn to the road, a family moves in.
  // saved: a loaded game (the family who lives there already)
  finish(saved) {
    if (this.state === 'done') return;
    this.state = 'done';
    game.scene.remove(this.chalk);
    const door = this.fits.find((f) => f.kind === 'door');
    this.doorOut = this.local((door.ix + door.L / 2) * U, 0, -0.9);
    this.inside = this.local(this.plan.nx * U / 2, 0, this.plan.nz * U / 2);
    // windows: each gets its own glass, so it can glow at night
    this.glass = [];
    for (const f of this.fits) {
      if (f.kind !== 'window' || !f.rec) continue;
      f.rec.group.traverse((o) => {
        if (o.isMesh && o.material.transparent) {
          o.material = o.material.clone();
          this.glass.push(o.material);
        }
      });
    }
    wearPath(this);
    if (saved) {
      this.family = moveIn(this, saved);
      return;
    }
    if (!village.founded) foundVillage();
    this.family = moveIn(this);
    game.hud.toast(`The house is finished! The ${this.family.name} family is moving in.`);
    changed();
  }
}

// ───────── your own walls become a house ─────────
// The crew's "Roof it": walls you built yourself (not a marked-out house). He finds the room they make,
// levels them (knocks off what sticks up, fills gaps and low spots: workers.js), then they become a
// house like any other (`ownHouse`): same roof, high on the door's side, a family, rent, floor, paint.

const SIDES = ['z0', 'x0', 'z1', 'x1']; // the front side → quarter turns of the frame from the wall's own grid

// The ring of cells round the rectangle x0..x1 × z0..z1, each with which way a brick runs there.
function ringCells(x0, x1, z0, z1) {
  const out = [];
  for (let x = x0; x <= x1; x++) for (const z of [z0, z1]) out.push({ x, z, o: 0 });
  for (let z = z0 + 1; z < z1; z++) for (const x of [x0, x1]) out.push({ x, z, o: 1 });
  return out;
}

// The room your first course makes, or { why } not. A corner brick turned the other way sticks out a
// cell (one house had "20 gaps", a whole side one cell in), so each side may sit up to 2 cells in from
// the outermost brick: the rectangle whose edge your bricks cover best wins. Then how high to level it:
// the height most of the edge already has (never below a door or window top, never under 6 courses).
// { x0, x1, z0, z1, gaps, height, front, cols, high }
export function roomOf(w) {
  // every course counts: a wall whose first course is missing (it hangs in the air) is still a wall
  const base = new Set();
  for (const r of w.bricks) for (const [x, z] of cellsOf(r.o, r.ix, r.iz, r.L)) base.add(`${x},${z}`);
  let X0 = Infinity, X1 = -Infinity, Z0 = Infinity, Z1 = -Infinity;
  for (const c of base) {
    const [x, z] = c.split(',').map(Number);
    X0 = Math.min(X0, x); X1 = Math.max(X1, x); Z0 = Math.min(Z0, z); Z1 = Math.max(Z1, z);
  }
  let best = null;
  for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) for (let c = 0; c <= 2; c++) for (let d = 0; d <= 2; d++) {
    const x0 = X0 + a, x1 = X1 - b, z0 = Z0 + c, z1 = Z1 - d;
    if (x1 - x0 < 4 || z1 - z0 < 4) continue;
    const ring = ringCells(x0, x1, z0, z1);
    const gaps = ring.filter((k) => !base.has(`${k.x},${k.z}`)).length;
    const area = (x1 - x0) * (z1 - z0);
    if (!best || gaps < best.gaps || (gaps === best.gaps && area > best.area)) best = { x0, x1, z0, z1, gaps, area, ring };
  }
  if (!best) return { why: 'Build four walls round a room first, then he puts a roof on them.' };
  if (best.gaps > best.ring.length * 0.3) return { why: `These walls don't make a room yet (${best.gaps} gaps in the first course). Close them up more first.` };
  const { x0, x1, z0, z1, ring } = best;
  const onRing = (r) => cellsOf(r.o, r.ix, r.iz, r.L).every(([x, z]) => (x === x0 || x === x1) && z >= z0 && z <= z1 || (z === z0 || z === z1) && x >= x0 && x <= x1);
  const fits = [...w.bricks].filter((r) => r.kind !== 'brick' && onRing(r));
  const door = fits.find((r) => r.kind === 'door');
  if (!door) return { why: 'Set a door in your walls first: people need a way in.' };
  const front = door.o === 0 ? (door.iz === z0 ? 'z0' : 'z1') : (door.ix === x0 ? 'x0' : 'x1');
  // the height: what most of the edge has (a door or window counts: it fills its cells)
  const n = new Map();
  for (const k of ring) {
    let h = 0;
    for (let c = 0; c < 60; c++) if (w.cells.has(key(k.x, k.z, c))) h = c + 1; // (the top one: low courses may be missing)
    if (h) n.set(h, (n.get(h) ?? 0) + 1);
  }
  let height = 0, most = 0;
  for (const [h, c] of n) if (c > most || (c === most && h > height)) { height = h; most = c; }
  for (const f of fits) height = Math.max(height, f.iy + f.H);
  height = Math.max(height, 6);
  const cols = new Map(ring.map((k) => [`${k.x},${k.z}`, k]));
  const high = [...w.bricks].filter((r) => r.kind === 'brick' && r.iy >= height).length;
  return { x0, x1, z0, z1, gaps: best.gaps, height, front, cols, high, skip: new Set() };
}

// Levelled walls → a house: the same bricks, on the house's own grid (its corner at the front left,
// x along the front wall, z into the room), with the doors and windows that sit in the edge.
export function ownHouse(w, room, quiet) {
  const { x0, x1, z0, z1, height, front } = room;
  const k = SIDES.indexOf(front), yaw = w.yaw + k * Math.PI / 2;
  const ex = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), ez = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const corners = [[x0, z0], [x1 + 1, z0], [x0, z1 + 1], [x1 + 1, z1 + 1]].map(([a, b]) => w.world(a * U, b * U));
  const o = corners.reduce((a, b) => (b.dot(ex) + b.dot(ez) < a.dot(ex) + a.dot(ez) ? b : a));
  const frame = new Wall(o.x, w.y0, o.z, yaw);
  // a cell of the old grid → the new one (through its centre in the world)
  const cell = (x, z) => { const g = frame.grid(w.world((x + 0.5) * U, (z + 0.5) * U)); return [Math.floor(g.x), Math.floor(g.z)]; };
  const turn = k % 2 === 1;
  const nx = (k % 2 ? z1 - z0 : x1 - x0) + 1, nz = (k % 2 ? x1 - x0 : z1 - z0) + 1;
  const fits = [];
  for (const r of w.bricks) {
    if (r.kind === 'brick') continue;
    const cs = cellsOf(r.o, r.ix, r.iz, r.L).map(([x, z]) => cell(x, z));
    const ix = Math.min(...cs.map((c) => c[0])), iz = Math.min(...cs.map((c) => c[1])), o2 = turn ? 1 - r.o : r.o;
    const side = o2 === 0 ? (iz === 0 ? 0 : iz === nz - 1 ? 2 : -1) : (ix === 0 ? 3 : ix === nx - 1 ? 1 : -1);
    if (side >= 0) fits.push({ kind: r.kind, side, at: o2 === 0 ? ix : iz, iy: r.iy, L: r.L, H: r.H });
  }
  const m = (v) => Math.round(v * U * 10) / 10;
  // cells no brick can go in (the ground there is above the first course): the wall starts higher, and
  // that's fine: they don't count as unfinished
  const none = [...room.skip].map((s) => { const [x, z, c] = s.split(',').map(Number); const [a, b] = cell(x, z); return key(a, b, c); });
  const plan = { name: 'Your house', size: `${m(nx)} × ${m(nz)} m`, nx, nz, height, fits, own: true, none };
  const h = new House(plan, o.x, w.y0, o.z, yaw);
  regrid(w, h.wall, cell, turn);
  placedFits(h);
  if (!quiet) game.hud.toast('Your walls are level: the roof goes on now. (It shows in the Village app.)');
  return h;
}

// Which of a house's doors and windows are in its wall (after a load, or your own house).
function placedFits(h) {
  for (const f of h.fits) {
    const r = h.wall.cells.get(key(f.ix, f.iz, f.iy));
    if (r && r.kind === f.kind && r.ix === f.ix && r.iz === f.iz) { f.placed = true; f.rec = r; }
  }
}

// What "Roof it" works on near p: a house whose walls are up (yours, or a marked-out one), or your own
// walls (they'll be levelled first: { wall, room }), or { why } not.
export function roofHere(p) {
  let why = null, best = null, bd = Infinity;
  for (const w of walls) {
    let d = Infinity;
    for (const b of w.bricks) d = Math.min(d, Math.hypot(b.pos.x - p.x, b.pos.z - p.z));
    if (d > 15 || d > bd) continue;
    const h = houses.find((x) => x.wall === w);
    if (h) {
      if (h.state === 'done') { why ??= 'That house has its roof already.'; continue; }
      if (!h.wallsDone()) { why ??= 'That house isn\'t built up yet: "Build the houses" does it all.'; continue; }
      best = { house: h };
    } else {
      const room = w.room ?? roomOf(w);
      if (room.why) { why = room.why; continue; }
      best = { wall: w, room };
    }
    bd = d;
  }
  if (!best) return { why: why ?? 'Stand by your walls (four walls and a door), then give the order.' };
  if (best.wall) best.wall.room = best.room; // (everyone you send works to the same plan)
  return best;
}

// ───────── floors ─────────
// A floor is a patch (a rectangle in the house's own metres: x along the front wall, z into the
// house) of wooden boards, laid by your crew row by row from the back wall towards the door. The
// price is per m², so later a patch can be one room. Boards run along x, about 14 cm wide, each
// row a little different (one board or two, grain, shade); the top sits 3 cm over the threshold.

export const FLOOR_M2 = 25;      // $ per m²
const FLOOR_UP = 0.03, BOARD_T = 0.034, BOARD_W = 0.144;
export const ROW_TIME = 0.7;     // seconds a worker needs per row
let floorMat = null;

function boardGeo(len, w, t, u0, v0, tint) {
  const g = new THREE.BoxGeometry(len, t, w);
  const uv = g.attributes.uv, pos = g.attributes.position;
  // the grain runs along the board: u across it, v along it (1 m of board = 1 v)
  for (let i = 8; i < 12; i++) uv.setXY(i, u0 + (pos.getZ(i) + w / 2) / 0.22, v0 + (pos.getX(i) + len / 2));
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) col.set([tint, tint * 0.96, tint * 0.9], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

Object.assign(House.prototype, {
  // 3 cm over the threshold, or a little over the highest ground inside, if that's higher (your own house
  // can stand where the ground rises under the first course: it showed through the boards)
  floorTop() {
    if (this.floorY === undefined) {
      let hi = -Infinity;
      const r = this.interior();
      for (let lx = r.x0; lx <= r.x1 + 1e-6; lx += (r.x1 - r.x0) / 12) for (let lz = r.z0; lz <= r.z1 + 1e-6; lz += (r.z1 - r.z0) / 12) {
        const q = this.wall.world(lx, lz);
        hi = Math.max(hi, terrainHeight(q.x, q.z));
      }
      this.floorY = Math.max(this.wall.y0 + FLOOR_UP, this.plinth ? -Infinity : hi + 0.015);
    }
    return this.floorY;
  },

  // The whole inside of the house (to the inner face of the walls), for now: the one patch you can buy.
  interior() {
    const W = this.plan.nx * U, D = this.plan.nz * U;
    return { x0: U - 0.01, x1: W - U + 0.01, z0: U - 0.01, z1: D - U + 0.01 };
  },

  floorOffer() {
    const r = this.interior(), area = (r.x1 - r.x0) * (r.z1 - r.z0);
    return { area: Math.round(area * 10) / 10, price: Math.ceil(area * FLOOR_M2) };
  },

  // A patch you paid for (or one from a save: rows says how much is laid). Not laid yet.
  addFloor(rect, seed, rows = 0, price = 0) {
    const n = Math.max(1, Math.round((rect.z1 - rect.z0) / BOARD_W));
    const p = { ...rect, total: n, pitch: (rect.z1 - rect.z0) / n, rows: 0, seed, price, worker: null };
    this.floors.push(p);
    for (let r = 0; r < rows; r++) this.layRow(p, false, true);
    return p;
  },

  // One more row of boards, back to front. loud: with the knock of a hammer (and a hop if you stand there).
  layRow(p, loud, instant) {
    if (p.rows >= p.total) return;
    if (!this.floorGroup) {
      floorMat ??= new THREE.MeshStandardMaterial({ map: TEX.grain, vertexColors: true, roughness: 0.78 });
      const w = this.wall;
      this.floorGroup = new THREE.Group();
      this.floorGroup.position.set(w.o.x, 0, w.o.z);
      this.floorGroup.rotation.y = w.yaw;
      game.scene.add(this.floorGroup);
      // the lowest ground under the house: the solid part reaches down to it
      let lo = Infinity;
      const r = this.interior();
      for (let lx = r.x0; lx <= r.x1 + 1e-6; lx += (r.x1 - r.x0) / 6) for (let lz = r.z0; lz <= r.z1 + 1e-6; lz += (r.z1 - r.z0) / 5) {
        const q = w.world(lx, lz);
        lo = Math.min(lo, terrainHeight(q.x, q.z));
      }
      this.floorLow = lo - 0.2;
      this.floorBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: MAT.wood, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: MASK.ALL });
      this.floorBody.position.set(w.o.x, 0, w.o.z);
      this.floorBody.quaternion.setFromEuler(0, w.yaw, 0);
      world.addBody(this.floorBody);
    }
    const R = rng(p.seed + p.rows * 31), len = p.x1 - p.x0, top = this.floorTop();
    const zc = p.z1 - (p.rows + 0.5) * p.pitch;
    // a long room: two boards in a row, joined at a different place each row
    const cuts = [0, ...(len > 2.2 ? [0.3 + R() * 0.4] : []), 1];
    const parts = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const l = (cuts[i + 1] - cuts[i]) * len - 0.003, xc = p.x0 + ((cuts[i] + cuts[i + 1]) / 2) * len;
      const g = boardGeo(l, p.pitch - 0.004, BOARD_T, R() * 4, R() * 4, 0.74 + R() * 0.2);
      g.translate(xc, top - BOARD_T / 2 + (R() - 0.5) * 0.001, zc + (R() - 0.5) * 0.002);
      parts.push(g);
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), floorMat);
    mesh.receiveShadow = true;
    this.floorGroup.add(mesh);
    parts.forEach((g) => g.dispose());
    const bottom = this.floorLow;
    this.floorBody.addShape(new CANNON.Box(new CANNON.Vec3(len / 2, (top - bottom) / 2, p.pitch / 2)), new CANNON.Vec3((p.x0 + p.x1) / 2, (top + bottom) / 2, zc));
    this.floorBody.aabbNeedsUpdate = true;
    p.rows++;
    if (!instant) {
      if (loud && this.near()) audio.woodKnock();
      // a board lands under your feet: you step up onto it
      const pl = game.player.body, w = this.wall, dx = pl.position.x - w.o.x, dz = pl.position.z - w.o.z;
      const lx = dx * w.ex.x + dz * w.ex.z, lz = dx * w.ez.x + dz * w.ez.z;
      if (Math.abs(lz - zc) < p.pitch / 2 + 0.4 && lx > p.x0 - 0.4 && lx < p.x1 + 0.4 && pl.position.y < top + 0.55 && !game.driving) {
        pl.position.y = top + 0.37;
        pl.velocity.y = 0;
      }
    }
    changed();
  },

  near() { return this.centre.distanceTo(game.camera.position) < 25; },

  // Is this (local) spot on laid floor? (standing height for people)
  onFloor(lx, lz) {
    for (const p of this.floors) {
      if (!p.rows) continue;
      if (lx >= p.x0 && lx <= p.x1 && lz >= p.z1 - p.rows * p.pitch - 0.001 && lz <= p.z1) return true;
    }
    return false;
  },
});

// Buy the floor of a house. Returns a message when it can't be done.
export function buyFloor(h) {
  if (h.floors.length) return 'This house has a floor already.';
  const o = h.floorOffer();
  if (!spend(o.price, `Wooden floor · ${h.plan.name} · ${o.area} m²`)) return `You need $${o.price - money.balance} more`;
  h.addFloor(h.interior(), Math.floor(Math.random() * 1e6) + 1, 0, o.price);
  changed();
  return null;
}

// ───────── a stone plinth, and steps up to the door ─────────

const PLINTH_M = 0.05, STEP = 0.3;
let stoneMat = null;

function buildPlinth(h) {
  stoneMat ??= new THREE.MeshStandardMaterial({ color: 0x8e8a82, roughness: 0.95, map: TEX.grain });
  const W = h.plan.nx * U, D = h.plan.nz * U, y0 = h.wall.y0;
  // the lowest ground under it (and a bit into the ground, so no gap shows)
  let lo = Infinity;
  for (let lx = 0; lx <= W + 1e-6; lx += W / 8) for (let lz = 0; lz <= D + 1e-6; lz += D / 6) {
    const p = h.wall.world(lx, lz);
    lo = Math.min(lo, terrainHeight(p.x, p.z));
  }
  const base = lo - 0.25, tall = y0 - base;
  const g = new THREE.Group();
  g.position.set(h.wall.o.x, base, h.wall.o.z);
  g.rotation.y = h.wall.yaw;
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: MAT.brick, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: MASK.ALL });
  body.position.set(h.wall.o.x, base, h.wall.o.z);
  body.quaternion.setFromEuler(0, h.wall.yaw, 0);
  const slab = (w, hh, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), stoneMat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, hh / 2, d / 2)), new CANNON.Vec3(x, y, z));
  };
  slab(W + 2 * PLINTH_M, tall, D + 2 * PLINTH_M, W / 2, tall / 2, D / 2);
  // steps down from the door to the ground in front of it
  const door = h.fits.find((f) => f.kind === 'door' && f.side === 0);
  if (door) {
    const dx = (door.ix + door.L / 2) * U, dw = door.L * U + 0.1;
    const p = h.wall.world(dx, -0.4);
    const rise = y0 - terrainHeight(p.x, p.z);
    const n = Math.ceil(Math.max(0, rise) / 0.17);
    h.steps = { n, rise, dx };
    for (let k = 1; k < n; k++) {
      const top = tall - (rise * k) / n;
      slab(dw, top, STEP, dx, top / 2, -PLINTH_M - (k - 0.5) * STEP);
    }
    if (n > 1) {
      // an invisible ramp over the step edges, so you walk up instead of bumping
      const run = (n - 1) * STEP + 0.05, ang = Math.atan2(rise, run), len = Math.hypot(rise, run);
      const s = new CANNON.Box(new CANNON.Vec3(dw / 2, 0.02, len / 2));
      const q = new CANNON.Quaternion().setFromEuler(-ang, 0, 0);
      body.addShape(s, new CANNON.Vec3(dx, tall - rise / 2 - 0.03, -PLINTH_M - run / 2), q);
    }
  }
  game.scene.add(g);
  world.addBody(body);
  h.plinthTop = y0;
}

// How high you stand here: on a house's plinth or its steps, else on the ground (workers, villagers).
export function standY(x, z) {
  let y = terrainHeight(x, z);
  for (const h of houses) {
    if (!h.plinth && !h.floors.length) continue;
    const g = h.wall.grid({ x, y: 0, z }), lx = g.x * U, lz = g.z * U;
    const W = h.plan.nx * U, D = h.plan.nz * U;
    if (h.floors.length && h.onFloor(lx, lz)) y = Math.max(y, h.floorTop());
    if (!h.plinth) continue;
    if (lx >= -PLINTH_M && lx <= W + PLINTH_M && lz >= -PLINTH_M && lz <= D + PLINTH_M) y = Math.max(y, h.wall.y0);
    else if (h.steps?.n > 1 && Math.abs(lx - h.steps.dx) < 0.7 && lz < 0 && lz > -PLINTH_M - (h.steps.n - 1) * STEP) {
      const k = Math.ceil((-lz - PLINTH_M) / STEP);
      y = Math.max(y, h.wall.y0 - (h.steps.rise * k) / h.steps.n);
    }
  }
  return y;
}

// White chalk lines on the ground and a stake at each corner, until the walls are up.
function chalkLines(h) {
  const g = new THREE.Group();
  const chalk = new THREE.MeshBasicMaterial({ color: 0xf4f1e6, transparent: true, opacity: 0.75, depthWrite: false });
  const stake = new THREE.MeshStandardMaterial({ map: TEX.grain, color: 0xc49a6c, roughness: 0.85 });
  const W = h.plan.nx * U, D = h.plan.nz * U;
  const line = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / 0.5);
    for (let k = 0; k < n; k++) {
      const x = ax + ((bx - ax) * (k + 0.5)) / n, z = az + ((bz - az) * (k + 0.5)) / n;
      const p = h.local(x, 0, z);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len / n + 0.01, 0.01, 0.03), chalk);
      m.position.set(p.x, terrainHeight(p.x, p.z) + 0.02, p.z);
      m.rotation.y = h.wall.yaw + (Math.abs(bx - ax) > Math.abs(bz - az) ? 0 : Math.PI / 2);
      m.renderOrder = 2;
      g.add(m);
    }
  };
  line(0, 0, W, 0); line(W, 0, W, D); line(W, D, 0, D); line(0, D, 0, 0);
  for (const [x, z] of [[0, 0], [W, 0], [W, D], [0, D]]) {
    const p = h.local(x, 0, z);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), stake);
    m.position.set(p.x, terrainHeight(p.x, p.z) + 0.2, p.z);
    m.castShadow = true;
    g.add(m);
  }
  game.scene.add(g);
  return g;
}

// ───────── marking out a plan ─────────

let ghost = null;
export function startPlanning(id) {
  village.planning = { plan: PLANS[id], rot: 0, spot: null };
  game.hud.toast(`Find a flat spot for the ${PLANS[id].name.toLowerCase()} · R turns it · click marks it out · right click cancels`);
}

function ghostFor(plan) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.22, depthWrite: false });
  const fitMat = new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.45, depthWrite: false });
  const W = plan.nx * U, D = plan.nz * U, Hh = HEIGHT * MY;
  const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.renderOrder = 3; g.add(b); return b; };
  box(W, Hh, U, W / 2, Hh / 2, U / 2, mat);
  box(W, Hh, U, W / 2, Hh / 2, D - U / 2, mat);
  box(U, Hh, D - 2 * U, U / 2, Hh / 2, D / 2, mat);
  box(U, Hh, D - 2 * U, W - U / 2, Hh / 2, D / 2, mat);
  for (const f of plan.fits) {
    const s = FITS[f.kind], L = s.L * U, h = s.H * MY;
    const y = s.iy * MY + h / 2;
    if (f.side === 0) box(L, h, U + 0.04, (f.at + s.L / 2) * U, y, U / 2, fitMat);
    if (f.side === 2) box(L, h, U + 0.04, (f.at + s.L / 2) * U, y, D - U / 2, fitMat);
    if (f.side === 1) box(U + 0.04, h, L, W - U / 2, y, (f.at + s.L / 2) * U, fitMat);
    if (f.side === 3) box(U + 0.04, h, L, U / 2, y, (f.at + s.L / 2) * U, fitMat);
  }
  g.userData.mat = mat;
  game.scene.add(g);
  return g;
}

// Where the plan would go, and whether it can.
function spotFor(plan, rot) {
  const cam = game.camera;
  const o = cam.getWorldPosition(new THREE.Vector3()), d = cam.getWorldDirection(new THREE.Vector3());
  const hit = rayClosest(new CANNON.Vec3(o.x, o.y, o.z), new CANNON.Vec3(o.x + d.x * 40, o.y + d.y * 40, o.z + d.z * 40), GROUP.GROUND);
  if (!hit) return null;
  // the front (with the door) faces you; R turns it a quarter
  const yaw = game.player.yaw + Math.PI + rot * Math.PI / 2;
  const t = new Wall(0, 0, 0, yaw);
  const W = plan.nx * U, D = plan.nz * U;
  const x = hit.point.x - t.ex.x * W / 2 - t.ez.x * D / 2, z = hit.point.z - t.ex.z * W / 2 - t.ez.z * D / 2;
  const at = (lx, lz) => ({ x: x + t.ex.x * lx + t.ez.x * lz, z: z + t.ex.z * lx + t.ez.z * lz });
  let lo = Infinity, hi = -Infinity, why = null;
  for (let lx = 0; lx <= W + 1e-6; lx += W / Math.ceil(W / 0.5)) {
    for (let lz = 0; lz <= D + 1e-6; lz += D / Math.ceil(D / 0.5)) {
      const p = at(lx, lz), h = terrainHeight(p.x, p.z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      if (!why && roadDist(p.x, p.z) < 3) why = 'Too close to the road';
      if (!why && streetDist(p.x, p.z) < STREET_HALF + 0.6) why = 'Too close to the street';
    }
  }
  if (!why && hi - lo > 0.18) why = 'Too steep here — find flatter ground';
  // the footprint with a little room round it, in its own frame
  const inside = (px, pz, pad) => {
    const dx = px - x, dz = pz - z, lx = dx * t.ex.x + dz * t.ex.z, lz = dx * t.ez.x + dz * t.ez.z;
    return lx > -pad && lx < W + pad && lz > -pad && lz < D + pad;
  };
  if (!why && trees.some((tr) => tr.alive && inside(tr.x, tr.z, tr.r + 0.4))) why = 'A tree is in the way — chop it down first';
  if (!why && walls.some((w) => [...w.bricks].some((b) => inside(b.pos.x, b.pos.z, 0.4)))) why = 'Something is already built there';
  if (!why && houses.some((h) => [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]].some(([a, b]) => { const p = h.local(a * h.plan.nx * U, 0, b * h.plan.nz * U); return inside(p.x, p.z, 0.8); }))) why = 'Another house is planned there';
  return { x, z, yaw, y0: hi + 0.02, ok: !why, why };
}

function updatePlanning() {
  const P = village.planning, inp = game.input;
  if (!ghost || ghost.userData.plan !== P.plan) {
    if (ghost) game.scene.remove(ghost);
    ghost = ghostFor(P.plan);
    ghost.userData.plan = P.plan;
  }
  if (inp.pressed.has('KeyR')) { P.rot = (P.rot + 1) % 4; audio.pickup(); }
  const s = spotFor(P.plan, P.rot);
  ghost.visible = !!s;
  if (s) {
    ghost.position.set(s.x, s.y0, s.z);
    ghost.rotation.y = s.yaw;
    ghost.userData.mat.color.set(s.ok ? 0xfff1c4 : 0xff6a50);
  }
  game.hud.hint(s && s.ok ? [['Click', 'Mark it out'], ['R', 'Turn it'], ['Right click', 'Cancel']] : [['', s ? s.why : 'Look at the ground'], ['R', 'Turn it'], ['Right click', 'Cancel']]);
  game.hud.info(`${P.plan.name} · ${P.plan.size}`);
  if (inp.rmbDown) return stopPlanning();
  if (inp.lmbDown && s) {
    if (!s.ok) { game.hud.toast(s.why); return; }
    new House(P.plan, s.x, s.y0, s.z, s.yaw);
    audio.woodKnock();
    game.hud.toast(`Marked out. Open the Crew app and tell them to build houses.`);
    stopPlanning();
  }
}

// A family that has lived in a house for a while (start modes): some at home, some out.
export function settledFamily(h) {
  const used = new Set(houses.filter((x) => x.family).map((x) => x.family.name));
  const name = pick(SURNAMES.filter((s) => !used.has(s))) ?? pick(SURNAMES);
  const kids = h.plan.nx > 20 ? 1 + Math.floor(Math.random() * 3) : Math.floor(Math.random() * 2);
  const members = [];
  for (let i = 0; i < 2 + kids; i++) {
    const kid = i >= 2;
    members.push({ first: pick(kid ? FIRST.kid : FIRST.adult), scale: kid ? 0.62 + Math.random() * 0.12 : 0.94 + Math.random() * 0.08, inside: Math.random() < 0.4 });
  }
  return { name, members };
}

// The village is there from the start: the sign goes up, without the news.
export function foundQuietly() {
  if (village.founded) return;
  village.founded = game.day.day;
  putSign();
}

// Mark out a plan without aiming (start modes, tests): the front corner at (x, z), the front facing yaw + π.
export function markOut(id, x, z, yaw, plinth = false) {
  const plan = PLANS[id], t = new Wall(0, 0, 0, yaw), W = plan.nx * U, D = plan.nz * U;
  // the highest ground anywhere under the walls (not just at the corners), so no brick hits a bump
  let hi = -Infinity;
  for (let lx = 0; lx <= W + 1e-6; lx += W / Math.ceil(W / 0.2)) {
    for (let lz = 0; lz <= D + 1e-6; lz += D / Math.ceil(D / 0.2)) {
      if (!plinth && lx > U && lx < W - U && lz > U && lz < D - U) continue; // (inside: no wall there; a plinth covers it all)
      hi = Math.max(hi, terrainHeight(x + t.ex.x * lx + t.ez.x * lz, z + t.ex.z * lx + t.ez.z * lz));
    }
  }
  return new House(plan, x, hi + 0.02, z, yaw, plinth);
}

function stopPlanning() {
  village.planning = null;
  if (ghost) ghost.visible = false;
  game.hud.hint([]);
  game.hud.info('');
}

// ───────── paths and the sign ─────────

function wearPath(h) {
  // from the door to the nearest bit of road, around trees and walls
  let best = null, bd = Infinity;
  for (const p of [...road.approach, ...road.loop]) {
    const d = (p.x - h.doorOut.x) ** 2 + (p.z - h.doorOut.z) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  // (a street's sidewalk, if that's nearer)
  const side = nearestSidewalk(h.doorOut.x, h.doorOut.z);
  if (side && side.d ** 2 < bd) best = side;
  const end = new THREE.Vector3(best.x, 0, best.z);
  const route = findPath(h.doorOut, end) || [end];
  addPath([h.doorOut, ...route]);
}

function foundVillage() {
  village.founded = game.day.day;
  putSign();
  game.hud.toast(`${village.name} is a village now!`);
}

// a wooden sign by the road where it comes out of the forest
function putSign() {
  const i = Math.max(0, road.approach.length - 30);
  const a = road.approach[i], b = road.approach[i + 1];
  const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz);
  const px = a.x + (-tz / tl) * 3.2, pz = a.z + (tx / tl) * 3.2;
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ map: TEX.grain, color: 0x8a6440, roughness: 0.9 });
  const c = document.createElement('canvas');
  c.width = 512; c.height = 200;
  const x = c.getContext('2d');
  x.fillStyle = '#e9dcc0'; x.fillRect(0, 0, 512, 200);
  x.strokeStyle = '#6b4a2c'; x.lineWidth = 10; x.strokeRect(10, 10, 492, 180);
  x.fillStyle = '#3a2614'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '600 88px Fraunces, Georgia, serif';
  x.fillText(village.name, 256, 92);
  x.font = '500 30px Outfit, system-ui, sans-serif';
  x.fillText(`founded on day ${village.founded}`, 256, 158);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.0, 0.1), wood);
    post.position.set(s * 0.75, 1.0, 0);
    post.castShadow = true;
    g.add(post);
  }
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.66, 0.05), [wood, wood, wood, wood, face, face]);
  board.position.y = 1.55;
  board.castShadow = true;
  g.add(board);
  g.position.set(px, terrainHeight(px, pz), pz);
  g.rotation.y = Math.atan2(tx, tz) + Math.PI / 2; // facing along the road
  game.scene.add(g);
}

// ───────── the people ─────────

const FIRST = { adult: ['Jana', 'Petr', 'Eva', 'Tomáš', 'Lucie', 'Martin', 'Hana', 'Jakub', 'Klára', 'Ondřej'], kid: ['Anička', 'Kuba', 'Ema', 'Vojta', 'Bára', 'Matěj', 'Terka', 'Šimon'] };
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function moveIn(h, saved) {
  if (saved) {
    // a loaded game: they live here already; whoever was in is still in, the rest are out and about
    const fam = { name: saved.name, house: h, members: [] };
    for (const s of saved.members) {
      const v = new Villager(fam, s.first, s.scale, 0);
      // (a family made for a start mode has no spots yet: somewhere near their door)
      const x = s.x ?? h.doorOut.x + (Math.random() - 0.5) * 5, z = s.z ?? h.doorOut.z + (Math.random() - 0.5) * 5;
      v.pos.set(x, terrainHeight(x, z), z);
      v.yaw = s.yaw ?? Math.random() * 6.28;
      if (s.inside) {
        v.inside = true;
        v.m.g.visible = false;
        v.body.collisionFilterMask = 0;
        v.t = night() ? 9999 : 3 + Math.random() * 15;
        v.next = () => v.goOut();
      } else {
        v.t = 0.5 + Math.random() * 2;
        v.next = () => v.wander();
      }
      v.going = night() ? 'going home' : null;
      fam.members.push(v);
      village.people.push(v);
    }
    return fam;
  }
  const name = pick(SURNAMES);
  const kids = h.plan.nx > 20 ? 1 + Math.floor(Math.random() * 3) : Math.floor(Math.random() * 2);
  const fam = { name, house: h, members: [] };
  for (let i = 0; i < 2 + kids; i++) {
    const kid = i >= 2;
    const v = new Villager(fam, kid ? pick(FIRST.kid) : pick(FIRST.adult), kid ? 0.62 + Math.random() * 0.12 : 0.94 + Math.random() * 0.08, i * 1.4);
    fam.members.push(v);
    village.people.push(v);
  }
  return fam;
}

class Villager {
  constructor(fam, first, scale, delay) {
    this.fam = fam;
    this.first = first;
    this.kid = scale < 0.8;
    this.m = personMesh({ worker: false, scale });
    game.scene.add(this.m.g);
    // they come up the road, a little apart
    const p = road.approach[road.approach.length - 1];
    this.pos = new THREE.Vector3(p.x + 1.5 + delay, terrainHeight(p.x, p.z), p.z + (Math.random() - 0.5));
    this.yaw = -Math.PI / 2;
    this.speed = this.kid ? 1.7 : 1.25;
    this.path = null;
    this.state = 'wait';
    this.t = delay;
    this.inside = false;
    this.ph = Math.random() * 6;
    this.next = () => this.goHome(true);
    this.body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: GROUP.PLAYER });
    this.body.addShape(new CANNON.Cylinder(0.22 * scale, 0.22 * scale, 1.7 * scale, 8), new CANNON.Vec3(0, 0.85 * scale, 0));
    this.body.villager = this;
    world.addBody(this.body);
  }

  get name() { return `${this.first} ${this.fam.name}`; }
  get doing() { return this.inside ? 'at home' : this.state === 'walk' ? this.going : 'having a look around'; }

  walk(to, going, then) {
    this.path = findPath(this.pos, to);
    if (!this.path) { this.state = 'wait'; this.t = 2; return; }
    this.going = going;
    this.state = 'walk';
    this.then = then;
  }

  // in through the front door, and out of sight
  goHome(first) {
    const h = this.fam.house;
    this.walk(h.doorOut, first ? 'moving in' : 'going home', () => this.walk(h.inside, 'going in', () => {
      this.inside = true;
      this.m.g.visible = false;
      this.body.collisionFilterMask = 0;
      this.state = 'wait';
      this.t = night() ? 9999 : 8 + Math.random() * 20;
      this.next = () => this.goOut();
    }));
  }

  goOut() {
    const h = this.fam.house;
    this.inside = false;
    this.m.g.visible = true;
    this.body.collisionFilterMask = GROUP.PLAYER;
    this.pos.copy(h.inside);
    this.walk(h.doorOut, 'going out', () => this.wander());
  }

  // somewhere to go: a neighbour's door, the middle of the village, the end of the road, or just near home
  wander() {
    if (night()) return this.goHome(false);
    const r = Math.random(), done = houses.filter((x) => x.state === 'done');
    let to, going;
    if (r < 0.3 && done.length > 1) { const h = pick(done.filter((x) => x !== this.fam.house)); to = h.doorOut.clone().add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5)); going = h.family ? `visiting the ${h.family.name} family` : 'visiting the neighbours'; }
    else if (r < 0.5) { const p = pick(road.loop); to = new THREE.Vector3(p.x + (Math.random() - 0.5) * 4, 0, p.z + (Math.random() - 0.5) * 4); going = 'going for a walk'; }
    else if (r < 0.75) { to = this.fam.house.doorOut.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8)); going = this.kid ? 'playing outside' : 'out in the garden'; }
    else return this.goHome(false);
    this.walk(to, going, () => { this.state = 'wait'; this.t = 3 + Math.random() * 8; this.next = () => this.wander(); });
  }

  update(dt) {
    let walking = false;
    if (this.state === 'walk') {
      const wp = this.path[0];
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.08) {
        this.path.shift();
        if (!this.path.length) { this.state = 'wait'; this.t = 0.2; const then = this.then; this.then = null; if (then) { this.next = null; then(); } }
      } else {
        const s = Math.min(d, this.speed * dt);
        this.pos.x += (dx / d) * s;
        this.pos.z += (dz / d) * s;
        this.yaw += clamp(Math.atan2(Math.sin(Math.atan2(dx, dz) - this.yaw), Math.cos(Math.atan2(dx, dz) - this.yaw)), -dt * 8, dt * 8);
        walking = true;
        for (const r of site.doors) if (!r.open && r.pos.distanceTo(this.pos) < 1.3) r.open = true;
      }
    } else if (this.state === 'wait') {
      this.t -= dt;
      // night falls: home, wherever they are; morning: out again
      if (!this.inside && night() && this.going !== 'going home' && this.t > 0.5) this.t = Math.min(this.t, 0.5);
      if (this.inside && !night() && this.t > 60) this.t = Math.random() * 15;
      if (this.t <= 0) { const n = this.next; this.next = () => this.wander(); (n || (() => this.wander()))(); }
    }
    this.pos.y = standY(this.pos.x, this.pos.z);
    if (dt > 0) this.body.velocity.set((this.pos.x - this.body.position.x) / dt, 0, (this.pos.z - this.body.position.z) / dt);
    this.body.position.set(this.pos.x, this.pos.y, this.pos.z);
    const a = this.m;
    a.g.position.copy(this.pos);
    a.g.rotation.y = this.yaw;
    this.ph += dt * (walking ? (this.kid ? 11 : 8) : 1.2);
    const sw = walking ? Math.sin(this.ph) : 0;
    a.legs[0].rotation.x = sw * 0.55;
    a.legs[1].rotation.x = -sw * 0.55;
    a.arms[0].rotation.x = sw * 0.45;
    a.arms[1].rotation.x = -sw * 0.45;
    a.head.rotation.y = walking ? 0 : Math.sin(this.ph * 0.7) * 0.5; // looking around
  }
}

const night = () => game.day.daylight < 0.22;

// ───────── every frame ─────────

// hands: you are in control (not driving, no phone out)
export function updateVillage(dt, hands) {
  if (village.planning && hands) updatePlanning();
  for (const v of village.people) v.update(dt);
  // lit windows: someone's home and it's getting dark
  const dark = game.day.daylight < 0.4;
  for (const h of houses) {
    if (h.state !== 'done') continue;
    const home = dark && h.family.members.some((m) => m.inside);
    for (const g of h.glass) {
      g.emissive.set(home ? 0xffc46e : 0x000000);
      g.emissiveIntensity = home ? 1.1 : 0;
      g.opacity = home ? 0.75 : 0.28;
    }
  }
}

export function personInfo(v) { return `${v.name} · ${v.doing}`; }

// ───────── saving and loading ─────────

const r4 = (v) => Math.round(v * 1e4) / 1e4;

// Every house's wall goes first in the wall list (index = the house's place in `houses`).
export function saveVillage(ctx) {
  houses.forEach((h) => ctx.wallIndex.set(h.wall, ctx.wallIndex.size));
  return {
    name: village.name, founded: village.founded,
    houses: houses.map((h) => ({
      plan: h.plan.own ? 'own' : Object.keys(PLANS).find((k) => PLANS[k] === h.plan),
      own: h.plan.own ? { name: h.plan.name, size: h.plan.size, nx: h.plan.nx, nz: h.plan.nz, height: h.plan.height, fits: h.plan.fits, none: h.plan.none?.length ? h.plan.none : undefined } : undefined,
      wall: ctx.wallIndex.get(h.wall),
      plinth: h.plinth || undefined,
      floors: h.floors.length ? h.floors.map((p) => ({ x0: r4(p.x0), x1: r4(p.x1), z0: r4(p.z0), z1: r4(p.z1), seed: p.seed, rows: p.rows, price: p.price })) : undefined,
      state: h.state,
      roof: h.roof ? h.roof.map((s) => (s.done ? r4(s.tilt ?? 0) : null)) : null,
      family: h.family && {
        name: h.family.name,
        members: h.family.members.map((v) => ({ first: v.first, scale: r4(v.m.g.scale.x), inside: v.inside, x: r4(v.pos.x), z: r4(v.pos.z), yaw: r4(v.yaw) })),
      },
    })),
  };
}

// First the plans (their walls must exist before the bricks go back in)...
export function loadHouses(d, ctx, wallList) {
  village.name = d.name;
  village.founded = d.founded;
  if (village.founded) putSign();
  for (const s of d.houses) {
    const w = wallList[s.wall];
    const plan = s.plan === 'own' ? { ...s.own, own: true } : PLANS[s.plan] ?? PLANS.cottage;
    const h = new House(plan, w.x, w.y0, w.z, w.yaw, !!s.plinth);
    ctx.walls[s.wall] = h.wall;
  }
}

// Saves from the first "Roof it" (2026-10-28, a roof on your walls but no house): those walls become
// your house now, with the sheets that were on. (Walls that aren't level any more stay as they are.)
export function loadHandRoofs(list, ctx) {
  for (const s of list ?? []) {
    const w = ctx.walls[s.wall];
    if (!w || !walls.includes(w)) continue;
    const room = roomOf(w);
    if (room.why || room.gaps || room.high) continue;
    const h = ownHouse(w, room, true);
    if (s.state === 'plan') continue;
    h.startRoof();
    s.roof?.forEach((tilt, k) => { if (tilt !== null && h.roof[k]) h.addSheet(k, tilt); });
    if (s.state === 'done') h.finish();
  }
}

// ...then, with the bricks, doors and windows back: which fittings are in, the roof, the family.
export function finishHouses(d) {
  d.houses.forEach((s, i) => {
    const h = houses[i];
    placedFits(h);
    // floors you paid for: the rows already laid come back exactly as they were
    for (const f of s.floors ?? []) h.addFloor({ x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1 }, f.seed, f.rows, f.price);
    if (s.state === 'plan') return;
    h.startRoof();
    s.roof?.forEach((tilt, k) => { if (tilt !== null && h.roof[k]) h.addSheet(k, tilt); });
    if (s.state === 'done') h.finish(s.family ?? { name: pick(SURNAMES), members: [] });
  });
  changed();
}
