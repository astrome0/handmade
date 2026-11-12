// A hand flashlight: L switches it on, L again switches it off (in the pickup, L is the headlights).
// The beam is a spot light that trails your look a little, bright in the middle and soft at
// the edge, with a short flicker as the bulb catches. You see it in your
// left hand, drawn in the viewmodel's scene like the tools.
import * as THREE from 'three';
import { MOBILE } from './device.js';
import { game } from './game.js';
import { audio } from './audio.js';
import { TEX } from './textures.js';
import { clamp, lerp } from './util.js';

const HAND_ON = new THREE.Vector3(-0.2, -0.17, -0.4); // camera space, lower left
const BEAM_FROM = new THREE.Vector3(-0.22, -0.2, -0.3); // where the beam starts, by your hand
const POWER = 140, FLICKER = 0.22;
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _f = new THREE.Vector3();

// The beam's shape: a hot centre, a brighter ring where the reflector focuses, a dim spill.
function lensTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.16, '#f4f1ea');
  g.addColorStop(0.3, '#a9a59c');
  g.addColorStop(0.38, '#c9c4b8'); // the reflector ring
  g.addColorStop(0.46, '#6d6a63');
  g.addColorStop(0.75, '#2c2a27');
  g.addColorStop(1, '#000');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A dark aluminium torch with a grip, a rubber switch and a glass lens, held in a fist.
function torchModel() {
  const g = new THREE.Group();
  const alu = new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.6, roughness: 0.38 });
  const knurl = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, metalness: 0.5, roughness: 0.7 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x8a2a1c, roughness: 0.85 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.9, roughness: 0.18 });
  const lens = new THREE.MeshStandardMaterial({ color: 0xdfe6ea, emissive: 0xfff0d2, emissiveIntensity: 0, roughness: 0.05 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a07a, roughness: 0.7 });
  const sleeveMat = new THREE.MeshStandardMaterial({ map: TEX.flannel, roughness: 0.95 });
  const Z = (geo) => geo.rotateX(-Math.PI / 2); // cylinders along z, their top towards -z (the lens)

  const add = (geo, mat, z) => { const m = new THREE.Mesh(Z(geo), mat); m.position.z = z; g.add(m); return m; };
  add(new THREE.CylinderGeometry(0.017, 0.017, 0.14, 14), alu, 0.03); // body
  add(new THREE.CylinderGeometry(0.019, 0.017, 0.022, 14), knurl, 0.105); // tail cap
  for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.0182, 0.0182, 0.005, 14), knurl, 0.004 + i * 0.009); // grip rings
  add(new THREE.CylinderGeometry(0.027, 0.018, 0.045, 16), alu, -0.06); // head flares out
  add(new THREE.TorusGeometry(0.026, 0.0035, 6, 20).rotateX(Math.PI / 2), chrome, -0.083); // bezel
  add(new THREE.CylinderGeometry(0.024, 0.024, 0.003, 18), lens, -0.083); // glass
  // the switch: a round red rubber button in a metal collar, on top in front of the fist
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.0095, 0.006, 16), chrome);
  collar.position.set(0, 0.017, -0.012);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.007, 0.007, 16), rubber);
  btn.position.set(0, 0.021, -0.012);
  g.add(collar, btn);
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.002, 0.06), chrome);
  clip.position.set(0.0195, 0.004, -0.012);
  clip.rotation.z = Math.PI / 2;
  g.add(clip);

  // the fist closed round the back of the body (the torch runs through it, hidden), four
  // fingers curled round the side, the thumb on the far side, the sleeve going off-screen
  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.055), skin);
  fist.position.set(0, -0.006, 0.06);
  g.add(fist);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.044, 0.011), skin);
    f.position.set(0.026, -0.008, 0.039 + i * 0.013);
    g.add(f);
  }
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.04), skin);
  thumb.position.set(-0.024, 0.006, 0.03);
  const dir = new THREE.Vector3(-0.35, -0.75, 0.56).normalize();
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.054, 0.55, 12).translate(0, 0.275, 0), sleeveMat);
  sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  sleeve.position.set(0, -0.02, 0.07);
  g.add(thumb, sleeve);
  g.userData = { lens, btn };
  return g;
}

