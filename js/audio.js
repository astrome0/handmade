// Every sound is made right here with WebAudio — no sound files.
let ctx = null, out = null, noise = null;
let saw = null, wind = null, eng = null, hyd = null, car = null;
let birdTimer = 3, cricketTimer = 2;

function now() { return ctx.currentTime; }

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function nz({ t = 0, type = 'bandpass', f = 1000, f2, q = 1, a = 0.002, d = 0.1, v = 0.3, pan = 0 }) {
  if (!ctx) return;
  const at = now() + t;
  const s = ctx.createBufferSource();
  s.buffer = noise;
  s.playbackRate.value = 0.85 + Math.random() * 0.3;
  const fl = ctx.createBiquadFilter();
  fl.type = type;
  fl.frequency.setValueAtTime(f, at);
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, at + a + d);
  fl.Q.value = q;
  const g = ctx.createGain();
  env(g, at, a, v, d);
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  s.connect(fl).connect(g).connect(p).connect(out);
  s.start(at, Math.random() * 1.5);
  s.stop(at + a + d + 0.05);
}

function tone({ t = 0, f = 440, f2, type = 'sine', a = 0.003, d = 0.15, v = 0.2, pan = 0 }) {
  if (!ctx) return;
  const at = now() + t;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, at);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + a + d);
  const g = ctx.createGain();
  env(g, at, a, v, d);
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  o.connect(g).connect(p).connect(out);
  o.start(at);
  o.stop(at + a + d + 0.05);
}

function loop(type, f, q) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  s.loop = true;
  const fl = ctx.createBiquadFilter();
  fl.type = type;
  fl.frequency.value = f;
  fl.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = 0;
  s.connect(fl).connect(g).connect(out);
  s.start();
  return { s, fl, g };
}

