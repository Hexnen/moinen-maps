/**
 * Life on the Orbit scene, drawn on the same art-pixel grid as its picture (6 scene px), fitted to where the picture put its planet
 * (saved in the scene flag when the picture is made; an older scene paints the same seed once more to learn it, ~0.1 s):
 * - stars that twinkle, a shooting star every few seconds, faint dust drifting across;
 * - an aurora shimmering in curtains just above the planet's night-side limb;
 * - two satellites on orbits that follow the planet's curve (a high slow one, a low fast one the other way), turning slowly;
 * - a few bits of debris tumbling along their own orbits.
 * - the planet's clouds drifting very slowly round its curve (orbit-clouds.mjs: one small texture, repainted about twice a second).
 * One Graphics under the tokens, redrawn each frame (about a hundred rectangles); nothing runs on any other scene or in a hidden tab.
 */
import { rng, paintSpace, lastLayout } from "./space.mjs";
import { startClouds } from "./orbit-clouds.mjs";

const ART = 6;
let G = null, tick = null, clouds = null;
/** The drifting clouds of the open Orbit scene (dev: stats, layer). */
export const orbitClouds = () => clouds;

export function stopAmbience() {
  if ( tick ) canvas.app?.ticker?.remove(tick);
  tick = null;
  try { clouds?.destroy(); } catch { /* gone with the canvas */ }
  clouds = null;
  if ( G && !G.destroyed ) G.destroy();
  G = null;
}

