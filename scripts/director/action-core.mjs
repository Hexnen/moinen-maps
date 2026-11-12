/**
 * THE ACTION CAMERA OF A DRIVEN FIGHT, the pure parts (no Foundry; node: dev/director-action.test.mjs). The Foundry side is
 * source-stage.mjs `shot()`; the contract is dev/zones-api.md section 39.
 *
 * A combat module that drives a fight names WHAT HAPPENED on this client (a beat of an exchange, with the tokens this user is shown);
 * the director decides HOW it is shot. The beats of one exchange (one `key`) are one piece of staging:
 *
 *   open     somebody acts on somebody: the camera goes to the pair (in place when both stand comfortably on screen) and WAITS there
 *            for the result, the "My view" chip standing by; the bars only when the stage's setting says "every attack"
 *   hit      the blow lands: the bars and the vignette, the flash and the shake, a hold on the result, then the view goes back
 *   miss     no bars, no flash: a short hold, then back
 *   kill     the target is out: the bars, the strong flash and shake, a slow push toward it, a longer hold, then back
 *   reveal   somebody came into this user's view of the fight: the camera goes there with the bars, holds, goes back
 *   move     somebody walks: the camera goes to the token and follows it until it stands, then back (no bars)
 *   close    the exchange is over: a camera still waiting for a result goes back
 *
 * The view ALWAYS goes back to where the user had it (place and zoom) unless the user took the camera meanwhile; a shot never
 * plays over the user's hand (shotGate), and a beat marked `still` (the user has a question to answer) plays its effects in place
 * and moves nothing.
 */
import { clamp, comfortable, attackCamera, ZOOM_BAND } from "./stage-core.mjs";

export const BEATS = Object.freeze(["open", "hit", "miss", "kill", "reveal", "move", "close"]);
/** Which beat wins when two of one exchange come together (a hit and the kill it made). */
export const RANK = Object.freeze({ open: 0, move: 0, reveal: 1, miss: 2, hit: 3, kill: 4 });
/**
 * Times, ms. lead: the glide to the subject (x 0.8 .. 1.9 by the way); hold: on the result, by beat; back: the way home; cut: the way
 * home after Esc / a click; rest: how long a camera waits at the pair for a result before it goes home by itself; inPlace: bars
 * and blow of a beat that moves nothing; push: the slow push-in of a kill (x the zoom).
 */
export const TIMES = Object.freeze({ lead: 520, back: 640, cut: 420, rest: 12000, inPlace: 160, push: 1.06,
  hold: Object.freeze({ open: 500, hit: 1300, miss: 900, kill: 2100, reveal: 1700, move: 500 }) });

/**
 * May a shot play on this client now? null (yes) or the reason it may not:
 *   "off"     the user's switch says never;       "level"  the user's switch is not on the action camera;
 *   "held"    another module holds the camera;    "busy"   a show or a take-over of the map itself has the screen;
 *   "covered" a window covers the map;            "hand"   the user's hand is on the map, moved the camera a moment ago (`backMs`),
 *                                                          or cut a shot / asked for their view back this turn.
 */
export function shotGate(st, { follow = "all", now = 0, backMs = 5000, busy = false, held = false, screen = false, covered = false } = {}) {
  if ( follow === "off" ) return "off";
  if ( follow !== "action" ) return "level";
  if ( held ) return "held";
  if ( screen ) return "busy";
  if ( covered ) return "covered";
  if ( busy ) return "hand";
  if ( st?.out && st.out === st.turn ) return "hand";
  if ( now - (st?.ownAt ?? -Infinity) < backMs ) return "hand";
  return null;
}

/**
 * How a beat is played. `bars` = the stage's letterbox setting ("hits" | "attacks" | "never"); `away` = the camera is (or will be)
 * away from the user's view for this beat (it moved, or it waited at the pair); `still` = effects only.
 * -> { bars (slide in with the beat), impact (0 none, 1 a hit, 2 a kill), hold (ms on the result), back (the view goes home after),
 *      rest (the camera waits where it is for the result), follow (the camera follows the focus while it walks), push (a kill's push-in:
 *      only when the camera is away anyway, so a blow in place never changes the user's zoom) }
 */
export function beatPlan(beat, { bars = "hits", away = false, still = false, reduced = false } = {}) {
  const hold = TIMES.hold[beat] ?? 0, no = bars === "never";
  switch ( beat ) {
    case "open": return { bars: bars === "attacks", impact: 0, hold, back: false, rest: away && !still, follow: false, push: false };
    case "hit": return { bars: !no, impact: 1, hold, back: away, rest: false, follow: false, push: false };
    case "miss": return { bars: bars === "attacks", impact: 0, hold, back: away, rest: false, follow: false, push: false };
    case "kill": return { bars: !no, impact: 2, hold, back: away, rest: false, follow: false, push: away && !still && !reduced };
    case "reveal": return { bars: !no, impact: 0, hold, back: away, rest: false, follow: false, push: false };
    case "move": return { bars: false, impact: 0, hold, back: away, rest: false, follow: !still, push: false };
    default: return null;
  }
}

const union = (a, b) => (!a ? b : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const okBox = (b) => !!b && [b.x0, b.y0, b.x1, b.y1].every(Number.isFinite) && b.x1 >= b.x0 && b.y1 >= b.y0;

/**
 * Where the camera of a beat goes for `boxes` (scene boxes as THIS client is shown them, the focus first): null = it plays in place
 * (everything named stands comfortably in the free part of the screen), else { x, y, scale, ms }: a view within the zoom band of the
 * user's own zoom `base` (the zoom on screen when that holds them; under reduced motion the zoom never changes) that holds them all
 * when they fit, else the focus whole with the frame leaning toward the rest.
 */
export function shotCamera(boxes, view, rect, { base = null, reduced = false, lead = TIMES.lead } = {}) {
  const list = (Array.isArray(boxes) ? boxes : []).filter(okBox);
  if ( !list.length || !view || !rect || !(view.scale > 0) ) return null;
  const all = list.reduce(union, null), b = reduced || !(base > 0) ? view.scale : base;
  const c = attackCamera(all, list[0], view, rect, b, reduced ? [1, 1] : ZOOM_BAND);
  if ( !c ) return null;
  const screens = Math.hypot(c.x - view.x, c.y - view.y) * view.scale / Math.max(1, Math.hypot(view.vw, view.vh));
  return { x: c.x, y: c.y, scale: reduced ? view.scale : c.scale, ms: Math.round(clamp(lead * (0.8 + 0.9 * screens), lead * 0.8, lead * 1.9)) };
}
/** Is the focus on this user's screen (a `still` beat plays only then: it moves nothing, so there must be something to see). */
export const inSight = (box, view, rect) => okBox(box) && comfortable(box, view, rect, 0);

/** The slow push of a kill: toward the focus, a little closer, kept inside the canvas zoom limits. */
export function pushCamera(focus, view, limits = [0.1, 3], k = TIMES.push) {
  if ( !okBox(focus) || !view ) return null;
  const fx = (focus.x0 + focus.x1) / 2, fy = (focus.y0 + focus.y1) / 2;
  const scale = clamp(view.scale * k, limits[0], limits[1]);
  return { x: view.x + (fx - view.x) * 0.35, y: view.y + (fy - view.y) * 0.35, scale };
}
