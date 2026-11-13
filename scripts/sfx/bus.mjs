/* LMAP / FXLM: the hooks the destruction display and the fire layer call (set by sfx.mjs when the comic sound effects are on; null
   otherwise: one property read per call). Kept in its own file so display.mjs and fire.mjs do not import the sfx code.
     entry(display, g, opts, start)  a damage area enters (display.enter)
     fireShown(strokeIds)            fire strokes whose flames are on screen now (fire.mjs draw, after display.sync) */
export const sfxBus = { entry: null, fireShown: null };
