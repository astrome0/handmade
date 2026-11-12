// The lumberjack. You hire him in the Crew app, pick a job and point at a patch of forest.
// He fells trees there (always so they fall away from roads, houses, the camp, you and the
// pickup), saws the trunks into pieces you could carry (40–50 kg), and carries them one at a
// time: to a pile at camp, into your pickup, or — if you let him sell it himself — he loads
// the pickup, drives it to the timber yard and sells the wood there. The cash stays in his
// pocket until you ask for it, and he isn't always honest about how much there is.
import * as THREE from 'three';
import { CANNON, GROUP, rayClosest } from './physics.js';
import { game } from './game.js';
import { trees, chopTree } from './world.js';
import { pieces, crossCut, logGeometry, woodMats, Piece, DENSITY } from './items.js';
import { terrainHeight, roadDist, road, YARD } from './terrain.js';
import { Worker, TRADES, crew, houses } from './workers.js';
import { site } from './masonry.js';
import { car, carDebug } from './car.js';
import { ZONE, sell, buyerPos } from './yard.js';
import { earn, spend, WAGE } from './money.js';
import { audio } from './audio.js';
import { particles } from './particles.js';
import { clamp } from './util.js';

export const JOBS = { stack: 'Stack it at camp', pickup: 'Load my pickup', sell: 'Sell it himself' };
export const HONESTY = [
  { v: 0.9, name: 'Honest', dots: '●●●' },
  { v: 0.6, name: 'Mostly honest', dots: '●●○' },
  { v: 0.3, name: 'Sly', dots: '●○○' },
];
export const honestyOf = (w) => HONESTY.reduce((b, h) => (Math.abs(h.v - w.honesty) < Math.abs(b.v - w.honesty) ? h : b));

const AREA_R = 14;               // he fells trees this far from the spot you picked
const KG = [40, 50];             // what one piece should weigh
const MIN_LEN = 0.65;            // (under 60 cm the yard pays half)
const LEN_HAND = 2.2, LEN_BED = 1.45; // the longest piece: carried to a pile / laid in the pickup's bed
const CARRY_KG = 58;
const BED_KG = 420;              // what he puts in the pickup before he calls it full
const TRUCK_FAR = 75;            // the pickup must be parked this close to where he works
const RIM = 0.62;                // the bed's sides stand to 0.6 over the truck's middle; a log's middle may not rise above
const CHOP_TIME = 0.95, SAW_TIME = 2.6, TAKE_TIME = 0.7;
const CAMP = { x: -1, z: 0.5 };
const YARD_AREA = { x: YARD.x, z: YARD.z, r: 40 }; // after a sale he works on round the yard (nearest trees first)
const { COM } = carDebug;
const UP = new CANNON.Vec3(0, 1, 0);
const ALONG_X = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 0, 1), -Math.PI / 2); // a piece's length (local Y) along x

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const rnd = (a, b) => a + Math.random() * (b - a);
const halfDiag = (h) => Math.hypot(h.plan.nx * 0.2, h.plan.nz * 0.2) / 2;

// ───────── the road, as something to drive along ─────────

let G = null;
function roadGraph() {
  if (G) return G;
  const pts = [], next = [];
  const link = (a, b) => { next[a].push(b); next[b].push(a); };
  const add = (list, closed) => {
    const s = pts.length;
    list.forEach((p, i) => { pts.push(p); next.push([]); if (i) link(s + i - 1, s + i); });
    if (closed) link(s, s + list.length - 1);
    return s;
  };
  const nearestIn = (s, n, p) => { let b = s, bd = Infinity; for (let i = s; i < s + n; i++) { const d = dist(pts[i], p); if (d < bd) { bd = d; b = i; } } return b; };
  const a0 = add(road.approach), l0 = add(road.loop, true), y0 = add(road.yard);
  const A = road.approach;
  link(a0 + A.length - 1, nearestIn(l0, road.loop.length, A[A.length - 1])); // the main road runs into the turning loop
  link(y0, nearestIn(a0, A.length, road.yard[0]));                          // and the yard track turns off it
  G = { pts, next, nearest: (p) => nearestIn(0, pts.length, p) };
  return G;
}

// Points every ~0.5 m from `from` to `to`: onto the nearest bit of road, along the roads, off to `to`.
function routeTo(from, to) {
  const g = roadGraph(), s = g.nearest(from), e = g.nearest(to);
  const prev = new Int32Array(g.pts.length).fill(-1), seen = new Uint8Array(g.pts.length);
  const q = [s];
  seen[s] = 1;
  for (let k = 0; k < q.length; k++) {
    const c = q[k];
    if (c === e) break;
    for (const n of g.next[c]) if (!seen[n]) { seen[n] = 1; prev[n] = c; q.push(n); }
  }
  const nodes = [];
  for (let c = e; c !== -1; c = prev[c]) nodes.push(g.pts[c]);
  nodes.reverse();
  const line = (a, b) => {
    const out = [], n = Math.ceil(dist(a, b) / 0.5);
    for (let i = 1; i <= n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n });
    return out;
  };
  return [...line(from, nodes[0]), ...nodes, ...line(nodes[nodes.length - 1], to)];
}

