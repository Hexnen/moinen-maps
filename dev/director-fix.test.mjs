// The adversary-round fixes of the DIRECTOR's pure parts (scripts/director/core.mjs):   node dev/director-fix.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = await import(pathToFileURL(path.join(root, "scripts/director/core.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const G = 100;
const R = D.resolve(null);
const wire = (e) => JSON.parse(JSON.stringify(e));          // what the socket does to an event

// ---- an event keeps its fields over the socket (adversary 2 #1: dur null -> 0 -> hold 600)
{
  const e = D.normEvent({ kind: "orbitUp", x: 500, y: 500, weight: 1, force: true }, 1000);
  ok(e.dur === null, "no dur -> null");
  const back = D.normEvent(wire(e), 2000);
  ok(back.dur === null, "dur null stays null after a JSON round trip");
  const a = D.plan(e, "take", R, 0), b = D.plan(back, "take", R, 0);
  ok(a.hold === b.hold && b.hold > 600, `same hold on both sides (${a.hold} / ${b.hold})`);
  ok(D.normEvent(wire({ ...e, dur: 2500 }), 0).dur === 2500, "a real dur survives");
  for ( const k of ["x", "y"] ) ok(D.normEvent({ x: k === "x" ? null : 5, y: k === "y" ? null : 5 }) === null, `${k}: null is missing, not 0`);
  ok(D.normEvent({ x: 5, y: 5, weight: null }).weight === 0.5 && D.normEvent({ x: 5, y: 5, weight: "" }).weight === 0.5, "weight null / '' -> the default, not 0");
  ok(D.normEvent({ x: 5, y: 5, t: null }, 777).t === 777, "t null -> now");
  const rt = D.normEvent(wire(D.normEvent({ x: 1, y: 2, box: { x0: 0, y0: 0, x1: 4, y1: 4 }, path: [1, 2, 3, 4], lane: "l", free: true, cue: "dice", strict: true, after: "r" })), 0);
  ok(rt.path.length === 4 && rt.lane === "l" && rt.free && rt.cue === "dice" && rt.strict && rt.after === "r" && rt.box.x1 === 4, "the other fields survive the round trip");
}

// ---- a player's event is a request (both adversaries: forced take-over on everyone past the pause)
{
  const e = D.normEvent({ kind: "cut", x: 0, y: 0, weight: 1, force: true, lane: "cbt-x", free: true, quick: true }, 0);
  const p = D.fromPlayer(e);
  ok(!p.force && !p.free && p.lane === null && !p.quick && p.weight <= 0.85, "force / lane / free / quick stripped, weight below heavy");
  ok(D.fromPlayer(null) === null, "null stays null");
  const q = new D.Queue();
  q.push(p, R, G);
  ok(q.pump(R, { now: 5000, paused: true }, G).length === 0, "the GM's pause holds for a player's event");
  const q2 = new D.Queue();
  q2.push(e, R, G);
  ok(q2.pump(R, { now: 10, paused: true }, G).length === 1, "(a GM's forced cut still plays through the pause)");
}

// ---- merged: GM-only events are not counted / named for the players (adversary 2 #10)
{
  const pub = D.normEvent({ kind: "destruction", x: 0, y: 0, weight: 0.7 }, 0);
  const g1 = D.normEvent({ kind: "orbitUp", x: 50, y: 0, weight: 0.5, who: "gm" }, 0), g2 = D.normEvent({ kind: "fire", x: 60, y: 0, weight: 0.4, who: "gm" }, 0);
  const m = D.merged({ id: "b", scene: null, events: [pub, g1, g2] });
  ok(m.who === "all" && m.n === 1 && m.kinds.length === 1 && m.kinds[0] === "destruction", `public: n ${m.n}, kinds ${m.kinds}`);
  const mg = D.merged({ id: "b", scene: null, events: [g1, g2] });
  ok(mg.who === "gm" && mg.n === 2 && mg.kinds.length === 2, "GM-only: everything");
}

