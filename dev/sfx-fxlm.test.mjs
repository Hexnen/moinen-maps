// FXLM: one check group per finding of the blind review of the map's destruction / fire lettering (scratchpad advm/FINDINGS.md), the
// caller side (scripts/sfx/). Each group failed on the reviewed build (lmap 3924e2a) and passes now.
//  F2  words are kept off this client's interface panels (Foundry's and any module's: pins, challenge HUD, party portraits)
//  F3  the main word sits beside what it letters, not on it
//  F4  no fire word plays after its fire is out (nothing pre-scheduled per stroke survives its going out)
//  F5  fire words follow the flames: the catch waits for them to show, a burning fire sounds for as long as it burns (its level), the
//      hiss lasts as long as the flames die
//  F6  a cave-in's pre word leads (it is handed in early enough to play at the anticipation's start, before the crash)
//  F9  words are the engine's onomatopoeia: no word table of the map's own; length from the sound's duration, loudness separate; a
//      bomb is more than one word
//  F11 the size hierarchy: a fire going out is never bigger than a building coming down or a bomb
//  F13 the room cap keeps the main word (never a pre word without its main word)
//  F14 nothing of this client's history changes a word (no per-client word memory)
//  F15 a gun's rattle is the engine's stream of its sound kind (no stacked "\n" words measured as one line)
//  F16 a scene change leaves nothing behind (no callback of the old scene feeds the new one)
import assert from "node:assert/strict";
import fs from "node:fs";
import * as C from "../scripts/sfx/sfx-core.mjs";
import { createVocab } from "../scripts/letters/words.mjs";
import { sizeFor } from "../scripts/letters/size.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const failed = [];
/* each finding's group runs on its own: on an old build every failing group is named (not only the first) */
const group = (id, fn) => { try { fn(); } catch ( err ) { failed.push(`${id}: ${String(err?.message ?? err).split(/\r?\n/)[0]}`); } };
const V = createVocab(), KINDS = new Set(V.list("en").map((k) => k.id)), G = 100;
const sfx = fs.readFileSync(new URL("../scripts/sfx/sfx.mjs", import.meta.url), "utf8");
const ov = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const ar = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);

