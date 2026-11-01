// Collapse ('zapadnięcie'), checks of the bake outside Foundry.   node dev/collapse.test.mjs [-v]
//  1. the pit is not a disc: for taps of level 2 and 3 on stone, grass and planks (several seeds) the outline (the cover: the
//     stroke's own pixels) has a circularity P^2 / (4 pi A) >= 1.2 (marching-squares perimeter) and a radial CV >= 0.1;
//  2. lit slab faces: among the rim slabs that moved, some face the light (brighter than the map they were cut from) and some face away;
//  3. no long straight ink: outside the pit (its lip, its hairlines) no straight run of inked pixels (composite much darker than the
//     map) of 12 px or more, along rows, columns or diagonals;
//  4. the levels: level 1 has at most a small hole, level 3 has a deep void; a followed stroke at max settings is a TRENCH (one part, along the
//     whole path, its width pinching and bulging);
//  5. determinism: the same bytes twice; a stroke bakes the same alone and next to another one (per-stroke independence).
import { createHash } from "node:crypto";
const core = await import(new URL("../scripts/destruction/core.mjs", import.meta.url).href);
const F = core.META_FIELDS, K = 2, CW = 170, CH = 120;
const verbose = process.argv.includes("-v");
let failed = 0;
const check = (ok, msg) => { if ( !ok || verbose ) console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const h2 = (x, y, s) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

function makeMap(kind, W, H, ox) {
  const d = new Uint8ClampedArray(W * H * 4);
  for ( let Y = 0; Y < H; Y++ ) for ( let X = 0; X < W; X++ ) {
    const x = X + ox, y = Y, o = (Y * W + X) * 4, n = h2(x, y, 3) - 0.5;
    let c;
    if ( kind === "grass" ) c = [74 + n * 26, 122 + n * 30, 52 + n * 16];
    else if ( kind === "stone" ) {
      const row = (y / 10) | 0, bx = (x + (row % 2) * 6) % 12, mortar = bx === 0 || y % 10 === 0, t = h2(((x + (row % 2) * 6) / 12) | 0, row, 5) * 30;
      c = mortar ? [70, 68, 66] : [124 + t + n * 18, 120 + t + n * 18, 114 + t + n * 18];
    } else { const plank = (x / 7) | 0, t = h2(plank, 1, 4) * 26; c = x % 7 === 0 ? [60, 38, 22] : [150 + t + n * 10, 100 + t * 0.7 + n * 8, 58 + t * 0.4]; }
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  return d;
}
/** A stroke object: brush discs (radius r mask px) along a path (art px), at one level. */
function stroke(id, level, path, r, extra = {}) {
  const mw = CW / K, mh = CH / K, buf = new Uint8Array(mw * mh);
  let x0 = mw, y0 = mh, x1 = -1, y1 = -1;
  const P = path.length === 1 ? [path[0], path[0]] : path;
  for ( let k = 0; k < P.length - 1; k++ ) {
    const [ax, ay] = P[k], [bx, by] = P[k + 1], L = Math.hypot(bx - ax, by - ay);
    for ( let s = 0; s <= L; s += 1 ) {
      const cx = (ax + (bx - ax) * s / (L || 1)) / K, cy = (ay + (by - ay) * s / (L || 1)) / K;
      for ( let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++ ) for ( let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++ ) {
        if ( x < 0 || y < 0 || x >= mw || y >= mh || (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r ) continue;
        buf[y * mw + x] = level; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      if ( !L ) break;
    }
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, bytes = new Uint8Array(w * h);
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) bytes[y * w + x] = buf[(y0 + y) * mw + x0 + x];
  return { id, k: 0, t: 1, x0, y0, w, h, bytes, path: path.length > 1 ? path.map(([x, y]) => [x, y]) : null, ...extra };
}
const DEF = { debris: 0.7, scatter: 1, lift: 1, rubble: 0.6, halo: 0.6, edge: 0.7, material: "auto", jagged: false, jag: 0.6, directional: false };
const MAX = { debris: 1, scatter: 2, lift: 1.6, rubble: 1, halo: 1, edge: 1, material: "auto", jagged: true, jag: 1, directional: true };
const bake = (objects, map, kind, params = DEF, seed = 77) => core.bake({ objects, K, aw: CW, ah: CH, seed, params, map: { w: CW, h: CH, data: map }, mapKey: kind }, new Map());
const rows = (res) => { const m = core.readMeta(res.sheet.data, res.sheet.w, res.sheet.h, res.metaRows), out = []; for ( let k = 0; k < m.length / F; k++ ) out.push(m.subarray(k * F, k * F + F)); return out; };
const lum = (d, o) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];

/** The cover (own pixels) as a full-size 0/1 mask. */
function coverOf(res) {
  const own = new Uint8Array(CW * CH);
  for ( const r of rows(res) ) if ( r[0] === 2 ) for ( let y = 0; y < r[4]; y++ ) for ( let x = 0; x < r[3]; x++ ) {
    if ( res.sheet.data[((r[2] + y) * res.sheet.w + r[1] + x) * 4 + 3] ) { const X = r[5] + x, Y = r[6] + y; if ( X >= 0 && Y >= 0 && X < CW && Y < CH ) own[Y * CW + X] = 1; }
  }
  return own;
}
/** The final look (map, base, pieces). */
function composite(res, map) {
  const c = new Uint8ClampedArray(map);
  for ( const kind of [0, 1] ) for ( const r of rows(res) ) if ( r[0] === kind ) for ( let y = 0; y < r[4]; y++ ) for ( let x = 0; x < r[3]; x++ ) {
    const X = r[5] + x, Y = r[6] + y; if ( X < 0 || Y < 0 || X >= CW || Y >= CH ) continue;
    const s = ((r[2] + y) * res.sheet.w + r[1] + x) * 4, a = res.sheet.data[s + 3] / 255; if ( !a ) continue;
    const o = (Y * CW + X) * 4; for ( let k = 0; k < 3; k++ ) c[o + k] = c[o + k] * (1 - a) + res.sheet.data[s + k] * a;
  }
  return c;
}
/** Circularity P^2 / (4 pi A) with a marching-squares perimeter, and the CV of the radius by angle. */
function shape(own) {
  let A = 0, sx = 0, sy = 0, P = 0;
  for ( let i = 0; i < own.length; i++ ) if ( own[i] ) { A++; sx += i % CW; sy += Math.floor(i / CW); }
  const at = (x, y) => (x < 0 || y < 0 || x >= CW || y >= CH ? 0 : own[y * CW + x]);
  for ( let y = -1; y < CH; y++ ) for ( let x = -1; x < CW; x++ ) {
    const c = at(x, y) | (at(x + 1, y) << 1) | (at(x + 1, y + 1) << 2) | (at(x, y + 1) << 3);
    if ( c === 0 || c === 15 ) continue;
    const n = [0, 1, 1, 2, 1, 2, 2, 1, 1, 2, 2, 1, 2, 1, 1, 0][c];   // corners set
    if ( c === 5 || c === 10 ) P += 2 * Math.SQRT1_2; else if ( n === 1 || n === 3 ) P += Math.SQRT1_2; else P += 1;
  }
  const cx = sx / A + 0.5, cy = sy / A + 0.5, rs = [];
  for ( let k = 0; k < 90; k++ ) {
    const a = k / 90 * Math.PI * 2; let r = 0;
    for ( let d = 0; d < 200; d += 0.5 ) { const x = Math.floor(cx + Math.cos(a) * d), y = Math.floor(cy + Math.sin(a) * d); if ( at(x, y) ) r = d; else if ( d > r + 3 ) break; }
    rs.push(r);
  }
  const m = rs.reduce((s, v) => s + v, 0) / rs.length, sd = Math.sqrt(rs.reduce((s, v) => s + (v - m) ** 2, 0) / rs.length);
  return { circ: P * P / (4 * Math.PI * A), cv: sd / m, A };
}
const digest = (res) => createHash("sha1").update(Buffer.from(res.sheet.data.buffer)).update(Buffer.from(res.meta.buffer)).digest("hex");

/* ---------------------------------------------------------------- 1-3, 5: taps */
let minCirc = Infinity, minCV = Infinity, worstRun = 0, litPlates = 0, shadedPlates = 0, plates = 0, voidL1 = 0, voidL3 = [];
for ( const kind of ["stone", "grass", "wood"] ) for ( const level of [1, 2, 3] ) for ( let s = 0; s < 4; s++ ) {
  const map = makeMap(kind, CW, CH, s * 997), id = `t-${kind}-${level}-${s}`;
  const ob = stroke(id, level, [[85, 60]], 11 + s);
  const res = bake([ob], map, kind, DEF, 50 + s);
  const own = coverOf(res), comp = composite(res, map);
  if ( level >= 2 ) {
    const sh = shape(own);
    minCirc = Math.min(minCirc, sh.circ); minCV = Math.min(minCV, sh.cv);
    check(sh.circ >= 1.2 && sh.cv >= 0.1, `${id}: outline circularity ${sh.circ.toFixed(2)} (>= 1.2), radial CV ${sh.cv.toFixed(3)} (>= 0.1)`);
    // lit faces: a moved plate (not a chip) brighter / darker than the map where it came from
    for ( const r of rows(res) ) if ( r[0] === 1 && !(r[11] & 1) && (r[11] & 4) && r[12] >= -30 ) {   // (the rim slabs: sunk at most 3 px)
      // (the median of the pixels' ratios to the map where the plate came from: its top face, not its inked edges and dark side)
      const qs = [];
      for ( let y = 0; y < r[4]; y++ ) for ( let x = 0; x < r[3]; x++ ) {
        const s2 = ((r[2] + y) * res.sheet.w + r[1] + x) * 4; if ( !res.sheet.data[s2 + 3] ) continue;
        const X = r[7] + x, Y = r[8] + y; if ( X < 0 || Y < 0 || X >= CW || Y >= CH ) continue;
        qs.push(lum(res.sheet.data, s2) / Math.max(1, lum(map, (Y * CW + X) * 4)));
      }
      if ( qs.length < 8 ) continue;
      qs.sort((p, q) => p - q);
      plates++; const q = qs[qs.length >> 1]; if ( q > 1.04 ) litPlates++; else if ( q < 0.92 ) shadedPlates++; if ( process.env.QDBG ) console.log('q', kind, level, r[3], r[4], q.toFixed(2));
    }
  }
  // ink outside the pit: much darker than the map; straight runs along rows, columns and both diagonals
  const ink = new Uint8Array(CW * CH);
  for ( let i = 0; i < CW * CH; i++ ) if ( !own[i] && lum(comp, i * 4) < lum(map, i * 4) * 0.55 ) ink[i] = 1;
  for ( const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]] ) for ( let y = 0; y < CH; y++ ) for ( let x = 0; x < CW; x++ ) {
    if ( !ink[y * CW + x] ) continue;
    const px = x - dx, py = y - dy; if ( px >= 0 && py >= 0 && px < CW && py < CH && ink[py * CW + px] ) continue;   // not a run's start
    let n = 0, X = x, Y = y; while ( X >= 0 && Y >= 0 && X < CW && Y < CH && ink[Y * CW + X] ) { n++; X += dx; Y += dy; }
    if ( n > worstRun ) worstRun = n;
    if ( n >= 12 && verbose ) console.log(`ink run ${n} in ${id} at ${x},${y} dir ${dx},${dy}`);
  }
  if ( process.env.DUMP === id ) (await import("node:fs")).writeFileSync(process.env.DUMP_TO, comp);   // raw RGBA CW x CH, for a look
  if ( process.env.DUMPMASK === id ) for ( let y = 10; y < 110; y++ ) { let s = ""; for ( let x = 30; x < 140; x++ ) s += own[y * CW + x] ? "#" : (lum(comp, (y * CW + x) * 4) < lum(map, (y * CW + x) * 4) * 0.55 ? "x" : "."); console.log(y, s); }
  // the void: near-black pixels in the pit
  // (not on planks: the dark of a plank floor's cavity is near-black by its palette)
  let v = 0, n = 0; for ( let i = 0; i < CW * CH; i++ ) if ( own[i] ) { n++; if ( lum(comp, i * 4) < 22 ) v++; }
  if ( kind === "wood" ) v = level === 3 ? n : 0;
  if ( level === 1 ) voidL1 = Math.max(voidL1, v / n); else if ( level === 3 ) { voidL3.push(v / n); if ( verbose ) console.log("void", id, (v / n).toFixed(3)); }
  if ( s === 0 ) {
    check(digest(res) === digest(bake([ob], map, kind, DEF, 50 + s)), `${id}: the same bytes twice`);
    // independence: the stroke's own sprites are the same with a newer stroke painted beside it (older never reads newer)
    const other = stroke(`o-${id}`, 2, [[22, 22]], 6);
    const together = bake([ob, other], map, kind, DEF, 50 + s), alone = res;
    const sig = (r) => new Set(rows(r).filter((q) => q[0] === 0).map((q) => `${q[3]}x${q[4]}@${q[5]},${q[6]}:${q[12]},${q[13]}`));
    const both = sig(together);
    check([...sig(alone)].every((k) => both.has(k)), `${id}: bakes the same next to another stroke`);
  }
}
check(minCirc >= 1.2 && minCV >= 0.1, `taps: worst circularity ${minCirc.toFixed(2)}, worst radial CV ${minCV.toFixed(3)}`);
check(plates > 20 && litPlates >= plates * 0.15 && shadedPlates >= plates * 0.15, `lit slab faces: ${litPlates} lit, ${shadedPlates} shaded of ${plates} moved plates (each >= 15 %)`);
check(worstRun < 12, `no straight ink run of 12 px or more outside the pit (longest ${worstRun})`);
check(voidL1 < 0.06, `level 1 sags: at most a small hole in its middle (${(voidL1 * 100).toFixed(1)} % near-black, < 6 %)`);
check(Math.min(...voidL3) > 0.04, `level 3 caves in: a void in every pit (least ${(Math.min(...voidL3) * 100).toFixed(1)} % near-black)`);

/* ---------------------------------------------------------------- 4: the trench along a followed stroke */
for ( const kind of ["stone", "grass"] ) {
  const map = makeMap(kind, CW, CH, 5), path = [];
  for ( let i = 0; i <= 12; i++ ) { const t = i / 12; path.push([Math.round(24 + t * 122), Math.round(62 + Math.sin(t * 3.4 + 0.4) * 16 - t * 10)]); }
  const ob = stroke(`trench-${kind}`, 3, path, 7);
  const res = bake([ob], map, kind, MAX, 91), own = coverOf(res);
  // one part (one base row)
  const parts = rows(res).filter((r) => r[0] === 0).length;
  // its width across the path at every few px: half widths each side, measured from the path
  const widths = [];
  let plen = 0; for ( let k = 1; k < path.length; k++ ) plen += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
  for ( let k = 1; k < path.length; k++ ) {
    const [x0, y0] = path[k - 1], [x1, y1] = path[k], l = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / l, uy = (y1 - y0) / l;
    for ( let s = 0; s < l; s += 3 ) {
      const px = x0 + ux * s, py = y0 + uy * s; let w = 0;
      for ( const sg of [1, -1] ) { let last = -1; for ( let d = 0; d < 40; d += 0.5 ) { const X = Math.floor(px - uy * d * sg), Y = Math.floor(py + ux * d * sg); if ( X >= 0 && Y >= 0 && X < CW && Y < CH && own[Y * CW + X] ) last = d; else if ( d > last + 2 ) break; } w += Math.max(0, last); }
      widths.push(w);
    }
  }
  const inner = widths.slice(3, -3), m = inner.reduce((s, v) => s + v, 0) / inner.length, sd = Math.sqrt(inner.reduce((s, v) => s + (v - m) ** 2, 0) / inner.length);
  const covered = inner.filter((w) => w >= 3).length / inner.length;
  check(parts === 1 && covered >= 0.95, `trench on ${kind}: one continuous channel along the path (${parts} part(s), ${(covered * 100).toFixed(0)} % of it at least 3 px wide)`);
  check(sd / m >= 0.12 && Math.min(...inner) < m * 0.75 && Math.max(...inner) > m * 1.2, `trench on ${kind}: its width pinches and bulges (mean ${m.toFixed(1)}, CV ${(sd / m).toFixed(2)}, ${Math.min(...inner).toFixed(1)}..${Math.max(...inner).toFixed(1)})`);
  check(digest(res) === digest(bake([ob], map, kind, MAX, 91)), `trench on ${kind}: the same bytes twice`);
}

console.log(failed ? `${failed} collapse check(s) FAILED` : `collapse: outline (circ >= ${minCirc.toFixed(2)}, CV >= ${minCV.toFixed(3)}), lit faces ${litPlates}/${shadedPlates} of ${plates}, ink runs < 12 (${worstRun}), levels, trench, determinism - all ok`);
process.exit(failed ? 1 : 0);
