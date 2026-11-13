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

const REG = (globalThis.MoinenLetters ??= {
  copies: [],
  _engine: null,
  /* the newest registered copy (VERSION, then FXLE F14: the more recently synced content); created once, on first use */
  async engine() {
    if ( !this._engine ) {
      const best = this.copies.slice().sort((a, b) => cmpVer(b.version, a.version) || String(b.stamp?.at ?? "").localeCompare(String(a.stamp?.at ?? "")))[0];
      const twin = this.copies.find((c) => c !== best && cmpVer(c.version, best.version) === 0 && c.stamp?.hash && best.stamp?.hash && c.stamp.hash !== best.stamp.hash);
      if ( twin ) console.warn(`LETR | two copies of engine ${best.version} differ; using the more recently synced one (${best.base}). Bump VERSION when the engine changes.`);
      this._engine = best.create(best.base);
    }
    await this._engine.ready();
    return this._engine;
  },
  get version() { return this._engine?.version ?? null; }
});

function cmpVer(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for ( let i = 0; i < 3; i++ ) if ( (pa[i] || 0) !== (pb[i] || 0) ) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

const BASE = new URL("./", import.meta.url).href;
if ( !REG.copies.some((c) => c.base === BASE) ) {
  REG.copies.push({ version: VERSION, stamp: STAMP, base: BASE, create: createEngine, tools });
  if ( REG._engine && cmpVer(VERSION, REG._engine.version) > 0 ) console.warn(`LETR | engine ${VERSION} registered after ${REG._engine.version} was already in use; it is used after a reload`);
}

/* v5 tools (settings, authoring, networking, accessibility, windows): registered once at init by the newest copy (same order as the
   engine: VERSION, then the more recently synced copy) */
if ( !REG.toolsHooked && globalThis.Hooks?.once ) {
  REG.toolsHooked = true;
  Hooks.once("init", () => {
    const best = REG.copies.filter((c) => c.tools).sort((a, b) => cmpVer(b.version, a.version) || String(b.stamp?.at ?? "").localeCompare(String(a.stamp?.at ?? "")))[0];
    try { best?.tools.init(REG); } catch ( e ) { console.warn("LETR | tools not registered", e); }
  });
}

/* the shared engine, ready to play (fonts loaded) */
export function letters() { return REG.engine(); }
export { VERSION };
