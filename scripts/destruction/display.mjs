import { META_FIELDS } from "./core.mjs";
import { reducedMotion } from "../config.mjs";

/**
 * Shows a bake, AREA BY AREA: every damaged area is a group (its own small texture atlas, a base sprite with what lies beneath, and
 * its shards) identified by the area's hash. A new bake only adds the groups whose hash is new and removes the ones that are gone;
 * an area that did not change keeps its sprites and its texture (no re-upload, no flash, no replay). Layers in the primary group,
 * between the map and the tiles/tokens: damage 247, shards 248, dust and embers 249.
 *
 * Textures are mipmapped; up close they are sampled NEAREST (crisp pixel art), zoomed out LINEAR + mipmaps (no shimmer while
 * zooming); every frame of an area's atlas has a transparent gutter so mip levels do not bleed between frames.
 *
 * ENTRY: a new area does not just pop in. Its ruin is revealed by a front running from the impact (a growing reveal mask, or a
 * wipe along the stroke for gashes and directional strokes) while its pieces tear loose as the front reaches them, with a
 * type-specific look (blast: flash, shock ring, thrown debris and dust; collapse: tremor, plates drop from the rim inwards, dust from
 * the pit; burn: a fire front with embers and smoke, curling plates; flood: plates sink, water rings; cracks: a fast fracture with
 * hopping plates; gash: a claw swipe with sparks). Cosmetic, timed from a start time the caller gives (shared server time).
 * Reduced motion: a short fade.
 */
const TYPES = ["blast", "collapse", "scorch", "flood", "cracks", "gash"];
const PAD = 4;
const NEAREST = 0, LINEAR = 1;

function layer(sortLayer) {
  const c = new PIXI.Container();
  c.eventMode = "none";
  Object.assign(c, { elevation: 0, sortLayer, sort: 0, _lastSortedIndex: 0 });
  canvas.primary.addChild(c);
  return c;
}

const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t;
const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
const lerpColor = (a, b, t) => {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t), g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t), bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};

/** Per type: reveal delay and duration (ms at speed 1), how the front runs, piece motion. */
const LOOK = {
  blast:    { delay: 70,  reveal: 420, flight: 1,    arc: 1,    order: "out" },
  collapse: { delay: 300, reveal: 760, flight: 1.25, arc: 0.35, order: "in" },
  scorch:   { delay: 0,   reveal: 950, flight: 1.3,  arc: 0.5,  order: "out" },
  flood:    { delay: 120, reveal: 680, flight: 1.4,  arc: 0.3,  order: "out" },
  cracks:   { delay: 0,   reveal: 430, flight: 0.8,  arc: 0.6,  order: "out" },
  gash:     { delay: 40,  reveal: 460, flight: 0.9,  arc: 0.7,  order: "wipe" }
};

/** Shelf-pack rectangles (tallest first) with a gutter; returns { W, H, pos }. */
function pack(rects) {
  const area = rects.reduce((a, r) => a + (r.w + PAD) * (r.h + PAD), 0);
  let W = 64; while ( W * W < area * 1.3 && W < 4096 ) W *= 2;
  W = Math.max(W, ...rects.map((r) => r.w + PAD * 2));
  const order = rects.map((r, i) => i).sort((a, b) => rects[b].h - rects[a].h || rects[b].w - rects[a].w);
  const pos = new Array(rects.length);
  let x = PAD, y = PAD, rowH = 0;
  for ( const i of order ) {
    const r = rects[i];
    if ( x + r.w + PAD > W ) { x = PAD; y += rowH + PAD; rowH = 0; }
    pos[i] = { x, y }; x += r.w + PAD; rowH = Math.max(rowH, r.h);
  }
  return { W, H: y + rowH + PAD, pos };
}

export class DestructionDisplay {
  constructor() {
    this.base = layer(247);
    this.shards = layer(248);
    this.fx = layer(249);
    this.groups = new Map();       // hash -> group
    this.order = [];               // groups in sheet order
    this.dying = [];               // groups fading out
    this.particles = [];           // live particles
    this.pool = [];                // spare particle sprites
    this.idle = { on: true, who: "all" };
    this.look = { entry: true, speed: 1, power: 1 };
    this.filter = NEAREST;
    this.stats = { frameMs: 0, sprites: 0, groups: 0, uploads: 0, entries: 0 };
    this.ap = 1; this.origin = { x: 0, y: 0 };
    this._tick = () => this.tick();
    canvas.app.ticker.add(this._tick);
  }

  /** Every area shown, in order: { type, mat, hash, ... }. */
  get areas() { return this.order.map((g) => g.info); }

  /* ---------------------------------------------------------------- bakes in */

