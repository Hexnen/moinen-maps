// Weather engine + public API on the strength v (dev/weather-slider-design.md T2, 2.5 / 3.3 / 3.5 / 4.4 / D6):   node dev/weather-api.test.mjs
//   A. the API's argument helpers (model.mjs setChange / levelChange / cloudsChange / strengthChange): old int callers keep their
//      meaning (level 1..3, i), floats are not rounded, patches keep the other effects
//   B. the client cap (capFx, as clientState uses it) vs the old per-effect formula: p and s bit for bit, v kept
//   C. the tornado's level change (tornado-model retarget, D6): steady ints identical to the old formula, mid-ramp continuous, floats
//   D. the REAL weatherApi (scripts/weather/weather.mjs) under small Foundry stubs: set / level / clouds / strength / state / lens /
//      tornado.add / update / list, what is written to the scene flag, back compatibility, and the engine reads no v1 shape
import { readFileSync } from "node:fs";
import * as M from "../scripts/weather/model.mjs";
import * as TM from "../scripts/weather/tornado-model.mjs";

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
// (key order does not matter: objects compared with sorted keys)
const sortK = (x) => Array.isArray(x) ? x.map(sortK) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortK(x[k])])) : x;
const eq = (a, b) => JSON.stringify(sortK(a)) === JSON.stringify(sortK(b));
const P0 = () => M.cleanParams({});
const keyOf = (P, c, now = 1000) => { const { keys, base } = M.withKey(P, c, now, { dur: 0, lead: 0 }); return M.cleanParams({ ...P, keys, base }); };

