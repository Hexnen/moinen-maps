const fs = require("fs");
const p = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const self = new Map(), idx = new Map(p.nodes.map((n) => [n.id, n]));
for ( let i = 0; i < p.samples.length; i++ ) {
  const n = idx.get(p.samples[i]);
  const lines = n.positionTicks ?? [];
  const k = n.callFrame.functionName + ":" + (n.callFrame.lineNumber + 1);
  self.set(k, (self.get(k) || 0) + (p.timeDeltas[i] || 0));
}
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => k + " " + (v / 1000).toFixed(0) + "ms").join("\n"));
// hottest lines inside core
const lines = new Map();
for ( const n of p.nodes ) if ( n.callFrame.url.includes("core.mjs") ) for ( const t of n.positionTicks ?? [] ) lines.set(t.line, (lines.get(t.line) || 0) + t.ticks);
console.log("lines:", [...lines].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([l, t]) => l + ":" + t).join(" "));
