import { bakeRoads } from "./art.mjs";

/**
 * Shows the baked roads: one container in the primary group, between the water (sortLayer 240) and the districts (250), so the
 * roads lie over the map and the rivers (a road over a river reads as a bridge) and under tiles, drawings and tokens.
 * A tile whose roads did not change keeps its sprite and texture: an edit (or a shape being dragged) bakes only the tiles it touches.
 */
export class RoadDisplay {
  constructor() {
    this.root = new PIXI.Container();
    this.root.eventMode = "none";
    this.root.interactiveChildren = false;
    Object.assign(this.root, { elevation: 0, sortLayer: 245, sort: 0, _lastSortedIndex: 0 });
    canvas.primary.addChild(this.root);
    this.sprites = [];
    this.tiles = new Map();     // tile key -> { sig, sprite }
  }

  /** Bake the changed tiles again and swap them in one go. Returns the bake time in ms. */
  render(R, g) {
    const t0 = performance.now();
    const old = this.tiles;
    const tiles = R ? bakeRoads(R, g, { keep: (key, sig) => old.get(key)?.sig === sig }) : [];
    const next = new Map();
    let baked = 0;
    for ( const t of tiles ) {
      if ( !t.canvas ) { next.set(t.key, old.get(t.key)); old.delete(t.key); continue; }
      baked++;
      const s = new PIXI.Sprite(PIXI.Texture.from(t.canvas));
      s.eventMode = "none";
      s.position.set(t.x, t.y);
      // exactly one tile wide: the canvas is TILE * res rounded, so 1 / res could leave a hairline gap between tiles (a seam that
      // flickers while zooming)
      s.scale.set(t.w / t.canvas.width, t.h / t.canvas.height);
      this.root.addChild(s);
      next.set(t.key, { sig: t.sig, sprite: s });
    }
    for ( const o of old.values() ) RoadDisplay.#free(o.sprite);
    this.tiles = next;
    this.sprites = [...next.values()].map((o) => o.sprite);
    this.lastBake = { ms: performance.now() - t0, tiles: tiles.length, baked, res: tiles[0]?.res ?? 0 };
    return this.lastBake.ms;
  }

  set visible(v) { this.root.visible = v; }

  static #free(s) { const tex = s.texture; s.destroy(); tex?.destroy(true); }

  clear() {
    for ( const s of this.sprites ) RoadDisplay.#free(s);
    this.sprites = []; this.tiles = new Map();
  }

  destroy() {
    this.clear();
    if ( !this.root.destroyed ) this.root.destroy({ children: true });
  }
}
