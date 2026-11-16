// MAPRIDE burn: a burning fire's sustained run on the real engine (scripts/letters, read only), called the way scripts/sfx/sfx.mjs
// startBurn calls it (its treatments, glow, a level function on the run's own clock, `room` as a function, `maxWidth`).
//   CONTAIN  given the room sfx-seat runBox and maxWidth RUN.mw x size, every legible letter of the run stays inside the block the seat
//            keeps clear for it (runReserve: the room + the margin of its motion type), smooth and stepped, two sizes
//   PREV     left without a room (the previous call) the run left the box the map reserved for it (-3.1 .. +1.1 caps round the spot):
//            live it stood on the macro bar and the bomb's pin
//   LATE     two seats, one joining the burning fire 2.5 s late, the map's level function read on the run's clock: the same phrases at
//            the same instants and places
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as SEAT from "../scripts/sfx/sfx-seat.mjs";
import * as BURN from "../scripts/sfx/sfx-burn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.__letrRealST = (f) => setImmediate(f);
const { setup } = await import(pathToFileURL(path.join(root, "scripts/letters/testenv.mjs")).href);
const { drawnOf, LEGIBLE_ALPHA } = await import(pathToFileURL(path.join(root, "scripts/letters/check-sustain.mjs")).href);
const SRC = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8");
const TREAT = JSON.parse(SRC.match(/const BURN_TREATMENTS = (\[[^\]]*\])/)[1].replace(/"/g, '"'));

let n = 0; const failed = [];
const ok = (c, m) => { if ( c ) { n++; if ( process.env.BURN_VERBOSE ) console.log("  ok", m); } else failed.push(m); };
// (a fire's level over its life, as fire/model levelNow: rising, then a slow waver)
const levelAt = (t) => Math.max(0.2, Math.min(1, 0.35 + t / 8000)) * (0.9 + 0.1 * Math.sin(t / 900));
const AT = { x: 2000, y: 1500 };

async function run({ size, motion, room, ms = 10000, late = 0, seed = "burn", scored = true }) {
  const E = await setup(); const L = E.engine; L.lookStyle("invincible"); L.motionMode?.(motion);
  if ( late ) await E.tick(late + 137, 33);
  const start = E.now() - late;
  // (MAPBURN: the map's call is now the fire's score - sfx-burn burnScore passed as `words`, sized exactly (fit "world"), its room and
  // width in the run's size x the share its heat reaches (the blaze's here: its biggest block); the checks below are the same checks on
  // the call the map makes now - before MAPBURN they ran the unscored call, which the map no longer makes)
  const k = size * BURN.topScale(5);
  const score = BURN.burnScore({ seed, heat: (t) => levelAt(t), word: (q) => L.word("fire", { ...q, lang: "en" }) });
  const s = L.sustain({ kind: "fire", lang: "en", space: "world", ...(scored ? { fit: "world", words: (i, t) => score(i, t) } : {}), at: () => AT, seed, size, keepInView: false, treatments: TREAT, glow: "auto", area: 120,
    level: (t) => levelAt(Number.isFinite(t) ? t : E.now() - start), startAt: start,
    ...(room ? { room: () => SEAT.runBox(AT, k), maxWidth: SEAT.RUN.mw * k } : {}) });
  // (`scored: false`: the call before MAPBURN - PREV is about that call)
  const seen = new Set(), ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, shots = new Map();
  for ( let t = 0; t < ms; t += 33 ) {
    await E.tick(33, 33);
    for ( const h of s.handles ) { seen.add(h); for ( const c of h.echoes ?? [] ) seen.add(c); }
    for ( const h of seen ) { const d = drawnOf(h); if ( !d || d.a < LEGIBLE_ALPHA ) continue; for ( const p of d.P ) { ext.x0 = Math.min(ext.x0, p.x); ext.x1 = Math.max(ext.x1, p.x); ext.y0 = Math.min(ext.y0, p.y); ext.y1 = Math.max(ext.y1, p.y); } }
    const age = Math.round((E.now() - start) / 100) * 100;
    if ( age >= 3000 && age <= 6500 && !shots.has(age) ) shots.set(age, s.handles.filter((h) => h.sprite?.visible && (h.sprite.alpha ?? 1) >= LEGIBLE_ALPHA && h.text).map((h) => `${h.text}@${Math.round(h.sprite.position.y - AT.y)}`).sort().join(" "));
  }
  s.stop({ quick: true }); E.restoreWarn?.();
  return { ext, shots };
}

/* CONTAIN + PREV */
for ( const motion of ["smooth", "stepped"] ) for ( const size of [58, 82] ) {
  const r = await run({ size, motion, room: true, seed: `burn-${motion}-${size}` });
  const B = SEAT.runReserve(AT, size, motion), e = r.ext, tol = 2;
  const out = Math.max(B.x0 - e.x0, e.x1 - B.x1, B.y0 - e.y0, e.y1 - B.y1) / size;
  ok(out <= tol / size, `CONTAIN ${motion} ${size}: the run stays inside its block (${((e.x1 - e.x0) / size).toFixed(2)} x ${((e.y1 - e.y0) / size).toFixed(2)} caps, up ${((AT.y - e.y0) / size).toFixed(2)} down ${((e.y1 - AT.y) / size).toFixed(2)}; past the block by ${Math.max(0, out).toFixed(2)} caps)`);
}
{
  const size = 58, r = await run({ size, motion: "smooth", room: false, seed: "burn-prev", scored: false }), em = 1.25 * size, e = r.ext;
  const prevBox = { x0: AT.x - 4.4 * em, x1: AT.x + 4.4 * em, y0: AT.y - 2.5 * em, y1: AT.y + 0.9 * em };
  ok(e.y1 > prevBox.y1 + size || e.y0 < prevBox.y0 - size, `PREV the previous call (no room): the run left the box the map kept for it (down ${((e.y1 - AT.y) / size).toFixed(2)} caps vs ${(0.9 * 1.25).toFixed(2)}, up ${((AT.y - e.y0) / size).toFixed(2)} vs ${(2.5 * 1.25).toFixed(2)})`);
}

/* LATE */
{
  const a = await run({ size: 58, motion: "smooth", room: true, ms: 7000, seed: "burn-late" }), b = await run({ size: 58, motion: "smooth", room: true, ms: 7000 - 2500, late: 2500, seed: "burn-late" });
  // (the same phrases at every instant; their places within 3 px but at a few instants - the run's breath / stretch treatments read
  // a few px apart, and the phrase that was mid-entrance when the late seat joined stands up to ~0.6 cap off for its first instants
  // (engine 1.9.17, noted as an engine request) -, never more than 0.75 cap)
  let cmp = 0, words = 0, same = 0, worst = 0, first = "";
  const yy = (q) => (q.match(/@(-?\d+)/g) ?? []).map((x) => +x.slice(1)), tx = (q) => q.replace(/@-?\d+/g, "");
  for ( const [age, w] of a.shots ) if ( b.shots.has(age) ) {
    cmp++; const w2 = b.shots.get(age); if ( tx(w) === tx(w2) ) words++;
    const d = Math.max(0, ...yy(w).map((y, i) => Math.abs(y - (yy(w2)[i] ?? 1e9)))); worst = Math.max(worst, d);
    if ( tx(w) === tx(w2) && d <= 3 ) same++; else { if ( !first ) first = `${age} ms "${w}" vs "${w2}"`; if ( process.env.BURN_VERBOSE ) console.log("   differ", age, w, "|", w2); }
  }
  ok(cmp >= 15 && words === cmp && same >= cmp - 4 && worst <= 0.75 * 58 && [...a.shots.values()].some((w) => w), `LATE a seat joining 2.5 s late letters the same phrases at the same instants (${words}/${cmp}), at the same places within 3 px at ${same}, at most ${worst} px apart${first ? `; first differing ${first}` : ""}`);
}

/* EPOCH: a fire burning for hours - live, a fire painted two days before never lettered: the engine replays a clocked run's past
   phrases (at most 10 000); sfx.mjs runClock carries the run's clock forward by RUN_EPOCH, and a run clocked a whole epoch ago letters */
{
  const ep = Number(SRC.match(/const RUN_EPOCH = (\d+) \* 60000;/)?.[1]) * 60000;
  ok(/t0 = runClock\(p\), startAt = live && clockOk && Number\.isFinite\(t0\) \? toPerf\(t0\)/.test(SRC) && ep > 0, `EPOCH the live run is clocked by runClock (epoch ${ep / 60000} min)`);
  const E = await setup(); const L = E.engine; L.lookStyle("invincible");
  const start = E.now() - ep + 500;
  const s = L.sustain({ kind: "fire", lang: "en", space: "world", at: () => AT, seed: "burn-epoch", size: 58, keepInView: false, treatments: TREAT, glow: "auto", area: 120, level: () => 0.8, startAt: start, room: () => SEAT.runBox(AT, 58), maxWidth: SEAT.RUN.mw * 58 });
  let seen = 0;
  for ( let t = 0; t < 4000; t += 33 ) { await E.tick(33, 33); if ( s.handles.some((h) => h.sprite?.visible && (h.sprite.alpha ?? 1) >= LEGIBLE_ALPHA) ) seen++; }
  s.stop({ quick: true }); E.restoreWarn?.();
  ok(seen > 30, `EPOCH a run clocked a whole epoch ago letters at once (${seen} frames of 121 with a legible phrase)`);
}

if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-burn: ${failed.length} failed, ${n} passed`); process.exit(1); }
console.log(`sfx-burn: ${n} checks passed`);
