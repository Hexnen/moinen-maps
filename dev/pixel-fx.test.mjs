// node dev/pixel-fx.test.mjs: the entry accents are pixel art and never a circle or an ellipse.
//   1. every pixel of a ring / flash / line sits on the art grid (whole art pixels, one art pixel wide);
//   2. a ring is not an ellipse: fitted with the best ellipse of the oblique camera (centre known, y radius 0.8 x), the spread of its
//      pixels' radii is above 6 % of the radius, and it closes at most 80 % of the circle (a broken, partial front);
//   3. deterministic for a seed.
import { pxRing, pxFlash, pxLine } from "../scripts/destruction/pixel-fx.mjs";
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };
const rec = () => { const r = []; return { r, beginFill() { return this; }, endFill() { return this; }, drawRect(x, y, w, h) { r.push([x, y, w, h]); return this; } }; };
const v = { ap: 3, ox: 0, oy: 0 };
let worstCV = 1, worstCov = 0, onGrid = true;
for ( const r of [8, 16, 30, 50] ) for ( const t of [0.1, 0.4, 0.7] ) for ( const seed of [1, 7, 23] ) {
  const g = rec(); pxRing(g, v, 100, 100, r, t, { seed });
  if ( !g.r.length ) continue;
  const rad = [], ang = new Set();
  for ( const [x, y, w, h] of g.r ) {
    if ( x % 3 || y % 3 || w !== 3 || h !== 3 ) onGrid = false;
    const X = x / 3 + 0.5 - 100, Y = (y / 3 + 0.5 - 100) / 0.8; rad.push(Math.hypot(X, Y)); ang.add(Math.floor((Math.atan2(Y, X) + Math.PI) / (Math.PI * 2) * 72));
  }
  const m = rad.reduce((a, b) => a + b, 0) / rad.length, sd = Math.sqrt(rad.reduce((a, b) => a + (b - m) ** 2, 0) / rad.length);
  if ( r >= 16 ) { worstCV = Math.min(worstCV, sd / m); worstCov = Math.max(worstCov, ang.size / 72); }
}
ok(onGrid, "ring pixels are whole art pixels on the art grid");
ok(worstCV > 0.06, `no ring is an ellipse: smallest radial spread ${(worstCV * 100).toFixed(1)} % of the radius (> 6 %)`);
ok(worstCov <= 0.8, `every ring is broken: it closes at most ${(worstCov * 100).toFixed(0)} % of the circle (<= 80 %)`);
const a = rec(), b = rec(); pxRing(a, v, 50, 50, 20, 0.3, { seed: 5 }); pxRing(b, v, 50, 50, 20, 0.3, { seed: 5 });
ok(JSON.stringify(a.r) === JSON.stringify(b.r), "a ring is the same for the same seed");
const f = rec(); pxFlash(f, v, 50, 50, 10, 0.2, { seed: 3 }); ok(f.r.length > 20 && f.r.every(([x, y, w]) => x % 3 === 0 && y % 3 === 0 && w === 3), `flash in art pixels (${f.r.length})`);
const l = rec(); pxLine(l, v, 0, 0, 10, 4, 0xffffff); ok(l.r.length === 11, `a line is one art pixel per step (${l.r.length})`);

