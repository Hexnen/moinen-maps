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
import * as tools from "./tools.mjs";

const REG = (globalThis.MoinenLetters ??= {
  copies: [],
  _engine: null,
  /* the newest registered copy; created once, on first use */
  async engine() {
    if ( !this._engine ) {
      const best = this.copies.slice().sort((a, b) => cmpVer(b.version, a.version))[0];
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
if ( !REG.copies.some((c) => c.base === BASE) ) REG.copies.push({ version: VERSION, base: BASE, create: createEngine, tools });

/* v5 tools (settings, authoring, networking, accessibility, windows): registered once at init by the newest copy */
if ( !REG.toolsHooked && globalThis.Hooks?.once ) {
  REG.toolsHooked = true;
  Hooks.once("init", () => {
    const best = REG.copies.filter((c) => c.tools).sort((a, b) => cmpVer(b.version, a.version))[0];
    try { best?.tools.init(REG); } catch ( e ) { console.warn("LETR | tools not registered", e); }
  });
}

/* the shared engine, ready to play (fonts loaded) */
export function letters() { return REG.engine(); }
export { VERSION };
