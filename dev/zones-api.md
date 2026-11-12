# Zones API for a combat module

`game.modules.get("moinen-maps").api.zones` (the same object as before; everything that existed still works as it did).
This file describes what package M1 added for tactical combat: stable zone keys, places with levels, the two distances,
routes, borders and zones as data, and events. Pure parts: `scripts/zones/keys.mjs`, `scripts/zones/places.mjs`,
`scripts/zones/marks.mjs`; wiring: `scripts/zones/zones.mjs`. Tests: `dev/zones-keys.test.mjs`, `dev/zones-places.test.mjs`,
`dev/zones-api.test.mjs`.

Package M2 (sections 9-15) added: borders as a wall with an optional door, each with its own Armor and state; the zone-state
registry; temporary edges; a write path where every write returns its inverse; movement from a mover profile with a listener
asked before every step, group and forced moves, free spots, cost confirmation on a dragged token. Pure parts:
`scripts/zones/borders.mjs`, `scripts/zones/states.mjs`, `scripts/zones/moves.mjs`. Tests: `dev/zones-borders.test.mjs`,
`dev/zones-moves.test.mjs`, `dev/zones-play.test.mjs`.

The interface part (sections 17-21) added: highlights of zones and borders for chosen users, picking a zone by click, the
GM's editing of the wall-plus-door model, zone attributes, the registry and temporary edges in the menus and the Zones dock,
and a rules driver that turns the map's own fire round and wrecking numbers into display. Pure part:
`scripts/zones/highlight.mjs`; drawing: `scripts/zones/highlight-layer.mjs`; wiring: `scripts/zones/interact.mjs`; UI:
`scripts/zones/menu.mjs`, `scripts/zones/play-panel.mjs`. Test: `dev/zones-interact.test.mjs`.

The integration part (sections 22-24) added what the combat module's surfaces asked for: a zone's name as its badge shows it,
the free part of the screen (insets other interface parts declare, the stretch found by looking), a pick whose banner keeps
clear of what lies at the top and whose zones under a bar or off the screen can be brought into view, a forced chain straight
up or down, and moves that do not wait for an animation on a client that draws no frames. Pure parts:
`scripts/zones/view.mjs`, `scripts/zones/moves.mjs` (`riseChain`); tests: `dev/zones-view.test.mjs` and new sections of
`dev/zones-moves.test.mjs`, `dev/zones-play.test.mjs`, `dev/zones-interact.test.mjs`.

Package M3 (sections 25-35) moved interaction from panels onto the map: marks on tokens (in reach with a label, out of reach
dimmed with a reason, the one chosen, caught in an area, state chips, a bar, parts shown under the pointer), lines between
tokens, a move and an area previewed under the pointer and confirmed with one click, warnings, a menu at a token / door / wall /
zone, right clicks sensed, a player's armed intention shown to the GMs, one language of zones, the camera's follow mode, a GM's
free placement. Pure part: `scripts/zones/board-core.mjs`; drawing: `scripts/zones/board-layer.mjs`; wiring:
`scripts/zones/board.mjs`. Test: `dev/zones-board.test.mjs`.

The map **stores, reports and draws**. It computes no Invincible rule effect: what a state, a wall or a step does to a character
is the combat module's.

Book references are line numbers of `invincible-plus-ultra/dev/book-dump.txt`.

## 1. Stable zone keys

A zone's **id** (0, 1, 2, ...) is its place in the reading order of the map and changes whenever the GM redraws lines.
A zone's **key** (a string such as `z7`) does not. Store keys, never ids.

- A key is kept as an **anchor**: a point inside the zone, stored in the scene flag (`flags.moinen-maps.zones.k =
  [[key, x, y], ...]`, counter `kn`). The zone that contains the anchor carries the key, whatever its id is now.
- **Existing scenes migrate without a write.** A scene saved before keys has no anchors; every client then gives its
  zones the provisional keys `z1, z2, ...` in id order (so at first the key number equals the number shown on the map).
  The GM's first edit of the zones (a line, a wall, a zone mark, snap or smoothing) writes those same keys down as
  anchors before anything changes, and they are saved with the scene. Until then nothing new is stored, and the flag of
  an untouched scene encodes exactly as before.
- A zone **cut in two**: the half holding the anchor keeps the key, the other half gets a new key.
- Two zones **joined**: the older anchor names the zone. The other anchor stays stored and names its half again if the
  line comes back (undo, or redrawing it).
- A key is **never handed out twice** in a scene: the counter only grows and sleeping keys stay reserved.
- Keys match `[A-Za-z0-9_-]{1,24}`. `@` starts the reserved keys of the off-map areas, `|` joins two zone keys into a
  border key, `:` separates the level in a spot string.
- A **border key** is its two zone keys, sorted as strings, joined by `|`: `z2|z5`.

```
api.keyOf(id) -> key | null          api.idOf(key) -> id | -1          api.keys() -> [key, ...] in id order
api.version() -> number              grows with every change of the zones or their marks; a cache built on the
                                     answers below is good while it stays the same
```

Limits: a zone so thin that its label point does not read as inside it cannot be pinned and keeps a provisional key
(it may change at the next edit). Keys are per scene.

## 2. Places: a zone plus a level

Every call takes and returns **places**; every event carries them.

```
place = {
  zone,       // key of the zone | "@sky" | "@orbit" | "@dimension" | "@chase" | null (outside every zone)
  id,         // the zone's id now (-1 off the map or outside every zone)
  spot,       // the 3-D zone as one string: "z3", "z3:underground", "z3:elevated", "z3:f2", "@sky"
  area,       // null on the map | "sky" | "orbit" | "dimension" | "chase"
  level,      // "underground" | "ground" | "elevated" | "floor"   (null off the map)
  floor,      // 1..n on level "floor", else 0
  airborne,   // elevated and not standing on a rooftop
  roof,       // elevated and standing on the rooftop of a standing building
  below       // off the map only: key of the zone under the token's position on the map
}
```

- Two characters are **in the same zone** in the book's sense exactly when their `spot`s are equal. Everyone elevated in
  one horizontal zone shares a spot (2258); `roof` / `airborne` tell standing from flying inside it (plan 5.7 item 7).
- Elevated over a standing building is its rooftop unless the token is marked airborne; over open ground or a wrecked
  building (2457) it is airborne.
- A building with `floors` has the levels ground, floor 1..n, and the rooftop (elevated) above the top floor (2262,
  2419). A plain building is one zone with its rooftop one move up (2404).
- Off the map: sky high and orbit are one zone each and are removed from the map (2259, 2260). `dimension` and `chase`
  are the plan's (5.7 item 6), not the book's. `underground` as a level is where burrowing moves (1995); staying there is
  the plan's.
- Places are frozen objects; a token's place is cached until the token or the zones change.

Anything that names a place is accepted wherever a place is expected (`where` below):
a Token or TokenDocument, a key (`"z3"`), a spot string (`"z3:f2"`, `"@sky"`), a zone id (its ground level), a place,
`{ x, y, level?, floor?, airborne? }`, `{ zone, level?, floor?, area?, airborne? }`.

```
api.place(where) -> place | null                      null: an unknown key
api.placeAt(x, y, { level, floor, airborne }) -> place
api.zoneOfToken(token) -> place | null                null: a token of a scene that is not open; the place it was written
                                                      to (while a move plays, Foundry slides the document's own x / y through
                                                      other zones: those are not read)
api.tokensInZone(where, { anyLevel }) -> [{ token: TokenDocument, place }]
        a bare key or id: every level of the zone; a spot, a place or a token: that level only (the book's "same zone");
        anyLevel: true / false overrides. "@sky" etc.: everyone in that area.
        THE GROUND LEVEL: the spot string of a place on the ground is the bare key (`place.spot === "z3"`), so a ground spot
        handed on as a string asks for every level. To ask for the ground alone say it: `"z3:ground"` (accepted wherever a
        spot string is; `place("z3:ground").spot` is `"z3"`), a place, a token, or `{ anyLevel: false }`. The same holds for
        `zoneStates(where)` (section 10).
api.setLevel(token, { level, floor, airborne } | { area } | spotString) -> Promise
        changes the level only, never the position on the map (owners of the token). Flags written on the token:
        alt ("elevated" | "underground" | "sky" | "orbit" | "dimension" | "chase"), floor (1..n), air (true).
api.LEVELS, api.AREAS, api.WAYS, api.TAGS            the value lists
```

The older `altitude(doc)` / `setAltitude` / `floor` / `setFloor` / `altCost` keep working; `altitude()` reads the new
values `underground`, `dimension`, `chase` as `"ground"` (the HUD does not offer them).

## 3. The two distances

Book 2254-2255, plan rule 23: **range** counts the borders on the shortest route and a blocked border is still a border;
**movement** counts only routes the mover can take.

```
api.range(a, b) -> { borders, levels, total } | null
api.borderDistance(a, b) -> number | null             the horizontal count alone
api.route(a, b, way = "walk") -> { borders, levels, total } | null
api.distances(a, b) -> { range, walk, air, through, swim, swing }    totals, null = no way
api.zonesWithin(where, n, { way = "range" }) -> [{ zone, id, d }]     nearest first, horizontal borders only
```

`range`:
- `null` to or from an off-map area, `0` inside the same area (2259-2260); `null` when a place is outside every zone.
- `levels`: 0 between two elevated places (2258; plan rule 2); else the difference in height, where ground = 0,
  floor f = f, elevated = 1, and a rooftop counts the floors below it only when measured from inside its own building
  (from outside it is one zone up: 2419). Underground counts as -1: **our reading**, the book gives it no height.
- The rule "no attacks into or out of sky high / orbit" and what `levels` means for a given attack are the combat
  module's; this returns the components.

