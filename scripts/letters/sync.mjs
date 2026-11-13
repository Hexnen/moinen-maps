// LETR: keep the two copies of the lettering engine equal.
//   node scripts/letters/sync.mjs                    rewrite stamp.mjs (when the content changed) and MANIFEST.json of this folder
//                                                    (after editing the canonical copy in moinen-maps)
//   node scripts/letters/sync.mjs <otherFolder>      the same, then copy every file of this folder to <otherFolder> (the vendored
//                                                    copy, a folder ending in scripts/letters), manifest and stamp included
//   node scripts/letters/sync.mjs --check            exit 1 when a file differs from MANIFEST.json or stamp.mjs is stale (run by both
//                                                    modules' checks)
//   node scripts/letters/sync.mjs --check <other>    also exit 1 when <other> (the other module's copy) is not identical to this one
// FXLE F14: the copy target is guarded (only an existing LETR copy or a new folder named scripts/letters, never this folder, never a
// folder holding .git); only files are replaced and files that no longer exist here are removed, the folder itself is never deleted.
// stamp.mjs carries a hash of the content and the time it last changed: two copies with the same VERSION but different content pick
// the more recently synced one at runtime (index.mjs), not whichever loaded first.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const NOTE = "LETR engine: identical in moinen-maps (canonical) and invincible-plus-ultra (vendored). Edit the canonical copy, then run sync.mjs.";
const SPECIAL = new Set(["MANIFEST.json", "stamp.mjs"]);
const walk = (d, base = d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name)).replaceAll("\\", "/")]);
const content = (dir) => walk(dir).filter((f) => !SPECIAL.has(f)).sort();
const sha = (dir, f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex").slice(0, 16);
const contentHash = (dir) => crypto.createHash("sha256").update(content(dir).map((f) => `${f}:${sha(dir, f)}`).join("\n")).digest("hex").slice(0, 16);
const readStamp = (dir) => { try { const m = fs.readFileSync(path.join(dir, "stamp.mjs"), "utf8").match(/hash: "([0-9a-f]+)", at: "([^"]+)"/); return m ? { hash: m[1], at: m[2] } : null; } catch { return null; } };
const manifest = (dir) => ({ note: NOTE, files: Object.fromEntries([...content(dir), "stamp.mjs"].filter((f) => fs.existsSync(path.join(dir, f))).sort().map((f) => [f, sha(dir, f)])) });
const readManifest = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, "MANIFEST.json"), "utf8")); } catch { return null; } };

const args = process.argv.slice(2);
if ( args[0] === "--check" ) {
  const bad = [];
  const m = readManifest(here)?.files ?? {}, now = manifest(here).files;
  const diff = [...new Set([...Object.keys(m), ...Object.keys(now)])].filter((f) => m[f] !== now[f]);
  if ( diff.length ) bad.push(`${diff.length} file(s) differ from MANIFEST.json: ${diff.join(", ")}`);
  const st = readStamp(here);
  if ( !st || st.hash !== contentHash(here) ) bad.push("stamp.mjs is stale (run sync.mjs)");
  if ( args[1] ) {
    const other = path.resolve(args[1]);
    const om = manifest(other).files;
    const d2 = [...new Set([...Object.keys(now), ...Object.keys(om)])].filter((f) => now[f] !== om[f]);
    if ( d2.length ) bad.push(`the copy in ${other} differs: ${d2.join(", ")}`);
  }
  console.log(bad.length ? `LETR manifest: ${bad.join("; ")}` : `LETR manifest OK (${Object.keys(now).length} files${args[1] ? ", both copies equal" : ""})`);
  process.exit(bad.length ? 1 : 0);
}

/* refresh the stamp only when the content changed (the time is what picks between equal VERSIONs at runtime) */
const h = contentHash(here), st = readStamp(here);
if ( !st || st.hash !== h ) fs.writeFileSync(path.join(here, "stamp.mjs"), `// LETR: written by sync.mjs (content hash and when it last changed); index.mjs uses it to pick between copies of equal VERSION\nexport const STAMP = { hash: "${h}", at: "${new Date().toISOString()}" };\n`);
fs.writeFileSync(path.join(here, "MANIFEST.json"), JSON.stringify(manifest(here), null, 1) + "\n");

if ( args[0] ) {
  const dst = path.resolve(args[0]);
  const refuse = (why) => { console.error(`sync.mjs: refusing to copy to ${dst}: ${why}`); process.exit(2); };
  if ( dst === here ) refuse("it is this folder");
  if ( path.basename(dst) !== "letters" || path.basename(path.dirname(dst)) !== "scripts" ) refuse("the target must be a folder <module>/scripts/letters");
  if ( fs.existsSync(dst) ) {
    if ( !fs.statSync(dst).isDirectory() ) refuse("it is not a folder");
    if ( fs.existsSync(path.join(dst, ".git")) ) refuse("it holds .git");
    const om = readManifest(dst);
    if ( !(om && typeof om.note === "string" && om.note.startsWith("LETR engine")) && fs.readdirSync(dst).length ) refuse("it is not empty and not a LETR copy (no LETR MANIFEST.json)");
  }
  const mine = [...content(here), "stamp.mjs", "MANIFEST.json"];
  if ( fs.existsSync(dst) ) for ( const f of walk(dst) ) if ( !mine.includes(f) ) fs.rmSync(path.join(dst, f));
  for ( const f of mine ) { fs.mkdirSync(path.dirname(path.join(dst, f)), { recursive: true }); fs.copyFileSync(path.join(here, f), path.join(dst, f)); }
  console.log(`copied ${mine.length} files to ${dst}`);
} else console.log("MANIFEST.json written");
