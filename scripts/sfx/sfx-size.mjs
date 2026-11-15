/* SFXSIZE: how big the map's lettering is, a table setting per group (pure: no Foundry, no PIXI, no DOM; node-tested in
   dev/sfx-size.test.mjs). Owner, 2026-11-15: a size slider for the destruction lettering, today's size is 2, add 1 and 3, 0 is none;
   the same for weather and fire, they may be separate; everything is chosen by the GM for the table.
     destruction  damage areas entering, preset firings' pages (lead-in, main word, wave, debris), guns, ploughs, Detonate, the fire
                  layer's explosions and ground dust (they are blasts, not burning)
     fire         a fire catching, flaring up, going out, doused, and a burning fire's lasting sound; a page's catch and hisses
     weather      the rain storm's lightning (far rumble, mid thunder, a close strike)
   A step is 0 (no lettering of that group: nothing scheduled, nothing drawn), 1 (smaller), 2 (today's size, the default: the play
   options pass through untouched, the same object) or 3 (bigger). A map word (world space) is stepped from the size the engine draws
   it at today (sfx.mjs steppedWorld: L.sizeOf -> smallPx / bigPx -> drawn at that size, fit "world"), because the engine's clamp
   would hold a word at its ceiling whatever its natural size and it drops a caller's ceiling share: 1 = 0.7 x, never under the
   engine's legibility floor; 3 = 1.4 x, never over LOUD_K x the engine's ceiling for its loudest word. A screen word (an unlocated
   thunder) steps under that ceiling itself (no room above it). Streams (guns) and a burning fire's phrase step their explicit size
   (sizeAt / streamOpts) and stay under the engine's clamp. The placement measures the stepped word (sfx.mjs measure), so a bigger word
   still keeps off what it letters and in view. */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** the groups, in the order of the settings window */
export const SIZE_GROUPS = ["destruction", "fire", "weather"];
/** the world setting of each group (scope world, the GM's: every seat letters the same) */
export const SIZE_SETTING = { destruction: "sfxSizeDestruction", fire: "sfxSizeFire", weather: "sfxSizeWeather" };
/** today's size */
export const SIZE_DEFAULT = 2;
/** the size factor of each step (0: none). 1 = 0.7: clearly quieter (half the area) and still over the engine's legibility floor for
    the smallest ranked word (R1 4 % of the view height -> 2.8 %, the floor is 2.6 %); 3 = 1.4: clearly louder (about twice the area),
    the biggest words held by the engine's own ceiling (question SFXSIZE-1) */
export const STEP_K = [0, 0.7, 1, 1.4];

/** a setting's value -> its step 0..3 (anything unreadable: today's size) */
export const stepOf = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== null && v !== "" ? clamp(n, 0, 3) : SIZE_DEFAULT; };

/** the voices of the fire layer's burning (sfx-core VOICES): the fire group; every other voice letters destruction */
export const FIRE_VOICES = new Set(["fire", "flare", "out", "douse"]);
/** the group of an event or a word by its voice */
export const groupOfVoice = (voice) => (FIRE_VOICES.has(voice) ? "fire" : "destruction");
/** the group of a page word (sfx-page / sfx-events roles): a page's fire catching and dying is fire; a story's own group wins
    (a storm's flash: weather) */
export const groupOfPageWord = (w, story = null) => story ?? (w?.role === "catch" || w?.role === "out" ? "fire" : "destruction");

/** a share of the engine's size ceiling at a step: smaller with a smaller word, bigger with a bigger one but never past the whole */
export const ceilAt = (ceilK, step) => {
  const k = STEP_K[stepOf(step)] ?? 1, c = Number.isFinite(ceilK) && ceilK > 0 ? ceilK : 1;
  return k < 1 ? c * k : Math.max(c, Math.min(1, c * k));
};
/**
 * The play options of a word at a step: at 2 the SAME object (today's word, untouched); else a copy with its natural size scaled
 * (`scale`) and its ceiling share stepped (`ceilK`). A word at step 0 is never played (the caller drops it before it is scheduled
 * and again when its moment comes); its options come back untouched here.
 */
export function sizeOpts(o, step) {
  const s = stepOf(step);
  if ( s === SIZE_DEFAULT || s === 0 || !o ) return o;
  const k = STEP_K[s];
  return { ...o, scale: (Number.isFinite(o.scale) && o.scale > 0 ? o.scale : 1) * k, ceilK: ceilAt(o.ceilK, s) };
}
/** A gun's stream (the engine's L.stream) takes no `scale`: its syllable unit is the engine's natural size for the stream x STREAM_UNIT
    and each syllable's ceiling share STREAM_CEIL (engine.mjs stream(): `sizeFor(c).natural * 0.62`, `ceilK: o.ceilK ?? 0.55`; pinned by
    dev/sfx-size.test.mjs). At a step other than 2 the map passes the stepped unit as `size` and the stepped share as `ceilK`. */
