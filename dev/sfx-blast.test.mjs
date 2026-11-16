// MAPBLAST: a map blast's impact frame (scripts/sfx/sfx-blast.mjs + its wiring in scripts/sfx/sfx.mjs), on the real presets, the real
// pages and the real lettering engine (scripts/letters, read only). Each group names what it holds:
//   PRESET   the built-in presets, fired the way presets/write.mjs fires them: which get a frame and at which of the engine's steps
//            (a grenade a panel, a shell a slam, a bomb more, the meteor the top; a lightning strike and a gun none)
//   KINDS    a landing is its own kind, a wave alone is quiet, a painted blast is sized by its radius, a dab has none
//   VOLLEY   of blasts following each other only the first is drawn at strength; order of arrival does not matter; a later blast never
//            changes an earlier answer; no run of equal slams
//   CALL     the engine call: one seed per blast and scene, a seat can only lower
//   ENGINE   on the engine itself: the steps this file assumes, a quiet blast changes nothing of the scene and holds nothing, a lead at
//            most two flash drawings, a volley of three spends no more flash than one blast, the word joins `keep` AFTER the call
//   WORD     the lead's main word plays without its own flash accent (the table option), its contact known ahead from the measure
//   WIRING   sfx.mjs calls it where it must and under the table's switches
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as C from "../scripts/presets/core.mjs";
import { BUILTIN } from "../scripts/presets/defs.mjs";
import * as MC from "../scripts/presets/meteor-core.mjs";
import { fallAt } from "../scripts/presets/landing-fx.mjs";
import * as P from "../scripts/sfx/sfx-page.mjs";
import * as BL from "../scripts/sfx/sfx-blast.mjs";
import * as T from "../scripts/sfx/sfx-table.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const failed = [];
const group = async (id, fn) => { try { await fn(); } catch ( err ) { failed.push(`${id}: ${String(err?.message ?? err).split(/\r?\n/)[0]}`); } };

const ENV = { grid: 100, rect: { x: 0, y: 0, width: 6000, height: 4000 }, now: 1_800_000_000_000, wind: { dir: 0, speed: 0.4 } };
const GEST = { point: { a: [3000, 2000] }, throw: { a: [2400, 2000], b: [3000, 2100] }, shot: { a: [2400, 2000], b: [3000, 2200], from: [2400, 2000], fr: 50 }, line: { a: [2400, 1900], b: [3200, 2100] }, run: { a: [1600, 2000], b: [3400, 2000] } };
/** a firing record + its fire-layer strokes, as presets/write.mjs makes them (dev/sfx-page.test.mjs builds them the same way) */
function fire(id, opts = {}) {
  const d = BUILTIN.find((q) => q.id === id), plan = C.expand(d, GEST[d.gesture], { seed: 11, ...opts }, ENV), strokes = new Map(), f = [];
  for ( const r of plan.fire ) { const st = { id: `f-${r.key}`, ...r }; strokes.set(st.id, st); f.push({ id: st.id, key: r.key }); }
  for ( const b of plan.pending.burst ?? [] ) {
    const st = { id: `f-burst.${b.id}`, k: "burst", p: [b.x, b.y], r: b.r, lv: b.lv, q: Math.round(plan.t0 + (b.at ?? 0)), wd: 0, ws: 0.4 };
    strokes.set(st.id, st); f.push({ id: st.id, key: `burst.${b.id}` });
  }
  const rec = { id: `fid-${id}`, preset: id, t0: plan.t0, seed: plan.seed, size: plan.size, power: plan.power, at: plan.at, dir: plan.dir, gesture: plan.gesture, walk: plan.walk,
    d: plan.destruction.map((r, i) => ({ id: `d${i}`, key: r.key, at: Math.round(plan.t0 + (r.at ?? 0)) })), f, pending: { ...plan.pending, burst: [] } };
  const pg = P.firingPage(rec, { grid: 100, strokes, wayOf: MC.wayOf, headAt: MC.headAt, fallAt, lift: 0.5 });
  return { rec, pg, bl: BL.blastOfPage(pg, rec, 100) };
}
const fakePage = (w) => ({ words: [{ role: "pre", kind: "whistle", x: 0, y: 0, t: 0 }, { role: "main", key: "main", x: 1000, y: 800, r: 100, t: 5000, rank: 4, ...w }] });

