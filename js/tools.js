// What your hands do: chop, saw, nail, carry.
import * as THREE from 'three';
import { world, CANNON, MASK, rayClosest } from './physics.js';
import { game } from './game.js';
import { crossCut, ripLog } from './items.js';
import { addNail, hitNail, pullNail, allNails, headWorld, isFixed, events as nailEvents } from './nails.js';
import { chopTree, chopStump, terrainHeight } from './world.js';
import { audio } from './audio.js';
import { particles } from './particles.js';
import { clamp } from './util.js';
import { workerInfo } from './workers.js';
import { personInfo } from './village.js';
import { woodValue } from './money.js';
import { sell, buyerHint } from './yard.js';
import { ropeClick, ropeBack, ropeHints } from './rope.js';
import { paintUpdate, takePaintThing, nextTool, thingInfo as paintThingInfo, thingHint as paintThingHint } from './paint.js';
import { target as brickTarget, showGhost, layBrick, takeBack, knockBrick, takeFrom, brickInfo, thingInfo, supplies, toggleDoor, putDown } from './masonry.js';
import { roadUpdate, roadR, takeStreetThing, putDownHeld, kit as roadKit, thingInfo as streetThingInfo, thingHint as streetThingHint, hidePlacing, lampHint, lampInfo, signInfo } from './streets.js';

export const SLOTS = [
  { id: 'axe', name: 'Axe' },
  { id: 'saw', name: 'Saw' },
  { id: 'hammer', name: 'Hammer & nails' },
  { id: 'hands', name: 'Hands' },
  { id: 'trowel', name: 'Trowel & bricks' },
  { id: 'rope', name: 'Rope' },
  { id: 'paint', name: 'Brush, roller & float' },
  { id: 'road', name: 'Shovel, rake & roller' },
];
const REACH = 3.0;
const CARRY_MAX = 60; // kg
const MODES = ['across', 'upright', 'flat', 'along'];

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _h = new THREE.Vector3(), _t = new THREE.Vector3();
const _mx = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const toThree = (v) => new THREE.Vector3(v.x, v.y, v.z);
// All loose pieces nailed together with p (p included).
function nailedGroup(p, out = new Set()) {
  out.add(p);
  for (const j of p.joints) {
    const o = (j.a === p.body ? j.b : j.a).piece;
    if (o && !o.anchored && !out.has(o)) nailedGroup(o, out);
  }
  return out;
}
// Everything nailed together moves together, so it weighs as much as all of it.
const groupMass = (p) => [...nailedGroup(p)].reduce((m, q) => m + q.mass, 0);

export class Tools {
  constructor() {
    this.slot = 0;
    this.nails = 40;
    this.cool = 0;
    this.pending = null;  // a swing waiting for the moment it lands
    this.held = null;     // { p, mode, far }
    this.saw = { key: null, p: 0 };
    this.aim = null;
    this.carryPos = new CANNON.Vec3();
    this.carryGrip = new CANNON.Vec3();
    this.carryQuat = new CANNON.Quaternion();
    this.markers = this.makeMarkers();
    this.brickRot = 0;     // R: 0 a brick along, 1 turned a quarter, 2 a half brick
    this.brick = null;     // where the next brick would go
    world.addEventListener('preStep', () => this.carryStep());
    nailEvents.onBreak = () => audio.tear();
    game.hud.setNails(this.nails);
    game.hud.select(0);
  }

  get tool() { return SLOTS[this.slot].id; }

  select(i) {
    if (i === this.slot) return;
    this.slot = i;
    this.saw.key = null;
    this.saw.p = 0;
    this.pending = null;
    game.vm.equip(this.tool);
    game.hud.select(i);
    game.hud.progress(0);
  }

