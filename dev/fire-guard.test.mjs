// The fire's adaptive guard (2026-11-09): the fire now follows the client's one frame guard (scripts/frame-guard.mjs, the weather's
// guard moved there unchanged) through fire/guard.mjs. Checked here:
//  A. the OLD fire guard (its own 4 levels, reproduced below as it was) had the four faults the weather guard had: no recovery under
//     background noise, a frame estimate that climbs under the overload, a late threshold wrong at 165 Hz under Foundry's 60 fps cap,
//     a fall to the floor / pumping under a lasting load; the shared guard driving the fire has none of them.
//  B. the fire's detail follows q smoothly (budget, particles; 6 fps art only near the floor, with hysteresis).
//  C. fire + weather on ONE guard under a shared load: steps once a frame whoever asks first, one back-off; back to full after the
//     load, held steady under a lasting one; why not two guards: two independent ones both cut on the same frames and trip twice.
//  D. guardQ / guardOff: one step per drawn frame for both layers; a layer switched off does not reset the guard the other still uses.
import assert from "node:assert/strict";
import { FrameGuard, GUARD, lateTest, G, guardQ, guardOff, setPacingOverride } from "../scripts/frame-guard.mjs";
import { fireDetail, fireLevel, levelOf, F_MIN } from "../scripts/fire/guard.mjs";

/* ---------------------------------------------------------------- the old fire guard, as it was (display.mjs adapt, before 2026-11-09) */
class OldFireGuard {
  constructor() { this.level = 0; this.base = 0; this.press = 0; this.stepAt = 0; this.upAt = 0; this.calm = 3000; this._ri = 0; this._rn = 0; this.ring = new Float32Array(120); this.srt = new Float32Array(120); }
  step(ms, pn) {
    if ( !(ms >= 4) || ms > 250 ) return false;
    const N = 120, ring = this.ring, srt = this.srt;
    ring[this._ri % N] = ms; this._ri++; if ( this._rn < N ) this._rn++;
    if ( this._rn < 30 ) return false;
    if ( !this.base || this._ri % 30 === 0 ) { srt.set(ring); srt.sort(); this.base = Math.min(16.7, Math.max(6.5, srt[N - this._rn + Math.floor(this._rn * 0.2)])); }
    const long = ms > Math.max(this.base * 1.5, this.base + 4);
    this.press = this.press * 0.95 + (long ? 0.05 : 0);
    if ( this.press > 0.25 && this.level < 3 && pn - this.stepAt > 1000 ) {
      if ( this.upAt && pn - this.upAt < 3000 ) this.calm = Math.min(30000, (this.calm || 3000) * 2);
      this.level++; this.stepAt = pn; this.upAt = 0; this.press = 0.1;
    } else if ( this.press < 0.02 && this.level > 0 && pn - this.stepAt > (this.calm || 3000) ) { this.level--; this.stepAt = this.upAt = pn; }
    return long;
  }
  get detail() { return [1, 0.5, 0.3, 0.2][this.level]; }
}
// the new one, as the fire sees it: the shared guard's q mapped to the fire's level
class NewFireGuard {
  constructor() { this.g = new FrameGuard(); }
  setPace(P) { this.L = P; }
  step(ms) { this.g.step(ms, this.L.frame, this.L.slack); }
  get detail() { return fireLevel(this.g.q); }
}

/* a display: frames at `hz`, at least `k` vsyncs each (or PIXI's own 60 fps cap: minElapsed logic, as Ticker.update); the frame's work
   is work(detail) ms and it shows on the first vsync after it is done; `noise` = share of frames one vsync late whatever we draw */
function display({ hz, k = 1, cap60 = false, secs, work, noise = 0, seed = 1, guard, jit = 0, t0 = 0 }) {
  const P = 1000 / hz; let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  guard.setPace?.(lateTest({ period: P, k: cap60 ? null : k, cap: cap60 ? 60 : 0 }));
  const rows = []; let t = t0, last = t0, lastFrame = t0, busyTo = t0; const t1 = t0 + secs * 1000;
  while ( t < t1 ) {
    t += P;                                   // a vsync
    if ( t < busyTo - 1e-6 ) continue;        // the frame before is not done yet
    if ( cap60 ) { const e = t - lastFrame; if ( e < 1000 / 60 ) continue; lastFrame = t - (e % (1000 / 60)); }
    else if ( Math.round((t - last) / P) < k ) continue;
    let dt = t - last; if ( jit ) dt += (rnd() * 2 - 1) * jit;
    last = t;
    guard.step(dt, t);
    let w = work(guard.detail); if ( rnd() < noise ) w += P;
    busyTo = t + w;
    rows.push([t, guard.detail, dt]);
  }
  return { rows, end: t };
}
const backAt = (rows, from) => { for ( const [t, d] of rows ) if ( t >= from && d >= 0.999 ) return (t - from) / 1000; return Infinity; };
const rises = (rows) => { let n = 0, prev = 1, dir = 0; for ( const [, d] of rows ) { const s = Math.sign(d - prev); if ( s > 0 && dir <= 0 ) n++; if ( s ) dir = s; prev = d; } return n; };

