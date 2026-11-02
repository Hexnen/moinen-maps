/**
 * The entry clocks in a worker (display.mjs enter -> clock-pool.mjs): from an area's clock inputs (entry-clock.mjs spec) and the
 * pixel masks of its ruin and cover, the sorted per-pixel moments - the same keys the page made a slice per frame (clockSlice).
 * Message in: { id, spec, jobs: [{ mask | data, w, h, x0, y0, dark }] }; out: { id, keys: [{ ix, tm }] } (transferred) or { id, error }.
 * Or { id, grid: { info, data, fw, fh, cx, cy } } (a cave-in's PIT GRID ahead of its entry, collapse-entry.mjs collapseGrid): out
 * { id, keys: { mask, own, din, dout, maxD, deep, fw, fh, cx, cy } } (transferred).
 */
// (the clock's modules import page modules for their pure parts: what they touch at load time is stubbed here)
globalThis.Hooks ??= { on() {}, once() {}, off() {}, call() {}, callAll() {} };
class Stub {}
globalThis.PIXI ??= new Proxy({}, { get: () => Stub });

let mods = null;
const load = () => mods ??= Promise.all([import("./entry-clock.mjs"), import("./collapse-entry.mjs")]);

self.onmessage = async (ev) => {
  const { id, spec, jobs, grid } = ev.data;
  try {
    const [E, Cm] = await load();
    if ( grid ) {
      const G = Cm.collapseGrid(grid.info, Cm.coverMask(grid.data, grid.fw, grid.fh), grid.fw, grid.fh, grid.cx, grid.cy);
      self.postMessage({ id, keys: G }, [G.mask.buffer, G.own.buffer, G.din.buffer, G.dout.buffer]);
      return;
    }
    const C = E.clockOf(spec);
    let timeOf = C.pixelTime;
    if ( spec.coll ) {
      // a cave-in's clock reads its cover's pixels (collapse-entry.mjs collapseClock): the cover's mask as alpha, at its own frame
      const c = spec.coll, data = new Uint8Array(c.fw * c.fh * 4);
      for ( let i = 0; i < c.fw * c.fh; i++ ) if ( c.mask[i] ) data[i * 4 + 3] = 255;
      const g = { hash: spec.hash, info: spec.info, pieces: [], coverFrame: { tex: { frame: { x: 0, y: 0, width: c.fw, height: c.fh } }, x: c.cx, y: c.cy }, tex: { resource: { data }, width: c.fw } };
      const coll = Cm.collapseClock({ look: { speed: spec.speed } }, g, { start: 0, k: C.k, pathFront: C.pathFront });
      if ( coll ) timeOf = coll.pixelTime;
    }
    // (a job carries the pixel mask, or the pixels themselves - a copy: the page's loop over them is the worker's now)
    const keys = jobs.map((j) => E.clockKeys(timeOf, j.mask ?? E.clockMask(j.data, j.w, j.h, j.dark > 0), j.w, j.h, j.x0, j.y0, j.dark));
    // (the GPU erode's texture bytes, erode-gpu.mjs: made here, not on the page)
    jobs.forEach((j, n) => { if ( j.gpu ) keys[n].tx = E.timeBytes(keys[n].ix, keys[n].tm, j.w, j.h); });
    self.postMessage({ id, keys }, keys.flatMap((k) => [k.ix.buffer, k.tm.buffer, ...(k.tx ? [k.tx.buffer] : [])]));
  } catch ( err ) { self.postMessage({ id, error: String(err?.stack ?? err) }); }
};
