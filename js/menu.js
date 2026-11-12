// The menu (Esc): play / continue, new game, save and load. Also the autosave.
// A game loads into a freshly built world: before you start playing it loads right there;
// once a game is going, the page reloads and the new one loads while the forest grows.
import { game } from './game.js';
import { collect, summary, thumbnail, apply, migrate, newGameId } from './save.js';
import { MODES, VILLAGE_NAMES } from './modes.js';
import { listSaves, writeSave, readSave, deleteSave } from './saveStore.js';
import { audio } from './audio.js';

const AUTO_EVERY = 180;  // seconds of play between autosaves
const SLOTS = ['1', '2', '3'];
const BOOT = 'handmade-boot'; // sessionStorage: what to do after a reload ({ load: slot } or { fresh: true })

const $ = (id) => document.getElementById(id);
const el = {};
let opts = null;
let mode = 'main';      // 'main' | 'save' | 'load'
let saves = [];         // summaries, newest first
let lastSave = 0;       // performance.now() of the last save
let autoT = 0;
let busy = false;
let bootErr = '';       // shown once on the menu, if a load after a reload went wrong

// ───────── saving ─────────

async function saveTo(slot, quiet) {
  if (busy) return false;
  busy = true;
  try {
    // the autosave belongs to another game (you started a new one, or loaded a different one):
    // keep that one as the older autosave instead of saving over it
    if (slot === 'auto') {
      const old = (await listSaves()).find((s) => s.slot === 'auto');
      if (old && old.game !== game.id) {
        const oldData = await readSave('auto');
        if (oldData) await writeSave('auto2', old, oldData);
      }
    }
    const data = collect();
    await writeSave(slot, summary(data, thumbnail()), data);
    lastSave = performance.now();
    autoT = 0;
    flashSaved(slot === 'auto' ? 'Autosaved' : `Saved to slot ${slot}`);
    return true;
  } catch (e) {
    console.error(e);
    if (!quiet) note(`Couldn't save: ${e.message}`, true);
    return false;
  } finally { busy = false; }
}

let flashTimer = 0;
function flashSaved(text) {
  const s = $('saved');
  s.textContent = text;
  s.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => s.classList.remove('show'), 1800);
}

// Every few minutes of play, when you pause (Esc), and when the tab is hidden or closed.
export function updateAutosave(dt, active) {
  if (!game.started || !active) return;
  game.playTime += dt;
  autoT += dt;
  if (autoT >= AUTO_EVERY) { autoT = 0; saveTo('auto', true); }
}
function autosaveNow(minGap) {
  if (game.started && performance.now() - lastSave > minGap * 1000) saveTo('auto', true);
}

// ───────── loading ─────────

// Load a slot: here and now if nothing has started yet, otherwise through a reload.
async function loadSlot(slot) {
  if (game.started) {
    sessionStorage.setItem(BOOT, JSON.stringify({ load: slot }));
    location.reload();
    return;
  }
  const data = await readSave(slot);
  if (!data) { note('That save is empty.', true); return; }
  try {
    apply(data);
    game.started = true;
    lastSave = performance.now();
    if (slot === 'import') await deleteSave('import').catch(() => {});
    show('main');
    resume();
  } catch (e) {
    console.error(e);
    note(`Couldn't load it: ${e.message}`, true);
  }
}

