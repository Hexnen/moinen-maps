/**
 * The chunk codec: how baked water and destruction travel from the GM to the players in small, immutable, content-addressed files.
 * Pure code (no DOM, no Foundry): it runs in the codec worker, on the page and in node (the tests).
 *
 * FILE: a valid 8-bit greyscale PNG (so Foundry accepts the upload and may overwrite it, see the GC) whose pixels are our payload,
 * 4096 bytes per row, filter 0. Nothing ever decodes it as an image: the bytes are inflated with DecompressionStream("deflate"),
 * which every browser has, so no canvas, no premultiplied alpha, no colour management can change a bit.
 *
 * PAYLOAD: "MM", kind, version, body length (u32 LE), body. The chunk id is a 64-bit hash of the payload (not of the deflated bytes,
 * which depend on the browser's zlib), so the same content has the same name on every GM's client.
 *
 *   kind 1  WATER TILE   all frames of one 128 x 128 art-pixel tile (aligned to the scene's art grid, not to the bake's box, so a
 *                        grown box does not shift every tile). Level bytes stored pixel-major (a pixel's frames side by side: a loop
 *                        barely changes, so the deflate sees long repeats); "sparse" mode keeps one byte for a pixel that never
 *                        changes (255 marks the ones that do, followed by their frames).
 *   kind 2  DESTRUCTION OBJECT   every sprite of one brush stroke (its areas: base, cover, shards) with their placement rows. Covers
 *                        (pure 0/255 masks) are packed as bits, other sprites as an alpha plane plus the RGB of the pixels that are
 *                        not fully transparent; anything that does not fit those shapes is kept raw. The sheet position and the
 *                        stroke index are zeroed: a chunk does not change when other strokes change.
 */

import { pack as shellPack } from "../destruction/atlas-layout.mjs";

export const KIND_WATER = 1, KIND_OBJECT = 2;
const VERSION = 1, ROW = 4096;
/** Water tiles: art pixels per side. */
export const TILE = 128;

/* ---------------------------------------------------------------- deflate, hashing */

async function pipe(data, stream) {
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer());
}
export const deflate = (d) => pipe(d, new CompressionStream("deflate"));
export const inflate = (d) => pipe(d, new DecompressionStream("deflate"));

/** A 64-bit hash (two 32-bit lanes) as 14 base-36 characters. */
export function hash64(b) {
  let h1 = 0x811c9dc5, h2 = 0x9747b28c ^ b.length;
  for ( let i = 0; i < b.length; i++ ) {
    const v = b[i];
    h1 = Math.imul(h1 ^ v, 16777619);
    h2 = Math.imul(h2 ^ v, 0x5bd1e995); h2 ^= h2 >>> 15;
  }
  h2 = Math.imul(h2 ^ (h2 >>> 13), 0x85ebca6b); h2 ^= h2 >>> 16;
  return (h1 >>> 0).toString(36).padStart(7, "0") + (h2 >>> 0).toString(36).padStart(7, "0");
}

