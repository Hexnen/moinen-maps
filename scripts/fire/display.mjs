import * as M from "./model.mjs";
import { FireMesh } from "./shader.mjs";
import { FireArt, BIRTHS } from "./art.mjs";
import { FireLights } from "./lights.mjs";
import { sharedNow } from "../shared-clock.mjs";
import { reducedMotion } from "../config.mjs";
import { perfMode } from "../perf-mode.mjs";
import { carrying } from "../tokens/carry.mjs";
import { vortices, fireWet } from "../wind.mjs";
import { dampArea, dampLights } from "./rain-damp.mjs";
import { leanToVortices, tornadoFeet, FRONT_LAYER } from "./vortex-lean.mjs";

/**
 * Shows FIRE AND SMOKE: one container in the primary group at sortLayer 256 - above the destruction layer (damage 247, shards 248, its
 * dust and embers 249), the districts (250), their lights (251), the roads' cars (255); below tiles (500), drawings and tokens. So
 * flames and smoke lie over the ruins and the traffic and under the tokens.
 *
 *  - one FireMesh (scripts/fire/shader.mjs) per AREA, its field a small texture; an unchanged area keeps its mesh (keyed by area key)
 *  - PARTICLES on top: pooled art-pixel sprites (a 1-px ember, a 2x2 smoke puff), every one a pure function of the shared clock
 *    (model.particleAt): no spawning, no state. Hard cap per Performance mode: high 48, medium 24, low 0; reduced motion 0.
 *  - LIGHTS (scripts/fire/lights.mjs): a few Foundry light sources per scene, made from the burning ground.
 *
 * COST: nothing painted -> no container, no ticker, no draw (the display is not even made). With fire: one ticker listener that culls
 * the areas against the view (an area off screen is `visible = false`: no draw), writes one uniform per visible area when the 12 fps
 * frame changes, and places the particles of the visible areas; an area that grows or goes out also gets its two clock uniforms
 * (model.raster's times texture does the rest on the GPU); a second, tiny listener right before the render (`guard`: the art cells
 * near the view, A9). Reduced motion (the art drawn whole): a still frame (time 0), no particles, a steady light, no
 * growing / going out (fire.mjs leaves the phases out) - the ticker is not registered at all.
 */
const CAP = { high: 48, medium: 24, low: 0 };

/** The scene's background map as the shader samples it (the texture Foundry already has on the GPU), or null. */
function mapOf() {
  const b = canvas.primary?.background, t = b?.texture;
  if ( !t?.valid || !b.width || !b.height ) return null;
  return { texture: t, rect: [b.x - b.width * (b.anchor?.x ?? 0), b.y - b.height * (b.anchor?.y ?? 0), b.width, b.height] };
}

/** Art cells the fire style may draw per display frame (~2 ms on a mid GPU; research 13: the art pass is the layer's main cost). */
const ART_BUDGET = 600000;
/**
 * A9: the art pass draws only the cells near the VIEW (the view grown by a quarter of its size each way, plus PAD cells - every cell a
 * screen pixel's colour reads lies within PAD of it): at a close zoom most of an area's rectangle is off screen and is left as it was.
 * A10: EVERY render of the stage - the frame, and any capture of it (Foundry's scene-transition snapshot, a module's or macro's
 * screenshot, a render into a texture with its own transform) - first looks at the region it really draws (its target and transform,
 * at that moment: a camera jump, pan-to, ping or token focus in the same task included) and, before it runs, draws every area there
 * whose drawn cells do not hold that region; an area culled from the view but inside a capture is shown for that render, drawn at the
 * current art frame, then hidden again. So no render ever shows a cell of another art frame. A frame costs one compare per area.
 */
const MARGIN = 0.25, PAD = 4;

