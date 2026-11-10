/**
 * WHAT CARD IS THIS, AND HOW MUCH MEMORY DOES IT HAVE? (pure, no Foundry; tested by dev/vram.test.mjs)
 *
 * A browser cannot read the card's memory: WebGL has no query for it (the NVX/ATI memory-info extensions are not exposed by Chrome
 * or Firefox) and WebGPU's adapter info has no size either. What a page CAN read is the renderer string
 * (WEBGL_debug_renderer_info, e.g. "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Ti (0x00002482) Direct3D11 vs_5_0 ps_5_0, D3D11)"); some
 * browsers mask it ("WebKit WebGL", "Mesa ...", "Apple GPU"). `cardOf(renderer)` maps the model to its usual memory from the table
 * below. That is an estimate:
 *  - some models ship in two sizes (RTX 3060 8 or 12 GB, RX 580 4 or 8 GB): the smaller one is taken (the safe side), `alt` says it;
 *  - a laptop card often has less than the desktop card of the same name ("Laptop GPU" in the string picks the laptop row);
 *  - integrated graphics (Intel UHD/Iris, AMD Radeon Graphics, Apple M) have no memory of their own: they borrow system memory,
 *    Windows lets them use about half of it; `shared: true`, and the budget is half of `navigator.deviceMemory` (which Chrome rounds
 *    and caps at 8 GB, so 4 GB at most from it).
 * The user can always set the budget by hand (client setting "vramBudget").
 */

/** [pattern, GB, alternative GB or 0]: first match wins, so specific names come before their prefixes. */
const NVIDIA = [
  // laptop rows first (they say "Laptop GPU")
  [/rtx\s*5090\s*laptop/, 24], [/rtx\s*5080\s*laptop/, 16], [/rtx\s*5070\s*ti\s*laptop/, 12], [/rtx\s*5070\s*laptop/, 8], [/rtx\s*5060\s*laptop/, 8], [/rtx\s*5050\s*laptop/, 8],
  [/rtx\s*4090\s*laptop/, 16], [/rtx\s*4080\s*laptop/, 12], [/rtx\s*4070\s*laptop/, 8], [/rtx\s*4060\s*laptop/, 8], [/rtx\s*4050\s*laptop/, 6],
  [/rtx\s*3080\s*ti\s*laptop/, 16], [/rtx\s*3080\s*laptop/, 8, 16], [/rtx\s*3070\s*ti\s*laptop/, 8], [/rtx\s*3070\s*laptop/, 8], [/rtx\s*3060\s*laptop/, 6],
  [/rtx\s*3050\s*ti\s*laptop/, 4], [/rtx\s*3050\s*laptop/, 4, 6], [/rtx\s*2080\s*super.*laptop|rtx\s*2080.*laptop/, 8], [/rtx\s*2070.*laptop/, 8], [/rtx\s*2060.*laptop/, 6],
  [/gtx\s*1660\s*ti.*laptop/, 6], [/gtx\s*1650.*laptop/, 4],
  // desktop
  [/rtx\s*5090/, 32], [/rtx\s*5080/, 16], [/rtx\s*5070\s*ti/, 16], [/rtx\s*5070/, 12], [/rtx\s*5060\s*ti/, 8, 16], [/rtx\s*5060/, 8], [/rtx\s*5050/, 8],
  [/rtx\s*4090/, 24], [/rtx\s*4080/, 16], [/rtx\s*4070\s*ti\s*super/, 16], [/rtx\s*4070\s*ti/, 12], [/rtx\s*4070/, 12], [/rtx\s*4060\s*ti/, 8, 16], [/rtx\s*4060/, 8],
  [/rtx\s*3090/, 24], [/rtx\s*3080\s*ti/, 12], [/rtx\s*3080/, 10, 12], [/rtx\s*3070/, 8], [/rtx\s*3060\s*ti/, 8], [/rtx\s*3060/, 12, 8], [/rtx\s*3050/, 8, 6],
  [/titan\s*rtx/, 24], [/rtx\s*2080\s*ti/, 11], [/rtx\s*2080/, 8], [/rtx\s*2070/, 8], [/rtx\s*2060\s*super/, 8], [/rtx\s*2060/, 6, 12],
  [/gtx\s*1660/, 6], [/gtx\s*1650/, 4], [/gtx\s*1630/, 4], [/titan\s*xp?\b/, 12], [/gtx\s*1080\s*ti/, 11], [/gtx\s*1080/, 8], [/gtx\s*1070/, 8], [/gtx\s*1060/, 3, 6],
  [/gtx\s*1050\s*ti/, 4], [/gtx\s*1050/, 2, 3], [/gt\s*1030/, 2], [/gtx\s*980\s*ti/, 6], [/gtx\s*980/, 4], [/gtx\s*970/, 4], [/gtx\s*960/, 2, 4], [/gtx\s*950/, 2],
  [/gtx\s*750/, 2, 1], [/\bmx\s*\d{3}/, 2, 4],
  // workstation
  [/rtx\s*a6000|rtx\s*6000/, 48], [/rtx\s*a5000|rtx\s*5000/, 24, 32], [/rtx\s*a4000|rtx\s*4000/, 16, 20], [/rtx\s*a2000|rtx\s*2000/, 6, 12], [/quadro\s*p\s*4000/, 8], [/quadro\s*p\s*2000/, 5]
];
const AMD = [
  [/rx\s*9070/, 16], [/rx\s*9060\s*xt/, 8, 16], [/rx\s*7900\s*xtx/, 24], [/rx\s*7900\s*xt\b/, 20], [/rx\s*7900\s*gre/, 16], [/rx\s*7800/, 16], [/rx\s*7700/, 12],
  [/rx\s*7600\s*xt/, 16], [/rx\s*7600/, 8], [/rx\s*69[05]0/, 16], [/rx\s*6800/, 16], [/rx\s*67[05]0\s*xt/, 12], [/rx\s*6700/, 10], [/rx\s*66[05]0/, 8],
  [/rx\s*6500/, 4], [/rx\s*6400/, 4], [/rx\s*5700/, 8], [/rx\s*5600/, 6], [/rx\s*5500/, 4, 8], [/radeon\s*vii/, 16], [/vega\s*64|vega\s*56|rx\s*vega/, 8],
  [/rx\s*590/, 8], [/rx\s*580/, 4, 8], [/rx\s*570/, 4, 8], [/rx\s*560/, 4, 2], [/rx\s*550/, 2, 4], [/rx\s*480/, 4, 8], [/rx\s*470/, 4, 8], [/rx\s*460/, 2, 4],
  [/r9\s*390/, 8], [/r9\s*380/, 2, 4], [/r9\s*290/, 4]
];
const INTEL = [[/arc.*\bb580\b/, 12], [/arc.*\bb570\b/, 10], [/arc.*\ba770\b/, 8, 16], [/arc.*\ba7[05]0\b/, 8], [/arc.*\ba580\b/, 8], [/arc.*\ba380\b/, 6], [/arc.*\ba310\b/, 4]];
/** Integrated graphics: they borrow system memory. */
const SHARED = /intel.*(uhd|hd\s*graphics|iris|\(r\)\s*graphics|arc\(tm\)\s*graphics|arc.*\d{3}v)|radeon\(tm\)\s*graphics|radeon\s*graphics|radeon.*\d{3}m\b|vega\s*\d+\s*graphics|apple\s*(m\d|gpu)|adreno|mali|powervr|videocore/;

