/**
 * DESTRUCTION PRESETS, the gun ACCENTS - the pure part (no Foundry, no PIXI: node-tested in dev/presets-accents.test.mjs; drawn by
 * accents.mjs). dev/presets-design.md G7 / P5, for the two guns: what no layer draws by itself -
 *   tracer  every n-th round of each gun: a bright streak coming in from above and behind along the run (lifted by the view angle),
 *           white-hot head, yellow / orange / red tail with a dithered end, landing ON its hit; some glance off as a short spark;
 *           with a shooter on the map (gesture.from: a gunship token) it flies out of that shooter's barrel instead
 *   hitFx   at every hit: a pixel star flash (two frames), a spray of sparks thrown out and up, falling back under gravity and cooling
 *           white -> yellow -> orange -> red, a short warm ground glow (the night: it lights the ground round the hit); a rumble
 *           (the screen shake share of the hit, heavy guns)
 *   muzzle  the shooter's muzzle flash at every shot (a star stretched along the aim, a different one each shot) with its glow, and a
 *           pale bullet streak from the muzzle to its hit - only when the firing names a shooter (gesture.from: the GM's chosen
 *           source token); at the shooter's edge (gesture.fr), a twin gun's two barrels side by side; no shooter, no muzzle flash
 * Everything is ART PIXELS on the destruction layer's art grid (ap scene px, origin ox / oy): crisp at any zoom, the same language as
 * the fire's sparks and the destruction's pixel-fx; colours from one small palette, ends by dithered dropout, never a soft blur.
 * A frame is a PURE function of (the firing record's accents, T0, the shared clock): a late joiner sees whatever is still in flight.
 */

/** The palette: white-hot, yellow, orange, red, ember, pale (the bullet streak / a glint); the thrown and dropped things: iron
 * (a bomb's body), metal light (a grenade's lever), olive, dust (kicked up where a grenade lands), lit olive, dark olive (a grenade's
 * shade and its grooves). */
import { LANDING_KINDS, landingSpan, landingDraw } from "./landing-fx.mjs";   // (the superhero landing's accents: landing-fx.mjs)
import { spurts, SPURT, roundsOf, wetOf } from "./gun-fx.mjs";   // (a gun's hit spurts: gun-fx.mjs)

export const PAL = [0xfffbe8, 0xffe27a, 0xffa13a, 0xe0532a, 0x8a2e1a, 0xfff0c8, 0x27231f, 0x8d867a, 0x505b33, 0xb3a68d, 0x7f8c4c, 0x2f3720];
/** How much each palette colour lights itself at night (its emission, 0..1; 0: lit by the scene only, never by itself). */
export const GLOW = [1, 0.95, 0.78, 0.5, 0.22, 0.6, 0, 0, 0, 0, 0, 0];
/** The ground SHADOWS (a falling bomb's, a thrown grenade's): two dithered steps of a dark tone, drawn under every pixel above. */
export const SHADE = 0x120e0a, SHADE_A = [0.17, 0.36];
/** The bomb: it falls from BOMB_Z squares (gravity: z ~ (1 - u)^2), drifting BOMB_D squares along the firing's direction; seen
 * below BOMB_SHOW squares; its shadow shrinks from SHADOW_R[0] to SHADOW_R[1] squares and darkens as it comes. */
export const BOMB_Z = 14, BOMB_D = 2.2, BOMB_SHOW = 4.5, SHADOW_R = [1.45, 0.36];
/** The grenade: it lands this far (squares, at most 35 % of the throw) short of its mark and hops / rolls the rest (the bounce). */
export const BOUNCE_BACK = 0.75;
/** The screen cue: a shake of SHAKE_PX x shake screen px decaying over SHAKE_MS[0] + SHAKE_MS[1] x shake ms; a flash over FLASH_CUE_MS. */
export const SHAKE_PX = 7, SHAKE_MS = [250, 650], FLASH_CUE_MS = 210;
/** The accent kinds this layer draws. */
export const ACCENT_KINDS = ["tracer", "hitFx", "muzzle", "fallShadow", "throwArc", "bounce", ...LANDING_KINDS];
/** A tracer's visible flight (ms) before its hit, the streak's length (ms of flight), a glancing one's life (ms). */
export const TRACER_MS = 210, STREAK_MS = 85, RICO_MS = 200;
/** A tracer comes in from this far behind (squares along the run) and this high (squares) at the start of its visible flight: steep,
 * from above (the helicopter's guns are high up) - a shallow one read as a flat line across the map. */
export const TRACER_BACK = 3.2, TRACER_UP = 7.5;
/** The hit flash (ms): the big star, then the small one; the ground glow's life (ms). */
export const FLASH_MS = [55, 125], GLOW_MS = 210;
/** The muzzle flash (ms) and the bullet's speed (squares a second; the streak takes at least BULLET_MIN ms). */
export const MUZZLE_MS = 50, BULLET_SQ = 160, BULLET_MIN = 25;
/** A round's flight from a shooter takes at most this long (ms): the muzzle's and the tracers' lead before their first hit. */
export const BULLET_MAX = 400;
/** A tracer fired by a shooter: its glowing streak's length (squares; heavy / light). */
export const SHOT_STREAK = [1.6, 1];
/** The longest any accent of one hit lives after it (ms): the purge / the ticker's end. */
export const AFTER_MS = 420;

