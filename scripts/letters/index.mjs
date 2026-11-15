/* LETR: comic sound-effect lettering engine. Entry point for both modules.
   The folder scripts/letters/ is the same, file for file, in moinen-maps (canonical copy) and in invincible-plus-ultra (vendored
   copy, kept equal by scripts/letters/sync.mjs). Whichever copy loads registers itself in globalThis.MoinenLetters; the highest
   VERSION wins and BOTH modules then use that one engine instance (one font cache, one limit on clips at once, one memory of the
   recent lettering "hands" so two words in one moment do not look alike).

     import { letters } from "<path>/letters/index.mjs";
     const L = await letters();          // the shared engine, fonts loaded
     const h = L.play("KRAK!", { mood: "crack", space: "world", at: { x, y } });
     await h.finished;

   Full contract: scripts/letters/README.md. */
import { VERSION, createEngine } from "./engine.mjs";
import { STAMP } from "./stamp.mjs";
import * as tools from "./tools.mjs";
import { attachImpact } from "./impact/index.mjs";   // IMPACT hook 1/3: impact frames (scripts/letters/impact/), L.impact

import { RULE, CARRIERS, cmpVer, chooseCopy, buildOf, carrierUrl, moduleOf } from "./registry.mjs";

/* ENGREG (1.9.11): the registry object is shared by every copy in the page; its methods came from whichever copy loaded first, so
   an older first copy decided with its older rule. A copy with a newer rule installs its methods while no engine was made yet.
   The rule itself (registry.mjs): chosen once, after "init" and after every active carrier's copy is in; highest VERSION, then the
   more recently synced content (stamp?.at), then the canonical module; L.build / MoinenLetters.build say what the page runs. */
const REG = (globalThis.MoinenLetters ??= { copies: [], _engine: null });
const hasHooks = () => typeof globalThis.Hooks?.once === "function";
/* every active module's scripts are loaded before Foundry calls "init" (they are static script tags of the page) */
const initDone = () => !hasHooks() || !!REG._initSeen || typeof globalThis.game?.modules?.get === "function";
const activeCarriers = () => { try { return CARRIERS.filter((id) => globalThis.game?.modules?.get?.(id)?.active); } catch { return []; } };
const missingCarriers = () => activeCarriers().filter((id) => !REG.copies.some((c) => moduleOf(c.base) === id));
function makeNow(reg) {
  const { best, why, warn } = chooseCopy(reg.copies);
  if ( !best ) return null;
  if ( warn ) console.warn(`LETR | ${warn}`);
  reg._engine = best.create(best.base);
  reg._build = buildOf(best, reg.copies, why);
  try { Object.defineProperty(reg._engine, "build", { value: reg._build, enumerable: true, configurable: true }); } catch {}
  try { best.impact?.(reg._engine, best.tools); } catch ( e ) { console.warn("LETR | impact frames not attached", e); }   // IMPACT hook 2/3
  return reg._engine;
}
const methods = {
  /* the engine this page runs (the rule above); created once, on first use. Synchronous when everything is in (Foundry's setup and
     later), else it waits for "init" and imports the missing carriers' copies first */
  engine() {
    if ( !this._engine && initDone() && !missingCarriers().length ) makeNow(this);
    if ( !this._engine ) {
      this._choosing ??= (async () => {
        if ( !initDone() ) await new Promise((r) => Hooks.once("init", r));
        for ( const id of missingCarriers() ) {
          const url = carrierUrl(this.copies[0]?.base, id);
          if ( url ) { try { await import(url); } catch ( e ) { console.warn(`LETR | the lettering engine copy of ${id} did not load`, e); } }
        }
        if ( !this._engine ) makeNow(this);
      })();
      return this._choosing.then(() => this._engine?.ready()).then(() => this._engine);
    }
    return this._engine.ready().then(() => this._engine);
  },
  get version() { return this._engine?.version ?? null; },
  /* what this page runs: { version, hash, at, module, why, copies: [{ version, hash, module }] } (null before the choice) */
  get build() { return this._build ?? null; }
};
if ( (REG.rule ?? 1) < RULE && !REG._engine ) {
  for ( const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(methods)) ) Object.defineProperty(REG, k, { ...d, configurable: true, enumerable: true });
  REG.rule = RULE;
}
if ( hasHooks() && !REG._initHooked ) { REG._initHooked = true; Hooks.once("init", () => { REG._initSeen = true; }); }

const BASE = new URL("./", import.meta.url).href;
if ( !REG.copies.some((c) => c.base === BASE) ) {
  REG.copies.push({ version: VERSION, stamp: STAMP, base: BASE, create: createEngine, tools, impact: attachImpact });   // IMPACT hook 3/3
  if ( REG._engine && cmpVer(VERSION, REG._engine.version) > 0 ) console.warn(`LETR | engine ${VERSION} registered after ${REG._engine.version} was already in use; it is used after a reload`);
}

/* v5 tools (settings, authoring, networking, accessibility, windows): registered once at init by the newest copy (same order as the
   engine: VERSION, then the more recently synced copy) */
if ( !REG.toolsHooked && globalThis.Hooks?.once ) {
  REG.toolsHooked = true;
  Hooks.once("init", () => {
    const best = chooseCopy(REG.copies.filter((c) => c.tools)).best;   // the same rule as the engine (registry.mjs; tie-break stamp?.at)
    try { best?.tools.init(REG); } catch ( e ) { console.warn("LETR | tools not registered", e); }
  });
}

/* the shared engine, ready to play (fonts loaded) */
export function letters() { return REG.engine(); }
export { VERSION };
