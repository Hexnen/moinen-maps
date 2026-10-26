import { MODULE_ID } from "./config.mjs";
import { onRenderSceneConfig } from "./scene-tab.mjs";
import { onCanvasReady, teardown, onUpdateSceneDistricts, onCanvasPan, onAttrStoreChanged } from "./districts.mjs";
import { api, isStore, resetStore } from "./attrs.mjs";
import { setSceneDraft } from "./config.mjs";
import { refreshAllDistricts } from "./districts.mjs";
import { registerSettings, onGetSceneControlButtons, onRenderSceneControls, installPatches } from "./tools.mjs";
import { onDrawNote, onCreateNote, onRefreshNote, onUpdateNote, refreshPins } from "./pin.mjs";

Hooks.on("renderSceneConfig", onRenderSceneConfig);
Hooks.on("drawNote", onDrawNote);
Hooks.on("refreshNote", onRefreshNote);
Hooks.on("createNote", onCreateNote);
Hooks.on("updateNote", onUpdateNote);
Hooks.on("updateScene", (scene, changed) => {
  if ( scene.id === canvas.scene?.id && foundry.utils.hasProperty(changed, `flags.${MODULE_ID}`) ) refreshPins();
});
Hooks.on("canvasReady", () => refreshPins());
// Scene Config live preview: a draft of the form values is laid over the scene config; closing the sheet (or leaving the scene) drops it
let draftFrame = 0;
Hooks.on("moinenMapsSceneDraft", () => {
  if ( draftFrame ) return;
  draftFrame = requestAnimationFrame(() => { draftFrame = 0; if ( canvas.ready ) { refreshPins(); refreshAllDistricts(); } });
});
Hooks.on("closeSceneConfig", () => setSceneDraft(null));
Hooks.on("canvasTearDown", () => setSceneDraft(null));

Hooks.once("init", () => registerSettings());
// macros and other modules: game.modules.get("moinen-maps").api  (+ hook "moinenMaps.districtAttrChanged")
Hooks.once("ready", () => { game.modules.get(MODULE_ID).api = api; });
// the GM-only attribute store is a hidden journal entry; follow its changes
for ( const h of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry"] ) {
  Hooks.on(h, (doc) => { if ( game.user.isGM && isStore(doc) ) { if ( h === "deleteJournalEntry" ) resetStore(); if ( canvas.ready ) onAttrStoreChanged(); } });
}
Hooks.once("setup", () => installPatches());
Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
Hooks.on("renderSceneControls", onRenderSceneControls);
Hooks.on("canvasReady", onCanvasReady);
Hooks.on("canvasTearDown", teardown);
Hooks.on("updateScene", onUpdateSceneDistricts);
Hooks.on("canvasPan", onCanvasPan);
