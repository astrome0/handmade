// How a game starts (New game screen), and what makes each kind of game different:
// an empty forest, a small settlement or a whole town already standing, creative, or a challenge.
import { game } from './game.js';
import { CANNON } from './physics.js';
import { terrainHeight, roadDist, parkDist, yardDist, road, HALF, YARD } from './terrain.js';
import { trees, clearTree } from './world.js';
import { Piece } from './items.js';
import { money } from './money.js';
import { spawnStarter, spawnCargo, setAllDry } from './masonry.js';
import { village, PLANS, markOut, settledFamily, foundQuietly } from './village.js';
import { houses, buildNow, hireHere } from './workers.js';
import { paintNow } from './paint.js';
import { traceStreet, layStreet, houseSpots, streetDist, addLamp, addSign, at as streetAt, OUT, HW } from './streets.js';

// ───────── the kinds of game ─────────

export const MODES = {
  forest: {
    name: 'Empty forest', blurb: 'Just you, your tools, an old pickup and a little money. Everything else you make.',
    money: 300, chips: ['$300', 'starter bricks', 'no village yet'],
  },
  settlement: {
    name: 'Small settlement', blurb: 'Two houses with families already live on a little street off the road. Two bricklayers wait for your orders, and a plan is marked out.',
    money: 1500, built: ['family', 'cottage'], marked: ['cottage'], crew: 2, stock: 'small', streets: [34],
    chips: ['$1,500', '2 houses', '1 street', '2 workers', 'materials'],
  },
  town: {
    name: 'Town', blurb: 'A town of seven houses on two streets with lamps and a crossing. You are its builder: four workers, a big stockpile, two new plans.',
    money: 5000, built: ['family', 'cottage', 'family', 'cottage', 'family', 'cottage', 'cottage'], marked: ['family', 'cottage'], crew: 4, stock: 'big', streets: [56, 30],
    chips: ['$5,000', '7 houses', '2 streets', '4 workers', 'big stockpile'],
  },
  creative: {
    name: 'Creative', blurb: 'Money without end, orders arrive the moment you pay, the crew works three times as fast. F to fly.',
    money: Infinity, creative: true, chips: ['$∞', 'instant orders', 'fast crew', 'F: fly'],
  },
  families: {
    name: 'Five families', blurb: 'Challenge: by the end of day 10, five families live in houses you built. You start with $1,500.',
    money: 1500, challenge: { kind: 'families', target: 5, day: 10 }, chips: ['challenge', '$1,500', '10 days'],
  },
  selfmade: {
    name: 'From nothing', blurb: 'Challenge: $20, no bricks, no help. Have $1,000 by the end of day 5 — the forest is your bank.',
    money: 20, noStarter: true, challenge: { kind: 'money', target: 1000, day: 5 }, chips: ['challenge', '$20', '5 days'],
  },
};

export const VILLAGE_NAMES = ['Borovice', 'Lipová', 'Dubnice', 'Jedlová', 'Bukovec', 'Smrková', 'Javorník', 'Olšany', 'Habrová', 'Modřín', 'Jasenná', 'Březnice', 'Klenová', 'Topolná'];

// game.mode: { id, creative, challenge: { …goal, won, failed } }
export function setMode(id, state = {}) {
  const M = MODES[id] ?? MODES.forest;
  game.mode = { id: MODES[id] ? id : 'forest', creative: !!M.creative, instant: !!M.creative, fly: !!M.creative, workSpeed: M.creative ? 3 : 1 };
  if (M.challenge) game.mode.challenge = { ...M.challenge, won: !!state.won, failed: !!state.failed };
  if (M.creative) money.balance = Infinity;
  showGoal();
}

export const modeState = () => ({ id: game.mode?.id ?? 'forest', won: !!game.mode?.challenge?.won, failed: !!game.mode?.challenge?.failed });

// A new game of this kind, in the empty world (the forest is grown; nothing is built yet).
export function startMode(id, name) {
  const M = MODES[id] ?? MODES.forest;
  village.name = (name || '').trim().slice(0, 24) || 'Borovice';
  money.balance = M.money;
  money.log.length = 0;
  setMode(id);
  if (!M.noStarter) spawnStarter();
  if (M.built) buildVillage(M);
  game.hud.money(money.balance);
}

