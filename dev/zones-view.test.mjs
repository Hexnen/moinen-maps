// Zones: the free part of the screen (pure): declared insets, the largest stretch nothing covers, where a point lies against it,
// how far the view has to move to bring a point or a box in, where a banner finds room.   node dev/zones-view.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const V = await import(pathToFileURL(path.join(root, "scripts/zones/view.mjs")).href);

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const J = JSON.stringify;

/* ---- insets */
check(J(V.cleanInsets({ top: 10, bottom: "120", left: -5, right: NaN })) === J({ top: 10, right: 0, bottom: 120, left: 0 }) && V.cleanInsets(null) === null && V.cleanInsets(7) === null && V.cleanInsets({ top: 1e9 }).top === 8000, "insets: numbers from 0 up, capped; nothing given: null");
check(J(V.sumInsets([{ top: 10, bottom: 100 }, null, { bottom: 180, left: 40 }, { top: 4 }])) === J({ top: 10, right: 0, bottom: 180, left: 40 }) && J(V.sumInsets([])) === J({ top: 0, right: 0, bottom: 0, left: 0 }), "several insets: the largest on every side");

/* ---- the largest free rectangle */
const grid = (rows) => ({ free: rows.join("").split("").map((c) => (c === "." ? 1 : 0)), cols: rows[0].length, rows: rows.length });
const lr = (rows) => { const g = grid(rows); return V.largestRect(g.free, g.cols, g.rows); };
check(J(lr(["....", "....", "...."])) === J({ c0: 0, r0: 0, c1: 3, r1: 2 }), "an empty screen: all of it");
check(lr(["##", "##"]) === null, "nothing free: none");
check(J(lr(["..##..", "......", "......", "######"])) === J({ c0: 0, r0: 1, c1: 5, r1: 2 }), "a tracker at the top middle and a bar along the bottom: the band between them");
check(J(lr(["#.....", "#.....", "#...##", "#...##"])) === J({ c0: 1, r0: 0, c1: 3, r1: 3 }) && J(lr(["#.....", "#.....", "#....#", "######"])) === J({ c0: 1, r0: 0, c1: 4, r1: 2 }), "a column at the left and a panel in a corner: the larger of the stretches beside them");
check(J(lr(["#.#", "...", "#.#"])) === J({ c0: 0, r0: 1, c1: 2, r1: 1 }), "a cross: the first of the equal stretches (the row before the column)");

/* ---- the free stretch */
check(J(V.safeRect(1600, 900)) === J({ x: 0, y: 0, w: 1600, h: 900 }) && J(V.safeRect(1600, 900, { top: 130, bottom: 400 })) === J({ x: 0, y: 130, w: 1600, h: 370 }), "no inset: the window; declared insets cut it");
check(J(V.safeRect(1600, 900, { bottom: 400 }, { x: 320, y: 240, w: 840, h: 260 })) === J({ x: 320, y: 240, w: 840, h: 260 }) && J(V.safeRect(1600, 900, { bottom: 500 }, { x: 320, y: 240, w: 840, h: 400 })) === J({ x: 320, y: 240, w: 840, h: 160 }), "what was measured narrows it; a declared inset still counts where the look found nothing");
check(J(V.safeRect(1600, 900, null, { x: 700, y: 400, w: 200, h: 100 })) === J({ x: 0, y: 0, w: 1600, h: 900 }), "a measured stretch too small to work with: the declared stretch stands");
check(V.safeRect(1000, 600, { left: 700, right: 700 }).w === 0 && V.safeRect(1000, 600, { top: 900 }).h === 0, "insets larger than the window leave nothing, never less");