await group("PRESET", () => {
  const want = { grenade: 2, rocket: 3, bomb: 4, meteor: 5 };
  for ( const [id, step] of Object.entries(want) ) for ( const size of [0.5, 1, 2] ) {
    const { rec, pg, bl } = fire(id, { size });
    const main = pg.words.find((w) => w.role === "main");
    ok(bl && bl.kind === "blast", `${id} x${size}: a blast frame (${JSON.stringify(bl)})`);
    // (the page lowers a small shell's rank - sfx-page: a bomb or rocket at half size is a notch down; the frame follows the word)
    const exp = id === "meteor" ? 5 : main.rank >= 5 ? 4 : main.rank === 4 ? 3 : 2;
    ok(BL.stepOf(bl.magnitude) === exp, `${id} x${size}: the frame's step ${BL.stepOf(bl.magnitude)} follows the word's rank ${main.rank} (want ${exp})`);
    if ( size === 1 ) ok(BL.stepOf(bl.magnitude) === step, `${id}: step ${step} at its own size (${bl.magnitude})`);
    ok(bl.x === main.x && bl.y === main.y && bl.t === main.t && bl.r === main.r && bl.id === `pg|${rec.id}`, `${id} x${size}: the place, radius and moment are the main word's`);
    ok(bl.shake === (rec.pending?.cue ?? []).some((c) => c.kind === "screen" && c.shake > 0), `${id}: knows the firing's own screen shake`);
    ok(!bl.soft, `${id}: may lead`);
  }
  // bigger is never weaker
  const mags = ["grenade", "rocket", "bomb", "meteor"].map((id) => fire(id).bl.magnitude);
  ok(mags.every((m, i) => i === 0 || m > mags[i - 1]), `the bigger blast has the stronger frame (${mags})`);
  ok(fire("grenade", { size: 2 }).bl.magnitude >= fire("grenade", { size: 0.5 }).bl.magnitude, "a wider grenade is not weaker");
  ok(Number.isFinite(fire("rocket").bl.dir), "a rocket's frame knows the way it came in");
  ok(fire("lightning").pg.main === "thunder" && fire("lightning").bl === null, "a lightning strike has no impact frame (its own light)");
  for ( const id of ["uzi", "heliHmg"] ) ok(fire(id).bl === null, `${id}: a gun has no blast frame`);
});

await group("KINDS", () => {
  const rec = { id: "x", pending: {} };
  const land = BL.blastOfPage(fakePage({ kind: "thud", r: 70 }), rec, 100);
  ok(land.kind === "landing" && BL.stepOf(land.magnitude) === 3 && land.dir === 90, `a landing: its own kind, a slam, into the ground (${JSON.stringify(land)})`);
  ok(BL.blastOfPage(fakePage({ kind: "thud", way: { ux: 1, uy: 0 } }), rec, 100).dir === 0, "a landing with a way takes it");
  const wave = BL.blastOfPage(fakePage({ kind: "shockwave", rank: 3 }), rec, 100);
  ok(wave.soft && wave.magnitude === BL.QUIET && BL.stepOf(wave.magnitude) === 1, "a wave alone is quiet");
  ok(BL.blastOfPage(fakePage({ kind: "thunder", rank: 5 }), rec, 100) === null && BL.blastOfPage({ words: [] }, rec, 100) === null && BL.blastOfPage(fakePage({ kind: "boom" }), null, 100) === null, "no frame without a blast");
  ok(BL.blastOfPage(fakePage({ kind: "boom", rank: 5 }), { id: "y", pending: { cue: [{ kind: "screen", shake: 0.9, flash: 0.6 }] } }, 100).shake === true, "the firing's own shake is read from its record");
  const mom = (r, voice = "blast") => BL.blastOfMoment({ id: "s", voice, x: 10, y: 20, r, t: 1000 }, 100);
  ok(mom(50) === null && mom(59) === null, "a dab of the blast brush has no frame");
  ok([mom(60), mom(119), mom(120), mom(219), mom(220), mom(900)].map((b) => BL.stepOf(b.magnitude)).join() === "2,2,3,3,4,4", "a painted blast's step follows its radius; the top step is the meteor's alone");
  ok(mom(150, "boom")?.kind === "blast" && mom(300, "cavein") === null && mom(300, "fire") === null && mom(300, "thunder") === null, "only the explosion voices");
  ok(mom(150).id === "m|s" && mom(150).x === 10 && mom(150).t === 1000, "its id, place and moment");
  for ( const r of [60, 100, 119, 120, 200, 219, 220, 400, 3000] ) ok(mom(r).magnitude <= 1.7 - 1e-9, `r ${r}: under the top step`);
});