  /**
   * Show a bake: `rgba` (the sheet, w x h), `meta` (placement table), art pixel size and the scene origin. Keeps the groups whose hash
   * is still there; returns { added: [group], removed: [group] }.
   */
  sync(rgba, w, h, meta, ap, origin) {
    this.ap = ap; this.origin = origin;
    const F = META_FIELDS, n = meta.length / F;
    const rows = [];
    let cur = null;
    for ( let k = 0; k < n; k++ ) {
      const o = k * F;
      if ( meta[o] === 0 ) { cur = { hash: ((meta[o + 12] & 0xffff) | ((meta[o + 13] & 0xffff) << 16)) >>> 0, base: o, pieces: [] }; rows.push(cur); }
      else cur?.pieces.push(o);
    }
    const next = [], added = [], seen = new Set();
    for ( const r of rows ) {
      if ( seen.has(r.hash) ) continue;
      seen.add(r.hash);
      let g = this.groups.get(r.hash);
      if ( !g ) { g = this.build(r, rgba, w, meta); this.groups.set(r.hash, g); added.push(g); }
      next.push(g);
    }
    const removed = [];
    for ( const [hash, g] of this.groups ) if ( !seen.has(hash) ) { this.groups.delete(hash); removed.push(g); }
    for ( const g of removed ) this.retire(g, added);
    this.order = next;
    // sheet order on top of whatever is fading out (addChild moves a child to the end)
    for ( const g of next ) { this.base.addChild(g.baseCont); this.shards.addChild(g.shardCont); }
    this.stats.groups = next.length;
    this.stats.sprites = next.reduce((a, g) => a + g.pieces.length + 1, 0);
    return { added, removed };
  }

  /** One area: its own atlas texture, base sprite and shard sprites. */
  build(r, rgba, sw, meta) {
    const rects = [r.base, ...r.pieces].map((o) => ({ sx: meta[o + 1], sy: meta[o + 2], w: meta[o + 3], h: meta[o + 4] }));
    const pk = pack(rects);
    const buf = new Uint8Array(pk.W * pk.H * 4);
    rects.forEach((q, i) => {
      const p = pk.pos[i];
      for ( let y = 0; y < q.h; y++ ) buf.set(rgba.subarray(((q.sy + y) * sw + q.sx) * 4, ((q.sy + y) * sw + q.sx + q.w) * 4), ((p.y + y) * pk.W + p.x) * 4);
    });
    const tex = new PIXI.BaseTexture(new PIXI.BufferResource(buf, { width: pk.W, height: pk.H }), {
      width: pk.W, height: pk.H, scaleMode: this.filter, mipmap: PIXI.MIPMAP_MODES.ON, alphaMode: PIXI.ALPHA_MODES.UNPACK,
      format: PIXI.FORMATS.RGBA, type: PIXI.TYPES.UNSIGNED_BYTE, wrapMode: PIXI.WRAP_MODES.CLAMP
    });
    this.stats.uploads++;
    const ap = this.ap, org = this.origin;
    const frame = (i) => new PIXI.Texture(tex, new PIXI.Rectangle(pk.pos[i].x, pk.pos[i].y, rects[i].w, rects[i].h));
    const b = r.base;
    const info = { hash: r.hash, x: meta[b + 5], y: meta[b + 6], w: meta[b + 3], h: meta[b + 4], ex: meta[b + 7], ey: meta[b + 8], R: meta[b + 9],
      type: TYPES[meta[b + 10]] ?? "blast", mat: meta[b + 11], axis: meta[b + 14] / 1000, len: meta[b + 15] / 10 };
    const baseCont = new PIXI.Container(), shardCont = new PIXI.Container();
    baseCont.eventMode = shardCont.eventMode = "none";
    baseCont.cullable = shardCont.cullable = true;   // off-screen areas are not drawn at all
    const baseSpr = new PIXI.Sprite(frame(0));
    baseSpr.eventMode = "none"; baseSpr.scale.set(ap);
    baseSpr.position.set(org.x + info.x * ap, org.y + info.y * ap);
    baseCont.addChild(baseSpr);
    const rect = { x0: info.x, y0: info.y, x1: info.x + info.w, y1: info.y + info.h };
    // the shard sprites are made a few hundred per frame (tick -> materialize): a big area has thousands, and making them all at
    // once held the page for ~50 ms
    const pieces = r.pieces.map((o, k) => {
      const w = meta[o + 3], h = meta[o + 4];
      const fx = meta[o + 5] + w / 2, fy = meta[o + 6] + h / 2;
      const flags = meta[o + 11];
      rect.x0 = Math.min(rect.x0, meta[o + 5], meta[o + 7]); rect.y0 = Math.min(rect.y0, meta[o + 6], meta[o + 8]);
      rect.x1 = Math.max(rect.x1, meta[o + 5] + w, meta[o + 7] + w); rect.y1 = Math.max(rect.y1, meta[o + 6] + h, meta[o + 8] + h);
      return { spr: null, frame: k + 1, fx, fy, sx: meta[o + 7] + w / 2, sy: meta[o + 8] + h / 2, rot: meta[o + 9] / 1000, dist: meta[o + 10] / 4,
        chip: !!(flags & 1), thrown: !!(flags & 2), moved: !!(flags & 4), z0: meta[o + 12] / 10, ptype: TYPES[meta[o + 13]] ?? info.type };
    });
    info.rect = rect;
    // culling by a fixed area (no bounds walk over thousands of shards each frame); room for flying pieces
    const m = 48, cull = new PIXI.Rectangle(org.x + (rect.x0 - m) * ap, org.y + (rect.y0 - m) * ap, (rect.x1 - rect.x0 + 2 * m) * ap, (rect.y1 - rect.y0 + 2 * m) * ap);
    baseCont.cullArea = cull; shardCont.cullArea = cull;
    const g = { hash: r.hash, tex, info, baseCont, shardCont, baseSpr, pieces, made: 0, frame, anim: null, fade: null, next: 0 };
    this.materialize(g, 300);
    return g;
  }

