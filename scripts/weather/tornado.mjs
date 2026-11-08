import * as TM from "./tornado-model.mjs";
import { QUAD_VERT, DECK_FRAG, WALL_FRAG, COLUMN_FRAG, FOOT_FRAG, PUFF_VERT, PUFF_FRAG, PART_VERT, PART_FRAG, GROUND_VERT, GROUND_FRAG, SHOW_FRAG } from "./tornado-glsl.mjs";
import { blendMode } from "./display.mjs";
import { hu, sceneWind, dirVec } from "../wind.mjs";
import { mapPixels } from "../destruction/source.mjs";

/**
 * Shows the scene's TORNADOES (research 3.2; the look in tornado-glsl.mjs, the pure model in tornado-model.mjs).
 *
 * Per tornado, every display frame:
 *   CPU  the AXIS TABLE (40 heights: where the rope is and how thick, from the base's lagged path, layered travelling waves, the lean
 *        from the path's acceleration, breathing and travelling pinches), the puffs of the wall cloud and the debris cloud, and the
 *        debris (specks, map fragments, planks, clumps, wisps, inflow streaks, chunk shadows, scars): closed-form slots of the shared
 *        clock (each a pure function of its slot, cycle and the stored path), a few hundred instances, no state.
 *   GPU  the puffs into a small density field (ADD, metaballs), then the art texture back to front (deck, skirt, back debris, column, debris
 *        cloud, front debris, wall cloud), then two stage meshes and one quad: the ground (under tokens), the marks on the ground
 *        (under tokens), the art (above tokens).
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

let progs = {};
const prog = (k, v, f) => progs[k] ??= PIXI.Program.from(v, f, `moinen-maps-tornado-${k}`);

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
    const side = Math.ceil((L3.deckR * 1.55 + 60) * U);
    this.W = Math.min(2048, 2 * side);
    this.top = Math.ceil(lift * L3.Z * U + L3.deckR * 0.66 * 1.55 * U + 50 * U);
    this.bot = Math.ceil(L3.skirt * 0.8 * 1.7 * U + 30 * U);
    this.H = Math.min(2048, this.top + this.bot);
    const W = this.W, H = this.H;
    const half = owner.halfFloat;
    this.hf = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST, format: PIXI.FORMATS.RGBA, type: half ? PIXI.TYPES.HALF_FLOAT : PIXI.TYPES.UNSIGNED_BYTE });
    this.hf.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    this.art = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST });
    this.art.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    this.rect = new Float32Array([0, 0, W, H]);
    const sd = T.seed % 9973;
    const common = { uT: 0, uU: U, uView: new Float32Array([0.5, 0.8]), uRect: this.rect, uSd: sd, translationMatrix: new PIXI.Matrix().toArray(true) };
    const quad = (frag, key, extra) => {
      const m = new PIXI.Mesh(quadGeom(0, 0, W, H), new PIXI.Shader(prog(key, QUAD_VERT, frag), { ...common, ...extra }));
      m.state.blendMode = PIXI.BLEND_MODES.NORMAL; m.state.depthTest = false; m.state.culling = false;
      return m;
    };
    this.axis = new Float32Array(K * 4);
    const deckU = { uTop: new Float32Array(4), uDeck: new Float32Array(4), uBase: new Float32Array(4), uCurt: new Float32Array(4), uPh: new Float32Array(4), uHole: new Float32Array(4) };
    this.curtain = quad(DECK_FRAG, "deck", { uMode: 0, ...deckU });
    this.deck = quad(DECK_FRAG, "deck", { uMode: 1, ...deckU });
    this.wallC = quad(WALL_FRAG, "wall", { uWall: new Float32Array(4), uWall2: new Float32Array(4), uPh: new Float32Array(4) });
    this.column = quad(COLUMN_FRAG, "column", { uAxis: this.axis, uCol: new Float32Array(4), uPh: new Float32Array(4), uDust: new Float32Array(3) });
    const footU = () => ({ uHF: this.hf, uBase: new Float32Array(4), uMot: new Float32Array(4), uPh: new Float32Array(4), uDust: new Float32Array(3), uWall: new Float32Array(4) });
    this.skirt = quad(FOOT_FRAG, "foot", { uMode: 0, ...footU() });
    this.foot = quad(FOOT_FRAG, "foot", { uMode: 1, ...footU() });
    // the puffs (a metaball density field, ADD)
    const pg = new PIXI.Geometry();
    this.puffBuf = new PIXI.Buffer(new Float32Array(256 * 8), false, false);
    pg.addAttribute("aVertexPosition", [0, 0, W, 0, W, H, 0, H], 2).addAttribute("aCorner", [0, 0, 1, 0, 1, 1, 0, 1], 2).addIndex([0, 1, 2, 0, 2, 3]);
    pg.addAttribute("aA", this.puffBuf, 4, false, PIXI.TYPES.FLOAT, 32, 0, true).addAttribute("aB", this.puffBuf, 4, false, PIXI.TYPES.FLOAT, 32, 16, true);
    pg.instanced = true; pg.instanceCount = 0;
    this.puffs = new PIXI.Mesh(pg, new PIXI.Shader(prog("puff", PUFF_VERT, PUFF_FRAG), { ...common, uRough: new Float32Array(4) }));
    this.puffs.state.blendMode = PIXI.BLEND_MODES.ADD; this.puffs.state.depthTest = false; this.puffs.state.culling = false;
    this.puffData = new Float32Array(256 * 8);
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
    this.show = new PIXI.Mesh(this.sGeom, new PIXI.Shader(prog("show", GROUND_VERT, SHOW_FRAG), { uArt: this.art, uRect: this.rect, uAlpha: 1, translationMatrix: new PIXI.Matrix().toArray(true) }));
    const bm = blendMode();
    for ( const [m, layer] of [[this.ground, 252], [this.marks, 252.5], [this.show, 993]] ) {
      m.eventMode = "none"; m.state.blendMode = bm; m.state.depthTest = false; m.state.culling = false;
      Object.assign(m, { elevation: 0, sortLayer: layer, sort: 0, _lastSortedIndex: 0 });
      m.visible = false;
      canvas.primary.addChild(m);
    }
    this.frags = new Map();
    this.stats = { inst: 0, puffs: 0, cpuMs: 0 };
  }

  setRecord(T) { this.T = T; }

  /* ---------------------------------------------------------------- the per-frame tables */

  /** The base in art px (ground) at shared ms t. */
  baseArt(t) { const g = this.owner.geo, [x, y] = TM.baseAt(this.T, t, g.grid); return [(x - g.ox) / g.ap, (y - g.oy) / g.ap]; }

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
    for ( const [m, off, zz] of [[0.2, 0.1, 0.8], [0.3, 0.55, 0.65]] ) {
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
      const [bx, by] = this.baseArt(now - lag * 1000);
      const m = TM.motionAt(this.T, now - 600 * lag, g.grid, 0.45);
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
  axZ(z) {
    const a = this.ax, Z = a[K - 1].z, f = Math.min(K - 1, Math.max(0, z / Z * (K - 1))), i = Math.min(K - 2, Math.floor(f)), u = f - i;
    const A = a[i], B = a[i + 1];
    return { cx: A.cx + (B.cx - A.cx) * u, cy: A.cy + (B.cy - A.cy) * u, rc: A.rc + (B.rc - A.rc) * u };
  }

  /** The lightning envelope now (0..1.2) and its zone angle: hashed strikes, at most one pair every 12 s. */
  flash(tm) {
    let f = 0, zone = 0;
    const j0 = Math.floor(tm / 12);
    for ( let j = j0 - 1; j <= j0; j++ ) {
      const jj = ((j % 300) + 300) % 300;
      if ( hu(jj, 1, this.T.seed) > 0.5 ) continue;
      const t0 = j * 12 + 2 + 7 * hu(jj, 2, this.T.seed);
      for ( const [dt, a] of [[0, 1], [0.22, 0.7]] ) {
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
    const s = Math.min(TM.levelS(T, now), cap - 1 + 0.35), L = TM.looks(s);
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
    for ( const m of [this.curtain, this.deck, this.wallC, this.column, this.skirt, this.foot, this.puffs, this.back, this.front, this.ground] ) {
      const u = m.shader.uniforms; u.uT = tmv; u.uView[0] = lift; u.uView[1] = sq;
    }
    // ---- deck: high above the wall cloud, so on screen it lies up-screen of the funnel top (the funnel hangs from its front edge)
    const du = this.deck.shader.uniforms, [fl, zone] = this.flash(tm);
    const Hs = lift * Z * 0.06, shift = 0.62 * L.deckR * U * 0.58, Cx = top.cx + 4 * U, Cy = top.sy - Hs - shift;
    du.uTop[0] = Cx; du.uTop[1] = Cy; du.uTop[2] = L.deckR * U; du.uTop[3] = L.deckD;
    du.uDeck[0] = L.deckDark; du.uDeck[1] = L.feed; du.uDeck[2] = fl * L.flash * ph.cloud; du.uDeck[3] = ph.cloud;
    du.uBase[0] = bx; du.uBase[1] = by; du.uBase[2] = lift * Z; du.uBase[3] = ph.touch;
    du.uCurt[0] = L.curtain * ph.cloud * ph.reach; du.uCurt[1] = L.deckR * 0.5 * U; du.uCurt[2] = lift * Z * 1.15; du.uCurt[3] = head;
    du.uPh[0] = TAU * fr(tm / 30); du.uPh[1] = TAU * fr(tm / 12); du.uPh[2] = zone;
    du.uHole[0] = top.cx; du.uHole[1] = top.sy - Hs; du.uHole[2] = L.wallR * U; du.uHole[3] = ph.cloud;
    const wu = this.wallC.shader.uniforms;
    wu.uWall[0] = top.cx; wu.uWall[1] = top.sy; wu.uWall[2] = L.wallR * U; wu.uWall[3] = ph.cloud;
    wu.uWall2[0] = Hs; wu.uWall2[1] = top.rc;
    wu.uPh[0] = -TAU * fr(0.5 * tm);
    // ---- column
    const cu = this.column.shader.uniforms;
    cu.uCol[0] = Z; cu.uCol[1] = Z * (1 - ph.reach); cu.uCol[2] = ph.rope; cu.uCol[3] = L.dust;
    cu.uPh[0] = -TAU * fr(1.1 * tm); cu.uPh[1] = TAU * fr(0.2 * tm); cu.uPh[2] = -TAU * fr(0.7 * tm); cu.uPh[3] = -TAU * fr(0.3 * tm);
    cu.uDust.set(dust);
    // ---- skirt, debris cloud, wall cloud
    for ( const m of [this.skirt, this.foot] ) {
      const u = m.shader.uniforms;
      u.uBase[0] = bot.cx; u.uBase[1] = bot.cy; u.uBase[2] = ph.touch; u.uBase[3] = L.skirt * U;
      u.uMot[0] = trx; u.uMot[1] = try_; u.uMot[2] = throwAng; u.uMot[3] = touchSwell;
      u.uPh[0] = TAU * fr(-0.6 * tm); u.uPh[3] = -TAU * fr(0.3 * tm);
      u.uDust.set(dust);
    }
    // ---- puffs: the wall cloud's lumps (R) and the debris cloud (G)
    let np = 0;
    const P = this.puffData;
    const puff = (x, y, r, sqz, h0, hg, ch, sd) => {
      if ( np >= 256 || !(r > 0.5) ) return;
      const o = np++ * 8; P[o] = x; P[o + 1] = y; P[o + 2] = r; P[o + 3] = sqz; P[o + 4] = h0; P[o + 5] = hg; P[o + 6] = ch; P[o + 7] = sd;
    };
    const cl = ph.cloud;
    if ( ph.touch > 0.01 ) {
      // the debris cloud: billows born round the foot, thrown out on spirals (lopsided toward the throw side, trailing), rising and
      // growing, gone by shrinking; and a few that always hug the foot
      const n = Math.round(L.puffs), R0 = L.puffR * U, Hh = L.puffH * U;
      for ( let i = 0; i < n; i++ ) {
        const kc = 1500 + Math.floor(hu(i, 1, 1501) * 1500), life = 3600 / kc;
        const u = (tm + hu(i, 2, 1502) * life) / life, cyc = Math.floor(u) % kc, f = u - Math.floor(u);
        const h = (q) => hu(i * 31 + cyc, 7, 1503 + q);
        const a0 = throwAng + (h(0) - 0.5) * TAU * 0.9 + (h(5) < 0.3 ? Math.PI : 0);
        const ang = a0 + SPIN * (2.2 + 2 * h(1)) * f * life;
        const rho = bot.rc * 0.9 + (4 + 24 * h(2)) * U * L.skirt / 52 * Math.pow(f, 0.6) * touchSwell;
        const z = Hh * (0.1 + 0.9 * h(3)) * Math.pow(Math.sin(Math.PI * Math.min(1.15 * f, 1)), 0.7);
        const r = R0 * (0.55 + 0.9 * h(4)) * ss(0, 0.22, f) * (1 - ss(0.68, 1, f)) * (0.7 + 0.6 * f) * Math.sqrt(ph.touch);
        const a = this.axZ(Math.min(z * 0.5, Z));
        const cx = a.cx + trx * (3 + 0.25 * z / U) * U, cy = a.cy + try_ * (2 + 0.15 * z / U) * U;
        puff(cx + Math.cos(ang) * rho, cy + Math.sin(ang) * rho * sq - lift * z, r, 0.72, z, r * 0.8, 1, i);
      }
      for ( let i = 0; i < 14; i++ ) {
        const h = (q) => hu(i, 3, 1530 + q);
        const z = Hh * 0.55 * h(0), a = this.axZ(z);
        const ang = h(1) * TAU + SPIN * TAU * (0.6 + 0.4 * h(2)) * tm;
        const rho = a.rc * (0.5 + 0.7 * h(3));
        const r = R0 * (0.9 + 0.6 * h(4)) * (1 + 0.15 * Math.sin(TAU * (0.5 * tm + h(2)))) * Math.sqrt(ph.touch) * touchSwell;
        puff(a.cx + trx * 4 * U + Math.cos(ang) * rho, a.cy + try_ * 3 * U + Math.sin(ang) * rho * sq - lift * z, r, 0.85, z, r * 0.8, 1, 200 + i);
      }
    }
    this.puffBuf.update(P);
    this.puffs.geometry.instanceCount = np;
    const ru = this.puffs.shader.uniforms.uRough;
    ru[0] = Cx; ru[1] = Cy; ru[2] = -TAU * fr(0.2 * tm); ru[3] = 1;
    // ---- debris
    this.debris(now, tm, L, ph, { bx, by, Z, sq, lift, trx, try_, throwAng, touchSwell, dust });
    // ---- ground
    const gu = this.ground.shader.uniforms;
    // the deck's shadow on the ground: under it, pushed down-right by the light from the up-left
    const Zd = Z + shift / lift, gcx = top.cx + 0.16 * Zd, gcy = top.cy + 0.08 * Zd;
    gu.uG[0] = 1 - (1 - L.storm) * 1; gu.uG[1] = L.deckR * U * (0.55 + 0.45 * cl); gu.uG[2] = cl; gu.uG[3] = ph.touch * ph.reach;
    gu.uGc[0] = gcx; gu.uGc[1] = gcy; gu.uGc[2] = SPIN * TAU * fr(tm / 30); gu.uGc[3] = Z;
    const tw = (L.skirt * 0.22 + 4) * U;
    for ( let j = 0; j < 16; j++ ) {
      const [tx, ty] = this.baseArt(now - j * 400);
      const age = j / 15, tph = TM.phase(T, now - j * 400, g.grid);
      this.track[j * 4] = tx; this.track[j * 4 + 1] = ty; this.track[j * 4 + 2] = age; this.track[j * 4 + 3] = tw * tph.touch * ph.p;
    }
    const gr = L.deckR * U * 1.85;
    const gx0 = Math.floor(Math.min(gcx, bx) - gr), gy0 = Math.floor(Math.min(gcy, by) - gr * sq), gx1 = Math.ceil(Math.max(gcx, bx) + gr), gy1 = Math.ceil(Math.max(gcy, by) + gr * sq);
    this.setQuad(this.gGeom, gx0, gy0, gx1, gy1);
    this.setQuad(this.sGeom, rx0, ry0, rx0 + this.W, ry0 + this.H);
    // ---- render the art
    this.render();
    this.ground.visible = true; this.marks.visible = this.Lg.n > 0; this.show.visible = true;
    this.stats.puffs = np; this.stats.inst = this.Lb.n + this.Lf.n + this.Lg.n; this.stats.cpuMs = performance.now() - c0;
    return true;
  }

  /** Touchdowns: fast attack, slower release (the foot and the spray pulse with them); whole cycles per hour. */
  touchEnv(tm) {
    let g = 0;
    for ( const [c, a] of [[1.6, 1.0], [4.3, 0.6], [6.9, 0.85], [8.8, 0.45]] ) {
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
    p.data.set([sx0, sy0, sx1, sy0, sx1, sy1, sx0, sy1]); p.update();
    c.data.set([x0, y0, x1, y0, x1, y1, x0, y1]); c.update();
  }

  /* ---------------------------------------------------------------- debris (closed-form slots) */

  debris(now, tm, L, ph, o) {
    const T = this.T, g = this.owner.geo, U = this.U, { Z, sq, lift, trx, try_, throwAng, dust } = o;
    const Lb = this.Lb, Lf = this.Lf, Lg = this.Lg;
    Lb.n = Lf.n = Lg.n = 0;
    const touch = ph.touch, rope = ph.rope;
    const dustRamp = (i) => dust.map((v) => Math.min(1, v * (0.28 + 0.157 * i)));
    const bot = this.ax[0];
    // FINE DEBRIS: specks orbiting the funnel, rising from the foot to under the wall cloud (2 px smears along their path)
    const nS = Math.round(L.specks * (0.3 + 0.7 * touch));
    for ( let i = 0; i < nS; i++ ) {
      const h = (q) => hu(i, 1, 980 + q);
      const turns = Math.floor(5 + 7 * h(0)), zf = fr(h(1) + Math.floor(1 + 2 * h(2)) * tm / 10);
      const z = 12 * U + Z * 0.78 * Math.pow(zf, 1.2), a = this.axZ(z);
      const r = a.rc * (1 + 0.8 * h(3)) + 2 * U, w = SPIN * TAU * turns / 10, pa = h(4) * TAU + w * tm;
      const X = a.cx + Math.cos(pa) * r, Y = a.cy + Math.sin(pa) * r * sq - lift * z;
      const tx = -Math.sin(pa) * r * w / 30, ty = Math.cos(pa) * r * sq * w / 30;
      const Ls = Math.min(5, Math.hypot(tx, ty)), ang = Math.atan2(ty, tx);
      const col = h(6) > 0.5 ? [0.30, 0.23, 0.17] : [0.20, 0.19, 0.20];
      const al = ss(0, 0.08, zf) * ss(1, 0.85, zf) * (1 - rope);
      (Math.sin(pa) > 0 ? Lf : Lb).push(X, Y, Ls / 2 + 0.5, h(5) > 0.7 ? 1 : 0.5, ang, 0, i, al, ...col, 0);
    }
    // WISPS: torn fragments peeling off the funnel, flung round it (three chords of an arc each)
    const nW = Math.round(L.wisps * (0.4 + 0.6 * ph.reach));
    for ( let i = 0; i < nW; i++ ) {
      const h = (q) => hu(i, 4, 1010 + q);
      const dustW = i < nW / 2, zf = fr(h(0) + Math.floor(1 + 2 * h(1)) * tm / 10);
      const z = dustW ? (8 + 26 * Math.pow(h(2), 1.2) * (0.4 + 0.6 * zf)) * U : 30 * U + Z * 0.62 * zf;
      if ( z < Z * (1 - ph.reach) ) continue;
      const turns = dustW ? Math.floor(5 + 4 * h(3)) : Math.floor(8 + 6 * h(3));
      const pa0 = h(4) * TAU + SPIN * TAU * turns / 10 * tm;
      const ln = (dustW ? 0.5 + 0.7 * h(5) : 0.3 + 0.5 * h(5)) * Math.sqrt(Math.sin(Math.PI * zf));
      const a = this.axZ(z), R = dustW ? (16 + 26 * Math.pow(h(6), 0.8)) * U : a.rc * (1.15 + 0.45 * h(6)) + 2 * U;
      const pts = [];
      for ( let k = 0; k <= 3; k++ ) {
        const f = k / 3, pa = pa0 - SPIN * ln * f, zk = z - (dustW ? 3 : 9) * U * f, Rk = R * (dustW ? 1 - 0.4 * f : 1 + 0.25 * f), ak = this.axZ(Math.max(0, zk));
        pts.push([ak.cx + Math.cos(pa) * Rk, ak.cy + Math.sin(pa) * Rk * sq - lift * zk, pa]);
      }
      for ( let k = 0; k < 3; k++ ) {
        const [x0, y0, pa] = pts[k], [x1, y1] = pts[k + 1], front = Math.sin(pa) > 0;
        const lit = -Math.cos(pa) > 0.3 ? 1 : 0;
        const tone = front ? 4 + lit - (k > 1 ? 1 : 0) - (dustW ? 1 : 0) : 1 + lit;
        const c = dustW ? dustRamp(tone) : GREYS[Math.max(0, Math.min(6, tone))];
        const L2 = Math.hypot(x1 - x0, y1 - y0) / 2;
        (front ? Lf : Lb).push((x0 + x1) / 2, (y0 + y1) / 2, L2 + 0.5, h(8) > 0.6 && k < 2 ? 1 : 0.5, Math.atan2(y1 - y0, x1 - x0), 0, i * 4 + k, (1 - k * 0.22) * (1 - rope), ...c, 0);
      }
    }
    if ( touch > 0.01 ) {
      // SPRAYED CLUMPS: dust thrown out of the foot on spirals, dissolving as they go
      const nC = Math.round(L.clumps * touch);
      for ( let i = 0; i < nC; i++ ) {
        const kc = 1080 + Math.floor(hu(i, 1, 1060) * 1080), life = 3600 / kc;
        const u = (tm + hu(i, 2, 1061) * life) / life, cyc = Math.floor(u) % kc, sF = u - Math.floor(u);
        if ( sF > 0.9 ) continue;
        const h = (q) => hu(i * 13 + cyc, 8, 1062 + q);
        const rho = 20 * U + (40 + 50 * h(0)) * U * Math.pow(sF, 0.6) * (0.7 + 0.5 * o.touchSwell) * L.skirt / 52;
        const pa = h(1) * TAU + SPIN * (2.4 * Math.pow(sF, 0.7) + TAU * 0.3 * tm);
        const z = (4 + 30 * h(2)) * U * Math.sin(Math.PI * Math.min(sF * 1.2, 1)) + 3 * U;
        const rr = (1.2 + 2.6 * h(3)) * U * (1 - 0.6 * sF) * ss(0, 0.12, sF);
        const X = bot.cx + Math.cos(pa) * rho, Y = bot.cy + Math.sin(pa) * rho * sq - lift * z;
        const c = dustRamp(3 + (h(4) > 0.6 ? 1 : 0));
        (Math.sin(pa) > 0 ? Lf : Lb).push(X, Y, rr, rr, 0, 3, i * 13 + cyc, 1, ...c, sF / 0.9);
      }
      // INFLOW: dust and leaf streaks dragged over the ground toward the foot on tightening spirals (on the ground: the stage)
      const nI = Math.round(L.inflow * touch);
      for ( let i = 0; i < nI; i++ ) {
        const kc = 1440 + Math.floor(hu(i, 1, 1200) * 1080), life = 3600 / kc;
        const u = (tm + hu(i, 2, 1201) * life) / life, cyc = Math.floor(u) % kc, sF = u - Math.floor(u);
        const h = (q) => hu(i * 31 + cyc, 3, 1202 + q);
        if ( h(3) < 0.12 ) continue;
        const pos = (s_) => {
          const r = 20 * U + (55 + 85 * h(0)) * U * L.skirt / 52 * Math.pow(1 - s_, 1.3), a = h(1) * TAU + SPIN * (2.4 * Math.pow(s_, 1.6) + TAU * 0.1 * tm);
          return [bot.cx + Math.cos(a) * r, bot.cy + Math.sin(a) * r * sq];
        };
        const [x1, y1] = pos(sF), [x0, y0] = pos(Math.max(sF - (0.05 + 0.10 * sF) * ss(0, 0.25, sF), 0));
        const L2 = Math.hypot(x1 - x0, y1 - y0) / 2;
        const leaf = h(2) > 0.8, c = leaf ? [0.62, 0.52, 0.22] : dustRamp(5);
        Lg.push((x0 + x1) / 2, (y0 + y1) / 2, L2 + 0.5, 0.5, Math.atan2(y1 - y0, x1 - x0), 10, i, 0.85 * ss(0, 0.12, sF) * ss(1, 0.85, sF), ...c, 0);
      }
    }
    // MAP FRAGMENTS (and planks): torn out of the map near the base, spiralled up round the vortex, flung out on arcs, land, dissolve
    const nF = Math.round(L.frags), nP = Math.round(L.planks);
    for ( let i = 0; i < nF + nP; i++ ) {
      const plank = i >= nF;
      const kc = plank ? 600 : 720, life = 3600 / kc;
      const u = (tm + hu(i, 2, 1701) * life) / life, cyc = Math.floor(u) % kc, tau = (u - Math.floor(u)) * life;
      const h = (q) => hu(i * 23 + cyc, 6, 1702 + q);
      const t0 = now - tau * 1000, ph0 = TM.phase(T, t0, g.grid);
      if ( ph0.touch < 0.5 || h(11) > 0.3 + 0.7 * touch ) continue;     // (only torn out while it is on the ground)
      const [b0x, b0y] = this.baseArt(t0);
      const rs = (6 + 30 * h(0)) * U * L.skirt / 52, as = h(1) * TAU;
      const sx = Math.floor(b0x + Math.cos(as) * rs), sy = Math.floor(b0y + Math.sin(as) * rs * sq);
      const size = plank ? 0 : L.fragSz * U * (0.6 + 1.0 * Math.pow(h(2), 1.2)), rr = size / 2;
      const tl = 0.7 + 0.8 * h(3), zr = (30 + 70 * Math.pow(h(4), 1.3)) * U, om = (1.3 + 0.6 * h(5)) * TAU;
      const lift_ = (tt) => {
        const e = ss(0, 1, tt / tl), z = zr * Math.pow(e, 1.4);
        const [bx2, by2] = this.baseArt(t0 + tt * 1000), a = this.axZ(Math.min(z, Z));
        const ox = a.cx - bot.cx, oy = a.cy - bot.cy;
        const r2 = (1 - e) * rs + e * (a.rc * 1.25 + 4 * U), pa = as + SPIN * om * tt * e;
        const gx = (1 - e) * (bx2 + Math.cos(as) * rs) + e * (bx2 + ox + Math.cos(pa) * r2);
        const gy = (1 - e) * (by2 + Math.sin(as) * rs * sq) + e * (by2 + oy + Math.sin(pa) * r2 * sq);
        return [gx, gy, z, pa];
      };
      let gx, gy, z, front, landed = false, dis = 0;
      if ( tau < tl ) { let pa; [gx, gy, z, pa] = lift_(tau); front = Math.sin(pa) > 0; }
      else {
        const [gx1, gy1, z1] = lift_(tl), [gx0, gy0] = lift_(tl - 0.04);
        let vx = (gx1 - gx0) / 0.04, vy = (gy1 - gy0) / 0.04;
        const spd = Math.hypot(vx, vy) + 1e-6, vmax = (70 + 40 * h(8)) * U;
        vx = vx / spd * Math.min(spd, vmax); vy = vy / spd * Math.min(spd, vmax);
        const vz = (12 + 28 * h(9)) * U, gg = 110 * U, tf = tau - tl, tland = (vz + Math.sqrt(vz * vz + 2 * gg * z1)) / gg;
        const tt = Math.min(tf, tland), drag = 1 - 0.18 * tt;
        gx = gx1 + vx * tt * drag; gy = gy1 + vy * tt * drag; z = Math.max(z1 + vz * tt - 0.5 * gg * tt * tt, 0);
        landed = tf >= tland;
        front = gy >= o.by - 2 * U;
        if ( landed ) { const rest = tf - tland, lie = 0.4 + 0.4 * h(10); if ( rest > lie + 0.5 ) continue; dis = ss(lie, lie + 0.5, rest); }
      }
      const spin = (6 + 9 * h(6)) * (h(7) > 0.5 ? 1 : -1);
      const tland2 = landed ? tau : Math.min(tau, tl + 3);
      const ang = spin * tland2 * (landed ? 1 : 1);
      const fresh = ss(0, 0.3, tau), Lst = front ? Lf : Lb;
      const X = gx, Y = gy - lift * z;
      const al = 1 - rope * 0.7;
      if ( plank ) {
        const w = (5 + 4 * h(2)) * U / 2, c = h(3) > 0.5 ? [0.55, 0.40, 0.24] : [0.66, 0.52, 0.34];
        Lst.push(X, Y, w, 0.75 * U, ang, 2, i * 23 + cyc, al * (1 - dis), ...c, 0, 0, 0, fresh, Math.abs(Math.cos(ang * 1.7)));
      } else {
        const sd = (i * 131 + cyc * 7 + 3) % 99991;
        Lst.push(X, Y, rr * 1.75, rr * 1.75, ang, 1, sd, al, 0, 0, 0, dis, sx, sy, fresh, rr);
        // the scar where it was torn out (on the ground, for 3 s, dissolving)
        if ( tau < 3 ) Lg.push(sx, sy, rr * 1.75, rr * 1.75, 0, 12, sd, 1, 0, 0, 0, ss(2, 3, tau), sx, sy, 0, rr);
      }
      // its shadow on the ground (how far below it shows the height)
      if ( !landed && z > 0.5 ) {
        const r = Math.max(1.5, plank ? 3 * U : 0.56 * rr * 1.6) * (1 - 0.3 * Math.min(z / (150 * U), 1));
        Lg.push(gx, gy, r, r * 0.6, 0, 11, i, al, 0, 0, 0, 0);
      }
    }
    for ( const [I, G] of [[Lb, this.ib], [Lf, this.ifr], [Lg, this.ig]] ) { G.buf.data.set(I.d.subarray(0, I.n * STRIDE)); G.buf.update(); G.g.instanceCount = I.n; }
  }

  render() {
    const r = canvas.app.renderer, A = this.art;
    r.render(this.puffs, { renderTexture: this.hf, clear: true });
    r.render(this.curtain, { renderTexture: A, clear: true });
    r.render(this.skirt, { renderTexture: A, clear: false });
    if ( this.Lb.n ) r.render(this.back, { renderTexture: A, clear: false });
    r.render(this.column, { renderTexture: A, clear: false });
    r.render(this.foot, { renderTexture: A, clear: false });
    if ( this.Lf.n ) r.render(this.front, { renderTexture: A, clear: false });
    r.render(this.deck, { renderTexture: A, clear: false });
  }

  hide() { this.ground.visible = false; this.marks.visible = false; this.show.visible = false; }

  destroy() {
    for ( const m of [this.ground, this.marks, this.show] ) { m.parent?.removeChild(m); }
    for ( const m of [this.curtain, this.deck, this.wallC, this.column, this.skirt, this.foot, this.puffs, this.back, this.front, this.marks, this.ground, this.show] ) { m.geometry?.destroy(); m.destroy(); }
    this.hf.destroy(true); this.art.destroy(true);
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
    const v = canvas.app.renderer.screen, st = canvas.stage;
    const tl = st.toLocal({ x: 0, y: 0 }), br = st.toLocal({ x: v.width, y: v.height });
    return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
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
