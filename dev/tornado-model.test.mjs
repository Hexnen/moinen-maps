// Tornado, the pure parts (scripts/weather/tornado-model.mjs, the vortex in scripts/wind.mjs):   node dev/tornado-model.test.mjs
//   A. cleaning: junk dropped, clamps, ids, at most 3 (the newest), path simplified and capped, the flag round trip (JSON)
//   B. motion: the base starts at the path's start, moves continuously (no jumps at the ends: loop turns back eased, stop / ropeOut
//      brake to the end), deterministic, a single point stays near it (wander only)
//   C. phases: forming -> on the ground -> roping out -> gone; presence continuous; a GM "out" and the ropeOut end both rope out
//   D. levels: a change ramps over LEVEL_MS, the table is continuous across levels
//   E. vortex: counter-clockwise on the map (SPIN), inflow toward the base, nothing beyond the reach, vortices() only while present
import * as TM from "../scripts/weather/tornado-model.mjs";
import * as W from "../scripts/wind.mjs";
import * as M from "../scripts/weather/model.mjs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const G = 100;

/* A */
{
  ok(TM.cleanTornado(null) === null && TM.cleanTornado({ id: "a", path: [], t0: 0 }) === null && TM.cleanTornado({ id: "a b!", path: [[0, 0]], t0: 0 }) === null, "junk dropped");
  const T = TM.cleanTornado({ id: "t1", path: [{ x: 10.4, y: 20.6 }, [10, 21], [300, 400]], t0: 1000, level: 9, speed: 50, size: 0, end: "nope" });
  ok(T && T.path.length === 2 && T.path[0][0] === 10 && T.path[0][1] === 21, "path rounded, duplicates dropped");
  ok(T.level === 2 && T.speed === TM.LIMITS.speed[1] && T.size === TM.LIMITS.size[0] && T.end === TM.DEFAULTS.end && T.out === null && T.damage === false, "clamps, an out-of-range level falls back to the default, damage off");
  ok(JSON.stringify(TM.cleanTornado(JSON.parse(JSON.stringify(T)))) === JSON.stringify(T), "round trip");
  const long = TM.cleanPath(Array.from({ length: 500 }, (_, i) => [i * 7, Math.round(200 * Math.sin(i / 9))]));
  ok(long.length <= 64 && long.length >= 4, "path capped at 64 points");
  const four = TM.cleanTornadoes([1, 2, 3, 4].map((i) => ({ id: `k${i}`, path: [[0, 0]], t0: i })));
  ok(four.length === TM.MAX_TORNADOES && four[0].id === "k2", "at most 3, the newest kept");
  ok(M.cleanParams({ tornadoes: [{ id: "z", path: [[1, 2]], t0: 5 }] }).tornadoes.length === 1 && M.cleanParams().tornadoes.length === 0, "in the weather flag");
}

/* B */
{
  const path = [[0, 0], [800, 0], [800, 600]];
  for ( const end of TM.ENDS ) {
    const T = TM.cleanTornado({ id: `m-${end}`, path, t0: 0, wander: 0, speed: 1, end });
    const p0 = TM.baseAt(T, 0, G);
    ok(Math.hypot(p0[0], p0[1]) < 1, `${end}: starts at the path's start`);
    let maxStep = 0, prev = p0;
    for ( let t = 20; t <= 40000; t += 20 ) { const p = TM.baseAt(T, t, G); maxStep = Math.max(maxStep, Math.hypot(p[0] - prev[0], p[1] - prev[1])); prev = p; }
    ok(maxStep < G * 1 * 0.02 * 1.6, `${end}: continuous (largest 20 ms step ${maxStep.toFixed(2)} px)`);
    ok(JSON.stringify(TM.baseAt(T, 12345, G)) === JSON.stringify(TM.baseAt(T, 12345, G)), `${end}: deterministic`);
    if ( end !== "loop" ) { const e = TM.baseAt(T, 60000, G); ok(Math.hypot(e[0] - 800, e[1] - 600) < 2, `${end}: ends at the path's end`); }
  }
  const S = TM.cleanTornado({ id: "still", path: [[500, 500]], t0: 0, wander: 0.35 });
  let far = 0; for ( let t = 0; t < 120000; t += 250 ) { const p = TM.baseAt(S, t, G); far = Math.max(far, Math.hypot(p[0] - 500, p[1] - 500)); }
  ok(far > 1 && far <= 0.35 * G * Math.SQRT2, "one point: wanders near it");
}

