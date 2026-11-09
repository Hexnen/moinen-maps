import { HOOK, status } from "./runtime.mjs";

/**
 * The ROCKET's wiring (rocket.mjs; dev/presets-design.md section 21): rocket.mjs is loaded on the first firing record this client takes
 * up that has a "rocket" accent (or a test fire of one: the panel's dry run, this client only); until then nothing of it runs (the
 * firings runtime calls its hook only on scenes with firing records). Two listeners: the runtime's hook and canvasTearDown, both
 * returning at once otherwise.
 */
let rocket = null;
const load = () => (rocket ??= import("./rocket.mjs"));
export const hasRocket = (rec) => (rec?.pending?.accent ?? []).some((a) => a?.kind === "rocket");

export function registerRocket() {
  Hooks.on(HOOK, (kind, data) => {
    if ( kind === "firing" ) {
      if ( !hasRocket(data?.rec) ) return;
      load().then((m) => { if ( data.test || status().known.includes(data.fid) ) m.take(data.rec); }).catch((err) => console.warn("moinen-maps | presets rocket", err));
    } else if ( kind === "gone" && rocket ) rocket.then((m) => m.drop(data.fid));
  });
  Hooks.on("canvasTearDown", () => { if ( rocket ) rocket.then((m) => m.reset()); });
}
