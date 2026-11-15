/* EFFECTS2: more map events told as stories (pure: no Foundry, no PIXI, no DOM; node-tested in dev/sfx-effects2.test.mjs).
     - the SUPERHERO plough (a carried token ploughing through tokens): lettered at its start, in its middle and at its end, each
       different in word, size, tempo and motion, and BUILDING (owner's answer 8 + 8b): the first bite (a short hard knock where the
       first token is hit), the grind (a long scrape riding with the head of the pile, louder the more tokens it pushes), the stop (the
       pile coming to rest: the biggest word of the three, slammed in);
     - the rain's LIGHTNING (owner's answers 1 and 7: steady weather is never lettered, only its events): far flashes rumble at the view
       edge on their side, every second one only; mid flashes rumble louder at the edge; a close strike thunders at its foot;
     - DETONATE (owner's answer 6: «what fits; one explosion = one word, once»): the scene's areas grouped into explosions (the areas of
       one stroke and strokes that touch are one), the biggest few lettered, largest first, a beat apart, the rest silent;
     - the size of a story's words by RANK (SPEC-EFFECTS 2.1: a share of the view height), so a far zoom keeps the small words readable
       and a lower rank never draws larger than a higher one.
   Words hold no text here: a sound KIND and its word options (the engine's vocabulary writes them), a moment, a place, a rank. */

import { hashStr } from "./sfx-core.mjs";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const h01 = (s) => hashStr(s) / 4294967296;

/** Cap height of a story's word as a share of the view height, by rank R1..R5 (SPEC-EFFECTS 2.1; R1/R2 raised a little: EFFECTS2,
    the meteor's ejecta and pre-roll words read tiny at the meteor's own zoom). */
export const RANK_SHARE = [0, 0.04, 0.055, 0.075, 0.11, 0.155];
/** The natural size (cap height, in the units of `viewH`: scene px for a world word, CSS px for a screen word) of a rank's word, a
    notch smaller by `shrink`. */
export const rankSize = (rank, viewH, shrink = 1) => Math.max(1, RANK_SHARE[clamp(rank | 0, 1, 5)] * viewH * clamp(shrink, 0.5, 1.2));

/* ---------------------------------------------------------------- the Superhero plough */

/** a plough's words are lettered only for a run at least this long (ms on its own clock) */
export const PLOUGH_MIN_MS = 250;
/**
 * The page of a plough. `hits` the pushed tokens in the order they joined the pile (plough-core: { id, t0, p: [cx, cy, t, ...] scene px,
 * t ms at k = 1 }), `front` the pile head's path ([[x, y, ms] ...] scene px, ms of the run at this k; may be null), `D` the carrier's run
 * (ms at this k), `k` the entry clock's factor, `start` the entry's start, `delay` the carry's own lead (ms), `grid`, `seed`.
 * -> [{ role: "bite" | "grind" | "stop", kind, wo, t, x, y, rank, ms, stage, ride? }] in time order (empty for a run without hits).
 */
