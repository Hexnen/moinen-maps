// A headless Chrome/Edge for the dev tools with a temp profile that is always cleaned up (dev/lib/tmp.mjs), plus a tiny CDP session.
//   const { b, port } = await startHeadless({ kind: "perf-edge", exe: EDGE, args: [...] });   ...   await closeBrowser(b, { port });
// port 0 (the default) lets the browser pick a free port (read back from <profile>/DevToolsActivePort): no clash with other agents.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchBrowser, closeBrowser } from "./tmp.mjs";

export const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Every headless browser that records or measures gets these three (measured 2026-11-13, one GM seat on a lane, Edge headless):
// without them Edge starts its own background renderers (built-in extensions, component pages, network fetches) some 30-60 s after
// launch and the process tree grows by about 1 GB (1.9-2.2 GB -> about 0.9 GB private working set at rest with them). Rendering, GPU
// WebGL, screencast, touch and frame pacing were unchanged. Only these three: no --mute-audio, no wider set.
export const LEAN_FLAGS = ["--disable-extensions", "--disable-component-extensions-with-background-pages", "--disable-background-networking"];
// chrome-headless-shell (Chrome for Testing: the old headless mode as its own small binary; see C:/mmwt-ultra/chs/SOURCE.txt). Selectable
// in every tool that starts a browser (`--chrome chs`), NOT the default (checked 2026-11-13 against Edge / Chrome on lane 5): WebGL2 on
// the GPU, extensions, fonts and text metrics, audio + codecs, touch emulation, two seats as contexts, screenshots, traces, CPU profiles
// and Performance metrics all match, and it records far better (two seats at 60 fps, busy: 50 vs 33 pictures/s). But it runs a FIXED
// 60 Hz frame clock while Edge / Chrome / a real player run at the display's rate (165 Hz here: Foundry's 60 fps cap then gives 55 fps,
// k = 3 vsyncs), so view-pace-live and guard-live --vsync measure a different display and hitch-run / stack-bench's real-ticker pan
// rows are not comparable with Edge / Chrome numbers. It is headless by nature, so it gets no --headless=new.
export const CHS = "C:/mmwt-ultra/chs/chrome-headless-shell-win64/chrome-headless-shell.exe";
export const isShell = (exe) => /headless[-_]shell/i.test(String(exe ?? ""));
/** The default browser of every dev tool that starts one (cdp-drive, cdp-perf, chrome.mjs, the five lane drivers). */
export const DEFAULT_EXE = EDGE;
/** A `--chrome` value: "chs" = the headless shell, "edge", "chrome", or a path; null = the default `d`. */
export const exeOf = (v, d = DEFAULT_EXE) => (v == null ? d : v === "chs" ? CHS : v === "edge" ? EDGE : v === "chrome" ? CHROME : v);
/** Windows "apps use dark theme" (HKCU Personalize AppsUseLightTheme = 0): what Edge / Chrome report as prefers-color-scheme. */
let darkOs = null;
export function osDark() {
  if ( darkOs != null ) return darkOs;
  try { darkOs = /AppsUseLightTheme\s+REG_DWORD\s+0x0\b/.test(execFileSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "AppsUseLightTheme"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })); }
  catch { darkOs = false; }
  return darkOs;
}
/** The switches that make `exe` start headless like the others. Edge / Chrome: --headless=new. The shell is headless by nature, but it
 *  always reports prefers-color-scheme: light, and Foundry picks its default app theme from that (game.configureUI: theme-light vs
 *  theme-dark on <body>), so it gets the OS scheme the way Edge reads it (measured 2026-11-13: --force-dark-mode has no effect on it). */
export const headlessArgs = (exe) => (isShell(exe) ? [`--blink-settings=preferredColorScheme=${osDark() ? 0 : 1}`] : ["--headless=new"]);

/** Start a headless browser; resolves when its CDP endpoint answers. Returns { b, port } (b for closeBrowser). LEAN_FLAGS are always on. */
export async function startHeadless({ kind, exe = DEFAULT_EXE, port = 0, profile = null, args = [], timeoutMs = 20000 }) {
  if ( profile && !port ) try { fs.rmSync(path.join(profile, "DevToolsActivePort"), { force: true }); } catch {}   // (a stale one of an earlier run)
  const b = launchBrowser(exe, [...headlessArgs(exe), `--remote-debugging-port=${port}`, ...LEAN_FLAGS, ...args], { kind, profile });
  const t0 = Date.now();
  while ( Date.now() - t0 < timeoutMs ) {
    await sleep(200);
    if ( b.p.exitCode != null ) break;
    let p = port;
    if ( !p ) try { p = Number(fs.readFileSync(path.join(b.prof, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]); } catch { continue; }
    try { if ( (await fetch(`http://127.0.0.1:${p}/json/version`)).ok ) return { b, port: p }; } catch {}
  }
  await closeBrowser(b);
  throw new Error(`browser did not start: ${exe}`);
}
export { closeBrowser };

/** A CDP session over one websocket: send(method, params) -> full reply; on(method, fn) for events; close(). */
export async function session(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let id = 0; const pend = new Map(), on = new Map();
  ws.addEventListener("message", (m) => {
    const q = JSON.parse(m.data);
    if ( q.id && pend.has(q.id) ) { pend.get(q.id)(q); pend.delete(q.id); } else if ( q.method ) for ( const fn of on.get(q.method) ?? [] ) fn(q.params);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, on: (m, fn) => on.set(m, [...(on.get(m) ?? []), fn]), close: () => ws.close() };
}
/** The first page target of the browser on `port`. */
export async function firstPage(port) {
  for ( let i = 0; i < 50; i++ ) {
    try { const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === "page"); if ( t ) return t; } catch {}
    await sleep(200);
  }
  throw new Error("no page target");
}
