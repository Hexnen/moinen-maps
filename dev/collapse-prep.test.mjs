// node dev/collapse-prep.test.mjs: the cave-in's pit grid and plate tones made ahead of the entry (display.prepCollapse; the clock worker makes the grid)
//   1. collapseGrid: on a small pit the chamfer distances, the deepest point and the grid placement are what the rules say (the frame's border counts as outside);
//   2. coverMask: the cover's RGBA alpha as 0 / 1;
//   3. collapseLum from the atlas rectangles = the texture-per-plate way (no atlas on the group);
//   4. collapseClock with the prepared grid and tones = collapseClock made from the pixels: the same pixel moments, the same piece lives, the same stages.
globalThis.Hooks ??= { on() {}, once() {}, off() {} };
class Stub {}
globalThis.PIXI ??= new Proxy({}, { get: () => Stub });
const C = await import("../scripts/destruction/collapse-entry.mjs");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };

// a pit: a disc of radius 9 in a 30 x 24 base frame at (100, 50), its cover a 20 x 20 frame at (105, 52)
const info = { x: 100, y: 50, w: 30, h: 24, ex: 115, ey: 62, R: 9, type: "collapse", mat: 2, cause: 0, axis: 0, len: 0, rect: { x0: 100, y0: 50, x1: 130, y1: 74 } };
const fw = 20, fh = 20, cx = 105, cy = 52;
const rgba = new Uint8Array(fw * fh * 4);
for ( let y = 0; y < fh; y++ ) for ( let x = 0; x < fw; x++ ) if ( (x - 9.5) ** 2 + (y - 9.5) ** 2 <= 81 ) rgba[(y * fw + x) * 4 + 3] = 255;

// 2. coverMask
const mask = C.coverMask(rgba, fw, fh);
{
  let bad = 0; for ( let i = 0; i < fw * fh; i++ ) if ( mask[i] !== (rgba[i * 4 + 3] ? 1 : 0) ) bad++;
  ok(bad === 0 && mask.some((v) => v) && mask.some((v) => !v), `coverMask = the alpha as 0 / 1 (${bad} differences)`);
}

// 1. collapseGrid
const G = C.collapseGrid(info, mask, fw, fh, cx, cy);
{
  let own = 0, bad = 0;
  for ( let y = 0; y < fh; y++ ) for ( let x = 0; x < fw; x++ ) {
    const X = cx + x - info.x, Y = cy + y - info.y, i = Y * info.w + X;
    if ( mask[y * fw + x] ) { own++; if ( !G.own[i] ) bad++; } else if ( G.own[i] ) bad++;
  }
  ok(own > 200 && bad === 0 && G.own.reduce((a, v) => a + v, 0) === own, `the grid holds the pit's pixels at their place (${own} pixels, ${bad} differences)`);
  ok(G.din[0] === 0 && G.din[G.din.length - 1] === 0 && G.dout[0] > 0, "the frame's border counts as outside (din 0 there), dout runs outwards from the pit");
  const rim = [...G.own].some((v, i) => v && G.din[i] === 1), centre = (G.deep % info.w) + info.x, mid = cx + 9.5;
  ok(rim && G.maxD > 7 && G.maxD < 11 && Math.abs(centre - mid) <= 3 && G.own[G.deep] === 1, `the rim is 1 deep, the deepest point (${G.maxD.toFixed(2)}) lies at the middle`);
  // chamfer: along a row from the rim inwards the distance grows by 1 a step
  const row = Math.floor(G.deep / info.w), ys = [];
  for ( let x = 0; x < info.w; x++ ) if ( G.own[row * info.w + x] ) ys.push(G.din[row * info.w + x]);
  let monotone = true; for ( let i = 1; i < ys.length >> 1; i++ ) if ( !(ys[i] > ys[i - 1]) ) monotone = false;
  ok(monotone && ys[0] === 1, "distances grow from the rim inwards");
}

