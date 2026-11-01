// Runs every node-testable check of the module:   node dev/run-all.mjs [-v]
// Every dev/*.test.mjs and dev/*-audit.mjs, each in its own node process (they load different versions of the same modules); prints
// one line per script (its last line, or its whole output with -v or on failure) and exits non-zero when any of them fails.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dev = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(dev, "..");
const verbose = process.argv.includes("-v");
const scripts = fs.readdirSync(dev).filter((f) => /\.test\.mjs$|-audit\.mjs$/.test(f)).sort();
let failed = 0;
const t0 = Date.now();
for ( const f of scripts ) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(dev, f)], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd(), ok = r.status === 0;
  if ( !ok ) failed++;
  const last = out.split("\n").filter(Boolean).pop() ?? "";
  console.log(`${ok ? "PASS" : "FAIL"} ${f.padEnd(32)} ${((Date.now() - t) / 1000).toFixed(1).padStart(5)} s   ${last}`);
  if ( verbose || !ok ) console.log(out.split("\n").map((l) => `     | ${l}`).join("\n"));
}
console.log(`${scripts.length - failed}/${scripts.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
