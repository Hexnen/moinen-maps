/**
 * PERF: `{ ...DEFAULTS, ...params }` built on every frame by the three water ticks (reflections, ripples, submerge) was a new object per
 * frame each. The merged object is kept and made again only when a parameter differs from the one it was made from (a shallow compare,
 * no allocation). The result is read-only for callers.
 */
const NONE = Object.freeze({});
export function cfgMemo(defaults) {
  let out = null, snap = null, n = 0;
  return (params) => {
    const p = params ?? NONE;
    if ( out ) {
      let c = 0, same = true;
      for ( const k in p ) { c++; if ( p[k] !== snap[k] ) { same = false; break; } }
      if ( same && c === n ) return out;
    }
    snap = { ...p }; n = Object.keys(p).length;
    return out = { ...defaults, ...p };
  };
}