/** A small hash in [0, 1) of three integers (the same on every machine). */
export function h3(a, b, c) {
  let t = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * A frame's drawing: `px[c]` the art cells of palette colour c (flat [cx, cy, ...], drawn dim first, so a brighter one wins),
 * `glows` ground glows [x, y, radius (scene px), intensity 0..1, palette colour] for the night, `kick` the rumble at the view (the
 * renderer weighs it by distance), `live` whether anything was drawn or is still to come.
 */
export const newFrame = () => ({ px: PAL.map(() => []), add: [], blooms: [], shade: [[], []], soft: [], glows: [], kicks: [], shakes: [], flashes: [], live: false });
export function clearFrame(F) {
  for ( const a of F.px ) a.length = 0;
  F.add.length = 0; F.blooms.length = 0;
  F.shade[0].length = 0; F.shade[1].length = 0; F.soft.length = 0; F.glows.length = 0; F.kicks.length = 0; F.shakes.length = 0; F.flashes.length = 0; F.live = false;
  return F;
}

/**
 * What of a firing record this layer plays: its accents of the kinds above and its cues - a screen cue placed at the impact (rec.at:
 * the renderer weighs it by the distance from the view), a light cue left out when the firing has a burst (the explosion fire lights
 * the ground itself: fire/burst-art.mjs).
 */
export function itemsOf(rec) {
  const acc = (rec?.pending?.accent ?? []).filter((a) => a && ACCENT_KINDS.includes(a.kind));
  const burst = (rec?.f ?? []).some((f) => /^burst\./.test(f?.key ?? ""));
  const at = Array.isArray(rec?.at) ? rec.at : [null, null];
  const cues = (rec?.pending?.cue ?? []).filter((c) => c && (c.kind === "screen" ? (c.shake > 0 || c.flash > 0) : c.kind === "light" && !burst && c.peak > 0))
    .map((c) => (c.kind === "screen" ? { ...c, x: at[0], y: at[1] } : c));
  return [...acc, ...cues];
}

/** The time span (ms from T0) an accent item draws in: [from, to]. */
export function spanOf(item) {
  const at = Number(item?.at) || 0;
  if ( LANDING_KINDS.includes(item?.kind) ) return landingSpan(item);
  switch ( item?.kind ) {
    case "fallShadow": case "throwArc": case "bounce": return item.dur > 0 ? [at, at + item.dur] : null;
    case "screen": return [at, at + Math.max(item.shake > 0 ? SHAKE_MS[0] + SHAKE_MS[1] * item.shake : 0, item.flash > 0 ? FLASH_CUE_MS : 0)];
    case "light": return item.decay > 0 ? [at, at + item.decay] : null;
  }
  const ts = (item?.hits ?? []).map((h) => h[2]);
  if ( !ts.length ) return null;
  const lo = Math.min(...ts), hi = Math.max(...ts);
  if ( item.kind === "tracer" ) return [lo - (Array.isArray(item.from) ? BULLET_MAX : TRACER_MS), hi + RICO_MS];
  if ( item.kind === "muzzle" ) return [lo - BULLET_MAX, hi + MUZZLE_MS];
  // (a hit's spurt of soil, gun-fx.mjs, outlives its flash and sparks)
  if ( item.kind === "hitFx" ) return [lo, hi + Math.max(AFTER_MS, SPURT[(item.lv ?? 1) >= 3 ? "heavy" : "light"].L)];
  return [lo, hi + AFTER_MS];
}

/**
 * Draw the accents `items` of a firing with impact T0 `t0` at shared time `now` into frame `F`. env = { ap, ox, oy, grid, lift (view
 * lift), squash, q (detail 0..1: the share of sparks; the guard), seed }. Returns F.
 */
export function draw(items, t0, now, env, F) {
  for ( let k = 0; k < items.length; k++ ) {
    const it = items[k], sp = spanOf(it);
    if ( !sp ) continue;
    const t = now - t0;
    if ( t > sp[1] ) continue;
    F.live = true;
    if ( t < sp[0] ) continue;
    const seed = ((env.seed ?? 1) + k * 7919) | 0;
    if ( it.kind === "tracer" ) tracers(it, t, env, F, seed);
    else if ( it.kind === "hitFx" ) { hitFx(it, t, env, F, seed); spurts(it, t, F, seed); }
    else if ( it.kind === "muzzle" ) muzzle(it, t, env, F, seed);
    else if ( it.kind === "fallShadow" ) fallShadow(it, t, env, F, seed);
    else if ( it.kind === "throwArc" ) throwArc(it, t, env, F, seed);
    else if ( it.kind === "bounce" ) bounce(it, t, env, F, seed);
    else if ( LANDING_KINDS.includes(it.kind) ) landingDraw(it, t, env, F, seed);
    else if ( it.kind === "screen" || it.kind === "light" ) cue(it, t - (Number(it.at) || 0), F);
  }
  return F;
}

/* ---------------------------------------------------------------- plotting on the art grid */

const cellOf = (v, o, ap) => Math.floor((v - o) / ap);
/** One art pixel at scene point (x, y) lifted by z (scene px): its screen place in the oblique view. */
function put(F, env, x, y, z, c) { F.px[c].push(cellOf(x, env.ox, env.ap), cellOf(y - env.lift * z, env.oy, env.ap)); }
/** A 2 x 2 block (the cell of the point and its right / lower neighbours). */
function put2(F, env, x, y, z, c) {
  const cx = cellOf(x, env.ox, env.ap), cy = cellOf(y - env.lift * z, env.oy, env.ap);
  F.px[c].push(cx, cy, cx + 1, cy, cx, cy + 1, cx + 1, cy + 1);
}
/** A line of art pixels from screen cell a to b (Bresenham), each coloured by its place along it: colour(u, i) -> palette | -1. */
function line(F, ax, ay, bx, by, colour) {
  let x = ax, y = ay;
  const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay), sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1, n = Math.max(dx, -dy) || 1;
  let err = dx + dy;
  for ( let i = 0; i <= n; i++ ) {
    const c = colour(i / n, i);
    if ( c >= 0 ) F.px[c].push(x, y);
    if ( x === bx && y === by ) break;
    const e2 = 2 * err;
    if ( e2 >= dy ) { err += dy; x += sx; }
    if ( e2 <= dx ) { err += dx; y += sy; }
  }
}
const scr = (env, x, y, z) => [cellOf(x, env.ox, env.ap), cellOf(y - env.lift * z, env.oy, env.ap)];
/** A pixel star: a centre (2 x 2 when big) and four arms (lengths along / across a direction), tips one colour dimmer. */
function star(F, env, x, y, z, { arm = 2, side = arm, dir = [1, 0], big = true, c0 = 0, c1 = 1, c2 = 2 }) {
  const [cx, cy] = scr(env, x, y, z);
  if ( big ) F.px[c0].push(cx, cy, cx + 1, cy, cx, cy + 1, cx + 1, cy + 1); else F.px[c0].push(cx, cy);
  const ux = Math.round(dir[0]), uy = Math.round(dir[1] * (env.squash ?? 0.8));
  const fx = ux || (uy ? 0 : 1), fy = uy;
  const arms = [[fx, fy, arm], [-fx, -fy, side], [-fy, fx, side], [fy, -fx, side]];
  for ( const [ax, ay, L] of arms ) {
    for ( let i = 1; i <= L; i++ ) {
      const ox = ax > 0 && big ? 1 : 0, oy = ay > 0 && big ? 1 : 0;
      F.px[i === L ? c2 : c1].push(cx + ox + ax * i, cy + oy + ay * i);
    }
  }
}

