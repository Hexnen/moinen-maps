// MAPBURN2 burn: a burning fire speaks in LINES (scripts/sfx/sfx-burn.mjs LINE / areasOf / lineOf / rimSpot; scripts/sfx/sfx.mjs
// reconcileBurn / speakDue / letterLine). The owner, 2026-11-16: the fire words were too frequent and too big, they must not hide the
// fire much (a little is fine), and their amount should be bounded per area.
// This file replaces the MAPRIDE checks of the sustained RUN (CONTAIN / PREV / LATE / EPOCH: a run kept in its room, a late seat
// replaying the run's past, the run's clock carried by epochs): there is no run any more - the ruling took it away -, so those checks
// described nothing the module does. What they guarded is guarded here for lines: a line's ink inside the block the seat keeps for it
// (dev/sfx-burnscore.test.mjs LINE), a late seat lettering the same word (SAME / STORY here, LINE there), a fire painted days ago
// still lettered (STORY: a line's number is counted from shared data, nothing is replayed).
//   RATE    how often an area speaks, against the run it replaces (a phrase every 0.9-1.5 s for EVERY spot): fails if a fire's words
//           come back anywhere near as often
//   AREA    any number of fires in one area: still one line a turn; a map full of fire: any window the size of an area sees at most
//           one line begin in a slot, a reference view at most two; no word outlives its slot's turn
//   SAME    the same voices give the same lines whatever the order of asking (two seats, one late)
//   STORY   a fire begins on its embers and climbs line by line; a fire burning for days is on the same line on every seat
//   RIM     the word stands beside the flames: at most COVER of the fire under it, downwind; before, on the spot
//   SIZE    the roar and the fire's event words against what they were
//   SOURCE  the runtime letters lines (no run), bounded and seated as above
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as SEAT from "../scripts/sfx/sfx-seat.mjs";
import * as BURN from "../scripts/sfx/sfx-burn.mjs";
import * as C from "../scripts/sfx/sfx-core.mjs";
import * as EV from "../scripts/sfx/sfx-events.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8"), CORE = fs.readFileSync(path.join(root, "scripts/sfx/sfx-core.mjs"), "utf8");
let n = 0; const failed = [];
const ok = (c, m) => { if ( c ) { n++; if ( process.env.BURN_VERBOSE ) console.log("  ok", m); } else failed.push(m); };

/* what the lines replace (MAPBURN, the state the owner ruled on): a phrase every 0.9-1.5 s for every lettered spot of every fire - at
   least 40 a minute for one spot -, the roar's caps 6.4 % of the reference view, the word on its spot */
const BEFORE = { perMin: 40, roar: 0.064, roarVh: 0.1, catchPx: 84 };
const CELL = 2100, MIN10 = 600000, T0 = 1794800000000;
const V = (key, x, y, level, i = 0) => ({ key, i, x, y, level });
const HEATS = [["smoulder", 0.12], ["fire", 0.42], ["blaze", 0.72]];

/* RATE */
for ( const [id, lv] of HEATS ) {
  const ar = BURN.areasOf([V("a", 500, 500, lv)], CELL), ls = BURN.linesIn(ar, T0, T0 + MIN10), per = ls.length / 10;
  ok(per <= BEFORE.perMin / 4 && per >= 2, `RATE a ${id}: ${per.toFixed(1)} lines a minute in its area (the run: ${BEFORE.perMin}+ for every spot)`);
  const gaps = ls.slice(1).map((l, i) => l.t0 - ls[i].t0);
  ok(Math.min(...gaps) >= BURN.TURN_MS, `RATE a ${id}: never two lines of an area within a turn (least gap ${Math.min(...gaps)} ms, a turn ${BURN.TURN_MS})`);
}
{
  const rate = (lv) => BURN.linesIn(BURN.areasOf([V("a", 500, 500, lv)], CELL), T0, T0 + MIN10).length;
  ok(rate(0.12) < rate(0.42) && rate(0.42) < rate(0.72), "RATE a hotter fire speaks more often (a smoulder least)");
  ok(BURN.LINE.slot >= 1500 && BURN.TURN_MS >= 6000, `RATE a slot ${BURN.LINE.slot} ms, a turn ${BURN.TURN_MS} ms`);
}

