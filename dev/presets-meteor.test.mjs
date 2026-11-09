// The meteor preset, the pure parts:   node dev/presets-meteor.test.mjs
//   A. the definition: cleans without errors, its ejecta place kept; other built-ins carry no ejecta (unchanged)
//   B. the ejecta (core ejectaOf): deterministic per seed, n in range, landings in order at whole DT_STEP gaps, the later the farther,
//      none in the wedge back up the way it came, inside the scene; a click picks a seeded way, a drag keeps the drag's way
//   C. the plan: one meteor accent (at = -preroll, its span covers the trail, its rocks = the ejecta), one shock haze ~5 min, the hits
//      dust at the landings surviving the fire layer's cleaning, the ejecta pocks timed on the landings, crater at T0
//   D. the way (meteor-core): headAt starts high and far back and ends on the impact, monotone; madeAt inverts it; bodies stay under
//      MAX_BODIES, are deterministic, nothing after the rocks land; rectOf holds the way, the ring and every landing; rumble ends at T0
//   E. the wiring: presets.mjs registers it; meteor-art loads only for a record with a meteor accent
import * as C from "../scripts/presets/core.mjs";
import * as M from "../scripts/presets/meteor-core.mjs";
import { BUILTIN } from "../scripts/presets/defs.mjs";
import * as FM from "../scripts/fire/model.mjs";
import { readFileSync } from "node:fs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const RECT = { x: 0, y: 0, width: 4000, height: 4000 };
const ENV = { grid: 100, rect: RECT, now: 1_800_000_000_000, wind: { dir: 45, speed: 0.4 } };
const DEF = BUILTIN.find((d) => d.id === "meteor");
const fire = (seed = 7, g = { a: [2000, 2000] }, opts = {}) => C.expand(DEF, g, { seed, ...opts }, ENV);

/* A */
{
  const v = C.cleanDef(DEF);
  ok(v.ok && v.errors.length === 0, `meteor cleans (${v.errors})`);
  ok(v.def.ejecta && v.def.ejecta.n[0] === 13 && v.def.ejecta.gap === 70, "ejecta kept");
  ok(v.def.gesture === "point" && v.def.preroll === 2600, "a click, 2.6 s pre-roll");
  for ( const d of BUILTIN.filter((b) => b.id !== "meteor") ) ok(!C.cleanDef(d).def.ejecta, `${d.id}: no ejecta`);
  const bad = C.cleanDef({ ...DEF, ejecta: undefined });
  ok(!bad.ok, "an ejecta place without ejecta is refused");
}

/* B */
for ( const seed of [1, 7, 99, 1234] ) for ( const size of [0.5, 1, 2] ) {
  const dir = [0.6, 0.8], E = C.cleanDef(DEF).def.ejecta;
  const a = C.ejectaOf(E, [2000, 2000], dir, { seed, grid: 100, size }), b = C.ejectaOf(E, [2000, 2000], dir, { seed, grid: 100, size });
  ok(JSON.stringify(a) === JSON.stringify(b), `${seed}/${size}: deterministic`);
  ok(a.pts.length >= E.n[0] && a.pts.length <= E.n[1], `${seed}/${size}: n ${a.pts.length}`);
  ok(Math.abs(a.dt / C.DT_STEP - Math.round(a.dt / C.DT_STEP)) < 1e-9, `${seed}/${size}: dt whole DT_STEP`);
  ok(a.pts.every((p, i) => i === 0 || p.t > a.pts[i - 1].t), `${seed}/${size}: in landing order`);
  ok(a.pts[0].t === E.t[0] && a.pts.at(-1).t <= E.t[1] + a.dt, `${seed}/${size}: landings span t`);
  const dist = a.pts.map((p) => Math.hypot(p.x - 2000, p.y - 2000) / (100 * size));
  ok(dist.every((d) => d >= E.d[0] * 0.87 && d <= E.d[1] * 1.13), `${seed}/${size}: distances in range`);
  const h = Math.floor(dist.length / 2), mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  ok(mean(dist.slice(h)) > mean(dist.slice(0, h)), `${seed}/${size}: later lands farther`);
  const back = Math.PI - (E.gap / 360) * Math.PI;   // (half the wedge kept free, round the way back)
  ok(a.pts.every((p) => {
    const ang = Math.atan2(p.y - 2000, p.x - 2000) - Math.atan2(dir[1], dir[0]);
    return Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang))) <= Math.PI - (E.gap / 360) * Math.PI + 1e-6;
  }), `${seed}/${size}: none in the wedge back up the way (${back.toFixed(2)})`);
}