/* ---------------------------------------------------------------- the kinds */

/**
 * A STREAK of light from screen cell a (tail) to b (head) - a tracer, a glancing round: a crisp core that is white-hot at the head
 * and cools along the tail (yellow, orange, a broken red end), thicker over its hot front half, a rounded tip (never a square
 * head), and a halo of additive warm pixels round the hot part (F.add: it glows, it is not a ruled line). `flick` (0..1) dims it
 * a step now and then (a tracer's burning compound flickers).
 */
function streak(F, ax, ay, bx, by, heavy, flick = 0) {
  const dx = bx - ax, dy = by - ay, n = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
  const horiz = Math.abs(dx) >= Math.abs(dy), px = horiz ? 0 : 1, py = horiz ? 1 : 0;
  const hot = flick > 0.75 ? 1 : 0;
  const core = new Set();
  for ( let i = 0; i <= n; i++ ) {
    const u = i / n, x = Math.round(ax + dx * u), y = Math.round(ay + dy * u);
    const c = u > 0.86 ? hot : u > 0.6 ? 1 : u > 0.33 ? 2 : u > 0.12 ? 3 : ((i & 1) ? 4 : -1);
    if ( c < 0 ) continue;
    F.px[c].push(x, y); core.add(x * 4096 + y);
    // (the hot front: two pixels thick, three at the head of a heavy round)
    if ( u > (heavy ? 0.45 : 0.62) ) { F.px[Math.min(4, c + 1)].push(x + px, y + py); core.add((x + px) * 4096 + y + py); }
    if ( heavy && u > 0.82 ) { F.px[Math.min(4, c + 1)].push(x - px, y - py); core.add((x - px) * 4096 + y - py); }
  }
  // the rounded tip: one pixel past the head, a step dimmer
  const ux = dx / n, uy = dy / n, tx = Math.round(bx + ux), ty = Math.round(by + uy);
  F.px[1].push(tx, ty); core.add(tx * 4096 + ty);
  // the HALO (additive): round the hot front, wider at the head
  for ( let i = Math.floor(n * 0.35); i <= n + 1; i++ ) {
    const u = i / n, x = Math.round(ax + dx * u), y = Math.round(ay + dy * u), w = u > 0.8 ? (heavy ? 3 : 2) : u > 0.55 ? 2 : 1;
    for ( let s = -w; s <= w; s++ ) {
      const hx = x + px * s, hy = y + py * s; if ( core.has(hx * 4096 + hy) ) continue;
      F.add.push(hx, hy, Math.abs(s) >= w ? 3 : u > 0.8 ? 1 : 2);
    }
  }
}

