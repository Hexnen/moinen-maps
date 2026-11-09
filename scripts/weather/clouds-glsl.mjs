/**
 * CLOUDS, the GLSL (ES 3.00) of clouds.mjs. Everything is in SQUARES (scene px / grid) and a pure function of (place, shared clock):
 *
 *   FIELD   the cloud density at the cloud layer, one value per field texel (a world-aligned grid over the view): a domain-warped fbm
 *           of value noise on a 256-periodic lattice. Each octave moves by its own offset (OCT below: the drift the CPU integrated
 *           from the wind along the timeline, x the octave's motion share, + a slow evolution of its own), reduced mod the lattice
 *           period on the CPU in doubles: exact for any clock, never loops, never jumps; octaves sliding against each other make the
 *           clouds boil and change shape as they travel.
 *   LIGHT   per texel of the same grid, from the field (bilinear): the body seen at this ground point (the cloud H squares up, drawn
 *           lift x H higher up the screen), its sunlight (the cloud's own density marched toward the sun), its shadow on the ground
 *           (the cloud S x H toward the sun) and the GODRAYS (the eye ray from the ground up to the cloud layer, at each height the
 *           sunlight that comes through the clouds above: light shafts slanting from the gaps to their sunny spots).
 *   SHADOW / RAYS / BODY   the stage passes: a fetch of the light texture each (+ two octaves of fine detail on the body's rim).
 */

// the octaves: frequency (per square), rotation (rad), motion share, evolution (lattice units / s)
export const OCT = [
  /* W0 */ [1 / 11, 0.30, 0.90, [0.004, -0.003]],
  /* W1 */ [1 / 11, 1.90, 0.90, [-0.003, 0.004]],
  /* M0 */ [1 / 7.5, 0.00, 1, [0.002, 0.0012]],
  /* M1 */ [2.03 / 7.5, 0.61, 1, [0.005, -0.004]],
  /* M2 */ [4.11 / 7.5, 1.37, 1, [-0.009, 0.007]],
  /* B0 */ [1.13, 2.21, 1, [0.03, 0.022]],              // billows (cellular: round puffs), sliding a little: the clouds boil
  /* B1 */ [2.41, 2.90, 1, [-0.05, 0.045]],
  /* D0 */ [3.3, 0.90, 1, [0.03, -0.02]],
  /* D1 */ [7.1, 2.50, 1, [-0.04, 0.05]],
  /* D2 */ [15.3, 1.70, 1, [0.06, -0.05]]
];
export const NOCT = OCT.length;
const f = (x) => x.toFixed(7);
const mats = OCT.map(([fr, a]) => `mat2(${f(Math.cos(a) * fr)}, ${f(Math.sin(a) * fr)}, ${f(-Math.sin(a) * fr)}, ${f(Math.cos(a) * fr)})`);

const NOISE = `
uniform vec2 uOff[${NOCT}];   // per octave: its offset in lattice units (mod 256)
uniform int uSeed;
float hu(int x, int y, int s) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(s) * 1274126177u;
  h = (h ^ (h >> 13u)) * 1103515245u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967296.0;
}
// value noise on a 256-periodic lattice, quintic fade
float vn(vec2 q, int s) {
  vec2 i = floor(q), u = q - i;
  u = u * u * u * (u * (u * 6.0 - 15.0) + 10.0);
  int x = int(i.x) & 255, y = int(i.y) & 255, x1 = (x + 1) & 255, y1 = (y + 1) & 255;
  return mix(mix(hu(x, y, s), hu(x1, y, s), u.x), mix(hu(x, y1, s), hu(x1, y1, s), u.x), u.y);
}
// cellular noise: the distance to the nearest of one jittered point per lattice cell (0 at a point .. ~1)
float wor(vec2 q, int s) {
  vec2 i = floor(q), f = q - i;
  float m = 9.0;
  for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    int cx = (int(i.x) + x) & 255, cy = (int(i.y) + y) & 255;
    vec2 d = vec2(float(x) + hu(cx, cy, s), float(y) + hu(cx, cy, s + 1)) - f;
    m = min(m, dot(d, d));
  }
  return sqrt(m);
}
// octave k at a place p (squares)
${mats.map((m, k) => `float oc${k}(vec2 p) { return vn(${m} * p - uOff[${k}], uSeed + ${301 + k * 7}); }
float wc${k}(vec2 p) { return wor(${m} * p - uOff[${k}], uSeed + ${301 + k * 7}); }`).join("\n")}
`;

