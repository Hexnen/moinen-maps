// FRAME GUARD LIVE DRIVER (node): dev/guard-live.mjs emu() on a lane GM in headless Chrome at a real device scale factor, on the stack
// bench scene: the fire alone (20 fires) and the fire + rain, each on an emulated 60 Hz, 144 Hz and 165 Hz (Foundry's 60 fps cap)
// display: load off, a heavy load, off, a load the guard can relieve, off. Prints q / fire level / fps / late share per second.
//   node dev/guard-live-run.mjs [--dpr 1,2] [--port 9444] [--gm http://127.0.0.14:30001] [--gmId 3dzfyqQ1n98OkCwE] [--profile <dir>]
//        [--cases fire,fire+rain] [--hz 60,144,165] [--label guard] [--phases '[[3,0],[25,"mid"],[25,0]]'] [--vsync [--vsyncSecs 6]]
// Writes dev/out/guard/<label>-dpr<k>.json. Chrome is started and stopped here (its profile deleted unless --profile is given).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { connect, join, targets } from "./tools/cdp-lane.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg("port", 9444)), GM = arg("gm", "http://127.0.0.14:30001"), GMID = arg("gmId", "3dzfyqQ1n98OkCwE");
const DPRS = arg("dpr", "1,2").split(",").map(Number), CASES = arg("cases", "fire,fire+rain").split(","), HZ = arg("hz", "60,144,165").split(",").map(Number);
const PHASES = arg("phases", "") ? JSON.parse(arg("phases", "")) : null;   // e.g. [[3,0],[25,"mid"],[25,0]]
const LABEL = arg("label", "guard"), CHROME = arg("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "out", "guard");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DISP = { 60: { hz: 60, k: 1 }, 144: { hz: 144, k: 1 }, 165: { hz: 165, cap60: true } };
const LAYERS = { fire: { fire: 20 }, "fire+rain": { fire: 20, weather: "rain" } };

async function startChrome(dpr) {
  const prof = arg("profile", path.join(os.tmpdir(), `mm-guard-chrome-${PORT}`));
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

const SB = `const S = await import("/modules/moinen-maps/dev/stack-bench.mjs");`, GL = `const E = await import("/modules/moinen-maps/dev/guard-live.mjs");`;
for ( const dpr of DPRS ) {
  const ch = await startChrome(dpr), res = [];
  try {
    const gm = await connect(PORT, await join(PORT, GM, GMID));
    await gm.front();
    console.log("scene", JSON.stringify(await gm.ev(`${SB} return await S.ensureScene();`)));
    if ( process.argv.includes("--vsync") ) {
      await gm.ev(`${SB} await S.setLayers({ fire: 20 }); await S.ready(); canvas.pan({ x: 768, y: 512, scale: 1 }); return 1;`);
      const VS = Number(arg("vsyncSecs", 6)), v = await gm.ev(`${GL} return await E.vsyncCheck({ secs: ${VS} });`);
      console.log(`
=== dpr ${dpr} vsync under a real overload (26 ms CPU burn a frame from 3 s to ${3 + VS} s, real ticker)
  t    load fps  view-smooth  guard  q     work`);
      for ( const r of v ) console.log(`  ${String(r[0]).padStart(4)} ${String(r[1]).padStart(4)} ${String(r[2]).padStart(3)}  ${String(r[3]).padStart(6)}       ${String(r[4]).padStart(6)} ${String(r[5]).padEnd(5)} ${r[6]}`);
      res.push({ vsync: v });
    }
    for ( const cs of CASES ) {
      await gm.ev(`${SB} await S.setLayers(${JSON.stringify(LAYERS[cs])}); await S.ready(); canvas.pan({ x: 768, y: 512, scale: 1 }); return 1;`);
      await sleep(2000);
      for ( const hz of HZ ) {
        const r = await gm.ev(`${GL} return await E.emu(${JSON.stringify({ ...DISP[hz], ...(PHASES ? { phases: PHASES } : {}) })});`);
        res.push({ case: cs, ...r });
        console.log(`\n=== dpr ${dpr} ${cs} ${hz} Hz${DISP[hz].cap60 ? " (Foundry cap 60: 3 vsyncs)" : ""}: frame ${r.frame} ms + slack ${r.slack}; real work full ${r.cal.full} ms, floor ${r.cal.floor} ms; relievable load ${r.cal.mid} ms, heavy ${r.cal.heavy} ms; real dpr ${r.dpr}`);
        console.log("  t    q     fire  fps  late  work  load");
        for ( const row of r.rows ) if ( Math.round(row[0] * 2) % 2 === 0 ) console.log(`  ${String(row[0]).padStart(4)} ${row[1].toFixed(2)}  ${row[2].toFixed(2)}  ${String(row[3]).padStart(3)}  ${row[4].toFixed(2)}  ${row[5].toFixed(1).padStart(4)}  ${row[6]}`);
        fs.writeFileSync(path.join(OUT, `${LABEL}-dpr${dpr}.json`), JSON.stringify(res));
      }
    }
    await gm.ev(`${SB} await S.setLayers({}); return 1;`);
    gm.close();
  } finally { await stopChrome(ch); }
}
process.exit(0);
