import * as M from "./model.mjs";
import { CLOUD_VERT, FIELD_FRAG, LIGHT_FRAG, SHADOW_FRAG, RAYS_FRAG, BODY_FRAG, OCT, NOCT } from "./clouds-glsl.mjs";
import { blendMode } from "./display.mjs";
import { weatherQ } from "./guard.mjs";
import { vortices } from "../wind.mjs";

/**
 * THE CLOUD LAYER (the weather type Clouds, and the wind's cloud shadows: ONE field, so nothing is doubled). The look is in
 * clouds-glsl.mjs; the drift in model.mjs (cloudDrift: the scene wind integrated along the timeline, the same on every client).
 *
 * Per display frame: two passes into small world-aligned textures over the view (+ the margins the offsets reach), then three stage
 * meshes that each fetch them:
 *   FIELD   the cloud density, 8 texels per square (half float, linear)
 *   LIGHT   body / its sunlight / the ground shadow / the godrays, on the same grid
 *   SHADOW  sortLayer 254, elevation 0: on the ground and the roofs' level, under tokens, cars and fire (fire makes its own light)
 *   RAYS    sortLayer 997, elevation Infinity: light added along the shafts, over the bodies (they glow up through the gaps and show
 *           through the thinner deck, dimmed where a body is); only while the godrays are on
 *   BODY    sortLayer 996, elevation Infinity: above everything (the viewer is above the clouds: rain falls out of them)
 * THE VIEW: a cloud floats H squares up, so its body is drawn lift x H higher up the screen than the ground under it, and its shadow
 * falls S x H away from the sun (the sun in the upper left, as every lit thing on the module's maps): cloud and shadow separate by
 * the view and the sun.
 *
 * COST: no clouds (and no wind cloud shadows) -> this display does not exist. Godrays off -> their loop and their mesh are skipped.
 * The frame guard (weatherQ) trims the ray samples and the field density while it holds the frame rate.
 */
export const H = 4;                     // the cloud layer's height (squares)
export const SUN = [0.5, 0.38];         // the shadow's offset per square of height (from the sun in the upper left)
const TPS = 8, MAX_TEXELS = 1.6e6;
// the cover (share of the sky) -> the field's density threshold: the field's own quantiles (measured over 16 000 squares of it)
export const COVER_Q = [[0, 0.98], [0.01, 0.858], [0.05, 0.78], [0.1, 0.735], [0.2, 0.674], [0.3, 0.627], [0.4, 0.584], [0.5, 0.542], [0.6, 0.501], [0.7, 0.458], [0.8, 0.411], [0.9, 0.353], [0.95, 0.309], [0.99, 0.23], [1, 0.02]];
export function coverThr(c) {
  c = Math.min(1, Math.max(0, c));
  for ( let i = 1; i < COVER_Q.length; i++ ) {
    const [a, ta] = COVER_Q[i - 1], [b, tb] = COVER_Q[i];
    if ( c <= b ) return ta + (tb - ta) * (c - a) / (b - a);
  }
  return COVER_Q.at(-1)[1];
}

let progs = {};
const prog = (k, v, f) => progs[k] ??= PIXI.Program.from(v, f, `moinen-maps-clouds-${k}`);
const RT_VERT = CLOUD_VERT;
/** The layer's programs (made here, compiled by their first draw, or earlier by the idle pre-warm in weather.mjs). */
export function cloudPrograms() {
  return [prog("field", RT_VERT, FIELD_FRAG), prog("light", RT_VERT, LIGHT_FRAG), prog("shadow", CLOUD_VERT, SHADOW_FRAG), prog("rays", CLOUD_VERT, RAYS_FRAG),
    prog("body", CLOUD_VERT, BODY_FRAG)];
}
const IDENT = new PIXI.Matrix().toArray(true);
const ss = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