/** The renderer's `render`, wrapped once per renderer (other modules may wrap it after us: never unwrapped, inert without fire). */
let shown = null, inRender = false;
function hookRender() {
  const R = canvas.app?.renderer; if ( !R || R._mmFireRender ) return;
  const render = R.render;
  R.render = function (obj, options, ...rest) {
    let undo = null;
    if ( shown && !inRender && obj === canvas.stage ) {
      inRender = true;
      try { undo = shown.beforeRender(options); } catch ( err ) { console.error("moinen-maps | fire: before render", err); } finally { inRender = false; }
    }
    try { return render.call(this, obj, options, ...rest); } finally { if ( undo ) for ( const m of undo ) m.visible = false; }
  };
  R._mmFireRender = true;
}

export class FireDisplay {
  constructor() {
    this.root = new PIXI.Container();
    this.root.eventMode = "none"; this.root.interactiveChildren = false;
    Object.assign(this.root, { elevation: 0, sortLayer: 256, sort: 0, _lastSortedIndex: 0 });
    this.meshes = new PIXI.Container(); this.parts = new PIXI.Container();
    this.root.addChild(this.meshes, this.parts);
    canvas.primary.addChild(this.root);
    // the SMOKE layer: above the tokens (a token under the smoke is veiled by it) and under the weather; the bed, char, coals and flames
    // stay in `root`, under the tokens
    this.above = new PIXI.Container();
    this.above.eventMode = "none"; this.above.interactiveChildren = false;
    Object.assign(this.above, { elevation: 0, sortLayer: 800, sort: 0, _lastSortedIndex: 0 });
    canvas.primary.addChild(this.above);
    // the FRONT flames: between the tokens (700) and the smoke - a tongue whose bed lies in front of a token's feet is drawn over that
    // token (art.mjs FRONT); both layers rise to the highest token standing in the fire (a carried or flying one) so they sort above it
    this.front = new PIXI.Container();
    this.front.eventMode = "none"; this.front.interactiveChildren = false;
    Object.assign(this.front, { elevation: 0, sortLayer: 750, sort: 0, _lastSortedIndex: 0 });
    canvas.primary.addChild(this.front);
    // (the particles in front of a token's feet over that token: above the front flames, the way every particle is above its flames)
    this.partsFront = new PIXI.Container(); this.partsFront.zIndex = 1; this.front.sortableChildren = true; this.front.addChild(this.partsFront);
    this.tokDirty = true;
    this.areas = new Map();          // area id -> { key, area, field, mesh, slots }
    this.pool = [];                  // particle sprites
    this.lights = new FireLights();
    // the flames' EMISSION meshes live in Foundry's illumination container, which every lighting refresh empties and refills with the
    // light sources' meshes only: put them back after each (a refresh by a wall, a door, the darkness - never one of ours)
    this.hookL = Hooks.on("lightingRefresh", () => this.attachGlows());
    this.geo = null; this.P = M.cleanParams();
    this.stats = { areas: 0, visible: 0, particles: 0, lights: 0, tickMs: 0, artPasses: 0, built: 0, destroyed: 0, lightsMade: 0 };
    this._tick = () => this.tick();
    this.ticking = false;
    this.lastT = -1;
    shown = this; hookRender();
  }

