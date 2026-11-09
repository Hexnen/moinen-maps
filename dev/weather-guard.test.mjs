// The weather frame guard (scripts/weather/guard.mjs): lone hitches, stalls and timestamp jitter leave it alone; sustained late frames
// lower q smoothly to its floor; once the load is gone it comes back to 1 in a few seconds, also with background noise (a late frame
// never resets the hold), at 60, 144 and 165 Hz alike; a lasting load is held steady under it (no up-down-up pumping), and q never
// sticks low once the load has gone.
import assert from "node:assert/strict";
import { FrameGuard, GUARD, lateTest, vsyncFloor } from "../scripts/weather/guard.mjs";

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
assert.ok(st < 0.03, `small steps (${st})`);
// half the frames late: lowers too
g = new FrameGuard(); for ( let i = 0; i < 200; i++ ) g.step(i % 2 ? 33.3 : 16.7, 16.7, 8.3); assert.ok(g.q < 0.9, "half the frames a vsync late (60 Hz) lowers it");
// a few LONG hitches (1 frame in 5 at 50 ms, the rest on time: 40 fps instead of 55 at 165 Hz / 3 vsyncs) lower it too
g = new FrameGuard(); for ( let i = 0; i < 300; i++ ) g.step(i % 5 ? 18.2 : 50, 18.2, 4); assert.ok(g.q < 0.9, `long hitches lower it (${g.q})`);
// but one vsync over a 3-vsync frame now and then (1 in 6) does not
g = new FrameGuard(); for ( let i = 0; i < 600; i++ ) g.step(i % 6 ? 18.2 : 24.2, 18.2, 4); assert.equal(g.q, 1, "an odd extra vsync at k 3");
// recovers after HOLD of on-time frames, smoothly
run(g, 400, () => 24.2); const low = g.q;
const s2 = run(g, 60, () => F); assert.ok(g.q - low < 0.01, "holds first");
run(g, 400, () => F); assert.equal(g.q, 1, "comes back");
assert.ok(s2 < 0.01);

/* ---------------------------------------------------------------- the late-frame test per display */
const vs = (hz) => 1000 / hz;
{
  // 60 Hz, 1 vsync a frame: half a vsync of slack
  const t = lateTest({ period: vs(60), k: 1, cap: 60 });
  assert.ok(Math.abs(t.frame - 16.667) < 0.01 && Math.abs(t.slack - 8.333) < 0.01);
  // 144 Hz uncapped: 4 ms of slack (more than half a vsync: jitter), a missed vsync (13.9 ms) is late
  const u = lateTest({ period: vs(144), k: 1, cap: 0 });
  assert.ok(vs(144) + 2.5 <= u.frame + u.slack && 2 * vs(144) > u.frame + u.slack, "144 Hz: jitter on time, a missed vsync late");
  // 165 Hz under Foundry's own 60 fps cap (pacing "foundry", k unknown): 3 vsyncs (18.2 ms) is on time even with jitter, 4 late
  const w = lateTest({ period: vs(165), k: null, cap: 60 });
  assert.ok(Math.abs(w.frame - 3 * vs(165)) < 0.01, `165/60: 3 vsyncs (${w.frame})`);
  assert.ok(3 * vs(165) + 1.5 <= w.frame + w.slack && 4 * vs(165) > w.frame + w.slack);
  // 240 Hz: a missed vsync is still late
  const x = lateTest({ period: vs(240), k: 1, cap: 0 }); assert.ok(2 * vs(240) > x.frame + x.slack);
  // no measured rate: the guard waits
  assert.equal(lateTest({ period: null }).frame, null);
}

/* ---------------------------------------------------------------- a display model: load, noise, jitter */
// frames at `hz` (k vsyncs each); the frame's work is `work(q)` ms, it shows on the first vsync after it is done; `noise` = the share
// of frames a vsync late whatever the weather does (Foundry, the browser); `jit` = timestamp jitter (ms, +-).
function sim({ hz = 60, k = 1, secs, work = () => 1, noise = 0, jit = 0, seed = 1, g = new FrameGuard(), cap = 0, t0 = 0 }) {
  const P = 1000 / hz, L = lateTest({ period: P, k, cap });
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const rows = []; let t = t0, maxStep = 0;
  const t1 = t + secs * 1000;
  while ( t < t1 ) {
    let n = Math.max(k, Math.ceil(work(g.q) / P - 1e-9));
    if ( rnd() < noise ) n += 1;
    const dt = n * P + (jit ? (rnd() * 2 - 1) * jit : 0);
    const q0 = g.q; g.step(dt, L.frame, L.slack); maxStep = Math.max(maxStep, Math.abs(g.q - q0));
    t += dt; rows.push([t, g.q]);
  }
  return { g, rows, maxStep, end: t };
}
const backAt = (rows, from) => { for ( const [t, q] of rows ) if ( t >= from && q >= 1 ) return (t - from) / 1000; return Infinity; };

