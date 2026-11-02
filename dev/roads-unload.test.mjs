// Roads: the cars' shared textures are never destroyed while their sprites can still be drawn.   node dev/roads-unload.test.mjs
//  1. no beforeunload / pagehide / unload handler in scripts/roads calls destroyTextures (the canvas keeps rendering until the page is
//     gone, or forever when a "leave the page?" prompt keeps it: every car then drew a destroyed texture - calculateVertices on null);
//  2. teardown destroys the traffic view (its sprites) BEFORE the shared textures;
//  3. art.mjs: a texture asked for after destroyTextures() is a new, live one (isLive check), with fake PIXI / canvas.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
for ( const f of fs.readdirSync(path.join(root, "scripts/roads")).filter((x) => x.endsWith(".mjs")) ) {
  const src = fs.readFileSync(path.join(root, "scripts/roads", f), "utf8");
  for ( const m of src.matchAll(/addEventListener\(\s*["'](beforeunload|pagehide|unload)["']\s*,([^\n]*)/g) ) ok(!/destroyTextures/.test(m[2]), `${f}: ${m[1]} handler does not destroy the car textures`);
}
const roads = fs.readFileSync(path.join(root, "scripts/roads/roads.mjs"), "utf8");
const td = roads.slice(roads.indexOf("function teardown()"), roads.indexOf("}", roads.indexOf("function teardown()") + 20) + 400);
ok(td.includes("destroyTextures()") && td.indexOf("traffic?.destroy()") < td.indexOf("destroyTextures()"), "teardown: the cars go before their textures");

// 3. live textures again after a destroy
class FakeBase { constructor() { this.destroyed = false; this.mipmap = 0; } }
class FakeTex { constructor() { this.baseTexture = new FakeBase(); this.valid = true; } destroy() { this.baseTexture.destroyed = true; this.baseTexture = null; this.valid = false; } }
globalThis.PIXI = { Texture: { from: () => new FakeTex() }, SCALE_MODES: { NEAREST: 0, LINEAR: 1 }, MIPMAP_MODES: { ON: 2 } };
const ctx2d = new Proxy({}, { get: (t, k) => (k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : k === "createRadialGradient" || k === "createLinearGradient" ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
globalThis.Hooks ??= { on() {}, once() {}, callAll() {} };
const A = await import(pathToFileURL(path.join(root, "scripts/roads/art.mjs")).href);
const a = A.shadowTexture();
A.destroyTextures();
ok(a.baseTexture === null, "destroyTextures destroys the cached texture");
const b = A.shadowTexture();
ok(b !== a && b.baseTexture && !b.baseTexture.destroyed, "a texture asked for after destroyTextures is a new live one");
console.log(`roads-unload: ${n} checks ok`);
