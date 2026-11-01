// Debris at the map's border:   node dev/debris-edge.test.mjs
// Strokes touching each of the 4 edges and the 4 corners, every kind, at default and at max Throw (scatter) / Debris / torn borders:
//   1. nothing is drawn past the edge: every piece sprite lies inside the scene (pieces landing past it are culled, ones across it
//      clipped); the bake counts the culled pieces (stats.culled) and some are culled at the border, none for a stroke in the middle;
//   2. few thrown chips land near the border: at most 5 % of the drawn thrown chips have their centre within 2 art px of the edge;
//   3. no pile: along each border, a histogram of the chips' centres in the 12 px strip next to it (bins of 2 px across the border)
//      has no spike - no bin holds more than 35 % of that strip's chips when it has 10 or more.
// Pieces are placed in the window as it would be without the scene's edge: nothing is squeezed, bounced or clamped at the border.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Core = await import(pathToFileURL(path.join(root, "scripts/destruction/core.mjs")).href);
const F = Core.META_FIELDS, K = 2, AW = 300, AH = 220, MW = AW / K, MH = AH / K;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };

const hash = (x, y, s) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const data = new Uint8ClampedArray(AW * AH * 4);
for ( let y = 0; y < AH; y++ ) for ( let x = 0; x < AW; x++ ) {
  const n = hash(x, y, 3) * 30 - 15, o = (y * AW + x) * 4, pave = (x % 12 === 0 || y % 10 === 0);
  data.set(x < 150 ? [70 + n, 120 + n, 52 + n, 255] : pave ? [70 + n, 68 + n, 66 + n, 255] : [150 + n, 146 + n, 140 + n, 255], o);
}
const MAP = { w: AW, h: AH, data };
function disc(id, t, cx, cy, r) {
  const bx0 = Math.max(0, Math.floor(cx - r)), by0 = Math.max(0, Math.floor(cy - r)), bx1 = Math.min(MW - 1, Math.ceil(cx + r)), by1 = Math.min(MH - 1, Math.ceil(cy + r));
  const w = bx1 - bx0 + 1, h = by1 - by0 + 1, bytes = new Uint8Array(w * h);
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) { const d = Math.hypot(bx0 + x + 0.5 - cx, by0 + y + 0.5 - cy); if ( d <= r ) bytes[y * w + x] = d < r * 0.6 ? 3 : 2; }
  return { id, k: 0, t, x0: bx0, y0: by0, w, h, bytes, path: null };
}
const BASE = { debris: 0.7, scatter: 1, lift: 1, rubble: 0.6, halo: 0.6, edge: 0.7, material: "auto", jagged: false, jag: 0.6, directional: false, anim: true, idle: true, fxWho: "all", entry: true, entrySpeed: 1, entryPower: 1 };
const MAX = { ...BASE, debris: 1, scatter: 2, jagged: true, jag: 1 };
// centres (mask px) touching the edges and corners
const SPOTS = [[MW / 2, 2], [MW / 2, MH - 3], [2, MH / 2], [MW - 3, MH / 2], [3, 3], [MW - 4, 3], [3, MH - 4], [MW - 4, MH - 4]];

const chips = [];
let culled = 0, generated = 0, outsideSprites = 0;
for ( const [pn, params] of [["default", BASE], ["max", MAX]] ) for ( let t = 0; t < Core.TYPES.length; t++ ) {
  if ( Core.TYPES[t] === "flood" || Core.TYPES[t] === "cracks" ) continue;
  SPOTS.forEach(([cx, cy], s) => {
    const res = Core.bake({ objects: [disc(`e${t}${s}`, t, cx, cy, 9)], mw: MW, mh: MH, K, aw: AW, ah: AH, seed: 77 + s, params, map: MAP, mapKey: "edge" });
    culled += res.stats.culled; generated += res.stats.chips;
    for ( let o = 0; o < res.meta.length; o += F ) {
      const m = res.meta.subarray(o, o + F);
      if ( m[0] === 1 && (m[5] < 0 || m[6] < 0 || m[5] + m[3] > AW || m[6] + m[4] > AH) ) outsideSprites++;
      if ( m[0] !== 1 || !(m[11] & 2) ) continue;            // thrown chips only
      chips.push({ x: m[5] + m[3] / 2, y: m[6] + m[4] / 2, pn, t });
    }
  });
}
check(chips.length > 20, `thrown chips drawn: ${chips.length} (chips generated ${generated}, pieces culled past the edge ${culled})`);
check(outsideSprites === 0, `no piece sprite reaches past the scene's edge (${outsideSprites})`);
check(culled > 0, `pieces landing past the edge are culled, not kept: ${culled}`);
const mid = Core.bake({ objects: [disc("mid", 0, MW / 2, MH / 2, 9)], mw: MW, mh: MH, K, aw: AW, ah: AH, seed: 5, params: MAX, map: MAP, mapKey: "edge" });
check(mid.stats.culled === 0, `a stroke in the middle culls nothing (${mid.stats.culled})`);
const near = chips.filter((c) => c.x < 2 || c.y < 2 || c.x > AW - 2 || c.y > AH - 2).length;
check(near <= chips.length * 0.05, `chips within 2 art px of the border: ${near} of ${chips.length} (<= 5 %)`);
for ( const [name, dist] of [["top", (c) => c.y], ["bottom", (c) => AH - c.y], ["left", (c) => c.x], ["right", (c) => AW - c.x]] ) {
  const strip = chips.map(dist).filter((d) => d < 12);
  const bins = new Array(6).fill(0); for ( const d of strip ) bins[Math.max(0, Math.floor(d / 2))]++;
  const top = Math.max(...bins);
  check(strip.length < 10 || top <= strip.length * 0.35, `${name} border: no pile in the 12 px strip (bins ${bins.join(" ")})`);
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
