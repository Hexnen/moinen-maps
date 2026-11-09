import * as SM from "./storm-model.mjs";
import * as L from "../presets/lightning-core.mjs";
import { weatherQ } from "./guard.mjs";
import { reducedMotion } from "../config.mjs";

/**
 * THE RAIN'S LIGHTNING on every client (the pure rules: storm-model.mjs). Exists only while the scene's lightning is on and its rain
 * is shown on this client; between flashes it runs NOTHING per frame (the weather's own 12 Hz step looks a few seconds ahead and arms
 * the ticker just before a flash; the ticker stops itself when the flash is over).
 *  - LIGHT: one quad over the canvas with a smooth light field (up to three flashes at once: a broad glow from beyond the scene's edge
 *    for a distant storm, a flash from one side for a nearer one, a pool round the strike point for a close strike, each with a share
 *    over the whole view: the lit sky), modulated by a slow cloud-filter noise (the light comes through uneven cloud) - no edge, no
 *    shape anywhere: the field covers the whole view and falls off smoothly.
 *      by day   in the primary group above everything on the ground (roofs and tokens too, under the rain and the cloud bodies),
 *               blended as LIGHT: dst x (1 + L x colour): the map's own colours lit, never a grey veil;
 *      at night the same field as light ADDED to Foundry's illumination: the darkness lifts where the flash reaches, a faint
 *               distant flash too (MAX_COLOR, as the strike preset's glow, would drop any light under the night's own darkness colour).
 *  - THE RAIN catches the flash (the display's streaks: uFlash, 0 = the plain rain) and the CLOUD BODIES glow from inside (uBolt).
 *  - BOLTS: a close strike with "visible bolts" draws the strike preset's bolt (its data texture and its program, presets/lightning.mjs
 *    strikeProgram, read only: here without the preset's ground arcs, molten spray, crackle and cooling plasma - a storm's strike, not a
 *    weapon's), its leader, return stroke and restrikes on the same timing as the light. Built ahead in an idle callback.
 *  - ACCESSIBILITY: a client that opted out of flashes (cinNoFlash) or wants reduced motion gets each flash as one slow, faint swell
 *    of light (no flicker, no sudden change); with reduced motion no bolt either (as the strike preset).
 *  - The frame guard (weatherQ) eases the cloud-filter noise to its mean (the light's shape stays).
 */
const LIGHT_LAYER = 993, BOLT_LAYER = 994;
const BLEND = "MM_LIGHT", GLOOM_BLEND = "MM_GLOOM", GLOOM_LAYER = 992;
const MAXL = 3;

/** The light blend: dst x src + dst (a light: the colour under it lifted by src), dst alpha kept; the gloom: dst x src. */
function lightBlend(name = BLEND) {
  const r = canvas.app.renderer, gl = WebGL2RenderingContext, modes = r.state.blendModes;
  const want = [gl.DST_COLOR, name === BLEND ? gl.ONE : gl.ZERO, gl.ZERO, gl.ONE, gl.FUNC_ADD, gl.FUNC_ADD];
  let pos = PIXI.BLEND_MODES[name];
  if ( pos === undefined || !modes[pos] || modes[pos][0] !== want[0] || modes[pos][1] !== want[1] ) {
    pos = modes.push(want) - 1;
    PIXI.BLEND_MODES[name] = pos; PIXI.BLEND_MODES[pos] = name;
    const pm = PIXI.utils.premultiplyBlendMode;
    if ( pm?.[0] && pm?.[1] ) { pm[0][pos] = pos; pm[1][pos] = pos; }
  }
  return pos;
}

