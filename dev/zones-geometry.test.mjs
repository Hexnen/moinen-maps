// Zones: the geometry of loose pencil lines -> zones, outside Foundry.   node dev/zones-geometry.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Z = await import(pathToFileURL(path.join(root, "scripts/zones/geometry.mjs")).href);

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const line = (...p) => p;

// 1. the user's sketch: a frame of four lines that overshoot, split by a slanted line -> 2 zones, next to each other
const sketch = [
  line(100, 118, 250, 124, 400, 140, 565, 148),        // top
  line(62, 398, 300, 405, 500, 402, 685, 395),          // bottom
  line(133, 75, 130, 300, 115, 495),                    // left
  line(262, 77, 220, 200, 162, 450),                    // slanted
  line(540, 80, 520, 300, 502, 450)                     // right
];
let R = Z.buildZones(sketch, { snap: 10, minArea: 100 });
check(R.zones.length === 2, `sketch: 2 zones (got ${R.zones.length})`);
check(R.zones.every((z) => z.area > 0), "sketch: zone areas positive");
const a = Z.zoneAt(R, 160, 250), b = Z.zoneAt(R, 380, 280);
check(a >= 0 && b >= 0 && a !== b, `sketch: points fall in two different zones (${a}, ${b})`);
check(Z.zoneAt(R, 50, 50) === -1 && Z.zoneAt(R, 600, 300) === -1, "sketch: outside points are in no zone");
check(Z.zoneDistance(R, 160, 250, 380, 280) === 1, "sketch: distance between the zones is 1");
check(Z.zoneDistance(R, 160, 250, 170, 260) === 0, "sketch: same zone is 0");
check(R.zones[0].cx < R.zones[1].cx, "sketch: zones numbered left to right");
// trimmed lines: nothing sticks out past the frame corners
const xs = R.core.flatMap((p) => p.filter((_, i) => i % 2 === 0)), ys = R.core.flatMap((p) => p.filter((_, i) => i % 2 === 1));
check(Math.min(...xs) > 110 && Math.max(...xs) < 545 && Math.min(...ys) > 110 && Math.max(...ys) < 410, `sketch: trimmed core stays inside the frame (${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)} x ${Math.min(...ys).toFixed(0)}..${Math.max(...ys).toFixed(0)})`);
// trimming is stable: zones of the core = the same zones
const R2 = Z.buildZones(R.core, { snap: 10, minArea: 100 });
check(R2.zones.length === 2 && Math.abs(R2.zones[0].area - R.zones[0].area) < 1 && Math.abs(R2.zones[1].area - R.zones[1].area) < 1, "trim: the core gives the same zones");
check(R.borders.filter((x) => x.b >= 0).length > 0 && R.borders.every((x) => x.a !== x.b), "borders: inner border exists, no self-borders");

// 2. a near miss: the slanted line stops 6 px short of the top line -> still joined (snap 10), not with snap 2
const short = sketch.map((p) => p.slice()); short[3] = line(232, 130, 220, 200, 162, 450);   // top line at x 232 is ~y 123.3
R = Z.buildZones(short, { snap: 10, minArea: 100 });
check(R.zones.length === 2, `near miss joined with snap 10 (got ${R.zones.length})`);
R = Z.buildZones(short, { snap: 2, minArea: 100 });
check(R.zones.length === 1, `near miss not joined with snap 2 (got ${R.zones.length})`);

// 3. one stroke that crosses itself into a loop (a lasso) -> 1 zone; the tail is ignored
R = Z.buildZones([line(0, 0, 200, 0, 200, 200, 0, 200, 50, -50)], { snap: 5 });
check(R.zones.length === 1, `lasso: 1 zone (got ${R.zones.length})`);
// a loop closed by snapping its own end to its start
R = Z.buildZones([line(0, 0, 200, 0, 200, 200, 0, 200, 0, 6)], { snap: 10 });
check(R.zones.length === 1, `self-closing loop by snap: 1 zone (got ${R.zones.length})`);

// 4. a zone inside a zone (a building in a yard): 2 zones, the yard has a hole, adjacent
const sq = (x, y, s) => line(x, y, x + s, y, x + s, y + s, x, y + s, x, y);
R = Z.buildZones([sq(0, 0, 400), sq(150, 150, 100)], { snap: 5 });
check(R.zones.length === 2, `nested: 2 zones (got ${R.zones.length})`);
const yard = Z.zoneAt(R, 50, 50), house = Z.zoneAt(R, 200, 200);
check(yard >= 0 && house >= 0 && yard !== house, "nested: yard and house differ");
check(Math.abs(R.zones[yard].area - (160000 - 10000)) < 1, `nested: yard area excludes the house (${R.zones[yard].area})`);
check(Z.distances(R, yard).get(house) === 1, "nested: yard and house adjacent");

