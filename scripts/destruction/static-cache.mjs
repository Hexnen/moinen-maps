import { MODULE_ID } from "../config.mjs";

/**
 * STATIC CACHE of the destruction layer (PERF). Every damage object (map patch + ruin + shards, an erase stroke, ...) is a container in
 * `display.live`, in creation order. Drawn live that was ~45k shard sprites and ~150 sprite-mask passes per frame on a busy scene
 * (16-26 ms CPU + 11-18 ms GPU). Instead, what does not move is drawn ONCE into render textures (BANDS) and only what moves is drawn
 * live, in the right order:
 *
 *  - UNITS: every object is one unit, except that a flooded hole's water (an animated loop, flood.mjs) is a unit of its own on top of
 *    its object. A unit is LIVE when it moves: an entry, a cross-fade, a dissolving erase stroke, a fading or held old look, shards
 *    still being made, a visible pulsing cause bloom, the water.
 *  - LEVELS: static units sit on even levels (band 0, band 1, ...), live units on odd ones (run 0, run 1, ...). A unit's level is the
 *    lowest one of its parity that is not below any EARLIER unit it overlaps (strictly above when the parity differs). Two units that
 *    do not overlap commute, so drawing band 0, run 0, band 1, run 1, ... (each in creation order) gives the same pixels as drawing
 *    everything live. Usually: band 0 = nearly everything, run 0 = the moving stroke(s) and the water, band 1 = the few later strokes
 *    lying over the water.
 *  - A band is drawn into render textures covering its own content (sparse tiles: none where no member lies), re-drawn only when
 *    its members change (an entry ends, water arrives, a new bake is shown), on a sampling switch (the atlases' NEAREST/LINEAR, with
 *    the display's own hysteresis), a GL context loss, or a density / window change. A band whose members did not change keeps its
 *    textures (a new stroke entering on top re-draws nothing underneath).
 *  - SCENE mode: 1 texel per scene pixel (mipmapped: zoomed out it is sampled like the live atlases), all bands together capped at
 *    16 MPx (big scenes get less). VIEW mode, zoomed in past 1.4 screen px per texel: the bands only around the view at 1 texel per
 *    screen pixel (the same pixels as live); re-drawn when the view leaves its window or the zoom changes by 15%.
 *  - Off: `CONFIG.moinenMaps.noDestructionCache = true` or the client setting "destructionCache".
 * Passes hide objects with `renderable` (never `visible`: the cause lights read `visible`). While the cache shows, `live` itself is not
 * visible (its sprites are not even transformed) and RUN objects update and draw the live units from it, in order.
 */
const MAX_MPX = 16e6;
const LIVE_SHARE = 0.7;        // more than this share of the objects moving (a Detonate): no cache at all, no bake
const MOVE_MARGIN = 48;        // art px around a moving object (flying pieces, shakes)

export const cacheEnabled = () => {
  if ( globalThis.CONFIG?.moinenMaps?.noDestructionCache ) return false;
  try { return game.settings.get(MODULE_ID, "destructionCache") !== false; } catch { return true; }
};

/**
 * Pure: the level of every unit (render order). `units[i]` = { r: {x0,y0,x1,y1}, live: bool, m: margin }. Statics get even levels,
 * live units odd ones; a unit is never below an earlier unit it overlaps (strictly above across parities). O(n^2) rectangle tests.
 */
export function levels(units) {
  const lv = new Array(units.length);
  for ( let i = 0; i < units.length; i++ ) {
    const u = units[i], par = u.live ? 1 : 0;
    let L = par;
    for ( let j = 0; j < i; j++ ) {
      const q = units[j], m = Math.max(u.m ?? 0, q.m ?? 0);
      if ( q.r.x0 >= u.r.x1 + m || q.r.x1 <= u.r.x0 - m || q.r.y0 >= u.r.y1 + m || q.r.y1 <= u.r.y0 - m ) continue;
      const need = lv[j] + ((lv[j] & 1) === par ? 0 : 1);
      if ( need > L ) L = need;
    }
    lv[i] = L;
  }
  return lv;
}

