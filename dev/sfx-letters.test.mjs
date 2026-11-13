// LMAP: the comic sound effects of the destruction and the fire (scripts/sfx/), the pure part:
//  A. words: stretched by loudness, both word sets, Polish letters, every voice has words in every size;
//  B. what a damage area / a fire stroke sounds like (voices, magnitudes): a small crack is not a building coming down, a long burn
//     is not a blast, a fire going out hisses and falls;
//  C. events of fire strokes: catch (late when new here), spread, flare, out, burst, dust, a douse; a scene that opens replays nothing;
//  D. clusters: a big cave-in of many areas is ONE sound (a main word, an anticipation, a few satellites), a bomb's burst + shock +
//     crater is one boom; far-apart or later events stay apart;
//  E. placement: readable sizes on screen, off tokens and other words, satellites dropped before they overlap, off-screen not played;
//  F. determinism (the same everywhere) and variety (different each time);
//  G. wiring pins: display.enter calls the bus, main.mjs registers, settings exist in both languages.
import assert from "node:assert/strict";
import fs from "node:fs";
import { VOICES, WORDS, expand, wordFor, langOf, tierOf } from "../scripts/sfx/words.mjs";
import * as C from "../scripts/sfx/sfx-core.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

/* A. words */
ok(expand("BO+M!", 0) === "BOOM!" && expand("BO+M!", 3) === "BOOOOM!" && expand("BAM!", 3) === "BAM!", "expand stretches the letter before + (at least once)");
ok(expand("KA-BO+O+M", 3) === "KA-BOOOOOM" && expand("KA-BO+O+M", 5).length <= 14, "two stretch marks share the stretch");
for ( const lang of ["en", "pl"] ) for ( const v of Object.keys(VOICES) ) for ( const t of ["s", "m", "l"] ) ok(WORDS[lang][v]?.[t]?.length >= 2, `${lang}/${v}/${t} has words`);
ok(wordFor("boom", 1, 0, "en").length > wordFor("boom", 0.4, 0, "en").length || tierOf(1) !== tierOf(0.4), "a louder boom is a longer word");
ok(/[ĄĆĘŁŃÓŚŹŻ]/.test(Object.values(WORDS.pl).flatMap((b) => [...b.s, ...b.m, ...b.l]).join("")), "the Polish set uses Polish letters");
ok(langOf("auto", "pl") === "pl" && langOf("auto", "en") === "en" && langOf("en", "pl") === "en", "word set follows the setting / the game language");
ok(wordFor("crash", 0.8, 1, "en", new Set([wordFor("crash", 0.8, 1, "en")])) !== wordFor("crash", 0.8, 1, "en"), "taken words are skipped");

/* B. voices and magnitudes */
ok(C.destrVoice("blast", 0) === "boom" && C.destrVoice("collapse", 0) === "crash" && C.destrVoice("cracks", 0) === "crack", "type voices");
ok(C.destrVoice("blast", "lightning") === "zap" && C.destrVoice("cracks", "acid") === "hiss" && C.destrVoice("gash", 0) === "slash", "causes colour the voice");
ok(C.destrVoice("blast", 0, true) === "gun", "a gun's pocks rattle");
ok(C.destrVoice("flood", 0) === "splash" && C.destrVoice("scorch", 0) === "fire", "flood splashes, scorch burns");
ok(C.magnitude(0.3, "crack") < C.magnitude(4, "crash"), "a small crack is quieter than a building coming down");
ok(C.magnitude(10) === 1 && C.magnitude(0) >= 0.05, "magnitude clamped");
const G = 100;
const single = (e) => C.planCluster(C.cluster([{ key: "k", t: 0, ...e }], G)[0], { grid: G, sec: 4, seed: "s" });
const crack = single({ voice: "crack", x: 0, y: 0, r: 25 }).find((w) => w.role === "main");
const fall = single({ voice: "crash", x: 0, y: 0, r: 400 });
const fallMain = fall.find((w) => w.role === "main");
ok(fallMain.size > crack.size * 2.5 && fallMain.sound.loud > crack.sound.loud + 0.4, "the crash of a building is far bigger and louder than a crack");
ok(fallMain.mood === "crash" && crack.mood === "crack", "moods follow the voice");
ok(fall.some((w) => w.role === "pre") && fall.find((w) => w.role === "pre").t < fallMain.t, "a big cave-in cracks first, then comes down");
const burn = single({ voice: "roar", x: 0, y: 0, r: 200, m: 0.7 })[0], blast = single({ voice: "boom", x: 0, y: 0, r: 200, m: 0.7 })[0];
ok(burn.sound.long > blast.sound.long && burn.sound.sharp < blast.sound.sharp && (burn.hold ?? 0) > 1000, "a long burn is long and soft, a blast short and sharp");
const hiss = single({ voice: "hiss", x: 0, y: 0, r: 100, m: 0.4 })[0];
ok(hiss.sound.pitch < 0 && hiss.mood === "whoosh", "going out hisses and falls");
ok(C.fireColors("#3060ff")?.length === 3 && C.fireColors(null) === null, "a coloured fire letters in its colour");

