// The shape and colour of the land. Pure functions, so physics, grass, trees
// and particles all agree on where the ground is.
import * as THREE from 'three';
import { makeNoise, fbm, clamp, lerp, smoothstep } from './util.js';

export const SIZE = 256, HALF = 128;

const nA = makeNoise(11), nB = makeNoise(23), nC = makeNoise(37), nD = makeNoise(51);

function rawHeight(x, z) {
  return fbm(nA, x * 0.011, z * 0.011, 4) * 9 + fbm(nB, x * 0.05, z * 0.05, 3) * 1.1;
}
const H0 = rawHeight(0, 0);
const field = { d: null, h: null };
const _rf = { d: 99, h: 0 };

function landHeight(x, z, rimK = 1) {
  const d = Math.hypot(x, z);
  let h = rawHeight(x, z) - H0;
  // a calm, almost flat clearing around the start
  h = lerp(h, fbm(nB, x * 0.05, z * 0.05, 3) * 0.3, smoothstep(30, 9, d));
  // hills all around the edge, so the world feels closed in
  const e = Math.max(Math.abs(x), Math.abs(z));
  const rim = smoothstep(82, 126, e * 0.6 + d * 0.4) * rimK;
  return h + rim * rim * 30 + rim * fbm(nC, x * 0.035, z * 0.035, 3) * 8;
}

// The land as it grew, before anybody dug into it.
export function baseHeight(x, z) {
  let h = landHeight(x, z);
  const f = roadField(x, z);
  if (f.d <= 6) h = lerp(h, f.h, smoothstep(5.2, 2.7, f.d));
  // the timber yard is levelled flat
  const yd = Math.hypot(x - YARD.x, z - YARD.z);
  if (yd < YARD.r + 7) h = lerp(h, YARD.h, smoothstep(YARD.r + 7, YARD.r, yd));
  return h;
}

// What people dug away or filled in (streets): metres up or down at each 1 m grid point,
// and how much fresh earth shows there (0–1). streets.js writes it, world.js reshapes the ground.
export const dug = { h: null, scar: null, any: false };
export function setDug(gx, gz, dh, scar) {
  const N = SIZE + 1;
  if (!dug.h) { dug.h = new Float32Array(N * N); dug.scar = new Float32Array(N * N); }
  dug.h[gz * N + gx] = dh;
  dug.scar[gz * N + gx] = scar;
  if (dh || scar) dug.any = true;
}
function dugAt(arr, x, z) {
  const N = SIZE + 1;
  const fx = clamp(x + HALF, 0, SIZE - 0.001), fz = clamp(z + HALF, 0, SIZE - 0.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, i = iz * N + ix;
  return (arr[i] * (1 - tx) + arr[i + 1] * tx) * (1 - tz) + (arr[i + N] * (1 - tx) + arr[i + N + 1] * tx) * tz;
}
export const scarAt = (x, z) => (dug.any ? dugAt(dug.scar, x, z) : 0);

export function terrainHeight(x, z) {
  return dug.any ? baseHeight(x, z) + dugAt(dug.h, x, z) : baseHeight(x, z);
}

export const roadDist = (x, z) => roadField(x, z).d;

// The timber yard that buys your wood: far from camp, at the end of a dirt track that turns
// off the main road and winds through the forest.
export const YARD = { x: -51, z: 57, r: 12, h: 0 };
export const yardDist = (x, z) => Math.hypot(x - YARD.x, z - YARD.z);

// Where your pickup waits at the start, nose towards the turning loop.
export const PARK = { x: 10.5, z: -4.5 };
export const parkDist = (x, z) => Math.hypot(x - PARK.x, z - PARK.z);

// ───────── the road ─────────
// A dirt road comes in through a gap in the eastern hills and ends in a small
// turning loop next to camp. Trucks drive in, go round the loop, and drive out.

const APPROACH = [[127, 24], [112, 25], [98, 31], [82, 23], [62, 27], [44, 17], [30, 10], [22, 6.4]];
export const LOOP = { x: 16, z: 6, r: 6 };
// The yard track leaves the main road at one of its own points, (44, 17).
const YARD_TRACK = [[44, 17], [40, 28], [30, 40], [14, 50], [-4, 56], [-22, 59], [-36, 58], [-46, 57]];
export const road = { approach: [], loop: [], yard: [] }; // samples {x, z, h} every ~0.5 m

(function buildRoad() {
  const spaced = (pts) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    return curve.getSpacedPoints(Math.round(curve.getLength() / 0.5)).map((p) => ({ x: p.x, z: p.z, h: 0 }));
  };
  road.approach = spaced(APPROACH);
  const m = Math.round((2 * Math.PI * LOOP.r) / 0.5);
  for (let i = 0; i <= m; i++) {
    const a = (i / m) * Math.PI * 2;
    road.loop.push({ x: LOOP.x + Math.cos(a) * LOOP.r, z: LOOP.z + Math.sin(a) * LOOP.r, h: 0 });
  }
  road.yard = spaced(YARD_TRACK);
  // the roads cut through the hills, and never get steep
  const smooth = (list, W) => {
    const raw = list.map((p) => landHeight(p.x, p.z, 0.12));
    list.forEach((p, i) => {
      let s = 0, c = 0;
      for (let k = Math.max(0, i - W); k <= Math.min(list.length - 1, i + W); k++) { s += raw[k]; c++; }
      p.h = s / c;
    });
  };
  smooth([...road.approach, ...road.loop], 28);
  smooth(road.yard, 24);
  // the yard is level at the height of the land there; the track starts at the main road's
  // height and ends at the yard's
  let s = 0, c = 0;
  for (let dx = -YARD.r; dx <= YARD.r; dx += 2) for (let dz = -YARD.r; dz <= YARD.r; dz += 2) {
    if (dx * dx + dz * dz > YARD.r * YARD.r) continue;
    s += landHeight(YARD.x + dx, YARD.z + dz); c++;
  }
  YARD.h = s / c;
  const j = road.approach.reduce((b, p) => ((p.x - 44) ** 2 + (p.z - 17) ** 2 < (b.x - 44) ** 2 + (b.z - 17) ** 2 ? p : b));
  let along = 0;
  road.yard.forEach((p, i) => {
    if (i) along += Math.hypot(p.x - road.yard[i - 1].x, p.z - road.yard[i - 1].z);
    p.h = lerp(j.h, p.h, smoothstep(0, 30, along));
    // (a long, gentle ramp: over 14 m it was a 30 % climb)
    p.h = lerp(p.h, YARD.h, smoothstep(YARD.r + 44, YARD.r, Math.hypot(p.x - YARD.x, p.z - YARD.z)));
  });
  const all = [...road.approach, ...road.loop, ...road.yard];

  // distance-to-road field on the 1 m grid, only around the road
  const N = SIZE + 1;
  field.d = new Float32Array(N * N).fill(99);
  field.h = new Float32Array(N * N);
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of all) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  for (let gz = Math.max(0, Math.floor(z0 - 8 + HALF)); gz <= Math.min(SIZE, Math.ceil(z1 + 8 + HALF)); gz++) {
    for (let gx = Math.max(0, Math.floor(x0 - 8 + HALF)); gx <= Math.min(SIZE, Math.ceil(x1 + 8 + HALF)); gx++) {
      const x = gx - HALF, z = gz - HALF;
      let best = 99, bh = 0;
      for (const p of all) {
        const dd = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (dd < best) { best = dd; bh = p.h; }
      }
      field.d[gz * N + gx] = Math.sqrt(best);
      field.h[gz * N + gx] = bh;
    }
  }
})();

