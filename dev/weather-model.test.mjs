// Weather, the pure parts (scripts/weather/model.mjs, scripts/wind.mjs, scripts/view-angle.mjs):   node dev/weather-model.test.mjs
//   A. cleaning: junk dropped, defaults, the flag round trip (JSON), keys sorted and capped
//   B. the timeline: a key ramps smoothly (continuous, monotone presence), levels cross-fade (s continuous), a newer key interrupts
//      a running ramp without a jump, deterministic, late joiners compute the same state
//   C. level gates: through the research tables at s = 0, 1, 2, continuous, densities never negative
//   D. wet ground: rises toward the level's ceiling, dries after the rain, never jumps, folding old keys into the base keeps it
//   E. wind: the hash is the shared integer hash, gusts deterministic, periodic in an hour (seamless wrap), asymmetric attack / decay,
//      travel along the wind, vectors
//   F. view angle: presets, clamps
import * as M from "../scripts/weather/model.mjs";
import * as W from "../scripts/wind.mjs";
import * as V from "../scripts/view-angle.mjs";
import * as F from "../scripts/weather/fields.mjs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

/* A */
{
  const P = M.cleanParams();
  ok(P.on && P.who === "all" && P.keys.length === 0 && P.base === null, "defaults");
  ok(P.lens.level === "auto" && P.lens.on && P.ground.puddles, "lens / ground defaults");
  const J = M.cleanParams({ keys: [{ t: 5, preset: "rain", level: 7 }, { t: "x" }, null, { t: 1, preset: "nope" }], who: "gm", lens: { level: 2, strength: 9 } });
  ok(J.keys.length === 2 && J.keys[0].t === 1 && J.keys[1].level === 2, "bad keys dropped, sorted, level clamped");
  ok(J.keys[0].preset === "custom" && J.who === "gm" && J.lens.level === 2 && J.lens.strength === 1, "unknown preset, who, lens clamps");
  ok(JSON.stringify(M.cleanParams(JSON.parse(JSON.stringify(J)))) === JSON.stringify(J), "flag round trip");
  const many = M.cleanParams({ keys: Array.from({ length: 20 }, (_, i) => ({ t: i * 1000, preset: "rain" })) });
  ok(many.keys.length === M.KEEP_KEYS && many.keys[0].t === 12000, "keys capped to the newest");
  ok(M.cleanKey({ t: 0, preset: "rain", level: 3, i: 0.2 }).fx.rain.l === 3, "preset fx at its level");
  ok(Object.keys(M.cleanKey({ t: 0, preset: "clear" }).fx).length === 0, "clear has no effects");
}

