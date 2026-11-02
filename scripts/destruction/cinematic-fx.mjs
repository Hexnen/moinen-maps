import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import { createFx } from "./cinematic-fx-logic.mjs";

/**
 * CINEMATIC SCREEN EFFECTS, the Foundry side: the real environment for cinematic-fx-logic.mjs (page overlay under #interface, the canvas
 * stage, the app ticker, canvas.animatePan, the canvas element for the player's abort input) and this client's own opt-out settings.
 *
 *   CinematicFx.begin(snapshot, { strokes, bounds })   snapshot = the show's frozen settings ({ r } from cinematic-core snapshot(), or the
 *                                                        resolved values); strokes = the staged stroke objects in order (flat path `p`),
 *                                                        bounds = their art box { x0, y0, x1, y1 } (optional)
 *   CinematicFx.impact({ x, y, size, t })              a stroke starts (art px = scene px; size = the hit's extent in art px)
 *   CinematicFx.end()                                  hold, camera back, bars out, everything removed; resolves when gone (end({immediate:true}): now)
 *   CinematicFx.preview(settings)                      the full effects on a throwaway impact at the screen centre
 *   CinematicFx.active / .rate / .abort()
 * Also at game.modules.get("moinen-maps").api.cinematic.
 *
 * Client settings (per player, scope client): no letterbox / vignette / shake / flash / slow motion for me, camera (auto: follow for
 * players, stay for the GM / on / off), reduced motion (auto: the OS preference / on / off).
 */

export const OPT_KEYS = {
  cinNoLetterbox: "noLetterbox", cinNoVignette: "noVignette", cinNoShake: "noShake", cinNoFlash: "noFlash", cinNoSlow: "noSlow"
};

/** The client's opt-outs as cinematic-core effective() takes them. */
export function clientOpts() {
  const get = (k) => { try { return game.settings.get(MODULE_ID, k); } catch { return undefined; } };
  const o = {};
  for ( const [k, v] of Object.entries(OPT_KEYS) ) o[v] = !!get(k);
  const cam = get("cinCamera") ?? "auto";
  o.noCamera = cam === "off" || (cam === "auto" && !!game.user?.isGM);
  const red = get("cinReduced") ?? "auto";
  o.reduced = red === "on" || (red === "auto" && !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  return o;
}

function registerSettings() {
  const T = (k) => `MOINENMAPS.Destr.cin.${k}`;
  const bool = (key, name) => game.settings.register(MODULE_ID, key, { name: T(name), hint: T("hintOptOut"), scope: "client", config: true, type: Boolean, default: false });
  bool("cinNoLetterbox", "noLetterbox"); bool("cinNoVignette", "noVignette"); bool("cinNoShake", "noShake"); bool("cinNoFlash", "noFlash"); bool("cinNoSlow", "noSlow");
  game.settings.register(MODULE_ID, "cinCamera", {
    name: T("cameraSetting"), hint: T("hintOptOut"), scope: "client", config: true, type: String, default: "auto",
    choices: { auto: T("camAuto"), on: T("camOn"), off: T("noCamera") }
  });
  game.settings.register(MODULE_ID, "cinReduced", {
    name: T("reducedSetting"), hint: T("reducedHint"), scope: "client", config: true, type: String, default: "auto",
    choices: { auto: T("redAuto"), on: T("redOn"), off: T("redOff") }
  });
  // the GM's saved presets: { id: { name, values } } (world: every client can resolve a scene's preset)
  game.settings.register(MODULE_ID, "cinUserPresets", { scope: "world", config: false, type: Object, default: {} });
}
Hooks.once("init", registerSettings);

const env = () => {
  const ui = document.getElementById("interface");
  const stage = canvas.stage, app = canvas.app;
  return {
    doc: document,
    insert: (el) => (ui?.parentNode ?? document.body).insertBefore(el, ui ?? null),
    timer: (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); },
    now: () => performance.now(),
    stage,
    ticker: { add: (fn) => app.ticker.add(fn, null, PIXI.UPDATE_PRIORITY.LOW), remove: (fn) => app.ticker.remove(fn) },
    pan: (v) => canvas.animatePan(v),
    stopPan: () => foundry.canvas.animation.CanvasAnimation.terminateAnimation("canvas.animatePan"),
    view: () => ({ x: stage.pivot.x, y: stage.pivot.y, scale: stage.scale.x, vw: app.screen.width, vh: app.screen.height }),
    centre: () => ({ x: stage.pivot.x, y: stage.pivot.y }),
    canvasEl: app.view ?? app.canvas,
    win: window,
    display: () => moduleApi.destruction?.display?.() ?? null,
    opts: clientOpts
  };
};

export const CinematicFx = createFx(env);
moduleApi.cinematic = CinematicFx;
// a scene change or a reload of the canvas: everything of the show goes at once
Hooks.on("canvasTearDown", () => CinematicFx.abort());
