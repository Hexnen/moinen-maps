// THE SUPERHERO LANDING preset (dev/presets-design.md section 20): the definition, the rays place (rays.mjs), the two accents
// (landing-fx.mjs) and their wiring, the token landing of a point gesture - and that the older presets expand and draw exactly
// as they did at c7babb0 (main when the landing was merged: the baseline tree from git).
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { revTree } from "./lib/baseline.mjs";
import * as C from "../scripts/presets/core.mjs";
import * as A from "../scripts/presets/accents-core.mjs";
import * as L from "../scripts/presets/landing-fx.mjs";
import * as U from "../scripts/presets/ui-core.mjs";
import { raysOf } from "../scripts/presets/rays.mjs";
import { BUILTIN } from "../scripts/presets/defs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0, n = 0;
const ok = (c, m) => { n++; if ( !c ) { fails++; console.log("FAIL", m); } };
const J = JSON.stringify;
const ENV = { grid: 40, rect: { x: 0, y: 0, width: 1536, height: 1024 }, now: 1000 };
const def = BUILTIN.find((d) => d.id === "landing");
const fire = (g, o = {}, env = ENV) => C.expand(def, g, { seed: 5, ...o }, env);

/* A the definition */
{
  const c = C.cleanDef(def);
  ok(c.ok, `A clean (${c.errors.join("; ")})`);
  ok(def.gesture === "point" && def.onToken === true && def.aftermath === null && def.preroll === 1300, "A point, lands on a token, no aftermath fire");
  ok(!def.layers.some((l) => l.l === "fire" || l.l === "smoke" || l.l === "burst" || l.l === "sound"), "A no fire, smoke, burst or sound");
  ok(!def.layers.some((l) => l.l === "cue" && l.flash > 0), "A no flash (nothing burns)");
  ok(BUILTIN.map((d) => d.id).join().startsWith("bomb,grenade,uzi,heliHmg") && BUILTIN.findIndex((d) => d.id === "landing") > 3, "A one new entry after the military four");
  ok(C.ACCENTS.includes("landing") && C.ACCENTS.includes("airRing") && C.PLACES.includes("rays"), "A core knows the kinds and the place");
  ok(A.ACCENT_KINDS.includes("landing") && A.ACCENT_KINDS.includes("airRing"), "A accents-core draws them");
  const wire = fs.readFileSync(path.join(root, "scripts/presets/accents-wire.mjs"), "utf8");
  ok(/"landing", "airRing"/.test(wire), "A the wiring loads the accents layer for them");
  const bad = C.cleanDef({ ...def, layers: [{ l: "fire", id: "x", place: { m: "rays" } }] });
  ok(!bad.ok && bad.errors.some((e) => /rays/.test(e)), "A a rays place outside destruction is an error");
}