/** FNV-1a of a string, base 36 (keys and signatures). */
export function hashStr(s, h = 2166136261) {
  for ( let i = 0; i < s.length; i++ ) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/* ---------------------------------------------------------------- the PNG container */

const CRC = (() => { const t = new Uint32Array(256); for ( let n = 0; n < 256; n++ ) { let c = n; for ( let k = 0; k < 8; k++ ) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes, start, end) { let c = 0xFFFFFFFF; for ( let i = start; i < end; i++ ) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/** Payload -> PNG bytes. */
export async function wrap(payload) {
  const len = payload.length, w = Math.max(1, Math.min(ROW, len)), h = Math.max(1, Math.ceil(len / w));
  const raw = new Uint8Array((w + 1) * h);
  for ( let y = 0; y < h; y++ ) raw.set(payload.subarray(y * w, Math.min(len, (y + 1) * w)), y * (w + 1) + 1);
  const z = await deflate(raw);
  const out = new Uint8Array(8 + 25 + 12 + z.length + 12), dv = new DataView(out.buffer);
  out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  let p = 8;
  const chunk = (type, len2, fill) => {
    dv.setUint32(p, len2); for ( let k = 0; k < 4; k++ ) out[p + 4 + k] = type.charCodeAt(k);
    fill(p + 8);
    dv.setUint32(p + 8 + len2, crc32(out, p + 4, p + 8 + len2));
    p += 12 + len2;
  };
  chunk("IHDR", 13, (o) => { dv.setUint32(o, w); dv.setUint32(o + 4, h); out.set([8, 0, 0, 0, 0], o + 8); });
  chunk("IDAT", z.length, (o) => out.set(z, o));
  chunk("IEND", 0, () => {});
  return out;
}

/** PNG bytes -> payload (header checked), or throws. */
export async function unwrap(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if ( b.length < 57 || b[0] !== 137 || b[1] !== 80 || b[2] !== 78 || b[3] !== 71 ) throw new Error("not a chunk");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8, w = 0, h = 0;
  const idat = []; let zl = 0;
  while ( p + 8 <= b.length ) {
    const n = dv.getUint32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if ( p + 12 + n > b.length ) throw new Error("truncated chunk");
    if ( type === "IHDR" ) {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12);
      if ( b[p + 16] !== 8 || b[p + 17] !== 0 || b[p + 20] !== 0 ) throw new Error("not a chunk");
    } else if ( type === "IDAT" ) { idat.push(b.subarray(p + 8, p + 8 + n)); zl += n; }
    else if ( type === "IEND" ) break;
    p += 12 + n;
  }
  if ( !w || !h || w > ROW ) throw new Error("not a chunk");
  // a damaged header must not make the inflate allocate without bound (a stroke's chunk is a few hundred kB; 64 MB is far above)
  if ( (w + 1) * h > 64 * 1048576 ) throw new Error("chunk too large");
  const z = new Uint8Array(zl); let o = 0; for ( const c of idat ) { z.set(c, o); o += c.length; }
  const raw = await inflate(z);
  if ( raw.length !== (w + 1) * h ) throw new Error("bad chunk size");
  const out = new Uint8Array(w * h);
  for ( let y = 0; y < h; y++ ) {
    if ( raw[y * (w + 1)] !== 0 ) throw new Error("bad chunk filter");
    out.set(raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1)), y * w);
  }
  if ( out[0] !== 77 || out[1] !== 77 || out[3] !== VERSION ) throw new Error("not a chunk");
  const len = new DataView(out.buffer).getUint32(4, true);
  if ( 8 + len > out.length ) throw new Error("bad chunk length");
  return out.subarray(0, 8 + len);
}

/** The kind of a payload. */
export const kindOf = (payload) => payload[2];

function header(kind, bodyLen) {
  const p = new Uint8Array(8 + bodyLen);
  p[0] = 77; p[1] = 77; p[2] = kind; p[3] = VERSION;
  new DataView(p.buffer).setUint32(4, bodyLen, true);
  return p;
}

/* ---------------------------------------------------------------- water tiles */

/**
 * The tiles of a bake's box: [{ tx, ty, x0, y0, w, h }] (x0, y0 box-relative; tx, ty on the scene's art grid). `box` = { x0, y0, w, h }.
 */
export function waterTiles(box, T = TILE) {
  const out = [];
  for ( let ty = Math.floor(box.y0 / T); ty * T < box.y0 + box.h; ty++ ) {
    for ( let tx = Math.floor(box.x0 / T); tx * T < box.x0 + box.w; tx++ ) {
      const x0 = Math.max(0, tx * T - box.x0), y0 = Math.max(0, ty * T - box.y0);
      const x1 = Math.min(box.w, (tx + 1) * T - box.x0), y1 = Math.min(box.h, (ty + 1) * T - box.y0);
      out.push({ tx, ty, x0, y0, w: x1 - x0, h: y1 - y0 });
    }
  }
  return out;
}

/** One tile of `frames` (each box.w * box.h level bytes) -> payload, or null when the tile is empty (zero in every frame). */
export function packWaterTile(frames, box, t) {
  const n = frames.length, BW = box.w, N = t.w * t.h;
  let any = 0, has255 = false, vary = 0;
  for ( let y = 0; y < t.h; y++ ) {
    const row = (t.y0 + y) * BW + t.x0;
    for ( let x = 0; x < t.w; x++ ) {
      const i = row + x, v0 = frames[0][i];
      let changes = false;
      for ( let f = 0; f < n; f++ ) { const v = frames[f][i]; any |= v; if ( v === 255 ) has255 = true; if ( v !== v0 ) changes = true; }
      if ( changes ) vary++;
    }
  }
  if ( !any ) return null;
  const sparse = !has255;
  const body = 16 + (sparse ? N + vary * n : N * n);
  const p = header(KIND_WATER, body), dv = new DataView(p.buffer);
  dv.setInt32(8, box.x0 + t.x0, true); dv.setInt32(12, box.y0 + t.y0, true); dv.setUint16(16, t.w, true); dv.setUint16(18, t.h, true);
  dv.setUint16(20, n, true); p[22] = sparse ? 1 : 0; p[23] = 0;
  let o = 24, s = 24 + N;
  for ( let y = 0; y < t.h; y++ ) {
    const row = (t.y0 + y) * BW + t.x0;
    for ( let x = 0; x < t.w; x++ ) {
      const i = row + x;
      if ( sparse ) {
        const v0 = frames[0][i];
        let changes = false;
        for ( let f = 1; f < n; f++ ) if ( frames[f][i] !== v0 ) { changes = true; break; }
        if ( !changes ) { p[o++] = v0; continue; }
        p[o++] = 255;
        for ( let f = 0; f < n; f++ ) p[s++] = frames[f][i];
      } else for ( let f = 0; f < n; f++ ) p[o++] = frames[f][i];
    }
  }
  return p;
}

/** A water tile payload -> { ax, ay (art px), w, h, n, levels: [Uint8Array(w*h) per frame] }. */
export function unpackWaterTile(p) {
  if ( kindOf(p) !== KIND_WATER ) throw new Error("not a water tile");
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const ax = dv.getInt32(8, true), ay = dv.getInt32(12, true), w = dv.getUint16(16, true), h = dv.getUint16(18, true), n = dv.getUint16(20, true), sparse = p[22] === 1;
  const N = w * h, levels = Array.from({ length: n }, () => new Uint8Array(N));
  let o = 24, s = 24 + N;
  for ( let i = 0; i < N; i++ ) {
    if ( sparse ) {
      const v = p[o++];
      if ( v !== 255 ) { if ( v ) for ( let f = 0; f < n; f++ ) levels[f][i] = v; continue; }
      for ( let f = 0; f < n; f++ ) levels[f][i] = p[s++];
    } else for ( let f = 0; f < n; f++ ) levels[f][i] = p[o++];
  }
  if ( (sparse ? s : o) !== p.length ) throw new Error("bad water tile");
  return { ax, ay, w, h, n, levels };
}

/** Lay a decoded tile into full frames of a box. */
export function placeWaterTile(tile, frames, box) {
  const x0 = tile.ax - box.x0, y0 = tile.ay - box.y0;
  if ( x0 < 0 || y0 < 0 || x0 + tile.w > box.w || y0 + tile.h > box.h || tile.n !== frames.length ) throw new Error("tile outside the box");
  for ( let f = 0; f < tile.n; f++ ) {
    const src = tile.levels[f], dst = frames[f];
    for ( let y = 0; y < tile.h; y++ ) dst.set(src.subarray(y * tile.w, (y + 1) * tile.w), (y0 + y) * box.w + x0);
  }
}

/* ---------------------------------------------------------------- destruction objects */

/**
 * A baked sheet -> the sprites of every stroke: Map(stroke index -> [{ m: Int16Array(F), w, h, img: RGBA }]), in sheet order. A
 * stroke's rows start at its base rows (type 0, field 16 = stroke index); the sheet position, the stroke index and the area index
 * of the shards are zeroed (they are set again when a sheet is assembled).
 */
export function splitSheet(rgba, W, meta, F) {
  const out = new Map(), n = meta.length / F;
  let cur = null;
  for ( let k = 0; k < n; k++ ) {
    const o = k * F, m = meta.slice(o, o + F);
    if ( m[0] === 0 ) {
      const index = m[16];
      if ( !out.has(index) ) out.set(index, []);
      cur = out.get(index);
      m[16] = 0;
    } else if ( m[0] === 1 ) m[11] &= 15;
    if ( !cur ) continue;
    const sx = m[1], sy = m[2], w = m[3], h = m[4];
    m[1] = 0; m[2] = 0;
    const img = new Uint8Array(w * h * 4);
    for ( let y = 0; y < h; y++ ) img.set(rgba.subarray(((sy + y) * W + sx) * 4, ((sy + y) * W + sx + w) * 4), y * w * 4);
    cur.push({ m, w, h, img });
  }
  return out;
}

/** How a sprite is stored: 2 bits (a 0/255 mask), 1 alpha + RGB where alpha > 0, 0 raw RGBA. */
function modeOf(s) {
  const d = s.img;
  if ( s.m[0] === 2 ) {
    let ok = true;
    for ( let i = 0; i < d.length && ok; i += 4 ) { const a = d[i + 3]; ok = a === 0 ? !(d[i] | d[i + 1] | d[i + 2]) : (a === 255 && d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255); }
    if ( ok ) return 2;
  }
  for ( let i = 0; i < d.length; i += 4 ) if ( d[i + 3] === 0 && (d[i] | d[i + 1] | d[i + 2]) ) return 0;
  return 1;
}

/** One stroke's sprites -> payload. */
export function packObject(sprites, F) {
  const n = sprites.length, modes = sprites.map(modeOf);
  let bits = 0, alpha = 0, rgb = 0, raw = 0;
  sprites.forEach((s, k) => {
    const N = s.w * s.h;
    if ( modes[k] === 2 ) bits += Math.ceil(N / 8);
    else if ( modes[k] === 1 ) { alpha += N; for ( let i = 3; i < s.img.length; i += 4 ) if ( s.img[i] ) rgb += 3; }
    else raw += N * 4;
  });
  const head = 5 + n * F * 2 + n;
  const p = header(KIND_OBJECT, head + bits + alpha + rgb + raw), dv = new DataView(p.buffer);
  p[8] = F; dv.setUint32(9, n, true);
  let o = 13;
  for ( const s of sprites ) for ( let f = 0; f < F; f++ ) { dv.setInt16(o, s.m[f], true); o += 2; }
  for ( const md of modes ) p[o++] = md;
  let ob = o, oa = ob + bits, oc = oa + alpha, or = oc + rgb;
  sprites.forEach((s, k) => {
    const d = s.img, N = s.w * s.h;
    if ( modes[k] === 2 ) { for ( let i = 0; i < N; i++ ) if ( d[i * 4 + 3] ) p[ob + (i >> 3)] |= 1 << (i & 7); ob += Math.ceil(N / 8); }
    else if ( modes[k] === 1 ) {
      for ( let i = 0; i < N; i++ ) { const a = d[i * 4 + 3]; p[oa++] = a; if ( a ) { p[oc++] = d[i * 4]; p[oc++] = d[i * 4 + 1]; p[oc++] = d[i * 4 + 2]; } }
    } else { p.set(d, or); or += d.length; }
  });
  return p;
}

/** A stroke payload -> { F, sprites: [{ m, w, h, img }] }. */
export function unpackObject(p) {
  if ( kindOf(p) !== KIND_OBJECT ) throw new Error("not a destruction chunk");
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const F = p[8], n = dv.getUint32(9, true);
  let o = 13;
  const sprites = [];
  for ( let k = 0; k < n; k++ ) {
    const m = new Int16Array(F);
    for ( let f = 0; f < F; f++ ) { m[f] = dv.getInt16(o, true); o += 2; }
    sprites.push({ m, w: m[3], h: m[4], img: new Uint8Array(m[3] * m[4] * 4) });
  }
  const modes = p.subarray(o, o + n); o += n;
  let bits = 0, alpha = 0;
  sprites.forEach((s, k) => { const N = s.w * s.h; if ( modes[k] === 2 ) bits += Math.ceil(N / 8); else if ( modes[k] === 1 ) alpha += N; });
  let ob = o, oa = ob + bits, oc = oa + alpha;
  // the RGB plane's length is only known after the alpha plane: count it first
  let rgb = 0; for ( let i = oa; i < oa + alpha; i++ ) if ( p[i] ) rgb += 3;
  let or = oc + rgb;
  sprites.forEach((s, k) => {
    const d = s.img, N = s.w * s.h;
    if ( modes[k] === 2 ) { for ( let i = 0; i < N; i++ ) if ( p[ob + (i >> 3)] & (1 << (i & 7)) ) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = d[i * 4 + 3] = 255; } ob += Math.ceil(N / 8); }
    else if ( modes[k] === 1 ) {
      for ( let i = 0; i < N; i++ ) { const a = p[oa++]; if ( a ) { d[i * 4] = p[oc++]; d[i * 4 + 1] = p[oc++]; d[i * 4 + 2] = p[oc++]; d[i * 4 + 3] = a; } }
    } else if ( modes[k] === 0 ) { d.set(p.subarray(or, or + d.length)); or += d.length; }
    else throw new Error("bad sprite mode");
  });
  if ( or !== p.length ) throw new Error("bad destruction chunk");
  return { F, sprites };
}