export class CloudDisplay {
  constructor() {
    this.meshes = []; this.rtA = null; this.rtB = null;
    this.stats = { texels: 0, tps: 0, rays: 0, cover: 0, tickMs: 0 };
    this._tick = () => this.tick();
    this.ticking = false;
    this.off = new Float32Array(NOCT * 2);
    this.tor = new Float32Array(12);
    this.fire = new Float32Array(48); this.holes = new Map(); this.fireAt = 0; this.fireT = 0;
    this._p = new PIXI.Point();
    this.build();
  }

  build() {
    const d = canvas.dimensions, sr = d.sceneRect, R = d.rect, bm = blendMode();
    this.grid = d.size;
    const quad = (r) => new PIXI.Geometry().addAttribute("aVertexPosition", [r.x, r.y, r.x + r.width, r.y, r.x + r.width, r.y + r.height, r.x, r.y + r.height], 2).addIndex([0, 1, 2, 0, 2, 3]);
    this.gScene = quad(sr); this.gAll = quad(R);
    const g = this.grid, sq = (r) => new Float32Array([r.x / g, r.y / g, (r.x + r.width) / g, (r.y + r.height) / g]);
    const common = (edge, w) => ({ uLight: PIXI.Texture.WHITE, uGrid: new Float32Array([0, 0, TPS, g]), uSize: new Float32Array([1, 1]), uEdge: sq(edge), uEdgeW: w,
      uNight: 0, translationMatrix: IDENT });
    const place = (m, layer, elev) => { m.eventMode = "none"; Object.assign(m, { elevation: elev, sortLayer: layer, sort: 0, _lastSortedIndex: 0 });
      m.state.blendMode = bm; m.state.depthTest = false; m.state.culling = false; m.visible = false; canvas.primary.addChild(m); this.meshes.push(m); return m; };
    this.shadow = place(new PIXI.Mesh(this.gScene, new PIXI.Shader(prog("shadow", CLOUD_VERT, SHADOW_FRAG), { ...common(sr, 0.35), uShade: new Float32Array(4) })), 254, 0);
    this.rays = place(new PIXI.Mesh(this.gScene, new PIXI.Shader(prog("rays", CLOUD_VERT, RAYS_FRAG), { ...common(sr, 1.2), uRay: new Float32Array(4) })), 997, Infinity);
    this.body = place(new PIXI.Mesh(this.gAll, new PIXI.Shader(prog("body", CLOUD_VERT, BODY_FRAG), { ...common(R, 2.5), uCl: new Float32Array(4), uTor: this.tor, uTorN: 0, uFire: this.fire, uFireN: 0,
      uOff: this.off, uSeed: 1 })), 996, Infinity);
    // the two texture passes: one quad in texel units, drawn straight into its texture (as cells.mjs)
    this.rtQuad = new PIXI.Geometry().addAttribute("aVertexPosition", new Float32Array(8), 2).addIndex([0, 1, 2, 0, 2, 3]);
    const st = PIXI.State.for2d(); st.blend = false; st.depthTest = false; st.culling = false; this.rtState = st;
    this.fieldShader = new PIXI.Shader(prog("field", RT_VERT, FIELD_FRAG), { uGrid: new Float32Array(4), uOff: this.off, uSeed: 1, translationMatrix: IDENT });
    this.lightShader = new PIXI.Shader(prog("light", RT_VERT, LIGHT_FRAG), { uField: PIXI.Texture.WHITE, uGrid: new Float32Array(4), uSize: new Float32Array(2),
      uCl: new Float32Array(4), uSun: new Float32Array(SUN), uRays: 0, uRaysN: 20, translationMatrix: IDENT });
    this.ok = !!canvas.app.renderer.gl?.getExtension("EXT_color_buffer_float");
  }

