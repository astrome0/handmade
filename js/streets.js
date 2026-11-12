// Streets, built by hand metre by metre (or by a road worker): dig a strip, spread gravel and rake
// it, set the curbs, spread asphalt, rake it, roll it flat. A street starts at the dirt road or at
// the side of another street, and can end at one (a T, or a crossroads when another goes on across).
// Then lamps, road signs and zebra crossings.
import * as THREE from 'three';
import { world, CANNON, GROUP, MASK, MAT } from './physics.js';
import { game } from './game.js';
import { SIZE, HALF, terrainHeight, baseHeight, setDug, roadDist, road, parkDist, yardDist, YARD } from './terrain.js';
import { trees, stumps, rocks, reshapeGround, removeStump, removeRock } from './world.js';
import { pieces } from './items.js';
import { audio } from './audio.js';
import { particles } from './particles.js';
import { spend } from './money.js';
import { walls } from './masonry.js';
import { houses } from './workers.js';
import { clamp, smoothstep } from './util.js';

// ───────── the shape of a street ─────────

export const HW = 2.5;               // half the carriageway (two lanes)
const CURB_W = 0.15, CURB_H = 0.12;  // curb stones, and how far they stand up
const SIDE = 1.35;                   // the sidewalk behind the curb
export const OUT = HW + CURB_W + SIDE; // half the whole street: 4 m
const SW_H = 0.11;                   // sidewalk top above the carriageway
const BANK = 2.2;                    // the ground blends back into the land over this
const TURN = 0.16;                   // the most a street bends in one metre (≈ 9°)
const GRADE = 0.08;                  // the most it climbs in one metre
const ROAD_EDGE = 2.3;               // half the dirt road
const CORNER_R = 1.6;                // rounded curbs where streets meet
export const DIG_HITS = 3, RAKES = 2, ROLL = 1.7; // shovelfuls to dig a metre, rake strokes, metres of rolling (two passes)
const BED = 0.17, GRAVEL = 0.06;     // the dug bed below the finished top, and the gravel top

// what a metre has had done to it so far
export const ST = { DIG: 0, DUG: 1, GRAVEL: 2, RAKED: 3, CURBS: 4, ASPHALT: 5, SMOOTH: 6, DONE: 7 };
export const STAGE_NAME = ['Being dug', 'Dug out', 'Gravel (needs raking)', 'Gravel, raked', 'Curbs set', 'Asphalt (needs raking)', 'Asphalt, raked (needs rolling)', 'Finished'];

const NAMES = ['Lesní', 'Polní', 'Lipová', 'Krátká', 'Dlouhá', 'Zahradní', 'Školní', 'Luční', 'Na Kopci', 'Jabloňová', 'Potoční', 'Slunečná', 'Březová', 'Nádražní', 'Za Humny', 'Hasičská', 'Okružní', 'Kostelní'];

export const streets = [];
export const lamps = [];
export const signs = [];
let nextId = 1;
const listeners = new Set();
export const onStreetsChange = (fn) => listeners.add(fn);
let changedT = 0;
const changed = () => { changedT = 0.25; };

class Street {
  constructor(name, n0, start, id) {
    this.id = id ?? nextId++;
    nextId = Math.max(nextId, this.id + 1);
    this.name = name;
    this.n = [n0];     // nodes {x, z, h}: a metre runs from node k to node k + 1
    this.m = [];       // metres {st, dig, rake, roll}
    this.start = start; // { kind: 'road' } | { kind: 'street', of: Street }
    this.end = null;
    this.zebras = [];   // along-distances of the crossings' middles
    this.cuts = [[], []]; // per side: along-ranges with no curb or sidewalk (where another street joins)
    this.corners = [];
    this.S = [0];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.body = null;
    this.dirty = true;
    streets.push(this);
  }
  get length() { return this.S[this.S.length - 1] ?? 0; }
  done() { return this.m.length > 0 && this.m.every((m) => m.st === ST.DONE); }
  progress() { return this.m.length ? this.m.reduce((a, m) => a + m.st + (m.st === ST.DIG ? m.dig / DIG_HITS : 0), 0) / (this.m.length * ST.DONE) : 0; }
}

const newName = () => {
  const used = new Set(streets.map((s) => s.name));
  return NAMES.find((n) => !used.has(n)) ?? `Street ${streets.length + 1}`;
};

// ───────── geometry helpers ─────────

const norm = (x, z) => { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; };
const dirOf = (s, k) => norm(s.n[k + 1].x - s.n[k].x, s.n[k + 1].z - s.n[k].z);
function nodeDir(s, k) {
  let x = 0, z = 0;
  if (k > 0) { const d = dirOf(s, k - 1); x += d.x; z += d.z; }
  if (k < s.m.length) { const d = dirOf(s, k); x += d.x; z += d.z; }
  return norm(x, z);
}
// along d from (x, z), how far to the line { p, t }
function hitLine(x, z, d, L) {
  const den = d.x * L.t.z - d.z * L.t.x;
  if (Math.abs(den) < 1e-6) return 0;
  return ((L.p.x - x) * L.t.z - (L.p.z - z) * L.t.x) / den;
}
// A point across the street at node k, o metres to its right (+ = right of the way it was built).
// At a junction the first (last) node slides along the street onto the other one's curb line.
function across(s, k, o) {
  const d = nodeDir(s, k), n = s.n[k];
  let x = n.x - d.z * o, z = n.z + d.x * o;
  const line = k === 0 ? s.startLine : k === s.m.length && s.end ? s.endLine : null;
  if (line && o) { const t = hitLine(x, z, d, line); x += d.x * t; z += d.z * t; }
  return { x, z };
}
function point(s, k, f, o) {
  const a = across(s, k, o), b = across(s, k + 1, o);
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, h: s.n[k].h + (s.n[k + 1].h - s.n[k].h) * f };
}
// metre and fraction at an along-distance
function kf(s, along) {
  const S = s.S;
  let k = 0;
  while (k < s.m.length - 1 && S[k + 1] <= along) k++;
  return { k, f: clamp((along - S[k]) / ((S[k + 1] - S[k]) || 1), 0, 1) };
}
export function at(s, along, o = 0) { const { k, f } = kf(s, along); return point(s, k, f, o); }

// Where (x, z) is on street s: the nearest metre, how far along, how far across (+ right).
function locateOn(s, x, z) {
  let best = null;
  for (let k = 0; k < s.m.length; k++) {
    const a = s.n[k], b = s.n[k + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = ((x - a.x) * dx + (z - a.z) * dz) / L2, tc = clamp(t, 0, 1);
    const px = a.x + dx * tc, pz = a.z + dz * tc, d = Math.hypot(x - px, z - pz);
    // alongside the street: only its two ends are a hard edge (outside a bend, a point is past one
    // metre and before the next)
    const inside = t >= (k ? -0.6 : -0.02) && t <= (k < s.m.length - 1 ? 1.6 : 1.02);
    // (at a node two metres are as near: keep the one it's alongside)
    if (best && (d > best.d + 0.02 || (d > best.d - 0.02 && (best.inside || !inside)))) continue;
    const L = Math.sqrt(L2), lat = ((x - a.x) * -dz + (z - a.z) * dx) / L; // (+ on the right: the normal (−dz, dx), as in across())
    best = { s, k, f: tc, t, d, lat, along: s.S[k] + tc * L, h: a.h + (b.h - a.h) * tc, inside };
  }
  return best;
}
export function locate(x, z, except) {
  let best = null;
  for (const s of streets) {
    if (s === except || !s.m.length) continue;
    const L = locateOn(s, x, z);
    if (L && (!best || L.d < best.d)) best = L;
  }
  return best;
}
// the metre you stand on or aim at
export function metreAt(x, z) {
  const L = locate(x, z);
  return L && L.inside && Math.abs(L.lat) <= OUT + 0.15 ? L : null;
}
export function streetDist(x, z) { const L = locate(x, z); return L ? L.d : 99; }

// The nearest bit of sidewalk to (x, z) (footpaths end there), or null.
export function nearestSidewalk(x, z) {
  const L = locate(x, z);
  if (!L) return null;
  const p = at(L.s, L.along, Math.sign(L.lat || 1) * (OUT - 0.5));
  return { x: p.x, z: p.z, d: Math.hypot(p.x - x, p.z - z) };
}

// the dirt road: the nearest point and its direction
function roadAt(x, z) {
  let best = null, bd = Infinity, list = null, bi = 0;
  for (const R of [road.approach, road.loop, road.yard]) {
    for (let i = 0; i < R.length; i++) {
      const d = (R[i].x - x) ** 2 + (R[i].z - z) ** 2;
      if (d < bd) { bd = d; best = R[i]; list = R; bi = i; }
    }
  }
  const a = list[Math.max(0, bi - 1)], b = list[Math.min(list.length - 1, bi + 1)];
  return { p: best, t: norm(b.x - a.x, b.z - a.z), d: Math.sqrt(bd) };
}

// ───────── junctions: where a street meets the road or another street ─────────

// Works out every street's lengths, junction lines, curb gaps and round corners.
function layout() {
  for (const s of streets) {
    s.S = [0];
    for (let k = 0; k < s.m.length; k++) s.S.push(s.S[k] + Math.hypot(s.n[k + 1].x - s.n[k].x, s.n[k + 1].z - s.n[k].z));
    s.cuts = [[], []];
    s.corners = [];
    s.startLine = s.endLine = null;
  }
  for (const s of streets) {
    if (!s.m.length) continue;
    for (const which of ['start', 'end']) if (s[which]) junction(s, which);
  }
  for (const s of streets) s.dirty = true;
}

function junction(s, which) {
  const j = s[which], end = which === 'end';
  const P0 = end ? s.n[s.m.length] : s.n[0];
  const dS = dirOf(s, end ? s.m.length - 1 : 0);          // the street's own direction there
  const dB = end ? { x: -dS.x, z: -dS.z } : dS;           // away from the other one
  let tA, A = null, LA = null;
  if (j.kind === 'street' && j.of.m.length) {
    A = j.of;
    LA = locateOn(A, P0.x, P0.z);
    tA = dirOf(A, LA.k);
  } else tA = roadAt(P0.x, P0.z).t;
  const line = { p: { x: P0.x, z: P0.z }, t: tA };
  if (end) s.endLine = line; else s.startLine = line;
  if (!A) return; // (the dirt road curves: the street just ends square against its edge)
  const nAx = -tA.z, nAz = tA.x;
  const sideA = (dB.x * nAx + dB.z * nAz) > 0 ? 1 : -1; // which side of A the street leaves from
  const away = { x: nAx * sideA, z: nAz * sideA };
  const cutA = [];
  for (const sg of [1, -1]) {
    const nS = { x: -dS.z * sg, z: dS.x * sg };           // this side of the street
    const Q = { x: P0.x + nS.x * HW, z: P0.z + nS.z * HW };
    const v = hitLine(Q.x, Q.z, dB, line);
    const X = { x: Q.x + dB.x * v, z: Q.z + dB.z * v };
    const rayA = (tA.x * nS.x + tA.z * nS.z) > 0 ? tA : { x: -tA.x, z: -tA.z };
    const alpha = Math.acos(clamp(rayA.x * dB.x + rayA.z * dB.z, -1, 1));
    if (alpha < 0.5 || alpha > Math.PI - 0.3) continue;
    const dT = CORNER_R / Math.tan(alpha / 2);
    const T1 = { x: X.x + rayA.x * dT, z: X.z + rayA.z * dT }, T2 = { x: X.x + dB.x * dT, z: X.z + dB.z * dT };
    const bis = norm(rayA.x + dB.x, rayA.z + dB.z), cd = CORNER_R / Math.sin(alpha / 2);
    const C = { x: X.x + bis.x * cd, z: X.z + bis.z * cd };
    let a1 = Math.atan2(T1.z - C.z, T1.x - C.x), a2 = Math.atan2(T2.z - C.z, T2.x - C.x);
    while (a2 - a1 > Math.PI) a2 -= Math.PI * 2;
    while (a1 - a2 > Math.PI) a2 += Math.PI * 2;
    const arc = [];
    for (let i = 0; i <= 8; i++) { const a = a1 + (a2 - a1) * i / 8; arc.push({ x: C.x + Math.cos(a) * CORNER_R, z: C.z + Math.sin(a) * CORNER_R }); }
    // the sidewalk's outer corner
    const w = CURB_W + SIDE;
    const Ao = { p: { x: P0.x + away.x * w, z: P0.z + away.z * w }, t: tA };
    const Bo = { x: P0.x + nS.x * OUT, z: P0.z + nS.z * OUT };
    const vo = hitLine(Bo.x, Bo.z, dB, Ao);
    const Xo = { x: Bo.x + dB.x * vo, z: Bo.z + dB.z * vo };
    const T1o = { x: T1.x + away.x * w, z: T1.z + away.z * w }, T2o = { x: T2.x + nS.x * w, z: T2.z + nS.z * w };
    const along2 = (T2.x - P0.x) * dB.x + (T2.z - P0.z) * dB.z;
    // this street has no curb or sidewalk on that side until the corner ends
    const side = sg > 0 ? 0 : 1;
    s.cuts[side].push(end ? [s.length - along2, s.length + 1] : [-1, along2]);
    s.corners.push({ X, T1, T2, arc, Xo, T1o, T2o, C, h: P0.h, k: end ? s.m.length - 1 : 0, road: !A, sg });
    if (A) cutA.push(locateOn(A, T1.x, T1.z).along);
  }
  if (A && cutA.length) {
    // the other street: no curb or sidewalk across the mouth of this one
    const side = LA.lat > 0 ? 0 : 1;
    const lo = Math.min(...cutA, LA.along), hi = Math.max(...cutA, LA.along);
    A.cuts[side].push([lo - 0.02, hi + 0.02]);
  }
}

// along-pieces of [a0, a1] on one side that are not cut away
function uncut(s, side, a0, a1) {
  let parts = [[a0, a1]];
  for (const [c0, c1] of s.cuts[side]) {
    const next = [];
    for (const [p0, p1] of parts) {
      if (c1 <= p0 || c0 >= p1) { next.push([p0, p1]); continue; }
      if (c0 > p0) next.push([p0, c0]);
      if (c1 < p1) next.push([c1, p1]);
    }
    parts = next;
  }
  return parts.filter(([p0, p1]) => p1 - p0 > 0.02);
}

// ───────── how it looks ─────────

let TEX = null, MATS = null;
function texture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function mats() {
  if (MATS) return MATS;
  let seed = 7;
  const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  TEX = {
    asphalt: texture((x) => {
      x.fillStyle = '#8c8c8c'; x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 7000; i++) {
        const v = 60 + R() * 170;
        x.fillStyle = `rgba(${v},${v},${v * 0.98},${0.35 + R() * 0.5})`;
        x.fillRect(R() * 256, R() * 256, 1 + R() * 2, 1 + R() * 2);
      }
    }),
    gravel: texture((x) => {
      x.fillStyle = '#8f8a80'; x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 1500; i++) {
        const v = 95 + R() * 120, w = 1.5 + R() * 4;
        x.fillStyle = `rgb(${v + R() * 14},${v + R() * 8},${v - R() * 10})`;
        x.beginPath(); x.ellipse(R() * 256, R() * 256, w, w * (0.6 + R() * 0.4), R() * 3, 0, Math.PI * 2); x.fill();
      }
    }),
    pool: (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })(),
  };
  const off = (m, f) => { m.polygonOffset = true; m.polygonOffsetFactor = f; m.polygonOffsetUnits = f; return m; };
  MATS = {
    asphalt: off(new THREE.MeshStandardMaterial({ map: TEX.asphalt, vertexColors: true, roughness: 0.93 }), -1),
    gravel: off(new THREE.MeshStandardMaterial({ map: TEX.gravel, vertexColors: true, roughness: 1 }), -1),
    pave: new THREE.MeshStandardMaterial({ map: TEX.asphalt, vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    curb: new THREE.MeshStandardMaterial({ map: TEX.asphalt, color: 0xd8d4ca, roughness: 0.85, side: THREE.DoubleSide }),
    mark: off(new THREE.MeshStandardMaterial({ color: 0xf1efe6, roughness: 0.6 }), -4),
    ghost: new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
    ghostLine: new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.9, depthWrite: false }),
  };
  return MATS;
}

