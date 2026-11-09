// World weather "no squares" A/B in node (shots from dev/world-smooth.mjs `capture` / `offPng`, kept in mm-rec).
//   node dev/world-smooth-cmp.mjs <mm-rec dir> A B crop <case-view> <i> <x> <y> <w> <h> [k=5]
//     a side-by-side crop A | B of one shot (CSS px box), scaled k times with LANCZOS (smooth: the scaling neither hides squares by
//     blurring them away nor invents blocks; a NEAREST copy is written next to it as ...-nn.png for the record)
//   node dev/world-smooth-cmp.mjs <mm-rec dir> A B blocks [none-label]
//     per zoom-3 shot: how much of the WEATHER's own picture (the shot minus the same view with no weather, ws-<none-label>-none-...)
//     changes on the art grid's borders (an art cell is 3 x DPR device px at zoom 3; the grid's phase is searched, the best one
//     counts). 1 / (3 x DPR) = no grid (0.333 at DPR 1, 0.167 at DPR 2); 1 = every change on a cell border (a picture of squares).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [dir, A, B, cmd, ...rest] = process.argv.slice(2);
const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);

if ( cmd === "crop" ) {
  const [view, i, x, y, w, h, k = 5] = rest, d = Number(/-d(\d)/.exec(view)[1]);
  const box = [x, y, w, h].map((v) => Number(v) * d), kk = Number(k) / d;   // (k x the CSS size, whatever the DPR)
  for ( const [flag, suf] of [["lanczos", ""], ["neighbor", "-nn"]] ) {
    const out = join(dir, `wsc-${A}-${B}-${view}-${i}-${x}-${y}${suf}.png`);
    const f = `crop=${box[2]}:${box[3]}:${box[0]}:${box[1]},scale=iw*${kk}:ih*${kk}:flags=${flag}`;
    ff(["-i", join(dir, `ws-${A}-${view}-${i}.png`), "-i", join(dir, `ws-${B}-${view}-${i}.png`), "-filter_complex",
      `[0]${f},pad=iw+12:ih:0:0:white[a];[1]${f}[b];[a][b]hstack=inputs=2`, out]);
    console.log(out);
  }
} else if ( cmd === "blocks" ) {
  const none = rest[0] ?? A;
  const raw = (f) => execFileSync("ffmpeg", ["-v", "error", "-i", f, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 30 });
  const size = (f) => { let t = ""; try { execFileSync("ffmpeg", ["-i", f], { stdio: "pipe" }); } catch ( e ) { t = String(e.stderr); } return /, (\d+)x(\d+)/.exec(t).slice(1).map(Number); };
  for ( const f of readdirSync(dir).filter((n) => n.startsWith(`ws-${A}-`) && /-z3-/.test(n) && !n.includes("-none-")) ) {
    const v = f.slice(`ws-${A}-`.length), g = `ws-${B}-${v}`, view = v.replace(/^[a-z]+-/, ""), o = `ws-${none}-none-${view}`;
    if ( !existsSync(join(dir, g)) || !existsSync(join(dir, o)) ) continue;
    const P = 3 * Number(/-d(\d)/.exec(v)[1]);
    const [w, h] = size(join(dir, o)), off = raw(join(dir, o)), row = [v.padEnd(28)];
    for ( const n of [f, g] ) {
      const p = raw(join(dir, n)), L = (i) => (p[i] - off[i]) + (p[i + 1] - off[i + 1]) + (p[i + 2] - off[i + 2]);
      const sx = new Float64Array(P), sy = new Float64Array(P);
      let ax = 0, ay = 0;
      for ( let y = 1; y < h; y++ ) for ( let x = 1; x < w; x++ ) {
        const a = (y * w + x) * 3, dx = Math.abs(L(a) - L(a - 3)), dy = Math.abs(L(a) - L(a - w * 3));
        sx[x % P] += dx; sy[y % P] += dy; ax += dx; ay += dy;
      }
      const bx = Math.max(...sx) / (ax || 1), by = Math.max(...sy) / (ay || 1);
      row.push(`${n.startsWith(`ws-${A}`) ? A : B} ${((bx + by) / 2).toFixed(3)} (x ${bx.toFixed(2)} y ${by.toFixed(2)})`);
    }
    row.push(`no grid = ${(1 / P).toFixed(3)}`);
    console.log(row.join("   "));
  }
}
