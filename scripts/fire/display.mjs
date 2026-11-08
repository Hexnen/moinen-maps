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
 * (model.raster's times texture does the rest on the GPU); a check right before every render of the stage (beforeRender: the art cells
 * that render draws, A10). The art work of a frame stays under a budget the adaptive guard lowers when frames run long (A11).
 * Reduced motion (the art drawn whole): a still frame (time 0), no particles, a steady light, no
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
const MARGIN = 0.1, PAD = 4;
/**
 * A11 - RESPONSIVENESS FIRST (the camera must never wait for the fire):
 *  - an area's cells under the view are a MUST (no render may show a cell of another frame), everything else is optional work under
 *    the art budget. When the view leaves an area's drawn window, the window is GROWN with cells of the frame it already shows
 *    (FireArt.extendArt: only the strips the move uncovered, AHEAD of the view each way) instead of redrawn at the new frame - a fast
 *    pan or a jump costs the cells it uncovers. The new frame follows under the budget, the longest-waiting area first (an area coming
 *    on screen shows the frame it had until then). An area never drawn, or one whose window lies far from the view, is drawn fresh at
 *    the current frame over the view only (whichever is fewer cells).
 *  - while the CAMERA MOVES (and 200 ms after) the budget is halved: fewer new frames, the same picture, the same must-cells.
 *  - an ADAPTIVE GUARD watches the frame intervals: frames well over the display's own interval (an envelope of the shortest) lower the
 *    fire's detail a step (budget, then art frames at 6 fps, then no particles); a calm stretch raises it again a step at a time.
 *    `CONFIG.moinenMaps.fireAdaptive = false` keeps full detail.
 */
