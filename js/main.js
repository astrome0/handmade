import * as THREE from 'three';
import { game } from './game.js';
import { world, stepPhysics, CANNON } from './physics.js';
import { initTextures } from './textures.js';
import { buildWorld, updateWorld, trees } from './world.js';
import { terrainHeight } from './terrain.js';
import { DayCycle } from './sky.js';
import { initItems, pieces, Piece } from './items.js';
import { initNails, joints, allNails, wakeLinked } from './nails.js';
import { Player } from './player.js';
import { Tools, SLOTS } from './tools.js';
import { Viewmodel } from './viewmodel.js';
import { Hud } from './hud.js';
import { audio } from './audio.js';
import { particles } from './particles.js';
import { phone } from './phone.js';
import { initDelivery, updateDelivery, placeOrder, orders, CATALOG, deliveryDebug } from './delivery.js';
import { car } from './car.js';
import { initMasonry, updateMasonry, showGhost, masonryDebug } from './masonry.js';
import { boot, onPause, updateAutosave } from './menu.js';
import { collect, apply } from './save.js';
import { startMode, updateMode, modesDebug } from './modes.js';
import { updateWorkers, crew, hire, houses } from './workers.js';
import { updateVillage, village, PLANS } from './village.js';
import { money, updateMoney, onMoneyChange } from './money.js';
import { updateRope } from './rope.js';
import { initYard, updateYard, offer as yardOffer, ZONE } from './yard.js';
import { lumber, updateAreaPick, lumberDebug } from './lumberjack.js';
import { updatePaint, paintDebug, pick as paintPick, updateHousePick } from './paint.js';
import { updateStreets, streetsDebug } from './streets.js';
import './roadworker.js';
import { flashlight } from './flashlight.js';
import { initTouch } from './touch.js';
import { MOBILE } from './device.js';

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
// a phone has a sharp screen but a weak GPU: about one pixel per CSS pixel, and adaptResolution may go lower
const MAX_PR = MOBILE ? 1 : Math.min(devicePixelRatio, 1.5), MIN_PR = MOBILE ? 0.65 : 0.6;
let pixelRatio = MOBILE ? 0.9 : Math.min(devicePixelRatio, 1.25);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = MOBILE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true; // (paint.js: a coat shows only as far as it's on)

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 6000);
scene.add(camera);
Object.assign(game, { scene, camera, renderer });

initTextures(renderer);
initItems();
initNails();
particles.init(scene);
buildWorld(scene);
game.day = new DayCycle(scene, renderer);
game.player = new Player(camera);
game.hud = new Hud(SLOTS);
initMasonry();
initYard(scene);
game.hud.money(money.balance);
onMoneyChange((d) => game.hud.money(money.balance, d));
game.vm = new Viewmodel();
game.tools = new Tools();
initDelivery();
car.init();
phone.init();
world.addEventListener('preStep', wakeLinked);

// ───────── input ─────────
const inp = game.input;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  inp.keys.add(e.code);
  inp.pressed.add(e.code);
  if (['Space', 'Tab'].includes(e.code) && (game.playing || game.phoneOpen)) e.preventDefault();
  // the phone: P or Tab takes it out and puts it away, Esc puts it away
  if (e.code === 'KeyP' || e.code === 'Tab') {
    if (phone.open) phone.hide();
    else if (game.playing || game.forcePlay) phone.show();
  } else if (e.code === 'Escape' && phone.open) { phone.hide(false); showMenu(); }
});
addEventListener('keyup', (e) => inp.keys.delete(e.code));
addEventListener('blur', () => { inp.keys.clear(); inp.lmb = inp.rmb = false; });
addEventListener('mousedown', (e) => {
  if (!game.playing) return;
  if (e.button === 0) { inp.lmb = true; inp.lmbDown = true; }
  if (e.button === 2) { inp.rmb = true; inp.rmbDown = true; }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) inp.lmb = false;
  if (e.button === 2) inp.rmb = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => {
  if (!game.playing || !e.deltaY) return;
  const t = game.tools;
  t.select((t.slot + (e.deltaY > 0 ? 1 : -1) + SLOTS.length) % SLOTS.length);
}, { passive: true });

initTouch(); // sets game.touch on phones and tablets (a no-op with a mouse)

// ───────── menu / pointer lock ─────────
const menu = document.getElementById('menu');
const hud = document.getElementById('hud');
// Grab the mouse (Play / Resume, or after the phone is put away). If the browser says
// no (it needs a click), show the menu so one click resumes.
game.relock = () => {
  if (game.touch) { game.touch.enter(); setPlaying(true); return; } // phone/tablet: no mouse to grab
  const p = canvas.requestPointerLock();
  if (p && p.catch) p.catch(() => showMenu());
};
const showMenu = () => {
  if (game.playing || game.phoneOpen) return;
  menu.classList.remove('hide');
  onPause();
};
function setPlaying(on) {
  game.playing = on;
  if (game.playing && phone.open && !game.touch) phone.hide(false);
  if (game.playing && !game.tipShown) {
    game.tipShown = true;
    setTimeout(() => game.hud.toast(game.touch ? 'Tip: tap the phone button to order logs' : 'Tip: press P to take out your phone and order logs'), 4000);
  }
  menu.classList.toggle('hide', game.playing || game.phoneOpen);
  hud.classList.toggle('hide', !game.playing && !game.forcePlay);
  if (!game.playing) { inp.lmb = inp.rmb = false; inp.keys.clear(); }
  if (!game.playing && !game.phoneOpen) onPause();
}
game.setPlaying = setPlaying;
document.addEventListener('pointerlockerror', showMenu);
document.addEventListener('pointerlockchange', () => {
  if (game.touch) return; // (touch play has no pointer lock)
  setPlaying(document.pointerLockElement === canvas);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  game.vm.resize();
});