// ---- a heavy event at a place just shown is never silently dropped (adversary 1 F9)
{
  const q = new D.Queue(), at = (x, w, t, cap) => D.normEvent({ kind: "destruction", x, y: 0, weight: w, caption: cap }, t);
  q.push(at(5000, 0.95, 0, "B"), R, G);
  let out = q.pump(R, { now: 500 }, G);
  ok(out.length === 1 && out[0].form === "take", "take at B");
  const tB = out[0].t0 + out[0].len;
  q.push(at(0, 0.95, tB + 10, "A"), R, G);
  out = q.pump(R, { now: tB + 600 }, G);
  ok(out.length === 1 && out[0].form === "take", "take at A (heavy breaks the rest)");
  const tA = out[0].t0 + out[0].len;
  q.push(at(5000, 0.95, tA + 10, "Big blast at B"), R, G);
  out = q.pump(R, { now: tA + 600 }, G);
  ok(out.length === 1 && out[0].form === "soft" && out[0].caption === "Big blast at B", `big blast at B: soft at least (${out.map((s) => s.form)})`);
  // a light event at the place just shown is still dropped (unchanged)
  q.push(at(5000, 0.3, tA + 700, "small"), R, G);
  out = q.pump(R, { now: tA + 1300 + 4000 }, G);
  ok(!out.some((s) => s.caption === "small"), "a small one there: dropped as before");
}

// ---- framing into the free part of the screen (adversary 1 F7)
{
  const shot = { box: { x0: 900, y0: 900, x1: 1100, y1: 1100 }, x: 1000, y: 1000 };
  const view = { x: 0, y: 0, scale: 1, vw: 1600, vh: 900, grid: G };
  const full = D.frameShot(shot, view, R, 1);
  ok(Math.abs(full.x - 1000) < 1 && Math.abs(full.y - 1000) < 1, "no rect: centred on the place");
  const rect = { x: 0, y: 0, w: 800, h: 900 };                       // a sheet over the right half
  const f = D.frameShot(shot, { ...view, rect }, R, 1);
  const sx = (1000 - f.x) * f.scale + 800, sy = (1000 - f.y) * f.scale + 450;   // the place's screen point
  ok(Math.abs(sx - 400) < 2 && Math.abs(sy - 450) < 2, `the place lands in the middle of the free rect (${sx.toFixed(0)}, ${sy.toFixed(0)})`);
  ok(f.scale <= full.scale + 1e-9, "never closer than without the rect");
}

// ---- the leader (adversary 1 F4, adversary 2 #6)
{
  const st = new Map([["gm1", { vis: true, since: 100 }], ["gm2", { vis: true, since: 900 }], ["p1", { vis: true, since: 50 }]]);
  const u = (id, isGM, viewed = "S") => ({ id, active: true, isGM, viewed });
  ok(D.pickLeader([u("gm2", true), u("gm1", true), u("p1", false)], { scene: "S", states: st }) === "gm1", "the GM online the longest leads (a second GM logging in does not take over)");
  ok(D.pickLeader([u("a", true), u("b", true)], { scene: "S", states: new Map([["b", { vis: true, since: 1 }]]) }) === "b", "a GM that never announced itself does not take the lead");
  ok(D.pickLeader([u("gm1", true, "PREP"), u("p1", false)], { scene: "S", states: st }) === "p1", "the GM on another scene: a player on the players' scene stands in");
  ok(D.pickLeader([u("gm1", true, "PREP"), u("gm2", true)], { scene: "S", states: st }) === "gm2", "... or the other GM who is on it");
  const hid = new Map([...st, ["gm1", { vis: false, since: 100 }]]);
  ok(D.pickLeader([u("gm1", true), u("gm2", true)], { scene: "S", states: hid }) === "gm2", "a GM whose tab is hidden hands the lead to a visible GM");
  ok(D.pickLeader([u("gm1", true), u("p1", false)], { scene: "S", states: hid }) === "p1", "... or to a visible player on the scene");
  ok(D.pickLeader([u("gm1", true)], { scene: "S", states: hid }) === "gm1", "alone: it leads anyway");
  ok(D.pickLeader([u("gm1", true, "PREP"), u("p1", false, "OTHER")], { scene: "S", states: st }) === "gm1", "nobody on the scene: the GM");
  ok(D.pickLeader([{ id: "x", active: false, isGM: true }], {}) === null, "nobody online: none");
  ok(D.pickLeader([u("b", true, null), u("a", true, null)], {}) === "a", "no states, no scene: by id (old behaviour)");
}

console.log(`director-fix: ${n} checks passed`);
