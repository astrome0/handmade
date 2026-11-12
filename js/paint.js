// Plaster and paint for the houses — by hand, or by a painter you hire.
// You buy everything in the Woodline app: paint buckets (pick the colour and how many), plaster bags,
// a brush, a roller, a plastering float. The truck tips them off at the end of the road like bricks.
// With the tools (slot 7, R switches brush / roller / float) you paint walls stroke by stroke, frames
// and doors with the brush, roof sheets from the ground. A painter does the same from the same buckets:
// in the Crew app you choose which of your colours go on the walls, frames, door and roof, and point
// at a house.
//
// A wall is a grid of 20 cm cells. Plaster and every paint colour on a house are thin skins over the
// outside of the walls (rectangles round the doors and windows); a mask texture shows only the cells
// that are done, so strokes appear where they go on. Paint on bare bricks shows the joints through it.
// Fresh plaster is dark until it's dry; fresh paint is glossy; paint fades over the days; a painted
// house where a family lives gets flower boxes under its windows.
import * as THREE from 'three';
import { world, CANNON, GROUP, MASK, MAT, rayClosest } from './physics.js';
import { game } from './game.js';
import { terrainHeight } from './terrain.js';
import { TEX } from './textures.js';
import { audio } from './audio.js';
import { site, BRICK } from './masonry.js';
import { Worker, TRADES, crew, houses } from './workers.js';
import { spend, WAGE } from './money.js';
import { clamp, rng } from './util.js';

const { U, MY, fitMats } = site;

// ───────── what there is ─────────

export const PAINTS = [
  ['white', '#f1eee7'], ['cream', '#ecdcb8'], ['sand', '#d8c19a'], ['yellow', '#e9c96c'], ['ochre', '#c99a4b'], ['salmon', '#e2a184'],
  ['terracotta', '#b9664b'], ['red', '#8e2f25'], ['sage', '#a8b898'], ['mint', '#bcd5c2'], ['green', '#2f4a36'], ['teal', '#2f6e6a'],
  ['sky', '#a9c3d6'], ['blue', '#2f4f70'], ['slate', '#7f93a5'], ['grey', '#a9a7a1'], ['anthracite', '#3a3d40'], ['black', '#2b2b2a'], ['brown', '#6b4a2e'],
];
export const hexOf = (id) => (PAINTS.find((c) => c[0] === id) ?? PAINTS[0])[1];

const CELL = 0.2, CELL_M2 = CELL * CELL;
export const BUCKET_CELLS = 600;   // a 10 l bucket: 24 m²
export const BAG_CELLS = 100;      // 25 kg of plaster: 4 m² (render is thick)
const PLASTER_MAX = 2 * BAG_CELLS; // what fits in your bucket of mixed plaster
const COST = { frame: 12, leaf: 16, band: 40, sheet: 45 }; // cells of paint for one of these
const PLASTER_RATE = 0.22, PAINT_RATE = 0.35;              // the painter: metres of wall a second
const PLASTER_DRY = 120, PAINT_DRY = 45;                   // seconds until it's dry
const FIT_TIME = 2.6, DOOR_TIME = 3.5, BAND_TIME = 3.2, SHEET_TIME = 0.9, BRUSH_HOLD = 1.1;
const FADE_DAYS = 20;
const ROUND = [0, 3, 2, 1];        // front, left, back, right: once round the house
const GRID_E = 0.03;               // the cell grid lies on a skin this far out
const OUT = { plaster: 0.014, paint: 0.019 };
const TIP = { brush: [0.8, 0.8], roller: [1.7, 1.1], float: [1.3, 1.3] }; // cells reached by one stroke (along, up)

// ───────── textures: rough render, and paint on bricks (the joints show through) ─────────

let TX = null;
function textures() {
  if (TX) return TX;
  const make = (w, h, draw, rx, ry) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), rng(w * 7 + h));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = TEX.grain?.anisotropy ?? 4;
    t.repeat.set(rx, ry); // (the skins' uv is in metres)
    return t;
  };
  const speckle = (g, R, w, h, n) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = R() < 0.5 ? `rgba(90,82,70,${0.06 + R() * 0.12})` : `rgba(255,255,250,${0.08 + R() * 0.2})`;
      g.fillRect(R() * w, R() * h, 1 + R() * 2.2, 1 + R() * 2.2);
    }
  };
  TX = {
    // 1.2 m of hand-trowelled render: fine grit and soft swirls
    plaster: make(256, 256, (g, R) => {
      g.fillStyle = '#f4f2ec';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 46; i++) {
        g.strokeStyle = R() < 0.5 ? 'rgba(120,110,95,0.07)' : 'rgba(255,255,255,0.16)';
        g.lineWidth = 6 + R() * 14;
        const x = R() * 256, y = R() * 256, r = 14 + R() * 30, a = R() * 6;
        for (const [dx, dy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) { g.beginPath(); g.arc(x + dx, y + dy, r, a, a + 1.4 + R()); g.stroke(); }
      }
      speckle(g, R, 256, 256, 2600);
    }, 1 / 1.2, 1 / 1.2),
    // two bricks by two courses (0.8 × 0.28 m), stretcher bond, the joints a little sunk
    wash: make(512, 180, (g, R) => {
      g.fillStyle = '#f4f2ec';
      g.fillRect(0, 0, 512, 180);
      for (let row = 0; row < 2; row++) for (let k = -1; k < 3; k++) {
        const x = k * 256 + (row ? 128 : 0);
        g.fillStyle = `rgba(${R() < 0.5 ? '120,110,100' : '255,255,255'},${0.03 + R() * 0.05})`;
        g.fillRect(x + 4, row * 90 + 4, 248, 82);
      }
      speckle(g, R, 512, 180, 1800);
      g.fillStyle = 'rgba(95,88,80,0.34)';
      for (const y of [0, 90]) { g.fillRect(0, y - 3, 512, 6); }
      g.fillRect(0, 177, 512, 3);
      for (const x of [0, 256, 512]) g.fillRect(x - 3, 0, 6, 90);
      for (const x of [128, 384]) g.fillRect(x - 3, 90, 6, 90);
    }, 1 / 0.8, 1 / 0.28),
  };
  return TX;
}

// ───────── a house's walls, from outside ─────────

const sideLen = (h, s) => (s % 2 === 0 ? h.plan.nx : h.plan.nz) * U;

// Side s seen from outside, e out from the bricks: where u = 0 is (O), which way u runs (A),
// which way it faces (N) — all in the house's own frame — and the openings in it.
function sideOf(h, s, e) {
  const W = h.plan.nx * U, D = h.plan.nz * U;
  const S = [
    { O: [W + e, -e], A: [-1, 0], N: [0, -1], u: (x) => W + e - x },
    { O: [W + e, D + e], A: [0, -1], N: [1, 0], u: (z) => D + e - z },
    { O: [-e, D + e], A: [1, 0], N: [0, 1], u: (x) => x + e },
    { O: [-e, -e], A: [0, 1], N: [-1, 0], u: (z) => z + e },
  ][s];
  const len = sideLen(h, s) + 2 * e;
  // the lowest ground along it (no gap under the render), unless it stands on a plinth
  let bottom = 0;
  if (!h.plinth) {
    for (let k = 0; k <= 12; k++) {
      const u = (len * k) / 12, lx = S.O[0] + S.A[0] * u, lz = S.O[1] + S.A[1] * u;
      const p = h.wall.world(lx, lz);
      bottom = Math.min(bottom, terrainHeight(p.x, p.z) - h.wall.y0 - 0.03);
    }
  }
  const holes = [];
  for (const f of h.fits) {
    if (f.side !== s) continue;
    const at = s % 2 === 0 ? f.ix : f.iz; // (grid cells along this side)
    const a = S.u(at * U + 0.005), b = S.u((at + f.L) * U - 0.005);
    const open = f.H * MY - 0.01 - BRICK.h - 0.01; // (the lintel above it gets covered)
    const v0 = f.kind === 'door' ? -10 : f.iy * MY + 0.005;
    holes.push({ u0: Math.min(a, b), u1: Math.max(a, b), v0, v1: f.iy * MY + 0.005 + open, f });
  }
  return { ...S, s, e, len, bottom, top: h.height * MY, holes };
}