// ───────── where wood goes ─────────

// The camp's wood pile: the first of a few spots near camp that nothing is built or planned on.
function stackSpot() {
  const spots = [{ x: -4.5, z: -6.5 }, { x: 4.5, z: -8 }, { x: -7.5, z: -1.5 }, { x: 3, z: 8.5 }, { x: -9, z: -8 }];
  const free = (s) => !houses.some((h) => dist(h.centre, s) < halfDiag(h) + 3) && ![...site.things].some((t) => dist(t.body.position, s) < 2.5);
  return spots.find(free) ?? spots[0];
}

// Where a log of radius r comes to rest among logs already lying side by side (they all run the same
// way): neighs [{ z, y, r }] across the load, floorY where the first layer sits, |z| ≤ zmax. It rolls
// into the lowest groove, so a second layer sits between two lower logs, never straight on top of one.
// Returns { z, y } (y = the log's middle).
function nestSpot(neighs, r, floorY, zmax, allowed = () => true) {
  let best = null;
  for (let z = -zmax; z <= zmax + 1e-6; z += 0.03) {
    if (!allowed(z)) continue;
    let y = floorY + r;
    for (const n of neighs) {
      const dz = Math.abs(n.z - z), reach = r + n.r;
      if (dz < reach) y = Math.max(y, n.y + Math.sqrt(reach * reach - dz * dz));
    }
    if (!best || y < best.y - 0.004) best = { z, y };
  }
  return best ?? { z: 0, y: floorY + r + 1 }; // (no room at all)
}

// Wood already lying in a rectangle (world), as neighbours for nestSpot, across z.
function laidOut(inside, zOf, yOf) {
  const out = [];
  for (const p of pieces) if (!p.dead && !p.held && inside(p)) out.push({ z: zOf(p), y: yOf(p), r: p.kind === 'log' ? p.r : 0.08 });
  return out;
}

// What lies in the pickup's bed (in the truck's own frame).
const bedLocal = (p) => car.body.pointToLocalFrame(p.body.position);
const inBed = (p) => { const l = bedLocal(p); return l.x > -2.3 && l.x < -0.6 && Math.abs(l.z) < 0.66 && l.y > -0.15 && l.y < 1.7; };
const bedKg = () => { let m = 0; for (const p of pieces) if (!p.dead && !p.held && inBed(p)) m += p.mass; return m; };
const carInZone = () => { const p = car.body.position; return Math.abs(p.x - ZONE.x) < ZONE.hw && Math.abs(p.z - ZONE.z) < ZONE.hd; };
const zoneHas = (p) => { const q = p.body.position; return Math.abs(q.x - ZONE.x) < ZONE.hw && Math.abs(q.z - ZONE.z) < ZONE.hd && q.y < YARD.h + 4; };

// ───────── felling safely ─────────

// Where to stand so the tree falls away from everything it could hurt, or null if there is
// something on two sides (then he leaves that tree).
function fellSpot(t, self) {
  const reach = t.h + 1.5, dirs = [];
  const danger = (x, z, w = 0) => {
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < reach + w && d > 1e-3) dirs.push({ x: (x - t.x) / d, z: (z - t.z) / d });
  };
  if (roadDist(t.x, t.z) < reach) {
    let b = null, bd = Infinity;
    for (const R of [road.approach, road.loop, road.yard]) for (const p of R) { const d = (p.x - t.x) ** 2 + (p.z - t.z) ** 2; if (d < bd) { bd = d; b = p; } }
    danger(b.x, b.z);
  }
  danger(CAMP.x, CAMP.z, 4);
  danger(YARD.x, YARD.z, YARD.r);
  for (const h of houses) danger(h.centre.x, h.centre.z, halfDiag(h) + 1);
  const pl = game.player.body.position;
  danger(pl.x, pl.z, 1);
  danger(car.body.position.x, car.body.position.z, 2.5);
  for (const o of crew) if (o !== self && !o.leaving) danger(o.pos.x, o.pos.z, 1);
  let sx = 0, sz = 0;
  for (const d of dirs) { sx += d.x; sz += d.z; }
  const sl = Math.hypot(sx, sz);
  if (dirs.length && (sl < 0.5 * dirs.length || dirs.some((d) => (d.x * sx + d.z * sz) / sl < 0.25))) return null;
  // nothing near: from whichever side he comes
  const ux = dirs.length ? sx / sl : self.pos.x - t.x, uz = dirs.length ? sz / sl : self.pos.z - t.z, ul = Math.hypot(ux, uz) || 1;
  return new THREE.Vector3(t.x + (ux / ul) * (t.r + 0.75), 0, t.z + (uz / ul) * (t.r + 0.75));
}

// Trees he may fell in an area: never near the camp, a house or the yard.
function treesIn(area, self) {
  return trees.filter((t) => t.alive && !t.cleared && dist(t, area) < area.r
    && dist(t, CAMP) > 12 && dist(t, YARD) > YARD.r + 2
    && !houses.some((h) => dist(t, h.centre) < halfDiag(h) + 4)
    && !crew.some((o) => o !== self && o.chopJob?.t === t));
}

