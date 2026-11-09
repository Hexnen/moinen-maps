// Destruction presets P2, the damage layer's hooks (dev/presets-design.md G5, G6, G10):   node dev/presets-timed.test.mjs
//   A. timed-core: `at` / `ps` cleaned; a timed stroke is held until LEAD before its start, enters (late up to LATE_MS: from now),
//      then is settled; an absurd start is not believed (never held for ever)
//   B. "an old stroke is unchanged": a stroke without `at` / `ps` has no phase, the brush's undo takes the last stroke as before,
//      redo puts it last as before; with `at` / `ps` the bake key, the signatures and the stored layout are the same as without
//      (the fields are not part of any signature) and they survive a save + load
//   C. undo: the brush's undo skips a preset's strokes; redo puts a stroke back under strokes painted after it (its place `s`)
//   D. the dissolve out: every pixel within 0..DROP_MS, the rim earlier than the heart on average, no line (moments along a row vary)
//   E. presets plan: a walk's runs are at most RUN_MS long, their path times start at 0, every hit's moment is its run's `at` + its
//      path time (= the walk's own time of that hit): the hits open in sequence at their impact
//   F. wiring (static): the brush's entry, the writer (no LEAD stand-in; paintStroke with at / ps; saveNow), the director (ps skipped,
//      one event per firing), the display (only a preset's stroke that is gone dissolves; the rest fades as before)
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
class ForcedDeletion {}
globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
globalThis.foundry = { data: { operators: { ForcedDeletion } }, utils: { deepClone: (v) => structuredClone(v) } };
globalThis.canvas = { dimensions: { sceneRect: { x: 0, y: 0, width: 1200, height: 800 } }, grid: { size: 100 } };
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const T = await imp("scripts/destruction/timed-core.mjs");
const Model = await imp("scripts/destruction/model.mjs");
const Store = await imp("scripts/destruction/store.mjs");
const C = await imp("scripts/presets/core.mjs");
const { BUILTIN } = await imp("scripts/presets/defs.mjs");
const MID = "moinen-maps";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const J = (v) => JSON.stringify(v);
const read = (p) => readFileSync(path.join(root, p), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/* A */
{
  ok(T.cleanAt(1800000000123.4) === 1800000000123 && T.cleanAt(null) === null && T.cleanAt(undefined) === null && T.cleanAt("x") === null && T.cleanAt(-5) === null && T.cleanAt("") === null, "A at cleaned");
  ok(T.cleanPs("abcDEF123456") === "abcDEF123456" && T.cleanPs("a.b") === null && T.cleanPs("") === null && T.cleanPs(7) === null && T.cleanPs("x".repeat(33)) === null, "A ps cleaned");
  const now = 1_800_000_000_000, o = (dt) => ({ id: "s1", at: now + dt });
  const L = { lead: 450 };
  ok(J(T.phase(o(2000), now, L)) === J({ k: "hold", wait: 1550 }), "A held until LEAD before its start");
  ok(T.phase(o(450), now, L).k === "enter" && T.phase(o(450), now, L).ahead === 450, "A at LEAD before: entered with a start in the future");
  ok(T.phase(o(0), now, L).k === "enter" && T.phase(o(-1500), now, L).k === "enter", "A late up to LATE_MS: still enters");
  ok(T.phase(o(-1501), now, L).k === "settled", "A later than LATE_MS: settled");
  ok(T.phase(o(T.AHEAD_MAX + 1), now, L).k === "enter" && T.phase(o(T.AHEAD_MAX + 1), now, L).ahead === 0, "A an absurd start is not believed (shown now, never held for ever)");
  ok(T.phase({ id: "e", k: 1, at: now + 2000 }, now, L) === null, "A an erase stroke is never timed");
}

/* B */
{
  const plain = { id: "p1", k: 0, t: 0, x0: 1, y0: 1, w: 2, h: 2, m: [4, 1], s: 0 };
  ok(T.phase(plain, 0) === null && !T.isTimed(plain) && !T.isPreset(plain), "B an old stroke: no phase, not timed, not a preset's");
  const list = [0, 1, 2, 3].map((i) => ({ ...plain, id: `p${i}`, s: i }));
  ok(T.lastUndoable(list) === 3 && T.lastUndoable([]) === -1, "B the brush's undo takes the last stroke (as before)");
  ok(T.redoIndex(list, { ...plain, id: "p4", s: 4 }) === 4 && T.redoIndex(list, { ...plain, id: "q", s: 1 }) === 4, "B redo puts the stroke last (as before; also under plain strokes with a later place)");

  // the bake key, the signatures and the stored layout with and without the preset fields
  const S0 = Model.blank({ width: 1200, height: 800 });
  const mk = (id, x0, extra = {}) => {
    const buf = new Uint8Array(S0.mw * S0.mh);
    for ( let y = 0; y < 5; y++ ) for ( let x = 0; x < 6; x++ ) buf[(20 + y) * S0.mw + x0 + x] = 1 + ((x + y) % 3);
    const ob = Model.makeObject(buf, S0.mw, { x0, y0: 20, x1: x0 + 5, y1: 24 }, { id, type: 0, path: [x0 * 2, 40, 0, x0 * 2 + 9, 44, 300] , pr: { directional: true } });
    return Object.assign(ob, extra);
  };
  const scene = { id: "SCN", width: 1200, height: 800, flags: { [MID]: {} } };
  const S = { ...S0, seed: 99, params: { ...Model.PARAM_DEFAULTS, pin: true }, objects: [mk("aaa1", 10), mk("bbb2", 40)] };
  S.objects.forEach((o, i) => { o.s = i; });
  const St = { ...S, objects: S.objects.map((o, i) => (i ? { ...o, at: 1_800_000_000_500, ps: "fire12345678" } : o)) };
  ok(Store.makeKey(scene, S, "bg") === Store.makeKey(scene, St, "bg"), "B at / ps: the same bake key");
  ok(S.objects.map((o) => Store.objSig(S, o)).join() === St.objects.map((o) => Store.objSig(St, o)).join(), "B at / ps: the same stroke signatures");
  const u0 = Store.flagUpdate(S, structuredClone(scene)), u1 = Store.flagUpdate(St, structuredClone(scene));
  const strip = (u) => J(Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v && typeof v === "object" && !Array.isArray(v) ? (({ at, ps, ...r }) => r)(v) : v])));
  ok(J(Object.keys(u0).sort()) === J(Object.keys(u1).sort()) && strip(u0) === strip(u1), "B at / ps: the same keys written, the strokes the same apart from the two fields");
  const st = u1[`flags.${MID}.destructionObjects.bbb2`];
  ok(st?.at === 1_800_000_000_500 && st?.ps === "fire12345678" && !("at" in u1[`flags.${MID}.destructionObjects.aaa1`]), "B at / ps stored with the preset's stroke only");
}

