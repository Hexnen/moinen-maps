// MAPBURN: the SCORE of a burning fire (scripts/sfx/sfx-burn.mjs) - ADVM r2 item 8: the same three or four words for 20+ s with nothing
// that builds, a standing fire's small hollow word every 5-11 s, dark orange on orange with a soft box behind, unreadable far out.
//   SCORE    pure: a stanza climbs the ladder to its peak and falls, the peaks of an arc grow in rung and size to the roar, no word is
//            lettered twice running, a blaze letters many different words in a minute, a smoulder is scored (rungs 1-3), heat moves
//            the top rung, the same (seed, index, heat) gives the same phrase, another spot of the fire is another voice
//   LOOK     the heat ramp is light and never pink, a painted fire keeps its colour, no glow over the scene's lighting
//   SEAT     the seat's size bounds: far out the roar is FAR_K floors tall and every phrase at least the floor, close in under ROAR_VH
//   ENGINE   on the real engine, called the way sfx.mjs startBurn calls it: every phrase is lettered solid in its own word, size order
//            and colour, a phrase is always up (no gap), the run's ink stays in the block the seat keeps clear (sfx-seat RUN) in both
//            motion types and at every heat, a seat joining late letters the same phrases at the same instants
//   SOURCE   sfx.mjs passes the score, fit "world", the glow rule, and tells a smoulder as a score
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as SEAT from "../scripts/sfx/sfx-seat.mjs";
import * as BURN from "../scripts/sfx/sfx-burn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.__letrRealST = (f) => setImmediate(f);
const { setup } = await import(pathToFileURL(path.join(root, "scripts/letters/testenv.mjs")).href);
const { drawnOf, LEGIBLE_ALPHA } = await import(pathToFileURL(path.join(root, "scripts/letters/check-sustain.mjs")).href);
const { isPink } = await import(pathToFileURL(path.join(root, "scripts/letters/design.mjs")).href);
const SRC = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8");
const TREAT = JSON.parse(SRC.match(/const BURN_TREATMENTS = (\[[^\]]*\])/)[1]);

let n = 0; const failed = [];
const ok = (c, m) => { if ( c ) { n++; if ( process.env.BURN_VERBOSE ) console.log("  ok", m); } else failed.push(m); };
const AT = { x: 2000, y: 1500 };
const E0 = await setup(); const L0 = E0.engine; L0.lookStyle("invincible");
const word = (lang = "en") => (q) => L0.word("fire", { ...q, lang }).text;

