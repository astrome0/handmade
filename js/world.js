// The land, the forest, rocks, grass and flowers. Trees are instanced per
// 32 m chunk; a tree only gets a physics body when you come close to it.
import * as THREE from 'three';
import { MOBILE } from './device.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { world, CANNON, GROUP, MASK, MAT, refs } from './physics.js';
import { SIZE, HALF, terrainHeight, forestDensity, pineChance, dirtAmount, groundColor, roadDist, parkDist, yardDist, YARD, road, scarAt } from './terrain.js';
import { rng, hash2, clamp, smoothstep } from './util.js';
import { TEX } from './textures.js';
import { game } from './game.js';
import { Piece } from './items.js';
import { detachBody } from './nails.js';
import { particles } from './particles.js';
import { audio } from './audio.js';

export { terrainHeight };
export const CHUNK = 32, NCH = SIZE / CHUNK;
export const trees = [];
export const chunks = [];
export const stumps = [];
export let groundBody = null;

const falling = [];
const shaking = new Set();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

// ───────────────────────── materials ─────────────────────────

export function makeCanopyMaterial(color) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, color: color ?? 0xffffff });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = game.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 wOrg = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #else
        vec3 wOrg = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #endif
      float wPh = uTime * 1.2 + wOrg.x * 0.13 + wOrg.z * 0.11;
      float wAmt = (sin(wPh) * 0.6 + sin(wPh * 2.3 + 1.7) * 0.25 + sin(uTime * 5.0 + position.x * 4.0 + position.z * 3.0) * 0.08)
                 * 0.045 * max(position.y + 1.0, 0.0);
      transformed.x += wAmt;
      transformed.z += wAmt * 0.5;`);
  };
  return m;
}

function grassMaterial() {
  const m = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = game.uTime;
    sh.vertexShader = 'uniform float uTime;\nattribute float bladeT;\nvarying float vBlade;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vBlade = bladeT;
      vec3 gOrg = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      float gPh = uTime * 1.6 + gOrg.x * 0.23 + gOrg.z * 0.19;
      float gW = (sin(gPh) + 0.5 * sin(gPh * 2.7 + gOrg.x)) * bladeT * bladeT;
      transformed.x += gW * 0.12;
      transformed.z += gW * 0.07;`);
    sh.fragmentShader = 'varying float vBlade;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= mix(0.7, 1.1, vBlade);`);
  };
  return m;
}

// ───────────────────────── geometry ─────────────────────────

// Push every corner a little, the same way for corners that are shared,
// so blobs stay closed but stop looking like perfect shapes.
function jitter(g, amount, seed) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const kx = Math.round(x * 200), ky = Math.round(y * 200), kz = Math.round(z * 200);
    p.setXYZ(i,
      x + (hash2(kx, ky + kz * 7, seed) - 0.5) * amount,
      y + (hash2(ky, kz + kx * 5, seed + 1) - 0.5) * amount,
      z + (hash2(kz, kx + ky * 3, seed + 2) - 0.5) * amount);
  }
}

