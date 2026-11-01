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

/*
 * VISUAL COMPATIBILITY OF BAKE VERSIONS. A version that only changes DETAILS of the look (colours, specks, lips, hairlines, a cause's
 * treatment, shading) - not WHICH pixels are damaged, not the chunk layout - declares the version before it as compatible:
 *     BAKE_VERSIONS[30] = { compat: 29, note: "cracks as a hierarchy" }
 * A scene published by a compatible older version is then shown as it is (no wait, no bake at load); the new look is baked later in
 * the background when the tab is idle (or on "Rebake all", or never - the client setting), and swapped in stroke by stroke. A bump that
 * changes the damage's shape or the chunk format declares NO compat (an older scene is then re-baked at load, its old look shown only
 * while that runs). Compatibility is transitive along the chain: 31 -> 30 -> 29 means a 29 scene is compatible with 31.
 */
export const BAKE_VERSIONS = {
  25: { compat: 24, note: "substrates: newer strokes read the older damage under them" },
  26: { compat: 25 }, 27: { compat: 26, note: "dominant hairlines, dust-puff shock" }, 28: { compat: 27, note: "cause specks and halos" },
  29: { compat: 28, note: "torn lip ink, short cave-in hairlines" }, 30: { compat: 29, note: "cracks as a hierarchy" },
  31: { compat: 30, note: "cause treatments: bolts, sigils, rim, scratches, erosion, rime" },
  32: { compat: 31, note: "crack plates a little bigger at the crater level" },
  33: { compat: 32, note: "lightning forks at 30-60 degrees off the channel" },
  // 35 changes a tear's SHAPE (asymmetric opening, flaps torn off, inset from the stroke's border): no compat, re-baked at load
  35: { compat: null, note: "tears: asymmetric opening, flaps that curl or tear off, snapping fibres" },
  // 36 changes a cave-in's SHAPE (an organic pit, a trench along a followed stroke): no compat, re-baked at load
  36: { compat: null, note: "collapse: organic pit or trench, rings of tilted lit slabs, layered wall and void" },
  37: { compat: 36, note: "cracks readable at max settings (milder warp, fewer tiny plates)" },
  38: { compat: 37, note: "lightning lip without a white outline" },
  39: { compat: 38, note: "tears: short flap seams, slanted short fibres, dithered wall strata" },
  // 40 changes a cave-in's SHAPE (its outline from the smoothed mask, a finer rim wobble, a wider window): no compat, re-baked at load
  40: { compat: null, note: "collapse: whole level-1 outline, no straight rim runs" },
  41: { compat: null, note: "crack strokes, smooth floors, sinking flood pieces" },
  42: { compat: 41, note: "cause floors and specks calmer, claws three gouges" },
  // 43 changes a cave-in's SHAPE (an asymmetric outline, islands dropped, a trench's pockets, a deeper level's wider pit): no compat
  43: { compat: null, note: "collapse: one-bowl sag at level 1, shard lip, strata band and bigger void, no outward hairlines" },
  44: { compat: null, note: "crack strokes reshaped, blast/scorch floors" },
  45: { compat: 44, note: "cause specks clustered" },
  46: { compat: null, note: "cause identities beyond colour: claw furrows, compact impact crater, standing water, faceted ice, acid pits, sagging rot; tear silhouettes per cause" },
  47: { compat: 46, note: "frost facet edges broken, no cross through the centre" },
  48: { compat: null, note: "crack generator rebuilt" },
  49: { compat: 48, note: "cause specks as tonal patches" },
  50: { compat: null, note: "wood cracks with weight, banded cave-in slabs" },
  51: { compat: null, note: "cause geometry broken up (spokes, acid pits, claw streaks, moss), tear zig-zag and star irregular" },
  52: { compat: 51, note: "cave-in slabs textured: lit edge, rim-to-void gradient, seams" },
  53: { compat: 52, note: "fire ember bed, seams and lip glow in the light sprite (day pixels unchanged)" }
};

