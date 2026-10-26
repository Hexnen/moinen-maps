export const MODULE_ID = "moinen-maps";

/** Halftone dot fill: size = largest dot diameter as a fraction of the spacing; spacing in grid squares; tint = background wash. */
export const DOT_DEFAULTS = { size: 0.55, spacing: 0.16, angle: 45, useFill: true, color: "#15110f", tint: 0.2, shape: "round", gradient: "none", overprint: false };

export const DEFAULTS = {
  enabled: true,
  color: "#e5322d",
  useNoteTint: true,
  size: 1,
  glyph: "note",       // "note" = note icon inside the pin, "dot" = plain highlight
  shadow: true,
  glow: true,          // glow around the pin on hover / selection
  drop: true,
  dropHeight: 1,
  bounce: 0.55,
  squeeze: 0.5,
  hop: true,           // small hop when a pin is moved
  hoverMode: "saturate",   // districts: none | saturate | highlight
  districtOpacity: 0.8,    // used by districts that carry no opacity of their own
  districtInk: "ink",      // outline colour mode: ink | match | custom
  districtInkColor: "#15110f",
  districtInkOpacity: 0.95,
  districtInkWidth: 1,
  districtListForPlayers: false, // players may open a read-only list of revealed districts
  districtNoBorder: false, // new districts start without an inked outline
  districtNoColor: false, // new districts start without a colour tint
  hoverColor: "#ffd36b",
  hoverStrength: 0.6,
  dots: { ...DOT_DEFAULTS },   // scene default for districts filled with halftone dots
  attrDisplay: "hover",    // district attributes on the map: off | hover | always
  label: { family: "", sizeMode: "fit", size: 36, weight: "700", italic: false, spacing: 3, caseMode: "upper", color: "auto", autoColor: true,
    halo: "#fff3e2", haloWidth: 7, shadow: false, opacity: 1, curved: false, angle: 0, offsetX: 0, offsetY: 0 },   // district label typography
  pinText: { family: "", size: 0, color: "", halo: "", haloWidth: 0 },                  // note tooltip text (0 / "" = Foundry's own)
  idle: "breathe",     // none | breathe | bob | sway | pulse
  idleStrength: 0.5,
  idleSpeed: 1
};

/**
 * Standalone pin types (notes without a journal entry). Add an entry here to get a new toolbar tool.
 * `glyph` names a drawer in pin-art.mjs; `icon` is the Foundry core image stored on the note (shown if pins are off for a scene);
 * `fa` is the toolbar icon; the label lives at MOINENMAPS.Type.<id>.
 */
export const PIN_TYPES = [
  { id: "plain",    glyph: "star",     icon: "icons/svg/target.svg",       fa: "fa-location-dot",         color: "#e5322d" },
  { id: "danger",   glyph: "skull",    icon: "icons/svg/skull.svg",        fa: "fa-skull",                color: "#c8261f" },
  { id: "treasure", glyph: "gem",      icon: "icons/svg/chest.svg",        fa: "fa-gem",                  color: "#e0a21a" },
  { id: "quest",    glyph: "bang",     icon: "icons/svg/mystery-man.svg",  fa: "fa-exclamation",          color: "#2f86d6" },
  { id: "camp",     glyph: "tent",     icon: "icons/svg/fire.svg",         fa: "fa-campground",           color: "#2e9e5b" },
  { id: "door",     glyph: "door",     icon: "icons/svg/door-closed.svg",  fa: "fa-door-open",            color: "#8a5a3a" },
  { id: "question", glyph: "question", icon: "icons/svg/hazard.svg",       fa: "fa-question",             color: "#8e5bd4" }
];

/** Preset colours offered in the colour dialog. */
export const PIN_COLORS = ["#e5322d", "#e0a21a", "#2e9e5b", "#2f86d6", "#8e5bd4", "#d8509a", "#8a5a3a", "#222222"];

export const pinTypeOf = (doc) => {
  const id = doc?.flags?.[MODULE_ID]?.pin;
  return id ? (PIN_TYPES.find((t) => t.id === id) ?? PIN_TYPES[0]) : null;
};

export const IDLE_MODES = ["none", "breathe", "bob", "sway", "pulse"];

/**
 * Resolved scene config. Pins and districts read it every frame, so the merge is memoised per scene document and dropped
 * whenever any scene updates. Treat the returned object as read-only (clone before mutating).
 */
let configCache = new WeakMap();
Hooks.on("updateScene", () => { configCache = new WeakMap(); });
Hooks.on("canvasTearDown", () => { configCache = new WeakMap(); });
export function sceneConfig(scene) {
  if ( !scene || typeof scene !== "object" ) return foundry.utils.deepClone(DEFAULTS);
  let c = configCache.get(scene);
  if ( !c ) {
    const f = scene.flags?.[MODULE_ID]?.config ?? {};
    c = foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULTS), f, { inplace: false });
    // resolution order: unsaved draft (Scene Config form) > saved scene config > built-in default
    if ( sceneDraft && sceneDraft.sceneId === scene.id ) c = foundry.utils.mergeObject(c, sceneDraft.data, { inplace: false });
    configCache.set(scene, c);
  }
  return c;
}

/**
 * Unsaved Scene Config form values, laid over the stored config of one scene for a live preview. Never written to the document.
 * `setSceneDraft(null)` discards it. Listeners (pins, districts) are told through the `moinenMapsSceneDraft` hook.
 */
let sceneDraft = null;
export function setSceneDraft(sceneId, data = null) {
  sceneDraft = sceneId && data ? { sceneId, data } : null;
  configCache = new WeakMap();
  Hooks.callAll("moinenMapsSceneDraft");
}

/** True when the user asks the OS for less motion: drops, hops, idle loops and district blooms are skipped. */
const reduceMQ = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
export const reducedMotion = () => !!reduceMQ?.matches;