// ---- DEBRIS CHUNKS (scripts/destruction/debris.mjs)
//   4. a chunk is a chunk: 3-9 art px across, never a stick (principal-axis aspect <= 3), at least 4 pixels, one connected piece;
//   5. its pixels are the MAP's: cut from a textured source, the histogram of its inner pixels is close to the source's (and far from
//      a different material's); the lit edge is lighter and the shaded rim darker than the inside;
//   6. every chunk lands: at the end of its plan it rests exactly on its planned point, nothing is in the air; within the throw bound
//      (big: <= 1.0 R past the rim, small <= 1.4 R) and never beyond the scene rect; the staying ones inside their keep rect;
//   7. deterministic for a seed.
import { chunkMask, maskAspect, chunkSet, planThrow, chunkPose, hopAt, cutChunk } from "../scripts/destruction/debris.mjs";
{
  let worstAsp = 0, small = 0, big = 0, disc = 0, tiny = 0;
  for ( let s = 3; s <= 9; s++ ) for ( let seed = 0; seed < 60; seed++ ) {
    const m = chunkMask(seed * 13 + s, s), a = maskAspect(m), n = m.m.reduce((p, q) => p + q, 0);
    worstAsp = Math.max(worstAsp, a); if ( Math.max(m.w, m.h) < 2 ) small++; if ( Math.max(m.w, m.h) > 10 ) big++; if ( n < 4 ) tiny++;
    // connected (4-neighbours)
    const seen = new Uint8Array(m.w * m.h), st = [m.m.indexOf(1)]; seen[st[0]] = 1; let c = 0;
    while ( st.length ) { const i = st.pop(); c++; const x = i % m.w, y = (i / m.w) | 0; for ( const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] ) { const X = x + dx, Y = y + dy, j = Y * m.w + X; if ( X >= 0 && Y >= 0 && X < m.w && Y < m.h && m.m[j] && !seen[j] ) { seen[j] = 1; st.push(j); } } }
    if ( c !== n ) disc++;
  }
  ok(worstAsp <= 3, `no chunk is a stick: largest principal-axis aspect ${worstAsp.toFixed(2)} (<= 3)`);
  ok(!small && !big && !tiny, `every chunk 2-10 art px across with >= 4 pixels (too small ${small}, too big ${big}, under 4 px ${tiny})`);
  ok(!disc, `every chunk is one connected piece (${disc} broken)`);

  // a "map": grass (greens with blade streaks) and a brick wall (reds with mortar lines), opaque, 64 x 64 each
  const W = 128, H = 64, src = new Uint8Array(W * H * 4);
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
    const q = (y * W + x) * 4, h = ((x * 7 + y * 13) % 11) / 11;
    if ( x < 64 ) { src[q] = 60 + h * 30; src[q + 1] = 120 + h * 60; src[q + 2] = 40 + h * 20; }
    else { const mortar = y % 6 === 0 || (x + (((y / 6) | 0) & 1) * 4) % 9 === 0; src[q] = mortar ? 190 : 150 + h * 40; src[q + 1] = mortar ? 180 : 60 + h * 20; src[q + 2] = mortar ? 160 : 45 + h * 15; }
    src[q + 3] = 255;
  }
  const hist = (px, mask) => { const hb = new Float64Array(64); let n = 0; for ( let i = 0; i < mask.length; i++ ) if ( mask[i] ) { hb[((px[i * 4] >> 6) << 4) | ((px[i * 4 + 1] >> 6) << 2) | (px[i * 4 + 2] >> 6)]++; n++; } return hb.map((v) => v / n); };
  const dist = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / 2;
  const grassH = hist(src.subarray(0), Array.from({ length: W * H }, (_, i) => (i % W) < 64)), brickH = hist(src, Array.from({ length: W * H }, (_, i) => (i % W) >= 64));
  const set = chunkSet(src, W, [{ x: 0, y: 0, w: 64, h: 64 }], { seed: 9, n: 12, sizes: [3, 8] });
  // (all the chunks' inner pixels together: one chunk has too few for a histogram)
  const allPx = [], allM = [];
  for ( const f of set.frames ) {
    const px = new Uint8Array(f.w * f.h * 4), mask = new Uint8Array(f.w * f.h);
    for ( let y = 0; y < f.h; y++ ) for ( let x = 0; x < f.w; x++ ) { const p = ((f.y + y) * set.w + f.x + x) * 4, q = (y * f.w + x) * 4; for ( let c = 0; c < 4; c++ ) px[q + c] = set.data[p + c]; mask[y * f.w + x] = set.data[p + 3] ? 1 : 0; }
    // inner pixels (not on the edge): the map's own
    // inner pixels: two pixels in from the edge (the outline and the lit / shaded rim are the chunk's light, not the map)
    const at = (x, y) => x >= 0 && y >= 0 && x < f.w && y < f.h && mask[y * f.w + x];
    const inn = mask.map((m, i) => { const x = i % f.w, y = (i / f.w) | 0; if ( !m ) return 0; for ( let dy = -2; dy <= 2; dy++ ) for ( let dx = -2; dx <= 2; dx++ ) if ( Math.abs(dx) + Math.abs(dy) <= 2 && !at(x + dx, y + dy) ) return 0; return 1; });
    for ( let i = 0; i < inn.length; i++ ) { allM.push(inn[i]); allPx.push(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]); }
  }
  const hh = hist(allPx, allM), worst = dist(hh, grassH), wrong = dist(hh, brickH);
  ok(worst < 0.35 && wrong > 0.9, `chunk colours come from the map: histogram distance to its source ${worst.toFixed(2)} (< 0.35), to another material ${wrong.toFixed(2)} (> 0.9)`);
  ok(cutChunk(src, W, 125, 10, chunkMask(3, 6)) === null && cutChunk(src, W, 10, 62, chunkMask(3, 6)) === null, "a cut past the source's edge is refused (no pixels of the next row)");
  {
    const g2 = new Uint8Array(src); for ( let y = 0; y < H; y++ ) for ( let x = 30; x < 40; x++ ) g2[(y * W + x) * 4 + 3] = 0;
    ok(cutChunk(g2, W, 28, 10, chunkMask(3, 6)) === null, "no chunk pixel is cut from a transparent pixel");
  }
  // lit edge lighter, shaded rim darker (average per pixel)
  const avg = (frames, pick) => { let s = 0, n = 0; for ( const f of frames ) for ( let y = 0; y < f.h; y++ ) for ( let x = 0; x < f.w; x++ ) { const p = ((f.y + y) * set.w + f.x + x) * 4; if ( !set.data[p + 3] ) continue; const o = (X, Y) => X < 0 || Y < 0 || X >= f.w || Y >= f.h || !set.data[((f.y + Y) * set.w + f.x + X) * 4 + 3]; const L = o(x, y - 1) || o(x - 1, y), D = o(x, y + 1) || o(x + 1, y), k = L && !D ? 0 : D && !L ? 2 : 1; if ( k === pick ) { s += set.data[p] + set.data[p + 1] + set.data[p + 2]; n++; } } return s / Math.max(1, n); };
  // (on the crumbs, which have no outline: the outline is the darkest ring of a bigger chunk)
  const crumbs = chunkSet(src, W, [{ x: 0, y: 0, w: 64, h: 64 }], { seed: 9, n: 12, sizes: [3, 3] });
  const avgS = (frames, pick, S) => { let s = 0, n = 0; for ( const f of frames ) for ( let y = 0; y < f.h; y++ ) for ( let x = 0; x < f.w; x++ ) { const p = ((f.y + y) * S.w + f.x + x) * 4; if ( !S.data[p + 3] ) continue; const o = (X, Y) => X < 0 || Y < 0 || X >= f.w || Y >= f.h || !S.data[((f.y + Y) * S.w + f.x + X) * 4 + 3]; const L = o(x, y - 1) || o(x - 1, y), D = o(x, y + 1) || o(x + 1, y), k = L && !D ? 0 : D && !L ? 2 : 1; if ( k === pick ) { s += S.data[p] + S.data[p + 1] + S.data[p + 2]; n++; } } return s / Math.max(1, n); };
  const aL = avgS(crumbs.frames, 0, crumbs), aM = avgS(crumbs.frames, 1, crumbs), aD = avgS(crumbs.frames, 2, crumbs);
  // a bigger chunk: its outline darker than anything inside it
  let outlineOk = true;
  for ( const f of set.frames ) if ( f.s >= 4 ) {
    let edge = 0, ne = 0, inner = 0, ni = 0;
    for ( let y = 0; y < f.h; y++ ) for ( let x = 0; x < f.w; x++ ) { const p = ((f.y + y) * set.w + f.x + x) * 4; if ( !set.data[p + 3] ) continue; const o = (X, Y) => X < 0 || Y < 0 || X >= f.w || Y >= f.h || !set.data[((f.y + Y) * set.w + f.x + X) * 4 + 3]; const v = set.data[p] + set.data[p + 1] + set.data[p + 2]; if ( o(x - 1, y) || o(x + 1, y) || o(x, y - 1) || o(x, y + 1) ) { edge += v; ne++; } else { inner += v; ni++; } }
    if ( ni && edge / ne >= inner / ni ) outlineOk = false;
    if ( Math.max(f.w, f.h) > 9 ) outlineOk = false;
  }
  ok(outlineOk, "chunks of 4+ px carry a dark outline and stay within 9 art px across");
  ok(aL > aM && aM > aD, `one light: lit top-left edge ${aL.toFixed(0)} > inside ${aM.toFixed(0)} > shaded bottom-right rim ${aD.toFixed(0)}`);

  // the throw: every chunk lands, within the bound, inside the scene; nothing in the air at its end
  const frames = [{ s: 3 }, { s: 4 }, { s: 5 }, { s: 6 }, { s: 8 }, { s: 9 }];
  let airborne = 0, offPoint = 0, overBig = 0, overSmall = 0, offScene = 0, maxEnd = 0, n = 0, apexOk = 0, flights = 0, kept = 0, keptOut = 0;
  const scene = { x0: 0, y0: 0, x1: 200, y1: 160 }, keep = { x0: 70, y0: 50, x1: 130, y1: 110 };
  for ( let seed = 1; seed <= 40; seed++ ) for ( const R of [6, 14, 30] ) {
    const ox = 100 + (seed % 7) * 12 - 36, oy = 80 + (seed % 5) * 14 - 28;
    const plan = planThrow({ seed, count: 24, ox, oy, R, reach: [0.6, 2.5], H: [4, 14], speed: 1.6, frames, scene, landing: "rest", rest: 4, keep });
    for ( const c of plan ) {
      n++;
      const e = chunkPose(c, c.P.end + 0.001); if ( e.z !== 0 || !e.rest ) airborne++;
      if ( Math.abs(e.x - c.P.px) > 1e-9 || Math.abs(e.y - c.P.py) > 1e-9 ) offPoint++;
      const d = Math.hypot(c.P.px - ox, (c.P.py - oy) / 0.8) - R;
      if ( c.s >= 6 && d > R * 1.0 + 1 ) overBig++;
      if ( c.s < 6 && d > R * 1.4 + 1 ) overSmall++;
      if ( c.P.px < scene.x0 || c.P.py < scene.y0 || c.P.px > scene.x1 || c.P.py > scene.y1 ) offScene++;
      maxEnd = Math.max(maxEnd, c.P.end);
      // a visible apex: the height rises then falls over the first arc
      const s0 = c.P.segs[0], zs = [0.1, 0.5, 0.9].map((u) => hopAt(c.P, s0.t0 + s0.T * u).z); flights++; if ( zs[1] > zs[0] && zs[1] > zs[2] ) apexOk++;
      if ( c.fate === "rest" ) { kept++; if ( c.P.px - c.s / 2 < keep.x0 || c.P.px + c.s / 2 > keep.x1 || c.P.py - c.s / 2 < keep.y0 || c.P.py + c.s / 2 > keep.y1 ) keptOut++; }
    }
  }
  ok(!airborne && !offPoint, `every chunk lands and rests on its point (${n} chunks: ${airborne} still in the air, ${offPoint} off their point)`);
  ok(maxEnd < 1.6, `the longest throw is over in ${(maxEnd * 1000).toFixed(0)} ms (< 1600: nothing flies past the settle)`);
  ok(!overBig && !overSmall, `throw bound: big chunks <= 1.0 R past the rim (${overBig} over), small <= 1.4 R (${overSmall} over)`);
  ok(!offScene, `no chunk comes to rest beyond the scene rect (${offScene})`);
  ok(apexOk === flights, `every flight is a parabola with a visible apex (${apexOk} / ${flights})`);
  ok(kept > 0 && !keptOut, `staying chunks bounded (${kept} in 120 throws, at most 4 each) and inside their area (${keptOut} outside)`);
  const A = JSON.stringify(planThrow({ seed: 5, count: 9, ox: 50, oy: 50, R: 10, frames })), B = JSON.stringify(planThrow({ seed: 5, count: 9, ox: 50, oy: 50, R: 10, frames }));
  const S1 = chunkSet(src, W, [{ x: 0, y: 0, w: 64, h: 64 }], { seed: 4 }), S2 = chunkSet(src, W, [{ x: 0, y: 0, w: 64, h: 64 }], { seed: 4 });
  ok(A === B && Buffer.compare(Buffer.from(S1.data), Buffer.from(S2.data)) === 0, "chunks and throws are deterministic for a seed");
}

console.log(fails ? `FAILED ${fails}` : "PASS");
process.exit(fails ? 1 : 0);
