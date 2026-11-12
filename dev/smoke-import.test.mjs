/**
 * Smoke test: nothing in the other tests loads the Foundry-side modules, so a broken one (a lost declaration: "base is not defined")
 * passed them all. Here, with minimal Foundry / PIXI stubs:
 *   A. every scripts/**\/*.mjs is imported (no ReferenceError, SyntaxError or TypeError at import);
 *   B. (a child process, with display.mjs and source.mjs replaced by small fakes and the workers run in-process) the destruction's real
 *      load path runs on a scene of a few strokes: canvasReady -> bake pass (core.mjs in a fake worker) -> publish (chunks uploaded to
 *      a fake server, the manifest written) -> a second load from those chunks (no bake) -> a Rebake of one stroke. Any
 *      "x is not defined" or other error logged on the way fails the test.
 * Run: node dev/smoke-import.test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PART = process.argv[2] ?? "A";
const problems = [];

/* ---------------------------------------------------------------- stubs */

const any = (name = "stub") => {
  const fn = function () {};
  return new Proxy(fn, {
    get(t, k) {
      if ( k === Symbol.toPrimitive ) return () => 0;
      if ( k === "then" ) return undefined;
      if ( k === Symbol.iterator ) return function* () {};
      if ( !(k in t) ) t[k] = any(`${name}.${String(k)}`);
      return t[k];
    },
    apply: () => any(`${name}()`),
    construct: () => any(`new ${name}`),
    set(t, k, v) { t[k] = v; return true; }
  });
};

const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) { if ( !hooks.has(name) ) hooks.set(name, []); hooks.get(name).push(fn); return hooks.get(name).length; },
  once(name, fn) { return this.on(name, fn); },
  off() {}, callAll(name, ...a) { for ( const fn of hooks.get(name) ?? [] ) fn(...a); return true; }, call(name, ...a) { this.callAll(name, ...a); return true; }
};
const settings = new Map();
const flatten = (o, p = "", out = {}) => { for ( const [k, v] of Object.entries(o ?? {}) ) { const key = p ? `${p}.${k}` : k; if ( v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Uint8Array) && Object.keys(v).length && !k.startsWith("-=") ) flatten(v, key, out); else out[key] = v; } return out; };
const setPath = (obj, key, v) => {
  const parts = key.split("."); let o = obj;
  for ( let i = 0; i < parts.length - 1; i++ ) { if ( parts[i].startsWith("-=") ) return; o = (o[parts[i]] ??= {}); }
  const last = parts.at(-1);
  if ( last.startsWith("-=") ) delete o[last.slice(2)]; else if ( v === null && false ) delete o[last]; else o[last] = structuredClone(v);
};
function makeScene() {
  const scene = {
    id: "smokeScene00000", name: "smoke", width: 1000, height: 800, active: true, flags: {}, updates: [],
    levels: { contents: [] }, background: { src: null },
    async update(data) {
      const flat = flatten(data);
      for ( const [k, v] of Object.entries(flat) ) setPath(scene, k, v);
      scene.updates.push(Object.keys(flat));
      Hooks.callAll("updateScene", scene, data, {}, "otherUser");
      return scene;
    }
  };
  return scene;
}
const scene = makeScene();
let counter = 0;
globalThis.foundry = new Proxy({
  utils: {
    randomID: (n = 16) => (`r${(++counter).toString(36)}xxxxxxxxxxxxxxxx`).slice(0, n), getRoute: (p) => p, deepClone: (o) => structuredClone(o),
    mergeObject: (a, b) => Object.assign(a, b), hasProperty: (o, k) => k.split(".").reduce((x, p) => (x == null ? undefined : x[p]), o) !== undefined,
    flattenObject: (o) => flatten(o), isEmpty: (o) => !o || !Object.keys(o).length, getProperty: (o, k) => k.split(".").reduce((x, p) => (x == null ? undefined : x[p]), o),
    expandObject: (o) => o, debounce: (fn) => fn, escapeHTML: (s) => String(s)
  },
  applications: { api: any("api"), apps: { FilePicker: { implementation: {
    upload: async (_s, dir, file) => { const p = `${dir}/${file.name}`; server.set(p, new Uint8Array(await file.arrayBuffer())); return { status: "success", path: p }; },
    createDirectory: async () => ({}), browse: async () => ({ files: [] })
  } } }, handlebars: any("handlebars"), ux: any("ux") },
  canvas: any("foundry.canvas"), documents: any("foundry.documents"), CONST: any("CONST"), data: any("data")
}, { get: (t, k) => (k in t ? t[k] : (t[k] = any(`foundry.${String(k)}`))) });
const server = new Map();
globalThis.fetch = async (url) => {
  const p = String(url).replace(/^\//, "").split("?")[0];
  if ( server.has(p) ) return new Response(server.get(p), { status: 200 });
  return new Response("", { status: 404 });
};
globalThis.game = {
  ready: true, world: { id: "smokeWorld" }, system: { id: "smoke" }, release: { generation: 14 },
  user: { id: "gm1", isGM: true, name: "GM" },
  users: { activeGM: { isSelf: true, id: "gm1" }, filter: () => [], get: () => null, [Symbol.iterator]: function* () {} },
  settings: { get: (m, k) => settings.get(`${m}.${k}`), set: async (m, k, v) => { settings.set(`${m}.${k}`, v); }, register: (m, k, d) => { settings.set(`${m}.${k}`, d?.default); }, registerMenu() {} },
  i18n: { localize: (k) => k, format: (k) => k, has: () => true, lang: "en" },
  scenes: Object.assign([scene], { get: (id) => (id === scene.id ? scene : null) }),
  modules: new Map([["moinen-maps", { id: "moinen-maps", active: true, api: null }]]),
  time: { serverTime: Date.now() }, socket: any("socket"), actors: [], items: [], packs: new Map(), tables: [], combats: [], messages: []
};
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} }, controls: any("ui.controls"), sidebar: any("ui.sidebar") };
globalThis.CONFIG = new Proxy({}, { get: (t, k) => (t[k] ??= any(`CONFIG.${String(k)}`)) });
globalThis.CONST = any("CONST");
globalThis.PIXI = any("PIXI");
globalThis.canvas = new Proxy({
  scene: null, ready: true,
  dimensions: { sceneRect: { x: 0, y: 0, width: 1000, height: 800 }, size: 100, sceneX: 0, sceneY: 0 },
  grid: { size: 100 }, stage: { pivot: { x: 500, y: 400 }, scale: { x: 1, y: 1 } },
  app: { ticker: { add() {}, remove() {}, addOnce() {} }, renderer: any("renderer"), screen: { width: 1400, height: 850 }, view: any("view") },
  primary: any("primary"), environment: { darknessLevel: 0 }, effects: any("effects"), interface: any("interface"), tokens: any("tokens")
}, { get: (t, k) => (k in t ? t[k] : (t[k] = any(`canvas.${String(k)}`))) });
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.document = new Proxy({ visibilityState: "visible", addEventListener() {}, removeEventListener() {}, createElement: () => any("element"), body: any("body"), querySelector: () => null, querySelectorAll: () => [], documentElement: any("html") },
  { get: (t, k) => (k in t ? t[k] : (t[k] = any(`document.${String(k)}`))) });
