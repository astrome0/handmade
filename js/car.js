// Your own pickup. E gets you in and out. It is a real physics body on four
// raycast wheels, so it climbs over logs, bumps into trees, and whatever you
// drop in the bed rides along.
import * as THREE from 'three';
import { world, CANNON, GROUP, MASK, MAT, rayClosest } from './physics.js';
import { terrainHeight, HALF, PARK } from './terrain.js';
import { game } from './game.js';
import { TEX } from './textures.js';
import { pieces } from './items.js';
import { audio } from './audio.js';
import { particles } from './particles.js';
import { clamp, lerp } from './util.js';

// Model coordinates: x forward, y up from the ground, z to the right.
// The body's centre of mass sits COM above the ground, so shapes are shifted by it.
const COM = 0.6;
const WHEEL_R = 0.37;
const AXLE_F = 1.42, AXLE_R = -1.36, TRACK = 0.8;
const WHEEL_POS = [[AXLE_F, -TRACK], [AXLE_F, TRACK], [AXLE_R, -TRACK], [AXLE_R, TRACK]]; // FL FR RL RR
const CONN_Y = 0.66; // where the springs hang from
const MASS = 950;
const EYE = new THREE.Vector3(-0.2, 1.45, -0.38); // driver's eyes, left seat
const VMAX = 19, VREV = 5; // m/s (about 68 km/h forward)
const ENGINE = 4600, BRAKE = 14, HANDBRAKE = 45;
const GEARS = [0, 5, 10, 15]; // m/s where each gear starts (only for the sound)
const FOV = 72;

const X = new CANNON.Vec3(1, 0, 0), UPV = new CANNON.Vec3(0, 1, 0);
const Y3 = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ───────── the model ─────────

function speedoTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#1d1b19';
  x.beginPath(); x.arc(128, 128, 126, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#c9c2b1'; x.lineWidth = 6;
  x.beginPath(); x.arc(128, 128, 122, 0, Math.PI * 2); x.stroke();
  x.fillStyle = x.strokeStyle = '#f1e8d2';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '600 26px Outfit, system-ui, sans-serif';
  for (let s = 0; s <= 120; s += 10) {
    const a = ((-120 + (s / 120) * 240) * Math.PI) / 180, big = s % 20 === 0;
    const r0 = big ? 88 : 98, r1 = 112;
    x.lineWidth = big ? 5 : 3;
    x.beginPath();
    x.moveTo(128 + Math.sin(a) * r0, 128 - Math.cos(a) * r0);
    x.lineTo(128 + Math.sin(a) * r1, 128 - Math.cos(a) * r1);
    x.stroke();
    if (big) x.fillText(s, 128 + Math.sin(a) * 66, 128 - Math.cos(a) * 66);
  }
  x.font = '500 18px Outfit, system-ui, sans-serif';
  x.fillStyle = '#b8ae98';
  x.fillText('km/h', 128, 186);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildPickup() {
  const M = (o) => new THREE.MeshStandardMaterial(o);
  const paint = M({ color: 0x9a3b2c, roughness: 0.62, metalness: 0.12 });
  const paintIn = paint.clone();
  paintIn.side = THREE.DoubleSide;
  const cream = M({ color: 0xe6dcc3, roughness: 0.6, metalness: 0.08 });
  const dark = M({ color: 0x24272a, roughness: 0.85 });
  const chrome = M({ color: 0xc4cad0, roughness: 0.28, metalness: 0.38 });
  const tyre = M({ color: 0x1b1c1e, roughness: 0.95 });
  const glass = M({ color: 0xa9c4d2, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.3, depthWrite: false });
  const seat = M({ color: 0x6b4a33, roughness: 0.8 });
  const dash = M({ color: 0x3b3431, roughness: 0.75 });
  const bedWood = M({ map: TEX.grain, color: 0xa88760, roughness: 0.85 });
  const skin = M({ color: 0xd9a07a, roughness: 0.7 });
  const sleeve = M({ map: TEX.flannel, roughness: 0.9 });
  const hair = M({ color: 0x3a2a1e, roughness: 0.9 });
  const head = M({ color: 0xfff1cc, emissive: 0xffe6a8, emissiveIntensity: 0.15, roughness: 0.3 });
  const tail = M({ color: 0x8c1d16, emissive: 0xff2a1a, emissiveIntensity: 0.05, roughness: 0.4 });
  const rev = M({ color: 0xdedede, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.4 });

  const g = new THREE.Group();     // moves with the physics body (origin = centre of mass)
  const model = new THREE.Group(); // ground coordinates
  model.position.y = -COM;
  g.add(model);
  const add = (parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const B = (len, h, w) => new THREE.BoxGeometry(len, h, w);
  // an open half tube over a wheel
  const fender = (r, w) => new THREE.CylinderGeometry(r, r, w, 18, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);

  // frame, running boards, bumpers
  for (const s of [-1, 1]) {
    add(model, B(4.3, 0.14, 0.12), dark, -0.05, 0.5, s * 0.45);
    add(model, B(1.86, 0.04, 0.24), dark, 0.03, 0.53, s * 0.9);
  }
  add(model, B(0.14, 0.15, 1.8), chrome, 2.3, 0.5, 0);
  add(model, B(0.12, 0.13, 1.6), chrome, -2.32, 0.52, 0);

  // fenders (old step-side: they stick out past the bed)
  for (const s of [-1, 1]) {
    add(model, fender(0.5, 0.34), paintIn, AXLE_F, 0.4, s * 0.8);
    add(model, fender(0.47, 0.3), paintIn, AXLE_R, 0.4, s * 0.79);
    add(model, B(1.3, 0.3, 0.1), paint, 1.55, 0.83, s * 0.6); // between hood and fender
  }

  // hood, grille, round headlights
  add(model, B(1.25, 0.3, 1.12), paint, 1.58, 0.87, 0);
  add(model, B(1.2, 0.02, 0.05), chrome, 1.6, 1.025, 0);
  add(model, B(0.08, 0.44, 0.96), cream, 2.2, 0.8, 0);
  for (let i = 0; i < 6; i++) add(model, B(0.03, 0.34, 0.035), dark, 2.245, 0.8, -0.35 + i * 0.14);
  const lamps = [];
  for (const s of [-1, 1]) {
    add(model, new THREE.CylinderGeometry(0.12, 0.1, 0.16, 16).rotateZ(Math.PI / 2), chrome, 1.98, 0.88, s * 0.72);
    lamps.push(add(model, new THREE.CircleGeometry(0.1, 16).rotateY(Math.PI / 2), head, 2.065, 0.88, s * 0.72, 0, 0, 0, false));
  }

  // cab
  add(model, B(1.6, 0.06, 1.62), dark, 0.18, 0.6, 0);                       // floor
  add(model, B(0.06, 0.52, 1.62), paint, 0.96, 0.88, 0);                    // firewall
  add(model, B(0.06, 0.6, 1.62), paint, -0.6, 0.91, 0);                     // back wall
  for (const s of [-1, 1]) add(model, B(0.06, 0.44, 0.24), paint, -0.6, 1.42, s * 0.69);
  add(model, B(0.04, 0.44, 1.14), glass, -0.6, 1.42, 0, 0, 0, 0, false);    // rear window
  add(model, B(1.48, 0.07, 1.66), cream, 0.1, 1.68, 0);                     // roof
  const ws = Math.atan2(0.15, 0.505);                                       // windshield leans back
  add(model, B(0.02, 0.53, 1.44), glass, 0.875, 1.39, 0, 0, 0, ws, false);
  add(model, B(0.08, 0.06, 1.6), paint, 0.81, 1.64, 0);
  for (const s of [-1, 1]) {
    add(model, B(1.55, 0.54, 0.05), paint, 0.18, 0.88, s * 0.8);             // door
    add(model, B(0.07, 0.55, 0.07), paint, 0.875, 1.39, s * 0.77, 0, 0, ws); // A pillar
    add(model, B(0.07, 0.52, 0.07), paint, -0.57, 1.42, s * 0.78);           // B pillar
    add(model, B(1.3, 0.48, 0.02), glass, 0.12, 1.4, s * 0.8, 0, 0, 0, false);
    add(model, B(0.12, 0.03, 0.03), chrome, -0.3, 1.04, s * 0.83);           // handle
    add(model, B(0.05, 0.03, 0.2), chrome, 0.9, 1.16, s * 0.9);              // mirror arm
    add(model, B(0.04, 0.14, 0.1), dark, 0.9, 1.2, s * 1.02);
  }

  // inside
  add(model, B(0.36, 0.18, 1.52), dash, 0.78, 1.06, 0);
  add(model, B(0.5, 0.12, 1.42), seat, -0.24, 0.84, 0);
  add(model, B(0.12, 0.52, 1.42), seat, -0.5, 1.14, 0, 0, 0, 0.12);
  add(model, B(0.03, 0.06, 0.18), dark, 0.74, 1.6, 0);                      // rear-view mirror
  add(model, new THREE.CylinderGeometry(0.025, 0.03, 0.5, 8).rotateZ(Math.PI / 2 - 0.55), dark, 0.56, 1.08, EYE.z);
  const pivot = new THREE.Group();
  pivot.position.set(0.38, 1.17, EYE.z);
  pivot.rotation.set(0, Math.PI / 2, -0.5, 'ZYX');
  model.add(pivot);
  const spin = new THREE.Group();
  pivot.add(spin);
  add(spin, new THREE.TorusGeometry(0.19, 0.017, 8, 28), dark, 0, 0, 0);
  add(spin, B(0.36, 0.025, 0.012), dark, 0, 0, 0);
  add(spin, B(0.025, 0.18, 0.012), dark, 0, -0.09, 0);
  add(spin, new THREE.CylinderGeometry(0.045, 0.045, 0.04, 14).rotateX(Math.PI / 2), chrome, 0, 0, 0);
  // the speedometer, in the middle of the dash
  const gauge = new THREE.Group();
  gauge.position.set(0.594, 1.07, -0.02);
  gauge.rotation.y = -Math.PI / 2;
  model.add(gauge);
  const speedoTex = speedoTexture();
  const gaugeMat = M({ map: speedoTex, emissiveMap: speedoTex, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4 });
  add(gauge, new THREE.CircleGeometry(0.075, 28), gaugeMat, 0, 0, 0, 0, 0, 0, false);
  add(gauge, new THREE.TorusGeometry(0.077, 0.006, 6, 28), chrome, 0, 0, 0.002, 0, 0, 0, false);
  const needle = new THREE.Group();
  needle.position.z = 0.004;
  gauge.add(needle);
  add(needle, B(0.006, 0.062, 0.003).translate(0, 0.028, 0), M({ color: 0xff6a2a, emissive: 0xff5010, emissiveIntensity: 0.4 }), 0, 0, 0, 0, 0, 0, false);

  // you: hands on the wheel, flannel sleeves, and (seen from outside) the rest
  const hands = [];
  for (const s of [1, -1]) { // local +x on the wheel is your left
    const h = add(spin, new THREE.SphereGeometry(0.042, 10, 8), skin, s * 0.165, 0.095, -0.025);
    h.scale.set(1, 1.25, 0.9);
    hands.push(h);
  }
  const sleeves = [0, 1].map(() => add(model, new THREE.CylinderGeometry(0.038, 0.05, 1, 10), sleeve, 0, 0, 0));
  const shoulders = [new THREE.Vector3(-0.36, 1.12, EYE.z - 0.22), new THREE.Vector3(-0.36, 1.12, EYE.z + 0.22)];
  const driver = new THREE.Group();
  model.add(driver);
  add(driver, B(0.26, 0.5, 0.44), sleeve, -0.32, 1.12, EYE.z);
  add(driver, new THREE.SphereGeometry(0.11, 14, 10), skin, -0.16, 1.47, EYE.z);
  add(driver, new THREE.SphereGeometry(0.115, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), hair, -0.17, 1.49, EYE.z);

  // bed: wooden floor, steel sides
  add(model, B(1.62, 0.05, 1.2), bedWood, -1.45, 0.76, 0);
  for (const z of [-0.3, 0, 0.3]) add(model, B(1.6, 0.012, 0.04), chrome, -1.45, 0.79, z);
  add(model, B(1.6, 0.18, 1.15), dark, -1.45, 0.65, 0);
  for (const s of [-1, 1]) {
    add(model, B(1.62, 0.42, 0.05), paint, -1.45, 0.99, s * 0.6);
    add(model, B(1.66, 0.04, 0.1), cream, -1.45, 1.215, s * 0.6);
  }
  add(model, B(0.05, 0.42, 1.25), paint, -0.66, 0.99, 0);
  add(model, B(0.05, 0.42, 1.25), paint, -2.25, 0.99, 0);
  add(model, B(0.03, 0.03, 1.1), chrome, -2.28, 1.13, 0);
  const tails = [], revs = [];
  for (const s of [-1, 1]) {
    tails.push(add(model, B(0.04, 0.12, 0.1), tail, -2.27, 1.0, s * 0.54, 0, 0, 0, false));
    revs.push(add(model, B(0.03, 0.05, 0.1), rev, -2.385, 0.52, s * 0.42, 0, 0, 0, false));
  }

  // wheels (body frame, moved every frame from the suspension)
  const wheels = [];
  const tyreGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.26, 22).rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.27, 16).rotateX(Math.PI / 2);
  const capGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.29, 10).rotateX(Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Group();
    w.rotation.order = 'YZX';
    add(w, tyreGeo, tyre, 0, 0, 0);
    add(w, rimGeo, cream, 0, 0, 0);
    add(w, capGeo, chrome, 0, 0, 0);
    for (let k = 0; k < 5; k++) { // lug bolts, so you can see them turn
      const a = (k / 5) * Math.PI * 2;
      add(w, B(0.035, 0.035, 0.28), dark, Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0, 0, 0, 0, false);
    }
    g.add(w);
    wheels.push(w);
  }

  return { g, model, wheels, spin, needle, hands, sleeves, shoulders, driver, mats: { head, tail, rev, gauge: gaugeMat }, lamps, tails, revs };
}

