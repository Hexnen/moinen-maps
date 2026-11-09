// LOOK of an arrival for a lossless check (one build; run it per build with the lane junction flipped): the player page is reloaded on
// <back>, pulled to <to> while its screen is recorded (webm, dev/tools/cdp-rec.mjs rec, at the given CPU throttle), then after the
// settle: two screenshots 1 s apart (the noise floor of the animated layers) and the state the changed code makes (zones: ids, sample
// counts, marks from the layers; the damage layer's status), all into <outDir>/<label>-*.
// Usage: node dev/arrival-look.mjs <cdpPort> <gmPrefix> <playerPrefix> <to> <back> <outDir> <label> [--throttle k] [--dir on|off]
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { connect } from "./tools/cdp-lane.mjs";

const a = process.argv.slice(2), flag = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const [port, gmP, plP, to, back, outDir, label] = a, thr = Number(flag("throttle", 2)), dir = flag("dir", "on");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gm = await connect(port, gmP);
const ids = await gm.ev(`return [game.scenes.getName(${JSON.stringify(to)}).id, game.scenes.getName(${JSON.stringify(back)}).id, game.users.getName("Test Gracz 1").id, game.modules.get("moinen-maps").api.director.isOn()];`);
await gm.ev(`await game.modules.get("moinen-maps").api.director.setOn(${dir === "on"}); return 1;`);
let pl = await connect(port, plP);
if ( (await pl.ev("return canvas.scene.id")) !== ids[1] ) { await gm.ev(`game.scenes.get("${ids[1]}").pullUsers(["${ids[2]}"]); return 1;`); await sleep(9000); }
await pl.send("Page.reload"); await sleep(4000); pl.close();
for ( let k = 0; k < 60; k++ ) { try { pl = await connect(port, plP); if ( await pl.ev("return !!(game?.ready && canvas?.ready)", 3000) ) break; pl.close(); } catch { } await sleep(1000); }
await pl.ev(`await game.settings.set("moinen-maps", "dirMode", "auto"); return 1;`);
await sleep(9000);
await pl.send("Emulation.setCPUThrottlingRate", { rate: thr });
const r = spawnSync(process.execPath, ["dev/tools/cdp-rec.mjs", "rec", port, plP, `${outDir}/${label}.webm`, "10000", gmP, `game.scenes.get("${ids[0]}").pullUsers(["${ids[2]}"]); return 1;`, "--at", "500"], { encoding: "utf8", env: { ...process.env, CDP_W: "1600", CDP_H: "900" } });
console.log(r.stdout.trim(), r.stderr.trim());
await sleep(6000);
await pl.send("Emulation.setCPUThrottlingRate", { rate: 1 });
await sleep(2000);
for ( const k of [1, 2] ) { const s = await pl.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${outDir}/${label}-settle${k}.png`, Buffer.from(s.result.data, "base64")); await sleep(1000); }
const st = await pl.ev(`const z = game.modules.get("moinen-maps").api.zones, d = game.modules.get("moinen-maps").api.destruction;
  const Z = z.zones();
  return { scene: canvas.scene.name, view: [Math.round(canvas.stage.pivot.x), Math.round(canvas.stage.pivot.y), +canvas.stage.scale.x.toFixed(4)],
    zones: Z ? Z.zones.map((q) => [q.id, Math.round(q.area), Math.round(q.label.x), Math.round(q.label.y)]) : null,
    mapStates: [...z.mapStates()].map(([k, v]) => [k, v]), marks: [...(z.marks()?.zones ?? [])].map(([k, v]) => [k, v]),
    destr: (() => { try { const s = d.status?.(); return s ? { areas: s.stats?.areas ?? null, shownKey: !!s.shownKey } : null; } catch { return null; } })(),
    switchLog: game.modules.get("moinen-maps").api.diag.switchLog().slice(-1)[0] };`);
fs.writeFileSync(`${outDir}/${label}-state.json`, JSON.stringify(st, null, 1));
await gm.ev(`await game.modules.get("moinen-maps").api.director.setOn(${ids[3]}); game.scenes.get("${ids[1]}").pullUsers(["${ids[2]}"]); return 1;`);
await sleep(8000);
console.log(JSON.stringify({ label, zones: st.zones?.length, mapStates: st.mapStates.length, view: st.view }));
process.exit(0);
