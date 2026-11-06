// Fire and smoke, the pure part (scripts/fire/model.mjs):   node dev/fire-model.test.mjs
//   A. strokes: cleaning, the flag round trip (JSON), order, junk dropped, thinning
//   B. areas: overlapping reaches merge, far strokes stay apart, an eraser joins the area it touches and puts its fire out, keys are stable
//      and change with a stroke or a setting
//   C. the field: deterministic bytes, tongues above the fire (not below), smoke drifts downwind
//   D. particles: a pure function of the shared clock (same inputs -> same output; frame rate independent; on the art grid), capped
//   E. lights: merged into few clusters, capped, deterministic; flicker deterministic, stepped, in range
//   F. culling: in / out of view
import * as M from "../scripts/fire/model.mjs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const geo = { ap: 3, ox: 100, oy: 100, grid: 96 };
const P = M.cleanParams();
const st = (id, k, x, y, r = 60, extra = {}) => M.cleanStroke({ id, k, s: 0.9, r, p: [x, y, x + 40, y + 10], wd: 0, ws: 0, q: 1, ...extra });

/* A */
ok(M.cleanStroke({ id: "a", k: "lava", p: [1, 2] }) === null, "unknown kind dropped");
ok(M.cleanStroke({ id: "a b", k: "fire", p: [1, 2] }) === null, "bad id dropped");
ok(M.cleanStroke({ id: "a", k: "fire", p: [] }) === null, "no points dropped");
const s1 = M.cleanStroke({ id: "a1", k: "fire", s: 5, r: 1, p: [1.4, 2.6, "x", 3], wd: -90, ws: 2, q: 7 });
ok(s1.s === 1 && s1.r === 4 && s1.wd === 270 && s1.ws === 1 && s1.p.length === 2 && s1.p[0] === 1 && s1.p[1] === 3, "clamped + rounded");
const flag = { b: st("b", "smoke", 500, 500, 60, { q: 5 }), a: st("a", "fire", 200, 200, 60, { q: 5 }), c: st("c", "fire", 300, 300, 60, { q: 1 }) };
const back = M.strokesOf(JSON.parse(JSON.stringify(flag)));
ok(back.map((s) => s.id).join() === "c,a,b", "order by q then id");
ok(JSON.stringify(M.strokesOf(JSON.parse(JSON.stringify(Object.fromEntries(back.map((s) => [s.id, s])))))) === JSON.stringify(back), "flag round trip");
ok(JSON.stringify(back[0]).length < 160, `a stroke is compact (${JSON.stringify(back[0]).length} bytes)`);
const thin = M.thinPath([[0, 0], [1, 0], [2, 0], [10, 0], [11, 0], [30, 0]], 8);
ok(thin.join() === "0,0,10,0,30,0", `thin path ${thin}`);
const pp = M.cleanParams({ who: "x", smoke: 9, lightColor: "red", junk: 1 });
ok(pp.who === "all" && pp.smoke === 1 && pp.lightColor === P.lightColor && !("junk" in pp), "params cleaned");

/* B */
const near = [st("n1", "fire", 300, 300), st("n2", "fire", 340, 320, 60, { q: 2 })], far = st("f1", "fire", 3000, 3000, 60, { q: 3 });
let A = M.areasOf([...near, far], geo, P);
ok(A.length === 2, `two areas (${A.length})`);
ok(A.find((a) => a.strokes.some((s) => s.id === "n1")).strokes.length === 2, "near strokes share an area");
const A2 = M.areasOf([...near, far], geo, P);
ok(JSON.stringify(A.map((a) => a.key)) === JSON.stringify(A2.map((a) => a.key)), "keys stable");
const A3 = M.areasOf([...near, { ...far, s: 0.5 }], geo, P);
ok(A3.find((a) => a.id === "f1").key !== A.find((a) => a.id === "f1").key && A3.find((a) => a.id === "n1").key === A.find((a) => a.id === "n1").key, "only the changed area's key changes");
ok(M.areasOf([...near, far], geo, { ...P, flame: 2 })[0].key !== A[0].key, "a setting changes the key");
const er = M.cleanStroke({ id: "e1", k: "erase", s: 1, r: 400, p: [320, 310], q: 9 });
A = M.areasOf([...near, far, er], geo, P);
ok(A.length === 2 && A.find((a) => a.id === "n1").strokes.some((s) => s.k === "erase") && !A.find((a) => a.id === "f1").strokes.some((s) => s.k === "erase"), "eraser joins only the area it touches");
ok(M.raster(A.find((a) => a.id === "n1"), geo, P).mass === 0, "erased fire has no burning ground");
const erEarly = M.cleanStroke({ ...er, q: 0 });
ok(M.raster(M.areasOf([...near, erEarly], geo, P)[0], geo, P).mass > 0, "an eraser older than the fire does not put it out");
ok(M.areasOf([er], geo, P).length === 0, "an eraser alone makes no area");

