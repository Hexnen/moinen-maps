// node dev/vram.test.mjs: the VRAM meter's pure parts (scripts/vram-gpu.mjs, scripts/vram.mjs).
//   1. renderer strings (ANGLE / plain / laptop / integrated / masked) -> model and memory, the smaller size for two-size models;
//   2. stack traces -> layer (first frame of ours wins; flood -> water; nothing of ours -> foundry; vram.mjs itself skipped);
//   3. bytes per texel of the GL formats PIXI uses.
globalThis.Hooks ??= { on() {}, once() {}, off() {}, callAll() {} };
const G = await import("../scripts/vram-gpu.mjs");
const V = await import("../scripts/vram.mjs");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };

// 1. cards
const cases = [
  ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Ti (0x00002482) Direct3D11 vs_5_0 ps_5_0, D3D11)", 8, 0, false, "NVIDIA GeForce RTX 3070 Ti"],
  ["ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 (0x00001B80) Direct3D11 vs_5_0 ps_5_0, D3D11)", 8, 0, false],
  ["ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)", 11, 0, false],
  ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)", 6, 0, false],
  ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)", 12, 8, false],
  ["ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)", 16, 0, false],
  ["ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)", 6, 0, false],
  ["ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0, D3D11)", 3, 6, false],
  ["ANGLE (AMD, AMD Radeon RX 580 2048SP (0x00006FDF) Direct3D11 vs_5_0 ps_5_0, D3D11)", 4, 8, false],
  ["ANGLE (AMD, AMD Radeon RX 7900 XTX Direct3D11 vs_5_0 ps_5_0, D3D11)", 24, 0, false],
  ["ANGLE (AMD, AMD Radeon RX 7900 XT Direct3D11 vs_5_0 ps_5_0, D3D11)", 20, 0, false],
  ["ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)", 8, 16, false],
  ["ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)", 8, 0, true],
  ["ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)", 8, 0, true],
  ["ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)", 8, 0, true, "Apple M2"],
  ["NVIDIA GeForce GTX 970/PCIe/SSE2", 4, 0, false]
];
for ( const [r, gb, alt, shared, model] of cases ) {
  const c = G.cardOf(r, 16);
  ok(c.gb === gb && c.alt === alt && c.shared === shared && (!model || c.model === model), `${r.slice(0, 70)} -> ${c.model} ${c.gb} GB${c.alt ? ` (or ${c.alt})` : ""}${c.shared ? " shared" : ""}`);
}
const masked = G.cardOf("WebKit WebGL", 8);
ok(masked.gb === null && !masked.known, "a masked renderer is not guessed (the meter assumes 4 GB and says so)");
ok(G.cardOf("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11, D3D11)", null).gb === null, "integrated without navigator.deviceMemory: no guess");

// 2. stacks
const at = (f) => `    at x (http://127.0.0.1:30000/modules/moinen-maps/scripts/${f}:10:5)`;
const st = (...lines) => ["Error", "    at BaseTexture.setResource (http://127.0.0.1:30000/modules/moinen-maps/scripts/vram.mjs:70:20)", "    at new is (http://h/scripts/vendor.mjs:1:2)", ...lines].join("\n");
ok(V.layerOfStack(st(at("destruction/static-cache.mjs"), at("destruction/display.mjs"))) === "destruction", "destruction/static-cache.mjs -> destruction");
ok(V.layerOfStack(st(at("destruction/flood.mjs"))) === "water", "destruction/flood.mjs -> water");
ok(V.layerOfStack(st(at("fire/display.mjs"))) === "fire", "fire -> fire");
ok(V.layerOfStack(st(at("weather/clouds.mjs?v=3"))) === "weather", "weather (with a query) -> weather");
ok(V.layerOfStack(st(at("zones/display.mjs"))) === "zones", "zones -> zones");
ok(V.layerOfStack(st(at("water/reflect.mjs"))) === "water", "water -> water");
ok(V.layerOfStack(st(at("districts.mjs"))) === "districts", "districts.mjs -> districts");
ok(V.layerOfStack(st(at("warmup.mjs"))) === "module", "scripts/warmup.mjs -> other Moinen Maps");
ok(V.layerOfStack(st("    at Canvas.draw (http://h/scripts/foundry.mjs:5:5)")) === "foundry", "no frame of ours -> foundry");
ok(V.layerOfStack(st("    at y (http://h/modules/other-mod/scripts/fire/x.mjs:1:1)")) === "foundry", "another module's scripts/fire -> foundry");
ok(V.layerOfStack(st("    at Canvas.render (http://h/scripts/foundry.mjs:5:5)", at("view-smooth.mjs"))) === "foundry", "Foundry code closer than our wrapper -> foundry");
ok(V.layerOfStack(st(at("destruction/static-cache.mjs"), "    at Canvas.render (http://h/scripts/foundry.mjs:5:5)")) === "destruction", "our code closer than Foundry -> ours");
ok(V.layerOfStack(["", "http://h/modules/moinen-maps/scripts/vram.mjs", "http://h/scripts/vendor.mjs", "http://h/modules/moinen-maps/scripts/weather/lens.mjs"].join("\n")) === "weather", "file names only (the cheap trace form) -> weather");
ok(V.originOfStack(st(at("fire/display.mjs"))).file === "fire/display.mjs", "the file of origin is kept");
{ // D215: another module's / a system's file is named (layer stays foundry); Foundry's own code has no file
  const o = V.originOfStack(st("    at bake (http://h/modules/invincible-plus-ultra/scripts/tokenhalo/halo.mjs:63:25)", at("fire/display.mjs")));
  ok(o.layer === "foundry" && o.file === "invincible-plus-ultra/scripts/tokenhalo/halo.mjs", `another module's file is named (${o.file})`);
  const sy = V.originOfStack(st("    at y (http://h/systems/invincible/module/x.mjs?v=2:1:1)"));
  ok(sy.layer === "foundry" && sy.file === "invincible/module/x.mjs", `a system's file is named, without the query (${sy.file})`);
  const fo = V.originOfStack(st("    at Canvas.draw (http://h/scripts/foundry.mjs:5:5)"));
  ok(fo.layer === "foundry" && fo.file === "", "Foundry's own code: no file");
  const fn = V.originOfStack(["", "http://h/modules/moinen-maps/scripts/vram.mjs", "http://h/scripts/vendor.mjs", "http://h/modules/other-mod/scripts/a.mjs"].join("\n"));
  ok(fn.layer === "foundry" && fn.file === "other-mod/scripts/a.mjs", "file names only: another module named too");
}

