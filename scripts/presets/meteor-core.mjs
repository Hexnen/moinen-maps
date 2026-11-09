/**
 * DESTRUCTION PRESETS, THE METEOR - the pure part (no Foundry, no PIXI: node-tested in dev/presets-meteor.test.mjs; drawn by
 * meteor-art.mjs). dev/presets-design.md section 20. One accent item of kind "meteor" (core.mjs accentOf) holds everything this needs:
 *   { at (ms from T0, < 0: the flight starts), dur (the flight + the lingering trail), x, y (the impact, scene px), dir (the unit way it
 *     travels on the ground), sz (the firing's size), wd / ws (the scene wind), rocks: [[x, y, t], ...] (the ejecta's landings, ms) }
 *
 * THE WAY THROUGH THE SKY: the head starts SKY_BACK squares back along the way and SKY_UP squares up; it comes down a straight line
 * (in the world and so on screen too: a point at height z is drawn lift x z up the screen), eased in - s = u^EASE of the flight's time
 * share u: far and slow first, then a rush (half the way in the last ~0.6 s of 2.6). Its trail was made at each point when the head
 * passed it (madeAt): the sky trail's age along the way.
 * THE BODIES of a frame (bodies): the sparks peeling off the tail (before the impact), the ejecta rocks on their arcs and the smaller
 * pebbles flying with them (after it): [screen x, screen y, heat 0..1, kind, ground x, ground y, screen x / y a moment before] - kinds
 * 0 spark, 1 rock, 2 big rock, 3 pebble. Pure functions of (item, time, view): every client draws the same frame.
 */
