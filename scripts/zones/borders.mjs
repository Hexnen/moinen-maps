/**
 * The border model (pure, no Foundry): a border between two zones is open, or a WALL with an optional DOOR; the wall and the door
 * each have their own Armor and their own state (combat-plan 5.7 items 1-4).
 *
 *  - Invincible core book: a border is open or blocked, a blocked border can have a door (book-dump 2254); the Armor of doors and
 *    walls is the table after 2405 (interior door 1, interior wall 2, exterior door 2, exterior wall 3, reinforced door / wall 4+);
 *    an unlocked door does not affect movement, a locked one is breached, an electronically sealed one is opened (2418); a wall or
 *    a door can be crashed through (2419). What a breach takes and what it does to the one breaching is the combat module's.
 *  - What is BUILT (the map maker's border: the wall, its Armor, whether it is a building's exterior wall, the door, its Armor and
 *    the state it is built in) is kept apart from what happened to it IN PLAY (the wall breached or removed, the door opened,
 *    locked, sealed, breached). Putting a border back as built is dropping its play record: a GM action, never automatic.
 *  - The older marks named one kind per border (door, locked, wall, outer, reinforced: marks.mjs). They are still what the flag
 *    stores for a plain border and read as this model without a write:
 *        door        wall 2 (interior) + door Armor 1, closed (unlocked)
 *        locked      wall 2 (interior) + door Armor 2, locked           (the Armor the old mark gave a locked door)
 *        wall        wall 2            outer: wall 3, a building's exterior wall            reinforced: wall 4
 *    The Armor of the wall around an old door mark is our reading (the old mark had one Armor for the whole border).
 *
 * A border as the rest of the module sees it (model()):
 *   { base, wall: { armor, state, outer, temp } | null, door: { armor, state, built } | null, kind, armor, look, stops: { walk, air, through } }
 *   base    the stored kind (what the GM's menu shows)
 *   wall    state: "intact" | "breached" | "removed"; outer: a building's exterior wall (flyers pass over it); temp: removed for a
 *           while (the one who removed it says so; nothing here puts it back)
 *   door    state: "open" | "closed" (unlocked) | "locked" | "sealed" (electronically) | "breached"; built: the state it was built in
 *   kind    what the border amounts to NOW in the older terms, for everything written before this model: "open" (no intact wall),
 *           "door" (a door one can pass), "locked" (a door one cannot), "wall" | "outer" | "reinforced"
 *   armor   what a breach of it has to beat now: the door's where there is one, else the wall's, 0 when open
 *   look    how the wall is drawn: "wall" | "outer" | "reinforced"
 *   stops   whom it stops now: walking (an intact wall without a passable door), over the top (the same unless it is an exterior
 *           wall: book-dump 2385, flyers pass over buildings), through (burrowing, teleportation: never)
 */

export const WALL_STATES = ["intact", "breached", "removed"];
export const DOOR_STATES = ["open", "closed", "locked", "sealed", "breached"];
/** The states a door can be built in (a breached door is something that happened). */
export const DOOR_BUILT = ["open", "closed", "locked", "sealed"];
export const ARMOR_MAX = 99;

/** The older one-kind marks as walls and doors (see above). */
export const KINDS = {
  door: { wall: { armor: 2, outer: false }, door: { armor: 1, state: "closed" } },
  locked: { wall: { armor: 2, outer: false }, door: { armor: 2, state: "locked" } },
  wall: { wall: { armor: 2, outer: false }, door: null },
  outer: { wall: { armor: 3, outer: true }, door: null },
  reinforced: { wall: { armor: 4, outer: false }, door: null }
};

const armorOf = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(ARMOR_MAX, n) : null; };
/** The Armor of a door put into a wall that was built without one (the table after book-dump 2405). */
export const doorArmorFor = (wall) => (wall.armor >= 4 ? wall.armor : wall.outer ? 2 : 1);
/** How a wall is drawn (and what the older terms call it). */
export const lookOf = (wall) => (wall.outer ? "outer" : wall.armor >= 4 ? "reinforced" : "wall");

/**
 * What a border mark stores beside its kind, cleaned: { wall?: { armor?, outer? }, door?: null | { armor?, state? } } - only what
 * differs from the kind; null when nothing does.
 */
