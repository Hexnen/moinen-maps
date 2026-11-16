// MAPDIRECT: map lettering reads the direction of what it letters (scripts/sfx/sfx-direct.mjs and its callers). Each group fails on the
// build before MAPDIRECT (no sfx-direct.mjs: the import fails) and names what it holds.
//   PURE    the way, the look it gives (from / lean / sign), the knock's profile (back at the contact, past its place, settle, slide,
//           thrown out; continuous; whole in still air), the seat's shares (view, panel, wall), a gun's slant, the wind
//   PAGE    which firings have a way (a rocket from its tube, a meteor, a grenade's throw, a hero's dive) and which have none (a strike,
//           a blast set off in place); the main word on the far side; debris thrown out; the backblast back; fires' hisses with their wind
//   EVENTS  a plough's bite and stop go the pile's way, its grind rides; a brush blast's debris is thrown out; the muzzle's syllables fly
//           along the aim, on its screen-up side
//   TABLE   on the real engine: a word with a way is measured and played with an ANGLE `from`, a lean and a sign (the same options on two
//           seats' tables); a rider and a drifter keep theirs; a rising word's room follows the wind
//   SEATS   two seats (different window, zoom): the same way, the same pose at the same instant in cap heights where both have room; a
//           seat with a panel in the way shortens it in proportion and never crosses the panel, the view's edge or the thing it letters
//   WIRING  the runtime uses all of it
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const D = await imp("scripts/sfx/sfx-direct.mjs");
const C = await imp("scripts/sfx/sfx-core.mjs"), PG = await imp("scripts/sfx/sfx-page.mjs"), EV = await imp("scripts/sfx/sfx-events.mjs");
const T = await imp("scripts/sfx/sfx-table.mjs"), SEAT = await imp("scripts/sfx/sfx-seat.mjs");
const PC = await imp("scripts/presets/core.mjs"), { BUILTIN } = await imp("scripts/presets/defs.mjs"), MC = await imp("scripts/presets/meteor-core.mjs");
const { fallAt } = await imp("scripts/presets/landing-fx.mjs"), AC = await imp("scripts/presets/accents-core.mjs");
const { setup } = await imp("scripts/letters/testenv.mjs");
const { sizeFor } = await imp("scripts/letters/size.mjs");
const E = await setup({ gm: true });
const L = E.engine; L.lookStyle("invincible");

let n = 0; const failed = [], V = !!process.env.DIRECT_VERBOSE;
const ok = (c, m) => { if ( c ) { n++; if ( V ) console.log("  ok", m); } else failed.push(m); };
const group = (id, fn) => { try { fn(); } catch ( err ) { failed.push(`${id}: threw ${String(err?.stack ?? err).split(/\r?\n/).slice(0, 3).join(" | ")}`); } };
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
const src = (f) => fs.readFileSync(path.join(root, "scripts", f), "utf8");