// Darker at the bottom, plus a slightly different shade per triangle.
function shadeFaces(g, yMin, yMax, seed) {
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let f = 0; f < p.count; f += 3) {
    const fy = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3;
    const s = (0.58 + 0.42 * smoothstep(yMin, yMax, fy)) * (0.9 + hash2(f, seed, 3) * 0.2);
    for (let k = 0; k < 3; k++) col.set([s, s, s], (f + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function oakGeometry() {
  const blobs = [[0, 0, 0, 1], [0.78, -0.12, 0.18, 0.74], [-0.72, -0.06, -0.2, 0.78], [0.12, 0.42, -0.55, 0.72],
    [-0.18, 0.32, 0.62, 0.7], [0.2, 0.78, 0.1, 0.64], [-0.45, -0.35, 0.35, 0.62], [0.45, -0.3, -0.45, 0.6]];
  const g = mergeGeometries(blobs.map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, MOBILE ? 0 : 1).translate(x, y, z)));
  jitter(g, 0.16, 5);
  g.computeVertexNormals();
  shadeFaces(g, -1.1, 1.4, 7);
  return g;
}

function pineGeometry() {
  const tiers = [[1, 1.1, 0.55], [0.82, 1.0, 1.05], [0.62, 0.9, 1.55], [0.4, 0.8, 2.0]];
  const g = mergeGeometries(tiers.map(([r, h, y], i) => new THREE.ConeGeometry(r, h, 8, 1).rotateY(i * 0.7).translate(0, y, 0).toNonIndexed()));
  jitter(g, 0.08, 9);
  g.computeVertexNormals();
  shadeFaces(g, 0, 2.4, 11);
  return g;
}

function trunkGeometry() {
  const g = new THREE.CylinderGeometry(0.78, 1, 1, 7, 1, true);
  g.translate(0, 0.5, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 5);
  return g;
}

function tuftGeometry() {
  const R = rng(99), pos = [], bt = [];
  for (let b = 0; b < 6; b++) {
    const a = R() * Math.PI * 2, off = R() * 0.08, h = 0.65 + R() * 0.45, w = 0.05 + R() * 0.03, lean = 0.12 + R() * 0.2;
    const cx = Math.cos(a) * off, cz = Math.sin(a) * off, px = -Math.sin(a), pz = Math.cos(a);
    pos.push(cx - px * w, 0, cz - pz * w, cx + px * w, 0, cz + pz * w, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
    bt.push(0, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('bladeT', new THREE.Float32BufferAttribute(bt, 1));
  return g;
}

// ───────────────────────── build ─────────────────────────

export function buildWorld(scene) {
  buildTerrain(scene);
  buildGroundPhysics();
  genTrees();
  buildChunks(scene);
  buildRocks(scene);
  buildCamp(scene);
  buildRoad(scene);
}

// The road surface: a ribbon laid just above the ground with tyre ruts painted on.
let roadMat = null;
function ribbon(scene, pts, width, lift = 0.035) {
  roadMat ??= new THREE.MeshStandardMaterial({
    map: TEX.road, transparent: true, depthWrite: false, roughness: 1,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const pos = [], uv = [], idx = [];
  let v = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    if (i > 0) v += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) / 4;
    for (let k = 0; k <= 4; k++) {
      const u = k / 4, off = (u - 0.5) * width;
      const x = pts[i].x - tz * off, z = pts[i].z + tx * off;
      pos.push(x, terrainHeight(x, z) + lift, z);
      uv.push(u, v);
    }
    // (wound so the faces look up: the other way round they were culled, seen from above)
    if (i < n - 1) for (let k = 0; k < 4; k++) {
      const q = i * 5 + k;
      idx.push(q, q + 1, q + 5, q + 1, q + 6, q + 5);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, roadMat);
  m.receiveShadow = true;
  m.renderOrder = 1;
  scene.add(m);
  return m;
}

function buildRoad(scene) {
  ribbon(scene, road.approach, 4.6);
  ribbon(scene, road.loop, 4.6);
  ribbon(scene, road.yard, 3.6); // the narrower track to the timber yard
}

// A footpath worn into the grass (a house's door to the road): a narrow dirt ribbon,
// and the grass tufts along it are gone.
export function addPath(points, width = 1.3) {
  // even steps of ~0.5 m, a little smoothed so it doesn't zigzag
  const pts = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
    for (let k = 0; k < n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  pts.push({ x: points[points.length - 1].x, z: points[points.length - 1].z });
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < pts.length - 1; i++) {
      pts[i] = { x: (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4, z: (pts[i - 1].z + pts[i].z * 2 + pts[i + 1].z) / 4 };
    }
  }
  if (pts.length < 2) return;
  ribbon(game.scene, pts, width, 0.03);
  // no grass on the path
  const r2 = (width * 0.6) ** 2;
  clearGrassWhere(pts.map((p) => p.x), pts.map((p) => p.z), (x, z) => pts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < r2));
}

// Take the grass away where `inside(x, z)` says so. cx/cz: points that cover the area (to pick the
// chunks to look at). Tufts are only scaled down to nothing, so nothing else about the chunk changes.
export function clearGrassWhere(cx, cz, inside) {
  for (const ch of chunks) {
    let near = false;
    for (let i = 0; i < cx.length && !near; i++) near = Math.abs(cx[i] - ch.center.x) < CHUNK / 2 + 1 && Math.abs(cz[i] - ch.center.z) < CHUNK / 2 + 1;
    if (!near) continue;
    let hit = false;
    for (let i = 0; i < ch.grass.count; i++) {
      ch.grass.getMatrixAt(i, _m);
      const x = _m.elements[12], z = _m.elements[14];
      if (_m.elements[0] !== 0 && inside(x, z)) { ch.grass.setMatrixAt(i, _m.makeScale(0, 0, 0)); hit = true; }
    }
    if (hit) ch.grass.instanceMatrix.needsUpdate = true;
  }
}

function buildTerrain(scene) {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SIZE, SIZE);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    groundColor(pos.getX(i), pos.getZ(i), nrm.getY(i), c);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  terrainMesh = mesh;

  // a big skirt far below the hills so the horizon never shows a hole
  const skirt = new THREE.Mesh(new THREE.RingGeometry(SIZE * 0.7, 3000, 48, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x3f5a2c, roughness: 1 }));
  skirt.position.y = 18;
  scene.add(skirt);
}

// The ground changed (streets dug into it) between grid points gx0..gx1, gz0..gz1: the land's mesh,
// its colour, the physics heightfield, and the trees and stumps standing there follow terrainHeight again.
let terrainMesh = null;
export function reshapeGround(gx0, gz0, gx1, gz1) {
  const N = SIZE + 1;
  gx0 = Math.max(0, gx0); gz0 = Math.max(0, gz0); gx1 = Math.min(SIZE, gx1); gz1 = Math.min(SIZE, gz1);
  const geo = terrainMesh.geometry, pos = geo.attributes.position, hf = groundBody.shapes[0];
  for (let gz = gz0; gz <= gz1; gz++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const h = terrainHeight(gx - HALF, gz - HALF);
      pos.setY(gz * N + gx, h);
      hf.setHeightValueAtIndex(gx, SIZE - gz, h);
    }
  }
  hf.update();
  groundBody.aabbNeedsUpdate = true;
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal, col = geo.attributes.color, c = new THREE.Color();
  for (let gz = Math.max(0, gz0 - 1); gz <= Math.min(SIZE, gz1 + 1); gz++) {
    for (let gx = Math.max(0, gx0 - 1); gx <= Math.min(SIZE, gx1 + 1); gx++) {
      const i = gz * N + gx;
      groundColor(gx - HALF, gz - HALF, nrm.getY(i), c);
      col.setXYZ(i, c.r, c.g, c.b);
    }
  }
  col.needsUpdate = true;
  geo.computeBoundingSphere();
  const x0 = gx0 - HALF - 1, x1 = gx1 - HALF + 1, z0 = gz0 - HALF - 1, z1 = gz1 - HALF + 1;
  const inBox = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  // fresh earth: no grass on it (points every few metres over the box, so every chunk in it is looked at)
  const px = [], pz = [];
  for (let x = x0; x <= x1 + 8; x += 8) for (let z = z0; z <= z1 + 8; z += 8) { px.push(Math.min(x, x1)); pz.push(Math.min(z, z1)); }
  clearGrassWhere(px, pz, (x, z) => inBox(x, z) && scarAt(x, z) > 0.3);
  for (const t of trees) {
    if (!t.alive || !inBox(t.x, t.z)) continue;
    t.y = terrainHeight(t.x, t.z);
    writeTree(t);
    if (t.body) t.body.position.y = t.y + t.h / 2;
  }
  for (const s of stumps) {
    if (!inBox(s.t.x, s.t.z)) continue;
    s.t.y = terrainHeight(s.t.x, s.t.z);
    s.mesh.position.y = s.body.position.y = s.t.y + 0.1;
  }
}

// Dig a stump out (a street goes there): it's gone, hole and all. Takes the stump or its tree.
export function removeStump(s) {
  const i = stumps.findIndex((e) => e === s || e.t === s);
  if (i < 0) return;
  s = stumps[i];
  stumps.splice(i, 1);
  game.scene.remove(s.mesh);
  world.removeBody(s.body);
  s.t.dugOut = true;
}

// Every rock: { x, z, r, big, body, gone } (big ones are solid).
export const rocks = [];

function buildGroundPhysics() {
  const N = SIZE + 1, data = [];
  for (let i = 0; i < N; i++) {
    const row = [];
    for (let j = 0; j < N; j++) row.push(terrainHeight(-HALF + i, HALF - j));
    data.push(row);
  }
  groundBody = new CANNON.Body({ mass: 0, material: MAT.ground, collisionFilterGroup: GROUP.GROUND, collisionFilterMask: MASK.ALL });
  groundBody.addShape(new CANNON.Heightfield(data, { elementSize: 1 }));
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.position.set(-HALF, 0, HALF);
  groundBody.isGround = true;
  world.addBody(groundBody);
  refs.ground = groundBody;
}

const hitsFor = (r) => Math.round(4 + r * 22);

function genTrees() {
  const R = rng(777), step = 3.3;
  for (let gx = -HALF + 2; gx < HALF - 2; gx += step) {
    for (let gz = -HALF + 2; gz < HALF - 2; gz += step) {
      const x = gx + (R() - 0.5) * step * 0.85, z = gz + (R() - 0.5) * step * 0.85;
      const d = Math.hypot(x, z);
      if (d < 11 || roadDist(x, z) < 4.6 || parkDist(x, z) < 5 || yardDist(x, z) < YARD.r + 3) continue;
      const f = forestDensity(x, z);
      let p = f > 0.08 ? 0.8 : f > -0.12 ? 0.3 : 0.06;
      if (d < 24) p = Math.max(p * 0.6, 0.16);
      if (R() > p) continue;
      const pine = pineChance(x, z) + (R() - 0.5) * 0.5 > 0.12;
      const r = 0.11 + R() * 0.11 + (pine ? 0 : 0.02);
      trees.push({
        i: trees.length, x, z, y: terrainHeight(x, z), r,
        h: pine ? 6.5 + R() * 4 : 4.6 + R() * 2.6,
        kind: pine ? 'pine' : 'oak',
        cr: pine ? 1.35 + R() * 0.6 : 1.7 + R() * 0.8,
        rot: R() * Math.PI * 2,
        color: pine
          ? new THREE.Color().setHSL(0.33 + R() * 0.05, 0.32 + R() * 0.12, 0.2 + R() * 0.06, THREE.SRGBColorSpace)
          : new THREE.Color().setHSL(0.22 + R() * 0.07, 0.42 + R() * 0.16, 0.28 + R() * 0.08, THREE.SRGBColorSpace),
        bark: new THREE.Color().setScalar(0.8 + R() * 0.35),
        hp: hitsFor(r), maxHp: hitsFor(r), alive: true, body: null,
        shake: 0, shakePh: 0, shakeAxis: new THREE.Vector3(1, 0, 0),
      });
    }
  }
}

function buildChunks(scene) {
  const trunkGeo = trunkGeometry(), oakGeo = oakGeometry(), pineGeo = pineGeometry(), tuftGeo = tuftGeometry();
  const flowerGeo = new THREE.IcosahedronGeometry(0.035, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ map: TEX.bark, roughness: 0.95 });
  const canopyMat = makeCanopyMaterial();
  const grassMat = grassMaterial();
  const flowerMat = new THREE.MeshLambertMaterial();
  const flowerCols = [0xf4f1e6, 0xf2d24b, 0xb48be0, 0xf09ab8, 0xffffff].map((c) => new THREE.Color(c));
  const R = rng(4242), c = new THREE.Color();

  for (let cz = 0; cz < NCH; cz++) {
    for (let cx = 0; cx < NCH; cx++) {
      const x0 = -HALF + cx * CHUNK, z0 = -HALF + cz * CHUNK;
      const ch = { cx, cz, center: new THREE.Vector3(x0 + CHUNK / 2, terrainHeight(x0 + CHUNK / 2, z0 + CHUNK / 2), z0 + CHUNK / 2), trees: [] };
      for (const t of trees) if (t.x >= x0 && t.x < x0 + CHUNK && t.z >= z0 && t.z < z0 + CHUNK) ch.trees.push(t);
      const oaks = ch.trees.filter((t) => t.kind === 'oak'), pines = ch.trees.filter((t) => t.kind === 'pine');

      if (ch.trees.length) {
        ch.trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, ch.trees.length);
        ch.oaks = oaks.length ? new THREE.InstancedMesh(oakGeo, canopyMat, oaks.length) : null;
        ch.pines = pines.length ? new THREE.InstancedMesh(pineGeo, canopyMat, pines.length) : null;
        ch.trees.forEach((t, i) => { t.chunk = ch; t.ti = i; ch.trunks.setColorAt(i, t.kind === 'pine' ? c.copy(t.bark).multiply(new THREE.Color(1.1, 0.92, 0.85)) : t.bark); });
        oaks.forEach((t, i) => { t.ci = i; ch.oaks.setColorAt(i, t.color); });
        pines.forEach((t, i) => { t.ci = i; ch.pines.setColorAt(i, t.color); });
        for (const t of ch.trees) writeTree(t);
        for (const m of [ch.trunks, ch.oaks, ch.pines]) {
          if (!m) continue;
          m.castShadow = true;
          m.receiveShadow = true;
          m.computeBoundingSphere();
          scene.add(m);
        }
      }

      // grass
      const gx = [], gcol = [];
      for (let k = 0; k < 3400; k++) {
        const x = x0 + R() * CHUNK, z = z0 + R() * CHUNK;
        const f = forestDensity(x, z), dirt = dirtAmount(x, z);
        if (dirt > 0.35 || Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1 || roadDist(x, z) < 2.5 || yardDist(x, z) < YARD.r - 1) continue;
        const ny = slopeNy(x, z);
        if (R() > (f > 0.1 ? 0.5 : 0.95) * smoothstep(0.7, 0.88, ny)) continue;
        gx.push([x, terrainHeight(x, z) - 0.02, z, 0.21 + R() * 0.17 + (f > 0.1 ? 0.04 : 0), R() * Math.PI * 2]);
        groundColor(x, z, ny, c).multiplyScalar(1.05 + R() * 0.2);
        gcol.push(c.clone());
      }
      ch.grass = new THREE.InstancedMesh(tuftGeo, grassMat, gx.length);
      gx.forEach(([x, y, z, s, rot], i) => {
        ch.grass.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(Y, rot), _s.set(s, s * (0.8 + R() * 0.5), s)));
        ch.grass.setColorAt(i, gcol[i]);
      });
      if (MOBILE) ch.grass.count = Math.floor(gx.length * 0.45); // a phone draws fewer tufts (the same random numbers are still used, so the world stays the same)
      ch.grass.receiveShadow = true;
      ch.grass.computeBoundingSphere();
      scene.add(ch.grass);

      // flowers, only out in the open
      const fl = [];
      for (let k = 0; k < 160; k++) {
        const x = x0 + R() * CHUNK, z = z0 + R() * CHUNK;
        if (forestDensity(x, z) > -0.05 || dirtAmount(x, z) > 0.2 || slopeNy(x, z) < 0.85 || roadDist(x, z) < 3 || yardDist(x, z) < YARD.r + 2) continue;
        fl.push([x, terrainHeight(x, z) + 0.2 + R() * 0.14, z]);
      }
      ch.flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, Math.max(1, fl.length));
      ch.flowers.count = fl.length;
      const clump = flowerCols[(R() * flowerCols.length) | 0];
      fl.forEach(([x, y, z], i) => {
        ch.flowers.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.identity(), _s.setScalar(0.7 + R() * 0.7)));
        ch.flowers.setColorAt(i, R() < 0.6 ? clump : flowerCols[(R() * flowerCols.length) | 0]);
      });
      ch.flowers.computeBoundingSphere();
      scene.add(ch.flowers);

      chunks.push(ch);
    }
  }
}

