/**
 * THE SUBSTRATE: what a newer stroke is painted ON. Pure code (no DOM, no Foundry): the bake worker, the stroke signatures (store.mjs)
 * and the node tests share it.
 *
 * One-way dependency. A newer stroke B may depend on the composed look of the OLDER strokes inside its own pixels (its substrate): a
 * tear across a collapse cuts its lips out of the pit, a blast over cracks throws the cracked plates, a scorch chars the crater it is
 * painted on. An OLDER stroke A never changes because of a newer B (its bytes, keys and textures stay). So:
 *   - B's signature is its own data plus a DIGEST of the older strokes that may lie under it (their ids + full signatures; `fullSigs`).
 *     Without such strokes the digest is empty and the signature is exactly the old one (published chunks stay valid, bytes identical).
 *   - Editing, re-causing or removing A changes the full signature of the newer strokes over it only: they bake again (silently, the
 *     display swaps them in one frame), nothing else does. Painting B bakes only B; an eraser and an undo bake nothing.
 *   - The substrate is composed exactly as the display lays the objects (creation order: per area its cover lays the plain map, then
 *     its base, then its pieces at rest; an erase stroke lays the plain map), from the older strokes' baked sprites, which are
 *     deterministic: every client composes the same pixels. Only B's own pixels read it; outside them B keeps touching the plain map
 *     (its halos are overlays, the footprint rule).
 *
 * INTERACT: how a newer kind treats each older kind under it, one row per newer kind, one entry per older kind ("*": any). Rules:
 *   deepen k   the newly exposed floor darkens by k x the substrate's depth (a rip in a pit is deeper than the pit);
 *   char k     the newer colour is laid as a char over the substrate's own pixels (its structure stays, burnt);
 *   yield a    the newer stroke does not lay its floor there: a = 0 draws nothing (the older look stays live), a > 0 a dark overlay of
 *              that opacity (a rip under water reads as a deeper channel in the water);
 *   water      a flooded hole over a deep substrate fills deeper there (level carried to the water engine in the cover's green).
 */

export const SUBSTRATE_VERSION = 1;
const TYPES = ["blast", "collapse", "scorch", "flood", "cracks", "gash"];
export const INTERACT = {
  blast:    { "*": { deepen: 0.4 }, cracks: { deepen: 0.25 }, flood: { deepen: 0.2 } },
  collapse: { "*": { deepen: 0.5 }, blast: { deepen: 0.6 }, collapse: { deepen: 0.6 } },
  scorch:   { "*": { char: 0.8 }, flood: { yield: 0 } },
  flood:    { "*": { deepen: 0.35, water: true } },
  cracks:   { "*": { deepen: 0.3 }, flood: { yield: 0 } },
  gash:     { "*": { deepen: 0.55 }, cracks: { deepen: 0.35 }, flood: { yield: 120 } },
};
/** The rule of newer kind `t` (index) over older kind `k` (index). */
export const ruleOf = (t, k) => { const row = INTERACT[TYPES[t]] ?? INTERACT.blast; return row[TYPES[k]] ?? row["*"]; };

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const fnvStr = (s, h = 2166136261) => { for ( let i = 0; i < s.length; i++ ) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/* ================================================================ where a stroke can be (art px, conservative, from its data alone) */

/** The margin the bake's organic / torn outline may add round a stroke's mask box (core.mjs partsOf: FM). */
const outlineMargin = (P) => 4 + Math.ceil(12 * 1.3) + (P?.jagged ? 22 : 0);
/** A box round a stroke's OWN pixels (where its substrate is read). */
export function ownBox(o, P, K = 2) {
  if ( o.k ) return { x0: o.x0 * K, y0: o.y0 * K, x1: (o.x0 + o.w) * K, y1: (o.y0 + o.h) * K };
  const m = outlineMargin(P);
  return { x0: o.x0 * K - m, y0: o.y0 * K - m, x1: (o.x0 + o.w) * K + m, y1: (o.y0 + o.h) * K + m };
}
/** A box round everything a stroke's sprites may cover (its parts' windows: thrown pieces, halos, hairlines; core.mjs bake step 2). */
export function spriteBox(o, P, K = 2) {
  const b = ownBox(o, P, K);
  if ( o.k ) return b;
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0), sc = clamp(P?.scatter ?? 1, 0.2, 3), halo = clamp(P?.halo ?? 0.6, 0, 1);
  const reach = Math.max(span * 0.6 * sc + 3 * sc + 14, span * 0.7 * halo + 10, span * 0.55 + 12);
  const m = Math.round(Math.min(256, Math.max(14, reach))) + 2;
  return { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m };
}
const meets = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * For every stroke (in creation order), the indices of the OLDER strokes (erase strokes too) that may lie under its own pixels. An
 * erase stroke depends on nothing (it is not baked).
 */
