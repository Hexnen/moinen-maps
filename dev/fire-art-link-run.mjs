// LIVE CHECK: the fire programs' link time on a program-cache MISS, and (with --ref) the art pass A/B against another art.mjs.
//   node dev/fire-art-link-run.mjs [--port 9444] [--gm http://127.0.0.14:30001/game] [--ref /modules/moinen-maps/dev/out/ref-art.mjs]
//        [--limit 5000] [--times 40]
// Needs a Chrome with --remote-debugging-port holding a GM tab joined to a lane (dev/tools/cdp-lane.mjs join), ANGLE D3D11 on Windows
// (where the cost is: FXC). Every source gets a random #define first, so each link is a cache miss on any Chrome, any profile.
//  1. LINK: every fire art program alone (one after another), then all at once as the pre-warm starts them (gl-warm.mjs): ms each,
//     and the all-at-once wall time - FAIL above --limit ms (the first fire a player sees waits for it, fire.mjs prewarm).
//  2. A/B (--ref: a copy of art.mjs whose relative imports point at /modules/moinen-maps/scripts/fire/, e.g. from
//     git show <rev>:scripts/fire/art.mjs): on the bench scene's fire + smoke, every area's art texture drawn by this module (its
//     programs) and by the reference's first program on the same uniforms, at --times art times: cells compared byte for byte, and
//     the art pass's per-area time (CPU and with the GPU, N draws then one sync) both ways.
// 2026-11-09 (3070 Ti, D3D11): the one art program linked in 13.3 s; ART_F + ART_S all at once 2.9-4.2 s wall (ART_F alone 2.8-4.1 s).
import fs from "node:fs";
import { connect } from "./tools/cdp-lane.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg("port", 9444)), GM = arg("gm", "http://127.0.0.14:30001/game"), REF = arg("ref", ""), LIMIT = Number(arg("limit", 5000));
const TIMES = Number(arg("times", 40));
const gm = await connect(PORT, GM);
await gm.front();

const LINK = (mode) => `
  const A = await import("/modules/moinen-maps/scripts/fire/art.mjs");
  const gl = canvas.app.renderer.gl, ext = gl.getExtension("KHR_parallel_shader_compile");
  if ( !ext ) return JSON.stringify({ error: "no KHR_parallel_shader_compile" });
  const salt = "#define MM_SALT_" + Math.floor(Math.random() * 1e9) + "\\n";
  const P = A.artPrograms(), names = A.artProgramKeys?.() ?? P.map((p, i) => "p" + i);
  const start = (p) => { const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s.replace("\\n", "\\n" + salt)); gl.compileShader(o); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, p.vertexSrc)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, p.fragmentSrc)); gl.linkProgram(pr); return { pr, t0: performance.now() }; };
  const wait = async (jobs) => { const out = {}; let open = jobs.slice();
    while ( open.length ) { await new Promise((r) => setTimeout(r, 5)); open = open.filter((j) => { if ( gl.getProgramParameter(j.pr, ext.COMPLETION_STATUS_KHR) ) { out[j.n] = Math.round(performance.now() - j.t0); if ( !gl.getProgramParameter(j.pr, gl.LINK_STATUS) ) out[j.n + ":FAILED"] = true; gl.deleteProgram(j.pr); return false; } return true; }); }
    return out; };
  const T0 = performance.now(); let res;
  if ( "${mode}" === "all" ) res = await wait(P.map((p, i) => ({ ...start(p), n: names[i] })));
  else { res = {}; for ( let i = 0; i < P.length; i++ ) Object.assign(res, await wait([{ ...start(P[i]), n: names[i] }])); }
  return JSON.stringify({ wall: Math.round(performance.now() - T0), ...res });`;

const one = JSON.parse(await gm.ev(LINK("one"), 900000));
const all = JSON.parse(await gm.ev(LINK("all"), 900000));
console.log("link, one after another (ms):", JSON.stringify(one));
console.log("link, all at once (ms):      ", JSON.stringify(all));
let failed = all.error || all.wall > LIMIT || Object.keys(all).some((k) => k.endsWith(":FAILED"));
console.log(`${failed ? "FAIL" : "PASS"} link wall ${all.wall} ms (limit ${LIMIT})`);

if ( REF ) {
  await gm.ev(`const S = await import("/modules/moinen-maps/dev/stack-bench.mjs"); await S.ensureScene(); await S.setLayers({ fire: 20, smoke: 4 });
    for ( let i = 0; i < 300 && (game.modules.get("moinen-maps").api.fire.status().pending ?? 0) > 0; i++ ) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1500)); return 1;`, 600000);
  const ab = JSON.parse(await gm.ev(`
    const Ref = await import(${JSON.stringify(REF)});
    const r = canvas.app.renderer, gl = r.gl, D = game.modules.get("moinen-maps").api.fire.display(), refArt = Ref.artPrograms()[0];
    const read = (rt, W, H) => { r.renderTexture.bind(rt); const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
    const px = new Uint8Array(4), sync = (rt) => { r.renderTexture.bind(rt); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    const time = (fn, rt, N = 300) => { fn(); sync(rt); const s = performance.now(); for ( let i = 0; i < N; i++ ) fn(); const c = performance.now(); sync(rt); return [(c - s) / N, (performance.now() - s) / N]; };
    const out = { areas: 0, cells: 0, diff: 0, examples: [], cpuNew: 0, cpuRef: 0, allNew: 0, allRef: 0 };
    for ( const a of D.areas.values() ) {
      const m = a.mesh; if ( !m?.isArt ) continue;
      const W = m.W, H = m.H, U = m.pass.shader.uniforms, t0 = U.uTime;
      const om = new PIXI.Mesh(m.pass.geometry, new PIXI.Shader(refArt, U));
      const tmp = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST });
      for ( let k = 0; k < ${TIMES}; k++ ) {
        const T = t0 + Math.random() * 20;
        m.setTime(T); m.renderArt(r); const x = read(m.rt, W, H);
        r.render(om, { renderTexture: tmp, clear: true }); const y = read(tmp, W, H);
        for ( let i = 0; i < x.length; i += 4 ) { out.cells++;
          if ( x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2] || x[i + 3] !== y[i + 3] ) { out.diff++; if ( out.examples.length < 8 ) out.examples.push({ cell: [(i / 4) % W, Math.floor(i / 4 / W)], T, ref: [...y.slice(i, i + 4)], now: [...x.slice(i, i + 4)] }); } }
      }
      const a1 = time(() => m.scissorPass(r, m.rt, 0, 0, W, H), m.rt), b1 = time(() => r.render(om, { renderTexture: tmp, clear: true }), tmp);
      out.cpuNew += a1[0]; out.allNew += a1[1]; out.cpuRef += b1[0]; out.allRef += b1[1]; out.areas++;
      m.setTime(t0); m.renderArt(r); om.destroy(); tmp.destroy(true);
    }
    return JSON.stringify(out);`, 1800000));
  await gm.ev(`const S = await import("/modules/moinen-maps/dev/stack-bench.mjs"); await S.setLayers({}); return 1;`, 300000);
  const f = (x) => x.toFixed(3);
  console.log(`A/B: ${ab.areas} areas, ${ab.cells} cells, ${ab.diff} differ${ab.examples.length ? " " + JSON.stringify(ab.examples) : ""}`);
  console.log(`art pass, summed over the areas (ms): CPU ${f(ab.cpuNew)} (ref ${f(ab.cpuRef)}), with the GPU ${f(ab.allNew)} (ref ${f(ab.allRef)})`);
  if ( ab.diff > ab.cells * 1e-7 ) failed = true;
}
process.exit(failed ? 1 : 0);
