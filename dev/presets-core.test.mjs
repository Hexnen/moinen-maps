// Destruction presets, the pure part (scripts/presets/core.mjs, defs.mjs):   node dev/presets-core.test.mjs
//   A. definitions: the built-ins are clean; junk is named and made safe; versions, kinds, places, the walk and the aftermath checked
//   B. determinism: the same firing gives the same plan; another seed another one; a layer's randomness is its own stream
//   C. bounds: nothing is placed outside the scene (any gesture, any seed, a corner of the map)
//   D. areas: a gun firing never makes more than MAX_AREAS separate damage areas, never more hits than its walk allows
//   E. time: T0 = now + pre-roll; fire / smoke catch at their moment; the aftermath ends after the preset's duration (each fire its
//      share), never with "no end"; transient smoke always ends; a firing's own aftermath overrides and is clamped
//   F. size and power: radii scale with size, levels shift with power and stay 1..3
//   G. the walk: in time order within the burst, two lanes on both sides of the line, the spread widens along the burst, a click
//      is a short burst round the point, the path is not straight (sway)
//   H. the user's answers (design note section 10): no sound, no helicopter shadow, nothing pushes tokens, aftermath = duration | no end
//   I. records the layers take: fire / smoke records pass the fire layer's own cleaning unchanged; destruction records have known
//      kinds and causes, discs with levels 1..3, own looks of known keys, a timed path for the guns
//   J. "unused = unchanged": the API file registers nothing (no hook, setting, ticker, flag); the brush's entry changes only for a
//      stroke that brings an id / pr / keepPath (scripts/destruction/destruction.mjs edited)
import * as C from "../scripts/presets/core.mjs";
import { BUILTIN } from "../scripts/presets/defs.mjs";
import * as FM from "../scripts/fire/model.mjs";
import { PIN_KEYS } from "../scripts/destruction/stroke-params.mjs";
import { readFileSync } from "node:fs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const RECT = { x: 0, y: 0, width: 3000, height: 2000 };
const ENV = { grid: 100, rect: RECT, now: 1_800_000_000_000, wind: { dir: 45, speed: 0.4 } };
const get = (id) => BUILTIN.find((d) => d.id === id);
const G = { point: { a: [1500, 1000] }, throw: { a: [1000, 1000], b: [1500, 1100] }, line: { a: [1000, 900], b: [1800, 1100] }, run: { a: [600, 1000], b: [2400, 1000] } };
const fireAt = (d, seed = 7, opts = {}, g = G[d.gesture], env = ENV) => C.expand(d, g, { seed, ...opts }, env);

/* A */
for ( const d of BUILTIN ) { const c = C.cleanDef(d); ok(c.ok, `A built-in ${d.id} clean (${c.errors.join("; ")})`); }
ok(BUILTIN.map((d) => d.id).join() === "bomb,grenade,uzi,heliHmg,lightning,landing", "A the built-ins in order (the four military, the lightning strike, the superhero landing)");
{
  const c = C.cleanDef({ id: "x y", v: 2, gesture: "laser", layers: [{ l: "sound", id: "s" }, { l: "destruction", type: "meteor", cause: "x", r: 99 }, { l: "fire", aftermath: true }] });
  ok(!c.ok && c.def, "A junk: named, still a safe definition");
  for ( const w of ["bad id", "unknown version", "unknown gesture", 'unknown kind "sound"', 'unknown type "meteor"', 'unknown cause "x"', "aftermath layer in a preset without aftermath"] )
    ok(c.errors.some((e) => e.includes(w)), `A error named: ${w}`);
  ok(c.def.layers.length === 2 && c.def.layers[0].r[1] === C.LIMITS.r[1], "A unknown layer dropped, radius clamped");
  ok(C.cleanDef(null).ok === false && C.cleanDef(null).def === null, "A null");
  const w = C.cleanDef({ id: "w", gesture: "point", layers: [{ l: "destruction", type: "cracks", place: { m: "walk" } }] });
  ok(w.errors.some((e) => e.includes("walk place without")), "A a walk without a gun gesture");
  const nw = C.cleanDef({ id: "w", gesture: "line", layers: [] });
  ok(nw.errors.some((e) => e.includes("without a walk")) && nw.def.walk, "A a gun without a walk gets the defaults");
  const dup = C.cleanDef({ id: "w", gesture: "point", layers: [{ l: "cue", id: "a", kind: "screen" }, { l: "cue", id: "a", kind: "light" }] });
  ok(dup.errors.some((e) => e.includes("twice")), "A layer ids unique");
  let threw = false; try { C.expand({ id: "bad", gesture: "laser", layers: [] }, G.point, {}, ENV); } catch { threw = true; }
  ok(threw, "A expand refuses a definition with errors");
  threw = false; try { C.expand(get("bomb"), { a: null }, {}, ENV); } catch { threw = true; }
  ok(threw, "A expand needs a point");
}