// ───────── the lumberjack ─────────

class Lumberjack extends Worker {
  constructor(trade, saved) {
    super(trade, saved);
    this.wood = [];  // pieces of the tree he felled that still need sawing or carrying
    this.honesty = saved?.honesty ?? HONESTY[Math.random() < 0.4 ? 0 : Math.random() < 0.58 ? 1 : 2].v;
    this.cash = saved?.cash ?? 0;     // money from wood he sold, in his pocket
    this.sold = saved?.sold ?? 0;     // all he ever sold for you
    this.handed = saved?.handed ?? 0; // all he gave you
    this.asks = saved?.asks ?? 0;
    this.lastJob = saved?.lastJob ?? 'stack';
    this.logDims = saved?.logDims ?? null;
    this.tools();
    if (this.carry === 'log' && this.logDims) this.holdLog(this.logDims);
    else if (this.carry === 'log') this.carry = null;
  }

  // an axe in his hand, and a bow saw for cutting the trunk up
  tools() {
    const hand = this.m.arms[1];
    const steel = new THREE.MeshStandardMaterial({ color: 0x8b9298, metalness: 0.5, roughness: 0.4 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a7448, roughness: 0.8 });
    this.axe = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.78, 0.035), wood);
    handle.position.y = -0.84;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.17), steel);
    head.position.set(0, -1.18, 0.05);
    this.axe.add(handle, head);
    this.axe.traverse((o) => { o.castShadow = true; });
    hand.add(this.axe);
    this.saw = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.035, 0.62), steel);
    blade.position.set(0, -0.62, 0.36);
    const bow = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.02), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 }));
    bow.position.set(0, -0.52, 0.06);
    this.saw.add(blade, bow);
    this.saw.visible = false;
    hand.add(this.saw);
  }

  holdLog(d) {
    this.dropLogMesh();
    this.logDims = d;
    this.carry = 'log';
    const mesh = new THREE.Mesh(logGeometry(d.r, d.len), [woodMats.bark, woodMats.end, woodMats.end]);
    mesh.castShadow = true;
    mesh.rotation.x = Math.PI / 2; // along the way he faces, on his shoulder
    mesh.position.set(0.14 + d.r, 0.6 + d.r * 0.9, 0.05); // (beside his head, not on it)
    this.m.body.add(mesh);
    this.logMesh = mesh;
  }
  dropLogMesh() {
    if (!this.logMesh) return;
    this.m.body.remove(this.logMesh);
    this.logMesh.geometry.dispose();
    this.logMesh = null;
  }
  // the log off his shoulder, as a real piece again, at a spot (or in front of him)
  putLog(at, quat) {
    const d = this.logDims;
    if (!d) { this.carry = null; return null; }
    at ??= { x: this.pos.x + Math.sin(this.yaw) * 0.9, y: terrainHeight(this.pos.x, this.pos.z) + d.r + 0.05, z: this.pos.z + Math.cos(this.yaw) * 0.9 };
    quat ??= new CANNON.Quaternion().setFromEuler(Math.PI / 2, this.yaw, 0, 'YXZ');
    const p = new Piece('log', d, at, quat);
    p.by = this;
    this.dropLogMesh();
    this.carry = null;
    this.logDims = null;
    if (this.near()) audio.drop(0.8);
    return p;
  }
  putDown() { if (this.carry === 'log') this.putLog(); else super.putDown(); }

  // ── orders from the phone ──
  buildHouses() { return null; } // (not his trade)
  raise() { return null; }
  work(job, area) {
    if (this.inCar) this.leaveCar();
    this.lastJob = job;
    const nearYard = dist(area, YARD) < 45;
    this.order = { kind: 'lumber', job, area: { x: area.x, z: area.z, r: area.r ?? AREA_R }, phase: job === 'sell' && nearYard ? 'yard' : 'work', stack: job === 'stack' ? stackSpot() : null, fails: 0 };
    this.release();
    this.state = 'idle';
    this.thinkT = 0;
    this.setStatus('Starting');
  }
  stop() {
    if (this.inCar) this.leaveCar();
    super.stop();
  }
  leave() {
    if (this.leaving) return;
    if (this.inCar) this.leaveCar();
    if (this.cash > 0) {
      const n = this.cash;
      if (this.honesty >= 0.8) { this.handOver(n); game.hud.toast(`${this.name} gives you your $${n} before he goes.`); }
      else game.hud.toast(`${this.name} walks off with $${n} of yours.`);
      this.cash = 0;
    }
    super.leave();
  }
  release() {
    this.chopJob = null;
    this.sawJob = null;
    super.release();
  }

  // ── E on him: "the money, please" ──
  ask() {
    if (this.cash <= 0) { game.hud.toast(`${this.name}: I don't have any of your money.`); return; }
    this.asks++;
    let give;
    if (this.honesty >= 0.8 || this.asks >= 3) give = this.cash;
    else if (this.asks === 1) give = Math.round(this.cash * (this.honesty < 0.45 ? rnd(0.35, 0.55) : rnd(0.65, 0.85)));
    else give = this.honesty < 0.45 && Math.random() < 0.6 ? Math.round(this.cash * 0.5) : this.cash;
    give = clamp(give, 1, this.cash);
    this.handOver(give);
    if (this.cash <= 0) game.hud.toast(this.asks > 1 ? `${this.name}: Fine… here's the rest. $${give}.` : `${this.name}: Here's $${give}. All of it, boss.`);
    else game.hud.toast(`${this.name}: Here's $${give}. That's all of it, boss.`); // (it isn't)
    if (this.cash <= 0) this.asks = 0;
    audio.coins();
  }
  handOver(n) {
    this.cash -= n;
    this.handed += n;
    earn(n, `${this.name} handed over cash`);
  }
  askHint() { return this.cash > 0 ? (this.asks ? 'Ask for ALL of it' : 'Ask for the money') : null; }

  // ── what to do next ──
  think() {
    this.thinkT = 1.5;
    if (this.leaving || this.inCar) return;
    if (this.unpaid) {
      if (spend(WAGE, `Wages · ${this.name}`)) this.unpaid = false;
      else { this.release(); this.setStatus('Not paid — waiting for his wages'); return; }
    }
    const o = this.order;
    if (!o) { this.setStatus('Waiting for orders'); return; }
    if (this.carry === 'log') return this.deliver();
    this.wood = this.wood.filter((p) => !p.dead && !p.held && !p.anchored && pieces.has(p) && !p.joints.size);
    if (this.wood.some((p) => p.falling)) { this.setStatus('Timber! Waiting for it to settle'); this.thinkT = 0.5; return; }
    const big = this.wood.find((p) => this.tooBig(p));
    if (big) return this.doSaw(big);
    const truckJob = o.job !== 'stack' && o.phase === 'work';
    if (truckJob && o.job === 'sell' && carInZone() && bedKg() > 0) return this.goSell(); // (you drove it there for him)
    if (truckJob) {
      const why = this.truckProblem();
      if (why) { this.setStatus(why); return; }
      // full by weight, or piled as high as the sides (until somebody takes some out)
      const kg = bedKg();
      if (this.bedFull && kg < this.bedFull - 1) this.bedFull = null;
      if (kg > BED_KG - 30 || this.bedFull) {
        if (o.job === 'sell') return this.driveToYard();
        this.setStatus('The pickup is full — empty it and I go on');
        return;
      }
    }
    const next = this.nearestWood();
    if (next) return this.fetchPiece(next);
    if (o.phase === 'yard' && this.toSell()) return this.goSell();
    const pick = this.pickTree();
    if (pick) return this.doChop(pick);
    if (truckJob && o.job === 'sell' && bedKg() > 0) return this.driveToYard();
    this.setStatus(o.phase === 'yard' ? 'No more trees near the yard I can fell safely' : 'No trees left here I can fell safely — pick another spot');
    this.thinkT = 4;
  }

  tooBig(p) { return p.mass > CARRY_KG || p.len > this.maxLen() + 0.02; }
  maxLen() { return this.order?.job !== 'stack' && this.order?.phase === 'work' ? LEN_BED : LEN_HAND; }
  nearestWood() {
    let b = null, bd = Infinity;
    for (const p of this.wood) { const d = dist(p.body.position, this.pos); if (d < bd) { bd = d; b = p; } }
    return b;
  }
  // a loaded game: wood he cut that isn't where it was going yet, he goes on with
  adopt(p) {
    const S = this.order?.stack, q = p.body.position;
    if (zoneHas(p) || inBed(p) || (S && Math.abs(q.x - S.x) < 1.4 && Math.abs(q.z - S.z) < 1.7)) return;
    if (!this.wood.includes(p)) this.wood.push(p);
  }
  forget(p) { const i = this.wood.indexOf(p); if (i >= 0) this.wood.splice(i, 1); }
  toSell() { for (const p of pieces) if (p.by === this && !p.dead && !p.held && zoneHas(p)) return true; return false; }

  truckProblem() {
    if (car.driving) return 'Waiting for the pickup — you\'re driving it';
    if (car.auto) return 'Waiting for the pickup';
    if (car.upright() < 0.5) return 'The pickup is on its side — put it back on its wheels';
    const d = dist(car.body.position, this.order.area);
    if (d > TRUCK_FAR) return `Bring the pickup closer — it's ${Math.round(d)} m away`;
    return null;
  }

  pickTree() {
    const o = this.order, area = o.phase === 'yard' ? YARD_AREA : o.area;
    const list = treesIn(area, this).map((t) => ({ t, k: dist(t, this.pos) + Math.random() * 6 })).sort((a, b) => a.k - b.k);
    for (const { t } of list.slice(0, 25)) {
      const stand = fellSpot(t, this);
      if (stand) return { t, stand };
    }
    return null;
  }

  doChop({ t, stand }) {
    this.chopJob = { t };
    this.setStatus('Walking to a tree');
    const ok = this.goTo(stand, () => {
      if (!t.alive) return this.felled(t);
      this.state = 'chop';
      this.t = CHOP_TIME;
      this.face(t);
      this.setStatus('Felling a tree');
    });
    if (!ok) { this.chopJob = null; this.setStatus('Can\'t get to the tree'); }
  }
  felled(t) {
    this.chopJob = null;
    this.state = 'idle';
    this.thinkT = 0.4;
    if (t.log && !t.log.dead) { t.log.by = this; this.wood.push(t.log); }
  }

  doSaw(p) {
    const perM = Math.PI * p.r * p.r * DENSITY, max = this.maxLen();
    let seg = clamp(rnd(KG[0], KG[1]) / perM, MIN_LEN, max);
    if (p.len - seg < 0.4) seg = p.len / 2; // (never leave a stub)
    // from the end nearer to him
    const a = p.end(-1), b = p.end(1);
    const side = dist(a, this.pos) < dist(b, this.pos) ? -1 : 1;
    const ly = side < 0 ? -p.len / 2 + seg : p.len / 2 - seg;
    const at = p.body.pointToWorldFrame(new CANNON.Vec3(0, ly, 0));
    if (at.y - terrainHeight(at.x, at.z) > 1.5) {
      // it came down on another tree and hangs there: he can't reach it
      this.forget(p);
      game.hud.toast(`${this.name}: a trunk got stuck up in a tree — I'll leave that one.`);
      return this.think();
    }
    const ax = p.axis();
    let px = -ax.z, pz = ax.x;
    const pl = Math.hypot(px, pz) || 1;
    px /= pl; pz /= pl;
    if ((this.pos.x - at.x) * px + (this.pos.z - at.z) * pz < 0) { px = -px; pz = -pz; }
    const stand = new THREE.Vector3(at.x + px * (p.r + 0.55), 0, at.z + pz * (p.r + 0.55));
    this.setStatus('Sawing the trunk up');
    const ok = this.goTo(stand, () => {
      if (p.dead || p.held) return;
      this.sawJob = { p, ly };
      this.state = 'saw';
      this.t = SAW_TIME;
      this.face(at);
    });
    if (!ok) { this.forget(p); this.setStatus('Can\'t get to the trunk'); }
  }
  finishSaw() {
    const j = this.sawJob;
    this.sawJob = null;
    if (!j || j.p.dead || j.p.held) return;
    const at = j.p.body.pointToWorldFrame(new CANNON.Vec3(0, j.ly, 0));
    const parts = crossCut(j.p, at);
    this.forget(j.p);
    if (!parts) return;
    this.wood.push(...parts);
    for (const q of parts) { q.by = this; q.body.velocity.setZero(); q.body.angularVelocity.setZero(); }
    if (this.near()) { audio.cutDone(); particles.emit('sawdust', new THREE.Vector3(at.x, at.y, at.z), new THREE.Vector3(0, 1, 0), 12); }
  }

  fetchPiece(p) {
    this.setStatus('Picking up a piece');
    const q = p.body.position;
    const d = new THREE.Vector3(this.pos.x - q.x, 0, this.pos.z - q.z);
    if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
    d.setLength(0.7);
    const ok = this.goTo(new THREE.Vector3(q.x + d.x, 0, q.z + d.z), () => {
      if (p.dead || p.held || p.joints.size) return;
      this.forget(p);
      const dims = { r: p.r, len: p.len, species: p.species, tint: p.tint };
      p.destroy();
      this.holdLog(dims);
      this.state = 'take';
      this.t = TAKE_TIME;
      if (this.near()) audio.pickup();
    });
    if (!ok) { this.forget(p); this.setStatus('Can\'t get to that piece'); }
  }

  // the piece on his shoulder goes where the job says
  deliver() {
    const o = this.order, d = this.logDims;
    if (o.phase === 'yard') {
      // into the yard's drop area, beside the pickup if it is parked in there
      const n = nestSpot(laidOut(zoneHas, (p) => p.body.position.z - ZONE.z, (p) => p.body.position.y), d.r, YARD.h, ZONE.hd - 0.3 - d.r, (z) => {
        if (!carInZone()) return true;
        const l = car.body.pointToLocalFrame(new CANNON.Vec3(ZONE.x + 0.6, car.body.position.y, ZONE.z + z));
        return !(Math.abs(l.z) < 1.25 + d.r && Math.abs(l.x) < 3.4);
      });
      const spot = { x: ZONE.x + 0.6, y: n.y + 0.02, z: ZONE.z + n.z };
      this.setStatus('Carrying wood to the buyer');
      return this.carryTo(new THREE.Vector3(ZONE.x + ZONE.hw - 0.2, 0, spot.z), () => this.putLog(spot, ALONG_X));
    }
    if (o.job === 'stack') {
      const S = o.stack ?? (o.stack = stackSpot()), g = terrainHeight(S.x, S.z);
      const here = (p) => Math.abs(p.body.position.x - S.x) < 1.4 && Math.abs(p.body.position.z - S.z) < 1.7 && p.body.position.y < g + 2;
      const n = nestSpot(laidOut(here, (p) => p.body.position.z - S.z, (p) => p.body.position.y), d.r, g, 1.4 - d.r);
      const spot = { x: S.x, y: n.y + 0.02, z: S.z + n.z };
      this.setStatus('Carrying wood to the pile at camp');
      return this.carryTo(new THREE.Vector3(S.x + 1.8, 0, spot.z), () => this.putLog(spot, ALONG_X));
    }
    // into the pickup's bed
    const why = this.truckProblem();
    if (why) { this.setStatus(why); return; }
    const cb = car.body;
    const sides = [1.3, -1.3].map((s) => cb.pointToWorldFrame(new CANNON.Vec3(-1.45, 0, s)))
      .sort((a, b) => dist(a, this.pos) - dist(b, this.pos));
    const carAt = cb.position.clone();
    this.setStatus('Loading the pickup');
    this.carryTo(new THREE.Vector3(sides[0].x, 0, sides[0].z), () => {
      if (cb.position.distanceTo(carAt) > 1.5 || car.driving || car.auto) return; // (it drove off: he thinks again)
      // full: it goes on the ground beside the truck, and in once there is room again
      const full = () => { const p = this.putLog(); if (p) this.wood.push(p); };
      if (bedKg() + this.logMass() > BED_KG + 40) return full();
      // only logs lying lengthwise are stacked on; anything else in the bed (planks, bricks, a log across)
      // and he puts it down beside the truck instead of pushing into it
      const inv = cb.quaternion.inverse();
      const odd = [...pieces].some((p) => !p.dead && !p.held && inBed(p) && (p.kind !== 'log' || Math.abs(inv.vmult(p.axis()).x) < 0.85));
      if (odd) { full(); this.bedFull = bedKg(); this.setStatus('Something else is in the bed — empty it'); return; }
      // (the truck's frame: x along it, z across it; the floor's top is at 0.16, the sides' at 0.6)
      const spot = nestSpot(laidOut(inBed, (p) => bedLocal(p).z, (p) => bedLocal(p).y), d.r, 0.16, 0.55 - d.r);
      // a log may lie in the groove between two lower ones, but never with its middle above the rim
      if (spot.y > RIM) { full(); this.bedFull = bedKg(); this.setStatus('The pickup is full'); return; }
      const at = cb.pointToWorldFrame(new CANNON.Vec3(-1.45, spot.y + 0.02, spot.z));
      this.putLog(at, cb.quaternion.mult(ALONG_X));
    });
  }
  logMass() { const d = this.logDims; return d ? Math.PI * d.r * d.r * d.len * DENSITY : 0; }
  carryTo(spot, then) {
    const ok = this.goTo(spot, () => {
      then();
      this.state = 'take';
      this.t = TAKE_TIME;
    });
    if (!ok) { this.putLog(); this.setStatus('Can\'t get there with it'); }
  }

  // ── to the yard in your pickup ──
  driveToYard() {
    const o = this.order;
    if (carInZone()) return this.goSell();
    if (o.fails >= 2) { this.setStatus('Stuck with your pickup — drive it into the yard yourself'); this.thinkT = 3; return; }
    const door = car.body.pointToWorldFrame(new CANNON.Vec3(0.15, 1.0 - COM, -1.35));
    this.setStatus('Taking the wood to the yard');
    const ok = this.goTo(new THREE.Vector3(door.x, 0, door.z), () => {
      if (car.driving || car.auto) return;
      this.enterCar();
      const p = car.body.position;
      car.autoStart(routeTo({ x: p.x, z: p.z }, { x: ZONE.x - 0.5, z: ZONE.z }), (fine) => this.arrived(fine));
    });
    if (!ok) this.setStatus('Can\'t get to the pickup');
  }
  enterCar() {
    this.inCar = true;
    this.bedFull = null;
    this.release();
    this.body.collisionResponse = false;
    const g = this.m.g;
    game.scene.remove(g);
    car.model.add(g);
    this.sit();
    this.axe.visible = this.saw.visible = false;
    if (this.near()) audio.door(true);
    this.setStatus('Driving your pickup to the yard');
  }
  // sitting on the seat (its top is at 0.9, the roof is at 1.64): a little smaller and sunk into the
  // cushion, so his hard hat stays under the roof. Done every frame while he drives: the walk code that
  // fires enterCar() goes on to put his model at the door (world coordinates) in that same update.
  sit() {
    const g = this.m.g;
    g.position.set(-0.3, 0.044, -0.38);
    g.rotation.set(0, Math.PI / 2, 0);
    g.scale.setScalar(0.8);
    this.m.legs.forEach((l) => { l.rotation.x = -1.45; });
    this.m.arms.forEach((a) => { a.rotation.x = -1.25; });
    this.m.body.rotation.x = -0.15;
  }
  leaveCar() {
    if (!this.inCar) return;
    if (car.auto) { car.auto = null; car.engine = false; }
    this.inCar = false;
    const g = this.m.g;
    car.model.remove(g);
    game.scene.add(g);
    g.scale.setScalar(1);
    g.rotation.set(0, 0, 0);
    this.m.body.rotation.x = 0;
    const door = car.body.pointToWorldFrame(new CANNON.Vec3(0.15, 1.0 - COM, -1.35));
    this.pos.set(door.x, terrainHeight(door.x, door.z), door.z);
    this.body.position.set(this.pos.x, this.pos.y, this.pos.z); // (moved there at once, not "driven" there: no flying velocity)
    this.body.velocity.setZero();
    this.body.collisionResponse = true;
    this.state = 'idle';
    this.thinkT = 0.6;
    if (this.near()) audio.door(true);
  }
  arrived(fine) {
    this.leaveCar();
    if (!this.order) return;
    if (fine && carInZone()) return this.goSell();
    this.order.fails++;
    game.hud.toast(`${this.name}: your pickup got stuck on the way to the yard.`);
    this.setStatus('The pickup got stuck');
  }

  goSell() {
    const b = buyerPos();
    const spot = new THREE.Vector3(b.x + (ZONE.x - b.x) * 0.25, 0, b.z + (ZONE.z - b.z) * 0.25);
    this.setStatus('Selling the wood');
    const ok = this.goTo(spot, () => {
      this.face(b);
      const n = sell(this);
      this.state = 'take';
      this.t = 1.2;
      const o = this.order;
      if (n > 0) {
        this.cash += n;
        this.sold += n;
        this.asks = 0;
        game.hud.toast(`${this.name} sold your wood for $${n} — he has the cash`);
      }
      if (o && o.phase !== 'yard') {
        o.phase = 'yard';
        this.wood = []; // (whatever is left back where he was is yours now)
        game.hud.toast(`${this.name}: your pickup is parked at the timber yard. I'll fell trees near here now.`);
      }
    });
    if (!ok) this.setStatus('Can\'t get to the buyer');
  }

  // ── every frame ──
  update(dt) {
    if (this.inCar) {
      // he sits at the wheel; his body (that you bump into) waits where the truck is
      const p = car.body.position;
      this.pos.set(p.x, p.y, p.z);
      this.body.position.set(p.x, p.y - 3, p.z);
      this.body.velocity.setZero();
      this.sit();
      return;
    }
    // safety: out of the truck means standing in the world, never still hung on the truck
    if (this.m.g.parent !== game.scene) {
      car.model.remove(this.m.g);
      game.scene.add(this.m.g);
      this.m.g.scale.setScalar(1);
      this.m.g.rotation.set(0, 0, 0);
      this.m.body.rotation.x = 0;
    }
    if (this.state === 'chop') {
      const j = this.chopJob;
      this.t -= dt;
      if (!j) this.state = 'idle';
      else if (this.t <= 0) {
        this.t = CHOP_TIME;
        if (j.t.alive) {
          chopTree(j.t, this.pos);
          if (this.near()) {
            audio.chop();
            const d = new THREE.Vector3(this.pos.x - j.t.x, 0, this.pos.z - j.t.z).normalize();
            particles.emit('chip', new THREE.Vector3(j.t.x + d.x * j.t.r, j.t.y + 0.75, j.t.z + d.z * j.t.r), d, 8);
          }
        }
        if (!j.t.alive) this.felled(j.t);
      }
    } else if (this.state === 'saw') {
      this.t -= dt;
      if (this.t <= 0) { this.finishSaw(); this.state = 'idle'; this.thinkT = 0.2; }
      else if (this.near() && Math.random() < dt * 6 && this.sawJob) {
        const at = this.sawJob.p.body.pointToWorldFrame(new CANNON.Vec3(0, this.sawJob.ly, 0));
        particles.emit('sawdust', new THREE.Vector3(at.x, at.y, at.z), new THREE.Vector3(0, -1, 0), 2);
      }
    }
    super.update(dt);
    if (this.inCar) this.sit(); // (he just got in during this update, and the walk code then moved his model to the door)
    else this.pose();
  }

  // his own movements on top of the bricklayer's
  pose() {
    const a = this.m;
    a.crate.visible = a.sheet.visible = false;
    const shoulder = this.carry === 'log' && this.state !== 'take';
    this.axe.visible = this.state === 'chop' || (!this.carry && this.state !== 'saw');
    this.saw.visible = this.state === 'saw';
    if (this.state === 'chop') {
      // wind up over the shoulder, then down into the trunk
      const u = 1 - this.t / CHOP_TIME;
      const up = u < 0.65 ? Math.sin((u / 0.65) * Math.PI / 2) : 1 - (u - 0.65) / 0.35;
      a.arms[0].rotation.x = a.arms[1].rotation.x = -0.5 - up * 2.2;
      a.body.rotation.x = 0.08 + (1 - up) * 0.3;
    } else if (this.state === 'saw') {
      a.body.rotation.x = 0.7;
      a.arms[1].rotation.x = -0.75 + Math.sin(this.t * 11) * 0.32;
      a.arms[0].rotation.x = -0.5;
    } else if (shoulder) {
      a.arms[1].rotation.x = -2.75; // a hand up on the log
    }
  }

  saveMore() {
    const s = { honesty: this.honesty, cash: this.cash, sold: this.sold, handed: this.handed, asks: this.asks, lastJob: this.lastJob, logDims: this.carry === 'log' ? this.logDims : null };
    if (this.inCar) {
      // (he is loaded standing by the driver's door)
      const door = car.body.pointToWorldFrame(new CANNON.Vec3(0.15, 1.0 - COM, -1.35));
      s.x = Math.round(door.x * 1e4) / 1e4;
      s.z = Math.round(door.z * 1e4) / 1e4;
    }
    return s;
  }
}

