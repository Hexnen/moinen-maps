import { lightDrive, shaderTime, hash4, FIRE_LV } from "./model.mjs";
import { reducedMotion } from "../config.mjs";

/**
 * FIRE LIGHT through Foundry's OWN light sources: one client-side PointLightSource per light cluster (model.lightsOf: a fire is one
 * light, a long or irregular one a few at its clusters; at most LIGHTS_MAX per area, BUDGET shared by the scene's areas). The sources
 * go into `canvas.effects.lightSources` with `source.add()` and are NEVER saved as AmbientLight documents (every client builds the
 * same lights from the strokes). A PointLightSource lights tokens through Foundry's shaders, is blocked by walls and makes the lit
 * ground VISIBLE to a player's token across the dark.
 *
 * THE LOOK (lighting A5): our own illumination shader (FireIlluminationShader) instead of Foundry's: the light ADDS a warm glow over
 * the scene's darkness (computedBackgroundColor + tint x falloff) - a hot core by the fire and a long soft tail, well below daylight,
 * so the lit map stays darker than the flames (the flames are emissive: art.mjs draws them white into the illumination). No
 * coloration and no background layer (not drawn at all): the old additive orange washed the flames out to yellow and turned grey
 * smoke pink. By day the glow cannot rise above the daylight, so the light is simply not seen: it grows in with the darkness, no
 * switch at a threshold.
 *
 * THE DRIVE (model.lightDrive): the light follows the fire under it, from the SAME signals as its flames - each one-square sample's
 * grow-in / go-out, the fuel map there (a flaring patch brightens the light, a dying one dims it), the breathing of its cluster, the
 * gust passing it (a gust brightens the lights one after another along the wind) and the light's own seeded flicker (hashed noise:
 * no sinusoid, neighbours never in step). The tint warms and darkens as the fire weakens and goes paler as it flares; the centre
 * leans towards where the fire burns hottest; the reach (the edge) breathes with the strength.
 *
 * COST: uniforms only. The polygon (walls) is made at the light's MAX reach once, when the light is made or its fire moves; every
 * change of strength, colour, centre and edge is three uniforms (mmTint, mmOff, mmReach) written at most 12 times a second (on the
 * fire's 12 fps clock). Never a lightingRefresh or an initializeLightSources: a new light puts its own mesh into the illumination
 * container (as Foundry's refresh would) and asks only for a VISION refresh (a player sees the newly lit ground); a light whose
 * fire is gone fades out, then its mesh is taken out and the source destroyed.
 * APPEARING: a new light starts at gain 0 and grows with its fire's ignite times (and a short fade-in of its own): it never switches on.
 * REUSE: when an area changes (a stroke added, erased, going out) its new clusters take over the nearest old lights (sources,
 * polygons, flicker kept); a light gets a new polygon only when its fire's centre moved more than half a square.
 */
let Cls = null, Sh = null;

/** Lights per area at most (a long fire: several, at its clusters) and the scene's budget shared by its areas. */
export const LIGHTS_MAX = 4, BUDGET = 24;
/** A new light's own fade-in and a retired light's fade-out (ms). */
export const FADE_IN = 700, FADE_OUT = 900;
/** A light's hand-over when its fire changed (ms): the old look eases into the new. */
export const BRIDGE = 1500;

function shaders() {
  if ( Sh ) return Sh;
  const S = foundry.canvas.rendering.shaders;
  class FireIlluminationShader extends S.AdaptiveIlluminationShader {
    static _createFragmentShader() {
      return `
      ${this.SHADER_HEADER}
      ${this.PERCEIVED_BRIGHTNESS}
      uniform vec3 mmTint;    // the light's colour x its strength now (lights.mjs, <= 12 Hz)
      uniform vec2 mmOff;     // the centre's lean (uv)
      uniform float mmReach;  // the edge: the falloff's reach as a share of the polygon's radius
      void main() {
        ${this.FRAGMENT_BEGIN}
        float r = distance(vUvs, vec2(0.5) + mmOff) * 2.0 / max(mmReach, 0.05);
        // a hot core by the fire and a long soft tail, reaching zero before the polygon's edge (never a rim)
        float fall = (0.75 * exp(-5.0 * r * r) + 0.25 * exp(-1.6 * r * r)) * (1.0 - smoothstep(0.6, 1.0, r));
        finalColor = computedBackgroundColor + mmTint * fall;
        gl_FragColor = vec4(mix(computedBackgroundColor, max(finalColor, computedBackgroundColor), depth), 1.0);
      }`;
    }
    static get defaultUniforms() { return { ...super.defaultUniforms, mmTint: [0, 0, 0], mmOff: [0, 0], mmReach: 1 }; }
  }
  // (no coloration, no background: never drawn - Foundry leaves a layer out when its shader is not required)
  class FireColorationShader extends S.AdaptiveColorationShader { get isRequired() { return false; } }
  class FireBackgroundShader extends S.AdaptiveBackgroundShader { get isRequired() { return false; } }
  return Sh = { illumination: FireIlluminationShader, coloration: FireColorationShader, background: FireBackgroundShader };
}