// The cell grid of a side (the same for every coat): size, and which cells are wall (not a hole).
function gridOf(h, s) {
  h.grids ??= [];
  if (h.grids[s]) return h.grids[s];
  const sd = sideOf(h, s, GRID_E);
  const nu = Math.ceil(sd.len / CELL), nv = Math.ceil((sd.top - sd.bottom) / CELL);
  const need = new Uint8Array(nu * nv);
  let count = 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const u = (i + 0.5) * CELL, v = sd.bottom + (j + 0.5) * CELL;
    if (u > sd.len || v > sd.top) continue;
    if (sd.holes.some((o) => u > o.u0 && u < o.u1 && v > o.v0 && v < o.v1)) continue;
    need[j * nu + i] = 1;
    count++;
  }
  return (h.grids[s] = { sd, nu, nv, need, count });
}

// The skin of one side at e: rectangles round the openings. uv in metres (textures),
// uv1 0…1 over the cell grid (the mask).
function sideGeometry(h, s, e) {
  const sd = sideOf(h, s, e), G = gridOf(h, s);
  const { O, A, N, len, bottom, top, holes } = sd;
  const us = [...new Set([0, len, ...holes.flatMap((o) => [o.u0, o.u1])])].filter((u) => u >= 0 && u <= len).sort((a, b) => a - b);
  const pos = [], nor = [], uv = [], uv1 = [], idx = [];
  const W = G.nu * CELL, H = G.nv * CELL, shift = GRID_E - e; // (u here → u on the grid)
  const vert = (u, v) => {
    pos.push(O[0] + A[0] * u, v, O[1] + A[1] * u);
    nor.push(N[0], 0, N[1]);
    uv.push(u, v);
    uv1.push((u + shift) / W, (v - G.sd.bottom) / H);
    return pos.length / 3 - 1;
  };
  for (let i = 0; i < us.length - 1; i++) {
    const ua = us[i], ub = us[i + 1];
    if (ub - ua < 1e-5) continue;
    let spans = [[bottom, top]];
    for (const o of holes) {
      if (o.u0 >= ub - 1e-6 || o.u1 <= ua + 1e-6) continue;
      spans = spans.flatMap(([a, b]) => [[a, Math.min(b, o.v0)], [Math.max(a, o.v1), b]]).filter(([a, b]) => b - a > 1e-4);
    }
    for (const [va, vb] of spans) {
      const a = vert(ua, va), b = vert(ub, va), c = vert(ub, vb), d = vert(ua, vb);
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  g.setIndex(idx);
  return g;
}

// ───────── what's on a house ─────────
// h.coat = {
//   plaster: { cells: [Uint8Array × 4] (1 = plastered), wet: [s × 4] } | null,
//   paints: [{ colour, cells: [Uint8Array × 4] (1 on bare brick, 2 on plaster), wet: [s × 4], day }],
//   fits: [{ frame: { colour, day }, leaf: { colour, day } } | null] (same order as h.fits),
//   band: { colour, day } | null,   sheets: [{ colour, day } | null] (same order as h.roof) }
// A cell has one paint colour at most: painting it another colour takes it off the old one.

const today = () => game.day.day + game.day.t;
const coatOf = (h) => (h.coat ??= { plaster: null, paints: [], fits: [], band: null, sheets: [] });
const blank = (h) => ROUND.map(() => null).map((_, s) => new Uint8Array(gridOf(h, s).nu * gridOf(h, s).nv));
const houseOfWall = (w) => houses.find((h) => h.wall === w) ?? null;

const listeners = new Set();
export const onCoatChange = (fn) => listeners.add(fn);
let dirtyT = 0;
const changed = () => { dirtyT = 0.5; }; // (the phone hears about it at most twice a second)

// One cell: plaster it, or paint it. Returns true if it changed.
function setCell(h, s, k, kind, colour) {
  const c = coatOf(h);
  if (kind === 'plaster') {
    c.plaster ??= { cells: blank(h), wet: [0, 0, 0, 0] };
    if (c.plaster.cells[s][k]) return false;
    c.plaster.cells[s][k] = 1;
    c.plaster.wet[s] = PLASTER_DRY;
    for (const p of c.paints) if (p.cells[s][k]) { p.cells[s][k] = 0; dirty(h, p, s); } // (the plaster covers it)
    dirty(h, c.plaster, s);
    return true;
  }
  const over = c.plaster?.cells[s][k] ? 2 : 1;
  let p = c.paints.find((x) => x.colour === colour);
  if (p && p.cells[s][k] === over) return false;
  if (!p) c.paints.push(p = { colour, cells: blank(h), wet: [0, 0, 0, 0], day: today() });
  for (const o of c.paints) if (o !== p && o.cells[s][k]) { o.cells[s][k] = 0; dirty(h, o, s); }
  p.cells[s][k] = over;
  p.wet[s] = PAINT_DRY;
  p.day = today();
  dirty(h, p, s);
  return true;
}
const plasterWet = (h, s) => (h.coat?.plaster?.wet[s] ?? 0) > 0;

// How much of the walls is plastered / painted (and the colour most of it is).
export function wallState(h) {
  const c = h.coat;
  let need = 0, pl = 0;
  const by = new Map();
  for (let s = 0; s < 4; s++) {
    const G = gridOf(h, s);
    need += G.count;
    for (let k = 0; k < G.need.length; k++) {
      if (!G.need[k]) continue;
      if (c?.plaster?.cells[s][k]) pl++;
      for (const p of c?.paints ?? []) if (p.cells[s][k]) by.set(p.colour, (by.get(p.colour) ?? 0) + 1);
    }
  }
  const painted = [...by.values()].reduce((a, b) => a + b, 0);
  const main = [...by].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { need, plaster: pl / need, paint: painted / need, main };
}

// ───────── drawing it ─────────

function frameOf(h) {
  if (h.coatGroup) return h.coatGroup;
  const g = new THREE.Group();
  g.position.set(h.wall.o.x, h.wall.y0, h.wall.o.z);
  g.rotation.y = h.wall.yaw;
  game.scene.add(g);
  return (h.coatGroup = g);
}

const views = new WeakMap(); // coat → [side → [{ mesh, mat, tex, want }]]

function maskTexture(G) {
  const t = new THREE.DataTexture(new Uint8Array(G.nu * G.nv * 4), G.nu, G.nv, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.channel = 1;
  t.needsUpdate = true;
  return t;
}

function viewOf(h, coat) {
  let v = views.get(coat);
  if (v) return v;
  const T = textures(), plaster = coat === h.coat.plaster;
  v = [];
  for (let s = 0; s < 4; s++) {
    const G = gridOf(h, s), parts = [];
    // plaster: one skin; paint: one on bare bricks (joints show) and one on plaster
    for (const want of plaster ? [1] : [1, 2]) {
      const tex = maskTexture(G);
      const map = plaster || want === 2 ? T.plaster : T.wash;
      const mat = new THREE.MeshStandardMaterial({ map, alphaMap: tex, alphaTest: 0.5, color: plaster ? PLASTER_COL.clone() : new THREE.Color(hexOf(coat.colour)), roughness: plaster ? 0.97 : 0.88 });
      const mesh = new THREE.Mesh(sideGeometry(h, s, plaster ? OUT.plaster : OUT.paint), mat);
      mesh.receiveShadow = true;
      frameOf(h).add(mesh);
      parts.push({ mesh, mat, tex, want, dirty: true });
    }
    v.push(parts);
  }
  views.set(coat, v);
  return v;
}
const PLASTER_COL = new THREE.Color('#e6e1d6');

function dirty(h, coat, s) { const v = views.get(coat); if (v) for (const p of v[s]) p.dirty = true; }

function dropView(h, coat) {
  const v = views.get(coat);
  if (!v) return;
  for (const parts of v) for (const p of parts) { h.coatGroup.remove(p.mesh); p.mesh.geometry.dispose(); p.mat.dispose(); p.tex.dispose(); }
  views.delete(coat);
}

function refreshMask(coat, s, p) {
  const src = coat.cells[s], d = p.tex.image.data;
  let any = false;
  for (let k = 0; k < src.length; k++) {
    const on = src[k] === p.want ? 255 : 0;
    d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = d[k * 4 + 3] = on;
    if (on) any = true;
  }
  p.tex.needsUpdate = true;
  p.mesh.visible = any;
  p.dirty = false;
}

// 0 fresh … 1 as faded as it gets
const fadeOf = (day) => (day == null ? 0 : clamp((today() - day) / FADE_DAYS, 0, 1));
// a colour a while in the sun: less saturated, paler
const _hsl = {}, _c = new THREE.Color(), _base = new THREE.Color();
function faded(hex, f, out) {
  out.set(hex);
  if (f <= 0) return out;
  out.getHSL(_hsl);
  _c.setHSL(_hsl.h, _hsl.s * 0.55, _hsl.l + (1 - _hsl.l) * 0.28);
  return out.lerp(_c, f);
}

function drawHouse(h, dt) {
  const c = h.coat;
  if (c.plaster) {
    const v = viewOf(h, c.plaster);
    for (let s = 0; s < 4; s++) {
      c.plaster.wet[s] = Math.max(0, c.plaster.wet[s] - dt);
      const p = v[s][0];
      if (p.dirty) refreshMask(c.plaster, s, p);
      p.mat.color.copy(PLASTER_COL).multiplyScalar(1 - 0.34 * clamp(c.plaster.wet[s] / PLASTER_DRY, 0, 1));
    }
  }
  for (const coat of [...c.paints]) {
    // a colour that's been painted over everywhere is gone
    if (coat.cells.every((a) => !a.some(Boolean))) { dropView(h, coat); c.paints.splice(c.paints.indexOf(coat), 1); continue; }
    const v = viewOf(h, coat), fade = fadeOf(coat.day);
    for (let s = 0; s < 4; s++) {
      coat.wet[s] = Math.max(0, coat.wet[s] - dt);
      const w = clamp(coat.wet[s] / PAINT_DRY, 0, 1);
      for (const p of v[s]) {
        if (p.dirty) refreshMask(coat, s, p);
        faded(hexOf(coat.colour), fade, p.mat.color).multiplyScalar(1 - 0.1 * w);
        p.mat.roughness = 0.88 - 0.58 * w; // a wet sheen
      }
    }
  }
  // frames, doors, the band under the roof, roof sheets
  for (const it of itemMats(h)) faded(it.hex, fadeOf(it.day), it.mat.color).multiplyScalar(it.dark ?? 1);
}

// ───────── frames, doors, band, roof sheets ─────────

// Every painted thing gets its own material (it fades on its own). Meshes are tagged with what
// they are (userData.part) the first time, so a second coat finds them.
function partMat(part, colour) {
  const hex = hexOf(colour);
  if (part === 'sheet') return new THREE.MeshStandardMaterial({ map: TEX.sheet, color: hex, roughness: 0.5, metalness: 0.25 });
  return new THREE.MeshStandardMaterial({ color: hex, roughness: part === 'band' ? 0.62 : 0.45 });
}

function paintFit(h, i, part, colour, day = today()) {
  const f = h.fits[i];
  if (!f?.rec) return;
  const c = coatOf(h);
  c.fits[i] ??= { frame: null, leaf: null };
  c.fits[i][part] = { colour, day };
  const F = fitMats();
  const frameMat = part === 'frame' ? partMat('frame', colour) : null;
  const leafMat = part === 'leaf' ? partMat('leaf', colour) : null;
  const panelMat = part === 'leaf' ? partMat('leaf', colour) : null;
  f.rec.group.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.part ??= o.material === F.frame ? 'frame' : o.material === F.leaf ? 'leaf' : o.material === F.panel ? 'panel' : null;
    if (part === 'frame' && o.userData.part === 'frame') o.material = frameMat;
    if (part === 'leaf' && o.userData.part === 'leaf') o.material = leafMat;
    if (part === 'leaf' && o.userData.part === 'panel') o.material = panelMat;
  });
  h.itemMats = null;
}

function paintBand(h, colour, day = today()) {
  if (!h.roofGroup) return;
  const m = partMat('band', colour);
  h.roofGroup.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material === h.roofWood) o.userData.part = 'band';
    if (o.userData.part === 'band') o.material = m;
  });
  coatOf(h).band = { colour, day };
  h.itemMats = null;
}