  makeMarkers() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }); // a chalk line
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 28, 1, true), mat);
    const line = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    ring.renderOrder = line.renderOrder = 2;
    return { ring, line, owner: null };
  }

  // ───────── aiming ─────────

  computeAim() {
    const cam = game.camera;
    cam.getWorldPosition(_o);
    cam.getWorldDirection(_d);
    const from = new CANNON.Vec3(_o.x, _o.y, _o.z);
    const to = new CANNON.Vec3(_o.x + _d.x * REACH, _o.y + _d.y * REACH, _o.z + _d.z * REACH);
    const hit = rayClosest(from, to, MASK.NO_PLAYER);
    const a = { origin: _o.clone(), dir: _d.clone(), dist: REACH, point: null, normal: null, body: null, piece: null, tree: null, stump: null, nailbox: false, crate: null, car: null, brick: null, thing: null, ground: false, nail: null };
    if (hit) {
      a.dist = hit.dist;
      a.point = toThree(hit.point);
      a.normal = toThree(hit.normal);
      a.body = hit.body;
      a.piece = hit.body.piece || null;
      a.tree = hit.body.tree || null;
      a.stump = hit.body.stump || null;
      a.nailbox = !!hit.body.nailbox;
      a.crate = hit.body.nailCrate || null;
      a.car = hit.body.car || null;
      a.brick = hit.shape?.brick || null;
      a.thing = hit.body.thing || null;
      a.paintThing = hit.body.paintThing || null;
      a.streetThing = hit.body.streetThing || null;
      a.lamp = hit.body.lamp || null;
      a.sign = hit.body.sign || null;
      a.worker = hit.body.worker || null;
      a.villager = hit.body.villager || null;
      a.buyer = !!hit.body.buyer;
      a.ground = !!hit.body.isGround;
    }
    // nail heads are tiny, so look for one close to the line of sight
    let bestT = a.dist + 0.05;
    for (const n of allNails) {
      headWorld(n, _h);
      _t.subVectors(_h, _o);
      const t = _t.dot(_d);
      if (t < 0 || t > bestT) continue;
      if (_t.addScaledVector(_d, -t).length() < 0.03) { a.nail = n; bestT = t; }
    }
    this.aim = a;
    return a;
  }

  // ───────── per frame ─────────

  update(dt) {
    const inp = game.input, tool = this.tool;
    this.cool -= dt;
    const a = this.computeAim();

    for (let i = 0; i < SLOTS.length; i++) if (inp.pressed.has(`Digit${i + 1}`)) this.select(i);
    if (inp.pressed.has('KeyE')) this.grabOrDrop();
    if (inp.pressed.has('KeyR') && this.held) this.turnHeld();
    else if (inp.pressed.has('KeyR') && tool === 'paint') nextTool();
    else if (inp.pressed.has('KeyR') && tool === 'road') roadR();
    else if (inp.pressed.has('KeyR') && tool === 'trowel') {
      this.brickRot = supplies.hold ? (this.brickRot ? 0 : 1) : (this.brickRot + 1) % 3;
      audio.pickup();
    }

    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) { const k = this.pending.kind; this.pending = null; this.impact(k); }
    }

    if (this.cool <= 0 && !this.pending) {
      if (tool === 'axe' && inp.lmb) this.startSwing('axe', 0.62, 0.22);
      else if (tool === 'hammer' && inp.lmb) this.startSwing('hammer', 0.34, 0.12);
      else if (tool === 'hammer' && inp.rmbDown) this.startSwing('pull', 0.55, 0.3);
      else if (tool === 'trowel' && inp.lmbDown && !this.held) this.startSwing('lay', 0.3, 0.14);
      else if (tool === 'trowel' && inp.rmbDown && a.brick) { takeBack(a.brick); game.vm.swing('lay'); this.cool = 0.25; }
    }
    if (tool === 'hands' && inp.lmbDown) this.grabOrDrop();
    if (tool === 'rope' && !this.held) {
      if (inp.lmbDown) ropeClick(a);
      if (inp.rmbDown) ropeBack();
    }

    this.brick = tool === 'trowel' && !this.held ? brickTarget(a, this.brickRot) : null;
    showGhost(this.brick);

    this.updateSaw(dt, tool, a);
    this.updateCarryTarget();
    this.updateHints(tool, a);
    if (tool === 'paint' && !this.held && !(a.paintThing && a.dist <= REACH)) paintUpdate(dt, a); // (its own hints)
    if (tool === 'road' && !this.held && !((a.streetThing || a.paintThing || a.thing || a.lamp?.broken) && a.dist <= REACH)) roadUpdate(dt, a);
    else if (tool === 'road') hidePlacing();
  }

  startSwing(kind, cool, at) {
    this.cool = cool;
    this.pending = { kind, t: at };
    game.vm.swing(kind);
    if (kind === 'axe') audio.swing();
  }

  impact(kind) {
    const a = this.computeAim();
    if (kind === 'axe') return this.axeHit(a);
    if (kind === 'hammer') return this.hammerHit(a);
    if (kind === 'pull') return this.clawPull(a);
    if (kind === 'lay') return layBrick(brickTarget(a, this.brickRot));
  }

  // ───────── axe ─────────

  axeHit(a) {
    if (!a.point || a.dist > 2.6) return;
    if (a.tree) {
      const left = chopTree(a.tree, a.origin);
      audio.chop();
      particles.emit('chip', a.point, a.normal, 9);
      if (left > 0 && left <= 2) particles.emit('chip', a.point, a.normal, 6);
    } else if (a.piece) {
      audio.woodKnock();
      particles.emit('chip', a.point, a.normal, 4);
      if (!a.piece.anchored) {
        a.piece.body.wakeUp();
        a.piece.body.applyImpulse(new CANNON.Vec3(a.dir.x * 25, 8, a.dir.z * 25), new CANNON.Vec3(a.point.x, a.point.y, a.point.z));
      }
    } else if (a.stump) {
      audio.chop();
      particles.emit('chip', a.point, a.normal, 9);
      if (chopStump(a.stump) === 0) {
        particles.emit('chip', a.point, a.normal, 14);
        audio.thud?.();
        game.hud.toast('Chopped the stump out — a short log is left');
      }
    } else if (a.ground) {
      audio.drop(0.6);
      particles.emit('dirt', a.point, a.normal, 10);
    }
  }

  // ───────── hammer ─────────

  // Logs and planks both work as posts/stakes, whichever end is up.
  canDrivePost(p, point) {
    if (p.drive >= 0.35 || p.kind === 'sheet') return false;
    const ax = p.axis();
    if (Math.abs(ax.y) < 0.8) return false;
    const up = Math.sign(ax.y);
    const lp = p.body.pointToLocalFrame(new CANNON.Vec3(point.x, point.y, point.z));
    if (lp.y * up < p.len / 2 - 0.12) return false;
    const bottom = p.end(-up);
    return bottom.y - terrainHeight(bottom.x, bottom.z) < 0.35;
  }

  drivePost(p) {
    if (this.held?.p === p) this.drop(true);
    const ax = p.axis();
    const bottom = p.end(-Math.sign(ax.y));
    p.drive = Math.min(0.36, p.drive + 0.12);
    if (!p.anchored) { p.anchored = true; p.makeStatic(); }
    const dy = bottom.y - (terrainHeight(bottom.x, bottom.z) - p.drive);
    p.body.position.vsub(ax.scale(dy / ax.y), p.body.position);
    p.body.aabbNeedsUpdate = true;
    p.sync();
    for (const j of p.joints) { j.a.wakeUp(); j.b.wakeUp(); }
    audio.woodKnock();
    particles.emit('dirt', toThree(bottom).setY(terrainHeight(bottom.x, bottom.z) + 0.03), UP, 8);
    if (p.drive >= 0.35) game.hud.toast('It is in deep. It will hold.');
  }

  hammerHit(a) {
    if (a.nail) {
      const r = hitNail(a.nail);
      if (r === 'bent') { audio.bend(); game.hud.toast('Bent the nail! Pull it out (right click) or use another.'); }
      else if (r === 'stuck') audio.woodKnock();
      else {
        audio.nailHit(r === 'done');
        headWorld(a.nail, _h);
        particles.emit('spark', _h, a.dir.clone().negate(), 2);
        if (r === 'done' && !a.nail.other) game.hud.toast('That nail went into nothing — there is no wood behind it.');
      }
      this.afterNail();
      return;
    }
    if (!a.point || a.dist > 2.6) return;
    if (a.brick) return knockBrick(a.brick, a.point, a.normal);
    if (a.piece) {
      if (this.canDrivePost(a.piece, a.point)) return this.drivePost(a.piece);
      if (this.nails <= 0) { audio.woodKnock(); game.hud.toast('No nails left. Take some from the crate at camp.'); return; }
      // nails go in mostly straight into the wood, a bit along your swing, never perfect
      const dir = a.normal.clone().negate().multiplyScalar(0.8).addScaledVector(a.dir, 0.2).normalize();
      dir.x += (Math.random() - 0.5) * 0.1;
      dir.y += (Math.random() - 0.5) * 0.1;
      dir.z += (Math.random() - 0.5) * 0.1;
      dir.normalize();
      const n = addNail(a.piece, a.point, dir);
      this.nails--;
      game.hud.setNails(this.nails);
      hitNail(n, false);
      audio.nailHit(false);
      this.afterNail();
      return;
    }
    if (a.tree || a.stump || a.nailbox) audio.woodKnock();
    else if (a.ground) { audio.drop(0.5); particles.emit('dirt', a.point, a.normal, 5); }
  }

  // Nailed to something that can't move (a post, a tree): you let go of it.
  // Nailed to loose wood: you keep holding the whole thing.
  afterNail() {
    const h = this.held;
    if (!h) return;
    if (isFixed(h.p)) {
      this.drop(true);
      game.hud.toast('Nailed tight!');
    } else this.setGroup(h);
  }

  clawPull(a) {
    if (!a.nail) return;
    const good = pullNail(a.nail);
    if (good) { this.nails++; game.hud.setNails(this.nails); }
    audio.pull();
  }

  // ───────── saw ─────────

  updateSaw(dt, tool, a) {
    const inp = game.input;
    const p = tool === 'saw' && a.piece && a.dist < 2.4 ? a.piece : null;
    const rip = inp.rmb && !inp.lmb;
    let showMarker = !!p && !rip;
    let sawing = false;

    if (p && (inp.lmb || inp.rmb)) {
      let block = null;
      if (p.falling) block = 'Wait until it has fallen.';
      else if (p.anchored) block = 'Pull it out of the ground first.';
      else if (p.nails.length || p.joints.size) block = 'Pull the nails out first.';
      else if (rip && p.kind !== 'log') block = 'Only logs can be sawn into planks.';
      else if (rip && p.len < 0.4) block = 'Too short to make planks.';
      if (block) {
        if (inp.lmbDown || inp.rmbDown) game.hud.toast(block);
      } else {
        const lp = p.body.pointToLocalFrame(new CANNON.Vec3(a.point.x, a.point.y, a.point.z));
        const key = rip ? `rip${p.id}` : `cut${p.id}:${Math.round(lp.y / 0.03)}`;
        if (key !== this.saw.key) { this.saw.key = key; this.saw.p = 0; }
        const time = rip ? 2.2 + p.r * 8 + p.len * 0.25 : p.kind === 'log' ? 1.0 + p.r * 9 : 0.7;
        this.saw.p += dt / time;
        sawing = true;
        if (Math.random() < dt * 30) particles.emit('sawdust', a.point, a.normal, 1);
        if (this.saw.p >= 1) {
          this.saw.p = 0;
          this.saw.key = null;
          if (this.held?.p === p) this.drop(true);
          const made = rip ? ripLog(p) : crossCut(p, a.point);
          if (made) {
            audio.cutDone();
            particles.emit('sawdust', a.point, a.normal, 18);
            if (rip) game.hud.toast(`${made.length} planks`);
          } else {
            game.hud.toast('Too close to the end to cut.');
          }
          showMarker = false;
        }
      }
    }
    if (!sawing && this.saw.p > 0) this.saw.p = Math.max(0, this.saw.p - dt * 0.5);
    game.vm.sawing = sawing;
    audio.sawing(sawing, game.vm.sawPh);
    game.hud.progress(sawing ? this.saw.p : 0);
    this.placeMarker(showMarker && !p?.dead ? p : null, a);
  }

  placeMarker(p, a) {
    const { ring, line } = this.markers;
    const m = p ? (p.kind === 'log' ? ring : line) : null;
    for (const x of [ring, line]) if (x !== m && x.parent) x.parent.remove(x);
    if (!m) return;
    if (m.parent !== p.mesh) p.mesh.add(m);
    const lp = p.body.pointToLocalFrame(new CANNON.Vec3(a.point.x, a.point.y, a.point.z));
    m.position.set(0, clamp(lp.y, -p.len / 2, p.len / 2), 0);
    if (p.kind === 'log') m.scale.set(p.r * 1.02, 0.01, p.r * 1.02);
    else m.scale.set(p.w + 0.004, 0.008, p.t + 0.004);
  }

  // ───────── carrying ─────────

  grabOrDrop() {
    if (this.held) return this.drop();
    const a = this.aim;
    if (a?.brick?.kind === 'door' && a.dist <= REACH) return toggleDoor(a.brick);
    if (a?.buyer && a.dist <= REACH) return sell();
    if (a?.worker?.ask && a.dist <= REACH) return a.worker.ask();
    if (a?.lamp?.broken && a.dist <= REACH) return a.lamp.fix();
    // carrying a lamp, sign or road paint and not taking a bag or tool: put it down
    if (roadKit.hold && !(a?.streetThing && a.dist <= REACH && ['gravel', 'asphalt', 'curbs', 'rtool'].includes(a.streetThing.kind))) return putDownHeld();
    // carrying a door or window and not taking anything: put it down in front of you
    if (supplies.hold && !((a?.thing || a?.paintThing) && a.dist <= REACH) && !(a?.car && a.dist <= REACH)) {
      const yaw = game.player.yaw, p = game.player.body.position;
      return putDown({ x: p.x - Math.sin(yaw) * 1.6, z: p.z - Math.cos(yaw) * 1.6 }, yaw);
    }
    if (!a || a.dist > REACH) return;
    if (a.crate) {
      a.crate.take();
      this.nails = Math.min(999, this.nails + 100);
      game.hud.setNails(this.nails);
      audio.nails();
      game.hud.toast(`+100 nails (${this.nails} in your pouch)`);
      return;
    }
    if (a.car) {
      if (a.car.auto) { game.hud.toast('Somebody from your crew is driving it'); return; }
      if (a.car.upright() < 0.5) a.car.flip();
      else a.car.enter();
      return;
    }
    if (a.thing) return takeFrom(a.thing);
    if (a.paintThing) return takePaintThing(a.paintThing);
    if (a.streetThing) return takeStreetThing(a.streetThing);
    if (a.nailbox) {
      if (this.nails >= 99) { game.hud.toast('Your pouch is full.'); return; }
      this.nails = 99;
      game.hud.setNails(this.nails);
      audio.nails();
      game.hud.toast('Filled your pouch: 99 nails');
      return;
    }
    const p = a.piece;
    if (!p) return;
    if (p.falling) return;
    if (p.anchored) {
      if (p.joints.size) { game.hud.toast('This post has nails in it. Pull them out first.'); return; }
      p.anchored = false;
      p.drive = 0;
      p.makeDynamic();
      p.body.position.y += 0.25;
      game.hud.toast('Pulled the post out of the ground.');
    } else if (isFixed(p)) {
      game.hud.toast('Nailed tight. Pull the nails with the hammer (right click).');
      return;
    }
    const mass = groupMass(p);
    if (mass > CARRY_MAX) {
      game.hud.toast(`Too heavy (${Math.round(mass)} kg). ${p.joints.size ? 'Pull some nails out first.' : 'Saw it shorter.'}`);
      return;
    }
    // nobody holds things perfectly straight: a few degrees off, different every time
    const wobble = new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.09, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.09));
    const lp = p.body.pointToLocalFrame(new CANNON.Vec3(a.point.x, a.point.y, a.point.z));
    const local = new CANNON.Vec3(0, clamp(lp.y, -p.len / 2, p.len / 2), 0);
    // keep the end you grabbed on the side of the screen where it was
    const ax = p.axis(), yaw = game.player.yaw;
    const side = ax.x * Math.cos(yaw) - ax.z * Math.sin(yaw) < 0 ? -1 : 1;
    this.held = { p, mode: this.bestMode(p), far: 0, wobble, local, side, mass, group: [] };
    p.held = true;
    this.setGroup(this.held);
    game.vm.carry = true;
    audio.pickup();
  }

  // What you are holding: the piece plus everything nailed to it.
  setGroup(h) {
    for (const q of h.group) q.body.collisionFilterMask = MASK.ALL;
    h.group = [...nailedGroup(h.p)];
    h.mass = h.group.reduce((m, q) => m + q.mass, 0);
    for (const q of h.group) { q.body.collisionFilterMask = MASK.NO_PLAYER; q.body.wakeUp(); }
  }

  drop(quiet) {
    if (!this.held) return;
    const p = this.held.p;
    p.held = false;
    for (const q of this.held.group) q.body.collisionFilterMask = MASK.ALL;
    this.held = null;
    game.vm.carry = false;
    if (!quiet) audio.pickup();
  }

  turnHeld() {
    const h = this.held;
    h.mode = MODES[(MODES.indexOf(h.mode) + 1) % MODES.length];
    audio.pickup();
  }

  // Pick the way of holding that is closest to how the piece lies now.
  // Short logs are almost always going to be posts, so they come up standing.
  bestMode(p) {
    const ax = p.axis();
    if (Math.abs(ax.y) > 0.7 || (p.kind === 'log' && p.len <= 1.8)) return 'upright';
    if (p.kind !== 'log') {
      const face = p.body.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
      if (Math.abs(face.y) > 0.7) return 'flat';
    }
    return 'across';
  }

  // Where on the piece your hand is, in its own frame. Upright things are held
  // by the top (so you can hammer them), things pointing away by the near end.
  gripLocal(h) {
    const p = h.p;
    if (h.mode === 'upright') return new CANNON.Vec3(0, p.len / 2 - 0.03, 0);
    if (h.mode === 'along') return new CANNON.Vec3(0, -p.len / 2 + Math.min(0.2, p.len / 4), 0);
    return h.local;
  }

  updateCarryTarget() {
    const h = this.held;
    if (!h) return;
    if (h.p.dead) { this.held = null; game.vm.carry = false; return; }
    const p = h.p;
    const yaw = game.player.yaw;
    const fwd = _z.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = _x.set(Math.cos(yaw), 0, -Math.sin(yaw));
    let Y, Z;
    if (h.mode === 'across') { Y = right.clone().multiplyScalar(h.side); Z = fwd.clone().negate(); }
    else if (h.mode === 'upright') { Y = UP.clone(); Z = fwd.clone().negate(); }
    else if (h.mode === 'flat') { Y = right.clone().multiplyScalar(h.side); Z = UP.clone(); }
    else { Y = fwd.clone(); Z = UP.clone(); }
    const X = _y.crossVectors(Y, Z);
    const q = new THREE.Quaternion().setFromRotationMatrix(_mx.makeBasis(X, Y, Z)).premultiply(h.wobble);
    this.carryQuat.set(q.x, q.y, q.z, q.w);

    const cam = game.camera;
    cam.getWorldPosition(_o);
    cam.getWorldDirection(_d);
    let dist = h.mode === 'upright' ? 1.2 + (p.kind === 'log' ? p.r : 0) : 1.35;
    // Press it flat against whatever you look at (a post, a wall), so the nail can reach.
    const half = p.kind === 'log' ? p.r : h.mode === 'across' ? p.t / 2 : p.w / 2;
    if (h.mode !== 'upright' && h.mode !== 'along') {
      const hit = this.rayPastHeld(_o, _d, 2);
      // (your arms reach a bit further when you lean the board on something)
      if (hit && !hit.body.isGround && hit.dist - half < 1.85) dist = Math.max(0.5, hit.dist - half + 0.004);
    }
    this.carryGrip.set(_o.x + _d.x * dist, _o.y + _d.y * dist, _o.z + _d.z * dist);

    // Held across, the far end leans on whatever is there too (the next post),
    // like pressing a board against two posts with both hands.
    if (h.mode === 'across') {
      const toFar = -Math.sign(h.local.y || 1) * p.len / 2 - h.local.y; // grip → far end, along the piece
      const far = new THREE.Vector3(Y.x, Y.y, Y.z).multiplyScalar(toFar * 0.85).add(new THREE.Vector3(this.carryGrip.x, this.carryGrip.y, this.carryGrip.z));
      // look straight back from in front of the far end, the way the board faces
      const hit = this.rayPastHeld(far.clone().addScaledVector(fwd, -0.35), fwd, 0.9);
      if (hit && !hit.body.isGround) {
        const touch = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z).addScaledVector(new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), half - 0.004);
        const along = touch.sub(new THREE.Vector3(this.carryGrip.x, this.carryGrip.y, this.carryGrip.z));
        along.y = 0; // keep it level; only turn it so both ends touch
        const ny = along.normalize().multiplyScalar(Math.sign(toFar));
        if (ny.lengthSq() > 0.5 && ny.dot(Y) > Math.cos(0.45)) {
          const nz = fwd.clone().negate().addScaledVector(ny, -ny.dot(fwd.clone().negate())).normalize();
          const nq = new THREE.Quaternion().setFromRotationMatrix(_mx.makeBasis(_y.crossVectors(ny, nz), ny, nz)).premultiply(h.wobble);
          this.carryQuat.set(nq.x, nq.y, nq.z, nq.w);
        }
      }
    }
    const off = this.carryQuat.vmult(this.gripLocal(h));
    this.carryPos.set(this.carryGrip.x - off.x, this.carryGrip.y - off.y, this.carryGrip.z - off.z);
    // never aim it into the ground: keep its lowest point just above the dirt
    const ax = this.carryQuat.vmult(new CANNON.Vec3(0, 1, 0));
    const low = Math.abs(ax.y) * (p.len / 2) + (p.kind === 'log' ? p.r : p.w / 2) * Math.sqrt(1 - ax.y * ax.y) + 0.02;
    const floor = terrainHeight(this.carryPos.x, this.carryPos.z) + low;
    if (this.carryPos.y < floor) this.carryPos.y = floor;
  }

  // A ray from the eye that sees through what you are holding.
  rayPastHeld(o, d, len) {
    const g = this.held.group.map((q) => q.body.collisionFilterGroup);
    for (const q of this.held.group) q.body.collisionFilterGroup = 0;
    const hit = rayClosest(new CANNON.Vec3(o.x, o.y, o.z), new CANNON.Vec3(o.x + d.x * len, o.y + d.y * len, o.z + d.z * len));
    this.held.group.forEach((q, i) => { q.body.collisionFilterGroup = g[i]; });
    return hit;
  }

  // Runs inside every physics step: steer the held piece towards the hands.
  carryStep() {
    const h = this.held;
    if (!h || h.p.dead) return;
    const b = h.p.body, dt = world.dt || 1 / 120;
    const heavy = clamp(25 / h.mass, 0.35, 1);
    const pv = game.player.body.velocity;
    let dx;
    {
      dx = this.carryPos.vsub(b.position);
      const v = dx.scale(16 * heavy);
      if (v.length() > 10) v.scale(10 / v.length(), v);
      b.velocity.set(v.x + pv.x * 0.9, v.y, v.z + pv.z * 0.9);

      const qe = this.carryQuat.mult(b.quaternion.conjugate());
      if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; qe.w = -qe.w; }
      const s = Math.sqrt(1 - Math.min(1, qe.w * qe.w));
      const angle = 2 * Math.acos(Math.min(1, qe.w));
      if (s > 1e-4) {
        const k = Math.min(angle * 12 * heavy, 14) / s;
        b.angularVelocity.set(qe.x * k, qe.y * k, qe.z * k);
      } else b.angularVelocity.set(0, 0, 0);
    }
    // Your hand can't push wood into other things: drop any push into what it touches.
    // (done per contact point, so the board can still turn around a post it touches)
    const invM = 1 / h.p.mass, invI = 12 / (h.p.mass * h.p.len * h.p.len);
    for (const c of world.contacts) {
      const mine = c.bi === b ? 1 : c.bj === b ? -1 : 0;
      if (!mine) continue;
      const into = c.ni.scale(mine), r = mine > 0 ? c.ri : c.rj;
      const w = b.angularVelocity;
      const vn = b.velocity.vadd(w.cross(r)).dot(into);
      if (vn <= 0) continue;
      const rn = r.cross(into);
      const lambda = vn / (invM + rn.lengthSquared() * invI);
      b.velocity.vsub(into.scale(lambda * invM), b.velocity);
      w.vsub(rn.scale(lambda * invI), w);
    }
    b.wakeUp();
    // Move everything nailed to it as one solid thing, so the nails never bend.
    const w = b.angularVelocity;
    for (const q of h.group) {
      if (q === h.p || q.dead) continue;
      const r = q.body.position.vsub(b.position);
      q.body.velocity.copy(b.velocity.vadd(w.cross(r)));
      q.body.angularVelocity.copy(w);
      q.body.wakeUp();
    }

    // pulled too far away (stuck on something) → you let go
    h.far = dx.length() > 1.3 ? h.far + dt : 0;
    if (h.far > 0.3) this.drop();
  }

  // ───────── hints ─────────

  updateHints(tool, a) {
    const L = [];
    const p = a.piece;
    if (a.nailbox) L.push(['E', 'Take nails']);
    if (a.crate) L.push(['E', 'Take 100 nails']);
    if (a.car && !this.held && !a.car.auto) L.push(['E', a.car.upright() < 0.5 ? 'Push it back on its wheels' : 'Get in']);
    const ask = a.worker?.askHint?.();
    if (ask && !this.held && a.dist <= REACH) L.push(['E', ask]);
    if (a.thing && !this.held) L.push(['E', a.thing.kind === 'bag' ? 'Mix the mortar' : a.thing.kind === 'pallet' ? (a.thing.count ? 'Take bricks' : 'Take it apart') : a.thing.kind === 'crate' ? `Take the ${a.thing.fit}` : 'Pick up']);
    if (a.paintThing && !this.held) L.push(['E', paintThingHint(a.paintThing)]);
    if (a.streetThing && !this.held && a.dist <= REACH) L.push(['E', streetThingHint(a.streetThing)]);
    if (a.lamp && lampHint(a.lamp) && a.dist <= REACH) L.push(['E', lampHint(a.lamp)]);
    if (roadKit.hold && tool !== 'road') L.unshift(['', `Carrying a ${roadKit.hold === 'zebra' ? 'tin of road paint' : roadKit.hold === 'lamp' ? 'street lamp' : 'road sign'} · slot 8 sets it · E puts it down`]);
    if (a.brick?.kind === 'door' && !this.held) L.push(['E', a.brick.open ? 'Close the door' : 'Open the door']);
    const buy = a.buyer && a.dist <= REACH ? buyerHint() : null;
    if (buy && !this.held) L.push(...buy.hint);
    if (tool === 'axe') {
      if (a.tree) L.push(['Click', 'Chop']);
      else if (a.stump) L.push(['Click', 'Chop the stump out']);
      else if (p) L.push(['', 'Use the saw to cut wood']);
    } else if (tool === 'saw') {
      if (p && !p.anchored) {
        L.push(['Hold click', 'Cut here']);
        if (p.kind === 'log' && p.len >= 0.4) L.push(['Hold right', 'Saw into planks']);
      }
    } else if (tool === 'hammer') {
      if (a.nail) {
        if (!a.nail.bent && a.nail.depth < 1) L.push(['Click', 'Hit the nail']);
        L.push(['Right click', 'Pull it out']);
      } else if (a.brick && a.dist <= 2.6) {
        L.push(['Click', 'Knock the brick out']);
      } else if (p && a.dist <= 2.6) {
        if (this.canDrivePost(p, a.point)) L.push(['Click', 'Drive into the ground']);
        else L.push(['Click', this.nails ? 'Nail' : 'Nail (no nails!)']);
      }
    } else if (tool === 'trowel' && !this.held) {
      const t = this.brick;
      if (supplies.hold) {
        if (t && t.ok) L.push(['Click', `Set the ${supplies.hold} here`]);
        else if (t) L.push(['', t.why]);
        if (t) L.push(['R', 'Turn it']);
      } else {
        if (!supplies.bricks && !supplies.halves) L.push(['', 'No bricks in your hands — take some from a pallet']);
        else if (!supplies.mortar) L.push(['', 'No mortar — mix a bag']);
        else if (t && t.ok) L.push(['Click', t.L === 1 ? (supplies.halves ? 'Lay a half brick' : 'Break a brick in half and lay it') : 'Lay a brick']);
        else if (t) L.push(['', t.why]);
        if (t) L.push(['R', ['Turn it', 'Half brick', 'Whole brick'][this.brickRot]]);
        if (a.brick && a.brick.wet > 0) L.push(['Right click', 'Take it back']);
      }
    } else if (tool === 'rope' && !this.held) {
      L.push(...ropeHints(a));
    } else if (tool === 'hands') {
      if (!this.held && p) L.push(['Click', p.anchored ? 'Pull out' : 'Pick up']);
    }
    if (!this.held && p && tool !== 'hands') L.push(['E', p.anchored ? 'Pull out' : 'Pick up']);
    if (supplies.hold && tool !== 'trowel') L.unshift(['', `Carrying a ${supplies.hold} · trowel (5) sets it into a wall`]);
    if (supplies.hold && !a.thing && !a.car) L.push(['E', 'Put it down']);
    if (this.held) {
      const h = this.held;
      if (h.mode === 'upright') L.unshift(['', tool === 'hammer' ? 'Look down, hit the top → into the ground' : 'Take the hammer (3) to drive it in']);
      L.push(['E', 'Drop'], ['R', h.mode === 'upright' ? 'Lay it down' : 'Turn']);
    }
    game.hud.hint(L);

    if (p && !p.dead) {
      const len = p.len >= 1 ? `${p.len.toFixed(2)} m` : `${Math.round(p.len * 100)} cm`;
      const worth = woodValue(p);
      game.hud.info(`${p.label} · ${len} · ${Math.round(p.mass)} kg${worth ? ` · worth ~$${worth}` : ''}`);
    } else if (a.tree) {
      game.hud.info(`${a.tree.kind === 'oak' ? 'Leafy tree' : 'Pine'} · ${a.tree.hp} ${a.tree.hp === 1 ? 'hit' : 'hits'} left`);
    } else if (a.stump) {
      const t = a.stump, left = t.stumpHp ?? 5 + Math.round(t.r * 20);
      game.hud.info(`Stump · ${left} ${left === 1 ? 'hit' : 'hits'} left with the axe`);
    } else if (buy) {
      game.hud.info(buy.info);
    } else if (a.worker) {
      game.hud.info(workerInfo(a.worker));
    } else if (a.villager) {
      game.hud.info(personInfo(a.villager));
    } else if (a.car) {
      game.hud.info('Your pickup');
    } else if (a.brick) {
      game.hud.info(brickInfo(a.brick));
    } else if (a.thing) {
      game.hud.info(thingInfo(a.thing));
    } else if (a.paintThing) {
      game.hud.info(paintThingInfo(a.paintThing));
    } else if (a.streetThing) {
      game.hud.info(streetThingInfo(a.streetThing));
    } else if (a.lamp) {
      game.hud.info(lampInfo(a.lamp));
    } else if (a.sign) {
      game.hud.info(signInfo(a.sign));
    } else if (tool === 'trowel') {
      const halves = supplies.halves ? ` + ${supplies.halves} half` : '';
      game.hud.info(`${supplies.bricks} ${supplies.bricks === 1 ? 'brick' : 'bricks'}${halves} in hand · mortar for ${supplies.mortar}`);
    } else game.hud.info('');
  }
}
