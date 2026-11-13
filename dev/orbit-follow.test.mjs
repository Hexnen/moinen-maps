// fxo2 (U217): the folded orbit button's list follows what it keeps clear of while it is open. The strip lives in orbit.mjs (Foundry
// globals), so this pins its wiring by source: a watch that starts only when the list opens in a fight, re-places the list (writing only a
// change), and stops when the list closes, the fight ends or the strip goes. Seen live on lane 5 (scratchpad fxo2, after-u217-*).
import assert from "node:assert/strict";
import fs from "node:fs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const src = fs.readFileSync(new URL("../scripts/zones/orbit.mjs", import.meta.url), "utf8");
const body = (name) => { const i = src.indexOf(`\n  ${name}(`); assert.ok(i > 0, `${name} exists`); const j = src.indexOf("\n  },", i); return src.slice(i, j); };

const setOpen = body("setOpen"), rewatch = body("rewatch"), remove = body("remove"), place = body("placeList");
ok(/if \( this\.open && this\.fight \) this\.rewatch\(\); else this\.unwatch\(\);/.test(setOpen), "opening the list in a fight starts the watch, closing stops it");
ok(/if \( this\.watch \) return;/.test(rewatch) && /setInterval\(/.test(rewatch) && /this\.open && this\.fight \) this\.placeList\(\); else this\.unwatch\(\)/.test(rewatch), "one watch at a time; it re-places the list while it is open, else stops itself");
ok(/unwatch\(\) \{ if \( this\.watch \) \{ clearInterval\(this\.watch\); this\.watch = 0; \} \}/.test(src), "unwatch clears the timer");
ok(/this\.unwatch\(\);/.test(remove), "the strip going stops the watch");
ok(/if \( fight !== this\.fight \) \{[^}]*this\.unwatch\(\);/.test(src), "the fight ending (or starting) stops the watch");
ok(/list\.style\.left === left && list\.style\.top === top && list\.dataset\.where === at\.where \) return;/.test(place), "the list is written only when its spot changed");
ok((src.match(/setInterval\(/g) ?? []).length === 1, "no other timer in the strip");
console.log(`orbit-follow: ${n} checks passed`);