async function newGame(modeId, name) {
  if (game.started) {
    sessionStorage.setItem(BOOT, JSON.stringify({ fresh: true, mode: modeId, name }));
    location.reload();
    return;
  }
  // a village that's already there takes a moment to build: show it
  const loading = $('loading');
  if (MODES[modeId]?.built) {
    loading.querySelector('span').textContent = `Building ${name || 'the village'}…`;
    loading.classList.remove('hide');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  opts.startNew(modeId, name);
  game.id = newGameId();
  game.started = true;
  lastSave = performance.now(); // (nothing worth an autosave yet)
  loading.classList.add('hide');
  show('main');
  resume();
}

function resume() {
  audio.init();
  game.relock();
}

// Right after the page loads: a reload asked to load something (or start fresh), or show the menu.
export async function boot(o) {
  opts = o;
  bind();
  let flag = null;
  try { flag = JSON.parse(sessionStorage.getItem(BOOT) || 'null'); } catch { /* none */ }
  sessionStorage.removeItem(BOOT);
  saves = await listSaves().catch(() => []);
  if (flag?.load) {
    $('loading').querySelector('span').textContent = 'Loading your game…';
    try {
      const data = await readSave(flag.load);
      apply(data);
      game.started = true;
      lastSave = performance.now();
      if (flag.load === 'import') await deleteSave('import').catch(() => {});
    } catch (e) {
      console.error(e);
      bootErr = `Couldn't load that game: ${e.message}`;
    }
  } else if (flag?.fresh) {
    if (MODES[flag.mode]?.built) $('loading').querySelector('span').textContent = `Building ${flag.name || 'the village'}…`;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    opts.startNew(flag.mode ?? 'forest', flag.name);
    game.id = newGameId();
    game.started = true;
    lastSave = performance.now();
  }
  saves = await listSaves().catch(() => []);
  show('main');
}

// ───────── the menu ─────────

function bind() {
  Object.assign(el, { main: $('mMain'), saves: $('mSaves'), news: $('mNew'), list: $('mList'), title: $('mTitle'), note: $('mNote'), where: $('mWhere'), play: $('play'), confirm: $('mConfirm'), importLbl: $('mImport'), name: $('mName'), modes: $('mModes') });
  el.play.addEventListener('click', () => {
    if (game.started) return resume();
    const latest = saves.find((s) => s.slot !== 'import');
    if (latest) loadSlot(latest.slot);
    else show('new');
  });
  el.modes.innerHTML = Object.entries(MODES).map(([id, M]) => `<button class="mode" data-mode="${id}">
    <b>${M.name}${M.challenge ? '<em>challenge</em>' : ''}</b><p>${M.blurb}</p>
    <span class="chips">${M.chips.map((c) => `<span>${c}</span>`).join('')}</span></button>`).join('');
  el.modes.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) pickMode(b.dataset.mode); });
  $('mStart').addEventListener('click', () => {
    const name = el.name.value.trim() || 'Borovice';
    if (game.started) ask(`Start a new game (${MODES[chosen].name}, ${esc(name)})? Anything you did since your last save is lost.`, 'Start', () => newGame(chosen, name));
    else newGame(chosen, name);
  });
  $('menu').addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m === 'new') show('new');
    else if (m === 'dice') el.name.value = randomName(el.name.value);
    else if (m === 'save') show('save');
    else if (m === 'load') show('load');
    else if (m === 'back') show('main');
    const act = e.target.closest('[data-act]');
    if (act) onSlot(act.dataset.act, act.dataset.slot);
  });
  el.importLbl.querySelector('input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || game.playing || game.phoneOpen) return;
    if (!el.confirm.classList.contains('hide')) el.confirm.classList.add('hide');
    else if (mode !== 'main') show('main');
  });
  // a tab you leave, or close: save what you have
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosaveNow(3); });
  addEventListener('pagehide', () => autosaveNow(3));
}

// The menu came up (Esc, or the browser let go of the mouse): a good moment for an autosave.
export function onPause() {
  autosaveNow(20);
  show('main');
}

let chosen = 'forest';
function pickMode(id) {
  chosen = id;
  for (const b of el.modes.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === id);
}
const randomName = (not) => { const n = VILLAGE_NAMES.filter((x) => x !== not); return n[Math.floor(Math.random() * n.length)]; };

async function show(m) {
  if (!el.main) return; // (the menu isn't set up yet)
  mode = m;
  el.confirm.classList.add('hide');
  el.main.classList.toggle('hide', m !== 'main');
  el.saves.classList.toggle('hide', m !== 'save' && m !== 'load');
  el.news.classList.toggle('hide', m !== 'new');
  if (m === 'new') {
    if (!el.name.value) el.name.value = 'Borovice';
    pickMode(chosen);
    return;
  }
  if (m === 'main') {
    const latest = saves.find((s) => s.slot !== 'import');
    el.play.textContent = game.started ? 'Resume' : latest ? 'Continue' : 'Play';
    el.where.textContent = bootErr || (game.started ? '' : latest ? `${latest.village} · day ${latest.day} · ${latest.clock} · saved ${when(latest.savedAt)}` : '');
    el.where.style.color = bootErr ? 'var(--danger)' : '';
    bootErr = '';
    el.main.querySelector('[data-m="save"]').disabled = !game.started;
    el.main.querySelector('[data-m="load"]').disabled = !saves.length;
    return;
  }
  el.title.textContent = m === 'save' ? 'Save game' : 'Load game';
  el.importLbl.classList.toggle('hide', m !== 'load');
  note('');
  saves = await listSaves().catch(() => []);
  renderList();
}

function renderList() {
  const by = Object.fromEntries(saves.map((s) => [s.slot, s]));
  const rows = mode === 'save' ? SLOTS : ['auto', ...(by.auto2 ? ['auto2'] : []), ...SLOTS, ...(by.import ? ['import'] : [])];
  el.list.innerHTML = rows.map((slot) => row(slot, by[slot])).join('');
}