await group("VOLLEY", () => {
  const B = (id, t, magnitude = 1.1, soft = false) => ({ id, t, magnitude, soft });
  const three = [B("a", 1000), B("b", 1300), B("c", 1600)];
  const v = BL.volley(three);
  ok(v.get("a") === "lead" && v.get("b") === "quiet" && v.get("c") === "quiet", "a volley of three: one lead, two quiet");
  for ( const perm of [[2, 1, 0], [1, 2, 0], [0, 2, 1]] ) { const w = BL.volley(perm.map((i) => three[i])); ok(["a", "b", "c"].every((k) => w.get(k) === v.get(k)), `the order they arrive in does not matter (${perm})`); }
  ok(BL.volley([B("b", 1000), B("a", 1000)]).get("a") === "lead" && BL.volley([B("b", 1000), B("a", 1000)]).get("b") === "quiet", "the same moment: by id");
  ok(BL.volley([B("a", 1000), B("b", 1000 + BL.VOLLEY_MS)]).get("b") === "lead" && BL.volley([B("a", 1000), B("b", 999 + BL.VOLLEY_MS)]).get("b") === "quiet", "the window's edge");
  ok(BL.volley([B("a", 1000, 0.7), B("b", 1400, 1.5)]).get("b") === "lead", "a blast a whole step stronger leads again");
  ok(BL.volley([B("a", 1000, 1.0), B("b", 1400, 1.3)]).get("b") === "quiet", "stronger inside the same step: quiet");
  ok(BL.volley([B("w", 1000, 0.5, true)]).get("w") === "quiet" && BL.volley([B("w", 1000, 0.5, true), B("a", 1200)]).get("a") === "lead", "a soft one never leads and opens no volley");
  // (a quiet one does not push the window on: the fourth, 2.6 s after the lead, leads)
  ok(BL.volley([B("a", 0), B("b", 1000), B("c", 2000), B("d", 2600)]).get("d") === "lead", "the window is counted from the lead");
  // (a place that blows again: the same id at another moment is another blast of the volley)
  { const known = [{ id: "m|x", of: "m|x", t: 1000, magnitude: 1.45, soft: false }];
    ok(BL.noteKey([], { id: "m|x", t: 1000 }) === "m|x" && BL.noteKey(known, { id: "m|x", t: 1000 + BL.SAME_MS }) === "m|x", "one blast told twice keeps its name");
    const k2 = BL.noteKey(known, { id: "m|x", t: 2000 });
    ok(k2 !== "m|x" && BL.noteKey([...known, { id: k2, of: "m|x", t: 2000 }], { id: "m|x", t: 2010 }) === k2, "the same id a second later is another blast, and is told twice alike");
    ok(BL.volley([...known, { id: k2, of: "m|x", t: 2000, magnitude: 1.45, soft: false }]).get(k2) === "quiet", "the place blowing again inside the window is a follower"); }
  // a later blast never changes an earlier answer; no two leads of the same step within one window
  let s = 7; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for ( let run = 0; run < 60; run++ ) {
    const list = []; let t = 0;
    for ( let i = 0; i < 14; i++ ) { t += Math.round(rnd() * 1800); list.push(B(`b${i}`, t, [0.7, 1.1, 1.5, 1.85][Math.floor(rnd() * 4)], rnd() < 0.1)); }
    const full = BL.volley(list);
    for ( let k = 1; k < list.length; k++ ) { const part = BL.volley(list.slice(0, k)); ok(list.slice(0, k).every((b) => part.get(b.id) === full.get(b.id)), `run ${run}: the first ${k} decided alike without the later ones`); }
    const leads = list.filter((b) => full.get(b.id) === "lead");
    for ( let i = 1; i < leads.length; i++ ) if ( leads[i].t - leads[i - 1].t < BL.VOLLEY_MS ) ok(BL.stepOf(leads[i].magnitude) > BL.stepOf(leads[i - 1].magnitude), `run ${run}: a lead inside the window is a step stronger`);
    for ( const a of leads ) ok(leads.filter((b) => b.t >= a.t && b.t < a.t + BL.VOLLEY_MS).length <= 4, `run ${run}: at most one lead per step in a window`);
    ok(list.filter((b) => b.soft).every((b) => full.get(b.id) === "quiet"), `run ${run}: soft ones quiet`);
  }
  ok(BL.drawnMag(B("a", 0, 1.5), true) === 1.5 && BL.drawnMag(B("a", 0, 1.5), false) === BL.QUIET && BL.drawnMag(B("a", 0, 0.4), false) === 0.4, "a follower is drawn at the quiet strength at most");
});

