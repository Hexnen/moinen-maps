// LIVE CHECK: the first fire another client paints shows on a PLAYER at once (and its steam, in rain).   node dev/fire-first-show-run.mjs [case ...]
// Needs a Chrome with --remote-debugging-port (PORT, default 9444) holding a GM tab (GM_URL) and a player tab (PL_URL), both joined to
// a lane server (dev/tools/cdp-lane.mjs join). A program-cache miss is the case that matters: start that Chrome on a fresh profile with
// --disable-gpu-program-cache --disable-gpu-shader-disk-cache. Cases: dry (default), wet (rain on at load), rainlater, fast (the stroke
// arrives the moment the player's canvas is ready, the warm-up still running), hidden (the player's tab in the background meanwhile).
// Per case: the player tab is reloaded on the bench scene with no fire, the GM paints one stroke, the player is watched (5 ms poll):
// edit -> first fire display, -> fire visible, -> steam (when wet). PASS when the fire is visible within LIMIT ms (default 2000).
// Regression for 2026-11-09: the warm-up began only when the first stroke arrived and ran serially, polled by animation frames only:
// on a cache miss the art program's link alone took ~14 s and the player saw no fire (and no steam) that long. Cleans up after itself.
import { connect } from "./tools/cdp-lane.mjs";

const PORT = +(process.env.PORT ?? 9444), LIMIT = +(process.env.LIMIT ?? 2000);
const GM_URL = process.env.GM_URL ?? "http://127.0.0.14:30001/game", PL_URL = process.env.PL_URL ?? "http://127.0.0.13:30001/game";
const cases = process.argv.slice(2).length ? process.argv.slice(2) : ["dry"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gm = await connect(PORT, GM_URL), pl = await connect(PORT, PL_URL);
const IMP = `const S = await import("/modules/moinen-maps/dev/stack-bench.mjs");`;
const A = `game.modules.get("moinen-maps").api`;
const BENCH = "moinen stack bench";
const WATCH = `const A = ${A}; const W = window.__ffs = { t0: performance.now(), ev: {} };
  const poll = () => { let f = {}; try { f = A.fire.status(); } catch {} const st = A.weather.steamDisplay?.()?.stats;
    const t = Math.round(performance.now() - W.t0);
    if ( f.display ) W.ev.display ??= t; if ( (f.visible ?? 0) > 0 ) W.ev.visible ??= t; if ( (st?.inst ?? 0) > 0 ) W.ev.steam ??= t; };
  W.iv = setInterval(poll, 5); canvas.app.ticker.add(poll); W.stop = () => { clearInterval(W.iv); canvas.app.ticker.remove(poll); }; return 1;`;
const gmEv = (src) => gm.ev(src);
const rain = (on) => gmEv(`${IMP} const C = await import("/modules/moinen-maps/dev/weather-cost.mjs"); ${on ? `await C.setCase("rain", 3, { lens: false });` : `await C.setCase("off", 1);`} return 1;`);

async function fresh(fast) {
  await pl.front(); await pl.send("Page.reload", {});
  for ( let i = 0; i < 1200; i++ ) {
    await sleep(100);
    if ( await pl.ev(`return !!(globalThis.game?.ready && canvas?.ready && canvas.scene?.name === "${BENCH}" && ${A}?.fire)`, 5000).catch(() => false) ) break;
  }
  if ( !fast ) { await pl.ev(`${IMP} await S.ready(); return 1;`); await sleep(3000); }
}

let failed = 0;
for ( const c of cases ) {
  await gm.front();
  await gmEv(`${IMP} await S.ensureScene(); await S.setLayers({}); return 1;`);
  if ( c === "wet" ) await rain(true);
  await fresh(c === "fast" || c === "hidden");
  await pl.ev(WATCH);
  if ( c === "hidden" ) await gm.front();
  await gmEv(`return ${A}.fire.paint([[400, 400], [460, 410]], { radius: 40, level: 2, smoke: 1 })?.id;`);
  await sleep(c === "hidden" ? 4000 : 0); await pl.front();
  await sleep(8000);
  let rainAt = 0;
  if ( c === "rainlater" ) { rainAt = await pl.ev("return Math.round(performance.now() - window.__ffs.t0)"); await rain(true); await pl.front(); await sleep(5000); }
  const ev = await pl.ev("window.__ffs.stop(); return window.__ffs.ev;");
  const wet = c === "wet" || c === "rainlater";
  const ok = ev.visible !== undefined && ev.visible <= LIMIT && (!wet || ev.steam !== undefined);
  if ( !ok ) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${c.padEnd(9)} display ${ev.display ?? "-"} ms, visible ${ev.visible ?? "-"} ms${wet ? `, steam ${ev.steam ?? "-"} ms${rainAt ? ` (rain at ${rainAt})` : ""}` : ""}`);
  await gm.front(); await gmEv(`${IMP} await S.setLayers({}); return 1;`);
}
process.exit(failed ? 1 : 0);
