// LMAP (reworked by FXLM): the comic sound effects of the destruction and the fire (scripts/sfx/), the pure part:
//  A. words: the engine's vocabulary writes them (no word table of the map's own); every voice resolves to a kind the engine knows,
//     both languages, Polish letters;
//  B. what a damage area / a fire stroke sounds like (voices, loudness): a small crack is not a building coming down, a fire going out
//     is a quiet long hiss;
//  C. events of fire strokes: catch (late when new here, waiting for its flames), flare, out, burst (+ shock and debris), dust, douse;
//     a scene that opens replays nothing;
//  D. clusters: a big cave-in of many areas is ONE sound (a main word, an anticipation, a few satellites), a bomb's burst + shock +
//     crater is one boom; far-apart or later events stay apart;
//  E. placement: off tokens and other words, satellites dropped before they overlap, inside the view, off-screen not played;
//  F. determinism (the same everywhere) and variety;
//  G. wiring pins: display.enter calls the bus, fire.mjs tells the bus what shows, main.mjs registers, settings in both languages.
import assert from "node:assert/strict";
import fs from "node:fs";
import * as C from "../scripts/sfx/sfx-core.mjs";
import { createVocab } from "../scripts/letters/words.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const V = createVocab();
const KINDS = new Set(V.list("en").map((k) => k.id));

/* A. words: the engine's */
ok(!fs.existsSync(new URL("../scripts/sfx/words.mjs", import.meta.url)), "the map keeps no word table of its own (the engine's vocabulary writes the words)");
for ( const [v, d] of Object.entries(C.VOICES) ) {
  ok(d.kinds.some((k) => KINDS.has(k)), `voice ${v} resolves to a sound kind the engine knows (${d.kinds})`);
  for ( const lang of ["en", "pl"] ) ok(V.word(C.kindOf(v, KINDS), { lang, loud: 0.6, seed: "x" }).text.length > 0, `${lang} word for ${v}`);
}
ok(C.kindOf("out", new Set(["hiss"])) === "hiss" && C.kindOf("out", null) === "fizzle", "a kind the engine does not know falls back to the next one listed");
ok(/[ĄĆĘŁŃÓŚŹŻ]/.test(Object.keys(C.VOICES).flatMap((v) => Array.from({ length: 12 }, (_, i) => V.word(C.kindOf(v, KINDS), { lang: "pl", loud: (i % 4) / 3, seed: `p${i}` }).text)).join("")), "the Polish words use Polish letters");
ok(C.langOf("auto", "pl") === "pl" && C.langOf("auto", "en") === "en" && C.langOf("en", "pl") === "en", "word set follows the setting / the game language");