/* C. fire stroke events */
const ctx = { grid: G, catchMs: () => 3000, burning: () => true, late: 1500 };
const fire = { id: "f1", k: "fire", q: 10000, r: 50, lv: 2, p: [0, 0, 300, 0, 600, 0, 900, 0, 1200, 0] };
let ev = C.strokeEvents(fire, null, 10500, 20000, ctx);
ok(ev.some((e) => e.voice === "fire" && e.key.includes("catch")), "a new fire catches");
const spreads = ev.filter((e) => e.key.includes("spread"));
ok(spreads.length >= 1 && spreads.length <= 3 && spreads.every((e, i, a) => i === 0 || e.t > a[i - 1].t), "a long fire crackles as it spreads, in order, at most 3");
ok(spreads.every((e) => e.t > 10000 && e.t <= 13000), "the spread follows the catch time along the path");
ev = C.strokeEvents(fire, null, 14000, 20000, ctx);
ok(ev.some((e) => e.key.includes("catch")), "a stroke new here plays its catch late (it reached this client on release)");
ev = C.strokeEvents(fire, null, 14000, 20000, { ...ctx, newLate: 0, late: 0 });
ok(!ev.length, "a scene that opens replays nothing that has happened");
ev = C.strokeEvents({ ...fire, o: 30000 }, fire, 20000, 40000, ctx);
ok(ev.length === 1 && ev[0].voice === "hiss" && ev[0].t === 30000, "a timed fire's out time hisses at that moment");
ok(!C.strokeEvents({ ...fire, o: 30000 }, { ...fire, o: 30000 }, 31000, 40000, ctx).length, "an out seen before is not played again");
ev = C.strokeEvents({ ...fire, lv: 3, l0: 1.5, lt: 25000 }, fire, 24000, 40000, ctx);
ok(ev.some((e) => e.key.includes("flare") && e.voice === "roar"), "a raised level flares up");
const b1 = C.strokeEvents({ id: "b", k: "burst", q: 5000, p: [10, 10], r: 80, lv: 1 }, null, 5000, 9000, ctx)[0];
const b3 = C.strokeEvents({ id: "c", k: "burst", q: 5000, p: [10, 10], r: 300, lv: 3 }, null, 5000, 9000, ctx)[0];
ok(b1.voice === "boom" && b3.m > b1.m + 0.3, "a bomb is far louder than a grenade");
ok(C.strokeEvents({ id: "d", k: "dust", dk: "shock", q: 5000, p: [0, 0], r: 300, lv: 3 }, null, 5000, 9000, ctx)[0].voice === "whump", "a shock wave whumps");
ok(C.strokeEvents({ id: "d", k: "dust", dk: "heavy", q: 5000, p: [0, 0, 500, 0], r: 60, lv: 2 }, null, 5000, 9000, ctx)[0].voice === "rumble", "a heavy thing rumbles");
ok(!C.strokeEvents({ id: "s", k: "smoke", q: 5000, p: [0, 0], r: 60 }, null, 5000, 9000, ctx).length, "smoke is silent");
ok(C.strokeEvents({ id: "e", k: "erase", q: 5000, p: [0, 0], r: 60 }, null, 5000, 9000, ctx)[0]?.voice === "hiss", "dousing burning fire hisses");
ok(!C.strokeEvents({ id: "e", k: "erase", q: 5000, p: [0, 0], r: 60 }, null, 5000, 9000, { ...ctx, burning: () => false }).length, "an eraser over nothing is silent");

