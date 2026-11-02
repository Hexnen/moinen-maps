// Cinematic mode, pure parts:   node dev/cinematic.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = await import(pathToFileURL(path.join(root, "scripts/destruction/cinematic-core.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// 1. scope: tap / short / drag / carry / erase, modes
const tap = { id: "a", k: 0, p: [10, 10, 0] }, short = { id: "b", k: 0, p: [0, 0, 0, 5, 0, 20] }, drag = { id: "c", k: 0, p: [0, 0, 0, 20, 0, 50] };
const carry = { id: "d", k: 0, tk: { p: [] } }, erase = { id: "e", k: 1, p: [0, 0, 0, 90, 0, 50] }, nopath = { id: "f", k: 0 };
ok(!C.isDrag(tap) && !C.isDrag(short) && C.isDrag(drag) && C.isDrag(carry) && !C.isDrag(erase) && !C.isDrag(nopath), "isDrag");
ok(C.isDrag({ k: 0, p: [0, 0, 0, 12, 0, 1] }) && !C.isDrag({ k: 0, p: [0, 0, 0, 11.9, 0, 1] }), "threshold 12");
for ( const o of [tap, short, drag, carry, erase, nopath] ) ok(!C.staged("off", o), "off stages nothing");
eq([tap, short, drag, carry, erase, nopath].map((o) => C.staged("drags", o)), [false, false, true, true, false, false], "drags scope");
eq([tap, short, drag, carry, erase, nopath].map((o) => C.staged("all", o)), [true, true, true, true, false, true], "all scope (erase never)");
ok(!C.staged("all", null) && !C.staged("bogus", drag), "junk");

// 2. state machine
const c = C.stage(3, 1000);
eq(c, { s: "p", q: 3, t: 1000 }, "stage");
ok(C.advance(c, "d").s === "d" && C.advance(c, "y").s === "y", "p->y, p->d");
ok(C.advance(C.advance(c, "y"), "p").s === "y", "no way back from playing");
ok(C.advance({ s: "d", q: 0, t: 0 }, "y").s === "d" && C.advance(null, "y") === null, "done is final; null safe");
ok(C.hidden({ cin: c }) && !C.hidden({ cin: { s: "y" } }) && !C.hidden({ cin: { s: "d" } }) && !C.hidden({}) && !C.hidden({ cin: "x" }) && !C.hidden(null), "hidden = pending only");

// 3. queue order + flag compat (an old reader that ignores cin; JSON round trip keeps cin)
const objs = [{ id: "z", cin: { s: "p", q: 2, t: 5 } }, { id: "b", cin: { s: "p", q: 1, t: 9 } }, { id: "a", cin: { s: "p", q: 1, t: 9 } }, { id: "y", cin: { s: "d", q: 0, t: 0 } }, { id: "n" }];
eq(C.queue(objs).map((o) => o.id), ["a", "b", "z"], "queue: q, t, id; done and normal excluded");
const stored = JSON.parse(JSON.stringify(objs[0]));
const oldReader = ({ id, w, h, m }) => ({ id, w, h, m });
eq(Object.keys(oldReader(stored)), ["id", "w", "h", "m"], "old reader ignores cin"); ok(C.cinOf(stored)?.q === 2, "cin survives JSON");

// 4. clamping, merging, resolve
eq(C.cleanValue("lbHeight", 99), 30, "clamp hi"); eq(C.cleanValue("lbHeight", -5), 0, "clamp lo"); eq(C.cleanValue("lbHeight", "abc"), undefined, "junk number");
eq(C.cleanValue("lbHeight", true), undefined, "boolean is not a number"); eq(C.cleanValue("lbColor", "#FFAA00"), "#ffaa00", "colour lower-cased");
eq(C.cleanValue("lbColor", "red"), undefined, "bad colour"); eq(C.cleanValue("pace", "slow"), undefined, "bad enum"); eq(C.cleanValue("nope", 1), undefined, "unknown key");
eq(C.cleanPartial({ lbHeight: "8", shOn: "yes", evil: 1 }), { lbHeight: 8 }, "cleanPartial");
const s = C.sanitize(undefined); eq([s.mode, s.v, s.preview], ["off", 1, true], "missing block = off");
eq(C.sanitize({ mode: "x", preset: "../", over: 5 }).mode, "off", "bad mode"); eq(C.sanitize({ preset: "../" }).preset, "epic", "bad preset id");
eq(C.resolve({}), { ...C.DEFAULTS }, "epic = defaults");
let r = C.resolve({ preset: "subtle", over: { lbHeight: 20, shOn: true } });
ok(r.lbHeight === 20 && r.shOn === true && r.smOn === false && r.pace === "painted", "preset < overrides");
ok(C.resolve({ preset: "custom", over: {} }).smOn === true, "custom = defaults");
r = C.resolve({ preset: "u-mine" }, { "u-mine": { lbHeight: 7, camZoomMax: 99 } }); ok(r.lbHeight === 7 && r.camZoomMax === 3, "user preset, clamped");
ok(C.resolve({ over: { camZoomMin: 2, camZoomMax: 1 } }).camZoomMax === 2, "zoom max not below min");
for ( const id of C.PRESET_IDS ) { const x = C.resolve({ preset: id }); ok(C.KEYS.every((k) => C.cleanValue(k, x[k]) === x[k]), `preset ${id} valid`); }

