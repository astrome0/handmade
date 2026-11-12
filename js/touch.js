// Touch controls for phones and tablets. The game reads the keyboard and the mouse
// (game.input.keys / pressed / lmb / rmb), so this layer only presses those for you:
//   left half of the screen  = a floating stick (walk / drive; push all the way = sprint)
//   right half of the screen = drag to look around
//   buttons                  = the keys and mouse buttons that don't exist on a phone
// With a mouse nothing here runs. To try it on a computer, open the page with ?touch=1.
import { game } from './game.js';
import { phone } from './phone.js';
import { svg } from './icons.js';
import { initLayout } from './layout.js';

const STICK_R = 56;        // px the stick travels
const LOOK_SPEED = 1.5;    // finger px → mouse px
const DEAD = 0.28;         // stick dead zone (fraction of the travel)

export function initTouch() {
  const coarse = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
  if (!coarse && !/[?&]touch=1/.test(location.search)) return;

  const inp = game.input;
  document.body.classList.add('touch');
  game.touch = { enter };

  // ───────── building the controls ─────────
  const root = el('div', { id: 'touch', class: 'hide' });
  const stickZone = el('div', { class: 'tzone left' });
  const lookZone = el('div', { class: 'tzone right' });
  const base = el('div', { class: 'tbase hide' });
  const knob = el('div', { class: 'tknob' });
  base.append(knob);
  root.append(stickZone, lookZone, base);
  const layout = initLayout(root, 'handmade-touch-layout');

  const press = (code) => { inp.keys.add(code); inp.pressed.add(code); };
  const release = (code) => inp.keys.delete(code);

  // a button: down/up callbacks, optional toggle
  const button = (label, cls, down, up, title = '') => {
    const b = el('button', { class: `tbtn ${cls}`, type: 'button', 'aria-label': title || label });
    b.innerHTML = label[0] === '@' ? svg(label.slice(1)) : label;
    b.dataset.id = cls.split(' ').pop();
    // the big buttons sit right under the right thumb: dragging from them turns the view too (like mobile shooters)
    const aim = cls.split(' ').includes('big');
    let ax = 0, ay = 0;
    const downFn = (e) => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      ax = e.clientX; ay = e.clientY;
      if (layout.editing) { layout.grab(b, e); return; }
      b.classList.add('on');
      down?.();
    };
    const upFn = (e) => {
      e.preventDefault();
      if (layout.editing) { layout.release(); return; }
      b.classList.remove('on');
      up?.();
    };
    b.addEventListener('pointermove', (e) => {
      if (layout.editing) { layout.move(b, e); return; }
      if (aim && b.classList.contains('on') && game.playing && !game.phoneOpen) game.player.look((e.clientX - ax) * LOOK_SPEED * layout.sens, (e.clientY - ay) * LOOK_SPEED * layout.sens);
      ax = e.clientX; ay = e.clientY;
    });
    b.addEventListener('pointerdown', downFn);
    b.addEventListener('pointerup', upFn);
    b.addEventListener('pointercancel', upFn);
    root.append(b);
    return b;
  };
  const tap = (label, cls, code, title) => button(label, cls, () => press(code), () => release(code), title);

  // bottom right: the things your hands do
  button('<b>USE</b>', 'big use', () => { inp.lmb = true; inp.lmbDown = true; }, () => { inp.lmb = false; }, 'Use the tool (left click)');
  button('<b>ALT</b>', 'big alt', () => { inp.rmb = true; inp.rmbDown = true; }, () => { inp.rmb = false; }, 'Saw / pull nail (right click)');
  tap('<b>JUMP</b>', 'big jump', 'Space', 'Jump');
  tap('<b>GRAB</b>', 'big grab', 'KeyE', 'Pick up / drop / get in the pickup');

  // top right: smaller helpers
  button('@phone', 'small phone', () => { if (phone.open) phone.hide(); else phone.show(); }, null, 'Phone');
  tap('@bulb', 'small light', 'KeyL', 'Flashlight');
  tap('@turn', 'small turn', 'KeyR', 'Turn what you hold');
  const sneak = button('@sneak', 'small sneak', () => {
    sneak.classList.toggle('lock');
    if (sneak.classList.contains('lock')) inp.keys.add('ShiftLeft'); else inp.keys.delete('ShiftLeft');
  }, null, 'Sneak (stays on until tapped again)');
  const view = tap('@eye', 'small view', 'KeyV', 'Change the view in the pickup');
  const fly = tap('@fly', 'small fly', 'KeyF', 'Fly (creative)');
  button('@pause', 'small pause', () => game.setPlaying(false), null, 'Pause / menu');

  document.body.append(root);
  layout.refresh();

  // "Move buttons" in the pause menu
  const menuEl = document.getElementById('menu');
  const mrow = document.querySelector('#mMain .mrow');
  if (menuEl && mrow) {
    const mb = el('button', { class: 'ghost', type: 'button' });
    mb.textContent = 'Buttons & look speed';
    mb.addEventListener('click', () => { menuEl.classList.add('hide'); layout.start(); });
    layout.onExit = () => menuEl.classList.remove('hide');
    mrow.after(mb);
    mb.style.margin = '10px auto 0';
  }

  // the hotbar becomes tappable
  const bar = document.getElementById('hotbar');
  bar?.addEventListener('pointerdown', (e) => {
    const slot = e.target.closest('#hotbar > *');
    const i = slot ? [...bar.children].indexOf(slot) : -1;
    if (i >= 0) { game.tools.select(i); e.preventDefault(); }
  });

  // the hint line speaks in buttons, not keys
  const hint = document.getElementById('hint');
  const words = { E: 'GRAB', R: 'TURN', L: 'LIGHT', P: 'PHONE', Space: 'JUMP', V: 'VIEW', F: 'FLY', Click: 'USE', 'Right click': 'ALT', 'Left click': 'USE' };
  if (hint) {
    new MutationObserver(() => {
      for (const k of hint.querySelectorAll('kbd')) {
        const w = words[k.textContent.trim()];
        if (w) k.textContent = w;
      }
    }).observe(hint, { childList: true, subtree: true });
  }

  // ───────── the stick ─────────
  let stickId = null, sx = 0, sy = 0;
  const setStick = (dx, dy) => {
    const len = Math.hypot(dx, dy);
    const k = len > STICK_R ? STICK_R / len : 1;
    dx *= k; dy *= k;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / STICK_R, ny = dy / STICK_R;
    toggle('KeyW', ny < -DEAD);
    toggle('KeyS', ny > DEAD);
    toggle('KeyA', nx < -DEAD);
    toggle('KeyD', nx > DEAD);
    toggle('ControlLeft', Math.hypot(nx, ny) > 0.97 && ny < -0.6); // pushed all the way forward = sprint
  };
  const toggle = (code, on) => { if (on) inp.keys.add(code); else inp.keys.delete(code); };
  const stopStick = () => {
    stickId = null;
    base.classList.add('hide');
    for (const c of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ControlLeft']) inp.keys.delete(c);
  };
  stickZone.addEventListener('pointerdown', (e) => {
    if (stickId !== null) stopStick(); // a lost pointerup must never lock the stick
    e.preventDefault();
    try { stickZone.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    stickId = e.pointerId; sx = e.clientX; sy = e.clientY;
    base.style.left = `${sx}px`; base.style.top = `${sy}px`;
    knob.style.transform = '';
    base.classList.remove('hide');
  });
  stickZone.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) setStick(e.clientX - sx, e.clientY - sy); });
  const endStick = (e) => { if (e.pointerId === stickId) stopStick(); };
  stickZone.addEventListener('pointerup', endStick);
  stickZone.addEventListener('pointercancel', endStick);

  // ───────── looking around ─────────
  let lookId = null, lx = 0, ly = 0;
  lookZone.addEventListener('pointerdown', (e) => {
    lookId = null; // a new finger takes over (never stay stuck on an old one)
    e.preventDefault();
    try { lookZone.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    lookId = e.pointerId; lx = e.clientX; ly = e.clientY;
  });
  lookZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    if (game.playing && !game.phoneOpen) game.player.look((e.clientX - lx) * LOOK_SPEED * layout.sens, (e.clientY - ly) * LOOK_SPEED * layout.sens);
    lx = e.clientX; ly = e.clientY;
  });
  const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
  lookZone.addEventListener('pointerup', endLook);
  lookZone.addEventListener('pointercancel', endLook);