  /**
   * Show these areas: [{ area, field }] (model.areasOf + model.raster), for geometry `geo` and settings `P`. Areas whose key did not
   * change keep their mesh; others are made, the missing removed. Then the lights are rebuilt (only when something changed).
   */
  sync(items, geo, P) {
    const geoChanged = JSON.stringify(geo) !== JSON.stringify(this.geo);
    this.geo = geo; this.P = P;
    const want = new Map(items.map((it) => [it.area.id, it]));
    // ONLY the areas whose key changed (their strokes, phases or the scene settings) are rebuilt: every other area keeps its mesh,
    // field, art state, lights and clocks untouched (an edit never re-renders the whole fire)
    for ( const [id, a] of this.areas ) {
      const w = want.get(id);
      if ( !w || w.area.key !== a.key || geoChanged ) { a.mesh.destroy(); this.areas.delete(id); this.stats.destroyed++; }
    }
    for ( const [id, it] of want ) {
      if ( this.areas.has(id) ) continue;
      const { area, field } = it, [ux, uy] = field.plume, g = geo.grid / geo.ap, sp = 0.45 * g * P.speed;   // (the smoke drifts ~half a square a second)
      // the tongues lean as the field's envelope does (model.fieldFrom: wind x 0.7 cells per row)
      const lean = Math.max(-0.8, Math.min(0.8, (area.wind?.[0] ?? 0) * 0.7));
      // the fire style: the art-resolution look (art.mjs); the fireball: its v1 shader, unchanged
      const lvMax = Math.max(1, ...area.strokes.filter((s) => s.k === "fire").map((s) => s.lv ?? 2), area.strokes.some((s) => s.k === "fire") ? 1 : 2);
      const mesh = field.style === "fire"
        ? new FireArt(field, area.rect, geo, { above: this.above, front: this.front, box: area.box, seed: M.hashStr("art:" + (area.color ?? "")), grid: g, lean, wind: area.wind ?? [0, 0], dur: [P.grow, P.out, M.timing(geo, P).outSpan / 1000],
          plume: P.plume, lvMax, smokeTint: P.smokeTint, births: BIRTHS[perfMode()] ?? 8 })
        : new FireMesh(field, area.rect, geo, { flow: [ux * sp, uy * sp], seed: area.seed, grid: g, lean, flameH: M.sizes(geo, P).flameH, dur: [P.grow, P.out], map: mapOf(), smokeTint: P.smokeTint });
      this.meshes.addChild(mesh);
      this.areas.set(id, { key: area.key, area, field, mesh });
      this.stats.built++;
    }
    this.lastT = -1;                                                  // (uniforms only: every area's clock is set again this tick)
    this.tokDirty = true;
    this.stats.areas = this.areas.size;
    // (lights per area: an unchanged area keeps its sources; lightsOf runs only for the areas that need new ones)
    const lightKeys = [...this.areas].map(([id, a]) => ({ id, key: a.key, a }));
    const r = this.lights.syncAreas(lightKeys.map((e) => ({ id: e.id, key: e.key, listOf: (max) => M.lightsOf([e.a], geo, P, { max }) })), P, sharedNow(), geo);
    this.attachGlows();
    this.stats.lightsMade += r.made;
    this.stats.lights = this.lights.count;
    this.arm();
    // (no forced redraw of every area: the new ones have never been drawn and go first in this tick, the others keep their frame)
    this.tick(geoChanged);
  }

  /** Every area's emission mesh in the illumination container (after a lighting refresh emptied it). */
  attachGlows() {
    const box = canvas.effects?.illumination?.lights; if ( !box ) return;
    for ( const a of this.areas.values() ) { const g = a.mesh.glow; if ( g && !g.destroyed && g.parent !== box ) box.addChild(g); }
  }

  /** The ticker runs only while there is something that moves on screen (areas, motion allowed). */
  arm() {
    const want = this.areas.size > 0 && !reducedMotion();
    if ( want === this.ticking ) return;
    this.ticking = want;
    if ( want ) canvas.app.ticker.add(this._tick); else canvas.app.ticker.remove(this._tick);
  }

  /** The view in scene px. */
  view() {
    const v = canvas.app.renderer.screen, st = canvas.stage;
    const tl = st.toLocal({ x: 0, y: 0 }), br = st.toLocal({ x: v.width, y: v.height });
    return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
  }

