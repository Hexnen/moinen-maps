// THE FRAME GUARD LIVE on an emulated display (page module; dev/guard-live-run.mjs drives it): the canvas ticker is stepped by hand on a
// virtual clock that behaves like a `hz` display (frames on whole vsyncs, at least k each, or PIXI's own 60 fps cap): each frame's
// REAL work is measured (the ticker step + a 1-pixel readPixels, so the GPU's part is in it) and a synthetic `load` (ms) is added; the
// next frame comes on the first vsync after that work. The guard judges the frames against that display's pacing (setPacingOverride),
// so 60 / 144 / 165 Hz can be run on any machine; what the fire and the weather draw, and so their cost, is real.
// (A serialised frame - readPixels each frame - costs a little more than a pipelined one: the loads below are what matters.)
import { G, lateTest, setPacingOverride } from "../scripts/frame-guard.mjs";
import { fireLevel } from "../scripts/fire/guard.mjs";

const api = () => game.modules.get("moinen-maps").api;
const yieldNow = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

/**
 * Run `phases` ([[secs, loadMs | "heavy" | "mid"], ...]) on a `hz` display (k vsyncs a frame, or cap60: Foundry's 60 fps cap). "heavy"
 * = 2 frames' time (late whatever the guard does); "mid" = a lasting load the guard CAN relieve, as on a GPU where the guarded
 * layers cost half a frame: frame x (0.55 + 0.5 x the fire's level) minus the real work at full detail (on time from level ~0.8 down).
 * (On this machine the real fire costs too little to relieve a load by itself: full vs floor is calibrated first and reported.)
 * Returns { cal, rows: per 0.5 s [t, q, fire level, fps, late share, real work ms, load] , frames }.
 */
