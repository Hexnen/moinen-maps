// Destruction presets P7, the soundboard UI (dev/presets-design.md section 6):   node dev/presets-ui.test.mjs
//   A. the stored state: the world's presets and pad order cleaned, the bar's state cleaned
//   B. pads: order (ids first, the rest after), reorder, hotkeys 1-9 / Shift+1-9 both ways
//   C. the aftermath per preset (the preset's own, a client override, "no end") and the options of a firing
//   D. gestures: point / throw / line / run from a press and a release, a token as the thrower / shooter
//   E. the ghost of every built-in plan: finite, soft (feathered, never a full-alpha edge), the craters where the plan puts them, the
//      throw's arc lifted; the dry run swells in and fades out smoothly (no jump between frames)
//   F. the editor: values (ranges scaled), layers off left out of a firing, a duplicate that fires exactly as its original, the timeline
//   G. wiring: nothing runs before the tool is picked (no ticker, no canvas object, no listener at load); the settings are two
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const U = await imp("scripts/presets/ui-core.mjs");
const C = await imp("scripts/presets/core.mjs");
const { BUILTIN } = await imp("scripts/presets/defs.mjs");

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const J = (v) => JSON.stringify(v);
const env = { grid: 100, rect: { x: 0, y: 0, width: 4000, height: 3000 }, now: 1_800_000_000_000, wind: { dir: 0, speed: 0 } };

/* A */
{
  const s = U.cleanStore({ custom: [{ id: "a", layers: [] }, { id: "a", layers: [] }, { id: "bad id!", layers: [] }, { id: "x".repeat(40), layers: [] }, { id: "b" }, null], order: ["a", 3, "a", "bomb"] });
  ok(J(s.custom.map((d) => d.id)) === J(["a"]) && J(s.order) === J(["a", "bomb"]), `A store: duplicates, bad ids and junk dropped (${J(s)})`);
  ok(J(U.cleanStore(undefined)) === J({ v: 1, custom: [], order: [] }), "A store: empty");
  const b = U.cleanBar({ pad: "uzi", size: 9, power: 3, vary: false, aft: { bomb: 1000, grenade: null, x: "no" } });
  ok(b.pad === "uzi" && b.size === 2 && b.power === 0 && b.vary === false && J(b.aft) === J({ bomb: 600, grenade: null }), `A bar: clamped (${J(b)})`);
  ok(J(U.cleanBar(null)) === J({ pad: "bomb", size: 1, power: 0, vary: true, aft: {}, src: {} }), "A bar: defaults");
  // the shooters: "scene:pad" -> token id, junk dropped, at most SRC_MAX (the newest kept)
  const bs = U.cleanBar({ src: { "S1:uzi": "T1", "S1:heliHmg": "T2", "bad key": "T3", "S2:uzi": 5, "S3:uzi": "", "S4:x y": "T4" } });
  ok(J(bs.src) === J({ "S1:uzi": "T1", "S1:heliHmg": "T2" }), `A bar: shooters cleaned (${J(bs.src)})`);
  ok(U.srcOf(bs, "S1", "uzi") === "T1" && U.srcOf(bs, "S2", "uzi") === null && U.srcOf(null, "S1", "uzi") === null, "A bar: a pad's shooter on a scene");
  const w1 = U.withSrc(bs, "S1", "uzi", "T9"), w0 = U.withSrc(bs, "S1", "uzi", null);
  ok(J(w1) === J({ "S1:heliHmg": "T2", "S1:uzi": "T9" }) && J(w0) === J({ "S1:heliHmg": "T2" }) && J(bs.src) === J({ "S1:uzi": "T1", "S1:heliHmg": "T2" }), "A bar: set / clear a shooter (the newest last, the old bar untouched)");
  let many = {}; for ( let i = 0; i < U.SRC_MAX + 5; i++ ) many = U.withSrc({ src: many }, `S${i}`, "uzi", `T${i}`);
  ok(Object.keys(many).length === U.SRC_MAX && many[`S${U.SRC_MAX + 4}:uzi`] && !many["S0:uzi"], "A bar: at most SRC_MAX shooters, the oldest dropped");
  ok(Object.keys(U.cleanBar({ src: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`S${i}:uzi`, `T${i}`])) }).src).length === U.SRC_MAX, "A bar: a stored list longer than SRC_MAX cut");
  ok(U.isFirearm(BUILTIN.find((d) => d.id === "uzi")) && U.isFirearm(BUILTIN.find((d) => d.id === "heliHmg")) && !U.isFirearm(BUILTIN.find((d) => d.id === "bomb")) && !U.isFirearm(BUILTIN.find((d) => d.id === "grenade")) && !U.isFirearm(null),
    "A firearms: the guns (a walk), not the bomb or grenade");
}

