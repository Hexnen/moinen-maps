/**
 * GLSL of the TORNADO (research 3.2, revision 5: built in the module). Everything is drawn into a render texture at about the SCREEN's
 * resolution (k texels per art px, about the device px per art px; only the window of it on screen, its origin snapped to 1 / k art
 * px so the texels never crawl), then shown with one quad above the tokens at about one texel per device px; the ground terms are a
 * separate quad and instanced marks on the ground under the tokens. Every pass is a pure function of (the continuous art point,
 * shared clock, the per-frame tables the CPU fills from the stored path): every client draws the same frame. The volumes are
 * ray-marched into a half-float texture at a third of k when magnified (k > 1.25) and shaded at full resolution from it.
 *
 * Coordinates: absolute ART px on SCREEN, i.e. the ground point (x, y) at height z shows at (x, y - LIFT z). Rotation is counter-
 * clockwise on the map (tornado-model SPIN = -1: the screen angle decreases).
 *
 *   ART (RGBA8, premultiplied), back to front:
 *     CURTAIN the far half of the rain curtain wrapping the rear and the right flank (DECK_FRAG mode 0)
 *     SKIRT   the dust ring on the ground: jets thrown outward, lopsided to the side the spin throws to, rolling rings at touchdowns
 *     PARTS   (back) debris behind the funnel (under the dust)
 *     VOLUME  (behind) the debris cloud round the foot and the wall cloud round the top, ray-marched (VOL_FRAG pass 0)
 *     COLUMN  the funnel: a fluid rope solved per row from the CPU's axis table, flow-warped bands, cylinder light, sheath, a frayed top
 *     VOLUME  (in front) only what lies between the eye and the funnel (VOL_FRAG pass 1): the material orbits round it in depth
 *     PARTS   (front) debris in front: tumbling map fragments, planks, specks, clumps, wisps
 *     CURTAIN the near half of the rain curtain, thin, on the flanks only (DECK_FRAG mode 2)
 *     DECK    the STORM DECK seen from above, drawn over the funnel's top (a wide rotating mass with spiral bands sheared by a faster
 *             core, thickest over the funnel top - the wall cloud the funnel flares into - flat see-through levels, lit edges toward
 *             the up-left light), feeder bands streaming in, lightning
 *   GROUND   storm light, the deck's shadow, the funnel's shadow, the scoured track (stage, under tokens, weather blend)
 *   GPARTS   inflow streaks, chunk shadows, scars where chunks were torn out (stage, under tokens)
 */
import { GLSL_COMMON, GLSL_SHAPES } from "./glsl.mjs";

const HEAD = `#version 300 es
precision highp float;
precision highp int;`;

const TCOMMON = `
${GLSL_COMMON}
uniform float uT;           // shared clock, s mod 3600
uniform float uU;           // art px per mock-up px (cells per square / 32 x size)
uniform vec2 uView;         // lift, squash
uniform vec4 uRect;         // the art texture: origin x, y (absolute art px), width, height
float bil(float n) { return 1.0 - abs(2.0 * n - 1.0); }
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
// noise in a frame TURNING about c (y squashed by sq) at w0 / (1 + r / rw) rad / s (inner faster: the flow shears), restarted every P s
// and cross-faded, so it never winds up; sc art px per noise unit
float swirl3(vec2 p, vec2 c, float sq, float w0, float rw, float P, float sc, int s) {
  vec2 d = p - c; d.y /= sq;
  float r = length(d), w = w0 / (1.0 + r / rw);
  float a = uT / P, b = a + 0.5, ka = floor(a), kb = floor(b), fa = a - ka, fb = b - kb;
  vec2 oa = vec2(hu(int(ka), 3, s), hu(int(ka), 4, s)) * 97.0, ob = vec2(hu(int(kb), 5, s), hu(int(kb), 6, s)) * 97.0;
  float na = fbm3(rot(d, -w * fa * P) / sc + oa, s), nb = fbm3(rot(d, -w * fb * P) / sc + ob, s + 7);
  return mix(nb, na, 1.0 - abs(2.0 * fa - 1.0));
}
float swirl2(vec2 p, vec2 c, float sq, float w0, float rw, float P, float sc, int s) {
  vec2 d = p - c; d.y /= sq;
  float r = length(d), w = w0 / (1.0 + r / rw);
  float a = uT / P, b = a + 0.5, ka = floor(a), kb = floor(b), fa = a - ka, fb = b - kb;
  vec2 oa = vec2(hu(int(ka), 3, s), hu(int(ka), 4, s)) * 97.0, ob = vec2(hu(int(kb), 5, s), hu(int(kb), 6, s)) * 97.0;
  float na = fbm2(rot(d, -w * fa * P) / sc + oa, s), nb = fbm2(rot(d, -w * fb * P) / sc + ob, s + 7);
  return mix(nb, na, 1.0 - abs(2.0 * fa - 1.0));
}
// noise that drifts on a circle in time (period P s, whole cycles per hour): a looped wobble
float loopN(vec2 q, float P, float R, int s) { float a = 6.2831853 * fract(uT / P); return fbm2(q + R * vec2(cos(a), sin(a)), s); }
float loopN1(vec2 q, float P, float R, int s) { float a = 6.2831853 * fract(uT / P); return vnoise(q + R * vec2(cos(a), sin(a)), s); }   // (one octave)
const vec3 G0 = vec3(0.11, 0.12, 0.15), G1 = vec3(0.18, 0.19, 0.23), G2 = vec3(0.26, 0.27, 0.31), G3 = vec3(0.35, 0.36, 0.40),
           G4 = vec3(0.45, 0.46, 0.50), G5 = vec3(0.56, 0.57, 0.60), G6 = vec3(0.69, 0.70, 0.72);
vec3 grey(int i) { return i <= 0 ? G0 : i == 1 ? G1 : i == 2 ? G2 : i == 3 ? G3 : i == 4 ? G4 : i == 5 ? G5 : G6; }
// the dust ramp from the tornado's dirt colour d (7 steps, dark .. light)
vec3 dustR(vec3 d, int i) { return clamp(d * (0.28 + 0.157 * float(clamp(i, 0, 6))), 0.0, 1.0); }
// a ramp between storm grey (q 0) and dust (q 2)
vec3 ramp(vec3 d, float q, int i) {
  vec3 g = grey(i), u = dustR(d, i);
  return q <= 1.0 ? mix(g, (g + u) * 0.5, q) : mix((g + u) * 0.5, u, q - 1.0);
}
// CRISP AND SMOOTH (2026-11-09): the art texture is drawn at about the SCREEN's resolution (uPx art px per texel, 1 / k), so every
// pass is a function of the continuous point: edges are antialiased over a texel, the palettes are interpolated (soft steps between
// the painted tones), see-through levels are smooth amounts, and the fine structure (fibres, curls, wisps, rain strands) is real
// noise at a few art px that shows when magnified
uniform float uPx;
// (tones: soft steps centred where the painted palette stepped, at whole t: the same tones on average, never a staircase)
float tstep(float t) { t -= 0.5; float i = floor(t); return i + smoothstep(0.2, 0.8, t - i); }
vec3 greyF(float t) { t = clamp(tstep(t), 0.0, 6.0); int i = int(min(floor(t), 5.0)); return mix(grey(i), grey(i + 1), t - float(i)); }
vec3 dustF(vec3 d, float t) { return clamp(d * (0.28 + 0.157 * clamp(tstep(t), 0.0, 6.0)), 0.0, 1.0); }
vec3 rampF(vec3 d, float q, float t) {
  vec3 g = greyF(t), u = dustF(d, t);
  return q <= 1.0 ? mix(g, (g + u) * 0.5, q) : mix((g + u) * 0.5, u, q - 1.0);
}
// coverage of a signed distance x (art px, > 0 inside) over one texel
float aaK(float x) { return clamp(x / max(uPx, 1e-3) + 0.5, 0.0, 1.0); }
// ... of an edge given by any field e (> 0 inside): over its own screen gradient, so an edge that runs nearly along the rows (a bulge
// of the funnel, a shelf of the skirt) is as smooth as one across them (no comb of row steps)
float aaW(float e) { return clamp(e / max(fwidth(e), 1e-4) + 0.5, 0.0, 1.0); }
// how much of the finest octave to show: all of it magnified, less where a texel is about an art px (it would only add grain)
float fineK() { return 1.0 - 0.55 * smoothstep(0.45, 1.0, uPx); }
`;

/* ================================================================== quads into the art texture */

export const QUAD_VERT = `${HEAD}
in vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform vec4 uRect;
out vec2 vP;
void main() {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vP = aVertexPosition + uRect.xy;    // absolute art px
}`;

/* ---------------------------------------------------------------- DECK (mode 0: the rain curtain; 1: the storm deck) */

