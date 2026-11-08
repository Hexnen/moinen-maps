// Tornado: look-development helpers for a lane GM page.   const D = await import("/modules/moinen-maps/dev/tornado-dev.mjs")
// `place(level, { path, x, y, ago, ... })` replaces the scene's tornadoes with one (formed `ago` ms ago), `solo([...passes])` draws only
// those passes into its art texture (null = all), `snap(name)` / `crop(name, x, y, w, h)` upload a png (crop: scene px rect, scaled up).
const W = () => game.modules.get("moinen-maps").api.weather;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const R = () => import("/modules/moinen-maps/dev/weather-rec.mjs");

export const view = () => [...(W().tornado.display()?.views.values() ?? [])][0] ?? null;

export async function place(level = 3, { path = null, x = 780, y = 600, ago = 20000, wander = 0.15, speed = 0.6, end = "loop", size = 1, zoom = 1.6, pan = true } = {}) {
  W().tornado.clear({ now: true });
  await wait(600);
  const id = W().tornado.add(path ?? [[x, y]], { level, wander, speed, end, size, at: Date.now() - ago });
  await wait(900);
  if ( pan ) { const L = W().tornado.list()[0]; canvas.pan({ x: L.x, y: L.y - 110, scale: zoom }); }
  await wait(200);
  return id;
}

const ORDER = ["curtain", "skirt", "back", "column", "foot", "front", "wallC", "deck"];
export function solo(list = null) {
  const v = view(); if ( !v ) return;
  delete v.render;
  if ( !list ) return;
  const r = canvas.app.renderer, base = Object.getPrototypeOf(v).render;
  v.render = function() {
    r.render(this.puffs, { renderTexture: this.hf, clear: true });
    let first = true;
    for ( const k of ORDER ) {
      if ( !list.includes(k) ) continue;
      r.render(this[k], { renderTexture: this.art, clear: first }); first = false;
    }
    if ( first ) r.render(this.curtain, { renderTexture: this.art, clear: true });
  };
  return base;
}

export async function snap(name, at = null) { canvas.controls.cursors.visible = false; return (await R()).snap(name, at); }

/** Hide or show the stage parts (ground, marks, show) of the tornado. */
export function stage({ ground = true, marks = true, show = true } = {}) { const v = view(); if ( !v ) return; v._stage = { ground, marks, show }; }

/** A zoom-`k` crop (nearest neighbour) of the screen rect x, y, w, h (screen px) as png `name`. */
export async function crop(name, x, y, w, h, k = 3) {
  canvas.controls.cursors.visible = false;
  canvas.app.ticker.update(performance.now()); canvas.app.renderer.render(canvas.app.stage);
  const c = Object.assign(document.createElement("canvas"), { width: w * k, height: h * k }), g = c.getContext("2d");
  g.imageSmoothingEnabled = false; g.drawImage(canvas.app.view, x, y, w, h, 0, 0, w * k, h * k);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const FP = foundry.applications.apps.FilePicker.implementation;
  const r = await FP.upload("data", "mm-rec", new File([blob], name, { type: "image/png" }), {}, { notify: false });
  return r?.path;
}