/* D. clusters */
const areas = [];
for ( let i = 0; i < 30; i++ ) areas.push({ key: `a${i}`, obj: "d1", voice: i % 5 ? "crash" : "crack", x: (i % 6) * 120, y: Math.floor(i / 6) * 120, r: 70 + (i * 37) % 60, t: 1000 + (i % 3) * 30 });
let groups = C.cluster(areas, G);
ok(groups.length === 1, `a big cave-in of 30 areas is one sound (${groups.length})`);
let words = C.planCluster(groups[0], { grid: G, sec: 4, seed: "s" });
const mains = words.filter((w) => w.role === "main"), secs = words.filter((w) => w.role === "sec");
ok(mains.length === 1 && mains[0].voice === "crash" && secs.length >= 2 && secs.length <= 4, `one main word and a few satellites (${secs.length})`);
ok(new Set(words.map((w) => w.text)).size === words.length, "no word twice in one moment");
ok(secs.every((w) => w.size < mains[0].size && w.t > mains[0].t), "satellites smaller and after the main word");
ok(C.planCluster(groups[0], { grid: G, sec: 0, seed: "s" }).filter((w) => w.role === "sec").length === 0, "performance mode low: no satellites");
const big = C.planCluster(groups[0], { grid: G, sec: 4, seed: "s", big: true });
ok(big.length === 1 && big[0].role === "main", "'big only': one word");
ok(!C.planCluster(C.cluster([{ key: "x", voice: "crack", x: 0, y: 0, r: 20, t: 0 }], G)[0], { grid: G, sec: 4, big: true }).length, "'big only' letters no small crack");
const bomb = [{ key: "burst", voice: "boom", x: 500, y: 500, r: 250, t: 2000, m: 1 }, { key: "shock", voice: "whump", x: 505, y: 495, r: 600, t: 2000 },
  { key: "crater", voice: "boom", x: 498, y: 510, r: 200, t: 2050 }];
groups = C.cluster(bomb, G);
ok(groups.length === 1 && groups[0].main.voice === "boom", "a bomb's burst, shock and crater are one boom");
ok(C.cluster([{ key: "a", voice: "crack", x: 0, y: 0, r: 30, t: 0 }, { key: "b", voice: "crack", x: 3000, y: 0, r: 30, t: 0 }], G).length === 2, "far apart: two sounds");
ok(C.cluster([{ key: "a", voice: "crack", x: 0, y: 0, r: 30, t: 0 }, { key: "b", voice: "crack", x: 10, y: 0, r: 30, t: 2000 }], G).length === 2, "a moment later: two sounds");

const fb = C.cluster([{ key: "fb", voice: "boom", x: 0, y: 0, r: 200, t: 1000 }], G)[0], crater = C.cluster([{ key: "cr", voice: "boom", x: 20, y: 10, r: 150, t: 1450 }], G)[0];
ok(C.isEcho(crater, [{ x: 0, y: 0, reach: 300, t: 1000, prio: 10 }], G), "a bomb's crater entering after its fireball is an echo, not a second boom");
ok(!C.isEcho(crater, [{ x: 0, y: 0, reach: 300, t: -2000, prio: 10 }], G) && !C.isEcho(C.cluster([{ key: "z", voice: "boom", x: 3000, y: 0, r: 150, t: 1450 }], G)[0], [{ x: 0, y: 0, reach: 300, t: 1000, prio: 10 }], G), "later or elsewhere: its own sound");
ok(!C.isEcho(fb, [{ x: 0, y: 0, reach: 300, t: 900, prio: 4 }], G), "a louder sound after a quiet one is its own");
ok(C.strokeEvents({ ...fire, id: "fast" }, null, 10000, 20000, { ...ctx, catchMs: () => 400 }).filter((e) => e.key.includes("spread")).length === 0, "a fire that races along its path in a moment: its catch alone");

/* E. placement */
const view = { x0: -200, y0: -200, x1: 1800, y1: 1300 };
groups = C.cluster(areas, G);
words = C.planCluster(groups[0], { grid: G, sec: 4, seed: "s" });
let placed = C.place(words, { scale: 0.5, view, tokens: [], alive: [] });
const ov = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const ar = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
ok(placed.some((w) => w.role === "main"), "the main word plays");
for ( let i = 0; i < placed.length; i++ ) for ( let j = i + 1; j < placed.length; j++ ) ok(ov(placed[i].box, placed[j].box) <= 0.12 * Math.min(ar(placed[i].box), ar(placed[j].box)) + 1e-6, "words do not cover each other");
const tiny = C.place([crack], { scale: 0.1, view: { x0: -5000, y0: -5000, x1: 5000, y1: 5000 }, tokens: [] })[0];
ok(tiny.size * C.loudScale(tiny.sound.loud) * 0.1 >= C.SCREEN.minMain - 1e-6, "zoomed far out a word stays readable");
const huge = C.place([fallMain], { scale: 4, view: { x0: 0, y0: 0, x1: 400, y1: 250 }, tokens: [] })[0];
ok(huge.size * C.loudScale(huge.sound.loud) * 4 <= C.SCREEN.maxMain * 250 * 4 + 1e-6, "zoomed far in a word never fills the screen");
const tok = { x0: -60, y0: -60, x1: 60, y1: 60 };
const w0 = single({ voice: "boom", x: 0, y: 0, r: 60, m: 0.3 })[0];
const p0 = C.place([w0], { scale: 1, view: { x0: -1000, y0: -1000, x1: 1000, y1: 1000 }, tokens: [tok] })[0];
ok(ov(p0.box, tok) === 0, "a word moves off a token");
ok(p0.y < 0, "...preferring up");
const edge = C.place([{ ...w0, x: -990, y: 0 }], { scale: 1, view: { x0: -1000, y0: -1000, x1: 1000, y1: 1000 }, tokens: [] })[0];
ok(edge.box.x0 >= -1000, "a word at the screen's edge moves inside");
ok(!C.place([w0], { scale: 1, view: { x0: 5000, y0: 5000, x1: 6000, y1: 6000 }, tokens: [] }).length, "off this screen: not played here");

