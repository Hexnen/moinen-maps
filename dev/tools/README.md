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

Parallel Foundry servers for agents: `dev/multi-foundry.ps1` of the moinen-pixel-vfx module (ports 30001-30005). See the
`moinen-maps-dev` skill for the whole workflow.