function paintSheet(h, i, colour, day = today()) {
  const s = h.roof?.[i];
  if (!s?.mesh) return;
  const old = s.mesh.material;
  const m = partMat('sheet', colour);
  s.mesh.material = [old[0], old[1], old[2], old[3], m, m];
  coatOf(h).sheets[i] = { colour, day };
  h.itemMats = null;
}

// the materials to fade, with their colour and day (made again when something gets painted)
function itemMats(h) {
  if (h.itemMats) return h.itemMats;
  const L = [], c = h.coat;
  const seen = new Set();
  const add = (mat, rec, dark) => { if (!mat || seen.has(mat) || !rec) return; seen.add(mat); L.push({ mat, hex: hexOf(rec.colour), day: rec.day, dark }); };
  h.fits.forEach((f, i) => {
    const r = c.fits[i];
    if (!r || !f.rec) return;
    f.rec.group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.part === 'frame') add(o.material, r.frame);
      if (o.userData.part === 'leaf') add(o.material, r.leaf);
      if (o.userData.part === 'panel') add(o.material, r.leaf, 0.84);
    });
  });
  if (c.band) h.roofGroup?.traverse((o) => { if (o.isMesh && o.userData.part === 'band') add(o.material, c.band); });
  h.roof?.forEach((s, i) => { if (c.sheets[i] && s.mesh) add(s.mesh.material[4], c.sheets[i]); });
  return (h.itemMats = L);
}

// ───────── flower boxes: a painted house where a family lives ─────────

