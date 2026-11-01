// node dev/entry-clock.test.mjs: the entry clock moved out of display.mjs (entry-clock.mjs, shared by the page and the clock workers)
//   1. countSort gives the order of sorting the keys moment * 2^20 + pixel (the old typed-array sort), moments and pixels alike;
//   2. clockKeys from a pixel mask = the keys made from the RGBA pixels themselves (display.clockSlice), dark pixels earlier;
//   3. latticeNoise (lazy grid) = vnoise at every point, before and after its grid is made;
//   4. clockOf is deterministic and the same for every kind and cause (blast, collapse order "in", wipe, followed path, tear).
globalThis.Hooks ??= { on() {}, once() {}, off() {} };
class Stub {}
globalThis.PIXI ??= new Proxy({}, { get: () => Stub });
const E = await import("../scripts/destruction/entry-clock.mjs");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };

// 1. counting sort vs float keys sorted
{
  let bad = 0;
  for ( let run = 0; run < 20; run++ ) {
    const n = 500 + run * 137, tm = new Int32Array(n), ix = new Uint32Array(n);
    for ( let j = 0; j < n; j++ ) { tm[j] = Math.floor(E.hash2(j, run, 3) * (run % 3 ? 900 : 5)); ix[j] = j * 3 + (run & 1); }
    const keys = Float64Array.from({ length: n }, (_, j) => tm[j] * 1048576 + ix[j]).sort();
    const c = E.countSort(tm, ix, n, Math.max(...tm));
    for ( let j = 0; j < n; j++ ) if ( c.tm[j] * 1048576 + c.ix[j] !== keys[j] ) bad++;
  }
  ok(bad === 0, `countSort = sorted keys (20 runs, ${bad} differences)`);
}

// 2. clockKeys from a mask = keys from the pixels
{
  const info = { x: 10, y: 20, w: 60, h: 40, ex: 40, ey: 40, R: 14, type: "blast", cause: 0, axis: 0, len: 0, rect: { x0: 10, y0: 20, x1: 70, y1: 60 } };
  const C = E.clockOf({ info, hash: 987654 });
  const w = 60, h = 40, data = new Uint8Array(w * h * 4);
  for ( let i = 0; i < w * h; i++ ) { const v = E.hash2(i, 1, 9); if ( v < 0.7 ) { data[i * 4 + 3] = 255; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v < 0.2 ? 30 : 180; } }
  const dark = C.band * 0.4, keys = [];
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
    const i = y * w + x, p = i * 4; if ( !data[p + 3] ) continue;
    let t = C.pixelTime(info.x + x + 0.5, info.y + y + 0.5);
    if ( data[p] + data[p + 1] + data[p + 2] < 150 ) t -= dark;
    keys.push(Math.max(0, Math.round(t)) * 1048576 + i);
  }
  const ref = Float64Array.from(keys).sort();
  const got = E.clockKeys(C.pixelTime, E.clockMask(data, w, h, true), w, h, info.x, info.y, dark);
  let bad = ref.length !== got.ix.length ? 1 : 0;
  for ( let j = 0; j < ref.length && !bad; j++ ) if ( got.tm[j] * 1048576 + got.ix[j] !== ref[j] ) bad++;
  ok(bad === 0 && ref.length > 1000, `clockKeys(mask) = keys from the pixels (${ref.length} pixels)`);
  let up = 0; const lim = 300 * 1048576;
  for ( let j = 0; j < ref.length; j++ ) if ( ref[j] < lim ) up = j + 1;
  ok(E.clockUpper(got, 0, lim) === up, "clockUpper finds the first key at or past a limit");
}

// 3. lazy lattice noise = vnoise
{
  const f = E.latticeNoise(0, 0, 80, 60, 7, 1234);
  let bad = 0;
  for ( let k = 0; k < 4000; k++ ) {   // past the grid's cell count: both the direct and the grid path
    const x = (k * 7.31) % 80, y = (k * 3.17) % 60;
    if ( f(x, y) !== E.vnoise(x / 7, y / 7, 1234) ) bad++;
  }
  ok(bad === 0, `latticeNoise = vnoise at 4000 points (${bad} differ)`);
}

// 4. every kind / cause / front: deterministic, finite moments
{
  let bad = 0, n = 0;
  const path = [[12, 22, 0], [30, 30, 120], [55, 50, 300]];
  for ( const type of ["blast", "collapse", "scorch", "flood", "cracks", "gash"] ) for ( let cause = 0; cause < 10; cause++ ) for ( const opt of [{}, { dir: [1, 0.5] }, { path }, { spine: path }] ) {
    const info = { x: 10, y: 20, w: 60, h: 40, ex: 40, ey: 40, R: 14, type, cause, axis: 0.3, len: 40, rect: { x0: 10, y0: 20, x1: 70, y1: 60 } };
    const a = E.clockOf({ info, hash: 4242 + cause, ...opt }), b = E.clockOf({ info, hash: 4242 + cause, ...opt });
    for ( const [x, y] of [[11, 21], [40, 40], [69.5, 59.5], [25.5, 33.5]] ) { n++; const u = a.pixelTime(x, y), v = b.pixelTime(x, y); if ( u !== v || !Number.isFinite(u) ) bad++; }
  }
  ok(bad === 0, `clockOf deterministic and finite (${n} samples, ${bad} bad)`);
}

console.log(fails ? `${fails} FAILED` : "PASS");
process.exit(fails ? 1 : 0);