export const CLOUD_VERT = `#version 300 es
precision highp float;
in vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
out vec2 vW;
void main() {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vW = aVertexPosition;
}`;

/* ------------------------------------------------------------------ FIELD (into the field texture) */

export const FIELD_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform vec4 uGrid;          // the grid: origin x, y (squares), texels per square, -
out vec4 fragColor;
${NOISE}
void main() {
  vec2 p = uGrid.xy + gl_FragCoord.xy / uGrid.z;
  // the warp: the shapes roll and stretch as the field travels (its offsets move a little slower than the clouds)
  vec2 w = vec2(oc0(p), oc1(p)) - 0.5;
  vec2 q = p + w * 2.4;
  // the masses (smooth fbm) eroded into round billows (cellular): cumulus seen from above
  float base = (oc2(q) + 0.5 * oc3(q) + 0.25 * oc4(q)) / 1.75;
  float w5 = wc5(q), w6 = wc6(q);
  float puff = 0.65 * (1.0 - w5 * w5) + 0.35 * (1.0 - w6 * w6);
  fragColor = vec4(base + 0.22 * (puff - 0.6), 0.0, 0.0, 1.0);
}`;

/* ------------------------------------------------------------------ LIGHT (into the light texture) */

export const LIGHT_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uField;
uniform vec4 uGrid;          // origin x, y (squares), texels per square, -
uniform vec2 uSize;          // the field texture in texels
uniform vec4 uCl;            // threshold (the cover's quantile), its soft width, cloud height H (squares), lift
uniform vec2 uSun;           // the shadow's offset per square of height (on the ground, away from the sun)
uniform float uRays;         // godrays on (> 0) or off (0: not computed)
uniform int uRaysN;          // ray samples
out vec4 fragColor;
float D(vec2 x) { return texture(uField, (x - uGrid.xy) * uGrid.z / uSize).r; }
float cov(vec2 x, float w) { return smoothstep(uCl.x - w, uCl.x + w, D(x)); }
float hgt(vec2 x) { return 1.8 * sqrt(max(D(x) - uCl.x, 0.0) + 0.0004); }
void main() {
  vec2 p = uGrid.xy + gl_FragCoord.xy / uGrid.z;
  float H = uCl.z, L = uCl.w, t = uCl.x;
  // the body seen here: the cloud H up, drawn L x H higher up the screen
  vec2 xy = p + vec2(0.0, L * H);
  float db = D(xy);
  // its sunlight: the cloud as a height field (thickness over the threshold -> squares of height: billowed domes), lit by the sun
  // from the upper left at 58 deg: the face's turn to the sun (its normal from the slopes) and the shadow the billows toward the sun
  // cast on it (a march along the sun ray over the field)
  vec2 sn = -normalize(uSun);
  const float E = 0.24;
  float h0 = hgt(xy), gx = (hgt(xy + vec2(E, 0.0)) - hgt(xy - vec2(E, 0.0))) / (2.0 * E), gy = (hgt(xy + vec2(0.0, E)) - hgt(xy - vec2(0.0, E))) / (2.0 * E);
  vec3 nrm = normalize(vec3(-gx, -gy, 1.0)), Ls = normalize(vec3(sn * 0.53, 0.85));
  float lam = max(0.0, dot(nrm, Ls)) / 0.85;
  float occ = 0.0;
  for ( int k = 1; k <= 4; k++ ) { float s = 0.35 * float(k); occ = max(occ, hgt(xy + sn * s) - h0 - s * 1.6); }
  float lit = clamp(lam, 0.0, 1.0) * (1.0 - 0.22 * smoothstep(0.05, 0.6, occ));
  // its shadow on the ground (a wide soft penumbra: the sun's disc seen past a rim H squares up)
  float sh = cov(p - uSun * H, uCl.y * 1.3);
  // GODRAYS: up the eye ray (the air over this ground point at height h is drawn here), the sunlight through the clouds above it
  float g = 0.0;
  if ( uRays > 0.0 ) {
    float n = float(uRaysN);
    for ( int j = 0; j < 32; j++ ) {
      if ( j >= uRaysN ) break;
      float h = H * (float(j) + 0.5) / n;
      vec2 a = p + vec2(0.0, L * h) - uSun * (H - h);
      g += 1.0 - cov(a, uCl.y * 0.7);
    }
    g /= n;
  }
  fragColor = vec4(db, lit, sh, g);
}`;

