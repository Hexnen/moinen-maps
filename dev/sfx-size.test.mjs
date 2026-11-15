// SFXSIZE: the size sliders of the map's lettering (scripts/sfx/sfx-size.mjs + its wiring in sfx.mjs). Owner, 2026-11-15: destruction,
// fire and weather lettering each get a table setting 0 (none) / 1 (smaller) / 2 (today's size, default) / 3 (bigger), chosen by the GM.
// Each group fails on the build before SFXSIZE (no sfx-size.mjs: the import fails) and names what it holds. Sizes are measured with
// the engine's own size model (scripts/letters/size.mjs, read only).
import assert from "node:assert/strict";
import fs from "node:fs";
import * as SZ from "../scripts/sfx/sfx-size.mjs";
import * as C from "../scripts/sfx/sfx-core.mjs";
import * as P from "../scripts/sfx/sfx-page.mjs";
import * as EV from "../scripts/sfx/sfx-events.mjs";
import * as PC from "../scripts/presets/core.mjs";
import { BUILTIN } from "../scripts/presets/defs.mjs";
import * as MC from "../scripts/presets/meteor-core.mjs";
import { fallAt } from "../scripts/presets/landing-fx.mjs";
import { sizeFor, limits, SIZE } from "../scripts/letters/size.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const failed = [];
const group = (id, fn) => { try { fn(); } catch ( err ) { failed.push(`${id}: ${String(err?.message ?? err).split(/\r?\n/)[0]}`); } };
const src = (p) => fs.readFileSync(new URL(`../scripts/${p}`, import.meta.url), "utf8");
const sfx = src("sfx/sfx.mjs");

/* ---- firing pages of the built-in presets (as dev/sfx-page.test.mjs builds them: the burst a fire-layer stroke with its debris) */
const ENV = { grid: 100, rect: { x: 0, y: 0, width: 6000, height: 4000 }, now: 1_800_000_000_000, wind: { dir: 0, speed: 0.4 } };
const GEST = { point: { a: [3000, 2000] }, throw: { a: [2400, 2000], b: [3000, 2100] }, shot: { a: [2400, 2000], b: [3000, 2200], from: [2400, 2000], fr: 50 }, line: { a: [2400, 1900], b: [3200, 2100] }, run: { a: [1600, 2000], b: [3400, 2000] } };
function pageOf(id, seed = 11) {
  const d = BUILTIN.find((q) => q.id === id); if ( !d ) return null;
  const plan = PC.expand(d, GEST[d.gesture], { seed }, ENV), strokes = new Map(), f = [];
  for ( const r of plan.fire ) { const st = { id: `f-${r.key}`, ...r }; strokes.set(st.id, st); f.push({ id: st.id, key: r.key }); }
  for ( const b of plan.pending.burst ?? [] ) { const st = { id: `f-burst.${b.id}`, k: "burst", p: [b.x, b.y], r: b.r, lv: b.lv, q: Math.round(plan.t0 + (b.at ?? 0)), wd: 0, ws: 0.4 }; strokes.set(st.id, st); f.push({ id: st.id }); }
  const rec = { id: `fid-${id}-${seed}`, preset: id, t0: plan.t0, seed: plan.seed, size: plan.size, power: plan.power, at: plan.at, dir: plan.dir,
    d: plan.destruction.map((r, i) => ({ id: `d${i}`, key: r.key })), f, pending: { ...plan.pending, burst: [] } };
  return P.firingPage(rec, { grid: 100, strokes, wayOf: MC.wayOf, headAt: MC.headAt, fallAt, lift: 0.5 });
}
const PRESETS = BUILTIN.map((d) => d.id);
const pages = PRESETS.flatMap((id) => [11, 23, 97].map((s) => ({ id, s, pg: pageOf(id, s) }))).filter((q) => q.pg?.words?.length);

