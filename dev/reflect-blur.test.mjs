// Reflection blur:   node dev/reflect-blur.test.mjs
// scripts/water/blur.mjs (summed-area tables for box shapes, non-zero cells for the others) against the plain loop it replaced
// (reflect.mjs blurCanvas before 0.4.4, copied below): every shape, random pictures with transparent holes, sizes smaller and larger
// than the shape - the bytes must be identical. Also times the two on a 69x44 reflection (a size-2 token on a 3 px water grid).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const B = await import(pathToFileURL(path.join(root, "scripts/water/blur.mjs")).href);
const NAMES = ["3x3", "3x3hard", "5x5", "7x7", "9x9", "17x17", "5x3left", "17x3left", "3x17top", "5x5diagback", "5x5diagfwd"];

function reference(src, W, H, kn) {
  const out = new Uint8ClampedArray(src.length), total = kn.k.reduce((a, b) => a + b, 0) || 1;
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
    let r = 0, g = 0, b = 0, a = 0;
    for ( let j = 0; j < kn.h; j++ ) {
      const yy = y + j - kn.ay; if ( yy < 0 || yy >= H ) continue;
      for ( let i = 0; i < kn.w; i++ ) {
        const wgt = kn.k[j * kn.w + i]; if ( !wgt ) continue;
        const xx = x + i - kn.ax; if ( xx < 0 || xx >= W ) continue;
        const o = (yy * W + xx) * 4, al = src[o + 3] * wgt;
        r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al; a += al;
      }
    }
    const o = (y * W + x) * 4;
    if ( a > 0 ) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = a / (total * 255) * 255 / 1; }
  }
  return out;
}

let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const picture = (W, H, holes) => {
  const p = new Uint8ClampedArray(W * H * 4);
  for ( let i = 0; i < W * H; i++ ) {
    const hole = rnd() < holes;
    p[i * 4] = rnd() * 256; p[i * 4 + 1] = rnd() * 256; p[i * 4 + 2] = rnd() * 256;
    p[i * 4 + 3] = hole ? 0 : rnd() < 0.3 ? rnd() * 256 : 255;
  }
  return p;
};

let n = 0, bad = 0;
for ( const name of NAMES ) {
  const kn = B.kernelOf(name);
  for ( const [W, H, holes] of [[1, 1, 0], [2, 3, 0.2], [5, 4, 0.5], [17, 9, 0.1], [40, 30, 0.3], [69, 44, 0.4], [70, 45, 1], [31, 52, 0]] ) {
    const src = picture(W, H, holes), ref = reference(src, W, H, kn), got = new Uint8ClampedArray(W * H * 4);
    B.blurPixels(src, got, W, H, kn);
    n++;
    for ( let i = 0; i < ref.length; i++ ) if ( ref[i] !== got[i] ) { bad++; console.error(`FAIL ${name} ${W}x${H} byte ${i}: ${got[i]} vs ${ref[i]}`); break; }
  }
}
if ( B.kernelOf("none") !== null ) { console.error("FAIL none is null"); process.exit(1); }
if ( bad ) process.exit(1);

// the speed (informational)
const W = 69, H = 44, src = picture(W, H, 0.3), dst = new Uint8ClampedArray(W * H * 4), line = [];
for ( const name of ["3x3", "9x9", "17x17", "3x3hard"] ) {
  const kn = B.kernelOf(name), t0 = performance.now(); for ( let i = 0; i < 20; i++ ) reference(src, W, H, kn);
  const t1 = performance.now(); for ( let i = 0; i < 20; i++ ) B.blurPixels(src, dst, W, H, kn);
  const t2 = performance.now(); line.push(`${name} ${((t1 - t0) / 20).toFixed(2)} -> ${((t2 - t1) / 20).toFixed(3)} ms`);
}
console.log(`reflect blur: ${n} shapes x sizes byte-identical to the plain loop; per ${W}x${H} reflection: ${line.join(", ")}`);