/* A: argument helpers */
{
  // the old set(): c.level = lvlOf(level) ?? 2 (round, 1..3), c.i = clamp(Number(i) || 0); ints 1..3 must give the same change
  const lvlOf = (x) => { const v = Math.round(Number(x)); return v >= 1 && v <= 3 ? v : null; };
  const oldSet = (what, { level, i } = {}) => {
    const c = typeof what === "string" ? { preset: what } : { ...(what ?? {}) };
    if ( level !== undefined ) c.level = lvlOf(level) ?? 2;
    if ( i !== undefined ) c.i = Math.min(1, Math.max(0, Number(i) || 0));
    if ( c.fx && !c.preset ) c.preset = "custom";
    return c;
  };
  for ( const preset of Object.keys(M.PRESETS) ) for ( const level of [undefined, 1, 2, 3] ) for ( const i of [undefined, 0, 0.25, 0.5, 1] ) {
    const a = keyOf(P0(), M.setChange(preset, { level, i })), b = keyOf(P0(), oldSet(preset, { level, i }));
    ok(eq(M.current(a), M.current(b)) && eq(M.resolve(a, 2000), M.resolve(b, 2000)), `set(${preset}, ${level}, ${i}) as before`);
  }
  // with i: v = level + (i - 0.5) x 0.7
  ok(M.current(keyOf(P0(), M.setChange("rain", { level: 3, i: 1 }))).fx.rain === 3.35, "set level 3 i 1 -> 3.35 (overdrive)");
  ok(M.current(keyOf(P0(), M.setChange("rain", { level: 2.4, i: 0.5 }))).fx.rain === 2.4, "float level with i 0.5 = the level");
  // floats: no rounding
  for ( const v of [0.05, 0.5, 1.25, 2.4, 2.95, 3.35] ) ok(M.current(keyOf(P0(), M.setChange("storm", { level: v }))).fx.rain === v, `set storm at ${v}: no rounding`);
  ok(eq(M.current(keyOf(P0(), M.setChange("rain", { level: 9 }))).fx, { rain: 3.35 }), "a level above the top clamps to 3.35");
  ok(eq(M.current(keyOf(P0(), M.setChange("rain", { level: "junk" }))).fx, { rain: 2 }), "junk level -> 2 (as lvlOf ?? 2)");
  ok(eq(M.current(keyOf(P0(), M.setChange("rain", { level: 0 }))).fx, {}), "level 0 -> the preset's effects off");
  ok(eq(M.setChange({ fx: { rain: 2 } }), { fx: { rain: 2 }, preset: "custom" }), "fx without a preset: custom (exactly fx)");
  // level()
  let P = keyOf(P0(), M.setChange("storm", { level: 2 }));
  P = keyOf(P, M.cloudsChange(1.5), 2000);
  P = keyOf(P, M.levelChange(2.6), 3000);
  ok(eq(M.current(P).fx, { rain: 2.6, wind: 2.6, clouds: 1.5 }) && M.current(P).preset === "storm" && M.current(P).level === 2.6, "level(2.6): the preset's effects, clouds kept");
  ok(eq(M.current(keyOf(P, M.levelChange(3, { i: 0 }), 4000)).fx, { rain: 2.65, wind: 2.65, clouds: 1.5 }), "level(3, { i: 0 }) folds i");
  ok(eq(M.current(keyOf(P, M.levelChange(0), 4000)).fx, { clouds: 1.5 }), "level(0) removes the preset's effects");
  ok(eq(M.levelChange("x"), { level: 2 }), "level junk -> 2");
  // clouds()
  ok(eq(M.cloudsChange(1.7), { clouds: 1.7 }) && eq(M.cloudsChange("x"), { clouds: 0 }) && eq(M.cloudsChange(-1), { clouds: 0 }), "clouds: float, junk / negative 0");
  for ( const l of [0, 1, 2, 3] ) {   // the old clouds(): round(level) 0..3
    const a = keyOf(keyOf(P0(), { preset: "rain", level: 2 }), M.cloudsChange(l), 2000), b = keyOf(keyOf(P0(), { preset: "rain", level: 2 }), { clouds: l }, 2000);
    ok(eq(M.current(a), M.current(b)), `clouds(${l}) as before`);
  }
  ok(M.current(keyOf(P0(), M.cloudsChange(2.35))).fx.clouds === 2.35, "clouds 2.35 not rounded");
  // strength()
  ok(M.strengthChange(null) === null && M.strengthChange({}) === null && M.strengthChange({ fog: 2, rain: "x" }) === null, "no patch: null (unknown effects, junk ignored)");
  ok(eq(M.strengthChange({ rain: 2.4, snow: null, sand: false, dust: 0, wind: "1.5", fog: 1 }), { fx: { rain: 2.4, snow: 0, sand: 0, dust: 0, wind: 1.5 } }), "patch values cleaned; null / false / 0 remove");
  P = keyOf(P0(), M.setChange("storm", { level: 3 }));
  const P2 = keyOf(P, M.strengthChange({ rain: 1.2 }), 2000);
  ok(eq(M.current(P2).fx, { rain: 1.2, wind: 3 }) && M.current(P2).preset === "storm", "a patch keeps the others and the preset name");
  const P3 = keyOf(P2, M.strengthChange({ snow: 0.5 }), 3000);
  ok(M.current(P3).preset === "custom" && eq(M.current(P3).fx, { rain: 1.2, wind: 3, snow: 0.5 }), "adding an effect: custom");
  ok(M.current(keyOf(P2, M.strengthChange({ rain: 0 }), 3000)).preset === "wind", "removing rain from a storm: the wind preset");
  // strengthsOf: target and live
  {
    const Q = M.cleanParams({ keys: [{ t: 0, dur: 0, preset: "rain", level: 3, fx: { rain: 3 } }, { t: 10000, dur: 10000, preset: "rain", level: 1, fx: { rain: 1 } }] });
    const a = M.strengthsOf(Q, 15000), b = M.strengthsOf(Q, 25000);
    ok(a.target.rain === 1 && Math.abs(a.live.rain - 2) < 1e-9 && a.steady === false && a.until === 20000, "strengthsOf mid-ramp: target 1, live 2");
    ok(b.live.rain === 1 && b.steady && b.preset === "rain" && b.level === 1, "strengthsOf steady");
    ok(eq(M.strengthsOf(P0(), 0), { preset: "clear", level: 2, target: {}, live: {}, steady: true, until: null }), "strengthsOf with no keys");
  }
}

/* B: the client cap as clientState applies it (capFx) vs the old per-effect formula */
{
  let same = true, cnt = 0;
  // (caps 1..3: cap 0 is "off", shown() is false and clientState never reaches a display; the old formula gave a negative s there)
  for ( let k = 0; k <= 335; k++ ) for ( const cap of [1, 2, 3] ) {
    const v = k / 100, f = M.strength(v), c = M.capFx({ rain: f }, cap).rain;
    const old = { p: f.p, s: Math.min(f.s, cap - 1 + 0.35) };
    if ( !(Object.is(c.p, old.p) && Object.is(c.s, old.s) && c.v <= cap + 0.35 + 1e-12 && (v > cap + 0.35 || c.v === v)) ) same = false;
    cnt++;
  }
  ok(same, `capFx = the old clientState cap bit for bit (${cnt} cases), v kept / capped`);
  // through resolve at the levels, every cap: the capped state's p and s are the old ones (the old state from (p, s) of the level)
  for ( const lv of [1, 2, 3] ) for ( const cap of [1, 2, 3] ) {
    const st = M.resolve(keyOf(P0(), { preset: "storm", level: lv }), 5000), c = M.capFx(st.fx, cap);
    ok(c.rain.p === 1 && c.rain.s === Math.min(lv - 1, cap - 1 + 0.35) && c.wind.s === c.rain.s, `level ${lv} cap ${cap}`);
  }
}

