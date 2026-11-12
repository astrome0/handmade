// Wood chips, sawdust, leaves and dirt. One instanced mesh, fixed pool.
import * as THREE from 'three';
import { terrainHeight } from './terrain.js';

const MAX = 900;
const COLORS = {
  chip: [0xdcc08e, 0xc9a46c, 0x6b5038],
  sawdust: [0xe8d3a8, 0xd9bf8c],
  leaf: [0x5f8a34, 0x7aa040, 0x4c7029],
  dirt: [0x6e5639, 0x8a7050],
  spark: [0xd0d4d8],
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _c = new THREE.Color();

export const particles = {
  init(scene) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, _c.set(0xffffff));
    }
    scene.add(this.mesh);
    this.p = Array.from({ length: MAX }, () => ({
      life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      rot: new THREE.Vector3(), spin: new THREE.Vector3(), size: new THREE.Vector3(), kind: '', rest: false,
    }));
    this.next = 0;
  },

  // dir: main direction (e.g. surface normal); color: optional override
  emit(kind, pos, dir, count, color) {
    const pal = COLORS[kind];
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const q = this.p[i];
      q.kind = kind;
      q.rest = false;
      q.pos.copy(pos);
      q.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      q.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(18);
      const rnd = () => Math.random() - 0.5;
      if (kind === 'chip') {
        q.size.set(0.025 + Math.random() * 0.035, 0.008, 0.02 + Math.random() * 0.025);
        q.vel.set(rnd() * 2.6, Math.random() * 2.2 + 1.2, rnd() * 2.6).addScaledVector(dir, 2.2);
        q.max = 1.6 + Math.random() * 1.6;
      } else if (kind === 'sawdust') {
        q.size.setScalar(0.006 + Math.random() * 0.008);
        q.vel.set(rnd() * 0.8, Math.random() * 0.4, rnd() * 0.8).addScaledVector(dir, 0.5);
        q.max = 1.2 + Math.random();
      } else if (kind === 'leaf') {
        q.size.set(0.07, 0.006, 0.045);
        q.vel.set(rnd() * 3.5, Math.random() * 2.5 + 0.5, rnd() * 3.5);
        q.pos.add(_p.set(rnd() * 2.6, rnd() * 2, rnd() * 2.6));
        q.max = 2.5 + Math.random() * 2;
        q.spin.multiplyScalar(0.3);
      } else if (kind === 'dirt') {
        q.size.setScalar(0.015 + Math.random() * 0.02);
        q.vel.set(rnd() * 1.6, Math.random() * 1.8 + 0.6, rnd() * 1.6).addScaledVector(dir, 0.6);
        q.max = 0.8 + Math.random() * 0.5;
      } else {
        q.size.setScalar(0.006);
        q.vel.set(rnd() * 2, Math.random() * 2, rnd() * 2).addScaledVector(dir, 1.5);
        q.max = 0.25;
      }
      q.life = q.max;
      this.mesh.setColorAt(i, color ? _c.copy(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.08) : _c.set(pal[(Math.random() * pal.length) | 0]));
    }
    this.mesh.instanceColor.needsUpdate = true;
  },

  update(dt) {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      const q = this.p[i];
      if (q.life <= 0) continue;
      any = true;
      q.life -= dt;
      if (q.life <= 0) { this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
      if (!q.rest) {
        const leaf = q.kind === 'leaf', dust = q.kind === 'sawdust';
        q.vel.y -= (leaf ? 2.2 : dust ? 3 : 9.8) * dt;
        if (leaf || dust) q.vel.multiplyScalar(1 - (leaf ? 1.6 : 1.2) * dt);
        if (leaf) q.vel.x += Math.sin(q.life * 4 + i) * 1.2 * dt;
        q.pos.addScaledVector(q.vel, dt);
        q.rot.addScaledVector(q.spin, dt);
        const g = terrainHeight(q.pos.x, q.pos.z) + q.size.y * 0.5;
        if (q.pos.y < g) { q.pos.y = g; q.rest = true; q.rot.x = 0; q.rot.z = 0; }
      }
      const fade = Math.min(1, q.life / 0.4);
      _q.setFromEuler(_e.set(q.rot.x, q.rot.y, q.rot.z));
      this.mesh.setMatrixAt(i, _m.compose(q.pos, _q, _s.copy(q.size).multiplyScalar(fade)));
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  },
};
