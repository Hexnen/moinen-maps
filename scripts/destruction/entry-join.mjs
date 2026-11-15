/**
 * MAPSEATS3 (ADVM r2 item 3): when a seat starts the entry of a stroke it learns of from the scene flag.
 *
 * A stroke the GM paints by hand enters on the GM's screen the moment it is baked; everybody else learns of it from the flag, whose
 * entry `t` is the publish moment + 700 ms. Before, every other seat started the entry at `t` - about a second after the GM - and the
 * stroke's words (sfx onEntry: the entry's start is the words' instant) with it: a different picture at the same moment.
 * Now the GM's entry also carries his own instant `s`; a seat that has the stroke in time (its `t` at most JOIN_LATE_MS past) joins
 * that entry where the GM's is now: its start lies in the past, the pixels and the words are mid-life, the same frame on every seat.
 * A late arrival (a reload, a seat that was slow by more than JOIN_LATE_MS) still sees the entry whole from now, as before.
 * Pure: node tests (dev/sfx-seats3.test.mjs) and destruction.mjs share it.
 */
import { ageOf } from "../shared-clock.mjs";

export const JOIN_LATE_MS = 1500;

/**
 * The entry's start on this seat (performance.now() time; may lie in the past), or null when it is too old to enter (shown settled).
 * `e` the flag's entry { t, s? }, `sNow` / `pNow` this seat's shared and performance clocks read together, `window` the oldest entry
 * that still plays (ms).
 */
export function entryStart(e, sNow, pNow, window) {
  const age = ageOf(e?.t, sNow);
  if ( !(age <= window) ) return null;
  if ( Number.isFinite(e.s) && age <= JOIN_LATE_MS ) {
    const as = ageOf(e.s, sNow);
    if ( Number.isFinite(as) ) return pNow - Math.max(0, as);
  }
  return pNow + Math.max(0, -age);
}
