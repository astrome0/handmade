// Orders from the phone shop, and the truck that brings them down the road,
// tips them off at the turning loop, and drives away again.
import * as THREE from 'three';
import { world, CANNON, GROUP, MASK, MAT } from './physics.js';
import { terrainHeight, road } from './terrain.js';
import { game } from './game.js';
import { TEX } from './textures.js';
import { Piece, woodMats, logGeometry } from './items.js';
import { audio } from './audio.js';
import { particles } from './particles.js';
import { cargoMesh, spawnCargo } from './masonry.js';
import { thingMesh, spawnPaintThing, BUCKET_CELLS } from './paint.js';
import { thingMesh as streetThingMesh, spawnStreetThing, STREET_KINDS } from './streets.js';

// ───────── what you can buy ─────────
// Only raw materials: you still saw and nail everything yourself.

const rnd = (a, b) => a + Math.random() * (b - a);
export const CATALOG = [
  { id: 'poles', cat: 'wood', name: 'Thin pine poles', info: '6 × 1.8 m · Ø 12–14 cm', note: 'Perfect for fence posts', price: 18, load: 2,
    cargo: () => Array.from({ length: 6 }, () => ({ kind: 'log', r: rnd(0.06, 0.07), len: rnd(1.75, 1.85) })) },
  { id: 'pine3', cat: 'wood', name: 'Pine logs 3 m', info: '3 × 3 m · Ø 22–26 cm', note: 'Saw into 3 planks each', price: 45, load: 3,
    cargo: () => Array.from({ length: 3 }, () => ({ kind: 'log', r: rnd(0.11, 0.13), len: rnd(2.95, 3.05) })) },
  { id: 'pine5', cat: 'wood', name: 'Long pine log', info: '1 × 5 m · Ø 28 cm', note: 'For long planks', price: 32, load: 2,
    cargo: () => [{ kind: 'log', r: 0.14, len: rnd(4.9, 5.05) }] },
  { id: 'oak2', cat: 'wood', name: 'Oak logs 2 m', info: '2 × 2 m · Ø 30–34 cm', note: 'Thick and heavy', price: 60, load: 2,
    cargo: () => Array.from({ length: 2 }, () => ({ kind: 'log', r: rnd(0.15, 0.17), len: rnd(1.95, 2.05), species: 'oak' })) },
  { id: 'nails', cat: 'hardware', name: 'Nails, box of 100', info: '90 mm steel nails', note: 'Pick the box up to fill your pouch', price: 6, load: 0,
    cargo: () => [{ kind: 'nails' }] },
  { id: 'bricks', cat: 'masonry', name: 'Bricks, pallet of 48', info: 'Big red clay bricks · 390 × 190 × 130 mm', note: 'About 2.7 m² of wall', price: 95, load: 4,
    cargo: () => [{ kind: 'pallet', count: 48 }] },
  { id: 'mortar', cat: 'masonry', name: 'Mortar mix, 25 kg', info: 'Just add water', note: 'Enough for 20 bricks', price: 7, load: 1,
    cargo: () => [{ kind: 'mortar' }] },
  { id: 'door', cat: 'house', name: 'Wooden door with frame', info: '120 × 224 cm, lintel on top', note: 'Set it into a wall with the trowel', price: 140, load: 2,
    cargo: () => [{ kind: 'door' }] },
  { id: 'window', cat: 'house', name: 'Window with frame', info: '100 × 126 cm, lintel on top', note: 'Set it into a wall with the trowel', price: 90, load: 1,
    cargo: () => [{ kind: 'window' }] },
  { id: 'sheets', cat: 'house', name: 'Roofing sheets, 8 pcs', info: 'Painted steel · 1 × 2 m each', note: 'Nail them onto plank rafters', price: 88, load: 3,
    cargo: () => Array.from({ length: 8 }, () => ({ kind: 'sheet' })) },
  { id: 'paint', cat: 'paint', name: 'Paint, 10 l bucket', info: 'Walls, frames, doors, roofs · covers ~24 m²', note: 'Pick a colour, then how many', price: 18, load: 1, colours: true,
    cargo: (colour) => [{ kind: 'bucket', colour: colour ?? 'white', cells: BUCKET_CELLS }] },
  { id: 'plaster', cat: 'paint', name: 'Plaster mix, 25 kg', info: 'Render for brick walls · ~4 m²', note: 'Mix it (E), spread it with the float', price: 6, load: 1,
    cargo: () => [{ kind: 'plaster' }] },
  { id: 'brush', cat: 'paint', name: 'Paint brush', info: '60 mm', note: 'Frames, doors, corners', price: 4, load: 0,
    cargo: () => [{ kind: 'tool', tool: 'brush' }] },
  { id: 'roller', cat: 'paint', name: 'Paint roller', info: '25 cm, with a short pole', note: 'Big walls, fast', price: 9, load: 0,
    cargo: () => [{ kind: 'tool', tool: 'roller' }] },
  { id: 'float', cat: 'paint', name: 'Plastering float', info: 'Steel, 30 cm', note: 'Spreads plaster on a wall', price: 8, load: 0,
    cargo: () => [{ kind: 'tool', tool: 'float' }] },
  { id: 'gravel', cat: 'road', name: 'Gravel, big bag', info: '1 t · enough for 4 m of street', note: 'Load your barrow (E), spread it with the shovel', price: 14, load: 2,
    cargo: () => [{ kind: 'gravel' }] },
  { id: 'curbs', cat: 'road', name: 'Curb stones, pallet of 16', info: 'Concrete · 2 for a metre of street', note: 'Set on raked gravel, both sides', price: 40, load: 3,
    cargo: () => [{ kind: 'curbs' }] },
  { id: 'asphalt', cat: 'road', name: 'Asphalt mix, big bag', info: 'Enough for 3 m of street and its sidewalks', note: 'Spread it, rake it, roll it flat', price: 30, load: 2,
    cargo: () => [{ kind: 'asphalt' }] },
  { id: 'shovel', cat: 'road', name: 'Shovel', info: 'Steel blade, ash handle', note: 'Digs the strip, spreads gravel and asphalt', price: 6, load: 0,
    cargo: () => [{ kind: 'rtool', tool: 'shovel' }] },
  { id: 'rake', cat: 'road', name: 'Rake', info: '42 cm, steel teeth', note: 'Levels gravel and asphalt', price: 5, load: 0,
    cargo: () => [{ kind: 'rtool', tool: 'rake' }] },
  { id: 'hroller', cat: 'road', name: 'Hand roller', info: 'Steel drum, 60 kg', note: 'Hold click and walk over the asphalt', price: 45, load: 1,
    cargo: () => [{ kind: 'rtool', tool: 'roller' }] },
  { id: 'lamp', cat: 'road', name: 'Street lamp', info: '5.5 m pole with an arm', note: 'Set it on a finished sidewalk · power $1 a night', price: 60, load: 2,
    cargo: () => [{ kind: 'lamp' }] },
  { id: 'sign', cat: 'road', name: 'Road sign', info: 'Pole and plate: you pick which sign when you set it', note: 'Street name, stop, give way, 30, crossing…', price: 15, load: 1,
    cargo: () => [{ kind: 'sign' }] },
  { id: 'zebra', cat: 'road', name: 'Road paint for a crossing', info: 'White paint and a stencil', note: 'One zebra crossing on a finished street', price: 12, load: 1,
    cargo: () => [{ kind: 'zebra' }] },
  { id: 'stone', cat: 'soon', name: 'Field stone', info: 'For walls and paths', price: 0 },
  { id: 'iron', cat: 'soon', name: 'Iron ore', info: 'Melt it into steel', price: 0 },
  { id: 'eps', cat: 'soon', name: 'Polystyrene boards', info: 'Keeps houses warm', price: 0 },
];
export const TRUCK_LOAD = 12;