globalThis.window = globalThis;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
try { Object.defineProperty(globalThis, "navigator", { value: { hardwareConcurrency: 4, userAgent: "node" }, configurable: true }); } catch { /* exists */ }
globalThis.indexedDB = { open() { const r = {}; setTimeout(() => r.onerror?.({}), 0); return r; }, deleteDatabase() { return {}; } };
globalThis.FilePicker = foundry.applications.apps.FilePicker.implementation;
globalThis.Application = class {}; globalThis.FormApplication = class {}; globalThis.Dialog = class {};
globalThis.ImageData = class { constructor(d, w, h) { Object.assign(this, { data: d, width: w, height: h }); } };
globalThis.self = globalThis;

/* in-process workers: the destruction bake (core.mjs) and the chunk codec (chunks.mjs) */
globalThis.Worker = class {
  constructor(url) { this.url = String(url); this.listeners = []; this.state = { map: null, areas: new Map() }; }
  addEventListener(t, fn) { if ( t === "message" ) this.listeners.push(fn); }
  removeEventListener(t, fn) { this.listeners = this.listeners.filter((f) => f !== fn); }
  emit(data) { for ( const fn of [this.onmessage, ...this.listeners] ) fn?.({ data }); }
  terminate() { this.dead = true; }
  postMessage(m) {
    setTimeout(async () => {
      if ( this.dead ) return;
      try {
        if ( this.url.includes("chunk-worker") ) { const C = await import(pathToFileURL(path.join(ROOT, "scripts/net/chunks.mjs")).href); return this.emit({ id: m.id, ok: true, result: (await C.work(m)).result }); }
        const core = await import(pathToFileURL(path.join(ROOT, "scripts/destruction/core.mjs")).href);
        if ( m.kind === "map" ) { this.state.map = m.map; this.state.mapKey = m.mapKey; return this.emit({ id: m.id, ok: true, result: true }); }
        if ( m.kind === "bake" ) { bakes++; const res = core.bake({ ...m.input, map: this.state.map }, m.input.noCache ? null : this.state.areas); return this.emit({ id: m.id, ok: true, result: res }); }
        this.emit({ id: m.id, ok: false, error: `unknown ${m.kind}` });
      } catch ( err ) { this.emit({ id: m.id, ok: false, error: String(err?.stack ?? err) }); }
    }, 0);
  }
};
let bakes = 0;