/* ---------------------------------------------------------------- A1: recovery under background noise */
for ( const noise of [0.05, 0.1, 0.17] ) {
  const hz = 60, P = 1000 / hz, heavy = () => 2.5 * P, light = () => 0.5 * P;
  const o = new OldFireGuard(), a = display({ hz, secs: 6, work: heavy, guard: o });
  display({ hz, secs: 0.1, work: light, guard: o, t0: a.end });
  const ob = display({ hz, secs: 60, work: light, noise, seed: 3, guard: o, t0: a.end });
  const n = new NewFireGuard(), b = display({ hz, secs: 6, work: heavy, guard: n });
  const nb = display({ hz, secs: 60, work: light, noise, seed: 3, guard: n, t0: b.end });
  const oBack = backAt(ob.rows, a.end), nBack = backAt(nb.rows, b.end);
  console.log(`A1 noise ${noise}: old back to full ${oBack === Infinity ? "never (60 s)" : oBack.toFixed(1) + " s"}, new ${nBack.toFixed(1)} s`);
  assert.ok(nBack < oBack, `new comes back sooner than the old (${nBack} vs ${oBack})`);
  assert.ok(nBack <= 14, `new: back to full in ${nBack.toFixed(1)} s`);
  const tail = nb.rows.filter(([t]) => t > b.end + 30000), atFull = tail.filter(([, d]) => d >= 0.999).length / tail.length;
  const mean = tail.reduce((m, x) => m + x[1], 0) / tail.length;
  console.log(`   last 30 s: new at full ${(atFull * 100).toFixed(0)} % of frames, mean ${mean.toFixed(2)}`);
  if ( noise <= 0.1 ) assert.equal(atFull, 1, "new: stays at full");
  // (a sixth of the frames a whole frame late at 60 Hz: the shared guard's 0.4 s share crosses ENTER by chance every few seconds and
  // each such trip after a rise is taken for the rise's: it comes back first, then walks down again. A limit of the shared (weather)
  // guard, left as it is here - its behaviour may not change in this commit - and reported; printed, not asserted.)
}

/* ---------------------------------------------------------------- A2: the frame estimate climbing under the overload */
{
  // 144 Hz, every frame one vsync late (2 vsyncs: 72 fps instead of 144) for 20 s from the start of a scene
  const hz = 144, P = 1000 / hz, work = () => 1.3 * P;
  const o = new OldFireGuard(), r = display({ hz, secs: 20, work, guard: o });
  const n = new NewFireGuard(), rn = display({ hz, secs: 20, work, guard: n });
  console.log(`A2 144 Hz, half the frame rate for 20 s: old level ${o.level} (base ${o.base.toFixed(1)} ms: the overloaded interval itself), new detail ${n.detail.toFixed(2)}`);
  assert.equal(o.level, 0, "old: blind to it (its base climbed to the overloaded interval)");
  assert.ok(Math.abs(o.base - 2 * P) < 0.2);
  assert.ok(n.detail <= F_MIN + 1e-9, "new: sees it (judged against the real vsync)");
  void r; void rn;
}

/* ---------------------------------------------------------------- A3: the late threshold at 165 Hz under Foundry's 60 fps cap */
{
  const hz = 165, P = 1000 / hz;
  // (a) on time with timestamp jitter (PIXI's cap at 165 Hz gives 2- and 3-vsync intervals): never lowered
  const o = new OldFireGuard(), n = new NewFireGuard();
  display({ hz, cap60: true, secs: 60, work: () => 2, jit: 1.2, guard: o });
  display({ hz, cap60: true, secs: 60, work: () => 2, jit: 1.2, guard: n });
  // (b) every frame one vsync late (a missed vsync each frame: 41 fps instead of 55)
  const o2 = new OldFireGuard(), n2 = new NewFireGuard(), w2 = () => 3 * P + 0.5;
  display({ hz, cap60: true, secs: 20, work: w2, guard: o2 }); display({ hz, cap60: true, secs: 20, work: w2, guard: n2 });
  console.log(`A3 165 Hz cap 60: on time with jitter -> old level ${o.level}, new ${n.detail.toFixed(2)}; a missed vsync every frame -> old level ${o2.level} (base ${o2.base.toFixed(1)}), new ${n2.detail.toFixed(2)}`);
  assert.equal(n.detail, 1, "new: jitter under the cap never lowers it");
  assert.ok(o.level > 0, "old: lowered by the cap's own 2- and 3-vsync intervals with jitter");
  assert.equal(o2.level, 0, "old: a missed vsync every frame under the cap at 165 Hz went unseen");
  assert.ok(n2.detail < 0.5, "new: sees it");
}

