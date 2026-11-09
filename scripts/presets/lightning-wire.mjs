import { HOOK, status } from "./runtime.mjs";

/**
 * The LIGHTNING STRIKE's wiring (lightning.mjs; dev/presets-design.md section 18): lightning.mjs is loaded on the first firing record
 * this client takes up that has a "strike" accent (or a test fire of one: the panel's dry run, this client only); until then nothing
 * of it runs (the firings runtime calls its hook only on scenes with firing records). Two listeners: the runtime's hook and
 * canvasTearDown, both returning at once otherwise.
 */
let strike = null;
const load = () => (strike ??= import("./lightning.mjs"));
export const hasStrike = (rec) => (rec?.pending?.accent ?? []).some((a) => a?.kind === "strike");

export function registerLightning() {
  Hooks.on(HOOK, (kind, data) => {
    if ( kind === "firing" ) {
      if ( !hasStrike(data?.rec) ) return;
      load().then((m) => { if ( data.test || status().known.includes(data.fid) ) m.take(data.rec); }).catch((err) => console.warn("moinen-maps | presets lightning", err));
    } else if ( kind === "gone" && strike ) strike.then((m) => m.drop(data.fid));
  });
  Hooks.on("canvasTearDown", () => { if ( strike ) strike.then((m) => m.reset()); });
}
