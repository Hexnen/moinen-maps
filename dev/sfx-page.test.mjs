// EFFECTS1: the page of a preset firing (scripts/sfx/sfx-page.mjs, SPEC-EFFECTS 3.4 + the owner's answers). Records are built the way
// presets/write.mjs builds them (core.mjs expand, debris fires timed by their chunk's flight, the burst a fire-layer stroke with its db).
// Each group fails on the build before EFFECTS1 (no sfx-page.mjs: the import fails) and names what it holds.
import assert from "node:assert/strict";
import fs from "node:fs";
import * as C from "../scripts/presets/core.mjs";
import { BUILTIN } from "../scripts/presets/defs.mjs";
import * as FM from "../scripts/fire/model.mjs";
import * as MC from "../scripts/presets/meteor-core.mjs";
import { fallAt } from "../scripts/presets/landing-fx.mjs";
import * as P from "../scripts/sfx/sfx-page.mjs";
import { createVocab } from "../scripts/letters/words.mjs";
import * as SC from "../scripts/sfx/sfx-core.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const failed = [];
const group = (id, fn) => { try { fn(); } catch ( err ) { failed.push(`${id}: ${String(err?.message ?? err).split(/\r?\n/)[0]}`); } };
const V = createVocab(), KINDS = new Set(V.list("en").map((k) => k.id));
const ENV = { grid: 100, rect: { x: 0, y: 0, width: 6000, height: 4000 }, now: 1_800_000_000_000, wind: { dir: 0, speed: 0.4 } };
const GEST = { point: { a: [3000, 2000] }, throw: { a: [2400, 2000], b: [3000, 2100] }, shot: { a: [2400, 2000], b: [3000, 2200], from: [2400, 2000], fr: 50 }, line: { a: [2400, 1900], b: [3200, 2100] }, run: { a: [1600, 2000], b: [3400, 2000] } };
const def = (id) => BUILTIN.find((d) => d.id === id);

/** a firing record + its fire-layer strokes, as presets/write.mjs makes them (ids = the plan keys) */
function fire(id, opts = {}, g = null) {
  const d = def(id), plan = C.expand(d, g ?? GEST[d.gesture], { seed: 11, ...opts }, ENV), grid = 100, strokes = new Map(), f = [];
  const b0 = plan.pending.burst?.[0];
  for ( const r of plan.fire ) {
    const rec = { ...r };
    if ( b0 && /^debris\./.test(rec.key ?? "") ) {
      const dd = Math.hypot(rec.p[0] - b0.x, rec.p[1] - b0.y), j = (FM.hash4(plan.seed, dd | 0, 3) - 0.5) * 160;
      const q = Math.round(plan.t0 + (b0.at ?? 0) + Math.min(1600, 280 + 520 * Math.sqrt(dd / grid) + j)), dq = q - rec.q;
      rec.q = q; if ( rec.o !== undefined ) rec.o += dq;
    }
    const st = { id: `f-${rec.key}`, ...rec }; strokes.set(st.id, st); f.push({ id: st.id, key: rec.key });
  }
  const debris = plan.fire.filter((r) => /^debris\./.test(r.key ?? ""));
  for ( const b of plan.pending.burst ?? [] ) {
    const q = Math.round(plan.t0 + (b.at ?? 0));
    const db = debris.filter((r) => r.q >= q).map((r) => [r.p[0] - b.x, r.p[1] - b.y, r.q - q]).flat();
    const st = { id: `f-burst.${b.id}`, k: "burst", p: [b.x, b.y], r: b.r, lv: b.lv, q, wd: 0, ws: 0.4, ...(db.length ? { db } : {}) };
    strokes.set(st.id, st); f.push({ id: st.id, key: `burst.${b.id}` });
  }
  const rec = { id: `fid-${id}`, preset: id, t0: plan.t0, seed: plan.seed, size: plan.size, power: plan.power, at: plan.at, dir: plan.dir, gesture: plan.gesture, walk: plan.walk,
    d: plan.destruction.map((r, i) => ({ id: `d${i}`, key: r.key, at: Math.round(plan.t0 + (r.at ?? 0)) })), f, pending: { ...plan.pending, burst: [] } };
  return { rec, strokes, plan };
}
const page = (id, opts, g) => { const F = fire(id, opts, g); return { ...F, pg: P.firingPage(F.rec, { grid: 100, strokes: F.strokes, wayOf: MC.wayOf, headAt: MC.headAt, fallAt, lift: 0.5 }) }; };
const roles = (pg, r) => pg.words.filter((w) => w.role === r);
const word = (w, lang = "en", seed = "s") => V.word(w.kind, { ...w.wo, material: P.materialFor(w.wo, "earth"), lang, seed: w.seed ?? seed });

