# Zones API for a combat module

`game.modules.get("moinen-maps").api.zones` (the same object as before; everything that existed still works as it did).
This file describes what package M1 added for tactical combat: stable zone keys, places with levels, the two distances,
routes, borders and zones as data, and events. Pure parts: `scripts/zones/keys.mjs`, `scripts/zones/places.mjs`,
`scripts/zones/marks.mjs`; wiring: `scripts/zones/zones.mjs`. Tests: `dev/zones-keys.test.mjs`, `dev/zones-places.test.mjs`,
`dev/zones-api.test.mjs`.

Not in M1 (later packages): drawing or highlighting anything new, picking a zone by click, editing UI for the new zone
attributes, the wall-plus-door border model and border states, movement interception, moving tokens.

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
  kind: "open" | "door" | "locked" | "wall" | "outer" | "reinforced",
  armor,                                   // 0 open, door 1, locked 2, wall 2, outer 3, reinforced 4 (table after 2405)
  door: bool, stops: { walk, air, through }, length (px), x, y   // the GM's mark, else the middle of the longest stretch
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
  props                                    // the raw merged marks (read-only)
}
api.zoneList() -> [zone, ...]
```

Stored attributes are written with the existing `api.setZone(id, patch)` (GM): `{ empty: true, tags: ["metal", ...],
terrain: "none", building, floors, ... }`. There is no editing UI for `empty` and `tags` yet (later task); `terrain`,
`building`, `floors`, `tall`, `water` already have theirs. `setZone` takes a zone **id**: use `api.idOf(key)`.
Zone states stay as they were (the registry with owner / level / end condition is M2).

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
| `borderChanged` | `border` (key), `zones: [key, key]`, `before`, `after` (kind; null = no such border), `source` | a border's kind changed, a border appeared or went |

- `cause`: `"move"` (x / y), `"level"` (altitude, floor, airborne), `"zones"` (the zones were redrawn or a building's
  floors changed under the token), `"create"`, `"delete"`. `userId`: who made the change (null for `"zones"`).
- A token event is told when the token's **document** changes (the start of the move), not when its animation ends, and
  after the fact: nothing here can stop or answer a move (that is M2, item 14).
- `levelChanged` is also true when only standing / flying changed (rooftop to airborne): `from.spot === to.spot` then.
- `source`: `"edit"` (this client's GM changed the zones), `"sync"` (another client's change arrived with the scene
  flag), `"layers"` (the fire, destruction or water layer changed what a zone reads as).
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
| Wrecking the zone | `api.zone(where).wreck`; mark it: `api.setZone(api.idOf(key), { wrecked: true })` (GM) |
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