export function ploughPage({ hits = [], front = null, D = 0, k = 1, start = 0, delay = 0, grid = 100, seed = "" } = {}) {
  const H = hits.filter((h) => Array.isArray(h?.p) && h.p.length >= 3 && Number.isFinite(Number(h.t0)));
  if ( !H.length || !(D > PLOUGH_MIN_MS) ) return [];
  const n = H.length, t0 = start + delay;
  const first = H.slice().sort((a, b) => a.t0 - b.t0)[0];
  const tBite = t0 + first.t0 * k, tEnd = t0 + D;
  // where the head is at a moment (the front path when there is one, else the first pushed token's own samples)
  const headAt = (ms) => {
    if ( Array.isArray(front) && front.length ) {
      let i = 1; while ( i < front.length - 1 && front[i][2] < ms ) i++;
      const a = front[i - 1], b = front[i] ?? a, f = b[2] > a[2] ? clamp((ms - a[2]) / (b[2] - a[2]), 0, 1) : 1;
      return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f };
    }
    const p = first.p, m = ms / k;
    let i = 1; while ( i < p.length / 3 - 1 && p[i * 3 + 2] < m ) i++;
    const a = (i - 1) * 3, b = Math.min(i * 3, p.length - 3), f = p[b + 2] > p[a + 2] ? clamp((m - p[a + 2]) / (p[b + 2] - p[a + 2]), 0, 1) : 1;
    return { x: p[a] + (p[b] - p[a]) * f, y: p[a + 1] + (p[b + 1] - p[a + 1]) * f };
  };
  // the way the pile goes (for the words' side: screen-up of the way, never on the pile)
  const pA = headAt(Math.max(0, first.t0 * k)), pB = headAt(D);
  const L = Math.hypot(pB.x - pA.x, pB.y - pA.y) || 1, ux = (pB.x - pA.x) / L, uy = (pB.y - pA.y) / L;
  const [nx, ny] = -ux < 0 || (ux === 0 && uy > 0) ? [uy, -ux] : [-uy, ux];      // (the normal that points up the screen)
  const off = grid * 0.85, side = (q, f = 1) => ({ x: q.x + nx * off * f, y: q.y + ny * off * f });
  const out = [];
  // 1. the BITE: the first token is hit - one short hard knock where it is struck, popped in, gone soon (it is only the start)
  const c = { x: first.p[0], y: first.p[1] }, b = side(c, 0.9);
  out.push({ role: "bite", key: "bite", kind: "punch", wo: { loud: 0.45 }, t: tBite, x: b.x, y: b.y, rank: 2, ms: 380, at: c,
    stage: { in: "slam", out: "shards" }, seed: `${seed}|bite` });
  // 2. the GRIND: the pile building up as it is shoved along - one long scraping word riding beside the head, louder and longer the
  //    more tokens it pushes and the longer it runs (the R run is the run's time)
  const g0 = tBite + 170, g1 = tEnd - 140;
  if ( g1 - g0 >= 160 ) {
    const steps = clamp(Math.round((g1 - g0) / 220), 2, 10);
    const ride = Array.from({ length: steps + 1 }, (_, i) => { const ms = (g0 - t0) + ((g1 - g0) * i) / steps, q = side(headAt(ms), 1.15); return { x: q.x, y: q.y, ms: Math.round((g1 - g0) * i / steps) }; });
    out.push({ role: "grind", key: "grind", kind: "scrape", wo: { loud: clamp(0.35 + 0.1 * n, 0.4, 0.8), long: clamp((g1 - g0) / 1600, 0.35, 1) }, t: g0, x: ride[0].x, y: ride[0].y,
      rank: 3, ms: Math.round(g1 - g0), ride, stage: { in: "grow", holdKind: "rattle", out: "dissolve" }, seed: `${seed}|grind` });
  } else {
    const q = side(headAt((tBite + tEnd) / 2 - t0), 1.15);
    out.push({ role: "grind", key: "grind", kind: "scrape", wo: { loud: clamp(0.35 + 0.1 * n, 0.4, 0.8), long: 0.35 }, t: tBite + 120, x: q.x, y: q.y, rank: 3, ms: 360,
      stage: { in: "grow", holdKind: "rattle" }, seed: `${seed}|grind` });
  }
  // 3. the STOP: the pile slams to rest - the biggest word, slammed in with a shove, lasting while the dust settles
  const e = headAt(D), s = side(e, 1.05);
  out.push({ role: "stop", key: "stop", kind: "crash", wo: { loud: clamp(0.6 + 0.1 * n, 0.65, 1), ...(n >= 3 ? { prefix: true } : {}) }, t: tEnd, x: s.x, y: s.y, at: e,
    rank: n >= 3 ? 5 : 4, ms: 1100, stage: { in: "slam", push: true, holdKind: "rattle", out: "fall" }, seed: `${seed}|stop` });
  return out;
}

/* ---------------------------------------------------------------- the rain's lightning */