const NAMES = { auto: 'Autosave', auto2: 'Older autosave', import: 'Opened file' };
function row(slot, s) {
  const name = NAMES[slot] ?? `Slot ${slot}`;
  if (!s) {
    const what = slot === 'auto' ? 'Saves by itself every few minutes, and when you pause or leave.' : 'Empty';
    return `<div class="slot-row empty"><div class="pic">${slot === 'auto' ? '⟳' : '—'}</div><div>
      <div class="name">${name}</div><div class="what">${what}</div>
      <div class="acts">${mode === 'save' && slot !== 'auto' ? `<button class="go" data-act="save" data-slot="${slot}">Save here</button>` : ''}</div></div></div>`;
  }
  const people = s.founded ? ` · ${s.houses} ${s.houses === 1 ? 'house' : 'houses'} · ${s.people} people` : '';
  const acts = mode === 'save'
    ? `<button class="go" data-act="save" data-slot="${slot}">Save here</button>`
    : `<button class="go" data-act="load" data-slot="${slot}">Load</button><button class="ghost" data-act="export" data-slot="${slot}">Export</button><button class="ghost" data-act="delete" data-slot="${slot}">Delete</button>`;
  return `<div class="slot-row"><div class="pic" style="${s.thumb ? `background-image:url(${s.thumb})` : ''}">${s.thumb ? '' : 'no picture'}</div><div>
    <div class="name">${name}<i>${when(s.savedAt)}</i></div>
    <div class="what">${esc(s.village)}${s.mode && s.mode !== 'forest' ? ` (${MODES[s.mode]?.name ?? s.mode})` : ''} · day ${s.day} · ${s.clock} · ${s.mode === 'creative' ? '$∞' : `$${s.money.toLocaleString('en-US')}`}${people}<br>${s.bricks.toLocaleString('en-US')} bricks laid · ${s.crew ? `${s.crew} in the crew · ` : ''}played ${played(s.playTime)}</div>
    <div class="acts">${acts}</div></div></div>`;
}

async function onSlot(act, slot) {
  const s = saves.find((x) => x.slot === slot);
  if (act === 'save') {
    const go = async () => { if (await saveTo(slot)) { saves = await listSaves(); renderList(); note(`Saved to slot ${slot}.`); } };
    if (s) ask(`Save over slot ${slot}? (${esc(s.village)} · day ${s.day}, saved ${when(s.savedAt)})`, 'Save over it', go);
    else go();
  } else if (act === 'load') {
    if (game.started) ask('Load this game? Anything you did since your last save is lost.', 'Load', () => loadSlot(slot));
    else loadSlot(slot);
  } else if (act === 'export') {
    exportSlot(slot, s);
  } else if (act === 'delete') {
    ask(`Delete ${NAMES[slot] ?? `slot ${slot}`}? It can't be brought back.`, 'Delete', async () => { await deleteSave(slot); saves = await listSaves(); renderList(); note('Deleted.'); });
  }
}

// A save as a file: to keep it safe, or to give your town to someone.
async function exportSlot(slot, s) {
  const data = await readSave(slot);
  if (!data) return;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Handmade - ${s.village} - day ${s.day}.json`.replace(/[\\/:*?"<>|]/g, '');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  note(`Exported ${(blob.size / 1024).toFixed(0)} KB.`);
}

async function importFile(file) {
  try {
    const data = migrate(JSON.parse(await file.text()));
    await writeSave('import', summary(data, null), data);
    saves = await listSaves();
    renderList();
    note(`Opened "${esc(file.name)}". Load it from the list.`);
  } catch (e) {
    note(e instanceof SyntaxError ? 'That file is not a save (it isn\'t readable).' : e.message, true);
  }
}

function ask(text, yes, then) {
  el.confirm.querySelector('p').innerHTML = text;
  const b = el.confirm.querySelector('[data-c="yes"]');
  b.textContent = yes;
  el.confirm.classList.remove('hide');
  el.confirm.onclick = (e) => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (!c) return;
    el.confirm.classList.add('hide');
    if (c === 'yes') then();
  };
}

function note(text, bad = false) {
  if (!el.note) return;
  el.note.textContent = text;
  el.note.classList.toggle('bad', bad);
}

function when(t) {
  const d = new Date(t), now = new Date();
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days === 0) return `today ${hm}`;
  if (days === 1) return `yesterday ${hm}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hm}`;
}
function played(s = 0) {
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
