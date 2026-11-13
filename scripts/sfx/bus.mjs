/* LMAP: the one hook the destruction display calls when a damage area enters (display.enter). Set by sfx.mjs when the comic sound
   effects are on; null otherwise (one property read per entry). Kept in its own file so display.mjs does not import the sfx code. */
export const sfxBus = { entry: null };