function tracers(it, t, env, F, seed) {
  const g = env.grid, d = it.dir ?? [1, 0], heavy = (it.lv ?? 3) >= 3;
  const B = TRACER_BACK * g, Z = TRACER_UP * g;
  it.hits.forEach((h, i) => {
    const tau = t - h[2], shot = Array.isArray(it.from);
    if ( tau < -(shot ? BULLET_MAX : TRACER_MS) || tau > RICO_MS ) return;
    const flick = h3(seed + i, Math.floor(t / 33), 9);
    if ( shot ) {
      // a SHOOTER on the map (a gunship token): the round flies out of its barrel (as its muzzle flash, muzzleOf) to the hit
      if ( tau <= 0 ) {
        const m = muzzleOf(it, h, g), fl = flightOf(m.L, g);
        if ( tau < -fl ) return;
        const at = (u) => [m.x + (h[0] - m.x) * u, m.y + (h[1] - m.y) * u, m.z * (1 - u)];
        const uh = 1 + tau / fl, ut = Math.max(0, uh - SHOT_STREAK[heavy ? 0 : 1] * g / Math.max(1, m.L));
        const [hx, hy, hz] = at(uh), [tx, ty, tz] = at(ut);
        const [ax, ay] = scr(env, tx, ty, tz), [bx, by] = scr(env, hx, hy, hz);
        streak(F, ax, ay, bx, by, heavy, flick);
        return;
      }
    } else if ( tau <= 0 ) {
      // (each gun's rounds come in on its own side, a little spread: the twin guns' streams)
      const side = (h[3] % 2 ? 1 : -1) * 0.25 * g + (h3(seed, i, 1) - 0.5) * 0.4 * g;
      const sx = -d[0] * B - d[1] * side, sy = -d[1] * B + d[0] * side;
      const at = (u) => [h[0] + sx * (1 - u), h[1] + sy * (1 - u), Z * (1 - u)];
      const uh = 1 + tau / TRACER_MS, ut = Math.max(0, uh - STREAK_MS / TRACER_MS);
      const [hx, hy, hz] = at(uh), [tx, ty, tz] = at(ut);
      const [ax, ay] = scr(env, tx, ty, tz), [bx, by] = scr(env, hx, hy, hz);
      streak(F, ax, ay, bx, by, heavy, flick);
      return;
    }
    // a glancing round: off the ground forward along the run, a little up, cooling (it goes out orange, never a dark ember)
    if ( h3(seed, i, 2) > 0.42 ) return;
    const a = (shot ? Math.atan2(h[1] - it.from[1], h[0] - it.from[0]) : Math.atan2(d[1], d[0])) + (h3(seed, i, 3) - 0.5) * 1.4, v = (3 + 3 * h3(seed, i, 4)) * g / 1000, vz = (1 + 2 * h3(seed, i, 5)) * g / 1000;
    const pos = (s) => [h[0] + Math.cos(a) * v * s, h[1] + Math.sin(a) * v * s * (env.squash ?? 0.8), Math.max(0, vz * s - 0.5 * 9 * g / 1e6 * s * s)];
    const [hx, hy, hz] = pos(tau), [tx, ty, tz] = pos(Math.max(0, tau - 45));
    const f = tau / RICO_MS, c = f < 0.35 ? 1 : 2;
    const [ax, ay] = scr(env, tx, ty, tz), [bx, by] = scr(env, hx, hy, hz);
    line(F, ax, ay, bx, by, (u, k) => (u > 0.7 ? c : (k & 1) && f < 0.7 ? c + 1 : -1));
    if ( f < 0.5 ) F.add.push(bx, by - 1, 2, bx, by + 1, 2);
  });
}

/** The night light of a hit (attack, then an exponential decay - several overlap in a run, never a pulse of one or two). */
const hitGlow = (tau, life, tauK) => (tau < 0 || tau >= life ? 0 : Math.min(1, tau / 18) * Math.exp(-tau / tauK) * (1 - smooth(0.7, 1, tau / life)));