export const DECK_FRAG = `${HEAD}
in vec2 vP;
uniform int uMode;          // 0 the rain curtain (behind everything), 1 the storm deck (over everything)
uniform vec4 uTop;          // deck centre x, y (screen art px), radius, density
uniform vec4 uDeck;         // darkness 0..1, feeder bands, lightning (now), presence
uniform vec4 uBase;         // the base on the ground (screen art px x, y), the funnel's screen height (LIFT x Z), touch
uniform vec4 uCurt;         // curtain amount, ground radius, screen height, the heading (rad: the curtain wraps the rear)
uniform vec4 uPh;           // CPU phases (rad): arms, feeders, lightning zone, -
uniform vec4 uHole;         // the funnel top on screen x, y, the wall cloud's radius, its presence
uniform int uSd;
out vec4 fragColor;
${TCOMMON}
const float SQ = 0.58;      // the deck plane seen obliquely
// the cloud-top ramp: blue-grey shadow .. sunlit white
const vec3 C0 = vec3(0.22, 0.25, 0.31), C1 = vec3(0.31, 0.34, 0.41), C2 = vec3(0.42, 0.45, 0.52), C3 = vec3(0.54, 0.57, 0.63),
           C4 = vec3(0.67, 0.69, 0.73), C5 = vec3(0.79, 0.81, 0.84), C6 = vec3(0.90, 0.91, 0.93);
vec3 cloud(int i) { return i <= 0 ? C0 : i == 1 ? C1 : i == 2 ? C2 : i == 3 ? C3 : i == 4 ? C4 : i == 5 ? C5 : C6; }
vec3 cloudF(float t) { t = clamp(tstep(t), 0.0, 6.0); int i = int(min(floor(t), 5.0)); return mix(cloud(i), cloud(i + 1), t - float(i)); }

// the deck's density at p: a dense core over the wall cloud, spiral arms (log spirals turning) warped by the sheared flow (inner
// faster: the bands wind and stream), cauliflower lumps on top, a ragged rim that fades in see-through steps
float deckD(vec2 p, out float nf) {
  // the spiral turns about the funnel top (uHole); the MASS lies mostly up-screen of it (the deck is higher than the lowered wall
  // cloud, so it shows further up): its envelope is centred at uTop
  vec2 C = uHole.xy, M = uTop.xy;
  vec2 d = p - C; d.y /= SQ;
  vec2 e = p - M; e.y /= SQ;
  float R = uTop.z, r = length(d) / R, re = length(e) / R, th = atan(d.y, d.x);
  nf = swirl3(p, C, SQ, -1.5, 0.25 * R, 6.0, 20.0 * uU, uSd + 11);
  float lump = swirl2(p, C, SQ, -1.2, 0.3 * R, 5.0, 7.0 * uU, uSd + 13);
  float arm = 0.5 + 0.5 * cos(3.0 * (th + uPh.x + 2.6 * log(max(r, 0.03) * 4.0)) + 3.5 * (nf - 0.5));
  // the wall cloud: the deck is thickest right over the funnel
  vec2 hw = (p - C) / vec2(uHole.z * 1.5, uHole.z * 1.5 * SQ);
  float wallk = (1.0 - smoothstep(0.3, 1.1, length(hw) + 0.35 * (nf - 0.5))) * uHole.w;
  float body = 1.0 - smoothstep(0.3, 1.2, re + 0.35 * (nf - 0.5));
  float core = 1.0 - smoothstep(0.05, 0.6, re + 0.3 * (nf - 0.5));
  // spiral arms with clear gaps between them (the rotation reads from the arms; no solid cap), a dense core, the wall cloud
  float D = body * (0.08 + 1.2 * pow(arm, 1.3) * (0.4 + 0.95 * nf)) + 0.4 * core + 0.2 * wallk;
  D += 0.22 * (lump - 0.5) * smoothstep(0.15, 0.45, D);
  // the near side, below the funnel top on screen, thins to see-through levels: the funnel shows rising into the wall cloud
  float near = smoothstep(0.0, 0.4 * R, p.y - C.y + 12.0 * uU * (nf - 0.5)) * (1.0 - smoothstep(1.2 * uHole.z, 3.4 * uHole.z, abs(p.x - C.x) + 10.0 * uU * (nf - 0.5)));
  D *= 1.0 - 0.72 * near;
  return D * 1.5 * uTop.w;
}

void main() {
  vec2 p = vP;
  if ( uMode == 0 || uMode == 2 ) {
    // ---- THE RAIN CURTAIN: sheets standing on rings round the base, wrapping the rear (behind the motion) and the right flank,
    // ragged at the top (under the deck), in strands, with falling streaks. Mode 0 draws the far half (behind everything), mode 2
    // the near half (in front of the funnel and the debris). The foot never ends in a line: the shafts reach down unevenly, thin
    // out in dithered steps and break into spray and mist drifting round with the rotation.
    if ( uCurt.x <= 0.001 ) discard;
    float lift = uView.x, sq = uView.y, dens = 0.0, mist = 0.0, fk = fineK();
    // the fine strands of the falling sheets (thin vertical fibres sliding down) and the spray's grain, shared by the 3 sheets
    float fib = vnoise(vec2(p.x / (1.3 * uU), p.y / (16.0 * uU) - uT * 1.6), uSd + 59);
    float grain = vnoise(vec2(p.x, p.y / sq) / (1.5 * uU) + vec2(uT * 2.3, uT * 0.7), uSd + 60);
    for ( int k = 0; k < 3; k++ ) {
      // a ragged outline (the sheet's radius wobbles with height), thinning toward the silhouette so it has no hard side edge
      float Rk = uCurt.y * (0.82 + 0.16 * float(k)) * (1.0 + 0.16 * (fbm2(vec2(p.y / (40.0 * uU), float(k) * 2.3 + uT * 0.05), uSd + 55) - 0.5));
      float cx = (p.x - uBase.x) / Rk;
      if ( abs(cx) >= 1.0 ) continue;
      float side = 1.0 - smoothstep(0.55, 1.0, abs(cx));
      for ( int s2 = 0; s2 < 2; s2++ ) {
        if ( (uMode == 0 && s2 == 1) || (uMode == 2 && s2 == 0) ) continue;
        float ph = s2 == 0 ? -acos(cx) : acos(cx);
        float gy = uBase.y + sin(ph) * Rk * sq;                                         // the sheet's foot on the ground (screen)
        float rel = mod(ph - uCurt.w + 12.5664, 6.2832) - 3.14159;                   // 0 = straight behind the motion, -pi/2 its right flank
        float sect = 1.0 - smoothstep(1.0, 2.0, abs(rel + 0.55) + 0.7 * (loopN1(vec2(ph * 1.3, float(k)), 12.0, 1.1, uSd + 51) - 0.5));
        float strand = fbm2(vec2(p.x / (5.0 * uU), p.y / (60.0 * uU) - uT * 0.4), uSd + 52);
        strand += 0.45 * fk * (fib - 0.5);
        float top = gy - uCurt.z * (0.6 + 0.4 * vnoise(vec2(p.x / (14.0 * uU), float(k) * 3.1), uSd + 53));
        // the shafts' feet: uneven (some reach the ground, some end above it), moving with the rotation
        float shaft = loopN1(vec2(p.x / (9.0 * uU) + float(k) * 4.1, float(k)), 4.0, 1.3, uSd + 56);
        float foot = gy - (2.0 + 16.0 * shaft) * uU, fw = (10.0 + 10.0 * shaft) * uU;
        // spray and mist round the foot, drifting with the rotation (both sides of the foot line)
        float dy = p.y - gy;
        if ( abs(dy) < 9.0 * uU ) {
          float mn = drift2(vec2(p.x, p.y / sq), vec2(-26.0 * uU * sign(cos(ph)), 4.0 * uU), uT, 3.0, 7.0 * uU, uSd + 57);
          mn += 0.3 * fk * (grain - 0.5);
          mist = max(mist, sect * side * (s2 == 1 ? smoothstep(0.45, 0.85, abs(cx)) : 1.0) * smoothstep(0.5, 0.8, mn) * (1.0 - smoothstep(2.0 * uU, 9.0 * uU, abs(dy + 2.0 * uU))));
        }
        if ( p.y < top || p.y > foot + fw ) continue;
        float v = sect * side * (0.4 + 0.9 * strand) * smoothstep(top, top + 18.0 * uU, p.y) * (1.0 - 0.3 * float(k) / 2.0);
        v *= 1.0 - smoothstep(foot - fw * 0.2, foot + fw, p.y);                       // thinning toward the ground
        if ( s2 == 1 ) v *= 0.55 * smoothstep(0.45, 0.85, abs(cx));                    // the near half: thin, only on the flanks
        dens = max(dens, v);
      }
    }
    dens *= uCurt.x; mist *= uCurt.x;
    // falling streaks: thin antialiased lines along the slant (one per 1.6 art px column, some lit), in dashes sliding down
    float u_ = p.x + 0.33 * p.y, col_ = floor(u_ / 1.6);
    float cu = u_ - (col_ + 0.3 + 0.4 * hu(int(col_), 1, uSd + 54)) * 1.6;
    float vv = (p.y + 170.0 * uT) / (6.0 * uU) + 7.0 * hu(int(col_), 2, uSd + 54), sg = floor(vv), fv = vv - sg;
    float st = step(0.74, hu(int(col_), int(sg), uSd + 54)) * aaK(0.3 - abs(cu)) * smoothstep(0.0, 0.3, fv) * (1.0 - smoothstep(0.55, 1.0, fv));
    // the sheet: its amount a smooth function of the density (no dithered steps), the streaks over it
    float a = smoothstep(0.12, 0.34, dens);
    float m = (0.28 + 0.28 * smoothstep(0.35, 0.75, dens)) * a;
    vec3 c = mix(vec3(0.36, 0.40, 0.47), vec3(0.62, 0.66, 0.72), st);
    m = min(1.0, m + 0.14 * st * a);
    // spray / mist where the sheet thins (faint, grainy, drifting)
    float mm = (0.22 + 0.1 * st) * smoothstep(0.28, 0.8, mist);
    vec4 o = vec4(c * m, m) + vec4(vec3(0.58, 0.62, 0.68) * mm, mm) * (1.0 - m);
    if ( o.a <= 0.003 ) discard;
    fragColor = o;
    return;
  }
  // ---- THE STORM DECK (seen from above: a sunlit, lumpy, turning cloud top; its shadow is on the ground)
  float pr = uDeck.w;
  if ( pr <= 0.001 ) discard;
  vec2 C = uHole.xy, M = uTop.xy;
  vec2 d = p - C; d.y /= SQ;
  vec2 e = p - M; e.y /= SQ;
  float R = uTop.z, r = length(d) / R, re = length(e) / R;
  if ( min(re, r) > 2.0 ) discard;
  float nf, nf2, nf3;
  float grow = 0.45 + 0.55 * pr;                                          // forming: it grows out from the core
  float D = deckD(p, nf) * smoothstep(grow + 0.1, grow - 0.25, min(r, re));
  // lit where the mass thins toward the light (up-left), shadowed where it thins away from it
  // (the mass is smooth over 3 art px: its other side, D(p + o), is 2 D - D(p - o) - one evaluation fewer than sampling it)
  float Dl = deckD(p - vec2(3.0, 3.0) * uU, nf2);
  // the fine cauliflower curls (lumps on the lumps, turning with the deck), each lit on its up-left side: real structure magnified
  float fk = fineK();
  float fd = swirl2(p, C, SQ, -1.2, 0.3 * R, 5.0, 4.2 * uU, uSd + 14), fdl = swirl2(p - vec2(1.4, 1.4) * uU, C, SQ, -1.2, 0.3 * R, 5.0, 4.2 * uU, uSd + 14);
  // (they gather on the tops of the big lumps and fade in the creases between them: clustered domes, not an even scale pattern)
  float ck = fk * smoothstep(0.35, 0.75, nf);
  float Dh = D + 0.1 * ck * (fd - 0.5) * smoothstep(0.08, 0.35, D);
  // the see-through levels as one smooth amount (they were 4 flat steps), the rim antialiased by the soft ramp
  float lev = clamp(1.0 + (Dh - 0.2) / 0.2, 1.0, 4.0);
  float ea = smoothstep(0.16, 0.22, Dh);
  vec4 deck = vec4(0.0);
  if ( ea > 0.0 ) {
    float dark = uDeck.x;
    float t = 3.4 + 0.45 * (lev - 2.0) - 1.4 * dark + 1.2 * clamp((D - Dl) * 5.0, 0.0, 1.0) - 1.4 * clamp((Dl - D) * 5.0, 0.0, 1.0)
              + 0.9 * (nf - 0.5) + (0.25 + 0.75 * ck) * (0.6 * (fd - 0.5) + 1.5 * clamp(fd - fdl, -0.25, 0.25)) * smoothstep(0.15, 0.4, D);
    // lightning: a brief flash lights the lumps of one region from inside
    float fl = uDeck.z;
    if ( fl > 0.01 ) {
      vec2 z = M + vec2(cos(uPh.z), sin(uPh.z) * SQ) * R * 0.4;
      float zone = 1.0 - smoothstep(0.0, R * 0.4, length((p - z) * vec2(1.0, 1.0 / SQ)) + 30.0 * uU * (fbm2(p / (12.0 * uU), uSd + 61) - 0.5));
      t += fl * 3.0 * zone;
    }
    float m = min(0.94, 0.34 + 0.22 * (lev - 1.0)) * smoothstep(0.0, 0.3, pr) * ea;
    deck = vec4(cloudF(t) * m, m);
  }
  // FEEDER (INFLOW) BANDS: long thin bands of low cloud spiralling in from far out to the wall cloud, scud racing along them, lit on
  // the light side, a dark underside line under each (they hang below the deck: drawn where the deck is thin)
  if ( uDeck.y > 0.001 && deck.a < 0.65 ) {
    float th = atan(d.y, d.x);
    float nb = swirl2(p, C, SQ, -1.4, 0.35 * R, 5.0, 9.0 * uU, uSd + 71);
    float sc = swirl2(p, C, SQ, -2.4, 0.3 * R, 3.0, 3.5 * uU, uSd + 72);
    float ph = 2.0 * (th + uPh.y + 3.4 * log(max(r, 0.05))) + 4.0 * (nb - 0.5);
    float band = pow(0.5 + 0.5 * cos(ph), 5.0), under = pow(0.5 + 0.5 * cos(ph + 0.45), 5.0);
    float reach = smoothstep(0.25, 0.55, r) * (1.0 - smoothstep(1.2, 1.9, r + 0.5 * (nb - 0.5)));
    // they stream in from the flanks and the rear; the near side, over the funnel and its base, stays clear
    reach *= 1.0 - 0.95 * smoothstep(0.05, 0.75, d.y / max(length(d), 1.0) + 0.3 * (nb - 0.5));
    float f = band * (0.75 + 0.5 * sc) * reach, g = under * (0.75 + 0.5 * sc) * reach;
    float pres = uDeck.y * smoothstep(0.2, 0.8, pr) * smoothstep(0.65, 0.5, deck.a);
    // the band (its edge a smooth ramp, no dithered fringe), brighter where the scud is thick; the dark underside line under it
    float bk = smoothstep(0.38, 0.5, f), hi = smoothstep(0.8, 0.9, f) * smoothstep(0.5, 0.6, sc);
    float ub = smoothstep(0.5, 0.6, g) * (1.0 - bk);
    float mb = mix(0.44, 0.58, smoothstep(0.55, 0.68, f));
    mb = mix(mb, 0.7, hi) * bk * pres;
    vec3 cb = cloudF(3.0 + smoothstep(0.55, 0.68, f) + hi);
    float mu = 0.36 * pres * ub;
    deck = vec4(cloud(1) * mu, mu) + deck * (1.0 - mu);
    deck = vec4(cb * mb, mb) + deck * (1.0 - mb);
  }
  if ( deck.a < 0.003 ) discard;
  fragColor = deck;
}`;

