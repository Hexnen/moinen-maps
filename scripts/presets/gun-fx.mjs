/**
 * DESTRUCTION PRESETS, a gun's HIT SPURTS - the pure part (no Foundry, no PIXI: node-tested in dev/presets-gunfx.test.mjs; drawn by
 * accents.mjs). Every bullet that lands kicks the ground up: a fast spurt of soil shot up from the pock, dark clods and pale grains
 * thrown out of it on short arcs, a body of dust that boils up into a cauliflower crown, hangs, and falls apart from the bottom up
 * (dropout holes that open and grow, never a fade). The slow dust that drifts on after it is the dust layer's (fire/dust-model.mjs
 * kind "hits"); the pock is the damage layer's.
 *  - Each spurt is a BAKED PIXEL SPRITE: frames of art pixels (one art pixel of the destruction layer's art grid = one texel, drawn
 *    with NEAREST scaling at that size: crisp at any zoom), baked deterministically per (art px a square, view lift, kind, variant,
 *    frame) - every client draws the same pixels. A frame holds a grey VALUE (light 1, mid, shadow, a dark clod) and an alpha; the
 *    renderer tints it with the ground's own colour under that hit (the dust is the ground's dust) and, at night, a moonlit value.
 *  - Light (an Uzi's round): a short squat spurt. Heavy (a heavy machine gun's): a tall narrow geyser.
 *  - The renderer pools one sprite a live spurt (a run of 30 rounds is ~20 sprites at once): no per-pixel CPU drawing.
 * A frame is a pure function of (the firing's hits, its T0, the shared clock): a late joiner sees whatever is still in the air.
 */

/** Per kind: H the geyser's height, W its half-width (squares), L its life (ms), nb dust lobes, r0 a lobe's radius (sq), grow its
 * spread (sq/s), clods (dark, heavy, thrown highest) and grains (pale, fast), tau the rise (s), sink (sq/s^2: the crown settles). */
export const SPURT = Object.freeze({
  light: { H: 0.55, W: 0.3, L: 580, nb: 8, r0: 0.07, grow: 0.1, clods: 7, grains: 10, tau: 0.05, sink: 0.14, lean: 0.45, jet: 0.07 },
  heavy: { H: 1.15, W: 0.36, L: 850, nb: 14, r0: 0.085, grow: 0.14, clods: 12, grains: 16, tau: 0.07, sink: 0.2, lean: 0.3, jet: 0.1 }
});
export const SPURT_KINDS = ["light", "heavy"];
/** Baked frames a second, variants a kind. */
export const SPURT_FPS = 30, SPURT_VARIANTS = 4;
/** The grey VALUES of the bake (x 255 in a texel): the dust's lit side, its middle, its shadow, its thin rim, a clod, a grain. */
export const VAL = Object.freeze({ light: 1, mid: 0.8, shadow: 0.56, rim: 0.88, clod: 0.34, grain: 0.97, fresh: 0.68 });
/** The dust body's alpha, its rim's (a thin veil round the body: no hard outline). */
export const BODY_A = 0.93, RIM_A = 0.5;

