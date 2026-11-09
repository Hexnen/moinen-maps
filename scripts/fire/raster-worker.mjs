/**
 * FIRE AND SMOKE, the field worker: an area's field (model.mjs raster) computed off the main thread, so painting, a release, an
 * undo / redo or a stroke arriving from another client never stalls a frame (fire.mjs draw keeps the previous field on screen until
 * the new one is here). Pure: the same bytes as model.raster on the main thread.
 *   in:  { key, area, geo, P, t }  out: { key, field, ms } (ms = the raster's time when t, dev timing) or { key, err }
 * A12c: EVERY typed array of the field is transferred (the per-cell burn / level / times too: copied, they cost the page ~20 MB of
 * structured clone for a big area), and the area's light clusters (model.lightBins, lightsOf's per-cell pass) are made here as well.
 */
import * as M from "./model.mjs";

self.onmessage = (ev) => {
  const { key, area, geo, P, t } = ev.data;
  let field; const t0 = t ? performance.now() : 0;
  try {
    field = M.raster(area, geo, P);
    if ( field.style !== "dust" ) { const lb = M.lightBins(area, field, geo); field.lightKey = lb.key; field.lightBins = lb.bins; }   // (dust gives no light)
  } catch ( err ) { self.postMessage({ key, err: String(err?.message ?? err) }); return; }
  const tr = [];
  for ( const v of Object.values(field) ) if ( ArrayBuffer.isView(v) && !tr.includes(v.buffer) ) tr.push(v.buffer);
  self.postMessage(t ? { key, field, ms: performance.now() - t0 } : { key, field }, tr);
};
