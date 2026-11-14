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
 * Is this far flash lettered? Every second far flash of the storm (owner's answer 7), counted from the storm's switch-on so every
 * client counts the same. `farBefore(k)` -> how many far flashes came in the slots before k since the switch-on (sfx.mjs counts them
 * with the storm model; a preview flash: always lettered).
 */
export const farLettered = (ev, farBefore) => !!ev?.preview || (farBefore(ev.k) % 2 === 1);
/**
 * The word of a lightning flash. `ev` (storm-model makeFlash), `place` ({ x, y } scene px: storm-model placeOf), `view` ({ x0, y0, x1,
 * y1 } scene px of this client), `seed`. -> { kind, wo, t (shared ms), rank, screen? ({ fx, fy }: a share of the screen, unlocated at the
 * edge on the flash's side), x?, y? (scene px: a close strike's foot), ms, stage } | null
 */
export function flashWord(ev, place, view, seed = "") {
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
    // (a close strike beyond this screen - the storm strikes anywhere on the scene - is lettered at the edge toward it, still the big
    // word: live, a strike off the view was dropped, its word had nowhere to stand)
    const off = view && (place.x < view.x0 || place.x > view.x1 || place.y < view.y0 || place.y > view.y1);
    return { role: "main", kind: "thunder", wo: { loud: clamp(0.6 + 0.12 * lv + 0.04 * restrikes, 0.6, 1), ...(lv === 3 ? { prefix: true } : {}) }, t: ev.t, x: place.x, y: place.y,
      ...(off ? { screen: edge() } : {}), rank: lv === 3 ? 5 : 4, ms: 1100, stage: { in: "slam", holdKind: "rattle", glow: "auto" }, seed: sd };
  }
  const far = ev.kind === "far", lag = THUNDER_LAG[ev.kind], t = ev.t + Math.round(lag[0] + (lag[1] - lag[0]) * h01(`${sd}|lag`));
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