// ───────── orders ─────────

export const orders = [];
let nextOrder = 101;
const listeners = new Set();
export const onOrdersChange = (fn) => listeners.add(fn);
const changed = () => listeners.forEach((fn) => fn());

// A cart key is the item's id, or "id:variant" for one with a choice (paint: "paint:cream").
export const itemOf = (key) => CATALOG.find((c) => c.id === key.split(':')[0]);
export const lineName = (item, variant) => (variant ? `${item.name}, ${variant}` : item.name);

// cart: Map(key → qty)
export function placeOrder(cart) {
  const lines = [...cart].filter(([, q]) => q > 0).map(([key, qty]) => ({ item: itemOf(key), qty, variant: key.split(':')[1] }));
  const order = {
    id: nextOrder++, lines, status: 'packing', progress: 0, t: 0,
    total: lines.reduce((s, l) => s + l.item.price * l.qty, 0),
    count: lines.reduce((s, l) => s + l.qty, 0),
  };
  orders.unshift(order);
  changed();
  return order;
}

const PACKING_TIME = 4;
export function updateDelivery(dt) {
  for (const o of orders) {
    if (o.status !== 'packing') continue;
    // creative: it's there at once, in front of you
    if (game.mode?.instant && !truck.busy) { truck.dropNow(o); continue; }
    o.t += dt;
    o.progress = Math.min(0.15, (o.t / PACKING_TIME) * 0.15);
    if (o.t >= PACKING_TIME && !truck.busy) {
      truck.start(o);
      o.status = 'driving';
      changed();
      game.hud.toast(`🚚 Order #${o.id} is on the way`);
    }
  }
  truck.update(dt);
  for (const c of crates) c.sync();
}

