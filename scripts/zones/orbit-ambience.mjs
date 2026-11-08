/**
 * Life on the Orbit scene, drawn on the same art-pixel grid as its picture (6 scene px): stars that twinkle, a shooting star now
 * and then, a satellite crossing slowly above the planet's limb with a blinking light. One Graphics under the tokens, redrawn each
 * frame (a few dozen rectangles); nothing runs on any other scene or in a hidden tab.
 */
import { rng } from "./space.mjs";

const ART = 6;
let G = null, tick = null;

export function stopAmbience() {
  if ( tick ) canvas.app?.ticker?.remove(tick);
  tick = null;
  if ( G && !G.destroyed ) G.destroy();
  G = null;
}

export function startAmbience(scene, seed = 1) {
  stopAmbience();
  if ( !canvas?.ready || !canvas.primary ) return;
  const W = scene.width, H = scene.height, rand = rng((seed ^ 0x9e3779b9) >>> 0);
  const snap = (v) => Math.round(v / ART) * ART;
  G = new PIXI.Graphics();
  G.eventMode = "none";
  Object.assign(G, { elevation: 0, sortLayer: 100, sort: 0, _lastSortedIndex: 0 });
  canvas.primary.addChild(G);

  const COLS = [0xffffff, 0xdfe2ff, 0xa9c8ff, 0xfff1d0];
  const twinkles = Array.from({ length: 40 }, () => ({
    x: snap(rand() * W), y: snap(rand() * H * 0.58), p: rand() * Math.PI * 2, f: 0.35 + rand() * 0.9, big: rand() < 0.3, c: COLS[Math.floor(rand() * COLS.length)]
  }));
  let shoot = null, nextShoot = performance.now() + 2500 + Math.random() * 4000;
  const sat = { period: 48000, y0: H * (0.6 + rand() * 0.06), arc: H * 0.07, dir: rand() < 0.5 ? 1 : -1, t0: performance.now() - rand() * 48000 };

  const px = (x, y, c, a = 1, s = 1) => { G.beginFill(c, a).drawRect(snap(x), snap(y), ART * s, ART * s).endFill(); };

  tick = () => {
    if ( !G || G.destroyed || document.hidden ) return;
    const now = performance.now(), t = now / 1000;
    G.clear();
    // twinkling stars: a dot that flares into a small cross
    for ( const s of twinkles ) {
      const a = Math.max(0, Math.sin(t * s.f * 2 + s.p)) ** 3;
      if ( a < 0.05 ) continue;
      px(s.x, s.y, s.c, a);
      if ( s.big && a > 0.5 ) for ( const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] ) px(s.x + dx * ART, s.y + dy * ART, s.c, (a - 0.5) * 1.6);
    }
    // a shooting star: a bright head with a fading trail, across the upper sky in about 0.7 s
    if ( !shoot && now > nextShoot ) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      shoot = { x: W * (0.1 + Math.random() * 0.8), y: H * (0.05 + Math.random() * 0.3), vx: dir * W * (0.35 + Math.random() * 0.2), vy: H * (0.18 + Math.random() * 0.12), t0: now, life: 700 };
    }
    if ( shoot ) {
      const u = (now - shoot.t0) / shoot.life;
      if ( u >= 1 ) { shoot = null; nextShoot = now + 4000 + Math.random() * 7000; }
      else {
        const hx = shoot.x + shoot.vx * u * 0.7, hy = shoot.y + shoot.vy * u * 0.7, fade = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
        const L = Math.hypot(shoot.vx, shoot.vy), ux = shoot.vx / L, uy = shoot.vy / L;
        for ( let k = 0; k < 12; k++ ) px(hx - ux * k * ART, hy - uy * k * ART, k < 2 ? 0xffffff : k < 6 ? 0xdfe2ff : 0x6d7299, fade * (1 - k / 12));
      }
    }
    // the satellite: a body, two solar panels and a blinking red light, on a shallow arc above the limb
    const u = (((now - sat.t0) % sat.period) / sat.period), x = sat.dir > 0 ? -W * 0.05 + u * W * 1.1 : W * 1.05 - u * W * 1.1;
    const y = sat.y0 - Math.sin(u * Math.PI) * sat.arc;
    px(x, y, 0xc8c2d0); px(x + ART, y, 0x9c96a8);
    px(x - ART * 2, y, 0x2a6fbf); px(x - ART, y, 0x4f96dd); px(x + ART * 2, y, 0x4f96dd); px(x + ART * 3, y, 0x2a6fbf);
    if ( Math.floor(t * 1.4) % 2 === 0 ) px(x, y - ART, 0xff4a4a);
  };
  canvas.app.ticker.add(tick);
}
