// node dev/tear.test.mjs [core.mjs]: the tear (damage type "gash").
//   1. determinism: the same input bakes to the same bytes
//   2. independence: a tear stroke bakes to the same sprites alone, with other strokes (touching and overlapping its window), in any
//      painting order, torn borders on and off
//   3. no grid / net: the dark opening mask of long straight tears has no periodic structure (its 2D autocorrelation falls off along
//      every ray from the origin and never rises again to a second peak)
//   4. shape: an elongated opening, widest well inside, at least one pointed end; width grows with the level
//   5. asymmetry: the width profile is no mirror of itself, one tip blunt and one thin, the gap's middle wanders off the spine, pinches
//   6. hairlines curve: no straight run of ink longer than 10 px (row, column or diagonal)
//   7. flaps: the lips cut into flaps of varied length (3-10 px mostly, some 18+), some curl, some tear off, fibres snap as pieces
//   8. the lip edge along a diagonal never steps in a uniform staircase (run lengths vary, no dominant period)
//   9. nothing grass green inside a tear in turf (the gap shows soil and roots)
const corePath = process.env.CORE ?? new URL("../scripts/destruction/core.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const core = await import(new URL("file:///" + corePath.replace(/\\/g, "/")).href);
const F = core.META_FIELDS, K = 2;
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if ( !cond ) fails++; };

const h2 = (x, y, s) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
function makeMap(kind, W, H) {
  const d = new Uint8ClampedArray(W * H * 4);
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
    const o = (y * W + x) * 4, n = h2(x, y, 3) - 0.5, n2 = h2(x >> 3, y >> 3, 9) - 0.5;
    let c;
    if ( kind === "stone" ) { const row = (y / 10) | 0, mortar = (x + (row % 2) * 6) % 12 === 0 || y % 10 === 0; c = mortar ? [70, 68, 66] : [128 + n * 18, 124 + n * 18, 118 + n * 18]; }
    else if ( kind === "wood" ) { const plank = (x / 7) | 0; c = x % 7 === 0 ? [60, 38, 22] : [150 + h2(plank, 1, 4) * 26 + n * 10, 100 + n * 8, 58 + n * 6]; }
    else c = [74 + n * 26 + n2 * 30, 122 + n * 30 + n2 * 40, 52 + n * 16];
    d.set([c[0], c[1], c[2], 255], o);
  }
  return d;
}
function stroke(id, type, level, path, r, mw, mh) {
  const buf = new Uint8Array(mw * mh); let x0 = mw, y0 = mh, x1 = -1, y1 = -1;
  for ( let k = 0; k < path.length - 1; k++ ) {
    const [ax, ay] = path[k], [bx, by] = path[k + 1], L = Math.hypot(bx - ax, by - ay) || 1;
    for ( let s = 0; s <= L; s++ ) {
      const cx = (ax + (bx - ax) * s / L) / K, cy = (ay + (by - ay) * s / L) / K;
      for ( let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++ ) for ( let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++ ) {
        if ( x < 0 || y < 0 || x >= mw || y >= mh || (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r ) continue;
        buf[y * mw + x] = level; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, bytes = new Uint8Array(w * h);
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) bytes[y * w + x] = buf[(y0 + y) * mw + x0 + x];
  return { id, k: 0, t: type, x0, y0, w, h, bytes, path };
}
const P0 = { debris: 0.7, scatter: 1, lift: 1, rubble: 0.6, halo: 0.6, edge: 0.7, material: "auto", jagged: false, jag: 0.6, directional: false };
const bake = (objects, map, W, H, params = P0, seed = 7) => core.bake({ objects, K, aw: W, ah: H, seed, params, map: { w: W, h: H, data: map }, mapKey: "m" }, null);
/** Per stroke object: the bytes and placement of its sprites (base, cover, pieces). */
function signatures(r) {
  const out = new Map(); let cur = null;
  for ( let k = 0; k < r.count; k++ ) {
    const o = k * F, m = r.meta; let h = 2166136261;
    for ( let y = 0; y < m[o + 4]; y++ ) for ( let x = 0; x < m[o + 3]; x++ ) { const q = ((m[o + 2] + y) * r.sheet.w + m[o + 1] + x) * 4; for ( let c = 0; c < 4; c++ ) h = Math.imul(h ^ r.sheet.data[q + c], 16777619); }
    const sig = [m[o], ...m.slice(o + 3, o + 11), h >>> 0].join(",");   // (field 11 of a piece holds the sheet's area index)
    if ( m[o] === 0 ) { cur = (m[o + 12] & 0xffff) | ((m[o + 13] & 0xffff) << 16); out.set(cur, [sig]); } else out.get(cur).push(sig);
  }
  return new Map([...out].map(([k, v]) => [k, v.join("|")]));
}
/** The base sprites composited onto a blank canvas: 1 where the tear's opening is dark. */
function darkMask(r, W, H) {
  const M = new Uint8Array(W * H);
  for ( let k = 0; k < r.count; k++ ) {
    const o = k * F, m = r.meta; if ( m[o] !== 0 ) continue;
    for ( let y = 0; y < m[o + 4]; y++ ) for ( let x = 0; x < m[o + 3]; x++ ) {
      const q = ((m[o + 2] + y) * r.sheet.w + m[o + 1] + x) * 4, d = r.sheet.data;
      const X = m[o + 5] + x, Y = m[o + 6] + y; if ( X < 0 || Y < 0 || X >= W || Y >= H || !d[q + 3] ) continue;
      if ( 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2] < 55 ) M[Y * W + X] = 1;
    }
  }
  return M;
}
/** The largest second rise of the normalised autocorrelation along any ray from the origin (a grid / net / parallel lines: high). */
function periodicRise(M, W, H) {
  let n = 0, mean = 0; for ( const v of M ) mean += v; mean /= M.length;
  const R = 44, S = 2 * R + 1, A = new Float64Array(S * S);
  let x0 = W, y0 = H, x1 = 0, y1 = 0; for ( let i = 0; i < M.length; i++ ) if ( M[i] ) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); n++; }
  if ( !n ) return { rise: 0, n };
  for ( let dy = -R; dy <= R; dy++ ) for ( let dx = -R; dx <= R; dx++ ) {
    let s = 0;
    for ( let y = Math.max(y0, y0 - dy); y <= Math.min(y1, y1 - dy); y++ ) for ( let x = Math.max(x0, x0 - dx); x <= Math.min(x1, x1 - dx); x++ ) s += (M[y * W + x] - mean) * (M[(y + dy) * W + x + dx] - mean);
    A[(dy + R) * S + dx + R] = s;
  }
  const a0 = A[R * S + R];
  let rise = 0;
  for ( let k = 0; k < 72; k++ ) {
    const an = k / 72 * Math.PI * 2, c = Math.cos(an), s = Math.sin(an);
    let lo = 1;
    for ( let r = 1; r <= R; r += 0.5 ) {
      const fx = r * c + R, fy = r * s + R, ix = Math.floor(fx), iy = Math.floor(fy); if ( ix + 1 >= S || iy + 1 >= S ) break;
      const u = fx - ix, v = fy - iy, val = (A[iy * S + ix] * (1 - u) * (1 - v) + A[iy * S + ix + 1] * u * (1 - v) + A[(iy + 1) * S + ix] * (1 - u) * v + A[(iy + 1) * S + ix + 1] * u * v) / a0;
      lo = Math.min(lo, val); rise = Math.max(rise, val - lo);
    }
  }
  return { rise, n };
}