/* B */
for ( const d of BUILTIN ) {
  const p1 = fireAt(d), p2 = fireAt(d), p3 = fireAt(d, 8);
  ok(JSON.stringify(p1) === JSON.stringify(p2), `B ${d.id} same firing, same plan`);
  ok(JSON.stringify(p1) !== JSON.stringify(p3), `B ${d.id} another seed, another plan`);
  ok(JSON.stringify(JSON.parse(JSON.stringify(p1))) === JSON.stringify(p1), `B ${d.id} plan survives JSON (a flag)`);
}
{
  const d = get("bomb"), more = { ...d, layers: [{ l: "cue", id: "extra", kind: "screen" }, ...d.layers] };
  const a = fireAt(d), b = fireAt(more);
  ok(JSON.stringify(a.destruction) === JSON.stringify(b.destruction) && JSON.stringify(a.fire) === JSON.stringify(b.fire), "B a new layer moves no other layer's randomness");
}

/* C */
{
  let out = 0, total = 0;
  const inside = (x, y) => x >= RECT.x && y >= RECT.y && x < RECT.x + RECT.width && y < RECT.y + RECT.height;
  for ( const d of BUILTIN ) for ( let s = 0; s < 60; s++ ) {
    const corner = s % 3 === 0;
    const g = corner ? { a: [20, 20], b: d.gesture === "point" ? null : [400, 60] } : G[d.gesture];
    const p = fireAt(d, s, { size: s % 2 ? 2 : 1 }, g);
    for ( const r of p.destruction ) for ( const [x, y] of r.discs ) { total++; if ( !inside(x, y) ) out++; }
    for ( const f of p.fire ) for ( let i = 0; i < f.p.length; i += 2 ) { total++; if ( !inside(f.p[i] + 0.5, f.p[i + 1] + 0.5) && !inside(f.p[i], f.p[i + 1]) ) out++; }
  }
  ok(out === 0 && total > 500, `C nothing outside the scene (${out} of ${total})`);
}

/* D */
for ( const id of ["uzi", "heliHmg", "grenade", "bomb"] ) {
  const d = get(id), cd = C.cleanDef(d).def;
  let worst = 0, hitsMax = 0;
  for ( let s = 0; s < 200; s++ ) {
    const g = d.gesture === "run" || d.gesture === "line" ? { a: [100, 1000], b: [2900, 1000 + (s % 7) * 50] } : G[d.gesture];
    const p = fireAt(d, s, { size: s % 2 ? 2 : 0.5 }, g);
    worst = Math.max(worst, C.areaCount(p));
    if ( p.walk ) hitsMax = Math.max(hitsMax, p.walk.hits.length);
  }
  ok(worst <= C.MAX_AREAS, `D ${id}: at most ${C.MAX_AREAS} damage areas (worst ${worst})`);
  if ( cd.walk ) ok(hitsMax <= cd.walk.maxHits, `D ${id}: hits capped (${hitsMax} <= ${cd.walk.maxHits})`);
}

