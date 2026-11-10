/**
 * VRAM: what this page holds on the GPU, per client (every user's card is different), against the card's budget.
 *
 * WHAT IS COUNTED (exact sizes of what the page asked the GPU for; the driver's padding and alignment are not visible):
 *  - every texture PIXI has on the GPU (renderer.texture.managedTextures): its allocated width x height x bytes per texel of its
 *    format, x 4/3 when it has mipmaps;
 *  - the depth/stencil and multisample buffers of render textures (renderer.framebuffer.managedFramebuffers);
 *  - vertex/index buffers (renderer.buffer.managedBuffers).
 * WHAT IS ESTIMATED:
 *  - the canvas itself (the drawing buffer, its depth/stencil and the browser's copy of the last frame): 12 bytes a backing pixel;
 *  - the budget: a browser cannot read the card's memory nor its real use (vram-gpu.mjs); the budget is taken from the card model
 *    (renderer string -> table), or set by the user (client setting "vramBudget", GB).
 * WHAT IS NOT VISIBLE: the browser's own UI layers, other tabs and apps, the driver. Real use is therefore somewhat higher.
 *
 * BY LAYER: a texture belongs to the code that made it. Creating a BaseTexture runs `setResource` once (also for render textures);
 * a patch there takes a stack trace object (cheap: V8 formats it only when read) and queues the texture; at idle the queue is
 * classified (the first frame from this module's scripts/<dir>/ names the layer; no frame of ours = Foundry and other modules)
 * and the trace dropped. Nothing is tagged on existing objects except `_mmV` (the layer key) on BaseTextures.
 *
 * COST: nothing per frame. A sample walks the three lists (~0.8 us a texture) in idle slices of at most ~2 ms every few seconds
 * while the meter is on screen (vram-ui.mjs), or when `api.vram.sample()` / `api.diag.vram()` asks.
 */
import { MODULE_ID } from "./config.mjs";
import { api as moduleApi } from "./attrs.mjs";
import { cardOf } from "./vram-gpu.mjs";

/** Layers in display order; "canvas" (estimated) and "buffers" (geometry) are added by the sample. */
export const LAYERS = ["destruction", "fire", "weather", "water", "zones", "districts", "module", "foundry"];
export const WARN = 0.75, OVER = 0.9;
const GB = 1024 ** 3, MB = 1024 ** 2;

/* ---------------------------------------------------------------- who made a texture */

/**
 * The layer of a stack trace (pure; dev/vram.test.mjs): the first frame from this module's scripts names it.
 * @param {string} stack
 * @returns {string} one of LAYERS
 */
export function layerOfStack(stack) { return originOfStack(stack).layer; }

/**
 * The layer and the file (scripts/<path>, "" when not ours) of a stack trace. The CLOSEST frame that is not PIXI decides: one of
 * this module's scripts names its layer; Foundry's code (foundry.mjs), a system or another module means Foundry made it, even when
 * our code is further down the stack (a wrapper of ours around Foundry's render, e.g. view-smooth.mjs, does not own what it draws).
 */
export function originOfStack(stack) {
  const ours = `/modules/${MODULE_ID}/scripts/`;
  for ( const line of String(stack ?? "").split("\n") ) {
    const i = line.indexOf(ours);
    if ( i < 0 ) {
      if ( /\/scripts\/foundry\.mjs|\/modules\/[^/]+\/|\/systems\/[^/]+\//.test(line) ) return { layer: "foundry", file: "" };
      continue;
    }
    const p = /^[^\s:?)]+/.exec(line.slice(i + ours.length))?.[0] ?? "";
    if ( /^vram(-[a-z]+)?\.mjs$/.test(p) ) continue;
    const [dir, file = ""] = p.split("/");
    if ( dir === "destruction" ) return { layer: /^flood/.test(file) ? "water" : "destruction", file: p };
    if ( ["fire", "weather", "water", "zones"].includes(dir) ) return { layer: dir, file: p };
    if ( /^districts/.test(dir) ) return { layer: "districts", file: p };
    return { layer: "module", file: p };
  }
  return { layer: "foundry", file: "" };
}

