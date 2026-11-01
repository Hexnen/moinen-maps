import { META_FIELDS } from "./core.mjs";
import { reducedMotion } from "../config.mjs";

/**
 * Shows a bake: the damage layer (one sprite per area) and the shards (sprites from the same sheet) in the primary group, between the
 * map and the tiles/tokens: damage at sortLayer 247 and shards at 248 (above water 240 and roads 245, below districts 250), dust and
 * embers at 249. Textures are nearest-neighbour so the pixel art stays crisp.
 *
 * The break: shards start where they were cut from (the map looks whole), pop, fly and settle with a small bounce, staggered by their
 * distance from the impact; a dust ring rises at each impact. Cosmetic, driven by a shared start time, nothing is written.
 * Idle: now and then a puff of dust at a rim, embers over a burn, a pebble trickling into a pit, a glint on flood water.
 */
const TYPES = ["blast", "collapse", "scorch", "flood", "cracks", "gash"];

function layer(sortLayer) {
  const c = new PIXI.Container();
  c.eventMode = "none";
  Object.assign(c, { elevation: 0, sortLayer, sort: 0, _lastSortedIndex: 0 });
  canvas.primary.addChild(c);
  return c;
}

const easeOut = (t) => 1 - (1 - t) ** 3;

export class DestructionDisplay {
  constructor() {
    this.base = layer(247);
    this.shards = layer(248);
    this.fx = layer(249);
    this.tex = null;
    this.areas = [];
    this.pieces = [];
    this.anims = null;
    this.particles = [];
    this.idle = { on: true, who: "all" };
    this.stats = { frameMs: 0, sprites: 0 };
    this._tick = () => this.tick();
    canvas.app.ticker.add(this._tick);
  }

  /** Show a decoded sheet: `canvasEl` (the image), `meta` (placement table), art pixel size and the scene origin. */
  show(canvasEl, meta, ap, origin) {
    this.clear();
    const base = PIXI.BaseTexture.from(canvasEl, { scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF });
    this.tex = base;
    this.ap = ap; this.origin = origin;
    const n = meta.length / META_FIELDS;
    for ( let k = 0; k < n; k++ ) {
      const o = k * META_FIELDS, kind = meta[o];
      const frame = new PIXI.Texture(base, new PIXI.Rectangle(meta[o + 1], meta[o + 2], meta[o + 3], meta[o + 4]));
      const spr = new PIXI.Sprite(frame);
      spr.eventMode = "none";
      spr.scale.set(ap);
      if ( kind === 0 ) {
        spr.position.set(origin.x + meta[o + 5] * ap, origin.y + meta[o + 6] * ap);
        this.base.addChild(spr);
        this.areas.push({ spr, ex: meta[o + 7], ey: meta[o + 8], R: meta[o + 9], type: TYPES[meta[o + 10]] ?? "blast", mat: meta[o + 11], x: meta[o + 5], y: meta[o + 6], w: meta[o + 3], h: meta[o + 4], next: 0 });
      } else {
        const w = meta[o + 3], h = meta[o + 4];
        spr.anchor.set(0.5);
        const fx = meta[o + 5] + w / 2, fy = meta[o + 6] + h / 2;
        spr.position.set(origin.x + fx * ap, origin.y + fy * ap);
        this.shards.addChild(spr);
        const flags = meta[o + 11];
        this.pieces.push({ spr, fx, fy, sx: meta[o + 7] + w / 2, sy: meta[o + 8] + h / 2, rot: meta[o + 9] / 1000, dist: meta[o + 10] / 4,
          area: flags >> 4, chip: !!(flags & 1), thrown: !!(flags & 2), moved: !!(flags & 4) });
      }
    }
    this.stats.sprites = n;
  }

  /**
   * Play the break for the pieces whose source lies in `box` (art pixels { x0, y0, x1, y1 }; all when null), starting at `start`
   * (performance.now() time). Reduced motion: nothing moves.
   */
  play(box, start = performance.now()) {
    if ( reducedMotion() || !this.pieces.length ) return;
    const sel = this.pieces.filter((p) => p.moved && (!box || (p.sx >= box.x0 && p.sx <= box.x1 && p.sy >= box.y0 && p.sy <= box.y1)));
    if ( !sel.length ) return;
    const areas = new Set(sel.map((p) => p.area));
    this.anims = { start, list: sel.map((p) => {
      const dx = p.fx - p.sx, dy = p.fy - p.sy, d = Math.hypot(dx, dy);
      const dur = p.thrown ? 380 + Math.min(420, d * 14) : 260 + Math.min(200, d * 30);
      return { p, delay: Math.min(500, p.dist * 9), dur, arc: p.thrown ? Math.max(4, d * 0.55) : 1.5 + d * 0.4 };
    }) };
    for ( const a of this.anims.list ) this.place(a.p, 0, a);
    // a ring of dust at each impact
    for ( const ar of this.areas ) if ( areas.has(this.areas.indexOf(ar)) ) this.burst(ar, start);
  }