/** Texels per scene pixel for the cache: 1 (zoomed out) or up to 3 (zoomed in), capped so a scene-sized band stays under MAX_MPX. */
export function cacheRes(sceneW, sceneH, zoomedIn = false) {
  const cap = Math.sqrt(MAX_MPX / Math.max(1, sceneW * sceneH));
  if ( zoomedIn ) return Math.max(Math.min(1, cap), Math.min(3, Math.floor(cap * 4) / 4));
  return cap >= 1 ? 1 : Math.max(0.25, Math.floor(cap * 8) / 8);
}

/**
 * Mip levels for a band: zoomed out the live atlases are sampled with mipmaps; a band without them aliases (5% of the pixels off by
 * more than 60 at zoom 0.5). PIXI 7 does not build them for render textures, so: generate them by hand once after the band is drawn.
 */
function mipmaps(R, rt) {
  const gl = R.gl; if ( !gl ) return;
  R.renderTexture.bind(null);
  R.texture.bind(rt.baseTexture, 0);
  const gt = rt.baseTexture._glTextures?.[R.CONTEXT_UID]; if ( !gt ) return;
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gt.mipmap = true;
  rt.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
}

/** Draws given display objects (living elsewhere in the tree, their transforms kept current there) at its place in the order. */
class Run extends PIXI.Container {
  constructor(live) { super(); this.live = live; this.items = []; this.eventMode = "none"; }
  render(renderer) {
    if ( !this.visible || !this.items.length ) return;
    // `live` is not visible while the cache shows (so its ~45k sprites are not even transformed): bring what this run draws up to date
    const live = this.live, p = live.parent; if ( !p ) return;
    live.transform.updateTransform(p.transform); live.worldAlpha = live.alpha * p.worldAlpha;
    for ( const o of this.items ) {
      if ( o.destroyed || !o.parent ) continue;
      if ( o.parent !== live ) { const c = o.parent; c.transform.updateTransform(live.transform); c.worldAlpha = c.alpha * live.worldAlpha; }
      o.updateTransform();
      o.render(renderer);
    }
  }
}

export class StaticCache {
  constructor(display) {
    this.d = display;
    this.show = new PIXI.Container(); this.show.eventMode = "none"; this.show.visible = false;
    display.objs.addChild(this.show);                   // over `live`, which is not drawn while this shows
    this.bands = [];                                     // [{ tiles: [{ rt, spr, x, y, w, h }] }]
    this.dirty = true; this.sig = ""; this.liveAll = true; this.mode = "live"; this.runs = [];
    this.ids = new WeakMap(); this.nextId = 1;
    this.stats = { bakes: 0, bakeMs: 0, units: 0, live: 0, bands: 0, mode: "live", res: 0, tiles: 0, mpx: 0 };
    this._ctx = { contextChange: () => { this.dirty = true; } };
    canvas.app.renderer.runners?.contextChange?.add(this._ctx);
  }

  /** Re-draw every band at the next frame (a lost GL context, a cleared display). Membership changes are found by themselves. */
  invalidate() { this.dirty = true; }

  /** The units of the layer, in render order: [{ obj (what to draw live), cont, r, live, m, water?: sprite, owner?: unit }]. */
  units() {
    const d = this.d, kids = d.live.children;
    const ent = new Map(), dying = new Set(d.dying);
    for ( const g of d.groups.values() ) ent.set(g.cont, g);
    for ( const g of d.dying ) ent.set(g.cont, g);
    for ( const e of d.erasers.values() ) ent.set(e.cont, e);
    const out = [];
    for ( const k of kids ) {
      const g = ent.get(k);
      // something in the layer the cache does not know: live, over everything
      if ( !g ) { out.push({ obj: k, cont: k, r: { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 }, live: true, m: 0 }); continue; }
      if ( g.erase ) { const mv = !!(g.dis || g.leaving); out.push({ obj: k, cont: k, r: g.info.rect, live: mv, m: mv ? 4 : 0 }); continue; }
      const mv = dying.has(g) || !!g.anim || !!g.fade || g.made < g.pieces.length || k.alpha < 1;
      const bloom = g.light?.bloom, glow = !!(bloom && !bloom.destroyed && bloom.alpha > 0.003);
      const extras = k.children.filter((ch) => ch !== g.patch && ch !== g.baseCont && ch !== g.shardCont);
      const self = { obj: k, cont: k, r: g.info.rect, live: mv || glow, m: mv ? MOVE_MARGIN : 0, extras };
      out.push(self);
      // the water of a flooded hole: its own live unit on top of its (static) object
      if ( !self.live ) for ( const w of extras ) out.push({ obj: w, cont: k, r: g.info.rect, live: true, m: 0, water: w, owner: self });
    }
    return out;
  }

