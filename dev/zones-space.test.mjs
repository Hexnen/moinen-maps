// Offline checks of the procedural pixel-art space for the Orbit scene (scripts/zones/space.mjs).
import assert from "node:assert/strict";
import { paintSpace, enlarge, PALETTES, lastLayout } from "../scripts/zones/space.mjs";
import { cloudLayer } from "../scripts/zones/planet-clouds.mjs";

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
assert.ok(colours.size < 700, `too many colours: ${colours.size}`);
assert.ok(inPal / colours.size > 0.12, "the palettes still carry the picture");
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

// the planet's layout replays without painting (old Orbit scenes learn their planet from the seed), and saves its longitude
for ( const seed of [12345, 999, 31337] ) {
  paintSpace(seed, W, H); const full = JSON.stringify(lastLayout);
  paintSpace(seed, W, H, { layoutOnly: true });
  assert.equal(JSON.stringify(lastLayout), full, `layoutOnly replays the layout (${seed})`);
  assert.ok(Number.isFinite(lastLayout.planet.lo));
}
ok("layoutOnly replays the same planet and moon (incl. the longitude lo)");

// the drifting clouds: at phase 0 the live layer IS the picture's planet (exact noise: pixel for pixel; the table: all but a few edge
// pixels), so it covers the baked clouds without doubling them; then the clouds move, a few pixels per step
{
  const seed = 12345, pic = paintSpace(seed, W, H), L = cloudLayer(seed, W, H, { ...lastLayout.planet });
  assert.ok(L.pixels > W * 10, `the visible disc (${L.pixels} px)`);
  const differs = () => {
    let d = 0;
    for ( let y = 0; y < L.ch; y++ ) for ( let x = 0; x < L.cw; x++ ) {
      const o = (y * L.cw + x) * 4; if ( !L.data[o + 3] ) continue;
      const p = ((y + L.y0) * W + x + L.x0) * 4;
      if ( pic[p] !== L.data[o] || pic[p + 1] !== L.data[o + 1] || pic[p + 2] !== L.data[o + 2] ) d++;
    }
    return d;
  };
  L.paint(0, true);
  assert.equal(differs(), 0, "exact paint at phase 0 = the picture");
  L.paint(0);
  const dt = differs();
  assert.ok(dt / L.pixels < 0.01, `table paint at phase 0 ~ the picture (${dt} of ${L.pixels})`);
  // only disc pixels are opaque, and they stay so
  let opaque = 0; for ( let i = 3; i < L.data.length; i += 4 ) if ( L.data[i] ) { assert.equal(L.data[i], 255); opaque++; }
  assert.equal(opaque, L.pixels);
  // a quarter art pixel of motion changes few pixels; many steps move the clouds for real; the colours stay the picture's
  const step = 0.25 / L.pxPerPhase, small = L.paint(step);
  assert.ok(small > 0 && small < L.pixels * 0.05, `one step changes a few pixels (${small})`);
  let moved = 0; for ( let k = 2; k <= 200; k++ ) moved += L.paint(k * step);
  assert.ok(differs() > L.pixels * 0.02, "after 50 art px the clouds are elsewhere");
  const ok2 = new Set([...colours]);
  const L2 = new Set(); for ( let i = 0; i < L.data.length; i += 4 ) if ( L.data[i + 3] ) L2.add((L.data[i] << 16) | (L.data[i + 1] << 8) | L.data[i + 2]);
  const foreign = [...L2].filter((k) => !ok2.has(k)).length;
  assert.ok(foreign <= 8, `the moving layer uses the picture's colours (${foreign} new: palette colours under other overlays)`);
  // far phases (the wall clock runs for days) still paint a planet with clouds on it
  L.paint(2500.123);
  assert.ok(differs() > 0);
  ok(`drifting clouds: exact at phase 0, ${small} px per quarter-pixel step, picture's palette`);
}

console.log("all zones space checks passed");