/* SCORE */
for ( const [heat, top] of [[0.12, 3], [0.42, 4], [0.72, 5]] ) {
  const sc = BURN.burnScore({ seed: `s|${heat}`, heat: () => heat, word: word() }), ph = BURN.scoreClock(sc, 48);
  ok(ph.every((p) => p.text && p.top === top), `SCORE heat ${heat}: every phrase has a word, the top rung is ${top}`);
  let climbs = true, falls = true, grows = true, sized = true, twice = 0;
  for ( let a = 0; a < 48; a += 12 ) {
    const st = [0, 1, 2].map((s) => ph.slice(a + s * 4, a + s * 4 + 4));
    for ( const q of st ) { if ( !(q[0].rung <= q[1].rung && q[1].rung < q[2].rung) ) climbs = false; if ( !(q[3].rung < q[2].rung) ) falls = false; }
    if ( !(st[0][2].rung <= st[1][2].rung && st[1][2].rung <= st[2][2].rung && st[2][2].rung === top && st[0][2].rung < st[2][2].rung) ) grows = false;
    // (the peaks grow in size unless a long word is lettered smaller to keep the run's width)
    const fit = (p) => BURN.fitScale(p.text.length, top);
    if ( !(st[0][2].scale < st[2][2].scale || st[2][2].scale >= fit(st[2][2]) - 0.002) ) sized = false;
    if ( st[2][2].treat !== BURN.ROAR.treat || st[2][2].ms <= st[1][2].ms ) grows = false;
  }
  for ( let i = 1; i < ph.length; i++ ) if ( ph[i].text === ph[i - 1].text ) twice++;
  ok(climbs && falls, `SCORE heat ${heat}: each stanza rises to its peak and falls back`);
  ok(grows, `SCORE heat ${heat}: the peaks of an arc climb to the top rung ${top}, the last slammed in and held longer`);
  ok(sized, `SCORE heat ${heat}: the roar is lettered bigger than the first peak`);
  ok(twice === 0, `SCORE heat ${heat}: no word lettered twice running (${twice})`);
  const min1 = ph.filter((p) => p.t < 60000), uniq = new Set(min1.map((p) => p.text)).size;
  ok(uniq >= (top === 3 ? 8 : 10), `SCORE heat ${heat}: ${uniq} different words in the first minute (${min1.length} phrases)`);
  ok(ph.every((p) => p.scale <= BURN.topScale(top) + 1e-9 && p.scale * p.text.length * BURN.CHAR <= BURN.WIDE * BURN.topScale(top) + 0.02), `SCORE heat ${heat}: no phrase over the run's size share or its width`);
  const gaps = ph.map((p) => p.ms); ok(Math.min(...gaps) >= 800 && Math.max(...gaps) <= 2000, `SCORE heat ${heat}: phrases every 0.8-2 s (${Math.min(...gaps)}..${Math.max(...gaps)} ms)`);
}
{
  const a = BURN.scoreClock(BURN.burnScore({ seed: "same", heat: (ms) => 0.2 + ms / 60000, word: word() }), 30), b = BURN.scoreClock(BURN.burnScore({ seed: "same", heat: (ms) => 0.2 + ms / 60000, word: word() }), 30);
  ok(JSON.stringify(a) === JSON.stringify(b), "SCORE the same seed and heat give the same phrases (every seat)");
  ok(a[2].top === 3 && a.at(-1).top === 5 && a.every((p, i) => !i || p.top >= a[i - 1].top), `SCORE a fire that grows climbs the ladder (top ${a[2].top} -> ${a.at(-1).top})`);
  const c = BURN.scoreClock(BURN.burnScore({ seed: "other", heat: () => 0.72, word: word() }), 24), d = BURN.scoreClock(BURN.burnScore({ seed: "same2", heat: () => 0.72, word: word() }), 24);
  ok(c.map((p) => p.text).join() !== d.map((p) => p.text).join(), "SCORE another fire letters other words");
  const v0 = BURN.scoreClock(BURN.burnScore({ seed: "v", heat: () => 0.72, word: word(), spot: 0 }), 24), v1 = BURN.scoreClock(BURN.burnScore({ seed: "v", heat: () => 0.72, word: word(), spot: 1 }), 24);
  ok(Math.max(...v1.map((p) => p.rung)) === 4 && Math.max(...v0.map((p) => p.rung)) === 5 && v1[0].pos !== v0[0].pos, "SCORE a fire's second spot is another voice: a rung under the first, not in step with it");
  const pl = BURN.scoreClock(BURN.burnScore({ seed: "pl", heat: () => 0.72, word: word("pl") }), 24);
  ok(pl.every((p) => p.text) && new Set(pl.map((p) => p.text)).size >= 8, "SCORE the Polish ladder letters too");
  const red = BURN.scoreClock(BURN.burnScore({ seed: "r", heat: () => 0.72, word: word(), reduced: true }), 12);
  ok(red.every((p) => p.treat !== "accent"), "SCORE reduced motion: no slam");
  ok(BURN.heatOf(0.12).id === "smoulder" && BURN.heatOf(0.42).id === "fire" && BURN.heatOf(0.72).id === "blaze" && BURN.heatOf(NaN).top === 3, "SCORE the heat classes follow the fire levels 1 / 2 / 3");
}

/* LOOK */
{
  const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const faces = Object.values(BURN.RUNGS).map((r) => r.face);
  ok(faces.every((f) => !isPink(f)), "LOOK no rung's face is pink");
  // (the old face was the engine's fire orange #ff8a1f, luminance 0.42, on orange flames)
  ok(faces.every((f) => lum(f) >= 0.6) && faces.every((f, i) => !i || lum(f) >= lum(faces[i - 1])), `LOOK the heat ramp is light and brightens with the rung (${faces.map((f) => lum(f).toFixed(2)).join(" ")}; the old orange ${lum("#ff8a1f").toFixed(2)})`);
  const own = BURN.burnScore({ seed: "c", heat: () => 0.72, word: word(), colors: ["#3a7bff"] })(2, 0);
  ok(own.colors[0] === "#3a7bff", "LOOK a fire painted in its own colour keeps it");
  ok(BURN.glowFor("overlay") === false && BURN.glowFor("top") === false && BURN.glowFor("ground") === "auto" && BURN.glowFor(undefined) === "auto", "LOOK no glow on the layers over the scene's lighting");
}