const C = {
  gravel: new THREE.Color(0.95, 0.93, 0.9), raked: new THREE.Color(0.88, 0.86, 0.83),
  asphalt: new THREE.Color(0.52, 0.5, 0.47), smooth: new THREE.Color(0.42, 0.41, 0.4), done: new THREE.Color(0.27, 0.27, 0.28),
  pave: new THREE.Color(0.62, 0.61, 0.59), paveDone: new THREE.Color(0.55, 0.55, 0.55),
};
const lump = (x, z) => Math.sin(x * 2.3 + z * 1.1) * Math.sin(z * 2.9 - x * 0.7) * 0.6 + Math.sin(x * 7.1 + z * 5.3) * 0.25 + Math.sin(x * 11.3 - z * 9.7) * 0.15;

class Geo {
  constructor() { this.pos = []; this.col = []; this.uv = []; this.idx = []; }
  v(x, y, z, c) { this.pos.push(x, y, z); this.col.push(c.r, c.g, c.b); this.uv.push(x * 0.5, z * 0.5); return this.pos.length / 3 - 1; }
  tri(a, b, c) {
    // always facing up (or out, for walls: the caller orders those)
    const P = this.pos;
    const ux = P[b * 3] - P[a * 3], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vz = P[c * 3 + 2] - P[a * 3 + 2];
    if (uz * vx - ux * vz < 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
  }
  mesh(mat) {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }
}

// a strip over metre k from fraction f0 to f1, across from o0 to o1, dy above the finished top
function strip(G, s, k, f0, f1, o0, o1, dy, col, amp = 0, nu = 4) {
  const len = (s.S[k + 1] - s.S[k]) * (f1 - f0), nv = Math.max(1, Math.round(len * (amp ? 3 : 1)));
  if (amp) nu = Math.max(nu, Math.round(Math.abs(o1 - o0) * 3));
  const base = G.pos.length / 3;
  for (let j = 0; j <= nv; j++) {
    const f = f0 + (f1 - f0) * j / nv;
    for (let i = 0; i <= nu; i++) {
      const p = point(s, k, f, o0 + (o1 - o0) * i / nu);
      const edge = i === 0 || i === nu ? 0.3 : 1; // (lumps die down at the edges; they only heap up)
      G.v(p.x, p.h + dy + (amp ? (0.5 + 0.5 * lump(p.x, p.z)) * amp * edge : 0), p.z, col);
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    G.tri(a, b, c); G.tri(b, d, c);
  }
}
// an upright face along metre k at offset o, from y0 to y1 above the top
function wall(G, s, k, f0, f1, o, y0, y1, col) {
  const a = point(s, k, f0, o), b = point(s, k, f1, o);
  const i = G.v(a.x, a.h + y0, a.z, col), j = G.v(b.x, b.h + y0, b.z, col), u = G.v(a.x, a.h + y1, a.z, col), w = G.v(b.x, b.h + y1, b.z, col);
  G.idx.push(i, j, u, j, w, u);
}
// a fan of flat triangles round a centre point (corners)
function fan(G, c, pts, y, col) {
  const ci = G.v(c.x, y, c.z, col);
  const ids = pts.map((p) => G.v(p.x, y, p.z, col));
  for (let i = 0; i < ids.length - 1; i++) G.tri(ci, ids[i], ids[i + 1]);
}

const layerCol = (st) => st === ST.GRAVEL ? C.gravel : C.raked;

function build(s) {
  const M = mats();
  for (const c of [...s.group.children]) { c.geometry.dispose(); s.group.remove(c); }
  const asp = new Geo(), grv = new Geo(), pave = new Geo(), curb = new Geo(), mark = new Geo();
  for (let k = 0; k < s.m.length; k++) {
    const st = s.m[k].st;
    if (st >= ST.GRAVEL && st < ST.ASPHALT) {
      // gravel: across the whole width, until the curbs go in; then the sidewalks are filled up to them
      const amp = st === ST.GRAVEL ? 0.045 : 0;
      if (st < ST.CURBS) strip(grv, s, k, 0, 1, -OUT, OUT, -GRAVEL + 0.015, layerCol(st), amp, 8);
      else strip(grv, s, k, 0, 1, -HW, HW, -GRAVEL + 0.015, C.raked, 0, 4);
    }
    if (st >= ST.ASPHALT) {
      const amp = st === ST.ASPHALT ? 0.03 : 0;
      strip(asp, s, k, 0, 1, -HW, HW, 0, st === ST.ASPHALT ? C.asphalt : st === ST.SMOOTH ? C.smooth : C.done, amp, 4);
    }
    if (st >= ST.CURBS) {
      for (const side of [0, 1]) {
        const sg = side ? -1 : 1;
        for (const [a0, a1] of uncut(s, side, s.S[k], s.S[k + 1])) {
          const L = s.S[k + 1] - s.S[k] || 1, f0 = (a0 - s.S[k]) / L, f1 = (a1 - s.S[k]) / L;
          // the curb: its top and the face towards the road
          strip(curb, s, k, f0, f1, sg * HW, sg * (HW + CURB_W), CURB_H, C.raked, 0, 1);
          wall(curb, s, k, f0, f1, sg * HW, -0.04, CURB_H, C.raked);
          // the sidewalk: gravel up to the curb, then asphalt; its outer edge down to the ground
          const top = st >= ST.ASPHALT ? SW_H : SW_H - 0.035;
          const col = st >= ST.ASPHALT ? (st === ST.DONE ? C.paveDone : C.pave) : C.raked;
          strip(st >= ST.ASPHALT ? pave : grv, s, k, f0, f1, sg * (HW + CURB_W), sg * OUT, top, col, 0, 2);
          wall(pave, s, k, f0, f1, sg * OUT, -0.1, top, st >= ST.ASPHALT ? col : C.raked);
        }
      }
    }
  }
  // round corners where it meets another street (or the road)
  for (const c of s.corners) {
    const st = s.m[c.k]?.st ?? 0;
    if (st < ST.GRAVEL) continue;
    const road = [c.T1, ...c.arc, c.T2];
    if (st >= ST.ASPHALT) fan(asp, c.X, c.arc, c.h + 0.001, st === ST.DONE ? C.done : C.smooth);
    else fan(grv, c.X, c.arc, c.h - GRAVEL + 0.015, C.raked);
    if (c.road || st < ST.CURBS) continue;
    const top = st >= ST.ASPHALT ? SW_H : SW_H - 0.035;
    fan(st >= ST.ASPHALT ? pave : grv, c.Xo, [c.T1o, ...road, c.T2o], c.h + top, st >= ST.ASPHALT ? C.paveDone : C.raked);
    // curbs round the arc
    for (let i = 0; i < c.arc.length - 1; i++) {
      const p = c.arc[i], q = c.arc[i + 1];
      const pi = norm(c.C.x - p.x, c.C.z - p.z), qi = norm(c.C.x - q.x, c.C.z - q.z);
      const a = curb.v(p.x, c.h + CURB_H, p.z, C.raked), b = curb.v(q.x, c.h + CURB_H, q.z, C.raked);
      const a2 = curb.v(p.x + pi.x * CURB_W, c.h + CURB_H, p.z + pi.z * CURB_W, C.raked), b2 = curb.v(q.x + qi.x * CURB_W, c.h + CURB_H, q.z + qi.z * CURB_W, C.raked);
      curb.tri(a, b, a2); curb.tri(b, b2, a2);
      const l0 = curb.v(p.x, c.h - 0.04, p.z, C.raked), l1 = curb.v(q.x, c.h - 0.04, q.z, C.raked);
      curb.idx.push(l0, l1, a, l1, b, a);
    }
  }
  // road markings on finished metres: a dashed middle line, give-way lines at junctions, zebras
  for (let k = 0; k < s.m.length; k++) {
    if (s.m[k].st !== ST.DONE) continue;
    const L = s.S[k + 1] - s.S[k] || 1;
    for (let d = Math.floor(s.S[k] / 4) * 4; d < s.S[k + 1]; d += 4) {
      let a0 = Math.max(d, s.S[k]), a1 = Math.min(d + 2, s.S[k + 1]);
      if (s.start) a0 = Math.max(a0, 2.2);
      if (s.end) a1 = Math.min(a1, s.length - 2.2);
      if (a1 - a0 > 0.05) strip(mark, s, k, (a0 - s.S[k]) / L, (a1 - s.S[k]) / L, -0.06, 0.06, 0.006, C.done, 0, 1);
    }
  }
  for (const [which, along] of [['start', 0.45], ['end', s.length - 0.45]]) {
    if (!s[which] || !s.m.length) continue;
    const { k, f } = kf(s, along);
    if (s.m[k].st !== ST.DONE) continue;
    // a dashed line across the half you come out of: give way
    const sg = which === 'start' ? -1 : 1;
    const L = s.S[k + 1] - s.S[k] || 1;
    for (let o = 0.15; o < HW - 0.2; o += 0.9) strip(mark, s, k, Math.max(0, f - 0.15 / L), Math.min(1, f + 0.15 / L), sg * o, sg * (o + 0.5), 0.006, C.done, 0, 1);
  }
  for (const z of s.zebras) {
    for (let o = -HW + 0.3; o < HW - 0.3; o += 1.0) {
      for (let a = z - 1.5; a < z + 1.5 - 1e-6; a += 0.5) {
        const { k, f } = kf(s, a + 0.25), L = s.S[k + 1] - s.S[k] || 1;
        strip(mark, s, k, clamp(f - 0.25 / L, 0, 1), clamp(f + 0.25 / L, 0, 1), o, o + 0.5, 0.006, C.done, 0, 1);
      }
    }
  }
  for (const [G, mat] of [[asp, M.asphalt], [grv, M.gravel], [pave, M.pave], [curb, M.curb], [mark, M.mark]]) {
    const m = G.mesh(mat);
    if (m) { if (mat === M.curb || mat === M.pave) m.castShadow = true; s.group.add(m); }
  }
  buildBody(s);
}

// Curbs and raised sidewalks are solid: one box per side per metre (the carriageway is the ground).
function buildBody(s) {
  if (s.body) { world.removeBody(s.body); s.body = null; }
  const b = new CANNON.Body({ mass: 0, material: MAT.ground, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: MASK.ALL });
  b.street = s;
  for (let k = 0; k < s.m.length; k++) {
    if (s.m[k].st < ST.CURBS) continue;
    const d = dirOf(s, k), L = s.S[k + 1] - s.S[k] || 1, rise = s.n[k + 1].h - s.n[k].h;
    const q = new CANNON.Quaternion().setFromEuler(0, Math.atan2(-d.z, d.x), Math.atan2(rise, L), 'YZX');
    for (const side of [0, 1]) {
      const sg = side ? -1 : 1;
      for (const [a0, a1] of uncut(s, side, s.S[k], s.S[k + 1])) {
        const p = point(s, k, ((a0 + a1) / 2 - s.S[k]) / L, sg * (HW + OUT) / 2);
        b.addShape(new CANNON.Box(new CANNON.Vec3((a1 - a0) / 2, 0.15, (OUT - HW) / 2)), new CANNON.Vec3(p.x, p.h + SW_H - 0.15, p.z), q);
      }
    }
  }
  if (!b.shapes.length) return;
  world.addBody(b);
  s.body = b;
}

// ───────── the ground under a street ─────────

// (the ground stays a little under each layer's mesh, so it never shows through)
const layer = (m) => m.st === ST.DIG ? -BED * m.dig / DIG_HITS : m.st === ST.DUG ? -BED : m.st < ST.ASPHALT ? -GRAVEL - 0.035 : -0.035;

// How far the ground at (x, z) is dug down or filled up, and how much fresh earth shows.
function groundAt(x, z) {
  let best = null, bank = null;
  for (const s of streets) {
    const B = s.box;
    if (!B || x < B.x0 || x > B.x1 || z < B.z0 || z > B.z1) continue;
    for (let k = 0; k < s.m.length; k++) {
      const m = s.m[k];
      if (m.st === ST.DIG && !m.dig) continue;
      const a = s.n[k], b = s.n[k + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
      const t = ((x - a.x) * dx + (z - a.z) * dz) / L2, tc = clamp(t, 0, 1);
      const d = Math.hypot(x - a.x - dx * tc, z - a.z - dz * tc);
      if (d > OUT + 0.3 + BANK) continue;
      // (behind the curbs the ground comes up to the sidewalk, so its edge meets the grass;
      // the 1 m grid points nearer the middle stay low, or the ground would poke through the asphalt)
      const raised = m.st >= ST.CURBS && d > HW + 0.95 ? SW_H - 0.035 : 0;
      const h = a.h + (b.h - a.h) * tc + (raised || layer(m));
      if (t >= 0 && t <= 1 && d <= OUT + 0.3) { if (!best || d < best.d) best = { d, h, m }; }
      else {
        const w = smoothstep(OUT + 0.3 + BANK, OUT + 0.3, d);
        if (!bank || w > bank.w) bank = { w, h, m };
      }
    }
  }
  if (!best && !bank) return null;
  if (roadDist(x, z) < 2.2) return null; // (the dirt road stays as it is)
  const base = baseHeight(x, z);
  if (best) return { dh: best.h - base, scar: 1 }; // (no grass through the street; the colour doesn't show)
  return { dh: bank.w * (bank.h - base), scar: bank.w * (bank.m.st === ST.DONE ? 0.45 : 0.85) };
}

function boxOf(s) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const n of s.n) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); z0 = Math.min(z0, n.z); z1 = Math.max(z1, n.z); }
  const r = OUT + BANK + 1;
  s.box = { x0: x0 - r, x1: x1 + r, z0: z0 - r, z1: z1 + r };
}

