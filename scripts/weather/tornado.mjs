import * as TM from "./tornado-model.mjs";
import * as TD from "./tornado-debris.mjs";
import { QUAD_VERT, deckFrag, COLUMN_FRAG, FOOT_FRAG, volFrag, PART_VERT, PART_FRAG, GROUND_VERT, GROUND_FRAG, GROUND_CELL_FRAG, SHOW_FRAG } from "./tornado-glsl.mjs";
import { CellCache, cellVert, showSmooth } from "./cells.mjs";
import { weatherQ } from "./guard.mjs";
import { blendMode } from "./display.mjs";
import { hu, sceneWind, dirVec } from "../wind.mjs";
import { mapPixels } from "../destruction/source.mjs";

/**
 * Shows the scene's TORNADOES (research 3.2; the look in tornado-glsl.mjs, the pure model in tornado-model.mjs).
 *
 * Per tornado, every display frame:
 *   CPU  the AXIS TABLE (40 heights: where the rope is and how thick, from the base's lagged path, layered travelling waves, the lean
 *        from the path's acceleration, breathing and travelling pinches), and the debris (specks, tumbling map fragments, planks,
 *        clumps, wisps, inflow streaks, chunk shadows, scars): closed-form slots of the shared clock (each a pure function of its slot,
 *        cycle and the stored path), a few hundred instances, no state.
 *   GPU  the art texture back to front (far curtain, skirt, back debris, the debris + wall cloud volumes behind the funnel, column, the
 *        volumes in front of it, front debris, near curtain, deck; the volumes only on their own sub-rects), then two stage meshes and
 *        one quad: the ground (under tokens), the marks on the ground (under tokens), the art (above tokens).
 * The art texture has whole-art-px origin and follows the tornado; it is sized once for the tornado's level-3 extent.
 *
 * COST: no tornado -> this display does not exist. A tornado off screen draws nothing (its CPU tables are skipped too).
 */
const K = 40;
const TAU = Math.PI * 2;
const SPIN = TM.SPIN;
const MAX_I = 1024;
const STRIDE = 16;
const GREYS = [[0.11, 0.12, 0.15], [0.18, 0.19, 0.23], [0.26, 0.27, 0.31], [0.35, 0.36, 0.40], [0.45, 0.46, 0.50], [0.56, 0.57, 0.60], [0.69, 0.70, 0.72]];
const SNAKE = [[9.0, 0.019, 3, 0.3], [5.0, 0.034, -2, 1.9], [2.8, 0.051, 5, 4.1], [1.4, 0.083, 7, 2.6], [0.8, 0.13, -4, 0.8], [0.45, 0.21, 9, 5.0]];
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fr = (x) => x - Math.floor(x);
const PINCH = [[0.2, 0.1, 0.8], [0.3, 0.55, 0.65]];
const TOUCHES = [[1.6, 1.0], [4.3, 0.6], [6.9, 0.85], [8.8, 0.45]];
const STRIKE = [[0, 1], [0.22, 0.7]];
const SPECK_A = [0.30, 0.23, 0.17], SPECK_B = [0.20, 0.19, 0.20], LEAF = [0.62, 0.52, 0.22];
const PL_A = [0.55, 0.40, 0.24], PL_B = [0.66, 0.52, 0.34];
// THE ART AT SCREEN RESOLUTION (2026-11-09): k texels per art px, about the device px per art px, over the part on screen only; the
// texel budget (x the frame guard's q) caps k when the tornado fills a large, magnified screen (then a texel is still under ~1.5
// device px: real detail, never a magnified texture). The volumes' ray samples drop a little as k grows (finer texels, finer jitter).
const ART_BUDGET = 2.4e6, K_MAX = 6, ART_MAX = 4096;
const volSteps = (k, gq) => Math.max(10, Math.round((k <= 1.25 ? 18 : k <= 2.5 ? 15 : 13) * (0.6 + 0.4 * gq)));

let progs = {};
const prog = (k, v, f) => progs[k] ??= PIXI.Program.from(v, f, `moinen-maps-tornado-${k}`);

// (the deck and the volume are split per part / mode: one program each links many times faster than the whole on D3D11, see volFrag)
const deckProg = (part) => prog(`deck-${part}`, QUAD_VERT, deckFrag(part));
const volProg = (stage, mode) => prog(`vol${stage}-${mode}`, QUAD_VERT, volFrag(stage, mode));

/** A tornado's programs (made here, compiled by their first draw, or earlier by the idle pre-warm in weather.mjs). */
export function tornadoPrograms() {
  return [deckProg("curtain"), deckProg("deck"), prog("column", QUAD_VERT, COLUMN_FRAG), prog("foot", QUAD_VERT, FOOT_FRAG),
    volProg(2, 0), volProg(2, 1), volProg(0, 0), volProg(0, 1), volProg(1, 0), volProg(1, 1),
    prog("part", PART_VERT, PART_FRAG), prog("ground", GROUND_VERT, GROUND_FRAG), prog("groundCell", cellVert("vP"), GROUND_CELL_FRAG),
    prog("groundShow", GROUND_VERT, showSmooth("vP")), prog("show", GROUND_VERT, SHOW_FRAG)];
}

/** The scene's background as the shader samples it, or null (as fire's display). */
function mapOf() {
  const b = canvas.primary?.background, t = b?.texture;
  if ( !t?.valid || !b.width || !b.height ) return null;
  return { texture: t, rect: [b.x - b.width * (b.anchor?.x ?? 0), b.y - b.height * (b.anchor?.y ?? 0), b.width, b.height] };
}

/** A coarse copy of the map on the CPU (one texel per 8 art px): the dirt colour under a tornado. */
let dirtMap = null;
function dirtAt(geo, ax, ay) {
  const key = `${canvas.scene?.id}|${canvas.scene?.background?.src}|${geo.ap}|${geo.aw}x${geo.ah}`;
  if ( dirtMap?.key !== key ) {
    const w = Math.max(1, Math.ceil(geo.aw / 8)), h = Math.max(1, Math.ceil(geo.ah / 8));
    let px = null;
    try { px = mapPixels(geo.ap * 8, { x0: 0, y0: 0, w, h }); } catch { px = null; }
    dirtMap = { key, w, h, px };
  }
  const D = dirtMap; if ( !D.px ) return [0.5, 0.45, 0.38];
  let r = 0, g = 0, b = 0, n = 0;
  const cx = Math.floor(ax / 8), cy = Math.floor(ay / 8);
  for ( let y = cy - 2; y <= cy + 2; y++ ) for ( let x = cx - 2; x <= cx + 2; x++ ) {
    if ( x < 0 || y < 0 || x >= D.w || y >= D.h ) continue;
    const o = (y * D.w + x) * 4; r += D.px[o]; g += D.px[o + 1]; b += D.px[o + 2]; n++;
  }
  if ( !n ) return [0.5, 0.45, 0.38];
  return [r / n / 255, g / n / 255, b / n / 255];
}

const quadGeom = (x0, y0, x1, y1) => new PIXI.Geometry().addAttribute("aVertexPosition", [x0, y0, x1, y0, x1, y1, x0, y1], 2).addIndex([0, 1, 2, 0, 2, 3]);
function instGeom(n, rect) {
  const g = new PIXI.Geometry();
  const buf = new PIXI.Buffer(new Float32Array(n * STRIDE), false, false);
  g.addAttribute("aVertexPosition", rect, 2).addAttribute("aCorner", [0, 0, 1, 0, 1, 1, 0, 1], 2).addIndex([0, 1, 2, 0, 2, 3]);
  for ( const [nm, off] of [["aA", 0], ["aB", 4], ["aC", 8], ["aD", 12]] ) g.addAttribute(nm, buf, 4, false, PIXI.TYPES.FLOAT, STRIDE * 4, off * 4, true);
  g.instanced = true; g.instanceCount = 0;
  return { g, buf, data: buf.data };
}
/** A list of instances (16 floats each) filled per frame. */
class Inst {
  constructor(n) { this.d = new Float32Array(n * STRIDE); this.n = 0; this.max = n; }
  push(x, y, hx, hy, ang, kind, seed, al, r, g, b, dis, sx = 0, sy = 0, fresh = 0, extra = 0) {
    if ( this.n >= this.max || !(al > 0.002) ) return;
    const o = this.n++ * STRIDE, d = this.d;
    d[o] = x; d[o + 1] = y; d[o + 2] = hx; d[o + 3] = hy; d[o + 4] = ang; d[o + 5] = kind; d[o + 6] = seed; d[o + 7] = al;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = dis; d[o + 12] = sx; d[o + 13] = sy; d[o + 14] = fresh; d[o + 15] = extra;
  }
}