export function cleanExt(kind, ext) {
  const K = KINDS[kind];
  if ( !K || !ext || typeof ext !== "object" ) return null;
  const out = {};
  if ( ext.wall && typeof ext.wall === "object" ) {
    const w = {}, a = armorOf(ext.wall.armor);
    if ( a != null && a !== K.wall.armor ) w.armor = a;
    if ( typeof ext.wall.outer === "boolean" && ext.wall.outer !== K.wall.outer ) w.outer = ext.wall.outer;
    if ( Object.keys(w).length ) out.wall = w;
  }
  if ( "door" in ext ) {
    if ( !ext.door ) { if ( K.door ) out.door = null; }
    else if ( typeof ext.door === "object" ) {
      const wall = { ...K.wall, ...(out.wall ?? {}) }, base = K.door ?? { armor: doorArmorFor(wall), state: "closed" };
      const d = {}, a = armorOf(ext.door.armor);
      if ( a != null && a !== base.armor ) d.armor = a;
      if ( DOOR_BUILT.includes(ext.door.state) && ext.door.state !== base.state ) d.state = ext.door.state;
      if ( Object.keys(d).length || !K.door ) out.door = d;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** What happened to a border in play, cleaned: { w?: "breached" | "removed", t?: 1 (removed for a while), d?: door state }; null: nothing. */
export function cleanPlay(p) {
  if ( !p || typeof p !== "object" ) return null;
  const out = {};
  if ( p.w === "breached" || p.w === "removed" ) { out.w = p.w; if ( p.w === "removed" && (p.t === 1 || p.t === true) ) out.t = 1; }
  if ( DOOR_STATES.includes(p.d) ) out.d = p.d;
  return Object.keys(out).length ? out : null;
}

/** The border as built: { wall: { armor, outer }, door: { armor, state } | null } (null: no such kind). */
export function built(kind, ext = null) {
  const K = KINDS[kind];
  if ( !K ) return null;
  const e = cleanExt(kind, ext) ?? {};
  const wall = { ...K.wall, ...(e.wall ?? {}) };
  let door = K.door ? { ...K.door } : null;
  if ( "door" in e ) door = e.door ? { ...(K.door ?? { armor: doorArmorFor(wall), state: "closed" }), ...e.door } : null;
  return { wall, door };
}

const PASSABLE = new Set(["open", "closed", "breached"]);
/** Whether a door in this state lets one through (book-dump 2418: an unlocked door does not affect movement). */
export const doorPasses = (state) => PASSABLE.has(state);

/** The border as it is now: what was built with what happened to it in play (see the top of the file). null: no such kind. */
export function model(kind, ext = null, play = null) {
  const B = built(kind, ext);
  if ( !B ) return null;
  const p = cleanPlay(play) ?? {};
  const wall = { armor: B.wall.armor, state: p.w ?? "intact", outer: B.wall.outer, temp: p.t === 1 };
  const door = B.door ? { armor: B.door.armor, state: p.d ?? B.door.state, built: B.door.state } : null;
  const standing = wall.state === "intact", passes = !standing || (!!door && doorPasses(door.state));
  const look = lookOf(wall);
  const eff = !standing ? "open" : door ? (passes ? "door" : "locked") : look;
  return {
    base: kind, wall, door, kind: eff, look,
    armor: !standing ? 0 : door ? door.armor : wall.armor,
    stops: { walk: !passes, air: !passes && !wall.outer, through: false }
  };
}

/** A border that was never marked: open. */
export const OPEN = Object.freeze({ base: "open", wall: null, door: null, kind: "open", look: null, armor: 0, stops: Object.freeze({ walk: false, air: false, through: false }) });

/** The play record of a model (what differs from the border as built); null: it is as built. */
export function playOf(m) {
  if ( !m?.wall ) return null;
  return cleanPlay({ w: m.wall.state === "intact" ? null : m.wall.state, t: m.wall.temp ? 1 : 0, d: m.door && m.door.state !== m.door.built ? m.door.state : null });
}

/**
 * Change a border's state in play: patch = { wall?: { state, temp }, door?: { state } }.
 * @returns {{ play: object|null } | { error: string }}   error: "noWall" (an open border has no state), "noDoor", "wallState", "doorState"
 */
export function patchPlay(m, patch = {}) {
  if ( !m?.wall ) return { error: "noWall" };
  let w = m.wall.state, t = m.wall.temp, d = m.door?.state ?? null;
  if ( patch.wall != null ) {
    if ( typeof patch.wall !== "object" ) return { error: "wallState" };
    if ( "state" in patch.wall ) { if ( !WALL_STATES.includes(patch.wall.state) ) return { error: "wallState" }; w = patch.wall.state; if ( !("temp" in patch.wall) ) t = false; }
    if ( "temp" in patch.wall ) t = patch.wall.temp === true;
  }
  if ( patch.door != null ) {
    if ( !m.door ) return { error: "noDoor" };
    if ( typeof patch.door !== "object" || !DOOR_STATES.includes(patch.door.state) ) return { error: "doorState" };
    d = patch.door.state;
  }
  return { play: cleanPlay({ w: w === "intact" ? null : w, t: t && w === "removed" ? 1 : 0, d: m.door && d !== m.door.built ? d : null }) };
}

/** The border in the shape the combat rules take (rules CONTRACT.md, "Zone graph"): { wall: null | { armor, state }, door: null | { armor, state } }. */
export const contractOf = (m) => ({
  wall: m?.wall ? { armor: m.wall.armor, state: m.wall.state } : null,
  door: m?.door ? { armor: m.door.armor, state: m.door.state } : null
});

/** A copy of the wall and the door for callers (never the module's own objects). */
export const partsOf = (m) => ({
  wall: m?.wall ? { ...m.wall } : null,
  door: m?.door ? { ...m.door } : null
});

/** One string that changes whenever anything about the border does. */
export const sigOf = (m) => (m?.wall ? `${m.base}/${m.wall.armor}${m.wall.outer ? "o" : ""}${m.wall.state}${m.wall.temp ? "t" : ""}/${m.door ? `${m.door.armor}${m.door.state}${m.door.built}` : "-"}` : "open");

/**
 * What is drawn for a border (display.mjs): the wall's look and how much of it stands, the door's sign.
 *   { wall: "wall" | "outer" | "reinforced", wallState, temp, door: null | "open" | "closed" | "locked" | "sealed" | "breached" }
 * A wall that is not intact draws no door (there is nothing left to hold it).
 */
export function drawOf(m) {
  if ( !m?.wall ) return null;
  return { wall: m.look, wallState: m.wall.state, temp: m.wall.temp, door: m.door && m.wall.state === "intact" ? m.door.state : null };
}