// ───────── the pickup ─────────

export const car = {
  driving: false,
  engine: false,
  lights: false,
  view: 'cab',
  steer: 0,
  speed: 0,
  rpm: 0,
  load: 0,
  braking: false,
  reversing: false,
  slide: 0,
  startT: -1,

  init() {
    Object.assign(this, buildPickup());
    game.scene.add(this.g);
    // tow ring on the back of the bed (where the rope ties on) and a bracket to hold it
    const iron = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.7 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 6, 12), iron);
    ring.position.set(-2.36, 0.5, 0);
    ring.rotation.y = Math.PI / 2;
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.16), iron);
    bracket.position.set(-2.29, 0.5, 0);
    this.model.add(ring, bracket);

    const b = this.body = new CANNON.Body({
      mass: MASS, material: MAT.car, collisionFilterGroup: GROUP.CAR, collisionFilterMask: MASK.ALL,
      allowSleep: false, angularDamping: 0.1, linearDamping: 0.02,
    });
    const box = (hx, hy, hz, x, y, z) => b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), new CANNON.Vec3(x, y - COM, z));
    box(1.47, 0.275, 0.88, 0.85, 0.725, 0); // hood and lower cab
    box(0.76, 0.34, 0.8, 0.13, 1.35, 0);    // cab
    box(0.84, 0.15, 0.62, -1.46, 0.61, 0);  // bed floor (top at 0.76)
    for (const s of [-1, 1]) {
      box(0.84, 0.22, 0.03, -1.46, 0.98, s * 0.6); // bed sides
      box(0.48, 0.2, 0.15, AXLE_R, 0.65, s * 0.79); // rear fenders
    }
    box(0.03, 0.22, 0.62, -2.25, 0.98, 0);  // tailgate
    b.car = this;

    // parked by camp, nose towards the turning loop
    const fx = 16 - PARK.x, fz = 6 - PARK.z;
    b.quaternion.setFromEuler(0, Math.atan2(-fz, fx), 0);
    b.position.set(PARK.x, terrainHeight(PARK.x, PARK.z) + COM + 0.05, PARK.z);

    this.vehicle = new CANNON.RaycastVehicle({ chassisBody: b, indexRightAxis: 2, indexUpAxis: 1, indexForwardAxis: 0 });
    for (const [x, z] of WHEEL_POS) {
      this.vehicle.addWheel({
        radius: WHEEL_R,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        axleLocal: new CANNON.Vec3(0, 0, 1),
        chassisConnectionPointLocal: new CANNON.Vec3(x, CONN_Y - COM, z),
        suspensionStiffness: 32,
        suspensionRestLength: 0.34,
        maxSuspensionTravel: 0.26,
        dampingRelaxation: 2.4,
        dampingCompression: 4.2,
        maxSuspensionForce: 1e5,
        frictionSlip: 1.7,
        rollInfluence: 0.05,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true,
      });
    }
    this.vehicle.addToWorld(world);
    // Standing still, brakes alone let it creep down a slope (like your feet did):
    // plant it where it stopped until you drive off or something shoves it.
    world.addEventListener('postStep', () => {
      const h = this.hold;
      if (!h) return;
      if (Math.hypot(b.position.x - h.x, b.position.z - h.z) > 0.25) { this.hold = null; return; }
      b.position.x = h.x;
      b.position.z = h.z;
      b.velocity.x = 0;
      b.velocity.z = 0;
      b.angularVelocity.y = 0;
    });
    this.hold = null;
    this.spins = [0, 0, 0, 0];
    this.camYaw = 0;
    this.lastYaw = 0;
    this.lastLook = 0;
  },

  // Which way the nose points, as a player yaw (forward = -sin, -cos).
  heading() {
    const f = this.body.quaternion.vmult(X);
    return Math.atan2(-f.x, -f.z);
  },
  upright() { return this.body.quaternion.vmult(UPV).y; },

  // ───────── getting in and out ─────────

  enter() {
    const t = game.tools, pl = game.player;
    t.drop(true);
    t.saw.key = null;
    t.saw.p = 0;
    game.vm.sawing = false;
    audio.sawing(false, 0);
    game.hud.progress(0);
    game.hud.info('');
    world.removeBody(pl.body);
    pl.yaw = 0;
    pl.pitch = -0.06;
    this.driving = game.driving = true;
    this.view = 'cab';
    this.startT = 0;
    document.getElementById('hud').classList.add('driving');
    audio.door(true);
  },

  exit() {
    if (Math.abs(this.speed) > 3) { game.hud.toast('Slow down first'); return; }
    const pl = game.player, b = this.body;
    // driver's door first, then the other door, the back, the front; on top if all are blocked
    const from = new CANNON.Vec3(b.position.x, b.position.y + 0.3, b.position.z);
    let spot = null;
    for (const [x, z] of [[0.15, -1.35], [0.15, 1.35], [-3.1, 0], [3.1, 0]]) {
      const p = b.pointToWorldFrame(new CANNON.Vec3(x, 1.0 - COM, z));
      if (Math.max(Math.abs(p.x), Math.abs(p.z)) > HALF - 9) continue;
      if (rayClosest(from, p, GROUP.STATIC | GROUP.PIECE | GROUP.TREE)) continue;
      spot = p;
      break;
    }
    if (!spot) spot = new CANNON.Vec3(b.position.x, b.position.y + 2.2, b.position.z);
    const ground = terrainHeight(spot.x, spot.z) + 0.4;
    pl.body.position.set(spot.x, Math.max(spot.y - 0.6, ground), spot.z);
    pl.body.velocity.set(b.velocity.x * 0.5, 0, b.velocity.z * 0.5);
    pl.anchor = null;
    world.addBody(pl.body);
    pl.yaw = wrap((this.view === 'cab' ? this.heading() : this.camYaw) + (this.view === 'cab' ? pl.yaw : 0));
    pl.pitch = clamp(pl.pitch, -0.6, 0.6);
    this.driving = game.driving = false;
    this.engine = false;
    this.startT = -1;
    document.getElementById('hud').classList.remove('driving');
    game.hud.hint([]);
    audio.door(true);
  },

  // On its side or roof: tip it back onto its wheels, facing the same way.
  flip() {
    const b = this.body, h = this.heading();
    b.quaternion.setFromEuler(0, Math.atan2(Math.cos(h), -Math.sin(h)), 0);
    b.position.y = terrainHeight(b.position.x, b.position.z) + COM + 0.7;
    b.velocity.setZero();
    b.angularVelocity.setZero();
    audio.thud();
  },

  setLights(on) {
    this.lights = on;
    // the beam is only made the first time, so the forest's shaders don't change until you need it
    if (on && !this.beam) {
      this.beam = new THREE.SpotLight(0xfff0d0, 0, 60, 0.6, 0.55, 1);
      this.beam.position.set(2.1, 0.9 - COM, 0);
      this.beam.target.position.set(14, -1.4 - COM, 0);
      this.g.add(this.beam, this.beam.target);
    }
    if (this.beam) this.beam.intensity = on ? 160 : 0;
    this.mats.gauge.emissiveIntensity = on ? 0.55 : 0;
    audio.click();
  },

  // ───────── every frame, before physics ─────────

  update(dt) {
    const v = this.vehicle, b = this.body, k = game.input.keys, pr = game.input.pressed;
    const drive = this.driving && !game.phoneOpen;
    const fwd = b.quaternion.vmult(X);
    const speed = (this.speed = b.velocity.dot(fwd));

    if (this.driving && this.startT >= 0) {
      // door shuts, a moment, then the starter cranks and it catches
      const t0 = this.startT;
      this.startT += dt;
      if (t0 < 0.35 && this.startT >= 0.35) audio.starter();
      if (this.startT >= 1.05) { this.engine = true; this.startT = -1; }
    }

    let throttle = 0, brake = 0, hand = false, steerIn = 0;
    if (this.auto) ({ throttle, brake, steerIn } = this.autoDrive(dt, speed));
    else if (drive) {
      if (pr.has('KeyE')) { this.exit(); return; }
      if (pr.has('KeyL')) this.setLights(!this.lights);
      if (pr.has('KeyV')) { this.view = this.view === 'cab' ? 'behind' : 'cab'; game.player.yaw = 0; game.player.pitch = -0.06; }
      if (pr.has('KeyH')) audio.carHorn();
      if (pr.has('KeyR') && this.upright() < 0.5) this.flip();
      const W = k.has('KeyW') || k.has('ArrowUp'), S = k.has('KeyS') || k.has('ArrowDown');
      if (this.engine) {
        if (W) { if (speed < -0.6) brake = 1; else throttle = 1; }
        else if (S) { if (speed > 0.6) brake = 1; else throttle = -1; }
      } else if (W || S) brake = 1;
      hand = k.has('Space');
      steerIn = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
    }

    // less steering the faster you go, and the wheel comes back by itself
    const maxSteer = lerp(0.62, 0.16, clamp(Math.abs(speed) / 17, 0, 1));
    const rate = steerIn ? 1.8 : 3.2;
    this.steer += clamp(steerIn * maxSteer - this.steer, -rate * dt, rate * dt);
    v.setSteeringValue(this.steer, 0);
    v.setSteeringValue(this.steer, 1);

    // four-wheel drive, so it can get up the hills
    let force = 0;
    if (throttle > 0) force = ENGINE * throttle * clamp(1 - speed / VMAX, 0, 1);
    else if (throttle < 0) force = ENGINE * 0.6 * throttle * clamp(1 + speed / VREV, 0, 1);
    for (let i = 0; i < 4; i++) v.applyEngineForce(force / 4, i);

    let bf = brake * BRAKE;
    if (!throttle && !brake) bf = Math.abs(speed) < 0.4 ? 8 : 1.2; // hold still / engine braking
    if (!this.driving && !this.auto) bf = 10;                       // parked: handbrake on
    for (let i = 0; i < 4; i++) v.setBrake(bf, i);
    if (hand) { v.setBrake(HANDBRAKE, 2); v.setBrake(HANDBRAKE, 3); }

    this.load = Math.abs(throttle);
    this.braking = brake > 0 || hand;
    this.reversing = throttle < 0;
    this.handbrake = hand;

    const grounded = v.wheelInfos.filter((w) => w.isInContact).length >= 3;
    if (throttle || !grounded || this.upright() < 0.7) this.hold = null;
    else if (!this.hold && Math.abs(speed) < 0.3) this.hold = { x: b.position.x, z: b.position.z };

    // the edge of the world, like for you on foot
    const L = HALF - 7;
    for (const ax of ['x', 'z']) {
      if (b.position[ax] > L) b.velocity[ax] = Math.min(b.velocity[ax], -0.5);
      if (b.position[ax] < -L) b.velocity[ax] = Math.max(b.velocity[ax], 0.5);
    }
    if (b.position.y < terrainHeight(b.position.x, b.position.z) - 3) this.flip();

    // Logs asleep in the bed must notice the bed moving off under them.
    if (Math.abs(speed) > 0.05 || b.angularVelocity.lengthSquared() > 0.01) {
      for (const p of pieces) {
        if (p.body.sleepState && p.body.position.distanceSquared(b.position) < 16) p.body.wakeUp();
      }
    }
  },

  // ───────── somebody else drives (a worker): along a list of points ─────────

  // pts: [{x, z}] along the road, done(ok) when it stands still at the last one (or gave up).
  autoStart(pts, done, vmax = 8) {
    this.auto = { pts, done, vmax, k: 0, stuckT: 0, revT: 0, tries: 0, stopT: 0 };
    this.hold = null;
    if (!this.engine) { audio.starter(); this.engine = true; }
  },
  autoStop(ok = true) {
    const A = this.auto;
    if (!A) return;
    this.auto = null;
    this.engine = false;
    A.done?.(ok);
  },

  autoDrive(dt, speed) {
    const A = this.auto, b = this.body, p = b.position, P = A.pts;
    if (this.upright() < 0.5) this.flip();
    // the closest point ahead of where we were (never back), then one a little further on to aim at
    let best = A.k, bd = Infinity;
    for (let i = A.k; i < Math.min(P.length, A.k + 40); i++) {
      const d = (P[i].x - p.x) ** 2 + (P[i].z - p.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    A.k = best;
    const look = 3.5 + Math.abs(speed) * 0.5;
    let j = A.k;
    while (j < P.length - 1 && Math.hypot(P[j].x - p.x, P[j].z - p.z) < look) j++;
    const end = P[P.length - 1];
    const rest = Math.hypot(end.x - p.x, end.z - p.z);
    const fwd = b.quaternion.vmult(X), right = b.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
    const dx = P[j].x - p.x, dz = P[j].z - p.z;
    const ang = Math.atan2(dx * right.x + dz * right.z, dx * fwd.x + dz * fwd.z);
    let steerIn = clamp(-ang * 2.2, -1, 1);
    // slow for bends ahead and for the end
    let turn = 0;
    for (let i = A.k; i < Math.min(P.length - 2, A.k + 30); i += 3) {
      const a = P[i], m = P[i + 1], c = P[Math.min(P.length - 1, i + 3)];
      turn = Math.max(turn, Math.abs(wrap(Math.atan2(c.z - m.z, c.x - m.x) - Math.atan2(m.z - a.z, m.x - a.x))));
    }
    let vt = A.vmax * clamp(1 - turn * 1.4, 0.35, 1);
    if (A.k > P.length - 80) vt = Math.min(vt, Math.sqrt(4 * Math.max(0, rest - 0.6))); // (the last ~40 m: ease in)
    if (Math.abs(ang) > 0.9) vt = Math.min(vt, 2.5);
    let throttle = 0, brake = 0;
    if (A.revT > 0) {
      // backing out of whatever stopped us, wheel the other way
      A.revT -= dt;
      return { throttle: -0.7, brake: 0, steerIn: -A.revSteer };
    }
    if (rest < 1.2 || (A.k >= P.length - 2 && rest < 2.5)) {
      brake = 1;
      if (Math.abs(speed) < 0.3) { A.stopT += dt; if (A.stopT > 0.4) { this.autoStop(true); return { throttle: 0, brake: 1, steerIn: 0 }; } }
      return { throttle: 0, brake, steerIn };
    }
    if (speed < vt - 0.3) throttle = clamp((vt - speed) * 0.6, 0.25, 1);
    else if (speed > vt + 1.2) brake = 1;
    // stuck (a log, a tree, a hole): back up a little and try again
    if (throttle > 0.2 && Math.abs(speed) < 0.4) A.stuckT += dt; else A.stuckT = Math.max(0, A.stuckT - dt);
    if (A.stuckT > 2.5) {
      A.stuckT = 0;
      if (++A.tries > 6) { this.autoStop(false); return { throttle: 0, brake: 1, steerIn: 0 }; }
      A.revT = 1.6;
      A.revSteer = steerIn || 1;
    }
    return { throttle, brake, steerIn };
  },

  // ───────── after physics: the model, the sound, your view ─────────

  sync(dt) {
    const b = this.body, v = this.vehicle;
    this.g.position.copy(b.interpolatedPosition);
    this.g.quaternion.copy(b.interpolatedQuaternion);

    let slide = 0, contact = 0;
    for (let i = 0; i < 4; i++) {
      const wi = v.wheelInfos[i], w = this.wheels[i], c = wi.chassisConnectionPointLocal;
      w.position.set(c.x, c.y - wi.suspensionLength, c.z);
      // cannon stops a wheel's spin whenever any brake is on, so roll them ourselves
      // (only the handbrake really locks the back wheels)
      const locked = i >= 2 && this.handbrake;
      if (!locked && (wi.isInContact || !this.load)) this.spins[i] += (this.speed * dt) / WHEEL_R;
      else if (!locked) this.spins[i] += (this.reversing ? -30 : 30) * dt; // spinning in the air
      w.rotation.set(0, wi.steering, -this.spins[i]);
      if (wi.isInContact) { contact++; slide += 1 - (wi.skidInfo ?? 1); }
    }
    slide = contact ? slide / contact : 0;
    this.slide = lerp(this.slide, Math.min(1, slide * 2.5), Math.min(1, dt * 10));
    this.spin.rotation.z = -this.steer * 4.5;
    const kmh = Math.abs(this.speed) * 3.6;
    this.needle.rotation.z = 2.09 - (Math.min(kmh, 125) / 120) * 4.19;

    // lights
    this.mats.head.emissiveIntensity = this.lights ? 1.6 : 0.15;
    this.mats.tail.emissiveIntensity = this.braking ? 1.8 : this.lights ? 0.55 : 0.05;
    this.mats.rev.emissiveIntensity = this.reversing ? 1.4 : 0;

    // engine: fake gears, so it revs up and drops back like an old manual
    const s = Math.abs(this.speed);
    let gi = 0;
    while (gi < GEARS.length - 1 && s > GEARS[gi + 1]) gi++;
    const lo = GEARS[gi], hi = GEARS[gi + 1] ?? VMAX + 3;
    const target = this.engine ? clamp(0.1 + 0.72 * ((s - lo) / (hi - lo)) + (gi ? 0.2 : 0) + (this.load && s < 1.5 ? 0.25 : 0), 0, 1) : 0;
    this.rpm = lerp(this.rpm, target, Math.min(1, dt * (target < this.rpm ? 9 : 5)));
    const far = this.driving ? 1 : 1 / (1 + this.g.position.distanceTo(game.camera.position) / 8);
    audio.carEngine(this.engine, this.rpm, this.load, s * far, this.slide * far);

    // dust off the back wheels on the dirt
    if (contact && s > 6 && Math.random() < dt * (s - 5) * 0.5) {
      const wi = v.wheelInfos[2 + ((Math.random() * 2) | 0)];
      if (wi.isInContact) particles.emit('dirt', new THREE.Vector3(wi.raycastResult.hitPointWorld.x, wi.raycastResult.hitPointWorld.y + 0.05, wi.raycastResult.hitPointWorld.z), Y3, 1);
    }

    this.hands.forEach((h) => { h.visible = this.driving; });
    this.sleeves.forEach((sl) => { sl.visible = this.driving; });
    this.driver.visible = this.driving && this.view === 'behind'; // (a worker at the wheel brings his own body)
    if (!this.driving) return;

    this.g.updateMatrixWorld(true);
    this.hands.forEach((h, i) => {
      const sh = this.shoulders[i];
      h.getWorldPosition(_v);
      this.model.worldToLocal(_v);
      _w.subVectors(_v, sh);
      const len = _w.length() - 0.05;
      _w.normalize();
      const sl = this.sleeves[i];
      sl.position.copy(sh).addScaledVector(_w, len / 2);
      sl.quaternion.setFromUnitVectors(Y3, _w);
      sl.scale.set(1, len, 1);
    });
    this.camera(dt);
    this.hint();
  },

  camera(dt) {
    const pl = game.player, cam = game.camera;
    const now = game.uTime.value;
    if (pl.yaw !== this.lastYaw) this.lastLook = now;
    let fov = FOV;
    if (this.view === 'cab') {
      pl.yaw = clamp(pl.yaw, -2.3, 2.3);
      pl.pitch = clamp(pl.pitch, -1.1, 0.9);
      _v.set(EYE.x, EYE.y - COM, EYE.z).applyQuaternion(this.g.quaternion).add(this.g.position);
      cam.position.copy(_v);
      cam.quaternion.copy(this.g.quaternion).multiply(_q.setFromEuler(_e.set(pl.pitch, -Math.PI / 2 + pl.yaw, 0, 'YXZ')));
      fov += 7 * clamp((Math.abs(this.speed) - 8) / 11, 0, 1);
    } else {
      // behind the truck; it swings back behind you when you stop looking around
      pl.yaw = wrap(pl.yaw);
      pl.pitch = clamp(pl.pitch, -0.9, 0.5);
      if (now - this.lastLook > 1.3 && Math.abs(this.speed) > 2) {
        pl.yaw = lerp(pl.yaw, 0, Math.min(1, dt * 1.6));
        pl.pitch = lerp(pl.pitch, -0.06, Math.min(1, dt * 1.6));
      }
      this.camYaw += wrap(this.heading() + pl.yaw - this.camYaw) * Math.min(1, dt * 7);
      const yaw = this.camYaw, pitch = pl.pitch - 0.16;
      _w.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const target = _v.copy(this.g.position).add(new THREE.Vector3(0, 1.0, 0));
      cam.position.copy(target).addScaledVector(_w, -7);
      cam.position.y = Math.max(cam.position.y, terrainHeight(cam.position.x, cam.position.z) + 0.5);
      cam.lookAt(target);
    }
    this.lastYaw = pl.yaw;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
    // the sun's shadows and everything that follows "you" follow the truck
    pl.body.position.set(this.body.position.x, this.body.position.y + 0.4, this.body.position.z);
    pl.speedH = 0;
    pl.grounded = true;
  },

  hint() {
    const L = [];
    if (this.upright() < 0.5) L.push(['R', 'Flip back']);
    else if (!this.engine) L.push(['', 'Starting…']);
    L.push(['W S', 'Drive'], ['A D', 'Steer'], ['Space', 'Handbrake'], ['E', 'Get out'], ['L', this.lights ? 'Lights off' : 'Lights'], ['V', this.view === 'cab' ? 'Outside view' : 'Inside view'], ['H', 'Horn']);
    game.hud.hint(L);
    const gear = !this.engine ? 'P' : this.reversing || this.speed < -0.3 ? 'R' : 'D';
    game.hud.speedo(Math.round(Math.abs(this.speed) * 3.6), gear);
  },
};

export const carDebug = { car, COM, EYE };
