// Hand-painted canvas textures: bark, log ends, plank grain, flannel sleeve.
import * as THREE from 'three';
import { rng } from './util.js';

export const TEX = {};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, aniso) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

// Vertical line that wobbles but meets itself at top and bottom, so it tiles.
function wavyLine(g, x0, h, k, amp, ph) {
  g.beginPath();
  for (let y = 0; y <= h; y += 4) {
    const x = x0 + Math.sin((y / h) * Math.PI * 2 * k + ph) * amp + Math.sin((y / h) * Math.PI * 2 * (k + 2) + ph * 1.7) * amp * 0.3;
    y === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
}

function bark() {
  const [c, g] = canvas(256, 256);
  const R = rng(5);
  g.fillStyle = '#5c4632';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    const x = R() * 256;
    g.strokeStyle = R() < 0.55 ? '#33261a' : '#7d6449';
    g.globalAlpha = 0.2 + R() * 0.45;
    g.lineWidth = 1 + R() * 4;
    for (const dx of [-256, 0, 256]) wavyLine(g, x + dx, 256, 1 + Math.floor(R() * 3), 2 + R() * 4, R() * 6);
  }
  // little horizontal cracks
  g.strokeStyle = '#2a1e14';
  for (let i = 0; i < 70; i++) {
    g.globalAlpha = 0.25 + R() * 0.35;
    g.lineWidth = 1 + R() * 1.5;
    const x = R() * 256, y = R() * 256, w = 4 + R() * 12;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + (R() - 0.5) * 3); g.stroke();
  }
  g.globalAlpha = 1;
  return c;
}

function endGrain() {
  const [c, g] = canvas(256, 256);
  const R = rng(9);
  g.fillStyle = '#4e3b2a';
  g.fillRect(0, 0, 256, 256);
  // sapwood → heartwood
  const grad = g.createRadialGradient(128, 128, 4, 128, 128, 116);
  grad.addColorStop(0, '#b98d58');
  grad.addColorStop(0.55, '#cfa772');
  grad.addColorStop(0.92, '#dcbd8a');
  grad.addColorStop(1, '#c9a676');
  g.fillStyle = grad;
  g.beginPath(); g.arc(128, 128, 116, 0, Math.PI * 2); g.fill();
  // growth rings
  for (let r = 5; r < 114; r += 3 + R() * 4.5) {
    g.strokeStyle = '#9b7444';
    g.globalAlpha = 0.25 + R() * 0.4;
    g.lineWidth = 0.8 + R() * 1.6;
    const ph = R() * 6, ph2 = R() * 6;
    g.beginPath();
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const rr = r * (1 + 0.025 * Math.sin(a * 3 + ph) + 0.015 * Math.sin(a * 5 + ph2));
      const x = 128 + Math.cos(a) * rr, y = 128 + Math.sin(a) * rr;
      k === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }
  // a couple of drying cracks
  g.strokeStyle = '#4a3420';
  g.globalAlpha = 0.6;
  for (let i = 0; i < 2; i++) {
    const a = R() * Math.PI * 2;
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(128 + Math.cos(a) * 10, 128 + Math.sin(a) * 10);
    g.lineTo(128 + Math.cos(a + 0.05) * 60, 128 + Math.sin(a + 0.05) * 60); g.stroke();
  }
  g.globalAlpha = 1;
  return c;
}

