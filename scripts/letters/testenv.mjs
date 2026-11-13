// LETR / FXLE: a small fake browser + Foundry + PIXI around the real engine, on a simulated clock (node only; used by check-life.mjs).
// const E = await setup(); E.engine is a fresh engine; await E.tick(ms) advances the clock and runs timers and animation frames.
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

let bust = 0;
export async function setup(o = {}) {
  let T = 1000;
  const timers = []; let tid = 0;
  const raf = []; let rid = 0;
  globalThis.performance = { now: () => T };
  const realST = (globalThis.__letrRealST ??= globalThis.setTimeout);
  globalThis.setTimeout = (f, ms = 0) => { const id = ++tid; timers.push({ id, at: T + Math.max(0, +ms || 0), f }); return id; };
  globalThis.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if ( i >= 0 ) timers.splice(i, 1); };
  globalThis.requestAnimationFrame = (f) => { const id = ++rid; raf.push({ id, f }); return id; };
  globalThis.cancelAnimationFrame = (id) => { const i = raf.findIndex((t) => t.id === id); if ( i >= 0 ) raf.splice(i, 1); };
  const flush = () => new Promise((r) => realST(r, 0));
  const frames = { n: 0, painted: [], ms: [] };
  async function tick(ms, step = 16) {
    const end = T + ms;
    while ( T < end ) {
      T = Math.min(end, T + step);
      for ( ;; ) { timers.sort((a, b) => a.at - b.at || a.id - b.id); const t = timers[0]; if ( !t || t.at > T ) break; timers.shift(); t.f(); }
      const fr = raf.splice(0);
      if ( fr.length ) { const r0 = E.engine?.stats.rendered ?? 0, f0 = T; for ( const r of fr ) r.f(T); frames.n++; frames.painted.push((E.engine?.stats.rendered ?? 0) - r0); frames.ms.push(T - f0); }
      await flush();
    }
  }
  const stats = { liveCanvases: new Set(), liveTex: new Set(), texBytes: 0, maxTexBytes: 0 };
  const knobs = { fillCost: 0 };
  const mkCtx = (cnv) => new Proxy({}, { get: (t, k) => {
    if ( k in t ) return t[k];
    if ( k === "createLinearGradient" || k === "createRadialGradient" ) return () => ({ addColorStop() {} });
    if ( k === "getImageData" ) return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(0, w * h * 4) | 0) });
    if ( k === "canvas" ) return cnv;
    return () => { if ( k === "fill" ) T += knobs.fillCost; };
  }, set: (t, k, v) => ((t[k] = v), true) });
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.style = {}; this.children = []; this.parentNode = null; }
    setAttribute() {}
    appendChild(c) { c.remove?.(); this.children.push(c); c.parentNode = this; return c; }
    replaceChildren(...cs) { for ( const c of this.children ) c.parentNode = null; this.children = []; for ( const c of cs ) this.appendChild(c); }
    remove() { if ( this.parentNode ) { const p = this.parentNode; p.children = p.children.filter((x) => x !== this); this.parentNode = null; } }
    get isConnected() { let p = this; while ( p ) { if ( p === document.body ) return true; p = p.parentNode; } return false; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 1600, height: 900 }; }
  }
  class Cnv extends El {
    constructor() { super("canvas"); this._w = 300; this._h = 150; stats.liveCanvases.add(this); this._ctx = mkCtx(this); }
    get width() { return this._w; } set width(v) { this._w = v; if ( v === 0 ) stats.liveCanvases.delete(this); else stats.liveCanvases.add(this); }
    get height() { return this._h; } set height(v) { this._h = v; }
    getContext() { return this._ctx; }
  }
  globalThis.HTMLElement = El;
  globalThis.document = { body: new El("body"), createElement: (t) => (t === "canvas" ? new Cnv() : new El(t)), getElementById: () => null };
  globalThis.innerWidth = 1600; globalThis.innerHeight = 900; globalThis.devicePixelRatio = 1;
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.fetch = async (u) => { const b = fs.readFileSync(fileURLToPath(u)); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; };
  class DisplayObject { constructor() { this.parent = null; this.destroyed = false; this.visible = true; this.position = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } }; this.scale = { x: 1, y: 1, set(x, y = x) { this.x = x; this.y = y; } }; this.anchor = { set(x, y) { this.x = x; this.y = y; } }; }
    destroy() { this.destroyed = true; this.parent?.removeChild(this); } }
  class Container extends DisplayObject { constructor() { super(); this.children = []; }
    addChild(c) { c.parent?.removeChild(c); this.children.push(c); c.parent = this; return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parent = null; }
    sortChildren() {}
    destroy(op) { if ( op?.children ) for ( const c of [...this.children] ) c.destroy(op); super.destroy(); } }
  class BaseTexture { constructor(src) { this.bytes = src.width * src.height * 4; stats.texBytes += this.bytes; stats.maxTexBytes = Math.max(stats.maxTexBytes, stats.texBytes); }
    destroy() { if ( this.destroyed ) return; this.destroyed = true; stats.texBytes -= this.bytes; } }
  class Texture { constructor(bt) { this.baseTexture = bt; stats.liveTex.add(this); }
    destroy(base) { if ( base ) this.baseTexture?.destroy(); this.baseTexture = null; this.destroyed = true; stats.liveTex.delete(this); } }
  Texture.EMPTY = { empty: true };
  class Sprite extends Container { constructor(t) { super(); this.texture = t; } }
  globalThis.PIXI = { Container, Sprite, Texture, BaseTexture, SCALE_MODES: { NEAREST: 0, LINEAR: 1 } };
  const hooks = {};
  globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), callAll: (n, ...a) => (hooks[n] ?? []).forEach((f) => f(...a)) };
  const tokens = new Map();
  const stage = new Container(); stage.pivot = { x: 2000, y: 1500 };
  stage.toGlobal = (p) => ({ x: (p.x - stage.pivot.x) * stage.scale.x + 800, y: (p.y - stage.pivot.y) * stage.scale.x + 450 });
  const visibility = { tokenVision: false, seen: () => true, testVisibility(p) { return visibility.seen(p); } };
  globalThis.canvas = { ready: true, grid: { size: 100 }, stage, primary: new Container(), interface: new Container(), level: null, visibility,
    effects: { visionSources: [{ active: true }] },
    tokens: { get: (id) => tokens.get(id), get placeables() { return [...tokens.values()]; } }, app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } } };
  stage.addChild(canvas.primary); stage.addChild(canvas.interface);
  globalThis.game = { user: { isGM: o.gm ?? false }, i18n: { lang: "en" } };
  globalThis.foundry = { applications: { api: { ApplicationV2: { _maxZ: 100 } } } };
  const addToken = (id, x, y, elevation = 0, more = {}) => {
    const doc = { documentName: "Token", id, x, y, elevation, width: 1, height: 1, hidden: false, getVisibilityTestPoints: () => [{ x: x + 50, y: y + 50 }], ...more };
    const t = { document: doc, center: { x: x + 50, y: y + 50 }, x, y, bounds: { x, y, width: 100, height: 100 } }; doc.object = t; tokens.set(id, t); return t;
  };
  const delToken = (id) => { const t = tokens.get(id); tokens.delete(id); if ( t ) { t.document.object = null; t.destroyed = true; } };
  const dir = new URL("./", import.meta.url);
  const { createEngine } = await import(new URL(`./engine.mjs?e${++bust}`, dir).href);
  const E = { tick, stats, knobs, hooks, addToken, delToken, timers, frames, now: () => T, PIXI: globalThis.PIXI };
  const warns = []; const ow = console.warn; console.warn = (...a) => warns.push(a.map(String).join(" ")); E.warns = warns; E.restoreWarn = () => (console.warn = ow);
  E.engine = createEngine(pathToFileURL(fileURLToPath(dir)).href);
  if ( !o.noReady ) await E.engine.ready();
  const sprites = () => { const out = []; const walk = (c) => { for ( const x of c.children ?? [] ) { if ( x instanceof Sprite ) out.push(x); walk(x); } }; walk(stage); return out; };
  E.sprites = sprites;
  return E;
}
export const settled = (p) => { let s = "pending"; p.then((v) => (s = `resolved:${v}`), (e) => (s = `rejected:${e}`)); return () => s; };