/**
 * PERF (hydrating an area's atlas): the display's atlas of an area, laid out as display.build laid it (its sprites: [base, its shards
 * in order, cover?, light?] at `pos` in a W x H sheet), straight from a decoded chunk's sprites - in the codec worker, so the page
 * receives the finished buffer and copies nothing. `specs`: [{ hash, W, H, pos: [{x, y}], sizes: [[w, h]] }]. -> [{ hash, data }]
 * (data null: the area is not in the chunk, or its sprites are not the ones the layout was made for).
 */
export function packAreaAtlases(sprites, specs) {
  const areas = new Map();
  let cur = null;
  for ( const s of sprites ) {
    if ( s.m[0] === 0 ) { cur = { base: s, pieces: [], cover: null, light: null }; areas.set(((s.m[12] & 0xffff) | ((s.m[13] & 0xffff) << 16)) >>> 0, cur); continue; }
    if ( !cur ) continue;
    if ( s.m[0] === 2 ) cur.cover = s; else if ( s.m[0] === 3 ) cur.light = s; else cur.pieces.push(s);
  }
  return specs.map((sp) => {
    const a = areas.get(sp.hash);
    const list = a ? [a.base, ...a.pieces, ...(a.cover ? [a.cover] : []), ...(a.light ? [a.light] : [])] : [];
    if ( !list.length || list.length !== sp.sizes.length ) return { hash: sp.hash, data: null };
    const buf = new Uint8Array(sp.W * sp.H * 4);
    for ( let i = 0; i < list.length; i++ ) {
      const s = list[i], [w, h] = sp.sizes[i], p = sp.pos[i];
      if ( !s.img || s.w !== w || s.h !== h ) return { hash: sp.hash, data: null };
      for ( let y = 0; y < h; y++ ) buf.set(s.img.subarray(y * w * 4, (y + 1) * w * 4), ((p.y + y) * sp.W + p.x) * 4);
    }
    return { hash: sp.hash, data: buf };
  });
}