/* F2: interface panels */
group("F2", () => {
  // a page: #interface (transparent, full screen) holding the sidebar, a transparent middle with the pins panel and the party
  // portraits (images in a transparent column), the canvas, a hidden window and a zero-size container with a painted child
  const el = (tag, r, cs = {}, kids = [], text = "") => ({ nodeType: 1, tagName: tag, r, cs: { display: "block", visibility: "visible", opacity: "1", backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none", borderTopWidth: "0px", ...cs },
    children: kids, childNodes: text ? [{ nodeType: 3, textContent: text }] : [], getBoundingClientRect() { return r ? { left: r[0], top: r[1], right: r[2], bottom: r[3], width: r[2] - r[0], height: r[3] - r[1] } : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; } });
  const sidebar = el("ASIDE", [1500, 0, 1600, 900], { backgroundColor: "rgb(20, 20, 30)" });
  const pins = el("SECTION", [100, 100, 320, 280], { backgroundColor: "rgba(10, 10, 20, 0.9)" });
  const portrait = el("IMG", [40, 300, 120, 380]);
  const party = el("DIV", [30, 280, 130, 600], {}, [el("DIV", [40, 280, 120, 296], {}, [], "PARTY"), portrait]);
  const middle = el("DIV", [0, 0, 1600, 900], {}, [pins, party]);
  const iface = el("DIV", [0, 0, 1600, 900], {}, [sidebar, middle]);
  const board = el("CANVAS", [0, 0, 1600, 900]);
  const hidden = el("DIV", [600, 300, 900, 600], { display: "none", backgroundColor: "rgb(255, 255, 255)" });
  const zero = el("DIV", null, {}, [el("DIV", [1200, 20, 1480, 120], { backgroundImage: "url(x.png)" })]);
  const rects = C.uiRects([iface, board, hidden, zero], { style: (e) => e.cs, vw: 1600, vh: 900, skip: (e) => e === board });
  const has = (r) => rects.some((q) => q.x0 === r[0] && q.y0 === r[1] && q.x1 === r[2] && q.y1 === r[3]);
  ok(has([1500, 0, 1600, 900]) && has([100, 100, 320, 280]) && has([40, 300, 120, 380]) && has([1200, 20, 1480, 120]), "F2 the sidebar, a module's panel, portraits and a painted child of a zero-size container are panels");
  ok(!rects.some((q) => q.x1 - q.x0 >= 1600) && !has([600, 300, 900, 600]), "F2 transparent full-screen layers, the canvas and hidden windows are not");
  // the word of an event right under the pins panel moves off it
  const toScene = (p) => ({ x: p.x * 2, y: p.y * 2 });                       // (zoom 0.5)
  const ui = C.toSceneBoxes(rects, toScene);
  const w = { role: "main", voice: "crack", x: 400, y: 380, bw: 260, bh: 90, t: 0, subject: { x0: 380, y0: 360, x1: 420, y1: 400 }, cover: 0.1 };
  const p = C.place([w], { view: { x0: 0, y0: 0, x1: 3200, y1: 1800 }, ui, tokens: [] })[0];
  ok(p && ui.every((b) => ov(p.box, b) === 0), "F2 a word at a panel moves off it");
  const sat = { ...w, role: "sec", x: 2800, y: 200, subject: null };       // a satellite with no free place but under the sidebar
  const p2 = C.place([w, { ...sat, bw: 2900, bh: 1700 }], { view: { x0: 0, y0: 0, x1: 3200, y1: 1800 }, ui, tokens: [] });
  ok(!p2.some((q) => q.role === "sec"), "F2 a satellite that would sit under a panel is dropped");
  ok(/uiRects\(\[\.\.\.document\.body\.children\]/.test(sfx) && /place\(.*\{ view: v, ui, tokens/.test(sfx), "F2 the runtime measures this client's panels and places around them");
  // live take (FXLM smoke, 2026-11-13): a fire's continuous words hovered over the party portraits, the out hiss drifted up into the
  // challenge HUD, and a main word as wide as two thirds of the screen could not be placed off anything
  const fireBox = { x0: 60, y0: 560, x1: 360, y1: 700 };                    // over the portraits (scene px at zoom 0.5: 30..130, 280..600 client)
  const sh = C.clearOf(fireBox, ui, { x0: 0, y0: 0, x1: 3200, y1: 1800 });
  const moved = { x0: fireBox.x0 + sh.dx, y0: fireBox.y0 + sh.dy, x1: fireBox.x1 + sh.dx, y1: fireBox.y1 + sh.dy };
  ok((sh.dx || sh.dy) && ui.every((b) => ov(moved, b) === 0) && Math.hypot(sh.dx, sh.dy) < 600, "F2 a burning fire's words move just clear of a panel over its flames");
  ok(C.clearOf({ x0: 1000, y0: 1000, x1: 1200, y1: 1100 }, ui, { x0: 0, y0: 0, x1: 3200, y1: 1800 }).dx === 0, "F2 ... and stay put where nothing covers them");
  ok(/burnOffsets\(/.test(sfx) && /o \? \{ x: q\.x \+ o\.dx, y: q\.y \+ o\.dy \}/.test(sfx), "F2 the runtime moves the burning fire's phrase spots by those shifts");
  const steam = { role: "main", voice: "out", x: 2600, y: 400, bw: 300, bh: 80, rise: 90 * 2, t: 0, subject: { x0: 2580, y0: 380, x1: 2620, y1: 420 }, cover: 0.4 };
  const ps = C.place([steam], { view: { x0: 0, y0: 0, x1: 3200, y1: 1800 }, ui, tokens: [] })[0];
  ok(ps && ps.box.y0 <= ps.y - 40 - 180 + 1 && ui.every((b) => ov(ps.box, b) === 0), "F2 a word that rises (steam) keeps its whole way up off the panels");
  ok(/w\.rise = grid\(\) \* DRIFT\[1\]/.test(sfx), "F2 the runtime gives steam its rise");
  ok(C.CEIL_K.main < 1 && C.CEIL_K.sec < C.CEIL_K.main && /ceilK: C\.CEIL_K\[w\.role\]/.test(sfx), "F2 the map's words take a share of the engine's size ceiling (a main word leaves room around it)");
  ok(sizeFor({ space: "world", grid: 100, zoom: 1, vw: 1600, vh: 900, area: 900, magnitude: 1.5, aspect: 6, ceilK: C.CEIL_K.main }).px * 6 < 1600 * 0.45, "F2 ... the biggest main word stays under about two fifths of the width");
  ok(/el\.id === "pause"/.test(sfx), "F2 the game-paused banner is not a panel (it would push every word off the middle)");
});

/* F3: beside its subject */
group("F3", () => {
  const areas = []; for ( let i = 0; i < 12; i++ ) areas.push({ key: `a${i}`, obj: "d1", voice: "crash", x: 600 + (i % 4) * 110, y: 500 + Math.floor(i / 4) * 110, r: 80, t: 1000,
    box: { x0: 520 + (i % 4) * 110, y0: 420 + Math.floor(i / 4) * 110, x1: 680 + (i % 4) * 110, y1: 580 + Math.floor(i / 4) * 110 } });
  const g = C.cluster(areas, G)[0];
  const words = C.planCluster(g, { grid: G, sec: 4, seed: "s" }).map((w) => ({ ...w, bw: w.role === "main" ? 420 : 160, bh: w.role === "main" ? 130 : 50 }));
  const placed = C.place(words, { view: { x0: 0, y0: 0, x1: 2400, y1: 1600 }, tokens: [] });
  const m = placed.find((w) => w.role === "main");
  ok(ov(m.box, g.box) <= 0.2 * ar(m.box) + 1e-6, `F3 the main word covers little of the rubble (${(ov(m.box, g.box) / ar(m.box)).toFixed(2)} of it)`);
  ok(m.box.y1 <= g.box.y0 + 0.3 * (m.box.y1 - m.box.y0) + 1e-6, "F3 ... it sits above it (the sound rises off it), touching its edge");
  ok(Math.abs((m.box.x0 + m.box.x1) / 2 - (g.box.x0 + g.box.x1) / 2) < 200, "F3 ... and stays with it");
});

/* F4: nothing after the fire is out */
group("F4", () => {
  const st = { id: "f", k: "fire", q: 10000, r: 50, lv: 3, p: [0, 0, 600, 0, 1200, 0, 1800, 0] };
  const ev = C.strokeEvents(st, null, 10000, 40000, { grid: G, late: 1500 });
  ok(ev.every((e) => !/spread|amb/.test(e.key) && e.t <= 10000 + 1), "F4 a fire schedules no words along its path ahead of time (its burning is one continuous sound)");
  ok(!C.fireEventLive({ obj: "f", voice: "fire" }, { ...st, o: 12000 }, 12500) && !C.fireEventLive({ obj: "f", voice: "flare" }, null, 12500), "F4 a catch / flare word whose fire is out or gone is not played");
  ok(C.fireEventLive({ obj: "f", voice: "out" }, { ...st, o: 12000 }, 12500) && C.fireEventLive({ obj: "f", voice: "fire" }, st, 12500), "F4 ... its hiss and a burning fire's words are");
  ok(!C.strokeEvents({ ...st, o: 10200 }, null, 10000, 40000, { grid: G, late: 1500 }).some((e) => e.voice === "fire"), "F4 a fire put out the moment it caught letters its hiss only");
  ok(/function cancelObj\(obj\)/.test(sfx) && /prev\.o !== st\.o \) cancelObj\(st\.id\)/.test(sfx) && /fireEventLive\(/.test(sfx) && /a\.h\.stop\(\)/.test(sfx), "F4 the runtime cancels a stroke's waiting words when it goes out and stops its words still up");
});

/* F5: fire words follow the flames */
group("F5", () => {
  const st = { id: "f", k: "fire", q: 10000, r: 60, lv: 2, p: [0, 0, 600, 0, 1200, 0] };
  const c = C.strokeEvents(st, null, 10000, 40000, { grid: G, late: 1500 }).find((e) => e.voice === "fire");
  ok(c.gate === "f", "F5 the catch word waits for its flames to show on this client");
  ok(/fireShown/.test(fs.readFileSync(new URL("../scripts/fire/fire.mjs", import.meta.url), "utf8")) && /e\.t, at \+ 120/.test(sfx), "F5 ... told by the fire layer when it shows them");
  const plan = C.burnPlan([st], { grid: G, catchMs: () => 4000, levelNow: (s, t) => (t > 20000 ? 3 : s.lv) });
  ok(plan.level(15000) < plan.level(25000), "F5 a burning fire's sound follows its level (a flare-up is louder)");
  const a0 = plan.at(0, 11000), a1 = plan.at(0, 12000);
  ok(a1.x > a0.x && plan.at(0, 30000).x === plan.points[0].x, "F5 ... rides the flame front while the fire runs along its path, then stays put");
  ok(plan.points.length >= 1 && plan.points.length <= 3 && C.burnPlan([{ ...st, lv: 1 }], { grid: G }).live === false && plan.live, "F5 a blaze is a live phrase score, a smoulder the quiet ambient sound");
  const out = C.strokeEvents({ ...st, o: 30000 }, st, 29000, 40000, { grid: G, late: 1500, outMs: 3520 }).find((e) => e.voice === "out");
  ok(out.ms === 3520, "F5 the hiss lasts as long as the flames take to die");
  ok(/L\.sustain\(/.test(sfx) && /reconcileBurn/.test(sfx) && !/AMBIENT_EVERY|ambientEvent/.test(sfx), "F5 the runtime plays the burning as the engine's sustain for as long as the fire burns (no slot timer)");
});

/* F6: the pre word leads */
/* F5 (live take): a bomb's burning debris dies patch by patch - one hiss, not a chorus of identical ones */
group("F5b", () => {
  const out = (t, x) => ({ members: [{ voice: "out" }], main: { voice: "out", t }, x, y: 0, span: 50, t });
  ok(C.isEcho(out(1000, 3000), [{ x: 0, y: 0, reach: 100, t: 0, prio: 3, voice: "out" }], 100), "F5 a second fire going out soon after another, anywhere, does not hiss again");
  ok(!C.isEcho(out(C.OUT_GAP_MS + 10, 3000), [{ x: 0, y: 0, reach: 100, t: 0, prio: 3, voice: "out" }], 100), "F5 ... later it does");
  ok(/voice: g\.main\.voice \}\);/.test(sfx), "F5 the runtime remembers which sound each played word was");
});

group("F6", () => {
  const I = { type: "collapse", cause: 0, rect: { x0: 0, y0: 0, x1: 40, y1: 30 } };
  const e = C.entryEvent(I, { x: 1000, y: 1000 }, 4, 5000, { key: "d|h|5000", sid: "d|h" });
  ok(e.tPre === 5000 && e.t === 5000 + C.COLLAPSE_LEAD, "F6 a cave-in's event carries its anticipation's start");
  ok(C.dueAt(e) <= e.tPre - C.GATHER_MS, "F6 it is handed in early enough for its pre word to play at that start");
  const words = C.planCluster(C.cluster([{ ...e, r: 300, m: 0.8 }], G)[0], { grid: G, sec: 4, seed: "s" });
  const pre = words.find((w) => w.role === "pre"), main = words.find((w) => w.role === "main");
  ok(pre && pre.t === 5000 && main.t - pre.t >= 200, "F6 the pre word plays at the anticipation, the crash ~230 ms later");
});

/* F9: the engine's onomatopoeia, duration separate from loudness, a bomb is more than one word */
group("F9", () => {
  ok(!("WORDS" in C) && !("wordFor" in C) && !fs.existsSync(new URL("../scripts/sfx/words.mjs", import.meta.url)), "F9 no word table of the map's own");
  for ( const v of Object.keys(C.VOICES) ) ok(KINDS.has(C.kindOf(v, KINDS)), `F9 ${v}: an engine kind`);
  const word = (voice, loud, ms, seed, lang = "en") => V.word(C.kindOf(voice, KINDS), { seed, lang, loud, duration: ms }).text;
  let bangsOk = true, quietLong = 0, loudShort = 0;
  for ( let i = 0; i < 20; i++ ) for ( const lang of ["en", "pl"] ) {
    for ( const v of Object.keys(C.VOICES) ) if ( (word(v, 1, 300, `b${i}`, lang).match(/!/g) ?? []).length > 2 ) bangsOk = false;
    const o = word("out", 0.25, 3500, `o${i}`, lang), k = word("crack", 0.95, 200, `k${i}`, lang);
    if ( !o.includes("!") ) quietLong++;
    if ( (k.match(/(\p{L})\1{3,}/u) ?? []).length === 0 ) loudShort++;
  }
  ok(bangsOk, "F9 never more than two exclamation marks");
  ok(quietLong >= 36, `F9 a fire going out (quiet, long) hisses without "!" (${quietLong}/40)`);
  ok(loudShort >= 36, `F9 a crack (loud, short) is not stretched (${loudShort}/40)`);
  const st = { id: "c", k: "burst", q: 5000, p: [10, 10], r: 300, lv: 3 };
  const evs = C.strokeEvents(st, null, 5000, 9000, { grid: G, late: 1500 });
  const words = C.planCluster(C.cluster(evs, G)[0], { grid: G, sec: 4, seed: "s" });
  ok(words.length >= 3 && words.filter((w) => w.role === "sec").every((w) => w.magnitude < words.find((q) => q.role === "main").magnitude), `F9 a bomb is a main word with its shock and debris (${words.length} words)`);
  ok(/duration: w\.ms/.test(sfx), "F9 the runtime asks the engine for the sound's own duration");
});

/* F11: the size hierarchy */
group("F11", () => {
  const plan = (e) => C.planCluster(C.cluster([{ key: "k", t: 0, ...e }], G)[0], { grid: G, sec: 0, seed: "s" }).find((w) => w.role === "main");
  const ctx = { space: "world", grid: G, vw: 1600, vh: 900, sizeK: 1, aspect: 4, fit: "legible", alive: 1 };
  const px = (w, zoom) => sizeFor({ ...ctx, zoom, magnitude: w.magnitude, area: w.area }).px;
  const outE = C.strokeEvents({ id: "f", k: "fire", q: 0, o: 1000, r: 400, lv: 3, p: [0, 0, 2000, 0, 4000, 0] }, null, 0, 9000, { grid: G, late: 1500, outMs: 3500 }).find((e) => e.voice === "out");
  const hiss = plan(outE), coll = plan({ voice: "crash", x: 0, y: 0, r: 450, m: 0.85 }), bomb = plan({ voice: "boom", x: 0, y: 0, r: 300, m: 0.9 }), crack = plan({ voice: "crack", x: 0, y: 0, r: 30 });
  ok(hiss.magnitude < 0.4 && hiss.magnitude < coll.magnitude / 3, `F11 a level-3 fire going out is quiet (${hiss.magnitude} vs a collapse ${coll.magnitude})`);
  for ( const z of [0.3, 0.5, 0.86, 1.5] ) ok(px(hiss, z) < px(coll, z) && px(hiss, z) < px(bomb, z) && px(crack, z) <= px(coll, z), `F11 at zoom ${z} the hiss is smaller than the collapse and the bomb (${px(hiss, z).toFixed(0)} < ${px(coll, z).toFixed(0)}, ${px(bomb, z).toFixed(0)})`);
});

/* F13: the room cap keeps the main word */
group("F13", () => {
  const ws = [{ role: "pre", t: 0 }, { role: "main", t: 230 }, { role: "sec", t: 400 }, { role: "sec", t: 500 }];
  const one = C.capWords(ws, 1), two = C.capWords(ws, 2);
  ok(one.length === 1 && one[0].role === "main" && two.map((w) => w.role).join() === "pre,main", "F13 one place: the main word; two: the pre word and the main word, in time order");
  ok(/capWords\(C\.place\(/.test(sfx) && !/\.slice\(0, room\)/.test(sfx), "F13 the runtime caps through capWords");
});

/* F14: no per-client word memory */
group("F14", () => {
  ok(!/lastWord/.test(sfx) && /avoid: taken\.slice\(\)/.test(sfx), "F14 only the words of the same moment make a word differ (seeded, the same on every seat)");
  const mk = (t) => [{ key: `d|a|${t}`, sid: "d|a", t, voice: "crash", x: 0, y: 0, r: 300, m: 0.8 }];
  const a = JSON.stringify(C.planCluster(C.cluster(mk(1000), G)[0], { grid: G, sec: 4, seed: "s" }).map((w) => [w.role, w.kind, w.seed, w.loud, w.ms]));
  const b = JSON.stringify(C.planCluster(C.cluster(mk(98765), G)[0], { grid: G, sec: 4, seed: "s" }).map((w) => [w.role, w.kind, w.seed, w.loud, w.ms]));
  ok(a === b, "F14 the same damage arriving later on one seat gets the same words");
  // live take (FXLM, GM + Test Gracz 1, 2026-11-13): six cave-ins reached the player in two bakes; its cluster was smaller, so the
  // main word was written louder/quieter ("KRAAASH" on the GM, "KRAAASH!!" on the player). The text comes from the main sound alone.
  const six = Array.from({ length: 6 }, (_, i) => ({ key: `d|c${i}|1`, sid: `d|c${i}`, t: 1000 + i * 5, voice: "crash", x: (i % 3) * 120, y: Math.floor(i / 3) * 120, r: 140 }));
  const mainOf = (evs) => C.planCluster(C.cluster(evs, G)[0], { grid: G, sec: 4, seed: "s", known: KINDS }).find((w) => w.role === "main");
  const full = mainOf(six), part = mainOf(six.slice(0, 2));
  ok(full.seed === part.seed && full.textLoud === part.textLoud && full.ms === part.ms, "F14 a cave-in whose parts reach one seat a bake later is written the same (seed, loudness of the text, length)");
  ok(/loud: w\.textLoud \?\? w\.loud/.test(sfx), "F14 the runtime writes the word from that loudness");
});

/* F15: a gun's rattle is a stream */
group("F15", () => {
  const walk = [{ x: 0, y: 0, ms: 0 }, { x: 100, y: 0, ms: 120 }, { x: 200, y: 0, ms: 240 }];
  const e = C.entryEvent({ type: "blast", cause: 0, rect: { x0: 0, y0: 0, x1: 10, y1: 10 } }, { x: 0, y: 0 }, 1, 100, { gun: walk, key: "g", sid: "g" });
  const w = C.planCluster(C.cluster([e], G)[0], { grid: G, sec: 4, seed: "s", known: KINDS })[0];
  ok(e.voice === "gun" && w.stream?.walk === walk && w.kind === "gunfire" && !("text" in w), "F15 a gun's pocks are the engine's gunfire stream along its walk (no stacked words)");
  ok(/L\.stream\(\{ kind: w\.kind/.test(sfx), "F15 the runtime streams the kind (the engine's syllables)");
  // live take (FXLM, 2026-11-13): the stream never started - its beats were built with a map callback that read a third argument
  // Array.from does not pass ("a word did not play: Cannot read properties of undefined"); the beats are a pure function now
  const b = C.streamBeats(walk);
  ok(b.length === 3 && b[0] === 0 && b[2] === 240 && b.every((x, i) => i === 0 || x > b[i - 1]), "F15 a three-round walk rattles on three beats over its length");
  const long = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0, ms: i * 90 }));
  ok(C.streamBeats(long).length === 8 && C.streamBeats(long).at(-1) === 1710 && C.streamBeats([{ x: 0, y: 0, ms: 0 }]).length >= 1, "F15 a long burst: at most eight syllables to its last round; a single round still sounds");
  ok(/const beats = C\.streamBeats\(W\)/.test(sfx), "F15 the runtime uses them");
});

/* F16: a scene change leaves nothing behind */
group("F16", () => {
  ok(/function teardown\(full = true\) \{\n\s*gen\+\+;/.test(sfx) && /recent = \[\]/.test(sfx.slice(sfx.indexOf("function teardown"))), "F16 teardown starts a new generation and clears the echo memory");
  ok(/if \( g0 !== gen \|\| !L/.test(sfx) && /if \( g0 === gen \) fn\(\)/.test(sfx), "F16 every waiting callback of the old scene is void in the new one");
  ok(!/loading\?\.then\(\(\) => \{ pending\.push/.test(sfx), "F16 events of the old scene are never pushed back after the engine loads");
});

/* PATHS (coordinator): presets / combinations / a painted directional stroke / all at once */
const area = (o = {}) => ({ type: "collapse", cause: 0, rect: { x0: 0, y0: 0, x1: 200, y1: 200 }, w: 200, h: 200, ...o });
group("PATH", () => {
  // a directional stroke: its word rides the entry clock's front along the brush path, for as long as it runs
  const pf = { pts: Array.from({ length: 60 }, (_, i) => [i * 10, 50]), tt: Array.from({ length: 60 }, (_, i) => i * 20) };
  const ride = C.rideOf(pf, { x: 1000, y: 0 }, 2, 40);
  ok(ride.length <= 25 && ride[0].x === 1000 && ride[0].ms === 40 && ride.at(-1).x === 1000 + 590 * 2 && ride.at(-1).ms === 40 + 59 * 20 && ride.every((q, i) => !i || q.ms > ride[i - 1].ms),
    "PATH a painted stroke's ride: scene px along the brush, ms rising with the front, ending at its last point");
  const e = C.entryEvent(area(), { x: 0, y: 0 }, 1, 5000, { ride, key: "k", sid: "s" });
  ok(e.path === ride && e.t0 === 5000 && e.ms >= ride.at(-1).ms, "PATH the entry event carries the ride and lasts as long as the front runs");
  const w = C.planCluster(C.cluster([e], G)[0], { grid: G, sec: 3, known: KINDS }).find((x) => x.role === "main");
  ok(w.path === ride && !w.stream, "PATH the main word rides it (one word along the stroke, not one per stamp)");
  ok(/!walk && !opts\.simul && Array\.isArray\(opts\.path\)/.test(sfx) && /pathTimes\(opts\.path/.test(sfx), "PATH only a directional stroke rides (all at once: no ride), on the pixels' own clock");
  // all at once: one stroke's many areas at one moment -> one cluster, one main word
  const many = Array.from({ length: 12 }, (_, i) => ({ ...C.entryEvent(area({ rect: { x0: i * 150, y0: 0, x1: i * 150 + 140, y1: 140 } }), { x: 0, y: 0 }, 1, 1000, { key: `a${i}`, sid: `a${i}`, objId: "d7" }) }));
  const cl = C.cluster(many, G);
  const mains = cl.flatMap((g) => C.planCluster(g, { grid: G, sec: 3, known: KINDS })).filter((x) => x.role === "main");
  ok(cl.length === 1 && mains.length === 1, "PATH all at once: one big moment, one main word (not a flood)");
  // a combination: a bomb (burst) + its crater -> one page: the boom leads, the rest are its satellites
  const st = { id: "b1", k: "burst", p: [500, 500], r: 200, q: 1000, lv: 3 };
  const evs = [...C.strokeEvents(st, null, 0, 2000, { grid: G }), { ...C.entryEvent(area({ type: "blast", rect: { x0: 350, y0: 350, x1: 650, y1: 650 } }), { x: 0, y: 0 }, 1, 1000, { key: "c", sid: "c" }) }];
  const cl2 = C.cluster(evs, G), w2 = cl2.flatMap((g) => C.planCluster(g, { grid: G, sec: 3, known: KINDS }));
  ok(cl2.length === 1 && w2.filter((x) => x.role === "main").length === 1 && w2.find((x) => x.role === "main").voice === "boom", "PATH a combination composes: one boom, the rest satellites");
});

/* ORDER (owner): blast first, then the shock wave rolling out, then the debris coming down; the fire after (its catch waits for flames) */
group("ORDER", () => {
  const st = { id: "b2", k: "burst", p: [500, 500], r: 200, q: 1000, lv: 3, db: [300, 40, 700, -260, 90, 1150, 120, -200, 900] };
  const ev = C.strokeEvents(st, null, 0, 3000, { grid: G });
  const boom = ev.find((e) => e.voice === "boom"), shock = ev.find((e) => e.voice === "whump"), deb = ev.filter((e) => e.voice === "debris");
  ok(boom.t === 1000 && shock.t > boom.t && deb.every((d) => d.t > shock.t), "ORDER blast, then the wave, then the debris");
  const d0 = Math.hypot(shock.path[0].x - 500, shock.path[0].y - 500), d1 = Math.hypot(shock.path.at(-1).x - 500, shock.path.at(-1).y - 500);
  ok(shock.path.length === 2 && d1 > d0 * 2 && shock.path.at(-1).ms === C.SHOCK_MS[1], "ORDER the shock wave's word rides outwards with the wave (its own word, not a 2nd boom)");
  ok(deb.length === 2 && deb[0].t === 1700 && deb[1].t === 2150 && deb[0].x === 800 && deb[1].x === 240, "ORDER the debris words land where and when the burst's thrown chunks land (st.db)");
  const words = C.cluster(ev, G).flatMap((g) => C.planCluster(g, { grid: G, sec: 3, known: KINDS }));
  const sw = words.find((w) => w.voice === "whump"), dw = words.filter((w) => w.voice === "debris");
  ok(sw && sw.path && sw.t === shock.t && dw.length && dw.every((w) => deb.some((d) => d.t === w.t)), "ORDER the satellites keep their own moments (wave rolling, debris landing) and the wave's path");
  const fire = C.strokeEvents({ id: "f1", k: "fire", p: [500, 500], r: 150, q: 1000, lv: 2 }, null, 0, 3000, { grid: G }).find((e) => e.voice === "fire");
  ok(fire && fire.gate === "f1", "ORDER the fire's catch waits for its flames to show (after the blast); its burn follows its level (F5)");
});

/* MAT (owner): the ground / what breaks changes the sound */
group("MAT", () => {
  ok(C.matOf(-1) === "auto" && C.matOf(7) === "metal" && C.matOf(2) === "stone" && C.matOf(6) === "water", "MAT the layer's material index -> its name");
  ok(C.kindOf("debris", KINDS, "metal") === "clang" && C.kindOf("debris", KINDS, "water") === "splash" && C.kindOf("debris", KINDS, "auto") === "crumble", "MAT metal clangs, water splashes, the rest crumbles");
  ok(C.kindOf("gunhit", KINDS, "stone") === "ricochet" && C.kindOf("gunhit", KINDS, "earth") === "thud" && C.kindOf("gunhit", KINDS, "metal") === "clang", "MAT a round whines off stone, thuds into soil, clangs on metal");
  ok(C.kindOf("crash", KINDS, "metal") === "crash" && C.kindOf("boom", KINDS, "water") === "boom", "MAT a building's crash and a bomb's boom stay themselves");
  const e = C.entryEvent(area({ type: "cracks", mat: 7 }), { x: 0, y: 0 }, 1, 0, { key: "m", sid: "m" });
  const w = C.planCluster(C.cluster([e], G)[0], { grid: G, known: KINDS })[0];
  ok(e.mat === "metal" && w.kind === "clang", "MAT a crack in metal is lettered as a clang");
});

/* SHOT (owner): a gun fired by a token: its report at the muzzle when each round leaves, the impact where it lands */
group("SHOT", () => {
  const it = { kind: "muzzle", from: [0, 0], fr: 50, hits: [[1600, 0, 500, 0], [1600, 100, 600, 1], [1600, 200, 700, 0]] };
  const fl = (L) => Math.min(400, Math.max(25, (L / G) / 160 * 1000));
  const me = C.muzzleEvent(it, { t0: 10000, grid: G, muzzleOf: (a, h, g) => { const d = Math.hypot(h[0], h[1]), ux = h[0] / d, uy = h[1] / d, off = 0.85 * 50;
    return { x: ux * off, y: uy * off, L: d - off }; }, flight: fl, key: "m1", sid: "m1" });
  ok(me.voice === "muzzle" && Math.abs(me.x - 42.5) < 1e-9 && me.t === 10000 + 500 - fl(1600 - 42.5), "SHOT the report sounds at the barrel, when the first round leaves (hit time minus flight)");
  ok(me.path.length === 3 && me.path[0].ms === 0 && me.path[2].ms > me.path[1].ms && Math.abs(Math.cos(me.dir * Math.PI / 180) + 1) < 0.05, "SHOT a syllable per round; the report kicks back away from the aim");
  const w = C.planCluster(C.cluster([me], G)[0], { grid: G, known: KINDS })[0];
  // (engine 1.7.0 WORD2 has the guns' own kinds - pistol, rifle, gunfire, minigun - in place of one "gunshot": the firing's rounds pick one)
  ok(KINDS.has(w.kind) && /^(pistol|rifle|gunfire|minigun)$/.test(w.kind) && w.kind === C.kindOf("muzzle", KINDS, null, C.gunKinds(me.path)) && w.stream && w.stream.dir === me.dir && w.stream.t0 === me.t0,
    "SHOT one gun stream at the muzzle, of the engine's gun kind");
  const wk = (n, every) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0, ms: i * every }));
  ok(C.kindOf("muzzle", KINDS, null, C.gunKinds(wk(1, 0))) === "pistol" && C.kindOf("muzzle", KINDS, null, C.gunKinds(wk(3, 400))) === "rifle"
    && C.kindOf("muzzle", KINDS, null, C.gunKinds(wk(12, 90))) === "gunfire" && C.kindOf("muzzle", KINDS, null, C.gunKinds(wk(40, 30))) === "minigun",
    "SHOT the gun's kind follows how its rounds come: one round a pistol, slow aimed rounds a rifle, a burst the rattle, a rip the rotary");
  const walk = [{ x: 1600, y: 0, ms: 0 }, { x: 1600, y: 100, ms: 100 }];
  const hit = C.entryEvent(area({ type: "cracks", mat: 2 }), { x: 0, y: 0 }, 1, 0, { gun: walk, shot: true, key: "g", sid: "g" });
  const free = C.entryEvent(area({ type: "cracks", mat: 2 }), { x: 0, y: 0 }, 1, 0, { gun: walk, key: "g2", sid: "g2" });
  ok(hit.voice === "gunhit" && C.kindOf(hit.voice, KINDS, hit.mat) === "ricochet" && free.voice === "gun", "SHOT where the shooter's rounds land: the impact by what they hit; a gun with no shooter rattles");
  ok(C.planCluster(C.cluster([free], G)[0], { grid: G, known: KINDS })[0].kind === C.kindOf("gun", KINDS, null, C.gunKinds(walk)), "SHOT a gun with no shooter rattles in the gun kind of its own walk");
  ok(/Hooks\.on\("moinenMapsPresets", \(kind, data\) => \{ if \( kind === "firing" \) onFiring/.test(sfx) && /shot = !!walk && hasShooter\(walk/.test(sfx) && /dir: Number\.isFinite\(w\.stream\.dir\)/.test(sfx),
    "SHOT the runtime letters a firing's muzzle and marks its pocks as impacts");
});

/* NOTES (readers of the branch): no double lettering, shot-true syllables, the same words on every seat */
group("NOTES", () => {
  const hits = C.strokeEvents({ id: "h1", k: "dust", dk: "hits", p: [100, 100, 300, 100], r: 40, q: 1000, lv: 2 }, null, 0, 3000, { grid: G });
  ok(hits.length === 0, "NOTES a gun's / ejecta's hit spits letter nothing of their own (the gun or the blast letters the impact)");
  const bomb = C.strokeEvents({ id: "b9", k: "burst", p: [500, 500], r: 200, q: 1000, lv: 3 }, null, 0, 3000, { grid: G });
  const dust = C.strokeEvents({ id: "s9", k: "dust", dk: "shock", p: [500, 500], r: 300, q: 1000, lv: 3 }, null, 0, 3000, { grid: G });
  const w = C.cluster([...bomb, ...dust], G).flatMap((g) => C.planCluster(g, { grid: G, sec: 4, known: KINDS }));
  ok(w.filter((x) => x.voice === "whump").length === 1 && w.find((x) => x.voice === "whump").path, "NOTES one bomb, one wave word (the riding one), not a burst shock and a dust shock");
  const walk = [0, 70, 90, 400, 410, 900].map((ms, i) => ({ x: i * 10, y: 0, ms: ms + 5000 }));
  ok(JSON.stringify(C.streamBeats(walk)) === JSON.stringify([0, 70, 90, 400, 410, 900]), "NOTES a gun's syllables fall on its rounds' own moments (shot-true), not evenly spread");
  ok(/get\("sfxWordsWorld", "auto"\)/.test(sfx) && /"sfxWordsWorld", \{[^}]*scope: "world"/.test(sfx) && /isActiveGM && get\("sfxWordsWorld"/.test(sfx), "NOTES 'game language' follows the world's word set (fixed once by the GM): a Polish and an English seat see the same word");
});

/* WORD2 (engine 1.7.0): the map's voices use the engine's newer kinds where they fit; the thing hit gives the word its material */
group("WORD2", () => {
  const gren = C.strokeEvents({ id: "g7", k: "burst", p: [500, 500], r: 80, q: 1000, lv: 1 }, null, 0, 3000, { grid: G });
  const bomb = C.strokeEvents({ id: "b7", k: "burst", p: [500, 500], r: 200, q: 1000, lv: 3 }, null, 0, 3000, { grid: G });
  const kOf = (evs) => C.planCluster(C.cluster(evs, G).find((g) => g.main.voice === "boom"), { grid: G, known: KINDS })[0].kind;
  ok(kOf(gren) === "grenade" && kOf(bomb) === "boom", "WORD2 a grenade bursts in the engine's grenade kind, a bomb in the boom");
  for ( const v of Object.keys(C.VOICES) ) ok(KINDS.has(C.kindOf(v, KINDS)) && C.VOICES[v].kinds.some((k) => KINDS.has(k)), `WORD2 voice ${v} has a kind the engine knows`);
  const crack = (mat) => C.planCluster(C.cluster([C.entryEvent(area({ type: "cracks", mat }), { x: 0, y: 0 }, 1, 0, { key: "c" + mat, sid: "c" + mat })], G)[0], { grid: G, known: KINDS })[0];
  ok(crack(2).emat === "stone" && crack(3).emat === "wood" && crack(7).emat === "metal" && crack(-1).emat === null, "WORD2 what is hit gives the word its material (stone, wood, metal; the kind's own elsewhere)");
  ok(C.planCluster(C.cluster(bomb, G).find((g) => g.main.voice === "boom"), { grid: G, known: KINDS })[0].emat === null, "WORD2 a bomb's boom keeps its own (fire) character");
  ok(sfx.includes("if ( w.emat && o.character ) o.character = { ...o.character, material: w.emat };"), "WORD2 the runtime changes only the material of the word's character");
});

if ( failed.length ) { console.log(failed.join(" | ")); console.log(`sfx-fxlm: ${failed.length} finding group(s) FAILED`); process.exit(1); }
console.log(`sfx-fxlm: ${n} checks ok`);
