/**
 * THE VIEW ANGLE shared by the layers that draw height (weather, fire): the module's oblique "3/4 top-down" convention.
 *   lift    screen px per world px of height (a thing z px above its ground point is drawn z * lift px higher up the screen)
 *   squash  y / x of a round ground decal (a splash ring, a ripple)
 * The map itself is a top-down image and is never squashed; only heights and round decals follow the view.
 * Per scene: flags.moinen-maps.view = { lift, squash } or { preset }; absent = the module's default (lift 0.5, squash 0.8, as the
 * destruction slabs and pixel-fx have always used). Destruction stays baked at the default (its look is pinned per version).
 *
 * This file imports nothing (node-tested, safe to import from any layer).
 */
export const VIEW_FLAG = "view";
export const VIEW_DEFAULT = Object.freeze({ lift: 0.5, squash: 0.8 });
export const VIEW_PRESETS = Object.freeze({
  top: Object.freeze({ lift: 0.25, squash: 0.95 }),
  oblique: Object.freeze({ lift: 0.5, squash: 0.8 }),
  steep: Object.freeze({ lift: 0.7, squash: 0.7 })
});

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** A stored view (or nothing) -> { lift 0..0.8, squash 0.6..1, preset } (preset "custom" when it matches none). */
export function cleanView(raw) {
  const p = raw && typeof raw === "object" && VIEW_PRESETS[raw.preset] ? VIEW_PRESETS[raw.preset] : null;
  const lift = num(raw?.lift, 0, 0.8, p?.lift ?? VIEW_DEFAULT.lift), squash = num(raw?.squash, 0.6, 1, p?.squash ?? VIEW_DEFAULT.squash);
  const preset = Object.entries(VIEW_PRESETS).find(([, v]) => Math.abs(v.lift - lift) < 1e-6 && Math.abs(v.squash - squash) < 1e-6)?.[0] ?? "custom";
  return { lift, squash, preset };
}

/** The view of a scene (default: the open one). */
export function view(scene = globalThis.canvas?.scene) {
  return cleanView(scene?.flags?.["moinen-maps"]?.[VIEW_FLAG]);
}

/** A point at height z above (x, y) on screen (world px): [x, y - lift z]. */
export const project = (x, y, z, v = view()) => [x, y - v.lift * z];
