/* MAPDIRECT: map lettering reads the DIRECTION of what it letters (pure: no Foundry, no PIXI, no DOM, no engine; node-tested in
   dev/sfx-direct.test.mjs). The owner on the token reactions' words: lettering goes the way of the action, and stronger - the eye must be
   able to FOLLOW it after the contact, a tilt alone is not enough. A map event with a real direction gets the same:

     a WAY ({ ux, uy }: a unit vector in scene px, x right, y down - the scene's sense is the screen's; from SHARED data only: a firing's
     record, a stroke, a plough's path, the wind of a fire stroke - never a seat's view) on the word of
       - a rocket's, a meteor's, a falling bomb's, a thrown grenade's, a landing hero's IMPACT (the way it came in),
       - debris thrown OUT of a blast (from the blast's centre to where the piece lands), a grenade's shrapnel, a launch's backblast,
       - a plough's first bite and its stop (the way the pile was shoved),
     and for the sounds that are not one word:
       - a gun's report and its rounds' impacts: both streams of syllables fly the SAME slant along the aim (streamDir),
       - wind: steam and a dying fire's hiss drift downwind (driftTo), a burning fire's sparks and tail leave downwind (plumeDeg).

     What a way does to a word (the letterer's tools, then the motion):
       1. GROW along it (the engine's `from`, an ANGLE: the same on every seat) and LEAN with it (lookOf; a mostly vertical way keeps the
          word's own tilt - the engine has no vertical grow: REQUESTS DIRECT-E2);
       2. the engine's own sideways motions go the same way (`dir`: REQUESTS DIRECT-E1);
       3. the KNOCK, after the contact where the eye can follow it: at its contact the word lands BACK toward where the event came from,
          is knocked forward past its place on a hard ease-out, settles, slides on while it stands and is thrown on out on its exit
          (knockS). In cap heights of the word as each seat draws it, on the word's own start clock (the table's instant): one pose at one
          instant on every seat. A seat only SHORTENS it where its own view, panels, pins or tokens are in the way, or the thing it
          letters (roomAlong + knockFit: shortened in proportion, never cut off mid-flight); reduced motion: no knock, the look stays.
   A word that already travels (a ride: a falling bomb's whistle, a shock wave, a plough's grind) or drifts keeps its own way. */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r3 = (v) => Math.round(v * 1000) / 1000;

/** the way from scene point `a` to `b` ({ x, y } or [x, y]); null when they are closer than `min` px. -> { ux, uy } | null */
export function wayOf(a, b, min = 1) {
  const P = (q) => (Array.isArray(q) ? { x: Number(q[0]), y: Number(q[1]) } : q ? { x: Number(q.x), y: Number(q.y) } : null);
  const p = P(a), q = P(b);
  if ( !p || !q || ![p.x, p.y, q.x, q.y].every(Number.isFinite) ) return null;
  return unitWay(q.x - p.x, q.y - p.y, min);
}
/** a vector as a way; null when shorter than `min`. -> { ux, uy } | null */
export function unitWay(dx, dy, min = 1e-6) {
  const d = Math.hypot(dx, dy);
  if ( !Number.isFinite(d) || !(d >= min) ) return null;
  return { ux: r3(dx / d), uy: r3(dy / d) };
}
export const backWay = (w) => (w ? { ux: -w.ux || 0, uy: -w.uy || 0 } : null);
/** a way's angle in degrees (0 right, 90 down) */
export const degOf = (w) => r3((Math.atan2(w.uy, w.ux) * 180) / Math.PI);
/** the engine's `from` for a way: the angle the sound comes FROM (the opposite side), in (-180, 180] */
export function fromOf(w) {
  if ( !w ) return null;
  let a = degOf(w) + 180;
  while ( a > 180 ) a -= 360;
  while ( a <= -180 ) a += 360;
  return r3(a);
}
/** |ux| under this: a mostly vertical way (no grow, the word's own tilt kept) */
export const VERT = 0.3;
/** how hard a way leans a word: the main word of a page (big: a lean reads at once) and the smaller words round it.
    tilt = the most (deg), k = the share of the way's angle off the horizontal, climb = a flat way's rise toward where it goes (deg) */