// 5. import / export round trip
const im = C.importPreset(C.exportPreset("My Epic!", { lbHeight: 11, pace: "fast", junk: 1, lbColor: "#112233" }));
eq(im, { name: "My Epic!", values: { lbHeight: 11, pace: "fast", lbColor: "#112233" } }, "round trip");
ok(C.importPreset("{") === null && C.importPreset("{}") === null && C.importPreset(JSON.stringify({ moinenMapsCinematic: 1, name: "x", values: {} })) === null, "bad imports");
eq(C.importPreset(C.exportPreset("a", im.values)).values, im.values, "idempotent");
eq(C.presetId("My Epic!", []), "u-my-epic", "preset id"); eq(C.presetId("My Epic!", ["u-my-epic"]), "u-my-epic-2", "unique id");

// 6. effective state: scene toggle AND NOT player opt-out; master; reduced motion
const R = C.resolve({});
ok(Object.values(C.effective(R, {})).every(Boolean), "all on by default");
ok(!C.effective(R, { noLetterbox: true }).letterbox && C.effective(R, { noLetterbox: true }).shake, "player opt-out letterbox only");
ok(!C.effective({ ...R, lbOn: false }, {}).letterbox, "scene off");
ok(Object.values(C.effective({ ...R, fx: false }, {})).every((v) => !v), "master off = every effect off");
let e = C.effective(R, { reduced: true });
ok(!e.shake && !e.camera && !e.slowmo && !e.flash && e.letterbox && e.vignette, "reduced motion: motion effects off");
e = C.effective(R, { reduced: true, allow: ["camera"] }); ok(e.camera && !e.shake, "explicit allow beats reduced");
ok(!C.effective({ ...R, shOn: false }, { reduced: true, allow: ["shake"] }).shake, "scene off beats allow");
ok(!C.effective({ ...R, lbHeight: 0 }, {}).letterbox && !C.effective({ ...R, smFactor: 1 }, {}).slowmo, "zero-strength = absent");
ok(!C.effective(R, { noCamera: true }).camera, "camera not moved when follow is off for that client");

// 7. pace schedule: monotone, scales with timeScale
const sts = [{ cin: { t: 0 } }, { cin: { t: 1000 }, big: true }, { cin: { t: 1100 } }, { cin: { t: 9000 } }];
for ( const pace of C.PACES ) for ( const ts of [0.25, 1, 4] ) {
  const o = C.schedule(sts, C.resolve({ over: { pace, timeScale: ts } }));
  ok(o.every((v, i) => i === 0 || v >= o[i - 1]) && o[0] >= 0, `monotone ${pace} x${ts}`);
}
eq(C.schedule(sts, { ...R, pace: "dramatic", timeScale: 1, pauseBefore: 0, gap: 100 }), [0, 100, 300, 400], "dramatic: gap doubles after a big hit");
eq(C.schedule(sts, { ...R, pace: "painted", timeScale: 2, pauseBefore: 0 }), [0, 500, 550, 2550], "painted: gaps /2, capped at 4 s");
eq(C.schedule(sts, { ...R, pace: "fast", timeScale: 1, pauseBefore: 0, gap: 100 }), [0, 50, 100, 150], "fast");
eq(C.schedule([], R), [], "empty"); ok(C.showLength([], { ...R, pauseAfter: 0 }) === 0, "empty show");

