// STACK BENCH SUMMARY: interaction overhead = a combination's cost minus the sum of its layers' own costs (each alone minus the empty
// scene), per view (DPR, day / night, GM / player, zoom), for the GPU (timer query, MEDIAN ms per frame: robust to clock steps) and the CPU (ticker step, mean).
//   node dev/stack-bench-sum.mjs dev/out/stack/stack-dpr1.json [...]
// excess(XY) = XY - X - Y + base;  excess(all) = all - D - F20 - S - Wrain + 3 base  (> 0: the stack costs more than its parts)
import fs from "node:fs";

const PARTS = { "F20+S": ["F20", "S"], "F20+Wrain": ["F20", "Wrain"], "S+Wrain": ["S", "Wrain"], "D+F20": ["D", "F20"], "D+S": ["D", "S"], "D+Wrain": ["D", "Wrain"],
  all: ["D", "F20", "S", "Wrain"], "all-F5": ["D", "F5", "S", "Wrain"], "all-torn": ["D", "F20", "S", "Wtorn"], "all-sand": ["D", "F20", "S", "Wsand"] };
const f2 = (x) => (x === null || x === undefined || Number.isNaN(x) ? "  -  " : (x >= 0 ? " " : "") + x.toFixed(2));

export function excess(rows) {
  const out = [], views = new Map();
  for ( const r of rows ) if ( r.gpu ) { const k = `dpr${r.dpr} ${r.dark ? "night" : "day"} ${r.who} z${r.zoom}`; if ( !views.has(k) ) views.set(k, new Map()); views.get(k).set(r.state, r); }
  for ( const [view, m] of views ) {
    const base = m.get("base"); if ( !base ) continue;
    const b2 = m.get("base2"); if ( b2 ) out.push({ view, combo: "drift", gpu: b2.gpu.med, gpuSum: base.gpu.med, gpuX: b2.gpu.med - base.gpu.med, cpu: b2.cpu.mean, cpuSum: base.cpu.mean, cpuX: b2.cpu.mean - base.cpu.mean, gpuP95X: b2.gpu.p95 - base.gpu.p95, long: b2.long, rtX: 0, drawX: 0 });
    for ( const [combo, parts] of Object.entries(PARTS) ) {
      const c = m.get(combo); if ( !c || parts.some((p) => !m.has(p)) ) continue;
      const k = parts.length - 1, sum = (f) => parts.reduce((s, p) => s + f(m.get(p)), 0) - k * f(base);
      const g = (r) => r.gpu.med, u = (r) => r.cpu.mean, g95 = (r) => r.gpu.p95;
      out.push({ view, combo, gpu: c.gpu.med, gpuSum: sum(g), gpuX: c.gpu.med - sum(g), cpu: c.cpu.mean, cpuSum: sum(u), cpuX: c.cpu.mean - sum(u), gpuP95X: c.gpu.p95 - sum(g95), long: c.long, rtX: c.counters.rtSwitch - sum((r) => r.counters.rtSwitch), drawX: c.counters.draws - sum((r) => r.counters.draws) });
    }
  }
  return out;
}

/** Per owner (stack-bench attribute()): its GPU ms in the full stack vs alone - does a layer itself get dearer with the others on? */
export function ownerExcess(rows) {
  const out = [], alone = { fire: ["F20", "S"], destruction: ["D"], weather: ["Wrain"] }, views = new Map();
  for ( const r of rows ) if ( r.owners ) { const k = `dpr${r.dpr} ${r.dark ? "night" : "day"} ${r.who} z${r.zoom}`; if ( !views.has(k) ) views.set(k, new Map()); views.get(k).set(r.state, r); }
  for ( const [view, m] of views ) {
    const all = m.get("all"); if ( !all ) continue;
    for ( const [o, sts] of Object.entries(alone) ) {
      const a = sts.reduce((s, x) => s + (m.get(x)?.owners?.[o] ?? 0), 0), b = all.owners[o] ?? 0;
      out.push({ view, owner: o, alone: a, all: b, x: b - a });
    }
    const l0 = (m.get("base")?.owners?.lighting ?? 0);
    const lAlone = ["F20", "S", "Wrain", "D"].reduce((s, x) => s + (m.get(x)?.owners?.lighting ?? 0) - l0, 0) + l0;
    out.push({ view, owner: "lighting", alone: lAlone, all: all.owners.lighting ?? 0, x: (all.owners.lighting ?? 0) - lAlone });
  }
  return out;
}

export function summary(rows) {
  const lines = ["view                      combo      gpu   =sum   excess | cpu   =sum   excess | p95x  long  rtSwX drawX"];
  for ( const e of excess(rows) ) lines.push(`${e.view.padEnd(25)} ${e.combo.padEnd(9)} ${f2(e.gpu)} ${f2(e.gpuSum)} ${f2(e.gpuX)} | ${f2(e.cpu)} ${f2(e.cpuSum)} ${f2(e.cpuX)} | ${f2(e.gpuP95X)} ${String(e.long).padStart(4)} ${f2(e.rtX)} ${f2(e.drawX)}`);
  const ox = ownerExcess(rows);
  if ( ox.length ) { lines.push("", "GPU by owner: alone (sum of its layers) vs in the full stack"); for ( const e of ox ) lines.push(`${e.view.padEnd(25)} ${e.owner.padEnd(12)} ${f2(e.alone)} ${f2(e.all)} ${f2(e.x)}`); }
  const mv = rows.filter((r) => r.move);
  if ( mv.length ) { lines.push("", "pan/zoom (real ticker)    state      frames med   p95   max  >25 >34"); for ( const r of mv ) lines.push(`dpr${r.dpr} ${r.who.padEnd(20)} ${r.state.padEnd(9)} ${String(r.move.frames).padStart(6)} ${f2(r.move.med)} ${f2(r.move.p95)} ${f2(r.move.max)} ${String(r.move.over25).padStart(3)} ${String(r.move.over34).padStart(3)}`); }
  return lines.join("\n");
}

if ( process.argv[1]?.endsWith("stack-bench-sum.mjs") ) {
  const rows = process.argv.slice(2).flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  console.log(summary(rows));
}