/* B. voices and loudness */
ok(C.destrVoice("blast", 0) === "boom" && C.destrVoice("collapse", 0) === "crash" && C.destrVoice("cracks", 0) === "crack", "type voices");
ok(C.destrVoice("blast", "lightning") === "thunder" && C.destrVoice("cracks", "lightning") === "zap" && C.destrVoice("cracks", "acid") === "acid" && C.destrVoice("gash", 0) === "slash", "causes colour the voice");
ok(C.destrVoice("blast", 0, true) === "gun", "a gun's pocks rattle");
ok(C.destrVoice("flood", 0) === "splash" && C.destrVoice("scorch", 0) === "scorch", "flood splashes, scorch burns");
ok(C.magnitude(0.3) < C.magnitude(4), "a small thing is quieter than a big one");
ok(C.magnitude(10) === 1 && C.magnitude(0) >= 0.05, "magnitude clamped");
const G = 100;
const single = (e) => C.planCluster(C.cluster([{ key: "k", t: 0, ...e }], G)[0], { grid: G, sec: 4, seed: "s", known: KINDS });
const crack = single({ voice: "crack", x: 0, y: 0, r: 25 }).find((w) => w.role === "main");
const fall = single({ voice: "crash", x: 0, y: 0, r: 400 });
const fallMain = fall.find((w) => w.role === "main");
ok(fallMain.magnitude > crack.magnitude * 2.5 && fallMain.loud > crack.loud + 0.4, "the crash of a building is far bigger and louder than a crack");
{
  // GM and player: the same areas enter at different local times (keys differ), the same `sid` -> the same words
  const mk = (t, j) => [0, 1, 2, 3].map((i) => ({ key: `d|h${i}|${t + i * j}`, sid: `d|h${i}`, t: t + i * j, voice: "crash", x: i * 120, y: 0, r: 140 }));
  const words = (evs) => C.cluster(evs, G).flatMap((g) => C.planCluster(g, { grid: G, sec: 4, seed: "scene" })).map((w) => `${w.role}:${w.kind}:${w.seed}:${w.loud}`).sort().join(",");
  ok([0, 1, 2, 3, 4, 5].every((i) => words(mk(1000, 30)) === words(mk(5000 + i * 777, 45))), "words of a synced destruction do not depend on this client's entry time");
}
ok(fall.some((w) => w.role === "pre") && fall.find((w) => w.role === "pre").t < fallMain.t, "a big cave-in cracks first, then comes down");
const boomW = single({ voice: "boom", x: 0, y: 0, r: 200, m: 0.7 })[0], fireW = single({ voice: "fire", x: 0, y: 0, r: 200, m: 0.7, ms: 1600 })[0];
ok(fireW.ms > boomW.ms && fireW.kind === "fire" && boomW.kind === "boom", "a fire catching lasts longer than a blast");
const out = single({ voice: "out", x: 0, y: 0, r: 300, m: 0.35, ms: 3500 })[0];
ok(out.ms >= 3000 && out.magnitude < 0.4 && /fizzle|hiss/.test(out.kind), "going out is a quiet, long hiss");
ok(C.fireColors("#3060ff")?.length === 3 && C.ownFireColors("#3060ff")?.length === 3 && C.ownFireColors("#ff8a24") === null && C.fireColors(null) === null, "a fire in its own colour letters in it; a natural fire takes the engine's look");

/* C. fire stroke events */
const ctx = { grid: G, burning: () => true, late: 1500, outMs: 3500, passMs: () => 2000 };
const fire = { id: "f1", k: "fire", q: 10000, r: 50, lv: 2, p: [0, 0, 300, 0, 600, 0, 900, 0, 1200, 0] };
let ev = C.strokeEvents(fire, null, 10500, 20000, ctx);
ok(ev.some((e) => e.voice === "fire" && e.key.includes("catch") && e.gate === "f1"), "a new fire catches (its word waits for its flames)");
ev = C.strokeEvents(fire, null, 14000, 20000, ctx);
ok(ev.some((e) => e.key.includes("catch")), "a stroke new here plays its catch late (it reached this client on release)");
ev = C.strokeEvents(fire, null, 14000, 20000, { ...ctx, newLate: 0, late: 0 });
ok(!ev.length, "a scene that opens replays nothing that has happened");
ev = C.strokeEvents({ ...fire, o: 30000 }, fire, 20000, 40000, ctx);
ok(ev.length === 1 && ev[0].voice === "out" && ev[0].t === 30000 && ev[0].ms === 3500, "a timed fire's out time hisses at that moment, as long as its flames die");
ok(!C.strokeEvents({ ...fire, o: 30000 }, { ...fire, o: 30000 }, 31000, 40000, ctx).length, "an out seen before is not played again");
ev = C.strokeEvents({ ...fire, lv: 3, l0: 1.5, lt: 25000 }, fire, 24000, 40000, ctx);
ok(ev.some((e) => e.key.includes("flare") && e.voice === "flare"), "a raised level flares up");
const b1 = C.strokeEvents({ id: "b", k: "burst", q: 5000, p: [10, 10], r: 80, lv: 1 }, null, 5000, 9000, ctx);
const b3 = C.strokeEvents({ id: "c", k: "burst", q: 5000, p: [10, 10], r: 300, lv: 3 }, null, 5000, 9000, ctx);
ok(b1[0].voice === "boom" && b3[0].m > b1[0].m + 0.3, "a bomb is far louder than a grenade");
ok(b1.length === 1 && b3.some((e) => e.voice === "whump") && b3.filter((e) => e.voice === "debris").length === 2, "a bomb has its shock and its debris, a grenade is one bang");
ok(C.strokeEvents({ id: "d", k: "dust", dk: "shock", q: 5000, p: [0, 0], r: 300, lv: 3 }, null, 5000, 9000, ctx)[0].voice === "whump", "a shock wave whumps");
const heavy = C.strokeEvents({ id: "d", k: "dust", dk: "heavy", q: 5000, p: [0, 0, 500, 0], r: 60, lv: 2 }, null, 5000, 9000, ctx)[0];
ok(heavy.voice === "rumble" && heavy.path?.length > 2 && heavy.ms === 2000, "a heavy thing rumbles along its path for as long as it moves");
const car = C.strokeEvents({ id: "d", k: "dust", dk: "car", q: 5000, p: [0, 0, 500, 0, 900, 200], r: 60, lv: 2 }, null, 5000, 9000, ctx)[0];
ok(car.voice === "engine" && car.path.at(-1).ms === 2000 && car.path[0].x === 0, "a car's engine rides its path");
ok(C.strokeEvents({ id: "d", k: "dust", dk: "drag", q: 5000, p: [0, 0, 500, 0], r: 60, lv: 2 }, null, 5000, 9000, ctx)[0].voice === "scrape", "a drag scrapes");
ok(!C.strokeEvents({ id: "s", k: "smoke", q: 5000, p: [0, 0], r: 60 }, null, 5000, 9000, ctx).length, "smoke is silent");
ok(C.strokeEvents({ id: "e", k: "erase", q: 5000, p: [0, 0], r: 60 }, null, 5000, 9000, ctx)[0]?.voice === "douse", "dousing burning fire hisses");
ok(!C.strokeEvents({ id: "e", k: "erase", q: 5000, p: [0, 0], r: 60 }, null, 5000, 9000, { ...ctx, burning: () => false }).length, "an eraser over nothing is silent");

