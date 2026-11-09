/**
 * DESTRUCTION PRESETS, a gun's HIT SPURTS and its ROUNDS - the pure part (no Foundry, no PIXI: node-tested in
 * dev/presets-gunfx.test.mjs; drawn by accents.mjs). Round 3 (dev/presets-design.md section 16, "guns round 3 as built").
 *
 * A bullet that lands in soil throws a SPRAY, not a ball of dust: a fan of thin jets of dark fresh soil shoots up out of the pock
 * (each jet is a string of grains launched together at different speeds, so it reads as a streak that stretches, arcs over and
 * falls back apart), loose grains and a few clods fly out on their own arcs and land (they never hang in the air), and a low, ragged
 * cloud of the ground's pale dust boils out round the foot of the spray, rises a little and THINS - it loses density in steps of
 * alpha from its edges in (never a stipple of holes, never a flat fade). In water the same physics throws a white SPLASH and a mist.
 *  - Each spurt is a BAKED PIXEL STRIP: all frames of one (kind, variant) side by side in one texture (one texel = one art pixel of
 *    the destruction layer's art grid, drawn NEAREST: crisp at any zoom), baked deterministically per (art px a square, view lift) -
 *    every client draws the same pixels. A texel holds a grey VALUE and an alpha (premultiplied); the renderer tints it with the
 *    ground's colour under that hit (the soil is that ground's), moonlit at night. Eight variants a kind, mirrored per hit: sixteen
 *    looks, so a run of rounds never reads as stamped copies.
 *  - ROUNDS: a heavy gun "rips" - its walk hits (the ones that leave a pock and the lingering dust) are only every few rounds; the
 *    rounds in between (`fill` per gap, roundsOf) land along the same lane, each with its own spurt sprite, flash and sparks, but no
 *    damage and no dust stroke: the density costs only pooled sprites from the same strips.
 * A frame is a pure function of (the firing's hits, its T0, the shared clock): a late joiner sees whatever is still in the air.
 */

/**
 * Per kind (sizes in squares, times in ms, gravity g in squares / s^2): L the life, H the spray's height, fan its half angle (rad),
 * jets (streaks) of `per` grains each, `spray` loose grains, reach (how far out a grain may land), the dust cloud (n blobs born over
 * born [ms], spread W, rising up, radius r0 growing by grow x age^0.7, gone by life), wet: a splash (white) instead of soil.
 */
export const SPURT = Object.freeze({
  light: { L: 720, H: 0.85, g: 16, fan: 0.36, jets: 4, per: 10, spray: 10, reach: 0.45, col: 3, dust: { n: 7, born: [20, 150], W: 0.26, up: 0.18, r0: 0.07, grow: 0.22, life: 620 }, wet: false },
  heavy: { L: 1150, H: 1.7, g: 18, fan: 0.2, jets: 6, per: 16, spray: 16, reach: 0.6, col: 6, dust: { n: 11, born: [25, 260], W: 0.4, up: 0.36, r0: 0.085, grow: 0.27, life: 1050 }, wet: false },
  splashL: { L: 650, H: 0.75, g: 16, fan: 0.32, jets: 5, per: 8, spray: 8, reach: 0.4, col: 2, dust: { n: 6, born: [15, 130], W: 0.26, up: 0.12, r0: 0.06, grow: 0.2, life: 560 }, wet: true },
  splashH: { L: 1000, H: 1.45, g: 18, fan: 0.2, jets: 7, per: 12, spray: 12, reach: 0.55, col: 5, dust: { n: 9, born: [20, 220], W: 0.38, up: 0.25, r0: 0.08, grow: 0.25, life: 900 }, wet: true }
});
export const SPURT_KINDS = ["light", "heavy", "splashL", "splashH"];
/** Baked frames a second, variants a kind. */
export const SPURT_FPS = 30, SPURT_VARIANTS = 8;
/** The grey VALUES of the bake (x 255 in a texel): the dust's lit side, its middle, its shadow; the fresh soil of a jet, a clod, a
 * pale grain, a grain landed on the ground; a splash's drop and its foam. */
export const VAL = Object.freeze({ light: 1, mid: 0.86, shadow: 0.7, soil: 0.4, clod: 0.3, grain: 0.66, landed: 0.46, drop: 1, foam: 0.92 });
/** The dust's alpha steps (dense, thinning, last veil): a cloud thins by stepping down these, from its edges in. */
export const DUST_A = [0.88, 0.6, 0.32];

