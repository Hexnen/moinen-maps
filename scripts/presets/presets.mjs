import { api as moduleApi } from "../attrs.mjs";
import { sharedNow } from "../shared-clock.mjs";
import * as Core from "./core.mjs";
import * as R from "./runtime-core.mjs";
import * as Run from "./runtime.mjs";
import { BUILTIN } from "./defs.mjs";
import { registerAccents } from "./accents-wire.mjs";
import { registerMeteor } from "./meteor-wire.mjs";

/**
 * DESTRUCTION PRESETS: the public API, `game.modules.get("moinen-maps").api.presets` (dev/presets-design.md; P1 the data format, the
 * expander and the GM's writer; P6 the firings runtime). Importing this file puts the API object in place and the runtime's scene
 * hooks (runtime.mjs), which return at once on a scene without firing records: no setting, no flag, no ticker, so a world that
 * never fires a preset is exactly as before. The writer (write.mjs: the layers' code) is loaded on the first GM action.
 *   list()                        the built-in definitions (cleaned copies)
 *   get(id)                       one of them, or null
 *   validate(def)                 { ok, def, errors } of any definition (core.mjs cleanDef)
 *   expand(def | id, gesture, opts, env?)   the plan of a firing, nothing written (env defaults to the open scene)
 *   fire(def | id, gesture, opts)  GM: fire it -> { id, plan }   gesture { a: [x, y], b?: [x, y], from?: [x, y] } in scene px;
 *                                 opts { seed, size 0.5..2, power -1..1, aftermath: seconds | null (no end) | undefined (the preset's) }
 *   firings()                     the open scene's firing records, newest first, each with { state, partial } (runtime-core stateOf)
 *   undo(id?)                     GM: take a firing back (id omitted: this GM's last on the scene) - damage dissolves out, fire and
 *                                 smoke go out, the record goes; works after the record was purged too
 *   redo()                        GM: fire the last firing taken back again (same seed, new T0)
 *   settle(id)                    GM: drop a record now (what it put down stays and plays out)
 *   fires()                       the fire / smoke strokes of the scene's firings still burning (o: their out time, null = no end)
 *   clearFires()                  GM: put out the timed ones (the fire layer's clear() does not reach a stroke with an out time)
 *   HOOK                          "moinenMapsPresets": ("firing" | "impact" | "part" | "gone", data) on every client (runtime.mjs)
 */
const MID = "moinen-maps";
const defOf = (d) => (typeof d === "string" ? BUILTIN.find((b) => b.id === d) ?? null : d);
let writer = null;
const W = () => (writer ??= import("./write.mjs"));
const flags = () => canvas?.scene?.flags?.[MID] ?? {};

export const presetsApi = {
  VERSION: Core.VERSION,
  AFTERMATH: Core.AFTERMATH,
  HOOK: Run.HOOK,
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
  async undo(id = null) { return (await W()).undo(id); },
  async redo() { return (await W()).redo(); },
  async settle(id) { return (await W()).settle(id); },
  async clearFires() { return (await W()).clearFires(); },
  firings: () => {
    const F = flags(), now = sharedNow(), dIds = new Set(Object.keys(F.destructionObjects ?? {}));
    return Run.recordsOf().sort((a, b) => (b.t0 ?? 0) - (a.t0 ?? 0)).map((r) => ({ ...r, ...R.stateOf(r, F.fireStrokes, dIds, now) }));
  },
  fires: () => R.burning(Run.recordsOf(), flags().fireStrokes, sharedNow()),
  /** Tests: what this client's runtime has taken up; the GM's undo / redo stacks (once the writer is loaded). */
  _status: async () => ({ runtime: Run.status(), stacks: writer ? (await W()).stacks() : null })
};

moduleApi.presets = presetsApi;
Run.registerRuntime();
registerAccents();
registerMeteor();

