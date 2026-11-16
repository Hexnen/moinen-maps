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
//   STAGE   (MAPBURN3) ONE bound for every fire word: a catch, a flare, a going-out hiss, the eraser's hiss and the rain's hiss ask
//           the same areas as the burning lines - on a map full of fire with events all over it, any window the size of an area
//           never holds two fire words at once (a reference view: two), where MAPBURN2's rule held three and more; hisses of one
//           area are STAGE.quiet apart; every event word at the lines' size class; deep inside a fire no word
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
  // (MAPBURN3, restated: a fire bigger than the view. MAPBURN2 let the word stand in it ("the least cover found") - the owner's ruling
  // wants the flames to stay the picture: a spot with no rim within RIM_REACH areas is not lettered (`clean` false = the runtime's
  // "deep"); a spot near such a fire's rim still is)
  const big = BURN.fireShape([{ id: "b", p: [0, 0, 6000, 0, 6000, 3000, 0, 3000, 0, 1500, 6000, 1500], r: 900 }]), reach = BURN.RIM_REACH * CELL;
  const rb = BURN.rimSpot({ x: 3000, y: 1500 }, big, { hw, hh, dir: -90, reach }), on0 = BURN.coverOf({ x: 3000, y: 1500 }, hw, hh, big);
  ok(!rb.clean && on0.word > 0.9, `RIM deep inside a fire bigger than the view (the rim over ${Math.round(reach)} px away) no word is lettered: it would stand ${(on0.word * 100).toFixed(0)} % on flames`);
  const re = BURN.rimSpot({ x: 3000, y: -400 }, big, { hw, hh, dir: -90, reach });
  ok(re.clean && re.word <= BURN.COVER.word && Math.hypot(re.x - 3000, re.y + 400) <= reach, `RIM near that fire's rim the word stands beside it (${Math.round(re.d)} px from its spot, ${(re.word * 100).toFixed(0)} % of it on flames)`);
  // (live 2026-11-16: the rim place of a small fire's catch lay on a token, the layout moved the word off the token - onto the flames)
  {
    const f1 = BURN.fireShape([{ id: "s", p: [2525, 790, 2840, 825], r: 157 }]), q0 = { x: 2525, y: 790 }, free = BURN.rimSpot(q0, f1, { hw: 242, hh: 64, dir: -90 });
    const tok = [{ x0: free.x - 100, y0: free.y - 100, x1: free.x + 100, y1: free.y + 100 }], kept = BURN.rimSpot(q0, f1, { hw: 242, hh: 64, dir: -90, keepOff: tok });
    const onTok = (c) => c.x + 242 > tok[0].x0 && c.x - 242 < tok[0].x1 && c.y + 64 > tok[0].y0 && c.y - 64 < tok[0].y1;
    ok(free.clean && onTok(free) && kept.clean && !onTok(kept) && kept.fire <= BURN.COVER.fire && kept.word <= BURN.COVER.word, `RIM a rim place keeps off the tokens and pins every seat counts (moved ${Math.round(Math.hypot(kept.x - free.x, kept.y - free.y))} px along the rim, ${(kept.fire * 100).toFixed(0)} % of the fire under it)`);
    ok(BURN.SEAT_COVER.fire > BURN.COVER.fire && BURN.SEAT_COVER.fire <= 0.25 && BURN.SEAT_COVER.word <= 0.5 && !BURN.coverOk({ x: 2680, y: 810 }, 242, 64, f1, BURN.SEAT_COVER), "RIM a seat's own shift may put a little more under the word, never the flames' middle");
  }
  ok(BURN.coverOk(re, hw, hh, big) && !BURN.coverOk({ x: 3000, y: 1500 }, hw, hh, big) && BURN.coverOk({ x: 0, y: 0 }, hw, hh, BURN.fireShape([])), "RIM coverOk: the rim's place passes, a place on the flames does not (what a seat's own shift is held to)");
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
  // (MAPBURN3, restated: the event words a notch or two under rank 1 - FIRE_SHRINK / OUT_SHRINK / STEAM_SHRINK -, the eraser's hiss
  // and the rain's hiss with them; MAPBURN2: catch and flare the whole rank 1 (36 px), the eraser's hiss the engine's natural size,
  // the rain's hiss rank 2 (49.5 px), and the going-out hiss's `shrink` never reached its word)
  const catchPx = EV.rankSize(C.FIRE_RANK, 900, C.FIRE_SHRINK), outPx = EV.rankSize(C.OUT_RANK, 900, C.OUT_SHRINK), steamPx = EV.rankSize(1, 900, EV.STEAM_SHRINK), roarPx = 900 * BURN.ROAR_REF;
  ok(catchPx <= BEFORE.catchPx * 0.5 && catchPx <= roarPx * 1.2 && catchPx < EV.rankSize(1, 900), `SIZE a fire's catch and flare ${catchPx.toFixed(1)} px at the reference view (MAPBURN2 36, live before that ${BEFORE.catchPx}): at most 1.2 of a burning line's roar (${roarPx.toFixed(1)})`);
  ok(outPx < catchPx && outPx >= 23.4 && outPx <= roarPx + 0.01, `SIZE a fire's going-out hiss stays under its catch, no bigger than the roar (${outPx.toFixed(1)} px)`);
  ok(steamPx === outPx && steamPx <= EV.rankSize(2, 900) * 0.6, `SIZE the rain's hiss on a fire is a fire word of the hisses' size (${steamPx.toFixed(1)} px; it was rank 2, ${EV.rankSize(2, 900).toFixed(1)})`);
  ok((CORE.match(/rank: FIRE_RANK, shrink: FIRE_SHRINK/g) ?? []).length === 2 && /rank: OUT_RANK, shrink: OUT_SHRINK/.test(CORE) && /ms: 1100, box: pathBox\(p, st\.r \?\? 50\), rank: FIRE_RANK, shrink: OUT_SHRINK/.test(CORE),
    "SIZE the catch, the flare, the going-out hiss and the eraser's hiss are lettered at their rank's exact size");
  ok(/if \( Number\.isFinite\(main\.shrink\) \) mw\.shrink = main\.shrink;/.test(CORE), "SIZE an event's notch under its rank reaches its word (it never did: the going-out hiss was lettered at the whole rank)");
  {
    const st = { id: "f1", k: "fire", p: [100, 100, 400, 100], r: 60, q: 1000, lv: 2 }, ctx = { grid: 100, late: 1500, burning: () => true };
    const c = C.strokeEvents(st, null, 900, 9000, ctx).find((e) => e.voice === "fire");
    const o = C.strokeEvents({ ...st, o: 5000 }, st, 4900, 9000, ctx).find((e) => e.voice === "out");
    const d = C.strokeEvents({ id: "e1", k: "erase", p: [200, 100], r: 80, q: 3000 }, null, 2900, 9000, ctx).find((e) => e.voice === "douse");
    ok(c?.rank === 1 && c.shrink === C.FIRE_SHRINK && o?.rank === 1 && o.shrink === C.OUT_SHRINK && d?.rank === 1 && d.shrink === C.OUT_SHRINK, "SIZE the fire layer's events carry their rank and notch (catch, out, douse)");
    const mw = (e) => C.planCluster(C.cluster([e], 100)[0], { grid: 100, sec: 0, seed: "s" }).find((w) => w.role === "main");
    ok(mw(d).rank === 1 && mw(d).shrink === C.OUT_SHRINK && mw(o).shrink === C.OUT_SHRINK && mw({ ...c, cover: 1 }).cover === 1 && mw(c).cover === C.VOICES.fire.cover, "SIZE ... and the moment's word keeps them (and a rim word's `cover`)");
    const sw = EV.steamWord({ points: [{ x: 1, y: 2 }], key: "k", r: 50 }, 1000, 0.5, "s");
    ok(sw.rank === 1 && sw.shrink === EV.STEAM_SHRINK, "SIZE the rain's hiss carries rank 1 and its notch");
  }
  ok(BURN.BLOCK <= 1 && BURN.blockOf("smooth") <= BURN.blockOf("stepped") && BURN.WIDE * 0.5 <= SEAT.RUN.hw * BURN.blockOf("smooth"), `SIZE a line's block is ${BURN.BLOCK} of a run's at the fire's (smaller) size and holds its widest word`);
}