const VERT = `#version 300 es
precision highp float;
in vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
out vec2 vW;
void main() {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vW = aVertexPosition;
}`;
const FRAG = `#version 300 es
precision highp float;
in vec2 vW;
uniform vec4 uL[${MAXL}];      // x, y (scene px), reach (px), light
uniform vec4 uA[${MAXL}];      // the share everywhere, -, -, -
uniform int uN;
uniform float uMode;           // 0 the light by day (dst x (1 + src)), 1 the emission at night (illumination, MAX), 2 the gloom (dst x src)
uniform float uK;              // the light's scale for this mode
uniform float uSquash;         // the view's ground squash (a pool on the ground is an ellipse on the screen)
uniform float uGrid;
uniform float uQ;
uniform vec2 uDrift;
out vec4 fragColor;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 q = vW / (uGrid * 9.0) + uDrift;
  float n = 0.62 * vn(q) + 0.38 * vn(q * 2.3 + 17.0);
  if ( uMode > 1.5 ) {
    // the storm's gloom: the land under a dark deck, a little uneven (the same slow patches), cooler (red goes first)
    float g = uK * mix(1.0, 0.8 + 0.4 * n, uQ);
    fragColor = vec4(vec3(1.0) - g * vec3(1.0, 0.9, 0.72) + (h2(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
    return;
  }
  float L = 0.0;
  for ( int k = 0; k < ${MAXL}; k++ ) {
    if ( k >= uN ) break;
    vec2 d = vW - uL[k].xy; d.y /= uSquash;
    float r = length(d) / uL[k].z;
    // a soft core and a long tail (no edge at any reach)
    float f = 0.65 * exp(-r * r * 1.6) + 0.35 / (1.0 + 3.0 * r * r);
    L += uL[k].w * (uA[k].x + (1.0 - uA[k].x) * f);
  }
  if ( L <= 0.002 ) discard;
  // the cloud filter: the light comes through an uneven deck (big soft patches, drifting)
  L *= mix(1.0, 0.7 + 0.6 * n, uQ);
  vec3 col = mix(vec3(0.70, 0.79, 1.0), vec3(1.0, 1.0, 1.0), smoothstep(0.45, 1.25, L));
  float dith = (h2(gl_FragCoord.xy) - 0.5) / 255.0;
  if ( uMode < 0.5 ) { fragColor = vec4(col * min(0.95, L * uK) + dith, 0.0); return; }
  fragColor = vec4(col * min(1.0, L * uK) + dith, 0.0);
}`;
let program = null;
const prog = () => (program ??= PIXI.Program.from(VERT, FRAG, "moinen-maps-weather-storm"));
/** The layer's own program (the idle pre-warm in weather.mjs). */
export const stormPrograms = () => [prog()];

/* ---------------------------------------------------------------- one bolt (a close strike) */

/** The bolt geometry's options for a flash (the same on the worker and the fallback). */
const boltOpts = (ev, g, view) => ({ lv: ev.lv, size: 1, dir: ev.dir, S: g.grid / g.ap, lift: view.lift, squash: view.squash });

/** Bolt geometry off the main thread (storm-worker.mjs); null when workers are unavailable (then built in an idle callback). */
let worker = null, workerOk = true, wid = 0;
const waiting = new Map();
function buildOff(ev, g, view) {
  if ( !workerOk ) return null;
  try {
    if ( !worker ) {
      worker = new Worker(new URL("./storm-worker.mjs", import.meta.url), { type: "module" });
      worker.onmessage = (e) => { const w = waiting.get(e.data?.id); if ( w ) { waiting.delete(e.data.id); e.data.D ? w.ok(e.data.D) : w.no(new Error(e.data.error)); } };
      worker.onerror = () => { workerOk = false; for ( const w of waiting.values() ) w.no(new Error("worker")); waiting.clear(); worker?.terminate(); worker = null; };
    }
    const id = ++wid;
    return new Promise((ok, no) => { waiting.set(id, { ok, no }); worker.postMessage({ id, seed: ev.seed, opts: boltOpts(ev, g, view) }); });
  } catch { workerOk = false; return null; }
}

