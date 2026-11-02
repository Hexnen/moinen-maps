/**
 * GPU PIECES (PERF). The batched pieces of piece-batch.mjs still cost the CPU a pose (display.place), a few array writes and a vertex
 * write per moving piece per frame (~14 + ~8 ms of a busy frame on a whole-scene Detonate of 'map'). Here an entering area's PLAIN
 * pieces (blast / cracks / gash / scorch / flood: display.place's own motion; a tear's and a cave-in's stay on the CPU path) are
 * INSTANCES of one geometry whose per-piece numbers - source, rest, timing, spin, arc, size, frame - are uploaded ONCE when the area
 * enters; per frame only a few uniforms change (the time). The vertex shader does display.place's maths (same formulas and rounding,
 * float32): the pre-shiver, the flight (ease-out arc, spin back to rest, stretch), the landing squash and hops, the scorch / flood
 * tint, the "over the scene only" cull; then PIXI's own transform chain (Transform.updateTransform, Sprite.calculateVertices) and the
 * batch shader's colour packing. The ruin's base quad is instance 0 (world-space parallelogram from the base sprite), as in the CPU path.
 *
 * Instance layout (18 floats): A = sx, sy, fx, fy | B = t0, dur, pre, arc | C = rot, spin, seed, bounces | D = w, h, u0, v0 | E = u1, v1.
 * The base (instance 0): A = P0, E1 | B = E2, slot | C.w = -1 | D.zw = u0, v0 | E = u1, v1. Times are ms from the entry's start.
 *
 * `CONFIG.moinenMaps.noGpuPieces = true`: the CPU poses (A/B); WebGL 1: always the CPU path.
 */
import { batchStats } from "./piece-batch.mjs";

const IS = 18;
let ROUND = null;

/** display.place's maths (shared by the drawing and the read-back check). */
const POSE = `
const float PI = 3.14159265358979;
uniform float uNow, uRest, uAp, uHopMs, uType;
uniform vec2 uOrg;
uniform vec4 uScene;
uniform vec3 uCT;
float rnd(float x) { return floor(x + 0.5); }
float odd(float x) { return mod(floor(x), 2.0); }
void pose(vec4 A, vec4 B, vec4 C, out vec2 pos, out float rot, out vec2 scl, out float vis, out vec3 tint) {
  tint = vec3(255.0); rot = 0.0; scl = vec2(uAp); vis = 1.0;
  if (uRest > 0.5) { pos = uOrg + A.zw * uAp; return; }
  float tm = uNow - B.x, dur = B.y, t = tm / dur;
  tm = t * dur;
  if (uType > 1.5) { if (t > 0.0) { float u = min(t, 1.0); tint = vec3(255.0, 160.0, 96.0) + (vec3(255.0) - vec3(255.0, 160.0, 96.0)) * u; tint = floor(tint + 0.5); } }
  else if (uType > 0.5) { float u = clamp(t, 0.0, 1.0) * 0.7; tint = floor(vec3(255.0) + (vec3(184.0, 212.0, 255.0) - vec3(255.0)) * u + 0.5); }
  if (uCT.x >= 0.0) { tint = (t <= 0.0 || t >= 1.5) ? vec3(255.0) : floor(uCT + (vec3(255.0) - uCT) * clamp(t / 1.5, 0.0, 1.0) + 0.5); }
  if (tm < 0.0) {
    if (tm < -B.z) { vis = 0.0; pos = vec2(0.0); return; }
    float f = 1.0 + tm / B.z;
    float sh = f > 0.45 ? (odd(tm / 45.0 + C.z) > 0.5 ? 1.0 : -1.0) * 0.5 : 0.0;
    pos = uOrg + vec2(rnd(A.x + sh) * uAp, A.y * uAp);
    return;
  }
  if (t >= 1.0) {
    float st = tm - dur, squash = 1.0, hop = 0.0;
    if (st < 70.0) squash = 0.82 + 0.18 * (st / 70.0);
    float hi = floor(st / uHopMs);
    if (hi < C.w) { float ph = (st - hi * uHopMs) / uHopMs, h = min(2.5, B.w * 0.18) / (hi + 1.0); hop = sin(ph * PI) * h; }
    pos = uOrg + vec2(A.z * uAp, rnd(A.w - hop) * uAp);
    scl = vec2(uAp, uAp * squash);
    return;
  }
  float u1 = 1.0 - t, e = 1.0 - u1 * u1 * u1;
  float x = A.x + (A.z - A.x) * e, y = A.y + (A.w - A.y) * e - B.w * 4.0 * t * (1.0 - t);
  pos = uOrg + vec2(rnd(x) * uAp, rnd(y) * uAp);
  if (!(pos.x >= uScene.x && pos.y >= uScene.y && pos.x < uScene.z && pos.y < uScene.w)) vis = 0.0;
  rot = C.x * (1.0 - e) * C.y;
  float sc = 1.0 + 0.1 * sin(min(1.0, t) * PI);
  if (uType > 0.5 && uType < 1.5) sc = 1.06 - 0.06 * e;
  scl = vec2(uAp * sc, uAp * sc * (1.0 - 0.08 * sin(t * PI)));
}
`;