export const LEAN = Object.freeze({ main: Object.freeze({ tilt: 10, k: 0.4, climb: 4, taper: 2 }), sec: Object.freeze({ tilt: 16, k: 0.55, climb: 5, taper: 2 }) });
/** the word's tilt for a way (deg, positive = clockwise on screen), or `own` for a mostly vertical way */
export function tiltOf(w, own = 0, lean = LEAN.sec) {
  if ( !w || Math.abs(w.ux) < VERT ) return own;
  const s = Math.sign(w.ux), deg = (Math.asin(clamp(w.uy, -1, 1)) * 180) / Math.PI;
  return Math.round(clamp(s * lean.k * deg - s * lean.climb * (1 - Math.abs(w.uy)) ** (lean.taper ?? 1), -lean.tilt, lean.tilt));
}
/** the engine's reading-direction sign (+1 its own sideways motions go right, -1 left); null for a mostly vertical way */
export const signOf = (w) => (!w || Math.abs(w.ux) < VERT ? null : w.ux < 0 ? -1 : 1);
/** the look a way gives a word: { from (deg), rotation (deg), dir? } - merged into its play options on the TABLE (measured and placed
    with it, the same on every seat) */
export function lookOf(w, own = 0, lean = LEAN.sec) {
  if ( !w ) return null;
  const o = { from: fromOf(w), rotation: tiltOf(w, own, lean) }, sg = signOf(w);
  if ( sg != null ) o.dir = sg;
  return o;
}

/* ---------------------------------------------------------------- the knock */

/** The knock in cap heights and ms. `main`: a page's big word (its cap is a tenth of the view and more: a share of it is already far);
    `sec`: the smaller words (debris, shrapnel, a bite), thrown as far as the token reactions' words (plus-ultra DIRECT2). */
export const KNOCK = Object.freeze({
  main: Object.freeze({ back: 0.9, fly: 300, over: 0.24, settle: 220, drift: 0.55, outD: 1.4, outMs: 340 }),
  sec: Object.freeze({ back: 1.5, fly: 280, over: 0.35, settle: 200, drift: 0.9, outD: 2.2, outMs: 340 })
});
const easeOut3 = (u) => 1 - (1 - u) ** 3, easeIO = (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));
/**
 * The knock's distance along the way (cap heights; < 0 = back toward where the event came from) at `t` ms since the word's start.
 * contact = ms from its start to its contact; holdEnd = ms from its start to its exit; fit = { kb, kv, kf, ko } (knockFit: this seat's
 * shares of the back, the overshoot, the standing slide and the exit throw; 1 = whole, kb may pass 1 - a seat with no room ahead
 * starts further back, so the word still travels).
 */
export function knockS(t, { K = KNOCK.sec, contact = 0, holdEnd = 0, fit = null } = {}) {
  const kb = fit?.kb ?? 1, kf = fit?.kf ?? 1, kv = fit?.kv ?? kf, ko = fit?.ko ?? 1;
  const c = Math.max(0, contact), a = c + K.fly, b = a + K.settle, he = Math.max(b, holdEnd), d0 = K.drift * 0.1 * kf;
  const back = -K.back * kb, over = Math.max(K.over * kv, d0), drift = K.drift * kf;
  if ( !Number.isFinite(t) || t <= c ) return back;
  if ( t < a ) return back + (over - back) * easeOut3((t - c) / K.fly);
  if ( t < b ) return over + (d0 - over) * easeIO((t - a) / K.settle);
  if ( t < he ) return d0 + (drift - d0) * (1 - (1 - (t - b) / Math.max(1, he - b)) ** 2);
  return drift + K.outD * ko * Math.min(1, (t - he) / K.outMs) ** 2;
}
/** where the knocked word stands off its place at t, in cap heights. -> { x, y } */
export function knockAt(w, t, o = {}) {
  if ( !w || o.reduced || !Number.isFinite(t) ) return { x: 0, y: 0 };
  const s = knockS(t, o);
  return { x: r3(s * w.ux), y: r3(s * w.uy) };
}
const inter = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const move = (b, dx, dy) => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
/**
 * How far (px, 0..dist) a word's `box` may go along (ux, uy) on a seat: it stays whole inside `view` (a box already past an edge is not
 * moved further out), covers no `blocks` box (panels, pins, tokens, words up) more than it does at its place, and no more of `wall` (the
 * thing it letters). The first step that breaks a rule stops it (it never jumps over a panel). -> px
 */
