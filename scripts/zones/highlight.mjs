/**
 * Highlights and zone picking - the pure part (no Foundry, no PIXI): what a highlight is, who sees it, which one shows on a zone
 * that several name, and what a pick request is. The drawing is highlight-layer.mjs, the wiring (API, the module socket, the
 * pointer) is interact.mjs. Described for callers in dev/zones-api.md (sections 17-18).
 *
 * A HIGHLIGHT is a named set of zones and borders, each with a colour, a line style and an optional short label, shown to chosen
 * users until it is cleared (a combat module: the zones a mover can reach with their cost, the zones in range, the border about
 * to be breached). The map draws what it is given: it does not work out what to highlight.
 *
 *   highlight = { id, zones: [entry, ...], borders: [entry, ...], users, order }
 *   zone entry   = { zone (key), color (0xRRGGBB), style: "fill" | "outline" | "dashed", label: string | null, tip: string | null }
 *   border entry = { border ("z1|z2"), color, style: "solid" | "dashed", label, tip }
 *   users        = null (only the client that made it) | "all" | "gm" | [userId, ...]
 *   order        = a number: where several highlights name the same zone, the highest shows (then the one set last)
 */

/** The named colours (the ones the distance badges already use, so a highlight reads like the rest of the zones). */
export const COLORS = Object.freeze({
  move: 0x5cc8ff,       // reachable
  free: 0x7bd88f,       // reachable at no cost, allowed, friendly
  stress: 0xf2c14e,     // reachable at a price
  range: 0xc38bff,      // in range, an area of effect
  danger: 0xe06666,     // about to be breached, hostile, harmful
  target: 0xff9d4d,     // the one chosen
  info: 0xf3e7c9,       // neutral (the zones' own ink)
  here: 0xffffff,
  blocked: 0x8a8580
});
export const ZONE_STYLES = ["fill", "outline", "dashed"];
export const BORDER_STYLES = ["solid", "dashed"];
export const LIMITS = Object.freeze({ id: 64, label: 28, tip: 160, entries: 600, title: 80 });
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** A colour as a number: a name of COLORS, "#rrggbb" / "#rgb", or a number; `fallback` when it is none of these. */
export function colorOf(c, fallback = COLORS.move) {
  if ( typeof c === "number" && Number.isFinite(c) ) return Math.max(0, Math.min(0xffffff, Math.round(c)));
  if ( typeof c !== "string" ) return fallback;
  if ( c in COLORS ) return COLORS[c];
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(c.trim());
  if ( !m ) return fallback;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
  return Number.parseInt(h, 16);
}