/** A small hash in [0, 1) of three integers (the same on every machine). */
export function hh(a, b, c) {
  let t = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
/** A smooth value noise (blobby, never a salt-and-pepper sieve). */
function vn(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hh(xi, yi, s), b = hh(xi + 1, yi, s), c = hh(xi, yi + 1, s), d = hh(xi + 1, yi + 1, s);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/** The kind of a gun's hits by its level (3: a heavy gun) and the ground (wet: water). */
export const kindOf = (lv, wet = false) => ((lv ?? 1) >= 3 ? (wet ? "splashH" : "heavy") : (wet ? "splashL" : "light"));
/** How many frames a kind's spurt has. */
export const frameCount = (kind) => Math.ceil(SPURT[kind].L / 1000 * SPURT_FPS);
/** The frame shown tau ms after the hit (-1: none). */
export const frameAt = (kind, tau) => (tau < 0 || tau >= SPURT[kind].L ? -1 : Math.min(frameCount(kind) - 1, Math.floor(tau / 1000 * SPURT_FPS)));

/**
 * A sprite's box in art px for S art px a square and the view's lift: { w, h, cx, gy } - the hit's ground point is the texel
 * (cx, gy); everything rises above it (screen-up), grains land a little round it.
 */
export function spurtBox(kind, S, lift = 1) {
  const K = SPURT[kind], D = K.dust, Ld = D.life / 1000;
  const rD = D.r0 * 1.3 + D.grow * Math.pow(Ld, 0.7) * 1.3;
  const cx = Math.ceil(Math.max(K.reach, D.W + 0.3 * K.H + rD) * S) + 3;
  const gy = Math.ceil((Math.max(K.H * 1.2, D.up + rD) * lift + rD * 0.4) * S) + 4;
  return { w: 2 * cx + 1, h: gy + Math.ceil(0.3 * K.reach * S + 0.2 * D.W * S) + 4, cx, gy };
}

/** The variant's particles and dust blobs (deterministic). */
function partsOf(kind, v) {
  const K = SPURT[kind], sd = 1709 + v * 131 + SPURT_KINDS.indexOf(kind) * 17;
  const lean = (hh(sd, 1, 1) - 0.5) * 0.5 * K.fan, v0 = Math.sqrt(2 * K.g * K.H);
  const P = [];
  // the JETS: a fan of streaks, each a string of grains launched together at falling speeds (the top one the fastest: a clod)
  for ( let i = 0; i < K.jets; i++ ) {
    // (round 3: the angles jittered, not evenly fanned, the outer ones flatter and shorter, each jet its own length - an even fan of
    // equal near-vertical strings read as a field of hatch dashes)
    const u = K.jets > 1 ? (i + 0.5 + (hh(sd, i, 9) - 0.5) * 0.9) / K.jets : 0.5;
    const phi = lean + (u - 0.5) * 2.6 * K.fan + (hh(sd, i, 2) - 0.5) * 0.6 * K.fan;
    const vj = v0 * (0.55 + 0.55 * hh(sd, i, 3)) * (1 - 0.45 * Math.abs(u - 0.5));
    const dep = (hh(sd, i, 4) - 0.5) * 0.7, t0 = 0.012 * hh(sd, i, 5), per = Math.max(3, Math.round(K.per * (0.5 + 0.5 * hh(sd, i, 10))));
    for ( let k = 0; k < per; k++ ) {
      const f = per > 1 ? k / (per - 1) : 0, s = (1 - 0.82 * Math.pow(f, 0.85)) * (0.88 + 0.24 * hh(sd, i * 31 + k, 6));
      P.push({ vx: vj * s * Math.sin(phi), vy: vj * s * Math.sin(phi) * dep, vz: vj * s * Math.cos(phi), t0, val: K.wet ? VAL.drop : VAL.soil + 0.12 * hh(sd, i * 31 + k, 7), big: false, lay: hh(sd, i * 31 + k, 8) < 0.45, jet: i, k });
    }
  }
  // LOOSE GRAINS: their own arcs, wider, some skittering out low over the ground
  for ( let j = 0; j < K.spray; j++ ) {
    const low = hh(sd, j, 11) < 0.4, phi = (hh(sd, j, 12) - 0.5) * 2 * (low ? 1.25 : 2 * K.fan) + lean;
    const vj = v0 * (low ? 0.25 + 0.2 * hh(sd, j, 13) : 0.35 + 0.45 * hh(sd, j, 13)), ang = low ? Math.sign(phi || 1) * 1.15 : phi;
    const clod = !K.wet && !low && hh(sd, j, 18) < 0.3;   // (a clod: a darker grain, one art pixel - a 2 x 2 block read as a hanging square)
    P.push({ vx: vj * Math.sin(ang), vy: vj * (hh(sd, j, 14) - 0.5) * 0.7, vz: vj * Math.cos(ang), t0: 0.02 * hh(sd, j, 15),
      val: K.wet ? VAL.drop : clod ? VAL.clod : hh(sd, j, 16) < 0.5 ? VAL.grain : VAL.soil + 0.1, big: clod, lay: hh(sd, j, 17) < 0.35, jet: -1 });
  }
  // the DUST CLOUD (a splash's mist): blobs born at the foot as the spray falls back, pushed out low, rising a little, growing
  const D = K.dust, B = [];
  for ( let j = 0; j < D.n; j++ ) {
    const f = D.n > 1 ? j / (D.n - 1) : 0;
    const tb = (D.born[0] + (D.born[1] - D.born[0]) * Math.pow(f, 1.2) + (hh(sd, j, 21) - 0.5) * 20) / 1000;
    B.push({ tb, x: (hh(sd, j, 22) - 0.5) * 2 * D.W + lean * K.H * 0.4, y: (hh(sd, j, 23) - 0.35) * 0.35 * D.W, z: D.up * (0.15 + 0.85 * Math.pow(hh(sd, j, 24), 0.8)),
      r: D.r0 * (0.7 + 0.6 * hh(sd, j, 25)), gr: D.grow * (0.6 + 0.7 * hh(sd, j, 26)), end: D.life / 1000 * (0.75 + 0.25 * hh(sd, j, 27)) });
  }
  // the COLUMN: dust the jets leave hanging along their way up (born as they pass, higher ones later), so the spray's height reads as a
  // plume that then thins - never a bare fountain of dots
  for ( let j = 0; j < K.col; j++ ) {
    const f = K.col > 1 ? j / (K.col - 1) : 0.5, zc = K.H * (0.25 + 0.6 * f) * (0.85 + 0.3 * hh(sd, j, 31));
    // (born when the spray's top has climbed past it: t = (v - sqrt(v^2 - 2 g z)) / g for its fastest jet)
    const vt = v0 * 0.9, disc = Math.max(0, vt * vt - 2 * K.g * zc), tup = (vt - Math.sqrt(disc)) / K.g;
    B.push({ tb: tup + (10 + 25 * hh(sd, j, 32)) / 1000, x: lean * zc * 0.9 + (hh(sd, j, 33) - 0.5) * 0.12, y: 0, z: zc, zfix: true,
      r: D.r0 * (0.55 + 0.35 * hh(sd, j, 34)) * (1 - 0.3 * f), gr: D.grow * 0.5, end: (D.born[1] + 120 + 260 * (1 - f)) / 1000 });
  }
  return { P, B, sd, lean };
}

/**
 * Bake one frame into `out` (RGBA, premultiplied: rgb = value x alpha) at column offset ox of a strip `stride` texels wide (a lone
 * frame: ox 0, stride its width). S art px a square (>= 8), lift the view's lift, v the variant, f the frame.
 */
function bakeInto(kind, S, lift, v, f, out, ox, stride, parts) {
  const K = SPURT[kind], box = spurtBox(kind, S, lift), { w, h, cx, gy } = box;
  const t = f / SPURT_FPS, { P, B, sd } = parts;
  const put = (x, y, val, a) => {
    x = Math.round(x); y = Math.round(y);
    if ( x < 0 || y < 0 || x >= w || y >= h || a <= 0 ) return;
    const o = (y * stride + ox + x) * 4, V = Math.round(255 * val * a), A = Math.round(255 * a);
    out[o] = out[o + 1] = out[o + 2] = V; out[o + 3] = A;
  };
  // the DUST CLOUD first (the spray flies in front of it)
  const L = [];
  for ( const b of B ) {
    const a = t - b.tb; if ( a < 0 || a >= b.end - b.tb ) continue;
    const e = 1 - Math.exp(-a / 0.16), ez = 1 - Math.exp(-a / 0.3);
    const wgt = 1 - smooth(0.25, 1, a / (b.end - b.tb));
    L.push({ x: cx + b.x * (b.zfix ? 1 : e) * S, y: gy + b.y * e * S - b.z * (b.zfix ? 1 - 0.15 * ez : ez) * lift * S, r: Math.max(1.3, (b.r + b.gr * Math.pow(a, 0.7)) * S), w: wgt, fresh: 1 - smooth(0.05, 0.25, a) });
  }
  if ( L.length ) {
    const Lx = -0.6, Ly = -0.7, wetK = K.wet ? 0.72 : 1, age = t / (K.dust.life / 1000);
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    for ( const b of L ) { x0 = Math.min(x0, b.x - b.r * 1.3); x1 = Math.max(x1, b.x + b.r * 1.3); y0 = Math.min(y0, b.y - b.r * 1.3); y1 = Math.max(y1, b.y + b.r * 1.3); }
    for ( let py = Math.max(0, Math.floor(y0)); py < Math.min(h, Math.ceil(y1)); py++ ) for ( let px = Math.max(0, Math.floor(x0)); px < Math.min(w, Math.ceil(x1)); px++ ) {
      const X = px + 0.5, Y = py + 0.5;
      // (a ragged edge: the distance warped by a blobby noise - a cloud, never a disc)
      const warp = 0.78 + 0.44 * vn(X / 2.3, Y / 2.3, sd + 3);
      let D = 0, nx = 0, ny = 0, fr = 0;
      for ( const b of L ) {
        const qx = X - b.x, qy = Y - b.y, d2 = (qx * qx + qy * qy) / (b.r * b.r) * warp * warp;
        if ( d2 >= 1 ) continue;
        const ww = (1 - d2) * (1 - d2) * b.w;
        D += ww; nx += ww * qx / b.r; ny += ww * qy / b.r; fr += ww * b.fresh;
      }
      if ( D < 0.12 ) continue;
      // (it THINS: the density falls under the alpha steps from the edges in, its heart last; a slow blobby noise decides where it
      // opens first - holes that grow from blobs, never single pixels)
      const thin = D * (1 - 0.55 * smooth(0.35, 1, age) * vn(X / 3.4, Y / 3.4, sd + 5));
      const a = thin > 0.62 ? DUST_A[0] : thin > 0.34 ? DUST_A[1] : thin > 0.16 ? DUST_A[2] : 0;
      if ( !a ) continue;
      const lum = (nx * Lx + ny * Ly) / D;
      let val = K.wet ? (lum > 0.15 ? VAL.drop : VAL.foam) : lum > 0.22 ? VAL.light : lum > -0.12 ? VAL.mid : VAL.shadow;
      if ( !K.wet && fr > 0 ) val *= 1 - 0.2 * fr / D;   // (the dust just kicked up is a shade darker: it is the soil's)
      put(px, py, val, a * wetK);
    }
  }
  // the SPRAY: grains on ballistic arcs - drawn while in the air, a short streak behind a fast one; a share of them lie on the ground
  // for a moment where they land; nothing hangs
  const g = K.g;
  // (a jet young and whole: its grains joined by a line, a solid streak of soil; it breaks where two grains drift more than 2.5 px apart)
  const pos = P.map((p) => { const tt = t - p.t0, z = p.vz * tt - 0.5 * g * tt * tt; return tt > 0 && z >= 0 ? [cx + p.vx * tt * S, gy + p.vy * tt * S - z * lift * S] : null; });
  for ( let i = 0; i + 1 < P.length; i++ ) {
    const p = P[i], q = P[i + 1]; if ( p.jet < 0 || q.jet !== p.jet || !pos[i] || !pos[i + 1] ) continue;
    const [ax, ay] = pos[i], [bx, by] = pos[i + 1], d = Math.hypot(bx - ax, by - ay);
    // (only while young: after ~0.2 s a jet has broken into its grains)
    if ( d > (t < 0.12 ? 7.6 : t < 0.22 ? 2.6 : 0) ) continue;
    const n = Math.ceil(d);
    for ( let s = 1; s < n; s++ ) put(ax + (bx - ax) * s / n, ay + (by - ay) * s / n, K.wet ? VAL.foam : p.val + 0.05, 1);
  }
  for ( const p of P ) {
    const tt = t - p.t0; if ( tt <= 0 ) continue;
    const z = p.vz * tt - 0.5 * g * tt * tt;
    const X = cx + p.vx * tt * S, Yg = gy + p.vy * tt * S;
    if ( z < 0 ) {
      // landed: when, and lying for 90 ms (a splash's drops never lie)
      if ( K.wet || !p.lay ) continue;
      const tl = (2 * p.vz) / g;
      if ( tt - tl > 0.09 ) continue;
      put(cx + p.vx * tl * S, gy + p.vy * tl * S, VAL.landed, 0.85);
      continue;
    }
    const Y = Yg - z * lift * S;
    // (the streak: its place 1/60 s ago, a step paler / thinner, when it moved more than a pixel and a half)
    const t2 = tt - 1 / 60, z2 = p.vz * t2 - 0.5 * g * t2 * t2;
    if ( t2 > 0 && z2 >= 0 ) {
      const X2 = cx + p.vx * t2 * S, Y2 = gy + p.vy * t2 * S - z2 * lift * S;
      if ( !p.big && p.jet < 0 && Math.hypot(X - X2, Y - Y2) > 1.5 ) put(X2, Y2, K.wet ? VAL.foam : Math.min(1, p.val + 0.12), 0.7);
    }
    put(X, Y, p.val, 1);

  }
  return box;
}

const partsCache = new Map();
const partsFor = (kind, v) => { const k = `${kind}|${v}`; let p = partsCache.get(k); if ( !p ) partsCache.set(k, p = partsOf(kind, v)); return p; };

/**
 * Bake one frame: { w, h, cx, gy, data: Uint8Array RGBA, premultiplied: rgb = value x alpha }. S art px a square (>= 8), lift the
 * view's lift (screen px a scene px of height), v the variant, f the frame.
 */
export function bakeSpurt(kind, S, lift, v, f) {
  const box = spurtBox(kind, S, lift), data = new Uint8Array(box.w * box.h * 4);
  bakeInto(kind, S, lift, v, f, data, 0, box.w, partsFor(kind, v));
  return { ...box, data };
}

/**
 * Bake every frame of one (kind, variant) side by side: { w (one frame's), h, cx, gy, n (frames), data: RGBA (w x n) x h } - one
 * texture a strip, so the renderer's sprites share a few base textures (they batch).
 */
export function bakeStrip(kind, S, lift, v) {
  const box = spurtBox(kind, S, lift), n = frameCount(kind), stride = box.w * n, data = new Uint8Array(stride * box.h * 4), parts = partsFor(kind, v);
  for ( let f = 0; f < n; f++ ) bakeInto(kind, S, lift, v, f, data, f * box.w, stride, parts);
  return { ...box, n, data };
}

/* ---------------------------------------------------------------- the ground's colour */

const SOIL = [0.66, 0.58, 0.47];
const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
/** Cold ground (water, any blue / teal): its dust is the soil's, never blue (fire/dust-art.mjs coldOf). */
export function coldOf(T) { return clamp01(smooth(0.02, 0.12, T[2] - Math.max(T[0], 0.85 * T[1])) + smooth(0.04, 0.16, Math.min(T[1], T[2]) - T[0]) * 0.8); }
/** Is a packed ground colour water (a hit there splashes; no pock, no soil)? Dark and cold. */
export function wetOf(tone) {
  if ( !(tone >= 0) ) return false;
  const T = unpackRgb(tone), l = 0.3 * T[0] + 0.59 * T[1] + 0.11 * T[2];
  return coldOf(T) > 0.55 && l < 0.42;
}
/**
 * The dust's LIT colour (0..1 rgb) from the ground's T (0..1 rgb): the ground's own hue kept more than the slow dust's (it is the
 * soil just torn out of it), greyed toward soil, a cold ground's the soil's; then lit (x 1.22 + 0.05, as the dust layer's light band).
 */
export function dustLit(T) {
  const l = 0.3 * T[0] + 0.59 * T[1] + 0.11 * T[2];
  let b = mix3(mix3(T, [l, l, l], 0.38), SOIL.map((c) => c * (0.75 + 0.5 * l)), 0.4);
  b = mix3(b, SOIL.map((c) => c * (0.78 + 0.35 * l)), coldOf(T));
  b = b.map((c, i) => Math.max(c, SOIL[i] * 0.5));
  return b.map((c) => Math.min(1, c * 1.22 + 0.05));
}
/** A splash's colour: white water, a touch of the water's own hue. */
export function splashLit(T) { return mix3([0.9, 0.94, 0.97], T, 0.18).map((c) => Math.min(1, c * 1.05)); }
/** At night: the lit value lifts toward a pale moonlit tone (the dust is not a light: contrast by form), lifted against the ambience. */
export function dustNight(lit, dark, lift = 1) {
  const moon = [0.78, 0.82, 0.92];
  const n = mix3(lit.map((c) => c * 1.15), moon, 0.45).map((c) => Math.min(1, c * (1 + (lift - 1) * 0.8)));
  return mix3(lit, n, clamp01(dark));
}
export const packRgb = (c) => (Math.round(clamp01(c[0]) * 255) << 16) | (Math.round(clamp01(c[1]) * 255) << 8) | Math.round(clamp01(c[2]) * 255);
export const unpackRgb = (n) => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];

/* ---------------------------------------------------------------- the rounds */

/** A standard normal from two hashes. */
const gauss = (a, b) => Math.sqrt(-2 * Math.log(Math.max(1e-9, a))) * Math.cos(6.2832 * b);
/**
 * The ROUNDS of a hitFx item: its walk hits ([x, y, t, lane], major: they leave the pocks) and, with `fill` > 0, `fill` rounds in
 * every gap between two hits of one lane (minor: a spurt, a flash and sparks of their own, nothing written), spread across and along
 * the lane as the hits are - one gun's stream of fire. Deterministic from the item alone (every client, every seed of the frame).
 * -> [[x, y, t, lane, major 1 | 0], ...] sorted by time; cached on the item.
 */
export function roundsOf(it) {
  if ( it._rounds && it._rounds.src === it.hits ) return it._rounds.list;
  const hits = it.hits ?? [], fill = Math.max(0, Math.min(4, it.fill | 0)), out = hits.map((h) => [h[0], h[1], h[2], h[3] ?? 0, 1]);
  if ( fill > 0 ) {
    const lanes = new Map();
    hits.forEach((h) => { const j = h[3] ?? 0; if ( !lanes.has(j) ) lanes.set(j, []); lanes.get(j).push(h); });
    const sd = (Math.floor(hits[0]?.[0] ?? 0) * 73 + Math.floor(hits[0]?.[1] ?? 0) * 31 + hits.length) | 0;
    for ( const [j, L] of lanes ) {
      L.sort((p, q) => p[2] - q[2]);
      for ( let i = 0; i + 1 < L.length; i++ ) {
        const a = L[i], b = L[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, dt = b[2] - a[2];
        for ( let k = 1; k <= fill; k++ ) {
          const f = k / (fill + 1) + (hh(sd, i * 8 + k, j + 41) - 0.5) * 0.3 / (fill + 1);
          const ac = gauss(hh(sd, i * 8 + k, j + 42), hh(sd, i * 8 + k, j + 43)) * 0.2 * d, al = (hh(sd, i * 8 + k, j + 44) - 0.5) * 0.3 * d;
          out.push([a[0] + dx * f + ux * al - uy * ac, a[1] + dy * f + uy * al + ux * ac, Math.round(a[2] + dt * f), j, 0]);
        }
      }
    }
    out.sort((p, q) => p[2] - q[2] || p[3] - q[3]);
  }
  Object.defineProperty(it, "_rounds", { value: { src: it.hits, list: out }, enumerable: false, configurable: true, writable: true });
  return out;
}

/* ---------------------------------------------------------------- the frame's spurts */

export const SPURT_STRIDE = 7;
/**
 * The spurts of a hitFx item at t (ms from T0) into F.spurts: [x, y (the hit's ground point, scene px), kind (index in SPURT_KINDS),
 * variant, frame, tone (packed ground rgb, -1 unknown), flip 0 | 1] - sorted later by y (the nearer drawn over the farther).
 * it.tones (when known) is aligned to roundsOf(it); a wet ground (wetOf) splashes.
 */
export function spurts(it, t, F, seed) {
  const R = roundsOf(it), tones = it.tones, heavy = (it.lv ?? 1) >= 3;
  (F.spurts ??= []);
  R.forEach((h, i) => {
    const tau = t - h[2]; if ( tau < 0 ) return;
    const tone = Array.isArray(tones) && Number.isFinite(tones[i]) ? tones[i] : -1, wet = wetOf(tone);
    // (a heavy gun's minor rounds and about a quarter of its walk hits kick a light spurt: a field of equal columns read as a copse)
    const big = heavy && h[4] === 1 && hh(seed, i, 73) >= 0.25;
    const kd = kindOf(big ? 3 : 1, wet), fr = frameAt(kd, tau);
    if ( fr < 0 ) return;
    const v = Math.floor(hh(seed, i, 71) * SPURT_VARIANTS);
    F.spurts.push(h[0], h[1], SPURT_KINDS.indexOf(kd), v, fr, tone, hh(seed, i, 72) < 0.5 ? 1 : 0);
  });
}