/* SEAT */
{
  const capK = 1.271, floorPx = 23.4, vh = 900, table = (900 * BURN.ROAR_REF) / SEAT.refZoom(350, 0);
  const px = (size, z) => size * z * capK;
  const ref = BURN.seatSize(table, { zoom: SEAT.refZoom(350, 0), vh, capK, floorPx });
  ok(Math.abs(ref - table) < 1e-9, "SEAT at the reference zoom the run is lettered at the table's size");
  for ( const z of [0.143, 0.2, 0.1] ) {
    const s = BURN.seatSize(table, { zoom: z, vh, capK, floorPx }), zz = BURN.snapZoom(z);
    ok(Math.abs(px(s, zz) - BURN.FAR_K * floorPx) < 0.01 && px(s, z) >= floorPx * 1.4, `SEAT zoom ${z}: the roar ${px(s, z).toFixed(1)} px tall (the floor ${floorPx})`);
    const fl = BURN.floorScale(s, { zoom: z, capK, floorPx });
    ok(fl <= 1 && px(s * fl, z) >= floorPx - 0.01, `SEAT zoom ${z}: the lowest rung floored at the legibility floor (share ${fl.toFixed(2)})`);
  }
  for ( const z of [1, 1.6, 3] ) { const s = BURN.seatSize(table, { zoom: z, vh, capK, floorPx }); ok(px(s, z) <= BURN.ROAR_VH * vh * 1.1, `SEAT zoom ${z}: the roar ${px(s, z).toFixed(1)} px, under ${BURN.ROAR_VH} of the window`); }
  ok(BURN.seatSize(table, { zoom: 0.5, vh, capK, floorPx }) === BURN.seatSize(table, { zoom: 0.52, vh, capK, floorPx }) && BURN.snapZoom(0.143) === BURN.snapZoom(0.15), "SEAT a wheel notch does not re-seat a run (zoom snapped to quarter octaves)");
  ok(Math.abs(px(BURN.minSize({ zoom: 0.5, capK, floorPx }), 0.5) - floorPx) < 0.01, "SEAT the smallest a run is lettered where its room is short: its roar at the floor");
}

