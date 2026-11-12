// The road worker (Crew app). "A street from here": he starts where you stand and builds forward,
// a few metres at a time — digs them, spreads and rakes the gravel, sets the curbs, spreads, rakes
// and rolls the asphalt — with the bags and pallets lying around. Posts hammered into the ground
// ahead of the street steer him; he pulls each one out when he gets there.
// "Finish the streets": he finishes every metre that was started, by you or by him.
import * as THREE from 'three';
import { game } from './game.js';
import { terrainHeight } from './terrain.js';
import { Worker, TRADES, crew } from './workers.js';
import { spend, WAGE } from './money.js';
import { pieces } from './items.js';
import { audio } from './audio.js';
import { particles } from './particles.js';
import { streets, things, plan, begin, work, needs, curbsFor, endOf, at, ST, DIG_HITS, RAKES, BAG_M } from './streets.js';

const TIME = { dig: 1.3, gravel: 1.9, rake: 1.4, curbs: 2.3, asphalt: 2.1, roll: 1.5, take: 1.2 };
const AHEAD = 3; // metres dug ahead before the layers go on
const BARROW = 4, CURBS = 6;
const ACT = { dig: 'Digging', gravel: 'Spreading gravel', rake: 'Raking', curbs: 'Setting curbs', asphalt: 'Spreading asphalt', roll: 'Rolling the asphalt' };
const WANT = { gravel: 'gravel', asphalt: 'asphalt', curbs: 'curbs' };

class RoadWorker extends Worker {
  constructor(trade, saved) {
    super(trade, saved);
    this.gravel = saved?.gravel ?? 0;
    this.asphalt = saved?.asphalt ?? 0;
    this.curbs = saved?.curbs ?? 0;
    this.dress();
  }
  saveMore() { return { gravel: this.gravel, asphalt: this.asphalt, curbs: this.curbs }; }

