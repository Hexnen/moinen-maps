/* LETR impact frames: the player and the API (L.impact). A few full-force drawings at the instant of a hit, over the scene (or over
   the whole interface), on the engine's 24-tick clock; README.md in this folder is the manual.

     const L = await letters(), I = L.impact;
     I.play({ kind: "crit", subject: token, dir: 20, magnitude: 1.6, seed: "roll:abc", startAt });

   How it is drawn: one fixed layer; the scene behind is changed by a backdrop filter (hard black and white, inverted, split), the
   ink (stars, lines, silhouettes, halftone, splashes) is painted ahead of time on 2D canvases, one per drawing, and a drawing change
   only swaps which canvas shows. Nothing of Foundry's is kept changed: the frame punch (a shove of the board element) and the
   hit-stop (the canvas ticker held) are undone at the last drawing, by a watchdog timer too. */
import { planImpact, safety, frameAt, punchAt, localRadius, pick, modeFor, TICK, LIMITS, FRAMES, FRAME_IDS, KINDS, KIND_IDS, TONES, STEP_AT, SERIES_STEP, SERIES_MAX } from "./plan.mjs";
import { paintFrame, backClip } from "./draw.mjs";

const NS = "moinen-letters", KEY = "impact", MODES = ["full", "local", "off"];
const MAX_PIX = 2.2e6;        // backing pixels of one drawing (a 4K screen is painted at about 1080p: ink is flat, nobody sees it in 40 ms)
const now = () => performance.now();
const BACK = {
  bw: "grayscale(1) brightness(1.3) contrast(60)",
  bwinv: "grayscale(1) brightness(1.3) contrast(60) invert(1)",
  split: "grayscale(1) brightness(1.3) contrast(60) invert(1)",
  chroma: "url(#moinen-impact-chroma)"
};

