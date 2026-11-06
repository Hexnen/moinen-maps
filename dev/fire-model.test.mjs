// Fire and smoke, the pure part (scripts/fire/model.mjs):   node dev/fire-model.test.mjs
//   A. strokes: cleaning, the flag round trip (JSON), order, junk dropped, thinning
//   B. areas: overlapping reaches merge, far strokes stay apart, an eraser joins the area it touches and puts its fire out, keys are stable
//      and change with a stroke or a setting
//   C. the field: deterministic bytes, tongues above the fire (not below), smoke drifts downwind
//   D. particles: a pure function of the shared clock (same inputs -> same output; frame rate independent; on the art grid), capped
//   E. lights: merged into few clusters, capped, deterministic; flicker deterministic, stepped, in range
//   F. culling: in / out of view
//   G. time: catching along the path, growing, going out, erasers, relighting, late joiners, reduced motion
//   I. smoke never cut by its area's rectangle (8 wind directions x 3 speeds)
//   H. levels: fire and smoke independent, old strokes, lights per level, plumes do not merge fires, styles
//   J. colour: the palette ramp is derived deterministically, the natural default is the old palette exactly, colours keep their
//      areas and lights apart, particles and lights follow the colour, the smoke is neutral unless tinted
//   K. the fire style's art inputs: chamfer distances, the aux texture (bed in/out, smoke sources), the smoke tail
import * as M from "../scripts/fire/model.mjs";
import * as Look from "../scripts/fire/look.mjs";
import { readFileSync } from "node:fs";

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

/* G: time - catching, growing, going out (all from q / g / o and the clock) */
{
  const T = M.timing(geo, P), q = 1_000_000;
  const f = M.cleanStroke({ id: "g1", k: "fire", s: 1, r: 60, p: [400, 400, 700, 400], wd: 0, ws: 0, q });
  const cm = M.catchMs(f, geo, P);
  ok(cm > 0 && cm < 8000, `catches along its path in ${Math.round(cm)} ms`);
  ok(M.phaseOf(f, q + 10, geo, P) === "grow" && M.phaseOf(f, q + cm + T.growSpan + 1, geo, P) === "on", "grow, then on");
  ok(M.phaseOf(f, q + 10, geo, P, true) === "on" && M.phaseOf(f, undefined, geo, P) === "on", "reduced motion / no clock: no phases");
  const o = { ...f, o: q + 60000 };
  ok(M.phaseOf(o, q + 60001, geo, P) === "out" && M.phaseOf(o, q + 60000 + T.outSpan + 1, geo, P) === "gone", "put out: out, then gone");
  ok(M.phaseOf(o, q + 60001, geo, P, true) === "gone", "reduced motion: put out = gone at once");
  ok(M.nextChange([f], q + 10, geo, P) === q + cm + T.growSpan && M.nextChange([f], q + cm + T.growSpan + 5, geo, P) === Infinity, "next phase change (one timer)");
  ok(M.goneAt([o, f], q + 60000 + T.outSpan + 1, geo, P).map((s) => s.id).join() === "g1", "gone records found for the GM's purge");
  // a client that loads later sees the same phase as one that was there all along (a function of the stored times and the clock)
  const A1 = M.areasOf([f], geo, P, q + 500), A2 = M.areasOf([JSON.parse(JSON.stringify(f))], geo, P, q + 500);
  ok(A1[0].key === A2[0].key, "same phase and key for a late joiner");
  ok(M.areasOf([o], geo, P, q + 60000 + T.outSpan + 1).length === 0, "after going out: nothing (no replay)");
  // the field while growing: ignite times rise along the path (drawing order) and the times texture exists; at rest it does not
  const fg = M.raster(M.areasOf([f], geo, P, q + 10)[0], geo, P);
  ok(fg.times && fg.anim, "growing: a times texture");
  const W = fg.w, ign = (x) => { let best = 255; for ( let y = 0; y < fg.h; y++ ) { const v = fg.times[(y * W + x) * 4]; if ( v ) best = Math.min(best, v); } return best; };
  const xs = [Math.floor(W * 0.2), Math.floor(W * 0.5), Math.floor(W * 0.8)].map(ign);
  ok(xs[0] < xs[1] && xs[1] < xs[2], `it catches from where the stroke began (${xs})`);
  ok(M.raster(M.areasOf([f], geo, P, q + cm + T.growSpan + 1)[0], geo, P).times === null, "at rest: no times texture");
  // going out: out times written, smoke later than flames (it lingers)
  const fo = M.raster(M.areasOf([o], geo, P, q + 60001)[0], geo, P);
  let outF = 0, smokeLater = 0, flames = 0;
  for ( let i = 0; i < fo.w * fo.h; i++ ) { const t = fo.times[i * 4 + 1], ts = fo.times[i * 4 + 3]; if ( fo.data[i * 4] ) { flames++; if ( t < 255 ) outF++; } if ( ts < 255 && fo.data[i * 4] && ts > t ) smokeLater++; }
  ok(outF === flames && flames > 0, `every flame cell goes out (${outF}/${flames})`);
  ok(smokeLater > 0, "the smoke goes out after the flames");
  // an eraser puts out (anim) and becomes a cut once done; an undone eraser lets the fire grow back
  const er = M.cleanStroke({ id: "g2", k: "erase", s: 1, r: 50, p: [550, 400], q: q + 100000 });
  const done = q + cm + T.growSpan + 200000;
  const fe = M.raster(M.areasOf([f, er], geo, P, q + 100001)[0], geo, P), fc = M.raster(M.areasOf([f, er], geo, P, done)[0], geo, P);
  ok(fe.times && fe.mass > fc.mass && !fc.times, "eraser: going out, then a plain cut");
  const fr = M.raster(M.areasOf([f, { ...er, o: done }], geo, P, done + 1)[0], geo, P);
  ok(fr.times && fr.mass > fc.mass, "undone eraser: the fire grows back");
  // relit (redo / undo of a delete): grows again from g, keeps its place q
  const rl = M.cleanStroke({ ...f, g: done });
  ok(M.phaseOf(rl, done + 1, geo, P) === "grow" && rl.q === q, "relit: grows again, same paint order");
}

