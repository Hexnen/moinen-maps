// The rain's lightning, the pure part (scripts/weather/storm-model.mjs, its place in model.mjs):   node dev/weather-storm.test.mjs
//   A. cleaning: no storm -> the flag has no `storm` key (a scene that never set it stores what it did); clamps; round trip; a change
//      keeps the settings before it
//   B. determinism: the same settings, seed and rain give the same flashes on every call and for any window; another seed others
//   C. how often: about rate x mean activity per minute; none without rain or when off; fewer in a light shower (rain presence)
//   D. switches: a flash that started before a switch keeps its settings (an off never cuts one); none before a switch-on
//   E. the light: nothing before a flash (but a close strike's sky flickers), peaks near I, falls to ~0 by its end, never negative;
//      the calm swell (no-flash / reduced motion) is slow, faint and single (no flicker: never two rises)
//   F. close strikes pulse on the strike preset's timing (their bolt and light together), kinds follow the distance
//   H. the gloom: glides in / out with the switch, follows the rain, a distance change glides
//   G. the shaders: the rain's flash term and the cloud glow are exact no-ops at 0 (the plain look unchanged)
import * as S from "../scripts/weather/storm-model.mjs";
import * as M from "../scripts/weather/model.mjs";
import { timing } from "../scripts/presets/lightning-core.mjs";
import { RAIN_FRAG } from "../scripts/weather/glsl.mjs";
import { BODY_FRAG } from "../scripts/weather/clouds-glsl.mjs";
import { readFileSync } from "node:fs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const rain1 = () => 1;
const H = 3600000;

/* A */
{
  const P = M.cleanParams({ keys: [{ t: 5, preset: "rain" }] });
  ok(!("storm" in P), "no storm set -> no storm key");
  ok(JSON.stringify(M.cleanParams(JSON.parse(JSON.stringify(P)))) === JSON.stringify(P), "round trip without storm");
  const Q = M.cleanParams({ storm: { on: true, rate: 99, power: -3, near: "x", bolts: false, t: 1234.6, prev: { on: false } } });
  ok(Q.storm.on && Q.storm.rate === S.LIMITS.rate[1] && Q.storm.power === 0 && Q.storm.near === S.DEFAULT.near && Q.storm.bolts === false && Q.storm.t === 1235, "clamps");
  ok(Q.storm.prev && Q.storm.prev.on === false && Q.storm.prev.rate === S.DEFAULT.rate, "prev cleaned");
  ok(JSON.stringify(M.cleanParams(JSON.parse(JSON.stringify(Q)))) === JSON.stringify(Q), "round trip with storm");
  ok(M.cleanParams({ storm: null }).storm === undefined && M.cleanParams({ storm: 5 }).storm === undefined, "junk storm dropped");
  const a = S.withChange(null, { on: true }, 1000), b = S.withChange(a, { rate: 12 }, 5000);
  ok(a.prev === null && a.on && a.t === 1000, "first change: no prev");
  ok(b.prev.on && b.prev.rate === S.DEFAULT.rate && b.rate === 12 && b.on && b.t === 5000, "a change keeps the settings before it");
}

/* B */
{
  const st = S.withChange(null, { on: true, rate: 10 }, 1);
  const A = S.flashes(st, 7, 0, 600000, rain1), B = S.flashes(st, 7, 0, 600000, rain1);
  ok(A.length > 10 && JSON.stringify(A) === JSON.stringify(B), "deterministic");
  const parts = [...S.flashes(st, 7, 0, 300000, rain1), ...S.flashes(st, 7, 300000, 600000, rain1)];
  const uniq = new Map(parts.map((e) => [e.k, JSON.stringify(e)]));
  ok(uniq.size === A.length && A.every((e) => uniq.get(e.k) === JSON.stringify(e)), "any window gives the same flashes (late joiner)");
  const C = S.flashes(st, 8, 0, 600000, rain1);
  ok(JSON.stringify(C.map((e) => e.t)) !== JSON.stringify(A.map((e) => e.t)), "another seed, other flashes");
  ok(A.every((e) => e.t >= e.k * S.SLOT && e.t < (e.k + 1) * S.SLOT), "each flash inside its slot");
}