// ───────── delivered nail boxes ─────────

const crates = new Set();
class NailCrate {
  constructor(pos, quat) {
    this.mesh = crateMesh();
    game.scene.add(this.mesh);
    this.body = new CANNON.Body({ mass: 6, material: MAT.wood, collisionFilterGroup: GROUP.PIECE, collisionFilterMask: MASK.ALL, allowSleep: true });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(0.2, 0.09, 0.14)), new CANNON.Vec3(0, 0.09, 0));
    this.body.position.copy(pos);
    this.body.quaternion.copy(quat);
    this.body.nailCrate = this;
    world.addBody(this.body);
    crates.add(this);
  }
  sync() {
    this.mesh.position.copy(this.body.interpolatedPosition);
    this.mesh.quaternion.copy(this.body.interpolatedQuaternion);
  }
  take() {
    world.removeBody(this.body);
    game.scene.remove(this.mesh);
    crates.delete(this);
  }
}

function crateMesh() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ map: TEX.grain, color: 0xb59468, roughness: 0.85 });
  const box = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  box(0.4, 0.02, 0.28, 0, 0.01, 0);
  for (const s of [-1, 1]) { box(0.4, 0.16, 0.02, 0, 0.09, s * 0.13); box(0.02, 0.16, 0.26, s * 0.19, 0.09, 0); }
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.09), new THREE.MeshStandardMaterial({ map: labelTexture('NAILS · 100'), roughness: 0.9 }));
  label.position.set(0, 0.09, 0.141);
  g.add(label);
  const nail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.22), new THREE.MeshStandardMaterial({ color: 0x9da3a8, metalness: 0.35, roughness: 0.5 }));
  nail.position.y = 0.15;
  g.add(nail);
  return g;
}