/* B */
{
  let P = M.cleanParams();
  const t0 = 1_700_000_000_000;
  P = { ...P, ...M.withKey(P, { preset: "rain", level: 2 }, t0, { dur: 10000, lead: 0 }) };
  ok(M.resolve(P, t0 - 1).fx.rain === undefined, "nothing before the key");
  let prev = -1, mono = true, maxStep = 0;
  for ( let t = t0; t <= t0 + 12000; t += 100 ) {
    const p = M.resolve(P, t).fx.rain?.p ?? 0;
    if ( p < prev - 1e-9 ) mono = false;
    maxStep = Math.max(maxStep, p - Math.max(prev, 0)); prev = p;
  }
  ok(mono && maxStep < 0.03, `presence ramps smoothly (max step ${maxStep.toFixed(4)})`);
  ok(near(M.resolve(P, t0 + 10000).fx.rain.p, 1) && near(M.resolve(P, t0 + 10000).fx.rain.s, 1), "full presence, level 2 = s 1");
  ok(!M.resolve(P, t0 + 5000).steady && M.resolve(P, t0 + 11000).steady, "steady flag");
  // a level change mid-ramp: no jump
  const t1 = t0 + 4000;
  const P2 = { ...P, ...M.withKey(P, { level: 3 }, t1, { dur: 8000, lead: 0 }) };
  const a = M.resolve(P2, t1 - 1).fx.rain, b = M.resolve(P2, t1 + 1).fx.rain;
  ok(Math.abs(a.p - b.p) < 0.01 && Math.abs(a.s - b.s) < 0.01, "an interrupting key continues from the current state");
  ok(near(M.resolve(P2, t1 + 9000).fx.rain.s, 2) && near(M.resolve(P2, t1 + 9000).fx.rain.p, 1), "level 3 reached");
  let worst = 0;
  for ( let t = t1 - 2000; t < t1 + 10000; t += 50 ) { const x = M.resolve(P2, t).fx.rain, y = M.resolve(P2, t + 50).fx.rain; worst = Math.max(worst, Math.abs(x.s - y.s), Math.abs(x.p - y.p)); }
  ok(worst < 0.02, `s and p continuous through a level change (max step ${worst.toFixed(4)})`);
  // clear: fades out, then gone
  const t2 = t1 + 20000, P3 = { ...P2, ...M.withKey(P2, { preset: "clear" }, t2, { dur: 5000, lead: 0 }) };
  ok(M.resolve(P3, t2 + 2500).fx.rain.p > 0.2 && M.resolve(P3, t2 + 2500).fx.rain.p < 0.8 && M.resolve(P3, t2 + 6000).fx.rain === undefined, "clear fades out");
  ok(near(M.resolve(P3, t2 + 2500).fx.rain.s, 2), "a fading effect keeps its level");
  // deterministic + late joiner: a fresh clean of the stored JSON gives the same state
  const J = M.cleanParams(JSON.parse(JSON.stringify(P3)));
  ok(JSON.stringify(M.resolve(J, t2 + 1234)) === JSON.stringify(M.resolve(P3, t2 + 1234)), "late joiner: same state from the stored flag");
  // a key in the future (lead) does not start before its time
  const P4 = { ...P, ...M.withKey(P, { level: 1 }, t0 + 20000) };
  ok(near(M.resolve(P4, t0 + 20000 + M.LEAD_MS - 1).fx.rain.s, 1), "lead: the change starts at t + lead");
  // wind ramps by the shortest angle
  const Pw = { ...P, ...M.withKey(P, { wind: { dir: 350, str: 0.5 } }, t0 + 30000, { dur: 1000, lead: 0 }) };
  const Pw2 = { ...Pw, ...M.withKey(Pw, { wind: { dir: 10, str: 0.5 } }, t0 + 40000, { dur: 1000, lead: 0 }) };
  const mid = M.resolve(Pw2, t0 + 40500).wind.dir;
  ok(mid < 5 || mid > 355, `wind turns the short way (${mid.toFixed(1)})`);
}

/* C */
{
  const T = M.TABLES.rain;
  ok(near(M.gate(T.mid, 0, true), 14) && near(M.gate(T.mid, 1, true), 70) && near(M.gate(T.mid, 2, true), 150), "gates at the levels");
  ok(near(M.gate(T.mid, -0.35, true), 14 * 0.65) && near(M.gate(T.mid, 2.35, true), 150 * 1.35), "fine intensity scales density +-35 %");
  ok(near(M.gate(T.crown, -0.35), 0) && near(M.gate(T.crown, 2.35), 1), "non-density gates clamp");
  let cont = true;
  for ( let s = -0.35; s < 2.35; s += 0.01 ) for ( const [k, v] of Object.entries(T) ) if ( Array.isArray(v) && Math.abs(M.gate(v, s + 0.01, k === "mid" || k === "far" || k === "near") - M.gate(v, s, k === "mid" || k === "far" || k === "near")) > 1.2 * Math.max(1, ...v.map(Math.abs)) * 0.01 + 1e-9 ) cont = false;
  ok(cont, "gates continuous");
  ok(Object.values(M.gates("rain", -0.35)).every((x) => x >= 0), "gates never negative");
  ok(M.levelS(1, 0.5) === 0 && M.levelS(3, 0.5) === 2 && near(M.levelS(2, 1), 1.35), "level continuum");
  ok(M.levels("rain").length === 3 && M.levels("rain")[2].effects.rain.mid === 150, "levels table");
}