/* ---- the engine's size model for a ranked map word (sfx.mjs optsOf: size = rankSize(rank, vh / zoom, shrink)) and a cluster word
   (magnitude + area) at a step: the cap height on screen, CSS px. The engine drops a caller's ceiling share (engine.mjs sizeCtx passes
   no ceilK to the size model: pinned in STEPS), so today's word is modelled WITHOUT it; another step is sfx.mjs steppedWorld - today's
   drawn size stepped (smallPx over the legibility floor, bigPx under the loudest ceiling) and drawn unclamped (fit "world") */
const engineOf = (o) => { const q = { ...o }; delete q.ceilK; return q; };
const stepped = (c, base, step) => {
  const s = SZ.stepOf(step), today = sizeFor({ ...c, ...engineOf(base) });
  if ( s === SZ.SIZE_DEFAULT ) return today;
  const px = SZ.steppedPx(today.px, s, { cap: loudCeil(c), floor: SZ.floorPx(c.vh, c.sizeK, SIZE) });
  return sizeFor({ ...c, ...engineOf(base), fit: "world", size: px / ((c.sizeK ?? 1) * c.zoom) });
};
const ranked = (rank, { vh, vw, zoom, sizeK = 1, shrink = 1, mag = 1, aspect = 4 }, step) =>
  stepped({ space: "world", grid: 100, zoom, vw, vh, sizeK, aspect }, { size: EV.rankSize(rank, vh / zoom, shrink), ceilK: 1, magnitude: mag }, step);
/** sfx.mjs loudCap: the engine asked for a far too big word of magnitude LOUD_MAG, held at its hard stop over its ceiling */
const loudCeil = (c) => sizeFor({ ...c, fit: "legible", size: (20 * c.vh) / (c.space === "world" ? c.zoom : 1), scale: 1, magnitude: SZ.LOUD_MAG }).px / SIZE.hardHi;
const clustered = (role, { vh, vw, zoom, sizeK = 1, mag, area }, step) =>
  stepped({ space: "world", grid: 100, zoom, vw, vh, sizeK, aspect: 4 }, { magnitude: mag, area, ceilK: C.CEIL_K[role] }, step);
const SCREENS = [[1366, 600], [1366, 768], [1600, 900], [1920, 1080], [2560, 1440]];
const ZOOMS = [0.25, 0.5, 1, 2, 3];

// GROUPS: every map sound belongs to one group - fire is the burning (catch, flare, out, douse, a page's catch and hisses), weather the
// storm's flashes (a story of its own), everything else destruction (damage, blasts, guns, debris, dust, ploughs, Detonate)
group("GROUPS", () => {
  ok(JSON.stringify(SZ.SIZE_GROUPS) === '["destruction","fire","weather"]', "three groups");
  for ( const v of Object.keys(C.VOICES) ) ok(SZ.groupOfVoice(v) === (/^(fire|flare|out|douse)$/.test(v) ? "fire" : "destruction"), `voice ${v} -> ${SZ.groupOfVoice(v)}`);
  ok(pages.length >= 10, `pages of the built-in presets: ${pages.length}`);
  for ( const { id, pg } of pages ) for ( const w of pg.words ) {
    const g = SZ.groupOfPageWord(w);
    ok(g === (w.role === "catch" || w.role === "out" ? "fire" : "destruction"), `${id} ${w.key} -> ${g}`);
  }
  ok(SZ.groupOfPageWord({ role: "main" }, "weather") === "weather", "a storm's flash story is weather");
  ok(/storyPage\(`flash\|\$\{id\}`[^\n]*, null, "weather"\);/.test(sfx), "sfx.mjs tells the storm's flash as a weather story");
});