/* 1. determinism */
{
  const W = 240, H = 140, map = makeMap("grass", W, H), mw = W / K, mh = H / K;
  const ob = stroke("a1", 5, 3, [[30, 70], [90, 50], [150, 80], [210, 64]], 7, mw, mh);
  const a = bake([ob], map, W, H), b = bake([ob], map, W, H);
  ok(a.sheet.data.length === b.sheet.data.length && a.sheet.data.every((v, i) => v === b.sheet.data[i]), "determinism: identical bytes on a second bake");
  const c = bake([{ ...ob, id: "a2" }], map, W, H);
  ok(!(c.sheet.data.length === a.sheet.data.length && c.sheet.data.every((v, i) => v === a.sheet.data[i])), "another stroke id gives another tear (seeded per stroke)");
  ok(a.stats.shards > 3, `the lips are cut into pieces (${a.stats.shards})`);
}

/* 2. independence */
{
  const W = 400, H = 260, map = makeMap("stone", W, H), mw = W / K, mh = H / K;
  const T1 = stroke("t1", 5, 3, [[40, 60], [120, 70], [200, 56]], 7, mw, mh);
  const T2 = stroke("t2", 5, 2, [[60, 150], [140, 190], [230, 170]], 5, mw, mh);
  const B = stroke("b1", 0, 3, [[205, 60], [215, 64]], 14, mw, mh);       // a blast touching T1's end
  const C = stroke("c1", 4, 2, [[100, 165], [160, 175]], 9, mw, mh);      // cracks over T2
  for ( const jagged of [false, true] ) {
    const params = { ...P0, jagged, jag: 0.8 };
    const alone = new Map();
    for ( const o of [T1, T2, B, C] ) for ( const [h, s] of signatures(bake([o], map, W, H, params)) ) alone.set(h, s);
    // one-way (substrate.mjs): a stroke never changes because of a NEWER one - its areas in the whole bake are exactly those of a bake
    // of it and the strokes before it; the first stroke (nothing under it) is exactly as alone
    for ( const order of [[T1, T2, B, C], [C, B, T2, T1], [B, T1, C, T2]] ) {
      const all = signatures(bake(order, map, W, H, params));
      let same = 0, n = 0;
      for ( let k = 0; k < order.length; k++ ) {
        const pre = signatures(bake(order.slice(0, k + 1), map, W, H, params));
        for ( const [h, s] of pre ) { n++; if ( all.get(h) === s ) same++; }
      }
      const first = signatures(bake([order[0]], map, W, H, params));
      const firstAlone = [...first].every(([h, s]) => alone.get(h) === s);
      ok(same === n && firstAlone, `one-way independence torn=${jagged} order ${order.map((o) => o.id).join(",")}: ${same}/${n} areas of every prefix unchanged by newer strokes, the first as alone`);
    }
  }
}