function roadField(x, z) {
  const N = SIZE + 1;
  const fx = clamp(x + HALF, 0, SIZE - 0.001), fz = clamp(z + HALF, 0, SIZE - 0.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const i = iz * N + ix;
  const d = field.d, h = field.h;
  _rf.d = (d[i] * (1 - tx) + d[i + 1] * tx) * (1 - tz) + (d[i + N] * (1 - tx) + d[i + N + 1] * tx) * tz;
  _rf.h = (h[i] * (1 - tx) + h[i + 1] * tx) * (1 - tz) + (h[i + N] * (1 - tx) + h[i + N + 1] * tx) * tz;
  return _rf;
}

export const forestDensity = (x, z) => fbm(nD, x * 0.018, z * 0.018, 3);
export const pineChance = (x, z) => fbm(nC, x * 0.025 + 9, z * 0.025, 2);

// Bare earth where you start building.
export function dirtAmount(x, z) {
  const d = Math.hypot(x - 1, z + 1);
  return smoothstep(4.2, 2.2, d + fbm(nA, x * 0.45, z * 0.45, 2) * 2.2);
}

const C = {
  grassA: new THREE.Color(0x5b8c32),
  grassB: new THREE.Color(0x87a646),
  forest: new THREE.Color(0x40602a),
  dry: new THREE.Color(0xa8a85a),
  dirt: new THREE.Color(0x7a5e40),
  rock: new THREE.Color(0x77756c),
  road: new THREE.Color(0x8d7656),
  fresh: new THREE.Color(0x6e5238), // earth just dug
};

export function groundColor(x, z, ny = 1, out = new THREE.Color()) {
  out.copy(C.grassA).lerp(C.grassB, clamp(fbm(nB, x * 0.07, z * 0.07, 2) * 1.2 + 0.5, 0, 1));
  out.lerp(C.forest, smoothstep(-0.05, 0.3, forestDensity(x, z)) * 0.75);
  out.lerp(C.dry, clamp(fbm(nC, x * 0.02 + 5, z * 0.02, 2) * 1.6, 0, 1) * 0.35);
  out.lerp(C.dirt, dirtAmount(x, z) * 0.75);
  out.lerp(C.rock, smoothstep(0.86, 0.66, ny) * 0.85);
  out.lerp(C.road, smoothstep(3.2, 1.9, roadDist(x, z)));
  out.lerp(C.road, smoothstep(YARD.r + 1, YARD.r - 3, yardDist(x, z)) * 0.9); // the yard: bare, trodden earth
  out.lerp(C.fresh, scarAt(x, z) * 0.9);
  return out;
}
