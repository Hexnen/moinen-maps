import { MODULE_ID } from "./config.mjs";
import { warmPrograms } from "./gl-warm.mjs";
import { installSharpBatch } from "./destruction/sharp-batch.mjs";
import { maskedProgram } from "./destruction/masked-map.mjs";
import { sharpTileProgram } from "./destruction/static-cache.mjs";

/**
 * WARM-UP DURING THE SCENE LOAD (perf-arrival, 2026-11-09): GPU work the FIRST FRAME of a scene used to do, started while the scene still
 * loads - from canvasInit to canvasReady most of the load is the main thread waiting (texture downloads and decodes, the layers' chunk
 * workers), and the frame after canvasReady is the one the Director's arrival card and every player wait for.
 *
 *  1. PROGRAMS: the damage layer's own programs (the sharp batch, the map patch, the band tiles) were compiled and linked by the first
 *     frame that drew damage: ~0.1 s of that frame with a warm program cache, 2-4 s on a program-cache miss (the 16-texture sharp batch
 *     shader). Now they are linked in the background from canvasInit (gl-warm.mjs warmPrograms: KHR_parallel_shader_compile, then PIXI's
 *     own compile of each, a cache hit, one per poll step) - the same programs, compiled once per page as before, only earlier.
 *  (TEXTURES were tried too - the scene's images sent to the GPU between Foundry's texture load and canvasReady - and dropped: the map
 *  image is the last one to load and the layers' draw plus the canvasReady handlers follow it in ONE task, so there is no gap to use;
 *  the upload stays in the first frame, Foundry's own cost. dev/perf-arrival.md.)
 * Nothing drawn changes: the same programs exist at the first frame, they are just linked already. `CONFIG.moinenMaps.loadWarm = false`
 * turns it off (A/B).
 */

let job = 0;
const off = () => globalThis.CONFIG?.moinenMaps?.loadWarm === false;
export const stats = { programs: 0, warmMs: 0 };

/** The damage layer's programs (compiled by the first frame that draws damage). */
function damagePrograms(renderer) {
  const out = [];
  try { const sb = installSharpBatch(renderer); if ( sb?._shader?.program ) out.push(sb._shader.program); } catch { /* compiled on first use */ }
  try { out.push(maskedProgram()); } catch { /* compiled on first use */ }
  try { out.push(sharpTileProgram()); } catch { /* compiled on first use */ }
  return out;
}

function warmProgramsFor(scene, my) {
  const r = canvas.app?.renderer; if ( !r?.gl ) return;
  // (only where the damage layer will draw: a scene with damage painted)
  if ( !scene?.flags?.[MODULE_ID]?.destruction ) return;
  const list = damagePrograms(r).filter((p) => !p.glPrograms?.[r.CONTEXT_UID]);
  if ( !list.length ) return;
  const t0 = performance.now();
  // (live while this scene loads or shows: a program left half-warm is compiled by its first use, as before)
  warmPrograms(list, () => my === job).then(() => { stats.programs += list.length; stats.warmMs += performance.now() - t0; }).catch(() => {});
}

export function registerLoadWarm() {
  Hooks.on("canvasInit", (c) => {
    const my = ++job;
    if ( off() ) return;
    try { warmProgramsFor(c.scene, my); } catch ( err ) { console.warn(`${MODULE_ID} | load warm-up (programs)`, err); }
  });
  Hooks.on("canvasTearDown", () => { job++; });
}
