// Temp folders and headless-browser profiles for the dev tools, cleaned up on EVERY way out (see dev/tools/README.md "Temp and
// browser profiles"). A folder made here is `<os.tmpdir()>/mm-<kind>-XXXXXX` with an owner marker (`.mm-owner.json`: kind, tool,
// owner pid). It is removed:
//   - on a normal end, process.exit(), an uncaught exception or rejection (the 'exit' hook, synchronous);
//   - on Ctrl+C / SIGINT, SIGTERM, SIGHUP (console closed), SIGBREAK (the signal hooks, then exit 128 + n);
//   - after a hard kill (taskkill /F, a crash): the NEXT makeTempDir/launchBrowser of the same kind sweeps it - only folders with our
//     marker whose owner process is gone; a browser still running on such a folder (orphaned by the kill) is identified by its
//     command line (`--user-data-dir=` + the folder's unique name), killed with its process tree, and only then is the folder removed.
// Never touched: folders without our marker (other tools, older versions of these tools, `--profile <dir>` given by the user),
// folders whose owner is alive, folders a browser uses while its owner is alive.
//   node dev/lib/tmp.mjs list            every mm-* folder in %TEMP%: kind, owner, alive or stale, MB
//   node dev/lib/tmp.mjs sweep [kind]    remove the stale ones (all kinds, or one kind)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const MARK = ".mm-owner.json";
const WIN = process.platform === "win32";
const owned = new Set();          // folders this process made (removed on exit)
const kids = new Map();           // pid -> ChildProcess this process started (killed with their tree on exit)
let hooked = false;

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const tmpRoot = () => os.tmpdir();
function checkKind(kind) { if ( !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(kind ?? "") ) throw new Error(`tmp: bad kind ${kind}`); return kind; }

/** Is the process `pid` running? (EPERM = it exists but is not ours: alive.) */
export function alive(pid) {
  if ( !Number.isInteger(pid) || pid <= 0 ) return false;
  try { process.kill(pid, 0); return true; } catch ( e ) { return e.code === "EPERM"; }
}

/** Kill a process and everything it started (Windows: taskkill /T /F). Synchronous; ignores a process that is already gone. */
export function killTree(pid) {
  if ( !alive(pid) ) return;
  if ( WIN ) { try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {} }
  else { try { process.kill(pid, "SIGKILL"); } catch {} }
}

/** Remove a folder, retrying while a just-killed browser still holds files. Synchronous. Returns true when it is gone. */
export function removeDir(dir, { tries = 20, delay = 250 } = {}) {
  for ( let i = 0; i < tries; i++ ) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); } catch {}
    if ( !fs.existsSync(dir) ) return true;
    sleepSync(delay);
  }
  return !fs.existsSync(dir);
}

function cleanupAll() {
  for ( const [pid] of kids ) killTree(pid);
  kids.clear();
  for ( const d of owned ) removeDir(d);
  owned.clear();
}
function hook() {
  if ( hooked ) return;
  hooked = true;
  process.on("exit", cleanupAll);
  const SIG = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1, SIGBREAK: 21 };
  for ( const [s, n] of Object.entries(SIG) ) {
    try { process.on(s, () => { cleanupAll(); process.exit(128 + n); }); } catch {}   // (SIGBREAK exists on Windows only)
  }
}

function readMark(dir) {
  try { const m = JSON.parse(fs.readFileSync(path.join(dir, MARK), "utf8")); return m?.v === 1 && typeof m.kind === "string" && Number.isInteger(m.pid) ? m : null; }
  catch { return null; }
}
/** Our marked folders in the temp root: [{ dir, mark }]. */
export function ourDirs() {
  let names = [];
  try { names = fs.readdirSync(tmpRoot()).filter((n) => n.startsWith("mm-")); } catch {}
  return names.map((n) => ({ dir: path.join(tmpRoot(), n), mark: readMark(path.join(tmpRoot(), n)) })).filter((x) => x.mark);
}

/** Processes started with `--user-data-dir=` on their command line: [{ pid, cmd }]. */
function browserProcs() {
  try {
    if ( WIN ) {
      const ps = "Get-CimInstance Win32_Process -Filter \"CommandLine like '%--user-data-dir=%'\" | Where-Object { $_.ProcessId -ne $PID } | "
        + "ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; cmd = [string]$_.CommandLine } } | ConvertTo-Json -Compress";
      const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
      if ( !out ) return [];
      const j = JSON.parse(out);
      return (Array.isArray(j) ? j : [j]).filter((x) => x?.pid && x.cmd);
    }
    return execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" }).split("\n").map((l) => l.trim().match(/^(\d+)\s+(.*)$/))
      .filter((m) => m && m[2].includes("--user-data-dir=")).map((m) => ({ pid: Number(m[1]), cmd: m[2] }));
  } catch { return null; }   // unknown: the sweep then removes nothing that a browser could be using
}
/** The processes whose `--user-data-dir=` is `dir` (matched by its unique folder name). */
function usersOf(dir, procs) {
  const name = path.basename(dir).toLowerCase();
  return procs.filter((p) => { const c = p.cmd.toLowerCase(), i = c.indexOf("--user-data-dir="); return i >= 0 && c.slice(i).includes(name); });
}

