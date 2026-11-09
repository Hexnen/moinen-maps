// node eq.mjs <throttle>: glide + zoom glide + drag + director take + follow on P1, the per-frame strip check running throughout
import fs from "node:fs"; import { page, sleep } from "./lib.mjs";
const rate = +(process.argv[2] ?? 2);
const P = await page("http://127.0.0.152"), G = await page("http://127.0.0.151");
const HOME = `for ( const a of [...foundry.applications.instances.values()] ) if ( a.hasFrame && a.rendered ) await a.close(); await canvas.animatePan({ x: 1500, y: 5300, scale: 0.6, duration: 0 }); await new Promise((r) => setTimeout(r, 600)); return 1;`;
await P.send("Emulation.setCPUThrottlingRate", { rate });
const out = {};
const run = async (name, fn) => { await P.ev(HOME); await P.ev(fs.readFileSync("eqcheck-start.js", "utf8")); await fn(); out[name] = await P.ev(fs.readFileSync("eqcheck-stop.js", "utf8")); console.error(name, JSON.stringify(out[name])); };
try {
  await run("glide-top", () => P.ev(`for ( const [x, y, s] of [[2500, 300, 0.2], [1000, -100, 0.45], [4000, 600, 0.13], [2500, 200, 0.7], [1500, 5300, 0.6]] ) await canvas.animatePan({ x, y, scale: s, duration: 1100 }); return 1;`));
  await run("wheel-zoom", () => P.ev(`await canvas.animatePan({ x: 2500, y: 400, scale: 0.3, duration: 0 }); for ( let i = 0; i < 24; i++ ) { canvas.app.view.dispatchEvent(new WheelEvent("wheel", { deltaY: i < 12 ? -100 : 100, clientX: 800, clientY: 300, bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 70)); } await new Promise((r) => setTimeout(r, 800)); return 1;`));
  await run("drag", async () => {
    await P.ev(`await canvas.animatePan({ x: 2500, y: 500, scale: 0.25, duration: 0 }); return 1;`);
    const m = (type, x, y, extra = {}) => P.send("Input.dispatchMouseEvent", { type, x, y, button: "right", buttons: type === "mouseReleased" ? 0 : 2, ...extra });
    for ( let k = 0; k < 4; k++ ) { const dx = k % 2 ? 1 : -1, x0 = 800 - dx * 300, y0 = 450 - dx * 150;
      await P.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0, y: y0, button: "none", buttons: 0 }); await m("mousePressed", x0, y0, { clickCount: 1 });
      for ( let i = 1; i <= 50; i++ ) { await m("mouseMoved", x0 + dx * 10 * i, y0 + dx * 5 * i); await sleep(16); }
      await m("mouseReleased", x0 + dx * 500, y0 + dx * 250, { clickCount: 1 }); await sleep(150); }
  });
  await G.ev(`const D = game.modules.get("moinen-maps").api.director; if ( !D.isOn() ) await D.setOn(true); if ( D.status().paused ) await D.setPaused(false); return 1;`);
  await run("director-take", async () => { await G.ev(`game.modules.get("moinen-maps").api.director.emit({ kind: "destruction", weight: 1, force: true, x: 2500, y: 300, box: { x0: 2200, y0: 100, x1: 2800, y1: 500 }, caption: { key: "Dir.cap.collapse", data: {} } }); return 1;`); await sleep(8000); });
  await sleep(15000); await run("director-follow", async () => { await G.ev(`const d = canvas.scene.tokens.get("sYce4RTsRN35qzSP"); await d.update({ x: 4200, y: 1050 }); return 1;`); await sleep(9000); });
} finally {
  await P.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await G.ev(`const D = game.modules.get("moinen-maps").api.director; await D.setOn(false); const d = canvas.scene.tokens.get("sYce4RTsRN35qzSP"); if ( d.x !== 700 ) await d.update({ x: 700, y: 1050 }, { animate: false }); return 1;`);
}
console.log(JSON.stringify(out)); process.exit(0);
