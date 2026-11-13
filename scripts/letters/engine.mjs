/* LETR engine: fonts, the picture scheduler, the two players (screen = HTML layer over the interface, world = PIXI on the canvas)
   and the public API (see README.md). Works without Foundry for the screen space (gallery page, node-free browser tests). */
import { makePlan, MOODS, MOOD_IDS, TICK, FONTS, syllablesOf, STYLES } from "./design.mjs";
import { FontBank } from "./fontbank.mjs";
import { paintPicture } from "./paint.mjs";
import { settleCenter } from "./shape.mjs";
import { sizeFor, SIZE, magnitudeOf } from "./size.mjs";
import { onOf, stepT, easeOf, orientAngle, pathSpec, pathPoints, pathAt, orbitAt, bendLayout, addTrail, TICK_MS } from "./move.mjs";
import { rng, hash } from "./rng.mjs";
import { makeSustain, AMBIENT_MAX } from "./sustain.mjs";
import { createVocab } from "./words.mjs";

export const VERSION = "1.7.0";   // v7+v8 merged: MOVE (contract v7, 1.5.0: travel, choreography, rates, escalation, shards, push, glow, continuous sounds) + LOOK (contract v8, 1.6.0: lines, backdrops, deformation, fills, legibility, accent, look styles, sound->look); 1.4.1 TOOL; 1.3.1 WORD; 1.2.1 FXLE
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
const GLOW_MOODS = new Set(["fire", "zap", "powerup"]);   // glow: "auto" lights these (world: when the scene is dark)

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
  const escMem = new Map();     // escalation: key (space|source|word) -> { n, t, win, h } (README "Motion: escalation")
  let glowLayer = null;         // world glow: the lights of self-lit words, in Foundry's illumination container
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
  /* LOOK: the lettering tradition every call gets unless it names one (opts.look.style, or TOOL's built-in styles "invincible" /
     "comic"): "invincible" in a world of the Invincible system (the book's own lettering), "comic" elsewhere; L.lookStyle(name)
     changes it for this client */
  let defLook = globalThis.game?.system?.id === "invincible" ? "invincible" : "comic";
  const mk = (t, o, f, m) => {
    if ( o?.look?.style ) return makePlan(t, o, f, m);
    const ls = typeof o?.style === "string" && STYLES.includes(o.style) ? o.style : defLook;   // TOOL's built-in style names too
    return makePlan(t, { ...o, look: { ...(o?.look ?? {}), style: ls } }, f, m);
  };
  const lookStyle = (name) => { if ( STYLES.includes(name) ) defLook = name; return defLook; };

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
  /* ADVT 10/9: the picture clock. A word's pictures run on its own age (wall time minus the time it lost waiting for a late picture):
     an entrance or exit picture is never skipped and a late one starts from its beginning, so every seat sees the same drawings for
     the same beats (a slow seat runs a few frames longer instead of jumping over the anticipation or blinking out of the exit). */
  const ageOf = (h, t) => t - h.t0 - (h.lag || 0);
  function picStart(h, i) {
    const tl = h.plan.timeline;
    if ( i < h.eN ) { let a = 0; for ( let k = 0; k < i; k++ ) a += tl.ent[k].ticks * TICK; return a; }
    const x0 = h.eN + h.hN, exitStart = h.exitAt ?? (h.loop ? Infinity : h.entMs + h.holdMs);
    let a = exitStart; for ( let k = x0; k < i; k++ ) a += tl.exit[k - x0].ticks * TICK; return a;
  }
  /* the picture to show now: picAt, except that a skipped entrance/exit picture comes first (and the clock waits for it) */
  function pictureNow(h, t) {
    let age = ageOf(h, t), idx = picAt(h, age);
    const last = h.lastIdx, x0 = h.eN + h.hN, xN = x0 + h.plan.timeline.exit.length;
    if ( last != null && !h.quick ) {
      let want = null;
      if ( last < h.eN - 1 && (idx > last + 1 || idx < 0) && h.exitAt == null ) want = last + 1;                  // inside the entrance
      else if ( (idx < 0 || idx > x0) && last < xN - 1 ) {                                                    // inside the exit
        const exp = last >= x0 ? last + 1 : x0;
        if ( idx < 0 ? exp < xN : idx > exp ) want = exp;
      }
      if ( want != null ) { h.lag = (h.lag || 0) + (age - picStart(h, want)); age = picStart(h, want); idx = want; }
    }
    return { idx, age };
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
  /* ---------- travel (move.mjs): paths, thrown arcs, beams, orbits around a moving centre ---------- */
  /* a point-like NOW in this word's space: the centre of a token (not the spot above it), a point, a function */
  function pointOf(space, a) {
    if ( a == null ) return null;
    const v = typeof a === "function" ? a() : a;
    if ( v == null ) return null;
    if ( isToken(v) ) {
      const t = tokenObj(v); if ( !t?.center ) return null;
      if ( space === "world" ) return { x: t.center.x, y: t.center.y };
      const g = canvas.stage.toGlobal(t.center), r = canvas.app.view.getBoundingClientRect();
      return { x: r.left + g.x, y: r.top + g.y };
    }
    return Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null;
  }
  function setupTravel(h) {
    const o = h.opts;
    const raw = o.orbit ? o.orbit : o.path;
    if ( !raw ) return;
    const kind = o.orbit ? "orbit" : "path";
    const spec = kind === "orbit" ? { ...raw } : (Array.isArray(raw) ? { points: raw } : pathSpec(raw));
    if ( !spec ) return;
    const R = rng((h.plan.seed ^ 0x2c1b3c6d) >>> 0);
    const tr = h.travel = { kind, spec, on: h.plan.on || 2, orient: spec.orient ?? (kind === "orbit" ? "bend" : "lean") };
    const unit = () => h.size * h.plan.sizeK;
    if ( kind === "orbit" ) {
      tr.center = spec.center ?? h.at;
      tr.dir = spec.dir < 0 ? -1 : 1;
      tr.period = Math.max(300, spec.period ?? 2600);
      tr.phase = Number.isFinite(spec.phase) ? spec.phase : -90 + R.f(-40, 40);
      tr.squash = spec.squash ?? 1; tr.breathe = spec.breathe ?? 0.06;
      const c = typeof tr.center === "function" ? null : tr.center;
      const span = h.space === "world" ? (Number.isFinite(o.span) && o.span > 0 ? o.span : isToken(c) ? Math.max(tokenObj(c)?.document?.width ?? 1, tokenObj(c)?.document?.height ?? 1) * (canvas.grid?.size ?? 100) : 0) : 0;
      tr.R = Number.isFinite(spec.radius) && spec.radius > 0 ? spec.radius : span ? span * 0.85 : areaOf(o.area) || unit() * 2.6;
      tr.bend = tr.orient === "bend" && !h.reducedMotion;
      if ( tr.bend ) {
        /* the word lies on the circle: bend it with the orbit's radius in its own units (twice: the bend changes its width, so
           its size, so its units) */
        for ( let k = 0; k < 2; k++ ) { bendLayout(h.plan, tr.R / unit(), tr.dir); delete h.plan._center; settleCenter(h.plan, bank); resize(h, true); }
        h.offset = { x: h.plan._center[0] - h.plan.layout.W / 2, y: h.plan._center[1] + 0.5 };
      }
      if ( Number.isFinite(spec.turns) && spec.turns > 0 && !h.loop ) h.holdMs = Math.max(h.holdMs, spec.turns * tr.period - h.entMs);
      if ( spec.trail !== false && !h.reducedMotion ) addTrail(h.plan, "orbit", 1, () => R.seed());
    } else {
      tr.dur = Math.max(50, spec.duration ?? (h.entMs + h.holdMs));
      tr.loop = !!spec.loop;
      if ( !tr.loop && !h.loop && tr.dur > h.entMs + h.holdMs ) h.holdMs = tr.dur - h.entMs;
      tr.ease = easeOf(spec.ease ?? (spec.arc ? "linear" : "inout"));
      tr.spin = Number.isFinite(spec.spin) ? spec.spin : 0;
      const P = pathPoints(spec, (a) => pointOf(h.space, a)), q = P || spec.fn ? pathAt(P, 0.02, spec) : null;
      const a0 = q ? q.a : 0, r0 = orientAngle(a0, tr.orient);
      if ( spec.trail !== false && !h.reducedMotion && !tr.spin ) addTrail(h.plan, "path", Math.cos(a0 - r0) >= 0 ? 1 : -1, () => R.seed());
    }
  }
  /* where a travelling word is at t ms of its life: { x, y, rot } (null: its path or centre is gone and it never had a place) */
  function travelPose(h, t) {
    const tr = h.travel;
    const tt = h.reducedMotion ? 0 : stepT(Math.max(0, t), tr.on);
    if ( tr.kind === "orbit" ) {
      const c = pointOf(h.space, tr.center) ?? tr.lastC ?? (h.space === "world" ? worldPoint({ at: null }) : screenPoint({ at: null }));
      tr.lastC = c;
      const o = orbitAt(tr, tt, c, tr.R);
      return (tr.last = { x: o.x, y: o.y, rot: tr.bend ? o.a : orientAngle(o.a, tr.orient) });
    }
    const P = pathPoints(tr.spec, (a) => pointOf(h.space, a));
    if ( !P && !tr.spec.fn ) return tr.last ?? null;
    let u = h.reducedMotion ? 1 : tt / tr.dur;
    u = tr.loop ? u % 1 : Math.min(1, u);
    const q = pathAt(P, tr.ease(u), tr.spec);
    if ( !q ) return tr.last ?? null;
    return (tr.last = { x: q.x, y: q.y, rot: orientAngle(q.a, tr.orient) + tr.spin * Math.PI * 2 * u });
  }

  /* ---------- knocks: a word pushed aside by a later blast (L.push, play's `push`) ---------- */
  function knockOf(h, t) {
    let x = 0, y = 0, r = 0, s = 1;
    for ( const k of h.knocks ) {
      const u = Math.min(1, stepT(t - k.t0, h.plan.on || 2) / k.dur);
      const e = (1 - (1 - u) ** 3) * (1 + 0.22 * Math.sin(Math.PI * u));   // out fast, overshoot, settle (follow-through)
      x += k.dx * e; y += k.dy * e; r += k.dr * e;
      if ( u < 1 ) s *= 1 + 0.16 * (1 - u) * Math.sin(Math.PI * Math.min(1, u * 2.5));   // the blow squashes it bigger for a moment
    }
    return { x, y, r, s };
  }

  /* ---------- ADVT 1: a word stays inside the view ----------
     The reach of a word around its place (units, from its centre): its hold box, how far its hold drawings move, and how far its
     entrance drawings move (up to 1.2 units: a drop from far above may start outside), plus the ink's outline. Exits may leave. */
  let viewInset = { top: 8, right: 8, bottom: 8, left: 8 };
  function reachOf(h) {
    const hb = h.plan._holdBox ?? { w: 3, h: 1 }, tl = h.plan.timeline;
    let l = hb.w / 2, r = hb.w / 2, u = hb.h / 2, d = hb.h / 2;
    const take = (p, cap) => {
      const g = p.g ?? {}, sc = Math.min(1.5, Math.abs((g.s ?? 1) * Math.max(g.sx ?? 1, g.sy ?? 1)));
      const gx = Math.max(-cap, Math.min(cap, g.x ?? 0)), gy = Math.max(-cap, Math.min(cap, g.y ?? 0));
      l = Math.max(l, hb.w / 2 * sc - gx); r = Math.max(r, hb.w / 2 * sc + gx); u = Math.max(u, hb.h / 2 * sc - gy); d = Math.max(d, hb.h / 2 * sc + gy);
    };
    for ( const p of tl.hold ) take(p, 3);
    for ( const p of tl.ent ) take(p, 1.2);
    /* ADVM 7: letters that fall in or rise in from above / below (their own offsets, em) are kept inside the view from the first drawing */
    for ( const p of tl.ent ) for ( const q of p.letters ?? [] ) {
      if ( q.v === 0 || !Number.isFinite(q.y) ) continue;
      const gy = p.g?.y ?? 0, y = Math.max(-3, Math.min(3, q.y + gy));
      u = Math.max(u, hb.h / 2 - y); d = Math.max(d, hb.h / 2 + y);
    }
    const pad = 0.18;
    return { l: l + pad, r: r + pad, u: u + pad, d: d + pad };
  }
  /* the visible rectangle in the word's space (world: scene coordinates), minus the insets (sidebar, letterbox, set by L.viewInset) */
  function viewRect(h) {
    const ins = typeof viewInset === "function" ? (viewInset(h.space) ?? {}) : viewInset;
    const sb = globalThis.document?.getElementById?.("sidebar")?.getBoundingClientRect?.();
    const W = globalThis.innerWidth, H = globalThis.innerHeight;
    if ( !Number.isFinite(W) || !Number.isFinite(H) ) return null;
    const right = W - (sb && sb.left > W * 0.5 ? sb.width : 0);
    const L = ins.left ?? 0, T = ins.top ?? 0, R = right - (ins.right ?? 0), B = H - (ins.bottom ?? 0);
    if ( h.space === "screen" ) return { x0: L, y0: T, x1: R, y1: B };
    const st = globalThis.canvas?.stage, view = globalThis.canvas?.app?.view;
    if ( !st?.toLocal || !view?.getBoundingClientRect ) return null;
    const vr = view.getBoundingClientRect(), a = st.toLocal({ x: L - vr.left, y: T - vr.top }), b = st.toLocal({ x: R - vr.left, y: B - vr.top });
    return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
  }
  /* how far to move a word placed at X, Y (its centre) so that its reach fits the view; a word bigger than the view is centred */
  function viewShift(h, X, Y, rot) {
    if ( h.travel || h.opts.keepInView === false || h.opts.parent ) return null;
    const v = viewRect(h); if ( !v ) return null;
    const e = h.reach ??= reachOf(h), k = h.size * h.plan.sizeK;
    const c = Math.abs(Math.cos(rot)), sn = Math.abs(Math.sin(rot));
    const l = (e.l * c + Math.max(e.u, e.d) * sn) * k, r = (e.r * c + Math.max(e.u, e.d) * sn) * k;
    const u = (e.u * c + Math.max(e.l, e.r) * sn) * k, d = (e.d * c + Math.max(e.l, e.r) * sn) * k;
    const fit = (p, lo, hi, a, b) => (hi - lo < a + b ? (lo + hi) / 2 + (a - b) / 2 - p : p - a < lo ? lo + a - p : p + b > hi ? hi - b - p : 0);
    return { dx: fit(X, v.x0, v.x1, l, r), dy: fit(Y, v.y0, v.y1, u, d) };
  }

  function place(h) {
    const t = now(), seen = seenOf(h, t);
    let p, trot = 0;
    if ( h.travel ) { p = travelPose(h, t - (h.t0 ?? t)); if ( !p ) return; trot = p.rot; }
    else { p = h.space === "world" ? worldPoint(h) : screenPoint(h); if ( !p ) return; }
    const k = h.size * h.plan.sizeK;
    /* the anchor offset turns with the travel (a word bent on an orbit keeps its middle on the circle) */
    const c = Math.cos(trot), sn = Math.sin(trot), ox = h.offset.x * k, oy = h.offset.y * k;
    let X = p.x + ox * c - oy * sn, Y = p.y + ox * sn + oy * c;
    const vs = viewShift(h, X, Y, h.rot + trot);
    if ( vs ) { X += vs.dx; Y += vs.dy; }
    h.lastPos = { x: X, y: Y }; h.lastRot = h.rot + trot;
    let kr = 0, ks = 1;
    if ( h.knocks?.length ) { const q = knockOf(h, t); X += q.x; Y += q.y; kr = q.r; ks = q.s; }
    /* ADVT 8 / ADVD 6: a held word keeps breathing: a slow sway, swell and bob over its whole hold (on the drawing grid), on top of
       its hold drawings, so a 2-3 s hold is never a still picture at viewing size; not for reduced motion, travel or pixel words */
    if ( !h.reducedMotion && !h.travel && !h.pixel && h.t0 != null && h.entMs != null ) {
      const ag = ageOf(h, t) - h.entMs;
      if ( ag > 0 ) {
        const u = stepT(ag, h.plan.on || 2) / 1000, ph = (h.plan.seed % 628) / 100, f = Math.min(1, ag / 300) * (0.7 + 0.6 * (h.plan.sound?.loud ?? 0.5));
        kr += f * 0.04 * Math.sin(u * 3.3 + ph); ks *= 1 + f * 0.035 * Math.sin(u * 4.6 + ph * 1.7); Y += f * 0.05 * k * Math.sin(u * 2.7 + ph * 0.6);
      }
    }
    const rot = h.rot + trot + kr;
    if ( h.space === "world" ) {
      h.sprite.visible = seen;
      h.sprite.position.set(X, Y);
      h.sprite.rotation = rot;
      if ( h.shown ) h.sprite.scale.set((1 / h.shown.rs) * (h.size / h.shown.size0) * ks);
      if ( h.glow ) { placeGlow(h, X, Y, rot, ks, t); h.glow.bloom.visible = seen; if ( h.glow.light ) h.glow.light.visible = seen; }
    } else {
      const vis = seen ? "" : "hidden";
      if ( h.box.style.visibility !== vis ) h.box.style.visibility = vis;
      const f = (h.shown ? h.size / h.shown.size0 : 1) * ks;
      h.box.style.transform = `translate(${X.toFixed(1)}px,${Y.toFixed(1)}px) rotate(${rot.toFixed(4)}rad)${Math.abs(f - 1) > 1e-3 ? ` scale(${f.toFixed(4)})` : ""}`;
    }
  }

  /* ---------- self-lit words (glow): fire and zap that light up a dark scene ----------
     world: a soft copy of the word's silhouette goes into Foundry's illumination (MAX blend, like a light: the darkness lifts where
     the word is, so the word shows in full colour and lights the ground around it) and an additive bloom sits behind the word in its
     own layer; both follow it and flicker on the drawing grid. screen: a CSS glow around the word. README "Motion: glow". */
  const sceneDark = () => { try { return globalThis.canvas?.environment?.darknessLevel ?? globalThis.canvas?.scene?.environment?.darknessLevel ?? 0; } catch { return 0; } };
  function glowWanted(h) {
    const g = h.opts.glow;
    if ( !g ) return null;
    const auto = g === "auto";
    if ( auto && !GLOW_MOODS.has(h.plan.mood) ) return null;
    if ( auto && h.space === "world" && sceneDark() < 0.25 ) return null;
    const o = typeof g === "object" ? g : {};
    return { color: o.color ?? h.plan.hand.pal.fill[1], strength: Number.isFinite(o.strength) ? o.strength : 1, light: o.light !== false };
  }
  function ensureGlowLayer() {
    const host = globalThis.canvas?.effects?.illumination?.lights;
    if ( !host ) return null;
    if ( !glowLayer || glowLayer.destroyed ) { glowLayer = new PIXI.Container(); glowLayer.name = "moinen-letters-glow"; glowLayer.eventMode = "none"; }
    if ( glowLayer.parent !== host ) host.addChild(glowLayer);
    return glowLayer;
  }
  const mixHex = (a, b, f) => { const c = (x, s) => (x >> s) & 255, m = (s) => Math.round(c(a, s) + (c(b, s) - c(a, s)) * f) << s; return m(16) | m(8) | m(0); };
  const hexOf = (c) => { const m = /^#?([\da-f]{6})$/i.exec(String(c).trim()); return m ? parseInt(m[1], 16) : 0xffd060; };
  function makeGlow(h) {
    const w = h.glowWant; h.glowWant = null;
    const S = Math.max(6, pxPerUnit(h, renderScale(h)) / 4);
    const pic = paintPicture(h.plan, bank, { ...h.plan.timeline.hold[0], fx: [], dissolve: 0 }, S, makeCanvas);
    const pad = Math.ceil(S * 0.9), cnv = makeCanvas(pic.canvas.width + pad * 2, pic.canvas.height + pad * 2), ctx = cnv.getContext("2d");
    try { ctx.filter = `blur(${Math.max(1, S * 0.28).toFixed(1)}px)`; } catch {}
    ctx.drawImage(pic.canvas, pad, pad);
    try { ctx.filter = "none"; } catch {}
    ctx.globalCompositeOperation = "source-in"; ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cnv.width, cnv.height);
    const ax = (pic.ax + pad) / cnv.width, ay = (pic.ay + pad) / cnv.height, S2 = pic.S;
    dropPic(pic);
    const tex = new PIXI.Texture(new PIXI.BaseTexture(cnv));
    const col = hexOf(w.color);
    const bloom = new PIXI.Sprite(tex); bloom.anchor.set(ax, ay); bloom.blendMode = PIXI.BLEND_MODES.ADD; bloom.tint = col; bloom.eventMode = "none";
    const parent = h.sprite.parent;
    if ( parent ) { bloom.zIndex = h.sprite.zIndex - 0.5; parent.addChildAt(bloom, Math.max(0, parent.getChildIndex(h.sprite))); }
    let light = null;
    const lay = w.light ? ensureGlowLayer() : null;
    if ( lay ) { light = new PIXI.Sprite(tex); light.anchor.set(ax, ay); light.blendMode = PIXI.BLEND_MODES.MAX_COLOR ?? PIXI.BLEND_MODES.ADD; light.tint = mixHex(col, 0xffffff, 0.45); light.eventMode = "none"; lay.addChild(light); }
    h.glow = { tex, cnv, bloom, light, S: S2, strength: w.strength, seed: h.plan.seed, flick: h.plan.mood === "zap" ? 0.45 : 0.22 };
  }
  function glowCss(h, w) {
    const k = Math.min(48, h.size * h.plan.sizeK), c = w.color;
    h.box.style.filter = `drop-shadow(0 0 ${(k * 0.1).toFixed(1)}px ${c}) drop-shadow(0 0 ${(k * 0.32 * w.strength).toFixed(1)}px ${c})`;
  }
  function placeGlow(h, X, Y, rot, ks, t) {
    const g = h.glow, sc = ((h.size * h.plan.sizeK) / g.S) * ks;
    const dark = Math.min(1, Math.max(0, sceneDark()));
    /* flicker per drawing (on the drawing grid, seeded: the same on every client), fading in with the entrance and out with the exit */
    const step = Math.floor(stepT(t - h.t0, h.plan.on || 2) / TICK_MS);
    const fl = h.reducedMotion ? 1 : 1 - g.flick + g.flick * ((hash(`${g.seed}:${step}`) % 1000) / 1000);
    const ex = h.exitAt != null || (!h.loop && ageOf(h, t) > h.entMs + h.holdMs) ? Math.max(0, 1 - (ageOf(h, t) - (h.exitAt ?? h.entMs + h.holdMs)) / Math.max(1, h.exitMs)) : 1;
    const ent = Math.min(1, ageOf(h, t) / Math.max(1, h.entMs * 0.6));
    const a = g.strength * fl * ex * ent;
    for ( const [sp, k, al] of [[g.bloom, 1.15, (0.18 + 0.55 * dark) * a], [g.light, 1.6, Math.min(1, 0.95 * a)]] ) {
      if ( !sp || sp.destroyed ) continue;
      sp.position.set(X, Y); sp.rotation = rot; sp.scale.set(sc * k); sp.alpha = al;
    }
  }
  function dropGlow(h) {
    const g = h.glow; if ( !g ) return;
    h.glow = null;
    for ( const sp of [g.bloom, g.light] ) { try { sp?.destroy({ texture: false }); } catch {} }
    try { g.tex.destroy(true); } catch {}
    g.cnv.width = 0; g.cnv.height = 0;
  }

  /* ---------- push: a later blast shoves the words around it aside (README "Motion: push") ---------- */
  function push(at, o = {}) {
    const space = o.space === "world" ? "world" : "screen";
    const P = pointOf(space, at);
    if ( !P ) return 0;
    const unit = space === "world" ? (globalThis.canvas?.grid?.size ?? 100) : Math.max(60, innerHeight * 0.085);
    const radius = Number.isFinite(o.radius) && o.radius > 0 ? o.radius : unit * 3, force = Number.isFinite(o.force) ? o.force : unit * 0.9;
    const R = rng(hash(`${o.seed ?? ""}:${Math.round(P.x)}:${Math.round(P.y)}`));
    let n = 0;
    for ( const h of [...clips].sort((a, b) => (a.id < b.id ? -1 : 1)) ) {
      if ( h.space !== space || h === o.except || !h.alive || !h.lastPos || h.opts.pushable === false || h.reducedMotion ) continue;
      const dx = h.lastPos.x - P.x, dy = h.lastPos.y - P.y, d = Math.hypot(dx, dy);
      if ( d > radius ) continue;
      const f = force * (1 - d / radius) ** 0.7, a = d > 1e-3 ? Math.atan2(dy, dx) : R.f(0, Math.PI * 2);
      const k = h.size * h.plan.sizeK;
      (h.knocks ??= []).push({ t0: now(), dx: Math.cos(a) * f, dy: Math.sin(a) * f, dr: (Math.cos(a) >= 0 ? 1 : -1) * Math.min(0.55, (f / Math.max(1, k)) * 0.22), dur: 320 });
      /* old knocks are folded into the word's offset (a bounded list) */
      while ( h.knocks.length > 6 ) { const old = h.knocks.shift(); h.offset = { x: h.offset.x + old.dx / k, y: h.offset.y + old.dy / k }; h.rot += old.dr; }
      n++;
    }
    kick();
    return n;
  }

  /* ---------- echoes: copies of a word that answer it, smaller and hollow, fading (README "Motion: choreography") ---------- */
  function spawnEcho(h, k) {
    const e = h.echo, p = h.lastPos;
    if ( !p ) return;
    const unit = h.size * h.plan.sizeK, a = (e.dir * Math.PI) / 180;
    const d = e.gap * unit * k * (1 + 0.15 * (k - 1));
    const o = h.opts;
    const c = play(h.text, {
      mood: h.plan.mood, space: h.space, layer: o.layer, fit: o.fit, magnitude: o.magnitude, area: o.area, span: h.tokenSpan || o.span, size: o.size, colors: o.colors, pixel: o.pixel, parent: o.parent, sound: o.sound,
      scale: (o.scale ?? 1) * e.shrink ** k, at: { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d }, hand: h.plan.hand,
      seed: o.seed != null ? `${o.seed}:echo${k}` : undefined, in: "pop", holdKind: "boil", out: "dissolve", hold: e.hold, tempo: o.tempo, on: o.on, fps: o.fps,
      reduced: false, hollow: e.hollow, rotation: ((h.lastRot ?? h.rot) * 180) / Math.PI + (k % 2 ? 4 : -4), zIndex: o.zIndex
    });
    c.isEcho = true;
    (h.echoes ??= []).push(c);
  }

  /* ---------- escalation: the same sound on the same source within a short time grows, merges ("BAM BAM BAM") and counts ("BAM ×5")
     Memory per client, keyed by space + source + the word; pass `escalate: { n }` for a level the caller decides (the same everywhere). */
  function sourceKey(at, space) {
    if ( at == null ) return "view";
    if ( typeof at === "function" ) return null;
    if ( typeof at === "string" ) return at;
    if ( isToken(at) ) return tokenObj(at)?.id ?? at.id ?? null;
    if ( Number.isFinite(at.x) ) { const g = space === "world" ? (globalThis.canvas?.grid?.size ?? 100) : 64; return `${Math.round(at.x / g)},${Math.round(at.y / g)}`; }
    return null;
  }
  function escalate(h, opts) {
    const e = opts.escalate;
    if ( !e ) return opts;
    const cfg = typeof e === "object" ? e : typeof e === "string" ? { key: e } : {};
    const win = Number.isFinite(cfg.window) ? cfg.window : 1600, max = Math.max(1, cfg.max ?? 3), mode = cfg.mode ?? "auto";
    const base = h.text.trim();
    const norm = base.toLocaleUpperCase("pl").replace(/[^\p{L}\p{N}]/gu, "");
    const src = cfg.key ?? opts.source ?? sourceKey(h.at, h.space);
    if ( src == null && !Number.isFinite(cfg.n) ) return opts;
    const key = `${h.space}|${src}|${norm}`, t = now();
    for ( const [k, v] of escMem ) if ( t - v.t > v.win * 2 ) escMem.delete(k);
    const prev = escMem.get(key);
    const n = Number.isFinite(cfg.n) ? Math.max(1, Math.floor(cfg.n)) : prev && t - prev.t <= win ? prev.n + 1 : 1;
    escMem.set(key, { n, t, win, h });
    const m = n < 2 ? "first" : mode === "auto" ? (n <= max ? "merge" : "count") : mode;
    h.escalation = { key, n, mode: m };
    if ( n < 2 ) return opts;
    const o = { ...opts }, k = n - 1;
    o.magnitude = Math.min(2, magnitudeOf(opts.magnitude) + Math.min(0.9, 0.2 * k));
    o.scale = (opts.scale ?? 1) * Math.min(1.45, 1 + 0.08 * k);
    const live = prev?.h && prev.h !== h && prev.h.alive && prev.h.plan ? prev.h : null;
    if ( live ) { o.hand = live.plan.hand; if ( typeof h.at !== "function" ) h.at = live.at; }
    if ( m === "merge" ) {
      const reps = Math.min(n, max), beat = opts.beat ?? 150;
      h.text = Array(reps).fill(base).join(" ");
      /* the repeats already up stay where they are; only the newest lands (on its own beat), knocking them */
      o.parts = Array.from({ length: reps }, (_, i) => ({ text: base, at: live ? (i < reps - 1 ? -1 : 0) : i * beat }));
    } else if ( m === "count" ) {
      h.text = `${base} ×${n}`;
      o.parts = [{ text: base, at: live ? -1 : 0 }, { text: `×${n}`, at: live ? 0 : 170, scale: 0.85 }];
    }
    if ( live ) live.stop({ quick: m !== "grow" });
    return o;
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
    dropGlow(h);
    if ( h.plan?._shardSrc ) { for ( const c of h.plan._shardSrc.values() ) dropPic(c); h.plan._shardSrc.clear(); }
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
    /* an orbit (or a looping path) tied to a Promise lasts as long as the thing it circles: until the Promise settles */
    h.loop = !!opts.loop || (!!opts.until?.then && opts.loop !== false && !!(opts.orbit || opts.path?.loop));
    h.tokenSpan = tokenSpanOf(h);
    h.worldAlive = space === "world" ? count({ space: "world" }) : 0;
    resize(h, true);
    if ( ext.plan.length ) { for ( const f of ext.plan ) f(h.plan, h); h.hand = h.plan.hand.id; }
    h.rot = ((opts.rotation ?? 0) * Math.PI) / 180;
    const anchor = opts.anchor ?? (isToken(h.at) ? "bottom" : "center");
    h.offset = { x: 0, y: anchor === "bottom" ? -(h.plan._holdBox.h / 2 + 0.1) : 0 };
    scheduleOf(h);
    if ( space === "world" ) worldPoint(h); else screenPoint(h);   // first known point (elevation at a point, F11)
    /* move (README "Motion"): travel, echoes, push, glow */
    const reduced = h.reducedMotion;
    if ( opts.path || opts.orbit ) { h.offset = { x: 0, y: 0 }; setupTravel(h); }
    if ( opts.echo && !reduced ) {
      const e = typeof opts.echo === "object" ? opts.echo : { n: opts.echo === true ? 2 : Number(opts.echo) };
      h.echo = { n: Math.max(1, Math.min(5, Math.floor(e.n ?? 2) || 2)), k: 1, every: e.every ?? 190, first: e.first ?? 70, gap: e.gap ?? 1.0, shrink: e.shrink ?? 0.74, hold: e.hold ?? 240, hollow: e.hollow ?? true,
        dir: Number.isFinite(e.dir) ? e.dir : Number.isFinite(h.fromDeg) ? h.fromDeg + 180 : 62 };
    }
    if ( opts.push && !reduced ) {
      const q = typeof opts.push === "object" ? opts.push : {}, unit = h.size * h.plan.sizeK;
      h.pushCfg = { radius: q.radius ?? Math.max(unit * 4.5, areaOf(opts.area) * 1.6), force: q.force ?? unit * 2, seed: opts.seed };
      /* at the contact: the first picture with an impact flash or a burst (else half-way through the entrance) */
      const ent = h.plan.timeline.ent; let a = 0, at = null;
      for ( const p of ent ) { if ( p.impact || p.fx?.some((f) => f.k === "burst") ) { at = a * TICK; break; } a += p.ticks; }
      h.pushT = at ?? h.entMs * 0.5;
    }
    const gw = glowWanted(h);
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
      if ( opts.hollow ) h.sprite.alpha = 0.85;
      parent.addChild(h.sprite);
      if ( gw ) h.glowWant = gw;
    } else {
      const lay = ensureLayer(h);
      h.box = document.createElement("div");
      h.box.className = "moinen-letter";
      Object.assign(h.box.style, { position: "absolute", left: "0", top: "0", width: "0", height: "0", zIndex: String(opts.zIndex ?? h.seq), willChange: "transform" });
      if ( opts.hollow ) h.box.style.opacity = "0.85";
      lay.appendChild(h.box);
      if ( gw ) glowCss(h, gw);
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
    let redraws = 0, painted = 0, forced = 0;
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
          show(h, c); place(h); h.lastIdx = idx;
          if ( !h.isReady ) { h.isReady = true; h._ready(true); for ( const f of ext.start ) { try { f(h); } catch ( e ) { console.warn("LETR | start hook", e); } } }
          continue;
        }
        const { idx, age } = pictureNow(h, t);
        if ( idx < 0 ) { finish(h, h.stopWhy ?? "done"); continue; }
        if ( h.space === "world" ) h.worldAlive = worldN;
        resize(h, false);
        refreshElevation(h, t);
        place(h);
        if ( h.gone && h.stopWhy == null ) h.stop();   // F11: its token went away: the word plays its exit where it last was
        let c = picture(h, idx, false);
        if ( c?.stale && budget > 0 && redraws < MAX_REDRAWS ) { redraws++; const t1 = now(); c = picture(h, idx, true); budget -= now() - t1; }
        const timed = idx < h.eN || idx >= h.eN + h.hN;   // an entrance / exit drawing: its beat matters
        /* not pre-rendered: draw it now unless the frame is over budget (then the older picture stays; an entrance or exit drawing is
           drawn anyway, two per frame at most: holding the previous one would stretch the wind-up or freeze the exit) */
        if ( !c && (budget > 0 || (timed && forced < 2)) ) { if ( budget <= 0 ) forced++; const t1 = now(); c = picture(h, idx, true); budget -= now() - t1; }
        if ( c ) {
          const was = h.shown; show(h, c); if ( was !== h.shown ) place(h);
          if ( was !== h.shown && timed && idx !== h.lastIdx ) {
            /* a late drawing starts from its beginning (a frame of slack): the next one is not cut short */
            const late = age - picStart(h, idx);
            if ( late > TICK ) h.lag = (h.lag || 0) + late - TICK / 2;
          }
          h.lastIdx = idx;
        } else if ( timed && idx !== h.lastIdx && h.lastIdx != null ) h.lag = (h.lag || 0) + (age - picStart(h, idx));   // waiting: the clock waits too
        /* move: a blast pushes its neighbours at its contact, echoes answer after the landing, a self-lit word gets its glow */
        if ( h.pushT != null && age >= h.pushT && h.lastPos ) { h.pushT = null; push({ ...h.lastPos }, { ...h.pushCfg, space: h.space, except: h }); }
        if ( h.echo && h.echo.k <= h.echo.n && !h.stopWhy && age >= h.entMs + h.echo.first + (h.echo.k - 1) * h.echo.every ) { spawnEcho(h, h.echo.k); h.echo.k++; }
        if ( h.glowWant && h.sprite && (budget > 0 || !h.glowTried) ) { h.glowTried = true; const t1 = now(); try { makeGlow(h); } catch ( e ) { h.glowWant = null; console.warn("LETR | glow", e); } budget -= now() - t1; }
      } catch ( e ) { console.warn("LETR | word failed", e); finish(h, "evicted"); }
    }
    /* pre-render what comes next, nearest first */
    for ( const h of clips ) {
      if ( budget <= 0 ) break;
      if ( h.t0 == null ) continue;
      const n = nextIdx(h, ageOf(h, t));
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
    let opts = filterOpts(handOpt(cleanOpts(opts0)));
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
        const t = ageOf(h, now()), natural = h.loop ? Infinity : h.entMs + h.holdMs;
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
        /* escalation (the same sound again on the same source) may change the text, its parts, size, place and hand */
        opts = escalate(h, opts); h.opts = opts;
        const reduced = opts.reduced ?? reducedPref();
        h.reducedMotion = !!reduced;
        let from = opts.from;
        if ( from && typeof from === "object" ) {
          if ( Number.isFinite(from.x) && Number.isFinite(from.y) ) { const p = space === "world" ? worldPoint(h) : screenPoint(h); from = p ? Math.atan2(from.y - p.y, from.x - p.x) * 180 / Math.PI : null; }
          else from = null;
        } else if ( from != null && !Number.isFinite(from) ) from = null;
        for ( let i = memory.length - 1; i >= 0; i-- ) if ( now() - memory[i].t > MEMORY_MS ) memory.splice(i, 1);
        const mem = opts.seed == null ? memory.map((m) => m.id) : [];
        const grp = opts._group;
        const avoid = [...(Array.isArray(opts.avoid) ? opts.avoid : []), ...(grp?.used ?? [])];
        let plan = mk(h.text, { ...opts, avoid, reduced, from }, fontsApi, mem);
        /* FXLE F16: a burst guarantees a different hand per word, also when its items have delays or share one seed */
        for ( let r = 1; grp && grp.used.includes(plan.hand.id) && r <= 6; r++ )
          plan = mk(h.text, { ...opts, avoid, reduced, from, seed: opts.seed != null ? `${opts.seed}~${r}` : undefined }, fontsApi, mem);
        if ( grp ) grp.used.push(plan.hand.id);
        h.plan = plan; h.fromDeg = Number.isFinite(from) ? from : null;
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
    const every = num("every", (v) => v >= 20, 110), life = num("life", (v) => v > 0, o.orbit ? 720 : o.path ? 520 : 340);
    const on = onOf(o) || 2;   // travel of the syllables steps on the drawing grid (README "Motion: frame rate")
    let orbitR = null;
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
      try { hand = mk(syl[0], { mood, seed: `${seedBase}:0`, colors: o.colors, style: o.style, look: o.look }, fontsApi, []).hand; remember(hand); } catch { hand = null; }
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
          const p = src() ?? p0, u = Math.min(1, stepT(Math.max(0, now() - t0), on) / (life + 200));
          const e = 1 - (1 - u) * (1 - u);
          return { x: p.x + Math.cos(ang) * (unit * 0.5 + travel * e) - Math.sin(ang) * side, y: p.y + Math.sin(ang) * (unit * 0.5 + travel * e) + Math.cos(ang) * side };
        };
        /* upright by default (to read); `orient: "lean"` tilts each syllable toward where it flies, "tangent" lays it along */
        const tilt = o.orient && !o.orbit && !o.path ? (orientAngle(ang, o.orient) * 180) / Math.PI : 0;
        /* orbit: each syllable joins the ring where the stream's head is now and rides it; path: each rides the path over its life */
        let travel2 = null;
        if ( o.orbit ) {
          const ob = o.orbit, period = Math.max(300, ob.period ?? 2600), dir = ob.dir < 0 ? -1 : 1;
          const tb = Array.isArray(o.beats) ? (o.beats[i] ?? 0) : o.manual ? stepT(Math.max(0, (when ?? now()) - tStart), on) : i * every;
          orbitR ??= Number.isFinite(ob.radius) && ob.radius > 0 ? ob.radius : (Number.isFinite(o.span) && o.span > 0 ? o.span * 0.85 : areaOf(o.area) || unit * 3.4);
          travel2 = { orbit: { ...ob, center: ob.center ?? o.at, radius: orbitR, phase: (Number.isFinite(ob.phase) ? ob.phase : -90) + (dir * 360 * tb) / period } };
        } else if ( o.path ) travel2 = { path: o.path };
        const h = play(word, { _stream: i === 0 ? syl.join(" ") : true, alt: i === 0 ? o.alt : undefined, palette: o.palette, mood, space, size: unit * (0.85 + 0.25 * loud) * (i === 0 ? 1.15 : 1), magnitude: o.magnitude, fit: o.fit, ceilK: o.ceilK ?? 0.55, seed: `${seedBase}:${i}`, hand: handOf() ?? undefined,
          in: o.in ?? "slam", out: o.out ?? "pop", holdKind: "shake", hold: life, tempo: o.tempo ?? 1.6, at, pixel: o.pixel, rotation: (Number.isFinite(o.rotation) ? o.rotation : 0) + tilt + (((i * 7) % 5) - 2) * 3,
          zIndex: o.zIndex, reduced: o.reduced, parent: o.parent, colors: o.colors, layer: o.layer, startAt: when, token: tokenRef, vision: o.vision, elevation: o.elevation,
          on: o.on, fps: o.fps, glow: o.glow, ...travel2 });
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
    const plan = mk(textOf(text), { ...opts, reduced: true }, fontsApi, []);
    for ( const f of ext.plan ) f(plan, { opts: { ...opts, reduced: true }, still: true });
    settleCenter(plan, bank);
    const dpr = opts.dpr ?? (globalThis.devicePixelRatio || 1);
    const S = Math.max(4, (opts.size ?? 72) * plan.sizeK * dpr);
    const p = plan.timeline.hold[0];
    return paintPicture(plan, bank, opts.picture ? opts.picture(plan) : p, S, makeCanvas).canvas;
  }

  function design(text, opts = {}) {
    const plan = mk(textOf(text), handOpt(cleanOpts(opts)), fontsApi, []);
    return JSON.parse(JSON.stringify(plan));
  }

  /* the size a word would get right now, and why (for callers and tests): { size, px, natural, clamp, fit, sizeK } */
  function sizeOf(text, opts0 = {}) {
    const opts = filterOpts(handOpt(cleanOpts({ ...opts0, force: true }))) ?? {};
    const space = opts.space === "world" ? "world" : "screen";
    const plan = mk(textOf(text), { ...opts, reduced: true }, fontsApi, []);
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
    for ( const k of [...escMem.keys()] ) if ( !o.space || k.startsWith(`${o.space}|`) ) escMem.delete(k);   // escalation starts over
  }
  function count(o = {}) { let n = 0; for ( const h of clips ) if ( !o.space || h.space === o.space ) n++; return n; }

  /* FXLE F22: on a scene change our layer containers go too (the `top` one lives on canvas.stage, which Foundry keeps) */
  function tearDown() {
    for ( const s of [...streams] ) if ( s.space === "world" ) s.stop({ quick: true });
    for ( const h of [...clips, ...pending] ) if ( h.space === "world" ) h.stop({ quick: true, why: "evicted" });
    for ( const c of worldLayers.values() ) { try { if ( !c.destroyed ) { c.parent?.removeChild(c); c.destroy({ children: true }); } } catch {} }
    worldLayers.clear();
    for ( const k of [...escMem.keys()] ) if ( k.startsWith("world|") ) escMem.delete(k);
    try { glowLayer?.destroy({ children: true }); } catch {}
    glowLayer = null;
  }
  try { globalThis.Hooks?.on?.("canvasTearDown", tearDown); } catch {}
  /* Foundry empties the illumination container on every lighting refresh: the glow of self-lit words goes back in */
  try { globalThis.Hooks?.on?.("lightingRefresh", () => { if ( glowLayer && !glowLayer.destroyed && glowLayer.children.length ) ensureGlowLayer(); }); } catch {}
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

  /* continuous sounds (sustain.mjs, README "Motion: continuous sounds"): a phrase score over play(); stopAll and a scene change stop
     them like streams */
  const sustain = makeSustain({ play, now, streams, vocab: () => vocab, pointOf, syllablesOf,
    inView: (space, p, pad = 0) => { const v = viewRect({ space }); return !v || !p || (p.x >= v.x0 - pad && p.x <= v.x1 + pad && p.y >= v.y0 - pad && p.y <= v.y1 + pad); } });
  const api = {
    version: VERSION, base, limits, stats, defaults, layers: LAYERS, layerChoices,
    moods: MOOD_IDS.map((id) => ({ id, label: MOODS[id].label, sound: { ...MOODS[id].sound } })),
    ready, play, stream, burst, still, design, stopAll, count, sizeOf, sizeModel: SIZE, lookStyle, lookStyles: STYLES.slice(),
    vocab, word: vocab.word, sfx, number: vocab.number, range: vocab.range, flow: vocab.flow,
    /* v6 (MOVE): push words aside, the escalation memory, the parts of the view words keep clear of (px from each edge: a letterbox,
       a bar; or a function (space) => insets; null = the default 8 px) */
    viewInset(v) { if ( v !== undefined ) viewInset = v ?? { top: 8, right: 8, bottom: 8, left: 8 }; return viewInset; },
    sustain, ambientMax: AMBIENT_MAX,
    push, escalation: { get: (key) => escMem.get(key)?.n ?? 0, clear: () => escMem.clear(), get size() { return escMem.size; } },
    async gallery(o = {}) { const g = await import("./gallery.mjs"); return g.gallery(api, o); },
    /* for tests and the gallery page */
    _ext: ext, _settle: (plan) => settleCenter(plan, bank),
    _bank: bank, _plan: (t, o = {}) => mk(t, o, fontsApi, []), _paint: (plan, p, S) => { settleCenter(plan, bank); return paintPicture(plan, bank, p, S, makeCanvas); }
  };
  return api;
}
