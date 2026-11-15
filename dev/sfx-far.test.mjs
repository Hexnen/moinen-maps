// MAPRIDE (far thunder on every seat): a far flash is lettered on every second far flash of the storm, numbered the same on every seat.
// Live 2026-11-15 a far rumble right after the storm was cleared was lettered on the GM's seat only. Cause: the far flashes were counted
// "since the storm's switch-on" - from the stored storm's change time `S.t` - so a GM change (the switch-off, a rate tweak) restarted
// the count at once on the GM's seat (his own write) and a moment later on a player's; a flash polled in between was numbered
// differently on the two seats. Now (sfx-events farIndex) the count runs inside fixed windows of FAR_WIN slots on the shared clock and
// reads only the storm model's own flashes there, which a change keeps for the slots before it (storm-model withChange keeps `prev`).
//   OLD   the previous count (f1d9491 sfx.mjs farBefore, replicated) numbers flashes before a switch-off differently on a seat that has
//         the switch-off and one that has not yet (fails before)
//   NEW   farIndex numbers every flash before the change the same on both, for switch-offs and rate / closeness changes at many instants
//   RULE  inside a window every second far flash is lettered (the owner's answer 7), deterministic
import * as EV from "../scripts/sfx/sfx-events.mjs";
import * as C from "../scripts/sfx/sfx-core.mjs";
import * as SM from "../scripts/weather/storm-model.mjs";

let failed = 0, passed = 0;
const ok = (c, m) => { if ( c ) passed++; else { failed++; console.log(`  FAIL ${m}`); } if ( process.env.FAR_VERBOSE ) console.log(`  ${c ? "ok" : "FAIL"} ${m}`); };
const rainP = () => 1, seed = 0x5eed;
const isFarOf = (S) => (j) => SM.flashOf(S, seed, j, rainP)?.kind === "far";
// (f1d9491 sfx.mjs farBefore: the count from the stored storm's change slot, older slots by a hash parity)
function oldFar(S, k) {
  const k0 = Math.max(Math.floor(S.t / SM.SLOT), k - EV.FAR_SCAN);
  if ( k < k0 ) return C.hashStr(String(k)) & 1;
  let n = 0;
  for ( let j = k0; j < k; j++ ) if ( isFarOf(S)(j) ) n++;
  return n;
}
const newFar = (S, k) => EV.farIndex(k, isFarOf(S));
const lettered = (S, k, f) => EV.farLettered({ k }, (kk) => f(S, kk));

// the storms: switched on at t0, then a change at tc (the seat that has it: S2; the seat that has not yet: S1)
const t0 = 1_700_000_000_000, on = SM.withChange(null, { on: true, rate: 30, near: 0.1 }, t0);
const cases = [];
for ( let i = 0; i < 24; i++ ) {
  const tc = t0 + 60_000 + i * 37_123;
  for ( const patch of [{ on: false }, { rate: 12 }, { near: 0.6 }] ) cases.push({ tc, patch, S1: on, S2: SM.withChange(on, patch, tc) });
}
let oldDiff = 0, newDiff = 0, flashes = 0, ex = "";
for ( const { tc, patch, S1, S2 } of cases ) {
  const kc = Math.floor(tc / SM.SLOT);
  // (the far flashes polled just before the change took effect: the poll looks 3 s ahead, the far word is due 1.2-2 s after its flash)
  for ( let k = kc - 12; k < kc; k++ ) {
    const ev = SM.flashOf(S2, seed, k, rainP);
    if ( ev?.kind !== "far" || ev.t >= S2.t ) continue;
    flashes++;
    if ( lettered(S1, k, oldFar) !== lettered(S2, k, oldFar) ) { oldDiff++; ex ||= `${JSON.stringify(patch)} slot ${k - kc}`; }
    if ( lettered(S1, k, newFar) !== lettered(S2, k, newFar) ) newDiff++;
  }
}
ok(flashes > 20, `the switch-offs and changes have far flashes just before them (${flashes})`);
ok(oldDiff > 0, `OLD: the previous count letters a far flash before a change on one seat only (${oldDiff} of ${flashes}; e.g. ${ex})`);
ok(newDiff === 0, `NEW: every far flash before a change lettered alike on a seat that has the change and one that has not yet (${newDiff} of ${flashes})`);
// (a seat that joins later - its storm's change time is its own fetch - numbers the same: the count reads only the slots)
const late = { ...on, t: on.t + 4321 };
let lateDiff = 0, n = 0;
for ( let k = Math.floor(t0 / SM.SLOT) + 10; k < Math.floor(t0 / SM.SLOT) + 400; k++ ) if ( isFarOf(on)(k) ) { n++; if ( lettered(on, k, newFar) !== lettered(late, k, newFar) ) lateDiff++; }
ok(n > 30 && lateDiff === 0, `NEW: numbered the same however the seat's stored time differs (${lateDiff} of ${n})`);
// RULE: inside one window the far flashes alternate (every second one lettered), and the same twice
let alt = true, wins = 0;
for ( let w = 0; w < 20; w++ ) {
  const k0 = (Math.floor(t0 / SM.SLOT / EV.FAR_WIN) + 3 + w) * EV.FAR_WIN, ks = [];
  for ( let k = k0; k < k0 + EV.FAR_WIN; k++ ) if ( isFarOf(on)(k) ) ks.push(k);
  if ( ks.length < 2 ) continue;
  wins++;
  ks.forEach((k, i) => { if ( lettered(on, k, newFar) !== (i % 2 === 1) ) alt = false; });
}
ok(wins > 5 && alt, `RULE: inside each window every second far flash is lettered (${wins} windows)`);
ok(EV.farLettered({ preview: true, k: 3 }, () => 0), "RULE: a preview flash is always lettered");
console.log(`sfx-far: ${failed ? `${failed} failed, ` : ""}${passed} checks passed`);
process.exit(failed ? 1 : 0);
