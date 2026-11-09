/**
 * DESTRUCTION PRESETS, the gun ACCENTS - the pure part (no Foundry, no PIXI: node-tested in dev/presets-accents.test.mjs; drawn by
 * accents.mjs). dev/presets-design.md G7 / P5, for the two guns: what no layer draws by itself -
 *   tracer  every n-th round of each gun: a bright streak coming in from above and behind along the run (lifted by the view angle),
 *           white-hot head, yellow / orange / red tail with a dithered end, landing ON its hit; some glance off as a short spark
 *   hitFx   at every hit: a pixel star flash (two frames), a spray of sparks thrown out and up, falling back under gravity and cooling
 *           white -> yellow -> orange -> red, a short warm ground glow (the night: it lights the ground round the hit); a rumble
 *           (the screen shake share of the hit, heavy guns)
 *   muzzle  the shooter's muzzle flash at every shot (a star stretched along the aim, a different one each shot) with its glow, and a
 *           pale bullet streak from the muzzle to its hit - only when the firing names a shooter (gesture.from)
 * Everything is ART PIXELS on the destruction layer's art grid (ap scene px, origin ox / oy): crisp at any zoom, the same language as
 * the fire's sparks and the destruction's pixel-fx; colours from one small palette, ends by dithered dropout, never a soft blur.
 * A frame is a PURE function of (the firing record's accents, T0, the shared clock): a late joiner sees whatever is still in flight.
 */

/** The palette: white-hot, yellow, orange, red, ember, pale (the bullet streak / a glint); the thrown and dropped things: iron
 * (a bomb's body, a grenade's band), metal light, olive (a grenade), dust (kicked up where a grenade lands). */
export const PAL = [0xfffbe8, 0xffe27a, 0xffa13a, 0xe0532a, 0x8a2e1a, 0xfff0c8, 0x27231f, 0x8d867a, 0x505b33, 0xb3a68d];
/** How much each palette colour lights itself at night (its emission, 0..1; 0: lit by the scene only, never by itself). */
export const GLOW = [1, 0.95, 0.78, 0.5, 0.22, 0.6, 0, 0, 0, 0];
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
export const ACCENT_KINDS = ["tracer", "hitFx", "muzzle", "fallShadow", "throwArc", "bounce"];
/** A tracer's visible flight (ms) before its hit, the streak's length (ms of flight), a glancing one's life (ms). */
export const TRACER_MS = 210, STREAK_MS = 85, RICO_MS = 200;
/** A tracer comes in from this far behind (squares along the run) and this high (squares) at the start of its visible flight: steep,
 * from above (the helicopter's guns are high up) - a shallow one read as a flat line across the map. */
