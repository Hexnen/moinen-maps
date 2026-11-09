import { HOOK, status } from "./runtime.mjs";
import { HOOK as UI_HOOK, armed } from "./store.mjs";

/**
 * The BLAST's wiring (blast.mjs: a bomb's / grenade's detonation at the display's frame rate - dev/presets-design.md section 24):
 * blast.mjs is loaded on the first firing record this client takes up that has a "blast" accent (or a test fire of one: the panel's dry
 * run); until then nothing of it runs (the firings runtime calls its hook only on scenes with firing records). Its program is linked
 * in the background as the record arrives (the fall / throw before the impact is long enough). The explosion FIRE's programs (the
 * burst and dust: fire.mjs warmBurst) are linked in the background a few seconds after every scene is ready, on every client (a player
 * gets a firing with ~1 s to its impact: a cold link took longer, the first fireball of a session showed late) - blast.mjs and its own
 * program too (its first load and link at the click cost a ~90 ms frame) - and again when the GM
 * arms a pad that has a burst. Listeners: the runtime's hook, the presets UI's, canvasReady and canvasTearDown.
 */
let idle = 0;
const warmFire = () => import("../fire/fire.mjs").then((m) => m.warmBurst()).catch(() => {});
let blast = null;
const load = () => (blast ??= import("./blast.mjs"));
export const hasBlast = (rec) => (rec?.pending?.accent ?? []).some((a) => a?.kind === "blast");

export function registerBlast() {
  Hooks.on(HOOK, (kind, data) => {
    if ( kind === "firing" ) {
      if ( !hasBlast(data?.rec) ) return;
      load().then((m) => { if ( data.test || status().known.includes(data.fid) ) m.take(data.rec); }).catch((err) => console.warn("moinen-maps | presets blast", err));
    } else if ( kind === "gone" && blast ) blast.then((m) => m.drop(data.fid));
  });
  Hooks.on(UI_HOOK, (what) => {
    if ( what !== "bar" || !game.user?.isGM || !canvas?.ready ) return;
    let def = null; try { def = armed(); } catch { return; }
    const L = def?.layers ?? [];
    if ( L.some((l) => l?.l === "burst" || l?.l === "dust") ) warmFire();
    if ( L.some((l) => l?.l === "accent" && l.kind === "blast") ) load().then((m) => m.warmUp()).catch(() => {});
  });
  Hooks.on("canvasReady", () => {
    clearTimeout(idle);
    idle = setTimeout(() => { idle = 0; (globalThis.requestIdleCallback ?? ((f) => f()))(() => { warmFire(); load().then((m) => m.warmUp()).catch(() => {}); }, { timeout: 4000 }); }, 3000);
  });
  Hooks.on("canvasTearDown", () => { clearTimeout(idle); idle = 0; if ( blast ) blast.then((m) => m.reset()); });
}
