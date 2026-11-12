// The arm and tool you see in first person. Drawn in its own little scene on
// top of the world, so it never pokes into walls.
import * as THREE from 'three';
import { game } from './game.js';
import { TEX } from './textures.js';
import { clamp, lerp } from './util.js';

// rest pose of the arm root (camera space) and of the tool in the hand
const ROOT = new THREE.Vector3(0.33, -0.38, -0.6);
const TOOL_POSE = {
  axe: { p: [0, 0, 0], r: [-0.5, 2.2, 0.3] }, // edge points forward-left, at what you chop
  saw: { p: [0, 0, 0], r: [-1.1, 0.75, 0.15] },
  hammer: { p: [0, 0, 0], r: [-0.45, 2.2, 0.3] }, // face forward-left, claw back
  trowel: { p: [0, 0.01, 0], r: [-0.15, 0.35, 0.1] }, // blade flat, pointing ahead
  rope: { p: [0, 0, 0], r: [0.15, 0.75, 0.1] }, // coil held up in the fist, turned a bit towards you
  paint: { p: [0, 0.01, 0], r: [-0.35, 0.3, 0.05] }, // brush / roller / float, up and ahead
  road: { p: [-0.06, 0.04, 0.12], r: [-1.72, 0.3, 0.18] }, // shovel / rake / roller: the long handle runs down and ahead
};
const HANDS = new THREE.Vector3(-0.08, 0.11, 0.1); // empty hand sits higher and closer
const DUR = { axe: 0.6, hammer: 0.34, pull: 0.55, lay: 0.32, dig: 0.5 };
const ease = (t) => t * t * (3 - 2 * t);
const _b = new THREE.Vector3();

function mats() {
  return {
    skin: new THREE.MeshStandardMaterial({ color: 0xd9a07a, roughness: 0.7 }),
    sleeve: new THREE.MeshStandardMaterial({ map: TEX.flannel, roughness: 0.95 }),
    handle: new THREE.MeshStandardMaterial({ map: TEX.grain, color: 0xc58e55, roughness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x6d757b, metalness: 0.35, roughness: 0.45 }),
    bright: new THREE.MeshStandardMaterial({ color: 0xc9d0d6, metalness: 0.3, roughness: 0.32 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.8 }),
    rope: new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 1 }),
  };
}

function axeModel(M) {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.62, 10).translate(0, 0.21, 0), M.handle);
  const s = new THREE.Shape();
  s.moveTo(-0.035, -0.028);
  s.lineTo(0.03, -0.028);
  s.lineTo(0.115, -0.068);
  s.quadraticCurveTo(0.152, 0, 0.115, 0.066);
  s.lineTo(0.03, 0.028);
  s.lineTo(-0.035, 0.028);
  s.closePath();
  const headGeo = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 });
  headGeo.translate(0, 0, -0.011);
  const head = new THREE.Mesh(headGeo, M.steel);
  head.position.y = 0.47;
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.13, 0.03), M.bright);
  edge.position.set(0.138, 0.47, 0);
  g.add(handle, head, edge);
  return g;
}

function hammerModel(M) {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.017, 0.36, 10).translate(0, 0.1, 0), M.handle);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.12, 10).translate(0, -0.02, 0), M.rubber);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.032, 0.032), M.steel);
  head.position.set(0.005, 0.285, 0);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.035, 12).rotateZ(Math.PI / 2), M.bright);
  face.position.set(0.055, 0.285, 0);
  g.add(handle, grip, head, face);
  for (const z of [-0.008, 0.008]) {
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.009), M.steel);
    claw.position.set(-0.055, 0.275, z);
    claw.rotation.z = 0.45;
    g.add(claw);
  }
  return g;
}

function sawModel(M) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-0.018, 0.05);
  s.lineTo(-0.018, 0.56);
  s.lineTo(0.03, 0.56);
  // teeth along the cutting edge
  const a = [0.03, 0.56], b = [0.1, 0.05], n = 26;
  for (let i = 1; i <= n; i++) {
    const t = i / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    s.lineTo(x + (i % 2 ? 0.007 : 0), y);
  }
  s.closePath();
  const blade = new THREE.Mesh(new THREE.ShapeGeometry(s), M.bright);
  blade.material = M.bright.clone();
  blade.material.side = THREE.DoubleSide;
  blade.rotation.y = Math.PI / 2;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.1), M.handle);
  handle.position.set(0, 0.0, 0.035);
  const hole = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.055, 0.04), M.rubber);
  hole.position.set(0, 0.0, 0.045);
  g.add(blade, handle, hole);
  for (const y of [0.02, 0.07]) {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.034, 8).rotateZ(Math.PI / 2), M.bright);
    bolt.position.set(0, y, -0.01);
    g.add(bolt);
  }
  return g;
}