group("PURE", () => {
  const right = D.wayOf({ x: 0, y: 0 }, { x: 300, y: 0 }), downR = D.wayOf([0, 0], [300, 300]), up = D.wayOf([0, 0], [0, -200]);
  ok(right.ux === 1 && right.uy === 0 && near(downR.ux, 0.707) && D.wayOf([0, 0], [0.2, 0]) === null, "the way between two points; none when they coincide");
  ok(D.fromOf(right) === 180 && D.fromOf(downR) === -135 && D.fromOf(up) === 90, "the engine's `from` is the opposite side: " + [D.fromOf(right), D.fromOf(downR), D.fromOf(up)]);
  ok(D.tiltOf(right, 3) < 0 && D.tiltOf(D.backWay(right), 3) > 0, "a flat way climbs toward where it goes");
  ok(D.tiltOf(downR) > 0 && D.tiltOf(D.wayOf([0, 0], [300, -300])) < 0 && D.tiltOf(D.wayOf([0, 0], [-300, 300])) < 0, "the baseline turns with the way");
  for ( const a of [0, 20, 45, 70, 110, 160, 200, 250, 300, 340] ) { const w = D.unitWay(Math.cos(a / 57.3), Math.sin(a / 57.3)); ok(Math.abs(D.tiltOf(w, 0, D.LEAN.sec)) <= 16 && Math.abs(D.tiltOf(w, 0, D.LEAN.main)) <= 10, `a lean stays readable at ${a} deg`); }
  ok(D.tiltOf(up, 4) === 4 && D.signOf(up) === null && D.lookOf(up, 4).dir === undefined, "a vertical way keeps the word's own tilt and no sign");
  ok(D.signOf(right) === 1 && D.signOf(D.backWay(right)) === -1 && D.lookOf(right).dir === 1, "the engine's own sideways motions go the way");
  for ( const K of [D.KNOCK.main, D.KNOCK.sec] ) {
    const o = { K, contact: 60, holdEnd: 1500 }, s = (t) => D.knockS(t, o);
    ok(s(0) === -K.back && s(60) === -K.back, "at its contact the word stands BACK toward where the event came from");
    ok(near(s(60 + K.fly), K.over) && s(60 + K.fly * 0.5) > -K.back * 0.2, "knocked past its place on a hard ease-out (the impulse at once)");
    ok(s(60 + K.fly + K.settle) >= 0 && s(60 + K.fly + K.settle) < K.over, "it settles back toward its place");
    ok(s(1500) > s(900) && near(s(1500), K.drift, 0.02), "it slides on while it stands");
    ok(near(s(1500 + K.outMs), K.drift + K.outD) && s(1500 + K.outMs * 0.5) < K.drift + K.outD * 0.5, "thrown out on its exit, accelerating");
    let jump = 0, back = 0; for ( let t = 0; t < 2200; t += 1000 / 60 ) { const d = s(t + 1000 / 60) - s(t); jump = Math.max(jump, Math.abs(d)); if ( t > 60 && t + 1000 / 60 < 60 + K.fly ) back = Math.min(back, d); }
    ok(jump < 0.3 && back >= 0, `no jump between two frames (${jump.toFixed(3)} cap), never backwards in the flight`);
    ok((s(60 + K.fly) - s(60)) * 1 >= 1.1, "the flight after the contact is over a cap height: the eye can follow it");
  }
  ok(D.knockAt(right, 500, { reduced: true }).x === 0 && D.knockAt(null, 500).x === 0, "reduced motion or no way: it stands");
  const q = D.knockAt(downR, 60, { K: D.KNOCK.sec, contact: 60, holdEnd: 1500 }); ok(q.x < 0 && q.y < 0 && near(q.x, q.y), "the knock runs along the way");
  // the seat's shares
  const box = { x0: 400, y0: 400, x1: 700, y1: 500 }, view = { x0: 0, y0: 0, x1: 1600, y1: 900 };
  const free = D.knockFit(box, 60, right, D.KNOCK.sec, { view });
  ok(free.kb === 1 && free.kv === 1 && free.kf === 1 && free.ko === 1, "room on every side: the whole knock");
  const panel = { x0: 730, y0: 300, x1: 900, y1: 700 }, pf = D.knockFit(box, 60, right, D.KNOCK.sec, { view, blocks: [panel], edge: [panel] });
  // (live 2026-11-16, a fight's HUD: a seat that lost slide starts the word further back, so it travels as far on every seat)
  ok(pf.kf > 0 && pf.kf < 1 && pf.ko === 0, "a panel ahead shortens the slide in proportion and stops the throw: " + JSON.stringify(pf));
  ok(700 + D.KNOCK.sec.over * pf.kv * 60 <= panel.x0 + 1, "it never passes over the panel");
  const behind = { x0: 250, y0: 300, x1: 380, y1: 700 }, bf = D.knockFit(box, 60, right, D.KNOCK.sec, { view, blocks: [behind], edge: [behind] });
  ok(bf.kb < 1 && 400 - bf.kb * D.KNOCK.sec.back * 60 >= behind.x1 - 1 && bf.kf === 1, "a panel behind shortens the back: it never starts on the panel: " + JSON.stringify(bf));
  const word = D.knockFit(box, 60, right, D.KNOCK.sec, { view, blocks: [behind, panel], edge: [] });
  ok(word.kb > 1 && word.kv === 1 && word.kf < 1, "a WORD up shortens only the slide (the way in passes it): " + JSON.stringify(word));
  ok(700 + D.KNOCK.sec.drift * pf.kf * 60 <= panel.x0 + 1, "it never comes to stand on the panel");
  ok(near(pf.kb * D.KNOCK.sec.back, D.KNOCK.sec.back + D.KNOCK.sec.drift * (1 - pf.kf), 0.01), "what the slide lost is added to the back: it travels as far as on a free seat");
  const wedged = D.knockFit({ x0: 30, y0: 400, x1: 700, y1: 500 }, 60, right, D.KNOCK.sec, { view, blocks: [panel], edge: [panel] });
  ok(wedged.kb * D.KNOCK.sec.back * 60 <= 31, "... but never back out of the view: " + JSON.stringify(wedged));
  const wall = { x0: 705, y0: 380, x1: 900, y1: 520 }, wf = D.knockFit(box, 60, right, D.KNOCK.sec, { view, wall });
  ok(wf.kf < 0.1 && wf.kb > 1, "it never comes to stand further ONTO the thing it letters (heading for its middle): " + JSON.stringify(wf));
  const astride = { x0: 300, y0: 380, x1: 500, y1: 520 }, af = D.knockFit(box, 60, right, D.KNOCK.sec, { view, wall: astride });
  ok(af.kf === 1, "a word astride the thing, heading away from its middle, slides on: " + JSON.stringify(af));
  const edge = D.knockFit({ x0: 1300, y0: 400, x1: 1590, y1: 500 }, 60, right, D.KNOCK.sec, { view });
  ok(edge.kf < 0.2 && edge.ko < 0.2 && edge.kv <= 0.5 && edge.kb > 1, "not past the view's edge (slide, overshoot, throw): " + JSON.stringify(edge));
  const past = D.roomAlong({ x0: 1500, y0: 400, x1: 1700, y1: 500 }, 1, 0, 100, { view }); ok(past <= 1, "a word already past an edge is not moved further out");
  ok(D.roomAlong(box, 1, 0, 2000, { view, blocks: [{ x0: 900, y0: 380, x1: 920, y1: 520 }] }) <= 200.5, "it never jumps over a thin panel");
  // a gun
  for ( const [ax, ay] of [[1, 0], [-1, 0], [0.7, 0.7], [-0.6, -0.8], [0, 1], [0, -1], [0.2, 1]] ) {
    const d = D.streamDir(ax, ay), u = { x: Math.cos(d / 57.2958), y: Math.sin(d / 57.2958) }, l = Math.hypot(ax, ay);
    ok(u.x * ax / l + u.y * ay / l > 0.7, `a gun's syllables fly along the aim (${ax}, ${ay}) -> ${d} deg`);
    ok(u.y <= 0.05 || Math.abs(ax) < 0.75 * l, `... on its screen-up side (${d})`);
  }
  ok(D.streamDir(0, 0) === null, "no aim, no direction");
  // the wind
  ok(D.driftTo([0.15, 0.9])[0] === 0.15 && D.driftTo([0.15, 0.9])[1] === -0.9 && D.driftTo([0.15, 0.9], [0.02, 0])[1] === -0.9, "still air: straight up, as before");
  const dw = D.driftTo([0.15, 0.9], [0.8, 0]), dl = D.driftTo([0.15, 0.9], [-0.8, 0]);
  ok(dw[0] > 1 && dl[0] < -1 && dw[1] < 0 && dw[1] > -0.9, "wind: downwind and flatter, still rising: " + JSON.stringify([dw, dl]));
  ok(D.plumeDeg(null) === -90 && D.plumeDeg([0.8, 0]) > -90 && D.plumeDeg([-0.8, 0]) < -90 && D.plumeDeg([1, 0.9]) === -50 && D.plumeDeg([-1, 0.9]) === -130, "a fire's sparks leave downwind, never more than 40 deg off straight up");
  ok(D.windOf({ wd: 90, ws: 0.5 })[1] === 0.5 && D.windOf({})[0] === 0, "a stroke's wind as a vector");
});

