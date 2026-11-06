import * as M from "./model.mjs";
import { GROUND_VERT, GROUND_FRAG, RAIN_VERT, RAIN_FRAG } from "./glsl.mjs";
import { footprintK } from "../fire/shader.mjs";
import { SPEED_SQ, dirVec } from "../wind.mjs";

/**
 * Shows the WEATHER of the open scene: GPU-first passes in Foundry's primary group, every pixel a pure function of (art cell, shared
 * clock), so every client draws the same frame and nothing is simulated or sent per frame.
 *
 *   GROUND  sortLayer 252 (elevation 0): one quad over the scene (only visible fragments run), wet darkening of the map's own colours,
 *           puddles, sparse sheen glints. Above the destruction layer (247-249), districts (250, 251); below cars (255) and fire (256).
 *   SPLASH  sortLayer 253: the same instanced drops as the air pass, drawn where they LAND: splash crowns, ripples on water / puddles.
 *   AIR     sortLayer 995, elevation Infinity (as core weather): instanced 1-px streaks falling in the oblique view (lift), ending on
 *           their ground point; hidden under roofs by Foundry's depth mask (1 fetch), in Suppress Weather regions by the shelter mask.
 *
 * BLENDING (R1): every pass writes (add, k) with the custom blend ONE, SRC_ALPHA: the frame under a pixel becomes dst x k + add. So wet
 * ground darkens the map's own hues (k < 1), a streak is mix(what is under it, sky) with no texture fetch, a glint is mix(map, sky).
 *
 * INSTANCES: world tiles of 64 art px over the view (+ the margin a falling drop needs); per tile N slots per depth layer; the vertex
 * shader finds its tile and slot from gl_InstanceID, so following the view costs a few uniforms, not CPU per particle.
 *
 * COST: no weather -> this display does not exist (no object, no ticker). With weather: one ticker listener (a few uniforms; the
 * state is resolved at most 12 times a second), 3 draw calls.
 */
const BLEND = "MM_WEATHER";
const MAX_INSTANCES = 150000;
export const SKY = [0.80, 0.86, 0.93];

/** The custom blend (dst x srcAlpha + src; dst alpha kept), registered once per renderer (again after a context loss). */
export function blendMode() {
  const r = canvas.app.renderer, gl = WebGL2RenderingContext, modes = r.state.blendModes;
  let pos = PIXI.BLEND_MODES[BLEND];
  const want = [gl.ONE, gl.SRC_ALPHA, gl.ZERO, gl.ONE, gl.FUNC_ADD, gl.FUNC_ADD];
  if ( pos === undefined || !modes[pos] || modes[pos][1] !== gl.SRC_ALPHA || modes[pos][2] !== gl.ZERO ) {
    pos = modes.push(want) - 1;
    PIXI.BLEND_MODES[BLEND] = pos; PIXI.BLEND_MODES[pos] = BLEND;
    const pm = PIXI.utils.premultiplyBlendMode;
    if ( pm?.[0] && pm?.[1] ) { pm[0][pos] = pos; pm[1][pos] = pos; }
  }
  return pos;
}

let progs = {};
const prog = (k, v, f) => progs[k] ??= PIXI.Program.from(v, f, `moinen-maps-weather-${k}`);
const WHITE = () => PIXI.Texture.WHITE;

function place(obj, sortLayer, elevation = 0) {
  obj.eventMode = "none";
  Object.assign(obj, { elevation, sortLayer, sort: 0, _lastSortedIndex: 0 });
  return obj;
}

export class WeatherDisplay {
  constructor() {
    this.geo = null; this.info = null; this.shelter = null;
    this.meshes = [];
    this.state = null; this.view = null;
    this.stats = { instances: 0, tickMs: 0, drawn: [] };
    this._tick = () => this.tick();
    this.ticking = false;
  }

  /** The common uniforms (ground info, shelter, art grid, seed). */
  common(seed) {
    const g = this.geo, I = this.info, S = this.shelter;
    return {
      uInfo: I?.texture ?? WHITE(), uInfoGeo: new Float32Array([I?.w ?? 1, I?.h ?? 1, I?.scale ?? 1]), uHasInfo: I ? 1 : 0,
      uShelter: S?.texture ?? WHITE(), uHasShelter: S ? 1 : 0, uArtSize: new Float32Array([g.aw, g.ah]), uSeed: seed | 0
    };
  }

