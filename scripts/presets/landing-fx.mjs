/**
 * DESTRUCTION PRESETS, the SUPERHERO LANDING's accents - the pure part (no Foundry, no PIXI: node-tested in dev/presets-landing.test.mjs;
 * drawn by accents.mjs through accents-core.mjs draw / spanOf). dev/presets-design.md section 18:
 *   landing  the approach from the sky: the hero drops onto the mark, falling screen-down faster and faster (lifted by the view
 *            angle), a dark compact body lit from the top left with a pale streak of torn air behind it and speed lines beside it
 *            (a glint at night); with a drag it dives in at a slant along the firing's direction; landing ON a token (rec.tok) draws no
 *            body - the token is the hero - only the streak coming down onto it. Under it a small shadow tightens and darkens.
 *   airRing  the moment of the impact: a white-hot pin of a flash, then the air thrown out - a broken ring of pale arcs racing out
 *            over the ground (squashed by the view), slowing, thinning and dropping out pixel by pixel - and a slower, lower ring of
 *            the ground's own dust behind it. No fire, no glow of heat.
 * Art pixels on the destruction layer's art grid (ap scene px, origin ox / oy), the palette of accents-core.mjs (PAL indices), ends by
 * hashed dropout - never a soft blur, never a square, never a full circle. A frame is a pure function of (item, time).
 */

/** accents-core PAL indices this file uses. */
const WHITE = 0, PALE = 5, IRON = 6, METAL = 7, DUST = 9;
/** The approach: the hero falls from FALL_Z squares (z ~ (1 - u)^2: faster and faster), diving FALL_D squares along the direction
 * with a drag; seen below FALL_SHOW squares; the shadow shrinks from SHADOW_R[0] to SHADOW_R[1] squares. */
export const FALL_Z = 30, FALL_D = 3, FALL_SHOW = 7.5, SHADOW_R = [1.05, 0.3];
/** The body (squares): length along the fall and width; the streak of air behind it (squares, at most). */
export const BODY_L = 0.36, BODY_W = 0.13, STREAK_MAX = 4.2;
/** The air ring: its reach (squares at size 1), the time constant of its slowing (ms), its life (ms); the dust ring's share of the
 * reach, delay and life; the impact pin's life (ms). */