/* D */
{
  const t0 = 1_700_000_000_000;
  let P = M.cleanParams({ ground: { wetRate: 60, dryRate: 300 } });
  P = { ...P, ...M.withKey(P, { preset: "rain", level: 3 }, t0, { dur: 20000, lead: 0 }) };
  const w = (dt) => M.resolve(P, t0 + dt).wet;
  ok(w(0) === 0 && w(30000) > 0 && w(60000) < w(120000) && w(600000) > 0.97 && w(600000) <= 1.0001, "wets toward the level-3 ceiling");
  let jump = 0;
  for ( let dt = 0; dt < 200000; dt += 500 ) jump = Math.max(jump, Math.abs(w(dt + 500) - w(dt)));
  ok(jump < 0.02, `wet never jumps (${jump.toFixed(4)})`);
  const P1 = { ...M.cleanParams({ ground: { wetRate: 60, dryRate: 300 } }), ...M.withKey(M.cleanParams(), { preset: "rain", level: 1 }, t0, { dur: 1000, lead: 0 }) };
  ok(Math.abs(M.resolve(P1, t0 + 900000).wet - 0.3) < 0.01, "level 1 ceiling 30 %");
  const t1 = t0 + 600000;
  const P2 = { ...P, ...M.withKey(P, { preset: "clear" }, t1, { dur: 10000, lead: 0 }) };
  const d = (dt) => M.resolve(P2, t1 + dt).wet;
  ok(d(0) > 0.97 && d(300000) < d(60000) && d(3000000) < 0.01, "dries after the rain");
  // folding: many keys keep the wetness continuous
  let Q = P2, prevW = M.resolve(Q, t1 + 20000).wet, okFold = true;
  for ( let k = 0; k < 14; k++ ) {
    const at = t1 + 20000 + k * 3000;
    const before = M.resolve(Q, at).wet;
    Q = { ...Q, ...M.withKey(Q, { preset: k % 2 ? "rain" : "clear", level: 2 }, at, { dur: 2000, lead: 0 }) };
    Q = M.cleanParams(JSON.parse(JSON.stringify(Q)));
    const after = M.resolve(Q, at).wet;
    if ( Math.abs(before - after) > 0.002 ) okFold = false;
  }
  ok(okFold && Q.keys.length === M.KEEP_KEYS && Q.base, "folding old keys into the base keeps the wetness");
  ok(prevW > 0, "wet positive");
}

/* E */
{
  ok(W.hu(1, 2, 3) === W.hu(1, 2, 3) && W.hu(1, 2, 3) !== W.hu(2, 1, 3) && W.hu(0, 0, 0) >= 0 && W.hu(-5, 7, 9) < 1, "hash");
  // the reference values of the mock-ups' hash (common.py hashu)
  ok(near(W.hu(3, 4, 5), ((() => { let h = (3 * 374761393 + 4 * 668265263 + 5 * 1274126177) >>> 0; h = Number((BigInt(h ^ (h >>> 13)) * 1103515245n) & 0xffffffffn); h = (h ^ (h >>> 16)) >>> 0; return h / 4294967296; })()), 1e-12), "hash = the mock-ups' hash");
  ok(near(W.gustEnv(10.25), W.gustEnv(10.25 + W.HOUR), 1e-9) && near(W.gustEnv(-3), W.gustEnv(W.HOUR - 3), 1e-9), "periodic in an hour");
  let wrap = Math.abs(W.gustEnv(W.HOUR - 0.01) - W.gustEnv(0));
  ok(wrap < 0.05, `seamless at the hour wrap (${wrap.toFixed(4)})`);
  let mx = 0, mn = 9, step = 0, rises = 0, falls = 0;
  for ( let t = 0; t < 600; t += 0.05 ) {
    const g = W.gustEnv(t), g2 = W.gustEnv(t + 0.05);
    mx = Math.max(mx, g); mn = Math.min(mn, g); step = Math.max(step, Math.abs(g2 - g));
  }
  ok(mx > 0.8 && mn < 0.15 && step < 0.05, `gusts and lulls, smooth (max ${mx.toFixed(2)} min ${mn.toFixed(2)} step ${step.toFixed(3)})`);
  // asymmetric: a rise (to a peak) is shorter than the fall after it, on average
  for ( let t = 0; t < 3600; t += 0.1 ) { const d = W.gustEnv(t + 0.1) - W.gustEnv(t); if ( d > 0.004 ) rises++; else if ( d < -0.004 ) falls++; }
  ok(falls > rises, `gusts build faster than they die (rise ${rises}, fall ${falls})`);
  const w = { dir: 0, str: 0.5, gust: 1 };
  ok(near(W.gustAt(w, 8, 0, 12), W.gustEnv(12 - 8 / W.GUST_SPEED)), "a gust travels along the wind");
  const v = W.windVecAt({ dir: 90, str: 1, gust: 0 }, 0, 0, 5);
  ok(near(v.x, 0) && near(v.y, 1), "no gust: the base vector");
  ok(W.windVecAt({ dir: 0, str: 0 }, 0, 0, 1).x === 0, "no wind");
  W.setWindProvider(() => ({ dir: 45, str: 0.4, gust: 0.5 }));
  ok(W.sceneWind()?.dir === 45, "provider");
  W.setWindProvider(() => ({ dir: 45, str: 0, gust: 0.5 }));
  ok(W.sceneWind() === null, "calm = no scene wind");
  W.setWindProvider(null);
  ok(W.GLSL_WIND.includes("gustEnv") && W.GLSL_WIND.includes("374761393u"), "the GLSL twin");
}