export function createImpact(L, tools = null) {
  const stats = { played: 0, paintMs: 0, paintMax: 0, painted: 0, showMax: 0, frameMax: 0, last: null };
  const roots = new Map();
  /* FIN-ENGINE: the impacts alive (playing or waiting for their shared start). One AT A TIME means: no two whose time windows overlap; a
     series planned ahead (blows 1.7 s apart, all called at once) plays every blow (before, each new call replaced the waiting one) */
  const lives = new Set();
  let seq = 0, localMode = "full", stopHeld = false, chromaOk = null;

  /* ---------- preferences ---------- */
  function ensureSetting() {
    try { const S = globalThis.game?.settings; if ( S?.settings && !S.settings.has(`${NS}.${KEY}`) ) S.register(NS, KEY, { scope: "client", config: false, type: String, default: "full" }); return !!S?.settings; } catch { return false; }
  }
  const mode = () => { let v = localMode; try { if ( ensureSetting() ) v = game.settings.get(NS, KEY); } catch {} return MODES.includes(v) ? v : "full"; };
  async function setMode(v) { if ( !MODES.includes(v) ) return mode(); localMode = v; try { if ( ensureSetting() ) await game.settings.set(NS, KEY, v); } catch {} return v; }
  const prefs = () => ({ enabled: true, motion: "auto", flashes: true, photosafe: true, ...(L?.prefs ?? {}), impact: mode() });
  const osReduced = () => { try { return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  const flashLog = () => tools?.state?.flashLog ?? (createImpact._log ??= []);

  /* ---------- the subject: where the blow lands on this client's screen ---------- */
  const isTokenRef = (a) => !!a && (typeof a === "string" || a.document?.documentName === "Token" || a.documentName === "Token");
  const tokenObj = (a) => { const t = typeof a === "string" ? globalThis.canvas?.tokens?.get?.(a) : a?.documentName === "Token" ? a.object : a; return t && !t.destroyed && t.center && t.document ? t : null; };
  const drawable = (s) => !!s && ["HTMLImageElement", "HTMLCanvasElement", "ImageBitmap", "HTMLVideoElement", "OffscreenCanvas"].some((n) => globalThis[n] && s instanceof globalThis[n]);
  const boardRect = () => { try { return canvas.app.view.getBoundingClientRect(); } catch { return { left: 0, top: 0 }; } };
  const toClient = (p) => { const g = canvas.stage.toGlobal(p), r = boardRect(); return { x: r.left + g.x, y: r.top + g.y }; };
  function silOf(src, frame, w, h, rot = 0) {
    if ( !drawable(src) ) return null;
    const sw = frame?.width ?? src.videoWidth ?? src.naturalWidth ?? src.width, sh = frame?.height ?? src.videoHeight ?? src.naturalHeight ?? src.height;
    if ( !(sw > 0 && sh > 0 && w > 0 && h > 0) ) return null;
    return { src, sx: frame?.x ?? 0, sy: frame?.y ?? 0, sw, sh, w, h, rot };
  }
  /* may this user see that token? (the same rule for the struck token and for the attacker a `from` names) */
  const seesToken = (t, spec) => spec.vision === "none" || (!!t.visible && !(t.document.hidden && !globalThis.game?.user?.isGM));
  /* -> { cx, cy, R, sil, hidden } in client px */
  function subjectOf(spec) {
    const a = spec.subject ?? spec.at, W = innerWidth, H = innerHeight;
    const zoom = globalThis.canvas?.stage?.scale?.x || 1;
    if ( isTokenRef(a) ) {
      const t = tokenObj(a);
      if ( !t || !globalThis.canvas?.ready ) return { hidden: true };
      if ( !seesToken(t, spec) ) return { hidden: true };
      const c = toClient(t.center), m = t.mesh;
      const w = Math.abs(m?.width ?? t.w ?? 100) * zoom, h = Math.abs(m?.height ?? t.h ?? 100) * zoom;
      const tex = m?.texture;
      return { cx: c.x, cy: c.y, R: Math.max(w, h) / 2, sil: silOf(tex?.baseTexture?.resource?.source, tex?.frame, w, h, m?.rotation ?? 0) };
    }
    if ( a && typeof a.getBoundingClientRect === "function" ) {
      const r = a.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, R: Math.max(r.width, r.height) / 2, sil: silOf(a, null, r.width, r.height) };
    }
    if ( a && (a.box || a.sprite) && a.finished ) {   // a LETR word (its handle)
      try {
        if ( a.sprite && !a.sprite.destroyed ) { const b = a.sprite.getBounds(), r = boardRect(); return { cx: r.left + b.x + b.width / 2, cy: r.top + b.y + b.height / 2, R: Math.max(b.width, b.height) / 2, sil: silOf(a.shown?.canvas, null, b.width, b.height) }; }
        const cv = a.box?.firstElementChild ?? a.box, r = cv.getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, R: Math.max(r.width, r.height) / 2, sil: silOf(cv, null, r.width, r.height) };
      } catch { /* falls through to the middle of the view */ }
    }
    if ( a && Number.isFinite(a.x) && Number.isFinite(a.y) ) {
      const world = spec.space === "world" && globalThis.canvas?.ready;
      const k = world ? zoom : 1;
      const w = Number.isFinite(a.w) ? a.w : 0, h = Number.isFinite(a.h) ? a.h : 0;
      const c = world ? toClient({ x: a.x + w / 2, y: a.y + h / 2 }) : { x: a.x + w / 2, y: a.y + h / 2 };
      const R = (Number.isFinite(spec.area) ? spec.area : Number.isFinite(a.radius) ? a.radius : Math.max(w, h) / 2) * k;
      return { cx: c.x, cy: c.y, R, sil: null };
    }
    return { cx: W / 2, cy: H * 0.45, R: 0, sil: null };
  }
  function envOf(spec, plan, sub) {
    const W = innerWidth, H = innerHeight, m = Math.min(W, H) * 0.04;
    const cx = Math.max(m, Math.min(W - m, sub.cx)), cy = Math.max(m, Math.min(H - m, sub.cy));
    const R = Math.min(sub.R || 0, Math.min(W, H) * 0.45);
    let dir = plan.dir;
    const from = spec.from;
    if ( dir == null && from ) {   // the blow comes from a token or a point: its direction on THIS screen
      try {
        /* a token this user cannot see gives no direction (it would tell where it stands): the blow is then radial */
        const ft = isTokenRef(from) ? tokenObj(from) : null;
        const p = isTokenRef(from) ? (ft && seesToken(ft, spec) ? toClient(ft.center) : null) : (spec.space === "world" && globalThis.canvas?.ready ? toClient(from) : from);
        if ( p && Number.isFinite(p.x) && Math.hypot(sub.cx - p.x, sub.cy - p.y) > 1 ) dir = Math.atan2(sub.cy - p.y, sub.cx - p.x);
      } catch {}
    }
    const e = { W, H, cx, cy, R, dir, mag: plan.magnitude, step: plan.step, kind: plan.kind, tone: plan.tone, sil: sub.sil, redOk: prefs().photosafe === false,
      /* the gentle panel: round the subject, sized from it (FIN-ENGINE FXIT-E2: a far-zoom token gets a panel of a few token widths) */
      local: plan.mode === "full" ? null : { r: Math.min(localRadius(W, H), Math.max(R * 2.6, R > 0 ? Math.min(Math.min(W, H) * 0.2, Math.max(R * 6, Math.min(W, H) * 0.06)) : Math.min(W, H) * 0.2)) },
      chromaBack: chromaOk !== false,
      /* pictures are painted once and shown once: a software canvas keeps the whole cost inside paint() (a GPU canvas defers the
         tessellation of thousands of halftone dots to the frame that first shows it: measured as a stall of several hundred ms) */
      makeCanvas: (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; },
      ctx2d: (c) => c.getContext("2d", { willReadFrequently: true }) };
    /* where the blow lands: on the struck figure's rim on the side it comes from; the weak steps put it right on the rim (the figure
       stays in sight), a figure struck from nowhere in particular gets its rim spot from the seed */
    const rim = sub.sil && plan.step <= 2 ? (plan.step <= 1 ? 0.95 : 0.85) : 0.7;
    const ha = dir != null ? dir : (sub.sil && plan.step <= 2 ? -Math.PI * (0.2 + ((plan.seed >>> 3) % 60) / 100) : null);
    e.hx = ha != null ? cx - Math.cos(ha) * R * rim : cx; e.hy = ha != null ? cy - Math.sin(ha) * R * rim : cy;
    return e;
  }

  /* ---------- the layer ---------- */
  function rootFor(over, z) {
    const key = over === "ui" ? "ui" : "scene";
    let el = roots.get(key);
    if ( !el?.isConnected ) {
      el = document.createElement("div");
      el.id = `moinen-impact-${key}`;
      el.setAttribute("aria-hidden", "true");
      Object.assign(el.style, { position: "fixed", inset: "0", pointerEvents: "none", overflow: "hidden", contain: "strict", isolation: "isolate" });
      document.body.appendChild(el);
      roots.set(key, el);
    }
    /* scene: over the map, under the bars and windows (one under the lettering's `hud` layer); ui: over every window, one under
       the lettering's `screen` layer, so a word on that layer stays readable on top of the frame */
    const top = Number(globalThis.foundry?.applications?.api?.ApplicationV2?._maxZ) || 0;
    el.style.zIndex = String(Number.isFinite(z) ? z : key === "ui" ? Math.min(9989, Math.max(999, top)) : 4);
    return el;
  }
  function chromaFilter(dx, dy) {
    let svg = document.getElementById("moinen-impact-svg");
    if ( !svg ) {
      const ns = "http://www.w3.org/2000/svg";
      svg = document.createElementNS(ns, "svg");
      svg.id = "moinen-impact-svg"; svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.setAttribute("aria-hidden", "true");
      Object.assign(svg.style, { position: "fixed", left: "0", top: "0", pointerEvents: "none" });
      svg.innerHTML = `<filter id="moinen-impact-chroma" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
<feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/><feOffset in="r" dx="0" dy="0" result="ro"/>
<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gb"/><feOffset in="gb" dx="0" dy="0" result="gbo"/>
<feBlend in="ro" in2="gbo" mode="screen"/></filter>`;
      document.body.appendChild(svg);
    }
    const [a, b] = svg.querySelectorAll("feOffset");
    a.setAttribute("dx", (-dx).toFixed(1)); a.setAttribute("dy", (-dy).toFixed(1)); b.setAttribute("dx", dx.toFixed(1)); b.setAttribute("dy", dy.toFixed(1));
  }
  const punchTarget = (h) => h.spec.punchTarget ?? document.getElementById("board");
  function setPunch(h, p) {
    const el = punchTarget(h); if ( !el?.style ) return;
    if ( !h.punched ) { if ( !p ) return; h.punched = { el, translate: el.style.translate, scale: el.style.scale }; }
    if ( p ) { el.style.translate = `${(p.x * innerWidth).toFixed(1)}px ${(p.y * innerHeight).toFixed(1)}px`; el.style.scale = p.s.toFixed(4); }
    else { el.style.translate = h.punched.translate; el.style.scale = h.punched.scale; h.punched = null; }
  }
  /* hit-stop: the canvas ticker is held for the drawing's ticks (tokens, weather and effects stand still), never longer than
     LIMITS.maxStopTicks per impact; released at the next drawing, at the end, and by the watchdog */
  function setStop(on) {
    const tk = globalThis.canvas?.app?.ticker;
    if ( on && !stopHeld && tk?.started ) { tk.stop(); stopHeld = true; }
    else if ( !on && stopHeld ) { stopHeld = false; try { tk?.start(); } catch {} }
  }

  /* ---------- FIN-ENGINE (FXIS-E3): keep a rectangle readable under the impact ----------
     spec.keep = a rectangle { x, y, w, h } (client px; scene units with space: "world"), an HTML element, a LETR word's handle, or a list of
     them. Every drawing and the scene's change get a hole there (clip-path, even-odd), re-measured on every frame, so a word that moves
     (its entrance, the frame punch) stays readable through every drawing. spec.keepPad = the margin round it (px, default 6). */
  function boxOf(a, spec) {
    try {
      if ( a && (a.box || a.sprite) && a.finished ) {   // a LETR word
        if ( !a.alive || !a.shown ) return null;
        if ( a.sprite && !a.sprite.destroyed ) {
          if ( !a.sprite.visible ) return null;
          const b = a.sprite.getBounds(), v = canvas.app.view, r = v.getBoundingClientRect(), kx = r.width / (v.clientWidth || r.width || 1), ky = r.height / (v.clientHeight || r.height || 1);
          return { x0: r.left + b.x * kx, y0: r.top + b.y * ky, x1: r.left + (b.x + b.width) * kx, y1: r.top + (b.y + b.height) * ky };
        }
        const el = a.box?.firstElementChild ?? a.box, r = el?.getBoundingClientRect?.();
        return r ? { x0: r.left, y0: r.top, x1: r.right ?? r.left + r.width, y1: r.bottom ?? r.top + r.height } : null;
      }
      if ( a && typeof a.getBoundingClientRect === "function" ) { const r = a.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.left + r.width, y1: r.top + r.height }; }
      if ( a && Number.isFinite(a.x) && Number.isFinite(a.y) ) {
        const w = Number.isFinite(a.w) ? a.w : 0, h = Number.isFinite(a.h) ? a.h : 0;
        if ( spec.space === "world" && globalThis.canvas?.ready ) { const p = toClient({ x: a.x, y: a.y }), q = toClient({ x: a.x + w, y: a.y + h }); return { x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) }; }
        return { x0: a.x, y0: a.y, x1: a.x + w, y1: a.y + h };
      }
    } catch {}
    return null;
  }
  function keepBoxes(spec) {
    if ( !spec.keep ) return null;
    const pad = Number.isFinite(spec.keepPad) ? Math.max(0, spec.keepPad) : 6, out = [];
    for ( const a of Array.isArray(spec.keep) ? spec.keep : [spec.keep] ) { const b = boxOf(a, spec); if ( b && b.x1 > b.x0 && b.y1 > b.y0 ) out.push([b.x0 - pad, b.y0 - pad, b.x1 + pad, b.y1 + pad]); }
    return out;
  }
  const n1 = (v) => v.toFixed(1);
  /* the even-odd path of a shape with the boxes cut out (pts = a polygon in client px, null = the whole view) */
  function holePath(pts, boxes, W, H) {
    let d = pts ? `M${n1(pts[0])} ${n1(pts[1])}` + Array.from({ length: pts.length / 2 - 1 }, (_, k) => ` L${n1(pts[k * 2 + 2])} ${n1(pts[k * 2 + 3])}`).join("") + " Z" : `M0 0 H${n1(W)} V${n1(H)} H0 Z`;
    for ( const [x0, y0, x1, y1] of boxes ) d += ` M${n1(x0)} ${n1(y0)} H${n1(x1)} V${n1(y1)} H${n1(x0)} Z`;
    return `path(evenodd, "${d}")`;
  }
  function applyKeep(h) {
    const f = h.plan.frames[h.idx];
    if ( !f?.cv || !h.spec.keep ) return;
    const boxes = keepBoxes(h.spec) ?? [];
    const key = boxes.map((b) => b.map(n1).join(",")).join(";") + "|" + h.idx;
    if ( key === h.keepKey ) return;
    h.keepKey = key;
    f.cv.style.clipPath = boxes.length ? holePath(null, boxes, h.env.W, h.env.H) : "";
    if ( h.back.style.display !== "none" ) h.back.style.clipPath = boxes.length ? holePath(f.clipPts, boxes, h.env.W, h.env.H) : (f.clip || "none");
    h.kept = boxes.length;
  }

  /* ---------- one impact ---------- */
  function paint(h, i) {
    const f = h.plan.frames[i];
    if ( !f || f.cv !== undefined ) return;
    const t0 = now(), e = h.env;
    const q = Math.min(globalThis.devicePixelRatio || 1, Math.sqrt(MAX_PIX / (e.W * e.H)));
    const c = f.type === "rest" ? e.makeCanvas(1, 1) : e.makeCanvas(Math.max(1, Math.round(e.W * q)), Math.max(1, Math.round(e.H * q)));
    const ctx = e.ctx2d(c);
    ctx.setTransform?.(c.width / e.W, 0, 0, c.height / e.H, 0, 0);
    if ( f.type === "rest" ) ctx.setTransform?.(1, 0, 0, 1, 0, 0);
    try { paintFrame(ctx, e, f); } catch ( err ) { console.warn("LETR | impact drawing failed", err); }
    Object.assign(c.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", display: "none" });
    f.cv = c;
    const clip = backClip(e, f);
    f.clipPts = clip;
    f.clip = clip ? `polygon(${Array.from({ length: clip.length / 2 }, (_, k) => `${clip[k * 2].toFixed(1)}px ${clip[k * 2 + 1].toFixed(1)}px`).join(",")})` : "";
    h.wrap?.appendChild(c);
    const ms = now() - t0;
    stats.painted++; stats.paintMs += ms; if ( ms > stats.paintMax ) stats.paintMax = ms;
    h.paintMs += ms;
  }
  function show(h, i) {
    const t0 = now(), f = h.plan.frames[i], old = h.plan.frames[h.idx];
    paint(h, i);
    if ( f.cv.parentNode !== h.wrap ) h.wrap.appendChild(f.cv);
    f.cv.style.display = "block";
    if ( old?.cv && old !== f ) { old.cv.remove(); old.cv.width = 0; old.cv.height = 0; old.cv = null; }
    h.idx = i;
    const b = h.back.style;
    let back = f.back ? BACK[f.back] : "";
    if ( f.back === "chroma" ) {
      const d = Math.min(innerWidth, innerHeight) * LIMITS.chromaMax * (0.5 + 0.25 * h.plan.magnitude), a = h.env.dir ?? 0;
      chromaFilter(Math.cos(a) * d, Math.sin(a) * d);
      if ( chromaOk === false ) back = "";
    }
    if ( back ) { b.backdropFilter = back; b.webkitBackdropFilter = back; b.clipPath = f.clip || "none"; b.display = "block"; }
    else b.display = "none";
    setStop(!!f.stop);
    if ( h.spec.keep ) { h.keepKey = null; applyKeep(h); }
    const ms = now() - t0; if ( ms > stats.showMax ) stats.showMax = ms;
    if ( !h.isReady ) { h.isReady = true; h._ready(true); }
  }
  function finish(h, why) {
    if ( !h.alive ) return;
    h.alive = false;
    lives.delete(h);
    if ( h.raf ) cancelAnimationFrame(h.raf);
    if ( h.dog ) clearTimeout(h.dog);
    try { setPunch(h, null); } catch {}
    setStop(false);
    for ( const f of h.plan.frames ) if ( f.cv ) { f.cv.remove?.(); f.cv.width = 0; f.cv.height = 0; f.cv = null; }
    h.wrap?.remove(); h.wrap = null;
    stats.last = { kind: h.plan.kind, mode: h.plan.mode, frames: h.plan.frames.length, ms: h.plan.ms, paintMs: +h.paintMs.toFixed(2), frameMax: +h.frameMax.toFixed(2), why };
    if ( h.frameMax > stats.frameMax ) stats.frameMax = h.frameMax;
    if ( !h.isReady ) h._ready(false);
    h._done(why);
  }
  /* FIN-ENGINE: painting ahead (an impact waiting for its shared start) is shared out: at most AHEAD_MS of it per display frame over every
     waiting impact (live: five blows of a series called at once painted five full-view drawings in one frame, a 70 ms frame). The next
     drawing of an impact that is PLAYING is always painted. */
  const AHEAD_MS = 6, AHEAD_N = 2;
  let aheadTs = null, aheadUsed = 0, aheadN = 0;
  function loop(h, ts) {
    h.raf = 0;
    if ( !h.alive ) return;
    const t = now();
    if ( h.lastT != null && h.idx >= 0 ) { const d = t - h.lastT; if ( d > h.frameMax ) h.frameMax = d; }
    h.lastT = t;
    if ( h.t0 == null ) { paint(h, 0); h.t0 = now(); }   // no shared start: the clock starts when the first drawing is ready
    /* FIN-ENGINE: a shared start (startAt, or blowAt - peakMs) waits; before, blowAt alone was taken for an own start and drawing 0
       stood on screen from the call to the blow (live: seconds of a full-view drawing) */
    const el = Math.max(t, h.shared ? t : h.t0) - h.t0;
    if ( el < 0 ) {   // waiting for a shared start: paint ahead, one drawing per frame, inside the frame's shared budget
      const n = h.plan.frames.findIndex((f) => f.cv === undefined);
      const fk = ts ?? Math.floor(now() / 8); if ( fk !== aheadTs ) { aheadTs = fk; aheadUsed = 0; aheadN = 0; }
      if ( n >= 0 && aheadUsed < AHEAD_MS && aheadN < AHEAD_N ) { const p0 = now(); paint(h, n); aheadUsed += now() - p0; aheadN++; }
    } else {
      const i = frameAt(h.plan, Math.max(0, el));
      if ( i < 0 ) { finish(h, "done"); return; }
      if ( i !== h.idx ) show(h, i);
      let a = 0; for ( let k = 0; k < i; k++ ) a += h.plan.frames[k].ticks * TICK;
      const p = punchAt(h.plan, i, Math.floor((el - a) / TICK));
      if ( p || h.punched ) setPunch(h, p);
      if ( h.spec.keep ) applyKeep(h);
      if ( h.plan.frames[i + 1] && h.plan.frames[i + 1].cv === undefined ) paint(h, i + 1);
    }
    h.raf = requestAnimationFrame((x) => loop(h, x));
  }
  const ended = (plan, why, extra = {}) => ({ id: `imp${++seq}`, plan, mode: plan?.mode ?? "off", alive: false, off: why === "off", isReady: false,
    ready: Promise.resolve(false), finished: Promise.resolve(why), stop() {}, ...extra });

  function play(spec0 = {}, over = {}) {
    const armed = spec0?._armed ? spec0 : null;
    const spec = armed ? { ...armed.spec, ...over } : { ...(spec0 && typeof spec0 === "object" ? spec0 : {}) };
    const P = prefs();
    if ( modeFor(P, { osReduced: osReduced(), callerReduced: spec.reduced, callerGentle: spec.gentle }) === "off" ) return ended(null, "off");
    const t = now();
    const plan = planImpact(spec);
    /* FIN-ENGINE: blowAt = the instant of the blow itself (e.g. L.contactAt of the word it belongs to): the impact starts its lead-in earlier */
    let startAt = Number.isFinite(spec.startAt) ? spec.startAt : Number.isFinite(spec.blowAt) ? spec.blowAt - plan.peakMs : null;
    if ( startAt != null && startAt > t + 60000 ) { console.warn("LETR | impact startAt is far in the future: it must be this page's performance.now(); ignored"); startAt = null; }
    if ( startAt != null && t > startAt + plan.ms ) return ended(plan, "late");
    const sub = armed && !over.subject ? armed.sub : subjectOf(spec);
    if ( sub.hidden ) return ended(plan, "hidden");
    /* one impact at a time: a stronger one takes over, a weaker one is not shown */
    const a0 = startAt ?? t, a1 = a0 + plan.ms;
    const clash = [...lives].filter((x) => x.alive && a0 < (x.t0 ?? t) + x.plan.ms && (x.t0 ?? t) < a1);
    if ( clash.length ) { if ( clash.every((x) => plan.magnitude > x.plan.magnitude) ) for ( const x of clash ) finish(x, "replaced"); else return ended(plan, "busy"); }
    safety(plan, P, { osReduced: osReduced(), callerReduced: spec.reduced, callerGentle: spec.gentle, flashLog: flashLog(), now: t, t0: startAt ?? t });
    if ( !plan.frames.length ) return ended(plan, "off");
    let done, rdy;
    const h = { id: `imp${++seq}`, spec, plan, mode: plan.mode, alive: true, isReady: false, idx: -1, t0: startAt, shared: startAt != null, paintMs: 0, frameMax: 0,
      ready: new Promise((r) => (rdy = r)), finished: new Promise((r) => (done = r)), stop: () => finish(h, "stopped") };
    h._done = done; h._ready = rdy;
    h.env = envOf(spec, plan, sub);
    /* drawings painted by prepare() are kept when the view and the frame type are still the same */
    if ( armed?.env && armed.env.W === h.env.W && armed.env.H === h.env.H && Math.hypot(armed.env.cx - h.env.cx, armed.env.cy - h.env.cy) < 2 && armed.plan.mode === plan.mode ) {
      h.env._tints = armed.env._tints;
      plan.frames.forEach((f, i) => { const g = armed.plan.frames[i]; if ( g?.cv && g.type === f.type && g.seed === f.seed ) { f.cv = g.cv; f.clip = g.clip; g.cv = null; } });
    }
    if ( armed ) for ( const g of armed.plan.frames ) if ( g.cv ) { g.cv.width = 0; g.cv.height = 0; g.cv = null; }
    h.wrap = document.createElement("div");
    Object.assign(h.wrap.style, { position: "absolute", inset: "0" });
    h.back = document.createElement("div");
    Object.assign(h.back.style, { position: "absolute", inset: "0", display: "none" });
    h.wrap.appendChild(h.back);
    (spec.parent instanceof HTMLElement ? spec.parent : rootFor(spec.over, spec.z)).appendChild(h.wrap);
    lives.add(h); stats.played++;
    /* the watchdog: whatever happens to the frame loop (a hidden tab, an error), the impact is gone and the scene is free again */
    h.dog = setTimeout(() => finish(h, "done"), Math.max(0, (startAt ?? t) - t) + plan.ms + 300);
    h.raf = requestAnimationFrame((x) => loop(h, x));
    return h;
  }
  /* paint an impact ahead of the blow (the subject's silhouette and every drawing, for the view as it is now); play it with
     prepared.play({ startAt }) or I.play(prepared, { startAt }) */
  function prepare(spec0 = {}) {
    const spec = { ...(spec0 && typeof spec0 === "object" ? spec0 : {}) };
    const P = prefs(), plan = planImpact(spec), sub = subjectOf(spec);
    safety(plan, P, { osReduced: osReduced(), callerReduced: spec.reduced, callerGentle: spec.gentle, flashLog: flashLog(), now: now(), t0: now(), preview: true });
    const a = { _armed: true, spec, plan, sub, env: null, play: (o = {}) => play(a, o) };
    if ( !sub.hidden && plan.frames.length ) { a.env = envOf(spec, plan, sub); const h = { plan, env: a.env, wrap: null, paintMs: 0 }; for ( let i = 0; i < plan.frames.length; i++ ) paint(h, i); a.paintMs = h.paintMs; }
    return a;
  }
  /* the plan this client would show (no flash budget used) */
  function planFor(spec = {}) {
    const plan = planImpact(spec);
    return safety(plan, prefs(), { osReduced: osReduced(), callerReduced: spec.reduced, callerGentle: spec.gentle, flashLog: flashLog(), now: now(), t0: now(), preview: true });
  }
  /* one frame type held to look at (gallery, design): at most LIMITS.galleryTicks */
  const show1 = (type, spec = {}) => play({ ...spec, frames: [{ type, ticks: Math.min(LIMITS.galleryTicks, spec.ticks ?? 12), punch: 0 }], demo: true });
  function stopAll() { for ( const h of [...lives] ) finish(h, "stopped"); setStop(false); }
  try { globalThis.Hooks?.on?.("canvasTearDown", stopAll); } catch {}

  const api = {
    play, prepare, plan: planFor, show: show1, stopAll, pick, mode, setMode,
    kinds: KIND_IDS.map((id) => ({ id, pl: KINDS[id].pl, en: KINDS[id].en, tone: KINDS[id].tone })),
    frames: FRAME_IDS.map((id) => ({ id, pl: FRAMES[id].pl, en: FRAMES[id].en, full: FRAMES[id].full })),
    tones: Object.keys(TONES), limits: LIMITS, steps: STEP_AT, series: { step: SERIES_STEP, max: SERIES_MAX }, stats,
    get busy() { return [...lives].some((x) => x.alive); },
    /* the chromatic split needs a backdrop filter that takes an SVG filter: false turns the scene's split off (the ink still splits) */
    set chroma(v) { chromaOk = v; }, get chroma() { return chromaOk; },
    async gallery(o = {}) { const g = await import("./gallery.mjs"); return g.gallery(api, o); }
  };
  return api;
}

/* the engine's hook (index.mjs): L.impact */
export function attachImpact(L, tools = null) {
  if ( !L || L.impact ) return L?.impact ?? null;
  const I = createImpact(L, tools);
  Object.defineProperty(L, "impact", { value: I, enumerable: true, configurable: true });
  return I;
}
