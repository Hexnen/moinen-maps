// fxm2 (U201, FF6): in a fight the GM's orbit strip folds to one button in the initiative bar's row (scripts/zones/orbit-dock.mjs
// fightSpot), never over the map below the bar, and clear of the sidebar and the panels other modules declared.
import assert from "node:assert/strict";
import { fightSpot, listSpot } from "../scripts/zones/orbit-dock.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const W = 1600, H = 900, size = { w: 50, h: 30 };
const meets = (a, b) => !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.y1 <= b.y0 || a.y0 >= b.y1);
const boxOf = (s) => ({ x0: s.x, y0: s.y, x1: s.x + size.w, y1: s.y + size.h });

// the FF6 GM seat: the bar 340..1205 x 5..78, the challenges cards from 1235 at y 50, the sidebar from 1550, the scene navigation top left
const bar = { x0: 340, y0: 5, x1: 1205, y1: 78 };
const avoid = [{ x0: 1550, y0: 0, x1: 1600, y1: 900 }, { x0: 1235, y0: 50, x1: 1540, y1: 272 }, { x0: 1430, y0: 10, x1: 1540, y1: 40 }, { x0: 100, y0: 15, x1: 280, y1: 50 }];
const s = fightSpot(bar, size, avoid, W, H);
ok(s.where === "right", `beside the bar on its right (${s.where})`);
ok(s.y + size.h <= bar.y1, "inside the bar's row: nothing of it below the bar, over the map");
ok(!avoid.some((a) => meets(a, boxOf(s))), "clear of the challenges, the sidebar, the navigation");
ok(!meets(boxOf(s), bar), "not on the bar");

// no room on the right (a wide bar up to the challenges' heading): left of the bar
const wide = { x0: 360, y0: 5, x1: 1400, y1: 78 };
const l = fightSpot(wide, size, avoid, W, H);
ok(l.where === "left" && l.x + size.w <= wide.x0 && l.y + size.h <= wide.y1, `left of the bar (${l.where})`);
// no room either side: tucked under the bar's right end
const full = { x0: 290, y0: 5, x1: 1400, y1: 78 }, noCards = avoid.filter((a) => a.y1 !== 272);
const u = fightSpot(full, size, noCards, W, H);
ok(u.where === "under" && u.y >= full.y1 && u.x + size.w <= full.x1, `under the bar's right end (${u.where})`);
// no bar: the top right corner, left of what stands there
const c = fightSpot(null, size, avoid, W, H);
// nothing clear at all: right of the bar, the least in the way
ok(fightSpot(full, size, avoid, W, H).where === "right", "nothing clear: right of the bar");
ok(c.where === "corner" && c.x + size.w <= 1235 && !avoid.some((a) => meets(a, boxOf(c))), `no bar: the top right corner (${c.x})`);
// always inside the window
let seed = 3; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
for ( let i = 0; i < 500; i++ ) {
  const x0 = rnd() * 1200, b = { x0, y0: rnd() * 40, x1: x0 + 100 + rnd() * 900, y1: 0 };
  b.y1 = b.y0 + 30 + rnd() * 60;
  const p = fightSpot(b, size, avoid, W, H);
  ok(Number.isFinite(p.x) && Number.isFinite(p.y), "a spot always");
  if ( p.where !== "right" || !avoid.some((a) => meets(a, boxOf(p))) ) ok(p.x >= -size.w && p.y >= 0, "a sane spot");
}
// fxn2 (U210, FF7): the list the button opens stays off the challenges card and off the bar, as near the button as it can
{
  const lsize = { w: 176, h: 80 };
  const head = { x0: s.x, y0: s.y, x1: s.x + size.w, y1: s.y + size.h };
  const L = listSpot(head, lsize, avoid, bar, W, H);
  const lb = { x0: L.x, y0: L.y, x1: L.x + lsize.w, y1: L.y + lsize.h };
  ok(!avoid.some((a) => meets(a, lb)), `list clear of the challenges card and the sidebar (${L.x},${L.y} ${L.where})`);
  ok(!meets(lb, bar), "list not on the bar");
  ok(lb.y0 >= head.y1 && lb.x1 >= head.x0 - 40 && lb.x0 <= head.x1, "list by the button (under it, near its column)");
  // nothing in the way: right-aligned under the button
  const free = listSpot(head, lsize, [], null, W, H);
  ok(free.where === "under" && free.x === head.x1 - lsize.w && free.y > head.y1 && free.y - head.y1 < 12, `free: right under the button (${free.where})`);
  // nothing clear anywhere: a spot anyway
  const jam = listSpot(head, lsize, [{ x0: 0, y0: 0, x1: W, y1: H }], null, W, H);
  ok(jam.where === "fallback" && Number.isFinite(jam.x), "no room: the plain spot under the button");
}
console.log(`orbit-dock: ${n} checks passed`);