function hitFx(it, t, env, F, seed) {
  const g = env.grid, lv = it.lv ?? 2, heavy = lv >= 3, q = env.q ?? 1, d = it.dir ?? [1, 0];
  const R = roundsOf(it), tones = it.tones;
  R.forEach((h, i) => {
    const tau = t - h[2];
    if ( tau < 0 || tau > AFTER_MS ) return;
    const major = h[4] === 1, wet = Array.isArray(tones) && wetOf(tones[i]);
    const zf = 0.06 * g, sd = seed + i * 13;
    // the FLASH: a major round's star (its long arm along the run: the rounds come in along it), a minor round's spark of a star;
    // in water a pale fleck only
    if ( wet ) { if ( tau < 50 ) star(F, env, h[0], h[1], zf, { arm: 1, side: 1, dir: d, big: false, c0: 5, c1: 5, c2: 5 }); }
    else if ( major ) {
      if ( tau < FLASH_MS[0] ) star(F, env, h[0], h[1], zf, { arm: heavy ? 3 : 2, side: heavy ? 2 : 1, dir: d, big: true });
      else if ( tau < FLASH_MS[1] ) star(F, env, h[0], h[1], zf, { arm: 1, side: 1, dir: d, big: false, c0: 1, c1: 2, c2: 3 });
    } else if ( tau < 40 ) star(F, env, h[0], h[1], zf, { arm: 1, side: 1, dir: d, big: false, c0: 0, c1: 1, c2: 2 });
    else if ( tau < 75 ) put(F, env, h[0], h[1], zf, 1);
    // the GROUND LIGHT (night): a fast attack and a long tail - a run keeps a string of them lit
    const life = heavy ? (major ? 520 : 320) : 380, gl = hitGlow(tau, life, heavy ? (major ? 150 : 90) : 110);
    if ( gl > 0.01 ) F.glows.push(h[0], h[1], (heavy ? (major ? 1.5 : 1.0) : 1.0) * g, gl * (wet ? 0.35 : heavy ? (major ? 1 : 0.7) : 0.9), tau < 40 ? 1 : 2);
    // the RUMBLE share
    if ( it.shake && major && tau < 140 ) F.kicks.push(h[0], h[1], it.shake * (1 - tau / 140));
    if ( wet ) return;
    // SPARKS: out and up, falling back, cooling - and going out while still orange (no dark ember left hanging)
    const nS = Math.max(1, Math.round((major ? (heavy ? 6 : 4) : 2) * (0.4 + 0.6 * q)));
    for ( let s = 0; s < nS; s++ ) {
      const r1 = h3(sd, s, 7), r2 = h3(sd, s, 8), r3 = h3(sd, s, 9), r4 = h3(sd, s, 10);
      const L = (heavy ? 150 : 120) + 150 * r3, s0 = 12 * r4, a = tau - s0;
      if ( a < 0 || a > L ) continue;
      const ang = Math.atan2(d[1], d[0]) + (r1 - 0.5) * (heavy ? 3.6 : 4.4);
      const vh = (heavy ? 2.2 + 3.2 * r2 : 1.8 + 2.6 * r2) * g / 1000, vz = (heavy ? 1.8 + 2.6 * r3 : 1.4 + 2 * r3) * g / 1000, G = 11 * g / 1e6;
      const pos = (u) => [h[0] + Math.cos(ang) * vh * u, h[1] + Math.sin(ang) * vh * u * (env.squash ?? 0.8), zf + vz * u - 0.5 * G * u * u];
      const [x, y, z] = pos(a);
      if ( z < 0 ) continue;
      const f = a / L, c = f < 0.25 ? 0 : f < 0.55 ? 1 : 2;
      put(F, env, x, y, z, c);
      if ( f < 0.6 ) { const [px, py, pz] = pos(Math.max(0, a - 20)); if ( pz >= 0 ) put(F, env, px, py, pz, Math.min(2, c + 1)); }
    }
  });
}

/** The flight of a round over L scene px (ms). */
const flightOf = (L, g) => Math.min(BULLET_MAX, Math.max(BULLET_MIN, (L / g) / BULLET_SQ * 1000));
/**
 * Where a shooter's round leaves its barrel for hit h: at the shooter's edge (it.fr, its radius; 0.38 squares without one) towards
 * the hit, a twin gun's two barrels side by side across the aim (lane 0 left, lane 1 right), lifted to the gun's height.
 * -> { x, y, z, ux, uy, L (px from the barrel to the hit) }.
 */
export function muzzleOf(it, h, g) {
  const M0 = it.from, dx = h[0] - M0[0], dy = h[1] - M0[1], D = Math.hypot(dx, dy) || 1, ux = dx / D, uy = dy / D;
  const fr = Number.isFinite(it.fr) ? it.fr : null;
  const off = Math.min(D * 0.5, fr !== null ? Math.max(0.3 * g, 0.85 * fr) : 0.38 * g);
  const side = it.twin ? ((h[3] % 2) ? 1 : -1) * Math.min(0.3 * g, 0.35 * (fr ?? 0.5 * g)) : 0;
  const x = M0[0] + ux * off - uy * side, y = M0[1] + uy * off + ux * side;
  return { x, y, z: 0.32 * g, ux, uy, L: Math.hypot(h[0] - x, h[1] - y) || 1 };
}

/**
 * A MUZZLE FLAME in art pixels at (x, y) lifted z, pointing (ux, uy) on the ground: a white-hot core, a forward tongue that narrows
 * and wavers, and (most shots) two short side jets - the three-pronged bloom of a gun's flash seen from above - coloured white at
 * the core through yellow and orange to red tips; a ring of additive warm pixels round it (F.add: it glows). Every shot draws a
 * different one (seed); `k` 1 its full size, smaller as it dies (k < 1: the remnant, a colour step cooler). L its length (art px).
 */
