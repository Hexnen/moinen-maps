import { MODULE_ID, sceneConfig } from "./config.mjs";

/**
 * Pin filter state: what a user has hidden on a scene, either a whole pin type (`t`: standalone type ids, or "note" for ordinary map
 * notes) or single pins (`n`: note ids). Per user (client setting) and per scene; it never touches the documents.
 */
export const NOTE_CAT = "note";

export const categoryOf = (doc) => {
  const id = doc?.flags?.[MODULE_ID]?.pin;
  return id && !doc.entryId ? id : NOTE_CAT;
};

export function registerFilterSettings() {
  const S = game.settings;
  S.register(MODULE_ID, "pinFilter", { scope: "client", config: false, type: Object, default: {}, onChange: () => { cache = null; applyFilter(); } });
  S.register(MODULE_ID, "pinPanel", {
    name: "MOINENMAPS.Setting.pinPanel", hint: "MOINENMAPS.Setting.pinPanelHint", scope: "client", config: true, type: Boolean, default: true,
    onChange: () => { Hooks.callAll("moinenMapsPanel"); ui.controls?.render?.(); }
  });
  S.register(MODULE_ID, "pinPanelState", { scope: "client", config: false, type: Object, default: {} });
}

let cache = null;
/** Normalised store: { [sceneId]: { t: string[], n: string[] } } (an older flat array meant hidden types only). */
const store = () => {
  if ( cache ) return cache;
  const raw = game.settings.get(MODULE_ID, "pinFilter") ?? {};
  cache = {};
  for ( const [id, v] of Object.entries(raw) ) {
    const e = Array.isArray(v) ? { t: v, n: [] } : { t: v?.t ?? [], n: v?.n ?? [] };
    if ( e.t.length || e.n.length ) cache[id] = e;
  }
  return cache;
};

/** The hidden types and pins of a scene, as fresh sets the caller may edit. */
export function hiddenState(sceneId) {
  const e = store()[sceneId];
  return { t: new Set(e?.t ?? []), n: new Set(e?.n ?? []) };
}

/** True when the user hid this note (its type or the pin itself) on a scene where pins are on. */
export function isHidden(doc) {
  const e = store()[doc?.parent?.id];
  return !!e && (e.t.includes(categoryOf(doc)) || e.n.includes(doc.id)) && !!sceneConfig(doc.parent).enabled;
}

export async function setHidden(sceneId, { t, n }) {
  const all = { ...store() };
  const live = canvas.scene?.id === sceneId ? canvas.scene.notes : null;
  const ids = [...n].filter((id) => !live || live.has(id));      // forget pins that no longer exist
  if ( t.size || ids.length ) all[sceneId] = { t: [...t], n: ids }; else delete all[sceneId];
  cache = all;
  await game.settings.set(MODULE_ID, "pinFilter", all);
}

/** Re-evaluate every note of the scene; the refreshNote hook (pin.mjs) then hides or shows it. */
export function applyFilter() {
  for ( const note of canvas.notes?.placeables ?? [] ) note.renderFlags?.set({ refreshState: true });
  Hooks.callAll("moinenMapsPanel");
}

/** Called from a note's refresh: keep a filtered note invisible and unselected. */
export function enforce(note) {
  if ( !isHidden(note.document) ) return;
  if ( note.visible ) note.visible = false;
  if ( note.controlled ) note.release();
}
