// Destruction presets P6, the firings runtime (dev/presets-design.md G9):   node dev/presets-runtime.test.mjs
//   A. timeline: the impact first, every pending part at T0 + its at, its end from its length / hits / points
//   B. late join / reload: what is still to come plays at its moment; a past cue or impact is dropped; a running part is handed over
//      late (with how late); a finished one is dropped
//   C. purge: never while a fire it named is left (no end: never before the GM puts it out; timed: after its out time + the tail);
//      only after its damage entered and every part ended + the tail
//   D. undo: a fire that has not caught yet is dropped, a burning one goes out from now, one already out is left alone
//   E. timed fires: the scene's firing fires that still burn, the ones with an out time (which the fire layer's clear() misses) told apart
//   F. the runtime on a client (runtime.mjs, with Foundry stubbed): a record found on a scene load is taken up with its late parts, the
//      rest at their moments, its impact at T0; a record that goes stops what is still to come ("gone"); a scene without records
//      does nothing; the active GM purges a finished record in one write
//   G. real plans: every built-in firing's record purges only after its last fire is gone and its last hit has entered
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
globalThis.fetch = async () => { throw new Error("no network in tests"); };
const hooks = new Map(), calls = [];
globalThis.Hooks = { on: (k, f) => { hooks.set(k, [...(hooks.get(k) ?? []), f]); }, once() {}, callAll: (k, ...a) => { calls.push([k, ...a]); }, call() {} };
const R = await imp("scripts/presets/runtime-core.mjs");
const C = await imp("scripts/presets/core.mjs");
const { BUILTIN } = await imp("scripts/presets/defs.mjs");

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const J = (v) => JSON.stringify(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const T0 = 1_800_000_000_000;
const rec = {
  id: "fid1", t0: T0, d: [{ id: "d1", at: T0 }, { id: "d2", at: T0 + 2250 }], f: [{ id: "f1" }, { id: "f2" }],
  pending: { burst: [{ at: 0 }], dust: [{ at: 30, life: 6000 }], accent: [{ at: -1200, dur: 1200 }, { at: 0, dur: 50, hits: [[0, 0, 900], [1, 1, 1700]] }],
    cue: [{ at: 0, kind: "screen" }, { at: 40, kind: "light", decay: 1500 }] }
};

/* A */
{
  const tl = R.timeline(rec);
  ok(tl[0].part === "accent" && tl[0].t === T0 - 1200 && tl[1].part === "impact" && tl[1].t === T0, "A the timeline in time order, the impact first at T0");
  ok(tl.length === 7, `A the impact and every part once (${tl.length})`);
  const tr = tl.find((e) => e.part === "accent" && e.i === 1);
  ok(tr.end === T0 + 1700 + 50, "A a part with hits ends after its last hit");
  ok(tl.find((e) => e.part === "dust").end === T0 + 30 + 6000 && tl.find((e) => e.part === "burst").end === T0 + R.PART_MS, "A a part's length: its life, else PART_MS");
  ok(tl.find((e) => e.part === "cue" && e.i === 0).end === T0 && tl.find((e) => e.part === "cue" && e.i === 1).end === T0 + 40 + 1500, "A a cue lasts its decay only");
  ok(J(R.timeline({})) === "[]" && J(R.timeline(null)) === "[]", "A no T0: nothing");
}

/* B */
{
  const before = R.schedule(rec, T0 - 2000);
  ok(before.length === 7 && before.every((e) => e.late === 0 && e.wait === e.t - (T0 - 2000)), "B on time: everything at its moment");
  const late = R.schedule(rec, T0 + 100);
  const kinds = late.map((e) => `${e.part}${e.i}`).sort().join();
  ok(!late.some((e) => e.part === "impact") && !late.some((e) => e.part === "cue" && e.i === 0), "B late: the past impact and the past cue are dropped");
  ok(!late.some((e) => e.part === "accent" && e.i === 0), "B late: a finished part (the fall shadow) is dropped");
  const dust = late.find((e) => e.part === "dust");
  ok(dust && dust.wait === 0 && dust.late === 70, "B late: a running part is handed over at once, with how late");
  ok(late.some((e) => e.part === "accent" && e.i === 1 && e.late === 100) && late.some((e) => e.part === "burst" && e.late === 100), `B late: the tracer and the burst still run (${kinds})`);
  ok(late.some((e) => e.part === "cue" && e.i === 1 && e.wait === 0) === false, "B late: a cue past its moment is not played even while its light would decay");
  ok(R.schedule(rec, T0 + 60000).length === 0, "B much later: nothing");
}

/* C */
{
  const over = R.overAt(rec);
  ok(over === T0 + 2250 + R.ENTRY_MS, `B/C the record's own things are over after its last damage entry (${over - T0})`);
  ok(J(R.purgeState(rec, { f1: { o: undefined } }, T0 + 1e7)) === J({ done: false, next: null }), "C a fire without an end: never purged");
  const st = R.purgeState(rec, { f1: { o: T0 + 60000 }, f2: { o: T0 + 30000 } }, T0 + 1e5);
  ok(!st.done && st.next === T0 + 60000 + R.TAIL_MS, "C timed fires left: look again after the last out time + the tail (the fire layer purges them)");
  ok(!R.purgeState(rec, {}, over + R.TAIL_MS - 1).done && R.purgeState(rec, {}, over + R.TAIL_MS).done, "C no fire left: purged after the record's end + the tail");
  ok(R.purgeState(rec, { other: { o: undefined } }, over + R.TAIL_MS).done, "C another stroke does not hold it");
}

/* D */
{
  const now = T0 + 500;
  const u = R.undoFires(rec, { f1: { q: T0 + 1000 }, f2: { q: T0, o: T0 + 9000 } }, now);
  ok(J(u) === J({ put: ["f2"], drop: ["f1"] }), "D a fire not caught yet is dropped, a burning one goes out from now");
  ok(J(R.undoFires(rec, { f1: { q: T0, o: T0 + 100 } }, now)) === J({ put: [], drop: [] }), "D one already out is left alone");
  ok(J(R.undoFires(rec, {}, now)) === J({ put: [], drop: [] }), "D strokes already purged: nothing");
}

/* E */
{
  const b = R.burning([rec], { f1: { q: T0, k: "fire" }, f2: { q: T0, o: T0 + 9000, k: "smoke" }, x: { q: T0 } }, T0 + 100);
  ok(b.length === 2 && b.find((s) => s.id === "f1").o === null && b.find((s) => s.id === "f2").o === T0 + 9000 && b.every((s) => s.fid === "fid1"), "E burning: both, the timed one with its out time");
  ok(R.burning([rec], { f2: { q: T0, o: T0 + 9000 } }, T0 + 9000).length === 0, "E out: no longer burning");
  const s = R.stateOf(rec, { f1: { q: T0 } }, new Set(["d1"]), T0 + 100);
  ok(s.state === "playing" && s.partial === true, "E state: playing, partial (a damage stroke deleted by hand)");
  ok(R.stateOf(rec, {}, new Set(["d1", "d2"]), T0 - 5).state === "coming" && R.stateOf(rec, { f1: { q: T0 } }, new Set(["d1", "d2"]), T0 + 1e6).state === "burning"
    && R.stateOf(rec, {}, new Set(["d1", "d2"]), T0 + 1e6).state === "settled", "E state: coming, burning, settled");
}

/* F */
{
  const MID = "moinen-maps";
  let now = Date.now();
  const scene = { id: "S1", flags: { [MID]: {} }, updates: [], async update(u) { this.updates.push(u); for ( const k of Object.keys(u) ) if ( k.includes(".-=") ) { const id = k.split(".-=")[1]; delete this.flags[MID].presetFirings[id]; } } };
  globalThis.canvas = { scene };
  globalThis.game = { user: { isGM: true, id: "gm" }, users: { activeGM: { isSelf: false }, get: (id) => (id === "gm" ? { id: "gm", active: true, isGM: true } : id === "gm2" ? { id: "gm2", active: true, isGM: true } : null) } };
  const Run = await imp("scripts/presets/runtime.mjs");
  Run.registerRuntime();
  const fireH = (k, ...a) => (hooks.get(k) ?? []).forEach((f) => f(...a));
  // a scene without records: nothing
  calls.length = 0; fireH("canvasReady");
  ok(calls.length === 0 && J(Run.status()) === J({ known: [], timers: 0, purgeArmed: false, recent: [] }), "F a scene without firing records: nothing at all");
  fireH("updateScene", scene, { flags: { [MID]: { fireStrokes: { a: {} } } } });
  ok(calls.length === 0 && !Run.status().purgeArmed, "F a fire edit on a scene without records: nothing");
  // a late join: the firing began 100 ms ago
  now = Date.now();
  const r = { id: "fidL", t0: now - 100, d: [{ id: "d1", at: now - 100 }], f: [],
    pending: { burst: [], dust: [{ at: 0, life: 5000 }], accent: [{ at: 250, dur: 100 }], cue: [{ at: 0, kind: "screen" }, { at: 300, kind: "screen" }] } };
  scene.flags[MID].presetFirings = { fidL: r };
  calls.length = 0; fireH("canvasReady");
  const ev = () => calls.filter((c) => c[0] === "moinenMapsPresets").map((c) => `${c[1]}${c[2].part ? ":" + c[2].part : ""}`);
  ok(J(ev()) === J(["firing", "part:dust"]) && calls[1][2].late >= 90, `F late join: the record and its running dust (late), no past impact or cue (${ev()})`);
  await sleep(320);
  ok(J(ev()) === J(["firing", "part:dust", "part:accent", "part:cue"]), `F the rest at their moments (${ev()})`);
  ok(Run.status().known.includes("fidL") && Run.status().purgeArmed, "F taken up; the GM's purge armed");
  // a fresh record arriving by an update: its impact at T0
  now = Date.now();
  const r2 = { id: "fidN", t0: now + 80, d: [], f: [{ id: "fx" }], pending: { cue: [{ at: 1000, kind: "screen" }] } };
  scene.flags[MID].presetFirings.fidN = r2;
  calls.length = 0; fireH("updateScene", scene, { flags: { [MID]: { presetFirings: { fidN: r2 } } } });
  await sleep(120);
  ok(J(ev()) === J(["firing", "impact"]), `F a new record: firing, then its impact at T0 (${ev()})`);
  // it goes (undo / settle): what is still to come is dropped
  delete scene.flags[MID].presetFirings.fidN;
  calls.length = 0; fireH("updateScene", scene, { flags: { [MID]: { presetFirings: { "-=fidN": null } } } });
  ok(J(ev()) === J(["gone"]) && !Run.status().known.includes("fidN"), "F a record that goes: gone, its timers stopped");
  await sleep(1000);
  ok(!ev().includes("part:cue"), "F its cue never comes");
  // the purge: a finished record (old T0, nothing left) goes in one write
  const old = { id: "fidO", by: "gm", t0: Date.now() - 60000, d: [{ id: "dz", at: Date.now() - 60000 }], f: [{ id: "gone1" }], pending: {} };
  const other = { id: "fidX", by: "gm2", t0: Date.now() - 60000, d: [], f: [], pending: {} };
  scene.flags[MID].presetFirings.fidO = old; scene.flags[MID].presetFirings.fidX = other;
  scene.updates.length = 0;
  fireH("updateScene", scene, { flags: { [MID]: { presetFirings: { fidO: old } } } });
  await sleep(400);
  ok(scene.updates.length === 1 && J(Object.keys(scene.updates[0])) === J([`flags.${MID}.presetFirings.-=fidO`]) && !!scene.flags[MID].presetFirings.fidL,
    `F the purge: the finished record in one write, the running one stays, another GM's record is theirs (${J(scene.updates)})`);
  fireH("canvasTearDown");
  ok(J(Run.status()) === J({ known: [], timers: 0, purgeArmed: false, recent: [] }), "F a scene change: everything let go");
}

/* G */
{
  const RECT = { x: 0, y: 0, width: 4000, height: 2000 }, ENV = { grid: 100, rect: RECT, now: T0, wind: { dir: 0, speed: 0 } };
  let bad = 0, checked = 0;
  for ( const d of BUILTIN ) for ( let seed = 1; seed <= 10; seed++ ) {
    const p = C.expand(d, { a: [600, 1000], b: [3000, 1100] }, { seed }, ENV);
    const r = { id: "x", t0: p.t0, pending: p.pending, d: p.destruction.map((q, i) => ({ id: `d${i}`, at: p.t0 + q.at })), f: p.fire.map((s, i) => ({ id: `f${i}` })) };
    const fires = Object.fromEntries(p.fire.map((s, i) => [`f${i}`, s]));
    const lastHit = Math.max(p.t0, ...r.d.map((q) => q.at)), lastOut = Math.max(0, ...p.fire.map((s) => s.o ?? Infinity));
    checked++;
    // never while its fire is there; with no fire left, not before its last hit has entered
    if ( R.purgeState(r, fires, lastOut + 1e6).done ) bad++;
    if ( R.purgeState(r, {}, lastHit + R.ENTRY_MS - 1).done || !R.purgeState(r, {}, R.overAt(r) + R.TAIL_MS).done ) bad++;
  }
  ok(bad === 0, `G real firings purge only after their fire is gone and their last hit entered (${checked} firings, ${bad} bad)`);
}

console.log(`${n - fails}/${n} presets runtime checks passed`);
process.exit(fails ? 1 : 0);