/* 3. no grid / net (and the old look for contrast, when a second core is given) */
{
  const W = 320, H = 120, mw = W / K, mh = H / K, rises = [];
  for ( const [kind, level, r, seed] of [["grass", 3, 8, 3], ["stone", 3, 8, 11], ["wood", 2, 6, 5], ["grass", 2, 6, 19], ["stone", 2, 7, 23]] ) {
    const map = makeMap(kind, W, H);
    const ob = stroke(`n${seed}`, 5, level, [[30, 60], [290, 60]], r, mw, mh);
    const res = bake([ob], map, W, H, P0, seed);
    const { rise, n } = periodicRise(darkMask(res, W, H), W, H);
    rises.push(rise);
    ok(rise < 0.15 && n > 50, `no periodic structure: ${kind} level ${level}: autocorrelation second rise ${rise.toFixed(3)} (dark px ${n})`);
  }
  console.log(`     max second rise ${Math.max(...rises).toFixed(3)} (the old claw-groove look measured 0.17 - 0.38 here: a grid of grooves and cross cuts)`);
}

/* 4. shape: lens, pointed ends, width by level */
{
  const W = 320, H = 120, mw = W / K, mh = H / K, map = makeMap("grass", W, H), widths = [];
  for ( const level of [1, 2, 3] ) {
    const ob = stroke(`w${level}`, 5, level, [[30, 60], [290, 60]], 7, mw, mh);
    const M = darkMask(bake([ob], map, W, H), W, H);
    const cols = []; for ( let x = 0; x < W; x++ ) { let c = 0; for ( let y = 0; y < H; y++ ) c += M[y * W + x]; cols.push(c); }
    const on = cols.map((c, x) => [c, x]).filter(([c]) => c > 0), xa = on[0]?.[1] ?? 0, xb = on[on.length - 1]?.[1] ?? 0;
    const max = Math.max(...cols), at = cols.indexOf(max), span = xb - xa;
    const tip = (x0, x1) => { let m = 0; for ( let x = x0; x <= x1; x++ ) m = Math.max(m, cols[x] ?? 0); return m; };
    const sorted = cols.slice(xa, xb + 1).sort((p, q) => p - q); widths.push(sorted[Math.floor(sorted.length * 0.9)]);
    ok(span > 180, `level ${level}: the rip runs along the stroke (${span} px of ${260})`);
    if ( level > 1 ) {
      ok(at > xa + span * 0.12 && at < xb - span * 0.12, `level ${level}: widest inside (at ${((at - xa) / span).toFixed(2)} of its length, ${max} px)`);
      // (one end may be blunt: a short round end, never as wide as the middle)
      const ta = tip(xa, xa + 6), tb = tip(xb - 6, xb);
      ok(Math.min(ta, tb) <= Math.max(2, max * 0.3) && Math.max(ta, tb) <= max * 0.8, `level ${level}: one tip pointed, the other no wider than 80 % (${ta} / ${tb} px vs ${max})`);
    }
  }
  ok(widths[0] <= 3 && widths[0] < widths[1] && widths[1] < widths[2], `width follows the level (90th percentile across): ${widths.join(" < ")} px`);
}