// The ground over (x0..x1, z0..z1) follows the streets again.
function regrade(x0, z0, x1, z1) {
  const gx0 = Math.floor(x0 + HALF), gx1 = Math.ceil(x1 + HALF), gz0 = Math.floor(z0 + HALF), gz1 = Math.ceil(z1 + HALF);
  // loose things standing there ride up with the ground (or the physics would throw them out of it)
  const riders = world.bodies.filter((b) => b.mass > 0 && b.type === CANNON.Body.DYNAMIC && b.position.x > x0 - 2 && b.position.x < x1 + 2 && b.position.z > z0 - 2 && b.position.z < z1 + 2)
    .map((b) => ({ b, was: terrainHeight(b.position.x, b.position.z) }));
  for (let gz = Math.max(0, gz0); gz <= Math.min(SIZE, gz1); gz++) {
    for (let gx = Math.max(0, gx0); gx <= Math.min(SIZE, gx1); gx++) {
      const g = groundAt(gx - HALF, gz - HALF);
      setDug(gx, gz, g ? g.dh : 0, g ? g.scar : 0);
    }
  }
  reshapeGround(gx0, gz0, gx1, gz1);
  for (const { b, was } of riders) {
    const up = terrainHeight(b.position.x, b.position.z) - was;
    if (up > 0.001) { b.position.y += up + 0.03; b.velocity.setZero(); b.angularVelocity.setZero(); }
    b.wakeUp();
  }
}

const pending = { box: null };
function regradeLater(s, k) {
  const a = s.n[k], b = s.n[Math.min(k + 1, s.n.length - 1)], r = OUT + BANK + 1.5;
  const B = { x0: Math.min(a.x, b.x) - r, x1: Math.max(a.x, b.x) + r, z0: Math.min(a.z, b.z) - r, z1: Math.max(a.z, b.z) + r };
  const P = pending.box;
  pending.box = P ? { x0: Math.min(P.x0, B.x0), x1: Math.max(P.x1, B.x1), z0: Math.min(P.z0, B.z0), z1: Math.max(P.z1, B.z1) } : B;
}

// ───────── planning the next metre ─────────

const signedAngle = (a, b) => Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
const rotate = (d, a) => ({ x: d.x * Math.cos(a) - d.z * Math.sin(a), z: d.x * Math.sin(a) + d.z * Math.cos(a) });
const segDist = (px, pz, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1, t = clamp(((px - a.x) * dx + (pz - a.z) * dz) / L2, 0, 1);
  return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
};
// the ground a new metre would follow: the land across its width
const groundAcross = (p, d) => (baseHeight(p.x, p.z) * 2 + baseHeight(p.x - d.z * 2.2, p.z + d.x * 2.2) + baseHeight(p.x + d.z * 2.2, p.z - d.x * 2.2)) / 4;

