// LETR: keep the two copies of the lettering engine equal.
//   node scripts/letters/sync.mjs                 rewrite MANIFEST.json of this folder (after editing the canonical copy in moinen-maps)
//   node scripts/letters/sync.mjs <otherFolder>   copy every file of this folder to <otherFolder> (the vendored copy), manifest included
//   node scripts/letters/sync.mjs --check         exit 1 when a file differs from MANIFEST.json (run by both modules' checks)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const walk = (d, base = d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name)).replaceAll("\\", "/")]);
const files = () => walk(here).filter((f) => f !== "MANIFEST.json").sort();
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(here, f))).digest("hex").slice(0, 16);
const manifest = () => ({ note: "LETR engine: identical in moinen-maps (canonical) and invincible-plus-ultra (vendored). Edit the canonical copy, then run sync.mjs.", files: Object.fromEntries(files().map((f) => [f, sha(f)])) });

const arg = process.argv[2];
if ( arg === "--check" ) {
  const m = JSON.parse(fs.readFileSync(path.join(here, "MANIFEST.json"), "utf8")).files, now = manifest().files;
  const bad = [...new Set([...Object.keys(m), ...Object.keys(now)])].filter((f) => m[f] !== now[f]);
  console.log(bad.length ? `LETR manifest: ${bad.length} file(s) differ: ${bad.join(", ")}` : `LETR manifest OK (${Object.keys(now).length} files)`);
  process.exit(bad.length ? 1 : 0);
}
fs.writeFileSync(path.join(here, "MANIFEST.json"), JSON.stringify(manifest(), null, 1) + "\n");
if ( arg ) {
  const dst = path.resolve(arg);
  fs.rmSync(dst, { recursive: true, force: true });
  for ( const f of [...files(), "MANIFEST.json"] ) { fs.mkdirSync(path.dirname(path.join(dst, f)), { recursive: true }); fs.copyFileSync(path.join(here, f), path.join(dst, f)); }
  console.log(`copied ${files().length + 1} files to ${dst}`);
} else console.log("MANIFEST.json written");