/**
 * PERF (a shell's area, Detonate): the area a composite shell stands for, built in the codec worker - laid out with the display's own
 * layout (atlas-layout.mjs pack) and its atlas packed, straight from a decoded chunk's sprites; the page only makes the area's sprites from
 * it (display.build `packed`, swapShell). `specs`: [{ hash, index (the stroke's index in the scene) }]; `square`: CONFIG.moinenMaps.squareAtlas.
 * -> [{ hash, data (the atlas), W, H, pos, sizes, meta (the area's rows, Int16Array of F fields each: sheet position = the layout) }]
 * (data null: the area is not in the chunk).
 */
export function packShellAreas(sprites, specs, square = false) {
  const areas = new Map();
  let cur = null;
  for ( const s of sprites ) {
    if ( s.m[0] === 0 ) { cur = { base: s, pieces: [], cover: null, light: null }; areas.set(((s.m[12] & 0xffff) | ((s.m[13] & 0xffff) << 16)) >>> 0, cur); continue; }
    if ( !cur ) continue;
    if ( s.m[0] === 2 ) cur.cover = s; else if ( s.m[0] === 3 ) cur.light = s; else cur.pieces.push(s);
  }
  return specs.map((sp) => {
    const a = areas.get(sp.hash);
    if ( !a ) return { hash: sp.hash, data: null };
    const list = [a.base, ...a.pieces, ...(a.cover ? [a.cover] : []), ...(a.light ? [a.light] : [])];
    if ( list.some((s) => !s.img) ) return { hash: sp.hash, data: null };
    const pk = shellPack(list.map((s) => ({ w: s.w, h: s.h })), square), F = a.base.m.length;
    const data = new Uint8Array(pk.W * pk.H * 4), meta = new Int16Array(list.length * F);
    list.forEach((s, i) => {
      const p = pk.pos[i];
      for ( let y = 0; y < s.h; y++ ) data.set(s.img.subarray(y * s.w * 4, (y + 1) * s.w * 4), ((p.y + y) * pk.W + p.x) * 4);
      meta.set(s.m, i * F); meta[i * F + 1] = p.x; meta[i * F + 2] = p.y;
    });
    meta[16] = Math.min(32767, sp.index | 0);
    return { hash: sp.hash, data, W: pk.W, H: pk.H, pos: pk.pos, sizes: list.map((s) => [s.w, s.h]), meta };
  });
}

/**
 * Strokes -> one sheet as the display takes it: `recs` [{ index (stroke index), sprites }] in stroke order. The placement rows get
 * their sheet position, the stroke index (base rows) and the area index (shards: a stagger hint, counted over the areas in order,
 * as the bake does). `skip(hash)`: an area whose pixels are not needed (the display holds it already): its rows are kept, its
 * pixels are not copied. -> { data, w, h, meta }.
 */
export function assembleSheet(recs, F, skip = null) {
  const rows = [], need = [];
  let area = -1, skipping = false;
  for ( const r of recs ) {
    for ( const s of r.sprites ) {
      const m = s.m.slice();
      if ( m[0] === 0 ) {
        area++;
        m[16] = Math.min(32767, r.index);
        skipping = !!skip?.(((m[12] & 0xffff) | ((m[13] & 0xffff) << 16)) >>> 0);
      } else if ( m[0] === 1 ) m[11] = (Math.min(Math.max(0, area), 2047) << 4) | (m[11] & 15);
      rows.push(m);
      if ( !skipping ) need.push({ m, s });
    }
  }
  const pk = shelfPack(need.map((q) => q.s));
  const data = new Uint8ClampedArray(pk.W * pk.H * 4);
  need.forEach((q, k) => {
    const p = pk.pos[k], s = q.s;
    q.m[1] = p.x; q.m[2] = p.y;
    for ( let y = 0; y < s.h; y++ ) data.set(s.img.subarray(y * s.w * 4, (y + 1) * s.w * 4), ((p.y + y) * pk.W + p.x) * 4);
  });
  const meta = new Int16Array(rows.length * F);
  rows.forEach((m, k) => meta.set(m, k * F));
  return { data, w: pk.W, h: pk.H, meta };
}

