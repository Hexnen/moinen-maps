import { bakeRoads } from "./art.mjs";

/**
 * Shows the baked roads: one container in the primary group, between the water (sortLayer 240) and the districts (250), so the
 * roads lie over the map and the rivers (a road over a river reads as a bridge) and under tiles, drawings and tokens.
 */
export class RoadDisplay {
  constructor() {
    this.root = new PIXI.Container();
    this.root.eventMode = "none";
    this.root.interactiveChildren = false;
    Object.assign(this.root, { elevation: 0, sortLayer: 245, sort: 0, _lastSortedIndex: 0 });
    canvas.primary.addChild(this.root);
    this.sprites = [];
  }

  /** Bake the roads again and swap the tiles in one go. Returns the bake time in ms. */
  render(R, g) {
    const t0 = performance.now();
    const tiles = R ? bakeRoads(R, g) : [];
    this.clear();
    for ( const t of tiles ) {
      const tex = PIXI.Texture.from(t.canvas);
      const s = new PIXI.Sprite(tex);
      s.eventMode = "none";
      s.position.set(t.x, t.y);
      // exactly one tile wide: the canvas is TILE * res rounded, so 1 / res could leave a hairline gap between tiles (a seam that
      // flickers while zooming)
      s.scale.set(t.w / t.canvas.width, t.h / t.canvas.height);
      this.root.addChild(s);
      this.sprites.push(s);
    }
    this.lastBake = { ms: performance.now() - t0, tiles: tiles.length, res: tiles[0]?.res ?? 0 };
    return this.lastBake.ms;
  }

  set visible(v) { this.root.visible = v; }

  clear() {
    for ( const s of this.sprites ) { const tex = s.texture; s.destroy(); tex?.destroy(true); }
    this.sprites = [];
  }

  destroy() {
    this.clear();
    if ( !this.root.destroyed ) this.root.destroy({ children: true });
  }
}
