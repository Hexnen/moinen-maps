/**
 * CINEMATIC SCREEN EFFECTS, the engine without Foundry (node-testable: dev/cinematic-fx.test.mjs). cinematic-fx.mjs supplies the real
 * environment (document, canvas stage, ticker, animatePan, client settings); the tests supply a fake one.
 *
 * Elements (each can be off; the master `fx` switch and the client's opt-outs come through cinematic-core effective()):
 *   letterbox bars + vignette + flash: three DOM overlays under one root (pointer-events none), animated by CSS transitions;
 *   shake: ONE offset of the stage position, put on and taken off exactly (StageShaker); it never accumulates;
 *   slow motion: the entry speed of the display (look.speed) is scaled for the window, then restored;
 *   camera: canvas.animatePan only (so the static cache sees ordinary scale changes), aborted at once by the player's input.
 * Idle cost is zero: nothing exists until begin() and nothing remains after end().
 *
 * This is the DIRECTOR's one screen engine: the destruction show (begin/impact/end with the stroke list) and the director's shots
 * (begin with { owner: "director", guard: false, opts }, then panTo / impact / end({ backMs })) share it, so two of them can never
 * fight over the camera: a new begin() ends the session before at once and takes over its HOME view (where the player had the camera
 * before the first of them), so the return always goes back to the player's own view.
 */
