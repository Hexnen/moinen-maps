import { MODULE_ID } from "../config.mjs";

/**
 * How strongly the GM's editing markers show (the water mask overlay, rods, road junction markers and guides, shape handles, the
 * district stroke preview, ...): one client setting `markerOpacity` (0..1, 1 = as drawn), set with the slider in the workspace bar.
 * Every overlay multiplies its own alpha by `markerOpacity()` (brush rings by `ringOpacity()`, which never fades below RING_FLOOR so
 * the GM still sees where the brush is) and re-applies it when the hook "moinenMapsMarkers" (value) fires: on a change of the
 * setting, and live while the slider is being dragged (previewMarkerOpacity).
 *
 *   import { markerOpacity, trackMarkers } from "../workspace/markers.mjs";
 *   trackMarkers(myOverlayContainer);              // alpha = markerOpacity(), followed until the container is destroyed
 *   trackMarkers(cursorGraphics, { ring: true });  // brush ring: never below RING_FLOOR
 */

export const MARKERS_HOOK = "moinenMapsMarkers";
export const RING_FLOOR = 0.25;
const KEY = "markerOpacity";
const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 1));
let preview = null;

export function registerMarkerSettings() {
  game.settings.register(MODULE_ID, KEY, { scope: "client", config: false, type: Number, default: 1,
    onChange: () => { preview = null; Hooks.callAll(MARKERS_HOOK, markerOpacity()); } });
}

/** The factor for marker overlays, 0..1 (the value being dragged on the slider, else the stored one). */
export function markerOpacity() {
  if ( preview !== null ) return preview;
  try { return clamp01(game.settings.get(MODULE_ID, KEY)); } catch { return 1; }
}

/** The factor for brush rings and cursors: like markerOpacity(), but never below RING_FLOOR. */
export const ringOpacity = () => Math.max(RING_FLOOR, markerOpacity());

/** A value shown while the slider is dragged (null ends the preview). Nothing is stored. */
export function previewMarkerOpacity(v) {
  const next = v === null || v === undefined ? null : clamp01(v);
  if ( next === preview ) return;
  preview = next;
  Hooks.callAll(MARKERS_HOOK, markerOpacity());
}

/** Store the value (the slider's release). */
export function setMarkerOpacity(v) {
  const next = clamp01(v);
  let cur; try { cur = game.settings.get(MODULE_ID, KEY); } catch { return null; }
  if ( next === cur ) { if ( preview !== null ) { preview = null; Hooks.callAll(MARKERS_HOOK, markerOpacity()); } return null; }
  return game.settings.set(MODULE_ID, KEY, next);
}

/** Call `fn(value)` whenever the factor changes. Returns the unsubscribe. */
export function onMarkers(fn) {
  const id = Hooks.on(MARKERS_HOOK, fn);
  return () => Hooks.off(MARKERS_HOOK, id);
}

/**
 * Keep a display object's alpha at `base * factor` (factor = markerOpacity(), or ringOpacity() with `ring`), until it is destroyed.
 * Calling it again on the same object only updates `base`/`ring`. Returns the object.
 */
export function trackMarkers(obj, { ring = false, base = 1 } = {}) {
  if ( !obj || obj.destroyed ) return obj;
  const factor = () => ring ? ringOpacity() : markerOpacity();
  if ( obj._mmMarkers ) { Object.assign(obj._mmMarkers, { ring, base, factor }); obj.alpha = base * factor(); return obj; }
  const st = obj._mmMarkers = { ring, base, factor };
  const off = onMarkers(() => { if ( obj.destroyed ) return off(); obj.alpha = st.base * st.factor(); });
  obj.once?.("destroyed", off);
  obj.alpha = base * factor();
  return obj;
}
