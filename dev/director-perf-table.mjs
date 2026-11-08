// node dev/director-perf-table.mjs before.json after.json [page,page]   one row per scenario x page from two dev/director-perf.mjs --out
// files: "before -> after" for the numbers that say what a client pays (whole-frame rAF, ticker, GPU per canvas frame, Director JS
// inclusive and its longest task, layouts / style recalcs, long animation frames). One file: just its numbers.
import fs from "node:fs";
const [a, b, pagesArg] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(a, "utf8")), B = b && b !== "-" ? JSON.parse(fs.readFileSync(b, "utf8")) : null;
const pages = (pagesArg ?? "gm,p1,p2").split(",");
const f = (v, d = 1) => (v == null ? "-" : typeof v === "number" ? +v.toFixed(d) : v);
const pair = (x, y, d = 1) => (B ? `${f(x, d)} -> ${f(y, d)}` : `${f(x, d)}`);
const rows = [["scenario", "page", "rAF p50/p95", "over33", "tick p95", "gpu p50/p95 ms", "dir incl ms", "of it camera pan", "dir run ms", "layouts", "styles", "sat60 (dir / dir w/o camera)"]];
for ( const s of Object.keys(A.scen) ) for ( const p of pages ) {
  const x = A.scen[s]?.[p], y = B?.scen?.[s]?.[p]; if ( !x ) continue;
  const rp = (v) => (v ? `${f(v.rafP50)}/${f(v.rafP95)}` : "-"), gp = (v) => (v?.gpuP50 != null ? `${f(v.gpuP50, 2)}/${f(v.gpuP95, 2)}` : "-");
  rows.push([s, p, B ? `${rp(x)} -> ${rp(y)}` : rp(x), pair(x.over33, y?.over33, 0), pair(x.tickP95, y?.tickP95), B ? `${gp(x)} -> ${gp(y)}` : gp(x),
    pair(x.dirInclMs, y?.dirInclMs), pair(x.dirCamMs, y?.dirCamMs), pair(x.dirRunMax, y?.dirRunMax), pair(x.layouts, y?.layouts, 0), pair(x.styles, y?.styles, 0), B ? `${f(x.sat60)} (${f(x.sat60dir)}/${f(x.sat60own)}) -> ${f(y?.sat60)} (${f(y?.sat60dir)}/${f(y?.sat60own)})` : `${f(x.sat60)} (${f(x.sat60dir)}/${f(x.sat60own)})`]);
}
console.log(rows.map((r) => `| ${r.join(" | ")} |`).join("\n").replace(/\n/, `\n|${rows[0].map(() => "---").join("|")}|\n`));
