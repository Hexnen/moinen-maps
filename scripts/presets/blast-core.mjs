/**
 * DESTRUCTION PRESETS, the BLAST - the pure part (no Foundry, no PIXI: node-tested in dev/presets-blast.test.mjs; drawn by blast.mjs).
 * dev/presets-design.md section 24 (round 3). The first second of a bomb's or a grenade's detonation, drawn at the DISPLAY's frame rate
 * (the explosion fire under it - fire/burst-art.mjs - runs at the fire's 12 fps: its first frame can land up to 83 ms after the impact,
 * so on its own the impact popped in a frame late and grew in 12 fps steps):
 *   FLASH    a white-hot ragged ball that swells in over three display frames, throws short tongues of flame out (a different set each
 *            firing), then cools from the outside in (cream, yellow, orange, red) and breaks up by dropout over the fireball the fire
 *            layer has grown under it meanwhile - never a disc held still
 *   RING     the air's shock: a thin pale ragged ring racing out over the ground (fast, slowing), broken into arcs, gone by dropout
 *   STREAKS  shrapnel and burning fragments: thin streaks flying out on low arcs, white-hot heads with cooling tails, a few glancing
 *   JETS     the soil thrown up: dark tapered jets of earth shooting out and up from the crater (the crown of a ground burst), which
 *            slow, swell, pale into dust and crumble from the tip while their CLODS rain back down
 *   CLODS    lumps of earth (and, for a bomb, a few burning ones) on ballistic arcs, gone where they land
 *   LIGHT    one smooth pool of light under the flash for the night, on from the impact's own display frame, decaying into the fire
 *            layer's own burst light (which only updates at 12 fps)
 * Everything is a pure function of (the accent item, the firing's seed, the time since T0, the view): every client draws the same frames,
 * a late joiner sees what is still in the air. Positions in ART CELLS of the destruction layer's art grid (geo { ap, ox, oy, grid }) on
 * the SCREEN plane of the oblique view (a height z is drawn lift x z up the screen).
 */

/** Uniform array sizes (blast.mjs keeps its shader in step). */
export const MAX_RAYS = 16, MAX_STREAKS = 32, MAX_JETS = 16, MAX_CLODS = 48;
/**
 * Per LEVEL ([_, L1 grenade, L2 shell, L3 bomb]); lengths in multiples of the item's r (the fireball radius) unless named sq (grid squares),
 * times in ms. flash: [life, rays]; ring: [reach sq, tau, life]; streaks: [n, speed sq/s, life]; jets: [n, length (x r), root width sq,
 * life]; clods: [n, embers share].
 */
export const LV = {
  flash: [null, [170, 12], [220, 14], [270, 16]],
  ring: [null, [1.9, 90, 380], [3.0, 100, 450], [4.6, 115, 560]],
  streaks: [null, [18, 9, 330], [22, 11, 380], [26, 13, 430]],
  jets: [null, [0, 1.35, 0.1, 950], [0, 1.5, 0.15, 800], [0, 1.45, 0.15, 700]],
  clods: [null, [30, 0.1], [30, 0.2], [40, 0.3]]
};
/** Gravity (squares / s^2) for streaks and clods: a little heavier than true scale, so the arcs read at the table. */
export const GRAV = 22;
/** The palette: white-hot, cream, yellow, orange, red, ember, the shock ring (pale, its shade), soil (dark, mid, lit, dust). */
export const PAL = [0xfffbe8, 0xfff0c8, 0xffe27a, 0xffa13a, 0xe0532a, 0x8a2e1a, 0xf4eddf, 0xb9ae9c, 0x2e231b, 0x4a392b, 0x6b5641, 0x9a8a72];

