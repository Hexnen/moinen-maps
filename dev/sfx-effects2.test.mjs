// EFFECTS2: the Superhero plough, the rain's lightning, Detonate and words sized by rank (scripts/sfx/sfx-events.mjs, the meteor's
// page in sfx-page.mjs, the wiring in sfx.mjs / display.mjs / destruction.mjs). Each group fails on the build before EFFECTS2 (no
// sfx-events.mjs: the import fails; the meteor's one-ride descent; no bus hook) and names what it holds.
import assert from "node:assert/strict";
import fs from "node:fs";
import * as E from "../scripts/sfx/sfx-events.mjs";
import * as P from "../scripts/sfx/sfx-page.mjs";
import * as SM from "../scripts/weather/storm-model.mjs";
import * as C from "../scripts/presets/core.mjs";
import { BUILTIN } from "../scripts/presets/defs.mjs";
import * as MC from "../scripts/presets/meteor-core.mjs";
import { fallAt } from "../scripts/presets/landing-fx.mjs";
import * as SC from "../scripts/sfx/sfx-core.mjs";
import { createVocab } from "../scripts/letters/words.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const failed = [];
const group = (id, fn) => { try { fn(); } catch ( err ) { failed.push(`${id}: ${String(err?.message ?? err).split(/\r?\n/)[0]}`); } };
const V = createVocab(), KINDS = new Set(V.list("en").map((k) => k.id));
const src = (f) => fs.readFileSync(new URL(`../scripts/${f}`, import.meta.url), "utf8");

// a plough: the carrier runs 1600 ms to the right; three tokens join the pile one after another
const hit = (id, t0, x0) => ({ id, t0, p: [x0, 500, t0, x0 + 200, 500, t0 + 400, x0 + 600, 500, 1600] });
const plough = (hits, extra = {}) => E.ploughPage({ hits, D: 1600, k: 1, start: 10_000, delay: 40, grid: 100, seed: "s", ...extra });

// PLOUGH: lettered at the start, in the middle and at the end (owner's answer 8), each different and BUILDING (8b)
group("PLOUGH", () => {
  const w = plough([hit("a", 300, 400), hit("b", 700, 700), hit("c", 1000, 900)]);
  ok(w.map((q) => q.role).join(",") === "bite,grind,stop", "start, middle, end: " + w.map((q) => q.role));
  ok(w[0].t < w[1].t && w[1].t < w[2].t, "in order of the event");
  ok(w[0].t === 10_000 + 40 + 300, "the bite at the first contact");
  ok(w[2].t === 10_000 + 40 + 1600, "the stop when the carrier comes to rest");
  ok(w[0].rank < w[1].rank && w[1].rank < w[2].rank, "it builds: rank " + w.map((q) => q.rank));
  ok(w[0].wo.loud < w[1].wo.loud && w[1].wo.loud < w[2].wo.loud, "louder each time");
  ok(new Set(w.map((q) => q.kind)).size === 3 && w.every((q) => KINDS.has(q.kind)), "three different sounds of the engine: " + w.map((q) => q.kind));
  ok(w[0].ms < 500 && w[1].ms > 700 && w[1].ride?.length >= 3, "tempo: a short knock, then a long grind riding with the pile");
  ok(w[1].ride.every((q, i, a) => !i || q.x > a[i - 1].x - 1), "the grind rides along the way of the pile");
  ok(w.every((q) => q.y < 500), "every word on the screen-up side of the pile, never on it");
  const txt = w.map((q) => V.word(q.kind, { ...q.wo, seed: q.seed, lang: "en" }).text);
  ok(new Set(txt).size === 3, "three different words: " + txt.join(" "));
  ok(plough([]).length === 0 && plough([hit("a", 300, 400)], { D: 100 }).length === 0, "no plough, no words");
  const one = plough([hit("a", 300, 400)]), many = plough([hit("a", 300, 400), hit("b", 500, 600), hit("c", 600, 700), hit("d", 700, 800)]);
  ok(many[2].rank > one[2].rank && many[1].wo.loud > one[1].wo.loud, "a bigger pile ends bigger and grinds louder");
});