/** One tornado: its textures, passes and stage meshes. */
class TornadoView {
  constructor(T, owner) {
    this.T = T; this.owner = owner; this.id = T.id;
    const geo = owner.geo, cps = geo.grid / geo.ap;
    this.U = cps / 32 * T.size;
    const U = this.U, L3 = TM.looks(2), lift = 0.5;
    // the art texture: the level-3 extent (deck + feeder bands + drift of the top), whole art px
    const side = Math.ceil((L3.deckR * 2.0 + 40) * U);
    this.W = Math.min(2048, 2 * side);
    this.top = Math.ceil(lift * L3.Z * U + L3.deckR * 1.2 * U + 50 * U);
    this.bot = Math.ceil(L3.skirt * 0.8 * 1.7 * U + 30 * U);
    this.H = Math.min(2048, this.top + this.bot);
    const W = this.W, H = this.H;
    // (the art texture: a frame of it is drawn each frame, the window on screen at k texels per art px; it grows in steps, never shrinks)
    this.art = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1, scaleMode: PIXI.SCALE_MODES.LINEAR });
    this.art.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    this.art.noFrame = false;                                  // (its frame is ours: a base update must not reset it to the whole)
    this.capW = W; this.capH = H;
    this.rect = new Float32Array([0, 0, W, H]);
    this.win = new Float32Array([0, 0, 1, 0]); this.winS = new Float32Array([W, H]);
    const sd = T.seed % 9973;
    const common = { uT: 0, uU: U, uPx: 1, uView: new Float32Array([0.5, 0.8]), uRect: this.rect, uSd: sd, translationMatrix: new PIXI.Matrix().toArray(true) };
    const quad = (program, extra) => {
      const m = new PIXI.Mesh(quadGeom(0, 0, W, H), new PIXI.Shader(program, { ...common, ...extra }));
      m.state.blendMode = PIXI.BLEND_MODES.NORMAL; m.state.depthTest = false; m.state.culling = false;
      return m;
    };
    this.axis = new Float32Array(K * 4);
    const deckU = { uTop: new Float32Array(4), uDeck: new Float32Array(4), uBase: new Float32Array(4), uCurt: new Float32Array(4), uPh: new Float32Array(4), uHole: new Float32Array(4) };
    this.curtain = quad(deckProg("curtain"), { uMode: 0, ...deckU });
    this.curtainF = quad(deckProg("curtain"), { uMode: 2, ...deckU });
    this.deck = quad(deckProg("deck"), { uMode: 1, ...deckU });
    this.column = quad(prog("column", QUAD_VERT, COLUMN_FRAG), { uAxis: this.axis, uCol: new Float32Array(4), uPh: new Float32Array(4), uDust: new Float32Array(3) });
    const footU = () => ({ uBase: new Float32Array(4), uMot: new Float32Array(4), uPh: new Float32Array(4), uDust: new Float32Array(3), uWall: new Float32Array(4) });
    this.skirt = quad(prog("foot", QUAD_VERT, FOOT_FRAG), { uMode: 0, ...footU() });
    // the volumes (debris cloud, wall cloud) x (behind the column, in front of it): each on its own sub-rect of the art texture
    const volU = (mode, pass) => ({ ...common, uAxis: this.axis, uMode: mode, uPass: pass, uSteps: 18, uMarch: PIXI.Texture.EMPTY, uMwin: new Float32Array([0, 0, 1, 0]), uMsize: new Float32Array([1, 1]), uVol: new Float32Array(4), uMot: new Float32Array(4), uPh: new Float32Array(4), uDust: new Float32Array(3) });
    const vmesh = (mode, pass) => {
      const m = new PIXI.Mesh(quadGeom(0, 0, 1, 1), new PIXI.Shader(volProg(2, mode), volU(mode, pass)));
      m.vmode = mode;
      m.state.blendMode = PIXI.BLEND_MODES.NORMAL; m.state.depthTest = false; m.state.culling = false;
      // its MARCH (the adaptive-resolution ray march): the same quad and uniforms, the march stage into its own float texture
      const mm = new PIXI.Mesh(m.geometry, new PIXI.Shader(volProg(0, mode), m.shader.uniformGroup));
      mm.state.blendMode = PIXI.BLEND_MODES.NONE; mm.state.depthTest = false; mm.state.culling = false;
      m.march = { mesh: mm, rt: null, cw: 0, ch: 0 };
      return m;
    };
    this.debB = vmesh(0, 0); this.debF = vmesh(0, 1); this.wallB = vmesh(1, 0); this.wallF = vmesh(1, 1);
    // debris (art texture: back, front) and marks on the ground (stage)
    const map = mapOf();
    const pu = (stage) => ({ ...common, uStage: stage, uOrigin: new Float32Array([geo.ox, geo.oy, geo.ap]), uMap: map?.texture ?? PIXI.Texture.WHITE,
      uMapRect: new Float32Array(map?.rect ?? [0, 0, 1, 1]), uHasMap: map ? 1 : 0 });
    const sx0 = geo.ox, sy0 = geo.oy, sx1 = geo.ox + geo.aw * geo.ap, sy1 = geo.oy + geo.ah * geo.ap;
    this.ib = instGeom(MAX_I, [0, 0, W, 0, W, H, 0, H]); this.ifr = instGeom(MAX_I, [0, 0, W, 0, W, H, 0, H]); this.ig = instGeom(MAX_I, [sx0, sy0, sx1, sy0, sx1, sy1, sx0, sy1]);
    const pmesh = (I, stage) => {
      const m = new PIXI.Mesh(I.g, new PIXI.Shader(prog("part", PART_VERT, PART_FRAG), pu(stage)));
      m.state.blendMode = stage ? blendMode() : PIXI.BLEND_MODES.NORMAL; m.state.depthTest = false; m.state.culling = false;
      return m;
    };
    this.back = pmesh(this.ib, 0); this.front = pmesh(this.ifr, 0); this.marks = pmesh(this.ig, 1);
    this.Lb = new Inst(MAX_I); this.Lf = new Inst(MAX_I); this.Lg = new Inst(MAX_I);
    // stage: the ground quad (moves), the marks, the art quad (moves)
    this.gGeom = new PIXI.Geometry().addAttribute("aVertexPosition", new Float32Array(8), 2).addAttribute("aCell", new Float32Array(8), 2).addIndex([0, 1, 2, 0, 2, 3]);
    this.track = new Float32Array(16 * 4);
    this.ground = new PIXI.Mesh(this.gGeom, new PIXI.Shader(prog("ground", GROUND_VERT, GROUND_FRAG), { ...common, uAxis: this.axis, uG: new Float32Array(4), uGc: new Float32Array(4), uTrack: this.track, uAlpha: 1 }));
    this.sGeom = new PIXI.Geometry().addAttribute("aVertexPosition", new Float32Array(8), 2).addAttribute("aCell", new Float32Array(8), 2).addIndex([0, 1, 2, 0, 2, 3]);
    this.show = new PIXI.Mesh(this.sGeom, new PIXI.Shader(prog("show", GROUND_VERT, SHOW_FRAG), { uArt: this.art, uRect: this.rect, uWin: this.win, uWinS: this.winS, uAlpha: 1, translationMatrix: new PIXI.Matrix().toArray(true) }));
    const bm = blendMode();
    for ( const [m, layer] of [[this.ground, 252], [this.marks, 252.5], [this.show, 993]] ) {
      m.eventMode = "none"; m.state.blendMode = bm; m.state.depthTest = false; m.state.culling = false;
      Object.assign(m, { elevation: 0, sortLayer: layer, sort: 0, _lastSortedIndex: 0 });
      m.visible = false;
      canvas.primary.addChild(m);
    }
    // the ground is one value per art cell: zoomed in, computed per cell into a float texture and fetched (cells.mjs)
    this.groundCells = new CellCache(this.ground, prog("groundCell", cellVert("vP"), GROUND_CELL_FRAG), prog("groundShow", GROUND_VERT, showSmooth("vP")), { smooth: true });
    // the art passes back to front, drawn by ONE render call (the same draws in the same order as one call each)
    this.artRoot = new PIXI.Container();
    this.artRoot.addChild(this.curtain, this.skirt, this.back, this.debB, this.wallB, this.column, this.debF, this.wallF, this.front, this.curtainF, this.deck);
    this.frags = [];                                           // per fragment slot: what its current life was born as (debris)
    this.stats = { inst: 0, cpuMs: 0, k: 1, texels: 0 };
    // the per-frame scratch (no garbage per frame)
    this.timed = [this.curtain, this.curtainF, this.deck, this.column, this.skirt, this.debB, this.debF, this.wallB, this.wallF, this.back, this.front, this.ground];
    this.vols = [this.debB, this.debF, this.wallB, this.wallF];
    this.fine = [this.curtain, this.curtainF, this.deck, this.column, this.skirt, this.debB, this.debF, this.wallB, this.wallF];
    this.lists = [[this.Lb, this.ib], [this.Lf, this.ifr], [this.Lg, this.ig]];
    this._b0 = [0, 0]; this._b1 = [0, 0]; this._mo = {}; this._a0 = {}; this._a1 = {}; this._a2 = {}; this._dr = [0, 0, 0]; this._lf = [0, 0, 0, 0];
    this._pts = new Float64Array(12);
  }

  setRecord(T) { this.T = T; }

  /* ---------------------------------------------------------------- the per-frame tables */

  /** The base in art px (ground) at shared ms t. */
  baseArt(t) { return this.baseArtInto(t, [0, 0]); }
  /** baseArt written into `out` (no garbage). */
  baseArtInto(t, out) {
    const g = this.owner.geo; TM.baseInto(this.T, t, g.grid, out);
    out[0] = (out[0] - g.ox) / g.ap; out[1] = (out[1] - g.oy) / g.ap;
    return out;
  }

  /** Core radius at height z (art px) at shared seconds tm (mod hour) for looks L; touch swell. */
  coreR(z, tm, L, Z, touch, rope) {
    const U = this.U, q = Math.min(1, Math.max(0, z / Z));
    // the profile: a thin foot, widening to mid height, then the flare into the wall cloud; the foot swells at touchdowns
    const rTb = L.rMid * 1.25;
    const r = (L.r0 + (L.rMid - L.r0) * Math.pow(Math.min(1, q / 0.5), 1.1) + (rTb - L.rMid) * Math.pow(Math.max(0, (q - 0.5) / 0.5), 1.6)
      + (L.rTop - rTb) * Math.pow(ss(0.72, 1, q), 1.6)) * U + L.foot * U * Math.exp(-z / (11 * U)) * touch;
    const w = TAU * tm;
    const breathe = 1 + 0.16 * Math.sin(z * 0.045 / U - w * 0.5) * Math.sin(Math.PI * q) + 0.09 * Math.sin(z * 0.11 / U + w * 0.7 + 1.0) + 0.06 * Math.sin(z * 0.2 / U - w * 0.9 + 2.0);
    let pinch = 1;
    for ( const [m, off, zz] of PINCH ) {
      const f = fr(tm * m + off), zp = 15 * U + Z * zz * f;
      pinch *= 1 - 0.34 * Math.sin(Math.PI * f) ** 2 * Math.exp(-(((z - zp) / (15 * U)) ** 2));
    }
    return r * breathe * pinch * (1 - 0.62 * rope * ss(0.05, 0.6, q));
  }

  /** Fill the axis table: { cx, cy (ground), sy (screen), rc, z } at K heights. */
  axisAt(now, tm, L, ph, lean) {
    const U = this.U, Z = L.Z * U, lift = this.lift, A = this.axis, g = this.owner.geo;
    const out = this.ax ??= Array.from({ length: K }, () => ({}));
    const rope = ph.rope, snake = L.snake * (1 + 1.6 * rope);
    let prevSy = Infinity;
    for ( let k = 0; k < K; k++ ) {
      const q = k / (K - 1), z = q * Z, lag = 1.6 * Math.pow(q, 1.1);
      const b_ = this.baseArtInto(now - lag * 1000, this._b0), bx = b_[0], by = b_[1];
      const m = TM.motionInto(this.T, now - 600 * lag, g.grid, 0.45, this._mo);
      const ax = Math.max(-60, Math.min(60, m.ax / g.ap)), ay = Math.max(-60, Math.min(60, m.ay / g.ap));
      const env = Math.sin(Math.PI * Math.pow(q, 0.8));
      let sx = 0, sy = 0;
      for ( let i = 0; i < SNAKE.length; i++ ) {
        const [Am, f, n, p] = SNAKE[i];
        sx += Am * U * Math.sin(z * f / U - TAU * n / 10 * tm + p);
        if ( i < 4 ) sy += 0.2 * Am * U * Math.cos(z * f * 1.13 / U - TAU * n / 10 * tm + p * 1.7);
      }
      const w = TAU * tm / 10;
      const stand = U * (5 * Math.sin(TAU * q) * Math.sin(w + 0.7) + 3 * Math.sin(3 * Math.PI * q) * Math.sin(2 * w + 2.1));
      const drift = q * q * U * (9 * Math.sin(w + 1.1) + 5 * Math.sin(2 * w + 0.3) + 2 * Math.sin(4 * w + 2.0));
      const drifty = q * q * U * (4 * Math.sin(w + 2.4) + 2 * Math.sin(3 * w + 0.2));
      const whip = 0.28 * Math.pow(q, 1.5);
      const cx = bx + lean[0] * 12 * U * Math.pow(q, 1.5) + snake * (env * sx + stand) + drift + whip * ax;
      const cy = by + lean[1] * 6 * U * Math.pow(q, 1.5) + 4 * U * q + snake * env * sy + drifty + whip * ay * 0.6;
      let s = cy - lift * z;
      if ( s > prevSy - 0.25 ) s = prevSy - 0.25;
      prevSy = s;
      const rc = this.coreR(z, tm, L, Z, ph.touch, rope);
      const o = out[k]; o.cx = cx; o.cy = cy; o.sy = s; o.rc = rc; o.z = z;
      A[k * 4] = cx; A[k * 4 + 1] = s; A[k * 4 + 2] = rc; A[k * 4 + 3] = z;
    }
    return out;
  }

  /** The axis at height z (interpolated): { cx, cy, rc }. */
  axZ(z, o = {}) {
    const a = this.ax, Z = a[K - 1].z, f = Math.min(K - 1, Math.max(0, z / Z * (K - 1))), i = Math.min(K - 2, Math.floor(f)), u = f - i;
    const A = a[i], B = a[i + 1];
    o.cx = A.cx + (B.cx - A.cx) * u; o.cy = A.cy + (B.cy - A.cy) * u; o.rc = A.rc + (B.rc - A.rc) * u;
    return o;
  }

  /** The lightning envelope now (0..1.2) and its zone angle: hashed strikes, at most one pair every 12 s. */
  flash(tm) {
    let f = 0, zone = 0;
    const j0 = Math.floor(tm / 12);
    for ( let j = j0 - 1; j <= j0; j++ ) {
      const jj = ((j % 300) + 300) % 300;
      if ( hu(jj, 1, this.T.seed) > 0.5 ) continue;
      const t0 = j * 12 + 2 + 7 * hu(jj, 2, this.T.seed);
      for ( const [dt, a] of STRIKE ) {
        const d = tm - (t0 + dt);
        const e = d < 0 ? Math.exp(d / 0.03) : Math.exp(-d / 0.16);
        if ( e > 0.001 ) { f += a * e; zone = hu(jj, 3, this.T.seed) * TAU; }
      }
    }
    return [Math.min(1.2, f), zone];
  }

  /* ---------------------------------------------------------------- a frame */

  frame(now, tm, vr, still, cap) {
    const c0 = performance.now();
    const T = this.T, g = this.owner.geo, U = this.U;
    const ph = TM.phase(T, now, g.grid);
    if ( ph.gone ) { this.hide(); return false; }
    const sCap = cap - 1 + 0.35, s = Math.min(TM.levelS(T, now), sCap), L = TM.looksOf(s);
    const view = this.owner.view ?? { lift: 0.5, squash: 0.8 };
    this.lift = view.lift; this.squash = view.squash;
    const lift = this.lift, sq = this.squash;
    const [bx, by] = this.baseArt(now);
    // the art texture's place: whole art px round the base
    const rx0 = Math.floor(bx - this.W / 2), ry0 = Math.floor(by - this.top);
    this.rect[0] = rx0; this.rect[1] = ry0;
    // off screen (with a margin for the deck): nothing drawn
    const ap = g.ap, x0 = g.ox + rx0 * ap, y0 = g.oy + ry0 * ap, x1 = x0 + this.W * ap, y1 = y0 + this.H * ap;
    const on = x1 > vr.x0 && x0 < vr.x1 && y1 > vr.y0 && y0 < vr.y1;
    if ( !on ) { this.hide(); return true; }
    // the scene wind leans the rope downwind (else a little to the east)
    const sw = sceneWind(), wv = sw ? dirVec(sw.dir) : [1, 0], ws = sw ? 0.6 + 0.8 * sw.str : 0.8;
    const ax = this.axisAt(now, tm, L, ph, [wv[0] * ws, wv[1] * ws * 0.6]);
    const Z = L.Z * U, top = ax[K - 1], bot = ax[0];
    const mo = TM.motionAt(T, now, g.grid);
    const sp = Math.hypot(mo.vx, mo.vy), head = sp > 1e-3 ? Math.atan2(mo.vy, mo.vx) : 0;
    const trx = sp > 1e-3 ? -mo.vx / sp : 0, try_ = sp > 1e-3 ? -mo.vy / sp : 0;
    const throwAng = head + Math.PI / 2;                 // the spin throws material out to the right of travel (screen, y down)
    const touchSwell = 0.7 + 0.7 * this.touchEnv(tm);
    const dust = this.dust(now, bx, by);
    const tmv = still ? 0 : tm;
    for ( const m of this.timed ) {
      const u = m.shader.uniforms; u.uT = tmv; u.uView[0] = lift; u.uView[1] = sq;
    }
    const k = this.window(rx0, ry0, vr);
    // ---- deck: high above the wall cloud, so on screen it lies up-screen of the funnel top (the funnel hangs from its front edge)
    const du = this.deck.shader.uniforms, [fl, zone] = this.flash(tm);
    const Hs = lift * Z * 0.06, shift = 0.85 * L.deckR * U * 0.58, Cx = top.cx + 4 * U, Cy = top.sy - Hs - shift;
    du.uTop[0] = Cx; du.uTop[1] = Cy; du.uTop[2] = L.deckR * U; du.uTop[3] = L.deckD;
    du.uDeck[0] = L.deckDark; du.uDeck[1] = L.feed; du.uDeck[2] = fl * L.flash * ph.cloud; du.uDeck[3] = ph.cloud;
    du.uBase[0] = bx; du.uBase[1] = by; du.uBase[2] = lift * Z; du.uBase[3] = ph.touch;
    du.uCurt[0] = L.curtain * ph.cloud * ph.reach; du.uCurt[1] = L.deckR * 0.5 * U; du.uCurt[2] = lift * Z * 1.15; du.uCurt[3] = head;
    du.uPh[0] = TAU * fr(tm / 30); du.uPh[1] = TAU * fr(tm / 12); du.uPh[2] = zone;
    du.uHole[0] = top.cx; du.uHole[1] = top.sy - Hs; du.uHole[2] = L.wallR * U; du.uHole[3] = ph.cloud;
    // ---- column
    const cu = this.column.shader.uniforms;
    cu.uCol[0] = Z; cu.uCol[1] = Z * (1 - ph.reach); cu.uCol[2] = ph.rope; cu.uCol[3] = L.dust;
    cu.uPh[0] = -TAU * fr(1.1 * tm); cu.uPh[1] = TAU * fr(0.2 * tm); cu.uPh[2] = -TAU * fr(0.7 * tm); cu.uPh[3] = -TAU * fr(0.3 * tm);
    cu.uDust.set(dust);
    // ---- skirt, debris cloud, wall cloud
    for ( const m of [this.skirt] ) {
      const u = m.shader.uniforms;
      u.uBase[0] = bot.cx; u.uBase[1] = bot.cy; u.uBase[2] = ph.touch; u.uBase[3] = L.skirt * U;
      u.uMot[0] = trx; u.uMot[1] = try_; u.uMot[2] = throwAng; u.uMot[3] = touchSwell;
      u.uPh[0] = TAU * fr(-0.6 * tm); u.uPh[3] = -TAU * fr(0.3 * tm);
      u.uDust.set(dust);
    }
    // ---- each full-rect pass only on the rect it can reach (the rest of the art window spends no fragment on it)
    {
      let x0 = Infinity, x1 = -Infinity, rM = 0;
      for ( const o of ax ) { x0 = Math.min(x0, o.cx); x1 = Math.max(x1, o.cx); rM = Math.max(rM, o.rc); }
      const e = rM * 4.2 + 6 * U;                                         // (the lean widens a row by up to 1.56, the sheath 2.45 x)
      this.setLocal(this.column.geometry, x0 - e, top.sy - 4 * U, x1 + e, bot.sy + 4 * U + lift * 3 * U + 4);
      const Rs = L.skirt * U * 1.6 * 1.01 + 8 * U;
      this.setLocal(this.skirt.geometry, bot.cx - Rs, bot.cy - Rs * sq, bot.cx + Rs, bot.cy + Rs * sq);
      const R2 = 2 * L.deckR * U + 4, R2y = R2 * 0.58;
      this.setLocal(this.deck.geometry, Math.min(Cx, top.cx) - R2, Math.min(Cy, top.sy - Hs) - R2y, Math.max(Cx, top.cx) + R2, Math.max(Cy, top.sy - Hs) + R2y);
      const Rc = du.uCurt[1] * 1.26 + 4, Hc = du.uCurt[2] * 1.02 + 4;
      for ( const m of [this.curtain, this.curtainF] ) this.setLocal(m.geometry, bx - Rc, by - Rc * sq - Hc, bx + Rc, by + Rc * sq + 12 * U);
    }
    const cl = ph.cloud;
    // ---- the volumes: the debris cloud round the foot, the wall cloud round the funnel top (each on the sub-rect it can reach)
    const vol = (mB, mF, z0, z1, pres, R, turn) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for ( let k = 0; k <= 6; k++ ) {
        const z = z0 + (z1 - z0) * k / 6, a = this.axZ(Math.min(Math.max(z, 0), Z), this._a0), e = a.rc + R;
        x0 = Math.min(x0, a.cx - e); x1 = Math.max(x1, a.cx + e);
        y0 = Math.min(y0, a.cy - lift * z - e * sq); y1 = Math.max(y1, a.cy - lift * z + e * sq);
      }
      const on = pres > 0.01;
      for ( const m of [mB, mF] ) {
        m.visible = on; if ( !on ) continue;
        const u = m.shader.uniforms;
        u.uVol[0] = z0; u.uVol[1] = z1; u.uVol[2] = pres; u.uVol[3] = R;
        u.uMot[0] = trx; u.uMot[1] = try_; u.uMot[2] = throwAng; u.uMot[3] = 0.85 + 0.3 * (touchSwell - 0.7) / 0.7;
        u.uDust.set(dust); u.uPh[0] = TAU * fr(turn * tm);
        this.setLocal(m.geometry, x0, y0, x1, y1);
      }
    };
    vol(this.debB, this.debF, 0, L.puffH * U * 1.9, Math.sqrt(ph.touch), L.skirt * 0.55 * U, 0.35);
    vol(this.wallB, this.wallF, Z * 0.86, Z * 1.05, ph.cloud * (0.35 + 0.65 * ph.reach) * (1 - 0.6 * ph.rope), L.wallR * 0.85 * U, 0.12);
    for ( const m of this.vols ) if ( m.visible ) this.marchVol(m, k);
    // ---- debris
    this.debris(now, tm, L, ph, { bx, by, Z, sq, lift, trx, try_, throwAng, touchSwell, dust, sCap });
    // ---- ground
    const gu = this.ground.shader.uniforms;
    // the deck's shadow on the ground: under it, pushed down-right by the light from the up-left
    const Zd = Z + shift / lift, gcx = top.cx + 0.16 * Zd, gcy = top.cy + 0.08 * Zd;
    gu.uG[0] = 1 - (1 - L.storm) * 1; gu.uG[1] = L.deckR * U * (0.55 + 0.45 * cl); gu.uG[2] = cl; gu.uG[3] = ph.touch * ph.reach;
    gu.uGc[0] = gcx; gu.uGc[1] = gcy; gu.uGc[2] = SPIN * TAU * fr(tm / 30); gu.uGc[3] = Z;
    const tw = (L.skirt * 0.22 + 4) * U;
    for ( let j = 0; j < 16; j++ ) {
      const b_ = this.baseArtInto(now - j * 400, this._b0);
      const age = j / 15, touch_ = TM.touchAt(T, now - j * 400, g.grid);
      this.track[j * 4] = b_[0]; this.track[j * 4 + 1] = b_[1]; this.track[j * 4 + 2] = age; this.track[j * 4 + 3] = tw * touch_ * ph.p;
    }
    const gr = L.deckR * U * 1.85;
    const gx0 = Math.floor(Math.min(gcx, bx) - gr), gy0 = Math.floor(Math.min(gcy, by) - gr * sq), gx1 = Math.ceil(Math.max(gcx, bx) + gr), gy1 = Math.ceil(Math.max(gcy, by) + gr * sq);
    this.setQuad(this.gGeom, gx0, gy0, gx1, gy1);
    this.setQuad(this.sGeom, this.win[0], this.win[1], this.win[0] + this.winS[0] / k, this.win[1] + this.winS[1] / k);
    // ---- render the art
    this.render();
    this.ground.visible = true; this.marks.visible = this.Lg.n > 0; this.show.visible = true;
    this.groundCells.update(g, vr, [gx0, gy0, gx1, gy1]);
    this.stats.inst = this.Lb.n + this.Lf.n + this.Lg.n; this.stats.cpuMs = performance.now() - c0;
    return true;
  }

  /**
   * The art's WINDOW this frame: the part of the art rect on screen (with a margin) at k texels per art px (about the device px per
   * art px, capped by the texel budget x the guard's q), its origin on whole texels of the art grid (the texels stay put while k
   * does). Sets the art root's transform, the texture's frame (grown in steps when it must), the shaders' texel size. Returns k.
   */
  window(rx0, ry0, vr) {
    const g = this.owner.geo, ap = g.ap, R = canvas.app.renderer;
    const dev = ap * Math.abs(canvas.stage.scale.x) * (R.resolution || 1), Mg = 6;
    const ax0 = Math.max(rx0, (vr.x0 - g.ox) / ap - Mg), ay0 = Math.max(ry0, (vr.y0 - g.oy) / ap - Mg);
    const ax1 = Math.min(rx0 + this.W, (vr.x1 - g.ox) / ap + Mg), ay1 = Math.min(ry0 + this.H, (vr.y1 - g.oy) / ap + Mg);
    const gq = weatherQ(), area = Math.max(1, (ax1 - ax0) * (ay1 - ay0)), bud = (globalThis.CONFIG?.moinenMaps?.tornadoBudget ?? ART_BUDGET) * gq;
    let k = Math.min(dev, Math.sqrt(bud / area), K_MAX, ART_MAX / Math.max(1, ax1 - ax0), ART_MAX / Math.max(1, ay1 - ay0));
    k = Math.max(0.25, Math.floor(k * 16) / 16);
    const wx0 = Math.floor(ax0 * k) / k, wy0 = Math.floor(ay0 * k) / k;
    const pw = Math.max(1, Math.min(ART_MAX, Math.ceil((ax1 - wx0) * k))), ph = Math.max(1, Math.min(ART_MAX, Math.ceil((ay1 - wy0) * k)));
    if ( pw > this.capW || ph > this.capH ) {
      this.capW = Math.min(ART_MAX, Math.max(this.capW, Math.ceil(pw / 256) * 256)); this.capH = Math.min(ART_MAX, Math.max(this.capH, Math.ceil(ph / 256) * 256));
      this.art.resize(this.capW, this.capH, true);
    }
    if ( this.art.frame.width !== pw || this.art.frame.height !== ph ) this.art.resize(pw, ph, false);
    this.artRoot.scale.set(k, k); this.artRoot.position.set((rx0 - wx0) * k, (ry0 - wy0) * k);
    this.win[0] = wx0; this.win[1] = wy0; this.win[2] = k; this.winS[0] = pw; this.winS[1] = ph;
    const px = 1 / k, steps = volSteps(k, gq);
    for ( const m of this.fine ) m.shader.uniforms.uPx = px;
    for ( const m of [this.debB, this.debF, this.wallB, this.wallF] ) m.shader.uniforms.uSteps = steps;
    this.stats.k = k; this.stats.texels = pw * ph; this.stats.steps = steps;
    return k;
  }

  /**
   * The volume's ADAPTIVE-RESOLUTION RAY MARCH: magnified (k > 1.25, a float texture can be drawn), the costly march runs at a third of
   * the art texture's resolution (never coarser than an art px, the old art grid) over the part of its quad in the art window, into its
   * own float texture (coverage, surface height, fade: smooth quantities that interpolate); the volume's pass in the art then only
   * shades - its density, light and wisps evaluated per texel at full resolution, the coverage's edge torn by the wisps there.
   * Otherwise the volume is marched and shaded in one pass.
   */
  marchVol(m, k) {
    const kv = k > 1.25 && this.owner.halfFloat ? Math.max(1, k / 3) : k;
    if ( kv >= k ) { m.shader.program = volProg(2, m.vmode); return; }
    const P = m.geometry.getBuffer("aVertexPosition").data, ox = this.rect[0], oy = this.rect[1];
    const wx1 = this.win[0] + this.winS[0] / k, wy1 = this.win[1] + this.winS[1] / k;
    const ax0 = Math.max(P[0] + ox, this.win[0]), ay0 = Math.max(P[1] + oy, this.win[1]), ax1 = Math.min(P[4] + ox, wx1), ay1 = Math.min(P[5] + oy, wy1);
    if ( ax1 <= ax0 || ay1 <= ay0 ) { m.visible = false; return; }
    const mx0 = Math.floor(ax0 * kv) / kv, my0 = Math.floor(ay0 * kv) / kv;
    const pw = Math.min(ART_MAX, Math.ceil((ax1 - mx0) * kv) + 1), ph = Math.min(ART_MAX, Math.ceil((ay1 - my0) * kv) + 1);
    const M = m.march;
    if ( !M.rt || pw > M.cw || ph > M.ch ) {
      M.cw = Math.min(ART_MAX, Math.max(M.cw, Math.ceil(pw / 128) * 128)); M.ch = Math.min(ART_MAX, Math.max(M.ch, Math.ceil(ph / 128) * 128));
      if ( M.rt ) M.rt.resize(M.cw, M.ch, true);
      else M.rt = PIXI.RenderTexture.create({ width: M.cw, height: M.ch, resolution: 1, type: PIXI.TYPES.HALF_FLOAT, format: PIXI.FORMATS.RGBA,
        scaleMode: PIXI.SCALE_MODES.LINEAR, mipmap: PIXI.MIPMAP_MODES.OFF });
      M.rt.noFrame = false;
    }
    if ( M.rt.frame.width !== pw || M.rt.frame.height !== ph ) M.rt.resize(pw, ph, false);
    M.mesh.scale.set(kv, kv); M.mesh.position.set((ox - mx0) * kv, (oy - my0) * kv);
    const u = m.shader.uniforms;
    u.uMarch = PIXI.Texture.EMPTY;                             // (never the texture being drawn into)
    canvas.app.renderer.render(M.mesh, { renderTexture: M.rt, clear: true });
    u.uMarch = M.rt; u.uMwin[0] = mx0; u.uMwin[1] = my0; u.uMwin[2] = kv; u.uMsize[0] = pw; u.uMsize[1] = ph;
    m.shader.program = volProg(1, m.vmode);
  }

  /** Touchdowns: fast attack, slower release (the foot and the spray pulse with them); whole cycles per hour. */
  touchEnv(tm) {
    let g = 0;
    for ( const [c, a] of TOUCHES ) {
      const d = ((tm - c) % 10 + 10) % 10;
      g += a * (d < 0.35 ? ss(0, 0.35, d) : Math.exp(-(d - 0.35) / 1.1));
    }
    return Math.min(1.2, g);
  }

  /** The dirt colour (the map near the base, mixed toward a dust brown), refreshed twice a second. */
  dust(now, bx, by) {
    if ( this.dustC && Math.abs(now - this.dustT) < 500 ) return this.dustC;
    const m = dirtAt(this.owner.geo, bx, by);
    const want = [0, 1, 2].map((i) => Math.min(1, m[i] * 0.35 + [0.6, 0.5, 0.4][i] * 0.7));
    this.dustC = this.dustC ? this.dustC.map((v, i) => v + (want[i] - v) * 0.25) : want;
    this.dustT = now;
    return this.dustC;
  }

  setQuad(G, x0, y0, x1, y1) {
    const g = this.owner.geo, ap = g.ap;
    const p = G.getBuffer("aVertexPosition"), c = G.getBuffer("aCell");
    const sx0 = g.ox + x0 * ap, sy0 = g.oy + y0 * ap, sx1 = g.ox + x1 * ap, sy1 = g.oy + y1 * ap;
    const P = p.data, C = c.data;
    P[0] = sx0; P[1] = sy0; P[2] = sx1; P[3] = sy0; P[4] = sx1; P[5] = sy1; P[6] = sx0; P[7] = sy1; p.update();
    C[0] = x0; C[1] = y0; C[2] = x1; C[3] = y0; C[4] = x1; C[5] = y1; C[6] = x0; C[7] = y1; c.update();
  }

  /** A quad mesh of the art texture onto the art px rect x0..x1, y0..y1 (absolute; clamped to the texture, whole px). */
  setLocal(G, x0, y0, x1, y1) {
    const W = this.W, H = this.H, ox = this.rect[0], oy = this.rect[1];
    const a = Math.max(0, Math.floor(x0 - ox)), b = Math.max(0, Math.floor(y0 - oy)), c = Math.min(W, Math.ceil(x1 - ox)), d = Math.min(H, Math.ceil(y1 - oy));
    const p = G.getBuffer("aVertexPosition");
    const P = p.data, ok = c > a && d > b;
    P[0] = ok ? a : 0; P[1] = ok ? b : 0; P[2] = ok ? c : 0; P[3] = ok ? b : 0; P[4] = ok ? c : 0; P[5] = ok ? d : 0; P[6] = ok ? a : 0; P[7] = ok ? d : 0; p.update();
  }

  /* ---------------------------------------------------------------- debris (closed-form slots) */

  debris(now, tm, L, ph, o) {
    const T = this.T, g = this.owner.geo, U = this.U, { Z, sq, lift, trx, try_, throwAng, dust, sCap } = o;
    const Lb = this.Lb, Lf = this.Lf, Lg = this.Lg;
    Lb.n = Lf.n = Lg.n = 0;
    const touch = ph.touch, rope = ph.rope;
    const dr = this._dr, dustRamp = (i) => { const k = 0.28 + 0.157 * i; dr[0] = Math.min(1, dust[0] * k); dr[1] = Math.min(1, dust[1] * k); dr[2] = Math.min(1, dust[2] * k); return dr; };
    const hS = (i, q) => hu(i, 1, 980 + q), hW = (i, q) => hu(i, 4, 1010 + q), hC = (k, q) => hu(k, 8, 1062 + q), hI = (k, q) => hu(k, 3, 1202 + q), hF = (k, q) => hu(k, 6, 1702 + q);
    const pushW = (wF, x, y, hx, hy, ang, kind, seed, al, r, g_, b, dis, sx, sy, fresh, extra) => {
      if ( wF < 1 ) Lb.push(x, y, hx, hy, ang, kind, seed, al * (1 - wF), r, g_, b, dis, sx, sy, fresh, extra);
      if ( wF > 0 ) Lf.push(x, y, hx, hy, ang, kind, seed, al * wF, r, g_, b, dis, sx, sy, fresh, extra);
    };
    const A0 = this._a0, A1 = this._a1, A2 = this._a2, B0 = this._b0, B1 = this._b1, LF = this._lf, pts = this._pts;
    const bot = this.ax[0];
    // COUNTS ARE CONTINUOUS (tornado-debris.mjs): ceil(n) slots, the last one at alpha x fract(n), so a level ramp, a touchdown or
    // the guard fades one item in or out instead of popping it at each 0.5; a whole count draws exactly the old items
    // FINE DEBRIS: specks orbiting the funnel, rising from the foot to under the wall cloud (2 px smears along their path)
    const gq = weatherQ(), nS = TD.whole(L.specks * (0.3 + 0.7 * touch) * gq);   // (gq: the frame guard thins the small stuff)
    for ( let i = 0; i < nS; i++ ) {
      const turns = Math.floor(5 + 7 * hS(i, 0)), zf = fr(hS(i, 1) + Math.floor(1 + 2 * hS(i, 2)) * tm / 10);
      const z = 12 * U + Z * 0.78 * Math.pow(zf, 1.2), a = this.axZ(z, A0);
      const r = a.rc * (1 + 0.8 * hS(i, 3)) + 2 * U, w = SPIN * TAU * turns / 10, pa = hS(i, 4) * TAU + w * tm;
      const X = a.cx + Math.cos(pa) * r, Y = a.cy + Math.sin(pa) * r * sq - lift * z;
      const tx = -Math.sin(pa) * r * w / 30, ty = Math.cos(pa) * r * sq * w / 30;
      const Ls = Math.min(5, Math.hypot(tx, ty)), ang = Math.atan2(ty, tx);
      const col = hS(i, 6) > 0.5 ? SPECK_A : SPECK_B;
      const al = ss(0, 0.08, zf) * ss(1, 0.85, zf) * (1 - rope) * TD.share(nS, i);
      (Math.sin(pa) > 0 ? Lf : Lb).push(X, Y, Ls / 2 + 0.5, hS(i, 5) > 0.7 ? 1 : 0.5, ang, 0, i, al, col[0], col[1], col[2], 0);
    }
    // WISPS: torn fragments peeling off the funnel, flung round it (three chords of an arc each)
    // (the first half are dust wisps low round the foot, the rest grey ones up the funnel: the slot on the half's fractional edge is
    // drawn as both, crossfaded, so no wisp switches kind; each slot's alpha x its share of the count)
    const nW = TD.whole(L.wisps * (0.4 + 0.6 * ph.reach) * gq);
    for ( let j = 0; j < 2 * nW; j++ ) {
      const i = j >> 1, dustW = (j & 1) === 0, wD = TD.share(nW / 2, i), wK = TD.share(nW, i) * (dustW ? wD : 1 - wD);
      if ( !(wK > 0) ) continue;
      const zf = fr(hW(i, 0) + Math.floor(1 + 2 * hW(i, 1)) * tm / 10);
      const z = dustW ? (8 + 26 * Math.pow(hW(i, 2), 1.2) * (0.4 + 0.6 * zf)) * U : 30 * U + Z * 0.62 * zf;
      if ( z < Z * (1 - ph.reach) ) continue;
      const turns = dustW ? Math.floor(5 + 4 * hW(i, 3)) : Math.floor(8 + 6 * hW(i, 3));
      const pa0 = hW(i, 4) * TAU + SPIN * TAU * turns / 10 * tm;
      const ln = (dustW ? 0.5 + 0.7 * hW(i, 5) : 0.3 + 0.5 * hW(i, 5)) * Math.sqrt(Math.sin(Math.PI * zf));
      const a = this.axZ(z, A0), R = dustW ? (16 + 26 * Math.pow(hW(i, 6), 0.8)) * U : a.rc * (1.15 + 0.45 * hW(i, 6)) + 2 * U;
      for ( let k = 0; k <= 3; k++ ) {
        const f = k / 3, pa = pa0 - SPIN * ln * f, zk = z - (dustW ? 3 : 9) * U * f, Rk = R * (dustW ? 1 - 0.4 * f : 1 + 0.25 * f), ak = this.axZ(Math.max(0, zk), A1);
        pts[k * 3] = ak.cx + Math.cos(pa) * Rk; pts[k * 3 + 1] = ak.cy + Math.sin(pa) * Rk * sq - lift * zk; pts[k * 3 + 2] = pa;
      }
      for ( let k = 0; k < 3; k++ ) {
        const x0 = pts[k * 3], y0 = pts[k * 3 + 1], pa = pts[k * 3 + 2], x1 = pts[k * 3 + 3], y1 = pts[k * 3 + 4], front = Math.sin(pa) > 0;
        const lit = -Math.cos(pa) > 0.3 ? 1 : 0;
        const tone = front ? 4 + lit - (k > 1 ? 1 : 0) - (dustW ? 1 : 0) : 1 + lit;
        const c = dustW ? dustRamp(tone) : GREYS[Math.max(0, Math.min(6, tone))];
        const L2 = Math.hypot(x1 - x0, y1 - y0) / 2;
        (front ? Lf : Lb).push((x0 + x1) / 2, (y0 + y1) / 2, L2 + 0.5, hW(i, 8) > 0.6 && k < 2 ? 1 : 0.5, Math.atan2(y1 - y0, x1 - x0), 0, i * 4 + k, (1 - k * 0.22) * (1 - rope) * wK, c[0], c[1], c[2], 0);
      }
    }
    if ( touch > 0.01 ) {
      // SPRAYED CLUMPS: dust thrown out of the foot on spirals, dissolving as they go
      const nC = TD.whole(L.clumps * touch * gq);
      for ( let i = 0; i < nC; i++ ) {
        const kc = 1080 + Math.floor(hu(i, 1, 1060) * 1080), life = 3600 / kc;
        const u = (tm + hu(i, 2, 1061) * life) / life, cyc = Math.floor(u) % kc, sF = u - Math.floor(u);
        if ( sF > 0.9 ) continue;
        const kk = i * 13 + cyc;
        const rho = 20 * U + (40 + 50 * hC(kk, 0)) * U * Math.pow(sF, 0.6) * (0.7 + 0.5 * o.touchSwell) * L.skirt / 52;
        const pa = hC(kk, 1) * TAU + SPIN * (2.4 * Math.pow(sF, 0.7) + TAU * 0.3 * tm);
        const z = (4 + 30 * hC(kk, 2)) * U * Math.sin(Math.PI * Math.min(sF * 1.2, 1)) + 3 * U;
        const rr = (1.2 + 2.6 * hC(kk, 3)) * U * (1 - 0.6 * sF) * ss(0, 0.12, sF);
        const X = bot.cx + Math.cos(pa) * rho, Y = bot.cy + Math.sin(pa) * rho * sq - lift * z;
        const c = dustRamp(3 + (hC(kk, 4) > 0.6 ? 1 : 0));
        (Math.sin(pa) > 0 ? Lf : Lb).push(X, Y, rr, rr, 0, 3, i * 13 + cyc, TD.share(nC, i), c[0], c[1], c[2], sF / 0.9);
      }
      // INFLOW: dust and leaf streaks dragged over the ground toward the foot on tightening spirals (on the ground: the stage)
      const nI = TD.whole(L.inflow * touch * gq);
      for ( let i = 0; i < nI; i++ ) {
        const kc = 1440 + Math.floor(hu(i, 1, 1200) * 1080), life = 3600 / kc;
        const u = (tm + hu(i, 2, 1201) * life) / life, cyc = Math.floor(u) % kc, sF = u - Math.floor(u);
        const kk = i * 31 + cyc;
        if ( hI(kk, 3) < 0.12 ) continue;
        const h0 = hI(kk, 0), h1 = hI(kk, 1);
        let s_ = sF, r = 20 * U + (55 + 85 * h0) * U * L.skirt / 52 * Math.pow(1 - s_, 1.3), a = h1 * TAU + SPIN * (2.4 * Math.pow(s_, 1.6) + TAU * 0.1 * tm);
        const x1 = bot.cx + Math.cos(a) * r, y1 = bot.cy + Math.sin(a) * r * sq;
        s_ = Math.max(sF - (0.05 + 0.10 * sF) * ss(0, 0.25, sF), 0);
        r = 20 * U + (55 + 85 * h0) * U * L.skirt / 52 * Math.pow(1 - s_, 1.3); a = h1 * TAU + SPIN * (2.4 * Math.pow(s_, 1.6) + TAU * 0.1 * tm);
        const x0 = bot.cx + Math.cos(a) * r, y0 = bot.cy + Math.sin(a) * r * sq;
        const L2 = Math.hypot(x1 - x0, y1 - y0) / 2;
        const leaf = hI(kk, 2) > 0.8, c = leaf ? LEAF : dustRamp(5);
        Lg.push((x0 + x1) / 2, (y0 + y1) / 2, L2 + 0.5, 0.5, Math.atan2(y1 - y0, x1 - x0), 10, i, 0.85 * ss(0, 0.12, sF) * ss(1, 0.85, sF) * TD.share(nI, i), c[0], c[1], c[2], 0);
      }
    }
    // MAP FRAGMENTS (and planks): torn out of the map near the base, spiralled up round the vortex, flung out on arcs, land, dissolve.
    // A slot's life is decided ONCE, from the level and the touch at its BIRTH (t0), and kept for that life (this.frags: so a level
    // change, even one interrupting a ramp, never turns a fragment in flight into a plank, resizes it or removes it): its kind
    // (fragment / plank / none; a fractional count's last slot by its own hash: no half-transparent pieces of the map), big or not
    // (the big share ramps smoothly with the birth level), its size and where it was torn out. While the level has been still for a
    // whole life every slot was born at today's level: only today's slots are visited, else every slot a level can use.
    const life = 3600 / 450, settled = now - T.lvT >= TM.LEVEL_MS + life * 1000 + 50;
    const nFP = settled ? TD.whole(L.frags) + TD.whole(L.planks) : TD.FRAG_SLOTS;
    for ( let i = 0; i < nFP; i++ ) {
      const kc = 450;
      const u = (tm + hu(i, 2, 1701) * life) / life, cyc = Math.floor(u) % kc, tau = (u - Math.floor(u)) * life;
      const kk = i * 23 + cyc;
      const t0 = now - tau * 1000;
      const M = this.frags[i] ??= { cyc: -1, t0: NaN, kind: 0, big: false, fragSz: 0, skirt: 0 };
      if ( M.cyc !== cyc || !(Math.abs(M.t0 - t0) < 100) ) {
        const sB = Math.min(TM.levelS(T, t0), sCap), tB = TM.touchAt(T, t0, g.grid);
        M.cyc = cyc; M.t0 = t0;
        // (only torn out while it is on the ground)
        M.kind = tB < 0.5 || hF(kk, 11) > 0.3 + 0.7 * tB ? TD.NONE : TD.fragKind(sB, i, hF(kk, 17));
        M.big = M.kind === TD.FRAG && hF(kk, 12) < TD.BIG * TD.bigShare(sB);
        M.fragSz = TM.lv(TM.TABLE.fragSz, sB); M.skirt = TM.lv(TM.TABLE.skirt, sB);
      }
      if ( M.kind === TD.NONE ) continue;
      const plank = M.kind === TD.PLANK;
      const b0 = this.baseArtInto(t0, B0), b0x = b0[0], b0y = b0[1];
      const rs = (6 + 30 * hF(kk, 0)) * U * M.skirt / 52, as = hF(kk, 1) * TAU;
      const sx = Math.floor(b0x + Math.cos(as) * rs), sy = Math.floor(b0y + Math.sin(as) * rs * sq);
      // sizes vary a lot: mostly small chunks, some slabs, a few big pieces of the map (heavier: they rise less and fly shorter)
      const big = M.big, heavy = big ? 0.5 : 1;
      const size = plank ? 0 : M.fragSz * U * (0.5 + 1.1 * Math.pow(hF(kk, 2), 1.6)) * (big ? 1.8 : 1), rr = size / 2;
      const tl = 0.7 + 0.8 * hF(kk, 3), zr = (30 + 70 * Math.pow(hF(kk, 4), 1.3)) * U * heavy, om = (1.3 + 0.6 * hF(kk, 5)) * TAU;
      const lift_ = (tt) => {
        const e = ss(0, 1, tt / tl), z = zr * Math.pow(e, 1.4);
        const b2 = this.baseArtInto(t0 + tt * 1000, B1), bx2 = b2[0], by2 = b2[1], a = this.axZ(Math.min(z, Z), A1);
        const ox = a.cx - bot.cx, oy = a.cy - bot.cy;
        const r2 = (1 - e) * rs + e * (a.rc * 1.25 + 4 * U), pa = as + SPIN * om * tt * e;
        const gx = (1 - e) * (bx2 + Math.cos(as) * rs) + e * (bx2 + ox + Math.cos(pa) * r2);
        const gy = (1 - e) * (by2 + Math.sin(as) * rs * sq) + e * (by2 + oy + Math.sin(pa) * r2 * sq);
        LF[0] = gx; LF[1] = gy; LF[2] = z; LF[3] = pa;
      };
      let gx, gy, z, front, landed = false, dis = 0, tland = 0;
      // in front of the funnel when it is down-map of the axis at its height (it crosses at the funnel's sides: no pop through it)
      if ( tau < tl ) { lift_(tau); gx = LF[0]; gy = LF[1]; z = LF[2]; }
      else {
        // flung out on a widening spiral: the velocity keeps turning with the vortex while the drag slows it (closed form of
        // dv/dt = (-k + i W) v on the ground plane, squash undone)
        lift_(tl); const gx1 = LF[0], gy1 = LF[1], z1 = LF[2];
        lift_(tl - 0.04); const gx0 = LF[0], gy0 = LF[1];
        let vx = (gx1 - gx0) / 0.04, vy = (gy1 - gy0) / 0.04 / sq;
        const spd = Math.hypot(vx, vy) + 1e-6, vmax = (95 + 60 * hF(kk, 8)) * U * (big ? 0.6 : 1);
        vx = vx / spd * Math.min(spd, vmax); vy = vy / spd * Math.min(spd, vmax);
        const vz = (12 + 28 * hF(kk, 9)) * U * heavy, gg = 110 * U, tf = tau - tl;
        tland = (vz + Math.sqrt(vz * vz + 2 * gg * z1)) / gg;
        const tt = Math.min(tf, tland), kd = 0.8, Om = SPIN * (1.0 + 0.8 * hF(kk, 13));
        const e_ = Math.exp(-kd * tt), ar = e_ * Math.cos(Om * tt) - 1, ai = e_ * Math.sin(Om * tt), den = kd * kd + Om * Om;
        const qr = (-ar * kd + ai * Om) / den, qi = (-ai * kd - ar * Om) / den;
        gx = gx1 + vx * qr - vy * qi; gy = gy1 + (vx * qi + vy * qr) * sq; z = Math.max(z1 + vz * tt - 0.5 * gg * tt * tt, 0);
        landed = tf >= tland;
        if ( landed ) { const rest = tf - tland, lie = 0.8 + 1.6 * hF(kk, 10); if ( rest > lie + 0.8 ) continue; dis = ss(lie, lie + 0.8, rest); }
      }
      const spin = (2 + 5 * hF(kk, 6)) * (hF(kk, 7) > 0.5 ? 1 : -1) * (big ? 0.5 : 1);
      // TUMBLING: it flips about its own axis while it flies (fc = cos of the flip: the face foreshortens, the underside shows), and
      // settles flat when it lands (face up, or upside down for some)
      const flipW = (4 + 9 * hF(kk, 14)) * (hF(kk, 15) > 0.5 ? 1 : -1) * (big ? 0.45 : 1), air = Math.max(0, tau - 0.15);
      const tAir = landed ? tl + tland : tau;
      let phi = flipW * Math.max(0, tAir - 0.15) * ss(0, 0.5, tAir);
      if ( landed ) { const up = Math.cos(phi) >= -0.3 ? 0 : Math.PI, k_ = ss(0, 0.18, tau - tAir); phi = phi + (Math.round((phi - up) / TAU) * TAU + up - phi) * k_; }
      const fc = Math.cos(phi), light = 0.5 + 0.5 * Math.cos(phi - 0.7);
      const ang = spin * (landed ? tAir : tau) * 0.6 + hF(kk, 16) * TAU;
      // depth: in front of the funnel when down-map of the axis at its height; it crosses at the funnel's sides, faded across a few px
      // (drawn in both lists there) so it slides out from behind the dust instead of popping over it
      const wF = ss(-3 * U, 3 * U, gy - this.axZ(Math.min(z, Z), A2).cy);
      const X = gx, Y = gy - lift * z;
      const al = 1 - rope * 0.7;
      if ( plank ) {
        const w = (5 + 4 * hF(kk, 2)) * U / 2, c = hF(kk, 3) > 0.5 ? PL_A : PL_B;
        pushW(wF, X, Y, w, Math.max(0.5, 0.75 * U * Math.abs(fc) + 0.4), ang, 2, i * 23 + cyc, al * (1 - dis), c[0], c[1], c[2], 0, 0, 0, 1, light);
      } else {
        const sd = (i * 131 + cyc * 7 + 3) % 99991, thick = Math.max(1, Math.round(rr * 0.3));
        pushW(wF, X, Y, rr * 1.75 + thick, rr * 1.75 + thick, ang, 1, sd, al, fc, light, thick, dis, sx, sy, 1, rr);
        // the scar where it was torn out (on the ground: torn earth, fading over 6 s)
        if ( tau < 6 ) Lg.push(sx, sy, rr * 1.75, rr * 1.75, 0, 12, sd, ss(0, 0.25, tau), 1, 0, 0, ss(3, 6, tau), sx, sy, 0, rr);
      }
      // its shadow on the ground (how far below it shows the height)
      if ( !landed && z > 0.5 ) {
        const r = Math.max(1.5, plank ? 3 * U : 0.56 * rr * 1.6) * (1 - 0.3 * Math.min(z / (150 * U), 1));
        Lg.push(gx, gy, r, r * 0.6, 0, 11, i, al, 0, 0, 0, 0);
      }
    }
    for ( const [I, G] of this.lists ) { G.buf.data.set(I.d.subarray(0, I.n * STRIDE)); G.buf.update(); G.g.instanceCount = I.n; }
  }

  /** The art texture: far curtain, skirt, back debris, the volumes behind, column, the volumes in front, front debris, near curtain, deck. */
  render() {
    this.back.visible = this.Lb.n > 0; this.front.visible = this.Lf.n > 0;
    canvas.app.renderer.render(this.artRoot, { renderTexture: this.art, clear: true });
  }

  hide() { this.ground.visible = false; this.marks.visible = false; this.show.visible = false; }

  destroy() {
    for ( const m of this.vols ) { m.march.mesh.destroy(); m.march.rt?.destroy(true); }
    this.groundCells.destroy();
    this.artRoot.removeChildren(); this.artRoot.destroy();
    for ( const m of [this.ground, this.marks, this.show] ) { m.parent?.removeChild(m); }
    for ( const m of [this.curtain, this.curtainF, this.deck, this.column, this.skirt, this.debB, this.debF, this.wallB, this.wallF, this.back, this.front, this.marks, this.ground, this.show] ) { m.geometry?.destroy(); m.destroy(); }
    this.art.destroy(true);
  }
}