  /** Once per frame, after the display's tick. */
  update() {
    const d = this.d, kids = d.live.children, sr = canvas.dimensions?.sceneRect, R = canvas.app?.renderer;
    if ( !cacheEnabled() || !kids.length || !sr || !R ) return this.allLive("off");
    const U = this.units();
    const moving = U.reduce((a, u) => a + (u.live && !u.water ? 1 : 0), 0);
    if ( moving > kids.length * LIVE_SHARE ) return this.allLive("busy");
    const z = canvas.stage.scale.x * (R.resolution || 1);
    const zoomedIn = d.filter === 0;                     // the atlases are sampled NEAREST
    let res = globalThis.CONFIG?.moinenMaps?.destructionCacheRes ?? cacheRes(sr.width, sr.height, false);   // (dev knob)
    const eff = Math.min(res, this.capRes ?? res);       // what the memory cap allowed at the last scene-wide bake
    // zoomed in further than the scene-wide bands can show sharply (more than 1.4 screen px per texel): VIEW mode, the bands only
    // around the view (half a view of margin each side), 1 texel per screen pixel (exact); kept while the view stays inside the window
    // and the zoom within 15%, then drawn again (hysteresis both ways: back to scene-wide below 1.2)
    const inView = !!this.win;
    const needView = z > eff * (inView ? 1.2 : 1.4);
    if ( needView ) {
      const v = this.viewRect(), w = this.win;
      if ( !w || v.x0 < w.x0 || v.y0 < w.y0 || v.x1 > w.x1 || v.y1 > w.y1 || z / w.res > 1.15 || w.res / z > 1.15 ) {
        const mx = (v.x1 - v.x0) * 0.5, my = (v.y1 - v.y0) * 0.5;
        this.win = { x0: Math.floor(v.x0 - mx), y0: Math.floor(v.y0 - my), x1: Math.ceil(v.x1 + mx), y1: Math.ceil(v.y1 + my), res: Math.round(z * 100) / 100 };
        this.stats.windows = (this.stats.windows ?? 0) + 1;
      }
      res = this.win.res;
    } else this.win = null;
    const W = this.win;
    const lv = levels(U);
    const sig = `${U.length}|${res}|${d.filter}|${W ? `${W.x0},${W.y0},${W.x1},${W.y1}` : "scene"}|${U.map((u, i) => (u.live ? "L" : "") + lv[i]).join(",")}`;
    if ( this.dirty || sig !== this.sig || this.bands.some((b) => b.tiles.some((t) => !t.rt.valid || t.rt.baseTexture.destroyed)) ) {
      this.bake(U, lv, sr, res, !zoomedIn && !W, W);
      this.sig = sig; this.dirty = false;
    }
    // the runs: the live units of each odd level, in order
    for ( const run of this.runs ) run.items.length = 0;
    for ( let i = 0; i < U.length; i++ ) if ( lv[i] & 1 ) this.runs[lv[i] >> 1]?.items.push(U[i].obj);
    for ( const k of kids ) k.renderable = true;
    for ( const u of U ) if ( u.water ) u.water.renderable = true;
    this.align(z);
    d.live.visible = false;
    this.show.visible = true;
    this.liveAll = false; this.mode = this.stats.mode = (W ? "view" : "scene") + (moving || U.some((u) => u.water) ? "+live" : "");
    this.stats.units = U.length; this.stats.live = U.filter((u) => u.live).length;
  }

