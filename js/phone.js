// Your phone (P or Tab): a shop for raw materials and order tracking.
import { game } from './game.js';
import { CATALOG, TRUCK_LOAD, orders, placeOrder, onOrdersChange, itemOf, lineName } from './delivery.js';
import { audio } from './audio.js';
import { crew, hire, HEIGHTS, onCrewChange, houses } from './workers.js';
import { village, PLANS, needs, startPlanning, onVillageChange, buyFloor, FLOOR_M2 } from './village.js';
import { money as wallet, spend, WAGE, PRICES, onMoneyChange } from './money.js';
import { JOBS, honestyOf, startAreaPick } from './lumberjack.js';
import { PAINTS, hexOf, wallStateText, onCoatChange, coloursAround, bagsAround, startHousePick } from './paint.js';
import { streets, lamps, things as streetThings, onStreetsChange } from './streets.js';

const ART = {
  poles: `<svg viewBox="0 0 72 48"><g stroke-linecap="round">${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="${8 + i * 3}" y1="${38 - i * 4}" x2="${50 + i * 3}" y2="${30 - i * 4}" stroke="#7a5a3c" stroke-width="5"/><circle cx="${8 + i * 3}" cy="${38 - i * 4}" r="2.6" fill="#e2c391"/>`).join('')}</g></svg>`,
  pine3: `<svg viewBox="0 0 72 48">${[[22, 32], [42, 32], [32, 15]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="10.5" fill="#6b4c32"/><circle cx="${x}" cy="${y}" r="8.6" fill="#e0bd86"/><circle cx="${x}" cy="${y}" r="5.5" fill="none" stroke="#b98d58" stroke-width="1"/><circle cx="${x}" cy="${y}" r="2.6" fill="none" stroke="#b98d58" stroke-width="1"/>`).join('')}</svg>`,
  pine5: `<svg viewBox="0 0 72 48"><rect x="10" y="17" width="54" height="16" rx="3" fill="#6f5136"/><path d="M14 21 H58 M16 28 H52" stroke="#4e3826" stroke-width="1.4"/><ellipse cx="10" cy="25" rx="5" ry="8" fill="#e0bd86"/><ellipse cx="10" cy="25" rx="2.4" ry="4" fill="none" stroke="#b98d58"/></svg>`,
  oak2: `<svg viewBox="0 0 72 48">${[[24, 26], [48, 26]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="13" fill="#4f3826"/><circle cx="${x}" cy="${y}" r="10.8" fill="#c99a62"/><circle cx="${x}" cy="${y}" r="7" fill="none" stroke="#9c703e" stroke-width="1.2"/><circle cx="${x}" cy="${y}" r="3.5" fill="none" stroke="#9c703e" stroke-width="1.2"/>`).join('')}</svg>`,
  nails: `<svg viewBox="0 0 72 48"><path d="M16 20 L56 20 L52 40 L20 40 Z" fill="#b5895a"/><rect x="24" y="27" width="24" height="7" rx="1.5" fill="#efe6cf"/>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<line x1="${21 + i * 5}" y1="20" x2="${24 + i * 5}" y2="${8 + (i % 3) * 2}" stroke="#a9b0b5" stroke-width="2" stroke-linecap="round"/>`).join('')}</svg>`,
  stone: `<svg viewBox="0 0 72 48"><path d="M14 36 L20 24 L32 20 L40 28 L36 38 Z" fill="#9a968c"/><path d="M38 38 L44 22 L58 24 L62 36 Z" fill="#85817a"/></svg>`,
  iron: `<svg viewBox="0 0 72 48"><path d="M18 36 L24 18 L42 14 L54 26 L46 38 Z" fill="#5d4a42"/><circle cx="34" cy="26" r="3" fill="#b0563a"/><circle cx="44" cy="30" r="2" fill="#b0563a"/></svg>`,
  bricks: `<svg viewBox="0 0 72 48"><rect x="12" y="38" width="48" height="5" fill="#b5895a"/>${[0, 1, 2, 3].map((r) => [0, 1, 2].map((c) => `<rect x="${14 + c * 15 + (r % 2) * 3}" y="${29 - r * 8}" width="13" height="6.5" rx="1" fill="${['#a7442f', '#b9533a', '#93392a'][(r + c) % 3]}"/>`).join('')).join('')}</svg>`,
  door: `<svg viewBox="0 0 72 48"><rect x="25" y="4" width="22" height="42" fill="#e9e1cf"/><rect x="28" y="7" width="16" height="39" fill="#b07a4a"/><rect x="30.5" y="10" width="11" height="12" fill="#94623a"/><rect x="30.5" y="26" width="11" height="16" fill="#94623a"/><circle cx="41" cy="27" r="1.4" fill="#d8c48a"/><rect x="23" y="2" width="26" height="4" fill="#8a6a48"/></svg>`,
  window: `<svg viewBox="0 0 72 48"><rect x="20" y="8" width="32" height="32" fill="#e9e1cf"/><rect x="23" y="11" width="26" height="26" fill="#bcd6e0"/><path d="M36 11 V37 M23 26 H49" stroke="#e9e1cf" stroke-width="2.4"/><rect x="18" y="4" width="36" height="4" fill="#8a6a48"/><rect x="17" y="40" width="38" height="3" fill="#9c9a92"/></svg>`,
  sheets: `<svg viewBox="0 0 72 48">${[0, 1, 2].map((i) => `<path d="M${10 + i * 4} ${36 - i * 6} L${52 + i * 4} ${30 - i * 6} L${58 + i * 4} ${36 - i * 6} L${16 + i * 4} ${42 - i * 6} Z" fill="${['#7a2e25', '#8a3428', '#9a3b2e'][i]}"/>`).join('')}</svg>`,
  mortar: `<svg viewBox="0 0 72 48"><path d="M16 18 Q14 30 16 40 L56 40 Q58 30 56 18 Q36 13 16 18 Z" fill="#d9cdb0"/><rect x="24" y="24" width="24" height="9" rx="1.5" fill="#efe6cf"/><path d="M26 28.5 H46" stroke="#8a7656" stroke-width="2"/></svg>`,
  eps: `<svg viewBox="0 0 72 48"><rect x="14" y="14" width="44" height="22" rx="2" fill="#f2f3f0"/><path d="M14 24 H58" stroke="#d6d8d2"/></svg>`,
  plaster: `<svg viewBox="0 0 72 48"><path d="M16 18 Q14 30 16 40 L56 40 Q58 30 56 18 Q36 13 16 18 Z" fill="#c9c6bd"/><rect x="24" y="24" width="24" height="9" rx="1.5" fill="#ecebe6"/><path d="M26 28.5 H46" stroke="#6e6c66" stroke-width="2"/></svg>`,
  brush: `<svg viewBox="0 0 72 48"><path d="M14 36 L40 20" stroke="#9a7448" stroke-width="5" stroke-linecap="round"/><path d="M40 20 L46 16" stroke="#8b9298" stroke-width="7"/><path d="M45 12 L58 6 L60 14 L49 21 Z" fill="#d9c49a"/></svg>`,
  roller: `<svg viewBox="0 0 72 48"><rect x="18" y="8" width="34" height="11" rx="4" fill="#f1eee7" stroke="#c8c2b6"/><path d="M52 13 H58 V24 H36 V30" fill="none" stroke="#8b9298" stroke-width="3" stroke-linejoin="round"/><rect x="33" y="30" width="6" height="14" rx="2" fill="#9a7448"/></svg>`,
  float: `<svg viewBox="0 0 72 48"><rect x="12" y="26" width="48" height="6" rx="1.5" fill="#b6b9bb"/><path d="M26 26 V18 H46 V26" fill="none" stroke="#9a7448" stroke-width="5" stroke-linejoin="round"/></svg>`,
  gravel: `<svg viewBox="0 0 72 48"><rect x="18" y="16" width="36" height="28" rx="3" fill="#e8e4d8"/><path d="M18 18 Q36 6 54 18 Z" fill="#a29d92"/>${[[24, 15], [31, 12], [40, 13], [47, 16], [36, 16]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2" fill="#8a857b"/>`).join('')}<rect x="26" y="26" width="20" height="8" rx="1.5" fill="#cfcabd"/><path d="M18 18 Q15 12 20 12 M54 18 Q57 12 52 12" fill="none" stroke="#e8e4d8" stroke-width="2"/></svg>`,
  asphalt: `<svg viewBox="0 0 72 48"><rect x="18" y="16" width="36" height="28" rx="3" fill="#2e3033"/><path d="M18 18 Q36 6 54 18 Z" fill="#3c3d3f"/><rect x="26" y="26" width="20" height="8" rx="1.5" fill="#55585c"/><path d="M18 18 Q15 12 20 12 M54 18 Q57 12 52 12" fill="none" stroke="#2e3033" stroke-width="2"/></svg>`,
  curbs: `<svg viewBox="0 0 72 48"><rect x="12" y="38" width="48" height="5" fill="#b5895a"/>${[0, 1, 2].map((r) => [0, 1].map((c) => `<rect x="${14 + c * 23}" y="${29 - r * 9}" width="21" height="8" rx="1" fill="${['#cfcbc1', '#bdb9af', '#d8d4ca'][(r + c) % 3]}"/>`).join('')).join('')}</svg>`,
  shovel: `<svg viewBox="0 0 72 48"><path d="M12 40 L44 16" stroke="#b98a55" stroke-width="4" stroke-linecap="round"/><path d="M8 42 L16 36" stroke="#2c2f33" stroke-width="5" stroke-linecap="round"/><path d="M42 14 L52 8 C58 12 62 18 60 26 C52 26 46 22 42 14 Z" fill="#9aa1a7"/></svg>`,
  rake: `<svg viewBox="0 0 72 48"><path d="M10 40 L48 14" stroke="#b98a55" stroke-width="4" stroke-linecap="round"/><path d="M40 6 L58 22" stroke="#7d858b" stroke-width="4" stroke-linecap="round"/>${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${42 + i * 3} ${8 + i * 2.7} l5 -5" stroke="#7d858b" stroke-width="2"/>`).join('')}</svg>`,
  hroller: `<svg viewBox="0 0 72 48"><rect x="30" y="24" width="30" height="18" rx="9" fill="#7d858b"/><circle cx="45" cy="33" r="3" fill="#55595d"/><path d="M45 33 L14 10" stroke="#b98a55" stroke-width="4" stroke-linecap="round"/><path d="M10 13 L18 7" stroke="#2c2f33" stroke-width="5" stroke-linecap="round"/></svg>`,
  lamp: `<svg viewBox="0 0 72 48"><path d="M26 46 V8 H44" fill="none" stroke="#3b4a44" stroke-width="3.5"/><rect x="40" y="6" width="14" height="5" rx="1.5" fill="#3b4a44"/><path d="M42 11 L52 11 L56 24 L38 24 Z" fill="#ffe2a6" opacity=".55"/><rect x="22" y="40" width="8" height="6" fill="#3b4a44"/></svg>`,
  sign: `<svg viewBox="0 0 72 48"><path d="M36 46 V24" stroke="#9aa1a7" stroke-width="3"/><circle cx="36" cy="16" r="12" fill="#fff" stroke="#c4161c" stroke-width="4"/><text x="36" y="20.5" font-size="12" font-weight="800" text-anchor="middle" fill="#111" font-family="sans-serif">30</text></svg>`,
  zebra: `<svg viewBox="0 0 72 48"><rect x="6" y="14" width="60" height="26" fill="#3a3b3d"/>${[0, 1, 2, 3, 4].map((i) => `<rect x="${12 + i * 11}" y="16" width="6" height="22" fill="#f1efe6"/>`).join('')}<rect x="48" y="4" width="14" height="14" rx="2" fill="#f2f0e8" stroke="#888"/></svg>`,
};
// a paint bucket with the lid in its colour
const paintArt = (hex) => `<svg viewBox="0 0 72 48"><path d="M22 14 L50 14 L47 44 L25 44 Z" fill="#f2efe8" stroke="#d8d2c6"/><ellipse cx="36" cy="14" rx="14.5" ry="4" fill="${hex}" stroke="rgba(0,0,0,.18)"/><path d="M22 15 Q36 -4 50 15" fill="none" stroke="#8a8f93" stroke-width="1.5"/><rect x="27" y="24" width="18" height="10" rx="1.5" fill="${hex}"/></svg>`;