class Bolt {
  constructor(ev, place, g, view, strikeProgram, root, glow, D) {
    this.ev = ev; this.T = L.timing(ev.seed, ev.lv);
    this.tex = PIXI.Texture.fromBuffer(D.data, D.W, D.H, { scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA });
    const cx = Math.floor((place.x - g.ox) / g.ap), cy = Math.floor((place.y - g.oy) / g.ap);
    const X0 = g.ox + (cx - D.cx) * g.ap, Y0 = g.oy + (cy - D.cy) * g.ap, B = L.BLOCK, pos = [], cell = [], ind = [];
    for ( const [bx, by] of D.blocks ) {
      const k = pos.length / 2, c0 = bx * B, r0 = by * B, c1 = Math.min(D.W, c0 + B), r1 = Math.min(D.H, r0 + B);
      for ( const [cc, rr] of [[c0, r0], [c1, r0], [c1, r1], [c0, r1]] ) { pos.push(X0 + cc * g.ap, Y0 + rr * g.ap); cell.push(cc, rr); }
      ind.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    this.geom = new PIXI.Geometry().addAttribute("aVertexPosition", pos, 2).addAttribute("aCell", cell, 2).addIndex(new Uint32Array(ind));
    const U = (emit) => ({ uData: this.tex, uLead: -1, uStream: -1, uStreamB: 0, uMain: 0, uBranch: 0, uWipe: 0, uCut: 0, uArc: -1, uArcB: 0, uArcCut: 1, uPlasma: 0, uHeat: 0, uEmit: emit, uFlk: 0 });
    this.mesh = new PIXI.Mesh(this.geom, new PIXI.Shader(strikeProgram(), U(0)));
    this.emit = new PIXI.Mesh(this.geom, new PIXI.Shader(strikeProgram(), U(1)));
    this.emit.blendMode = PIXI.BLEND_MODES.MAX_COLOR;
    this.mesh.visible = this.emit.visible = false;
    root.addChild(this.mesh); glow.addChild(this.emit);
  }
  /** One frame at t ms from the strike: the bolt's uniforms (the preset's frame, without its ground arcs and cooling plasma). */
  frame(t, k = 1) {
    const F = L.frameAt(this.T, t), any = F.lead >= 0 || F.stream >= 0 || F.main > 0.02 || F.branch > 0.02 || F.plasma > 0.02;
    this.mesh.visible = this.emit.visible = any;
    if ( !any ) return;
    const flk = (Math.floor(t / 40) * 0.618) % 1;
    for ( const m of [this.mesh, this.emit] ) Object.assign(m.shader.uniforms, { uLead: F.lead, uStream: F.stream, uStreamB: F.streamB * k, uMain: F.main * k,
      uBranch: F.branch * k, uWipe: F.wipe, uCut: F.cut, uArc: -1, uArcB: 0, uArcCut: 1, uPlasma: F.plasma * k, uHeat: 0, uFlk: flk });
  }
  destroy() {
    for ( const m of [this.mesh, this.emit] ) { m.parent?.removeChild(m); m.destroy(); }
    this.geom.destroy(); this.tex.destroy(true);
  }
}

/* ---------------------------------------------------------------- the layer */

export class StormDisplay {
  constructor() {
    this.events = []; this.evKey = null; this.extra = [];
    this.bolts = new Map(); this.building = new Set();
    this.ticking = false; this._tick = () => this.tick();
    this.stats = { flashes: 0, light: 0, bolts: 0, tickMs: 0, armed: false };
    this.lu = new Float32Array(MAXL * 4); this.la = new Float32Array(MAXL * 4);
    this.hookL = 0;
  }

  /**
   * From the weather's 12 Hz step: the stored storm `S`, the scene's seed, the rain's world presence `rainP(t)`, the art grid `g`,
   * the view, and the passes it lights (`wx` the weather display, `clouds` the cloud display, or null). Looks ahead and arms.
   */
  update(S, seed, rainP, g, view, wx, clouds, now) {
    this.S = S; this.seed = seed; this.g = g; this.view = view; this.wx = wx; this.clouds = clouds;
    // the flashes round now (looked up again four times a second, or when the storm or the rain changes)
    const key = `${Math.floor(now / 250)}|${S?.t}|${S?.on}|${S?.rate}|${S?.power}|${S?.near}|${S?.bolts}|${seed}`;
    if ( key !== this.evKey || this.rainP !== rainP ) { this.evKey = key; this.rainP = rainP; this.events = SM.flashes(S, seed, now - 1800, now + 3500, rainP); }
    this.extra = this.extra.filter((e) => e.t + e.end > now);
    const all = this.all();
    // the bolts of the next few seconds, built while the browser is idle
    if ( !reducedMotion() ) for ( const ev of all ) if ( ev.bolt && ev.t - now < 3000 && ev.t + ev.end > now ) this.prepare(ev);
    const soon = all.some((e) => e.t + SM.SPAN[0] - now < 160 && e.t + e.end > now);
    if ( soon ) this.arm();
    // the storm's gloom (no ticker: set here, 12 times a second, a slow fade)
    const night = Math.min(1, Math.max(0, canvas.environment?.darknessLevel ?? 0));
    const gl = SM.gloomAt(S, now, rainP) * (1 - 0.6 * night);
    if ( gl > 0.001 ) this.mount();
    if ( this.gloom && !this.gloom.destroyed ) {
      const u = this.gloom.shader.uniforms, dr = now / 1000 * 0.012;
      u.uK = gl; u.uQ = weatherQ(); u.uDrift[0] = dr; u.uDrift[1] = dr * 0.6;
      this.gloom.visible = gl > 0.001;
    }
    this.stats.gloom = +gl.toFixed(4);
  }
  all() { return this.extra.length ? [...this.events, ...this.extra] : this.events; }

