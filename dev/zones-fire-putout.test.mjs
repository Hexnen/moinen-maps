// D205 (FF6): the fire roll is per zone. Putting out ONE zone of a painted fire stroke that reaches over several zones must leave the
// other zones burning, and the zone put out must read no fire afterwards (scripts/zones/link.mjs putOutPlan, fireIn with erasers).
// Before: a stroke went out whole when half of it lay in the zone (its neighbours went out too) and not at all when less did.
import assert from "node:assert/strict";
import { fireIn, derive, putOutPlan, erasersOf, samplesOf } from "../scripts/zones/link.mjs";

const ok = (name) => console.log(`ok   ${name}`);
const step = 25;

/** zones as rings -> Z for samplesOf; zoneAt is not used by samplesOf (it scans each zone's own rings) */
const ring = (...xy) => xy;
const zone = (id, r) => { let x = 0, y = 0; for ( let i = 0; i < r.length; i += 2 ) { x += r[i]; y += r[i + 1]; } return { id, rings: [r], label: { x: x / (r.length / 2), y: y / (r.length / 2), r: 50 } }; };
const states = (S, fire) => Object.fromEntries([...derive(S, { fire })].map(([id, o]) => [id, o.fire ?? 0]));
let q = 1000;
/** apply a plan as the zones do: strokes removed go out (o set), erasers are painted later in the order */
function apply(fire, plan) {
  for ( const id of plan.remove ) { const s = fire.find((x) => x.id === id); s.o = q; }
  plan.erase.forEach((e, i) => fire.push({ id: `er${q}${i}`, k: "erase", s: 1, r: e.r, p: e.p.map(Math.round), q: q + 1 }));
  q += 10;
}

// 1. three zones side by side (the Warehouse case: z7 / z10 / z11 under one stroke), one stroke across all three
{
  const Z = { zones: [zone(7, ring(0, 0, 400, 0, 400, 300, 0, 300)), zone(10, ring(400, 0, 700, 0, 700, 300, 400, 300)), zone(11, ring(700, 0, 1200, 0, 1200, 300, 700, 300))] };
  const S = samplesOf(Z, null, step);
  const fire = [{ id: "fmw7", k: "fire", r: 90, lv: 1, q: 1, p: [60, 150, 600, 140, 1150, 160] }];
  assert.deepEqual(states(S, fire), { 7: 6, 10: 6, 11: 6 });
  // round 1: z10 goes out (less than half of the stroke lies there: before, nothing happened)
  let plan = putOutPlan(S, 10, fire, step);
  assert.deepEqual(plan.remove, [], "the stroke burns in z7 and z11 too: it is cut, not put out");
  assert.ok(plan.erase.length >= 1);
  apply(fire, plan);
  assert.deepEqual(states(S, fire), { 7: 6, 11: 6 }, "z10 reads no fire, z7 and z11 burn on");
  // round 2: z7 stays, z11 goes out (before: z11 held half the stroke, the whole stroke went out, z7 with it)
  plan = putOutPlan(S, 11, fire, step);
  assert.deepEqual(plan.remove, []);
  apply(fire, plan);
  assert.deepEqual(states(S, fire), { 7: 6 }, "only z7 burns");
  // z7 goes out at last: nothing else burns from the stroke now, it goes out whole
  plan = putOutPlan(S, 7, fire, step);
  assert.deepEqual(plan.remove, ["fmw7"]);
  assert.deepEqual(plan.erase, []);
  apply(fire, plan);
  assert.deepEqual(states(S, fire), {});
  ok("one stroke over three zones: each zone goes out on its own roll, the others burn on");
}

