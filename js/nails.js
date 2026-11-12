// Nails and the joints they make. Any nail locks two pieces together, the way
// they were lying when you nailed them.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { world, CANNON, GROUP } from './physics.js';

export const NAIL_LEN = 0.09;
export const allNails = new Set();
export const joints = new Map();
export const events = { onBreak: null };

const BEND_CHANCE = 0.07;
const DOWN = new THREE.Vector3(0, -1, 0);
let geoStraight, geoBent, mat;

export function initNails() {
  const shaft = new THREE.CylinderGeometry(0.0022, 0.0019, NAIL_LEN, 6, 1);
  shaft.translate(0, -NAIL_LEN / 2, 0);
  const head = new THREE.CylinderGeometry(0.0058, 0.0058, 0.0025, 10, 1);
  head.translate(0, 0.00125, 0);
  const tip = new THREE.ConeGeometry(0.0019, 0.006, 6);
  tip.rotateX(Math.PI);
  tip.translate(0, -NAIL_LEN - 0.003, 0);
  geoStraight = mergeGeometries([shaft, head, tip]);

  // Bent: the part still outside the wood folds over to the side.
  const lower = new THREE.CylinderGeometry(0.0022, 0.0019, 0.05, 6, 1);
  lower.translate(0, -0.065, 0);
  const upper = mergeGeometries([
    new THREE.CylinderGeometry(0.0022, 0.0022, 0.04, 6, 1).translate(0, -0.02, 0),
    head.clone(),
  ]);
  upper.translate(0, 0.04, 0).rotateZ(1.05).translate(0, -0.04, 0);
  geoBent = mergeGeometries([lower, upper]);

  mat = new THREE.MeshStandardMaterial({ color: 0xb4babe, metalness: 0.35, roughness: 0.4 });
}

function placeMesh(n) {
  const k = NAIL_LEN * (1 - n.depth);
  n.mesh.position.set(n.lp.x - n.ld.x * k, n.lp.y - n.ld.y * k, n.lp.z - n.ld.z * k);
}

export function headWorld(n, out) {
  return n.mesh.getWorldPosition(out);
}

// A new nail resting on the surface of `host`, pointing along dirW.
export function addNail(host, entryW, dirW) {
  const lp = host.body.pointToLocalFrame(new CANNON.Vec3(entryW.x, entryW.y, entryW.z));
  const ld = host.body.vectorToLocalFrame(new CANNON.Vec3(dirW.x, dirW.y, dirW.z));
  ld.normalize();
  const mesh = new THREE.Mesh(geoStraight, mat);
  mesh.castShadow = true;
  mesh.quaternion.setFromUnitVectors(DOWN, new THREE.Vector3(ld.x, ld.y, ld.z));
  host.mesh.add(mesh);
  const n = { host, lp, ld, depth: 0, bent: false, other: null, iface: 0, joint: null, mesh };
  host.nails.push(n);
  allNails.add(n);
  placeMesh(n);
  return n;
}

// One hammer hit. Returns 'ok' | 'done' | 'bent' | 'stuck'.
export function hitNail(n, allowBend = true) {
  if (n.bent || n.depth >= 1) return 'stuck';
  if (allowBend && n.depth > 0.3 && Math.random() < BEND_CHANCE) {
    n.bent = true;
    n.mesh.geometry = geoBent;
    if (n.joint) rebuild(n.joint);
    return 'bent';
  }
  n.depth = Math.min(1, n.depth + (n.depth === 0 ? 0.5 : 0.25));
  placeMesh(n);
  if (!n.other) findOther(n);
  if (n.joint) rebuild(n.joint);
  return n.depth >= 1 ? 'done' : 'ok';
}

// Did the nail come out the back of the host and into something else?
function findOther(n) {
  const b = n.host.body;
  const from = b.pointToWorldFrame(n.lp);
  const dir = b.vectorToWorldFrame(n.ld);
  const reach = NAIL_LEN * n.depth;
  let best = null;
  world.raycastAll(
    from.vadd(dir.scale(0.001)),
    from.vadd(dir.scale(reach)),
    { collisionFilterMask: GROUP.PIECE | GROUP.TREE | GROUP.STATIC, skipBackfaces: true },
    (r) => {
      if (r.body === b) return;
      if (!best || r.distance < best.d) best = { body: r.body, d: r.distance + 0.001 };
    },
  );
  if (!best) return;
  n.other = best.body;
  n.iface = best.d;
  const j = jointFor(b, best.body);
  j.nails.add(n);
  n.joint = j;
}

function jointFor(a, b) {
  const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
  let j = joints.get(key);
  if (!j) {
    j = { key, a, b, nails: new Set(), c: null, strength: 0, lock: false };
    joints.set(key, j);
    a.piece?.joints.add(j);
    b.piece?.joints.add(j);
  }
  return j;
}

const isStatic = (b) => b.type === CANNON.Body.STATIC;