// STEPS: the setting's values and today's size; step 2 passes the play options through UNTOUCHED (the same object), so a word at the
// default is today's word to the byte: its plan, size and placement
group("STEPS", () => {
  ok(SZ.SIZE_DEFAULT === 2 && SZ.STEP_K[2] === 1 && SZ.STEP_K[0] === 0, "2 is today's size");
  ok(SZ.STEP_K[1] < 0.8 && SZ.STEP_K[1] >= 0.6 && SZ.STEP_K[3] >= 1.25 && SZ.STEP_K[3] <= 1.5, `1 clearly smaller, 3 clearly bigger: ${SZ.STEP_K}`);
  for ( const [v, s] of [[undefined, 2], [null, 2], ["", 2], ["x", 2], [0, 0], [1, 1], [2, 2], [3, 3], ["3", 3], [7, 3], [-1, 0], [1.4, 1]] ) ok(SZ.stepOf(v) === s, `stepOf(${v}) = ${s}`);
  const samples = [{ magnitude: 0.8, area: 120, ceilK: 0.6 }, { size: 44, ceilK: 1 }, { scale: 0.7, size: 30 }, {}, { magnitude: 1.4, area: 400, ceilK: 0.38, path: { points: [] } }];
  for ( const o of samples ) { const j = JSON.stringify(o); ok(SZ.sizeOpts(o, 2) === o && JSON.stringify(o) === j, "step 2: the same options object, unchanged"); }
  ok(SZ.sizeAt(37.5, 2) === 37.5 && SZ.screenSizeAt(81, 2, 900) === 81 && Object.keys(SZ.streamOpts(55, 2)).length === 0, "step 2: sizes and streams untouched");
  for ( const o of samples ) for ( const s of [1, 3] ) { const q = SZ.sizeOpts(o, s); ok(q !== o && q.scale === (o.scale ?? 1) * SZ.STEP_K[s], `step ${s} scales the natural size`); }
  ok(SZ.ceilAt(0.6, 1) < 0.6 && SZ.ceilAt(0.6, 3) > 0.6 && SZ.ceilAt(1, 3) === 1 && SZ.ceilAt(0.38, 3) <= 1, "the ceiling share steps too, never past the engine's whole ceiling");
  // (the engine drops a caller's ceiling share: its size context has no ceilK - why sfx.mjs steps a word from its drawn size; if the
  // engine starts to honour it, revisit steppedWorld; LETR 1.9.11 honours only the new option `ceil`, the map's `ceilK` stays unread)
  const ctxSrc = src("letters/engine.mjs").match(/function sizeCtx\(h\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  ok(ctxSrc.length > 100 && !ctxSrc.includes("opts.ceilK"), "the engine's size context carries no caller's ceilK");
  // (the stream's numbers mirror the engine's stream(): its syllable unit and ceiling share)
  const eng = src("letters/engine.mjs");
  ok(eng.includes(`sizeFor(c).natural * ${SZ.STREAM_UNIT};`) && eng.includes(`ceilK: o.ceilK ?? ${SZ.STREAM_CEIL}`), "STREAM_UNIT / STREAM_CEIL are the engine's stream numbers");
});

// SIZES (engine size model): at every screen and zoom a ranked story word and a cluster word step clearly down at 1 and up at 3,
// 1 stays readable (on or a hair under the engine's legibility floor, never below its hard stop), 3 never goes past the engine's whole
// ceiling (it cannot bury the scene), and inside one step the story's rank order holds (a lower rank never draws bigger)
group("SIZES", () => {
  let down = 0, up = 0, cases = 0;
  for ( const [vw, vh] of SCREENS ) for ( const zoom of ZOOMS ) for ( const sizeK of [0.62, 1, 1.32] ) for ( const shrink of [0.75, 1] ) {
    const ctx = { vw, vh, zoom, sizeK, shrink };
    for ( let r = 1; r <= 5; r++ ) {
      cases++;
      const mag = P.RANK_MAG[r], a = ranked(r, { ...ctx, mag }, 1).px, b = ranked(r, { ...ctx, mag }, 2).px, c = ranked(r, { ...ctx, mag }, 3).px;
      const L = limits({ space: "world", vh, vw, magnitude: mag, sizeK, aspect: 4, ceilK: 1 });
      // (bigger at 3 unless today's word already stands at the engine's ceiling for its loudest word: then it holds)
      const held3 = b >= loudCeil({ space: "world", grid: 100, zoom, vw, vh, sizeK, aspect: 4 }) * SZ.LOUD_K * 0.999;
      const held1 = b <= SZ.floorPx(vh, sizeK, SIZE) + 1e-6;   // (today's word already on or under the floor: it holds there)
      ok((a < b || (held1 && a <= b + 1e-6)) && (b < c || (held3 && c >= b - 1e-6)), `rank ${r} at ${vw}x${vh} zoom ${zoom} k${sizeK}: ${a.toFixed(1)} < ${b.toFixed(1)} < ${c.toFixed(1)}${held3 ? " (held)" : ""}`);
      // (readable as today's word: on the floor, or a hair under it where today's word is already held there; never past the hard stop)
      ok(a >= Math.min(L.floor, b) * 0.95 && a >= L.floor * SIZE.hardLo - 1e-6, `rank ${r} step 1 readable: ${a.toFixed(1)} px vs floor ${L.floor.toFixed(1)} (today ${b.toFixed(1)})`);
      // (3 never past LOUD_K x the engine's ceiling for its LOUDEST word: 19 % of the view height, 65 % of the usable width - or today's
      // size where today's already stands above it)
      const LL = limits({ space: "world", vh, vw, magnitude: SZ.LOUD_MAG, sizeK, aspect: 4, ceilK: 1 });
      ok(c <= Math.max(b, LL.ceil * SZ.LOUD_K) + 1e-6 && (c <= b + 1e-6 || (c <= 0.19 * SZ.LOUD_K * vh + 1e-6 && c * 4 <= 0.65 * SZ.LOUD_K * vw + 1e-6)), `rank ${r} step 3 under ${SZ.LOUD_K} x the engine's loudest ceiling: ${c.toFixed(1)} vs ${LL.ceil.toFixed(1)} (today ${b.toFixed(1)})`);
      ok(c <= b * SZ.STEP_K[3] + 1e-6, `rank ${r} step 3 at most ${SZ.STEP_K[3]} x today`);
      if ( a / b <= 0.8 ) down++;
      if ( c / b >= 1.2 ) up++;
      if ( r < 5 ) for ( const s of [1, 2, 3] ) {
        const lo = ranked(r, { ...ctx, mag }, s).px, hi = ranked(r + 1, { ...ctx, mag: P.RANK_MAG[r + 1] }, s).px;
        ok(lo <= hi + 1e-6, `step ${s}: rank ${r} (${lo.toFixed(1)}) never bigger than rank ${r + 1} (${hi.toFixed(1)})`);
      }
    }
    for ( const [role, mag, area] of [["main", 1.4, 500], ["main", 0.6, 120], ["sec", 0.4, 80], ["pre", 0.3, 60]] ) {
      const L = limits({ space: "world", vh, vw, magnitude: mag, sizeK, aspect: 4, ceilK: 1 });
      const a = clustered(role, { ...ctx, mag, area }, 1).px, b = clustered(role, { ...ctx, mag, area }, 2).px, c = clustered(role, { ...ctx, mag, area }, 3).px;
      const LL = loudCeil({ space: "world", grid: 100, zoom, vw, vh, sizeK, aspect: 4 }) * SZ.LOUD_K, fl = SZ.floorPx(vh, sizeK, SIZE);
      ok((a < b || (b <= fl + 1e-6 && a <= b + 1e-6)) && (b < c || (b >= LL * 0.999 && c >= b - 1e-6)) && c <= Math.max(b, LL) + 1e-6,
        `cluster ${role} m${mag}: ${a.toFixed(1)} < ${b.toFixed(1)} < ${c.toFixed(1)} <= ${LL.toFixed(1)}`);
      ok(a >= L.floor * SIZE.hardLo - 1e-6, `cluster ${role} step 1 never under the engine's hard stop`);
    }
  }
  console.log(`  sizes: clearly smaller at 1 in ${(100 * down / cases).toFixed(0)} %, clearly bigger at 3 in ${(100 * up / cases).toFixed(0)} % of ${cases} ranked cases`);
  ok(down / cases > 0.85 && up / cases > 0.75,`clearly smaller at 1 in ${(100 * down / cases).toFixed(0)} %, clearly bigger at 3 in ${(100 * up / cases).toFixed(0)} % of ${cases} cases`);
  // a ranked word shown on the screen (unclamped by the engine): stepped, at 3 held under the engine's loudest ceiling for its text -
  // a long thunder word (aspect 9) never wider than 65 % of the usable width (live 2026-11-15: it ran off both sides)
  for ( const [vw, vh] of SCREENS ) for ( const aspect of [3, 6, 9] ) for ( const sizeK of [0.85, 1, 1.32] ) for ( let r = 1; r <= 5; r++ ) {
    const cap = loudCeil({ space: "screen", vw, vh, sizeK, aspect });
    const s2 = EV.rankSize(r, vh), s1 = SZ.screenSizeAt(s2, 1), s3 = SZ.screenSizeAt(s2, 3, cap, sizeK);
    const px3 = s3 * sizeK, px2 = s2 * sizeK;
    ok(s1 < s2 && s3 >= s2 && s1 >= vh * SIZE.floorVh * 0.95, `screen rank ${r} at ${vw}x${vh} a${aspect}: ${s1.toFixed(1)} / ${s2.toFixed(1)} / ${s3.toFixed(1)}`);
    ok(px3 <= px2 + 1e-6 || (px3 <= 0.19 * vh + 1e-6 && px3 * aspect <= 0.65 * vw + 1e-6), `screen rank ${r} at ${vw}x${vh} a${aspect} k${sizeK} step 3 inside the loudest ceiling: ${px3.toFixed(1)} px`);
  }
});

// PLACEMENT: the placement measures the stepped word; across subjects in the middle, at an edge and in a corner of the view, at the
// sizes that occur on a map, a bigger main word still sits inside the view and off what it letters wherever today's word does; a
// satellite that finds no free spot is dropped, never laid over another word
group("PLACEMENT", () => {
  const v = { x0: 0, y0: 0, x1: 1600, y1: 900 };
  let both = 0, held = 0;
  for ( const [cx, cy] of [[800, 450], [200, 450], [1450, 450], [800, 120], [800, 800], [150, 120], [1480, 820]] ) for ( const R of [60, 140, 260] ) for ( const u of [30, 55, 90] ) {
    const S = { x0: cx - R, y0: cy - R, x1: cx + R, y1: cy + R };
    const res = [1, 2, 3].map((s) => {
      const k = SZ.STEP_K[s], w = { role: "main", text: "KA-BOOM!", chars: 8, x: cx, y: cy, t: 0, size: u * k, bw: u * k * 7, bh: u * k * 1.6, subject: S, cover: 0.3, around: C.besideOf(1) };
      const sat = { role: "sec", text: "KRAK", chars: 4, x: cx + R, y: cy + R * 0.5, t: 100, size: u * k * 0.6, bw: u * k * 0.6 * 4, bh: u * k * 0.6 * 1.6, subject: null };
      return C.place([w, sat], { view: v, ui: [{ x0: 1500, y0: 0, x1: 1600, y1: 900 }], tokens: [], alive: [] });
    });
    const m = res.map((r) => r.find((q) => q.role === "main"));
    // (a satellite kept never lies on the main word)
    for ( const r of res ) { const a = r.find((q) => q.role === "main")?.box, b = r.find((q) => q.role === "sec")?.box;
      if ( a && b ) ok(Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) <= 0.05 * (b.x1 - b.x0) * (b.y1 - b.y0) + 1e-6, "a satellite stays off the main word"); }
    if ( !m[1] || m[1].pen.off > 1e-9 || m[1].pen.sub > 1e-9 || m[1].pen.pui > 1e-9 ) continue;
    both++;
    for ( const s of [0, 2] ) ok(m[s] && m[s].pen.off <= 1e-9, `step ${s + 1}: the main word stays in view (${cx},${cy} R${R} u${u})`);
    // (the same placement rules at every step: a word touches its subject's edge by a share of its OWN height and may cover its voice's
    // allowance of it, so a much bigger word next to a small subject may lie a little further over it - never more than a tenth of the
    // subject beyond the allowance, never under a panel)
    ok(m[2] && m[2].pen.pui <= 1e-9 && m[2].pen.sub <= 0.1, `step 3: the bigger main word stays off the panels and mostly off its subject (${cx},${cy} R${R} u${u}: ${m[2]?.pen.sub.toFixed(3)})`);
    if ( m[2] && m[2].pen.sub <= 1e-9 && m[2].pen.pui <= 1e-9 ) held++;
    else if ( process.env.SFXSIZE_VERBOSE ) console.log("step 3 not free:", cx, cy, R, u, JSON.stringify(m[2]?.pen));
    // (the placement may let a small word lie a little over its subject rather than stand far from it - its cover allowance plus a
    // share: the trade-off today's placement makes for any word of that size)
    ok(m[0] && m[0].pen.off <= 1e-9 && m[0].pen.sub <= 0.1, `step 1: the smaller main word stays in view and mostly off its subject (${cx},${cy} R${R} u${u})`);
  }
  ok(both >= 30, `scenarios where today's word sits free: ${both}`);
  ok(held / both >= 0.7, `the bigger word stays wholly within its subject allowance in ${held} of ${both}`);
});

// ZERO and LIVE (wiring in sfx.mjs): a group at 0 letters nothing and schedules nothing; every size is a WORLD setting of the GM's (the
// window's slider 0..3, default 2), applied live (onChange) on every seat; the step reaches every way a word is drawn
group("WIRING", () => {
  ok(/for \( const g of SZ\.SIZE_GROUPS \) game\.settings\.register\(MODULE_ID, SZ\.SIZE_SETTING\[g\], \{[\s\S]{0,120}?scope: "world", config: true,\s*restricted: true, type: Number, default: SZ\.SIZE_DEFAULT, range: \{ min: 0, max: 3, step: 1 \}, onChange: \(\) => sizeChanged\(g\) \}\);/.test(sfx),
    "three world settings, the GM's, slider 0..3, default 2, live");
  ok(!/scope: "client"[^\n]*sfxSize/.test(sfx) && !/sfxSize\w*", \{[^}]*scope: "client"/.test(sfx), "no client setting for the sizes");
  ok(/if \( stepFor\(SZ\.groupOfVoice\(e\.voice\)\) === 0 \) return;/.test(sfx), "an event of a group at 0 is not even scheduled");
  ok(/if \( stepFor\(SZ\.groupOfPageWord\(w\)\) === 0 \) continue;/.test(sfx) && /const grp = SZ\.groupOfPageWord\(w, p\.grp\);\n\s*if \( stepFor\(grp\) === 0 \) return;/.test(sfx), "a page word of a group at 0 is not scheduled, nor played if the GM switched it off meanwhile");
  ok(/stepFor\("weather"\) === 0 \) return again\(2000\)/.test(sfx), "weather at 0: the storm is not even read");
  ok(/const noDestr = mode\(\) === "off" \|\| stepFor\("destruction"\) === 0;\n\s*sfxBus\.entry = noDestr \? null : onEntry;/.test(sfx) && /sfxBus\.detonate = noDestr \? null : onDetonate;/.test(sfx), "destruction at 0: off the display's hooks");
  ok(/canvas\?\.ready && stepFor\("fire"\) > 0;/.test(sfx) && /return SZ\.sizeAt\(Math\.max\(4, px \/ zoom\), stepFor\("fire"\)\);/.test(sfx), "fire at 0: no burning sound; else its size steps");
  ok(/if \( raw \) return o;\n\s*const step = stepFor\(grpOf\(w\)\);/.test(sfx) && /return SZ\.sizeOpts\(o, step\);\n\}/.test(sfx) && /const z = L\.sizeOf\(w\.text, o\);/.test(sfx.slice(sfx.indexOf("function measure"))) && /const o = optsOf\(w\);/.test(sfx.slice(sfx.indexOf("function measure"))),
    "the stepped options are what the word plays AND is measured with (placement sees the stepped size)");
  ok(/o\.size = SZ\.screenSizeAt\(s0, step, /.test(sfx) && /else if \( !Number\.isFinite\(spec\.rank\) \) o = SZ\.sizeOpts\(o, step\);/.test(sfx) && /screenSpot\(bw, bh, spec\.seed\)/.test(sfx), "an unlocated word steps too, its spot found for the stepped box");
  // (THUNDERFIT: the 4th argument is the ladder's share of the extra size, placeFit; 1 = the whole stepped size)
  ok(/if \( step !== SZ\.SIZE_DEFAULT && step !== 0 && w\.text \) \{ const b = steppedWorld\(w\.text, o, step, w\.fitK\); if \( b \) return b; \}/.test(sfx) && /const z = L\?\.sizeOf\?\.\(text, o\);/.test(sfx) && /fit: "world", size: px \//.test(sfx), "a world word at another step is stepped from the size the engine draws it at today (its clamp would hold it)");
  ok((sfx.match(/\.\.\.streamStep\(/g) ?? []).length === 2, "both gun streams step");
  ok(/!canvas\?\.ready \|\| stepFor\(grpOf\(w\)\) === 0 \) return;/.test(sfx) && /mode\(\) === "off" \|\| stepFor\(grp\) === 0 \) return;/.test(sfx), "a word waiting for its moment is dropped when its group went to 0");
  ok(/function sizeChanged\(g\)/.test(sfx) && /if \( g === "fire" \) \{ clearTimeout\(burnTimer\);/.test(sfx), "a changed size restarts the burning at its new size");
  ok(/Hooks\.on\("renderSettingsConfig", \(app, html\) => sizeRowsForPlayer\(app, html\)\);/.test(sfx) && /if \( game\.user\?\.can\?\.\("SETTINGS_MODIFY"\) \) return;/.test(sfx), "a player sees the sizes read-only");
  // (the planners know nothing of the size: the story, its order and its placement rules are the same at every step)
  for ( const f of ["sfx/sfx-core.mjs", "sfx/sfx-page.mjs", "sfx/sfx-events.mjs"] ) ok(!/sfxSize|sfx-size|STEP_K/.test(src(f)), `${f} plans the same page at every step`);
  const lang = (l) => JSON.parse(fs.readFileSync(new URL(`../lang/${l}.json`, import.meta.url), "utf8"));
  for ( const l of ["en", "pl"] ) { const J = lang(l);
    for ( const k of [...SZ.SIZE_GROUPS.flatMap((g) => [`size.${g}`, `size.${g}Hint`]), "size.step0", "size.step1", "size.step2", "size.step3", "size.gmOnly"] ) ok(typeof J[`MOINENMAPS.Sfx.${k}`] === "string" && J[`MOINENMAPS.Sfx.${k}`].length > 2, `${l} ${k}`); }
});

if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-size: ${failed.length} group(s) failed, ${n} checks passed`); process.exit(1); }
console.log(`sfx-size: ${n} checks passed`);