// ---- firings (as dev/sfx-page.test.mjs builds them)
const ENV = { grid: 100, rect: { x: 0, y: 0, width: 6000, height: 4000 }, now: 1_800_000_000_000, wind: { dir: 0, speed: 0 } };
const GEST = { point: { a: [3000, 2000] }, throw: { a: [2400, 2000], b: [3000, 2100] }, shot: { a: [2400, 2000], b: [3000, 2200], from: [2400, 2000], fr: 50 }, line: { a: [2400, 1900], b: [3200, 2100] }, run: { a: [1600, 2000], b: [3400, 2000] } };
function fire(id, opts = {}, g = null, env = ENV) {
  const d = BUILTIN.find((q) => q.id === id), plan = PC.expand(d, g ?? GEST[d.gesture], { seed: 11, ...opts }, env), strokes = new Map(), f = [];
  for ( const r of plan.fire ) { const st = { id: `f-${r.key}`, ...r }; strokes.set(st.id, st); f.push({ id: st.id, key: r.key }); }
  for ( const b of plan.pending.burst ?? [] ) { const st = { id: `f-burst.${b.id}`, k: "burst", p: [b.x, b.y], r: b.r, lv: b.lv, q: Math.round(plan.t0 + (b.at ?? 0)), wd: env.wind.dir, ws: env.wind.speed }; strokes.set(st.id, st); f.push({ id: st.id, key: `burst.${b.id}` }); }
  const rec = { id: `fid-${id}`, preset: id, t0: plan.t0, seed: plan.seed, size: plan.size, power: plan.power, at: plan.at, dir: plan.dir, gesture: plan.gesture, walk: plan.walk,
    d: plan.destruction.map((r, i) => ({ id: `d${i}`, key: r.key, at: Math.round(plan.t0 + (r.at ?? 0)) })), f, pending: { ...plan.pending, burst: [] } };
  return { rec, strokes, plan, pg: PG.firingPage(rec, { grid: 100, strokes, wayOf: MC.wayOf, headAt: MC.headAt, fallAt, lift: 0.5 }) };
}
const ids = BUILTIN.map((d) => d.id);
const accOf = (F, k) => (F.rec.pending?.accent ?? []).find((a) => a?.kind === k);
const pick = (kind) => ids.map((id) => { try { return fire(id); } catch { return null; } }).find((F) => F && accOf(F, kind) && F.pg.main);

