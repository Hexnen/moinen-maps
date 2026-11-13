/**
 * Where the zones' play marks are drawn (C1 + C13, the user's answer of 2026-11-12): ABOVE the scene's lighting - a coloured or
 * dark light does not tint or dim them - but UNDER the tokens, and still under the fog (an unexplored or unseen part of the map
 * hides them as it hides the map).
 *
 * Foundry draws the map and the tokens in the primary group, then multiplies the lighting over all of it (the effects group), then
 * the fog (the visibility group). Nothing in the primary group escapes the light, and everything in the effects group lies over the
 * tokens. So one container is put at the end of the effects group (after the light, under the fog) and the tokens are cut out of
 * it: it is drawn apart (one filter pass, so what is erased is erased from it alone) and every token this user sees is drawn into
 * it again with the ERASE blend, its own picture at its own place and opacity. What is left lies on the map between the tokens.
 *
 * Kept here: the highlights (their wash, lines, veil, and labels: highlight-layer.mjs) and the passages' lines and marks
 * (display.mjs). The zone numbers, borders, walls and tints stay in the primary group under the light, as before.
 *
 * One container for all of them (one pass). Without an effects group (an older core, the node tests) `attach` puts a part where it
 * was before (the fallback) and nothing is cut.
 *
 * PERF: while none of its parts shows, it is not drawn at all (no pass); while one shows, one extra pass over the screen and one
 * sprite per visible token, their places copied once per frame from the tokens' own meshes (already placed for this frame).
 */

let host = null;

/** The tokens' meshes this user sees now, with the opacity they are drawn at. */
function visibleMeshes() {
  const out = [];
  for ( const t of canvas?.tokens?.placeables ?? [] ) {
    const m = t?.mesh;
    if ( !t.visible || !m || m.destroyed || !m.visible || !m.renderable || !m.texture?.valid ) continue;
    const a = m.worldAlpha ?? 1;
    if ( a > 0.01 ) out.push(m);
  }
  return out;
}

class Host extends PIXI.Container {
  constructor() {
    super();
    this.eventMode = "none";
    this.interactiveChildren = false;
    this.content = this.addChild(new PIXI.Container());
    this.content.sortableChildren = true;
    this.cut = this.addChild(new PIXI.Container());
    this.pool = [];
    const f = new PIXI.AlphaFilter(1);
    // the renderer's own resolution and anti-aliasing: the lines look as they did in the primary group
    f.resolution = null;
    try { f.multisample = canvas.app.renderer.multisample ?? PIXI.MSAA_QUALITY.NONE; } catch {}
    this.filters = [f];
    this.filterArea = canvas.app.renderer.screen;
  }

  /** Something of ours shows: only then is the pass made. */
  get showing() { return this.content.children.some((c) => c.visible && c.renderable !== false && c.alpha > 0); }

  /** Copy every visible token's picture into the cut (ERASE), placed as its mesh is placed now. */
  syncCut() {
    const meshes = visibleMeshes(), inv = this.worldTransform.clone().invert();
    while ( this.pool.length < meshes.length ) {
      const s = new PIXI.Sprite(PIXI.Texture.EMPTY);
      s.blendMode = PIXI.BLEND_MODES.ERASE;
      this.pool.push(this.cut.addChild(s));
    }
    this.pool.forEach((s, i) => {
      const m = meshes[i];
      s.visible = !!m;
      if ( !m ) return;
      s.texture = m.texture;
      s.anchor.copyFrom(m.anchor);
      s.alpha = m.worldAlpha ?? 1;
      s.transform.setFromMatrix(inv.clone().append(m.worldTransform));
    });
  }

  render(renderer) {
    if ( !this.visible || !this.showing ) return;
    this.syncCut();
    // (placed after the stage's transforms were updated for this frame: update the cut's own before drawing it)
    this.cut.updateTransform();
    super.render(renderer);
  }

  /** The effects group tears its children down on a new scene: we go with the canvas. */
  tearDown() { drop(); }
}

/** The container, made on first use at the end of the effects group (null: there is none, see the top of the file). */
function getHost() {
  if ( host && !host.destroyed && host.parent ) return host;
  host = null;
  const fx = canvas?.effects;
  if ( !fx || typeof fx.addChild !== "function" || typeof PIXI.AlphaFilter !== "function" || PIXI.BLEND_MODES?.ERASE == null ) return null;
  host = new Host();
  fx.addChild(host);
  return host;
}

/**
 * Put a part above the light and under the tokens. `z`: its order among the parts (lower under). `fallback()`: where it goes when
 * there is no such place (it is added there as it was before). Returns true when it went above the light.
 */
export function attach(obj, z, fallback) {
  const h = getHost();
  if ( !h ) { fallback?.(obj); return false; }
  obj.zIndex = z;
  h.content.addChild(obj);
  return true;
}

/** Whether the part lies above the light (for tools and tests). */
export const isUnlit = (obj) => !!host && !host.destroyed && obj?.parent === host.content;
/** The container (for tools and tests): null while none was made. */
export const hostOf = () => (host && !host.destroyed ? host : null);

/** Gone with the canvas: the parts are their owners' to destroy; the container and its cut go here. */
export function drop() {
  const h = host;
  host = null;
  if ( !h || h.destroyed ) return;
  h.content.removeChildren();
  h.parent?.removeChild(h);
  h.destroy({ children: true });
}

Hooks.on("canvasTearDown", drop);

/** Z order of the parts (lower under). */
export const Z = { passages: 10, highlights: 20, labels: 30 };