// 3. collapseLum: atlas rectangles vs a texture per plate
const TW = 128, TH = 64, data = new Uint8Array(TW * TH * 4);   // (the plates in the left half, the cover frame in the right)
for ( let i = 0; i < TW * TH; i++ ) if ( i % TW < 64 ) { data[i * 4] = (i * 7) & 255; data[i * 4 + 1] = (i * 13) & 255; data[i * 4 + 2] = (i * 29) & 255; data[i * 4 + 3] = (i % 11) ? 255 : 100; }
const pos = [{ x: 0, y: 0 }], sizes = [[10, 10]], pieces = [];
for ( let q = 0; q < 90; q++ ) { const w = 4 + (q % 7), h = 3 + (q % 5); pos.push({ x: (q * 5) % 50, y: (q * 3) % 50 }); sizes.push([w, h]); pieces.push({ frame: q + 1, w, h }); }
const texOf = (i) => ({ frame: { x: pos[i].x, y: pos[i].y, width: sizes[i][0], height: sizes[i][1] }, destroy() {} });
{
  const a = C.collapseLum({ pieces, atlas: { pos, sizes } }, data, TW), b = C.collapseLum({ pieces, atlas: null, frame: texOf }, data, TW);
  ok(a.G === b.G && a.lumG === b.lumG && a.lumP.every((v, i) => v === b.lumP[i]) && a.lumP.some((v) => v > 0), "collapseLum from the atlas rectangles = from a texture per plate");
}

// 4. collapseClock: prepared = from the pixels
{
  // the cover frame sits in the atlas at (70, 8)
  const cdata = new Uint8Array(TW * TH * 4);
  for ( let y = 0; y < fh; y++ ) for ( let x = 0; x < fw; x++ ) if ( rgba[(y * fw + x) * 4 + 3] ) cdata[((8 + y) * TW + 70 + x) * 4 + 3] = 255;
  const mk = () => ({ hash: 123457, info, pieces: pieces.map((p, q) => ({ ...p, sx: 105 + (q % 20), sy: 52 + ((q * 3) % 20), fx: 106 + (q % 20), fy: 53 + ((q * 3) % 20), rot: 0.1 * (q % 5), chip: q % 4 === 0 })),
    coverFrame: { tex: { frame: { x: 70, y: 8, width: fw, height: fh } }, x: cx, y: cy }, tex: { resource: { data: cdata }, width: TW }, atlas: { pos, sizes }, frame: texOf, cont: { addChildAt() {} } });
  const buf = new Uint8Array(TW * TH * 4); buf.set(data); for ( let i = 3; i < buf.length; i += 4 ) if ( cdata[i] ) buf[i] = 255;
  const g1 = mk(), g2 = mk(); g1.tex.resource.data = buf; g2.tex.resource.data = buf;
  const disp = { look: { speed: 1 }, ap: 1, origin: { x: 0, y: 0 } };
  const own = C.collapseClock(disp, g1, { start: 1000, k: 1, pathFront: null });
  const grid = C.collapseGrid(info, mask, fw, fh, cx, cy), lum = C.collapseLum(g2, buf, TW);
  const pre = C.collapseClock(disp, g2, { start: 1000, k: 1, pathFront: null, grid, lum });
  let bad = 0, n = 0;
  for ( let y = info.y; y < info.y + info.h; y++ ) for ( let x = info.x; x < info.x + info.w; x++ ) { n++; if ( own.pixelTime(x + 0.5, y + 0.5) !== pre.pixelTime(x + 0.5, y + 0.5) ) bad++; }
  ok(own && pre && bad === 0, `pixelTime: the prepared clock = the clock from the pixels (${n} pixels, ${bad} differences)`);
  let pb = 0; g1.pieces.forEach((p, q) => { const a = own.piece(p, q), b = pre.piece(g2.pieces[q], q); for ( const k of ["t0", "dur", "pre", "ovx", "ovy", "hop", "tint0"] ) if ( a[k] !== b[k] ) pb++; });
  ok(pb === 0, `piece lives: the prepared clock's = the clock from the pixels (${pb} differences)`);
  ok(own.reveal === pre.reveal && own.endBy === pre.endBy && own.G === pre.G && JSON.stringify(own.stages.map((s) => s.dt)) === JSON.stringify(pre.stages.map((s) => s.dt)), "reveal, end, ground tone and stages agree");
  ok(pre.grid === grid && pre.lum === lum, "the clock hands the grid and tones back (display caches them: g.collGrid / g.collLum)");
}

console.log(fails ? `${fails} FAILED` : "all checks passed");
process.exit(fails ? 1 : 0);