const VERT = `precision highp float;
attribute vec2 aCorner;
attribute vec4 aA, aB, aC, aD;
attribute vec2 aE;
uniform mat3 projectionMatrix;
uniform vec4 uM;
uniform vec2 uT;
uniform float uAlpha, uRound;
uniform vec4 uBaseCol;
varying vec2 vUv;
varying vec4 vCol;
varying float vSlot;
${POSE}
void main() {
  vUv = mix(aD.zw, aE, aCorner);
  float X, Y;
  if (aC.w < -0.5) {
    if (uBaseCol.a <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    vec2 P = aA.xy + aCorner.x * aA.zw + aCorner.y * aB.xy;
    X = P.x; Y = P.y; vCol = uBaseCol; vSlot = aB.z;
  } else {
    vec2 pos, scl; float rot, vis; vec3 tint;
    pose(aA, aB, aC, pos, rot, scl, vis, tint);
    float ea = min(uAlpha, 1.0);
    if (vis < 0.5 || !(ea > 0.0)) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    float cs = cos(rot), sn = sin(rot);
    float la = cs * scl.x, lb = sn * scl.x, lc = -sin(rot) * scl.y, ld = cos(rot) * scl.y;
    float a = la * uM.x + lb * uM.z, b = la * uM.y + lb * uM.w, c = lc * uM.x + ld * uM.z, d = lc * uM.y + ld * uM.w;
    float tx = pos.x * uM.x + pos.y * uM.z + uT.x, ty = pos.x * uM.y + pos.y * uM.w + uT.y;
    vec2 q = (aCorner - 0.5) * aD.xy;
    X = a * q.x + c * q.y + tx; Y = d * q.y + b * q.x + ty;
    if (uRound > 0.0) { X = rnd(X * uRound) / uRound; Y = rnd(Y * uRound) / uRound; }
    vec3 rgb = tint; float a8 = 255.0;
    if (ea != 1.0) { rgb = floor(tint * ea + 0.5); a8 = floor(ea * 255.0); }
    vCol = vec4(rgb, a8) / 255.0; vSlot = 0.0;
  }
  gl_Position = vec4((projectionMatrix * vec3(X, Y, 1.0)).xy, 0.0, 1.0);
}`;

const FRAG = `precision highp float;
varying vec2 vUv;
varying vec4 vCol;
varying float vSlot;
uniform sampler2D uAtlas, uBase;
void main() {
  vec4 a = texture2D(uAtlas, vUv), b = texture2D(uBase, vUv);
  gl_FragColor = (vSlot > 0.5 ? b : a) * vCol;
}`;

let SHADER = null;
const U = {
  uM: new Float32Array(4), uT: new Float32Array(2), uCT: new Float32Array(3), uOrg: new Float32Array(2), uScene: new Float32Array(4), uBaseCol: new Float32Array(4)
};
function shader() {
  return SHADER ??= PIXI.Shader.from(VERT, FRAG, {
    uAtlas: 0, uBase: 1, uNow: 0, uRest: 0, uAp: 1, uHopMs: 150, uType: 0, uAlpha: 1, uRound: 0,
    uM: U.uM, uT: U.uT, uCT: U.uCT, uOrg: U.uOrg, uScene: U.uScene, uBaseCol: U.uBaseCol
  });
}