/* every error and "x is not defined" logged counts */
const origError = console.error, origWarn = console.warn;
const watch = (lvl) => (...a) => {
  const s = a.map((x) => (x?.stack ?? String(x))).join(" ");
  if ( /is not defined|is not a function|Cannot read properties of undefined|SyntaxError|ReferenceError/.test(s) ) problems.push(`${lvl}: ${s.slice(0, 400)}`);
  if ( process.env.SMOKE_VERBOSE ) (lvl === "error" ? origError : origWarn)(...a);
};
console.error = watch("error"); console.warn = watch("warn");
process.on("unhandledRejection", (err) => { const s = String(err?.stack ?? err); if ( /is not defined|ReferenceError|SyntaxError/.test(s) ) problems.push(`unhandled: ${s.slice(0, 400)}`); });

const done = (label) => {
  console.error = origError; console.warn = origWarn;
  if ( problems.length ) { for ( const p of problems ) console.log("FAIL", p); console.log(`${label}: ${problems.length} problem(s)`); process.exit(1); }
  console.log(`${label}: ok`);
  process.exit(0);
};

/* ---------------------------------------------------------------- A: every module imports */

if ( PART === "A" ) {
  const files = [];
  const walk = (d) => { for ( const e of fs.readdirSync(d, { withFileTypes: true }) ) { const p = path.join(d, e.name); if ( e.isDirectory() ) walk(p); else if ( e.name.endsWith(".mjs") ) files.push(p); } };
  walk(path.join(ROOT, "scripts"));
  for ( const f of files.sort() ) {
    try { await import(pathToFileURL(f).href); }
    catch ( err ) { problems.push(`import ${path.relative(ROOT, f)}: ${String(err?.stack ?? err).split("\n").slice(0, 3).join(" | ")}`); }
  }
  await new Promise((r) => setTimeout(r, 200));
  console.log(`imported ${files.length} modules`);
  // B in its own process (display.mjs and source.mjs replaced by fakes; the real ones are already in this one's module cache)
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "B"], { encoding: "utf8", timeout: 240000 });
  process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? "");
  if ( r.status !== 0 ) problems.push(`part B failed (exit ${r.status})`);
  done(`smoke: ${files.length} modules import, the destruction load path runs`);
}

/* ---------------------------------------------------------------- B: the destruction's load -> bake -> publish -> reload path */

