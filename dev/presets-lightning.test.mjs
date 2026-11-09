// The lightning strike preset, the pure part (scripts/presets/lightning-core.mjs, defs.mjs):   node dev/presets-lightning.test.mjs
//   A. the definition: "lightning" is clean, a point gesture with its pre-roll, the accent "strike" is a known kind, no sound, no
//      token push, an aftermath duration
//   B. determinism: the same seed gives the same paths, data and timing; another seed another bolt
//   C. timing: the first stroke at 0, restrikes in order within the level's count, the end after the last stroke's afterglow
//   D. frameAt: nothing before the leader; the leader lands step by step in the last 320 ms; the stroke wipes bottom-up; the
//      afterglow cuts top first; flash and view peak at T0 and fall; the sky flickers before it
//   E. geometry: the channel runs from high above down to the target (z falls to 0 at the end, arrival grows); branches carry
//      arrival times; arcs lie on the ground; the data texture's classes are known, glow pixels sit next to cores, blocks cover
//      every non-empty pixel
//   F. spray / crackle: inside their windows only, above the ground, colours in range
//   G. wiring: lightning-wire registers only on the presets hook + canvasTearDown; the renderer needs no setting / flag
import * as C from "../scripts/presets/core.mjs";
import * as L from "../scripts/presets/lightning-core.mjs";
import { BUILTIN } from "../scripts/presets/defs.mjs";
import { readFileSync } from "node:fs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const RECT = { x: 0, y: 0, width: 3000, height: 2000 };
const ENV = { grid: 100, rect: RECT, now: 1_800_000_000_000, wind: { dir: 45, speed: 0.4 } };

/* A */
const def = BUILTIN.find((d) => d.id === "lightning");
ok(def, "lightning is a built-in");
const clean = C.cleanDef(def);
ok(clean && !clean.errors?.length, `lightning cleans without errors ${JSON.stringify(clean?.errors)}`);
ok(def.gesture === "point" && def.preroll === 1000, "point gesture, 1000 ms pre-roll");
ok(C.ACCENTS.includes(L.KIND), "the accent strike is a known kind");
ok(!JSON.stringify(def).match(/sound|push|knock/i), "no sound, nothing pushes tokens");
ok(def.aftermath && def.aftermath.dur > 0, "an aftermath duration");
const plan = C.expand(def, { a: [1500, 1000] }, { seed: 7 }, ENV);
const plan2 = C.expand(def, { a: [1500, 1000] }, { seed: 7 }, ENV);
ok(JSON.stringify(plan) === JSON.stringify(plan2), "the plan is deterministic");
ok(plan && JSON.stringify(plan).includes("\"strike\""), "the plan carries the strike accent");

/* B */
for ( const lv of [1, 2, 3] ) {
  const a = L.strikeData(7, { lv }), b = L.strikeData(7, { lv }), c = L.strikeData(8, { lv });
  ok(a.W === b.W && a.H === b.H && Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0, `lv${lv}: same seed same data`);
  ok(Buffer.compare(Buffer.from(a.data), Buffer.from(c.data)) !== 0 || a.W !== c.W, `lv${lv}: another seed another bolt`);
  ok(JSON.stringify(L.strikePaths(7, { lv })) === JSON.stringify(L.strikePaths(7, { lv })), `lv${lv}: paths deterministic`);
}

/* C */
for ( let seed = 1; seed < 60; seed++ ) for ( const lv of [1, 2, 3] ) {
  const T = L.timing(seed, lv), [lo, hi] = L.LV[lv].strokes;
  ok(T.strokes[0].t === 0 && T.strokes[0].a === 1, `timing ${seed}/${lv}: first stroke at 0`);
  ok(T.strokes.length >= lo && T.strokes.length <= hi, `timing ${seed}/${lv}: ${T.strokes.length} strokes in [${lo}, ${hi}]`);
  ok(T.strokes.every((s, i) => !i || (s.t > T.strokes[i - 1].t && s.a > 0 && s.a < 1)), `timing ${seed}/${lv}: restrikes in order, weaker`);
  ok(T.end >= T.last + L.AFTER_MS, `timing ${seed}/${lv}: ends after the afterglow`);
}

/* D */
{
  const T = L.timing(7, 2);
  const f0 = L.frameAt(T, -1200);
  ok(f0.lead === -1 && f0.main === 0 && f0.flash === 0 && f0.view === 0, "nothing before the leader");
  const leads = []; for ( let t = -L.LEADER_MS; t < 0; t += 5 ) leads.push(L.frameAt(T, t).lead);
  ok(leads.every((v, i) => !i || v >= leads[i - 1]) && new Set(leads).size <= 41 && new Set(leads).size > 20, "the leader lands step by step");
  ok(L.frameAt(T, 0).wipe === 0 && L.frameAt(T, 13).wipe > 0.4 && L.frameAt(T, 26).wipe === 1, "the stroke wipes in 26 ms");
  ok(L.frameAt(T, 0).flash === 1 && L.frameAt(T, 400).flash < 0.05, "the flash peaks at T0 and falls");
  ok(L.frameAt(T, -760 + 10).flash > 0 && L.frameAt(T, -760 + 10).main === 0, "the sky flickers before the strike");
  ok(L.frameAt(T, T.last + 30).cut === 0 && L.frameAt(T, T.last + 40 + L.AFTER_MS).cut >= 1, "the afterglow cuts after the last stroke");
  ok(L.frameAt(T, L.PLASMA_MS + 10).heat === 0, "the plasma cools");
}

