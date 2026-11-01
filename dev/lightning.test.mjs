// Lightning bolts, flame tongues, ripple arcs and arcane sigils (scripts/destruction/pixel-fx.mjs): pure geometry, checked in node.
//   node dev/lightning.test.mjs
//  1. a bolt is a TREE, not an area-filling web: one main channel, 2-4 forks (+ at most one twig), its pixels cover a small share of
//     its bounding box, forks shorter than the main channel and leaving it at 30-60 degrees, the main channel tapers (two pixels wide
//     near its root, one far out), glow pixels only round the core, deterministic;
//  2. a flame tongue is ONE connected shape that narrows upwards, rises screen-up, white-yellow at the base core and dark at the tip;
//  3. ripples are broken arcs: several separate arcs, none a closed ring, fewer pixels as they fade;
//  4. sigils: 2-4 strokes plus ticks, never a '+' (no two strokes crossing at right angles through their middles), deterministic.
import { boltTree, boltCells, tongueCells, arcCells, sigilStrokes, sigilCells } from "../scripts/destruction/pixel-fx.mjs";

let failed = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) failed++; };
const seeds = Array.from({ length: 40 }, (_, i) => i * 37 + 5);

/* 1. bolts */
{
  let maxShare = 0, forkBad = 0, angBad = 0, taperBad = 0, glowBad = 0, nfBad = 0;
  for ( const s of seeds ) {
    const L = 30 + (s % 50), t = boltTree(s, 0, 0, L * 0.3, L), c = boltCells(t);
    const main = t.forks.filter((f) => f.depth === 1), twigs = t.forks.filter((f) => f.depth > 1);
    if ( main.length < 2 || main.length > 4 || twigs.length > 1 ) nfBad++;
    const xs = c.core.map((q) => q[0]), ys = c.core.map((q) => q[1]);
    const box = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1);
    maxShare = Math.max(maxShare, c.core.length / box);
    const dir = Math.atan2(t.main.at(-1)[1] - t.main[0][1], t.main.at(-1)[0] - t.main[0][0]);
    for ( const f of main ) {
      const fl = Math.hypot(f.pts.at(-1)[0] - f.pts[0][0], f.pts.at(-1)[1] - f.pts[0][1]);
      if ( fl > t.len * 0.45 ) forkBad++;
      const fa = Math.atan2(f.pts.at(-1)[1] - f.pts[0][1], f.pts.at(-1)[0] - f.pts[0][0]);
      const d = Math.abs(((fa - dir + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI;
      if ( d < 22 || d > 68 ) angBad++;   // (30-60 degrees off the channel's heading; the fork's own jag bends it a little)
    }
    const w2 = c.core.filter((q) => q[2] === 2), near = w2.filter((q) => Math.hypot(q[0], q[1]) < t.len * 0.5).length;
    if ( !w2.length || near < w2.length * 0.9 ) taperBad++;
    const coreSet = new Set(c.core.map((q) => `${q[0]},${q[1]}`));
    if ( c.glow.some((q) => coreSet.has(`${q[0]},${q[1]}`)) ) glowBad++;
  }
  ok(nfBad === 0, `every bolt has 2-4 forks and at most one twig (bad ${nfBad}/${seeds.length})`);
  ok(maxShare < 0.3, `a bolt never fills its area: core pixels <= 30 % of its bounding box (worst ${(maxShare * 100).toFixed(1)} %)`);
  ok(forkBad === 0, `forks are shorter than half the main channel (bad ${forkBad})`);
  ok(angBad === 0, `forks leave the main channel obliquely (bad ${angBad})`);
  ok(taperBad === 0, `the main channel tapers: its two-pixel part lies in its root half (bad ${taperBad})`);
  ok(glowBad === 0, `glow pixels only round the core (bad ${glowBad})`);
  const a = JSON.stringify(boltCells(boltTree(77, 0, 0, 10, 50))), b = JSON.stringify(boltCells(boltTree(77, 0, 0, 10, 50)));
  ok(a === b, "a bolt is deterministic for its seed");
}

/* 2. flame tongues */
{
  let disc = 0, widen = 0, down = 0, bands = 0;
  for ( const s of seeds ) for ( const h of [4, 8, 14] ) for ( const w of [2, 4, 6] ) {
    const c = tongueCells(h, w, s * 0.37, s), set = new Set(c.map(([x, y]) => `${x},${y}`));
    // connected (4-neighbour flood fill)
    const seen = new Set([`${c[0][0]},${c[0][1]}`]), st = [c[0]];
    while ( st.length ) { const [x, y] = st.pop(); for ( const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] ) { const k = `${x + a},${y + b}`; if ( set.has(k) && !seen.has(k) ) { seen.add(k); st.push([x + a, y + b]); } } }
    if ( seen.size !== set.size ) disc++;
    if ( c.some(([, y]) => y > 0) ) down++;
    const rows = new Map(); for ( const [x, y] of c ) rows.set(y, (rows.get(y) ?? 0) + 1);
    const ys = [...rows.keys()].sort((p, q) => q - p);
    if ( rows.get(ys.at(-1)) > rows.get(ys[0]) + 1 ) widen++;
    const base = c.filter(([, y]) => y === 0).map((q) => q[2]), tip = c.filter(([, y]) => y === ys.at(-1)).map((q) => q[2]);
    if ( h >= 8 && (Math.min(...base) > 1 || Math.max(...tip) < 3) ) bands++;
  }
  ok(disc === 0, `a flame tongue is one connected shape (broken ${disc})`);
  ok(down === 0, `tongues rise screen-up (below the base: ${down})`);
  ok(widen === 0, `tongues narrow upwards (tip wider than base: ${widen})`);
  ok(bands === 0, `hot core at the base, red-dark at the tip (bad ${bands})`);
}

/* 3. ripple arcs */
{
  let closed = 0, few = 0, fade = 0;
  for ( const s of seeds ) {
    const c = arcCells(0, 0, 16, 0, s), arcs = new Set(c.map((q) => q[2]));
    if ( arcs.size < 2 ) few++;
    // never a closed ring: angular coverage below 80 %
    const bins = new Set(c.map(([x, y]) => Math.floor((Math.atan2(y / 0.8, x) + Math.PI) / (2 * Math.PI) * 36)));
    if ( bins.size > 36 * 0.8 ) closed++;
    if ( arcCells(0, 0, 16, 0.8, s).length >= c.length ) fade++;
  }
  ok(few === 0, `ripples are several separate arcs (bad ${few})`);
  ok(closed === 0, `no ripple closes into a ring (bad ${closed})`);
  ok(fade === 0, `arcs drop out as they fade (bad ${fade})`);
}

/* 4. sigils */
{
  let count = 0, cross = 0;
  for ( const s of seeds ) {
    const st = sigilStrokes(s), body = st.filter((p) => p.length > 2 || Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) > 0.6);
    if ( body.length < 2 || st.length > 7 ) count++;
    // a '+': two straight two-point strokes of similar length crossing near both their middles at about 90 degrees
    const lines = st.filter((p) => p.length === 2);
    for ( let i = 0; i < lines.length; i++ ) for ( let j = i + 1; j < lines.length; j++ ) {
      const [a, b] = [lines[i], lines[j]], ma = [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2], mb = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
      const la = Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]), lb = Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]);
      const dot = Math.abs(((a[1][0] - a[0][0]) * (b[1][0] - b[0][0]) + (a[1][1] - a[0][1]) * (b[1][1] - b[0][1])) / (la * lb || 1));
      if ( Math.hypot(ma[0] - mb[0], ma[1] - mb[1]) < 0.15 * Math.max(la, lb) && dot < 0.2 && Math.abs(la - lb) < 0.3 * Math.max(la, lb) ) cross++;
    }
  }
  ok(count === 0, `a sigil has 2-4 strokes and a few ticks (bad ${count})`);
  ok(cross === 0, `no sigil is a '+' cross (found ${cross})`);
  ok(JSON.stringify(sigilCells(9, 10, 10, 3)) === JSON.stringify(sigilCells(9, 10, 10, 3)), "sigils are deterministic");
}

console.log(failed ? `FAILED ${failed}` : "PASS");
process.exit(failed ? 1 : 0);