/** All tornadoes of the scene: one ticker listener, one view per tornado. */
export class TornadoDisplay {
  constructor() {
    this.views = new Map();
    this.geo = null; this.view = null; this.cap = 3;
    const gl = canvas.app.renderer.gl;
    this.halfFloat = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
    this._tick = () => this.tick();
    canvas.app.ticker.add(this._tick);
    this.stats = { tornadoes: 0, drawn: 0, cpuMs: 0, inst: 0 };
  }

  /** Show these tornadoes (cleaned records) on art grid `geo`, view angle `view`, the client's level cap. */
  sync(list, geo, { view, cap = 3, still = false } = {}) {
    const geoChanged = JSON.stringify(geo) !== JSON.stringify(this.geo);
    this.geo = geo; this.view = view; this.cap = cap; this.still = still;
    const want = new Map(list.map((t) => [t.id, t]));
    for ( const [id, v] of this.views ) if ( !want.has(id) || geoChanged || want.get(id).size !== v.T.size ) { v.destroy(); this.views.delete(id); }
    for ( const [id, T] of want ) { const v = this.views.get(id); if ( v ) v.setRecord(T); else this.views.set(id, new TornadoView(T, this)); }
    this.tick();
  }

  viewRect() {
    const v = canvas.app.renderer.screen, st = canvas.stage, p = this._p ??= new PIXI.Point(), o = this._v ??= { x0: 0, y0: 0, x1: 0, y1: 0 };
    p.set(0, 0); st.toLocal(p, undefined, p); o.x0 = p.x; o.y0 = p.y;
    p.set(v.width, v.height); st.toLocal(p, undefined, p); o.x1 = p.x; o.y1 = p.y;
    return o;
  }

  tick() {
    if ( !canvas.stage || !this.geo ) return;
    const t0 = performance.now(), now = this.now?.() ?? Date.now(), tm = (now / 1000) % 3600, vr = this.viewRect();
    let drawn = 0, inst = 0, gone = 0;
    for ( const v of this.views.values() ) {
      const alive = v.frame(now, tm, vr, this.still, this.cap);
      if ( !alive ) gone++;
      if ( v.show.visible ) { drawn++; inst += v.stats.inst; }
    }
    this.stats.tornadoes = this.views.size; this.stats.drawn = drawn; this.stats.inst = inst;
    this.stats.cpuMs = performance.now() - t0;
    if ( gone && gone === this.views.size ) this.onEmpty?.();
  }

  destroy() {
    canvas.app?.ticker?.remove(this._tick);
    for ( const v of this.views.values() ) v.destroy();
    this.views.clear();
  }
}
