// node dev/destruction-footprint.test.mjs [--matrix]      (CORE=<path to another core.mjs> to measure an older core)
// THE FOOTPRINT RULE: a newer stroke B never clears an older stroke A next to it. For every ordered pair of kinds (A older, B newer),
// B overlapping A, touching it (inside B's halo reach) and far from it, with B's cause none / fire / decay:
//   1. A's sprites are the same bytes alone and with B (an older object never changes because of a newer one);
//   2. the display's composition (in creation order, as display.mjs lays it: the plain map under the newer object's own pixels, its
//      base, its pieces) outside B's own pixels (+1 px) never shows the PLAIN MAP where A alone showed damage: B may darken, stain,
//      ink or drop pieces onto A there, it never lays clean ground over it ("cleared" pixels; up to 2 colour coincidences allowed);
//   3. far apart, nothing of A changes at all.
// --matrix prints the cleared-pixel counts per pair (rows A, columns B).
const corePath = process.env.CORE ?? new URL("../scripts/destruction/core.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const core = await import(new URL("file:///" + corePath.replace(/\\/g, "/")).href);
const F = core.META_FIELDS, K = 2, AW = 260, AH = 180, MW = AW / K, MH = AH / K;
let fails = 0;
const ok = (cond, msg) => { if ( !cond || process.env.VERBOSE ) console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if ( !cond ) fails++; };
const h2 = (x, y, s) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const map = new Uint8ClampedArray(AW * AH * 4);
for ( let y = 0; y < AH; y++ ) for ( let x = 0; x < AW; x++ ) {
  const n = h2(x, y, 3) * 24 - 12, o = (y * AW + x) * 4, row = (y / 10) | 0, mortar = (x + (row % 2) * 6) % 12 === 0 || y % 10 === 0;
  const c = x < AW / 2 ? [74 + n, 122 + n * 1.2, 52 + n * 0.6] : mortar ? [70, 68, 66] : [128 + n, 124 + n, 118 + n];
  map.set([c[0], c[1], c[2], 255], o);
}
function disc(id, t, cx, cy, r, c = 0) {
  const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r)), x1 = Math.min(MW - 1, Math.ceil(cx + r)), y1 = Math.min(MH - 1, Math.ceil(cy + r));
  const w = x1 - x0 + 1, h = y1 - y0 + 1, bytes = new Uint8Array(w * h);
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) if ( (x0 + x + 0.5 - cx) ** 2 + (y0 + y + 0.5 - cy) ** 2 <= r * r ) bytes[y * w + x] = 3;
  // a tear needs a path: a short one through the disc
  const path = t === 5 ? [[(cx - r * 0.8) * K, cy * K], [cx * K, (cy - r * 0.2) * K], [(cx + r * 0.8) * K, cy * K]] : undefined;
  return { id, k: 0, t, c, x0, y0, w, h, bytes, path };
}
const P0 = { debris: 0.7, scatter: 1, lift: 1, rubble: 0.6, halo: 0.6, edge: 0.7, material: "auto", jagged: false, jag: 0.6, directional: false };
const bake = (objects) => core.bake({ objects, K, aw: AW, ah: AH, seed: 7, params: P0, map: { w: AW, h: AH, data: map }, mapKey: "fp" }, null);
/** Sprites per object index: [{ kind, sx, sy, w, h, x, y, hash }] and a byte signature of each object. */
function split(r) {
  const objs = new Map(); let cur = null;
  for ( let k = 0; k < r.count; k++ ) {
    const o = k * F, m = r.meta;
    const s = { kind: m[o], sx: m[o + 1], sy: m[o + 2], w: m[o + 3], h: m[o + 4], x: m[o + 5], y: m[o + 6] };
    let hh = 2166136261;
    for ( let y = 0; y < s.h; y++ ) for ( let x = 0; x < s.w; x++ ) { const q = ((s.sy + y) * r.sheet.w + s.sx + x) * 4; for ( let c = 0; c < 4; c++ ) hh = Math.imul(hh ^ r.sheet.data[q + c], 16777619); }
    s.sig = `${s.kind},${s.w},${s.h},${s.x},${s.y},${hh >>> 0}`;
    if ( s.kind === 0 ) { cur = { index: m[o + 16], sprites: [] }; objs.set(cur.index * 1e6 + k, cur); }
    cur.sprites.push(s);
  }
  // several parts of one stroke: merge by object index
  const byIndex = new Map();
  for ( const v of objs.values() ) { const e = byIndex.get(v.index) ?? byIndex.set(v.index, []).get(v.index); e.push(...v.sprites); }
  return byIndex;
}
/** The display's composition: the plain map, then every object in creation order (the plain map under its cover, base, pieces). */
function compose(r) {
  const out = new Float32Array(AW * AH * 3);
  for ( let i = 0; i < AW * AH; i++ ) for ( let c = 0; c < 3; c++ ) out[i * 3 + c] = map[i * 4 + c];
  const objs = split(r), d = r.sheet.data, SW = r.sheet.w;
  for ( const idx of [...objs.keys()].sort((a, b) => a - b) ) {
    const sp = objs.get(idx);
    for ( const s of sp ) if ( s.kind === 2 ) for ( let y = 0; y < s.h; y++ ) for ( let x = 0; x < s.w; x++ ) {
      const X = s.x + x, Y = s.y + y; if ( X < 0 || Y < 0 || X >= AW || Y >= AH || !d[((s.sy + y) * SW + s.sx + x) * 4 + 3] ) continue;
      const i = Y * AW + X; for ( let c = 0; c < 3; c++ ) out[i * 3 + c] = map[i * 4 + c];
    }
    for ( const kind of [0, 1] ) for ( const s of sp ) if ( s.kind === kind ) for ( let y = 0; y < s.h; y++ ) for ( let x = 0; x < s.w; x++ ) {
      const X = s.x + x, Y = s.y + y; if ( X < 0 || Y < 0 || X >= AW || Y >= AH ) continue;
      const q = ((s.sy + y) * SW + s.sx + x) * 4, a = d[q + 3] / 255; if ( !a ) continue;
      const i = Y * AW + X; for ( let c = 0; c < 3; c++ ) out[i * 3 + c] = out[i * 3 + c] * (1 - a) + d[q + c] * a;
    }
  }
  return out;
}
/** B's own pixels (art px), grown by `g`. */
function ownOf(ob, g) {
  const m = new Uint8Array(AW * AH);
  for ( let y = 0; y < ob.h; y++ ) for ( let x = 0; x < ob.w; x++ ) if ( ob.bytes[y * ob.w + x] ) for ( let dy = -g; dy < K + g; dy++ ) for ( let dx = -g; dx < K + g; dx++ ) {
    const X = (ob.x0 + x) * K + dx, Y = (ob.y0 + y) * K + dy; if ( X >= 0 && Y >= 0 && X < AW && Y < AH ) m[Y * AW + X] = 1;
  }
  return m;
}
const T = core.TYPES, CAUSES = [0, 1, 8];
const matrix = T.map(() => T.map(() => 0));
let pairs = 0, clean = 0;
for ( let a = 0; a < 6; a++ ) for ( let b = 0; b < 6; b++ ) for ( const c of CAUSES ) for ( const [cfg, dx] of [["overlap", 12], ["touch", 30], ["far", 80]] ) {
  const A = disc(`A${a}`, a, 50, 45, 11), B = disc(`B${b}${c}${cfg}`, b, 50 + dx, 45 + (b === 5 ? 3 : 0), b === 5 ? 9 : 11, c);
  const rA = bake([A]), rAB = bake([A, B]);
  const sigA = split(rA).get(0).map((s) => s.sig).join("|"), sigA2 = split(rAB).get(0)?.map((s) => s.sig).join("|");
  ok(sigA === sigA2, `${T[a]} <- ${T[b]} (cause ${c}, ${cfg}): the older object's bytes are unchanged`);
  // B's own pixels: its cover sprite (the stroke's pixels as baked, torn outline included), grown by 1 px
  const own = new Uint8Array(AW * AH);
  for ( const s of split(rAB).get(1) ?? [] ) if ( s.kind === 2 ) for ( let y = 0; y < s.h; y++ ) for ( let x = 0; x < s.w; x++ ) {
    if ( !rAB.sheet.data[((s.sy + y) * rAB.sheet.w + s.sx + x) * 4 + 3] ) continue;
    for ( let dy = -1; dy <= 1; dy++ ) for ( let dx = -1; dx <= 1; dx++ ) { const X = s.x + x + dx, Y = s.y + y + dy; if ( X >= 0 && Y >= 0 && X < AW && Y < AH ) own[Y * AW + X] = 1; }
  }
  const cA = compose(rA), cAB = compose(rAB);
  // B's pieces (plates, thrown chips) may land on A: debris on top, not the ground cleared; counted apart
  const onTop = new Uint8Array(AW * AH);
  for ( const s of split(rAB).get(1) ?? [] ) if ( s.kind === 1 ) for ( let y = 0; y < s.h; y++ ) for ( let x = 0; x < s.w; x++ ) {
    const X = s.x + x, Y = s.y + y; if ( X >= 0 && Y >= 0 && X < AW && Y < AH && rAB.sheet.data[((s.sy + y) * rAB.sheet.w + s.sx + x) * 4 + 3] ) onTop[Y * AW + X] = 1;
  }
  let cleared = 0, changedFar = 0;
  for ( let i = 0; i < AW * AH; i++ ) {
    if ( own[i] || onTop[i] ) continue;
    let dA = 0, dAB = 0, dd = 0;
    for ( let k = 0; k < 3; k++ ) { dA += Math.abs(cA[i * 3 + k] - map[i * 4 + k]); dAB += Math.abs(cAB[i * 3 + k] - map[i * 4 + k]); dd += Math.abs(cAB[i * 3 + k] - cA[i * 3 + k]); }
    if ( dA > 24 && dAB <= 6 ) cleared++;
    if ( dd > 3 && dA > 3 ) changedFar++;   // only where A shows
  }
  pairs++;
  if ( cleared <= 2 ) clean++;
  matrix[a][b] += cleared;
  // (a stain or moss pixel of the cause can happen to match the plain ground's colour: up to 2 such pixels are not a clearing)
  ok(cleared <= 2, `${T[a]} <- ${T[b]} (cause ${c}, ${cfg}): ${cleared} pixels of the older damage cleared outside the newer stroke's own pixels`);
  if ( cfg === "far" ) ok(changedFar === 0, `${T[a]} <- ${T[b]} (cause ${c}, far): ${changedFar} pixels of the older object changed`);
}
console.log(`${clean}/${pairs} pair cases clear nothing outside the newer stroke's own pixels`);
if ( process.argv.includes("--matrix") ) {
  console.log("cleared px (rows: older A, cols: newer B; sum over overlap/touch/far and causes none/fire/decay)");
  console.log("".padEnd(10) + T.map((t) => t.padStart(9)).join(""));
  T.forEach((t, a) => console.log(t.padEnd(10) + matrix[a].map((v) => String(v).padStart(9)).join("")));
}
console.log(fails ? `FAILED ${fails}` : "PASS");
process.exit(fails ? 1 : 0);
