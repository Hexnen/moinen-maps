/**
 * Procedural pixel-art space for the shared Orbit scene: a seeded, deterministic picture painted into an RGBA buffer at a low
 * "art" resolution (one art pixel = `px` scene pixels), then enlarged with hard edges so it stays crisp.
 *
 * Layers, back to front: a deep gradient, two dithered nebula clouds (warped value noise, ordered 4x4 Bayer dither into small
 * palettes), a faint distant galaxy, a field of stars (dots, crosses and a few four-point sparkles), a cratered moon and a big
 * Earth-like planet whose limb arcs across the bottom (oceans, continents, clouds, a dithered terminator, city lights on the night
 * side and an atmosphere rim). Pure JS - no DOM - so it runs in node tests as well as in the browser.
 */

/** A small seeded random generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const pal = (list) => list.map(hexRgb);

/** Palettes: few colours each, as pixel art wants. */
export const PALETTES = {
  sky: pal(["#04030a", "#07061a", "#0c0a26", "#120f34"]),
  violet: pal(["#120f34", "#1f1650", "#33206a", "#4f2a84", "#77359a", "#a8459f", "#d8679f", "#f59fb0"]),
  teal: pal(["#0c1530", "#0f2a44", "#14485a", "#1d6a6e", "#2f9184", "#5fbfa0", "#a8e6c4"]),
  ember: pal(["#1a0f2a", "#3a1530", "#5e1f36", "#8c2f34", "#c04a35", "#e8803f", "#ffc070"]),
  star: pal(["#3b3d5e", "#6d7299", "#a9aed6", "#dfe2ff", "#ffffff"]),
  starWarm: pal(["#5e4a3b", "#a07a52", "#e8c08a", "#fff1d0"]),
  starCool: pal(["#3b4a6e", "#6f8fd0", "#a9c8ff", "#e6f0ff"]),
  ocean: pal(["#06122e", "#0a1f4a", "#10336e", "#1a4f96", "#2a6fbf", "#4f96dd"]),
  land: pal(["#0d1a10", "#1b3318", "#2f5224", "#4f7330", "#7a8f3f", "#a89a5a", "#cbb682"]),
  cloud: pal(["#1c2440", "#4a5878", "#8ea0c0", "#d4e0f0", "#ffffff"]),
  city: pal(["#ffcf6a", "#ffe9a8"]),
  rim: pal(["#2a5fb8", "#5fa8ff", "#a8dcff"]),
  moon: pal(["#14131c", "#2a2836", "#4a4658", "#706a80", "#9c96a8", "#c8c2d0"])
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

/** Seeded 2D value noise with smooth interpolation, and fractal sums of it (the noise of a picture: `makeNoise(rng(seed))`). */
export function makeNoise(rand) {
  const N = 256, perm = new Uint8Array(N * 2), val = new Float32Array(N);
  for ( let i = 0; i < N; i++ ) { perm[i] = i; val[i] = rand(); }
  for ( let i = N - 1; i > 0; i-- ) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for ( let i = 0; i < N; i++ ) perm[N + i] = perm[i];
  const at = (x, y) => val[perm[(perm[x & 255] + y) & 511]];
  const s = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = s(xf), v = s(yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, oct = 4) => { let sum = 0, amp = 0.5, f = 1, norm = 0; for ( let i = 0; i < oct; i++ ) { sum += amp * noise(x * f, y * f); norm += amp; amp *= 0.5; f *= 2.03; } return sum / norm; };
  return { noise, fbm };
}

/**
 * Paint the space picture at art resolution.
 * @param {number} seed
 * @param {number} w  art pixels across
 * @param {number} h  art pixels down
 * @returns {Uint8ClampedArray} RGBA, w*h*4
 */
export const lastLayout = { planet: null, moon: null };
export function paintSpace(seed, w, h, { layoutOnly = false } = {}) {
  const rand = rng(seed), { fbm, noise } = makeNoise(rand), out = layoutOnly ? null : new Uint8ClampedArray(w * h * 4);
  const put = (x, y, c, a = 1) => {
    if ( layoutOnly || x < 0 || y < 0 || x >= w || y >= h ) return;
    const i = (y * w + x) * 4;
    if ( a >= 1 ) { out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; }
    else { out[i] += (c[0] - out[i]) * a; out[i + 1] += (c[1] - out[i + 1]) * a; out[i + 2] += (c[2] - out[i + 2]) * a; }
    out[i + 3] = 255;
  };
  const pick = (P, t, x, y) => P[Math.max(0, Math.min(P.length - 1, Math.floor(t * P.length + bayer(x, y) - 0.5)))];

  // 1. the deep background: a slow vertical gradient, dithered
  if ( !layoutOnly ) for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) put(x, y, pick(PALETTES.sky, 0.15 + 0.6 * (y / h) * (0.6 + 0.4 * noise(x / 90, y / 90)), x, y));

  // 2. two nebula clouds, each warped noise in its own palette, mixed by a mask so they sit in different parts of the sky
  const families = ["violet", "teal", "ember"];
  const f1 = families[Math.floor(rand() * 3)], f2 = families.filter((f) => f !== f1)[Math.floor(rand() * 2)];
  const sc = 1 / (Math.max(w, h) * 0.32), ox = rand() * 100, oy = rand() * 100;
  const nebulaAt = (x, y) => {
    const qx = fbm(x * sc + ox, y * sc + oy, 3), qy = fbm(x * sc + ox + 5.2, y * sc + oy + 1.3, 3);
    let d = fbm(x * sc * 1.6 + 3 * qx + ox, y * sc * 1.6 + 3 * qy + oy, 5);
    // a band across the sky, so the cloud has a shape instead of covering everything
    const band = Math.exp(-(((y / h) - (0.25 + 0.35 * qx)) ** 2) / 0.06);
    d = Math.max(0, (d - 0.42) * 2.4) * (0.35 + 0.9 * band);
    return Math.min(1, d);
  };
  // (layoutOnly: only the random draws are replayed - the few nebula values they depend on are computed where they are read)
  const nebula = layoutOnly ? null : new Float32Array(w * h), which = layoutOnly ? null : new Uint8Array(w * h);
  if ( !layoutOnly ) for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
    const m = fbm(x * sc * 0.6 + 40, y * sc * 0.6 + 17, 2);
    nebula[y * w + x] = nebulaAt(x, y);
    // which cloud: a wide dithered hand-over between the two palettes, never a hard seam
    which[y * w + x] = m + (bayer(x, y) - 0.5) * 0.22 > 0.5 ? 1 : 0;
  }
  if ( !layoutOnly ) for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
    const d = nebula[y * w + x]; if ( d < 0.04 ) continue;
    const P = PALETTES[which[y * w + x] ? f2 : f1];
    // dither into the palette, but let the thin edges fall away in a checker so the cloud fades instead of ending in a line
    if ( d < 0.18 && bayer(x, y) > d / 0.18 ) continue;
    // dark dust lanes: thin ridged filaments of noise that eat into the glow
    const ridge = 1 - Math.abs(fbm(x * sc * 3.1 + 71, y * sc * 3.1 + 13, 4) * 2 - 1);
    const lane = Math.max(0, (ridge - 0.88) * 8.3);
    put(x, y, pick(P, Math.max(0, d * 0.95 - lane * 0.3), x, y));
  }
  // young stars inside the bright cores of the clouds
  for ( let i = 0, n = Math.round((w * h) / 700); i < n; i++ ) {
    const x = Math.floor(rand() * w), y = Math.floor(rand() * h), d = layoutOnly ? nebulaAt(x, y) : nebula[y * w + x];
    if ( d < 0.55 ) continue;
    put(x, y, PALETTES.star[4]);
    if ( rand() < 0.3 ) for ( const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] ) put(x + dx, y + dy, PALETTES.star[3], 0.6);
  }

  // 3. a faint distant spiral galaxy
  {
    const gx = w * (0.15 + 0.7 * rand()), gy = h * (0.1 + 0.3 * rand()), gr = Math.max(6, Math.min(w, h) * 0.05), tilt = 0.45, rot = rand() * Math.PI;
    if ( !layoutOnly ) for ( let y = Math.floor(gy - gr * 2); y < gy + gr * 2; y++ ) for ( let x = Math.floor(gx - gr * 2); x < gx + gr * 2; x++ ) {
      let dx = x - gx, dy = y - gy;
      const cx = dx * Math.cos(rot) + dy * Math.sin(rot), cy = (-dx * Math.sin(rot) + dy * Math.cos(rot)) / tilt;
      const r = Math.hypot(cx, cy) / gr, an = Math.atan2(cy, cx);
      if ( r > 1.6 ) continue;
      const arm = 0.5 + 0.5 * Math.cos(2 * an - 6 * r);
      const v = Math.max(0, (1 - r / 1.6)) * (0.35 + 0.65 * arm) + Math.max(0, 0.6 - r) * 1.2;
      if ( v > bayer(x, y) * 1.1 ) put(x, y, PALETTES.star[Math.min(4, Math.floor(v * 3))], 0.55);
    }
  }

  // 4. stars: many single dots, some crosses, a handful of four-point sparkles
  const area = w * h, starAt = (x, y, P, b) => put(x, y, P[Math.min(P.length - 1, b)]);
  const tint = () => { const r = rand(); return r < 0.15 ? PALETTES.starWarm : r < 0.35 ? PALETTES.starCool : PALETTES.star; };
  for ( let i = 0, n = Math.round(area / 55); i < n; i++ ) {
    const x = Math.floor(rand() * w), y = Math.floor(rand() * h), P = tint();
    starAt(x, y, P, Math.floor(rand() ** 2.2 * P.length));
  }
  for ( let i = 0, n = Math.round(area / 2600); i < n; i++ ) {
    const x = Math.floor(rand() * w), y = Math.floor(rand() * h), P = tint(), top = P.length - 1;
    starAt(x, y, P, top); for ( const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] ) starAt(x + dx, y + dy, P, top - 2);
  }
  for ( let i = 0, n = Math.max(3, Math.round(area / 16000)); i < n; i++ ) {
    const x = Math.floor(rand() * w), y = Math.floor(rand() * h * 0.7), P = tint(), top = P.length - 1, L = 2 + Math.floor(rand() * 3);
    for ( let yy = -3; yy <= 3; yy++ ) for ( let xx = -3; xx <= 3; xx++ ) {
      const r = Math.hypot(xx, yy); if ( r > 3.2 || r < 1 ) continue;
      if ( (1 - r / 3.2) * 0.9 > bayer(x + xx, y + yy) ) put(x + xx, y + yy, P[Math.max(0, top - 3)], 0.45);
    }
    starAt(x, y, P, top);
    for ( let k = 1; k <= L; k++ ) { const b = Math.max(0, top - k); for ( const [dx, dy] of [[k, 0], [-k, 0], [0, k], [0, -k]] ) starAt(x + dx, y + dy, P, b); }
    for ( const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] ) starAt(x + dx, y + dy, P, Math.max(0, top - 3));
  }

  // a lit sphere: normal from the disc position, light from the upper left, dithered bands
  const L = (() => { const v = [-0.62, -0.5, 0.6], n = Math.hypot(...v); return v.map((c) => c / n); })();
  const LP = PLANET_LIGHT;
  const sphere = (cx, cy, R, paint) => {
    for ( let y = Math.max(0, Math.floor(cy - R - 3)); y < Math.min(h, cy + R + 3); y++ ) for ( let x = Math.max(0, Math.floor(cx - R - 3)); x < Math.min(w, cx + R + 3); x++ ) {
      const nx = (x + 0.5 - cx) / R, ny = (y + 0.5 - cy) / R, rr = nx * nx + ny * ny;
      paint(x, y, nx, ny, rr, rr <= 1 ? Math.sqrt(1 - rr) : 0);
    }
  };

  // 5. a cratered moon, high on one side
  {
    const left = rand() < 0.5, R = Math.max(7, Math.min(w, h) * (0.06 + 0.03 * rand()));
    const cx = left ? w * (0.1 + 0.1 * rand()) : w * (0.78 + 0.1 * rand()), cy = h * (0.14 + 0.12 * rand());
    lastLayout.moon = { cx, cy, R };
    const craters = Array.from({ length: 7 + Math.floor(rand() * 5) }, () => [rand() * 1.6 - 0.8, rand() * 1.6 - 0.8, 0.08 + rand() * 0.2]);
    if ( !layoutOnly ) sphere(cx, cy, R, (x, y, nx, ny, rr, nz) => {
      if ( rr > 1 ) return;
      let lit = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      let t = 0.15 + 0.85 * lit + 0.12 * (fbm(nx * 3 + 9, ny * 3 + 4, 3) - 0.5);
      for ( const [kx, ky, kr] of craters ) { const dd = Math.hypot(nx - kx, ny - ky) / kr; if ( dd < 1 ) t += dd < 0.75 ? -0.18 : 0.1; }
      put(x, y, pick(PALETTES.moon, Math.max(0, Math.min(0.999, t)), x, y));
    });
  }

  // 6. the planet: a big disc whose limb arcs across the bottom of the picture
  {
    const R = Math.max(w, h) * (0.62 + 0.12 * rand()), cx = w * (0.35 + 0.3 * rand()), cy = h + R * (0.62 + 0.08 * rand());
    const lo = rand() * 50;
    lastLayout.planet = { cx, cy, R, light: LP, lo };
    if ( layoutOnly ) return null;
    const P = planetSurface({ fbm, noise, cx, cy, R, lo }), px = {}, rgb = new Uint8ClampedArray(3);
    sphere(cx, cy, R, (x, y, nx, ny, rr) => {
      // the atmosphere: a thin glowing rim just outside the disc, brightest on the lit side
      if ( rr > 1 ) {
        const out = (Math.sqrt(rr) - 1) * R, HALO = 7;
        if ( out < HALO ) {
          // the halo is brightest where the sun sits behind the limb, fading out over a few art pixels, dithered
          const side = Math.max(0, Math.min(1, -(nx * LP[0] + ny * LP[1]) * 0.9 + 0.25));
          const v = (1 - out / HALO) ** 1.6 * (0.25 + 0.75 * side);
          if ( v > bayer(x, y) * 0.75 ) put(x, y, PALETTES.rim[Math.min(2, Math.floor(v * 3.2))], 0.35 + 0.5 * v);
        }
        return;
      }
      P.at(x, y, px);
      P.color(px, P.cloudN(px.u, px.v), P.cloudN(px.u + SHADOW_DU, px.v + SHADOW_DV), rgb);
      put(x, y, rgb);
    });
  }
  return out;
}

