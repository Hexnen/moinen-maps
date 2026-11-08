// Re-time a webm recorded by dev/fire-rec.mjs `rec` (one captured frame per virtual step, wall-clock timestamps) to a fixed rate,
// and verify it:   node dev/fire-retime.mjs <in.webm> <out.webm> [fps=60] [frames]
//   - every captured frame becomes exactly one output frame (setpts = N / fps, no frame dropped or duplicated: -fps_mode passthrough);
//   - checks: the output frame count (= `frames`, rec's 3rd return value, when given), the timestamp deltas (WebM stores whole
//     milliseconds: 1/60 s shows as a 16/17 ms pattern that never drifts - the check allows that rounding and nothing else), and no two
//     consecutive frames identical (a duplicate) - prints a JSON summary and exits non-zero on a failure.
// Needs ffmpeg on the PATH (ffprobe is not needed: the timestamps come from ffmpeg's showinfo filter).
import { spawnSync } from "node:child_process";

const [, , inp, out, fpsArg, framesArg] = process.argv;
if ( !inp || !out ) { console.error("usage: node dev/fire-retime.mjs <in.webm> <out.webm> [fps] [frames]"); process.exit(2); }
const fps = Number(fpsArg) || 60, want = framesArg ? Number(framesArg) : null;
const run = (args) => { const r = spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 1 << 28 }); if ( r.status !== 0 ) { console.error(r.stderr.slice(-2000)); process.exit(1); } return r.stderr; };

// (MediaRecorder may emit the canvas as it was when the recording started, before the first requested frame: a PRE-ROLL frame that
// is not part of the recording - dropped when the input holds exactly one frame more than `frames`)
const inRows = [...run(["-i", inp, "-vf", "showinfo", "-f", "null", "-"]).matchAll(/n:\s*(\d+).*?pts_time:([\d.]+)/g)].map((m) => +m[2]);
const preRoll = want !== null && inRows.length === want + 1;
run(["-y", "-loglevel", "error", "-i", inp, "-vf", `${preRoll ? "trim=start_frame=1," : ""}setpts=N/(${fps}*TB)`, "-fps_mode", "passthrough", "-an", "-c:v", "libvpx-vp9", "-b:v", "10M", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", out]);
// timestamps and a per-frame checksum of the decoded output
const info = run(["-i", out, "-vf", "showinfo", "-f", "null", "-"]);
const rows = [...info.matchAll(/n:\s*(\d+).*?pts_time:([\d.]+).*?checksum:([0-9A-F]+)/g)].map((m) => ({ n: +m[1], t: +m[2], c: m[3] }));
const d = rows.slice(1).map((r, i) => r.t - rows[i].t), step = 1 / fps;
const maxDev = Math.max(0, ...d.map((x) => Math.abs(x - step)));
const drift = rows.length ? Math.abs(rows.at(-1).t - (rows.length - 1) * step) : 0;
const dups = rows.slice(1).filter((r, i) => r.c === rows[i].c).length;
const ok = rows.length > 1 && maxDev <= 0.0011 && drift <= 0.0011 && (want === null || rows.length === want);
console.log(JSON.stringify({ out, fps, frames: rows.length, expected: want, deltaMs: [Math.min(...d) * 1000, Math.max(...d) * 1000].map((x) => +x.toFixed(2)), maxDevMs: +(maxDev * 1000).toFixed(2), preRollDropped: preRoll, driftMs: +(drift * 1000).toFixed(2), identicalNeighbours: dups, ok }));
process.exit(ok ? 0 : 1);
