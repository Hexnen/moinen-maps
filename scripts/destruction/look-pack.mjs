// Plain looks for the bake lanes (a Rebake all, bake.mjs runBakePool): worker-safe, no page imports.
/**
 * A plain look (sprites { m, w, h, img }) as three buffers: the metas, the sizes, all pixels - or null when it is not of that shape.
 * Posted as it is (a structured clone of thousands of small arrays took 60-400 ms of the page); unpackLook (worker.mjs) makes the sprites again.
 */
export function packLook(sprites) {
  const n = sprites.length; if ( !n ) return null;
  const F = sprites[0].m?.length, ctor = sprites[0].m?.constructor;
  if ( !F || (ctor !== Int32Array && ctor !== Float32Array && ctor !== Int16Array && ctor !== Uint16Array) ) return null;
  let total = 0;
  for ( const s of sprites ) {
    if ( s.m?.constructor !== ctor || s.m.length !== F || !(s.img instanceof Uint8Array || s.img instanceof Uint8ClampedArray) || s.img.length !== s.w * s.h * 4 || Object.keys(s).length !== 4 ) return null;
    total += s.img.length;
  }
  const metas = new ctor(n * F), dims = new Int32Array(n * 2), px = new Uint8Array(total);
  let o = 0;
  sprites.forEach((s, i) => { metas.set(s.m, i * F); dims[i * 2] = s.w; dims[i * 2 + 1] = s.h; px.set(s.img, o); o += s.img.length; });
  return { n, F, metas, dims, px };
}
/** `views`: the pixels are views of the one buffer (no second copy of the look: its sprites are only read and cloned whole, never transferred one by one). */
export function unpackLook({ n, F, metas, dims, px }, views = false) {
  const out = new Array(n); let o = 0;
  for ( let i = 0; i < n; i++ ) {
    const w = dims[i * 2], h = dims[i * 2 + 1], len = w * h * 4;
    out[i] = { m: metas.slice(i * F, (i + 1) * F), w, h, img: views ? px.subarray(o, o + len) : px.slice(o, o + len) };
    o += len;
  }
  return out;
}

