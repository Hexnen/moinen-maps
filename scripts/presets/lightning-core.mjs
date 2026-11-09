import { stream } from "./core.mjs";

/**
 * DESTRUCTION PRESETS, the LIGHTNING STRIKE accent - the pure part (no Foundry, no PIXI: node-tested in
 * dev/presets-lightning.test.mjs; drawn by lightning.mjs). dev/presets-design.md section 18.
 *
 * One accent item { kind: "strike", at, dur, lv } of a firing record; its place (rec.at), lean (rec.dir), size and seed are the
 * record's. Everything below is a pure function of (the record, the shared clock), so every client draws the same strike and a late
 * joiner sees whatever is still in flight.
 *   timing      the strokes: the return stroke at T0 and 1-3 restrikes down the same channel (times, strengths)
 *   frameAt     the state of a frame at t (ms from T0): the leader's front, the channel's / branches' / arcs' brightness, the
 *               bottom-up wipe, the afterglow's cut, the plasma's heat, the screen flash, the night light
 *   strikeData  the GEOMETRY rasterised on the art grid into a DATA TEXTURE (RGBA8 per art pixel): R the arrival (leader time, or
 *               the outward time of a ground arc), G the class (a core pixel 1..7; a glow pixel 16 + its nearest core's class), B the
 *               distance to the nearest core (chamfer 3-4 units, cap GLOW_CAP), A a dropout hash; plus the occupied BLOCKS
 *   spray / crackle   the few CPU pixels: molten droplets after the strike, the crackle of the charge before it
 * Coordinates: squares on the ground (x, y) and in height (z), projected with the view: screen = (x, y - lift z), a ground decal's
 * y squashed. The art pixel is the destruction layer's (S art px per square).
 */
export const KIND = "strike";
/** Pixel classes in the data texture (G). */
export const CLS = Object.freeze({ MAIN: 1, SIDE: 2, BRANCH: 3, TWIG: 4, STREAM: 5, ARC: 6, PLASMA: 7, GLOW: 16 });
/** Which class wins a shared pixel. */
const PRIO = [0, 7, 6, 4, 3, 1, 2, 5];
/** The glow's reach (art px) round a core pixel of each class at full brightness. */
export const GLOW_R = [0, 10, 10, 5, 3, 2, 4, 9];
/** The glow bands stop here (chamfer units: 3 per art px). */
export const GLOW_CAP = 45;
/** Blocks of the drawn geometry (art px). */
export const BLOCK = 16;
/** The channel's top: this many squares above the target; a drag leans it LEAN_SQ squares back along the drag. */
export const Z_SQ = 44, LEAN_SQ = 7;
/** The bolt is drawn with at least this lift (a pure top view would flatten it into a point). */
export const LIFT_MIN = 0.4;
/** Times (ms): the stepped leader's descent, the streamers', the crackle's window, the sky flickers [t, strength], the arcs' race
 * out and life, the afterglow after the last stroke, the plasma point's cooling, the spray's longest life. */
export const LEADER_MS = 320, STREAMER_MS = 220, CRACKLE = [-1000, -60], SKY = [[-760, 0.07], [-560, 0.11]];
export const ARC_MS = 110, ARC_LIFE = 420, AFTER_MS = 320, PLASMA_MS = 900, SPRAY_MS = 900;
/** Per level: strokes [lo, hi], branch chance per leader step, arcs [lo, hi], spray droplets, plasma radius (art px), side pixels'
 * reach (share of the channel from the ground), a second side pixel near the ground. */
export const LV = Object.freeze([null,
  { strokes: [1, 2], branch: 0.07, arcs: [4, 5], spray: 9, plasma: 2, side: 0.85, side2: 0.25 },
  { strokes: [2, 3], branch: 0.1, arcs: [5, 7], spray: 14, plasma: 3, side: 1, side2: 0.6 },
  { strokes: [3, 4], branch: 0.13, arcs: [6, 8], spray: 20, plasma: 4, side: 1, side2: 0.7 }]);
/** Colours: the core by brightness (white, ice, pale blue, violet), the leader (dim, tip), the glow bands (blue ring, then additive
 * pale blue, blue, violet), the plasma by heat (white, yellow, orange, red, dark) and the spray / crackle palette. */