  /**
   * When a texel is a screen pixel (a view window at its own zoom, the scene bands at zoom 1), put every tile on whole screen pixels:
   * a pan leaves the canvas at fractional offsets and the cache would be resampled half a pixel off (blurred). The shift is under half
   * a screen pixel.
   */
  align(z) {
    const M = this.show.parent?.worldTransform, res = this.stats.res; if ( !M ) return;
    const one = Math.abs(z / res - 1) < 0.01, a = M.a, dpr = canvas.app.renderer.resolution || 1;
    for ( const b of this.bands ) for ( const t of b.tiles ) {
      if ( !one ) { t.spr.position.set(t.x, t.y); continue; }
      const sx = (a * t.x + M.tx) * dpr, sy = (M.d * t.y + M.ty) * dpr;
      t.spr.position.set(t.x + (Math.round(sx) - sx) / (a * dpr), t.y + (Math.round(sy) - sy) / (M.d * dpr));
    }
  }

  /** The visible part of the canvas (canvas px). */
  viewRect() {
    const v = canvas.app.renderer.screen, tl = canvas.stage.toLocal({ x: 0, y: 0 }), br = canvas.stage.toLocal({ x: v.width, y: v.height });
    return { x0: Math.min(tl.x, br.x), y0: Math.min(tl.y, br.y), x1: Math.max(tl.x, br.x), y1: Math.max(tl.y, br.y) };
  }

  allLive(why) {
    if ( !this.liveAll ) {
      this.d.live.visible = true;
      for ( const k of this.d.live.children ) k.renderable = true;
      this.show.visible = false;
      this.liveAll = true;
    }
    if ( why === "off" && this.bands.length ) this.freeBands();   // nothing to cache: keep no textures
    this.mode = this.stats.mode = why; this.stats.live = this.d.live.children.length;
  }

  freeBands(bands = this.bands) {
    for ( const b of bands ) for ( const t of b.tiles ) { t.spr.destroy(); t.rt.destroy(true); }
    if ( bands === this.bands ) {
      this.bands = []; this.show.removeChildren(); this.runs = []; this.sig = "";
      Object.assign(this.stats, { bands: 0, tiles: 0, mpx: 0 });
    }
  }