/**
 * Remove stale folders of `kind` (or of every kind with kind = null): our marker, owner process gone. A browser left running on one
 * (its owner was hard-killed) is killed first. Returns [{ dir, kind, removed, killed }].
 */
export function sweep(kind = null, { dry = false } = {}) {
  const stale = ourDirs().filter(({ dir, mark }) => (kind == null || mark.kind === kind) && mark.pid !== process.pid && !alive(mark.pid) && !owned.has(dir));
  if ( !stale.length ) return [];
  const procs = browserProcs();
  const res = [];
  for ( const { dir, mark } of stale ) {
    if ( procs == null ) { res.push({ dir, kind: mark.kind, removed: false, killed: 0, why: "cannot list processes" }); continue; }
    const users = usersOf(dir, procs);
    if ( dry ) { res.push({ dir, kind: mark.kind, removed: false, killed: 0, users: users.length }); continue; }
    for ( const u of users ) killTree(u.pid);
    res.push({ dir, kind: mark.kind, removed: removeDir(dir), killed: users.length });
  }
  if ( process.env.MM_TMP_VERBOSE ) for ( const r of res ) console.error(`tmp sweep: ${r.dir} removed=${r.removed} killed=${r.killed}`);
  return res;
}

/**
 * A fresh temp folder `<tmp>/mm-<kind>-XXXXXX`, marked as ours and removed when this process ends in any way. Sweeps the stale
 * folders of the same kind first.
 */
export function makeTempDir(kind) {
  checkKind(kind);
  hook();
  sweep(kind);
  const dir = fs.mkdtempSync(path.join(tmpRoot(), `mm-${kind}-`));
  owned.add(dir);
  fs.writeFileSync(path.join(dir, MARK), JSON.stringify({ v: 1, kind, pid: process.pid, tool: process.argv[1] ?? null, created: new Date().toISOString() }));
  return dir;
}
/** Remove a folder made by makeTempDir now (it is no longer removed on exit). */
export function removeTempDir(dir) { const ok = removeDir(dir); if ( ok ) owned.delete(dir); return ok; }

/**
 * Start a browser (Chrome/Edge) with `--user-data-dir`. Without `profile` the profile is a fresh makeTempDir(kind) folder (removed
 * with the browser); with `profile` (the tools' `--profile <dir>`) that folder is used and NEVER removed. Either way the browser's
 * process tree is killed if this process ends before closeBrowser. Returns { p, prof, owned }.
 */
export function launchBrowser(exe, args, { kind, profile = null, stdio = "ignore" } = {}) {
  hook();
  const prof = profile ?? makeTempDir(kind);
  const p = spawn(exe, [...args, `--user-data-dir=${prof}`], { stdio, windowsHide: true });   // (last: Chrome reads switches anywhere)
  p.on("error", () => {});
  kids.set(p.pid, p);
  p.on("exit", () => kids.delete(p.pid));
  return { p, prof, owned: !profile };
}

/**
 * Stop a browser from launchBrowser: Browser.close over CDP when `port` is given, up to `graceMs` for it to exit, then its whole
 * process tree is killed and an owned profile is removed (with retries while files are still held).
 */
export async function closeBrowser(b, { port = null, graceMs = 2500 } = {}) {
  if ( !b ) return;
  const { p, prof } = b;
  if ( port ) try {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(), ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
    ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
  } catch {}
  if ( p.exitCode == null && p.signalCode == null ) await Promise.race([new Promise((r) => p.once("exit", r)), new Promise((r) => setTimeout(r, graceMs))]);
  killTree(p.pid);
  kids.delete(p.pid);
  if ( b.owned ) removeTempDir(prof);
}

// CLI
if ( process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ) {
  const [cmd, kind] = process.argv.slice(2);
  const mb = (d) => { let s = 0; const walk = (x) => { for ( const e of fs.readdirSync(x, { withFileTypes: true }) ) { const f = path.join(x, e.name); try { if ( e.isDirectory() ) walk(f); else s += fs.statSync(f).size; } catch {} } }; try { walk(d); } catch {} return (s / 1048576).toFixed(1); };
  if ( cmd === "list" ) {
    for ( const { dir, mark } of ourDirs() ) console.log(`${alive(mark.pid) ? "live " : "stale"} ${mark.kind.padEnd(16)} pid ${String(mark.pid).padEnd(6)} ${mb(dir).padStart(8)} MB  ${dir}`);
  } else if ( cmd === "sweep" ) {
    const r = sweep(kind ?? null);
    for ( const x of r ) console.log(`${x.removed ? "removed" : "KEPT   "} ${x.kind.padEnd(16)} killed ${x.killed}  ${x.dir}${x.why ? `  (${x.why})` : ""}`);
    console.log(`${r.filter((x) => x.removed).length}/${r.length} stale folder(s) removed`);
  } else console.log("node dev/lib/tmp.mjs list | sweep [kind]");
}