  /** Make up to `n` more shard sprites of a group (in order, so the drawing order stays); returns how many were made. */
  materialize(g, n) {
    const ap = this.ap, org = this.origin, end = Math.min(g.pieces.length, g.made + n), start = g.made;
    for ( ; g.made < end; g.made++ ) {
      const p = g.pieces[g.made];
      const spr = p.spr = new PIXI.Sprite(g.frame(p.frame));
      spr.eventMode = "none"; spr.anchor.set(0.5); spr.scale.set(ap);
      spr.position.set(org.x + p.fx * ap, org.y + p.fy * ap);
      if ( p.fading ) spr.alpha = 0;
      g.shardCont.addChild(spr);
      const it = g.anim?.byPiece?.get(p);
      if ( it ) this.place(p, Math.max(0, (performance.now() - it.t0) / it.dur), it, g.info.type);
    }
    if ( g.made >= g.pieces.length ) g.frame = null;
    return g.made - start;
  }

  /** An area that is gone: fades out; when a new area took its place, its base goes at once (the new one covers it). */
  retire(g, added) {
    const r = g.info.rect;
    const covered = added.some((a) => { const q = a.info.rect; return q.x0 < r.x1 && q.x1 > r.x0 && q.y0 < r.y1 && q.y1 > r.y0; });
    this.endAnim(g);
    if ( covered ) { g.baseCont.destroy({ children: true }); g.baseCont = null; }
    g.dieStart = performance.now();
    this.dying.push(g);
  }

  kill(g) {
    this.endAnim(g);
    for ( const p of g.pieces ) p.spr?.texture?.destroy(false);
    g.baseSpr?.texture?.destroy(false);
    if ( g.baseCont && !g.baseCont.destroyed ) g.baseCont.destroy({ children: true });
    if ( !g.shardCont.destroyed ) g.shardCont.destroy({ children: true });
    g.tex.destroy();
  }

  /* ---------------------------------------------------------------- entry */