const text = (v, max) => { if ( v == null || v === "" ) return null; const s = String(v).replace(/\s+/g, " ").trim(); return s ? s.slice(0, max) : null; };
/** The zone key of whatever names a zone in an entry: a key, a spot string ("z3:f2" -> "z3"), a place or zone object. */
export function zoneKeyOf(w) {
  if ( typeof w === "string" ) { const k = w.split(":")[0]; return k && k[0] !== "@" ? k : null; }
  if ( w && typeof w === "object" ) return typeof w.zone === "string" ? zoneKeyOf(w.zone) : typeof w.key === "string" && !w.key.includes("|") ? zoneKeyOf(w.key) : typeof w.spot === "string" ? zoneKeyOf(w.spot) : null;
  return null;
}
/** A border key ("z1|z2", its two zone keys sorted) from a key, a border object or a pair of things that name zones. */
export function borderKeyOf(w) {
  let a, b;
  if ( typeof w === "string" ) [a, b] = w.split("|");
  else if ( Array.isArray(w) ) { a = zoneKeyOf(w[0]); b = zoneKeyOf(w[1]); }
  else if ( w && typeof w === "object" ) {
    const k = w.border ?? w.key ?? w.zones ?? null;
    return typeof k === "string" || Array.isArray(k) ? borderKeyOf(k) : null;
  }
  if ( !a || !b || a === b ) return null;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Who a highlight is for, cleaned: null (the maker's own client only), "all", "gm", or a list of user ids. */
export function cleanUsers(u, me = null) {
  if ( u == null || u === false || u === "me" || u === "self" ) return null;
  if ( u === "all" || u === true ) return "all";
  if ( u === "gm" ) return "gm";
  const list = (Array.isArray(u) ? u : [u]).map((x) => (x && typeof x === "object" ? x.id : x)).filter((x) => typeof x === "string" && x);
  const ids = [...new Set(list)];
  if ( !ids.length || (ids.length === 1 && ids[0] === me) ) return null;
  return ids;
}

/**
 * A highlight, cleaned (see the top). `spec.color`, `spec.style` are the defaults of its entries; an entry is a key / spot string
 * or an object with its own colour, style, label and tip. null: nothing to show (no id that can be kept, no entry that names
 * anything).
 */
export function cleanHighlight(spec, me = null) {
  if ( !spec || typeof spec !== "object" ) return null;
  const id = spec.id == null ? null : String(spec.id);
  if ( id != null && !ID_RE.test(id) ) return null;
  const color = colorOf(spec.color), style = ZONE_STYLES.includes(spec.style) ? spec.style : "fill";
  const zones = [], borders = [], seenZ = new Set(), seenB = new Set();
  for ( const e of Array.isArray(spec.zones) ? spec.zones.slice(0, LIMITS.entries) : [] ) {
    const zone = zoneKeyOf(e), o = e && typeof e === "object" ? e : {};
    if ( !zone || seenZ.has(zone) ) continue;
    seenZ.add(zone);
    zones.push({ zone, color: colorOf(o.color, color), style: ZONE_STYLES.includes(o.style) ? o.style : style, label: text(o.label, LIMITS.label), tip: text(o.tip, LIMITS.tip) });
  }
  const bstyle = BORDER_STYLES.includes(spec.borderStyle) ? spec.borderStyle : spec.style === "dashed" ? "dashed" : "solid";
  for ( const e of Array.isArray(spec.borders) ? spec.borders.slice(0, LIMITS.entries) : [] ) {
    const border = borderKeyOf(e), o = e && typeof e === "object" && !Array.isArray(e) ? e : {};
    if ( !border || seenB.has(border) ) continue;
    seenB.add(border);
    borders.push({ border, color: colorOf(o.color, colorOf(spec.borderColor, color)), style: BORDER_STYLES.includes(o.style) ? o.style : bstyle, label: text(o.label, LIMITS.label), tip: text(o.tip, LIMITS.tip) });
  }
  if ( !zones.length && !borders.length ) return null;
  const order = Number.isFinite(Number(spec.order)) ? Number(spec.order) : 0;
  return { id, zones, borders, users: cleanUsers(spec.users, me), order };
}

/**
 * Where a highlight goes from the client that makes it: { local, remote } - `local`: shown on this client; `remote`: null (nobody
 * else), "all" (every other client) or a list of user ids. `users`: cleanUsers(); `me`: this user's id; `gms`: the ids of the GMs.
 */
export function audience(users, me, gms = []) {
  if ( users == null ) return { local: true, remote: null };
  if ( users === "all" ) return { local: true, remote: "all" };
  const ids = users === "gm" ? gms : users;
  const others = ids.filter((id) => id !== me);
  return { local: ids.includes(me), remote: others.length ? others : null };
}

/**
 * The highlights of one client: kept by id, counted (`version` grows with every change, what the drawing's cache hangs on).
 */
export class HighlightStore {
  #map = new Map(); #seq = 0; #auto = 0;
  version = 0;
  get size() { return this.#map.size; }
  /** Keep a cleaned highlight (one with the same id is replaced); gives it an id when it has none. Returns the id. */
  set(h, from = null) {
    const id = h.id ?? `h${++this.#auto}`;
    this.#map.set(id, { ...h, id, seq: ++this.#seq, from });
    this.version++;
    return id;
  }
  has(id) { return this.#map.has(id); }
  get(id) { return this.#map.get(id) ?? null; }
  /** Drop one by id, those whose id starts with `prefix`, those that came from `from`, or (no argument) all: the ids dropped. */
  remove({ id = null, prefix = null, from = undefined } = {}) {
    const out = [];
    for ( const [k, h] of this.#map ) {
      if ( id != null && k !== id ) continue;
      if ( prefix != null && !k.startsWith(prefix) ) continue;
      if ( from !== undefined && h.from !== from ) continue;
      out.push(k);
    }
    for ( const k of out ) this.#map.delete(k);
    if ( out.length ) this.version++;
    return out;
  }
  list() { return [...this.#map.values()]; }
  /**
   * What shows now: { zones: Map zoneId -> entry, borders: Map pairKey -> entry } - where several highlights name the same zone or
   * border, the one with the highest `order` (then the one set last). `idOf(key)` -> zone id (-1: no such zone now), `pairOf(a, b)`
   * -> the pair key of two neighbouring zone ids, or null when they are not neighbours.
   */
  compose(idOf, pairOf) {
    const zones = new Map(), borders = new Map();
    const rows = this.list().sort((a, b) => a.order - b.order || a.seq - b.seq);
    for ( const h of rows ) {
      for ( const e of h.zones ) { const id = idOf(e.zone); if ( id >= 0 ) zones.set(id, { ...e, id, of: h.id }); }
      for ( const e of h.borders ) {
        const [ka, kb] = e.border.split("|"), a = idOf(ka), b = idOf(kb), pk = a >= 0 && b >= 0 ? pairOf(a, b) : null;
        if ( pk ) borders.set(pk, { ...e, a, b, of: h.id });
      }
    }
    return { zones, borders };
  }
}

/** Zone entries by what draws them together: [{ color, style, ids: [zoneId, ...] }] (a group is one fill and one inner line). */
export function groups(zones) {
  const by = new Map();
  for ( const e of zones.values() ) {
    const k = `${e.color}|${e.style}`;
    (by.get(k) ?? by.set(k, { color: e.color, style: e.style, ids: [] }).get(k)).ids.push(e.id);
  }
  return [...by.values()];
}

/**
 * A request to pick a zone, cleaned:
 *   { zones: null (any zone) | [{ zone, spot, label, tip, color }], title, hint, color, timeout (ms, 0: none) }
 * `zones` entries: a key or spot string ("z3", "z3:elevated": the place the pick answers with), or { zone | spot, label, tip, color }.
 * null: a list was given and none of it names a zone (nothing could be picked).
 */
export function cleanPick(o = {}) {
  o = o && typeof o === "object" ? o : {};
  const color = colorOf(o.color, COLORS.move);
  let zones = null;
  if ( Array.isArray(o.zones) ) {
    zones = [];
    const seen = new Set();
    for ( const e of o.zones.slice(0, LIMITS.entries) ) {
      const obj = e && typeof e === "object" ? e : {};
      const spot = typeof e === "string" ? e : typeof obj.spot === "string" ? obj.spot : typeof obj.zone === "string" ? obj.zone : typeof obj.key === "string" ? obj.key : null;
      const zone = zoneKeyOf(spot);
      if ( !zone || seen.has(zone) ) continue;
      seen.add(zone);
      zones.push({ zone, spot, label: text(obj.label, LIMITS.label), tip: text(obj.tip, LIMITS.tip), color: colorOf(obj.color, color) });
    }
    if ( !zones.length ) return null;
  }
  const t = Number(o.timeout);
  return { zones, title: text(o.title, LIMITS.title), hint: text(o.hint, LIMITS.tip), color, timeout: Number.isFinite(t) && t > 0 ? Math.min(t, 3600000) : 0 };
}

/** A label as it is written on the map: at most `max` characters, the rest cut with an ellipsis. */
export const shortLabel = (s, max = LIMITS.label) => (s == null ? "" : s.length > max ? `${s.slice(0, max - 1)}…` : s);