/* C */
{
  const T = TM.cleanTornado({ id: "ph", path: [[0, 0]], t0: 10000 });
  const a = TM.phase(T, 9000, G), b = TM.phase(T, 10000 + TM.FORM_MS + 100, G);
  ok(a.p === 0 && a.touch === 0 && !a.gone, "not yet");
  ok(b.p > 0.99 && b.touch > 0.99 && b.cloud > 0.99 && !b.forming, "formed, on the ground");
  ok(TM.phase({ ...T, out: 30000 }, 30000 + TM.ROPE_MS + 1, G).gone, "GM out: gone after the rope-out");
  let maxD = 0, prev = TM.phase({ ...T, out: 30000 }, 9000, G);
  for ( let t = 9020; t < 40000; t += 20 ) { const q = TM.phase({ ...T, out: 30000 }, t, G); maxD = Math.max(maxD, Math.abs(q.p - prev.p), Math.abs(q.touch - prev.touch), Math.abs(q.cloud - prev.cloud), Math.abs(q.reach - prev.reach)); prev = q; }
  ok(maxD < 0.02, `presence continuous (largest 20 ms step ${maxD.toFixed(4)})`);
  const R = TM.cleanTornado({ id: "ro", path: [[0, 0], [300, 0]], t0: 0, speed: 1, end: "ropeOut" });
  ok(TM.outAt(R, G) !== null && TM.phase(R, TM.outAt(R, G) + TM.ROPE_MS + 1, G).gone, "ropeOut end: ropes out after arriving");
  ok(TM.outAt(TM.cleanTornado({ id: "lo", path: [[0, 0], [300, 0]], t0: 0 }), G) === null, "loop: never ropes out by itself");
}

/* D */
{
  const T = TM.cleanTornado({ id: "lv", path: [[0, 0]], t0: 0, level: 3, lv0: 1, lvT: 1000 });
  ok(TM.levelS(T, 1000) === 0 && Math.abs(TM.levelS(T, 1000 + TM.LEVEL_MS) - 2) < 1e-9 && TM.levelS(T, 1000 + TM.LEVEL_MS / 2) > 0.5, "a level change ramps");
  let jump = 0;
  for ( const [k, t] of Object.entries(TM.TABLE) ) for ( let s = 0.01; s <= 2; s += 0.01 ) jump = Math.max(jump, Math.abs(TM.lv(t, s) - TM.lv(t, s - 0.01)) / (Math.max(...t.map(Math.abs)) || 1));
  ok(jump < 0.02, "the table is continuous");
}

/* E */
{
  const v = { x: 0, y: 0, R: 5, r0: 0.6, w: 8, inflow: 1, p: 1 };
  const [ex, ey] = TM.vortexWind(v, 2, 0);            // east of the base
  ok(ey < 0, "east of it the wind blows screen-up (north): counter-clockwise on the map");
  ok(ex < 0, "inflow toward the base");
  ok(TM.vortexWind(v, 6, 0).every((c) => c === 0), "nothing beyond the reach");
  ok(TM.SPIN === W.SPIN && TM.SPIN === -1, "SPIN shared");
  const T = TM.cleanTornado({ id: "vx", path: [[500, 500]], t0: 0, wander: 0 });
  ok(TM.vortices([T], -1000, G).length === 0 && TM.vortices([T], TM.FORM_MS + 10, G).length === 1, "vortices only while present");
  W.setVortexProvider(() => TM.vortices([T], TM.FORM_MS + 10, G));
  const [wx, wy] = W.vortexWindAt(700, 500, G);
  ok(wy < 0 && wx < 0, "vortexWindAt sums the provider's vortices (scene px in)");
  W.setVortexProvider(null);
  ok(W.vortexWindAt(700, 500, G).every((c) => c === 0), "no provider: no vortex wind");
}

console.log(`${n - fails}/${n} ok`);
if ( fails ) process.exit(1);
