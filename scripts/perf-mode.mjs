import { MODULE_ID } from "./config.mjs";

/**
 * PERFORMANCE MODE, per client (setting "performanceMode"): what this machine draws, never what is stored or shared.
 *   high    everything as designed
 *   medium  a stroke enters only when it is on screen (off screen it is simply there); fewer particles
 *   low     entries are short fades, no idle particles, no water reflections, at most 15 cars, lights do not twinkle, the settled
 *           destruction is always drawn from its cache
 */
export const PERF_MODES = ["high", "medium", "low"];
let cur = null;                     // read once (game.settings.get per particle cost ~10 us), again after a change
export function perfMode() {
  if ( cur ) return cur;
  try { const m = game.settings.get(MODULE_ID, "performanceMode"); return cur = PERF_MODES.includes(m) ? m : "high"; } catch { return "high"; }
}
export const perfLow = () => perfMode() === "low";
/** The most live particles of the destruction layer. */
export const particleCap = () => ({ high: 260, medium: 160, low: 80 })[perfMode()];

export function registerPerfMode() {
  game.settings.register(MODULE_ID, "performanceMode", {
    name: "MOINENMAPS.Setting.perfMode", hint: "MOINENMAPS.Setting.perfModeHint", scope: "client", config: true, type: String, default: "high",
    choices: { high: "MOINENMAPS.Setting.perfHigh", medium: "MOINENMAPS.Setting.perfMedium", low: "MOINENMAPS.Setting.perfLow" },
    onChange: () => { cur = null; Hooks.callAll("moinenMapsPerfMode", perfMode()); }
  });
}
