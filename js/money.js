// Real money: you start with a little, and everything costs something. You earn by
// selling wood at the timber yard and from rent once families live in your houses.
import { game } from './game.js';

export const START_MONEY = 300;
export const WAGE = 10;            // per worker, per game hour
export const RENT = { base: 40, person: 15 }; // per lived-in house, every morning

// What the timber yard pays, per cubic metre. Sawing a log into planks wastes wood but
// is worth it; oak is worth more than pine; short offcuts fetch half.
export const PRICES = { log: { pine: 90, oak: 150 }, plank: { pine: 600, oak: 950 } };
const SHORT = 0.6;

export const money = { balance: START_MONEY, log: [] };
const listeners = new Set();
export const onMoneyChange = (fn) => listeners.add(fn);
const changed = (delta) => listeners.forEach((fn) => fn(delta));

function note(what, amount) {
  money.log.unshift({ when: `Day ${game.day.day} · ${game.day.clock}`, what, amount });
  if (money.log.length > 40) money.log.pop();
}

export const canAfford = (n) => money.balance >= n;

export function spend(n, what) {
  if (n <= 0) return true;
  if (money.balance < n) return false;
  money.balance -= n;
  note(what, -n);
  changed(-n);
  return true;
}

export function earn(n, what) {
  if (n <= 0) return;
  money.balance += n;
  note(what, n);
  changed(n);
}

// Something worth knowing about that didn't move your money (a worker sold wood and holds the cash).
export function record(what) {
  note(what, 0);
  changed(0);
}

// What the yard would pay for one piece (0: it doesn't buy that).
export function woodValue(p) {
  if (p.kind !== 'log' && p.kind !== 'plank') return 0;
  const sp = p.species === 'oak' ? 'oak' : 'pine';
  let v = p.volume * PRICES[p.kind][sp];
  if (p.len < SHORT) v *= 0.5;
  return Math.max(1, Math.round(v));
}

// ───────── once a game hour: wages; every morning at 8: rent ─────────

let lastHour = null;
export function updateMoney(crew, houses) {
  const hour = Math.floor(game.day.t * 24) + game.day.day * 24;
  if (lastHour === null) { lastHour = hour; return; }
  if (hour === lastHour) return;
  lastHour = hour;
  // wages: everyone who gets paid keeps working; whoever can't be paid stops and waits
  const working = crew.filter((w) => !w.leaving);
  let paid = 0;
  for (const w of working) {
    if (money.balance >= WAGE) { money.balance -= WAGE; paid += WAGE; w.unpaid = false; }
    else w.unpaid = true;
  }
  if (paid) { note(`Wages · ${paid / WAGE} ${paid / WAGE === 1 ? 'worker' : 'workers'}`, -paid); changed(-paid); }
  if (working.some((w) => w.unpaid)) game.hud.toast('Not enough money for wages — the crew stops until you can pay');
  if (Math.floor(game.day.t * 24) === 8) {
    let rent = 0, n = 0;
    for (const h of houses) if (h.state === 'done' && h.family) { rent += RENT.base + RENT.person * h.family.members.length; n++; }
    if (rent) { earn(rent, `Rent · ${n} ${n === 1 ? 'house' : 'houses'}`); game.hud.toast(`Rent from the village: +$${rent}`); }
  }
}
