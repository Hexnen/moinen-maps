// Zone hover pattern (scripts/zones/hover-pattern.mjs) - the street hang of 2026-11-09:   node dev/zones-hover-pattern.test.mjs
//   Hovering a zone the size of the map with hoverFx "dots" built ONE canvas path with an arc per dot over the zone's box (street:
//   4320 x 7680 px, grid 100 -> 57,600 arcs per tone); its fill froze the Foundry desktop app for 35-40 s right after the scene loaded
//   (Foundry replays the last pointer position, so the first hover comes with the scene). Checked with a counting 2D context:
//   - dots: a constant number of draw calls for ANY zone size (one tile of the grid + one patterned fillRect), and the pattern puts the
//     dots exactly on the old grid (row 0 / column 0 at the box's corner, rows a gap apart, odd rows half a gap in, the same radii);
//   - petals: cell by cell (the same petals as before) up to PETAL_CELLS cells, a repeating tile beyond: bounded too;
//   - `cells` counts what the old loops visited; display.mjs no longer draws a dot or a petal per cell itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.DOMMatrix ??= class { constructor(m) { [this.a, this.b, this.c, this.d, this.e, this.f] = m; } };
const P = await import(pathToFileURL(path.join(root, "scripts/zones/hover-pattern.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

/** A 2D context that counts the shapes it is asked to draw (and records what the checks need). */
function ctx2d(w = 0, h = 0) {
  const c = { w, h, ops: { arc: 0, fill: 0, stroke: 0, fillRect: 0, bezier: 0 }, arcs: [], translates: [], pattern: null, fills: [] };
  return Object.assign(c, {
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, save() {}, restore() {}, rotate() {}, setTransform() {},
    translate(x, y) { c.translates.push([x, y]); },
    arc(x, y, r) { c.ops.arc++; c.arcs.push([x, y, r, c.fillStyle]); },
    bezierCurveTo() { c.ops.bezier++; },
    fill() { c.ops.fill++; c.fills.push(c.fillStyle); }, stroke() { c.ops.stroke++; },
    fillRect(x, y, ww, hh) { c.ops.fillRect++; c.rect = [x, y, ww, hh]; },
    createPattern(tile, rep) { c.pattern = { tile, rep, setTransform(m) { this.m = m; } }; return c.pattern; }
  });
}
const tiles = [];
const mkCanvas = (w, h) => { const t = { width: w, height: h, ctx: ctx2d(w, h) }; t.getContext = () => t.ctx; tiles.push(t); return t; };
const total = (o) => o.arc + o.fill + o.stroke + o.fillRect + o.bezier;

// the old loops' visit count (what `cells` must match)
const oldCells = ([x0, y0, x1, y1], gap) => { let k = 0; for ( let y = y0, row = 0; y <= y1; y += gap, row++ ) for ( let x = x0 + (row % 2 ? gap / 2 : 0); x <= x1; x += gap ) k++; return k; };
for ( const [box, gap] of [[[0, 0, 100, 100], 24], [[1100, 2000, 5420, 9680], 24], [[3, 7, 50.5, 13], 12], [[0, 0, 11, 0], 12], [[0, 0, 5, 5], 12], [[-40, -40, 400, 300], 32]] )
  ok(P.cells(box, gap) === oldCells(box, gap), `cells(${box}, ${gap}) = ${oldCells(box, gap)} (the old loops' count), got ${P.cells(box, gap)}`);

// THE STREET: the zone that covers the whole map (scene rect 1100,2000 - 5420,9680; grid 100 -> u 2; canvas 2048 px -> k 0.2667)
const street = [1100, 2000, 5420, 9680], u = 2, k = 2048 / 7680;
ok(P.cells(street, 24) === 57760 || P.cells(street, 24) > 50000, "the street zone has tens of thousands of dot cells (the old cost)");
{
  tiles.length = 0;
  const c = ctx2d();
  P.drawDots(c, street, u, k, 0xf3e7c9, mkCanvas);
  const t = tiles[0].ctx, all = total(c.ops) + total(t.ops);
  ok(c.ops.arc === 0, "dots: no arc on the zone's canvas itself");
  ok(c.ops.fillRect === 1, "dots: one patterned fillRect over the box");
  ok(t.ops.arc === 10 && t.ops.fill === 2, `dots: the tile holds one period (5 centres x 2 tones), got ${t.ops.arc} arcs / ${t.ops.fill} fills`);
  ok(all <= 16, `dots: a constant number of draw calls (${all}) instead of ${2 * P.cells(street, 24)} arcs`);
  // the grid: pattern pixel (px, py) -> map (m.a px + m.e, m.d py + m.f); the tile's centres must land on the old dots
  const m = c.pattern.m, T = tiles[0].width, gap = 24;
  ok(c.pattern.rep === "repeat" && tiles[0].height === 2 * T, "dots: the tile is one period (gap x 2 gaps), repeated");
  const at = ([px, py]) => [m.a * px + m.e, m.d * py + m.f];
  ok(near(at([0, 0])[0], street[0]) && near(at([0, 0])[1], street[1]), "dots: row 0 / column 0 at the box's corner (as the old loop)");
  ok(near(at([T, 0])[0] - at([0, 0])[0], gap, 1e-9), "dots: columns a gap apart");
  ok(near(at([T / 2, T])[0], street[0] + gap / 2, 1e-9) && near(at([T / 2, T])[1], street[1] + gap, 1e-9), "dots: odd rows a gap down, half a gap in");
  ok(near(at([0, 2 * T])[1] - street[1], 2 * gap, 1e-9), "dots: the period is two rows");
  // radii (map units) and the two tones, dark under light
  const s = T / gap, rd = t.arcs.filter((q) => q[3].startsWith("rgba(21,17,15")), rl = t.arcs.filter((q) => !q[3].startsWith("rgba(21,17,15"));
  ok(rd.length === 5 && rl.length === 5, "dots: five dark and five light dots in the tile");
  ok(rd.every((q) => near(q[2] / s, 1.7 * u + 1.1 * u, 1e-9)) && rl.every((q) => near(q[2] / s, 1.7 * u, 1e-9)), "dots: the old radii (1.7u, under-dot +1.1u)");
  ok(t.fills[0].startsWith("rgba(21,17,15,0.42") && t.fills[1] === "rgba(243,231,201,0.9)", "dots: the old tones (ink 0.42 under, the light 0.9 over)");
  // the patterned rect covers the whole box
  const [rx, ry, rw, rh] = c.rect;
  ok(rx <= street[0] && ry <= street[1] && rx + rw >= street[2] && ry + rh >= street[3], "dots: the fill covers the whole box");
}
// bounded for every size (a tiny zone to a huge one) and every grid / canvas scale
for ( const [w, h] of [[10, 10], [300, 200], [4320, 7680], [20000, 20000], [60000, 9000]] ) for ( const uu of [0.5, 1, 2, 4] ) for ( const kk of [0.05, 0.27, 1, 3] ) {
  tiles.length = 0;
  const c = ctx2d(); P.drawDots(c, [0, 0, w, h], uu, kk, 0xffffff, mkCanvas);
  const all = total(c.ops) + tiles.reduce((s, t) => s + total(t.ctx.ops), 0);
  ok(all <= 16, `dots ${w}x${h} u ${uu} k ${kk}: ${all} draw calls (bounded)`);
  ok(tiles.every((t) => t.width <= 512 && t.height <= 1024), "dots: the tile stays small");
}

// petals: the same petals cell by cell on a small zone, a bounded tile on a big one
{
  const box = [1000, 1000, 1400, 1300], gap = 16 * u;
  ok(P.cells(box, gap) <= P.PETAL_CELLS, "petals: a small zone is drawn cell by cell");
  tiles.length = 0;
  const c = ctx2d(); const drawn = P.drawPetals(c, box, u, 1, mkCanvas);
  // the old loop: hash per cell, skip r1 < 0.35, translate to the jittered spot
  const old = [];
  for ( let y = box[1], row = 0; y <= box[3]; y += gap, row++ ) for ( let x = box[0] + (row % 2 ? gap / 2 : 0); x <= box[2]; x += gap ) {
    const hh = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453, r1 = hh - Math.floor(hh), r2 = (hh * 7.13) - Math.floor(hh * 7.13);
    if ( r1 >= 0.35 ) old.push([x + (r2 - 0.5) * gap * 0.8, y + (r1 - 0.5) * gap * 0.8]);
  }
  ok(tiles.length === 0 && drawn === old.length && c.translates.length === old.length, `petals: the same ${old.length} petals as the old loop`);
  ok(c.translates.every((p, i) => near(p[0], old[i][0], 1e-9) && near(p[1], old[i][1], 1e-9)), "petals: at the same spots");
}
for ( const box of [street, [0, 0, 20000, 20000], [0, 0, 60000, 9000]] ) {
  tiles.length = 0;
  const c = ctx2d(); P.drawPetals(c, box, u, k, mkCanvas);
  const all = total(c.ops) + tiles.reduce((s, t) => s + total(t.ctx.ops), 0);
  ok(tiles.length === 1 && c.ops.fillRect === 1, "petals: a big zone gets one repeating tile");
  ok(all <= 2 * P.PETAL_TILE * P.PETAL_TILE * 6 + 4, `petals ${box}: ${all} draw calls (bounded by the tile, not the zone)`);
}

// display.mjs draws the dots and the petals only through hover-pattern.mjs (no per-cell loop over the zone's box any more)
const disp = fs.readFileSync(path.join(root, "scripts/zones/display.mjs"), "utf8");
ok(/import \{ drawDots, drawPetals \} from "\.\/hover-pattern\.mjs"/.test(disp), "display.mjs imports the bounded patterns");
ok(/drawDots\(c, \[x0, y0, x1, y1\], u, k, light\)/.test(disp) && /drawPetals\(c, \[x0, y0, x1, y1\], u, k\)/.test(disp), "display.mjs draws dots and petals through them");
ok(!/c\.arc\(x, y, rad/.test(disp) && !/12\.9898/.test(disp), "display.mjs has no per-dot / per-petal loop left");

console.log(`zones hover pattern: ${n} checks passed`);
