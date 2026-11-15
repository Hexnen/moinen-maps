/**
 * DROPS: the LOOK of what the weather draws on the glass (the lens: rain drops, runners, frost, grit...), chosen by the GM for the whole
 * table (world setting `weatherLensLook`, restricted, live on every seat; a player reads it in the lens window, lens-look-ui.mjs).
 *  - "pixel" (default): the lens as pixel art, as it was drawn until 2026-11-08 (a2ae095 .. 654b8fd): every shape decided per LENS PX
 *    (round(3 x DPR) device px, about 3 CSS px, fixed on the screen whatever the zoom), hard edges, one-px glints and mist, shown
 *    NEAREST so each lens px is a whole block of device px at any DPR and window size; a big drop shows the frame under it averaged
 *    per lens px (blocks too).
 *  - "smooth": the lens drawn per CSS px with antialiased edges (351f52b, 2026-11-09: "no squares left"), shown LINEAR.
 * Pure (no Foundry): weather.mjs reads the setting, lens.mjs builds the look, dev/lens-look.test.mjs checks the rules.
 */
export const LOOK_KEY = "weatherLensLook";
export const LOOKS = Object.freeze(["pixel", "smooth"]);
export const DEFAULT_LOOK = "pixel";
/** A stored value as a look: anything unknown (a world from before DROPS has none stored) is the default. */
export const cleanLook = (v) => (LOOKS.includes(v) ? v : DEFAULT_LOOK);
/** px of the lens pass per lens px: pixel art decides each lens px once; smooth draws one px per CSS px. */
export const subOf = (look) => (cleanLook(look) === "pixel" ? 1 : 3);

/**
 * The lens's grid for a screen of cssW x cssH CSS px at `dpr`: lens px in device px (lpx, a whole number, so every block lands on
 * the device grid) and in CSS px (css), the lens size in lens px (lw x lh), the pass's size (W x H) and how the screen scales it.
 */
export function lensGrid(cssW, cssH, dpr, look) {
  const d = dpr > 0 ? dpr : 1, lpx = Math.max(1, Math.round(3 * d)), css = lpx / d;
  const lw = Math.ceil(cssW / css), lh = Math.ceil(cssH / css), sub = subOf(look);
  return { look: cleanLook(look), lpx, css, lw, lh, sub, W: lw * sub, H: lh * sub, scale: sub === 1 ? "nearest" : "linear" };
}

/** Who may change the table's look: a GM (a player's seat only reads it). */
export const mayWrite = (user) => !!user?.isGM;

/**
 * DROPSVIS (2026-11-15): how much light the lens's own light terms (glints, lit rims, the light a drop focuses, specks) keep at the
 * scene's darkness d (0..1). It was 1 - 0.7 d: at The Warehouse's 0.9 every drop cue fell to 0.37 while the world's rain streaks stay
 * at full light, so a table saw no drops at all at night. 1 - 0.3 d keeps 0.73 there. Only light is scaled: nothing on the glass
 * darkens more at night (the night-squares defect, B6, came from dark terms).
 */
export const lensLight = (d) => 1 - 0.3 * Math.min(1, Math.max(0, Number(d) || 0));
