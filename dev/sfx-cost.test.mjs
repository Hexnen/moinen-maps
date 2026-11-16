// MAPCOST: what the map lettering does when there is nothing to letter.
//   ROOM     pure (sfx-seat burnRoom): with no spot of a run in this seat's view the panels / pins / tokens list is never read, so the
//            caller need not build it (a list that throws when read proves it); with a spot in view it is read and the layout is the same
//            whether the list was built ahead or on first need
//   SOURCE   sfx.mjs burnRooms builds that list (the walk over up to UI_VISIT page elements, uiBoxes) only once a run has a spot in
//            view: measured live 2026-11-16 (lane 5, GM 1600x900 and a player 1280x720) the walk took 6-14 ms once a second for as
//            long as any fire burned on the scene - also with the lettering off and with every seat looking elsewhere
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as SEAT from "../scripts/sfx/sfx-seat.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8");
let n = 0; const failed = [];
const ok = (c, m) => { if ( c ) n++; else failed.push(m); };

/* ROOM */
const v = { x0: 0, y0: 0, x1: 4000, y1: 2400 };
const base = { k: 60, kMin: 30, below: [40, 50], v, soft: [], taken: [], maxShift: 1500, motion: "smooth" };
const trap = () => ({ ...base, hard: { [Symbol.iterator]() { throw new Error("hard was read"); } } });
let threw = null, r0 = null;
try { r0 = SEAT.burnRoom([], trap()); } catch ( e ) { threw = e; }
ok(!threw && Array.isArray(r0) && r0.length === 0, `ROOM a run with no spot in view lays nothing out and never reads the panels list (${threw?.message ?? "ok"})`);
let read = false;
try { SEAT.burnRoom([{ x: 2000, y: 1200 }], trap()); } catch { read = true; }
ok(read, "ROOM a run with a spot in view reads the panels list (the probe is not blind)");
const hard = [{ x0: 1700, y0: 900, x1: 2300, y1: 1250 }, { x0: 0, y0: 0, x1: 4000, y1: 200 }];
const spots = [{ x: 2000, y: 1200 }, { x: 900, y: 700 }];
let built = 0;
const lazy = () => { let h = null; return { ...base, hard: { [Symbol.iterator]() { if ( !h ) { built++; h = hard.slice(); } return h[Symbol.iterator](); } } }; };
ok(JSON.stringify(SEAT.burnRoom(spots, { ...base, hard })) === JSON.stringify(SEAT.burnRoom(spots, lazy())) && built === 1, "ROOM the same layout whether the panels list is built ahead or on first need");

/* SOURCE */
const fn = SRC.slice(SRC.indexOf("function burnRooms(want) {"), SRC.indexOf("function capK(")  /* MAPBURN2: restated - the run clock is gone with the runs; the slice still ends after burnRooms */);
ok(fn.length > 500 && (fn.match(/uiBoxes\(\)/g) ?? []).length === 1 && /if \( on\.length \) hard \?\?= \[\.\.\.uiBoxes\(\), \.\.\.pinBoxes\(v0\), \.\.\.tokenBoxes\(v0\)\];/.test(fn),
  "SOURCE burnRooms walks this seat's panels only once a run has a spot in this view");
ok(/SEAT\.burnRoom\(on\.map\(\(i\) => p\.at\(i, now\)\), \{ k, kMin, below, v, hard: hard \?\? \[\], soft, taken, maxShift, motion \}\)/.test(fn), "SOURCE the run's layout gets the same lists as before");

if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-cost: ${failed.length} failed, ${n} passed`); process.exit(1); }
console.log(`sfx-cost: ${n} checks passed`);
