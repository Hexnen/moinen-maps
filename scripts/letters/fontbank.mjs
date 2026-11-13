/* LETR: the fonts the engine letters with, letter by letter. Pure (fonts arrive as ArrayBuffers).
   A font without a Polish letter gets it built from its own outlines: the base letter plus an accent taken from the same font
   (acute from its Ó or ´, dot from its period, ogonek from its own Ę/Ą or a fallback font's, the Ł bar drawn); only when even the
   base letter is missing does the letter come from the fallback chain. */
import { parseFont, glyphBox, area } from "./font.mjs";
import { FONTS, FALLBACK } from "./design.mjs";

const DECOMP = { "Ą": ["A", "ogonek"], "Ć": ["C", "acute"], "Ę": ["E", "ogonek"], "Ł": ["L", "bar"], "Ń": ["N", "acute"],
  "Ó": ["O", "acute"], "Ś": ["S", "acute"], "Ź": ["Z", "acute"], "Ż": ["Z", "dot"] };

const shift = (c, dx, dy, k = 1, cx = 0, cy = 0) => { const o = new Array(c.length); for ( let i = 0; i < c.length; i += 2 ) { o[i] = cx + (c[i] - cx) * k + dx; o[i + 1] = cy + (c[i + 1] - cy) * k + dy; } return o; };
const boxOf = (cs) => glyphBox({ contours: cs });

export class FontBank {
  constructor() { this.fonts = new Map(); this.cache = new Map(); }
  add(id, buf) { this.fonts.set(id, parseFont(buf, id)); this.cache.clear(); }
  has(id) { return this.fonts.has(id); }

  /* accent shapes of one font (contours relative to their own box: bottom-centre at 0,0) */
  accent(id, kind) {
    const f = this.fonts.get(id); if ( !f ) return null;
    const key = `${id}|${kind}`;
    if ( this.cache.has(key) ) return this.cache.get(key);
    let cs = null;
    const above = (ch, base) => { const g = f.glyph(ch), b = f.glyph(base); if ( !g || !b ) return null; const n = b.contours.length; const extra = g.contours.length > n ? g.contours.slice(n) : g.contours.filter((c) => boxOf([c]).y1 < -1.01); return extra.length ? extra : null; };
    const below = (ch) => { const g = f.glyph(ch); if ( !g ) return null; const x = g.contours.filter((c) => boxOf([c]).y0 > -0.12 && boxOf([c]).y1 > 0.04); return x.length ? x : null; };
    if ( kind === "acute" ) cs = above("Ó", "O") ?? f.glyph(0xB4)?.contours ?? null;
    if ( kind === "dot" ) cs = above("Ż", "Z") ?? f.glyph(0x2D9)?.contours ?? f.glyph(".")?.contours ?? null;
    if ( kind === "ogonek" ) cs = below("Ę") ?? below("Ą") ?? f.glyph(0x2DB)?.contours ?? null;
    let r = null;
    if ( cs?.length ) { const b = boxOf(cs); r = { cs: cs.map((c) => shift(c, -(b.x0 + b.x1) / 2, -(kind === "ogonek" ? b.y0 : b.y1))), w: b.x1 - b.x0, h: b.y1 - b.y0, top: b.y0 }; }
    this.cache.set(key, r);
    return r;
  }

  raw(id, ch) { const f = this.fonts.get(id); if ( !f ) return null; const g = f.has(ch) ? f.glyph(ch) : null; return g?.contours?.length || ch === " " ? g : null; }

  /* glyph {adv, contours, font} for a letter in font `id`: own glyph, synthesised Polish letter, or a fallback font's */
  glyph(id, ch) {
    const key = `${id}#${ch}`;
    if ( this.cache.has(key) ) return this.cache.get(key);
    let g = this.raw(id, ch);
    if ( g ) g = { ...g, font: id };
    if ( !g && DECOMP[ch] ) g = this.synth(id, ch);
    if ( !g ) for ( const fb of FALLBACK ) { const x = this.raw(fb, ch) ?? (DECOMP[ch] ? this.synth(fb, ch) : null); if ( x ) { g = { ...x, font: fb }; break; } }
    if ( !g ) { const q = this.raw(id, "?") ?? this.raw(FALLBACK[0], "?"); g = q ? { ...q, font: id } : { adv: 0.5, contours: [], font: id }; }
    this.cache.set(key, g);
    return g;
  }

  synth(id, ch) {
    const [baseCh, kind] = DECOMP[ch];
    const base = this.raw(id, baseCh); if ( !base ) return null;
    const bb = glyphBox(base);
    const cs = base.contours.map((c) => c.slice());
    if ( kind === "bar" ) {
      /* the Ł bar: a slanted parallelogram across the stem, as thick as the stem is wide * 0.55 */
      const stemX = bb.x0 + (bb.x1 - bb.x0) * 0.3, y = -0.48, t = 0.11, w = (bb.x1 - bb.x0) * 0.42;
      const p = [stemX - w * 0.55, y + t * 0.5 + 0.06, stemX + w * 0.65, y - t * 0.5 - 0.06, stemX + w * 0.65, y - t * 0.5 - 0.06 - t, stemX - w * 0.55, y + t * 0.5 + 0.06 - t];
      const outerSign = Math.sign(area(cs[0] ?? p)) || 1;
      cs.push(Math.sign(area(p)) === outerSign ? p : [p[6], p[7], p[4], p[5], p[2], p[3], p[0], p[1]]);
      return { adv: base.adv, contours: cs, font: id, synth: true };
    }
    let acc = this.accent(id, kind);
    let accK = 1;
    if ( !acc ) for ( const fb of [...FALLBACK, "titan", "sigmar"] ) { if ( fb === id ) continue; acc = this.accent(fb, kind); if ( acc ) { accK = 0.95; break; } }
    if ( !acc ) return { adv: base.adv, contours: cs, font: id, synth: true };
    const cx = (bb.x0 + bb.x1) / 2;
    if ( kind === "ogonek" ) {
      const ax = bb.x1 - acc.w * 0.6 * accK - 0.02;
      for ( const c of acc.cs ) cs.push(shift(c, ax, bb.y1 - 0.06, accK));
    } else {
      const ax = cx + (kind === "acute" ? 0.06 : 0);
      for ( const c of acc.cs ) cs.push(shift(c, ax, bb.y0 - 0.07, accK));
    }
    return { adv: base.adv, contours: cs, font: id, synth: true };
  }

  adv(id, ch) { return this.glyph(id, ch).adv; }
}

export const FONT_FILES = Object.fromEntries(Object.entries(FONTS).map(([k, v]) => [k, v.file]));
