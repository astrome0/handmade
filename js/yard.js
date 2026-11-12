// The Woodline timber yard, far out in the forest at the end of the dirt track.
// Bring wood (by hand, or in the pickup's bed), leave it in the marked area, and
// the buyer pays for it: planks more than logs, oak more than pine.
import * as THREE from 'three';
import { world, CANNON, GROUP, MAT } from './physics.js';
import { terrainHeight, YARD, road } from './terrain.js';
import { game } from './game.js';
import { TEX } from './textures.js';
import { audio } from './audio.js';
import { particles } from './particles.js';
import { pieces, logGeometry, sheetGeometry, woodMats } from './items.js';
import { personMesh } from './workers.js';
import { woodValue, earn, record, PRICES } from './money.js';

const C = new THREE.Vector3();
// the drop zone, axis-aligned in the world: half sizes along x and z
const ZONE = { x: 0, z: 0, hw: 4, hd: 3 };
let buyer = null;

function label(lines, w = 512, h = 256, bg = '#e9dcc0', fg = '#3a2614', sizes = [70, 34]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.strokeStyle = '#6b4a2c'; x.lineWidth = 10; x.strokeRect(8, 8, w - 16, h - 16);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  const gap = h / (lines.length + 1);
  lines.forEach((t, i) => {
    x.font = i === 0 ? `600 ${sizes[0]}px Fraunces, Georgia, serif` : `500 ${sizes[1]}px Outfit, system-ui, sans-serif`;
    x.fillText(t, w / 2, gap * (i + 1) + (i === 0 ? -6 : 0));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function staticBox(hx, hy, hz, x, y, z, yaw = 0) {
  const b = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: MAT.wood, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: 63 });
  b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
  b.position.set(x, y, z);
  b.quaternion.setFromEuler(0, yaw, 0);
  world.addBody(b);
  return b;
}

// a sign board on two posts, readable from both sides
function sign(scene, x, z, yaw, front, back = front, size = [1.9, 0.95], postH = 2.2) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ map: TEX.grain, color: 0x8a6440, roughness: 0.9 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, postH, 0.12), wood);
    post.position.set(s * (size[0] / 2 - 0.1), postH / 2, 0);
    post.castShadow = true;
    g.add(post);
  }
  const mf = new THREE.MeshStandardMaterial({ map: front, roughness: 0.85 }), mb = new THREE.MeshStandardMaterial({ map: back, roughness: 0.85 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], 0.06), [wood, wood, wood, wood, mf, mb]);
  board.position.y = postH - size[1] / 2 - 0.05;
  board.castShadow = true;
  g.add(board);
  g.position.set(x, terrainHeight(x, z), z);
  g.rotation.y = yaw;
  scene.add(g);
  staticBox(size[0] / 2, postH / 2, 0.08, x, terrainHeight(x, z) + postH / 2, z, yaw);
  return g;
}