/* B the expansion */
{
  const p = fire({ a: [560, 520] });
  const rays = p.destruction.filter((d) => d.key.startsWith("cracks~")), crater = p.destruction.find((d) => d.key === "crater");
  ok(crater && crater.type === "blast" && crater.cause === "impact" && crater.discs.length === 1 && crater.discs[0][3] === 3 && !crater.path, "B one impact crater L3");
  ok(rays.length >= 5 && rays.length <= 7, `B 5-7 rays (${rays.length})`);
  ok(rays.every((d) => d.type === "cracks" && d.cause === "impact" && d.pr?.directional === true && d.at === 50 && d.path?.length >= 2), "B each ray a timed crack stroke");
  ok(rays.every((d) => d.path.every((q, i) => i === 0 || q[2] >= d.path[i - 1][2]) && d.path[0][2] === 0 && d.path.at(-1)[2] >= 380 && d.path.at(-1)[2] <= 560), "B ray paths open outward in 380-560 ms");
  const dist = (q) => Math.hypot(q[0] - 560, q[1] - 520) / 40;
  ok(rays.every((d) => Math.abs(dist(d.path[0]) - 0.45) < 0.05 && dist(d.path.at(-1)) > 1.2 && dist(d.path.at(-1)) < 3.3), "B rays from 0.45 sq out to 1.6-3 sq");
  ok(rays.every((d) => d.discs.every((q) => q[3] === d.discs[0][3]) && [2, 3].includes(d.discs[0][3])), "B a ray is one level, L2 or L3");
  ok(rays.every((d) => d.discs[0][2] > d.discs.at(-1)[2]), "B a ray's band tapers");
  // gaps: never a spoked wheel - not all equal
  const angs = rays.map((d) => Math.atan2(d.path.at(-1)[1] - 520, d.path.at(-1)[0] - 560)).sort((a, b) => a - b);
  const gaps = angs.map((a, i) => (i ? a - angs[i - 1] : a + 2 * Math.PI - angs.at(-1)));
  ok(Math.max(...gaps) / Math.min(...gaps) > 1.4, "B uneven gaps between rays");
  ok(J(p) === J(fire({ a: [560, 520] })), "B deterministic");
  ok(J(p) !== J(fire({ a: [560, 520] }, { seed: 6 })), "B a new seed, a new landing");
  ok(C.areaCount(p) <= C.MAX_AREAS, "B within the area cap");
  const dust = p.fire.filter((f) => f.k === "dust");
  ok(dust.length === 1 && dust[0].dk === "shock" && dust[0].lv === 2 && dust[0].o - dust[0].q >= C.SHOCK_HAZE[2] * 1000, "B one shock dust L2 with its haze");
  ok(p.fire.every((f) => f.k === "dust"), "B nothing burns");
  const acc = p.pending.accent, fall = acc.find((a) => a.kind === "landing"), ring = acc.find((a) => a.kind === "airRing");
  ok(fall && fall.at === -1300 && fall.dur === 1300 && fall.tok === false && fall.dir === null && fall.x === 560, "B the approach, no token");
  ok(ring && ring.at === 0 && ring.reach === 2.6 && ring.size === 1, "B the air ring");
  ok(p.pending.cue.length === 1 && p.pending.cue[0].shake === 0.85 && p.pending.cue[0].flash === 0, "B a shake, no flash");
  // power and size
  const strong = fire({ a: [560, 520] }, { power: 1 }), big = fire({ a: [560, 520] }, { size: 2 });
  ok(strong.fire[0].lv === 3 && strong.destruction.filter((d) => d.key.startsWith("cracks~")).every((d) => d.discs[0][3] === 3), "B stronger: heavier cracks and dust");
  const reach = (pl) => Math.max(...pl.destruction.filter((d) => d.path).map((d) => Math.hypot(d.path.at(-1)[0] - 560, d.path.at(-1)[1] - 520)));
  ok(reach(big) > reach(p) * 1.6, "B size 2 doubles the reach");
  // a drag: the rays ahead of the dive run longer than those behind
  let ahead = 0, behind = 0;
  for ( let s = 1; s <= 40; s++ ) {
    const q = C.expand(def, { a: [700, 500], b: [800, 500] }, { seed: s }, ENV);
    for ( const d of q.destruction.filter((x) => x.path) ) { const e = d.path.at(-1), l = Math.hypot(e[0] - 700, e[1] - 500); if ( e[0] > 700 ) ahead += l; else behind += l; }
  }
  ok(ahead > behind * 1.15, "B rays ahead of a drag run longer");
  // at a scene edge the rays are cut, never outside
  const edge = fire({ a: [20, 20] });
  ok(edge.destruction.every((d) => d.discs.every((q) => q[0] >= 0 && q[1] >= 0)), "B no ray past the scene's edge");
  // on a token: the hero is the token
  const tok = fire({ a: [900, 400], from: [900, 400] });
  ok(tok.pending.accent.find((a) => a.kind === "landing").tok === true, "B landing on a token draws no body");
}

/* C raysOf by itself */
{
  const r = C.stream(3, "x");
  const rays = raysOf({ n: [6, 6], d: [2, 2], from: 0.5, w: [0.3, 0.1], ms: [400, 400], fwd: 0, bend: 0 }, { c: [0, 0], sq: 40, dir: null, r, lvOf: () => 2, inRect: null });
  ok(rays.length === 6 && rays.every((y) => Math.abs(Math.hypot(...y.path.at(-1).slice(0, 2)) - 80) < 2 && y.path.at(-1)[2] === 400), "C straight rays reach their length at their time");
  ok(rays.every((y) => y.path.every((q, i) => i === 0 || q[2] > y.path[i - 1][2])), "C times rise");
}

