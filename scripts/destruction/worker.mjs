/**
 * The destruction bake in a worker (module worker). Keeps the scene's map pixels (sent once per map) and the baked areas (by hash),
 * so a new stroke only bakes the areas it touched. Messages:
 *   { id, kind: "map", mapKey, map }        keep these map pixels
 *   { id, kind: "bake", input }              bake (input.mapKey names the kept map); progress and one result out
 *   { id, kind: "encode", w, h, data }       RGBA -> PNG bytes
 *   { id, kind: "plain", key, sprites }      keep a plain look a Rebake's jobs name (input.underKeys)
 *   { id, kind: "dropPlain", keys }          let those looks go (keys null: all)
 */
import { bake } from "./core.mjs";
import { encodePng } from "./png.mjs";
import { splitSheet } from "../net/chunks.mjs";
import { packLook, unpackLook } from "./look-pack.mjs";

let map = null, mapKey = "";
const areas = new Map();
/** Plain looks sent ahead by a Rebake all (key "<stroke id>|<own signature>" -> sprites). */
const plains = new Map();

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if ( m.kind === "map" ) {
      map = m.map; mapKey = m.mapKey; areas.clear();
      self.postMessage({ id: m.id, ok: true, result: true });
    } else if ( m.kind === "plain" ) {
      // a plain look sent ahead (a Rebake all): jobs name it in `underKeys`
      plains.set(m.key, m.pack ? unpackLook(m.pack) : m.sprites);
      self.postMessage({ id: m.id, ok: true, result: true });
    } else if ( m.kind === "dropPlain" ) {
      // looks no job of the Rebake needs any more (`keys`), or all of them (`keys` null: the Rebake ended)
      if ( m.keys ) for ( const k of m.keys ) plains.delete(k); else plains.clear();
      self.postMessage({ id: m.id, ok: true, result: plains.size });
    } else if ( m.kind === "bake" ) {
      if ( !map || m.input.mapKey !== mapKey ) throw new Error("NOMAP");
      const under = { ...(m.input.under ?? {}) };
      for ( const [j, key] of Object.entries(m.input.underKeys ?? {}) ) { const s = plains.get(key); if ( s && !under[j] ) under[j] = s; }
      const res = bake({ ...m.input, under, map, onProgress: (p) => self.postMessage({ id: m.id, progress: p }) }, m.input.noCache ? null : areas);
      if ( m.input.split ) {
        // the lane splits the sheet into the strokes' sprites itself (input.split = the meta field count) and hands each one over (a
        // transfer): the page took the whole sheet and copied every sprite out of it - twice the pixels as garbage until the next GC
        const all = [...splitSheet(res.sheet.data, res.sheet.w, res.meta, m.input.split)], moved = [], parts = [], packs = [];
        // (PERF, input.pack: a stroke's sprites go as three buffers - the page took thousands of small typed arrays apart in the message itself, up to
        // 300 ms of one task; it makes the sprites in slices, look-pack.mjs)
        for ( const [index, list] of all ) {
          const pk = m.input.pack ? packLook(list) : null;
          if ( pk ) { packs.push([index, pk]); moved.push(pk.metas.buffer, pk.dims.buffer, pk.px.buffer); }
          else { parts.push([index, list]); for ( const s of list ) moved.push(s.img.buffer, s.m.buffer); }
        }
        self.postMessage({ id: m.id, ok: true, result: { parts, packs, stats: res.stats } }, moved);
      } else self.postMessage({ id: m.id, ok: true, result: res }, [res.sheet.data.buffer, res.meta.buffer]);
    } else if ( m.kind === "encode" ) {
      const png = await encodePng(m.w, m.h, m.data);
      self.postMessage({ id: m.id, ok: true, result: png }, [png.buffer]);
    }
  } catch ( err ) {
    self.postMessage({ id: m.id, ok: false, error: err?.message === "NOMAP" ? "NOMAP" : String(err?.stack ?? err) });
  }
};
