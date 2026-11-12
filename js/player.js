// First-person body: walk, run, jump, look. The body is two physics spheres.
import * as THREE from 'three';
import { world, CANNON, GROUP, MASK, MAT, rayClosest } from './physics.js';
import { terrainHeight, HALF } from './terrain.js';
import { game } from './game.js';
import { audio } from './audio.js';
import { clamp } from './util.js';

const R = 0.34, EYE = 1.27, LIMIT = HALF - 8;
const WALK = 4.3, RUN = 7.0, SNEAK = 1.7, JUMP = 5.2;
const FLY = 9, FLY_FAST = 20; // creative
const CROUCH_DROP = 0.45; // how much lower your eyes go when crouching
const FOV = 72, FOV_RUN = 80;
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 2.6;
    this.pitch = -0.08;
    this.grounded = false;
    this.speedH = 0;
    this.bob = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.sens = 0.0022;
    this.sprint = false;
    this.lastW = -1;
    this.crouchK = 0;

    this.body = new CANNON.Body({
      mass: 70, material: MAT.player, fixedRotation: true, linearDamping: 0,
      collisionFilterGroup: GROUP.PLAYER, collisionFilterMask: GROUP.GROUND | GROUP.STATIC | GROUP.PIECE | GROUP.TREE | GROUP.CAR,
      allowSleep: false,
    });
    this.body.addShape(new CANNON.Sphere(R), new CANNON.Vec3(0, 0, 0));
    this.body.addShape(new CANNON.Sphere(R * 0.95), new CANNON.Vec3(0, 0.82, 0));
    this.body.updateMassProperties();
    const sx = -1.2, sz = 2.4;
    this.body.position.set(sx, terrainHeight(sx, sz) + R + 0.05, sz);
    world.addBody(this.body);
    world.addEventListener('preStep', () => {
      if (this.anchor) { this.body.velocity.x = 0; this.body.velocity.z = 0; }
      if (this.flying) this.body.applyForce(new CANNON.Vec3(0, this.body.mass * 9.82, 0)); // no gravity while flying
    });

    document.addEventListener('mousemove', (e) => {
      if (!game.playing) return;
      this.look(e.movementX, e.movementY);
    });
  }

  look(dx, dy) {
    this.yaw -= dx * this.sens;
    this.pitch = clamp(this.pitch - dy * this.sens, -1.52, 1.52);
    this.lookDX += dx;
    this.lookDY += dy;
  }

  get feet() { return this.body.position.y - R; }

  update(dt) {
    const k = game.input.keys, b = this.body;
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * f + cos * s, wz = -cos * f - sin * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    // creative: F flies (Space up, Shift down, F again to land)
    if (game.input.pressed.has('KeyF') && game.mode?.fly) {
      this.flying = !this.flying;
      game.hud.toast(this.flying ? 'Flying · Space up · Shift down · F to land' : 'Landing');
    }
    if (this.flying) {
      if (game.input.pressed.has('KeyW') && game.uTime.value - this.lastW < 0.3) this.sprint = true;
      if (game.input.pressed.has('KeyW')) this.lastW = game.uTime.value;
      if (f <= 0) this.sprint = false;
      const sp = this.sprint ? FLY_FAST : FLY;
      const up = (k.has('Space') ? 1 : 0) - (k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0);
      const a = Math.min(1, 10 * dt);
      b.velocity.x += (wx * sp - b.velocity.x) * a;
      b.velocity.z += (wz * sp - b.velocity.z) * a;
      b.velocity.y += (up * sp * 0.7 - b.velocity.y) * a;
      this.crouch = false;
      this.grounded = false;
      this.anchor = null;
      for (const ax of ['x', 'z']) b.position[ax] = clamp(b.position[ax], -LIMIT, LIMIT);
      b.position.y = Math.min(Math.max(b.position.y, terrainHeight(b.position.x, b.position.z) + R), 90);
      return;
    }

    // like Minecraft: Shift sneaks, double-tap W (or W then Ctrl) sprints
    this.crouch = k.has('ShiftLeft') || k.has('ShiftRight');
    const now = game.uTime.value;
    if (game.input.pressed.has('KeyW')) {
      if (now - this.lastW < 0.3) this.sprint = true;
      this.lastW = now;
    }
    if (f > 0 && (k.has('ControlLeft') || k.has('ControlRight'))) this.sprint = true;
    if (f <= 0 || this.crouch) this.sprint = false;
    const speed = (this.crouch ? SNEAK : this.sprint ? RUN : WALK) * (game.tools?.held ? 0.85 : 1);

    const from = new CANNON.Vec3(b.position.x, b.position.y, b.position.z);
    const hit = rayClosest(from, new CANNON.Vec3(from.x, from.y - R - 0.14, from.z), GROUP.GROUND | GROUP.STATIC | GROUP.PIECE | GROUP.TREE | GROUP.CAR);
    this.grounded = !!hit && b.velocity.y < 2.5;

    const accel = this.grounded ? 16 : 3;
    const a = Math.min(1, accel * dt);
    b.velocity.x += (wx * speed - b.velocity.x) * a;
    b.velocity.z += (wz * speed - b.velocity.z) * a;
    if (this.grounded && wl === 0 && Math.abs(b.velocity.y) < 1) {
      // standing still: feet stay where they are, even on a slope
      // (something else moved us, like a teleport or a truck: stand there instead)
      if (!this.anchor || Math.hypot(b.position.x - this.anchor.x, b.position.z - this.anchor.z) > 0.25) this.anchor = { x: b.position.x, z: b.position.z };
      b.position.x = this.anchor.x;
      b.position.z = this.anchor.z;
      b.velocity.x = 0;
      b.velocity.z = 0;
    } else this.anchor = null;
    if (this.grounded && game.input.pressed.has('Space')) { b.velocity.y = JUMP; this.anchor = null; }

    // the edge of the world: soft walls
    for (const ax of ['x', 'z']) {
      if (b.position[ax] > LIMIT) { b.position[ax] = LIMIT; b.velocity[ax] = Math.min(0, b.velocity[ax]); }
      if (b.position[ax] < -LIMIT) { b.position[ax] = -LIMIT; b.velocity[ax] = Math.max(0, b.velocity[ax]); }
    }
    if (b.position.y < terrainHeight(b.position.x, b.position.z) - 2) {
      b.position.y = terrainHeight(b.position.x, b.position.z) + 1;
      b.velocity.setZero();
    }
  }

  afterPhysics(dt) {
    const b = this.body;
    this.speedH = Math.hypot(b.velocity.x, b.velocity.z);
    const moving = this.grounded && this.speedH > 0.6;
    const before = this.bob;
    if (moving) this.bob += dt * (4.2 + this.speedH * 0.9);
    // footstep twice per bob cycle
    if (moving && Math.floor(before / Math.PI) !== Math.floor(this.bob / Math.PI)) audio.step();
    const amp = moving ? Math.min(this.speedH / 5, 1.3) : 0;
    const p = b.interpolatedPosition;
    this.crouchK += ((this.crouch ? 1 : 0) - this.crouchK) * Math.min(1, dt * 12);
    // a little wider view while sprinting
    const fov = this.sprint && this.speedH > 3 ? FOV_RUN : FOV;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(
      p.x + Math.cos(this.yaw) * Math.sin(this.bob) * 0.025 * amp,
      p.y + EYE - CROUCH_DROP * this.crouchK + Math.abs(Math.cos(this.bob)) * 0.045 * amp - 0.02 * amp,
      p.z - Math.sin(this.yaw) * Math.sin(this.bob) * 0.025 * amp,
    );
    this.camera.quaternion.setFromEuler(_e.set(this.pitch, this.yaw, 0));
  }
}