/* ------------------------------------------------------------------ the stage passes */

const STAGE = `
uniform sampler2D uLight;
uniform vec4 uGrid;          // origin x, y (squares), texels per square, grid size (scene px)
uniform vec2 uSize;          // the light texture in texels
uniform vec4 uEdge;          // the rect the pass fades out at: x0, y0, x1, y1 (squares)
uniform float uEdgeW;        // the fade's width (squares)
uniform float uNight;        // the scene's darkness 0..1
uniform float uQ;            // the frame guard's detail 0.35..1 (weatherQ)
vec4 L4(vec2 p) { return texture(uLight, (p - uGrid.xy) * uGrid.z / uSize); }
float edgeFade(vec2 p) {
  vec2 e = min(p - uEdge.xy, uEdge.zw - p);
  return smoothstep(0.0, 1.0, clamp(min(e.x, e.y) / uEdgeW, 0.0, 1.0));
}
`;

// the shadow on the ground: dst x k (custom blend ONE, SRC_ALPHA: add 0); cooler in the shade (the blue sky's light)
export const SHADOW_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vW;
uniform vec4 uShade;         // darkening, its cool tint, -, -
out vec4 fragColor;
${STAGE}
void main() {
  vec2 p = vW / uGrid.w;
  float s = L4(p).b * uShade.x * edgeFade(p);
  vec3 k = 1.0 - s * vec3(1.0, 1.0 - 0.12 * uShade.y, 1.0 - 0.32 * uShade.y);
  float kk = min(k.r, min(k.g, k.b));
  // (a colour multiply with one scalar k: the hue goes into add as the map would carry it, approximated by a neutral grey)
  fragColor = vec4((k - kk) * 0.45, kk);
}`;

// GODRAYS: light added along the shafts (sun gold by day, a cold silver under the moon at night)
export const RAYS_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vW;
uniform vec4 uRay;           // strength, the share of the sky covered (contrast), the bodies' threshold, their opacity
out vec4 fragColor;
${STAGE}
void main() {
  vec2 p = vW / uGrid.w;
  vec4 b = L4(p);
  // the shafts: the light that came through, its floor (the open-sky glow) pushed down as the sky closes
  float x = max(0.0, b.a - 0.18 * (1.0 - uRay.y)) / (1.0 - 0.18 * (1.0 - uRay.y));
  // what makes a shaft visible is lit air beside shadowed air: the light above its surroundings (a ring of six taps 2.5 squares
  // out) carries most of it; the even glow of a wide open gap only a little (so a gap filling the view is no milky veil)
  // (the frame guard blends the ring to its three even taps between q 0.85 and 0.55; under that only they are fetched)
  float m = 0.0, wq = uQ >= 1.0 ? 1.0 : smoothstep(0.55, 0.85, uQ);
  if ( wq >= 1.0 ) { for ( int i = 0; i < 6; i++ ) { float t = float(i) * 1.0472; m += L4(p + 2.5 * vec2(cos(t), sin(t))).a; } m /= 6.0; }
  else {
    float m3 = 0.0, mo = 0.0;
    for ( int i = 0; i < 6; i += 2 ) { float t = float(i) * 1.0472; m3 += L4(p + 2.5 * vec2(cos(t), sin(t))).a; }
    if ( wq > 0.0 ) for ( int i = 1; i < 6; i += 2 ) { float t = float(i) * 1.0472; mo += L4(p + 2.5 * vec2(cos(t), sin(t))).a; }
    m = mix(m3 / 3.0, (m3 + mo) / 6.0, wq);
  }
  float hp = max(0.0, b.a - m);
  float a = uRay.x * edgeFade(p) * min(1.0, 0.45 * pow(x, 1.6) + 2.4 * hp);
  // drawn over the cloud bodies (the shafts glow up through the gaps and show through the thinner deck), dimmed where a body is
  a *= 1.0 - 0.6 * uRay.w * smoothstep(uRay.z - 0.01, uRay.z + 0.08, b.r);
  vec3 col = mix(vec3(1.0, 0.89, 0.66), vec3(0.62, 0.72, 0.95), uNight) * mix(0.40, 0.16, uNight);
  fragColor = vec4(col * a, 1.0);
}`;