function slopeNy(x, z) {
  const hx = terrainHeight(x + 0.5, z) - terrainHeight(x - 0.5, z);
  const hz = terrainHeight(x, z + 0.5) - terrainHeight(x, z - 0.5);
  return 1 / Math.sqrt(hx * hx + hz * hz + 1);
}

// Write one tree's matrices (with its shake, if it is being chopped).
function writeTree(t) {
  const ch = t.chunk;
  const canopy = t.kind === 'oak' ? ch.oaks : ch.pines;
  if (!t.alive) {
    _m.makeScale(0, 0, 0);
    ch.trunks.setMatrixAt(t.ti, _m);
    canopy.setMatrixAt(t.ci, _m);
  } else {
    const tilt = t.shake > 0 ? Math.sin(t.shakePh) * t.shake * 0.035 : 0;
    _q2.setFromAxisAngle(t.shakeAxis, tilt);
    _q.setFromAxisAngle(Y, t.rot).premultiply(_q2);
    _p.set(t.x, t.y - 0.25, t.z);
    ch.trunks.setMatrixAt(t.ti, _m.compose(_p, _q, _s.set(t.r, t.h + 0.25, t.r)));
    if (t.kind === 'oak') {
      _v.set(0, t.h + 0.25 - t.cr * 0.3, 0).applyQuaternion(_q2);
      canopy.setMatrixAt(t.ci, _m.compose(_p.add(_v), _q, _s.set(t.cr, t.cr * 0.82, t.cr)));
    } else {
      _v.set(0, t.h * 0.28 + 0.25, 0).applyQuaternion(_q2);
      canopy.setMatrixAt(t.ci, _m.compose(_p.add(_v), _q, _s.set(t.cr, (t.h * 0.8) / 2.4, t.cr)));
    }
  }
  ch.trunks.instanceMatrix.needsUpdate = true;
  canopy.instanceMatrix.needsUpdate = true;
}

