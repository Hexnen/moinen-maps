/**
 * Baked water in the world's folder. After the GM's client has baked the water it packs the frames into one PNG (the level bytes in the
 * red channel, frames in a grid) and uploads it to `worlds/<world>/moinen-maps/`; the scene flag says which bake it is (`baked.key`).
 * A player whose masks and settings give the same key downloads the PNG instead of baking, with no worker and no waiting.
 * The picture holds the level bytes, not colours, so colours and opacity can still change on the client without a new upload.
 */
import { MODULE_ID } from "../config.mjs";

const picker = () => foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
export const folder = () => `worlds/${game.world.id}/${MODULE_ID}`;

const COLS = 4;
const canvasOf = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

/** Uploads a bake. Returns the record to store in the scene flag, or throws. */
export async function publishBake(sceneId, key, { box, ms, frames }) {
  const n = frames.length, cols = Math.min(COLS, n), rows = Math.ceil(n / cols);
  const W = box.w * cols, H = box.h * rows;
  const c = canvasOf(W, H), ctx = c.getContext("2d");
  const img = new ImageData(W, H), d = img.data;
  for ( let f = 0; f < n; f++ ) {
    const ox = (f % cols) * box.w, oy = Math.floor(f / cols) * box.h, lv = frames[f];
    for ( let y = 0; y < box.h; y++ ) {
      let o = ((oy + y) * W + ox) * 4, i = y * box.w;
      for ( let x = 0; x < box.w; x++, o += 4, i++ ) { d[o] = lv[i]; d[o + 3] = 255; }
    }
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  if ( !blob ) throw new Error("could not encode the baked water");
  const file = new File([blob], `water-${sceneId}.png`, { type: "image/png" });
  const FP = picker(), dir = folder();
  try { await FP.createDirectory("data", dir); } catch { /* it exists already */ }
  const res = await FP.upload("data", dir, file, {}, { notify: false });
  if ( !res?.path && res?.status !== "success" ) throw new Error(res?.message ?? "upload failed");
  return { path: res.path ?? `${dir}/${file.name}`, key, box, ms, frames: n, cols };
}

/** Downloads a published bake: { box, ms, frames: [Uint8Array ...] }, or null when it cannot be had. */
export async function fetchBake(baked) {
  try {
    const url = `${foundry.utils.getRoute(baked.path)}?v=${encodeURIComponent(baked.key)}`;
    const res = await fetch(url, { cache: "force-cache" });
    if ( !res.ok ) return null;
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const { box, frames: n, cols } = baked, c = canvasOf(bmp.width, bmp.height), ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0); bmp.close?.();
    const d = ctx.getImageData(0, 0, c.width, c.height).data, W = c.width, out = [];
    for ( let f = 0; f < n; f++ ) {
      const ox = (f % cols) * box.w, oy = Math.floor(f / cols) * box.h, lv = new Uint8Array(box.w * box.h);
      for ( let y = 0; y < box.h; y++ ) {
        let o = ((oy + y) * W + ox) * 4, i = y * box.w;
        for ( let x = 0; x < box.w; x++, o += 4, i++ ) lv[i] = d[o];
      }
      out.push(lv);
    }
    return { box, ms: baked.ms, frames: out };
  } catch ( err ) {
    console.warn(`${MODULE_ID} | published water`, err);
    return null;
  }
}