TRADES.lumberjack = Lumberjack;

// ───────── picking the place to work (phone → Crew → a job) ─────────

export const lumber = { picking: null };
let ring = null;

export function startAreaPick(w, job) {
  lumber.picking = { w, job };
  game.hud.toast(`Look at the forest where ${w.name} should work · click picks it · right click cancels`);
}

function ringMesh() {
  const N = 72;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 2 * 3), 3));
  const idx = [];
  for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  m.renderOrder = 3;
  m.frustumCulled = false;
  m.userData.N = N;
  game.scene.add(m);
  return m;
}

export function updateAreaPick() {
  const P = lumber.picking, inp = game.input;
  if (!P) return;
  ring ??= ringMesh();
  const cam = game.camera;
  const o = cam.getWorldPosition(new THREE.Vector3()), d = cam.getWorldDirection(new THREE.Vector3());
  const hit = rayClosest(new CANNON.Vec3(o.x, o.y, o.z), new CANNON.Vec3(o.x + d.x * 70, o.y + d.y * 70, o.z + d.z * 70), GROUP.GROUND);
  ring.visible = !!hit;
  let n = 0;
  if (hit) {
    const c = { x: hit.point.x, z: hit.point.z, r: AREA_R };
    const pos = ring.geometry.attributes.position, N = ring.userData.N;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      for (const [k, rr] of [[0, AREA_R - 0.18], [1, AREA_R + 0.18]]) {
        const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
        pos.setXYZ(i * 2 + k, x, terrainHeight(x, z) + 0.12, z);
      }
    }
    pos.needsUpdate = true;
    n = treesIn(c, P.w).filter((t) => fellSpot(t, P.w)).length;
    P.spot = c;
  }
  game.hud.hint(hit ? [['Click', n ? 'He works here' : 'No trees he can fell here'], ['Right click', 'Cancel']] : [['', 'Look at the ground'], ['Right click', 'Cancel']]);
  game.hud.info(`${P.w.name} · ${JOBS[P.job]} · ${hit ? `${n} ${n === 1 ? 'tree' : 'trees'} he can fell safely here` : ''}`);
  if (inp.rmbDown) return stopPick();
  if (inp.lmbDown && hit) {
    if (!n) { game.hud.toast('No trees here he can fell safely (too close to the road, a house or the camp)'); return; }
    P.w.work(P.job, P.spot);
    game.hud.toast(`${P.w.name}: ${JOBS[P.job].toLowerCase()} — on it!`);
    audio.woodKnock();
    stopPick();
  }
}

