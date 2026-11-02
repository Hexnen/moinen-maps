/**
 * PINNED SETTINGS. The look settings of the Damage panel (debris, scatter, lift, rubble, halo, edge, material, torn borders, follows
 * the stroke, and the scene's default cause) belong to each STROKE once it is painted: a stroke stores the ones that differed from the
 * defaults when it was painted (`pr`; its cause in `c`), and changing a setting afterwards only changes the strokes painted from then
 * on. Nothing is baked again by it; "Apply to existing strokes" (destruction.mjs applyParams) pins the current settings on strokes on
 * purpose. A scene says it works this way with `params.pin` (a scene from before is converted on load: model.mjs load()).
 * No imports: the bake worker, the store and the model all read this.
 */
export const PIN_KEYS = ["debris", "scatter", "lift", "rubble", "halo", "edge", "material", "jagged", "jag", "directional", "cause"];
export const PIN_SET = new Set(PIN_KEYS);
export const PIN_DEFAULTS = { debris: 0.7, scatter: 1, lift: 1, rubble: 0.6, halo: 0.6, edge: 0.7, material: "auto", jagged: false, jag: 0.6, directional: false, cause: 0 };

const memo = new WeakMap();
/**
 * The settings a stroke is baked with. A scene that pins (`P.pin`) or a stroke with its own `pr`: the defaults plus the stroke's `pr`
 * (never the scene's current settings); otherwise the scene's settings, as before pinning.
 */
export function effP(ob, P) {
  if ( !P?.pin && !ob?.pr ) return P;
  let byP = memo.get(ob ?? P);
  if ( byP?.P === P && byP.pr === ob?.pr ) return byP.out;
  const out = { ...P, ...PIN_DEFAULTS, ...(ob?.pr ?? {}) };
  if ( ob ) memo.set(ob, { P, pr: ob.pr, out });
  return out;
}

/** The part of `P` that differs from the defaults (what a new stroke stores in `pr`), or undefined when nothing does. cause is not in it. */
export function pinDiff(P) {
  let out;
  for ( const k of PIN_KEYS ) {
    if ( k === "cause" ) continue;
    const a = P[k], d = PIN_DEFAULTS[k];
    if ( a !== undefined && a !== d ) (out ??= {})[k] = a;
  }
  // (the torn amount only counts with torn borders on)
  if ( out && !out.jagged ) delete out.jag;
  return out && Object.keys(out).length ? out : undefined;
}

/** Two `pr` objects the same? */
export const samePr = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