group("PAGE", () => {
  const rk = pick("rocket"), mt = pick("meteor"), gr = pick("bounce"), ld = pick("landing"), sk = pick("strike");
  ok(rk && mt && gr && ld && sk, "the built-in presets hold a rocket, a meteor, a grenade, a landing and a strike");
  const main = (F) => F.pg.words.find((w) => w.role === "main");
  // a rocket: from its tube to its impact
  const ra = accOf(rk, "rocket"), rw = D.wayOf(ra.m, ra.to);
  ok(main(rk).way && near(main(rk).way.ux, rw.ux, 0.01) && near(main(rk).way.uy, rw.uy, 0.01), "a rocket's impact goes the way of its flight: " + JSON.stringify(main(rk).way));
  for ( const [nm, F] of [["meteor", mt], ["grenade", gr], ["landing", ld]] ) {
    const w = main(F).way, d = F.rec.dir;
    if ( !d ) { ok(!w, `${nm}: a firing without a direction has no way`); continue; }
    ok(w && w.ux * d[0] + w.uy * d[1] > 0.99, `${nm}: its impact goes the firing's own way ` + JSON.stringify(w));
    if ( Math.abs(w.ux) > 0.2 && !(Number(F.strokes.get([...F.strokes.keys()].find((k) => /burst/.test(k)))?.ws) > 0.05) ) ok(main(F).side === Math.sign(w.ux), `${nm}: the main word stands on the far side of the impact`);
  }
  ok(!main(sk).way, "a strike from the sky has no way");
  const bomb = fire("bomb"); ok(bomb.pg.main && (!bomb.rec.dir ? !main(bomb).way : true), "a blast set off in place has none");
  ok(JSON.stringify(fire("bomb").pg.words.map((w) => [w.key, w.kind, w.t, w.rank])) === JSON.stringify(bomb.pg.words.map((w) => [w.key, w.kind, w.t, w.rank])), "a page is the same on every seat");
  // debris is thrown out of the blast
  const falls = mt.pg.words.filter((w) => w.role === "fall" && w.kind === "debris");
  ok(falls.length >= 2 && falls.every((w) => w.thrown && w.thrown.x === mt.rec.at[0] && w.thrown.y === mt.rec.at[1]), "every debris word knows where it was thrown from");
  // a grenade's shrapnel flies on the way of the throw
  const sh = gr.pg.words.find((w) => w.key === "shrapnel"); ok(!sh || (sh.way && sh.way.ux * gr.rec.dir[0] + sh.way.uy * gr.rec.dir[1] > 0.99), "shrapnel flies on past the blast");
  // a grenade thrown by a token, no second point: from the thrower to where it lands
  const thrown = fire("grenade", {}, { a: [1900, 1750], from: [2600, 500], b: null }), tw = main(thrown).way;
  ok(tw && tw.ux < 0 && tw.uy > 0 && Math.abs(tw.ux * 1250 - tw.uy * -700) < 30, "a grenade thrown by a token goes from the thrower to where it lands: " + JSON.stringify(tw));
  ok(thrown.pg.words.filter((w) => /^pre\|bounce/.test(w.key)).every((w) => w.x > 1900 && w.y < 1750), "... its hops on the thrower's side");
  // a launch's backblast goes back
  const shot = ids.map((id) => { try { return fire(id, {}, GEST.shot); } catch { return null; } }).find((F) => F && accOf(F, "rocket")?.shot);
  const lw = shot?.pg.words.find((w) => w.key === "pre|launch");
  ok(lw?.way && lw.way.ux * main(shot).way.ux + lw.way.uy * main(shot).way.uy < -0.99, "a launch's backblast goes back, against the flight");
  // the fires' hisses carry their fires' wind
  const windy = fire("bomb", {}, null, { ...ENV, wind: { dir: 180, speed: 0.7 } });
  for ( const st of windy.strokes.values() ) if ( st.k === "fire" && !Number.isFinite(st.o) ) st.o = st.q + 6000;
  const outs = PG.firingPage(windy.rec, { grid: 100, strokes: windy.strokes }).words.filter((w) => w.role === "out");
  ok(outs.length >= 1 && outs.every((w) => w.wind && w.wind[0] < -0.5), "a dying fire's hiss knows its wind: " + JSON.stringify(outs[0]?.wind));
});