// ───────── a village that is already there ─────────

const CAMP = { x: -1, z: 0.5 };      // your camp and where you start: kept clear
const STOCK = { x: -9, z: 7.5 };     // the builder's yard with the stockpile
const HALF_DIAG = (id) => Math.hypot(PLANS[id].nx * 0.2, PLANS[id].nz * 0.2) / 2;

// The house's corners and edges, from its front corner and yaw (as markOut takes them).
function frame(id, x, z, yaw) {
  const W = PLANS[id].nx * 0.2, D = PLANS[id].nz * 0.2;
  const ex = { x: Math.cos(yaw), z: -Math.sin(yaw) }, ez = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const at = (lx, lz) => ({ x: x + ex.x * lx + ez.x * lz, z: z + ex.z * lx + ez.z * lz });
  return { W, D, at, centre: at(W / 2, D / 2) };
}

// Is this a good spot? Returns a score (lower is better) or null.
function judge(id, x, z, yaw, chosen) {
  const f = frame(id, x, z, yaw);
  const c = f.centre, r = HALF_DIAG(id);
  if (Math.abs(c.x) > HALF - 16 || Math.abs(c.z) > HALF - 16) return null;
  if (Math.hypot(c.x - CAMP.x, c.z - CAMP.z) < r + 8.5) return null;
  if (Math.hypot(c.x - STOCK.x, c.z - STOCK.z) < r + 5) return null;
  for (const o of chosen) if (Math.hypot(c.x - o.c.x, c.z - o.c.z) < r + o.r + 3) return null;
  let lo = Infinity, hi = -Infinity;
  for (let lx = -0.6; lx <= f.W + 0.6 + 1e-6; lx += (f.W + 1.2) / 8) {
    for (let lz = -0.6; lz <= f.D + 0.6 + 1e-6; lz += (f.D + 1.2) / 6) {
      const p = f.at(lx, lz);
      if (roadDist(p.x, p.z) < 3.2 || parkDist(p.x, p.z) < 6 || yardDist(p.x, p.z) < YARD.r + 5 || streetDist(p.x, p.z) < OUT + 0.8) return null;
      if (lx < 0 || lz < 0 || lx > f.W || lz > f.D) continue;
      const h = terrainHeight(p.x, p.z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
  }
  // it stands on a stone plinth, so a slope is fine, but not a hillside
  if (hi - lo > 0.75) return null;
  const inWay = trees.filter((t) => t.alive && Math.hypot(t.x - c.x, t.z - c.z) < r + 1.5).length;
  return Math.hypot(c.x - 6, c.z - 3) + inWay * 1.5 + (hi - lo) * 8;
}

// Where houses could stand: along the streets (if the village has them), else along the roads with
// the door to the road, and round the clearing facing camp.
function candidates(made = []) {
  const out = [];
  if (made.length) {
    for (const s of made) out.push(...houseSpots(s));
    return out;
  }
  const FRONT = 5; // front wall this far from the middle of the road
  for (const R of [road.approach, road.loop, road.yard]) {
    for (let i = 3; i < R.length - 3; i += 4) {
      const tx = R[i + 1].x - R[i - 1].x, tz = R[i + 1].z - R[i - 1].z, tl = Math.hypot(tx, tz);
      for (const s of [1, -1]) out.push({ F: { x: R[i].x + (-tz / tl) * s * FRONT, z: R[i].z + (tx / tl) * s * FRONT }, sn: { x: (-tz / tl) * s, z: (tx / tl) * s } });
    }
  }
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 14) {
    for (const rr of [13, 16.5, 20]) out.push({ F: { x: CAMP.x + Math.cos(a) * rr, z: CAMP.z + Math.sin(a) * rr }, sn: { x: Math.cos(a), z: Math.sin(a) } });
  }
  return out;
}

// Pick a spot for each plan: the best free one, nearest camp first.
export function planSites(ids, made = []) {
  const cands = candidates(made), chosen = [];
  for (const id of ids) {
    let best = null;
    for (const { F, sn } of cands) {
      const yaw = Math.atan2(sn.x, sn.z); // the house runs back from its front along sn; the door faces the other way
      const W = PLANS[id].nx * 0.2;
      const x = F.x - Math.cos(yaw) * W / 2, z = F.z + Math.sin(yaw) * W / 2;
      const s = judge(id, x, z, yaw, chosen);
      if (s !== null && (!best || s < best.s)) best = { id, x, z, yaw, s };
    }
    if (!best) continue;
    const f = frame(id, best.x, best.z, best.yaw);
    chosen.push({ ...best, c: f.centre, r: HALF_DIAG(id) });
  }
  return chosen;
}

function buildVillage(M) {
  const made = M.streets ? layStreets(M.streets) : [];
  const sites = planSites([...M.built, ...M.marked], made);
  const clear = (c, r) => { for (const t of trees) if (t.alive && Math.hypot(t.x - c.x, t.z - c.z) < r) clearTree(t); };
  clear(STOCK, 4.5);
  sites.forEach((s) => clear(s.c, s.r + 1.5));
  foundQuietly();
  sites.forEach((s, i) => {
    const h = markOut(s.id, s.x, s.z, s.yaw, true);
    if (i >= M.built.length) return; // marked out, for your crew to build
    if (!buildNow(h)) return;
    h.finish(settledFamily(h));
    if (Math.random() < 0.85) paintNow(h); // (most were plastered and painted long ago)
  });
  setAllDry();
  stockpile(M.stock);
  hireHere(M.crew, { x: STOCK.x + 3.2, z: STOCK.z - 2.5 });
}

// The village's streets: the first off the main road where the land is kindest, near camp; the next
// ones off the side of the first. Finished, with lamps, a name sign at each and a zebra crossing.
function layStreets(lens) {
  const made = [];
  const A = road.approach;
  // the main street: try spots along the road both ways, keep the one that needs least digging
  let best = null;
  for (let i = 4; i < A.length - 4; i += 3) {
    const p = A[i];
    if (p.x < 20 || p.x > 80) continue;
    const t = { x: A[i + 1].x - A[i - 1].x, z: A[i + 1].z - A[i - 1].z }, tl = Math.hypot(t.x, t.z);
    for (const sg of [1, -1]) {
      const d = { x: (-t.z / tl) * sg, z: (t.x / tl) * sg };
      const a = { x: p.x + d.x * 2.3, z: p.z + d.z * 2.3 };
      a.h = terrainHeight(a.x, a.z);
      const tr = traceStreet({ kind: 'road' }, a, d, lens[0]);
      if (!tr) continue;
      const score = tr.cost + Math.hypot(a.x - 6, a.z - 3) * 0.15 - tr.len * 0.5;
      if (!best || score < best.score) best = { a, d, score, start: { kind: 'road' } };
    }
  }
  if (!best) return made;
  const main = layStreet(best.start, best.a, best.d, lens[0], clearTree);
  if (!main) return made;
  made.push(main);
  // side streets off the main one, on whichever side the land allows
  for (let n = 1; n < lens.length; n++) {
    let side = null;
    for (const frac of [0.55, 0.45, 0.65, 0.35]) {
      for (const sg of [1, -1]) {
        const along = main.length * frac;
        const p = streetAt(main, along, sg * HW), q = streetAt(main, along + 0.5, 0), c = streetAt(main, along - 0.5, 0);
        const t = { x: q.x - c.x, z: q.z - c.z }, tl = Math.hypot(t.x, t.z);
        const d = { x: (-t.z / tl) * sg, z: (t.x / tl) * sg };
        const tr = traceStreet({ kind: 'street', of: main }, p, d, lens[n]);
        if (tr && (!side || tr.cost < side.cost)) side = { p, d, cost: tr.cost };
      }
      if (side) break;
    }
    if (!side) continue;
    const s = layStreet({ kind: 'street', of: main }, side.p, side.d, lens[n], clearTree);
    if (s) made.push(s);
  }
  // lamps every ~16 m, side to side; a name sign at the start; a crossing on the main street
  for (const s of made) {
    for (let a = 7, i = 0; a < s.length - 3; a += 16, i++) addLamp(s, a, i % 2);
    addSign(s, 4.5, 0, 'name');
    if (s.start.kind === 'street') addSign(s, 3.2, 1, 'yield');
  }
  if (main.length > 24) { main.zebras.push(14); main.dirty = true; addSign(main, 11.5, 1, 'crossing'); }
  return made;
}

// The builder's yard: pallets in a row, mortar bags, door and window crates, roofing sheets, logs and planks.
function stockpile(size) {
  const big = size === 'big';
  const q = (yaw) => new CANNON.Quaternion().setFromEuler(0, yaw, 0);
  const at = (dx, dz, up = 0.03) => ({ x: STOCK.x + dx, y: terrainHeight(STOCK.x + dx, STOCK.z + dz) + up, z: STOCK.z + dz });
  const pallets = big ? 8 : 3;
  for (let i = 0; i < pallets; i++) spawnCargo({ kind: 'pallet', count: 48 }, at(-3 + (i % 4) * 1.2, -2.6 + Math.floor(i / 4) * 1.1), q(0));
  const bags = big ? 18 : 6;
  for (let i = 0; i < bags; i++) spawnCargo({ kind: 'mortar' }, at(2.2 + (i % 3) * 0.68, -2.6 + Math.floor(i / 3) * 0.48), q(0));
  const fits = big ? ['door', 'door', 'window', 'window', 'window', 'window', 'window', 'window'] : ['door', 'window', 'window'];
  fits.forEach((k, i) => spawnCargo({ kind: k }, at(-3.2 + (i % 4) * 1.6, 0.6 + Math.floor(i / 4) * 2.6), q(Math.PI / 2)));
  const sheets = big ? 16 : 8;
  // (two flat stacks, one sheet on another)
  for (let i = 0; i < sheets; i++) new Piece('sheet', { w: 1.0, t: 0.012, len: 2.0 }, at(3.4 + (i % 2) * 1.15, 1.2, 0.03 + Math.floor(i / 2) * 0.016), new CANNON.Quaternion().setFromEuler(Math.PI / 2, 0, 0));
  const logs = big ? 6 : 3;
  for (let i = 0; i < logs; i++) new Piece('log', { r: 0.12, len: 3 }, at(-3 + i * 0.27, 4.4, 0.13), new CANNON.Quaternion().setFromEuler(Math.PI / 2, 0, 0));
  const planks = big ? 12 : 6;
  for (let i = 0; i < planks; i++) new Piece('plank', { w: 0.15, t: 0.034, len: 3 }, at(0.6 + (i % 6) * 0.17, 4.4, 0.03 + Math.floor(i / 6) * 0.036), new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0));
}

