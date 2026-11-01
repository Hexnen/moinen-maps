/**
 * The TEAR (damage type "gash", "Tears" / "Rozdarcia"): the map's surface ripped open along the painted stroke, like torn paper,
 * cloth, turf or a split deck. Pure code (no DOM, no Foundry), called from core.mjs's per-area bake for a gash area.
 *
 *   SPINE    the stroke's own brush path (or, without one, the painted shape's main axis following its bends), resampled at one art
 *            pixel, smoothed and given a slow seeded meander. The tear's arc length s runs along it.
 *   OPENING  an ASYMMETRIC slit around the spine: one tip blunt, the other a needle or a fork, the swell off centre, pinches and
 *            bulges along it, the two lips' profiles shifted against each other, the gap's middle wandering off the spine. Each lip has its own edge function (the two never match): stone chips in steps, wood splinters in saw teeth, turf
 *            tears in lumps, metal stays smooth, paper/cloth/earth fray finely; torn borders add stepped bites. Width follows the
 *            painted level: cracked = a hairline rip, broken = an open tear, crater = a gaping rip.
 *   LIPS     the surface beside the opening is PULLED APART: the map's own pixels are displaced outwards (what lay on the spine now
 *            sits at the lip) and sheared a little along the tear, so things crossing the tear no longer line up. Each lip shows a
 *            rim of its underside of uneven width. The lips are cut into FLAPS of varied length (3-27 px, jagged seams), each with
 *            its fate in the entry: it settles back, it stays curled (its edge folded back, underside up) or it tears off into the gap.
 *   BENEATH  the revealed layer in the material's ramp: the far (north) wall in strata, a floor that darkens with depth to a void
 *            in a gaping rip, the north lip's shadow, roots, joists or a girder glimpse, rubble.
 *   DETAIL   fibres and turf strands across the gap (a few whole and sagging, most snapping during the entry as pieces of their
 *            own), curved tapering side rips that fork at their ends, a hairline past the tip, chips along the lips.
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
  // AN ASYMMETRIC OPENING (never a symmetric lens): one tip blunt (a short round end), the other a long needle or a fork; the swell
  // off centre; pinches and bulges along it; the two lips' profiles shifted along the tear against each other by a slowly varying
  // offset; the gap's middle wanders off the spine (one lip bites deeper than the other), and each lip has its own height
  const bluntEnd = R() < 0.5 ? 0 : 1, fork = R() < 0.45;
  const fb = 0.06 + 0.06 * R(), fnd = 0.26 + 0.2 * R(), peak = 0.28 + 0.44 * R(), spread = 0.28 + 0.2 * R();
  const ramp = (u, blunt) => blunt ? Math.pow(clamp(u / fb, 0, 1), 0.42) : Math.pow(clamp(u / fnd, 0, 1), 1.45);
  const prof = (s) => { const t = L > 0 ? clamp(s / L, 0, 1) : 0.5; return ramp(t, bluntEnd === 0) * ramp(1 - t, bluntEnd === 1) * (0.6 + 0.4 * Math.exp(-(((t - peak) / spread) ** 2))); };
  const bumps = [];
  for ( let k = 0, n = Math.max(1, Math.round(L / 36 * (0.6 + 0.8 * R()))); k < n; k++ ) bumps.push({ s: L * (0.15 + 0.7 * R()), r: 1.8 + 3.5 * R(), a: -(0.45 + 0.4 * R()) });
  for ( let k = 0, n = Math.round(L / 55 * (0.4 + R())); k < n; k++ ) bumps.push({ s: L * (0.15 + 0.7 * R()), r: 3 + 6 * R(), a: 0.25 + 0.5 * R() });
  const modAt = (s) => {
    let m = 1 + (vnoise(s / 10, 7.5, sd + 21) - 0.5) * 0.75 + (vnoise(s / 3.2, 9.5, sd + 22) - 0.5) * 0.3;
    for ( const b of bumps ) m *= 1 + b.a * Math.exp(-(((s - b.s) / b.r) ** 2));
    return Math.max(0.08, m);
  };
  const shiftAmp = Math.min(5, 1 + 0.035 * L);
  const offAt = (i) => (vnoise(i / 21, 3.5, sd + 25) - 0.5) * 2 * shiftAmp;
  const cAt = (i) => (vnoise(i / 14, 1.5, sd + 26) - 0.5) * 0.9 + (vnoise(i / 5, 2.5, sd + 27) - 0.5) * 0.2;
  const widthAt = (s) => { const q = clamp(s, 0, L), i0 = Math.floor(q), l = lerp(lv[i0], lv[Math.min(L, i0 + 1)], q - i0); return hwOf(l) * prof(q) * modAt(q); };
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
    const o = offAt(i), c = cAt(i);
    const bL = widthAt(i + o) * (1 + c), bR = widthAt(i - o) * (1 - c), base = (bL + bR) / 2;
    hw[i] = base;
    const size = clamp(base / 2.5, 0.3, 1.4) * Math.min(1, prof(i) * 3);
    eL[i] = Math.max(0, bL + EL[i] * size * (1 + 0.5 * c));
    eR[i] = Math.max(0, bR + ER[i] * size * (1 - 0.5 * c));
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
  // each lip its own height (how far it is lifted and pulled), varying along it
  const kSide = 0.7 + 0.6 * R(), zS = (i, side) => zOf(i) * (side > 0 ? kSide : 2.05 - kSide) * (0.75 + 0.5 * vnoise(i / 9, side > 0 ? 1.5 : 4.5, sd + 28));
  // the bevel (underside rim) of uneven width: wider on one lip, wandering along both
  const bevSide = R() < 0.5 ? 1 : -1;
  const rimOf = (i, side) => {
    const w = wAt(i); if ( w < 0.9 ) return 1; if ( mat === "metal" ) return 2;
    const b = w < 2.5 ? 1 : 2;
    return Math.max(1, b + (vnoise(i / 5, side * 3 + 0.5, sd + 32) > 0.55 ? 1 : 0) - (vnoise(i / 11, side * 3 + 1.5, sd + 33) < 0.3 ? 1 : 0) + (side === bevSide && w >= 2.5 && h2(i >> 3, side, sd + 34) < 0.4 ? 1 : 0));
  };
  // which lip is the north one (its outward normal points up the screen): its broken face is the far wall, it shadows the gap
  const northSide = (i) => (NY[i] < 0 ? 1 : -1);

  /* ---------------------------------------------------------------- 3. every pixel near the spine: arc length, signed distance */
  const best = new Float32Array(N).fill(Infinity), near = new Int32Array(N).fill(-1);
  // PERF: only the stroke's own pixels need their nearest spine point (everything the tear draws lies on them; any other pixel ends
  // with near = -1 below), so each row is scanned only over its own pixels' span
  const rowLo = new Int32Array(H).fill(W), rowHi = new Int32Array(H).fill(-1);
  for ( const o of X.px ) { const x = o % W, y = (o - x) / W; if ( x < rowLo[y] ) rowLo[y] = x; if ( x > rowHi[y] ) rowHi[y] = x; }
  for ( let i = 0; i < NS; i++ ) {
    const rad = Math.ceil(Math.max(eL[i], eR[i]) + zOf(i) * 1.7 + 4);
    const cx = SX[i], cy = SY[i], r2 = rad * rad, xa = Math.max(0, Math.floor(cx - rad)), xb = Math.min(W - 1, Math.ceil(cx + rad));
    for ( let y = Math.max(0, Math.floor(cy - rad)); y <= Math.min(H - 1, Math.ceil(cy + rad)); y++ ) {
      // (PERF: only the row's span inside the disk, one pixel of margin; the exact test below decides as before)
      const dy = y + 0.5 - cy, dy2 = dy * dy; if ( dy2 > r2 ) continue;
      const half = Math.sqrt(r2 - dy2), x0 = Math.max(xa, rowLo[y], Math.floor(cx - 0.5 - half) - 1), x1 = Math.min(xb, rowHi[y], Math.ceil(cx - 0.5 + half) + 1), row = y * W;
      for ( let x = x0; x <= x1; x++ ) {
        const o = row + x; if ( !own[o] ) continue;
        const dx = x + 0.5 - cx, d2 = dx * dx + dy2;
        if ( d2 > r2 ) continue;
        if ( d2 < best[o] ) { best[o] = d2; near[o] = i; }
      }
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
    // the lip's edge is dithered below the pixel (a per-pixel offset plus a short wavelength along the tear), so a diagonal edge
    // never steps in a uniform staircase; a hairline keeps most of its pixels
    const dz = clamp(edge / 1.5, 0.25, 1);
    const jit = (jag ? (h2(x >> 1, y >> 1, sd + 7) - 0.5) * 0.8 * jag : 0) + ((h2(x, y, sd + 8) - 0.5) * 0.5 + (vnoise(s / 2.3, side * 4 + 0.5, sd + 9) - 0.5) * 0.8) * dz;
    // the opening never reaches past the stroke's own pixels (a tear changes only what it was painted on)
    // (and it keeps a rounded inset from the stroke's border: a bulge never runs along the brush mask in a straight edge)
    if ( edge > 0.05 && Math.abs(d) < edge + jit && own[o] && (!X.din || edge < 1.5 || X.din[o] > 1 + h2(x, y, sd + 10) * 1.2) ) openA[o] = 1;
  }

  /* ---------------------------------------------------------------- 4. the lips: pulled apart, sheared, an underside rim, cut into flaps */
  const shearSign = R() < 0.5 ? 1 : -1;
  // the lips are cut into FLAPS of varying length (mostly 3-10 px, some 10-18, a few 19-27); each has a fate: it settles back flat,
  // it stays CURLED (its torn edge folded back over itself, the underside up) or it tears OFF and drops into the gap
  const SETTLE = 0, CURL = 1, OFF = 2;
  const cutLen = () => { const u = R(); return u < 0.55 ? 3 + R() * 7 : u < 0.87 ? 10 + R() * 8 : 19 + R() * 8; };
  const cuts = [[], []], segB = [[], []];
  for ( const k of [0, 1] ) {
    let s = -R() * 5;
    while ( s < L + 30 ) { cuts[k].push(s); s += cutLen(); }
    for ( let j = 0; j < cuts[k].length; j++ ) {
      const s0 = cuts[k][j], s1 = cuts[k][j + 1] ?? s0 + 8, len = s1 - s0, w = wAt(at((s0 + s1) / 2)), u = R();
      let b = SETTLE;
      if ( w >= 1.7 && len >= 4 && u < 0.17 ) b = CURL;
      else if ( mat !== "metal" && w >= 2.6 && len <= 13 && u > 0.86 ) b = OFF;
      segB[k].push({ b, len, tone: 0.93 + 0.14 * R(), fold: clamp(0.8 + w * 0.2 + R() * 0.9, 1, 2.6), lift: 0.6 + R() * 2.6, off: clamp(1.6 + R() * 2, 1.5, Math.max(1.5, w * 0.8)) });
    }
  }
  // (the last cut at or before s, else the first: a binary search, PERF)
  const segOf = (k, s) => { const c = cuts[k]; let lo = 0, hi = c.length - 1; while ( lo < hi ) { const m = (lo + hi + 1) >> 1; if ( c[m] <= s ) lo = m; else hi = m - 1; } return lo; };
  const pieceW = wMax >= 1.4;
  const segAcc = new Map(), FOLD = 1 << 20, DROP = 1 << 21;
  const fcol = new Uint8ClampedArray(N * 4), flay = new Int32Array(N);   // curled-back folds, drawn over their lips
  const ucol = new Uint8ClampedArray(N * 3), uflag = new Uint8Array(N);  // what lies under a flap that tore off (the base shows it)
  const acc = (lay, o, ox, oy, edge, s, d, i, seg, side) => {
    const a = segAcc.get(lay) ?? segAcc.set(lay, { n: 0, ox: 0, oy: 0, e: 0, s: 0, d: 0, i: 0, seg, side }).get(lay);
    a.n++; a.ox += ox; a.oy += oy; a.e += edge; a.s += s; a.d += d; a.i += i;
  };
  for ( let o = 0; o < N; o++ ) {
    const i = near[o]; if ( i < 0 || openA[o] ) continue;
    const x = o % W, y = (o - x) / W, d = dA[o], s = sA[o], side = d >= 0 ? 1 : -1, ad = Math.abs(d);
    const edge = side > 0 ? eL[i] : eR[i], e = ad - edge, Z = zS(i, side), rim = rimOf(i, side);
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
    const flat = c;
    if ( e < rim ) c = rimColour(c, e, i, side, x, y);
    if ( !(pieceW && wAt(i) >= 1.1) ) { put(o, c, BASE); continue; }
    const k = side > 0 ? 0 : 1, sn = s + (vnoise(e / 2.5, s / 7, sd + 41) - 0.5) * 5, j = segOf(k, sn), seg = segB[k][j];
    let lay = 2 + k * 4096 + j;
    // each flap its own tilt (a step lighter or darker), and a dark seam where two flaps parted, from the gap outwards
    c = mul(c, seg.tone);
    // (short: a nick of 1-3 px at the torn edge, never a stick across the lip)
    const seamL = Math.min(Z * 0.6, 1 + 2 * h2(j, k, sd + 42));
    if ( e < seamL && Math.min(sn - cuts[k][j], (cuts[k][j + 1] ?? Infinity) - sn) < 0.55 ) c = mix(c, ink, 0.45 * (1 - e / seamL) + 0.1);
    if ( seg.b === CURL ) {
      const f = seg.fold;
      if ( e < f ) {
        // where the flap curled off: the soil under it, in the curl's shade (part of the opening now)
        put(o, mix(mix(pal.strata[0], rp[1], 0.4), ink, 0.2 + 0.25 * clamp(1 - e / f, 0, 1)), BASE);
        continue;
      }
      put(o, c, lay);
      acc(lay, o, ox, oy, edge, s, d, i, seg, side);
      if ( e < 2 * f + 0.3 ) {
        // the flap folded back over its own lip, underside up: a crease at the hinge, the rolled crest catching the light
        let u = undersideColour(flat, x, y, i, side);
        if ( e < f + 1 ) u = mul(u, 0.8); else if ( e > 2 * f - 0.8 ) u = mul(u, 1.18);
        const q = o * 4; fcol[q] = u[0]; fcol[q + 1] = u[1]; fcol[q + 2] = u[2]; fcol[q + 3] = 255; flay[o] = lay + FOLD;
        acc(lay + FOLD, o, ox, oy, edge, s, d, i, seg, side);
      } else if ( e < 2 * f + 1.3 ) put(o, mix(c, ink, 0.4), lay);   // the roll's shadow on the lip
      continue;
    }
    if ( seg.b === OFF && e < seg.off ) {
      // this strip of the lip tears off; where it was, the torn face (the base shows it once the strip has gone)
      lay += DROP;
      const t = mix(rimColour(flat, 0.2, i, side, x, y), rp[1], 0.45);
      ucol[o * 3] = t[0]; ucol[o * 3 + 1] = t[1]; ucol[o * 3 + 2] = t[2]; uflag[o] = 1;
    }
    put(o, c, lay);
    acc(lay, o, ox, oy, edge, s, d, i, seg, side);
  }
  /** The underside showing at the torn edge, by material. e: px out from the edge (0 = at the gap). */
  function rimColour(c, e, i, side, x, y) {
    const north = side === northSide(i), inner = e < 1;
    let r;
    switch ( mat ) {
      case "grass": r = inner ? mix(pal.strata[0], rp[1], 0.3) : mix(c, pal.strata[0], 0.38); if ( !inner && h2(x, y, sd + 51) < 0.3 ) r = mul(c, 1.18); break;
      case "stone": r = add(mul(mix(c, grey(c), 0.4), inner ? 1.13 : 1.05), 2, 2, 3); break;   // fresh stone, a step lighter (not a white rim)
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
  /** A curled flap's underside (turned up): soil and pale roots under turf, fresh stone, pale wood, bright metal, pale fibre. */
  function undersideColour(c, x, y, i, side) {
    switch ( mat ) {
      case "grass": return h2(x, y, sd + 55) < 0.22 ? mix(pal.strata[0], [196, 176, 128], 0.45) : mix(pal.strata[0], rp[2], 0.35);
      case "stone": return add(mul(mix(c, grey(c), 0.5), 1.12), 3, 3, 4);
      case "wood":  return add(mul(c, 1.3), 20, 12, 2);
      case "metal": return mix(mul(c, 1.5), [236, 240, 245], 0.45);
      case "sand":  return mul(c, 0.86);
      case "snow":  return mix(c, [176, 196, 222], 0.3);
      default:      return add(mul(mix(c, grey(c), 0.5), 1.18), 10, 8, 4);
    }
  }

  /* ---------------------------------------------------------------- 5. the opening: wall, floor, shadow, material, rubble */
  const beams = [];
  if ( (mat === "wood" || mat === "metal") && wMax >= 2.5 ) {
    const nb = mat === "metal" ? 1 : 1 + (R() < 0.45 ? 1 : 0), grainX = !!C.cls.grainX;
    let x0 = Infinity, x1 = -Infinity; for ( let i = 0; i < NS; i++ ) { const q = grainX ? SY[i] : SX[i]; x0 = Math.min(x0, q); x1 = Math.max(x1, q); }
    for ( let k = 0; k < nb; k++ ) { let q = 0; for ( let t = 0; t < 4; t++ ) { q = lerp(x0, x1, 0.2 + 0.6 * R()); if ( beams.every((b) => Math.abs(b.q - q) > 9) ) break; } beams.push({ q, grainX: !grainX, w: mat === "metal" ? 1.2 : 1.6 }); }
  }
  const deepOf = (i) => clamp((lv[i] - 1) / 2, 0, 1);
  for ( let o = 0; o < N; o++ ) {
    if ( !openA[o] ) continue;
    const x = o % W, y = (o - x) / W, i = at(sA[o]), d = dA[o], w = wAt(i), deep = deepOf(i);
    if ( w < 0.9 ) { put(o, mix(mapAt(x, y), ink, 0.86), BASE); continue; }   // a hairline rip: one dark pixel
    // the far wall: the north lip's broken face, seen face-on by the oblique camera
    // (its height wanders from column to column: never even bands along the rip)
    const wallH = clamp(Math.round(w * 0.55 + deep + (vnoise(x / 3.5, 0.5, sd + 59) - 0.5) * 1.6), 1, 4);
    let wall = 0;
    for ( let k = 1; k <= wallH; k++ ) { const q = o - k * W; if ( q < 0 || !openA[q] ) { wall = k; break; } }
    if ( wall ) {
      // (the top row is the lip's own torn edge in shade: on turf the soil, never a row of dark green)
      const above = mapAt(x, y - wall), top = mat === "grass" ? mix(mul(above, 0.55), pal.strata[0], 0.65) : mul(above, 0.55);
      // the strata dithered into each other (a ragged seam, not a ruled line)
      const band = wall + (bayer(x, y) - 0.5) * 0.9 + (h2(x, y, sd + 58) - 0.5) * 0.5;
      put(o, band < 1.5 ? top : band < 2.5 ? pal.strata[0] : ((x + y) & 1 ? pal.strata[1] : mul(pal.strata[1], 0.86)), BASE);
      continue;
    }
    const toL = eL[i] - d, toR = eR[i] + d, m = Math.min(toL, toR), dn = clamp(m / Math.max(0.8, w), 0, 1);
    const toNorth = northSide(i) > 0 ? toL : toR;
    let v = 2.7 - dn * (1.4 + 1.8 * deep) + (h2(x, y, sd + 61) - 0.5) * 0.7 + (vnoise(x / 3, y / 3, sd + 62) - 0.5) * 0.7;
    if ( toNorth < Math.min(2.5, w * 0.6) ) v -= 1.1;              // the north lip's shadow
    else if ( toNorth > m + 0.5 && m < 1.2 ) v += 0.6;             // the south slope catches light
    let c = rp[clamp(Math.floor(v + (vnoise(x / 2.5, y / 2.5, sd + 60) - 0.5) * 0.9 + bayer(x, y) - 0.5), 0, 4)];
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
    // crumbs on the floor in the floor's own soil (never a speck of the surface's colour)
    if ( dn > 0.15 && dn < 0.85 && h2(x, y, sd + 68) < 0.045 * rubbleK * (0.5 + deep) ) c = rp[3 + (h2(x, y, sd + 69) < 0.4 ? 1 : 0)];
    put(o, c, BASE);
  }

  /* ---------------------------------------------------------------- 6. fibres and strands across the gap */
  // a few stay whole and sag (baked in the base); most SNAP during the entry: each half is its own piece, anchored at its lip, held
  // taut across the gap until it snaps and flicks back to hang (tear-entry.mjs)
  const fibreK = { grass: 1.2, wood: 0.8, stone: 0.25, metal: 0, sand: 0.5, snow: 0.5 }[mat] ?? 1;
  const fibCol = new Uint8ClampedArray(N * 4), fibLay = new Int32Array(N), fibs = [];
  if ( wMax >= 1.6 && fibreK > 0 ) {
    const n = Math.round(L / 24 * (0.5 + R()) * fibreK), placed = [];
    for ( let k = 0; k < n; k++ ) {
      let s = -1;
      for ( let t = 0; t < 4; t++ ) { const q = L * (0.1 + 0.8 * R()); if ( placed.every((p) => Math.abs(p - q) > 4) ) { s = q; break; } }
      if ( s < 0 ) continue;
      const i0 = at(s), w = wAt(i0); if ( w < 1.5 ) continue;
      placed.push(s);
      const i1 = at(s + (R() < 0.5 ? -1 : 1) * Math.max((0.8 + R()) * w, 0.9 * (eL[i0] + eR[i0])));   // always slanted, never a comb of upright ticks
      const a = [SX[i0] + NX[i0] * (eL[i0] + 0.2), SY[i0] + NY[i0] * (eL[i0] + 0.2)], b = [SX[i1] - NX[i1] * (eR[i1] + 0.2), SY[i1] - NY[i1] * (eR[i1] + 0.2)];
      const fc = fibreColour(a), whole = R() < 0.22, span = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // a strand runs slanted (never a straight stick across the gap) and is no longer than a hand's breadth of the gap
      const along = Math.abs((b[0] - a[0]) * TX[i0] + (b[1] - a[1]) * TY[i0]), across = Math.abs((b[0] - a[0]) * NX[i0] + (b[1] - a[1]) * NY[i0]);
      if ( along < 0.6 * across ) continue;
      if ( whole ) { fibre(a, b, 0, 1, fc, Math.min(2, span * 0.15), 0); continue; }
      const tb = Math.min(0.3 + 0.4 * R(), 9 / span), keepB = Math.min(0.6 + 0.4 * R(), 9 / Math.max(1, span * (1 - tb))), snapAt = R();
      for ( const [p, q, t1] of [[a, b, tb], [b, a, (1 - tb) * keepB]] ) {
        const id = fibs.length + 1;
        if ( fibre(p, q, 0, t1, fc, 1 + R(), id) ) fibs.push({ id, root: p, reach: span / Math.max(1, span * t1), snapAt });
        else fibs.push(null);
      }
    }
  }
  function fibreColour(p) {
    // in the gap's shade: never brighter than the lip it hangs from; turf hangs ROOTS (pale earthy), never green specks
    const c = mapAt(p[0], p[1]);
    if ( mat === "grass" ) return R() < 0.5 ? mix(pal.strata[0], [150, 128, 94], 0.3) : mix(pal.strata[0], rp[2], 0.3);
    if ( mat === "wood" ) return mix(add(mul(c, 1.2), 12, 6, 0), rp[2], 0.3);
    return mix(mul(mix(c, grey(c), 0.5), 1.05), rp[2], 0.35);
  }
  /** A fibre from a to b, drawn from t0 to t1 of the way, its free end drooping by `droop` art px (the middle, for a whole one). */
  function fibre(a, b, t0, t1, c, droop, id) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.ceil(len * (t1 - t0) * 1.5)), whole = t1 >= 1;
    let drawn = 0;
    for ( let k = 0; k <= n; k++ ) {
      const t = t0 + (t1 - t0) * k / n, f = k / n;
      const sag = whole ? Math.sin(Math.PI * t) * droop : f * f * droop;
      const x = Math.round(a[0] + (b[0] - a[0]) * t - 0.5), y = Math.round(a[1] + (b[1] - a[1]) * t + sag - 0.5);
      if ( x < 0 || y < 0 || x >= W || y >= H ) continue;
      const o = y * W + x; if ( !openA[o] ) continue;
      if ( id ) {   // a snapping half: its own piece; the tip thins out (a paler, frayed last pixel)
        const q = o * 4, cc = f > 0.8 ? mix(c, rp[1], 0.35) : c;
        fibCol[q] = cc[0]; fibCol[q + 1] = cc[1]; fibCol[q + 2] = cc[2]; fibCol[q + 3] = 255; fibLay[o] = id; drawn++;
        continue;
      }
      put(o, c, BASE); drawn++;
      const q = o + W; if ( y + 1 < H && openA[q] && layer[q] === BASE ) blend(q, rp[0], 0.45);
    }
    return drawn >= 2;
  }

  /* ---------------------------------------------------------------- 7. secondary rips near the tips, hairlines past the tips */
  const marked = new Uint8Array(N), crackList = [];
  const crackPx = (x, y, strong) => {
    x = Math.round(x); y = Math.round(y);
    if ( x < 2 || y < 2 || x >= W - 2 || y >= H - 2 ) return false;
    const o = y * W + x; if ( openA[o] || marked[o] ) return true;
    // never a straight stick of ink: a pixel that would make a straight run (row, column, diagonal) longer than 9 is left out
    for ( const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]] ) {
      let n = 1;
      for ( const sg of [-1, 1] ) for ( let m = 1; m < 10; m++ ) { const X0 = x + sg * dx * m, Y0 = y + sg * dy * m; if ( X0 < 0 || Y0 < 0 || X0 >= W || Y0 >= H || !marked[Y0 * W + X0] ) break; n++; }
      if ( n > 9 ) return true;
    }
    marked[o] = 1; crackList.push(o);
    const base = layer[o] ? [col[o * 4], col[o * 4 + 1], col[o * 4 + 2]] : mapAt(x, y);
    put(o, mix(base, ink, strong ? 0.88 : 0.62), layer[o] || BASE);
    const q = o - W;
    if ( !openA[q] && !marked[q] && h2(x, y, sd + 81) < 0.5 ) { const b2 = layer[q] ? [col[q * 4], col[q * 4 + 1], col[q * 4 + 2]] : mapAt(x, y - 1); put(q, mul(b2, 1.14), layer[q] || BASE); }
    return true;
  };
  // a rip CURVES as it runs (its own steady bend, plus wander), thins to a faint scratch, and splits at its end in a short fork
  let walkN = 0;
  const walk = (x, y, ang, len, w0, depth) => {
    const wn = ++walkN, hk = h2(wn, depth, sd + 86), kap = (hk < 0.5 ? -1 : 1) * (0.035 + 0.06 * Math.abs(hk - 0.5) * 2);
    let px = Math.round(x), py = Math.round(y), same = 0, lsx = 0, lsy = 0;
    for ( let k = 0; k < len; k++ ) {
      ang += kap + (vnoise(k / 4, wn * 3 + 0.5, sd + 83) - 0.5) * 0.45 + (R() - 0.5) * 0.3;
      x += Math.cos(ang); y += Math.sin(ang);
      // never a straight stick: the same pixel step six times over bends it
      const qx = Math.round(x), qy = Math.round(y), sx = qx - px, sy = qy - py;
      if ( sx || sy ) { same = sx === lsx && sy === lsy ? same + 1 : 0; lsx = sx; lsy = sy; px = qx; py = qy; if ( same >= 5 ) { ang += Math.sign(kap) * 0.35; same = 0; } }
      const w = w0 * (1 - k / len);
      // dark at the root, fading to a faint scratch at its end
      if ( !crackPx(x, y, depth < 3 && (k < len * 0.5 || (depth === 0 && h2(k, 3, sd + 85) < 0.3))) ) return;
      if ( w > 0.75 && h2(k, wn, sd + 87) < 0.6 ) crackPx(x - Math.sin(ang) * (h2(k, depth, sd + 84) < 0.5 ? 1 : -1), y + Math.cos(ang), false);
      if ( depth < 2 && k > len * 0.3 && k < len * 0.8 && R() < 0.05 ) walk(x, y, ang + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.4), (len - k) * 0.45, w * 0.6, depth + 1);
    }
    if ( depth < 3 && len >= 4 && R() < 0.65 ) for ( const sgn of [-1, 1] ) if ( sgn > 0 || R() < 0.8 ) walk(x, y, ang + sgn * (0.55 + 0.4 * R()), 2 + R() * 3, 0.4, 3);
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
    const i = end ? L : 0, tx = end ? TX[i] : -TX[i], ty = end ? TY[i] : -TY[i];
    if ( fork && end !== bluntEnd && lvMax > 1.4 ) {
      // the needle end forks: two thin rips splay from it
      const i0 = at(end ? L * 0.94 : L * 0.06), ang = Math.atan2(end ? TY[i0] : -TY[i0], end ? TX[i0] : -TX[i0]), len = clamp(4 + 0.06 * L, 4, 12);
      for ( const sgn of [-1, 1] ) walk(SX[i0] - 0.5, SY[i0] - 0.5, ang + sgn * (0.3 + 0.25 * R()), len * (0.7 + 0.5 * R()), 1.1, 1);
    } else walk(SX[i] - 0.5, SY[i] - 0.5, Math.atan2(ty, tx), (end === bluntEnd ? 2 : 3) + R() * 6, 0.6, 2);   // the rip runs on a little past its tip
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
  // runs, the tear is exactly the plain one. A few treatments are the tear's own (on top of the kit, here): fire burns in irregular,
  // broken, branching veins (not the kit's even web of iso-lines), frost grows 60-degree crystals with a soft rime (no white spikes,
  // no dark outline), acid eats a pitted, bubbling edge and its pools are mottled (not flat paint)
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
    let glowHook = null;
    const kglow = (x, y, c, a = 255) => {
      if ( glowHook ) { const r = glowHook(x, y, c, a); if ( !r ) return; [c, a] = r; }
      kput(x, y, c);
      if ( !glowA || x < 0 || y < 0 || x >= W || y >= H ) return;
      const q = y * W + x; if ( a <= glowA[q] ) return;
      glowA[q] = a; glowC[q * 3] = c[0]; glowC[q * 3 + 1] = c[1]; glowC[q * 3 + 2] = c[2];
    };
    // distance from the opening (the halo's and the lip's measure)
    // PERF: measured only over the opening's box grown by 20 px (every use below asks for d < 14 at most; outside it stays 1e6)
    const dO = new Float32Array(N).fill(1e6);
    {
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for ( let o = 0; o < N; o++ ) if ( openA[o] ) { const x = o % W, y = (o - x) / W; if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x; if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y; }
      if ( x1 >= 0 ) {
        x0 = Math.max(0, x0 - 20); y0 = Math.max(0, y0 - 20); x1 = Math.min(W - 1, x1 + 20); y1 = Math.min(H - 1, y1 + 20);
        const w = x1 - x0 + 1, h = y1 - y0 + 1, sub = new Float32Array(w * h);
        for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) sub[y * w + x] = openA[(y + y0) * W + x + x0] ? 0 : 1e6;
        X.chamfer(sub, w, h);
        for ( let y = 0; y < h; y++ ) dO.set(sub.subarray(y * w, (y + 1) * w), (y + y0) * W + x0);
      }
    }
    const mi = at(L / 2), haloR = cz.halo ? Math.min(14, (3 + maxD * cz.halo.r) * clamp(P.halo ?? 0.6, 0.15, 1) * (0.35 + lvMax / 3)) : 0;
    const kit = X.causeKit({ cz, pal, seed: sd, W, H, mapAt: cur, put: kput, glow: kglow, isIn: (x, y) => x >= 0 && y >= 0 && x < W && y < H && openA[y * W + x] === 1,
      inside: openA, din: X.din ?? dO, maxD, E0: { x: SX[mi], y: SY[mi] }, Rr: Math.max(3, wMax * 1.6), C: { cx: C.cx, cy: C.cy, axis: C.axis, maxD }, haloR });
    const fire = cz.fill === "char", frost = cz.fill === "ice", acid = cz.fill === "acid";
    // the floor
    const openList = [];
    for ( let o = 0; o < N; o++ ) {
      if ( !openA[o] ) continue;
      openList.push(o);
      const i = at(sA[o]), w = wAt(i); if ( w < 0.9 ) continue;
      const x = o % W, y = (o - x) / W, d = dA[o], m = Math.min(eL[i] - d, eR[i] + d), dn = clamp(m / Math.max(0.8, w), 0, 1);
      const toNorth = northSide(i) > 0 ? eL[i] - d : eR[i] + d, lit = toNorth < Math.min(2.5, w * 0.6) ? -0.6 : 0.3;
      const depth = Math.pow(dn, 0.75) * (0.35 + 0.65 * deepOf(i)), under = cur(o);
      if ( frost ) {
        // frozen floor: a soft icy wash in patches, a rare glint (the kit's facet lines read as ruled lines in a long slit)
        const n = vnoise(x / 3, y / 3, sd + 701);
        put(o, depth < 0.2 ? mix(under, pal.accHi, 0.15) : h2(x, y, sd + 702) < 0.02 ? pal.accHi : mix(under, n > 0.55 ? pal.accHi : pal.acc, 0.25 + 0.2 * n), layer[o] || BASE);
        continue;
      }
      if ( fire ) {   // charred floor without the kit's iso-line veins (the tear draws its own below)
        glowHook = () => null;
        let c = kit.fill(x, y, under, depth, dn, lit);
        glowHook = null;
        if ( !c ) c = kit.fill(x, y, under, Math.min(depth, 0.29), dn, lit);
        if ( c ) put(o, c, layer[o] || BASE);
        continue;
      }
      if ( acid ) {   // the pools mottled with the floor under them and with bubbles, never a flat coat
        glowHook = (gx, gy, c, a) => { const n2 = vnoise(gx / 1.7, gy / 1.7, sd + 711), hb = h2(gx, gy, sd + 712); return [hb < 0.04 ? pal.accHi : n2 < 0.32 ? mix(c, pal.accLo, 0.55) : n2 > 0.72 ? mix(c, pal.accHi, 0.3) : mix(c, under, 0.25), a]; };
        const c = kit.fill(x, y, under, depth, dn, lit);
        glowHook = null;
        if ( c ) put(o, c, layer[o] || BASE);
        continue;
      }
      const c = kit.fill(x, y, under, depth, dn, lit);
      if ( c ) put(o, c, layer[o] || BASE);
    }
    // the halo round the opening (on the lips and, softly, the ground just past them), then the torn lip itself
    if ( haloR > 0.5 ) for ( let o = 0; o < N; o++ ) { const d = dO[o]; if ( d >= 1.5 && d < haloR ) kit.halo(o % W, (o - (o % W)) / W, o, d); }
    for ( let o = 0; o < N; o++ ) {
      if ( openA[o] || !layer[o] || dO[o] > 1.01 ) continue;
      const x = o % W, y = (o - x) / W, i = near[o] >= 0 ? near[o] : at(L / 2);
      if ( frost ) {   // a soft rime on the lip, a rare bright crystal - never an inked outline
        const hv = h2(x, y, sd + 721), m = cur(o);
        put(o, hv < 0.06 ? pal.accHi : mix(m, pal.accHi, 0.18 + 0.2 * vnoise(x / 2.5, y / 2.5, sd + 722)), layer[o]);
        continue;
      }
      kit.lip(x, y, o, 1 + 2 * deepOf(i));
      if ( acid ) {   // an eaten edge: pits bitten into the lip, a bead of acid now and then
        const hv = h2(x, y, sd + 731);
        if ( hv < 0.2 ) put(o, mix(pal.ink, pal.accLo, 0.3), layer[o]);
        else if ( hv > 0.93 ) kglow(x, y, pal.accHi, 150);
        const q = o - W; if ( hv < 0.08 && q >= 0 && !openA[q] && layer[q] && dO[q] <= 2.01 ) put(q, mix(cur(q), pal.ink, 0.6), layer[q]);
      }
    }
    if ( frost ) frostLines(); else kit.crackLines([crackList]);
    if ( fire ) fireVeins();
    if ( cz.fx ) kit.fx(openList, frost ? (o) => h2(o, 5, sd + 770) < 0.7 : null);   // (frost: few glints, a long slit of them read as stickers)
    /** The tear's hairlines in frost: a soft rime line, and 60-degree crystals branching off it and off the lips. */
    function frostLines() {
      const rime = (x, y, k) => { if ( x < 1 || y < 1 || x >= W - 1 || y >= H - 1 ) return; const o = y * W + x; put(o, mix(cur(o), pal.accHi, k), layer[o] || BASE); };
      crackList.forEach((o, k) => rime(o % W, (o - (o % W)) / W, 0.45 + 0.15 * h2(k, 1, sd + 741)));
      const seeds = [];
      for ( let k = 0; k < crackList.length; k += 5 + Math.floor(h2(k, 2, sd + 742) * 6) ) seeds.push(crackList[k]);
      for ( let o = 0; o < N; o++ ) if ( !openA[o] && layer[o] && dO[o] <= 1.01 && h2(o, 3, sd + 743) < 0.05 ) seeds.push(o);
      seeds.forEach((o, n) => {
        const x0 = o % W, y0 = (o - x0) / W, a0 = Math.floor(h2(n, 4, sd + 744) * 6) * Math.PI / 3 + (h2(n, 5, sd + 745) - 0.5) * 0.2;
        const len = 2 + Math.floor(h2(n, 6, sd + 746) * 4);
        for ( let k = 1; k <= len; k++ ) {
          const x = Math.round(x0 + Math.cos(a0) * k), y = Math.round(y0 + Math.sin(a0) * k);
          rime(x, y, k === len && h2(n, k, sd + 747) < 0.4 ? 0.85 : 0.5 - 0.06 * k);
          if ( k === 2 || (k === 3 && len > 4) ) for ( const sg of [-1, 1] ) {   // the side branches at 60 degrees, short and soft
            const a = a0 + sg * Math.PI / 3;
            rime(Math.round(x + Math.cos(a)), Math.round(y + Math.sin(a)), 0.32);
            if ( len > 3 && h2(n, k + sg, sd + 748) < 0.5 ) rime(Math.round(x + 2 * Math.cos(a)), Math.round(y + 2 * Math.sin(a)), 0.22);
          }
        }
      });
    }
    /** Fire in a tear: a few veins of embers in the burnt floor, irregular, broken into dashes, branching. */
    function fireVeins() {
      const vein = (x, y, ang, len, depth) => {
        let on = true;
        for ( let k = 0; k < len; k++ ) {
          ang += (vnoise(k / 3, depth * 7 + x * 0.1, sd + 751) - 0.5) * 0.9;
          x += Math.cos(ang); y += Math.sin(ang);
          const X0 = Math.round(x), Y0 = Math.round(y); if ( X0 < 0 || Y0 < 0 || X0 >= W || Y0 >= H ) return;
          const o = Y0 * W + X0; if ( !openA[o] ) return;
          if ( h2(k, depth + Math.round(ang * 10), sd + 752) < 0.22 ) on = !on;   // broken: runs and gaps of uneven length
          if ( on ) kglow(X0, Y0, pal.ember[h2(X0, Y0, sd + 753) < 0.3 ? 1 : 0], 200 + Math.round(35 * h2(X0, Y0, sd + 754)));
          if ( depth < 2 && h2(k, depth, sd + 755 + Math.round(x)) < 0.08 ) vein(x, y, ang + (h2(k, 9, sd + 756) < 0.5 ? -1 : 1) * (0.6 + 0.5 * h2(k, 8, sd + 757)), (len - k) * 0.5, depth + 1);
        }
      };
      const n = Math.max(1, Math.round(L / 20 * (0.5 + 0.8 * h2(1, 2, sd + 758))));
      for ( let k = 0; k < n; k++ ) {
        const s = L * (0.1 + 0.8 * h2(k, 1, sd + 759)), i = at(s); if ( wAt(i) < 2 || deepOf(i) < 0.3 ) continue;
        const off = (cAt(i) * 0.5) * wAt(i);
        vein(SX[i] + NX[i] * off - 0.5, SY[i] + NY[i] * off - 0.5, Math.atan2(TY[i], TX[i]) + (h2(k, 3, sd + 760) - 0.5) * 1.2 + (h2(k, 4, sd + 761) < 0.5 ? Math.PI : 0), 4 + h2(k, 5, sd + 762) * 10, 0);
      }
    }
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

  /* ---------------------------------------------------------------- 8c. over older damage (substrate.mjs) */
  // The map this tear reads (`map`, mapAt) is already the SUBSTRATE inside its own pixels: the lips, the pulled band, the chips, flaps
  // and fibres are cut from the older damage under it (a pit's slabs, a crater's rim, charred ground, cracks pulled apart). Here the
  // opening's floor goes deeper than the floor it was torn into, and over water the rip only darkens the water (the lips are left
  // to the older look: water does not tear). What the tear does not draw stays the older look, live (core.mjs shrinks the cover).
  if ( C.sub ) {
    const S = C.sub;
    for ( const o of X.px ) {
      if ( !S.kind[o] ) continue;
      if ( S.yields(o, X.type) ) {
        if ( !openA[o] || !layer[o] ) { layer[o] = 0; flay[o] = 0; uflag[o] = 0; continue; }
        const c = S.fx(o, [col[o * 4], col[o * 4 + 1], col[o * 4 + 2]], X.type, C.clean);
        if ( !c ) { layer[o] = 0; fibLay[o] = 0; continue; }
        col[o * 4] = c[0]; col[o * 4 + 1] = c[1]; col[o * 4 + 2] = c[2]; col[o * 4 + 3] = c.a ?? 255; layer[o] = BASE;
        continue;
      }
      if ( !openA[o] || layer[o] !== BASE ) continue;
      const c = S.fx(o, [col[o * 4], col[o * 4 + 1], col[o * 4 + 2]], X.type, C.clean);
      if ( c ) { col[o * 4] = c[0]; col[o * 4 + 1] = c[1]; col[o * 4 + 2] = c[2]; }
    }
  }

  /* ---------------------------------------------------------------- 9. sprites */
  const items = [];
  const row = () => new Int16Array(MF);
  // PERF: every piece's box from ONE pass over each label array (a crop per piece scanned the whole window: pieces x window)
  const boxesOf = (lab) => {
    const m = new Map();
    for ( let o = 0; o < N; o++ ) {
      const v = lab[o]; if ( !v ) continue;
      const x = o % W, y = (o - x) / W, b = m.get(v);
      if ( !b ) m.set(v, [x, y, x, y]);
      else { if ( x < b[0] ) b[0] = x; if ( x > b[2] ) b[2] = x; if ( y < b[1] ) b[1] = y; if ( y > b[3] ) b[3] = y; }
    }
    return m;
  };
  const crop = (pred, src = col, under = null, box = undefined) => {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    if ( box === undefined ) { for ( let o = 0; o < N; o++ ) if ( pred(o) ) { const x = o % W, y = (o - x) / W; if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x; if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y; } }
    else if ( box ) [x0, y0, x1, y1] = box;
    if ( x1 < 0 ) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, data = new Uint8ClampedArray(w * h * 4);
    for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
      const o = (y + y0) * W + x + x0; if ( !pred(o) ) continue;
      const q = (y * w + x) * 4;
      if ( under && under(o) ) { data[q] = ucol[o * 3]; data[q + 1] = ucol[o * 3 + 1]; data[q + 2] = ucol[o * 3 + 2]; data[q + 3] = 255; }
      else data.set(src.subarray(o * 4, o * 4 + 4), q);
    }
    return { x: x0, y: y0, w, h, data };
  };
  const sp = at(L * (0.3 + 0.4 * R()));   // the puncture: where the rip starts (when it does not follow the stroke)
  // the base: the opening, the plain lip band, and the torn face under every flap that tears off
  const underOff = (o) => uflag[o] === 1 && layer[o] >= DROP;
  let base = crop((o) => layer[o] === BASE || underOff(o), col, underOff);
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
    // only the pixels the tear really lays (its opening, lips, chips at full opacity): elsewhere in its stroke it lays no ground, so
    // whatever lies there (older damage) stays visible, and a lower level painted later is not cut off there (the severity rule)
    for ( const i of X.px ) { if ( !layer[i] || col[i * 4 + 3] < 255 ) continue; const x = i % W - cx0, y = (i - (i % W)) / W - cy0, q = (y * cw + x) * 4; cov[q] = cov[q + 1] = cov[q + 2] = cov[q + 3] = 255; }
    const mc = row(); mc[0] = 2; mc[3] = cw; mc[4] = ch; mc[5] = RX + cx0; mc[6] = RY + cy0;
    items.push({ img: { w: cw, h: ch, data: cov, x: cx0, y: cy0 }, m: mc });
    // the cause's light (kind 3), as core's areas
    if ( light ) { const ml = row(); ml[0] = 3; ml[3] = light.w; ml[4] = light.h; ml[5] = RX + light.x; ml[6] = RY + light.y; ml[7] = X.cause ?? 0; items.push({ img: light, m: ml }); }
  }
  let bytes = base.data.length + (light?.data.length ?? 0), pieces = 0;
  // Pieces, each with its part in the entry (field 14: 0 a lip flap that settles, 2 a curled fold, 3 a strip that tore off, 4 a
  // snapping fibre; 15/16 a vector x16 art px; 17 a parameter) and where it lay before the rip opened (7/8: the closed lips).
  // Drawn in this order: what lies in the gap (dropped strips, fibres), the lips (lower ones later), the folds over their lips.
  const stagger = (s) => Math.round(Math.min(8000, Math.abs(s - sp) * 4));
  const groups = [[], [], []], layBox = boxesOf(layer), foldBox = boxesOf(flay), fibBox = boxesOf(fibLay);
  for ( const [lay, a] of segAcc ) {
    if ( a.n < 2 ) continue;
    const fold = lay >= FOLD && lay < DROP, drop = lay >= DROP;
    const img = fold ? crop((o) => flay[o] === lay, fcol, null, foldBox.get(lay) ?? null) : crop((o) => layer[o] === lay, col, null, layBox.get(lay) ?? null);
    if ( !img ) continue;
    const k = a.e / a.n, l = Math.hypot(a.ox, a.oy) || 1, ux = a.ox / l, uy = a.oy / l, im = at(a.i / a.n);
    const m = row();
    m[0] = 1; m[3] = img.w; m[4] = img.h; m[5] = RX + img.x; m[6] = RY + img.y;
    m[7] = RX + img.x - Math.round(ux * k); m[8] = RY + img.y - Math.round(uy * k);   // closed: shifted back onto the spine
    m[10] = stagger(a.s / a.n); m[11] = 4; m[13] = X.type;
    if ( fold ) {
      // the fold flips over from the hinge (the gap edge): its rest lies `fold` px outwards of it
      m[7] = m[5]; m[8] = m[6]; m[14] = 2; m[15] = Math.round(-ux * a.seg.fold * 16); m[16] = Math.round(-uy * a.seg.fold * 16);
      groups[2].push({ img, m });
    } else if ( drop ) {
      // torn off: it comes to rest on the gap's floor, on the gap's middle line, a pixel lower (it fell), in the gap's shade
      const dc = (eL[im] - eR[im]) / 2 - a.d / a.n;
      const sx = Math.round(NX[im] * dc), sy = Math.round(NY[im] * dc) + 1;
      for ( let q = 0; q < img.data.length; q += 4 ) if ( img.data[q + 3] ) { const c = mul([img.data[q], img.data[q + 1], img.data[q + 2]], 0.7); img.data[q] = c[0]; img.data[q + 1] = c[1]; img.data[q + 2] = c[2]; }
      m[5] += sx; m[6] += sy; m[14] = 3; m[15] = Math.round(-sx * 16); m[16] = Math.round(-sy * 16);
      groups[0].push({ img, m });
    } else {
      m[14] = 0; m[17] = Math.round(a.seg.lift * 10) | (a.seg.b === CURL ? 1024 : 0);
      groups[1].push({ img, m });
    }
  }
  for ( const f of fibs ) {
    if ( !f ) continue;
    const img = crop((o) => fibLay[o] === f.id, fibCol, null, fibBox.get(f.id) ?? null); if ( !img ) continue;
    const m = row(), cx = img.x + img.w / 2, cy = img.y + img.h / 2;
    m[0] = 1; m[3] = img.w; m[4] = img.h; m[5] = RX + img.x; m[6] = RY + img.y; m[7] = m[5]; m[8] = m[6];
    m[10] = stagger(0); m[11] = 4; m[13] = X.type;
    m[14] = 4; m[15] = Math.round((f.root[0] - cx) * 16); m[16] = Math.round((f.root[1] - cy) * 16); m[17] = Math.round(clamp(f.reach, 1, 3) * 100) + Math.round(f.snapAt * 9) * 1000;
    groups[0].push({ img, m });
  }
  for ( const g of groups ) {
    g.sort((p, q) => (p.img.y + p.img.h) - (q.img.y + q.img.h));
    for ( const it of g ) { items.push(it); bytes += it.img.data.length; pieces++; }
  }
  stats.shards += pieces;
  const DBG = globalThis.__MM_TEAR_DEBUG;
  if ( Array.isArray(DBG) ) DBG.push({ W, H, RX, RY, L, eL, eR, open: openA, col, layer, crack: crackList.slice(), mat, bluntEnd, fork,
    segs: [...segAcc.values()].filter((a) => a.n >= 2).map((a) => ({ len: a.seg.len, b: a.seg.b, n: a.n })), fibres: fibs.filter(Boolean).length,
    kinds: groups.flat().map((it) => it.m[14]), fibreBoxes: groups[0].filter((it) => it.m[14] === 4).map((it) => [it.img.w, it.img.h]) });
  return { items, stats, bytes };
}