export function depsOf(objects, P, K = 2) {
  const own = objects.map((o) => ownBox(o, P, K)), spr = objects.map((o) => spriteBox(o, P, K));
  return objects.map((o, i) => {
    if ( o.k ) return [];
    const out = [];
    // under its own pixels (its substrate), or under anything it draws round them (a higher level there clips it: the severity rule)
    for ( let j = 0; j < i; j++ ) if ( meets(spr[j], own[i]) || meets(own[j], spr[i]) ) out.push(j);
    return out;
  });
}

/**
 * Every stroke's FULL signature: its own (`ownSig(o)`) when nothing older may lie under it (bit for bit the signature from before
 * substrates), else own + "~" + a digest of those older strokes' ids and full signatures (so a change anywhere down the chain reaches
 * the strokes above it, and only those). Returns [{ own, sig, deps }].
 */
export function fullSigs(objects, ownSig, P, K = 2) {
  const deps = depsOf(objects, P, K), out = [];
  objects.forEach((o, i) => {
    const own = ownSig(o), d = deps[i];
    const sig = d.length ? `${own}~${fnvStr(`${SUBSTRATE_VERSION}|` + d.map((j) => `${objects[j].id}:${out[j].sig}`).join("|")).toString(36)}` : own;
    out.push({ own, sig, deps: d });
  });
  return out;
}

/* ================================================================ composing the substrate (the bake worker) */

/** One stroke's sprites -> its parts as the display lays them: [{ type, cover, base, pieces }] (lights left out). */
function partsOfSprites(sprites, ob) {
  const parts = [];
  let cur = null;
  for ( const s of sprites ) {
    const k = s.m[0];
    if ( k === 0 ) { cur = { type: s.m[10], cover: null, base: s, pieces: [], ob }; parts.push(cur); }
    else if ( !cur ) continue;
    else if ( k === 2 ) cur.cover = s;
    else if ( k === 1 ) cur.pieces.push(s);
  }
  return parts;
}
/** core.mjs area results -> sprites { m, w, h, data } (absolute placement in m[5], m[6]). */
export const spritesOfResult = (res) => res.items.map((it) => ({ m: it.m, w: it.img.w, h: it.img.h, data: it.img.data }));

/** A stroke's painted level (1-3) at art pixel (ax, ay) of its own pixels: its mask byte there, else the highest within 2 mask px, else
 * (a lobe of its torn outline reaching further out) its highest level. */
export function levelAt(o, ax, ay, K = 2) {
  const b = o.bytes; if ( !b ) return 1;
  const mx = Math.floor(ax / K) - o.x0, my = Math.floor(ay / K) - o.y0;
  for ( let r = 0; r <= 2; r++ ) {
    let best = 0;
    for ( let dy = -r; dy <= r; dy++ ) for ( let dx = -r; dx <= r; dx++ ) {
      const X = mx + dx, Y = my + dy; if ( X < 0 || Y < 0 || X >= o.w || Y >= o.h ) continue;
      const v = b[Y * o.w + X] & 3; if ( v > best ) best = v;
    }
    if ( best ) return best;
  }
  return maxLevel(o);
}

/** A stroke's highest painted level (what its halo, lip and thrown pieces count as). */
const maxLv = new WeakMap();
const maxLevel = (o) => { const b = o?.bytes; if ( !b ) return 1; let m = maxLv.get(b); if ( m ) return m; m = 1; for ( const v of b ) if ( (v & 3) > m ) m = v & 3; maxLv.set(b, m); return m; };

/**
 * The older strokes of one bake call: the strokes baked in this call (`add`, as their areas come out, in creation order) and the
 * records of older strokes that are not (`under`: index -> sprites, from the main thread), plus the erase strokes (`objects[j].k`).
 */
export class SubstrateSource {
  constructor(objects, under, P, K) {
    this.objects = objects ?? []; this.K = K; this.P = P;
    this.byIndex = new Map();
    for ( const [j, sprites] of Object.entries(under ?? {}) ) this.byIndex.set(Number(j), partsOfSprites(sprites, this.objects[Number(j)]));
    this.boxes = this.objects.map((o) => spriteBox(o, P, K));
  }
  add(index, res) {
    const list = this.byIndex.get(index) ?? [];
    if ( !this.byIndex.has(index) ) this.byIndex.set(index, list);
    list.push(...partsOfSprites(spritesOfResult(res), this.objects[index]));
  }