/* C */
{
  const meanAct = (() => { let s = 0; for ( let t = 0; t < 40 * H; t += 7000 ) s += S.activity(3, t); return s / (40 * H / 7000); })();
  ok(meanAct > 0.85 && meanAct < 1.15, `activity averages ~1 (${meanAct.toFixed(3)})`);
  for ( const rate of [3, 8, 20] ) {
    const st = S.withChange(null, { on: true, rate }, 1), N = S.flashes(st, 3, 0, 4 * H, rain1).length / 240;
    const want = Math.min(rate * meanAct, 60 * 0.85);
    ok(Math.abs(N - want) / want < 0.25, `rate ${rate}: ${N.toFixed(2)} / min (want ~${want.toFixed(1)})`);
  }
  const st = S.withChange(null, { on: true, rate: 10 }, 1);
  ok(S.flashes(st, 3, 0, H, () => 0).length === 0, "no rain, no lightning");
  ok(S.flashes({ ...st, on: false }, 3, 0, H, rain1).length === 0, "off: none");
  ok(S.flashes(st, 3, 0, H, () => 0.3).length < S.flashes(st, 3, 0, H, rain1).length * 0.6, "a light shower flashes less");
  ok(S.flashes(null, 3, 0, H, rain1).length === 0, "never set: none");
}

/* D */
{
  const on = S.withChange(null, { on: true, rate: 20 }, 100000);
  ok(S.flashes(on, 5, 0, 99000, rain1).length === 0, "none before the switch-on");
  ok(S.flashes(on, 5, 100000, 200000, rain1).every((e) => e.t >= 100000), "after it");
  const all = S.flashes(on, 5, 100000, 400000, rain1), cutAt = all[5].t + 50;
  const off = S.withChange(on, { on: false }, cutAt);
  const after = S.flashes(off, 5, cutAt, cutAt + 5000, rain1);
  ok(after.some((e) => e.k === all[5].k) && after.every((e) => e.t < cutAt), "switch-off: the running flash finishes, no new one");
  ok(JSON.stringify(after.find((e) => e.k === all[5].k)) === JSON.stringify(all[5]), "the running flash keeps its look");
}

/* E, F */
{
  const st = S.withChange(null, { on: true, rate: 30, near: 0.5 }, 1);
  const all = S.flashes(st, 11, 0, 2 * H, rain1), kinds = { far: 0, mid: 0, close: 0 };
  let bad = 0, badEnd = 0, badCalm = 0, badPre = 0, badStroke = 0, peakMax = 0;
  for ( const e of all ) {
    kinds[e.kind]++;
    let peak = 0, prev = 0, rises = 0, up = false, cmax = 0;
    for ( let t = S.SPAN[0]; t <= e.end; t += 4 ) {
      const l = S.lightAt(e, t); if ( l < 0 || !Number.isFinite(l) ) bad++;
      peak = Math.max(peak, l);
      if ( t < 0 && l > 0 && e.kind !== "close" ) badPre++;
      const c = S.calmAt(e, t); cmax = Math.max(cmax, c);
      if ( c > prev + 1e-9 ) { if ( !up ) rises++; up = true; } else if ( c < prev - 1e-9 ) up = false;
      if ( Math.abs(c - prev) > 0.02 * e.I ) badCalm++;
      prev = c;
    }
    if ( S.lightAt(e, e.end) > 0.05 * e.I ) badEnd++;
    if ( rises > 1 || cmax > S.CALM.k * e.I + 1e-9 ) badCalm++;
    if ( peak < 0.5 * e.I || peak > 1.6 * e.I ) bad++;
    peakMax = Math.max(peakMax, peak);
    if ( e.kind === "close" && JSON.stringify(e.strokes) !== JSON.stringify(timing(e.seed, e.lv).strokes) ) badStroke++;
  }
  ok(all.length > 300, `enough flashes to test (${all.length})`);
  ok(!bad, `light finite, peaks near I (${bad})`);
  ok(!badPre, "nothing before a far / mid flash");
  ok(!badEnd, `the light is ~gone by the end (${badEnd})`);
  ok(!badCalm, `the calm swell: slow, faint, single (${badCalm})`);
  ok(!badStroke, "close strikes on the strike preset's timing");
  ok(peakMax < 1.6, "the brightest light stays bounded");
  ok(kinds.far > 0 && kinds.mid > 0 && kinds.close > 0, `all kinds (${JSON.stringify(kinds)})`);
  const share = (near) => { const s2 = S.withChange(null, { on: true, rate: 30, near }, 1), f = S.flashes(s2, 11, 0, 2 * H, rain1); return f.filter((e) => e.kind === "close").length / f.length; };
  ok(share(0) < 0.1 && share(1) > 0.4, "distance: few strikes far away, many overhead");
  const nb = S.flashes(S.withChange(null, { on: true, rate: 30, near: 1, bolts: false }, 1), 11, 0, H, rain1);
  ok(nb.every((e) => !e.bolt) && S.flashes(S.withChange(null, { on: true, rate: 30, near: 1 }, 1), 11, 0, H, rain1).some((e) => e.bolt), "visible bolts setting");
  const pl = S.placeOf(all.find((e) => e.kind === "close"), { x: 100, y: 50, width: 3000, height: 2000 }, 100);
  ok(pl.x >= 100 && pl.x <= 3100 && pl.y >= 50 && pl.y <= 2050, "a close strike lands in the scene");
  const fp = S.placeOf(all.find((e) => e.kind === "far"), { x: 0, y: 0, width: 3000, height: 2000 }, 100);
  ok(Math.hypot(fp.x - 1500, fp.y - 1000) > Math.hypot(1500, 1000), "a distant flash lies beyond the scene");
}