function flame(F, env, x, y, z, ux, uy, L, seed, k) {
  const [cx, cy] = scr(env, x, y, z), sq = env.squash ?? 0.8;
  let dx = ux, dy = uy * sq; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  const cool = k < 0.8 ? 1 : 0;
  const Lf = L * k * (0.75 + 0.5 * h3(seed, 1, 1)), Wf = Math.max(1.1, L * 0.22 * k), rc = Math.max(1.2, L * 0.17 * k);
  const side = h3(seed, 2, 1) < 0.75, th = 1.05 + 0.35 * h3(seed, 3, 1), Ls = L * k * (0.32 + 0.22 * h3(seed, 4, 1));
  const sa = [[Math.cos(th) * dx - Math.sin(th) * dy, Math.sin(th) * dx + Math.cos(th) * dy], [Math.cos(-th) * dx - Math.sin(-th) * dy, Math.sin(-th) * dx + Math.cos(-th) * dy]];
  const ph = h3(seed, 5, 1) * 6.28, R = Math.ceil(Math.max(Lf, rc) + 3);
  const tongue = (px, py, ax, ay, len, wid) => {
    const a = px * ax + py * ay; if ( a <= 0 || a >= len ) return -1;
    const c = Math.abs(-px * ay + py * ax), w = wid * Math.pow(1 - a / len, 0.6) * (0.8 + 0.2 * Math.sin(a * 1.4 + ph));
    return w > 0.3 ? 1 - c / w : -1;
  };
  for ( let j = -R; j <= R; j++ ) for ( let i = -R; i <= R; i++ ) {
    const px = i + 0.5, py = j + 0.5, r = Math.hypot(px, py);
    let s = 1 - r / rc;
    s = Math.max(s, tongue(px, py, dx, dy, Lf, Wf));
    if ( side ) for ( const [ax, ay] of sa ) s = Math.max(s, tongue(px, py, ax, ay, Ls, Wf * 0.7));
    if ( s > 0 ) {
      const hd = r / Math.max(2, Lf), c = Math.min(3, (r < rc ? 0 : hd < 0.42 ? 1 : hd < 0.72 ? 2 : 3) + cool);
      F.px[c].push(cx + i, cy + j);
    } else if ( s > -0.7 && r < Lf + 2 ) F.add.push(cx + i, cy + j, r < rc + 2 ? 1 : 2);
  }
}

function muzzle(it, t, env, F, seed) {
  if ( !Array.isArray(it.from) ) return;
  const g = env.grid, heavy = (it.lv ?? 1) >= 3, MS = heavy ? 75 : 60, Lpx = (heavy ? 0.6 : 0.42) * g / env.ap;
  const R = roundsOf(it);
  const lastBy = new Map();   // barrel -> the newest shot already fired
  let first = Infinity, last = -Infinity;
  R.forEach((h, i) => {
    const m = muzzleOf(it, h, g), fl = flightOf(m.L, g), ts = h[2] - fl, tau = t - ts;
    first = Math.min(first, ts); last = Math.max(last, ts);
    if ( tau >= 0 && tau <= fl + MS ) {
      const b = it.twin ? h[3] % 2 : 0, p = lastBy.get(b);
      if ( !p || ts > p.ts ) lastBy.set(b, { ts, tau, m, i });
      // the BULLET of a major round: a pale streak from the muzzle to the hit (a minor one is too fast to see)
      if ( h[4] === 1 && tau <= fl ) {
        const u = tau / fl, ul = Math.max(0, u - 0.9 * g / m.L);
        const at = (v) => [m.x + (h[0] - m.x) * v, m.y + (h[1] - m.y) * v, m.z * (1 - v)];
        const [hx, hy, hz] = at(u), [tx, ty, tz] = at(ul);
        const [ax, ay] = scr(env, tx, ty, tz), [bx, by] = scr(env, hx, hy, hz);
        line(F, ax, ay, bx, by, (v, k) => (v > 0.75 ? 5 : (k & 1) ? 5 : -1));
      }
    }
  });
  // the FLAME of each barrel's newest shot: full for its first half, then a cooler remnant - so a burst is a steady flicker of
  // different flames, never on / off every other frame; its LIGHT (the ground at night, F.glows) and BLOOM (a soft warm light
  // over the shooter itself, F.blooms: the token is lit too) for as long as the burst lasts
  for ( const { tau, m, i } of lastBy.values() ) {
    if ( tau >= MS ) continue;
    flame(F, env, m.x, m.y, m.z, m.ux, m.uy, Lpx, seed + i * 7, tau < MS * 0.5 ? 1 : 0.6);
  }
  if ( t >= first && t <= last + MS ) {
    const all = [...lastBy.values()], ref = all.filter((s) => s.tau < MS).sort((p, q) => p.tau - q.tau)[0] ?? all[0];
    if ( ref ) {
      const I = 0.55 + 0.45 * Math.exp(-Math.max(0, ref.tau) / 45);
      F.glows.push(ref.m.x, ref.m.y, (heavy ? 2.4 : 1.9) * g, (heavy ? 0.95 : 0.85) * I, 1);
      F.blooms.push(ref.m.x, ref.m.y - (env.lift ?? 0.5) * ref.m.z, (heavy ? 1.1 : 0.8) * g, I, 1);
    }
  }
}

/* ---------------------------------------------------------------- the bomb and the grenade (P5) */

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
/** A SOFT ground shadow at (x, y) (a falling bomb's, a thrown grenade's): a smooth feathered ellipse of radius r (scene px, squashed
 * by the view), its darkness `dens` 0..1 - F.soft [x, y, rx, ry, alpha]. A shadow is light, not a thing: it has no pixel grid (a
 * dithered one read as a square of 2 x 2 blocks). */
export const SOFT_A = 0.62;
function softShadow(F, env, x, y, r, dens) {
  if ( !(dens > 0.01) || !(r > 0) ) return;
  F.soft.push(x, y, r, r * (env.squash ?? 0.8), Math.min(1, dens) * SOFT_A);
}

/**
 * The bomb's FALL: its shadow on the mark, wide and faint while the bomb is high, tightening and darkening as it comes down (along
 * the firing's direction, if it has one), and the bomb itself for its last BOMB_SHOW squares: a dark finned body nose-down, lit from
 * the top left, with a pale streak of air behind it (a glint at night), falling screen-down faster and faster.
 */
