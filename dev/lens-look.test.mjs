// DROPS: the two looks of the weather lens (pixel art, the default; smooth), offline:   node dev/lens-look.test.mjs
//   A. the rules (scripts/weather/lens-look.mjs): the default is pixel art, anything unknown is the default, the grid at many DPRs and
//      window sizes puts every lens px on whole device px (crisp blocks), the pixel pass draws one px per lens px, the smooth one three
//   B. the programs (scripts/weather/lens.mjs): every pixel-art swap applies (a renamed line throws, never silently leaves the smooth
//      look on), the pixel pass decides each lens px at its centre with hard edges, its show reads whole lens px; the smooth programs are
//      byte for byte the ones before DROPS (the base tree's source, through dev/lib/baseline.mjs) but for DROPSVIS's listed lines
//   C. the setting (the REAL weather.mjs under small Foundry stubs): world, restricted, out of Foundry's list, default "pixel", live
//      (onChange), its window a menu every user can open; an existing world (nothing stored, an old scene flag) keeps working and draws
//      pixel art; the GM switches with the API, a player's write is refused
//   D. the lens itself (the REAL WeatherLens on a fake PIXI): both looks render a whole step; a switch while it runs re-makes its targets
//      and programs on the next frame (pixel: lens size, NEAREST, the -px programs; smooth: 3x, LINEAR) and frees the old ones
import assert from "node:assert/strict";

let n = 0;
const ok = (c, msg) => { n++; assert.ok(c, msg); };

/* ---------------------------------------------------------------- A: the rules */
const LL = await import("../scripts/weather/lens-look.mjs");
ok(LL.DEFAULT_LOOK === "pixel", "the default look is pixel art");
ok(LL.LOOKS.join() === "pixel,smooth", "two looks");
for ( const v of [undefined, null, "", "junk", 3, "Pixel"] ) ok(LL.cleanLook(v) === "pixel", `cleanLook(${JSON.stringify(v)}) -> pixel`);
ok(LL.cleanLook("smooth") === "smooth" && LL.cleanLook("pixel") === "pixel", "the two looks stay");
ok(LL.mayWrite({ isGM: true }) && !LL.mayWrite({ isGM: false }) && !LL.mayWrite(null), "only a GM writes the table's look");
for ( const dpr of [0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3] ) for ( const [w, h] of [[1600, 900], [1366, 768], [1920, 1080], [801, 601], [390, 844]] ) {
  const P = LL.lensGrid(w, h, dpr, "pixel"), S = LL.lensGrid(w, h, dpr, "smooth");
  ok(Number.isInteger(P.lpx) && P.lpx >= 1 && Math.abs(P.css * dpr - P.lpx) < 1e-9, `dpr ${dpr}: a lens px is ${P.lpx} whole device px`);
  ok(P.lw * P.css >= w - 1e-9 && (P.lw - 1) * P.css < w && P.lh * P.css >= h - 1e-9, `${w}x${h}@${dpr}: the lens covers the screen, no spare column`);
  ok(P.W === P.lw && P.H === P.lh && P.sub === 1 && P.scale === "nearest", "pixel art: one px of the pass per lens px, shown NEAREST");
  ok(S.W === 3 * S.lw && S.H === 3 * S.lh && S.sub === 3 && S.scale === "linear", "smooth: three px per lens px, LINEAR");
  ok(S.lpx === P.lpx && S.lw === P.lw, "both looks share the lens grid (same drops, same places)");
}
ok(LL.lensGrid(1600, 900, 1, undefined).look === "pixel", "no look given: pixel art");