export const COL = Object.freeze({
  core: [0xffffff, 0xe2f3ff, 0xa6d2ff, 0x9a86ff], lead: [0x8f7fe8, 0xd6ccff], glow: [0xbfe0ff, 0x9fd0ff, 0x6f9cff, 0x5d62e8, 0x4a3cb8],
  heat: [0xffffff, 0xffe9a0, 0xffa040, 0xd2401c, 0x5a2216],
  spark: [0xffffff, 0xfff0b0, 0xffb050, 0xe0582a, 0x7a2a18, 0xbfe6ff, 0x7fb4ff]
});

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clamp01 = (v) => clamp(v, 0, 1);
/** A small hash in [0, 1) of three integers (the same on every machine). */
export function hash3(a, b, c) {
  let t = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const lvOf = (lv) => LV[clamp(Math.round(Number(lv) || 2), 1, 3)];

/* ---------------------------------------------------------------- time */

/** The strokes of a strike: [{ t (ms from T0), a (strength) }], the first at 0; `end` the last moment anything of it shows. */
export function timing(seed, lv = 2) {
  const L = lvOf(lv), r = stream(seed >>> 0, "strike:time"), n = r.int(L.strokes), strokes = [{ t: 0, a: 1 }];
  let t = 0;
  for ( let i = 1; i < n; i++ ) { t += Math.round(i === 1 ? 62 + 30 * r() : 55 + 75 * r()); strokes.push({ t, a: Math.round((0.86 - 0.14 * i + 0.08 * r()) * 100) / 100 }); }
  const last = strokes.at(-1).t;
  return { strokes, last, end: Math.max(last + AFTER_MS + 120, PLASMA_MS, SPRAY_MS) };
}
/** A stroke's light: full for a frame, then an exponential fall (`dec` ms). */
const pulse = (x, dec) => (x < 0 ? 0 : x < 17 ? 1 : Math.exp(-(x - 17) / dec));

/**
 * The state of a frame at t (ms from T0) of a strike with timing T:
 *   lead    the stepped leader's front (0..1 of the arrival, -1: not in the leader's time); quantised: it lands step by step
 *   stream  the streamers' front (0..1, -1: none), streamB their brightness
 *   main / branch   the channel's and the branches' brightness (0..1+)
 *   wipe    the return stroke's bottom-up front (0..1: a pixel shows once 1 - its arrival <= wipe)
 *   cut     the afterglow: pixels whose arrival is under it are gone (the top first)
 *   arc / arcB / arcCut   the ground arcs' front, brightness and the tips' cut (0..1: a pixel beyond it is gone)
 *   plasma / heat   the strike point's brightness and its heat (1 white-hot .. 0 cold)
 *   flash   the screen flash (0..1), view the night light over the whole view, ground the local ground light
 */
export function frameAt(T, t) {
  const S = T.strokes, last = T.last;
  let main = 0, branch = 0, flash = 0;
  for ( let i = 0; i < S.length; i++ ) {
    const x = t - S[i].t, a = S[i].a;
    if ( x < 0 ) continue;
    main += a * (pulse(x, 45) + 0.2 * Math.exp(-x / 160));
    branch += (i ? 0.15 : 0.9) * a * pulse(x, i ? 30 : 34);
    flash = Math.max(flash, a * pulse(x, 42));
  }
  // the sky's flickers before it (a faint cold flash, a lift of the night)
  let sky = 0;
  for ( const [ts, a] of SKY ) { const x = t - ts; if ( x >= 0 && x < 90 ) sky = Math.max(sky, a * (x < 25 ? 1 : 1 - (x - 25) / 65)); }
  const lead = t >= -LEADER_MS && t < 0 ? Math.floor(((t + LEADER_MS) / LEADER_MS) * 40) / 40 : -1;
  const stream = t >= -STREAMER_MS && t < 30 ? clamp01((t + STREAMER_MS) / STREAMER_MS) : -1;
  const streamB = stream < 0 ? 0 : t < 0 ? 0.42 : 0.42 * (1 - t / 30);
  const cut = t > last + 40 ? clamp01((t - last - 40) / AFTER_MS) * 1.15 : 0;
  const arc = t >= 0 ? clamp01(t / ARC_MS) : -1;
  // (arcs: bright while they race out, re-lit by the restrikes, flickering out - a hashed on / off per 40 ms)
  const flk = hash3(Math.floor(t / 40), 7, 13) < 0.3 ? 0.45 : 1;
  const arcB = t < 0 || t > ARC_LIFE ? 0 : Math.max(0.95 * Math.exp(-t / 160), 0.7 * main) * flk;
  const arcCut = t < 0 ? 1 : 1 - clamp01((t - 140) / (ARC_LIFE - 140));
  const plasma = t < 0 ? 0 : Math.min(1.2, 1.1 * main);
  const heat = t < 0 ? 0 : 1 - clamp01(t / PLASMA_MS);
  return { lead, stream, streamB, main: t < 0 ? 0 : main, branch: t < 0 ? 0 : branch, wipe: t < 0 ? 0 : clamp01(t / 26), cut, arc, arcB, arcCut, plasma, heat,
    flash: Math.max(flash, sky), view: Math.max(0.55 * flash, 1.4 * sky), ground: t < 0 ? 0 : Math.min(1, main) };
}

/* ---------------------------------------------------------------- geometry */

/** A seeded gaussian from a stream. */
const gauss = (r) => r.gauss();

/**
 * The strike's PATHS in squares (pure, deterministic for the seed): { main: [[x, y, z, arr]], branches: [{ pts, cls }], streams:
 * [{ pts }], arcs: [{ pts }] } - each point with its arrival (0..1 of the leader for the channel, from the ground up for a streamer,
 * outward for an arc). `dir` the drag (the side the top leans from), `size` scales what is on the ground.
 */
export function strikePaths(seed, { lv = 2, size = 1, dir = null } = {}) {
  const L = lvOf(lv), r = stream(seed >>> 0, "strike:geo"), Z = Z_SQ;
  const lean = Array.isArray(dir) && Number.isFinite(dir[0]) && Number.isFinite(dir[1]) ? [-dir[0] * LEAN_SQ, -dir[1] * LEAN_SQ] : [(r() - 0.5) * 6, -1.5 - r() * 3];
  // the slow wander of the channel (two sines per ground axis, over the height)
  const wv = [0, 1].map((k) => ({ a: k ? 0.25 + 0.35 * r() : 0.6 + 0.9 * r(), w1: 9 + 10 * r(), w2: 4 + 4 * r(), p1: r() * 6.283, p2: r() * 6.283 }));
  const wander = (z, k) => { const W = wv[k]; return W.a * (0.7 * Math.sin(z / W.w1 * 6.283 + W.p1) + 0.3 * Math.sin(z / W.w2 * 6.283 + W.p2)) * Math.pow(Math.sin(Math.PI * clamp01(z / Z)), 0.6); };
  const raw = [];
  let z = Z, jx = 0, jy = 0;
  while ( z > 0 ) {
    const near = Math.min(1, z / 1.4);   // (the last stretch homes in on the target: it ends ON it)
    raw.push([lean[0] * z / Z + wander(z, 0) + jx * near, lean[1] * z / Z + wander(z, 1) + jy * near, z]);
    const dz = 0.3 * (0.6 + 0.8 * r());
    z = z - dz < 0.12 ? 0 : z - dz;
    jx = jx * 0.55 + gauss(r) * 0.085; jy = jy * 0.55 + gauss(r) * 0.045;
  }
  raw.push([0, 0, 0]);
  // a fine kink in every segment (the pixel-scale tortuosity)
  const main = [];
  for ( let i = 0; i < raw.length; i++ ) {
    const p = raw[i];
    main.push([p[0], p[1], p[2], 0]);
    if ( i + 1 < raw.length ) {
      const q = raw[i + 1], l = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      main.push([(p[0] + q[0]) / 2 + (r() - 0.5) * 0.5 * l, (p[1] + q[1]) / 2 + (r() - 0.5) * 0.35 * l, (p[2] + q[2]) / 2, 0]);
    }
  }
  main.forEach((p, i) => { p[3] = i / (main.length - 1); });
  const N = main.length;
  // BRANCHES: off the leader's steps, walking down and away; a few carry twigs (each point keeps the leader's arrival)
  const branches = [];
  const grow = (from, arr0, side, zLen, cls, depth) => {
    const pts = [[from[0], from[1], from[2], arr0]];
    let [x, y, zz] = from, bx = 0, by = 0, k = 0, sa = Math.atan2(side[1], side[0]);
    const sp = Math.hypot(side[0], side[1]);
    const zEnd = Math.max(0.5, zz - zLen);
    while ( zz > zEnd && pts.length < 120 ) {
      const dz = 0.3 * (0.6 + 0.8 * r());
      zz -= dz; bx = bx * 0.5 + gauss(r) * 0.16; by = by * 0.5 + gauss(r) * 0.07; sa += (r() - 0.5) * 0.7;
      x += Math.cos(sa) * sp * dz + bx; y += Math.sin(sa) * sp * dz * 0.7 + by; k++;
      pts.push([x, y, zz, arr0 + k * 2 / N]);
      if ( depth < 1 && r() < 0.12 && branches.length < 40 ) {
        const an = Math.atan2(side[1], side[0]) + (r() < 0.5 ? -1 : 1) * (0.4 + 0.6 * r());
        grow([x, y, zz], arr0 + k * 2 / N, [Math.cos(an) * (0.4 + 0.5 * r()), Math.sin(an) * (0.4 + 0.5 * r())], (zz - zEnd) * (0.3 + 0.3 * r()), CLS.TWIG, depth + 1);
      }
    }
    branches.push({ pts, cls });
  };
  for ( let i = 2; i < N - 4; i++ ) {
    const f = i / N;
    if ( f < 0.04 || f > 0.92 || r() >= L.branch * (1.25 - 0.6 * f) * 0.55 ) continue;
    const an = r() * 6.283, sp = 0.22 + 0.4 * r();
    const zLen = Math.min(main[i][2] * 0.85, Z * (0.02 + 0.07 * r()) * (1.2 - 0.7 * f));
    if ( zLen < 0.6 ) continue;
    grow(main[i], main[i][3], [Math.cos(an) * sp, Math.sin(an) * sp * 0.7], zLen, CLS.BRANCH, 0);
  }
  // STREAMERS: short faint sparks reaching up from the ground near the target (arrival from the ground up)
  const streams = [];
  for ( let s = 0, n = lv + 1; s < n; s++ ) {
    const an = (s / n) * 6.283 + r() * 1.2, d = (0.35 + 0.55 * r()) * size, h = 0.25 + 0.45 * r();
    let x = Math.cos(an) * d, y = Math.sin(an) * d, zz = 0, bx = 0;
    const pts = [[x, y, 0, 0]], steps = 5 + Math.floor(r() * 3);
    for ( let k = 1; k <= steps; k++ ) { bx = bx * 0.5 + gauss(r) * 0.05; x += bx; zz = h * k / steps; pts.push([x, y, zz, k / steps]); }
    streams.push({ pts });
  }
  // ARCS: jagged, forking ground discharges racing out from the strike point (arrival: outward, 0..1 of the longest)
  const arcs = [], nA = r.int(L.arcs), reach = (0.55 + 0.15 * lv) * size;
  let maxD = 0;
  const arcWalk = (x, y, head, len, d0, depth) => {
    const pts = [[x, y, 0, d0]];
    let d = d0, h = head, dh = 0;
    for ( let s = 0; d - d0 < len && s < 60; s++ ) {
      const st = 0.09 * size * (0.7 + 0.6 * r());
      dh = dh * 0.4 + (r() - 0.5) * 1.1; h += dh * 0.6;
      x += Math.cos(h) * st; y += Math.sin(h) * st; d += st;
      pts.push([x, y, 0, d]);
      if ( depth < 1 && r() < 0.16 ) arcWalk(x, y, h + (r() < 0.5 ? -1 : 1) * (0.5 + 0.5 * r()), (len - (d - d0)) * (0.35 + 0.3 * r()), d, depth + 1);
    }
    maxD = Math.max(maxD, d);
    arcs.push({ pts });
  };
  for ( let a = 0; a < nA; a++ ) arcWalk(0, 0, (a / nA) * 6.283 + (r() - 0.5) * 0.7, reach * (0.55 + 0.75 * r()), 0, 0);
  for ( const A of arcs ) for ( const p of A.pts ) p[3] = p[3] / (maxD || 1);
  return { main, branches, streams, arcs, lean };
}

/**
 * The strike's DATA TEXTURE (see the top): `S` art px per square, `lift` / `squash` the view. Returns { W, H, cx, cy (the strike
 * point's texel), data: Uint8Array(W x H x 4), blocks: [[bx, by]] (BLOCK-sized blocks that hold anything), cores (core pixels) }.
 */
export function strikeData(seed, { lv = 2, size = 1, dir = null, S = 32, lift = 0.5, squash = 0.8 } = {}) {
  const L = lvOf(lv), P = strikePaths(seed, { lv, size, dir }), lf = Math.max(LIFT_MIN, lift);
  const cells = new Map(), key = (x, y) => (y + 32768) * 65536 + (x + 32768);
  const put = (x, y, cls, arr) => {
    const k = key(x, y), o = cells.get(k);
    if ( !o || PRIO[cls] > PRIO[o[2]] || (o[2] === cls && arr < o[3]) ) cells.set(k, [x, y, cls, arr]);
  };
  const scr = (p, ground) => [Math.round(p[0] * S), Math.round((ground ? p[1] * squash : p[1]) * S - lf * p[2] * S)];
  // a path as Bresenham lines; side pixels for the main channel's lower part (across the segment)
  const line = (pts, cls, ground, side = null) => {
    for ( let i = 1; i < pts.length; i++ ) {
      const [ax, ay] = scr(pts[i - 1], ground), [bx, by] = scr(pts[i], ground), a0 = pts[i - 1][3], a1 = pts[i][3];
      let x = ax, y = ay;
      const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay), sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1, n = Math.max(dx, -dy) || 1;
      let err = dx + dy;
      for ( let j = 0; j <= n; j++ ) {
        const arr = a0 + (a1 - a0) * (j / n);
        put(x, y, cls, arr);
        if ( side ) {
          const hf = 1 - arr;   // (0 at the top, 1 at the ground)
          const across = dx > -dy ? [0, 1] : [1, 0];
          if ( hf > 1 - side[0] ) put(x + across[0], y + across[1], CLS.SIDE, arr);
          if ( hf > 1 - side[1] ) put(x - across[0], y - across[1], CLS.SIDE, arr);
        }
        if ( x === bx && y === by ) break;
        const e2 = 2 * err;
        if ( e2 >= dy ) { err += dy; x += sx; }
        if ( e2 <= dx ) { err += dx; y += sy; }
      }
    }
  };
  line(P.main, CLS.MAIN, false, [L.side, L.side2]);
  for ( const B of P.branches ) line(B.pts, B.cls, false);
  for ( const A of P.streams ) line(A.pts, CLS.STREAM, false);
  for ( const A of P.arcs ) line(A.pts, CLS.ARC, true);
  // the plasma point at the base (a small squashed disc)
  const pr = L.plasma + (size > 1.3 ? 1 : 0);
  for ( let j = -pr; j <= pr; j++ ) for ( let i = -pr; i <= pr; i++ ) if ( Math.hypot(i, j / Math.max(0.5, squash)) <= pr + 0.25 ) put(i, j, CLS.PLASMA, 1);
  // the box (with the glow's margin)
  const M = Math.ceil(GLOW_CAP / 3) + 1;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( const [x, y] of cells.values() ) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  x0 -= M; y0 -= M; x1 += M; y1 += M;
  const W = x1 - x0 + 1, H = y1 - y0 + 1, n = W * H;
  const dist = new Uint16Array(n).fill(65535), src = new Int32Array(n).fill(-1), cls = new Uint8Array(n), arr = new Float32Array(n);
  for ( const [x, y, c, a] of cells.values() ) { const q = (y - y0) * W + (x - x0); dist[q] = 0; src[q] = q; cls[q] = c; arr[q] = a; }
  // the chamfer 3-4 distance to the nearest core pixel, two passes (each pixel keeps its nearest core)
  const relax = (q, p, w) => { if ( src[p] >= 0 && dist[p] + w < dist[q] ) { dist[q] = dist[p] + w; src[q] = src[p]; } };
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
    const q = y * W + x;
    if ( x > 0 ) relax(q, q - 1, 3);
    if ( y > 0 ) { relax(q, q - W, 3); if ( x > 0 ) relax(q, q - W - 1, 4); if ( x < W - 1 ) relax(q, q - W + 1, 4); }
  }
  for ( let y = H - 1; y >= 0; y-- ) for ( let x = W - 1; x >= 0; x-- ) {
    const q = y * W + x;
    if ( x < W - 1 ) relax(q, q + 1, 3);
    if ( y < H - 1 ) { relax(q, q + W, 3); if ( x < W - 1 ) relax(q, q + W + 1, 4); if ( x > 0 ) relax(q, q + W - 1, 4); }
  }
  const data = new Uint8Array(n * 4), BX = Math.ceil(W / BLOCK), occ = new Uint8Array(BX * Math.ceil(H / BLOCK));
  let cores = 0;
  for ( let q = 0; q < n; q++ ) {
    const s = src[q]; if ( s < 0 ) continue;
    const c = cls[s], d = dist[q];
    // (a glow pixel only within its core's reach: the rest of the box stays empty)
    if ( d > 0 && (d > GLOW_R[c] * 3 + 2 || d > GLOW_CAP) ) continue;
    const x = q % W, y = (q / W) | 0, o = q * 4;
    data[o] = Math.round(clamp01(arr[s]) * 254);
    data[o + 1] = d === 0 ? c : CLS.GLOW + c;
    data[o + 2] = Math.min(255, d);
    data[o + 3] = Math.floor(hash3(x + x0, y + y0, seed) * 256);
    if ( d === 0 ) cores++;
    occ[((y / BLOCK) | 0) * BX + ((x / BLOCK) | 0)] = 1;
  }
  const blocks = [];
  for ( let i = 0; i < occ.length; i++ ) if ( occ[i] ) blocks.push([i % BX, (i / BX) | 0]);
  return { W, H, cx: -x0, cy: -y0, data, blocks, cores };
}

