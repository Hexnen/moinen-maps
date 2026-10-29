import { buildLut, paintFrame } from "./paint.mjs";

/**
 * Plays the baked water over the map: one sprite in the primary group (between the scene background and the districts, tiles and
 * tokens) that swaps its texture frame by frame. Textures are nearest-neighbour so the pixel art stays crisp at any zoom.
 *
 * A bake fills a new frame set (`next`); the one playing (`set`) stays until the new one is complete (`commit`), unless nothing is
 * playing yet, in which case the frames show as they arrive.
 */
const REDUCED = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

export class WaterDisplay {
  constructor() {
    this.root = new PIXI.Container();
    this.root.eventMode = "none";
    // sorted like the districts layer: by elevation, then sortLayer (below the districts' 250), then sort
    Object.assign(this.root, { elevation: 0, sortLayer: 240, sort: 0, _lastSortedIndex: 0 });
    this.sprite = this.root.addChild(new PIXI.Sprite(PIXI.Texture.EMPTY));
    this.sprite.eventMode = "none";
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
    this.sprite.scale.set(S.px);
    this.show(0);
  }

  texture(levels, box) {
    const c = document.createElement("canvas"); c.width = box.w; c.height = box.h;
    c.getContext("2d").putImageData(new ImageData(paintFrame(levels, box.w, box.h, this.lut), box.w, box.h), 0, 0);
    const tex = PIXI.Texture.from(c, { scaleMode: PIXI.SCALE_MODES.NEAREST });
    tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
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

  show(i) {
    const tex = (this.set?.textures ?? []).filter(Boolean);
    if ( !tex.length ) { this.sprite.texture = PIXI.Texture.EMPTY; return; }
    this.index = i % tex.length;
    this.sprite.texture = tex[this.index];
  }

  tick(dtMS) {
    if ( this.paused || !this.set ) return;
    if ( REDUCED?.matches ) return this.show(0);     // reduced motion: one still frame
    this.t += dtMS;
    const n = this.set.textures.filter(Boolean).length;
    this.show(n < 2 ? 0 : Math.floor(this.t / Math.max(20, this.set.ms)) % n);
  }

  clear() {
    this.free(this.set); if ( this.next !== this.set ) this.free(this.next);
    this.set = this.next = null;
    this.sprite.texture = PIXI.Texture.EMPTY;
  }

  destroy() {
    canvas.app?.ticker?.remove(this._tick);
    this.clear();
    if ( this.root && !this.root.destroyed ) this.root.destroy({ children: true });
  }
}