/** Shelf packing, tallest first, one pixel of gutter. */
function shelfPack(rects) {
  const area = rects.reduce((a, r) => a + (r.w + 1) * (r.h + 1), 0);
  let W = 256; while ( W * W < area * 1.25 && W < 4096 ) W *= 2;
  for ( const r of rects ) if ( r.w + 1 > W ) W = r.w + 1;   // (no spread: a big bake has more sprites than a call takes arguments)
  const order = rects.map((r, i) => i).sort((a, b) => rects[b].h - rects[a].h || rects[b].w - rects[a].w);
  const pos = new Array(rects.length);
  let x = 0, y = 0, rowH = 0;
  for ( const i of order ) {
    const r = rects[i];
    if ( x + r.w > W ) { x = 0; y += rowH + 1; rowH = 0; }
    pos[i] = { x, y }; x += r.w + 1; rowH = Math.max(rowH, r.h);
  }
  return { W, H: Math.max(1, y + rowH + 1), pos };
}

/** FNV-1a over every sprite of the strokes, in order (a determinism check across clients). */
export function recordsHash(recs) {
  let h = 2166136261;
  for ( const r of recs ) for ( const s of r.sprites ) {
    for ( let f = 0; f < s.m.length; f++ ) if ( f !== 1 && f !== 2 ) h = Math.imul(h ^ (s.m[f] & 0xffff), 16777619);
    for ( let i = 0; i < s.img.length; i++ ) h = Math.imul(h ^ s.img[i], 16777619);
  }
  return (h >>> 0).toString(16);
}

/* ---------------------------------------------------------------- settled composite tiles (composite.mjs) */

/**
 * kind 3  COMPOSITE TILE  one tile of a band of the destruction layer's settled look as the static cache draws it (static-cache.mjs):
 *                         texels exactly as the GPU left them in the band's render texture (premultiplied RGBA), so a client that
 *                         uploads them unchanged (alpha mode PMA) samples the same texels as its own band would. Header: scene x, y
 *                         (int32), texel w, h (u16), texels per scene px x 1000 (u16), mode (u8: 1 alpha plane + RGB where alpha > 0,
 *                         0 raw RGBA - a texel with alpha 0 and colour cannot be premultiplied, kept raw just in case).
 * kind 4  COMPOSITE INDEX the composite's description (JSON: strokes, their areas, the bands' members), small.
 */
export const KIND_TILE = 3, KIND_INDEX = 4;

/** { x, y, w, h, res, data (w*h*4 premultiplied RGBA) } -> payload. */
export function packTile(t) {
  const d = t.data, N = t.w * t.h;
  let raw = false, vis = 0;
  for ( let i = 0; i < N; i++ ) { const a = d[i * 4 + 3]; if ( a ) vis++; else if ( d[i * 4] | d[i * 4 + 1] | d[i * 4 + 2] ) { raw = true; break; } }
  const body = 16 + (raw ? N * 4 : N + vis * 3);
  const p = header(KIND_TILE, body), dv = new DataView(p.buffer);
  dv.setInt32(8, t.x, true); dv.setInt32(12, t.y, true); dv.setUint16(16, t.w, true); dv.setUint16(18, t.h, true);
  dv.setUint16(20, Math.round(t.res * 1000), true); p[22] = raw ? 0 : 1; p[23] = 0;
  if ( raw ) p.set(d.subarray(0, N * 4), 24);
  else {
    let oa = 24, oc = 24 + N;
    for ( let i = 0; i < N; i++ ) { const a = d[i * 4 + 3]; p[oa++] = a; if ( a ) { p[oc++] = d[i * 4]; p[oc++] = d[i * 4 + 1]; p[oc++] = d[i * 4 + 2]; } }
  }
  return p;
}

/** A tile payload -> { x, y, w, h, res, data: Uint8Array (w*h*4) }. */
export function unpackTile(p) {
  if ( kindOf(p) !== KIND_TILE ) throw new Error("not a composite tile");
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const x = dv.getInt32(8, true), y = dv.getInt32(12, true), w = dv.getUint16(16, true), h = dv.getUint16(18, true), res = dv.getUint16(20, true) / 1000;
  const N = w * h, data = new Uint8Array(N * 4);
  if ( p[22] === 0 ) { if ( p.length !== 24 + N * 4 ) throw new Error("bad tile"); data.set(p.subarray(24)); }
  else {
    let oa = 24, oc = 24 + N;
    for ( let i = 0; i < N; i++ ) { const a = p[oa++]; if ( a ) { data[i * 4] = p[oc++]; data[i * 4 + 1] = p[oc++]; data[i * 4 + 2] = p[oc++]; data[i * 4 + 3] = a; } }
    if ( oc !== p.length ) throw new Error("bad tile");
  }
  return { x, y, w, h, res, data };
}

/** A JSON-able object -> index payload, and back. */
export function packIndex(o) {
  const b = new TextEncoder().encode(JSON.stringify(o)), p = header(KIND_INDEX, b.length);
  p.set(b, 8);
  return p;
}
export function unpackIndex(p) {
  if ( kindOf(p) !== KIND_INDEX ) throw new Error("not a composite index");
  return JSON.parse(new TextDecoder().decode(p.subarray(8)));
}

/**
 * A band's key across clients: its level, density, sampling, mipmaps and its members' area hashes in order (the runtime key of the
 * cache names containers instead). Pure.
 */
export const bandKey = (L, res, smp, mips, hashes) => `${L}|${res}|${smp}|${mips ? 1 : 0}|${hashString(hashes.join("."))}:${hashes.length}`;
const hashString = (s) => { let h1 = 0x811c9dc5, h2 = 0x9747b28c; for ( let i = 0; i < s.length; i++ ) { const v = s.charCodeAt(i); h1 = Math.imul(h1 ^ v, 16777619); h2 = Math.imul(h2 ^ v, 0x5bd1e995); h2 ^= h2 >>> 15; } return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36); };

/**
 * The tiles of a new composite against the last one: which tile ids are new (to upload) and which are kept. `prev`/`next`:
 * [{ key, tiles: [{ x, y, w, h, id }] }]. Pure. -> { upload: [id], kept: [id], dropped: [id] }.
 */
