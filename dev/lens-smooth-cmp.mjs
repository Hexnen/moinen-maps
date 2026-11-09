// Lens "no squares" A/B in node (shots from dev/lens-smooth.mjs `capture`, kept in mm-rec).
//   node dev/lens-smooth-cmp.mjs <mm-rec dir> A B crop <case-view> <i> <x> <y> <w> <h> [k=5]
//     a side-by-side crop A | B of one shot (CSS px box), scaled k times with LANCZOS (smooth: the scaling neither hides squares by
//     blurring them away nor invents blocks; a NEAREST copy is written next to it as ...-nn.png for the record)
//   node dev/lens-smooth-cmp.mjs <mm-rec dir> A B blocks
//     per DPR-1 shot: how much of the lens's own picture changes on the lens grid's borders (needs ls-OFF shots: `S.offPng()`)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [dir, A, B, cmd, ...rest] = process.argv.slice(2);
const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);

if ( cmd === "crop" ) {
  const [view, i, x, y, w, h, k = 5] = rest, d = Number(/-d(\d)/.exec(view)[1]);
  const box = [x, y, w, h].map((v) => Number(v) * d), kk = Number(k) / d;   // (k x the CSS size, whatever the DPR)
  for ( const [flag, suf] of [["lanczos", ""], ["neighbor", "-nn"]] ) {
    const out = join(dir, `lsc-${A}-${B}-${view}-${i}-${x}-${y}${suf}.png`);
    const f = `crop=${box[2]}:${box[3]}:${box[0]}:${box[1]},scale=iw*${kk}:ih*${kk}:flags=${flag}`;
    ff(["-i", join(dir, `ls-${A}-${view}-${i}.png`), "-i", join(dir, `ls-${B}-${view}-${i}.png`), "-filter_complex",
      `[0]${f},pad=iw+12:ih:0:0:white[a];[1]${f}[b];[a][b]hstack=inputs=2`, out]);
    console.log(out);
  }
} else if ( cmd === "blocks" ) {
  // the LENS's own picture (the shot minus the same view with the lens off, ls-OFF-...): the share of its px-to-px changes that fall
  // on the lens grid's borders (DPR 1: a lens px is 3 px). 0.33 = no grid (a third of the columns and rows are borders); 1 = every
  // change on a border (the picture made of 3 x 3 squares)
  const raw = (f) => execFileSync("ffmpeg", ["-v", "error", "-i", f, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 30 });
  const size = (f) => { let t = ""; try { execFileSync("ffmpeg", ["-i", f], { stdio: "pipe" }); } catch ( e ) { t = String(e.stderr); } return /, (\d+)x(\d+)/.exec(t).slice(1).map(Number); };
  for ( const f of readdirSync(dir).filter((n) => n.startsWith(`ls-${A}-`) && /-d1-/.test(n)) ) {
    const v = f.slice(`ls-${A}-`.length), g = `ls-${B}-${v}`, o = `ls-OFF-${v}`;
    if ( !existsSync(join(dir, g)) || !existsSync(join(dir, o)) ) continue;
    const [w, h] = size(join(dir, o)), off = raw(join(dir, o)), row = [v.padEnd(26)];
    for ( const n of [f, g] ) {
      const p = raw(join(dir, n)), L = (i) => (p[i] - off[i]) + (p[i + 1] - off[i + 1]) + (p[i + 2] - off[i + 2]);
      let on = 0, all = 0;
      for ( let y = 1; y < h; y++ ) for ( let x = 1; x < w; x++ ) {
        const a = (y * w + x) * 3, dx = Math.abs(L(a) - L(a - 3)), dy = Math.abs(L(a) - L(a - w * 3));
        all += dx + dy; if ( x % 3 === 0 ) on += dx; if ( y % 3 === 0 ) on += dy;
      }
      row.push(`${n.startsWith(`ls-${A}`) ? A : B} ${(on / all).toFixed(3)}`);
    }
    console.log(row.join("   "));
  }
}
