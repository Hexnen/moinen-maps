/**
 * The DIRECTOR submodule (scripts/director): the shared screen engine (stage.mjs / screen.mjs, the former cinematic effects), the
 * director's events -> shots -> screens (director.mjs, core.mjs, overlay.mjs), the module's own events (sources.mjs), the GM's bar
 * (bar.mjs) and the workspace section (section.mjs). API: game.modules.get("moinen-maps").api.director; hook "moinenMapsDirector".
 */
import "./director.mjs";
import { registerSources } from "./sources.mjs";
import { registerBar } from "./bar.mjs";
import "./section.mjs";
import { registerSceneSource } from "./source-scene.mjs";
import "./scene-panel.mjs";

registerSources();
registerBar();
registerSceneSource();