/*
 * VERSION PINNING (0.4.2). A published stroke keeps the look it was baked with: its chunk stays valid whatever the module's bake version
 * is now. It is baked again only when the stroke itself changes (its signature: pixels, kind, cause, path, the settings and the
 * strokes under it), when its chunk is missing or unreadable, or when the user asks ("Rebake all", a stroke's own Rebake). A new
 * stroke is baked with the current code. An update of the module therefore never re-bakes a scene by itself.
 *
 * Which strokes then show an OLDER LOOK than the current code would draw: those whose recorded version is below the latest version
 * that touched their kind (or their cause). Every BAKE_VERSIONS entry names what it touched:
 *     NN: { kinds: ["gash"], note: "..." }       a kind: blast, collapse, scorch, flood, cracks, gash (the tear)
 *     NN: { kinds: ["cause"], note: "..." }      the cause treatments (strokes with a cause, their own or the scene's)
 *     NN: { kinds: ["global"], note: "..." }     everything (no `kinds` counts as global too)
 * `compat` is no longer read for validity (kept as history); a bump's only effect is the "older look" count and Rebake all.
 */
const KIND_OF_VERSION = {
  25: ["global"], 26: ["global"], 27: ["global"], 28: ["cause"], 29: ["gash", "collapse"], 30: ["cracks"], 31: ["cause"], 32: ["cracks"],
  33: ["cause"], 35: ["gash"], 36: ["collapse"], 37: ["cracks"], 38: ["cause"], 39: ["gash"], 40: ["collapse"], 41: ["cracks", "flood"],
  42: ["cause"], 43: ["collapse"], 44: ["cracks", "blast", "scorch"], 45: ["cause"], 46: ["cause", "gash"], 47: ["cause"], 48: ["cracks"],
  49: ["cause"], 50: ["cracks", "collapse"], 51: ["cause", "gash"], 52: ["collapse"], 53: ["cause"]
};
for ( const [v, kinds] of Object.entries(KIND_OF_VERSION) ) if ( BAKE_VERSIONS[v] && !BAKE_VERSIONS[v].kinds ) BAKE_VERSIONS[v].kinds = kinds;

/**
 * The version the current code would give a stroke of `kind` (with or without a cause): the newest entry up to `now` that touched it.
 * Versions with no entry (before the table) count as global.
 */
export function strokeVersion(kind, hasCause, now, table = BAKE_VERSIONS) {
  for ( let v = now; v > 0; v-- ) {
    const e = table[v];
    const kinds = e ? (e.kinds?.length ? e.kinds : ["global"]) : (v < 25 ? ["global"] : []);
    if ( kinds.includes("global") || kinds.includes(kind) || (hasCause && kinds.includes("cause")) ) return v;
  }
  return 0;
}

/** Does a stroke baked at `ver` show an older look than the current code would draw? */
export const olderLook = (ver, kind, hasCause, now, table = BAKE_VERSIONS) => Number.isFinite(ver) && ver < strokeVersion(kind, hasCause, now, table);

/**
 * A manifest entry: "sig:id" (until 0.4.1: baked at the manifest's version) or "sig:id:ver" (pinned per stroke). -> { sig, id, ver }.
 * `manifestVer`: the version a 0.4.1 entry was baked with (its manifest base's version).
 */
export function parseEntry(v, manifestVer = -1) {
  if ( typeof v !== "string" ) return null;
  const [sig, id, ver] = v.split(":");
  if ( !sig || !id ) return null;
  const n = ver !== undefined && ver !== "" ? Number(ver) : NaN;
  return { sig, id, ver: Number.isFinite(n) ? n : manifestVer };
}
export const entryString = (sig, id, ver) => `${sig}:${id}:${ver}`;

/**
 * Rebake all: the order strokes are re-baked in - the older looks nearest the view first, each followed by the strokes that read it
 * (their substrate changes with it). `list`: [{ objId, index, dist, dependents: [objId] }]. -> [objId] without repeats.
 */
export function rebakeOrder(list) {
  const out = [], seen = new Set();
  for ( const w of [...list].sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0) || a.index - b.index) ) {
    if ( !seen.has(w.objId) ) { seen.add(w.objId); out.push(w.objId); }
    for ( const d of w.dependents ?? [] ) if ( !seen.has(d) ) { seen.add(d); out.push(d); }
  }
  return out;
}

/** May the chunks of bake version `old` stand in as FINAL for version `now` (until a background re-bake replaces them)? */
export function compatible(old, now, table = BAKE_VERSIONS) {
  if ( old === now ) return true;
  let v = now;
  for ( let guard = 0; guard < 1000; guard++ ) {
    const c = table[v]?.compat;
    if ( !Number.isFinite(c) || c >= v ) return false;
    if ( c === old ) return true;
    if ( c < old ) return false;
    v = c;
  }
  return false;
}

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
