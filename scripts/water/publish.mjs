/**
 * Baked water in the world's folder, in chunks (scripts/net): after the GM's client has baked the water, the codec worker cuts the
 * frames into 128 x 128 art-pixel tiles (all frames of a tile in one small file, named by a hash of its content) and the GM uploads
 * only the tiles the server does not hold yet - a stroke changes a few tiles, not the whole water. The scene flag names the bake
 * (`baked.key`) and its tiles (`baked.t`, ids in tile order, 0 for an empty tile). A player whose masks and settings give the same key
 * takes the tiles from IndexedDB or downloads them (decoded in the worker, no canvas) instead of baking.
 * The tiles hold the level bytes, not colours, so colours and opacity can still change on the client without a new upload.
 * Records of the first format (one PNG, `baked.path`) are still read; the GM's next publish replaces them.
 * The flooded holes of the destruction (flood.mjs) publish and fetch their loops through the same two functions.
 */
import { MODULE_ID } from "../config.mjs";
import { decodePng } from "../destruction/png.mjs";
import * as Net from "../net/stream.mjs";
import { waterTiles, placeWaterTile } from "../net/chunks.mjs";

export const folder = () => `worlds/${game.world.id}/${MODULE_ID}`;

/**
 * Uploads a bake. Returns the record to store in the scene flag, or throws. `name` was the file name of the first format and is only
 * kept for the callers; the chunks are named by their content.
 */
export async function publishBake(sceneId, key, { box, ms, frames }, name = null) {
  void name;
  const dir = Net.chunkDir(sceneId);
  seedKnown(game.scenes.get(sceneId));
  const copies = frames.map((f) => f.slice());
  const tiles = await Net.job({ kind: "water", box, frames: copies, known: [...Net.known(dir)] }, copies.map((f) => f.buffer));
  await Net.upload(dir, tiles.filter((t) => t.id && t.bytes));
  for ( const t of tiles ) if ( t.bytes ) Net.keep(t.id, t.bytes);
  return { v: 2, key, box, ms, frames: frames.length, dir, t: tiles.map((t) => t.id), path: null, cols: null };
}

/** Downloads a published bake: { box, ms, frames: [Uint8Array ...] }, or null when it cannot be had (a missing tile included). */
export async function fetchBake(baked) {
  try {
    if ( baked?.v === 2 ) return await fetchTiles(baked);
    if ( baked?.path ) return await fetchLegacy(baked);
  } catch ( err ) { console.warn(`${MODULE_ID} | published water`, err); }
  return null;
}

async function fetchTiles(baked) {
  const { box, dir, t: ids } = baked, n = baked.frames;
  const grid = waterTiles(box);
  if ( !Array.isArray(ids) || ids.length !== grid.length ) return null;
  const frames = Array.from({ length: n }, () => new Uint8Array(box.w * box.h));
  const got = await Promise.all(ids.map((id) => id ? Net.getChunk(dir, id) : Promise.resolve(0)));
  for ( const tile of got ) {
    if ( tile === 0 ) continue;
    if ( !tile?.levels ) return null;
    placeWaterTile(tile, frames, box);
  }
  return { box, ms: baked.ms, frames };
}

/** The first format: one PNG, frames in a grid, the level in the red channel (read with png.mjs, no canvas). */
async function fetchLegacy(baked) {
  const url = `${foundry.utils.getRoute(baked.path)}?v=${encodeURIComponent(baked.key)}`;
  const res = await fetch(url, { cache: "force-cache" });
  if ( !res.ok ) return null;
  const png = await decodePng(new Uint8Array(await res.arrayBuffer()));
  const { box, frames: n, cols } = baked, d = png.rgba, W = png.w, out = [];
  for ( let f = 0; f < n; f++ ) {
    const ox = (f % cols) * box.w, oy = Math.floor(f / cols) * box.h, lv = new Uint8Array(box.w * box.h);
    for ( let y = 0; y < box.h; y++ ) {
      let o = ((oy + y) * W + ox) * 4, i = y * box.w;
      for ( let x = 0; x < box.w; x++, o += 4, i++ ) lv[i] = d[o];
    }
    out.push(lv);
  }
  return { box, ms: baked.ms, frames: out };
}

/* ---------------------------------------------------------------- what the manifests name (GC, upload skipping) */

/**
 * Every chunk record in a scene's flags: water records ({ v: 2, dir, t: [ids] }, the scene's water and every flooded hole) and
 * destruction manifests ({ v: 2, dir, c: { stroke: "sig:id" } }). -> [{ dir, ids }].
 */
export function chunkRecords(scene) {
  const out = [];
  const walk = (o, depth) => {
    if ( !o || typeof o !== "object" || depth > 4 ) return;
    if ( o.v === 2 && typeof o.dir === "string" ) {
      if ( Array.isArray(o.t) ) out.push({ dir: o.dir, ids: o.t.filter(Boolean) });
      else if ( o.c && typeof o.c === "object" ) out.push({ dir: o.dir, ids: Object.values(o.c).map((v) => String(v).split(":")[1]).filter(Boolean) });
      return;
    }
    for ( const v of Object.values(o) ) walk(v, depth + 1);
  };
  walk(scene?.flags?.[MODULE_ID], 0);
  return out;
}

/** The ids the scene's manifests name are on the server (uploaded before): no upload for them. */
export function seedKnown(scene) {
  for ( const r of chunkRecords(scene) ) { const set = Net.known(r.dir); for ( const id of r.ids ) set.add(id); }
}

/** Files of the first format (one PNG per bake, `path`) a scene's flags still name: the scene's water, its destruction, its holes. */
export function legacyPaths(scene) {
  const out = [];
  const walk = (o, depth) => {
    if ( !o || typeof o !== "object" || depth > 4 ) return;
    if ( typeof o.path === "string" && o.path.startsWith(folder() + "/") ) out.push(o.path);
    for ( const v of Object.values(o) ) walk(v, depth + 1);
  };
  walk(scene?.flags?.[MODULE_ID], 0);
  return out;
}

Net.registerRefs((scene) => [...chunkRecords(scene).flatMap((r) => r.ids.map((id) => Net.pathOf(r.dir, id))), ...legacyPaths(scene)]);
