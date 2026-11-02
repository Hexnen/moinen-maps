import { MODULE_ID } from "../config.mjs";
import * as Net from "../net/stream.mjs";
import * as Trace from "../net/trace.mjs";

/**
 * RIM STORE (PERF, dark scenes). The dark rim light of an area (cause-fx addRim: the lit lips and cracks, one byte a pixel) is a pure
 * function of its cover and base pixels, so it can be kept next to the settled composite (composite.mjs): a client that opens the scene
 * from the composite lights it from these few chunks (chunks.mjs kind 6) without fetching, decoding and building the strokes' own chunks
 * for it (rim-job.mjs did that, a chunk at a time) - and an area it knows has no rim is never asked about again.
 *
 * FORMAT: its own scene flag `destructionRims` { v: 2, rv: 1, dir, t: [chunk ids], h: { id: [area hashes it covers] } }. Not part of the
 * composite's manifest, so nothing about the composite changes: a client of an older version never reads this flag (it lights from the
 * strokes' chunks as before), and its garbage collector still finds the ids (water/publish.mjs chunkRecords takes any `{ v: 2, dir, t }`).
 * The composite of such a scene may be older or newer than the rims: a rim belongs to its area by the area's hash (which names its pixels)
 * and cause and type, which are checked when it is taken (take). A client without this flag, or with a chunk that cannot be had, goes on
 * with rim-job.mjs. Written by the active GM after the composite, only what is not covered yet (one chunk for what is new; all areas
 * known at once - the GM holds every rim - in one chunk that replaces them). Off: `CONFIG.moinenMaps.noRimStore = true`.
 */
export const KEY = "destructionRims";
export const RV = 1;

/** The scene's rims manifest, or null. */
export function manifestOf(scene) {
  const c = scene?.flags?.[MODULE_ID]?.[KEY];
  return c?.v === 2 && c.rv === RV && typeof c.dir === "string" && Array.isArray(c.t) && c.h && typeof c.h === "object" ? c : null;
}
/** The chunk ids to read ahead: [{ dir, id }]. */
export const idsOf = (scene) => { const m = manifestOf(scene); return m ? m.t.map((id) => ({ dir: m.dir, id })) : []; };
export const enabled = () => !globalThis.CONFIG?.moinenMaps?.noRimStore;

/** A rim's strengths: kept as they are by day; once a dark scene made its texture (cause-fx rimTexture) they are its alpha plane. */
function strengths(r) {
  if ( r.A8 ) return r.A8;
  const px = r.tex?.baseTexture?.resource?.data;
  if ( !px || px.length !== r.LW * r.LH * 4 ) return null;
  const out = new Uint8Array(r.LW * r.LH);
  for ( let i = 0; i < out.length; i++ ) out[i] = px[i * 4 + 3];
  return out;
}

/**
 * What a publish does (pure; tests): `live` Map(hash -> rim) of the areas whose rim is held here, `none` the hashes known to have no rim,
 * `current` Set of every area on screen, `old` the flag now (or null), `dir`. -> { ids, h, add: { hashes, none } | null, same, empty }: the manifest's chunks
 * and what each covers, and the one chunk still to make (the rims not covered yet; every area at once replaces all the chunks).
 */
export function plan({ live, none, current, old, dir }) {
  const same = !!old && old.dir === dir;
  const keep = same ? old.t.filter((id) => (old.h[id] ?? []).some((h) => current.has(h))) : [];
  const covered = new Set(keep.flatMap((id) => (old.h[id] ?? []).filter((h) => current.has(h))));
  const fresh = [...live.keys()].filter((h) => !covered.has(h)), freshNone = none.filter((x) => !covered.has(x));
  const everyone = live.size > 0 && live.size + none.length === current.size;
  const consolidate = everyone && keep.length > 1;
  if ( !consolidate && !fresh.length && !freshNone.length ) return { ids: keep, h: Object.fromEntries(keep.map((id) => [id, old.h[id]])), add: null, same: same && keep.length === old.t.length, empty: !keep.length };
  return { ids: consolidate ? [] : keep, h: consolidate ? {} : Object.fromEntries(keep.map((id) => [id, old.h[id]])), add: consolidate ? { hashes: [...live.keys()], none } : { hashes: fresh, none: freshNone }, same: false, empty: false };
}

