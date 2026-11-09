// dev/lib/tmp.mjs: temp folders and browser profiles never stay in %TEMP%.   node dev/tmp-clean.test.mjs
// A child node process (the "owner") makes a temp folder and a browser profile (kind selftest-<pid>) with a dummy "browser" on it (a
// node process with --user-data-dir=<profile> on its command line that runs until killed), then ends in one of these ways:
//   normal end, process.exit(3), an uncaught exception, a rejected top-level await, SIGINT and SIGTERM (the hooks, emitted in-process:
//   Windows cannot deliver a real signal to another process) -> both folders are gone and the dummy browser is dead right after;
//   a hard kill (taskkill /F of the owner only): nothing can run in it -> the folders stay. A browser it launched dies with it (node
//   puts its children in a kill-on-close job on Windows); a browser outside that job (as a python script starts one) is left
//   running: the owner also starts such a detached "orphan" on a third folder. The next sweep of the same kind kills the orphan
//   (found by its command line) and removes all three folders.
// Safety: the sweep keeps the folders (and the orphan) of an owner that is alive, a folder without our marker, other kinds' folders.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sweep, alive, makeTempDir, ourDirs, MARK } from "./lib/tmp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)), LIB = pathToFileURL(path.join(here, "lib", "tmp.mjs")).href;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KIND = `selftest-${process.pid}`;   // (unique: parallel runs never sweep each other's)
const ours = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(`mm-${KIND}`)).map((n) => path.join(os.tmpdir(), n));
const ex = (d) => fs.existsSync(d);
const hardKill = (pid) => { if ( process.platform === "win32" ) execFileSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore" }); else process.kill(pid, "SIGKILL"); };
/** The JSON first line a spawned owner prints (rejects if it ends first). */
const firstLine = (c) => new Promise((res, rej) => {
  let s = ""; c.stdout.on("data", (d) => { s += d; if ( s.includes("\n") ) res(JSON.parse(s.split("\n")[0])); });
  c.on("exit", () => rej(new Error(`owner ended: ${s}`)));
});
const ended = (c) => new Promise((r) => (c.exitCode != null || c.signalCode != null ? r() : c.on("exit", r)));

const OWNER = `
import { makeTempDir, launchBrowser } from ${JSON.stringify(LIB)};
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const how = process.argv[2], dummy = fileURLToPath(new URL("./dummy-browser.mjs", import.meta.url));
const b = launchBrowser(process.execPath, [dummy], { kind: ${JSON.stringify(KIND)} });
fs.writeFileSync(b.prof + "/payload.bin", Buffer.alloc(1 << 20));
const extra = makeTempDir(${JSON.stringify(KIND)}); fs.writeFileSync(extra + "/x.txt", "x");
const info = { dir: b.prof, extra, kid: b.p.pid };
if ( how === "hang" ) {
  info.orphanDir = makeTempDir(${JSON.stringify(KIND)});
  const o = spawn(process.execPath, [dummy, "--user-data-dir=" + info.orphanDir], { detached: true, stdio: "ignore", windowsHide: true });
  o.unref(); info.orphan = o.pid;
}
console.log(JSON.stringify(info));
await new Promise((r) => setTimeout(r, 300));
if ( how === "exit" ) process.exit(3);
if ( how === "throw" ) throw new Error("boom");
if ( how === "reject" ) await Promise.reject(new Error("rej"));
if ( how === "SIGINT" || how === "SIGTERM" ) { process.emit(how, how); await new Promise(() => {}); }
if ( how === "hang" ) await new Promise((r) => setTimeout(r, 600000));
if ( how === "normal" ) b.p.kill();   // (then the process ends by itself)
`;
// leftovers of an earlier run of this test that was itself killed (its kinds carry its pid)
for ( const k of new Set(ourDirs().map((x) => x.mark.kind).filter((k) => /^selftest-\d+x?$/.test(k) && !alive(Number(k.match(/\d+/)[0])))) ) sweep(k);
const work = makeTempDir("tmpclean-work");   // the two scripts (removed with this process, however it ends)
const ownerFile = path.join(work, "owner.mjs");
fs.writeFileSync(ownerFile, OWNER);
fs.writeFileSync(path.join(work, "dummy-browser.mjs"), "setInterval(() => {}, 1000);   // a stand-in browser: runs until killed\n");
const orphans = [];
try {
  for ( const how of ["normal", "exit", "throw", "reject", "SIGINT", "SIGTERM"] ) {
    const r = spawnSync(process.execPath, [ownerFile, how], { encoding: "utf8", timeout: 60000 });
    let info = null; try { info = JSON.parse(r.stdout.split("\n")[0]); } catch {}
    if ( !info ) { check(false, `${how}: the owner did not start: ${r.stdout}${r.stderr}`); continue; }
    await sleep(200);
    check(!ex(info.dir) && !ex(info.extra) && !alive(info.kid), `${how} (exit ${r.status}): profile and temp folder removed, browser killed`);
  }

  // hard kill of the owner
  const c = spawn(process.execPath, [ownerFile, "hang"], { stdio: ["ignore", "pipe", "inherit"] });
  const info = await firstLine(c); orphans.push(info.orphan);
  await sleep(500);
  hardKill(c.pid); await ended(c); await sleep(500);
  check(ex(info.dir) && ex(info.extra) && ex(info.orphanDir) && alive(info.orphan) && !alive(info.kid),
    "hard kill: the folders stay, the job-launched browser died with the owner, the detached orphan runs on");

  // a live owner of the same kind; a folder with our name but no marker; a marked folder of another kind with a dead owner
  const live = spawn(process.execPath, [ownerFile, "hang"], { stdio: ["ignore", "pipe", "inherit"] });
  const liveInfo = await firstLine(live); orphans.push(liveInfo.orphan);
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), `mm-${KIND}-`));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), `mm-${KIND}x-`));
  fs.writeFileSync(path.join(other, MARK), JSON.stringify({ v: 1, kind: `${KIND}x`, pid: c.pid, tool: "test" }));

  sweep(KIND);   // (a second sweep must keep the live owner's things)
  await sleep(300);
  check(!ex(info.dir) && !ex(info.extra) && !ex(info.orphanDir) && !alive(info.orphan),
    "next run (the second owner's own start sweeps its kind): the dead owner's 3 folders are removed and its orphaned browser killed");
  check(ex(liveInfo.dir) && ex(liveInfo.extra) && ex(liveInfo.orphanDir) && alive(liveInfo.kid) && alive(liveInfo.orphan), "a live owner's folders and browsers are kept");
  check(ex(foreign), "a folder without our marker is kept");
  check(ex(other), "a stale folder of another kind is kept by a sweep of this kind");

  // the live owner hard-killed too: the next sweep takes its leftovers; the other kind goes with a sweep of its own kind
  hardKill(live.pid); await ended(live); await sleep(300);
  sweep(KIND); sweep(`${KIND}x`);
  check(!ex(liveInfo.dir) && !ex(liveInfo.extra) && !ex(liveInfo.orphanDir) && !alive(liveInfo.orphan) && !ex(other), "after its owner is killed, that owner's leftovers are swept too");
  fs.rmSync(foreign, { recursive: true, force: true });
} finally {
  sweep(KIND); sweep(`${KIND}x`);
  for ( const d of ours() ) if ( !ex(path.join(d, MARK)) ) fs.rmSync(d, { recursive: true, force: true });   // (the unmarked one made above)
}
check(ours().length === 0, "nothing of this test is left in the temp folder");
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
