/**
 * Movement presets: how a game system counts movement in zones. A preset turns "this token is N zones away" into what it costs
 * the character (a band: colour + words), for the zone numbers shown around a selected token and for the token ruler's label.
 *
 * @typedef ZoneMove   { key, name, level, range, stress }   a movement power: `range` zones in one action, `stress` with 1 stress
 * @typedef ZoneBand   { key, color, cost, d }               `cost` = localized words ("1 quick action", "Flight: 1 action"); `d` = the
 *                                                           zones counted for it (by the way of moving it picked), null when no way
 * @typedef ZoneDist   number | { walk, air, through, swim, swing }   zones by each way of moving (scripts/zones/marks.mjs; undefined = blocked)
 * @typedef ZonePreset { id, title, moves(actor) -> ZoneMove[], band(d: ZoneDist, moves) -> ZoneBand|null }
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
  band(dd) {
    const d = typeof dd === "number" ? dd : (dd?.walk ?? dd?.air ?? dd?.through);
    if ( d == null ) return dd == null ? null : { key: "blocked", color: 0x8a8580, cost: "", d: null };
    return d === 0 ? { key: "here", color: 0xffffff, cost: "", d } : { key: "count", color: 0xf3e7c9, cost: "", d };
  }
});

/* ---------------------------------------------------------------- Invincible (Free League, Year Zero) */

/**
 * Invincible - Superhero Roleplaying (core book, "Maps & Zones" and "Movement"):
 *  - distance = zone borders crossed on the shortest route; same zone = 0;
 *  - each round: one full and one quick action, or two quick actions (then no full action);
 *  - on foot: a quick action moves into an adjacent zone; moving inside a zone is free;
 *  - movement powers (Burrowing, Flight, Leaping, Super-Speed, Swimming, Swinging, Teleportation) move 2 zones in one (quick or full)
 *    action, 4 with 1 point of stress; Major 4/8, Massive 8/16, Monstrous 16/32.
 * Each power counts its own route (scripts/zones/marks.mjs): Flight, Leaping and Super-Speed go over buildings (only inner walls and
 * locked doors stop them), Swinging likewise but only ends in a building or a zone with tall features, Burrowing and Teleportation
 * ignore every wall, Swimming only moves through water. Walking stops at every wall and locked door.
 */
const INV_WAY = { flight: "air", leaping: "air", superspeed: "air", swinging: "swing", burrowing: "through", teleportation: "through", swimming: "swim" };
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

const INV_COLORS = { here: 0xffffff, walk1: 0x7bd88f, power: 0x5cc8ff, walk2: 0xf2c14e, powerStress: 0xc38bff, far: 0xe06666, blocked: 0x8a8580 };

registerPreset({
  id: "invincible", title: "MOINENMAPS.Zones.preset.invincible",
  moves: invMoves,
  band(dd, moves = []) {
    if ( dd == null ) return null;
    // a plain number: every way of moving counts the same (no walls known); swimming then needs water, so it is left out
    const D = typeof dd === "number" ? { walk: dd, air: dd, through: dd, swing: dd } : dd;
    const b = (key, cost, d) => ({ key, color: INV_COLORS[key], cost, d });
    const walk = D.walk;
    if ( walk === 0 ) return b("here", L("inv.here"), 0);
    if ( walk === 1 ) return b("walk1", L("inv.walk1"), 1);
    // the powers that get there, each by its own route; the shortest route wins
    const by = moves.map((m) => ({ m, d: D[INV_WAY[m.key]] })).filter((o) => o.d != null && o.d > 0).sort((x, y) => x.d - y.d || y.m.range - x.m.range);
    const one = by.find((o) => o.d <= o.m.range);
    if ( one ) return b("power", L("inv.power", { power: one.m.name }), one.d);
    if ( walk === 2 ) return b("walk2", L("inv.walk2"), 2);
    const stress = by.find((o) => o.d <= o.m.stress);
    if ( stress ) return b("powerStress", L("inv.powerStress", { power: stress.m.name }), stress.d);
    if ( walk == null && !by.length ) return b("blocked", L("inv.blocked"), null);
    return b("far", L("inv.far"), walk ?? by[0].d);
  }
});
