// Offline checks of the procedural pixel-art space for the Orbit scene (scripts/zones/space.mjs).
import assert from "node:assert/strict";
import { paintSpace, enlarge, PALETTES } from "../scripts/zones/space.mjs";

const ok = (name) => console.log(`ok   ${name}`);
const W = 200, H = 120;

const a = paintSpace(12345, W, H), b = paintSpace(12345, W, H), c = paintSpace(999, W, H);
assert.equal(a.length, W * H * 4);
assert.deepEqual(a, b); ok("the same seed paints the same picture");
assert.notDeepEqual(a, c); ok("another seed paints another picture");

let opaque = true;
for ( let i = 3; i < a.length; i += 4 ) if ( a[i] !== 255 ) { opaque = false; break; }
assert.ok(opaque); ok("every pixel is opaque");

// pixel art: a small set of colours (palettes, plus the few half-blended rim / galaxy pixels)
const colours = new Set();
for ( let i = 0; i < a.length; i += 4 ) colours.add((a[i] << 16) | (a[i + 1] << 8) | a[i + 2]);
const pal = new Set(Object.values(PALETTES).flat().map(([r, g, bb]) => (r << 16) | (g << 8) | bb));
const inPal = [...colours].filter((k) => pal.has(k)).length;
assert.ok(colours.size < 400, `too many colours: ${colours.size}`);
assert.ok(inPal / colours.size > 0.3, "most colours come from the palettes");
ok(`a limited palette (${colours.size} colours, ${inPal} straight from the palettes)`);

// the planet fills the bottom middle: ocean / land / cloud colours there
const bottom = (x, y) => { const i = ((H - 1 - y) * W + x) * 4; return (a[i] << 16) | (a[i + 1] << 8) | a[i + 2]; };
const planet = new Set([...PALETTES.ocean, ...PALETTES.land, ...PALETTES.cloud, ...PALETTES.city, ...PALETTES.rim].map(([r, g, bb]) => (r << 16) | (g << 8) | bb));
let hits = 0;
for ( let x = W * 0.3; x < W * 0.7; x++ ) if ( planet.has(bottom(Math.floor(x), 2)) ) hits++;
assert.ok(hits > W * 0.3, `planet at the bottom (${hits})`); ok("a planet across the bottom");

const e = enlarge(a, W, H, 3);
assert.equal(e.width, W * 3); assert.equal(e.height, H * 3);
for ( const [x, y] of [[0, 0], [17, 33], [W - 1, H - 1]] ) for ( const [dx, dy] of [[0, 0], [2, 1], [1, 2]] ) {
  const si = (y * W + x) * 4, oi = ((y * 3 + dy) * e.width + x * 3 + dx) * 4;
  assert.deepEqual([...e.data.slice(oi, oi + 4)], [...a.slice(si, si + 4)]);
}
ok("enlarge keeps hard pixel edges");

console.log("all zones space checks passed");