function plankGrain() {
  const [c, g] = canvas(128, 512);
  const R = rng(13);
  g.fillStyle = '#cda46c';
  g.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 90; i++) {
    const x = R() * 128;
    g.strokeStyle = R() < 0.6 ? '#a57a46' : '#e2c08c';
    g.globalAlpha = 0.18 + R() * 0.42;
    g.lineWidth = 0.6 + R() * 2.4;
    const k = 1 + Math.floor(R() * 2), amp = 1 + R() * 5, ph = R() * 6;
    for (const dx of [-128, 0, 128]) wavyLine(g, x + dx, 512, k, amp, ph);
  }
  // one knot
  const kx = 30 + R() * 68, ky = 60 + R() * 380;
  for (let r = 9; r > 1; r -= 2) {
    g.globalAlpha = 0.35;
    g.fillStyle = r > 5 ? '#9c703e' : '#6e4a26';
    g.beginPath(); g.ellipse(kx, ky, r * 0.8, r * 1.5, 0, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  return c;
}

// Dirt road seen from above: u goes across (edges fade out), v along the road.
function roadDirt() {
  const [c, g] = canvas(128, 256);
  const R = rng(21);
  const img = g.createImageData(128, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 128; x++) {
      const u = x / 127;
      const edge = Math.min(1, Math.min(u, 1 - u) / 0.18);
      const rut = Math.exp(-((u - 0.3) ** 2) / 0.004) + Math.exp(-((u - 0.7) ** 2) / 0.004);
      const n = R() * 0.16;
      const v = 0.92 - rut * 0.16 + n - (R() < 0.012 ? 0.25 : 0);
      const i = (y * 128 + x) * 4;
      img.data[i] = 150 * v; img.data[i + 1] = 124 * v; img.data[i + 2] = 92 * v;
      img.data[i + 3] = 255 * edge * edge * (0.85 + R() * 0.15);
    }
  }
  g.putImageData(img, 0, 0);
  // pebbles
  for (let k = 0; k < 120; k++) {
    g.fillStyle = R() < 0.5 ? 'rgba(190,178,160,0.8)' : 'rgba(90,76,60,0.6)';
    const x = 14 + R() * 100, y = R() * 256, r = 0.6 + R() * 1.6;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return c;
}

// Fired clay: warm base with darker and lighter specks; tinted per brick.
function brick() {
  const [c, g] = canvas(128, 64);
  const R = rng(17);
  g.fillStyle = '#d8d0c8';
  g.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 900; i++) {
    const v = R();
    g.fillStyle = v < 0.5 ? `rgba(80,60,50,${0.15 + R() * 0.3})` : `rgba(255,245,235,${0.1 + R() * 0.25})`;
    g.fillRect(R() * 128, R() * 64, 1 + R() * 2, 1 + R() * 2);
  }
  // a darker, slightly burnt edge
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(60,40,30,0.18)');
  grad.addColorStop(0.15, 'rgba(60,40,30,0)');
  grad.addColorStop(0.85, 'rgba(60,40,30,0)');
  grad.addColorStop(1, 'rgba(60,40,30,0.2)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 64);
  return c;
}

// One wave of corrugated roofing, lit from above: bright crest, dark trough.
function sheetWave() {
  const [c, g] = canvas(64, 16);
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, '#6d6d6d');
  grad.addColorStop(0.25, '#ffffff');
  grad.addColorStop(0.5, '#a8a8a8');
  grad.addColorStop(0.75, '#4a4a4a');
  grad.addColorStop(1, '#6d6d6d');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 16);
  return c;
}

function flannel() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#7a2b26';
  g.fillRect(0, 0, 64, 64);
  g.globalAlpha = 0.55;
  g.fillStyle = '#2b1a1c';
  g.fillRect(0, 22, 64, 14); g.fillRect(22, 0, 14, 64);
  g.globalAlpha = 0.35;
  g.fillStyle = '#d9b48a';
  g.fillRect(0, 52, 64, 2); g.fillRect(52, 0, 2, 64);
  g.globalAlpha = 1;
  return c;
}

export function initTextures(renderer) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  TEX.bark = finish(bark(), aniso);
  TEX.end = finish(endGrain(), aniso);
  TEX.end.wrapS = TEX.end.wrapT = THREE.ClampToEdgeWrapping;
  TEX.grain = finish(plankGrain(), aniso);
  TEX.flannel = finish(flannel(), aniso);
  TEX.brick = finish(brick(), aniso);
  TEX.sheet = finish(sheetWave(), aniso);
  TEX.road = finish(roadDirt(), aniso);
  TEX.road.wrapS = THREE.ClampToEdgeWrapping;
  TEX.flannel.repeat.set(3, 3);
}
