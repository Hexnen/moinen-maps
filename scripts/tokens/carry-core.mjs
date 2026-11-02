/**
 * CARRY A TOKEN WITH A DESTRUCTION STROKE: the pure parts (no PIXI, no canvas, no game), so node tests can run them.
 *
 * The gesture: with the destruction brush, the first pointer-down of a stroke lands on a token and the stroke is a DRAG. The stroke is
 * recorded as ever; it also keeps `tk` (a field of the stroke object, beside `p`, `c`, `pr`):
 *   tk = { id: tokenId, x0, y0: the token's top-left when it was grabbed (scene px), x1, y1: where the carry ends it (scene px),
 *          e: 0 the token really moves there | 1 it returns, p: [x, y, ms, x, y, ms, ...] the brush path in ART px (as `p`) }
 * `tk` is NOT part of the stroke's signature (store.mjs objStr reads fixed fields), so it never changes baked pixels or chunk ids; an
 * older client keeps the field in the flag and ignores it. (The path lives in tk.p and not in `p`, because a stroke's `p` shapes the
 * bake of a stroke that follows its path.)
 *
 * Playback: the token's DISPLAY position at time `el` (ms after the entry's front starts) is the brush path point where the entry's front
 * is at `el` (the same pathTimes clock as the entry: entry-clock.mjs), moved by the grab offset.
 */
import { pathTimes } from "../destruction/entry-clock.mjs";

export const DRAG_PX = 8;          // a press that moves less than this (screen px) is a click
export const MIN_PATH = 12;        // a path shorter than this (art px) is a tap (entry-clock pathTimes: radial)
export const PICK_MS = 140;        // the lift-off at the start of a carry
export const LAND_MS = 260;        // the landing (a damped squash) after the path ends
export const GLIDE_MS = 380;       // the glide from the path end to where the token really is (returning, or a late hand-over)
export const HOLD_RETURN_MS = 380; // a returning token waits this long at the path end
export const WAIT_MS = 1000;       // a token waits at most this long for its document to reach the real target (a hand-over that never comes must not hold it for ever)

const clamp = (v, a, b) => v < a ? a : v > b ? b : a > b ? a : v;
export const ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

/** A press that went `dist` screen px away from where it began in `ms`: "drag" | "click". */
export function classifyPress(dist, ms = 0) {
  return dist >= DRAG_PX && !(ms < 0) ? "drag" : "click";
}

/**
 * The token under a point. `list`: [{ id, x, y, w, h, elevation, sort, locked, visible, hidden }] (scene px; the placeables' data).
 * Locked and invisible ones are skipped; the topmost wins (higher elevation, then higher sort, then the later in the list).
 * `gm`: the GM sees hidden tokens too (the placeable's `visible` already says what this client sees; `hidden` is only informative).
 */
export function pickToken(list, pt) {
  let best = null;
  for ( let i = 0; i < list.length; i++ ) {
    const t = list[i];
    if ( !t || t.locked || t.visible === false ) continue;
    if ( pt.x < t.x || pt.y < t.y || pt.x >= t.x + t.w || pt.y >= t.y + t.h ) continue;
    if ( !best || (t.elevation ?? 0) > (best.elevation ?? 0) || ((t.elevation ?? 0) === (best.elevation ?? 0) && (t.sort ?? 0) >= (best.sort ?? 0)) ) best = t;
  }
  return best ? best.id : null;
}

/** The flat [x, y, ms, ...] path as [[x, y, ms], ...]. */
export function unflatPath(p) { const out = []; for ( let i = 0; p && i + 2 < p.length; i += 3 ) out.push([p[i], p[i + 1], p[i + 2]]); return out; }

/** Path length (art px). */
export function pathLength(path) { let l = 0; for ( let i = 1; i < path.length; i++ ) l += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); return l; }

/** Is `tk` a usable carry record? */
export function validTk(tk) {
  return !!tk && typeof tk === "object" && typeof tk.id === "string" && tk.id.length > 0 && [tk.x0, tk.y0, tk.x1, tk.y1].every(Number.isFinite)
    && Array.isArray(tk.p) && tk.p.length >= 6 && tk.p.length % 3 === 0 && tk.p.every(Number.isFinite);
}

