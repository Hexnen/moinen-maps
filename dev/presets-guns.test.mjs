// The gun presets (uzi, heliHmg), the pure parts:   node dev/presets-guns.test.mjs
//   A. the walk: the shot interval in whole DT_STEP ms, every hit on its lane's beat (i + phase) x dt, the run as long as its shots
//   B. the dust: one fire-layer dust stroke "hits" per lane and unbroken run, s = dt / HIT_DT exact, q at its first hit, the points
//      in shot order, o after the run; it survives the fire layer's cleaning (fire/model.mjs) unchanged
//   C. the dust field: each hit kicks its cells and its emitters exactly at q + k x dt (fire/dust-model.mjs hitsOf), deterministic
//   D. the accents: tracers on BOTH guns of the heli, the muzzle only with a shooter, the burst starting out from the shooter,
//      accents-core draw deterministic, nothing before an item's span, its frame empty after it
//   E. the wiring: gun strokes skip the area-wide blast look (ring, skirt, shock, rolling path flashes), their chunks and night rims
//      follow the walk (cause-fx.mjs isGun; display.mjs pathEffects / throwRest)
import * as C from "../scripts/presets/core.mjs";
import { BUILTIN } from "../scripts/presets/defs.mjs";
import * as FM from "../scripts/fire/model.mjs";
import * as D from "../scripts/fire/dust-model.mjs";
import * as A from "../scripts/presets/accents-core.mjs";
import { readFileSync } from "node:fs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const RECT = { x: 0, y: 0, width: 3000, height: 2000 };
const ENV = { grid: 100, rect: RECT, now: 1_800_000_000_000, wind: { dir: 45, speed: 0.4 } };
const get = (id) => BUILTIN.find((d) => d.id === id);
const G = { line: { a: [1000, 900], b: [1800, 1100] }, run: { a: [600, 1000], b: [2400, 1000] } };
const fire = (id, seed = 7, g = G[get(id).gesture]) => C.expand(get(id), g, { seed }, ENV);

/* A + B */
for ( const id of ["uzi", "heliHmg"] ) for ( const seed of [1, 7, 99] ) {
  const P = fire(id, seed), W = P.walk, def = get(id);
  ok(W && W.dt > 0 && Math.abs(W.dt / C.DT_STEP - Math.round(W.dt / C.DT_STEP)) < 1e-9, `${id}/${seed}: dt whole DT_STEP (${W?.dt})`);
  const ph = def.walk.phase ?? [0];
  const beat = W.hits.every((h) => {
    const lane = h[3], i = Math.round(h[2] / W.dt - (ph[lane] ?? 0));
    return Math.abs(h[2] - Math.round((i + (ph[lane] ?? 0)) * W.dt)) <= 0.5;
  });
  ok(beat, `${id}/${seed}: every hit on its lane's beat`);
  const nPer = Math.max(...[...new Set(W.hits.map((h) => h[3]))].map((l) => W.hits.filter((h) => h[3] === l).length));
  ok(W.dur === Math.round(nPer * W.dt) || W.hits.length <= 1, `${id}/${seed}: the run as long as its shots (${W.dur} vs ${nPer} x ${W.dt})`);
  const dust = P.fire.filter((f) => f.k === "dust" && f.dk === "hits");
  ok(dust.length >= 1, `${id}/${seed}: hits dust written`);
  ok(dust.every((f) => Math.abs(f.s * C.HIT_DT - W.dt) < 0.5 * C.HIT_DT * 0.01 + 1e-6), `${id}/${seed}: s = dt / HIT_DT`);
  ok(dust.every((f) => f.p.length >= 2 && f.p.length % 2 === 0 && f.o > f.q), `${id}/${seed}: points and life`);
  const lanes = new Set(W.hits.map((h) => h[3]));
  ok(new Set(dust.map((f) => f.key.split("~")[0])).size === lanes.size, `${id}/${seed}: one dust track per lane`);
  // q: the first hit of its run
  const t0 = P.t0 ?? ENV.now, qs = dust.map((f) => f.q).sort((a, b) => a - b);
  ok(qs[0] >= t0 - 1, `${id}/${seed}: dust not before the burst`);
  for ( const f of dust ) {
    const { key, ...raw } = f, c = FM.cleanStroke({ ...raw, id: "ftest" });
    ok(c && c.k === "dust" && c.dk === "hits" && c.s === f.s && c.q === f.q && c.o === f.o && JSON.stringify(c.p) === JSON.stringify(f.p), `${id}/${seed}: dust stroke survives cleaning`);
  }
}