function buildRocks(scene) {
  const R = rng(31), parts = [];
  const place = (x, z, s) => {
    const g = new THREE.DodecahedronGeometry(1, 0);
    jitter(g, 0.35, (R() * 1e6) | 0);
    g.scale(s * (0.8 + R() * 0.5), s * (0.5 + R() * 0.3), s * (0.8 + R() * 0.4));
    g.rotateY(R() * 6);
    const y = terrainHeight(x, z);
    g.translate(x, y + s * 0.12, z);
    const col = new Float32Array(g.attributes.position.count * 3);
    const base = 0.42 + R() * 0.14, moss = R() < 0.5;
    for (let f = 0; f < col.length / 9; f++) {
      const v = base * (0.85 + R() * 0.3);
      const up = g.attributes.normal.getY(f * 3) > 0.6 && moss;
      col.set(up ? [v * 0.62, v * 0.8, v * 0.42, v * 0.62, v * 0.8, v * 0.42, v * 0.62, v * 0.8, v * 0.42] : [v, v * 0.98, v * 0.93, v, v * 0.98, v * 0.93, v, v * 0.98, v * 0.93], f * 9);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
    const rock = { x, z, r: s * 1.1, big: s > 0.4, body: null, i: rocks.length };
    rocks.push(rock);
    if (rock.big) {
      const b = new CANNON.Body({ mass: 0, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: MASK.ALL });
      b.addShape(new CANNON.Sphere(s * 0.72));
      b.position.set(x, y + s * 0.05, z);
      b.rock = rock;
      world.addBody(b);
      rock.body = b;
    }
  };
  for (let k = 0; k < 90; k++) {
    const x = (R() - 0.5) * (SIZE - 12), z = (R() - 0.5) * (SIZE - 12);
    if (Math.hypot(x, z) < 9 || roadDist(x, z) < 5 || parkDist(x, z) < 5 || yardDist(x, z) < YARD.r + 3) continue;
    place(x, z, R() < 0.85 ? 0.2 + R() * 0.45 : 0.7 + R() * 0.7);
  }
  // a few right next to camp, to make it feel lived in
  place(-6.5, 3.2, 0.55); place(-7.3, 2.4, 0.3); place(7.8, -5.5, 0.45);
  for (const g of parts) g.deleteAttribute('uv');
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let v = 0;
  flat.forEach((g, i) => { rocks[i].v0 = v; v += g.attributes.position.count; rocks[i].v1 = v; });
  const merged = mergeGeometries(flat);
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  rockMesh = mesh;
}

// A rock dug out of the way (a street goes there): gone from the land.
let rockMesh = null;
export function removeRock(r) {
  if (r.gone) return;
  r.gone = true;
  const pos = rockMesh.geometry.attributes.position;
  for (let i = r.v0; i < r.v1; i++) pos.setXYZ(i, r.x, -50, r.z);
  pos.needsUpdate = true;
  if (r.body) { world.removeBody(r.body); r.body = null; }
}

// A crate of nails at camp — your starting supplies.
function buildCamp(scene) {
  const x = 2.4, z = -1.6, y = terrainHeight(x, z);
  const wood = new THREE.MeshStandardMaterial({ map: TEX.grain, color: 0xb59468, roughness: 0.85 });
  const crate = new THREE.Group();
  const add = (w, h, d, px, py, pz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
    m.position.set(px, py, pz);
    m.castShadow = m.receiveShadow = true;
    crate.add(m);
  };
  add(0.5, 0.03, 0.34, 0, 0.015, 0);
  for (const s of [-1, 1]) {
    add(0.5, 0.2, 0.025, 0, 0.12, s * 0.16);
    add(0.025, 0.2, 0.3, s * 0.24, 0.12, 0);
  }
  add(0.04, 0.03, 0.03, 0, 0.23, 0); // handle peg
  const nailMat = new THREE.MeshStandardMaterial({ color: 0xb4babe, metalness: 0.35, roughness: 0.4 });
  const nailGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.09, 5);
  const R = rng(2);
  for (let i = 0; i < 70; i++) {
    const n = new THREE.Mesh(nailGeo, nailMat);
    n.position.set((R() - 0.5) * 0.42, 0.13 + R() * 0.04, (R() - 0.5) * 0.26);
    n.rotation.set(Math.PI / 2 + (R() - 0.5) * 0.6, R() * 6, (R() - 0.5) * 0.6);
    crate.add(n);
  }
  crate.position.set(x, y, z);
  crate.rotation.y = 0.4;
  scene.add(crate);
  const b = new CANNON.Body({ mass: 0, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: MASK.ALL });
  b.addShape(new CANNON.Box(new CANNON.Vec3(0.25, 0.12, 0.17)));
  b.position.set(x, y + 0.12, z);
  b.quaternion.setFromEuler(0, 0.4, 0);
  b.nailbox = true;
  world.addBody(b);
}