/** A small hash in [0, 1) of three integers (the same on every machine). */
export function hh(a, b, c) {
  let t = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
/** A smooth value noise (blobby holes, never a salt-and-pepper sieve). */
function vn(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hh(xi, yi, s), b = hh(xi + 1, yi, s), c = hh(xi, yi + 1, s), d = hh(xi + 1, yi + 1, s);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/** The kind of a gun's hits by its level (3: a heavy gun). */
export const kindOf = (lv) => ((lv ?? 1) >= 3 ? "heavy" : "light");
/** How many frames a kind's spurt has. */
export const frameCount = (kind) => Math.ceil(SPURT[kind].L / 1000 * SPURT_FPS);
/** The frame shown tau ms after the hit (-1: none). */
export const frameAt = (kind, tau) => (tau < 0 || tau >= SPURT[kind].L ? -1 : Math.min(frameCount(kind) - 1, Math.floor(tau / 1000 * SPURT_FPS)));

/**
 * A sprite's box in art px for S art px a square and the view's lift: { w, h, cx, gy } - the hit's ground point is the texel
 * (cx, gy); everything rises above it (screen-up), the low spray spreads a little round it.
 */
export function spurtBox(kind, S, lift = 1) {
  const K = SPURT[kind], cx = Math.ceil(K.W * S) + 2, gy = Math.ceil((K.H * lift + 2.6 * K.r0 + K.grow * K.L / 1000) * S) + 3;
  return { w: 2 * cx + 1, h: gy + Math.ceil(0.22 * S) + 2, cx, gy };
}

/**
 * Bake one frame: { w, h, cx, gy, data: Uint8Array RGBA, premultiplied: rgb = value x alpha }. S art px a square (>= 8), lift the
 * view's lift (screen px a scene px of height), v the variant, f the frame.
 */
export function bakeSpurt(kind, S, lift, v, f) {
  const K = SPURT[kind], box = spurtBox(kind, S, lift), { w, h, cx, gy } = box, data = new Uint8Array(w * h * 4);
  const t = f / SPURT_FPS, u = clamp01(t * 1000 / K.L), sd = 977 + v * 131 + (kind === "heavy" ? 7 : 0);
  const lean = (hh(sd, 1, 1) - 0.5) * K.lean;   // (a spurt leans a little: the rounds come in at an angle)
  // the DUST LOBES: stacked up the column (k 0 at the ground, 1 at the crown), each shot up fast and slowed by drag, spreading,
  // the low ones thinning first (the column falls apart from the bottom up, the crown hangs a moment longer)
  const lobes = [];
  for ( let i = 0; i < K.nb; i++ ) {
    const k = K.nb > 1 ? i / (K.nb - 1) : 1, r1 = hh(sd, i, 2), r2 = hh(sd, i, 3), r3 = hh(sd, i, 4);
    const tau = K.tau * (0.7 + 0.9 * k) * (0.8 + 0.4 * r3);
    const e = 1 - Math.exp(-t / tau);
    const zt = K.H * (0.08 + 0.92 * Math.pow(k, 0.85)) * (0.82 + 0.36 * r1);
    const z = Math.max(0, zt * e - K.sink * t * t * (0.4 + 0.6 * k));
    const x = (lean * k * K.H + (r2 - 0.5) * K.W * (0.35 + 0.65 * k)) * e;
    // (the lobes near the ground also spread over it, toward the viewer a little: the spurt's skirt)
    const y = k < 0.25 ? (r1 - 0.3) * 0.12 * e : 0;
    const r = K.r0 * (0.65 + 0.7 * r3) * (0.55 + 0.75 * k) * (0.4 + 0.6 * (1 - Math.exp(-t / 0.07))) + K.grow * t * (0.55 + 0.9 * k);
    const wgt = 1 - smooth(0.3 - 0.22 * (1 - k), 1 - 0.3 * (1 - k), u);
    // (YOUNG: a lobe is still a jet from the pock - a capsule from it back down toward the ground, shrinking as it slows: the first
    // frames read as one spike of soil shot up, never a ball popping in mid-air)
    const jy = Math.exp(-t / K.jet);
    if ( wgt > 0.01 ) lobes.push({ x: cx + x * S, y: gy + y * S - z * lift * S, r: Math.max(1.2, r * S), w: wgt, k, jx: -x * S * jy, jy: z * lift * S * jy });
  }
  const L = [-0.55, -0.7, 0.6], Ln = Math.hypot(...L), TH = 0.14;
  const holeK = smooth(0.32, 1, u) * 0.95, fresh = 1 - smooth(0.04, 0.3, u);
  const put = (x, y, val, a) => {
    if ( x < 0 || y < 0 || x >= w || y >= h ) return;
    const o = (y * w + x) * 4, V = Math.round(255 * val * a);
    data[o] = data[o + 1] = data[o + 2] = V; data[o + 3] = Math.round(255 * a);
  };
  for ( let py = 0; py < h; py++ ) for ( let px = 0; px < w; px++ ) {
    const X = px + 0.5, Y = py + 0.5;
    let F = 0, nx = 0, ny = 0, nz = 0, kk = 0;
    for ( const b of lobes ) {
      let qx = X - b.x, qy = Y - b.y, rr = b.r;
      if ( b.jy > 0.5 ) { const hq = clamp01((qx * b.jx + qy * b.jy) / (b.jx * b.jx + b.jy * b.jy)); qx -= b.jx * hq; qy -= b.jy * hq; rr *= 1 - 0.45 * hq; }
      const d2 = (qx * qx + qy * qy) / (rr * rr);
      if ( d2 >= 1 ) continue;
      const ww = (1 - d2) * (1 - d2) * b.w;
      F += ww; nx += ww * qx / rr; ny += ww * qy / rr; nz += ww * Math.sqrt(1 - d2); kk += ww * b.k;
    }
    const dz = (hh(px >> 1, py >> 1, sd + 61) - 0.5) * 0.08;
    if ( F <= TH + dz ) continue;
    // (holes that open and grow as blobs as it ages - a 2 x 2 grain, eroding from their edges)
    const hole = holeK > 0 ? 0.7 * vn(X / 3.2, Y / 3.2, sd + 21) + 0.3 * vn(X / 1.4, Y / 1.4, sd + 22) : 1;
    if ( hole < holeK ) continue;
    const nl = Math.hypot(nx, ny, nz) || 1, lum = (nx * L[0] + ny * L[1] + nz * L[2]) / (nl * Ln) + (hh(px >> 1, py >> 1, sd + 62) - 0.5) * 0.06;
    let val = lum > 0.5 ? VAL.light : lum > 0.1 ? VAL.mid : VAL.shadow, a = BODY_A;
    if ( F < TH + 0.05 + dz || (holeK > 0 && hole < holeK + 0.08) ) { val = VAL.rim * (lum > 0.1 ? 1 : 0.8); a = RIM_A; }
    // (FRESH: the soil just kicked up is darker and denser; the low column darker than the crown)
    const fk = fresh * (1 - 0.6 * kk / F);
    if ( fk > 0 ) val *= 1 - (1 - VAL.fresh) * fk;
    // (the thinning cloud: its last third goes paler and thinner before its holes take it)
    a *= 1 - 0.35 * smooth(0.55, 1, u);
    put(px, py, val, a);
  }
  // CLODS (dark, 2 x 2 or 1 px, thrown highest, falling back hard) and GRAINS (pale specks, fast and low): ballistic, gone when they land
  const fly = (n, tag, hMin, hMax, spread, Tap, val, big) => {
    for ( let j = 0; j < n; j++ ) {
      const r1 = hh(sd, j, tag), r2 = hh(sd, j, tag + 1), r3 = hh(sd, j, tag + 2), t0 = 0.012 * r3;
      const tt = t - t0; if ( tt <= 0 ) continue;
      const Hj = K.H * (hMin + (hMax - hMin) * r1), ta = Tap * (0.8 + 0.4 * r2), g = 2 * Hj / (ta * ta), vz = g * ta;
      const z = vz * tt - 0.5 * g * tt * tt;
      if ( z < 0 ) continue;
      const vx = (r2 - 0.5) * 2 * spread * K.W / (2 * ta) + lean * K.H / (2 * ta) * 0.6, vy = (r3 - 0.5) * 0.25 * K.W / (2 * ta);
      const x = Math.floor(cx + vx * tt * S), y = Math.floor(gy + vy * tt * S - z * lift * S);
      // (a short streak behind a fast one: its last place, a step dimmer)
      const z2 = vz * (tt - 0.025) - 0.5 * g * (tt - 0.025) ** 2;
      if ( tt > 0.025 && Math.abs(vz - g * tt) * lift * S * 0.025 > 1.4 ) put(Math.floor(cx + vx * (tt - 0.025) * S), Math.floor(gy + vy * (tt - 0.025) * S - z2 * lift * S), val, 0.7);
      put(x, y, val, 1);
      if ( big && r1 > 0.35 ) { put(x + 1, y, val, 1); put(x, y + 1, val * 0.85, 1); put(x + 1, y + 1, val * 0.8, 1); }
    }
  };
  fly(K.clods, 30, 0.45, 1.05, 1.6, kind === "heavy" ? 0.27 : 0.17, VAL.clod, kind === "heavy" && S >= 24);
  fly(K.grains, 40, 0.2, 0.7, 2.2, kind === "heavy" ? 0.2 : 0.13, VAL.grain, false);
  return { ...box, data };
}

/* ---------------------------------------------------------------- the ground's colour */

const SOIL = [0.66, 0.58, 0.47];
const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
/** Cold ground (water, any blue / teal): its dust is the soil's, never blue (fire/dust-art.mjs coldOf). */
export function coldOf(T) { return clamp01(smooth(0.02, 0.12, T[2] - Math.max(T[0], 0.85 * T[1])) + smooth(0.04, 0.16, Math.min(T[1], T[2]) - T[0]) * 0.8); }
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
/** At night: the lit value lifts toward a pale moonlit tone (the dust is not a light: contrast by form), lifted against the ambience. */
export function dustNight(lit, dark, lift = 1) {
  const moon = [0.78, 0.82, 0.92];
  const n = mix3(lit.map((c) => c * 1.15), moon, 0.45).map((c) => Math.min(1, c * (1 + (lift - 1) * 0.8)));
  return mix3(lit, n, clamp01(dark));
}
export const packRgb = (c) => (Math.round(clamp01(c[0]) * 255) << 16) | (Math.round(clamp01(c[1]) * 255) << 8) | Math.round(clamp01(c[2]) * 255);
export const unpackRgb = (n) => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];

/* ---------------------------------------------------------------- the frame's spurts */

/**
 * The spurts of a hitFx item at t (ms from T0) into F.spurts: [x, y (the hit's ground point, scene px), kind 0 light | 1 heavy,
 * variant, frame, tone (packed ground rgb, -1 unknown)] - sorted later by y (the nearer drawn over the farther).
 */
export function spurts(it, t, F, seed) {
  const kind = kindOf(it.lv), ki = SPURT_KINDS.indexOf(kind), tones = it.tones;
  (F.spurts ??= []);
  it.hits.forEach((h, i) => {
    // (a heavy gun's hits are not all alike: about a third only kick a light spurt - a field of equal columns read as a copse)
    const lk = kind === "heavy" && hh(seed, i, 73) < 0.35, kd = lk ? "light" : kind;
    const fr = frameAt(kd, t - h[2]);
    if ( fr < 0 ) return;
    const v = Math.floor(hh(seed, i, 71) * SPURT_VARIANTS);
    F.spurts.push(h[0], h[1], lk ? 0 : ki, v, fr, Array.isArray(tones) && Number.isFinite(tones[i]) ? tones[i] : -1);
  });
}
export const SPURT_STRIDE = 6;
