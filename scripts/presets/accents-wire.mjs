import { HOOK, status } from "./runtime.mjs";

/**
 * The gun ACCENTS' wiring (accents.mjs: tracers, hit sparks, muzzle flash, the hits' night glow and rumble): accents.mjs is loaded on
 * the first firing record this client takes up that has gun accents; until then nothing of it runs (the firings runtime calls its
 * hook only on scenes with firing records). Two listeners: the runtime's hook and canvasTearDown, both returning at once otherwise.
 */
let accents = null;
const load = () => (accents ??= import("./accents.mjs"));
export const hasGun = (rec) => (rec?.pending?.accent ?? []).some((a) => a?.kind === "tracer" || a?.kind === "hitFx" || a?.kind === "muzzle");

export function registerAccents() {
  Hooks.on(HOOK, (kind, data) => {
    if ( kind === "firing" ) {
      if ( !hasGun(data?.rec) ) return;
      load().then((m) => { if ( status().known.includes(data.fid) ) m.take(data.rec); }).catch((err) => console.warn("moinen-maps | presets accents", err));
    } else if ( kind === "gone" && accents ) accents.then((m) => m.drop(data.fid));
  });
  Hooks.on("canvasTearDown", () => { if ( accents ) accents.then((m) => m.reset()); });
}