/* AREA */
{
  let s = 7; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const many = Array.from({ length: 12 }, (_, i) => V(`f${i}`, 100 + rnd() * 1900, 100 + rnd() * 1900, 0.72, 0));
  const one = BURN.linesIn(BURN.areasOf([many[0]], CELL), T0, T0 + MIN10).length, all = BURN.linesIn(BURN.areasOf(many, CELL), T0, T0 + MIN10);
  ok(all.length === one, `AREA twelve fires in one area speak as often as one (${all.length} lines in 10 min, one fire ${one})`);
  ok(new Set(all.map((l) => l.voice.key)).size === BURN.CELL_VOICES && all.filter((l) => l.voice.key === "f0").length > all.length / 2, "AREA an area keeps its first voices: the biggest fire speaks most, the second every third line");
  // a map full of fire: 6 x 4 areas, a blaze in each
  const full = []; for ( let cy = 0; cy < 4; cy++ ) for ( let cx = 0; cx < 6; cx++ ) full.push(V(`g${cx}_${cy}`, cx * CELL + 900, cy * CELL + 900, 0.72));
  const fl = BURN.linesIn(BURN.areasOf(full, CELL), T0, T0 + 120000);
  const bySlot = new Map(); for ( const l of fl ) { const k = l.t0; if ( !bySlot.has(k) ) bySlot.set(k, []); bySlot.get(k).push(l.voice); }
  let worstA = 0, worstV = 0;
  for ( const vs of bySlot.values() ) for ( let i = 0; i < 300; i++ ) {
    const x = rnd() * 5 * CELL, y = rnd() * 3 * CELL;
    worstA = Math.max(worstA, vs.filter((v) => v.x >= x && v.x < x + CELL && v.y >= y && v.y < y + CELL).length);
    worstV = Math.max(worstV, vs.filter((v) => v.x >= x && v.x < x + CELL * (16 / 9) && v.y >= y && v.y < y + CELL).length);
  }
  ok(worstA <= 1, `AREA a map full of fire: a window the size of an area never sees two lines begin together (${worstA})`);
  ok(worstV <= 2, `AREA a map full of fire: a reference view never sees more than two lines begin together (${worstV})`);
  const colours = new Set(); for ( let cy = 0; cy < 2; cy++ ) for ( let cx = 0; cx < 2; cx++ ) colours.add(BURN.colourOf(cx, cy));
  ok(colours.size === 4 && BURN.colourOf(-1, -1) === BURN.colourOf(1, 1) && BURN.colourOf(-3, 2) === BURN.colourOf(1, 0), "AREA touching areas never share a colour (left of the origin too)");
  ok(Math.abs(BURN.colourOf(0, 0) - BURN.colourOf(1, 0)) === 2, "AREA two areas side by side speak two slots apart (not one straight after the other)");
  const longest = Math.max(...Object.values(BURN.RUNGS).map((r) => r.ms)) * BURN.ROAR.ms;
  ok(longest <= BURN.LINE.slot && longest * 1.35 + 600 < BURN.TURN_MS, `AREA the longest word stands ${longest} ms: inside its slot, gone before its area's next turn`);
}

/* SAME */
{
  const vs = [V("a", 300, 400, 0.72, 0), V("a", 1500, 700, 0.72, 1), V("b", 2600, 300, 0.12), V("c", 5000, 2500, 0.42)];
  const a = BURN.linesIn(BURN.areasOf(vs, CELL), T0, T0 + 180000), b = [];
  // (another seat asks slot by slot, starting 37 s late, as speakDue does)
  for ( let t = T0 + 37000; t < T0 + 180000; t += 700 ) for ( const l of BURN.linesIn(BURN.areasOf(vs, CELL), t, t + 700) ) b.push(l);
  const key = (l) => `${l.area}|${l.turn}|${l.voice.key}${l.voice.i}|${l.index}|${l.t0}`, late = a.filter((l) => l.t0 >= T0 + 37000);
  ok(late.length >= 20 && late.map(key).join() === b.map(key).join(), `SAME a seat that joins 37 s late letters the same lines at the same instants (${b.length})`);
  ok(a.every((l) => BURN.slotAt(l.t0).colour === BURN.colourOf(...l.area.split(",").map(Number)) && l.t0 % BURN.LINE.slot === 0), "SAME every line begins on its area's slot of the shared clock");
}