export async function emu({ hz = 60, k = 1, cap60 = false, phases = [[3, 0], [8, "heavy"], [12, 0], [25, "mid"], [15, 0]] } = {}) {
  const T = canvas.app.ticker, R = canvas.app.renderer, gl = R.gl, px = new Uint8Array(4);
  const P = 1000 / hz, Lt = lateTest({ period: P, k: cap60 ? null : k, cap: cap60 ? 60 : 0 }), FR = Lt.frame;
  const cm = (CONFIG.moinenMaps ??= {}), g0 = [cm.fireAdaptive, cm.weatherGuard]; cm.fireAdaptive = true; cm.weatherGuard = true;
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const realNow = Date.now; let vt = Math.ceil(realNow() / 1000) * 1000; Date.now = () => Math.floor(vt);
  let pt = performance.now(); T.lastTime = pt;
  setPacingOverride(Lt);
  const frame = () => { const a = performance.now(); T.update(pt); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return performance.now() - a; };
  // (the next frame's time: the first vsync after the work is done, at least k vsyncs on, or PIXI's cap's minElapsed rule)
  let lastCap = pt;
  const next = (work) => {
    let t = pt;
    for ( ;; ) {
      t += P;
      if ( t < pt + work - 1e-6 ) continue;
      if ( cap60 ) { const e = t - lastCap; if ( e < 1000 / 60 ) continue; lastCap = t - (e % (1000 / 60)); return t; }
      if ( Math.round((t - pt) / P) >= k ) return t;
    }
  };
  const out = { hz, k: cap60 ? "cap60" : k, frame: +FR.toFixed(2), slack: +Lt.slack.toFixed(2), dpr: R.resolution, rows: [], frames: 0 };
  try {
    // calibration: the real work at full detail and at the guard's floor (q held there), 90 frames each after 30 to settle
    const hold = (q) => { G.reset(); if ( q < 1 ) { G.q = G.tgt = q; G.waitTo = 1e12; } };
    const cal = {};
    for ( const [nm, q] of [["full", 1], ["floor", G.o.qMin]] ) {
      const w = [];
      for ( let i = 0; i < 120; i++ ) { hold(q); const d = frame(); if ( i >= 30 ) w.push(d); const t = next(d); vt += t - pt; pt = t; if ( i % 8 === 0 ) await yieldNow(); }
      w.sort((a, b) => a - b); cal[nm] = +w[w.length >> 1].toFixed(2);
    }
    const mid = (q) => Math.max(0, FR * (0.55 + 0.5 * fireLevel(q)) - cal.full), heavy = 2 * FR;
    out.cal = { ...cal, mid: `${mid(1).toFixed(1)} at full .. ${mid(G.o.qMin).toFixed(1)} at the floor`, heavy: +heavy.toFixed(2) };
    G.reset();
    // the run
    let t0 = pt, bin = { n: 0, late: 0, work: 0 }, nextBin = 500, phaseEnd = 0, pi = 0, load = 0;
    const ends = []; for ( const [s] of phases ) ends.push((phaseEnd += s * 1000));
    for ( ;; ) {
      const el = pt - t0; while ( pi < ends.length && el >= ends[pi] ) pi++;
      if ( pi >= ends.length ) break;
      const ph = phases[pi][1]; load = ph === "mid" ? mid(G.q) : ph === "heavy" ? heavy : ph;
      const prev = pt, d = frame(); out.frames++;
      const t = next(d + load); vt += t - pt; pt = t;
      bin.n++; bin.work += d; if ( t - prev > FR + Lt.slack ) bin.late++;
      if ( el >= nextBin ) {
        out.rows.push([+(el / 1000).toFixed(1), +G.q.toFixed(3), +fireLevel(G.q).toFixed(3), +(bin.n / 0.5).toFixed(0), +(bin.late / Math.max(1, bin.n)).toFixed(2), +(bin.work / Math.max(1, bin.n)).toFixed(2), +load.toFixed(1)]);
        bin = { n: 0, late: 0, work: 0 }; nextBin += 500;
      }
      if ( out.frames % 6 === 0 ) await yieldNow();
    }
    const fd = api().fire.display?.(); out.fireStats = fd ? { q: fd.stats.q, level: fd.stats.level, particles: fd.stats.particles } : null;
  } finally {
    setPacingOverride(null); Date.now = realNow; T.maxFPS = mf; T.lastTime = performance.now(); if ( st ) T.start();
    cm.fireAdaptive = g0[0]; cm.weatherGuard = g0[1]; G.reset();
  }
  return out;
}

/**
 * The vsync the guard judges by, under a real overload (the real ticker, the fronted page): a ticker listener burns `load` ms of CPU a
 * frame for `secs`; every 0.5 s view-smooth's period estimate (api.view.pacing) and the guard's (frame-guard: the shortest recurring
 * rAF interval), the frames per second and q. The first climbs with the overload, the second must stay the display's.
 */
export async function vsyncCheck({ load = 26, secs = 6, after = 8 } = {}) {   // (rows: t, load, fps, view-smooth period, the guard's period, q, the frames' median work)
  const FG = await import("../scripts/frame-guard.mjs");
  const T = canvas.app.ticker, rows = [], t0 = performance.now();
  let on = false, n = 0;
  const burn = () => { n++; if ( !on ) return; const e = performance.now() + load; while ( performance.now() < e ); };
  T.add(burn);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    for ( let s = 0; s < 3 + secs + after; s += 0.5 ) {
      on = s >= 3 && s < 3 + secs; n = 0; await sleep(500);
      FG.pacing(performance.now() + 2000);   // (re-read now: it caches for a second)
      const v = api().view.pacing(), lp = FG.lastPacing();
      const bz = FG.vsyncInfo?.().busy;
      rows.push([s + 0.5, on ? load : 0, n * 2, v.period ? +v.period.toFixed(2) : null, lp.period ? +lp.period.toFixed(2) : null, +FG.G.q.toFixed(2), bz == null ? null : +bz.toFixed(1)]);
    }
  } finally { T.remove(burn); }
  return rows;
}
