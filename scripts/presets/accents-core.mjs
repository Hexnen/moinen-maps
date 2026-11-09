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

/** The palette: white-hot, yellow, orange, red, ember, pale (the bullet streak). */
export const PAL = [0xfffbe8, 0xffe27a, 0xffa13a, 0xe0532a, 0x8a2e1a, 0xfff0c8];
/** How much each palette colour lights itself at night (its emission, 0..1). */
export const GLOW = [1, 0.95, 0.78, 0.5, 0.22, 0.6];
/** A tracer's visible flight (ms) before its hit, the streak's length (ms of flight), a glancing one's life (ms). */
export const TRACER_MS = 210, STREAK_MS = 85, RICO_MS = 200;
/** A tracer comes in from this far behind (squares along the run) and this high (squares) at the start of its visible flight. */
export const TRACER_BACK = 5, TRACER_UP = 4.2;
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
export const newFrame = () => ({ px: PAL.map(() => []), glows: [], kicks: [], live: false });
export function clearFrame(F) { for ( const a of F.px ) a.length = 0; F.glows.length = 0; F.kicks.length = 0; F.live = false; return F; }

/** The time span (ms from T0) an accent item draws in: [from, to]. */
export function spanOf(item) {
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