/* E */
for ( const seed of [1, 7, 42] ) for ( const lv of [1, 2, 3] ) {
  const P = L.strikePaths(seed, { lv });
  const m = P.main;
  ok(m[0][2] > L.Z_SQ * 0.8 && Math.abs(m.at(-1)[2]) < 1e-6, `paths ${seed}/${lv}: the channel runs from high above to the ground`);
  ok(Math.hypot(m.at(-1)[0], m.at(-1)[1]) < 0.05, `paths ${seed}/${lv}: it ends on the target`);
  ok(m.every((p, i) => !i || p[3] >= m[i - 1][3] - 1e-9), `paths ${seed}/${lv}: arrival grows down the channel`);
  ok(P.branches.every((b) => b.pts.every((p) => p[3] >= 0 && p[3] <= 1)), `paths ${seed}/${lv}: branches carry arrival times`);
  ok(P.arcs.length && P.arcs.every((a) => a.pts.every((p) => Math.abs(p[2]) < 1e-6)), `paths ${seed}/${lv}: arcs lie on the ground`);
  const D = L.strikeData(seed, { lv });
  const known = new Set(Object.values(L.CLS).filter((c) => c < 16));
  let bad = 0, orphan = 0, inBlock = 0, total = 0;
  const blk = new Set(D.blocks.map(([x, y]) => `${x},${y}`));
  for ( let y = 0; y < D.H; y++ ) for ( let x = 0; x < D.W; x++ ) {
    const o = (y * D.W + x) * 4, g = D.data[o + 1];
    if ( !g ) continue;
    total++;
    const c = g >= 16 ? g - 16 : g;
    if ( !known.has(c) ) bad++;
    if ( g >= 16 && D.data[o + 2] > L.GLOW_CAP ) orphan++;
    if ( blk.has(`${(x / L.BLOCK) | 0},${(y / L.BLOCK) | 0}`) ) inBlock++;
  }
  ok(total > 0 && D.cores > 0, `data ${seed}/${lv}: something drawn`);
  ok(bad === 0, `data ${seed}/${lv}: ${bad} pixels of an unknown class`);
  ok(orphan === 0, `data ${seed}/${lv}: ${orphan} glow pixels beyond the glow reach`);
  ok(inBlock === total, `data ${seed}/${lv}: blocks cover every pixel (${inBlock}/${total})`);
  ok(D.cx >= 0 && D.cx < D.W && D.cy >= 0 && D.cy < D.H, `data ${seed}/${lv}: the target is inside the texture`);
}

/* F */
{
  const T = L.timing(7, 2);
  ok(L.spray(7, T, -10).length === 0 && L.spray(7, T, L.SPRAY_MS + 300).length === 0, "spray only in its window");
  let any = 0;
  for ( let t = 0; t < L.SPRAY_MS; t += 20 ) for ( const p of L.spray(7, T, t) ) { any++; ok(p[2] >= 0 && p[3] >= 0 && p[3] <= 4, "a spray drop above ground, colour in range"); }
  ok(any > 0, "the spray throws drops");
  ok(L.crackle(7, -1100).length === 0 && L.crackle(7, 0).length === 0, "crackle only before the strike");
  let cr = 0;
  for ( let t = L.CRACKLE[0]; t < L.CRACKLE[1]; t += 20 ) for ( const p of L.crackle(7, t) ) { cr++; ok(p[2] >= 0 && p[3] >= 0 && p[3] < L.COL.spark.length, "a crackle spark above ground, colour known"); }
  ok(cr > 0, "the charge crackles");
}

/* G */
{
  const wire = readFileSync(new URL("../scripts/presets/lightning-wire.mjs", import.meta.url), "utf8");
  const ren = readFileSync(new URL("../scripts/presets/lightning.mjs", import.meta.url), "utf8");
  const hooks = [...wire.matchAll(/Hooks\.(on|once)\(\s*([^,]+),/g)].map((m) => m[2].trim());
  ok(hooks.length && hooks.every((h) => /HOOK|canvasTearDown/.test(h)), `the wire hooks only the presets hook and canvasTearDown: ${hooks}`);
  ok(!/settings\.register|setFlag|\.update\(/.test(wire + ren), "no setting, flag or document write");
}

console.log(`${n - fails}/${n} ok`);
if ( fails ) process.exit(1);