/** The planet's sun comes from the side, so a terminator crosses the visible cap and the night side shows its cities. */
export const PLANET_LIGHT = (() => { const v = [-0.92, -0.18, 0.34], n = Math.hypot(...v); return v.map((c) => c / n); })();
/** Cloud shadows: the cloud field read a little down-sun of each pixel (in the sphere's u, v). */
export const SHADOW_DU = 0.06, SHADOW_DV = 0.03;
/** Where the cloud field makes a cloud. */
export const CLOUD_T = 0.62;

/**
 * The planet's surface, pixel by pixel - shared by the picture (paintSpace) and the live drifting clouds (orbit-clouds.mjs), so both
 * paint exactly the same colours. Split in three so the live layer can keep what never changes and redo only what the clouds touch:
 * - `at(x, y, px)`: everything fixed at an art pixel (its normal, sphere u/v, land, light, limb, overlays); false outside the disc;
 * - `cloudN(u, v)`: the cloud field (a cloud where > CLOUD_T; its shadow where the field at u + SHADOW_DU, v + SHADOW_DV is);
 * - `color(px, cloudN, shadowN, rgb)`: the pixel's final colour, all overlays applied as the picture's `put` blends them.
 * The live layer also uses the pieces: `cloudIndex` (which cloud colour), `finish` (the overlays), `cloudPalette`.
 */