for ( const [hz, k, cap] of [[60, 1, 60], [144, 1, 0], [144, 2, 60], [165, null, 60]] ) {
  const P = 1000 / hz, kk = k ?? 3, Pk = P * kk, tag = `${hz} Hz ${k ? `k ${k}` : "foundry cap 60"}`;
  // timestamp jitter on a fast / variable-rate display: never lowers it
  const r = sim({ hz, k: kk, cap, secs: 60, jit: Math.min(2.5, P * 0.45) });
  assert.equal(r.g.q, 1, `${tag}: jitter never lowers it`);
  for ( const noise of [0, 0.03, 0.06, 0.12] ) {
    // 6 s of a heavy overload (late even at the floor), then gone: back to 1 in a few seconds (slower with heavy noise, never
    // stuck), with no overload on the way back
    const g0 = new FrameGuard();
    const a = sim({ hz, k: kk, cap, secs: 6, noise, g: g0, work: (q) => 0.6 * Pk + 2.2 * Pk * (0.3 + 0.7 * q) });
    assert.ok(a.g.q < 0.8, `${tag} noise ${noise}: the overload lowers it (${a.g.q.toFixed(2)})`);
    const trips = a.g.trips;
    const b = sim({ hz, k: kk, cap, secs: 30, noise, g: g0, seed: 7, t0: a.end });
    const back = backAt(b.rows, a.end), lim = noise >= 0.1 ? 14 : 6;
    assert.ok(back <= lim, `${tag} noise ${noise}: back to full in ${back.toFixed(1)} s (<= ${lim})`);
    assert.ok(b.g.trips - trips <= (noise >= 0.1 ? 1 : 0), `${tag} noise ${noise}: no overload on the way back (${b.g.trips - trips})`);
    // (a step is the rate times the frame: under 0.045 even for a 4-vsync frame at 60 Hz, gliding at 0.6 / s)
    assert.ok(b.maxStep < 0.045 && a.maxStep < 0.045, `${tag}: small steps (${a.maxStep.toFixed(4)} ${b.maxStep.toFixed(4)})`);
    assert.equal(b.rows[b.rows.length - 1][1], 1, `${tag} noise ${noise}: stays at full`);
  }
  // a LASTING load the weather can partly relieve (on time from q ~0.6 down): held steady under it, re-tried at most every BMAX (no
  // pumping each second); once the load goes, full again within a back-off and a ramp
  const g1 = new FrameGuard();
  const c = sim({ hz, k: kk, cap, secs: 120, g: g1, work: (q) => 0.55 * Pk + 0.625 * Pk * (0.3 + 0.7 * q) });
  let rises = 0, prev = 1, dir = 0;
  for ( const [, q] of c.rows ) { const d = Math.sign(q - prev); if ( d > 0 && dir <= 0 ) rises++; if ( d ) dir = d; prev = q; }
  assert.ok(rises <= 120000 / GUARD.bMax + 4, `${tag}: lasting load, ${rises} rises in 120 s (no pumping)`);
  const tail = c.rows.filter(([t]) => t > 20000), hiShare = tail.filter(([, q]) => q > 0.72).length / tail.length;
  assert.ok(hiShare < 0.15, `${tag}: held under the load (${(hiShare * 100).toFixed(0)} % of frames over it)`);
  assert.ok(tail.filter(([, q]) => q < 0.45).length / tail.length < 0.2, `${tag}: not dropped far below what the load needs`);
  const d = sim({ hz, k: kk, cap, secs: 40, g: g1, seed: 3, t0: c.end });
  const back = backAt(d.rows, c.end);
  assert.ok(back <= GUARD.bMax / 1000 + 6, `${tag}: after a lasting load, full again in ${back.toFixed(1)} s`);
  console.log(`${tag}: lasting load ${rises} rises / 120 s, back ${back.toFixed(1)} s after it`);
}
console.log("all weather guard checks passed");