group("EVENTS", () => {
  const hit = (id, t0, x0) => ({ id, t0, p: [x0, 500, t0, x0 + 200, 500, t0 + 400, x0 + 600, 500, 1600] });
  const w = EV.ploughPage({ hits: [hit("a", 300, 400), hit("b", 700, 700)], D: 1600, k: 1, start: 10_000, delay: 40, grid: 100, seed: "s" });
  const bite = w.find((q) => q.role === "bite"), grind = w.find((q) => q.role === "grind"), stop = w.find((q) => q.role === "stop");
  ok(bite.way?.ux === 1 && stop.way?.ux === 1 && !grind.way && grind.ride?.length > 2, "a plough's bite and stop go the pile's way; its grind rides with it");
  const back = EV.ploughPage({ hits: [{ id: "a", t0: 300, p: [900, 500, 300, 700, 500, 700, 300, 500, 1600] }], D: 1600, k: 1, start: 0, delay: 0, grid: 100, seed: "s" });
  ok(back.find((q) => q.role === "stop").way.ux === -1, "... to the left when it is shoved left");
  // a brush blast's debris
  const e = { key: "d|1", sid: "d|1", obj: "d1", voice: "blast", x: 1000, y: 1000, r: 300, t: 1000, mat: "stone" };
  const fs2 = C.brushFalls(e, 100, 1);
  ok(fs2.length === 2 && fs2.every((f) => f.way && (f.x - e.x) * f.way.ux + (f.y - e.y) * f.way.uy > 0), "a brush blast's debris is thrown OUT from it");
  const g = C.cluster([{ ...fs2[0] }], 100)[0], sp = C.planCluster(g, { grid: 100, sec: 4, seed: "scene" });
  ok(sp[0].way && sp[0].way.ux === fs2[0].way.ux, "its word carries the way");
  // a burst's debris and a fire's out
  const st = { id: "b1", k: "burst", p: [1000, 1000], r: 200, lv: 3, q: 5000, db: [300, 0, 500, -280, 40, 700] };
  const be = C.strokeEvents(st, null, 4000, 6000, { grid: 100 }).filter((q) => q.voice === "debris");
  ok(be.length === 2 && be[0].way.ux > 0.9 && be[1].way.ux < -0.9, "a burst's debris: each piece its own way out");
  const fo = C.strokeEvents({ id: "f1", k: "fire", p: [0, 0, 100, 0], r: 60, lv: 2, q: 1000, o: 5000, wd: 0, ws: 0.6 }, { id: "f1", q: 1000 }, 4900, 5100, { grid: 100 }).find((q) => q.voice === "out");
  ok(fo?.wind?.[0] === 0.6, "a fire going out knows its wind");
  // the muzzle
  const it = { kind: "muzzle", from: [1000, 1000], fr: 40, hits: [[1600, 1000, 300, 0], [1620, 1010, 380, 0], [1640, 990, 460, 0]] };
  const mz = C.muzzleEvent(it, { t0: 0, grid: 100, muzzleOf: AC.muzzleOf, flight: () => 80, key: "m", sid: "m" });
  ok(mz.dir === D.streamDir(mz.path[0] ? 600 : 0, 0) || Math.abs(mz.dir - D.streamDir(600, 0)) <= 3, "the report's syllables fly along the aim, slanted up: " + mz.dir);
  ok(Math.cos(mz.dir / 57.2958) > 0.7 && Math.sin(mz.dir / 57.2958) < 0, "... toward the target");
  ok(mz.path.every((q) => Math.hypot(q.x - 1000, q.y - 1000) >= 40 + 100 * C.MUZZLE_CLEAR - 1), "... starting off the shooter's token");
});