function flowerBoxes(h) {
  if (h.state !== 'done' || h.flowers) {
    if (h.flowers) { const col = boxColour(h); if (col !== h.flowers.col) { h.flowers.col = col; h.flowers.mat.color.set(hexOf(col)); } }
    return;
  }
  if ((h.flowerCheck = (h.flowerCheck ?? 0) - 1) > 0) return;
  h.flowerCheck = 60;
  if (wallState(h).paint < 0.6) return;
  const R = rng(h.id * 977 + 13), g = new THREE.Group(), col = boxColour(h);
  const mat = new THREE.MeshStandardMaterial({ color: hexOf(col), roughness: 0.5 });
  const earth = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.8 });
  const bloom = [0xd8433b, 0xf2a7c3, 0xf3d04a, 0xf6f2ea, 0x9a5cc8, 0xe9772e].map((x) => new THREE.MeshStandardMaterial({ color: x, roughness: 0.6 }));
  const e = OUT.paint + 0.004;
  for (const f of h.fits) {
    if (f.kind !== 'window' || !f.placed) continue;
    const sd = sideOf(h, f.side, e), hole = sd.holes.find((o) => o.f === f);
    if (!hole) continue;
    const len = hole.u1 - hole.u0 - 0.1, u = (hole.u0 + hole.u1) / 2, y = hole.v0 - 0.07;
    const box = new THREE.Mesh(new THREE.BoxGeometry(len, 0.15, 0.17), mat);
    box.position.set(sd.O[0] + sd.A[0] * u + sd.N[0] * 0.095, y, sd.O[1] + sd.A[1] * u + sd.N[1] * 0.095);
    box.rotation.y = Math.atan2(-sd.A[1], sd.A[0]); // (its length along the wall)
    box.castShadow = box.receiveShadow = true;
    const soil = new THREE.Mesh(new THREE.BoxGeometry(len - 0.04, 0.02, 0.13), earth);
    soil.position.y = 0.066;
    box.add(soil);
    // a row of plants: leaves, and a flower or two on each, one colour or two per box
    const pal = [bloom[Math.floor(R() * bloom.length)], bloom[Math.floor(R() * bloom.length)]];
    const n = Math.max(4, Math.round(len / 0.11));
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + 0.05 + (len - 0.1) * (i + 0.5) / n;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.05 + R() * 0.02, 6, 4), leaf);
      l.position.set(x, 0.1 + R() * 0.02, (R() - 0.5) * 0.06);
      l.scale.y = 0.75;
      box.add(l);
      for (let j = 0; j < 1 + (R() < 0.5 ? 1 : 0); j++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.028 + R() * 0.012, 6, 4), pal[R() < 0.7 ? 0 : 1]);
        b.position.set(x + (R() - 0.5) * 0.06, 0.15 + R() * 0.06, (R() - 0.5) * 0.08);
        box.add(b);
      }
    }
    g.add(box);
  }
  frameOf(h).add(g);
  h.flowers = { g, mat, col };
}
// the boxes are the frames' colour (white when nobody painted those)
const boxColour = (h) => h.coat?.fits.find((r) => r?.frame)?.frame.colour ?? 'white';

// ───────── things you buy: buckets, plaster bags, tools ─────────

export const things = new Set();
// kind: 'bucket' { colour, cells } | 'plaster' | 'tool' { tool: 'brush' | 'roller' | 'float' }
const TOOL_NAME = { brush: 'Paint brush', roller: 'Paint roller', float: 'Plastering float' };

let labels = {};
function label(lines, bg, fg) {
  const k = lines.join('|') + bg;
  if (labels[k]) return labels[k];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 256, 128);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '600 40px Outfit, system-ui, sans-serif';
  x.fillText(lines[0], 128, 48);
  x.font = '500 22px Outfit, system-ui, sans-serif';
  x.fillText(lines[1], 128, 94);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (labels[k] = t);
}

// how each looks (also on the truck's bed), and how big its box for physics is (half sizes)
export function thingMesh(it) {
  const g = new THREE.Group();
  const add = (m, y = 0) => { m.position.y = y; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  if (it.kind === 'bucket') {
    const hex = hexOf(it.colour);
    const side = new THREE.MeshStandardMaterial({ map: label(['PAINT', `${it.colour} · 10 l`], '#f2efe8', '#3a2a1a'), roughness: 0.6 });
    const plastic = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.6 });
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.3, 16), [side, plastic, plastic]), 0.15);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.025, 16), new THREE.MeshStandardMaterial({ color: hex, roughness: 0.5 })), 0.31);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.006, 4, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0x8a8f93, metalness: 0.4, roughness: 0.4 }));
    add(handle, 0.3);
    g.userData.half = [0.15, 0.16, 0.15];
  } else if (it.kind === 'plaster') {
    const paper = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.95 });
    const top = new THREE.MeshStandardMaterial({ map: label(['PLASTER', '25 kg · render mix'], '#c9c6bd', '#3a3a38'), roughness: 0.95 });
    add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.4), [paper, paper, top, paper, paper, paper]), 0.06);
    g.userData.half = [0.31, 0.06, 0.2];
  } else {
    const card = new THREE.MeshStandardMaterial({ color: 0xc8a878, roughness: 0.9 });
    const top = new THREE.MeshStandardMaterial({ map: label([it.tool.toUpperCase(), TOOL_NAME[it.tool].toLowerCase()], '#e8dcc0', '#4a3b28'), roughness: 0.9 });
    const len = it.tool === 'brush' ? 0.32 : 0.5;
    add(new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.16), [card, card, top, card, card, card]), 0.035);
    g.userData.half = [len / 2, 0.035, 0.08];
  }
  return g;
}

class PaintThing {
  constructor(it, pos, quat) {
    Object.assign(this, it);
    this.mesh = thingMesh(it);
    game.scene.add(this.mesh);
    const half = this.mesh.userData.half;
    const mass = it.kind === 'bucket' ? 4 + 10 * (it.cells / BUCKET_CELLS) : it.kind === 'plaster' ? 25 : 1;
    this.body = new CANNON.Body({ mass, material: MAT.wood, collisionFilterGroup: GROUP.PIECE, collisionFilterMask: MASK.ALL, allowSleep: true, sleepSpeedLimit: 0.15 });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(...half)), new CANNON.Vec3(0, half[1], 0));
    this.body.position.set(pos.x, pos.y, pos.z);
    if (quat) this.body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    this.body.paintThing = this;
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
    changed();
  }
}
export const spawnPaintThing = (it, pos, quat) => new PaintThing(it, pos, quat);
const putDownAt = (it, x, z, yaw = 0) => new PaintThing(it, { x, y: terrainHeight(x, z) + 0.1, z }, new CANNON.Quaternion().setFromEuler(0, yaw, 0));

export function thingInfo(t) {
  if (t.kind === 'bucket') return `Paint · ${t.colour} · ${t.cells >= BUCKET_CELLS ? 'full' : `${Math.round((t.cells / BUCKET_CELLS) * 100)}% left`} (~${Math.round(t.cells * CELL_M2)} m²)`;
  if (t.kind === 'plaster') return 'Plaster mix · 25 kg · ~4 m²';
  return TOOL_NAME[t.tool];
}
export function thingHint(t) {
  if (t.kind === 'bucket') return kit.bucket ? `Swap your ${kit.bucket.colour} for this one` : 'Take the paint';
  if (t.kind === 'plaster') return 'Mix the plaster';
  return `Take the ${TOOL_NAME[t.tool].toLowerCase()}`;
}

// ───────── your kit ─────────
// tools you own, the bucket in your hand (one colour at a time), mixed plaster in your bucket

export const kit = { brush: false, roller: false, float: false, use: null, bucket: null, plaster: 0 };
const kitList = () => ['brush', 'roller', 'float'].filter((k) => kit[k]);

// E on a bucket, a bag or a tool box
export function takePaintThing(t) {
  if (t.kind === 'tool') {
    kit[t.tool] = true;
    kit.use = t.tool;
    t.remove();
    audio.pickup?.();
    game.hud.toast(`Got a ${TOOL_NAME[t.tool].toLowerCase()} · press 7, R switches tools`);
  } else if (t.kind === 'plaster') {
    if (kit.plaster > PLASTER_MAX - BAG_CELLS) { game.hud.toast('Your bucket of plaster is still full.'); return; }
    kit.plaster += BAG_CELLS;
    t.remove();
    audio.bag?.();
    game.hud.toast(`Mixed the plaster: ~${Math.round(kit.plaster * CELL_M2)} m² · use the float (7)`);
  } else {
    const yours = kit.bucket;
    kit.bucket = { colour: t.colour, cells: t.cells };
    const p = t.body.position;
    t.remove();
    if (yours && yours.cells > 0) putDownAt({ kind: 'bucket', ...yours }, p.x, p.z);
    audio.pickup?.();
    game.hud.toast(`${t.colour[0].toUpperCase() + t.colour.slice(1)} paint in your hand${yours ? ` · put your ${yours.colour} down` : ''}`);
  }
  changed();
}

