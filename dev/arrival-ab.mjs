// INTERLEAVED A/B of the arrival bench (dev/arrival-perf.mjs) on one lane: the lane's moinen-maps junction is pointed at build A, then B,
// then A ... (one switch per run, --reload in every run so the player page loads the build), rounds alternate the order (A B, B A, ...).
// Other agents' lanes load the same machine and move whole numbers by 30-90 %: only interleaved runs are compared.
// Usage (node 22, Windows):
//   node dev/arrival-ab.mjs <junction> <dirA> <dirB> <rounds> <out.json> -- <arrival-perf args without --reps / --out>
// e.g. node dev/arrival-ab.mjs C:\...\FoundryVTT-4\Data\modules\moinen-maps C:\wt-base C:\wt-new 3 ab.json -- 9533 http://127.0.0.141 http://127.0.0.142 street map --throttle 2 --dir on
// The junction is put back to <dirB> at the end (pass the lane's original target as dirB, or re-point it yourself).
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const argv = process.argv.slice(2), sep = argv.indexOf("--");
const [junction, dirA, dirB, roundsArg, out] = argv.slice(0, sep);
const pass = argv.slice(sep + 1), rounds = Number(roundsArg);
const point = (dir) => { try { execFileSync("cmd", ["/c", "rmdir", junction]); } catch { /* none */ } execFileSync("cmd", ["/c", "mklink", "/J", junction, dir]); };
const res = { at: new Date().toISOString(), A: dirA, B: dirB, args: pass, runs: [] };
const tmp = `${out}.part.json`;
for ( let r = 0; r < rounds; r++ ) {
  for ( const b of r % 2 ? ["B", "A"] : ["A", "B"] ) {
    point(b === "A" ? dirA : dirB);
    try { fs.unlinkSync(tmp); } catch { /* none */ }                  // (a run that fails must not leave the last run's file behind)
    const p = spawnSync(process.execPath, ["dev/arrival-perf.mjs", ...pass, "--reps", "1", "--reload", "--label", `${b}${r}`, "--out", tmp], { encoding: "utf8", timeout: 240000 });
    process.stderr.write(`[${b} round ${r}] ${(p.stderr || "").split("\n").filter((l) => l.startsWith("#")).join(" ")}\n`);
    let run = null; try { run = JSON.parse(fs.readFileSync(tmp, "utf8")).runs[0]; } catch { run = { error: (p.stderr || "").slice(-400) }; }
    res.runs.push({ build: b, round: r, ...run });
    fs.writeFileSync(out, JSON.stringify(res, null, 1));
  }
}
point(dirB);
try { fs.unlinkSync(tmp); } catch { /* none */ }
process.exit(0);
