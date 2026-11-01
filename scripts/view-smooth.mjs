/**
 * SMOOTH VIEW: two client settings that make zooming and animation smooth on fast displays.
 *
 * 1. SMOOTH WHEEL ZOOM. Foundry zooms by 5% per wheel notch, at once, from the wheel event (a fast spin or a trackpad sends several
 *    notches per frame; each is a full canvas.pan with its hooks). Here a notch only moves a TARGET; the view glides to it in log
 *    scale (time constant TAU_MS, from the ticker's real elapsed time) with ONE pan per frame, round the view centre as before.
 *    Anything else that changes the zoom meanwhile (animatePan, a pan to a pin, another module) wins: the glide stops.
 *
 * 2. FRAME PACING. Foundry caps the canvas at 60 fps (maxFPS, unless the performance mode is Maximum). PIXI's cap on a 165 Hz display
 *    draws on every 3rd vsync four times and on the 2nd once (18 / 18 / 18 / 18 / 12 ms): animations and a zoom judder although the
 *    fps counter says ~58. "Even" keeps about the cap but draws on every k-th vsync with k fixed (165 Hz / 60 -> every 3rd: 55 fps, all
 *    frames 18.2 ms apart); "Display" draws on every vsync (165 fps); "Foundry" leaves PIXI's cap as it is. The vsync period is read
 *    from the requestAnimationFrame timestamps themselves (trimmed mean of the last 31 intervals).
 */
const MODULE_ID = "moinen-maps";   // (no import of config.mjs: the pacing rules are node-tested without Foundry)

export const TAU_MS = 55;
const get = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };

/* ------------------------------------------------------------------ frame pacing (pure parts are node-tested) */

/** Median of the vsync intervals seen (ms); null until there are enough. */
export function vsyncPeriod(intervals) {
  if ( intervals.length < 8 ) return null;
  // the mean of the middle half: as robust as a median against a missed vsync, steadier against timestamp jitter
  const s = [...intervals].sort((a, b) => a - b), m = s.slice(s.length >> 2, s.length - (s.length >> 2));
  return m.reduce((a, b) => a + b, 0) / m.length;
}

/** How many vsyncs per drawn frame: `cap` = Foundry's fps cap (0 = none), `period` = vsync ms. */
export function vsyncsPerFrame(mode, cap, period) {
  if ( mode === "display" || !cap || !period ) return 1;
  // the whole number of vsyncs nearest to the cap's frame time (165 / 60 -> 3: 55 fps; 144 -> 2: 72; 120 -> 2: 60; 75 -> 1: 75; 60 -> 1)
  return Math.max(1, Math.round((1000 / cap) / period));
}

/**
 * The gate: given the rAF timestamp, the last drawn one, the vsync period and k, draw now? Half a vsync of slack, so the jitter of
 * the timestamps never makes a frame wait one vsync more.
 */
export const due = (time, lastRun, period, k) => lastRun === null || time - lastRun >= k * period - period * 0.5;

let cap = 60, ivs = [], lastRaf = null, lastRun = null, gated = null;

/** Wrap the canvas ticker's requestAnimationFrame callback (once per ticker; Foundry makes a new app on a canvas re-draw only). */
function gate(ticker) {
  if ( !ticker || ticker._mmGate ) return;
  const orig = ticker._tick;
  ticker._mmGate = { orig };
  ticker._tick = (time) => {
    if ( lastRaf !== null ) { const d = time - lastRaf; if ( d > 2 && d < 60 ) { ivs.push(d); if ( ivs.length > 31 ) ivs.shift(); } }
    lastRaf = time;
    const mode = get("framePacing", "even"), P = vsyncPeriod(ivs);
    if ( mode !== "foundry" && P ) {
      const k = vsyncsPerFrame(mode, cap, P);
      if ( !due(time, lastRun, P, k) ) { ticker._requestId = requestAnimationFrame(ticker._tick); return; }
    }
    lastRun = time;
    orig(time);
  };
  gated = ticker;
}

/** Foundry set the ticker's cap (performance mode / max fps): remember it, and take the pacing over unless the mode is "foundry". */
export function applyPacing() {
  const t = canvas?.app?.ticker; if ( !t ) return;
  const mode = get("framePacing", "even");
  cap = canvas.performance?.fps ?? (t.maxFPS || cap);
  gate(t);
  t.maxFPS = mode === "foundry" ? cap : 0;          // PIXI's own cap off: the gate decides
}