// ---- the table and two seats on the real engine
const WG = 100;
const wdeps = () => ({ L, sizeFor, grid: WG, sceneId: "scene", lang: "en", known: null, ledger: SEAT.makeLedger(), toPerf: (t) => t, toShared: (t) => t, layer: { layer: "overlay" },
  step: () => 2, memo: new Map(), tokens: () => [], pins: () => [], warn: (m, e) => { throw e ?? new Error(m); } });
const SEATS = [{ name: "gm", W: 1600, H: 900, z: 0.6 }, { name: "p1", W: 1366, H: 768, z: 0.73 }];
const enterSeat = (S) => { globalThis.innerWidth = S.W; globalThis.innerHeight = S.H; canvas.stage.scale.x = canvas.stage.scale.y = S.z; canvas.grid.size = WG; L.prefs = { ...(L.prefs ?? {}), scale: 1 }; };

group("TABLE", () => {
  const F = pick("rocket"), tables = SEATS.map((S) => { enterSeat(S); const d = wdeps(); return { d, tb: T.planPage({ rec: F.rec, pg: PG.firingPage(F.rec, { grid: 100, strokes: F.strokes, wayOf: MC.wayOf, headAt: MC.headAt, fallAt, lift: 0.5 }), ground: "earth" }, d) }; });
  const [A, B] = tables, m = A.tb.get("main"), mb = B.tb.get("main");
  ok(m?.way && m.box && T.knocked(m), "the rocket's main word is on the table with its way");
  const o = T.optsOf(m, A.d), ob = T.optsOf(mb, B.d);
  ok(typeof o.from === "number" && o.from === D.fromOf(m.way), "it plays with an ANGLE `from` (the same on every seat), the side it came from: " + o.from);
  ok(o.rotation === D.tiltOf(m.way, m.rotation, D.LEAN.main) && Math.abs(o.rotation) <= 10 && (D.signOf(m.way) == null || o.dir === D.signOf(m.way)), "it leans with the way: " + o.rotation);
  ok(o.from === ob.from && o.rotation === ob.rotation && o.dir === ob.dir && o.size === ob.size && m.text === mb.text && JSON.stringify(m.box) === JSON.stringify(mb.box), "two seats' tables: the same word, look, size and place");
  const falls = [...A.tb.values()].filter((q) => q?.box && q.role === "sec" && q.kind === "debris");
  ok(falls.length >= 1 && falls.every((q) => q.way && (q.x - F.rec.at[0]) * q.way.ux + (q.y - F.rec.at[1]) * q.way.uy > -WG), "debris words on the table are thrown out from the impact");
  ok(falls.every((q) => q.flat && T.knocked(q) && typeof T.optsOf(q, A.d).from !== "number" && T.optsOf(q, A.d).rotation === q.rotation), "... knocked, their look and footprint on the table as before");
  for ( const q of A.tb.values() ) if ( q?.path?.length > 1 || q?.drift ) ok(!T.knocked(q) && typeof T.optsOf(q, A.d).from !== "number", `a rider / drifter keeps its own way (${q.key})`);
  // a rising word's room follows the wind
  const still = { text: "FSSSHT", drift: true, x: 0, y: 0, size: 40 }, blown = { ...still, wind: [-0.7, 0] };
  ok(T.driftOf(still)[0] === T.DRIFT[0] && T.driftOf(blown)[0] < -0.9, "a rising word drifts downwind");
  const d = wdeps(), sw = { role: "sec", voice: "out", kind: "fire", text: "FSSSHT", x: 500, y: 500, t: 0, ts: 0, ms: 1600, seed: "s|o", area: 50, magnitude: 0.3, rotation: 0, stage: {}, drift: true, wind: [-0.7, 0], rank: 1 };
  T.measure(sw, d);
  const bo = T.baseOpts(sw, d), bx = C.boxOf(sw);
  ok(bo.path.to.x < sw.x - 0.9 * WG && bo.path.to.y < sw.y, "its path goes downwind and up: " + JSON.stringify(bo.path.to));
  ok(sw.riseX < 0 && bx.x0 <= bo.path.to.x - sw.bw / 2 + 1 && bx.y0 <= bo.path.to.y - sw.bh / 2 + 1, "its box on the table holds its whole way");
});