// What is in the way of a metre from a to b. Returns why not, or null.
function blocked(a, b, s, opts = {}) {
  const w = OUT + 0.3;
  if (Math.abs(b.x) > HALF - 12 || Math.abs(b.z) > HALF - 12) return 'The edge of the world';
  if (parkDist(b.x, b.z) < OUT + 2.5) return 'Your pickup\'s parking spot is here';
  if (yardDist(b.x, b.z) < YARD.r + OUT) return 'The timber yard is here';
  if (Math.hypot(b.x - 1, b.z + 1) < OUT + 1.2) return 'Your camp is here';
  if (!opts.ignoreTrees) {
    for (const t of trees) {
      if (!t.alive || Math.abs(t.x - b.x) > 8 || Math.abs(t.z - b.z) > 8) continue;
      if (segDist(t.x, t.z, a, b) < w + t.r) return 'A tree is in the way — chop it down first';
    }
    for (const st of stumps) {
      if (Math.abs(st.t.x - b.x) > 8 || Math.abs(st.t.z - b.z) > 8) continue;
      if (segDist(st.t.x, st.t.z, a, b) < w + st.t.r) return 'A stump is in the way — dig it out with the shovel';
    }
  }
  for (const r of rocks) if (r.big && !r.gone && !opts.ignoreTrees && Math.abs(r.x - b.x) < 8 && Math.abs(r.z - b.z) < 8 && segDist(r.x, r.z, a, b) < w + r.r) return 'A big rock is in the way — dig it out with the shovel';
  for (const h of houses) {
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [0.5, 0], [0, 0.5], [1, 0.5], [0.5, 1]]) {
      const p = h.local(u * h.plan.nx * 0.2, 0, v * h.plan.nz * 0.2);
      if (segDist(p.x, p.z, a, b) < w + 1) return 'A house is in the way';
    }
  }
  for (const wl of walls) for (const br of wl.bricks) {
    if (Math.abs(br.pos.x - b.x) < 7 && Math.abs(br.pos.z - b.z) < 7 && segDist(br.pos.x, br.pos.z, a, b) < w) return 'Something is built here';
  }
  for (const o of streets) {
    if (o === opts.join || (o === s?.start?.of && opts.k < 6) || o === opts.parent) continue;
    const own = o === s;
    for (let k = 0; k < o.m.length - (own ? 8 : 0); k++) {
      if (segDist(b.x, b.z, o.n[k], o.n[k + 1]) < 2 * OUT - 0.4) return 'Too close to another street';
    }
  }
  const nearRoadStart = (s?.start?.kind === 'road' && opts.k < 5) || opts.parent === 'road';
  if (!nearRoadStart && opts.join !== 'road' && roadDist(b.x, b.z) < OUT + ROAD_EDGE - 0.2) return 'Too close to the road';
  if (Math.abs(baseHeight(b.x, b.z) - b.h) > 1.1) return 'Too steep here — the street can\'t climb that';
  for (const l of lamps) if (segDist(l.pos.x, l.pos.z, a, b) < w) return 'A street lamp is in the way';
  return null;
}

// If a street going from E along d would run into another street or the road soon: where it meets it.
function meets(E, d, s) {
  let best = null;
  for (const A of streets) {
    if (A === s || !A.m.length) continue;
    const L = locateOn(A, E.x, E.z);
    if (!L || !L.inside || L.d > HW + OUT + 2.5) continue;
    const toward = { x: (L.lat > 0 ? 1 : -1), z: 0 };
    const tA = dirOf(A, L.k), n = { x: -tA.z * toward.x, z: tA.x * toward.x }; // from A towards E
    const cos = -(d.x * n.x + d.z * n.z);
    if (cos < 0.15) continue;
    const t = (L.d - HW) / cos;
    if (t < -0.2 || t > 2.6) continue;
    if (!best || t < best.t) best = { t, cos, of: A, h: L.h, kind: 'street' };
  }
  const R = roadAt(E.x, E.z);
  if (R.d < ROAD_EDGE + OUT + 2.5) {
    const n = norm(E.x - R.p.x, E.z - R.p.z), cos = -(d.x * n.x + d.z * n.z);
    const t = (R.d - ROAD_EDGE) / Math.max(cos, 1e-3);
    if (cos >= 0.15 && t > -0.2 && t < 2.6 && (!best || t < best.t)) best = { t, cos, of: null, h: terrainHeight(E.x + d.x * t, E.z + d.z * t), kind: 'road' };
  }
  return best;
}

// Where the next metre would go, for someone at `from` facing `fwd`, aiming at `aim` (the ground).
// { s, a, b, start?, join?, ok, why }  — s: the street it continues (null = a new one)
export function plan(aim, fwd, opts = {}) {
  // 1. carry on from the open end of a street
  let best = null;
  for (const s of streets) {
    if (s.end || !s.m.length) continue;
    const E = s.n[s.m.length], dE = dirOf(s, s.m.length - 1);
    const dd = Math.hypot(aim.x - E.x, aim.z - E.z);
    if (dd > (opts.reach ?? 3.4) || (aim.x - E.x) * dE.x + (aim.z - E.z) * dE.z < -1.2) continue;
    if (!best || dd < best.dd) best = { s, E, dE, dd };
  }
  if (best) {
    const { s, E, dE } = best;
    const turn = clamp(signedAngle(dE, fwd), -TURN, TURN);
    const d = rotate(dE, turn);
    const r = { s, a: E, ok: false, why: null };
    if (s.m[s.m.length - 1].st === ST.DIG) { r.b = { x: E.x + d.x, z: E.z + d.z, h: E.h }; r.why = 'Finish digging the last metre first'; return r; }
    const J = meets(E, d, s);
    if (J && J.t <= 1.6) {
      if (J.cos < 0.55) { r.b = { x: E.x + d.x, z: E.z + d.z, h: E.h }; r.why = 'Meet the other street more squarely'; return r; }
      const t = Math.max(0.15, J.t);
      r.b = { x: E.x + d.x * t, z: E.z + d.z * t, h: J.h };
      r.join = J;
      if (Math.abs(J.h - E.h) > 0.35) { r.why = 'The two streets are at different heights here'; return r; }
    } else {
      const b = { x: E.x + d.x, z: E.z + d.z };
      b.h = clamp(groundAcross(b, d), E.h - GRADE, E.h + GRADE);
      r.b = b;
    }
    r.why = blocked(E, r.b, s, { k: s.m.length, join: r.join ? (r.join.of ?? 'road') : null, ignoreTrees: opts.ignoreTrees });
    r.ok = !r.why;
    return r;
  }
  // 2. a new street off the side of a street
  const L = locate(aim.x, aim.z);
  if (L && L.inside && Math.abs(L.lat) > HW - 0.6 && Math.abs(L.lat) < OUT + 3 && L.s.m.length) {
    const A = L.s, tA = dirOf(A, L.k), sg = L.lat > 0 ? 1 : -1;
    const away = { x: -tA.z * sg, z: tA.x * sg };
    return startFrom({ kind: 'street', of: A }, aim, fwd, away, (p) => { const Lp = locateOn(A, p.x, p.z); return Lp ? Lp.h : terrainHeight(p.x, p.z); }, HW, Math.abs(L.lat), opts);
  }
  // 3. a new street off the dirt road
  const R = roadAt(aim.x, aim.z);
  if (R.d > ROAD_EDGE - 0.8 && R.d < ROAD_EDGE + 4.5) {
    const away = norm(aim.x - R.p.x, aim.z - R.p.z);
    return startFrom({ kind: 'road' }, aim, fwd, away, (p) => terrainHeight(p.x, p.z), ROAD_EDGE, R.d, opts);
  }
  return null;
}

function startFrom(start, aim, fwd, away, heightAt, edge, latAim, opts) {
  const ang = signedAngle(away, fwd);
  let d = rotate(away, clamp(ang, -0.6, 0.6));
  const cos = d.x * away.x + d.z * away.z;
  let a = { x: aim.x - d.x * (latAim - edge) / cos, z: aim.z - d.z * (latAim - edge) / cos };
  const r = { s: null, start, ok: false, why: null };
  // straight across from a street that ends on the other side: line up with it (a crossroads)
  const P = start.kind === 'street' ? start.of : null;
  if (P) {
    for (const o of streets) {
      for (const which of ['start', 'end']) {
        if (o[which]?.of !== P || !o.m.length) continue;
        const J = which === 'end' ? o.n[o.m.length] : o.n[0];
        const dJ = which === 'end' ? dirOf(o, o.m.length - 1) : dirOf(o, 0);
        const into = which === 'end' ? dJ : { x: -dJ.x, z: -dJ.z }; // heading into P
        if (into.x * away.x + into.z * away.z < 0.5) continue;         // it comes from the other side
        const LJ = locateOn(P, J.x, J.z), La = locateOn(P, a.x, a.z);
        if (Math.abs(LJ.along - La.along) > 3.5) continue;
        // through P: where the line of that street comes out on this side
        const t = hitLine(J.x, J.z, into, { p: a, t: { x: -away.z, z: away.x } });
        a = { x: J.x + into.x * t, z: J.z + into.z * t };
        d = into;
      }
    }
    // not too close to another junction on the same street
    const La = locateOn(P, a.x, a.z);
    if (La.along < 4 || La.along > P.length - 4) { r.a = { ...a, h: heightAt(a) }; r.b = { x: a.x + d.x, z: a.z + d.z, h: r.a.h }; r.why = 'Too close to the end of that street'; return r; }
    for (const o of streets) for (const which of ['start', 'end']) {
      if (o[which]?.of !== P || !o.m.length) continue;
      const J = which === 'end' ? o.n[o.m.length] : o.n[0], LJ = locateOn(P, J.x, J.z);
      const same = (LJ.lat > 0) === (La.lat > 0);
      if (Math.abs(LJ.along - La.along) < (same ? 2 * OUT + 2 * CORNER_R + 1 : 0.2) && Math.abs(LJ.along - La.along) > 0.05) {
        r.a = { ...a, h: heightAt(a) }; r.b = { x: a.x + d.x, z: a.z + d.z, h: r.a.h }; r.why = 'Too close to another junction'; return r;
      }
    }
  } else {
    for (const o of streets) {
      if (o.start?.kind === 'road' && Math.hypot(o.n[0].x - a.x, o.n[0].z - a.z) < 2 * OUT + 4) {
        r.a = { ...a, h: heightAt(a) }; r.b = { x: a.x + d.x, z: a.z + d.z, h: r.a.h }; r.why = 'Too close to another street\'s junction'; return r;
      }
    }
  }
  a.h = heightAt(a);
  const b = { x: a.x + d.x, z: a.z + d.z };
  b.h = clamp(groundAcross(b, d), a.h - GRADE, a.h + GRADE);
  r.a = a; r.b = b;
  r.why = blocked(a, b, null, { k: 0, parent: P ?? 'road', ignoreTrees: opts.ignoreTrees });
  r.ok = !r.why;
  return r;
}

// Make the planned metre real (its first shovelful). Returns the street and metre index.
export function begin(p, dig = 1) {
  let s = p.s;
  if (!s) {
    s = new Street(newName(), { x: p.a.x, z: p.a.z, h: p.a.h }, p.start);
    s.founded = game.day?.day ?? 1;
  }
  s.n.push({ x: p.b.x, z: p.b.z, h: p.b.h });
  s.m.push({ st: ST.DIG, dig, rake: 0, roll: 0 });
  clearRocks(s.n[s.n.length - 2], p.b);
  if (p.join) s.end = p.join.kind === 'road' ? { kind: 'road' } : { kind: 'street', of: p.join.of };
  if (dig >= DIG_HITS) s.m[s.m.length - 1].st = ST.DUG;
  boxOf(s);
  layout();
  regradeLater(s, s.m.length - 1);
  changed();
  return { s, k: s.m.length - 1 };
}

// ───────── working on a metre ─────────

// One step of work on metre k. Returns what happened (for sounds and particles), or null.
export function work(s, k, op) {
  const m = s.m[k];
  if (!m) return null;
  let what = null;
  if (op === 'dig' && m.st === ST.DIG) {
    m.dig++;
    if (m.dig >= DIG_HITS) m.st = ST.DUG;
    what = 'dig';
  } else if (op === 'gravel' && m.st === ST.DUG) { m.st = ST.GRAVEL; m.rake = 0; what = 'gravel'; }
  else if (op === 'rake' && (m.st === ST.GRAVEL || m.st === ST.ASPHALT)) {
    m.rake++;
    if (m.rake >= RAKES) { m.st++; m.rake = 0; }
    what = 'rake';
  } else if (op === 'curbs' && m.st === ST.RAKED) { m.st = ST.CURBS; what = 'curbs'; }
  else if (op === 'asphalt' && m.st === ST.CURBS) { m.st = ST.ASPHALT; m.rake = 0; what = 'asphalt'; }
  else if (op === 'roll' && m.st === ST.SMOOTH) { m.st = ST.DONE; what = 'roll'; }
  if (!what) return null;
  s.dirty = true;
  for (const j of [s.start, s.end]) if (j?.of) j.of.dirty = true; // (the corners show on the other street's side too)
  regradeLater(s, k);
  changed();
  return what;
}

