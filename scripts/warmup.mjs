/**
 * WARM-UP at idle after a scene opens: GPU objects that would otherwise be made in the middle of the first zoom or pan.
 *
 * PIXI's filter texture pool keys its render textures by power-of-two size; a filtered object whose screen bounds change with the
 * zoom (Foundry's own effects among them) asks for a size bucket it has not used yet on the first zoom-out or pan: a new texture is
 * created and allocated on the GPU inside that frame (zoomBench cold: one createTexture + texImage2D in the zoom-out and one in the
 * pan; at 1920x1080 a fourth screen-sized one in the zoom-in). Here the buckets between half the screen and the screen (power-of-two,
 * both sides) and four screen-sized textures are allocated once, a second or two after canvasReady, and handed back to the pool,
 * which keeps them for the filters (they are what a zoom sweep leaves in the pool anyway).
 */
const IDLE_MS = 1500;
const FULLSCREEN = 4;
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
  const sizes = buckets(R.screen.width * res, R.screen.height * res).map(([w, h]) => [w / res, h / res]);
  // screen-sized ones too (the pool's full-screen key): nested filters hold several at once - 4 on "map" after a zoom sweep
  for ( let i = 0; i < FULLSCREEN; i++ ) sizes.push([R.screen.width, R.screen.height]);
  for ( const [w, h] of sizes ) {
    const rt = pool.getOptimalTexture(w, h, res);
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