  /**
   * The entry of a group. `start` (performance.now() time; may lie in the past for a late start), `o` the impact (art px; default the
   * area's epicentre), `dir` the stroke direction (unit, art px) or null, `box` the changed part (art px; null = all of it),
   * `fadeRest` fades the rest in (an area that replaced an older one).
   */
  enter(g, { start = performance.now(), o = null, dir = null, box = null, fadeRest = false } = {}) {
    this.endAnim(g);
    const now = performance.now();
    if ( !this.look.entry ) return;
    if ( reducedMotion() ) { g.fade = { start, dur: 300 }; this.applyFade(g, now); return; }
    const info = g.info, L = LOOK[info.type] ?? LOOK.blast, k = 1 / (this.look.speed || 1), pw = this.look.power;
    const ox = o?.[0] ?? info.ex, oy = o?.[1] ?? info.ey;
    const r = info.rect;
    const inBox = (x, y) => !box || (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1);
    // the front: radial from the impact, or a wipe along the stroke
    let wipe = null;
    const d = dir && Math.hypot(dir[0], dir[1]) > 0.1 ? [dir[0] / Math.hypot(dir[0], dir[1]), dir[1] / Math.hypot(dir[0], dir[1])] : null;
    if ( L.order === "wipe" || d ) {
      const u = d ?? [Math.cos(info.axis), Math.sin(info.axis)];
      const proj = [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].map(([x, y]) => (x - ox) * u[0] + (y - oy) * u[1]);
      wipe = { u, p0: Math.min(...proj, 0) - 2, p1: Math.max(...proj) + 2 };
    }
    const Rmax = Math.max(...[[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].map(([x, y]) => Math.hypot(x - ox, y - oy))) + 2;
    const delay = L.delay * k, reveal = L.reveal * k * (0.6 + 0.4 * Math.min(2, Rmax / 40));
    const front = (x, y) => {   // 0..1: when the front reaches (x, y)
      if ( wipe ) return clamp01((((x - ox) * wipe.u[0] + (y - oy) * wipe.u[1]) - wipe.p0) / (wipe.p1 - wipe.p0));
      const f = clamp01(Math.hypot(x - ox, y - oy) / Rmax);
      return L.order === "in" ? 1 - f : f;
    };
    const list = [], byPiece = new Map();
    for ( const p of g.pieces ) {
      if ( !inBox(p.sx, p.sy) ) continue;
      const dx = p.fx - p.sx, dy = p.fy - p.sy, dd = Math.hypot(dx, dy);
      const t0 = start + delay + reveal * Math.sqrt(front(p.sx, p.sy)) * 0.9;
      const dur = (p.thrown ? 380 + Math.min(420, dd * 14) : 260 + Math.min(200, dd * 30)) * L.flight * k;
      const arc = (p.thrown ? Math.max(4, dd * 0.55) : 1.5 + dd * 0.4) * L.arc * pw + (info.type === "cracks" ? 1.5 : 0);
      list.push({ p, t0, dur, arc, dusted: false });
      byPiece.set(p, list[list.length - 1]);
      this.place(p, 0, list[list.length - 1], info.type);
    }
    const mask = new PIXI.Graphics();
    g.baseCont.addChild(mask);
    g.baseSpr.mask = mask;
    g.anim = { start, delay, reveal, ox, oy, Rmax, wipe, box, list, byPiece, mask, fx: [], end: start + delay + reveal + 1400 * k, fired: new Set(), type: info.type, k, pw,
      fadeRest: fadeRest ? { start, dur: 260 } : null };
    if ( fadeRest ) for ( const p of g.pieces ) if ( !inBox(p.sx, p.sy) ) { p.fading = true; if ( p.spr ) p.spr.alpha = 0; }
    this.stats.entries++;
    this.drawMask(g, now);
  }

  /** Everything enters again (Detonate), from each area's own impact. */
  detonate(start) { for ( const g of this.order ) this.enter(g, { start }); }

  endAnim(g) {
    const a = g.anim; if ( !a ) return;
    g.anim = null;
    if ( g.baseSpr && !g.baseSpr.destroyed ) g.baseSpr.mask = null;
    if ( !a.mask.destroyed ) a.mask.destroy();
    for ( const f of a.fx ) if ( !f.g.destroyed ) f.g.destroy();
    for ( const p of g.pieces ) { p.fading = false; if ( !p.spr || p.spr.destroyed ) continue; this.place(p, 2, null, g.info.type); p.spr.alpha = 1; p.spr.tint = 0xFFFFFF; }
    if ( g.baseCont && !g.baseCont.destroyed ) g.baseCont.position.set(0, 0);
    g.shardCont.position.set(0, 0);
  }

  drawMask(g, now) {
    const a = g.anim, m = a.mask, ap = this.ap, o = this.origin, r = g.info.rect;
    const t = clamp01((now - a.start - a.delay) / a.reveal), e = a.type === "collapse" ? easeIn(t) : easeOut(t);
    m.clear().beginFill(0xFFFFFF);
    const X = (x) => o.x + x * ap, Y = (y) => o.y + y * ap;
    if ( a.wipe ) {
      const { u, p0, p1 } = a.wipe, f = p0 + (p1 - p0) * e, n = [-u[1], u[0]], B = a.Rmax + 4;
      const pts = [[p0, -B], [f, -B], [f, B], [p0, B]].map(([s, q]) => [a.ox + u[0] * s + n[0] * q, a.oy + u[1] * s + n[1] * q]);
      m.drawPolygon(pts.flatMap(([x, y]) => [X(x), Y(y)]));
    } else if ( a.type === "collapse" ) {
      // the pit opens from the rim inwards: everything but a shrinking disc at the centre
      const rr = a.Rmax * (1 - e);
      if ( rr <= 0.5 ) m.drawRect(X(r.x0 - 2), Y(r.y0 - 2), (r.x1 - r.x0 + 4) * ap, (r.y1 - r.y0 + 4) * ap);
      else {
        m.drawRect(X(r.x0 - 2), Y(r.y0 - 2), (r.x1 - r.x0 + 4) * ap, (r.y1 - r.y0 + 4) * ap);
        m.beginHole().drawCircle(X(a.ox), Y(a.oy), rr * ap).endHole();
      }
    } else m.drawCircle(X(a.ox), Y(a.oy), Math.max(0.01, a.Rmax * e) * ap);
    if ( a.box ) {
      // outside the changed part the area was already there: no reveal
      const b = a.box, x0 = r.x0 - 4, y0 = r.y0 - 4, x1 = r.x1 + 4, y1 = r.y1 + 4;
      for ( const [ax, ay, bx, by] of [[x0, y0, x1, b.y0], [x0, b.y1, x1, y1], [x0, b.y0, b.x0, b.y1], [b.x1, b.y0, x1, b.y1]] ) if ( bx > ax && by > ay ) m.drawRect(X(ax), Y(ay), (bx - ax) * ap, (by - ay) * ap);
    }
    m.endFill();
  }

  /** Position of a piece at flight time t (0 = at its source, 1 = landed, > 1 settling). */
  place(p, t, a, type) {
    const ap = this.ap, o = this.origin, s = p.spr;
    if ( !s ) return;
    if ( t >= 1 || !a ) {
      const b = a ? Math.min(1, (t - 1) / 0.35) : 1, hop = a && b < 1 ? Math.sin(b * Math.PI) * Math.min(2, a.arc * 0.15) * (1 - b) : 0;
      s.position.set(o.x + p.fx * ap, o.y + Math.round(p.fy - hop) * ap);
      s.rotation = 0;
      s.scale.set(ap, ap * (a && b < 0.25 ? 0.86 + b * 0.56 : 1));
      return;
    }
    const e = easeOut(Math.max(0, t));
    let x = p.sx + (p.fx - p.sx) * e, y = p.sy + (p.fy - p.sy) * e - a.arc * 4 * t * (1 - t);
    if ( type === "collapse" ) y -= 1.2 * Math.sin(Math.min(1, t * 2) * Math.PI) * (t < 0.5 ? 1 : 0);   // a small lift, then the drop
    s.position.set(o.x + Math.round(x) * ap, o.y + Math.round(y) * ap);
    s.rotation = p.rot * (1 - e);
    let sc = t <= 0 ? 1 : 1 + 0.12 * Math.sin(Math.min(1, t) * Math.PI);
    if ( type === "flood" ) sc = 1.06 - 0.06 * e;
    s.scale.set(ap * sc);
  }

  /* ---------------------------------------------------------------- particles (pooled) */

  spawn(q) {
    if ( this.particles.length > 260 ) return;
    let s = this.pool.pop();
    if ( !s || s.destroyed ) { s = new PIXI.Sprite(PIXI.Texture.WHITE); s.eventMode = "none"; this.fx.addChild(s); }
    s.visible = true; s.tint = q.color; s.alpha = q.alpha ?? 1;
    s.width = s.height = this.ap * (q.size ?? 1);
    q.spr = s; q.born ??= performance.now();
    this.particles.push(q);
  }

  burst(x, y, R, start, { n = 14 + Math.min(18, R), color = 0xcfc6b8, rise = -6, speed = 1 } = {}) {
    for ( let k = 0; k < n; k++ ) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.3, sp = (R * 0.6 + 4) * (0.7 + Math.random() * 0.6) * speed;
      this.spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8 - 2, life: 650 + Math.random() * 300, color, alpha: 0.85, size: Math.random() < 0.3 ? 2 : 1, born: start, drag: 2.6, rise });
    }
  }

  setIdle(on, who) { this.idle = { on, who }; }
  setLook({ entry, speed, power } = {}) {
    if ( entry !== undefined ) this.look.entry = !!entry;
    if ( speed !== undefined ) this.look.speed = speed;
    if ( power !== undefined ) this.look.power = power;
  }

  /* ---------------------------------------------------------------- frame */

  view() {
    const v = canvas.app.renderer.screen;
    const tl = canvas.stage.toLocal({ x: 0, y: 0 }), br = canvas.stage.toLocal({ x: v.width, y: v.height });
    const ap = this.ap, o = this.origin, m = 24;
    return { x0: (tl.x - o.x) / ap - m, y0: (tl.y - o.y) / ap - m, x1: (br.x - o.x) / ap + m, y1: (br.y - o.y) / ap + m };
  }

  tick() {
    const t0 = performance.now();
    if ( !canvas.stage ) return;
    // sampling: crisp when an art pixel covers 3+ screen pixels; below that NEAREST shimmers while zooming and panning (an art pixel
    // flips between 1 and 2 screen pixels), so it is LINEAR + mipmaps there
    const z = canvas.stage.scale.x * this.ap;
    const want = this.filter === NEAREST ? (z < 2.6 ? LINEAR : NEAREST) : (z > 3 ? NEAREST : LINEAR);
    if ( want !== this.filter ) { this.filter = want; for ( const g of this.groups.values() ) g.tex.scaleMode = want; }
    const vw = this.view();
    let budget = 350;
    for ( const g of this.order ) if ( budget > 0 && g.made < g.pieces.length ) budget -= this.materialize(g, budget);
    for ( const g of this.order ) {
      if ( g.fade ) this.applyFade(g, t0);
      if ( g.anim ) this.animate(g, t0, vw);
    }
    for ( let i = this.dying.length - 1; i >= 0; i-- ) {
      const g = this.dying[i], f = clamp01((t0 - g.dieStart) / 260);
      g.shardCont.alpha = 1 - f; if ( g.baseCont ) g.baseCont.alpha = 1 - f;
      if ( f >= 1 ) { this.kill(g); this.dying.splice(i, 1); }
    }
    this.idleTick(t0, vw);
    // particles: crisp art-pixel steps, fading by pixel dropout rather than soft alpha
    const ap = this.ap, o = this.origin;
    for ( let i = this.particles.length - 1; i >= 0; i-- ) {
      const q = this.particles[i], age = (t0 - q.born) / 1000;
      if ( age < 0 ) { q.spr.visible = false; continue; }
      if ( age * 1000 > q.life ) { q.spr.visible = false; this.pool.push(q.spr); this.particles[i] = this.particles[this.particles.length - 1]; this.particles.pop(); continue; }
      const k = q.drag ? (1 - Math.exp(-q.drag * age)) / q.drag : age;
      const x = q.x + q.vx * k, y = q.y + q.vy * k + (q.rise ?? 0) * age + (q.fall ?? 0) * age * age;
      q.spr.visible = (age * 1000) / q.life < 0.6 || ((Math.floor(t0 / 60) + (q.seed ??= (Math.random() * 7) | 0)) & 1) === 0;
      if ( q.flicker ) q.spr.tint = Math.floor(t0 / 90 + q.seed) % 3 ? q.color : 0xffd36b;
      q.spr.position.set(o.x + Math.round(x) * ap, o.y + Math.round(y) * ap);
    }
    this.stats.frameMs = performance.now() - t0;
  }

  applyFade(g, now) {
    const f = clamp01((now - g.fade.start) / g.fade.dur);
    g.shardCont.alpha = f; g.baseCont.alpha = f;
    if ( f >= 1 ) g.fade = null;
  }

  animate(g, now, vw) {
    const a = g.anim, info = g.info, type = a.type, r = info.rect;
    const onScreen = !(r.x0 > vw.x1 || r.y0 > vw.y1 || r.x1 < vw.x0 || r.y1 < vw.y0);
    if ( now < a.start ) { this.drawMask(g, a.start); return; }
    if ( now > a.end ) { this.endAnim(g); return; }
    const el = now - a.start, ap = this.ap;
    if ( onScreen ) this.drawMask(g, now);
    // collapse: the ground trembles before it gives
    if ( type === "collapse" ) {
      const j = el < a.delay ? (((Math.floor(el / 45) & 1) ? 1 : -1) * ap) : 0;
      g.shardCont.position.set(j, 0); g.baseCont.position.set(j, 0);
    }
    let busy = false;
    for ( const it of a.list ) {
      const t = (now - it.t0) / it.dur;
      if ( onScreen || t >= 1 ) this.place(it.p, Math.max(0, t), it, type);
      if ( t < 1.35 ) busy = true;
      if ( it.p.spr ) {
        if ( type === "scorch" ) it.p.spr.tint = lerpColor(0xffa060, 0xffffff, clamp01(t));
        else if ( type === "flood" ) it.p.spr.tint = lerpColor(0xffffff, 0xb8d4ff, clamp01(t) * 0.7);
      }
      if ( onScreen && t >= 1 && !it.dusted ) {
        it.dusted = true;
        if ( it.p.thrown ) for ( let q = 0; q < 3; q++ ) this.spawn({ x: it.p.fx + (Math.random() - 0.5) * 3, y: it.p.fy + 1, vx: (Math.random() - 0.5) * 8, vy: -2 - Math.random() * 3, life: 420, color: 0xd8d0c2, alpha: 0.8, drag: 3 });
        else if ( type === "cracks" && Math.random() < 0.3 ) this.spawn({ x: it.p.fx, y: it.p.fy, vx: (Math.random() - 0.5) * 4, vy: -1, rise: -3, life: 500, color: 0xc8beb0, alpha: 0.7 });
      }
    }
    if ( a.fadeRest ) {
      const f = clamp01((now - a.fadeRest.start) / a.fadeRest.dur);
      for ( const p of g.pieces ) if ( p.fading ) { if ( p.spr ) p.spr.alpha = f; if ( f >= 1 ) p.fading = false; }
      if ( f >= 1 ) a.fadeRest = null;
    }
    if ( onScreen ) this.effects(g, a, now, el);
    if ( !busy && el > a.delay + a.reveal + 200 && !a.fx.length ) this.endAnim(g);
  }

  /** The type's own effects: one-shots at fixed moments, and what rides on the front. */
  effects(g, a, now, el) {
    const type = a.type, ap = this.ap, o = this.origin, pw = a.pw, k = a.k;
    const once = (key, at, fn) => { if ( el >= at && !a.fired.has(key) ) { a.fired.add(key); fn(); } };
    const X = (x) => o.x + x * ap, Y = (y) => o.y + y * ap;
    const R = Math.max(4, g.info.R);
    const tFront = clamp01((el - a.delay) / a.reveal);
    const frontR = a.Rmax * easeOut(tFront);
    const ring = (key, at, color, maxR, dur, width) => once(key, at, () => {
      const gr = new PIXI.Graphics(); gr.eventMode = "none"; this.fx.addChild(gr);
      a.fx.push({ g: gr, kind: "ring", t0: a.start + at, dur, color, maxR, width });
    });
    if ( type === "blast" ) {
      once("flash", 0, () => {
        const gr = new PIXI.Graphics(); gr.eventMode = "none"; gr.blendMode = PIXI.BLEND_MODES.ADD; this.fx.addChild(gr);
        a.fx.push({ g: gr, kind: "flash", t0: a.start, dur: 170 * k, color: 0xfff1c4, maxR: R * 0.9 * pw });
      });
      ring("ring", 30 * k, 0xf3e6cc, R * 1.9 * pw, 430 * k, 2);
      once("dust", 60 * k, () => this.burst(a.ox, a.oy, R * pw, now));
      once("rain", 260 * k, () => { for ( let q = 0; q < Math.round(10 * pw); q++ ) { const ang = Math.random() * 6.28, d = R * (0.5 + Math.random()); this.spawn({ x: a.ox + Math.cos(ang) * d, y: a.oy + Math.sin(ang) * d * 0.8 - 6, vx: 0, vy: 0, fall: 40, life: 380, color: 0x4a3f36, size: Math.random() < 0.4 ? 2 : 1 }); } });
    } else if ( type === "collapse" ) {
      once("crack", 0, () => { for ( let q = 0; q < 8; q++ ) this.spawn({ x: a.ox + (Math.random() - 0.5) * R, y: a.oy + (Math.random() - 0.5) * R * 0.8, vx: 0, vy: 0, rise: -2, life: 300, color: 0xbdb3a4, alpha: 0.6 }); });
      once("billow", a.delay + a.reveal * 0.75, () => this.burst(a.ox, a.oy, R * 0.6 * pw, now, { rise: -10, speed: 0.6, color: 0xb9ae9e }));
    } else if ( type === "scorch" ) {
      if ( tFront < 1 && Math.random() < 0.9 ) for ( let q = 0; q < 2; q++ ) {
        const ang = Math.random() * 6.28;
        this.spawn({ x: a.ox + Math.cos(ang) * frontR, y: a.oy + Math.sin(ang) * frontR * 0.85, vx: (Math.random() - 0.5) * 3, vy: 0, rise: -5 - Math.random() * 5, life: 600 + Math.random() * 500, color: 0xff9a3c, flicker: true });
      }
      once("smoke", a.reveal * 0.4, () => { for ( let q = 0; q < 6; q++ ) this.spawn({ x: a.ox + (Math.random() - 0.5) * R, y: a.oy + (Math.random() - 0.5) * R * 0.6, vx: 0.5, vy: 0, rise: -4 - Math.random() * 3, life: 1500, color: 0x5a524c, alpha: 0.7, size: 2 }); });
      ring("glow", 0, 0xffb060, R * 0.8 * pw, 300 * k, 1);
    } else if ( type === "flood" ) {
      ring("r1", a.delay + a.reveal * 0.3, 0xcfe8ff, R * 0.9 * pw, 650 * k, 1);
      ring("r2", a.delay + a.reveal * 0.6, 0xcfe8ff, R * 0.7 * pw, 600 * k, 1);
      ring("r3", a.delay + a.reveal * 0.9, 0x9fc8ee, R * 0.5 * pw, 550 * k, 1);
      if ( tFront < 1 && Math.random() < 0.5 ) { const ang = Math.random() * 6.28; this.spawn({ x: a.ox + Math.cos(ang) * frontR * 0.8, y: a.oy + Math.sin(ang) * frontR * 0.6, vx: 0, vy: 0, rise: -2, life: 400, color: 0xe6f4ff, alpha: 0.9 }); }
    } else if ( type === "cracks" ) {
      if ( tFront < 1 && Math.random() < 0.6 ) { const ang = Math.random() * 6.28; this.spawn({ x: a.ox + Math.cos(ang) * frontR, y: a.oy + Math.sin(ang) * frontR * 0.85, vx: 0, vy: 0, rise: -3, life: 380, color: 0xc8beb0, alpha: 0.7 }); }
    } else if ( type === "gash" && a.wipe ) {
      // sparks and splinters on the claw's leading edge
      if ( tFront < 1 ) {
        const { u, p0, p1 } = a.wipe, f = p0 + (p1 - p0) * easeOut(tFront), n = [-u[1], u[0]];
        for ( let q = 0; q < 2; q++ ) {
          const off = (Math.random() - 0.5) * Math.max(6, g.info.R * 1.4);
          const x = a.ox + u[0] * f + n[0] * off, y = a.oy + u[1] * f + n[1] * off;
          this.spawn({ x, y, vx: u[0] * 18 + (Math.random() - 0.5) * 10, vy: u[1] * 18 - 6 + (Math.random() - 0.5) * 6, fall: 30, life: 260 + Math.random() * 200, color: Math.random() < 0.5 ? 0xfff0b0 : 0xffc860, drag: 2 });
        }
      }
    }
    // rings and flashes
    for ( let i = a.fx.length - 1; i >= 0; i-- ) {
      const f = a.fx[i], t = (now - f.t0) / f.dur;
      if ( t >= 1 ) { f.g.destroy(); a.fx.splice(i, 1); continue; }
      if ( t < 0 ) continue;
      f.g.clear();
      if ( f.kind === "flash" ) f.g.beginFill(f.color, 0.9 * (1 - t)).drawCircle(X(a.ox), Y(a.oy), f.maxR * (0.6 + 0.6 * t) * ap).endFill();
      else f.g.lineStyle(Math.max(1, f.width * ap), f.color, 0.85 * (1 - t)).drawEllipse(X(a.ox), Y(a.oy), f.maxR * easeOut(t) * ap, f.maxR * easeOut(t) * 0.8 * ap);
    }
  }

  idleTick(now, vw) {
    if ( !this.idle.on || reducedMotion() || (this.idle.who === "gm" && !game.user.isGM) || !this.order.length ) return;
    for ( const g of this.order ) {
      const ar = g.info;
      if ( g.anim || ar.x > vw.x1 || ar.y > vw.y1 || ar.x + ar.w < vw.x0 || ar.y + ar.h < vw.y0 ) continue;
      if ( now < g.next ) continue;
      const rate = ar.type === "scorch" ? 700 : ar.type === "blast" ? 1800 : ar.type === "collapse" ? 1500 : 3500;
      g.next = now + rate * (0.6 + Math.random() * 0.8);
      const a = Math.random() * Math.PI * 2, r = ar.R * (0.4 + Math.random() * 0.6);
      const x = ar.ex + Math.cos(a) * r, y = ar.ey + Math.sin(a) * r * 0.8;
      if ( ar.type === "scorch" || (ar.type === "blast" && Math.random() < 0.5) ) {
        this.spawn({ x, y, vx: (Math.random() - 0.5) * 3, vy: 0, rise: -6 - Math.random() * 5, life: 1300 + Math.random() * 900, color: 0xff9a3c, flicker: true });
        if ( Math.random() < 0.5 ) this.spawn({ x: x + 1, y, vx: 0, vy: 0, rise: -3, life: 1600, color: 0x5a524c, alpha: 0.7, size: 2 });
      } else if ( ar.type === "collapse" ) {
        const sx = ar.ex + Math.cos(a) * ar.R * 0.9, sy = ar.ey + Math.sin(a) * ar.R * 0.7;
        this.spawn({ x: sx, y: sy, vx: (ar.ex - sx) * 0.15, vy: 0, fall: 14, life: 700, color: 0x3a3028 });
      } else if ( ar.type === "flood" ) {
        this.spawn({ x: ar.ex + Math.cos(a) * r * 0.5, y: ar.ey + Math.sin(a) * r * 0.4, vx: 1.5, vy: 0, life: 900, color: 0xcfe8ff, alpha: 0.9 });
      } else {
        for ( let k = 0; k < 3; k++ ) this.spawn({ x: x + k, y, vx: (Math.random() - 0.5) * 2, vy: 0, rise: -2.5, life: 1100, color: 0xc8beb0, alpha: 0.7 });
      }
    }
  }

  clear() {
    for ( const g of [...this.groups.values(), ...this.dying] ) this.kill(g);
    this.groups.clear(); this.order = []; this.dying = [];
    for ( const q of this.particles ) { q.spr.visible = false; this.pool.push(q.spr); }
    this.particles = [];
    this.stats.groups = this.stats.sprites = 0;
  }

  destroy() {
    canvas.app?.ticker?.remove(this._tick);
    this.clear();
    for ( const c of [this.base, this.shards, this.fx] ) if ( !c.destroyed ) c.destroy({ children: true });
  }
}