function fallShadow(it, t, env, F, seed) {
  const g = env.grid, u = clamp01((t - it.at) / Math.max(1, it.dur)); if ( u >= 1 ) return;
  const k = 1 - u, d = Array.isArray(it.from) ? it.from : [0, 0], D = BOMB_D * g;
  const x = it.x - d[0] * D * k, y = it.y - d[1] * D * k, z = BOMB_Z * g * k * k;
  softShadow(F, env, x, y, g * (SHADOW_R[1] + (SHADOW_R[0] - SHADOW_R[1]) * k), smooth(0, 0.18, u) * (0.2 + 0.68 * Math.pow(u, 1.4)));
  if ( z > BOMB_SHOW * g ) return;
  // (its screen velocity: the drift along the direction, squashed, and the fall, lifted - the body's axis and the streak's way)
  const sq = env.squash ?? 0.8, dur = Math.max(1, it.dur), vx = d[0] * D / dur, vy = d[1] * D * sq / dur + (env.lift ?? 0.5) * 2 * BOMB_Z * g * k / dur;
  const vl = Math.hypot(vx, vy) || 1, ax = vx / vl, ay = vy / vl, nx = -ay, ny = ax;
  const ap = env.ap, hl = Math.max(2.5, 0.17 * g / ap), hw = Math.max(1.2, 0.075 * g / ap), [cx, cy] = scr(env, x, y, z);
  // the STREAK of air behind it: pale, dithered, longer the faster it falls (a glint at night: the only thing of it that shows)
  const sl = Math.min(4 * hl, 1.5 * hl + vl * 40 / ap);
  line(F, Math.round(cx - ax * (hl + sl)), Math.round(cy - ay * (hl + sl)), Math.round(cx - ax * hl * 0.6), Math.round(cy - ay * hl * 0.6),
    (v, i) => (v > 0.55 ? ((i & 1) ? 5 : -1) : ((i % 3) === 0 ? 5 : -1)));
  const R = Math.ceil(hl + 2);
  for ( let j = -R; j <= R; j++ ) for ( let i = -R; i <= R; i++ ) {
    const px = i + 0.5, py = j + 0.5, al = px * ax + py * ay, ac = px * nx + py * ny;
    // the body: a teardrop nose-down (round at the nose, tapering to the tail), then two fins across the tail
    const w = al > 0 ? hw * Math.sqrt(Math.max(0, 1 - (al / hl) ** 2)) : hw * (1 - 0.45 * clamp01(-al / hl));
    const body = al > -hl && al < hl && Math.abs(ac) < w, fin = al <= -hl * 0.55 && al > -hl - 1.2 && Math.abs(ac) < hw + 1.1 && Math.abs(ac) > hw * 0.35;
    if ( !body && !fin ) continue;
    // (lit from the top left: the side of the body facing left-up)
    const lit = body && (ac * nx + ac * ny) < -0.3 * hw && al > -0.4 * hl;
    F.px[lit ? 7 : 6].push(cx + i, cy + j);
  }
}

/** A grenade at (x, y) lifted z: ONE olive egg, shaded as a ball lit from the top left (lit olive, olive, dark olive), a groove round it
 * turned by `spin` (rad: it tumbles) in dark olive, the lever and fuse a fleck of metal on its top, a pale glint (at night: the point
 * that shows it); `squash` > 0 just after it hits the ground. (An iron band across it split it into two pebbles.) */
function grenade(F, env, x, y, z, spin, squash = 0) {
  const ap = env.ap, r = Math.max(1.7, 0.11 * env.grid / ap), rx = r * (1 + 0.25 * squash), ry = r * 0.95 * (1 - 0.3 * squash), [cx, cy] = scr(env, x, y, z);
  const bx = Math.cos(spin), by = Math.sin(spin), X = Math.ceil(rx) + 1, Y = Math.ceil(ry) + 1;
  for ( let j = -Y; j <= Y; j++ ) for ( let i = -X; i <= X; i++ ) {
    const px = i + 0.5, py = j + 0.5, e = Math.hypot(px / rx, py / ry); if ( e >= 1 ) continue;
    const l = (-px - py) / (1.4142 * r) + 0.35 * Math.sqrt(Math.max(0, 1 - e * e));   // (a ball's light: top left)
    const groove = r >= 2.4 && Math.abs(px * bx + py * by) < 0.5 && e < 0.8;
    F.px[groove || l < -0.35 ? 11 : l > 0.3 ? 10 : 8].push(cx + i, cy + j);
  }
  // the lever and fuse: a fleck of metal at its top, turning with it
  const lx = Math.round(-by * ry * 0.95 - 0.5), ly = Math.round(-Math.abs(bx) * ry - 0.5);
  F.px[7].push(cx + lx, cy + ly);
  F.px[5].push(cx + Math.round(-0.4 * rx) - 1, cy + Math.round(-0.4 * ry) - 1);
}
/** Where a throw lands (short of its mark: it bounces the rest), and its unit direction; null when nothing is thrown (a click). */
export function throwOf(from, to, g) {
  if ( !Array.isArray(from) || !Array.isArray(to) ) return null;
  const dx = to[0] - from[0], dy = to[1] - from[1], L = Math.hypot(dx, dy);
  if ( L < 0.6 * g ) return null;
  const ux = dx / L, uy = dy / L, back = Math.min(BOUNCE_BACK * g, 0.35 * L);
  return { L, ux, uy, back, land: [to[0] - ux * back, to[1] - uy * back] };
}