// A bricklayer's trowel: wooden handle in the fist, a cranked steel neck, a flat pointed blade.
// Brush, roller and plastering float: one shows at a time (paint.js says which, and the paint colour).
function paintModel(M) {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.12, 10).translate(0, 0.01, 0), M.handle);
  g.add(handle);
  const wet = new THREE.MeshStandardMaterial({ color: 0xf1eee7, roughness: 0.5 });
  const brush = new THREE.Group();
  const ferrule = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.018), M.bright);
  ferrule.position.y = 0.085;
  const bristles = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.055, 0.014), new THREE.MeshStandardMaterial({ color: 0xd9c49a, roughness: 0.9 }));
  bristles.position.y = 0.125;
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.016), wet);
  tip.position.y = 0.152;
  brush.add(ferrule, bristles, tip);
  const roller = new THREE.Group();
  const wire = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.12, 0.008), M.steel);
  wire.position.set(0, 0.12, 0);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.008, 0.008), M.steel);
  arm.position.set(0.055, 0.18, 0);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 14).rotateZ(Math.PI / 2), wet);
  sleeve.position.set(0.1, 0.2, 0);
  roller.add(wire, arm, sleeve);
  const float = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.02), M.handle);
  grip.position.y = 0.085;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.005, 0.26), M.bright);
  plate.position.set(0, 0.108, -0.04);
  const load = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.18), new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 1 }));
  load.position.set(0, 0.117, -0.05);
  float.add(grip, plate, load);
  g.add(brush, roller, float);
  g.userData = { brush, roller, float, wet, load, handle };
  return g;
}

// Shovel, rake and hand roller on one long handle that goes down ahead of you (streets.js says which,
// and whether there's gravel or asphalt on the blade).
function roadModel(M) {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 1.0, 10).translate(0, 0.42, 0), M.handle);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.022, 0.022), M.rubber);
  grip.position.y = -0.06;
  g.add(handle, grip);
  const shovel = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.012), M.steel);
  blade.position.set(0, 1.04, 0.02);
  blade.rotation.x = 0.25;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.1, 8), M.steel);
  collar.position.y = 0.9;
  const heap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 1 }));
  heap.scale.set(1.1, 0.7, 1.2);
  heap.position.set(0, 1.06, -0.03);
  heap.rotation.x = -1.32;
  shovel.add(blade, collar, heap);
  const rake = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.03), M.steel);
  bar.position.y = 0.93;
  rake.add(bar);
  for (let i = 0; i < 10; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.07), M.steel);
    t.position.set(-0.19 + i * 0.042, 0.93, -0.04);
    rake.add(t);
  }
  const roller = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 16).rotateZ(Math.PI / 2), M.steel);
  drum.position.y = 1.02;
  const fork = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.03, 0.03), M.steel);
  fork.position.y = 0.93;
  roller.add(drum, fork);
  g.add(shovel, rake, roller);
  g.userData = { shovel, rake, roller, heap };
  return g;
}

function trowelModel(M) {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.11, 10).translate(0, 0.01, 0), M.handle);
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.018, 10), M.steel);
  ferrule.position.y = 0.072;
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.05, 0.008), M.steel);
  neck.position.set(0, 0.095, -0.012);
  neck.rotation.x = 0.5;
  const s = new THREE.Shape();
  s.moveTo(-0.042, 0);
  s.lineTo(0.042, 0);
  s.lineTo(0.004, -0.16);
  s.lineTo(-0.004, -0.16);
  s.closePath();
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: false }).rotateX(Math.PI / 2), M.bright);
  blade.position.set(0, 0.118, -0.02);
  g.add(handle, ferrule, neck, blade);
  return g;
}

// A coil of rope hanging from the fist, a loose end dangling below.
function ropeModel(M) {
  const g = new THREE.Group();
  const coil = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.075 + (i % 2) * 0.006, 0.009, 6, 22), M.rope);
    t.rotation.set(0.05 * (i - 1.5), Math.PI / 2 + 0.08 * (i - 1.5), 0);
    t.position.x = (i - 1.5) * 0.012;
    coil.add(t);
  }
  coil.position.set(0, 0.06, -0.02);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.015, -0.02), new THREE.Vector3(0.03, -0.09, -0.01), new THREE.Vector3(0.01, -0.16, 0.03)), 8, 0.009, 5, false), M.rope);
  g.add(coil, tail);
  return g;
}