export function diffComposite(prev, next) {
  const old = new Set((prev ?? []).flatMap((b) => b.tiles.map((t) => t.id)));
  const now = new Set(next.flatMap((b) => b.tiles.map((t) => t.id)));
  return { upload: [...now].filter((id) => !old.has(id)), kept: [...now].filter((id) => old.has(id)), dropped: [...old].filter((id) => !now.has(id)) };
}

/* ---------------------------------------------------------------- bundles: many small chunks, one file */

/**
 * kind 5  BUNDLE  small chunks that a scene's load needs together (a hundred water tiles of 1-8 kB each, the composite's index and small
 *                 tiles, small strokes) in ONE file, so a load makes a handful of requests instead of dozens. Body: count (u32), then per
 *                 member: id length (u8), the id (ASCII, "w..." / "d..." / "k..." / "x..."), payload length (u32), the member's own payload
 *                 (the bytes its single file holds inside the PNG, header and all). Every member is still checked against its own id
 *                 (a hash of its payload) when it is decoded, and every member also stays on the server as a single file of its own:
 *                 a bundle that cannot be had only costs the requests it saved. The bundle's id is a hash of its payload, members sorted by id.
 */
export const KIND_BUNDLE = 5;
export function packBundle(parts) {
  const enc = new TextEncoder();
  let n = 4;
  const ids = parts.map((q) => enc.encode(q.id));
  parts.forEach((q, i) => { n += 1 + ids[i].length + 4 + q.payload.length; });
  const p = header(KIND_BUNDLE, n), dv = new DataView(p.buffer);
  dv.setUint32(8, parts.length, true);
  let o = 12;
  parts.forEach((q, i) => {
    p[o++] = ids[i].length; p.set(ids[i], o); o += ids[i].length;
    dv.setUint32(o, q.payload.length, true); o += 4;
    p.set(q.payload, o); o += q.payload.length;
  });
  return p;
}
export function unpackBundle(p) {
  if ( kindOf(p) !== KIND_BUNDLE ) throw new Error("not a bundle");
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength), dec = new TextDecoder(), out = [];
  const n = dv.getUint32(8, true);
  let o = 12;
  for ( let i = 0; i < n; i++ ) {
    if ( o + 1 > p.length ) throw new Error("bad bundle");
    const il = p[o++];
    if ( o + il + 4 > p.length ) throw new Error("bad bundle");
    const id = dec.decode(p.subarray(o, o + il)); o += il;
    const len = dv.getUint32(o, true); o += 4;
    if ( o + len > p.length ) throw new Error("bad bundle");
    out.push({ id, payload: p.subarray(o, o + len) }); o += len;
  }
  if ( o !== p.length ) throw new Error("bad bundle");
  return out;
}

/** One payload decoded for the page (adds the buffers to move to `transfer`). */
function decodePayload(p, transfer) {
  const k = kindOf(p);
  if ( k === KIND_TILE ) { const t = unpackTile(p); transfer.push(t.data.buffer); return { tile: t }; }
  if ( k === KIND_INDEX ) return { index: unpackIndex(p) };
  if ( k === KIND_WATER ) { const t = unpackWaterTile(p); transfer.push(...t.levels.map((l) => l.buffer)); return t; }
  if ( k === KIND_OBJECT ) { const o = unpackObject(p); for ( const s of o.sprites ) transfer.push(s.img.buffer); return o; }
  throw new Error("unknown chunk kind");
}

/**
 * Which bundle a chunk belongs to: a chunk of kind `kind` ("w", "d", "k", "x" - the first letter of its id) goes into one of `ceil(n / per)`
 * buckets by a hash of its id, so a changed chunk changes ONE bundle of its kind and the others keep their ids. Pure.
 * -> Map(bucket label -> [ids sorted]).
 */
export const BUNDLE_PER = { w: 96, d: 24, k: 8, x: 8 };
export function bundleBuckets(ids) {
  const byKind = new Map();
  for ( const id of new Set(ids) ) { if ( !id || !(id[0] in BUNDLE_PER) ) continue; if ( !byKind.has(id[0]) ) byKind.set(id[0], []); byKind.get(id[0]).push(id); }
  const out = new Map();
  for ( const [k, list] of byKind ) {
    const nb = Math.max(1, Math.ceil(list.length / BUNDLE_PER[k]));
    for ( const id of list ) {
      // (composite index + tiles share their buckets: the index is one file, a tile or two ride with it)
      const label = `${k === "x" ? "k" : k}${nb === 1 ? 0 : parseInt(hashStr(id), 36) % nb}`;
      if ( !out.has(label) ) out.set(label, []);
      out.get(label).push(id);
    }
  }
  for ( const l of out.values() ) l.sort();
  return out;
}

/**
 * LARGE bundles (round 3): strokes above the small-bundle limit (a Rebake'd look is ~180 kB on average) ride together too, so the
 * read-ahead after the reveal is a few files of ~`cap` bytes instead of one request a stroke. `sizes`: Map id -> bytes. A chunk goes to
 * one of `ceil(total / cap)` buckets by a hash of its id (a changed chunk changes ONE bundle). Pure.
 */
export function largeBuckets(sizes, cap = 655360) {
  let total = 0;
  for ( const n of sizes.values() ) total += n;
  const nb = Math.max(1, Math.ceil(total / cap)), out = new Map();
  for ( const id of sizes.keys() ) {
    const label = `L${nb === 1 ? 0 : parseInt(hashStr(id), 36) % nb}`;
    if ( !out.has(label) ) out.set(label, []);
    out.get(label).push(id);
  }
  for ( const l of out.values() ) l.sort();
  return out;
}

/* ---------------------------------------------------------------- composite culling (runs in the codec worker) */

/** Texels of margin round a cleared one: the magnified edge smoothing (1) and the mip levels down to zoom 1/4 (2^2 blocks, bilinear). */
export const MARGIN = 9;