/* ---------------------------------------------------------------- COLUMN: the funnel */

export const COLUMN_FRAG = `${HEAD}
in vec2 vP;
uniform vec4 uAxis[40];     // per height sample: x, screen y (absolute art px), core radius, z; screen y strictly decreasing
uniform vec4 uCol;          // funnel height Z, the lowest z shown (lowering funnel), rope-out 0..1, dust (lower funnel brown)
uniform vec4 uPh;           // CPU phases (rad): bands 11 turns / 10 s, the travelling wave, the pinch / mottle field, the lumps
uniform vec3 uDust;         // the dirt colour (the map near the base)
uniform int uSd;
out vec4 fragColor;
${TCOMMON}
// (the same field without its finest octave: a height is half as long on screen (LIFT), so its finest octave would be under an art
// px there - drawn magnified it combed the edges and bands into rows; the fibres below are the fine detail, at a scale that shows)
float bandn2(float u, float zs) { return fbm2(vec2(cos(u) * 1.1 + zs / (8.5 * uU), sin(u) * 1.1 + zs / (12.0 * uU)), uSd + 103); }
// (one octave: the silhouette's slow wobble)
float bandn1(float u, float zs) { return vnoise(vec2(cos(u) * 1.1 + zs / (8.5 * uU), sin(u) * 1.1 + zs / (12.0 * uU)), uSd + 103); }

void main() {
  vec2 p = vP;
  float Z = uCol.x, zt = uPx / uView.x, fk = fineK();      // (zt: one texel as a height)
  // the height on the axis for this row (the table is monotone in screen y)
  float z = -1e4, cx = 0.0, rc = 0.0, slope = 0.0;
  if ( p.y > uAxis[0].y ) { z = -(p.y - uAxis[0].y) / uView.x; cx = uAxis[0].x; rc = uAxis[0].z; slope = (uAxis[1].x - uAxis[0].x) / max(uAxis[0].y - uAxis[1].y, 0.01); }
  else {
    for ( int k = 0; k < 39; k++ ) {
      vec4 a = uAxis[k], b = uAxis[k + 1];
      if ( p.y <= a.y && p.y > b.y ) {
        float f = (a.y - p.y) / max(a.y - b.y, 0.001);
        z = mix(a.w, b.w, f); cx = mix(a.x, b.x, f); rc = mix(a.z, b.z, f);
        // the lean (x per screen row): each joint's the mean of its two segments', interpolated along the segment (continuous: a
        // step in the lean would step the width and every band across the whole funnel at that row)
        float s0 = (b.x - a.x) / max(a.y - b.y, 0.01);
        int kp = max(k - 1, 0), kq = min(k + 2, 39);
        float sp = (a.x - uAxis[kp].x) / max(uAxis[kp].y - a.y, 0.01), sq = (uAxis[kq].x - b.x) / max(b.y - uAxis[kq].y, 0.01);
        if ( k == 0 ) sp = s0;
        if ( k + 2 > 39 ) sq = s0;
        slope = mix(0.5 * (sp + s0), 0.5 * (s0 + sq), f);
        break;
      }
    }
  }
  if ( z < -3.0 * uU - zt || z > Z + 2.0 * uU || z < uCol.y - 2.0 - zt ) discard;
  float vz = smoothstep(-3.0 * uU - zt, -3.0 * uU + zt, z) * smoothstep(uCol.y - 2.0 - zt, uCol.y - 2.0 + zt, z);
  float zc = clamp(z, 0.0, Z), q = zc / Z;
  float dx = p.x - cx;
  rc *= sqrt(1.0 + clamp(slope, -1.2, 1.2) * clamp(slope, -1.2, 1.2) * (1.0 - 0.7 * smoothstep(0.6, 0.95, q)));
  // the lowering funnel: a tapering tip at the lowest z shown
  // (continuous: the last 15% used to come in as a step, a seam across the funnel)
  rc *= smoothstep(uCol.y - 2.0, uCol.y + 30.0 * uU, zc);
  float rope = uCol.z;
  if ( abs(dx) > rc * 2.6 + 2.0 * uU ) discard;           // (beyond the widest the sheath can reach: no noise spent)
  // the flow deforms the bands (looped noise of angle and height): each side's silhouette its own, blended across the middle
  // (the shading never shows a seam down the axis)
  float W0 = uPh.x + 0.020 * zc / uU + 0.85 * sin(zc * 0.027 / uU - uPh.y);
  float fl_n = bil(loopN(p / (7.0 * uU), 3.3333, 1.1, uSd + 108));
  float rs2[2];
  for ( int i = 0; i < 2; i++ ) {
    float side = i == 0 ? -1.0 : 1.0;
    float warpS = 1.6 * (loopN(vec2(zc / (35.0 * uU) + 0.7 * side, 0.0), 3.3333, 0.7, uSd + 105) - 0.5);
    float ne = bandn1(side * 1.5708 + W0 + warpS, zc * 0.5);   // (half the band field's rate in height: undulations, not ripples)
    float footn = loopN(vec2(zc / (10.0 * uU), side * 3.0), 1.6667, 1.1, uSd + 101);
    rs2[i] = rc * (1.0 + 0.36 * (ne - 0.5) * (1.0 - 0.6 * smoothstep(0.7, 1.0, q)) + 0.35 * exp(-zc / (10.0 * uU)) * (footn - 0.35)
                  + 0.45 * smoothstep(0.75, 1.0, q) * (fl_n - 0.5));
  }
  float rce = mix(rs2[0], rs2[1], smoothstep(-0.35, 0.35, dx / max(rc, 0.5)));
  float side = dx >= 0.0 ? 1.0 : -1.0;
  // roping out: the funnel breaks into pieces from the bottom up
  float ropeK = 1.0;
  if ( rope > 0.0 ) {
    float br = fbm2(vec2(zc / (18.0 * uU), uPh.z * 0.3), uSd + 109), thr = rope * 1.1 - 0.25 + 0.4 * (1.0 - q) * rope;
    ropeK = smoothstep(thr - 0.02, thr + 0.02, br);
    if ( ropeK <= 0.0 ) discard;
  }
  // the top never ends in a line: the flare frays into the wall cloud at a ragged, moving height, the last of it see-through, in
  // fine torn wisps
  float topN = loopN(vec2(dx / (7.0 * uU), zc / (20.0 * uU)), 3.0, 1.0, uSd + 110);
  float wis = vnoise(vec2(dx / (1.6 * uU), zc / (5.0 * uU)) + vec2(uPh.w, 0.0), uSd + 112);
  float zTop = Z * (0.84 + 0.13 * topN) + 3.0 * uU * fk * (wis - 0.5);
  float topK = aaW(zTop - zc);
  if ( topK <= 0.0 ) discard;
  float frayK = smoothstep(zTop - 0.05 * Z - zt, zTop - 0.05 * Z + zt, zc);
  // inside the core (antialiased silhouette), or in the sheath of condensation round it
  float inK = aaW(rce - abs(dx));
  // (one slow octave: a height is half as long on screen, so a finer wobble of the edge would lie along the rows)
  float sn = vnoise(vec2(zc / (16.0 * uU) + side * 5.0, 0.0) + 1.1 * vec2(cos(6.2831853 * fract(uT / 2.0)), sin(6.2831853 * fract(uT / 2.0))), uSd + 104);
  float rsh = rce * (1.2 + 0.3 * sn) * (1.0 - 0.6 * rope);
  float shK = aaW(rsh - abs(dx)) * (1.0 - inK) * smoothstep(2.0 * uU - zt, 2.0 * uU + zt, z) * (1.0 - smoothstep(Z * 0.8 - zt, Z * 0.8 + zt, z));
  if ( inK + shK <= 0.0 ) discard;
  float rcl = max(rce, 0.5);
  float s_ = sqrt(clamp(1.0 - (dx / rcl) * (dx / rcl), 0.0, 1.0));
  float zs = zc + rce * uView.y * s_ / uView.x;           // the height of the FRONT surface: bands curve like the near half of a ring
  float th = asin(clamp(dx / rcl, -1.0, 1.0));
  float zw = zs + 8.0 * uU * (loopN(vec2(th * 0.8, zs / (30.0 * uU)), 5.0, 0.8, uSd + 106) - 0.5);
  float warp = 1.6 * (loopN(vec2(zw / (35.0 * uU) + 0.7 * cos(th), 0.7 * sin(th)), 3.3333, 0.7, uSd + 105) - 0.5);
  float uf = th + uPh.x + 0.020 * zw / uU + 0.85 * sin(zw * 0.027 / uU - uPh.y) + warp;
  float n = bandn2(uf, zw);
  float u2 = th + uPh.z + 0.012 * zs / uU;
  float mm = fbm2(vec2(cos(u2) * 0.8 + zs / (30.0 * uU), sin(u2) * 0.8 - zs / (38.0 * uU)), uSd + 104);
  float lit = -dx / rcl;
  float fq = smoothstep(0.78, 0.97, q);                    // the flare turns into cloud: lumps, not bands
  float lump = bil(fbm3(rot(vec2(dx, zc * uView.x), uPh.w) / (9.0 * uU), uSd + 107));
  float lumpF = vnoise(rot(vec2(dx, zc * uView.x), uPh.w) / (2.4 * uU), uSd + 113);
  // the band edges: antialiased over about a texel of the noise (the bands stay crisp magnified, never a staircase)
  float wn = max(0.06 + 0.25 * uPx, fwidth(n));
  float e1 = 0.56 + 0.2 * (mm - 0.5), e2 = 0.40 + 0.15 * (mm - 0.5), e3 = 0.74 + 0.08 * (mm - 0.5);
  float bands = 0.6 * smoothstep(e1 - wn * 0.5, e1 + wn * 0.5, n) - 0.9 * (1.0 - smoothstep(e2 - wn * 0.5, e2 + wn * 0.5, n)) + 1.0 * smoothstep(e3 - wn * 0.5, e3 + wn * 0.5, n);
  // FIBRES: fine striations along the flow (long round the funnel, thin in height), carried with the bands
  float fib = fbm2(vec2(cos(uf) * 1.7 + zw / (2.6 * uU), sin(uf) * 1.7 + zw / (3.6 * uU)), uSd + 111);
  float tv = 3.2 + 1.7 * lit + 0.8 * (s_ - 0.6) + 0.2 * q + (1.0 - fq) * (bands + 0.75 * fk * (fib - 0.5)) + fq * (1.5 * (lump - 0.5) + 0.9 * fk * (lumpF - 0.5));
  // a dark crease under each bright band (the row above is a band top)
  float zsA = zs + 1.0 / uView.x;
  float nA = bandn2(th + uPh.x + 0.020 * zsA / uU + 0.85 * sin(zsA * 0.027 / uU - uPh.y) + warp, zsA);
  float btK = smoothstep(e3 - wn * 0.5, e3 + wn * 0.5, n), crK = smoothstep(e3 - wn * 0.5, e3 + wn * 0.5, nA) * (1.0 - btK) * (1.0 - smoothstep(0.45, 0.55, fq));
  tv -= 0.9 * crK;
  // roping out: paler, thinner, condensation only
  tv += 0.8 * rope;
  // dusty low down; the dust's upper edge follows the bands (curved, turning, ragged): never a straight line across the funnel
  float qd = q + 0.16 * (n - 0.5) + 0.06 * (mm - 0.5);
  float dq = clamp((1.0 - smoothstep(0.03, 0.40 + 0.25 * uCol.w, qd)) * 2.0 * min(1.0, uCol.w / 0.6), 0.0, 2.0);
  vec3 col = rampF(uDust, dq, tv);
  // a darker outline on the shadow (right) side, about an art px wide, antialiased
  col = mix(col, rampF(uDust, dq, 0.0), dx > 0.0 ? aaW(dx - (rce - 1.0)) * 0.9 : 0.0);
  // see-through: the gaps between bands mid-height, the frayed top, the sheath
  // (the height band they live in fades in and out over a long, ragged stretch: a sharp start drew a seam across the funnel; the gap
  // edge is antialiased over the band field's own change per texel, which is steep toward the silhouette)
  float wg = max(wn, 1.2 * fwidth(n)), qg = q + 0.12 * (mm - 0.5);
  float gapK = (1.0 - smoothstep(0.25 + 0.1 * (mm - 0.5) - wg, 0.25 + 0.1 * (mm - 0.5) + wg, n)) * smoothstep(0.5, 0.65, abs(dx) / rcl)
               * smoothstep(0.2, 0.36, qg) * (1.0 - smoothstep(0.64, 0.8, qg));
  float seeK = max(gapK, frayK);
  float m = 0.38 * (1.0 - 0.5 * rope);
  vec3 sc = rampF(uDust, dq, clamp(tv, 2.0, 5.0));
  // the sheath and the frayed top in wisps (thicker and thinner streaks of the flow), not a flat film
  float shn = vnoise(vec2(dx / (2.2 * uU), zc / (4.5 * uU)) + 1.3 * vec2(cos(uPh.w), sin(uPh.w)), uSd + 114);
  float wm = m * (0.75 + 0.5 * fk * (mix(fib, shn, shK) - 0.5) * 2.0);
  float ai = mix(1.0, mix(m, wm, frayK), seeK);
  vec4 o = vec4(mix(col, sc, seeK) * ai, ai) * inK + vec4(sc * wm, wm) * shK;
  o *= vz * topK * ropeK;
  if ( o.a <= 0.003 ) discard;
  fragColor = o;
}`;

