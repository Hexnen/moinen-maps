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

/* F: the no-garbage forms give the same numbers as the reference formulas (the old allocating code, kept here) */
{
  const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
  const refWander = (T, e, grid) => {
    const w = T.wander * grid, s = T.seed, ph = (k) => ((s * (k + 3) * 2654435761) >>> 0) / 4294967296 * 6.2832;
    return [w * (0.6 * Math.sin(0.41 * e + ph(1)) + 0.3 * Math.sin(1.07 * e + ph(2)) + 0.1 * Math.sin(2.31 * e + ph(3))),
      w * (0.6 * Math.sin(0.37 * e + ph(4)) + 0.3 * Math.sin(0.93 * e + ph(5)) + 0.1 * Math.sin(2.67 * e + ph(6)))];
  };
  const refAlong = (P, s) => {
    const { pts, cum, L } = P;
    if ( pts.length === 1 || L <= 0 ) return [pts[0][0], pts[0][1]];
    s = Math.min(L, Math.max(0, s));
    let lo = 0, hi = cum.length - 1;
    while ( hi - lo > 1 ) { const m = (lo + hi) >> 1; if ( cum[m] <= s ) lo = m; else hi = m; }
    const f = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f];
  };
  const refBase = (T, now, grid) => {
    const e = Math.max(0, (now - T.t0) / 1000), P = TM.smoothPath(T.path);
    const [x, y] = refAlong(P, TM.distAt(T, e, grid)), [wx, wy] = refWander(T, e, grid);
    return [x + wx, y + wy];
  };
  let same = true;
  const out = [0, 0], mo = {};
  for ( const T of [TM.cleanTornado({ id: "f1", path: [[100, 100], [900, 300], [400, 800], [1200, 900]], t0: 0, wander: 0.4, speed: 0.3 }),
    TM.cleanTornado({ id: "f2", path: [[500, 500]], t0: 1000, wander: 0 }), TM.cleanTornado({ id: "f3", path: [[0, 0], [2000, 0]], t0: 0, end: "loop", speed: 2 })] ) {
    for ( let t = -2000; t < 60000; t += 137.3 ) {
      const r = refBase(T, t, G), b = TM.baseInto(T, t, G, out), a = TM.baseAt(T, t, G);
      if ( r[0] !== b[0] || r[1] !== b[1] || r[0] !== a[0] || r[1] !== a[1] ) same = false;
      const m = TM.motionInto(T, t, G, 0.45, mo), p0 = refBase(T, t - 450, G), p1 = refBase(T, t, G), p2 = refBase(T, t + 450, G), ma = refBase(T, t - 50, G), mb = refBase(T, t + 50, G);
      if ( m.vx !== (mb[0] - ma[0]) / 0.1 || m.ay !== (p0[1] - 2 * p1[1] + p2[1]) / (0.45 * 0.45) ) same = false;
      if ( TM.touchAt(T, t, G) !== TM.phase(T, t, G).touch ) same = false;
    }
  }
  ok(same, "baseInto / motionInto / touchAt = the reference formulas, bit for bit");
  ok([0, 0.5, 1.37, 2].every((s) => JSON.stringify(TM.looksOf(s)) === JSON.stringify(TM.looks(s))) && TM.looksOf(1.37) === TM.looksOf(1.37), "looksOf = looks, kept per s");
}

console.log(`${n - fails}/${n} ok`);
if ( fails ) process.exit(1);
