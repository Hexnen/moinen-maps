import { MODULE_ID, sceneConfig } from "../config.mjs";
import { resolveFx, FX_DEFAULTS } from "./styles.mjs";

/**
 * Token effects: where their settings come from, and the hand-over between token-drop.mjs (the older effects: drop, hide ghost,
 * reticle, combat entry) and tokens/fx.mjs (the new enter / leave / idle / death styles) without an import cycle: fx.mjs fills
 * `runtime` when it loads, token-drop.mjs calls through it.
 *
 * Resolution: the token's own override flag (flags.moinen-maps.fx) > the scene's `tokens` block (flags.moinen-maps.config.tokens,
 * laid over config.mjs DEFAULTS by sceneConfig) > built-in.
 */

export const FX_FLAG = "fx";

/** The per-token override flag of a token document (a plain object, possibly empty). */
export const tokenFlag = (doc) => doc?.flags?.[MODULE_ID]?.[FX_FLAG] ?? {};

/** The effective token-effect settings of a token document (scene + token override). */
export function fxFor(doc) {
  const scene = doc?.parent ?? globalThis.canvas?.scene;
  return resolveFx(sceneConfig(scene).tokens, tokenFlag(doc), FX_DEFAULTS);
}

/** Client kill switch: "Token effects on this client" (setting tokenFx). */
export function tokenFxOn() { try { return game.settings.get(MODULE_ID, "tokenFx") !== false; } catch { return true; } }

export function registerTokenFxSetting() {
  game.settings.register(MODULE_ID, "tokenFx", {
    name: "MOINENMAPS.TokFx.setting", hint: "MOINENMAPS.TokFx.settingHint", scope: "client", config: true, type: Boolean, default: true,
    onChange: () => Hooks.callAll("moinenMapsTokenFxSettings")
  });
}

/** Filled by tokens/fx.mjs: enter(token, style, delay, ready, cause), leave(token, style, delay, cause), busy(token). */
export const runtime = {};
