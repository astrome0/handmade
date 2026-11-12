// A whole game as one plain object, and back. Every module saves and loads its own part;
// this file puts them together, in the order they need each other on the way back in.
// Loading always goes into a freshly built world (nothing built, no starter pallet).
import { game } from './game.js';
import { CANNON } from './physics.js';
import { trees, felledBefore, treeBody, damageTree, clearTree } from './world.js';
import { pieces, Piece } from './items.js';
import { nailState, restoreNail, linkNail, relinkNail, rebuildAll } from './nails.js';
import { money } from './money.js';
import { car } from './car.js';
import { saveMasonry, loadMasonry } from './masonry.js';
import { saveVillage, loadHouses, finishHouses, loadHandRoofs } from './village.js';
import { saveCrew, loadCrew, crew } from './workers.js';
import { saveDelivery, loadDelivery } from './delivery.js';
import { saveRope, loadRope } from './rope.js';
import { setMode, modeState } from './modes.js';
import { savePaint, loadPaint } from './paint.js';
import { saveStreets, loadStreets } from './streets.js';
import { flashlight } from './flashlight.js';

export const FORMAT = 'handmade-save';
export const VERSION = 2;

const r4 = (v) => Math.round(v * 1e4) / 1e4, r5 = (v) => Math.round(v * 1e5) / 1e5;
const vec = (v) => [r4(v.x), r4(v.y), r4(v.z)];
const rot = (q) => [r5(q.x), r5(q.y), r5(q.z), r5(q.w)];

// Every game has its own id, so an autosave of one game never covers another one by accident.
export const newGameId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ───────── saving ─────────

export function collect() {
  const ctx = { wallIndex: new Map() };
  const pl = game.player, b = car.body;
  const data = {
    format: FORMAT,
    version: VERSION,
    game: game.id,
    mode: modeState(),
    savedAt: Date.now(),
    playTime: Math.round(game.playTime),
    day: { day: game.day.day, t: game.day.t },
    money: { balance: Number.isFinite(money.balance) ? money.balance : 0, log: money.log }, // (creative: ∞ comes from the mode)
    player: { pos: game.driving ? vec(b.position) : vec(pl.body.position), yaw: r4(pl.yaw), pitch: r4(pl.pitch), light: flashlight.on },
    tools: { nails: game.tools.nails, slot: game.tools.slot },
    car: { pos: vec(b.position), quat: rot(b.quaternion), lights: car.lights, driving: game.driving, view: car.view },
    trees: {
      felled: trees.filter((t) => !t.alive && !t.cleared).map((t) => t.i),
      cleared: trees.filter((t) => t.cleared).map((t) => t.i),
      chopped: trees.filter((t) => t.alive && t.hp < t.maxHp).map((t) => [t.i, t.hp]),
    },
    // the village first: its houses' walls take the first places in the wall list
    village: saveVillage(ctx),
  };
  data.masonry = saveMasonry(ctx);
  data.crew = saveCrew(ctx);
  data.pieces = [...pieces].filter((p) => !p.dead).map((p) => {
    const s = {
      id: p.id, kind: p.kind, len: r4(p.len), tint: r4(p.tint), species: p.species,
      pos: vec(p.body.position), quat: rot(p.body.quaternion),
    };
    if (p.kind === 'log') s.r = r4(p.r);
    else { s.w = r4(p.w); s.t = r4(p.t); }
    if (p.anchored) { s.anchored = true; s.drive = p.drive; }
    if (p.nails.length) s.nails = p.nails.map(nailState);
    if (p.by && !p.by.leaving) s.by = p.by.name; // (wood a lumberjack cut: he sells only his own)
    return s;
  });
  data.delivery = saveDelivery();
  data.rope = saveRope();
  data.paint = savePaint(); // (one entry per house, in the village's order; older saves have none)
  data.streets = saveStreets(); // (older saves have none)
  return data;
}

// A short summary for the save list (and a small picture of the view).
export function summary(data, thumb) {
  const done = data.village.houses.filter((h) => h.state === 'done');
  return {
    game: data.game,
    mode: data.mode?.id ?? 'forest',
    savedAt: data.savedAt,
    village: data.village.name,
    founded: !!data.village.founded,
    day: data.day.day,
    clock: clockOf(data.day.t),
    money: data.money.balance,
    houses: done.length,
    people: done.reduce((n, h) => n + (h.family?.members.length ?? 0), 0),
    crew: data.crew.length,
    bricks: data.masonry.bricks.length,
    playTime: data.playTime,
    thumb,
  };
}