/* B */
{
  const custom = [{ id: "bomb-copy", layers: [] }];
  const o = U.ordered(BUILTIN, { custom, order: ["uzi", "gone", "bomb-copy"] }).map((d) => d.id);
  ok(J(o) === J(["uzi", "bomb-copy", "bomb", "grenade", "heliHmg", "lightning"]), `B order: listed first, then the rest (${J(o)})`);
  ok(J(U.reorder(["a", "b", "c", "d"], "d", "b")) === J(["a", "d", "b", "c"]) && J(U.reorder(["a", "b", "c"], "a", null)) === J(["b", "c", "a"]) && J(U.reorder(["a", "b"], "z", "a")) === J(["a", "b"]), "B reorder");
  ok(U.hotkeyOf(0) === "1" && U.hotkeyOf(8) === "9" && U.hotkeyOf(9) === "⇧1" && U.hotkeyOf(17) === "⇧9" && U.hotkeyOf(18) === "", "B hotkey labels");
  ok(U.padOfKey("Digit1", false) === 0 && U.padOfKey("Digit9", true) === 17 && U.padOfKey("Numpad3", false) === 2 && U.padOfKey("Digit0", false) === -1 && U.padOfKey("KeyA", false) === -1, "B hotkeys -> pads");
  for ( let i = 0; i < 18; i++ ) ok(U.padOfKey(`Digit${(i % 9) + 1}`, i >= 9) === i, `B hotkey ${i} round trip`);
}

/* C */
{
  const bomb = BUILTIN.find((d) => d.id === "bomb"), uzi = BUILTIN.find((d) => d.id === "uzi");
  const b0 = U.cleanBar({});
  ok(J(U.aftermathOf(bomb, b0)) === J({ has: true, dur: 60, own: false }) && J(U.aftermathOf(uzi, b0)) === J({ has: false, dur: null, own: false }), "C aftermath: the preset's own; a gun has none");
  ok(J(U.aftermathOf(bomb, U.cleanBar({ aft: { bomb: null } }))) === J({ has: true, dur: null, own: true }), "C aftermath: no end");
  ok(J(U.fireOpts(bomb, b0, 7)) === J({ seed: 7, size: 1, power: 0 }), "C opts: the preset's aftermath is not sent");
  ok(J(U.fireOpts(bomb, U.cleanBar({ size: 1.5, power: 1, aft: { bomb: 120 } }), 9)) === J({ seed: 9, size: 1.5, power: 1, aftermath: 120 }), "C opts: overrides");
  ok(U.fireOpts(bomb, U.cleanBar({ aft: { bomb: null } }), 1).aftermath === null, "C opts: no end -> null");
  ok(!("aftermath" in U.fireOpts(uzi, U.cleanBar({ aft: { uzi: 30 } }), 1)), "C opts: a gun never takes an aftermath");
}