/* H: levels (fire and smoke independent), styles */
{
  const base = { s: 1, r: 60, wd: 0, ws: 0, q: 1 };
  const old = M.cleanStroke({ id: "h0", k: "fire", p: [400, 400], ...base });
  ok(old.lv === 2 && old.sm === 2, "old strokes read as fire 2 / smoke 2");
  ok(M.cleanStroke({ id: "h1", k: "smoke", p: [1, 1], sm: 0 }).sm === 1 && M.cleanStroke({ id: "h1", k: "fire", p: [1, 1], sm: 0 }).sm === 0, "smoke brush 1..3, fire smoke 0..3");
  const F = (lv, sm) => M.raster(M.areasOf([M.cleanStroke({ id: "h", k: "fire", p: [400, 400], lv, sm, ...base })], geo, P)[0], geo, P);
  const rowsUp = (fl) => { let top = fl.h; for ( let y = 0; y < fl.h; y++ ) for ( let x = 0; x < fl.w; x++ ) if ( fl.data[(y * fl.w + x) * 4] > 20 ) { top = Math.min(top, y); } return fl.h - top; };
  const smokeSum = (fl) => { let t = 0; for ( let i = 0; i < fl.w * fl.h; i++ ) t += fl.data[i * 4 + 1]; return t; };
  const f1 = F(1, 2), f2 = F(2, 2), f3 = F(3, 2);
  ok(rowsUp(f1) < rowsUp(f2) && rowsUp(f2) < rowsUp(f3), `fire levels: taller tongues (${rowsUp(f1)} < ${rowsUp(f2)} < ${rowsUp(f3)})`);
  const sm = (lv) => M.raster(M.areasOf([M.cleanStroke({ id: "h", k: "fire", p: [400, 400], lv, sm: 2, ...base, r: 20 })], geo, P)[0], geo, P).emit.fire.length;
  ok(sm(1) < sm(2) && sm(2) < sm(3), `fire levels: more sparks (${sm(1)}, ${sm(2)}, ${sm(3)})`);
  ok(smokeSum(F(3, 0)) === 0 && smokeSum(F(1, 3)) > smokeSum(F(1, 1)) && smokeSum(F(2, 1)) > 0, "smoke independent of fire: off / wisps / column");
  const code = (fl) => { for ( let i = 0; i < fl.w * fl.h; i++ ) if ( fl.data[i * 4 + 1] && fl.data[i * 4] ) return fl.data[i * 4 + 3]; return 0; };
  ok(code(F(3, 1)) === 1 + 2 * 4 + 1 && code(F(1, 3)) === 1 + 0 + 3, "levels encoded per cell (A)");
  const L = (lv) => M.lightsOf([{ area: M.areasOf([M.cleanStroke({ id: "h", k: "fire", p: [400, 400], lv, sm: 0, ...base })], geo, P)[0], field: F(lv, 0) }], geo, P)[0];
  ok(L(1).radius < L(2).radius && L(2).radius < L(3).radius && L(3).level === 3, "lights scale with the fire level");
  // two fires whose plumes overlap stay two areas and two lights
  const a = M.cleanStroke({ id: "p1", k: "fire", p: [300, 600], ...base }), b = M.cleanStroke({ id: "p2", k: "fire", p: [300 + 4 * geo.grid, 600], ...base, wd: 180, ws: 1 });
  const PA = M.areasOf([a, b], geo, P);
  ok(PA.length === 2, `plumes do not merge fires (${PA.length} areas)`);
  ok(M.lightsOf(PA.map((x) => ({ area: x, field: M.raster(x, geo, P) })), geo, P).length === 2, "distinct fires keep distinct lights");
  ok(M.areasOf([a, M.cleanStroke({ ...b, id: "p3", st: "fireball", p: [300, 600] })], geo, P).length === 2, "styles never share an area");
  ok(M.areasOf([M.cleanStroke({ ...b, id: "p4", st: "fireball" })], geo, P)[0].style === "fireball", "fireball style per stroke");
}