/** Can the GPU path run here (WebGL 2: instanced drawing)? */
export function gpuPiecesSupported(renderer) { return !!renderer && renderer.context?.webGLVersion >= 2; }

let cornerBuf = null, indexBuf = null;
const pool = new Map();
let pooledBytes = 0;
const POOL_MAX = 64 * 1048576;

function takeGeometry(n) {
  let cap = 64; while ( cap < n ) cap *= 2;
  const list = pool.get(cap);
  if ( list?.length ) { const g = list.pop(); pooledBytes -= cap * IS * 4; g.data.fill(0, 0, n * IS); g.buf.update(); return g; }
  cornerBuf ??= new PIXI.Buffer(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), true, false);
  indexBuf ??= new PIXI.Buffer(new Uint16Array([0, 1, 2, 0, 2, 3]), true, true);
  const data = new Float32Array(cap * IS), buf = new PIXI.Buffer(data, false, false);
  const geom = new PIXI.Geometry()
    .addAttribute("aCorner", cornerBuf, 2, false, PIXI.TYPES.FLOAT, 8, 0)
    .addAttribute("aA", buf, 4, false, PIXI.TYPES.FLOAT, IS * 4, 0, true)
    .addAttribute("aB", buf, 4, false, PIXI.TYPES.FLOAT, IS * 4, 16, true)
    .addAttribute("aC", buf, 4, false, PIXI.TYPES.FLOAT, IS * 4, 32, true)
    .addAttribute("aD", buf, 4, false, PIXI.TYPES.FLOAT, IS * 4, 48, true)
    .addAttribute("aE", buf, 2, false, PIXI.TYPES.FLOAT, IS * 4, 64, true)
    .addIndex(indexBuf);
  return { cap, data, buf, geom };
}
function giveGeometry(G) {
  if ( pooledBytes + G.cap * IS * 4 > POOL_MAX ) { G.geom.destroy(); G.buf.destroy(); return; }
  pooledBytes += G.cap * IS * 4;
  if ( !pool.has(G.cap) ) pool.set(G.cap, []);
  pool.get(G.cap).push(G);
}

/** A piece's stand-in on this path (place / endAnim write it; its pose lives in the shader): every write is dropped. */
class StubPose {
  get destroyed() { return false; }
  get visible() { return true; } set visible(v) {}
  get alpha() { return 1; } set alpha(v) {}
  get tint() { return 0xFFFFFF; } set tint(v) {}
  get rotation() { return 0; } set rotation(v) {}
  get x() { return 0; } get y() { return 0; }
  get position() { return STUB_POINT; } get scale() { return STUB_POINT; }
  get texture() { return null; }
  get worldVisible() { return true; }
}
const STUB_POINT = { set() {} };
export const STUB = new StubPose();

const TYPE_CODE = { flood: 1, scorch: 2 };

export class GpuPieceBatch extends PIXI.Container {
  constructor(n, tex, atlas, base = null) {
    super();
    this.eventMode = "none";
    this.gpu = true;
    this.n = n; this.tex = tex; this.atlas = atlas; this.base = base;
    this.G = takeGeometry(n + 1);
    this.baseBlank = null;
    this.baseTex = null; this.baseUpd = -1; this.folded = false; this.baseOn = false; this.baseSlot = 0; this.baseDirty = true;
    this.rest = true; this.now = 0; this.firstT = Infinity; this.full = true;
    this.ap = 1; this.org = [0, 0]; this.hopMs = 150; this.typeCode = 0; this.causeTint = [-1, -1, -1];
    this.state = PIXI.State.for2d();
    this.bc = new Float32Array(4);
    this.bv = new Float64Array(8);
  }