export function roomAlong(box, ux, uy, dist, { view = null, blocks = [], wall = null, steps = 16 } = {}) {
  if ( !box || !(dist > 0) ) return 0;
  const base = blocks.map((q) => inter(box, q) + 0.5), wall0 = wall ? inter(box, wall) + 0.5 : 0;
  const out = (b) => (view ? Math.max(0, view.x0 - b.x0) + Math.max(0, b.x1 - view.x1) + Math.max(0, view.y0 - b.y0) + Math.max(0, b.y1 - view.y1) : 0), out0 = out(box) + 0.5;
  const bad = (d) => { const b = move(box, ux * d, uy * d); return out(b) > out0 || (wall && inter(b, wall) > wall0) || blocks.some((q, i) => inter(b, q) > base[i]); };
  let lo = 0;
  for ( let i = 1; i <= steps; i++ ) { const d = (dist * i) / steps; if ( bad(d) ) { let hi = d; for ( let j = 0; j < 8; j++ ) { const m = (lo + hi) / 2; if ( bad(m) ) hi = m; else lo = m; } return lo; } lo = d; }
  return dist;
}
/**
 * THIS seat's shares of a knock: `box` the word's box as this seat stands it (the seat layout's), `cap` its cap height there (the same
 * units), `w` the way, `K` the knock; `view`, `blocks` (this seat's panels, the pins, the words up with it), `wall` (the thing it
 * letters), `edge` (the panels and the pins).
 * - the standing slide (the word is READ there, for its whole hold) keeps clear of every block and goes no further onto the wall when
 *   it heads for the wall's middle (a word astride its blast sliding on, away from the middle, is leaving it);
 * - the back and the overshoot are the word's way IN (half a second): they stay inside the view and off `edge` (MAPEDGE: a map word
 *   is never on a panel - live 2026-11-16, let over them a player's blast word began on a tracker card), but pass the words up;
 * - a seat with no room ahead starts the word further BACK by what the slide lost (kb > 1), so it travels as far on every seat;
 * - the exit's throw (the word is leaving) keeps clear of the view's edge and `edge`.
 * -> { kb, kv, kf, ko }: kv, kf, ko 0..1, kb 0..1 + drift / back
 */
export function knockFit(box, cap, w, K, { view = null, blocks = [], edge = null, wall = null } = {}) {
  if ( !box || !w || !(cap > 0) ) return { kb: 0, kv: 0, kf: 0, ko: 0 };
  const share = (got, want) => (want > 0 ? r3(clamp(got / want, 0, 1)) : 1);
  const fwd = K.drift * cap, over = K.over * cap, out = K.outD * cap;
  const mid = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  const toward = wall ? ((mid(wall)[0] - mid(box)[0]) * w.ux + (mid(wall)[1] - mid(box)[1]) * w.uy > 0) : false;
  const kf = share(roomAlong(box, w.ux, w.uy, fwd, { view, blocks, wall: toward ? wall : null }), fwd);
  const kv = share(roomAlong(box, w.ux, w.uy, over, { view, blocks: edge ?? blocks }), over);
  const back = (K.back + K.drift * (1 - kf)) * cap;
  const kb = r3(roomAlong(box, -w.ux, -w.uy, back, { view, blocks: edge ?? blocks }) / (K.back * cap));
  const at = move(box, w.ux * K.drift * kf * cap, w.uy * K.drift * kf * cap);
  const ko = share(roomAlong(at, w.ux, w.uy, out, { view, blocks: edge ?? blocks, wall: null }), out);
  return { kb, kv, kf, ko };
}
/** the farthest a whole knock takes a word, in cap heights per side of its place (for checks) */
export function knockReach(w, K = KNOCK.sec) {
  if ( !w ) return { l: 0, r: 0, u: 0, d: 0 };
  const B = K.back + K.drift;      // (the furthest back: a seat with no room ahead)
  const xs = [-B * w.ux, (K.drift + K.outD) * w.ux], ys = [-B * w.uy, (K.drift + K.outD) * w.uy];
  return { l: r3(Math.max(0, -Math.min(...xs))), r: r3(Math.max(0, Math.max(...xs))), u: r3(Math.max(0, -Math.min(...ys))), d: r3(Math.max(0, Math.max(...ys))) };
}

