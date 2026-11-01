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
console.log(fails ? `FAILED ${fails}` : "PASS");
process.exit(fails ? 1 : 0);