/* ---------------------------------------------------------------- SKIRT (the dust thrown over the ground round the foot) */

export const FOOT_FRAG = `${HEAD}
in vec2 vP;
uniform int uMode;          // 0 the dust skirt on the ground
uniform vec4 uBase;         // base x, y (screen art px), touch, skirt radius
uniform vec4 uMot;          // trailing direction x, y (unit, screen), the side the spin throws to (rad), touchdown swell
uniform vec4 uPh;           // CPU phases: jets, rolling rings 1, 2, wall lumps
uniform vec3 uDust;
uniform vec4 uWall;         // funnel top x, y (screen), its screen y limit for the wall's dark underside, presence
uniform int uSd;
out vec4 fragColor;
${TCOMMON}
// jets streaming radially outward at v art px / s (narrow in angle), two cross-faded phases restarting while unseen
float jets(float ps, float rg, float v, float P, int s) {
  float a = uT / P, b = a + 0.5, ka = floor(a), kb = floor(b), fa = a - ka, fb = b - kb;
  float sa = rg - v * fa * P, sb = rg - v * fb * P;
  float na = fbm3(vec2(cos(ps) * 4.5 + sa / (30.0 * uU) + hu(int(ka), 3, s) * 50.0, sin(ps) * 4.5 - sa / (30.0 * uU)), s);
  float nb = fbm3(vec2(cos(ps) * 4.5 + sb / (30.0 * uU) + hu(int(kb), 5, s) * 50.0, sin(ps) * 4.5 - sb / (30.0 * uU)), s + 7);
  return mix(nb, na, 1.0 - abs(2.0 * fa - 1.0));
}
// ... and their fine grit: thin streaks along the same flow (value noise only), shown magnified
float jetsF(float ps, float rg, float v, float P, int s) {
  float a = uT / P, b = a + 0.5, ka = floor(a), kb = floor(b), fa = a - ka, fb = b - kb;
  float sa = rg - v * fa * P, sb = rg - v * fb * P;
  float na = vnoise(vec2(cos(ps) * 16.0 + sa / (5.0 * uU) + hu(int(ka), 3, s) * 50.0, sin(ps) * 16.0 - sa / (5.0 * uU)), s);
  float nb = vnoise(vec2(cos(ps) * 16.0 + sb / (5.0 * uU) + hu(int(kb), 5, s) * 50.0, sin(ps) * 16.0 - sb / (5.0 * uU)), s + 7);
  return mix(nb, na, 1.0 - abs(2.0 * fa - 1.0));
}
void main() {
  vec2 p = vP;
  if ( uMode == 0 ) {
    // THE SKIRT: radial jets streaming outward (cross-faded), lopsided toward the throw side and trailing behind the motion, two rolling
    // rings expanding from the foot at each touchdown pulse; every edge a smooth ramp, the fine grit streaking outward in the jets
    vec2 d = p - uBase.xy - uMot.xy * 6.0 * uU; d.y /= uView.y;
    float rg = length(d), ps = atan(d.y, d.x), Rs = uBase.w;
    if ( rg > Rs * 1.6 || rg < 5.0 * uU - uPx ) discard;
    float fk = fineK();
    float j = jets(ps + uPh.x, rg, 34.0 * uU, 1.5, uSd + 151);
    float jf = jetsF(ps + uPh.x, rg, 34.0 * uU, 1.5, uSd + 155);
    float lop = 1.0 + 0.45 * cos(ps - uMot.z) + 0.2 * cos(ps - atan(uMot.y, uMot.x));
    float R = Rs * uMot.w * lop;
    float ring = 0.0;
    for ( int k = 0; k < 2; k++ ) {
      float f = fract(uT / 2.2 + float(k) * 0.5), rr = R * (0.35 + 0.85 * f);
      float w = (3.0 + 6.0 * f) * uU, cy = float(k) + floor(uT / 2.2 + float(k) * 0.5) * 1.7;
      ring = max(ring, (1.0 - smoothstep(0.0, w, abs(rg - rr + 5.0 * uU * (fbm2(vec2(cos(ps), sin(ps)) * 1.6 + vec2(cy, 0.0), uSd + 153) - 0.5)))) * (1.0 - f) * (0.6 + 0.6 * j));
    }
    float jj = j + 0.12 * fk * (jf - 0.5);
    float sk = max(smoothstep(0.44, 0.48, jj) * aaW(R * (0.55 + 0.75 * j) - rg), smoothstep(0.41, 0.49, ring + 0.08 * fk * (jf - 0.5)));
    sk *= aaK(rg - 5.0 * uU);
    if ( sk <= 0.0 ) discard;
    float m = max(0.12 + 0.48 * (1.0 - clamp(rg / R, 0.0, 1.0)) * smoothstep(0.46, 0.62, j), 0.55 * ring) * uBase.z * sk * (0.8 + 0.4 * fk * jf);
    float dxs = p.x - uBase.x;
    float tone = 3.2 + 2.4 * (j - 0.5) - 0.8 * smoothstep(-6.0, 6.0, dxs / uU) + 0.5 * smoothstep(-6.0, -16.0, dxs / uU) + 1.5 * ring + 0.9 * fk * (jf - 0.5);
    vec3 c = dustF(uDust, tone);
    fragColor = vec4(c * m, m);
    return;
  }
  discard;
}`;