  /** Make (or keep) the passes for this geometry. */
  build(geo, seed) {
    const same = this.geo && JSON.stringify(this.geo) === JSON.stringify(geo) && this.seed === seed;
    if ( same && this.meshes.length ) return;
    this.destroyMeshes();
    this.geo = geo; this.seed = seed;
    const { ap, ox, oy, aw, ah } = geo, x1 = ox + aw * ap, y1 = oy + ah * ap;
    const bm = blendMode();
    // ground: one quad over the scene
    const gg = new PIXI.Geometry()
      .addAttribute("aVertexPosition", [ox, oy, x1, oy, x1, y1, ox, y1], 2)
      .addAttribute("aCell", [0, 0, aw, 0, aw, ah, 0, ah], 2)
      .addIndex([0, 1, 2, 0, 2, 3]);
    this.ground = place(new PIXI.Mesh(gg, new PIXI.Shader(prog("ground", GROUND_VERT, GROUND_FRAG), {
      ...this.common(seed), uTime: 0, uK: footprintK(), uWet: 0, uPuddle: 2, uSheen: 0, uSky: new Float32Array(SKY), uAlpha: 1,
      translationMatrix: new PIXI.Matrix().toArray(true) })), 252);
    // rain: one instanced quad geometry for both the air and the splash draws
    const rg = new PIXI.Geometry()
      .addAttribute("aVertexPosition", [ox, oy, x1, oy, x1, y1, ox, y1], 2)
      .addAttribute("aCorner", [0, 0, 1, 0, 1, 1, 0, 1], 2)
      .addIndex([0, 1, 2, 0, 2, 3]);
    rg.instanced = true; rg.instanceCount = 0;
    this.rainGeom = rg;
    const ru = (mode) => ({ ...this.common(seed), uMode: mode, uTime: 0, uTiles: new Float32Array([0, 0, 1, 1]), uPer: new Float32Array([0, 0, 0]),
      uDens: new Float32Array([0, 0, 0]), uOrigin: new Float32Array([ox, oy, ap, geo.grid / ap]), uWindDir: new Float32Array([1, 0]),
      uWindK: new Float32Array([0, 0.5]), uView: new Float32Array([0.5, 0.8]), uVF: new Float32Array([235, 170, 420]), uExpK: 1,
      uSplash: new Float32Array([1, 0.5]), uPuddle: 2, uWetP: 0, uI: 1, uSky: new Float32Array(SKY), uAlpha: 1,
      uScreen: new Float32Array([1, 1]), uDepth: WHITE(), uDepthElev: 1, uHasDepth: 0, translationMatrix: new PIXI.Matrix().toArray(true) });
    this.splash = place(new PIXI.Mesh(rg, new PIXI.Shader(prog("rain", RAIN_VERT, RAIN_FRAG), ru(1))), 253);
    this.air = place(new PIXI.Mesh(rg, new PIXI.Shader(prog("rain", RAIN_VERT, RAIN_FRAG), ru(0))), 995, Infinity);
    for ( const m of [this.ground, this.splash, this.air] ) {
      m.state.blendMode = bm; m.state.depthTest = false; m.state.culling = false;
      m.visible = false;
      canvas.primary.addChild(m);
      this.meshes.push(m);
    }
  }

  /** New ground info / shelter textures (the owner built them): rebind. */
  setSources(info, shelter) {
    this.info = info; this.shelter = shelter;
    if ( !this.geo ) return;
    const c = this.common(this.seed);
    for ( const m of this.meshes ) Object.assign(m.shader.uniforms, c);
  }

  /** The resolved weather to show (model.resolve + the client's caps), from the engine at <= 12 Hz. */
  setState(st) {
    this.state = st;
    const any = !!st && Object.keys(st.fx).length > 0 || (st?.wet ?? 0) > 0.002;
    this.arm(any);
    if ( any ) this.apply();
  }

  arm(want) {
    if ( want === this.ticking ) return;
    this.ticking = want;
    if ( want ) canvas.app.ticker.add(this._tick); else { canvas.app.ticker.remove(this._tick); for ( const m of this.meshes ) m.visible = false; }
  }

  /** Uniforms from the state (not per frame). */
  apply() {
    const st = this.state, g = this.geo; if ( !st || !g ) return;
    const rain = st.fx.rain, s = rain?.s ?? 0, p = rain?.p ?? 0, G = M.gates("rain", s);
    const perf = st.perf ?? 1;
    this.dens = rain ? [G.mid * p * perf, G.far * p * perf, st.noNear ? 0 : G.near * p * perf] : [0, 0, 0];
    const wet = st.wet ?? 0, puddle = st.puddles === false ? 2 : G.puddle;
    const wd = dirVec(st.wind?.dir ?? 0), cps = g.grid / g.ap, speed = (st.wind?.str ?? 0) * SPEED_SQ * cps;
    const gu = this.ground.shader.uniforms;
    gu.uWet = wet; gu.uPuddle = puddle; gu.uSheen = G.sheen * (st.sheen === false ? 0 : 1);
    for ( const m of [this.splash, this.air] ) {
      const u = m.shader.uniforms;
      u.uWindDir[0] = wd[0]; u.uWindDir[1] = wd[1]; u.uWindK[0] = speed; u.uWindK[1] = st.wind?.gust ?? 0.5;
      u.uView[0] = st.view?.lift ?? 0.5; u.uView[1] = st.view?.squash ?? 0.8;
      u.uVF[0] = G.vMid; u.uVF[1] = G.vFar; u.uVF[2] = 420; u.uExpK = G.exp;
      u.uSplash[0] = G.crown; u.uSplash[1] = G.ripple; u.uPuddle = puddle; u.uWetP = wet; u.uI = 1;
    }
    this.ground.visible = wet > 0.002;
  }