export const RING_REACH = 2.5, RING_TAU = 120, RING_MS = 560, DUST_K = 0.62, DUST_DELAY = 50, DUST_MS = 900, PIN_MS = 90;
export const LANDING_KINDS = ["landing", "airRing"];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
/** A small hash in [0, 1) of three integers (the same as accents-core h3: the same on every machine). */
export function h3(a, b, c) {
  let t = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const cellOf = (v, o, ap) => Math.floor((v - o) / ap);
const scr = (env, x, y, z) => [cellOf(x, env.ox, env.ap), cellOf(y - (env.lift ?? 0.5) * z, env.oy, env.ap)];

/** The time span (ms from T0) of an item of this file, or null when it is not one. */
export function landingSpan(item) {
  const at = Number(item?.at) || 0;
  if ( item?.kind === "landing" ) return item.dur > 0 ? [at, at + item.dur] : null;
  if ( item?.kind === "airRing" ) return [at, at + Math.max(RING_MS, DUST_DELAY + DUST_MS)];
  return null;
}

/** Draw an item of this file at t (ms from T0) into frame F (accents-core newFrame). Returns false when it is not one. */
export function landingDraw(it, t, env, F, seed) {
  if ( it.kind === "landing" ) { approach(it, t, env, F, seed); return true; }
  if ( it.kind === "airRing" ) { airRing(it, t - (Number(it.at) || 0), env, F, seed); return true; }
  return false;
}

/** A soft ground shadow: an ellipse (radius r scene px, squashed), dense in the middle, dithered out in two steps (as the bomb's). */
function shadow(F, env, x, y, r, dens) {
  if ( !(dens > 0.01) || !(r > 0) ) return;
  const ap = env.ap, rx = Math.max(1, r / ap), ry = Math.max(1, rx * (env.squash ?? 0.8)), [cx, cy] = scr(env, x, y, 0);
  const X = Math.ceil(rx), Y = Math.ceil(ry);
  for ( let j = -Y; j <= Y; j++ ) for ( let i = -X; i <= X; i++ ) {
    const e = Math.hypot((i + 0.5) / rx, (j + 0.5) / ry); if ( e >= 1 ) continue;
    // (two flat steps - a dark core, a light penumbra - their borders broken by a narrow dithered band: a clean soft shape, no
    // speckle and no chequered blob)
    const v = dens * (1 - smooth(0.1, 1, e)) + (h3(cx + i, cy + j, 91) - 0.5) * 0.12;
    if ( v > 0.42 ) F.shade[1].push(cx + i, cy + j); else if ( v > 0.12 ) F.shade[0].push(cx + i, cy + j);
  }
}

/**
 * The APPROACH: where the hero is at u (0..1 of the fall) - ground point (x, y) and height z (scene px) - and its screen velocity
 * (art px per ms: the drift squashed, the fall lifted).
 */
export function fallAt(it, u, env) {
  const g = env.grid, k = 1 - clamp01(u), d = Array.isArray(it.dir) ? it.dir : [0, 0], D = FALL_D * g;
  const sq = env.squash ?? 0.8, lift = env.lift ?? 0.5, dur = Math.max(1, it.dur);
  return { x: it.x - d[0] * D * k, y: it.y - d[1] * D * k, z: FALL_Z * g * k * k,
    vx: d[0] * D / dur / env.ap, vy: (d[1] * D * sq + lift * 2 * FALL_Z * g * k) / dur / env.ap };
}

function approach(it, t, env, F, seed) {
  const g = env.grid, u = clamp01((t - it.at) / Math.max(1, it.dur)); if ( u >= 1 ) return;
  const P = fallAt(it, u, env), ap = env.ap;
  shadow(F, env, P.x, P.y, g * (SHADOW_R[1] + (SHADOW_R[0] - SHADOW_R[1]) * (1 - u)), smooth(0, 0.25, u) * (0.16 + 0.72 * Math.pow(u, 1.5)));
  if ( P.z > FALL_SHOW * g ) return;
  const vl = Math.hypot(P.vx, P.vy) || 1, ax = P.vx / vl, ay = P.vy / vl, nx = -ay, ny = ax;
  const [cx, cy] = scr(env, P.x, P.y, P.z);
  const hl = Math.max(3, 0.5 * BODY_L * g / ap), hw = Math.max(1.6, 0.5 * BODY_W * g / ap);
  // the STREAK of torn air behind it: a 3-px core (white at the body, pale behind), dithered to its end, longer the faster it falls;
  // speed lines beside it, shorter, broken (fading in as it comes: at the top of its fall it is a faint far streak)
  const appear = smooth(FALL_SHOW, FALL_SHOW * 0.55, P.z / g);
  const sl = Math.min(STREAK_MAX * g / ap, (1.5 + vl * 55) * hl) * (0.45 + 0.55 * appear);
  const tail = it.tok ? 0 : hl * 0.7;
  const bx = cx - ax * tail, by = cy - ay * tail;
  for ( let s = 0; s <= sl; s++ ) {
    // a 2-px core (it reads at zoom 0.6), white at the body, pale behind, broken more and more towards its end; a pale flank each
    // side only near the body (the air torn widest there), dithered - a streak of air, never a solid rod
    const f = s / sl, px = Math.round(bx - ax * s), py = Math.round(by - ay * s);
    if ( h3(s, seed, 5) > 0.3 + 0.7 * appear ) continue;
    const keep = f < 0.3 ? 1 : h3(s, seed, 4) < 1.15 * (1 - f) * (1 - f) + 0.08;
    const c = f < 0.1 ? WHITE : PALE;
    if ( keep ) { F.px[c].push(px, py); if ( f < 0.6 && (f < 0.3 || h3(s, seed, 9) < 0.6) ) F.px[c].push(Math.round(px + nx), Math.round(py + ny)); }
    const fl = f < 0.08 ? 1 : f < 0.35 ? h3(s, seed, 6) < 0.75 * (1 - f / 0.35) : 0;
    if ( fl ) {
      if ( h3(s, seed, 7) < 0.85 ) F.px[f < 0.15 ? PALE : DUST].push(Math.round(px + 2 * nx), Math.round(py + 2 * ny));
      if ( h3(s, seed, 8) < 0.85 ) F.px[f < 0.15 ? PALE : DUST].push(Math.round(px - nx), Math.round(py - ny));
    }
  }
  for ( let k = 0; k < 4; k++ ) {
    const side = (k & 1 ? 1 : -1) * (3.5 + 2.5 * h3(k, seed, 6) + (k >> 1) * 2.5), s0 = hl * (0.6 + 1.2 * h3(k, seed, 7)), L = sl * (0.25 + 0.35 * h3(k, seed, 8)) * appear;
    for ( let s = 0; s < L; s++ ) {
      if ( (s + k) % 3 === 2 ) continue;
      const px = Math.round(bx - ax * (s0 + s) + nx * side), py = Math.round(by - ay * (s0 + s) + ny * side);
      F.px[s / L < 0.5 ? PALE : DUST].push(px, py);
    }
  }
  if ( it.tok ) {
    // (landing on a token: the token is the hero - a white-hot point at the streak's head, no body of its own)
    F.px[WHITE].push(cx, cy, cx + 1, cy, cx, cy + 1, cx + 1, cy + 1);
    return;
  }
  // the BODY: a compact dark capsule along the fall (fists first: a little narrower at the leading end), lit from the top left
  const R = Math.ceil(hl + 2);
  for ( let j = -R; j <= R; j++ ) for ( let i = -R; i <= R; i++ ) {
    const px = i + 0.5, py = j + 0.5, al = px * ax + py * ay, ac = px * nx + py * ny;
    if ( Math.abs(al) > hl ) continue;
    const w = hw * (al > 0 ? Math.sqrt(Math.max(0, 1 - (al / hl) ** 2)) * 0.85 + 0.15 : 1 - 0.3 * clamp01(-al / hl - 0.6));
    if ( Math.abs(ac) >= w ) continue;
    const lit = (px * -0.7 + py * -0.7) > 0.35 * hw && Math.abs(ac) > w - 1.2;
    F.px[lit ? METAL : IRON].push(cx + i, cy + j);
  }
}

/**
 * The IMPACT: the white-hot pin of the blow, the AIR RING (broken pale arcs racing out, slowing, dropping out) and the DUST RING
 * behind it (slower, lower, the ground's tone). `t` ms after the impact; it.reach (squares) x it.size.
 */
function airRing(it, t, env, F, seed) {
  if ( t < 0 ) return;
  const g = env.grid, ap = env.ap, sz = it.size ?? 1, reach = (it.reach ?? RING_REACH) * sz * g, sq = env.squash ?? 0.8;
  const [cx, cy] = scr(env, it.x, it.y, 0);
  // the PIN of the blow: a white-hot point and a tiny burst of four pixels for a moment (no cross: a cross reads as a crosshair)
  if ( t < PIN_MS ) {
    F.px[WHITE].push(cx, cy, cx + 1, cy, cx, cy + 1, cx + 1, cy + 1);
    if ( t < PIN_MS * 0.5 ) F.px[PALE].push(cx - 1, cy - 1, cx + 2, cy - 1, cx - 1, cy + 2, cx + 2, cy + 2);
  }
  ring(F, cx, cy, reach / ap, sq, t, RING_MS, RING_TAU, seed, 0);
  ring(F, cx, cy, reach * DUST_K / ap, sq, t - DUST_DELAY, DUST_MS, RING_TAU * 2.2, seed + 17, 1);
}

/** One broken ring: radius R (art px) reached with a time constant tau; arcs (hashed gaps), 2 px thick early, dropping out over its life. */
function ring(F, cx, cy, R, sq, t, life, tau, seed, dust) {
  if ( t < 0 || t >= life || !(R > 2) ) return;
  const f = t / life, r = R * (1 - Math.exp(-t / tau)) / (1 - Math.exp(-life / tau));
  if ( r < 1.5 ) return;
  const nSeg = 12 + Math.floor(h3(seed, 1, 41) * 7), a0 = h3(seed, 2, 41) * 6.2832;
  const steps = Math.max(24, Math.ceil(r * 6.2832 * 1.2)), drop = Math.pow(f, 1.4) * (dust ? 1 : 1.05);
  const thick = dust ? (f < 0.5 ? 2 : 1) : (f < 0.35 ? 2 : 1);
  const seen = new Set();
  for ( let s = 0; s < steps; s++ ) {
    const a = a0 + s / steps * 6.2832, seg = Math.floor(s / steps * nSeg);
    // (gaps: a quarter of the arcs missing, a few more as it thins; each arc a little in or out of round)
    if ( h3(seg, seed, 43) < (dust ? 0.3 : 0.24) + 0.25 * f ) continue;
    const wob = 1 + (h3(seg, seed, 44) - 0.5) * 0.12;
    for ( let k = 0; k < thick; k++ ) {
      const rr = r * wob - k, x = Math.round(cx + Math.cos(a) * rr), y = Math.round(cy + Math.sin(a) * rr * sq);
      const key = (x + 4096) * 8192 + (y + 4096);
      if ( seen.has(key) ) continue;
      seen.add(key);
      if ( h3(x, y, seed + 45) < drop ) continue;
      F.px[dust ? DUST : (k === 0 ? (f < 0.25 ? WHITE : PALE) : DUST)].push(x, y);
    }
  }
}
