import { MODULE_ID } from "./config.mjs";
import { onCanvasReady, teardown, onUpdateSceneDistricts, onCanvasPan, onAttrStoreChanged } from "./districts.mjs";
import { api, isStore, resetStore } from "./attrs.mjs";
import { registerCoreSettings } from "./config.mjs";
import { registerSettings, onGetSceneControlButtons, onRenderSceneControls, onWorkspaceTool, installPatches } from "./tools.mjs";
import "./workspace/sections.mjs";
import "./destruction/cinematic-panel.mjs";      // cinematic screen effects: CinematicFx (api.cinematic), client settings, the "Cinematic effects" dock panel
import "./director/index.mjs";                  // the Director: events -> shots for the players (scripts/director); owns the screen engine the cinematic mode uses
import "./presets/presets.mjs";              // destruction presets: api.presets (data, expander, the GM's writer; scripts/presets, dev/presets-design.md)
import { syncWorkspace } from "./workspace/shell.mjs";
import { registerFilterSettings } from "./filter.mjs";
import * as WaterScene from "./water/water.mjs";
import * as WaterEditor from "./water/editor.mjs";
import * as WaterRods from "./water/rods.mjs";
import * as WaterRipples from "./water/ripples.mjs";
import * as WaterReflect from "./water/reflect.mjs";
import * as WaterSubmerge from "./water/submerge.mjs";
import { schedulePanel, refreshPanel, removePanel } from "./filter-panel.mjs";
import { onDrawNote, onCreateNote, onRefreshNote, onUpdateNote, refreshPins } from "./pin.mjs";
import { onCreateToken, onDrawToken, onRefreshToken, onUpdateToken, onDeleteToken, onTargetToken, onCreateCombatant, onUpdateCombat, onCombatStart, teardownTokenDrops } from "./token-drop.mjs";
import { registerTokenFx } from "./tokens/fx.mjs";
import { registerTokenFxSetting } from "./tokens/settings.mjs";
import { registerRoads } from "./roads/roads.mjs";
import { registerZones } from "./zones/zones.mjs";
import { registerOrbit } from "./zones/orbit.mjs";
import "./diag.mjs";   // code-changed-on-disk notice + scene-switch log (api.diag)
import "./vram-ui.mjs";   // the VRAM meter per client: what this page holds on the GPU vs the card (api.vram, api.diag.vram)
import "./letters-api.mjs";   // LETR: the comic sound-effect lettering engine (scripts/letters/, shared with invincible-plus-ultra): api.letters()
import "./bar-toggles.mjs";   // TOGL: the VRAM meter's and the director bar's on/off toggles in the map's group of the left menu
import { registerFlood } from "./destruction/flood.mjs";
import { registerSmoothView } from "./view-smooth.mjs";
import { registerWarmup } from "./warmup.mjs";
import { registerLoadWarm } from "./load-warm.mjs";
registerRoads();   // roads and their traffic register their own hooks (scripts/roads)
registerZones();   // zones drawn with a pencil, movement counted in zones (scripts/zones)
registerOrbit();   // the shared Orbit scene: tokens thrown to orbit from any map, the strip of who is up there (scripts/zones/orbit.mjs)
registerFlood();   // the water of the flooded holes (destruction kind "flood"): its own hooks (scripts/destruction/flood.mjs)
registerSmoothView();   // smooth wheel zoom + even frame pacing on fast displays (client settings, scripts/view-smooth.mjs)
registerWarmup();   // GPU objects the first zoom / pan would make, made at idle after the scene opens (scripts/warmup.mjs)
registerLoadWarm();   // the damage layer's programs linked while the scene loads, not in its first frame (scripts/load-warm.mjs)

Hooks.on("drawNote", onDrawNote);
Hooks.on("refreshNote", onRefreshNote);
Hooks.on("createNote", onCreateNote);
Hooks.on("updateNote", onUpdateNote);
Hooks.on("updateScene", (scene, changed) => {
  if ( scene.id === canvas.scene?.id && foundry.utils.hasProperty(changed, `flags.${MODULE_ID}`) ) refreshPins();
});
Hooks.on("canvasReady", () => refreshPins());
// cosmetic token drop (hooks only, nothing is written to the token)
Hooks.on("createToken", onCreateToken);
Hooks.on("drawToken", onDrawToken);
Hooks.on("refreshToken", onRefreshToken);
Hooks.on("updateToken", onUpdateToken);
Hooks.on("deleteToken", onDeleteToken);
Hooks.on("targetToken", onTargetToken);
Hooks.on("createCombatant", onCreateCombatant);
Hooks.on("updateCombat", onUpdateCombat);
Hooks.on("combatStart", onCombatStart);
Hooks.on("canvasTearDown", teardownTokenDrops);
// enter / leave / idle / death styles of tokens (after the hooks above: a deleted token's ghost is made before its rig goes)
registerTokenFx();

Hooks.once("init", () => { registerCoreSettings(); registerTokenFxSetting(); registerSettings(); registerFilterSettings(); });
// the floating pin filter follows what is on the map
Hooks.on("canvasReady", () => { refreshPanel(); WaterScene.onCanvasReady(); WaterEditor.onCanvasReady(); WaterRods.onCanvasReady(); WaterReflect.onCanvasReady(); WaterRipples.onCanvasReady(); WaterSubmerge.onCanvasReady(); });
Hooks.on("updateScene", WaterScene.onUpdateScene);
Hooks.on("canvasTearDown", () => { removePanel(); WaterSubmerge.teardown(); WaterRipples.teardown(); WaterReflect.teardown(); WaterRods.teardown(); WaterEditor.teardown(); WaterScene.teardown(); });
// drawNote too: a new note is not visible yet when createNote fires, only once it is drawn
for ( const h of ["createNote", "drawNote", "updateNote", "deleteNote", "refreshNote", "sightRefresh", "updateScene", "moinenMapsPanel"] ) Hooks.on(h, () => schedulePanel());
// macros and other modules: game.modules.get("moinen-maps").api  (+ hook "moinenMaps.districtAttrChanged")
Hooks.once("ready", () => { game.modules.get(MODULE_ID).api = api; });
// the GM-only attribute store is a hidden journal entry; follow its changes
for ( const h of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry"] ) {
  Hooks.on(h, (doc) => { if ( game.user.isGM && isStore(doc) ) { if ( h === "deleteJournalEntry" ) resetStore(); if ( canvas.ready ) onAttrStoreChanged(); } });
}
Hooks.once("setup", () => installPatches());
Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
Hooks.on("renderSceneControls", onRenderSceneControls);
// the workspace (options bar + dock) follows the toolbar, and appears or goes with the canvas
Hooks.on("canvasReady", () => syncWorkspace());
Hooks.on("moinenMapsTool", onWorkspaceTool);
Hooks.on("canvasReady", onCanvasReady);
Hooks.on("canvasTearDown", teardown);
Hooks.on("updateScene", onUpdateSceneDistricts);
Hooks.on("canvasPan", onCanvasPan);