`route`, ways (as on the map's distance badges, `marks.mjs`):

| way | stopped by | notes |
|---|---|---|
| `walk` | wall, exterior wall, reinforced wall, locked door | climbs floors: `levels` |
| `air` | wall, reinforced wall, locked door | flight, leaping, super-speed: passes over exterior walls |
| `through` | nothing | burrowing, teleportation; the only way to or from `underground` |
| `swim` | as walk | only into water or flooded zones |
| `swing` | as air | can only end in a standing building or a zone with tall features |

- `levels` for walk / swim: the vertical zones climbed inside the buildings at both ends (a floor its number, a rooftop
  one above the top floor, 1 for a plain building: 2404, 2419). An airborne place cannot be walked to or from: land or
  fall first (a level change the caller makes).
- `levels` for air / swing / through: 0 when zones are crossed (ground and elevated change as part of the move: 2385),
  1 for a level change inside one zone. Leaving a floor by a window costs nothing: **our reading** (as the badges).
- `null` to or from an off-map area: that is one full action whatever the distance (2386-2387, `api.altCost`).

## 4. Path

```
api.path(a, b, { way = "walk" }) -> null | {
  way, total, borders, levels,
  zones:   [key, ...],          // every zone on the route, both ends included
  steps:   [ { kind: "border", from: spot, to: spot, zone: key (entered), level, floor, border },
             { kind: "level",  zone: key, from: spot, to: spot, level, floor } ],
  crossed: [border, ...]        // section 5; `over: true` where a flyer passes over a wall that stops walkers,
}                               // `blocked: true` on a "range" path where the border stops walkers
```

`way` is `"range"` or a way of moving. `steps.length === total`. Ties between equally short routes go through the
lowest zone id (the same on every client). Between its ends a route runs at the level its way of moving travels at:
walk / swim on the ground, air / swing elevated, through underground (for teleportation only the ends mean anything).
This is the chain a forced move or a charge can be laid along; the GM-editable chain and the step-by-step interception
are M2.

## 5. Borders and zones as data

```
api.borderBetween(a, b) -> null | {        // null: not neighbours (or the same zone)
  key: "z1|z2", zones: [key, key], ids: [id, id],
  kind: "open" | "door" | "locked" | "wall" | "outer" | "reinforced",   // what it amounts to NOW (section 9)
  armor,                                   // what a breach has to beat now: 0 open, door 1, locked 2, wall 2, outer 3, reinforced 4 (table after 2405)
  door: bool, stops: { walk, air, through }, length (px), x, y,   // the GM's mark, else the middle of the longest stretch
  base, wall, doorway                      // M2: the kind as built, the wall and the door with their own Armor and state (section 9)
}
api.bordersOf(where) -> [border, ...]

api.zone(where) -> null | {
  key, id, center: { x, y }, area (px²), neighbours: [key, ...],
  building, floors, rooftop,               // rooftop: a standing building, an elevated position to stand on
  terrain: "" | "office" | "warehouse" | "street" | "woods" | "building" | "cliffs" | "none",
  wreck: { can: true | false | null, strength, bonus, why: null | "wrecked" | "terrain" | "unset" },   // 2454-2457
  empty,                                   // nothing to trap someone under (2438)
  tags: [...],                             // "water", "tall" (the features) + stored: power, metal, plants,
                                           // throwables, flammable, vacuum, bystanders
  states: { wrecked, fire, dark, ice, flooded, lowgrav },
  records: [state, ...],                   // M2: every state as a record (section 10)
  props                                    // the raw merged marks (read-only)
}
api.zoneList() -> [zone, ...]
```

Stored attributes are written with the existing `api.setZone(id, patch)` (GM): `{ empty: true, tags: ["metal", ...],
terrain: "none", building, floors, ... }`. There is no editing UI for `empty` and `tags` yet (later task); `terrain`,
`building`, `floors`, `tall`, `water` already have theirs. `setZone` takes a zone **id**: use `api.idOf(key)`.
The states with owner / level / end condition / exemptions are the registry's (section 10).

## 6. Events

```js
Hooks.on("moinenMapsZoneEvent", (type, payload) => { ... });      // api.EVENT_HOOK; fires on every client
```

Every payload has `{ type, scene: sceneId, version }`.

| type | payload | when |
|---|---|---|
| `tokenLeft` | `token` (id), `uuid`, `actor` (id), `from`, `to` (places; `to` null: deleted), `zoneChanged`, `levelChanged`, `cause`, `userId` | the token's place stopped being `from` |
| `tokenEntered` | the same; `from` null: created | the token's place became `to`; always follows its `tokenLeft` |
| `zoneChanged` | `zone` (key), `id`, `before`, `after` (props; null = no such zone), `changed: [prop, ...]`, `added`, `removed`, `source` | a zone's features, attributes or states changed, a zone appeared or went |
| `borderChanged` | `border` (key), `zones: [key, key]`, `before`, `after` (kind; null = no such border), `source`; M2: `was`, `now` (`{ wall, door }`, null = no such border) | a border's kind, wall or door changed (Armor, state), a border appeared or went |
| `edgeChanged` (M2) | `edge` (id), `before`, `after` (the edge record; null = none), `source` | a temporary edge was added, changed or removed |
| `moveStarted`, `moveStep`, `moveEnded` (M2) | section 14 | a move made through `api.move()` - **only on the client that runs it** |

- `cause`: `"move"` (x / y), `"level"` (altitude, floor, airborne), `"zones"` (the zones were redrawn or a building's
  floors changed under the token), `"create"`, `"delete"`. `userId`: who made the change (null for `"zones"`).
- A token event is told when the token's **document** changes (the start of the move), not when its animation ends, and
  after the fact: nothing here can stop or answer a move (for that: `api.beforeStep`, section 14).
- `levelChanged` is also true when only standing / flying changed (rooftop to airborne): `from.spot === to.spot` then.
- `source`: `"edit"` (this client's GM changed the zones), `"sync"` (another client's change arrived with the scene
  flag), `"layers"` (the fire, destruction or water layer changed what a zone reads as), `"play"` (M2: a write through
  `api.apply()` on this client).
- M2: `zoneChanged` also carries `statesBefore` / `statesAfter` (the zone's registry records) and lists `"states"` in
  `changed` when they differ; a state the map does not draw (smoke, toxic, ...) changes nothing else.
- M2: token events carry `move`: the id of the `api.move()` operation that made the change (null otherwise).
- Opening a scene tells nothing: read the state with `zoneList()` / `tokensInZone()` on the existing hook
  `moinenMapsZones` `"loaded"`.
- The old hook `moinenMapsZones` (`"loaded" | "edited" | "params" | "section" | "linked"`) is unchanged.

## 7. What a combat module calls

| Need | Call |
|---|---|
| Where is this combatant | `api.zoneOfToken(token)` -> `place.spot` |
| Who is in the same zone | `api.tokensInZone(token)`; every level of the zone: `api.tokensInZone(place.zone)` |
| Is the target in range N | `api.range(attacker, target)?.total <= N` (null: no attack possible) |
| Zones of an area effect | `api.zonesWithin(where, n)` |
| Can it move there, how far | `api.route(token, target, way)?.total`, or `api.distances(a, b)` for every way |
| What a move passes | `api.path(token, target, { way })` -> `steps`, `crossed` |
| The wall between two zones, its Armor | `api.borderBetween(a, b)` -> `kind`, `armor` |
| Knockback / slam chain | `api.path(from, to, { way: "range" })` -> `crossed` (barriers in order, `blocked`) |
| Wrecking the zone | `api.zone(where).wreck`; mark it: `api.addZoneState(key, { kind: "wrecked", owner })` (keep `inverse`) |
| Trap stunt allowed | `!api.zone(where).empty` |
| A power needs water / metal / ... | `api.zone(where).tags.includes("metal")` |
| Burning zone, darkness | `api.zone(where).states` |
| Change altitude | `api.setLevel(token, { level: "elevated", airborne: true })`, `{ area: "sky" }`; cost: `api.altCost(from, to)` |
| React to movement | `moinenMapsZoneEvent` `tokenEntered` / `tokenLeft` |
| React to a wrecked / burning zone, a changed border | `moinenMapsZoneEvent` `zoneChanged` / `borderChanged` |
| Keep own caches | compare `api.version()` |
| Undo log entry for a zone change | from `zoneChanged`: `api.setZone(api.idOf(zone), Object.fromEntries(changed.map((k) => [k, before?.[k] ?? null])))` (`setZone` merges a patch; `null` drops a property). `before` / `after` include what the map's layers add (painted fire, wreckage, water); `setZone` writes only the GM's own marks |

## 8. Also changed

- `setZone` and `clearStates` check for the GM first. Before, a player's call painted or put out fire on the fire layer
  and only then failed to write the marks.
- `setAltitude` and `setFloor` clear the airborne note (`air`) together with what they set.
- The distance badges and the ruler label read the per-way distances from the cache of the current zones state instead
  of working them out on every redraw (same numbers).
- A token whose `alt` is `dimension` or `chase` shows no distance badges, like sky high and orbit.

## 9. Borders: a wall with an optional door (M2)

Book 2254: a border is open or blocked, and a blocked border can have a door. Table after 2405: interior door 1, interior
wall 2, exterior door 2, exterior wall 3, reinforced door / wall 4+. 2418: an unlocked door does not affect movement, a
locked one is breached, an electronically sealed one is opened. 2419: a door or a wall can be crashed through. What a breach
takes, who may try and what failing costs is the combat module's; the map holds the wall, the door, their Armor and states.

```
border.wall    = null (an open border) | { armor, state: "intact" | "breached" | "removed", outer: bool, temp: bool }
border.doorway = null (no door)        | { armor, state: "open" | "closed" | "locked" | "sealed" | "breached", built }
border.base    = the kind the border was built as ("open" | "door" | "locked" | "wall" | "outer" | "reinforced")
```

- `outer`: a building's exterior wall (flyers pass over it: `stops.air` is false). `temp`: the wall was removed *for a while*
  (the one who removed it says so; nothing puts it back). `built`: the state the door was built in (what restoring returns to).
- `closed` is an unlocked door. A door is never built `breached`.
- `kind`, `armor`, `door`, `stops` (section 5) now say what the border **amounts to at the moment**: a wall that is breached or
  removed is `kind: "open"`, `armor: 0`, stops nobody; an intact wall with a door one can pass (`open`, `closed`, `breached`)
  is `"door"`; with a door one cannot (`locked`, `sealed`) is `"locked"`; without a door it is `"wall"`, `"outer"` or
  `"reinforced"` (Armor 4+). `armor` is the door's where there is one in a standing wall, else the wall's.
- **Built** and **in play** are stored apart. What the map maker built: the wall, its Armor, whether it is exterior, the door,
  its Armor and built state (`w` in the flag). What happened to it during play: the wall breached or removed, the door opened,
  locked, sealed, breached (`bs` in the flag).
- **Restoring is a GM action, never automatic**: `api.restoreBorders()` / the GM's border menu ("Restore as built", "Restore
  all walls and doors as built"). `clearStates()` (the menu's end-of-scene broom) does not touch borders.
- The GM's menu still marks the six kinds; marking a border anew drops its play record.

Old scenes: the one-kind marks are still what a plain border stores (`[x, y, kind]`) and read as this model with no write:

| old kind | wall | door | as before |
|---|---|---|---|
| `door` | Armor 2 | Armor 1, closed | kind door, Armor 1, stops nobody |
| `locked` | Armor 2 | Armor 2, locked | kind locked, Armor 2, stops walk and air |
| `wall` | Armor 2 | - | stops walk and air |
| `outer` | Armor 3, exterior | - | stops walk |
| `reinforced` | Armor 4 | - | stops walk and air |

The Armor 2 of the wall around an old door mark is **our reading** (the old mark had one Armor for the whole border). An
untouched scene's flag encodes byte for byte as before (`bs`, `q`, `e`, `pn` appear only when something is stored).

```
api.setBorderState(border, { wall?: { state, temp }, door?: { state } }) -> Promise<result>     play state
api.buildBorder(border, { kind?, wall?: null | { armor, outer }, door?: null | { armor, state } }) -> Promise<result>
        builds the border anew (as built, play record dropped): `wall: null` or `kind: "open"` opens it; a part not named stays;
        a new `kind` starts from that kind's wall and door; a door put into a wall takes the table's Armor unless given
api.restoreBorders(border?) -> Promise<result>           one border, or all of them, back as built (GM action)
api.borderAt(x, y, tol)  -> { a, b, x, y, kind (as built), now (what it amounts to), wall, door } | null     (as before + now, wall, door)
api.WALL_STATES, api.DOOR_STATES
```

`border`: a border key (`"z1|z2"`), a border object, or `[placeA, placeB]`. `result` is section 12's. Reasons a write is
refused: `noBorder` (not neighbours), `noWall` (an open border has no state), `noDoor`, `wallState`, `doorState`, `badBorder`.

Drawing (the existing border look, no new design; **not seen on a live canvas yet**): a breached wall has a hole where its
mark sits, a removed wall is faint; the door is the plank across the wall - closed brown, locked red with the keyhole, sealed
red with a square blue lock, open swung out of the wall, breached an empty frame.

## 10. The zone-state registry (M2)

```
state = {
  id,        // unique in the scene, never reused: "s7"
  kind,      // "wrecked" | "fire" | "dark" | "smoke" | "gravity" | "weather" | "flooded" | "toxic" | "ice" | any other name
             //   ([a-z][A-Za-z0-9_-]{0,31}); api.STATE_KINDS lists the known ones
  at?,       // the level it holds on: "ground" | "elevated" | "underground" | "f<n>"; absent: the zone, no level named
  level?,    // how strong (a number): a fire's Intensity (2925), a power's level value
  owner?,    // who or what made it - opaque (a combatant id, an effect source object)
  ends?,     // when it ends - opaque (the combat module's end condition; nothing here ends a state)
  except?,   // ids it does not touch (1654, 1841: never one's own darkness or storm) - opaque strings
  data?,     // anything else: gravity { mode: "low" | "high" } (1703-1704), weather { type: "storm" } (1841)
  zone,      // (reported) the key of its zone now
  source     // (reported by zoneStates(where) / zone().records) "registry" | "mark" | "map"
}
```

- The registry **stores and reports**; `owner`, `ends`, `except`, `data` are kept as given (each at most 2000 characters of
  JSON, `except` at most 64 ids). Nothing ends or clears a state on its own; `clearStates()` (a GM action) removes the
  registry's states with the GM's marks.
- Where the book gives a state its content (for the reader, not computed here): fire 2925-2927, darkness 1654, gravity
  1702-1704, storm 1841, toxic area 2889, smoke 2646, flooding 1832, wrecking 2454-2457. Ice has none.
- **What is drawn**: a state the map already showed reads as the zone property the icons, the tints, the routes and the older
  API use: `wrecked`, `fire` (needs `level` >= 1: its Intensity, capped at 12), `dark`, `ice`, `flooded` (a flooded zone can be
  swum), `gravity` with `data.mode: "low"`. So `api.zone(z).states`, `rooftop`, `wreck`, the quake on wrecking and the fire
  icon follow a registry state. `smoke`, `toxic`, `weather`, high gravity and custom kinds are stored and reported only.
  A registry fire is **not** painted on the fire layer (the GM's own fire mark and `{ op: "zone", patch: { fire } }` are).
- `at`: by the book an elevated position is a zone of its own above the ground (2258) and changed gravity takes both (1702);
  which levels a state reaches is its maker's to say. A state with no `at` is returned for every level.
- Stored as a point inside the zone (like the marks): it keeps to its zone while lines are redrawn.

```
api.addZoneState(zone, state) -> Promise<result>         zone: a key or id (no level named) or a spot string ("z3:elevated": that level);
                                                         `state.at` says it outright. result.result = the stored state
api.updateZoneState(id, { at, level, owner, ends, except, data }) -> Promise<result>     null drops a field
api.removeZoneState(id) -> Promise<result>
api.zoneStates() -> [state, ...]                         the registry's states of the whole scene
api.zoneStates(where, { anyLevel }) -> [state, ...]      every state of a zone as records: the registry's, the GM's own marks
        (id "mark:fire", source "mark"), what the map's layers show (id "map:wrecked", source "map"). A bare key or id: every
        level; a spot, a place or a token: that level and the states that name none; anyLevel: true / false overrides.
        The ground level alone: "z3:ground", a place, a token or { anyLevel: false } (the ground spot is the bare key: section 2)
api.zoneState(id) -> state | null
api.zone(where).records                                  the same list for every level
```

Refused: `noZone`, `badState` (no kind, a value that cannot be stored), `idTaken`, `noState`.

## 11. Temporary edges (M2)

```
edge = { id ("e8"), kind: "portal" | "tunnel" | other name, a, b (spot strings), owner?, ends?, ways?: [way, ...], data?, live }
```

- A portal joins two places that are not neighbours (book 1666, 2040: two-way, lasts a few minutes); a tunnel is a passage
  others can follow, for example under a wall (1996). Both are two-way. `ways`: the ways of moving that may use it (route names
  `walk` / `air` / `through` / `swim` / `swing` or the profile's own name, such as `flight`); absent: every way.
- `a`, `b`: anything that names a place when adding (a key, a spot, a token); an end may be an off-map area (`"@dimension"`):
  such an edge is stored and listed and joins nothing on the map (`live: false`), as does one whose zone is gone for now.
- **How far an edge counts and who fits through it is not in the book.** `api.plan` / `reach` / `moveCost` / `move` count one
  step for an edge (our reading; a mover's profile can switch edges off or pick kinds). `range`, `route`, `path`, `distances`,
  `zonesWithin` (sections 3-4) never use edges. The levels of an edge's ends are reported, not enforced.
- Nothing removes an edge on its own.

```
api.addEdge(edge) -> Promise<result>     api.removeEdge(id) -> Promise<result>
api.edges() -> [edge, ...]               api.edgesOf(where) -> [edge, ...] (the live edges at a zone)
api.EDGE_KINDS
```

Refused: `noZone`, `badEdge` (no kind, the same spot twice), `idTaken`, `noEdge`.

## 12. Writing for a combat action: `apply` and inverses (M2)

Only the **active GM's client** writes (`api.canWrite()`: a GM, and where several are connected the one Foundry calls active).

```
api.apply(op, { save = true }) -> Promise<{ ok: true, changed, inverse, result } | { ok: false, reason, at? }>
```

`inverse` is an op - plain data, storable in an undo journal - that undoes exactly this write when given back to `apply`.
The scene is saved before the promise resolves; events (section 6, `source: "play"`) fire once per `apply`.

| op | does | result | inverse |
|---|---|---|---|
| `{ op: "border", border, wall?: { state, temp }, door?: { state } }` or `{ ..., restore: true }` | a border's state in play | the border (section 5) | `{ op: "border", border, play }` (the play record before) |
| `{ op: "borderBuild", border, kind?, wall?, door? }` | builds it anew (section 9) | the border | `{ op: "borderBuild", border, raw, play }` (how it was built, what had happened to it) |
| `{ op: "zoneState.add", zone, state }` | section 10 | the state | `{ op: "zoneState.remove", id }` |
| `{ op: "zoneState.update", id, patch }` | | the state | the same op with the fields as they were |
| `{ op: "zoneState.remove", id }` | | the state removed | `{ op: "zoneState.add", ... }` with the same record and id |
| `{ op: "edge.add", edge }` / `{ op: "edge.remove", id }` | section 11 | the edge | the other one |
| `{ op: "zone", zone, patch }` | the zone's own marks, as `setZone` (attributes, features, the GM's state marks; a fire is painted / put out on the fire layer) | zone data | `{ op: "zone", zone, patch }` with the own values before; when the write painted or put out fire on the fire layer, also `fireLayer` (below) |
| `{ op: "tokens", rows: [{ id, x, y, alt, floor, air }], skipMissing? }` | puts tokens somewhere (position and this module's level flags) | their places | `{ op: "tokens", rows: (where they were), skipMissing: true }` |
| `{ op: "batch", ops: [...] }` | all or nothing (a failure takes back what was done, `at`: its index); told and saved once | the results | a batch of the inverses, last first |

- The shorthand calls (`setBorderState`, `buildBorder`, `restoreBorders`, `addZoneState`, `updateZoneState`, `removeZoneState`,
  `addEdge`, `removeEdge`) are `apply` with one op and return the same.
- `changed: false`: the write asked for what already was (nothing told, nothing saved); the inverse is still valid. A batch
  says `changed: true` only when one of its ops changed something (a batch of nothing, `restoreBorders` with nothing to
  restore: `ok`, `changed: false`).
- **Tokens that are gone (M4).** A `tokens` op naming a token the scene no longer has is refused before anything is written:
  `{ ok: false, reason: "noToken", missing: [id, ...] }`. With `skipMissing: true` those rows are left out instead and the
  rest is written: `{ ok: true, changed, missing: [id, ...], ... }` (`changed: false` when every row was left out). Every
  inverse the map hands out for a token write (`apply`, `move`, `moveToZone`, the GM's placement) carries `skipMissing: true`,
  so an undo journal can always be played back: a token deleted since is skipped, the others go back. A write Foundry
  refuses or throws on answers `{ ok: false, reason: "error" }`; `apply` never rejects.
- `badOp` also: rows that are no list, a row without an id or with a position that is no number, a batch without a list of
  ops, an op that is no object (inside a batch: refused with `at`, what was done is taken back).
- A new zone state, edge or the like that asks for an id already in use, or gets one made for it, never takes the place of
  another: the id made by the map skips those in use (after a delete and an undo as well).
- **A fire write and the fire layer (M5).** `{ op: "zone", patch: { fire } }` also paints a fire on the fire layer or puts
  the painted fire of the zone out. What it did there is in its inverse:
  `fireLayer: { back: [stroke, ...], out: [strokeId, ...] }` - `back`: the strokes it put out, as they were (plain data: id,
  path, radius, levels, colour, torn edge, seed, place in the paint order); `out`: the ids of the strokes it painted. An op
  that carries `fireLayer` does exactly that on the layer and nothing by guessing: it puts `out` out, gives `back` back and
  writes the marks of `patch` as given, without painting anything of its own; its own inverse carries the mirror
  (`fireLayer` always, the lists may be empty). So:
  - a fire that existed **only as painted strokes** (no mark of the GM: `states` of source `"map"`) and is put out with
    `{ fire: null }` comes back on undo as **those strokes** - the same ids, shapes, levels and colours, in the same paint
    order, growing again from the moment of the undo (as the fire layer's own undo does). Before M5 the inverse was
    `{ fire: null }` and repainted nothing;
  - the inverse of a new fire puts out the stroke that write painted, not whatever burns in the zone by then (a fire the
    GM painted there by hand since stays); the inverse of that gives the same stroke back, not a new one;
  - a fire lowered below what was painted (the old strokes out, a smaller one painted) is swapped back whole.
  The records travel in the inverse, so it stays true after the strokes' records have left the scene (their going-out is
  over). A stroke that burns anyway is left alone (the same inverse twice: `changed: false`); one whose own out time has
  passed meanwhile is not brought back. An inverse without `fireLayer` (a write that touched no fire on the layer, the
  zones not linked to the layers, an inverse stored before M5) works as it always did. `fireLayer` is the map's to hand
  out: do not build or edit one, and **do not add a fire to the patch of such an inverse** (the strokes are the fire; a
  `fire` in the patch is written as a mark of the GM that was not there). Anything that is not `{ back: [...], out: [...] }`:
  `badOp`. `changed` is true when the marks **or** the fire layer changed (before M5 putting out a painted-only fire said
  `changed: false`, the marks being the same). `clearStates` and the map's own fire round are not `apply` and have no
  inverse.
- Play state (`bs`, `q`, `e`, `pn`) is **not part of the Zones editor's undo**: the GM's Ctrl+Z over the pencil lines leaves it as
  it is now. Zone marks written through `{ op: "zone" }` are the GM's marks (`m`) and are in the editor's undo like any other.
- Refused before anything: `notGM`, `notActiveGM`, `noZones`, `badOp`.
- `api.move` and `api.moveToZone` (section 14) return an inverse of the `tokens` kind; they are not GM-only (a token's owner may
  move it), but only the active GM can `apply` an inverse.

## 13. The zone graph for the rules library (M2)

```
api.graph() -> {
  zones:   [{ id (key), level: 0, terrain: "office" | ... | null, rooftop, empty, wrecked, flammable, wreck, tags }],
  borders: [{ id (border key), a, b, wall: null | { armor, state }, door: null | { armor, state } }],
  edges:   [{ id, kind, a, b (zone keys), spots: [a, b], ways }]
}
```

The shape `zones.makeGraph(data)` of the rules library takes (`C:/ipu-tactics/scripts/rules/CONTRACT.md`, "Zone graph");
`wreck`, `tags` and `edges` are more than it names. The same object is returned until the zones change (`api.version()`).
Differences to know about:
- floors are not zones of the graph: a building with floors is one graph zone (`level: 0`); the levels are in places and plans;
- `terrain: null` is both "cannot be wrecked" and "not set" here; `wreck.why` tells them apart (`"terrain"` / `"unset"`);
- the contract's flyers cross a blocked border when one of its zones has a rooftop (its reading 4); the map's routes let flyers
  over **exterior** walls only (`wall.outer`, section 3). The graph carries no `outer`: a rules-side air route can differ from
  `api.route(a, b, "air")`. Use the map's routes for movement and the graph for the rules' own questions.

## 14. Movement (M2)

### Mover profile and cost

```
profile = { way, speed = 1, stress, actions = 1, hover, force, edges, conditions }
api.profile(profile) -> the profile filled in | null (an unknown way)
```

| field | meaning |
|---|---|
| `way` | `walk` / `ground`; `air` / `flight` / `leap` / `superspeed`; `through` / `burrow` / `teleport` / `phase`; `swim`; `swing` - the route it counts (section 3) |
| `speed` | zones in one movement action (on foot 1: book 2383; the movement powers 2 / 4 / 8 / 16: 1995-2034) |
| `stress` | the stress option: `true` doubles the speed (as every movement power of the book), a number or `stressSpeed` says it outright |
| `actions` | how many movement actions the mover may spend now (what `within` is measured against) |
| `hover` | may end in the air (air only): default true, false for `leap` and `superspeed` (2007, 2013: the ground or a rooftop) |
| `force` | may try borders that stop it (crashing through: 2419): the route counts every border and marks the blocked ones |
| `edges` | `true` (default), `false`, or a list of edge kinds it may use |
| `conditions` | the mover's conditions as given: the map does not read them, the step listeners get them |

Which power gives which speed, what a condition does to a move (movement as a full action: 2745, 1574, 1841, 1704), whether a
level change costs: the combat module's. The map counts.

```
cost = { total, speed, actions, stressSpeed, stressActions, within: "free" | "plain" | "stress" | "no" }
        actions: movement actions needed without stress; stressActions: with it (null: no option);
        within: against profile.actions - free (no step), plain, only with stress, not at all

api.moveCost(a, b, profile) -> { reachable, plan, cost }
api.reach(where, profile, { max, flat }) -> [{ zone, id, d, cost }]  nearest first, the mover's own zone first (d 0); see below
api.plan(a, b, profile) -> null | { way, name, total, borders, edges, levels, zones, steps, crossed, cost, from, end }
```

`plan` is `path` (section 4) for a profile: the same steps, plus steps of kind `"edge"` (`{ kind: "edge", from, to, zone, level,
floor, edge }`), `cost`, and the two places `from` / `end`. With no usable edge and no `force` it is step for step what `path`
gives. With `force` a border that stops the mover is on the route with `border.blocked: true` (its `wall` and `doorway` say
what stands there). null: no route, an off-map end (that is a level change: `setLevel`, `moveToZone`), an end in the air for a
mover that must land, a place this way of moving cannot be at.

**`reach` and levels (M4).** For a mover on plain ground (or with `flat: true`) a row is the horizontal walk: `d` the
steps over borders and edges, `cost` their price. For a mover that is **not** on plain ground (on a floor, underground,
elevated, airborne) every row is what `api.plan(where, zone, profile)` gives to that zone's ground: `d` is the plan's
`total` (the levels it climbs or descends are in it) and `cost` its `cost`; a zone to which there is no plan is not listed;
the mover's own zone stays first with `d: 0`. So a row of `reach` and `plan` to the same zone never disagree. `max` limits
the horizontal steps (borders and edges) in both cases, not the levels.

`planAlong` answers null also for: an `end` that is no place in the last zone of the chain (`end` is read as a level of that
zone: its `zone`, `x`, `y` are ignored), an end in the air for a mover that must land, a level the last zone does not have.
It always returns (a chain that asks for a climb which cannot be counted gives null, it does not hang).

### Forced moves

```
api.forcedChain(who, { direction: { dx, dy } | { angle }, awayFrom, toward, distance = 1, profile }) -> plan | null
api.planAlong(from, [zoneKey, ...], { profile, end: { level, floor, airborne }, forced }) -> plan | null
```

- `forcedChain`: from where the mover is, `distance` zones along a straight line: `direction` (`angle` in degrees, 0 = east,
  90 = south), or `awayFrom` / `toward` a token, a point or a place. The result is a plan with `forced: true` and
  `ray: { dx, dy, end: "distance" | "edge", points }` (`end: "edge"`: the line left the zones before the distance was used
  up). Every border on it that stops the mover has `blocked: true` with its wall and door, in order (plan rule 8, book 2435).
- A mover on the ground (or on a floor) is thrown along the ground and a border counts as blocked when it stops walking; an
  elevated mover stays at rooftop height (passes over exterior walls, `border.over`) and ends in the air. Both are **our
  reading**: the book does not say at which level a thrown character travels, nor whether it then falls.
- The GM edits the chain by naming the zones: `planAlong(from, keys, { forced: true })` lays any chain of neighbouring zones
  (or zones joined by an edge) out the same way. The editing UI is the combat module's GM desk.
- null: no direction (both on the same point), the mover is in no zone, a chain that does not hang together.

**Straight up or down** (a forced move between levels): `direction: "up" | "down"`, `{ vertical: "up" | "down" }` or `{ dz }`
with no `dx` / `dy`.

```
api.forcedChain(who, { direction: "up", distance: 3 }) -> plan with forced: true, vertical: true,
    steps: [{ kind: "level", zone, from: spot, to: spot, level, floor, dir: 1 | -1, slab: "floor" | "roof" | "ground" | null }],
    ray: { dx: 0, dy: 0, dz: 1 | -1, end: "distance" | "top" | "ground", points: [start] }, zones: [the mover's zone], borders: 0
```

- The rungs of one zone, bottom to top: underground, the ground, the floors of a standing building (1..n), the elevated position
  above it (the rooftop, or the air at that height). One rung is one vertical zone (2258, 2262, 2419) and one step.
- **Up** ends at the elevated position at the latest (`end: "top"`): sky high is off the map (2259), reaching it is not a
  step of a chain. The mover ends **in the air** there (`plan.end.airborne`), above a building over its rooftop.
- **Down** ends on the ground (`end: "ground"`): nobody is thrown underground. **Our reading**: only burrowing goes there (1995).
  Up from underground comes out through the ground and goes on.
- `slab` says what the step passes through: `"floor"` (a storey's floor inside a standing building), `"roof"` (between the top
  storey - or the ground of a plain building - and its rooftop), `"ground"` (between underground and the surface), `null` (open
  air: no building, or a wrecked one). The map holds no Armor for a floor or a roof and never stops a level step by itself:
  whether a slab stops the mover, and what it costs, is the step listener's (`ctx.step.slab`, answer `{ stop: true }`).
- Where no step can be taken (up from the elevated position, down from the ground) the plan has `total: 0` and the mover's
  own place as its end.
- The GM's edited chain inside one zone: `planAlong(from, [ownZoneKey], { forced: true, end: { level, floor, airborne } })`
  goes rung by rung the same way (`vertical: true`, no `ray`).
- A chain is either along the map or vertical; one that does both is two chains, moved one after the other.

### Moving tokens

```
api.freeSpot(where, { token, near, skip }) -> { x, y, crowded } | null      a token's top-left corner inside the zone
api.moveToZone(token, where, { group, near, options }) -> Promise<{ ok, inverse, place } | { ok: false, reason }>
api.move(token, to, { profile, plan, group, drop, forced, data, wait, options }) -> Promise<{ ok, op, done, total, stopped, place, inverse }>
api.beforeStep(fn) -> off()
```

- `freeSpot`: a grid square inside the zone not covered by another token, nearest to `near` (default: the middle of the zone);
  wholly inside when one is; `crowded: true` when every square is taken (the least covered one is given).
- `moveToZone`: into a free spot of a zone on the level the place names; no route, no steps, nobody asked (a teleport's arrival,
  a GM's placement, the return from the sky: plan rule 16). An off-map area changes the level only.
- `move`: to a place (`to`, the route from `profile`) or along a plan made before (`plan`: from `plan`, `planAlong`,
  `forcedChain`; refused as `stalePlan` when the mover is no longer where the plan starts). **Before every step** every
  `beforeStep` listener is asked, one after another, and may answer later (a promise: a roll, a prompt, a change of the map):

  | answer | effect |
  |---|---|
  | nothing / `true` | go on |
  | `false` or `{ stop: true, reason, data }` | the step is not taken, the move ends there |
  | `{ pass: true }` | take the step although its border is blocked |
  | throws | the move stops (`reason: "error"`) |

  After the listeners the step's border is read **again as it is now**: a listener that breached the wall (`setBorderState`)
  lets the move go on; a border that still stops the mover and that nobody passed stops the move (`reason: "blocked"`).
  ```
  ctx = { op, index, last, step, remaining, token, group, profile, plan, forced, data,
          from, to,                 // places: where the mover is, where the step leads
          border | edge,            // the border as it is now (section 5 + 9) or the edge
          statesFrom, statesTo }    // the states of the zone left and of the zone entered (section 10), on the level of
                                    // the step's own spots (a step on the ground: the ground and the states naming no level)
  ```
  Entering fire (2925), leaving darkness (1654), a wall on the way (2418-2419), a ward's zone (2876): the listener looks at
  `statesTo` / `statesFrom` / `border`, does what the rules say and answers.
- **Group moves** (`group`: tokens that go along - carried 2392, pulled in a grapple 2497, passengers, a group of minions
  2826, Teleport Allies 2038): every step is one write of all the movers, each to a free spot of its own in the same zone and
  on the same level; one `op`, one inverse.
- `drop: { x, y }`: where in the last zone to end up near. `wait` (default true): each step waits for the tokens to get there.
  `data`: handed to the listeners (the action it belongs to). `options`: for the token updates.
- Result: `done` steps taken of `total`; `stopped: null | { index, reason, data, step }`; `place`: where the mover is;
  `inverse`: a `tokens` op that puts every mover back where it started (null when no step was taken); `animated`: whether
  the steps were animated.
- **A client that draws no frames** (a tab in the background, a minimised window, a hidden pane) never finishes a token's
  movement animation. There every token write of `move`, `moveToZone` and `apply({ op: "tokens" })` (so every undo of a move)
  is made with `animate: false` and is not waited for; a step that is being waited for stops waiting when the frames stop.
  A caller that passes `options.animate` itself is left alone. `api.drawsFrames(maxAge = 1000) -> Promise<bool>` is the
  check (one frame asked for, 250 ms at most; the answer is kept for `maxAge` ms). A combat module needs no workaround of
  its own.
- Events on the client that runs the move: `moveStarted { op, token, uuid, group, forced, way, total, zones }`, `moveStep
  { ..., index, step, place }`, `moveEnded { ..., done, total, stopped, place }`. Every client still gets `tokenLeft` /
  `tokenEntered` per step, with `move: op`.
- Runs on the client that calls it; the tokens must be the caller's to move (`notOwner`). Other refusals: `noToken`,
  `badProfile`, `noRoute`, `stalePlan`.
- **A token deleted on the way (M4).** The mover gone: the move ends after the steps taken with `stopped: true,
  reason: "noToken"` (`moveEnded` is told, the promise resolves). A token of the group gone: it is left out, the move goes
  on. A write Foundry refuses: `stopped: true, reason: "error"`. The inverse of a move carries `skipMissing: true`.
- The steps a profile can take are kept per profile **name** as soon as edges count: two movers with different ways over
  the same edges never get each other's answer.

### Cost confirmation on a dragged token

```
api.tactical({ profile(tokenDoc) -> profile, confirm(ctx) -> true | false | Promise, when(tokenDoc) -> bool, gm = false }) -> true
api.tactical(false)          api.tacticalOn() -> bool
```

Per client, off by default (the combat module turns it on where and while tactical play runs). While on, a drag of a token
into **another zone** by this client's user is held back: the route and its cost are worked out for the mover's profile and
`confirm(ctx)` is asked with `{ token, from, to, drop, profile, plan, cost, reachable }`. A drag inside the zone goes through
(free: 2383). `confirm` answers `true`: the map moves the token along the plan with `move()` (so the listeners are asked);
anything else: the token stays - a combat module that sends the move to the GM as an intent sends it and answers `false`.
Without `confirm` the map asks a yes / no question with the zones and actions. `gm: true` asks the GM's own drags too;
`when` limits it (a token of the combat, the mover's turn).

**What counts as another zone (M4).** The drop is read where the token's centre lands, as the update names it (a
straight line across a zone that was never entered is still a move into the zone it ends in). A drop **outside every
zone**, and a drop into a zone from outside them, is a change of zone too: `confirm(ctx)` is asked with `plan: null`,
`cost: null`, `reachable: false` and the place outside as `to` / `from` (`zone: null`, `spot: null`, `id: -1`); a yes moves
nothing, there is no plan (a combat module that needs such a move makes it with `apply`). Otherwise two free drags, out of
the zones and back in, would pass every wall. The **GM's own** such drop (`gm: true`, the free placement not switched off:
section 33) is a placement: written, and `place(ctx)` is told with its inverse, as after an Alt-drop. Not asked: a drag
that stays outside the zones, a drag inside one zone and level, a token on an off-map level (sky, orbit).

One update that changes **both the position and the level** inside one zone (with `levels: true`) is held like a level
change: `confirm(ctx)` with `level: true`, `drop` the new position; `true` writes the whole update. With a position in
another zone it is asked as a drag whose `to` is the place on the level asked for.

**Level changes** (`levels: true`, off by default so an older caller sees no change):

```
api.tactical({ levels: true, confirm(ctx), when, gm, profile })
```

A change of level is movement with a price (2386-2388), and the map's token HUD offers one to every owner of a token. With
`levels: true` and a `confirm`, a change of the level flags (`alt`, `floor`, `air`) of a token made by this client's user
**outside a move** is held back like a drag: the HUD's altitude button (its menu, its right click, Orbit through the orbit
scene), `setAltitude`, `setFloor`, `setLevel`, any plain update of those flags. `confirm(ctx)` is asked with
`{ token, from, to, level: true, drop: null, profile, plan, cost, reachable }`: `from` / `to` are the two places (same
position on the map), `plan` / `cost` as for a drag when both are on the map (`null` to or from an off-map area, where
`reachable` is true and the price is the caller's: `altCost`). `true`: the level is written as it was asked for; anything
else: the token stays (the combat module sends the change to the GM as an intent and answers `false`). An update that leaves
the token in the same place is not asked about. Never held: `move()`, `moveToZone()`, `apply()` (the combat module's own
writes), another user's update, a token `when` refuses, the GM's own changes without `gm: true`. Without a `confirm` nothing
is held: the map has no price of its own to ask about.

## 15. What a combat module calls (M2)

| Need | Call |
|---|---|
| The wall / door between two zones, their Armor and state | `api.borderBetween(a, b)` -> `wall`, `doorway` |
| Breach a wall, open / lock / seal / breach a door | `api.setBorderState(key, { wall: { state: "breached" } })`, `{ door: { state: "open" } }` -> keep `inverse` |
| Remove a wall for a while | `api.setBorderState(key, { wall: { state: "removed", temp: true } })` |
| Zone state with owner, level, end, exemptions | `api.addZoneState(zone, { kind, level, owner, ends, except, data })`; read: `api.zoneStates(where)` |
| A portal, a tunnel | `api.addEdge({ kind: "portal", a, b, owner, ends })` |
| Several changes of one action as one journal entry | `api.apply({ op: "batch", ops })` -> one `inverse` |
| Undo | `api.apply(inverse)` |
| The rules library's graph | `api.graph()` |
| Reachable zones and their cost | `api.reach(token, profile)` |
| Cost of one move | `api.moveCost(token, target, profile)` -> `cost.within`, `cost.actions`, `cost.stressActions` |
| Move with rolls on the way | `api.beforeStep(listener)` once; `api.move(token, target, { profile, data })` |
| Crash through a wall | profile `{ force: true }`; the listener rolls and calls `setBorderState` or answers `{ stop: true }` |
| Carry, pull, passengers, minions | `api.move(token, target, { profile, group: [tokens] })` |
| Knockback / Slam chain | `api.forcedChain(target, { awayFrom: attacker, distance })` -> the GM edits -> `api.planAlong(target, keys, { forced: true })` -> `api.move(target, null, { plan })` |
| Put a token into a zone | `api.moveToZone(token, where)` |
| Player drags a token | `api.tactical({ profile, confirm })` on the player's client |
| Thrown or dropped between levels | `api.forcedChain(target, { direction: "up" | "down", distance })` -> `api.move(target, null, { plan })`; the listener reads `ctx.step.slab` |
| A zone's number in a text | `api.zoneName(where)`, `api.zoneTitle(where, { level: true })`; a chain: `keys.map(api.zoneName).join(" → ")` (section 22) |
| Keep the map's interface clear of own bars | `api.uiInset("id", { bottom: "#dock", top: "#tracker" })` once on `ready` (section 23) |
| Show a zone that lies under a bar | `api.reveal(where)`; while picking it is offered by itself (section 18) |

## 16. Limits and open points (M2)

- Nothing of M2 has run in Foundry: `preUpdateToken` cancelling a v14 drag, `updateEmbeddedDocuments` with `x` / `y` for a
  group, waiting for `movementAnimationPromise`, `DialogV2.confirm`, the drawing of walls and doors, and what a second client
  sees are verified against a stand-in only (`dev/zones-play.test.mjs`).
- The planner treats an edge as joining two zones; the levels of its ends are reported, not enforced.
- (Was: a forced chain follows the map's surface. Section 14 now has the chain straight up or down; one chain is still either
  along the map or vertical, never diagonal.)
- `freeSpot` treats tokens of every level as in the way (they share the map).
- (Was: the GM's menu marks only the six kinds. Section 20 replaced that: the menu edits the wall and the door apart; the six
  kinds stay as quick choices under "Built as".)
- Differences from `combat-spec.md` section 7.1 as it stood when this was written: a door also has the states `closed`
  (unlocked) and `breached` (as the rules contract); a place is `{ zone, level, floor, ... }` with a spot string, not
  `{ key, level: "floor:<n>" }`; a temporary edge and a zone state carry `owner` / `ends` (the spec's edge says `source` /
  `until`); the spec's state kind `storm` is `weather` with `data.type: "storm"`; `unwreckable` is `terrain: "none"`; the
  resource flags are `tags`.

## 17. Highlights (interface part)

A highlight is a **show, not a state**: nothing is stored, it belongs to the scene it was made on and is gone when that scene
closes or the page reloads. It is drawn whatever the scene's "who sees the zones" setting says, under fog and vision like the
zone display itself.

```js
const id = api.highlight({
  id: "ipu.reach",                    // optional; the same id again replaces what it showed, for everyone it was shown to
  zones: ["z3", "z4:elevated", { zone: "z7", color: "stress", style: "dashed", label: "2", tip: "2 actions" }],
  borders: ["z3|z4", ["z3", "z7"], { border: "z3|z9", color: "danger", style: "dashed", label: "Armor 5" }],
  color: "move", style: "fill",       // defaults for zones
  borderColor: "danger", borderStyle: "solid",
  users: [userId],                    // absent: this client only; "all"; "gm"; a user id or a list
  order: 0                            // higher wins where two highlights name the same zone or border
});                                   // -> the id, or null when the spec names nothing that exists
// (M4) the same id with nothing to show (`zones: []`, no borders, no tokens) takes that set away, here and where it was sent
// (M4) clearHighlights(null), (7), ({ id: null }), ({ prefix: undefined }) name no set: nothing goes, 0 - also clearTokenMarks, clearLinks
api.clearHighlights(id);              // also ({ id }), ({ prefix: "ipu." }), () everything this client made,
                                      // ({ all: true }) also what others showed here (this client's screen only) -> how many went
api.highlights();                     // what is on this client's screen: [{ id, zones, borders, order, from }]
api.showReach(token, profile, { id: "reach", users, max, beyond: false, labels: true, order });
```

- **Colours**: a name of `api.HIGHLIGHT_COLORS` (`move`, `free`, `stress`, `range`, `danger`, `target`, `info`, `here`,
  `blocked`), a number (`0xff9d4d`) or `"#rrggbb"`. **Zone styles**: `fill` (a wash and an inner band), `outline` (the band
  only), `dashed` (a dashed band: "possible, at a price"). **Border styles**: `solid`, `dashed`. Every band and line has a dark
  line under the colour, so it reads on light and on dark maps; labels are dark pills rimmed in the colour and keep their size
  on screen at every zoom.
- A zone entry may be a spot (`"z4:elevated"`): the zone is what gets highlighted. `label` is short (cut at 28 characters),
  `tip` is the text under the pointer.
- **Who sees it.** Without `users` only the calling client. With `users` (a GM's call only; a player's highlight stays on the
  player's own client) the highlight goes over the module socket **to those users alone** - the server honours the recipient
  list, so another player's browser never receives it. A client that opens the scene later asks and gets what is meant for it.
  Clearing takes it from their screens too. Clients take highlights from GM senders only.
- `showReach` is `api.reach` drawn: zones within one movement action in `move`, zones that need the stress option in
  `stress`, the mover's own zone outlined, farther zones left out unless `beyond: true` (grey, dashed). The label is the
  number of actions. It does not decide anything.
- Limits: 600 zones and 600 borders per highlight; an id is up to 64 characters of letters, digits and `_ . : -`.
- **Where a label sits.** A zone's label starts at the zone's label point (under the number badge when that sits there) and
  takes the nearest spot where it is not covered: tokens, the zone's number badge, its state icons, passage marks and labels
  already placed count against a spot, and so does leaving its own zone. It also tries the spots just beside the tokens near
  it. A label keeps its spot until another is clearly better, so it does not jump. A border's label slides along and off its
  border the same way. Placement is counted when the highlight is drawn, at a zoom step and shortly after a token is moved,
  made, hidden or deleted; never per frame or per pan. Pure part: `scripts/zones/place.mjs`.
- **Thin far out.** Bands, dashes and border lines get thinner in a zone that is small on screen and when the grid square
  gets small on screen (down to 0.4 of the width), so a whole map seen from far away is not covered in paint.
- Cost: redrawn only when the set, the zones or the zoom step change; nothing runs per frame or per pan while nothing shows.

## 18. Picking a zone (interface part)

```js
const r = await api.pick({
  zones: ["z3", "z4:elevated", { zone: "z7", label: "2", tip: "2 actions", color: "stress" }],   // absent: any zone
  title: "Kid Thor: where to?", hint: "...", color: "target",
  timeout: 0,                         // ms; 0: none
  user: userId,                       // a GM's call: ask that user; absent: this client's user
  inset: { bottom: 180 },             // px of the window's edges this pick should keep clear of, on top of api.uiInset (section 23)
  reveal: true,                       // true | "fit" | false: how zones no click can reach are brought into view (below)
  edgePan: true                       // false: resting the pointer at an edge does not slide the map
});
// { ok: true, zone: "z4", id: 3, spot: "z4:elevated", place: {...}, x, y }     (x, y: the scene point clicked)
// { ok: false, reason: "cancelled" | "replaced" | "noZones" | "sceneChanged" | "timeout" | "userGone" | "notGM" | "noScene" }
api.picking();                        // is a pick running on this client
api.cancelPick();                     // give it up; ({ user }) the pick a GM asked of that user
```

- The promise always resolves, never rejects. A spot in `zones` is the place the answer carries; a bare key answers with the
  zone's ground level.
- While picking: the zones on offer show in their colour with their label, the rest of the map is dimmed, a banner at the top
  carries the title, the hint and a Cancel button, the pointer says whether the zone under it can be picked and shows its
  `tip`, the zone under the pointer is lit. A click on a zone on offer picks it; Escape, a right-click or Cancel gives up; a
  right-drag still pans and the wheel still zooms. A new pick replaces the running one (`replaced`).
- The zones on offer follow the map: when lines change mid-pick the offer is counted again; a scene change ends the pick -
  also the pick this client asked of another user (`sceneChanged`; that user's client is told to stop), and a pick asked
  by a GM who disconnects ends on the asked client (`userGone`). One zone is offered on one level at a time (section 36).
- Asked of another user, the request goes to that user alone and the answer comes back to the asker alone; the user leaving
  resolves with `userGone`. A pick request is taken from a GM only. `inset`, `reveal` and `edgePan` go along (the insets
  declared with `api.uiInset` are each client's own).
- **The banner keeps clear.** It sits at the top middle, below the declared top inset (`api.uiInset`, the pick's `inset`) and
  below whatever interface part it would lie on there (a combat tracker, a strip of chips): found by looking at what is over
  the map at that spot, so a module that declares nothing is avoided too. A bar that lets clicks through (`pointer-events:
  none`, as a tracker on a player's screen) is avoided by what it draws there. It stays in the upper half of the window. It is
  placed when the pick starts, again 0.4 s later, on a window resize and when the free stretch is found changed.
- **Zones no click can reach.** A zone on offer is in reach when some point of it is in the window with nothing over the map's
  canvas there (part of a large zone showing beside a bar is enough). The others - under a bar, a panel or a window, or off
  the screen - are counted per side of the free stretch (section 23) on a small chip at that edge: an arrow and "2 more". A
  click on the chip slides the view by the least that brings the nearest of them into the free stretch. Resting the pointer
  at such an edge (within 44 px of it, 0.45 s) slides the map that way, slowly at first, until nothing is hidden there or the
  pointer leaves (`edgePan: false` turns it off). When **nothing** on offer is in reach as the pick starts, the nearest comes
  into view at once. `reveal: "fit"`: as the pick starts the view moves - and zooms out when it has to - so that every zone on
  offer is in the free stretch. `reveal: false`: no chips, the view is never moved. A pick of any zone (`zones` absent)
  shows no chips.
- Nothing runs per frame: reach is counted when the pick starts, 0.15 s after a pan or zoom, and when a look every 1.5 s
  finds the free stretch changed (a panel opened or closed).

## 19. The rules driver: the map's rule mechanics as display (gap G-Z9)

Two things in the map act like rules: the **fire round** (rolls, spreads the fire, posts to chat) and the **wrecking
numbers** shown beside a terrain. A combat module takes them over:

```js
api.rulesDriver({ id: "invincible-plus-ultra", title: "Invincible Plus Ultra",
  fireRound: async () => { ... },     // optional: what the map's "fire round" button and api.fireRound() run
  wreck: { office: [5, 2] } | (terrain) => "5/+2",   // optional: what is shown beside a terrain
  distances: false });                // optional: the map's distance bands and ruler off
api.drivenBy();                       // { id, title, fireRound: bool, distances: bool } or null
api.rulesDriver(false);               // step down (rulesDriver(false, id): only if that id is in charge)
api.wreckText("office");              // the text shown beside a terrain now
```

- **No driver: everything as before.** The fire round rolls and posts, the map's table shows.
- With a driver and no `fireRound`: the map's fire-round buttons go, `api.fireRound()` writes and rolls nothing, tells the
  GM who runs the fire and returns null. With `fireRound`: the button (labelled with the driver's title) and the call run it.
- `api.zone(k).wreck` stays the map's table: data, as before. The driver changes what is **shown**.
- The registration is per client and lasts until reload; a combat module registers on `ready` on every client.
- Left as display in both cases: the cost and life-support hints of the altitude HUD.

## 20. The GM's editing (interface part)

- **Border menu** (right-click a border): "Built as" (the six kinds as quick choices), the wall (Armor, exterior or not), the
  door (has one, Armor, the state it is built in), and under "Now, in play" the wall's state (intact / breached / removed,
  "for a while") and the door's state; restore this border / all borders.
- **Zone menu** (right-click a zone), three pages: *Zone* (features, floors, terrain incl. unwreckable with the numbers shown,
  empty zone, the resource tags), *States* (the quick marks; every registry record with its level, where in the zone it
  holds, gravity's mode, who made it and until when; add / remove), *Passages* (portals and tunnels from this zone; a new one
  picks its other end on the map with `pick`).
- **Passages on the map.** Every passage shows to whoever sees the zones display (GM and players alike): a round mark beside
  the number badge of each zone it joins (a swirl: portal, an arch: tunnel, two links: another kind; an end off the map has
  only the one mark) and a thin dotted (portal) or dashed (tunnel) arc between the two marks, dark line under the colour.
  Marks keep their size on screen; the arcs are redrawn at a zoom step. Pointing at a mark says the kind and where it leads.
- A gravity record shows its mode and no level stepper (it has no level unless one was given through the API).
- **Zones dock, "In play"**: every wall and door that is not as built, every tracked state, every passage; a row can be taken
  back; pointing at a row outlines its zone or border on the map.
- **Who may what.** Building (the wall, the door, attributes) is the editor's path: any GM, one undo step, the play record of
  the border kept. Play state (wall / door state, registry, edges) is `apply()`: the active GM only. A GM who is not the
  active one sees a line saying on whose screen play changes are made, the play controls are off, and a refused write
  shows a notice.

```js
api.editBorder("z1|z2", { wall: { armor: 5, outer: true }, door: { armor: 2, state: "locked" } });   // door: null takes it out; wall: null opens the border
// -> true when the map changed; false: not a GM, no zones, no such border, a spec that cannot be built, nothing to change
api.refusalText(result);              // the localized sentence for a refused write ({ ok: false, reason })
api.activeGmName();                   // the active GM's name ("" when none)
```

## 21. Limits and open points (interface part)

- Looked at in Foundry (v14, a GM and a real player on a lane server): highlights on a light and a dark map at two zooms, a
  highlight sent to one player only, a pick on the GM's own client and one asked of a player, the border menu, the three pages
  of the zone menu, the In play panel; label placement, passage marks and thin bands on a light and a dark map, close, far
  and in a small crowded zone, as a GM and as a player. Not looked at: the tip of a passage mark and a label moving aside
  when a token is dragged onto it (both stand on the node test), a second GM (the refusal notice and the locked controls), the rules
  driver with a real combat module, touch input. The rest stands on `dev/zones-interact.test.mjs` (a stand-in Foundry and PIXI).
- Highlights are lit like the map (they are in the primary group, under the tokens): on a dark scene or under a coloured
  light their colours are tinted (passage marks and badges too). A label moves out from under tokens; where a zone has no free
  room at all (a tiny zone far zoomed out) it can still overlap a token or the badge (the tip under the pointer still says it).
- Passage marks sit in a row beside the badge: three or more passages in one small zone seen from far away run past the zone.
  A mark in the middle of a zone (badges placed in the middle) can be behind a token, like the badge itself.
- A passage has no visibility of its own: whoever sees the zones display sees every passage.
- A highlight is covered by fog and vision like the zone display (it is in the primary group). A combat module that wants a
  player to see reach into unexplored zones needs a decision here.
- A registry state added in the menu gets no level unless the GM sets one (the map invents no default).
- A passage made in the menu joins ground levels; `addEdge` takes any spot.
- Players cannot send highlights or pick requests to others (only a GM's client can); a combat module that wants a player's
  aim shown to the table relays through the GM's client.
- The refusal notice is shown by the menus and the panel; `apply()` called by a module returns `{ ok: false, reason }` and
  shows nothing (`api.refusalText` gives the words).


## 22. A zone's name (integration part)

The number on a zone's badge is its id + 1 written in the look's numeral format (arabic, padded "03", roman, letters, kanji:
the GM's choice per scene or the world's default look). Texts that name a zone should read like the badge:

```
api.zoneName(where) -> "3" | "III" | "C" | "03" | "三" | null     the text on the zone's badge; null: `where` names no zone
api.zoneTitle(where, { level = false }) -> "Zone III" | null       the zone in words, in the user's language, as the map's own
        tips and menus say it; level: true adds the level of a place off the ground ("Zone III, floor 2", "..., rooftop",
        "..., in the air", "..., underground"); an off-map area gives its name ("Sky High", "Orbit", ...)
api.numberFormat() -> "arabic" | "padded" | "roman" | "letters" | "kanji"     the format in force on this scene
api.numeral(n, format = api.numberFormat()) -> string | null       any number from 1 in that format (a chain "IV → VII")
api.NUM_FORMATS
```

- `where`: anything that names a place (section 2): a key, a spot, an id, a place, a token, `{ x, y }`.
- The name follows the **id**, so it changes when the GM redraws lines (like the badge). Store keys, show names; work the
  name out when the text is shown.
- A change of the format tells `moinenMapsZones` `"params"`; a change of the zones `"edited"` / `"loaded"`.
- With the map's distance display on, a badge shows a distance instead of its number while a token is selected; `zoneName` is
  always the number.

## 23. The free part of the screen (integration part)

Other interface parts cover the map: a combat tracker at the top, an action dock at the bottom, panels at the sides. The map's
own interface (the pick's banner, bringing zones into view) works with **the free stretch**: the window less the insets that
were declared, narrowed to the largest rectangle nothing lies over.

```js
const off = api.uiInset("my-module.dock", { bottom: 180 });            // px in from that side of the window
api.uiInset("my-module.dock", { bottom: "#my-dock", top: barElement }); // an element or a selector: measured whenever it is
                                                                        // asked; 0 while it is absent, display: none or visibility: hidden
api.uiInset("my-module.dock", () => ({ bottom: dockHeight() }));       // worked out whenever it is asked (also per side)
api.uiInset("my-module.dock", null);  off();                           // taken back (either way)
api.uiInsets(extra?) -> { top, right, bottom, left }                   // the declared insets now, the largest per side
api.safeArea({ inset, measure = true }) -> { x, y, width, height } | null   // the free stretch in client px
const r = await api.reveal(where | [where, ...], { inset, margin, fit = false, animate = true });   // { ok: true, moved } | { ok: false, reason: "noZones" | "noScene" }
```

- **Declared** insets are per client and last until reload: a module declares its bars once on `ready` (an element or a
  function keeps the number current by itself). Use one id per bar; the same id again replaces it. Declaring or taking back
  an inset while a pick runs lays that pick out again at once (banner, chips).
- **Found by looking**: `safeArea()` and a running pick test what lies over the map's canvas on a 40 px grid
  (`document.elementFromPoint`, about 900 points for a 1600 x 900 window) and take the largest free rectangle. So a bar
  nobody declared is kept clear of as well. An element with `pointer-events: none` is not seen: declare it. When windows lie
  all over the map and the largest rectangle is under 15 % of the declared stretch in a direction, the declared stretch
  stands. `measure: false`: the declared insets only.
- `reveal` slides the view by the least that puts the label points of the named zones inside the free stretch, `margin` px
  from its edge (default: a fifth of the stretch, 140 at most). Several zones that fit are brought in together; when they do
  not fit, `fit: true` zooms out until they do (never in), else the first named is brought in. `animate`: a 0.32 s slide
  (none on a client that draws no frames). `moved: false`: they were there already. It moves this client's view only.
- Foundry keeps the view inside the scene's padding: a zone at the very edge of the scene may not come all the way in.
- **The director reads the declared insets too (M5).** Its camera frames a subject, and its "My view" chip stands, inside
  Foundry's middle column less the navigation, the hotbar and the declared insets (`scripts/director/core.mjs safeBox`).
  A declared inset counts **however large it is**: before M5 a bottom inset of 60 % of the window or more (and a top, left
  or right one of half the window) was dropped whole, so a dock with its panel open was framed under and the chip stood on
  it. Only when the declared insets of one direction leave less than 300 px across or 240 px down are they given up, by
  what that least stretch needs and in proportion (the stretch stays between the bars; it is never the whole window
  again). The chip is drawn above other interface parts on purpose (it must stay clickable while a bar grows under it; it
  is placed again every 300 ms while it shows).

## 24. Limits and open points (integration part)

- Looked at in Foundry (v14, lane server, a GM at 1600 x 900 with the combat module's tracker, dock, desk and party panel on
  screen): the banner below the tracker and the map's own orbit strip instead of over them; under a declared top inset; the
  chips at the top and above the dock with their tip; a click on a chip bringing a zone out from under the dock; the slide
  when the pointer rests at the edge; names in arabic, roman and letters; a chain up through a building with two floors
  stopped under the roof by a listener, and down again; a move and its undo on a client whose frames were stopped (16 ms,
  not animated). What a player's screen shows and the rest are in the report of the package that made this; otherwise it
  stands on the node tests.
- The free stretch is one rectangle. On a screen covered in panels it is small (830 x 260 on that GM's screen) and the chips
  sit on its edges, which can be well inside the window.
- A zone partly showing beside a bar counts as in reach although its label may lie under the bar (the highlight labels step
  aside for tokens and badges, not for other modules' interface).
- Zones are in reach or not as seen by `elementFromPoint`: an overlay that lets clicks through counts as nothing (a click
  does reach the zone under it). The banner does avoid such a bar, by its drawn pieces under 45 % of the window's height.
- The banner is placed by what is there when the pick starts; a tracker that appears later moves it only when the free
  stretch changes.
- Touch: the chips work by tap; there is no resting pointer, so no slide.

## 25. Interaction on the map: marks on tokens (M3)

Package M3 puts what a combat module used to show in panels onto the map. The map draws and senses; it reads no rule: every
text, number and colour is the caller's. Nothing here is stored (a show, like highlights). Pure part
`scripts/zones/board-core.mjs`, drawing `scripts/zones/board-layer.mjs`, wiring `scripts/zones/board.mjs`; tests
`dev/zones-board.test.mjs`.

**Who sees what** is the caller's, as for highlights (section 17): `users` absent = this client only; `users: [ids]` or
`"all"` works from a GM's client only and goes to those users alone (a player's `users` is dropped, the show stays local).
A client that opens the scene later is sent again what was meant for it. On its own the map only **holds back**: an entry
that names a token with `TokenDocument.hidden` never goes to a player's client (a mark on it; a line to it; of a line FROM
it the target end alone is sent), and no client draws a line from or to a token its user does not see. Any other kind of
"this player must not know" (a token hidden by a rule, not by Foundry) is the caller's: leave the user out of `users`.

```js
const id = api.markTokens({
  id: "ipu.targets",                    // the same id again replaces the set (with `tokens: []`: takes it away); absent: a fresh id
  users: [userId],                      // absent: this client
  order: 0,                             // a higher set wins part by part where two name one token; state chips add up
  color: "target",                      // default colour of the entries (named colour of section 17 or a number)
  tokens: [
    { token, state: "in", label: "72%", tip: "Hit chance 72%", hover: { label: "~3", tip: "Expected damage 3", bar: { value: 7, max: 9, loss: 3, lossMax: 5 } } },
    { token, state: "out", tip: "Out of range (2 zones, weapon reaches 1)" },
    { token, state: "chosen" },
    { token, marks: ["broken", "held", { icon: "fa-solid fa-ghost", color: "info", tip: "Phased" }], bar: { value: 4, max: 9, text: "4/9" } }
  ]
});
api.clearTokenMarks(id | { id } | { prefix } | { all: true });   // () = what this client made; returns how many sets went here
api.tokenMarks() -> [{ id, tokens, order, from }]                // what is on this client's screen
```

- `token`: an id, a uuid, a Token, a TokenDocument.
- `state`: `"in"` a ring in the colour (in reach); `"out"` the token's picture is dimmed, a no-entry sign above it, the
  caller's `tip` beside the pointer in the "no" look (why it cannot be chosen); `"chosen"` a heavier ring with four ticks;
  `"caught"` a dashed ring (inside an area, not aimed at). Absent: no ring (chips, bar, label alone).
- `label` (18 characters) a pill above the token; `tip` (240) beside the pointer while it is on the token.
- `marks`: state chips down the token's right edge (Foundry's own effect icons run down the left). Known names
  (`api.STATE_MARKS`): `broken`, `held`, `airborne`, `barrier`, `reaction`, `down`, `burning`, `hidden`, `stunned`, `warn`;
  or `{ icon: "<Font Awesome class>", color, tip }`. Six at most; a chip's `tip` joins the pointer tip.
- `bar`: `{ value, max, loss, lossMax, gain, color, text }` - a bar above the token: what stays, what is expected to go
  (`loss`, full red), what may go at most (`lossMax`, paler), what would be gained. `{ text }` alone: a word.
- `hover: { label, tip, bar }`: shown instead of `label` / `tip` / `bar` only while the pointer is on that token (the
  caller's preview: expected damage, expected fall of health). No round trip: the caller sends it with the set.
- `Hooks.on("moinenMapsTokenHover", (tokenDoc | null, entry) => {})` fires on this client when the pointer comes onto or
  leaves a marked token, for a caller that would rather work its preview out late and call `markTokens` again.
- Limits: 200 tokens a set. Marks live as children of the token, so they move with it; they keep their size on screen and
  shrink with a token that is small on screen. They are put back when Foundry redraws the token.

## 26. Lines between things (M3)

```js
const id = api.link({ id: "ipu.aim", from: attackerToken, to: targetToken, color: "danger", style: "solid", label: "Strike", users: "all" });
api.link({ id, links: [{ from, to, label }, { from, to: { zone: "z7" } }, { to: targetToken }] });   // several; `from` absent: the target alone is marked
api.clearLinks(id | { id } | { prefix } | { all: true });   api.links() -> [{ id, links, order, from }]
```

An end is a token, `{ zone }` (or a bare zone key) or `{ x, y }`. Drawn: a gently bowed line with an arrow head from the
rim of the source to a reticle (a ring with four ticks) around the target, the label on a pill half way. `style: "dashed"`
for something not yet declared. The line follows its tokens while they move. Sending and holding back: section 25.

## 27. A move under the pointer: `pickMove` (M3)

```js
const r = await api.pickMove({
  token,                                   // the mover (required)
  profile,                                 // its mover profile (section 14)
  zones: [{ zone: "z7", label: "1", cost: "Movement action", color: "move" },
          { zone: "z9", label: "2", cost: "Quick action · 1 stress", color: "stress", route: ["z7", "z9"], more: true,
            hazards: [{ border: "z7|z9", text: "Wall, Armor 3" }, { zone: "z9", text: "Fire 2" }] }],
  intent: { label: "Move" },               // the GMs see where this user points (section 32)
  title, hint, banner, ...                 // everything api.pick takes (section 18)
});
// { ok: true, zone, spot, place, button, alt, route: [zoneKey, ...], entry }  |  { ok: false, reason }
```

- While the pointer is on an offered zone: the **route** from the token through the place each border is crossed at (a
  dot there: the door or wall mark of a border that has one, else where the straight way passes the border) to the zone,
  with an arrow head; **what waits on the way** as chips on the route; beside the pointer the
  zone's tip, the **price** (`cost`, the caller's words) and one line per hazard. **One click confirms**; there is no
  second question.
- `zones` absent: what `api.reach(token, profile)` gives, labelled with the distance and priced in movement actions
  (the map's own default; works with no combat module).
- `route`: the zones entered in order (or a plan of section 14) when the move is not the map's own shortest. Absent: the
  map's route (`api.plan` for the profile: the way round a wall, as it is priced); only where the profile has no route at
  all, the forced way. A way the map itself would not walk (through a standing wall) is still drawn, border by border.
- `hazards`: absent = what the map itself knows on that route (a blocked border with its Armor, a zone burning);
  `[]` = nothing; a list = the caller's (reactions waiting, a guarded zone, ...). `{ zone | border, text, color, icon, tip }`.
- `more: true`: the move can be made another way (through a wall, at a higher price). The tip says "Right-click: another
  way"; a right click on that zone resolves `{ ok: true, alt: true, ... }` and the caller opens its own choice (for
  instance `api.menu`, section 29). A right click anywhere else cancels as before.
- Runs on this client. A GM asks a player with the combat module's own message; the pick itself must run on the client
  whose pointer it is.

## 28. Areas and warnings (M3)

```js
const r = await api.pickArea({ zones: [...], radius: 1, token, intent: true, tokens: (doc) => ({ label: "62%" }) });
// a yes also carries area: [zoneKey], caught: [tokenId]
const a = api.areaPreview({ id: "ipu.blast", at: "z7", radius: 1, users: "all", tokens: true, level });   // { id, zones, tokens } | null
api.clearArea(id);
api.warn({ id: "ipu.warn", zones: [{ zone: "z4", text: "Ends in fire" }], borders: [{ border: "z4|z5", text: "Held" }], users });
api.clearHighlights("ipu.warn");
```

- `pickArea`: everything `api.pick` takes (`zones` = where it may be put) plus `radius` (borders out from the zone under
  the pointer; 0 = that zone) or `area: (zoneKey, place) => [zoneKey]` (the caller's own shape), `areaColor`, `tokens`,
  `anyLevel`, `token` + `intent`. Under the pointer the covered zones fill and **every token standing in them gets the
  dashed "caught" ring, allies too**; the tip counts them. `tokens`: `false` none, a function per TokenDocument returning
  `false` (not caught), `true`, or `{ label, color, tip }` (the caller's number over it).
- Tokens are caught **on the level the area is put on** (ground when the picked place is ground); `anyLevel: true` catches
  every level of the covered zones. A player's client catches only the tokens that player sees.
- `areaPreview`: the same as a standing show, sent to `users` like a highlight and a set of token marks under one id.
  `level` (a token - document, id or uuid -, a place, a spot, or a level word: `"ground"`, `"elevated"`,
  `"underground"`, `"f2"`, `{ level: "floor", floor: n }`): only tokens on that level; absent: every level; a level that cannot be
  read (a token that is gone) catches nobody.
- `warn`: a dashed band in the danger colour with a chip (a warning sign and the caller's words) on zones and borders. It
  is a highlight (section 17): the same `users`, taken away with `clearHighlights(id)`. Highlight entries may now carry
  `icon` (a name of `STATE_MARKS` or a Font Awesome class) drawn in front of the label.

## 29. A menu at a thing; right clicks (M3)

```js
const r = await api.menu({
  token | border: "z3|z4" | zone: "z7" | x, y | client: { x, y },
  title: "Door", sub: "Armor 3",
  items: [
    { id: "open", label: "Open", icon: "door-open", hint: "Quick", run() {} },
    { id: "break", label: "Break through", icon: "hammer", disabled: "No actions left" },
    { separator: true },
    { id: "fate", label: "Fate points", icon: "star", stepper: { value: 0, min: 0, max: 3 }, onStep(value, delta) {} },
    { id: "aid", label: "Accept help", toggle: true, on: false, onToggle(on) {} }
  ]
});
// { ok: true, id, index }  |  { ok: false, reason: "cancelled" | "replaced" | "noItems" | "noAnchor" | "sceneChanged" }
api.closeMenu();   api.menuOpen() -> bool

const off = api.onContext((ctx) => null | true | menuSpec | Promise<menuSpec | null>);
// ctx = { kind: "token" | "border" | "zone", token, border, zone, place, x, y, client, shift, alt, ctrl }
```

- The menu stands beside the thing (right of it, else left), stays inside the window and follows the map. A plain entry
  closes it (`run()` is called and the promise resolves); a **stepper** (− value +) and a **toggle** keep it open and tell
  the caller each change (`onStep` may return the value to show, or `false` to refuse; `onToggle` may return the state).
  Escape, a click elsewhere or a new menu closes it. Digits 1-9 pick the plain entries in order. This client only.
- `onContext`: asked about every right click on a token, on a border that carries a wall or a door, or on a zone. Answer
  **at once**: nothing = not mine (Foundry's token HUD and the map's own menus do what they always did); `true` = handled;
  a menu spec without an anchor (or a promise of one) = the map opens it at the thing when the button comes up, and
  `spec.done(result, ctx)` is told the answer. A right **drag** that starts on a claimed thing still pans the map. Not asked
  while a zone is being picked or the GM edits the zones. With no listener registered nothing changes.

## 30. The camera: how much it follows (M3)

The director's combat stage moved every client's view on every beat. Now each user has a switch (client setting "Combat
camera: how much it follows", also `api.camera`):

```js
api.camera() -> { follow: "all" | "turn" | "off", choice: "auto" | "all" | "turn" | "off", default }
api.camera({ follow: "turn" });      // this user's choice (kept in the client setting; a switch on a dock calls this)
api.camera({ default: "turn" });     // what "auto" means on this client until reload (a combat module says it on `ready`)
```

- `"all"`: as before. `"turn"`: the view moves only when a turn starts and the active combatant is **off this user's
  screen**; it slides by the least that brings it in, at the zoom the user has; moves and attacks come as the soft markers;
  on the user's own turn the same for their own token; the view never goes back to an earlier one by itself. `"off"`: the
  view is never moved.
- Without a call the default stays `"all"` (nothing changes for a table that has no combat module). Null when the
  director's stage is not loaded.

## 31. One language of zones: `present` (M3)

```js
api.present({ numbers: "always", distances: false, show: true });   api.present(null);   api.present() -> what is in force | null
```

Per client until reload, on top of the scene's look: `numbers: "always"` every zone carries its number badge;
`distances: false` no distance badges or bands around a selected token (a badge is always the zone's number, so a label on
the map, a chat line and a tooltip all name the same thing: `api.zoneName(key)`, section 22); `show: true` the zones show on
this client even where the scene keeps them to the GM. A combat module calls it on every client when a fight starts and
`present(null)` when it ends.

## 32. What a user has armed, for the GMs (M3)

```js
api.intent({ token, to: targetToken | { zone } | { x, y }, zones: [key], border, label: "Strike", color, ttl: 20000 });   api.intent(null);
api.intents() -> [{ user, intent }]     api.intents(false)     // a GM's client: what is on screen; hide / show them here
Hooks.on("moinenMapsIntent", (userId, intent | null) => {});   // a GM's client
```

It goes to the GMs' clients alone, never to another player. There it shows as a dashed line from the token to what is aimed
at with "user: label" on it (whole), and dashed outlines on the zones. While nothing is aimed at yet, a pill stands over
the token instead: it carries **the label alone** (M5; who armed it is in the pill's tip, "user: label", whole). A label
of up to 18 characters is drawn as it came, a longer one ends in an ellipsis inside 18; with no label the pill says the
user's name. (Before M5 the pill said "user: label" cut to 18 characters, which lost the action's name.) Only about a token the sender owns. It is not drawn
on the sender's own screen (a GM's goes to the other GMs). `pickMove` and `pickArea` send it by themselves with
`intent: true | { label }`, from the moment the pick runs until it ends.

**The contract, exactly (M4):**

- **Every call with a spec is sent**, also when it says the same as the last one. Each message that arrives **starts the
  `ttl` anew** on that GM's client: an intention said again before its `ttl` ran out stands without a gap, for as long as
  the caller keeps saying it. Saying it again every `ttl` minus a margin (the combat module: `ttl` 120 s, said every
  100 s) is enough; nothing else is needed to keep it up.
- At most one message leaves per 150 ms; of several calls inside that window the **last** one wins (a `null` too).
- **A GM who opens the scene later** (joins, reloads, comes over from another scene) is sent what stands on this client at
  once, with the `ttl` that is left of the last say; from the caller's next say on it runs like on every other GM's client.
  A GM on another scene is not shown it (an intention belongs to the scene it was said on).
- `ttl` runs on each GM's client from the message's arrival; when it ends there, the intention goes there
  (`moinenMapsIntent(userId, null)`). `ttl`: 20 s when absent, 120 s at most (a longer one is cut to it).
- `intent(null)` takes it away on every GM's client. With nothing standing and nothing waiting it sends nothing (calling
  it on every frame of an idle pick costs no message).
- A user who disconnects takes theirs along; when the sender's client leaves the scene, the GMs are told it is over.
- Returns `true` when taken (sent, waiting to be sent, or nothing to send), `false` for a spec that names nothing that can
  be shown. An intention about a token the sender does not own is dropped on the GM's client.

## 33. The GM's gestures (M3)

- **A free placement.** While `api.tactical` is on with `gm: true`, a GM who holds **Alt** while dropping a token places
  it: no route, no price, nobody is asked, the token flashes "No cost". The caller is told afterwards:
  `api.tactical({ ..., place(ctx) {} })` with `ctx = { token, from, to, drop, free: true, inverse: { op: "tokens", rows } }`
  (`inverse` goes to `api.apply` to take the placement back; it carries `skipMissing: true`). `free: false` switches the
  gesture off. The update carries `options.mmFree === true`. (M4) Alt is read from the key **and** from every pointer
  press and release on the page, and is forgotten when the window loses focus: an Alt let go in another window (Alt+Tab)
  does not make the next plain drop a placement. (M4) The GM's drop out of the zones or into them from outside is a
  placement too, without Alt (section 14): `to.zone` or `from.zone` is then null.
- **Giving a hit to someone else, forcing a result** are the caller's rules: the map gives the gesture. Register
  `api.onContext` on the GM's client and answer a token with a menu (section 29) whose entries are the caller's ("Hit this
  one instead", "Set the result" with a stepper).

## 34. What a combat module calls (M3), row by row

| Ledger row | Call |
| --- | --- |
| U32 a move seen before it is made | `api.pickMove({ token, profile, zones: [{ zone, cost, route, hazards, more }], intent })`; one click resolves; `alt: true` on a right click of a `more` zone |
| U33 who can be hit | `api.markTokens({ id, users, tokens: [{ token, state: "in", label: "72%" }, { token, state: "out", tip: "why not" }] })`, `clearTokenMarks(id)`; picking a token stays the caller's click handling (Foundry's `targetToken` or its own) |
| U34 what a hit would do | `hover: { label, tip, bar: { value, max, loss, lossMax } }` in the same entry; or `Hooks.on("moinenMapsTokenHover")` + `markTokens` again |
| U35 acting on the thing | `api.onContext(fn)` answering a menu spec; `api.menu({ token | border | zone, items })` |
| U36 an area before it is thrown | `api.pickArea({ zones, radius | area, tokens })` -> `area`, `caught`; `api.areaPreview({ at, radius, users })` to show it to the table |
| U37 one language of zones | `api.present({ numbers: "always", distances: false, show: true })`; names by `api.zoneName(key)` |
| U38 state on the token | `marks: [...]` and `bar` in `api.markTokens` (a set per token state, `users: "all"` minus what a player must not know) |
| U39 who aims at whom | `api.link({ id, from, to, label, users })`, `clearLinks(id)` |
| U40 a warning where it bites | `api.warn({ id, zones: [{ zone, text }], borders, users })`; hazards of `pickMove` |
| U42 the camera is the player's | `api.camera({ default: "turn" })` on `ready`; a switch calls `api.camera({ follow })` |
| U43 the GM sees what is armed | `api.intent({ token, to, zones, label })` from the player's client; `intent: true` in `pickMove` / `pickArea`; `moinenMapsIntent` hook |
| U44 the GM overrides on the map | Alt-drop -> `tactical({ gm: true, place(ctx) })`; `api.onContext` + `api.menu` on the GM's client for the rest |

## 35. Limits and open points (M3)

- **Kept cheap.** A token's marks are children of the token, built when its entry changes and laid out again only when the
  zoom changes; lines and the route are one `Graphics` each, drawn again when they change, at a zoom step of about 8 %, and
  (lines) on a frame in which one of their tokens moved. Nothing runs per frame while nothing moves: no ticker, no filter,
  no mask, no texture of its own. Dimming is a tint on the token's own mesh. The pointer is read once per frame at most and
  only while marks are on screen. Not benchmarked (by order).
- **Looked at in Foundry** (v14, lane server, the test world's running fight with the combat module's tracker, dock and desk
  on screen; headless Edge, pointer events sent to the canvas): as the GM at 1600 x 900 and 1366 x 768 - token marks in all
  four states, chips, bar, the hover parts and both tips; lines (solid, dashed, to a zone, side by side tokens); `pickMove`
  with the map's own entries and with the caller's (price, a wall on the way, another way by right click); `pickArea`;
  `warn`; `areaPreview`; the menu at a token (stepper, toggle, digit) and at a door; `onContext` on a token (the menu opened,
  Foundry's HUD did not); `present`; the Alt placement with its flash, callback and inverse; `camera`. As a real player
  (Test Gracz 1) at 1366 x 768 and 1600 x 900 with the GM in a second browser: marks, lines, a warning and an area sent by
  the GM arrived; the entries naming a hidden turret did not, and the line from it arrived as the target mark alone; the
  player's own `users: "all"` stayed on the player's screen; the player's `pickMove` and `pickArea` showed on the GM's map
  as the dashed line with "Test Gracz 1: Ruch" and went away when the pick ended; an area caught only the tokens the
  player sees.
- **Not looked at:** the camera's "turn" mode during a real change of turn (node only: the director's own tests and the
  switch); a real mouse drag with Alt (the placement was written with Alt reported held); a real right-button drag on a
  claimed token; `onContext` on a border and on a zone (node only); touch; a late joiner being sent the marks again (node
  only); an English and a Polish client side by side (the texts are the caller's; the map's own eight are in both files).
- Marks on two tokens that stand side by side overlap each other's rings and chips (the scene's tokens touch). The label
  pill of a token under a top bar of another module can be covered by that bar; `api.reveal` brings a token's zone in.
- A token out of reach is still clickable: refusing is the caller's.
- `present({ distances: false })` also hides the distance bands for the GM; the labels of `pickMove` are then the only
  place a distance shows.
- The warning band on a very large zone is thin against a busy map; the chip is what reads. A caller that wants more
  passes `style: "fill"` through `api.highlight` with the same id.
- An intention is drawn to a zone's label point, which may lie far from the pointer in a large zone.

## 36. Corrections after the seventh adversary round (M4)

What changed for a caller, in one list (each is also said where it belongs above; the checks are `dev/zones-adv7.test.mjs`).

| | Before | Now |
| --- | --- | --- |
| `planAlong` with an `end` outside the chain's last zone | a plan that ended in another zone | null (`end` is a level of the last zone) |
| `planAlong` over a climb that cannot be counted | never returned | null |
| `reach` for a mover off the ground | horizontal steps only: disagreed with `plan` | the plan's `total` and `cost`; zones without a plan left out; `{ flat: true }` gives the old rows |
| a drag out of the zones / into them from outside | passed (two drags crossed any wall) | asked (`plan: null`, `reachable: false`, `zone: null`); the GM's own is a placement |
| one update with position and level | passed unasked | held (`level: true`) |
| Alt let go in another window | the next drop was a placement | read from pointer events too, cleared on blur |
| `tokens` op / inverse naming a deleted token | threw or half wrote | `noToken` with `missing`; inverses carry `skipMissing: true` and skip it |
| `move` with the mover deleted on the way | rejected, `moveEnded` never told | ends `stopped`, `reason: "noToken"` |
| malformed `tokens` / `batch` op | threw | `badOp` |
| a batch that changed nothing | `changed: true` | `changed: false` |
| ids made by the map after a delete | could repeat one in use | skip those in use |
| a profile's steps over edges | kept per way: one mover's answer given to another | kept per profile name |
| `pickMove` with no `route` in an entry | forced way (through walls) | `api.plan(profile)`; the forced way only when there is no other |
| `pickArea` on a zone offered on two levels | answer for the first level | the answer and `caught` are counted for the place clicked |
| `areaPreview({ level })` | a level word only | also a token (id, uuid, document: its level), a place; a level that cannot be read catches nobody |
| `intent` said again | dropped as a repeat: faded on the GMs' screens, a late GM never saw it | section 32 |
| `pickMove` / `pickArea` `intent` | said before the pick ran (stood after a refused pick) | said when the pick runs |
| a show under an id with an empty list | ignored: the old set stayed | takes the set away |
| `clear...(null)` and the like | cleared everything this client made | nothing |
| a pick asked of a user, the asking GM changes scene or leaves | ran on with nobody to answer | ends: `sceneChanged` (told to the user's client) / `userGone` |
| a mover or anchor deleted under a pick / menu | pick and menu stayed | `pickMove` / `pickArea` resolve `{ ok: false, reason: "noToken" }`; the menu `noAnchor` |
| `onContext` spec answered after a scene change | menu opened on the new scene | not opened; the spec's `done` gets `{ ok: false, reason: "sceneChanged" }` |
| marks, lines, highlights of a client that reloaded or left | stayed on the others' screens for good | dropped when that user disconnects, and when its next page load says hello (what the new page sent before its hello stays) |
| `warn` with `zones` / `borders` that are no list | threw | null |

Limits that stay:

- One zone can be offered by a pick on **one level at a time**: a second entry for the same zone on another level is
  dropped (the pick is made by clicking the zone's ground).
- A line (section 26) from a token the viewer cannot see arrives as the target's mark alone, its label with it: the same
  rule as for a hidden token (what one user is shown never names what they cannot see).
- **Not looked at in Foundry (node only):** everything in this section. Worth a look with a real mouse: a drag out of
  the zones as a player and as the GM; Alt held, Alt+Tab away and back, then a plain drop (macOS Option as well); a drag of
  several selected tokens (each token's update is asked on its own); `present` while the GM stands on another scene; the
  cost under the pointer of `pickMove` on a scene with very many zones now that `reach` plans per zone for movers off the
  ground (ground movers are unchanged).

## 37. Three requests of the combat side (M5)

Rows U76, U70, U72 of `invincible-plus-ultra/dev/combat-usability.md`. Checks: `dev/zones-board.test.mjs` (U76),
`dev/director.test.mjs` (U70), `dev/zones-fire-inverse.test.mjs` (U72).

| | Before | Now |
| --- | --- | --- |
| the pill of an intention over a token (section 32) | "user: label" cut to 18 characters | the label alone (an ellipsis when over 18), the user's name when there is no label; "user: label" whole in the tip and on the line |
| a declared inset of 60 % of the window (bottom; half for the other sides) or more, for the director (section 23) | dropped whole: the camera framed under the dock, the "My view" chip stood on it | counts; given up only as far as a 300 x 240 px stretch needs |
| declared insets that left under 300 x 240 px, for the director | the whole window (Foundry's own columns dropped too) | the least stretch between the bars |
| `changed` of a zone write that only put out / painted fire on the layer | false (the marks were the same) | true |
| the inverse of `{ op: "zone", patch: { fire } }` (section 12) | the own marks before only: a painted-only fire did not come back, the inverse of a new fire put out everything painted in the zone | also `fireLayer: { back, out }`: the same strokes back, the painted stroke out |

For the caller: nothing it calls changed its shape. An inverse may now carry `fireLayer`; give it back to `apply` as it
came. The combat module's own way round the old empty inverse (the layer's Intensity put into the inverse's patch) is no
longer needed and should go where the inverse carries `fireLayer`: with it the strokes still come back once and nothing
is painted beside them, but the zone gets a mark of the GM it did not have.

**Not looked at in Foundry (node only):** all three. Worth a look: the pill of a player's armed action on the GM's
screen (the label whole, the tip with the name); the "My view" chip and a take-over's framing with the combat dock, its
panel and a question open at 1366 x 768 (with the combat module's own stylesheet rule for the chip switched off, to see
the map's placement); a painted fire put out by a combat action and undone (the flames grow in again in the same shapes
and colours, on a player's client too), also after waiting until the smoke of the put-out is gone.

## 38. Framing what a combat module names, and a driven fight (U94)

Row U94 of `invincible-plus-ultra/dev/combat-usability.md` ("how the camera works together with tactics, XCOM style").
Checks: `dev/director-frame.test.mjs` (the pure parts in `scripts/director/stage-core.mjs`). Code:
`scripts/director/source-stage.mjs` (`frame`, `camera({ driver })`), `scripts/director/director.mjs` (`registerVeto`).

The director is led by one client and knows two audiences (the GMs, everybody). A tactical fight has a third thing: every
user holds an own view of the fight (somebody hidden from one player is not hidden from another). So the camera of a
tactical fight is not sent: every client asks for its own, locally, and the map decides whether and how the view moves.

### `api.frame(spec)` -> `Promise<{ ok: true, moved, whole?, arrived? } | { ok: false, reason }>`

Local to the calling client. Nothing is sent to anybody.

| field | |
| --- | --- |
| `tokens` | token ids of the viewed scene, the FOCUS first. A token this client's canvas does not show to this user (hidden, out of sight, gone) is left out; when the focus is not shown nothing is framed (`reason: "unseen"`) |
| `zones` | zone keys to bring in with the tokens when they fit |
| `points` | `[{ x, y }]` scene points, the same |
| `fit` | `false`: the focus alone (default: everything named, when it fits at the user's zoom) |
| `level` | `"turn"` (default) or `"all"`: the least setting of the user's switch (section 23, `camera({ follow })`) at which this plays |
| `hand` | `true`: this answers the user's own act (a unit chosen, a target walked to): the quiet time after the user's own camera move and a "My view" of this turn do not stop it. `off` still does |
| `after` | a token id: wait until that token has stopped moving, then frame |
| `why` | a word for the trace (`_debug().frames`) |

What it does, always:

- **never changes the zoom**; the zoom is the user's;
- **nothing moves** when the focus stands in the free stretch of the screen (section 23: Foundry's middle column less the
  declared `uiInset`s and windows), 5 % inside its edge;
- otherwise **the least slide** that puts the subject 14 % inside the free stretch; several subjects come in together when
  they fit at the user's zoom, else the focus whole and the frame leaning toward the others;
- before it glides it waits until the page draws evenly again (two even frames, at most 0.7 s): what calls for a frame (a
  turn change, a card) redraws the surfaces in the same moment, and a glide begun inside that hitch would lose its start;
- the glide: 420 ms x (0.75 + 1.6 x screens travelled), within 0.75 .. 2.2 x; a jump under reduced motion; the user's
  wheel, drag or pan keys stop it at once (the screen engine's guard) and the camera is then the user's;
- **never goes back by itself.** After a move that was not the user's own act the "My view" chip (and Esc) stands for 8 s:
  it glides back to where the user was and no further automatic move comes that turn. Not asked for in 8 s: the view
  is the user's as it stands;
- answers `{ ok: false, reason }` and moves nothing for: `off` (the user's switch), `level`, `held` (another module holds
  the camera: LockView, Hot Pan), `busy` (a take-over runs), `hand` (the user's hand is on the map, or moved the camera
  within the stage's "leave a player alone" seconds, or took the view back this turn), `unseen`, `noSubject`, `noScene`,
  `covered` (no free stretch), `replaced` (a newer frame came while this one waited), `noStage`, `error`.

It works whether the world's director switch is on or off and whatever the GM's director mode is; it obeys the kill
switch `CONFIG.moinenMaps.noDirector`. `api.frameBack()` is the chip's click.

### `api.camera({ driver })`

`driver: "<module id>"` while a fight of that module runs on this client; `driver: null` when it is over. `camera()`
and `status()` answer `driver`. While driven, on this client only:

| | Without a driver (as before) | Driven |
| --- | --- | --- |
| the director's turn, attack, roll and damage shots of the fight | played | stand down (a veto, `director.registerVeto`) |
| a move shot of a combatant's token | played | stands down; a bystander's plays |
| the map's own events (destruction, fire, a cinematic the GM starts) | played | played |
| the stage's own glide to the active combatant, its return at the end of the fight | yes | no: the driver's `frame` calls are the fight's camera, and nothing returns by itself |
| the letterbox on a hit | by the stage's setting | none (the shots that carried it stand down) |

A table without a driving module is untouched: no veto is registered until `camera({ driver })` is called.

### For the caller

| the combat module wants | it calls |
| --- | --- |
| to be the camera of its fight on this client | `camera({ driver: id })` at the first redraw with a fight, `camera({ driver: null })` without |
| the view on somebody (a turn, a question, a target) | `frame({ tokens: [focus, ...others], level, hand, why })` |
| the view on somebody who walks | `frame({ tokens: [id], zones: [to] })`, then `frame({ tokens: [id], after: id })` |
| to know it can | `typeof api.frame === "function"` |

Hand over only what this user may know: `frame` drops what the canvas does not show, but a token visible on the map and
concealed in the fight (a disguise) is the caller's to leave out.

**Limits.** One frame at a time: a newer one takes the move over. The letterbox "action camera" of a hit is not part of
a driven fight (a next step: a driver-side call that asks for the bars). `frame` does not follow a moving token
continuously; it frames where the token started and where it stopped.

## 39. The action camera of a driven fight: `shot` (U98)

Row U98 of `invincible-plus-ultra/dev/combat-usability.md` (the second stage of U94: "finish wiring the director camera ... XCOM
style"). Checks: `dev/director-action.test.mjs` (the pure parts, `scripts/director/action-core.mjs`). Code:
`scripts/director/source-stage.mjs` (`shot`, `shotEnd`), `scripts/director/director.mjs` (`takeLook`).

Section 38 made a driven fight quiet: the director's own shots stand down and the caller frames by the least slide. This section
gives the fight its shots back, as the caller's: the combat module names WHAT HAPPENED on this client (a beat of an exchange,
with the tokens this user is shown), and the director shoots it with its own screen engine (the letterbox, the vignette, the
flash and the shake of a take-over, the look and the intensity the user set for the director) and gives the view back.
Like `frame`, it is local: nothing is sent to anybody, every client asks for its own.

### The switch

`camera({ follow })` and the client setting "Combat camera: how much it follows" know a fourth value, `"action"`:

| follow | in a driven fight | in a fight nobody drives |
| --- | --- | --- |
| `"action"` | `shot` plays; `frame` plays its `"turn"` level | as `"all"` (the director's own stage) |
| `"all"` | no shot (`reason: "level"`); `frame` plays both levels (section 38) | as before |
| `"turn"` | no shot; `frame` plays its `"turn"` level | as before |
| `"off"` | nothing moves (`reason: "off"`) | as before |

`camera({ default: "action" })` makes it what "auto" means on this client (a combat module says it on `ready`).

### `api.shot(spec)` -> `Promise<{ ok: true, played } | { ok: false, reason }>`

| field | |
| --- | --- |
| `key` | the exchange the beat belongs to (the caller's id of it). Beats of one key are one piece of staging |
| `beat` | `"open"`, `"hit"`, `"miss"`, `"kill"`, `"reveal"`, `"move"`, `"close"` |
| `tokens` | token ids, THE FOCUS FIRST (the target of a blow, the one revealed, the one who walks), then who else belongs in the frame (the attacker). A token this client's canvas does not show to this user is left out; a beat whose focus is such a token does not play (`"unseen"`), exactly as `frame` |
| `zones` | zone keys held in the frame with them (where a walk goes) |
| `still` | `true`: the user has something to answer. The beat plays its effects in place when its focus is on screen, and moves nothing |

`played` is `"take"` (the camera went there), `"place"` (in place), `"joined"` (it joined the shot on screen), `"back"` (a
`close` sent a waiting camera home) or `"none"` (a `close` with nothing waiting).

How each beat is played (the times are `action-core.mjs TIMES`):

| beat | the camera | bars and blow | then |
| --- | --- | --- | --- |
| `open` | to the pair (0.4 to 1 s), inside 0.85 .. 1.12 x the user's zoom; nothing when the pair stands comfortably in the free stretch already | bars only when the stage's letterbox setting is "every attack" | WAITS there for the result, the "My view" chip standing by; after 12 s without one the view goes home by itself |
| `hit` | in place when the camera waits there (or the pair is on screen), else to the pair | the bars and the vignette (not for "never"), the flash and the shake | holds 1.3 s, the view goes home (0.64 s) |
| `miss` | the same | none (bars for "every attack") | holds 0.9 s, home |
| `kill` | the same, then a slow push of 6 % toward the target (only when the camera is away anyway) | the bars, the strong flash and shake | holds 2.1 s, home |
| `reveal` | to the one revealed | the bars | holds 1.7 s, home |
| `move` | to the walker with the zone it goes to (never a zoom); kept on the token until it stands, 8 s at most; nothing when both are on screen | none | holds 0.5 s, home |
| `close` | a camera still waiting for a result of that key goes home | | |

Always:

- **the view goes back** to where the user had it, place and zoom, unless the user took the camera meanwhile. A beat in place (no
  camera move, nothing waiting) changes nothing of the view and leaves nothing to go back from;
- a beat of the key on screen **joins** it (`played: "joined"`): the stronger one wins (kill over hit over miss over the opening);
  a beat of another key carries on from where the camera is and keeps the home of the first;
- **the user's hand wins.** A beat that would move the view needs it free: the user at work on the map, or having moved the
  camera within the stage's "leave a player alone" seconds, gets the beat in place when its focus is on screen and else nothing
  (`"hand"`). During a shot that is away from home: Esc or a click on the map cuts it (home in 0.42 s, and no further shot or
  automatic frame that turn); the wheel or a drag takes the camera (it stays where the user puts it, the stage is quiet for the
  "leave alone" seconds). While the camera waits for a result the "My view" chip (and Esc) does the same as after a frame.
  Input is never swallowed. A beat in place listens to nothing (a click on the map then is the user's own work);
- a result (`hit`, `miss`, `kill`) of the key the camera waits for lands at once, and a `close` of a key whose beat is on its way
  to the screen does nothing (the engine closes an exchange in the same moment it gives the result);
- in a driven fight the user's own pan is quiet for the "leave alone" seconds only, also while "My view" stands after a frame
  (without a driver it still silences the turn, as before); the rest of a turn is silenced by "My view", Esc or a click alone;
- a `frame` with `hand: true` (the user's own act on the dock) ends a shot at once where it stands; any other `frame` waits
  until the view is back and then plays from there;
- before a glide it waits for an even frame rate like `frame`; under reduced motion: no zoom, no shake, no flash, no push;
- answers `{ ok: false, reason }` and plays nothing for: `off`, `level` (the user's switch is not on the action camera: the
  caller may then play its quiet `frame`), `held` (LockView's pan lock, Hot Pan: nothing plays; LockView's zoom lock: it plays
  without a zoom), `busy` (the destruction show or a take-over of the map itself has the screen), `covered`, `hand`, `unseen`,
  `noSubject`, `noScene`, `noBeat`, `replaced`, `noStage`, `error`;
- the letterbox is the director's, drawn under the interface: no bar ever covers the caller's dock, tracker or cards.

It works whether the world's director switch is on or off and whatever the user's director mode is (a GM too); it takes the
look (the director's preset), the user's director intensity and the user's opt-outs (no letterbox, no vignette, no shake, no
flash, reduced motion), and it obeys the kill switch `CONFIG.moinenMaps.noDirector`.

`api.shotEnd()` -> `true` when something was on screen or waiting: the view goes back to the user's at once (0.42 s), nothing
is marked. The caller says it when the user's own hand or a question takes the screen (an action armed, a card to answer). The
stage says it itself when the fight ends, the driver is taken back, the scene goes, or the user turns the switch down.

### For the caller

| the combat module wants | it calls |
| --- | --- |
| the action camera as the fight's default | `camera({ default: "action" })` on `ready` (when `typeof api.shot === "function"`) |
| a watcher's shot of an attack | `shot({ key, beat: "open", tokens: [target, attacker] })` |
| its result | `shot({ key, beat: "hit" | "miss" | "kill", tokens: [target, attacker] })`; with `still: true` for a user with a card open |
| somebody new in the user's view | `shot({ key: "reveal:<id>", beat: "reveal", tokens: [id] })` |
| somebody else's walk | `shot({ key, beat: "move", tokens: [id], zones: [to] })` |
| the exchange is over | `shot({ key, beat: "close" })` |
| the user armed something or got a question | `shotEnd()` |
| to fall back for a user who turned the camera down | on `reason: "level"`: its `frame` of section 38 |

Hand over only what this user may know (the rule of section 38): `shot` drops what the canvas does not show, and a beat whose
attacker the user's view does not hold should name the target alone.

**Limits.** One shot at a time on a client. The numbers over a token are the caller's (the map shows none). No caption and no
banner: the caller's own interface names who acts on whom. A `still` beat cannot be seen when its focus is off screen (it is
then refused with `"hand"`). The walk is re-framed in steps (a calm slide when the token nears the edge), not by a spring.

## 40. Signs: a caller's pictures where the map draws its text (U100)

Row U100 of `invincible-plus-ultra/dev/combat-usability.md`. Checks: `dev/zones-signs.test.mjs` (the pure part,
`scripts/zones/signs-core.mjs`), `dev/zones-board.test.mjs` (section 40 checks: what the menu and the move pick put in the page,
what the canvas draws). Code: `signs-core.mjs` (clean, HTML), `signs-pixi.mjs` (the canvas row), and where the fields are drawn:
`board.mjs` (menu, move pick tooltip, route chips), `board-core.mjs` (cleanMenu, cleanTokenMarks), `highlight.mjs` (cleanHighlight,
cleanPick), `interact.mjs` (the pick tooltip), `highlight-layer.mjs` (a zone's label), `board-layer.mjs` (a token's pill, a chip).

The map draws some texts on a caller's behalf, as plain text, escaped and cut. A caller that speaks in pictures (a combat module
whose prices are bars and a bolt) gives, BESIDE the text, the same thing as **pieces**: words and **signs** in order. Where the
map draws the text it draws the pieces instead. The text stays: it is what a map without this section draws, what the map draws
when the pieces are bad, and the plain words of the thing. The map does not know what a sign means.

### Where

| the thing | its field(s) with text | `signs` on it |
| --- | --- | --- |
| a menu (section 29) | `title`, `sub` | `menu({ ..., signs: { title, sub } })` |
| a menu's plain entry | `hint` (24 characters) | `items: [{ ..., hint, signs: { hint } }]` |
| a move pick's zone (section 27) | `cost` (the tooltip), `label` (on the zone and in the tooltip), `tip` | `zones: [{ ..., signs: { cost, label, tip } }]` |
| a hazard on a move's way (section 27) | `text` (the chip on the route and the tooltip line) | `hazards: [{ ..., text, signs: { text } }]` |
| a pick's zone (section 18), a highlight's zone or border (17) | `label`, `tip` | `{ zone, label, tip, signs: { label, tip } }` |
| a token mark (section 25) and its hover | `label` | `tokens: [{ ..., label, signs: { label }, hover: { label, signs: { label } } }]` |

`signs.<field>` counts only when `<field>` has its text too (no text: nothing is drawn, as before). A hazard's `tip`, when given,
is still drawn as words in the tooltip.

### Pieces and a sign

`pieces = [ "words", sign, " · ", sign, ... ]`, at most 10. The words of all pieces together are cut to the field's own length
(24 for a hint, 18 for a token's pill, 28 for a zone's label, 60 for a move's price ...); a sign never counts. Pieces with no sign in
them are ignored (the text is drawn). Two signs side by side get a little air; any other space is the caller's.

| a sign's field | |
| --- | --- |
| `name` | its tooltip and its screen-reader name (`role="img"`, `aria-label`); none: it is silent (`aria-hidden`) |
| `el` | the page: the caller's own drawing, a tree `{ tag: "i" \| "b" \| "span", cls, text, kids: [tree] }` (3 deep, 4 kids each, 8 classes, text 8 characters). The caller's classes and stylesheet give it its look; the map adds no style to it |
| `img`, `w` | the canvas (and the page when there is no `el`): a picture used as a MASK, painted in one colour: a `data:image/svg+xml` / png / webp, or a path ending in .svg / .png / .webp; `w` its width when 12 high |
| `icon` | a Font Awesome class instead of a picture |
| `n` | a number or short text after the picture (8 characters) |
| `color` | the canvas: the colour of the picture (`0xRRGGBB` or `"#rrggbb"`; default: the label's text colour) |

A sign with no `el`, `img`, `icon` or `n` is dropped. Nothing of a sign can leave its drawing: tags other than i / b / span are
drawn as `i`, classes are plain words, texts and names are escaped, a picture's address is percent-encoded where it could close
its `url()`, an address that is not an image is dropped.

In the page a sign with `el` is that tree with the name on its top element; without, the map's own `<span class="mm-z-sign">`
(the picture as a mask in the colour of the text, then `<b>n</b>`). On the canvas (a zone's label, a token's pill, a chip on a
route) a sign is its picture painted in `color`, or its icon, then its number; a sign with neither draws its number or its name.
The width of a picture is known before it loads, so a label does not change size when it arrives.

### For the caller

| the combat module wants | it hands |
| --- | --- |
| a menu row's price as its marks | `{ hint: "Quick · 2 stress", signs: { hint: [quickSign, stressSign] } }` |
| a door's Armor in the menu's sub line | `{ sub: "Locked, Armor 2", signs: { sub: ["Locked, ", armorSign] } }` |
| the price at a zone of a move | `{ zone, label: "Quick", cost: "Run: quick action", signs: { label: [quickSign], cost: ["Run: ", quickSign] } }` |
| a hit over a token | `{ label: "good", hover: { label: "good · -2", signs: { label: ["good · ", damageSign] } } }` |

A table without such a caller is untouched: nothing of the map's own texts takes signs, and an entry without `signs` is cleaned
and drawn exactly as before (`zones-signs.test.mjs` C2). An older map ignores `signs` and draws the words.

**Limits.** A menu entry's `label`, a stepper's or a toggle's text, a `disabled` reason, a warning chip of section 28, the pill
of an intention (section 32) and a link's label take no signs. The pick tooltip has no pointer events, so a sign's own tooltip
does not open there (its name is still its screen-reader name).

## 41. Room for the map's floating things, and how a token moved (U116, U106, U107)

Rows U116, U106 and U107 of `invincible-plus-ultra/dev/combat-usability.md`. Pure part: `scripts/zones/room.mjs` (`spreadLabels`,
`menuSpot`, `chipSpot`, `methodOf`); wiring: `board.mjs` (the labels' layout, the menu), `board-layer.mjs` (a label's shift and
its tie line), `interact.mjs` (`uiAvoid`, the highlights' labels keeping clear of the board's), `zones.mjs` (`method` /
`byHand` for `tactical`), `director/source-stage.mjs` (the "My view" chip). Checks: `dev/zones-room.test.mjs`, the "41:" checks
of `dev/zones-board.test.mjs`, the "section 41" checks of `dev/zones-play.test.mjs`.

| | Before | Now |
| --- | --- | --- |
| token labels (section 25) of tokens that stand close | each at its token: one lay over the other ("Spor" under "Spora szansa") | laid out together: a label that would cover another steps aside or up a row, as little as it can, tied to its token by a thin line in its colour |
| a token label longer than 18 characters | cut with no sign of it | cut with an ellipsis; the whole label is the first line of the pointer's tip |
| a zone's label or warning chip (sections 17, 28) | kept clear of tokens, badges, other zone labels | also of the tokens' labels and the lines' pills ("Even odds" no longer covers "Fire ⊘ round start") |
| a menu (section 29) near an edge | inside the window | inside the window less the declared bars (section 23: a menu near the bottom stands above a declared dock), clear of the boxes asked for with `uiAvoid` when there is room; placed again while it is open |
| the director's "My view" chip | bottom centre of the stage | the first free spot along the bottom of the stage (a row or two higher, else the top centre), clear of the `uiAvoid` boxes, the map's labels and Foundry's movement ruler |
| `tactical` `confirm(ctx)` / `place(ctx)` | no word of how the token moved | `ctx.method`, `ctx.byHand` |

### `api.uiAvoid(id, what)` -> `off()`

```js
const off = api.uiAvoid("my-module.desk", "#my-desk");           // an element or a selector (every match), measured whenever it is asked
api.uiAvoid("my-module.note", { x, y, width, height });           // a box in client px (or { x0, y0, x1, y1 })
api.uiAvoid("my-module.all", () => [el, "#bar", box]);            // worked out whenever it is asked; lists may mix all of these
api.uiAvoid("my-module.desk", null);  off();                      // taken back (either way)
api.uiAvoids(extra?) -> [{ id, x0, y0, x1, y1 }]                  // the boxes now; an absent element, display: none or visibility: hidden gives none
```

A part of the screen that is not a bar along an edge (`uiInset` stays for those): a panel at the side, a banner at the bottom
centre, a desk. The map's **menus** (`api.menu` and the menus `api.onContext` opens) and the director's **"My view" chip** keep
clear of these boxes when some spot is free; with none free they stand where they cover the least of them (never off the
screen). Per client, until reload; one id per part, the same id again replaces it. Nothing else of the map reads them (the
pick's banner and `reveal` still work with section 23).

### `api.mapLabels()` -> `[{ x0, y0, x1, y1, kind }]`

The labels the map draws on the board now, in client px: `kind` `"token"` (a token mark's pill, an intention's pill), `"line"` (a
line's pill), `"zone"` (a highlight's label, a warning chip). For a caller that keeps its own floating things clear of them.

### The labels' layout

- One pass over every token label (section 25 marks, section 32 intention pills) on the next frame after the marks, the zoom, a
  marked token or a line changed. The one `chosen` keeps its spot first; the others are taken from the top down and from the left.
  A label that would lie on another is moved by the least: up a row at a time (up to four) or aside to the edge of the label in
  the way (up to 0.8 of its own width). A moved label prefers a spot off other tokens' pictures; a label alone is never moved.
  A label keeps the side it took while its token walks; once nothing is in the way it goes home.
- A moved label (more than 4 screen px) is tied to the top middle of its token by a thin line in its colour with a dot.
- The lines' pills (section 26) stand where they stand; the tokens' labels keep clear of them. Then the highlights' labels take
  their spots clear of all of them (120 ms after the last change: while a marked token walks they follow when it stops).
- The pointer moves nothing: the hover text of a label shows in the spot the label has.
- A label is drawn with its token, so a token whose picture is drawn LATER would cover it: those pictures count as hard for that
  label (as another label does) and it leaves them - up, aside, or to one more spot just under its own token. Measured live
  (lane 5, 2026-11-12): Atom Eve's pill under Omni-Man's picture (Omni-Man drawn later) went from hidden to readable above him.
- The highlights' labels (a warning on a zone) are drawn just above the tokens' pictures (primary group, sortLayer TOKENS + 10;
  the washes and lines stay under them): a warning that found no free spot is half on a token, never under it. They also keep
  clear of what other modules declared (`uiAvoid` boxes and `uiInset` bars, weight 6: twice a token) and look again 120 ms after
  the map stops panning. Nothing declared: as before.
- Not done: a token boxed in on every side lifts its label over a neighbour with a leader line that passes behind that neighbour
  (readable, but it can be read as the neighbour's); a label is not kept clear of Foundry's own token names and effect icons; the
  tokens' pills do not avoid the declared panels (a token under a panel has its pill under it).

### The menu

`menuSpot(anchor, w, h, vw, vh, { insets, avoid })`: the old spot (right of the thing, else left, level with its top) inside the
window less the declared insets; then, while that spot covers a box asked for: right or left of the thing at its top or bottom,
below or above it, left of the box in the way or above it. An axis whose declared bars leave less than the menu is given up for
the whole window. With no insets declared and nothing asked for, the menu stands exactly where it stood (a table without a combat
module looks unchanged). While open it is placed again on every pan and every 400 ms (a dock's panel that opens under it).

### The "My view" chip

`chipSpot(stage, w, h, avoid)` in the director's safe stretch (section 23): bottom centre 40 px up (where it always stood), then
sideways along that row in 48 px steps, then one or two rows higher, then the top centre; the first spot clear of the `uiAvoid`
boxes, the map's labels (`mapLabels`) and the labels of Foundry's movement ruler; else the least covered. Placed again every
300 ms while it shows, as before. A caller's own stylesheet must not pin it (the combat module's old `!important` rule is gone).

### `tactical`: how the token moved

`confirm(ctx)` (a drag, a level change) and `place(ctx)` (a GM's free placement) carry:

- `method`: Foundry's word for the move (`TokenMovementMethod`): `"dragging"`, `"keyboard"`, `"hud"`, `"config"`, `"api"`,
  `"paste"`, `"undo"`. Read from the update's options as Foundry records them (`options._movement[id].method`, else
  `options.movement[id].method`, else `options.method`); an update that says none is `"api"`. A change of level alone carries no
  movement: the map's own token-HUD altitude button (its menu and its right click, Orbit through it) says `"hud"`, anything else
  (`setLevel`, `setAltitude`, a macro, another module) `"api"`.
- `byHand`: `true` for `dragging`, `keyboard`, `hud`, `config` (a user's own hand: a slow drag is a drag however long it was held);
  `false` for `api`, `paste`, `undo` (a script, another module, an undo).

The map itself does nothing different with them: the drag is held and asked as before. A combat module that opens a menu of ways
for a drag skips it for `byHand: false` (a script's update is not a drag). A caller that reads neither field sees no change.

### For the caller

| Ledger row | Call |
| --- | --- |
| U116 labels on and near tokens overlap | nothing: the map lays its labels out; long labels end in an ellipsis on the pill, the tip has the whole |
| U116 the "My view" chip over labels and the session banner | `api.uiAvoid("<mod>.notice", ".my-notice")`; drop any rule that pins `.mm-dst-chip` |
| U106 a map menu over the dock | the dock declared with `uiInset({ bottom: "#dock" })` (section 23) now keeps menus above it; side panels with `uiAvoid` |
| U107 a drag or a script's update | `confirm(ctx)`: `ctx.byHand` (`ctx.method` for more); an older map has no such field: keep a guess for it |
