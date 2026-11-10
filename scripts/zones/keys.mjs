/**
 * Stable zone keys (pure, no Foundry). A zone's id is its place in the reading order of the map (top to bottom, left to right), so
 * it changes whenever the pencil lines change; other modules (a combat engine, an undo log) need a name that does not.
 *
 * A key is kept the way the marks are kept (marks.mjs): as a point. The scene stores anchors `[key, x, y]`; the zone an anchor lies
 * in carries its key, whatever the zone is numbered now. A zone with no anchor gets a provisional key, worked out the same way on
 * every client (`z<n>`, counting on from the scene's key counter in id order), and the GM's next edit writes it down as an anchor
 * (`pin`) before the lines change - so a provisional key is already the key the zone keeps.
 *
 *  - a scene saved before keys existed has no anchors and counter 1: its zones are z1, z2, ... in id order (key = number shown, at
 *    first), on every client, with nothing written until the GM edits the zones;
 *  - a zone cut in two: the half with the anchor keeps the key, the other half gets a new one;
 *  - two zones joined: the older anchor names the zone; the other stays stored (dormant) and names its half again if the line returns;
 *  - a key is never handed out twice: dormant keys stay reserved and the counter only grows.
 *
 * Keys of zones are `[A-Za-z0-9_-]+`; the areas off the map have reserved keys starting with "@" (places.mjs), and "|" joins two
 * zone keys into a border key, so neither character can appear in a zone key.
 */

export const KEY_RE = /^[A-Za-z0-9_-]{1,24}$/;
/** Dormant anchors kept at most (the oldest go first); live ones are never dropped. */
export const ANCHORS_MAX = 512;

const r1 = (v) => Math.round(v * 10) / 10;

/** Anchors as stored: well-formed, one per key (the first wins). */
export function cleanAnchors(list) {
  const out = [], seen = new Set();
  for ( const a of Array.isArray(list) ? list : [] ) {
    if ( !Array.isArray(a) ) continue;
    const [key, x, y] = a;
    if ( typeof key !== "string" || !KEY_RE.test(key) || !Number.isFinite(x) || !Number.isFinite(y) || seen.has(key) ) continue;
    seen.add(key); out.push([key, x, y]);
  }
  return out;
}

/**
 * The keys of the zones as they are now.
 * @param {object|null} Z                  buildZones() result
 * @param {Array<[string, number, number]>} anchors
 * @param {number} next                    the scene's key counter (the number of the next new key)
 * @param {(x: number, y: number) => number} zoneAt
 * @returns {{ keyOf: Map<number, string>, idOf: Map<string, number>, pinned: Map<number, number>, next: number }}
 *          `pinned`: zone id -> index of its anchor; `next`: the counter after the provisional keys
 */
export function resolve(Z, anchors, next, zoneAt) {
  const keyOf = new Map(), idOf = new Map(), pinned = new Map();
  let n = Math.max(1, Math.floor(Number(next) || 1));
  if ( !Z ) return { keyOf, idOf, pinned, next: n };
  const used = new Set();
  (anchors ?? []).forEach(([key, x, y], i) => {
    used.add(key);
    if ( idOf.has(key) ) return;
    const id = zoneAt(x, y);
    if ( id < 0 || keyOf.has(id) ) return;
    keyOf.set(id, key); idOf.set(key, id); pinned.set(id, i);
  });
  for ( const z of Z.zones ) {
    if ( keyOf.has(z.id) ) continue;
    let key;
    do key = `z${n++}`; while ( used.has(key) );
    keyOf.set(z.id, key); idOf.set(key, z.id);
  }
  return { keyOf, idOf, pinned, next: n };
}

/**
 * Write the keys down: every zone gets an anchor at its label point (a point well inside it), a zone that had one has it moved
 * there (so the anchor stays deep inside while the zone's outline is redrawn); anchors that name no zone now stay as they are.
 * @returns {{ anchors: Array<[string, number, number]>, next: number, changed: boolean }}
 */
export function pin(Z, anchors, next, zoneAt, max = ANCHORS_MAX) {
  const list = anchors ?? [];
  if ( !Z ) return { anchors: list, next: Math.max(1, Math.floor(Number(next) || 1)), changed: false };
  const R = resolve(Z, list, next, zoneAt);
  const byId = new Map(Z.zones.map((z) => [z.id, z]));
  // the label point, when it still reads as this zone after rounding (else the anchor stays where it was / the zone waits)
  const spot = (id) => { const l = byId.get(id)?.label; if ( !l ) return null; const x = r1(l.x), y = r1(l.y); return zoneAt(x, y) === id ? [x, y] : null; };
  const live = new Set(R.pinned.values());
  let out = list.map((a, i) => {
    if ( !live.has(i) ) return a;
    const p = spot(R.idOf.get(a[0]));
    return p ? [a[0], p[0], p[1]] : a;
  });
  let n = Math.max(1, Math.floor(Number(next) || 1));
  for ( const z of Z.zones ) {
    if ( R.pinned.has(z.id) ) continue;
    const p = spot(z.id);
    if ( !p ) continue;
    out.push([R.keyOf.get(z.id), p[0], p[1]]);
    // the counter passes every key written down (a zone that could not be pinned keeps counting from here)
    const m = /^z(\d+)$/.exec(R.keyOf.get(z.id));
    if ( m ) n = Math.max(n, Number(m[1]) + 1);
  }
  if ( out.length > max ) {
    const names = new Set(resolve(Z, out, n, zoneAt).pinned.values());
    let drop = out.length - max;
    out = out.filter((_, i) => names.has(i) || drop-- <= 0);
  }
  return { anchors: out, next: n, changed: n !== next || JSON.stringify(out) !== JSON.stringify(list) };
}
