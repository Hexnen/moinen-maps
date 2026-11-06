/**
 * FIRE AND SMOKE, the field worker: an area's field (model.mjs raster) computed off the main thread, so painting, a release, an
 * undo / redo or a stroke arriving from another client never stalls a frame (fire.mjs draw keeps the previous field on screen until
 * the new one is here). Pure: the same bytes as model.raster on the main thread.
 *   in:  { key, area, geo, P }     out: { key, field } (its buffers transferred) or { key, err }
 */
import * as M from "./model.mjs";

self.onmessage = (ev) => {
  const { key, area, geo, P } = ev.data;
  let field;
  try { field = M.raster(area, geo, P); }
  catch ( err ) { self.postMessage({ key, err: String(err?.message ?? err) }); return; }
  const tr = [];
  for ( const v of [field.data, field.times, field.aux, field.auxOld] ) if ( v?.buffer && !tr.includes(v.buffer) ) tr.push(v.buffer);
  self.postMessage({ key, field }, tr);
};
