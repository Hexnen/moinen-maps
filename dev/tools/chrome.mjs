// A private headless Chrome (or Edge) for cdp-rec.mjs / cdp.mjs / cdp-lane.mjs, with a temp profile that is removed on every way out
// (normal end, Ctrl+C, SIGTERM, console closed; after a hard kill the next start sweeps it - dev/lib/tmp.mjs). Use this instead
// of starting chrome.exe by hand with a --user-data-dir under %TEMP%.
//   node dev/tools/chrome.mjs [--port 9333] [--edge | --chrome chs|edge|chrome|<exe>] [--w 1280] [--h 800] [--dpr 1] [--profile <dir>] [--flags "<more>"]
//        runs until Ctrl+C (or the browser exits); prints {"port", "profile", "pid"} once it answers
//   node dev/tools/chrome.mjs [same options] -- <command> [args...]
//        starts the browser, runs the command (env CDP_PORT = the port), stops the browser, exits with the command's code, e.g.
//        node dev/tools/chrome.mjs --port 9333 -- node dev/tools/cdp-rec.mjs open 9333 http://127.0.0.13:30001/join
// --port 0 lets the browser pick a free port. --profile <dir>: that folder is used and never removed.
import { spawn } from "node:child_process";
import { startHeadless, closeBrowser, CHROME, EDGE, exeOf } from "../lib/browser.mjs";

const dd = process.argv.indexOf("--"), own = dd >= 0 ? process.argv.slice(2, dd) : process.argv.slice(2), cmd = dd >= 0 ? process.argv.slice(dd + 1) : [];
const arg = (k, d) => { const i = own.indexOf(`--${k}`); return i >= 0 ? own[i + 1] : d; };
const exe = own.includes("--edge") ? EDGE : exeOf(arg("chrome", null), CHROME), W = arg("w", 1280), H = arg("h", 800), DPR = arg("dpr", 1);
const flags = (arg("flags", "") ?? "").split(/\s+/).filter(Boolean);
const { b, port } = await startHeadless({
  kind: "cdp-chrome", exe, port: Number(arg("port", 9333)), profile: arg("profile", null),
  args: [`--window-size=${W},${H}`, `--force-device-scale-factor=${DPR}`, "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows", ...flags, "about:blank"]
});
console.log(JSON.stringify({ port, profile: b.prof, pid: b.p.pid }));
if ( cmd.length ) {
  const c = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", env: { ...process.env, CDP_PORT: String(port) } });
  const code = await new Promise((r) => { c.on("exit", (x) => r(x ?? 1)); c.on("error", (e) => { console.error(e.message); r(1); }); });
  await closeBrowser(b, { port });
  process.exit(code);
}
await new Promise((r) => b.p.once("exit", r));   // (Ctrl+C / SIGTERM: the dev/lib/tmp.mjs hooks kill the browser and remove the profile)
await closeBrowser(b);
process.exit(0);