export const audio = {
  init() {
    if (ctx) { ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    out = ctx.createGain();
    out.gain.value = 0.7;
    out.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    saw = loop('bandpass', 2400, 1.4);
    wind = loop('lowpass', 380, 0.6);
    // truck engine: a low saw-tooth hum plus rumble
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 42;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const og = ctx.createGain();
    og.gain.value = 0;
    o.connect(lp).connect(og).connect(out);
    o.start();
    eng = { o, g: og, rumble: loop('lowpass', 160, 0.8) };
    hyd = loop('bandpass', 260, 6);
    // your pickup: an old four-cylinder (two detuned waves through a muffler),
    // gravel under the tyres, and a squeal when they slide
    const co = ctx.createOscillator(), co2 = ctx.createOscillator();
    co.type = 'sawtooth';
    co2.type = 'square';
    const clp = ctx.createBiquadFilter();
    clp.type = 'lowpass';
    clp.Q.value = 2.5;
    const cg = ctx.createGain();
    cg.gain.value = 0;
    co.connect(clp);
    co2.connect(clp);
    clp.connect(cg).connect(out);
    co.start();
    co2.start();
    car = { o: co, o2: co2, lp: clp, g: cg, rumble: loop('lowpass', 200, 0.9), gravel: loop('bandpass', 520, 0.7), skid: loop('bandpass', 1150, 4) };
  },

  chop() {
    tone({ f: 150, f2: 70, type: 'triangle', d: 0.13, v: 0.5 });
    nz({ f: 1100, q: 0.9, d: 0.09, v: 0.55 });
    nz({ type: 'highpass', f: 3200, d: 0.03, v: 0.18 });
  },
  creak() {
    tone({ f: 85, f2: 62, type: 'sawtooth', a: 0.2, d: 1.3, v: 0.035 });
    tone({ t: 0.3, f: 120, f2: 70, type: 'sawtooth', a: 0.1, d: 0.9, v: 0.025 });
    nz({ f: 320, q: 3, a: 0.3, d: 1.2, v: 0.08 });
  },
  crash() {
    nz({ type: 'lowpass', f: 600, f2: 110, a: 0.01, d: 1.3, v: 0.8 });
    tone({ f: 62, f2: 34, type: 'triangle', d: 0.6, v: 0.6 });
    nz({ type: 'highpass', f: 3500, a: 0.02, d: 0.9, v: 0.12 });
  },
  nailHit(done) {
    tone({ f: done ? 1500 : 2300, type: 'sine', d: done ? 0.08 : 0.2, v: 0.12 });
    tone({ f: 3400, type: 'sine', d: 0.08, v: 0.05 });
    nz({ f: 1800, q: 1.2, d: 0.04, v: 0.25 });
    tone({ f: done ? 170 : 230, f2: 110, type: 'triangle', d: 0.07, v: done ? 0.35 : 0.2 });
  },
  woodKnock() {
    nz({ type: 'lowpass', f: 900, d: 0.1, v: 0.45 });
    tone({ f: 120, f2: 75, type: 'triangle', d: 0.12, v: 0.4 });
  },
  bend() {
    tone({ f: 1600, f2: 500, type: 'sawtooth', d: 0.18, v: 0.04 });
    tone({ f: 2100, type: 'sine', d: 0.25, v: 0.08 });
  },
  pull() {
    tone({ f: 260, f2: 900, type: 'square', a: 0.05, d: 0.25, v: 0.025 });
    nz({ f: 1200, q: 2, a: 0.05, d: 0.2, v: 0.12 });
  },
  tear() {
    nz({ f: 700, q: 1, d: 0.15, v: 0.5 });
    tone({ f: 300, f2: 120, type: 'sawtooth', d: 0.12, v: 0.05 });
  },
  swing() { nz({ f: 500, f2: 1500, q: 1.5, a: 0.05, d: 0.12, v: 0.05 }); },
  step() {
    nz({ type: 'lowpass', f: 480, d: 0.07, v: 0.05, pan: (Math.random() - 0.5) * 0.3 });
    nz({ type: 'highpass', f: 2600, d: 0.05, v: 0.018 });
  },
  pickup() { nz({ f: 700, q: 1, d: 0.06, v: 0.14 }); },
  drop(v = 1) {
    nz({ type: 'lowpass', f: 420, d: 0.14, v: 0.3 * v });
    tone({ f: 95, f2: 60, type: 'triangle', d: 0.1, v: 0.25 * v });
  },
  cutDone() {
    nz({ f: 900, q: 1, d: 0.1, v: 0.25 });
    this.drop(0.8);
  },
  nails() {
    for (let i = 0; i < 5; i++) tone({ t: i * 0.035, f: 2500 + Math.random() * 1500, d: 0.06, v: 0.05 });
  },

  engine(loud, speed) {
    if (!ctx) return;
    const t = now();
    eng.g.gain.setTargetAtTime(loud * 0.09, t, 0.15);
    eng.rumble.g.gain.setTargetAtTime(loud * 0.25, t, 0.15);
    eng.o.frequency.setTargetAtTime(38 + speed * 5.5, t, 0.3);
  },
  hydraulic(on) {
    if (!ctx) return;
    hyd.g.gain.setTargetAtTime(on ? 0.05 : 0, now(), 0.15);
  },
  brake() {
    nz({ type: 'highpass', f: 2500, a: 0.02, d: 0.7, v: 0.08 });
  },
  horn() {
    for (const t of [0, 0.32]) {
      tone({ t, f: 330, type: 'sawtooth', a: 0.01, d: 0.22, v: 0.05 });
      tone({ t, f: 415, type: 'sawtooth', a: 0.01, d: 0.22, v: 0.04 });
    }
  },

  // on: engine running, rpm 0..1, load 0..1 (how hard you press), speed m/s, slide 0..1
  carEngine(on, rpm, load, speed, slide) {
    if (!ctx) return;
    const t = now();
    const f = 30 + rpm * 78;
    car.o.frequency.setTargetAtTime(f, t, 0.06);
    car.o2.frequency.setTargetAtTime(f * 0.503, t, 0.06);
    car.lp.frequency.setTargetAtTime(260 + rpm * 900 + load * 500, t, 0.08);
    car.g.gain.setTargetAtTime(on ? 0.035 + load * 0.045 + rpm * 0.02 : 0, t, 0.08);
    car.rumble.g.gain.setTargetAtTime(on ? 0.05 + rpm * 0.1 : 0, t, 0.1);
    car.rumble.fl.frequency.setTargetAtTime(120 + rpm * 160, t, 0.1);
    car.gravel.g.gain.setTargetAtTime(Math.min(1, speed / 14) * 0.07, t, 0.1);
    car.skid.g.gain.setTargetAtTime(slide * 0.07, t, 0.05);
  },
  starter() {
    for (let i = 0; i < 6; i++) {
      nz({ t: i * 0.12, type: 'lowpass', f: 380, d: 0.08, v: 0.22 });
      tone({ t: i * 0.12, f: 90, f2: 60, type: 'triangle', d: 0.07, v: 0.12 });
    }
  },
  door(shut) {
    nz({ type: 'lowpass', f: shut ? 520 : 900, d: shut ? 0.16 : 0.08, v: shut ? 0.5 : 0.2 });
    tone({ f: shut ? 130 : 220, f2: 70, type: 'triangle', d: 0.1, v: shut ? 0.35 : 0.12 });
    nz({ t: 0.02, type: 'highpass', f: 3000, d: 0.03, v: 0.08 });
  },
  carHorn() {
    for (const t of [0, 0.26]) {
      tone({ t, f: 392, type: 'square', a: 0.01, d: 0.18, v: 0.035 });
      tone({ t, f: 494, type: 'square', a: 0.01, d: 0.18, v: 0.03 });
    }
  },
  // bricks: the trowel scrapes mortar, the brick settles into it
  lay() {
    nz({ f: 2200, f2: 900, q: 1.4, a: 0.02, d: 0.16, v: 0.1 });
    nz({ t: 0.12, type: 'lowpass', f: 650, d: 0.07, v: 0.28 });
    tone({ t: 0.12, f: 190, f2: 120, type: 'triangle', d: 0.06, v: 0.16 });
    tone({ t: 0.2, f: 1400, type: 'sine', d: 0.04, v: 0.03 }); // the trowel tapping it down
  },
  brick() {
    tone({ f: 950, f2: 620, type: 'triangle', d: 0.05, v: 0.14 });
    nz({ type: 'highpass', f: 2600, d: 0.03, v: 0.12 });
    tone({ t: 0.06, f: 820, f2: 560, type: 'triangle', d: 0.04, v: 0.1 });
  },
  bag() {
    nz({ type: 'lowpass', f: 700, d: 0.28, v: 0.3 });
    nz({ f: 3000, q: 0.5, a: 0.05, d: 0.25, v: 0.05 });
    nz({ t: 0.3, type: 'lowpass', f: 400, a: 0.1, d: 0.5, v: 0.12 }); // stirring
  },
  stoneHit() {
    tone({ f: 1300, f2: 700, type: 'triangle', d: 0.05, v: 0.22 });
    nz({ type: 'highpass', f: 3000, d: 0.05, v: 0.18 });
    nz({ type: 'lowpass', f: 500, d: 0.08, v: 0.2 });
  },
  coins() {
    [0, 0.07, 0.13, 0.22, 0.3].forEach((t, i) => tone({ t, f: 1900 + i * 260 + Math.random() * 120, type: 'triangle', d: 0.12, v: 0.06 }));
    tone({ t: 0.36, f: 2650, type: 'sine', d: 0.4, v: 0.05 });
  },
  click() { tone({ f: 1900, d: 0.02, v: 0.04 }); tone({ t: 0.05, f: 1500, d: 0.02, v: 0.03 }); },
  thud(v = 1) {
    nz({ type: 'lowpass', f: 300, d: 0.25, v: 0.45 * v });
    tone({ f: 70, f2: 40, type: 'triangle', d: 0.2, v: 0.4 * v });
  },
  phone() {
    tone({ f: 1320, d: 0.06, v: 0.04 });
    tone({ t: 0.07, f: 1760, d: 0.08, v: 0.04 });
  },
  tap() { tone({ f: 900, d: 0.03, v: 0.025 }); },

  // phase = saw stroke phase, on = sawing right now
  sawing(on, phase) {
    if (!ctx) return;
    const t = now();
    const s = Math.abs(Math.sin(phase));
    saw.g.gain.setTargetAtTime(on ? 0.05 + 0.13 * s : 0, t, 0.03);
    saw.fl.frequency.setTargetAtTime(1900 + 1200 * Math.sin(phase), t, 0.03);
  },

  update(dt, daylight) {
    if (!ctx) return;
    const t = now();
    wind.g.gain.setTargetAtTime(0.022 + 0.014 * Math.sin(t * 0.23) + 0.008 * Math.sin(t * 0.71), t, 0.5);
    wind.fl.frequency.setTargetAtTime(330 + 90 * Math.sin(t * 0.17), t, 0.5);
    birdTimer -= dt;
    if (birdTimer <= 0) {
      birdTimer = 2.5 + Math.random() * 7;
      if (daylight > 0.4) this.bird();
    }
    cricketTimer -= dt;
    if (cricketTimer <= 0) {
      cricketTimer = 0.6 + Math.random() * 1.5;
      if (daylight < 0.25) {
        const pan = (Math.random() - 0.5) * 1.6;
        for (let i = 0; i < 3; i++) tone({ t: i * 0.06, f: 4300, type: 'square', d: 0.03, v: 0.006, pan });
      }
    }
  },
  bird() {
    const pan = (Math.random() - 0.5) * 1.6, base = 2600 + Math.random() * 1800, n = 2 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      tone({ t: i * 0.11, f: base * (0.9 + Math.random() * 0.25), f2: base * (1.15 + Math.random() * 0.3), d: 0.07, v: 0.03, pan });
    }
  },
};
