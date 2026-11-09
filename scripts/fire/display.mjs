import * as M from "./model.mjs";
import { FireMesh } from "./shader.mjs";
import { FireArt, BIRTHS } from "./art.mjs";
import { DustArt } from "./dust-art.mjs";
import { BurstArt } from "./burst-art.mjs";
import { burstLight } from "./burst-model.mjs";
import { SDRIFT } from "./dust-model.mjs";
import { FireLights } from "./lights.mjs";
import { sharedNow } from "../shared-clock.mjs";
import { reducedMotion } from "../config.mjs";
import { perfMode } from "../perf-mode.mjs";
import { carrying } from "../tokens/carry.mjs";
import { vortices, fireWet, sceneWind } from "../wind.mjs";
import { dampArea, dampLights } from "./rain-damp.mjs";
import { leanToVortices, tornadoFeet, FRONT_LAYER } from "./vortex-lean.mjs";
import { G as GUARD, guardQ, guardOff, paceNow } from "../frame-guard.mjs";
import { fireDetail, levelOf, burstDetail } from "./guard.mjs";

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
 *  - an ADAPTIVE GUARD (the client's one frame guard, scripts/frame-guard.mjs, 2026-11-09; the weather follows it too) lowers the
 *    fire's detail q smoothly while frames come late against the display's real vsync, and only for as long as they do: back to full
 *    in a few seconds once the load is gone, held steady under a lasting one; q drives the budget, the particles and (near the floor)
 *    the 6 fps art continuously (fire/guard.mjs). `CONFIG.moinenMaps.fireAdaptive = false` keeps full detail.
 * A12 - THE NEXT ART FRAME DRAWN AHEAD (drawAhead): at rest a new 12 fps frame used to land as one burst (every shown area's window in
 * one display frame, then nothing for four). Now each shown area that shows the current frame gets the NEXT one drawn into its back
 * texture in even shares over the display frames before it is due (its own small maps in pre textures, its clocks / lean as they will
 * be then: FireArt.startPre / stepJob), and swaps to it the frame the shared clock reaches it - the same cells of the same frame, shown
 * on time, the GPU work spread instead of bunched (and the areas a burst used to leave stale until a later frame now keep 12 fps).
 * `CONFIG.moinenMaps.fireAhead = false` turns it off (the A11 schedule).
 */
const AHEAD = 0.1, MOVE_MS = 200;
/** A13: a new area's textures sent to the GPU per display frame while it is made ready (a large area's ~15-19 MB: one frame of its own). */
const UP_BYTES = 24 << 20;
const byArtT = (x, y) => (x.mesh.artT ?? -1) - (y.mesh.artT ?? -1);

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
    // (the areas in the order they were made, except an explosion's fireball over the dust - burst-art.mjs zIndex 1: a shock ring's
    // ground puffs drawn over it read as grey rocks stuck on the ball)
    this.meshes.sortableChildren = true;
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
    this.pending = new Map();        // A13: area id -> { key, area, field, it, mesh (null: not built yet), ready } - new areas being made ready
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
    this.D = fireDetail(1); this.gT = -1; this.holdK = 3; this.lastCells = 0;
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
    // A13: while the fire moves (not on a new geometry - a scene load, a grid change), a NEW ART AREA IS MADE READY OVER A FEW FRAMES
    // (adopt): built, its textures uploaded, its first frame drawn in steps - meanwhile the areas it replaces stay on screen, untouched
    // and animating; when every new area is ready they all swap in one frame (reveal). The picture is the one an at-once build shows
    // at that moment, a few frames later; no frame carries a whole large area's build, upload and first draw.
    const staged = !reducedMotion() && !geoChanged && CONFIG.moinenMaps?.fireStaged !== false;
    if ( !staged ) this.dropPending(true);
    // ONLY the areas whose key changed (their strokes, phases or the scene settings) are rebuilt: every other area keeps its mesh,
    // field, art state, lights and clocks untouched (an edit never re-renders the whole fire)
    for ( const [id, a] of this.areas ) {
      const w = want.get(id);
      if ( w && w.area.key === a.key && !geoChanged ) { a.out = false; continue; }   // (unchanged - or wanted again before its successor showed)
      if ( staged && a.mesh.isArt ) { a.out = true; continue; }       // (shown until the new areas are ready)
      a.mesh.destroy(); this.areas.delete(id); this.stats.destroyed++;
    }
    // (a new area not shown yet is dropped when it is no longer wanted as it is, or the area it replaces is wanted again)
    for ( const [id, p] of this.pending ) {
      const w = want.get(id), cur = this.areas.get(id);
      if ( !w || w.area.key !== p.key || (cur && !cur.out) ) { p.mesh?.destroy(); this.pending.delete(id); }
    }
    for ( const [id, it] of want ) {
      const cur = this.areas.get(id);
      if ( (cur && !cur.out) || this.pending.has(id) ) continue;
      if ( staged && (it.field.style === "fire" || it.field.style === "dust" || it.field.style === "burst") ) { this.pending.set(id, { key: it.area.key, area: it.area, field: it.field, it, mesh: null, ready: false }); continue; }
      if ( cur ) { cur.mesh.destroy(); this.areas.delete(id); this.stats.destroyed++; }
      const mesh = this.build(it);
      this.meshes.addChild(mesh);
      this.areas.set(id, { key: it.area.key, area: it.area, field: it.field, mesh });
      this.stats.built++;
    }
    if ( !this.pending.size ) this.reveal(false);                     // (only removals: at once)
    this.lastT = -1;                                                  // (uniforms only: every area's clock is set again this tick)
    this.tokDirty = true;
    this.stats.areas = this.areas.size;
    this.attachGlows();
    this.arm();
    // A12c: the LIGHTS follow on the next frame while the fire ticks: Foundry's light sources and the vision refresh they ask for were
    // half of the frame that adopts a new area on an older CPU; a new light fades in from dark and a handed-over one eases (lights.mjs),
    // so one frame later is the same picture. (Not ticking - reduced motion: at once, as before.) A13: while new areas are made ready,
    // the frame after they show (reveal).
    if ( !this.ticking ) this.syncLights();
    else if ( !this.pending.size ) this.lightsNext();
    // (no forced redraw of every area: the new ones have never been drawn and go first in this tick, the others keep their frame)
    this.tick(geoChanged);
  }

  lightsNext() { this._lightsDue ??= requestAnimationFrame(() => { this._lightsDue = null; if ( this.geo ) this.syncLights(); }); }

  /** A new area's mesh for item `it` ({ area, field }) at the display's geometry and settings. */
  build(it) {
    // DUST AND GRIT (dust-art.mjs): an art area of its own look, on the same art grid, under the same schedule
    if ( it.field.style === "dust" ) return new DustArt(it.field, it.area.rect, this.geo, { front: this.front, seed: it.area.seed, grid: this.geo.grid / this.geo.ap, speed: this.P.speed, map: mapOf() });
    // THE EXPLOSION FIRE (burst-art.mjs): one burst, its own look, the same schedule
    if ( it.field.style === "burst" ) return new BurstArt(it.field, it.area.rect, this.geo, { front: this.front, grid: this.geo.grid / this.geo.ap, speed: this.P.speed, map: mapOf(), color: it.area.color });
    const geo = this.geo, { area, field } = it, P = M.areaP(area, this.P), [ux, uy] = field.plume, g = geo.grid / geo.ap, sp = 0.45 * g * P.speed;   // (the smoke drifts ~half a square a second)
    // the tongues lean as the field's envelope does (model.fieldFrom: wind x 0.7 cells per row)
    const lean = Math.max(-0.8, Math.min(0.8, (area.wind?.[0] ?? 0) * 0.7));
    // the fire style: the art-resolution look (art.mjs); the fireball: its v1 shader, unchanged
    const lvMax = Math.max(1, ...area.strokes.filter((s) => s.k === "fire").map((s) => s.lv ?? 2), area.strokes.some((s) => s.k === "fire") ? 1 : 2);
    return field.style === "fire"
      ? new FireArt(field, area.rect, geo, { above: this.above, front: this.front, box: area.box, seed: M.hashStr("art:" + (area.color ?? "")), grid: g, lean, wind: area.wind ?? [0, 0], dur: [P.grow, P.out, M.timing(geo, P).outSpan / 1000],
        plume: P.plume, lvMax, smokeTint: P.smokeTint, births: BIRTHS[perfMode()] ?? 8 })
      : new FireMesh(field, area.rect, geo, { flow: [ux * sp, uy * sp], seed: area.seed, grid: g, lean, flameH: M.sizes(geo, P).flameH, dur: [P.grow, P.out], map: mapOf(), smokeTint: P.smokeTint });
  }

  /** Every new area not shown yet dropped (`flush`: the areas they were to replace go too - the caller builds at once). */
  dropPending(flush) {
    for ( const p of this.pending.values() ) p.mesh?.destroy();
    this.pending.clear();
    if ( flush ) this.reveal(false);
  }

  /**
   * A13 - THE NEW AREAS SHOW: the areas they replace go and they take their place, all in one frame (each shows as the tick's hold
   * has it: at once, its cells under the view drawn). Then the lights follow (`lights`: the frame after).
   */
  reveal(lights = true) {
    for ( const [id, a] of this.areas ) if ( a.out ) { a.mesh.destroy(); this.areas.delete(id); this.stats.destroyed++; }
    if ( !this.pending.size ) return;
    for ( const [id, p] of this.pending ) {
      p.it = null; delete p.ready; p.mesh.visible = false; p.hold = false;
      this.areas.set(id, p); this.stats.built++;
    }
    this.pending.clear();
    this.lastT = -1; this.tokDirty = true; this.stats.areas = this.areas.size;
    this.attachGlows();
    if ( lights ) this.lightsNext();
  }

  /**
   * A13: the new areas made ready, a step a frame each - built (one a frame), their textures uploaded (UP_BYTES a frame), their cells
   * under the view drawn (whole at the current art frame when that fits `room` cells, else a coming frame in steps - FireArt.startPre),
   * with the uniforms the tick sets on a shown area. An area off screen is ready once uploaded (it is drawn as any area coming into view).
   */
  adopt(vw, T, nx, fps6, now0, dark, vort, wet, dt, room) {
    const R = canvas.app.renderer, geo = this.geo, tl = CONFIG.moinenMaps?.fireTiming, t0 = tl ? performance.now() : 0;
    let built = 0, bytes = UP_BYTES, cells = 0, sent = 0;
    for ( const p of this.pending.values() ) {
      if ( p.ready ) continue;
      if ( !p.mesh ) { if ( built ) continue; p.mesh = this.build(p.it); p.mesh.visible = false; this.meshes.addChild(p.mesh); built++; continue; }
      const m = p.mesh;
      if ( !m.uploaded ) { if ( bytes <= 0 ) continue; const b = m.uploadStep(R, bytes); bytes -= b; sent += b; continue; }
      if ( !M.inView(p.area.rect, geo, vw, geo.grid) ) { p.ready = true; continue; }
      if ( m.anim ) m.setPhase(now0);
      m.setDark(dark); leanToVortices(p, geo, vort, dt); dampArea(p, wet); m.setSceneWind?.(this.sw[0], this.sw[1]); m.setDetail?.(burstDetail(this.D));
      // (a large one is drawn AHEAD as A12 draws the next frame: an art frame the clock reaches after the steps it needs, with the
      // clocks it will have then; it shows when the clock reaches it - revealed at the very frame the areas around it show, never one
      // behind them; one the clock passed before it was whole is dropped and a later one taken)
      const j = m.job;
      if ( j?.pre ) { if ( j.done && j.t === T ) m.swapJob(R); else if ( !nx || !(j.t > T) ) m.job = null; }
      else if ( j && nx ) m.job = null;
      if ( !m.job && !(m.artT === T && m.covers(this.windowOf(p, vw, 0, this._need))) ) {
        const w = this.windowOf(p, vw, AHEAD, this._ahead), c = Math.max(0, w[2] - w[0]) * Math.max(0, w[3] - w[1]);
        const f = c > room && nx ? this.frameAfter(now0, this.P.speed, fps6, T, (Math.ceil(c / room) - 1) * Math.max(4, this.ivMs || 16.7)) : null;
        if ( !c ) { p.ready = true; continue; }                        // (none of its cells under the view)
        if ( c <= room || !f ) { m.setTime(T); m.renderArt(R, w); this.stats.artPasses++; cells += c; }
        else if ( f ) m.startPre(R, w, f.t, m.clocksAt(now0 + f.due, this._preU ??= new Float64Array(5)));
      }
      if ( m.job && !m.job.done && cells < room ) cells += m.stepJob(R, room - cells, T);
      if ( !m.job && m.artT === T && m.covers(this.windowOf(p, vw, 0, this._need)) ) p.ready = true;
    }
    if ( tl ) tl.push({ adopt: +(performance.now() - t0).toFixed(2), built, sent, cells, at: +performance.now().toFixed(1) });
    return cells;
  }

  /** The lights per area (an unchanged area keeps its sources; lightsOf runs only for the areas that need new ones). */
  syncLights() {
    const geo = this.geo, P = this.P;
    // (dust gives no light: its areas never enter the light sync, so they neither take a share of the light budget from the fire nor
    // re-sync the fire's lights when they come and go)
    // (an explosion: its flash, one light per burst - burst-model.burstLight; a fire with its own grow / out times: its lights grow
    // in and go out with them - L.G / L.O, lights.mjs)
    const listOf = (a, max) => {
      if ( a.area.style === "burst" ) return a.area.strokes.filter((s) => s.k === "burst").slice(0, max).map((s) => burstLight(s, geo, P));
      const list = M.lightsOf([a], geo, P, { max }), tm = a.area.tm;
      return tm ? list.map((L) => ({ ...L, G: (tm[0] ?? P.grow) * 1000, O: (tm[1] ?? P.out) * 1000 })) : list;
    };
    const r = this.lights.syncAreas([...this.areas].filter(([, a]) => a.area.style !== "dust").map(([id, a]) => ({ id, key: a.key, listOf: (max) => listOf(a, max) })), P, sharedNow(), geo);
    this.stats.lightsMade += r.made;
    this.stats.lights = this.lights.count;
  }

  /** Every area's emission mesh in the illumination container (after a lighting refresh emptied it). */
  attachGlows() {
    const box = canvas.effects?.illumination?.lights; if ( !box ) return;
    for ( const a of this.areas.values() ) { const g = a.mesh.glow; if ( g && !g.destroyed && g.parent !== box ) box.addChild(g); }
  }

  /** The ticker runs only while there is something that moves on screen (areas, motion allowed). */
  arm() {
    const want = (this.areas.size > 0 || this.pending.size > 0) && !reducedMotion();
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
   * The ADAPTIVE GUARD, once a drawn frame (the ticker's): the shared frame guard steps with the ticker's interval against the
   * display's paced frame time (frame-guard.mjs), and the fire's detail follows its q (fire/guard.mjs). Returns whether this frame
   * came late.
   */
  adapt() {
    const T = canvas.app.ticker;
    if ( CONFIG.moinenMaps?.fireAdaptive === false ) { guardOff("fire"); fireDetail(1, this.D); this.holdK = 3; this.stats.level = 0; this.stats.q = 1; return false; }
    const stepped = T.lastTime !== this.gT; this.gT = T.lastTime;
    const q = guardQ("fire"), P = paceNow();
    fireDetail(q, this.D); this.stats.q = q; this.stats.level = levelOf(q);
    return stepped && !!P.frame && T.elapsedMS > P.frame + P.slack && T.elapsedMS <= GUARD.o.stall;
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
    if ( this.pending.size && !force && [...this.pending.values()].every((p) => p.ready) ) this.reveal();   // (A13: all ready - they show now)
    const t0 = performance.now(), geo = this.geo, P = this.P, still = reducedMotion();
    const pn = performance.now(), dms = this.lastPn ? pn - this.lastPn : 0, dt = dms / 1000; this.lastPn = pn;
    // (the last frame ran long right after the fire drew more than a budget in it: this device cannot take more at once - from now on
    // an area coming into view is held past one budget, not three)
    const b0 = this.D.budget;
    if ( this.ticking && this.adapt() && this.lastCells > ART_BUDGET * b0 ) this.holdK = 1;
    const L = this.D, now0 = sharedNow(), now = still ? 0 : now0;
    let T = still ? 0 : M.shaderTime(now, P.speed); if ( L.fps6 ) T = Math.floor(T * 6) / 6;   // (a whole 12 fps frame, every other one)
    const newFrame = T !== this.lastT || force;
    // A12: the NEXT art frame (its time and how soon the shared clock reaches it) and the display's own frame interval: the next frame
    // is drawn ahead over the display frames before it is due (PRE below)
    const nx = this.ticking && !still && P.speed > 0 && CONFIG.moinenMaps?.fireAhead !== false ? this.nextFrame(now0, P.speed, L.fps6, T) : null;
    // (A13: the ticker's own interval - the display's frame interval live; a recording's step on its virtual clock, dev/fire-rec.mjs)
    const tms = canvas.app.ticker.elapsedMS;
    if ( tms >= 4 && tms <= 100 ) this.ivMs = this.ivMs ? this.ivMs * 0.9 + tms * 0.1 : tms;
    const R = canvas.app.renderer;
    const vw = this.view(), m = geo.grid, dark = canvas.environment?.darknessLevel ?? 0, st = canvas.stage, cam = this.cam;
    if ( st.pivot.x !== cam[0] || st.pivot.y !== cam[1] || st.scale.x !== cam[2] ) { cam[0] = st.pivot.x; cam[1] = st.pivot.y; cam[2] = st.scale.x; this.movedAt = pn; }
    const moving = pn - this.movedAt < MOVE_MS;
    if ( this.tokDirty || carrying() ) this.updateTokens();   // (a carried token's mesh moves every frame without a refresh)
    const vis = this._vis, stale = this._stale, vort = vortices().length > 0, wet = fireWet();
    this.dustWind();
    vis.length = 0; stale.length = 0;
    this.tornadoDepth(vort);   // (a tornado's foot: depth rects + the front layer over it; vortex-lean.mjs)
    for ( const a of this.areas.values() ) {
      const on = M.inView(a.area.rect, geo, vw, m);
      if ( !on ) { if ( a.mesh.visible ) a.mesh.visible = false; a.hold = false; continue; }
      // (an art area coming into view is HELD - not shown - until its cells there are drawn: at once when they fit this frame)
      if ( !a.mesh.visible && !a.hold ) { if ( a.mesh.isArt && this.ticking && !force ) a.hold = true; else a.mesh.visible = true; }
      vis.push(a); if ( newFrame ) a.mesh.setTime(T); if ( a.mesh.anim ) a.mesh.setPhase(now0);
      if ( a.mesh.isArt ) {
        a.mesh.setDark(dark); leanToVortices(a, geo, vort, dt); dampArea(a, wet); a.mesh.setSceneWind?.(this.sw[0], this.sw[1]); a.mesh.setDetail?.(burstDetail(L));
        // (A12: the frame drawn ahead is due: shown as it is - only its OCC tiles are drawn now; one drawn ahead for another frame - a
        // skipped frame, the clock's wrap - is dropped)
        const j = a.mesh.job;
        if ( j?.pre ) { if ( j.t === T && j.done && !force ) a.mesh.swapJob(R); else if ( j.t !== T && j.t !== nx?.t ) a.mesh.job = null; }
        if ( a.mesh.artT !== T || force ) stale.push(a);
      }
    }
    const budget = ART_BUDGET * L.budget * (moving ? 0.5 : 1);
    // (what an area coming into view may draw at once: 3 budgets at full detail - a zoom-out shows its areas together - one when the
    // guard has already found the frames long)
    const holdAt = ART_BUDGET * L.budget * (GUARD.q >= 1 ? this.holdK : 1);
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
      if ( am.job?.pre ) am.job = null;                                // (a frame drawn ahead: the hold draws the current one)
      if ( !am.job ) { am.startJob(this.windowOf(a, vw, AHEAD, this._ahead), T); this.stats.held = (this.stats.held ?? 0) + 1; }
      if ( cells < budget ) cells += am.stepJob(R, budget - cells, T);
      if ( !am.job && am.covers(this.windowOf(a, vw, 0, this._need)) ) { a.hold = false; am.visible = true; }
    }
    // the new art frame: once per 12 fps frame per visible area, spread over the display frames - at most the budget a frame (less
    // while the camera moves, less at a lower guard level), the longest-waiting first; a forced redraw goes now
    stale.sort(byArtT);
    for ( const a of stale ) {
      const am = a.mesh;
      if ( a.hold || (am.artT === T && !force) ) continue;             // (held: drawn above; or ensure drew it fresh just now)
      if ( am.job && !force && am.job.t === T ) { if ( cells < budget ) cells += am.stepJob(R, budget - cells, T); continue; }   // (a big frame on its way)
      const w = this.ticking ? this.windowOf(a, vw, MARGIN, this._win) : null, c = w ? Math.max(0, w[2] - w[0]) * Math.max(0, w[3] - w[1]) : am.W * am.H;
      if ( c <= 0 ) continue;
      if ( force || am.artT === null || cells + c <= budget ) { am.setTime(T); am.renderArt(R, w); this.stats.artPasses++; cells += c; continue; }
      // too big to fit a frame at all: drawn in steps behind the frame it shows (FireArt.startJob); else it waits for a frame with room
      if ( c > budget ) { am.startJob(w ?? [0, 0, am.W, am.H], T); this.stats.jobs = (this.stats.jobs ?? 0) + 1; if ( cells < budget ) cells += am.stepJob(R, budget - cells, T); }
    }
    // (A13: a new area's first frame takes what is left of the budget, at least a full one a frame - whatever the guard's level: an
    // at-once build drew all of it in one frame; this is the same work over a few)
    if ( this.pending.size && this.ticking ) cells += this.adopt(vw, T, nx, L.fps6, now0, dark, vort, wet, dt, Math.max(budget - cells, ART_BUDGET));
    // PREFETCH: in a calm frame with room left, an area just off screen (within half a view) that has never been drawn there is drawn
    // (in steps if big): a zoom-out or pan that brings it in finds its cells ready and shows them, instead of drawing them all at once
    if ( this.ticking && !moving && !force && cells < budget ) {
      const near = this._nvw, hx = (vw.x1 - vw.x0) * 0.5, hy = (vw.y1 - vw.y0) * 0.5;
      near.x0 = vw.x0 - hx; near.y0 = vw.y0 - hy; near.x1 = vw.x1 + hx; near.y1 = vw.y1 + hy;
      for ( const a of this.areas.values() ) {
        const am = a.mesh; if ( am.visible || !am.isArt || cells >= budget ) continue;
        if ( am.job ) { if ( am.job.pre ) am.job = null; else { cells += am.stepJob(R, budget - cells, T); continue; } }
        if ( !M.inView(a.area.rect, geo, near, m) ) continue;
        const w = this.windowOf(a, near, 0, this._win); if ( w[2] <= w[0] || w[3] <= w[1] || (am.artT !== null && am.covers(w)) ) continue;
        am.setTime(T); if ( am.anim ) am.setPhase(now0);
        am.startJob(w, T); this.stats.prefetch = (this.stats.prefetch ?? 0) + 1;
        cells += am.stepJob(R, budget - cells, T);
      }
    }
    if ( nx && !force ) cells += this.drawAhead(vis, vw, T, nx, now0, budget - cells);
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
   * A12 - the next art frame `nx` drawn AHEAD: every shown art area that shows the current frame gets the next one drawn into its back
   * texture in steps (FireArt.startPre / stepJob), an even share of what is left each display frame - spread over the frames before the
   * shared clock reaches it, one frame early - within `room` (what the must, the stale frames and the prefetch left of the budget).
   * When it is due the area swaps to it (tick). So the art of a 12 fps frame no longer lands in one display frame. Returns the cells.
   */
  drawAhead(vis, vw, T, nx, now0, room) {
    if ( room <= 0 ) return 0;
    let left = 0;
    for ( const a of vis ) {
      const m = a.mesh; if ( !m.isArt || a.hold || m.artT !== T ) continue;
      const j = m.job;
      if ( j?.pre && j.t === nx.t ) left += m.jobLeft;
      else if ( !j ) { const w = this.windowOf(a, vw, MARGIN, this._win); left += Math.max(0, w[2] - w[0]) * Math.max(0, w[3] - w[1]); }
    }
    if ( left <= 0 ) return 0;
    const frames = Math.floor(nx.due / Math.max(4, this.ivMs || 16.7));
    let quota = Math.min(room, Math.ceil(left / Math.max(1, frames - 1))), cells = 0;
    const R = canvas.app.renderer, s = this._preU ??= new Float64Array(5);
    for ( const a of vis ) {
      if ( quota <= 0 ) break;
      const m = a.mesh; if ( !m.isArt || a.hold || m.artT !== T ) continue;
      if ( m.job && !(m.job.pre && m.job.t === nx.t) ) continue;
      if ( !m.job ) {
        const w = this.windowOf(a, vw, MARGIN, this._win); if ( w[2] <= w[0] || w[3] <= w[1] ) continue;
        m.startPre(R, w, nx.t, m.clocksAt(now0 + nx.due, s)); this.stats.pre = (this.stats.pre ?? 0) + 1;
      }
      const c = m.stepJob(R, quota, T); cells += c; quota -= c;
    }
    return cells;
  }

  /** A13: as nextFrame, the first art frame starting at least `lead` ms from `now` (for a first frame drawn in steps over that long). */
  frameAfter(now, speed, fps6, T, lead) {
    const o = this._fa ??= { t: 0, due: 0 }, k0 = Math.max(Math.floor(now * speed / 83.333), Math.floor((now + lead) * speed / 83.333));
    for ( let k = k0 + 1; k < k0 + 4; k++ ) {
      let t = (k / 12) % 1000; if ( fps6 ) t = Math.floor(t * 6) / 6;
      if ( t !== T ) { o.t = t; o.due = k * 83.333 / speed - now; return o; }
    }
    return null;
  }

  /** The art frame after `T` (fps6: the next whole 6 fps one) and the ms until the shared clock reaches it (model.shaderTime's own steps). */
  nextFrame(now, speed, fps6, T) {
    const o = this._nx ??= { t: 0, due: 0 }, k0 = Math.floor(now * speed / 83.333);
    for ( let k = k0 + 1; k < k0 + 4; k++ ) {
      let t = (k / 12) % 1000; if ( fps6 ) t = Math.floor(t * 6) / 6;
      if ( t !== T ) { o.t = t; o.due = k * 83.333 / speed - now; return o; }
    }
    return null;
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

  /**
   * The scene's wind (the weather's, wind.mjs) as the dust drifts with it: its base direction and strength (capped at 1) x SDRIFT
   * squares / s, in cells. The same on every client (the weather resolves it from the scene's flags and the shared clock).
   */
  dustWind() {
    const w = sceneWind(), sw = this.sw ??= new Float32Array(2);
    if ( !w ) { sw[0] = sw[1] = 0; return; }
    const a = (Number(w.dir) || 0) * Math.PI / 180, k = Math.min(1, w.str) * SDRIFT * this.geo.grid / this.geo.ap;
    sw[0] = Math.cos(a) * k; sw[1] = Math.sin(a) * k;
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
    const cap = reducedMotion() ? 0 : Math.round((CAP[perfMode()] ?? 0) * this.D.parts), geo = this.geo, ap = geo.ap;
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
  resetDetail() { GUARD.reset(); fireDetail(1, this.D); this.holdK = 3; this.lastCells = 0; this.stats.level = 0; this.stats.q = 1; }

  /** Performance mode or reduced motion changed: re-arm, redraw once (A13: new areas being made ready show at once). */
  refresh() {
    if ( this.pending.size ) {
      for ( const p of this.pending.values() ) if ( !p.mesh ) { p.mesh = this.build(p.it); this.meshes.addChild(p.mesh); }
      this.reveal(false);
      if ( reducedMotion() ) this.syncLights(); else this.lightsNext();
    }
    for ( const a of [...this.areas.values(), ...this.pending.values()] ) a.mesh?.setBirths?.(BIRTHS[perfMode()] ?? 8);
    this.arm(); this.lastT = -1; this.tick(true);
  }

  destroy() {
    canvas.app?.ticker?.remove(this._tick); this.ticking = false; if ( shown === this ) shown = null;
    if ( this._lightsDue ) { cancelAnimationFrame(this._lightsDue); this._lightsDue = null; }
    Hooks.off("lightingRefresh", this.hookL); this.lights.destroy();
    for ( const a of this.areas.values() ) a.mesh.destroy();
    this.areas.clear();
    for ( const p of this.pending.values() ) p.mesh?.destroy();
    this.pending.clear();
    if ( !this.root.destroyed ) this.root.destroy({ children: true });
    if ( !this.above.destroyed ) this.above.destroy({ children: true });
    if ( !this.front.destroyed ) this.front.destroy({ children: true });
    this._puff?.destroy(true); this._puff = null;
    this.pool.length = 0;
  }
}