// R with the painting tools: the next one you own
export function nextTool() {
  const L = kitList();
  if (!L.length) return;
  kit.use = L[(L.indexOf(kit.use) + 1) % L.length];
  audio.pickup?.();
}

// ───────── painting by hand (slot 7) ─────────

const ray = new THREE.Raycaster();
let strokeT = 0, holdT = 0, holdOn = null;

// What you aim at that takes paint: a house wall (side, u, v) or a frame/door/band/sheet.
function paintTarget(a) {
  const o = a.origin, d = a.dir;
  // frames, doors, the band, roof sheets: three.js meshes (thin, or no physics of their own)
  ray.set(o, d);
  ray.far = 3.6;
  let best = null;
  for (const h of houses) {
    if (h.centre.distanceTo(o) > 14) continue;
    const objs = [];
    for (const f of h.fits) if (f.rec) objs.push(f.rec.group);
    if (h.roofGroup) objs.push(h.roofGroup);
    for (const hit of ray.intersectObjects(objs, true)) {
      if (best && hit.distance >= best.dist) break;
      const m = hit.object;
      let it = null;
      const fi = h.fits.findIndex((f) => f.rec && isIn(m, f.rec.group));
      if (fi >= 0) {
        const part = m.userData.part ?? (m.material === fitMats().frame ? 'frame' : m.material === fitMats().leaf || m.material === fitMats().panel ? 'leaf' : null);
        if (part) it = { h, kind: part === 'frame' ? 'frame' : 'leaf', i: fi };
      } else if (h.roof) {
        const si = h.roof.findIndex((s) => s.mesh === m);
        if (si >= 0) it = { h, kind: 'sheet', i: si };
        else if (m.material === h.roofWood || m.userData.part === 'band') it = { h, kind: 'band' };
      }
      if (it) { best = { ...it, dist: hit.distance }; }
      break; // (the nearest thing of that house blocks the rest)
    }
  }
  // a house wall: the brick you hit, from outside
  if (a.brick && a.brick.kind === 'brick' && (!best || a.dist < best.dist)) {
    const h = houseOfWall(a.brick.wall);
    if (!h) return { none: 'Only house walls take plaster and paint' };
    const w = h.wall, n = a.normal, p = a.point;
    const nx = n.x * w.ex.x + n.z * w.ex.z, nz = n.x * w.ez.x + n.z * w.ez.z;
    const dx = p.x - w.o.x, dz = p.z - w.o.z, lx = dx * w.ex.x + dz * w.ex.z, lz = dx * w.ez.x + dz * w.ez.z;
    const W = h.plan.nx * U, D = h.plan.nz * U;
    const s = nz < -0.7 && lz < U ? 0 : nz > 0.7 && lz > D - U ? 2 : nx > 0.7 && lx > W - U ? 1 : nx < -0.7 && lx < U ? 3 : -1;
    if (s < 0) return { none: 'Only the outside of the walls (for now)' };
    const sd = gridOf(h, s).sd;
    return { h, kind: 'wall', s, u: sd.u(s % 2 === 0 ? lx : lz), v: p.y - w.y0, dist: a.dist };
  }
  return best;
}
const isIn = (o, g) => { for (let x = o; x; x = x.parent) if (x === g) return true; return false; };

// Called every frame while slot 7 is out (after the saw, so the arm motion is ours).
export function paintUpdate(dt, a) {
  const inp = game.input;
  if (!kit.use || !kit[kit.use]) kit.use = kitList()[0] ?? null;
  const tool = kit.use, t = tool && a ? paintTarget(a) : null;
  const L = [];
  game.vm.paintTool?.(tool, kit.bucket ? hexOf(kit.bucket.colour) : null, kit.plaster > 0);
  if (!tool) { L.push(['', 'No painting tools — buy a brush, roller or float in Woodline (Paint)']); game.hud.hint(L); return; }
  if (kitList().length > 1) L.push(['R', `Switch (${TOOL_NAME[tool].toLowerCase()})`]);
  const plasterTool = tool === 'float';
  const supply = plasterTool ? kit.plaster : kit.bucket?.cells ?? 0;
  let why = null;
  if (plasterTool && !supply) why = 'No plaster — mix a bag (E on it)';
  else if (!plasterTool && !supply) why = kit.bucket ? 'Your bucket is empty' : 'No paint — take a bucket (E on it)';
  else if (t?.none) why = t.none;
  else if (t && plasterTool && t.kind !== 'wall') why = 'Plaster goes on the walls';
  else if (t && !plasterTool && t.kind === 'wall' && plasterWet(t.h, t.s)) why = 'The plaster is still wet — let it dry';
  else if (t && tool === 'roller' && (t.kind === 'frame' || t.kind === 'leaf' || t.kind === 'band')) why = 'Too fiddly for the roller — use the brush';
  const name = t ? { wall: 'the wall', frame: 'the frame', leaf: 'the door', band: 'the boards', sheet: 'the roof sheet' }[t.kind] : null;
  if (why) L.push(['', why]);
  else if (t) L.push(['Hold click', plasterTool ? 'Plaster the wall' : `Paint ${name}`]);
  game.hud.hint(L);
  game.hud.info(plasterTool ? `Plaster for ~${Math.round(kit.plaster * CELL_M2)} m²` : kit.bucket ? `${kit.bucket.colour} paint · ~${Math.round(kit.bucket.cells * CELL_M2)} m² left` : 'No paint in hand');

  const working = inp.lmb && t && !why;
  game.vm.sawing = !!working;
  if (!working) { holdT = 0; holdOn = null; game.hud.progress(0); return; }
  if (t.kind === 'wall') {
    strokeT -= dt;
    if (strokeT > 0) return;
    strokeT = 0.06;
    const n = stroke(t.h, t.s, t.u, t.v, TIP[tool], plasterTool ? 'plaster' : 'paint', kit.bucket?.colour, supply);
    if (n) { if (plasterTool) kit.plaster -= n; else kit.bucket.cells -= n; changed(); }
    return;
  }
  // a frame, door, the band or a sheet: hold the brush (roller) on it a moment
  const key = `${t.h.id}:${t.kind}:${t.i ?? ''}`;
  if (holdOn !== key) { holdOn = key; holdT = 0; }
  holdT += dt;
  game.hud.progress(Math.min(1, holdT / BRUSH_HOLD));
  if (holdT < BRUSH_HOLD) return;
  holdT = -0.4;
  const cost = COST[t.kind === 'leaf' ? 'leaf' : t.kind];
  if (kit.bucket.cells < cost) { game.hud.toast('Not enough paint left for that'); return; }
  kit.bucket.cells -= cost;
  if (t.kind === 'frame' || t.kind === 'leaf') paintFit(t.h, t.i, t.kind, kit.bucket.colour);
  else if (t.kind === 'band') paintBand(t.h, kit.bucket.colour);
  else paintSheet(t.h, t.i, kit.bucket.colour);
  audio.tap?.();
  changed();
}

// One stroke around (u, v) on side s: cells within the tool's reach. Returns how many changed.
function stroke(h, s, u, v, [ru, rv], kind, colour, max) {
  const G = gridOf(h, s), cu = u / CELL, cv = (v - G.sd.bottom) / CELL; // (u on the grid's skin)
  let n = 0;
  for (let j = Math.floor(cv - rv); j <= Math.ceil(cv + rv); j++) {
    for (let i = Math.floor(cu - ru); i <= Math.ceil(cu + ru); i++) {
      if (i < 0 || j < 0 || i >= G.nu || j >= G.nv || n >= max) continue;
      const k = j * G.nu + i;
      if (!G.need[k]) continue;
      const du = (i + 0.5 - cu) / ru, dv = (j + 0.5 - cv) / rv;
      if (du * du + dv * dv > 1) continue;
      if (setCell(h, s, k, kind, colour)) n++;
    }
  }
  return n;
}