/* C */
const PS = { ...P, smoke: 0.6 };
const one = M.areasOf([st("c1", "fire", 400, 400, 60)], geo, PS)[0];
const fa = M.raster(one, geo, PS), fb = M.raster(one, geo, PS);
ok(Buffer.from(fa.data).equals(Buffer.from(fb.data)), "field bytes deterministic");
const at = (f, x, y, c) => f.data[(y * f.w + x) * 4 + c];
const cx = Math.round((420 - geo.ox) / geo.ap - one.rect.x0), cy = Math.round((405 - geo.oy) / geo.ap - one.rect.y0), R = Math.round(60 / geo.ap);
ok(at(fa, cx, cy, 2) > 150, "burning ground at the stroke");
ok(at(fa, cx, cy - R - 4, 0) > 0 && at(fa, cx, Math.min(fa.h - 1, cy + R + 4), 0) === 0, "tongues above the fire, none below");
ok(at(fa, cx, Math.max(0, cy - R - 30), 1) > 0, "smoke above the fire");
const windy = M.areasOf([M.cleanStroke({ id: "w1", k: "smoke", s: 1, r: 40, p: [600, 600], wd: 0, ws: 1, q: 1 })], geo, P)[0], fw = M.raster(windy, geo, P);
const sx = (600 - geo.ox) / geo.ap - windy.rect.x0;
let lx = 0, rx = 0;
for ( let y = 0; y < fw.h; y++ ) for ( let x = 0; x < fw.w; x++ ) { const g = at(fw, x, y, 1); if ( x < sx - 20 ) lx += g; if ( x > sx + 20 ) rx += g; }
ok(rx > lx * 5 && rx > 0, `smoke drifts downwind (right ${rx} vs left ${lx})`);
const tall = M.raster(M.areasOf([st("t1", "fire", 400, 400, 60)], geo, { ...P, flame: 2 })[0], geo, { ...P, flame: 2 });
const rows = (f) => { let c = 0; for ( let y = 0; y < f.h; y++ ) { let any = false; for ( let x = 0; x < f.w; x++ ) if ( at(f, x, y, 0) ) any = true; if ( any ) c++; } return c; };
ok(rows(tall) > rows(M.raster(M.areasOf([st("t1", "fire", 400, 400, 60)], geo, P)[0], geo, P)), "flame height setting makes taller tongues");

/* D */
const seed = one.seed, now = 1.7e12 + 12345;
ok(JSON.stringify(M.particleAt(fa, seed, 3, now)) === JSON.stringify(M.particleAt(fa, seed, 3, now)), "particle deterministic");
let alive = 0, moved = 0, grid = true;
for ( let k = 0; k < 40; k++ ) {
  const a = M.particleAt(fa, seed, k, now), b = M.particleAt(fa, seed, k, now + 200);
  if ( a ) { alive++; if ( !Number.isInteger(a.x) || !Number.isInteger(a.y) ) grid = false; }
  if ( a && b && (a.y !== b.y || a.x !== b.x) ) moved++;
}
ok(alive > 5 && moved > 3 && grid, `particles alive ${alive}, moving ${moved}, on the grid ${grid}`);
const seqA = [], seqB = [];
for ( let t = 0; t <= 2000; t += 16 ) seqA.push(M.particleAt(fa, seed, 5, now + t));
for ( let t = 0; t <= 2000; t += 50 ) seqB.push(M.particleAt(fa, seed, 5, now + t));
ok(JSON.stringify(M.particleAt(fa, seed, 5, now + 2000)) === JSON.stringify(seqB[seqB.length - 1]) && seqA.length !== seqB.length, "the same particle at 60 and 20 fps (no state)");
const sh = M.shareSlots([fa, null, fw], 24);
ok(sh[1] === 0 && sh[0] >= 2 && sh[2] >= 2, `slots shared ${sh}`);
ok(M.shareSlots([fa], 0)[0] === 0, "cap 0 (low / reduced motion): no particles");

/* E */
const many = []; for ( let i = 0; i < 60; i++ ) many.push(st(`m${i}`, "fire", 200 + (i % 10) * 400, 200 + Math.floor(i / 10) * 400, 50, { q: i }));
const MA = M.areasOf(many, geo, P), items = MA.map((a) => ({ area: a, field: M.raster(a, geo, P) }));
const L1 = M.lightsOf(items, geo, P), L2 = M.lightsOf(items, geo, P);
ok(L1.length <= 24 && L1.length >= 4, `lights capped and merged (${L1.length} for ${MA.length} areas)`);
ok(JSON.stringify(L1) === JSON.stringify(L2), "lights deterministic");
ok(L1.every((l) => l.radius > 0 && l.strength > 0 && l.strength <= 1), "light radius / strength sane");
ok(M.lightsOf([{ area: one, field: fa }], geo, P).length === 1, "one small fire -> one light");
ok(M.lightsOf([{ area: one, field: fa }], geo, { ...P, lightRadius: 3 })[0].radius > M.lightsOf([{ area: one, field: fa }], geo, P)[0].radius, "light radius setting");
let fmin = 2, fmax = -1; for ( let t = 0; t < 5000; t += 37 ) { const f = M.flickerAt(now + t, 99, 1); fmin = Math.min(fmin, f); fmax = Math.max(fmax, f); }
ok(fmin >= 0.55 - 1e-9 && fmax <= 1 && fmax - fmin > 0.1, `flicker range ${fmin.toFixed(2)}..${fmax.toFixed(2)}`);
ok(M.flickerAt(now, 99, 0) === 1 && M.flickerAt(now, 99, 0.5) === M.flickerAt(now, 99, 0.5), "flicker 0 steady, deterministic");
const step = Math.floor(now / 83.333) * 83.333;
ok(M.flickerAt(step + 1, 7, 1) === M.flickerAt(step + 80, 7, 1), "flicker stepped at 12 Hz");

/* F */
ok(M.inView(one.rect, geo, { x0: 0, y0: 0, x1: 1000, y1: 1000 }), "in view");
ok(!M.inView(one.rect, geo, { x0: 5000, y0: 5000, x1: 6000, y1: 6000 }), "off screen culled");
ok(M.inView(one.rect, geo, { x0: geo.ox + one.rect.x1 * geo.ap + 50, y0: 0, x1: 9000, y1: 9000 }, 60), "margin keeps an area just outside");
ok(M.shaderTime(1000) === M.shaderTime(1050), "shader time stepped (12 fps)");

console.log(`${fails ? "FAIL" : "ok"} fire model: ${n - fails}/${n} checks`);
process.exit(fails ? 1 : 0);