/**
 * The grenade's THROW: from the thrower (gesture.a) along an arc (its apex as the aim's ghost: 35 % of the throw, lifted by the
 * view) to where it lands short of its mark, tumbling, its small shadow running under it on the ground.
 */
function throwArc(it, t, env, F, seed) {
  const g = env.grid, T = throwOf(it.from, it.to, g); if ( !T ) return;
  const u = clamp01((t - it.at) / Math.max(1, it.dur)); if ( u >= 1 ) return;
  const x = it.from[0] + (T.land[0] - it.from[0]) * u, y = it.from[1] + (T.land[1] - it.from[1]) * u;
  const z = 0.35 * T.L * 4 * u * (1 - u) + 0.3 * g * (1 - u);
  softShadow(F, env, x, y, g * (0.15 + 0.05 * z / g), 0.8 / (1 + 0.45 * z / g));
  grenade(F, env, x, y, z, (t - it.at) * 0.016 + h3(seed, 1, 1) * 6.28);
}

/**
 * Its BOUNCE onto the mark: it hits the ground where the throw landed (squashed, a puff of the dust), hops once, hits again and rolls
 * the rest, slowing, and lies still on the mark until it goes off. A click (nothing thrown): it drops on the mark and hops in place.
 */
function bounce(it, t, env, F, seed) {
  const g = env.grid, tau = t - it.at, dur = Math.max(1, it.dur); if ( tau >= dur ) return;
  const T = throwOf(it.from, [it.x, it.y], g), ux = T?.ux ?? 0, uy = T?.uy ?? 0, back = T?.back ?? 0;
  const p0 = [it.x - ux * back, it.y - uy * back], p1 = [it.x - ux * back * 0.35, it.y - uy * back * 0.35];
  const tH = 0.48 * dur, tR = 0.9 * dur;
  let x, y, z = 0, sq = 0, dist;
  if ( tau < tH ) {
    const f = tau / tH; x = p0[0] + (p1[0] - p0[0]) * f; y = p0[1] + (p1[1] - p0[1]) * f; z = (T ? 0.26 : 0.16) * g * 4 * f * (1 - f); dist = back * 0.65 * f;
  } else {
    const f = clamp01((tau - tH) / (tR - tH)), e = 1 - (1 - f) * (1 - f);
    x = p1[0] + (it.x - p1[0]) * e; y = p1[1] + (it.y - p1[1]) * e; dist = back * (0.65 + 0.35 * e);
  }
  // (squashed for a moment each time it hits the ground)
  for ( const tg of [0, tH] ) if ( tau >= tg && tau < tg + 50 ) sq = 1 - (tau - tg) / 50;
  softShadow(F, env, x, y, g * (0.15 + 0.05 * z / g), 0.8 / (1 + 0.45 * z / g));
  grenade(F, env, x, y, z, h3(seed, 1, 1) * 6.28 + dist / (0.105 * g), sq);
  // a little DUST where it hits: a few grains of the ground thrown out low, settling and dropping out
  [[0, p0], [tH, p1]].forEach(([tg, p], m) => {
    const a = tau - tg; if ( a < 0 || a > 260 ) return;
    const f = a / 260, n = m ? 4 : 6;
    for ( let s = 0; s < n; s++ ) {
      if ( h3(seed + m, s, 33) < f * f ) continue;
      const an = h3(seed + m, s, 31) * 6.283, v = (0.18 + 0.2 * h3(seed + m, s, 32)) * g * (1 - (1 - f) * (1 - f));
      const zz = 0.12 * g * 4 * f * (1 - f) * h3(seed + m, s, 34);
      put(F, env, p[0] + Math.cos(an) * v, p[1] + Math.sin(an) * v * (env.squash ?? 0.8), zz, 9);
    }
  });
}

/**
 * The CUES at time t (ms after the cue's moment): a screen cue's shake (F.shakes [x, y, amplitude in screen px]: it eases in over 30
 * ms and dies away) and flash (F.flashes [x, y, alpha]: up in 35 ms, gone by FLASH_CUE_MS) - the renderer weighs them by the
 * distance from the view and the client's opt-outs; a light cue a warm ground glow (yellow, then orange) that decays.
 */
function cue(it, t, F) {
  if ( t < 0 ) return;
  if ( it.kind === "screen" ) {
    const S = SHAKE_MS[0] + SHAKE_MS[1] * (it.shake ?? 0);
    if ( it.shake > 0 && t < S ) F.shakes.push(it.x ?? NaN, it.y ?? NaN, SHAKE_PX * it.shake * Math.min(1, t / 30) * (1 - t / S) ** 2);
    if ( it.flash > 0 && t < FLASH_CUE_MS ) F.flashes.push(it.x ?? NaN, it.y ?? NaN, it.flash * Math.min(1, t / 35) * (1 - t / FLASH_CUE_MS) ** 2);
  } else if ( it.kind === "light" && t < it.decay ) {
    const f = 1 - t / it.decay;
    F.glows.push(it.x, it.y, it.radius, (it.peak ?? 1) * f * f * Math.min(1, t / 40), f > 0.55 ? 1 : 2);
  }
}