  tick(force = false) {
    if ( !canvas.stage || !this.geo ) return;
    const t0 = performance.now(), geo = this.geo, P = this.P, still = reducedMotion();
    const now0 = sharedNow(), now = still ? 0 : now0, T = still ? 0 : M.shaderTime(now, P.speed), newFrame = T !== this.lastT || force;
    const vw = this.view(), m = geo.grid, dark = canvas.environment?.darknessLevel ?? 0;
    if ( this.tokDirty || carrying() ) this.updateTokens();   // (a carried token's mesh moves every frame without a refresh)
    const vis = [], stale = [], vort = vortices().length > 0, wet = fireWet();
    const pn = performance.now(), dt = this.lastPn ? (pn - this.lastPn) / 1000 : 0; this.lastPn = pn;
    this.tornadoDepth(vort);   // (a tornado's foot: depth rects + the front layer over it; vortex-lean.mjs)
    for ( const a of this.areas.values() ) {
      const on = M.inView(a.area.rect, geo, vw, m);
      a.came = on && !a.mesh.visible;                                  // (A10: back on screen - its cells are of an older frame: drawn now)
      if ( a.mesh.visible !== on ) a.mesh.visible = on;
      if ( on ) {
        vis.push(a); if ( newFrame ) a.mesh.setTime(T); if ( a.mesh.anim ) a.mesh.setPhase(now0);
        // the fire style's art pass: once per 12 fps frame per visible area (an area coming on screen draws its frame first)
        if ( a.mesh.isArt ) { a.mesh.setDark(dark); leanToVortices(a, geo, vort, dt); dampArea(a, wet); if ( a.mesh.artT !== T || force ) stale.push(a); }
      }
    }
    // (spread over the display frames of one 12 fps frame: at most ART_BUDGET cells a frame, the longest-waiting first; an area never
    // drawn yet, or a forced redraw, always goes now - so many areas do not all land on one frame as a spike)
    stale.sort((x, y) => (x.mesh.artT ?? -1) - (y.mesh.artT ?? -1));
    let cells = 0;
    for ( const a of stale ) {
      const w = this.ticking ? this.windowOf(a, vw, MARGIN) : null, c = w ? Math.max(0, w[2] - w[0]) * Math.max(0, w[3] - w[1]) : a.mesh.W * a.mesh.H;
      if ( cells > 0 && cells + c > ART_BUDGET && !force && a.mesh.artT !== null && !a.came ) continue;
      a.mesh.setTime(T); a.mesh.renderArt(canvas.app.renderer, w); this.stats.artPasses++; cells += c;
    }
    this.lastT = T;
    const lu = this.lights.stats.updates;
    this.lights.update(now0);                                         // (the lights' uniforms: only on a new 12 fps frame)
    dampLights(this.lights, wet, this.lights.stats.updates !== lu);   // (rain / snow over fire: rain-damp.mjs)
    this.stats.visible = vis.length;
    // particles: only on a new 12 fps frame (they move on the art grid, in whole cells)
    if ( newFrame ) this.placeParticles(still ? [] : vis, now);
    this.stats.tickMs = performance.now() - t0;
  }

  /**
   * A TORNADO's foot against the flames (vortex-lean.mjs): every frame while one exists, each area gets its tokens' rects plus the
   * tornado feet over it, and the front layer sorts above the tornado; once it has gone, the tokens alone again and the usual layer.
   */
  tornadoDepth(any) {
    if ( !any && !this.feetOn ) return;
    const geo = this.geo, feet = any ? tornadoFeet(geo.grid) : [];
    let on = false;
    for ( const a of this.areas.values() ) {
      if ( !a.mesh.setTokens ) continue;
      const bx = a.area.box ?? a.area.rect, x0 = geo.ox + bx.x0 * geo.ap, y0 = geo.oy + bx.y0 * geo.ap, x1 = geo.ox + bx.x1 * geo.ap, y1 = geo.oy + bx.y1 * geo.ap;
      const mine = feet.filter((r) => r[0] < x1 && r[2] > x0 && r[1] < y1 && r[3] > y0);
      if ( mine.length ) on = true;
      if ( mine.length || a.feetOn ) a.mesh.setTokens([...(a.toks ?? []), ...mine].slice(0, 16));
      a.feetOn = mine.length > 0;
    }
    const layer = on ? FRONT_LAYER : 750;
    if ( this.front.sortLayer !== layer ) { this.front.sortLayer = layer; canvas.primary.sortDirty = true; }
    this.feetOn = on;
  }

  /** An area's cells (its art texture's) under the view `vw` (scene px) grown by `margin` x its size each way and PAD cells. */
  windowOf(a, vw, margin = 0) {
    const { ap, ox, oy } = this.geo, r = a.area.rect, x0 = ox + r.x0 * ap, y0 = oy + r.y0 * ap, W = a.mesh.W, H = a.mesh.H;
    const mx = margin * (vw.x1 - vw.x0), my = margin * (vw.y1 - vw.y0);
    return [Math.max(0, Math.floor((vw.x0 - mx - x0) / ap) - PAD), Math.max(0, Math.floor((vw.y0 - my - y0) / ap) - PAD),
      Math.min(W, Math.ceil((vw.x1 + mx - x0) / ap) + PAD), Math.min(H, Math.ceil((vw.y1 + my - y0) / ap) + PAD)];
  }