// the open end of a street, and which way it was going
export function endOf(s) { const k = s.m.length; return { E: s.n[k], d: dirOf(s, k - 1) }; }

// what a metre needs next: 'dig' | 'gravel' | 'rake' | 'curbs' | 'asphalt' | 'roll' | null
export const needs = (m) => [ 'dig', 'gravel', 'rake', 'curbs', 'asphalt', 'rake', 'roll', null][m.st];
export const curbsFor = (s, k) => [0, 1].reduce((n, side) => n + (uncut(s, side, s.S[k], s.S[k + 1]).length ? 1 : 0), 0);

// ───────── things you buy for streets ─────────

export const things = new Set();
export const TOOL_NAME = { shovel: 'Shovel', rake: 'Rake', roller: 'Hand roller' };
export const BAG_M = { gravel: 4, asphalt: 3 }; // metres of street in a big bag
export const CURB_PALLET = 16;

let labels = {};
function label(lines, bg, fg) {
  const key = lines.join('|') + bg;
  if (labels[key]) return labels[key];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 256, 128);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '700 40px Outfit, system-ui, sans-serif';
  x.fillText(lines[0], 128, 48);
  x.font = '500 22px Outfit, system-ui, sans-serif';
  x.fillText(lines[1] ?? '', 128, 94);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (labels[key] = t);
}

// How each looks (also on the truck), and its box for physics (half sizes)
export function thingMesh(it) {
  const g = new THREE.Group();
  const add = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  const box = (w, h, d, mat, x, y, z) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), x, y, z);
  const wood = new THREE.MeshStandardMaterial({ color: 0xa88760, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x7d858b, metalness: 0.35, roughness: 0.45 });
  const handle = new THREE.MeshStandardMaterial({ color: 0xc58e55, roughness: 0.7 });
  if (it.kind === 'gravel' || it.kind === 'asphalt') {
    // a woven big bag with a loop at each corner, the load heaped on top
    const gravel = it.kind === 'gravel';
    const bag = new THREE.MeshStandardMaterial({ color: gravel ? 0xe8e4d8 : 0x2e3033, roughness: 0.95 });
    const side = new THREE.MeshStandardMaterial({ map: label(gravel ? ['GRAVEL', '1 t · 4 m of street'] : ['ASPHALT', 'mix · 3 m of street'], gravel ? '#e8e4d8' : '#2e3033', gravel ? '#3a3a38' : '#e8e4d8'), roughness: 0.95 });
    const full = (it.m ?? BAG_M[it.kind]) / BAG_M[it.kind], hgt = 0.35 + 0.45 * full;
    add(new THREE.Mesh(new THREE.BoxGeometry(0.9, hgt, 0.9), [bag, bag, bag, bag, side, side]), 0, hgt / 2, 0);
    const heap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ map: (mats(), gravel ? TEX.gravel : TEX.asphalt), color: gravel ? 0xa29d92 : 0x3a3a3a, roughness: 1 }));
    heap.scale.set(1, 0.35, 1);
    add(heap, 0, hgt - 0.02, 0);
    for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 4, 10, Math.PI), bag);
      loop.rotation.y = Math.atan2(x, z);
      add(loop, x, hgt, z);
    }
    g.userData.half = [0.45, hgt / 2, 0.45];
  } else if (it.kind === 'curbs') {
    box(1.2, 0.12, 0.8, wood, 0, 0.06, 0);
    const stone = new THREE.MeshStandardMaterial({ map: (mats(), TEX.asphalt), color: 0xd8d4ca, roughness: 0.85 });
    const n = it.n ?? CURB_PALLET;
    for (let i = 0; i < n; i++) {
      const layer = Math.floor(i / 4), j = i % 4;
      box(1.0, 0.25, 0.15, stone, 0, 0.12 + 0.125 + layer * 0.255, -0.27 + j * 0.18);
    }
    const hgt = 0.12 + Math.ceil(n / 4) * 0.255;
    g.userData.half = [0.6, hgt / 2, 0.4];
  } else if (it.kind === 'rtool') {
    // the tool itself, lying on the ground
    if (it.tool === 'shovel') {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.1, 8).rotateZ(Math.PI / 2), handle), -0.1, 0.03, 0);
      box(0.28, 0.02, 0.24, steel, 0.55, 0.03, 0);
    } else if (it.tool === 'rake') {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.4, 8).rotateZ(Math.PI / 2), handle), -0.05, 0.03, 0);
      box(0.04, 0.03, 0.42, steel, 0.68, 0.03, 0);
      for (let i = 0; i < 10; i++) box(0.07, 0.012, 0.01, steel, 0.72, 0.02, -0.19 + i * 0.042);
    } else {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.55, 16).rotateX(Math.PI / 2), steel), 0.45, 0.2, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.0, 8).rotateZ(Math.PI / 2 - 0.25), handle), -0.15, 0.32, 0);
    }
    g.userData.half = it.tool === 'roller' ? [0.7, 0.2, 0.28] : [0.75, 0.035, 0.2];
  } else if (it.kind === 'lamp') {
    box(2.6, 0.32, 0.36, wood, 0, 0.16, 0);
    add(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28), new THREE.MeshStandardMaterial({ map: label(['STREET LAMP', 'pole · arm · lamp'], '#e8dcc0', '#4a3b28') })), 0, 0.16, 0.181);
    g.userData.half = [1.3, 0.16, 0.18];
  } else if (it.kind === 'sign') {
    box(0.85, 0.12, 0.85, wood, 0, 0.06, 0);
    add(new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.35).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: label(['ROAD SIGN', 'pole + plate'], '#e8dcc0', '#4a3b28') })), 0, 0.121, 0);
    g.userData.half = [0.43, 0.06, 0.43];
  } else if (it.kind === 'zebra') {
    const tin = new THREE.MeshStandardMaterial({ map: label(['ROAD PAINT', 'white · one crossing'], '#f2f0e8', '#2a2a2a'), roughness: 0.6 });
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.32, 16), [tin, new THREE.MeshStandardMaterial({ color: 0xf2f0e8 }), new THREE.MeshStandardMaterial({ color: 0xf2f0e8 })]), 0, 0.16, 0);
    box(0.6, 0.04, 0.12, new THREE.MeshStandardMaterial({ color: 0x5d6f86 }), 0.42, 0.02, 0); // the rolled-up stencil
    g.userData.half = [0.32, 0.16, 0.17];
  }
  return g;
}

class StreetThing {
  constructor(it, pos, quat) {
    Object.assign(this, it);
    if (this.kind === 'gravel' || this.kind === 'asphalt') this.m ??= BAG_M[this.kind];
    if (this.kind === 'curbs') this.n ??= CURB_PALLET;
    this.make(pos, quat);
    things.add(this);
  }
  make(pos, quat) {
    this.mesh = thingMesh(this);
    game.scene.add(this.mesh);
    const half = this.mesh.userData.half;
    const mass = this.kind === 'gravel' ? 300 * (this.m / BAG_M.gravel) + 20 : this.kind === 'asphalt' ? 260 * (this.m / BAG_M.asphalt) + 20 : this.kind === 'curbs' ? 15 + this.n * 20 : this.kind === 'lamp' ? 70 : this.kind === 'rtool' && this.tool === 'roller' ? 60 : 8;
    this.body = new CANNON.Body({ mass, material: MAT.wood, collisionFilterGroup: GROUP.PIECE, collisionFilterMask: MASK.ALL, allowSleep: true, sleepSpeedLimit: 0.15 });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(...half)), new CANNON.Vec3(0, half[1], 0));
    this.body.position.set(pos.x, pos.y, pos.z);
    if (quat) this.body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    this.body.streetThing = this;
    world.addBody(this.body);
    this.sync();
  }
  // (less in a bag or on a pallet: it looks it)
  remake() {
    const p = this.body.position, q = this.body.quaternion;
    world.removeBody(this.body);
    game.scene.remove(this.mesh);
    this.make({ x: p.x, y: p.y, z: p.z }, q);
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
export const spawnStreetThing = (it, pos, quat) => new StreetThing(it, pos, quat);
const putDownAt = (it, x, z, yaw = 0) => new StreetThing(it, { x, y: terrainHeight(x, z) + 0.15, z }, new CANNON.Quaternion().setFromEuler(0, yaw, 0));
export const STREET_KINDS = ['gravel', 'asphalt', 'curbs', 'rtool', 'lamp', 'sign', 'zebra'];

export function thingInfo(t) {
  if (t.kind === 'gravel') return `Gravel · big bag · enough for ${t.m} m of street`;
  if (t.kind === 'asphalt') return `Asphalt mix · big bag · enough for ${t.m} m of street`;
  if (t.kind === 'curbs') return `Curb stones · ${t.n} left (2 for a metre)`;
  if (t.kind === 'rtool') return TOOL_NAME[t.tool];
  if (t.kind === 'lamp') return 'Street lamp, in its crate';
  if (t.kind === 'sign') return 'Road sign, in its crate';
  return 'White road paint and a stencil: one zebra crossing';
}
export function thingHint(t) {
  if (t.kind === 'gravel' || t.kind === 'asphalt') return `Load your barrow with ${t.kind}`;
  if (t.kind === 'curbs') return 'Take curb stones';
  if (t.kind === 'rtool') return `Take the ${TOOL_NAME[t.tool].toLowerCase()}`;
  return `Pick up the ${t.kind === 'zebra' ? 'road paint' : t.kind === 'lamp' ? 'street lamp' : 'road sign'}`;
}

// ───────── your road kit ─────────
// tools you own, what's in your barrow, curb stones in your arms, a lamp / sign / paint you carry

export const kit = { shovel: false, rake: false, roller: false, use: null, gravel: 0, asphalt: 0, curbs: 0, hold: null, signKind: 0 };
const BARROW = 4, CURB_CARRY = 6;
const kitList = () => ['shovel', 'rake', 'roller'].filter((k) => kit[k]);
export const SIGN_KINDS = [
  ['name', 'Street name'], ['stop', 'Stop'], ['yield', 'Give way'], ['limit30', 'Speed limit 30'], ['crossing', 'Pedestrian crossing'], ['main', 'Main road'], ['deadend', 'Dead end'],
];

// E on a bag, a pallet, a tool or a crate
export function takeStreetThing(t) {
  if (t.kind === 'rtool') {
    kit[t.tool] = true;
    kit.use = t.tool;
    t.remove();
    audio.pickup?.();
    game.hud.toast(`Got the ${TOOL_NAME[t.tool].toLowerCase()} · press 8, R switches tools`);
  } else if (t.kind === 'gravel' || t.kind === 'asphalt') {
    const other = t.kind === 'gravel' ? 'asphalt' : 'gravel';
    if (kit[other] > 0) {
      // swap: what's left of the other material goes down as a bag, here
      const p = t.body.position;
      putDownAt({ kind: other, m: kit[other] }, p.x + 1.1, p.z + 0.4);
      game.hud.toast(`Put your ${other} (${kit[other]} m) down in a bag`);
      kit[other] = 0;
    }
    const n = Math.min(t.m, BARROW - kit[t.kind]);
    if (n <= 0) { game.hud.toast('Your barrow is full'); return; }
    kit[t.kind] += n;
    t.m -= n;
    audio.bag?.();
    if (t.m <= 0) t.remove(); else t.remake();
    game.hud.toast(`${t.kind === 'gravel' ? 'Gravel' : 'Asphalt'} for ${kit[t.kind]} m in your barrow · shovel (8)`);
  } else if (t.kind === 'curbs') {
    const n = Math.min(t.n, CURB_CARRY - kit.curbs);
    if (n <= 0) { game.hud.toast(`You can carry ${CURB_CARRY} curb stones at a time`); return; }
    kit.curbs += n;
    t.n -= n;
    audio.pickup?.();
    if (t.n <= 0) t.remove(); else t.remake();
    game.hud.toast(`${kit.curbs} curb stones · set them on raked gravel (8)`);
  } else {
    if (kit.hold) { game.hud.toast('Your hands are full'); return; }
    kit.hold = t.kind;
    t.remove();
    audio.pickup?.();
    game.hud.toast(t.kind === 'zebra' ? 'Road paint · take the shovel slot (8) and aim at a finished street' : `Carrying a ${t.kind === 'lamp' ? 'street lamp' : 'road sign'} · slot 8 sets it on a sidewalk${t.kind === 'sign' ? ', R picks which sign' : ''}`);
  }
  changed();
}

// E while carrying a lamp, sign or paint: put it down in front of you
export function putDownHeld() {
  if (!kit.hold) return false;
  const yaw = game.player.yaw, p = game.player.body.position;
  putDownAt({ kind: kit.hold }, p.x - Math.sin(yaw) * 1.6, p.z - Math.cos(yaw) * 1.6, yaw);
  kit.hold = null;
  audio.pickup?.();
  return true;
}

// R in slot 8: the next tool (or, holding a sign, the next sign)
export function roadR() {
  if (kit.hold === 'sign') kit.signKind = (kit.signKind + 1) % SIGN_KINDS.length;
  else {
    const L = kitList();
    if (!L.length) return;
    kit.use = L[(L.indexOf(kit.use) + 1) % L.length];
  }
  audio.pickup?.();
}

// ───────── working by hand (slot 8) ─────────

let cool = 0, ghost = null, lastRollPos = null;

function ghostMesh() {
  if (ghost) return ghost;
  const g = new THREE.Mesh(new THREE.BufferGeometry(), mats().ghost);
  g.renderOrder = 3;
  g.frustumCulled = false;
  const pos = new Float32Array(3 * 9 * 3);
  g.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const idx = [];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 8; i++) { const a = j * 9 + i; idx.push(a, a + 1, a + 9, a + 1, a + 10, a + 9); }
  g.geometry.setIndex(idx);
  game.scene.add(g);
  return (ghost = g);
}
function showGhost(p) {
  const g = ghostMesh();
  g.visible = !!p;
  if (!p) return;
  const d = norm(p.b.x - p.a.x, p.b.z - p.a.z), pos = g.geometry.attributes.position;
  for (let j = 0; j < 3; j++) {
    const t = j / 2, cx = p.a.x + (p.b.x - p.a.x) * t, cz = p.a.z + (p.b.z - p.a.z) * t;
    for (let i = 0; i < 9; i++) {
      const o = -OUT + (2 * OUT) * i / 8, x = cx - d.z * o, z = cz + d.x * o;
      pos.setXYZ(j * 9 + i, x, terrainHeight(x, z) + 0.06, z);
    }
  }
  pos.needsUpdate = true;
  g.geometry.computeBoundingSphere();
  g.material.color.set(p.ok ? 0xfff1c4 : 0xff6a50);
}

