// node table.mjs <tag> : medians per scenario per build over all rounds x reps
import fs from "node:fs";
const tag = process.argv[2]; const files = fs.readdirSync("ab").filter((f) => f.startsWith(tag + "-") && f.endsWith(".json"));
const agg = {};
for ( const f of files ) { const b = f.includes("-base-") ? "base" : "after"; const d = JSON.parse(fs.readFileSync("ab/" + f, "utf8"));
  for ( const [s, runs] of Object.entries(d) ) for ( const r of runs ) ((agg[s] ??= {})[b] ??= []).push(r); }
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const cols = [["pans", (r) => r.pans], ["orbit ms", (r) => r.prof.orbit], ["LockView ms", (r) => r.prof.lockview], ["weather set ms", (r) => r.prof.weatherSetting], ["zones hover ms", (r) => r.prof.zonesHover], ["mm own ms", (r) => r.prof.mmAll], ["busy ms", (r) => r.prof.busy], ["layouts", (r) => r.layouts], ["layout ms", (r) => r.layoutMs], ["style ms", (r) => r.styleMs], ["frames >16.7", (r) => r.over17], ["frames >33", (r) => r.over33]];
console.log(`| scenario | build | n | ${cols.map((c) => c[0]).join(" | ")} |`); console.log(`|${"---|".repeat(cols.length + 3)}`);
for ( const [s, bb] of Object.entries(agg) ) for ( const b of ["base", "after"] ) { const rs = bb[b] ?? []; if ( !rs.length ) continue;
  console.log(`| ${s} | ${b} | ${rs.length} | ${cols.map(([, f]) => { const v = med(rs.map(f)); return Number.isInteger(v) ? v : v.toFixed(1); }).join(" | ")} |`); }
