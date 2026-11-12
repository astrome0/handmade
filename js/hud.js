// Hotbar (small tool slots), crosshair, hints and short messages.
const ICONS = {
  axe: `<svg viewBox="0 0 32 32"><path d="M9 28 L21.5 9" stroke="#c99560" stroke-width="2.6" stroke-linecap="round"/><path d="M17.2 6.2 C20.5 3.6 26 3.6 28.6 7.6 C26.6 8.4 25 10.6 24.8 13.4 L19.6 10 Z" fill="#d6dbe0"/><path d="M28.6 7.6 C26.6 8.4 25 10.6 24.8 13.4" stroke="#fff" stroke-width="1.1" fill="none" opacity=".8"/></svg>`,
  saw: `<svg viewBox="0 0 32 32"><path d="M6 25 L26 6 L28.5 9 L10.5 27.5 Z" fill="#d6dbe0"/><path d="M10.5 27.5 L12 25.6 L12.9 26.9 L14.4 24.9 L15.3 26.1 L16.8 24.1 L17.7 25.3 L19.2 23.3 L20.1 24.5 L21.6 22.5 L22.5 23.7 L24 21.7" stroke="#9aa1a7" stroke-width=".9" fill="none" transform="translate(-1.2 -6.6)"/><rect x="2.5" y="21.5" width="8" height="8.5" rx="2.2" transform="rotate(-45 6.5 25.7)" fill="#c99560"/><rect x="4.6" y="24" width="3.8" height="3" rx="1" transform="rotate(-45 6.5 25.5)" fill="#2b2f33"/></svg>`,
  hammer: `<svg viewBox="0 0 32 32"><path d="M8 28 L19 13" stroke="#c99560" stroke-width="2.8" stroke-linecap="round"/><path d="M12.5 8.5 L20 3.8 L27 13.6 L24.6 15.4 L20.6 11.2 L16.8 13.6 Z" fill="#d6dbe0"/><path d="M12.5 8.5 C10.4 9.6 9.4 12 9.8 14.2" stroke="#d6dbe0" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>`,
  trowel: `<svg viewBox="0 0 32 32"><path d="M6 27 L12.5 20.5" stroke="#c99560" stroke-width="3" stroke-linecap="round"/><path d="M12.5 20.5 L15 18" stroke="#9aa1a7" stroke-width="1.6"/><path d="M14 19 L27 5 L25.5 18.5 Z" fill="#d6dbe0"/><path d="M14 19 L27 5" stroke="#fff" stroke-width="1" opacity=".7"/></svg>`,
  rope: `<svg viewBox="0 0 32 32"><g fill="none" stroke="#c9a46a" stroke-width="2.4"><ellipse cx="15" cy="15" rx="9.5" ry="8"/><ellipse cx="15" cy="15" rx="6.5" ry="5.2"/></g><path d="M22 21 C25 24 24 27 28.5 28.5" stroke="#c9a46a" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M8 11 L22 19 M9.5 19 L21 11" stroke="#8a6a3c" stroke-width="1" opacity=".6"/></svg>`,
  paint: `<svg viewBox="0 0 32 32"><rect x="5" y="4" width="17" height="7" rx="2.5" fill="#f1eee7"/><path d="M22 7.5 H26 V15 H15 V19" fill="none" stroke="#9aa1a7" stroke-width="1.8" stroke-linejoin="round"/><rect x="13" y="19" width="4" height="10" rx="1.4" fill="#c99560"/></svg>`,
  road: `<svg viewBox="0 0 32 32"><path d="M8 4 L19 21" stroke="#c99560" stroke-width="2.6" stroke-linecap="round"/><path d="M5 3 H11" stroke="#2b2f33" stroke-width="2.4" stroke-linecap="round"/><path d="M16.5 19 L23 15 C26 18 28 22 27.5 27.5 C22 28 18.5 25.5 16.5 19 Z" fill="#d6dbe0"/></svg>`,
  hands: `<svg viewBox="0 0 32 32"><path d="M10.5 17 V8.5 a1.8 1.8 0 0 1 3.6 0 V15 V6.5 a1.8 1.8 0 0 1 3.6 0 V15 V7.6 a1.8 1.8 0 0 1 3.6 0 V16 V10.8 a1.8 1.8 0 0 1 3.6 0 V19 c0 5.4-3.2 9-8.2 9 c-3.4 0-5.2-1.6-7-4.4 l-3.2-5 a1.9 1.9 0 0 1 3-2.3 Z" fill="#e8c2a0"/></svg>`,
};