/* C: the tornado's level change (D6) */
{
  const T0 = TM.cleanTornado({ id: "a", path: [[0, 0]], t0: 0, level: 2, lv0: 1, lvT: 0 });
  // the old update: lv0 = clamp(round(s + 1)), level = clamp(round(level)) || T.level
  const oldUpd = (T, level, now) => ({ ...T, lv0: Math.min(3, Math.max(1, Math.round(TM.levelS(T, now) + 1))), level: Math.min(3, Math.max(1, Math.round(Number(level)) || T.level)), lvT: Math.round(now) });
  for ( const from of [1, 2, 3] ) for ( const to of [1, 2, 3] ) {
    const T = TM.cleanTornado({ ...T0, level: from, lv0: from });
    const a = TM.retarget(T, to, 60000), b = oldUpd(T, to, 60000);
    let same = eq(a, b);
    for ( let t = 60000; t <= 66000; t += 250 ) same &&= Object.is(TM.levelS(a, t), TM.levelS(b, t));
    ok(same, `steady ${from} -> ${to}: record and ramp as before`);
  }
  // mid-ramp: no jump (old: lv0 rounded to the nearest int)
  const T = TM.retarget(TM.cleanTornado({ ...T0, level: 1, lv0: 1 }), 3, 10000), mid = 12000, sMid = TM.levelS(T, mid);
  const R = TM.retarget(T, 1, mid);
  ok(Math.abs(TM.levelS(R, mid) - sMid) < 1e-4, "a change during a running ramp starts where it is");
  ok(Math.abs(TM.levelS(oldUpd(T, 1, mid), mid) - sMid) > 0.1, "(the old formula jumped there)");
  let maxStep = 0, prev = TM.levelS(R, mid);
  for ( let t = mid; t <= mid + 6000; t += 10 ) { const s = TM.levelS(R, t); maxStep = Math.max(maxStep, Math.abs(s - prev)); prev = s; }
  ok(maxStep < 0.01, `the new ramp is continuous (max step ${maxStep.toFixed(4)} per 10 ms)`);
  // floats, clamps, junk
  ok(TM.retarget(T0, 2.35, 9000).level === 2.35 && TM.levelS(TM.retarget(T0, 2.35, 9000), 20000) === 1.35, "float level 2.35");
  ok(TM.retarget(T0, 0, 9000).level === 1 && TM.retarget(T0, 7, 9000).level === 3, "0 clamps to 1 (never a rope-out), 7 to 3");
  ok(TM.retarget(T0, "x", 9000).level === 2, "junk keeps the level");
  ok(TM.cleanTornado(TM.retarget(T, 2.5, mid)).lv0 === TM.retarget(T, 2.5, mid).lv0, "lv0 survives cleaning (rounded to 1e-4 already)");
}