// ───────────────────────── trees: colliders, chopping, falling ─────────────────────────

function addTreeBody(t) {
  const b = new CANNON.Body({ mass: 0, collisionFilterGroup: GROUP.TREE, collisionFilterMask: GROUP.PIECE | GROUP.PLAYER | GROUP.CAR });
  b.addShape(new CANNON.Cylinder(t.r * 0.9, t.r, t.h, 8));
  b.position.set(t.x, t.y + t.h / 2, t.z);
  b.tree = t;
  world.addBody(b);
  t.body = b;
}

let colliderTimer = 0;
function updateColliders(cam) {
  for (const t of trees) {
    if (!t.alive) continue;
    const d = Math.hypot(t.x - cam.x, t.z - cam.z);
    if (d < 40 && !t.body) addTreeBody(t);
    else if (d > 48 && t.body) {
      world.removeBody(t.body);
      t.body = null;
    }
  }
}

// One axe hit. Returns hits left.
export function chopTree(t, fromPos) {
  if (!t.alive) return 0;
  t.hp--;
  const away = _v.set(t.x - fromPos.x, 0, t.z - fromPos.z).normalize();
  t.shakeAxis.set(away.z, 0, -away.x);
  t.shake = 1;
  t.shakePh = 0;
  shaking.add(t);
  if (t.hp <= 0) fell(t, away.clone());
  return t.hp;
}

