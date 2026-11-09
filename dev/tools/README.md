# dev/tools - analysis helpers that are not tests

Everything that is a test lives in `dev/*.test.mjs` (run by `node dev/run-all.mjs`); the browser-side checks/benches live in
`dev/*-check.mjs`, `dev/*-bench.mjs`, `dev/perf-harness.mjs`. This folder holds the small supporting tools:

| file | what |
|---|---|
| `offline-harness.mjs` | `node dev/tools/offline-harness.mjs <outDir> [kind] [type]` - procedural map + painted masks -> `core.bake` -> composite PNG, no Foundry |
| `core-stability.mjs` | `node ... <core.mjs> [jag]` per-area bake stability + cache reuse + timing (compare old/new core versions) |
| `core-cpuprof.mjs` | `node --cpu-prof dev/tools/core-cpuprof.mjs <core.mjs> [huge]` one big bake to profile |
| `cpuprofile-summary.cjs` | `node dev/tools/cpuprofile-summary.cjs x.cpuprofile` self-time by function/line |
| `cdp.mjs` | `node dev/tools/cdp.mjs <debugPort> <urlPrefix\|new:URL> <jsFile>` evaluate a JS expression in a browser tab over CDP |
| `shot-receiver.mjs` | tiny HTTP receiver that saves PNGs POSTed from a page (frame strips out of a lane tab) |
| `long-frame-probe.js` | paste in console: records frames >= 60 ms and the wrapped zones that overlap them |
| `layer-signature.js` | paste in console: hash + ink blocks of the destruction layer at a scale (did a change alter pixels?) |
| `token-fx-strip.js` | paste in console: filmstrip harness for the Tokens effects (`__strip(...)`) |
| `fps-probe.js` | paste in console: fps over 3 s (a tab that is not fronted reports ~0) |
| `chrome.mjs` | `node dev/tools/chrome.mjs [--port 9333] [--edge] [-- <command>]` a private headless Chrome for `cdp-rec.mjs` / `cdp.mjs` / `cdp-lane.mjs`, temp profile always removed |
| `cdp-perf.mjs` | `node dev/tools/cdp-perf.mjs URL BENCH.js OUT.json [W H DPR]` headless Edge perf driver (`cdp(op)` bridge: gc, metrics, throttle, trace, cpu profile); replaces the old scratch `perf.py` |
| `cdp-drive.mjs` | `node dev/tools/cdp-drive.mjs BASE USER STEPS.json [W H] [--shots DIR]` join Foundry as USER in headless Edge, run JS steps, screenshots; replaces the old scratch `drive.py` |

Parallel Foundry servers for agents: `dev/multi-foundry.ps1` of the moinen-pixel-vfx module (ports 30001-30005). See the
`moinen-maps-dev` skill for the whole workflow.

## Temp folders and browser profiles (rule for every tool and test)

Nothing may stay in `%TEMP%` after a tool ends - normally, on an exception, on Ctrl+C, or killed. Leftover headless-browser profiles
(~1 GB each) once filled drive C:. So:

- Temp folders: `makeTempDir(kind)` from `dev/lib/tmp.mjs` (never `fs.mkdtempSync(os.tmpdir())`, `tempfile.mkdtemp` or a fixed
  `%TEMP%` path). It is removed on every exit, Ctrl+C/SIGTERM included; call `removeTempDir(dir)` to drop it earlier.
- Browsers: `launchBrowser(exe, args, { kind, profile })` + `closeBrowser(b, { port })` from `dev/lib/tmp.mjs`, or
  `startHeadless()` from `dev/lib/browser.mjs` (also picks a free port). Keep the `--profile <dir>` option: a given profile is
  used and never deleted. Never start chrome.exe/msedge.exe by hand with a `--user-data-dir` under `%TEMP%`: use `dev/tools/chrome.mjs`.
- A hard kill cannot clean up; the next run of the same kind sweeps folders with our marker (`.mm-owner.json`) whose owner process is
  gone, killing a browser still running on one (matched by its `--user-data-dir`). Folders without the marker are never touched.
- `node dev/lib/tmp.mjs list` shows our folders (live/stale, MB); `node dev/lib/tmp.mjs sweep [kind]` removes the stale ones.
- No Python drivers in scratch folders for browser work: use `cdp-perf.mjs` / `cdp-drive.mjs` / `cdp-rec.mjs` + `chrome.mjs`.
- `dev/tmp-clean.test.mjs` (in `run-all`) checks all of this offline.