/* STORY */
{
  const ar = BURN.areasOf([V("a", 500, 500, 0.72)], CELL), start = T0 + 4321, ls = BURN.linesIn(ar, start, start + 120000), nos = ls.map((l) => BURN.lineNo(l, start));
  ok(nos[0] <= 1 && nos.every((x, i) => !i || x === nos[i - 1] + 1), `STORY a fire's lines are numbered from its start, one by one (${nos.slice(0, 6).join()}...)`);
  const E0 = { word: ({ intensity, loud, seed }) => `W${intensity}${loud >= 0.9 ? "!" : loud >= 0.5 ? "+" : ""}${seed.length % 3}` };
  const sc = BURN.burnScore({ seed: "f", heat: () => 0.72, word: E0.word }), rungs = nos.slice(0, 12).map((i) => sc(i, 0).rung);
  ok(rungs[0] <= 3 && Math.max(...rungs) === 5 && rungs.indexOf(5) > 2, `STORY told line by line the fire still climbs its ladder to the roar (rungs ${rungs.join("")})`);
  // (a fire painted two days ago: the line's number comes from shared data - no run is replayed)
  const old = start - 2 * 86400000, l = BURN.linesIn(ar, start, start + BURN.TURN_MS)[0];
  ok(Number.isFinite(BURN.lineNo(l, old)) && BURN.lineNo(l, old) > 10000 && sc(BURN.lineNo(l, old), 0)?.text, "STORY a fire burning for two days is still lettered, on the same line on every seat");
  // (a word worked out from the phrase alone: a seat that never lettered the lines before letters the same word)
  const s1 = BURN.burnScore({ seed: "j", heat: () => 0.72, word: E0.word }), s2 = BURN.burnScore({ seed: "j", heat: () => 0.72, word: E0.word });
  const seq = Array.from({ length: 40 }, (_, i) => s1(i, 0).text), cold = [39, 17, 5, 28].map((i) => s2(i, 0).text);
  ok(cold.join() === [39, 17, 5, 28].map((i) => seq[i]).join(), "STORY a line asked for out of order is the same word as in order (a late seat)");
}

/* RIM */
{
  const st = [{ id: "s", p: [1000, 1000, 1400, 1000], r: 150 }], shape = BURN.fireShape(st), q = { x: 1200, y: 1000 };
  const hw = 3 * 80, hh = 0.9 * 80, on = BURN.coverOf(q, hw, hh, shape);
  ok(Math.abs(shape.area - (400 * 300 + Math.PI * 150 * 150)) / shape.area < 0.08, `RIM a stroke's area is measured (${Math.round(shape.area)} px2)`);
  for ( const dir of [-90, 0, 180, 40] ) {
    const r = BURN.rimSpot(q, shape, { hw, hh, dir });
    ok(r.clean && r.fire <= BURN.COVER.fire && r.word <= BURN.COVER.word, `RIM sparks ${dir} deg: the word covers ${(r.fire * 100).toFixed(0)} % of its fire (on the spot: ${(on.fire * 100).toFixed(0)} %), ${(r.word * 100).toFixed(0)} % of it on flames`);
    const a = (dir * Math.PI) / 180, along = (r.x - q.x) * Math.cos(a) + (r.y - q.y) * Math.sin(a);
    ok(along > 0 && r.d <= 150 + hh + hw, `RIM sparks ${dir} deg: the word stands on the side the sparks go, at the rim (${Math.round(r.d)} px out)`);
  }
  ok(on.fire > BURN.COVER.fire * 1.5 && on.word > 0.9, `RIM (before: on its spot the word had ${(on.fire * 100).toFixed(0)} % of this fire under it, all of it on flames)`);
  ok(BURN.COVER.fire <= 0.2 && BURN.COVER.word <= 0.4, `RIM at most ${BURN.COVER.fire * 100} % of a fire under its word, ${BURN.COVER.word * 100} % of the word on flames`);
  // (a fire wider than the view: no clean place - the least cover found, a small share of so big a fire)
  const big = BURN.fireShape([{ id: "b", p: [0, 0, 6000, 0, 6000, 3000, 0, 3000, 0, 1500, 6000, 1500], r: 900 }]), rb = BURN.rimSpot({ x: 3000, y: 1500 }, big, { hw, hh, dir: -90 });
  ok(rb.fire <= 0.05, `RIM inside a fire bigger than the view the word covers ${(rb.fire * 100).toFixed(1)} % of it`);
  const same = BURN.rimSpot(q, BURN.fireShape(st), { hw, hh, dir: -90 }), again = BURN.rimSpot(q, shape, { hw, hh, dir: -90 });
  ok(same.x === again.x && same.y === again.y, "RIM the same fire gives the same place (every seat)");
  ok(BURN.rimSpot(q, BURN.fireShape([]), { hw, hh }).d === 0, "RIM no strokes: the spot itself");
}

