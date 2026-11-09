import { api as moduleApi } from "../attrs.mjs";
import * as Core from "./core.mjs";
import { BUILTIN } from "./defs.mjs";

/**
 * DESTRUCTION PRESETS: the public API, `game.modules.get("moinen-maps").api.presets` (dev/presets-design.md; P1: the data format, the
 * expander and the GM's writer - no tool, no panel yet). Importing this file only puts the API object in place: no hook, no setting,
 * no flag, no ticker, so a world that never fires a preset is exactly as before. The writer (write.mjs: the layers' code) is loaded
 * on the first firing.
 *   list()                        the built-in definitions (cleaned copies)
 *   get(id)                       one of them, or null
 *   validate(def)                 { ok, def, errors } of any definition (core.mjs cleanDef)
 *   expand(def | id, gesture, opts, env?)   the plan of a firing, nothing written (env defaults to the open scene)
 *   fire(def | id, gesture, opts)  GM: fire it -> { id, plan }   gesture { a: [x, y], b?: [x, y], from?: [x, y] } in scene px;
 *                                 opts { seed, size 0.5..2, power -1..1, aftermath: seconds | null (no end) | undefined (the preset's) }
 *   firings()                     the open scene's firing records, newest first
 */
const defOf = (d) => (typeof d === "string" ? BUILTIN.find((b) => b.id === d) ?? null : d);
let writer = null;
const W = () => (writer ??= import("./write.mjs"));

export const presetsApi = {
  VERSION: Core.VERSION,
  AFTERMATH: Core.AFTERMATH,
  list: () => BUILTIN.map((d) => Core.cleanDef(d).def),
  get: (id) => { const d = BUILTIN.find((b) => b.id === id); return d ? Core.cleanDef(d).def : null; },
  validate: (def) => Core.cleanDef(def),
  async expand(def, gesture, opts = {}, env = null) {
    const d = defOf(def); if ( !d ) throw new Error(`presets: unknown preset "${def}"`);
    return Core.expand(d, gesture, { seed: 1, ...opts }, env ?? (await W()).envOf());
  },
  async fire(def, gesture, opts = {}) {
    const d = defOf(def);
    if ( !d ) { ui.notifications?.warn(game.i18n.format("MOINENMAPS.DPreset.unknown", { id: String(def) })); return null; }
    return (await W()).fire(d, gesture, opts);
  },
  firings: () => {
    const F = canvas?.scene?.flags?.["moinen-maps"]?.presetFirings ?? {};
    return Object.values(F).filter((r) => r && typeof r === "object" && r.id).sort((a, b) => (b.t0 ?? 0) - (a.t0 ?? 0));
  }
};

moduleApi.presets = presetsApi;