/* ---------------------------------------------------------------- A4: a lasting load the fire can partly relieve */
for ( const [hz, k, cap60] of [[60, 1, false], [144, 1, false], [165, 3, true]] ) {
  const P = 1000 / hz * k, work = (d) => 0.55 * P + 0.6 * P * (0.3 + 0.7 * d);   // on time from detail ~0.8 down
  const o = new OldFireGuard(), n = new NewFireGuard();
  const ro = display({ hz, k, cap60, secs: 120, work, guard: o }), rn = display({ hz, k, cap60, secs: 120, work, guard: n });
  const tail = (r) => r.rows.filter(([t]) => t > 20000), min = (r) => Math.min(...tail(r).map((x) => x[1]));
  const lateShare = (r) => { const T = tail(r), f = cap60 ? 3 * (1000 / hz) : P; return T.filter(([, , dt]) => dt > f + 4).length / T.length; };
  const mean = (r) => tail(r).reduce((m, x) => m + x[1], 0) / tail(r).length;
  console.log(`A4 ${hz} Hz${cap60 ? " cap 60" : ""}: old ${rises(ro.rows)} rises, min ${min(ro).toFixed(2)}, mean ${mean(ro).toFixed(2)}, late ${(lateShare(ro) * 100).toFixed(0)} % | new ${rises(rn.rows)} rises, min ${min(rn).toFixed(2)}, mean ${mean(rn).toFixed(2)}, late ${(lateShare(rn) * 100).toFixed(0)} %`);
  assert.ok(rises(rn.rows) <= 120000 / GUARD.bMax + 4, "new: no pumping");
  assert.ok(min(rn) > F_MIN + 0.1, "new: not dropped to the floor under a load it can relieve");
  const after = display({ hz, k, cap60, secs: 40, work: () => 0.4 * P, guard: n, t0: rn.end, seed: 4 });
  assert.ok(backAt(after.rows, rn.end) <= GUARD.bMax / 1000 + 6, "new: full again after it");
}

/* ---------------------------------------------------------------- B: the fire's detail follows q smoothly */
{
  assert.equal(fireLevel(1), 1); assert.equal(fireLevel(GUARD.qMin), F_MIN); assert.equal(levelOf(1), 0);
  const d = { budget: 1, fps6: false, parts: 1 }; let toggles = 0, maxB = 0, maxP = 0, prev = { ...d };
  // q swept down and up in the guard's smallest steps (0.6 / s at 165 Hz) and dithered around the 6 fps edge
  const qs = []; for ( let q = 1; q >= GUARD.qMin; q -= 0.6 / 165 ) qs.push(q);
  const qEdge = GUARD.qMin + (0.34 - F_MIN) * (1 - GUARD.qMin) / (1 - F_MIN);   // (f 0.34: between the 6 fps edges)
  for ( let q = GUARD.qMin; q < qEdge; q += 0.25 / 165 ) qs.push(q);
  for ( let i = 0; i < 400; i++ ) qs.push(qEdge + 0.006 * Math.sin(i / 3));
  for ( let q = qEdge; q <= 1; q += 0.25 / 165 ) qs.push(q);
  // (continuous: a change of q moves the budget at most 1.23 times as much, the particles' share at most 6.2 times - over q 0.35-0.51)
  let qp = 1;
  for ( const q of qs ) {
    fireDetail(q, d); const dq = Math.abs(q - qp) || 1e-9; qp = q;
    maxB = Math.max(maxB, Math.abs(d.budget - prev.budget) / dq); maxP = Math.max(maxP, Math.abs(d.parts - prev.parts) / dq);
    if ( d.fps6 !== prev.fps6 ) toggles++; prev = { ...d };
  }
  assert.ok(maxB < 1.24 && maxP < 6.2, `continuous (budget ${maxB.toFixed(3)}, particles ${maxP.toFixed(3)} per unit of q)`);
  assert.equal(toggles, 2, "6 fps art: on once near the floor, off once on the way up, no flicker");
  fireDetail(1, d); assert.deepEqual(d, { budget: 1, fps6: false, parts: 1 });
}