export function initYard(scene) {
  C.set(YARD.x, YARD.h, YARD.z);
  const wood = new THREE.MeshStandardMaterial({ map: TEX.grain, color: 0xa47a52, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ map: TEX.grain, color: 0x6e5034, roughness: 0.9 });
  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(C.x + x, C.y + y, C.z + z);
    m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    return m;
  };

  // ── the drop zone: sawdust ground, timber curbs on three sides, open towards the track ──
  ZONE.x = C.x + 2; ZONE.z = C.z;
  const dust = new THREE.MeshStandardMaterial({ color: 0xc9a774, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const floor = add(new THREE.PlaneGeometry(ZONE.hw * 2, ZONE.hd * 2).rotateX(-Math.PI / 2), dust, 2, 0.02, 0);
  floor.castShadow = false;
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(ZONE.hw * 2, 0.16, 0.2), dark, 2, 0.08, s * (ZONE.hd + 0.1));
    staticBox(ZONE.hw, 0.08, 0.1, ZONE.x, C.y + 0.08, ZONE.z + s * (ZONE.hd + 0.1));
  }
  add(new THREE.BoxGeometry(0.2, 0.16, ZONE.hd * 2 + 0.4), dark, 2 - ZONE.hw - 0.1, 0.08, 0);
  staticBox(0.1, 0.08, ZONE.hd + 0.2, ZONE.x - ZONE.hw - 0.1, C.y + 0.08, ZONE.z);
  // painted on the ground at the back of the zone
  const paint = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.9).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
    map: label(['DROP WOOD HERE'], 512, 160, '#c9a774', '#5a3d22', [64, 30]), transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }));
  paint.geometry.rotateY(-Math.PI / 2); // reads from the open side (the track)
  paint.position.set(ZONE.x - ZONE.hw + 0.8, C.y + 0.03, ZONE.z);
  scene.add(paint);

  // ── the office: a plank cabin with a door, a window and a tin roof ──
  const ox = -4, oz = -7.5, W = 5, D = 3.2, H = 2.5;
  add(new THREE.BoxGeometry(W, H, D), wood, ox, H / 2, oz);
  add(new THREE.BoxGeometry(0.9, 2.0, 0.06), dark, ox + 1.2, 1.0, oz + D / 2 + 0.03);                // door
  add(new THREE.BoxGeometry(1.2, 0.8, 0.05), new THREE.MeshStandardMaterial({ color: 0x8fb3c4, roughness: 0.1, metalness: 0.3 }), ox - 1.0, 1.5, oz + D / 2 + 0.03);
  add(new THREE.BoxGeometry(1.32, 0.08, 0.1), dark, ox - 1.0, 1.06, oz + D / 2 + 0.06);              // sill
  // The roof: a wall plate on top of the walls, rafters on the plate, two rows of corrugated sheets on
  // the rafters (the upper row laps over the lower one), boards along the edges, and a porch over the
  // door held up by two posts with braces. One slope, high at the back; "g" sits on the wall top.
  {
    const g = new THREE.Group();
    g.position.set(C.x + ox, C.y + H, C.z + oz);
    scene.add(g);
    const put = (p, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; p.add(m); return m; };
    const t = 0.2, a = Math.atan(t), PL = 0.12;
    const z0 = -D / 2 - 0.35, z1 = D / 2 + 0.9, ln = (z1 - z0) / Math.cos(a), zc = (z0 + z1) / 2;
    const under = (z) => PL + t * (D / 2 - z); // the rafters' underside above the wall top
    // wall plate all round, and the wall carried up under the high side (back band + two triangles)
    for (const s of [-1, 1]) {
      put(g, new THREE.BoxGeometry(W + 0.1, PL, 0.14), dark, 0, PL / 2, s * (D / 2 - 0.02));
      put(g, new THREE.BoxGeometry(0.14, PL, D), dark, s * (W / 2 - 0.02), PL / 2, 0);
    }
    const back = under(-D / 2) - 0.02;
    put(g, new THREE.BoxGeometry(W, back, 0.1), wood, 0, back / 2, -D / 2 + 0.05);
    const tri = new THREE.Shape();
    tri.moveTo(-D / 2, 0); tri.lineTo(D / 2, 0); tri.lineTo(D / 2, under(D / 2) - 0.02); tri.lineTo(-D / 2, back); tri.closePath();
    for (const s of [-1, 1]) {
      const gm = put(g, new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false }), wood, s < 0 ? -W / 2 + 0.1 : W / 2, 0, 0);
      gm.rotation.y = -Math.PI / 2; // shape x → world z, extrusion goes towards −x
    }
    // the sloped part: S has z down the slope, y out of the roof, origin under the middle of it
    const S = new THREE.Group();
    S.position.set(0, under(zc), zc);
    S.rotation.x = a;
    g.add(S);
    const nr = 7;
    for (let i = 0; i < nr; i++) put(S, new THREE.BoxGeometry(0.06, 0.12, ln), wood, (W + 0.3) * (i / (nr - 1) - 0.5), 0.06, 0);
    const cols = Math.ceil((W + 0.6) / 0.95), sw = (W + 0.6) / cols, rowL = ln / 2 + 0.08;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < cols; c++) {
        const sh = put(S, sheetGeometry(sw, 0.012, rowL).rotateX(Math.PI / 2), [woodMats.sheetEdge, woodMats.sheetEdge, woodMats.sheetEdge, woodMats.sheetEdge, woodMats.sheet, woodMats.sheet],
          -(W + 0.6) / 2 + sw * (c + 0.5), 0.126 + r * 0.014 + (c % 2) * 0.003, (r ? -1 : 1) * (ln / 4 - 0.04));
        sh.rotateZ((Math.random() - 0.5) * 0.006);
      }
    }
    for (const s of [-1, 1]) put(S, new THREE.BoxGeometry(0.04, 0.2, ln), dark, s * (W / 2 + 0.31), 0.1, 0); // barge boards
    put(S, new THREE.BoxGeometry(W + 0.7, 0.2, 0.04), dark, 0, 0.07, ln / 2);                                // fascia
    put(S, new THREE.BoxGeometry(W + 0.7, 0.05, 0.4), dark, 0, 0.165, -ln / 2 + 0.2);                       // cap at the high edge
    // porch: a beam under the front edge on two posts, each braced to the beam
    const bz = D / 2 + 0.8, by = under(bz) - 0.07, ph = H - 0.18;
    put(g, new THREE.BoxGeometry(W + 0.3, 0.14, 0.14), dark, 0, by, bz);
    for (const s of [-1, 1]) {
      const px = s * (W / 2 - 0.15);
      put(g, new THREE.BoxGeometry(0.13, ph, 0.13), dark, px, -0.18 - ph / 2, bz);
      const br = put(g, new THREE.BoxGeometry(0.07, 0.92, 0.07), dark, px - s * 0.33, -0.5, bz);
      br.rotation.z = s * Math.PI / 4;
      staticBox(0.065, ph / 2, 0.065, C.x + ox + px, C.y + ph / 2, C.z + oz + bz);
    }
  }
  const officeSign = add(new THREE.PlaneGeometry(2.2, 0.55), new THREE.MeshStandardMaterial({ map: label(['OFFICE · WE BUY WOOD'], 512, 128, '#e9dcc0', '#3a2614', [44, 20]), roughness: 0.8 }), ox, H - 0.3, oz + D / 2 + 0.04);
  officeSign.castShadow = false;
  staticBox(W / 2, H / 2 + 0.2, D / 2, C.x + ox, C.y + H / 2, C.z + oz);

  // ── stock: piles of logs and a stack of planks ──
  const bark = [woodMats.bark, woodMats.end, woodMats.end];
  const pile = (px, pz) => {
    const rows = [5, 4, 3, 2], r = 0.17, len = 4;
    rows.forEach((n, row) => {
      for (let i = 0; i < n; i++) {
        const m = add(logGeometry(r * (0.9 + Math.random() * 0.2), len + Math.random() * 0.3), bark, px + (Math.random() - 0.5) * 0.3, r + row * r * 1.72, pz + (i - (n - 1) / 2) * r * 2.05);
        m.rotation.z = Math.PI / 2;
      }
    });
    staticBox(len / 2, r * 3.6, r * 5.2, C.x + px, C.y + r * 3.6, C.z + pz);
  };
  pile(-7.5, 3.5);
  pile(-7.5, 7.8);
  const planks = new THREE.MeshStandardMaterial({ map: TEX.grain, color: 0xd8b98a, roughness: 0.8 });
  for (let layer = 0; layer < 8; layer++) {
    add(new THREE.BoxGeometry(3.2, 0.05, 1.2), planks, 3.5, 0.18 + layer * 0.08, -7.4);
    if (layer % 2) for (const sx of [-1.2, 0, 1.2]) add(new THREE.BoxGeometry(0.06, 0.03, 1.2), dark, 3.5 + sx, 0.21 + layer * 0.08, -7.4);
  }
  add(new THREE.BoxGeometry(3.2, 0.14, 1.0), dark, 3.5, 0.07, -7.4);
  staticBox(1.6, 0.4, 0.6, C.x + 3.5, C.y + 0.4, C.z - 7.4);

  // ── signs: prices by the buyer, the yard's name at the gate, an arrow at the main road ──
  const P = PRICES;
  sign(scene, C.x - 7.4, C.z - 3.2, 0, label(['WE PAY (per m³)', `Pine logs $${P.log.pine} · Oak logs $${P.log.oak}`, `Pine planks $${P.plank.pine} · Oak planks $${P.plank.oak}`, 'Under 60 cm half price · no nails'], 768, 384, '#e9dcc0', '#3a2614', [64, 34]), undefined, [2.2, 1.1], 2.3);
  sign(scene, C.x + 11, C.z - 5.5, Math.PI / 2, label(['WOODLINE', 'TIMBER YARD · we buy your wood'], 640, 256, '#e9dcc0', '#3a2614', [92, 34]), undefined, [2.6, 1.05], 2.6);
  const j = road.yard[0], k = road.yard[8];
  const tx = k.x - j.x, tz = k.z - j.z, tl = Math.hypot(tx, tz);
  // on the far side of the main road from the camp, facing the traffic coming from camp
  sign(scene, j.x + 2.5, j.z - 3.6, -Math.PI / 2, label(['Timber yard →', 'buys your wood · 140 m'], 512, 224), label(['← Timber yard', 'buys your wood · 140 m'], 512, 224), [1.7, 0.75], 2.0);

  // ── the buyer ──
  const m = personMesh({ worker: false });
  scene.add(m.g);
  const bp = new THREE.Vector3(C.x - 3.2, C.y, C.z - 4.0);
  m.g.position.copy(bp);
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: GROUP.PLAYER | GROUP.PIECE | GROUP.CAR });
  body.addShape(new CANNON.Cylinder(0.25, 0.25, 1.7, 8), new CANNON.Vec3(0, 0.85, 0));
  body.position.set(bp.x, bp.y, bp.z);
  body.buyer = true;
  world.addBody(body);
  buyer = { m, pos: bp, yaw: Math.atan2(ZONE.x - bp.x, ZONE.z - bp.z), t: 0, nod: 0 };
}