await group("CALL", () => {
  const b = { id: "pg|f1", kind: "blast", magnitude: 1.5, x: 100, y: 200, r: 160, t: 5000, dir: 30, shake: true, soft: false };
  const keep = [];
  const s = BL.specOf(b, { lead: true, sceneId: "S", blowAt: 777, keep });
  ok(s.kind === "blast" && s.magnitude === 1.5 && s.subject.x === 100 && s.subject.y === 200 && s.space === "world" && s.area === 160 && s.dir === 30 && s.blowAt === 777 && s.keep === keep, "the table's part of the call");
  ok(s.seed === "mapblast|S|pg|f1" && BL.specOf({ ...b, id: "pg|f2" }, { sceneId: "S" }).seed !== s.seed && BL.specOf(b, { sceneId: "Z" }).seed !== s.seed, "one seed per blast and scene, nothing of the seat in it");
  ok(s.punch === false, "a firing that shakes the screen itself is not shoved again");
  ok(!("gentle" in s) && !("reduced" in s) && !("startAt" in s) && !("vision" in s) && !("frames" in s), "nothing raised, no own drawings, no vision override");
  ok(BL.specOf(b, { lead: false }).magnitude === BL.QUIET, "a follower's call is quiet");
  const low = BL.specOf({ ...b, shake: false }, { seat: { noFlash: true, noShake: true, reduced: true } });
  ok(low.gentle === true && low.punch === false && low.reduced === true, "a seat's opt-outs lower the call");
  const none = BL.specOf({ ...b, shake: false }, { seat: { noFlash: false, noShake: false, reduced: false } });
  ok(!("gentle" in none) && !("punch" in none) && !("reduced" in none), "a seat without opt-outs changes nothing (never `false`, which could raise)");
  const cam = { x: 2500, y: 1000, z: 0.5, w: 3200 };
  ok(!BL.viewMoved(cam, { ...cam }) && !BL.viewMoved(cam, { ...cam, x: 2550 }) && BL.viewMoved(cam, { ...cam, x: 2570 }) && BL.viewMoved(cam, { ...cam, y: 930 }) && BL.viewMoved(cam, { ...cam, z: 0.52 }) && !BL.viewMoved(cam, { ...cam, z: 0.505 }) && BL.viewMoved(null, cam) && BL.viewMoved(cam, null), "a view moved = over 2 % of its width or of its zoom");
  ok(BL.inView(b, { x0: 0, y0: 0, x1: 100, y1: 200 }) && !BL.inView(b, { x0: 101, y0: 0, x1: 500, y1: 500 }) && !BL.inView(b, null), "in view = its centre in the seat's map view");
});

/* ---- on the real engine */
globalThis.__letrRealST = (f) => setImmediate(f);
const { setup } = await import(pathToFileURL(path.join(root, "scripts/letters/testenv.mjs")).href);
const { createImpact } = await import(pathToFileURL(path.join(root, "scripts/letters/impact/index.mjs")).href);
async function engine() {
  const E = await setup(); const L = E.engine; L.lookStyle("invincible");
  document.getElementById = () => null;
  document.createElementNS = (ns, t) => { const el = document.createElement(t); el.querySelectorAll = () => [{ setAttribute() {} }, { setAttribute() {} }]; return el; };
  canvas.app = { ...(canvas.app ?? {}), ticker: { started: true, stop() { this.started = false; }, start() { this.started = true; } }, view: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }), clientWidth: 1600, clientHeight: 900 } };
  const prefs = { enabled: true, motion: "full", flashes: true, photosafe: true, impact: "full" }, tools = { state: { flashLog: [] } };
  return { E, L, I: createImpact({ get prefs() { return prefs; } }, tools), prefs, tools };
}
const changesScene = (f) => !!f.full || f.back === "bw" || f.back === "bwinv" || f.back === "split";

