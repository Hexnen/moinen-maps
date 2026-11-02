/**
 * THE PASSIVE EFFECTS RIDE WITH THEIR TOKEN (tokens/carry.mjs). A carry (and a plough) only offsets the token's mesh and container; the document moves at
 * the end. What follows the token by itself and what does not:
 *   - Sequencer effects `attachTo(token)`: Sequencer reads the placeable's own position (`token.x` / `.y`, the container the carry offsets), every frame: they follow.
 *   - moinen-pixel-vfx's own sprites (the passive / ongoing loops, auras: player.mjs `o.attach`): each frame the owner sets the sprite to visualCenter(token) + its
 *     calibration offset, and visualCenter is the DOCUMENT's centre unless the mesh is in its own motion table: they do NOT follow a carry.
 *   - ground effects / one-shots placed at a point, filters on the mesh (the mesh moves, so they follow), the token's own ring and bars (the container): as they are.
 * For the second kind, with no hook in that module: the owner's sprites live in two containers (the interface layer at zIndex 9000 and a container among the
 * primary group's children). After the owner's tick (this runs later in the frame) a sprite that is RESET every frame by its owner is shifted by the ride's
 * offset (and lift); the owner puts it back from the document the next frame, so nothing needs restoring and nothing is left over at the hand-over.
 * A sprite is told apart from a static one (a ground effect that nobody resets) by a probe: it is nudged by PROBE px and checked on the next frame (the owner
 * has set it back: attached; still nudged: static, nudged back). Its token is the one whose document centre is nearest to where the owner puts it.
 * THIS IS NOW ONLY THE FALLBACK: with moinen-pixel-vfx >= 0.2.0 (api.visual.version) carry.mjs declares the ride through the official visual-transform API and never calls follow()
 * (see README, "Carry, hovering tokens and moinen-pixel-vfx"); the probe stays for older / absent versions so nothing regresses.
 * Pure parts (the probe, the owner) are exported for node tests. Without moinen-pixel-vfx (or without its layers) this does nothing, with no error.
 */
export const PROBE = 0.4;            // px: far under what is visible, far over a float error
export const REACH = 1.6;            // a sprite belongs to a token when it lies within this many token sizes of its centre

/** After the nudge of `probe` px along x: did its owner put the sprite back (true: attached) or not (false: static)? `p0` the position before, `p` now. */
export const wasReset = (p0, p, probe = PROBE) => Math.abs(p.x - (p0.x + probe)) > 0.02 || Math.abs(p.y - p0.y) > 0.02;

/** The index of the centre nearest to (x, y) within `reach` px, or -1. `centres` [{ x, y, r }] (r the token's size: the reach is REACH * r). */
export function ownerOf(x, y, centres) {
  let best = -1, bd = Infinity;
  for ( let i = 0; i < centres.length; i++ ) {
    const c = centres[i], d = Math.hypot(x - c.x, y - c.y);
    if ( d < bd && d <= REACH * (c.r ?? 100) ) { bd = d; best = i; }
  }
  return best;
}

const SEEN = new WeakMap();          // display object -> { kind: "probe" | "attached" | "static" | "free", p0, owner }
let frame = 0;
let layers = [];

/** The containers the sibling module draws its token-bound sprites in (feature-detected: none without the module). */
function findLayers() {
  try {
    if ( !globalThis.canvas?.ready || !game.modules.get("moinen-pixel-vfx")?.active ) return [];
    const out = [];
    for ( const c of canvas.interface?.children ?? [] ) if ( c.zIndex === 9000 && c.sortableChildren && c.eventMode === "none" && !c.destroyed ) out.push(c);
    for ( const c of canvas.primary?.children ?? [] ) if ( c.constructor === PIXI.Container && c.sortableChildren && c.eventMode === "none" && !c.destroyed && c.children.length ) out.push(c);
    return out;
  } catch { return []; }
}

/**
 * Called once a frame, after the owners' ticks: `riders` [{ id, cx, cy (the token's document centre), r (size), ox, oy (the ride's offset), lift }] the tokens
 * being carried / pushed (visually); `others` [{ id, cx, cy, r }] the other tokens (so a sprite of a token that stays is not taken by a rider next to it).
 */
export function follow(riders, others) {
  if ( !riders.length ) return 0;
  if ( (frame++ % 10) === 0 || !layers.length ) layers = findLayers();
  if ( !layers.length ) return 0;
  const centres = [...riders, ...others];
  let moved = 0;
  for ( const L of layers ) {
    if ( L.destroyed ) continue;
    for ( const s of L.children ) {
      if ( !s?.position || s.destroyed ) continue;
      let rec = SEEN.get(s);
      if ( !rec ) {                                              // new: probe it (the owner resets an attached sprite in its next tick)
        const near = ownerOf(s.position.x, s.position.y, centres) >= 0; if ( !near ) continue;
        rec = { kind: "probe", p0: { x: s.position.x, y: s.position.y } }; SEEN.set(s, rec);
        s.position.x += PROBE; continue;
      }
      if ( rec.kind === "probe" ) {
        if ( wasReset(rec.p0, s.position) ) { rec.kind = "attached"; }
        else { s.position.x -= PROBE; rec.kind = "static"; continue; }
      }
      if ( rec.kind !== "attached" ) continue;
      // its token: the one nearest to where the owner has just put it (before our shift)
      const i = ownerOf(s.position.x, s.position.y, centres); if ( i < 0 || i >= riders.length ) continue;
      const r = riders[i];
      s.position.x += r.ox; s.position.y += r.oy + (r.lift ?? 0); moved++;
    }
  }
  return moved;
}

/** Forget what was learned (a scene change): sprites are new objects anyway; this only drops the layer list. */
export function reset() { layers = []; frame = 0; }