/* F */
{
  ok(V.cleanView(null).lift === 0.5 && V.cleanView(null).squash === 0.8 && V.cleanView(null).preset === "oblique", "default view");
  ok(V.cleanView({ preset: "top" }).lift === 0.25 && V.cleanView({ lift: 9, squash: 0 }).lift === 0.8 && V.cleanView({ lift: 9, squash: 0 }).squash === 0.6, "presets, clamps");
  ok(V.project(10, 20, 10, { lift: 0.5 })[1] === 15, "project");
}


/* G: phase 2 effects, snow cover, ground share quantiles */
{
  for ( const e of ["snow", "sand", "dust", "embers"] ) ok(M.EFFECTS.includes(e) && e in M.PRESETS && M.TABLES[e]?.lens, `effect ${e} with a preset and a lens table`);
  ok(M.EFFECTS.includes("wind") && "wind" in M.PRESETS && M.TABLES.wind && !M.TABLES.wind.lens, "wind: an effect with a preset and no lens part");
  ok(JSON.stringify(Object.keys(M.presetFx("storm", 3)).sort()) === '["rain","wind"]' && M.presetFx("blizzard", 1).wind.l === 1 && M.presetFx("blizzard", 1).snow.l === 1, "storm = rain + wind, blizzard = snow + wind, at the chosen level");
  { const g1 = M.gates("wind", 0), g3 = M.gates("wind", 2); ok(g1.lines < g3.lines && g1.debris < g3.debris && g1.comb > g3.comb && g1.cloud === 0 && g3.haze > 0 && g1.spd < g3.spd, "wind levels: 1 delicate .. 3 strongest"); }
  ok(M.gates("snow", 2).near === 2 && M.gates("snow", 0).near === 0 && M.gates("sand", 1).grit === 34, "snow / sand gates");
  ok(M.coverCeil(0) === 0 && Math.abs(M.coverCeil(1) - 0.10) < 1e-9 && Math.abs(M.coverCeil(2) - 0.42) < 1e-9, "snow cover ceilings 0 / 10 / 42 %");
  const t0 = 1_000_000, P = M.cleanParams({ keys: [{ t: t0, dur: 0, preset: "snow", level: 3, i: 0.5 }], ground: { snowRate: 100, meltRate: 400 } });
  const c1 = M.resolve(P, t0 + 100000).cover, c2 = M.resolve(P, t0 + 600000).cover;
  ok(c1 > 0.42 * 0.55 && c1 < 0.42 * 0.7 && Math.abs(c2 - 0.42) < 0.01, `snow settles toward its ceiling (${c1.toFixed(3)}, ${c2.toFixed(3)})`);
  ok(M.resolve(P, t0 + 100000).wet === 0, "snow does not wet the ground");
  const P2 = M.cleanParams({ ...P, keys: [...P.keys, { t: t0 + 600000, dur: 0, preset: "clear", level: 2 }] });
  const m1 = M.resolve(P2, t0 + 600000 + 400000 + M.LEAD_MS).cover;
  ok(m1 > 0.42 * 0.3 && m1 < 0.42 * 0.45, `snow melts with meltRate (${m1.toFixed(3)})`);
  ok(JSON.stringify(M.resolve(M.cleanParams(JSON.parse(JSON.stringify(P2))), t0 + 777777)) === JSON.stringify(M.resolve(P2, t0 + 777777)), "cover: same from the stored flag");
  ok(M.cleanParams({ lens: { heat: true } }).lens.heat === true && M.cleanParams({}).lens.heat === false, "lens heat option, off by default");
  // the shares the shader draws: the quantile threshold gives the wanted share of the sample
  const px = new Uint8Array(64 * 64 * 4);
  for ( let i = 0; i < 64 * 64; i++ ) { px[i * 4] = 120 + (i % 50); px[i * 4 + 1] = 110; px[i * 4 + 2] = 90; px[i * 4 + 3] = (i * 7) % 255; }
  const smp = F.landSample(px, 64, 64, 4, 2000), sorted = F.sortedScores(smp, (q) => F.snowScore(q.x, q.y, q.lum, q.con, 3));
  const thr = F.quantileThr(sorted, 0.42), share = smp.filter((q) => F.snowScore(q.x, q.y, q.lum, q.con, 3) > thr).length / smp.length;
  ok(smp.length === 2000 && Math.abs(share - 0.42) < 0.01, `snow quantile share (${share.toFixed(3)})`);
  const ds = F.sortedScores(smp, (q) => F.driftScore(q.x, q.y, q.con, 3, 0.94, 0.34)), dt = F.quantileThr(ds, 0.12);
  ok(Math.abs(smp.filter((q) => F.driftScore(q.x, q.y, q.con, 3, 0.94, 0.34) > dt).length / smp.length - 0.12) < 0.01 && F.quantileThr(ds, 0) === 9, "drift quantile share, none = 9");
  ok(Math.abs(F.vnoise(3.25, 7.5, 11) - F.vnoise(3.25, 7.5, 11)) === 0 && F.fbm3(1.5, 2.5, 4) >= 0 && F.fbm3(1.5, 2.5, 4) <= 1, "noise ports");
}