const AHEAD = 0.1, MOVE_MS = 200;
const byArtT = (x, y) => (x.mesh.artT ?? -1) - (y.mesh.artT ?? -1);
const LEVELS = [{ budget: 1, fps6: false, parts: 1 }, { budget: 0.5, fps6: false, parts: 1 }, { budget: 0.3, fps6: true, parts: 0.5 }, { budget: 0.2, fps6: true, parts: 0 }];

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
    // (A11: scratch reused every frame - no garbage per frame; the camera as last seen; the adaptive guard)
    this._vw = { x0: 0, y0: 0, x1: 0, y1: 0 }; this._rvw = { x0: 0, y0: 0, x1: 0, y1: 0 }; this._nvw = { x0: 0, y0: 0, x1: 0, y1: 0 }; this._need = [0, 0, 0, 0]; this._ahead = [0, 0, 0, 0];
    this._win = [0, 0, 0, 0]; this._pt = new PIXI.Point(); this._vis = []; this._stale = [];
    this.cam = [NaN, NaN, NaN]; this.movedAt = -1e9;
    this.level = 0; this.base = 0; this.press = 0; this.stepAt = 0; this.upAt = 0; this.calm = 3000; this._ri = 0; this._rn = 0; this.holdK = 3; this.lastCells = 0;
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

  /** The view in scene px (written into `out`: no garbage). */
  view(out = this._vw) {
    const v = canvas.app.renderer.screen, st = canvas.stage, p = this._pt;
    st.toLocal(p.set(0, 0), undefined, p); out.x0 = p.x; out.y0 = p.y;
    st.toLocal(p.set(v.width, v.height), undefined, p); out.x1 = p.x; out.y1 = p.y;
    return out;
  }

  /**
   * The ADAPTIVE GUARD, once a frame with the interval since the last one (ms). `base` = the display's own interval: the 20th
   * percentile of the last 120 intervals (re-taken every 30; a few odd short ones do not move it), never taken above a 60 Hz refresh
   * (frames that are ALL slow - a weak GPU from the first frame - still count as slow); `press` is a running share of frames well over
   * it. Pressed for a while: one step less detail (at most a step a second); calm for a while (3 s, doubled up to 30 s each time the
   * pressure came back within 3 s of a step up - no see-saw): one step back. Intervals under 4 ms (frames stepped by hand, not a
   * display) and over 250 ms (a stall: a hidden tab, a load) are not frames.
   */
  adapt(ms, pn) {
    if ( CONFIG.moinenMaps?.fireAdaptive === false ) { this.level = 0; this.holdK = 3; return false; }
    if ( !(ms >= 4) || ms > 250 ) return false;
    const N = 120, ring = this._ring ??= new Float32Array(N), srt = this._srt ??= new Float32Array(N);
    ring[this._ri % N] = ms; this._ri++; if ( this._rn < N ) this._rn++;
    if ( this._rn < 30 ) return false;
    if ( !this.base || this._ri % 30 === 0 ) { srt.set(ring); srt.sort(); this.base = Math.min(16.7, Math.max(6.5, srt[N - this._rn + Math.floor(this._rn * 0.2)])); }
    // (a 60 Hz screen counts a frame long from 25 ms - one missed refresh; a 144 Hz one from ~11 ms)
    const long = ms > Math.max(this.base * 1.5, this.base + 4);
    this.press = this.press * 0.95 + (long ? 0.05 : 0);
    if ( this.press > 0.25 && this.level < LEVELS.length - 1 && pn - this.stepAt > 1000 ) {
      if ( this.upAt && pn - this.upAt < 3000 ) this.calm = Math.min(30000, (this.calm || 3000) * 2);   // (it came back: wait longer)
      this.level++; this.stepAt = pn; this.upAt = 0; this.press = 0.1;
    } else if ( this.press < 0.02 && this.level > 0 && pn - this.stepAt > (this.calm || 3000) ) { this.level--; this.stepAt = this.upAt = pn; }
    this.stats.level = this.level;
    return long;
  }

  /**
   * A11: the cells of art area `a` under the view `vw` must be of one art frame. If its drawn window does not hold them: grow the window
   * with cells of the frame it shows (extendArt), or - when that would be more cells - draw the view's cells fresh at frame `T`. The
   * view is taken AHEAD of itself a little (a pan keeps going). Returns the cells drawn (0: nothing to do).
   */
  mustCost(a, vw) {
    const m = a.mesh, need = this.windowOf(a, vw, 0, this._need);
    if ( need[2] <= need[0] || need[3] <= need[1] || (m.artT !== null && m.covers(need)) ) return 0;
    if ( !this.ticking ) return m.W * m.H;
    const ahead = this.windowOf(a, vw, AHEAD, this._ahead), fresh = (ahead[2] - ahead[0]) * (ahead[3] - ahead[1]), o = m.artT !== null ? m.artWin : null;
    if ( !o ) return fresh;
    return Math.min(fresh, (Math.max(o[2], ahead[2]) - Math.min(o[0], ahead[0])) * (Math.max(o[3], ahead[3]) - Math.min(o[1], ahead[1])) - (o[2] - o[0]) * (o[3] - o[1]));
  }

  ensure(a, vw, T) {
    const m = a.mesh, need = this.windowOf(a, vw, 0, this._need);
    if ( need[2] <= need[0] || need[3] <= need[1] ) return 0;
    if ( m.artT !== null && m.covers(need) ) return 0;
    const R = canvas.app.renderer;
    if ( !this.ticking ) { m.setTime(T); m.renderArt(R); this.stats.artPasses++; return m.W * m.H; }   // (still: always whole)
    const ahead = this.windowOf(a, vw, AHEAD, this._ahead), fresh = (ahead[2] - ahead[0]) * (ahead[3] - ahead[1]);
    const o = m.artT !== null ? m.artWin : null;
    if ( o ) {
      const grown = (Math.max(o[2], ahead[2]) - Math.min(o[0], ahead[0])) * (Math.max(o[3], ahead[3]) - Math.min(o[1], ahead[1])) - (o[2] - o[0]) * (o[3] - o[1]);
      if ( grown <= fresh ) { const c = m.extendArt(R, ahead); this.stats.extends = (this.stats.extends ?? 0) + 1; return c; }
    }
    m.setTime(T); m.renderArt(R, ahead); this.stats.artPasses++;
    return fresh;
  }

  tick(force = false) {
    if ( !canvas.stage || !this.geo ) return;
    const t0 = performance.now(), geo = this.geo, P = this.P, still = reducedMotion();
    const pn = performance.now(), dms = this.lastPn ? pn - this.lastPn : 0, dt = dms / 1000; this.lastPn = pn;
    const L0 = LEVELS[this.level] ?? LEVELS[0];
    // (the last frame ran long right after the fire drew more than a budget in it: this device cannot take more at once - from now on
    // an area coming into view is held past one budget, not three)
    if ( this.ticking && this.adapt(dms, pn) && this.lastCells > ART_BUDGET * L0.budget ) this.holdK = 1;
    const L = LEVELS[this.level] ?? LEVELS[0], now0 = sharedNow(), now = still ? 0 : now0;
    let T = still ? 0 : M.shaderTime(now, P.speed); if ( L.fps6 ) T = Math.floor(T * 6) / 6;   // (a whole 12 fps frame, every other one)
    const newFrame = T !== this.lastT || force;
    const vw = this.view(), m = geo.grid, dark = canvas.environment?.darknessLevel ?? 0, st = canvas.stage, cam = this.cam;
    if ( st.pivot.x !== cam[0] || st.pivot.y !== cam[1] || st.scale.x !== cam[2] ) { cam[0] = st.pivot.x; cam[1] = st.pivot.y; cam[2] = st.scale.x; this.movedAt = pn; }
    const moving = pn - this.movedAt < MOVE_MS;
    if ( this.tokDirty || carrying() ) this.updateTokens();   // (a carried token's mesh moves every frame without a refresh)
    const vis = this._vis, stale = this._stale, vort = vortices().length > 0, wet = fireWet();
    vis.length = 0; stale.length = 0;
    this.tornadoDepth(vort);   // (a tornado's foot: depth rects + the front layer over it; vortex-lean.mjs)
    for ( const a of this.areas.values() ) {
      const on = M.inView(a.area.rect, geo, vw, m);
      if ( !on ) { if ( a.mesh.visible ) a.mesh.visible = false; a.hold = false; continue; }
      // (an art area coming into view is HELD - not shown - until its cells there are drawn: at once when they fit this frame)
      if ( !a.mesh.visible && !a.hold ) { if ( a.mesh.isArt && this.ticking && !force ) a.hold = true; else a.mesh.visible = true; }
      vis.push(a); if ( newFrame ) a.mesh.setTime(T); if ( a.mesh.anim ) a.mesh.setPhase(now0);
      if ( a.mesh.isArt ) { a.mesh.setDark(dark); leanToVortices(a, geo, vort, dt); dampArea(a, wet); if ( a.mesh.artT !== T || force ) stale.push(a); }
    }
    const budget = ART_BUDGET * L.budget * (moving ? 0.5 : 1), R = canvas.app.renderer;
    // (what an area coming into view may draw at once: 3 budgets at full detail - a zoom-out shows its areas together - one when the
    // guard has already found the frames long)
    const holdAt = ART_BUDGET * L.budget * (this.level === 0 ? this.holdK : 1);
    // the MUST: every shown area's cells under the view of one art frame (A11: grown with the frame it shows - the cells a move
    // uncovered, not a window; ensure). Counted against the budget, so the optional work below yields to it. An area just come into
    // view whose cells do not fit this frame's budget (a jump far away, a weak GPU) stays hidden while they are drawn in steps behind
    // (startJob) and shows when they are whole - a frame or two later, never a long frame, never a cell of another frame.
    let cells = 0;
    for ( const a of vis ) {
      const am = a.mesh; if ( !am.isArt ) continue;
      if ( !a.hold ) { cells += this.ensure(a, vw, T); continue; }
      const c = this.mustCost(a, vw);
      if ( !c || cells + c <= holdAt ) { cells += this.ensure(a, vw, T); a.hold = false; am.visible = true; continue; }
      if ( !am.job ) { am.startJob(this.windowOf(a, vw, AHEAD, this._ahead), T); this.stats.held = (this.stats.held ?? 0) + 1; }
      if ( cells < budget ) cells += am.stepJob(R, budget - cells);
      if ( !am.job && am.covers(this.windowOf(a, vw, 0, this._need)) ) { a.hold = false; am.visible = true; }
    }
    // the new art frame: once per 12 fps frame per visible area, spread over the display frames - at most the budget a frame (less
    // while the camera moves, less at a lower guard level), the longest-waiting first; a forced redraw goes now
    stale.sort(byArtT);
    for ( const a of stale ) {
      const am = a.mesh;
      if ( a.hold || (am.artT === T && !force) ) continue;             // (held: drawn above; or ensure drew it fresh just now)
      if ( am.job && !force ) { if ( cells < budget ) cells += am.stepJob(R, budget - cells); continue; }   // (a big frame on its way)
      const w = this.ticking ? this.windowOf(a, vw, MARGIN, this._win) : null, c = w ? Math.max(0, w[2] - w[0]) * Math.max(0, w[3] - w[1]) : am.W * am.H;
      if ( c <= 0 ) continue;
      if ( force || am.artT === null || cells + c <= budget ) { am.setTime(T); am.renderArt(R, w); this.stats.artPasses++; cells += c; continue; }
      // too big to fit a frame at all: drawn in steps behind the frame it shows (FireArt.startJob); else it waits for a frame with room
      if ( c > budget ) { am.startJob(w ?? [0, 0, am.W, am.H], T); this.stats.jobs = (this.stats.jobs ?? 0) + 1; if ( cells < budget ) cells += am.stepJob(R, budget - cells); }
    }
    // PREFETCH: in a calm frame with room left, an area just off screen (within half a view) that has never been drawn there is drawn
    // (in steps if big): a zoom-out or pan that brings it in finds its cells ready and shows them, instead of drawing them all at once
    if ( this.ticking && !moving && !force && cells < budget ) {
      const near = this._nvw, hx = (vw.x1 - vw.x0) * 0.5, hy = (vw.y1 - vw.y0) * 0.5;
      near.x0 = vw.x0 - hx; near.y0 = vw.y0 - hy; near.x1 = vw.x1 + hx; near.y1 = vw.y1 + hy;
      for ( const a of this.areas.values() ) {
        const am = a.mesh; if ( am.visible || !am.isArt || cells >= budget ) continue;
        if ( am.job ) { cells += am.stepJob(R, budget - cells); continue; }
        if ( !M.inView(a.area.rect, geo, near, m) ) continue;
        const w = this.windowOf(a, near, 0, this._win); if ( w[2] <= w[0] || w[3] <= w[1] || (am.artT !== null && am.covers(w)) ) continue;
        am.setTime(T); if ( am.anim ) am.setPhase(now0);
        am.startJob(w, T); this.stats.prefetch = (this.stats.prefetch ?? 0) + 1;
        cells += am.stepJob(R, budget - cells);
      }
    }
    this.stats.cells = this.lastCells = cells;
    this.lastT = T;
    const lu = this.lights.stats.updates;
    this.lights.update(now0);                                         // (the lights' uniforms: only on a new 12 fps frame)
    dampLights(this.lights, wet, this.lights.stats.updates !== lu);   // (rain / snow over fire: rain-damp.mjs)
    // particles: only on a new 12 fps frame (they move on the art grid, in whole cells); none over a held area yet
    const shownA = this._shownA ??= []; shownA.length = 0;
    for ( const a of vis ) if ( !a.hold ) shownA.push(a);
    this.stats.visible = shownA.length;
    if ( newFrame ) this.placeParticles(still ? [] : shownA, now);
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
  windowOf(a, vw, margin = 0, out = [0, 0, 0, 0]) {
    const { ap, ox, oy } = this.geo, r = a.area.rect, x0 = ox + r.x0 * ap, y0 = oy + r.y0 * ap, W = a.mesh.W, H = a.mesh.H;
    const mx = margin * (vw.x1 - vw.x0), my = margin * (vw.y1 - vw.y0);
    out[0] = Math.max(0, Math.floor((vw.x0 - mx - x0) / ap) - PAD); out[1] = Math.max(0, Math.floor((vw.y0 - my - y0) / ap) - PAD);
    out[2] = Math.min(W, Math.ceil((vw.x1 + mx - x0) / ap) + PAD); out[3] = Math.min(H, Math.ceil((vw.y1 + my - y0) / ap) + PAD);
    return out;
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
    const screen = !rt && !tf, vw = this._rvw, p = this._pt;
    // (the region drawn, in scene px: the target's corners through the inverse of (transform x stage); the frame allocates nothing)
    const X = tf ? tf.clone().append(st.localTransform) : st.localTransform;
    vw.x0 = vw.y0 = Infinity; vw.x1 = vw.y1 = -Infinity;
    for ( let k = 0; k < 4; k++ ) {
      X.applyInverse(p.set(k & 1 ? w : 0, k & 2 ? h : 0), p);
      if ( p.x < vw.x0 ) vw.x0 = p.x; if ( p.x > vw.x1 ) vw.x1 = p.x; if ( p.y < vw.y0 ) vw.y0 = p.y; if ( p.y > vw.y1 ) vw.y1 = p.y;
    }
    const T = this.lastT >= 0 ? this.lastT : (reducedMotion() ? 0 : M.shaderTime(sharedNow(), this.P.speed));
    let undo = null;
    for ( const a of this.areas.values() ) {
      const m = a.mesh; if ( !m.isArt ) continue;
      if ( m.visible ) {                                           // (on screen: the must of the tick, for the region this render draws)
        if ( this.ensure(a, vw, T) ) this.stats.guarded = (this.stats.guarded ?? 0) + 1;
        continue;
      }
      if ( screen ) continue;                                      // (the frame: the tick's culling stands)
      const need = this.windowOf(a, vw, 0, this._need); if ( need[2] <= need[0] || need[3] <= need[1] ) continue;   // (none of it here)
      // a capture over an area culled from the view: shown for this render only, its cells there at the current frame
      m.visible = true; (undo ??= []).push(m); m.setDark(canvas.environment?.darknessLevel ?? 0);
      if ( m.artT !== T ) { m.setTime(T); if ( m.anim ) m.setPhase(sharedNow()); m.artWin = null; }
      if ( m.artT !== null && m.covers(need) ) continue;
      m.setTime(T); m.renderArt(R, this.ticking ? need : null); this.stats.artPasses++; this.stats.guarded = (this.stats.guarded ?? 0) + 1;
    }
    return undo;
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
    const cap = reducedMotion() ? 0 : Math.round((CAP[perfMode()] ?? 0) * (LEVELS[this.level]?.parts ?? 1)), geo = this.geo, ap = geo.ap;
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

  /** Back to full detail (the guard starts over). */
  resetDetail() { this.level = 0; this.press = 0; this.base = 0; this.stepAt = 0; this.upAt = 0; this.calm = 3000; this._ri = 0; this._rn = 0; this.holdK = 3; this.lastCells = 0; this.stats.level = 0; }

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