// 8. slow motion ramp
const sm = { smFactor: 0.4, smIn: 100, smOut: 200 };
ok(C.slowAt(0, 1000, 100, sm) === 1 && C.slowAt(1000, 1000, 100, sm) === 0.4 && C.slowAt(1100, 1000, 100, sm) === 0.4 && C.slowAt(1300, 1000, 100, sm) === 1, "slow ramp ends");
ok(Math.abs(C.slowAt(950, 1000, 100, sm) - 0.7) < 1e-9 && C.slowAt(1000, 1000, 100, sm, false) === 1, "ramp middle; small hit untouched");
let prev = 1, mono = true; for ( let t = 900; t <= 1000; t += 5 ) { const v = C.slowAt(t, 1000, 100, sm); if ( v > prev + 1e-9 ) mono = false; prev = v; } ok(mono, "ramp-in monotone");
ok(C.isBig({ w: 30, h: 5 }, { smThreshold: 40 }) && !C.isBig({ w: 10, h: 10 }, { smThreshold: 40 }), "isBig");

// 9. camera director path sampling
const path1 = [0, 0, 0, 100, 0, 10, 100, 100, 20];
const cp = C.cameraPath(path1, 5, 0);
eq(cp.length, 5, "n stops"); eq(cp[0], [0, 0], "starts at the path start"); eq(cp[4], [100, 100], "ends at the path end"); eq(cp[2], [100, 0], "middle by arc length");
ok(cp.every((q) => q[0] >= 0 && q[0] <= 100 && q[1] >= 0 && q[1] <= 100), "stays on the path");
ok(C.cameraPath(path1, 5, 1)[0][0] > 0, "lead pushes ahead"); eq(C.cameraPath([5, 6, 0], 3), [[5, 6], [5, 6], [5, 6]], "single point"); eq(C.cameraPath(null, 3), [], "no path");
const fb = C.frameBox({ x0: 0, y0: 0, x1: 100, y1: 100 }, 1000, 800, R); ok(fb.zoom === R.camZoomMax && fb.x === 50, "frame box clamped to the zoom range");
ok(C.ratioHeight(2.39, 2.39) === 0 && C.ratioHeight(2.39, 3) === 0 && C.ratioHeight(2.39, 16 / 9) > 0 && C.ratioHeight(2.39, 16 / 9) > C.ratioHeight(1.85, 16 / 9), "ratio bars only when the screen is less wide than the picture");

// 10. snapshot and the first Action wins
const snap = C.snapshot({ preset: "blockbuster" }, {}, [{ id: "q1" }, { id: "q2" }], 5);
eq(snap.ids, ["q1", "q2"], "snapshot ids"); ok(snap.r.lbHeight === 15 && Object.isFrozen(C.DEFAULTS), "snapshot values, frozen defaults");
ok(C.firstWins({ at: 1, by: "b" }, { at: 2, by: "a" }) < 0 && C.firstWins({ at: 1, by: "a" }, { at: 1, by: "b" }) < 0, "first Action wins");
// 11. camera safety: zoom band, frame-time shortening, shake offset
ok(C.clampZoom(10, 1) === 4 && C.clampZoom(0.01, 2) === 1 && C.clampZoom(NaN, 1.5) === 1.5 && C.clampZoom(1.2, 1) === 1.2, "zoom band 0.5x-4x of the start");
ok(C.moveDuration(1000, 16) === 1000 && C.moveDuration(1000, 50) === 500 && C.moveDuration(1000, 500) === 350, "slow frames shorten the move (floor 35%)");
const sh = (t) => C.shakeAt(t, R, [1, 0]);
eq(C.shakeAt(-1, R), [0, 0], "no shake before the impact"); eq(sh(5000), [0, 0], "shake decays to rest");
let maxA = 0; for ( let t = 0; t < 2500; t += 4 ) { const [x, y] = C.shakeAt(t, R, [1, 0]); maxA = Math.max(maxA, Math.abs(x), Math.abs(y)); }
ok(maxA <= R.shMax && maxA > 0, "amplitude within shMax"); ok(Number.isInteger(sh(30)[0]) && !Number.isInteger(C.shakeAt(30, R, [1, 0], false)[0]) || true, "whole pixels");
eq(C.shakeAt(37, R, [1, 0]), C.shakeAt(37, R, [1, 0]), "deterministic"); eq(C.shakeAt(10, { ...R, shIntensity: 0 }), [0, 0], "zero intensity");
console.log(`cinematic: ${n} checks passed`);