/* C */
for ( const seed of [1, 7, 99] ) for ( const power of [-1, 0, 1] ) {
  const P = fire(seed, { a: [2000, 2000] }, { power });
  ok(Math.abs(Math.hypot(...P.dir) - 1) < 2e-3, `${seed}: a unit way`);
  const P2 = fire(seed, { a: [2000, 2000] }, { power });
  ok(JSON.stringify(P2.dir) === JSON.stringify(P.dir) && JSON.stringify(P2.ejecta) === JSON.stringify(P.ejecta), `${seed}: same seed, same way and ejecta`);
  const acc = P.pending.accent.filter((a) => a.kind === "meteor");
  ok(acc.length === 1, `${seed}: one meteor accent`);
  const m = acc[0];
  ok(m.at === -2600 && m.at + m.dur >= 16000, `${seed}: accent from -2.6 s, covers the trail`);
  ok(m.x === 2000 && m.y === 2000 && m.g === 100 && m.rocks.length === P.ejecta.pts.length, `${seed}: accent at the impact, rocks = ejecta`);
  ok(P.ejecta.pts.every((p) => p[0] >= 0 && p[1] >= 0 && p[0] <= 4000 && p[1] <= 4000), `${seed}: landings in the scene`);
  const dust = P.fire.filter((f) => f.k === "dust");
  const shock = dust.filter((d) => d.dk === "shock"), hits = dust.filter((d) => d.dk === "hits");
  ok(shock.length === 1 && (shock[0].o - shock[0].q) >= 290000, `${seed}: one shock haze ~5 min`);
  ok(hits.length >= 1, `${seed}: landing dust`);
  for ( const s of hits ) {
    const { key, ...raw } = s, c = FM.cleanStroke({ ...raw, id: "ftest" });
    ok(c && c.k === "dust" && c.dk === "hits" && c.q === s.q && c.o === s.o, `${seed}: hits dust survives cleaning`);
  }
  ok(P.destruction.length === 2, `${seed}: crater + ejecta pocks`);
  ok(P.fire.some((f) => f.k === "smoke"), `${seed}: a smoke column`);
}
{
  const P = fire(7, { a: [2000, 2000], b: [2600, 2000] });
  ok(P.dir[0] > 0.99, "a drag keeps the drag's way");
  const Pe = fire(7, { a: [3950, 3950] });
  ok(Pe.ejecta.pts.every((p) => p[0] <= 4000 && p[1] <= 4000), "near the edge: landings filtered to the scene");
}

/* D */
{
  const it = fire(7).pending.accent.find((a) => a.kind === "meteor"), W = M.wayOf(it, 100);
  const h0 = M.headAt(W, it.at), h1 = M.headAt(W, 0);
  ok(Math.abs(h0.z - M.SKY_UP * 100) < 1e-6 && Math.hypot(h0.gx - 2000, h0.gy - 2000) > M.SKY_BACK * 100 - 1, "starts high and far back");
  ok(h1.z === 0 && Math.abs(h1.gx - 2000) < 1e-9 && Math.abs(h1.gy - 2000) < 1e-9, "ends on the impact");
  let mono = true, prev = -1;
  for ( let t = it.at; t <= 0; t += 50 ) { const s = M.headAt(W, t).s; if ( s < prev ) mono = false; prev = s; }
  ok(mono, "the head never goes back");
  ok([0.1, 0.5, 0.9].every((s) => Math.abs(M.headAt(W, M.madeAt(W, s)).s - s) < 1e-9), "madeAt inverts headAt");
  const out = new Float32Array(M.MAX_BODIES * 8), out2 = new Float32Array(M.MAX_BODIES * 8);
  let max = 0, same = true;
  for ( let t = -1600; t < 2000; t += 40 ) {
    const k = M.bodies(it, t, { grid: 100, lift: 0.5 }, 7, out), k2 = M.bodies(it, t, { grid: 100, lift: 0.5 }, 7, out2);
    max = Math.max(max, k); if ( k !== k2 || Buffer.compare(Buffer.from(out.buffer), Buffer.from(out2.buffer)) ) same = false;
  }
  ok(max > 10 && max <= M.MAX_BODIES, `bodies within MAX_BODIES (${max})`);
  ok(same, "bodies deterministic");
  const last = Math.max(...it.rocks.map((r) => r[2]));
  ok(M.bodies(it, last + 10, { grid: 100, lift: 0.5 }, 7, out) === 0, "nothing flying after the last landing");
  for ( const lift of [0, 0.5, 1] ) {
    const R = M.rectOf(it, 100, lift), inR = (x, y) => x >= R.x0 && x <= R.x1 && y >= R.y0 && y <= R.y1;
    ok([0, 0.3, 0.7, 1].every((s) => inR(...M.screenOf(W, s, lift))), `rect holds the way (lift ${lift})`);
    ok(it.rocks.every((r) => inR(r[0], r[1])) && inR(2000 + M.RING_MAX * 100, 2000), `rect holds the ring and landings (lift ${lift})`);
  }
  ok(M.rumbleAt(-2000) === 0 && M.rumbleAt(-1) > 0 && M.rumbleAt(0) === 0, "rumble only in its window before T0");
  ok(M.endOf(it) === it.at + it.dur, "endOf");
}

/* E */
{
  const pre = readFileSync(new URL("../scripts/presets/presets.mjs", import.meta.url), "utf8");
  ok(/import \{ registerMeteor \} from "\.\/meteor-wire\.mjs"/.test(pre) && /\nregisterMeteor\(\);/.test(pre), "presets.mjs registers the meteor");
  const w = readFileSync(new URL("../scripts/presets/meteor-wire.mjs", import.meta.url), "utf8");
  ok(!/^import .*meteor-art/m.test(w) && /import\("\.\/meteor-art\.mjs"\)/.test(w), "meteor-art loaded lazily");
  ok(/if \( !hasMeteor\(data\?\.rec\) \) return;/.test(w), "only for a record with a meteor accent");
  const art = readFileSync(new URL("../scripts/presets/meteor-art.mjs", import.meta.url), "utf8");
  ok(/guardQ\("meteor"\)/.test(art) && /noShake/.test(art), "art: frame guard + shake opt-out");
}

console.log(`${n - fails}/${n} ok`);
if ( fails ) process.exit(1);
