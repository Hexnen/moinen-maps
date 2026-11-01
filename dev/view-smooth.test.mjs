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
console.log(`view-smooth: ${n} checks ok`);