export function planetSurface({ fbm, noise, cx, cy, R, lo }) {
  const LP = PLANET_LIGHT, clamp = (t) => Math.max(0, Math.min(0.999, t));
  const pick = (P, t, bay) => P[Math.max(0, Math.min(P.length - 1, Math.floor(t * P.length + bay - 0.5)))];
  const hx = LP[0], hy = LP[1], hz = LP[2] + 1, hn = Math.hypot(hx, hy, hz);
  const at = (x, y, px) => {
    const nx = (x + 0.5 - cx) / R, ny = (y + 0.5 - cy) / R, rr = nx * nx + ny * ny;
    if ( rr > 1 ) return false;
    const nz = Math.sqrt(1 - rr), bay = bayer(x, y);
    // the surface pattern: sample noise on the sphere (u,v from the normal) so continents bend with the curvature
    const u = Math.atan2(nx, nz) * 1.6 + lo, v = Math.asin(Math.max(-1, Math.min(1, ny))) * 1.6;
    const landN = fbm(u * 1.7 + 3, v * 1.7 + 7, 5);
    const lit = nx * LP[0] + ny * LP[1] + nz * LP[2];
    // day 0..1 with a soft, dithered terminator; the limb darkens a little
    const day = Math.max(0, Math.min(1, lit * 1.8 + 0.3)), limb = 0.7 + 0.3 * Math.sqrt(nz);
    // polar ice near the top of the disc
    const ice = v < -2.38 - 0.25 * (landN - 0.5) * 4, isLand = landN > 0.5;
    // the sun's glint on the sea
    const spec = Math.max(0, (nx * hx + ny * hy + nz * hz) / hn) ** 40;
    // a blue haze over the limb on the day side
    const haze = nz < 0.35 && day > 0.15 && (1 - nz / 0.35) * day > bay;
    // night side: scattered city lights on the land (hidden under clouds)
    const city = isLand && day < 0.1 && noise(u * 30, v * 30) > 0.8 && bay > 0.55 ? PALETTES.city[noise(u * 60, v * 60) > 0.5 ? 1 : 0] : null;
    // the limb: a bright line of atmosphere just inside the edge on the day side
    const edge = (1 - Math.sqrt(rr)) * R, rim = edge < 1.6 && day > 0.2 ? (edge < 0.8 ? 2 : 1) : 0;
    Object.assign(px, { x, y, nx, ny, nz, u, v, bay, landN, day, limb, ice, isLand, spec, haze, city, rim, cloudK: (0.15 + 0.85 * day) * limb });
    return true;
  };
  const cloudN = (u, v) => fbm(u * 3.2 + 11, v * 7 + 2, 4);
  /** Which cloud colour (an index into PALETTES.cloud) for a cloud pixel with light factor k. */
  const cloudIndex = (k, cN, bay) => Math.max(0, Math.min(4, Math.floor(clamp((0.45 + (cN - CLOUD_T) * 2.5) * k + 0.05) * 5 + bay - 0.5)));
  /** The overlays (haze, city lights where no cloud, the limb line) over a base colour, blended as the picture's `put` does. */
  const finish = (c, haze, city, rim, rgb) => {
    rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
    if ( haze ) { const r = PALETTES.rim[0]; for ( let i = 0; i < 3; i++ ) rgb[i] += (r[i] - rgb[i]) * 0.35; }
    if ( city ) { rgb[0] = city[0]; rgb[1] = city[1]; rgb[2] = city[2]; }
    if ( rim ) { const r = PALETTES.rim[rim]; for ( let i = 0; i < 3; i++ ) rgb[i] += (r[i] - rgb[i]) * 0.7; }
    return rgb;
  };
  const color = (px, cN, sN, rgb) => {
    const isCloud = cN > CLOUD_T, shade = sN > CLOUD_T && !isCloud ? 0.72 : 1, { landN, day, limb, bay } = px;
    let c;
    if ( isCloud ) c = PALETTES.cloud[cloudIndex(px.cloudK, cN, bay)];
    else if ( px.ice ) c = pick(PALETTES.cloud, clamp((0.55 + (landN - 0.5)) * (0.12 + 0.88 * day) * limb), bay);
    else if ( px.isLand ) c = pick(PALETTES.land, clamp((0.35 + (landN - 0.5) * 3.2) * (0.12 + 0.88 * day) * limb * shade), bay);
    else {
      c = pick(PALETTES.ocean, clamp((0.55 + 0.6 * (landN - 0.42)) * (0.1 + 0.9 * day) * limb * shade), bay);
      if ( px.spec > bay * 0.8 ) c = PALETTES.rim[px.spec > 0.6 ? 2 : 1];
    }
    return finish(c, px.haze, isCloud ? null : px.city, px.rim, rgb);
  };
  return { at, cloudN, color, cloudIndex, finish };
}

/** Enlarge an RGBA art buffer by an integer factor with hard (nearest) edges. */
export function enlarge(src, w, h, k) {
  const W = w * k, H = h * k, out = new Uint8ClampedArray(W * H * 4), row = new Uint32Array(W);
  const s32 = new Uint32Array(src.buffer, src.byteOffset, w * h), o32 = new Uint32Array(out.buffer);
  for ( let y = 0; y < h; y++ ) {
    for ( let x = 0; x < w; x++ ) row.fill(s32[y * w + x], x * k, x * k + k);
    for ( let r = 0; r < k; r++ ) o32.set(row, (y * k + r) * W);
  }
  return { data: out, width: W, height: H };
}