export const STREAM_UNIT = 0.62, STREAM_CEIL = 0.55;
/** the stream options of a step: `natural` = the engine's natural size of the stream (L.sizeOf(..., { fit: "world" }).natural) */
export function streamOpts(natural, step) {
  const s = stepOf(step);
  if ( s === SIZE_DEFAULT || s === 0 || !(natural > 0) ) return {};
  return { size: natural * STREAM_UNIT * STEP_K[s], ceilK: ceilAt(STREAM_CEIL, s) };
}
/** an explicit size (a stream's syllable unit, a burning fire's phrase size) at a step (the engine still clamps it) */
export const sizeAt = (size, step) => { const s = stepOf(step); return s === SIZE_DEFAULT ? size : size * (STEP_K[s] ?? 1); };
/** the magnitude whose ceiling a bigger ranked word may reach: the engine's loudest (its height ceiling stops growing at 1.5) */
export const LOUD_MAG = 2;
/**
 * A ranked story word's cap height on screen (CSS px, mood factor included) at a BIGGER step, from today's (`px`, as the engine draws
 * it at step 2): STEP_K times today's, held under `cap` = the engine's own ceiling for its loudest word of this text on this screen
 * (height 7 % + 8 % x 1.5 = 19 % of the view, width 65 % of the usable width, a crowd's share; the caller asks the engine, sfx.mjs
 * loudCap), never under today's. A ranked word's ceiling share is already the whole (ceilK 1), so the engine's clamp would hold the
 * louder ranks at today's size; the map steps them itself and draws them unclamped at that size (live 2026-11-15: step 3's main word
 * stood no bigger than step 2's, and a screen thunder word ran off both sides).
 */
export function bigPx(px, step, cap, room = LOUD_K) {
  const s = stepOf(step);
  if ( s <= SIZE_DEFAULT || !(px > 0) ) return px;
  return Math.max(px, Math.min(px * STEP_K[s], cap > 0 ? cap * room : px));
}
/** A world word's cap height on screen (CSS px, mood factor included) at a SMALLER step, from today's (`px`): STEP_K times today's,
    never under the engine's legibility floor `floor` (or today's size, where today's already stands under it). The engine itself drops a
    caller's ceiling share (engine.mjs sizeCtx passes no ceilK to the size model), so a word held at its ceiling today would not shrink
    with a smaller natural size alone (live 2026-11-15: a big blast's main word at step 1 stood at 0.94 x today's) - the map steps it
    itself and draws it at that size. */
export function smallPx(px, step, floor) {
  const s = stepOf(step);
  if ( s >= SIZE_DEFAULT || s === 0 || !(px > 0) ) return px;
  return Math.max(px * STEP_K[s], Math.min(px, floor > 0 ? floor : 0));
}
/** the engine's legibility floor for a word (CSS px of cap height; size.mjs limits(), model = the engine's SIZE / L.sizeModel) */
export const floorPx = (vh, sizeK, M) => Math.min(M.floorMax, Math.max(M.floorMin, vh * M.floorVh)) * ((sizeK ?? 1) < 0.75 ? M.quietFloorK : 1);
/** a world word's cap height at any step from today's: smaller (smallPx), today's, or bigger (bigPx) */
export const steppedPx = (px, step, { floor = 0, cap = 0 } = {}) => {
  const s = stepOf(step);
  return s > SIZE_DEFAULT ? bigPx(px, s, cap) : s < SIZE_DEFAULT ? smallPx(px, s, floor) : px;
};
/** how far past the engine's loudest ceiling a word may go at step 3: a big blast's main word already stands at that ceiling (soft
    clamp, up to 1.15 x) today, so without room above it the loudest words could not step at all (live 2026-11-15). 1.3 x: at most
    about a quarter of the view height (19 % x 1.3) and 85 % of the usable width (65 % x 1.3) - loud, still not a wall over the scene
    (question SFXSIZE-1) */
export const LOUD_K = 1.3;
/** a ranked word's size on the screen (CSS px, fit "screen" = unclamped by the engine) at a step: scaled; at a bigger step held under
    the engine's own ceiling for its loudest word `capPx` (cap height incl. the mood factor `sizeK`), with no room above it - a screen
    word has no subject to stand off and no world to scroll, and a long thunder word already runs across the view (live 2026-11-15:
    at 1.3 x it ran off the side) - and never less than today's size */
export function screenSizeAt(size, step, capPx = 0, sizeK = 1) {
  const s = stepOf(step);
  if ( s === SIZE_DEFAULT ) return size;
  if ( s < SIZE_DEFAULT ) return size * (STEP_K[s] ?? 1);
  const k = sizeK > 0 ? sizeK : 1;
  return bigPx(size * k, s, capPx, 1) / k;
}
