// node dev/director-perf-merge.mjs out.json in1.json in2.json ...   the mean of several dev/director-perf.mjs --out files (interleaved A/B
// rounds of one build) per scenario x page, for dev/director-perf-table.mjs. Numbers are averaged; lists and objects come from the first file.
import fs from "node:fs";
const [out, ...ins] = process.argv.slice(2);
const runs = ins.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const res = { label: `mean of ${runs.length}: ${runs.map((r) => r.label).join(", ")}`, throttle: runs[0].throttle, dpr: runs[0].dpr, scen: {} };
for ( const s of Object.keys(runs[0].scen) ) {
  res.scen[s] = {};
  for ( const p of Object.keys(runs[0].scen[s]) ) {
    const all = runs.map((r) => r.scen?.[s]?.[p]).filter(Boolean), o = { ...all[0] };
    for ( const [k, v] of Object.entries(all[0]) ) if ( typeof v === "number" ) { const xs = all.map((a) => a[k]).filter((x) => typeof x === "number"); o[k] = +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2); }
    res.scen[s][p] = o;
  }
}
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(out);