/**
 * The carry's timeline: the path in scene px (`ap` scene px per art px, (ox, oy) the scene rect's corner), the time each point is
 * reached (ms after the front starts; pathTimes, so the very clock of the entry), and the displacement from the first point.
 * `k` the entry clock's factor (1 / speed * cause slow). Null for a tap.
 */
export function buildTimeline(tk, { ap = 1, ox = 0, oy = 0, k = 1 } = {}) {
  if ( !validTk(tk) ) return null;
  const path = unflatPath(tk.p), P = pathTimes(path, k);
  if ( !P ) return null;
  const n = P.pts.length, X = new Float64Array(n), Y = new Float64Array(n);
  for ( let i = 0; i < n; i++ ) { X[i] = ox + P.pts[i][0] * ap; Y[i] = oy + P.pts[i][1] * ap; }
  return { n, X, Y, tt: Float64Array.from(P.tt), D: P.D, x0: X[0], y0: Y[0], dx: X[n - 1] - X[0], dy: Y[n - 1] - Y[0], i: 0 };
}

/**
 * The displacement of the carried token from its grab point at `el` ms (clamped to the run) and the unit direction of travel there,
 * written into `out` ({ x, y, ux, uy, sp }); `sp` 0..1 is how fast it is going (relative to `ref` scene px per second).
 * No allocation (the timeline keeps a cursor).
 */
export function displacementAt(tl, el, out, ref = 800) {
  const { n, X, Y, tt } = tl;
  let i = tl.i;
  const e = clamp(el, tt[0], tt[n - 1]);
  if ( i < 1 || i > n - 1 || tt[i - 1] > e ) i = 1;
  while ( i < n - 1 && tt[i] < e ) i++;
  tl.i = i;
  const t0 = tt[i - 1], t1 = tt[i], f = t1 > t0 ? (e - t0) / (t1 - t0) : 1;
  out.x = X[i - 1] + (X[i] - X[i - 1]) * f - tl.x0;
  out.y = Y[i - 1] + (Y[i] - Y[i - 1]) * f - tl.y0;
  // the direction: of the segment, smoothed with the neighbours one segment each side (the path is a hand's)
  const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 1);
  let vx = X[b] - X[a], vy = Y[b] - Y[a];
  const l = Math.hypot(vx, vy);
  if ( l > 1e-6 ) { vx /= l; vy /= l; } else { vx = 0; vy = 0; }
  out.ux = vx; out.uy = vy;
  const dt = (tt[b] - tt[a]) || 1;
  out.sp = el < tt[0] || el > tt[n - 1] ? 0 : clamp((l / dt) * 1000 / ref, 0, 1);
  return out;
}

/**
 * The token's pose at `el` ms (after the front starts; the run lasts `D`): written into `out` { sx, sy, rot, lift, k }.
 *  lift-off (anticipation: a quick squash, then up), flight (leaning and stretched along the travel, a little arc), landing (a damped
 *  squash and wobble). `S` the token's footprint height (scene px), `d` the displacement { ux, uy, sp }.
 */
export function poseAt(el, D, d, S, out) {
  out.sx = 1; out.sy = 1; out.rot = 0; out.lift = 0; out.k = 0;
  if ( el <= 0 ) return out;
  const pk = ease(el / PICK_MS);
  if ( el < D ) {
    const sp = d.sp * pk, ux = Math.abs(d.ux), uy = Math.abs(d.uy);
    const squash = el < PICK_MS * 0.45 ? -0.14 * Math.sin(el / (PICK_MS * 0.45) * Math.PI) : 0;       // anticipation
    out.sx = 1 + sp * (0.2 * ux - 0.09 * uy) - squash * 0.5;
    out.sy = 1 + sp * (0.2 * uy - 0.09 * ux) + squash;
    out.rot = 0.32 * sp * d.ux;
    out.lift = -S * (0.1 * pk + 0.06 * sp);
    out.k = 1;
    return out;
  }
  const u = (el - D) / 1000;                                 // seconds after landing
  const e = Math.exp(-11 * u), q = -0.22 * e * Math.cos(30 * u);
  out.sy = 1 + q; out.sx = 1 / Math.sqrt(Math.max(0.3, out.sy));
  out.rot = 0.12 * e * Math.sin(40 * u) * (d.ux >= 0 ? 1 : -1);
  out.lift = -S * 0.1 * Math.exp(-28 * u);
  out.k = e > 0.02 ? 1 : 0;
  return out;
}