const fwdOf = () => ({ x: -Math.sin(game.player.yaw), z: -Math.cos(game.player.yaw) });

// Called every frame while slot 8 is out. Its own hints.
export function roadUpdate(dt, a) {
  const inp = game.input, L = [];
  cool -= dt;
  if (!kit.use || !kit[kit.use]) kit.use = kitList()[0] ?? null;
  const tool = kit.use;
  game.vm.roadTool?.(kit.hold ? null : tool, kit.gravel > 0 ? 'gravel' : kit.asphalt > 0 ? 'asphalt' : null);
  const pt = a?.point && a.dist <= 3.2 ? a.point : null;
  let info = barrowInfo();

  // carrying a lamp, a sign or road paint
  if (kit.hold) { showGhost(null); return placeUpdate(a, pt); }

  if (!tool && !kit.curbs) L.push(['', 'No road tools — buy a shovel, rake and roller in Woodline (Streets)']);
  let M = pt ? metreAt(pt.x, pt.z) : null, p = null;
  if (!M && pt && tool === 'shovel' && (a.ground || a.body?.street)) {
    p = plan(pt, fwdOf());
    // just past an end that's still being dug: keep digging that metre (it's only a metre long)
    const last = p?.s?.m.length - 1;
    if (p?.s && p.s.m[last].st === ST.DIG) { M = { s: p.s, k: last }; p = null; }
  }
  const m = M ? M.s.m[M.k] : null;
  let action = null, why = null;
  if (a?.stump && a.dist <= 3 && tool === 'shovel') action = { label: 'Dig the stump out', go: () => digStump(a.stump, a.point) };
  else if (a?.body?.rock && a.dist <= 3 && tool === 'shovel') action = { label: 'Dig the rock out', go: () => digRock(a.body.rock, a.point) };
  else if (M && m) {
    info = `${M.s.name} · ${STAGE_NAME[m.st]}${info ? ` · ${info}` : ''}`;
    const need = needs(m);
    if (need === 'curbs' || (kit.curbs && m.st === ST.RAKED)) {
      const n = curbsFor(M.s, M.k);
      if (kit.curbs >= n) action = { label: 'Set the curbs here', go: () => { kit.curbs -= n; doWork(M, 'curbs', pt); } };
      else why = kit.curbs ? `You need ${n} curb stones for this metre` : 'Next: curbs — take curb stones from a pallet';
    } else if (need === 'dig') {
      if (tool === 'shovel') action = { label: `Dig (${m.dig}/${DIG_HITS})`, go: () => doWork(M, 'dig', pt) };
      else why = 'Dig it out with the shovel';
    } else if (need === 'gravel' || need === 'asphalt') {
      if (tool !== 'shovel') why = `Next: ${need} — use the shovel`;
      else if (kit[need] <= 0) why = `No ${need} in your barrow — load it from a big bag (E)`;
      else action = { label: `Spread ${need}`, go: () => { kit[need]--; doWork(M, need, pt); } };
    } else if (need === 'rake') {
      if (tool === 'rake') action = { label: `Rake it level (${m.rake}/${RAKES})`, go: () => doWork(M, 'rake', pt) };
      else why = 'Rake it level with the rake';
    } else if (need === 'roll') {
      if (tool === 'roller') L.push(['Hold click', 'Walk over it with the roller to flatten it']);
      else why = 'Roll it flat with the hand roller';
    } else if (!need) why = M.s.done() ? `${M.s.name} · ${Math.round(M.s.length)} m · finished` : 'This metre is finished';
  } else if (pt && tool === 'shovel' && (a.ground || a.body?.street)) {
    if (p) {
      if (p.ok) action = { label: p.s ? (p.join ? 'Dig the last metre (it meets the other street)' : 'Dig the next metre') : (p.start.kind === 'road' ? 'Start a street here, off the road' : `Start a street here, off ${p.start.of.name}`), go: () => { const r = begin(p); feedback(r.s, r.k, 'dig', pt); if (!p.s) game.hud.toast(`A new street: ${r.s.name}`); } };
      else why = p.why;
    } else why = 'A street starts at the road or at the side of another street';
  }
  if (!action && !why && !pt && tool === 'shovel') why = 'Look at the ground within reach (3 m)';
  showGhost(p);
  if (action) L.push(['Click', action.label]);
  if (why) L.push(['', why]);
  if (kitList().length > 1) L.push(['R', `Switch (${TOOL_NAME[tool].toLowerCase()})`]);
  game.hud.hint(L);
  game.hud.info(info);

  if (tool === 'roller' && inp.lmb) rollStep(dt);
  else { lastRollPos = null; game.vm.sawing = false; }
  if (inp.lmbDown && action && cool <= 0) {
    cool = 0.5;
    game.vm.swing('dig');
    action.go();
  }
}

function barrowInfo() {
  const b = kit.gravel ? `gravel for ${kit.gravel} m` : kit.asphalt ? `asphalt for ${kit.asphalt} m` : '';
  const c = kit.curbs ? `${kit.curbs} curb stones` : '';
  return [b && `Barrow: ${b}`, c].filter(Boolean).join(' · ');
}

function doWork(M, op, at) {
  const r = work(M.s, M.k, op);
  if (r) feedback(M.s, M.k, r, at);
}

function feedback(s, k, what, at) {
  const p = at ? new THREE.Vector3(at.x, terrainHeight(at.x, at.z) + 0.05, at.z) : null;
  const UP = new THREE.Vector3(0, 1, 0);
  if (what === 'dig') { audio.drop?.(0.5); if (p) particles.emit('dirt', p, UP, 14); }
  else if (what === 'gravel' || what === 'asphalt') { audio.bag?.(); if (p) particles.emit('dirt', p, UP, 8); }
  else if (what === 'rake') { audio.drop?.(0.25); }
  else if (what === 'curbs') { audio.woodKnock?.(); }
  else if (what === 'roll') { audio.drop?.(0.4); }
  const m = s.m[k];
  if (m.st === ST.DONE && s.done()) game.hud.toast(`${s.name} is finished: ${Math.round(s.length)} m`);
}

// Dig a stump out of the way: a few shovelfuls round it.
function digStump(st, at) {
  st.dig = (st.dig ?? 0) + 1;
  particles.emit('dirt', new THREE.Vector3(at.x, at.y, at.z), new THREE.Vector3(0, 1, 0), 12);
  audio.drop?.(0.5);
  if (st.dig >= 5) { removeStump(st); game.hud.toast('Dug the stump out'); changed(); }
}
// and a big rock: more work
function digRock(r, at) {
  r.dig = (r.dig ?? 0) + 1;
  particles.emit('dirt', new THREE.Vector3(at.x, at.y, at.z), new THREE.Vector3(0, 1, 0), 12);
  audio.drop?.(0.6);
  if (r.dig >= 8) { removeRock(r); game.hud.toast('Dug the rock out'); changed(); }
}
// small rocks where a metre of street goes are dug away with it
function clearRocks(a, b, big = false) {
  for (const r of rocks) if (!r.gone && (big || !r.big) && Math.abs(r.x - b.x) < 8 && Math.abs(r.z - b.z) < 8 && segDist(r.x, r.z, a, b) < OUT + 0.6 + r.r) removeRock(r);
}

// The roller: hold click and walk; the metres under you get rolled.
function rollStep(dt) {
  const b = game.player.body.position;
  const here = { x: b.x, z: b.z };
  const moved = lastRollPos ? Math.hypot(here.x - lastRollPos.x, here.z - lastRollPos.z) : 0;
  lastRollPos = here;
  game.vm.sawing = moved > 0.001;
  if (moved <= 0 || moved > 1) return;
  const M = metreAt(here.x, here.z);
  if (!M) return;
  const m = M.s.m[M.k];
  if (m.st !== ST.SMOOTH) return;
  m.roll += moved;
  game.hud.progress(Math.min(1, m.roll / ROLL));
  if (m.roll >= ROLL) { work(M.s, M.k, 'roll'); feedback(M.s, M.k, 'roll', here); game.hud.progress(0); }
}

