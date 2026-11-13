/* LETR: how big a word is. Pure (no Foundry, no DOM): the engine feeds it the live context every frame.
   README "Size" explains the model. Units: world words in world units (canvas px at zoom 1), screen words in CSS px; "size" is the
   cap height BEFORE the mood's own factor (plan.sizeK: a roar is drawn bigger than a click of the same size). */

export const SIZE = {
  gridK: 0.55,            // a word for one grid square of thing is 0.55 squares tall (times the mood factor)
  tokenPow: 0.5,          // bigger tokens get bigger words, sub-linearly: a 4x4 titan's ouch is 2x, not 4x
  areaPow: 0.6,           // the footprint of an event (radius) grows the word sub-linearly too
  magLo: 0.7, magHi: 1.5, // magnitude 0 .. 1 maps to these factors (up to magnitude 2: 2.3)
  screenVh: 0.075,        // a screen word with no size is 7.5 % of the viewport height (times magnitude and mood)
  floorVh: 0.026, floorMin: 15, floorMax: 30,   // legibility floor of the cap height on screen, CSS px
  quietFloorK: 0.8,       // small sounds (ticks, clicks) may go a little under the floor
  ceilVh: 0.07, ceilVhMag: 0.08,                // the cap height never goes over (7 % + 8 % x magnitude) of the viewport height
  widthVw: 0.4, widthVwMag: 0.25,               // and the word's width never over (40 % + 25 % x magnitude) of the usable width
  softLo: 0.12, softHi: 0.2,                    // outside the range the size still follows zoom a little (depth cue), compressed
  hardLo: 0.8, hardHi: 1.15,                    // ... but never further than this from the floor / ceiling
  crowd: 12,              // more world words alive than this lowers the floor (sqrt), down to crowdMin of it
  crowdMin: 0.7,
  crowdCeil: 2, crowdCeilMin: 0.4,              // more than 2 world words up: the ceiling shrinks with sqrt(2 / n), to 0.4x at most
  pixelMinArt: 7, pixelMaxArt: 40               // pixel lettering: cap height in whole art pixels, at least 7 (a legible pixel letter)
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* magnitude: a number 0..2 (default 0.5), or a word for it */
export function magnitudeOf(m) {
  if ( typeof m === "string" ) m = { tiny: 0, small: 0.25, normal: 0.5, big: 0.75, huge: 1, epic: 1.5 }[m] ?? 0.5;
  return Number.isFinite(m) ? clamp(m, 0, 2) : 0.5;
}
export function magFactor(m) {
  m = magnitudeOf(m);
  return m <= 1 ? SIZE.magLo + (SIZE.magHi - SIZE.magLo) * m : SIZE.magHi + 0.8 * (m - 1);
}

/* the size the word has in its own world, before the screen is asked: from the explicit size, a token, an area, the grid */
export function naturalSize(c) {
  return naturalBase(c) * (Number.isFinite(c.scale) && c.scale > 0 ? c.scale : 1);
}
function naturalBase(c) {
  if ( Number.isFinite(c.size) && c.size > 0 ) return c.size;
  const mag = magFactor(c.magnitude);
  if ( c.space !== "world" ) return Math.max(1, c.vh ?? 768) * SIZE.screenVh * mag;
  const g = c.grid > 0 ? c.grid : 100;
  let base = g * SIZE.gridK;
  if ( c.area > 0 ) base = g * SIZE.gridK * Math.max(0.35, c.area / (g * 0.5)) ** SIZE.areaPow;
  else if ( c.tokenSpan > 0 ) base = g * SIZE.gridK * Math.max(0.35, c.tokenSpan / g) ** SIZE.tokenPow;
  return base * mag;
}

/* the screen limits for one word, in CSS px of cap height */
export function limits(c) {
  const vh = Math.max(200, c.vh ?? 768), vw = Math.max(200, c.vw ?? 1366), m = Math.min(1.5, magnitudeOf(c.magnitude));
  let floor = clamp(vh * SIZE.floorVh, SIZE.floorMin, SIZE.floorMax) * ((c.sizeK ?? 1) < 0.75 ? SIZE.quietFloorK : 1);
  if ( c.space === "world" && c.alive > SIZE.crowd ) floor *= Math.max(SIZE.crowdMin, Math.sqrt(SIZE.crowd / c.alive));
  const aspect = Math.max(0.3, c.aspect ?? 3);                     // word width / cap height
  const ceilH = vh * (SIZE.ceilVh + SIZE.ceilVhMag * m);
  const ceilW = (vw * (SIZE.widthVw + SIZE.widthVwMag * Math.min(1, m))) / aspect;
  /* a crowd shares the screen: with more than crowdCeil world words up, each one's ceiling shrinks (sqrt, down to crowdCeilMin), so
     a dozen words zoomed in close stay a pile of sounds instead of a wall over the scene */
  const share = c.space === "world" && c.alive > SIZE.crowdCeil ? Math.max(SIZE.crowdCeilMin, Math.sqrt(SIZE.crowdCeil / c.alive)) : 1;
  const part = Number.isFinite(c.ceilK) && c.ceilK > 0 ? c.ceilK : 1;   // a part of a sound (a stream's syllable) gets a share of the ceiling
  const ceil = Math.max(floor * 1.25, Math.min(ceilH, ceilW) * share * part);
  return { floor, ceil, by: ceilW < ceilH ? "width" : "height" };
}

/* soft clamp: inside [lo, hi] unchanged; outside it follows a compressed curve and stops at the hard limits. Monotonic, continuous. */
export function soft(px, lo, hi) {
  if ( px < lo ) return Math.max(lo * SIZE.hardLo, lo * (px / lo) ** SIZE.softLo);
  if ( px > hi ) return Math.min(hi * SIZE.hardHi, hi * (px / hi) ** SIZE.softHi);
  return px;
}

/* the whole model. c = { space, size?, scale?, magnitude?, area?, tokenSpan?, grid, zoom, vw, vh, sizeK, aspect, fit?, alive?, pixel? (art px) }
   returns { size (to draw with, before sizeK), px (cap height on screen, CSS px), natural, clamp: null|"floor"|"ceil"|"width", fit } */
export function sizeFor(c) {
  const fit = c.fit ?? "legible";
  const natural = naturalSize(c);
  const k = c.sizeK ?? 1, zoom = c.space === "world" ? Math.max(1e-3, c.zoom ?? 1) : 1;
  const px0 = natural * k * zoom;
  let px = px0, clampWhy = null;
  if ( fit === "legible" ) {
    const L = limits(c);
    px = soft(px0, L.floor, L.ceil);
    if ( px0 < L.floor ) clampWhy = "floor"; else if ( px0 > L.ceil ) clampWhy = L.by === "width" ? "width" : "ceil";
  } else if ( fit === "screen" && c.space === "world" ) {
    px = natural * k;   // the size reads as CSS px of cap height whatever the zoom (a label pinned to the map)
  }
  let size = px / (k * zoom);
  if ( c.pixel > 0 && c.space === "world" ) {
    const art = Math.round((size * k) / c.pixel);
    size = (clamp(art, SIZE.pixelMinArt, SIZE.pixelMaxArt) * c.pixel) / k;
    px = size * k * zoom;
  }
  return { size, px, natural, clamp: clampWhy, fit };
}