// ───────── every frame ─────────

export function updatePaint(dt) {
  for (const t of things) t.sync();
  for (const h of houses) {
    if (!h.coat) continue;
    drawHouse(h, dt);
    flowerBoxes(h);
  }
  if (dirtyT > 0 && (dirtyT -= Math.max(dt, 1 / 60)) <= 0) listeners.forEach((fn) => fn());
}

// ───────── the painter ─────────
// Crew app: pick which of your colours (buckets lying around) go on the walls, frames, door and roof,
// then "Plaster a house" or "Paint a house" and point at it. He fetches the buckets and bags himself.

export const pick = { painter: null, job: null }; // pointing at a house for him

// the colours you have in buckets lying around (and in painters' hands)
export function coloursAround() {
  const s = new Set();
  for (const t of things) if (t.kind === 'bucket' && t.cells > 0) s.add(t.colour);
  for (const w of crew) if (w.trade === 'painter' && w.bucket?.cells > 0) s.add(w.bucket.colour);
  return PAINTS.map((c) => c[0]).filter((c) => s.has(c));
}
export const bagsAround = () => [...things].filter((t) => t.kind === 'plaster').length;

class Painter extends Worker {
  constructor(trade, saved) {
    super(trade, saved);
    this.colours = saved?.colours ?? { walls: null, trim: null, door: null, roof: null };
    this.bucket = saved?.bucket ?? null;   // { colour, cells }
    this.plaster = saved?.plaster ?? 0;    // cells of mixed plaster
    this.dress();
  }
  saveMore() {
    return { colours: this.colours, bucket: this.bucket, plaster: this.plaster };
  }

