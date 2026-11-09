// Weather, the pure parts (scripts/weather/model.mjs, scripts/wind.mjs, scripts/view-angle.mjs):   node dev/weather-model.test.mjs
//   A. cleaning: junk dropped, defaults, the flag round trip (JSON), keys sorted and capped
//   B. the timeline: a key ramps smoothly (continuous, monotone presence), strengths blend (v, p, s continuous; a fading effect eases
//      down through the levels), a newer key interrupts a running ramp without a jump, deterministic, late joiners compute the same
//   C. level gates: through the research tables at s = 0, 1, 2, continuous, densities never negative
//   D. wet ground: rises toward the level's ceiling, dries after the rain, never jumps, folding old keys into the base keeps it
//   E. wind: the hash is the shared integer hash, gusts deterministic, periodic in an hour (seamless wrap), asymmetric attack / decay,
//      travel along the wind, vectors
//   F. view angle: presets, clamps
//   I. clouds: the layer kept through other changes, its look switches fade, the drift (the wind integrated: steady, continuous, folds)
//   J. strength v (VERSION 2): the mapping, bit-exact at v = 1 / 2 / 3 against the old level formulas, the overdrive, the client cap,
//      the lens; continuity of v, p, s and every gate along 0 -> V_MAX -> 0
//   K. migration (v1 flags read at load): { l, i } / numeric fx / key level + i / base { p, s } / lens int; the storm field kept
//   L. withKey patch semantics: preset + level, level alone, fx patch, clouds sugar, v1 `i`, the derived preset name and level
import * as M from "../scripts/weather/model.mjs";
import * as W from "../scripts/wind.mjs";
import * as V from "../scripts/view-angle.mjs";
import * as F from "../scripts/weather/fields.mjs";
import * as SM from "../scripts/weather/storm-model.mjs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

