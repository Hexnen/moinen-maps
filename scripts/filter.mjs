import { MODULE_ID, sceneConfig } from "./config.mjs";

/**
 * Pin filter state: which pin categories a user has hidden on a scene. A category is a standalone pin's type id, or "note" for
 * ordinary map notes (journal pins). The filter is per user (client setting) and per scene; it never touches the documents.
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
const store = () => cache ??= foundry.utils.deepClone(game.settings.get(MODULE_ID, "pinFilter") ?? {});

export const hiddenIds = (sceneId) => new Set(store()[sceneId] ?? []);

/** True when the user hid this note's category on a scene where pins are on. */
export function isHidden(doc) {
  const hidden = store()[doc?.parent?.id];
  return !!hidden?.length && hidden.includes(categoryOf(doc)) && !!sceneConfig(doc.parent).enabled;
}

export async function setHidden(sceneId, ids) {
  const all = { ...store() };
  if ( ids.size ) all[sceneId] = [...ids]; else delete all[sceneId];
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
