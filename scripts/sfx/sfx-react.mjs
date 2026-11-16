/* MAPSWITCH: the Tokens tab's lettering switch and size also govern the WORDS OF TOKEN REACTIONS, which another module of the table
   draws when it is there (invincible-plus-ultra: the word and number at a token that is hit, hurt or knocked down). Pure: no Foundry
   (node-tested in dev/sfx-switch.test.mjs); sfx.mjs does the reading and writing.
   The owner asked for one switch and one slider for "the lettering of tokens" in the Tokens tab; at a table most words at tokens are
   those reactions, so a switch that left them up would not do what it says. That module keeps its own two table values (world
   settings, also shown in its own table window):
     tokenReactEnabled   Boolean                       <->  the tokens group's switch
     tokenReactSize      "small" | "normal" | "large"  <->  the tokens group's size 1 | 2 | 3
   No copy is kept of them here: the two pairs are held EQUAL by the GM seat that made a change (the map's pair changed: the reactions'
   follow; the reactions' pair changed, e.g. in that module's own window: the map's follows), each write made only where the value
   differs, so it settles after one pass. Without that module nothing is read or written and the group letters the map's own token
   words alone (a carried token ploughing through others). */

import { shownPair, pairWrites } from "./sfx-size.mjs";

/** the other module and its two world settings */
export const REACT = { module: "invincible-plus-ultra", on: "tokenReactEnabled", size: "tokenReactSize" };
/** its size names by the map's step (0 never reaches it: a group switched off is told by the switch) */
export const REACT_SIZE = [null, "small", "normal", "large"];
const STEP_OF = { small: 1, normal: 2, large: 3 };

/** the reactions' pair as the map's controls would show it: { on, size 1..3 } (an unknown size name: today's) */
export const pairOfReact = (r) => ({ on: r?.on !== false, size: STEP_OF[r?.size] ?? 2 });

/** The reactions' values to write so they say what the map's stored pair shows. `map` = { on, size } as the world holds them,
    `react` = { on, size } as that module holds them. -> { on?: boolean, size?: "small" | "normal" | "large" } (only what differs) */
export function toReact(map, react) {
  const m = shownPair(map?.on, map?.size), r = pairOfReact(react), out = {};
  if ( m.on !== r.on ) out.on = m.on;
  if ( m.size !== r.size ) out.size = REACT_SIZE[m.size];
  return out;
}
/** The map's values to write so its pair shows what the reactions hold (sfx-size pairWrites). -> { on?: boolean, size?: 1..3 } */
export function fromReact(react, map) {
  const r = pairOfReact(react), m = shownPair(map?.on, map?.size);
  // (a map pair that already SHOWS the same is left alone: a stored size 0 under an "on" switch shows off at today's size)
  if ( r.on === m.on && r.size === m.size ) return {};
  return pairWrites(map, r);
}
