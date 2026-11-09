// The rocket / RPG preset, the pure part (core.mjs rocketFlight, rocket-core.mjs, ui-core shot gesture):   node dev/presets-rocket.test.mjs
//   A. the definition: "rocket" is clean, a `shot` gesture with its pre-roll, the accent "rocket" is a known kind, no sound, no
//      token push, an aftermath duration, a firearm (the shooter block)
//   B. the expander: with a shooter the flight leaves the shooter's edge low, its time grows with the distance; with none it comes
//      from 11 squares out, high, along the drag or a seeded side; deterministic; the other layers do not move with the shooter
//   C. the gesture `shot`: chosen shooter, a drag out of a token, a drag from the ground, a click
//   D. the flight: starts at m, ends at the target on the ground, passage times rise from the launch to 0; uAt inverts timeAt
//   E. the trail / billows / pixels: nothing ahead of the rocket, density dissolves to nothing by the end; no shooter = no billows,
//      no launch flash; the body only in flight; bounded counts; the box holds every trail sample
//   F. wiring: rocket-wire hooks only the presets hook + canvasTearDown; no setting, flag or document write
import * as C from "../scripts/presets/core.mjs";
import * as R from "../scripts/presets/rocket-core.mjs";
import * as U from "../scripts/presets/ui-core.mjs";
import { BUILTIN } from "../scripts/presets/defs.mjs";
import { readFileSync } from "node:fs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const RECT = { x: 0, y: 0, width: 6000, height: 4000 };
const ENV = { grid: 100, rect: RECT, now: 1_800_000_000_000, wind: { dir: 45, speed: 0.4 } };
const accentOf = (plan) => JSON.parse(JSON.stringify(plan)).pending?.accent?.find((a) => a.kind === "rocket");
const others = (plan) => { const p = JSON.parse(JSON.stringify(plan)); delete p.pending.accent; delete p.gesture; delete p.from; delete p.fr; return JSON.stringify(p.pending); };

/* A */
const def = BUILTIN.find((d) => d.id === "rocket");
ok(def, "rocket is a built-in");
const clean = C.cleanDef(def);
ok(clean && !clean.errors?.length, `rocket cleans without errors ${JSON.stringify(clean?.errors)}`);
ok(def.gesture === "shot" && C.GESTURES.includes("shot") && def.preroll >= 1000, "shot gesture, a pre-roll");
ok(C.ACCENTS.includes("rocket"), "the accent rocket is a known kind");
ok(!JSON.stringify(def).match(/sound|push|knock/i), "no sound, nothing pushes tokens");
ok(def.aftermath && def.aftermath.dur > 0, "an aftermath duration");
ok(U.isFirearm(def) && !U.isFirearm(BUILTIN.find((d) => d.id === "grenade")), "a firearm (the shooter block); the grenade is not");

/* B */
const G1 = { a: [1000, 1000], b: [1800, 1300], from: [1000, 1000], fr: 50 };
const p1 = C.expand(def, G1, { seed: 7 }, ENV), p1b = C.expand(def, G1, { seed: 7 }, ENV);
ok(JSON.stringify(p1) === JSON.stringify(p1b), "the plan is deterministic");
const r1 = accentOf(p1);
ok(r1 && r1.shot === true && r1.to[0] === 1800 && r1.to[1] === 1300, `with a shooter: shot, the target is b ${JSON.stringify(r1)}`);
ok(r1 && Math.hypot(r1.m[0] - 1000, r1.m[1] - 1000) > 40 && Math.hypot(r1.m[0] - 1000, r1.m[1] - 1000) < 110, "it leaves the shooter's edge");
ok(r1 && Math.abs(r1.z0 - 0.32 * 100) < 1 && r1.fl >= 280 && r1.fl <= 900, `shoulder height, flight in [280, 900] (${r1?.fl})`);
const near = accentOf(C.expand(def, { ...G1, b: [1300, 1000] }, { seed: 7 }, ENV));
const far = accentOf(C.expand(def, { ...G1, b: [2800, 1000] }, { seed: 7 }, ENV));
ok(near.fl < far.fl, `a long shot flies longer (${near.fl} < ${far.fl})`);
const click = accentOf(C.expand(def, { a: [3000, 2000], b: null, from: null }, { seed: 7 }, ENV));
ok(click && click.shot === false && click.to[0] === 3000 && Math.abs(Math.hypot(click.m[0] - 3000, click.m[1] - 2000) - 1100) < 2, "no shooter: from 11 squares out");
ok(click.z0 > 100 && click.fl >= 800, "no shooter: high and slow enough to be seen");
const click2 = accentOf(C.expand(def, { a: [3000, 2000], b: null, from: null }, { seed: 8 }, ENV));
ok(JSON.stringify(click.m) !== JSON.stringify(click2.m), "no shooter, a click: the side comes from the seed");
const drag = accentOf(C.expand(def, { a: [3000, 1400], b: [3000, 2000], from: null }, { seed: 7 }, ENV));
ok(drag.to[1] === 2000 && Math.abs(drag.m[0] - 3000) < 2 && drag.m[1] < 2000 - 1000, "no shooter, a drag: it comes in from the drag's side");
const pA = C.expand(def, { a: [3000, 2000], b: null, from: null }, { seed: 7 }, ENV);
const pB = C.expand(def, { a: [2000, 2000], b: [3000, 2000], from: [2000, 2000], fr: 50 }, { seed: 7 }, ENV);
ok(others(pA) === others(pB), "the shooter moves nothing but the rocket (the impact layers are the same)");

