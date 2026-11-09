// STACK BENCH DRIVER (node): the matrix of dev/stack-bench.mjs on a lane, GM + a real player, in headless Chrome at a REAL device scale
// factor (--force-device-scale-factor: perf-harness setDPR only re-sizes the renderer; the page then reports what it got).
//   node dev/stack-bench-run.mjs [--dpr 1,2] [--port 9444] [--gm http://127.0.0.14:30001] [--player http://127.0.0.13:30001]
//        [--gmId 3dzfyqQ1n98OkCwE] [--playerId 5gw9oNsrSdZuSUqQ] [--profile <dir>] [--label name] [--quick] [--dark 0,1] [--zooms 1,3]
//        [--only GM|player] [--angle d3d11] [--states base,D,all,...] (a subset of STATES, in their order) [--noMove] [--noOwners]
// Writes dev/out/stack/<label>-dpr<k>.json (rows) and prints the summary (dev/stack-bench-sum.mjs reads the files again).
// Chrome is started and stopped by the driver (its own profile dir, deleted after), never another one.
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, closeBrowser } from "./lib/tmp.mjs";
import { connect, join, targets } from "./tools/cdp-lane.mjs";
import { summary } from "./stack-bench-sum.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const PORT = Number(arg("port", 9444)), GM = arg("gm", "http://127.0.0.14:30001"), PL = arg("player", "http://127.0.0.13:30001");
const GMID = arg("gmId", "3dzfyqQ1n98OkCwE"), PLID = arg("playerId", "5gw9oNsrSdZuSUqQ"), LABEL = arg("label", "stack");
const DPRS = arg("dpr", "1,2").split(",").map(Number), DARK = arg("dark", "0,1").split(",").map(Number), ZOOMS = arg("zooms", "1,3").split(",").map(Number);
const ONLY = arg("only", ""), ANGLE = arg("angle", "d3d11");
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "out", "stack");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = arg("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");

// states: [name, { d, fire, smoke, weather }] - each layer alone, the pairs (fire 20, rain + lens), everything; the other variants
// (fire 5, tornado, sand) alone and in the full stack
const F = (o) => ({ d: false, fire: 0, smoke: 0, weather: "off", ...o });
export const STATES = [
  ["base", F({})], ["F20", F({ fire: 20 })], ["F5", F({ fire: 5 })], ["S", F({ smoke: 5 })], ["Wrain", F({ weather: "rain" })],
  ["Wtorn", F({ weather: "tornado" })], ["Wsand", F({ weather: "sand" })],
  ["F20+S", F({ fire: 20, smoke: 5 })], ["F20+Wrain", F({ fire: 20, weather: "rain" })], ["S+Wrain", F({ smoke: 5, weather: "rain" })],
  ["D", F({ d: true })], ["D+F20", F({ d: true, fire: 20 })], ["D+S", F({ d: true, smoke: 5 })], ["D+Wrain", F({ d: true, weather: "rain" })],
  ["all", F({ d: true, fire: 20, smoke: 5, weather: "rain" })], ["all-F5", F({ d: true, fire: 5, smoke: 5, weather: "rain" })],
  ["all-torn", F({ d: true, fire: 20, smoke: 5, weather: "tornado" })], ["all-sand", F({ d: true, fire: 20, smoke: 5, weather: "sand" })],
  ["base2", F({})]   // (the empty scene again at the end: the drift of the machine over the run - an excess smaller than it is noise)
];
const QUICK = ["base", "F20", "S", "Wrain", "D", "all", "base2"];
const MOVE = new Set(["base", "F20", "S", "Wrain", "D", "all"]);

async function startChrome(dpr) {
  const ch = launchBrowser(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--window-size=1600,900", "--enable-gpu",
    `--use-angle=${ANGLE}`, "--ignore-gpu-blocklist", `--force-device-scale-factor=${dpr}`, "about:blank"], { kind: "stack-chrome", profile: arg("profile") });   // temp profile: dev/lib/tmp.mjs
  for ( let i = 0; i < 40; i++ ) { await sleep(500); try { await targets(PORT); return ch; } catch {} }
  throw new Error("chrome did not start");
}
async function stopChrome(ch) { await closeBrowser(ch, { port: PORT }); }

const IMP = `const S = await import("/modules/moinen-maps/dev/stack-bench.mjs");`;
async function run(dpr) {
  const ch = await startChrome(dpr), rows = [];
  try {
    const gmId = await join(PORT, GM, GMID), plId = ONLY === "GM" ? null : await join(PORT, PL, PLID);
    const gm = await connect(PORT, gmId), pl = plId ? await connect(PORT, plId) : null;
    await gm.front();
    console.log("scene", JSON.stringify(await gm.ev(`${IMP} return await S.ensureScene();`)));
    if ( pl ) { await pl.front(); await sleep(6000); await pl.ev(`for ( let i = 0; i < 100 && canvas.scene?.name !== "moinen stack bench"; i++ ) await new Promise((r) => setTimeout(r, 300)); return canvas.scene?.name;`); }
    const pick = arg("states", "") ? arg("states", "").split(",") : flag("quick") ? QUICK : null;
    const states = pick ? STATES.filter(([n]) => pick.includes(n)) : STATES;
    for ( const dark of DARK ) {
      for ( const [name, st] of states ) {
        await gm.front();
        const set = await gm.ev(`${IMP} return await S.setLayers(${JSON.stringify({ ...st, dark })});`);
        for ( const [who, c] of [["GM", gm], ["player", pl]] ) {
          if ( !c || (ONLY && ONLY !== who) ) continue;
          await c.front();
          const rd = await c.ev(`${IMP} return await S.ready();`);
          for ( const zoom of ZOOMS ) {
            const m = await c.ev(`${IMP} return await S.measure({ zoom: ${zoom} });`);
            // (GPU by owner: the layers alone and everything - where an excess sits)
            const own = QUICK.includes(name) && !flag("noOwners") ? await c.ev(`${IMP} return await S.attribute({ zoom: ${zoom} });`) : null;
            const row = { dpr, dark, state: name, st, who, zoom, set, ready: rd, ...m, owners: own?.owners, ownerKeys: own?.keys };
            rows.push(row);
            console.log(`dpr${dpr} ${dark ? "night" : "day"} ${name.padEnd(9)} ${who.padEnd(6)} z${zoom} gpu ${m.gpu.med} (p95 ${m.gpu.p95}) cpu ${m.cpu.mean} long ${m.long} rt ${m.counters.rtSwitch} draws ${m.counters.draws} filt ${m.counters.filterPush} real-dpr ${m.info.dpr.join("/")}`);
          }
          if ( dark === DARK[0] && MOVE.has(name) && !flag("noMove") ) {
            const mv = await c.ev(`${IMP} return await S.move();`);
            rows.push({ dpr, dark, state: name, st, who, move: mv });
            console.log(`   move ${who} ${JSON.stringify(mv)}`);
          }
        }
        fs.writeFileSync(path.join(OUT, `${LABEL}-dpr${dpr}.json`), JSON.stringify(rows));
      }
    }
    await gm.front(); await gm.ev(`${IMP} await S.setLayers({}); return 1;`);
    gm.close(); pl?.close();
  } finally { await stopChrome(ch); }
  return rows;
}

for ( const dpr of DPRS ) {
  const rows = await run(dpr);
  fs.writeFileSync(path.join(OUT, `${LABEL}-dpr${dpr}.json`), JSON.stringify(rows));
  console.log(summary(rows));
}
process.exit(0);