/* 5-9: from the bake's own record of each tear (globalThis.__MM_TEAR_DEBUG) */
const DBG = globalThis.__MM_TEAR_DEBUG = [];
const corr = (a, b) => { const n = a.length, ma = a.reduce((p, q) => p + q, 0) / n, mb = b.reduce((p, q) => p + q, 0) / n; let sab = 0, sa = 0, sb = 0; for ( let i = 0; i < n; i++ ) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return sab / Math.sqrt(sa * sb || 1); };
const std = (a) => { const m = a.reduce((p, q) => p + q, 0) / a.length; return Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / a.length); };
{
  const W = 320, H = 120, mw = W / K, mh = H / K, rec = [];
  for ( const [kind, seed] of [["grass", 3], ["stone", 11], ["wood", 5], ["grass", 19], ["stone", 23], ["earth", 31], ["grass", 41], ["wood", 53]] ) for ( const level of [2, 3] ) {
    DBG.length = 0;
    bake([stroke(`a${seed}${level}`, 5, level, [[30, 60], [290, 60]], 7, mw, mh)], makeMap(kind, W, H), W, H, P0, seed);
    const d = DBG.find((q) => q.L > 60); if ( d ) rec.push({ ...d, level, kind, seed });
  }
  let mirror = 0, tipsOk = 0, offOk = 0, pinchOk = 0, n3 = 0;
  for ( const d of rec ) {
    const w = Array.from(d.eL, (v, i) => v + d.eR[i]), n = w.length, rev = w.slice().reverse();
    if ( corr(w, rev) < 0.75 ) mirror++;
    const m = Math.max(3, Math.round(n * 0.12)), wa = w.slice(0, m).reduce((p, q) => p + q, 0) / m, wb = w.slice(n - m).reduce((p, q) => p + q, 0) / m;
    if ( Math.max(wa, wb) / Math.max(0.3, Math.min(wa, wb)) >= 1.5 ) tipsOk++;
    const c = []; for ( let i = 0; i < n; i++ ) if ( w[i] > 1.5 ) c.push((d.eL[i] - d.eR[i]) / w[i]);
    if ( c.length > 10 && std(c) >= 0.12 ) offOk++;
    if ( d.level === 3 ) {
      n3++;
      const sm = w.map((_, i) => { let s = 0, k = 0; for ( let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++ ) { s += w[j]; k++; } return s / k; });
      let pinches = 0;
      for ( let i = Math.round(n * 0.12); i < n * 0.88; i++ ) {
        if ( !(sm[i] <= sm[i - 1] && sm[i] <= sm[i + 1]) ) continue;
        let l = 0, r = 0; for ( let j = Math.max(0, i - 15); j < i; j++ ) l = Math.max(l, sm[j]); for ( let j = i + 1; j <= Math.min(n - 1, i + 15); j++ ) r = Math.max(r, sm[j]);
        if ( sm[i] < 0.65 * Math.min(l, r) ) { pinches++; i += 4; }
      }
      if ( pinches >= 1 ) pinchOk++;
    }
  }
  const N = rec.length;
  ok(N >= 14, `asymmetry: ${N} tears recorded`);
  ok(mirror === N, `asymmetry: no width profile mirrors itself (corr with its reverse < 0.75): ${mirror}/${N}`);
  ok(tipsOk >= N * 0.8, `asymmetry: one tip blunt, the other thin (end widths differ 1.5x or more): ${tipsOk}/${N}`);
  ok(offOk >= N * 0.8, `asymmetry: the gap's middle wanders off the spine (std of (eL - eR) / w >= 0.12): ${offOk}/${N}`);
  ok(pinchOk >= n3 * 0.75, `asymmetry: pinches along a gaping rip (a narrowing to < 65 % of both sides): ${pinchOk}/${n3}`);

  // 6. curved hairlines
  let worst = 0, where = "";
  for ( const d of rec ) {
    const M = new Uint8Array(d.W * d.H); for ( const o of d.crack ) M[o] = 1;
    const has = (X, Y) => X >= 0 && Y >= 0 && X < d.W && Y < d.H && M[Y * d.W + X] === 1;
    for ( const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]] ) for ( let o = 0; o < M.length; o++ ) {
      if ( !M[o] ) continue;
      const x = o % d.W, y = (o - x) / d.W; if ( has(x - dx, y - dy) ) continue;
      let k = 0, X = x, Y = y; while ( has(X, Y) ) { k++; X += dx; Y += dy; }
      if ( k > worst ) { worst = k; where = `${d.kind} L${d.level} s${d.seed}`; }
    }
  }
  ok(worst <= 10, `hairlines curve: longest straight run of ink ${worst} px (${where})`);

  // 7. flaps
  const segs = rec.flatMap((d) => d.segs), lens = segs.map((q) => q.len), kinds = rec.flatMap((d) => d.kinds);
  const short = lens.filter((l) => l <= 10).length / lens.length, mean = lens.reduce((p, q) => p + q, 0) / lens.length;
  ok(segs.length >= rec.length * 8, `flaps: ${segs.length} flaps in ${rec.length} tears`);
  ok(short >= 0.4 && Math.max(...lens) >= 18 && Math.min(...lens) <= 4, `flaps: lengths ${Math.min(...lens).toFixed(1)}-${Math.max(...lens).toFixed(1)} px, ${(short * 100).toFixed(0)} % up to 10 px`);
  ok(std(lens) / mean >= 0.4, `flaps: varied lengths (cv ${(std(lens) / mean).toFixed(2)})`);
  const cnt = (k) => kinds.filter((q) => q === k).length;
  ok(cnt(2) >= rec.length / 2 && cnt(3) >= 3 && cnt(4) >= rec.length, `flaps: ${cnt(2)} curled folds, ${cnt(3)} strips torn off, ${cnt(4)} snapping fibre halves, ${cnt(0)} flaps settling`);

  // 9. no green in a turf gap
  let green = 0, tot = 0;
  for ( const d of rec ) if ( d.kind === "grass" ) for ( let o = 0; o < d.open.length; o++ ) {
    if ( !d.open[o] || !d.layer[o] ) continue;
    const r = d.col[o * 4], g = d.col[o * 4 + 1], b = d.col[o * 4 + 2]; tot++;
    if ( g > r + 15 && g > b + 15 && g > 60 ) green++;
  }
  ok(tot > 500 && green / tot < 0.005, `no green specks in a turf gap: ${green} of ${tot} gap pixels green`);
}
/* 8. dithered diagonal edges */
{
  const W = 300, H = 300, mw = W / K, mh = H / K;
  let okN = 0, n = 0; const notes = [];
  for ( const [seed, dir] of [[2, [[40, 60], [260, 190]]], [8, [[40, 250], [260, 120]]], [14, [[30, 80], [270, 220]]], [21, [[50, 230], [250, 70]]]] ) {
    DBG.length = 0;
    bake([stroke(`d${seed}`, 5, 3, dir, 7, mw, mh)], makeMap("stone", W, H), W, H, P0, seed);
    const d = DBG.find((q) => q.L > 60); if ( !d ) continue;
    // the top boundary of the opening per column, over the middle half of its run
    const top = [];
    for ( let x = 0; x < d.W; x++ ) { let y0 = -1; for ( let y = 0; y < d.H; y++ ) if ( d.open[y * d.W + x] ) { y0 = y; break; } top.push(y0); }
    const xs = top.map((y, x) => [y, x]).filter(([y]) => y >= 0), x0 = xs[Math.round(xs.length * 0.25)][1], x1 = xs[Math.round(xs.length * 0.75)][1];
    const runs = []; let r = 1;
    for ( let x = x0 + 1; x <= x1; x++ ) { if ( top[x] === top[x - 1] ) r++; else { runs.push(r); r = 1; } }
    const diffs = []; for ( let x = x0 + 1; x <= x1; x++ ) diffs.push(top[x] - top[x - 1]);
    let peak = 0; for ( let lag = 2; lag <= 12; lag++ ) peak = Math.max(peak, corr(diffs.slice(lag), diffs.slice(0, -lag)));
    const cv = std(runs) / (runs.reduce((p, q) => p + q, 0) / runs.length);
    n++; if ( cv >= 0.35 && peak < 0.5 ) okN++;
    notes.push(`cv ${cv.toFixed(2)} peak ${peak.toFixed(2)}`);
  }
  ok(n >= 3 && okN === n, `diagonal lip edges never step uniformly (run-length cv >= 0.35, no period at lag 2-12 above 0.5): ${notes.join("; ")}`);
}

console.log(fails ? `FAILED ${fails}` : "PASS");
process.exit(fails ? 1 : 0);