if ( PART === "B" ) {
  const { register } = await import("node:module");
  const fakeSource = `export function backgroundInfo() { return { path: "smoke-bg" }; }
export function sceneMap(S) { const w = S.aw, h = S.ah, d = new Uint8ClampedArray(w * h * 4); for ( let i = 0; i < w * h; i++ ) { d[i * 4] = 90 + (i % 17); d[i * 4 + 1] = 110; d[i * 4 + 2] = 70; d[i * 4 + 3] = 255; } return { key: "smoke", wkey: "smoke", map: { w, h, data: d } }; }
export function forgetSceneMap() {}
export function mapPixels() { return null; }`;
  const fakeDisplay = `export class DestructionDisplay {
  constructor() { this.groups = new Map(); this.order = []; this.spare = new Map(); this.dying = []; this.objs = { alpha: 1 }; this.fx = { alpha: 1 }; this.stats = { uploads: 0 }; this.erasers = new Map(); }
  get areas() { return this.order.map((g) => g.info); }
  sync(rgba, w, h, meta, ap, origin, objs) {
    const F = 18, seen = new Set(), added = [];
    for ( let k = 0; k < meta.length / F; k++ ) {
      const o = k * F; if ( meta[o] !== 0 ) continue;
      const hash = ((meta[o + 12] & 0xffff) | ((meta[o + 13] & 0xffff) << 16)) >>> 0; seen.add(hash);
      if ( this.groups.has(hash) ) continue;
      const g = { hash, info: { hash, type: "blast", mat: 0, cause: 0, rect: { x0: meta[o + 5], y0: meta[o + 6], x1: meta[o + 5] + meta[o + 3], y1: meta[o + 6] + meta[o + 4] } }, pieces: [], made: 0, objId: objs[meta[o + 16]]?.id ?? null, cont: { alpha: 1 }, tex: {} };
      this.groups.set(hash, g); added.push(g);
    }
    const removed = [];
    for ( const [h, g] of this.groups ) if ( !seen.has(h) ) { this.groups.delete(h); removed.push(g); }
    this.order = [...this.groups.values()];
    return { added, removed };
  }
  setIdle() {} setLook() {} swap() {} enter() {} applyFade() {} materialize() { return 0; } view() { return null; } needPixels() { return []; }
  texturesOf() { return []; } detonate() {} fadeAll() {} clear() {} destroy() {} retire() {} shellCount() { return 0; }
}`;
  const hooksSrc = `const map = { "/destruction/display.mjs": ${JSON.stringify("data:text/javascript," + encodeURIComponent(fakeDisplay))}, "/destruction/source.mjs": ${JSON.stringify("data:text/javascript," + encodeURIComponent(fakeSource))} };
export async function resolve(spec, ctx, next) { const r = await next(spec, ctx); for ( const [k, v] of Object.entries(map) ) if ( r.url.endsWith(k) ) return { url: v, shortCircuit: true }; return r; }`;
  register("data:text/javascript," + encodeURIComponent(hooksSrc));

  const Model = await import(pathToFileURL(path.join(ROOT, "scripts/destruction/model.mjs")).href);
  const Store = await import(pathToFileURL(path.join(ROOT, "scripts/destruction/store.mjs")).href);
  const D = await import(pathToFileURL(path.join(ROOT, "scripts/destruction/destruction.mjs")).href);
  canvas.scene = scene;
  // a scene with four strokes (two overlapping: a substrate)
  const S = Model.blank(scene);
  S.ap = 4; Object.assign(S, Model.grids(4, { x: 0, y: 0, width: 1000, height: 800 }));
  S.mask = new Uint8Array(S.mw * S.mh);
  const stroke = (cx, cy, r, type, id) => {
    const buf = new Uint8Array(S.mw * S.mh); let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for ( let y = 0; y < S.mh; y++ ) for ( let x = 0; x < S.mw; x++ ) if ( (x - cx) ** 2 + (y - cy) ** 2 <= r * r ) { buf[y * S.mw + x] = 2; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return Model.makeObject(buf, S.mw, { x0, y0, x1, y1 }, { id, type });
  };
  S.objects = [stroke(30, 30, 8, 0, "smokeA0000"), stroke(36, 32, 7, 4, "smokeB0000"), stroke(80, 60, 6, 1, "smokeC0000"), stroke(100, 30, 5, 2, "smokeD0000")];
  S.objects.forEach((o, i) => { o.s = i; });
  Model.composite(S);
  await scene.update(Store.flagUpdate(S, scene));
  scene.updates.length = 0;
  D.registerDestruction();
  Hooks.callAll("init"); Hooks.callAll("setup"); Hooks.callAll("ready");
  const settle = async (ms = 30000) => { const t = Date.now(); while ( Date.now() - t < ms ) { await new Promise((r) => setTimeout(r, 200)); const st = D.getStatus(); if ( !st.baking && !st.waiting && st.source && !D.destructionApi.status().inflight ) return st; } return D.getStatus(); };

  // 1. a load with nothing published: bake here, then publish
  Hooks.callAll("canvasInit"); Hooks.callAll("canvasReady", canvas);
  let st = await settle();
  if ( st.error ) problems.push(`first load: ${st.error}`);
  if ( !/baked/.test(st.source) ) problems.push(`first load did not bake: "${st.source}"`);
  if ( !bakes ) problems.push("no bake ran");
  await new Promise((r) => setTimeout(r, 2500));      // the publish (persist: encode, upload, manifest)
  const M = scene.flags["moinen-maps"]?.destruction?.baked;
  if ( !M?.c || Object.keys(M.c).length !== 4 ) problems.push(`no manifest of 4 strokes after the publish (${JSON.stringify(M?.c ?? null).slice(0, 120)})`);
  if ( ![...server.keys()].some((k) => k.endsWith(".png")) ) problems.push("no chunk uploaded");

  // 2. a second load (another client: fresh memory) from the published chunks: no bake
  Hooks.callAll("canvasTearDown"); bakes = 0;
  Hooks.callAll("canvasInit"); Hooks.callAll("canvasReady", canvas);
  st = await settle();
  if ( st.error ) problems.push(`second load: ${st.error}`);
  if ( bakes ) problems.push(`the second load baked ${bakes} time(s) (it should take the published chunks)`);

  // 3. a Rebake of one stroke (the background path)
  bakes = 0;
  D.destructionApi.rebakeAll(["smokeB0000"]);
  for ( let i = 0; i < 100 && D.getStatus().rebake; i++ ) await new Promise((r) => setTimeout(r, 200));
  if ( D.getStatus().rebake ) problems.push("the rebake did not finish");
  if ( !bakes ) problems.push("the rebake baked nothing");
  // 4. the API answers
  try { D.destructionApi.status(); D.destructionApi.net.trace(); } catch ( err ) { problems.push(`api: ${err}`); }
  // 5. stroke signatures kept by their inputs' digest (store.mjs sigsKey / warmSigs): equal inputs -> the same key, a changed stroke,
  // order or setting -> another; a read-ahead entry is taken only when whole; what is taken equals what would be computed
  {
    const clone = (s) => ({ ...s, params: { ...s.params }, objects: s.objects.map((o) => ({ ...o })) });
    const k0 = Store.sigsKey(S), A = clone(S);
    if ( Store.sigsKey(A) !== k0 ) problems.push("sigsKey: a copy of the same state has another key");
    const B = clone(S); B.objects[1].x0 += 1;
    const C = clone(S); C.objects.reverse();
    const P = clone(S); P.params.seedOffset = (P.params.seedOffset ?? 0) + 1;
    for ( const [n, s] of [["moved stroke", B], ["order", C], ["setting", P]] ) if ( Store.sigsKey(s) === k0 ) problems.push(`sigsKey ignores the ${n}`);
    const truth = Store.sigsOf(clone(S));
    const fresh = clone(S);   // a new state object: no per-state entry, found by its digest
    if ( !(await Store.warmSigs(fresh, async () => null)) ) problems.push("warmSigs: computed signatures were not found by their digest");
    const bad = clone(S); bad.objects = bad.objects.slice(0, 3);
    // (three strokes: they come from the last signatures on the page now, never from the read-ahead entry; with nothing to start from, the
    // entry of the wrong length is refused)
    if ( await Store.warmSigs(bad, async () => truth) && Store.sigsOf(bad).length !== 3 ) problems.push("warmSigs took an entry of the wrong length");
    { const sub = (await import(pathToFileURL(path.join(ROOT, "scripts/destruction/substrate.mjs")).href)).fullSigs(bad.objects, (o) => Store.objSig(bad, o), bad.params, Model.K, (o) => o.bytes ?? Model.objBytes(o));
      if ( JSON.stringify(Store.sigsOf(bad)) !== JSON.stringify(sub) ) problems.push("signatures from the last ones differ from the computed ones"); }
    const bad2 = clone(S); bad2.params.wrongLen = 1; bad2.objects = bad2.objects.slice(0, 3);
    if ( await Store.warmSigs(bad2, async () => truth) ) problems.push("warmSigs took an entry of the wrong length");
    if ( JSON.stringify(Store.sigsOf(fresh)) !== JSON.stringify(truth) ) problems.push("sigsOf from the digest store differs from the computed one");
    // the codec worker's "sigs" job (a first load: off the page) gives exactly what the page computes
    const Chunks = await import(pathToFileURL(path.join(ROOT, "scripts/net/chunks.mjs")).href);
    const other = clone(S); other.params.workerCheck = 1;
    const viaJob = clone(other);
    if ( !(await Store.warmSigs(viaJob, async () => null, (m) => Chunks.work(m).then((r) => r.result))) ) problems.push("warmSigs: the sigs job gave nothing");
    const jobOut = Store.sigsOf(viaJob);
    const pageOut = (await import(pathToFileURL(path.join(ROOT, "scripts/destruction/substrate.mjs")).href))
      .fullSigs(other.objects, (o) => Store.objSig(other, o), other.params, Model.K, (o) => o.bytes ?? Model.objBytes(o));
    if ( JSON.stringify(jobOut) !== JSON.stringify(pageOut) ) problems.push("the sigs job differs from the page's signatures");
  }
  Hooks.callAll("canvasTearDown");
  done("destruction load path");
}
