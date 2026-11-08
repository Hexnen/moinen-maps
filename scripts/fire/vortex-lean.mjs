import { vortexWindAt, vortices, SPEED_SQ } from "../wind.mjs";

/**
 * A TORNADO NEAR FIRE (owned by the weather layer, kept out of the fire style's own files): the flames bend toward and swirl with it,
 * smoothly, with inertia, and the flames in front of its foot are drawn over it.
 *
 * LEAN: only the art pass's `uLean` (the tongues' lean per cell of height; the smoke leans with it). The area's `uWind` is NOT
 * touched: the art and fuel passes scroll their noise by uWind x the shader time (hundreds of seconds), so any change of it slides the
 * whole fuel map - the "jumping" fire of 2026-11-08 (glow steps 10 x the calm fire's). The target is the tornado's wind averaged over
 * the points the area burns along (its strokes, <= 9: an area the core crosses swings through, never flips at one sample), softly capped (tanh),
 * and the lean follows it as a critically damped spring (~0.5 s): it eases in, swings through as the core passes and recovers
 * gradually after it, never in a step. Back exactly to the area's own lean when the tornado has gone and the spring has settled.
 *
 * DEPTH: each tornado's foot is handed to the area as one more depth rect (as a token's: art.mjs FRONT), so the flames whose bed lies
 * in front of the foot move to the front layer; while a tornado is near, the display's front layer sorts just above the tornado
 * (sortLayer 994: the tornado is drawn at 993). Flames behind the foot stay under it. Cost: a few uniforms per area per frame while a
 * tornado exists; nothing at all without one.
 */
const OMEGA = 2 * Math.PI / 1.6;     // the spring: settles in ~0.5 s, no overshoot
const LEAN_MAX = 0.62;               // the tornado's own lean at most (cells per cell of height): flattened, never past the art's reach
const LEAN_K = 1.0;                  // lean per scene-wind unit (SPEED_SQ squares / s = 1)
const V_MAX = 0.4;                   // the lean's fastest swing (per s): at 12 art frames / s at most 0.033 a frame
export const FRONT_LAYER = 994;      // the front flames over a tornado (tornado.mjs show: 993)

/** Where an area burns (scene px): up to 9 points along its strokes (made once per area). */
function burnPoints(a, geo) {
  if ( a.vxPts && a.vxFor === a.area ) return a.vxPts;
  a.vxFor = a.area;
  const all = [];
  for ( const st of a.area.strokes ?? [] ) { const p = st.p ?? []; for ( let i = 0; i + 1 < p.length; i += 2 ) all.push([p[i], p[i + 1]]); }
  if ( !all.length ) { const r = a.area.rect; all.push([geo.ox + (r.x0 + r.x1) / 2 * geo.ap, geo.oy + (r.y0 + r.y1) / 2 * geo.ap]); }
  const step = Math.max(1, Math.ceil(all.length / 9));
  return a.vxPts = all.filter((_, i) => i % step === 0);
}
/** The target lean offset of an area now: the tornado wind where it burns (the mean over its stroke points), softly capped. */
function target(a, geo) {
  const pts = burnPoints(a, geo);
  let sx = 0;
  for ( const [x, y] of pts ) sx += vortexWindAt(x, y, geo.grid)[0];
  const w = sx / pts.length / SPEED_SQ;
  return LEAN_MAX * Math.tanh(LEAN_K * w / LEAN_MAX);
}

/** Every frame per visible art area: ease its lean toward the tornado's pull (`dt` s). Returns true while it is still moving. */
export function leanToVortices(a, geo, any, dt) {
  const u = a.mesh.pass?.shader?.uniforms; if ( !u ) return false;
  if ( !any && !a.vx ) return false;
  const s = a.vx ??= { x: 0, v: 0, lean0: u.uLean };
  const tx = any ? target(a, geo) : 0, h = Math.min(0.1, Math.max(0, dt));
  // semi-implicit critically damped spring (stable at any frame rate up to the 0.1 s clamp)
  s.v += (OMEGA * OMEGA * (tx - s.x) - 2 * OMEGA * s.v) * h;
  s.v = Math.max(-V_MAX, Math.min(V_MAX, s.v));   // (a swing through the core: never faster than this)
  s.x += s.v * h;
  u.uLean = s.lean0 + s.x;
  if ( !any && Math.abs(s.x) < 1e-4 && Math.abs(s.v) < 1e-4 ) { u.uLean = s.lean0; a.vx = null; return false; }
  return true;
}

/**
 * The tornado feet as depth rects ([x0, y0, x1, feet], scene px) for the fire's FRONT layer: the foot and the low funnel, from a
 * little above the ground up the column's lower part, as wide as the debris cloud. [] without a tornado.
 */
export function tornadoFeet(grid) {
  const out = [];
  for ( const v of vortices() ) {
    if ( !(v.p > 0.05) ) continue;
    const x = v.x * grid, y = v.y * grid, hw = Math.max(1.2, 2.2 * v.r0) * grid, up = 5 * grid;
    out.push([x - hw, y - up, x + hw, y]);
  }
  return out;
}
