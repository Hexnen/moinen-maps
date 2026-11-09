// Frame pacing:   node dev/view-smooth.test.mjs
//   Simulated requestAnimationFrame timestamps (vsync period with +-0.3 ms jitter and an occasional missed vsync) at 60 / 75 / 120 /
//   144 / 165 / 240 Hz under Foundry's 60 fps cap: PIXI's own cap (Ticker.update with minElapsedMS, reproduced here) against the
//   gate of scripts/view-smooth.mjs ("even"). The gate must draw every k-th vsync with k fixed (all intervals within half a vsync of
//   k periods, except right after a missed vsync), k the whole number of vsyncs nearest the cap's frame time; "display" every vsync. PIXI's cap at 165 Hz is shown
//   to mix 2- and 3-vsync gaps (the judder the gate removes).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const V = await import(pathToFileURL(path.join(root, "scripts/view-smooth.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
let seed = 7;
const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2654435761) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;

const vsyncs = (hz, count, miss = 0) => {
  const P = 1000 / hz, out = []; let t = 1000;
  for ( let i = 0; i < count; i++ ) { t += P * (rnd() < miss ? 2 : 1); out.push(t + (rnd() - 0.5) * 0.6); }
  return out;
};
// PIXI 7 Ticker.update with maxFPS: skip when (now - lastFrame) | 0 < minElapsedMS, else lastFrame = now - delta % minElapsedMS
const pixi = (times, cap) => { const min = 1000 / cap, drawn = []; let last = -Infinity;
  for ( const t of times ) { const d = (t - last) | 0; if ( last !== -Infinity && d < min ) continue; last = last === -Infinity ? t : t - (d % min); drawn.push(t); } return drawn; };
const gate = (times, mode, cap) => {
  const ivs = [], drawn = []; let lastRaf = null, lastRun = null;
  for ( const t of times ) {
    if ( lastRaf !== null ) { const d = t - lastRaf; if ( d > 2 && d < 60 ) { ivs.push(d); if ( ivs.length > 31 ) ivs.shift(); } }
    lastRaf = t;
    const P = V.vsyncPeriod(ivs);
    if ( P && !V.due(t, lastRun, P, V.vsyncsPerFrame(mode, cap, P)) ) continue;
    lastRun = t; drawn.push(t);
  }
  return drawn;
};
const gaps = (d) => d.slice(1).map((t, i) => t - d[i]);

for ( const hz of [60, 75, 120, 144, 165, 240] ) {
  const P = 1000 / hz, times = vsyncs(hz, 2000);
  const k = V.vsyncsPerFrame("even", 60, P);
  ok(1000 / (k * P) <= 60 * 1.5, `${hz} Hz: at most 1.5x the cap (k=${k})`);
  ok(1000 / (k * P) > 30, `${hz} Hz: not slower than half the cap`);
  const g = gaps(gate(times, "even", 60)).slice(40);       // after the period estimate settled
  ok(g.every((x) => Math.abs(x - k * P) < P * 0.5), `${hz} Hz even: every gap ${k} vsyncs (${Math.min(...g).toFixed(2)}..${Math.max(...g).toFixed(2)} ms)`);
  const gd = gaps(gate(times, "display", 60)).slice(40);
  ok(gd.every((x) => Math.abs(x - P) < P * 0.5), `${hz} Hz display: every vsync`);
  const gp = gaps(pixi(times, 60)).slice(40), kinds = new Set(gp.map((x) => Math.round(x / P)));
  if ( hz === 165 ) ok(kinds.size > 1, `165 Hz: PIXI's cap mixes ${[...kinds].join(" / ")} vsync gaps`);
  console.log(`${String(hz).padStart(3)} Hz  PIXI cap: gaps of ${[...kinds].sort().join("/")} vsyncs (${(1000 / (gp.reduce((a, b) => a + b, 0) / gp.length)).toFixed(1)} fps)   even: ${k} vsyncs (${(1000 / (k * P)).toFixed(1)} fps)`);
}
// the choice per (display Hz, Foundry cap; 0 = none): never below an uncapped / fast-capped Foundry, never far from a low cap
{ const rows = [];
  for ( const [hz, cap] of [[60, 60], [144, 60], [144, 144], [165, 60], [165, 144], [165, 165], [165, 0], [240, 120], [120, 60], [75, 60], [165, 30]] ) {
    const r = V.pacingFor("even", cap, hz); rows.push(`${hz}Hz/cap ${cap || "none"} -> k=${r.k} ${r.fps} fps`);
    if ( !cap || cap >= 90 ) ok(r.k === 1 && r.fps === hz, `${hz} Hz cap ${cap}: every refresh (${r.fps} fps)`);
    else ok(r.fps >= cap * 0.9 || r.k === 1 || hz / (r.k - 1) > cap * 1.5, `${hz} Hz cap ${cap}: ${r.fps} fps near the cap`);
  }
  console.log(`even: ${rows.join("; ")}`); }
