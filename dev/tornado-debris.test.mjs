// Tornado debris counts as continuous quantities (weather slider T4, D4 / D5):   node dev/tornado-debris.test.mjs
//   A. whole / share: a whole count gives shares of exactly 0 / 1 (the old Math.round items, bit for bit), a fractional one fades the
//      last slot; the shares sum to n (the drawn amount is continuous) and each moves at most as fast as n
//   B. fragKind / bigShare: at levels 1 / 2 / 3 exactly the old split (fragments [0, nF), planks [nF, nF + nP), big = h < 0.16 from
//      level 2 on); between levels the expected counts follow the table and the big share ramps smoothly
//   C. the real TornadoView.debris() (tornado.mjs with Foundry / PIXI stubs) through level ramps, one of them interrupted by a second
//      change (as a slider release mid-ramp does): every map fragment / plank keeps its kind and size for its whole life and is never
//      dropped mid-flight; at a settled level the fast path (today's slots only) draws exactly what the full path (every slot) draws
import * as TD from "../scripts/weather/tornado-debris.mjs";
import * as TM from "../scripts/weather/tornado-model.mjs";
import { hu } from "../scripts/wind.mjs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };

/* A */
{
  let bad = 0;
  for ( let N = 0; N <= 160; N++ ) {
    const w = TD.whole(N);
    for ( let i = 0; i < 170; i++ ) { const sh = TD.share(w, i); if ( sh !== (i < Math.round(N) ? 1 : 0) ) bad++; }
    let drawn = 0; for ( let i = 0; i < w; i++ ) drawn++;
    if ( drawn !== N ) bad++;
  }
  ok(!bad, `whole counts: shares exactly 0 / 1, ceil = n slots (${bad} bad)`);
  // the steady factors at the integer levels (touch 1, reach 1, q 1) are whole numbers: the old Math.round counts
  let bad2 = 0;
  for ( const s of [0, 1, 2] ) {
    const L = TM.looks(s);
    for ( const v of [L.specks * (0.3 + 0.7 * 1) * 1, L.wisps * (0.4 + 0.6 * 1) * 1, L.clumps * 1 * 1, L.inflow * 1 * 1, L.frags, L.planks] ) {
      if ( TD.whole(v) !== Math.round(v) || !Number.isInteger(TD.whole(v)) ) bad2++;
    }
    if ( L.wisps % 2 ) bad2++;                                   // (an even wisp count: the dust / grey halves are whole)
  }
  ok(!bad2, "the integer levels' steady counts are whole (= Math.round)");
  ok(TD.whole(80.0000001) === 80 && TD.whole(79.9999999) === 80 && TD.whole(79.6) === 79.6, "whole snaps float noise only");
  let bad3 = 0, prev = null;
  for ( let k = 0; k <= 4000; k++ ) {
    const v = k / 4000 * 40, sh = Array.from({ length: 41 }, (_, i) => TD.share(v, i));
    const sum = sh.reduce((a, b) => a + b, 0);
    if ( Math.abs(sum - v) > 1e-9 ) bad3++;
    if ( prev ) for ( let i = 0; i < 41; i++ ) if ( Math.abs(sh[i] - prev[i]) > 40 / 4000 + 1e-12 ) bad3++;
    prev = sh;
  }
  ok(!bad3, "shares sum to n and are continuous in n");
}