  place(p, t, a) {
    const ap = this.ap, o = this.origin, s = p.spr;
    if ( t >= 1 ) {
      // settle: a short bounce after the landing
      const b = Math.min(1, (t - 1) / 0.35), hop = b < 1 ? Math.sin(b * Math.PI) * Math.min(2, a.arc * 0.15) * (1 - b) : 0;
      s.position.set(o.x + p.fx * ap, o.y + Math.round(p.fy - hop) * ap);
      s.rotation = 0;
      s.scale.set(ap, ap * (b < 0.25 ? 0.86 + b * 0.56 : 1));
      return;
    }
    const e = easeOut(Math.max(0, t));
    const x = p.sx + (p.fx - p.sx) * e, y = p.sy + (p.fy - p.sy) * e - a.arc * 4 * t * (1 - t);
    s.position.set(o.x + Math.round(x) * ap, o.y + Math.round(y) * ap);
    s.rotation = p.rot * (1 - e);
    const pop = t <= 0 ? 1 : 1 + 0.12 * Math.sin(Math.min(1, t) * Math.PI);
    s.scale.set(ap * pop);
  }

  burst(ar, start) {
    const n = 14 + Math.min(18, ar.R);
    for ( let k = 0; k < n; k++ ) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.3, sp = (ar.R * 0.6 + 4) * (0.7 + Math.random() * 0.6);
      this.spawn({ x: ar.ex, y: ar.ey, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8 - 2, life: 650 + Math.random() * 300, color: 0xcfc6b8, alpha: 0.85, size: Math.random() < 0.3 ? 2 : 1, born: start, drag: 2.6, rise: -6 });
    }
  }

  spawn(q) {
    if ( this.particles.length > 220 ) return;
    const s = new PIXI.Sprite(PIXI.Texture.WHITE);
    s.eventMode = "none"; s.tint = q.color; s.alpha = q.alpha ?? 1;
    s.width = s.height = this.ap * (q.size ?? 1);
    this.fx.addChild(s);
    q.spr = s; q.born ??= performance.now();
    this.particles.push(q);
  }

  setIdle(on, who) { this.idle = { on, who }; }

  tick() {
    const t0 = performance.now();
    if ( this.anims ) {
      let busy = false;
      for ( const a of this.anims.list ) {
        const t = (t0 - this.anims.start - a.delay) / a.dur;
        this.place(a.p, Math.max(0, t), a);
        if ( t < 1.35 ) busy = true;
        else if ( !a.landed ) { a.landed = true; }
        if ( t >= 1 && !a.dusted && a.p.thrown ) { a.dusted = true; for ( let k = 0; k < 3; k++ ) this.spawn({ x: a.p.fx + (Math.random() - 0.5) * 3, y: a.p.fy + 1, vx: (Math.random() - 0.5) * 8, vy: -2 - Math.random() * 3, life: 420, color: 0xd8d0c2, alpha: 0.8, drag: 3 }); }
      }
      if ( !busy ) { for ( const a of this.anims.list ) this.place(a.p, 2, a); this.anims = null; }
    }
    this.idleTick(t0);
    // particles: crisp art-pixel steps, fading by pixel dropout rather than soft alpha
    const ap = this.ap, o = this.origin;
    for ( let i = this.particles.length - 1; i >= 0; i-- ) {
      const q = this.particles[i], age = (t0 - q.born) / 1000;
      if ( age < 0 ) { q.spr.visible = false; continue; }
      if ( age * 1000 > q.life ) { q.spr.destroy(); this.particles.splice(i, 1); continue; }
      const k = q.drag ? (1 - Math.exp(-q.drag * age)) / q.drag : age;
      const x = q.x + q.vx * k, y = q.y + q.vy * k + (q.rise ?? 0) * age + (q.fall ?? 0) * age * age;
      q.spr.visible = (age * 1000) / q.life < 0.6 || ((Math.floor(t0 / 60) + i) & 1) === 0;
      if ( q.flicker ) q.spr.tint = Math.floor(t0 / 90 + i) % 3 ? q.color : 0xffd36b;
      q.spr.position.set(o.x + Math.round(x) * ap, o.y + Math.round(y) * ap);
    }
    this.stats.frameMs = performance.now() - t0;
  }

  idleTick(now) {
    if ( !this.idle.on || reducedMotion() || (this.idle.who === "gm" && !game.user.isGM) || !this.areas.length ) return;
    const v = canvas.dimensions && canvas.stage ? canvas.app.renderer.screen : null;
    if ( !v ) return;
    const tl = canvas.stage.toLocal({ x: 0, y: 0 }), br = canvas.stage.toLocal({ x: v.width, y: v.height });
    const ap = this.ap, o = this.origin;
    for ( const ar of this.areas ) {
      const x0 = o.x + ar.x * ap, y0 = o.y + ar.y * ap;
      if ( x0 > br.x || y0 > br.y || x0 + ar.w * ap < tl.x || y0 + ar.h * ap < tl.y ) continue;
      if ( now < ar.next ) continue;
      const rate = ar.type === "scorch" ? 700 : ar.type === "blast" ? 1800 : ar.type === "collapse" ? 1500 : 3500;
      ar.next = now + rate * (0.6 + Math.random() * 0.8);
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
    this.anims = null;
    for ( const p of this.pieces ) p.spr.texture?.destroy(false);
    for ( const a of this.areas ) a.spr.texture?.destroy(false);
    for ( const c of [this.base, this.shards, this.fx] ) for ( const ch of c.removeChildren() ) ch.destroy();
    this.tex?.destroy(); this.tex = null;
    this.pieces = []; this.areas = []; this.particles = [];
  }

  destroy() {
    canvas.app?.ticker?.remove(this._tick);
    this.clear();
    for ( const c of [this.base, this.shards, this.fx] ) if ( !c.destroyed ) c.destroy({ children: true });
  }
}
