/* LETR impact frames: the player and the API (L.impact). A few full-force drawings at the instant of a hit, over the scene (or over
   the whole interface), on the engine's 24-tick clock; README.md in this folder is the manual.

     const L = await letters(), I = L.impact;
     I.play({ kind: "crit", subject: token, dir: 20, magnitude: 1.6, seed: "roll:abc", startAt });

   How it is drawn: one fixed layer; the scene behind is changed by a backdrop filter (hard black and white, inverted, split), the
   ink (stars, lines, silhouettes, halftone, splashes) is painted ahead of time on 2D canvases, one per drawing, and a drawing change
   only swaps which canvas shows. Nothing of Foundry's is kept changed: the frame punch (a shove of the board element) and the
   hit-stop (the canvas ticker held) are undone at the last drawing, by a watchdog timer too. */
import { planImpact, safety, frameAt, punchAt, localRadius, pick, modeFor, TICK, LIMITS, FRAMES, FRAME_IDS, KINDS, KIND_IDS, TONES, STEP_AT, SERIES_STEP, SERIES_MAX, INK, PAPER } from "./plan.mjs";
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
  /* KEEPBOX: the time windows of every impact planned on this page { a0, a1 (this page's clock, from the shared start), mag, at (its flash
     instants in the log), h }; one at a time is decided on these. The engine's words read them too (tools.state.impactWins): a word's own
     flash accent inside an impact's second gives way (prefs.filterPlan), so a seat's private words never change what the impacts draw. */
  const wins = [];
  if ( tools?.state ) tools.state.impactWins = wins;
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
  const isWord = (a) => !!a && !!(a.box || a.sprite) && !!a.finished;
  const keepList = (spec) => (spec.keep ? (Array.isArray(spec.keep) ? spec.keep : [spec.keep]) : []);
  /* the boxes cut out of the drawings: rectangles and elements only. A LETR word is not cut out (KEEPBOX, below) */
  function keepBoxes(spec) {
    if ( !spec.keep ) return null;
    const pad = Number.isFinite(spec.keepPad) ? Math.max(0, spec.keepPad) : 6, out = [];
    for ( const a of keepList(spec) ) { if ( isWord(a) ) continue; const b = boxOf(a, spec); if ( b && b.x1 > b.x0 && b.y1 > b.y0 ) out.push([b.x0 - pad, b.y0 - pad, b.x1 + pad, b.y1 + pad]); }
    return out;
  }

  /* ---------- KEEPBOX (ADVX 7): a kept WORD is drawn ON the impact, the way a letterer puts the sound effect over the panel ----------
     Before, a kept word got a rectangular hole through every drawing and the scene's change: a hard box of un-inverted scene cut into the
     drawing ("a crude dark rectangle" in the review). Now nothing is cut: the word's own current picture is copied onto the top of the
     impact, at the word's exact place, turn and size on this screen (followed every frame), and while a drawing changes the scene (a black,
     white or inverted field, a black-and-white panel, a colour split) it is knocked out of the drawing by a paper rim and a thin ink line
     round the letters' own shape, with a short ink drop along the blow: readable on black, white and any scene, drawn, never a box.
     The scene keeps the word too (under the copy), so the word never jumps when the impact ends. The rim follows the letters (an SVG
     morphology filter on the copy: no pixel is read). `keepPad` does not apply to words. */
  const RIM = { paper: 0.06, ink: 0.024, drop: 1.4, paperMin: 2.5, paperMax: 12, inkMin: 1.5, inkMax: 4 };
  /* does this drawing change the scene behind the word? (then the word gets its rim) */
  const changesScene = (f) => !!f && (!!f.full || !!f.back || f.cls !== "scene");
  const mulM = (p, l) => ({ a: p.a * l.a + p.c * l.b, b: p.b * l.a + p.d * l.b, c: p.a * l.c + p.c * l.d, d: p.b * l.c + p.d * l.d, tx: p.a * l.tx + p.c * l.ty + p.tx, ty: p.b * l.tx + p.d * l.ty + p.ty });
  /* where the word's picture stands on this screen: { src (its canvas), w, h (the picture's box in local units), m (local -> client px,
     a CSS matrix), alpha, dim } or null when it is not shown */
  function wordPose(a) {
    try {
      if ( !a.alive || !a.shown?.canvas ) return null;
      const src = a.shown.canvas;
      if ( a.sprite ) {
        const sp = a.sprite;
        if ( sp.destroyed || !sp.visible || !sp.parent ) return null;
        const tw = sp.texture?.width || src.width, th = sp.texture?.height || src.height;
        /* the transform the engine set THIS frame (its world transform is only updated at the canvas's next render) */
        let l = null;
        try { sp.transform?.updateLocalTransform?.(); l = sp.transform?.localTransform ?? null; } catch {}
        const p = sp.parent.worldTransform, wt = l && p ? mulM(p, l) : sp.worldTransform;
        if ( !wt ) return null;
        const v = canvas.app.view, r = v.getBoundingClientRect(), kx = r.width / (v.clientWidth || r.width || 1), ky = r.height / (v.clientHeight || r.height || 1);
        const x0 = -(sp.anchor?.x ?? 0) * tw, y0 = -(sp.anchor?.y ?? 0) * th;
        const m = [kx * wt.a, ky * wt.b, kx * wt.c, ky * wt.d, r.left + kx * (wt.tx + wt.a * x0 + wt.c * y0), r.top + ky * (wt.ty + wt.b * x0 + wt.d * y0)];
        const tint = Number.isFinite(sp.tint) ? sp.tint : 0xffffff;
        return { src, w: tw, h: th, m, alpha: (sp.alpha ?? 1) * (sp.parent.worldAlpha ?? 1), dim: ((tint >> 16) & 255) / 255 };
      }
      const box = a.box;
      if ( !box?.isConnected || box.firstElementChild !== src || box.style.visibility === "hidden" ) return null;
      const st = src.style, w = parseFloat(st.width) || src.width, h = parseFloat(st.height) || src.height;
      const pr = box.parentElement?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      let m;
      if ( typeof DOMMatrix === "function" ) {
        const M = new DOMMatrix().translate(pr.left || 0, pr.top || 0).multiply(new DOMMatrix(box.style.transform || "none")).translate(parseFloat(st.left) || 0, parseFloat(st.top) || 0);
        m = [M.a, M.b, M.c, M.d, M.e, M.f];
      } else { const r = src.getBoundingClientRect(); m = [r.width / w, 0, 0, r.height / h, r.left, r.top]; }
      const br = /brightness\(([\d.]+)\)/.exec(box.style.filter ?? "");
      return { src, w, h, m, alpha: Number(box.style.opacity || 1), dim: br ? Number(br[1]) : 1 };
    } catch { return null; }
  }
  let keepSeq = 0;
  function keepSvg() {
    let svg = document.getElementById("moinen-impact-keep");
    if ( !svg ) {
      const ns = "http://www.w3.org/2000/svg";
      svg = document.createElementNS(ns, "svg");
      svg.id = "moinen-impact-keep"; svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.setAttribute("aria-hidden", "true");
      Object.assign(svg.style, { position: "fixed", left: "0", top: "0", pointerEvents: "none" });
      document.body.appendChild(svg);
    }
    return svg;
  }
  /* one rim filter per kept word (its widths follow the word's size on this screen) */
  function rimFilter(c, paper, ink, dx, dy) {
    const key = [paper, ink, dx, dy].map((v) => v.toFixed(2)).join(",");
    if ( c.rimKey === key ) return;
    c.rimKey = key;
    if ( !c.fid ) {
      c.fid = `moinen-impact-keep-${++keepSeq}`;
      const f = document.createElementNS("http://www.w3.org/2000/svg", "filter");
      f.id = c.fid; f.setAttribute("x", "-40%"); f.setAttribute("y", "-80%"); f.setAttribute("width", "180%"); f.setAttribute("height", "260%");
      f.setAttribute("color-interpolation-filters", "sRGB");
      keepSvg().appendChild(f); c.filter = f;
    }
    c.filter.innerHTML = `<feMorphology in="SourceAlpha" operator="dilate" radius="${paper.toFixed(2)}" result="pa"/>
<feFlood flood-color="${PAPER}"/><feComposite in2="pa" operator="in" result="paper"/>
<feMorphology in="SourceAlpha" operator="dilate" radius="${(paper + ink).toFixed(2)}" result="ia"/>
<feFlood flood-color="${INK}"/><feComposite in2="ia" operator="in" result="ink"/>
<feOffset in="ink" dx="${dx.toFixed(2)}" dy="${dy.toFixed(2)}" result="drop"/>
<feMerge><feMergeNode in="drop"/><feMergeNode in="ink"/><feMergeNode in="paper"/><feMergeNode in="SourceGraphic"/></feMerge>`;
  }
  function keepWords(h, f) {
    const words = keepList(h.spec).filter(isWord);
    if ( !words.length ) return 0;
    h.copies ??= new Map();
    if ( !h.top ) { h.top = document.createElement("div"); Object.assign(h.top.style, { position: "absolute", inset: "0", zIndex: "2", pointerEvents: "none" }); h.wrap.appendChild(h.top); }
    const rim = changesScene(f);
    let n = 0;
    for ( const a of words ) {
      let c = h.copies.get(a);
      /* during the hit-stop the board is not redrawn: the copy stands still with it */
      const pose = stopHeld && c?.pose ? c.pose : wordPose(a);
      if ( !c ) {
        const el = document.createElement("div"), cv = document.createElement("canvas");
        Object.assign(el.style, { position: "absolute", left: "0", top: "0", transformOrigin: "0 0", pointerEvents: "none", display: "none" });
        Object.assign(cv.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%" });
        el.appendChild(cv); h.top.appendChild(el);
        c = { el, cv, src: null }; h.copies.set(a, c);
      }
      if ( !pose ) { if ( c.el.style.display !== "none" ) c.el.style.display = "none"; continue; }
      c.pose = pose;
      if ( c.src !== pose.src || c.srcW !== pose.src.width || c.srcH !== pose.src.height ) {
        c.src = pose.src; c.srcW = pose.src.width; c.srcH = pose.src.height;
        c.cv.width = pose.src.width; c.cv.height = pose.src.height;
        try { const x = c.cv.getContext("2d"); x.clearRect(0, 0, c.cv.width, c.cv.height); x.drawImage(pose.src, 0, 0); } catch {}
      }
      const [ma, mb, mc, md, me, mf] = pose.m, s = Math.hypot(ma, mb) || 1;
      Object.assign(c.el.style, { width: `${pose.w}px`, height: `${pose.h}px`, transform: `matrix(${[ma, mb, mc, md, me, mf].map((v) => +v.toFixed(4)).join(",")})`,
        opacity: String(Math.max(0, Math.min(1, pose.alpha))), display: "block" });
      const dim = pose.dim < 0.995 ? `brightness(${pose.dim.toFixed(3)})` : "";
      if ( c.cv.style.filter !== dim ) c.cv.style.filter = dim;
      if ( rim ) {
        /* the rim in screen px from the word's height on this screen, then in the copy's own units */
        const hs = pose.h * (Math.hypot(mc, md) || s);
        const paper = Math.min(RIM.paperMax, Math.max(RIM.paperMin, hs * RIM.paper)) / s, ink = Math.min(RIM.inkMax, Math.max(RIM.inkMin, hs * RIM.ink)) / s;
        /* the drop goes along the blow (in the copy's own frame), else down and right like a cast shadow */
        const dir = h.env?.dir, ux = dir != null ? Math.cos(dir) : 0.6, uy = dir != null ? Math.sin(dir) : 0.8, det = ma * md - mb * mc || 1;
        const lx = (md * ux - mc * uy) / det * s, ly = (-mb * ux + ma * uy) / det * s, ln = Math.hypot(lx, ly) || 1, k = (ink * RIM.drop) / ln;
        rimFilter(c, paper, ink, lx * k, ly * k);
        const want = `url(#${c.fid})`;
        if ( c.el.style.filter !== want ) c.el.style.filter = want;
      } else if ( c.el.style.filter ) c.el.style.filter = "";
      n++;
    }
    return n;
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
    const words = keepWords(h, f);
    const boxes = keepBoxes(h.spec) ?? [];
    h.kept = boxes.length + words;
    const key = boxes.map((b) => b.map(n1).join(",")).join(";") + "|" + h.idx;
    if ( key === h.keepKey ) return;
    h.keepKey = key;
    f.cv.style.clipPath = boxes.length ? holePath(null, boxes, h.env.W, h.env.H) : "";
    if ( h.back.style.display !== "none" ) h.back.style.clipPath = boxes.length ? holePath(f.clipPts, boxes, h.env.W, h.env.H) : (f.clip || "none");
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
    /* KEEPBOX: a blow stopped by its caller (or a scene change) frees the rest of its window and the flash instants it will not show */
    if ( why === "stopped" && h.win ) { const t = now(); cutAt(h.win, t, t); }
    if ( h.raf ) cancelAnimationFrame(h.raf);
    if ( h.dog ) clearTimeout(h.dog);
    try { setPunch(h, null); } catch {}
    setStop(false);
    for ( const f of h.plan.frames ) if ( f.cv ) { f.cv.remove?.(); f.cv.width = 0; f.cv.height = 0; f.cv = null; }
    if ( h.copies ) { for ( const c of h.copies.values() ) { c.filter?.remove?.(); c.cv.width = 0; c.cv.height = 0; } h.copies = null; }
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
  /* KEEPBOX (ADVX 6): every seat shows every drawing. On the clock alone a seat at a low frame rate, or one that drops a frame, jumps
     over a one-tick drawing (41.7 ms) that the other seat shows: one seat a star, the other nothing. The drawing that is due is shown,
     but a drawing passed by less than CATCH_MS that this page never showed comes first, for one display frame; only a seat stalled for
     longer (a hidden tab, a long freeze) skips. Nothing is added (same drawings, same flash count), a drawing only stands a frame late. */
  const CATCH_MS = LIMITS.maxFrameTicks * TICK;
  /* -> the drawing to show at `el` ms after the start, -1 = over. A blow cut by a stronger one (h.cutAt) keeps only the drawings that
     began at least a tick before the cut, each ending at the cut at the latest: every seat keeps the same ones whatever its frame rate */
  function nextDrawing(h, el) {
    const fr = h.plan.frames, lim = h.cutAt != null && h.t0 != null ? h.cutAt - h.t0 : Infinity;
    const span = [];
    let a = 0;
    for ( let j = 0; j < fr.length; j++ ) { const b = a + fr[j].ticks * TICK; if ( a > lim - TICK + 1e-6 ) break; span.push([a, Math.min(b, lim)]); a = b; }
    let due = -1;
    for ( let j = 0; j < span.length; j++ ) if ( el >= span[j][0] && el < span[j][1] ) { due = j; break; }
    if ( due < 0 && el < (span[0]?.[0] ?? 0) ) due = 0;
    const upTo = due < 0 ? span.length : due;
    for ( let j = h.idx + 1; j < upTo; j++ ) if ( span[j][1] > el - CATCH_MS ) return j;   // passed, never shown here, not long ago: now
    return due;
  }
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
      const i = nextDrawing(h, Math.max(0, el));
      if ( i < 0 ) { finish(h, h.cutAt != null ? "replaced" : "done"); return; }
      if ( i !== h.idx ) show(h, i);
      let a = 0; for ( let k = 0; k < i; k++ ) a += h.plan.frames[k].ticks * TICK;
      const p = punchAt(h.plan, i, Math.floor((el - a) / TICK));
      if ( p || h.punched ) setPunch(h, p);
      if ( h.spec.keep ) applyKeep(h);
      if ( h.plan.frames[i + 1] && h.plan.frames[i + 1].cv === undefined ) paint(h, i + 1);
    }
    h.raf = requestAnimationFrame((x) => loop(h, x));
  }
  /* KEEPBOX: a stronger blow cuts an earlier one at the stronger one's start (shared time); the flash instants the cut one will now never
     show give their place in the log back (only those still ahead on this page: what may already have shown stays counted) */
  function cutAt(w, at, t) {
    w.a1 = Math.max(w.a0, Math.min(w.a1, at));
    const log = flashLog(), gone = w.at.filter((x) => x >= w.a1 && x > t);
    for ( const x of gone ) { const i = log.indexOf(x); if ( i >= 0 ) log.splice(i, 1); }
    w.at = w.at.filter((x) => !gone.includes(x));
    const h = w.h;
    if ( h?.alive ) h.cutAt = w.a1;   // the frame loop ends it (nextDrawing), after the drawings it keeps
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
    /* KEEPBOX (ADVX 6): every seat must decide alike from the same calls. One impact at a time is decided on the impacts' TIME WINDOWS on
       the shared clock (`wins`: every call that was planned, also one this seat shows late or cannot see), never on what happens to be
       alive on this page: before, a seat that got a call a little later (or dropped a frame) found the earlier blow already over and
       showed both, while the other seat refused one. A stronger blow cuts the earlier one AT ITS OWN START (time), not at its arrival. */
    const a0 = startAt ?? t, a1 = a0 + plan.ms;
    for ( let i = wins.length - 1; i >= 0; i-- ) if ( wins[i].a1 < t - 5000 ) wins.splice(i, 1);
    const clash = wins.filter((w) => w.a1 > w.a0 && a0 < w.a1 && w.a0 < a1);
    if ( clash.length && !clash.every((w) => plan.magnitude > w.mag) ) return ended(plan, "busy");
    for ( const w of clash ) cutAt(w, a0, t);
    /* the guard runs for every planned call, shown here or not (late, hidden): a seat that cannot see one blow of a series thins the
       next blows exactly like the seat that sees it (the photosensitivity budget is spent the same on both; never less than shown) */
    safety(plan, P, { osReduced: osReduced(), callerReduced: spec.reduced, callerGentle: spec.gentle, flashLog: flashLog(), now: t, t0: a0 });
    if ( !plan.frames.length ) return ended(plan, "off");
    const win = { a0, a1, mag: plan.magnitude, at: plan.guard?.at ?? [], h: null };
    wins.push(win);
    if ( startAt != null && t > startAt + plan.ms ) return ended(plan, "late");
    const sub = armed && !over.subject ? armed.sub : subjectOf(spec);
    if ( sub.hidden ) return ended(plan, "hidden");
    let done, rdy;
    const h = { id: `imp${++seq}`, spec, plan, mode: plan.mode, alive: true, isReady: false, idx: -1, t0: startAt, shared: startAt != null, paintMs: 0, frameMax: 0, win,
      ready: new Promise((r) => (rdy = r)), finished: new Promise((r) => (done = r)), stop: () => finish(h, "stopped") };
    h._done = done; h._ready = rdy; win.h = h;
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
