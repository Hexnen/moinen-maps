// Painting editors, found by the painting test of 2026-11-02.   node dev/paint-editors.test.mjs
//  1. every glyph's `icon` (the Foundry core image stored on the note) is a file that exists in Foundry 14: icons/svg/first-aid.svg and
//     small-fire.svg do not, so the hospital and cafe pins logged "Invalid Asset" and their notes failed to draw. Checked against the
//     Foundry install when it is found (FOUNDRY_APP or the default Windows path), and always against the two known-missing names.
//  2. the water editor: Ctrl+Shift+Z / Ctrl+Y redo (Ctrl+Shift+Z used to undo one more stroke), a new stroke empties the redo stack,
//     leaving the scene empties it, and an undo step puts the masks it replaces on the redo stack (source-level, like roads-unload).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };

// 1. icons
globalThis.Hooks ??= { on() {}, once() {}, callAll() {} };
const { GLYPHS } = await import(pathToFileURL(path.join(root, "scripts/config.mjs")).href);
const MISSING = ["icons/svg/first-aid.svg", "icons/svg/small-fire.svg"];
const apps = [process.env.FOUNDRY_APP, "C:/Program Files/Foundry Virtual Tabletop/resources/app"].filter(Boolean);
const pub = apps.map((a) => path.join(a, "public")).find((p) => fs.existsSync(path.join(p, "icons/svg")));
for ( const [name, g] of Object.entries(GLYPHS) ) {
  ok(typeof g.icon === "string" && g.icon.startsWith("icons/svg/"), `glyph ${name}: a core svg icon`);
  ok(!MISSING.includes(g.icon), `glyph ${name}: ${g.icon} does not exist in Foundry 14`);
  if ( pub ) ok(fs.existsSync(path.join(pub, g.icon)), `glyph ${name}: ${g.icon} exists in the Foundry install (${pub})`);
}

// 2. water editor undo / redo
const src = fs.readFileSync(path.join(root, "scripts/water/editor.mjs"), "utf8");
ok(/const redo = \[\]/.test(src), "a redo stack");
ok(/const redoStroke = \(\) => step\(redo, undo\)/.test(src) && /const undoStroke = \(\) => step\(undo, redo\)/.test(src), "undo and redo are one step() each way");
ok(/\(k === "z" \|\| k === "y"\)/.test(src), "Ctrl+Z and Ctrl+Y are handled");
ok(/k === "y" \|\| e\.shiftKey \) redoStroke\(\); else undoStroke\(\)/.test(src), "Ctrl+Y and Ctrl+Shift+Z redo, Ctrl+Z undoes");
ok(/if \( s\.changed \) \{ redo\.length = 0; Water\.edited\(\); \}/.test(src), "a finished stroke empties the redo stack");
ok(/undo\.length = 0; redo\.length = 0;/.test(src), "teardown empties both stacks");
const step = src.slice(src.indexOf("function step("), src.indexOf("const undoStroke"));
ok(step.indexOf("other.push(snapshotOf(S, u.layers))") > 0 && step.indexOf("other.push(") < step.indexOf("S.masks[n].set(data)"), "the masks an undo replaces are kept (on the other stack) before they are overwritten");
console.log(`paint-editors: ${n} checks ok${pub ? "" : " (Foundry install not found: icon files not checked on disk)"}`);
