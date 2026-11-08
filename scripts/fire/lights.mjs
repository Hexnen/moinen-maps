import { flickerAt, litAt, FIRE_LV } from "./model.mjs";
import { sharedNow } from "../shared-clock.mjs";
import { reducedMotion } from "../config.mjs";

/**
 * FIRE LIGHT through Foundry's OWN lighting: one client-side PointLightSource per light cluster (model.lightsOf merges the burning
 * ground into at most 24 per scene; never a light per cell or particle). The sources are put into `canvas.effects.lightSources` with
 * `source.add()` and NEVER saved as AmbientLight documents (no document writes, every client builds the same lights from the strokes).
 *
 * WHY Foundry light sources and not the cause-fx sprite in the illumination container (MAX_COLOR): a sprite only brightens pixels;
 * it does not light tokens through Foundry's light shaders, is not blocked by walls, and does not make a lit area VISIBLE to a
 * player's token across the dark (Foundry reveals what lies in a light source's polygon within the token's line of sight). A
 * PointLightSource does all three, with Foundry's own attenuation and colouration, and it survives every lighting refresh: the
 * `lightSources` collection is only cleared at canvas teardown, `initializeLightSources` re-initializes it (walls changed) together with
 * the scene's own lights.
 *
 * COST: the polygon (walls) is computed when a light is (re)made - when the fire changes, never per frame. Per frame Foundry draws
 * each source's meshes (as it does for any light). THE FLICKER does NOT refresh the lighting: the sources use Foundry's "torch"
 * shaders and our `animate()` only writes their two uniforms (brightnessPulse, ratio) from the shared clock (model.flickerAt, 12 Hz
 * steps): the same flicker on every client, a few float writes per light per frame. Flicker 0 or reduced motion: no animation at all.
 * Adding or removing lights asks Foundry for one perception update (refreshLighting + refreshVision).
 *
 * GROWING AND GOING OUT: a light made for a fire that is still catching (or going out) carries its ignite / out time; `animate()`
 * scales its coloration alpha and lerps its illumination colours from the scene's darkness towards their full values by model.litAt
 * (the same uniforms Foundry set in its last refresh, saved by the `_update...Uniforms` overrides), so the light grows with the flames
 * and fades with them - again uniforms only, no lighting refresh. A light at rest and steady (flicker 0) is not animated at all.
 * LEVELS: the radius comes from model.lightsOf (x the fire level), the intensity is scaled here by the level.
 * COLOUR: each light takes its fire's colour (model.lightsOf -> look.rampOf().light; the natural fire's is the old #ff8a3c); the scene's
 * lightColor is an override, used when lightFollow is off.
 */
let Cls = null;
/** Darkness level below which the fire light is suppressed (by day it only tinted the map brown); Foundry re-checks on every lighting refresh. */
export const DAY_BELOW = 0.2;
function sourceClass() {
  if ( Cls ) return Cls;
  const Base = foundry.canvas.sources.PointLightSource;
  Cls = class FireLightSource extends Base {
    /** @override  the "torch" look driven by the shared clock instead of the client's ticker */
    animate(dt) {
      if ( !this.isAnimated ) return;
      const now = sharedNow(), co = this.layers.coloration.shader, il = this.layers.illumination.shader;
      if ( this.mmFlicker > 0 ) {
        const n = 1 - flickerAt(now, this.mmSeed, this.mmFlicker);    // 0 .. 0.45 * flicker
        co.uniforms.brightnessPulse = il.uniforms.brightnessPulse = 1 - n;
        co.uniforms.ratio = il.uniforms.ratio = this.ratio * (1 - n * 0.4);
        const t = (now % 1e6) / 1000;
        for ( const l of Object.values(this.layers) ) { const u = l.mesh?.uniforms; if ( u ) { u.time = t; u.intensity = 5; } }
      }
      const T = this.mmTime;
      if ( T && this.mmBase ) {
        // growing with the flames / fading with them: the saved full values scaled (uniforms only)
        const k = litAt(now, T.ignite, T.out, T.G, T.O), B = this.mmBase, cu = co.uniforms, iu = il.uniforms;
        cu.colorationAlpha = B.alpha * k;
        const dark = iu.ambientDarkness ?? [0, 0, 0];
        for ( const [key, base] of [["colorDim", B.dim], ["colorBright", B.bright]] ) {
          const u = iu[key]; if ( !u || !base ) continue;
          for ( let c = 0; c < 3; c++ ) u[c] = dark[c] + (base[c] - dark[c]) * k;
        }
        if ( k >= 1 && T.out === null && now > (T.ignite ?? 0) + T.G ) this.mmTime = null;   // (grown: plain again)
      }
    }
    /** @override  keep the full values Foundry computed (the grow / out animation scales from them) */
    _updateColorationUniforms() {
      super._updateColorationUniforms();
      (this.mmBase ??= {}).alpha = this.layers.coloration.shader.uniforms.colorationAlpha;
    }
    /** @override */
    _updateIlluminationUniforms() {
      super._updateIlluminationUniforms();
      const u = this.layers.illumination.shader.uniforms;
      (this.mmBase ??= {}).dim = u.colorDim ? [...u.colorDim] : null; this.mmBase.bright = u.colorBright ? [...u.colorBright] : null;
    }
  };
  return Cls;
}