/**
 * Where the carry's offset stands at `el` (ms after the front starts): the share of the offset (token on the path) that is left: 1 on
 * the path and during the landing, then it glides to 0; `mode` "real" waits at the path end until the token really is there (`arrived`).
 * Returns { w, done } with w in 0..1.
 */
export function weightAt(el, D, mode, arrived, waited = 0) {
  const after = el - D;
  if ( after < 0 ) return { w: 1, done: false };
  const hold = mode === "return" ? HOLD_RETURN_MS : LAND_MS;
  if ( after < hold ) return { w: 1, done: false };
  if ( mode !== "return" && !arrived && waited < 1000 ) return { w: 1, done: false };
  const g = (after - hold - (mode !== "return" ? Math.min(waited, WAIT_MS) : 0)) / GLIDE_MS;       // (the wait is capped: a document that never arrives glides home after WAIT_MS, it never holds the token for ever)
  if ( g >= 1 ) return { w: 0, done: true };
  return { w: 1 - ease(g), done: false };
}

/**
 * The offset of a carried (or pushed) token from where Foundry has it, at `o.now` / `o.el` (the carrier's clock), written into `out` { x, y, w, done }.
 * `st` { waitFrom, arrivedAt } is the hand-over's state (kept by the caller). `o`: { now, el, D (the carrier's run), mode, bx, by (where Foundry has the
 * token's centre now), tx, ty (where the document is going to be: the RECORDED final, snapped or not), c0x, c0y (the grab / contact centre), dx, dy
 * (the displacement on the path at `el`) }.
 *  - "arrived" is judged against the real target (tx, ty), never the raw path end (a snapped carry, a pushed token resolved off its path end).
 *  - A document that is already at the target while the ride has not begun here (a remote client whose GM moved it first; a replay) holds the
 *    token ON THE RIDE from the start: at the grab point until its own front starts, then along the path (no jump to the end and back).
 *  - Past D + hold + WAIT_MS + GLIDE_MS the offset is gone whatever happened: a Carry cannot stay active for ever.
 */
export function offsetAt(st, o, out) {
  const after = o.el - o.D, hold = o.mode === "return" ? HOLD_RETURN_MS : LAND_MS;
  const arrived = Math.abs(o.bx - o.tx) < 3 && Math.abs(o.by - o.ty) < 3;
  if ( o.mode !== "return" && after >= hold ) {
    if ( !st.waitFrom ) st.waitFrom = o.now;
    if ( arrived && !st.arrivedAt ) st.arrivedAt = o.now;
  }
  const waited = st.waitFrom ? (st.arrivedAt || o.now) - st.waitFrom : 0;
  const w = weightAt(o.el, o.D, o.mode, arrived, waited);
  const over = after > hold + WAIT_MS + GLIDE_MS + 400;
  out.w = w.w; out.done = w.done || over;
  const atTarget = o.mode !== "return" && arrived && Math.hypot(o.tx - o.c0x, o.ty - o.c0y) > 3 && after < hold;
  const ws = atTarget ? 1 : startWeight(o.el);
  out.x = ((o.c0x - o.bx) * ws + o.dx) * w.w;
  out.y = ((o.c0y - o.by) * ws + o.dy) * w.w;
  return out;
}

/** The share of the grab offset (where the token is vs where it was grabbed) that has been taken in `el` ms into the run: a lift-off blend. */
export const startWeight = (el) => ease(el / PICK_MS);