  /** The weather's state (12 Hz) and the flag: what to show. */
  setState(st, P, now) {
    this.st = st; this.P = P;
    const cl = st?.fx?.clouds, cp = cl?.p ?? 0, CG = M.gates("clouds", cl?.s ?? 1);
    const wi = st?.fx?.wind, wp = wi?.p ?? 0, wc = wp * M.gate(M.TABLES.wind.cloud, wi?.s ?? 0) * M.WIND_CLOUD_COVER;
    // clouds condense out of a clear sky (their cover grows with their presence) and thin away again; the wind's shadows the same field
    const cc = CG.cover * ss(cp * 1.15);
    this.cover = Math.max(cc, wc);
    this.cp = cp; this.CG = CG; this.wc = wc;
    this.seed = P.seed | 0;
    const want = this.ok && this.cover > 0.002;
    this.arm(want);
  }

  arm(want) {
    if ( want === this.ticking ) return;
    this.ticking = want;
    if ( want ) canvas.app.ticker.add(this._tick); else { canvas.app.ticker.remove(this._tick); for ( const m of this.meshes ) m.visible = false; }
  }

  /** The view in squares. */
  viewSq() {
    const v = canvas.app.renderer.screen, st = canvas.stage, p = this._p, g = this.grid;
    p.set(0, 0); st.toLocal(p, undefined, p); const x0 = p.x / g, y0 = p.y / g;
    p.set(v.width, v.height); st.toLocal(p, undefined, p);
    return [x0, y0, p.x / g, p.y / g];
  }

