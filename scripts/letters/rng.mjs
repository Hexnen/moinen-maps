/* LETR: deterministic randomness. The same seed gives the same lettering on every client. */
export function hash(s) {
  s = String(s);
  let h = 2166136261 >>> 0;
  for ( let i = 0; i < s.length; i++ ) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* a small toolbox around one generator */
export function rng(seed) {
  const r = mulberry(typeof seed === "number" ? seed >>> 0 : hash(seed));
  const R = () => r();
  R.f = (a, b) => a + (b - a) * r();
  R.i = (a, b) => Math.floor(a + (b - a + 1) * r());
  R.sign = () => (r() < 0.5 ? -1 : 1);
  R.chance = (p) => r() < p;
  R.pick = (arr) => arr[Math.floor(r() * arr.length)];
  /* weighted pick from {key: weight}; skip keys in `avoid` unless nothing else is left */
  R.w = (obj, avoid = null) => {
    let ent = Object.entries(obj).filter(([, w]) => w > 0);
    if ( avoid ) { const f = ent.filter(([k]) => !avoid.has(k)); if ( f.length ) ent = f; }
    let tot = 0; for ( const [, w] of ent ) tot += w;
    let x = r() * tot;
    for ( const [k, w] of ent ) { x -= w; if ( x <= 0 ) return k; }
    return ent[ent.length - 1]?.[0];
  };
  R.seed = () => Math.floor(r() * 4294967296) >>> 0;
  return R;
}
/* smooth 1D value noise in [-1, 1] */
export function noise1(x, seed) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const h = (n) => { let t = Math.imul((n + seed * 374761393) | 0, 668265263); t = Math.imul(t ^ (t >>> 13), 1274126177); return (((t ^ (t >>> 16)) >>> 0) / 4294967296) * 2 - 1; };
  return h(i) * (1 - u) + h(i + 1) * u;
}
