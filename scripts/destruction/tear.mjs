/**
 * The TEAR (damage type "gash", "Tears" / "Rozdarcia"): the map's surface ripped open along the painted stroke, like torn paper,
 * cloth, turf or a split deck. Pure code (no DOM, no Foundry), called from core.mjs's per-area bake for a gash area.
 *
 *   SPINE    the stroke's own brush path (or, without one, the painted shape's main axis following its bends), resampled at one art
 *            pixel, smoothed and given a slow seeded meander. The tear's arc length s runs along it.
 *   OPENING  an elongated lens around the spine: wide in the middle (the bulge sits off centre), tapering to sharp points at both
 *            ends. Each lip has its own edge function (the two never match): stone chips in steps, wood splinters in saw teeth, turf
 *            tears in lumps, metal stays smooth, paper/cloth/earth fray finely; torn borders add stepped bites. Width follows the
 *            painted level: cracked = a hairline rip, broken = an open tear, crater = a gaping rip.
 *   LIPS     the surface beside the opening is PULLED APART: the map's own pixels are displaced outwards (what lay on the spine now
 *            sits at the lip) and sheared a little along the tear, so things crossing the tear no longer line up. Each lip shows a
 *            thin rim of its underside (fibre, soil, fresh stone, pale wood, a curled metal edge). The lips are cut into pieces of
 *            irregular length (jagged seams) so the entry can peel them apart from the closed state.
 *   BENEATH  the revealed layer in the material's ramp: the far (north) wall in strata, a floor that darkens with depth to a void
 *            in a gaping rip, the north lip's shadow, roots, joists or a girder glimpse, rubble.
 *   DETAIL   fibres and turf strands across the gap (some whole and sagging, most snapped and dangling), flaps hanging from a lip,
 *            short secondary rips branching off obliquely near the tips, a hairline running on past each tip, chips along the lips.
 *
 * Deterministic from this area's own pixels, the map pixels in its window and the stroke's seed (per-stroke independence).
 * Returns the area's sprites in core's format: base (0), cover (2), lip pieces (1).
 */

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function h2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  const top = a + (b - a) * u, bot = c + (d - c) * u;
  return top + (bot - top) * v;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];