/* C */
const g = 100;
const sc = U.gestureOf("shot", [500, 500], [500, 500], g, null, { x: 100, y: 100, r: 50 });
ok(sc.from && sc.from[0] === 100 && sc.b[0] === 500 && sc.fr === 50, "a chosen shooter, a click: from the shooter at the click");
const sd = U.gestureOf("shot", [100, 100], [900, 400], g, { x: 100, y: 100, r: 60 }, null);
ok(sd.from && sd.from[0] === 100 && sd.b[0] === 900 && sd.fr === 60, "no shooter chosen, a drag out of a token: it is the shooter");
const sg = U.gestureOf("shot", [100, 100], [900, 400], g, null, null);
ok(!sg.from && sg.a[0] === 100 && sg.b[0] === 900, "a drag from the ground: no shooter, it comes from a's side");
const sk = U.gestureOf("shot", [700, 300], [700, 300], g, null, null);
ok(!sk.from && sk.a[0] === 700 && sk.b === null, "a click: no shooter, the click is the target");

/* D */
for ( const item of [r1, click, drag] ) {
  const F = R.prepare({ ...item, wd: 45, ws: 0.4 }, 7, 100);
  const p0 = R.pointAt(F, 0), pe = R.pointAt(F, 1);
  ok(Math.hypot(p0[0] - item.m[0], p0[1] - item.m[1]) < 1 && Math.abs(p0[2] - item.z0) < 1, "the flight starts at m");
  ok(Math.hypot(pe[0] - item.to[0], pe[1] - item.to[1]) < 1 && Math.abs(pe[2]) < 1e-6, "it ends at the target, on the ground");
  ok([...F.ts].every((v, i) => !i || v > F.ts[i - 1]) && Math.abs(F.ts[0] + item.fl) < 1 && Math.abs(F.ts[R.N - 1]) < 1, "passage times rise from the launch to 0");
  ok([0.1, 0.5, 0.9].every((u) => Math.abs(R.uAt(F, R.timeAt(F, u)) - u) < 1e-6), "uAt inverts timeAt");
  ok(R.uAt(F, -item.fl - 1) === null && R.uAt(F, 1) === null, "not in flight before the launch or after the hit");
}

/* E */
const env = { geo: { ap: 100 / 32, ox: 0, oy: 0, grid: 100 }, lift: 0.5, squash: 0.8, q: 1 };
for ( const [name, item] of [["shot", r1], ["click", click]] ) {
  const F = R.prepare({ ...item, wd: 45, ws: 0.4 }, 7, 100);
  const sp = R.spanOf(item);
  ok(sp[0] <= -item.fl && sp[1] >= R.TRAIL_END, `${name}: the span covers the flight and the trail`);
  const mid = R.trailAt(F, -item.fl / 2, env);
  const midN = mid.n;
  ok(midN > 0 && midN < R.N, `${name}: half way, part of the trail is laid (${midN})`);
  const all = R.trailAt(F, 300, env);
  ok(all.n > midN && all.n <= R.N, `${name}: after the hit the whole trail (${all.n})`);
  let maxD = 0; const late = R.trailAt(F, R.TRAIL_END, env); for ( let i = 0; i < late.n; i++ ) maxD = Math.max(maxD, late.S[4 * i + 3]);
  ok(maxD < 0.02, `${name}: dissolved by the end (${maxD})`);
  const box = R.boxOf(F, item, env);
  let inBox = true;
  for ( const t of [-100, 500, 2000, 4000] ) { const T = R.trailAt(F, t, env); for ( let i = 0; i < T.n; i++ ) { const x = T.S[4 * i], y = T.S[4 * i + 1]; if ( x < box[0] || x > box[2] || y < box[1] || y > box[3] ) inBox = false; } }
  ok(inBox, `${name}: the box holds every trail sample`);
  const B = R.billowsAt(F, item, 200, env);
  ok(item.shot ? B.n > 0 && B.n <= R.MAX_BILLOWS : B.n === 0, `${name}: billows ${item.shot ? "behind the shooter" : "none (no shooter)"} (${B.n})`);
  const count = (P) => P.px.reduce((s, a) => s + a.length / 2, 0);
  const Pl = R.pixelsAt(F, item, -item.fl + 10, env, R.newPix());
  const Pf = R.pixelsAt(F, item, -item.fl / 2, env, R.newPix());
  const Pa = R.pixelsAt(F, item, 2000, env, R.newPix());
  ok(count(Pf) > 0 && Pf.glows.length > 0, `${name}: the rocket and its light in flight`);
  ok(item.shot ? count(Pl) > count(R.pixelsAt(F, { ...item, from: null }, -item.fl + 10, env, R.newPix())) : true, `${name}: the launch flash with a shooter`);
  ok(count(Pa) < count(Pf), `${name}: no body after the hit`);
  const Pz = R.pixelsAt(F, item, R.spanOf(item)[1] + 1, env, R.newPix());
  ok(!Pz.live && count(Pz) === 0, `${name}: nothing after the span`);
}

/* F */
{
  const wire = readFileSync(new URL("../scripts/presets/rocket-wire.mjs", import.meta.url), "utf8");
  const ren = readFileSync(new URL("../scripts/presets/rocket.mjs", import.meta.url), "utf8");
  const hooks = [...wire.matchAll(/Hooks\.(on|once)\(\s*([^,]+),/g)].map((m) => m[2].trim());
  ok(hooks.length && hooks.every((h) => /HOOK|canvasTearDown|moinenMapsPresets/.test(h)), `the wire hooks only the presets hook and canvasTearDown: ${hooks}`);
  ok(!/settings\.register|setFlag|\.update\(/.test(wire + ren), "no setting, flag or document write");
}

console.log(`${n - fails}/${n} ok`);
if ( fails ) process.exit(1);
