import * as CANNON from 'cannon-es';
import { terrainHeight } from './terrain.js';
export { CANNON };

export const GROUP = { GROUND: 1, STATIC: 2, PIECE: 4, PLAYER: 8, TREE: 16, CAR: 32 };
export const MASK = { ALL: 63, NO_PLAYER: 1 | 2 | 4 | 16 | 32 };

export const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 16;
world.solver.tolerance = 1e-4;
world.defaultContactMaterial.friction = 0.5;
world.defaultContactMaterial.restitution = 0.02;

export const MAT = {
  ground: new CANNON.Material('ground'),
  wood: new CANNON.Material('wood'),
  player: new CANNON.Material('player'),
  steel: new CANNON.Material('steel'),
  car: new CANNON.Material('car'),
  brick: new CANNON.Material('brick'),
  towed: new CANNON.Material('towed'),
};
world.addContactMaterial(new CANNON.ContactMaterial(MAT.ground, MAT.wood, { friction: 0.8, restitution: 0.02 }));
world.addContactMaterial(new CANNON.ContactMaterial(MAT.wood, MAT.wood, { friction: 0.65, restitution: 0.02 }));
world.addContactMaterial(new CANNON.ContactMaterial(MAT.player, MAT.ground, { friction: 0, restitution: 0 }));
world.addContactMaterial(new CANNON.ContactMaterial(MAT.player, MAT.wood, { friction: 0, restitution: 0 }));
world.addContactMaterial(new CANNON.ContactMaterial(MAT.steel, MAT.wood, { friction: 0.22, restitution: 0.02 }));
world.addContactMaterial(new CANNON.ContactMaterial(MAT.player, MAT.steel, { friction: 0, restitution: 0 }));
// the pickup: logs grip its bed, it slides along trees and the ground instead of sticking
world.addContactMaterial(new CANNON.ContactMaterial(MAT.car, MAT.wood, { friction: 0.6, restitution: 0.02 }));
world.addContactMaterial(new CANNON.ContactMaterial(MAT.car, MAT.ground, { friction: 0.3, restitution: 0 }));
world.addContactMaterial(new CANNON.ContactMaterial(MAT.player, MAT.car, { friction: 0, restitution: 0 }));
// brick walls, door and window frames: you slide along them, wood grips them
world.addContactMaterial(new CANNON.ContactMaterial(MAT.player, MAT.brick, { friction: 0, restitution: 0 }));
world.addContactMaterial(new CANNON.ContactMaterial(MAT.wood, MAT.brick, { friction: 0.7, restitution: 0.02 }));
world.addContactMaterial(new CANNON.ContactMaterial(MAT.car, MAT.brick, { friction: 0.2, restitution: 0.05 }));
// wood on the rope: no friction with the ground here, rope.js drags it (cannon locks anything that
// touches the ground at two or more points)
world.addContactMaterial(new CANNON.ContactMaterial(MAT.towed, MAT.ground, { friction: 0, restitution: 0.02 }));
world.addContactMaterial(new CANNON.ContactMaterial(MAT.towed, MAT.wood, { friction: 0.2, restitution: 0.02 }));
world.addContactMaterial(new CANNON.ContactMaterial(MAT.towed, MAT.car, { friction: 0.2, restitution: 0.02 }));

export const FIXED = 1 / 120;
export function stepPhysics(dt) {
  world.step(FIXED, dt, 10);
}

export const v3 = (v) => new CANNON.Vec3(v.x, v.y, v.z);

export const refs = { ground: null }; // the ground's body (world.js sets it)

// Cannon's ray test against the heightfield misses about half the time, so the
// ground is found by walking along the ray over the real terrain instead.
function terrainRay(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6 || from.y < terrainHeight(from.x, from.z)) return null;
  const steps = Math.ceil(len / 0.1);
  let lo = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (from.y + dy * t > terrainHeight(from.x + dx * t, from.z + dz * t)) { lo = t; continue; }
    let hi = t;
    for (let k = 0; k < 14; k++) {
      const m = (lo + hi) / 2;
      if (from.y + dy * m > terrainHeight(from.x + dx * m, from.z + dz * m)) lo = m; else hi = m;
    }
    const x = from.x + dx * hi, z = from.z + dz * hi;
    const e = 0.05, gx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e), gz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
    const n = new CANNON.Vec3(-gx, 1, -gz);
    n.normalize();
    return { body: refs.ground, shape: null, point: new CANNON.Vec3(x, terrainHeight(x, z), z), normal: n, dist: len * hi };
  }
  return null;
}

const _res = new CANNON.RaycastResult();
export function rayClosest(from, to, mask = MASK.NO_PLAYER) {
  _res.reset();
  world.raycastClosest(from, to, { collisionFilterMask: mask & ~GROUP.GROUND, skipBackfaces: true }, _res);
  const hit = _res.hasHit ? {
    body: _res.body,
    shape: _res.shape,
    point: _res.hitPointWorld.clone(),
    normal: _res.hitNormalWorld.clone(),
    dist: _res.distance,
  } : null;
  if (!(mask & GROUP.GROUND)) return hit;
  const g = terrainRay(from, to);
  return g && (!hit || g.dist < hit.dist) ? g : hit;
}