// ───────── loop ─────────
const clock = new THREE.Clock();
const fpsEl = document.getElementById('fps');
let showFps = /[?&]fps=1/.test(location.search); // (F3, or ?fps=1 on a phone)
fpsEl.classList.toggle('hide', !showFps);
addEventListener('keydown', (e) => {
  if (e.code !== 'F3') return;
  e.preventDefault();
  showFps = !showFps;
  fpsEl.classList.toggle('hide', !showFps);
});
let fpsTime = 0, fpsFrames = 0;

let jsMs = 0, shadowFrame = 0;
if (MOBILE) renderer.shadowMap.autoUpdate = false; // a phone redraws the sun's shadows only every 3rd frame (see below)
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const t0 = performance.now();
  if (MOBILE) renderer.shadowMap.needsUpdate = shadowFrame++ % 3 === 0;
  tick(dt);
  jsMs += (performance.now() - t0 - jsMs) * 0.1;
}

function tick(dt) {
  // the world keeps going while you look at your phone
  const active = game.playing || game.forcePlay || game.phoneOpen;
  const hands = active && !game.phoneOpen && !game.driving;
  game.uTime.value += dt;
  if (active) {
    if (!game.driving) game.player.update(dt);
    car.update(dt);
    stepPhysics(dt);
  }
  for (const p of pieces) p.sync();
  car.sync(dt);
  updateRope();
  if (!game.driving) game.player.afterPhysics(dt);
  if (hands && lumber.picking) updateAreaPick();
  else if (hands && paintPick.painter) { showGhost(null); updateHousePick(); }
  else if (hands && !village.planning) game.tools.update(dt);
  else {
    showGhost(null);
    if (!active && !game.started) game.player.yaw += dt * 0.03; // slow look-around behind the title menu
  }
  updateMasonry(active ? dt : 0);
  if (active) updateDelivery(dt);
  if (active) updateWorkers(dt * (game.mode?.workSpeed ?? 1)); // (creative: a faster crew)
  if (active) updateMode(dt);
  if (active) updateVillage(dt, hands);
  updatePaint(active ? dt : 0);
  updateStreets(active ? dt : 0, active, hands);
  if (active) updateMoney(crew, houses);
  updateAutosave(dt, active);
  updateYard(dt);
  updateWorld(dt, camera.position);
  game.day.update(active ? dt : 0, game.player.body.position);
  particles.update(dt);
  flashlight.update(dt, active);
  game.vm.update(dt);
  audio.update(dt, game.day.daylight);
  game.hud.clock(`Day ${game.day.day} · ${game.day.clock}`);

  renderer.render(scene, camera);
  if (active && !game.driving) game.vm.render(renderer);
  if (showFps) fpsEl.textContent = `${Math.round(game.fps || 0)} fps · ${pixelRatio.toFixed(2)}x · js ${jsMs.toFixed(0)} ms`; // (js ms near the frame time = the processor is the limit, far below = the graphics chip)

  inp.pressed.clear();
  inp.lmbDown = inp.rmbDown = false;
  adaptResolution(dt);
}

// Keep it smooth on weak graphics: lower the resolution a bit if fps drops.
function adaptResolution(dt) {
  fpsTime += dt;
  fpsFrames++;
  if (fpsTime < 2) return;
  const fps = fpsFrames / fpsTime;
  fpsTime = 0;
  fpsFrames = 0;
  game.fps = fps;
  let pr = pixelRatio;
  if (fps < (MOBILE ? 45 : 40) && pr > MIN_PR) pr = Math.max(MIN_PR, pr - 0.15);
  else if (fps > 58 && pr < MAX_PR) pr = Math.min(MAX_PR, pr + 0.1);
  if (pr !== pixelRatio) { pixelRatio = pr; renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); }
}

frame();
// a new game, a game to load (after a reload), or the menu with Continue
boot({ startNew: startMode }).finally(() => {
  document.getElementById('loading').classList.add('hide');
  if (!game.playing) menu.classList.remove('hide');
});

// Handy for testing from the console.
window.HM = { game, world, CANNON, Piece, pieces, joints, allNails, trees, terrainHeight, tick, renderer, placeOrder, orders, CATALOG, deliveryDebug, car, masonry: masonryDebug, crew, hire, houses, village, PLANS, money, yardOffer, ZONE, collect, apply, modes: modesDebug, lumber: lumberDebug, paint: paintDebug, streets: streetsDebug, flashlight };