/* ---------------------------------------------------------------- VOLUME: the debris cloud and the wall cloud, depth-sorted round the funnel */

// Each pixel marches its view ray through the volume from the near side (high z, low on the map) to the far side (low z, up the map):
// the ground point under the ray at height z is (p.x, p.y + LIFT z). The funnel is a disc of radius rc round the axis at every z, so
// the ray meets the funnel where it passes inside it: uPass 0 integrates the whole volume (drawn BEHIND the column), uPass 1 only the
// samples in FRONT of that hit (drawn over the column, only where the ray meets the funnel). Material orbiting the funnel therefore
// goes behind it on the far side and comes out in front on the near side. The tone comes from the first dense sample (a surface,
// palette steps), the coverage from the whole ray (stepped). The noise turns with the vortex (inner faster: torn spiral streaks) and
// rises, restarted every P s and cross-faded with the contrast kept, so it never winds up and never loops.
export const VOL_FRAG = `${HEAD}
#define VSTAGE 2
in vec2 vP;
uniform vec4 uAxis[40];     // as COLUMN
uniform int uMode;          // 0 the debris cloud round the foot, 1 the wall cloud round the funnel top
uniform int uPass;          // 0 the whole volume (behind the column), 1 only what lies in front of the funnel
uniform vec4 uVol;          // z bottom, z top, presence, outer radius (art px)
uniform vec4 uMot;          // trailing direction x, y (unit, screen), the throw side (rad), touchdown swell
uniform vec4 uPh;           // CPU phases (rad): the arms' turn
uniform int uSteps;         // samples along the ray (18; fewer when the art is drawn finer: the guard's budget)
#if VSTAGE == 1
uniform sampler2D uMarch;   // the march (VSTAGE 0) of this volume: coverage, zn x coverage, mk x coverage
uniform vec4 uMwin;         // its window: origin x, y (absolute art px), texels per art px
uniform vec2 uMsize;        // its size in texels
#endif
uniform vec3 uDust;
uniform int uSd;
out vec4 fragColor;
${TCOMMON}
float h3(ivec3 c, int s) { return hu(c.x, c.y + c.z * 7919, s); }
float vn3(vec3 p, int s) {
  vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  ivec3 c = ivec3(i);
  float a = mix(mix(h3(c, s), h3(c + ivec3(1, 0, 0), s), u.x), mix(h3(c + ivec3(0, 1, 0), s), h3(c + ivec3(1, 1, 0), s), u.x), u.y);
  float b = mix(mix(h3(c + ivec3(0, 0, 1), s), h3(c + ivec3(1, 0, 1), s), u.x), mix(h3(c + ivec3(0, 1, 1), s), h3(c + ivec3(1, 1, 1), s), u.x), u.y);
  return mix(a, b, u.z);
}
float fb3(vec3 p, int s) { return (vn3(p, s) + 0.5 * vn3(p * 2.13 + vec3(17.3, -9.1, 4.7), s + 1)) / 1.5; }
// the turning, rising field: d ground offset from the axis (squash undone), r its length
float vortexN(vec2 d, float r, float z, float w0, float rw, float P, float sc, float scz, float rise, int s) {
  float w = w0 / (1.0 + r / rw);
  float a = uT / P, b = a + 0.5, ka = floor(a), kb = floor(b), fa = a - ka, fb = b - kb;
  vec3 oa = vec3(hu(int(ka), 3, s), hu(int(ka), 4, s), hu(int(ka), 5, s)) * 97.0, ob = vec3(hu(int(kb), 6, s), hu(int(kb), 7, s), hu(int(kb), 8, s)) * 97.0;
  float na = fb3(vec3(rot(d, -w * fa * P) / sc, (z - rise * fa * P) / scz) + oa, s);
  float nb = fb3(vec3(rot(d, -w * fb * P) / sc, (z - rise * fb * P) / scz) + ob, s + 11);
  float wa = 1.0 - abs(2.0 * fa - 1.0), wb = 1.0 - wa;
  return 0.5 + (wa * na + wb * nb - 0.5) / sqrt(wa * wa + wb * wb);
}
// the axis at height z: ground x, y and the core radius
vec3 axisG(float z) {
  float Z = uAxis[39].w, f = clamp(z / Z, 0.0, 1.0) * 39.0;
  int i = min(int(floor(f)), 38);
  float u = f - float(i);
  vec4 a = uAxis[i], b = uAxis[i + 1];
  float zz = mix(a.w, b.w, u);
  return vec3(mix(a.x, b.x, u), mix(a.y, b.y, u) + uView.x * zz, mix(a.z, b.z, u));
}
float gNf = 0.5;            // the fine noise of the last dens() (shading)
// the fine wisps at a surface point: streaks along the rotation (the frame turns with the arms), about 1.3 art px thin
float wispN(vec2 d, float z) {
  vec2 rd = rot(d, -uPh.x); float r = length(rd);
  vec2 e = rd / max(r, 1e-3);
  return fbm2(e * r / (6.0 * uU) + vec2(r / (1.3 * uU), z / (2.2 * uU)), uSd + 350);
}
// density at ground offset d (squash undone) and height z; n out: the big noise (shading)
float dens(vec2 d, float z, float rc, out float n) {
  float r = length(d), th = atan(d.y, d.x);
  float z0 = uVol.x, z1 = uVol.y, zn = (z - z0) / (z1 - z0), R = uVol.w;
  if ( uMode == 0 ) {
    // THE DEBRIS CLOUD: a churning skirt hugging the foot, widest low down, lopsided to the throw side, torn into spiral streaks
    float zc = clamp(zn, 0.0, 1.0);
    float lop = 1.0 + 0.3 * cos(th - uMot.z) + 0.15 * dot(d / max(r, 0.01), uMot.xy);
    // widest on the ground (the skirt), drawn in round the funnel higher up (the sheath of dust climbing it)
    float Ro = rc + R * (0.32 + 0.95 * exp(-3.2 * zc)) * lop * uMot.w;
    float x = (r - rc) / max(Ro - rc, 1.0);
    if ( x > 1.8 || x < -0.2 ) { n = 0.5; return 0.0; }
    n = vortexN(d, r, z, -3.6, 0.8 * rc + 5.0 * uU, 2.5, 12.0 * uU, 8.0 * uU, 11.0 * uU, uSd + 301);
    float nf = vortexN(d, r, z, -4.5, 0.8 * rc + 5.0 * uU, 2.0, 4.0 * uU, 3.0 * uU, 16.0 * uU, uSd + 311); gNf = nf;
    // spiral arms of thicker dust, trailing (a rigidly turning pattern, warped by the noise: it never winds up)
    float arm = 0.5 + 0.5 * sin(3.0 * (th + uPh.x) + 3.0 * log(max(r, 1.0) / max(rc, 1.0)) + 3.0 * (n - 0.5));
    float rad = (1.0 - smoothstep(0.15, 1.15, x + 0.7 * (n - 0.5) + 0.3 * (nf - 0.5) - 0.2 * arm)) * smoothstep(-0.2, 0.12, x);
    float vert = (1.0 - smoothstep(0.1, 0.8, zn + 0.6 * (n - 0.5) + 0.25 * (nf - 0.5))) * (1.0 - smoothstep(0.7, 0.95, zn));
    return rad * vert * (1.6 * n - 0.15 + 0.45 * (nf - 0.5) + 0.35 * (arm - 0.5)) * uVol.z;
  }
  // THE WALL CLOUD: a lowered, rotating collar round the funnel top, ragged underneath (scud), striated, merging up into the deck
  float Ro = rc * 0.85 + R * (0.35 + 0.65 * smoothstep(0.0, 1.0, zn));
  float x = r / max(Ro, 1.0);
  if ( x > 1.5 ) { n = 0.5; return 0.0; }
  n = vortexN(d, r, z, -1.6, 0.5 * R, 5.0, 16.0 * uU, 6.0 * uU, 2.0 * uU, uSd + 321);
  float nf = vortexN(d, r, z, -2.2, 0.5 * R, 4.0, 6.0 * uU, 3.0 * uU, 3.0 * uU, uSd + 331); gNf = nf;
  float rad = 1.0 - smoothstep(0.4, 1.15, x + 0.9 * (n - 0.5) + 0.35 * (nf - 0.5));
  float bot = smoothstep(0.0, 0.45, zn + 0.7 * (n - 0.5) + 0.3 * (nf - 0.5) - 0.25 * (1.0 - x));
  return rad * bot * (1.0 - smoothstep(0.55, 1.0, zn + 0.6 * (n - 0.5) + 0.25 * x)) * (0.3 + 1.1 * n + 0.35 * (nf - 0.5)) * uVol.z;
}
// THE MARCH: the coverage along this pixel's ray, the height of its surface (where the coverage passes 0.45, placed between the two
// samples it lies between; else the first dense sample) as zn 0..1 of the volume's height, and the front pass's fade-in mk.
// false: nothing here
bool march(vec2 p, out float cov, out float zn, out float mk) {
  float z0 = uVol.x, z1 = uVol.y, lift = uView.x, sq = uView.y;
  int N = uSteps;
  float dz = (z1 - z0) / float(N);
  // the sample offset: a smooth field (a per-pixel hash would show as grain at screen resolution); the slabs' contours wander with it
  float j = uMode == 0 ? 0.5 + 0.8 * (vnoise(p / (4.5 * uU), uSd + 340) - 0.5) : 0.5 + 0.4 * (vnoise(p / (4.5 * uU), uSd + 340) - 0.5);
  float T = 1.0, sZ = -1e4, fZ = -1e4;
  bool hit = false;
  mk = 1.0; cov = 0.0; zn = 0.0;
  if ( uPass == 1 ) {
    // the front pass draws only where the ray meets the funnel: find that first with the axis alone (no density), so a ray that
    // never meets it is discarded before any noise; how deep it meets it fades the pass in over a few art px (no hard rim)
    float dm = 1e4;
    for ( int k = 0; k < 18; k++ ) {
      if ( k >= N ) break;
      float z = z1 - (float(k) + j) * dz;
      vec3 A = axisG(z);
      vec2 d = vec2(p.x - A.x, (p.y + lift * z - A.y) / sq);
      if ( z < uAxis[39].w * (uMode == 1 ? 0.84 : 1.0) && z > -2.0 ) dm = min(dm, length(d) - A.z * 0.9);
    }
    mk = smoothstep(1.5 * uU, -1.5 * uU, dm);
    if ( mk <= 0.0 ) return false;
  }
  float cP = 0.0;
  bool hasP = false;
  for ( int k = 0; k < 18; k++ ) {
    if ( k >= N ) break;
    float z = z1 - (float(k) + j) * dz;
    vec3 A = axisG(z);
    vec2 d = vec2(p.x - A.x, (p.y + lift * z - A.y) / sq);
    // the funnel (only where it exists: below its top, above the ground)
    // (the funnel frays out at 0.84..0.97 Z: above 0.84 Z the wall cloud fills its place)
    if ( length(d) < A.z * 0.9 && z < uAxis[39].w * (uMode == 1 ? 0.84 : 1.0) && z > -2.0 ) { hit = true; hasP = false; if ( uPass == 1 ) break; continue; }
    float n;
    float D = dens(d, z, A.z, n);
    float a = clamp((D - 0.42) * 2.6, 0.0, 1.0) * (uMode == 0 ? 0.55 : 0.6);
    a = 1.0 - pow(1.0 - a, 18.0 / float(N));                 // (the opacity of a sample of this length: the same cloud at any N)
    float cN = 1.0 - T * (1.0 - a);
    if ( a > 0.0 && fZ < -1e3 ) fZ = z;
    if ( sZ < -1e3 && cN > 0.45 ) sZ = z + dz * (1.0 - (hasP ? clamp((0.45 - cP) / max(cN - cP, 1e-4), 0.0, 1.0) : 1.0));
    T *= 1.0 - a;
    cP = cN; hasP = true;
    if ( T < 0.04 ) break;
  }
  if ( uPass == 1 && !hit ) return false;
  cov = 1.0 - T;
  if ( cov <= 0.0 ) return false;
  zn = clamp(((sZ > -1e3 ? sZ : fZ) - z0) / (z1 - z0), 0.0, 1.0);
  return true;
}
// THE SHADE: the surface at height zn re-placed on this pixel's ray and its density evaluated here (at the art texture's resolution:
// the fine noise is drawn here even when the march ran coarser), lit, toned, with its wisps; the coverage's edge torn by them
void shade(vec2 p, float cov, float zn, float mk) {
  float z0 = uVol.x, z1 = uVol.y, lift = uView.x, sq = uView.y, fk = fineK();
  float sZ = z0 + zn * (z1 - z0);
  vec3 A = axisG(sZ);
  vec2 sD = vec2(p.x - A.x, (p.y + lift * sZ - A.y) / sq);
  float sR = A.z, sN;
  float sT = dens(sD, sZ, sR, sN), sF = gNf;
  // the surface's light: thinner toward the light (up-left on screen, and up) is lit, thicker toward it is in shadow
  vec2 Ld = vec2(-0.62, -0.62 / sq) * 4.0 * uU;
  float nl;
  float Dl = dens(sD + Ld, sZ + 3.0 * uU, sR, nl);
  float lit = clamp((sT - Dl) * 2.2, -1.0, 1.0);
  float r = length(sD);
  float side = -(sD.x + sD.y) / max(r, 0.01) * 0.7;           // the up-left half of the cloud faces the light
  // WISPS: fine curls of the surface turning with the arms, lit on their up-left side
  // (streaks round the axis: long along the rotation, thin across it)
  float wf = wispN(sD, sZ), wl = wispN(sD + vec2(-0.7, -0.7) * uU, sZ + 0.8 * uU);
  float wsh = fk * (0.8 * (wf - 0.5) + 2.4 * clamp(wf - wl, -0.2, 0.2));
  vec3 col;
  if ( uMode == 0 ) {
    float tv = 3.4 + 2.4 * lit + 0.9 * side + 1.6 * (zn - 0.35) + 2.0 * (sN - 0.5) + 1.0 * (sF - 0.5) - 1.0 * smoothstep(0.9, 0.0, (r - sR) / max(uVol.w * 0.4, 1.0)) + wsh;
    float q = 1.9 - 1.0 * smoothstep(0.2, 0.9, zn) - 0.4 * smoothstep(4.2, 4.8, tv);   // the dirt low down, greying into the storm higher up
    col = rampF(uDust, q, tv);
  } else {
    // striations: stacked rings of the turning cloud (the rotation reads from them), warped by the noise
    float stri = sin((sZ + 7.0 * uU * (sN - 0.5)) / (2.2 * uU));
    float tv = 2.4 + 1.6 * lit + 0.9 * side + 1.4 * (zn - 0.3) + 1.2 * (sN - 0.5) + 0.9 * (sF - 0.5) + 0.8 * stri + wsh;
    col = mix(greyF(tv), greyF(tv + 1.0) * vec3(0.98, 1.0, 1.04), smoothstep(0.55, 0.9, zn));
  }
  // the coverage as one smooth amount (it was 4 flat levels), its edge (where the surface starts, 0.45) a ramp torn by the wisps
  float m = smoothstep(0.33, 0.47, cov + 0.14 * fk * (wf - 0.5)) * (0.62 + 0.38 * smoothstep(0.5, 0.85, cov)) * mk;
  if ( m <= 0.003 ) discard;
  fragColor = vec4(col * m, m);
}
void main() {
  vec2 p = vP;
  float cov, zn, mk;
#if VSTAGE == 0
  // the march only, into a coarser float texture (coverage, height x coverage, fade x coverage: they interpolate)
  if ( !march(p, cov, zn, mk) ) discard;
  fragColor = vec4(cov, zn * cov, mk * cov, 1.0);
#elif VSTAGE == 1
  // the shade, reading the march (bilinear between its texels: about two texels of this texture per march texel)
  vec2 t = (p - uMwin.xy) * uMwin.z;
  if ( t.x < 0.0 || t.y < 0.0 || t.x > uMsize.x || t.y > uMsize.y ) discard;
  vec4 mt = texture(uMarch, clamp(t, vec2(0.5), uMsize - 0.5) / vec2(textureSize(uMarch, 0)));
  cov = mt.r;
  if ( cov < 0.3 ) discard;
  shade(p, cov, mt.g / cov, mt.b / cov);
#else
  if ( !march(p, cov, zn, mk) || cov < 0.3 ) discard;
  shade(p, cov, zn, mk);
#endif
}`;