await group("ENGINE", async () => {
  const { E, I, tools } = await engine();
  ok(JSON.stringify(I.steps) === JSON.stringify(BL.STEP_AT), `the engine's strength bounds are the ones sfx-blast counts with (${I.steps})`);
  ok(I.kinds.find((k) => k.id === "blast")?.tone === "fire" && I.kinds.find((k) => k.id === "landing")?.tone === "dust", "the engine knows the kinds; a blast is fire-coloured, a landing dust-coloured (no pink)");
  for ( const kind of ["blast", "landing"] ) {
    const q = I.plan({ kind, magnitude: BL.QUIET, subject: { x: 800, y: 450 }, area: 120, seed: "q" });
    ok(q.step === 1 && q.frames.filter(changesScene).length === 0 && !q.frames.some((f) => f.stop), `${kind}: the quiet strength changes nothing of the scene and holds nothing (${q.frames.map((f) => f.type)})`);
  }
  for ( const id of ["grenade", "rocket", "bomb", "meteor"] ) {
    const b = fire(id).bl, p = I.plan(BL.specOf(b, { lead: true, sceneId: "S" }));
    ok(p.step === BL.stepOf(b.magnitude) && p.frames.filter((f) => f.full).length <= 2, `${id}: step ${p.step}, at most two full-field drawings`);
    if ( id === "grenade" ) ok(p.frames.every((f) => !f.full) && !p.frames.some((f) => f.stop), "a grenade never takes the whole view and never holds the scene");
    if ( id === "bomb" || id === "meteor" ) ok(p.frames.some((f) => f.full), `${id} takes the whole view`);
    // a seat's "no flash": inside a panel, nothing full, no hold
    const g = I.plan(BL.specOf(b, { lead: true, sceneId: "S", seat: { noFlash: true } }));
    ok(g.frames.every((f) => !f.full) && !g.frames.some((f) => f.stop), `${id}: a "no flash" seat gets no full-field drawing and no hit-stop`);
    const r = I.plan(BL.specOf(b, { lead: true, sceneId: "S", seat: { reduced: true } }));
    ok(r.frames.filter((f) => f.type !== "rest").length <= 1, `${id}: a reduced-motion seat gets one still at most`);
  }
  // a volley of three bombs 300 ms apart, called the way sfx.mjs calls them: no more flash spent than by the one lead
  const bomb = fire("bomb").bl, t0 = E.now() + 400, v = BL.volley([0, 1, 2].map((i) => ({ ...bomb, id: `v${i}`, t: 1000 + i * 300 })));
  const hs = [0, 1, 2].map((i) => I.play(BL.specOf({ ...bomb, id: `v${i}` }, { lead: v.get(`v${i}`) === "lead", sceneId: "S", blowAt: t0 + i * 300 })));
  const leadFlash = hs[0].plan.frames.filter(changesScene).length;
  ok(leadFlash >= 1 && leadFlash <= 2 && tools.state.flashLog.length === leadFlash, `a volley of three spends the lead's ${leadFlash} flash drawings, no more (${tools.state.flashLog.length})`);
  ok(hs.slice(1).every((h) => !h.plan || h.plan.frames.filter(changesScene).length === 0), "the followers change nothing of the scene");
  await E.tick(2500);
  ok(hs.every((h) => !h.alive), "all gone");
  // WHY a firing's frame is asked ahead (AHEAD_MS): a flash a seat logged within the engine's window of the blow thins the frame there;
  // asked before any word that could flash inside that window, the frame has its two flash drawings on every seat
  {
    const { planImpact, safety, LIMITS, TICK } = await import(pathToFileURL(path.join(root, "scripts/letters/impact/plan.mjs")).href);
    const P0 = { enabled: true, motion: "full", flashes: true, photosafe: true, impact: "full" }, spec = BL.specOf(fire("meteor").bl, { lead: true, sceneId: "S" });
    const clean = safety(planImpact(spec), P0, { flashLog: [], now: 10000, t0: 10000 + BL.AHEAD_MS });
    const dirty = safety(planImpact(spec), P0, { flashLog: [10000 + BL.AHEAD_MS - 850, 10000 + BL.AHEAD_MS - 849], now: 10000 + BL.AHEAD_MS - 140, t0: 10000 + BL.AHEAD_MS });
    ok(clean.guard.kept === 2 && clean.frames.some((f) => f.full), "asked ahead of every word: the meteor's frame keeps its two flash drawings");
    ok(dirty.guard.kept === 0 && !dirty.frames.some((f) => f.full), "(the fault it answers: a word that flashed under a second before on one seat took the frame's flash drawings there)");
    const idx = fs.readFileSync(path.join(root, "scripts/letters/impact/index.mjs"), "utf8"), early = Number(idx.match(/FEED_EARLY = (\d+)/)?.[1]);
    ok(BL.AHEAD_MS >= LIMITS.windowMs + BL.CONTACT_MS + 2 * TICK + 100, `AHEAD_MS ${BL.AHEAD_MS} covers the engine's flash window (${LIMITS.windowMs} ms) before the blow, the word's contact and a margin`);
    ok(early >= BL.AHEAD_MS, `AHEAD_MS ${BL.AHEAD_MS} is inside the engine's paint-ahead window (FEED_EARLY ${early}): its drawings are painted in idle time`);
  }
  // the word joins `keep` after the call: the engine reads the caller's array again on every frame
  const pic = document.createElement("canvas"); pic.width = 200; pic.height = 80;
  const sp = { visible: true, destroyed: false, alpha: 1, tint: 0xffffff, anchor: { x: 0.5, y: 0.5 }, texture: { width: 200, height: 80 },
    parent: { worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, worldAlpha: 1 }, transform: { updateLocalTransform() {}, localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 300, ty: 200 } } };
  const word = { sprite: sp, shown: { canvas: pic }, alive: true, finished: new Promise(() => {}) };
  const keep = [];
  const h = I.play(BL.specOf(fire("meteor").bl, { lead: true, sceneId: "K", blowAt: E.now() + 240, keep }));
  ok(h.alive, "the frame is called ahead of the blow");
  await E.tick(100);
  keep.push(word);
  let copies = 0, frames = 0;
  for ( let t = 0; t < h.plan.ms + 200 && h.alive; t += 16 ) { await E.tick(16); if ( h.idx >= 0 ) { frames++; if ( h.copies?.get(word) ) copies++; } }
  ok(frames > 5 && copies >= frames - 2, `a word that joins the caller's keep array after the call is kept on the drawings (${copies}/${frames})`);
  await E.tick(600);
  E.restoreWarn?.();
});