  /**
   * The substrate of one area (`win`: W, H, RX, RY, own, px, sev), stroke `index`. Null when nothing older lies under it or near it
   * (the area bakes exactly as without substrates). Else a Substrate:
   *   rgba   the window: the plain map outside the own pixels, inside them the composed look of the older strokes;
   *   kind   older kind + 1 whose cover owns the pixel (0: none), lvl its painted level there (0: none);
   *   lvW    over the WHOLE window: the level of the older damage there (the severity rule clips what this area draws round itself);
   *   depth  0..1, how much darker than the plain map it lies; hash: what it is (part of the area's cache key).
   */
  compose(win, index, map) {
    const { W, H, RX, RY, own, px } = win, K = this.K;
    if ( !px.length ) return null;
    const wbox = { x0: RX, y0: RY, x1: RX + W, y1: RY + H };
    const layers = [];
    for ( let j = 0; j < index; j++ ) {
      const o = this.objects[j]; if ( !o || !meets(this.boxes[j], wbox) ) continue;
      if ( o.k && !o.skip ) layers.push({ erase: o });
      else { const parts = this.byIndex.get(j); if ( parts?.length ) layers.push({ parts }); }
    }
    if ( !layers.length ) return null;
    // (levels are the PAINTED levels of the mask bytes, not the bake's smoothed severity)
    const me = this.objects[index], bMax = maxLevel(me);
    let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
    for ( const i of px ) {
      const x = i % W, y = (i - x) / W; if ( x < bx0 ) bx0 = x; if ( x > bx1 ) bx1 = x; if ( y < by0 ) by0 = y; if ( y > by1 ) by1 = y;
    }
    const MW = map.w, md = map.data, N = W * H;
    const rgba = new Uint8ClampedArray(N * 4), kind = new Uint8Array(N), lvl = new Uint8Array(N), lvW = new Uint8Array(N), srcLv = new Uint8Array(N);
    for ( let y = 0; y < H; y++ ) rgba.set(md.subarray(((RY + y) * MW + RX) * 4, ((RY + y) * MW + RX + W) * 4), y * W * 4);
    const mapAt = (i) => { const x = i % W, y = (i - x) / W, q = ((RY + y) * MW + RX + x) * 4; rgba[i * 4] = md[q]; rgba[i * 4 + 1] = md[q + 1]; rgba[i * 4 + 2] = md[q + 2]; };
    /** Visit the pixels of a sprite inside the window (own: only the own pixels' box and own pixels): fn(window index, byte offset). */
    const visit = (s, fn, ownOnly = true) => {
      const sx = s.m[5] - RX, sy = s.m[6] - RY;
      const [X0, Y0, X1, Y1] = ownOnly ? [bx0, by0, bx1 + 1, by1 + 1] : [0, 0, W, H];
      const ys = Math.max(0, Y0 - sy), ye = Math.min(s.h, Y1 - sy), xs = Math.max(0, X0 - sx), xe = Math.min(s.w, X1 - sx);
      for ( let y = ys; y < ye; y++ ) for ( let x = xs; x < xe; x++ ) {
        const i = (sy + y) * W + sx + x; if ( ownOnly && !own[i] ) continue;
        fn(i, (y * s.w + x) * 4);
      }
    };
    const over = (s, lv) => visit(s, (i, q) => {
      const a = s.data[q + 3]; if ( !a ) return;
      const o = i * 4; srcLv[i] = lv;
      if ( a === 255 ) { rgba[o] = s.data[q]; rgba[o + 1] = s.data[q + 1]; rgba[o + 2] = s.data[q + 2]; return; }
      for ( let c = 0; c < 3; c++ ) rgba[o + c] = ((rgba[o + c] * (255 - a) + s.data[q + c] * a + 127) / 255) | 0;
    });
    for ( const L of layers ) {
      if ( L.erase ) {
        const o = L.erase, b = o.bytes;
        const x0 = Math.max(0, o.x0 * K - RX), y0 = Math.max(0, o.y0 * K - RY), x1 = Math.min(W, (o.x0 + o.w) * K - RX), y1 = Math.min(H, (o.y0 + o.h) * K - RY);
        for ( let y = y0; y < y1; y++ ) for ( let x = x0; x < x1; x++ ) {
          const mx = Math.floor((RX + x) / K) - o.x0, my = Math.floor((RY + y) / K) - o.y0;
          if ( !b[my * o.w + mx] ) continue;
          const i = y * W + x; lvW[i] = 0;
          if ( own[i] ) { mapAt(i); kind[i] = 0; lvl[i] = 0; srcLv[i] = 0; }
        }
        continue;
      }
      for ( const p of L.parts ) {
        if ( p.cover ) visit(p.cover, (i, q) => {
          if ( !p.cover.data[q + 3] ) return;
          const l = levelAt(p.ob, RX + i % W, RY + ((i - (i % W)) / W), K);
          lvW[i] = l;
          if ( own[i] ) { mapAt(i); kind[i] = p.type + 1; lvl[i] = l; srcLv[i] = l; }
        }, false);
        const pl = maxLevel(p.ob);
        over(p.base, pl);
        for ( const s of p.pieces ) over(s, pl);
      }
    }
    // the hash of what differs from the plain map, and of the higher damage round it that clips this area
    let h = 2166136261, any = false;
    const depth = new Float32Array(N), lvB = new Uint8Array(N), tear = win.typ[px[0]] === 5;
    for ( const i of px ) {
      const o = i * 4, x = i % W, y = (i - x) / W, q = ((RY + y) * MW + RX + x) * 4;
      lvB[i] = levelAt(me, RX + x, RY + y, K);
      // THE SEVERITY RULE: over older damage of a LOWER level this area replaces it (as without substrates: the same look whatever the
      // paint order). A tear keeps it under its lips (it only lays its opening and lips; elsewhere its pixels are not damage)
      if ( srcLv[i] && srcLv[i] < lvB[i] && !tear ) { mapAt(i); kind[i] = 0; lvl[i] = 0; }
      if ( rgba[o] === md[q] && rgba[o + 1] === md[q + 1] && rgba[o + 2] === md[q + 2] && !kind[i] ) continue;
      any = true;
      h = Math.imul(h ^ i, 16777619); h = Math.imul(h ^ (rgba[o] | (rgba[o + 1] << 8) | (rgba[o + 2] << 16) | (kind[i] << 24)), 16777619); h = Math.imul(h ^ lvl[i], 16777619);
      if ( kind[i] ) { const lm = lum(md[q], md[q + 1], md[q + 2]), ls = lum(rgba[o], rgba[o + 1], rgba[o + 2]); depth[i] = clamp((lm - ls) / Math.max(lm, 40) * 1.25, 0, 1); }
    }
    for ( let i = 0; i < N; i++ ) if ( lvW[i] > bMax ) { any = true; h = Math.imul(h ^ (i * 4 + lvW[i]), 16777619); }
    if ( !any ) return null;
    return new Substrate({ rgba, kind, lvl, lvW, lvB, bMax, depth, hash: (Math.imul(h, 16777619) ^ bMax) >>> 0, W });
  }
}

