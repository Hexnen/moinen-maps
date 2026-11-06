/**
 * FIRE COLOUR: the CPU half of the swappable look block (the shader's half is the FIRE STYLE block of shader.mjs).
 *
 * A fire's colour is ONE base colour (a stroke's `c`, else the scene's `fireColor`). `rampOf(base)` DERIVES the whole palette from it -
 * core, yellow (hot), orange (mid), red (outer), tip, bed glow, ember, char, the smoke's lit underside, the ember particles and the light - so a blue fire still
 * has a hot pale core and dark tips. The rule (replace it here and only here):
 *  - every entry of the reference palette (the natural orange fire, REF) keeps its place on the ramp, measured against the natural
 *    base: its hue OFFSET (degrees), its saturation (x the base's saturation over the natural's) and its value (the hot entries
 *    keep theirs; the base and the cooler ones x the base's value);
 *  - the hue offset turns TOWARDS the light hue (yellow, 60 deg) for the hot entries and away from it for the cool ones, whatever
 *    the base: hotter = paler and shifted towards yellow-white, cooler = darker and shifted the other way (blue: cyan core, indigo
 *    tips; green: yellow-green core, teal tips; purple: pink core, indigo tips);
 *  - the natural base gives REF exactly (the default look is unchanged bit for bit).
 * The smoke is neutral; `smokeTint` (0..1, the scene's) mixes it towards the fire's hue (shader + puff particles).
 * Pure and deterministic: every client derives the same bytes.
 */

/** The natural fire's base colour (the old look's orange). */
export const NATURAL = "#ff8a24";
/** The bar's presets (base colours). */
export const PRESETS = Object.freeze({
  natural: "#ff8a24", hot: "#ffc94a", red: "#e0301c", blue: "#3a86ff", green: "#3fd85a", purple: "#a24bff", white: "#fff0dc"
});
export const COLOR = /^#[0-9a-f]{6}$/i;

/** The reference palette (the natural fire): shader entries (0..1 rgb), ember particles, puff particles, light. */
export const REF = Object.freeze({
  core: [1.000, 0.957, 0.722], yellow: [1.000, 0.816, 0.251], orange: [1.000, 0.541, 0.141], red: [0.824, 0.251, 0.110],
  tip: [0.353, 0.118, 0.078], glow: [1.000, 0.416, 0.102], ember: [0.520, 0.140, 0.070], char: [0.150, 0.085, 0.065],
  under: [0.62, 0.27, 0.12]
});
export const REF_EMBERS = Object.freeze([0xfff0a0, 0xffb030, 0xe0501c, 0x7a2a14]);
export const REF_PUFFS = Object.freeze([0x4a4541, 0x5d5853, 0x77716b]);
export const REF_LIGHT = "#ff8a3c";
/** The shader's palette slots, in uniform order (uPal[i]). */
export const SLOTS = ["core", "yellow", "orange", "red", "tip", "glow", "ember", "char", "under"];

const LIGHT_HUE = 60;

/** A colour (hex string or 0xrrggbb or a preset name), cleaned to "#rrggbb", or null. */
export function cleanColor(v) {
  if ( typeof v === "number" && Number.isFinite(v) ) return `#${(v >>> 0 & 0xffffff).toString(16).padStart(6, "0")}`;
  if ( typeof v !== "string" ) return null;
  if ( PRESETS[v] ) return PRESETS[v];
  return COLOR.test(v) ? v.toLowerCase() : null;
}

export const hexToRgb = (h) => { const n = Number.parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const intToRgb = (n) => [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
const to255 = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));
export const rgbToInt = (c) => (to255(c[0]) << 16) | (to255(c[1]) << 8) | to255(c[2]);
const rgbToHex = (c) => `#${rgbToInt(c).toString(16).padStart(6, "0")}`;

export function hsv([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if ( d > 0 ) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx > 0 ? d / mx : 0, mx];
}
export function rgb([h, s, v]) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, k = Math.floor(((h % 360) + 360) % 360 / 60);
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k];
  return [t[0] + m, t[1] + m, t[2] + m];
}
/** Signed shortest hue difference b - a (degrees, -180..180). */
const dHue = (a, b) => ((b - a + 540) % 360) - 180;

const NAT = hsv(hexToRgb(NATURAL));

/** One reference colour moved from the natural base to `base` ([h, s, v]) by the rule above. */
function derive(ref, base) {
  const [hr, sr, vr] = hsv(ref), off = dHue(NAT[0], hr);
  // (towards the light hue for hot entries: the direction from the base to yellow; a grey base has no direction: +1)
  const dir = base[1] < 0.04 ? 1 : Math.sign(dHue(base[0], LIGHT_HUE)) || 1;
  const room = Math.abs(dHue(base[0], LIGHT_HUE));
  const turn = off > 0 ? Math.min(off, room) : off;                 // (a hot entry never turns past yellow)
  const h = (base[0] + dir * turn + 360) % 360;
  const s = Math.min(1, sr * base[1] / NAT[1]);
  const v = Math.min(1, off > 0 ? vr : vr * (0.4 + 0.6 * base[2]) / (0.4 + 0.6 * NAT[2]));   // (the hot entries stay bright: a dark base darkens the outer flames only)
  return rgb([h, s, v]);
}

/** Smoke tinted towards the fire (0..1 rgb): its luminance kept, its hue the fire's mid colour's, `amount` 0..1. */
export function tintSmoke(c, tint, amount) {
  if ( !(amount > 0) ) return c;
  const L = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11, tl = Math.max(0.05, tint[0] * 0.3 + tint[1] * 0.59 + tint[2] * 0.11);
  return c.map((x, i) => x + (Math.min(1, L * tint[i] / tl) - x) * amount);
}

const cache = new Map();
/**
 * The whole palette of base colour `base` (hex; anything else = natural): { base, natural, pal: { core, ... } (0..1 rgb), uniforms
 * (Float32Array 36: uPal), embers [4 x 0xrrggbb], light "#rrggbb", tint (0..1 rgb: the smoke's tint hue) }.
 */
export function rampOf(base) {
  const hex = cleanColor(base) ?? NATURAL;
  let r = cache.get(hex); if ( r ) return r;
  const natural = hex === NATURAL, B = hsv(hexToRgb(hex));
  const pal = {};
  for ( const k of SLOTS ) pal[k] = natural ? [...REF[k]] : derive(REF[k], B);
  const uniforms = new Float32Array(SLOTS.length * 4);
  SLOTS.forEach((k, i) => { uniforms.set(pal[k], i * 4); uniforms[i * 4 + 3] = 1; });
  r = Object.freeze({ base: hex, natural, pal, uniforms,
    embers: natural ? [...REF_EMBERS] : REF_EMBERS.map((e) => rgbToInt(derive(intToRgb(e), B))),
    light: natural ? REF_LIGHT : rgbToHex(derive(hexToRgb(REF_LIGHT), B)),
    tint: pal.orange });
  if ( cache.size > 64 ) cache.clear();
  cache.set(hex, r);
  return r;
}

/** The smoke particles' colours for a ramp and a tint amount (neutral at 0). */
export function puffsOf(ramp, amount) {
  return amount > 0 ? REF_PUFFS.map((p) => rgbToInt(tintSmoke(intToRgb(p), ramp.tint, amount))) : [...REF_PUFFS];
}