/* ---- a point against the stretch */
const R = { x: 100, y: 200, w: 800, h: 300 };
check(V.inRect({ x: 100, y: 200 }, R) && !V.inRect({ x: 100, y: 200 }, R, 1) && !V.inRect({ x: 950, y: 300 }, R), "inside: edges included, a margin shrinks it");
check(J(V.nudge({ x: 500, y: 300 }, R, 40)) === J({ dx: 0, dy: 0 }) && J(V.nudge({ x: 500, y: 640 }, R, 40)) === J({ dx: 0, dy: -180 }) && J(V.nudge({ x: 20, y: 100 }, R, 40)) === J({ dx: 120, dy: 140 }), "nudge: nothing for a point inside, else the least that brings it in with the margin");
check(J(V.nudge({ x: 500, y: 640 }, R, 400)) === J({ dx: 0, dy: -240 }), "the margin is never more than a third of the stretch");
check(V.sideOf({ x: 500, y: 640 }, R) === "bottom" && V.sideOf({ x: 500, y: 20 }, R) === "top" && V.sideOf({ x: 20, y: 300 }, R) === "left" && V.sideOf({ x: 990, y: 300 }, R) === "right" && V.sideOf({ x: 500, y: 300 }, R) === null, "the side a point lies beyond; inside: none");
check(V.sideOf({ x: 950, y: 900 }, R) === "bottom" && V.sideOf({ x: 1500, y: 520 }, R) === "right", "beyond two sides: the one it is farther beyond");
check(V.sideOf({ x: 500, y: 480 }, R, true) === "bottom" && V.sideOf({ x: 120, y: 350 }, R, true) === "left" && V.sideOf({ x: 500, y: 640 }, R, true) === "bottom", "asked for the nearest side, a point inside names the edge it is closest to");
check(J(V.pushOf({ x: 500, y: 480 }, R)) === J({ x: 0, y: 1 }) && J(V.pushOf({ x: 110, y: 210 }, R)) === J({ x: -1, y: -1 }) && J(V.pushOf({ x: 500, y: 350 }, R)) === J({ x: 0, y: 0 }) && J(V.pushOf({ x: 500, y: 700 }, R)) === J({ x: 0, y: 1 }), "a pointer near an edge (or beyond it) pushes that way");

/* ---- a box against the stretch */
let f = V.fitBox({ x0: 300, y0: 520, x1: 700, y1: 600 }, R, 20);
check(f.k === 1 && f.dx === 0 && f.dy === -120, "a box that fits is moved in by the least");
f = V.fitBox({ x0: 0, y0: 0, x1: 1600, y1: 300 }, R, 0);
check(f.k === 0.5 && f.dx === -150 && f.dy === 25, `a box too wide: the scale it fits at (around the middle of the stretch), then the move (k ${f.k}, dx ${f.dx}, dy ${f.dy})`);
f = V.fitBox({ x0: 500, y0: 300, x1: 500, y1: 300 }, R, 20);
check(f.k === 1 && f.dx === 0 && f.dy === 0, "one point inside: nothing to do");

/* ---- room for a banner */
check(V.clearY(72, 50, []) === 72 && V.clearY(72, 50, [{ top: 0, bottom: 126 }]) === 134 && V.clearY(72, 50, [{ top: 0, bottom: 126 }, { top: 134, bottom: 182 }]) === 190, "the banner goes below what it would lie on: one bar, a bar and a strip under it");
check(V.clearY(72, 50, [{ top: 0, bottom: 60 }]) === 72 && V.clearY(72, 50, [{ top: 130, bottom: 160 }]) === 72 && V.clearY(72, 50, [{ top: 125, bottom: 160 }]) === 168, "a box clear of it (with the gap) does not move it; one within the gap does");
check(V.clearY(72, 50, [{ top: 0, bottom: 400 }], 8, 300) === 72, "no room in the upper part: it stays where it was");

// uxd (U160): the banner above a bottom bar goes UP past what lies in its column
check(V.clearYUp(800, 50, []) === 800 && V.clearYUp(800, 50, [{ top: 830, bottom: 900 }]) === 772 && V.clearYUp(800, 50, [{ top: 830, bottom: 900 }, { top: 700, bottom: 772 }]) === 642, "the banner goes above what it would lie on: a panel, and a panel above that");
check(V.clearYUp(800, 50, [{ top: 870, bottom: 900 }]) === 800 && V.clearYUp(800, 50, [{ top: 855, bottom: 900 }]) === 797, "a box clear of it (with the gap) does not move it; one within the gap does");
check(V.clearYUp(800, 50, [{ top: 300, bottom: 900 }], 8, 450) === 800, "no room in the lower part: it stays where it was");

console.log(failed ? `${failed} failed` : "all zones view checks passed");
process.exit(failed ? 1 : 0);