// FLASH: the rain's lightning - far rumbles small at the edge on its side after the light, mid louder, a close strike thunders at its foot
group("FLASH", () => {
  const view = { x0: 0, y0: 0, x1: 2000, y1: 1000 };
  const C0 = { ...SM.DEFAULT, on: true };
  const far = SM.makeFlash(C0, 7, 100, 100_000, "far"), mid = SM.makeFlash(C0, 7, 101, 101_000, "mid"), close = SM.makeFlash(C0, 7, 102, 102_000, "close");
  const right = { x: 5000, y: 500 };
  const wf = E.flashWord(far, right, view, "s"), wm = E.flashWord(mid, right, view, "s"), wc = E.flashWord(close, { x: 900, y: 400 }, view, "s");
  ok(wf.screen && wf.screen.fx > 0.8 && Math.abs(wf.screen.fy - 0.5) < 0.1, "far: unlocated at the screen edge on its side " + JSON.stringify(wf.screen));
  ok(wf.t >= far.t + 1200 && wf.t <= far.t + 2000, "far: the thunder comes 1.2-2 s after the light");
  ok(wf.rank === 1 && wm.rank === 2 && wc.rank >= 4, "far < mid < close");
  ok(wf.kind === "rumble" && wm.kind === "thunder" && wc.kind === "thunder", "kinds");
  ok(!wc.screen && wc.x === 900 && wc.t === close.t, "close: at the strike, on the stroke");
  for ( const lang of ["en", "pl"] ) for ( let s = 0; s < 12; s++ ) {
    const t = V.word(wf.kind, { ...wf.wo, seed: `x${s}`, lang }).text;
    ok(!t.includes("!"), `far rumble without "!": ${t}`);
  }
});

// FAREVERY2: every second far flash is lettered (owner's answer 7), counted the same on every client
group("FAREVERY2", () => {
  const S = { ...SM.DEFAULT, on: true, rate: 30, near: 0, t: 0 }, seed = 1234, rainP = () => 1;
  const list = SM.flashes(S, seed, 0, 600_000, rainP).filter((e) => e.kind === "far");
  ok(list.length > 40, "a storm with many far flashes: " + list.length);
  const before = (k) => list.filter((e) => e.k < k).length;
  const lettered = list.filter((e) => E.farLettered(e, before));
  ok(Math.abs(lettered.length - list.length / 2) <= 1, `half of them: ${lettered.length} of ${list.length}`);
  ok(list.every((e, i) => E.farLettered(e, before) === (i % 2 === 1)), "every second one, alternating");
  ok(E.farLettered({ preview: true, k: 0 }, () => 0), "a GM's preview flash is lettered");
});

// DETONATE: one explosion = one word, once; distinct explosions a few, largest first, a beat apart
group("DETONATE", () => {
  const ev = (key, obj, x, y, r, voice = "blast") => ({ key, obj, voice, x, y, r, t: 5000, box: { x0: x - r, y0: y - r, x1: x + r, y1: y + r } });
  const prio = (v) => SC.VOICES[v]?.prio ?? 0;
  const one = E.detonateComposition([ev("a1", "s1", 500, 500, 150), ev("a2", "s1", 900, 500, 150), ev("a3", "s1", 1300, 500, 150)], { prio });
  ok(one.length === 1, "the areas of one stroke: one word");
  const touch = E.detonateComposition([ev("a", "s1", 500, 500, 150), ev("b", "s2", 760, 500, 150)], { prio });
  ok(touch.length === 1, "two strokes that touch: one explosion");
  const two = E.detonateComposition([ev("a", "s1", 500, 500, 100), ev("b", "s2", 4000, 500, 300)], { prio });
  ok(two.length === 2 && two[0].r > two[1].r && two[1].t - two[0].t === E.DETONATE_BEAT, "two explosions: the largest first, a beat apart");
  ok(two[0].m > two[1].m && two.every((e) => e.det), "the second a notch quieter, both marked");
  const ten = E.detonateComposition(Array.from({ length: 10 }, (_, i) => ev(`k${i}`, `s${i}`, 1000 * i, 0, 100 + 10 * i)), { prio, max: 3 });
  ok(ten.length === 3, "at most three big words");
  const mix = E.detonateComposition([ev("c", "s1", 0, 0, 200, "crack"), ev("f", "s1", 300, 0, 150, "boom")], { prio });
  ok(mix.length === 1 && mix[0].voice === "boom", "one explosion speaks with its loudest sound");
});

// RANK: words sized by rank as a share of the view - monotone, readable at the bottom
group("RANK", () => {
  for ( let r = 1; r < 5; r++ ) ok(E.rankSize(r + 1, 1000) > E.rankSize(r, 1000), `R${r + 1} > R${r}`);
  ok(E.rankSize(1, 1000, 0.8) >= 30, "the smallest word stays at 3 % of the view or more");
  ok(E.rankSize(5, 1000) / E.rankSize(2, 1000) < 3.2, "a fall word is about a third of the biggest");
});