/** The volume in two stages (the march at a coarser resolution, the shade at the art texture's): VSTAGE 0, 1 (2: one pass). */
export const volFrag = (stage) => VOL_FRAG.replace("#define VSTAGE 2", `#define VSTAGE ${stage}`);

/* ================================================================== instanced: debris (art texture) and marks (ground, stage) */

export const PART_VERT = `${HEAD}
in vec2 aVertexPosition;
in vec2 aCorner;
in vec4 aA;                 // centre x, y (absolute art px on screen), half extents along the local axes
in vec4 aB;                 // angle, kind, seed, alpha
in vec4 aC;                 // colour rgb, dissolve
in vec4 aD;                 // map source x, y (art px: fragments, scars), fresh (outline), extra
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform vec4 uRect;
uniform int uStage;         // 0 into the art texture, 1 on the stage (scene px)
uniform vec3 uOrigin;       // scene x, y of art px 0, scene px per art px
out vec2 vP;
flat out vec4 vA;
flat out vec4 vB;
flat out vec4 vC;
flat out vec4 vD;
void main() {
  vec2 e = aA.zw + 2.0;
  vec2 l = (aCorner * 2.0 - 1.0) * e;
  float c = cos(aB.x), s = sin(aB.x);
  vec2 w = aA.xy + vec2(c * l.x - s * l.y, s * l.x + c * l.y);
  vec2 pos = uStage == 1 ? uOrigin.xy + w * uOrigin.z : w - uRect.xy;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(pos, 1.0)).xy, 0.0, 1.0);
  vP = w; vA = aA; vB = aB; vC = aC; vD = aD;
}`;