/* D */
{
  const g = 100;
  ok(J(U.gestureOf("point", [500, 500], [505, 503], g)) === J({ a: [500, 500], b: null, from: null }), "D point: a click");
  ok(J(U.gestureOf("point", [500, 500], [700, 500], g)) === J({ a: [500, 500], b: [700, 500], from: null }), "D point: a drag sets the direction");
  ok(J(U.gestureOf("throw", [100, 100], [600, 300], g)) === J({ a: [100, 100], b: [600, 300], from: null }), "D throw: from the press to the release");
  ok(J(U.gestureOf("throw", [110, 95], [600, 300], g, { x: 100, y: 100, r: 50 })) === J({ a: [100, 100], b: [600, 300], from: [100, 100] }), "D throw: from the token");
  ok(J(U.gestureOf("throw", [110, 95], [112, 96], g, { x: 100, y: 100, r: 50 })) === J({ a: [100, 100], b: null, from: [100, 100] }), "D throw: a click drops it at the thrower");
  const ln = U.gestureOf("line", [100, 100], [900, 100], g, { x: 100, y: 100, r: 50 });
  ok(J(ln) === J({ a: [200, 100], b: [900, 100], from: [100, 100], fr: 50 }), `D line from a token: the hits start past its edge (${J(ln)})`);
  // the chosen shooter: the hits where the drag is, fired from the shooter (its radius sent for the muzzle at its edge)
  const sh = { x: 100, y: 100, r: 50 };
  ok(J(U.gestureOf("line", [400, 300], [900, 300], g, null, sh)) === J({ a: [400, 300], b: [900, 300], from: [100, 100], fr: 50 }), "D line with a shooter: from the shooter, the hits along the drag");
  ok(J(U.gestureOf("line", [400, 300], [402, 301], g, null, sh)) === J({ a: [400, 300], b: null, from: [100, 100], fr: 50 }), "D line with a shooter: a click is a short burst there");
  ok(J(U.gestureOf("run", [0, 0], [1000, 200], g, null, sh)) === J({ a: [0, 0], b: [1000, 200], from: [100, 100], fr: 50 }), "D run with a shooter (the gunship)");
  ok(J(U.gestureOf("line", [100, 100], [900, 100], g, { x: 100, y: 100, r: 50 }, { x: 700, y: 700, r: 40 })) === J({ a: [100, 100], b: [900, 100], from: [700, 700], fr: 40 }), "D the chosen shooter wins over a token the drag starts on (a target)");
  ok(J(U.gestureOf("line", [110, 100], [900, 100], g, { x: 100, y: 100, r: 50 }, sh)) === J({ a: [200, 100], b: [900, 100], from: [100, 100], fr: 50 }), "D a drag out of the chosen shooter: the hits start past its edge");
  ok(J(U.gestureOf("run", [100, 100], [900, 100], g, { x: 100, y: 100, r: 50 })) === J({ a: [100, 100], b: [900, 100], from: null }), "D a run started on a token: no shooter (only a chosen one)");
  ok(J(U.gestureOf("line", [100, 100], [900, 100], g)) === J({ a: [100, 100], b: [900, 100], from: null }), "D line");
  ok(J(U.gestureOf("run", [0, 0], [1000, 200], g)) === J({ a: [0, 0], b: [1000, 200], from: null }), "D run");
}

