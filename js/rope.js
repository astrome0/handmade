// The rope (hotbar slot 6). Click a piece: you wrap the rope round its end and hold the other end.
// Walk it over to the pickup (the rope is 8 m long) and click the truck: it is tied to the ring on
// the back, and the truck drags what you could never carry (you lift 60 kg). With the end in your
// hand you can pull too, but only a little. Right click lets go / unties.
// Only pulls, never pushes: it hangs slack until it is stretched.
import * as THREE from 'three';
import { world, CANNON, MAT } from './physics.js';
import { game } from './game.js';
import { car } from './car.js';
import { pieces } from './items.js';
import { isFixed } from './nails.js';
import { audio } from './audio.js';
import { terrainHeight } from './terrain.js';

const COM = 0.6;
const HITCH = new CANNON.Vec3(-2.36, 0.5 - COM, 0); // the ring on the tailgate, in body coordinates
export const ROPE_LEN = 8;
const HAND_PULL = 450;  // N: what you manage by hand (a thin log, slowly; not a big one)
const SNAP = 2.5;       // stretched this far past its length, the knot gives
const mat = new THREE.MeshStandardMaterial({ color: 0xb99a66, roughness: 1 });

// on: { p, body, local, mat } the wrapped piece; to: 'hand' | 'car'
export const rope = { on: null, to: null, len: ROPE_LEN, mesh: null, F: 0 };

const hitchWorld = () => car.body.pointToWorldFrame(HITCH);
const endWorld = () => rope.on.body.pointToWorldFrame(rope.on.local);
const _hand = new THREE.Vector3();
function handWorld() {
  // a bit right of and below your eyes, where the arm holds it
  return game.camera.localToWorld(_hand.set(0.28, -0.32, -0.45));
}

// Cannon can't slide a body that touches the ground at two or more points: its friction solver locks
// it, and it creeps at ~6 cm/s whatever pulls it (that's why logs felt glued down). So wood on the
// rope has no cannon friction with the ground (MAT.towed), and drags with this instead: easier
// along the grain than sideways, like a real dragged log.
const MU_ALONG = 0.5, MU_ACROSS = 0.8;
function groundDrag(p) {
  const b = p.body;
  let touching = false;
  for (const c of world.contacts) if ((c.bi === b && c.bj.isGround) || (c.bj === b && c.bi.isGround)) { touching = true; break; }
  if (!touching) return;
  const N = b.mass * 9.82;
  const ax = b.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
  ax.y = 0;
  if (ax.length() < 0.2) ax.set(1, 0, 0); // standing on end: no "along"
  ax.normalize();
  const v = b.velocity;
  const along = v.x * ax.x + v.z * ax.z;
  const sx = v.x - ax.x * along, sz = v.z - ax.z * along;
  // full friction from 0.25 m/s up, less below it, so it settles instead of jittering
  const fa = -MU_ALONG * N * Math.max(-1, Math.min(1, along / 0.25));
  const sl = Math.hypot(sx, sz), fs = sl > 1e-4 ? (MU_ACROSS * N * Math.min(1, sl / 0.25)) / sl : 0;
  b.applyForce(new CANNON.Vec3(ax.x * fa - sx * fs, 0, ax.z * fa - sz * fs));
  b.angularVelocity.y *= 1 - Math.min(1, 4 * world.dt); // it doesn't spin freely on the ground
}

// Click with the rope: wrap it round a piece, or tie the end you hold to the truck.
export function ropeClick(a) {
  if (!rope.on) {
    const p = a.piece;
    if (!p || a.dist > 3) return;
    if (p.anchored || isFixed(p)) { game.hud.toast('That one is fixed down. The rope can\'t move it.'); return; }
    // round the end nearer to where you looked, so a log trails behind end-first
    const lp = p.body.pointToLocalFrame(new CANNON.Vec3(a.point.x, a.point.y, a.point.z));
    rope.on = { p, body: p.body, local: new CANNON.Vec3(0, Math.sign(lp.y || 1) * p.len * 0.45, 0), mat: p.body.material };
    p.body.material = MAT.towed;
    rope.to = 'hand';
    rope.len = ROPE_LEN;
    game.vm.swing('lay');
    audio.pickup();
    game.hud.toast('Rope wrapped round it. Take the other end to your truck.');
    return;
  }
  if (rope.to === 'hand' && a.car && a.dist <= 3.2) {
    const d = hitchWorld().distanceTo(endWorld());
    if (d > ROPE_LEN) { game.hud.toast('The rope doesn\'t reach. Park the truck closer.'); return; }
    rope.to = 'car';
    rope.len = Math.max(2, d + 0.2);
    game.vm.swing('lay');
    audio.pickup();
    game.hud.toast('Tied to the truck. Drive off slowly.');
  }
}

// Saving: only a rope tied to the truck stays (an end in your hand is let go).
export function saveRope() {
  if (rope.to !== 'car') return null;
  const l = rope.on.local;
  return { piece: rope.on.p.id, local: [l.x, l.y, l.z], len: rope.len };
}

export function loadRope(s, p) {
  if (!s || !p) return;
  rope.on = { p, body: p.body, local: new CANNON.Vec3(...s.local), mat: p.body.material };
  p.body.material = MAT.towed;
  rope.to = 'car';
  rope.len = s.len;
}

// Right click: let go of the end you hold, or untie it from the truck and the wood.
export function ropeBack(quiet) {
  if (!rope.on) return;
  rope.on.body.material = rope.on.mat;
  rope.on = null;
  rope.to = null;
  if (rope.mesh) rope.mesh.visible = false;
  if (!quiet) { audio.pickup(); game.hud.toast('You coiled the rope up again.'); }
}