// also when the finger lifts outside the zone or the browser loses the event (iOS does that)
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) addEventListener(t, (e) => { endStick(e); endLook(e); });

  // ───────── showing and hiding ─────────
  let wasShown = false;
  setInterval(() => {
    const shown = layout.editing || (!!game.playing && !game.phoneOpen);
    root.classList.toggle('hide', !shown);
    // the phone button must stay reachable while the phone is out (to put it away)
    document.body.classList.toggle('phone-out', !!game.phoneOpen);
    if (wasShown && !shown) { stopStick(); lookId = null; }
    wasShown = shown;
    view.classList.toggle('hide', !game.driving && !layout.editing);
    fly.classList.toggle('hide', !(game.mode?.fly && !game.driving) && !layout.editing);
    if (!game.playing) { sneak.classList.remove('lock'); }
  }, 120);

  // pinch / double-tap zoom and page scrolling would fight the game
  for (const t of ['gesturestart', 'gesturechange']) addEventListener(t, (e) => e.preventDefault());
  // (no document-wide touchmove listener: a non-passive one makes Safari wait for each frame before it hands over the finger's movement;
  //  touch-action: none on the controls already stops scrolling and zooming there)

  function enter() {
    // best effort: full screen and sideways (needs the tap that pressed Play)
    const d = document.documentElement;
    try { if (!document.fullscreenElement) d.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {}); } catch { /* not allowed */ }
    try { screen.orientation?.lock?.('landscape')?.catch(() => {}); } catch { /* not allowed */ }
  }
}

function el(tag, attrs = {}) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