export class Hud {
  constructor(slots) {
    this.slots = slots;
    this.bar = document.getElementById('hotbar');
    this.bar.innerHTML = slots.map((s, i) => `
      <div class="slot" data-i="${i}">
        <span class="key">${i + 1}</span>
        <div class="icon">${ICONS[s.id]}</div>
        ${s.id === 'hammer' ? '<span class="count" id="nailCount">0</span>' : ''}
        ${s.id === 'trowel' ? '<span class="count empty" id="brickCount">0</span>' : ''}
      </div>`).join('');
    this.slotEls = [...this.bar.querySelectorAll('.slot')];
    this.nameEl = document.getElementById('toolname');
    this.hintEl = document.getElementById('hint');
    this.infoEl = document.getElementById('info');
    this.toastEl = document.getElementById('toast');
    this.ring = document.getElementById('ringFill');
    this.clockEl = document.getElementById('clock');
    this.nailEl = document.getElementById('nailCount');
    this.speedNum = document.querySelector('#speedo b');
    this.gearEl = document.querySelector('#speedo i');
    this.lastHint = '';
    this.lastInfo = '';
    this.nameTimer = 0;
    this.toastTimer = 0;
  }

  select(i) {
    this.slotEls.forEach((el, k) => el.classList.toggle('on', k === i));
    this.nameEl.textContent = this.slots[i].name;
    this.nameEl.classList.add('show');
    clearTimeout(this.nameTimer);
    this.nameTimer = setTimeout(() => this.nameEl.classList.remove('show'), 1300);
  }

  setNails(n) {
    this.nailEl.textContent = n;
    this.nailEl.classList.toggle('empty', n === 0);
  }

  setBricks(n) {
    const el = document.getElementById('brickCount');
    el.textContent = n;
    el.classList.toggle('empty', n === 0);
  }

  // lines: [[keyLabel, text], ...]
  hint(lines) {
    const html = lines.map(([k, t]) => (k ? `<span class="row"><kbd>${k}</kbd>${t}</span>` : `<span class="row soft">${t}</span>`)).join('');
    if (html === this.lastHint) return;
    this.lastHint = html;
    this.hintEl.innerHTML = html;
  }

  info(text) {
    if (text === this.lastInfo) return;
    this.lastInfo = text;
    this.infoEl.textContent = text;
    this.infoEl.classList.toggle('show', !!text);
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }

  progress(p) {
    const C = 2 * Math.PI * 11;
    this.ring.style.strokeDasharray = `${C * p} ${C}`;
    this.ring.parentElement.classList.toggle('show', p > 0);
  }

  speedo(kmh, gear) {
    const t = `${kmh}|${gear}`;
    if (t === this.lastSpeedo) return;
    this.lastSpeedo = t;
    this.speedNum.textContent = kmh;
    this.gearEl.textContent = gear;
  }

  // the balance under the clock, with a short +$ / −$ when it changes
  money(balance, delta) {
    const b = document.querySelector('#money b'), d = document.querySelector('#money i');
    b.textContent = Number.isFinite(balance) ? `$${balance.toLocaleString('en-US')}` : '$∞';
    if (!delta || !Number.isFinite(balance)) return;
    d.textContent = `${delta > 0 ? '+' : '−'}$${Math.abs(delta)}`;
    d.className = `show ${delta > 0 ? 'plus' : 'minus'}`;
    clearTimeout(this.moneyT);
    this.moneyT = setTimeout(() => { d.className = ''; }, 1800);
  }

  clock(text) {
    if (this.clockEl.textContent !== text) this.clockEl.textContent = text;
  }
}