  // painter's whites, a cap, a roller on a short pole, a float, a brush and a bucket
  dress() {
    this.m.g.traverse((o) => {
      if (!o.isMesh) return;
      const hx = o.material.color.getHex();
      if (hx === 0xff7a1a) { o.material.color.set(0xf1eee6); o.material.emissive.set(0); }
      else if (hx === 0x2f3b55 || hx === 0xe6e6e0) o.material.color.set(0xe7e2d6);
      else if (hx === 0xf2c12e) { o.material.color.set(0xeeeae0); o.material.roughness = 0.9; }
    });
    const hand = this.m.arms[1], other = this.m.arms[0];
    const M = (o) => new THREE.MeshStandardMaterial(o);
    this.roller = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 6), M({ color: 0x9a7448, roughness: 0.8 }));
    pole.position.y = -0.95;
    this.rollerHead = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.24, 10), M({ color: 0xf1eee6, roughness: 1 }));
    this.rollerHead.rotation.z = Math.PI / 2;
    this.rollerHead.position.set(0, -1.32, 0.02);
    this.roller.add(pole, this.rollerHead);
    this.float = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.012, 0.3), M({ color: 0xb6b9bb, roughness: 0.35, metalness: 0.5 }));
    this.float.position.set(0, -0.66, 0.1);
    this.brush = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.02), M({ color: 0x8a6a48, roughness: 0.8 }));
    this.brush.position.set(0, -0.68, 0.04);
    hand.add(this.roller, this.float, this.brush);
    this.bucketMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.22, 10), M({ color: 0xe9e6de, roughness: 0.6 }));
    this.bucketMesh.position.set(0, -0.72, 0);
    this.bucketPaint = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 10), M({ color: 0xffffff, roughness: 0.4 }));
    this.bucketPaint.position.y = 0.1;
    this.bucketMesh.add(this.bucketPaint);
    other.add(this.bucketMesh);
    for (const o of [this.roller, this.float, this.brush, this.bucketMesh]) o.traverse((x) => { x.castShadow = true; });
  }

  buildHouses() { return null; } // (not his trade)
  raise() { return null; }
  // a job from the Crew app: { kind: 'plaster' | 'paint', house }
  give(kind, h) {
    this.release();
    this.order = { kind: 'paint', job: kind, house: houses.indexOf(h) };
    this.state = 'idle';
    this.thinkT = 0;
    this.setStatus('Starting');
  }
  release() {
    this.coatJob = null;
    super.release();
  }

  think() {
    this.thinkT = 1.5;
    if (this.leaving) return;
    if (this.unpaid) {
      if (spend(WAGE, `Wages · ${this.name}`)) this.unpaid = false;
      else { this.release(); this.setStatus('Not paid — waiting for his wages'); return; }
    }
    const o = this.order, h = o?.kind === 'paint' ? houses[o.house] : null;
    if (!h) { this.order = null; this.setStatus('Waiting for orders'); return; }
    const step = o.job === 'plaster' ? this.plasterStep(h) : this.paintStep(h);
    if (!step) {
      this.order = null;
      this.release();
      game.hud.toast(`${this.name}: ${h.the} is ${o.job === 'plaster' ? 'plastered — let it dry before paint' : 'painted'}.`);
      this.setStatus('Done · waiting for orders');
      this.goTo(this.nearYou(), 'arrive');
      return;
    }
    if (step.wait) { this.setStatus(step.wait); this.thinkT = 2; return; }
    // the right stuff in his hands first
    if (step.need === 'plaster' && this.plaster <= 0) return this.fetch('plaster');
    if (step.need !== 'plaster' && !(this.bucket?.colour === step.need && this.bucket.cells > 0)) return this.fetch(step.need);
    this.coatJob = { h, ...step };
    if (step.side !== undefined) {
      const sd = gridOf(h, step.side).sd;
      this.setStatus(step.need === 'plaster' ? `Plastering ${h.the}` : `Painting the walls ${step.need}`);
      this.coatJob.u = step.u;
      if (!this.goTo(this.standAt(h, sd, step.u), () => { this.state = 'coat'; })) this.skip('Can\'t get to that wall');
    } else if (step.fit !== undefined) {
      const f = h.fits[step.fit], sd = sideOf(h, f.side, 0), hole = sd.holes.find((x) => x.f === f);
      this.setStatus(step.part === 'leaf' ? 'Painting the door' : 'Painting a frame');
      this.t = step.part === 'leaf' ? DOOR_TIME : FIT_TIME;
      if (!this.goTo(this.standAt(h, sd, (hole.u0 + hole.u1) / 2, 0.75), () => { this.state = 'brush'; })) this.skip('Can\'t get to it');
    } else if (step.band) {
      const sd = sideOf(h, 0, 0);
      this.setStatus('Painting the boards under the roof');
      this.t = BAND_TIME;
      if (!this.goTo(this.standAt(h, sd, sd.len / 2, 1.2), () => { this.state = 'brush'; })) this.skip('Can\'t get to it');
    } else {
      const s = h.roof[step.sheet];
      this.setStatus(`Painting the roof · ${step.sheet + 1} of ${h.roof.length}`);
      this.t = SHEET_TIME;
      if (!this.goTo(s.stand.clone().setY(0), () => { this.state = 'rollroof'; this.face(s.pos); })) this.skip('Can\'t get to the roof');
    }
  }

  // the first wall cell column still to do, round the house
  wallStep(h, need, done) {
    if (!h.wallsDone()) return { wait: 'Waiting for the walls to go up' };
    for (const s of ROUND) {
      const G = gridOf(h, s);
      for (let i = 0; i < G.nu; i++) {
        for (let j = 0; j < G.nv; j++) {
          const k = j * G.nu + i;
          if (G.need[k] && !done(s, k)) return { side: s, u: i * CELL, need };
        }
      }
    }
    return null;
  }
  plasterStep(h) {
    return this.wallStep(h, 'plaster', (s, k) => !!h.coat?.plaster?.cells[s][k]);
  }
  paintStep(h) {
    const C = this.colours, c = coatOf(h);
    if (C.walls) {
      if (h.coat?.plaster && ROUND.some((s) => plasterWet(h, s))) return { wait: 'Waiting for the plaster to dry' };
      const p = c.paints.find((x) => x.colour === C.walls);
      const st = this.wallStep(h, C.walls, (s, k) => !!p?.cells[s][k]);
      if (st) return st;
    }
    for (let i = 0; i < h.fits.length; i++) {
      if (!h.fits[i].rec) continue;
      if (C.trim && c.fits[i]?.frame?.colour !== C.trim) return { fit: i, part: 'frame', need: C.trim };
      if (C.door && h.fits[i].kind === 'door' && c.fits[i]?.leaf?.colour !== C.door) return { fit: i, part: 'leaf', need: C.door };
    }
    if (C.trim && h.roofGroup && c.band?.colour !== C.trim) return { band: true, need: C.trim };
    if (C.roof) {
      if (!h.roof || !h.roof.every((s) => s.done)) return { wait: 'Waiting for the roof' };
      const i = h.roof.findIndex((_, k) => c.sheets[k]?.colour !== C.roof);
      if (i >= 0) return { sheet: i, need: C.roof };
    }
    return null;
  }

  // walk to a bucket of that colour (or a plaster bag) and take it; his other bucket stays there
  fetch(need) {
    let best = null, bd = Infinity;
    for (const t of things) {
      if (t.taken && t.taken !== this) continue;
      if (need === 'plaster' ? t.kind !== 'plaster' : t.kind !== 'bucket' || t.colour !== need || t.cells <= 0) continue;
      const d = (t.body.position.x - this.pos.x) ** 2 + (t.body.position.z - this.pos.z) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) {
      this.setStatus(need === 'plaster' ? 'Out of plaster — buy some in Woodline' : `Out of ${need} paint — buy some in Woodline`);
      this.thinkT = 3;
      return;
    }
    best.taken = this;
    this.setStatus(need === 'plaster' ? 'Fetching plaster' : `Fetching ${need} paint`);
    const p = best.body.position;
    const ok = this.goTo(new THREE.Vector3(p.x + 0.6, 0, p.z), () => {
      if (best.dead) return;
      this.face(p);
      this.state = 'take';
      this.t = 0.9;
      if (need === 'plaster') this.plaster += BAG_CELLS;
      else {
        if (this.bucket?.cells > 0) putDownAt({ kind: 'bucket', ...this.bucket }, this.pos.x - 0.5, this.pos.z);
        this.bucket = { colour: best.colour, cells: best.cells };
      }
      best.remove();
    });
    if (!ok) { best.taken = null; this.setStatus('Can\'t get to the paint'); }
  }

  skip(why) {
    const j = this.coatJob;
    // (that bit is left: mark it so he goes on — a wall column he can't reach, he leaves for you)
    if (j?.side !== undefined) {
      const G = gridOf(j.h, j.side), i = Math.floor(j.u / CELL);
      for (let k = i; k < G.nu; k++) for (let v = 0; v < G.nv; v++) if (G.need[v * G.nu + k]) setCell(j.h, j.side, v * G.nu + k, j.need === 'plaster' ? 'plaster' : 'paint', j.need);
    }
    game.hud.toast(`${this.name}: ${why.toLowerCase()} — I'll do what I can.`);
    this.state = 'idle';
    this.thinkT = 1;
  }

  standAt(h, sd, u, out = 0.85) {
    u = clamp(u, 0.35, sd.len - 0.35);
    return h.wall.world(sd.O[0] + sd.A[0] * u + sd.N[0] * out, sd.O[1] + sd.A[1] * u + sd.N[1] * out);
  }

  update(dt) {
    const j = this.coatJob;
    if (this.state === 'coat' && j?.side !== undefined) {
      const { h, side: s } = j, G = gridOf(h, s), sd = G.sd;
      const plaster = j.need === 'plaster';
      const u0 = j.u;
      j.u = Math.min(sd.len, j.u + (plaster ? PLASTER_RATE : PAINT_RATE) * dt);
      // every column he has passed: all its cells
      for (let i = Math.floor(u0 / CELL); i < Math.min(G.nu, Math.ceil(j.u / CELL)); i++) {
        if ((i + 0.5) * CELL > j.u) break;
        for (let v = 0; v < G.nv; v++) {
          const k = v * G.nu + i;
          if (!G.need[k]) continue;
          if (plaster ? this.plaster <= 0 : this.bucket.cells <= 0) break;
          if (setCell(h, s, k, plaster ? 'plaster' : 'paint', j.need)) { if (plaster) this.plaster--; else this.bucket.cells--; }
        }
      }
      changed();
      const goal = this.standAt(h, sd, j.u - 0.15);
      const k = Math.min(1, dt * 3);
      this.pos.x += (goal.x - this.pos.x) * k;
      this.pos.z += (goal.z - this.pos.z) * k;
      this.face(h.wall.world(sd.O[0] + sd.A[0] * j.u, sd.O[1] + sd.A[1] * j.u));
      const empty = plaster ? this.plaster <= 0 : this.bucket.cells <= 0;
      if (j.u >= sd.len || empty) { this.state = 'idle'; this.thinkT = 0.3; }
    } else if (this.state === 'coat') this.state = 'idle';
    else if ((this.state === 'brush' || this.state === 'rollroof') && j) {
      if (j.fit !== undefined) this.face(j.h.fits[j.fit].rec.pos);
      this.t -= dt;
      if (this.t <= 0) {
        const { h } = j, cost = j.sheet !== undefined ? COST.sheet : j.band ? COST.band : COST[j.part];
        if (this.bucket && this.bucket.cells >= cost) {
          this.bucket.cells -= cost;
          if (j.fit !== undefined) paintFit(h, j.fit, j.part, j.need);
          else if (j.band) paintBand(h, j.need);
          else paintSheet(h, j.sheet, j.need);
          if (this.near()) audio.tap?.();
        } else if (this.bucket) this.bucket.cells = 0; // (not enough left: he fetches a full one)
        changed();
        this.state = 'idle';
        this.thinkT = 0.2;
      }
    } else if (this.state === 'brush' || this.state === 'rollroof') this.state = 'idle';
    super.update(dt);
    this.pose();
  }

  pose() {
    const a = this.m, st = this.state, plaster = this.coatJob?.need === 'plaster';
    this.roller.visible = (st === 'coat' && !plaster) || st === 'rollroof';
    this.float.visible = st === 'coat' && plaster;
    this.brush.visible = st === 'brush';
    this.bucketMesh.visible = !!this.bucket || this.plaster > 0;
    this.bucketPaint.material.color.set(plaster || !this.bucket ? 0xd9d4c8 : hexOf(this.bucket.colour));
    const tt = performance.now() / 1000;
    if (st === 'coat') {
      // up and down the wall
      const y = Math.sin(tt * (plaster ? 3.2 : 4.4));
      a.arms[1].rotation.x = -1.7 - y * 0.75;
      a.arms[1].rotation.z = plaster ? Math.cos(tt * 3.2) * 0.25 : 0;
      a.arms[0].rotation.x = -0.25;
      a.body.rotation.x = y < -0.6 ? 0.2 : 0;
    } else if (st === 'brush') {
      const up = this.coatJob?.band ? -2.5 : -1.25;
      a.arms[1].rotation.x = up + Math.sin(tt * 9) * 0.18;
      a.arms[1].rotation.z = 0;
      a.arms[0].rotation.x = -0.3;
      a.head.rotation.x = this.coatJob?.band ? -0.45 : 0;
    } else if (st === 'rollroof') {
      a.arms[1].rotation.x = -2.8 + Math.sin(tt * 4) * 0.25;
      a.arms[0].rotation.x = -2.6 + Math.sin(tt * 4) * 0.25;
      a.arms[1].rotation.z = 0;
      a.head.rotation.x = -0.5;
    } else a.arms[1].rotation.z = 0;
  }
}