/** how long after a flash its thunder comes (ms: the light first, then the sound - farther = later) */
export const THUNDER_LAG = { far: [1200, 2000], mid: [500, 1000], close: [0, 0] };
/** slots scanned back at most to number the far flashes (6 h of one-second slots); beyond: the slot's own parity */
export const FAR_SCAN = 21600;
/**
 * Is this far flash lettered? Every second far flash of the storm (owner's answer 7), counted so every client counts the same.
 * `farBefore(k)` -> how many far flashes came before slot k in its window (MAPRIDE farIndex; sfx.mjs counts them with the storm model;
 * a preview flash: always lettered). (FAR_SCAN: the old count since the switch-on, kept for older callers.)
 */
export const farLettered = (ev, farBefore) => !!ev?.preview || (farBefore(ev.k) % 2 === 1);
/** MAPRIDE: the far flashes are numbered inside fixed windows of FAR_WIN slots (aligned to the shared clock), not from the storm's
    switch-on: a GM's switch-off (or any lightning change) reached the GM's own seat at once and a player's a moment later, and the count
    "since the switch-on" restarted at the change's time on the seat that already had it - a far flash just before a switch-off was
    numbered on two seats differently (live 2026-11-15: a far rumble right after the storm was cleared lettered on the GM's seat only).
    A window's count reads only the flashes of its own slots, the same on every seat that has the same settings for them. */
export const FAR_WIN = 30;
/** how many far flashes came in the slots of k's window before k: `isFar(j)` -> slot j holds a far flash (storm-model flashOf) */
export function farIndex(k, isFar) {
  const k0 = Math.floor(k / FAR_WIN) * FAR_WIN;
  let n = 0;
  for ( let j = k0; j < k; j++ ) if ( isFar(j) ) n++;
  return n;
}
/* ---------------------------------------------------------------- MAPTHUNDER: the storm under the fight (ADVM r2 items 1 and 9) */

/** A lettered close strike's word holds about 2.5 s: two lettered strikes are at least THUNDER_GAP slots (s) apart, so one storm word is
    up at a time and the fight has the stage between them (live 2026-11-15, storm 3 with close thunder: a thunder word on screen 20 of 30 s,
    often two at once, over the bombs' words) */
export const THUNDER_GAP = 6;
/** a lettered close strike after this many slots without one OPENS a spell of the storm (its bigger word); the others roll on under it */
export const THUNDER_SPELL = 20;
/** the rhythm is counted from this many slots back (two windows aligned to the shared clock): the same answer on every seat */
export const THUNDER_WIN = 30;
/** the opening strike's word: rank 4, a notch smaller - under a shell's rank-4 word and a bomb's rank 5 */
export const THUNDER_SHRINK = 0.9;
/**
 * Is the close strike of slot `k` lettered, and does it open a spell? Greedy over the slots from two windows back: a close strike is
 * lettered when no lettered one came in the THUNDER_GAP slots before it. `isClose(j)` -> slot j holds a close strike (storm-model flashOf,
 * the same on every seat). -> { lettered, opens }
 */
export function thunderRhythm(k, isClose) {
  const a = Math.floor(k / THUNDER_WIN) * THUNDER_WIN - THUNDER_WIN;
  let last = -Infinity;
  for ( let j = a; j <= k; j++ ) {
    if ( !isClose(j) || j - last < THUNDER_GAP ) continue;
    if ( j === k ) return { lettered: true, opens: j - last >= THUNDER_SPELL };
    last = j;
  }
  return { lettered: false, opens: false };
}
/** a mid flash's rumble at the screen edge is lettered only when no lettered close strike is within MID_CLEAR slots of it (no stack) */
export const MID_CLEAR = 3;
export function midLettered(k, isClose) {
  for ( let j = k - MID_CLEAR; j <= k + MID_CLEAR; j++ ) if ( isClose(j) && thunderRhythm(j, isClose).lettered ) return false;
  return true;
}
/** THE FIGHT HAS THE STAGE: a storm word whose moment is within [YIELD[0], YIELD[1]] ms of a fight's main word (a preset's blast, a
    catching fire, a brush blast, a plough's stop: the table's own events) is not lettered; one already up leaves THUNDER_CLEAR ms before
    the fight's main word lands (its exit). `fights` = shared ms of the fights' main words. */
