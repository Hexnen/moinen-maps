/**
 * WARM-UP at idle after a scene opens: GPU objects that would otherwise be made in the middle of the first zoom or pan.
 *
 * PIXI's filter texture pool keys its render textures by power-of-two size; a filtered object whose screen bounds change with the
 * zoom (Foundry's own effects among them) asks for a size bucket it has not used yet on the first zoom-out or pan: a new texture is
 * created and allocated on the GPU inside that frame (zoomBench cold: one createTexture + texImage2D in the zoom-out and one in the
 * pan). Here the buckets between half the screen and the screen (power-of-two, both sides) are allocated once, a second or two after
 * canvasReady, and handed back to the pool, which keeps them for the filters.
 */
const IDLE_MS = 1500;
let timer = 0;

const pow2 = (v) => 2 ** Math.ceil(Math.log2(Math.max(1, v)));

/** The pool's buckets a filter on this screen asks for: [w, h] pairs (half the screen up to the screen, power of two). */
export function buckets(sw, sh) {
  const W = pow2(sw), H = pow2(sh), out = [];
  for ( const w of [W / 2, W] ) for ( const h of [H / 2, H] ) if ( w >= 64 && h >= 64 ) out.push([w, h]);
  return out;
}

export function warmFilterPool() {
  const R = canvas?.app?.renderer, pool = R?.filter?.texturePool; if ( !pool ) return 0;
  const res = R.resolution || 1, made = [];
  for ( const [w, h] of buckets(R.screen.width * res, R.screen.height * res) ) {
    const rt = pool.getOptimalTexture(w / res, h / res, res);
    R.texture.bind(rt, 0);                     // the GL texture and its storage, now
    made.push(rt);
  }
  R.texture.unbind?.(made[0]);
  for ( const rt of made ) pool.returnTexture(rt);
  return made.length;
}

export function registerWarmup() {
  Hooks.on("canvasReady", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const run = () => { try { warmFilterPool(); } catch ( err ) { console.warn("moinen-maps | warm-up", err); } };
      if ( globalThis.requestIdleCallback ) requestIdleCallback(run, { timeout: 2000 }); else run();
    }, IDLE_MS);
  });
  Hooks.on("canvasTearDown", () => clearTimeout(timer));
}