/* E */
{
  const G = { point: { a: [2000, 1500], b: null }, throw: { a: [1500, 1600], b: [2000, 1500], from: [1500, 1600] }, line: { a: [1500, 1500], b: [2200, 1500] }, run: { a: [1200, 1300], b: [2400, 1700] } };
  const sumA = U.FEATHER.reduce((s, f) => s + f[1], 0);
  ok(U.RING_FEATHER.reduce((s, f) => s + f[1], 0) <= 1.0001, "E ring feather: never past the ring's alpha");
  ok(sumA <= 1.0001 && U.FEATHER.every((f, i) => i === 0 || f[0] < U.FEATHER[i - 1][0]), "E feather: rings shrink inwards and never add up past the shape's alpha");
  for ( const def of BUILTIN ) {
    const plan = C.expand(def, G[def.gesture], { seed: 5 }, env), gh = U.ghostOf(plan, { lift: 0.5, squash: 0.8 });
    const fin = gh.every((s) => s.k !== "dots" ? [s.x, s.y, s.r, s.sq, s.z, s.a, s.t, s.d, ...(s.k === "ring" ? [s.w] : [])].every(Number.isFinite) : s.pts.every((p) => p.every(Number.isFinite)));
    ok(gh.length > 0 && fin, `E ${def.id}: a finite ghost (${gh.length} shapes)`);
    ok(gh.every((s) => s.a <= (s.k === "dots" ? 0.8 : 0.6)), `E ${def.id}: soft (no area above 0.6 alpha, no aim dot above 0.8)`);
    const discs = plan.destruction.flatMap((r) => r.discs);
    ok(discs.every((dc) => gh.some((s) => s.k === "disc" && s.x === dc[0] && s.y === dc[1] && s.r === dc[2] && s.sq === 1)), `E ${def.id}: every crater / hit where the plan puts it, round on the map`);
    // the dry run: smooth (no jump bigger than a 60 fps frame's worth of the smoothstep)
    let worst = 0;
    for ( const s of gh ) { let prev = 0; for ( let t = s.t - 50; t <= s.t + s.d + 50; t += 16 ) { const a = U.dryAlpha(s, t); worst = Math.max(worst, Math.abs(a - prev)); prev = a; } }
    ok(worst < 0.2, `E ${def.id}: the dry run swells and fades smoothly (largest step ${worst.toFixed(3)})`);
    ok(U.dryEnd(gh) > 0 && U.dryEnd(gh) <= 9000, `E ${def.id}: the dry run ends`);
  }
  const gren = C.expand(BUILTIN.find((d) => d.id === "grenade"), G.throw, { seed: 3 }, env), arc = U.ghostOf(gren, { lift: 0.5, squash: 0.8 }).find((s) => s.k === "dots");
  const mid = arc.pts[Math.floor(arc.pts.length / 2)];
  ok(arc && J(arc.pts[0]) === J([1500, 1600]) && J(arc.pts.at(-1)) === J([2000, 1500]) && mid[1] < 1550 - 30, `E grenade: the arc from the thrower to the landing, lifted up the screen (${J(mid)})`);
  ok(U.dryAlpha({ t: 0, d: 1000 }, -1) === 0 && U.dryAlpha({ t: 0, d: 1000 }, 1001) === 0 && U.dryAlpha({ t: 0, d: 1000 }, 500) === 1, "E dry run: hidden before and after, full in the middle");
}

/* F */
{
  const bomb = BUILTIN.find((d) => d.id === "bomb");
  const crater = bomb.layers.find((L) => L.id === "crater"), rim = bomb.layers.find((L) => L.id === "rim");
  ok(U.getField(crater, "r") === 1.2 && U.setField(crater, "r", 2).r === 2 && U.setField(crater, "level", 7).level === 3, "F fields: a value, clamped");
  const r2 = U.setField(rim, "r", 0.75);
  ok(J(r2.r) === J([0.6, 0.9]), `F fields: a range scaled round its middle (${J(r2.r)})`);
  const copy = U.duplicate(bomb, "Bomb (copy)", BUILTIN.map((d) => d.id));
  ok(copy.id === "bomb-copy" && copy.custom && copy.name === "Bomb (copy)" && U.duplicate(bomb, "x", ["bomb-copy"]).id === "bomb-copy2", "F duplicate: a new id");
  ok(U.duplicate({ ...bomb, id: "a".repeat(32) }, "x", []).id.length <= 32, "F duplicate: the id stays within the expander's limit");
  const cl = C.cleanDef(copy);
  ok(cl.ok, `F duplicate: a valid definition (${cl.errors.join("; ")})`);
  const G = { a: [2000, 1500], b: null };
  const p1 = C.expand(bomb, G, { seed: 11 }, env), p2 = C.expand(U.effective(copy), G, { seed: 11 }, env);
  ok(J({ ...p1, preset: 0 }) === J({ ...p2, preset: 0 }), "F duplicate: fires exactly as its original");
  const off = { ...copy, layers: copy.layers.map((L) => (L.l === "fire" ? { ...L, off: true } : L)) };
  const p3 = C.expand(U.effective(off), G, { seed: 11 }, env);
  ok(p3.fire.every((f) => f.k === "smoke" || f.k === "dust") && p3.destruction.length === p1.destruction.length, "F a layer switched off is left out of the firing (the rest unchanged)");
  ok(C.cleanDef(U.effective(off)).ok, "F a definition with layers off stays valid");
  const tl = U.timelineOf(bomb);
  ok(tl.rows.length === bomb.layers.length && tl.from === -1200 && tl.to <= 8000 && tl.rows.every((r) => r.start <= r.end && r.end <= tl.to), `F timeline: a row per layer within the strip (${tl.from}..${tl.to})`);
  ok(tl.rows.find((r) => r.id === "column").long && tl.rows.find((r) => r.id === "fall").start === -1200, "F timeline: the lasting smoke runs past the strip; the fall starts in the lead-in");
  ok(J(U.shiftAt(rim, 130).at) === J([1050, 1450]) && U.shiftAt(crater, -10_000).at === -4000, "F timeline: a drag moves the start (snapped to 50 ms, within limits)");
}