// 2. every zone keeps exactly its own samples: the erasers of one zone never reach a sample of another (random maps, odd shapes)
{
  let seed = 11;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let cutRuns = 0;
  for ( let run = 0; run < 25; run++ ) {
    // a 3 x 3 board of zones with jagged inner borders (an L-, a T-shape here and there)
    const xs = [0, 300 + rnd() * 200, 700 + rnd() * 200, 1200], ys = [0, 250 + rnd() * 150, 600 + rnd() * 150, 1000];
    const zones = [];
    for ( let j = 0; j < 3; j++ ) for ( let i = 0; i < 3; i++ ) {
      const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1], nx = x1 - (x1 - x0) * 0.3;
      // a notch out of the lower right corner of some zones (not the last column / row: the board keeps no holes that matter here)
      zones.push(zone(j * 3 + i, (run + i + j) % 3 === 0 ? ring(x0, y0, x1, y0, x1, (y0 + y1) / 2, nx, (y0 + y1) / 2, nx, y1, x0, y1) : ring(x0, y0, x1, y0, x1, y1, x0, y1)));
    }
    const S = samplesOf({ zones }, null, step);
    const fire = [];
    for ( let k = 0; k < 4; k++ ) { const p = []; let x = rnd() * 1200, y = rnd() * 1000; for ( let n = 0; n < 6; n++ ) { p.push(Math.round(x), Math.round(y)); x += (rnd() - 0.5) * 500; y += (rnd() - 0.5) * 400; } fire.push({ id: `s${k}`, k: "fire", r: 40 + Math.round(rnd() * 120), lv: 1 + (k % 3), q: k + 1, p }); }
    const before = states(S, fire);
    const burningIds = Object.keys(before).map(Number);
    if ( !burningIds.length ) continue;
    const target = burningIds[Math.floor(rnd() * burningIds.length)];
    const hitsOf = (id) => fireIn(S.get(id), fire, erasersOf(fire)).map((f) => [f.s.id, f.hits]);
    const others = new Map([...S.keys()].filter((id) => id !== target).map((id) => [id, hitsOf(id)]));
    const plan = putOutPlan(S, target, fire, step);
    if ( plan.erase.length ) cutRuns++;
    apply(fire, plan);
    assert.deepEqual(hitsOf(target), [], `run ${run}: zone ${target} reads no fire`);
    for ( const [id, h] of others ) {
      // a stroke put out whole may only be one that made no other zone burn: those zones read what they read before, or less of
      // the strokes that went out whole (they burnt nowhere else - at most a sample or two there)
      const now = new Map(hitsOf(id)), was = new Map(h);
      for ( const [sid, n] of was ) if ( fire.find((s) => s.id === sid).o === undefined ) assert.equal(now.get(sid), n, `run ${run}: zone ${id} keeps its samples of ${sid}`);
    }
    for ( const id of burningIds ) if ( id !== target ) assert.equal(states(S, fire)[id], before[id], `run ${run}: zone ${id} burns on`);
  }
  assert.ok(cutRuns >= 10, `strokes were cut in ${cutRuns} of 25 runs`);
  console.log(`     (cut in ${cutRuns} of 25 runs)`);
  ok("random boards with notched zones: the zone put out reads no fire, no other zone loses a sample");
}

// 3. the GM's own eraser counts where it was painted after the stroke, not before (the fire layer's paint order)
{
  const Z = { zones: [zone(1, ring(0, 0, 300, 0, 300, 300, 0, 300))] };
  const S = samplesOf(Z, null, step);
  const fire = [{ id: "a", k: "fire", r: 60, lv: 2, q: 10, p: [150, 150] }];
  assert.deepEqual(states(S, fire), { 1: 8 });
  fire.push({ id: "e0", k: "erase", r: 120, q: 5, p: [150, 150] });
  assert.deepEqual(states(S, fire), { 1: 8 }, "an eraser painted before the stroke cuts nothing of it");
  fire.push({ id: "e1", k: "erase", r: 120, q: 20, p: [150, 150] });
  assert.deepEqual(states(S, fire), {}, "an eraser painted after the stroke puts it out there");
  fire[2].o = 30;
  assert.deepEqual(states(S, fire), { 1: 8 }, "an eraser undone (o set) lets the fire burn again");
  ok("erasers in the paint order: later ones cut, earlier and undone ones do not");
}

// 4. a stroke only in the zone goes out whole; a zone with no fire gets no plan
{
  const Z = { zones: [zone(1, ring(0, 0, 300, 0, 300, 300, 0, 300)), zone(2, ring(300, 0, 600, 0, 600, 300, 300, 300))] };
  const S = samplesOf(Z, null, step);
  const fire = [{ id: "a", k: "fire", r: 50, lv: 2, q: 1, p: [100, 100, 150, 200] }];
  assert.deepEqual(putOutPlan(S, 1, fire, step), { remove: ["a"], erase: [] });
  assert.deepEqual(putOutPlan(S, 2, fire, step), { remove: [], erase: [] });
  ok("a stroke burning in one zone only goes out whole; a zone without fire: nothing to do");
}