// ───────── lamps, signs and zebra crossings ─────────

// Where a lamp / sign would go for what you aim at: on a finished sidewalk, by the curb or the back.
function placeTarget(pt, kind) {
  const M = metreAt(pt.x, pt.z);
  if (!M) return { why: 'Aim at a finished street' };
  const s = M.s;
  if (kind === 'zebra') {
    const along = clamp(M.along, 1.5, s.length - 1.5);
    for (let a = along - 1.5; a <= along + 1.5; a += 0.5) if (s.m[kf(s, a).k].st !== ST.DONE) return { why: 'Only on a finished (rolled) street' };
    if (s.zebras.some((z) => Math.abs(z - along) < 6)) return { why: 'There is a crossing right here' };
    if ((s.start && along < 2.5) || (s.end && along > s.length - 2.5)) return { why: 'Too close to the junction' };
    return { s, along };
  }
  if (Math.abs(M.lat) < HW + CURB_W) return { why: 'On the sidewalk, not the road' };
  const side = M.lat > 0 ? 0 : 1;
  if (s.m[M.k].st !== ST.DONE) return { why: 'The sidewalk isn\'t finished here' };
  if (!uncut(s, side, M.along - 0.2, M.along + 0.2).length) return { why: 'Not on the corner' };
  const o = (side ? -1 : 1) * (kind === 'lamp' ? OUT - 0.4 : HW + CURB_W + 0.35);
  const near = kind === 'lamp' ? lamps.find((l) => l.street === s && Math.abs(l.along - M.along) < 8) : signs.find((x) => x.street === s && x.side === side && Math.abs(x.along - M.along) < 1.2);
  if (near) return { why: kind === 'lamp' ? 'Another lamp is close by (keep 8 m)' : 'Another sign is right here' };
  return { s, along: M.along, side, o };
}

let placeGhost = null;
function placeUpdate(a, pt) {
  const L = [], kind = kit.hold;
  const t = pt ? placeTarget(pt, kind) : { why: 'Aim at a finished street' };
  const name = kind === 'lamp' ? 'street lamp' : kind === 'sign' ? `"${SIGN_KINDS[kit.signKind][1]}" sign` : 'zebra crossing';
  if (t.why) L.push(['', t.why]); else L.push(['Click', kind === 'zebra' ? 'Paint a zebra crossing here' : `Set the ${name} here`]);
  if (kind === 'sign') L.push(['R', `Which sign: ${SIGN_KINDS[kit.signKind][1]}`]);
  L.push(['E', 'Put it down']);
  game.hud.hint(L);
  game.hud.info(`Carrying: ${name}`);
  // a chalk mark where it goes
  placeGhost ??= (() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 16), mats().ghostLine); game.scene.add(m); return m; })();
  placeGhost.visible = !t.why;
  if (!t.why) {
    const p = at(t.s, t.along, t.o ?? 0);
    placeGhost.position.set(p.x, p.h + (t.o ? SW_H : 0) + 0.03, p.z);
    placeGhost.scale.set(kind === 'zebra' ? 10 : 1, 1, kind === 'zebra' ? 2 : 1);
    const d = dirOf(t.s, kf(t.s, t.along).k);
    placeGhost.rotation.y = Math.atan2(-d.z, d.x) + (kind === 'zebra' ? Math.PI / 2 : 0);
  }
  if (game.input.lmbDown && !t.why && cool <= 0) {
    cool = 0.5;
    game.vm.swing('lay');
    if (kind === 'zebra') { t.s.zebras.push(t.along); t.s.dirty = true; audio.bag?.(); game.hud.toast('A zebra crossing: people cross here, and cars must stop for them'); }
    else if (kind === 'lamp') { new Lamp(t.s, t.along, t.side); audio.woodKnock?.(); game.hud.toast('A street lamp: it comes on at dusk (power: $1 a night)'); }
    else { new Sign(t.s, t.along, t.side, SIGN_KINDS[kit.signKind][0]); audio.woodKnock?.(); }
    kit.hold = null;
    placeGhost.visible = false;
    changed();
  }
}
export function hidePlacing() { if (placeGhost) placeGhost.visible = false; showGhost(null); }

const lampMats = {};
function lampMat() {
  if (lampMats.pole) return lampMats;
  lampMats.pole = new THREE.MeshStandardMaterial({ color: 0x3b4a44, roughness: 0.6, metalness: 0.2 });
  lampMats.on = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffd9a0, emissiveIntensity: 0 });
  lampMats.off = new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.4 });
  lampMats.pool = new THREE.MeshBasicMaterial({ map: (mats(), TEX.pool), color: 0xffcf8a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  return lampMats;
}

class Lamp {
  constructor(street, along, side, saved) {
    this.street = street; this.along = along; this.side = side;
    this.broken = saved?.broken ?? false;
    this.flicker = 0;
    const M = lampMat(), sg = side ? -1 : 1;
    const p = at(street, along, sg * (OUT - 0.4)), d = dirOf(street, kf(street, along).k);
    const toRoad = { x: d.z * sg, z: -d.x * sg }; // (from the sidewalk towards the middle)
    this.pos = new THREE.Vector3(p.x, p.h + SW_H, p.z);
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 5.4, 10), M.pole);
    pole.position.y = 2.7;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.5, 10), M.pole);
    base.position.y = 0.25;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.4, 8).rotateZ(Math.PI / 2 - 0.12), M.pole);
    arm.position.set(0.68, 5.45, 0);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.3), M.pole);
    head.position.set(1.32, 5.5, 0);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.22), this.broken ? M.off : M.on);
    bulb.position.set(1.32, 5.43, 0);
    for (const m of [pole, base, arm, head]) { m.castShadow = true; g.add(m); }
    g.add(bulb);
    g.position.copy(this.pos);
    g.rotation.y = Math.atan2(-toRoad.z, toRoad.x);
    game.scene.add(g);
    this.g = g; this.bulb = bulb;
    // the warm pool of light it throws on the street at night
    const pool = new THREE.Mesh(new THREE.CircleGeometry(6, 28).rotateX(-Math.PI / 2), M.pool);
    const under = at(street, along, sg * (OUT - 1.75));
    pool.position.set(under.x, under.h + 0.03, under.z);
    pool.renderOrder = 4;
    game.scene.add(pool);
    this.pool = pool;
    this.body = new CANNON.Body({ mass: 0, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: MASK.ALL });
    this.body.addShape(new CANNON.Cylinder(0.1, 0.12, 5.4, 8), new CANNON.Vec3(0, 2.7, 0));
    this.body.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.body.lamp = this;
    world.addBody(this.body);
    lamps.push(this);
  }
  fix() {
    if (!this.broken) return;
    if (!spend(8, 'Street lamp · new bulb')) { game.hud.toast('You need $8 for a new bulb'); return; }
    this.broken = false;
    this.bulb.material = lampMat().on;
    audio.pickup?.();
    game.hud.toast('New bulb in: the lamp works again');
    changed();
  }
}
export const lampHint = (l) => (l.broken ? 'Change the bulb ($8)' : null);
export const lampInfo = (l) => `Street lamp · ${l.street.name}${l.broken ? ' · broken (no light)' : ' · works'}`;

let signTex = {};
function signFace(kind, street) {
  const key = kind === 'name' ? `name:${street.name}` : kind;
  if (signTex[key]) return signTex[key];
  const c = document.createElement('canvas');
  c.width = kind === 'name' ? 512 : 256; c.height = kind === 'name' ? 128 : 256;
  const x = c.getContext('2d'), W = c.width, H = c.height;
  x.lineJoin = 'round';
  if (kind === 'name') {
    x.fillStyle = '#1f4f9a'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#fff'; x.lineWidth = 8; x.strokeRect(10, 10, W - 20, H - 20);
    x.fillStyle = '#fff'; x.font = '700 62px Outfit, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(street.name, W / 2, H / 2 + 3);
  } else if (kind === 'stop') {
    x.fillStyle = '#c4161c'; x.beginPath();
    for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; x.lineTo(128 + Math.cos(a) * 120, 128 + Math.sin(a) * 120); }
    x.closePath(); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 8; x.stroke();
    x.fillStyle = '#fff'; x.font = '800 70px Outfit, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('STOP', 128, 132);
  } else if (kind === 'yield') {
    x.fillStyle = '#fff'; x.strokeStyle = '#c4161c'; x.lineWidth = 22;
    x.beginPath(); x.moveTo(20, 34); x.lineTo(236, 34); x.lineTo(128, 226); x.closePath(); x.fill(); x.stroke();
  } else if (kind === 'limit30') {
    x.fillStyle = '#fff'; x.strokeStyle = '#c4161c'; x.lineWidth = 30;
    x.beginPath(); x.arc(128, 128, 108, 0, Math.PI * 2); x.fill(); x.stroke();
    x.fillStyle = '#111'; x.font = '800 110px Outfit, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('30', 128, 136);
  } else if (kind === 'crossing') {
    x.fillStyle = '#1f4f9a'; x.fillRect(8, 8, 240, 240);
    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(128, 30); x.lineTo(226, 214); x.lineTo(30, 214); x.closePath(); x.fill();
    x.fillStyle = '#111';
    for (let i = 0; i < 4; i++) x.fillRect(70 + i * 30, 182, 16, 22);
    x.beginPath(); x.arc(128, 96, 13, 0, Math.PI * 2); x.fill();
    x.lineWidth = 9; x.strokeStyle = '#111'; x.lineCap = 'round';
    x.beginPath(); x.moveTo(126, 112); x.lineTo(120, 146); x.lineTo(104, 172); x.moveTo(120, 146); x.lineTo(140, 170); x.moveTo(124, 122); x.lineTo(104, 136); x.moveTo(124, 122); x.lineTo(146, 132); x.stroke();
  } else if (kind === 'main') {
    x.save(); x.translate(128, 128); x.rotate(Math.PI / 4);
    x.fillStyle = '#fff'; x.fillRect(-88, -88, 176, 176);
    x.fillStyle = '#f2c200'; x.fillRect(-62, -62, 124, 124);
    x.restore();
  } else if (kind === 'deadend') {
    x.fillStyle = '#1f4f9a'; x.fillRect(8, 8, 240, 240);
    x.fillStyle = '#fff'; x.fillRect(108, 90, 40, 140);
    x.fillStyle = '#c4161c'; x.fillRect(58, 50, 140, 44);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (signTex[key] = t);
}