/** A small hash in [0, 1) of three integers (the same on every machine). */
export function h3(a, b, c) {
  let t = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const x = clamp((v - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const lvOf = (item) => clamp(Number(item?.lv) | 0 || 3, 1, 3);
/** The light's end (ms): it eases to nothing by then (inside the span - it never pops off with the renderer). */
const LIGHT_END = [0, 1100, 2000, 2000];

/** The time span (ms from T0) a blast item draws in: [from, to] (everything has landed or crumbled by then). */
export function spanOf(item) {
  const lv = lvOf(item), at = Number(item?.at) || 0;
  return [at, at + Math.max(LV.jets[lv][3], LV.ring[lv][2], LIGHT_END[lv]) + 500];
}

/**
 * The bodies of a blast, once per firing and client: { lv, R (cells: the fireball radius), g (cells per square), x, y (cells: the ground
 * point), seed, rays, streaks, jets, clods } - every random choice from the seed.
 */
export function prepare(item, seed, geo) {
  const lv = lvOf(item), g = geo.grid / geo.ap, R = Math.max(2, (Number(item.r) || geo.grid) / geo.ap);
  const x = (item.x - geo.ox) / geo.ap, y = (item.y - geo.oy) / geo.ap, s = seed | 0;
  const [, nRay] = LV.flash[lv], rays = [];
  // (short lumpy tongues of flame, never the spikes of a cartoon star)
  for ( let i = 0; i < nRay; i++ ) rays.push({ a: 6.2832 * (i + 0.8 * (h3(s, i, 1) - 0.5)) / nRay, L: 0.1 + 0.38 * h3(s, i, 2) ** 1.6, w: 5 + 9 * h3(s, i, 3), d: 30 * h3(s, i, 4) });
  const [nS, vS, lS] = LV.streaks[lv], streaks = [];
  for ( let i = 0; i < nS; i++ ) {
    streaks.push({ a: 6.2832 * h3(s, 100 + i, 1), e: 0.08 + 0.7 * h3(s, 100 + i, 2), v: vS * (0.55 + 0.6 * h3(s, 100 + i, 3)) * g, L: lS * (0.45 + 0.55 * h3(s, 100 + i, 4)),
      d0: 30 * h3(s, 100 + i, 5), w: h3(s, 100 + i, 6) < (lv === 3 ? 0.35 : 0.15) ? 2 : 1 });
  }
  const [nJ, lJ, wJ, life] = LV.jets[lv], jets = [];
  for ( let i = 0; i < nJ; i++ ) {
    // (spread round the whole ring, a little uneven: a crown, never a regular star)
    const a = 6.2832 * (i + 0.8 * (h3(s, 200 + i, 1) - 0.5)) / nJ;
    jets.push({ a, e: 0.75 + 0.6 * h3(s, 200 + i, 2), L: R * lJ * (0.55 + 0.6 * h3(s, 200 + i, 3)), w: wJ * g * (0.7 + 0.5 * h3(s, 200 + i, 4)),
      d0: 40 * h3(s, 200 + i, 5), life: life * (0.75 + 0.25 * h3(s, 200 + i, 6)) });
  }
  const [nC, emb] = LV.clods[lv], clods = [];
  for ( let i = 0; i < nC; i++ ) {
    // (thrown along a jet; with none - a bomb: its fireball is the column - all round, steep)
    const j = nJ ? jets[i % nJ] : { a: 6.2832 * h3(s, 300 + i, 7), e: 0.6 + 0.6 * h3(s, 300 + i, 8), d0: 0 };
    clods.push({ a: j.a + (h3(s, 300 + i, 1) - 0.5) * 0.7, e: clamp(j.e + (h3(s, 300 + i, 2) - 0.5) * 0.5, 0.25, 1.35),
      v: (lv === 1 ? 4.5 : 6.5) * g * (0.5 + 0.7 * h3(s, 300 + i, 3)), t0: j.d0 + 40 + 220 * h3(s, 300 + i, 4), sz: h3(s, 300 + i, 5) < 0.3 ? 2 : 1, hot: h3(s, 300 + i, 6) < emb });
  }
  return { lv, R, g, x, y, seed: s, rays, streaks, jets, clods };
}

/** The box (cells: [x0, y0, x1, y1]) everything of a blast can reach, at the view `env` { lift, squash } (any lift up to 0.8). */
export function boxOf(B) {
  const { R, g, lv } = B, ring = LV.ring[lv][0] * g, str = LV.streaks[lv][1] * g * 1.15 * LV.streaks[lv][2] / 1000;
  const jet = Math.max(0, ...B.jets.map((j) => j.L)) * 1.25, clod = Math.max(...B.clods.map((c) => c.v)) ** 2 / (GRAV * g) * 1.1;
  const D = Math.max(ring, str, jet, clod, 2.2 * R) + 4, Z = Math.max(jet, clod * 0.6, 2 * R) * 0.8 + 4;
  return [Math.floor(B.x - D), Math.floor(B.y - D - Z), Math.ceil(B.x + D), Math.ceil(B.y + D)];
}

/** One frame's uniforms (cells relative to the box origin bx, by), written into `out` (no garbage). */
export const newFrame = () => ({
  fl: new Float32Array(4), fl2: new Float32Array(4), ray: new Float32Array(4 * MAX_RAYS), nRay: 0,
  ring: new Float32Array(4), ring2: new Float32Array(4),
  st: new Float32Array(4 * MAX_STREAKS), st2: new Float32Array(4 * MAX_STREAKS), nSt: 0,
  jet: new Float32Array(4 * MAX_JETS), jet2: new Float32Array(4 * MAX_JETS), nJet: 0,
  cl: new Float32Array(4 * MAX_CLODS), nCl: 0, light: [0, 0, 0, 0], any: false
});

/**
 * THE BLAST AT `t` ms after the impact: every body into `out` (cells relative to the box origin [bx, by]); env { lift, squash, q (the
 * guard: the share of streaks and clods, never the flash, ring or jets) }. Returns out (out.any: something is drawn).
 *   fl   [cx, cy, core radius, heat 0..1]      fl2 [squash, rays' reach share, t ms, breakup 0..1]
 *   ray  per tongue [angle, length (cells), sharpness, 0]
 *   ring [cx, cy, radius, thickness]           ring2 [age share 0..1, squash, 0, 0]
 *   st   per streak [head x, y, tail x, y]      st2 [heat 0..1, width (cells), 0, 0]
 *   jet  per jet [root x, y, tip x, y]          jet2 [root half-width, crumble 0..1 (from the tip), dust share 0..1, lit 0..1]
 *   cl   per clod [x, y, size (cells), heat 0..1 (0: earth)]
 *   light [x (cells, absolute), y, radius (cells), intensity 0..1]
 */
export function frameAt(B, t, env, bx, by, out = newFrame()) {
  const { lv, R, g, x, y, seed } = B, lift = env?.lift ?? 0.5, sq = env?.squash ?? 0.8, q = clamp(env?.q ?? 1, 0.25, 1);
  out.nRay = out.nSt = out.nJet = out.nCl = 0; out.any = false;
  out.fl.fill(0); out.ring.fill(0); out.light[3] = 0;
  if ( t < 0 ) return out;
  // FLASH: swells over ~3 display frames, holds white for a few, cools and breaks up (the fire's fireball has grown under it by then)
  const [fLife] = LV.flash[lv], zf = 0.32 * R;
  if ( t < fLife ) {
    const up = smooth(0, 45, t), cool = smooth(55, fLife, t);
    out.fl.set([x - bx, y - by - zf * lift, R * (0.14 + 0.36 * up + 0.14 * cool), 1 - cool]);
    out.fl2.set([sq, smooth(0, 60, t) * (1 - 0.6 * smooth(60, fLife, t)), t, smooth(fLife * 0.3, fLife, t)]);
    for ( const r of B.rays ) {
      if ( out.nRay >= MAX_RAYS ) break;
      const k = smooth(r.d, r.d + 50, t);
      out.ray.set([r.a, R * r.L * k, r.w, 0], out.nRay * 4); out.nRay++;
    }
    out.any = true;
  }
  // RING: races out and slows; arcs drop out as it ages
  const [rReach, rTau, rLife] = LV.ring[lv];
  if ( t < rLife ) {
    const u = t / rLife, rr = rReach * g * (1 - Math.exp(-t / rTau)) / (1 - Math.exp(-rLife / rTau));
    out.ring.set([x - bx, y - by, Math.max(0.5, rr), (lv === 1 ? 1.2 : 1.6) + 2.2 * (1 - u)]);
    out.ring2.set([u, sq, 0, 0]);
    out.any = true;
  }
  // STREAKS: out with drag on low arcs, the tail 40 ms behind, cooling; the guard thins them
  const nS = Math.round(B.streaks.length * q), G = GRAV * g / 1e6;
  for ( let i = 0; i < nS && out.nSt < MAX_STREAKS; i++ ) {
    const s = B.streaks[i], a = t - s.d0;
    if ( a < 0 || a > s.L ) continue;
    const pos = (u) => { const e = (1 - Math.exp(-u / 220)) * 220, d = s.v * e / 1000, z = zf * 0.6 + d * Math.sin(s.e) - 0.5 * G * u * u; return [x + Math.cos(s.a) * d * Math.cos(s.e), y + Math.sin(s.a) * d * Math.cos(s.e) * sq, Math.max(0, z)]; };
    const [hx, hy, hz] = pos(a), [tx, ty, tz] = pos(Math.max(0, a - 40));
    out.st.set([hx - bx, hy - by - hz * lift, tx - bx, ty - by - tz * lift], out.nSt * 4);
    out.st2.set([1 - a / s.L, s.w, 0, 0], out.nSt * 4); out.nSt++;
    out.any = true;
  }
  // JETS: shoot out and up fast, slow, swell, pale into dust and crumble from the tip
  for ( const j of B.jets ) {
    if ( out.nJet >= MAX_JETS ) break;
    const a = t - j.d0;
    if ( a < 0 || a > j.life ) continue;
    const grow = 1 - Math.exp(-a / 70), drift = 1 + 0.25 * smooth(150, j.life, a), L = j.L * grow * drift;
    const rx = x + Math.cos(j.a) * R * 0.22, ry = y + Math.sin(j.a) * R * 0.22 * sq;
    const tx = rx + Math.cos(j.a) * L * Math.cos(j.e), ty = ry + Math.sin(j.a) * L * Math.cos(j.e) * sq, tz = L * Math.sin(j.e) - 0.5 * G * 0.25 * Math.max(0, a - 250) ** 2;
    const u = a / j.life;
    out.jet.set([rx - bx, ry - by, tx - bx, ty - by - Math.max(0, tz) * lift], out.nJet * 4);
    out.jet2.set([j.w * (0.55 + 0.45 * grow) * (1 + 0.6 * smooth(0.2, 0.8, u)), smooth(0.28, 0.95, u), smooth(0.15, 0.7, u), 1 - smooth(0, 220, a)], out.nJet * 4);
    out.nJet++; out.any = true;
  }
  // CLODS: ballistic, gone where they land (a burning one cools)
  const nC = Math.round(B.clods.length * q);
  for ( let i = 0; i < nC && out.nCl < MAX_CLODS; i++ ) {
    const c = B.clods[i], a = t - c.t0;
    if ( a < 0 ) continue;
    const vh = c.v * Math.cos(c.e) / 1000, vz = c.v * Math.sin(c.e) / 1000, z = R * 0.4 + vz * a - 0.5 * G * a * a;
    if ( z < 0 ) continue;
    const px = x + Math.cos(c.a) * vh * a, py = y + Math.sin(c.a) * vh * a * sq;
    out.cl.set([px - bx, py - by - z * lift, c.sz, c.hot ? Math.max(0.05, 1 - a / 900) : 0], out.nCl * 4); out.nCl++;
    out.any = true;
  }
  // LIGHT: on at the impact's own frame, a fast swell (two display frames), a decay the fire layer's burst light takes over from
  const lt = smooth(0, 35, t) * Math.exp(-t / (lv === 1 ? 260 : 520)) * (lv === 1 ? 0.75 : 1) * (1 - smooth(0.55 * LIGHT_END[lv], LIGHT_END[lv], t));
  if ( lt > 0.01 ) { out.light[0] = x; out.light[1] = y - zf * lift; out.light[2] = R * (lv === 1 ? 5 : 6.5); out.light[3] = lt; out.any = true; }
  return out;
}