/* ---------------------------------------------------------------- streams (a gun) */

/** how much of the screen-up side of the aim is mixed into a gun's syllables' flight (0 = straight down the aim: onto the rounds'
    line and the tokens on it; the old report flew square to the aim and told nothing of where it fired) */
export const STREAM_UP = 0.6;
/**
 * The direction (deg, 0 right, 90 down) a gun's syllables fly for an aim (ax, ay): along the aim, slanted to its screen-up side - the
 * report at the barrel and the impacts at the target fly the SAME slant, so the two streams draw one line from the shooter through the
 * target and on. null without an aim.
 */
export function streamDir(ax, ay, up = STREAM_UP) {
  const w = unitWay(ax, ay);
  if ( !w ) return null;
  const [px, py] = -w.ux < 0 || (w.ux === 0 && w.uy > 0) ? [w.uy, -w.ux] : [-w.uy, w.ux];     // (the normal that points up the screen)
  return Math.round((Math.atan2(w.uy + py * up, w.ux + px * up) * 180) / Math.PI);
}

/* ---------------------------------------------------------------- wind */

/** a fire stroke's wind as a vector (wd deg: 0 right, 90 down; ws 0..1): fire/model.mjs windVec */
export const windOf = (st) => { const a = ((Number(st?.wd) || 0) * Math.PI) / 180, s = clamp(Number(st?.ws) || 0, 0, 1); return [r3(Math.cos(a) * s), r3(Math.sin(a) * s)]; };
/** wind under this is still air (the word rises as before) */
export const WIND_MIN = 0.08;
/** how far a full wind carries a rising word sideways (grid squares) and how much of its rise it flattens */
export const WIND_DRIFT = Object.freeze({ side: 1.5, down: 0.5, flat: 0.35 });
/**
 * Where a word that rises off its place (steam, a dying fire's hiss) drifts to, in grid squares from its place: `still` = [sideways, up]
 * in still air (sfx-table DRIFT), `wind` = [wx, wy]. Downwind, a little flatter the harder it blows. -> [dx, dy] (dy < 0 = up)
 */
export function driftTo(still, wind = null) {
  const wx = Number(wind?.[0]) || 0, wy = Number(wind?.[1]) || 0, s = Math.hypot(wx, wy);
  if ( !(s >= WIND_MIN) ) return [still[0], -still[1]];
  return [r3(wx * WIND_DRIFT.side), r3(-still[1] * (1 - WIND_DRIFT.flat * Math.min(1, s)) + wy * WIND_DRIFT.down)];
}
/** the most the wind turns a burning fire's sparks and tail off straight up (deg) */
export const PLUME_MAX = 40;
/** The direction (deg, 0 right, 90 down) a burning fire's sparks and trailing tail leave: up, turned downwind (the flames' own lean:
    fire/model.mjs plumeDir), at most PLUME_MAX off the vertical; -90 in still air. */
export function plumeDeg(wind = null) {
  const wx = Number(wind?.[0]) || 0, wy = Number(wind?.[1]) || 0;
  if ( !(Math.hypot(wx, wy) >= WIND_MIN) ) return -90;
  const up = 1 - wy * 1.6, off = up > 1e-6 ? (Math.atan2(wx * 1.6, up) * 180) / Math.PI : Math.sign(wx) * 90;     // (off the vertical, + = to the right)
  return Math.round(-90 + clamp(off, -PLUME_MAX, PLUME_MAX));
}
