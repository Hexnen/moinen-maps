/**
 * A zone quakes when it becomes wrecked: what is on screen inside the zone (map, tokens, light - not the UI) is copied once,
 * masked to the zone's shape and shaken with a fast decaying jitter over a dark crack-gap, while dust puffs rise from it and bits
 * of rubble drop (screen-down). About a second; the snapshot and every piece are freed at the end.
 *
 * One render of the stage into a texture the size of the zone on screen (clamped to the screen) - no per-frame cost but the
 * jitter and the few particles.
 */
const DURATION = 1000;
const live = new Set();
/** Stop every running quake now (the zones teardown calls it). */
export function stopQuakes() { for ( const done of [...live] ) done(); }

function drawZone(G, zone) {
  for ( const part of zone.parts ) {
    G.beginFill(0xffffff, 1); G.drawPolygon(part[0]);
    for ( const h of part.slice(1) ) { G.beginHole(); G.drawPolygon(h); G.endHole(); }
    G.endFill();
  }
}

/**
 * @param {object} zone   a zone from geometry.buildZones ({ id, parts: [[outer, ...holes]] }, flat [x, y, ...] rings)
 * @param {object} opts   { grid: grid size in scene px, inside: (x, y) => boolean }
 */
export function quake(zone, { grid = 100, inside = () => true } = {}) {
  if ( !canvas?.ready || !zone?.parts?.length || !canvas.interface ) return;
  const R = canvas.app.renderer, st = canvas.stage, wt = st.worldTransform;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( const part of zone.parts ) for ( const r of part ) for ( let i = 0; i < r.length; i += 2 ) {
    x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]);
  }
  const pad = grid * 0.3;
  const a = wt.apply(new PIXI.Point(x0 - pad, y0 - pad)), b = wt.apply(new PIXI.Point(x1 + pad, y1 + pad));
  const sx0 = Math.max(0, Math.floor(a.x)), sy0 = Math.max(0, Math.floor(a.y));
  const sx1 = Math.min(R.screen.width, Math.ceil(b.x)), sy1 = Math.min(R.screen.height, Math.ceil(b.y));
  if ( sx1 - sx0 < 4 || sy1 - sy0 < 4 ) return;   // off screen: nothing to see shake

  // the snapshot: the stage as drawn now, without the interface (rulers, HUD bits) and controls
  const rt = PIXI.RenderTexture.create({ width: sx1 - sx0, height: sy1 - sy0, resolution: R.resolution });
  const hidden = [canvas.interface, canvas.controls].filter((c) => c?.visible);
  for ( const c of hidden ) c.visible = false;
  try { R.render(st, { renderTexture: rt, clear: true, transform: new PIXI.Matrix(1, 0, 0, 1, -sx0, -sy0), skipUpdateTransform: true }); }
  catch ( err ) { rt.destroy(true); return void console.warn("moinen-maps | zones quake", err); }
  finally { for ( const c of hidden ) c.visible = true; }

  const scale = st.scale.x, o = wt.applyInverse(new PIXI.Point(sx0, sy0));
  const root = new PIXI.Container();
  root.eventMode = "none"; root.zIndex = -1000;
  const gap = new PIXI.Graphics(); gap.beginFill(0x17110d, 0.92); for ( const part of zone.parts ) { gap.drawPolygon(part[0]); } gap.endFill();
  const mask = new PIXI.Graphics(); drawZone(mask, zone);
  const spr = new PIXI.Sprite(rt); spr.scale.set(1 / scale); spr.position.set(o.x, o.y); spr.mask = mask;
  const fx = new PIXI.Graphics();
  root.addChild(gap, spr, mask, fx);
  canvas.interface.addChildAt(root, 0);
  canvas.interface.sortChildren?.();

  // dust puffs and rubble, from random spots inside the zone
  const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
  const spot = () => { for ( let k = 0; k < 30; k++ ) { const x = rnd(x0, x1), y = rnd(y0, y1); if ( inside(x, y) ) return [x, y]; } return [(x0 + x1) / 2, (y0 + y1) / 2]; };
  const area = Math.max(1, ((x1 - x0) * (y1 - y0)) / (grid * grid));
  const puffs = Array.from({ length: Math.round(Math.min(18, 5 + area * 0.8)) }, () => { const [x, y] = spot(); return { x, y, t0: rnd(0, 0.45), r: rnd(0.25, 0.55) * grid, c: [0x8f8070, 0x6f6458, 0xa89a86][Math.floor(rnd(0, 3))] }; });
  const bits = Array.from({ length: Math.round(Math.min(30, 8 + area * 1.5)) }, () => { const [x, y] = spot(); return { x, y, t0: rnd(0, 0.35), vx: rnd(-0.6, 0.6) * grid, vy: rnd(-1.4, -0.4) * grid, s: rnd(0.04, 0.09) * grid, c: [0x3a322b, 0x5a4e42, 0x7d6f60][Math.floor(rnd(0, 3))] }; });

  const amp = grid * 0.09, start = performance.now();
  let last = 0, dx = 0, dy = 0;
  const tick = () => {
    const now = performance.now(), t = (now - start) / DURATION;
    if ( t >= 1 || root.destroyed ) { done(); return; }
    // the jitter: a new random offset every ~28 ms, a quick attack then a decay
    if ( now - last > 28 ) {
      last = now;
      const env = Math.min(1, t / 0.06) * (1 - t) ** 2;
      dx = (Math.random() * 2 - 1) * amp * env; dy = (Math.random() * 2 - 1) * amp * env * 0.7;
    }
    spr.position.set(o.x + dx, o.y + dy);
    fx.clear();
    for ( const p of puffs ) {
      const u = (t - p.t0) / (1 - p.t0); if ( u <= 0 ) continue;
      fx.beginFill(p.c, 0.5 * (1 - u) ** 1.5).drawCircle(p.x, p.y - u * grid * 0.35, p.r * (0.4 + u)).endFill();
    }
    for ( const q of bits ) {
      const u = t - q.t0; if ( u <= 0 ) continue;
      const s = u * DURATION / 1000, x = q.x + q.vx * s, y = q.y + q.vy * s + 4.5 * grid * s * s;   // screen-down: gravity
      fx.beginFill(q.c, Math.max(0, 1 - u * 1.4)).drawRect(x - q.s / 2, y - q.s / 2, q.s, q.s).endFill();
    }
  };
  let over = false;
  const done = () => {
    if ( over ) return; over = true; live.delete(done);
    canvas.app?.ticker?.remove(tick);
    if ( !root.destroyed ) root.destroy({ children: true });
    rt.destroy(true);
  };
  canvas.app.ticker.add(tick);
  live.add(done);
}