/* ---------------------------------------------------------------- the CPU pixels */

/**
 * The MOLTEN SPRAY at t (ms from T0): droplets thrown out and up from the strike point (most by the return stroke, a few by each
 * restrike), falling back under gravity and cooling. -> [[x, y, z (squares), colour (COL.spark index)], ...] with each droplet's
 * trail pixel. `q` the guard's share.
 */
export function spray(seed, T, t, { lv = 2, size = 1, q = 1 } = {}) {
  const out = [], L = lvOf(lv), n = Math.max(2, Math.round(L.spray * (0.35 + 0.65 * q)));
  if ( t < 0 || t > SPRAY_MS + 200 ) return out;
  for ( let i = 0; i < n; i++ ) {
    const h = (k) => hash3(seed, i, k);
    const s = T.strokes[h(1) < 0.75 || T.strokes.length < 2 ? 0 : 1 + Math.floor(h(2) * (T.strokes.length - 1))];
    const life = 420 + 480 * h(3), a = t - s.t - h(4) * 20;
    if ( a < 0 || a > life ) continue;
    const an = h(5) * 6.283, vh = (1.2 + 2.6 * h(6)) * size / 1000, vz = (1.8 + 3.2 * h(7)) / 1000, G = 13 / 1e6;
    const pos = (u) => [Math.cos(an) * vh * u, Math.sin(an) * vh * u, 0.05 + vz * u - 0.5 * G * u * u];
    const p = pos(a);
    if ( p[2] < 0 ) continue;
    const f = a / life, c = f < 0.15 ? 0 : f < 0.4 ? 1 : f < 0.7 ? 2 : f < 0.9 ? 3 : 4;
    out.push([p[0], p[1], p[2], c]);
    const pt = pos(Math.max(0, a - 24));
    if ( pt[2] >= 0 && f < 0.75 ) out.push([pt[0], pt[1], pt[2], Math.min(4, c + 1)]);
  }
  return out;
}