  tick() {
    const t0 = performance.now(), P = this.P, st = this.st;
    if ( !P || !st || !canvas.stage ) return;
    const now = this.now?.() ?? Date.now(), q = weatherQ();
    const lift = st.view?.lift ?? 0.5, g = this.grid;
    // the switches (mode, godrays) fade on the shared clock
    const C = P.clouds, sky = M.cloudSwitch(C.mode === "sky", C.modeT, now), rays = M.cloudSwitch(C.rays, C.raysT, now);
    const night = Math.min(1, Math.max(0, canvas.environment?.darknessLevel ?? 0));
    // the octaves' offsets: the drift x their motion share + their own evolution, mod the lattice period (in doubles)
    const [dx, dy] = M.cloudDrift(P, now), ts = now / 1000;
    for ( let k = 0; k < NOCT; k++ ) {
      const [fr, a, m, e] = OCT[k], c = Math.cos(a) * fr, s = Math.sin(a) * fr, X = dx * m, Y = dy * m;
      const ox = c * X - s * Y + e[0] * ts, oy = s * X + c * Y + e[1] * ts;
      this.off[k * 2] = ((ox % 256) + 256) % 256; this.off[k * 2 + 1] = ((oy % 256) + 256) % 256;
    }
    // the grid over the view (+ the margins: the shadow looks S x H toward the sun, the body H x lift down the screen, the light 1.4 sq sunward)
    const d = canvas.dimensions, R = d.rect;
    const [vx0, vy0, vx1, vy1] = this.viewSq();
    const X0 = Math.max(vx0, R.x / g) - SUN[0] * H - 1.6, Y0 = Math.max(vy0, R.y / g) - SUN[1] * H - 1.6;
    const X1 = Math.min(vx1, (R.x + R.width) / g) + 1, Y1 = Math.min(vy1, (R.y + R.height) / g) + lift * H + 1.6;
    if ( X1 <= X0 || Y1 <= Y0 ) { for ( const m of this.meshes ) m.visible = false; return; }
    let tps = TPS * (q >= 0.999 ? 1 : 0.75 + 0.25 * q);
    while ( (X1 - X0) * (Y1 - Y0) * tps * tps > MAX_TEXELS && tps > 1 ) tps /= 2;
    const ox = Math.floor(X0 * tps) / tps, oy = Math.floor(Y0 * tps) / tps;
    const w = Math.ceil((X1 - ox) * tps), h = Math.ceil((Y1 - oy) * tps);
    this.ensure(w, h);
    const thr = coverThr(this.cover), soft = 0.035;
    // godrays: sun shafts by day, cooling to faint silver moonbeams at dusk; gone in full night (the moon is too dim to light the
    // haze, and the scene's darkness owns the night): not computed then
    const raysK = rays * (1 - ss((night - 0.6) / 0.35));
    const raysOn = this.cp > 0.001 && raysK > 0.001;
    const nRays = Math.max(10, Math.round(24 * (0.55 + 0.45 * q)));
    // FIELD, then LIGHT
    const fu = this.fieldShader.uniforms; fu.uGrid[0] = ox; fu.uGrid[1] = oy; fu.uGrid[2] = tps; fu.uSeed = this.seed;
    const lu = this.lightShader.uniforms;
    lu.uField = this.rtA; lu.uGrid[0] = ox; lu.uGrid[1] = oy; lu.uGrid[2] = tps; lu.uSize[0] = this.rtA.width; lu.uSize[1] = this.rtA.height;
    lu.uCl[0] = thr; lu.uCl[1] = soft; lu.uCl[2] = H; lu.uCl[3] = lift; lu.uRays = raysOn ? 1 : 0; lu.uRaysN = nRays;
    this.draw(this.rtA, this.fieldShader, w, h);
    this.draw(this.rtB, this.lightShader, w, h);
    // the stage passes
    for ( const m of this.meshes ) {
      const u = m.shader.uniforms;
      u.uLight = this.rtB; u.uGrid[0] = ox; u.uGrid[1] = oy; u.uGrid[2] = tps; u.uSize[0] = this.rtB.width; u.uSize[1] = this.rtB.height; u.uNight = night;
    }
    // shadow: the clouds' own darkness, the wind's lighter shadows where they make the cover
    const CG = this.CG, cc = this.cover > 0 ? Math.min(1, (CG.cover * ss(this.cp * 1.15)) / this.cover) : 0;
    const su = this.shadow.shader.uniforms;
    su.uShade[0] = (cc * CG.shade + (1 - cc) * 0.2) * (1 - 0.6 * night); su.uShade[1] = 1;
    this.shadow.visible = true;
    const ru = this.rays.shader.uniforms;
    ru.uRay[0] = raysOn ? this.cp * CG.rays * raysK : 0; ru.uRay[1] = this.cover; ru.uRay[2] = thr; ru.uRay[3] = Math.min(1, CG.body * ss(this.cp * 1.4) * sky);
    this.rays.visible = raysOn;
    // (at night the bodies thin: under the dark sky they are seen mostly as the stars and map they hide, and where a light such as a
    // fire reaches them the scene's lighting would show them as flat bright shapes)
    const bu = this.body.shader.uniforms, bodyA = CG.body * ss(this.cp * 1.4) * sky * (1 - 0.25 * night);
    bu.uCl[0] = thr; bu.uCl[1] = soft; bu.uCl[2] = bodyA; bu.uCl[3] = 0.11; bu.uSeed = this.seed;
    this.vortex();
    this.fireHoles(now);
    this.body.visible = bodyA > 0.002;
    this.stats.texels = w * h; this.stats.tps = tps; this.stats.rays = raysOn ? nRays : 0; this.stats.cover = this.cover; this.stats.thr = thr;
    this.stats.tickMs = performance.now() - t0;
  }

  /** Tornadoes thin the cloud bodies around them (their own wall cloud and deck are there). */
  vortex() {
    const list = vortices(), n = Math.min(3, list.length), T = this.tor;
    for ( let i = 0; i < n; i++ ) { const v = list[i]; T[i * 4] = v.x; T[i * 4 + 1] = v.y; T[i * 4 + 2] = Math.max(2, v.R * 1.3); T[i * 4 + 3] = v.p; }
    this.body.shader.uniforms.uTorN = n;
  }

