import { sceneRect } from "./model.mjs";

/**
 * The map's own pixels at art resolution: the scene background image, scaled down so that one art pixel is the average of the scene
 * pixels under it. These are the pixels the shards are cut from and the colours the damage is derived from.
 *
 * Only the background image is sampled: tiles lie above the damage (like water and districts), so pieces of them would be doubled.
 */
export function backgroundInfo() {
  const bg = canvas.primary?.background, tex = bg?.texture;
  if ( !tex?.valid || tex === PIXI.Texture.WHITE || tex === PIXI.Texture.EMPTY || !bg.visible || bg.rotation ) return null;
  const src = tex.baseTexture?.resource?.source;
  if ( !src ) return null;
  return { bg, tex, src, path: canvas.level?.background?.src ?? tex.baseTexture.cacheId ?? "" };
}

/**
 * The whole scene at art resolution, sampled once per (scene, background, art pixel) and kept: { key, map: { w, h, data } }. The bake
 * cuts every area's window out of this one picture, so an area's pixels never depend on where other damage lies.
 */
let whole = null;
export function sceneMap(S) {
  const info = backgroundInfo();
  // the same on every client (it is part of every area's hash)
  const key = `${canvas.scene?.id}|${info?.path ?? ""}|${S.ap}|${S.aw}x${S.ah}|${bgColor()}`;
  if ( whole?.key !== key || whole.tex !== info?.tex?.baseTexture ) {
    whole = { key, wkey: `${key}#${++sampled}`, tex: info?.tex?.baseTexture, map: { w: S.aw, h: S.ah, data: mapPixels(S.ap, { x0: 0, y0: 0, w: S.aw, h: S.ah }) } };
  }
  return whole;
}
let sampled = 0;
export function forgetSceneMap() { whole = null; }

/** The colour under the map (v14: the level's background colour; Scene#backgroundColor is deprecated and logs on every read). */
const bgColor = () => { const c = canvas.level?.background?.color; return c?.css ?? (c ? String(c) : "#808080"); };

/** RGBA (Uint8ClampedArray) of a box of art pixels { x0, y0, w, h }. */
export function mapPixels(ap, box) {
  const r = sceneRect();
  const c = new OffscreenCanvas(Math.max(1, box.w), Math.max(1, box.h)), ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = bgColor();
  ctx.fillRect(0, 0, box.w, box.h);
  const info = backgroundInfo();
  if ( info ) {
    const { bg, tex, src } = info;
    const tw = tex.orig.width, th = tex.orig.height, sx = bg.scale.x || 1, sy = bg.scale.y || 1;
    const res = tex.baseTexture.resolution || 1;
    // world -> texture pixels (as districts.mjs does): local = (world - position) / scale + pivot, texture = local + anchor * size
    const toTX = (wx) => (wx - bg.x) / sx + bg.pivot.x + bg.anchor.x * tw, toTY = (wy) => (wy - bg.y) / sy + bg.pivot.y + bg.anchor.y * th;
    const fromTX = (tx) => (tx - bg.pivot.x - bg.anchor.x * tw) * sx + bg.x, fromTY = (ty) => (ty - bg.pivot.y - bg.anchor.y * th) * sy + bg.y;
    const wx0 = r.x + box.x0 * ap, wy0 = r.y + box.y0 * ap, wx1 = wx0 + box.w * ap, wy1 = wy0 + box.h * ap;
    const tx0 = Math.max(0, toTX(wx0)), ty0 = Math.max(0, toTY(wy0)), tx1 = Math.min(tw, toTX(wx1)), ty1 = Math.min(th, toTY(wy1));
    if ( tx1 > tx0 && ty1 > ty0 ) {
      const dx = (fromTX(tx0) - wx0) / ap, dy = (fromTY(ty0) - wy0) / ap, dw = (fromTX(tx1) - fromTX(tx0)) / ap, dh = (fromTY(ty1) - fromTY(ty0)) / ap;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      try {
        ctx.drawImage(src, (tex.frame.x + tx0) * res, (tex.frame.y + ty0) * res, (tx1 - tx0) * res, (ty1 - ty0) * res, dx, dy, dw, dh);
      } catch ( err ) { console.warn("moinen-maps | destruction: cannot read the background", err); }
    }
  }
  return ctx.getImageData(0, 0, box.w, box.h).data;
}