function stopPick() {
  lumber.picking = null;
  if (ring) ring.visible = false;
  game.hud.hint([]);
  game.hud.info('');
}

// F4: a small readout of every lumberjack (where his model hangs, where the truck is), to screenshot
// when something looks wrong.
{
  let el = null, on = false;
  const fmt = (v) => `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;
  const draw = () => {
    if (!on) return;
    const v = new THREE.Vector3(), cp = car.body.position;
    const rows = crew.filter((w) => w.trade === 'lumberjack').map((w) => {
      w.m.g.getWorldPosition(v);
      const where = w.m.g.parent === car.model ? 'ON THE TRUCK' : w.m.g.parent === game.scene ? 'in the world' : 'elsewhere';
      return `${w.name}: inCar=${!!w.inCar} · model ${where} · visible=${w.m.g.visible} · scale ${w.m.g.scale.x.toFixed(2)}\n`
        + `  model local (${fmt(w.m.g.position)}) · world (${fmt(v)})\n`
        + `  pos.y ${w.pos.y.toFixed(2)} · ground ${terrainHeight(v.x, v.z).toFixed(2)} · state ${w.state} · ${w.status}`;
    });
    el.textContent = `[F4] truck (${fmt(cp)}) speed ${car.speed.toFixed(1)} · auto=${!!car.auto} · driving=${!!car.driving}\n${rows.join('\n') || 'no lumberjack hired'}`;
  };
  addEventListener('keydown', (e) => {
    if (e.code !== 'F4') return;
    e.preventDefault();
    on = !on;
    if (!el) {
      el = document.createElement('pre');
      el.style.cssText = 'position:fixed;left:8px;bottom:70px;z-index:99;margin:0;padding:8px 10px;background:rgba(0,0,0,.72);color:#9ff0b0;font:12px/1.35 ui-monospace,Consolas,monospace;pointer-events:none;white-space:pre-wrap;max-width:min(760px,92vw);border-radius:6px';
      document.body.appendChild(el);
      setInterval(draw, 150);
    }
    el.style.display = on ? 'block' : 'none';
    draw();
  });
}

export const lumberDebug ={ routeTo, fellSpot, treesIn, bedKg, stackSpot, carInZone };
