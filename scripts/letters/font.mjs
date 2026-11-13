/* LETR: a small TrueType (glyf) reader. Pure: no DOM, no Foundry; runs in node checks too.
   parseFont(ArrayBuffer) -> { name, upm, asc, desc, capH, has(ch), glyph(ch) -> { adv, contours } }
   Contours are flat polygons in font units scaled to the cap height = 1, y pointing DOWN (canvas space), baseline at y = 0,
   so a capital spans y in [-1, 0]. Quadratic curves are flattened (more steps on long curves). Composite glyphs (Polish
   letters are often a base + an accent) are resolved. Outer contours keep their winding against holes, so "nonzero" fills
   work after any later point warp that does not fold a contour over itself. */

const u16 = (v, o) => v.getUint16(o), i16 = (v, o) => v.getInt16(o), u32 = (v, o) => v.getUint32(o);

export function parseFont(buf, name = "font") {
  const v = new DataView(buf);
  const nt = u16(v, 4), tables = {};
  for ( let i = 0; i < nt; i++ ) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    tables[tag] = { off: u32(v, o + 8), len: u32(v, o + 12) };
  }
  for ( const t of ["head", "hhea", "hmtx", "maxp", "cmap", "loca", "glyf"] ) if ( !tables[t] ) throw new Error(`LETR font ${name}: no ${t} table (only TrueType outlines are read)`);
  const head = tables.head.off, upm = u16(v, head + 18), locFmt = i16(v, head + 50);
  const numGlyphs = u16(v, tables.maxp.off + 4);
  const hhea = tables.hhea.off, asc = i16(v, hhea + 4), desc = i16(v, hhea + 6), numH = u16(v, hhea + 34);
  let capH = 0;
  const os2 = tables["OS/2"];
  if ( os2 && u16(v, os2.off) >= 2 && os2.len >= 90 ) capH = i16(v, os2.off + 88);

  /* cmap: format 4 (BMP) and 12 */
  const cmap = new Map();
  {
    const c = tables.cmap.off, n = u16(v, c + 2);
    let best = null;
    for ( let i = 0; i < n; i++ ) {
      const pid = u16(v, c + 4 + i * 8), eid = u16(v, c + 6 + i * 8), off = u32(v, c + 8 + i * 8);
      const fmt = u16(v, c + off);
      const score = (fmt === 12 ? 3 : fmt === 4 ? 2 : 0) + ((pid === 3 && (eid === 1 || eid === 10)) || pid === 0 ? 1 : 0);
      if ( fmt !== 4 && fmt !== 12 ) continue;
      if ( !best || score > best.score ) best = { off: c + off, fmt, score };
    }
    if ( best?.fmt === 4 ) {
      const o = best.off, segX2 = u16(v, o + 6), seg = segX2 / 2;
      const ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for ( let s = 0; s < seg; s++ ) {
        const end = u16(v, ends + s * 2), start = u16(v, starts + s * 2), delta = i16(v, deltas + s * 2), ro = u16(v, ranges + s * 2);
        for ( let ch = start; ch <= end && ch !== 0xFFFF; ch++ ) {
          let g;
          if ( ro === 0 ) g = (ch + delta) & 0xFFFF;
          else {
            const gi = ranges + s * 2 + ro + (ch - start) * 2;
            g = u16(v, gi); if ( g ) g = (g + delta) & 0xFFFF;
          }
          if ( g ) cmap.set(ch, g);
        }
      }
    } else if ( best?.fmt === 12 ) {
      const o = best.off, ng = u32(v, o + 12);
      for ( let i = 0; i < ng; i++ ) {
        const s = u32(v, o + 16 + i * 12), e = u32(v, o + 20 + i * 12), g0 = u32(v, o + 24 + i * 12);
        for ( let ch = s; ch <= e && ch - s < 70000; ch++ ) cmap.set(ch, g0 + ch - s);
      }
    }
  }

  const loca = (g) => locFmt === 0 ? u16(v, tables.loca.off + g * 2) * 2 : u32(v, tables.loca.off + g * 4);
  const advOf = (g) => u16(v, tables.hmtx.off + Math.min(g, numH - 1) * 4);

  /* raw outline of glyph g in font units (y up): array of contours, each an array of {x,y,on} */
  function rawOutline(g, depth = 0) {
    if ( g >= numGlyphs || depth > 6 ) return [];
    const start = loca(g), end = loca(g + 1);
    if ( end <= start ) return [];
    const o = tables.glyf.off + start, nc = i16(v, o);
    if ( nc >= 0 ) {
      const endPts = []; for ( let i = 0; i < nc; i++ ) endPts.push(u16(v, o + 10 + i * 2));
      const nPts = nc ? endPts[nc - 1] + 1 : 0;
      let p = o + 10 + nc * 2; const insLen = u16(v, p); p += 2 + insLen;
      const flags = [];
      while ( flags.length < nPts ) {
        const f = v.getUint8(p++); flags.push(f);
        if ( f & 8 ) { let r = v.getUint8(p++); while ( r-- > 0 ) flags.push(f); }
      }
      const xs = new Array(nPts), ys = new Array(nPts);
      let x = 0; for ( let i = 0; i < nPts; i++ ) { const f = flags[i]; if ( f & 2 ) { const d = v.getUint8(p++); x += (f & 16) ? d : -d; } else if ( !(f & 16) ) { x += i16(v, p); p += 2; } xs[i] = x; }
      let y = 0; for ( let i = 0; i < nPts; i++ ) { const f = flags[i]; if ( f & 4 ) { const d = v.getUint8(p++); y += (f & 32) ? d : -d; } else if ( !(f & 32) ) { y += i16(v, p); p += 2; } ys[i] = y; }
      const out = []; let s = 0;
      for ( const e of endPts ) { const c = []; for ( let i = s; i <= e; i++ ) c.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) }); out.push(c); s = e + 1; }
      return out;
    }
    /* composite */
    const out = []; let p = o + 10, more = true;
    while ( more ) {
      const fl = u16(v, p), gi = u16(v, p + 2); p += 4;
      let dx, dy;
      if ( fl & 1 ) { dx = i16(v, p); dy = i16(v, p + 2); p += 4; } else { dx = v.getInt8(p); dy = v.getInt8(p + 1); p += 2; }
      let a = 1, b = 0, c = 0, d = 1;
      const f2 = (q) => i16(v, q) / 16384;
      if ( fl & 8 ) { a = d = f2(p); p += 2; } else if ( fl & 0x40 ) { a = f2(p); d = f2(p + 2); p += 4; } else if ( fl & 0x80 ) { a = f2(p); b = f2(p + 2); c = f2(p + 4); d = f2(p + 6); p += 8; }
      if ( !(fl & 2) ) { dx = 0; dy = 0; }   // point-matching anchors are not used by the fonts we ship
      for ( const ct of rawOutline(gi, depth + 1) ) out.push(ct.map((q) => ({ x: a * q.x + c * q.y + dx, y: b * q.x + d * q.y + dy, on: q.on })));
      more = !!(fl & 0x20);
    }
    return out;
  }

  if ( !capH ) {   // older OS/2: measure H
    const h = cmap.get(72); let top = 0;
    if ( h ) for ( const c of rawOutline(h) ) for ( const q of c ) top = Math.max(top, q.y);
    capH = top || upm * 0.7;
  }
  const k = 1 / capH;

  /* flatten one contour (quadratic B-splines) into a polygon [x0,y0,x1,y1,...] in cap units, y down */
  function flatten(c) {
    const n = c.length; if ( n < 2 ) return null;
    const pts = [];
    /* expand implied on-curve points between two off-curve points */
    const q = [];
    for ( let i = 0; i < n; i++ ) {
      const a = c[i], b = c[(i + 1) % n];
      q.push(a);
      if ( !a.on && !b.on ) q.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
    }
    let s = q.findIndex((p) => p.on); if ( s < 0 ) return null;
    const m = q.length;
    const P = (x, y) => pts.push(x * k, -y * k);
    let prev = q[s]; P(prev.x, prev.y);
    for ( let j = 1; j <= m; j++ ) {
      const cur = q[(s + j) % m];
      if ( cur.on ) { if ( j < m ) P(cur.x, cur.y); prev = cur; continue; }
      const nx = q[(s + j + 1) % m];
      const len = Math.hypot(cur.x - prev.x, cur.y - prev.y) + Math.hypot(nx.x - cur.x, nx.y - cur.y);
      const steps = Math.max(2, Math.min(10, Math.round(len * k * 14)));
      for ( let t = 1; t <= steps; t++ ) {
        const u = t / steps, w = 1 - u;
        if ( t === steps && j + 1 >= m ) break;
        P(w * w * prev.x + 2 * w * u * cur.x + u * u * nx.x, w * w * prev.y + 2 * w * u * cur.y + u * u * nx.y);
      }
      prev = nx; j++;
    }
    return pts.length >= 6 ? pts : null;
  }

  const cache = new Map();
  function glyph(ch) {
    const cp = typeof ch === "number" ? ch : ch.codePointAt(0);
    if ( cache.has(cp) ) return cache.get(cp);
    const g = cmap.get(cp);
    let r = null;
    if ( g != null ) {
      const contours = rawOutline(g).map(flatten).filter(Boolean);
      r = { adv: advOf(g) * k, contours };
    }
    cache.set(cp, r);
    return r;
  }
  return { name, upm, asc: asc * k, desc: desc * k, capH, has: (ch) => cmap.has(typeof ch === "number" ? ch : ch.codePointAt(0)), glyph };
}

/* bounding box of a glyph's contours */
export function glyphBox(gl) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( const c of gl?.contours ?? [] ) for ( let i = 0; i < c.length; i += 2 ) { x0 = Math.min(x0, c[i]); x1 = Math.max(x1, c[i]); y0 = Math.min(y0, c[i + 1]); y1 = Math.max(y1, c[i + 1]); }
  return x0 === Infinity ? { x0: 0, y0: -1, x1: 0.5, y1: 0 } : { x0, y0, x1, y1 };
}

/* signed area (shoelace); > 0 = clockwise in y-down space */
export function area(c) { let a = 0; for ( let i = 0, n = c.length; i < n; i += 2 ) { const j = (i + 2) % n; a += c[i] * c[j + 1] - c[j] * c[i + 1]; } return a / 2; }