/* E */
{
  const d = get("bomb"), p = fireAt(d);
  ok(p.t0 === ENV.now + d.preroll, "E T0 = now + pre-roll");
  const col = p.fire.find((f) => f.key.startsWith("column")), rim = p.fire.filter((f) => f.key.startsWith("rim"));
  ok(col && col.k === "smoke" && col.q === p.t0 + 1200 && col.o === col.q + 60000, "E smoke column: catches at T0 + 1.2 s, ends after the aftermath (60 s)");
  ok(rim.length >= 2 && rim.every((f) => f.q >= p.t0 + 900 && f.q <= p.t0 + 1300 && f.o > f.q && f.o - f.q <= 60000 && f.o - f.q >= 30000), "E rim fires: their moment, each its share of the aftermath");
  ok(new Set(rim.map((f) => f.o - f.q)).size === rim.length, "E rim fires die out one by one");
  const none = fireAt(d, 7, { aftermath: null });
  ok(none.aftermath === null && none.fire.every((f) => f.k === "dust" || f.o === undefined), "E no end: no fire or smoke of the aftermath goes out by itself");
  const short = fireAt(d, 7, { aftermath: 1 }), long = fireAt(d, 7, { aftermath: 99999 });
  ok(short.aftermath === C.AFTERMATH.min && long.aftermath === C.AFTERMATH.max, "E the firing's aftermath clamped");
  ok(fireAt(d, 7, { aftermath: 30 }).fire.every((f) => f.k === "dust" || f.o - f.q <= 30000), "E the firing's aftermath overrides the preset's");
  const g = fireAt(get("grenade"), 3, { aftermath: null }), wisps = g.fire.find((f) => f.key.startsWith("wisps"));
  ok(wisps && wisps.o - wisps.q === 8000, "E transient smoke ends even with no-end aftermath");
  ok(p.fire.every((f) => f.q - ENV.now < 5000), "E every moment within the shared clock's future slack (5 s)");
  ok(fireAt(get("uzi")).aftermath === null, "E a preset without aftermath");
}

/* F */
{
  const d = get("grenade"), a = fireAt(d, 5, { size: 1 }), b = fireAt(d, 5, { size: 2 });
  const ra = a.destruction.find((r) => r.key === "crater").discs[0][2], rb = b.destruction.find((r) => r.key === "crater").discs[0][2];
  ok(Math.abs(rb - 2 * ra) < 0.2, "F radius scales with size");
  const lv = (p) => p.destruction.find((r) => r.key === "crater").discs[0][3];
  ok(lv(fireAt(d, 5, { power: 1 })) === 3 && lv(fireAt(d, 5, { power: -1 })) === 1 && lv(a) === 2, "F power shifts the level");
  ok(lv(fireAt(get("bomb"), 5, { power: 1 })) === 3, "F level stays at most 3");
  ok(fireAt(d, 5, { size: 9 }).size === 2 && fireAt(d, 5, { power: -7 }).power === -1, "F size and power clamped");
}

