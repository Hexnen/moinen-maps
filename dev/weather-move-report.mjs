// The weather-vs-camera report from dev/weather-move.mjs `start` runs (mm-rec/move-<label>.json):
//   node dev/weather-move-report.mjs <mm-rec dir> A1[,A2] [B1,B2]
// Per case x DPR x day/dark x move: weather OFF vs ON over the reps (late frames, worst interval, frame work p95 / max, long frames,
// weather CPU max, input delay p95 / max, long animation frames). With B labels: the same for B, and the ON rows of A vs B.
import fs from "node:fs";
import path from "node:path";

const [dir, aL, bL] = process.argv.slice(2);
const read = (ls) => ls ? ls.split(",").flatMap((l) => JSON.parse(fs.readFileSync(path.join(dir, `move-${l}.json`), "utf8"))) : null;
const A = read(aL), B = read(bL);
const max = (a) => a.length ? Math.max(...a) : 0;
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const key = (r) => `${r.case} dpr${r.dpr} ${r.dark ? "dark" : "day "}${(r.cpu ?? 1) > 1 ? ` cpu${r.cpu}x` : ""} ${r.kind}`;
function group(rows) {
  const g = new Map();
  for ( const r of rows ) { const k = key(r); if ( !g.has(k) ) g.set(k, { off: [], on: [] }); g.get(k)[r.on ? "on" : "off"].push(r); }
  return g;
}
const cell = (rs0) => {
  const rs = rs0.filter((r) => r.iv), bad = rs0.length - rs.length;   // (a move with under 3 frames drawn has no summary)
  if ( !rs.length ) return bad ? `${bad} move(s) drew < 3 frames` : "-";
  const fr = rs.reduce((s, r) => s + r.frames, 0), late = rs.reduce((s, r) => s + r.late, 0);
  return `late ${late}/${fr} ivMax ${f1(max(rs.map((r) => r.iv.max)))} work p95 ${f1(max(rs.map((r) => r.work.p95)))} max ${f1(max(rs.map((r) => r.work.max)))} long ${rs.reduce((s, r) => s + r.work.long, 0)} wxMax ${f1(max(rs.map((r) => r.wx.max)))} delay p95 ${f1(max(rs.map((r) => r.delay.p95)))} max ${f1(max(rs.map((r) => r.delay.max)))} loaf ${rs.reduce((s, r) => s + r.loaf.n, 0)}`;
};
for ( const [lab, rows] of [["A", A], ["B", B]] ) {
  if ( !rows ) continue;
  console.log(`\n== ${lab} (${(lab === "A" ? aL : bL)}): case dpr day/dark move | weather OFF | weather ON`);
  let tot = { off: [0, 0, 0], on: [0, 0, 0] };
  for ( const [k, v] of group(rows) ) {
    console.log(`${k.padEnd(32)} | ${cell(v.off)} | ${cell(v.on)}`);
    for ( const s of ["off", "on"] ) for ( const r of v[s].filter((x) => x.iv) ) { tot[s][0] += r.late; tot[s][1] += r.frames; tot[s][2] += r.work.long; }
  }
  console.log(`TOTAL late frames OFF ${tot.off[0]}/${tot.off[1]}  ON ${tot.on[0]}/${tot.on[1]};  frames with work > 16.7 ms OFF ${tot.off[2]} ON ${tot.on[2]}`);
  const ons = rows.filter((r) => r.on && r.lates?.length);
  if ( ons.length ) { console.log("late frames with the weather ON (what the frame did):"); for ( const r of ons ) console.log(`  ${key(r)} r${r.rep}: ${r.lates.slice(0, 3).join(" ; ")}`); }
}
