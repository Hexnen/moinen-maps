import { HOOK, status } from "./runtime.mjs";

/**
 * The ACCENTS' wiring (accents.mjs: the guns' tracers, hit sparks, muzzle flash, night glow and rumble; the bomb's fall, the
 * grenade's throw and bounce; the screen / light cues): accents.mjs is loaded on the first firing record this client takes up that has
 * any of them; until then nothing of it runs (the firings runtime calls its
 * hook only on scenes with firing records). Two listeners: the runtime's hook and canvasTearDown, both returning at once otherwise.
 */
let accents = null;
const load = () => (accents ??= import("./accents.mjs"));
const KINDS = ["tracer", "hitFx", "muzzle", "fallShadow", "throwArc", "bounce", "landing", "airRing"];
export const hasGun = (rec) => (rec?.pending?.accent ?? []).some((a) => a?.kind === "tracer" || a?.kind === "hitFx" || a?.kind === "muzzle");
/** A record with anything this layer plays (accents-core itemsOf: its accents, its cues). */
export const hasAccents = (rec) => (rec?.pending?.accent ?? []).some((a) => KINDS.includes(a?.kind)) || (rec?.pending?.cue ?? []).length > 0;

export function registerAccents() {
  Hooks.on(HOOK, (kind, data) => {
    if ( kind === "firing" ) {
      if ( !hasAccents(data?.rec) ) return;
      load().then((m) => { if ( status().known.includes(data.fid) ) m.take(data.rec); }).catch((err) => console.warn("moinen-maps | presets accents", err));
    } else if ( kind === "gone" && accents ) accents.then((m) => m.drop(data.fid));
  });
  Hooks.on("canvasTearDown", () => { if ( accents ) accents.then((m) => m.reset()); });
}