function sourceClass() {
  if ( Cls ) return Cls;
  const Base = foundry.canvas.sources.PointLightSource, sh = shaders();
  Cls = class FireLightSource extends Base {
    /** @override  our shaders on every layer */
    _configureShaders() { return { ...super._configureShaders(), ...sh }; }
  };
  return Cls;
}

const rgbOf = (hex) => { const n = Number.parseInt(String(hex).slice(1), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

/** A light's amplitude: the intensity setting x its level x its fire's strength. */
export const lightAmp = (L, P) => Math.min(1, (P.lightIntensity ?? 0.6) * 1.15) * 0.8 * FIRE_LV.lightI[L.level ?? 2] * (0.6 + 0.4 * (L.strength ?? 1));

/**
 * The light's uniforms from its drive (model.lightDrive), pure: { tint [r, g, b] (colour x strength), reach, off [x, y] (uv) }. `c` the
 * base colour (0..1), `amp` lightAmp, `R` the polygon radius (px), `cx, cy` its centre, `k` the light's own fade (0..1), `bridge`
 * { r, ox, oy } the hand-over after its fire changed (a factor and a centre shift easing to 1 and 0).
 */
export function lightLook(d, c, amp, R, cx, cy, k = 1, seed = 0, T = 0, bridge = null) {
  const g = Math.max(0, d.gain) * k * (bridge?.r ?? 1), h = Math.max(0, Math.min(1, (g - 0.45) / 1.0));
  // weak: warmer and darker (deep red-orange); flaring: paler (towards a warm white)
  const deep = [c[0] * 0.85, c[1] * 0.48, c[2] * 0.28], pale = [c[0] + (1 - c[0]) * 0.55, c[1] + (0.93 - c[1]) * 0.55, c[2] + (0.74 - c[2]) * 0.55];
  const s = amp * Math.min(g, 1.6);
  const tint = [0, 1, 2].map((i) => (deep[i] + (pale[i] - deep[i]) * h) * s);
  // the edge breathes softly with the strength (+ a slow wobble of its own); the centre leans to the hottest burning
  const wob = (hash4(seed, Math.floor(T * 1.3), 5) - 0.5) * 0.02;
  const reach = Math.min(0.9, 0.6 + 0.24 * Math.sqrt(Math.min(1.5, g) / 1.5) + wob);
  let ox = d.x - cx + (bridge?.ox ?? 0), oy = d.y - cy + (bridge?.oy ?? 0); const m = Math.hypot(ox, oy), lim = 0.09 * R;
  if ( m > lim ) { ox *= lim / m; oy *= lim / m; }
  return { tint, reach, off: [ox / (2 * R), oy / (2 * R)] };
}

export class FireLights {
  constructor() {
    this.slots = [];                   // { src, mesh, L, x, y, R, born, dieAt, gone }
    this.byArea = new Map();           // area id -> { key, slots }
    this.params = ""; this.lastT = null; this.geo = null; this.P = null; this.n = 0;
    this.stats = { added: 0, moved: 0, retired: 0, visionUpdates: 0, updates: 0 };
  }
  get count() { return this.slots.filter((s) => !s.dieAt).length; }
  get sources() { return this.slots.filter((s) => !s.dieAt).map((s) => s.src); }
  /** The light sources of one area (for checks). */
  sourcesOf(id) { return (this.byArea.get(id)?.slots ?? []).filter((s) => !s.dieAt).map((s) => s.src); }

  /**
   * The lights per AREA: `entries` [{ id, key, listOf(max) }] (model.lightsOf of that area alone, read only when needed). An area whose
   * key is the same keeps its lights untouched; a changed, new or gone area hands its lights to its new clusters (nearest first), the
   * rest fade out, new clusters get new lights that fade in. Returns { made, dropped, moved }.
   */
  syncAreas(entries, P, now = Date.now(), geo = this.geo) {
    this.P = P; this.geo = geo;
    const params = JSON.stringify([P.light, P.lightRadius, P.lightIntensity, P.lightFollow, P.lightColor, P.lightFlicker]);
    const all = params !== this.params; this.params = params;
    const want = new Map(entries.map((e) => [e.id, e])), orphans = [];
    for ( const [id, a] of this.byArea ) {
      const w = want.get(id);
      if ( all || !w || w.key !== a.key ) { orphans.push(...a.slots); this.byArea.delete(id); }
    }
    for ( const s of this.slots ) if ( s.dieAt !== null && !s.gone && !orphans.includes(s) ) orphans.push(s);   // (fading: may come back)
    const ok = !!(P.light && canvas.effects?.lightSources && foundry.canvas?.sources?.PointLightSource);
    const per = Math.max(1, Math.min(LIGHTS_MAX, Math.floor(BUDGET / Math.max(1, entries.length))));
    const grid = geo?.grid ?? 100;
    let made = 0, moved = 0, dropped = 0, vision = false;
    for ( const e of entries ) {
      if ( this.byArea.has(e.id) ) continue;
      const list = ok ? e.listOf(per) : [], slots = [];
      for ( const L of list ) {
        // the nearest orphan light (alive or fading) takes this cluster over
        let bi = -1, bd = Infinity;
        orphans.forEach((s, i) => { if ( !s ) return; const d = Math.hypot(s.x - L.x, s.y - L.y); if ( d < bd ) { bd = d; bi = i; } });
        const R = Math.round((L.radius ?? 0) * 1.15);
        let s = bi >= 0 && bd <= Math.max(1.5 * grid, 0.4 * orphans[bi].R) ? orphans[bi] : null;
        if ( s ) {
          // HAND-OVER: from the look ON SCREEN (its last uniforms) to the look with its new cluster; the difference eases out over
          // BRIDGE ms, so a stroke added, erased or regrouped never jumps the light (its new ground then catches as the flames grow)
          orphans[bi] = null;
          const was = s.last ?? this.lookOf(s, now), wx = s.x + was.off[0] * 2 * s.R, wy = s.y + was.off[1] * 2 * s.R;
          if ( s.dieAt !== null ) { s.born = now - FADE_IN * (1 - Math.min(1, (now - s.dieAt) / FADE_OUT)); s.dieAt = null; }
          s.L = L;
          const mass = this.massOf(L);
          if ( bd > 0.5 * grid || R > s.R || R < 0.75 * s.R ) { this.move(s, L, R); s.ref = mass; moved++; vision = true; }
          else if ( !s.ref || mass > 1.5 * s.ref ) s.ref = mass;      // (its mass reference: kept while the fire stays about its size)
          s.bridge = null;
          const is = this.lookOf(s, now), a = Math.hypot(...was.tint), b = Math.hypot(...is.tint);
          s.bridge = { r0: b > 1e-4 ? Math.min(4, a / b) : 1, ox0: wx - (s.x + is.off[0] * 2 * s.R), oy0: wy - (s.y + is.off[1] * 2 * s.R), t0: now };
        } else {
          s = this.make(L, R, now); if ( !s ) continue;
          made++; vision = true;
        }
        slots.push(s);
      }
      this.byArea.set(e.id, { key: e.key, slots });
    }
    // the lights no new cluster wanted fade out (their fire is gone or merged)
    for ( const s of orphans ) if ( s && s.dieAt === null ) { s.dieAt = now; dropped++; }
    this.slots = [...[...this.byArea.values()].flatMap((a) => a.slots), ...orphans.filter((s) => s && !s.gone)];
    if ( vision ) { this.stats.visionUpdates++; canvas.perception?.update({ refreshVision: true }); }
    this.stats.added += made; this.stats.moved += moved; this.stats.retired += dropped;
    // (not forced: a new light starts dark and a handed-over one keeps its look until the next 12 fps frame - at most 12 updates a second;
    // reduced motion has no ticker: then now)
    this.update(now, reducedMotion());
    return { made, dropped, moved };
  }

  /** A new light at cluster L, polygon radius R: its mesh goes straight into the illumination container (no lighting refresh). */
  make(L, R, now) {
    const C = sourceClass(), level = canvas.inferLevelFromElevation?.(0)?.id ?? canvas.level?.id ?? null;
    try {
      const src = new C({ sourceId: `moinenMapsFire.${L.seed}.${++this.n}` });
      src.initialize({ x: L.x, y: L.y, elevation: 0, level, walls: true, vision: false, dim: R, bright: 0, color: null, alpha: 0.5,
        luminosity: 0.5, attenuation: 0.5, coloration: 1, animation: { type: null }, seed: L.seed % 10000 });
      src.add();
      const s = { src, mesh: null, L, x: src.data.x, y: src.data.y, R, born: now, dieAt: null, gone: false, ref: this.massOf(L), bridge: null, last: null };
      this.attach(s);
      return s;
    } catch ( err ) { console.warn("moinen-maps | fire light", err); return null; }
  }
  /** Its fire moved: one new polygon (the same source, mesh and look). */
  move(s, L, R) {
    try { s.src.initialize({ x: L.x, y: L.y, dim: R }); s.x = s.src.data.x; s.y = s.src.data.y; s.R = R; this.attach(s); } catch ( err ) { console.warn("moinen-maps | fire light", err); }
  }
  /** Put the source's illumination mesh where Foundry's lighting refresh would (and position it); no refresh. */
  attach(s) {
    const m = s.src.drawMeshes?.()?.illumination, box = canvas.effects?.illumination?.lights;
    if ( m && box && m.parent !== box ) box.addChild(m);
    s.mesh = m ?? null;
  }

  /**
   * Write every light's uniforms for shared time `now` (ms): only on a new 12 fps frame of the fire's clock (at most 12 updates a
   * second), or `force`. Uniform writes only.
   */
  update(now, force = false) {
    const P = this.P, geo = this.geo; if ( !P || !geo ) return;
    const T = reducedMotion() ? 0 : shaderTime(now, P.speed ?? 1);
    if ( T === this.lastT && !force ) return;
    this.lastT = T; this.stats.updates++;
    let gone = false;
    for ( const s of this.slots ) {
      const uu = (s.mesh?.shader ?? s.src.layers?.illumination?.shader)?.uniforms; if ( !uu?.mmTint ) continue;
      if ( s.dieAt !== null && (reducedMotion() || now - s.dieAt >= FADE_OUT) ) { this.retire(s); gone = true; continue; }
      const look = s.last = this.lookOf(s, now, T);
      uu.mmTint[0] = look.tint[0]; uu.mmTint[1] = look.tint[1]; uu.mmTint[2] = look.tint[2];
      uu.mmOff[0] = look.off[0]; uu.mmOff[1] = look.off[1]; uu.mmReach = look.reach;
    }
    if ( gone ) this.slots = this.slots.filter((s) => !s.gone);
  }
  /** The light's mass reference (its samples' weight). */
  massOf(L) { return (L.samples ?? []).reduce((a, x) => a + x.w, 0); }
  /** A light's look at `now` (lightDrive -> lightLook with its fades and hand-over). Pure in its inputs. */
  lookOf(s, now, T = null) {
    const P = this.P, geo = this.geo, still = reducedMotion();
    if ( T === null ) T = still ? 0 : shaderTime(now, P.speed ?? 1);
    const u = geo.grid / geo.ap / 32, G = still ? 0 : (P.grow ?? 0) * 1000, O = still ? 0 : (P.out ?? 0) * 1000, flick = still ? 0 : P.lightFlicker ?? 0;
    const L = s.L, d = lightDrive(L, still ? Infinity : now, T, { u, G, O, flicker: flick, ref: s.ref });
    let k = still ? 1 : ease((now - s.born) / FADE_IN);
    if ( s.dieAt !== null ) k *= 1 - (still ? 1 : ease((now - s.dieAt) / FADE_OUT));
    let br = null;
    if ( s.bridge ) {
      const e = still ? 1 : ease((now - s.bridge.t0) / BRIDGE);
      if ( e >= 1 ) s.bridge = null;
      else br = { r: s.bridge.r0 + (1 - s.bridge.r0) * e, ox: s.bridge.ox0 * (1 - e), oy: s.bridge.oy0 * (1 - e) };
    }
    return lightLook(d, rgbOf(P.lightFollow && L.color ? L.color : P.lightColor ?? "#ff8a3c"), lightAmp(L, P), s.R, s.x, s.y, k, L.seed ?? 0, T, br);
  }
  /** Faded out: out of the light collection, its mesh out of the illumination container, destroyed (no refresh). */
  retire(s) {
    s.gone = true;
    try { s.src.remove(); s.mesh?.parent?.removeChild(s.mesh); s.src.destroy(); } catch { /* gone with the canvas */ }
  }

  clear(update = true) {
    const had = this.slots.length;
    for ( const s of this.slots ) if ( !s.gone ) this.retire(s);
    this.slots = []; this.byArea.clear();
    if ( update && had ) canvas.perception?.update({ refreshVision: true });
  }
  destroy() { this.clear(!!canvas.effects?.lightSources); }
}