// The pull: spring + damper along the rope, only while it is stretched.
world.addEventListener('preStep', () => {
  const r = rope.on;
  if (!r || !pieces.has(r.p)) return;
  const p = r.body;
  if (p.sleepState !== CANNON.Body.SLEEPING) groundDrag(r.p);
  const E = endWorld();
  if (rope.to === 'car') {
    const b = car.body, H = hitchWorld();
    const d = new CANNON.Vec3(E.x - H.x, E.y - H.y, E.z - H.z);
    const dist = d.length(), stretch = dist - rope.len;
    if (stretch <= 0) { rope.F = 0; return; }
    p.wakeUp();
    d.scale(1 / dist, d);
    // A rope doesn't stretch: stop the ends moving apart (and pull back what it did stretch) with
    // one impulse. A spring here shook back and forth and held the truck back.
    const rE = E.vsub(p.position), rH = H.vsub(b.position);
    rH.y = 0; // the truck feels it at the height of its centre: it turns the truck, but never lifts the nose
    const vH = b.velocity.vadd(b.angularVelocity.cross(rH));
    const vE = p.velocity.vadd(p.angularVelocity.cross(rE));
    const dt = world.dt;
    // (what it did stretch comes back gently: a stiff correction yanked the truck back)
    const apart = vE.vsub(vH).dot(d) + Math.min(stretch * 8, 2);
    if (apart <= 0) { rope.F = 0; return; }
    const dh = new CANNON.Vec3(d.x, 0, d.z);
    const angE = p.invInertiaWorld.vmult(rE.cross(d)).cross(rE).dot(d);
    const angH = b.invInertiaWorld.vmult(rH.cross(dh)).cross(rH).dot(dh);
    const j = apart / (p.invMass + angE + b.invMass * dh.dot(d) + angH);
    rope.F = j / dt;
    p.applyImpulse(new CANNON.Vec3(-d.x * j, -d.y * j, -d.z * j), rE);
    b.applyImpulse(new CANNON.Vec3(d.x * j, 0, d.z * j), rH);
  } else if (rope.to === 'hand' && !game.driving) {
    const pb = game.player.body;
    const d = new CANNON.Vec3(pb.position.x - E.x, 0, pb.position.z - E.z);
    const dist = d.length(), stretch = dist - rope.len;
    if (stretch <= 0) { rope.F = 0; return; }
    d.scale(1 / dist, d);
    // you lean on it: a little pull on the wood, and the rope holds you back
    p.wakeUp();
    const F = (rope.F = Math.min(HAND_PULL, stretch * 2500));
    p.applyForce(new CANNON.Vec3(d.x * F, F * 0.15, d.z * F), E.vsub(p.position));
    const out = pb.velocity.x * d.x + pb.velocity.z * d.z;
    if (out > 0) { pb.velocity.x -= d.x * out; pb.velocity.z -= d.z * out; }
    if (stretch > 0.3) { pb.position.x -= d.x * (stretch - 0.3); pb.position.z -= d.z * (stretch - 0.3); }
  }
});

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Vector3();

// Every frame: look after the rope and draw it (it hangs in a curve when slack).
export function updateRope() {
  const r = rope.on;
  if (!r) return;
  if (!pieces.has(r.p) || r.p.held || r.p.anchored) { ropeBack(true); game.hud.toast('The rope came off.'); return; }
  // the end in your hand goes when you put the rope away or get in the truck
  if (rope.to === 'hand' && (game.driving || game.tools.tool !== 'rope')) { ropeBack(true); game.hud.toast('You let go of the rope.'); return; }
  const E = endWorld();
  _b.set(E.x, E.y, E.z);
  if (rope.to === 'car') {
    const H = hitchWorld();
    _a.set(H.x, H.y, H.z);
    if (_a.distanceTo(_b) - rope.len > SNAP) { ropeBack(true); audio.thud(); game.hud.toast('The rope came untied!'); return; }
  } else {
    game.camera.updateMatrixWorld();
    _a.copy(handWorld());
  }
  const dist = _a.distanceTo(_b);
  const sag = Math.max(0, rope.len - dist) * 0.45 + 0.03;
  _m.addVectors(_a, _b).multiplyScalar(0.5);
  _m.y = Math.max(_m.y - sag, terrainHeight(_m.x, _m.z) + 0.03);
  const geo = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(_a.clone(), _m.clone(), _b.clone()), 16, 0.022, 6, false);
  if (!rope.mesh) {
    rope.mesh = new THREE.Mesh(geo, mat);
    rope.mesh.castShadow = true;
    rope.mesh.frustumCulled = false;
    game.scene.add(rope.mesh);
  } else {
    rope.mesh.geometry.dispose();
    rope.mesh.geometry = geo;
  }
  rope.mesh.visible = true;
}

// What the hint line says with the rope in your hand.
export function ropeHints(a) {
  if (!rope.on) return a.piece && !a.piece.anchored && a.dist <= 3 ? [['Click', 'Wrap the rope round it']] : [['', 'Rope · 8 m · wrap it round wood you can\'t lift']];
  if (rope.to === 'hand') {
    const L = [];
    if (a.car && a.dist <= 3.2) L.push(['Click', 'Tie it to the truck']);
    else L.push(['', `Take the end to your truck · ${Math.min(ROPE_LEN, game.player.body.position.distanceTo(endWorld())).toFixed(1)} / ${ROPE_LEN} m`]);
    L.push(['Right click', 'Let go']);
    return L;
  }
  return [['Right click', 'Untie the rope']];
}