await group("WORD", async () => {
  const { E, L } = await engine();
  const d = { grid: 100, layer: {} }, w = { role: "main", x: 1000, y: 800, area: 160, magnitude: 1.4, seed: "pg|main", rotation: 0, stage: {}, word: { play: { kind: "boom" } } };
  ok(!("flash" in T.baseOpts(w, d)) && T.baseOpts({ ...w, noFlash: true }, d).flash === false, "the table option: a lead's word plays with flash: false, any other word as before");
  let with_ = 0, without = 0;
  for ( let i = 0; i < 12; i++ ) {
    const o = { kind: "boom", magnitude: 1.4, space: "world", at: { x: 2000, y: 1500 }, seed: `w${i}` };
    const acc = (m) => [...(m.plan.timeline?.ent ?? []), ...(m.plan.timeline?.hold ?? []), ...(m.plan.timeline?.exit ?? [])].filter((p) => p.impact).length + (m.plan.motion?.flash ? 1 : 0);
    const a = L.measure("KA-BOOM!", o), b = L.measure("KA-BOOM!", { ...o, flash: false });
    with_ += acc(a); without += acc(b);
    const c = L.contactAt(b.plan, 5000);
    ok(Number.isFinite(c) && c >= 5000 && c <= 5000 + 400, `seed ${i}: the blow's instant is known ahead from the word's measure (${c - 5000} ms after its start)`);
  }
  ok(with_ > 0 && without === 0, `a boom has its own flash accent (${with_}), with flash: false none (${without}): the frame is the only flash`);
  E.restoreWarn?.();
});

