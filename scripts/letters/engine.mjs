/* LETR engine: fonts, the picture scheduler, the two players (screen = HTML layer over the interface, world = PIXI on the canvas)
   and the public API (see README.md). Works without Foundry for the screen space (gallery page, node-free browser tests). */
import { makePlan, MOODS, MOOD_IDS, TICK, FONTS, syllablesOf } from "./design.mjs";
import { FontBank } from "./fontbank.mjs";
import { paintPicture } from "./paint.mjs";
import { settleCenter } from "./shape.mjs";
import { sizeFor, SIZE } from "./size.mjs";
import { createVocab } from "./words.mjs";

export const VERSION = "1.4.1";   // TOOL: engine-wide settings, authoring, networking, accessibility (1.3.1 WORD: vocabulary; 1.2.1 FXLE: lifecycle and safety fixes)
/* Where a word is drawn. World layers live in the canvas (scene coordinates); screen layers are HTML over the page.
   primary = the scene's own sorted group (lit and darkened by the scene's lighting like tokens are); sortLayer: Foundry's tiles 500,
   drawings 600, tokens 700, core weather 1000; moinen-maps: water 240, roads 245, destruction 247-248, districts 250, fire ground 256,
   zones 258, under-smoke 750, fire smoke 800, its weather 990-997. */
export const LAYERS = {
  ground:  { space: "world", group: "primary", sortLayer: 259, elevation: 0, pl: "Na ziemi (pod żetonami)", en: "On the ground (under tokens)" },
  tokens:  { space: "world", group: "primary", sortLayer: 760, elevation: 0, pl: "Nad żetonami (pod dymem i pogodą)", en: "Over tokens (under smoke and weather)" },
  weather: { space: "world", group: "primary", sortLayer: 1100, elevation: Infinity, pl: "Nad pogodą i dymem (w świetle sceny)", en: "Over weather and smoke (in the scene's light)" },
  overlay: { space: "world", group: "interface", pl: "Nad całą sceną i oświetleniem", en: "Over the whole scene and its lighting" },
  top:     { space: "world", group: "stage", pl: "Nad wszystkim na płótnie (też linijki, kursory)", en: "Over everything on the canvas (rulers, cursors too)" },
  hud:     { space: "screen", z: 5, pl: "Nad mapą, pod paskami i oknami", en: "Over the map, under the bars and windows" },
  ui:      { space: "screen", z: 80, pl: "Nad paskami (czat, makra), pod oknami", en: "Over the bars (chat, hotbar), under windows" },
  screen:  { space: "screen", z: 1000, pl: "Nad całym interfejsem", en: "Over the whole interface" }
};
const defaults = { world: "overlay", screen: "screen" };
const warned = new Set();
const warnOnce = (key, ...msg) => { if ( warned.has(key) ) return; warned.add(key); console.warn(...msg); };
const FIRST_MS = 6;           // FXLE F3: new words are prepared and get their first picture within this much per frame (at least one)
const MAX_CHARS = 160;        // FXLE F3: longer text is cut (a word that long is unreadable and costs seconds to letter)
const FUTURE_MS = 60000;      // FXLE F6: a startAt further ahead than this is another clock's time: ignored, with a warning
/* FXLE F19/F20: options checked before use; a bad number is dropped (default used) with one warning per option */
function cleanOpts(o) {
  const c = { ...(o && typeof o === "object" ? o : {}) };
  const fix = (k, ok) => {
    if ( c[k] === undefined || c[k] === null ) { delete c[k]; return; }
    if ( typeof c[k] === "number" && Number.isFinite(c[k]) && ok(c[k]) ) return;
    warnOnce(`opt:${k}`, `LETR | option ${k} = ${String(c[k])} ignored (not a usable number)`);
    delete c[k];
  };
  fix("size", (v) => v > 0); fix("hold", (v) => v >= 0); fix("tempo", (v) => v > 0); fix("rotation", () => true); fix("maxWidth", (v) => v > 0);
  fix("delay", (v) => v >= 0); fix("startAt", () => true); fix("scale", (v) => v > 0); fix("span", (v) => v > 0); fix("zIndex", () => true);
  fix("elevation", () => true);
  if ( c.pixel != null && typeof c.pixel !== "boolean" ) {
    if ( !(typeof c.pixel === "number" && Number.isFinite(c.pixel) && c.pixel >= 0.25) ) { warnOnce("opt:pixel", `LETR | option pixel = ${String(c.pixel)} ignored (art px size must be >= 0.25 scene px); using the grid's art pixel`); c.pixel = !!c.pixel; }
  }
  if ( Number.isFinite(c.startAt) && c.startAt > performance.now() + FUTURE_MS ) {
    warnOnce("opt:startAt", "LETR | startAt is far in the future: it must be this page's performance.now() (see README 'Several clients'); ignored");
    delete c.startAt;
  }
  if ( c.mood != null && c.mood !== "auto" && !Object.hasOwn(MOODS, c.mood) ) { warnOnce(`mood:${c.mood}`, `LETR | unknown mood "${String(c.mood)}", using auto`); c.mood = "auto"; }
  return c;
}
const BUDGET_MS = 4;          // pre-render budget per animation frame, shared by every live word
const MAX_REDRAWS = 3;        // stale (zoomed / resized) pictures drawn again per frame, at most, also within the time budget
const MEMORY_MS = 6000;       // a hand used this recently is avoided by unseeded words

