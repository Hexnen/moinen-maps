/**
 * A tiny PNG codec for the destruction sheet (RGBA, 8 bit), in plain JS on top of CompressionStream / DecompressionStream (zlib),
 * so it runs in a worker and never goes through a 2D canvas: a canvas premultiplies alpha, which changes the half-transparent
 * shadow pixels on the way, and its encoder took about a second on the page. Encode -> decode gives back exactly the same bytes,
 * so the GM (who shows the raw bake) and the players (who show the decoded file) see identical pixels.
 */
const CRC = (() => { const t = new Uint32Array(256); for ( let n = 0; n < 256; n++ ) { let c = n; for ( let k = 0; k < 8; k++ ) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes, start, end, c = 0xFFFFFFFF) { for ( let i = start; i < end; i++ ) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return c; }

async function pipe(data, stream) {
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer());
}

/** RGBA (w*h*4) -> PNG bytes (Uint8Array). Filter 0 on every row, one IDAT. */
export async function encodePng(w, h, rgba) {
  const stride = w * 4 + 1, raw = new Uint8Array(stride * h);
  for ( let y = 0; y < h; y++ ) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * stride + 1);
  const z = await pipe(raw, new CompressionStream("deflate"));
  const out = new Uint8Array(8 + 25 + 12 + z.length + 12);
  const dv = new DataView(out.buffer);
  out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  let p = 8;
  const chunk = (type, len, fill) => {
    dv.setUint32(p, len); for ( let k = 0; k < 4; k++ ) out[p + 4 + k] = type.charCodeAt(k);
    fill(p + 8);
    dv.setUint32(p + 8 + len, (crc32(out, p + 4, p + 8 + len) ^ 0xFFFFFFFF) >>> 0);
    p += 12 + len;
  };
  chunk("IHDR", 13, (o) => { dv.setUint32(o, w); dv.setUint32(o + 4, h); out.set([8, 6, 0, 0, 0], o + 8); });
  chunk("IDAT", z.length, (o) => out.set(z, o));
  chunk("IEND", 0, () => {});
  return out;
}

/** PNG bytes -> { w, h, rgba: Uint8ClampedArray } (8-bit RGBA or RGB, no interlace; every filter type). */
export async function decodePng(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8, w = 0, h = 0, ct = 6, idat = [], len = 0;
  while ( p + 8 <= b.length ) {
    const n = dv.getUint32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if ( type === "IHDR" ) {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); ct = b[p + 17];
      if ( b[p + 16] !== 8 || b[p + 20] !== 0 || (ct !== 6 && ct !== 2) ) throw new Error("unsupported PNG");
    } else if ( type === "IDAT" ) { idat.push(b.subarray(p + 8, p + 8 + n)); len += n; }
    else if ( type === "IEND" ) break;
    p += 12 + n;
  }
  const z = new Uint8Array(len); let o = 0; for ( const c of idat ) { z.set(c, o); o += c.length; }
  const raw = await pipe(z, new DecompressionStream("deflate"));
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp;
  const cur = new Uint8Array(stride), prev = new Uint8Array(stride), rgba = new Uint8ClampedArray(w * h * 4);
  for ( let y = 0; y < h; y++ ) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1;
    for ( let i = 0; i < stride; i++ ) {
      const x = raw[src + i], a = i >= bpp ? cur[i - bpp] : 0, up = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch ( f ) {
        case 1: v = x + a; break;
        case 2: v = x + up; break;
        case 3: v = x + ((a + up) >> 1); break;
        case 4: { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); break; }
        default: v = x;
      }
      cur[i] = v & 255;
    }
    if ( bpp === 4 ) rgba.set(cur, y * w * 4);
    else for ( let x = 0; x < w; x++ ) { const q = (y * w + x) * 4; rgba[q] = cur[x * 3]; rgba[q + 1] = cur[x * 3 + 1]; rgba[q + 2] = cur[x * 3 + 2]; rgba[q + 3] = 255; }
    prev.set(cur);
  }
  return { w, h, rgba };
}