// ───────── challenges ─────────

const goalEl = () => document.getElementById('goal');

function families() { return houses.filter((h) => h.state === 'done' && h.family).length; }

function progress(c) {
  return c.kind === 'families' ? families() : Math.max(0, Math.floor(Number.isFinite(money.balance) ? money.balance : 0));
}

function goalText(c) {
  const p = progress(c);
  if (c.won) return `✓ Challenge done: ${c.kind === 'families' ? `${c.target} families` : `$${c.target.toLocaleString('en-US')}`}`;
  if (c.failed) return `✗ Time's up — free play now`;
  const what = c.kind === 'families' ? `Families ${p} / ${c.target}` : `$${p.toLocaleString('en-US')} / $${c.target.toLocaleString('en-US')}`;
  const left = c.day - game.day.day;
  return `${what} · ${left > 0 ? `${left + 1} days left` : 'last day'}`;
}

export function showGoal() {
  const el = goalEl(), c = game.mode?.challenge;
  if (!el) return;
  el.classList.toggle('hide', !c);
  if (c) { el.textContent = goalText(c); el.classList.toggle('won', c.won); el.classList.toggle('lost', c.failed); }
}

let goalT = 0;
export function updateMode(dt) {
  const c = game.mode?.challenge;
  if (!c || !game.started) return;
  goalT -= dt;
  if (goalT > 0) return;
  goalT = 0.5;
  if (!c.won && !c.failed) {
    if (progress(c) >= c.target) {
      c.won = true;
      game.hud.toast(c.kind === 'families' ? `Challenge done! ${c.target} families live in ${village.name}.` : `Challenge done! $${c.target.toLocaleString('en-US')} — from nothing.`);
    } else if (game.day.day > c.day) {
      c.failed = true;
      game.hud.toast(`Day ${c.day} is over — the challenge is lost. Keep building if you like.`);
    }
  }
  showGoal();
}

export const modesDebug = { planSites, MODES };