function openHand(M) {
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.028, 0.09), M.skin);
  g.add(palm);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.018, 0.065 - Math.abs(i - 1.5) * 0.008), M.skin);
    f.position.set(-0.03 + i * 0.02, 0.004, -0.075);
    f.rotation.x = -0.25;
    g.add(f);
  }
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.02, 0.05), M.skin);
  thumb.position.set(-0.055, 0.0, -0.02);
  thumb.rotation.y = 0.7;
  g.add(thumb);
  return g;
}

export class Viewmodel {
  constructor() {
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.light = new THREE.DirectionalLight(0xffffff, 2);
    this.scene.add(this.hemi, this.light, this.light.target);

    const M = mats();
    this.root = new THREE.Group();
    this.scene.add(this.root);

    // arm: sleeve running from the hand off the bottom-right of the screen
    this.fist = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.085, 0.085), M.skin);
    this.open = openHand(M);
    this.open.position.set(0, -0.01, -0.02);
    this.open.rotation.set(0.5, 0.35, -0.3);
    const dir = new THREE.Vector3(0.3, -0.8, 0.52).normalize();
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.55, 12).translate(0, 0.275, 0), M.sleeve);
    sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    sleeve.position.copy(dir).multiplyScalar(0.045);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12).translate(0, 0.015, 0), M.sleeve);
    cuff.quaternion.copy(sleeve.quaternion);
    cuff.position.copy(sleeve.position);
    this.root.add(this.fist, this.open, sleeve, cuff);

    this.tools = { axe: axeModel(M), saw: sawModel(M), hammer: hammerModel(M), trowel: trowelModel(M), rope: ropeModel(M), paint: paintModel(M), road: roadModel(M) };
    for (const [id, m] of Object.entries(this.tools)) {
      const p = TOOL_POSE[id];
      m.position.set(...p.p);
      m.rotation.order = 'ZXY'; // spin in the hand first, then lean
      m.rotation.set(...p.r);
      m.visible = false;
      this.root.add(m);
    }

    this.base = ROOT.clone();
    this.current = 'axe';
    this.equipT = 0;
    this.swingKind = null;
    this.swingT = 0;
    this.sawing = false;
    this.sawPh = 0;
    this.carry = false;
    this.carryK = 0;
    this.bobPh = 0;
    this.sway = new THREE.Vector2();
    this.equip('axe');
  }

  equip(id) {
    if (id === this.current && this.equipT > 0) return;
    this.current = id;
    this.equipT = 0;
    this.swingKind = null;
    for (const [k, m] of Object.entries(this.tools)) m.visible = k === id;
    this.fist.visible = id !== 'hands';
    this.open.visible = id === 'hands';
  }

  // the painting tools: which one is in your hand, the paint on it, plaster on the float
  paintTool(tool, hex, plaster) {
    const u = this.tools.paint.userData;
    u.brush.visible = tool === 'brush';
    u.roller.visible = tool === 'roller';
    u.float.visible = tool === 'float';
    u.handle.visible = !!tool;
    u.load.visible = plaster;
    u.wet.color.set(hex ?? 0xf1eee7);
  }

  // the road tools: which is in your hands, and what's on the shovel ('gravel' | 'asphalt' | null)
  roadTool(tool, load) {
    const u = this.tools.road.userData;
    u.shovel.visible = tool === 'shovel';
    u.rake.visible = tool === 'rake';
    u.roller.visible = tool === 'roller';
    this.tools.road.children[0].visible = this.tools.road.children[1].visible = !!tool;
    u.heap.visible = !!load;
    if (load) u.heap.material.color.set(load === 'gravel' ? 0x9a958c : 0x2f2f30);
  }

  swing(kind) {
    this.swingKind = kind;
    this.swingT = 0;
  }

  resize() {
    this.cam.aspect = innerWidth / innerHeight;
    this.cam.updateProjectionMatrix();
  }

  update(dt) {
    const pl = game.player;
    this.equipT = Math.min(1, this.equipT + dt * 3.5);
    // put the tool down while the phone is out (or your hands are on the wheel)
    this.away = lerp(this.away || 0, game.phoneOpen || game.driving ? 1 : 0, Math.min(1, dt * 8));
    const lowered = Math.max(1 - ease(this.equipT), this.away);
    this.root.visible = this.away < 0.9;

    // walking bob
    const sp = pl.grounded ? Math.min(pl.speedH / 5, 1.4) : 0;
    this.bobPh += dt * (5 + pl.speedH * 1.2) * (sp > 0.1 ? 1 : 0.15);
    const bx = Math.sin(this.bobPh) * 0.011 * sp, by = -Math.abs(Math.cos(this.bobPh)) * 0.013 * sp;

    // the arm lags a little behind the mouse
    this.sway.x = lerp(this.sway.x, clamp(-pl.lookDX * 0.0009, -0.05, 0.05), Math.min(1, dt * 10));
    this.sway.y = lerp(this.sway.y, clamp(pl.lookDY * 0.0009, -0.05, 0.05), Math.min(1, dt * 10));
    pl.lookDX = pl.lookDY = 0;

    let rx = 0, ry = 0, rz = 0, px = 0, py = 0, pz = 0;
    if (this.swingKind) {
      this.swingT += dt;
      const T = DUR[this.swingKind], u = this.swingT / T;
      if (this.swingKind === 'axe') {
        if (u < 0.33) { const e = ease(u / 0.33); rx = 0.7 * e; py = 0.06 * e; rz = 0.15 * e; }
        else if (u < 0.45) { const e = (u - 0.33) / 0.12; rx = 0.7 - 1.9 * e; py = 0.06 - 0.1 * e; pz = -0.1 * e; rz = 0.15 - 0.2 * e; }
        else { const e = ease((u - 0.45) / 0.55); rx = -1.2 * (1 - e); py = -0.04 * (1 - e); pz = -0.1 * (1 - e); rz = -0.05 * (1 - e); }
      } else if (this.swingKind === 'hammer') {
        if (u < 0.28) { const e = ease(u / 0.28); rx = 0.75 * e; py = 0.03 * e; }
        else if (u < 0.4) { const e = (u - 0.28) / 0.12; rx = 0.75 - 1.25 * e; pz = -0.04 * e; }
        else { const e = ease((u - 0.4) / 0.6); rx = -0.5 * (1 - e); pz = -0.04 * (1 - e); }
      } else if (this.swingKind === 'lay') {
        // reach forward and press the brick down, then come back
        const e = u < 0.45 ? ease(u / 0.45) : 1 - ease((u - 0.45) / 0.55);
        pz = -0.09 * e; py = -0.05 * e; rx = -0.35 * e;
      } else if (this.swingKind === 'dig') {
        // push the blade down and in, then lift the load
        if (u < 0.4) { const e = ease(u / 0.4); pz = -0.12 * e; py = -0.08 * e; rx = -0.25 * e; }
        else { const e = ease((u - 0.4) / 0.6); pz = -0.12 * (1 - e); py = -0.08 + 0.12 * Math.sin(e * Math.PI) * 0.8 + 0.08 * e; rx = -0.25 + 0.45 * Math.sin(e * Math.PI); }
      } else if (this.swingKind === 'pull') {
        const e = u < 0.6 ? ease(u / 0.6) : 1 - ease((u - 0.6) / 0.4);
        rx = 0.55 * e; pz = 0.04 * e; py = 0.02 * e;
      }
      if (this.swingT >= T) this.swingKind = null;
    }
    if (this.sawing) {
      this.sawPh += dt * 11;
      pz += Math.sin(this.sawPh) * 0.075;
      py += Math.sin(this.sawPh) * 0.018;
      rx += Math.sin(this.sawPh) * 0.06 - 0.12;
    }
    this.carryK = lerp(this.carryK, this.carry ? 1 : 0, Math.min(1, dt * 8));
    if (this.current === 'hands') { py += 0.07 * this.carryK; pz -= 0.06 * this.carryK; rx -= 0.4 * this.carryK; }
    else { py -= 0.05 * this.carryK; }

    const B = this.current === 'hands' || this.current === 'rope' ? _b.addVectors(this.base, HANDS) : this.base;
    this.root.position.set(B.x + bx + px + this.sway.x, B.y + by + py - 0.38 * lowered + this.sway.y, B.z + pz);
    this.root.rotation.set(rx + 0.7 * lowered, ry, rz);

    // match the world's light, seen from the camera
    const d = game.day;
    this.hemi.color.copy(d.hemi.color);
    this.hemi.groundColor.copy(d.hemi.groundColor);
    this.hemi.intensity = d.hemi.intensity * 1.3 + 0.25;
    this.light.color.copy(d.sun.color);
    this.light.intensity = d.sun.intensity * 0.8;
    this.light.position.copy(d.lightDir).applyQuaternion(game.camera.quaternion.clone().invert());
  }

  render(renderer) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.cam);
    renderer.autoClear = true;
  }
}