// What is in the zone and what he'd pay. Nailed pieces and anything that isn't wood he leaves.
// only: just the pieces it says yes to (a worker sells only the wood he brought).
export function offer(only = null) {
  const list = [];
  let total = 0, volume = 0, nailed = 0, other = 0;
  for (const p of pieces) {
    if (p.dead || p.held || p.anchored || p.falling || (only && !only(p))) continue;
    const q = p.body.position;
    if (Math.abs(q.x - ZONE.x) > ZONE.hw || Math.abs(q.z - ZONE.z) > ZONE.hd || q.y > C.y + 4) continue;
    if (p.joints.size || p.nails.length) { nailed++; continue; }
    const v = woodValue(p);
    if (!v) { other++; continue; }
    list.push(p);
    total += v;
    volume += p.volume;
  }
  return { list, total, volume, nailed, other };
}

// by: a worker selling on his own. Then the cash goes into his pocket, not your account
// (your Wallet still shows the sale). Returns what was paid.
export function sell(by = null) {
  const o = offer(by && ((p) => p.by === by));
  if (!o.list.length) {
    if (!by) game.hud.toast(o.nailed ? 'Pull the nails out first — I don\'t buy nailed wood.' : 'Put your wood in the marked area first.');
    return 0;
  }
  for (const p of o.list) {
    particles.emit('sawdust', new THREE.Vector3(p.body.position.x, p.body.position.y, p.body.position.z), new THREE.Vector3(0, 1, 0), 3);
    p.destroy();
  }
  const n = o.list.length, what = `${n} ${n === 1 ? 'piece' : 'pieces'} of wood · ${o.volume.toFixed(2)} m³`;
  if (by) record(`${by.name} sold ${what} for $${o.total} · he has the cash`);
  else earn(o.total, `Sold ${what}`);
  if (Math.hypot(game.camera.position.x - buyer.pos.x, game.camera.position.z - buyer.pos.z) < 30) audio.coins();
  buyer.nod = 1.2;
  if (!by) game.hud.toast(`Sold ${n} ${n === 1 ? 'piece' : 'pieces'} for $${o.total}${o.nailed ? ` · ${o.nailed} nailed left behind` : ''}`);
  return o.total;
}