const pending = [];
let drainQueued = false;
const idle = (fn, timeout) => globalThis.requestIdleCallback ? requestIdleCallback(fn, { timeout }) : setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: true }), 50);

/**
 * The file names of a trace, one per line, and nothing else: V8 hands the frames to Error.prepareStackTrace on the first read, and
 * asking only getFileName() skips the line/column lookups of the usual text (the slow part of reading a stack).
 */
const fileNames = (e, sites) => sites.map((c) => c.getFileName?.() ?? "").join("\n");
function filesOf(err) {
  const prev = Error.prepareStackTrace;
  Error.prepareStackTrace = fileNames;
  try { return String(err.stack ?? ""); } finally { Error.prepareStackTrace = prev; }
}
/** At most this long per idle slice (classifying, walking). */
const SLICE_MS = 2;

/** Classify the queued textures (at idle, a few ms at most per call). */
function drain() {
  drainQueued = false;
  const t0 = performance.now();
  let i = 0;
  for ( ; i < pending.length; i++ ) {
    if ( (i & 31) === 31 && performance.now() - t0 > SLICE_MS ) break;
    const bt = pending[i];
    if ( bt.destroyed ) { if ( typeof bt._mmV !== "string" ) bt._mmV = "foundry"; continue; }   // gone before it was counted: never read its trace
    classify(bt);
  }
  pending.splice(0, i);
  if ( pending.length ) queueDrain();
}
function queueDrain() { if ( drainQueued ) return; drainQueued = true; idle(drain, 1000); }
function classify(bt) {
  const v = bt._mmV;
  if ( typeof v === "string" ) return v;
  let o = { layer: "foundry", file: "" };
  try { if ( v ) o = originOfStack(filesOf(v)); } catch { /* keep foundry */ }
  bt._mmV = o.layer; bt._mmF = o.file;
  return o.layer;
}

/** The patch: once per BaseTexture (its constructor calls setResource; render textures too). */
(function patch() {
  const BT = globalThis.PIXI?.BaseTexture;
  if ( !BT || BT.prototype._mmVramPatched ) return;
  const orig = BT.prototype.setResource;
  BT.prototype.setResource = function(resource) {
    if ( this._mmV === undefined ) {
      const lim = Error.stackTraceLimit;
      Error.stackTraceLimit = 16;
      this._mmV = new Error();
      Error.stackTraceLimit = lim;
      pending.push(this);
      queueDrain();
    }
    return orig.call(this, resource);
  };
  BT.prototype._mmVramPatched = true;
})();

/* ---------------------------------------------------------------- sizes */

/** Bytes per texel of a GL internal format (+ type for the unsized ones). */
export function bytesPerTexel(internalFormat, type) {
  const t = type === 0x1406 ? 4 : type === 0x140B || type === 0x8D61 ? 2 : type === 0x1403 || type === 0x1402 ? 2 : type === 0x1405 || type === 0x1404 ? 4 : 1;
  switch ( internalFormat ) {
    case 0x8058: case 0x8C43: case 0x8D7C: case 0x8D8E: case 0x906F: return 4;              // RGBA8, SRGB8_ALPHA8, RGBA8UI, RGBA8I, RGB10_A2
    case 0x881A: return 8; case 0x8814: return 16;                                          // RGBA16F, RGBA32F
    case 0x8051: return 4; case 0x881B: return 8; case 0x8815: return 16;                 // RGB8 (padded to 4), RGB16F, RGB32F
    case 0x8229: return 1; case 0x822B: return 2; case 0x822D: return 2; case 0x822E: return 4; case 0x822F: return 4; case 0x8230: return 8;   // R8 RG8 R16F R32F RG16F RG32F
    case 0x1906: case 0x1909: return 1; case 0x190A: return 2;                              // ALPHA, LUMINANCE, LUMINANCE_ALPHA
    case 0x1903: return t; case 0x8227: return 2 * t;                                        // RED, RG (unsized)
    case 0x1907: return 4 * t; case 0x1908: return 4 * t;                                    // RGB (padded to 4), RGBA
    case 0x81A5: case 0x81A6: case 0x88F0: case 0x8CAC: case 0x1902: case 0x84F9: return 4;  // depth / depth-stencil
    default: return 4;
  }
}