// 5. a sliver (two strokes crossing twice close together) merges into its neighbour
R = Z.buildZones([sq(0, 0, 300), line(150, -20, 150, 320), line(146, -20, 154, 150, 146, 320)], { snap: 2, minArea: 900 });
check(R.zones.length === 2, `sliver merged: 2 zones (got ${R.zones.length})`);

// 6. a grid of 3 x 3 drawn with 4 + 4 overshooting lines: 9 zones, corner to corner = 4 (no diagonal moves)
const grid = [];
for ( let i = 0; i < 4; i++ ) { grid.push(line(-20, i * 100, 320, i * 100 + 3)); grid.push(line(i * 100, -20, i * 100 - 3, 320)); }
R = Z.buildZones(grid, { snap: 5 });
check(R.zones.length === 9, `3x3 grid: 9 zones (got ${R.zones.length})`);
check(Z.zoneDistance(R, 50, 50, 250, 250) === 4, "3x3 grid: corner to corner is 4");

// 7. a line inside a zone that touches only one border is pruned (not a border)
R = Z.buildZones([sq(0, 0, 300), line(0, 150, 150, 150)], { snap: 2 });
check(R.zones.length === 1 && R.borders.every((x) => x.b === -1), "dead-end line inside a zone is not a border");

// 8. speed: 200 messy strokes of 40 points
const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const many = [];
for ( let k = 0; k < 200; k++ ) { const p = []; let x = rnd() * 4000, y = rnd() * 4000; for ( let i = 0; i < 40; i++ ) { p.push(x, y); x += (rnd() - 0.5) * 120; y += (rnd() - 0.5) * 120; } many.push(p); }
const t0 = performance.now(); R = Z.buildZones(many, { snap: 15, minArea: 2000 }); const ms = performance.now() - t0;
check(ms < 1500, `200 messy strokes in ${ms.toFixed(0)} ms (${R.zones.length} zones, ${R.stats.segments} segments)`);

// 9. smoothing: ends stay put, a zigzag gets calmer, the sketch keeps its 2 zones, a closed loop stays closed
const zig = []; for ( let i = 0; i <= 40; i++ ) zig.push(i * 10, i % 2 ? 6 : -6);
const sm = Z.smoothLine(zig, 0.6, 5);
check(sm[0] === 0 && sm[1] === -6 && sm[sm.length - 2] === 400 && sm[sm.length - 1] === zig[zig.length - 1], "smooth: ends stay where they were");
const amp = (p) => Math.max(...p.filter((_, i) => i % 2).slice(2, -2).map(Math.abs));
check(amp(sm) < 2, `smooth: zigzag amplitude 6 -> ${amp(sm).toFixed(2)}`);
check(Z.smoothLine(zig, 0, 5) === zig, "smooth 0: the line as drawn");
R = Z.buildZones(sketch.map((p) => Z.smoothLine(p, 1, 5)), { snap: 10, minArea: 100 });
check(R.zones.length === 2, `smooth 1: sketch still 2 zones (got ${R.zones.length})`);
const loop = []; for ( let i = 0; i <= 48; i++ ) { const a = (i / 48) * Math.PI * 2; loop.push(200 + 100 * Math.cos(a) + (i % 2 ? 8 : 0), 200 + 100 * Math.sin(a)); }
loop[loop.length - 2] = loop[0]; loop[loop.length - 1] = loop[1];
R = Z.buildZones([Z.smoothLine(loop, 1, 5)], { snap: 5 });
check(R.zones.length === 1, `smooth 1: closed wobbly loop stays one zone (got ${R.zones.length})`);
// 10. a badge in the top-left corner sits inside the zone, clear of its borders
R = Z.buildZones([[0, 0, 400, 0, 400, 300, 0, 300, 0, 0]], { snap: 5 });
const cp = Z.cornerPoint(R.zones[0], 20);
check(cp.x >= 20 && cp.y >= 20 && cp.x < 60 && cp.y < 60, `corner badge near the top left, clear of the border (${cp.x.toFixed(0)}, ${cp.y.toFixed(0)})`);

console.log(failed ? `${failed} failed` : "all zones geometry checks passed");
process.exit(failed ? 1 : 0);