/* B */
{
  let bad = 0;
  for ( const s of [0, 1, 2] ) {
    const nF = Math.round(TM.lv(TM.TABLE.frags, s)), nP = Math.round(TM.lv(TM.TABLE.planks, s));
    for ( let i = 0; i < TD.FRAG_SLOTS; i++ ) for ( let k = 0; k < 64; k++ ) {
      const h = k === 63 ? (2 ** 32 - 1) / 2 ** 32 : k / 63;
      const want = i < nF ? TD.FRAG : i < nF + nP ? TD.PLANK : TD.NONE;
      if ( TD.fragKind(s, i, h) !== want ) bad++;
    }
  }
  ok(!bad, `fragKind at the integer levels = the old split (${bad} bad)`);
  ok(TD.FRAG_SLOTS === 50, "50 fragment slots (40 + 10)");
  let bad2 = 0;
  for ( let k = 0; k <= 200; k++ ) {
    const s = k / 100, H = 2000;
    let f = 0, p = 0;
    for ( let i = 0; i < TD.FRAG_SLOTS; i++ ) for ( let j = 0; j < H; j++ ) { const kind = TD.fragKind(s, i, (j + 0.5) / H); if ( kind === TD.FRAG ) f++; else if ( kind === TD.PLANK ) p++; }
    if ( Math.abs(f / H - TM.lv(TM.TABLE.frags, s)) > 1e-3 || Math.abs(p / H - TM.lv(TM.TABLE.planks, s)) > 1e-3 ) bad2++;
  }
  ok(!bad2, "between levels the expected fragment / plank counts follow the table");
  ok(TD.bigShare(0) === 0 && TD.bigShare(1) === 1 && TD.bigShare(2) === 1 && TD.BIG * TD.bigShare(1) === 0.16, "big share: none at level 1, exactly 0.16 at 2 and 3");
  let mono = true, step = 0;
  for ( let k = 1; k <= 1000; k++ ) { const a = TD.bigShare((k - 1) / 500), b = TD.bigShare(k / 500); if ( b < a ) mono = false; step = Math.max(step, b - a); }
  ok(mono && step < 0.01, `big share ramps smoothly (largest step per 0.002 of s: ${step.toFixed(4)})`);
}

