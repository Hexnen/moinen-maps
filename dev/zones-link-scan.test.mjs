// The zones' sample points (scripts/zones/link.mjs samplesOf, a scan line per row since perf-arrival 2026-11-09) are exactly the points
// the old per-point test kept: same points, same order, for real zones (the street map) and for random rings with holes, sample rows
// through vertices and edges lying on a sample row or column.
import assert from "node:assert/strict";
import fs from "node:fs";
import { samplesOf } from "../scripts/zones/link.mjs";
import { smoothLine, buildZones } from "../scripts/zones/geometry.mjs";

const ok = (name) => console.log(`ok   ${name}`);

// the old samplesOf, verbatim (the reference)
function inRing(p, x, y) {
  let c = false;
  for ( let i = 0, n = p.length, j = n - 2; i < n; j = i, i += 2 ) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ( (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi ) c = !c;
  }
  return c;
}
function samplesOfRef(Z, zoneAt, step) {
  const out = new Map();
  if ( !Z ) return out;
  for ( const z of Z.zones ) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for ( const part of z.parts ?? [z.rings] ) { const p = part[0]; for ( let i = 0; i < p.length; i += 2 ) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); } }
    const pts = [];
    const parts = z.parts ?? [[z.rings]];
    const mine = (x, y) => parts.some((part) => inRing(part[0], x, y) && !part.slice(1).some((h) => inRing(h, x, y)));
    for ( let y = y0 + step / 2; y < y1; y += step ) for ( let x = x0 + step / 2; x < x1; x += step ) if ( mine(x, y) ) pts.push(x, y);
    if ( !pts.length ) pts.push(z.label.x, z.label.y);
    out.set(z.id, pts);
  }
  return out;
}
const same = (a, b, what) => {
  assert.deepEqual([...a.keys()], [...b.keys()], `${what}: zone ids`);
  for ( const [id, p] of a ) { const q = b.get(id); assert.equal(p.length, q.length, `${what}: zone ${id} count`); for ( let i = 0; i < p.length; i++ ) assert.ok(Object.is(p[i], q[i]), `${what}: zone ${id} point ${i}: ${p[i]} vs ${q[i]}`); }
};

// 1. the street map's zones (12 zones from 25 pencil lines), at the zones' own step and a few others
{
  const f = JSON.parse(fs.readFileSync(new URL("./fixtures/zones-street.json", import.meta.url), "utf8"));
  const g = f.grid, step = Math.max(3, Math.min(g * 0.15, 12));
  const px = Math.ceil(f.width * f.padding / g) * g, py = Math.ceil(f.height * f.padding / g) * g;
  const lines = f.zones.s.map(([, p]) => smoothLine(p, f.zones.smooth ?? 0.3, step));
  const Z = buildZones(lines, { snap: (f.zones.snap ?? 0.25) * g, merge: 0.5, minArea: g * g, edge: { x: px, y: py, width: f.width, height: f.height } });
  assert.ok(Z.zones.length >= 5, `street: ${Z.zones.length} zones`);
  for ( const s of [g / 4, g / 3, 7, g / 2] ) same(samplesOf(Z, null, s), samplesOfRef(Z, null, s), `street step ${s}`);
  const t0 = performance.now(); samplesOfRef(Z, null, g / 4); const t1 = performance.now(); samplesOf(Z, null, g / 4); const t2 = performance.now();
  ok(`street: ${Z.zones.length} zones, the same samples at 4 steps (per-point ${(t1 - t0).toFixed(1)} ms, scan ${(t2 - t1).toFixed(1)} ms)`);
}

// 2. random zones: star rings with holes, on a grid that puts vertices and edges exactly on sample rows / columns
{
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const star = (cx, cy, r, n, snap) => { const p = []; for ( let i = 0; i < n; i++ ) { const a = (i / n) * Math.PI * 2, rr = r * (0.45 + 0.55 * rnd()); let x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if ( snap ) { x = Math.round(x / snap) * snap + snap / 2; y = Math.round(y / snap) * snap + snap / 2; } p.push(x, y); } return p; };
  const box = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1];
  for ( let k = 0; k < 300; k++ ) {
    const step = [5, 8, 12.5, 25][k % 4], snap = k % 3 === 0 ? step : k % 3 === 1 ? step / 2 : 0;
    const zones = [];
    for ( let i = 0; i < 4; i++ ) {
      const cx = 200 + rnd() * 600, cy = 200 + rnd() * 600, r = 60 + rnd() * 140;
      const parts = [[star(cx, cy, r, 5 + Math.floor(rnd() * 20), snap)]];
      if ( rnd() < 0.6 ) parts[0].push(star(cx, cy, r * 0.3, 4 + Math.floor(rnd() * 6), snap));        // a hole (may poke out: still the old rule)
      if ( rnd() < 0.3 ) parts.push([box(cx + r, cy, cx + r + 3 * step, cy + 2 * step)]);              // a second part, edges on sample lines
      zones.push({ id: i, parts, rings: parts[0], label: { x: cx, y: cy } });
    }
    same(samplesOf({ zones }, null, step), samplesOfRef({ zones }, null, step), `random #${k}`);
  }
  ok("300 random sets of zones (holes, second parts, vertices on sample rows): the same samples");
}
