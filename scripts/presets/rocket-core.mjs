/**
 * DESTRUCTION PRESETS, the ROCKET / RPG - the pure part (no Foundry, no PIXI: node-tested in dev/presets-rocket.test.mjs; drawn by
 * rocket.mjs). dev/presets-design.md section 20. From the firing's accent item (core.mjs rocketFlight: the target `to`, the launch
 * point `m` and its height `z0`, the flight `fl` ms, `shot` = a shooter fired it, the wind `wd` / `ws`) and its seed, every client
 * builds the same flight:
 *   FLIGHT   path samples from the launch point to the target (a seeded bow, a corkscrew, a slight lob or a long descent), each with
 *            the moment the rocket passes it (it accelerates: s = a u + (1 - a) u^2 of the way)
 *   TRAIL    per frame, the samples already passed: each one's age swells its smoke, lifts it (up the screen), drifts it with the wind,
 *            lets it wander sideways and, after a while, thins it out (blobby dropout, oldest first) - the shader in rocket.mjs draws
 *            the lumpy tube round them, per art cell
 *   BILLOWS  the launch's backblast (thrown back out of the tube, hot for a moment, then a grey-tan cloud), the muzzle's puff, the hiss
 *            before the launch - only with a shooter
 *   PIXELS   the rocket (warhead, body, motor flame), its ground shadow, the sparks, the launch / sustainer flashes - CPU art pixels
 *   LIGHTS   the moving light under the motor flame and the launch flash (night)
 * All positions in ART CELLS of the destruction layer's art grid (geo { ap, ox, oy, grid }) on the SCREEN plane of the oblique view
 * (a height z is drawn lift x z up the screen); times in ms from T0 (the impact).
 */

/** Trail samples (the shader's uniform arrays) and billows. */
export const N = 48, MAX_BILLOWS = 24;
/** The trail's puffs: one every PUFF_SQ squares along it (the shader's cauliflower). */
export const PUFF_SQ = 0.075;
/** The trail (squares, seconds): radius at birth and at its full swell, the swell's time constant, the rise (sq/s), the wind drift
 * (sq/s at wind 1), the sideways wander (sq), the dissolve [start, end] (s of age), its jitter (s). */
export const TRAIL = { r0: 0.045, r1: 0.3, tau: 1.5, rise: 0.12, drift: 0.45, wander: 0.18, fade: [1.3, 3.6], jit: 0.9 };
/** The flight: corkscrew amplitude / period (sq), the bow (sq, at most, and as a share of the distance), the lob (sq, share). */
export const FLIGHT = { spiral: 0.022, period: 0.6, bow: [0.55, 0.06], lob: [0.45, 0.05], accel: [0.35, 0.85] };
/** The hiss before the launch (ms), the launch flash (ms), the sustainer (squares out, share of the way), its flash (ms). */
export const HISS_MS = 320, FLASH_MS = 70, SUSTAIN = [1.1, 0.25], SUSTAIN_MS = 60;
/** After the impact, the smoke has gone by (ms); the backblast cloud by (ms after the launch). */
export const TRAIL_END = 5200, BLAST_END = 4200;
/** The rocket on the art grid (squares): its length, its motor flame's longest tongue. */
export const BODY = { len: 0.26, flame: 0.2 };
/** The palette (CPU pixels): white-hot, yellow, orange, red, ember, pale, the body dark, the body light, the warhead olive. */
export const PAL = [0xfffbe8, 0xffe27a, 0xffa13a, 0xe0532a, 0x8a2e1a, 0xfff0c8, 0x24231f, 0x6c6a62, 0x4f5a31];
export const GLOW = [1, 0.95, 0.78, 0.5, 0.22, 0.6, 0, 0, 0];
export const SHADE = 0x120e0a, SHADE_A = [0.16, 0.34];