/* D: the real weatherApi under Foundry stubs */
{
  const hooks = new Map();
  const any = (name) => new Proxy(function () {}, {
    get(t, k) { if ( k === Symbol.toPrimitive ) return () => 0; if ( k === "then" ) return undefined; if ( k === Symbol.iterator ) return function* () {}; if ( !(k in t) ) t[k] = any(`${name}.${String(k)}`); return t[k]; },
    apply: () => any(`${name}()`), construct: () => any(`new ${name}`), set(t, k, v) { t[k] = v; return true; }
  });
  globalThis.Hooks = { on(h, fn) { if ( !hooks.has(h) ) hooks.set(h, []); hooks.get(h).push(fn); }, once(h, fn) { this.on(h, fn); }, off() {}, callAll(h, ...a) { for ( const fn of hooks.get(h) ?? [] ) fn(...a); return true; }, call(h, ...a) { return this.callAll(h, ...a); } };
  const writes = [];
  const scene = { id: "s1", flags: {}, async update(d) { writes.push(structuredClone(d)); return scene; } };
  const settings = new Map([["moinen-maps.weatherDetail", "3"], ["moinen-maps.weatherLens", "3"]]);
  globalThis.foundry = new Proxy({ utils: { randomID: (() => { let c = 0; return (k = 10) => `t${++c}`.padEnd(k, "x"); })(), deepClone: (o) => structuredClone(o), mergeObject: (a, b) => Object.assign(a, b), getProperty: () => undefined, debounce: (f) => f } },
    { get: (t, k) => (k in t ? t[k] : (t[k] = any(`foundry.${String(k)}`))) });
  globalThis.game = { ready: true, user: { id: "gm", isGM: true }, users: { activeGM: null }, settings: { get: (m, k) => settings.get(`${m}.${k}`), register() {}, set: async () => {} },
    i18n: { localize: (k) => k, format: (k) => k }, modules: new Map([["moinen-maps", { id: "moinen-maps", active: true, api: null }]]), time: { serverTime: Date.now() }, socket: any("socket") };
  globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
  globalThis.CONFIG = new Proxy({}, { get: (t, k) => (t[k] ??= any(`CONFIG.${String(k)}`)) });
  globalThis.CONST = any("CONST"); globalThis.PIXI = any("PIXI");
  // (canvas not ready: refresh / syncs return at once; the API's model and write paths run in full)
  globalThis.canvas = new Proxy({ ready: false, scene, grid: { size: 100 } }, { get: (t, k) => (k in t ? t[k] : (t[k] = any(`canvas.${String(k)}`))) });
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.document = new Proxy({ addEventListener() {}, createElement: () => any("el"), querySelector: () => null, querySelectorAll: () => [] }, { get: (t, k) => (k in t ? t[k] : (t[k] = any(`document.${String(k)}`))) });
  globalThis.window = globalThis; globalThis.addEventListener ??= () => {}; globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);

  const W = await import("../scripts/weather/weather.mjs");
  const { sharedNow } = await import("../scripts/shared-clock.mjs");
  const A = W.weatherApi;
  const flag = () => writes.at(-1)?.["flags.moinen-maps.weather"];
  const reset = () => W.setParams({ keys: [], base: null, tornadoes: [], lens: { level: "auto" } });
  // (setParams merges: clear the keys by writing a clean flag through the module's own load path is not exported; keys: [] patch works)
  reset();

  // set: ints as before (level, i), floats kept, the flag VERSION 2 with numeric fx
  A.set("rain", { level: 3, over: 0 });
  ok(flag()?.v === 2 && eq(flag().keys.at(-1).fx, { rain: 3 }) && !("i" in flag().keys.at(-1)), "set(rain, { level: 3 }): v2 key, fx { rain: 3 }");
  A.set("storm", { level: 2, i: 1, over: 0 });
  ok(eq(flag().keys.at(-1).fx, { rain: 2.35, wind: 2.35 }), "set(storm, { level: 2, i: 1 }) folds i (old meaning)");
  A.set("snow", { level: 2.4, over: 0 });
  ok(eq(flag().keys.at(-1).fx, { snow: 2.4 }) && flag().keys.at(-1).level === 2.4, "set(snow, { level: 2.4 }): float, not rounded");
  A.set("rain", { over: 0 });
  ok(eq(flag().keys.at(-1).fx, { rain: 2.4 }), "set(rain): the preset strength carries over (2.4)");
  // level
  A.level(1.25, { over: 0 });
  ok(eq(flag().keys.at(-1).fx, { rain: 1.25 }), "level(1.25): float");
  A.level(2, { i: 0, over: 0 });
  ok(eq(flag().keys.at(-1).fx, { rain: 1.65 }), "level(2, { i: 0 }) = 1.65 (old meaning)");
  // clouds
  let r = A.clouds({ level: 1.7 }, { over: 0 });
  ok(r.level === 1.7 && eq(flag().keys.at(-1).fx, { rain: 1.65, clouds: 1.7 }), "clouds({ level: 1.7 }): float, returns the target strength");
  ok(A.clouds().level === 1.7 && "mode" in A.clouds(), "clouds() reads the level (was undefined -> 0 after T1)");
  A.clouds({ level: 0 }, { over: 0 });
  ok(A.clouds().level === 0 && !("clouds" in flag().keys.at(-1).fx), "clouds({ level: 0 }) removes them");
  // strength
  r = A.strength({ rain: 2.6, dust: 0.4 }, { over: 0 });
  ok(eq(r.target, { rain: 2.6, dust: 0.4 }) && r.preset === "custom" && eq(flag().keys.at(-1).fx, { rain: 2.6, dust: 0.4 }), "strength(): the patch, written");
  const nW = writes.length;
  r = A.strength();
  ok(writes.length === nW && eq(r.target, { rain: 2.6, dust: 0.4 }) && "live" in r && "steady" in r, "strength() without a patch only reads");
  A.strength({ fog: 3 });
  ok(writes.length === nW, "strength() with nothing valid writes nothing");
  // a ramp: live v between, state() exposes v
  // (at: a moment after the previous key, so it is not replaced: keys at the same ms are the newest change only)
  A.strength({ rain: 0.6 }, { over: 10000, at: sharedNow() + 2000 });
  const t0 = flag().keys.at(-1).t;
  const st = A.state(t0 + 5000);
  ok(Math.abs(st.fx.rain.v - 1.6) < 1e-9 && st.fx.rain.p === 1 && Math.abs(st.fx.rain.s - 0.6) < 1e-9, "state() has { v, p, s } mid-ramp (2.6 -> 0.6 at half: 1.6)");
  ok(A.state(t0 + 20000).fx.rain.v === 0.6 && A.state(t0 + 20000).fx.rain.p === 0.6, "state() below 1: p = v");
  // set with fx only (old custom form) and old fx shapes in it
  A.set({ fx: { snow: { l: 3, i: 0.5 }, wind: 1 } }, { over: 0 });
  ok(eq(flag().keys.at(-1).fx, { snow: 3, wind: 1 }) && flag().keys.at(-1).preset === "blizzard", "set({ fx }) with a v1 { l, i } value: exactly fx");
  // lens: fixed strength float kept
  A.lens({ level: 0.5 });
  ok(flag().lens.level === 0.5 && M.lensP(M.cleanParams(flag())) === 0.5, "lens({ level: 0.5 }): a float strength, presence 0.5");
  A.lens({ level: "auto" });
  ok(flag().lens.level === "auto", "lens auto");
  // status: the state field (this client's capped state) carries v (canvas not ready: lastState null; resolve-shaped by contract)
  ok("state" in A.status() && A.status().detail === 3, "status() has state and the detail cap");
  // rainAt follows p and s
  reset();
  A.set("rain", { level: 2, over: 0 });
  await new Promise((res) => setTimeout(res, M.LEAD_MS + 50));
  ok(Math.abs(A.rainAt() - 0.7) < 1e-12, "rainAt at v 2 = 0.7 (as level 2)");

  // tornadoes
  const id = A.tornado.add([[100, 100]], { level: 2.5, at: sharedNow() - 100000 });
  ok(!!id && flag().tornadoes.find((T) => T.id === id).level === 2.5, "tornado.add({ level: 2.5 }): float");
  let L = A.tornado.list().find((T) => T.id === id);
  ok(Math.abs(L.v - 2.5) < 1e-12 && Math.abs(L.s - 1.5) < 1e-12, "tornado.list(): s and v");
  A.tornado.update(id, { level: 1 });
  const T1r = flag().tornadoes.find((T) => T.id === id);
  ok(T1r.level === 1 && T1r.lv0 === 2.5, "tornado.update({ level: 1 }) from 2.5 steady: lv0 2.5 (the old code rounded it to 3)");
  A.tornado.update(id, { level: 0 });
  ok(flag().tornadoes.find((T) => T.id === id).level === 1 && flag().tornadoes.find((T) => T.id === id).out === null, "level 0: clamps to 1, no rope-out");
  A.tornado.update(id, { level: 3 });
  const T3r = flag().tornadoes.find((T) => T.id === id);
  ok(T3r.lv0 >= 1 && T3r.lv0 <= 2.5 && T3r.level === 3, "an update during a ramp starts from the level now (float)");

  // the engine reads no v1 shape (source checks; section.mjs is T5's)
  const src = readFileSync(new URL("../scripts/weather/weather.mjs", import.meta.url), "utf8");
  ok(!/lvlOf|\.l\b|Math\.round\(Number\(patch\.level\)\)|Math\.round\(s \+ 1\)/.test(src), "weather.mjs: no lvlOf, no .l, no rounded tornado levels");
  ok(/M\.capFx\(st\.fx, detailCap\(\)\)/.test(src), "clientState caps with M.capFx");
  ok(/M\.lensP\(P\) > 0/.test(src), "syncLens: no lens for a fixed strength 0");
  const lsrc = readFileSync(new URL("../scripts/weather/lens.mjs", import.meta.url), "utf8");
  ok(/\(P\?\.lens\?\.strength \?\? 1\) \* \(P\?\.lens \? M\.lensP\(P\) : 1\)/.test(lsrc) && /p = \(rain\?\.p \?\? 0\) \* str/.test(lsrc) && /p: f\.p \* str/.test(lsrc), "lens.mjs: every presence x lensP");
}

console.log(fails ? `${fails}/${n} FAILED` : `all ${n} checks passed`);
process.exit(fails ? 1 : 0);
