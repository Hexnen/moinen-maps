// The moinen-maps parts of an arrival A/B (dev/arrival-ab.mjs output), per build, median over the warm runs (no program-cache miss):
//   zones     ms of scripts/zones/ (link + geometry + zones) in the canvasReady handlers (profile, nearest module frame)
//   hasPaint  ms of destruction/model.mjs hasPaint in the canvasReady handlers
//   readyMM   all moinen-maps ms in the canvasReady handlers
//   links1    ms of program links (getProgramParameter waits > 3 ms) inside the first canvas frame
//   upload1   ms of texImage2D inside the first canvas frame (the map image: Foundry's texture, drawn first by the map patch)
// Usage: node dev/arrival-ab-parts.mjs ab.json [...]
import fs from "node:fs";
const runs = process.argv.slice(2).flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")).runs).filter((r) => !r.error && r.stallMs > 0 && !r.cold);
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if ( !s.length ) return null; const m = s.length >> 1; return +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(1); };
const sumMM = (list, re) => (list ?? []).reduce((s, l) => { const m = l.match(/^(\S+):\S*:\d+ ([\d.]+)$/) ?? l.match(/^(.*) ([\d.]+)$/); return m && re.test(m[1]) ? s + Number(m[2]) : s; }, 0);
for ( const b of ["A", "B"] ) {
  const rs = runs.filter((r) => r.build === b);
  const v = rs.map((r) => {
    const t0 = r.ticks?.[0]?.[0] ?? null, t1 = t0 != null ? t0 + r.ticks[0][1] : null;
    return {
      zones: sumMM(r.dispatchProf?.mm, /scripts\/zones\//), hasPaint: sumMM(r.dispatchProf?.mm, /destruction\/model\.mjs.*hasPaint|^scripts\/destruction\/model\.mjs$/),
      readyMM: r.dispatchProf?.by?.mm ?? null,
      links1: t0 == null ? null : r.progs.filter((p) => p.at >= t0 - 1 && p.at <= t1).reduce((s, p) => s + p.ms, 0),
      upload1: r.firstTickProf ? Number((r.firstTickProf.self.find((l) => l.startsWith("texImage2D")) ?? "x 0").split(" ").pop()) : null
    };
  });
  console.log(b, rs.length, JSON.stringify(Object.fromEntries(Object.keys(v[0] ?? {}).map((k) => [k, med(v.map((x) => x[k]))]))));
}