/**
 * GM: file the rims of the areas on screen. `d` the display, `ctx` { scene, dir }. -> "published" | "same" | "none" (nothing to file).
 * An area is "known without a rim" when it is built here and has no cover (addRim reads one); a shell without a rim here is not known.
 */
export async function publish(d, ctx) {
  if ( !enabled() || !d?.order?.length ) return "none";
  const live = new Map(), none = [];
  for ( const g of d.order ) {
    if ( g.dead ) continue;
    const r = g.rim;
    if ( r && !g.rimLate && (r.A8 || r.tex?.baseTexture?.resource?.data?.length === r.LW * r.LH * 4) ) live.set(g.hash, { hash: g.hash, cause: g.info.cause | 0, type: g.info.type, col: r.col, LW: r.LW, LH: r.LH, ox: g.info.x, oy: g.info.y, rim: r });   // (ox, oy: the base row's place, where addRim, rim-job and setRim put the sprite)
    else if ( !g.shell && !g.coverFrame && !g.rimLate ) none.push(g.hash);
  }
  const old = manifestOf(ctx.scene), P = plan({ live, none, current: new Set(d.order.filter((g) => !g.dead).map((g) => g.hash)), old, dir: ctx.dir });
  if ( P.add ) {
    const t0 = performance.now(), rims = P.add.hashes.map((h) => { const { rim, ...x } = live.get(h); return { ...x, A8: strengths(rim).slice() }; });
    const c = await Net.job({ kind: "rimpack", rims, none: P.add.none }, rims.map((r) => r.A8.buffer));
    if ( !P.ids.includes(c.id) ) P.ids.push(c.id);
    P.h[c.id] = [...P.add.hashes, ...P.add.none];
    if ( !Net.known(ctx.dir).has(c.id) ) await Net.upload(ctx.dir, [{ id: c.id, bytes: c.bytes }]);
    Net.keep(c.id, c.bytes);
    Trace.event("rims-published", { chunk: c.id, rims: rims.length, none: P.add.none.length, bytes: c.bytes.length, ms: Math.round(performance.now() - t0), chunks: P.ids.length });
  } else if ( P.same ) return "same";
  else if ( P.empty ) return "none";
  const m = { v: 2, rv: RV, dir: ctx.dir, t: P.ids, h: P.h, at: Date.now() };
  if ( old && old.dir === m.dir && JSON.stringify(old.t) === JSON.stringify(m.t) && JSON.stringify(old.h) === JSON.stringify(m.h) ) return "same";
  await ctx.scene.update({ [`flags.${MODULE_ID}.${KEY}`]: m });
  return "published";
}

/**
 * A client: the rims the scene's flag names, once. -> { rims: Map(hash -> { cause, type, rim: { A8, col, LW, LH, ox, oy } }), none: Set(hash) } or null
 * (no flag, or a chunk that cannot be had: the caller lights from the strokes' chunks). The decoded chunks are let go of here at once.
 */
export async function load(scene) {
  const m = manifestOf(scene);
  if ( !m || !enabled() ) return null;
  const t0 = performance.now(), got = await Promise.all(m.t.map((id) => Net.getChunk(m.dir, id, { prio: -1 }).catch(() => null)));
  if ( got.some((c) => !c?.rims) ) { Trace.event("rims-unusable", { of: m.t.length, got: got.filter((c) => c?.rims).length }); return null; }
  const rims = new Map(), none = new Set();
  for ( const c of got ) {
    for ( const r of c.rims ) rims.set(r.hash, { cause: r.cause, type: r.type, rim: { A8: r.A8, col: r.col, LW: r.LW, LH: r.LH, ox: r.ox, oy: r.oy } });
    for ( const x of c.none ) none.add(x);
  }
  for ( const id of m.t ) Net.forget(id);
  Trace.event("rims-loaded", { chunks: m.t.length, rims: rims.size, none: none.size, ms: Math.round(performance.now() - t0) });
  return { rims, none };
}