/* D. clusters */
const areas = [];
for ( let i = 0; i < 30; i++ ) areas.push({ key: `a${i}`, obj: "d1", voice: i % 5 ? "crash" : "crack", x: (i % 6) * 120, y: Math.floor(i / 6) * 120, r: 70 + (i * 37) % 60, t: 1000 + (i % 3) * 30 });
let groups = C.cluster(areas, G);
ok(groups.length === 1, `a big cave-in of 30 areas is one sound (${groups.length})`);
let words = C.planCluster(groups[0], { grid: G, sec: 4, seed: "s" });
const mains = words.filter((w) => w.role === "main"), secs = words.filter((w) => w.role === "sec");
ok(mains.length === 1 && mains[0].voice === "crash" && secs.length >= 2 && secs.length <= 4, `one main word and a few satellites (${secs.length})`);
ok(new Set(words.map((w) => w.seed + w.role)).size === words.length, "every word of one moment has its own seed");
ok(secs.every((w) => w.magnitude < mains[0].magnitude && w.t > mains[0].t), "satellites smaller and after the main word");
ok(secs.every((w) => /debris|crack/.test(w.voice)), "a cave-in's satellites are its debris (and its cracks)");
ok(C.planCluster(groups[0], { grid: G, sec: 0, seed: "s" }).filter((w) => w.role === "sec").length === 0, "performance mode low: no satellites");
const big = C.planCluster(groups[0], { grid: G, sec: 4, seed: "s", big: true });
ok(big.length === 1 && big[0].role === "main", "'big only': one word");
ok(!C.planCluster(C.cluster([{ key: "x", voice: "crack", x: 0, y: 0, r: 20, t: 0 }], G)[0], { grid: G, sec: 4, big: true }).length, "'big only' letters no small crack");
groups = C.cluster(b3.map((e) => ({ ...e, t: e.t })), G);
ok(groups.length === 1 && groups[0].main.voice === "boom", "a bomb's burst, shock and debris are one boom");
ok(C.cluster([{ key: "a", voice: "crack", x: 0, y: 0, r: 30, t: 0 }, { key: "b", voice: "crack", x: 3000, y: 0, r: 30, t: 0 }], G).length === 2, "far apart: two sounds");
ok(C.cluster([{ key: "a", voice: "crack", x: 0, y: 0, r: 30, t: 0 }, { key: "b", voice: "crack", x: 10, y: 0, r: 30, t: 2000 }], G).length === 2, "a moment later: two sounds");
const fb = C.cluster([{ key: "fb", voice: "boom", x: 0, y: 0, r: 200, t: 1000 }], G)[0], crater = C.cluster([{ key: "cr", voice: "boom", x: 20, y: 10, r: 150, t: 1450 }], G)[0];
ok(C.isEcho(crater, [{ x: 0, y: 0, reach: 300, t: 1000, prio: 10 }], G), "a bomb's crater entering after its fireball is an echo, not a second boom");
ok(!C.isEcho(crater, [{ x: 0, y: 0, reach: 300, t: -2000, prio: 10 }], G) && !C.isEcho(C.cluster([{ key: "z", voice: "boom", x: 3000, y: 0, r: 150, t: 1450 }], G)[0], [{ x: 0, y: 0, reach: 300, t: 1000, prio: 10 }], G), "later or elsewhere: its own sound");
ok(!C.isEcho(fb, [{ x: 0, y: 0, reach: 300, t: 900, prio: 4 }], G), "a louder sound after a quiet one is its own");

