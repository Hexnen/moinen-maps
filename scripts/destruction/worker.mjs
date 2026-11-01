/**
 * The destruction bake in a worker (module worker). Keeps the scene's map pixels (sent once per map) and the baked areas (by hash),
 * so a new stroke only bakes the areas it touched. Messages:
 *   { id, kind: "map", mapKey, map }        keep these map pixels
 *   { id, kind: "bake", input }              bake (input.mapKey names the kept map); progress and one result out
 *   { id, kind: "encode", w, h, data }       RGBA -> PNG bytes
 */
import { bake } from "./core.mjs";
import { encodePng } from "./png.mjs";

let map = null, mapKey = "";
const areas = new Map();

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if ( m.kind === "map" ) {
      map = m.map; mapKey = m.mapKey; areas.clear();
      self.postMessage({ id: m.id, ok: true, result: true });
    } else if ( m.kind === "bake" ) {
      if ( !map || m.input.mapKey !== mapKey ) throw new Error("NOMAP");
      const res = bake({ ...m.input, map, onProgress: (p) => self.postMessage({ id: m.id, progress: p }) }, areas);
      self.postMessage({ id: m.id, ok: true, result: res }, [res.sheet.data.buffer, res.meta.buffer]);
    } else if ( m.kind === "encode" ) {
      const png = await encodePng(m.w, m.h, m.data);
      self.postMessage({ id: m.id, ok: true, result: png }, [png.buffer]);
    }
  } catch ( err ) {
    self.postMessage({ id: m.id, ok: false, error: err?.message === "NOMAP" ? "NOMAP" : String(err?.stack ?? err) });
  }
};
