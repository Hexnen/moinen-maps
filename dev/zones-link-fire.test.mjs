// The zone fire states (scripts/zones/link.mjs derive / fireIn, segment boxes and zone boxes since ultra1-zones 2026-11-10) are exactly
// what the old per-segment test gave: same strokes, same hits, same states, for random zones and long / short / single-point strokes,
// points lying exactly on the radius included.
import assert from "node:assert/strict";
import { fireIn, derive, LEVEL_INTENSITY } from "../scripts/zones/link.mjs";

const ok = (name) => console.log(`ok   ${name}`);

// the old fireIn, verbatim (the reference)
function segDist2(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
  const px = ax + dx * t - x, py = ay + dy * t - y;
  return px * px + py * py;
}
function strokeCovers(s, x, y) {
  const p = s.p, r2 = s.r * s.r;
  if ( p.length === 2 ) return (p[0] - x) ** 2 + (p[1] - y) ** 2 <= r2;
  for ( let i = 2; i < p.length; i += 2 ) if ( segDist2(x, y, p[i - 2], p[i - 1], p[i], p[i + 1]) <= r2 ) return true;
  return false;
}
const boxOf = (s) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for ( let i = 0; i < s.p.length; i += 2 ) { x0 = Math.min(x0, s.p[i]); x1 = Math.max(x1, s.p[i]); y0 = Math.min(y0, s.p[i + 1]); y1 = Math.max(y1, s.p[i + 1]); } return [x0 - s.r, y0 - s.r, x1 + s.r, y1 + s.r]; };
function fireInRef(samples, fire) {
  const out = [];
  for ( const s of fire ?? [] ) {
    if ( s.k !== "fire" || s.o !== undefined || !s.p?.length ) continue;
    const [x0, y0, x1, y1] = boxOf(s);
    let hits = 0;
    for ( let i = 0; i < samples.length; i += 2 ) {
      const x = samples[i], y = samples[i + 1];
      if ( x < x0 || x > x1 || y < y0 || y > y1 ) continue;
      if ( strokeCovers(s, x, y) ) hits++;
    }
    if ( hits ) out.push({ s, hits });
  }
  return out;
}
function deriveFireRef(samplesById, fire) {
  const out = new Map();
  for ( const [id, pts] of samplesById ) {
    const n = pts.length / 2, f = fireInRef(pts, fire);
    const hit = f.reduce((m, x) => Math.max(m, x.hits), 0);
    if ( f.length && (hit / n >= 0.05 || hit >= 2) ) out.set(id, { fire: Math.max(...f.map((x) => LEVEL_INTENSITY[x.s.lv ?? 2] ?? 8)) });
  }
  return out;
}

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
for ( let run = 0; run < 40; run++ ) {
  const step = 25, zones = new Map();
  for ( let id = 0; id < 30; id++ ) {
    const x0 = rnd() * 4000, y0 = rnd() * 4000, w = 50 + rnd() * 900, h = 50 + rnd() * 900, pts = [];
    for ( let y = y0 + step / 2; y < y0 + h; y += step ) for ( let x = x0 + step / 2; x < x0 + w; x += step ) if ( rnd() < 0.8 ) pts.push(x, y);
    if ( !pts.length ) pts.push(x0, y0);
    zones.set(id, pts);
  }
  const fire = [];
  for ( let i = 0; i < 60; i++ ) {
    const n = rnd() < 0.2 ? 1 : 2 + Math.floor(rnd() * 40), p = [];
    let x = rnd() * 4000, y = rnd() * 4000;
    for ( let k = 0; k < n; k++ ) { p.push(Math.round(x), Math.round(y)); x += (rnd() - 0.5) * 200; y += (rnd() - 0.5) * 200; }
    // radius a multiple of the sample step on some: samples exactly on the edge of the reach
    const r = rnd() < 0.3 ? step * (1 + Math.floor(rnd() * 4)) : 20 + rnd() * 150;
    fire.push({ id: `f${i}`, k: rnd() < 0.85 ? "fire" : "smoke", p, r, lv: 1 + Math.floor(rnd() * 3), ...(rnd() < 0.05 ? { o: 1 } : {}) });
  }
  for ( const [id, pts] of zones ) {
    const a = fireIn(pts, fire).map((f) => [f.s.id, f.hits]), b = fireInRef(pts, fire).map((f) => [f.s.id, f.hits]);
    assert.deepEqual(a, b, `run ${run} zone ${id}`);
  }
  // twice: the second call reads the kept boxes
  for ( let t = 0; t < 2; t++ ) assert.deepEqual([...derive(zones, { fire })], [...deriveFireRef(zones, fire)], `run ${run} derive`);
  // a stroke moved in place (new path): its boxes are worked out again
  fire[0].p = fire[0].p.map((v) => v + 37); fire[1].r *= 1.5;
  assert.deepEqual([...derive(zones, { fire })], [...deriveFireRef(zones, fire)], `run ${run} derive after a change`);
}
ok("fireIn / derive: the same hits and fire states as the per-segment test (40 random maps)");
