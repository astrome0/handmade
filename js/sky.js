// Sun, moon, sky colour, fog and stars over a 24-minute day.
import * as THREE from 'three';
import { MOBILE } from './device.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { smoothstep } from './util.js';

const DAY_SECONDS = 24 * 60;
const SHADOW_SIZE = 38, SHADOW_MAP = MOBILE ? 1024 : 2048;

const COL = {
  skyDay: new THREE.Color(0xc4dcf7), skyGold: new THREE.Color(0xf3c9a0), skyNight: new THREE.Color(0x3a4d78),
  groundDay: new THREE.Color(0x56603a), groundNight: new THREE.Color(0x1b2419),
  fogDay: new THREE.Color(0xc2d6e6), fogGold: new THREE.Color(0xe8bf98), fogNight: new THREE.Color(0x0b1322),
  sunDay: new THREE.Color(0xfff4e2), sunGold: new THREE.Color(0xffa860), moon: new THREE.Color(0x9fb6ff),
};

export class DayCycle {
  constructor(scene, renderer) {
    this.renderer = renderer;
    this.t = 0.3; // 07:12 — morning
    this.day = 1;

    this.sky = new Sky();
    this.sky.scale.setScalar(4000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 5;
    u.rayleigh.value = 1.3;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -SHADOW_SIZE;
    sc.right = sc.top = SHADOW_SIZE;
    sc.near = 1;
    sc.far = 260;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xc4dcf7, 0x56603a, 1);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xc2d6e6, MOBILE ? 0.011 : 0.0095) /* (a phone draws trees only to 170 m: a touch more fog hides the edge) */;
    this.fog = scene.fog;

    // a deep blue dome that fades in after sunset (the day sky turns brown at night)
    this.night = new THREE.Mesh(new THREE.SphereGeometry(1900, 32, 16), new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uAlpha; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 c = mix(vec3(0.075, 0.115, 0.2), vec3(0.018, 0.03, 0.07), pow(h, 0.6));
          gl_FragColor = vec4(c, uAlpha);
        }`,
      side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    }));
    scene.add(this.night);

    // stars
    const n = 1600, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.05, Math.random() - 0.5).normalize().multiplyScalar(1800);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: 0xffffff, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(this.stars);

    this.sunDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.daylight = 1;
    this.update(0, new THREE.Vector3());
  }

  get clock() {
    const m = Math.floor(this.t * 24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  update(dt, focus) {
    const before = this.t;
    this.t = (this.t + dt / DAY_SECONDS) % 1;
    if (this.t < before) this.day++;

    const a = (this.t - 0.25) * Math.PI * 2; // sunrise at 06:00
    const elev = Math.sin(a);
    this.sunDir.set(Math.cos(a) * 0.9, elev, 0.42).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);

    const day = smoothstep(-0.1, 0.16, elev);
    const gold = smoothstep(0.32, 0.03, elev) * smoothstep(-0.12, 0.03, elev);
    this.daylight = day;

    // the light comes from the sun by day and the moon by night
    if (elev > 0) {
      this.lightDir.copy(this.sunDir);
      this.sun.color.copy(COL.sunDay).lerp(COL.sunGold, gold);
      this.sun.intensity = 3.4 * smoothstep(-0.02, 0.12, elev);
    } else {
      this.lightDir.set(-this.sunDir.x, -this.sunDir.y, this.sunDir.z).normalize();
      this.sun.color.copy(COL.moon);
      this.sun.intensity = 0.9 * smoothstep(0.0, 0.15, -elev);
    }

    this.hemi.color.copy(COL.skyNight).lerp(COL.skyDay, day).lerp(COL.skyGold, gold * 0.5);
    this.hemi.groundColor.copy(COL.groundNight).lerp(COL.groundDay, day);
    this.hemi.intensity = 0.95 + 0.35 * day;
    this.fog.color.copy(COL.fogNight).lerp(COL.fogDay, day).lerp(COL.fogGold, gold * 0.7);
    this.stars.material.opacity = 1 - smoothstep(-0.18, 0.04, elev);
    this.night.material.uniforms.uAlpha.value = 1 - smoothstep(-0.2, 0.02, elev);
    this.night.position.copy(focus);
    this.stars.position.copy(focus);
    this.stars.rotation.y = this.t * Math.PI * 2;
    this.renderer.toneMappingExposure = 0.42 + 0.18 * day;

    // keep the shadow box around the player, snapped to whole shadow pixels so edges don't crawl
    const texel = (SHADOW_SIZE * 2) / SHADOW_MAP;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(this.lightDir, 120);
    this.sun.target.updateMatrixWorld();
  }
}
