import { HOOK, status } from "./runtime.mjs";

/**
 * THE METEOR's wiring (meteor-art.mjs draws it: dev/presets-design.md section 18): meteor-art.mjs is loaded on the first firing record
 * this client takes up that has a meteor accent; until then nothing of it runs (the firings runtime calls its hook only on scenes
 * with firing records). Two listeners: the runtime's hook and canvasTearDown, both returning at once otherwise. A test fire (the
 * editor's dry run, `test: true`) plays it on this client too.
 */
let art = null;
const load = () => (art ??= import("./meteor-art.mjs"));
export const hasMeteor = (rec) => (rec?.pending?.accent ?? []).some((a) => a?.kind === "meteor");

export function registerMeteor() {
  Hooks.on(HOOK, (kind, data) => {
    if ( kind === "firing" ) {
      if ( !hasMeteor(data?.rec) ) return;
      load().then((m) => { if ( data.test || status().known.includes(data.fid) ) m.take(data.rec); }).catch((err) => console.warn("moinen-maps | presets meteor", err));
    } else if ( kind === "gone" && art ) art.then((m) => m.drop(data.fid));
  });
  Hooks.on("canvasTearDown", () => { if ( art ) art.then((m) => m.reset()); });
}
