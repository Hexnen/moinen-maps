// Node: node dev/weather-opt-report.mjs <mm-rec dir> A1[,A2] B1[,B2]
// Weather GPU / CPU per frame (ms; the sum over the weather passes and tickers of weather-opt.mjs costStart) per case and view, A vs
// B: the mean over every rep and file of a side, the a/a spread (the largest difference between two reps of the same side), and the
// change B - A in % of A. The weak-GPU rows (every pass drawn twice) separately.
import fs from "node:fs";
import path from "node:path";

const [dir, aArg, bArg] = process.argv.slice(2);
const load = (labels) => labels.split(",").flatMap((l) => JSON.parse(fs.readFileSync(path.join(dir, `cost-${l}.json`), "utf8")));
const A = load(aArg), B = bArg ? load(bArg) : [];
const key = (r) => `${r.e}${r.l} z${r.z} dpr${r.dpr} x${r.weak}`;
const group = (rows) => { const m = new Map(); for ( const r of rows ) { const k = key(r); if ( !m.has(k) ) m.set(k, []); m.get(k).push(r); } return m; };
const GA = group(A), GB = group(B);
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const spread = (a) => a.length > 1 ? Math.max(...a) - Math.min(...a) : 0;
const f2 = (x) => x.toFixed(2).padStart(6);
const pc = (b, a) => (a > 0.005 ? `${((b - a) / a * 100).toFixed(0)}%` : "-").padStart(6);
let tot = { ga: 0, gb: 0, ca: 0, cb: 0 };
console.log("case view weak      | GPU A  (aa)    B  (aa)   chg | CPU A  (aa)    B  (aa)   chg");
for ( const [k, ra] of GA ) {
  const rb = GB.get(k) ?? [];
  const ga = ra.map((r) => r.gpu), gb = rb.map((r) => r.gpu), ca = ra.map((r) => r.cpu), cb = rb.map((r) => r.cpu);
  console.log(`${k.padEnd(24)}| ${f2(mean(ga))} (${spread(ga).toFixed(2)}) ${rb.length ? f2(mean(gb)) + " (" + spread(gb).toFixed(2) + ")" + pc(mean(gb), mean(ga)) : ""} | ${f2(mean(ca))} (${spread(ca).toFixed(2)}) ${rb.length ? f2(mean(cb)) + " (" + spread(cb).toFixed(2) + ")" + pc(mean(cb), mean(ca)) : ""}`);
  if ( rb.length && k.endsWith("x1") ) { tot.ga += mean(ga); tot.gb += mean(gb); tot.ca += mean(ca); tot.cb += mean(cb); }
}
if ( B.length ) console.log(`TOTAL (x1 rows) GPU A ${tot.ga.toFixed(2)} B ${tot.gb.toFixed(2)} (${pc(tot.gb, tot.ga).trim()})  CPU A ${tot.ca.toFixed(2)} B ${tot.cb.toFixed(2)} (${pc(tot.cb, tot.ca).trim()})`);
// the biggest passes of A (where the time goes)
const passes = new Map();
for ( const r of A ) if ( r.weak === 1 ) for ( const [p, v] of Object.entries(r.passes ?? {}) ) passes.set(`${r.e}:${p}`, (passes.get(`${r.e}:${p}`) ?? 0) + v.f);
console.log("A: per-pass ms summed over views and reps (weak 1):", [...passes].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", "));
