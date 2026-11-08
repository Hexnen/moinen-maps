// The weather cost A/B report from the per-build runs of dev/weather-cost.mjs `abStart` (mm-rec/ab-<label>.json):
//   node dev/weather-cost-ab.mjs <mm-rec dir> A1,A2 B1,B2
// Per view and case: frames identical across every run (hash of two frames at fixed shared times), the frame GPU / CPU (mean of the
// runs' medians), the weather passes' GPU per frame (sum of the per-pass timers) and CPU per frame (tickers), for A and B; the a/a
// control = the spread between the A runs (and between the B runs).
import fs from "node:fs";
import path from "node:path";

const [dir, aL, bL] = process.argv.slice(2);
const read = (l) => JSON.parse(fs.readFileSync(path.join(dir, `ab-${l}.json`), "utf8"));
const A = aL.split(",").map(read), B = bL.split(",").map(read);
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const gpuSum = (p) => Object.entries(p).filter(([k]) => !k.startsWith("cpu.")).reduce((s, [, v]) => s + v.f, 0);
const cpuSum = (p) => Object.entries(p).filter(([k]) => k.startsWith("cpu.")).reduce((s, [, v]) => s + v.f, 0);
const groups = (p) => {
  const g = {};
  for ( const [k, v] of Object.entries(p) ) { if ( k.startsWith("cpu.") ) continue; const n = k.replace(/\.cells$/, "").replace(/^torn\.art\..*/, "torn.art").replace(/^part\..*/, "parts"); g[n] = (g[n] ?? 0) + v.f; }
  return g;
};
console.log("view case | same frames | frame GPU A / B | weather GPU A (a/a) / B (b/b) | weather CPU A / B | per pass A -> B");
let allSame = true;
for ( let i = 0; i < A[0].length; i++ ) {
  const r = A[0][i], key = `dpr${r.dpr} z${r.z} ${r.e} L${r.l}`;
  const rows = [...A, ...B].map((x) => x[i]);
  if ( rows.some((x) => x.dpr !== r.dpr || x.z !== r.z || x.e !== r.e || x.l !== r.l) ) throw new Error(`row ${i} mismatch`);
  const same = rows.every((x) => x.sh.join() === r.sh.join());
  if ( !same ) allSame = false;
  const ga = A.map((x) => gpuSum(x[i].passes)), gb = B.map((x) => gpuSum(x[i].passes));
  const ca = A.map((x) => cpuSum(x[i].passes)), cb = B.map((x) => cpuSum(x[i].passes));
  const fa = mean(A.map((x) => x[i].frame.gpu)), fb = mean(B.map((x) => x[i].frame.gpu));
  const pa = groups(A[0][i].passes), pb = groups(B[0][i].passes);
  const per = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter((k) => (pa[k] ?? 0) > 0.02 || (pb[k] ?? 0) > 0.02)
    .map((k) => `${k} ${f2(mean(A.map((x) => groups(x[i].passes)[k] ?? 0)))}->${f2(mean(B.map((x) => groups(x[i].passes)[k] ?? 0)))}`).join(", ");
  console.log(`${key} | ${same ? "yes" : "NO " + rows.map((x) => x.sh.join("/")).join(" ")} | ${f2(fa)} / ${f2(fb)} | ${f2(mean(ga))} (${ga.map(f2).join(",")}) / ${f2(mean(gb))} (${gb.map(f2).join(",")}) | ${f2(mean(ca))} / ${f2(mean(cb))} | ${per}`);
}
console.log(allSame ? "ALL FRAMES IDENTICAL across every run" : "some frames differ (hashes)");

// the cell caches inside the B builds: pixel diffs (off vs off = a/a; off vs on) and the interleaved per-pass GPU (off / on, twice)
console.log("\nCELL CACHES in B (same page): view case | a/a px | off->on px (max) | weather GPU off1 off2 / on1 on2");
for ( let i = 0; i < B[0].length; i++ ) {
  const r = B[0][i]; if ( !r.cells ) continue;
  const aa = Math.max(...B.map((x) => x[i].cells.aa.px)), ab = B.map((x) => `${x[i].cells.ab.px} (${x[i].cells.ab.max})`).join(", ");
  const it = B.map((x) => x[i].inter).filter(Boolean);
  const g = it.length ? it.map((q) => q.map((p) => f2(gpuSum(p)))) : null;
  console.log(`dpr${r.dpr} z${r.z} ${r.e} L${r.l} | ${aa} | ${ab} | ${g ? g.map((q) => `${q[0]} ${q[2]} / ${q[1]} ${q[3]}`).join("  ;  ") : "-"}`);
}

// stored frames (the tornado rows): pixel diffs between every run and the first A run
const raw = (l, r) => { const f = path.join(dir, `ab-${l}-${r.dpr}-${r.z}-${r.e}${r.l}.bin`); return fs.existsSync(f) ? fs.readFileSync(f) : null; };
const pd = (a, b) => { let px = 0, m = 0; for ( let i = 0; i < a.length; i += 4 ) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); if ( d ) px++; if ( d > m ) m = d; } return `${px} px (max ${m})`; };
console.log(`\nSTORED FRAMES vs ${aL.split(",")[0]}: view case | ${[...aL.split(",").slice(1), ...bL.split(",")].join(" | ")}`);
for ( const r of A[0] ) {
  const a0 = raw(aL.split(",")[0], r); if ( !a0 ) continue;
  console.log(`dpr${r.dpr} z${r.z} ${r.e} L${r.l} | ${[...aL.split(",").slice(1), ...bL.split(",")].map((l) => { const b = raw(l, r); return b ? pd(a0, b) : "-"; }).join(" | ")}`);
}
