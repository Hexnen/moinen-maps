// Table of an arrival A/B (dev/arrival-ab.mjs output): per build, the median (and the runs) of
//   load      tearDown -> canvasReady starts (ms)
//   ready     the canvasReady handlers (ms), of it moinen-maps (profile, ms)
//   tick1     the first canvas frame after canvasReady (ms)
//   frame1    canvasReady starts -> the first frame shown after it (ms)
//   card      canvasReady starts -> the first frame after the title card is in the page (ms; null: no card)
//   cardDown  tearDown (the dip starts) -> that frame (ms)
//   stall     the longest frame interval from canvasReady to +4 s (ms)
//   longest   the longest frame interval of the whole switch (ms)
// Runs that met a program-cache miss (a link > 400 ms, "cold") are listed apart: the GPU process then decides most of the time.
// Usage: node dev/arrival-ab-table.mjs ab.json [ab2.json ...]
import fs from "node:fs";

// (a run with no frame at all after canvasReady - stall 0 - lost its page's ticks: not a measurement; dropped and counted)
const all = process.argv.slice(2).flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")).runs.map((r) => ({ ...r, file: f })));
const runs = all.filter((r) => r.error || r.stallMs > 0);
const med = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if ( !s.length ) return null; const m = s.length >> 1; return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2); };
const from = (r) => (r.marks?.readyFirst != null ? -r.marks.readyFirst : r.readyDispatch ?? 0);     // ms from readyFirst to ready
const row = (r) => ({
  load: r.loadMs != null ? r.loadMs - from(r) : null, ready: r.readyDispatch != null ? Math.round(r.readyDispatch) : null, readyMM: r.dispatchProf?.by?.mm != null ? Math.round(r.dispatchProf.by.mm) : null,
  tick1: r.firstTickMs != null ? Math.round(r.firstTickMs) : null,
  frame1: r.firstFrameAfterReady != null ? r.firstFrameAfterReady + from(r) : null,
  card: r.cardFrameAt != null ? Math.round(r.cardFrameAt + from(r)) : null, cardDown: r.cardFromDown ?? null,
  stall: Math.round(r.stallMs), longest: Math.round(r.longestMs), cold: !!r.cold
});
const cols = ["load", "ready", "readyMM", "tick1", "frame1", "card", "cardDown", "stall", "longest"];
console.log(`| build | runs | ${cols.join(" | ")} |`);
console.log(`|${"---|".repeat(cols.length + 2)}`);
for ( const cold of [false, true] ) for ( const b of ["A", "B"] ) {
  const rs = runs.filter((r) => r.build === b && !r.error).map(row).filter((x) => x.cold === cold);
  if ( !rs.length ) continue;
  console.log(`| ${b}${cold ? " (cold)" : ""} | ${rs.length} | ${cols.map((c) => `${med(rs.map((x) => x[c])) ?? "-"} (${rs.map((x) => x[c] ?? "-").join("/")})`).join(" | ")} |`);
}
const errs = runs.filter((r) => r.error);
if ( errs.length ) console.log(`errors: ${errs.length}`);
if ( all.length - runs.length ) console.log(`dropped (no frame after canvasReady): ${all.length - runs.length}`);
