// Node: node dev/lens-glint-cmp.mjs <mm-rec dir> A B [crop prefix]
// The lens-glint A/B (dev/lens-glint.mjs capture): per DPR x darkness x shot, the pixels of B that differ from A, as 8-connected
// clusters (count, the largest box in CSS px, the largest channel difference). With a crop prefix: for the largest clusters, a
// 48 x 30 CSS px crop around each from A and B side by side, scaled up 6x nearest (png, next to the shots). Needs ffmpeg on the PATH.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [dir, A, B, prefix] = process.argv.slice(2);
const T = 4, DPRS = [1, 2], DARKS = [0, 1];
function rgba(file) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 30 });
  const m = spawnSync("ffmpeg", ["-i", file], { encoding: "utf8" }).stderr.match(/, (\d+)x(\d+)/);
  return { b: r.stdout, w: +m[1], h: +m[2] };
}
/** 8-connected clusters of the differing pixels of two RGBA shots (w x h). */
function clusters(a, b, w, h) {
  const n = w * h, mark = new Uint8Array(n), seen = new Uint8Array(n);
  let px = 0, max = 0;
  for ( let i = 0; i < n; i++ ) {
    const o = i * 4, d = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]));
    if ( d ) { mark[i] = 1; px++; if ( d > max ) max = d; }
  }
  const boxes = [], st = [];
  for ( let i = 0; i < n; i++ ) {
    if ( !mark[i] || seen[i] ) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, cnt = 0;
    st.push(i); seen[i] = 1;
    while ( st.length ) {
      const j = st.pop(), x = j % w, y = (j / w) | 0; cnt++;
      if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x; if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y;
      for ( let dy = -1; dy <= 1; dy++ ) for ( let dx = -1; dx <= 1; dx++ ) {
        const X = x + dx, Y = y + dy; if ( X < 0 || Y < 0 || X >= w || Y >= h ) continue;
        const k = Y * w + X; if ( mark[k] && !seen[k] ) { seen[k] = 1; st.push(k); }
      }
    }
    boxes.push([x1 - x0 + 1, y1 - y0 + 1, cnt, x0, y0]);
  }
  return { px, max, boxes };
}


const rows = [];
for ( const dpr of DPRS ) for ( const dark of DARKS ) for ( let i = 0; i < T; i++ ) {
  const fa = path.join(dir, `glint-${A}-d${dpr}-n${dark}-${i}.png`), fb = path.join(dir, `glint-${B}-d${dpr}-n${dark}-${i}.png`);
  if ( !fs.existsSync(fa) || !fs.existsSync(fb) ) { console.log("missing", fa, fb); continue; }
  const a = rgba(fa), b = rgba(fb), c = clusters(a.b, b.b, a.w, a.h);
  c.boxes.sort((x, y) => Math.max(y[0], y[1]) - Math.max(x[0], x[1]));
  const big = c.boxes.length ? Math.max(c.boxes[0][0], c.boxes[0][1]) : 0;
  rows.push({ dpr, dark, i, px: c.px, clusters: c.boxes.length, maxBoxCss: +(big / dpr).toFixed(1), maxD: c.max });
  console.log(`dpr${dpr} dark${dark} shot${i} | px ${c.px} | clusters ${c.boxes.length} | largest ${(big / dpr).toFixed(1)} css px | max d ${c.max} | ${c.boxes.slice(0, 4).map((x) => `${x[0]}x${x[1]}@${x[3]},${x[4]}`).join(" ")}`);
  if ( prefix && i === 0 ) for ( const [k, x] of c.boxes.slice(0, 3).entries() ) {
    const W = 48 * dpr, H = 30 * dpr, X = Math.max(0, Math.min(a.w - W, x[3] + (x[0] >> 1) - (W >> 1))), Y = Math.max(0, Math.min(a.h - H, x[4] + (x[1] >> 1) - (H >> 1)));
    const out = path.join(dir, `${prefix}-d${dpr}-n${dark}-${k}.png`), s = 6 / dpr;
    spawnSync("ffmpeg", ["-v", "error", "-y", "-i", fa, "-i", fb, "-filter_complex",
      `[0]crop=${W}:${H}:${X}:${Y},scale=iw*${s}:ih*${s}:flags=neighbor[a];[1]crop=${W}:${H}:${X}:${Y},scale=iw*${s}:ih*${s}:flags=neighbor[b];[a][b]hstack=inputs=2`, out]);
  }
}