  // orange vest stays; a shovel in his hand
  dress() {
    const hand = this.m.arms[1];
    const M = (o) => new THREE.MeshStandardMaterial(o);
    this.shovel = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 1.05, 6), M({ color: 0xb98a55, roughness: 0.8 }));
    handle.position.y = -0.95;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.012), M({ color: 0x7d858b, roughness: 0.45, metalness: 0.35 }));
    blade.position.set(0, -1.58, 0.02);
    this.shovel.add(handle, blade);
    this.shovel.traverse((x) => { x.castShadow = true; });
    hand.add(this.shovel);
  }

  buildHouses() { return null; } // (not his trade)
  raise() { return null; }
  roofIt() { return null; }

  // A job from the Crew app: n metres of street from where you stand (0: finish what's started).
  roadJob(n) {
    if (!n) {
      if (!streets.some((s) => s.m.some((m) => m.st !== ST.DONE))) return 'Every street is finished — start one first';
      this.give({ kind: 'road', sid: null, left: 0 });
      return null;
    }
    const pl = game.player, yaw = pl.yaw, b = pl.body.position;
    const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const aim = { x: b.x + fwd.x * 2.4, z: b.z + fwd.z * 2.4 };
    const p = plan(aim, fwd, { reach: 6, ignoreTrees: false });
    if (!p) return 'Stand where the street should start (by the road or beside a street) or at the open end of one, facing the way it goes.';
    if (!p.ok) return p.why;
    let s = p.s, left = n;
    if (!s) { s = begin(p, 0).s; left--; game.hud.toast(`A new street: ${s.name}`); }
    this.give({ kind: 'road', sid: s.id, left });
    return null;
  }
  give(order) {
    this.release();
    this.order = order;
    this.state = 'idle';
    this.thinkT = 0;
    this.setStatus('Starting');
  }

  think() {
    this.thinkT = 1.2;
    const then = this.after2;
    this.after2 = null;
    if (then) then();
    if (this.leaving) return;
    if (this.unpaid) {
      if (spend(WAGE, `Wages · ${this.name}`)) this.unpaid = false;
      else { this.release(); this.setStatus('Not paid — waiting for his wages'); return; }
    }
    const o = this.order;
    if (o?.kind !== 'road') { this.order = null; this.setStatus('Waiting for orders'); return; }
    const job = this.nextJob(o);
    if (!job) {
      this.setStatus(o.why ? `Done, but stopped early: ${o.why}` : 'Done: the street is built');
      game.hud.toast(o.why ? `${this.name}: the street stops here — ${o.why}.` : `${this.name}: ${o.sid ? `${streets.find((s) => s.id === o.sid)?.name ?? 'the street'} is done` : 'every street is finished'}.`);
      this.order = null;
      this.goTo(this.nearYou(), 'arrive');
      return;
    }
    if (job.wait) { this.setStatus(job.wait); this.thinkT = 3; return; }
    if (job.extend) return this.extend(o, job.s);
    const { s, k, op } = job;
    // material first
    const want = WANT[op];
    if (want && (want === 'curbs' ? this.curbs < curbsFor(s, k) : this[want] <= 0)) return this.fetch(want);
    // walk to the metre, then work on it
    const side = (this.slotNo() % 2 ? -1 : 1) * (op === 'curbs' ? 1.6 : 1.1);
    const p = at(s, s.S[k] + (s.S[k + 1] - s.S[k]) / 2, side);
    if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > 0.6) {
      this.setStatus(`Going to ${s.name}`);
      if (!this.goTo(new THREE.Vector3(p.x, 0, p.z), () => { this.thinkT = 0; })) this.setStatus(`Can't get to ${s.name}`);
      return;
    }
    this.face(at(s, s.S[k] + (s.S[k + 1] - s.S[k]) / 2, 0));
    this.setStatus(`${ACT[op]} · ${s.name}, metre ${k + 1}`);
    this.op = op;
    this.on = `${s.id}:${k}`;
    this.state = 'mix';
    this.t = TIME[op];
    this.after2 = () => {
      const n = op === 'curbs' ? curbsFor(s, k) : 1;
      if (work(s, k, op)) {
        // (what he spreads or sets is used up only if it went on)
        if (op === 'gravel' || op === 'asphalt') this[op]--;
        if (op === 'curbs') this.curbs -= n;
        if (this.near()) {
          if (op === 'dig' || op === 'gravel' || op === 'asphalt') particles.emit('dirt', new THREE.Vector3(p.x, terrainHeight(p.x, p.z) + 0.1, p.z), new THREE.Vector3(0, 1, 0), 8);
          audio.drop?.(0.3);
        }
      }
      this.op = this.on = null;
    };
  }
  release() {
    this.on = null;
    super.release();
  }

  // the next thing to do: the least done metre of the street(s), or dig more of it
  nextJob(o) {
    const list = o.sid ? streets.filter((s) => s.id === o.sid) : streets;
    if (!list.length) return null;
    // (a metre another road worker is on is his)
    const taken = new Set(crew.filter((w) => w !== this && w.on).map((w) => w.on));
    let best = null;
    for (const s of list) {
      for (let k = 0; k < s.m.length; k++) {
        const m = s.m[k];
        if (m.st === ST.DONE || taken.has(`${s.id}:${k}`)) continue;
        const p = s.n[k], d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
        const score = m.st * 1000 + (o.sid ? k : d);
        if (!best || score < best.score) best = { s, k, op: needs(m), score };
      }
    }
    // on his own street: dig a few metres ahead whenever the ones behind are no further than dug
    if (o.sid && o.left > 0) {
      const s = list[0], open = s.m.filter((m) => m.st !== ST.DONE);
      const ready = !s.end && s.m[s.m.length - 1].st !== ST.DIG && !taken.has(`${s.id}:end`);
      if (ready && (!open.length || (open.length < AHEAD && open.every((m) => m.st <= ST.DUG)))) return { extend: true, s };
    }
    if (!best) return null;
    return best;
  }

  // One more metre on the open end, steered by the nearest post ahead (if any).
  extend(o, s) {
    const { E, d } = endOf(s);
    const stake = this.stakeAhead(E, d);
    let fwd = d;
    if (stake) {
      const sp = stake.body.position;
      if (Math.hypot(sp.x - E.x, sp.z - E.z) < 2.2) { this.pullStake(stake); return; }
      fwd = { x: sp.x - E.x, z: sp.z - E.z };
      const l = Math.hypot(fwd.x, fwd.z);
      fwd = { x: fwd.x / l, z: fwd.z / l };
    }
    const p = plan({ x: E.x + d.x * 1.5, z: E.z + d.z * 1.5 }, fwd, { reach: 3 });
    if (!p || !p.ok || p.s !== s) {
      o.left = 0;
      const why = p?.why ?? 'can\'t go on';
      o.why = why;
      this.setStatus(`Stopped digging: ${why}`);
      game.hud.toast(`${this.name}: ${why}. I'll finish what's dug.`);
      this.thinkT = 0.5;
      return;
    }
    // (the same spot he'll dig the rest of that metre from: the middle of it, a bit to one side)
    const side = (this.slotNo() % 2 ? -1 : 1) * 1.1, mid = { x: (E.x + p.b.x) / 2, z: (E.z + p.b.z) / 2 };
    const at2 = { x: mid.x - d.z * side, z: mid.z + d.x * side };
    if (Math.hypot(at2.x - this.pos.x, at2.z - this.pos.z) > 0.6) {
      this.setStatus(`Going to the end of ${s.name}`);
      if (!this.goTo(new THREE.Vector3(at2.x, 0, at2.z), () => { this.thinkT = 0; })) this.setStatus(`Can't get to the end of ${s.name}`);
      return;
    }
    this.face(p.b);
    this.setStatus(`Digging · ${s.name}, metre ${s.m.length + 1}`);
    this.op = 'dig';
    this.on = `${s.id}:end`;
    this.state = 'mix';
    this.t = TIME.dig;
    this.after2 = () => {
      const q = plan({ x: E.x + d.x * 1.5, z: E.z + d.z * 1.5 }, fwd, { reach: 3 });
      if (q && q.ok && q.s === s && endOf(s).E === E) { begin(q, 1); o.left--; }
      if (s.end) o.left = 0; // (it reached another street)
      this.op = this.on = null;
    };
  }

  // posts standing in the ground ahead of the open end (within 40 m, not behind)
  stakeAhead(E, d) {
    let best = null, bd = Infinity;
    for (const p of pieces) {
      if (!p.anchored || p.dead || Math.abs(p.axis().y) < 0.8) continue;
      const q = p.body.position, dx = q.x - E.x, dz = q.z - E.z, dist = Math.hypot(dx, dz);
      if (dist > 40 || (dx * d.x + dz * d.z) / (dist || 1) < 0.2) continue;
      if (dist < bd) { bd = dist; best = p; }
    }
    return best;
  }
  pullStake(p) {
    p.anchored = false;
    p.drive = 0;
    p.makeDynamic();
    p.body.position.y += 0.3;
    p.body.wakeUp();
    this.setStatus('Pulled out a post');
    this.thinkT = 0.6;
  }

  // fetch gravel, asphalt or curb stones from the nearest bag or pallet
  fetch(kind) {
    let best = null, bd = Infinity;
    for (const t of things) {
      if (t.kind !== kind || t.dead || (t.m ?? t.n) <= 0) continue;
      const q = t.body.position, d = (q.x - this.pos.x) ** 2 + (q.z - this.pos.z) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    const name = kind === 'curbs' ? 'curb stones' : kind;
    if (!best) { this.setStatus(`Waiting for ${name} — buy ${kind === 'curbs' ? 'a pallet' : 'big bags'} in Woodline (Streets)`); this.thinkT = 3; return; }
    const q = best.body.position, dx = this.pos.x - q.x, dz = this.pos.z - q.z, l = Math.hypot(dx, dz) || 1;
    const spot = new THREE.Vector3(q.x + (dx / l) * 1.0, 0, q.z + (dz / l) * 1.0);
    if (Math.hypot(spot.x - this.pos.x, spot.z - this.pos.z) > 0.5) {
      this.setStatus(`Fetching ${name}`);
      if (!this.goTo(spot, () => { this.thinkT = 0; })) { this.setStatus(`Can't get to the ${name}`); this.thinkT = 3; }
      return;
    }
    this.face(q);
    this.setStatus(`Loading ${name}`);
    this.op = 'take';
    this.state = 'mix';
    this.t = TIME.take;
    this.after2 = () => {
      this.op = null;
      if (best.dead) return;
      if (kind === 'curbs') {
        const n = Math.min(best.n, CURBS - this.curbs);
        this.curbs += n; best.n -= n;
        if (best.n <= 0) best.remove(); else best.remake();
      } else {
        const n = Math.min(best.m, BARROW - this[kind]);
        this[kind] += n; best.m -= n;
        if (best.m <= 0) best.remove(); else best.remake();
      }
    };
  }

  update(dt) {
    super.update(dt);
    const a = this.m;
    // shovel work: bent over, arms pushing; the roller: walking it back and forth
    if (this.state === 'mix' && this.op) {
      const u = this.t;
      if (this.op === 'roll') {
        a.body.rotation.x = 0.15;
        a.arms[0].rotation.x = a.arms[1].rotation.x = -0.9 + Math.sin(u * 4) * 0.15;
      } else if (this.op === 'rake') {
        a.body.rotation.x = 0.3;
        a.arms[1].rotation.x = -0.9 + Math.sin(u * 7) * 0.35;
        a.arms[0].rotation.x = -0.7 + Math.sin(u * 7) * 0.35;
      } else if (this.op === 'curbs' || this.op === 'take') {
        a.body.rotation.x = 0.7 * Math.abs(Math.sin(u * 2.4));
        a.arms[0].rotation.x = a.arms[1].rotation.x = -1.1;
      } else {
        a.body.rotation.x = 0.45 + Math.sin(u * 5) * 0.15;
        a.arms[1].rotation.x = -0.6 + Math.sin(u * 5) * 0.45;
        a.arms[0].rotation.x = -0.9 + Math.sin(u * 5) * 0.3;
      }
    }
    this.shovel.visible = this.op !== 'curbs' && this.op !== 'take';
    a.load.visible = false;
  }
}

TRADES.roadworker = RoadWorker;
export const roadJobs = { DIG_HITS, RAKES, BAG_M };