export function startAmbience(scene, seed = 1, layout = null, flag = null) {
  stopAmbience();
  if ( !canvas?.ready || !canvas.primary ) return;
  const W = scene.width, H = scene.height, aw = Math.round(W / ART), ah = Math.round(H / ART);
  // where the picture's planet is (art px -> scene px)
  let planet = { cx: aw * 0.5, cy: ah * 1.6, R: aw * 0.68, light: [-0.92, -0.18, 0.34] };
  if ( layout?.planet ) planet = layout.planet;
  else try { paintSpace(seed, aw, ah, { layoutOnly: true }); if ( lastLayout.planet ) planet = lastLayout.planet; } catch { /* the fallback above */ }
  const PCX = planet.cx * ART, PCY = planet.cy * ART, PR = planet.R * ART;
  const rand = rng((seed ^ 0x9e3779b9) >>> 0);
  const snap = (v) => Math.round(v / ART) * ART;
  G = new PIXI.Graphics();
  G.eventMode = "none";
  Object.assign(G, { elevation: 0, sortLayer: 100, sort: 0, _lastSortedIndex: 0 });
  canvas.primary.addChild(G);
  try { clouds = startClouds(scene, flag ?? { seed, v: 1, layout }, ART); } catch ( err ) { console.warn("moinen-maps | orbit clouds", err); clouds = null; }
  const px = (x, y, c, a = 1, k = 1) => { if ( a > 0.02 ) G.beginFill(c, Math.min(1, a)).drawRect(snap(x), snap(y), ART * k, ART * k).endFill(); };
  const onScreen = (x, y) => x > -ART * 8 && x < W + ART * 8 && y > -ART * 8 && y < H + ART * 8;
  // a point on a circle around the planet's centre: angle a (0 = right, -PI/2 = straight up)
  const orbitAt = (r, a) => [PCX + Math.cos(a) * r, PCY + Math.sin(a) * r];
  // the arc of the limb that is on screen: angles where the circle crosses the scene's sides
  const span = (r) => { const s = Math.min(1, (W * 0.5 + Math.abs(PCX - W / 2) + ART * 8) / r); return Math.asin(s) * 1.05; };

  // ---- stars, shooting stars, dust
  const COLS = [0xffffff, 0xdfe2ff, 0xa9c8ff, 0xfff1d0];
  const twinkles = [];
  for ( let k = 0; twinkles.length < 55 && k < 400; k++ ) {
    const x = snap(rand() * W), y = snap(rand() * H);
    if ( Math.hypot(x - PCX, y - PCY) < PR + ART * 4 ) continue;
    twinkles.push({ x, y, p: rand() * Math.PI * 2, f: 0.35 + rand() * 0.9, big: rand() < 0.3, c: COLS[Math.floor(rand() * COLS.length)] });
  }
  const dust = Array.from({ length: 30 }, () => ({ x: rand() * W, y: rand() * H, v: (4 + rand() * 10) * ART, a: 0.15 + rand() * 0.25, p: rand() * 6 }));
  let shoot = null, nextShoot = performance.now() + 1500 + Math.random() * 2500;

  // ---- aurora: curtains on the night side of the limb (the side away from the sun)
  const nightSide = planet.light[0] < 0 ? 1 : -1;   // sun from the left: the night is on the right
  const AUR = [0x2fd08a, 0x5fffb0, 0x2fb0c8, 0x9a6fff];

  // ---- satellites and debris on orbits around the planet
  const SAT_GOLD = [0xe8c060, 0xb08a3a, 0x7a5a24], PANEL = [0x1d3f7a, 0x2f63b0, 0x4f8fdc], BOOM = 0x9c96a8;
  const sats = [
    { r: PR + ART * 34, period: 80000, dir: 1, t0: performance.now() - rand() * 80000, spin: 0.35, cells: 4 },
    { r: PR + ART * 14, period: 36000, dir: -1, t0: performance.now() - rand() * 36000, spin: 0.6, cells: 3 }
  ];
  const debris = Array.from({ length: 7 }, () => ({ r: PR + ART * (8 + rand() * 40), period: 40000 + rand() * 60000, dir: rand() < 0.5 ? 1 : -1,
    t0: performance.now() - rand() * 100000, spin: 1 + rand() * 3, c: [0x6d6458, 0x8f8070, 0x4a4658][Math.floor(rand() * 3)] }));
  const along = (o, now) => { const sp = span(o.r), u = (((now - o.t0) % o.period) / o.period); return -Math.PI / 2 + o.dir * (-sp + u * 2 * sp); };

  /** A satellite (not a ship): gold body, booms, two solar panels that foreshorten as it turns (and flash edge-on), a dish, a light. */
  const drawSatellite = (x, y, t, s) => {
    const turn = Math.cos(t * s.spin), w = Math.max(1, Math.round(Math.abs(turn) * s.cells)), edge = Math.abs(turn) < 0.2;
    // satellites are drawn with double-size pixels (12 scene px) so they read at the usual zoom
    const S = ART * 2, at = (dx, dy, c, a = 1) => px(x + dx * S, y + dy * S, c, a, 2);
    at(0, 0, SAT_GOLD[0]); at(1, 0, SAT_GOLD[1]); at(0, 1, SAT_GOLD[1]); at(1, 1, SAT_GOLD[2]);
    at(-1, 0.5, BOOM, 0.9); at(2, 0.5, BOOM, 0.9);
    for ( const side of [-1, 1] ) for ( let i = 0; i < w; i++ ) for ( let j = -0.5; j < 2.5; j++ ) {
      const cx = side < 0 ? -2 - i : 3 + i, c = edge ? 0xdfe2ff : j < 0 ? PANEL[2] : (i + Math.round(j)) % 2 ? PANEL[0] : PANEL[1];
      at(cx, j, c);
    }
    at(0.5, -1, BOOM); at(0, -2, 0xdfe2ff); at(1, -2, 0xc8c2d0); at(0.5, -2.5, 0xffffff, 0.8);
    if ( ((t + s.r) % 1.2) < 0.25 ) at(-0.5, -2.5, 0xff4a4a);
  };

  let last = performance.now();
  tick = () => {
    if ( !G || G.destroyed || document.hidden ) return;
    const now = performance.now(), t = now / 1000, dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clouds?.tick();
    G.clear();

    // dust drifting slowly left, fading in and out
    for ( const d of dust ) {
      d.x -= d.v * dt; if ( d.x < -ART ) { d.x = W + ART; d.y = Math.random() * H; }
      px(d.x, d.y, 0xa9aed6, d.a * (0.6 + 0.4 * Math.sin(t * 0.8 + d.p)));
    }
    // twinkling stars: a dot that flares into a small cross
    for ( const s of twinkles ) {
      const a = Math.max(0, Math.sin(t * s.f * 2 + s.p)) ** 3;
      if ( a < 0.05 ) continue;
      px(s.x, s.y, s.c, a);
      if ( s.big && a > 0.5 ) for ( const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] ) px(s.x + dx * ART, s.y + dy * ART, s.c, (a - 0.5) * 1.6);
    }
    // the aurora: columns along the limb, each a vertical curtain whose height and colour wave with time
    {
      const sp = span(PR), a0 = -Math.PI / 2 + nightSide * sp * 0.15, a1 = -Math.PI / 2 + nightSide * sp;
      const n = Math.ceil(Math.abs(a1 - a0) * PR / ART);
      for ( let i = 0; i < n; i++ ) {
        const a = a0 + (a1 - a0) * (i / n), k = i / n;
        const wave = Math.sin(i * 0.23 + t * 1.3) * 0.5 + Math.sin(i * 0.07 - t * 0.7) * 0.5;
        const strength = Math.max(0, wave + 0.25) * Math.sin(Math.PI * Math.min(1, k * 1.2));
        if ( strength < 0.08 ) continue;
        const h = 2 + Math.round(strength * 9);
        for ( let j = 0; j < h; j++ ) {
          const [x, y] = orbitAt(PR + ART * (1.5 + j), a);
          if ( !onScreen(x, y) ) continue;
          px(x, y, AUR[j < 2 ? 0 : j < 5 ? 1 : (i % 7 === 0 ? 3 : 2)], Math.min(1, strength * 1.3) * (1 - j / (h + 1)));
        }
      }
    }
    // debris tumbling along their orbits: a 2-pixel chip whose shape flips as it turns
    for ( const d of debris ) {
      const [x, y] = orbitAt(d.r, along(d, now));
      if ( !onScreen(x, y) ) continue;
      const f = Math.floor(t * d.spin) % 3;
      px(x, y, d.c); px(x + (f === 0 ? ART : 0), y + (f === 1 ? ART : 0), d.c, f === 2 ? 0 : 0.8);
    }
    // a shooting star: a bright head with a fading trail, across the upper sky in about 0.7 s
    if ( !shoot && now > nextShoot ) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      shoot = { x: W * (0.1 + Math.random() * 0.8), y: H * (0.03 + Math.random() * 0.3), vx: dir * W * (0.35 + Math.random() * 0.2), vy: H * (0.18 + Math.random() * 0.12), t0: now, life: 650 + Math.random() * 300 };
    }
    if ( shoot ) {
      const u = (now - shoot.t0) / shoot.life;
      if ( u >= 1 ) { shoot = null; nextShoot = now + 2500 + Math.random() * 4500; }
      else {
        const hx = shoot.x + shoot.vx * u * 0.7, hy = shoot.y + shoot.vy * u * 0.7, fade = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
        const L = Math.hypot(shoot.vx, shoot.vy), ux = shoot.vx / L, uy = shoot.vy / L;
        for ( let k = 0; k < 12; k++ ) px(hx - ux * k * ART, hy - uy * k * ART, k < 2 ? 0xffffff : k < 6 ? 0xdfe2ff : 0x6d7299, fade * (1 - k / 12));
      }
    }
    // satellites on orbits that follow the planet's curve
    for ( const s of sats ) {
      const [x, y] = orbitAt(s.r, along(s, now));
      if ( onScreen(x, y) ) drawSatellite(x, y, t, s);
    }
  };
  canvas.app.ticker.add(tick);
}
