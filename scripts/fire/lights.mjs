import { flickerAt } from "./model.mjs";
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
      if ( !this.isAnimated || this.mmFlicker <= 0 ) return;
      const n = 1 - flickerAt(sharedNow(), this.mmSeed, this.mmFlicker);    // 0 .. 0.45 * flicker
      const co = this.layers.coloration.shader, il = this.layers.illumination.shader;
      co.uniforms.brightnessPulse = il.uniforms.brightnessPulse = 1 - n;
      co.uniforms.ratio = il.uniforms.ratio = this.ratio * (1 - n * 0.4);
      const t = (sharedNow() % 1e6) / 1000;
      for ( const l of Object.values(this.layers) ) { const u = l.mesh?.uniforms; if ( u ) { u.time = t; u.intensity = 5; } }
    }
  };
  return Cls;
}

const hexColor = (s) => Number.parseInt(String(s).slice(1), 16);

const isDay = () => (canvas.environment?.darknessLevel ?? 1) < DAY_BELOW;

export class FireLights {
  constructor() {
    this.sources = []; this.params = ""; this.day = null;
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
  dirtyParams(P) { return JSON.stringify([P.light, P.lightRadius, P.lightIntensity, P.lightColor, P.lightFlicker]) !== this.params; }

  /** Make the lights `list` (model.lightsOf) with the settings `P`; the old ones go. */
  sync(list, P) {
    this.params = JSON.stringify([P.light, P.lightRadius, P.lightIntensity, P.lightColor, P.lightFlicker]);
    const had = this.sources.length;
    this.clear(false);
    if ( P.light && list.length && canvas.effects?.lightSources && foundry.canvas?.sources?.PointLightSource ) {
      const C = sourceClass(), level = canvas.inferLevelFromElevation?.(0)?.id ?? canvas.level?.id ?? null, still = reducedMotion();
      list.forEach((L, i) => {
        try {
          const s = new C({ sourceId: `moinenMapsFire.${i}` });
          s.mmSeed = L.seed; s.mmFlicker = still ? 0 : P.lightFlicker;
          const alpha = Math.min(1, P.lightIntensity * (0.55 + 0.45 * L.strength));
          s.initialize({ x: L.x, y: L.y, elevation: 0, level, walls: true, vision: false, dim: L.radius, bright: Math.round(L.radius * 0.45),
            color: hexColor(P.lightColor), alpha: alpha * 0.75, luminosity: 0.5 + 0.2 * P.lightIntensity, attenuation: 0.6, coloration: 1,
            animation: s.mmFlicker > 0 ? { type: "torch", speed: 5, intensity: 5, reverse: false } : { type: null }, seed: L.seed % 10000 });
          s.suppression.mmDaylight = isDay();
          s.add();
          this.sources.push(s);
        } catch ( err ) { console.warn("moinen-maps | fire light", err); }
      });
    }
    this.day = isDay();
    if ( had || this.sources.length ) canvas.perception?.update({ refreshLighting: true, refreshVision: true });
  }

  clear(update = true) {
    const had = this.sources.length;
    for ( const s of this.sources ) { try { s.destroy(); } catch { /* gone with the canvas */ } }
    this.sources = [];
    if ( update && had ) canvas.perception?.update({ refreshLighting: true, refreshVision: true });
  }
  destroy() { Hooks.off("lightingRefresh", this.hook); this.clear(!!canvas.effects?.lightSources); }
}