group("SEATS", () => {
  const way = D.unitWay(1, 0.3), K = D.KNOCK.sec;
  // the same word on two seats with room: the same pose in cap heights at every instant of the table's clock
  const poses = SEATS.map((S) => { const cap = 60 / S.z, box = { x0: 2000, y0: 2000, x1: 2000 + 4 * cap, y1: 2000 + 1.5 * cap }, view = { x0: 2000 - S.W / S.z / 2, y0: 2000 - S.H / S.z / 2, x1: 2000 + S.W / S.z / 2, y1: 2000 + S.H / S.z / 2 };
    const fit = D.knockFit(box, cap, way, K, { view }); return { fit, at: (t) => D.knockAt(way, t, { K, contact: 62, holdEnd: 1400, fit }) }; });
  ok(poses.every((p) => p.fit.kb === 1 && p.fit.kf === 1 && p.fit.ko === 1), "both seats have room for the whole knock");
  let same = true; for ( let t = 0; t <= 2000; t += 50 ) { const a = poses[0].at(t), b = poses[1].at(t); if ( a.x !== b.x || a.y !== b.y ) same = false; }
  ok(same, "one pose at one instant on both seats (in cap heights of the word as each draws it)");
  // a seat with a panel in the way: shortened in proportion, never onto the panel
  const cap = 80, box = { x0: 1000, y0: 1000, x1: 1320, y1: 1120 }, view = { x0: 0, y0: 0, x1: 2600, y1: 1500 }, panel = { x0: 1350, y0: 800, x1: 1700, y1: 1300 };
  const fit = D.knockFit(box, cap, way, K, { view, blocks: [panel], edge: [panel] });
  let worst = 0; for ( let t = 0; t <= 2000; t += 16 ) { const q = D.knockAt(way, t, { K, contact: 62, holdEnd: 1400, fit }); worst = Math.max(worst, box.x1 + q.x * cap - panel.x0); }
  ok(fit.kf < 1 && worst <= 0.5, `a panel in the way: the word never lies on it (${worst.toFixed(1)} px, shares ${JSON.stringify(fit)})`);
  const s = (t) => D.knockS(t, { K, contact: 62, holdEnd: 1400, fit });
  ok(s(62 + K.fly) > 0 && s(1400) >= s(62 + K.fly + K.settle) - 1e-9, "... and still goes the way (shortened, not cut off)");
  // the thing it letters
  const wall = { x0: 1300, y0: 900, x1: 1600, y1: 1200 }, wf = D.knockFit(box, cap, way, K, { view, wall });
  let over = 0; const ov = (b) => Math.max(0, Math.min(b.x1, wall.x1) - Math.max(b.x0, wall.x0)) * Math.max(0, Math.min(b.y1, wall.y1) - Math.max(b.y0, wall.y0)), o0 = ov(box);
  for ( let t = 62 + K.fly + K.settle; t <= 1400; t += 16 ) { const q = D.knockAt(way, t, { K, contact: 62, holdEnd: 1400, fit: wf }); over = Math.max(over, ov({ x0: box.x0 + q.x * cap, y0: box.y0 + q.y * cap, x1: box.x1 + q.x * cap, y1: box.y1 + q.y * cap }) - o0); }
  ok(over <= 1, "while it stands it never covers more of the thing it letters than at its place");
});