/** A small hash in [0, 1) of three integers (the same on every machine). */
export function h3(a, b, c) {
  let t = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const x = clamp((v - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

/** The time span (ms from T0) a rocket item draws in: [from, to]. */
export function spanOf(item) {
  const fl = Number(item?.fl) || 600, at = Number(item?.at) || -fl;
  return [Math.min(at, -fl - HISS_MS), Math.max(TRAIL_END, -fl + BLAST_END)];
}

/**
 * The FLIGHT of an item (once per firing and client): { tL (launch, ms), fl, shot, a (accel), D (px), u, n (unit along, normal),
 * xs, ys, zs, ts (the samples: scene px, height px, the moment passed), sus (the sustainer's way share or -1) }. `seed` the firing's.
 */
export function flightOf(item, seed, grid) {
  const g = grid, m = item.m, to = item.to, z0 = Number(item.z0) || 0, fl = Math.max(100, Number(item.fl) || 600), shot = !!item.shot;
  const dx = to[0] - m[0], dy = to[1] - m[1], D = Math.hypot(dx, dy) || 1, ux = dx / D, uy = dy / D, nx = -uy, ny = ux;
  const s0 = seed >>> 0, r = (k) => h3(s0, k, 4111);
  const bow = (r(1) - 0.5) * 2 * Math.min(FLIGHT.bow[0] * g, FLIGHT.bow[1] * D);
  const A = FLIGHT.spiral * g, P = FLIGHT.period * g, ph = r(2) * 6.2832;
  const lob = shot ? Math.min(FLIGHT.lob[0] * g, FLIGHT.lob[1] * D) : 0;
  const a = shot ? FLIGHT.accel[0] : FLIGHT.accel[1];
  const xs = new Float64Array(N), ys = new Float64Array(N), zs = new Float64Array(N), ts = new Float64Array(N);
  const F = { tL: -fl, fl, shot, a, D, ux, uy, nx, ny, m, to, z0, bow, A, P, ph, lob, g, xs, ys, zs, ts, sus: -1 };
  for ( let k = 0; k < N; k++ ) {
    const u = k / (N - 1), p = pointAt(F, u);
    xs[k] = p[0]; ys[k] = p[1]; zs[k] = p[2]; ts[k] = timeAt(F, u);
  }
  if ( shot ) F.sus = Math.min(SUSTAIN[0] * g, SUSTAIN[1] * D) / D;
  return F;
}
/** The path at u (0 the launch, 1 the target): [x, y, z] scene px. The corkscrew grows in over the first 0.6 squares. */
export function pointAt(F, u) {
  const s = u * F.D, grow = Math.min(1, s / (0.6 * F.g)), tail = Math.min(1, (1 - u) * F.D / (0.3 * F.g));
  const lat = F.bow * Math.sin(Math.PI * u) + F.A * grow * tail * Math.sin(6.2832 * s / F.P + F.ph);
  const z = F.shot ? F.z0 * (1 - u) + F.lob * 4 * u * (1 - u) : F.z0 * Math.pow(1 - u, 1.4);
  return [F.m[0] + F.ux * s + F.nx * lat, F.m[1] + F.uy * s + F.ny * lat, z];
}
/** When the rocket passes u (ms from T0). */
export function timeAt(F, u) {
  const a = F.a, tau = a >= 1 ? u : (-a + Math.sqrt(a * a + 4 * (1 - a) * u)) / (2 * (1 - a));
  return F.tL + F.fl * tau;
}
/** How far along (u) the rocket is at t (null: not in flight). */
export function uAt(F, t) {
  if ( t < F.tL || t > 0 ) return null;
  const tau = (t - F.tL) / F.fl;
  return F.a * tau + (1 - F.a) * tau * tau;
}

/** The screen cell of a scene point lifted z. */
const cellX = (x, geo) => (x - geo.ox) / geo.ap;
const cellY = (y, z, geo, lift) => (y - lift * z - geo.oy) / geo.ap;

/**
 * The TRAIL at time t: { n, S: Float32Array(4N) [x, y (cells), r (cells), density], T: Float32Array(4N) [age (s), s (cells along),
 * heat, warm], imp: [x, y, strength] (the fireball's light on the trail's last stretch) }. env { geo, lift, squash }.
 */
export function trailAt(F, t, env, out = { n: 0, S: new Float32Array(4 * N), T: new Float32Array(4 * N), imp: [0, 0, 0] }) {
  const { geo, lift } = env, g = F.g, C = g / geo.ap, seed = F.seedT ?? 0;
  const [wx, wy] = windOf(F);
  let n = 0;
  const push = (x, y, z, tb, k, s) => {
    const age = Math.max(0, (t - tb) / 1000);
    const swell = TRAIL.r0 + (TRAIL.r1 - TRAIL.r0) * (1 - Math.exp(-age / TRAIL.tau));
    const lump = 0.85 + 0.3 * h3(seed, k, 7);
    // (it wanders sideways more as it ages - two slow waves along the trail, each evolving)
    // (three waves of unrelated lengths, their sum's strength itself wandering along the trail: never a regular zigzag)
    const wk = TRAIL.wander * g * Math.min(1, age / 1.8) * (0.55 + 0.9 * (0.5 + 0.5 * Math.sin(s / (3.7 * g) * 6.2832 + 3.3 * F.ph)));
    const w = wk * (0.5 * Math.sin(s / (2.3 * g) * 6.2832 + F.ph + age * 0.45) + 0.32 * Math.sin(s / (1.07 * g) * 6.2832 + 2.1 * F.ph - age * 0.7)
      + 0.18 * Math.sin(s / (0.53 * g) * 6.2832 + 5.2 * F.ph + age * 1.1));
    const X = x + F.nx * w + wx * TRAIL.drift * g * age, Y = y + F.ny * w + wy * TRAIL.drift * g * age;
    const Z = z + TRAIL.rise * g * age;
    const j = (h3(seed, k, 9) - 0.5) * TRAIL.jit;
    let dens = (1 - 0.22 * smooth(0.4, 2.2, age)) * (1 - smooth(TRAIL.fade[0] + j, TRAIL.fade[1] + j, age));
    // (with no shooter the far end grows out of nothing: no hard start)
    if ( !F.shot ) dens *= smooth(0, 0.16 * F.D, s);
    // (with one, it starts thin at the muzzle: the smoke never sits on the shooter's token)
    else dens *= 0.25 + 0.75 * smooth(0.05 * g, 0.6 * g, s);
    const o = n * 4;
    out.S[o] = cellX(X, geo); out.S[o + 1] = cellY(Y, Z, geo, lift); out.S[o + 2] = Math.max(0.8, swell * lump * C); out.S[o + 3] = dens;
    out.T[o] = age; out.T[o + 1] = s / geo.ap; out.T[o + 2] = Math.max(0, 1 - age / 0.06); out.T[o + 3] = Math.max(0, 1 - age / 0.24);
    n++;
  };
  const uNow = uAt(F, t);
  for ( let k = 0; k < N; k++ ) {
    if ( F.ts[k] > t ) break;
    push(F.xs[k], F.ys[k], F.zs[k], F.ts[k], k, (k / (N - 1)) * F.D);
  }
  // the head: the trail reaches the motor flame's tail exactly
  if ( uNow !== null && n > 0 && n < N ) {
    const p = pointAt(F, uNow), back = Math.max(0, uNow - (BODY.len * 0.5 * g) / F.D), q = pointAt(F, back);
    push(q[0], q[1], q[2], t, n + 101, back * F.D);
  } else if ( uNow !== null && n === 0 ) { const q = pointAt(F, 0); push(q[0], q[1], q[2], t, 101, 0); }
  out.n = n;
  // the fireball lights the trail's last stretch for a moment
  const k = t > 0 ? Math.max(0, 1 - t / 650) : 0;
  out.imp[0] = cellX(F.to[0], geo); out.imp[1] = cellY(F.to[1], 0, geo, lift); out.imp[2] = k * k;
  return out;
}

/** The wind (unit-ish vector times speed 0..1) of the item: the stored one (every client the same). */
export function windOf(F) { const a = (F.wd || 0) * Math.PI / 180, s = F.ws || 0; return [Math.cos(a) * s, Math.sin(a) * s]; }

/**
 * The BILLOWS at time t (only with a shooter): the hiss's wisps, the backblast cloud, the muzzle puff. { n, B: Float32Array(4M) [x, y
 * (cells), r (cells), density], B2: [age (s), heat, warm, kind (0 smoke, 1 dust-tan)] }. `from` the shooter's centre, `fr` its radius.
 */
export function billowsAt(F, item, t, env, out = { n: 0, B: new Float32Array(4 * MAX_BILLOWS), B2: new Float32Array(4 * MAX_BILLOWS) }) {
  out.n = 0;
  if ( !F.shot || !Array.isArray(item.from) ) return out;
  const { geo, lift } = env, g = F.g, s0 = (F.seedT ?? 0) ^ 0x5bd1;
  const fr = Number.isFinite(item.fr) ? item.fr : 0.5 * g;
  const rear = [item.from[0] - F.ux * (fr + 0.12 * g), item.from[1] - F.uy * (fr + 0.12 * g)], zr = 0.3 * g;
  const [wx, wy] = windOf(F);
  const add = (x, y, z, r, dens, age, heat, warm, kind) => {
    if ( out.n >= MAX_BILLOWS || dens <= 0.01 || r <= 0 ) return;
    const o = out.n * 4;
    out.B[o] = cellX(x, geo); out.B[o + 1] = cellY(y, z, geo, lift); out.B[o + 2] = Math.max(0.8, r / geo.ap); out.B[o + 3] = dens;
    out.B2[o] = age; out.B2[o + 1] = heat; out.B2[o + 2] = warm; out.B2[o + 3] = kind;
    out.n++;
  };
  // THE HISS: thin wisps out of the tube's rear, one after another, drifting back
  for ( let i = 0; i < 4; i++ ) {
    const tb = F.tL - HISS_MS + i * 75, age = (t - tb) / 1000; if ( age < 0 ) continue;
    const L = 0.7 + 0.4 * h3(s0, i, 1); if ( age > L ) continue;
    const ang = Math.atan2(-F.uy, -F.ux) + (h3(s0, i, 2) - 0.5) * 0.9, d = (0.12 + 0.25 * age) * g;
    add(rear[0] + Math.cos(ang) * d, rear[1] + Math.sin(ang) * d, zr + 0.1 * g * age, (0.05 + 0.1 * Math.min(1, age / 0.4)) * g, 1 - smooth(0.4 * L, L, age), age, 0, 0.25 * Math.max(0, 1 - age / 0.3), 0);
  }
  const age = (t - F.tL) / 1000;
  if ( age < 0 ) return out;
  // THE BACKBLAST: thrown back out of the tube in a cone, slowed by the air, hot for a moment, swelling into a grey-tan cloud that
  // rises a little, drifts and breaks up (low ones are the ground's dust kicked up)
  for ( let i = 0; i < 14; i++ ) {
    const low = i >= 10, r1 = h3(s0, i, 11), r2 = h3(s0, i, 12), r3 = h3(s0, i, 13), r4 = h3(s0, i, 14);
    const L = (low ? 2.4 : 2.8) + 1.0 * r4; if ( age > L ) continue;
    const ang = Math.atan2(-F.uy, -F.ux) + (r1 - 0.5) * (low ? 1.9 : 1.05);
    const v = (low ? 3.2 : 3.6 + 2.6 * r2) * g, tau = 0.22 + 0.1 * r3, d = (low ? 0.2 : 0.05) * g + v * tau * (1 - Math.exp(-age / tau));
    const x = rear[0] + Math.cos(ang) * d + wx * TRAIL.drift * g * age, y = rear[1] + Math.sin(ang) * d + wy * TRAIL.drift * g * age;
    const z = (low ? 0.04 * g : zr * (0.6 + 0.5 * r3)) + TRAIL.rise * 0.8 * g * age;
    const r = g * (low ? 0.12 + 0.24 * (1 - Math.exp(-age / 0.6)) : 0.09 + (0.3 + 0.16 * r2) * (1 - Math.exp(-age / 0.55)));
    const j = (r4 - 0.5) * 0.6, dens = 1 - smooth(1.2 + j, L, age);
    add(x, y, z, r, dens, age, low ? 0 : Math.max(0, 1 - age / 0.08), low ? 0 : Math.max(0, 1 - age / 0.3), low ? 1 : (i % 3 === 0 ? 1 : 0));
  }
  // THE MUZZLE PUFF: a few small billows pushed forward out of the tube's mouth
  for ( let i = 0; i < 3; i++ ) {
    const L = 1.2 + 0.6 * h3(s0, i, 21); if ( age > L ) continue;
    const ang = Math.atan2(F.uy, F.ux) + (h3(s0, i, 22) - 0.5) * 1.6, d = 0.22 * g * (1 - Math.exp(-age / 0.15));
    add(F.m[0] + Math.cos(ang) * d, F.m[1] + Math.sin(ang) * d, F.z0 + 0.1 * g * age, g * (0.05 + 0.14 * (1 - Math.exp(-age / 0.4))), 1 - smooth(0.5, L, age), age, Math.max(0, 1 - age / 0.06), Math.max(0, 1 - age / 0.25), 0);
  }
  return out;
}

/** The box (cells, [x0, y0, x1, y1]) that holds everything the smoke may draw at any time of its life, at this view: once per firing. */
export function boxOf(F, item, env) {
  const { geo, lift } = env, g = F.g, C = g / geo.ap;
  const [wx, wy] = windOf(F), life = TRAIL_END / 1000 + 1;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (x, y, z) => { const X = cellX(x, geo), Y = cellY(y, z, geo, lift); x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); };
  const dr = TRAIL.drift * g * life;
  for ( let k = 0; k < N; k++ ) for ( const [ex, ey, ez] of [[0, 0, 0], [wx * dr, wy * dr, TRAIL.rise * g * life]] ) take(F.xs[k] + ex, F.ys[k] + ey, F.zs[k] + ez);
  if ( F.shot && Array.isArray(item.from) ) {
    const R = 2.2 * g;
    for ( const [ex, ey] of [[-R, -R], [R, R]] ) for ( const ez of [0, 0.3 * g + TRAIL.rise * g * 5] ) take(item.from[0] + ex + wx * dr, item.from[1] + ey + wy * dr, ez);
    take(item.from[0] - R, item.from[1] - R, 0); take(item.from[0] + R, item.from[1] + R, 0);
  }
  const pad = Math.ceil((TRAIL.r1 * 1.5 + TRAIL.wander + 0.3) * C);
  return [Math.floor(x0) - pad, Math.floor(y0) - pad, Math.ceil(x1) + pad, Math.ceil(y1) + pad];
}

/* ---------------------------------------------------------------- the pixels (CPU) */

export const newPix = () => ({ px: PAL.map(() => []), shade: [[], []], glows: [], live: false });
export function clearPix(P) { for ( const a of P.px ) a.length = 0; P.shade[0].length = 0; P.shade[1].length = 0; P.glows.length = 0; P.live = false; return P; }
const scr = (env, x, y, z) => [Math.floor(cellX(x, env.geo)), Math.floor(cellY(y, z, env.geo, env.lift))];
function put(P, env, x, y, z, c) { const [cx, cy] = scr(env, x, y, z); P.px[c].push(cx, cy); }
function star(P, cx, cy, { arm, side, dir, big = true, c0 = 0, c1 = 1, c2 = 2 }) {
  if ( big ) P.px[c0].push(cx, cy, cx + 1, cy, cx, cy + 1, cx + 1, cy + 1); else P.px[c0].push(cx, cy);
  const fx = Math.round(dir[0]) || (Math.round(dir[1]) ? 0 : 1), fy = Math.round(dir[1]);
  for ( const [ax, ay, L] of [[fx, fy, arm], [-fx, -fy, side], [-fy, fx, side], [fy, -fx, side]] ) {
    for ( let i = 1; i <= L; i++ ) { const ox = ax > 0 && big ? 1 : 0, oy = ay > 0 && big ? 1 : 0; P.px[i === L ? c2 : c1].push(cx + ox + ax * i, cy + oy + ay * i); }
  }
}
/** A soft dithered ground shadow (two steps) of radius r px, density 0..1. */
function shadow(P, env, x, y, r, dens) {
  if ( !(dens > 0.01) ) return;
  const ap = env.geo.ap, rx = Math.max(1, r / ap), ry = Math.max(1, rx * (env.squash ?? 0.8)), [cx, cy] = scr(env, x, y, 0);
  for ( let j = -Math.ceil(ry); j <= Math.ceil(ry); j++ ) for ( let i = -Math.ceil(rx); i <= Math.ceil(rx); i++ ) {
    const e = Math.hypot((i + 0.5) / rx, (j + 0.5) / ry); if ( e >= 1 ) continue;
    const v = dens * (1 - smooth(0.25, 1, e)), th = h3((cx + i) >> 1, (cy + j) >> 1, 91);
    if ( th < v ) P.shade[1].push(cx + i, cy + j); else if ( th < Math.min(0.97, v * 1.9) ) P.shade[0].push(cx + i, cy + j);
  }
}

/**
 * The PIXELS of a rocket at time t into P (newPix): the hiss's sparks, the launch flash (muzzle and backblast), the rocket and its
 * motor flame, its ground shadow, the sustainer's flash, the sparks it sheds; and the LIGHTS (P.glows: [x, y, radius px, intensity,
 * palette colour]). env { geo, lift, squash, q (the guard: the share of sparks) }.
 */
export function pixelsAt(F, item, t, env, P) {
  const g = F.g, q = env.q ?? 1, s0 = (F.seedT ?? 0) ^ 0x2c1b;
  const sp = spanOf(item);
  if ( t > sp[1] ) return P;
  P.live = true;
  const fr = Number.isFinite(item.fr) ? item.fr : 0.5 * g;
  const shotFrom = F.shot && Array.isArray(item.from);
  const rear = shotFrom ? [item.from[0] - F.ux * fr * 0.95, item.from[1] - F.uy * fr * 0.95] : null, zr = 0.3 * g;
  // THE HISS: sparks sputtering out of the tube's rear, more and more as the launch nears
  if ( shotFrom && t >= F.tL - HISS_MS && t < F.tL + 60 ) {
    const nSlot = Math.floor((t - (F.tL - HISS_MS)) / 30);
    for ( let k = Math.max(0, nSlot - 5); k <= nSlot; k++ ) {
      const ts = F.tL - HISS_MS + k * 30, a = t - ts; if ( a < 0 || a > 150 ) continue;
      const n = 1 + (k > 6 ? 1 : 0);
      for ( let i = 0; i < n; i++ ) {
        if ( h3(s0, k * 7 + i, 3) > q ) continue;
        const ang = Math.atan2(-F.uy, -F.ux) + (h3(s0, k * 7 + i, 1) - 0.5) * 1.2, v = (1.2 + 1.6 * h3(s0, k * 7 + i, 2)) * g / 1000;
        const x = rear[0] + Math.cos(ang) * v * a, y = rear[1] + Math.sin(ang) * v * a * (env.squash ?? 0.8), z = zr + 0.4 * g / 1000 * a - 0.5 * 6 * g / 1e6 * a * a;
        if ( z < 0 ) continue;
        put(P, env, x, y, z, a < 40 ? 1 : a < 90 ? 2 : 3);
      }
    }
    const f = smooth(F.tL - HISS_MS, F.tL, t);
    P.glows.push(rear[0], rear[1], 0.9 * g, 0.35 * f, 2);
  }
  // THE LAUNCH: the muzzle flash (front) and the backblast's flash out of the rear, both lighting the ground
  const al = t - F.tL;
  if ( shotFrom && al >= 0 && al < FLASH_MS ) {
    const big = al < FLASH_MS * 0.5, [mx, my] = scr(env, F.m[0], F.m[1], F.z0), [bx, by] = scr(env, rear[0], rear[1], zr);
    const dir = [F.ux, F.uy * (env.squash ?? 0.8)];
    star(P, mx, my, big ? { arm: 4, side: 2, dir } : { arm: 2, side: 1, dir, big: false, c0: 1, c1: 2, c2: 3 });
    star(P, bx, by, big ? { arm: 6, side: 3, dir: [-dir[0], -dir[1]] } : { arm: 3, side: 2, dir: [-dir[0], -dir[1]], big: false, c0: 1, c1: 2, c2: 3 });
  }
  if ( shotFrom && al >= 0 && al < 420 ) { const f = 1 - al / 420; P.glows.push(rear[0], rear[1], 2.6 * g, f * f * 1.1, 1); P.glows.push(F.m[0], F.m[1], 1.4 * g, f * f * 0.8, 1); }
  // THE ROCKET in flight
  const u = uAt(F, t);
  if ( u !== null && t < 0 ) {
    // (its screen heading: from a point a little behind it)
    const p = pointAt(F, u), p0 = pointAt(F, Math.max(0, u - 0.02)), p2 = u - 0.02 > 0 ? p : pointAt(F, 0.02), p1 = u - 0.02 > 0 ? p0 : pointAt(F, 0);
    const ap0 = env.geo.ap, sx = (p2[0] - p1[0]) / ap0, sy = ((p2[1] - env.lift * p2[2]) - (p1[1] - env.lift * p1[2])) / ap0;
    const sl = Math.hypot(sx, sy) || 1, ax = sx / sl, ay = sy / sl, nx = -ay, ny = ax;
    const [cx, cy] = scr(env, p[0], p[1], p[2]), ap = env.geo.ap;
    const hl = Math.max(2.5, BODY.len * 0.5 * g / ap), hw = Math.max(0.9, 0.035 * g / ap);
    // the body: warhead (olive, the front third, round at the nose), the tube body (dark, its upper side lit), fins at the tail
    const R = Math.ceil(hl + 2);
    for ( let j = -R; j <= R; j++ ) for ( let i = -R; i <= R; i++ ) {
      const px = i + 0.5, py = j + 0.5, al2 = px * ax + py * ay, ac = px * nx + py * ny;
      const head = al2 > hl * 0.25, w = head ? hw * 1.25 * Math.sqrt(Math.max(0, 1 - ((al2 - hl * 0.25) / (hl * 0.75)) ** 2)) : hw;
      const body = al2 > -hl && al2 < hl && Math.abs(ac) < w;
      const fin = al2 < -hl * 0.6 && al2 > -hl - 0.6 && Math.abs(ac) < hw + 1.0;
      if ( !body && !fin ) continue;
      const lit = (ac * Math.sign(nx + ny || 1)) < -0.2 * hw;
      P.px[head && body ? 8 : lit ? 7 : 6].push(cx + i, cy + j);
    }
    // the MOTOR FLAME behind it: a white-hot core, yellow, an orange tongue that flickers (a new length every 40 ms), a dithered tip
    const fl = Math.max(3, BODY.flame * g / ap) * (0.65 + 0.5 * h3(s0, Math.floor(t / 40), 5));
    const tx = cx + Math.round(-ax * (hl + 0.5)), ty = cy + Math.round(-ay * (hl + 0.5));
    for ( let k = 0; k <= Math.ceil(fl); k++ ) {
      const v = k / fl, X = Math.round(tx - ax * k), Y = Math.round(ty - ay * k);
      const c = v < 0.2 ? 0 : v < 0.45 ? 1 : v < 0.75 ? 2 : (k & 1) ? 3 : -1;
      if ( c >= 0 ) P.px[c].push(X, Y);
      if ( v < 0.5 ) { P.px[v < 0.25 ? 0 : 1].push(X + Math.round(nx), Y + Math.round(ny)); }
    }
    // its shadow on the ground (how high it flies), and its light
    shadow(P, env, p[0], p[1], 0.11 * g * (1 + p[2] / (2 * g)), 0.55 / (1 + 1.2 * p[2] / g));
    P.glows.push(p[0], p[1] - env.lift * p[2] * 0.5, 1.9 * g, 0.65 + 0.2 * h3(s0, Math.floor(t / 50), 6), 2);
    // sparks shed from the flame: falling and cooling
    for ( let k = Math.floor((t - 160) / 22); k <= Math.floor(t / 22); k++ ) {
      const ts = k * 22, a = t - ts; if ( a < 0 || a > 160 || ts < F.tL ) continue;
      if ( h3(s0, k, 31) > 0.7 * q ) continue;
      const uk = uAt(F, ts); if ( uk === null ) continue;
      const pk = pointAt(F, Math.max(0, uk - BODY.len * 0.6 * g / F.D)), ang = h3(s0, k, 32) * 6.2832, v = (0.3 + 0.5 * h3(s0, k, 33)) * g / 1000;
      const z = pk[2] - 0.5 * 9 * g / 1e6 * a * a; if ( z < 0 ) continue;
      put(P, env, pk[0] + Math.cos(ang) * v * a, pk[1] + Math.sin(ang) * v * a * 0.8, z, a < 50 ? 1 : a < 110 ? 2 : 3);
    }
  }
  // THE SUSTAINER kicks in a short way out: a small flash
  if ( F.sus > 0 ) {
    const ts = timeAt(F, F.sus), a = t - ts;
    if ( a >= 0 && a < SUSTAIN_MS ) {
      const p = pointAt(F, F.sus), [cx, cy] = scr(env, p[0], p[1], p[2]);
      star(P, cx, cy, a < SUSTAIN_MS / 2 ? { arm: 3, side: 2, dir: [-F.ux, -F.uy] } : { arm: 2, side: 1, dir: [-F.ux, -F.uy], big: false, c0: 1, c1: 2, c2: 3 });
      P.glows.push(p[0], p[1], 1.6 * g, 0.7 * (1 - a / SUSTAIN_MS), 1);
    }
  }
  return P;
}

/** Prepare a flight for drawing (seed of the trail's look; the art grid's cell size helper). */
export function prepare(item, seed, grid) {
  const F = flightOf(item, seed, grid);
  F.seedT = (seed ^ 0x6a09e667) >>> 0;
  F.wd = Number(item.wd) || 0; F.ws = Number(item.ws) || 0;
  return F;
}