const clockOf = (t) => { const m = Math.floor(t * 24 * 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// What you see right now, small (taken straight after a frame is drawn, so the canvas still has it).
export function thumbnail() {
  try {
    game.renderer.render(game.scene, game.camera);
    const c = document.createElement('canvas');
    c.width = 256; c.height = 144;
    const src = game.renderer.domElement, k = Math.max(c.width / src.width, c.height / src.height);
    const w = src.width * k, h = src.height * k;
    c.getContext('2d').drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
    return c.toDataURL('image/jpeg', 0.72);
  } catch { return null; }
}

// ───────── loading ─────────

// Older saves are brought up to date here, one version at a time.
export function migrate(d) {
  if (!d || d.format !== FORMAT) throw new Error('This is not a Handmade save file.');
  if (d.version > VERSION) throw new Error('This save comes from a newer version of the game.');
  // 1 → 2: games got a kind (start modes); everything before was an empty-forest game
  if (d.version === 1) { d.mode = { id: 'forest' }; d.version = 2; }
  // (next: if (d.version === 2) { …; d.version = 3; })
  return d;
}

export function apply(raw) {
  const d = migrate(raw);
  const ctx = { walls: [], pieces: new Map() };

  game.id = d.game ?? newGameId();
  game.day.t = d.day.t;
  game.day.day = d.day.day;
  game.playTime = d.playTime ?? 0;
  money.balance = d.money.balance;
  money.log.length = 0;
  money.log.push(...d.money.log);
  setMode(d.mode.id, d.mode); // (creative: the money is ∞ again)
  game.hud.money(money.balance);

  for (const i of d.trees.felled) if (trees[i]) felledBefore(trees[i]);
  for (const i of d.trees.cleared ?? []) if (trees[i]) clearTree(trees[i]);
  for (const [i, hp] of d.trees.chopped) if (trees[i]) damageTree(trees[i], hp);
  // streets reshape the ground, so they come before anything that stands or lies on it
  loadStreets(d.streets);

  // house plans (their walls), then every brick, door and window, then roofs and families
  loadHouses(d.village, ctx, d.masonry.walls);
  loadMasonry(d.masonry, ctx);
  finishHouses(d.village);
  loadHandRoofs(d.roofs, ctx); // (only saves from the first "Roof it" have these: now they become houses)
  loadPaint(d.paint); // (plaster, paint, painted frames and roofs)

  // wood: the pieces, then their nails, then the joints the nails make
  for (const s of d.pieces) {
    const p = new Piece(s.kind, { r: s.r, w: s.w, t: s.t, len: s.len, tint: s.tint, species: s.species }, { x: s.pos[0], y: s.pos[1], z: s.pos[2] }, new CANNON.Quaternion(...s.quat));
    if (s.anchored) { p.anchored = true; p.drive = s.drive; p.makeStatic(); }
    ctx.pieces.set(s.id, p);
  }
  const lost = [];
  for (const s of d.pieces) {
    const p = ctx.pieces.get(s.id);
    for (const ns of s.nails ?? []) {
      const n = restoreNail(p, ns);
      const o = ns.other;
      if (!o) continue;
      if (o.piece !== undefined) { const q = ctx.pieces.get(o.piece); if (q) linkNail(n, q.body); }
      else if (o.tree !== undefined) { const body = trees[o.tree] && treeBody(trees[o.tree]); if (body) linkNail(n, body); }
      else lost.push(n); // a wall, a stump, a post: found again along the nail below
    }
  }
  for (const n of lost) relinkNail(n);
  rebuildAll();
  for (const p of ctx.pieces.values()) { p.sync(); if (!p.anchored) p.body.sleep(); }

  // the pickup and you
  const cb = car.body;
  cb.position.set(...d.car.pos);
  cb.quaternion.set(...d.car.quat);
  cb.velocity.setZero();
  cb.angularVelocity.setZero();
  car.hold = null;
  if (d.car.lights) car.setLights(true);
  const pl = game.player;
  pl.body.position.set(...d.player.pos);
  pl.body.velocity.setZero();
  pl.anchor = null;
  pl.yaw = d.player.yaw;
  pl.pitch = d.player.pitch;
  if (d.player.light || flashlight.on) flashlight.set(!!d.player.light, true);

  loadDelivery(d.delivery);
  loadCrew(d.crew, ctx);
  for (const s of d.pieces) {
    if (!s.by) continue;
    const p = ctx.pieces.get(s.id);
    p.by = crew.find((w) => w.name === s.by) ?? null;
    p.by?.adopt?.(p);
  }

  const t = game.tools;
  t.nails = d.tools.nails;
  game.hud.setNails(t.nails);
  t.select(d.tools.slot);
  loadRope(d.rope, d.rope && ctx.pieces.get(d.rope.piece));

  if (d.car.driving) {
    car.enter();
    car.view = d.car.view ?? 'cab';
    car.startT = -1;
    car.engine = true;
  }
  return d;
}