/* C */
{
  const mk = (id, s, ps) => ({ id, k: 0, t: 0, x0: 0, y0: 0, w: 1, h: 1, m: [1, 1], s, ...(ps ? { ps } : {}) });
  const L = [mk("a", 0), mk("b", 1), mk("c", 2, "fireA"), mk("d", 3, "fireA")];
  ok(T.lastUndoable(L) === 1, "C the brush's undo skips the preset's strokes");
  ok(T.lastUndoable([mk("c", 2, "fireA")]) === -1, "C only a preset's strokes: the brush's undo takes nothing");
  ok(T.redoIndex([mk("a", 0), mk("c", 2, "fireA"), mk("d", 3, "fireA")], mk("b", 1)) === 1, "C redo puts a stroke back under the strokes painted after it");
}

/* D */
{
  let lo = Infinity, hi = -Infinity, rim = 0, heart = 0, nr = 0, nh = 0;
  const vn = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };
  const noise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi; const a = vn(xi, yi), b = vn(xi + 1, yi), c = vn(xi, yi + 1), d = vn(xi + 1, yi + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
  const row = new Set();
  for ( let y = 0; y <= 80; y++ ) for ( let x = 0; x <= 80; x++ ) {
    const t = T.dropTime(x, y, 40, 40, 40, noise, (a, b) => vn(a * 3.1, b * 7.7));
    lo = Math.min(lo, t); hi = Math.max(hi, t);
    const d = Math.hypot(x - 40, y - 40);
    if ( d > 32 ) { rim += t; nr++; } else if ( d < 10 ) { heart += t; nh++; }
    if ( y === 40 ) row.add(Math.round(t / 10));
  }
  ok(lo >= 0 && hi <= T.DROP_MS && hi > T.DROP_MS * 0.6, `D every pixel within 0..DROP_MS (${Math.round(lo)}..${Math.round(hi)})`);
  ok(rim / nr < heart / nh - 100, `D the rim goes first, the heart last (${Math.round(rim / nr)} < ${Math.round(heart / nh)} ms)`);
  ok(row.size > 12, `D no line: the moments along a row vary (${row.size} steps)`);
}