/* ENGINE */
async function run({ size = 60, motion = "smooth", heat = 0.72, ms = 30000, late = 0, seed = "score", spot = 0 }) {
  const E = await setup(); const L = E.engine; L.lookStyle("invincible"); L.motionMode?.(motion);
  if ( late ) await E.tick(late + 137, 33);
  const start = E.now() - late, ts = BURN.topScale(BURN.heatOf(heat).top), k = size * ts;
  const score = BURN.burnScore({ seed, heat: () => heat, word: (q) => L.word("fire", { ...q, lang: "en" }), spot });
  const asked = [];
  const s = L.sustain({ kind: "fire", lang: "en", space: "world", fit: "world", words: (i, t) => { const w = score(i, t); if ( w ) asked[i] = w; return w; }, at: () => AT, seed, size, keepInView: false, treatments: TREAT,
    glow: BURN.glowFor("overlay"), area: 120, level: () => heat, startAt: start, room: () => SEAT.runBox(AT, k), maxWidth: SEAT.RUN.mw * k, layer: "overlay" });
  const seen = new Set(), ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, shots = new Map(), caps = new Map(), cols = new Map();
  let frames = 0, empty = 0, emptyRun = 0, worstGap = 0, glows = 0, hollow = 0;
  for ( let t = 0; t < ms; t += 33 ) {
    await E.tick(33, 33);
    for ( const h of s.handles ) { seen.add(h); for ( const c of h.echoes ?? [] ) seen.add(c); }
    let up = 0;
    for ( const h of seen ) {
      const d = drawnOf(h); if ( !d || d.a < LEGIBLE_ALPHA ) continue;
      up++;
      for ( const p of d.P ) { ext.x0 = Math.min(ext.x0, p.x); ext.x1 = Math.max(ext.x1, p.x); ext.y0 = Math.min(ext.y0, p.y); ext.y1 = Math.max(ext.y1, p.y); }
      if ( h.text && !caps.has(h) ) { caps.set(h, h.size * h.plan.sizeK); cols.set(h, h.opts?.colors?.[0] ?? null); if ( h.glow ) glows++; if ( h.opts?.hollow ) hollow++; }
    }
    if ( t > 1500 ) { frames++; if ( up ) emptyRun = 0; else { empty++; emptyRun += 33; worstGap = Math.max(worstGap, emptyRun); } }
    const age = Math.round((E.now() - start) / 100) * 100;
    if ( age >= 3000 && age <= 6500 && !shots.has(age) ) shots.set(age, s.handles.filter((h) => h.sprite?.visible && (h.sprite.alpha ?? 1) >= LEGIBLE_ALPHA && h.text).map((h) => h.text).sort().join("+"));
  }
  s.stop({ quick: true }); E.restoreWarn?.();
  return { ext, shots, caps, cols, asked, k, frames, empty, worstGap, glows, hollow };
}
for ( const motion of ["smooth", "stepped"] ) for ( const heat of [0.12, 0.42, 0.72] ) {
  const size = 60, r = await run({ size, motion, heat, seed: `score-${motion}-${heat}`, ms: motion === "smooth" ? 45000 : 20000 });
  const B = SEAT.runReserve(AT, r.k, motion), e = r.ext, out = Math.max(B.x0 - e.x0, e.x1 - B.x1, B.y0 - e.y0, e.y1 - B.y1);
  ok(out <= 2, `ENGINE ${motion} heat ${heat}: the run stays inside its block (${((e.x1 - e.x0) / r.k).toFixed(2)} x ${((e.y1 - e.y0) / r.k).toFixed(2)} of its size, up ${((AT.y - e.y0) / r.k).toFixed(2)} down ${((e.y1 - AT.y) / r.k).toFixed(2)}; out by ${out.toFixed(1)} px)`);
  ok(r.worstGap <= 100, `ENGINE ${motion} heat ${heat}: a phrase is always up (longest gap ${r.worstGap} ms, ${r.empty} of ${r.frames} frames empty)`);
  ok(r.glows === 0 && r.hollow === 0, `ENGINE ${motion} heat ${heat}: no glow behind a phrase, none hollow (${r.glows}, ${r.hollow})`);
  if ( motion === "smooth" ) {
    // (each phrase lettered in its own word at its own size: the engine's cap height = the run's size x the phrase's share)
    const by = new Map(); for ( const [h, cap] of r.caps ) if ( !by.has(h.text) ) by.set(h.text, { cap, col: r.cols.get(h) });
    let bad = 0, cnt = 0, badCol = 0;
    for ( const w of r.asked ) { const g = w && by.get(w.text); if ( !g ) continue; cnt++; if ( g.col !== w.colors[0] ) badCol++; }
    const peak = r.asked.filter((w) => w?.pos === 2 && w.stanza === 2).map((w) => by.get(w.text)?.cap).filter(Boolean), low = r.asked.filter((w) => w?.pos === 3 && w.stanza === 0).map((w) => by.get(w.text)?.cap).filter(Boolean);
    if ( !(peak.length && low.length && Math.max(...peak) > Math.max(...low) * 1.25) ) bad++;
    ok(cnt >= 20 && badCol === 0, `ENGINE heat ${heat}: the score's words are the ones lettered, each in its rung's colour (${cnt} phrases, ${badCol} off)`);
    ok(!bad, `ENGINE heat ${heat}: the roar is lettered over 1.25x the embers' size (${peak.map((x) => x.toFixed(0)).join()} vs ${low.map((x) => x.toFixed(0)).join()})`);
    ok(new Set(r.asked.filter(Boolean).map((w) => w.text)).size >= 8, `ENGINE heat ${heat}: ${new Set(r.asked.filter(Boolean).map((w) => w.text)).size} different words in 45 s`);
  }
}
{
  const a = await run({ ms: 7000, seed: "score-late" }), b = await run({ ms: 7000 - 2500, late: 2500, seed: "score-late" });
  let cmp = 0, same = 0, first = "";
  for ( const [age, w] of a.shots ) if ( b.shots.has(age) ) { cmp++; if ( w === b.shots.get(age) ) same++; else if ( !first ) first = `${age} ms "${w}" vs "${b.shots.get(age)}"`; }
  ok(cmp >= 15 && same === cmp && [...a.shots.values()].some((w) => w), `ENGINE a seat joining 2.5 s late letters the same phrases at the same instants (${same}/${cmp}${first ? `; first differing ${first}` : ""})`);
}

/* SOURCE */
ok(/BURN\.burnScore\(\{ seed: `\$\{seed\}\|\$\{i\}`/.test(SRC) && /\.\.\.\(words \? \{ words, fit: "world" \} : \{\}\)/.test(SRC), "SOURCE startBurn passes the fire's score to the engine, sized exactly");
ok(/glow: BURN\.glowFor\(layerOpts\(\)\.layer, "auto"\)/.test(SRC) && !/glow: "auto", reduced: red/.test(SRC), "SOURCE a burning fire's glow follows the layer rule");
ok(/const isLive = live < Math\.min\(caps\.live, C\.CAPS\.high\.live\);/.test(SRC), "SOURCE a smoulder is told as a score (not the quiet mode)");
ok(/mode: "ambient", hollow: false/.test(SRC), "SOURCE the quiet mode's words are solid");

if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-burnscore: ${failed.length} failed, ${n} passed`); process.exit(1); }
console.log(`sfx-burnscore: ${n} checks passed`);