import * as Cin from "../destruction/cinematic-core.mjs";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const EASE_CSS = { linear: "linear", out: "cubic-bezier(0.16, 0.8, 0.3, 1)", inout: "cubic-bezier(0.65, 0, 0.35, 1)" };
export function hexRgb(h) { const n = parseInt(String(h).slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
/**
 * The element's styles brought up to date WITHOUT a layout pass, so a transition set next starts from the style it has now. A read of
 * offsetWidth did the same plus a forced layout of the whole page - in the middle of a camera frame, whose writes (the HUD, the
 * markers) dirty the layout again, so the frame paid a second one. getComputedStyle(el).opacity is not layout-dependent: Chrome and
 * Firefox recalc the styles only. (Node tests: no getComputedStyle, the old read.)
 */
export function restyle(el) {
  const v = el?.ownerDocument?.defaultView;
  if ( typeof v?.getComputedStyle === "function" ) void v.getComputedStyle(el).opacity;
  else void el?.offsetWidth;
}
/** The camera easing 0..1: 0 linear, 1 a full smoothstep (animatePan's `easing` is a function of progress). */
export const camEasing = (e) => (t) => { const s = t * t * (3 - 2 * t); return t + (s - t) * clamp(e, 0, 1); };

/* ---------------------------------------------------------------- the shake: one offset of the stage position */

/**
 * Applies an offset on top of `stage.position` and takes it off again EXACTLY. If something else (a pan) rewrote the position since our
 * last write, that value is the new base (nothing of ours is subtracted from it); otherwise the base is the position minus our offset.
 */
export class StageShaker {
  constructor(stage) { this.stage = stage; this.ax = 0; this.ay = 0; this.lx = null; this.ly = null; }
  get offset() { return [this.ax, this.ay]; }
  apply(ox, oy) {
    const p = this.stage.position;
    let bx = p.x, by = p.y;
    if ( this.lx !== null && p.x === this.lx && p.y === this.ly ) { bx -= this.ax; by -= this.ay; }
    this.ax = ox; this.ay = oy;
    p.set(bx + ox, by + oy);
    this.lx = p.x; this.ly = p.y;
  }
  restore() { if ( this.lx === null ) return; this.apply(0, 0); this.lx = this.ly = null; this.ax = this.ay = 0; }
}

/* ---------------------------------------------------------------- the overlays */

/**
 * The overlay root with the vignette, the flash and the bars, built from the resolved settings `r` and the effective flags `eff`.
 * `doc` is a document (or a fake with createElement); `insert(el)` puts the root into the page; `timer(fn, ms)` returns a cancel function.
 */
export function createOverlays(doc, r, eff, { insert, timer }) {
  const mk = (css) => { const el = doc.createElement("div"); Object.assign(el.style, css); return el; };
  const root = mk({ position: "fixed", inset: "0", pointerEvents: "none", overflow: "hidden", zIndex: "1" });   // (z-index 1: Foundry's #board canvas is positioned with z-index 0 and LATER in the DOM, so an auto-z root sat BEHIND it; the interface regions are z-index 30)
  root.className = "mm-cin"; root.setAttribute?.("data-mm-cin", "");
  const ease = EASE_CSS[r.lbEase] ?? EASE_CSS.inout;
  const o = { root, bars: null, vignette: null, flashEl: null, timers: [], hidden: false };
  if ( eff.vignette ) {
    const [R, G, B] = hexRgb(r.vgTint), inner = Math.round(r.vgRadius * 72);
    o.vignette = mk({ position: "absolute", inset: "0", opacity: "0", background: `radial-gradient(ellipse farthest-corner at 50% 50%, rgba(${R},${G},${B},0) ${inner}%, rgba(${R},${G},${B},${r.vgStrength}) 100%)`, transition: `opacity ${r.lbIn}ms ${ease}` });
    root.appendChild(o.vignette);
  }
  if ( eff.flash ) {
    o.flashEl = mk({ position: "absolute", inset: "0", opacity: "0", background: r.flColor });
    root.appendChild(o.flashEl);
  }
  if ( eff.letterbox ) {
    const bar = (top) => mk({ position: "absolute", left: "0", right: "0", [top ? "top" : "bottom"]: "0", height: `${r.lbHeight}%`, background: r.lbColor, opacity: String(r.lbAlpha),
      transform: `translateY(${top ? "-100%" : "100%"})`, transition: `transform ${r.lbIn}ms ${ease}`, willChange: "transform" });
    o.bars = [bar(true), bar(false)];
    for ( const b of o.bars ) root.appendChild(b);
  }
  insert(root);
  o.show = () => {
    restyle(root);                               // (the styles of the hidden state first, so the transition runs from it)
    for ( const b of o.bars ?? [] ) b.style.transform = "translateY(0)";
    if ( o.vignette ) o.vignette.style.opacity = "1";
  };
  /** Shown at once, no slide-in (a session that takes over from one whose bars were already in). */
  o.showNow = () => {
    const all = [...(o.bars ?? []), o.vignette].filter(Boolean), was = all.map((el) => el.style.transition);
    for ( const el of all ) el.style.transition = "none";
    o.show();
    restyle(root);
    all.forEach((el, i) => { el.style.transition = was[i]; });
  };
  o.hide = () => {
    o.hidden = true;
    for ( const [i, b] of (o.bars ?? []).entries() ) { b.style.transition = `transform ${r.lbOut}ms ${ease}`; b.style.transform = `translateY(${i === 0 ? "-100%" : "100%"})`; }
    if ( o.vignette ) { o.vignette.style.transition = `opacity ${r.lbOut}ms ${ease}`; o.vignette.style.opacity = "0"; }
  };
  /** One flash of `k` (0..1) of the configured intensity. */
  o.flash = (k = 1) => {
    const f = o.flashEl; if ( !f ) return;
    f.style.transition = "none"; f.style.opacity = String(clamp(r.flIntensity * k, 0, 1));
    restyle(f);
    f.style.transition = `opacity ${r.flDur}ms ease-out`; f.style.opacity = "0";
  };
  o.destroy = () => { try { root.remove(); } catch { /* already gone */ } o.bars = o.vignette = o.flashEl = null; };
  return o;
}

/* ---------------------------------------------------------------- the camera */

/**
 * The legs of the camera for one impact: stops along the stroke's path (cameraPath with the lead), the zoom from the hit's size inside the
 * configured range and the safety band. `view` = { scale (the zoom the show began at), vw, vh (screen px) }. `size` in art px.
 * Each leg: { x, y, scale, at (ms after the impact), duration (ms) }.
 */
export function planLegs(stroke, impact, r, view) {
  const rel = lerp(r.camZoomMin, r.camZoomMax, clamp((impact.size ?? 0) / 200, 0, 1));
  const scale = Cin.clampZoom(view.scale * rel, view.scale);
  const p = stroke?.p;
  if ( !p || p.length < 6 ) return [{ x: impact.x, y: impact.y, scale, at: 0, duration: 600 }];
  const D = clamp(p[p.length - 1] || Cin.pathLength(p) * 6, 350, 2200), seeW = view.vw / scale;
  const n = clamp(Math.round(Cin.pathLength(p) / Math.max(1, seeW * 0.6)) + 1, 1, 6);
  return Cin.cameraPath(p, n, r.camLead).map(([x, y], k) => ({ x, y, scale, at: Math.round(D * k / n), duration: clamp(Math.round(D / n * 1.1), 250, 900) }));
}
/** The "frame the whole thing" camera: one stop covering the art box `box`, the zoom relative to the starting one, kept in the band. */
export function planFrame(box, view, r) {
  const f = Cin.frameBox(box, view.vw / view.scale, view.vh / view.scale, r);
  return { x: f.x, y: f.y, scale: Cin.clampZoom(view.scale * f.zoom, view.scale), at: 0, duration: 900 };
}
export function boxOf(strokes, bounds) {
  if ( bounds && Number.isFinite(bounds.x0) && Number.isFinite(bounds.x1) ) return bounds;
  let b = null;
  for ( const s of strokes ?? [] ) for ( let i = 0; s?.p && i + 1 < s.p.length; i += 3 ) {
    const x = s.p[i], y = s.p[i + 1]; b = b ? { x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
  }
  return b;
}

/**
 * Listens for the player taking the camera: wheel and pointerdown on the canvas element, a key (a lone modifier does not count) on the
 * window. `onAbort(kind)` runs once; detach() removes every listener.
 */
export class AbortGuard {
  constructor(canvasEl, win, onAbort) { this.canvasEl = canvasEl; this.win = win; this.onAbort = onAbort; this.done = false; this.on = null; }
  attach() {
    this.on = (ev) => {
      if ( ev.type === "keydown" && /^(Shift|Control|Alt|Meta|AltGraph|CapsLock)$/.test(ev.key ?? "") ) return;
      if ( this.done ) return;
      this.done = true; this.onAbort(ev.type);
    };
    this.canvasEl?.addEventListener("wheel", this.on, { passive: true, capture: true });
    this.canvasEl?.addEventListener("pointerdown", this.on, true);
    this.win?.addEventListener("keydown", this.on, true);
  }
  detach() {
    if ( !this.on ) return;
    this.canvasEl?.removeEventListener("wheel", this.on, true);
    this.canvasEl?.removeEventListener("pointerdown", this.on, true);
    this.win?.removeEventListener("keydown", this.on, true);
    this.on = null;
  }
}

/* ---------------------------------------------------------------- the show's screen effects */

/**
 * The engine. `getEnv()` -> {
 *   doc, insert(el), timer(fn, ms) -> cancel, now(), stage, ticker { add(fn), remove(fn) }, pan(view) -> Promise, stopPan(),
 *   view() -> { x, y, scale, vw, vh }, canvasEl, win, display() -> { look: { speed } } | null, opts() -> client opt-outs, centre() -> { x, y } }
 */
export function createFx(getEnv) {
  let S = null;

  const frameMs = (s) => Math.max(0, ...s.frames);

  function begin(snap, { strokes = [], bounds = null, owner = "show", guard = true, opts = null, home = null, frame = true, barsLater = false } = {}) {
    // (the session before ends at once; its home view - the player's own - is the one this session returns to)
    const inherit = S?.cam?.on && S.prev ? { ...S.prev } : null;
    const barsIn = !!(S && !S.ending && S.ov && !S.ov.hidden && !S.ov.held && (S.ov.bars || S.ov.vignette));   // (the bars stay put: no out-and-in again)
    if ( S ) finish(S);
    const raw = snap?.r ?? snap;
    if ( !raw || typeof raw !== "object" ) return false;
    const env = getEnv(), r = { ...Cin.DEFAULTS, ...Cin.cleanPartial(raw) };
    if ( r.camZoomMax < r.camZoomMin ) r.camZoomMax = r.camZoomMin;
    const eff = Cin.effective(r, { ...(env.opts?.() ?? {}), ...(opts ?? {}) });
    const s = S = { env, r, eff, strokes: strokes ?? [], bounds, n: 0, cancels: [], timers: new Set(), frames: [], last: null, shake: null, slow: null, cam: null,
      shaker: null, ov: null, guard: null, tick: null, prev: null, ending: null, endRes: null, preview: false, lastImpact: null, done: false, onDone: [], owner, useGuard: guard !== false, frame };
    try {
      s.ov = createOverlays(env.doc, r, eff, { insert: env.insert, timer: env.timer });
      if ( barsIn ) s.ov.showNow(); else if ( barsLater ) s.ov.held = true; else s.ov.show();   // (barsLater: they wait for revealBars())
      if ( eff.shake ) s.shaker = new StageShaker(env.stage);
      if ( eff.camera ) startCamera(s, home ?? inherit);
      s.tick = () => onTick(s);
      env.ticker.add(s.tick);
    } catch ( err ) { console.error("moinen-maps | cinematic fx begin", err); finish(s); return false; }
    return true;
  }

  function startCamera(s, home = null) {
    const v = s.env.view();
    s.prev = home ? { x: home.x, y: home.y, scale: home.scale } : { x: v.x, y: v.y, scale: v.scale };
    if ( s.useGuard ) { s.guard = new AbortGuard(s.env.canvasEl, s.env.win, (kind) => abortCamera(s, kind)); s.guard.attach(); }
    s.cam = { on: true, view: home ? { ...v, x: home.x, y: home.y, scale: home.scale } : v };
    if ( s.r.camMode === "frame" && s.frame ) {
      const box = boxOf(s.strokes, s.bounds);
      if ( box ) pan(s, planFrame(box, v, s.r));
    }
  }
  function abortCamera(s, kind) {
    if ( !s.cam?.on ) return;
    s.cam.on = false; s.cam.aborted = kind || true; s.prev = null;
    try { s.env.stopPan?.(); } catch { /* nothing animating */ }
    s.guard?.detach();
  }
  function pan(s, leg) {
    if ( !s.cam?.on ) return;
    const dur = Cin.moveDuration(leg.duration, frameMs(s));
    try { Promise.resolve(s.env.pan({ x: leg.x, y: leg.y, scale: leg.scale, duration: dur, easing: camEasing(s.r.camEase) })).catch(() => {}); } catch ( err ) { console.error(err); }
  }
  const later = (s, fn, ms) => {
    if ( ms <= 0 ) { fn(); return null; }
    const c = s.env.timer(() => { s.timers.delete(c); if ( !s.done ) { try { fn(); } catch ( err ) { console.error("moinen-maps | cinematic fx", err); finish(s); } } }, ms);
    s.timers.add(c);
    return c;
  };
  /** The legs of the stroke before that have not run yet are dropped when the camera sets off for the next one (they would pull it back). */
  const dropLegs = (s) => { for ( const c of s.legTimers ?? [] ) { s.timers.delete(c); try { c(); } catch { /* already fired */ } } s.legTimers = []; };

  /**
   * The camera sets off for a stroke `camAhead` ms before its impact (cinematic.mjs calls this then), so it is there when the hit lands:
   * the first leg only, shortened to fit; impact() plays the rest. Follow mode only; the impact alone behaves as before when this is not called.
   */
  function anticipate({ x, y, size = 0, id } = {}) {
    const s = S; if ( !s || s.ending || !id || !s.cam?.on || s.r.camMode !== "follow" || !(s.r.camAhead > 0) ) return;
    const stroke = s.strokes.find((o) => o.id === id), leg = planLegs(stroke, { x, y, size }, s.r, s.cam.view)[0];
    if ( !leg ) return;
    dropLegs(s);
    (s.ahead ??= new Set()).add(id);
    pan(s, { ...leg, duration: Math.min(leg.duration, s.r.camAhead + 150) });
  }

  /** One impact (art px; size = the hit's extent): flash, shake, slow motion and the camera legs of the stroke. */
  function impact({ x, y, size = 0, t, id, dir } = {}) {
    const s = S; if ( !s || s.ending ) return;
    const r = s.r, now = s.env.now(), stroke = (id && s.strokes.find((o) => o.id === id)) ?? s.strokes[s.n];
    s.n++;
    const big = size >= r.smThreshold, k = big ? 1 : 0.55;
    let d = dir;
    if ( !d ) { const p = stroke?.p; d = p && p.length >= 6 ? [p[p.length - 3] - p[0], p[p.length - 2] - p[1]] : s.lastImpact ? [x - s.lastImpact.x, y - s.lastImpact.y] : [0, 0]; }
    s.lastImpact = { x, y };
    if ( s.eff.flash ) s.ov?.flash(k);
    if ( s.eff.shake ) s.shake = { t0: now, r: { ...r, shIntensity: r.shIntensity * k }, dir: d };
    if ( s.eff.slowmo && big ) {
      const display = s.env.display?.();
      if ( display?.look ) {
        if ( !s.slow ) s.slow = { base: display.look.speed ?? 1, set: null, display };
        s.slow.t0 = now + r.smIn; s.slow.hold = 400;
        s.slow.end = s.slow.t0 + s.slow.hold + r.smOut;
      }
    }
    if ( s.cam?.on && r.camMode === "follow" ) {
      const early = !!id && !!s.ahead?.delete(id);
      if ( !early ) dropLegs(s);
      (s.legTimers ??= []);
      for ( const [i, leg] of planLegs(stroke, { x, y, size }, r, s.cam.view).entries() ) {
        if ( early && i === 0 ) continue;                  // (already under way: anticipate)
        const c = later(s, () => pan(s, leg), leg.at); if ( c ) s.legTimers.push(c);
      }
    }
  }

  function onTick(s) {
    if ( S !== s || s.done ) return;
    try {
      const now = s.env.now();
      if ( s.last !== null ) { s.frames.push(now - s.last); if ( s.frames.length > 8 ) s.frames.shift(); }
      s.last = now;
      if ( s.shaker ) {
        if ( s.shake ) {
          const [x, y] = Cin.shakeAt(now - s.shake.t0, s.shake.r, s.shake.dir, true);
          s.shaker.apply(x, y);
          if ( now - s.shake.t0 > 2200 ) { s.shake = null; s.shaker.apply(0, 0); }
        } else if ( s.shaker.ax || s.shaker.ay ) s.shaker.apply(0, 0);
      }
      if ( s.slow && s.slow.set !== null && s.slow.display.look.speed !== s.slow.set ) s.slow = null;     // someone else changed the speed: theirs stays
      if ( s.slow ) {
        const f = Cin.slowAt(now, s.slow.t0, s.slow.hold, s.r, true);
        if ( now >= s.slow.end ) endSlow(s); else { s.slow.set = Math.max(0.05, s.slow.base * f); s.slow.display.look.speed = s.slow.set; }
      }
    } catch ( err ) { console.error("moinen-maps | cinematic fx tick", err); finish(s); }
  }
  /** Back to the entry speed from before; if someone else changed it meanwhile, theirs stays. */
  function endSlow(s) {
    const w = s.slow; if ( !w ) return;
    s.slow = null;
    if ( w.set === null || w.display.look.speed === w.set ) w.display.look.speed = w.base;
  }

  /** Graceful end: hold the last frame (camera), bars and view go back, then everything is removed. `{ immediate: true }`: at once. */
  function end({ immediate = false, backMs = null, hold: holdMs = null } = {}) {
    const s = S; if ( !s ) return Promise.resolve();
    if ( s.ending ) return s.ending;
    if ( immediate || s.done ) { finish(s); return Promise.resolve(); }
    s.ending = new Promise((res) => { s.endRes = res; });
    const r = backMs !== null ? { ...s.r, camReturn: backMs, lbOut: Math.min(s.r.lbOut, Math.max(150, backMs)) } : s.r, camBack = !!(s.cam?.on && s.prev), hold = camBack ? (holdMs ?? r.camHold) : 0;
    later(s, () => {
      const outMs = s.ov?.bars || s.ov?.vignette ? r.lbOut : 0;
      let back = Promise.resolve();
      if ( camBack ) {
        // (the view goes back through animatePan, whose clock is the ticker's: on a slow machine it runs slower than the wall clock, so
        // the end waits for the move itself - with a generous cap - instead of cutting it off)
        const dur = Cin.moveDuration(r.camReturn, frameMs(s));
        try { back = Promise.race([Promise.resolve(s.env.pan({ ...s.prev, duration: dur, easing: camEasing(r.camEase) })).catch(() => {}), new Promise((res) => later(s, res, dur * 4 + 1500))]); } catch ( err ) { console.error(err); }
      }
      s.graceful = true;
      s.ov?.hide();
      s.onDone.push(() => {});
      Promise.all([back, new Promise((res) => later(s, res, outMs + 60))]).then(() => { if ( !s.done ) finish(s); });
    }, hold);
    return s.ending;
  }

  /** Remove everything, whatever state it is in (idempotent; each step guarded so one failure cannot leave the others behind). */
  function finish(s) {
    if ( s.done ) return;
    s.done = true;
    if ( S === s ) S = null;
    const step = (fn) => { try { fn(); } catch ( err ) { console.error("moinen-maps | cinematic fx cleanup", err); } };
    for ( const c of s.timers ) step(c);
    s.timers.clear();
    step(() => s.env.ticker.remove(s.tick));
    step(() => s.shaker?.restore());
    step(() => s.guard?.detach());
    step(() => { if ( s.cam?.on && !s.graceful ) s.env.stopPan?.(); });          // (a graceful end lets the return move finish)
    step(() => endSlow(s));
    step(() => s.ov?.destroy());
    step(() => s.endRes?.());
    for ( const f of s.onDone ) step(f);
  }

  /** The full effects on a throwaway impact at the screen centre; no strokes, no flags. Resolves when everything is gone again. */
  async function preview(settings) {
    if ( S ) return false;
    const env = getEnv(), c = env.centre(), raw = settings?.r ?? settings;
    const r = { ...Cin.DEFAULTS, ...Cin.cleanPartial(raw) };
    const size = Math.max(r.smThreshold * 2, 120);
    if ( !begin(r, { strokes: [], bounds: { x0: c.x - size, y0: c.y - size, x1: c.x + size, y1: c.y + size } }) ) return false;
    const s = S; s.preview = true;
    const sleep = (ms) => new Promise((res) => { s.onDone.push(res); later(s, res, ms); });
    await sleep(clamp(r.pauseBefore, 150, 600));
    if ( S !== s ) return true;
    impact({ x: c.x, y: c.y, size });
    await sleep(900);
    if ( S !== s ) return true;
    await end();
    return true;
  }

  return {
    begin, impact, anticipate, end, preview,
    /** Everything gone at once (scene change, error, an explicit stop). */
    abort: () => { if ( S ) finish(S); },
    get active() { return !!S; },
    /** Who began the session on screen: "show" (the destruction show), "director" (a director shot), null. */
    get owner() { return S?.owner ?? null; },
    /** The view the session returns to (the player's own), or null. */
    get home() { return S?.cam?.on && S.prev ? { ...S.prev } : null; },
    /** A camera move of the session (scene px centre, absolute scale, ms); nothing when the camera is off or was taken by the player. */
    panTo: (leg) => { if ( S && !S.ending ) pan(S, { duration: 800, ...leg }); },
    /** Bars + vignette of a session begun with { barsLater } slide in now (once). */
    revealBars: () => { const o = S?.ov; if ( o?.held && !S.ending ) { o.held = false; o.show(); } },
    /** The player took the camera: it stays where it is, the session goes on without it (no return). */
    stopCamera: (kind = "player") => { if ( S ) abortCamera(S, kind); },
    /** The slow-motion factor in force now (1 = none). */
    get rate() { const w = S?.slow; return w?.set != null && w.base ? w.set / w.base : 1; },
    /** For checks: what is on screen and in effect. */
    debug: () => S && ({ eff: S.eff, bars: !!S.ov?.bars && !S.ov.held, vignette: !!S.ov?.vignette, flash: !!S.ov?.flashEl, shake: S.shaker?.offset ?? null, shaking: !!S.shake, cameraOn: !!S.cam?.on, cameraAborted: !!S.cam?.aborted, abortedBy: S.cam?.aborted ?? null,
      slow: !!S.slow, ending: !!S.ending, preview: S.preview, impacts: S.n, root: S.ov?.root ?? null, timers: S.timers.size })
  };
}