  /** Upload the area's pieces (display.enter's list) for an entry that starts at `a.start`; the clock starts at `now`. */
  load(display, g, a) {
    const D = this.G.data, A = this.atlas, tw = this.tex.width, th = this.tex.height, list = a.list, P = g.pieces, n = P.length, t = a.start;
    for ( let i = 0; i < n; i++ ) {
      const p = P[i], it = list[i], o = (i + 1) * IS, pos = A.pos[i + 1], sz = A.sizes[i + 1];
      D[o] = p.sx; D[o + 1] = p.sy; D[o + 2] = p.fx; D[o + 3] = p.fy;
      D[o + 4] = it.t0 - t; D[o + 5] = it.dur; D[o + 6] = it.pre; D[o + 7] = it.arc;
      D[o + 8] = p.rot; D[o + 9] = it.spin; D[o + 10] = it.seed; D[o + 11] = it.bounces;
      D[o + 12] = sz[0]; D[o + 13] = sz[1]; D[o + 14] = pos.x / tw; D[o + 15] = pos.y / th;
      D[o + 16] = (pos.x + sz[0]) / tw; D[o + 17] = (pos.y + sz[1]) / th;
    }
    D[11] = -1;                         // the base: instance 0
    this.ap = display.ap; this.org = [display.origin.x, display.origin.y];
    this.hopMs = 150;                 /* (place: `a.k ?? 1` with a = the piece's life, which has no k here) */ this.typeCode = TYPE_CODE[g.info.type] ?? 0;
    { const c = a.cl?.tint; this.causeTint = c ? [(c >> 16) & 255, (c >> 8) & 255, c & 255] : [-1, -1, -1]; }
    this.start = t; this.firstT = a.list.reduce((m, it) => Math.min(m, it.t0 - it.pre), Infinity) - t;
    this.rest = false; this.full = true; this.baseDirty = true;
    this.G.buf.update();
  }

  /** The entry's clock (ms, performance.now() timeline) for this frame. */
  setClock(now) { this.now = now - this.start; }

  setRest() { this.rest = true; }

  syncFold() {
    const s = this.base, c = s?.parent;
    const want = !globalThis.CONFIG?.moinenMaps?.noFold && !!s && !s.destroyed && !!c && c.children.length === 1 && !c.filters && !c.mask && !s.filters && !s.mask && s.blendMode === PIXI.BLEND_MODES.NORMAL
      && this.axisAligned(s);
    if ( want !== this.folded ) {
      this.folded = want;
      if ( s && !s.destroyed ) s.renderable = !want;
    }
  }

  axisAligned(s) {
    const u = s._texture?._uvs?.uvsFloat32; if ( !u ) return false;
    return u[2] === u[4] && u[3] === u[1] && u[6] === u[0] && u[7] === u[5];
  }

  /** The base quad from the base sprite (instance 0). */
  writeBase() {
    const D = this.G.data, s = this.base, bv = this.bv;
    const on = this.folded && s.visible && s.worldAlpha > 0 && s._texture?.valid && !this.baseBlank?.();
    this.baseOn = on;
    if ( !on ) { this.bc[3] = 0; return; }
    s.calculateVertices();
    const v = s.vertexData;
    let ch = this.baseDirty;
    // (the parallelogram: P0, P0->P1, P0->P3)
    if ( bv[0] !== v[0] || bv[1] !== v[1] || bv[2] !== v[2] || bv[3] !== v[3] || bv[4] !== v[6] || bv[5] !== v[7] ) {
      bv[0] = v[0]; bv[1] = v[1]; bv[2] = v[2]; bv[3] = v[3]; bv[4] = v[6]; bv[5] = v[7]; ch = true;
    }
    const t = s._texture;
    if ( t !== this.baseTex || t._updateID !== this.baseUpd ) { this.baseTex = t; this.baseUpd = t._updateID; ch = true; }
    if ( ch ) {
      this.baseDirty = false;
      const uv = t._uvs.uvsFloat32, id = t.baseTexture === this.tex ? 0 : 1;
      this.baseSlot = id;
      D[0] = v[0]; D[1] = v[1]; D[2] = v[2] - v[0]; D[3] = v[3] - v[1];
      D[4] = v[6] - v[0]; D[5] = v[7] - v[1]; D[6] = id; D[7] = 0;
      D[8] = 0; D[9] = 0; D[10] = 0; D[11] = -1;
      D[14] = uv[0]; D[15] = uv[1]; D[16] = uv[4]; D[17] = uv[5];
      this.baseUp = true;
    }
    const col = PIXI.Color.shared.setValue(s._tintRGB).toPremultiplied(Math.min(s.worldAlpha, 1), s._texture.baseTexture.alphaMode > 0) >>> 0;
    this.bc[0] = (col & 255) / 255; this.bc[1] = ((col >> 8) & 255) / 255; this.bc[2] = ((col >> 16) & 255) / 255; this.bc[3] = (col >>> 24) / 255;
    // (the colour packed as ABGR little-endian words by toPremultiplied: r in the low byte once setValue(_tintRGB) swapped it)
  }