TRADES.painter = Painter;

// ───────── pointing at a house for the painter (Crew app → Plaster / Paint a house) ─────────

export function startHousePick(w, job) {
  pick.painter = w;
  pick.job = job;
  game.hud.toast(`Look at the house ${w.name} should ${job} · click picks it · right click cancels`);
}

// the house you look at (its walls, or the ground right by it)
function houseAimed() {
  const cam = game.camera, o = cam.getWorldPosition(new THREE.Vector3()), d = cam.getWorldDirection(new THREE.Vector3());
  const hit = rayClosest(new CANNON.Vec3(o.x, o.y, o.z), new CANNON.Vec3(o.x + d.x * 40, o.y + d.y * 40, o.z + d.z * 40), MASK.NO_PLAYER);
  if (!hit) return null;
  let best = null, bd = Infinity;
  for (const h of houses) {
    const r = Math.hypot(h.plan.nx, h.plan.nz) * U / 2 + 1.5, dd = Math.hypot(hit.point.x - h.centre.x, hit.point.z - h.centre.z);
    if (dd < r && dd < bd) { bd = dd; best = h; }
  }
  return best;
}

export function updateHousePick() {
  const inp = game.input, w = pick.painter, h = houseAimed();
  const stop = () => { pick.painter = null; game.hud.hint([]); game.hud.info(''); };
  if (!w || w.leaving || !crew.includes(w)) return stop();
  game.hud.hint(h ? [['Click', `${pick.job === 'plaster' ? 'Plaster' : 'Paint'} ${h.the}`], ['Right click', 'Cancel']] : [['', 'Look at a house'], ['Right click', 'Cancel']]);
  game.hud.info(h ? `${h.plan.name}${h.family ? ` · the ${h.family.name} family` : ''} · ${wallStateText(h)}` : '');
  if (inp.rmbDown) return stop();
  if (inp.lmbDown && h) {
    w.give(pick.job, h);
    audio.tap?.();
    game.hud.toast(`${w.name}: I'll ${pick.job} ${h.the}.`);
    stop();
  }
}

// one short line: how far the walls are
export function wallStateText(h) {
  if (!h.wallsDone()) return 'walls not up yet';
  const st = wallState(h), parts = [];
  if (st.plaster > 0.01) parts.push(st.plaster > 0.99 ? 'plastered' : `plastered ${Math.round(st.plaster * 100)}%`);
  if (st.paint > 0.01) parts.push(st.paint > 0.99 ? `painted ${st.main}` : `painted ${Math.round(st.paint * 100)}% (mostly ${st.main})`);
  if (st.paint > 0.5) {
    const f = Math.max(...(h.coat.paints.map((p) => fadeOf(p.day))));
    if (f > 0.35) parts.push(f > 0.75 ? 'faded' : 'fading a little');
  }
  return parts.join(' · ') || 'bare brick';
}

// ───────── a village that was already there (start modes): painted long ago ─────────

export function paintNow(h, plaster = Math.random() < 0.7) {
  const any = (L) => L[Math.floor(Math.random() * L.length)][0];
  const walls = any(PAINTS.filter(([id]) => !['black', 'anthracite', 'green', 'blue', 'red', 'brown', 'teal'].includes(id)));
  const trim = Math.random() < 0.6 ? 'white' : any(PAINTS);
  const door = any(PAINTS), roof = Math.random() < 0.5 ? null : any(PAINTS.filter(([id]) => ['red', 'brown', 'anthracite', 'green', 'blue', 'grey', 'terracotta'].includes(id)));
  for (let s = 0; s < 4; s++) {
    const G = gridOf(h, s);
    for (let k = 0; k < G.need.length; k++) if (G.need[k]) { if (plaster) setCell(h, s, k, 'plaster'); setCell(h, s, k, 'paint', walls); }
  }
  const c = coatOf(h), day = today() - Math.random() * FADE_DAYS * 0.8;
  if (c.plaster) c.plaster.wet = [0, 0, 0, 0];
  for (const p of c.paints) { p.wet = [0, 0, 0, 0]; p.day = day; }
  h.fits.forEach((f, i) => { if (!f.rec) return; paintFit(h, i, 'frame', trim, day); if (f.kind === 'door') paintFit(h, i, 'leaf', door, day); });
  paintBand(h, trim, day);
  if (roof && h.roof) h.roof.forEach((_, i) => paintSheet(h, i, roof, day));
}

// ───────── saving and loading ─────────

// cells as text: one char per cell ('0' none, '1' on brick, '2' on plaster), runs shortened as "<n>x"
const pack = (a) => { let s = '', i = 0; while (i < a.length) { let n = 1; while (i + n < a.length && a[i + n] === a[i]) n++; s += n > 1 ? `${n}${'abc'[a[i]]}` : 'abc'[a[i]]; i += n; } return s; };
function unpack(str, len) {
  const a = new Uint8Array(len);
  let i = 0;
  for (const m of str.matchAll(/(\d*)([abc])/g)) { const n = m[1] ? +m[1] : 1; a.fill('abc'.indexOf(m[2]), i, i + n); i += n; }
  return a;
}
const r3 = (v) => Math.round(v * 1e3) / 1e3;

export function savePaint() {
  return {
    kit: { brush: kit.brush, roller: kit.roller, float: kit.float, use: kit.use, bucket: kit.bucket, plaster: kit.plaster },
    things: [...things].map((t) => ({ kind: t.kind, colour: t.colour, cells: t.cells, tool: t.tool, pos: [r3(t.body.position.x), r3(t.body.position.y), r3(t.body.position.z)], quat: [t.body.quaternion.x, t.body.quaternion.y, t.body.quaternion.z, t.body.quaternion.w].map(r3) })),
    houses: houses.map((h) => {
      const c = h.coat;
      if (!c) return null;
      return {
        plaster: c.plaster && { cells: c.plaster.cells.map(pack), wet: c.plaster.wet.map(Math.round) },
        paints: c.paints.map((p) => ({ colour: p.colour, cells: p.cells.map(pack), wet: p.wet.map(Math.round), day: r3(p.day) })),
        fits: c.fits.map((f) => f ?? null), band: c.band, sheets: c.sheets.map((s) => s ?? null),
      };
    }),
  };
}

// after the houses are back with their doors, windows and roofs (finishHouses)
export function loadPaint(d) {
  if (!d || Array.isArray(d)) return; // (none, or the first version of this — Village-app orders — which is gone)
  Object.assign(kit, d.kit);
  for (const s of d.things) new PaintThing({ kind: s.kind, colour: s.colour, cells: s.cells, tool: s.tool }, { x: s.pos[0], y: s.pos[1], z: s.pos[2] }, new CANNON.Quaternion(...s.quat)).body.sleep();
  d.houses.forEach((s, i) => {
    const h = houses[i];
    if (!s || !h) return;
    const cells = (L) => L.map((str, k) => unpack(str, gridOf(h, k).nu * gridOf(h, k).nv));
    h.coat = {
      plaster: s.plaster && { cells: cells(s.plaster.cells), wet: s.plaster.wet },
      paints: s.paints.map((p) => ({ colour: p.colour, cells: cells(p.cells), wet: p.wet, day: p.day })),
      fits: [], band: null, sheets: [],
    };
    s.fits.forEach((f, k) => { if (f?.frame) paintFit(h, k, 'frame', f.frame.colour, f.frame.day); if (f?.leaf) paintFit(h, k, 'leaf', f.leaf.colour, f.leaf.day); });
    if (s.band) paintBand(h, s.band.colour, s.band.day);
    s.sheets.forEach((x, k) => { if (x) paintSheet(h, k, x.colour, x.day); });
  });
}

export const paintDebug = { kit, things, gridOf, wallState, setCell, stroke, paintNow, spawnPaintThing, pick, coloursAround };