const ENV = { grid: 100, rect: { x: 0, y: 0, width: 6000, height: 4000 }, now: 1_800_000_000_000, wind: { dir: 0, speed: 0.4 } };
function meteorPage() {
  const d = BUILTIN.find((q) => q.id === "meteor"), plan = C.expand(d, { a: [3000, 2000] }, { seed: 11 }, ENV), strokes = new Map(), f = [];
  for ( const b of plan.pending.burst ?? [] ) { const st = { id: `f-burst.${b.id}`, k: "burst", p: [b.x, b.y], r: b.r, lv: b.lv, q: Math.round(plan.t0 + (b.at ?? 0)) }; strokes.set(st.id, st); f.push({ id: st.id }); }
  for ( const r of plan.fire ) { const st = { id: `f-${r.key}`, ...r }; strokes.set(st.id, st); f.push({ id: st.id }); }
  const rec = { id: "fid-meteor", preset: "meteor", t0: plan.t0, seed: plan.seed, size: plan.size, power: plan.power, at: plan.at, dir: plan.dir, d: [], f, pending: { ...plan.pending, burst: [] } };
  return P.firingPage(rec, { grid: 100, strokes, wayOf: MC.wayOf, headAt: MC.headAt, fallAt, lift: 0.5 });
}
// METEOR: the descent BUILDS (a thin far whine, then the bigger roar of the last rush), the rumble and the ejecta read
group("METEOR", () => {
  const pg = meteorPage(), pre = pg.words.filter((w) => w.role === "pre");
  const rides = pre.filter((w) => w.ride).sort((a, b) => a.t - b.t);
  ok(rides.length === 2, "two descent words: " + rides.map((w) => w.key));
  ok(rides[1].rank > rides[0].rank && rides[1].wo.loud > rides[0].wo.loud, "the second is bigger and louder");
  ok(rides[0].t + rides[0].ms <= rides[1].t + 1, "the first hands over to the second");
  const t = rides.map((w) => V.word(w.kind, { ...w.wo, seed: "x", lang: "en" }).text);
  ok(t[0] !== t[1], "different words: " + t.join(" -> "));
  ok(pre.find((w) => w.kind === "rumble")?.rank >= 2, "the ground's rumble is readable (R2)");
  const falls = pg.words.filter((w) => w.role === "fall");
  ok(falls.length >= 4 && falls.every((w) => E.rankSize(w.rank, 1000, w.shrink) >= 30), "every ejecta word at 3 % of the view or more: " + falls.map((w) => `${w.rank}x${w.shrink.toFixed(2)}`));
  ok(falls.every((w, i) => !i || E.rankSize(w.rank, 1000, w.shrink) <= E.rankSize(falls[i - 1].rank, 1000, falls[i - 1].shrink) + 1e-9), "big to small");
});

// BRUSH: each type and cause on its own (SPEC-EFFECTS 3.1 / 3.2) - a cause never replaces the ground's big sound; a scorch hisses; a big
// blast or cave-in drops debris after it, by the ground's material
group("BRUSH", () => {
  ok(SC.destrVoice("collapse", "fire") === "cavein" && SC.destrVoice("collapse", "acid") === "cavein" && SC.destrVoice("collapse", "claws") === "cavein", "a cave-in stays a cave-in whatever its cause");
  ok(SC.destrVoice("blast", "acid") === "blast" && SC.destrVoice("blast", "claws") === "blast" && SC.destrVoice("blast", "fire") === "boom", "a blast stays a blast (with fire: the boom)");
  ok(SC.destrVoice("cracks", "fire") === "crack" && SC.destrVoice("flood", "fire") === "splash" && SC.destrVoice("gash", "claws") === "slash", "the smaller damage keeps its own sound");
  ok(SC.kindOf("scorch", KINDS) === "hiss", "a scorch mark hisses (FSSHHH), not a blaze's roar");
  const I = (r) => ({ type: "blast", cause: 0, mat: 2, rect: { x0: 0, y0: 0, x1: 2 * r, y1: 2 * r }, w: 2 * r, h: 2 * r, ex: r, ey: r });
  const e = (r) => SC.entryEvent(I(r), { x: 0, y: 0 }, 1, 1000, { key: `k${r}`, objId: "d1" });
  ok(SC.brushFalls(e(40), 100).length === 0, "a small blast throws no debris words");
  const f1 = SC.brushFalls(e(150), 100), f2 = SC.brushFalls(e(300), 100);
  ok(f1.length === 1 && f2.length === 2, "one landing, two for a big one");
  ok(f1.every((q) => q.voice === "debris" && q.phase && q.t >= 1000 + 450 && q.mat === "stone" && q.obj === "d1"), "after the blast, a phase of the same stroke, on its ground");
  ok(f2[1].t > f2[0].t && f2[1].m < f2[0].m, "the second later and smaller");
  ok(SC.isEcho({ members: f1, main: f1[0], t: f1[0].t, x: f1[0].x, y: f1[0].y, span: 50 }, [{ x: 150, y: 150, reach: 900, t: 1000, prio: 10 }], 100) === false, "never swallowed as the blast's echo");
  const w = (mat) => V.word("debris", { ...SC.wordOpts({ voice: "debris", kind: "debris", loud: 0.42, emat: SC.engineMatOf("debris", mat) }), seed: "x", lang: "en" }).text;
  ok(w("stone") !== w("water"), `the ground changes the sound: ${w("stone")} / ${w("water")} / ${w("wood")}`);
});

