/**
 * PERF (dark scenes): the dark rim light of areas read straight from their chunk's sprites, off the page (the codec worker, job "rims").
 * A scene opened from the settled composite holds its areas as shells with no pixels; a dark scene used to fill every shell in view -
 * decode the chunk on the page, build the area, keep its ~1.7 MB atlas until its rim was read (~10 ms an area) - only to light the lips of
 * its damage. The rim is a pure function of the area's cover and base pixels (cause-fx addRim), so the worker runs the very same
 * function and sends back its strengths (one byte a pixel): the shell gets its rim sprite (cause-fx setRim) and stays a shell.
 */
/**
 * `sprites` a decoded chunk's sprites, `areas` [{ hash, cause, type }] -> [{ hash, rim: { A8, col, LW, LH, ox, oy } | null }].
 * The area's rows as display.build reads them: the base row (m[5], m[6] its place), the shards, the cover row (m[5], m[6] its own place).
 */
export async function rimsOf(sprites, areas) {
  const byHash = new Map();
  let cur = null;
  for ( const s of sprites ) {
    if ( s.m[0] === 0 ) { cur = { base: s, cover: null }; byHash.set(((s.m[12] & 0xffff) | ((s.m[13] & 0xffff) << 16)) >>> 0, cur); }
    else if ( s.m[0] === 2 && cur ) cur.cover = s;
  }
  // (the page's modules the rim code imports touch Foundry's globals when they load: stand-ins in a worker, before the import)
  const sink = new Proxy(function() {}, { get: (t, k) => (k === "destroyed" ? false : sink), set: () => true, apply: () => sink, construct: () => sink });
  globalThis.PIXI ??= sink;      // (in a worker: addRim makes a sprite it throws away)
  globalThis.Hooks ??= { on() {}, once() {}, off() {}, call() {}, callAll() {} };
  const { addRim } = await import("./cause-fx.mjs");
  // (addRim as the display calls it - on a stand-in display and group: its sprite goes nowhere, its strengths are what is read back)
  return areas.map((a) => {
    const r = byHash.get(a.hash);
    if ( !r?.cover || !r.base ) return { hash: a.hash, rim: null };
    const g = { hash: a.hash, info: { cause: a.cause | 0, type: a.type }, rim: null };
    const d = { ap: 1, origin: { x: 0, y: 0 }, causeLights: { layer: sink, groups: new Set(), attach() {} } };
    const cov = { w: r.cover.w, h: r.cover.h, data: r.cover.img }, base = { w: r.base.w, h: r.base.h, data: r.base.img };
    addRim(d, g, cov, r.cover.m[5], r.cover.m[6], base, r.base.m[5], r.base.m[6]);
    if ( !g.rim?.A8 ) return { hash: a.hash, rim: null };
    const { A8, col, LW, LH } = g.rim;
    return { hash: a.hash, rim: { A8, col, LW, LH, ox: r.base.m[5], oy: r.base.m[6] } };
  });
}