  /**
   * Burning fire opens the cloud bodies over it (its heat breaks the cloud; seen from above the flames would otherwise vanish under
   * a cloud, or show through as flat bright shapes where the fire's own light skips the scene's darkness). The fire strokes
   * (api.fire.list, read 4 times a second) as up to 12 circles along them; each opening eases in and out over ~2 s.
   */
  fireHoles(now) {
    const H = this.holes, g = this.grid;
    if ( now - this.fireAt > 250 || now < this.fireAt ) {
      this.fireAt = now;
      let list = [];
      try { list = game.modules.get("moinen-maps")?.api?.fire?.list?.() ?? []; } catch { list = []; }
      for ( const h of H.values() ) h.want = 0;
      for ( const f of list ) {
        if ( f.k !== "fire" || !Array.isArray(f.p) || f.p.length < 2 ) continue;
        const r = (f.r ?? 50) / g, pts = [];
        for ( let i = 0; i + 1 < f.p.length; i += 2 ) pts.push([f.p[i] / g, f.p[i + 1] / g]);
        // circles along the stroke, about one reach apart
        const step = Math.max(0.5, r * 1.2);
        const add = (x, y) => { const key = `${f.id}:${Math.round(x * 4)}:${Math.round(y * 4)}`; const h = H.get(key); if ( h ) h.want = 1; else H.set(key, { x, y, r: r + 2.5, w: 0, want: 1 }); };
        add(pts[0][0], pts[0][1]);
        for ( let i = 1; i < pts.length; i++ ) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(L / step));
          for ( let j = 1; j <= n; j++ ) add(x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n);
        }
      }
    }
    const dt = Math.min(0.25, Math.max(0, (now - (this.fireT || now)) / 1000)); this.fireT = now;
    const F = this.fire; let n = 0;
    for ( const [k, h] of H ) {
      h.w += Math.sign(h.want - h.w) * Math.min(Math.abs(h.want - h.w), dt / 2);
      if ( h.w <= 0 && !h.want ) { H.delete(k); continue; }
      if ( n < 12 ) { F[n * 4] = h.x; F[n * 4 + 1] = h.y; F[n * 4 + 2] = h.r; F[n * 4 + 3] = h.w * h.w * (3 - 2 * h.w); n++; }
    }
    this.body.shader.uniforms.uFireN = n;
  }

  ensure(w, h) {
    if ( this.rtA && this.rtA.width >= w && this.rtA.height >= h ) return;
    const W = Math.max(this.rtA?.width ?? 0, Math.ceil(w / 64) * 64), Hh = Math.max(this.rtA?.height ?? 0, Math.ceil(h / 64) * 64);
    this.rtA?.destroy(true); this.rtB?.destroy(true);
    const mk = () => PIXI.RenderTexture.create({ width: W, height: Hh, resolution: 1, type: PIXI.TYPES.HALF_FLOAT, format: PIXI.FORMATS.RGBA,
      scaleMode: PIXI.SCALE_MODES.LINEAR, mipmap: PIXI.MIPMAP_MODES.OFF });
    this.rtA = mk(); this.rtB = mk();
  }

  /** One quad of w x h texels straight into a texture with PIXI's systems (as cells.mjs): bind, draw, bind back. */
  draw(rt, shader, w, h) {
    const r = canvas.app.renderer, RT = r.renderTexture;
    const qb = this.rtQuad.getBuffer("aVertexPosition"), b = qb.data;
    b[0] = 0; b[1] = 0; b[2] = w; b[3] = 0; b[4] = w; b[5] = h; b[6] = 0; b[7] = h; qb.update();
    r.batch.flush();
    const cur = RT.current, sf = (this._sf ??= new PIXI.Rectangle()).copyFrom(RT.sourceFrame), df = (this._df ??= new PIXI.Rectangle()).copyFrom(RT.destinationFrame);
    RT.bind(rt);
    r.shader.bind(shader);
    r.state.set(this.rtState);
    r.geometry.bind(this.rtQuad, shader);
    r.geometry.draw(PIXI.DRAW_MODES.TRIANGLES, 6, 0);
    RT.bind(cur, sf, df);
  }

  destroy() {
    canvas.app?.ticker?.remove(this._tick); this.ticking = false;
    for ( const m of this.meshes ) { m.parent?.removeChild(m); m.destroy(); }
    this.meshes = [];
    this.gScene?.destroy(); this.gAll?.destroy(); this.rtQuad?.destroy();
    this.rtA?.destroy(true); this.rtB?.destroy(true); this.rtA = this.rtB = null;
  }
}