/* D the accents */
{
  const env = { ap: 1, ox: 0, oy: 0, grid: 40, lift: 0.5, squash: 0.8, q: 1, seed: 5 };
  const fall = { kind: "landing", at: -1300, dur: 1300, x: 500, y: 500, dir: null, tok: false }, ring = { kind: "airRing", at: 0, dur: 900, x: 500, y: 500, size: 1, reach: 2.6 };
  ok(J(A.spanOf(fall)) === J([-1300, 0]) && A.spanOf(ring)[0] === 0 && A.spanOf(ring)[1] >= 900, "D spans");
  const px = (F) => F.px.reduce((a, l) => a + l.length / 2, 0), sh = (F) => F.shade[0].length + F.shade[1].length;
  const at = (items, t) => A.draw(items, 0, t, env, A.newFrame());
  ok(sh(at([fall], -950)) > 0 && px(at([fall], -950)) === 0 && sh(at([fall], -1290)) === 0, "D high up: only its shadow");
  const late = at([fall], -150);
  ok(px(late) > 20 && sh(late) > 0, "D coming down: body, streak and shadow");
  ok(late.px[6].length > 0 && late.px[0].length > 0, "D a dark body and a white streak");
  ok(px(at([{ ...fall, tok: true }], -150)) > 0 && at([{ ...fall, tok: true }], -150).px[6].length === 0, "D on a token: no body");
  ok(L.fallAt(fall, 1, env).z === 0 && L.fallAt(fall, 0, env).z === L.FALL_Z * 40, "D it falls from FALL_Z to the ground");
  ok(px(at([fall], 1)) === 0 && sh(at([fall], 1)) === 0, "D gone at the impact");
  // nothing of the fall leaves its column (a straight drop: above the mark, within a few squares across)
  const cols = []; for ( let t = -1300; t < 0; t += 30 ) { const F = at([fall], t); for ( const L2 of F.px ) for ( let i = 0; i < L2.length; i += 2 ) cols.push(L2[i]); }
  ok(cols.every((x) => Math.abs(x - 500) < 40), "D a straight fall stays over the mark");
  const r0 = at([ring], 20), r1 = at([ring], 300), r2 = at([ring], 950);
  ok(px(r0) > 0 && px(r1) > 0 && px(r2) === 0, "D the ring lives and ends");
  // the ring grows outward and stays within its reach (squashed in y)
  const far = (F) => { let m = 0; for ( const L2 of F.px ) for ( let i = 0; i < L2.length; i += 2 ) m = Math.max(m, Math.abs(L2[i] - 500)); return m; };
  ok(far(r1) > far(r0) && far(r1) <= 2.6 * 40 * 1.07 + 2, "D the ring races out within its reach");
  // the ring is broken: on its circle some angles have no pixel
  const F = at([ring], 200), ang = new Set();
  for ( let i = 0; i < F.px[5].length; i += 2 ) ang.add(Math.round(Math.atan2((F.px[5][i + 1] - 500) / 0.8, F.px[5][i] - 500) * 18 / Math.PI));
  ok(ang.size > 10 && ang.size < 36, `D a broken ring (${ang.size} of 36 sectors)`);
  ok(J(at([ring], 200)) === J(at([ring], 200)), "D pure");
}

/* E the token landing of a point gesture */
{
  const tk = { x: 900, y: 400, r: 20 };
  ok(J(U.gestureOf("point", [905, 410], [905, 410], 40, tk)) === J({ a: [900, 400], b: null, from: [900, 400] }), "E a click on the token: its centre");
  ok(J(U.gestureOf("point", [905, 410], [1000, 410], 40, tk)) === J({ a: [900, 400], b: [1000, 410], from: [900, 400] }), "E a drag from the token: its centre, the direction");
  ok(J(U.gestureOf("point", [905, 410], [905, 410], 40, null)) === J({ a: [905, 410], b: null, from: null }), "E no token: the click (the bomb, unchanged)");
  const aim = fs.readFileSync(path.join(root, "scripts/presets/aim.mjs"), "utf8");
  ok(/def\.onToken \? tokenAt\(cursor\) : null/.test(aim) && /\|\| def\.onToken\) \? tokenAt\(at\)/.test(aim), "E the aim passes the token only to an onToken preset");
}

/* F the older presets (main at c7babb0: the four military + the lightning strike; the military four as the presets polish 763e72c
 * re-tuned them - c7babb0 merged into it): the same plans and accent frames */
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-land-"));
  revTree(root, "763e72c", "scripts/presets", tmp);
  const imp = (f) => import(pathToFileURL(path.join(tmp, f)).href);
  const [C0, D0, A0] = await Promise.all([imp("core.mjs"), imp("defs.mjs"), imp("accents-core.mjs")]);
  const g = { point: { a: [600, 500] }, throw: { a: [400, 500], b: [600, 520] }, line: { a: [300, 300], b: [600, 420], from: [280, 290] }, run: { a: [200, 700], b: [900, 600] } };
  let same = true, frames = true;
  for ( const d0 of D0.BUILTIN ) {
    const d1 = BUILTIN.find((d) => d.id === d0.id);
    if ( J(d0) !== J(d1) ) same = false;
    for ( const seed of [1, 7, 42] ) for ( const size of [0.5, 1, 2] ) {
      const p0 = C0.expand(d0, g[d0.gesture], { seed, size }, ENV), p1 = C.expand(d1, g[d1.gesture], { seed, size }, ENV);
      if ( J(p0) !== J(p1) ) same = false;
      const rec = { ...p1, id: "x", f: [] }, env = { ap: 1, ox: 0, oy: 0, grid: 40, lift: 0.5, squash: 0.8, q: 1, seed };
      const i0 = A0.itemsOf(rec), i1 = A.itemsOf(rec);
      for ( let t = -1600; t < 3000; t += 70 ) if ( J(A0.draw(i0, 0, t, env, A0.newFrame())) !== J(A.draw(i1, 0, t, env, A.newFrame())) ) frames = false;
    }
  }
  ok(same, `F the ${D0.BUILTIN.length} older presets: definitions and plans unchanged`);
  ok(frames, "F their accents draw the same frames");
  ok(J(C0.cleanDef(D0.BUILTIN[0])) === J(C.cleanDef(BUILTIN[0])), "F cleanDef of the bomb unchanged");
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(fails ? `${fails}/${n} presets landing checks FAILED` : `${n}/${n} presets landing checks passed`);
if ( fails ) process.exitCode = 1;
