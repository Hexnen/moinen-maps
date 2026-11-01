import { buildLut, paintFrame } from "./paint.mjs";

/**
 * Plays the baked water over the map: one sprite in the primary group (between the scene background and the districts, tiles and
 * tokens) that swaps its texture frame by frame. Textures are nearest-neighbour so the pixel art stays crisp at any zoom.
 *
 * A bake fills a new frame set (`next`); the one playing (`set`) stays until the new one is complete (`commit`), unless nothing is
 * playing yet, in which case the frames show as they arrive.
 */
const REDUCED = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

/**
 * SMOOTH LOOP: the baked loop is a few frames of ~90 ms; shown as they are, the water steps at ~11 frames a second whatever the
 * display rate. With the client setting "Smooth water animation" (default on) every frame cross-fades linearly into the next one
 * over its time (the last BLEND share of it; 1 = all of it: the loop's phase advances evenly with time, drawn frame after drawn
 * frame), both frames' final colours mixed per pixel, premultiplied (a pixel that is water in one frame and dry in the next fades
 * too), so the motion is continuous at 55-165 fps; the frames keep their own sampling (NEAREST magnified, mipmaps minified).
 */
export const BLEND = 1;
/** The two frames on screen and the mix at time `t` (ms) for `n` frames of `ms` each: [i, j, mix 0..1]. */
export function loopMix(t, ms, n, smooth = true) {
  if ( n < 2 ) return [0, 0, 0];
  const ph = t / Math.max(20, ms), i = Math.floor(ph), f = ph - i, a = ((i % n) + n) % n;
  if ( !smooth ) return [a, a, 0];
  return [a, (a + 1) % n, Math.min(1, Math.max(0, (f - (1 - BLEND)) / BLEND))];
}
const MIX_VERT = `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vUV;
void main() {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aTextureCoord;
}`;
const MIX_FRAG = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;
uniform float uAlpha;
void main() { gl_FragColor = mix(texture2D(uA, vUV), texture2D(uB, vUV), uMix) * uAlpha; }`;
let mixProgram = null;

/** A quad of `w` x `h` drawing frames A and B mixed (premultiplied colours). */
export class LoopMix extends PIXI.Mesh {
  constructor() {
    mixProgram ??= PIXI.Program.from(MIX_VERT, MIX_FRAG, "moinen-loop-mix");
    const geom = new PIXI.MeshGeometry(new Float32Array(8), new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), new Uint16Array([0, 1, 2, 0, 2, 3]));
    const shader = new PIXI.Shader(mixProgram, { uA: PIXI.Texture.EMPTY, uB: PIXI.Texture.EMPTY, uMix: 0, uAlpha: 1 });
    super(geom, shader);
    this.eventMode = "none"; this.qw = 0; this.qh = 0;
  }
  set(a, b, mix, w, h) {
    if ( w !== this.qw || h !== this.qh ) {
      this.qw = w; this.qh = h;
      const v = this.geometry.getBuffer("aVertexPosition"); v.data.set([0, 0, w, 0, w, h, 0, h]); v.update();
    }
    const u = this.shader.uniforms; u.uA = a; u.uB = b; u.uMix = mix;
  }
  _render(renderer) { this.shader.uniforms.uAlpha = this.worldAlpha; super._render(renderer); }
}
const smoothOn = () => { try { return game.settings.get("moinen-maps", "smoothWater") !== false; } catch { return true; } };

export class WaterDisplay {
  constructor() {
    this.root = new PIXI.Container();
    this.root.eventMode = "none";
    // sorted like the districts layer: by elevation, then sortLayer (below the districts' 250), then sort
    Object.assign(this.root, { elevation: 0, sortLayer: 240, sort: 0, _lastSortedIndex: 0 });
    this.sprite = this.root.addChild(new PIXI.Sprite(PIXI.Texture.EMPTY));
    this.sprite.eventMode = "none";
    this.mix = this.root.addChild(new LoopMix()); this.mix.visible = false;
    canvas.primary.addChild(this.root);
    this.set = null;
    this.next = null;
    this.t = 0;
    this.lut = null;
    this.paused = false;
    this._tick = () => this.tick(canvas.app.ticker.deltaMS);
    canvas.app.ticker.add(this._tick);
  }

  /** The colours and opacities to paint with (no re-bake needed). */
  setPalette(codes, colors, alpha) {
    this.lut = buildLut(codes, colors, alpha);
    for ( const s of new Set([this.set, this.next]) ) if ( s ) this.rebuild(s);
    this.show(this.index ?? 0);
  }

  /** Starts a new set of frames for a baked box (scene pixel size `px`, scene top-left `origin`, `ms` per frame). */
  begin(box, px, origin, ms) {
    this.next = { box, px, origin, ms, levels: [], textures: [] };
    if ( !this.set ) { this.set = this.next; this.place(); }
  }

  /** A frame (1-based) of the set being baked. */
  addFrame(i, levels) {
    const N = this.next; if ( !N ) return;
    N.levels[i - 1] = levels;
    if ( this.lut ) N.textures[i - 1] = this.texture(levels, N.box);
  }

  /** The finished set replaces the one that was playing. */
  commit() {
    const N = this.next; this.next = null;
    if ( !N || N === this.set ) return;
    this.free(this.set);
    this.set = N; this.t = 0;
    this.place();
  }

  place() {
    const S = this.set; if ( !S ) return;
    this.root.position.set(S.origin.x + S.box.x0 * S.px, S.origin.y + S.box.y0 * S.px);
    this.sprite.scale.set(S.px); this.mix.scale.set(S.px);
    this.show(0);
  }

  texture(levels, box) {
    const c = document.createElement("canvas"); c.width = box.w; c.height = box.h;
    c.getContext("2d").putImageData(new ImageData(paintFrame(levels, box.w, box.h, this.lut), box.w, box.h), 0, 0);
    const tex = PIXI.Texture.from(c, { scaleMode: PIXI.SCALE_MODES.NEAREST });
    // nearest when enlarged (crisp art pixels); when zoomed out so far that an art pixel is under a screen pixel, the mipmaps
    // (NEAREST_MIPMAP_NEAREST) stop the animated water from sparkling as different texels are dropped every frame
    tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
    return tex;
  }

  rebuild(s) {
    for ( const t of s.textures ) t?.destroy(true);
    s.textures = s.levels.map((l) => l ? this.texture(l, s.box) : undefined);
  }

  free(s) {
    if ( !s ) return;
    for ( const t of s.textures ) t?.destroy(true);
    s.textures = []; s.levels = [];
  }

  show(i, j = i, m = 0) {
    const tex = (this.set?.textures ?? []).filter(Boolean);
    if ( !tex.length ) { this.sprite.texture = PIXI.Texture.EMPTY; this.mix.visible = false; this.sprite.visible = true; return; }
    this.index = i % tex.length;
    this.sprite.texture = tex[this.index];
    // between two frames: the mixing quad instead of the sprite (the same place, size and texel grid)
    const blend = m > 0.002 && tex.length > 1;
    if ( blend ) { const a = tex[this.index], b = tex[j % tex.length]; this.mix.set(a, b, m, a.width, a.height); }
    this.mix.visible = blend; this.sprite.visible = !blend;
  }

  tick(dtMS) {
    if ( this.paused || !this.set ) return;
    if ( REDUCED?.matches ) return this.show(0);     // reduced motion: one still frame
    this.t += dtMS;
    const n = this.set.textures.filter(Boolean).length;
    // one clock for every loop of water on the scene (the flooded holes of the destruction run on it too): the frame is the time
    // divided by the frame time, so two loops with the same frames and frame time are always on the same frame
    // (the ticker's frame time: one moment per drawn frame, the vsync it is shown at, not when this callback happens to run)
    const tk = canvas.app.ticker;                    // (lastTime is set after the listeners: + elapsedMS = this frame)
    const [i, j, m] = loopMix(tk.lastTime ? tk.lastTime + (tk.elapsedMS || 0) : performance.now(), this.set.ms, n, smoothOn());
    this.show(i, j, m);
  }

  clear() {
    this.free(this.set); if ( this.next !== this.set ) this.free(this.next);
    this.set = this.next = null;
    this.sprite.texture = PIXI.Texture.EMPTY; this.mix.visible = false; this.sprite.visible = true;
  }

  destroy() {
    canvas.app?.ticker?.remove(this._tick);
    this.clear();
    if ( this.root && !this.root.destroyed ) this.root.destroy({ children: true });
  }
}