  /**
   * Right before a render of the stage (A10): the scene region it draws - `options` as PIXI's render takes them (a target texture, a
   * transform) - and every art area overlapping it: shown (a culled one only for this render: the list
   * returned is hidden again after it) and its cells there drawn at this art frame. The ordinary frame: only the areas whose drawn
   * window no longer holds the view (a compare each).
   */
  beforeRender(options) {
    if ( !this.geo || !this.areas.size ) return null;
    const rt = options?.renderTexture ?? null, tf = options?.transform ?? null;   // (PIXI 7.4: render(object, { renderTexture, transform, ... }))
    const R = canvas.app.renderer, st = canvas.stage, w = rt ? rt.width : R.screen.width, h = rt ? rt.height : R.screen.height;
    st.transform.updateLocalTransform();
    const X = tf ? tf.clone().append(st.localTransform) : st.localTransform.clone(), c = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => X.applyInverse(new PIXI.Point(x, y)));
    const vw = { x0: Math.min(...c.map((p) => p.x)), y0: Math.min(...c.map((p) => p.y)), x1: Math.max(...c.map((p) => p.x)), y1: Math.max(...c.map((p) => p.y)) };
    const screen = !rt && !tf, T = this.lastT >= 0 ? this.lastT : (reducedMotion() ? 0 : M.shaderTime(sharedNow(), this.P.speed));
    const dark = canvas.environment?.darknessLevel ?? 0, undo = [];
    for ( const a of this.areas.values() ) {
      const m = a.mesh; if ( !m.isArt ) continue;
      const need = this.windowOf(a, vw); if ( need[2] <= need[0] || need[3] <= need[1] ) continue;   // (none of it in this render)
      if ( !m.visible ) {
        if ( screen ) continue;                                   // (the frame: the tick's culling stands)
        m.visible = true; undo.push(m); m.setDark(dark);
        if ( m.artT !== T ) { m.setTime(T); m.artWin = null; }   // (culled: its cells are of an older frame)
      }
      if ( m.artT !== null && m.covers(need) ) continue;           // (drawn here: this frame's, or the last one a budgeted area shows whole)
      if ( m.artT === null ) m.setTime(T);
      m.renderArt(R, this.ticking ? this.windowOf(a, vw, screen ? MARGIN : 0) : null); this.stats.artPasses++; this.stats.guarded = (this.stats.guarded ?? 0) + 1;
    }
    return undo.length ? undo : null;
  }


  /** A token moved, appeared or went: its depth against the flames is recomputed on the next frame (once, however many moved). */
  tokensDirty() { this.tokDirty = true; if ( !this.ticking && this.areas.size ) this.updateTokens(); }   // (no ticker: reduced motion)

  /**
   * The tokens STANDING ON each fire area (their visible rect - a carried or flying token where it is drawn - overlapping the area's fire
   * box), handed to its art as depth rects; the front and smoke layers rise to the highest of them. Only on a token change, never per
   * frame (and every frame only while a carry plays: carry.mjs moves the mesh without a refresh); one pass over the tokens per area.
   */
  updateTokens() {
    this.tokDirty = false;
    if ( !this.geo || !canvas.tokens ) return;
    const st = canvas.stage, geo = this.geo, toks = [];
    for ( const t of canvas.tokens.placeables ) {
      const m = t.mesh; if ( !t.visible || !m || m.destroyed || !m.visible || !m.renderable ) continue;
      const b = m.getBounds(false), a = st.toLocal({ x: b.x, y: b.y }), c = st.toLocal({ x: b.x + b.width, y: b.y + b.height });
      toks.push({ r: [a.x, a.y, c.x, c.y], e: m.elevation ?? t.document.elevation ?? 0 });
    }
    let top = 0;
    for ( const a of this.areas.values() ) {
      if ( !a.mesh.setTokens ) continue;
      const bx = a.area.box ?? a.area.rect, x0 = geo.ox + bx.x0 * geo.ap, y0 = geo.oy + bx.y0 * geo.ap, x1 = geo.ox + bx.x1 * geo.ap, y1 = geo.oy + bx.y1 * geo.ap;
      const on = toks.filter((k) => k.r[0] < x1 && k.r[2] > x0 && k.r[1] < y1 && k.r[3] > y0);
      for ( const k of on ) top = Math.max(top, k.e);
      a.toks = on.map((k) => k.r);
      a.mesh.setTokens(a.toks);
    }
    if ( this.front.elevation !== top ) { this.front.elevation = this.above.elevation = top; canvas.primary.sortDirty = true; }
    this.stats.tokens = toks.length;
  }

  placeParticles(vis, now) {
    const cap = reducedMotion() ? 0 : (CAP[perfMode()] ?? 0), geo = this.geo, ap = geo.ap;
    const slots = M.shareSlots(vis.map((a) => a.field), cap);
    let n = 0;
    for ( let i = 0; i < vis.length; i++ ) {
      const a = vis[i], r = a.area.rect;
      for ( let k = 0; k < slots[i] && n < cap; k++ ) {
        const p = M.particleAt(a.field, a.area.seed, k, now, this.P.speed, a.area.wind, geo.grid / ap); if ( !p ) continue;
        const s = this.sprite(n++);
        s.texture = p.size === 2 ? this.puffTex() : PIXI.Texture.WHITE;
        s.tint = p.color;
        const sx = geo.ox + (r.x0 + p.x) * ap, sy = geo.oy + (r.y0 + p.y) * ap, by = geo.oy + (r.y0 + p.by) * ap;
        s.position.set(sx, sy);
        // DEPTH, the flames' rule: a particle over a token standing here whose source lies in front of the token's feet goes above it
        const box = a.toks?.length && a.toks.some((t) => sx >= t[0] && sx < t[2] && sy >= t[1] && sy < t[3] && by > t[3]) ? this.partsFront : this.parts;
        if ( s.parent !== box ) box.addChild(s);
        s.scale.set(p.size === 2 ? ap : ap / 16);   // (Texture.WHITE is 16 x 16)
        s.visible = true;
      }
    }
    for ( let k = n; k < this.pool.length; k++ ) if ( this.pool[k].visible ) this.pool[k].visible = false;
    this.stats.particles = n;
  }

  sprite(i) {
    let s = this.pool[i];
    if ( !s ) { s = this.pool[i] = new PIXI.Sprite(PIXI.Texture.WHITE); s.eventMode = "none"; s.roundPixels = false; this.parts.addChild(s); }
    return s;
  }
  /** A 2 x 2 puff (white, tinted): two full pixels and two at 70 %. */
  puffTex() {
    if ( this._puff ) return this._puff;
    const a = new Uint8Array([255, 255, 255, 255, 200, 200, 200, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
    const t = PIXI.Texture.fromBuffer(a, 2, 2); t.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST; t.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    return this._puff = t;
  }

  /** Performance mode or reduced motion changed: re-arm, redraw once. */
  refresh() {
    for ( const a of this.areas.values() ) a.mesh.setBirths?.(BIRTHS[perfMode()] ?? 8);
    this.arm(); this.lastT = -1; this.tick(true);
  }

  destroy() {
    canvas.app?.ticker?.remove(this._tick); this.ticking = false; if ( shown === this ) shown = null;
    Hooks.off("lightingRefresh", this.hookL); this.lights.destroy();
    for ( const a of this.areas.values() ) a.mesh.destroy();
    this.areas.clear();
    if ( !this.root.destroyed ) this.root.destroy({ children: true });
    if ( !this.above.destroyed ) this.above.destroy({ children: true });
    if ( !this.front.destroyed ) this.front.destroy({ children: true });
    this._puff?.destroy(true); this._puff = null;
    this.pool.length = 0;
  }
}