// the BODIES, seen from above: billowed domes of cloud lit by the sun from the upper left (the light texture: each face's slope toward
// the sun, the cloud's own shade on its far side), white tops, blue-grey lee sides, translucent wispy rims (two fine octaves riding
// with the cloud at full resolution); thinned around tornadoes (their own wall cloud and deck are there) and open over burning fire
// (its heat breaks the cloud above it, and the flames stay in view)
export const BODY_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vW;
uniform vec4 uCl;            // threshold, its soft width, opacity (x presence x mode), detail
uniform vec4 uTor[3];        // tornadoes: x, y, reach (squares), presence
uniform int uTorN;
uniform vec4 uFire[12];      // burning fire: x, y, reach (squares), presence
uniform int uFireN;
uniform vec4 uBolt;          // the rain's lightning (storm.mjs): x, y, reach (squares), light (0: exactly the plain clouds)
out vec4 fragColor;
${STAGE}
${NOISE}
void main() {
  vec2 p = vW / uGrid.w;
  vec4 b = L4(p);
  float t = uCl.x;
  if ( b.r < t - 0.08 ) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // (the finest octave fades out under the frame guard between q 0.85 and 0.55, and is skipped below)
  float w9 = uQ >= 1.0 ? 1.0 : smoothstep(0.55, 0.85, uQ);
  float n = (oc7(p) - 0.5) + 0.5 * (oc8(p) - 0.5);
  if ( w9 > 0.0 ) n += 0.25 * w9 * (oc9(p) - 0.5);
  float th = clamp((b.r - t) / 0.16, 0.0, 1.0);
  float d = b.r + n * uCl.w * (1.0 - 0.7 * th);       // the rim frays into wisps; the core keeps its shape
  float a = smoothstep(t - 0.012, t + 0.045, d);
  a *= mix(0.6, 1.0, smoothstep(0.0, 0.5, th));      // thin rims let the ground through
  for ( int k = 0; k < 3; k++ ) {
    if ( k >= uTorN ) break;
    float r = length(p - uTor[k].xy) / uTor[k].z;
    a *= 1.0 - 0.85 * uTor[k].w * (1.0 - smoothstep(0.35, 1.0, r));
  }
  for ( int k = 0; k < 12; k++ ) {
    if ( k >= uFireN ) break;
    float r = length(p - uFire[k].xy) / uFire[k].z;
    a *= 1.0 - 0.95 * uFire[k].w * (1.0 - smoothstep(0.45, 1.0, r + 0.25 * (n + 0.5) * r));
  }
  a *= uCl.z * edgeFade(p);
  if ( a <= 0.001 ) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float l = clamp(b.g + (1.0 - th) * 0.22 + n * 0.10, 0.0, 1.0);
  vec3 sun = vec3(1.0, 0.995, 0.98), shade = vec3(0.68, 0.72, 0.81), deep = vec3(0.50, 0.55, 0.66);
  vec3 c = mix(mix(deep, shade, smoothstep(0.0, 0.42, l)), sun, smoothstep(0.42, 0.9, l));
  // under the moon: silvered and cool, not darkened here (the scene's darkness dims them like the map, so they keep reading lighter)
  c = mix(c, vec3(dot(c, vec3(0.333))) * vec3(0.84, 0.90, 1.06), uNight * 0.7);
  // lightning lights the cloud from inside: brightest in the thick core near the flash, the thin rims only a little
  if ( uBolt.w > 0.0 ) {
    vec2 q = (p - uBolt.xy) / uBolt.z;
    float lit = uBolt.w * (0.35 + 0.65 * exp(-dot(q, q))) * (0.45 + 0.55 * th) * (0.85 + 0.3 * (n + 0.5));
    c += vec3(0.80, 0.86, 1.0) * lit;
  }
  fragColor = vec4(c * a, 1.0 - a);
}`;