const now = () => performance.now();
const reducedPref = () => { try { return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const makeCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

export function createEngine(base) {
  const bank = new FontBank();
  let readyP = null;
  const clips = new Set();
  const pending = new Set();    // FXLE F4: words not live yet (waiting for `delay` or fonts, or queued for the frame loop)
  const queue = [];             // FXLE F3: planned words waiting to be prepared in the frame loop, oldest first
  const streams = new Set();    // FXLE F4: running streams (stopAll and a scene change stop them)
  const hands = new Map();      // FXLE F18: recent hands by id, so `hand: h.hand` (the string) pins the exact look
  const memory = [];            // [{ id, t }]
  let raf = 0, seq = 0;
  const limits = { screen: 16, world: 48 };
  /* v5 tools (tools.mjs): engine-wide preferences and saved styles. opts filters run on each call's options (null = lettering is
     off on this client), plan filters on the planned word once its size is known (palette, motion, flash guard), start hooks once
     a word is up */
  const ext = { opts: [], plan: [], start: [] };
  const filterOpts = (opts) => { for ( const f of ext.opts ) { const o = f(opts); if ( o === null ) return null; if ( o ) opts = o; } return opts; };

  function ready() {
    readyP ??= Promise.all(Object.entries(FONTS).filter(([, f]) => !f.custom).map(async ([id, f]) => {
      try { const r = await fetch(new URL(f.file, base)); if ( !r.ok ) throw new Error(r.status); bank.add(id, await r.arrayBuffer()); }
      catch ( e ) { console.warn(`LETR | font ${id} not loaded`, e); }
    })).then(() => {
      if ( !bank.has("bangers") && !bank.has("anton") ) throw new Error("LETR: no font could be loaded");
      /* a font that failed to load is dropped from every mood's choices */
      for ( const m of Object.values(MOODS) ) for ( const k of Object.keys(m.fonts) ) if ( !bank.has(k) ) m.fonts[k] = 0;
      return true;
    });
    return readyP;
  }
  const fontsApi = { adv: (font, ch) => bank.adv(font, ch) };

  /* ---------- placement ---------- */
  /* a token reference: a Token, a TokenDocument or a token id (a string is always read as a token id) */
  const isToken = (a) => !!a && (typeof a === "string" || a.document?.documentName === "Token" || a.documentName === "Token");
  /* FXLE F11: the token's placeable on this scene, or null when it is gone (deleted, another scene, destroyed) */
  const tokenObj = (a) => {
    let t = null;
    if ( typeof a === "string" ) t = globalThis.canvas?.tokens?.get?.(a) ?? null;
    else if ( a?.documentName === "Token" ) t = a.object ?? null;
    else t = a ?? null;
    return t && !t.destroyed && t.center && t.document ? t : null;
  };
  /* the point a word sits at; FXLE F11/F19: a token that is gone keeps the last known point (h.gone is set and the word leaves),
     an `at` function that throws or returns nothing keeps the last point too */
  function atOf(h) {
    if ( typeof h.at !== "function" ) return h.at;
    try { return h.at(); } catch ( e ) { warnOnce("at-throws", "LETR | an `at` function threw; the word keeps its last point", e); return null; }
  }
  function worldPoint(h) {
    const a = atOf(h);
    if ( isToken(a) ) {
      const t = tokenObj(a);
      if ( !t ) { h.gone = true; return h.lastP ?? null; }
      const d = t.document;
      return (h.lastP = { x: t.center.x, y: (d.y ?? t.y) - (canvas.grid?.size ?? 100) * 0.08 });
    }
    if ( a && Number.isFinite(a.x) && Number.isFinite(a.y) ) return (h.lastP = { x: a.x, y: a.y });
    if ( h.lastP ) return h.lastP;
    const r = globalThis.canvas?.stage ? canvas.stage.pivot : { x: 0, y: 0 };
    return { x: r.x, y: r.y };
  }
  function screenPoint(h) {
    const a = atOf(h);
    if ( isToken(a) ) {
      if ( !globalThis.canvas?.stage ) { h.gone = true; return h.lastS ?? null; }
      const w = worldPoint({ at: a }); if ( !w ) { h.gone = true; return h.lastS ?? null; }
      const g = canvas.stage.toGlobal(w), r = canvas.app.view.getBoundingClientRect();
      return (h.lastS = { x: r.left + g.x, y: r.top + g.y });
    }
    if ( a && Number.isFinite(a.x) && Number.isFinite(a.y) ) return (h.lastS = { x: a.x, y: a.y });
    if ( h.lastS ) return h.lastS;
    return { x: innerWidth / 2, y: innerHeight * 0.42 };
  }

  /* ---------- who may see a word (FXLE F13) ----------
     A word that belongs to a token (`at` = a token, or `token`) is shown only while that token is visible to this user: a hidden
     token's word is never shown to players, nor one whose token this user cannot see (vision, fog). `vision: "point"` also hides a
     world word whose point this user cannot see; `vision: "none"` shows it always. The GM sees what the GM sees on the canvas. */
  const SEEN_MS = 120;
  function wordToken(h) {
    const a = h.opts.token ?? (typeof h.at === "function" ? null : h.at);
    return isToken(a) ? a : null;
  }
  function computeSeen(h) {
    const C = globalThis.canvas, user = globalThis.game?.user;
    if ( h.opts.vision === "none" || !C?.ready || !user ) return true;
    const gm = !!user.isGM;
    const noVision = () => !C.visibility?.tokenVision || (gm && !C.effects?.visionSources?.some?.((s) => s.active));
    const ref = wordToken(h);
    if ( ref ) {
      const t = tokenObj(ref);
      if ( !t ) return h.seen ?? false;              // gone: keep the last answer (the word is leaving)
      const d = t.document;
      if ( t.controlled || t.isPreview ) return true;
      if ( d.hidden && !gm ) return false;
      if ( noVision() ) return true;
      if ( t.vision?.active ) return true;
      try { return !!C.visibility.testVisibility(d.getVisibilityTestPoints?.() ?? t.center, { tolerance: 0, object: t }); } catch { return true; }
    }
    if ( h.opts.vision === "point" && h.space === "world" && h.lastP ) {
      if ( noVision() ) return true;
      try { return !!C.visibility.testVisibility(h.lastP, { tolerance: (C.grid?.size ?? 100) * 0.25 }); } catch { return true; }
    }
    return true;
  }
  function seenOf(h, t) {
    if ( h.seenAt != null && t - h.seenAt < SEEN_MS ) return h.seen;
    h.seenAt = t; h.seen = computeSeen(h);
    return h.seen;
  }

  /* ---------- display layers (README "Layers") ---------- */
  const screenLayers = new Map(), worldLayers = new Map();
  const layerOf = (h) => {
    const want = h.opts.layer ?? defaults[h.space];
    const L = LAYERS[want];
    if ( L && L.space === h.space ) return want;
    if ( h.opts.layer && !warned.has(want) ) { warned.add(want); console.warn(`LETR | unknown ${h.space} layer "${want}", using "${defaults[h.space]}"`); }
    return defaults[h.space];
  };
  function ensureLayer(h) {
    if ( h.opts.parent instanceof HTMLElement ) return h.opts.parent;
    const key = layerOf(h);
    let el = screenLayers.get(key);
    if ( !el?.isConnected ) {
      el = document.createElement("div");
      el.id = `moinen-letters-${key}`;
      el.className = "moinen-letters-layer";
      el.setAttribute("aria-hidden", "true");
      Object.assign(el.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: String(LAYERS[key].z), overflow: "hidden", contain: "strict" });
      document.body.appendChild(el);
      screenLayers.set(key, el);
    }
    if ( key === "screen" ) screenZ(el);
    return el;
  }
  /* FXLE F22: app windows climb in z-index (ApplicationV2._maxZ + 1 per bring-to-front, from 100): the `screen` layer stays above
     the highest window, under tooltips (9999) and notifications */
  function screenZ(el = screenLayers.get("screen")) {
    if ( !el ) return;
    const top = Number(globalThis.foundry?.applications?.api?.ApplicationV2?._maxZ) || 0;
    const z = String(Math.min(9990, Math.max(LAYERS.screen.z, top + 1)));
    if ( el.style.zIndex !== z ) el.style.zIndex = z;
  }
  /* FXLE F22: the elevation a primary-group word sorts at: never under the current v14 level's own background (level base elevation);
     `tokens` at the token's live elevation (the `at` token, or `token`), at a point the highest token covering that point; `elevation`
     overrides */
  function elevationOf(h, key, L) {
    if ( L.group !== "primary" ) return 0;
    if ( Number.isFinite(h.opts.elevation) ) return h.opts.elevation;
    if ( L.elevation === Infinity ) return Infinity;
    const base = Number(globalThis.canvas?.level?.elevation?.base) || 0;
    if ( key !== "tokens" ) return Math.max(base, L.elevation ?? 0);
    const ref = wordToken(h);
    if ( ref ) { const t = tokenObj(ref); if ( t ) return Math.max(base, Number(t.document.elevation) || 0); }
    const p = h.lastP;
    let e = base;
    if ( p ) for ( const t of globalThis.canvas?.tokens?.placeables ?? [] ) {
      const b = t.bounds; if ( !b || !(Number(t.document?.elevation) > e) ) continue;
      if ( p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height ) e = Number(t.document.elevation);
    }
    return e;
  }
  /* a primary-group word moves to the container of its new elevation when that changes (token climbs, level switch); checked every few frames */
  function refreshElevation(h, t) {
    if ( h.space !== "world" || !h.sprite || (h.opts.parent && h.opts.parent.addChild) ) return;
    if ( h.elevAt != null && t - h.elevAt < 250 ) return;
    h.elevAt = t;
    const key = layerOf(h), L = LAYERS[key];
    if ( L.group !== "primary" ) return;
    if ( elevationOf(h, key, L) === h.elev ) return;
    const parent = ensureWorld(h);
    if ( h.sprite.parent !== parent ) parent.addChild(h.sprite);
  }
  function ensureWorld(h) {
    if ( h.opts.parent && h.opts.parent.addChild ) return h.opts.parent;
    const key = layerOf(h), L = LAYERS[key];
    const elev = elevationOf(h, key, L);
    h.elev = elev;
    const id = `${key}@${elev}`;
    let c = worldLayers.get(id);
    if ( !c || c.destroyed || !c.parent ) {
      c = new PIXI.Container();
      c.name = `moinen-letters-${id}`;
      c.sortableChildren = true;
      c.eventMode = "none";
      if ( L.group === "primary" ) { Object.assign(c, { elevation: elev, sortLayer: L.sortLayer, sort: 0, _lastSortedIndex: 0 }); canvas.primary.addChild(c); canvas.primary.sortDirty = true; }
      else if ( L.group === "stage" ) { c.zIndex = 1e6; canvas.stage.addChild(c); }
      else { c.zIndex = 900; canvas.interface.addChild(c); canvas.interface.sortChildren?.(); }
      worldLayers.set(id, c);
    }
    if ( L.group === "stage" && canvas.stage.children.at(-1) !== c ) canvas.stage.addChild(c);   // stays the last child (drawn last)
    return c;
  }

  /* ---------- size (README "Size"; the model is size.mjs) ---------- */
  const usableW = () => { const sb = document.getElementById("sidebar")?.getBoundingClientRect(); return Math.max(320, innerWidth - (sb && sb.left > innerWidth * 0.5 ? sb.width : 0)); };
  /* the radius (world units) of an event's footprint: a number, { radius }, { w, h }, or a placeable / document with bounds */
  function areaOf(a) {
    if ( a == null ) return 0;
    if ( Number.isFinite(a) ) return Math.max(0, a);
    if ( Number.isFinite(a.radius) ) return a.radius;
    const b = a.bounds ?? a.object?.bounds ?? a;
    if ( Number.isFinite(b.width) && Number.isFinite(b.height) ) return Math.max(b.width, b.height) / 2;
    if ( Number.isFinite(b.w) && Number.isFinite(b.h) ) return Math.max(b.w, b.h) / 2;
    return 0;
  }
  function tokenSpanOf(h) {
    if ( Number.isFinite(h.opts.span) && h.opts.span > 0 ) return h.opts.span;   // the size of whatever makes the sound, world units
    const a = h.opts.token ?? (typeof h.at === "function" ? null : h.at);
    if ( !isToken(a) || !globalThis.canvas?.grid ) return 0;
    const t = tokenObj(a), d = t?.document; if ( !d ) return 0;
    return Math.max(d.width ?? 1, d.height ?? 1) * canvas.grid.size;
  }
  function sizeCtx(h) {
    const world = h.space === "world";
    return {
      space: h.space, size: h.opts.size, magnitude: h.opts.magnitude, area: world ? areaOf(h.opts.area) : 0, tokenSpan: world ? h.tokenSpan : 0,
      grid: globalThis.canvas?.grid?.size ?? 100, zoom: world ? (globalThis.canvas?.stage?.scale?.x || 1) : 1, vw: usableW(), vh: innerHeight,
      scale: h.opts.scale ?? 1, sizeK: h.plan.sizeK, aspect: h.plan._holdBox?.w ?? 3, fit: h.opts.fit ?? "legible",
      alive: world ? h.worldAlive ?? 0 : 0, pixel: h.pixel ? artPx(h) : 0
    };
  }
  /* sizes follow zoom and viewport live (pixel words keep the size they started with: whole art pixels) */
  function resize(h, first) {
    if ( !first && (h.pixel || h.opts.fit === "exact") ) return;
    if ( h.opts.fit === "exact" ) {
      h.size = (h.opts.size ?? (h.space === "world" ? (globalThis.canvas?.grid?.size ?? 100) * 0.6 : 72)) * (h.opts.scale ?? 1) * (h.opts._k ?? 1);
      h.sizeInfo = { size: h.size, px: null, natural: h.size, clamp: null, fit: "exact" };
      return;
    }
    const info = sizeFor(sizeCtx(h));
    h.sizeInfo = info;
    h.size = info.size * (h.opts._k ?? 1);   // the user's size setting, after the legibility clamp (tools)
  }

  /* ---------- pictures ---------- */
  /* pixel mode: one texel per art pixel (the pixel-vfx grid: 32 art px per grid square), shown with nearest-neighbour scaling */
  const artPx = (h) => (typeof h.opts.pixel === "number" ? h.opts.pixel : (canvas?.grid?.size ?? 100) / 32);
  function renderScale(h) {
    const dpr = globalThis.devicePixelRatio || 1;
    if ( h.pixel ) return 1 / artPx(h);
    if ( h.space === "world" ) return Math.max(0.05, (canvas?.stage?.scale?.x || 1)) * dpr;
    return dpr;
  }
  function pxPerUnit(h, rs) {
    let S = h.size * h.plan.sizeK * rs;
    const hb = h.plan._holdBox;
    if ( h.opts.maxWidth && hb?.w ) S = Math.min(S, (h.opts.maxWidth * rs) / hb.w);
    return Math.max(4, S);
  }
  function picture(h, idx, sync) {
    const rs = renderScale(h);
    let c = h.cache[idx];
    /* drawn again when the wanted texel size drifted (zoom, resize): up by 15 % at most, so a small picture is never blown up */
    /* F1: a drifted picture is only marked stale and stays on screen (scaled) until the frame budget lets it be drawn again,
       so one zoom step never repaints every word in the same frame; the old texture is freed once the new one is shown (F0) */
    if ( c && !h.pixel ) { const w = pxPerUnit(h, rs); c.stale = w > c.want * 1.15 || w < c.want * 0.5; }
    if ( c && !(c.stale && sync) ) return c;
    if ( !sync ) return null;
    const old = c;
    const p = h.pics[idx];
    const t0 = now();
    const want = pxPerUnit(h, rs);
    const r = paintPicture(h.plan, bank, p, want, makeCanvas);
    r.rs = rs * (r.S / want);          // texels per display unit actually used (lower when a huge word hit the side cap)
    r.want = want; r.size0 = h.size;   // drawn for this size; place() scales by h.size / size0 until it is drawn again
    r.idx = idx;
    if ( old ) { if ( h.shown === old ) (h.retired ??= []).push(old); else dropPic(old); }
    if ( h.pixel ) hardAlpha(r.canvas);
    r.ms = now() - t0;
    if ( h.space === "world" ) {
      r.tex = new PIXI.Texture(new PIXI.BaseTexture(r.canvas, { scaleMode: h.pixel ? PIXI.SCALE_MODES.NEAREST : PIXI.SCALE_MODES.LINEAR }));
    } else {
      r.canvas.style.position = "absolute";
      const k = r.rs;
      r.canvas.style.width = `${r.canvas.width / k}px`; r.canvas.style.height = `${r.canvas.height / k}px`;
      r.canvas.style.left = `${-r.ax / k}px`; r.canvas.style.top = `${-r.ay / k}px`;
      if ( h.pixel ) r.canvas.style.imageRendering = "pixelated";
    }
    h.cache[idx] = r;
    stats.rendered++; stats.ms += r.ms; if ( r.ms > stats.maxMs ) stats.maxMs = r.ms;
    return r;
  }
  /* 1-bit alpha for pixel art (no soft edge between art pixels) */
  function hardAlpha(cnv) {
    const ctx = cnv.getContext("2d"), d = ctx.getImageData(0, 0, cnv.width, cnv.height), a = d.data;
    for ( let i = 3; i < a.length; i += 4 ) { if ( a[i] < 110 ) a[i] = 0; else { const k = 255 / a[i]; a[i - 3] = Math.min(255, a[i - 3] * k); a[i - 2] = Math.min(255, a[i - 2] * k); a[i - 1] = Math.min(255, a[i - 1] * k); a[i] = 255; } }
    ctx.putImageData(d, 0, 0);
  }
  function dropPic(c) { try { c.tex?.destroy(true); } catch {} if ( c.canvas ) { c.canvas.width = 0; c.canvas.height = 0; c.canvas.remove?.(); } }
  const stats = { rendered: 0, ms: 0, maxMs: 0 };

  /* ---------- schedule of one word ---------- */
  function scheduleOf(h) {
    const tl = h.plan.timeline;
    const pics = [...tl.ent, ...tl.hold, ...tl.exit];
    const eN = tl.ent.length, hN = tl.hold.length;
    h.pics = pics; h.eN = eN; h.hN = hN;
    h.entMs = tl.ent.reduce((a, p) => a + p.ticks * TICK, 0);
    const cycle = tl.hold.reduce((a, p) => a + p.ticks * TICK, 0);
    h.cycle = cycle;
    h.holdMs = Math.max(cycle, h.plan.holdMs);
    h.exitMs = tl.exit.reduce((a, p) => a + p.ticks * TICK, 0);
  }
  /* which picture is up at time t (ms since start); -1 = finished */
  function picAt(h, t) {
    const tl = h.plan.timeline;
    const exitStart = h.exitAt ?? (h.loop ? Infinity : h.entMs + h.holdMs);
    if ( t < exitStart ) {
      if ( t < h.entMs ) { let a = 0; for ( let i = 0; i < h.eN; i++ ) { a += tl.ent[i].ticks * TICK; if ( t < a ) return i; } }
      let x = (t - h.entMs) % h.cycle, a = 0; for ( let i = 0; i < h.hN; i++ ) { a += tl.hold[i].ticks * TICK; if ( x < a ) return h.eN + i; } return h.eN;
    }
    let a = exitStart; for ( let i = 0; i < tl.exit.length; i++ ) { a += tl.exit[i].ticks * TICK; if ( t < a ) return h.eN + h.hN + i; }
    return -1;
  }
  function nextIdx(h, t) { const cur = picAt(h, t); for ( let dt = 40; dt < 360; dt += 40 ) { const n = picAt(h, t + dt); if ( n !== cur && n >= 0 && !h.cache[n] ) return n; } return -1; }

  function show(h, c) {
    if ( h.shown === c ) return;
    h.shown = c;
    /* F2: free what will not be shown again: the replaced (stale) picture, the entrance once the hold runs, everything before the
       current picture once the exit runs (the hold cycle stays cached: it loops) */
    if ( h.retired ) { for ( const o of h.retired ) if ( o !== c ) dropPic(o); h.retired = null; }
    const i = c.idx ?? -1, exitFrom = h.eN + h.hN;
    const upTo = i >= exitFrom ? i : Math.min(i, h.eN);   // entrance pictures go as soon as they are passed
    for ( let j = 0; j < upTo; j++ ) { const o = h.cache[j]; if ( o && o !== c && (j < h.eN || i >= exitFrom) ) { dropPic(o); h.cache[j] = null; } }
    if ( h.space === "world" ) {
      h.sprite.texture = c.tex;
      h.sprite.anchor.set(c.ax / c.canvas.width, c.ay / c.canvas.height);
    } else {
      h.box.replaceChildren(c.canvas);
    }
  }
  function place(h) {
    const seen = seenOf(h, now());
    if ( h.space === "world" ) {
      const p = worldPoint(h); if ( !p ) return;
      h.sprite.visible = seen;
      h.sprite.position.set(p.x + h.offset.x * (h.size * h.plan.sizeK), p.y + h.offset.y * (h.size * h.plan.sizeK));
      if ( h.shown ) h.sprite.scale.set((1 / h.shown.rs) * (h.size / h.shown.size0));
    } else {
      const p = screenPoint(h); if ( !p ) return;
      const vis = seen ? "" : "hidden";
      if ( h.box.style.visibility !== vis ) h.box.style.visibility = vis;
      const k = h.size * h.plan.sizeK;
      const f = h.shown ? h.size / h.shown.size0 : 1;
      h.box.style.transform = `translate(${(p.x + h.offset.x * k).toFixed(1)}px,${(p.y + h.offset.y * k).toFixed(1)}px) rotate(${h.rot}rad)${Math.abs(f - 1) > 1e-3 ? ` scale(${f.toFixed(4)})` : ""}`;
    }
  }

  /* FXLE F4/F8: every way a word ends goes through here: it leaves the live set AND the waiting/queued set, its timer is cleared,
     every picture (cached and retired) is freed, and BOTH promises settle (ready with false when it never showed) */
  function finish(h, why) {
    if ( !h.alive ) return;
    h.alive = false;
    clips.delete(h); pending.delete(h);
    if ( h.timer ) { clearTimeout(h.timer); h.timer = 0; }
    for ( const c of h.cache ) if ( c ) dropPic(c);
    h.cache.length = 0;
    if ( h.retired ) { for ( const c of h.retired ) dropPic(c); h.retired = null; }
    if ( h.space === "world" ) { try { h.sprite?.destroy({ children: true, texture: false }); } catch {} }
    else h.box?.remove();
    if ( !h.isReady ) h._ready(false);
    h._done(why);
  }

  /* FXLE F3: a new word gets ready here, in the frame loop and within the first-picture budget: its geometry, size, schedule, sprite
     or box, the limit; then its first picture is painted when it is due. A big burst so comes up over a few frames instead of
     blocking the page in one call. Without `startAt` a word's clock starts when its first picture is shown (no entrance is skipped). */
  function prepare(h) {
    const opts = h.opts, space = h.space;
    if ( space === "world" && !globalThis.canvas?.ready ) { finish(h, "evicted"); return; }
    if ( isToken(h.at) && !tokenObj(h.at) ) { warnOnce("tok-missing", "LETR | a word's token is not on this scene; the word is skipped"); finish(h, "evicted"); return; }
    settleCenter(h.plan, bank);
    h.loop = !!opts.loop;
    h.tokenSpan = tokenSpanOf(h);
    h.worldAlive = space === "world" ? count({ space: "world" }) : 0;
    resize(h, true);
    if ( ext.plan.length ) { for ( const f of ext.plan ) f(h.plan, h); h.hand = h.plan.hand.id; }
    h.rot = ((opts.rotation ?? 0) * Math.PI) / 180;
    const anchor = opts.anchor ?? (isToken(h.at) ? "bottom" : "center");
    h.offset = { x: 0, y: anchor === "bottom" ? -(h.plan._holdBox.h / 2 + 0.1) : 0 };
    scheduleOf(h);
    if ( space === "world" ) worldPoint(h); else screenPoint(h);   // first known point (elevation at a point, F11)
    /* the limit: the oldest word of the same space leaves at once (a limit under 1 lets no word in) */
    const lim = Math.max(0, Math.floor(Number(limits[space]) || 0));
    if ( lim < 1 ) { finish(h, "evicted"); return; }
    const same = [...clips].filter((c) => c.space === space);
    while ( same.length && same.length >= lim ) same.shift().stop({ quick: true, why: "evicted" });
    if ( space === "world" ) {
      const parent = ensureWorld(h);
      h.sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
      h.sprite.eventMode = "none";
      h.sprite.zIndex = opts.zIndex ?? h.seq;
      h.sprite.rotation = h.rot;
      parent.addChild(h.sprite);
    } else {
      const lay = ensureLayer(h);
      h.box = document.createElement("div");
      h.box.className = "moinen-letter";
      Object.assign(h.box.style, { position: "absolute", left: "0", top: "0", width: "0", height: "0", zIndex: String(opts.zIndex ?? h.seq), willChange: "transform" });
      lay.appendChild(h.box);
    }
    pending.delete(h);
    clips.add(h);
    /* startAt: a performance.now() time on this page's clock (an effect's own t0): the word joins its timeline there */
    h.t0 = Number.isFinite(opts.startAt) ? opts.startAt : null;
  }

  /* ---------- the one animation loop ---------- */
  function frame() {
    raf = 0;
    const t = now();
    let budget = BUDGET_MS, first = FIRST_MS, firstN = 0;
    const firstOk = () => first > 0 || firstN === 0;
    /* new words, oldest first */
    while ( queue.length && firstOk() ) {
      const h = queue.shift(); if ( !h.alive ) continue;
      const t1 = now();
      try { prepare(h); } catch ( e ) { console.warn("LETR | word failed", e); finish(h, "evicted"); }
      first -= now() - t1;
      if ( !h.alive ) continue;
      firstN++;   // its first picture is painted below in this frame when it is due (charged to the same budget)
    }
    let worldN = 0; for ( const h of clips ) if ( h.space === "world" ) worldN++;
    let redraws = 0, painted = 0;
    if ( clips.size ) screenZ();
    for ( const h of [...clips] ) {
      try {
        if ( !h.shown ) {
          /* FXLE F7: a word with a future startAt shows nothing (and is not ready) until its time; its first picture is drawn ahead */
          if ( h.t0 != null && t < h.t0 ) { if ( !h.cache[0] && budget > 0 ) { const t1 = now(); picture(h, 0, true); budget -= now() - t1; } continue; }
          if ( !(first > 0 || painted === 0) ) continue;
          const idx = h.t0 == null ? 0 : picAt(h, t - h.t0);
          if ( idx < 0 ) { finish(h, h.stopWhy ?? "done"); continue; }
          if ( h.space === "world" ) h.worldAlive = worldN;
          resize(h, false);
          const t1 = now();
          const c = picture(h, idx, true);
          first -= now() - t1; painted++;
          if ( h.t0 == null ) h.t0 = now();
          show(h, c); place(h);
          if ( !h.isReady ) { h.isReady = true; h._ready(true); for ( const f of ext.start ) { try { f(h); } catch ( e ) { console.warn("LETR | start hook", e); } } }
          continue;
        }
        const idx = picAt(h, t - h.t0);
        if ( idx < 0 ) { finish(h, h.stopWhy ?? "done"); continue; }
        if ( h.space === "world" ) h.worldAlive = worldN;
        resize(h, false);
        refreshElevation(h, t);
        place(h);
        if ( h.gone && h.stopWhy == null ) h.stop();   // F11: its token went away: the word plays its exit where it last was
        let c = picture(h, idx, false);
        if ( c?.stale && budget > 0 && redraws < MAX_REDRAWS ) { redraws++; const t1 = now(); c = picture(h, idx, true); budget -= now() - t1; }
        if ( !c && budget > 0 ) { const t1 = now(); c = picture(h, idx, true); budget -= now() - t1; }   // over budget: the older picture stays
        if ( c ) { const was = h.shown; show(h, c); if ( was !== h.shown ) place(h); }
      } catch ( e ) { console.warn("LETR | word failed", e); finish(h, "evicted"); }
    }
    /* pre-render what comes next, nearest first */
    for ( const h of clips ) {
      if ( budget <= 0 ) break;
      if ( h.t0 == null ) continue;
      const n = nextIdx(h, t - h.t0);
      if ( n >= 0 ) { const t1 = now(); picture(h, n, true); budget -= now() - t1; }
    }
    if ( clips.size || queue.length ) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if ( !raf ) raf = requestAnimationFrame(frame); };

  /* ---------- API ---------- */
  /* FXLE F3: a text longer than MAX_CHARS is cut (with an ellipsis) */
  function textOf(text) {
    const s = String(text ?? ""), cps = [...s];
    if ( cps.length <= MAX_CHARS ) return s;
    warnOnce("long-text", `LETR | text longer than ${MAX_CHARS} characters is cut`);
    return cps.slice(0, MAX_CHARS - 1).join("") + "…";
  }
  /* FXLE F18: `hand` may be a handle's `hand` string: the recent hand of that id (the exact look), else design.mjs reads the id */
  function handOpt(o) {
    if ( typeof o.hand === "string" ) { const x = hands.get(o.hand); return x ? { ...o, hand: x } : o; }
    if ( o.hand != null && typeof o.hand !== "object" ) { const c = { ...o }; delete c.hand; return c; }
    return o;
  }
  function remember(hand) { hands.delete(hand.id); hands.set(hand.id, hand); if ( hands.size > 128 ) hands.delete(hands.keys().next().value); }
  /* FXLE F23: a character no font can letter is drawn as "?": say so once per character */
  function warnGlyphs() { if ( bank.missing?.size ) for ( const ch of bank.missing ) warnOnce(`glyph:${ch}`, `LETR | no font has "${ch}" (U+${ch.codePointAt(0).toString(16).toUpperCase()}); drawn as "?"`); }
  const settle = (p, f) => { try { if ( p && typeof p.then === "function" ) p.then(f, f); } catch {} };

  function play(text, opts0 = {}) {
    const opts = filterOpts(handOpt(cleanOpts(opts0)));
    if ( opts === null ) return offHandle(text, opts0);
    const space = opts.space === "world" ? "world" : "screen";
    if ( !readyP ) ready();
    let done, rdy;
    const h = {
      id: `letr${++seq}`, seq, text: textOf(text), space, opts, alive: true, isReady: false, cache: [], shown: null, timer: 0,
      ready: new Promise((r) => (rdy = r)), finished: new Promise((r) => (done = r)),
      stop(o = {}) {
        if ( !h.alive ) return;
        h.stopWhy = o.why ?? "stopped";
        if ( o.quick || !h.shown || h.t0 == null ) { finish(h, h.stopWhy); return; }   // nothing on screen yet: it simply ends
        const t = now() - h.t0, natural = h.loop ? Infinity : h.entMs + h.holdMs;
        if ( !(h.exitAt != null && h.exitAt <= t) && t < natural ) h.exitAt = t;
        h.loop = false;
        kick();
      },
      moveTo(at) { h.at = at; h.gone = false; }
    };
    h._done = done; h._ready = rdy;
    h.at = opts.at;
    h.pixel = space === "world" && !!opts.pixel;
    /* plan the word (cheap, synchronous when it starts now: `hand` and `plan` are set on return); the heavy part waits for the frame loop */
    const start = () => {
      h.timer = 0;
      if ( !h.alive ) return;
      try {
        if ( space === "world" && !globalThis.canvas?.ready ) { finish(h, "evicted"); return; }
        const reduced = opts.reduced ?? reducedPref();
        let from = opts.from;
        if ( from && typeof from === "object" ) {
          if ( Number.isFinite(from.x) && Number.isFinite(from.y) ) { const p = space === "world" ? worldPoint(h) : screenPoint(h); from = p ? Math.atan2(from.y - p.y, from.x - p.x) * 180 / Math.PI : null; }
          else from = null;
        } else if ( from != null && !Number.isFinite(from) ) from = null;
        for ( let i = memory.length - 1; i >= 0; i-- ) if ( now() - memory[i].t > MEMORY_MS ) memory.splice(i, 1);
        const mem = opts.seed == null ? memory.map((m) => m.id) : [];
        const grp = opts._group;
        const avoid = [...(Array.isArray(opts.avoid) ? opts.avoid : []), ...(grp?.used ?? [])];
        let plan = makePlan(h.text, { ...opts, avoid, reduced, from }, fontsApi, mem);
        /* FXLE F16: a burst guarantees a different hand per word, also when its items have delays or share one seed */
        for ( let r = 1; grp && grp.used.includes(plan.hand.id) && r <= 6; r++ )
          plan = makePlan(h.text, { ...opts, avoid, reduced, from, seed: opts.seed != null ? `${opts.seed}~${r}` : undefined }, fontsApi, mem);
        if ( grp ) grp.used.push(plan.hand.id);
        h.plan = plan;
        if ( opts.seed == null ) memory.push({ id: plan.hand.id, t: now() });
        h.hand = plan.hand.id;
        remember(plan.hand);
        warnGlyphs();
        queue.push(h);
        kick();
      } catch ( e ) { console.warn("LETR | word failed", e); finish(h, "evicted"); }
    };
    pending.add(h);
    settle(opts.until, () => h.stop());
    const go = () => { if ( bank.has("bangers") || bank.has("anton") ) start(); else readyP.then(start, (e) => { console.warn("LETR", e); finish(h, "evicted"); }); };
    if ( opts.delay > 0 ) h.timer = setTimeout(() => { h.timer = 0; if ( h.alive ) go(); }, opts.delay); else go();
    return h;
  }
  /* lettering is off on this client (tools: the master switch): a handle that is already over */
  function offHandle(text, opts) {
    return { id: `letr${++seq}`, seq, text: textOf(text), space: opts?.space === "world" ? "world" : "screen", opts: opts ?? {}, alive: false, off: true, hand: null,
      isReady: false, ready: Promise.resolve(false), finished: Promise.resolve("evicted"), stop() {}, moveTo() {} };
  }

  /* ---------- streams: a sound that repeats or lasts as long as an effect (ratatata of a gun, a crackling fire) ---------- */
  function stream(o0 = {}) {
    const o = { ...(o0 && typeof o0 === "object" ? o0 : {}) };
    /* WORD (v5): a sound kind instead of a text: the vocabulary gives the syllables and the mood */
    if ( o.kind != null && o.text == null && !(Array.isArray(o.syllables) && o.syllables.length) ) { const w = vocab.word(o.kind, { ...o, stream: true }); Object.assign(o, { mood: o.mood ?? w.mood, syllables: w.syllables }); }
    /* FXLE F20: numbers checked; a bad one is ignored with one warning */
    const num = (k, ok, d) => {
      if ( o[k] == null ) return d;
      if ( typeof o[k] === "number" && Number.isFinite(o[k]) && ok(o[k]) ) return o[k];
      warnOnce(`stream:${k}`, `LETR | stream option ${k} = ${String(o[k])} ignored (not a usable number)`);
      return d;
    };
    const space = o.space === "world" ? "world" : "screen";
    const syl = Array.isArray(o.syllables) && o.syllables.length ? o.syllables.map(String) : syllablesOf(o.text ?? "RA-TA-TA");
    const every = num("every", (v) => v >= 20, 110), life = num("life", (v) => v > 0, 340);
    const cnt = num("count", (v) => v >= 0, undefined), duration = num("duration", (v) => v > 0, undefined), delay = num("delay", (v) => v >= 0, 0);
    const fixedSize = num("size", (v) => v > 0, undefined);
    let startAt = num("startAt", () => true, undefined);
    if ( startAt > now() + FUTURE_MS ) { warnOnce("opt:startAt", "LETR | startAt is far in the future: it must be this page's performance.now(); ignored"); startAt = undefined; }
    const mood = cleanOpts({ mood: o.mood ?? "impact" }).mood;
    const seedBase = o.seed ?? `s${(Math.random() * 1e9) | 0}`;
    const handles = [], timers = new Set();
    let k = 0, emitted = 0, hand = null, alive = true, done;
    const finished = new Promise((r) => (done = r));
    const srcH = { at: o.at };   // keeps the last point of a moving source, and notices a source token that went away (F11)
    const src = () => (space === "world" ? worldPoint(srcH) : screenPoint(srcH));
    const dirAt = (p) => {
      let to = null;
      try { to = typeof o.to === "function" ? o.to() : o.to; } catch { to = null; }
      if ( to ) { const q = isToken(to) ? (space === "world" ? worldPoint({ at: to }) : screenPoint({ at: to })) : to; if ( q && p && Number.isFinite(q.x) && Number.isFinite(q.y) ) return Math.atan2(q.y - p.y, q.x - p.x); }
      return ((Number.isFinite(o.dir) ? o.dir : -90) * Math.PI) / 180;
    };
    const tokenRef = o.token ?? (isToken(o.at) ? o.at : undefined);
    /* one syllable's natural size: the model's size for this stream (token, area, magnitude), 62 % of a whole word; play() then
       clamps every syllable to the legible range with the live zoom */
    const streamUnit = () => {
      const fake = { space, opts: { magnitude: o.magnitude, area: o.area, span: o.span, token: tokenRef ?? null }, at: o.at, pixel: false, plan: { sizeK: 1, _holdBox: { w: 1.2 } } };
      fake.tokenSpan = space === "world" ? tokenSpanOf(fake) : 0;
      const c = sizeCtx(fake); c.fit = "world";
      return sizeFor(c).natural * 0.62;
    };
    /* the stream's one hand = the first syllable's, the same on every client whenever it joins (FXLE F9) */
    const handOf = () => {
      if ( hand ) return hand;
      try { hand = makePlan(syl[0], { mood, seed: `${seedBase}:0`, colors: o.colors }, fontsApi, []).hand; remember(hand); } catch { hand = null; }
      return hand;
    };
    const beat = (text, when, idx) => {
      if ( !alive ) return null;
      try {
        const i = idx ?? k; k = i + 1;
        const word = text != null ? String(text) : (syl[i === 0 ? 0 : 1 + ((i - 1) % Math.max(1, syl.length - 1))] ?? syl[0]);
        const p0 = src();
        if ( srcH.gone || !p0 ) { if ( srcH.gone ) stop(); return null; }
        const ang = dirAt(p0) + (((i % 2) ? 1 : -1) * (Number.isFinite(o.spread) ? o.spread : 10) * Math.PI) / 180;
        const unit = fixedSize ?? streamUnit();
        const travel = (Number.isFinite(o.travel) ? o.travel : 1.6) * unit, side = ((i % 3) - 1) * unit * 0.25, t0 = when ?? now();
        /* FXLE F17: loud 0 is quiet (it was read as "not given") */
        let lv = 1;
        if ( typeof o.loud === "function" ) { try { lv = o.loud(i); } catch { lv = 1; } } else if ( o.loud != null ) lv = o.loud;
        const loud = Number.isFinite(lv) ? Math.max(0, Math.min(1, lv)) : 1;
        const at = () => {
          const p = src() ?? p0, u = Math.min(1, Math.max(0, now() - t0) / (life + 200));
          const e = 1 - (1 - u) * (1 - u);
          return { x: p.x + Math.cos(ang) * (unit * 0.5 + travel * e) - Math.sin(ang) * side, y: p.y + Math.sin(ang) * (unit * 0.5 + travel * e) + Math.cos(ang) * side };
        };
        const tilt = 0;   // syllables stay upright to read; the travel direction shows in where they go, not in their tilt
        const h = play(word, { _stream: i === 0 ? syl.join(" ") : true, alt: i === 0 ? o.alt : undefined, palette: o.palette, mood, space, size: unit * (0.85 + 0.25 * loud) * (i === 0 ? 1.15 : 1), magnitude: o.magnitude, fit: o.fit, ceilK: o.ceilK ?? 0.55, seed: `${seedBase}:${i}`, hand: handOf() ?? undefined,
          in: o.in ?? "slam", out: o.out ?? "pop", holdKind: "shake", hold: life, tempo: o.tempo ?? 1.6, at, pixel: o.pixel, rotation: (Number.isFinite(o.rotation) ? o.rotation : 0) + tilt + (((i * 7) % 5) - 2) * 3,
          zIndex: o.zIndex, reduced: o.reduced, parent: o.parent, colors: o.colors, layer: o.layer, startAt: when, token: tokenRef, vision: o.vision, elevation: o.elevation });
        emitted++;
        /* FXLE F10: only the syllables still alive are kept */
        handles.push(h);
        h.finished.then(() => { const j = handles.indexOf(h); if ( j >= 0 ) handles.splice(j, 1); });
        return h;
      } catch ( e ) { warnOnce("stream-beat", "LETR | a stream syllable failed", e); return null; }
    };
    const later = (fn, when) => { const id = setTimeout(() => { timers.delete(id); fn(); }, Math.max(0, when - now())); timers.add(id); };
    const stop = (q = {}) => {
      if ( !alive ) return;
      alive = false; streams.delete(s);
      for ( const id of timers ) clearTimeout(id);
      timers.clear();
      if ( q.quick ) for ( const h of [...handles] ) h.stop({ quick: true });
      Promise.all(handles.map((h) => h.finished)).then(() => done(q.quick ? "stopped" : "done"));
    };
    const s = { space, handles, finished, beat: (text) => beat(text), stop, get alive() { return alive; }, get emitted() { return emitted; } };
    streams.add(s);
    /* FXLE F9: on the effect's clock: a stream joined late skips the syllables whose life is already over and each syllable joins
       its own timeline at its due time; a duration counts from startAt */
    const tStart = Number.isFinite(startAt) ? startAt : now() + delay;
    const over = (when) => when + life + 200 < now();
    if ( Array.isArray(o.beats) ) {
      const bs = o.beats.filter((ms) => Number.isFinite(ms) && ms >= 0).sort((a, b) => a - b);
      bs.forEach((ms, j) => { const when = tStart + ms; if ( !over(when) ) later(() => beat(undefined, when, j), when); });
      later(() => stop(), tStart + (bs.at(-1) ?? 0) + 20);
    } else if ( !o.manual ) {
      const n = cnt != null ? Math.floor(cnt) : (duration ? Math.max(1, Math.floor(duration / every)) : o.until ? Infinity : 6);
      const timeOf = (j) => tStart + every * (j + (o.swing && j % 2 ? 0.15 : 0));
      let j = Math.max(0, Math.floor((now() - life - 200 - tStart) / every) - 1);
      while ( j < n && over(timeOf(j)) ) j++;
      const tick = (i) => { if ( !alive ) return; if ( i >= n ) { stop(); return; } beat(undefined, timeOf(i), i); later(() => tick(i + 1), timeOf(i + 1)); };
      later(() => tick(j), timeOf(j));
    }
    settle(o.until, () => stop());
    return s;
  }

  function burst(items, common = {}) {
    const group = { used: [] };
    const c = common && typeof common === "object" ? common : {};
    return (Array.isArray(items) ? items : []).map((it, i) => {
      const item = it && typeof it === "object" ? it : { text: it };
      /* FXLE F16: a shared seed gives each item its own (still identical on every client) */
      const seed = item.seed ?? (c.seed != null ? `${c.seed}:${i}` : undefined);
      return play(item.text, { ...c, ...item, seed, avoid: [...(Array.isArray(c.avoid) ? c.avoid : []), ...(Array.isArray(item.avoid) ? item.avoid : [])], _group: group });
    });
  }

  async function still(text, opts0 = {}) {
    await ready();
    const opts = filterOpts(handOpt(cleanOpts({ ...opts0, force: true }))) ?? {};
    const plan = makePlan(textOf(text), { ...opts, reduced: true }, fontsApi, []);
    for ( const f of ext.plan ) f(plan, { opts: { ...opts, reduced: true }, still: true });
    settleCenter(plan, bank);
    const dpr = opts.dpr ?? (globalThis.devicePixelRatio || 1);
    const S = Math.max(4, (opts.size ?? 72) * plan.sizeK * dpr);
    const p = plan.timeline.hold[0];
    return paintPicture(plan, bank, opts.picture ? opts.picture(plan) : p, S, makeCanvas).canvas;
  }

  function design(text, opts = {}) {
    const plan = makePlan(textOf(text), handOpt(cleanOpts(opts)), fontsApi, []);
    return JSON.parse(JSON.stringify(plan));
  }

  /* the size a word would get right now, and why (for callers and tests): { size, px, natural, clamp, fit, sizeK } */
  function sizeOf(text, opts0 = {}) {
    const opts = filterOpts(handOpt(cleanOpts({ ...opts0, force: true }))) ?? {};
    const space = opts.space === "world" ? "world" : "screen";
    const plan = makePlan(textOf(text), { ...opts, reduced: true }, fontsApi, []);
    try { settleCenter(plan, bank); } catch {}
    const h = { space, opts, at: opts.at, plan, pixel: space === "world" && !!opts.pixel };
    h.tokenSpan = space === "world" ? tokenSpanOf(h) : 0; h.worldAlive = space === "world" ? count({ space: "world" }) : 0;
    resize(h, true);
    return { ...h.sizeInfo, size: h.size, sizeK: plan.sizeK };
  }

  /* FXLE F4: stopAll and a scene change reach every word, also those still waiting (delay, fonts, queued), and every stream */
  function stopAll(o = {}) {
    const quick = o.quick ?? true;
    for ( const s of [...streams] ) if ( !o.space || s.space === o.space ) s.stop({ quick });
    for ( const h of [...clips, ...pending] ) if ( !o.space || h.space === o.space ) h.stop({ quick });
  }
  function count(o = {}) { let n = 0; for ( const h of clips ) if ( !o.space || h.space === o.space ) n++; return n; }

  /* FXLE F22: on a scene change our layer containers go too (the `top` one lives on canvas.stage, which Foundry keeps) */
  function tearDown() {
    for ( const s of [...streams] ) if ( s.space === "world" ) s.stop({ quick: true });
    for ( const h of [...clips, ...pending] ) if ( h.space === "world" ) h.stop({ quick: true, why: "evicted" });
    for ( const c of worldLayers.values() ) { try { if ( !c.destroyed ) { c.parent?.removeChild(c); c.destroy({ children: true }); } } catch {} }
    worldLayers.clear();
  }
  try { globalThis.Hooks?.on?.("canvasTearDown", tearDown); } catch {}
  /* settings helpers: choices for game.settings.register, per space */
  const layerChoices = (space = "world", lang = globalThis.game?.i18n?.lang) => Object.fromEntries(Object.entries(LAYERS).filter(([, v]) => v.space === space).map(([k, v]) => [k, lang === "pl" ? v.pl : v.en]));

  /* WORD (v5): the vocabulary layer (words.mjs): a sound kind + loudness + language -> a fitting word; sfx() letters it */
  const vocab = createVocab();
  const VOCAB_KEYS = ["kind", "loud", "lang", "step", "template", "prefix", "long", "duration", "bangs"];
  function sfx(kind, opts = {}) {
    const w = vocab.word(kind, opts);
    const rest = Object.fromEntries(Object.entries(opts).filter(([k]) => !VOCAB_KEYS.includes(k)));
    const h = play(w.text, { ...w.play, ...rest, sound: { ...w.play.sound, ...(opts.sound ?? {}) }, magnitude: opts.magnitude ?? w.play.magnitude });
    h.word = w;
    return h;
  }

  const api = {
    version: VERSION, base, limits, stats, defaults, layers: LAYERS, layerChoices,
    moods: MOOD_IDS.map((id) => ({ id, label: MOODS[id].label, sound: { ...MOODS[id].sound } })),
    ready, play, stream, burst, still, design, stopAll, count, sizeOf, sizeModel: SIZE,
    vocab, word: vocab.word, sfx, number: vocab.number, range: vocab.range, flow: vocab.flow,
    async gallery(o = {}) { const g = await import("./gallery.mjs"); return g.gallery(api, o); },
    /* for tests and the gallery page */
    _ext: ext, _settle: (plan) => settleCenter(plan, bank),
    _bank: bank, _plan: (t, o = {}) => makePlan(t, o, fontsApi, []), _paint: (plan, p, S) => { settleCenter(plan, bank); return paintPicture(plan, bank, p, S, makeCanvas); }
  };
  return api;
}
