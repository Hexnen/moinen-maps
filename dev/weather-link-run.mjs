// LIVE CHECK: every weather program's link time on a program-cache MISS (display, clouds, tornado, lens).
//   node dev/weather-link-run.mjs [--port 9444] [--gm http://127.0.0.14:30001/game] [--only tornado.vol,lens] [--limit 4000] [--reps 1]
// Needs a Chrome with --remote-debugging-port holding a GM tab joined to a lane (dev/tools/cdp-lane.mjs join), ANGLE D3D11 on Windows
// (where the cost is: FXC links each program when the first draw needs it). Every source gets a random #define first, so each link is
// a cache miss on any Chrome, any profile. Programs link one after another (the slowest number is what a player waits for when a
// shader update emptied the cache); FAIL when one takes over --limit ms (any rep). The default 4000 lets the unsplit lens (3.4-3.5 s)
// pass and catches a program growing back (the tornado volume was 8.7 s). PIXI drops Program names in the page: a program is
// <module>.<index> in its *Programs() order (tornado: 0 deck-curtain, 1 deck, 2 column, 3 foot, 4-5 vol2-0/1, 6-7 vol0, 8-9 vol1, 10 part, ...).
// 2026-11-09 (3070 Ti, D3D11), before -> after the deck/volume split (tornado-glsl.mjs volFrag, deckFrag):
//   tornado vol (one pass, both modes) 8.7-8.9 s -> vol2-0 / vol2-1 2.8-3.2 s; deck 3.0-3.3 s -> curtain 0.65 s + deck 1.3 s;
//   vol0 1.7 s -> 0.6-0.75 s; vol1 2.1-2.5 s -> 0.8-1.2 s (vol2 rerun: 2.4-3.4 s). Not split: lens 3.4 s, display ground 2.1 s (see the README).
// Offline the same code can be timed with FXC itself (fxc.exe /T ps_5_0 /O1 on WEBGL_debug_shaders' translated HLSL): it reproduces
// the browser's ranking at ~0.6-0.8x its time (fire: dev/fire-art-link-run.mjs).
import { connect } from "./tools/cdp-lane.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg("port", 9444)), GM = arg("gm", "http://127.0.0.14:30001/game"), LIMIT = Number(arg("limit", 4000));
const ONLY = arg("only", ""), REPS = Number(arg("reps", 1));
const gm = await connect(PORT, GM);
await gm.front();

const RUN = `
  const mods = { display: ["display.mjs", "displayPrograms"], clouds: ["clouds.mjs", "cloudPrograms"], tornado: ["tornado.mjs", "tornadoPrograms"],
    lens: ["lens.mjs", "lensPrograms"] };
  const gl = canvas.app.renderer.gl, ext = gl.getExtension("KHR_parallel_shader_compile");
  if ( !ext ) return JSON.stringify({ error: "no KHR_parallel_shader_compile" });
  const progs = [];
  for ( const [k, [f, fn]] of Object.entries(mods) ) {
    const M = await import("/modules/moinen-maps/scripts/weather/" + f);
    M[fn]().forEach((p, i) => progs.push({ n: k + "." + (p.name?.replace(/^moinen-maps-(weather-|tornado-|clouds-)?/, "") ?? i), p }));
  }
  const only = ${JSON.stringify(ONLY)}.split(",").filter(Boolean);
  const sel = only.length ? progs.filter((x) => only.some((o) => x.n.includes(o))) : progs;
  const start = (p) => { const salt = "#define MM_SALT_" + Math.floor(Math.random() * 1e9) + "\\n";
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s.replace("\\n", "\\n" + salt)); gl.compileShader(o); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, p.vertexSrc)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, p.fragmentSrc));
    gl.linkProgram(pr); return { pr, t0: performance.now() }; };
  const out = {};
  for ( const x of sel ) {
    const j = start(x.p);
    while ( !gl.getProgramParameter(j.pr, ext.COMPLETION_STATUS_KHR) ) await new Promise((r) => setTimeout(r, 5));
    out[x.n] = Math.round(performance.now() - j.t0);
    if ( !gl.getProgramParameter(j.pr, gl.LINK_STATUS) ) out[x.n + ":FAILED"] = gl.getProgramInfoLog(j.pr).slice(0, 300);
    gl.deleteProgram(j.pr);
  }
  return JSON.stringify(out);`;

let failed = false;
for ( let rep = 0; rep < REPS; rep++ ) {
  const r = JSON.parse(await gm.ev(RUN, 1800000));
  if ( r.error ) { console.log(r.error); process.exit(1); }
  const slow = Object.entries(r).filter(([k, v]) => k.endsWith(":FAILED") || v > LIMIT);
  console.log(`rep ${rep + 1} (ms):`, Object.entries(r).map(([k, v]) => `${k} ${v}`).join(", "));
  if ( slow.length ) { failed = true; console.log("  over the limit / failed:", slow.map(([k]) => k).join(", ")); }
}
console.log(`${failed ? "FAIL" : "PASS"} every program under ${LIMIT} ms${ONLY ? ` (only ${ONLY})` : ""}`);
process.exit(failed ? 1 : 0);
