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
api.zoneOfToken(token) -> place | null                null: a token of a scene that is not open
api.tokensInZone(where, { anyLevel }) -> [{ token: TokenDocument, place }]
        a bare key or id: every level of the zone; a spot, a place or a token: that level only (the book's "same zone");
        anyLevel: true / false overrides. "@sky" etc.: everyone in that area.
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
api.zoneStates(where) -> [state, ...]                    every state of a zone as records: the registry's, the GM's own marks
        (id "mark:fire", source "mark"), what the map's layers show (id "map:wrecked", source "map"). A bare key or id: every
        level; a spot, a place or a token: that level and the states that name none
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
| `{ op: "zone", zone, patch }` | the zone's own marks, as `setZone` (attributes, features, the GM's state marks; a fire is painted / put out on the fire layer) | zone data | `{ op: "zone", zone, patch }` with the own values before |
| `{ op: "tokens", rows: [{ id, x, y, alt, floor, air }] }` | puts tokens somewhere (position and this module's level flags) | their places | the same op with where they were |
| `{ op: "batch", ops: [...] }` | all or nothing (a failure takes back what was done, `at`: its index); told and saved once | the results | a batch of the inverses, last first |

- The shorthand calls (`setBorderState`, `buildBorder`, `restoreBorders`, `addZoneState`, `updateZoneState`, `removeZoneState`,
  `addEdge`, `removeEdge`) are `apply` with one op and return the same.
- `changed: false`: the write asked for what already was (nothing told, nothing saved); the inverse is still valid.
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
api.reach(where, profile, { max }) -> [{ zone, id, d, cost }]        nearest first, the mover's own zone first (d 0); horizontal steps
api.plan(a, b, profile) -> null | { way, name, total, borders, edges, levels, zones, steps, crossed, cost, from, end }
```

`plan` is `path` (section 4) for a profile: the same steps, plus steps of kind `"edge"` (`{ kind: "edge", from, to, zone, level,
floor, edge }`), `cost`, and the two places `from` / `end`. With no usable edge and no `force` it is step for step what `path`
gives. With `force` a border that stops the mover is on the route with `border.blocked: true` (its `wall` and `doorway` say
what stands there). null: no route, an off-map end (that is a level change: `setLevel`, `moveToZone`), an end in the air for a
mover that must land, a place this way of moving cannot be at.

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
          statesFrom, statesTo }    // the states of the zone left and of the zone entered (section 10)
  ```
  Entering fire (2925), leaving darkness (1654), a wall on the way (2418-2419), a ward's zone (2876): the listener looks at
  `statesTo` / `statesFrom` / `border`, does what the rules say and answers.
- **Group moves** (`group`: tokens that go along - carried 2392, pulled in a grapple 2497, passengers, a group of minions
  2826, Teleport Allies 2038): every step is one write of all the movers, each to a free spot of its own in the same zone and
  on the same level; one `op`, one inverse.
- `drop: { x, y }`: where in the last zone to end up near. `wait` (default true): each step waits for the tokens to get there.
  `data`: handed to the listeners (the action it belongs to). `options`: for the token updates.
- Result: `done` steps taken of `total`; `stopped: null | { index, reason, data, step }`; `place`: where the mover is;
  `inverse`: a `tokens` op that puts every mover back where it started (null when no step was taken).
- Events on the client that runs the move: `moveStarted { op, token, uuid, group, forced, way, total, zones }`, `moveStep
  { ..., index, step, place }`, `moveEnded { ..., done, total, stopped, place }`. Every client still gets `tokenLeft` /
  `tokenEntered` per step, with `move: op`.
- Runs on the client that calls it; the tokens must be the caller's to move (`notOwner`). Other refusals: `noToken`,
  `badProfile`, `noRoute`, `stalePlan`.

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

## 16. Limits and open points (M2)

- Nothing of M2 has run in Foundry: `preUpdateToken` cancelling a v14 drag, `updateEmbeddedDocuments` with `x` / `y` for a
  group, waiting for `movementAnimationPromise`, `DialogV2.confirm`, the drawing of walls and doors, and what a second client
  sees are verified against a stand-in only (`dev/zones-play.test.mjs`).
- The planner treats an edge as joining two zones; the levels of its ends are reported, not enforced.
- A forced chain follows the map's surface: no vertical direction (up into the air, down a floor).
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
  user: userId                        // a GM's call: ask that user; absent: this client's user
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
- The zones on offer follow the map: when lines change mid-pick the offer is counted again; a scene change ends the pick.
- Asked of another user, the request goes to that user alone and the answer comes back to the asker alone; the user leaving
  resolves with `userGone`. A pick request is taken from a GM only.

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