// Where the buyer stands (a worker walks over to him to get paid).
export const buyerPos = () => buyer.pos;

export function buyerHint() {
  const o = offer();
  const L = [];
  if (o.list.length) L.push(['E', `Sell ${o.list.length} ${o.list.length === 1 ? 'piece' : 'pieces'} for $${o.total}`]);
  else L.push(['', 'Bring wood into the marked area (the pickup can drive in)']);
  if (o.nailed) L.push(['', `${o.nailed} with nails — not bought`]);
  return { hint: L, info: `Timber buyer · ${o.list.length ? `${o.volume.toFixed(2)} m³ of wood in the area` : 'nothing in the area yet'}` };
}

export function updateYard(dt) {
  if (!buyer) return;
  const b = buyer, cam = game.camera.position;
  b.t += dt;
  // he looks at you when you come over, otherwise at the drop zone
  const near = Math.hypot(cam.x - b.pos.x, cam.z - b.pos.z) < 6;
  const goal = near ? Math.atan2(cam.x - b.pos.x, cam.z - b.pos.z) : Math.atan2(ZONE.x - b.pos.x, ZONE.z - b.pos.z);
  let d = goal - b.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  b.yaw += Math.max(-dt * 3, Math.min(dt * 3, d));
  b.m.g.rotation.y = b.yaw;
  b.nod = Math.max(0, b.nod - dt);
  b.m.head.rotation.x = b.nod > 0 ? Math.sin(b.nod * 9) * 0.25 : 0;
  b.m.head.rotation.y = near ? 0 : Math.sin(b.t * 0.6) * 0.35;
  // a hand on the hip, the other one tapping a pencil on his notebook
  b.m.arms[0].rotation.z = 0.35;
  b.m.arms[1].rotation.x = -0.9 + Math.sin(b.t * 2.2) * 0.05;
}

export { ZONE };
