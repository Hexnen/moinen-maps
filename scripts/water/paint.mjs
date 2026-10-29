/**
 * Level bytes to pixels. The engine bakes one byte per pixel (which element made it, its colour 1..6 and what lies under it, see
 * lib/wowe/codes.lua); the colours and the opacity of every group are applied here, so changing either never needs a new bake.
 * (Port of the colour resolution of WOWe Generator's paint.lua, by Yavuz, MIT.)
 */

const ELEMENTS = ["water", "deep", "fall", "gaps", "lines", "lip", "edges", "streaks", "shore", "shade", "rings", "trail",
  "foam", "spray", "mist", "sparkle", "net", "patches", "waves", "wet"];
const GROUP = {
  water: "water", deep: "deep", fall: "fall", gaps: "slits", lines: "lines", lip: "lines", edges: "lines", streaks: "lines",
  shore: "foam", shade: "shade", rings: "lines", trail: "foam", foam: "foam", spray: "foam", mist: "mist", sparkle: "sparkle",
  net: "net", patches: "patches", waves: "waves", wet: "wet"
};
/** Elements that are water themselves (see-through to what lies below), and the wet ground. */
const ALONE = new Set(["water", "deep", "fall", "gaps", "wet"]);
export const ALPHA_GROUPS = ["water", "deep", "fall", "slits", "lines", "net", "patches", "waves", "foam", "shade", "sparkle", "mist", "wet"];
export const ALPHA_START = { mist: 70, wet: 40 };
const BASE = 3;

const rgbOf = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Opacity 0..1 of every group, from percents. */
function opacities(alpha) {
  const A = {};
  for ( const g of ALPHA_GROUPS ) {
    const v = Number(alpha?.[g] ?? ALPHA_START[g] ?? 100);
    A[g] = Math.max(0, Math.min(100, Number.isFinite(v) ? v : 100)) / 100;
  }
  return A;
}

/**
 * A 256-entry lookup byte -> packed RGBA (little endian, ready for a Uint32Array over ImageData).
 * `codes` is the worker's table (3 bytes per code: colour, element + 1, under); `colors` six hex strings; `alpha` percent per group.
 */
export function buildLut(codes, colors, alpha) {
  const A = opacities(alpha), cols = colors.map(rgbOf);
  const lut = new Uint32Array(256), bytes = new Uint8Array(lut.buffer);
  for ( let b = 0; b < 256; b++ ) {
    const lv = codes[b * 3], el = codes[b * 3 + 1] - 1, under = codes[b * 3 + 2];
    if ( lv < 1 || el < 0 ) continue;
    const name = ELEMENTS[el];
    let [r, g, bl] = cols[lv - 1], a = A[GROUP[name]];
    if ( name === "mist" ) { if ( under === 1 ) a *= 0.5; }
    else if ( under > 0 && !ALONE.has(name) ) {
      // laid over the water beneath it: half-clear foam is foam mixed into the water, not a hole
      const ab = A[under === 1 ? "fall" : "water"], [br, bg, bb] = cols[BASE - 1];
      const oa = a + ab * (1 - a);
      if ( oa > 0 ) {
        const k = ab * (1 - a);
        r = (r * a + br * k) / oa; g = (g * a + bg * k) / oa; bl = (bl * a + bb * k) / oa;
      }
      a = oa;
    }
    bytes[b * 4] = Math.round(r); bytes[b * 4 + 1] = Math.round(g); bytes[b * 4 + 2] = Math.round(bl); bytes[b * 4 + 3] = Math.round(a * 255);
  }
  return lut;
}

/** The pixels of one baked frame (w x h level bytes) as ImageData-ready RGBA. */
export function paintFrame(levels, w, h, lut) {
  const out = new Uint8ClampedArray(w * h * 4), px = new Uint32Array(out.buffer);
  for ( let i = 0, n = w * h; i < n; i++ ) px[i] = lut[levels[i]];
  return out;
}