/* F. determinism and variety */
const a1 = JSON.stringify(C.planCluster(C.cluster(areas, G)[0], { grid: G, sec: 4, seed: "scene" }));
const a2 = JSON.stringify(C.planCluster(C.cluster(areas.slice().reverse(), G)[0], { grid: G, sec: 4, seed: "scene" }));
ok(a1 === a2, "the same events give the same words on every client (whatever order they arrived in)");
const texts = new Set();
for ( let i = 0; i < 24; i++ ) texts.add(single({ voice: "crash", x: 0, y: 0, r: 200, key: `k${i}` }).find((w) => w.role === "main").text);
ok(texts.size >= 3, `different each time (${texts.size} different crash words in 24)`);
const am = C.ambientEvent(10, [fire, { ...fire, id: "f2" }], { every: 6000 });
ok(am && JSON.stringify(am) === JSON.stringify(C.ambientEvent(10, [{ ...fire, id: "f2" }, fire], { every: 6000 })), "the ambient crackle is the same everywhere");
ok(!C.ambientEvent(10, [{ ...fire, q: 59000 }], { every: 6000 }), "a fire that just caught does not crackle yet");
ok(C.ambientEvent(10, [fire], { every: 6000 }).ambient && C.ambientEvent(10, [fire]).m < 0.5, "the ambient crackle is quiet");

/* F2. motion fits the sound (the engine's entrance / hold / exit named per voice) */
ok(Object.values(VOICES).every((v) => v.motion?.in && v.motion?.hold && v.motion?.out), "every voice names its motion");
ok(fallMain.motion.in === "drop" && fallMain.motion.out === "fall" && fall.find((w) => w.role === "pre").motion.in === "crackIn", "a cave-in drops and falls after its crack cracks in");
ok(blast.motion.in === "slam" && burn.motion.hold === "flicker" && hiss.motion.out === "dissolve", "a blast slams, fire flickers, a hiss dissolves");
ok(single({ voice: "crash", x: 0, y: 0, r: 20 })[0].motion.in === "slam", "a small crash is a thud: it slams in");

/* G. wiring */
const disp = fs.readFileSync(new URL("../scripts/destruction/display.mjs", import.meta.url), "utf8");
ok(/enter\(g, \{[^\n]*\} = \{\}\) \{\n(?:.*\n){2}.*\n\s*sfxBus\.entry\?\.\(this, g, arguments\[1\] \?\? \{\}, start\);/.test(disp), "display.enter calls the sfx bus first (every entry path)");
const main = fs.readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
ok(main.includes("registerSfx();"), "main.mjs registers the sound effects");
for ( const l of ["en", "pl"] ) {
  const j = JSON.parse(fs.readFileSync(new URL(`../lang/${l}.json`, import.meta.url), "utf8"));
  for ( const k of ["set", "setHint", "all", "big", "off", "world", "worldHint", "words", "wordsHint", "wordsAuto", "wordsEn", "wordsPl", "layer", "layerHint", "layerTop", "layerWeather", "layerTokens", "layerFire"] ) ok(typeof j[`MOINENMAPS.Sfx.${k}`] === "string", `${l} MOINENMAPS.Sfx.${k}`);
}
const sfx = fs.readFileSync(new URL("../scripts/sfx/sfx.mjs", import.meta.url), "utf8");
ok(/sfxLayer[\s\S]*choices: \{ top:[^}]*weather:[^}]*tokens:[^}]*fire:/.test(sfx) && sfx.includes("parent: layerC"), "the display layer is a setting (top / under weather / under tokens / under fire)");
ok(sfx.includes("in: w.motion.in, holdKind: w.motion.hold, out: w.motion.out"), "the motion goes to the engine");
ok(sfx.includes('space: "world"') && sfx.includes("reduced: red"), "words are world-space and follow the module's reduced-motion rule");
ok(!/from "[^"]*letters\/(?!index\.mjs)/.test(sfx) && sfx.includes('from "../letters/index.mjs"'), "the engine is used through its index only");

console.log(`sfx-letters: ${n} checks ok`);