class Sign {
  constructor(street, along, side, kind) {
    this.street = street; this.along = along; this.side = side; this.kind = kind;
    const sg = side ? -1 : 1;
    const p = at(street, along, sg * (HW + CURB_W + 0.35)), d = dirOf(street, kf(street, along).k);
    this.pos = new THREE.Vector3(p.x, p.h + SW_H, p.z);
    const g = new THREE.Group();
    const M = lampMat();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.5, 8), new THREE.MeshStandardMaterial({ color: 0x9aa1a7, roughness: 0.5, metalness: 0.3 }));
    pole.position.y = 1.25;
    pole.castShadow = true;
    g.add(pole);
    const geo = plateGeometry(kind), h = kind === 'name' ? 0.25 : 0.62;
    const face = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: signFace(kind, street), roughness: 0.5 }));
    const back = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8e9397, roughness: 0.6 }));
    back.rotation.y = Math.PI;
    face.position.z = 0.045;
    back.position.z = 0.04;
    for (const m of [face, back]) { m.position.y = 2.5 - h / 2 + 0.04; m.castShadow = true; g.add(m); }
    g.position.copy(this.pos);
    // a street name faces across the street; the others face the traffic coming on this side
    const yaw = Math.atan2(d.x, d.z);
    g.rotation.y = kind === 'name' ? yaw + sg * Math.PI / 2 : yaw + (sg > 0 ? Math.PI : 0);
    game.scene.add(g);
    this.g = g;
    this.body = new CANNON.Body({ mass: 0, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: MASK.ALL });
    this.body.addShape(new CANNON.Cylinder(0.05, 0.05, 2.5, 6), new CANNON.Vec3(0, 1.25, 0));
    this.body.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.body.sign = this;
    world.addBody(this.body);
    signs.push(this);
  }
}

// The plate's outline (an octagon, a triangle, a disc…), with the face picture mapped onto it.
const plates = {};
function plateGeometry(kind) {
  if (plates[kind]) return plates[kind];
  let g;
  if (kind === 'name') g = new THREE.PlaneGeometry(1.0, 0.25);
  else if (kind === 'stop') g = new THREE.CircleGeometry(0.31, 8, Math.PI / 8);
  else if (kind === 'limit30') g = new THREE.CircleGeometry(0.31, 28);
  else if (kind === 'main') g = new THREE.CircleGeometry(0.34, 4);
  else if (kind === 'yield') {
    // corners as drawn on the 256 px picture: (20, 34), (236, 34), (128, 226)
    const P = [[20, 34], [236, 34], [128, 226]], S = 0.62 / 256;
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P.flatMap(([x, y]) => [(x - 128) * S, (128 - y) * S, 0]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(P.flatMap(([x, y]) => [x / 256, 1 - y / 256]), 2));
    g.setIndex([0, 2, 1]);
    g.computeVertexNormals();
  } else g = new THREE.PlaneGeometry(0.6, 0.6);
  return (plates[kind] = g);
}
export const signInfo = (s) => `Road sign · ${SIGN_KINDS.find(([k]) => k === s.kind)[1]}${s.kind === 'name' ? `: ${s.street.name}` : ''}`;

// ───────── every frame ─────────

let powerDay = null;
export function updateStreets(dt, active, hands) {
  for (const t of things) t.sync();
  for (const s of streets) if (s.dirty) { s.dirty = false; build(s); }
  if (pending.box) { const B = pending.box; pending.box = null; regrade(B.x0, B.z0, B.x1, B.z1); }
  if (changedT > 0 && (changedT -= Math.max(dt, 1 / 60)) <= 0) listeners.forEach((fn) => fn());
  if (game.tools?.tool !== 'road' || !hands) hidePlacing();
  // the lamps: on from dusk till dawn; now and then a bulb goes
  const night = smoothstep(0.38, 0.12, game.day?.daylight ?? 1);
  const M = lampMat();
  if (lamps.length) {
    M.on.emissiveIntensity = night * 2.2;
    M.pool.opacity = night * 0.55;
    for (const l of lamps) {
      l.pool.visible = !l.broken && night > 0.02;
      if (active && night > 0.5 && !l.broken && Math.random() < dt / (60 * 24 * 6)) { l.broken = true; l.bulb.material = M.off; changed(); }
    }
  }
  // power for the lamps that work: every morning at 8
  if (active && game.day) {
    const h = game.day.t * 24;
    if (powerDay === null) powerDay = game.day.day;
    if (h >= 8 && game.day.day !== powerDay) {
      powerDay = game.day.day;
      const n = lamps.filter((l) => !l.broken).length;
      if (n && !spend(n, `Street lights · power for ${n} ${n === 1 ? 'lamp' : 'lamps'}`)) game.hud.toast('No money for the street lights\' power');
    }
  }
}

// ───────── a street that was already there (start modes) ─────────

// Lays a whole finished street from a junction, following the land: { kind, of } start, a point on
// the parent's edge, a direction, and how long. Trees in the way are cleared. Returns the street or null.
// Where a street from a along d would run, following the land, without building it:
// { n: nodes, cost: how much it cuts and fills, len } or null if it can't get 12 m.
export function traceStreet(start, a, d, len) {
  const n = [{ x: a.x, z: a.z, h: a.h }], fake = { n, m: [], start };
  let dir = d, cost = 0;
  for (let i = 0; i < len; i++) {
    const E = n[n.length - 1];
    let best = null;
    for (const turn of [0, -0.05, 0.05, -0.11, 0.11]) {
      const dd = rotate(dir, turn), b = { x: E.x + dd.x, z: E.z + dd.z };
      b.h = clamp(groundAcross(b, dd), E.h - GRADE, E.h + GRADE);
      const why = blocked(E, b, fake, { k: i, ignoreTrees: true, parent: i < 4 ? (start.of ?? 'road') : null });
      const c = Math.abs(baseHeight(b.x, b.z) - b.h) + Math.abs(turn) * 2;
      if (!why && (!best || c < best.c)) best = { b, dd, c };
    }
    if (!best) break;
    dir = best.dd;
    cost += best.c;
    n.push(best.b);
    fake.m.push(null);
  }
  return n.length - 1 >= Math.min(len, 12) ? { n, cost, len: n.length - 1 } : null;
}

export function layStreet(start, a, d, len, clearTree) {
  const tr = traceStreet(start, a, d, len);
  if (!tr) return null;
  const s = new Street(newName(), tr.n[0], start);
  s.n = tr.n;
  s.m = tr.n.slice(1).map(() => ({ st: ST.DONE, dig: DIG_HITS, rake: 0, roll: 0 }));
  for (let k = 0; k < s.m.length; k++) clearRocks(s.n[k], s.n[k + 1], true);
  for (const t of trees) {
    if (!t.alive) continue;
    for (let k = 0; k < s.m.length; k++) if (segDist(t.x, t.z, s.n[k], s.n[k + 1]) < OUT + 1.2 + t.r) { clearTree(t); break; }
  }
  boxOf(s);
  layout();
  regrade(s.box.x0, s.box.z0, s.box.x1, s.box.z1);
  return s;
}

// A finished street's spots for a house: its front this far out from the middle, facing the street.
export function houseSpots(s, front = OUT + 1.5, step = 3) {
  const out = [];
  for (let a = 6; a < s.length - 5; a += step) {
    const { k } = kf(s, a), d = dirOf(s, k);
    for (const sg of [1, -1]) {
      const p = at(s, a, sg * front);
      out.push({ F: { x: p.x, z: p.z }, sn: { x: -d.z * sg, z: d.x * sg }, street: s, along: a, side: sg > 0 ? 0 : 1 });
    }
  }
  return out;
}
export const addLamp = (s, along, side) => new Lamp(s, along, side);
export const addSign = (s, along, side, kind) => new Sign(s, along, side, kind);

// ───────── saving and loading ─────────

const r3 = (v) => Math.round(v * 1e3) / 1e3, r4 = (v) => Math.round(v * 1e4) / 1e4, r5 = (v) => Math.round(v * 1e5) / 1e5;
export function saveStreets() {
  return {
    streets: streets.map((s) => ({
      id: s.id, name: s.name, founded: s.founded,
      n: s.n.map((p) => [r4(p.x), r4(p.z), r4(p.h)]),
      m: s.m.map((m) => [m.st, m.dig, m.rake, r3(m.roll)]),
      start: s.start.kind === 'road' ? { kind: 'road' } : { kind: 'street', of: s.start.of.id },
      end: !s.end ? null : s.end.kind === 'road' ? { kind: 'road' } : { kind: 'street', of: s.end.of.id },
      zebras: s.zebras.map(r3),
    })),
    lamps: lamps.map((l) => ({ s: l.street.id, a: r3(l.along), side: l.side, broken: l.broken })),
    signs: signs.map((x) => ({ s: x.street.id, a: r3(x.along), side: x.side, kind: x.kind })),
    things: [...things].map((t) => ({ kind: t.kind, tool: t.tool, m: t.m, n: t.n, pos: [r4(t.body.position.x), r4(t.body.position.y), r4(t.body.position.z)], quat: [r5(t.body.quaternion.x), r5(t.body.quaternion.y), r5(t.body.quaternion.z), r5(t.body.quaternion.w)] })),
    kit: { ...kit },
    powerDay,
    dugOut: { rocks: rocks.filter((r) => r.gone).map((r) => r.i), stumps: trees.filter((t) => t.dugOut).map((t) => t.i) },
  };
}

export function loadStreets(d) {
  if (!d) return;
  const byId = new Map();
  for (const x of d.streets) {
    const s = new Street(x.name, { x: x.n[0][0], z: x.n[0][1], h: x.n[0][2] }, null, x.id);
    s.founded = x.founded;
    s.n = x.n.map(([px, pz, h]) => ({ x: px, z: pz, h }));
    s.m = x.m.map(([st, dig, rake, roll]) => ({ st, dig, rake, roll }));
    s.zebras = x.zebras ?? [];
    s._save = x;
    byId.set(x.id, s);
  }
  for (const s of byId.values()) {
    const j = (v) => (!v ? null : v.kind === 'road' ? { kind: 'road' } : byId.get(v.of) ? { kind: 'street', of: byId.get(v.of) } : { kind: 'road' });
    s.start = j(s._save.start) ?? { kind: 'road' };
    s.end = j(s._save.end);
    delete s._save;
    boxOf(s);
  }
  layout();
  // rocks and stumps that were dug out of the way stay gone
  for (const i of d.dugOut?.rocks ?? []) if (rocks[i]) removeRock(rocks[i]);
  const gone = new Set(d.dugOut?.stumps ?? []);
  for (const st of [...stumps]) {
    const L = locate(st.t.x, st.t.z);
    if (gone.has(st.t.i) || (L && L.inside && L.d < OUT + 0.5)) removeStump(st);
  }
  let B = null;
  for (const s of streets) B = !B ? { ...s.box } : { x0: Math.min(B.x0, s.box.x0), x1: Math.max(B.x1, s.box.x1), z0: Math.min(B.z0, s.box.z0), z1: Math.max(B.z1, s.box.z1) };
  if (B) regrade(B.x0, B.z0, B.x1, B.z1);
  for (const l of d.lamps ?? []) { const s = byId.get(l.s); if (s) new Lamp(s, l.a, l.side, l); }
  for (const x of d.signs ?? []) { const s = byId.get(x.s); if (s) new Sign(s, x.a, x.side, x.kind); }
  for (const t of d.things ?? []) {
    const o = new StreetThing({ kind: t.kind, tool: t.tool, m: t.m, n: t.n }, { x: t.pos[0], y: t.pos[1], z: t.pos[2] }, new CANNON.Quaternion(...t.quat));
    o.body.sleep();
  }
  Object.assign(kit, d.kit ?? {});
  powerDay = d.powerDay ?? null;
  changed();
}

export const streetsDebug = { streets, lamps, signs, things, kit, plan, begin, work, metreAt, locate, layout, ST, layStreet, traceStreet, blocked, regrade, spawnStreetThing };