/* ---------------------------------------------------------------- the budget */

let budgetCache = null;
/** The card and the budget: { bytes, source: "manual" | "table" | "shared" | "unknown", model, renderer, gb, alt }. */
export function budget() {
  let manual = 0;
  try { manual = Number(game.settings.get(MODULE_ID, "vramBudget")) || 0; } catch { /* not registered yet */ }
  if ( !budgetCache ) {
    let renderer = "";
    try {
      const gl = canvas?.app?.renderer?.gl;
      if ( gl ) { const e = gl.getExtension("WEBGL_debug_renderer_info"); renderer = String((e && gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || ""); }
    } catch { /* masked */ }
    if ( renderer ) budgetCache = { renderer, card: cardOf(renderer, navigator.deviceMemory ?? null) };
  }
  const renderer = budgetCache?.renderer ?? "", card = budgetCache?.card ?? { model: "", gb: null, alt: 0, shared: false, known: false };
  const out = { renderer, model: card.model, gb: card.gb, alt: card.alt, shared: card.shared, known: card.known };
  if ( manual > 0 ) return { ...out, bytes: manual * GB, source: "manual" };
  if ( card.gb ) return { ...out, bytes: card.gb * GB, source: card.shared ? "shared" : "table" };
  return { ...out, bytes: 4 * GB, source: "unknown" };   // an unknown card: 4 GB is a careful guess (the user can set it)
}

/* ---------------------------------------------------------------- a sample */

let last = null, peak = 0, peakAt = null, contextLost = 0, lostAt = null;
const listeners = new Set();

/**
 * Walk the GPU lists once. Returns (bytes unless said otherwise):
 *   { at, ms (what the walk cost), total, counted, estimated, budget {...}, ratio, level "ok" | "warn" | "over",
 *     layers { destruction: { bytes, n }, ..., canvas: { bytes, n: 1, est: true }, buffers: { bytes, n } },
 *     textures (count), peak, peakAt, contextLost, lostAt, unclassified }
 */
export function sample() {
  const st = begin(); if ( !st ) return last;
  if ( pending.length ) drain();
  step(st, Infinity);
  return finish(st);
}

/** A walk in parts: begin, step (some textures), finish (framebuffers, buffers, canvas, totals). */
function begin() {
  const R = canvas?.app?.renderer;
  if ( !R?.texture ) return null;
  return { R, uid: R.CONTEXT_UID, i: 0, ms: 0, maxSlice: 0, slices: 0, textures: 0, layers: Object.fromEntries(LAYERS.map((k) => [k, { bytes: 0, n: 0 }])) };
}
function step(st, maxMs) {
  const t0 = performance.now(), list = st.R.texture.managedTextures, uid = st.uid, layers = st.layers;
  for ( let k = 0; st.i < list.length; st.i++, k++ ) {
    if ( (k & 63) === 63 && performance.now() - t0 > maxMs ) break;
    const bt = list[st.i], gt = bt._glTextures?.[uid]; if ( !gt ) continue;
    const w = gt.width || 0, h = gt.height || 0; if ( !w || !h ) continue;
    let b = w * h * bytesPerTexel(gt.internalFormat, gt.type);
    if ( gt.mipmap ) b *= 4 / 3;
    if ( bt.target === 0x8513 ) b *= 6;   // cube map
    const L = layers[classify(bt)] ?? layers.foundry;
    L.bytes += b; L.n++; st.textures++;
  }
  const d = performance.now() - t0;
  st.ms += d; st.maxSlice = Math.max(st.maxSlice, d); st.slices++;
  return st.i >= list.length;
}
function finish(st) {
  const t0 = performance.now(), { R, uid, layers } = st;
  if ( pending.length ) drain();
  for ( const fb of R.framebuffer?.managedFramebuffers ?? [] ) {
    const g = fb.glFramebuffers?.[uid]; if ( !g ) continue;
    const px = (fb.width || 0) * (fb.height || 0), s = Math.max(1, g.multisample || 0);
    let b = 0;
    if ( g.stencil ) b += px * 4 * (g.msaaBuffer ? s : 1);
    if ( g.msaaBuffer ) b += px * 4 * s;
    if ( !b ) continue;
    const bt = fb.colorTextures?.[0];
    (layers[bt ? classify(bt) : "foundry"] ?? layers.foundry).bytes += b;
  }
  let buf = 0, nb = 0;
  const mb = R.buffer?.managedBuffers ?? {};
  for ( const k in mb ) { const g = mb[k]?._glBuffers?.[uid]; if ( g ) { buf += g.byteLength || 0; nb++; } }
  layers.buffers = { bytes: buf, n: nb };
  const gl = R.gl, attr = gl?.getContextAttributes?.() ?? {};
  const bw = gl?.drawingBufferWidth ?? 0, bh = gl?.drawingBufferHeight ?? 0, aa = attr.antialias ? Math.max(1, gl.getParameter(gl.SAMPLES) || 4) : 1;
  const est = bw * bh * (4 * aa + (attr.depth || attr.stencil ? 4 * aa : 0) + (aa > 1 ? 4 : 0) + 4);
  layers.canvas = { bytes: est, n: 1, est: true };
  const counted = Object.entries(layers).reduce((a, [k, v]) => a + (k === "canvas" ? 0 : v.bytes), 0), total = counted + est;
  const bud = budget(), ratio = bud.bytes ? total / bud.bytes : 0;
  if ( total > peak ) { peak = total; peakAt = Date.now(); }
  last = { at: Date.now(), ms: +(st.ms + performance.now() - t0).toFixed(2), total, counted, estimated: est, budget: bud, ratio,
    level: ratio >= OVER ? "over" : ratio >= WARN ? "warn" : "ok", layers, textures: st.textures,
    slices: st.slices, maxSliceMs: +Math.max(st.maxSlice, performance.now() - t0).toFixed(2), backing: [bw, bh], peak, peakAt, contextLost, lostAt, unclassified: pending.length };
  for ( const fn of listeners ) { try { fn(last); } catch ( err ) { console.error(`${MODULE_ID} | vram`, err); } }
  return last;
}

/** The clock's walk: idle slices of at most ~2 ms each, so 12 000 textures never make one long task. */
function sampleInParts(done) {
  const st = begin(); if ( !st ) return done();
  const go = () => { try { if ( !canvas?.ready || st.R !== canvas.app?.renderer ) return done(); if ( step(st, SLICE_MS) ) { finish(st); return done(); } } catch ( err ) { console.error(`${MODULE_ID} | vram`, err); return done(); } idle(go, 1000); };
  idle(go, 1000);
}

/** The same sample in MB (rounded), for logs and tests. */
export function summaryMB(s = last ?? sample()) {
  if ( !s ) return null;
  const mb = (b) => Math.round(b / MB);
  return { totalMB: mb(s.total), countedMB: mb(s.counted), estimatedMB: mb(s.estimated), budgetMB: mb(s.budget.bytes), budgetSource: s.budget.source,
    model: s.budget.model, pct: Math.round(s.ratio * 100), level: s.level, textures: s.textures, peakMB: mb(s.peak), contextLost: s.contextLost, sampleMs: s.ms, slices: s.slices, maxSliceMs: s.maxSliceMs,
    layersMB: Object.fromEntries(Object.entries(s.layers).map(([k, v]) => [k, mb(v.bytes)])), counts: Object.fromEntries(Object.entries(s.layers).map(([k, v]) => [k, v.n])) };
}

/* ---------------------------------------------------------------- the clock */

let timer = 0, period = 0, gen = 0;
const wanted = new Map();
/** Ask for samples every `ms` (the smallest asked wins); returns the release. */
export function want(key, ms) {
  wanted.set(key, ms); reschedule();
  return () => { wanted.delete(key); reschedule(); };
}
function reschedule() {
  const p = wanted.size ? Math.min(...wanted.values()) : 0;
  if ( p === period && (timer || !p) ) return;
  period = p; clearTimeout(timer); timer = 0; gen++;
  if ( p ) tick(gen);
}
function tick(g) {
  timer = setTimeout(() => {
    if ( g !== gen ) return;
    if ( !canvas?.ready ) return tick(g);
    sampleInParts(() => { if ( period && g === gen ) tick(g); });
  }, period);
}
/** Run `fn(sample)` after every sample; returns the release. */
export function onSample(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const lastSample = () => last;

/* ---------------------------------------------------------------- settings, events, api */

export const METER_MODES = ["auto", "always", "warn", "off"];
export function registerVramSettings() {
  game.settings.register(MODULE_ID, "vramMeter", {
    name: "MOINENMAPS.Setting.vramMeter", hint: "MOINENMAPS.Setting.vramMeterHint", scope: "client", config: true, type: String, default: "auto",
    choices: { auto: "MOINENMAPS.Setting.vramAuto", always: "MOINENMAPS.Setting.vramAlways", warn: "MOINENMAPS.Setting.vramWarn", off: "MOINENMAPS.Setting.vramOff" },
    onChange: () => Hooks.callAll("moinenMapsVram")
  });
  game.settings.register(MODULE_ID, "vramBudget", {
    name: "MOINENMAPS.Setting.vramBudget", hint: "MOINENMAPS.Setting.vramBudgetHint", scope: "client", config: true, type: Number, default: 0,
    range: { min: 0, max: 64, step: 0.5 }, onChange: () => { if ( last ) sample(); Hooks.callAll("moinenMapsVram"); }
  });
  game.settings.register(MODULE_ID, "vramMeterState", { scope: "client", config: false, type: Object, default: {} });
}

Hooks.once("canvasReady", () => {
  const view = canvas.app?.view;
  view?.addEventListener?.("webglcontextlost", () => { contextLost++; lostAt = Date.now(); budgetCache = null; Hooks.callAll("moinenMapsVram"); });
});

/** api.vram (and api.diag.vram()): read the meter from macros and tests. */
export const vramApi = {
  /** A fresh sample (bytes; see sample()). */
  sample: () => sample(),
  /** The last sample without walking again (null before the first). */
  last: () => last,
  /** A fresh sample in MB: { totalMB, countedMB, estimatedMB, budgetMB, budgetSource, model, pct, level, textures, peakMB, layersMB, counts, sampleMs }. */
  mb: () => summaryMB(sample()),
  budget: () => budget(),
  /** The biggest textures now (a walk; for diagnosis): [{ mb, w, h, layer, file, rt }]. */
  top(n = 20, layer = null) {
    const R = canvas?.app?.renderer, uid = R?.CONTEXT_UID, out = [];
    for ( const bt of R?.texture?.managedTextures ?? [] ) {
      const gt = bt._glTextures?.[uid]; if ( !gt?.width ) continue;
      const k = classify(bt); if ( layer && k !== layer ) continue;
      out.push({ mb: +(gt.width * gt.height * bytesPerTexel(gt.internalFormat, gt.type) * (gt.mipmap ? 4 / 3 : 1) / MB).toFixed(1), w: gt.width, h: gt.height, layer: k, file: bt._mmF ?? "", rt: !!bt.framebuffer });
    }
    return out.sort((a, b) => b.mb - a.mb).slice(0, n);
  },
  /** MB and texture count per file of origin (for diagnosis). */
  byFile() {
    const R = canvas?.app?.renderer, uid = R?.CONTEXT_UID, m = {};
    for ( const bt of R?.texture?.managedTextures ?? [] ) {
      const gt = bt._glTextures?.[uid]; if ( !gt?.width ) continue;
      const k = classify(bt), f = `${k}:${bt._mmF || "-"}`, e = m[f] ??= { mb: 0, n: 0 };
      e.mb += gt.width * gt.height * bytesPerTexel(gt.internalFormat, gt.type) * (gt.mipmap ? 4 / 3 : 1) / MB; e.n++;
    }
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { mb: Math.round(v.mb), n: v.n }]).sort((a, b) => b[1].mb - a[1].mb));
  },
  layerOfStack, originOfStack
};
moduleApi.vram = vramApi;
if ( moduleApi.diag ) moduleApi.diag.vram = () => summaryMB(sample());
