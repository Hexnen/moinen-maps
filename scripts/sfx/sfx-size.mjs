/* SFXSIZE: how big the map's lettering is, a table setting per group (pure: no Foundry, no PIXI, no DOM; node-tested in
   dev/sfx-size.test.mjs). Owner, 2026-11-15: a size slider for the destruction lettering, today's size is 2, add 1 and 3, 0 is none;
   the same for weather and fire, they may be separate; everything is chosen by the GM for the table.
     destruction  damage areas entering, preset firings' pages (lead-in, main word, wave, debris), guns, ploughs, Detonate, the fire
                  layer's explosions and ground dust (they are blasts, not burning)
     fire         a fire catching, flaring up, going out, doused, and a burning fire's lasting sound; a page's catch and hisses
     weather      the rain storm's lightning (far rumble, mid thunder, a close strike)
   A step is 0 (no lettering of that group: nothing scheduled, nothing drawn), 1 (smaller), 2 (today's size, the default: the play
   options pass through untouched, the same object) or 3 (bigger). A step scales the word's natural size (the engine's `scale` /
   explicit `size`) AND its share of the engine's size ceiling, so a word held at its ceiling also steps; the engine's legibility floor
   still holds a smaller word readable, and a bigger one never goes past the engine's own whole ceiling (ceilK 1), so it cannot bury
   the scene. The placement measures the stepped word (sfx.mjs measure), so a bigger word still keeps off what it letters and in view. */

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
/** a ranked word shown on the screen (fit "screen": no engine clamp) is never taller than this share of the screen height at a
    bigger step (the engine's own height ceiling for its loudest word: 7 % + 8 % x 1.5) */
export const SCREEN_MAX = 0.19;

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
/** a ranked word's size on the screen (CSS px, fit "screen" = unclamped by the engine) at a step: scaled, at a bigger step held under
    SCREEN_MAX of the screen height (never less than today's size) */
export function screenSizeAt(size, step, vh) {
  const s = stepOf(step);
  if ( s === SIZE_DEFAULT ) return size;
  const z = size * (STEP_K[s] ?? 1);
  return s > SIZE_DEFAULT ? Math.max(size, Math.min(z, SCREEN_MAX * Math.max(1, vh))) : z;
}