/* STAGE (MAPBURN3) */
{
  const E = (key, type, t, x, y, ms) => BURN.stageEntry({ key, type, t, x, y, ms }, CELL);
  const a = E("a", "catch", T0, 500, 500);
  ok(a.cls === "rise" && a.t1 === T0 + BURN.EVENTS.catch.stand && a.cx === 0 && a.cy === 0, "STAGE an event holds its area from its instant for its standing time");
  ok(BURN.stageSilent([a], E("b", "flare", T0 + 1000, 2500, 2500))?.why === "stage", "STAGE an event word whose time meets another's in a touching area is not lettered");
  ok(BURN.stageSilent([a], E("b", "flare", T0 + 1000, 2 * CELL + 100, 500)) === null, "STAGE ... two areas away it is");
  ok(BURN.stageSilent([a], E("b", "flare", a.t1, 600, 600)) === null && BURN.stageSilent([a], E("b", "flare", a.t1 - 1, 600, 600))?.by === "a", "STAGE ... and in the same area once the first one's standing time is over");
  ok(BURN.stageSilent([E("s", "steam", T0 + 800, 500, 500)], E("o", "out", T0, 600, 600))?.why === "stage", "STAGE an event decided earlier with a later instant holds the stage too (the rain's hiss is known ahead)");
  const h = E("h", "out", T0, 500, 500, 1600);
  ok(BURN.stageSilent([h], E("d", "douse", h.t1 + 100, 700, 700))?.why === "quiet" && BURN.stageSilent([h], E("d", "steam", T0 + BURN.STAGE.quiet - 1, 700, 700))?.why === "quiet"
    && BURN.stageSilent([h], E("d", "douse", T0 + BURN.STAGE.quiet, 700, 700)) === null, `STAGE an area hisses once in ${BURN.STAGE.quiet} ms, whatever hisses (a fire going out, the eraser, rain)`);
  ok(BURN.stageSilent([h], E("c", "catch", h.t1 + 100, 700, 700)) === null && BURN.stageSilent([h], E("d", "douse", h.t1 + 100, CELL + 10, 700)) === null, "STAGE ... a catch there is no hiss, and the next area has its own hisses");
  ok(BURN.standOf("out", 300) === BURN.EVENTS.out.min && BURN.standOf("out", 60000) === BURN.EVENTS.out.max && BURN.standOf("out", 2000) === 2000 + BURN.EVENTS.out.pad, "STAGE a going-out hiss holds the stage as long as its flames die, inside its bounds");
  const stands = ["catch", "flare", "douse", "steam"].map((t) => BURN.standOf(t)).concat(BURN.EVENTS.out.max);
  ok(Math.max(...stands) <= 2 * BURN.LINE.slot && Math.min(...stands) >= 2000, `STAGE no event holds the stage longer than two slots (${Math.max(...stands)} ms)`);
  // a line gives way
  ok(BURN.lineYields([a], 1, 1, T0 - 1000)?.key === "a" && BURN.lineYields([a], 0, 0, a.t1 - 1)?.key === "a", "STAGE a burning line whose slot meets an event word's time in a touching area gives way");
  ok(BURN.lineYields([a], 0, 0, a.t1) === null && BURN.lineYields([a], 0, 0, T0 - BURN.STAGE.clear - BURN.LINE.slot) === null && BURN.lineYields([a], 2, 0, T0) === null, "STAGE ... a line after it, well before it, or two areas away does not");
  ok(BURN.LINE.exit >= 500 && BURN.LINE.exit < BURN.LINE.slot / 3 && BURN.STAGE.clear >= 500, "STAGE a line is sent off before its slot ends, and before an event word lands");

  // a map full of fire, with fire events all over it (catches, flares, hisses of every kind), for three minutes
  let s = 11; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const full = []; for ( let cy = 0; cy < 4; cy++ ) for ( let cx = 0; cx < 6; cx++ ) full.push(V(`g${cx}_${cy}`, cx * CELL + 300 + rnd() * 1500, cy * CELL + 300 + rnd() * 1500, 0.72));
  const SPAN = 180000, lines = BURN.linesIn(BURN.areasOf(full, CELL), T0, T0 + SPAN);
  const TYPES = ["catch", "flare", "out", "douse", "steam"], evs = [];
  for ( let i = 0; i < 400; i++ ) evs.push({ key: `e${i}`, type: TYPES[Math.floor(rnd() * 5)], t: Math.round(T0 + rnd() * SPAN), x: rnd() * 6 * CELL, y: rnd() * 4 * CELL, ms: 1200 + rnd() * 3000, ahead: rnd() < 0.5 ? 0 : 700 });
  evs.sort((p, q) => p.t - q.t);
  // (the runtime's order: an event is decided when the table learns of it - `ahead` ms before its instant, or at its instant)
  const spoken = [], order = evs.slice().sort((p, q) => (p.t - p.ahead) - (q.t - q.ahead));
  for ( const e of order ) { const c = BURN.stageEntry(e, CELL); if ( !BURN.stageSilent(spoken, c) ) spoken.push(Object.assign(c, { x: e.x, y: e.y, known: e.t - e.ahead })); }
  ok(spoken.length >= 60 && spoken.length < evs.length * 0.7, `STAGE of ${evs.length} fire events on a burning map ${spoken.length} are lettered`);
  // the words up: a line from its slot to LINE.exit before its end (+ its exit), or until an event it did not know of lands; an event its standing time
  const EXIT = 560, up = [];
  let yielded = 0, cut = 0;
  for ( const l of lines ) {
    const [cx, cy] = l.area.split(",").map(Number);
    // (what the runtime knows when the line is handed over, LINE.lead before its slot)
    if ( BURN.lineYields(spoken.filter((o) => o.known <= l.t0 - BURN.LINE.lead), cx, cy, l.t0) ) { yielded++; continue; }
    let t1 = l.t0 + BURN.LINE.slot - BURN.LINE.exit + EXIT;
    for ( const o of spoken ) if ( o.known > l.t0 - BURN.LINE.lead && BURN.touching(o, { cx, cy }) && l.t0 < o.t1 && o.t - BURN.STAGE.clear < l.t0 + BURN.LINE.slot ) { t1 = Math.min(t1, Math.max(o.known, o.t - BURN.STAGE.clear) + EXIT); cut++; }
    up.push({ x: l.voice.x, y: l.voice.y, t0: l.t0, t1, line: true });
  }
  for ( const o of spoken ) up.push({ x: o.x, y: o.y, t0: o.t, t1: o.t1 });
  // MAPBURN2's picture of the same map: every event lettered, a line up 1.6 of its 1800 ms slot beside them
  const old = evs.map((e) => ({ x: e.x, y: e.y, t0: e.t, t1: e.t + 2400 }));
  for ( const l of BURN.linesIn(BURN.areasOf(full, CELL), T0, T0 + SPAN) ) old.push({ x: l.voice.x, y: l.voice.y, t0: l.t0, t1: l.t0 + 1800 * 1.6 });
  const worst = (list, w, hgt, grace = 0) => {
    let m = 0;
    for ( let i = 0; i < 6000; i++ ) {
      const t = T0 + rnd() * SPAN, x = rnd() * (6 * CELL - w), y = rnd() * (4 * CELL - hgt);
      m = Math.max(m, list.filter((q) => q.t0 <= t && t < q.t1 - (q.line ? grace : 0) && q.x >= x && q.x < x + w && q.y >= y && q.y < y + hgt).length);
    }
    return m;
  };
  const wa = worst(up, CELL, CELL), wv = worst(up, CELL * (16 / 9), CELL), oa = worst(old, CELL, CELL), ov = worst(old, CELL * (16 / 9), CELL);
  ok(yielded > 20, `STAGE ${yielded} lines gave way to an event word (${cut} more were sent off as one landed)`);
  // (an event nobody knew of ahead - a flare, the eraser - lands on a line up: the line is sent off at once and fades about half a second
  // into the event word; apart from that fade never two)
  ok(worst(up, CELL, CELL, EXIT + BURN.STAGE.clear) <= 1 && wa <= 2, `STAGE a window the size of an area never holds two fire words at once (${wa === 1 ? "none" : "only a line's fading exit under an event that came without warning"}); MAPBURN2's rule on the same map: ${oa}`);
  ok(wv <= 3 && worst(up, CELL * (16 / 9), CELL, EXIT + BURN.STAGE.clear) <= 2, `STAGE a reference view holds at most two (MAPBURN2's rule: ${ov})`);
  ok(oa >= 3 && ov >= 4, "STAGE (the check has teeth: the rule before held three and more on this map)");
  // hisses of one area
  const hiss = spoken.filter((o) => o.cls === "hiss"); let near = Infinity;
  for ( const p of hiss ) for ( const q of hiss ) if ( p !== q && p.cx === q.cx && p.cy === q.cy ) near = Math.min(near, Math.abs(p.t - q.t));
  ok(near >= BURN.STAGE.quiet, `STAGE two hisses of one area are never closer than ${BURN.STAGE.quiet} ms (${near})`);
  // every seat: the same events decided in the same order give the same words
  const again = []; for ( const e of order ) { const c = BURN.stageEntry(e, CELL); if ( !BURN.stageSilent(again, c) ) again.push(c); }
  ok(again.map((o) => o.key).join() === spoken.map((o) => o.key).join(), "STAGE the same events give the same lettered words (every seat)");
}