  /** A local preview flash (the GM's test: only this client, nothing written): kind "far" | "mid" | "close", 400 ms from now. */
  preview(kind, now) {
    const C = this.S ? SM.cleanCore(this.S) : { ...SM.DEFAULT };
    const ev = SM.makeFlash({ ...C, on: true }, (this.seed ?? 1) ^ 0x3bd1, Math.floor(Math.random() * 1e9), Math.round(now + (kind === "close" ? 1000 : 400)), kind);
    ev.preview = true;
    this.extra.push(ev);
    if ( ev.bolt && !reducedMotion() ) this.prepare(ev, true);
    this.arm();
    return ev;
  }

  async prepare(ev, now = false) {
    const id = `${ev.k}|${ev.t}`;
    if ( this.bolts.has(id) || this.building.has(id) || !this.g ) return;
    this.building.add(id);
    let strikeProgram;
    try { ({ strikeProgram } = await import("../presets/lightning.mjs")); } catch ( err ) { console.warn("moinen-maps | weather: lightning bolt", err); return; }
    const g = this.g, view = this.view;
    const make = (D) => {
      this.building.delete(id);
      if ( this.destroyed || this.bolts.has(id) || !canvas.ready ) return;
      this.mount();
      try { this.bolts.set(id, new Bolt(ev, SM.placeOf(ev, canvas.dimensions.sceneRect, g.grid), g, view, strikeProgram, this.root, this.glow, D ?? L.strikeData(ev.seed, boltOpts(ev, g, view)))); }
      catch ( err ) { console.warn("moinen-maps | weather: lightning bolt", err); }
    };
    const off = buildOff(ev, g, view);
    if ( off ) { off.then(make, () => make(null)); return; }
    if ( now || !globalThis.requestIdleCallback ) make(null); else requestIdleCallback(() => make(null), { timeout: Math.max(50, ev.t - 900 - (this.now?.() ?? 0)) });
  }

  mount() {
    if ( this.light && !this.light.destroyed && this.light.parent ) return;
    const R = canvas.dimensions.rect;
    this.geom = new PIXI.Geometry().addAttribute("aVertexPosition", [R.x, R.y, R.x + R.width, R.y, R.x + R.width, R.y + R.height, R.x, R.y + R.height], 2).addIndex([0, 1, 2, 0, 2, 3]);
    const U = (mode) => ({ uL: this.lu, uA: this.la, uN: 0, uMode: mode, uK: 1, uSquash: 0.8, uGrid: canvas.dimensions.size, uQ: 1, uDrift: new Float32Array(2) });
    this.light = new PIXI.Mesh(this.geom, new PIXI.Shader(prog(), U(0)));
    this.light.state.blendMode = lightBlend(); this.light.state.depthTest = false; this.light.state.culling = false;
    Object.assign(this.light, { eventMode: "none", elevation: Infinity, sortLayer: LIGHT_LAYER, sort: 0, _lastSortedIndex: 0, visible: false });
    canvas.primary.addChild(this.light);
    this.gloom = new PIXI.Mesh(this.geom, new PIXI.Shader(prog(), U(2)));
    this.gloom.state.blendMode = lightBlend(GLOOM_BLEND); this.gloom.state.depthTest = false; this.gloom.state.culling = false;
    Object.assign(this.gloom, { eventMode: "none", elevation: Infinity, sortLayer: GLOOM_LAYER, sort: 0, _lastSortedIndex: 0, visible: false });
    canvas.primary.addChild(this.gloom);
    this.root = new PIXI.Container();
    Object.assign(this.root, { eventMode: "none", interactiveChildren: false, elevation: Infinity, sortLayer: BOLT_LAYER, sort: 0, _lastSortedIndex: 0 });
    canvas.primary.addChild(this.root);
    this.glow = new PIXI.Container(); this.glow.eventMode = "none";
    this.night = new PIXI.Mesh(this.geom, new PIXI.Shader(prog(), U(1)));
    // (ADD, not MAX: a faint distant flash is below the night's own darkness colour and MAX would lose it; added, it lifts the dark)
    this.night.blendMode = PIXI.BLEND_MODES.ADD; this.night.visible = false;
    this.glow.addChild(this.night);
    this.attach();
    this.hookL = Hooks.on("lightingRefresh", () => this.attach());
  }
  /** The emission container into the illumination (each lighting refresh empties it: put it back, as the fire does). */
  attach() { const box = canvas.effects?.illumination?.lights; if ( box && this.glow && !this.glow.destroyed && this.glow.parent !== box ) box.addChild(this.glow); }

