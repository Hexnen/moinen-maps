// VIEW PACING LIVE DRIVER (node): dev/view-pace-live.mjs measure() on a lane GM in headless Chrome (a real display rate: 165 Hz on the
// dev machine) at a real device scale factor, on the stack bench scene: the empty scene and fire + rain, each with CPU burn 0 / 8 / 26 ms
// / varying 4-28 ms a frame, the old period estimate and the new (held to the stable period).
//   node dev/view-pace-live-run.mjs [--dpr 1,2] [--port 9444] [--gm http://127.0.0.14:30001] [--gmId 3dzfyqQ1n98OkCwE] [--profile <dir>]
//        [--cases empty,fire+rain] [--burns 0,8,26,vary] [--label pace]
// Writes dev/out/pace/<label>-dpr<k>.json. Chrome is started and stopped here (its profile deleted unless --profile is given).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { connect, join, targets } from "./tools/cdp-lane.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg("port", 9444)), GM = arg("gm", "http://127.0.0.14:30001"), GMID = arg("gmId", "3dzfyqQ1n98OkCwE");
const DPRS = arg("dpr", "1,2").split(",").map(Number), CASES = arg("cases", "empty,fire+rain").split(","), BURNS = arg("burns", "0,8,26,vary").split(",").map((b) => (b === "vary" ? b : Number(b)));
const LABEL = arg("label", "pace"), CHROME = arg("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "out", "pace");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAYERS = { empty: {}, fire: { fire: 20 }, "fire+rain": { fire: 20, weather: "rain" } };

async function startChrome(dpr) {
  const prof = arg("profile", path.join(os.tmpdir(), `mm-pace-chrome-${PORT}`));
  const p = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "--window-size=1600,900", "--enable-gpu",
    "--use-angle=d3d11", "--ignore-gpu-blocklist", `--force-device-scale-factor=${dpr}`, "about:blank"], { stdio: "ignore" });
  for ( let i = 0; i < 40; i++ ) { await sleep(500); try { await targets(PORT); return { p, prof }; } catch {} }
  throw new Error("chrome did not start");
}
async function stopChrome({ p, prof }) {
  try { const b = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); const ws = new WebSocket(b.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r)); ws.send(JSON.stringify({ id: 1, method: "Browser.close" })); } catch {}
  await sleep(2500); try { p.kill(); } catch {}
  await sleep(1000); if ( !arg("profile") ) try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}

const SB = `const S = await import("/modules/moinen-maps/dev/stack-bench.mjs");`, VP = `const E = await import("/modules/moinen-maps/dev/view-pace-live.mjs");`;
const f = (c) => `p50 ${c.p50} p95 ${c.p95} max ${c.max} irregular ${(c.irregular * 100).toFixed(0)}% ${c.fps} fps`;
for ( const dpr of DPRS ) {
  const ch = await startChrome(dpr), res = [];
  try {
    const gm = await connect(PORT, await join(PORT, GM, GMID));
    await gm.front();
    console.log("scene", JSON.stringify(await gm.ev(`${SB} return await S.ensureScene();`)));
    for ( const cs of CASES ) {
      await gm.ev(`${SB} await S.setLayers(${JSON.stringify(LAYERS[cs])}); await S.ready(); return 1;`);
      for ( const burn of BURNS ) for ( const stable of [false, true] ) {
        await gm.front();
        const r = await gm.ev(`${VP} return await E.measure(${JSON.stringify({ burn, stable })});`);
        res.push({ dpr, case: cs, ...r });
        console.log(`dpr ${dpr} ${cs.padEnd(9)} burn ${String(burn).padEnd(4)} ${stable ? "NEW" : "old"} k ${r.pacing.k} (${r.pacing.hz} Hz cap ${r.pacing.cap}) | cadence ${f(r.cadence)} | pan ${f(r.pan)} | wheel p50 ${r.wheel.p50} p95 ${r.wheel.p95} ms (${r.wheel.n})`);
        fs.writeFileSync(path.join(OUT, `${LABEL}-dpr${dpr}.json`), JSON.stringify(res));
      }
    }
    await gm.ev(`${SB} await S.setLayers({}); return 1;`);
    gm.close();
  } finally { await stopChrome(ch); }
}
process.exit(0);