/**
 * A composed substrate and the interaction rules on it (pure colour maths, [r, g, b] arrays as core.mjs and tear.mjs use them). The
 * rules only reach older damage of the same or a higher level than this area's own level there: over lower damage a higher level
 * REPLACES it (no ghost of hairlines in a crater floor), so the look of an overlap of different levels is the higher one's, whatever
 * the paint order (the severity rule; the lower one's pixels inside the higher one are cut off in core.mjs, `exclude`).
 */
export class Substrate {
  constructor(o) { Object.assign(this, o); }
  rule(i, type) { const k = this.kind[i]; return k && this.lvl[i] >= this.lvB[i] ? ruleOf(type, k - 1) : null; }
  /** Does newer kind `type` leave pixel i to the older look (nothing drawn there)? */
  yields(i, type) { const r = this.rule(i, type); return !!r && r.yield !== undefined; }
  /**
   * The newer stroke's colour `col` for its exposed floor at window pixel i, over the substrate: deepened, charred, or null (yield:
   * nothing drawn) or a colour with `.a` (an overlay of that opacity). `clean` the window's plain map.
   */
  fx(i, col, type, clean) {
    const r = this.rule(i, type); if ( !r ) return col;
    if ( r.yield !== undefined ) { if ( !r.yield ) return null; const c = [col[0] >> 1, col[1] >> 1, col[2] >> 1]; c.a = r.yield; return c; }
    if ( r.char ) {
      const o = i * 4, s = this.rgba, lc = clean ? lum(clean[o], clean[o + 1], clean[o + 2]) : 128;
      const f = clamp(lum(col[0], col[1], col[2]) / Math.max(40, lc), 0.15, 1.1), t = r.char;
      return [0, 1, 2].map((c) => clamp(Math.round(col[c] * (1 - t) + s[o + c] * f * t), 0, 255));
    }
    if ( r.deepen ) { const f = 1 - r.deepen * this.depth[i]; return [Math.round(col[0] * f), Math.round(col[1] * f), Math.round(col[2] * f)]; }
    return col;
  }
  /** Over a plate the newer stroke left in place (not drawn): a char laid over the older look (overlay colour with `.a`), or null. */
  keepFx(i, type, dark) {
    const r = this.rule(i, type); if ( !r?.char ) return null;
    const c = [dark[0], dark[1], dark[2]]; c.a = Math.round(140 * r.char); return c;
  }
  /** A flooded hole's water level over the substrate at pixel i (0: its own), 2 shallow, 3 deep. */
  waterLevel(i, type) {
    const r = this.rule(i, type); if ( !r?.water ) return 0;
    const d = this.depth[i]; return d > 0.5 ? 3 : d > 0.22 ? 2 : 0;
  }
  /**
   * THE SEVERITY RULE, inside: the own pixels of this area that lie in older damage of a strictly HIGHER level (painted level of that
   * older stroke there) are not its own any more - a lower level never covers a higher one. Edits `win` (inside, own, sev, typ, frag,
   * px) and puts the plain map back there. Returns how many pixels were cut off.
   */
  exclude(win, md, MW) {
    const { W, RX, RY } = win, keep = [];
    let cut = 0;
    for ( const i of win.px ) {
      if ( this.lvl[i] > this.lvB[i] ) {
        win.inside[i] = 0; win.own[i] = 0; win.sev[i] = 0; win.typ[i] = 0; win.frag[i] = 0;
        const x = i % W, y = (i - x) / W, q = ((RY + y) * MW + RX + x) * 4, o = i * 4;
        this.rgba[o] = md[q]; this.rgba[o + 1] = md[q + 1]; this.rgba[o + 2] = md[q + 2]; this.kind[i] = 0; this.lvl[i] = 0; this.depth[i] = 0;
        cut++;
      } else keep.push(i);
    }
    if ( cut ) win.px = keep;
    return cut;
  }
}