/* E */
{
  const RECT = { x: 0, y: 0, width: 4000, height: 2000 }, ENV = { grid: 100, rect: RECT, now: 1_800_000_000_000, wind: { dir: 0, speed: 0 } };
  let walks = 0, runs = 0, bad = 0, seq = 0;
  for ( const d of BUILTIN.filter((q) => q.walk) ) for ( let seed = 1; seed <= 40; seed++ ) {
    const p = C.expand(d, { a: [300, 1000], b: [3700, 1000] }, { seed }, ENV);
    walks++;
    const hitsT = new Map(p.walk.hits.map((h) => [`${Math.round(h[0] * 10) / 10},${Math.round(h[1] * 10) / 10}`, h[2]]));
    for ( const r of p.destruction.filter((q) => q.path) ) {
      runs++;
      const span = r.path.at(-1)[2] - r.path[0][2];
      if ( r.path[0][2] !== 0 || span > C.RUN_MS ) bad++;
      // each hit's moment: the run's at + its path time = the walk's time of that hit (layer at 0)
      for ( const q of r.path ) { const t = hitsT.get(`${q[0]},${q[1]}`); if ( t === undefined || Math.abs(r.at + q[2] - t) > 1 ) bad++; }
      for ( let i = 1; i < r.path.length; i++ ) if ( r.path[i][2] < r.path[i - 1][2] ) seq++;
    }
    // runs of one lane follow each other in time
    const byLane = new Map();
    for ( const r of p.destruction.filter((q) => q.path) ) { const k = r.key.split("~")[0]; byLane.set(k, [...(byLane.get(k) ?? []), r]); }
    for ( const L of byLane.values() ) for ( let i = 1; i < L.length; i++ ) if ( L[i].at < L[i - 1].at + L[i - 1].path.at(-1)[2] ) seq++;
  }
  ok(runs > walks && bad === 0, `E walk runs: path times from 0, at most RUN_MS, every hit at its own moment (${runs} runs of ${walks} firings, ${bad} bad)`);
  ok(seq === 0, `E the hits open in sequence (${seq} out of order)`);
}

/* F */
{
  const ds = code(read("scripts/destruction/destruction.mjs"));
  ok(ds.includes("const at = Timed.cleanAt(stroke.at), ps = Timed.cleanPs(stroke.ps);") && ds.includes("if ( at !== null && !ob.k ) ob.at = at;") && ds.includes("if ( ps && !ob.k ) ob.ps = ps;"),
    "F the brush's entry: at / ps only when the stroke brings them");
  ok(ds.includes("if ( tob && !tob.cin && Timed.isTimed(tob) ) { timedEnter(") && ds.includes("const held = (o) => Cine.holds(o) || holdsTimed(o);"), "F the display holds and enters only timed strokes by their at");
  ok(/paintStroke: \(spec\) => paintStroke\(spec\), removeStrokes: \(ids\) => removeStrokes\(ids\), saveNow: \(\) => save\(\)/.test(ds), "F the API: paintStroke, removeStrokes, saveNow");
  ok(ds.includes("const i = Timed.lastUndoable(S.objects);"), "F the brush's undo skips a preset's strokes");
  const w = code(read("scripts/presets/write.mjs"));
  ok(!/presetLead|LEAD\b|setTimeout/.test(w) && w.includes("D.paintStroke(paintSpec(") && w.includes("await D.save()") && /ps: fid/.test(w) && /at: Math\.round\(t0 \+ \(rec\.at \?\? 0\)\)/.test(w),
    "F the writer: no LEAD stand-in; timed strokes with their firing, saved at once");
  const src = code(read("scripts/director/sources.mjs"));
  ok(src.includes("if ( o.ps || owned.has(id) ) { dIds?.add(id); continue; }") && src.includes("if ( owned.has(id) ) { fIds.add(id); continue; }") && /id: `p-\$\{id\}`/.test(src)
    && src.indexOf("onFirings(f.presetFirings)") < src.indexOf("onDestruction(f.destructionObjects, scene)"), "F the director: a preset's strokes skipped, one event per firing (read first)");
  const dp = code(read("scripts/destruction/display.mjs"));
  ok(dp.includes("this.retire(g, !!kept && !!g.objId && !kept.has(g.objId) && this.dropsOut(g.objId))") && dp.includes("clamp01((t0 - g.dieStart) / (g.outDur ?? 260))"),
    "F the display: only a preset's stroke that is gone dissolves; every other area fades as before (260 ms)");
  ok(dp.includes("this.retire(g, !!g.objId && !!this.dropsOut?.(g.objId))") && dp.includes("if ( a.strict && now < a.start ) return 0;")
    && dp.includes("T = strict && path?.length > 1 ? path.at(-1)[2] || 0 : 0;") && dp.includes("const spd = T > 0 ? slow / (T / Math.min(2200, Math.max(350, T))) : this.look.speed;")
    && dp.includes("speed: spd, simul, coll: null"), "F the display: a timed entry shows nothing before its start and runs its path in real time; any other entry keeps the look's speed");
}

console.log(`${n - fails}/${n} presets timed checks passed`);
process.exit(fails ? 1 : 0);