/* A */
{
  const P = M.cleanParams();
  ok(P.on && P.who === "all" && P.keys.length === 0 && P.base === null, "defaults");
  ok(P.lens.level === "auto" && P.lens.on && P.ground.puddles, "lens / ground defaults");
  const J = M.cleanParams({ keys: [{ t: 5, preset: "rain", level: 7 }, { t: "x" }, null, { t: 1, preset: "nope" }], who: "gm", lens: { level: 2, strength: 9 } });
  ok(J.keys.length === 2 && J.keys[0].t === 1 && J.keys[1].level === M.V_MAX && J.keys[1].fx.rain === M.V_MAX, "bad keys dropped, sorted, level clamped (to the overdrive top)");
  ok(J.keys[0].preset === "custom" && J.who === "gm" && J.lens.level === 2 && J.lens.strength === 1, "unknown preset, who, lens clamps");
  ok(JSON.stringify(M.cleanParams(JSON.parse(JSON.stringify(J)))) === JSON.stringify(J), "flag round trip");
  const many = M.cleanParams({ keys: Array.from({ length: 20 }, (_, i) => ({ t: i * 1000, preset: "rain" })) });
  ok(many.keys.length === M.KEEP_KEYS && many.keys[0].t === 12000, "keys capped to the newest");
  { const k = M.cleanKey({ t: 0, preset: "rain", level: 3, i: 0.2 }); ok(near(k.fx.rain, 2.79, 1e-9) && near(k.level, 2.79, 1e-9) && !("i" in k), "preset fx at its level (a v1 i folded in)"); }
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
  // (a smoothstep ramp of dv over dur moves v at most 1.5 x dv / dur: the bound of a 50 ms step)
  let worst = 0;
  const bound = 1.5 * (3 - a.v) * 50 / 8000 + 1e-9;
  for ( let t = t1 - 2000; t < t1 + 10000; t += 50 ) { const x = M.resolve(P2, t).fx.rain, y = M.resolve(P2, t + 50).fx.rain; worst = Math.max(worst, Math.abs(x.v - y.v), Math.abs(x.s - y.s), Math.abs(x.p - y.p)); }
  ok(worst <= bound, `v, s and p continuous through a level change (max step ${worst.toFixed(4)} <= ${bound.toFixed(4)})`);
  // clear: eases down through the levels (3 -> 2 -> 1), then thins out, then gone (Q2)
  const t2 = t1 + 20000, P3 = { ...P2, ...M.withKey(P2, { preset: "clear" }, t2, { dur: 5000, lead: 0 }) };
  const half = M.resolve(P3, t2 + 2500).fx.rain;
  ok(near(half.v, 1.5) && half.p === 1 && near(half.s, 0.5) && M.resolve(P3, t2 + 6000).fx.rain === undefined, "clear: half way = strength 1.5 (full presence, between levels 1 and 2), then gone");
  { let mono = true, prevV = 9, sawL2 = false, sawL1 = false, sawThin = false;
    for ( let t = t2; t <= t2 + 5000; t += 25 ) { const f = M.resolve(P3, t).fx.rain; const v = f?.v ?? 0; if ( v > prevV + 1e-12 ) mono = false; prevV = v;
      if ( f && Math.abs(f.s - 1) < 0.02 && f.p === 1 ) sawL2 = true; if ( f && f.s === 0 && f.p > 0.98 ) sawL1 = true; if ( f && f.p < 0.5 ) sawThin = true; }
    ok(mono && sawL2 && sawL1 && sawThin, "a fading downpour passes through level 2, level 1, then thins out (monotone)"); }
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
  ok(JSON.stringify(Object.keys(M.presetFx("storm", 3)).sort()) === '["rain","wind"]' && M.presetFx("blizzard", 1).wind === 1 && M.presetFx("blizzard", 1).snow === 1 && M.presetFx("rain", 2.45).rain === 2.45, "storm = rain + wind, blizzard = snow + wind, at the chosen strength");
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

/* I: clouds (the cloud layer: a key effect kept through other changes, its look switches, its drift) */
{
  const C0 = M.cleanParams().clouds;
  ok(C0.mode === "sky" && C0.rays === true && C0.modeT === 0 && C0.raysT === 0, "clouds: defaults (bodies + shadows, godrays on)");
  const J = M.cleanParams({ clouds: { mode: "nope", rays: "no", modeT: -5, raysT: "x" } }).clouds;
  ok(J.mode === "sky" && J.rays === true && J.modeT === 0 && J.raysT === 0, "clouds: junk cleaned");
  ok(M.cleanParams({ clouds: { mode: "shadows", rays: false, raysT: 1234.4 } }).clouds.raysT === 1234 && M.cleanParams({ clouds: { rays: false } }).clouds.rays === false, "clouds: values kept");
  ok(M.cloudSwitch(true, 1000, 999) === 0 && M.cloudSwitch(true, 1000, 1000 + M.CLOUD_FADE) === 1 && M.cloudSwitch(false, 1000, 999) === 1, "switch: the ends");
  let jump = 0; for ( let t = 900; t < 1100 + M.CLOUD_FADE; t += 16 ) jump = Math.max(jump, Math.abs(M.cloudSwitch(true, 1000, t + 16) - M.cloudSwitch(true, 1000, t)));
  ok(jump < 0.01, `switch: a smooth fade (largest 16 ms step ${jump.toFixed(4)})`);
  // the layer is kept through other changes
  const t0 = 1_700_000_000_000;
  let P = M.cleanParams();
  P = { ...P, ...M.withKey(P, { preset: "clouds", level: 2 }, t0, { lead: 0 }) };
  ok(P.keys[0].fx.clouds === 2 && Object.keys(P.keys[0].fx).length === 1, "preset clouds: only clouds at the level");
  P = { ...P, ...M.withKey(P, { preset: "rain", level: 3 }, t0 + 1000, { lead: 0 }) };
  ok(P.keys[1].fx.clouds === 2 && P.keys[1].fx.rain === 3 && P.keys[1].preset === "rain", "rain keeps the clouds");
  P = { ...P, ...M.withKey(P, { level: 1 }, t0 + 2000, { lead: 0 }) };
  P = { ...P, ...M.withKey(P, { wind: { str: 0.8 } }, t0 + 3000, { lead: 0 }) };
  ok(P.keys[3].fx.clouds === 2 && P.keys[3].fx.rain === 1, "level and wind changes keep the clouds");
  P = { ...P, ...M.withKey(P, { clouds: 3 }, t0 + 4000, { lead: 0 }) };
  ok(P.keys[4].fx.clouds === 3 && P.keys[4].fx.rain === 1 && P.keys[4].preset === "rain" && P.keys[4].level === 1, "clouds row: level 3 under the rain");
  P = { ...P, ...M.withKey(P, { clouds: 0 }, t0 + 5000, { lead: 0 }) };
  ok(!P.keys[5].fx.clouds && P.keys[5].fx.rain, "clouds row: off");
  P = { ...P, ...M.withKey(P, { clouds: 1 }, t0 + 6000, { lead: 0 }) };
  P = { ...P, ...M.withKey(P, { preset: "clear" }, t0 + 7000, { lead: 0 }) };
  ok(Object.keys(P.keys.at(-1).fx).length === 0, "clear sky clears the clouds");
  let Q = M.cleanParams();
  Q = { ...Q, ...M.withKey(Q, { preset: "clouds", level: 1 }, t0, { lead: 0 }) };
  Q = { ...Q, ...M.withKey(Q, { clouds: 3 }, t0 + 1000, { lead: 0 }) };
  ok(Q.keys[1].preset === "clouds" && Q.keys[1].level === 3 && Q.keys[1].fx.clouds === 3, "clouds row on the clouds preset: its level");
  Q = { ...Q, ...M.withKey(Q, { clouds: 0 }, t0 + 2000, { lead: 0 }) };
  ok(Q.keys[2].preset === "clear" && !Q.keys[2].fx.clouds, "clouds row off on the clouds preset: clear");
  // the presence ramps (switch on, level change, off): continuous, the level s too
  let R = M.cleanParams();
  R = { ...R, ...M.withKey(R, { clouds: 1 }, t0, { dur: 10000, lead: 0 }) };
  R = { ...R, ...M.withKey(R, { clouds: 3 }, t0 + 15000, { dur: 10000, lead: 0 }) };
  R = { ...R, ...M.withKey(R, { clouds: 0 }, t0 + 30000, { dur: 10000, lead: 0 }) };
  let w = 0, prev = M.resolve(R, t0 - 50).fx.clouds ?? { v: 0, p: 0, s: 0 };
  for ( let t = t0; t < t0 + 42000; t += 50 ) { const c = M.resolve(R, t).fx.clouds ?? { v: 0, p: 0, s: 0 }; w = Math.max(w, Math.abs(c.v - prev.v), Math.abs(c.p - prev.p), Math.abs(c.s - prev.s)); prev = c; }
  const wb = 1.5 * 3 * 50 / 10000 + 1e-9;   // (the steepest: 3 -> 0 over 10 s)
  ok(w <= wb && !M.resolve(R, t0 + 41000).fx.clouds, `clouds fade in, change level and fade out smoothly (largest 50 ms step ${w.toFixed(4)} <= ${wb.toFixed(4)})`);
  // the drift: the wind integrated (steady: its speed; a wind change ramps the speed; no jump; folding keys keeps it)
  let D = M.cleanParams();
  D = { ...D, ...M.withKey(D, { preset: "clouds", wind: { dir: 0, str: 0.5 } }, t0, { dur: 0, lead: 0 }) };
  const v = M.cloudVel({ wind: { dir: 0, str: 0.5 } });
  const a = M.cloudDrift(D, t0 + 10000), b = M.cloudDrift(D, t0 + 20000);
  ok(near(b[0] - a[0], v[0] * 10, 1e-6) && near(b[1] - a[1], 0, 1e-6) && v[0] > 0, "drift: steady at the wind's speed (x the share)");
  ok(M.cloudVel({ wind: { dir: 90, str: 0 } })[1] > 0, "drift: a breeze even in calm air, along the wind's direction");
  D = { ...D, ...M.withKey(D, { wind: { dir: 90, str: 1 } }, t0 + 30000, { dur: 20000, lead: 0 }) };
  let dj = 0, dp = M.cloudDrift(D, t0 + 29000), maxV = 0;
  for ( let t = t0 + 29050; t < t0 + 60000; t += 50 ) { const d = M.cloudDrift(D, t); const s = Math.hypot(d[0] - dp[0], d[1] - dp[1]); maxV = Math.max(maxV, s / 0.05); dj = Math.max(dj, s); dp = d; }
  const vmax = Math.hypot(...M.cloudVel({ wind: { dir: 90, str: 1 } }));
  ok(maxV <= vmax * 1.001 && dj < vmax * 0.05 * 1.01, `drift: continuous through a wind change (largest 50 ms move ${dj.toFixed(4)} sq)`);
  const late = M.cleanParams(JSON.parse(JSON.stringify(D)));
  ok(near(M.cloudDrift(late, t0 + 45000)[0], M.cloudDrift(D, t0 + 45000)[0], 1e-6), "drift: deterministic (a late joiner computes the same)");
  // many keys: the oldest fold into the base with the drift there (no jump at the fold)
  let F = D, before = null, after = null;
  for ( let k = 0; k < 12; k++ ) {
    const t = t0 + 70000 + k * 5000;
    before = M.cloudDrift(F, t + 2500);
    F = { ...F, ...M.withKey(F, { wind: { dir: k * 30, str: 0.3 + 0.05 * k } }, t + 2500, { dur: 2000, lead: 0 }) };
    after = M.cloudDrift(F, t + 2500);
    if ( !near(before[0], after[0], 1e-6) || !near(before[1], after[1], 1e-6) ) break;
  }
  ok(F.base?.drift && near(before[0], after[0], 1e-6) && near(before[1], after[1], 1e-6), "drift: folding keys into the base keeps the drift");
  ok(M.cleanParams(JSON.parse(JSON.stringify(F))).base.drift.length === 2, "drift: stored in the base (round trip)");
}

/* J: strength v (VERSION 2): the mapping, bit-exact at the levels, overdrive, cap, lens, continuity */
{
  const eq = (f, v, p, s) => f.v === v && f.p === p && f.s === s;
  ok(eq(M.strength(0), 0, 0, 0) && eq(M.strength(0.5), 0.5, 0.5, 0) && eq(M.strength(1), 1, 1, 0) && eq(M.strength(2), 2, 1, 1) && eq(M.strength(3), 3, 1, 2), "strength: 0 off, 0..1 presence, 1 / 2 / 3 = s 0 / 1 / 2");
  ok(M.V_MAX === 3.35 && M.strength(9).v === M.V_MAX && near(M.strength(9).s, 2.35, 1e-12) && eq(M.strength(NaN), 0, 0, 0) && eq(M.strength(-1), 0, 0, 0), "strength: clamped to 0..V_MAX (the overdrive top 3.35)");
  // the old level formulas (main before VERSION 2), kept here as the reference
  const oldS = (L, i = 0.5) => L - 1 + (i - 0.5) * 0.7;
  const t0 = 2_000_000;
  let exact = true, why = "";
  for ( const e of M.EFFECTS ) for ( const L of [1, 2, 3] ) {
    // (a) a key straight at L; (b) the same as a v1 key { l, i: 0.5 }; (c) a chain of interrupted ramps through odd strengths ending at L
    const flags = [
      { keys: [{ t: t0, dur: 20000, preset: "custom", fx: { [e]: L } }] },
      { v: 1, keys: [{ t: t0, dur: 20000, preset: "custom", level: L, i: 0.5, fx: { [e]: { l: L, i: 0.5 } } }] },
      { keys: [{ t: t0 - 30000, dur: 9000, preset: "custom", fx: { [e]: 0.37 } }, { t: t0 - 25000, dur: 7000, preset: "custom", fx: { [e]: 3.35 } }, { t: t0 - 21000, dur: 13000, preset: "custom", fx: { [e]: 2.45 } }, { t: t0, dur: 20000, preset: "custom", fx: { [e]: L } }] }
    ];
    for ( const raw of flags ) {
      const P = M.cleanParams(JSON.parse(JSON.stringify(raw)));
      for ( const dt of [20000, 20001, 95000] ) {
        const f = M.resolve(P, t0 + dt).fx[e];
        if ( !f || f.p !== 1 || f.s !== oldS(L) || f.v !== L ) { exact = false; why = `${e} ${L} ${JSON.stringify(f)}`; continue; }
        if ( JSON.stringify(M.gates(e, f.s)) !== JSON.stringify(M.gates(e, oldS(L))) || JSON.stringify(M.lensGates(e, M.lensS(P, f.s, 3))) !== JSON.stringify(M.lensGates(e, oldS(L))) ) { exact = false; why = `${e} ${L} gates`; }
        for ( const cap of [1, 2, 3] ) if ( M.capFx({ [e]: f }, cap)[e].s !== Math.min(oldS(L), cap - 1 + 0.35) || M.capFx({ [e]: f }, cap)[e].p !== 1 ) { exact = false; why = `${e} ${L} cap ${cap}`; }
      }
    }
  }
  ok(exact, `at v = 1 / 2 / 3 every resolved p, s, gate, lens gate and client cap equals the old level 1 / 2 / 3 at i 0.5, bit for bit ${why}`);
  // fire and rain-at-a-point read p and s: the same numbers in, the same out (spot check against the old formula)
  { const r = M.resolve(M.cleanParams({ keys: [{ t: 0, dur: 0, preset: "rain", level: 3 }] }), 1000).fx.rain;
    ok(r.p * M.gate([0.35, 0.7, 1], r.s) === 1 && JSON.stringify(M.fireWet({ fx: { rain: r } })) === JSON.stringify(M.fireWet({ fx: { rain: { p: 1, s: oldS(3) } } })), "fireWet / rainAt at level 3: unchanged"); }
  // the wet ceiling at the levels: a cut key (dur 0) wets exactly as before (closed form, the same expression)
  { let same = true;
    for ( const L of [1, 2, 3] ) { const P = M.cleanParams({ keys: [{ t: t0, dur: 0, preset: "rain", level: L }], ground: { wetRate: 60, dryRate: 300 } });
      for ( const dt of [1000, 45000, 600000] ) { const c = M.wetCeil(oldS(L)), want = c + (0 - c) * Math.exp(-(dt / 1000) / 60); if ( M.resolve(P, t0 + dt).wet !== want ) same = false; } }
    ok(same, "wet ground at levels 1 / 2 / 3: bit for bit the old closed form"); }
  // the lens fixed at a level: as before; at a strength below 1: the level-1 lens faded in (lensP)
  { let same = true;
    for ( const L of [1, 2, 3] ) for ( const s of [0, 0.4, 1, 2, 2.35] ) for ( const cap of [1, 2, 3] ) if ( M.lensS(M.cleanParams({ lens: { level: L } }), s, cap) !== Math.min(L - 1, cap - 1 + 0.35) ) same = false;
    const A = M.cleanParams(), H = M.cleanParams({ lens: { level: 0.5 } }), D = M.cleanParams({ lens: { level: 3.35 } });
    ok(same && M.lensP(A) === 1 && M.lensP(M.cleanParams({ lens: { level: 2 } })) === 1 && M.lensP(H) === 0.5 && M.lensS(H, 2, 3) === 0 && near(M.lensS(D, 0, 3), 2.35, 1e-12) && near(M.lensS(D, 0, 2), 1.35, 1e-12), "lens: fixed levels as before, a fixed strength < 1 fades in, overdrive capped by the client"); }
  // the overdrive: the old level 3 at fine intensity 1 is v 3.35, the densities x 1.35 as before
  { const f = M.resolve(M.cleanParams({ keys: [{ t: 0, dur: 0, preset: "rain", level: 3.35 }] }), 1000).fx.rain;
    ok(f.v === 3.35 && f.p === 1 && near(f.s, oldS(3, 1), 1e-12) && near(M.gates("rain", f.s).mid, 150 * 1.35, 1e-9) && M.gates("rain", f.s).crown === 1, "overdrive 3.35 = the old level 3 at i 1 (densities x 1.35, other gates held)"); }
  ok(M.capV(3.35, 3) === 3.35 && M.capV(3.35, 2) === 2.35 && M.capFx({ rain: M.strength(0.4) }, 1).rain.p === 0.4, "cap: a no-op at 3; caps the strength, never the presence");
  // continuity along v 0 -> V_MAX -> 0: p, s and every gate (densities scaled by p, as the consumers draw them) move by at most their slope
  { let worst = 0, name = "";
    const dv = 0.001;
    for ( const e of M.EFFECTS ) {
      const T = M.TABLES[e], tabs = [...Object.entries(T).filter(([, t]) => Array.isArray(t)), ...Object.entries(T.lens ?? {})];
      for ( let k = 0; k < 2 * Math.round(M.V_MAX / dv); k++ ) {
        const up = k < Math.round(M.V_MAX / dv), v0 = up ? k * dv : (2 * Math.round(M.V_MAX / dv) - k) * dv, v1 = up ? v0 + dv : v0 - dv;
        const a = M.strength(v0), b = M.strength(v1);
        worst = Math.max(worst, Math.abs(a.p - b.p) / dv, Math.abs(a.s - b.s) / dv);
        for ( const [key, t] of tabs ) {
          const ga = a.p * M.gate(t, a.s, ["mid", "far", "near", "bead", "grit", "motes", "spark", "crystals", "impacts", "flecks", "lines", "debris"].includes(key)), gb = b.p * M.gate(t, b.s, ["mid", "far", "near", "bead", "grit", "motes", "spark", "crystals", "impacts", "flecks", "lines", "debris"].includes(key));
          const slope = Math.max(...t.map(Math.abs)) * 2;   // (|b - a|, |c - b|, the presence ramp and the overdrive are each <= 2 x max |entry|)
          const r = Math.abs(ga - gb) / dv / (slope || 1);
          if ( r > worst ) { worst = r; name = `${e}.${key}`; }
        }
      }
    }
    ok(worst <= 1 + 1e-6, `v 0 -> 3.35 -> 0: p, s and every gate x p continuous (worst normalised slope ${worst.toFixed(4)} ${name})`); }
  // the timeline 0 -> 3 -> 0.5 -> 0: v, p, s continuous at 50 ms, within the smoothstep's slope
  { let P = M.cleanParams(); const t1 = 3_000_000;
    P = { ...P, ...M.withKey(P, { preset: "snow", level: 3 }, t1, { dur: 12000, lead: 0 }) };
    P = { ...P, ...M.withKey(P, { level: 0.5 }, t1 + 7000, { dur: 9000, lead: 0 }) };
    P = { ...P, ...M.withKey(P, { level: 0 }, t1 + 20000, { dur: 6000, lead: 0 }) };
    let w = 0, prev = { v: 0, p: 0, s: 0 };
    for ( let t = t1; t < t1 + 28000; t += 50 ) { const f = M.resolve(P, t).fx.snow ?? { v: 0, p: 0, s: 0 }; w = Math.max(w, Math.abs(f.v - prev.v), Math.abs(f.p - prev.p), Math.abs(f.s - prev.s)); prev = f; }
    const bound = 1.5 * 3 * 50 / 12000 + 1e-9;
    ok(w <= bound && !M.resolve(P, t1 + 27000).fx.snow && near(M.resolve(P, t1 + 19000).fx.snow.v, 0.5), `timeline 0 -> 3 -> 0.5 -> 0 continuous (largest 50 ms step ${w.toFixed(4)} <= ${bound.toFixed(4)})`); }
}

/* K: migration of v1 flags at read time */
{
  const t0 = 4_000_000, path = [[100, 100], [400, 300]];
  const storm = { on: true, rate: 0.6, power: 0.8, near: 0.3, bolts: true, t: 1234, prev: { on: false } };
  const v1 = {
    v: 1, on: true, who: "all", seed: 7,
    keys: [
      { t: t0, dur: 0, preset: "rain", level: 2, i: 0.5, fx: { rain: { l: 2, i: 0.5 } }, wind: { dir: 10, str: 0.4, gust: 0.5 } },
      { t: t0 + 1000, dur: 0, preset: "storm", level: 3, i: 1, wind: { dir: 10, str: 0.4, gust: 0.5 } },                         // no fx: the preset at level 3, i 1
      { t: t0 + 2000, dur: 0, preset: "custom", level: 1, i: 0, fx: { snow: 2, sand: { l: 3, i: 0.9 }, dust: { level: 1, i: 0.2 }, clouds: { l: 2 } } }
    ],
    base: { t: t0 - 5000, fx: { rain: { p: 1, s: 1 }, snow: { p: 0.4, s: 2 }, sand: { p: 1, s: 2.35 }, dust: { p: 0.9995, s: -0.2 }, embers: { p: 0, s: 1 } }, wind: { dir: 0, str: 0.2, gust: 0.5 }, wet: 0.3, cover: 0.1 },
    lens: { on: true, level: 3, strength: 0.8 },
    tornadoes: [{ id: "tw", path, t0: t0, level: 3, lv0: 1, lvT: t0 }],
    storm
  };
  const P = M.cleanParams(JSON.parse(JSON.stringify(v1)));
  const [k0, k1, k2] = P.keys;
  ok(P.v === M.VERSION && M.VERSION === 2, "a v1 flag reads as VERSION 2");
  ok(k0.fx.rain === 2 && k0.level === 2 && !("i" in k0) && k0.preset === "rain", "key fx { l: 2, i: 0.5 } -> 2 (no i kept)");
  ok(k1.level === M.V_MAX && k1.fx.rain === M.V_MAX && k1.fx.wind === M.V_MAX, "key level 3 + i 1 (no fx) -> the preset at 3.35: the overdrive, not clamped (Q1)");
  ok(near(k2.level, 0.65, 1e-12) && k2.fx.snow === 2 && near(k2.fx.sand, 3.28, 1e-12) && near(k2.fx.dust, 0.79, 1e-12) && k2.fx.clouds === 2, "key fx: number unchanged, { l, i } -> l + (i - 0.5) x 0.7, { level } accepted, missing i = 0.5");
  const B = P.base.fx;
  ok(B.rain === 2 && B.snow === 0.4 && B.sand === M.V_MAX && near(B.dust, 0.8, 1e-12) && !("embers" in B), "base { p, s } -> v = s + 1 at full presence, else the presence; p 0 dropped");
  ok(P.lens.level === 3 && P.lens.strength === 0.8 && P.tornadoes[0].level === 3 && P.tornadoes[0].lv0 === 1, "lens int and tornado ints unchanged");
  ok(JSON.stringify(P.storm) === JSON.stringify(SM.cleanStorm(storm)) && P.storm.on === true, "the lightning's storm field passes through");
  ok(JSON.stringify(M.cleanParams(JSON.parse(JSON.stringify(P)))) === JSON.stringify(P), "migrated flag: round trip stable (idempotent)");
  ok(M.cleanParams({ keys: [{ t: 5, preset: "rain" }] }).storm === undefined, "no storm: none added");
  // a v1 flag and the v2 flag it migrates to resolve the same, every moment
  const v2 = { keys: [{ t: t0, dur: 0, preset: "rain", level: 2, fx: { rain: 2 }, wind: v1.keys[0].wind }, { t: t0 + 1000, dur: 0, preset: "storm", level: 3.35, fx: { rain: 3.35, wind: 3.35 }, wind: v1.keys[1].wind },
    { t: t0 + 2000, dur: 0, preset: "custom", level: 0.65, fx: { snow: 2, sand: 3.28, dust: 0.79, clouds: 2 } }], base: { t: t0 - 5000, fx: { rain: 2, snow: 0.4, sand: 3.35, dust: 0.8 }, wind: v1.base.wind, wet: 0.3, cover: 0.1 } };
  const Q = M.cleanParams(v2);
  ok([t0 - 6000, t0 - 100, t0 + 500, t0 + 1500, t0 + 99999].every((t) => JSON.stringify(M.resolve(P, t)) === JSON.stringify(M.resolve(Q, t))), "v1 and its v2 resolve the same");
  // v1 fine intensity at the steady state: the same level continuum s (densities as before); below level 1 the presence carries it
  { let same = true;
    for ( const L of [1, 2, 3] ) for ( let k = 0; k <= 20; k++ ) {
      const i = k / 20, S = M.cleanParams({ v: 1, keys: [{ t: 0, dur: 0, preset: "rain", level: L, i }] }), f = M.resolve(S, 1000).fx.rain, so = L - 1 + (i - 0.5) * 0.7;
      if ( so >= 0 ) { if ( f.p !== 1 || !near(f.s, so, 1e-9) ) same = false; }
      else if ( f.s !== 0 || !near(f.p * M.gate(M.TABLES.rain.mid, 0, true), M.gate(M.TABLES.rain.mid, so, true), 1e-9) ) same = false;
    }
    ok(same, "v1 level + fine intensity: s as before (at and above level 1); below it the presence gives the same densities"); }
  // the resolved state written back as a base (dryNow): { v, p, s } objects read as their v
  { const st = M.stateAt(Q, t0 + 1500); const R = M.cleanParams({ base: { t: 1, fx: st.fx, wind: st.wind } });
    ok(R.base.fx.rain === 3.35 && R.base.fx.wind === 3.35 && R.base.fx.clouds === undefined, "a resolved { v, p, s } state as a base: its strengths"); }
  // lens levels
  const lv = (level) => M.cleanParams({ lens: { level } }).lens.level;
  ok(lv(undefined) === "auto" && lv(null) === "auto" && lv("x") === "auto" && lv("2") === 2 && lv(0.5) === 0.5 && lv(9) === M.V_MAX && lv(0) === 0 && lv(2.4500001) === 2.45, "lens level: auto, a strength 0..3.35 (form strings read)");
}

/* L: withKey patch semantics */
{
  const t0 = 5_000_000, o = { dur: 1000, lead: 0 };
  let P = M.cleanParams(), at = t0;
  const go = (change) => { P = { ...P, ...M.withKey(P, change, at, o) }; at += 2000; return P.keys.at(-1); };
  let k = go({ preset: "rain", level: 2.4 });
  ok(k.preset === "rain" && k.level === 2.4 && JSON.stringify(k.fx) === '{"rain":2.4}', "preset + level: its effects at that strength");
  k = go({ preset: "snow" });
  ok(k.preset === "snow" && JSON.stringify(k.fx) === '{"snow":2.4}' && k.level === 2.4, "a preset click carries the strength (rain 2.4 -> snow 2.4)");
  k = go({ fx: { rain: 1.2 } });
  ok(k.preset === "custom" && k.fx.snow === 2.4 && k.fx.rain === 1.2 && k.level === 2.4, "fx patch: added to the effects; no preset has that set -> custom, level kept");
  k = go({ fx: { snow: 0 } });
  ok(k.preset === "rain" && JSON.stringify(k.fx) === '{"rain":1.2}' && k.level === 1.2, "fx patch v 0 removes; the set is a preset's again -> its name and level");
  k = go({ fx: { wind: 1.2 } });
  ok(k.preset === "storm" && k.level === 1.2, "rain + wind at one strength = storm at that strength");
  k = go({ level: 3 });
  ok(k.preset === "storm" && k.fx.rain === 3 && k.fx.wind === 3 && k.level === 3, "level alone: every effect of the preset");
  k = go({ clouds: 1.5 });
  ok(k.fx.clouds === 1.5 && k.preset === "storm" && k.level === 3, "clouds: v (sugar for the fx patch), the preset kept");
  k = go({ level: 0 });
  ok(k.preset === "clouds" && JSON.stringify(k.fx) === '{"clouds":1.5}' && k.level === 3, "level 0: the preset's effects off, clouds kept (only clouds: the clouds preset), the strength remembered");
  k = go({ preset: "rain" });
  ok(k.fx.rain === 3 && k.fx.clouds === 1.5 && k.preset === "rain", "a preset click keeps the clouds, at the remembered strength");
  k = go({ preset: "clear" });
  ok(k.preset === "clear" && JSON.stringify(k.fx) === "{}" && k.level === 3, "clear clears everything (the level carried)");
  k = go({ level: 2 });
  ok(k.preset === "clear" && JSON.stringify(k.fx) === "{}" && k.level === 2, "level on clear: nothing on, the strength remembered for the next preset");
  k = go({ preset: "custom", fx: { dust: 1, embers: { l: 2, i: 0.5 }, nope: 3 } });
  ok(k.preset === "custom" && JSON.stringify(k.fx) === '{"dust":1,"embers":2}', "custom + fx: exactly those (v1 objects read, unknown effects ignored)");
  k = go({ preset: "rain", level: 2 }); k = go({ i: 1 });
  ok(near(k.fx.rain, 2.35, 1e-12) && near(k.level, 2.35, 1e-12), "v1 caller: i alone = the level's step + (i - 0.5) x 0.7");
  k = go({ level: 2, i: 0 });
  ok(near(k.fx.rain, 1.65, 1e-12), "v1 caller: level + i folded");
  k = go({ level: 9 });
  ok(k.fx.rain === M.V_MAX && k.level === M.V_MAX, "a strength above the overdrive clamps to 3.35");
  k = go({ wind: { dir: 90 } });
  ok(k.fx.rain === M.V_MAX && k.wind.dir === 90 && k.preset === "rain", "wind alone keeps the effects");
  ok(M.presetOf({}) === "clear" && M.presetOf({ clouds: 1 }) === "clouds" && M.presetOf({ rain: 1, clouds: 2 }) === "rain" && M.presetOf({ snow: 1, wind: 2 }) === "blizzard" && M.presetOf({ rain: 1, snow: 1 }) === "custom", "presetOf");
  ok(JSON.stringify(M.drivenFx("storm")) === '["rain","wind"]' && JSON.stringify(M.drivenFx("clouds")) === '["clouds"]' && M.drivenFx("clear").length === 0 && JSON.stringify(M.drivenFx("custom", { dust: 1, clouds: 1 })) === '["dust"]', "drivenFx");
  // folding keys into the base (v2: strengths), continuous and stable
  let cont = true;
  for ( let n = 0; n < 12; n++ ) {
    const before = M.resolve(P, at);
    P = { ...P, ...M.withKey(P, { fx: { snow: (n % 7) * 0.45 } }, at, { dur: 3000, lead: 0 }) };
    P = M.cleanParams(JSON.parse(JSON.stringify(P)));
    const after = M.resolve(P, at);
    for ( const e of new Set([...Object.keys(before.fx), ...Object.keys(after.fx)]) ) if ( Math.abs((before.fx[e]?.v ?? 0) - (after.fx[e]?.v ?? 0)) > 1e-4 ) cont = false;
    at += 1500;
  }
  ok(cont && P.keys.length === M.KEEP_KEYS && Object.values(P.base.fx).every((v) => typeof v === "number"), "folding into the base: strengths stored, no jump");
}

console.log(`${fails ? "FAIL" : "ok"} weather model: ${n - fails}/${n} checks`);
process.exit(fails ? 1 : 0);