// uncapped Foundry (performance mode Maximum): every vsync
ok(V.vsyncsPerFrame("even", 0, 1000 / 165) === 1, "no cap: every vsync");
// a missed vsync (a long frame) does not shift the rhythm for more than one frame
{ const hz = 165, P = 1000 / hz, times = vsyncs(hz, 3000, 0.02), g = gaps(gate(times, "even", 60)).slice(40);
  const bad = g.filter((x) => Math.abs(x - 3 * P) >= P * 0.5);
  ok(bad.every((x) => x > 3 * P), "after a missed vsync only a longer gap, never a short one");
  ok(bad.length < g.length * 0.1, `missed vsyncs: ${bad.length} of ${g.length} gaps longer`); }
// the water loop's mix: drawn at an even 55 fps the loop's phase (frame + mix) advances by the same step every drawn frame
{ globalThis.PIXI ??= { Mesh: class {}, Program: { from() {} }, MeshGeometry: class {}, Shader: class {}, Texture: {}, Container: class {}, Sprite: class {} };
  const W = await import(pathToFileURL(path.join(root, "scripts/water/display.mjs")).href);
  const ms = 90, N = 16, steps = [];
  let prev = null;
  for ( let t = 5000; t < 9000; t += 1000 / 55 ) {
    const [i, j, m] = W.loopMix(t, ms, N, true);
    ok(j === (i + 1) % N && m >= 0 && m <= 1, "smooth: frame i mixed into i + 1");
    const ph = i + m;
    if ( prev !== null ) steps.push(((ph - prev) % N + N) % N);
    prev = ph;
  }
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length, sd = Math.sqrt(steps.reduce((a, b) => a + (b - mean) ** 2, 0) / steps.length);
  ok(sd / mean < 0.05, `water phase per drawn frame even (CV ${(sd / mean).toFixed(4)})`);
  const [a, b, m0] = W.loopMix(5000, ms, N, false);
  ok(a === b && m0 === 0, "off: one frame, no mix");
  ok(W.loopMix(123, ms, 1, true)[2] === 0, "a single frame: no mix");
  console.log(`water loop: phase step per drawn frame ${mean.toFixed(4)} frames, CV ${(sd / mean).toFixed(5)}`);
}
// UNDER LOAD (2026-11-09): the gate's period held to the display's stable one. A display model: rAF on every vsync while the main
// thread is free; a drawn frame's work `w` (ms) holds the next rAF to the first vsync after it. OLD = the trimmed mean alone (it climbs
// to the overloaded interval: k falls, the cadence goes uneven, over the cap); NEW = gatePeriod(trimmed mean, stablePeriod).
{
  const sim = (hz, cap, w, stableOn, secs = 20) => {
    const P = 1000 / hz, ivs = [], st = V.stableState(), drawn = []; let t = 1000, lastRaf = null, lastRun = null, s2 = 11;
    const jit = () => ((s2 = Math.imul(s2 ^ (s2 >>> 15), 2654435761) + 0x6d2b79f5 | 0) >>> 0) / 4294967296 - 0.5;
    while ( t < 1000 + secs * 1000 ) {
      const time = t + jit() * 0.4;
      if ( lastRaf !== null ) { const d = time - lastRaf; if ( d > 2 && d < 60 ) { ivs.push(d); if ( ivs.length > 31 ) ivs.shift(); st.iv.push(d); if ( st.iv.length > 120 ) st.iv.shift(); } }
      lastRaf = time;
      const P0 = V.vsyncPeriod(ivs), Pp = stableOn ? V.gatePeriod(P0, V.stablePeriod(st, time)) : P0;
      if ( Pp && !V.due(time, lastRun, Pp, V.vsyncsPerFrame("even", cap, Pp)) ) { t += P; continue; }
      lastRun = time; drawn.push(time);
      const work = time < 4000 ? 1 : w(time - 4000);   // (the page idle for its first 3 s, then the load) st.busy.push(work); if ( st.busy.length > 120 ) st.busy.shift();
      t += Math.max(1, Math.ceil(work / P - 1e-9)) * P;
    }
    return drawn;
  };
  const stats = (d, from) => {
    const g = gaps(d.filter((x) => x >= from)), sorted = [...g].sort((a, b) => a - b), q = (f) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
    let irr = 0; for ( let i = 1; i < g.length; i++ ) if ( Math.abs(g[i] - g[i - 1]) > 2 ) irr++;
    return { p50: q(0.5), p95: q(0.95), irr: irr / Math.max(1, g.length - 1), fps: 1000 / (g.reduce((a, b) => a + b, 0) / g.length) };
  };
  // a few stray short intervals under a load (measured live: ~5.15 ms on a 6.05 ms display) are not taken as a faster display
  { const st = V.stableState(), P = 1000 / 165; st.iv = Array.from({ length: 120 }, (_, i) => P * (1 + (i % 3)) + (i % 5) * 0.03); V.stablePeriod(st, 0);
    st.iv = Array.from({ length: 120 }, (_, i) => (i % 20 === 0 ? 5.15 : P * (2 + (i % 2)))); st.busy = Array(20).fill(9);
    ok(Math.abs(V.stablePeriod(st, 1000) - P) < 0.1, `stray short intervals: the period kept (${st.period.toFixed(2)})`);
    st.iv = Array(120).fill(1000 / 240); ok(Math.abs(V.stablePeriod(st, 2000) - 1000 / 240) < 0.01, "a really faster display: taken at once"); }
  // no load: exactly the same frames as before at every rate, capped and not
  for ( const hz of [60, 144, 165, 240] ) for ( const cap of [60, 0] ) {
    const a = sim(hz, cap, () => 1, false, 10), b = sim(hz, cap, () => 1, true, 10);
    ok(a.length === b.length && a.every((x, i) => x === b[i]), `${hz} Hz cap ${cap || "none"}: no load, the same frames as before`);
  }
  // loads at 165 Hz with Foundry's 60 fps cap (k 3: 55 fps, 18.2 ms) and at 144 Hz (k 2: 72 fps): 8 ms, 14 ms, 26 ms of work, and a
  // load that comes and goes (26 ms for 3 s, then 2 ms)
  const rows = [];
  for ( const [hz, cap] of [[165, 60], [144, 60], [240, 60]] ) {
    const P = 1000 / hz, k = V.vsyncsPerFrame("even", cap, P);
    for ( const [nm, w] of [["8 ms", () => 8], ["14 ms", () => 14], ["26 ms", () => 26], ["26 ms 3 s on / 3 s off", (t) => (Math.floor(t / 3000) % 2 ? 2 : 26)], ["4-16 ms varying", (t) => 10 + 6 * Math.sin(t * 0.37) * Math.cos(t * 0.011)], ["4-28 ms varying", (t) => 16 + 12 * Math.sin(t * 0.37) * Math.cos(t * 0.013)]] ) {
      const o = stats(sim(hz, cap, w, false), 8000), n = stats(sim(hz, cap, w, true), 8000);
      rows.push(`${hz} Hz cap ${cap} ${nm}: old p50 ${o.p50.toFixed(1)} p95 ${o.p95.toFixed(1)} irregular ${(o.irr * 100).toFixed(0)} % ${o.fps.toFixed(0)} fps | new p50 ${n.p50.toFixed(1)} p95 ${n.p95.toFixed(1)} irregular ${(n.irr * 100).toFixed(0)} % ${n.fps.toFixed(0)} fps`);
      ok(n.fps <= cap * 1.5 + 0.5 && n.fps <= hz / k + 0.5, `${hz} Hz ${nm}: never over the paced rate (${n.fps.toFixed(1)} fps)`);
      let wMax = 0; for ( let x = 0; x < 20000; x += 0.5 ) wMax = Math.max(wMax, w(x));
      if ( wMax < k * P ) ok(n.irr === 0 && Math.abs(n.p95 - k * P) < P * 0.5, `${hz} Hz ${nm}: work fits k vsyncs - every gap ${k} vsyncs`);
      ok(n.irr <= o.irr + 1e-9, `${hz} Hz ${nm}: no less even than before`);
    }
  }
  console.log(rows.join(String.fromCharCode(10)));
}
console.log(`view-smooth: ${n} checks ok`);
