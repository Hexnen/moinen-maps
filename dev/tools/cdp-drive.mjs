// Join Foundry as USER in a headless Edge and run JS steps: the repo's version of the old scratch drive.py, with a temp profile that
// is always cleaned up (dev/lib/tmp.mjs; drive.py leaked its drvprof* profile whenever Edge still held it or the run was killed).
//   node dev/tools/cdp-drive.mjs BASE USER STEPS.json [W H] [--shots DIR] [--reduced] [--chrome <exe>] [--port N] [--profile <dir>]
// STEPS.json: [{"js": "...async body returning value...", "wait": seconds_after, "shot": "name.png", "shotAfter": "name.png"}]
// Each step's value is printed (JSON). window.__log and the page errors (window.__errs) are printed at the end.
import fs from "node:fs";
import path from "node:path";
import { startHeadless, closeBrowser, session, firstPage, EDGE } from "../lib/browser.mjs";

const flag = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const pos = []; for ( let i = 2; i < process.argv.length; i++ ) { const a = process.argv[i]; if ( a === "--reduced" ) continue; if ( a.startsWith("--") ) i++; else pos.push(a); }
const [base, user, stepsPath] = pos, W = /^\d+$/.test(pos[3] ?? "") ? Number(pos[3]) : 1600, H = /^\d+$/.test(pos[4] ?? "") ? Number(pos[4]) : 900;
if ( !stepsPath ) { console.log("usage: node dev/tools/cdp-drive.mjs BASE USER STEPS.json [W H] [--shots DIR] [--reduced] [--chrome <exe>]"); process.exit(1); }
const shots = flag("shots", null); if ( shots ) fs.mkdirSync(shots, { recursive: true });
const steps = JSON.parse(fs.readFileSync(stepsPath, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { b, port } = await startHeadless({
  kind: "drive-edge", exe: flag("chrome", EDGE), port: Number(flag("port", 0)), profile: flag("profile", null),
  args: [`--window-size=${W},${H}`, "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--lang=pl", "about:blank"]
});
try {
  const s = await session((await firstPage(port)).webSocketDebuggerUrl), call = s.send;
  const ev = async (expr) => {
    const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    const res = r.result ?? {};
    if ( res.exceptionDetails ) return { EXC: String(res.exceptionDetails.exception?.description ?? JSON.stringify(res.exceptionDetails)).slice(0, 800) };
    return res.result ? res.result.value : res;
  };
  const shot = async (name) => fs.writeFileSync(path.join(shots, name), Buffer.from((await call("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
  await call("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await call("Emulation.setFocusEmulationEnabled", { enabled: true });
  if ( process.argv.includes("--reduced") ) await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await call("Page.enable"); await call("Runtime.enable");
  await call("Page.navigate", { url: `${base}/join` }); await sleep(3000);
  console.log("join:", JSON.stringify(await ev(`(async()=>{const s=document.querySelector('select[name=userid]'); const o=[...s.options].find(o=>o.textContent.trim()===${JSON.stringify(user)}); s.value=o.value; document.querySelector('button[name=join]').click(); return o.value})()`)));
  for ( let i = 0; i < 90; i++ ) { await sleep(1000); try { if ( (await ev("!!(window.game && game.ready && canvas?.ready)")) === true ) break; } catch {} }
  await ev("window.__log=[]; window.__errs=[]; addEventListener('error',e=>__errs.push(String(e.message))); addEventListener('unhandledrejection',e=>__errs.push('rej '+String(e.reason?.stack??e.reason))); const oe=console.error; console.error=(...a)=>{__errs.push('console.error '+a.map(x=>String(x?.stack??x)).join(' ').slice(0,400)); oe(...a)}; 1");
  console.log("ready, user:", JSON.stringify(await ev("game.user?.name")), "lang:", JSON.stringify(await ev("game.i18n.lang")));
  for ( const [i, st] of steps.entries() ) {
    const t0 = Date.now(), v = await ev(`(async()=>{ ${st.js} })()`);
    console.log(`step ${i} (${((Date.now() - t0) / 1000).toFixed(1)}s):`, (JSON.stringify(v) ?? "null").slice(0, 4000));
    if ( shots && st.shot ) await shot(st.shot);
    if ( st.wait ) await sleep(st.wait * 1000);
    if ( shots && st.shotAfter ) await shot(st.shotAfter);
  }
  console.log("log:", (JSON.stringify(await ev("window.__log")) ?? "null").slice(0, 6000));
  console.log("errs:", (JSON.stringify(await ev("window.__errs")) ?? "null").slice(0, 4000));
  s.close();
} finally {
  await closeBrowser(b, { port });
}
process.exit(0);
