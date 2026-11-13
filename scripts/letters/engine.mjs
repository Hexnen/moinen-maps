/* LETR engine: fonts, the picture scheduler, the two players (screen = HTML layer over the interface, world = PIXI on the canvas)
   and the public API (see README.md). Works without Foundry for the screen space (gallery page, node-free browser tests). */
import { makePlan, MOODS, MOOD_IDS, TICK, FONTS, syllablesOf } from "./design.mjs";
import { FontBank } from "./fontbank.mjs";
import { paintPicture } from "./paint.mjs";
import { settleCenter } from "./shape.mjs";

export const VERSION = "1.1.0";
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
const BUDGET_MS = 4;          // pre-render budget per animation frame, shared by every live word
const MEMORY_MS = 6000;       // a hand used this recently is avoided by unseeded words

const now = () => performance.now();
const reducedPref = () => { try { return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const makeCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

export function createEngine(base) {
  const bank = new FontBank();
  let readyP = null;
  const clips = new Set();
  const memory = [];            // [{ id, t }]
  let raf = 0, seq = 0;
  const limits = { screen: 16, world: 48 };

  function ready() {
    readyP ??= Promise.all(Object.entries(FONTS).map(async ([id, f]) => {
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
  const isToken = (a) => a && (a.document?.documentName === "Token" || a.documentName === "Token" || (typeof a === "string" && globalThis.canvas?.tokens?.get?.(a)));
  const tokenObj = (a) => (typeof a === "string" ? canvas.tokens.get(a) : (a.object ?? a));
  function worldPoint(h) {
    const a = typeof h.at === "function" ? h.at() : h.at;
    if ( isToken(a) ) { const t = tokenObj(a); if ( !t ) return null; const d = t.document; return { x: t.center.x, y: (d.y ?? t.y) - (canvas.grid?.size ?? 100) * 0.08 }; }
    if ( a && Number.isFinite(a.x) ) return { x: a.x, y: a.y };
    const r = canvas?.stage ? canvas.stage.pivot : { x: 0, y: 0 };
    return { x: r.x, y: r.y };
  }
  function screenPoint(h) {
    const a = typeof h.at === "function" ? h.at() : h.at;
    if ( isToken(a) && globalThis.canvas?.stage ) {
      const w = worldPoint({ at: a }); if ( !w ) return null;
      const g = canvas.stage.toGlobal(w), r = canvas.app.view.getBoundingClientRect();
      return { x: r.left + g.x, y: r.top + g.y };
    }
    if ( a && Number.isFinite(a.x) ) return { x: a.x, y: a.y };
    return { x: innerWidth / 2, y: innerHeight * 0.42 };
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
    return el;
  }
  function ensureWorld(h) {
    if ( h.opts.parent && h.opts.parent.addChild ) return h.opts.parent;
    const key = layerOf(h), L = LAYERS[key];
    const elev = key === "tokens" && isToken(h.at) ? (tokenObj(h.at)?.document?.elevation ?? 0) : L.elevation;
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
    if ( c && h.space === "world" && !h.pixel && (rs > c.rs * 1.35 || rs < c.rs * 0.45) ) { dropPic(c); c = h.cache[idx] = null; }
    if ( c ) return c;
    if ( !sync ) return null;
    const p = h.pics[idx];
    const t0 = now();
    const want = pxPerUnit(h, rs);
    const r = paintPicture(h.plan, bank, p, want, makeCanvas);
    r.rs = rs * (r.S / want);          // texels per display unit actually used (lower when a huge word hit the side cap)
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
    stats.rendered++; stats.ms += r.ms;
    return r;
  }
  /* 1-bit alpha for pixel art (no soft edge between art pixels) */
  function hardAlpha(cnv) {
    const ctx = cnv.getContext("2d"), d = ctx.getImageData(0, 0, cnv.width, cnv.height), a = d.data;
    for ( let i = 3; i < a.length; i += 4 ) { if ( a[i] < 110 ) a[i] = 0; else { const k = 255 / a[i]; a[i - 3] = Math.min(255, a[i - 3] * k); a[i - 2] = Math.min(255, a[i - 2] * k); a[i - 1] = Math.min(255, a[i - 1] * k); a[i] = 255; } }
    ctx.putImageData(d, 0, 0);
  }
  function dropPic(c) { try { c.tex?.destroy(true); } catch {} if ( c.canvas ) { c.canvas.width = 0; c.canvas.height = 0; c.canvas.remove?.(); } }
  const stats = { rendered: 0, ms: 0 };

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
  function nextIdx(h, t) { const cur = picAt(h, t); for ( let dt = 40; dt < 600; dt += 40 ) { const n = picAt(h, t + dt); if ( n !== cur && n >= 0 && !h.cache[n] ) return n; } return -1; }

  function show(h, c) {
    if ( h.shown === c ) return;
    h.shown = c;
    if ( h.space === "world" ) {
      h.sprite.texture = c.tex;
      h.sprite.anchor.set(c.ax / c.canvas.width, c.ay / c.canvas.height);
      h.sprite.scale.set(1 / c.rs);
    } else {
      h.box.replaceChildren(c.canvas);
    }
  }
  function place(h) {
    if ( h.space === "world" ) {
      const p = worldPoint(h); if ( !p ) return;
      h.sprite.position.set(p.x + h.offset.x * (h.size * h.plan.sizeK), p.y + h.offset.y * (h.size * h.plan.sizeK));
    } else {
      const p = screenPoint(h); if ( !p ) return;
      const k = h.size * h.plan.sizeK;
      h.box.style.transform = `translate(${(p.x + h.offset.x * k).toFixed(1)}px,${(p.y + h.offset.y * k).toFixed(1)}px) rotate(${h.rot}rad)`;
    }
  }

  function finish(h, why) {
    if ( !h.alive ) return;
    h.alive = false;
    clips.delete(h);
    for ( const c of h.cache ) if ( c ) dropPic(c);
    h.cache.length = 0;
    if ( h.space === "world" ) { try { h.sprite.destroy({ children: true, texture: false }); } catch {} }
    else h.box?.remove();
    h._done(why);
  }

  /* ---------- the one animation loop ---------- */
  function frame() {
    raf = 0;
    const t = now();
    let budget = BUDGET_MS;
    for ( const h of [...clips] ) {
      try {
        const idx = picAt(h, t - h.t0);
        if ( idx < 0 ) { finish(h, h.stopWhy ?? "done"); continue; }
        place(h);
        let c = picture(h, idx, false);
        if ( !c ) {
          /* not pre-rendered: draw it now unless the frame is already over budget and an older picture is showing */
          if ( !h.shown || budget > 0 ) { const t1 = now(); c = picture(h, idx, true); budget -= now() - t1; }
        }
        if ( c ) { show(h, c); if ( !h.isReady ) { h.isReady = true; h._ready(); } }
      } catch ( e ) { console.warn("LETR | word failed", e); finish(h, "evicted"); }
    }
    /* pre-render what comes next, nearest first */
    for ( const h of clips ) {
      if ( budget <= 0 ) break;
      const n = nextIdx(h, t - h.t0);
      if ( n >= 0 ) { const t1 = now(); picture(h, n, true); budget -= now() - t1; }
    }
    if ( clips.size ) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if ( !raf ) raf = requestAnimationFrame(frame); };

  /* ---------- API ---------- */
  function play(text, opts = {}) {
    const space = opts.space === "world" ? "world" : "screen";
    if ( !readyP ) ready();
    let done, rdy;
    const h = {
      id: `letr${++seq}`, text: String(text ?? ""), space, opts, alive: true, isReady: false, cache: [], shown: null,
      ready: new Promise((r) => (rdy = r)), finished: new Promise((r) => (done = r)),
      stop(o = {}) {
        if ( !h.alive ) return;
        h.stopWhy = o.why ?? "stopped";
        if ( o.quick || !h.plan ) { finish(h, h.stopWhy); return; }
        const t = now() - h.t0, natural = h.loop ? Infinity : h.entMs + h.holdMs;
        if ( !(h.exitAt != null && h.exitAt <= t) && t < natural ) h.exitAt = t;
        h.loop = false;
        kick();
      },
      moveTo(at) { h.at = at; }
    };
    h._done = done; h._ready = rdy;
    h.at = opts.at;
    h.pixel = space === "world" && !!opts.pixel;
    const start = () => {
      if ( !h.alive ) return;
      if ( space === "world" && !globalThis.canvas?.ready ) { finish(h, "evicted"); return; }
      const reduced = opts.reduced ?? reducedPref();
      let from = opts.from;
      if ( from && typeof from === "object" && Number.isFinite(from.x) ) { const p = space === "world" ? worldPoint(h) : screenPoint(h); from = p ? Math.atan2(from.y - p.y, from.x - p.x) * 180 / Math.PI : null; }
      for ( let i = memory.length - 1; i >= 0; i-- ) if ( now() - memory[i].t > MEMORY_MS ) memory.splice(i, 1);
      const mem = opts.seed == null ? memory.map((m) => m.id) : [];
      h.plan = makePlan(h.text, { ...opts, reduced, from }, fontsApi, mem);
      if ( opts.seed == null ) memory.push({ id: h.plan.hand.id, t: now() });
      h.hand = h.plan.hand.id;
      settleCenter(h.plan, bank);
      h.loop = !!opts.loop;
      h.size = opts.size ?? (space === "world" ? (canvas.grid?.size ?? 100) * 0.6 : 72);
      h.rot = ((opts.rotation ?? 0) * Math.PI) / 180;
      const tokenAt = isToken(h.at);
      const anchor = opts.anchor ?? (tokenAt ? "bottom" : "center");
      h.offset = { x: 0, y: anchor === "bottom" ? -(h.plan._holdBox.h / 2 + 0.1) : 0 };
      scheduleOf(h);
      if ( space === "world" ) {
        const parent = ensureWorld(h);
        h.sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
        h.sprite.eventMode = "none";
        h.sprite.zIndex = opts.zIndex ?? seq;
        h.sprite.rotation = h.rot;
        parent.addChild(h.sprite);
      } else {
        const lay = ensureLayer(h);
        h.box = document.createElement("div");
        h.box.className = "moinen-letter";
        Object.assign(h.box.style, { position: "absolute", left: "0", top: "0", width: "0", height: "0", zIndex: String(opts.zIndex ?? seq), willChange: "transform" });
        lay.appendChild(h.box);
      }
      /* the limit: the oldest word of the same space leaves at once */
      const same = [...clips].filter((c) => c.space === space);
      while ( same.length >= limits[space] ) same.shift().stop({ quick: true, why: "evicted" });
      clips.add(h);
      /* startAt: a performance.now() time on the caller's clock (an effect's own t0): the word joins its timeline there */
      h.t0 = Number.isFinite(opts.startAt) ? opts.startAt : now();
      if ( opts.until?.then ) opts.until.then(() => h.stop(), () => h.stop());
      place(h);
      picture(h, 0, true);   // the first picture is ready in the same frame
      kick();
    };
    const go = () => { if ( bank.has("bangers") || bank.has("anton") ) start(); else readyP.then(start, (e) => { console.warn("LETR", e); finish(h, "evicted"); }); };
    if ( opts.delay > 0 ) setTimeout(() => { if ( h.alive ) go(); }, opts.delay); else go();
    return h;
  }

  /* ---------- streams: a sound that repeats or lasts as long as an effect (ratatata of a gun, a crackling fire) ---------- */
  function stream(o = {}) {
    const space = o.space === "world" ? "world" : "screen";
    const syl = Array.isArray(o.syllables) && o.syllables.length ? o.syllables.map(String) : syllablesOf(o.text ?? "RA-TA-TA");
    const every = o.every ?? 110, life = o.life ?? 340, seedBase = o.seed ?? `s${(Math.random() * 1e9) | 0}`;
    const handles = [], timers = [];
    let k = 0, hand = null, alive = true, done;
    const finished = new Promise((r) => (done = r));
    const src = () => { const a = typeof o.at === "function" ? o.at() : o.at; const fake = { at: a }; return space === "world" ? worldPoint(fake) : screenPoint(fake); };
    const dirAt = (p) => {
      const to = typeof o.to === "function" ? o.to() : o.to;
      if ( to ) { const q = isToken(to) ? (space === "world" ? worldPoint({ at: to }) : screenPoint({ at: to })) : to; if ( q && p ) return Math.atan2(q.y - p.y, q.x - p.x); }
      return ((o.dir ?? -90) * Math.PI) / 180;
    };
    const beat = (text) => {
      if ( !alive ) return null;
      const i = k++;
      const word = text ?? syl[i === 0 ? 0 : 1 + ((i - 1) % Math.max(1, syl.length - 1))] ?? syl[0];
      const p0 = src(); if ( !p0 ) return null;
      const ang = dirAt(p0) + (((i % 2) ? 1 : -1) * (o.spread ?? 10) * Math.PI) / 180;
      const unit = (o.size ?? (space === "world" ? (canvas.grid?.size ?? 100) * 0.35 : 40));
      const travel = (o.travel ?? 1.6) * unit, side = ((i % 3) - 1) * unit * 0.25, t0 = now();
      const loud = o.loud ? (typeof o.loud === "function" ? o.loud(i) : o.loud) : 1;
      const at = () => {
        const p = src() ?? p0, u = Math.min(1, (now() - t0) / (life + 200));
        const e = 1 - (1 - u) * (1 - u);
        return { x: p.x + Math.cos(ang) * (unit * 0.5 + travel * e) - Math.sin(ang) * side, y: p.y + Math.sin(ang) * (unit * 0.5 + travel * e) + Math.cos(ang) * side };
      };
      const tilt = 0;   // syllables stay upright to read; the travel direction shows in where they go, not in their tilt
      const h = play(word, { mood: o.mood ?? "impact", space, size: unit * (0.85 + 0.25 * loud) * (i === 0 ? 1.15 : 1), seed: `${seedBase}:${i}`, hand: hand ?? undefined,
        in: o.in ?? "slam", out: o.out ?? "pop", holdKind: "shake", hold: life, tempo: o.tempo ?? 1.6, at, pixel: o.pixel, rotation: (o.rotation ?? 0) + tilt + (((i * 7) % 5) - 2) * 3,
        zIndex: o.zIndex, reduced: o.reduced, parent: o.parent, colors: o.colors, layer: o.layer });
      if ( !hand && h.plan ) hand = h.plan.hand;
      handles.push(h);
      return h;
    };
    const stop = (q = {}) => {
      if ( !alive ) return; alive = false; timers.forEach(clearTimeout);
      if ( q.quick ) for ( const h of handles ) h.stop({ quick: true });
      Promise.all(handles.map((h) => h.finished)).then(() => done(q.quick ? "stopped" : "done"));
    };
    const tStart = Number.isFinite(o.startAt) ? o.startAt : now() + (o.delay ?? 0);
    if ( Array.isArray(o.beats) ) for ( const ms of o.beats ) timers.push(setTimeout(() => beat(), Math.max(0, tStart + ms - now())));
    else if ( !o.manual ) {
      const n = o.count ?? (o.duration ? Math.max(1, Math.floor(o.duration / every)) : o.until ? Infinity : 6);
      const tick = () => { if ( !alive ) return; if ( k >= n ) { stop(); return; } beat(); timers.push(setTimeout(tick, every * (o.swing ? (k % 2 ? 1.15 : 0.85) : 1))); };
      timers.push(setTimeout(tick, Math.max(0, tStart - now())));
    }
    if ( Array.isArray(o.beats) ) timers.push(setTimeout(() => stop(), Math.max(0, tStart + Math.max(...o.beats, 0) + 20 - now())));
    if ( o.until?.then ) o.until.then(() => stop(), () => stop());
    return { handles, finished, beat, stop, get alive() { return alive; } };
  }

  function burst(items, common = {}) {
    const used = [];
    return items.map((it) => {
      const h = play(it.text, { ...common, ...it, avoid: [...(common.avoid ?? []), ...(it.avoid ?? []), ...used] });
      const note = () => { if ( h.hand ) used.push(h.hand); };
      note();
      return h;
    });
  }

  async function still(text, opts = {}) {
    await ready();
    const plan = makePlan(text, { ...opts, reduced: true }, fontsApi, []);
    settleCenter(plan, bank);
    const dpr = opts.dpr ?? (globalThis.devicePixelRatio || 1);
    const S = Math.max(4, (opts.size ?? 72) * plan.sizeK * dpr);
    const p = plan.timeline.hold[0];
    return paintPicture(plan, bank, opts.picture ? opts.picture(plan) : p, S, makeCanvas).canvas;
  }

  function design(text, opts = {}) {
    const plan = makePlan(text, opts, fontsApi, []);
    return JSON.parse(JSON.stringify(plan));
  }

  function stopAll(o = {}) { for ( const h of [...clips] ) if ( !o.space || h.space === o.space ) h.stop({ quick: o.quick ?? true }); }
  function count(o = {}) { let n = 0; for ( const h of clips ) if ( !o.space || h.space === o.space ) n++; return n; }

  try { globalThis.Hooks?.on?.("canvasTearDown", () => { for ( const h of [...clips] ) if ( h.space === "world" ) h.stop({ quick: true, why: "evicted" }); worldLayers.clear(); }); } catch {}
  /* settings helpers: choices for game.settings.register, per space */
  const layerChoices = (space = "world", lang = globalThis.game?.i18n?.lang) => Object.fromEntries(Object.entries(LAYERS).filter(([, v]) => v.space === space).map(([k, v]) => [k, lang === "pl" ? v.pl : v.en]));

  const api = {
    version: VERSION, base, limits, stats, defaults, layers: LAYERS, layerChoices,
    moods: MOOD_IDS.map((id) => ({ id, label: MOODS[id].label, sound: { ...MOODS[id].sound } })),
    ready, play, stream, burst, still, design, stopAll, count,
    async gallery(o = {}) { const g = await import("./gallery.mjs"); return g.gallery(api, o); },
    /* for tests and the gallery page */
    _bank: bank, _plan: (t, o = {}) => makePlan(t, o, fontsApi, []), _paint: (plan, p, S) => { settleCenter(plan, bank); return paintPicture(plan, bank, p, S, makeCanvas); }
  };
  return api;
}
