import * as M from "./model.mjs";
import { FireMesh } from "./shader.mjs";
import { FireLights } from "./lights.mjs";
import { sharedNow } from "../shared-clock.mjs";
import { reducedMotion } from "../config.mjs";
import { perfMode } from "../perf-mode.mjs";

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
 * frame changes, and places the particles of the visible areas. Reduced motion: a still frame (time 0), no particles, a steady light -
 * the ticker is not registered at all.
 */
const CAP = { high: 48, medium: 24, low: 0 };

export class FireDisplay {
  constructor() {
    this.root = new PIXI.Container();
    this.root.eventMode = "none"; this.root.interactiveChildren = false;
    Object.assign(this.root, { elevation: 0, sortLayer: 256, sort: 0, _lastSortedIndex: 0 });
    this.meshes = new PIXI.Container(); this.parts = new PIXI.Container();
    this.root.addChild(this.meshes, this.parts);
    canvas.primary.addChild(this.root);
    this.areas = new Map();          // area id -> { key, area, field, mesh, slots }
    this.pool = [];                  // particle sprites
    this.lights = new FireLights();
    this.geo = null; this.P = M.cleanParams();
    this.stats = { areas: 0, visible: 0, particles: 0, lights: 0, tickMs: 0 };
    this._tick = () => this.tick();
    this.ticking = false;
    this.lastT = -1;
  }

  /**
   * Show these areas: [{ area, field }] (model.areasOf + model.raster), for geometry `geo` and settings `P`. Areas whose key did not
   * change keep their mesh; others are made, the missing removed. Then the lights are rebuilt (only when something changed).
   */
  sync(items, geo, P) {
    const geoChanged = JSON.stringify(geo) !== JSON.stringify(this.geo);
    this.geo = geo; this.P = P;
    const want = new Map(items.map((it) => [it.area.id, it]));
    let changed = geoChanged;
    for ( const [id, a] of this.areas ) {
      const w = want.get(id);
      if ( !w || w.area.key !== a.key || geoChanged ) { a.mesh.destroy(); this.areas.delete(id); changed = true; }
    }
    for ( const [id, it] of want ) {
      if ( this.areas.has(id) ) continue;
      const { area, field } = it, [ux, uy] = field.plume, g = geo.grid / geo.ap, sp = 0.45 * g * P.speed;   // (the smoke drifts ~half a square a second)
      const mesh = new FireMesh(field, area.rect, geo, { flow: [ux * sp, uy * sp], seed: area.seed, grid: g });
      this.meshes.addChild(mesh);
      this.areas.set(id, { key: area.key, area, field, mesh });
      changed = true;
    }
    this.lastT = -1;
    this.stats.areas = this.areas.size;
    if ( changed || this.lights.dirtyParams(P) ) this.lights.sync(this.areas.size ? M.lightsOf([...this.areas.values()], geo, P) : [], P);
    this.stats.lights = this.lights.count;
    this.arm();
    this.tick(true);
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
    const now = still ? 0 : sharedNow(), T = still ? 0 : M.shaderTime(now, P.speed), newFrame = T !== this.lastT || force;
    const vw = this.view(), m = geo.grid;
    const vis = [];
    for ( const a of this.areas.values() ) {
      const on = M.inView(a.area.rect, geo, vw, m);
      if ( a.mesh.visible !== on ) a.mesh.visible = on;
      if ( on ) { vis.push(a); if ( newFrame ) a.mesh.setTime(T); }
    }
    this.lastT = T;
    this.stats.visible = vis.length;
    // particles: only on a new 12 fps frame (they move on the art grid, in whole cells)
    if ( newFrame ) this.placeParticles(still ? [] : vis, now);
    this.stats.tickMs = performance.now() - t0;
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
        s.position.set(geo.ox + (r.x0 + p.x) * ap, geo.oy + (r.y0 + p.y) * ap);
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
  refresh() { this.arm(); this.lastT = -1; this.tick(true); }

  destroy() {
    canvas.app?.ticker?.remove(this._tick); this.ticking = false;
    this.lights.destroy();
    for ( const a of this.areas.values() ) a.mesh.destroy();
    this.areas.clear();
    if ( !this.root.destroyed ) this.root.destroy({ children: true });
    this._puff?.destroy(true); this._puff = null;
    this.pool.length = 0;
  }
}