// WIRE: the runtime hears a Detonate whole, a plough's record, the lightning; ranked words sized by rank
group("WIRE", () => {
  const sfx = src("sfx/sfx.mjs"), disp = src("destruction/display.mjs"), des = src("destruction/destruction.mjs"), bus = src("sfx/bus.mjs");
  ok(/detonate:\s*null/.test(bus), "the bus has a detonate hook");
  ok(/detonate\(start\)\s*\{[^}]*sfxBus\.detonate\?\.\(this,\s*start\)/.test(disp), "display.detonate tells the sfx first");
  ok(/ploughOf:\s*\(id\)/.test(des), "the carry hooks give a plough's record");
  ok(/detonating && Math\.abs\(start - detonating\.start\)/.test(sfx) && /onPlough\(d, g, start\)/.test(sfx), "entries of a Detonate and of a plough are not lettered one by one");
  ok(sfx.indexOf("onPlough(d, g, start)") < sfx.indexOf("owned.d.has(g.objId)"), "checked before the firing pages");
  ok(/stormDisplay\?\.\(\)/.test(sfx) && /farLettered/.test(sfx), "the lightning is read from the storm shown here");
  ok(/EV\.rankSize\(w\.rank/.test(sfx) && /ceilK: 1/.test(sfx), "ranked words get their size and no second ceiling");
  ok(/!g\.main\.det && C\.isEcho/.test(sfx), "a Detonate's composed words are not swallowed as echoes");
  ok(/C\.brushFalls\(ev,/.test(sfx), "a brush area's debris falls are added after it");
  // (live, meteor film 1: four debris words dropped under the main word and the wave; the rumble stood under the blast)
  ok(/PG\.pickSpots\(w, view\(\)/.test(sfx) && /for \( const s of alts \)/.test(sfx), "a covered debris word tries the next landing in view");
  ok(/!placed\.length && w0\.cands && waited < PG\.FALL_WAIT_MS/.test(sfx) && P.FALL_WAIT_MS >= 500 && P.FALL_WAIT_MS <= 1500, "a still covered debris word waits for room a moment, then is dropped");
  ok(/else if \( w\.role === "pre" \) \{[\s\S]{0,400}spec\.stopAt = toPerf\(mw\.t\) \+ 40/.test(sfx), "a standing pre word yields when the main word lands");
});

group("RIDEVIEW", () => {
  const v = { x0: 0, y0: 0, x1: 1000, y1: 600 };
  const r = P.rideInView([{ x: 500, y: -400, ms: 0 }, { x: 520, y: 100, ms: 300 }, { x: 540, y: 300, ms: 600 }], v, 200, 60);
  ok(r[0].y >= 45 && r[0].x === 500 && r[0].ms === 0, "a ride from above the screen starts at its top edge, whole");
  ok(r[1].y === 100 && r[2].y === 300, "the way inside the view is kept");
  ok(P.rideInView([{ x: -50, y: 300 }], v, 200, 60)[0].x >= 110, "the same at a side edge");
  ok(/PG\.rideInView\(spec\.path, view\(\)/.test(src("sfx/sfx.mjs")), "pre rides are kept in view where they play");
  ok(/w\.voice === "cavein" \? \{ \.\.\.w\.box, y1: w\.box\.y1 \+ \(w\.box\.y1 - w\.box\.y0\) \* 0\.5 \}/.test(src("sfx/sfx.mjs")), "a cave-in word covers where it sinks to");
});

group("SPOTS", () => {
  const v = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
  const w = { x: 500, y: 500, t: 1400, cands: [{ x: 100, y: 100, ms: 300 }, { x: 900, y: 900, ms: 420 }, { x: 5000, y: 0, ms: 400 }, { x: 500, y: 500, ms: 400 }] };
  const s = P.pickSpots(w, v, new Set(), 1000, 6);
  ok(s.length === 3 && s[0].x === 500 && s[1].x === 900 && s[2].x === 100, "own spot first, then landings in view nearest in time, no repeats, none out of view");
  ok(P.pickSpot(w, v, new Set(["500,500"]), 1000).x === 900, "a used spot is skipped");
  ok(P.pickSpots(w, v, new Set(), 1000, 2).length === 2, "at most n");
});

if ( failed.length ) { console.log(failed.join("\n")); console.log(`sfx-effects2: ${failed.length} group(s) failed, ${n} checks passed`); process.exit(1); }
console.log(`sfx-effects2: all groups pass (${n} checks)`);