/** Snap a top-left (scene px) so the token's centre is at the centre of a grid cell of size `grid` (offset (gx, gy)). */
export function snapCentre(x, y, w, h, grid, gx = 0, gy = 0) {
  const cx = x + w / 2, cy = y + h / 2;
  const sx = gx + (Math.floor((cx - gx) / grid) + 0.5) * grid, sy = gy + (Math.floor((cy - gy) / grid) + 0.5) * grid;
  return [Math.round(sx - w / 2), Math.round(sy - h / 2)];
}

/**
 * Build the `tk` record of a finished stroke. `grab` { id, x0, y0, w, h }, `a` / `b` the first / last brush point (scene px), `path` the
 * brush path in ART px ([[x, y, ms], ...], already thinned), `ends` "real" | "return", `rect` the scene rect (the token stays inside),
 * `snap` a function (x, y, w, h) -> [x, y] snapping the token's top-left, or { grid, gx, gy }, or null. Null when the path is too short to carry anything.
 */
export function makeTk({ grab, a, b, path, ends = "real", rect = null, snap = null }) {
  if ( !grab || !path || path.length < 2 || pathLength(path) < MIN_PATH ) return null;
  let x1 = grab.x0 + (b.x - a.x), y1 = grab.y0 + (b.y - a.y);
  if ( typeof snap === "function" ) [x1, y1] = snap(x1, y1, grab.w, grab.h);
  else if ( snap ) [x1, y1] = snapCentre(x1, y1, grab.w, grab.h, snap.grid, snap.gx, snap.gy);
  if ( rect ) { x1 = clamp(x1, rect.x - grab.w / 2, rect.x + rect.width - grab.w / 2); y1 = clamp(y1, rect.y - grab.h / 2, rect.y + rect.height - grab.h / 2); }
  const p = []; for ( const q of path ) p.push(q[0], q[1], q[2] | 0);
  return { id: grab.id, x0: Math.round(grab.x0), y0: Math.round(grab.y0), x1: Math.round(x1), y1: Math.round(y1), e: ends === "return" ? 1 : 0, p };
}

/* ---------------------------------------------------------------- the carried token is always in front */

/**
 * Foundry draws the primary group's objects by (elevation, sortLayer, sort). Everything the destruction shows there lives at elevation 0
 * and sortLayers below TOKEN_LAYER (display.mjs layers 247 and 249, the districts' 250, lights 251 ...); a token's mesh is at its own
 * elevation (>= 0 to be seen at all: the scene's background lies at 0) and sortLayer TOKEN_LAYER. `frontKeys` gives a carried token's mesh
 * the keys it must hold for the carry: its own elevation and `sort` (several tokens keep their order), never a sortLayer below the tokens'
 * own. `rank` (0 = a plain token) lifts the sortLayer by whole steps ABOVE every token's own, whatever its `sort`: a pushed token (RANK_PUSHED) draws over
 * all other tokens and the carrier (RANK_CARRIER) over the pushed ones. The editor's overlay and cursor, which live on the interface above every mesh, sit just under the tokens while a carry runs (OVER_KEYS).
 */
export const TOKEN_LAYER = 700;
export const OVER_KEYS = { elevation: 0, sortLayer: TOKEN_LAYER - 1, sort: 0 };
export const RANK_PUSHED = 1, RANK_CARRIER = 2;   // a held token's rank: the tokens a carrier ploughs, the carrier itself (always above every one of them)
export function frontKeys(k, rank = 0) {
  return { elevation: Number(k?.elevation) || 0, sortLayer: Math.max(Number(k?.sortLayer) || 0, TOKEN_LAYER) + Math.max(0, Math.floor(Number(rank) || 0)), sort: Number(k?.sort) || 0 };
}
/** Does `a` draw over `b` (Foundry's primary order: elevation, then sortLayer, then sort)? */
export function drawsOver(a, b) {
  const x = a.elevation ?? 0, y = b.elevation ?? 0; if ( x !== y ) return x > y;
  const l = a.sortLayer ?? 0, m = b.sortLayer ?? 0; if ( l !== m ) return l > m;
  return (a.sort ?? 0) > (b.sort ?? 0);
}