// 3. texel sizes
ok(V.bytesPerTexel(0x1908, 0x1401) === 4, "RGBA unsigned byte = 4");
ok(V.bytesPerTexel(0x8058, 0x1401) === 4, "RGBA8 = 4");
ok(V.bytesPerTexel(0x1908, 0x140B) === 8, "RGBA half float = 8");
ok(V.bytesPerTexel(0x881A, 0x140B) === 8, "RGBA16F = 8");
ok(V.bytesPerTexel(0x8814, 0x1406) === 16, "RGBA32F = 16");
ok(V.bytesPerTexel(0x8229, 0x1401) === 1, "R8 = 1");
ok(V.bytesPerTexel(0x1906, 0x1401) === 1, "ALPHA = 1");


// 4. U5-11 (fxw, Z45): the meter's default spot is high on the left in the stack of the map's cards, never the bottom-left corner
{
  globalThis.window ??= { addEventListener() {} };
  const U = await import("../scripts/vram-ui.mjs");
  const fs = await import("node:fs");
  const box = (left, top, w, h) => ({ left, top, width: w, height: h, right: left + w, bottom: top + h });
  const pins = box(96, 92, 224, 177);                                  // the pin filter as seen live at 1366x768 (96,92 - 320,269)
  for ( const [vw, vh] of [[1366, 768], [1920, 1080], [1024, 768]] ) {
    const s = U.defaultSpot(pins, 122, vw, vh);
    ok(s.x === 96 && s.y === 277 && s.y < vh * 0.4, `U5-11 ${vw}x${vh}: under the pin filter, left edges aligned (96, 277); its top above 40 % of the height (where a party column counts what stands below it)`);
  }
  ok(JSON.stringify(U.defaultSpot(null, 122, 1366, 768)) === JSON.stringify({ x: 96, y: 130 }) && JSON.stringify(U.defaultSpot(null, 0, 1366, 768)) === JSON.stringify({ x: 96, y: 92 }), "U5-11: no pin filter: where the filter would stand, below a combat bar declared across the top");
  ok(JSON.stringify(U.defaultSpot(box(900, 500, 224, 100), 0, 1366, 768)) === JSON.stringify({ x: 96, y: 92 }) && U.defaultSpot(box(96, 92, 224, 40), 0, 1366, 768).y === 140, "U5-11: a filter dragged away is not followed; a folded one keeps the card right under it");
  const src = fs.readFileSync(new URL("../scripts/vram-ui.mjs", import.meta.url), "utf8"), fp = fs.readFileSync(new URL("../scripts/filter-panel.mjs", import.meta.url), "utf8");
  ok(/defaultSpot\(pins, insetTop, innerWidth, innerHeight\)/.test(src) && /Hooks\.on\("moinenMapsPinPanel"/.test(src) && (fp.match(/Hooks\.callAll\("moinenMapsPinPanel"\)/g) ?? []).length === 2, "U5-11: place() uses defaultSpot (no longer the players list's top) and follows the filter as it comes, goes, folds");
}

// 5. fxz (FXW-2): the card opened at its default spot moves right past the panels below it (party column, players list), keeping its top
{
  const U = await import("../scripts/vram-ui.mjs");
  const fs = await import("node:fs");
  const spot = { x: 96, y: 277 }, W = 264, H = 457;                     // open card as seen live at 1366x768 (277 -> 734)
  const party = { x0: 0, y0: 380, x1: 170, y1: 664 }, players = { x0: 16, y0: 690, x1: 215, y1: 760 };
  const o = U.openSpot(spot, W, H, [party, players], 1366, 768);
  ok(o.moved && o.y === 277 && o.x === 223 && ![party, players].some((b) => b.x0 < o.x + W && b.x1 > o.x && b.y0 < o.y + H && b.y1 > o.y), `FXW-2: open card clears the party column and the players list, same top (x ${o.x})`);
  ok(JSON.stringify(U.openSpot(spot, W, 90,[party, players], 1366, 768)) === JSON.stringify({ x: 96, y: 277, moved: false }), "FXW-2: a card that ends above the panels (folded) stays at its spot");
  ok(JSON.stringify(U.openSpot(spot, W, H, [], 1366, 768)) === JSON.stringify({ x: 96, y: 277, moved: false }), "FXW-2: nothing declared, no players list: stays");
  ok(U.openSpot(spot, W, H, [{ x0: 0, y0: 300, x1: 700, y1: 700 }], 1366, 768).moved === false, "FXW-2: a panel it cannot clear in the left half: stays where it is");
  const src = fs.readFileSync(new URL("../scripts/vram-ui.mjs", import.meta.url), "utf8");
  ok(/if \( s\.open \) \(\{ x, y \} = openSpot\(/.test(src) && /uiAvoids/.test(src), "FXW-2: place() uses openSpot for an open card at its default spot only (a dragged card is not moved)");
}

console.log(fails ? `${fails} failed` : "vram: all ok");
process.exit(fails ? 1 : 0);