/* SIZE */
{
  ok(BURN.ROAR_REF <= BEFORE.roar * 0.5, `SIZE the roar's caps ${(BURN.ROAR_REF * 100).toFixed(1)} % of the reference view (before ${BEFORE.roar * 100} %): under half`);
  ok(BURN.ROAR_VH <= BEFORE.roarVh * 0.5, `SIZE close in the roar is at most ${BURN.ROAR_VH * 100} % of the window (before ${BEFORE.roarVh * 100} %)`);
  const refPx = 900 * BURN.ROAR_REF;
  ok(refPx >= 23.4 && refPx <= 30, `SIZE at the reference view the roar is ${refPx.toFixed(1)} px: legible (floor 23.4), a caption beside the flames`);
  const catchPx = EV.rankSize(C.FIRE_RANK, 900), outPx = EV.rankSize(C.OUT_RANK, 900, C.OUT_SHRINK);
  ok(catchPx <= BEFORE.catchPx * 0.5, `SIZE a fire's catch and flare ${catchPx.toFixed(0)} px at the reference view (live before: ${BEFORE.catchPx} px for a square-wide fire): under half`);
  ok(outPx < catchPx && outPx >= 23.4, `SIZE a fire's going-out hiss stays under its catch (${outPx.toFixed(0)} px)`);
  ok((CORE.match(/rank: FIRE_RANK/g) ?? []).length === 2 && /rank: OUT_RANK, shrink: OUT_SHRINK/.test(CORE), "SIZE the catch, the flare and the hiss are lettered at their rank's exact size");
  ok(BURN.BLOCK <= 1 && BURN.blockOf("smooth") <= BURN.blockOf("stepped") && BURN.WIDE * 0.5 <= SEAT.RUN.hw * BURN.blockOf("smooth"), `SIZE a line's block is ${BURN.BLOCK} of a run's at the fire's (smaller) size and holds its widest word`);
}

/* SOURCE */
{
  const burn = SRC.slice(SRC.indexOf("- a burning fire's sound: its lines */"), SRC.indexOf("- this client's screen */"));
  ok(burn.length > 3000 && !/L\.sustain\(/.test(burn) && /const h = L\.play\(call\.text, call\.opts\);/.test(burn), "SOURCE a burning fire is lettered line by line (L.play), not as a run");
  ok(/const id = `\$\{a\.id\}\|\$\{sl\.turn\}`; if \( spoken\.has\(id\) \) continue;/.test(burn) && /if \( a\.colour !== sl\.colour \) continue;/.test(burn), "SOURCE an area speaks once a turn, in its colour's slot");
  ok(/startAt: toPerf\(line\.t0\)/.test(burn) && /if \( now >= line\.t0 \+ ph\.ms \* BURN\.LINE\.join \) return note/.test(burn), "SOURCE a line begins on its shared instant; a seat too late for it leaves it out");
  ok(/const lv = b\.plan\.level\(t0\);/.test(burn) && /\(b\.plan\.at0 \?\? b\.plan\.at\)\(i, t0\)/.test(burn), "SOURCE the voices are sorted by area at the slot's own instant, by the table's spots");
  ok(/rimAt\(p, ks\);/.test(burn) && /BURN\.rimSpot\(q, shape, \{ hw, hh, dir: DIR\.plumeDeg\(DIR\.windOf\(p\.st\)\) \}\)/.test(burn), "SOURCE a word's place is its fire's rim, downwind");
  ok(!/caps\.live|mode: "ambient"/.test(burn), "SOURCE no count of live fires and no quiet mode: the areas bound the lettering");
  ok(/heard: \(st, lit\) =>/.test(SRC) && /flared: \(st\) =>/.test(SRC) && /if \( !ctx\.heard\?\.\(st, lit\) \) push\(/.test(CORE) && /&& !ctx\.flared\?\.\(st\) \)/.test(CORE) && C.CATCH_QUIET >= 5000,
    `SOURCE a fire catching or flaring within ${C.CATCH_QUIET} ms of another in its area is not lettered again`);
  ok(/burnLines: \(\) => burnLog\.slice\(\)/.test(SRC), "SOURCE the seat's last lines can be read (two seats compare)");
}

if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-burn: ${failed.length} failed, ${n} passed`); process.exit(1); }
console.log(`sfx-burn: ${n} checks passed`);