/* C */
{
  const any = () => { const fn = function () {}; return new Proxy(fn, { get(t, k) { if ( k === Symbol.toPrimitive ) return () => 0; if ( k === "then" ) return undefined; if ( k === Symbol.iterator ) return function* () {}; if ( !(k in t) ) t[k] = any(); return t[k]; }, apply: () => any(), construct: () => any(), set(t, k, v) { t[k] = v; return true; } }); };
  globalThis.PIXI = any(); globalThis.WebGL2RenderingContext = any(); globalThis.Hooks ??= { on() {}, once() {}, callAll() {} };
  globalThis.CONFIG = { moinenMaps: { weatherQ: 1 } }; globalThis.game ??= any(); globalThis.foundry ??= any();
  globalThis.canvas = { primary: any(), app: { renderer: Object.assign(any(), { gl: { getExtension: () => ({}) } }), ticker: { add() {}, remove() {} } }, stage: null, scene: null };
  const { TornadoDisplay } = await import("../scripts/weather/tornado.mjs");
  const geo = { ox: 0, oy: 0, ap: 4, aw: 2000, ah: 2000, grid: 100 };
  const viewOf = (T) => {
    const d = new TornadoDisplay(); d.sync([T], geo, { view: { lift: 0.5, squash: 0.8 }, cap: 3 });
    const v = d.views.get(T.id); v.lift = 0.5; v.squash = 0.8;
    v.rec = []; for ( const L of [v.Lb, v.Lf, v.Lg] ) { const p = L.push; L.push = function (...a) { v.rec.push(a); return p.apply(this, a); }; }
    return v;
  };
  const frame = (v, now) => {
    const T = v.T, tm = (now / 1000) % 3600, ph = TM.phase(T, now, geo.grid), sCap = 2.35, L = TM.looksOf(Math.min(TM.levelS(T, now), sCap));
    const [bx, by] = v.baseArt(now);
    v.axisAt(now, tm, L, ph, [0.8, 0]);
    v.rec.length = 0;
    v.debris(now, tm, L, ph, { bx, by, Z: L.Z * v.U, sq: 0.8, lift: 0.5, trx: 0.3, try_: -0.2, throwAng: 1, touchSwell: 1, dust: [0.5, 0.45, 0.4], sCap });
    return v.rec.slice();
  };
  // the slot (i, birth) of a fragment / plank push, from the same closed form as the display
  const slotOf = (now) => {
    const tm = (now / 1000) % 3600, life = 8, out = new Map();
    for ( let i = 0; i < TD.FRAG_SLOTS; i++ ) {
      const u = (tm + hu(i, 2, 1701) * life) / life, cyc = Math.floor(u) % 450, tau = (u - Math.floor(u)) * life;
      out.set(`1:${(i * 131 + cyc * 7 + 3) % 99991}`, { i, birth: Math.round(now - tau * 1000), tau });
      out.set(`2:${i * 23 + cyc}`, { i, birth: Math.round(now - tau * 1000), tau });
    }
    return out;
  };
  const path = [[0, 0], [3000, 200], [3000, 2600], [400, 2400]];
  const scenarios = [
    { name: "1 -> 3", recs: [[0, { level: 3, lv0: 1, lvT: 20000 }]] },
    { name: "3 -> 1", recs: [[0, { level: 1, lv0: 3, lvT: 20000 }]] },
    { name: "1.4 -> 2.6", recs: [[0, { level: 2.6, lv0: 1.4, lvT: 20000 }]] },
    // a second change mid-ramp (the slider released again): the new ramp starts from the current continuous level (D6)
    { name: "1 -> 3, at 2.5 s back to 1", recs: [[0, { level: 3, lv0: 1, lvT: 20000 }], [22500, (T) => ({ level: 1, lv0: TM.levelS(T, 22500) + 1, lvT: 22500 })]] },
    { name: "3 -> 1, at 1 s up to 3", recs: [[0, { level: 1, lv0: 3, lvT: 20000 }], [21000, (T) => ({ level: 3, lv0: TM.levelS(T, 21000) + 1, lvT: 21000 })]] }
  ];
  for ( const sc of scenarios ) {
    const base = { id: `dz${sc.name.length}`, path, t0: 0, size: 1, end: "loop", speed: 0.6, seed: 77 };
    let T = TM.cleanTornado({ ...base, ...sc.recs[0][1] });
    const v = viewOf(T);
    const seen = new Map();                  // "i@birth" -> { kind, hx, frames: [...] }
    let ri = 1, bad = 0, total = 0;
    for ( let now = 12000; now <= 45000; now += 40 ) {
      if ( ri < sc.recs.length && now >= sc.recs[ri][0] ) { const r = sc.recs[ri][1](T); T = TM.cleanTornado({ ...T, ...r }); v.setRecord(T); ri++; }
      const slots = slotOf(now), rec = frame(v, now), here = new Set();
      for ( const a of rec ) {
        const kind = a[5]; if ( kind !== 1 && kind !== 2 ) continue;
        const sl = slots.get(`${kind}:${a[6]}`); if ( !sl ) { bad++; continue; }
        const key = `${sl.i}@${sl.birth}`;
        if ( here.has(key) ) continue;       // (drawn in both lists while it crosses the funnel's side)
        here.add(key); total++;
        const e = seen.get(key);
        if ( !e ) seen.set(key, { kind, hx: a[2], last: now, tau: sl.tau });
        else {
          if ( e.kind !== kind ) { bad++; if ( bad < 5 ) console.log(`  ${sc.name}: slot ${key} changed kind at ${now}`); }
          if ( kind === 1 && Math.abs(e.hx - a[2]) > 1e-9 ) { bad++; if ( bad < 5 ) console.log(`  ${sc.name}: slot ${key} changed size at ${now}`); }
          if ( now - e.last > 40 ) { bad++; if ( bad < 5 ) console.log(`  ${sc.name}: slot ${key} vanished mid-life ${e.last} -> ${now}`); }
          e.last = now;
        }
      }
    }
    // a slot drawn once, then not while it still lives (tau < its life and not yet dissolved), counts as vanished: checked above by
    // gaps; a slot must also not stop early - its last frame is where it dissolves (landed) or where the test ends
    ok(!bad && total > 500, `${sc.name}: fragments and planks keep kind and size, none vanish mid-life (${seen.size} lives, ${total} draws, ${bad} bad)`);
  }
  // the fast path: at a settled level, today's slots only == every slot
  let bad = 0, frames = 0;
  for ( const level of [1, 1.5, 2, 2.5, 3] ) {
    const T = TM.cleanTornado({ id: `fp${level * 10}`, path, t0: 0, level, lv0: level, lvT: 0, size: 1, seed: 9 });
    const a = viewOf(T), b = viewOf({ ...T, lvT: 1e15 });       // (b: a "ramp" in the future, levelS still the level: the full path)
    for ( let now = 20000; now <= 60000; now += 97 ) {
      if ( TM.levelS(b.T, now) !== TM.levelS(T, now) ) bad++;
      const x = frame(a, now).map(String).join("|"), y = frame(b, now).map(String).join("|");
      if ( x !== y ) bad++;
      frames++;
    }
  }
  ok(!bad, `settled fast path draws exactly what the full path draws (${frames} frames, ${bad} bad)`);
}

console.log(`${n - fails}/${n} tornado-debris checks passed`);
process.exit(fails ? 1 : 0);