/* SOURCE */
{
  const burn = SRC.slice(SRC.indexOf("- a burning fire's sound: its lines */"), SRC.indexOf("- this client's screen */"));
  ok(burn.length > 3000 && !/L\.sustain\(/.test(burn) && /const h = L\.play\(call\.text, call\.opts\);/.test(burn), "SOURCE a burning fire is lettered line by line (L.play), not as a run");
  ok(/const id = `\$\{a\.id\}\|\$\{sl\.turn\}`; if \( spoken\.has\(id\) \) continue;/.test(burn) && /if \( a\.colour !== sl\.colour \) continue;/.test(burn), "SOURCE an area speaks once a turn, in its colour's slot");
  ok(/startAt: toPerf\(line\.t0\)/.test(burn) && /if \( now >= line\.t0 \+ ph\.ms \* BURN\.LINE\.join \) return note/.test(burn), "SOURCE a line begins on its shared instant; a seat too late for it leaves it out");
  ok(/const lv = b\.plan\.level\(t0\);/.test(burn) && /\(b\.plan\.at0 \?\? b\.plan\.at\)\(i, t0\)/.test(burn), "SOURCE the voices are sorted by area at the slot's own instant, by the table's spots");
  // (MAPBURN3, restated: the same rim, now within reach - `deep` spots are not lettered - and the shape kept per fire)
  ok(/rimAt\(p, ks\);/.test(burn) && /BURN\.rimSpot\(q, shapeOf\(p\), \{ hw, hh, dir: DIR\.plumeDeg\(DIR\.windOf\(p\.st\)\), reach, keepOff: off\.boxes \}\)/.test(burn) && /const reach = BURN\.RIM_REACH \* cellSize\(\);/.test(burn), "SOURCE a word's place is its fire's rim, downwind, within reach");
  ok(/if \( o\?\.deep \) return note\(\{ out: "deep" \}\);/.test(burn) && /BURN\.coverOk\(\{ x: q\.x \+ o\.dx, y: q\.y \+ o\.dy \}/.test(burn) && /note\(\{ out: o\?\.flames \? "flames" : "room" \}\)/.test(burn),
    "SOURCE a spot deep in a fire is not lettered; a seat's own shift is held to the rim's cover (else the line is left out there)");
  ok(/const ev = BURN\.lineYields\(stageSpoken\(\), acx, acy, line\.t0\);\s+if \( ev \) return note\(\{ out: "stage", by: ev\.key \}\);/.test(burn), "SOURCE a line asks the stage before any seat rule");
  ok(/stopAt\(h, line\.t0 \+ BURN\.LINE\.slot - BURN\.LINE\.exit\);/.test(burn) && /linesUp\.push\(up\);/.test(burn), "SOURCE a line is sent off before its slot ends and is known to the stage while up");
  const stage = SRC.slice(SRC.indexOf("- MAPBURN3: the one stage of every fire word */"), SRC.indexOf("- a burning fire's sound: its lines */"));
  ok(stage.length > 2000 && /BURN\.stageSilent\(\[\.\.\.fireStage\.values\(\)\]\.filter\(\(o\) => o\.spoke\), c\)/.test(stage) && /stopAt\(l\.h, c\.t - BURN\.STAGE\.clear\)/.test(stage), "SOURCE one stage: an event asks it once, a line up there leaves before the word lands");
  ok(/if \( !stageAsk\(\{ key: e\.key, type, t: ts, x: q\.x, y: q\.y, ms: e\.ms \}\) \) continue;/.test(SRC) && /const FIRE_EVENT = \{ fire: "catch", flare: "flare", out: "out", douse: "douse" \};/.test(SRC), "SOURCE the fire layer's catch, flare, out and douse ask the stage");
  ok(/if \( !stageAsk\(\{ key: `steam\|\$\{s\.t\}\|\$\{pl\.key\}`, type: "steam"/.test(SRC) && /const w = rimEvent\(w0, pl\.st, pl\.group\);/.test(SRC), "SOURCE the rain's hiss stands at the rim and asks the stage");
  ok(/try \{ pageFireWords\(rec, pg, all\); \}/.test(SRC) && /if \( w\.staged \) \{ seatSkip\(q, "stage"\); return; \}/.test(SRC) && /if \( !stageAsk\(\{ key, type: w\.role, t: ts/.test(stage), "SOURCE a firing's fire words (its catch, its arranged hisses) ask the stage too");
  ok(/const ft = fireTypeOf\(w\); if \( ft \) stopAt\(h, \(w\.ts \?\? toShared\(w\.t\)\) \+ BURN\.standOf\(ft, w\.ms\) - BURN\.STAGE\.tail\);/.test(SRC), "SOURCE an event word is gone when its standing time is over");
  ok(/return \{ \.\.\.e, x: r\.x, y: r\.y, box: \{ x0: r\.x - hw, y0: r\.y - hh, x1: r\.x \+ hw, y1: r\.y \+ hh \}, cover: 1 \};/.test(stage) && /if \( !r\.clean \) return null;/.test(stage), "SOURCE an event word stands at its fire's rim (its box there its subject), none deep inside a fire");
  ok(/fireStage: \(\) =>/.test(SRC), "SOURCE the stage can be read (two seats compare)");
  ok(/keepOff: keepOffBoxes\(\) \}\);/.test(stage) && /const keepOffBoxes = \(\) => \[\.\.\.sharedTokens\(null\), \.\.\.sharedPins\(null\)\];/.test(stage) && /if \( fireTypeOf\(w\) && call\.o\.at && Math\.hypot\(call\.o\.at\.x - w\.x, call\.o\.at\.y - w\.y\) > 1 && !offFlames\(w, call\.o\.at\) \) \{ seatSkip\(w, "flames", /.test(SRC),
    "SOURCE a fire word's rim place keeps off the tokens and pins every seat counts; an event word a seat moved onto the flames is left out there");
  ok(!/caps\.live|mode: "ambient"/.test(burn), "SOURCE no count of live fires and no quiet mode: the areas bound the lettering");
  ok(/heard: \(st, lit\) =>/.test(SRC) && /flared: \(st\) =>/.test(SRC) && /if \( !ctx\.heard\?\.\(st, lit\) \) push\(/.test(CORE) && /&& !ctx\.flared\?\.\(st\) \)/.test(CORE) && C.CATCH_QUIET >= 5000,
    `SOURCE a fire catching or flaring within ${C.CATCH_QUIET} ms of another in its area is not lettered again`);
  ok(/burnLines: \(\) => burnLog\.slice\(\)/.test(SRC), "SOURCE the seat's last lines can be read (two seats compare)");
}

if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-burn: ${failed.length} failed, ${n} passed`); process.exit(1); }
console.log(`sfx-burn: ${n} checks passed`);