export const SKY_BACK = 12, SKY_UP = 18, EASE = 1.25;
/** The sky trail lingers this long after the impact (ms): it breaks up over its second half. */
export const TRAIL_MS = 16000;
/** The pressure front: out to RING_MAX squares (x size), slowing with RING_TAU ms; gone by RING_MS. */
export const RING_MAX = 7, RING_TAU = 170, RING_MS = 620;
/** How many bodies a frame may hold, and how many sparks / pebbles (the guard thins these, never the rocks). */
export const MAX_BODIES = 64, SPARKS = 30, PEBBLES = 22;
/** The approach rumble: the last RUMBLE_MS before the impact, growing to RUMBLE_PX screen px. */
export const RUMBLE_MS = 900, RUMBLE_PX = 2.6;
/** A rock is in the air from a little after the impact (it is thrown out of the fireball). */
const LAUNCH_MS = [25, 80];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** A small hash in [0, 1) of three integers (the same on every machine). */
export function h3(a, b, c) {
  let t = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The way of an item: { P (impact), d (ground way), B / Z (scene px back / up), at (ms), D (flight ms), sq (px per square x size) }. */
export function wayOf(it, grid) {
  const d = Array.isArray(it?.dir) && Number.isFinite(it.dir[0]) ? it.dir : [0.6, 0.8], l = Math.hypot(d[0], d[1]) || 1;
  const at = Math.min(-100, Number(it?.at) || -2600);
  return { P: [Number(it?.x) || 0, Number(it?.y) || 0], d: [d[0] / l, d[1] / l], B: SKY_BACK * grid, Z: SKY_UP * grid, at, D: -at, g: grid,
    sq: grid * Math.max(0.5, Math.min(2, Number(it?.sz) || 1)) };
}
/** The head at time t (ms from T0, at..0): s the way's share done, its ground point, its height, ds / dt (1 / ms). */
export function headAt(W, t) {
  const u = clamp01((t - W.at) / W.D), s = Math.pow(u, EASE), k = 1 - s;
  return { u, s, gx: W.P[0] - W.d[0] * W.B * k, gy: W.P[1] - W.d[1] * W.B * k, z: W.Z * k, vs: u > 0 ? EASE * Math.pow(u, EASE - 1) / W.D : 0 };
}
/** When the head passed the point s of its way (ms from T0). */
export const madeAt = (W, s) => W.at + Math.pow(clamp01(s), 1 / EASE) * W.D;
/** A point of the way on screen (scene px): s, the view's lift. */
export const screenOf = (W, s, lift) => [W.P[0] - W.d[0] * W.B * (1 - s), W.P[1] - W.d[1] * W.B * (1 - s) - lift * W.Z * (1 - s)];

/** The wind's drift of things in the sky (scene px per s): a quarter-plus of a square a second at full wind. */
export function driftOf(it, grid) {
  const a = (Number(it?.wd) || 0) * Math.PI / 180, w = Math.max(0, Math.min(1, Number(it?.ws) || 0)) * 0.35 * grid;
  return [Math.cos(a) * w, Math.sin(a) * w];
}

/**
 * The frame's BODIES at time t (ms from T0) into `out` (Float32Array(MAX_BODIES * 8)); returns how many. env = { grid, lift, squash,
 * q (detail 0..1: the share of sparks and pebbles, never under a quarter) }, seed the firing's.
 */
export function bodies(it, t, env, seed, out) {
  const W = wayOf(it, env.grid), lift = env.lift ?? 0.5, q = Math.max(0.25, Math.min(1, env.q ?? 1)), g = W.g, sq = W.sq;
  let n = 0;
  const put = (sx, sy, heat, kind, gx, gy, px, py) => { if ( n >= MAX_BODIES ) return; out.set([sx, sy, heat, kind, gx, gy, px, py], n * 8); n++; };
  // SPARKS peeling off the tail: born at the head over the last 1.5 s of the flight, they lag behind it (a third of its speed),
  // scatter sideways and fall a little, cooling through the ramp
  if ( t < 700 ) {
    const nS = Math.round(SPARKS * q);
    for ( let k = 0; k < nS; k++ ) {
      const h1 = h3(seed, k, 401), h2 = h3(seed, k, 402), h3_ = h3(seed, k, 403), h4 = h3(seed, k, 404);
      const tb = -40 - 1460 * Math.pow(h1, 1.5), L = 280 + 420 * h2, tau = t - tb;
      if ( tau < 0 || tau > L || tb < W.at ) continue;
      const H = headAt(W, tb), vs = H.vs;
      const vgx = W.d[0] * W.B * vs * 0.32, vgy = W.d[1] * W.B * vs * 0.32, vz = -W.Z * vs * 0.32;
      const side = (h3_ - 0.5) * 2.2 * g / 1000, up = (h4 - 0.35) * 1.4 * g / 1000;
      const e = (1 - Math.exp(-tau / 260)) * 260;
      const gx = H.gx + (vgx - W.d[1] * side) * e, gy = H.gy + (vgy + W.d[0] * side) * e, z = H.z + (vz + up) * e - 0.5 * 4 * g / 1e6 * tau * tau;
      const e2 = (1 - Math.exp(-Math.max(0, tau - 30) / 260)) * 260;
      const pz = H.z + (vz + up) * e2 - 0.5 * 4 * g / 1e6 * Math.max(0, tau - 30) ** 2;
      put(gx, gy - lift * z, 1 - tau / L, 0, gx, gy, H.gx + (vgx - W.d[1] * side) * e2, H.gy + (vgy + W.d[0] * side) * e2 - lift * pz);
    }
  }
  if ( t < 0 ) return n;
  // ROCKS: thrown out of the fireball, on high arcs to their landings (the ejecta: each lands where its pock opens and its dust
  // jumps), hot at first (they glow), cooling to dark rock; their shadow runs on the ground under them
  const P = W.P, rocks = Array.isArray(it?.rocks) ? it.rocks : [];
  const arc = (lx, ly, tk, tl, apex, z0, tt) => {
    const u = clamp01((tt - tl) / Math.max(1, tk - tl)), gx = P[0] + (lx - P[0]) * u, gy = P[1] + (ly - P[1]) * u;
    return [gx, gy, apex * 4 * u * (1 - u) + z0 * (1 - u)];
  };
  rocks.forEach((r, k) => {
    const tk = Number(r[2]) || 0, tl = LAUNCH_MS[0] + (LAUNCH_MS[1] - LAUNCH_MS[0]) * h3(seed, k, 411);
    if ( t < tl || t >= tk ) return;
    const dist = Math.hypot(r[0] - P[0], r[1] - P[1]), apex = (0.3 + 0.3 * h3(seed, k, 412)) * dist + 0.5 * sq, z0 = 0.45 * sq;
    const [gx, gy, z] = arc(r[0], r[1], tk, tl, apex, z0, t), [pgx, pgy, pz] = arc(r[0], r[1], tk, tl, apex, z0, Math.max(tl, t - 45));
    put(gx, gy - lift * z, Math.exp(-(t - tl) / 650), h3(seed, k, 413) < 0.45 ? 2 : 1, gx, gy, pgx, pgy - lift * pz);
  });
  // PEBBLES: smaller stones flying with them, landing nearer (in the dust of the shock: nothing of their own on the ground)
  if ( t < 1200 ) {
    const nP = Math.round(PEBBLES * q), base = Math.atan2(W.d[1], W.d[0]);
    for ( let k = 0; k < nP; k++ ) {
      const tl = LAUNCH_MS[0] + 40 * h3(seed, k, 421), tk = 260 + 760 * h3(seed, k, 422);
      if ( t < tl || t >= tk ) continue;
      const u = h3(seed, k, 423) * 2 - 1, ang = base + Math.sign(u) * Math.pow(Math.abs(u), 1.2) * Math.PI * 0.85;
      const dist = (1.1 + 2.7 * h3(seed, k, 424)) * sq, lx = P[0] + Math.cos(ang) * dist, ly = P[1] + Math.sin(ang) * dist;
      const apex = (0.2 + 0.35 * h3(seed, k, 425)) * dist + 0.3 * sq;
      const [gx, gy, z] = arc(lx, ly, tk, tl, apex, 0.35 * sq, t), [pgx, pgy, pz] = arc(lx, ly, tk, tl, apex, 0.35 * sq, Math.max(tl, t - 35));
      put(gx, gy - lift * z, Math.exp(-(t - tl) / 420), 3, gx, gy, pgx, pgy - lift * pz);
    }
  }
  return n;
}

/**
 * Everything the meteor can draw (scene px, { x0, y0, x1, y1 }) at a view lift: the way on screen and its trail (with the wind's
 * drift over the trail's life), the shadow / light on the ground along the way, the pressure ring, the rocks' arcs.
 */
export function rectOf(it, grid, lift) {
  const W = wayOf(it, grid), sq = W.sq, g = grid, [wx, wy] = driftOf(it, grid), T = (TRAIL_MS + W.D) / 1000;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, r) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
  const trailW = 2.2 * g * Math.max(1, Math.pow(W.sq / g, 0.7));
  for ( let i = 0; i <= 16; i++ ) {
    const s = i / 16, [sx, sy] = screenOf(W, s, lift);
    add(sx, sy, trailW); add(sx + wx * T, sy + wy * T, trailW);
    add(W.P[0] - W.d[0] * W.B * (1 - s), W.P[1] - W.d[1] * W.B * (1 - s), 1.2 * g);   // (the shadow on the ground)
  }
  add(W.P[0], W.P[1], RING_MAX * 1.15 * sq + g);
  add(W.P[0], W.P[1], 7.5 * g);                                                        // (the light on the ground near the end)
  for ( const r of Array.isArray(it?.rocks) ? it.rocks : [] ) {
    const dist = Math.hypot(r[0] - W.P[0], r[1] - W.P[1]), apex = 0.6 * dist + 0.5 * sq;
    add(r[0], r[1], g * 0.5); add((r[0] + W.P[0]) / 2, (r[1] + W.P[1]) / 2 - lift * apex, g * 0.5);
  }
  return { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1) };
}

/** The approach rumble at time t (ms from T0): screen px, 0 outside its window. */
export const rumbleAt = (t) => (t < -RUMBLE_MS || t >= 0 ? 0 : RUMBLE_PX * ((t + RUMBLE_MS) / RUMBLE_MS) ** 2);
/** When an item's drawing ends (ms from T0). */
export const endOf = (it) => Math.max(Number(it?.at) || 0, (Number(it?.at) || 0) + (Number(it?.dur) || 0));