export const THUNDER_YIELD = [-1500, 2400];
export const THUNDER_CLEAR = 320;
export const thunderYields = (t, fights) => { for ( const f of fights ) if ( f - t >= THUNDER_YIELD[0] && f - t <= THUNDER_YIELD[1] ) return true; return false; };
/** THE STORM'S ENTRANCE (ADVM r2 item 9, E: the first thunder word came 7 s after the lightning was switched on): when the GM switches
    the lightning on and the storm letters nothing of its own within ONSET_WAIT ms, a rumble rolls in from a side of the scene ONSET_LAG ms
    after the switch-on (only while it rains: the flashes come with the rain). `S` the stored storm (storm-model), `lettered(t0, t1)` -> does
    a flash lettered by the rhythm sound in [t0, t1] (shared ms). -> { t, ev } (a mid flash's shape for flashWord) | null */
export const ONSET_WAIT = 2500, ONSET_LAG = 900;
export function stormOnset(S, lettered, rainAt = () => 1) {
  if ( !S?.on || !(S.t > 0) || S.prev?.on ) return null;
  const t = S.t + ONSET_LAG;
  if ( (Number(rainAt(t)) || 0) < 0.25 || lettered(S.t, S.t + ONSET_WAIT) ) return null;
  const h = (i) => h01(`onset|${S.t}|${i}`);
  return { t, ev: { k: `onset${S.t}`, t, kind: "mid", at: { a: h(1) * 6.283, d: 0.8 }, onset: true } };
}
/** RAIN ON A BURNING FIRE (ADVM r2 item 9, D 28 s: rain level 3 on a burning fire got no reaction): the moment the rain's steam over the
    fire (weather model fireWet) first passes STEAM_ON after a weather change is lettered as a hiss at the burning fires. `keys` the weather's
    timeline keys ({ t, dur }), `steamAt(t)` the world's steam share at shared ms t. -> [{ key, t }] (one per key whose ramp brings it) */
export const STEAM_ON = 0.2, STEAM_STEP = 100, STEAM_AFTER = 4000;
export function steamOnsets(keys, steamAt) {
  const out = [];
  for ( const k of keys ?? [] ) {
    if ( !Number.isFinite(k?.t) ) continue;
    if ( (Number(steamAt(k.t - 1)) || 0) >= STEAM_ON * 0.6 ) continue;                 // (it was steaming before this change already)
    const end = k.t + Math.max(0, Number(k.dur) || 0) + STEAM_AFTER;
    for ( let t = k.t; t <= end; t += STEAM_STEP ) if ( (Number(steamAt(t)) || 0) >= STEAM_ON ) { out.push({ key: `steam|${Math.round(k.t)}`, t: Math.round(t) }); break; }
  }
  return out;
}
/** the hiss of rain on a fire group (sfx-core burnPlan `p`, the steam share `steam`): the fire's own place, rank 2, rising as steam */
export function steamWord(p, t, steam = 0.5, seed = "") {
  const q = p.points?.[0] ?? null; if ( !q ) return null;
  return { role: "main", key: "steam", kind: "hiss", wo: { loud: clamp(0.3 + 0.35 * steam, 0.3, 0.65), long: 0.85 }, t, x: q.x, y: q.y, r: p.r ?? 50,
    rank: 2, ms: 1800, drift: true, stage: { in: "pop", holdKind: "boil", out: "dissolve" }, seed: `${seed}|steam|${p.key}|${t}` };
}