/** Chebyshev distance (capped at `cap`) of every texel of the box to the nearest texel that is not set (outside the box: not set). */
function chebyshev(m, W, H, x0, y0, x1, y1, cap) {
  const d = new Uint8Array(W * H);
  const at = (x, y) => (x < x0 || y < y0 || x >= x1 || y >= y1 ? 0 : d[y * W + x]);
  for ( let y = y0; y < y1; y++ ) for ( let x = x0; x < x1; x++ ) {
    const i = y * W + x;
    d[i] = !m[i] ? 0 : Math.min(cap, 1 + Math.min(at(x - 1, y), at(x - 1, y - 1), at(x, y - 1), at(x + 1, y - 1)));
  }
  for ( let y = y1 - 1; y >= y0; y-- ) for ( let x = x1 - 1; x >= x0; x-- ) {
    const i = y * W + x; if ( !d[i] ) continue;
    d[i] = Math.min(d[i], 1 + Math.min(at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1)));
  }
  return d;
}

/**
 * CULLING (one texel per scene px only): a band's texels that the opaque texels of the bands ABOVE it hide - with a texel of margin all
 * round, so a magnified band's one pixel of edge smoothing never reaches a cleared texel - are cleared before they are published
 * (~half the bytes on a busy scene). A client uses such a band only while every band above it is still the composite's (Composite.plan).
 * Mip levels (zoomed out) of a cleared region differ where an upper band is not fully opaque at that level; at zoom >= 1 the picture is
 * the same. `all`: [{ L, x, y, w, h, data, fresh }] (fresh tiles are cleared in place; the others only hide). Runs in the codec worker
 * (composite.mjs publish): it held the page ~160 ms on a big scene.
 */
export function cull(all, margin = MARGIN) {
  const x0 = Math.min(...all.map((q) => q.x)), y0 = Math.min(...all.map((q) => q.y));
  const W = Math.max(...all.map((q) => q.x + q.w)) - x0, H = Math.max(...all.map((q) => q.y + q.h)) - y0;
  // HIDDEN: a texel whose 3x3 is opaque in ONE band above (two bands each covering a part do not: at their seams each is half
  // transparent where it smooths its own edge, and the band under them shows)
  const hide = new Uint8Array(W * H), cover = new Uint8Array(W * H);
  const levels = [...new Set(all.map((q) => q.L))].sort((a, b) => b - a);
  let cleared = 0;
  for ( const L of levels ) {
    const here = all.filter((q) => q.L === L);
    for ( const q of here ) if ( q.fresh ) {
      const d = q.data, ox = q.x - x0, oy = q.y - y0;
      for ( let y = 0; y < q.h; y++ ) {
        const hrow = (oy + y) * W + ox, drow = y * q.w * 4;
        for ( let x = 0; x < q.w; x++ ) {
          const i = drow + x * 4;
          if ( !d[i + 3] || hide[hrow + x] !== 1 ) continue;
          d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; cleared++;
        }
      }
    }
    cover.fill(0);
    let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
    for ( const q of here ) {
      const d = q.data, ox = q.x - x0, oy = q.y - y0;
      bx0 = Math.min(bx0, ox); by0 = Math.min(by0, oy); bx1 = Math.max(bx1, ox + q.w); by1 = Math.max(by1, oy + q.h);
      for ( let y = 0; y < q.h; y++ ) for ( let x = 0; x < q.w; x++ ) if ( d[(y * q.w + x) * 4 + 3] === 255 ) cover[(oy + y) * W + ox + x] = 1;
    }
    // (the square of `margin` texels round it opaque in this band: Chebyshev distance to its nearest non-opaque texel, two passes)
    const dist = chebyshev(cover, W, H, bx0, by0, bx1, by1, margin + 1);
    for ( let y = by0; y < by1; y++ ) for ( let x = bx0; x < bx1; x++ ) if ( dist[y * W + x] > margin ) hide[y * W + x] = 1;
  }
  return cleared;
}

/* ---------------------------------------------------------------- the worker's jobs */

/**
 * One job (the codec worker runs these; the page runs them inline only when no worker can start). -> { result, transfer }.
 *   { kind: "water", box, frames, known }   -> [{ tx, ty, id (0: empty tile), bytes (PNG; null when `known` has the id) }]
 *   { kind: "objects", objs: [{ key, sprites }], F } -> [{ key, id, bytes }]
 *   { kind: "decode", bytes, cid }           -> the decoded payload (water tile, or { F, sprites }); its hash must match the chunk id
 *   { kind: "rims", bytes, cid, areas }      -> a destruction chunk only: the dark rims of areas ([{ hash, cause, type }]), destruction/rim-job.mjs
 *   { kind: "decode", bytes, cid, pack }     -> a destruction chunk only: { atlases: packAreaAtlases(sprites, pack) } - the sprites stay here
 * (`id` is the worker's request number, never a chunk id)
 */