/* ---------------------------------------------------------------- the display's real vsync under an overload */
{
  // raw rAF interval spreads measured at 165 Hz (counts per number of vsyncs): idle, every weather pass x12, x30
  const P = vs(165), mk = (h) => Object.entries(h).flatMap(([n, c]) => Array.from({ length: c }, (_, i) => n * P + ((i % 5) - 2) * 0.15));
  for ( const [name, h] of [["idle", { 1: 100, 2: 3 }], ["x12", { 1: 29, 2: 5, 3: 22, 4: 6 }], ["x30", { 1: 35, 2: 2, 3: 2, 5: 3, 6: 7, 7: 25, 8: 40 }]] ) {
    const iv = mk(h).slice(-120), f = vsyncFloor(iv);
    assert.ok(Math.abs(f - P) < 0.3, `${name}: the real vsync (${f?.toFixed(2)} vs ${P.toFixed(2)})`);
  }
  // a stray half interval or two never counts; a 60 Hz display reads 60 Hz
  assert.ok(Math.abs(vsyncFloor([3, 3.1, ...Array(40).fill(16.7)]) - 16.7) < 0.01);
  assert.equal(vsyncFloor([16.7, 16.6]), null);
}
console.log("vsync floor checks passed");

/* ---------------------------------------------------------------- a load hovering at the threshold (measured live: x12 at DPR 2) */
{
  // the share of lost frames hovers just under and over ENTER at full detail and falls away below q ~0.85: no slow 0.88 <-> 1 pump
  const g = new FrameGuard(), P = 1000 / 165, Lt = lateTest({ period: P, k: 3, cap: 60 });
  let s = 9, t = 0, rises = 0, prev = 1, dir = 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  while ( t < 120000 ) {
    const p = Math.max(0, (g.q - 0.8) * 2);            // the chance this frame comes two or three vsyncs late
    const dt = rnd() < p ? (rnd() < 0.5 ? 5 : 6) * P : 3 * P;
    g.step(dt, Lt.frame, Lt.slack); t += dt;
    const d = Math.sign(g.q - prev); if ( d > 0 && dir <= 0 ) rises++; if ( d ) dir = d; prev = g.q;
  }
  assert.ok(rises <= 120000 / GUARD.bMax + 4, `hovering load: ${rises} rises in 120 s`);
  console.log(`hovering load: ${rises} rises / 120 s, q ${g.q.toFixed(2)}`);
}