export const PART_FRAG = `${HEAD}
in vec2 vP;
flat in vec4 vA;
flat in vec4 vB;
flat in vec4 vC;
flat in vec4 vD;
uniform int uStage;
uniform sampler2D uMap;
uniform vec4 uMapRect;      // the scene's map: scene x, y, w, h
uniform vec3 uOrigin;
uniform int uHasMap;
out vec4 fragColor;
float hu(int x, int y, int s) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(s) * 1274126177u;
  h = (h ^ (h >> 13u)) * 1103515245u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967296.0;
}
${GLSL_SHAPES}
// smooth 2-D value noise (the marks on the stage: no per-cell hash)
float vn2(vec2 p, int s) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  int x = int(i.x), y = int(i.y);
  return mix(mix(hu(x, y, s), hu(x + 1, y, s), f.x), mix(hu(x, y + 1, s), hu(x + 1, y + 1, s), f.x), f.y);
}
vec2 rot2(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
void out_(vec3 c, float a) {
  if ( a <= 0.002 ) discard;
  fragColor = uStage == 1 ? vec4(c * a, 1.0 - a) : vec4(c * a, a);
}
// an irregular chunk (3-6 corners, aspect 0.55-1) of radius rr, from its seed: its outline as a signed distance (art px, < 0 inside)
// at the continuous point q (the debris in the art texture and the scars on the stage, both antialiased)
float chunkSd(vec2 q, int sd, float rr) {
  int n = 3 + int(pow(hu(sd, 2, 801), 1.3) * 4.0);
  float asp = 0.55 + 0.45 * hu(sd, 3, 801);
  bool fl = hu(sd, 4, 801) < 0.5;
  vec2 rad = vec2(rr * (fl ? asp : 1.0), rr * (fl ? 1.0 : asp)) * (n == 3 ? 1.4 : 1.2);
  float a0 = hu(sd, 5, 801) * 6.283;
  bool c = false;
  float dm = 1e4;
  vec2 pj = vec2(0.0);
  for ( int i = 0; i <= 6; i++ ) {
    int ii = i == n ? 0 : i;
    float a = a0 + (float(ii) + (hu(sd, ii, 802) - 0.5) * 0.55) / float(n) * 6.283, r = 0.6 + 0.5 * hu(sd, ii, 803);
    vec2 pi = vec2(cos(a), sin(a)) * rad * r;
    if ( i > 0 ) {
      if ( ((pi.y > q.y) != (pj.y > q.y)) && q.x < (pj.x - pi.x) * (q.y - pi.y) / (pj.y - pi.y) + pi.x ) c = !c;
      float t; dm = min(dm, segT(q, pj, pi, t));
    }
    pj = pi;
    if ( i == n ) break;
  }
  return c ? -dm : dm;
}
vec3 mapAt(vec2 a) {
  if ( uHasMap == 0 ) return vec3(0.45, 0.4, 0.35);
  vec2 sc = uOrigin.xy + (a + 0.5) * uOrigin.z;
  return texture(uMap, (sc - uMapRect.xy) / uMapRect.zw).rgb;
}
void main() {
  int kind = int(vB.y + 0.5), sd = int(vB.z);
  float al = vB.w;
  if ( uStage == 1 ) {
    // the MARKS on the stage, drawn per screen px at the continuous point (antialiased; no whole art cells, no dithered dissolve)
    vec2 fw = fwidth(vP);
    AA = max(max(fw.x, fw.y), 1e-3);
    vec2 o = vP - vA.xy;
    vec2 l = rot2(o, -vB.x);
    if ( kind == 10 ) {
      // an inflow streak: a thin capsule along its velocity, brighter and stronger toward its head
      float f = vA.z > 0.6 ? clamp((l.x + vA.z) / (2.0 * vA.z), 0.0, 1.0) : 1.0, hw = max(vA.w, 0.3);
      float d = length(vec2(max(abs(l.x) - vA.z, 0.0), l.y));
      out_(vC.rgb * (0.82 + 0.25 * f), al * f * cov(d - hw, hw, 0.3));
      return;
    }
    if ( kind == 11 ) {
      // a chunk's shadow: a soft ellipse
      vec2 ax = max(vA.zw, vec2(0.5));
      float r = min(ax.x, ax.y);
      out_(vec3(0.0), al * 0.4 * cov((length(o / ax) - 1.0) * r, r, 0.8));
      return;
    }
    if ( kind == 12 ) {
      // a scar: dark torn earth with darker patches, a rim of lighter crumbs where it broke, fading out through smooth noise
      float rr = vD.w, d = chunkSd(l + 0.5, sd, rr);
      float m = cov(d, rr, 0.35);
      float dn = vn2(vP / 1.7, 4243) * 0.82 + 0.18;
      m *= smoothstep(vC.a, vC.a + 0.18, dn);
      if ( m <= 0.002 ) discard;
      float rim = smoothstep(-1.5, -0.6, d);
      vec3 e = mix(vec3(0.15, 0.11, 0.08), vec3(0.24, 0.18, 0.12), smoothstep(0.68, 0.85, vn2(l / 1.6 + 9.0, sd)));
      e = mix(e, vec3(0.42, 0.34, 0.25), rim);
      out_(e, al * mix(0.8, 0.55, rim) * m);
      return;
    }
  }
  // the DEBRIS in the art texture, drawn per texel at the continuous point (the art is at about the screen's resolution): every
  // outline antialiased, every dissolve a smooth noise, the map's own pixels read continuously
  vec2 fw = fwidth(vP);
  AA = max(max(fw.x, fw.y), 1e-3);
  vec2 o = vP - vA.xy;
  vec2 l = rot2(o, -vB.x);
  if ( kind == 0 || kind == 10 ) {
    // a streak (a speck's smear, a wisp's chord): a capsule along its velocity, brighter and thicker at the head, tapering to the tail
    float f = vA.z > 0.6 ? clamp((l.x + vA.z) / (2.0 * vA.z), 0.0, 1.0) : 1.0, hw = max(vA.w * 0.85 * mix(0.55, 1.0, f), 0.3);
    float d = length(vec2(max(abs(l.x) - vA.z, 0.0), l.y));
    out_(vC.rgb * (0.82 + 0.25 * f), al * (kind == 10 ? f : mix(0.45, 1.0, f)) * cov(d - hw, hw, 0.0));
    return;
  }
  if ( kind == 1 ) {
    // a MAP FRAGMENT: a slab of the map's own pixels torn out, TUMBLING (foreshortened across its local y by |fc|, its earthy
    // underside showing when fc < 0), lit by how its face turns to the light and along its torn edges, with its thickness showing
    // under it; it dissolves through a smooth noise when it has landed
    float rr = vD.w, fa = max(abs(vC.r), 0.16);
    vec2 lq = vec2(l.x, l.y / fa) + 0.5;
    float d0 = chunkSd(lq, sd, rr) + 0.5 * (vn2(lq / 0.8 + 11.0, sd + 7) - 0.5);   // (a torn, slightly ragged edge)
    // the outline's distance in texels: the local distance over its gradient on the screen (the face is foreshortened in y)
    float gx = chunkSd(lq + vec2(0.25, 0.0), sd, rr) - d0, gy = chunkSd(lq + vec2(0.0, 0.25), sd, rr) - d0;
    vec2 gl = vec2(gx, gy / fa) * 4.0;
    float gs = max(length(gl), 0.2), dS = d0 / gs;
    float face = cov(dS, rr, 0.0);
    float dn = vn2(lq / 1.3 + float(sd % 61) * 1.7, 4243) * 0.82 + 0.18, keep = smoothstep(vC.a, vC.a + 0.14, dn);
    vec4 acc = vec4(0.0);
    // the slab's near edge (its thickness), seen below the face
    if ( face < 1.0 ) {
      float th = max(1.0, vC.b * (0.35 + 0.65 * sqrt(max(0.0, 1.0 - vC.r * vC.r)))), dm = 1e4, tm = 0.0;
      for ( int t = 1; t <= 4; t++ ) {
        float tt = th * float(t) / 4.0;
        vec2 lt = rot2(o - vec2(0.0, tt), -vB.x);
        float dt = chunkSd(vec2(lt.x, lt.y / fa) + 0.5, sd, rr) / gs;
        if ( dt < dm ) { dm = dt; tm = tt / th; }
      }
      float ek = cov(dm, rr, 0.0) * (1.0 - face);
      vec3 e = vec3(0.30, 0.23, 0.16) * (1.0 - 0.3 * tm) * (0.7 + 0.35 * vC.g);
      acc = vec4(e * ek, ek);
    }
    if ( face > 0.0 ) {
      vec3 C;
      if ( vC.r >= 0.0 ) C = mapAt(vD.xy + lq - 0.5);
      else {
        // the underside: packed earth, broad patches, a few clods and roots
        float hh = vn2(lq / 3.0 + 3.0, sd + 1), hc_ = vn2(lq / 0.9 + 5.0, sd + 2);
        C = mix(vec3(0.42, 0.32, 0.22), vec3(0.50, 0.40, 0.28), smoothstep(0.52, 0.68, hh));
        C = mix(C, vec3(0.30, 0.22, 0.15), smoothstep(0.82, 0.9, hc_));
      }
      C *= 0.55 + 0.6 * vC.g;
      // the torn edge (about an art px in from the outline): lit where it faces the light (up-left), darker where it faces away
      vec2 ns = rot2(gl / gs, vB.x);
      float rim = 1.0 - smoothstep(0.0, 1.2, -dS * gs), lt_ = dot(ns, vec2(-0.7071));
      C = mix(C, clamp(C * 1.22 + 0.04, 0.0, 1.0), rim * smoothstep(0.1, 0.5, lt_));
      C = mix(C, C * 0.78, rim * smoothstep(0.1, 0.5, -lt_));
      acc = vec4(C * face, face) + acc * (1.0 - face);
    }
    acc *= keep;
    if ( acc.a <= 0.002 ) discard;
    out_(acc.rgb / acc.a, al * acc.a);
    return;
  }
  if ( kind == 2 ) {
    // a PLANK: a thin board, its edge darker, its face flashing as it turns (extra = the light on its face), a wood grain along it
    vec2 q = abs(l) - vA.zw;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float a = cov(d, min(vA.z, vA.w), 0.0);
    if ( a <= 0.0 ) discard;
    float edge = smoothstep(-0.9, -0.35, d), grain = vn2(vec2(l.x / 2.6, l.y * 1.7) + float(sd % 53), sd);
    vec3 C = mix(vC.rgb * (0.7 + 0.55 * vD.w) * (0.86 + 0.28 * grain), vC.rgb * (0.5 + 0.3 * vD.w), edge);
    out_(C, al * a);
    return;
  }
  if ( kind == 3 ) {
    // a DUST CLUMP: a lumpy blob, lit top-left, wearing away from its ragged edge as it goes (it shrinks and thins: no holes)
    float ang = atan(o.y, o.x), dis = vC.a;
    float rr = vA.z * (1.0 + 0.36 * (vn2(vec2(cos(ang), sin(ang)) * 1.7 + float(sd % 47), sd) - 0.5)) * (1.0 - 0.6 * dis);
    rr += vA.z * 0.3 * dis * (vn2(o / 0.8 + float(sd % 31), sd + 3) - 0.5);
    float a = cov(length(o) - rr, max(rr, 0.3), 0.0) * (1.0 - 0.45 * dis);
    if ( a <= 0.002 ) discard;
    float t = (o.x + o.y) / max(vA.z, 0.5);
    vec3 C = vC.rgb * mix(1.18, 0.72, smoothstep(-0.8, 0.9, t)) * (0.9 + 0.2 * vn2(o / 0.7, sd + 5));
    out_(C, al * a);
    return;
  }
  discard;
}`;