/**
 * After an area baked over a substrate:
 *  - its cover (the plain map the display lays under it) shrinks to the pixels the area really lays opaque (its base at full alpha),
 *    so wherever it draws nothing or only an overlay the older look stays visible, live - a newer stroke never lays clean ground
 *    inside its own pixels. A flooded hole keeps its whole cover (the water engine reads its outline from it) and carries the
 *    substrate's water depth in the cover's green (255 - 40 x level; the display's masks read red and alpha only);
 *  - THE SEVERITY RULE, outside: nothing it draws round its own pixels (halo, lip, hairlines, shadows, thrown pieces) lands on older
 *    damage of a higher level than its own: those pixels are cleared (only its outer parts are clipped away, the higher one stays).
 */
export function finishOverSubstrate(items, win, type, sub) {
  const W = win.W, H = win.H, RX = win.RX, RY = win.RY;
  const clip = (img, x0, y0, skipOwn) => {
    for ( let y = 0; y < img.h; y++ ) for ( let x = 0; x < img.w; x++ ) {
      const wx = x0 + x, wy = y0 + y; if ( wx < 0 || wy < 0 || wx >= W || wy >= H ) continue;
      const i = wy * W + wx; if ( skipOwn && win.own[i] ) continue;
      if ( sub.lvW[i] > sub.bMax ) { const q = (y * img.w + x) * 4; img.data[q] = img.data[q + 1] = img.data[q + 2] = img.data[q + 3] = 0; }
    }
  };
  for ( const it of items ) {
    if ( it.m[0] === 0 ) clip(it.img, it.img.x, it.img.y, true);
    else if ( it.m[0] === 1 ) clip(it.img, it.m[5] - RX, it.m[6] - RY, false);
    else if ( it.m[0] === 3 ) clip(it.img, it.m[5] - RX, it.m[6] - RY, false);
  }
  const base = items.find((it) => it.m[0] === 0), cov = items.find((it) => it.m[0] === 2);
  if ( !base || !cov || type === 5 ) return;   // (a tear's cover is already what it lays, tear.mjs)
  const b = base.img, c = cov.img;
  for ( let y = 0; y < c.h; y++ ) for ( let x = 0; x < c.w; x++ ) {
    const q = (y * c.w + x) * 4; if ( !c.data[q + 3] ) continue;
    const wx = c.x + x, wy = c.y + y, i = wy * W + wx;
    if ( type === 3 ) {
      const lv = sub.waterLevel(i, type);
      if ( lv ) c.data[q + 1] = 255 - 40 * lv;
      continue;
    }
    const bx = wx - b.x, by = wy - b.y;
    const a = bx >= 0 && by >= 0 && bx < b.w && by < b.h ? b.data[(by * b.w + bx) * 4 + 3] : 0;
    if ( a < 255 ) c.data[q] = c.data[q + 1] = c.data[q + 2] = c.data[q + 3] = 0;
  }
}