/* H: the gloom */
{
  const on = S.withChange(null, { on: true, near: 1 }, 10000), off = S.withChange(on, { on: false }, 40000), nearer = S.withChange(S.withChange(null, { on: true, near: 0 }, 1), { near: 1 }, 10000);
  ok(S.gloomAt(null, 5000, rain1) === 0 && S.gloomAt(on, 9000, rain1) === 0, "no gloom before the switch-on");
  let jump = 0, prev = 0;
  for ( let t = 9000; t < 60000; t += 16 ) { const g = S.gloomAt(off.t <= t ? off : on, t, rain1); if ( Math.abs(g - prev) > 0.002 ) jump++; prev = g; }
  ok(!jump, "the gloom glides in and out (no step over 0.002 a frame)");
  ok(Math.abs(S.gloomAt(on, 30000, rain1) - 0.18) < 1e-9 && S.gloomAt(off, 50000, rain1) === 0, "full when on, gone after the fade");
  ok(S.gloomAt(on, 30000, () => 0) === 0, "no rain, no gloom");
  ok(Math.abs(S.gloomAt(nearer, 10000 + S.GLOOM_MS / 2, rain1) - (0.07 + 0.18) / 2) < 1e-9, "a distance change glides");
}

/* G */
{
  ok(/uniform float uFlash;/.test(RAIN_FRAG) && /fa = 1\.0 \+ uFlash \* 0\.9/.test(RAIN_FRAG), "the rain carries the flash term");
  ok(/if \( uBolt\.w > 0\.0 \)/.test(BODY_FRAG), "the cloud glow only when lit");
  const disp = readFileSync(new URL("../scripts/weather/display.mjs", import.meta.url), "utf8");
  ok(/uFlash: 0/.test(disp), "the rain's flash starts at 0");
  const wx = readFileSync(new URL("../scripts/weather/weather.mjs", import.meta.url), "utf8");
  ok(/const S = P\.storm \?\? null/.test(wx) && /S\.on \|\| \(S\.prev\?\.on && now - S\.t < SM\.GLOOM_MS/.test(wx), "no storm object unless the scene's lightning is (or just was) on");
}

console.log(fails ? `${fails}/${n} FAILED` : `all ${n} checks passed`);
process.exit(fails ? 1 : 0);