const STUMP_H = 0.7;
function makeStump(t) {
  const sGeo = new THREE.CylinderGeometry(t.r * 0.97, t.r * 1.04, STUMP_H, 12);
  const stump = new THREE.Mesh(sGeo, [new THREE.MeshStandardMaterial({ map: TEX.bark, roughness: 0.95 }), new THREE.MeshStandardMaterial({ map: TEX.end, roughness: 0.85 }), new THREE.MeshStandardMaterial({ map: TEX.end })]);
  stump.position.set(t.x, t.y + 0.1, t.z);
  stump.castShadow = stump.receiveShadow = true;
  game.scene.add(stump);
  const sb = new CANNON.Body({ mass: 0, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: MASK.ALL });
  sb.addShape(new CANNON.Cylinder(t.r, t.r, STUMP_H, 10));
  sb.position.set(t.x, t.y + 0.1, t.z);
  sb.stump = t;
  world.addBody(sb);
  stumps.push({ t, mesh: stump, body: sb });
  return sb;
}

// One axe hit on a stump: it gets chopped lower each time, and the last hit leaves a short log
// lying next to it. Returns hits left.
export function chopStump(t) {
  const s = stumps.find((e) => e.t === t);
  if (!s) return 0;
  const max = 5 + Math.round(t.r * 20); // thin pine ~7 hits, a thick oak ~10
  t.stumpHp = (t.stumpHp ?? max) - 1;
  const k = Math.max(0.15, t.stumpHp / max);
  s.mesh.scale.y = k;
  s.mesh.position.y = t.y + 0.1 - (STUMP_H * (1 - k)) / 2; // the top comes down, the bottom stays
  if (t.stumpHp > 0) return t.stumpHp;
  removeStump(s);
  const len = STUMP_H * 0.85, r = t.r * 0.95;
  const q = new CANNON.Quaternion().setFromEuler(Math.PI / 2, Math.random() * Math.PI, 0, 'YXZ');
  new Piece('log', { r, len, species: t.kind === 'oak' ? 'oak' : 'pine' }, { x: t.x + 0.3, y: t.y + r + 0.06, z: t.z }, q);
  return 0;
}