function labelTexture(text, bg = '#efe6cf', fg = '#3a2a1a', w = 256, h = 100) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = fg;
  x.font = `600 ${Math.round(h * 0.42)}px Outfit, system-ui, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ───────── the road as one long drive: in, round the loop, out ─────────

const PATH = [...road.approach, ...road.loop.slice(1), ...road.approach.slice().reverse().slice(1)];
const CUM = [0];
for (let i = 1; i < PATH.length; i++) CUM.push(CUM[i - 1] + Math.hypot(PATH[i].x - PATH[i - 1].x, PATH[i].z - PATH[i - 1].z));
const LEN = CUM[CUM.length - 1];
const LOOP_START = CUM[road.approach.length - 1];
const LOOP_END = CUM[road.approach.length - 1 + road.loop.length - 1];
const S_DROP = CUM[road.approach.length - 1 + Math.round((road.loop.length - 1) / 2)]; // west side of the loop

function pathAt(s, out) {
  s = Math.max(0, Math.min(LEN - 0.001, s));
  let lo = 0, hi = CUM.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (CUM[m] <= s) lo = m; else hi = m; }
  const t = (s - CUM[lo]) / (CUM[hi] - CUM[lo] || 1);
  out.x = PATH[lo].x + (PATH[hi].x - PATH[lo].x) * t;
  out.z = PATH[lo].z + (PATH[hi].z - PATH[lo].z) * t;
  return out;
}

// ───────── the truck ─────────

const FRONT = 2.05, REAR = -2.15; // axle positions along the truck (forward = +x)
const BED_PIVOT = new THREE.Vector3(-3.3, 1.08, 0);
const TILT = 0.9;

function buildTruck() {
  const paint = new THREE.MeshStandardMaterial({ color: 0xe0a32e, roughness: 0.55, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa1a7, roughness: 0.4, metalness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d2c3a, roughness: 0.15, metalness: 0.2 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.95 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xfff0c0, emissiveIntensity: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb3261e, emissive: 0x801010, emissiveIntensity: 0.5 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a07a, roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x3b6a8f, roughness: 0.9 });
  const bedWood = new THREE.MeshStandardMaterial({ map: TEX.grain, color: 0x9c7a55, roughness: 0.85 });

  const g = new THREE.Group();
  const add = (parent, geo, mat, x, y, z, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(0, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  // chassis + cab
  add(g, B(6.1, 0.28, 1.5), dark, 0, 0.78, 0);
  add(g, B(1.55, 1.3, 2.2), paint, 2.35, 1.7, 0);         // cab
  add(g, B(1.45, 0.12, 2.1), paint, 2.32, 2.4, 0);        // roof lip
  add(g, B(0.75, 0.72, 2.12), paint, 3.45, 1.28, 0);      // hood
  add(g, B(0.18, 0.28, 2.36), dark, 3.9, 0.9, 0);         // bumper
  add(g, B(0.04, 0.42, 1.2), dark, 3.84, 1.3, 0);         // grille
  for (const z of [-0.78, 0.78]) {
    add(g, B(0.05, 0.16, 0.26), lamp, 3.84, 1.38, z);
    add(g, B(0.05, 0.12, 0.2), red, -3.06, 0.86, z * 1.1);
    add(g, B(0.9, 0.12, 0.45), dark, 2.05, 1.0, z * 1.32);  // fender
  }
  add(g, B(0.04, 0.62, 1.9), glass, 3.13, 2.02, 0, 0, -0.18);   // windshield
  for (const s of [-1, 1]) add(g, B(0.9, 0.55, 0.04), glass, 2.45, 2.03, s * 1.105);
  // doors with the company name
  const logo = new THREE.MeshStandardMaterial({ map: labelTexture('WOODLINE', '#e0a32e', '#3b2410', 512, 120), roughness: 0.6 });
  for (const s of [-1, 1]) {
    const p = add(g, new THREE.PlaneGeometry(1.1, 0.26), logo, 2.35, 1.42, s * 1.106, s > 0 ? 0 : Math.PI);
    p.castShadow = false;
  }
  add(g, new THREE.CylinderGeometry(0.06, 0.06, 1.4, 10), metal, 1.5, 2.0, 0.95);   // exhaust
  // driver
  add(g, B(0.42, 0.55, 0.45), shirt, 2.3, 1.75, -0.45);
  add(g, new THREE.SphereGeometry(0.15, 12, 10), skin, 2.32, 2.18, -0.45);

  // wheels
  const wheels = [];
  const wGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.34, 18).rotateX(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.36, 12).rotateX(Math.PI / 2);
  for (const x of [FRONT, REAR + 0.5, REAR - 0.5]) {
    for (const z of [-0.98, 0.98]) {
      const w = new THREE.Group();
      w.position.set(x, 0.46, z);
      add(w, wGeo, tyre, 0, 0, 0);
      add(w, hubGeo, metal, 0, 0, 0);
      add(w, B(0.06, 0.3, 0.37), dark, 0, 0, 0);
      g.add(w);
      wheels.push(w);
    }
  }

  // tipping bed, hinged at the very back
  const bed = new THREE.Group();
  bed.position.copy(BED_PIVOT);
  add(bed, B(4.6, 0.12, 2.3), bedWood, 2.3, 0, 0);
  for (const s of [-1, 1]) add(bed, B(4.6, 0.36, 0.06), paint, 2.3, 0.24, s * 1.13);
  add(bed, B(0.08, 0.95, 2.3), paint, 4.56, 0.47, 0);
  add(bed, B(4.6, 0.1, 0.25), dark, 2.3, -0.11, 0.55);
  add(bed, B(4.6, 0.1, 0.25), dark, 2.3, -0.11, -0.55);
  const cargo = new THREE.Group();
  bed.add(cargo);
  g.add(bed);

  return { g, bed, wheels, cargo };
}

function kinematicBody(shapes) {
  const b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: MAT.steel, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: GROUP.PIECE | GROUP.PLAYER | GROUP.CAR });
  for (const [half, off] of shapes) b.addShape(new CANNON.Box(new CANNON.Vec3(...half)), new CANNON.Vec3(...off));
  return b;
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _a = { x: 0, z: 0 }, _b = { x: 0, z: 0 };

// Move a kinematic body to a pose, giving it the velocity that gets it there.
function drive(body, pos, quat, dt) {
  if (dt > 0) {
    body.velocity.set((pos.x - body.position.x) / dt, (pos.y - body.position.y) / dt, (pos.z - body.position.z) / dt);
    const dq = new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w).mult(body.quaternion.conjugate());
    if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
    const s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
    const ang = 2 * Math.acos(Math.min(1, dq.w));
    if (s > 1e-5) body.angularVelocity.set((dq.x / s) * ang / dt, (dq.y / s) * ang / dt, (dq.z / s) * ang / dt);
    else body.angularVelocity.setZero();
  }
  body.position.set(pos.x, pos.y, pos.z);
  body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
}

const truck = {
  busy: false,
  init() {
    const t = buildTruck();
    Object.assign(this, t);
    this.g.visible = false;
    game.scene.add(this.g);
    this.body = kinematicBody([[[1.0, 0.75, 1.1], [2.6, 1.6, 0]], [[2.95, 0.2, 0.8], [0.08, 0.78, 0]]]); // frame stops short of the hinge so loads fall clear
    this.bedBody = kinematicBody([[[2.3, 0.06, 1.15], [2.3, 0, 0]], [[2.3, 0.18, 0.03], [2.3, 0.24, 1.13]], [[2.3, 0.18, 0.03], [2.3, 0.24, -1.13]], [[0.04, 0.47, 1.15], [4.56, 0.47, 0]]]);
  },

  start(order) {
    this.order = order;
    this.busy = true;
    this.s = 0;
    this.v = 0;
    this.state = 'arrive';
    this.t = 0;
    this.tilt = 0;
    this.honked = false;
    this.unloaded = [];
    this.loadCargo(order);
    this.g.visible = true;
    this.place(0);
    world.addBody(this.body);
    world.addBody(this.bedBody);
  },

  // Stack the order on the bed as plain meshes; they become real when tipped off.
  loadCargo(order) {
    this.cargo.clear();
    const items = order.lines.flatMap((l) => Array.from({ length: l.qty }, () => l.item.cargo(l.variant)).flat());
    const logs = items.filter((i) => i.kind === 'log').sort((a, b) => b.r - a.r);
    let z = -1.05, y = 0.06, rowH = 0;
    for (const it of logs) {
      if (z + it.r * 2 > 1.05) { z = -1.05; y += rowH + 0.01; rowH = 0; }
      const m = new THREE.Mesh(logGeometry(it.r, it.len), [woodMats.bark, woodMats.end, woodMats.end]);
      m.rotation.z = Math.PI / 2;
      m.position.set(Math.min(2.2, 4.45 - it.len / 2), y + it.r, z + it.r);
      m.castShadow = true;
      m.userData.cargo = it;
      this.cargo.add(m);
      z += it.r * 2 + 0.01;
      rowH = Math.max(rowH, it.r * 2);
    }
    let k = 0;
    for (const it of items.filter((i) => i.kind === 'nails')) {
      const m = crateMesh();
      m.position.set(4.25 - Math.floor(k / 3) * 0.45, y + rowH + 0.01, -0.7 + (k % 3) * 0.7);
      m.userData.cargo = it;
      this.cargo.add(m);
      k++;
    }
    // brick pallets in a row down the middle, mortar bags behind them
    const top = y + rowH + 0.01;
    let px = 3.85;
    for (const it of items.filter((i) => i.kind === 'pallet')) {
      const m = cargoMesh(it);
      m.position.set(px, top, 0);
      m.userData.cargo = it;
      this.cargo.add(m);
      px -= 1.1;
    }
    // door and window crates, then roofing sheets, stacked flat at the back
    let stack = top;
    for (const it of items.filter((i) => i.kind === 'door' || i.kind === 'window')) {
      const m = cargoMesh(it);
      m.position.set(1.3, stack, 0);
      m.userData.cargo = it;
      this.cargo.add(m);
      stack += 0.17;
    }
    for (const it of items.filter((i) => i.kind === 'sheet')) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.012, 1.0), new THREE.MeshStandardMaterial({ color: 0x8a3428, roughness: 0.55, metalness: 0.25 }));
      m.position.set(1.3, stack + 0.007, 0);
      m.castShadow = true;
      m.userData.cargo = it;
      this.cargo.add(m);
      stack += 0.016;
    }
    // paint buckets, plaster bags and tool boxes: in rows beside the cab
    let q = 0;
    for (const it of items.filter((i) => i.kind === 'bucket' || i.kind === 'plaster' || i.kind === 'tool')) {
      const m = thingMesh(it);
      m.position.set(3.0 - Math.floor(q / 4) * 0.62, top + 0.01, -0.8 + (q % 4) * 0.53);
      m.userData.cargo = it;
      this.cargo.add(m);
      q++;
    }
    // street things: big bags, curb pallets, tools and crates, in a row on top of everything else
    // (two rows from the front of the bed back; a lamp's long crate lies along it)
    const roadTop = top + (items.some((i) => i.kind !== 'log' && !STREET_KINDS.includes(i.kind)) ? 0.45 : 0);
    const rowX = [4.05, 4.05], rowY = [roadTop, roadTop];
    let r = 0;
    for (const it of items.filter((i) => STREET_KINDS.includes(i.kind) && i.tool !== 'shovel' && i.tool !== 'rake')) {
      const m = streetThingMesh(it), row = r++ % 2, len = it.kind === 'lamp' ? 2.65 : 1.0;
      if (rowX[row] - len < 0) { rowX[row] = 4.05; rowY[row] += 0.85; } // (a second layer on top)
      m.position.set(rowX[row] - len / 2, rowY[row] + 0.01, row ? 0.55 : -0.55);
      rowX[row] -= len + 0.05;
      m.userData.cargo = it;
      this.cargo.add(m);
    }
    for (const it of items.filter((i) => i.tool === 'shovel' || i.tool === 'rake')) {
      const m = streetThingMesh(it);
      m.position.set(2.2, roadTop + 0.9 + r * 0.05, (r % 2 ? 0.3 : -0.3));
      m.userData.cargo = it;
      this.cargo.add(m);
      r++;
    }
    let j = 0;
    for (const it of items.filter((i) => i.kind === 'mortar')) {
      const m = cargoMesh(it);
      m.position.set(px + 0.2 - Math.floor(j / 3) * 0.5, top + Math.floor(j / 9) * 0.13, -0.7 + (j % 3) * 0.7);
      m.rotation.y = Math.PI / 2;
      m.userData.cargo = it;
      this.cargo.add(m);
      j++;
    }
  },

  // Turn the meshes on the bed into real physics pieces.
  unloadCargo() {
    this.g.updateMatrixWorld(true);
    this.unloaded = [];
    for (const m of [...this.cargo.children]) {
      const it = m.userData.cargo;
      m.getWorldPosition(_p);
      m.getWorldQuaternion(_q);
      if (it.kind === 'log') this.unloaded.push(new Piece('log', { r: it.r, len: it.len, species: it.species }, _p, _q));
      else if (it.kind === 'sheet') {
        // a flat sheet on the bed: the Piece's length runs along its local Y, so lay that along the bed
        const q = _q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, Math.PI / 2)));
        this.unloaded.push(new Piece('sheet', { w: 1.0, t: 0.012, len: 2.0 }, _p, q));
      } else if (STREET_KINDS.includes(it.kind)) this.unloaded.push(spawnStreetThing(it, _p, _q));
      else if (it.kind === 'bucket' || it.kind === 'plaster' || it.kind === 'tool') this.unloaded.push(spawnPaintThing(it, _p, _q));
      else if (it.kind !== 'nails') this.unloaded.push(spawnCargo(it, _p, _q));
      else this.unloaded.push(new NailCrate(new CANNON.Vec3(_p.x, _p.y, _p.z), new CANNON.Quaternion(_q.x, _q.y, _q.z, _q.w)));
    }
    this.cargo.clear();
  },

  // Creative: no truck, no wait. The load appears a few metres in front of you, across your view,
  // and drops the last bit onto the ground.
  dropNow(order) {
    const pl = game.player, yaw = pl.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // where you look
    const cx = pl.body.position.x + fx * 4.5, cz = pl.body.position.z + fz * 4.5;
    this.g.rotation.set(0, yaw, 0);                    // the truck's +x (along the bed) = your right
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    // (the load sits from x −3.1 to +1.2 along the truck: shift so it's centred on that spot)
    this.g.position.set(cx + rx * 0.95, terrainHeight(cx, cz) - 0.85, cz + rz * 0.95);
    this.tilt = 0;
    this.bed.rotation.z = 0;
    this.loadCargo(order);
    this.unloadCargo();
    this.unloaded = [];
    order.status = 'delivered';
    order.progress = 1;
    changed();
    audio.drop?.(1);
    game.hud.toast(`📦 Order #${order.id} is here`);
  },

  // Unloaded things whose middle is still above the bed.
  onBed() {
    return this.unloaded.filter((p) => {
      if (p.dead || !p.body.world) return false;
      const l = this.bedBody.pointToLocalFrame(p.body.position);
      return l.x > -0.25 && l.x < 4.8 && l.y > -0.3 && l.y < 1.6 && Math.abs(l.z) < 1.3;
    });
  },

  place(dt) {
    const s = this.s;
    pathAt(s + FRONT, _a);
    pathAt(s + REAR, _b);
    const hf = terrainHeight(_a.x, _a.z), hr = terrainHeight(_b.x, _b.z);
    const dx = _a.x - _b.x, dz = _a.z - _b.z;
    const yaw = Math.atan2(-dz, dx);
    const pitch = Math.atan2(hf - hr, FRONT - REAR);
    // side tilt from the ground under the left and right wheels
    const nx = -dz / Math.hypot(dx, dz), nz = dx / Math.hypot(dx, dz);
    const cx = (_a.x + _b.x) / 2, cz = (_a.z + _b.z) / 2;
    const roll = Math.atan2(terrainHeight(cx - nx, cz - nz) - terrainHeight(cx + nx, cz + nz), 2) * 0.6;
    this.g.position.set(cx - (dx / (FRONT - REAR)) * ((FRONT + REAR) / 2), (hf + hr) / 2, cz - (dz / (FRONT - REAR)) * ((FRONT + REAR) / 2));
    this.g.rotation.set(roll, yaw, pitch, 'YZX');
    this.bed.rotation.z = this.tilt;
    this.g.updateMatrixWorld(true);

    drive(this.body, this.g.position, this.g.quaternion, dt);
    this.bed.getWorldPosition(_p);
    this.bed.getWorldQuaternion(_q);
    drive(this.bedBody, _p, _q, dt);
  },

  update(dt) {
    if (!this.busy) { audio.engine(0, 0); return; }
    const o = this.order;
    this.t += dt;
    if (this.state === 'arrive' || this.state === 'leave') {
      const target = this.state === 'arrive' ? S_DROP : LEN;
      const inLoop = this.s > LOOP_START - 6 && this.s < LOOP_END + 4;
      let vmax = inLoop ? 3.6 : 8.5;
      if (this.state === 'arrive') vmax = Math.min(vmax, Math.sqrt(2 * 1.6 * Math.max(0, target - this.s)) + 0.15);
      this.v += Math.max(-4, Math.min(2.2, (vmax - this.v) * 2)) * dt;
      this.s += this.v * dt;
      for (const w of this.wheels) w.rotation.z -= (this.v * dt) / 0.46;
      if (this.state === 'arrive') {
        o.progress = 0.15 + 0.7 * Math.min(1, this.s / S_DROP);
        o.eta = Math.max(0, (S_DROP - this.s) / 7 + 1);
        if (this.s >= S_DROP - 0.05) {
          this.s = S_DROP; this.v = 0;
          this.state = 'park'; this.t = 0;
          audio.brake();
        }
      } else if (this.s >= LEN - 0.1) {
        this.busy = false;
        this.g.visible = false;
        world.removeBody(this.body);
        world.removeBody(this.bedBody);
      }
    } else if (this.state === 'park') {
      if (!this.honked && this.t > 0.4) { this.honked = true; audio.horn(); }
      if (this.t > 1.4) {
        this.state = 'tipUp'; this.t = 0;
        o.status = 'unloading'; changed();
        this.unloadCargo();
        audio.hydraulic(true);
      }
    } else if (this.state === 'tipUp') {
      this.tilt = TILT * Math.min(1, this.t / 2.6);
      o.progress = 0.85 + 0.1 * (this.tilt / TILT);
      if (this.t > 2.6) { this.state = 'hold'; this.t = 0; audio.hydraulic(false); }
    } else if (this.state === 'hold') {
      // keep the bed up until everything is off (or give up after a while)
      const left = this.onBed();
      if ((this.t > 1.6 && !left.length) || this.t > 7) { this.state = 'tipDown'; this.t = 0; audio.hydraulic(true); }
    } else if (this.state === 'tipDown') {
      this.tilt = TILT * Math.max(0, 1 - this.t / 1.8);
      if (this.t > 1.8) {
        // anything that still didn't come off, the driver hops out and drops behind the truck
        const back = this.bedBody.quaternion.vmult(new CANNON.Vec3(-1, 0, 0));
        this.onBed().forEach((p, i) => {
          const at = this.bedBody.position.vadd(back.scale(1.3 + i * 0.5));
          p.body.position.set(at.x, terrainHeight(at.x, at.z) + 0.4, at.z);
          p.body.velocity.setZero();
          p.body.angularVelocity.setZero();
        });
        this.state = 'leave'; this.t = 0;
        audio.hydraulic(false);
        o.status = 'delivered'; o.progress = 1; changed();
        game.hud.toast(`📦 Order #${o.id} delivered at the end of the road`);
        particles.emit('dirt', this.g.position, new THREE.Vector3(0, 1, 0), 10);
      }
    }
    this.place(dt);

    // Logs that slid back but got propped on the ground (or on you) would lie
    // back down on the bed. Drag anything still on the bed off the back.
    if ((this.state === 'tipUp' && this.tilt > 0.5) || this.state === 'hold') {
      const back = this.bedBody.quaternion.vmult(new CANNON.Vec3(-2.2, 0, 0));
      for (const p of this.onBed()) {
        p.body.velocity.x = back.x;
        p.body.velocity.z = back.z;
        p.body.velocity.y = Math.min(p.body.velocity.y, back.y);
      }
    }

    // Sleeping bodies don't notice a kinematic bed moving away; keep the load awake.
    if (this.state !== 'arrive' && this.state !== 'park' && this.s < S_DROP + 25) {
      for (const p of this.unloaded) p.body.wakeUp();
    }

    // engine sound fades with distance
    const d = this.g.position.distanceTo(game.camera.position);
    const loud = (this.state === 'arrive' || this.state === 'leave' ? 1 : 0.6) / (1 + d / 9);
    audio.engine(loud, this.v);
  },
};