/* ---------------------------------------------------------------- C: fire + weather under a shared load */
{
  const cf = (f) => 0.3 + 0.7 * f, cw = (q) => 0.3 + 0.7 * q;
  // BEFORE: the old fire guard and the weather guard each on their own (two algorithms on the same late frames) vs NOW: one guard
  function shared({ hz, k, cap60, secs, work, before, gs, t0 = 0, seed = 1, noise = 0 }) {
    const P = 1000 / hz, L = lateTest({ period: P, k: cap60 ? null : k, cap: cap60 ? 60 : 0 });
    const [gf, gw] = gs, fl = () => (before ? gf.detail : fireLevel(gw.q));
    const gd = { setPace() {}, step(dt, t) { gw.step(dt, L.frame, L.slack); if ( before ) gf.step(dt, t); }, get detail() { return Math.min(fl(), gw.q); } };
    const r = display({ hz, k, cap60, secs, noise, seed, t0, guard: gd, work: () => work(fl(), gw.q) });
    return r;
  }
  for ( const [hz, k, cap60] of [[60, 1, false], [144, 1, false], [165, 3, true]] ) {
    const P = 1000 / hz * k, tag = `${hz} Hz${cap60 ? " cap 60" : ""}`;
    const work = (f, w) => 0.45 * P + 0.4 * P * cf(f) + 0.4 * P * cw(w);   // full: 1.25 frames; fits from about both at 0.6
    const res = {};
    for ( const before of [true, false] ) {
      const gs = [new OldFireGuard(), new FrameGuard()];
      const a = shared({ hz, k, cap60, secs: 120, work, before, gs });
      const fireAt = before ? gs[0].detail : fireLevel(gs[1].q), wAt = gs[1].q;
      const T = a.rows.filter(([t]) => t > 20000), f = cap60 ? 3 * (1000 / hz) : P;
      const late = T.filter(([, , dt]) => dt > f + 4).length / T.length;
      const b = shared({ hz, k, cap60, secs: 60, work: () => 0.4 * P, before, gs, t0: a.end, seed: 6, noise: 0.06 });
      const back = backAt(b.rows, a.end), r = rises(a.rows);
      res[before ? "before" : "now"] = { late, back, r };
      console.log(`C ${tag} ${before ? "before (old fire guard + weather guard)" : "now (one guard)                       "}: lasting shared load: late ${(late * 100).toFixed(1)} %, ${r} rises / 120 s, at its end fire ${fireAt.toFixed(2)} weather ${wAt.toFixed(2)}; gone: both full in ${back === Infinity ? "never (60 s)" : back.toFixed(1) + " s"}`);
    }
    assert.ok(res.now.r <= 120000 / GUARD.bMax + 4, `${tag}: one guard, no pumping`);
    assert.ok(res.now.back <= GUARD.bMax / 1000 + 6, `${tag}: back to full after the shared load`);
    assert.ok(res.now.late <= res.before.late + 0.01, `${tag}: no more late frames than before`);
  }
}

/* ---------------------------------------------------------------- D: guardQ / guardOff */
{
  const T = { lastTime: 0, elapsedMS: 16.7 };
  globalThis.canvas = { app: { ticker: T } };
  setPacingOverride({ frame: 16.7, slack: 8 });
  G.reset();
  let steps = 0; const st = G.step.bind(G); G.step = (...a) => { steps++; return st(...a); };
  for ( let i = 1; i <= 50; i++ ) { T.lastTime = i * 16.7; guardQ("weather"); guardQ("fire"); guardQ("weather"); }
  assert.equal(steps, 50, "one step per drawn frame whoever asks");
  T.elapsedMS = 50; for ( let i = 51; i <= 200; i++ ) { T.lastTime = i * 50; guardQ("fire"); }
  const q = G.q; assert.ok(q < 1, "lowered by late frames");
  guardOff("weather"); assert.equal(G.q, q, "the weather switched off: the guard goes on for the fire");
  guardOff("fire"); assert.equal(G.q, 1, "nobody asks: it starts over");
  G.step = st; setPacingOverride(null); delete globalThis.canvas;
}
console.log("all fire guard checks passed");