export const pacingInfo = () => ({ mode: get("framePacing", "even"), cap, period: vsyncPeriod(ivs), k: vsyncsPerFrame(get("framePacing", "even"), cap, vsyncPeriod(ivs)), gated: !!gated?._mmGate });

/* ------------------------------------------------------------------ smooth wheel zoom */

const Z = { target: null, set: null, on: false, foreign: null };
const GLIDERS = ["ez-glide"];

function zoomStep() {
  const s = canvas.stage?.scale.x;
  if ( !canvas.ready || s === undefined || Z.target === null ) return zoomStop();
  // someone else moved the zoom (animatePan, a pan to a pin): theirs wins
  if ( Z.set !== null && Math.abs(Math.log(s / Z.set)) > 1e-4 ) return zoomStop();
  const c = Math.log(s), t = Z.target, dt = Math.min(canvas.app.ticker.deltaMS || 16, 100);
  let n = c + (t - c) * (1 - Math.exp(-dt / TAU_MS));
  if ( Math.abs(t - n) < 0.0015 ) n = t;
  canvas.pan({ scale: Math.exp(n) });
  Z.set = canvas.stage.scale.x;
  if ( n === t || Math.abs(Math.log(Z.set) - c) < 1e-6 ) zoomStop();    // reached (or held by the zoom limits)
}
function zoomStop() {
  Z.target = Z.set = null;
  if ( Z.on ) { canvas.app?.ticker?.remove(zoomStep); Z.on = false; }
}

/** The wheel handler: a notch moves the target; the ticker glides there. */
function onWheel(wrapped, event) {
  const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if ( !get("smoothZoom", true) || reduce || !canvas.app?.ticker ) return wrapped(event);
  const dz = event.delta < 0 ? 1.05 : 0.95;
  const s = canvas.stage.scale.x;
  const from = Z.target !== null && Z.set !== null && Math.abs(Math.log(s / Z.set)) < 1e-4 ? Math.exp(Z.target) : s;
  const want = canvas._constrainView({ scale: from * dz }).scale;
  Z.target = Math.log(want); Z.set = s;
  if ( !Z.on ) { canvas.app.ticker.add(zoomStep, null, PIXI.UPDATE_PRIORITY.HIGH); Z.on = true; }
}

export const zoomInfo = () => ({ ...Z, target: Z.target === null ? null : Math.exp(Z.target) });

/* ------------------------------------------------------------------ wiring */

export function registerSmoothView() {
  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "smoothZoom", { name: "MOINENMAPS.Setting.smoothZoom", hint: "MOINENMAPS.Setting.smoothZoomHint",
      scope: "client", config: true, type: Boolean, default: true, onChange: () => zoomStop() });
    game.settings.register(MODULE_ID, "framePacing", { name: "MOINENMAPS.Setting.framePacing", hint: "MOINENMAPS.Setting.framePacingHint",
      scope: "client", config: true, type: String, default: "even",
      choices: { even: "MOINENMAPS.Setting.framePacingEven", display: "MOINENMAPS.Setting.framePacingDisplay", foundry: "MOINENMAPS.Setting.framePacingFoundry" },
      onChange: () => { if ( canvas?.app ) { const t = canvas.app.ticker; t.maxFPS = cap; applyPacing(); } } });
    const C = foundry.canvas.Canvas, lw = game.modules.get("lib-wrapper")?.active ? globalThis.libWrapper : null;
    // a module that already glides the wheel zoom (EZGlide overrides the same handler) keeps it: two glides would fight
    if ( GLIDERS.some((id) => game.modules.get(id)?.active) ) Z.foreign = GLIDERS.find((id) => game.modules.get(id)?.active);
    else if ( lw ) lw.register(MODULE_ID, "foundry.canvas.Canvas.prototype._onMouseWheel", onWheel, "MIXED");
    else { const o = C.prototype._onMouseWheel; C.prototype._onMouseWheel = function(event) { return onWheel((e) => o.call(this, e), event); }; }
    // Foundry sets the cap again whenever the performance settings apply
    const pm = C.prototype._configurePerformanceMode;
    C.prototype._configurePerformanceMode = function(...a) { const r = pm.apply(this, a); applyPacing(); return r; };
  });
  Hooks.on("canvasInit", () => { zoomStop(); applyPacing(); });
  Hooks.on("canvasReady", () => applyPacing());
  Hooks.on("canvasTearDown", () => zoomStop());
}