group("WIRING", () => {
  const s = src("sfx/sfx.mjs"), t = src("sfx/sfx-table.mjs");
  ok(/DIR\.knockFit\(f\.box, f\.cap, w\.way/.test(s) && /DIR\.knockAt\(w\.way, performance\.now\(\) - w\.t/.test(s), "the seat knocks a word along its way on the word's own start clock");
  ok(/at\.x = base\.x; at\.y = base\.y/.test(s), "a moving place still reads as a point (the seat log)");
  ok(/T\.knocked\(w\) && !oo\.reduced && !oo\.path/.test(s), "no knock on a reduced-motion seat or a rider");
  ok(/shooter\.seen \? DIR\.streamDir/.test(s), "the impacts' stream takes the aim only on a seat that may see the shooter");
  ok(/dir: DIR\.plumeDeg\(DIR\.windOf\(p\.st\)\)/.test(s), "a burning fire's sparks leave downwind");
  ok(/if \( knocked\(w\) && !w\.flat \) Object\.assign\(o, D\.lookOf\(/.test(t) && /driftOf\(w\)\[0\]/.test(t), "the table gives a word its way's look and a drifter its wind");
  ok(!/pushable: true/.test(s) && /oo\.pushable = false/.test(s), "MAPEDGE stays: a seat's words are not pushable");
});

if ( failed.length ) { console.log(failed.join("\n")); console.log(`sfx-direct: ${failed.length} check(s) failed, ${n} passed`); process.exit(1); }
console.log(`sfx-direct: all groups pass (${n} checks)`);
process.exit(0);