/**
 * The word of a lightning flash. `ev` (storm-model makeFlash), `place` ({ x, y } scene px: storm-model placeOf), `view` ({ x0, y0, x1,
 * y1 } scene px of this client), `seed`. -> { kind, wo, t (shared ms), rank, screen? ({ fx, fy }: a share of the screen, unlocated at the
 * edge on the flash's side), x?, y? (scene px: a close strike's foot), ms, stage } | null
 */
export function flashWord(ev, place, view, seed = "", spell = null) {
  if ( !ev ) return null;
  const sd = `${seed}|flash|${ev.k}|${ev.t}`;
  // the edge of THIS screen on the flash's side (the light comes from beyond it): its direction from the view's centre
  const edge = () => {
    const cx = view ? (view.x0 + view.x1) / 2 : 0, cy = view ? (view.y0 + view.y1) / 2 : 0;
    const a = Math.atan2(place.y - cy, place.x - cx), ex = Math.cos(a), ey = Math.sin(a);
    const k = 1 / Math.max(Math.abs(ex) / 0.36, Math.abs(ey) / 0.34, 1e-6);      // (on a box 0.14..0.86 x 0.16..0.84 of the screen)
    return { fx: clamp(0.5 + ex * k, 0.14, 0.86), fy: clamp(0.5 + ey * k, 0.16, 0.84) };
  };
  if ( ev.kind === "close" ) {
    const lv = clamp(ev.lv | 0 || 2, 1, 3), restrikes = Math.max(0, (ev.strokes?.length ?? 1) - 1);
    // (MAPTHUNDER, ADVM r2 item 1: the storm is the scene's weather, not its fight - its loudest word stays under a bomb's (rank 5, a shell's
    // rank 4 at full size): the strike that opens a spell of the storm (`opens`) at rank 4 a notch smaller, with its lead-in on a full
    // strike; the strikes after it in the same spell at rank 3, no lead-in: the storm makes its entrance, then rolls on under the fight)
    // (a close strike beyond this screen - the storm strikes anywhere on the scene - is lettered at the edge toward it: MAPSEATS3, ONE word
    // for the table, at the strike, on every seat - `heard`: a seat whose view does not hold the strike letters it at its view's edge toward
    // it by the seat rule, at the size its view gives a word it does not see (sfx-seat OFF_K); ADVM r2 item 2)
    const opens = spell?.opens !== false;
    return { role: "main", kind: "thunder", wo: { loud: clamp((opens ? 0.6 : 0.5) + 0.12 * lv + 0.04 * restrikes, 0.5, opens ? 1 : 0.85), ...(lv === 3 && opens ? { prefix: true } : {}) }, t: ev.t, x: place.x, y: place.y,
      heard: true, edge: edge(), rank: opens ? 4 : 3, shrink: opens ? THUNDER_SHRINK : 1, ms: 1100, stage: { in: "slam", holdKind: "rattle", glow: "auto" }, seed: sd, storm: true };
  }
  const far = ev.kind === "far", lag = THUNDER_LAG[ev.kind], t = ev.t + Math.round(lag[0] + (lag[1] - lag[0]) * h01(`${sd}|lag`));
  // (MAPTHUNDER: the storm's entrance - stormOnset - rolls in from the edge a notch bigger and longer than a mid flash's rumble, under
  // any fight's word: rank 3, no flash of its own)
  if ( ev.onset ) return { role: "mid", kind: "thunder", wo: { loud: 0.5, long: 0.85 }, t: ev.t, screen: edge(), rank: 3, ms: 1700,
    stage: { in: "grow", holdKind: "rattle", out: "dissolve" }, seed: sd, onset: true };
  return { role: far ? "far" : "mid", kind: far ? "rumble" : "thunder", wo: { loud: far ? 0.15 : 0.32, long: far ? 0.8 : 0.6 }, t, screen: edge(), rank: far ? 1 : 2,
    ms: far ? 1800 : 1300, stage: { in: "grow", holdKind: "rattle", out: "dissolve" }, seed: sd };
}

/* ---------------------------------------------------------------- Detonate */