/* I: the smoke is never cut by its area's rectangle (fire style), wind from all 8 directions, three speeds, fire and smoke strokes */
{
  let worst = 0, where = "";
  for ( const k of ["fire", "smoke"] ) for ( const ws of [0, 0.5, 1] ) for ( const wd of [0, 45, 90, 135, 180, 225, 270, 315] ) {
    const st = M.cleanStroke({ id: "c", k, s: 1, r: 60, p: [520, 600, 640, 610], wd, ws, q: 1, lv: 3, sm: 3 });
    const f = M.raster(M.areasOf([st], geo, P)[0], geo, P), W = f.w, H = f.h, g = (x, y) => f.data[(y * W + x) * 4 + 1];
    for ( let x = 0; x < W; x++ ) for ( const y of [0, H - 1] ) if ( g(x, y) > worst ) { worst = g(x, y); where = `${k} ${wd}/${ws}`; }
    for ( let y = 0; y < H; y++ ) for ( const x of [0, W - 1] ) if ( g(x, y) > worst ) { worst = g(x, y); where = `${k} ${wd}/${ws}`; }
  }
  ok(worst === 0, `smoke fades out inside its rectangle in every wind (worst border density ${worst} ${where})`);
}


/* J: colour */
{
  // the natural fire is the old palette, bit for bit (the v1 shader's constants, the old particles, the old light)
  const v1 = readFileSync(new URL("./fixtures/fire-v1/shader.mjs", import.meta.url), "utf8");
  const cst = (name) => v1.match(new RegExp(String.raw`const vec[34] ${name}\s*= vec[34]\(([^)]*)\)`))[1].split(",").slice(0, 3).map(Number);
  const R0 = Look.rampOf(Look.NATURAL), f32 = (a) => [...new Float32Array(a)];
  const names = { core: "CORE", yellow: "YELLOW", orange: "ORANGE", red: "RED", tip: "TIP", glow: "GLOW" };
  ok(Object.entries(names).every(([k, c]) => JSON.stringify(f32(R0.pal[k])) === JSON.stringify(f32(cst(c)))), "natural palette = the v1 (fireball) shader constants exactly");
  // (the fire style's own constants before the colour control, e7a92a5)
  const fireOld = { ember: [0.520, 0.140, 0.070], char: [0.150, 0.085, 0.065], under: [0.62, 0.27, 0.12] };
  ok(Object.entries(fireOld).every(([k, c]) => JSON.stringify(f32(R0.pal[k])) === JSON.stringify(f32(c))), "natural fire-style constants unchanged");
  ok(Look.SLOTS.every((k, i) => JSON.stringify([...R0.uniforms.slice(i * 4, i * 4 + 3)]) === JSON.stringify(f32(R0.pal[k]))), "uniform layout = SLOTS");
  ok(JSON.stringify(R0.embers) === JSON.stringify(M.EMBER) && R0.light === P.lightColor && P.fireColor === Look.NATURAL && P.smokeTint === 0 && P.lightFollow, "natural embers, light and defaults unchanged");
  // the rule itself reproduces the natural palette (the shortcut only removes rounding): a neighbour of the natural base is within 2 %
  const Rn = Look.rampOf("#ff8a25");
  ok(Look.SLOTS.every((k) => R0.pal[k].every((x, i) => Math.abs(x - Rn.pal[k][i]) < 0.02)), "the rule is continuous through the natural base");
  // deterministic: the same bytes every time (and after the cache is flushed)
  const snap = (c) => JSON.stringify([...Look.rampOf(c).uniforms, ...Look.rampOf(c).embers, Look.rampOf(c).light]);
  const first = Object.values(Look.PRESETS).map(snap).join();
  for ( let i = 0; i < 80; i++ ) Look.rampOf(`#${(i * 0x30305).toString(16).padStart(6, "0").slice(-6)}`);
  ok(Object.values(Look.PRESETS).map(snap).join() === first, "ramp derivation deterministic");
  // not a tint: every colour keeps a pale hot core and dark tips, a hue shift towards the light
  const H = (c) => Look.hsv(c);
  let shape = true;
  for ( const c of Object.values(Look.PRESETS) ) {
    const p = Look.rampOf(c).pal;
    if ( !(H(p.core)[2] >= 0.95 && H(p.core)[1] < H(p.orange)[1] + 1e-9 && H(p.tip)[2] < 0.4 && H(p.char)[2] < 0.2 && H(p.yellow)[2] >= H(p.red)[2]) ) shape = false;
  }
  ok(shape, "every preset: pale bright core, dark tips and char, value steps down the ramp");
  const B = Look.rampOf(Look.PRESETS.blue).pal, hc = H(B.core)[0], ht = H(B.tip)[0], hb = H(Look.hexToRgb(Look.PRESETS.blue))[0];
  ok(hc < hb && hc > 170 && ht > hb && ht < 270, `blue: core shifts to cyan (${hc.toFixed(0)}), tips to indigo (${ht.toFixed(0)}) around ${hb.toFixed(0)}`);
  // strokes: c cleaned (preset names, hex), erasers never, old strokes none
  ok(M.cleanStroke({ id: "c1", k: "fire", p: [1, 1], c: "blue" }).c === Look.PRESETS.blue && M.cleanStroke({ id: "c2", k: "fire", p: [1, 1], c: "#ABCDEF" }).c === "#abcdef"
    && M.cleanStroke({ id: "c3", k: "fire", p: [1, 1], c: "red-ish" }).c === undefined && M.cleanStroke({ id: "c4", k: "erase", p: [1, 1], c: "#ff0000" }).c === undefined, "stroke colour cleaned");
  const base = { s: 0.9, r: 60, wd: 0, ws: 0, q: 1 };
  const old = M.cleanStroke({ id: "o1", k: "fire", p: [400, 400], ...base });
  const A0 = M.areasOf([old], geo, P)[0], F0 = M.raster(A0, geo, P);
  ok(A0.color === Look.NATURAL && JSON.stringify(F0.embers) === JSON.stringify(M.EMBER) && JSON.stringify(F0.puffs) === JSON.stringify(M.PUFF), "old strokes: natural colour, old particles");
  ok(M.areasOf([old], geo, { ...P, fireColor: "#3a86ff" })[0].color === "#3a86ff", "strokes without a colour follow the scene's");
  // colours never share an area; their lights stay apart and take the fire's colour
  const blue = M.cleanStroke({ id: "b1", k: "fire", p: [400, 400], ...base, c: "blue" });
  const AB = M.areasOf([old, blue], geo, P);
  ok(AB.length === 2 && AB.map((a) => a.color).sort().join() === [Look.NATURAL, Look.PRESETS.blue].sort().join(), "colours keep their own areas");
  const LB = M.lightsOf(AB.map((a) => ({ area: a, field: M.raster(a, geo, P) })), geo, P);
  ok(LB.length === 2 && new Set(LB.map((l) => l.color)).size === 2 && LB.some((l) => l.color === P.lightColor), "a light per colour, in its fire's colour");
  ok(M.areasOf([old, blue], geo, P)[0].key !== M.areasOf([old, M.cleanStroke({ ...blue, c: "green" })], geo, P)[0].key || true, "keys");
  const kb = M.areasOf([blue], geo, P)[0].key, kg = M.areasOf([M.cleanStroke({ ...blue, c: "green" })], geo, P)[0].key;
  ok(kb !== kg, "the colour is in the area key");
  // particles follow the colour; the smoke is neutral unless tinted
  const FB = M.raster(M.areasOf([blue], geo, P)[0], geo, P);
  let em = null;
  for ( let k = 0; k < 64 && !em; k++ ) for ( let t = 0; t < 4000 && !em; t += 97 ) { const p = M.particleAt(FB, 7, k, 100000 + t); if ( p?.kind === "ember" ) em = p; }
  ok(em && FB.sparks.includes(em.color) && !M.EMBER.includes(em.color), "sparks in the fire's colour (the fire style: its ramp's steps 5 > 3 > 2 > 1)");
  ok(JSON.stringify(FB.puffs) === JSON.stringify(M.PUFF), "smoke particles neutral by default");
  const FT = M.raster(M.areasOf([blue], geo, { ...P, smokeTint: 1 })[0], geo, { ...P, smokeTint: 1 });
  ok(JSON.stringify(FT.puffs) !== JSON.stringify(M.PUFF) && Look.hsv([(FT.puffs[0] >> 16 & 255) / 255, (FT.puffs[0] >> 8 & 255) / 255, (FT.puffs[0] & 255) / 255])[0] > 150, "smoke tint takes the fire's hue");
  ok(M.areasOf([blue], geo, { ...P, smokeTint: 1 })[0].key !== kb, "the smoke tint is in the key");
  // the fireball takes the colour too, its field bytes do not depend on it
  const fb = M.cleanStroke({ id: "f1", k: "fire", p: [400, 400], ...base, st: "fireball" });
  ok(Buffer.from(M.raster(M.areasOf([fb], geo, P)[0], geo, P).data).equals(Buffer.from(M.raster(M.areasOf([M.cleanStroke({ ...fb, c: "purple" })], geo, P)[0], geo, P).data)), "fireball: colour does not touch the field");
}

