/**
 * Who may bake and publish a scene's damage when clients run different bake versions (pure, node-tested: dev/bake-policy.test.mjs).
 *
 * A base key is "<bake version>:<the rest>" (store.mjs baseKey). The rules, so two clients can never take turns re-baking and
 * re-publishing the same scene (each one's manifest making the other bake again):
 *   - a manifest of a NEWER version than this client's is used as it is (its chunks show the strokes) and never overwritten here: this
 *     client runs older code and says so; it does not bake for it either;
 *   - a manifest of the same version and settings is the normal case (chunks; only what is missing is baked);
 *   - an OLDER version (or other settings) is baked here and published (the older look may stand in meanwhile, store.mjs staleOk);
 *   - a BREAKER per client: the same set of strokes (the scene key) baked or published more than LIMIT times within WINDOW means
 *     something keeps undoing it - automatic baking and publishing stop, the status says why, a manual "Bake now" goes on.
 */
export const verOf = (base) => { const v = Number(String(base ?? "").split(":")[0]); return Number.isFinite(v) ? v : -1; };
export const restOf = (base) => String(base ?? "").split(":").slice(1).join(":");

/** "none" | "same" | "newer" (the manifest is newer than this client) | "older" | "other" (other settings, map or grid). */
export function manifestRule(manifestBase, myBase) {
  if ( !manifestBase ) return "none";
  if ( manifestBase === myBase ) return "same";
  if ( restOf(manifestBase) !== restOf(myBase) ) return "other";
  return verOf(manifestBase) > verOf(myBase) ? "newer" : "older";
}

/** May this client write its manifest over the scene's? Never over a newer version's. */
export const mayPublish = (manifestBase, myBase) => !manifestBase || verOf(manifestBase) <= verOf(myBase);

export const LIMIT = 2, WINDOW = 120000;

/** The per-client breaker: `hit(kind, key)` -> true when allowed (and counted), false when tripped. */
export class Breaker {
  constructor({ limit = LIMIT, window = WINDOW, now = () => Date.now() } = {}) { Object.assign(this, { limit, window, now, log: [], tripped: null }); }
  hit(kind, key) {
    const t = this.now();
    this.log = this.log.filter((e) => t - e.t < this.window);
    if ( this.tripped ) return false;
    const n = this.log.filter((e) => e.kind === kind && e.key === key).length;
    if ( n >= this.limit ) { this.tripped = { kind, key, at: t, n: n + 1 }; return false; }
    this.log.push({ kind, key, t });
    return true;
  }
  /** A manual "Bake now": everything allowed again. */
  reset() { this.tripped = null; this.log = []; }
}