  atlasReady(renderer) { const t = this.tex._glTextures?.[renderer.CONTEXT_UID]; return !!t && t.dirtyId === this.tex.dirtyId; }

  _render(renderer) {
    const M = this.worldTransform;
    ROUND ??= !!new PIXI.Sprite()._roundPixels;
    this.syncFold();
    const sh = shader();
    if ( !this.tex.valid ) return;
    if ( this.base ) this.writeBase();
    let pieces = this.rest || this.now >= this.firstT;
    if ( pieces && !this.atlasReady(renderer) && !globalThis.CONFIG?.moinenMaps?.atlasNow ) { pieces = false; batchStats.deferred = (batchStats.deferred ?? 0) + 1; }
    if ( !pieces && !this.baseOn ) return;
    renderer.batch.flush();
    renderer.texture.bind(pieces ? this.tex : PIXI.Texture.WHITE.baseTexture, 0);
    if ( this.baseOn && this.baseTex?.baseTexture && this.baseSlot === 1 ) renderer.texture.bind(this.baseTex.baseTexture, 1);
    else renderer.texture.bind(PIXI.Texture.WHITE.baseTexture, 1);
    if ( this.baseOn && this.baseSlot === 0 && !pieces ) renderer.texture.bind(this.tex, 0);
    const u = sh.uniforms;
    u.uNow = this.now; u.uRest = this.rest ? 1 : 0; u.uAp = this.ap; u.uHopMs = this.hopMs; u.uType = this.typeCode;
    u.uAlpha = this.worldAlpha; u.uRound = ROUND ? PIXI.settings.RESOLUTION : 0;
    U.uCT.set(this.causeTint);
    U.uOrg[0] = this.org[0]; U.uOrg[1] = this.org[1];
    U.uM[0] = M.a; U.uM[1] = M.b; U.uM[2] = M.c; U.uM[3] = M.d; U.uT[0] = M.tx; U.uT[1] = M.ty;
    const r = globalThis.canvas?.dimensions?.sceneRect;
    if ( r ) { U.uScene[0] = r.x; U.uScene[1] = r.y; U.uScene[2] = r.x + r.width; U.uScene[3] = r.y + r.height; } else { U.uScene[0] = U.uScene[1] = -1e9; U.uScene[2] = U.uScene[3] = 1e9; }
    U.uBaseCol.set(this.bc);
    renderer.shader.bind(sh);
    this.state.blendMode = PIXI.BLEND_MODES.NORMAL;
    renderer.state.set(this.state);
    const G = this.G;
    if ( this.full ) { G.buf.update(); this.full = false; this.baseUp = false; batchStats.full++; }
    renderer.geometry.bind(G.geom, sh);
    const gl = renderer.gl;
    if ( this.baseUp ) {
      const glb = G.buf._glBuffers?.[renderer.CONTEXT_UID];
      if ( glb?.buffer && glb.updateID === G.buf._updateID ) { gl.bindBuffer(gl.ARRAY_BUFFER, glb.buffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, G.data, 0, IS); batchStats.uploads++; }
      else { G.buf.update(); renderer.buffer.update(G.buf); }
      this.baseUp = false;
    }
    renderer.geometry.draw(PIXI.DRAW_MODES.TRIANGLES, 6, 0, pieces ? this.n + 1 : 1);
    batchStats.draws++;
  }