/** big words of one Detonate at most, by perf mode (SPEC-EFFECTS 4.2) */
export const DETONATE_MAX = { high: 3, medium: 2, low: 1 };
/** the beat between two of its words (ms, largest first) */
export const DETONATE_BEAT = 120;
/** two areas touch when their centres are within this share of their two r plus a square (EFFECTS2, live Detonate) */
export const DETONATE_TOUCH = 0.55;
/**
 * The composition of a Detonate: `events` (sfx-core entryEvent of every area going off, `obj` its stroke, `voice`, x, y, r, box, t)
 * -> explosions (areas of one stroke, and strokes whose boxes touch within a square, are ONE explosion: owner's answer 6), the biggest
 * `max` of them, each its loudest member as its event, the largest first and the next ones a beat later (and a notch quieter).
 * `prio(voice)` the voice's priority (sfx-core VOICES). -> [event] (with `det: true`, `t` staggered, `m` set)
 */
export function detonateComposition(events, { grid = 100, max = 3, prio = () => 0 } = {}) {
  const list = events.filter((e) => e && Number.isFinite(e.x)).slice().sort((a, b) => (String(a.key) < String(b.key) ? -1 : 1));
  const box = (e) => e.box ?? { x0: e.x - e.r, y0: e.y - e.r, x1: e.x + e.r, y1: e.y + e.r };
  // (touching = the areas themselves meet, within a square: an entry's r is generous - about twice the painted radius - and its box
  // bigger still, so comparing boxes chained five separate explosions of a live Detonate into one word; the centres are compared
  // against a little over half the two r)
  const near = (a, b) => (a.obj && a.obj === b.obj) || Math.hypot(a.e.x - b.e.x, a.e.y - b.e.y) <= DETONATE_TOUCH * ((a.e.r || 0) + (b.e.r || 0)) + grid;
  const items = list.map((e) => ({ e, b: box(e), obj: e.obj }));
  const parent = items.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for ( let i = 0; i < items.length; i++ ) for ( let j = i + 1; j < items.length; j++ ) if ( find(i) !== find(j) && near(items[i], items[j]) ) parent[find(j)] = find(i);
  const groups = new Map();
  items.forEach((it, i) => { const r = find(i); if ( !groups.has(r) ) groups.set(r, []); groups.get(r).push(it); });
  const booms = [...groups.values()].map((g) => {
    const b = { x0: Math.min(...g.map((q) => q.b.x0)), y0: Math.min(...g.map((q) => q.b.y0)), x1: Math.max(...g.map((q) => q.b.x1)), y1: Math.max(...g.map((q) => q.b.y1)) };
    const lead = g.map((q) => q.e).sort((a, b) => (prio(b.voice) - prio(a.voice)) || (b.r - a.r) || (String(a.key) < String(b.key) ? -1 : 1))[0];
    const r = 0.5 * Math.sqrt((b.x1 - b.x0) * (b.y1 - b.y0));
    return { lead, box: b, r, size: r * (1 + 0.15 * prio(lead.voice)) };
  }).sort((a, b) => (b.size - a.size) || (String(a.lead.key) < String(b.lead.key) ? -1 : 1));
  const t0 = Math.min(...list.map((e) => e.t));
  return booms.slice(0, Math.max(1, max)).map((q, i) => {
    const e = q.lead, m = clamp(Math.log1p(q.r / grid) / Math.log1p(5), 0.2, 1) * Math.pow(0.85, i);
    const { path, t0: _t0, ...rest } = e;
    return { ...rest, key: `det|${e.key}`, sid: `det|${e.sid ?? e.key}`, det: true, x: (q.box.x0 + q.box.x1) / 2, y: (q.box.y0 + q.box.y1) / 2, r: q.r, box: q.box, m,
      t: Math.max(t0, e.t) + i * DETONATE_BEAT, ...(e.tPre !== undefined ? { tPre: e.tPre + i * DETONATE_BEAT } : {}) };
  });
}
