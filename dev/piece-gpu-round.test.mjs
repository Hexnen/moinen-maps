/**
 * GPU pieces: the landing rounding (scripts/destruction/piece-gpu.mjs rndS): node dev/piece-gpu-round.test.mjs
 * display.place rounds a flight position with Math.round(sx + (fx - sx) * e): in the last / first ~1% of a flight e is within 1e-6 of 1 / 0 and
 * a position on the half-pixel grid lands on a TIE (n + 0.5 - 1e-9 rounds down, n + 0.5 rounds up). The vertex shader does the sum in float32,
 * which loses the 1e-9: the old shader rounded those pieces up by one pixel (<= 14 of 5243 in the last ~1% of a flight). The new one rounds
 * from the nearer end with the small part added after the tie is decided: s + floor(a + 0.5 - s + d). This test replays both in float32
 * (Math.fround at every operation, as the GPU does) against the double-precision Math.round.
 */
import assert from "node:assert/strict";

const f = Math.fround;
const rndOld = (x) => f(Math.floor(f(x + 0.5)));                      // the old shader: rnd(x), x already a float32 sum
const rndS = (a, d) => { if ( Math.abs(d) < 2 ** (Math.floor(Math.log2(Math.abs(a) + 1)) - 53) ) d = 0; const s = f(Math.floor(f(a + 0.5))); return f(s + f(Math.floor(f(f(f(a + 0.5) - s) + d)))); };

let seed = 12345;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

let oldBad = 0, newBad = 0, n = 0;
for ( let i = 0; i < 400000; i++ ) {
  // start and rest on the half-pixel grid (what the area's pieces are), a flight of 0..40 px, t within 2% of an end
  const sx = Math.floor(rand() * 2000 - 200) + (rand() < 0.5 ? 0.5 : 0), fx = sx + Math.floor(rand() * 40 - 20) + (rand() < 0.5 ? 0.5 : 0);
  const near = rand() < 0.5 ? rand() * 0.02 : 1 - rand() * 0.02, t = near;
  // the CPU (double): e = 1 - (1 - t)^3, x = sx + (fx - sx) * e
  const e = 1 - (1 - t) ** 3, x = sx + (fx - sx) * e, want = Math.round(x);
  // the GPU (float32)
  const tf = f(t), u1 = f(1 - tf), u = f(f(u1 * u1) * u1), ef = f(1 - u), dx = f(f(fx) - f(sx));
  const gOld = rndOld(f(f(sx) + f(dx * ef)));
  const gNew = ef < 0.5 ? rndS(f(sx), f(dx * ef)) : rndS(f(fx), -f(dx * u));
  n++;
  if ( gOld !== want ) oldBad++;
  if ( gNew !== want ) newBad++;
}
console.log(`ok piece-gpu rounding: ${n} flights near an end; old float32 sum ${oldBad} wrong, rndS ${newBad} wrong`);
assert.ok(oldBad > 0, "the test must be able to see the old error");
// (what is left sits where |d| is within a hair of half a double ulp: there the CPU's own sum rounds either way - 1 in 400000 flights)
assert.ok(newBad <= 5 && newBad * 1000 < oldBad, "rndS rounds like Math.round");