// A loaded game: this tree was cut down before (its log, if any, is loaded with the other wood).
export function felledBefore(t) {
  if (!t.alive) return;
  t.alive = false;
  writeTree(t);
  if (t.body) { world.removeBody(t.body); t.body = null; }
  makeStump(t);
}

// Cleared away for a village that was already there (a start mode): no stump, no log.
export function clearTree(t) {
  if (!t.alive) return;
  t.alive = false;
  t.cleared = true;
  writeTree(t);
  if (t.body) { world.removeBody(t.body); t.body = null; }
}

// The tree's physics body, made now if you are too far away for it to exist (nails into trees, after a load).
export function treeBody(t) {
  if (t.alive && !t.body) addTreeBody(t);
  return t.body;
}

// Chopped but still standing (a loaded game).
export function damageTree(t, hp) { t.hp = Math.max(1, Math.min(t.maxHp, hp)); }

function fell(t, dir) {
  t.alive = false;
  shaking.delete(t);
  writeTree(t);
  if (t.body) { detachBody(t.body); world.removeBody(t.body); t.body = null; }
  const sb = makeStump(t);
  const sh = STUMP_H;

  // the trunk becomes a real log that tips over
  const len = t.h - 0.45, r = t.r * 0.9;
  const q = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), t.rot);
  const log = new Piece('log', { r, len, species: t.kind === 'oak' ? 'oak' : 'pine' }, { x: t.x, y: t.y + 0.45 + len / 2 + 0.005, z: t.z }, q);
  log.falling = true;
  t.log = log; // (a lumberjack who felled it comes back for it)
  const canopy = new THREE.Mesh(t.kind === 'oak' ? oakGeoCache() : pineGeoCache(), makeCanopyMaterial(t.color));
  canopy.castShadow = true;
  if (t.kind === 'oak') {
    canopy.position.set(0, t.h + 0.25 - t.cr * 0.3 - (0.45 + len / 2), 0);
    canopy.scale.set(t.cr, t.cr * 0.82, t.cr);
  } else {
    canopy.position.set(0, t.h * 0.28 + 0.25 - (0.45 + len / 2), 0);
    canopy.scale.set(t.cr, (t.h * 0.8) / 2.4, t.cr);
  }
  log.mesh.add(canopy);

  const hinge = new CANNON.PointToPointConstraint(log.body, new CANNON.Vec3(0, -len / 2, 0), sb, new CANNON.Vec3(0, sh / 2, 0), 1e6);
  hinge.collideConnected = false;
  world.addConstraint(hinge);
  const axis = new THREE.Vector3().crossVectors(Y, dir);
  log.body.angularVelocity.set(axis.x * 0.3, 0, axis.z * 0.3);
  log.body.wakeUp();
  falling.push({ t, log, canopy, hinge, time: 0, landed: false, shrink: 0, scale0: canopy.scale.clone() });
  audio.creak();
}