await group("WIRING", () => {
  const s = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8");
  ok(/import \* as BL from "\.\/sfx-blast\.mjs"/.test(s), "sfx.mjs uses sfx-blast.mjs");
  ok(/p\.bl = BL\.blastOfPage\(pg, rec, grid\(\)\); noteBlast\(p\.bl\)/.test(s), "a firing's blast is known when its page is");
  ok(/const bl = w\.role === "main" \? blastLead\(q, p\.bl\) : null;[\s\S]{0,1800}if \( bl && !q\.blast \) armBlast\(q, bl\);\s*\n\s*play\(q\);/.test(s), "a page's main word: lead decided before the seat's own rules; a seat that got the firing late asks the frame with the word");
  ok(s.includes("later(`pg|${rec.id}|blast`, toPerf(mw.t) - BL.AHEAD_MS - performance.now(), () => pageBlast(p, mw));"), "a firing's frame is asked AHEAD_MS before its main word");
  const pb = s.slice(s.indexOf("function pageBlast("), s.indexOf("/** how long before a page's first word"));
  ok(pb.length > 100 && /plans\.ask\(/.test(pb) && /q\.dropped \|\| q\.blast/.test(pb) && /mode\(\) === "off"/.test(pb) && /stepFor\(SZ\.groupOfPageWord\(w, p\.grp\)\) === 0/.test(pb) && /const bl = blastLead\(q, p\.bl\);\s*\n\s*if \( bl \) armBlast\(q, bl\);/.test(pb), "asked ahead: on the table's planned main word, once, under the lettering's switches");
  const rb = s.slice(s.indexOf("function reBlast("), s.indexOf("/** A gun's rattle"));
  ok(rb.length > 100 && /BL\.viewMoved\(B\.at, camNow\(\)\)/.test(rb) && /B\.h\.stop\(\)/.test(rb) && /armBlast\(w, \{ b: B\.b, lead: B\.lead \}, true\)/.test(rb) && /if \( w\.blast \) \{ reBlast\(w\);/.test(s), "a view that moved since the asking: the frame is stopped and asked again when the word starts");
  ok(/BL\.blastOfMoment\(/.test(s) && /if \( bl && mine\.includes\(mw\) \) armBlast\(mw, bl\);/.test(s), "a blast that is no firing gets its frame with its main word");
  const lead = s.slice(s.indexOf("function blastLead("), s.indexOf("const seatOpt"));
  ok(/L\.impact\.mode\?\.\(\) === "off"\s*\) return null;/.test(lead) && /const key = noteBlast\(b\), lead = BL\.volley\(blasts\)\.get\(key\) === "lead"/.test(lead) && /if \( lead \) w\.noFlash = true;/.test(lead), "the table's impact switch off: none; the volley rule; a lead's word marked");
  const arm = s.slice(s.indexOf("function armBlast("), s.indexOf("function reBlast("));
  ok(arm.length > 100 && /const vw = mapView\(\)/.test(arm) && /!BL\.inView\(b, vw\)/.test(arm) && /!hereVisible\(b\.x, b\.y\)/.test(arm), "only a seat that has the blast in view and may see the place");
  ok(/L\.contactAt\(L\.measure\(w\.text, \{ \.\.\.optsOf\(w\), reduced: false \}\)\?\.plan, w\.t\)/.test(arm) && /seat: seatNeeds\(\)/.test(arm) && /keep, seat/.test(arm), "the blow at the word's contact on the table's clock; the seat's needs passed");
  ok(!/vision:|setMode|gentle: false|reduced: false \}\)\)\s*;?\s*$/m.test(arm.replace(/reduced: false \}\)\?\.plan/, "")), "nothing in the call raises a seat");
  ok(/w\.blast\.keep\?\.push\(h\);/.test(s), "the word's handle joins the frame's keep when it starts");
  ok(/for \( const h of impacts \) \{ try \{ h\.stop\(\); \}/.test(s), "a scene change stops the frames");
  ok(/cinNoFlash/.test(s) && /cinNoShake/.test(s) && /reducedMotion\(\) \|\| seatOpt\("cinReduced"\) === "on"/.test(s), "the seat's opt-outs are read");
  // nothing new is switched on for a player: no setting is registered by this work
  ok(!/settings\.register\([^)]*[Bb]last/.test(s) && !/register/.test(fs.readFileSync(path.join(root, "scripts/sfx/sfx-blast.mjs"), "utf8")), "no new setting");
});

if ( failed.length ) { console.log(failed.join("\n")); console.log(`sfx-blast: ${failed.length} group(s) failed, ${n} checks passed`); process.exit(1); }
console.log(`sfx-blast: ${n} checks passed`);
process.exit(0);