/* G */
{
  const d = C.cleanDef(get("heliHmg")).def;
  let early = 0, late = 0, nE = 0, nL = 0, sides = 0, ordered = true, within = true;
  for ( let s = 0; s < 80; s++ ) {
    const w = C.walkHits(d.walk, [0, 0], [1000, 0], { seed: s, grid: 100, size: 1 });
    for ( let i = 1; i < w.hits.length; i++ ) if ( w.hits[i].t < w.hits[i - 1].t ) ordered = false;
    if ( w.hits.some((h) => h.t < 0 || h.t > w.dur) ) within = false;
    const m = [0, 1].map((j) => { const L = w.hits.filter((h) => h.lane === j); return L.reduce((a, h) => a + h.y, 0) / L.length; });
    if ( m[0] < m[1] ) sides++;
  }
  ok(ordered && within, "G hits in time order, within the burst");
  ok(sides >= 72, `G two lanes on both sides of the run (${sides}/80)`);
  const u = C.cleanDef(get("uzi")).def;
  for ( let s = 0; s < 200; s++ ) {
    const w = C.walkHits({ ...u.walk, sway: { amp: 0, wave: 5 }, drift: 0, stray: { p: 0, k: 1 } }, [0, 0], [1000, 0], { seed: s, grid: 100, size: 1 });
    for ( const h of w.hits ) { if ( h.x < 300 ) { early += h.y * h.y; nE++; } else if ( h.x > 700 ) { late += h.y * h.y; nL++; } }
  }
  ok(Math.sqrt(late / nL) > Math.sqrt(early / nE) * 1.3, `G the spread widens along the burst (${Math.sqrt(early / nE).toFixed(1)} -> ${Math.sqrt(late / nL).toFixed(1)} px)`);
  const click = C.walkHits(u.walk, [500, 500], null, { seed: 3, grid: 100, size: 1 });
  ok(click.hits.length === Math.round(u.walk.rate * u.walk.dur[0]) && click.hits.every((h) => Math.hypot(h.x - 500, h.y - 500) < 200), "G a click: a short burst round the point");
  const sw = C.walkHits({ ...u.walk, sigma: [0, 0], stray: { p: 0, k: 1 }, drift: 0 }, [0, 0], [1000, 0], { seed: 9, grid: 100, size: 1 });
  ok(Math.max(...sw.hits.map((h) => Math.abs(h.y))) > 3, "G the path sways (not a ruler line)");
}