/* ---------------------------------------------------------------- 2026-11-09: noise vs overload, the sticky vsync */
{
  const FG = await import("../scripts/frame-guard.mjs");
  const OLD = { z: 0, noiseCap: 0 };   // (ENTER fixed at 0.3: the guard before the noise threshold)
  const DISP = [[60, 1, 60], [144, 1, 0], [165, 3, 60], [240, 1, 0]];
  // PURE NOISE (no overload: 0-20 % of the frames a vsync late at random), 120 s, 3 seeds: q stays at or near 1 at every cadence
  for ( const [hz, k, cap] of DISP ) {
    const P = 1000 / hz * k, row = [];
    for ( const noise of [0, 0.05, 0.1, 0.15, 0.2] ) {
      const m = {};
      for ( const [nm, o] of [["old", OLD], ["new", {}]] ) {
        let mq = 0, trips = 0;
        for ( const seed of [1, 2, 3] ) {
          const g = new FrameGuard(o), r = sim({ hz, k, cap, secs: 120, noise, seed, g, work: () => 0.5 * P });
          const tl = r.rows.filter(([t]) => t > 10000); mq += tl.reduce((a, x) => a + x[1], 0) / tl.length / 3; trips += g.trips / 3;
        }
        m[nm] = { mq, trips };
      }
      row.push(`${noise}: old ${m.old.mq.toFixed(2)} new ${m.new.mq.toFixed(2)}`);
      assert.ok(m.new.mq >= 0.97, `${hz} Hz noise ${noise}: pure noise keeps q near 1 (${m.new.mq.toFixed(3)})`);
      assert.ok(m.new.trips <= 1.5, `${hz} Hz noise ${noise}: no overload taken from noise (${m.new.trips.toFixed(1)} trips / 120 s)`);
    }
    console.log(`pure noise ${hz} Hz (mean q, 120 s): ${row.join(" | ")}`);
  }
  // REAL OVERLOAD still trips as fast: 20 s of noise, then every frame 2 vsyncs late (or worse); ms to the first trip
  const tripAt = (o, [hz, k, cap], noise, w, seed) => {
    const P = 1000 / hz, Pk = P * k, L = lateTest({ period: P, k, cap }), g = new FrameGuard(o);
    let s = seed, t = 0, tr0 = null; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    while ( t < 30000 ) {
      const on = t >= 20000; if ( on && tr0 === null ) tr0 = g.trips;
      let n = Math.max(k, Math.ceil((on ? w * Pk : 0.5 * Pk) / P - 1e-9)); if ( rnd() < noise ) n += 1;
      const dt = n * P; g.step(dt, L.frame, L.slack); t += dt;
      if ( on && g.trips > tr0 ) return t - 20000;
    }
    return Infinity;
  };
  for ( const d of DISP ) for ( const noise of [0, 0.1, 0.2] ) for ( const w of [2.2, 1.15] ) {
    let a = 0, b = 0;
    for ( const seed of [1, 2, 3, 4, 5] ) { a += tripAt(OLD, d, noise, w, seed) / 5; b += tripAt({}, d, noise, w, seed) / 5; }
    if ( noise === 0 ) assert.equal(b, a, `${d[0]} Hz: without noise an overload trips exactly as before`);
    else assert.ok(b <= Math.max(a, 150) + 150 && b < 1500, `${d[0]} Hz noise ${noise} load ${w}: trips in ${b.toFixed(0)} ms (was ${a.toFixed(0)})`);
  }
  console.log("real overload trips as fast (no noise: identical; with noise: within 150 ms)");

  // THE STICKY VSYNC (stickyVsync): reads once a second
  const P165 = 1000 / 165, run = (secs, cand, busy, st, t0) => { let p; for ( let s = 1; s <= secs; s++ ) p = FG.stickyVsync(st, cand, busy, t0 + s * 1000); return p; };
  let st = { period: null, longAt: null };
  run(5, P165, 2, st, 0);
  assert.ok(Math.abs(run(60, 4 * P165, 26, st, 5000) - P165) < 1e-9, "a CPU overload (every frame 4 vsyncs, 26 ms of work) for a minute: kept");
  assert.ok(Math.abs(run(15, 4 * P165, 3, st, 65000) - P165) < 1e-9, "a GPU-bound multiple: kept for 15 s");
  assert.ok(Math.abs(run(10, 4 * P165, 3, st, 80000) - 4 * P165) < 1e-9, "... taken after 20 s of nothing shorter (a real 4x slower display)");
  st = { period: P165, longAt: null };
  assert.ok(Math.abs(run(3, 1000 / 60, 3, st, 0) - P165) < 1e-9 && Math.abs(run(2, 1000 / 60, 3, st, 3000) - 1000 / 60) < 1e-9, "moved to a 60 Hz monitor: taken after ~4 s");
  assert.ok(Math.abs(run(1, 1000 / 144, 3, st, 9000) - 1000 / 144) < 1e-9, "back on a faster monitor: at once");
  st = { period: 1000 / 120, longAt: null };
  assert.ok(Math.abs(run(19, 1000 / 60, 3, st, 0) - 1000 / 120) < 1e-9 && Math.abs(run(2, 1000 / 60, 3, st, 19000) - 1000 / 60) < 1e-9, "a laptop throttling 120 -> 60 Hz: taken after 20 s");
  st = { period: P165, longAt: null };
  assert.ok(Math.abs(run(30, 1000 / 60, 14, st, 0) - P165) < 1e-9, "a longer period explained by the frames' work is never taken");

  // OLD vs NEW under a constant CPU overload at 165 Hz (k 1): 26 ms of work a frame (5 vsyncs, every frame), the ring of the last 120
  // rAF intervals, the period re-read once a second: the old floor reads the overloaded interval after ~3 s and the guard goes blind
  for ( const sticky of [false, true] ) {
    const g = new FrameGuard(), ring = [], st2 = { period: null, longAt: null };
    let t = 0, nextRead = 0, L = null, qAt = null, qMinSeen = 1;
    while ( t < 40000 ) {
      const on = t >= 10000, dt = on ? 5 * P165 : P165;
      ring.push(dt + ((t * 7) % 3 - 1) * 0.05); if ( ring.length > 120 ) ring.shift();
      if ( t >= nextRead ) { nextRead += 1000; const f = FG.vsyncFloor(ring); const p = sticky ? FG.stickyVsync(st2, f, on ? 26 : 2, t) : f; if ( p ) L = lateTest({ period: p, k: 1, cap: 0 }); }
      if ( L ) g.step(dt, L.frame, L.slack); qMinSeen = Math.min(qMinSeen, g.q);
      t += dt; if ( t > 20000 && qAt === null ) qAt = g.q;
    }
    console.log(`constant CPU overload 165 Hz, ${sticky ? "sticky vsync" : "old floor  "}: lowest q ${qMinSeen.toFixed(2)}, q at 10 s of overload ${qAt.toFixed(2)}, at 30 s ${g.q.toFixed(2)}`);
    if ( sticky ) assert.equal(g.q, GUARD.qMin, "sticky: the overload stays seen (to the floor)");
    else assert.ok(g.q > GUARD.qMin + 0.1, "old: went blind (q back up while the overload lasts)");
  }
}
console.log("noise and sticky vsync checks passed");