/** The model part of an ANGLE string: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Ti (0x00002482) Direct3D11 vs_5_0 ps_5_0, D3D11)" -> "NVIDIA GeForce RTX 3070 Ti". */
export function modelOf(renderer) {
  let s = String(renderer ?? "").trim();
  const a = /^ANGLE \((.*)\)$/.exec(s);
  if ( a ) { const parts = a[1].split(", "); s = parts.length >= 3 ? parts.slice(1, -1).join(", ") : parts.at(-1); }
  s = s.replace(/^ANGLE\s+Metal\s+Renderer:\s*/i, "");   // Safari/Chrome on a Mac: "ANGLE Metal Renderer: Apple M2" -> "Apple M2"
  return s.replace(/\s*\(0x[0-9a-f]+\)/i, "").replace(/\s+(Direct3D|OpenGL|Vulkan|Metal|vs_|ps_).*$/i, "").trim();
}

/**
 * The card behind a renderer string: { model, gb, alt, shared, known }.
 *   gb      its memory (GB) from the table; for integrated graphics, half of `deviceMemoryGB`; null when the model is not in the table
 *   alt     the other size the model ships in (0 = one size)
 *   shared  integrated graphics (system memory)
 *   known   the model was recognised
 */
export function cardOf(renderer, deviceMemoryGB = null) {
  const model = modelOf(renderer), s = String(renderer ?? "").toLowerCase();
  const isLaptop = /laptop|mobile|max-q/.test(s);
  const tables = /nvidia|geforce|quadro|titan|\brtx\b|\bgtx\b/.test(s) ? [NVIDIA] : /amd|radeon|\brx\s*\d/.test(s) ? [AMD] : /intel/.test(s) ? [INTEL] : [NVIDIA, AMD, INTEL];
  if ( !SHARED.test(s) || /\barc.*\b[ab]\d{3}\b/.test(s) ) {
    for ( const t of tables ) for ( const [re, gb, alt = 0] of t ) {
      if ( !re.test(s) ) continue;
      if ( !isLaptop && /laptop/.test(re.source) ) continue;
      // a size in the name ("GTX 1060 6GB") settles a two-size model
      const named = Number(/\b(\d{1,2})\s*gb\b/.exec(s)?.[1]);
      if ( named && (named === gb || named === alt) ) return { model, gb: named, alt: 0, shared: false, known: true };
      return { model, gb, alt, shared: false, known: true };
    }
  }
  if ( SHARED.test(s) ) {
    const mem = Number(deviceMemoryGB);
    return { model, gb: Number.isFinite(mem) && mem > 0 ? mem / 2 : null, alt: 0, shared: true, known: true };
  }
  return { model, gb: null, alt: 0, shared: false, known: false };
}