let _oakGeo, _pineGeo;
const oakGeoCache = () => (_oakGeo ??= oakGeometry());
const pineGeoCache = () => (_pineGeo ??= pineGeometry());

function updateFalling(dt) {
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i];
    f.time += dt;
    const ax = f.log.axis();
    const tilt = Math.acos(clamp(ax.y, -1, 1));
    if (f.hinge && (tilt > 1.15 || f.time > 6)) { world.removeConstraint(f.hinge); f.hinge = null; }
    if (!f.landed && (tilt > 1.3 || f.time > 7)) {
      f.landed = true;
      audio.crash();
      f.canopy.getWorldPosition(_p);
      particles.emit('leaf', _p, Y, 70, f.t.color);
      particles.emit('dirt', _p.set(_p.x, terrainHeight(_p.x, _p.z) + 0.1, _p.z), Y, 25);
    }
    if (f.landed) {
      f.shrink = Math.min(1, f.shrink + dt * 1.8);
      const k = 1 - f.shrink * f.shrink;
      f.canopy.scale.copy(f.scale0).multiplyScalar(Math.max(0.001, k));
      if (f.shrink >= 1) {
        f.log.mesh.remove(f.canopy);
        f.canopy.material.dispose();
        f.log.falling = false;
        if (f.hinge) world.removeConstraint(f.hinge);
        falling.splice(i, 1);
      }
    }
  }
}

export function updateWorld(dt, cam) {
  for (const ch of chunks) {
    const d = Math.hypot(ch.center.x - cam.x, ch.center.z - cam.z);
    ch.grass.visible = d < (MOBILE ? 42 : 66);
    ch.flowers.visible = d < (MOBILE ? 60 : 90);
    // a phone: trees far in the fog are not drawn (the canopies are also coarser there, see oakGeometry)
    if (MOBILE) { const show = d < 170; for (const m of [ch.trunks, ch.oaks, ch.pines]) if (m) m.visible = show; }
  }
  colliderTimer -= dt;
  if (colliderTimer <= 0) { colliderTimer = 0.4; updateColliders(cam); }
  for (const t of shaking) {
    t.shake -= dt * 2.4;
    t.shakePh += dt * 30;
    if (t.shake <= 0) { t.shake = 0; shaking.delete(t); }
    writeTree(t);
  }
  updateFalling(dt);
}