export async function work(m) {
  const transfer = [];
  if ( m.kind === "water" ) {
    const known = new Set(m.known ?? []), out = [];
    for ( const t of waterTiles(m.box) ) {
      const p = packWaterTile(m.frames, m.box, t);
      if ( !p ) { out.push({ tx: t.tx, ty: t.ty, id: 0, bytes: null }); continue; }
      const id = `w${hash64(p)}`, bytes = known.has(id) ? null : await wrap(p);
      if ( bytes ) transfer.push(bytes.buffer);
      out.push({ tx: t.tx, ty: t.ty, id, bytes });
    }
    return { result: out, transfer };
  }
  if ( m.kind === "objects" ) {
    const out = [];
    for ( const o of m.objs ) {
      const p = packObject(o.sprites, m.F), bytes = await wrap(p);
      transfer.push(bytes.buffer);
      out.push({ key: o.key, id: `d${hash64(p)}`, bytes });
    }
    return { result: out, transfer };
  }
  if ( m.kind === "tiles" ) {
    // composite tiles and the index: { tiles: [{ x, y, w, h, res, data, L }], index, hide?: [{ L, x, y, w, h, data }] } -> { tiles: [{ id, bytes }],
    // index: { id, bytes }, cleared }. `hide` (with `cull`): the bands' tiles the composite already holds - they only hide texels
    // under the bands above (cull), they are not packed. The cull runs HERE, in the worker (it held the page ~160 ms on a big scene).
    const known = new Set(m.known ?? []), tiles = [];
    let cleared = -1;
    if ( m.cull ) cleared = cull([...(m.hide ?? []), ...m.tiles.map((t) => Object.assign(t, { fresh: true }))]);
    for ( const t of m.tiles ) {
      const p = packTile(t), id = `k${hash64(p)}`, bytes = known.has(id) ? null : await wrap(p);
      if ( bytes ) transfer.push(bytes.buffer);
      tiles.push({ id, bytes });
    }
    const ip = packIndex(m.index), iid = `x${hash64(ip)}`, ib = await wrap(ip);
    transfer.push(ib.buffer);
    return { result: { tiles, index: { id: iid, bytes: ib }, cleared }, transfer };
  }
  if ( m.kind === "bundle" ) {
    // small chunks into one file: { members: [{ id, bytes (the chunk's PNG) }] } -> { id, bytes, ids (the members that went in) }
    const parts = [];
    for ( const q of m.members ) {
      try {
        const p = await unwrap(q.bytes);
        if ( String(q.id).slice(1) !== hash64(p) ) continue;                  // a damaged or foreign file never goes into a bundle
        parts.push({ id: q.id, payload: p });
      } catch { /* not a chunk */ }
    }
    parts.sort((a, b) => (a.id < b.id ? -1 : 1));                                // the same members always make the same bundle
    const bp = packBundle(parts), bytes = await wrap(bp);
    transfer.push(bytes.buffer);
    return { result: { id: `b${hash64(bp)}`, bytes, ids: parts.map((q) => q.id) }, transfer };
  }
  if ( m.kind === "decode" ) {
    const p = await unwrap(m.bytes);
    if ( m.cid && String(m.cid).slice(1) !== hash64(p) ) throw new Error("chunk content does not match its name");
    if ( kindOf(p) === KIND_BUNDLE ) {
      // a bundle: every member (or `only`) verified against its own name and decoded; -> { bundle: [{ id, result }] }
      const only = m.only ? new Set(m.only) : null, out = [];
      for ( const q of unpackBundle(p) ) {
        if ( only && !only.has(q.id) ) continue;
        if ( String(q.id).slice(1) !== hash64(q.payload) ) continue;          // (left out: the caller asks for it alone)
        const d = decodePayload(q.payload, transfer);
        out.push({ id: q.id, result: d });
      }
      return { result: { bundle: out }, transfer };
    }
    if ( m.pack ) {
      const o = unpackObject(p);
      const atlases = packAreaAtlases(o.sprites, m.pack);
      for ( const a of atlases ) if ( a.data ) transfer.push(a.data.buffer);
      return { result: { atlases }, transfer };
    }
    if ( m.shells ) {
      // a shell's areas (packShellAreas) and, in a dark scene, their rims in the same pass (rim-job.mjs)
      const o = unpackObject(p), shells = packShellAreas(o.sprites, m.shells, !!m.square);
      for ( const a of shells ) if ( a.data ) transfer.push(a.data.buffer, a.meta.buffer);
      let rims = null;
      if ( m.rims?.length ) {
        const { rimsOf } = await import("../destruction/rim-job.mjs");
        rims = await rimsOf(o.sprites, m.rims);
        for ( const r of rims ) if ( r.rim ) transfer.push(r.rim.A8.buffer);
      }
      return { result: { shells, rims }, transfer };
    }
    return { result: decodePayload(p, transfer), transfer };
  }
  if ( m.kind === "rims" ) {
    const p = await unwrap(m.bytes);
    if ( m.cid && String(m.cid).slice(1) !== hash64(p) ) throw new Error("chunk content does not match its name");
    const { rimsOf } = await import("../destruction/rim-job.mjs");
    const out = await rimsOf(unpackObject(p).sprites, m.areas);
    for ( const r of out ) if ( r.rim ) transfer.push(r.rim.A8.buffer);
    return { result: out, transfer };
  }
  if ( m.kind === "sigs" ) {
    // the strokes' full signatures (substrate.mjs fullSigs) off the page: { objs: [{ id, k, t, x0, y0, w, h, own, bytes }], P, K }
    const { fullSigs } = await import("../destruction/substrate.mjs");
    return { result: fullSigs(m.objs, (o) => o.own, m.P, m.K, (o) => o.bytes), transfer };
  }
  throw new Error(`unknown job ${m.kind}`);
}

/* ---------------------------------------------------------------- manifests and the garbage collector */

/** Chunk ids that `next` needs and the server does not have yet (`known`: a Set of ids already uploaded). */
export function toUpload(nextIds, known) {
  const out = [];
  for ( const id of nextIds ) if ( id && !known.has(id) && !out.includes(id) ) out.push(id);
  return out;
}

/**
 * Which chunk files may be overwritten with a tombstone. Very careful: a file goes only when NO manifest of any scene names it, it
 * was already seen unreferenced at least `grace` ms ago (`seen`: Map(name -> first time seen unreferenced), updated in place), it is
 * not a tombstone already, and the run found at least one manifest (a failed read never deletes). `files`: names in the folder;
 * `referenced`: a Set of names. Returns the names to tombstone (oldest first, at most `max`).
 */
export function gcPick(files, referenced, seen, now, { grace = 15 * 60000, max = 64, dead = new Set(), manifests = 1 } = {}) {
  const out = [];
  const inFolder = new Set(files);
  for ( const name of [...seen.keys()] ) if ( !inFolder.has(name) || referenced.has(name) ) seen.delete(name);   // gone or used again
  if ( !manifests ) return out;
  for ( const name of files ) {
    if ( referenced.has(name) || dead.has(name) ) continue;
    if ( !seen.has(name) ) { seen.set(name, now); continue; }
    if ( now - seen.get(name) >= grace ) out.push(name);
  }
  return out.sort((a, b) => seen.get(a) - seen.get(b)).slice(0, max);
}