/* ---------------------------------------------------------------- B: the programs */
class Stub { toArray() { return []; } }
const progs = [];
globalThis.PIXI = new Proxy({ Program: { from: (vertexSrc, fragmentSrc, name) => { const p = { vertexSrc, fragmentSrc, name }; progs.push(p); return p; } } }, { get: (o, k) => o[k] ?? Stub });
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
const Lens = await import("../scripts/weather/lens.mjs");
const px = Lens.lensPrograms("pixel"), sm = Lens.lensPrograms("smooth"), def = Lens.lensPrograms();
ok(def.every((p, i) => p === px[i]), "lensPrograms() without a look = pixel art (the pre-warm of a world without the setting)");
const name = (L) => L.map((p) => p.name.replace("moinen-maps-weather-lens", "L"));
ok(name(px).join() === "L-px,L-px-disp,L-runners,L-beads,L-px-show", `pixel programs ${name(px)}`);
ok(name(sm).join() === "L,L-disp,L-runners,L-beads,L-show", `smooth programs ${name(sm)}`);
ok(px[2] === sm[2] && px[3] === sm[3], "the pre-passes are shared (same runners and beads: the same drops in both looks)");
const pf = px[0].fragmentSrc, sf = sm[0].fragmentSrc;
ok(pf.includes("vec2 p = floor(vP) + 0.5;") && !sf.includes("vec2 p = floor(vP) + 0.5;"), "pixel art: each lens px decided at its centre");
ok(pf.includes("float cov(float s) { return s < 0.0 ? 1.0 : 0.0; }"), "pixel art: hard edges");
ok(/float bay\(vec2 p\)/.test(pf) && pf.includes("step(bay(p), on)"), "pixel art: the wet trail dries by an ordered dither");
ok(!/float bay\(/.test(sf) && sf.includes("clamp(0.5 - s / uAA, 0.0, 1.0)"), "smooth keeps its antialiasing");
ok(px[4].fragmentSrc.includes("texelFetch(uShade, ip, 0)") && !/texture\(uShade/.test(px[4].fragmentSrc), "pixel show: one whole lens px per block (no interpolation)");
assert.throws(() => Lens.pixelize("#version 300 es\nvoid main() {}"), /swap target is gone/, "a missing swap target throws");
// every swap target exists exactly once in the source (a duplicate would swap the wrong line)
const raw = Lens.lensPrograms("smooth")[0].fragmentSrc;
for ( const m of (await import("node:fs")).readFileSync(new URL("../scripts/weather/lens.mjs", import.meta.url), "utf8").matchAll(/^  \["(.+?)",/gm) ) {
  const t = JSON.parse(`"${m[1]}"`);
  ok(raw.split(t).length === 2, `swap target once: ${t.slice(0, 50)}`);
}
// the smooth look is the lens before DROPS, byte for byte (fb542cd: the commit DROPS started from; its lens.mjs written next to the
// current one so its imports resolve, then removed)
{
  const fs = await import("node:fs"), { execFileSync } = await import("node:child_process");
  const dir = new URL("../scripts/weather/", import.meta.url), tmp = new URL(`.lens-base-${process.pid}.mjs`, dir);
  fs.writeFileSync(tmp, execFileSync("git", ["show", "fb542cd:scripts/weather/lens.mjs"], { cwd: new URL("..", import.meta.url) }));
  let old;
  try {
    globalThis.PIXI = new Proxy({ Program: { from: (vertexSrc, fragmentSrc, name) => ({ vertexSrc, fragmentSrc, name }) } }, { get: (o, k) => o[k] ?? Stub });
    old = (await import(tmp.href)).lensPrograms();
  } finally { fs.rmSync(tmp, { force: true }); }
  const byName = Object.fromEntries(sm.map((p) => [p.name, p]));
  ok(old.length === 5, "the base had 5 lens programs");
  // DROPSVIS (2026-11-15) changed the drops on purpose, in both looks (dev/lens-vis.test.mjs): the smooth programs are the base's with
  // exactly these lines changed, nothing else (each old line must be in the base once)
  const VIS = [
    ["float r = 0.5 + big * pow(hu(key, CY, 313), 2.6);", "float r = 0.5 + big * pow(hu(key, CY, 313), 1.9);"],
    ["if ( dR < 1.25 ) { bAdd = vec3(0.07) * uLight; bK = 0.97; } else { bAdd = vec3(0.04) * uLight; bK = 1.0; }",
      "if ( dR < 1.25 ) { bAdd = vec3(0.15) * uLight; bK = 0.97; } else { bAdd = vec3(0.10) * uLight; bK = 1.0; }"],
    ["srcK = 0.97 + 0.07 * ss(0.1, 0.8, n.y) * step(2.2, dR);", "srcK = 0.99 + 0.10 * ss(0.1, 0.8, n.y) * step(2.2, dR);"],
    ["      bAdd = vec3(0.05) * uLight * rim * (1.0 - low);\n", "      bAdd = vec3(0.12) * uLight * rim * (1.0 - low);\n"
      + "      bAdd += vec3(0.09) * uLight * ss(0.2, 0.8, n.y) * (1.0 - rim);   // (DROPSVIS: the light the drop focuses low inside it)\n"]
  ];
  const vis = (src) => VIS.reduce((s, [a, b]) => { ok(s.split(a).length <= 2, `DROPSVIS line at most once: ${a.slice(0, 40)}`); return s.replace(a, b); }, src);
  ok(old.some((p) => VIS.every(([a]) => p.fragmentSrc.includes(a))), "the base pass has every line DROPSVIS changed");
  for ( const p of old ) ok(byName[p.name] && byName[p.name].fragmentSrc === vis(p.fragmentSrc) && byName[p.name].vertexSrc === p.vertexSrc, `smooth ${p.name} = the base's + DROPSVIS`);
}

/* ---------------------------------------------------------------- C: the setting, the API, an existing world */
{
  const any = (nm) => new Proxy(function () {}, {
    get(t, k) { if ( k === Symbol.toPrimitive ) return () => 0; if ( k === "then" ) return undefined; if ( k === Symbol.iterator ) return function* () {}; if ( !(k in t) ) t[k] = any(`${nm}.${String(k)}`); return t[k]; },
    apply: () => any(`${nm}()`), construct: () => any(`new ${nm}`), set(t, k, v) { t[k] = v; return true; }
  });
  const hooks = new Map();
  globalThis.Hooks = { on(h, fn) { if ( !hooks.has(h) ) hooks.set(h, []); hooks.get(h).push(fn); }, once(h, fn) { this.on(h, fn); }, off() {}, callAll(h, ...a) { for ( const fn of hooks.get(h) ?? [] ) fn(...a); return true; }, call(h, ...a) { return this.callAll(h, ...a); } };
  const reg = new Map(), menus = new Map(), store = new Map([["moinen-maps.weatherDetail", "3"], ["moinen-maps.weatherLens", "3"]]), sets = [];
  globalThis.foundry = new Proxy({ applications: { api: { ApplicationV2: class { render() { return this; } } } }, utils: { deepClone: (o) => structuredClone(o), mergeObject: (a, b) => Object.assign(a, b), getProperty: () => undefined, debounce: (f) => f, randomID: () => "x" } },
    { get: (t, k) => (k in t ? t[k] : (t[k] = any(`foundry.${String(k)}`))) });
  const user = { id: "gm", isGM: true };
  globalThis.game = { ready: true, user, users: { activeGM: null }, i18n: { localize: (k) => k, format: (k) => k }, modules: new Map([["moinen-maps", { id: "moinen-maps", active: true, api: null }]]),
    time: { serverTime: Date.now() }, socket: any("socket"),
    settings: {
      register: (m, k, o) => reg.set(k, o), registerMenu: (m, k, o) => menus.set(k, o),
      // (Foundry: a key never stored reads its default)
      get: (m, k) => (store.has(`${m}.${k}`) ? store.get(`${m}.${k}`) : reg.get(k)?.default),
      set: async (m, k, v) => { sets.push([k, v]); store.set(`${m}.${k}`, v); reg.get(k)?.onChange?.(v); return v; }
    } };
  globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
  globalThis.CONFIG = new Proxy({}, { get: (t, k) => (t[k] ??= any(`CONFIG.${String(k)}`)) });
  globalThis.CONST = any("CONST"); globalThis.PIXI = any("PIXI");
  const scene = { id: "s1", flags: {}, async update() { return scene; } };
  globalThis.canvas = new Proxy({ ready: false, scene, grid: { size: 100 } }, { get: (t, k) => (k in t ? t[k] : (t[k] = any(`canvas.${String(k)}`))) });
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.document = new Proxy({ addEventListener() {}, createElement: () => any("el"), querySelector: () => null, querySelectorAll: () => [] }, { get: (t, k) => (k in t ? t[k] : (t[k] = any(`document.${String(k)}`))) });
  globalThis.window = globalThis; globalThis.addEventListener ??= () => {}; globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);

  const W = await import("../scripts/weather/weather.mjs");
  W.registerWeather();
  Hooks.callAll("init");
  const o = reg.get("weatherLensLook");
  ok(o && o.scope === "world" && o.restricted === true && o.config === false && o.default === "pixel", "weatherLensLook: world, the GM's, out of Foundry's list, default pixel");
  ok(Object.keys(o.choices).join() === "pixel,smooth", "its choices are the two looks");
  ok(typeof o.onChange === "function", "live: it has an onChange (every seat redraws)");
  const m = menus.get("weatherLensTable");
  ok(m && m.restricted === false && typeof m.type === "function", "its window is a menu every user can open (players read the look)");
  ok(reg.get("weatherLens")?.scope === "client", "the lens cap stays this seat's (machine / accessibility)");
  // an existing world: nothing stored, an old scene lens flag
  ok(!store.has("moinen-maps.weatherLensLook") && W.lensLook() === "pixel" && (await W.weatherApi.look()) === "pixel", "a world from before DROPS draws pixel art");
  const old = W.weatherApi.model.cleanParams({ on: true, lens: { on: true, level: "auto", strength: 0.6, heat: true } });
  ok(old.lens.on === true && old.lens.strength === 0.6 && old.lens.heat === true && !("look" in old.lens), "an old scene lens flag reads as before; the look is not in the scene flag");
  // the GM switches; the onChange makes it live (the cached setting is dropped: the next read is the new look)
  let tells = 0; Hooks.on("moinenMapsWeather", (k) => { if ( k === "client" ) tells++; });
  ok((await W.weatherApi.look("smooth")) === "smooth" && W.lensLook() === "smooth" && sets.at(-1)[0] === "weatherLensLook", "GM: look(smooth) writes the world setting, read back at once");
  ok(tells === 1, "the switch tells the open weather panels (they re-render)");
  ok((await W.weatherApi.look("nonsense")) === "pixel", "an unknown look writes the default");
  // a stored junk value (an edited world) still draws a valid look
  store.set("moinen-maps.weatherLensLook", "neon"); o.onChange("neon");
  ok(W.lensLook() === "pixel", "a junk stored value draws pixel art");
  store.set("moinen-maps.weatherLensLook", "smooth"); o.onChange("smooth");
  // a player: reads, never writes
  user.isGM = false; const n0 = sets.length;
  ok((await W.weatherApi.look("pixel")) === "smooth" && sets.length === n0, "a player's look(pixel) is refused; the table's look stays");
  user.isGM = true;
}

/* ---------------------------------------------------------------- D: the lens on a fake PIXI (both looks, a live switch) */
{
  const made = [], renders = [];
  class Obj { constructor() { this.destroyed = false; } destroy() { this.destroyed = true; } }
  class RT extends Obj { constructor(o) { super(); this.o = o; this.width = o.width; this.height = o.height; this.framebuffer = { glFramebuffers: {} }; made.push(this); } }
  class Geometry extends Obj { addAttribute(k, v) { this.v = v; return this; } addIndex() { return this; } }
  class UniformGroup { constructor(u) { this.uniforms = u; } }
  class Shader { constructor(program, u) { this.program = program; this.uniforms = u instanceof UniformGroup ? u.uniforms : u; } }
  class Mesh extends Obj { constructor(g, s, st) { super(); this.geometry = g; this.shader = s; this.state = st ?? {}; this.transform = { worldTransform: { set() {} } }; } }
  class Container extends Obj {}
  globalThis.PIXI = {
    Program: { from: (vertexSrc, fragmentSrc, name) => ({ vertexSrc, fragmentSrc, name }) },
    RenderTexture: { create: (o) => new RT(o) }, Geometry, UniformGroup, Shader, Mesh, Container,
    State: { for2d: () => ({}) }, Texture: { WHITE: {} }, Matrix: class { toArray() { return []; } },
    utils: { premultiplyBlendMode: [[], []] }, SCALE_MODES: { NEAREST: 0, LINEAR: 1 }, TYPES: { FLOAT: 5126 }, FORMATS: { RGBA: 6408 }, MIPMAP_MODES: { OFF: 0 }, BLEND_MODES: {}
  };
  globalThis.WebGL2RenderingContext = { ONE: 1, SRC_ALPHA: 770, ZERO: 0, FUNC_ADD: 32774 };
  const stage = { children: [], addChild(...c) { for ( const x of c ) { const i = this.children.indexOf(x); if ( i >= 0 ) this.children.splice(i, 1); this.children.push(x); x.parent = this; } }, removeChild(x) { this.children.splice(this.children.indexOf(x), 1); x.parent = null; } };
  const renderer = { resolution: 1.25, screen: { width: 1600, height: 900 }, gl: { getExtension: () => ({}) }, state: { blendModes: [] }, render: (m, o) => renders.push([m, o]) };
  globalThis.canvas = { app: { renderer, ticker: { add() {}, remove() {}, FPS: 60 } }, stage, environment: { darknessLevel: 0 } };
  globalThis.CONFIG = { moinenMaps: { weatherGuard: false } };
  const M = await import("../scripts/weather/model.mjs");
  const { WeatherLens } = await import("../scripts/weather/lens.mjs?fakepixi");   // (a fresh copy: its LensShow extends this fake Mesh)
  const L = new WeatherLens(); L.now = () => 1794150006000;
  const P = M.cleanParams({ on: true, lens: { on: true } }), st = { fx: { rain: { v: 3, p: 1, s: 3 } }, lensCap: 3, wind: { dir: 45, str: 0.3 }, seed: 7 };
  const look = (want) => {
    L.look = want; L.setState(st, P); renders.length = 0; L.tick();
    const G = LL.lensGrid(1600, 900, 1.25, want), shade = L.bufs.map((b) => b.rt);
    ok(L.stats.look === want && L.stats.lpx === G.lpx && L.stats.lw === G.lw, `${want}: the lens grid (lpx ${G.lpx}, ${G.lw} x ${G.lh})`);
    ok(shade.every((r) => r.width === G.W && r.height === G.H && r.o.scaleMode === (want === "pixel" ? 0 : 1)), `${want}: shade targets ${G.W} x ${G.H} ${G.scale}`);
    ok(L.slices[0].shader.program.name === (want === "pixel" ? "moinen-maps-weather-lens-px" : "moinen-maps-weather-lens"), `${want}: its pass program`);
    ok(L.sprite.shader.program.name === (want === "pixel" ? "moinen-maps-weather-lens-px-show" : "moinen-maps-weather-lens-show"), `${want}: its show program`);
    ok(L.slices[0].shader.uniforms.uAA === 1 / G.sub && L.slices[0].shader.uniforms.uVS === 1 / G.sub, `${want}: uAA = uVS = 1 / ${G.sub}`);
    // a whole step drawn: 2 pre-passes, 4 bands x (shade + refraction), then shown
    const bands = renders.filter(([m]) => L.slices.includes(m)).length, disp = renders.filter(([m]) => L.dslices.includes(m)).length;
    ok(bands === 4 && disp === 4 && renders.length === 10 && L.stats.renders >= 1 && !L.pend, `${want}: a whole step rendered (${renders.length} draws)`);
    ok(L.sprite.shader.uniforms.uShade === L.bufs[L.front].rt && stage.children.at(-1) === L.sprite, `${want}: shown, drawn last`);
    return [...shade, L.frameRT, L.sprite];
  };
  const a = look("pixel");
  const b = look("smooth");
  ok(a.every((x) => x.destroyed) && !b.some((x) => x.destroyed), "the switch to smooth freed the pixel targets and sprite, made new ones");
  ok(stage.children.filter((c) => c instanceof Mesh).length === 1, "one lens sprite on the stage after the switch");
  const c = look("pixel");
  ok(b.every((x) => x.destroyed) && !c.some((x) => x.destroyed), "and back to pixel art, live");
  renders.length = 0; L.tick();
  ok(renders.length === 0, "same step, same look: nothing re-made, nothing drawn");
  L.look = "junk"; L.setState(st, P); L.tick();
  ok(L.stats.look === "pixel", "a junk look draws pixel art");
  L.destroy();
  ok(c.every((x) => x.destroyed) && !stage.children.length, "destroy frees everything");
}
console.log(`lens-look: ok (${n} checks: pixel art by default, both looks render, live switch, existing worlds)`);