/* ================================================================== the ground (stage, under tokens) */

export const GROUND_VERT = `${HEAD}
in vec2 aVertexPosition;
in vec2 aCell;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
out vec2 vP;
void main() {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vP = aCell;
}`;

export const GROUND_FRAG = `${HEAD}
in vec2 vP;
uniform vec4 uAxis[40];
uniform vec4 uG;            // storm light (multiply at the core), deck shadow radius (ground), presence (cloud), touch
uniform vec4 uGc;           // the deck's ground centre x, y; its turning phase; the funnel height Z
uniform vec4 uTrack[16];    // the base's last seconds: x, y (ground art px), age 0..1, width
uniform int uSd;
uniform float uAlpha;
out vec4 fragColor;
${TCOMMON}
void main() {
  vec2 c = vP;
  float k = 1.0;
  // storm light under the deck, fading out beyond it (one smooth falloff, two flat steps of the deck's shadow inside)
  vec2 d = c - uGc.xy; d.y /= uView.y;
  float r = length(d) / uG.y;
  if ( r < 1.8 ) {
    float fall = 1.0 - smoothstep(0.55, 1.8, r);
    k *= mix(1.0, uG.x, fall * uG.z);
    float n = fbm2(rot(d, uGc.z) / (40.0 * uU), uSd + 201);
    float rn = r + 0.35 * (n - 0.5), w = 1.2 / uG.y;                   // (the steps' edges soft over ~1.5 art px)
    k *= mix(1.0, 1.0 - 0.12 * sst(0.7 - rn, w) - 0.12 * sst(0.42 - rn, w), uG.z);
  }
  // the funnel's shadow (the light comes from the up-left: it falls down-right of the axis)
  if ( uG.w > 0.001 ) {
    float sd = 1e4;
    for ( int i = 0; i < 40; i += 2 ) {
      vec4 a = uAxis[i];
      vec2 g = vec2(a.x + 0.16 * a.w, a.y + uView.x * a.w + 0.08 * a.w);
      sd = min(sd, length((c - g) * vec2(1.0, 1.0 / uView.y)) - a.z * 0.75);
    }
    k *= mix(1.0, 0.78, uG.w * sst(-sd, 1.2));
  }
  // the scoured track of the last seconds (its ragged edge: one noise per cell, the same for every segment)
  float best = 1e4, rag = 3.0 * uU * (fbm2(c / (6.0 * uU), uSd + 202) - 0.5);
  for ( int i = 0; i < 15; i++ ) {
    vec4 a = uTrack[i], b = uTrack[i + 1];
    if ( a.w <= 0.0 || b.w <= 0.0 ) continue;
    vec2 ab = b.xy - a.xy; float L2 = max(dot(ab, ab), 1e-3);
    float f = clamp(dot(c - a.xy, ab) / L2, 0.0, 1.0);
    vec2 q = a.xy + ab * f;
    float w = mix(a.w, b.w, f) * (1.0 - mix(a.z, b.z, f));
    best = min(best, length((c - q) * vec2(1.0, 1.0 / uView.y)) - w - rag);
  }
  vec3 add = vec3(0.0);
  k *= 1.0 - 0.16 * sst(-best, 1.2);
  k = mix(1.0, k, uAlpha);
  fragColor = vec4(add, k);
}`;

/** The ground's cell pass (weather/cells.mjs): the same cell function, one fragment per art cell of a float texture. */
export const GROUND_CELL_FRAG = GROUND_FRAG.replace("void main() {\n  vec2 c = vP;", "uniform vec2 uCellO;\nvoid main() {\n  vec2 c = uCellO + floor(gl_FragCoord.xy) + 0.5;");

/* ================================================================== show the art texture (stage, above the tokens) */

export const SHOW_FRAG = `${HEAD}
in vec2 vP;
uniform sampler2D uArt;
uniform vec4 uRect;         // the tornado's art rect (absolute art px): the edge fade
uniform vec4 uWin;          // the drawn window: origin x, y (absolute art px), k texels per art px, -
uniform vec2 uWinS;         // its size in texels (the texture is larger: only this frame of it is drawn)
uniform float uAlpha;
out vec4 fragColor;
// the art texture is drawn at about the screen's resolution over the part of the tornado on screen, so it is read about one texel per
// device px (bilinear only between neighbouring texels: never a magnified texture); a smooth fade over the rect's outer 24 art px
void main() {
  vec2 u = vP - uRect.xy;
  if ( u.x < 0.0 || u.y < 0.0 || u.x > uRect.z || u.y > uRect.w ) discard;
  vec2 t = (vP - uWin.xy) * uWin.z;
  if ( t.x < 0.0 || t.y < 0.0 || t.x > uWinS.x || t.y > uWinS.y ) discard;
  vec4 a = texture(uArt, clamp(t, vec2(0.5), uWinS - 0.5) / vec2(textureSize(uArt, 0)));
  float edge = min(min(u.x, u.y), min(uRect.z - u.x, uRect.w - u.y));
  a *= uAlpha * smoothstep(0.0, 24.0, edge);
  if ( a.a <= 0.002 ) discard;
  fragColor = vec4(a.rgb, 1.0 - a.a);
}`;
