import { MODULE_ID } from "../config.mjs";
import * as Net from "./stream.mjs";
import "./bundle.mjs";
import { chunkRecords } from "../water/publish.mjs";
import * as Composite from "../destruction/composite.mjs";
import { cacheEnabled } from "../destruction/static-cache.mjs";
import * as Model from "../destruction/model.mjs";
import * as Store from "../destruction/store.mjs";

/**
 * Starting early. The codec workers start when the game is ready (not on the first chunk), and a scene's chunks are read ahead at
 * `canvasInit` - while Foundry still loads the scene's own textures - so when the destruction and the water ask for them at
 * `canvasReady` they are decoded already. A scene being activated is read ahead too (players are about to be pulled into it).
 * Nothing here decides what is shown: the loaders check every chunk against the scene's state as before.
 */
const K = 2;                       // mask pixels per art pixel (destruction model)
const off = () => { try { return localStorage.getItem("mm-destruction") === "off"; } catch { return false; } };

/** Every chunk the scene's flags name, nearest to `at` (scene px) first: water tiles and flooded loops (small), then the strokes. */
export function chunksOf(scene, at = null) {
  const F = scene?.flags?.[MODULE_ID];
  if ( !F ) return [];
  const out = [], seen = new Set();
  const D = F.destruction, M = D?.baked;
  // where each stroke lies (either layout: the strokes in their own key, or the array of the main flag)
  const objs = F.destructionObjects && typeof F.destructionObjects === "object" ? F.destructionObjects : Object.fromEntries((D?.o ?? []).map((o) => [o?.id, o]));
  const mpx = (D?.ap ?? 1) * K, cx = at?.x ?? (scene.width ?? 0) / 2, cy = at?.y ?? (scene.height ?? 0) / 2;
  const dx = scene.dimensions?.sceneX ?? 0, dy = scene.dimensions?.sceneY ?? 0;
  // a settled composite of this bake (composite.mjs): its few files first, the strokes' own chunks not at all (fetched when needed)
  const C = !off() && M?.v === 2 && Composite.enabled() && cacheEnabled() ? Composite.manifestOf(scene) : null;
  if ( C && C.base === M.base ) {
    for ( const id of C.t ) if ( !seen.has(id) ) { seen.add(id); out.push({ dir: C.dir, id, prio: -1 }); }
    // ... and the flooded strokes' own chunks: their shells are filled right after the reveal (their water reads the areas)
    for ( const [oid, v] of Object.entries(M.c ?? {}) ) {
      const id = String(v).split(":")[1];
      if ( id && !seen.has(id) && Model.TYPES[objs[oid]?.t] === "flood" ) { seen.add(id); out.push({ dir: M.dir, id, prio: 1 }); }
    }
    for ( const r of chunkRecords(scene) ) for ( const id of r.ids ) if ( id.startsWith("w") && !seen.has(id) ) { seen.add(id); out.push({ dir: r.dir, id, prio: 0 }); }
    return out;
  }
  if ( M?.v === 2 && M.c && !off() ) {
    for ( const [oid, v] of Object.entries(M.c) ) {
      const id = String(v).split(":")[1], o = objs[oid];
      if ( !id || seen.has(id) ) continue;
      seen.add(id);
      const d = o ? Math.hypot(dx + (o.x0 + o.w / 2) * mpx - cx, dy + (o.y0 + o.h / 2) * mpx - cy) : 1e6;
      out.push({ dir: M.dir, id, prio: 1000 + d });
    }
  }
  for ( const r of chunkRecords(scene) ) {
    for ( const id of r.ids ) if ( !seen.has(id) && !id.startsWith("b") ) { seen.add(id); out.push({ dir: r.dir, id, prio: id.startsWith("w") ? 0 : 2000 }); }   // (a bundle is read with its members)
  }
  return out;
}

/** The chunk ids of the scene's flooded strokes (their water reads their pixels: every load fetches them after the reveal). */
export function floodIds(scene) {
  const F = scene?.flags?.[MODULE_ID], M = F?.destruction?.baked;
  if ( !F || !M?.c ) return [];
  const objs = F.destructionObjects && typeof F.destructionObjects === "object" ? F.destructionObjects : Object.fromEntries((F.destruction?.o ?? []).map((o) => [o?.id, o]));
  const out = [];
  for ( const [oid, v] of Object.entries(M.c) ) { const id = String(v).split(":")[1]; if ( id && Model.TYPES[objs[oid]?.t] === "flood" ) out.push(id); }
  return out;
}

/** Where the view of a scene will be when it opens. */
function viewOf(scene) {
  const v = scene?._viewPosition ?? scene?.initial;
  return v && Number.isFinite(v.x) ? { x: v.x, y: v.y } : null;
}

let warmed = false;
function registerPreload() {
  Hooks.once("ready", () => { if ( !warmed ) { warmed = true; Net.warm(); } });
  Hooks.on("canvasInit", () => {
    const scene = canvas.scene;
    if ( !scene ) return;
    Net.prefetch(chunksOf(scene, viewOf(scene))).catch((err) => console.warn(`${MODULE_ID} | read ahead`, err));
    // the strokes' signatures too (IndexedDB, else the codec worker): the destruction's first pass needs them at canvasReady
    if ( !off() && scene.flags?.[MODULE_ID]?.destruction ) {
      try {
        const S = Store.attachPaths(Model.load(scene), scene);
        if ( S?.objects?.length ) Store.warmSigs(S, Net.getMeta, (m) => Net.job(m)).catch(() => {});
      } catch ( err ) { console.warn(`${MODULE_ID} | read ahead (signatures)`, err); }
    }
  });
  // a scene that becomes active: players are about to see it
  Hooks.on("updateScene", (scene, changed) => {
    if ( changed.active !== true || scene.id === canvas.scene?.id ) return;
    Net.prefetch(chunksOf(scene, viewOf(scene))).catch(() => {});
  });
}

registerPreload();
