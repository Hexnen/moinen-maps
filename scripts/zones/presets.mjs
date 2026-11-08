/**
 * Movement presets: how a game system counts movement in zones. A preset turns "this token is N zones away" into what it costs
 * the character (a band: colour + words), for the zone numbers shown around a selected token and for the token ruler's label.
 *
 * @typedef ZoneMove   { key, name, level, range, stress }   a movement power: `range` zones in one action, `stress` with 1 stress
 * @typedef ZoneBand   { key, color, cost }                  `cost` = localized words ("1 quick action", "Flight: 1 action")
 * @typedef ZonePreset { id, title, moves(actor) -> ZoneMove[], band(d, moves) -> ZoneBand|null }
 *
 * More presets (other Year Zero games) register with registerPreset(); the scene stores the preset's id.
 */

const L = (k, d) => (d ? game.i18n.format(`MOINENMAPS.Zones.${k}`, d) : game.i18n.localize(`MOINENMAPS.Zones.${k}`));

/** "1 zone", "3 zones" - with the language's plural forms (Polish: 1 strefa, 3 strefy, 5 stref). */
export function zonesText(n) {
  let cat = "other";
  try { cat = new Intl.PluralRules(game.i18n.lang).select(n); } catch {}
  const key = `unit.${cat}`;
  return game.i18n.has(`MOINENMAPS.Zones.${key}`) ? L(key, { n }) : L("unit.other", { n });
}

const PRESETS = new Map();
export const registerPreset = (p) => PRESETS.set(p.id, p);
export const preset = (id) => PRESETS.get(id) ?? null;
export const presets = () => [...PRESETS.values()];

/* ---------------------------------------------------------------- none: only the count */

registerPreset({
  id: "none", title: "MOINENMAPS.Zones.preset.none",
  moves: () => [],
  band: (d) => (d === 0 ? { key: "here", color: 0xffffff, cost: "" } : { key: "count", color: 0xf3e7c9, cost: "" })
});

/* ---------------------------------------------------------------- Invincible (Free League, Year Zero) */

/**
 * Invincible - Superhero Roleplaying (core book, "Maps & Zones" and "Movement"):
 *  - distance = zone borders crossed on the shortest route; same zone = 0;
 *  - each round: one full and one quick action, or two quick actions (then no full action);
 *  - on foot: a quick action moves into an adjacent zone; moving inside a zone is free;
 *  - movement powers (Burrowing, Flight, Leaping, Super-Speed, Swimming, Swinging, Teleportation) move 2 zones in one (quick or full)
 *    action, 4 with 1 point of stress; Major 4/8, Massive 8/16, Monstrous 16/32.
 * Swimming only works in water, so it is listed but never picked as the best way across the map.
 */
const INV_POWERS = {
  flight: ["flight", "lot", "latanie"],
  leaping: ["leaping", "skoki", "skakanie"],
  superspeed: ["superspeed", "superszybkosc", "supersprint"],
  teleportation: ["teleportation", "teleportacja"],
  swinging: ["swinging", "bujanie", "huśtanie", "hustanie"],
  burrowing: ["burrowing", "kopanie", "drazenie"],
  swimming: ["swimming", "plywanie"]
};
const LEVELS = ["basic", "major", "massive", "monstrous"];
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

/** The level of an Invincible power item (0 basic .. 3 monstrous), the way the system works it out (item-power.mjs). */
function invLevel(item) {
  const s = item.system ?? {};
  const own = LEVELS.indexOf(String(s.level ?? "").toLowerCase());
  if ( own >= 0 ) return own;
  let level = 0;
  for ( const a of Object.values(s.automations ?? {}) ) {
    if ( !a?.showAsSelection ) continue;
    const n = String(a.name ?? "").toLowerCase();
    LEVELS.forEach((l, i) => { if ( n.includes(l) ) level = Math.max(level, i); });
  }
  return level;
}

function invMoves(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    if ( item.type !== "power" ) continue;
    const n = norm(item.name);
    const key = Object.keys(INV_POWERS).find((k) => INV_POWERS[k].some((w) => n === norm(w) || n.startsWith(norm(w))));
    if ( !key ) continue;
    const level = invLevel(item), range = 2 * 2 ** level;
    out.push({ key, name: item.name, level, range, stress: range * 2 });
  }
  return out.sort((a, b) => b.range - a.range);
}

const INV_COLORS = { here: 0xffffff, walk1: 0x7bd88f, power: 0x5cc8ff, walk2: 0xf2c14e, powerStress: 0xc38bff, far: 0xe06666 };

registerPreset({
  id: "invincible", title: "MOINENMAPS.Zones.preset.invincible",
  moves: invMoves,
  band(d, moves = []) {
    if ( d == null ) return null;
    const best = moves.find((m) => m.key !== "swimming");
    const b = (key, cost) => ({ key, color: INV_COLORS[key], cost });
    if ( d === 0 ) return b("here", L("inv.here"));
    if ( d === 1 ) return b("walk1", L("inv.walk1"));
    if ( best && d <= best.range ) return b("power", L("inv.power", { power: best.name }));
    if ( d === 2 ) return b("walk2", L("inv.walk2"));
    if ( best && d <= best.stress ) return b("powerStress", L("inv.powerStress", { power: best.name }));
    return b("far", L("inv.far"));
  }
});