  /** The view in scene px. */
  viewRect() {
    const v = canvas.app.renderer.screen, st = canvas.stage;
    const tl = st.toLocal({ x: 0, y: 0 }), br = st.toLocal({ x: v.width, y: v.height });
    return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
  }

  tick() {
    const t0 = performance.now(), g = this.geo, st = this.state;
    if ( !g || !st || !canvas.stage ) return;
    // the state moves along the timeline at most 12 times a second (the engine resolves it; may destroy this display)
    const s12 = Math.floor((this.now?.() ?? Date.now()) * 0.012);
    if ( s12 !== this.s12 ) { this.s12 = s12; this.onStep?.(); if ( !this.geo ) return; }
    const T = this.clock();
    this.ground.shader.uniforms.uTime = T; this.ground.shader.uniforms.uK = footprintK();
    // the tiles over the view (+ the margin: drops fall from above their ground point and drift from upwind)
    const v = this.viewRect(), ap = g.ap;
    const ax0 = (v.x0 - g.ox) / ap, ay0 = (v.y0 - g.oy) / ap, ax1 = (v.x1 - g.ox) / ap, ay1 = (v.y1 - g.oy) / ap;
    const mx = 96, tx0 = Math.max(0, Math.floor((ax0 - mx) / 64)), ty0 = Math.max(0, Math.floor((ay0 - 64) / 64));
    const tx1 = Math.min(Math.ceil(g.aw / 64) - 1, Math.floor((ax1 + mx) / 64)), ty1 = Math.min(Math.ceil(g.ah / 64) - 1, Math.floor((ay1 + 128) / 64));
    const ntx = Math.max(0, tx1 - tx0 + 1), nty = Math.max(0, ty1 - ty0 + 1), tiles = ntx * nty;
    let dens = this.dens ?? [0, 0, 0];
    const want = tiles * (Math.ceil(dens[0]) + Math.ceil(dens[1]) + Math.ceil(dens[2]));
    if ( want > MAX_INSTANCES ) { const f = MAX_INSTANCES / want; dens = dens.map((d) => d * f); }   // (far zoomed out: fewer drops, never a stall)
    const per = dens.map((d) => Math.ceil(d - 1e-6)), sum = per[0] + per[1] + per[2];
    const n = sum > 0 ? tiles * sum : 0;
    this.rainGeom.instanceCount = n;
    const scr = canvas.screenDimensions ?? [canvas.app.renderer.screen.width, canvas.app.renderer.screen.height];
    const depth = canvas.masks?.depth?.renderTexture ?? null;
    for ( const m of [this.splash, this.air] ) {
      const u = m.shader.uniforms;
      u.uTime = T;
      u.uTiles[0] = tx0; u.uTiles[1] = ty0; u.uTiles[2] = Math.max(1, ntx); u.uTiles[3] = Math.max(1, nty);
      u.uPer[0] = per[0]; u.uPer[1] = per[1]; u.uPer[2] = per[2];
      u.uDens[0] = dens[0]; u.uDens[1] = dens[1]; u.uDens[2] = dens[2];
      u.uScreen[0] = scr[0]; u.uScreen[1] = scr[1];
      m.visible = n > 0;
    }
    const au = this.air.shader.uniforms;
    if ( depth ) { au.uDepth = depth; au.uHasDepth = 1; au.uDepthElev = canvas.masks.depth.mapElevation(Infinity); } else au.uHasDepth = 0;
    this.stats.instances = n; this.stats.tiles = tiles;
    this.stats.tickMs = performance.now() - t0;
  }

  /** Shader time: the shared clock in seconds, mod one hour (every periodic term is whole cycles per hour). */
  clock() { return this.fixedT ?? ((this.now?.() ?? Date.now()) / 1000) % 3600; }

  destroyMeshes() {
    for ( const m of this.meshes ) { m.parent?.removeChild(m); m.destroy(); }
    this.meshes = [];
    this.rainGeom?.destroy(); this.rainGeom = null;
    this.ground?.geometry?.destroy?.();
  }

  destroy() {
    canvas.app?.ticker?.remove(this._tick); this.ticking = false;
    this.destroyMeshes();
    this.geo = null;
  }
}