/* G */
{
  const code = (f) => readFileSync(path.join(root, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const sec = code("scripts/presets/section.mjs"), aim = code("scripts/presets/aim.mjs"), store = code("scripts/presets/store.mjs"), uic = code("scripts/presets/ui-core.mjs");
  const hooks = aim.match(/.*Hooks\.on\(.*/g) ?? [];
  ok(!/ticker|setInterval/.test(aim) && hooks.length === 3 && hooks.every((l) => /listeners\.\w+ = Hooks\.on\(/.test(l)) && /listeners\.hook = Hooks\.on\(S\.HOOK/.test(aim)
    && (aim.match(/Hooks\.off\(/g) ?? []).length === 3, "G aim: no ticker or interval; its hooks (settings, the shooter's token moved / deleted) made with the tool's listeners and removed with them");
  ok(/function build\(\) \{\s*gfx = makeLayer\(\);/.test(aim) && (aim.match(/addEventListener\(/g) ?? []).length === 8 && /export function setActive\(on\) \{[\s\S]*?if \( on \) build\(\); else unbuild\(\);/.test(aim),
    "G aim: the ghost and the listeners are made only when the tool is picked, and gone when it is put down");
  ok(/export function onCanvasReady\(\) \{ stopFlash\(\); if \( active \)/.test(aim) && /export function onTearDown\(\) \{ stopFlash\(\); if \( active \)/.test(aim), "G aim: a new canvas does nothing unless the tool is in hand");
  const top = sec.slice(sec.indexOf("const OFF"));
  ok((top.match(/Hooks\.(on|once)\(/g) ?? []).length === 3 && !/ticker|setInterval/.test(top), "G section: at load only init (settings, extendSection), canvasReady and canvasTearDown");
  ok(/open: false, mount: mountPanel/.test(sec), "G section: the panel stays closed until the tool is first picked");
  ok((store.match(/game\.settings\.register\(/g) ?? []).length === 2 && /"destrPresets", \{ scope: "world"/.test(store) && /"presetBar", \{ scope: "client"/.test(store), "G store: two settings (the world's presets, this client's bar)");
  ok(!/game\.|canvas|PIXI|Hooks/.test(uic), "G ui-core: pure");
  const sections = readFileSync(path.join(root, "scripts/workspace/sections.mjs"), "utf8");
  ok(sections.indexOf("../presets/section.mjs") > sections.indexOf("../fire/section.mjs"), "G the section is imported after the fire's (its tools come after the fire tools)");
  ok(readFileSync(path.join(root, "styles/maps.css"), "utf8").includes(".mm-pr-tile {"), "G the soundboard's styles are in the module's stylesheet");
}

console.log(fails ? `${fails}/${n} presets UI checks FAILED` : `${n}/${n} presets UI checks passed`);
process.exit(fails ? 1 : 0);
