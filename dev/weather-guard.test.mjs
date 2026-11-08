// The weather frame guard (scripts/weather/guard.mjs): lone hitches and stalls leave it alone, sustained late frames lower q smoothly
// to its floor, on-time frames bring it back slowly; the step per frame stays small (no jump).
import assert from "node:assert/strict";
import { FrameGuard, GUARD } from "../scripts/weather/guard.mjs";

const F = 18.2, S = 3;
const run = (g, n, dt) => { let maxStep = 0, q = g.q; for ( let i = 0; i < n; i++ ) { const q2 = g.step(dt(i), F, S); maxStep = Math.max(maxStep, Math.abs(q2 - q)); q = q2; } return maxStep; };

// on time: stays at 1
let g = new FrameGuard(); run(g, 600, () => F); assert.equal(g.q, 1);
// one lone 60 ms hitch every second: still 1
g = new FrameGuard(); run(g, 600, (i) => (i % 55 === 0 ? 60 : F)); assert.equal(g.q, 1, "lone hitches do not lower it");
// stalls (tab switch, a load) are not counted
g = new FrameGuard(); run(g, 50, (i) => (i % 2 ? 400 : F)); assert.equal(g.q, 1, "stalls do not count");
// sustained: every frame 2 vsyncs late (a GPU-bound 24 ms frame): q falls to the floor within a few seconds, in small steps
g = new FrameGuard(); const st = run(g, 300, () => 24.2);
assert.equal(g.q, GUARD.qMin, "falls to the floor");
assert.ok(st < 0.02, `small steps (${st})`);
// half the frames late: lowers too
g = new FrameGuard(); run(g, 200, (i) => (i % 2 ? 24.2 : F)); assert.ok(g.q < 0.9, "half late lowers it");
// recovers after HOLD of on-time frames, slowly
g.late = 1; run(g, 400, () => 24.2); const low = g.q;
const s2 = run(g, 60, () => F); assert.ok(g.q - low < 0.01, "holds first");
run(g, 1200, () => F); assert.equal(g.q, 1, "comes back");
assert.ok(s2 < 0.01);
console.log("all weather guard checks passed");