const CATS = [['wood', 'Wood'], ['masonry', 'Bricks'], ['house', 'House'], ['hardware', 'Nails'], ['paint', 'Paint'], ['road', 'Streets'], ['soon', 'Soon']];
const money = (n) => (Number.isFinite(n) ? `$${n}` : '$∞'); // (creative: unlimited)

export const phone = {
  open: false,
  view: 'home',
  cat: 'wood',
  cart: new Map(),
  lastOrder: null,

  init() {
    this.el = document.getElementById('phone');
    this.app = document.getElementById('app');
    this.timeEl = document.getElementById('phoneTime');
    this.el.addEventListener('click', (e) => this.onClick(e));
    onOrdersChange(() => { if (this.open) this.render(); this.badge(); });
    onCrewChange(() => { if (this.open && this.view === 'crew') this.render(); });
    onVillageChange(() => { if (this.open && this.view === 'village') this.render(); });
    onCoatChange(() => { if (this.open && (this.view === 'village' || this.view === 'crew')) this.render(); });
    onStreetsChange(() => { if (this.open && (this.view === 'village' || this.view === 'crew')) this.render(); });
    onMoneyChange(() => { if (this.open && this.view !== 'done') this.render(); });
    setInterval(() => {
      if (!this.open) return;
      this.timeEl.textContent = game.day.clock;
      if (this.view === 'orders' || this.view === 'home') this.render();
    }, 500);
  },

  show() {
    if (this.open) return;
    this.open = true;
    game.phoneOpen = true;
    game.input.keys.clear();
    game.input.lmb = game.input.rmb = false;
    this.view = 'home';
    this.timeEl.textContent = game.day.clock;
    this.render();
    this.el.classList.remove('hide');
    requestAnimationFrame(() => this.el.classList.add('up'));
    audio.phone();
    document.exitPointerLock();
  },

  hide(relock = true) {
    if (!this.open) return;
    this.open = false;
    game.phoneOpen = false;
    this.el.classList.remove('up');
    setTimeout(() => { if (!this.open) this.el.classList.add('hide'); }, 250);
    if (relock) game.relock();
  },

  go(view) {
    this.view = view;
    audio.tap();
    this.render();
    this.app.scrollTop = 0;
  },

  load() {
    let n = 0;
    for (const [id, q] of this.cart) n += itemOf(id).load * q;
    return n;
  },

  badge() {
    const active = orders.filter((o) => o.status !== 'delivered').length;
    document.querySelectorAll('[data-badge]').forEach((b) => { b.textContent = active; b.hidden = !active; });
  },

  onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act, id = t.dataset.id;
    if (act === 'home') this.go('home');
    else if (act === 'close') this.hide();
    else if (act === 'app') this.go(id);
    else if (act === 'cat') { this.cat = id; this.go('shop'); }
    else if (act === 'plus' || act === 'minus') {
      const item = itemOf(id);
      const q = this.cart.get(id) || 0;
      if (act === 'plus') {
        if (this.load() + item.load > TRUCK_LOAD) { this.flash('The truck is full'); return; }
        if (q >= 9) return;
        this.cart.set(id, q + 1);
      } else if (q > 0) this.cart.set(id, q - 1);
      if (!this.cart.get(id)) this.cart.delete(id);
      audio.tap();
      this.render();
    } else if (act === 'hire') {
      if (crew.length >= 6) { this.flash('Six is enough for one site'); return; }
      // the first hour is paid when he starts
      if (!spend(WAGE, 'Wages · first hour')) { this.flash(`You need $${WAGE} for his first hour`); return; }
      hire(id || 'bricklayer');
      audio.tap();
      this.render();
    } else if (act === 'raise') {
      const msg = crew[+id].raise(HEIGHTS[t.dataset.h]);
      audio.tap();
      this.render();
      this.flash(msg ? 'Lay the first course yourself first' : `${crew[+id].name}: on it!`);
      if (msg) game.hud.toast(msg);
    } else if (act === 'roofit') {
      const msg = crew[+id].roofIt();
      audio.tap();
      this.render();
      this.flash(msg ? 'Not ready for a roof yet' : `${crew[+id].name}: on it!`);
      if (msg) game.hud.toast(msg);
    } else if (act === 'houses') {
      const list = id === 'all' ? crew.filter((w) => w.trade === 'bricklayer') : [crew[+id]];
      const msg = list.map((w) => w.buildHouses()).find(Boolean);
      audio.tap();
      this.render();
      this.flash(msg ? 'Mark out a house first' : list.length > 1 ? 'Everyone: on it!' : `${list[0].name}: on it!`);
      if (msg) game.hud.toast(msg);
    } else if (act === 'floor') {
      const msg = buyFloor(houses[+id]);
      audio.tap();
      this.render();
      this.flash(msg ?? (crew.length ? 'Floor ordered. A worker will lay it.' : 'Floor paid. Hire a bricklayer to lay it.'));
    } else if (act === 'pcolour') {
      // the paint colour to buy (Woodline · Paint)
      this.paintColour = t.dataset.c;
      audio.tap();
      this.render();
    } else if (act === 'pcol') {
      // which of your colours the painter uses where ('' = leave it)
      const w = crew[+id];
      w.colours[t.dataset.part] = t.dataset.c || null;
      audio.tap();
      this.render();
    } else if (act === 'pjob') {
      const w = crew[+id], job = t.dataset.job;
      if (job === 'plaster' && !bagsAround() && !(w.plaster > 0)) { this.flash('No plaster bags — buy some in Woodline'); return; }
      if (job === 'paint' && !Object.values(w.colours).some(Boolean)) { this.flash('Pick a colour for something first'); return; }
      this.hide();
      startHousePick(w, job);
    } else if (act === 'plan') {
      this.hide();
      startPlanning(id);
    } else if (act === 'ljob') {
      // a job for the lumberjack: put the phone away and point at where he should work
      this.hide();
      startAreaPick(crew[+id], t.dataset.job);
    } else if (act === 'rjob') {
      // the road worker: a street from where you stand (you face the way it goes), or finish them
      const w = crew[+id], msg = w.roadJob(+t.dataset.n);
      audio.tap();
      this.render();
      this.flash(msg ? 'Not from here' : `${w.name}: on it!`);
      if (msg) game.hud.toast(msg);
    } else if (act === 'stop') {
      crew[+id].stop();
      audio.tap();
      this.render();
    } else if (act === 'fire') {
      crew[+id].leave();
      audio.tap();
      this.render();
    } else if (act === 'checkout') this.go('checkout');
    else if (act === 'place') {
      const total = this.total();
      if (!spend(total, `Order: ${[...this.cart].map(([cid, q]) => `${q} × ${lineName(itemOf(cid), cid.split(':')[1])}`).join(', ')}`)) {
        this.flash(`You need $${total - wallet.balance} more`);
        return;
      }
      this.lastOrder = placeOrder(this.cart);
      this.cart = new Map();
      audio.nails();
      this.go('done');
    }
  },

  total() { return [...this.cart].reduce((s, [id, q]) => s + itemOf(id).price * q, 0); },
  balance() { return `<span class="balance${wallet.balance < 50 ? ' low' : ''}">${money(wallet.balance)}</span>`; },

  flash(text) {
    const f = this.el.querySelector('.flash');
    if (!f) return;
    f.textContent = text;
    f.classList.add('show');
    clearTimeout(this.flashT);
    this.flashT = setTimeout(() => f.classList.remove('show'), 1400);
  },

  render() {
    const v = this.view;
    this.app.className = `app app-${v}`;
    const scroll = this.app.querySelector('.scroll')?.scrollTop || 0;
    this.app.innerHTML = v === 'home' ? this.home() : v === 'shop' ? this.shop() : v === 'checkout' ? this.checkout() : v === 'done' ? this.done() : v === 'crew' ? this.crewView() : v === 'village' ? this.villageView() : v === 'wallet' ? this.walletView() : this.ordersView();
    const s = this.app.querySelector('.scroll');
    if (s) s.scrollTop = scroll;
    this.badge();
  },

  bar(title, back = 'home', right = '') {
    return `<header class="bar"><button class="back" data-act="${back === 'home' ? 'home' : 'app'}" data-id="${back}">‹</button><h2>${title}</h2><div class="right">${right}</div></header>`;
  },

  home() {
    const active = orders.find((o) => o.status !== 'delivered');
    return `
      <div class="wall">
        <div class="bigclock">${game.day.clock}</div>
        <div class="date">Day ${game.day.day} · ${game.day.daylight > 0.5 ? 'Sunny' : 'Clear night'}</div>
        ${active ? `<button class="widget" data-act="app" data-id="orders"><span class="wi">🚚</span><span><b>Order #${active.id}</b><br>${statusText(active)}</span></button>` : ''}
        <div class="apps">
          <button class="appicon" data-act="app" data-id="shop"><span class="ic shop">${ICON_SHOP}</span><span>Woodline</span></button>
          <button class="appicon" data-act="app" data-id="orders"><span class="ic orders">${ICON_BOX}<i class="badge" data-badge hidden></i></span><span>Orders</span></button>
          <button class="appicon" data-act="app" data-id="crew"><span class="ic crew">${ICON_HAT}</span><span>Crew</span></button>
          <button class="appicon" data-act="app" data-id="village"><span class="ic village">${ICON_HOUSE}</span><span>Village</span></button>
          <button class="appicon" data-act="app" data-id="wallet"><span class="ic wallet">${ICON_COIN}</span><span>Wallet</span></button>
        </div>
      </div>`;
  },

  shop() {
    const items = CATALOG.filter((c) => c.cat === this.cat);
    const count = [...this.cart.values()].reduce((a, b) => a + b, 0);
    const total = this.total();
    const load = this.load();
    return `
      ${this.bar('Woodline', 'home', this.balance())}
      <div class="scroll">
        <p class="lead">Raw materials, delivered to the end of your road.</p>
        <nav class="chips">${CATS.map(([id, n]) => `<button class="chip ${id === this.cat ? 'on' : ''}" data-act="cat" data-id="${id}">${n}</button>`).join('')}</nav>
        <div class="cards">
          ${items.map((it) => {
            // paint: you pick the colour, and how many of that colour
            const colour = it.colours ? (this.paintColour ??= 'cream') : null;
            const key = colour ? `${it.id}:${colour}` : it.id;
            const q = this.cart.get(key) || 0;
            const soon = it.cat === 'soon';
            const inCart = colour ? [...this.cart].filter(([k]) => k.startsWith(`${it.id}:`)).map(([k, n]) => `${n} × ${k.split(':')[1]}`).join(', ') : '';
            return `<article class="card ${soon ? 'soon' : ''}">
              <div class="art">${colour ? paintArt(hexOf(colour)) : ART[it.id]}</div>
              <div class="txt"><h3>${it.name}</h3><p>${it.info}</p>${it.note ? `<p class="note">${colour ? `<b>${colour}</b>${inCart ? ` · in your cart: ${inCart}` : ''}` : it.note}</p>` : ''}</div>
              ${soon ? '<span class="tag">Later</span>' : `<div class="buy"><span class="price">${money(it.price)}</span>
                <div class="step">${q ? `<button data-act="minus" data-id="${key}">−</button><b>${q}</b>` : ''}<button data-act="plus" data-id="${key}">+</button></div></div>`}
              ${colour ? `<div class="swatches wide">${PAINTS.map(([cid, hex]) => `<button class="sw${cid === colour ? ' on' : ''}" title="${cid}" style="background:${hex}" data-act="pcolour" data-c="${cid}"></button>`).join('')}</div>` : ''}
            </article>`;
          }).join('')}
        </div>
      </div>
      ${count ? `<footer class="cartbar">
        <div class="loadmeter"><span>Truck load</span><div class="meter"><i style="width:${(load / TRUCK_LOAD) * 100}%"></i></div><span>${load}/${TRUCK_LOAD}</span></div>
        <button class="primary" data-act="checkout">Check out · ${count} ${count === 1 ? 'item' : 'items'} · ${money(total)}</button>
      </footer>` : ''}
      <div class="flash"></div>`;
  },

  checkout() {
    const lines = [...this.cart].map(([id, q]) => ({ it: itemOf(id), q, name: lineName(itemOf(id), id.split(':')[1]) }));
    if (!lines.length) return this.shop();
    const total = lines.reduce((s, l) => s + l.it.price * l.q, 0);
    return `
      ${this.bar('Your order', 'shop')}
      <div class="scroll">
        <div class="sheet">
          ${lines.map((l) => `<div class="line"><span>${l.q} × ${l.name}</span><span>${money(l.it.price * l.q)}</span></div>`).join('')}
          <div class="line soft"><span>Delivery</span><span>Free</span></div>
          <div class="line total"><span>Total</span><span>${money(total)}</span></div>
        </div>
        <div class="sheet info">
          <div class="row"><span class="k">Deliver to</span><span>End of the road, next to camp</span></div>
          <div class="row"><span class="k">Arrives</span><span>in about half a minute</span></div>
          <div class="row"><span class="k">Pay with</span><span>Your account · <b>${money(wallet.balance)}</b></span></div>
        </div>
      </div>
      <footer class="cartbar">${total > wallet.balance
        ? `<p class="short">You need ${money(total - wallet.balance)} more. Sell some wood at the timber yard.</p><button class="primary" disabled>Not enough money</button>`
        : `<button class="primary" data-act="place">Place order · ${money(total)}</button>`}</footer>
      <div class="flash"></div>`;
  },

  done() {
    const o = this.lastOrder;
    return `
      <div class="donebox">
        <div class="check">✓</div>
        <h2>Order #${o.id} placed</h2>
        <p>A truck is getting loaded. It will tip everything off at the end of the road.</p>
        <button class="primary" data-act="app" data-id="orders">Track the truck</button>
        <button class="ghost" data-act="app" data-id="shop">Keep shopping</button>
      </div>`;
  },

  crewView() {
    return `
      ${this.bar('Crew', 'home', this.balance())}
      <div class="scroll">
        <p class="lead">Builders fetch bricks, mortar, doors, windows and roofing sheets themselves. Mark out a house in the Village app and tell them to build it, or let them raise walls you started and put a roof on them. A lumberjack fells trees where you point.</p>
        ${crew.map((w, i) => w.trade === 'lumberjack' ? this.lumberCard(w, i) : w.trade === 'painter' ? this.painterCard(w, i) : w.trade === 'roadworker' ? this.roadCard(w, i) : `
          <article class="order worker">
            <div class="top"><b>${w.name}</b><span class="st">Bricklayer</span></div>
            <p class="eta">${w.status}</p>
            <p>${w.bricks ? `Carrying ${w.bricks} bricks` : 'Hands free'} · mortar for ${w.mortar} · ${money(WAGE)} an hour</p>
            <div class="crewbtns">
              <button data-act="houses" data-id="${i}" class="wide">Build the houses</button>
              <button data-act="raise" data-id="${i}" data-h="windows">Your walls: to the windows</button>
              <button data-act="raise" data-id="${i}" data-h="full">Your walls: full height</button>
              <button data-act="roofit" data-id="${i}">Your walls: roof it</button>
              <button data-act="stop" data-id="${i}" class="soft">Stop</button>
              <button data-act="fire" data-id="${i}" class="soft wide">Let him go (no more wages)</button>
            </div>
          </article>`).join('')}
        ${crew.filter((w) => w.trade === 'bricklayer').length > 1 ? '<button class="primary allbtn" data-act="houses" data-id="all">Everyone: build the houses</button>' : ''}
        <article class="card hirecard">
          <div class="art">${ICON_HAT_ART}</div>
          <div class="txt"><h3>Bricklayer</h3><p>Builds houses: walls, doors, windows, roof</p><p class="note">Paid every game hour · arrives on foot</p></div>
          <div class="buy"><span class="price">${money(WAGE)}/h</span><button class="hirebtn" data-act="hire" data-id="bricklayer">Hire</button></div>
        </article>
        <article class="card hirecard">
          <div class="art">${ICON_AXE_ART}</div>
          <div class="txt"><h3>Lumberjack</h3><p>Fells trees where you point, saws them up, carries the wood</p><p class="note">Stacks it, loads your pickup, or sells it himself</p></div>
          <div class="buy"><span class="price">${money(WAGE)}/h</span><button class="hirebtn" data-act="hire" data-id="lumberjack">Hire</button></div>
        </article>
        <article class="card hirecard">
          <div class="art">${ICON_ROLLER_ART}</div>
          <div class="txt"><h3>Painter</h3><p>Plasters and paints a house you point at: walls, frames, door, roof</p><p class="note">Uses the paint and plaster you bought</p></div>
          <div class="buy"><span class="price">${money(WAGE)}/h</span><button class="hirebtn" data-act="hire" data-id="painter">Hire</button></div>
        </article>
        <article class="card hirecard">
          <div class="art">${ART.shovel}</div>
          <div class="txt"><h3>Road worker</h3><p>Builds a street from where you stand, the way you face: digs, gravel, curbs, asphalt, roller</p><p class="note">Uses the gravel, asphalt and curbs you bought</p></div>
          <div class="buy"><span class="price">${money(WAGE)}/h</span><button class="hirebtn" data-act="hire" data-id="roadworker">Hire</button></div>
        </article>
      </div>
      <div class="flash"></div>`;
  },

  // the road worker: a street from here (n metres), or finish what's started
  roadCard(w, i) {
    const bags = (k) => streetThings.size ? [...streetThings].filter((t) => t.kind === k).reduce((n, t) => n + (t.m ?? t.n ?? 0), 0) : 0;
    const load = [w.gravel && `gravel for ${w.gravel} m`, w.asphalt && `asphalt for ${w.asphalt} m`, w.curbs && `${w.curbs} curb stones`].filter(Boolean).join(', ');
    return `
          <article class="order worker">
            <div class="top"><b>${w.name}</b><span class="st">Road worker</span></div>
            <p class="eta">${w.status}</p>
            <p>${load ? `Has ${load}` : 'Barrow empty'} · ${money(WAGE)} an hour</p>
            <p class="note">Lying around: gravel for ${bags('gravel')} m · asphalt for ${bags('asphalt')} m · ${bags('curbs')} curb stones. Stand where the street should go and face that way. Posts you hammer into the ground ahead steer him.</p>
            <div class="crewbtns">
              <button data-act="rjob" data-id="${i}" data-n="10">A street from here: 10 m</button>
              <button data-act="rjob" data-id="${i}" data-n="25">25 m</button>
              <button data-act="rjob" data-id="${i}" data-n="0" class="wide">Finish the streets</button>
              <button data-act="stop" data-id="${i}" class="soft">Stop</button>
              <button data-act="fire" data-id="${i}" class="soft wide">Let him go (no more wages)</button>
            </div>
          </article>`;
  },

  // the painter: which of your colours go where (only colours you have in buckets), then a house
  painterCard(w, i) {
    const have = coloursAround();
    const parts = [['walls', 'Walls'], ['trim', 'Frames'], ['door', 'Door'], ['roof', 'Roof']];
    const rows = have.length ? parts.map(([part, name]) => `<div class="swrow"><span>${name}</span><div class="swatches">
        <button class="sw none${w.colours[part] ? '' : ' on'}" title="leave it" data-act="pcol" data-id="${i}" data-part="${part}" data-c="">✕</button>
        ${have.map((cid) => `<button class="sw${w.colours[part] === cid ? ' on' : ''}" title="${cid}" style="background:${hexOf(cid)}" data-act="pcol" data-id="${i}" data-part="${part}" data-c="${cid}"></button>`).join('')}</div></div>`).join('')
      : '<p class="note">No paint lying around. Buy buckets in Woodline (Paint) — he takes them from where the truck leaves them.</p>';
    const bags = bagsAround();
    return `
          <article class="order worker">
            <div class="top"><b>${w.name}</b><span class="st">Painter</span></div>
            <p class="eta">${w.status}</p>
            <p>${w.bucket?.cells > 0 ? `Carrying ${w.bucket.colour} paint` : 'No paint in hand'}${w.plaster > 0 ? ' · plaster mixed' : ''} · ${money(WAGE)} an hour</p>
            ${rows}
            <div class="crewbtns">
              <button data-act="pjob" data-id="${i}" data-job="plaster" class="soft">Plaster a house${bags ? ` (${bags} ${bags === 1 ? 'bag' : 'bags'})` : ''}</button>
              <button data-act="pjob" data-id="${i}" data-job="paint">Paint a house</button>
              <button data-act="stop" data-id="${i}" class="soft">Stop</button>
              <button data-act="fire" data-id="${i}" class="soft wide">Let him go (no more wages)</button>
            </div>
          </article>`;
  },

  lumberCard(w, i) {
    const h = honestyOf(w);
    const job = w.order?.kind === 'lumber' ? w.order.job : null;
    return `
          <article class="order worker">
            <div class="top"><b>${w.name}</b><span class="st">Lumberjack</span></div>
            <p class="eta">${w.status}</p>
            <p><span class="honest h${HONESTY_CLASS[h.name]}">${h.dots} ${h.name}</span> · ${w.carry === 'log' ? 'carrying a log' : 'hands free'} · ${money(WAGE)} an hour</p>
            ${w.cash > 0 ? `<p class="note"><b>Holding ${money(w.cash)} of yours.</b> Walk up to him and press E to ask for it.</p>` : ''}
            ${w.sold ? `<p class="note">Sold your wood for ${money(w.sold)} in all · gave you ${money(w.handed)}</p>` : ''}
            <div class="crewbtns">
              ${Object.entries(JOBS).map(([id, name]) => `<button data-act="ljob" data-id="${i}" data-job="${id}" class="wide${id === (job ?? w.lastJob) ? ' last' : ''}">${name}${id === job ? ' · now' : ''}</button>`).join('')}
              <button data-act="stop" data-id="${i}" class="soft">Stop</button>
              <button data-act="fire" data-id="${i}" class="soft wide">${w.cash > 0 ? `Let him go (he still has your cash!)` : 'Let him go (no more wages)'}</button>
            </div>
          </article>`;
  },

  walletView() {
    const P = PRICES;
    const workers = crew.filter((w) => !w.leaving).length;
    return `
      ${this.bar('Wallet')}
      <div class="scroll">
        <div class="bigbal"><span>Your account</span><b>${money(wallet.balance)}</b>
          <small>${workers ? `Wages: ${money(WAGE * workers)} every game hour (${workers} ${workers === 1 ? 'worker' : 'workers'})` : 'No wages to pay'}</small></div>
        <div class="sheet prices">
          <div class="line soft"><span>The timber yard pays (per m³)</span><span></span></div>
          <div class="line"><span>Pine logs</span><span>${money(P.log.pine)}</span></div>
          <div class="line"><span>Oak logs</span><span>${money(P.log.oak)}</span></div>
          <div class="line"><span>Pine planks</span><span>${money(P.plank.pine)}</span></div>
          <div class="line"><span>Oak planks</span><span>${money(P.plank.oak)}</span></div>
          <div class="line soft"><span>Pieces under 60 cm: half price · nailed wood: no</span><span></span></div>
        </div>
        <p class="lead">The yard is at the end of the dirt track that turns off the main road, deep in the forest. Bring wood in the pickup, park it in the marked area, and talk to the buyer.</p>
        <h4 class="vh">Recent</h4>
        ${wallet.log.length ? `<div class="sheet">${wallet.log.slice(0, 14).map((e) => `<div class="line tx"><span>${e.what}<small>${e.when}</small></span>${e.amount ? `<span class="${e.amount > 0 ? 'in' : 'out'}">${e.amount > 0 ? '+' : '−'}${money(Math.abs(e.amount))}</span>` : '<span></span>'}</div>`).join('')}</div>` : '<p class="lead">Nothing yet.</p>'}
      </div>`;
  },

  villageView() {
    const done = houses.filter((h) => h.state === 'done');
    const people = village.people.length;
    const stateText = (h) => {
      if (h.state === 'done') return `The ${h.family.name} family · ${h.family.members.length} people`;
      if (h.state === 'roof') return `Roof: ${h.roof.filter((s) => s.done).length} of ${h.roof.length} sheets`;
      const p = h.progress();
      return p > 0 ? `Walls ${Math.round(p * 100)}%` : 'Marked out · waiting for the crew';
    };
    // the floor of one house: buy it (per m²), or how far the crew is
    const floorBlock = (h) => {
      const p = h.floors[0];
      if (!p) {
        const o = h.floorOffer();
        return `<div class="crewbtns"><button class="wide" data-act="floor" data-id="${houses.indexOf(h)}">Wooden floor · ${o.area} m² · ${money(o.price)}</button></div>`;
      }
      if (p.rows >= p.total) return '<p class="note">Wooden floor ✓</p>';
      return `<p class="note">${p.rows ? `Laying the floor · ${p.rows} of ${p.total} rows` : h.wallsDone() ? (crew.length ? 'Floor paid · waiting for a free worker' : 'Floor paid · hire a bricklayer to lay it') : 'Floor paid · laid once the walls are up'}</p>`;
    };
    // plaster and paint: how far the walls are (done by hand, or by a painter from the Crew app)
    const coatBlock = (h) => {
      if (!h.wallsDone()) return '';
      const main = h.coat?.paints.slice().sort((a, b) => b.cells.reduce((n, c) => n + c.filter(Boolean).length, 0) - a.cells.reduce((n, c) => n + c.filter(Boolean).length, 0))[0]?.colour;
      return `<div class="coat"><div class="coathead"><i class="chipcol" style="background:${main ? hexOf(main) : h.coat?.plaster ? '#e6e1d6' : '#b5533e'}"></i><span>${wallStateText(h)}</span></div></div>`;
    };
    return `
      ${this.bar(village.founded ? village.name : 'Village')}
      <div class="scroll">
        <div class="vstats">
          <div><b>${done.length}</b><span>${done.length === 1 ? 'house' : 'houses'}</span></div>
          <div><b>${houses.length - done.length}</b><span>being built</span></div>
          <div><b>${people}</b><span>${people === 1 ? 'person' : 'people'}</span></div>
        </div>
        <p class="lead">${village.founded ? `Founded on day ${village.founded}.` : 'Mark out a house, then let your crew build it. When it\'s finished, a family moves in.'}</p>
        <div class="cards">
          ${Object.entries(PLANS).map(([id, p]) => {
            const n = needs(p);
            return `<article class="card plancard">
              <div class="art">${id === 'family' ? ICON_HOUSE_BIG : ICON_HOUSE_ART}</div>
              <div class="txt"><h3>${p.name} · ${p.size}</h3><p>${n.doors} door, ${n.windows} windows, a sheet roof</p>
              <p class="note">Needs ~${n.bricks} bricks, ${n.mortar} bags, ${n.sheets} roofing sheets</p></div>
              <div class="buy"><span></span><button class="hirebtn" data-act="plan" data-id="${id}">Mark out</button></div>
            </article>`;
          }).join('')}
        </div>
        ${streets.length ? `<h4 class="vh">Streets</h4>${streets.map((s) => {
          const nl = lamps.filter((l) => l.street === s), broken = nl.filter((l) => l.broken).length;
          return `
          <article class="order ${s.done() ? 'delivered' : ''}">
            <div class="top"><b>${s.name}</b><span class="st">${s.done() ? 'Finished' : 'Being built'}</span></div>
            <p class="eta">${Math.round(s.length)} m${s.done() ? '' : ` · ${Math.round(s.progress() * 100)}% done`} · off ${s.start.kind === 'road' ? 'the main road' : s.start.of.name}${s.end ? ` · meets ${s.end.kind === 'road' ? 'the main road' : s.end.of.name}` : ''}</p>
            ${nl.length || s.zebras.length ? `<p class="note">${nl.length ? `${nl.length} ${nl.length === 1 ? 'lamp' : 'lamps'}${broken ? ` (${broken} broken — E on it to change the bulb)` : ''}` : ''}${nl.length && s.zebras.length ? ' · ' : ''}${s.zebras.length ? `${s.zebras.length} zebra ${s.zebras.length === 1 ? 'crossing' : 'crossings'}` : ''}</p>` : ''}
          </article>`;
        }).join('')}<p class="lead">Build streets with the shovel, rake and roller (slot 8), or hire a road worker. Street lamps cost ${money(1)} a night for power, paid every morning.</p>` : ''}
        ${houses.length ? `<h4 class="vh">Houses</h4>${houses.map((h) => `
          <article class="order ${h.state === 'done' ? 'delivered' : ''}">
            <div class="top"><b>${h.plan.name}</b><span class="st">${h.state === 'done' ? 'Lived in' : h.state === 'roof' ? 'Roof' : h.progress() > 0 ? 'Building' : 'Planned'}</span></div>
            <p class="eta">${stateText(h)}</p>
            ${floorBlock(h)}
            ${coatBlock(h)}
          </article>`).join('')}<p class="lead">Wooden floors cost ${money(FLOOR_M2)} per m². Your crew lays them, row by row. Paint and plaster come from Woodline (Paint): put them on yourself (slot 7), or hire a painter.</p>` : ''}
      </div>
      <div class="flash"></div>`;
  },

  ordersView() {
    return `
      ${this.bar('Orders')}
      <div class="scroll">
        ${orders.length ? orders.map((o) => `
          <article class="order ${o.status}">
            <div class="top"><b>#${o.id}</b><span class="st">${STATUS[o.status]}</span></div>
            <p>${o.lines.map((l) => `${l.qty} × ${lineName(l.item, l.variant)}`).join(', ')}</p>
            <div class="track"><i style="width:${Math.round(o.progress * 100)}%"></i><span class="truck" style="left:${Math.round(o.progress * 100)}%">🚚</span></div>
            <p class="eta">${statusText(o)}</p>
          </article>`).join('') : `<div class="empty">No orders yet.<br><button class="ghost" data-act="app" data-id="shop">Open Woodline</button></div>`}
      </div>`;
  },
};

const STATUS = { packing: 'Packing', driving: 'On the way', unloading: 'Unloading', delivered: 'Delivered' };
function statusText(o) {
  if (o.status === 'packing') return 'Loading the truck…';
  if (o.status === 'driving') return `Arriving in about ${Math.max(1, Math.round(o.eta ?? 30))} s`;
  if (o.status === 'unloading') return 'Tipping it off at the end of the road';
  return 'Waiting for you at the end of the road';
}

const ICON_SHOP = `<svg viewBox="0 0 32 32"><g fill="none" stroke="#fff" stroke-width="2"><circle cx="10" cy="21" r="5"/><circle cx="22" cy="21" r="5"/><circle cx="16" cy="11" r="5"/></g><g fill="#fff"><circle cx="10" cy="21" r="1.6"/><circle cx="22" cy="21" r="1.6"/><circle cx="16" cy="11" r="1.6"/></g></svg>`;
const ICON_HAT = `<svg viewBox="0 0 32 32"><path d="M6 21 C6 13 10 8 16 8 C22 8 26 13 26 21 Z" fill="#fff"/><rect x="3" y="20" width="26" height="4" rx="2" fill="#fff"/><path d="M16 8 V20" stroke="#3a6ea5" stroke-width="2"/></svg>`;
const ICON_HAT_ART = `<svg viewBox="0 0 72 48"><path d="M20 34 C20 20 27 12 36 12 C45 12 52 20 52 34 Z" fill="#f2c12e"/><rect x="15" y="32" width="42" height="6" rx="3" fill="#e0ad1c"/><path d="M36 12 V32" stroke="#d29c12" stroke-width="3"/></svg>`;
const HONESTY_CLASS = { Honest: 3, 'Mostly honest': 2, Sly: 1 };
const ICON_AXE_ART = `<svg viewBox="0 0 72 48"><path d="M22 42 L48 10" stroke="#9a7448" stroke-width="5" stroke-linecap="round"/><path d="M42 8 C48 2 60 6 60 16 L50 22 Z" fill="#8b9298"/><circle cx="20" cy="38" r="7" fill="#6b4c32"/><circle cx="20" cy="38" r="5.4" fill="#e0bd86"/><circle cx="20" cy="38" r="2.4" fill="none" stroke="#b98d58"/></svg>`;
const ICON_ROLLER_ART = `<svg viewBox="0 0 72 48"><rect x="18" y="8" width="34" height="11" rx="4" fill="#e9c96c"/><path d="M52 13 H58 V24 H36 V30" fill="none" stroke="#8b9298" stroke-width="3" stroke-linejoin="round"/><rect x="33" y="30" width="6" height="14" rx="2" fill="#9a7448"/><path d="M14 40 C20 34 26 44 32 38" fill="none" stroke="#e9c96c" stroke-width="3" stroke-linecap="round"/></svg>`;
const ICON_COIN =`<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="10.5" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M19.5 12.2 C18.6 11 17.4 10.6 16 10.6 C14 10.6 12.6 11.7 12.6 13.2 C12.6 16.6 19.6 15 19.6 18.6 C19.6 20.2 18 21.4 16 21.4 C14.4 21.4 13 20.8 12.2 19.6 M16 8.4 V10.6 M16 21.4 V23.6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;
const ICON_HOUSE = `<svg viewBox="0 0 32 32"><path d="M5 15 L16 6 L27 15" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/><path d="M8 13 V26 H24 V13" fill="none" stroke="#fff" stroke-width="2.2"/><rect x="14" y="18" width="5" height="8" fill="#fff"/></svg>`;
const ICON_HOUSE_ART = `<svg viewBox="0 0 72 48"><path d="M18 18 L54 12 L54 16 L18 22 Z" fill="#8a3428"/><rect x="20" y="20" width="32" height="20" fill="#b5533e"/><rect x="32" y="27" width="8" height="13" fill="#b07a4a"/><rect x="23" y="25" width="6" height="6" fill="#bcd6e0"/><rect x="43" y="25" width="6" height="6" fill="#bcd6e0"/></svg>`;
const ICON_HOUSE_BIG = `<svg viewBox="0 0 72 48"><path d="M10 16 L62 10 L62 14 L10 20 Z" fill="#8a3428"/><rect x="12" y="18" width="48" height="23" fill="#b5533e"/><rect x="32" y="27" width="8" height="14" fill="#b07a4a"/>${[16, 24, 46, 54].map((x) => `<rect x="${x - 2}" y="24" width="6" height="7" fill="#bcd6e0"/>`).join('')}</svg>`;
const ICON_BOX = `<svg viewBox="0 0 32 32"><path d="M5 11 L16 5 L27 11 L27 23 L16 29 L5 23 Z M5 11 L16 17 L27 11 M16 17 V29" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;