export const TRACER_BACK = 3.2, TRACER_UP = 7.5;
/** The hit flash (ms): the big star, then the small one; the ground glow's life (ms). */
export const FLASH_MS = [55, 125], GLOW_MS = 150;
/** The muzzle flash (ms) and the bullet's speed (squares a second; the streak takes at least BULLET_MIN ms). */
export const MUZZLE_MS = 50, BULLET_SQ = 160, BULLET_MIN = 25;
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
export const newFrame = () => ({ px: PAL.map(() => []), shade: [[], []], glows: [], kicks: [], shakes: [], flashes: [], live: false });
export function clearFrame(F) {
  for ( const a of F.px ) a.length = 0;
  F.shade[0].length = 0; F.shade[1].length = 0; F.glows.length = 0; F.kicks.length = 0; F.shakes.length = 0; F.flashes.length = 0; F.live = false;
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
  switch ( item?.kind ) {
    case "fallShadow": case "throwArc": case "bounce": return item.dur > 0 ? [at, at + item.dur] : null;
    case "screen": return [at, at + Math.max(item.shake > 0 ? SHAKE_MS[0] + SHAKE_MS[1] * item.shake : 0, item.flash > 0 ? FLASH_CUE_MS : 0)];
    case "light": return item.decay > 0 ? [at, at + item.decay] : null;
  }
  const ts = (item?.hits ?? []).map((h) => h[2]);
  if ( !ts.length ) return null;
  const lo = Math.min(...ts), hi = Math.max(...ts);
  if ( item.kind === "tracer" ) return [lo - TRACER_MS, hi + RICO_MS];
  if ( item.kind === "muzzle" ) return [lo - 400, hi + MUZZLE_MS];
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
    else if ( it.kind === "hitFx" ) hitFx(it, t, env, F, seed);
    else if ( it.kind === "muzzle" ) muzzle(it, t, env, F, seed);
    else if ( it.kind === "fallShadow" ) fallShadow(it, t, env, F, seed);
    else if ( it.kind === "throwArc" ) throwArc(it, t, env, F, seed);
    else if ( it.kind === "bounce" ) bounce(it, t, env, F, seed);
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

function tracers(it, t, env, F, seed) {
  const g = env.grid, d = it.dir ?? [1, 0], heavy = (it.lv ?? 3) >= 3;
  const B = TRACER_BACK * g, Z = TRACER_UP * g;
  it.hits.forEach((h, i) => {
    const tau = t - h[2];
    if ( tau < -TRACER_MS || tau > RICO_MS ) return;
    // (each gun's rounds come in on its own side, a little spread: the twin guns' streams)
    const side = (h[3] % 2 ? 1 : -1) * 0.25 * g + (h3(seed, i, 1) - 0.5) * 0.4 * g;
    const sx = -d[0] * B - d[1] * side, sy = -d[1] * B + d[0] * side;
    if ( tau <= 0 ) {
      const at = (u) => [h[0] + sx * (1 - u), h[1] + sy * (1 - u), Z * (1 - u)];
      const uh = 1 + tau / TRACER_MS, ut = Math.max(0, uh - STREAK_MS / TRACER_MS);
      const [hx, hy, hz] = at(uh), [tx, ty, tz] = at(ut);
      const [ax, ay] = scr(env, tx, ty, tz), [bx, by] = scr(env, hx, hy, hz);
      line(F, ax, ay, bx, by, (u, k) => (u > 0.9 ? 0 : u > 0.62 ? 1 : u > 0.32 ? 2 : u > 0.12 ? 3 : (k & 1) ? 4 : -1));
      // (a heavy round's streak is 2 px thick over its hot front half: it reads at zoom 0.6)
      if ( heavy ) { line(F, ax, ay + 1, bx, by + 1, (u) => (u > 0.8 ? 1 : u > 0.5 ? 2 : -1)); put2(F, env, hx, hy, hz, 0); } else put(F, env, hx, hy, hz, 0);
      return;
    }
    // a glancing round: off the ground forward along the run, a little up, cooling
    if ( h3(seed, i, 2) > 0.42 ) return;
    const a = Math.atan2(d[1], d[0]) + (h3(seed, i, 3) - 0.5) * 1.4, v = (3 + 3 * h3(seed, i, 4)) * g / 1000, vz = (1 + 2 * h3(seed, i, 5)) * g / 1000;
    const pos = (s) => [h[0] + Math.cos(a) * v * s, h[1] + Math.sin(a) * v * s * (env.squash ?? 0.8), Math.max(0, vz * s - 0.5 * 9 * g / 1e6 * s * s)];
    const [hx, hy, hz] = pos(tau), [tx, ty, tz] = pos(Math.max(0, tau - 45));
    const f = tau / RICO_MS, c = f < 0.3 ? 1 : f < 0.65 ? 2 : 3;
    const [ax, ay] = scr(env, tx, ty, tz), [bx, by] = scr(env, hx, hy, hz);
    line(F, ax, ay, bx, by, (u, k) => (u > 0.7 ? c : (k & 1) ? Math.min(4, c + 1) : -1));
  });
}

function hitFx(it, t, env, F, seed) {
  const g = env.grid, lv = it.lv ?? 2, heavy = lv >= 3, q = env.q ?? 1, d = it.dir ?? [1, 0];
  const nS = Math.max(1, Math.round((heavy ? 6 : lv === 2 ? 4 : 3) * (0.4 + 0.6 * q)));
  it.hits.forEach((h, i) => {
    const tau = t - h[2];
    if ( tau < 0 || tau > AFTER_MS ) return;
    const zf = 0.08 * g;
    // the FLASH: a big star, then a small one (its long arm along the run: the rounds come in along it)
    if ( tau < FLASH_MS[0] ) star(F, env, h[0], h[1], zf, { arm: heavy ? 3 : 2, side: heavy ? 2 : 1, dir: d, big: lv >= 2 });
    else if ( tau < FLASH_MS[1] ) star(F, env, h[0], h[1], zf, { arm: 1, side: 1, dir: d, big: false, c0: 1, c1: 2, c2: 3 });
    // the GROUND GLOW (night: lights the ground round the hit)
    if ( tau < GLOW_MS ) { const f = 1 - tau / GLOW_MS; F.glows.push(h[0], h[1], (heavy ? 0.85 : 0.55) * g, f * f * (heavy ? 0.9 : 0.6), 2); }
    // the RUMBLE share
    if ( it.shake && tau < 140 ) F.kicks.push(h[0], h[1], it.shake * (1 - tau / 140));
    // SPARKS: out and up, falling back, cooling
    for ( let s = 0; s < nS; s++ ) {
      const r1 = h3(seed + i, s, 7), r2 = h3(seed + i, s, 8), r3 = h3(seed + i, s, 9), r4 = h3(seed + i, s, 10);
      const L = (heavy ? 180 : 140) + 200 * r3, s0 = 18 * r4, a = tau - s0;
      if ( a < 0 || a > L ) continue;
      // (thrown mostly forward along the run - the rounds' momentum - and to the sides)
      const ang = Math.atan2(d[1], d[0]) + (r1 - 0.5) * (heavy ? 3.6 : 4.4);
      const vh = (heavy ? 2.2 + 3.2 * r2 : 1.6 + 2.4 * r2) * g / 1000, vz = (heavy ? 1.8 + 2.6 * r3 : 1.2 + 1.8 * r3) * g / 1000, G = 11 * g / 1e6;
      const pos = (u) => [h[0] + Math.cos(ang) * vh * u, h[1] + Math.sin(ang) * vh * u * (env.squash ?? 0.8), zf + vz * u - 0.5 * G * u * u];
      const [x, y, z] = pos(a);
      if ( z < 0 ) continue;
      const f = a / L, c = f < 0.2 ? 0 : f < 0.45 ? 1 : f < 0.75 ? 2 : 3;
      put(F, env, x, y, z, c);
      if ( heavy || f < 0.5 ) { const [px, py, pz] = pos(Math.max(0, a - 22)); if ( pz >= 0 ) put(F, env, px, py, pz, Math.min(4, c + 1)); }
    }
  });
}

function muzzle(it, t, env, F, seed) {
  const M0 = it.from; if ( !Array.isArray(M0) ) return;
  const g = env.grid, zM = 0.32 * g;
  it.hits.forEach((h, i) => {
    const dx = h[0] - M0[0], dy = h[1] - M0[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const mx = M0[0] + ux * 0.38 * g, my = M0[1] + uy * 0.38 * g;
    const fl = Math.max(BULLET_MIN, (L / g) / BULLET_SQ * 1000), ts = h[2] - fl, tau = t - ts;
    if ( tau < 0 || tau > fl + MUZZLE_MS ) return;
    // the FLASH: a star stretched along the aim, a different one each shot (two frames)
    if ( tau < MUZZLE_MS ) {
      const big = tau < MUZZLE_MS * 0.5, r = h3(seed, i, 21);
      star(F, env, mx, my, zM, big ? { arm: 3 + Math.round(r * 2), side: 1 + (r > 0.5 ? 1 : 0), dir: [ux, uy], big: true }
        : { arm: 2, side: 1, dir: [ux, uy], big: false, c0: 1, c1: 2, c2: 3 });
      if ( big ) F.glows.push(mx, my, 1.1 * g, 0.85, 1);
    }
    // the BULLET: a pale streak from the muzzle to the hit
    if ( tau <= fl ) {
      const u = tau / fl, ul = Math.max(0, u - 0.9 * g / L);
      const at = (v) => [mx + (h[0] - mx) * v, my + (h[1] - my) * v, zM * (1 - v)];
      const [hx, hy, hz] = at(u), [tx, ty, tz] = at(ul);
      const [ax, ay] = scr(env, tx, ty, tz), [bx, by] = scr(env, hx, hy, hz);
      line(F, ax, ay, bx, by, (v, k) => (v > 0.75 ? 5 : (k & 1) ? 5 : -1));
    }
  });
}

/* ---------------------------------------------------------------- the bomb and the grenade (P5) */

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
/** The dither's threshold of a 2 x 2 cluster (destruction's dropout grain, hashed: no ordered halftone grid), anchored to the art grid,
 * so a growing shadow only ever adds clusters (no crawl). */
const bayer = (x, y) => h3(x >> 1, y >> 1, 91);

/** A soft ground shadow at (x, y): an ellipse of radius r (scene px, squashed by the view), its density `dens` (0..1) highest in the
 * middle and dithered out to the rim in two steps - dark in the core, a light penumbra round it. */
function shadow(F, env, x, y, r, dens) {
  if ( !(dens > 0.01) || !(r > 0) ) return;
  const ap = env.ap, rx = Math.max(1, r / ap), ry = Math.max(1, rx * (env.squash ?? 0.8)), [cx, cy] = scr(env, x, y, 0);
  const X = Math.ceil(rx), Y = Math.ceil(ry);
  for ( let j = -Y; j <= Y; j++ ) for ( let i = -X; i <= X; i++ ) {
    const e = Math.hypot((i + 0.5) / rx, (j + 0.5) / ry); if ( e >= 1 ) continue;
    const v = dens * (1 - smooth(0.2, 1, e)), th = bayer(cx + i, cy + j);
    if ( th < v ) F.shade[1].push(cx + i, cy + j); else if ( th < Math.min(0.97, v * 1.9) ) F.shade[0].push(cx + i, cy + j);
  }
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
  shadow(F, env, x, y, g * (SHADOW_R[1] + (SHADOW_R[0] - SHADOW_R[1]) * k), smooth(0, 0.18, u) * (0.2 + 0.68 * Math.pow(u, 1.4)));
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

/** A grenade at (x, y) lifted z: an olive egg, a dark band round it turned by `spin` (rad: it tumbles), lit from the top left, a
 * pale glint (at night: the point that shows it); `squash` > 0 just after it hits the ground. */
function grenade(F, env, x, y, z, spin, squash = 0) {
  const ap = env.ap, r = Math.max(1.6, 0.105 * env.grid / ap), rx = r * (1 + 0.25 * squash), ry = r * 0.92 * (1 - 0.3 * squash), [cx, cy] = scr(env, x, y, z);
  const bx = Math.cos(spin), by = Math.sin(spin), X = Math.ceil(rx) + 1, Y = Math.ceil(ry) + 1;
  for ( let j = -Y; j <= Y; j++ ) for ( let i = -X; i <= X; i++ ) {
    const px = i + 0.5, py = j + 0.5, e = Math.hypot(px / rx, py / ry); if ( e >= 1 ) continue;
    const band = Math.abs(px * bx + py * by) < Math.max(0.6, 0.22 * r), lit = px + py < -0.55 * r;
    F.px[band ? 6 : lit ? 7 : 8].push(cx + i, cy + j);
  }
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
  shadow(F, env, x, y, g * (0.13 + 0.05 * z / g), 0.62 / (1 + 0.45 * z / g));
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
  shadow(F, env, x, y, g * (0.13 + 0.05 * z / g), 0.62 / (1 + 0.45 * z / g));
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