export const flashlight = {
  on: false,
  beam: null,
  model: null,
  up: 0,        // 0 = hand down out of view, 1 = held up
  flicker: 0,   // seconds of flicker left after switching on
  press: 0,     // the thumb pressing the switch

  // the light and the model are made the first time, so the forest's shaders don't change until then
  make() {
    if (this.beam) return;
    const b = new THREE.SpotLight(0xfff1dc, 0, 45, 0.62, 0.5, 1.25);
    b.map = lensTexture();
    b.castShadow = true;
    b.shadow.mapSize.setScalar(MOBILE ? 512 : 1024);
    b.shadow.camera.near = 0.25;
    b.shadow.camera.far = 45;
    b.shadow.bias = -0.0006;
    b.shadow.normalBias = 0.03;
    b.shadow.autoUpdate = false;
    game.scene.add(b, b.target);
    this.beam = b;
    this.look = game.camera.quaternion.clone();
    this.model = torchModel();
    this.model.visible = false;
    // a little light bouncing back off what's ahead, so you see the torch and your hand at night
    this.glow = new THREE.PointLight(0xfff1dc, 0, 0.6, 2);
    this.glow.position.set(0, 0.03, -0.2);
    this.model.add(this.glow);
    game.vm.scene.add(this.model);
  },

  set(on, quiet = false) {
    this.make();
    this.on = on;
    if (on) this.flicker = FLICKER;
    this.press = 1;
    if (!quiet) audio.click();
  },

  update(dt, active) {
    const inp = game.input;
    if (active && !game.driving && !game.phoneOpen && inp.pressed.has('KeyL')) this.set(!this.on);
    // a hint the first time it gets dark
    if (active && !this.on && !this.hinted && game.day.daylight < 0.2 && !game.driving) {
      this.hinted = true;
      game.hud.toast("It's getting dark — press L for your flashlight");
    }
    if (!this.beam) return;

    // in the pickup your hands are on the wheel (its own lights are on L there)
    const lit = this.on && !game.driving;
    const cam = game.camera;
    // the beam trails your look a little, like a real hand
    this.look.slerp(cam.quaternion, Math.min(1, dt * 13));
    const b = this.beam;
    b.position.copy(BEAM_FROM).applyQuaternion(cam.quaternion).add(cam.position);
    _f.set(0, 0, -1).applyQuaternion(this.look);
    b.target.position.copy(b.position).addScaledVector(_f, 10);
    b.target.updateMatrixWorld();

    let k = lit ? 1 : 0;
    if (lit && this.flicker > 0) {
      this.flicker -= dt;
      k = Math.random() < 0.45 ? 0.15 : 0.6 + Math.random() * 0.4;
    }
    b.intensity = POWER * k;
    b.shadow.autoUpdate = lit;
    if (lit) b.shadow.needsUpdate = true;

    // the torch in your hand: comes up when on, goes down when off or in the car / on the phone
    const m = this.model, vm = game.vm;
    const want = this.on && !game.driving && !game.phoneOpen ? 1 : 0;
    this.up = lerp(this.up, want, Math.min(1, dt * 7));
    m.visible = this.up > 0.02 && vm.root.visible !== false;
    this.press = Math.max(0, this.press - dt * 6);
    const u = m.userData;
    u.btn.position.y = 0.021 - 0.003 * this.press;
    u.lens.emissiveIntensity = 3 * k;
    this.glow.intensity = 0.25 * k;
    // follow the beam's lag and the right hand's walking bob/sway, mirrored
    _q.copy(cam.quaternion).invert().multiply(this.look);
    m.quaternion.copy(_q);
    m.rotateY(-0.22); // pointing in a little, so you see its side
    _v.copy(HAND_ON);
    _v.x -= vm.sway.x * 0.8;
    _v.y += vm.sway.y * 0.8 - 0.35 * (1 - this.up) - Math.abs(Math.sin(vm.bobPh + 1.4)) * 0.01 * clamp(game.player.speedH / 5, 0, 1.4);
    m.position.copy(_v);
  },
};
