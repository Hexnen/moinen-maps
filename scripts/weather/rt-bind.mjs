/**
 * BIND BACK after a pass into an own render texture (clouds.mjs, cells.mjs): the target that was bound before, with its frames.
 *
 * These passes run in a ticker listener, between two frames' renders, so the renderer's `renderTexture.current` is whatever was bound
 * last, not necessarily a live target. Foundry's hover test (TextureLoader.getTextureAlphaData, from #updateHoveredObjects) renders a
 * sprite into a temporary render texture and destroys it, leaving `current` pointing at the destroyed texture (baseTexture null) until
 * the next frame's render binds the screen again. Binding that back threw "Cannot read properties of null (reading 'resolution')" in
 * PIXI's bind and cut the cloud tick short (on every scene load with clouds, GM and players). A destroyed target is nothing to return
 * to: bind the screen, as the next render does anyway.
 */
export function bindBack(RT, cur, sf, df) {
  if ( cur && !cur.baseTexture ) RT.bind(null);
  else RT.bind(cur, sf, df);
}