export function initDelivery() {
  truck.init();
}

// ───────── saving and loading ─────────

const r4 = (v) => Math.round(v * 1e4) / 1e4, r5 = (v) => Math.round(v * 1e5) / 1e5;

// An order on the way starts its trip again after a load (the truck isn't saved); one that was
// being tipped off is already lying on the ground (saved with the other wood), so it's delivered.
export function saveDelivery() {
  return {
    next: nextOrder,
    orders: orders.slice(0, 30).map((o) => ({ id: o.id, lines: o.lines.map((l) => (l.variant ? [l.item.id, l.qty, l.variant] : [l.item.id, l.qty])), status: o.status, total: o.total, count: o.count })),
    crates: [...crates].map((c) => ({ pos: [r4(c.body.position.x), r4(c.body.position.y), r4(c.body.position.z)], quat: [r5(c.body.quaternion.x), r5(c.body.quaternion.y), r5(c.body.quaternion.z), r5(c.body.quaternion.w)] })),
  };
}

export function loadDelivery(d) {
  nextOrder = d.next;
  for (const s of d.orders) {
    const lines = s.lines.map(([id, qty, variant]) => ({ item: CATALOG.find((c) => c.id === id), qty, variant })).filter((l) => l.item);
    const coming = s.status === 'packing' || s.status === 'driving';
    orders.push({ id: s.id, lines, status: coming ? 'packing' : 'delivered', progress: coming ? 0 : 1, t: 0, total: s.total, count: s.count });
  }
  for (const s of d.crates) {
    const c = new NailCrate(new CANNON.Vec3(...s.pos), new CANNON.Quaternion(...s.quat));
    c.body.sleep();
    c.mesh.position.copy(c.body.position);
    c.mesh.quaternion.copy(c.body.quaternion);
  }
  changed();
}

export const deliveryDebug = { truck, S_DROP, LEN };