  arm() {
    if ( this.ticking || this.destroyed ) return;
    this.mount();
    this.ticking = true; this.stats.armed = true;
    canvas.app.ticker.add(this._tick, null, PIXI.UPDATE_PRIORITY.LOW);
  }
  stop() {
    if ( this.ticking ) canvas.app?.ticker?.remove(this._tick);
    this.ticking = false; this.stats.armed = false;
    if ( this.light && !this.light.destroyed ) this.light.visible = false;
    if ( this.night && !this.night.destroyed ) this.night.visible = false;
    this.lit(0, null);
  }

  /** The rain's streaks and the cloud bodies follow the flash (0: exactly their plain look). */
  lit(k, top) {
    const wx = this.wx;
    if ( wx?.air && !wx.air.destroyed ) for ( const m of [wx.air] ) m.shader.uniforms.uFlash = k;
    const b = this.clouds?.bolt;
    if ( b ) { if ( top && k > 0 ) { const G = this.g.grid; b[0] = top.x / G; b[1] = top.y / G; b[2] = Math.max(6, top.R / G); b[3] = Math.min(1.1, k * 0.9); } else b[3] = 0; }
  }

  tick() {
    const t0 = performance.now();
    if ( !canvas?.ready || !this.light || this.light.destroyed || !this.g ) { this.stop(); return; }
    const now = this.now?.() ?? Date.now();
    let opts = null; try { opts = this.opts?.(); } catch { /* not ready */ }
    const red = reducedMotion() || !!opts?.reduced, calm = red || !!opts?.noFlash;
    const rect = canvas.dimensions.sceneRect, G = this.g.grid, lights = [];
    let live = false;
    for ( const ev of this.all() ) {
      const t = now - ev.t;
      if ( t > ev.end ) continue;
      live = true;
      if ( t < SM.SPAN[0] ) continue;
      const l = calm ? SM.calmAt(ev, t) : SM.lightAt(ev, t);
      if ( l > 0.002 ) lights.push([l, SM.placeOf(ev, rect, G)]);
    }
    // the bolts: drawn on their own timing; gone after their strike
    let nb = 0;
    for ( const [id, b] of this.bolts ) {
      const t = now - b.ev.t;
      if ( t > b.ev.end || red ) { b.destroy(); this.bolts.delete(id); continue; }
      b.frame(t, opts?.noFlash ? 0.8 : 1); nb++;
    }
    if ( !live && !nb ) { this.stop(); return; }
    lights.sort((a, b) => b[0] - a[0]);
    const n = Math.min(MAXL, lights.length);
    for ( let i = 0; i < n; i++ ) {
      const [l, p] = lights[i], o = i * 4;
      this.lu[o] = p.x; this.lu[o + 1] = p.y; this.lu[o + 2] = p.R; this.lu[o + 3] = l; this.la[o] = p.amb;
    }
    const night = Math.min(1, Math.max(0, canvas.environment?.darknessLevel ?? 0)), q = weatherQ();
    const sq = this.view?.squash ?? 0.8, dr = now / 1000 * 0.012;
    for ( const [m, k] of [[this.light, 1.1 * (1 - 0.45 * night)], [this.night, 1.2]] ) {
      const u = m.shader.uniforms;
      u.uN = n; u.uK = k; u.uSquash = Math.max(0.3, sq); u.uQ = q; u.uDrift[0] = dr; u.uDrift[1] = dr * 0.6;
      m.visible = n > 0 && (m === this.light || night > 0.02);
    }
    const peak = n ? lights[0][0] : 0;
    this.lit(Math.min(1.2, peak), n ? lights[0][1] : null);
    this.attach();
    this.stats.flashes = n; this.stats.light = +peak.toFixed(3); this.stats.bolts = nb; this.stats.tickMs = performance.now() - t0;
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    for ( const b of this.bolts.values() ) { try { b.destroy(); } catch { /* the canvas is going */ } }
    this.bolts.clear();
    if ( this.hookL ) Hooks.off("lightingRefresh", this.hookL); this.hookL = 0;
    for ( const o of [this.light, this.gloom, this.root] ) if ( o && !o.destroyed ) { o.parent?.removeChild(o); o.destroy({ children: true }); }
    if ( this.glow && !this.glow.destroyed ) { this.glow.parent?.removeChild(this.glow); this.glow.destroy({ children: true }); }
    this.geom?.destroy();
    this.light = this.gloom = this.root = this.glow = this.night = this.geom = null;
  }
}