export function rebuild(j) {
  if (j.c) { world.removeConstraint(j.c); j.c = null; }
  const good = [...j.nails];
  if (!good.length) {
    joints.delete(j.key);
    j.a.piece?.joints.delete(j);
    j.b.piece?.joints.delete(j);
    return;
  }
  j.strength = good.reduce((s, n) => s + n.depth * (n.bent ? 0.45 : 1), 0);
  j.lock = true;
  if (isStatic(j.a) && isStatic(j.b)) return;
  // Every nail holds the pieces exactly the way they were when you nailed them.
  // (Locked pieces can't move against each other, so they don't need to collide.)
  j.c = new CANNON.LockConstraint(j.a, j.b, { maxForce: 1e8 });
  for (const eq of j.c.equations) eq.setSpookParams(1e9, 3, 1 / 120); // much stiffer than the default
  j.c.collideConnected = false;
  world.addConstraint(j.c);
  j.a.wakeUp();
  j.b.wakeUp();
}

export function breakJoint(j) {
  for (const n of j.nails) {
    n.other = null;
    n.joint = null;
    n.depth = Math.min(n.depth, 0.55);
    placeMesh(n);
  }
  j.nails.clear();
  rebuild(j);
  events.onBreak?.(j);
}

// The hammer claw. Returns true if the nail is good to use again.
export function pullNail(n) {
  const j = n.joint;
  n.host.mesh.remove(n.mesh);
  allNails.delete(n);
  const i = n.host.nails.indexOf(n);
  if (i >= 0) n.host.nails.splice(i, 1);
  if (j) { j.nails.delete(n); rebuild(j); }
  return !n.bent;
}

// ───────── saving and loading ─────────

// What a nail needs to come back: where it sits in its host, how deep, and what it went into.
// other: { piece: id } for wood, 'tree' / 'static' for anything else (found again by its ray).
export function nailState(n) {
  const r = (v) => Math.round(v * 1e5) / 1e5;
  const o = n.other;
  return {
    lp: [r(n.lp.x), r(n.lp.y), r(n.lp.z)], ld: [r(n.ld.x), r(n.ld.y), r(n.ld.z)],
    depth: n.depth, bent: n.bent,
    other: !o ? null : o.piece ? { piece: o.piece.id } : o.tree ? { tree: o.tree.i } : 'static',
  };
}

// Put a saved nail back in its host. Joints are made afterwards (linkNail / relinkNail, then rebuildAll),
// once everything it can go into is back too.
export function restoreNail(host, s) {
  const lp = new CANNON.Vec3(...s.lp), ld = new CANNON.Vec3(...s.ld);
  const mesh = new THREE.Mesh(s.bent ? geoBent : geoStraight, mat);
  mesh.castShadow = true;
  mesh.quaternion.setFromUnitVectors(DOWN, new THREE.Vector3(ld.x, ld.y, ld.z));
  host.mesh.add(mesh);
  const n = { host, lp, ld, depth: s.depth, bent: s.bent, other: null, iface: 0, joint: null, mesh };
  host.nails.push(n);
  allNails.add(n);
  placeMesh(n);
  return n;
}

// The nail went into this body (known from the save).
export function linkNail(n, body) {
  n.other = body;
  const j = jointFor(n.host.body, body);
  j.nails.add(n);
  n.joint = j;
}

// The nail went into something that isn't wood (a wall, a stump, a tree): find it again along the nail.
export function relinkNail(n) {
  if (n.depth > 0 && !n.other) findOther(n);
  return !!n.other;
}

// Lock every joint once, after a load (each lock keeps the pieces exactly where they were saved).
export function rebuildAll() {
  for (const j of [...joints.values()]) rebuild(j);
}

// A body is going away (a tree was cut down): let go of everything nailed to it.
export function detachBody(body) {
  for (const j of [...joints.values()]) if (j.a === body || j.b === body) breakJoint(j);
}

// Is this piece nailed (directly or through other pieces) to something that can't move?
export function isFixed(p, seen = new Set()) {
  seen.add(p.body);
  for (const j of p.joints) {
    const o = j.a === p.body ? j.b : j.a;
    if (seen.has(o)) continue;
    if (isStatic(o) || (o.piece && isFixed(o.piece, seen))) return true;
  }
  return false;
}

// The physics engine lets still bodies fall asleep, and a joint does not wake them.
// So if one piece of a nailed group moves, wake the pieces nailed to it.
export function wakeLinked() {
  for (const j of joints.values()) {
    if (!j.c) continue;
    const a = j.a, b = j.b;
    if (a.sleepState === CANNON.Body.SLEEPING && moving(b)) a.wakeUp();
    else if (b.sleepState === CANNON.Body.SLEEPING && moving(a)) b.wakeUp();
  }
}

// (only real movement counts, or two resting pieces would keep waking each other)
const moving = (b) => !isStatic(b) && b.sleepState !== CANNON.Body.SLEEPING && (b.velocity.lengthSquared() > 0.003 || b.angularVelocity.lengthSquared() > 0.01);