/* E. placement */
const sized = (w, bw = 300, bh = 90) => ({ ...w, bw, bh });
const view = { x0: -200, y0: -200, x1: 1800, y1: 1300 };
groups = C.cluster(areas, G);
words = C.planCluster(groups[0], { grid: G, sec: 4, seed: "s" }).map((w) => sized(w, w.role === "main" ? 360 : 160, w.role === "main" ? 110 : 50));
let placed = C.place(words, { view, tokens: [], alive: [] });
const ov = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const ar = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
ok(placed.some((w) => w.role === "main"), "the main word plays");
for ( let i = 0; i < placed.length; i++ ) for ( let j = i + 1; j < placed.length; j++ ) ok(ov(placed[i].box, placed[j].box) <= 0.06 * Math.min(ar(placed[i].box), ar(placed[j].box)) + 1e-6, "words do not cover each other");
const tok = { x0: -60, y0: -60, x1: 60, y1: 60 };
const p0 = C.place([sized(single({ voice: "boom", x: 0, y: 0, r: 60, m: 0.3 })[0], 200, 70)], { view: { x0: -1000, y0: -1000, x1: 1000, y1: 1000 }, tokens: [tok] })[0];
ok(ov(p0.box, tok) === 0, "a word moves off a token");
ok(p0.y < 0, "...preferring up");
const edge = C.place([sized({ ...single({ voice: "boom", x: -990, y: 0, r: 60, m: 0.3 })[0] }, 200, 70)], { view: { x0: -1000, y0: -1000, x1: 1000, y1: 1000 }, tokens: [] })[0];
ok(edge.box.x0 >= -1000, "a word at the screen's edge moves inside");
ok(!C.place([sized(single({ voice: "boom", x: 0, y: 0, r: 60 })[0], 200, 70)], { view: { x0: 5000, y0: 5000, x1: 6000, y1: 6000 }, tokens: [] }).length, "off this screen: not played here");

/* F. determinism and variety */
const a1 = JSON.stringify(C.planCluster(C.cluster(areas, G)[0], { grid: G, sec: 4, seed: "scene" }));
const a2 = JSON.stringify(C.planCluster(C.cluster(areas.slice().reverse(), G)[0], { grid: G, sec: 4, seed: "scene" }));
ok(a1 === a2, "the same events give the same words on every client (whatever order they arrived in)");
const texts = new Set();
for ( let i = 0; i < 24; i++ ) { const w = single({ voice: "crash", x: 0, y: 0, r: 200, key: `k${i}` }).find((q) => q.role === "main"); texts.add(V.word(w.kind, { seed: w.seed, lang: "en", loud: w.loud, duration: w.ms }).text); }
ok(texts.size >= 3, `different each time (${texts.size} different crash words in 24)`);
const groupsB = C.burnGroups([fire, { ...fire, id: "f2", p: [100, 40, 400, 40] }, { ...fire, id: "f9", p: [9000, 9000, 9300, 9000] }], G);
ok(groupsB.length === 2 && groupsB.some((g) => g.length === 2), "fires burning together are one sound, a fire far away its own");
const bp = C.burnPlan(groupsB.find((g) => g.length === 2), { grid: G, catchMs: () => 3000 });
ok(JSON.stringify(bp.points) === JSON.stringify(C.burnPlan(groupsB.find((g) => g.length === 2).slice().reverse(), { grid: G, catchMs: () => 3000 }).points), "a fire's sound is the same everywhere");