/* H */
{
  ok(!C.KINDS.includes("sound") && C.cleanDef({ id: "s", gesture: "point", layers: [{ l: "sound" }] }).errors.length > 0, "H no sound layer");
  ok(!C.ACCENTS.some((a) => /heli|shadow/i.test(a) && a !== "fallShadow"), "H no helicopter shadow accent");
  const src = readFileSync(new URL("../scripts/presets/core.mjs", import.meta.url), "utf8") + readFileSync(new URL("../scripts/presets/defs.mjs", import.meta.url), "utf8")
    + readFileSync(new URL("../scripts/presets/write.mjs", import.meta.url), "utf8");
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok(!/token|knock|carry|push(?!\()/i.test(code(src)), "H nothing pushes tokens (no token code)");
  ok(get("bomb").aftermath.dur > 0 && C.cleanDef({ id: "a", gesture: "point", aftermath: { dur: null }, layers: [] }).def.aftermath.dur === null, "H aftermath: a duration or no end");
  ok(C.AFTERMATH.label && C.AFTERMATH.noEnd && C.AFTERMATH.min < C.AFTERMATH.max, "H aftermath setting described (slider + no end)");
}

/* I */
{
  let fireBad = 0, nF = 0;
  for ( const d of BUILTIN ) for ( let s = 0; s < 20; s++ ) {
    const p = fireAt(d, s, { aftermath: s % 2 ? null : 40 });
    for ( const f of p.fire ) {
      nF++;
      const { key, ...raw } = f, st = FM.cleanStroke({ ...raw, id: "ftest" });
      const own = raw.k === "dust" ? st && st.dk === raw.dk && st.s === raw.s : st && st.sm === raw.sm && st.e === 1;
      if ( !st || !own || st.q !== raw.q || st.o !== raw.o || st.k !== raw.k || (raw.lv && st.lv !== raw.lv) || st.r !== raw.r || st.p.join() !== raw.p.join() ) fireBad++;
    }
    for ( const r of p.destruction ) {
      ok(C.D_TYPES.includes(r.type) && C.D_CAUSES.includes(r.cause) && r.discs.every((q) => q[2] > 0 && q[3] >= 1 && q[3] <= 3), `I ${d.id} destruction record valid`);
      if ( r.pr ) ok(Object.keys(r.pr).every((k) => PIN_KEYS.includes(k)), `I ${d.id} own look of known keys`);
      if ( d.gesture === "line" || d.gesture === "run" ) {
        ok(!r.path || (r.pr?.directional === true && r.path.every((q, i) => i === 0 || q[2] >= r.path[i - 1][2])), `I ${d.id} gun stroke: a timed path that follows the stroke`);
      }
    }
  }
  ok(fireBad === 0 && nF > 100, `I fire / smoke records pass the fire layer's cleaning unchanged (${fireBad} of ${nF})`);
  const b = fireAt(get("bomb"));
  ok(b.pending.burst.length === 1 && b.pending.dust.length === 0 && b.fire.filter((f) => f.k === "dust" && f.dk === "shock").length === 1 && b.pending.cue.length === 2 && b.pending.accent[0].kind === "fallShadow", "I bomb: the parts no layer plays yet are kept as pending (the shock dust is a fire-layer stroke)");
  const h = fireAt(get("heliHmg"));
  const tr = h.pending.accent.find((a) => a.kind === "tracer");
  ok(tr && Math.abs(tr.hits.length - h.walk.hits.length / 4) <= 1, "I heli: every 4th hit a tracer");   // (counted per gun: +-1 with the round count)
  const ln = h.destruction.filter((r) => r.key.startsWith("lanes"));
  ok(ln.some((r) => r.key.startsWith("lanes.0")) && ln.some((r) => r.key.startsWith("lanes.1")) && ln.length <= 2 * Math.ceil((h.walk.dur + 1) / C.RUN_MS),
    "I heli: the damage strokes of each lane (a long burst in runs of RUN_MS)");
}

/* J */
{
  const api = readFileSync(new URL("../scripts/presets/presets.mjs", import.meta.url), "utf8");
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok(!/Hooks\.(on|once)|settings\.register|ticker|\.update\(|setFlag/.test(code(api)), "J the API file registers nothing itself and writes nothing");
  const run = readFileSync(new URL("../scripts/presets/runtime.mjs", import.meta.url), "utf8");
  ok(!/settings\.register|ticker|setFlag/.test(code(run)) && (code(run).match(/Hooks\.on\(/g) ?? []).length === 4 && code(api).includes("Run.registerRuntime()"),
    "J the runtime: four hooks (canvasReady, canvasTearDown, updateScene, userConnected), no setting, ticker or flag");
  ok(/function onCanvasReady\(\) \{\s*reset\(\);\s*const scene = canvas\?\.scene;\s*if \( !recordsOf\(scene\)\.length \) return;/.test(code(run))
    && /const recs = FLAG in f \|\| `-=\$\{FLAG\}` in f;\s*if \( recs \) sync\(scene\);\s*if \( \(recs \|\| FIRE in f \|\| `-=\$\{FIRE\}` in f\) && \(recs \|\| known\.size\) \)/.test(code(run)),
    "J the runtime: nothing happens on a scene without firing records");
  const w = readFileSync(new URL("../scripts/presets/write.mjs", import.meta.url), "utf8");
  ok(!/^\s*Hooks\.(on|once)/m.test(w) && !/settings\.register/.test(w), "J the writer has no top-level hook or setting");
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  ok(main.includes('import "./presets/presets.mjs"') && !main.includes("presets/write.mjs"), "J main imports only the API (the writer is loaded on the first firing)");
  const ds = readFileSync(new URL("../scripts/destruction/destruction.mjs", import.meta.url), "utf8");
  ok(ds.includes('|| stroke.keepPath) && stroke.path?.length > 1') && ds.includes("typeof stroke.id === \"string\" && Model.safeId(stroke.id)") && ds.includes("pr: stroke.pr ? Pin.pinDiff({ ...Pin.PIN_DEFAULTS, ...stroke.pr }) : S.params.pin ? Pin.pinDiff(S.params) : null"),
    "J the brush's entry: the preset fields are opt-in (no id / pr / keepPath = as before)");
}

console.log(`${n - fails}/${n} presets core checks passed`);
process.exit(fails ? 1 : 0);