  /**
   * Draw the bands (statics of each even level, in order) into textures covering their content and build the show list. A band whose
   * members, density and sampling are unchanged keeps its textures (a new stroke entering on top re-draws nothing underneath).
   */
  bake(U, lv, sr, res, mips, win = null) {
    const t0 = performance.now(), R = canvas.app.renderer, d = this.d, ap = d.ap, o = d.origin, live = d.live;
    const force = this.dirty;
    const top = lv.reduce((a, v) => Math.max(a, v), 0);
    let sx0 = Math.floor(sr.x), sy0 = Math.floor(sr.y), sx1 = Math.ceil(sr.x + sr.width), sy1 = Math.ceil(sr.y + sr.height);
    if ( win ) { sx0 = Math.max(sx0, win.x0); sy0 = Math.max(sy0, win.y0); sx1 = Math.min(sx1, win.x1); sy1 = Math.min(sy1, win.y1); }
    // 1. the bands: members, their box on the scene
    const plan = [];
    let area = 0;
    for ( let L = 0; L <= top + 1; L += 2 ) {
      const members = [], rects = [];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for ( let i = 0; i < U.length; i++ ) if ( lv[i] === L && !U[i].live ) {
        members.push(U[i].cont); const r = U[i].r;
        rects.push({ x0: o.x + r.x0 * ap - 2, y0: o.y + r.y0 * ap - 2, x1: o.x + r.x1 * ap + 2, y1: o.y + r.y1 * ap + 2 });
        x0 = Math.min(x0, o.x + r.x0 * ap); y0 = Math.min(y0, o.y + r.y0 * ap); x1 = Math.max(x1, o.x + r.x1 * ap); y1 = Math.max(y1, o.y + r.y1 * ap);
      }
      x0 = Math.max(sx0, Math.floor(x0) - 2); y0 = Math.max(sy0, Math.floor(y0) - 2); x1 = Math.min(sx1, Math.ceil(x1) + 2); y1 = Math.min(sy1, Math.ceil(y1) + 2);
      const ok = members.length && x1 > x0 && y1 > y0;
      plan.push(ok ? { L, members, rects, x0, y0, x1, y1 } : null);
      if ( ok ) area += (x1 - x0) * (y1 - y0);
    }
    // 2. the density: what was asked, within the memory cap for all bands together (a view window is small anyway)
    const cap = Math.sqrt(MAX_MPX / Math.max(1, area));
    const eff = win || res <= cap ? res : Math.max(0.25, Math.floor(cap * 4) / 4);
    if ( !win ) this.capRes = cap;
    const maxTex = Math.min(8192, R.gl?.getParameter?.(R.gl.MAX_TEXTURE_SIZE) || 4096);
    const T = Math.max(128, Math.floor(Math.min(maxTex, win ? maxTex : 1024) / eff));   // tile size in scene px (sparse tiles of 1024 texels)
    const old = new Map(force ? [] : this.bands.map((b) => [b.key, b]));
    const keep = new Set();
    this.show.removeChildren();
    const bands = [], runs = [];
    const waters = U.filter((u) => u.water);
    const wasVis = live.visible;
    let drawn = 0, px = 0;
    for ( let k = 0; k < plan.length; k++ ) {
      const p = plan[k];
      if ( p ) {
        const key = `${p.L}|${eff}|${mips}|${d.filter}|${p.x0},${p.y0},${p.x1},${p.y1}|${p.members.map((c) => `${this.idOf(c)}.${c.children.length}`).join(",")}`;
        let band = old.get(key);
        if ( band && band.tiles.every((t) => t.rt.valid && !t.rt.baseTexture.destroyed) ) keep.add(band);
        else {
          band = { key, level: p.L, tiles: [] };
          live.visible = true;
          const set = new Set(p.members);
          for ( const c of live.children ) c.renderable = set.has(c);
          for ( const u of waters ) u.water.renderable = false;          // the water is never in a band
          for ( let ty = p.y0; ty < p.y1; ty += T ) for ( let tx = p.x0; tx < p.x1; tx += T ) {
            // whole texels (a view window is drawn 1:1 with the screen: no fractional texel at its edge)
            const tw = Math.ceil(Math.min(T, p.x1 - tx) * eff) / eff, th = Math.ceil(Math.min(T, p.y1 - ty) * eff) / eff;
            // sparse: no texture for a tile none of the band's objects touches
            if ( !p.rects.some((r) => r.x0 < tx + tw && r.x1 > tx && r.y0 < ty + th && r.y1 > ty) ) continue;
            const rt = PIXI.RenderTexture.create({ width: tw, height: th, resolution: eff, scaleMode: PIXI.SCALE_MODES.LINEAR });
            R.render(live, { renderTexture: rt, transform: new PIXI.Matrix(1, 0, 0, 1, -tx, -ty), clear: true });
            if ( mips && globalThis.CONFIG?.moinenMaps?.destructionCacheMips !== false ) mipmaps(R, rt);   // (dev knob)
            const spr = new PIXI.Sprite(rt); spr.eventMode = "none"; spr.position.set(tx, ty);
            band.tiles.push({ rt, spr, x: tx, y: ty, w: tw, h: th });
          }
          drawn++;
        }
        for ( const t of band.tiles ) { this.show.addChild(t.spr); px += t.w * t.h * eff * eff; }
        bands.push(band);
      }
      const run = new Run(live); this.show.addChild(run); runs.push(run);    // run k: level 2k + 1
    }
    for ( const c of live.children ) c.renderable = true;
    for ( const u of waters ) u.water.renderable = true;
    live.visible = wasVis;
    this.freeBands(this.bands.filter((b) => !keep.has(b)));
    this.bands = bands; this.runs = runs;
    const ms = performance.now() - t0;
    Object.assign(this.stats, { bakes: this.stats.bakes + 1, bakeMs: Math.round(ms * 10) / 10, drawn, res: eff, bands: bands.length,
      tiles: bands.reduce((a, b) => a + b.tiles.length, 0), mpx: Math.round(px / 1e5) / 10 });
  }

  idOf(c) { let id = this.ids.get(c); if ( id === undefined ) { id = this.nextId++; this.ids.set(c, id); } return id; }

  destroy() {
    canvas.app?.renderer?.runners?.contextChange?.remove(this._ctx);
    this.freeBands();
    if ( !this.show.destroyed ) this.show.destroy({ children: true });
  }
}