/* F2. staging fits the sound (asked of the engine on top of each kind's own motion) */
ok(fallMain.stage.in === "drop" && fallMain.stage.out === "shards" && fall.find((w) => w.role === "pre").stage.in === "pop", "a cave-in drops and breaks after its crack pops in");
// (FXLM review notes: "crackIn" assembles the pieces - a break played backwards - and "burst" ends a boom in a second explosion)
ok(Object.values(C.VOICES).every((v) => v.stage?.in !== "crackIn" && v.stage?.out !== "burst"), "no word assembles its pieces in or ends in a second blast");
ok(boomW.stage.in === "slam" && boomW.stage.push === true && out.drift && out.stage.out === "dissolve", "a blast slams and shoves, a hiss drifts up and dissolves");
ok(single({ voice: "crash", x: 0, y: 0, r: 20 })[0].stage.in === "slam", "a small crash is a thud: it slams in");
ok(fall.filter((w) => w.role !== "main").every((w) => !w.stage.push), "only a main word shoves the words around it");

/* G. wiring */
const disp = fs.readFileSync(new URL("../scripts/destruction/display.mjs", import.meta.url), "utf8");
ok(/enter\(g, \{[^\n]*\} = \{\}\) \{\n(?:.*\n){2}.*\n\s*sfxBus\.entry\?\.\(this, g, arguments\[1\] \?\? \{\}, start\);/.test(disp), "display.enter calls the sfx bus first (every entry path)");
const fireSrc = fs.readFileSync(new URL("../scripts/fire/fire.mjs", import.meta.url), "utf8");
ok(/display\.sync\(items, g, params\);\n(?:.*\n){2}\s*if \( sfxBus\.fireShown \)/.test(fireSrc), "the fire layer tells the bus which strokes' flames show, right after it shows them");
const main = fs.readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
ok(main.includes("registerSfx();"), "main.mjs registers the sound effects");
for ( const l of ["en", "pl"] ) {
  const j = JSON.parse(fs.readFileSync(new URL(`../lang/${l}.json`, import.meta.url), "utf8"));
  for ( const k of ["set", "setHint", "all", "big", "off", "world", "worldHint", "words", "wordsHint", "wordsAuto", "wordsEn", "wordsPl", "layer", "layerHint", "layers.ground", "layers.tokens", "layers.weather", "layers.overlay", "layers.top"] ) ok(typeof j[`MOINENMAPS.Sfx.${k}`] === "string", `${l} MOINENMAPS.Sfx.${k}`);
}
const sfx = fs.readFileSync(new URL("../scripts/sfx/sfx.mjs", import.meta.url), "utf8");
ok(/LAYER_IDS = \["ground", "tokens", "weather", "overlay", "top"\]/.test(sfx) && sfx.includes('register(MODULE_ID, "sfxLayer"') && /\.\.\.layerOpts\(\)/.test(sfx), "the display layer is a setting over the engine's world layers, passed with every word");
ok(sfx.includes("area: w.area, magnitude: w.magnitude") && !/\bsize: w\.size\b/.test(sfx), "words pass their area and magnitude (the engine's size model), not a fixed size");
ok(/L\.word\(w\.kind, o\)/.test(sfx) && /\.\.\.\(w\.word\?\.play \?\? \{\}\)/.test(sfx), "the engine's vocabulary writes each word, and its play options (mood, sound, accent, character) go with it");
ok(sfx.includes('space: "world"') && sfx.includes("reduced: red"), "words are world-space and follow the module's reduced-motion rule");
ok(!/from "[^"]*letters\/(?!index\.mjs)/.test(sfx) && sfx.includes('from "../letters/index.mjs"'), "the engine is used through its index only");

console.log(`sfx-letters: ${n} checks ok`);