const hexColor = (s) => Number.parseInt(String(s).slice(1), 16);

const isDay = () => (canvas.environment?.darknessLevel ?? 1) < DAY_BELOW;

export class FireLights {
  constructor() {
    this.sources = []; this.byArea = new Map(); this.params = ""; this.day = null;
    // by day (darkness below DAY_BELOW) the fire does not light (its orange colouration only muddied the map): the sources are
    // suppressed. Checked after every lighting refresh; only a flip asks for one more refresh (the darkness crossing the threshold)
    this.hook = Hooks.on("lightingRefresh", () => this.daylight());
  }
  daylight(force = false) {
    const day = isDay(); if ( day === this.day && !force ) return;
    this.day = day;
    for ( const s of this.sources ) s.suppression.mmDaylight = day;
    if ( this.sources.length && !force ) canvas.perception?.update({ refreshLighting: true, refreshVision: true });
  }
  get count() { return this.sources.length; }
  dirtyParams(P) { return JSON.stringify([P.light, P.lightRadius, P.lightIntensity, P.lightFollow, P.lightColor, P.lightFlicker]) !== this.params; }

  /**
   * Make the lights per AREA: `entries` [{ id, key, list }] (list = model.lightsOf of that area alone). An area whose key is the same as
   * before keeps its light sources untouched (no rebuild, no restarted flicker or grow); only the areas that changed, came or went
   * replace theirs. New settings (`P`) rebuild all. Returns how many sources were made and dropped.
   */
  syncAreas(entries, P) {
    const params = JSON.stringify([P.light, P.lightRadius, P.lightIntensity, P.lightFollow, P.lightColor, P.lightFlicker]);
    const all = params !== this.params; this.params = params;
    const want = new Map(entries.map((e) => [e.id, e]));
    let made = 0, dropped = 0;
    for ( const [id, a] of this.byArea ) {
      const w = want.get(id);
      if ( all || !w || w.key !== a.key ) { dropped += this.drop(a.sources); this.byArea.delete(id); }
    }
    const ok = P.light && canvas.effects?.lightSources && foundry.canvas?.sources?.PointLightSource;
    for ( const e of entries ) {
      if ( this.byArea.has(e.id) ) continue;
      const sources = ok ? this.make(e.id, e.list, P) : [];
      made += sources.length;
      this.byArea.set(e.id, { key: e.key, sources });
    }
    this.sources = [...this.byArea.values()].flatMap((a) => a.sources);
    this.day = isDay();
    if ( made || dropped ) canvas.perception?.update({ refreshLighting: true, refreshVision: true });
    return { made, dropped };
  }
  /** The light sources of one area (for checks). */
  sourcesOf(id) { return this.byArea.get(id)?.sources ?? []; }
  make(id, list, P) {
    const C = sourceClass(), level = canvas.inferLevelFromElevation?.(0)?.id ?? canvas.level?.id ?? null, still = reducedMotion(), out = [];
    list.forEach((L, i) => {
      try {
        const s = new C({ sourceId: `moinenMapsFire.${id}.${i}` });
        s.mmSeed = L.seed; s.mmFlicker = still ? 0 : P.lightFlicker;
        s.mmTime = !still && (L.ignite !== null || L.out !== null) ? { ignite: L.ignite, out: L.out, G: P.grow * 1000, O: P.out * 1000 } : null;
        const alpha = Math.min(1, P.lightIntensity * (0.55 + 0.45 * L.strength) * FIRE_LV.lightI[L.level ?? 2]);
        s.initialize({ x: L.x, y: L.y, elevation: 0, level, walls: true, vision: false, dim: L.radius, bright: Math.round(L.radius * 0.45),
          color: hexColor(P.lightFollow && L.color ? L.color : P.lightColor), alpha: alpha * 0.75, luminosity: 0.5 + 0.2 * P.lightIntensity, attenuation: 0.6, coloration: 1,
          animation: s.mmFlicker > 0 || s.mmTime ? { type: "torch", speed: 5, intensity: 5, reverse: false } : { type: null }, seed: L.seed % 10000 });
        s.suppression.mmDaylight = isDay();
        s.add();
        out.push(s);
      } catch ( err ) { console.warn("moinen-maps | fire light", err); }
    });
    return out;
  }
  drop(list) { for ( const s of list ) { try { s.destroy(); } catch { /* gone with the canvas */ } } return list.length; }

  clear(update = true) {
    const had = this.sources.length;
    for ( const s of this.sources ) { try { s.destroy(); } catch { /* gone with the canvas */ } }
    this.sources = []; this.byArea.clear();
    if ( update && had ) canvas.perception?.update({ refreshLighting: true, refreshVision: true });
  }
  destroy() { Hooks.off("lightingRefresh", this.hook); this.clear(!!canvas.effects?.lightSources); }
}