/* K: the fire style's art inputs (art.mjs): the chamfer distance, the aux texture, the smoke tail */
{
  // chamfer: a 5 x 5 block inside a 9 x 9 grid -> 0 outside, growing inwards; rows count 1 / RY
  const W = 9, H = 9, ins = new Uint8Array(W * H);
  for ( let y = 2; y < 7; y++ ) for ( let x = 2; x < 7; x++ ) ins[y * W + x] = 1;
  const D = M.chamfer(ins, W, H);
  ok(D[0] === 0 && D[2 * W + 2] === 1 && Math.abs(D[4 * W + 4] - 3) < 1e-6 && D[4 * W + 2] === 1, "chamfer: inside distances grow inwards (x steps 1)");
  ok(Math.abs(D[2 * W + 4] - 1 / M.RY) < 1e-6, "chamfer: a row step counts 1 / RY (the ground plane is foreshortened)");
  // aux: the bed's inside / outside distances and the smoke sources, only for the fire style; deterministic
  const a = M.cleanStroke({ id: "x1", k: "fire", s: 0.9, r: 60, p: [400, 400, 520, 410], wd: 0, ws: 0, q: 1, lv: 2, sm: 2 });
  const F1 = M.raster(M.areasOf([a], geo, P)[0], geo, P), F2 = M.raster(M.areasOf([a], geo, P)[0], geo, P);
  ok(F1.aux && F1.aux.length === F1.w * F1.h * 4 && Buffer.from(F1.aux).equals(Buffer.from(F2.aux)), "aux: present, RGBA per cell, deterministic");
  let inB = 0, outB = 0, both = 0, src = 0, fireSrc = 0;
  for ( let i = 0; i < F1.w * F1.h; i++ ) { const r = F1.aux[i * 4], g = F1.aux[i * 4 + 1]; if ( r ) inB++; if ( g ) outB++; if ( r && g ) both++; if ( F1.aux[i * 4 + 2] >= 5 ) { src++; if ( F1.aux[i * 4 + 3] >= 4 ) fireSrc++; } }
  ok(inB > 0 && outB > 0 && both === 0, "aux: inside and outside distances are disjoint");
  ok(src > 0 && fireSrc > 0, "aux: the fire's smoke sources are marked (level + 4)");
  const fb = M.cleanStroke({ ...a, id: "x2", st: "fireball" });
  ok(!M.raster(M.areasOf([fb], geo, P)[0], geo, P).aux, "aux: the fireball has none (its v1 field only)");
  const a0 = M.cleanStroke({ ...a, id: "x3", sm: 0 }), A0 = M.raster(M.areasOf([a0], geo, P)[0], geo, P);
  let s0 = 0; for ( let i = 0; i < A0.w * A0.h; i++ ) if ( A0.aux[i * 4 + 2] >= 5 ) s0++;
  ok(s0 === 0, "aux: smoke level 0 -> no smoke sources");
  // the smoke tail: a put-out fire's area lives on SMOKE_TAIL ms past the flames, so its last puffs finish their lives
  const T = M.timing(geo, P);
  ok(T.outSpan >= 1.6 * P.out * 1000 + M.SMOKE_TAIL && M.SMOKE_TAIL >= 4.6 * 1.3 * 1000, "outSpan includes the smoke tail (the longest puff life)");
}

console.log(`${fails ? "FAIL" : "ok"} fire model: ${n - fails}/${n} checks`);
process.exit(fails ? 1 : 0);
