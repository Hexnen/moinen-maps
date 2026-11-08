/**
 * GLSL of the TORNADO (research 3.2, revision 5: built in the module). Everything is drawn at ART resolution into a render texture
 * that follows the tornado (its origin on whole art px, so the pixels never crawl), then shown with one quad above the tokens; the
 * ground terms are a separate quad and instanced marks on the ground under the tokens. Every pass is a pure function of (art px,
 * shared clock, the per-frame tables the CPU fills from the stored path): every client draws the same frame.
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
import { GLSL_COMMON } from "./glsl.mjs";

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
vec2 texel() { return floor(vP) + 0.5; }   // (the texel centre, absolute art px: every pass declares vP before this)
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
  vec2 p = texel();
  if ( uMode == 0 || uMode == 2 ) {
    // ---- THE RAIN CURTAIN: sheets standing on rings round the base, wrapping the rear (behind the motion) and the right flank,
    // ragged at the top (under the deck), in strands, with falling streaks. Mode 0 draws the far half (behind everything), mode 2
    // the near half (in front of the funnel and the debris). The foot never ends in a line: the shafts reach down unevenly, thin
    // out in dithered steps and break into spray and mist drifting round with the rotation.
    if ( uCurt.x <= 0.001 ) discard;
    float lift = uView.x, sq = uView.y, dens = 0.0, mist = 0.0;
    // a random (not ordered) dither: rain and spray must never show a regular grid; it changes every 0.1 s (the spray flickers)
    float bay = hu(int(p.x), int(p.y) + 4096 * int(mod(floor(uT * 10.0), 64.0)), uSd + 58);
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
        float sect = 1.0 - smoothstep(1.0, 2.0, abs(rel + 0.55) + 0.7 * (loopN(vec2(ph * 1.3, float(k)), 12.0, 1.1, uSd + 51) - 0.5));
        float strand = fbm2(vec2(p.x / (5.0 * uU), p.y / (60.0 * uU) - uT * 0.4), uSd + 52);
        float top = gy - uCurt.z * (0.6 + 0.4 * fbm2(vec2(p.x / (14.0 * uU), float(k) * 3.1), uSd + 53));
        // the shafts' feet: uneven (some reach the ground, some end above it), moving with the rotation
        float shaft = loopN(vec2(p.x / (9.0 * uU) + float(k) * 4.1, float(k)), 4.0, 1.3, uSd + 56);
        float foot = gy - (2.0 + 16.0 * shaft) * uU, fw = (10.0 + 10.0 * shaft) * uU;
        if ( p.y < top || p.y > foot + fw ) {
          // spray and mist round the foot, drifting with the rotation (both sides of the foot line)
          float dy = p.y - gy;
          if ( abs(dy) < 9.0 * uU ) {
            float mn = drift2(vec2(p.x, p.y / sq), vec2(-26.0 * uU * sign(cos(ph)), 4.0 * uU), uT, 3.0, 7.0 * uU, uSd + 57);
            mist = max(mist, sect * side * (s2 == 1 ? smoothstep(0.45, 0.85, abs(cx)) : 1.0) * smoothstep(0.5, 0.8, mn) * (1.0 - smoothstep(2.0 * uU, 9.0 * uU, abs(dy + 2.0 * uU))));
          }
          continue;
        }
        float v = sect * side * (0.4 + 0.9 * strand) * smoothstep(top, top + 18.0 * uU, p.y) * (1.0 - 0.3 * float(k) / 2.0);
        v *= 1.0 - smoothstep(foot - fw * 0.2, foot + fw, p.y);                       // thinning toward the ground
        if ( s2 == 1 ) v *= 0.55 * smoothstep(0.45, 0.85, abs(cx));                    // the near half: thin, only on the flanks
        dens = max(dens, v);
      }
    }
    dens *= uCurt.x; mist *= uCurt.x;
    float st = hu(int(floor(p.x + 0.33 * p.y)), int(floor((p.y + 170.0 * uT) / (6.0 * uU))), uSd + 54);
    if ( dens <= 0.12 + 0.22 * bay ) {
      // no sheet here: spray / mist only (dithered, faint)
      if ( mist <= 0.25 + 0.6 * bay ) discard;
      float mm = 0.22 + 0.12 * step(0.86, st);
      fragColor = vec4(vec3(0.58, 0.62, 0.68) * mm, mm);
      return;
    }
    float m = dens > 0.66 ? 0.56 : dens > 0.4 ? 0.42 : 0.28;
    vec3 c = vec3(0.36, 0.40, 0.47);
    if ( st > 0.78 ) { c = vec3(0.62, 0.66, 0.72); m += 0.14; }
    fragColor = vec4(c * m, m);
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
  float Dl = deckD(p - vec2(3.0, 3.0) * uU, nf2), Dd = deckD(p + vec2(3.0, 3.0) * uU, nf3);
  float Dh = D + 0.05 * (hc(p, uSd + 60) - 0.5);
  float lev = Dh > 0.8 ? 4.0 : Dh > 0.56 ? 3.0 : Dh > 0.36 ? 2.0 : Dh > 0.2 ? 1.0 : 0.0;
  vec4 deck = vec4(0.0);
  if ( lev > 0.0 ) {
    float dark = uDeck.x;
    float t = 3.4 + 0.45 * (lev - 2.0) - 1.4 * dark + 1.2 * clamp((D - Dl) * 5.0, 0.0, 1.0) - 1.4 * clamp((D - Dd) * 5.0, 0.0, 1.0)
              + 0.9 * (nf - 0.5);
    // lightning: a brief flash lights the lumps of one region from inside
    float fl = uDeck.z;
    if ( fl > 0.01 ) {
      vec2 z = M + vec2(cos(uPh.z), sin(uPh.z) * SQ) * R * 0.4;
      float zone = 1.0 - smoothstep(0.0, R * 0.4, length((p - z) * vec2(1.0, 1.0 / SQ)) + 30.0 * uU * (fbm2(p / (12.0 * uU), uSd + 61) - 0.5));
      t += fl * 3.0 * zone;
    }
    int ti = int(clamp(floor(t), 0.0, 6.0));
    float m = (lev == 1.0 ? 0.34 : lev == 2.0 ? 0.56 : lev == 3.0 ? 0.78 : 0.94) * smoothstep(0.0, 0.3, pr);
    deck = vec4(cloud(ti) * m, m);
  }
  // FEEDER (INFLOW) BANDS: long thin bands of low cloud spiralling in from far out to the wall cloud, scud racing along them, lit on
  // the light side, a dark underside line under each (they hang below the deck: drawn where the deck is thin)
  if ( uDeck.y > 0.001 && deck.a < 0.6 ) {
    float th = atan(d.y, d.x);
    float nb = swirl2(p, C, SQ, -1.4, 0.35 * R, 5.0, 9.0 * uU, uSd + 71);
    float sc = swirl2(p, C, SQ, -2.4, 0.3 * R, 3.0, 3.5 * uU, uSd + 72);
    float ph = 2.0 * (th + uPh.y + 3.4 * log(max(r, 0.05))) + 4.0 * (nb - 0.5);
    float band = pow(0.5 + 0.5 * cos(ph), 5.0), under = pow(0.5 + 0.5 * cos(ph + 0.45), 5.0);
    float reach = smoothstep(0.25, 0.55, r) * (1.0 - smoothstep(1.2, 1.9, r + 0.5 * (nb - 0.5)));
    // they stream in from the flanks and the rear; the near side, over the funnel and its base, stays clear
    reach *= 1.0 - 0.95 * smoothstep(0.05, 0.75, d.y / max(length(d), 1.0) + 0.3 * (nb - 0.5));
    float f = band * (0.75 + 0.5 * sc) * reach, g = under * (0.75 + 0.5 * sc) * reach;
    float pres = uDeck.y * smoothstep(0.2, 0.8, pr), bz = hc(p, uSd + 73);
    if ( f > 0.5 || (f > 0.38 && bz < (f - 0.38) / 0.12) ) {
      float m = (f > 0.85 && sc > 0.55 ? 0.7 : f > 0.62 ? 0.58 : 0.44) * pres;
      vec3 c = f > 0.85 && sc > 0.55 ? cloud(5) : f > 0.62 ? cloud(4) : cloud(3);
      deck = vec4(c * m, m) + deck * (1.0 - m);
    } else if ( g > 0.55 ) {
      float m = 0.36 * pres;
      deck = vec4(cloud(1) * m, m) + deck * (1.0 - m);
    }
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
float bandn(float u, float zs) { return fbm3(vec2(cos(u) * 1.1 + zs / (8.5 * uU), sin(u) * 1.1 + zs / (12.0 * uU)), uSd + 103); }

void main() {
  vec2 p = texel();
  float Z = uCol.x;
  // the height on the axis for this row (the table is monotone in screen y)
  float z = -1e4, cx = 0.0, rc = 0.0, slope = 0.0;
  if ( p.y > uAxis[0].y ) { z = -(p.y - uAxis[0].y) / uView.x; cx = uAxis[0].x; rc = uAxis[0].z; slope = (uAxis[1].x - uAxis[0].x) / max(uAxis[0].y - uAxis[1].y, 0.01); }
  else {
    for ( int k = 0; k < 39; k++ ) {
      vec4 a = uAxis[k], b = uAxis[k + 1];
      if ( p.y <= a.y && p.y > b.y ) {
        float f = (a.y - p.y) / max(a.y - b.y, 0.001);
        z = mix(a.w, b.w, f); cx = mix(a.x, b.x, f); rc = mix(a.z, b.z, f);
        slope = (b.x - a.x) / max(a.y - b.y, 0.01);
        break;
      }
    }
  }
  if ( z < -3.0 * uU || z > Z + 2.0 * uU || z < uCol.y - 2.0 ) discard;
  float zc = clamp(z, 0.0, Z), q = zc / Z;
  float dx = p.x - cx, side = dx >= 0.0 ? 1.0 : -1.0;
  rc *= sqrt(1.0 + clamp(slope, -1.2, 1.2) * clamp(slope, -1.2, 1.2) * (1.0 - 0.7 * smoothstep(0.6, 0.95, q)));
  // the lowering funnel: a tapering tip at the lowest z shown
  rc *= smoothstep(uCol.y - 2.0, uCol.y + 30.0 * uU, zc) * 0.85 + 0.15 * step(uCol.y + 30.0 * uU, zc);
  float rope = uCol.z;
  // the flow deforms the bands (looped noise of angle and height)
  float W0 = uPh.x + 0.020 * zc / uU + 0.85 * sin(zc * 0.027 / uU - uPh.y);
  float warpS = 1.6 * (loopN(vec2(zc / (35.0 * uU) + 0.7 * side, 0.0), 3.3333, 0.7, uSd + 105) - 0.5);
  float ne = bandn(side * 1.5708 + W0 + warpS, zc);
  float footn = loopN(vec2(zc / (4.0 * uU), side * 3.0), 1.6667, 1.1, uSd + 101);
  float fl_n = bil(loopN(p / (7.0 * uU), 3.3333, 1.1, uSd + 108));
  float rce = rc * (1.0 + 0.36 * (ne - 0.5) * (1.0 - 0.6 * smoothstep(0.7, 1.0, q)) + 0.35 * exp(-zc / (10.0 * uU)) * (footn - 0.35)
                    + 0.45 * smoothstep(0.75, 1.0, q) * (fl_n - 0.5));
  // roping out: the funnel breaks into pieces from the bottom up
  if ( rope > 0.0 ) {
    float br = fbm2(vec2(zc / (18.0 * uU), uPh.z * 0.3), uSd + 109);
    if ( br < rope * 1.1 - 0.25 + 0.4 * (1.0 - q) * rope ) discard;
  }
  // the top never ends in a line: the flare frays into the wall cloud at a ragged, moving height, the last of it see-through
  float topN = loopN(vec2(dx / (7.0 * uU), zc / (20.0 * uU)), 3.0, 1.0, uSd + 110);
  float zTop = Z * (0.84 + 0.13 * topN);
  if ( zc > zTop ) discard;
  bool fray = zc > zTop - 0.05 * Z;
  bool inside = abs(dx) < rce && z > -3.0 * uU && z < Z + 2.0 * uU;
  float sn = loopN(vec2(zc / (11.0 * uU) + side * 5.0, 0.0), 2.0, 1.1, uSd + 104);
  bool sheath = !inside && abs(dx) < rce * (1.18 + 0.4 * sn) * (1.0 - 0.6 * rope) && z > 2.0 * uU && z < Z * 0.8;
  if ( !inside && !sheath ) discard;
  float s_ = sqrt(clamp(1.0 - (dx / max(rce, 0.5)) * (dx / max(rce, 0.5)), 0.0, 1.0));
  float zs = zc + rce * uView.y * s_ / uView.x;           // the height of the FRONT surface: bands curve like the near half of a ring
  float th = asin(clamp(dx / max(rce, 0.5), -1.0, 1.0));
  float zw = zs + 8.0 * uU * (loopN(vec2(th * 0.8, zs / (30.0 * uU)), 5.0, 0.8, uSd + 106) - 0.5);
  float warp = 1.6 * (loopN(vec2(zw / (35.0 * uU) + 0.7 * cos(th), 0.7 * sin(th)), 3.3333, 0.7, uSd + 105) - 0.5);
  float n = bandn(th + uPh.x + 0.020 * zw / uU + 0.85 * sin(zw * 0.027 / uU - uPh.y) + warp, zw);
  float u2 = th + uPh.z + 0.012 * zs / uU;
  float mm = fbm2(vec2(cos(u2) * 0.8 + zs / (30.0 * uU), sin(u2) * 0.8 - zs / (38.0 * uU)), uSd + 104);
  float lit = -dx / max(rce, 0.5);
  float fq = smoothstep(0.78, 0.97, q);                    // the flare turns into cloud: lumps, not bands
  float lump = bil(fbm3(rot(vec2(dx, zc * uView.x), uPh.w) / (9.0 * uU), uSd + 107));
  float bands = 0.6 * step(0.56 + 0.2 * (mm - 0.5), n) - 0.9 * step(n, 0.40 + 0.15 * (mm - 0.5)) + 1.0 * step(0.74 + 0.08 * (mm - 0.5), n);
  float tv = 3.2 + 1.7 * lit + 0.8 * (s_ - 0.6) + 0.2 * q + (1.0 - fq) * bands + fq * 1.5 * (lump - 0.5);
  // a dark crease under each bright band (the row above is a band top)
  float zsA = zs + 1.0 / uView.x;
  float nA = bandn(th + uPh.x + 0.020 * zsA / uU + 0.85 * sin(zsA * 0.027 / uU - uPh.y) + warp, zsA);
  bool bt = n > 0.74 + 0.08 * (mm - 0.5) && fq < 0.5;
  if ( !bt && nA > 0.74 + 0.08 * (mm - 0.5) && fq < 0.5 ) tv -= 0.9;
  // roping out: paler, thinner, condensation only
  tv += 0.8 * rope;
  int tone = int(clamp(floor(tv), 0.0, 6.0));
  // dusty low down; the dust's upper edge follows the bands (curved, turning, ragged): never a straight line across the funnel
  float qd = q + 0.16 * (n - 0.5) + 0.06 * (mm - 0.5);
  float dq = clamp(floor((1.0 - smoothstep(0.03, 0.40 + 0.25 * uCol.w, qd)) * 2.99 * min(1.0, uCol.w / 0.6)), 0.0, 2.0);
  vec3 col = ramp(uDust, dq, tone);
  // a 1-px darker outline on the shadow (right) side
  if ( inside && dx > 0.0 && abs(dx + 1.0) >= rce ) col = ramp(uDust, dq, 0);
  bool gap = inside && n < 0.27 + 0.1 * (mm - 0.5) && abs(dx) > rce * 0.55 && q > 0.3 && q < 0.7;
  if ( sheath || gap || fray ) {
    float m = 0.38 * (1.0 - 0.5 * rope);
    vec3 sc = ramp(uDust, dq, int(clamp(float(tone), 2.0, 5.0)));
    fragColor = vec4(sc * m, m);
    return;
  }
  fragColor = vec4(col, 1.0);
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
void main() {
  vec2 p = texel();
  if ( uMode == 0 ) {
    // THE SKIRT: radial jets streaming outward (cross-faded), lopsided toward the throw side and trailing behind the motion, two rolling
    // rings expanding from the foot at each touchdown pulse
    vec2 d = p - uBase.xy - uMot.xy * 6.0 * uU; d.y /= uView.y;
    float rg = length(d), ps = atan(d.y, d.x), Rs = uBase.w;
    if ( rg > Rs * 1.6 || rg < 5.0 * uU ) discard;
    float j = jets(ps + uPh.x, rg, 34.0 * uU, 1.5, uSd + 151);
    float lop = 1.0 + 0.45 * cos(ps - uMot.z) + 0.2 * cos(ps - atan(uMot.y, uMot.x));
    float R = Rs * uMot.w * lop;
    float ring = 0.0;
    for ( int k = 0; k < 2; k++ ) {
      float f = fract(uT / 2.2 + float(k) * 0.5), rr = R * (0.35 + 0.85 * f);
      float w = (3.0 + 6.0 * f) * uU;
      ring = max(ring, (1.0 - smoothstep(0.0, w, abs(rg - rr + 5.0 * uU * (fbm2(vec2(ps * 3.0, float(k) + floor(uT / 2.2 + float(k) * 0.5) * 1.7), uSd + 153) - 0.5)))) * (1.0 - f) * (0.6 + 0.6 * j));
    }
    bool sk = (rg < R * (0.55 + 0.75 * j) && j > 0.46) || ring > 0.45;
    if ( !sk ) discard;
    float m = max(0.12 + 0.48 * (1.0 - clamp(rg / R, 0.0, 1.0)) * smoothstep(0.46, 0.62, j), 0.55 * ring) * uBase.z;
    float dxs = p.x - uBase.x;
    int tone = int(clamp(floor(3.2 + 2.4 * (j - 0.5) - 0.8 * smoothstep(-6.0, 6.0, dxs / uU) + 0.5 * smoothstep(-6.0, -16.0, dxs / uU) + 1.5 * ring), 0.0, 6.0));
    vec3 c = dustR(uDust, tone);
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
in vec2 vP;
uniform vec4 uAxis[40];     // as COLUMN
uniform int uMode;          // 0 the debris cloud round the foot, 1 the wall cloud round the funnel top
uniform int uPass;          // 0 the whole volume (behind the column), 1 only what lies in front of the funnel
uniform vec4 uVol;          // z bottom, z top, presence, outer radius (art px)
uniform vec4 uMot;          // trailing direction x, y (unit, screen), the throw side (rad), touchdown swell
uniform vec4 uPh;           // CPU phases (rad): the arms' turn
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
void main() {
  vec2 p = texel();
  float z0 = uVol.x, z1 = uVol.y, lift = uView.x, sq = uView.y;
  const int N = 18;
  float dz = (z1 - z0) / float(N);
  float j = uMode == 0 ? 0.25 + 0.5 * hc(p, uSd + 340) : 0.4 + 0.2 * hc(p, uSd + 340);   // a fixed per-pixel sample offset: no slab lines
  float T = 1.0, sT = -1.0, sN = 0.5, sF = 0.5, sX = 0.0, sZ = 0.0, sR = 0.0;
  vec2 sD = vec2(0.0);
  bool hit = false;
  if ( uPass == 1 ) {
    // the front pass draws only where the ray meets the funnel: find that first with the axis alone (no density), so a ray that
    // never meets it is discarded before any noise (the same samples and test as the march below: the same pixels)
    bool meets = false;
    for ( int k = 0; k < N; k++ ) {
      float z = z1 - (float(k) + j) * dz;
      vec3 A = axisG(z);
      vec2 d = vec2(p.x - A.x, (p.y + lift * z - A.y) / sq);
      if ( length(d) < A.z * 0.9 && z < uAxis[39].w * (uMode == 1 ? 0.84 : 1.0) && z > -2.0 ) { meets = true; break; }
    }
    if ( !meets ) discard;
  }
  for ( int k = 0; k < N; k++ ) {
    float z = z1 - (float(k) + j) * dz;
    vec3 A = axisG(z);
    vec2 d = vec2(p.x - A.x, (p.y + lift * z - A.y) / sq);
    float r = length(d);
    // the funnel (only where it exists: below its top, above the ground)
    // (the funnel frays out at 0.84..0.97 Z: above 0.84 Z the wall cloud fills its place)
    if ( r < A.z * 0.9 && z < uAxis[39].w * (uMode == 1 ? 0.84 : 1.0) && z > -2.0 ) { hit = true; if ( uPass == 1 ) break; continue; }
    float n;
    float D = dens(d, z, A.z, n);
    float a = clamp((D - 0.42) * 2.6, 0.0, 1.0) * (uMode == 0 ? 0.55 : 0.6);
    if ( a <= 0.0 ) continue;
    if ( sT < 0.0 && 1.0 - T * (1.0 - a) > 0.45 ) { sT = D; sN = n; sF = gNf; sD = d; sZ = z; sR = A.z; }
    T *= 1.0 - a;
    if ( T < 0.04 ) break;
  }
  if ( uPass == 1 && !hit ) discard;
  float cov = 1.0 - T;
  if ( cov < 0.2 || sT < 0.0 ) discard;
  // the surface's light: thinner toward the light (up-left on screen, and up) is lit, thicker toward it is in shadow
  vec2 Ld = vec2(-0.62, -0.62 / sq) * 4.0 * uU;
  float nl;
  float Dl = dens(sD + Ld, sZ + 3.0 * uU, sR, nl);
  float lit = clamp((sT - Dl) * 2.2, -1.0, 1.0);
  float r = length(sD), zn = (sZ - z0) / (z1 - z0);
  float side = -(sD.x + sD.y) / max(r, 0.01) * 0.7;           // the up-left half of the cloud faces the light
  vec3 col;
  if ( uMode == 0 ) {
    float tv = 3.4 + 2.4 * lit + 0.9 * side + 1.6 * (zn - 0.35) + 2.0 * (sN - 0.5) + 1.0 * (sF - 0.5) - 1.0 * smoothstep(0.9, 0.0, (r - sR) / max(uVol.w * 0.4, 1.0));
    int tone = int(clamp(floor(tv), 0.0, 6.0));
    float q = 1.9 - 1.0 * smoothstep(0.2, 0.9, zn) - 0.4 * step(4.5, tv);          // the dirt low down, greying into the storm higher up
    col = ramp(uDust, q, tone);
  } else {
    // striations: stacked rings of the turning cloud (the rotation reads from them), warped by the noise
    float stri = sin((sZ + 7.0 * uU * (sN - 0.5)) / (2.2 * uU));
    float tv = 2.4 + 1.6 * lit + 0.9 * side + 1.4 * (zn - 0.3) + 1.2 * (sN - 0.5) + 0.9 * (sF - 0.5) + 0.8 * stri;
    int ti = int(clamp(floor(tv), 0.0, 6.0));
    col = mix(grey(ti), grey(min(ti + 1, 6)) * vec3(0.98, 1.0, 1.04), smoothstep(0.55, 0.9, zn));
  }
  float m = cov > 0.8 ? 1.0 : cov > 0.55 ? 0.82 : cov > 0.35 ? 0.62 : 0.42;
  fragColor = vec4(col * m, m);
}`;

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
// the dissolve threshold of an art px: hashed (a regular ordered dither would show a grid)
float bayerP(vec2 p) { return hu(int(floor(p.x)) + 911, int(floor(p.y)) + 577, 4243); }
void out_(vec3 c, float a) {
  if ( a <= 0.002 ) discard;
  fragColor = uStage == 1 ? vec4(c * a, 1.0 - a) : vec4(c * a, a);
}
// an irregular chunk (3-6 corners, aspect 0.55-1) of radius rr, from its seed: is the cell centre q inside?
bool chunkIn(vec2 q, int sd, float rr) {
  int n = 3 + int(pow(hu(sd, 2, 801), 1.3) * 4.0);
  float asp = 0.55 + 0.45 * hu(sd, 3, 801);
  bool fl = hu(sd, 4, 801) < 0.5;
  vec2 rad = vec2(rr * (fl ? asp : 1.0), rr * (fl ? 1.0 : asp)) * (n == 3 ? 1.4 : 1.2);
  float a0 = hu(sd, 5, 801) * 6.283;
  bool c = false;
  vec2 pj = vec2(0.0);
  for ( int i = 0; i <= 6; i++ ) {
    int ii = i == n ? 0 : i;
    float a = a0 + (float(ii) + (hu(sd, ii, 802) - 0.5) * 0.55) / float(n) * 6.283, r = 0.6 + 0.5 * hu(sd, ii, 803);
    vec2 pi = vec2(cos(a), sin(a)) * rad * r;
    if ( i > 0 && ((pi.y > q.y) != (pj.y > q.y)) && q.x < (pj.x - pi.x) * (q.y - pi.y) / (pj.y - pi.y) + pi.x ) c = !c;
    pj = pi;
    if ( i == n ) break;
  }
  return c;
}
vec3 mapAt(vec2 a) {
  if ( uHasMap == 0 ) return vec3(0.45, 0.4, 0.35);
  vec2 sc = uOrigin.xy + (a + 0.5) * uOrigin.z;
  return texture(uMap, (sc - uMapRect.xy) / uMapRect.zw).rgb;
}
// the chunk cell under screen texel p (rotated back into the chunk's frame, rounded to whole cells as the mock-up's lookup)
vec2 cellOf(vec2 p) { vec2 o = p - vA.xy; float c = cos(-vB.x), s = sin(-vB.x); return floor(vec2(c * o.x - s * o.y, s * o.x + c * o.y) + 0.5); }
// ... with the chunk's local y foreshortened by fa (it is tilted about its local x axis)
vec2 cellT(vec2 p, float fa) { vec2 o = p - vA.xy; float c = cos(-vB.x), s = sin(-vB.x); vec2 l = vec2(c * o.x - s * o.y, s * o.x + c * o.y); return floor(vec2(l.x, l.y / fa) + 0.5); }

void main() {
  vec2 p = floor(vP) + 0.5;
  int kind = int(vB.y + 0.5), sd = int(vB.z);
  float al = vB.w;
  vec2 o = p - vA.xy;
  float c = cos(-vB.x), s = sin(-vB.x);
  vec2 l = vec2(c * o.x - s * o.y, s * o.x + c * o.y);
  if ( kind == 0 || kind == 10 ) {
    // a 1-px streak along its velocity (local x), brighter at the head, fading toward the tail
    float w = 0.5 * (abs(cos(vB.x)) + abs(sin(vB.x)));
    if ( abs(l.y) > w * (vA.w * 2.0) || abs(l.x) > vA.z + 0.5 ) discard;
    float f = vA.z > 0.6 ? (l.x + vA.z) / (2.0 * vA.z) : 1.0;
    out_(vC.rgb * (0.82 + 0.25 * f), al * (kind == 10 ? f : mix(0.45, 1.0, f)));
    return;
  }
  if ( kind == 1 || kind == 12 ) {
    // a MAP FRAGMENT: a slab of the map's own pixels torn out, TUMBLING (foreshortened across its local y by |fc|, its earthy
    // underside showing when fc < 0), lit by how its face turns to the light, with its thickness showing under it (no outline);
    // or (12) the hole it left in the ground
    float rr = vD.w, fa = kind == 12 ? 1.0 : max(abs(vC.r), 0.16);
    vec2 q = cellT(p, fa);
    bool m = chunkIn(q + 0.5, sd, rr) && bayerP(p) >= vC.a;
    if ( kind == 12 ) {
      // the scar: dark torn earth, a rim of lighter crumbs where it broke
      if ( m ) {
        bool rim = false;
        for ( int k = 0; k < 4; k++ ) { vec2 d = k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(-1.0, 0.0) : k == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0); if ( !chunkIn(cellT(p + d, 1.0) + 0.5, sd, rr) ) { rim = true; break; } }
        float hh = hu(int(q.x) + 7, int(q.y) + 9, sd);
        vec3 e = rim ? vec3(0.42, 0.34, 0.25) : hh > 0.8 ? vec3(0.24, 0.18, 0.12) : vec3(0.15, 0.11, 0.08);
        out_(e, al * (rim ? 0.55 : 0.8));
      } else discard;
      return;
    }
    if ( !m ) {
      // the slab's near edge (its thickness), seen below the face
      float th = max(1.0, vC.b * (0.35 + 0.65 * sqrt(max(0.0, 1.0 - vC.r * vC.r))));
      for ( int t = 1; t <= 4; t++ ) {
        if ( float(t) > th + 0.5 ) break;
        vec2 q2 = cellT(p - vec2(0.0, float(t)), fa);
        if ( chunkIn(q2 + 0.5, sd, rr) && bayerP(p) >= vC.a ) {
          vec3 e = vec3(0.30, 0.23, 0.16) * (1.0 - 0.18 * float(t - 1)) * (0.7 + 0.35 * vC.g);
          out_(e, al);
          return;
        }
      }
      discard;
    }
    vec3 C;
    if ( vC.r >= 0.0 ) C = mapAt(vD.xy + q);
    else {
      // the underside: packed earth, broad patches, a few clods and roots
      float hh = hu(int(floor(q.x / 3.0)) + 3, int(floor(q.y / 3.0)) + 5, sd + 1), hc_ = hu(int(q.x) + 3, int(q.y) + 5, sd + 2);
      C = mix(vec3(0.42, 0.32, 0.22), vec3(0.50, 0.40, 0.28), step(0.6, hh));
      if ( hc_ > 0.93 ) C = vec3(0.30, 0.22, 0.15);
    }
    C *= 0.55 + 0.6 * vC.g;
    vec2 qu = cellT(p - vec2(0.0, 1.0), fa), ql = cellT(p - vec2(1.0, 0.0), fa), qd = cellT(p + vec2(0.0, 1.0), fa), qr = cellT(p + vec2(1.0, 0.0), fa);
    bool Lt = !chunkIn(qu + 0.5, sd, rr) || !chunkIn(ql + 0.5, sd, rr);
    bool Dk = !chunkIn(qd + 0.5, sd, rr) || !chunkIn(qr + 0.5, sd, rr);
    if ( Lt && !Dk ) C = clamp(C * 1.22 + 0.04, 0.0, 1.0);
    if ( Dk && !Lt ) C *= 0.78;
    out_(C, al);
    return;
  }
  if ( kind == 2 ) {
    // a PLANK: a thin board, outlined, flashing as it turns (extra = the light on its face)
    if ( abs(l.x) > vA.z + 0.5 || abs(l.y) > vA.w + 0.5 ) discard;
    bool edge = abs(l.x) > vA.z - 0.5 || abs(l.y) > vA.w - 0.5;
    vec3 C = edge ? vC.rgb * (0.5 + 0.3 * vD.w) : vC.rgb * (0.7 + 0.55 * vD.w);
    out_(C, al);
    return;
  }
  if ( kind == 3 ) {
    // a DUST CLUMP: a lumpy blob, lit top-left, dissolving pixel by pixel as it goes
    if ( dot(o, o) > vA.z * vA.z + 0.3 ) discard;
    if ( hu(int(floor(o.x)) + 20, int(floor(o.y)) + 20, sd) < vC.a ) discard;
    float t = o.x + o.y;
    vec3 C = vC.rgb * (t < -0.5 ? 1.18 : t > vA.z * 0.7 ? 0.72 : 1.0);
    out_(C, al);
    return;
  }
  if ( kind == 11 ) {
    // a CHUNK SHADOW on the ground (its distance below the chunk shows the height)
    vec2 e = o / max(vA.zw, vec2(0.5));
    if ( dot(e, e) > 1.0 ) discard;
    out_(vec3(0.0), al * 0.4);
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
  vec2 c = floor(vP) + 0.5;
  float k = 1.0;
  // storm light under the deck, fading out beyond it (one smooth falloff, two flat steps of the deck's shadow inside)
  vec2 d = c - uGc.xy; d.y /= uView.y;
  float r = length(d) / uG.y;
  if ( r < 1.8 ) {
    float fall = 1.0 - smoothstep(0.55, 1.8, r);
    k *= mix(1.0, uG.x, fall * uG.z);
    float n = fbm2(rot(d, uGc.z) / (40.0 * uU), uSd + 201);
    float lv = step(r + 0.35 * (n - 0.5), 0.7) + step(r + 0.35 * (n - 0.5), 0.42);
    k *= mix(1.0, lv > 1.5 ? 0.76 : lv > 0.5 ? 0.88 : 1.0, uG.z);
  }
  // the funnel's shadow (the light comes from the up-left: it falls down-right of the axis)
  if ( uG.w > 0.001 ) {
    float sd = 1e4;
    for ( int i = 0; i < 40; i += 2 ) {
      vec4 a = uAxis[i];
      vec2 g = vec2(a.x + 0.16 * a.w, a.y + uView.x * a.w + 0.08 * a.w);
      sd = min(sd, length((c - g) * vec2(1.0, 1.0 / uView.y)) - a.z * 0.75);
    }
    if ( sd < 0.0 ) k *= mix(1.0, 0.78, uG.w);
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
  if ( best < 0.0 ) k *= 0.84;
  k = mix(1.0, k, uAlpha);
  fragColor = vec4(add, k);
}`;

/** The ground's cell pass (weather/cells.mjs): the same cell function, one fragment per art cell of a float texture. */
export const GROUND_CELL_FRAG = GROUND_FRAG.replace("void main() {\n  vec2 c = floor(vP) + 0.5;", "uniform vec2 uCellO;\nvoid main() {\n  vec2 c = uCellO + floor(gl_FragCoord.xy) + 0.5;");

/* ================================================================== show the art texture (stage, above the tokens) */

export const SHOW_FRAG = `${HEAD}
in vec2 vP;
uniform sampler2D uArt;
uniform vec4 uRect;
uniform float uAlpha;
out vec4 fragColor;
void main() {
  ivec2 q = ivec2(floor(vP - uRect.xy));
  if ( q.x < 0 || q.y < 0 || q.x >= int(uRect.z) || q.y >= int(uRect.w) ) discard;
  vec4 a = texelFetch(uArt, q, 0) * uAlpha;
  float edge = float(min(min(q.x, q.y), min(int(uRect.z) - 1 - q.x, int(uRect.w) - 1 - q.y)));
  if ( edge < 24.0 && (edge + 0.5) / 24.0 < 0.0 + fract(52.9829189 * fract(0.06711056 * float(q.x) + 0.00583715 * float(q.y))) ) discard;
  if ( a.a <= 0.002 ) discard;
  fragColor = vec4(a.rgb, 1.0 - a.a);
}`;