// ONE: one explosion = one word, once - a bomb firing has exactly one MAIN word, and its crater / lobes / burst / shock strokes
// enter silently (they are the page)
group("ONE", () => {
  const { pg, rec } = page("bomb");
  ok(roles(pg, "main").length === 1, "one main word");
  ok(rec.d.every((d) => pg.owned.d.has(d.id)), "every destruction stroke of the firing is part of the page");
  ok([...pg.owned.f].some((id) => /burst/.test(id)) && [...pg.owned.f].some((id) => /shock/.test(id)), "burst and shock strokes are lettered by the page");
  ok(pg.words.every((w) => KINDS.has(w.kind)), "every kind is the engine's: " + pg.words.map((w) => w.kind).join(","));
});
// STORY: the page tells the bomb's story in order (owner's 8b): fall (pre) -> blast (main) -> wave -> debris falling big to small ->
// a fire catching -> the fires dying; each phase a different word, the debris resolving (large, medium, small pieces)
group("STORY", () => {
  const { pg } = page("bomb");
  const pre = roles(pg, "pre")[0], main = roles(pg, "main")[0], wave = roles(pg, "wave")[0], falls = roles(pg, "fall"), c = roles(pg, "catch")[0], outs = roles(pg, "out");
  ok(pre && main && wave && falls.length === 3 && c && outs.length >= 2, "bomb has pre, main, wave, 3 falls, a catch, hisses");
  ok(pre.t + pre.ms <= main.t - P.PRE_GAP + 1, "the whistle is gone before the flash frame");
  ok(wave.t > main.t && falls.every((f) => f.t >= main.t + 380), "wave and debris after the blast");
  ok(falls.map((f) => f.wo.pieces).join() === "large,medium,small", "debris resolves big to small: " + falls.map((f) => f.wo.pieces).join());
  ok(falls.every((f, i) => !i || f.t > falls[i - 1].t), "debris words one after another");
  const texts = falls.map((f) => word(f).text);
  ok(new Set(texts).size === texts.length, "the debris words of one bomb differ (FXLM2 leftover): " + texts.join(" "));
  ok(P.pageMag(main) > P.pageMag(wave) && P.pageMag(wave) > P.pageMag(falls[0]) && P.pageMag(falls[0]) > P.pageMag(outs[0]), "sizes build down from the main word");
  ok(main.kind === "boom", "a bomb (a blast with fire) is the boom kind (BOOM / BUM family): " + word(main).text);
});
// FIRELESS: owner's answer 3 - a hero landing is THOOM / DUUM (thud), not BOOM; a strike is thunder; a grenade its own kind
group("FIRELESS", () => {
  ok(roles(page("landing").pg, "main")[0]?.kind === "thud", "hero landing = thud");
  ok(!/BOOM|BUUM/.test(word(roles(page("landing").pg, "main")[0]).text), "no BOOM for the landing");
  ok(roles(page("lightning").pg, "main")[0]?.kind === "thunder", "strike = thunder");
  ok(roles(page("grenade").pg, "main")[0]?.kind === "grenade", "grenade = grenade kind");
});
// PREROLL: the pre-rolls are lettered (FXLM2 leftover): bomb fall, rocket flight (and launch with a shooter), meteor descent + rumble,
// grenade bounce (two ticks), the strike's charge (three ticks, growing), the hero's fall; each gone before the main word's frame
group("PREROLL", () => {
  const pre = (id, o, g) => roles(page(id, o, g).pg, "pre");
  ok(pre("bomb").some((w) => w.kind === "zoom" && w.ride?.length > 1), "bomb fall rides");
  ok(pre("rocket").some((w) => w.kind === "rocket" && w.ride), "rocket flight rides (no shooter)");
  ok(pre("rocket", {}, GEST.shot).some((w) => w.key === "pre|launch"), "a shot rocket letters its launch at the tube");
  const m = pre("meteor");
  ok(m.some((w) => w.kind === "zoom" && w.ride) && m.some((w) => w.kind === "rumble"), "meteor descent + rumble");
  ok(pre("grenade").filter((w) => /bounce/.test(w.key)).length === 2, "grenade bounces twice");
  const ch = pre("lightning").filter((w) => /charge/.test(w.key));
  ok(ch.length === 3 && ch[0].wo.long < ch[2].wo.long, "charge ticks grow");
  ok(pre("landing").some((w) => w.kind === "zoom" && w.ride), "hero fall rides");
  for ( const id of ["bomb", "rocket", "meteor", "landing"] ) {
    const { pg } = page(id), main = roles(pg, "main")[0];
    for ( const w of roles(pg, "pre").filter((q) => q.ride) ) ok(w.t + w.ms <= main.t - P.PRE_GAP + 1, `${id} ${w.key} gone before the main frame`);
  }
});
// EJECTA: the meteor's ejecta letter five landings (first, last, three between), big to small - the pocks themselves are silent
group("EJECTA", () => {
  const { pg, rec } = page("meteor");
  const f = roles(pg, "fall");
  ok(f.length === 5, "five ejecta words");
  ok(f[0].wo.pieces === "large" && f.at(-1).wo.pieces === "small", "big to small");
  ok(rec.d.filter((d) => /ejecta/.test(d.key)).every((d) => pg.owned.d.has(d.id)), "ejecta pocks are part of the page (no thud per pock)");
  ok(roles(pg, "main")[0].rank === 5, "the meteor is the biggest word (R5)");
});
// OUTS: owner's answer 5 - the fires of one firing dying one by one: hisses composed (fewer than the fires, at least OUT_GAP apart,
// the first and the last, alternating sides, each smaller, the last the longest)
group("OUTS", () => {
  const fires = Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, k: "fire", p: [i * 100, 0, i * 100 + 50, 0], q: 0, o: 10000 + i * 1500 + (i % 3) * 200, r: 30 }));
  const h = P.arrangeOuts(fires, { seed: "s" });
  ok(h.length >= 3 && h.length <= P.OUT_MAX, "a few hisses, not one per fire: " + h.length);
  ok(h[0].id === "x0" && h.at(-1).id === "x8", "the first and the last fire");
  ok(h.every((w, i) => !i || w.t - h[i - 1].t >= Math.min(P.OUT_GAP, 800)), "spaced");
  ok(h.every((w, i) => !i || w.side === -h[i - 1].side), "alternating sides");
  ok(h.every((w, i) => !i || (w.shrink < h[i - 1].shrink && w.wo.long >= h[i - 1].wo.long)), "each smaller and longer");
  ok(/…$/.test(V.word("fire", { ...h.at(-1).wo, lang: "en", seed: "a" }).text), "the last trails off");
  const { pg } = page("bomb");
  ok(roles(pg, "out").length <= P.OUT_MAX && roles(pg, "catch").length === 1, "a bomb's fires: one catch, a few hisses");
});
// SAMESEAT: the page is a pure function of the record (every seat letters the same words at the same moments)
group("SAMESEAT", () => {
  const a = page("meteor").pg, b = page("meteor").pg;
  ok(JSON.stringify(a.words) === JSON.stringify(b.words), "same record, same page");
});
// GUNS: a gun firing has no explosion page (its report and impacts are lettered by the walk), nothing owned
group("GUNS", () => {
  const { pg } = page("uzi", {}, GEST.line);
  ok(pg.words.length === 0 && pg.owned.d.size === 0, "uzi: no page");
});
// SOURCE: sfx.mjs plays the page (the firing hook) and leaves the owned strokes silent
group("WIRE", () => {
  const s = fs.readFileSync(new URL("../scripts/sfx/sfx.mjs", import.meta.url), "utf8");
  ok(/firingPage\(/.test(s), "sfx.mjs plans firing pages");
  ok(/owned/.test(s), "sfx.mjs keeps owned strokes silent");
});

// MUZZLE: the report's syllables start clear of the shooter's token (FXLM2 leftover: they touched its top)
group("MUZZLE", () => {
  const it = { kind: "muzzle", from: [0, 0], fr: 50, hits: [[0, 1600, 500, 0], [100, 1600, 600, 0]] };
  const me = SC.muzzleEvent(it, { t0: 0, grid: 100, muzzleOf: (a, h) => { const d = Math.hypot(h[0], h[1]); return { x: (h[0] / d) * 42, y: (h[1] / d) * 42, L: d - 42 }; },
    flight: () => 100, key: "m", sid: "m" });
  ok(me.path.every((q) => Math.hypot(q.x, q.y) >= 50 + 100 * SC.MUZZLE_CLEAR), "every syllable starts off the token: " + me.path.map((q) => Math.round(Math.hypot(q.x, q.y))).join(","));
});
// BRUSH: owner's answer 3 on the brush: a blast without fire is the dry blast (KROOM / KRUUM), never BOOM; with fire BOOM; a cave-in
// BTHOOM (en, the engine's own template); debris and rounds land by material (engine 1.7.1)
group("BRUSH", () => {
  ok(SC.kindOf(SC.destrVoice("blast", 0), KINDS) === "concussion", "fireless brush blast = concussion");
  const t = new Set(); for ( let i = 0; i < 12; i++ ) t.add(V.word("concussion", { loud: 0.8, lang: "en", seed: `b${i}` }).text + V.word("concussion", { loud: 0.8, lang: "pl", seed: `b${i}` }).text);
  ok([...t].every((x) => !/BO+M|BU+M/.test(x)), "no BOOM / BUM: " + [...t].slice(0, 4).join(" "));
  ok(SC.destrVoice("blast", 1) === "boom", "a fire blast stays the boom");
  const cv = SC.wordOpts({ voice: "cavein", kind: "crash", loud: 0.7, lang: "en" });
  ok(cv.kind === "boom" && cv.template === "BTHOOM" && /BTHO+M/.test(V.word(cv.kind, { loud: 0.7, template: cv.template, lang: "en", seed: "c" }).text), "a cave-in letters BTHOOM");
  ok(SC.wordOpts({ voice: "gunhit", kind: "impact", loud: 0.4, emat: "metal" }).material === "metal", "rounds hit by material");
  ok(SC.wordOpts({ voice: "out", kind: "fire", loud: 0.3 }).stage === "out" && SC.wordOpts({ voice: "fire", kind: "fire", loud: 0.3 }).stage === "ignite", "the fire ladder: ignite, out");
});
// UNLOCATED: owner's answers 2 and 4 - a gun with no source token, or a source this client cannot see, is heard generally on screen
group("UNLOCATED", () => {
  const s = fs.readFileSync(new URL("../scripts/sfx/sfx.mjs", import.meta.url), "utf8");
  ok(/function screenReport\(/.test(s) && /space: "screen"/.test(s), "a screen report exists");
  ok(/!reported && hits\.length/.test(s), "no shooter: the report is shown on screen");
  ok(/!shooterSeen\(it\.from, it\.fr\)/.test(s), "hidden shooter: on screen, not at its place");
  ok(/if \( !hereVisible\(w\.x, w\.y\) \) \{ playScreen\(spec\)/.test(s), "page words under a player's fog: on screen");
});
if ( process.env.DBG ) { const { pg } = page(process.env.DBG); for ( const w of pg.words ) console.log(w.role, w.key, w.kind, JSON.stringify(w.wo), Math.round(w.t - pg.words.find((q) => q.role === "main").t), w.rank, P.pageMag(w), word(w).text, word(w, "pl").text); }
if ( failed.length ) { console.log(failed.join("\n")); console.log(`sfx-page: ${failed.length} group(s) failed, ${n} checks passed`); process.exit(1); }
console.log(`sfx-page: ${n} checks passed`);
