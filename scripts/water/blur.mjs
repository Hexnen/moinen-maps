/**
 * The blur shapes of the water reflections (reflect.mjs), as pure functions on RGBA bytes (node-tested against the plain loop they
 * replaced: dev/reflect-blur.test.mjs).
 *
 * A shape is a sampling window: width, height, the anchor (which window cell sits on the output pixel) and the weight of each cell.
 * "left" shapes smear toward the left, "top" toward the top, the diagonals along a diagonal; "hard" weighs the centre more.
 *
 * PERF: the plain loop visited every cell of the window for every pixel (a 17x17 shape: 289 visits, ~8 ms for one 70x45 reflection,
 * 48 tokens redrawing every 90 ms = 370 ms per frame). A box shape (all cells 1) is now read from summed-area tables - the sums are
 * the same integers, so the result is byte for byte the same - and the other shapes visit only their non-zero cells.
 */

function box(w, h, ax = (w - 1) >> 1, ay = (h - 1) >> 1) { return { w, h, ax, ay, k: new Float32Array(w * h).fill(1), box: true }; }

/** The shape of a blur type, or null ("none"). */
export function kernel(name) {
  let o = null;
  switch ( name ) {
    case "3x3": return box(3, 3);
    case "3x3hard": o = box(3, 3); o.k.set([0, 1, 0, 1, 3, 1, 0, 1, 0]); break;
    case "5x5": return box(5, 5);
    case "7x7": return box(7, 7);
    case "9x9": return box(9, 9);
    case "17x17": return box(17, 17);
    case "5x3left": return box(5, 3, 4, 1);
    case "17x3left": return box(17, 3, 16, 1);
    case "3x17top": return box(3, 17, 1, 16);
    case "5x5diagback": o = box(5, 5); o.k.fill(0); for ( let i = 0; i < 5; i++ ) o.k[i * 5 + i] = 1; break;
    case "5x5diagfwd": o = box(5, 5); o.k.fill(0); for ( let i = 0; i < 5; i++ ) o.k[i * 5 + (4 - i)] = 1; break;
    default: return null;
  }
  o.box = false;
  return o;
}

const kernelCache = new Map();
export const kernelOf = (name) => { if ( !kernelCache.has(name) ) kernelCache.set(name, kernel(name)); return kernelCache.get(name); };

/** The non-zero cells of a shape as { dx, dy, w } arrays (made once per shape). */
function taps(kn) {
  if ( kn._taps ) return kn._taps;
  const dx = [], dy = [], w = [];
  for ( let j = 0; j < kn.h; j++ ) for ( let i = 0; i < kn.w; i++ ) { const v = kn.k[j * kn.w + i]; if ( v ) { dx.push(i - kn.ax); dy.push(j - kn.ay); w.push(v); } }
  return kn._taps = { dx: Int32Array.from(dx), dy: Int32Array.from(dy), w: Float64Array.from(w), n: w.length };
}

let sat = null;    // summed-area tables of the premultiplied colour planes and of the alpha, reused

/**
 * Blur `src` (RGBA bytes, W x H, straight alpha) into `dst` (same size; every byte is written). The colour of an output pixel is the
 * alpha-weighted mean of the window's colours (so a soft edge does not darken), its alpha the window's alpha sum over the whole
 * shape's weight; a window with no alpha at all stays transparent black.
 */
export function blurPixels(src, dst, W, H, kn) {
  const total = kn.k.reduce((a, b) => a + b, 0) || 1;
  dst.fill(0);
  if ( kn.box ) {
    const S = W + 1, N = S * (H + 1);
    if ( !sat || sat.n < N ) sat = { n: N, r: new Float64Array(N), g: new Float64Array(N), b: new Float64Array(N), a: new Float64Array(N) };
    const { r: R, g: G, b: B, a: A } = sat;
    for ( let x = 0; x <= W; x++ ) { R[x] = G[x] = B[x] = A[x] = 0; }
    for ( let y = 0; y < H; y++ ) {
      const row = (y + 1) * S; R[row] = G[row] = B[row] = A[row] = 0;
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for ( let x = 0; x < W; x++ ) {
        const o = (y * W + x) * 4, al = src[o + 3];
        sr += src[o] * al; sg += src[o + 1] * al; sb += src[o + 2] * al; sa += al;
        const i = row + x + 1, up = i - S;
        R[i] = R[up] + sr; G[i] = G[up] + sg; B[i] = B[up] + sb; A[i] = A[up] + sa;
      }
    }
    const { w, h, ax, ay } = kn;
    for ( let y = 0; y < H; y++ ) {
      const y0 = Math.max(0, y - ay), y1 = Math.min(H, y + h - ay), r0 = y0 * S, r1 = y1 * S;
      for ( let x = 0; x < W; x++ ) {
        const x0 = Math.max(0, x - ax), x1 = Math.min(W, x + w - ax);
        const a = A[r1 + x1] - A[r0 + x1] - A[r1 + x0] + A[r0 + x0];
        if ( !(a > 0) ) continue;
        const o = (y * W + x) * 4;
        dst[o] = (R[r1 + x1] - R[r0 + x1] - R[r1 + x0] + R[r0 + x0]) / a;
        dst[o + 1] = (G[r1 + x1] - G[r0 + x1] - G[r1 + x0] + G[r0 + x0]) / a;
        dst[o + 2] = (B[r1 + x1] - B[r0 + x1] - B[r1 + x0] + B[r0 + x0]) / a;
        dst[o + 3] = a / (total * 255) * 255 / 1;
      }
    }
    return;
  }
  const t = taps(kn), n = t.n;
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
    let r = 0, g = 0, b = 0, a = 0;
    for ( let q = 0; q < n; q++ ) {
      const xx = x + t.dx[q], yy = y + t.dy[q];
      if ( xx < 0 || xx >= W || yy < 0 || yy >= H ) continue;
      const o = (yy * W + xx) * 4, al = src[o + 3] * t.w[q];
      r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al; a += al;
    }
    if ( a > 0 ) { const o = (y * W + x) * 4; dst[o] = r / a; dst[o + 1] = g / a; dst[o + 2] = b / a; dst[o + 3] = a / (total * 255) * 255 / 1; }
  }
}