  destroy(options) {
    if ( this.base && !this.base.destroyed && this.folded ) this.base.renderable = true;
    this.folded = false; this.base = null;
    if ( this.G ) { giveGeometry(this.G); this.G = null; }
    super.destroy(options);
  }
}

/**
 * READ-BACK (dev check): the pose the shader computes for every piece of `batch` (transform feedback of the very same GLSL),
 * [x, y (canvas px), rotation, visible, scaleX, scaleY, tintR, tintG] per piece, at the batch's clock.
 */
export function readPoses(renderer, batch) {
  const gl = renderer.gl, n = batch.n;
  const vs = `precision highp float;
attribute vec4 aA, aB, aC;
varying vec4 oP;
varying vec4 oS;
${POSE}
void main() { vec2 pos, scl; float rot, vis; vec3 tint; pose(aA, aB, aC, pos, rot, scl, vis, tint); oP = vec4(pos, rot, vis); oS = vec4(scl, tint.r, tint.g); gl_Position = vec4(0.0); }`;
  const fs = "precision highp float; void main() { gl_FragColor = vec4(0.0); }";
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if ( !gl.getShaderParameter(s, gl.COMPILE_STATUS) ) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fs));
  gl.transformFeedbackVaryings(pr, ["oP", "oS"], gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(pr); if ( !gl.getProgramParameter(pr, gl.LINK_STATUS) ) throw new Error(gl.getProgramInfoLog(pr));
  const glb = batch.G.buf._glBuffers?.[renderer.CONTEXT_UID]?.buffer; if ( !glb ) return null;      // (not drawn yet: nothing on the GPU)
  const out = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, out); gl.bufferData(gl.ARRAY_BUFFER, n * 8 * 4, gl.STATIC_READ);
  const tf = gl.createTransformFeedback();
  gl.useProgram(pr);
  const set = (name, v) => { const l = gl.getUniformLocation(pr, name); if ( l ) { if ( v.length === 2 ) gl.uniform2fv(l, v); else if ( v.length === 4 ) gl.uniform4fv(l, v); else gl.uniform1f(l, v); } };
  set("uNow", batch.now); set("uRest", batch.rest ? 1 : 0); set("uAp", batch.ap); set("uHopMs", batch.hopMs); set("uType", batch.typeCode);
  set("uOrg", new Float32Array(batch.org));
  { const l = gl.getUniformLocation(pr, "uCT"); if ( l ) gl.uniform3fv(l, new Float32Array(batch.causeTint)); }
  const r = canvas.dimensions?.sceneRect;
  set("uScene", r ? new Float32Array([r.x, r.y, r.x + r.width, r.y + r.height]) : new Float32Array([-1e9, -1e9, 1e9, 1e9]));
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, glb);
  for ( const [name, off] of [["aA", 0], ["aB", 16], ["aC", 32]] ) {
    const l = gl.getAttribLocation(pr, name); gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, 4, gl.FLOAT, false, IS * 4, off + IS * 4);   // (skip instance 0, the base)
    gl.vertexAttribDivisor(l, 0);
  }
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
  gl.enable(gl.RASTERIZER_DISCARD);
  gl.beginTransformFeedback(gl.POINTS);
  gl.drawArrays(gl.POINTS, 0, n);
  gl.endTransformFeedback();
  gl.disable(gl.RASTERIZER_DISCARD);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
  const res = new Float32Array(n * 8);
  gl.bindBuffer(gl.ARRAY_BUFFER, out); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, res);
  for ( const name of ["aA", "aB", "aC"] ) gl.disableVertexAttribArray(gl.getAttribLocation(pr, name));
  gl.deleteBuffer(out); gl.deleteTransformFeedback(tf); gl.deleteProgram(pr);
  gl.bindVertexArray(null); renderer.shader.program = null; renderer.geometry.unbind?.();
  return res;
}
