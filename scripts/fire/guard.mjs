/**
 * The fire's detail under the ADAPTIVE GUARD (2026-11-09): the client's one frame guard (scripts/frame-guard.mjs: the display's real
 * vsync, late frames judged per display rate, steps down with a wait, recovery under background noise, no pumping; the weather follows
 * the same guard) gives a continuous q in [GUARD.qMin 0.35, 1]; the fire maps it to its own level f = 0.2 .. 1 and every part follows f
 * smoothly:
 *  - budget = f: the art cells drawn per display frame (a new 12 fps art frame lands a little later as it falls: the picture stays);
 *  - parts: the share of the particles (the highest slots drop out one by one, f under 0.4);
 *  - fps6: the art at 6 fps instead of 12, near the floor only (on under f 0.32, off again over 0.36: never flickers at one level).
 * (It replaces the fire's own guard of 4 fixed levels, which judged frames against the 20th percentile of its own intervals - an
 * estimate that climbs under the overload - never came back with a few % of background late frames, counted a missed vsync under
 * Foundry's 60 fps cap at 165 Hz as on time, and fell a level a second to the floor: dev/fire-guard.test.mjs.)
 */
import { GUARD } from "../frame-guard.mjs";

export const F_MIN = 0.2;
/** The fire's level for guard q: 1 at q 1, F_MIN at the guard's floor. */
export const fireLevel = (q) => Math.min(1, Math.max(F_MIN, F_MIN + (q - GUARD.qMin) * (1 - F_MIN) / (1 - GUARD.qMin)));

/** The fire's detail at guard q into `out` ({ budget, fps6, parts }; out.fps6 = what it was, for the hysteresis). No garbage. */
export function fireDetail(q, out = { budget: 1, fps6: false, parts: 1 }) {
  const f = fireLevel(q);
  out.budget = f;
  out.parts = Math.min(1, Math.max(0, (f - 0.2) / 0.2));
  out.fps6 = out.fps6 ? f < 0.36 : f < 0.32;
  return out;
}

/** The old guard's level number for a q (stats / tools that print a level: 0 = full). */
export const levelOf = (q) => { const f = fireLevel(q); return f >= 0.999 ? 0 : f > 0.5 ? 1 : f > 0.3 ? 2 : 3; };