const mul = (c, f) => [clamp(Math.round(c[0] * f), 0, 255), clamp(Math.round(c[1] * f), 0, 255), clamp(Math.round(c[2] * f), 0, 255)];
const mix = (a, b, t) => [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
const add = (c, r, g, b) => [clamp(c[0] + r, 0, 255), clamp(c[1] + g, 0, 255), clamp(c[2] + b, 0, 255)];
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const grey = (c) => { const l = lum(c); return [l, l, l]; };

/** Layers of a window pixel. */
const NONE = 0, BASE = 1;   // >= 2: lip piece (segment id + 2)

/**
 * @param {object} X  W, H, RX, RY (window), map (window RGBA), own, sev, px (own pixel indices), C (core's analysed area: cls, pal,
 *   maxD, path, axis, cx, cy, len), P (params), seed, uid, jag, mat (material name), matIndex, stats, metaFields
 */
export function bakeTear(X) {
  const { W, H, RX, RY, map, own, sev, C, P, seed, uid, jag, mat, stats, metaFields: MF } = X;
  const N = W * H;
  const R = rng(seed * 131 + Math.imul(uid, 6007) + 5);
  const sd = (Math.imul(seed, 7919) ^ Math.imul(uid, 2654435761)) | 0;
  const pal = C.pal, rp = pal.ramp, ink = pal.ink;
  const maxD = Math.max(1.5, C.maxD);
  const debrisK = clamp(P.debris ?? 0.7, 0, 1), rubbleK = clamp(P.rubble ?? 0.6, 0, 1);
  // the map beside a pulled lip: past the window's edge (the scene's edge at a border) it is mirrored, never the last row smeared out
  const mir = (v, n) => { v = Math.round(v); if ( n < 2 ) return 0; const p = 2 * n - 2; v = ((v % p) + p) % p; return v < n ? v : p - v; };
  const mapAt = (x, y) => { x = mir(x, W); y = mir(y, H); const o = (y * W + x) * 4; return [map[o], map[o + 1], map[o + 2]]; };
  const isOwn = (x, y) => x >= 0 && y >= 0 && x < W && y < H && own[y * W + x] === 1;
  const nearOwn = (x, y, r) => { const X0 = Math.round(x), Y0 = Math.round(y); for ( let dy = -r; dy <= r; dy++ ) for ( let dx = -r; dx <= r; dx++ ) if ( isOwn(X0 + dx, Y0 + dy) ) return true; return false; };

  /* ---------------------------------------------------------------- 1. the spine */
  const spine = buildSpine();
  const NS = spine.x.length, L = NS - 1;
  const SX = spine.x, SY = spine.y, TX = spine.tx, TY = spine.ty, NX = spine.nx, NY = spine.ny;
  const at = (s) => clamp(Math.round(s), 0, L);

  function resample(pts) {
    const out = [[pts[0][0], pts[0][1]]];
    let carry = 0;
    for ( let k = 1; k < pts.length; k++ ) {
      const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], l = Math.hypot(x1 - x0, y1 - y0);
      if ( !l ) continue;
      let s = 1 - carry;
      while ( s <= l ) { out.push([x0 + (x1 - x0) * s / l, y0 + (y1 - y0) * s / l]); s += 1; }
      carry = l - (s - 1);
    }
    const last = pts[pts.length - 1], q = out[out.length - 1];
    if ( Math.hypot(last[0] - q[0], last[1] - q[1]) > 0.4 ) out.push([last[0], last[1]]);
    return out;
  }
  function smooth(pts, r, passes) {
    let a = pts;
    for ( let p = 0; p < passes; p++ ) {
      a = a.map((q, i) => {
        if ( i === 0 || i === a.length - 1 ) return q;
        const k = Math.min(r, i, a.length - 1 - i);
        let sx = 0, sy = 0; for ( let j = -k; j <= k; j++ ) { sx += a[i + j][0]; sy += a[i + j][1]; }
        return [sx / (2 * k + 1), sy / (2 * k + 1)];
      });
    }
    return a;
  }
  function fromAxis() {
    const ax = C.axis, nx = -ax[1], ny = ax[0];
    let t0 = Infinity, t1 = -Infinity;
    const bins = new Map();
    for ( const i of X.px ) {
      const x = i % W + 0.5 - C.cx, y = (i - (i % W)) / W + 0.5 - C.cy, t = x * ax[0] + y * ax[1], q = x * nx + y * ny;
      if ( t < t0 ) t0 = t; if ( t > t1 ) t1 = t;
      const b = Math.floor(t / 4), e = bins.get(b) ?? bins.set(b, [0, 0]).get(b); e[0] += q; e[1]++;
    }
    // the tips reach into the rounded ends of the painted shape, not to its very rim
    const cut = Math.min(0.3 * maxD, (t1 - t0) * 0.2);
    t0 += cut; t1 -= cut;
    if ( t1 - t0 < 4 ) { const m = (t0 + t1) / 2; t0 = m - 2; t1 = m + 2; }
    const pts = [];
    for ( let t = t0; t <= t1 + 1e-6; t += 1 ) {
      const b = Math.floor(t / 4), e = bins.get(b);
      const q = e ? e[0] / e[1] : 0;
      pts.push([C.cx + ax[0] * t + nx * q, C.cy + ax[1] * t + ny * q]);
    }
    return smooth(pts, 4, 3);
  }
  function buildSpine() {
    let pts = null;
    if ( C.path?.pts?.length > 1 ) {
      let r = smooth(resample(C.path.pts), 3, 2);
      // only the run of the path that lies on this part (a stroke can fall apart into several parts)
      let best = [0, -1], cur = -1;
      for ( let i = 0; i <= r.length; i++ ) {
        const ok = i < r.length && nearOwn(r[i][0], r[i][1], 2);
        if ( ok && cur < 0 ) cur = i;
        if ( !ok && cur >= 0 ) { if ( i - cur > best[1] - best[0] + 1 ) best = [cur, i - 1]; cur = -1; }
      }
      r = r.slice(best[0], best[1] + 1);
      if ( r.length >= 8 ) {
        // the brush path holds the brush's centre: the tear runs on into the rounded ends of the stroke while the paint lasts
        const ext = (p, q) => {
          const dx = p[0] - q[0], dy = p[1] - q[1], l = Math.hypot(dx, dy) || 1, out = [];
          for ( let k = 1; k <= Math.round(0.45 * maxD); k++ ) { const x = p[0] + dx / l * k, y = p[1] + dy / l * k; if ( !nearOwn(x, y, 0) ) break; out.push([x, y]); }
          return out;
        };
        const a = ext(r[0], r[Math.min(4, r.length - 1)]).reverse(), b = ext(r[r.length - 1], r[Math.max(0, r.length - 5)]);
        pts = [...a, ...r, ...b];
      }
    }
    if ( !pts ) pts = fromAxis();
    if ( pts.length < 2 ) pts = [[C.cx - 1, C.cy], [C.cx + 1, C.cy]];
    // a slow seeded meander (zero at the tips), then the frame
    const n0 = frame(pts), n = pts.length, amp1 = Math.min(2.6, 0.12 * maxD + 0.6), amp2 = 0.55;
    const m = pts.map((p, i) => {
      const t = n > 1 ? i / (n - 1) : 0.5, env = Math.sin(Math.PI * t) ** 0.5;
      const off = ((vnoise(i / 13, 0.5, sd + 11) - 0.5) * 2 * amp1 + (vnoise(i / 4.5, 2.5, sd + 12) - 0.5) * 2 * amp2) * env;
      return [p[0] + n0.nx[i] * off, p[1] + n0.ny[i] * off];
    });
    const f = frame(m);
    return { x: Float64Array.from(m, (p) => p[0]), y: Float64Array.from(m, (p) => p[1]), ...f };
  }
  function frame(pts) {
    const n = pts.length, tx = new Float64Array(n), ty = new Float64Array(n), nx = new Float64Array(n), ny = new Float64Array(n);
    for ( let i = 0; i < n; i++ ) {
      const a = pts[Math.max(0, i - 3)], b = pts[Math.min(n - 1, i + 3)];
      let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      tx[i] = dx; ty[i] = dy; nx[i] = -dy; ny[i] = dx;
    }
    return { tx, ty, nx, ny };
  }

  /* ---------------------------------------------------------------- 2. level, width, the two lips' edges */
  const lv = new Float64Array(NS);
  for ( let i = 0; i < NS; i++ ) {
    const x = Math.round(SX[i]), y = Math.round(SY[i]);
    let v = 0;
    search: for ( let r = 0; r <= Math.ceil(maxD) + 2; r++ ) for ( let dy = -r; dy <= r; dy++ ) for ( let dx = -r; dx <= r; dx++ ) {
      if ( Math.max(Math.abs(dx), Math.abs(dy)) !== r || !isOwn(x + dx, y + dy) ) continue;
      v = sev[(y + dy) * W + x + dx]; break search;
    }
    lv[i] = v || 1;
  }
  { const c = Float64Array.from(lv); for ( let i = 0; i < NS; i++ ) { let s = 0, k = 0; for ( let j = Math.max(0, i - 5); j <= Math.min(L, i + 5); j++ ) { s += c[j]; k++; } lv[i] = s / k; } }
  let lvMax = 1; for ( const v of lv ) lvMax = Math.max(lvMax, v);
  const mid = clamp(0.3 * maxD, 1.6, 6), big = clamp(0.62 * maxD, 3, 13);
  const hwOf = (l) => l <= 1 ? 0.55 : l <= 2 ? lerp(0.55, mid, l - 1) : lerp(mid, big, Math.min(1, l - 2));
  // the bulge sits off centre; the profile is pointed at both tips
  const peak = 0.36 + 0.28 * R();
  const prof = (i) => {
    const t = L > 0 ? i / L : 0.5, u = t < peak ? 0.5 * t / peak : 0.5 + 0.5 * (t - peak) / (1 - peak);
    return Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.72);
  };
  const edgeSeq = (side) => {
    // one lip's own edge: offsets in art px (+ = the lip stands back, - = it reaches into the gap), per material
    const e = new Float64Array(NS), k = sd + (side > 0 ? 1000 : 2000);
    let i = 0, run = 0;
    const H1 = (j, q) => h2(j, q, k);
    switch ( mat ) {
      case "stone":   // stepped chips, now and then a V notch
        while ( i < NS ) {
          const len = 2 + Math.floor(H1(run, 1) * 5), notch = H1(run, 2) < 0.16, v = (H1(run, 3) - 0.5) * 1.8;
          for ( let j = 0; j < len && i < NS; j++, i++ ) e[i] = notch ? 1.5 * (1 - Math.abs(2 * (j + 0.5) / len - 1)) : v;
          run++;
        }
        break;
      case "wood":    // splinters: saw teeth that reach into the gap along the tear
        while ( i < NS ) {
          const len = 3 + Math.floor(H1(run, 1) * 8), dir = H1(run, 2) < 0.5, A = 0.8 + H1(run, 3) * 1.4;
          for ( let j = 0; j < len && i < NS; j++, i++ ) { const f = (j + 0.5) / len; e[i] = 0.6 - A * (dir ? f : 1 - f); }
          run++;
        }
        break;
      case "grass":   // turf tears in lumps and clumps
        for ( ; i < NS; i++ ) e[i] = (vnoise(i / 4.5, 0.5, k) - 0.5) * 2.2 + (vnoise(i / 1.8, 3.5, k) - 0.5) * 1.1;
        break;
      case "metal":   // a sheet peels smoothly
        for ( ; i < NS; i++ ) e[i] = (vnoise(i / 9, 0.5, k) - 0.5) * 0.9;
        break;
      case "sand": case "snow":   // crumbles
        for ( ; i < NS; i++ ) e[i] = (vnoise(i / 3, 0.5, k) - 0.5) * 1.5 + (H1(i, 4) - 0.5) * 0.7;
        break;
      default:        // paper, cloth, earth: frays finely
        for ( ; i < NS; i++ ) e[i] = (vnoise(i / 5, 0.5, k) - 0.5) * 1.1 + (H1(i, 4) - 0.5) * 0.9;
    }
    if ( jag ) for ( i = 0; i < NS; i++ ) {   // torn borders: stepped teeth and bites
      e[i] += (h2(i >> 1, side, k + 5) - 0.5) * 1.8 * jag;
      if ( h2(i >> 2, side, k + 6) < 0.1 * jag ) e[i] += 1.4;
    }
    return e;
  };
  const EL = edgeSeq(1), ER = edgeSeq(-1);
  const eL = new Float64Array(NS), eR = new Float64Array(NS), hw = new Float64Array(NS);
  for ( let i = 0; i < NS; i++ ) {
    const base = hwOf(lv[i]) * prof(i) * (1 + (vnoise(i / 11, 7.5, sd + 21) - 0.5) * 0.7 + (vnoise(i / 3.5, 9.5, sd + 22) - 0.5) * 0.24);
    hw[i] = base;
    const size = clamp(base / 2.5, 0.3, 1.4) * Math.min(1, prof(i) * 3);
    const aL = 1 + (vnoise(i / 7, 4.5, sd + 23) - 0.5) * 0.6, aR = 1 + (vnoise(i / 7, 5.5, sd + 24) - 0.5) * 0.6;
    eL[i] = Math.max(0, base * aL + EL[i] * size);
    eR[i] = Math.max(0, base * aR + ER[i] * size);
  }
  // a hairline rip holds together here and there (small bridges, at uneven spacing)
  for ( let i = 2 + Math.floor(R() * 10); i < NS; i += 10 + Math.floor(R() * 22) ) {
    if ( hw[i] > 0.9 ) continue;
    const n = 1 + Math.floor(R() * 2);
    for ( let j = i; j < Math.min(NS, i + n); j++ ) eL[j] = eR[j] = 0;
  }
  const wAt = (i) => (eL[i] + eR[i]) / 2;
  // the pull of the lips is smooth (a moving average of each lip's edge): the jagged edge only cuts the lip, it never makes the
  // displaced map jump from pixel to pixel
  const smoothOf = (e) => { const o = new Float64Array(NS); for ( let i = 0; i < NS; i++ ) { let s = 0, k = 0; for ( let j = Math.max(0, i - 5); j <= Math.min(L, i + 5); j++ ) { s += e[j]; k++; } o[i] = s / k; } return o; };
  const pL = smoothOf(eL), pR = smoothOf(eR);
  let wMax = 0; for ( let i = 0; i < NS; i++ ) wMax = Math.max(wMax, wAt(i));
  const zOf = (i) => { const w = (pL[i] + pR[i]) / 2; return w >= 1.1 ? Math.max(2.2 * w, w + 3) : 0; };
  const rimOf = (i, side) => { const w = wAt(i); if ( w < 0.9 ) return 1; if ( mat === "metal" ) return 2; return w < 2.5 ? 1 + (h2(i >> 2, side, sd + 31) > 0.6 ? 1 : 0) : 2 + (vnoise(i / 6, side, sd + 32) > 0.55 ? 1 : 0); };
  // which lip is the north one (its outward normal points up the screen): its broken face is the far wall, it shadows the gap
  const northSide = (i) => (NY[i] < 0 ? 1 : -1);

  /* ---------------------------------------------------------------- 3. every pixel near the spine: arc length, signed distance */
  const best = new Float32Array(N).fill(Infinity), near = new Int32Array(N).fill(-1);
  for ( let i = 0; i < NS; i++ ) {
    const rad = Math.ceil(Math.max(eL[i], eR[i]) + zOf(i) + 4);
    const cx = SX[i], cy = SY[i];
    for ( let y = Math.max(0, Math.floor(cy - rad)); y <= Math.min(H - 1, Math.ceil(cy + rad)); y++ ) for ( let x = Math.max(0, Math.floor(cx - rad)); x <= Math.min(W - 1, Math.ceil(cx + rad)); x++ ) {
      const d2 = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
      if ( d2 > rad * rad ) continue;
      const o = y * W + x; if ( d2 < best[o] ) { best[o] = d2; near[o] = i; }
    }
  }
  const col = new Uint8ClampedArray(N * 4), layer = new Int32Array(N);
  const put = (o, c, lay) => { col[o * 4] = c[0]; col[o * 4 + 1] = c[1]; col[o * 4 + 2] = c[2]; col[o * 4 + 3] = 255; if ( lay !== undefined ) layer[o] = lay; };
  const blend = (o, c, t) => { if ( !layer[o] ) return false; const m = mix([col[o * 4], col[o * 4 + 1], col[o * 4 + 2]], c, t); col[o * 4] = m[0]; col[o * 4 + 1] = m[1]; col[o * 4 + 2] = m[2]; return true; };
  const openA = new Uint8Array(N), sA = new Float32Array(N), dA = new Float32Array(N);
  for ( let o = 0; o < N; o++ ) {
    const i = near[o]; if ( i < 0 ) continue;
    const x = o % W, y = (o - x) / W, px = x + 0.5 - SX[i], py = y + 0.5 - SY[i];
    const s = i + px * TX[i] + py * TY[i];
    if ( s < -0.6 || s > L + 0.6 ) { near[o] = -1; continue; }
    const d = px * NX[i] + py * NY[i];
    sA[o] = s; dA[o] = d;
    const side = d >= 0 ? 1 : -1, edge = side > 0 ? eL[i] : eR[i];
    const jit = (jag ? (h2(x >> 1, y >> 1, sd + 7) - 0.5) * 0.8 * jag : 0) + (h2(x, y, sd + 8) - 0.5) * 0.3;
    // the opening never reaches past the stroke's own pixels (a tear changes only what it was painted on)
    if ( edge > 0.05 && Math.abs(d) < edge + jit && own[o] ) openA[o] = 1;
  }

  /* ---------------------------------------------------------------- 4. the lips: pulled apart, sheared, an underside rim */
  const shearSign = R() < 0.5 ? 1 : -1;
  // lip pieces: per side, cut at random lengths; seams wander (no straight cuts)
  const cuts = [[], []];
  for ( const k of [0, 1] ) { let s = -2 - R() * 6; while ( s < L + 30 ) { cuts[k].push(s); s += 7 + R() * 12; } }
  const segOf = (k, s) => { const c = cuts[k]; let j = 0; while ( j + 1 < c.length && c[j + 1] <= s ) j++; return j; };
  const pieceW = wMax >= 1.4;
  const segAcc = new Map();
  for ( let o = 0; o < N; o++ ) {
    const i = near[o]; if ( i < 0 || openA[o] ) continue;
    const x = o % W, y = (o - x) / W, d = dA[o], s = sA[o], side = d >= 0 ? 1 : -1, ad = Math.abs(d);
    const edge = side > 0 ? eL[i] : eR[i], e = ad - edge, Z = zOf(i), rim = rimOf(i, side);
    if ( e >= Math.max(Z, rim) ) { near[o] = -1; continue; }
    // the lips are the stroke's own pixels only: nothing outside its mask is laid over (older or neighbouring damage stays as it is)
    if ( !own[o] ) { near[o] = -1; continue; }
    // the displaced map: what lay at u from the spine is now at u + pull * g(u), g = (1 - u / Z)^2; relative to the pixel itself,
    // so far out (g = 0) it is the map exactly. Towards the mask's own border the pull eases out to nothing (3 px), so the lip meets
    // the ground outside the stroke without a seam
    let c;
    if ( Z > 0 ) {
      const pull = side > 0 ? pL[i] : pR[i];
      let u = Math.max(0, ad - pull);
      for ( let it = 0; it < 6; it++ ) { const g = u < Z ? (1 - u / Z) ** 2 : 0; u = Math.max(0, ad - pull * g); }
      const ease = X.din ? clamp((X.din[o] - 0.5) / 3, 0, 1) : 1;
      const g = (u < Z ? (1 - u / Z) ** 2 : 0) * ease, sh = shearSign * side * 0.35 * pull * g, back = (ad - u) * ease;
      c = mapAt(x - NX[i] * side * back - TX[i] * sh, y - NY[i] * side * back - TY[i] * sh);
    } else c = mapAt(x, y);
    // the lifted lip catches a little light on one side, a little shade on the other
    const ox = NX[i] * side, oy = NY[i] * side, toLight = -(ox * -0.7071 + oy * -0.7071);
    if ( Z > 0 ) c = mul(c, 1 + 0.1 * toLight * clamp(1 - e / Z, 0, 1));
    if ( e < rim ) c = rimColour(c, e, i, side, x, y);
    const lay = pieceW && wAt(i) >= 1.1 ? 2 + (side > 0 ? 0 : 4096) + segOf(side > 0 ? 0 : 1, s + (vnoise(e / 2.5, s / 7, sd + 41) - 0.5) * 5) : BASE;
    put(o, c, lay);
    if ( lay >= 2 ) {
      const a = segAcc.get(lay) ?? segAcc.set(lay, { n: 0, ox: 0, oy: 0, e: 0, s: 0 }).get(lay);
      a.n++; a.ox += ox; a.oy += oy; a.e += edge; a.s += s;
    }
  }
  /** The underside showing at the torn edge, by material. e: px out from the edge (0 = at the gap). */
  function rimColour(c, e, i, side, x, y) {
    const north = side === northSide(i), inner = e < 1;
    let r;
    switch ( mat ) {
      case "grass": r = inner ? mix(pal.strata[0], rp[1], 0.3) : mix(c, pal.strata[0], 0.55); if ( !inner && h2(x, y, sd + 51) < 0.3 ) r = mul(c, 1.18); break;
      case "stone": r = add(mul(mix(c, grey(c), 0.5), inner ? 1.28 : 1.12), 4, 4, 6); break;
      case "wood":  r = add(mul(c, inner ? 1.32 : 1.15), 18, 10, 0); break;
      case "metal": r = inner ? mul(ink, 1.1) : mix(mul(c, 1.6), [236, 240, 245], 0.35); break;
      case "sand":  r = mul(c, inner ? 0.78 : 0.9); break;
      case "snow":  r = inner ? mix(c, [255, 255, 255], 0.6) : mix(c, [170, 190, 215], 0.25); break;
      default:      r = add(mul(mix(c, grey(c), 0.55), inner ? 1.3 : 1.14), 10, 8, 4);   // the pale fibre of paper and cloth
    }
    // the north lip's broken face drops into shadow right at the gap; the south lip's edge is lit
    if ( inner && north && mat !== "metal" ) r = mix(r, ink, 0.25);
    else if ( inner && !north ) r = mul(r, 1.06);
    return r;
  }

  /* ---------------------------------------------------------------- 5. the opening: wall, floor, shadow, material, rubble */
  const beams = [];
  if ( (mat === "wood" || mat === "metal") && wMax >= 2.5 ) {
    const nb = mat === "metal" ? 1 : 1 + (R() < 0.45 ? 1 : 0), grainX = !!C.cls.grainX;
    let x0 = Infinity, x1 = -Infinity; for ( let i = 0; i < NS; i++ ) { const q = grainX ? SY[i] : SX[i]; x0 = Math.min(x0, q); x1 = Math.max(x1, q); }
    for ( let k = 0; k < nb; k++ ) { let q = 0; for ( let t = 0; t < 4; t++ ) { q = lerp(x0, x1, 0.2 + 0.6 * R()); if ( beams.every((b) => Math.abs(b.q - q) > 9) ) break; } beams.push({ q, grainX: !grainX, w: mat === "metal" ? 1.2 : 1.6 }); }
  }
  const flaps = [];
  if ( wMax >= 2.5 && mat !== "metal" ) {
    const n = Math.round(L / 45 * (0.5 + R()));
    for ( let k = 0; k < n; k++ ) {
      const s0 = L * (0.15 + 0.7 * R()), len = 3 + R() * 5, side = R() < 0.5 ? 1 : -1, i = at(s0 + len / 2);
      if ( wAt(i) < 2.2 ) continue;
      flaps.push({ s0, len, side, depth: 1 + R() * Math.min(3, wAt(i) * 0.5), src: (() => { const u = (side > 0 ? eL[i] : eR[i]) + 2; return mapAt(SX[i] + NX[i] * side * u, SY[i] + NY[i] * side * u); })() });
    }
  }
  const deepOf = (i) => clamp((lv[i] - 1) / 2, 0, 1);
  for ( let o = 0; o < N; o++ ) {
    if ( !openA[o] ) continue;
    const x = o % W, y = (o - x) / W, i = at(sA[o]), d = dA[o], w = wAt(i), deep = deepOf(i);
    if ( w < 0.9 ) { put(o, mix(mapAt(x, y), ink, 0.86), BASE); continue; }   // a hairline rip: one dark pixel
    // a flap hanging from a lip into the gap: a piece of the surface, tipped down (darker), its tip inked
    let flap = null;
    for ( const f of flaps ) {
      if ( Math.sign(d || 1) !== f.side || sA[o] < f.s0 || sA[o] > f.s0 + f.len ) continue;
      const reach = f.depth * (1 - Math.abs(2 * (sA[o] - f.s0) / f.len - 1)), edge = f.side > 0 ? eL[i] : eR[i];
      if ( edge - Math.abs(d) < reach ) { flap = (edge - Math.abs(d) > reach - 1) ? mul(f.src, 0.5) : mul(f.src, 0.74); break; }
    }
    if ( flap ) { put(o, flap, BASE); continue; }
    // the far wall: the north lip's broken face, seen face-on by the oblique camera
    const wallH = clamp(Math.round(w * 0.55 + deep), 1, 4);
    let wall = 0;
    for ( let k = 1; k <= wallH; k++ ) { const q = o - k * W; if ( q < 0 || !openA[q] ) { wall = k; break; } }
    if ( wall ) {
      const above = mapAt(x, y - wall);
      put(o, wall === 1 ? mul(above, 0.55) : wall === 2 ? pal.strata[0] : ((x + y) & 1 ? pal.strata[1] : mul(pal.strata[1], 0.86)), BASE);
      continue;
    }
    const toL = eL[i] - d, toR = eR[i] + d, m = Math.min(toL, toR), dn = clamp(m / Math.max(0.8, w), 0, 1);
    const toNorth = northSide(i) > 0 ? toL : toR;
    let v = 2.7 - dn * (1.4 + 1.8 * deep) + (h2(x, y, sd + 61) - 0.5) * 0.7 + (vnoise(x / 3, y / 3, sd + 62) - 0.5) * 0.7;
    if ( toNorth < Math.min(2.5, w * 0.6) ) v -= 1.1;              // the north lip's shadow
    else if ( toNorth > m + 0.5 && m < 1.2 ) v += 0.6;             // the south slope catches light
    let c = rp[clamp(Math.floor(v + bayer(x, y) - 0.5), 0, 4)];
    if ( deep > 0.55 && dn > 0.5 ) { const k = (dn - 0.5) / 0.4 * (deep - 0.4) / 0.6, th = h2(x, y, sd + 63) * 0.5 + vnoise(x / 2, y / 2, sd + 64) * 0.5; if ( th < k ) c = pal.void; else if ( th < k + 0.18 ) c = rp[0]; }
    switch ( mat ) {
      case "grass": if ( toNorth < 3 && h2(x, y >> 1, sd + 65) < 0.09 ) c = mix(pal.strata[1], rp[0], 0.4); break;   // roots
      case "snow": if ( h2(x, y, sd + 66) < 0.06 && pal.chunk ) c = pal.chunk; break;
      case "sand": if ( m < 1.6 && h2(x, y, sd + 67) < 0.35 ) c = rp[3]; break;                                    // sand trickling in
      case "water": c = pal.waterR[clamp(Math.floor(v + bayer(x, y) - 0.5), 0, 3)]; break;
    }
    for ( const b of beams ) {
      const q = b.grainX ? y : x;
      if ( Math.abs(q + 0.5 - b.q) < b.w && dn > 0.12 ) c = mat === "metal" ? mix(pal.girder ?? rp[2], rp[2], 0.3) : (Math.abs(q + 0.5 - b.q) > b.w - 1 ? mul(pal.beam ?? rp[3], 0.65) : pal.beam ?? rp[3]);
    }
    if ( dn > 0.15 && dn < 0.85 && h2(x, y, sd + 68) < 0.045 * rubbleK * (0.5 + deep) ) c = rp[3 + (h2(x, y, sd + 69) < 0.4 ? 1 : 0)];
    put(o, c, BASE);
  }

  /* ---------------------------------------------------------------- 6. fibres and strands across the gap */
  const fibreK = { grass: 1.2, wood: 0.8, stone: 0.25, metal: 0, sand: 0.5, snow: 0.5 }[mat] ?? 1;
  if ( wMax >= 1.6 && fibreK > 0 ) {
    const n = Math.round(L / 30 * (0.4 + R()) * fibreK), placed = [];
    for ( let k = 0; k < n; k++ ) {
      let s = -1;
      for ( let t = 0; t < 4; t++ ) { const q = L * (0.1 + 0.8 * R()); if ( placed.every((p) => Math.abs(p - q) > 5) ) { s = q; break; } }
      if ( s < 0 ) continue;
      const i0 = at(s), w = wAt(i0); if ( w < 1.5 ) continue;
      placed.push(s);
      const i1 = at(s + (R() < 0.5 ? -1 : 1) * (0.4 + R()) * w);   // always slanted, never a comb of upright ticks
      const a = [SX[i0] + NX[i0] * (eL[i0] + 0.2), SY[i0] + NY[i0] * (eL[i0] + 0.2)], b = [SX[i1] - NX[i1] * (eR[i1] + 0.2), SY[i1] - NY[i1] * (eR[i1] + 0.2)];
      const fc = fibreColour(a), whole = R() < 0.35;
      if ( whole ) fibre(a, b, 0, 1, fc, Math.min(2, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.15));
      else { fibre(a, b, 0, 0.2 + R() * 0.35, fc, 1 + R()); fibre(b, a, 0, 0.15 + R() * 0.35, fc, 1 + R()); }
    }
  }
  function fibreColour(p) {
    // in the gap's shade: never brighter than the lip it hangs from
    const c = mapAt(p[0], p[1]);
    if ( mat === "grass" ) return R() < 0.6 ? mul(c, 0.95) : mix(pal.strata[0], rp[2], 0.3);
    if ( mat === "wood" ) return mix(add(mul(c, 1.2), 12, 6, 0), rp[2], 0.3);
    return mix(mul(mix(c, grey(c), 0.5), 1.05), rp[2], 0.35);
  }
  /** A fibre from a to b, drawn from t0 to t1 of the way, its free end drooping by `droop` art px (the middle, for a whole one). */
  function fibre(a, b, t0, t1, c, droop) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.ceil(len * (t1 - t0) * 1.5)), whole = t1 >= 1;
    for ( let k = 0; k <= n; k++ ) {
      const t = t0 + (t1 - t0) * k / n, f = k / n;
      const sag = whole ? Math.sin(Math.PI * t) * droop : f * f * droop;
      const x = Math.round(a[0] + (b[0] - a[0]) * t - 0.5), y = Math.round(a[1] + (b[1] - a[1]) * t + sag - 0.5);
      if ( x < 0 || y < 0 || x >= W || y >= H ) continue;
      const o = y * W + x; if ( !openA[o] ) continue;
      put(o, c, BASE);
      const q = o + W; if ( y + 1 < H && openA[q] && layer[q] === BASE ) blend(q, rp[0], 0.45);
    }
  }

  /* ---------------------------------------------------------------- 7. secondary rips near the tips, hairlines past the tips */
  const marked = new Uint8Array(N), crackList = [];
  const crackPx = (x, y, strong) => {
    x = Math.round(x); y = Math.round(y);
    if ( x < 2 || y < 2 || x >= W - 2 || y >= H - 2 ) return false;
    const o = y * W + x; if ( openA[o] || marked[o] ) return true;
    marked[o] = 1; crackList.push(o);
    const base = layer[o] ? [col[o * 4], col[o * 4 + 1], col[o * 4 + 2]] : mapAt(x, y);
    put(o, mix(base, ink, strong ? 0.88 : 0.62), layer[o] || BASE);
    const q = o - W;
    if ( !openA[q] && !marked[q] && h2(x, y, sd + 81) < 0.5 ) { const b2 = layer[q] ? [col[q * 4], col[q * 4 + 1], col[q * 4 + 2]] : mapAt(x, y - 1); put(q, mul(b2, 1.14), layer[q] || BASE); }
    return true;
  };
  const walk = (x, y, ang, len, w0, depth) => {
    const a0 = ang;
    for ( let k = 0; k < len; k++ ) {
      // jitters, bends a little, never curls back (pulled towards its first heading)
      ang += (vnoise(k / 5, depth + 0.5, sd + 83) - 0.5) * 0.22 + (R() - 0.5) * 0.35 + (a0 - ang) * 0.15;
      x += Math.cos(ang); y += Math.sin(ang);
      const w = w0 * (1 - k / len);
      // dark at the root, fading to a faint scratch at its end
      if ( !crackPx(x, y, k < len * 0.55 || (depth === 0 && h2(k, 3, sd + 85) < 0.3)) ) return;
      if ( w > 0.75 ) crackPx(x - Math.sin(ang) * (h2(k, depth, sd + 84) < 0.5 ? 1 : -1), y + Math.cos(ang), false);
      if ( depth === 0 && k > len * 0.35 && k < len * 0.75 && R() < 0.035 ) walk(x, y, ang + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.4), (len - k) * 0.5, w * 0.6, 1);
    }
  };
  for ( const end of [0, 1] ) {
    const n = 1 + (R() < 0.55 ? 1 : 0) + (R() < 0.2 && lvMax > 1.5 ? 1 : 0);
    for ( let k = 0; k < n; k++ ) {
      const frac = 0.04 + R() * 0.24, i0 = at(end ? L - frac * L : frac * L), side = R() < 0.5 ? 1 : -1;
      const tdx = end ? TX[i0] : -TX[i0], tdy = end ? TY[i0] : -TY[i0];
      const a = (25 + R() * 40) * Math.PI / 180, dx = tdx * Math.cos(a) + NX[i0] * side * Math.sin(a), dy = tdy * Math.cos(a) + NY[i0] * side * Math.sin(a);
      const edge = (side > 0 ? eL[i0] : eR[i0]) + 0.3;
      const len = clamp(4 + R() * 0.16 * L, 4, 22) * (lvMax < 1.4 ? 0.6 : 1);
      walk(SX[i0] + NX[i0] * side * edge - 0.5, SY[i0] + NY[i0] * side * edge - 0.5, Math.atan2(dy, dx), len, clamp(0.3 * wAt(i0), 0.5, 1.6), 0);
    }
    // the rip runs on a little past its tip as a hairline
    const i = end ? L : 0, tx = end ? TX[i] : -TX[i], ty = end ? TY[i] : -TY[i];
    walk(SX[i] - 0.5, SY[i] - 0.5, Math.atan2(ty, tx), 3 + R() * 6, 0.6, 2);
  }

  /* ---------------------------------------------------------------- 8. chips along the lips */
  if ( wMax >= 0.9 ) for ( const side of [1, -1] ) for ( let i = 0; i < NS; i++ ) {
    if ( h2(i, side, sd + 91) >= debrisK * 0.08 * Math.max(0.2, lv[i] - 0.7) ) continue;
    const e = (side > 0 ? eL[i] : eR[i]) + rimOf(i, side) + 1 + h2(i, side, sd + 92) * 4;
    const x = Math.round(SX[i] + NX[i] * side * e + (h2(i, side, sd + 93) - 0.5) * 3 - 0.5), y = Math.round(SY[i] + NY[i] * side * e - 0.5);
    if ( x < 1 || y < 1 || x >= W - 2 || y >= H - 2 ) continue;
    const o = y * W + x; if ( openA[o] || !own[o] ) continue;
    const c = rimColour(mapAt(SX[i], SY[i]), 1.5, i, side, x, y);
    put(o, c, layer[o] || BASE);
    if ( h2(i, side, sd + 94) < 0.4 && !openA[o + 1] && own[o + 1] ) put(o + 1, mul(c, 0.8), layer[o + 1] || BASE);
    const q = o + W + 1; if ( !openA[q] && own[q] ) { const b = layer[q] ? [col[q * 4], col[q * 4 + 1], col[q * 4 + 2]] : mapAt(x + 1, y + 1); put(q, mix(b, rp[0], 0.4), layer[q] || BASE); }
  }

  /* ---------------------------------------------------------------- 8b. the cause (core.mjs's CAUSE table, the same kit as every kind) */
  // the floor, the torn lip, a halo round the opening, the hairlines' colour, the specks and the emissive light. Cause 0: nothing here
  // runs, the tear is exactly the plain one.
  let light = null;
  const cz = X.cz;
  if ( cz && X.causeKit ) {
    const glowA = cz.glow ? new Uint8Array(N) : null, glowC = glowA ? new Uint8Array(N * 3) : null;
    const cur = (o) => layer[o] ? [col[o * 4], col[o * 4 + 1], col[o * 4 + 2]] : [map[o * 4], map[o * 4 + 1], map[o * 4 + 2]];
    const kput = (x, y, c, a = 255) => {
      if ( x < 0 || y < 0 || x >= W || y >= H ) return;
      const o = y * W + x;
      put(o, a < 255 ? mix(cur(o), c, a / 255) : c, layer[o] || BASE);
    };
    const kglow = (x, y, c, a = 255) => {
      kput(x, y, c);
      if ( !glowA || x < 0 || y < 0 || x >= W || y >= H ) return;
      const q = y * W + x; if ( a <= glowA[q] ) return;
      glowA[q] = a; glowC[q * 3] = c[0]; glowC[q * 3 + 1] = c[1]; glowC[q * 3 + 2] = c[2];
    };
    // distance from the opening (the halo's and the lip's measure)
    const dO = new Float32Array(N);
    for ( let o = 0; o < N; o++ ) dO[o] = openA[o] ? 0 : 1e6;
    X.chamfer(dO, W, H);
    const mi = at(L / 2), haloR = cz.halo ? Math.min(14, (3 + maxD * cz.halo.r) * clamp(P.halo ?? 0.6, 0.15, 1) * (0.35 + lvMax / 3)) : 0;
    const kit = X.causeKit({ cz, pal, seed: sd, W, H, mapAt: cur, put: kput, glow: kglow, isIn: (x, y) => x >= 0 && y >= 0 && x < W && y < H && openA[y * W + x] === 1,
      inside: openA, din: X.din ?? dO, maxD, E0: { x: SX[mi], y: SY[mi] }, Rr: Math.max(3, wMax * 1.6), C: { cx: C.cx, cy: C.cy, axis: C.axis, maxD }, haloR });
    // the floor
    const openList = [];
    for ( let o = 0; o < N; o++ ) {
      if ( !openA[o] ) continue;
      openList.push(o);
      const i = at(sA[o]), w = wAt(i); if ( w < 0.9 ) continue;
      const x = o % W, y = (o - x) / W, d = dA[o], m = Math.min(eL[i] - d, eR[i] + d), dn = clamp(m / Math.max(0.8, w), 0, 1);
      const toNorth = northSide(i) > 0 ? eL[i] - d : eR[i] + d, lit = toNorth < Math.min(2.5, w * 0.6) ? -0.6 : 0.3;
      const c = kit.fill(x, y, cur(o), Math.pow(dn, 0.75) * (0.35 + 0.65 * deepOf(i)), dn, lit);
      if ( c ) put(o, c, layer[o] || BASE);
    }
    // the halo round the opening (on the lips and, softly, the ground just past them), then the torn lip itself
    if ( haloR > 0.5 ) for ( let o = 0; o < N; o++ ) { const d = dO[o]; if ( d >= 1.5 && d < haloR ) kit.halo(o % W, (o - (o % W)) / W, o, d); }
    for ( let o = 0; o < N; o++ ) {
      if ( openA[o] || !layer[o] || dO[o] > 1.01 ) continue;
      const x = o % W, y = (o - x) / W, i = near[o] >= 0 ? near[o] : at(L / 2);
      kit.lip(x, y, o, 1 + 2 * deepOf(i));
    }
    kit.crackLines([crackList]);
    if ( cz.fx ) kit.fx(openList, null);
    if ( glowA ) {
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for ( let o = 0; o < N; o++ ) if ( glowA[o] ) { const x = o % W, y = (o - x) / W; if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x; if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y; }
      if ( x1 >= 0 ) {
        const w = x1 - x0 + 1, h = y1 - y0 + 1, a = new Uint8Array(w * h), c = new Uint8Array(w * h * 3);
        for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) { const q = (y + y0) * W + x + x0, k = y * w + x; a[k] = glowA[q]; c[k * 3] = glowC[q * 3]; c[k * 3 + 1] = glowC[q * 3 + 1]; c[k * 3 + 2] = glowC[q * 3 + 2]; }
        light = X.softLight(a, c, w, h, x0, y0, cz.glowK ?? 1);
      }
    }
  }

  /* ---------------------------------------------------------------- 9. sprites */
  const items = [];
  const row = () => new Int16Array(MF);
  const crop = (pred) => {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for ( let o = 0; o < N; o++ ) if ( pred(o) ) { const x = o % W, y = (o - x) / W; if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x; if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y; }
    if ( x1 < 0 ) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, data = new Uint8ClampedArray(w * h * 4);
    for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) { const o = (y + y0) * W + x + x0; if ( pred(o) ) data.set(col.subarray(o * 4, o * 4 + 4), (y * w + x) * 4); }
    return { x: x0, y: y0, w, h, data };
  };
  const sp = at(L * (0.3 + 0.4 * R()));   // the puncture: where the rip starts (when it does not follow the stroke)
  let base = crop((o) => layer[o] === BASE);
  if ( !base ) base = { x: Math.round(SX[sp]), y: Math.round(SY[sp]), w: 1, h: 1, data: new Uint8ClampedArray(4) };
  {
    const m = row();
    m[0] = 0; m[3] = base.w; m[4] = base.h; m[5] = RX + base.x; m[6] = RY + base.y;
    m[7] = Math.round(RX + SX[sp]); m[8] = Math.round(RY + SY[sp]); m[9] = Math.round(Math.max(4, L / 2)); m[10] = X.type; m[11] = X.matIndex;
    const ax = SX[L] - SX[0], ay = SY[L] - SY[0];
    m[14] = Math.round(Math.atan2(ay, ax) * 1000); m[15] = Math.round(Math.min(3000, L * 10)); m[17] = Math.round(Math.min(300, wMax * 10));
    items.push({ img: base, m });
    // the cover: this part's own pixels (as core's areas)
    let cx0 = W, cy0 = H, cx1 = -1, cy1 = -1;
    for ( const i of X.px ) { const x = i % W, y = (i - x) / W; if ( x < cx0 ) cx0 = x; if ( x > cx1 ) cx1 = x; if ( y < cy0 ) cy0 = y; if ( y > cy1 ) cy1 = y; }
    const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1, cov = new Uint8ClampedArray(cw * ch * 4);
    for ( const i of X.px ) { const x = i % W - cx0, y = (i - (i % W)) / W - cy0, q = (y * cw + x) * 4; cov[q] = cov[q + 1] = cov[q + 2] = cov[q + 3] = 255; }
    const mc = row(); mc[0] = 2; mc[3] = cw; mc[4] = ch; mc[5] = RX + cx0; mc[6] = RY + cy0;
    items.push({ img: { w: cw, h: ch, data: cov, x: cx0, y: cy0 }, m: mc });
    // the cause's light (kind 3), as core's areas
    if ( light ) { const ml = row(); ml[0] = 3; ml[3] = light.w; ml[4] = light.h; ml[5] = RX + light.x; ml[6] = RY + light.y; ml[7] = X.cause ?? 0; items.push({ img: light, m: ml }); }
  }
  let bytes = base.data.length + (light?.data.length ?? 0), pieces = 0;
  // lip pieces, in screen order (lower ones drawn later); each knows where it lay before the rip opened (the closed lips)
  const segs = [...segAcc.entries()].map(([lay, a]) => ({ lay, a })).filter((q) => q.a.n >= 2);
  const imgs = segs.map(({ lay, a }) => ({ lay, a, img: crop((o) => layer[o] === lay) })).filter((q) => q.img).sort((p, q) => (p.img.y + p.img.h) - (q.img.y + q.img.h));
  for ( const { a, img } of imgs ) {
    const k = a.e / a.n, l = Math.hypot(a.ox, a.oy) || 1, ux = a.ox / l, uy = a.oy / l;
    const m = row();
    m[0] = 1; m[3] = img.w; m[4] = img.h; m[5] = RX + img.x; m[6] = RY + img.y;
    m[7] = RX + img.x - Math.round(ux * k); m[8] = RY + img.y - Math.round(uy * k);   // closed: shifted back onto the spine
    m[9] = 0;
    m[10] = Math.round(Math.min(8000, Math.abs(a.s / a.n - sp) * 4));
    m[11] = 4; m[12] = 0; m[13] = X.type;
    items.push({ img, m });
    bytes += img.data.length; pieces++;
  }
  stats.shards += pieces;
  return { items, stats, bytes };
}