/* H: rain and snow over fire (research D9) */
{
  ok(M.cleanParams().fire.out === false && M.cleanParams({ fire: { out: true } }).fire.out === true && M.cleanParams({ fire: { out: "yes" } }).fire.out === false, "fire.out: off by default, boolean");
  const none = M.fireWet({ fx: {} });
  ok(none.dim === 0 && none.steam === 0 && none.outAfter === Infinity, "no rain: nothing");
  const r = [0, 1, 2].map((s) => M.fireWet({ fx: { rain: { p: 1, s } } }));
  ok(r[0].dim < r[1].dim && r[1].dim < r[2].dim && r[2].dim <= 0.8 && r[0].outAfter > r[2].outAfter, "rain dims more and puts out sooner by level");
  ok(M.fireWet({ fx: { snow: { p: 1, s: 2 } } }).outAfter === Infinity && M.fireWet({ fx: { snow: { p: 1, s: 2 } } }).dim < r[2].dim, "snow dims less and never puts fire out");
  ok(M.fireWet({ fx: { rain: { p: 0.4, s: 2 } } }).outAfter === Infinity, "a fading-in rain does not put fire out yet");
  // continuous along a transition (p and s ramp): no jump
  const P = M.cleanParams({ keys: [{ t: 0, dur: 0, preset: "clear" }, { t: 10000, dur: 20000, preset: "rain", level: 3 }] });
  let jump = 0, prev = M.fireWet(M.resolve(P, 9000));
  for ( let t = 9050; t < 32000; t += 50 ) { const w = M.fireWet(M.resolve(P, t)); jump = Math.max(jump, Math.abs(w.dim - prev.dim), Math.abs(w.steam - prev.steam)); prev = w; }
  ok(jump < 0.02 && prev.dim > 0.7, `fire damping follows the transition smoothly (largest 50 ms step ${jump.toFixed(4)})`);
}

console.log(`${fails ? "FAIL" : "ok"} weather model: ${n - fails}/${n} checks`);
process.exit(fails ? 1 : 0);