/**
 * The CRACKLE of the charge before the strike, at t: single sparks and tiny 2-3 pixel arcs flickering over the ground near the
 * target, denser as T0 nears; a new set every 12 fps frame. -> [[x, y, z (squares), colour, dx, dy (art px of a tiny arc: 0 = a
 * dot)], ...].
 */
export function crackle(seed, t, { size = 1, q = 1 } = {}) {
  const out = [];
  if ( t < CRACKLE[0] || t >= CRACKLE[1] ) return out;
  const u = (t - CRACKLE[0]) / (CRACKLE[1] - CRACKLE[0]), fr = Math.floor((t - CRACKLE[0]) / 83);
  const n = Math.round((1 + 7 * u * u) * (0.5 + 0.5 * q));
  for ( let i = 0; i < n; i++ ) {
    const h = (k) => hash3(seed + fr * 131, i, k);
    if ( h(9) > 0.35 + 0.65 * u ) continue;
    const an = h(1) * 6.283, d = (0.12 + 0.5 * Math.sqrt(h(2))) * size;
    const arc = h(3) < 0.35, dx = arc ? (h(4) < 0.5 ? -1 : 1) * (1 + Math.round(h(5))) : 0, dy = arc ? -1 - Math.round(h(6)) : 0;
    out.push([Math.cos(an) * d, Math.sin(an) * d, 0.04 + 0.22 * h(7) * u, h(8) < 0.3 ? 0 : h(8) < 0.7 ? 5 : 6, dx, dy]);
  }
  return out;
}

/** The time span (ms from T0) a strike item draws in. */
export function spanOf(item, T) {
  const at = Number(item?.at) || 0;
  return [Math.min(at, CRACKLE[0]), Math.max(T?.end ?? PLASMA_MS, at + (Number(item?.dur) || 0))];
}