/* C */
{
  const geo = { ap: 3, ox: 0, oy: 0, grid: 96 }, Pp = FM.cleanParams();
  const pts = [300, 300, 360, 310, 420, 290, 480, 305];
  const st = FM.cleanStroke({ id: "h1", k: "dust", dk: "hits", lv: 3, r: 24, s: 0.4, p: pts, q: 1000, o: 9000, wd: 0, ws: 0 });
  const area = FM.areasOf([st], geo, Pp, 1200).find((a) => a.style === "dust");
  const f1 = FM.raster(area, geo, Pp), f2 = FM.raster(area, geo, Pp);
  ok(Buffer.compare(Buffer.from(f1.cell.buffer), Buffer.from(f2.cell.buffer)) === 0 && Buffer.compare(Buffer.from(f1.em.buffer), Buffer.from(f2.em.buffer)) === 0, "hits field deterministic");
  const cellAt = (x, y) => { const cx = Math.floor((x - geo.ox) / geo.ap) - area.rect.x0, cy = Math.floor((y - geo.oy) / geo.ap) - area.rect.y0; return (cy * f1.w + cx) * 4; };
  const dt = D.hitDt(st) / 1000;
  const kicks = [0, 1, 2, 3].map((k) => f1.cell[cellAt(pts[k * 2], pts[k * 2 + 1])]);
  ok(kicks.every((v, k) => Math.abs(v - kicks[0] - k * dt) < 1e-4), `cells kick on the beat (${kicks.map((v) => v.toFixed(3))})`);
  const L = D.look(st), em = [];
  for ( let i = 0; i < f1.emN; i++ ) { const o = ((i >> 10) * f1.emW + (i & 1023) * 3) * 4; em.push(f1.em[o + 2]); }
  ok(f1.emN === 4 * L.per, `emitters per hit (${f1.emN} = 4 x ${L.per})`);
  const first = [...new Set(em.map((t) => Math.round((t - kicks[0]) / dt)))].sort();
  ok(JSON.stringify(first) === "[0,1,2,3]" && em.every((t) => { const k = Math.round((t - kicks[0]) / dt); return t - kicks[0] - k * dt > -1e-4 && t - kicks[0] - k * dt < 0.05; }), "emitters kick at their hit (+ < 50 ms)");
  ok(D.passMs(st, geo) === Math.round(3 * D.hitDt(st)) || Math.abs(D.passMs(st, geo) - 3 * D.hitDt(st)) < 1, "pass = (hits - 1) x dt");
  const T = D.kindTable(), code = L.code;
  ok(T.length === 6 && T[4][code * 4 + 2] === 1 && T[4][D.look({ dk: "car", lv: 3 }).code * 4 + 2] === 0, "kind table flags hits only");
}

/* D */
{
  const P = fire("heliHmg", 7), tr = P.pending.accent.find((a) => a.kind === "tracer");
  ok(tr && new Set(tr.hits.map((h) => h[3])).size === 2, "heli tracers on both guns");
  const U = fire("uzi", 7, G.line), Uf = fire("uzi", 7, { ...G.line, from: G.line.a });
  ok(!U.pending.accent.find((a) => a.kind === "muzzle")?.hits?.length, "no muzzle flashes without a shooter");
  ok(Uf.pending.accent.find((a) => a.kind === "muzzle")?.hits?.length > 0, "muzzle flashes with a shooter");
  const d0 = Math.hypot(Uf.walk.hits[0][0] - G.line.a[0], Uf.walk.hits[0][1] - G.line.a[1]);
  ok(d0 > ENV.grid * 0.6, `a shooter's burst starts out from them (${d0.toFixed(0)} px)`);
  const env = { ap: 3, ox: 0, oy: 0, grid: 100, lift: 0.5, squash: 0.8, q: 1, seed: 7 };
  const items = P.pending.accent, sp = items.map(A.spanOf).filter(Boolean), lo = Math.min(...sp.map((s) => s[0])), hi = Math.max(...sp.map((s) => s[1]));
  const at = (t) => { const F = A.draw(items, 0, t, env, A.newFrame()); return JSON.stringify([F.px, F.glows, F.kicks]); };
  const mid = (lo + hi) / 2;
  ok(at(mid) === at(mid), "accents deterministic");
  ok(at(mid).length > 40, "accents draw mid-burst");
  const before = A.draw(items, 0, lo - 1, env, A.newFrame());
  ok(before.px.every((l) => !l.length) && before.live, "nothing before the span, still live");
  const after = A.draw(items, 0, hi + 1, env, A.newFrame());
  ok(after.px.every((l) => !l.length) && !after.glows.length && !after.live, "empty after the span");
}

/* E */
{
  const cf = readFileSync(new URL("../scripts/destruction/cause-fx.mjs", import.meta.url), "utf8");
  const dp = readFileSync(new URL("../scripts/destruction/display.mjs", import.meta.url), "utf8");
  ok(/export const isGun = /.test(cf), "isGun exported");
  ok(/if \( !gun \) draw\("shock"/.test(cf) && /if \( !gun \) once\("skirt"/.test(cf) && /cl\.ring && !a\.tear && !isGun/.test(cf), "guns skip shock, skirt and ring");
  ok(/g\.glowIn = isGun\(d, g, a\)/.test(cf), "gun night rims after the walk");
  ok(/pathEffects\([^)]*\) \{[\s\S]{0,200}Cause\.isGun\(this, g, a\)/.test(dp), "guns skip the rolling path effects");
  ok(/throwRest\([^;]*Cause\.isGun\(this, g, g\.anim\) \? g\.anim\.reach/.test(dp), "gun chunks thrown as the walk reaches them");
}

console.log(fails ? `${fails}/${n} FAILED` : `ok presets-guns: ${n}/${n} checks`);
process.exit(fails ? 1 : 0);
