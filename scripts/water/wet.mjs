/**
 * Water that is not painted: other features (the flooded holes of the destruction, scripts/destruction/flood.mjs) register a provider
 * here, and the token effects of the water (ripples.mjs, submerge.mjs, reflect.mjs) treat its water like painted water. The water
 * code never imports those features; they import this.
 *
 * A provider: {
 *   active()            -> true while it has water on the open scene
 *   at(x, y)            -> null, or the water at a scene point: { px (scene px per art pixel), colors (six hex), depth 0..1 }
 *   regions()           -> [{ x, y (scene px of the top-left), px, w, h, a: Uint8Array(w*h) (1 = water) }] for the reflection mask
 * }
 * Hook "moinenMapsWater" with "wet" fires when a provider's water changed (the reflection mask follows).
 */
const providers = new Set();

export function addWet(p) { providers.add(p); return () => providers.delete(p); }

export const anyWet = () => { for ( const p of providers ) if ( p.active() ) return true; return false; };

/** The first provider's water at a scene point, or null. */
export function wetAt(x, y) {
  for ( const p of providers ) {
    if ( !p.active() ) continue;
    const hit = p.at(x, y);
    if ( hit ) return hit;
  }
  return null;
}

export function wetRegions() {
  const out = [];
  for ( const p of providers ) if ( p.active() ) out.push(...p.regions());
  return out;
}

export const wetChanged = () => Hooks.callAll("moinenMapsWater", "wet");
