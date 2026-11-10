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
  ["ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)", 8, 0, true],
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

// 3. texel sizes
ok(V.bytesPerTexel(0x1908, 0x1401) === 4, "RGBA unsigned byte = 4");
ok(V.bytesPerTexel(0x8058, 0x1401) === 4, "RGBA8 = 4");
ok(V.bytesPerTexel(0x1908, 0x140B) === 8, "RGBA half float = 8");
ok(V.bytesPerTexel(0x881A, 0x140B) === 8, "RGBA16F = 8");
ok(V.bytesPerTexel(0x8814, 0x1406) === 16, "RGBA32F = 16");
ok(V.bytesPerTexel(0x8229, 0x1401) === 1, "R8 = 1");
ok(V.bytesPerTexel(0x1906, 0x1401) === 1, "ALPHA = 1");

console.log(fails ? `${fails} failed` : "vram: all ok");
process.exit(fails ? 1 : 0);
