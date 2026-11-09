/**
 * GLSL of the PARTICLE passes (snow flakes, sand grit, dust motes, ember sparks) and the HAZE pass (sand haze, dust haze, ember
 * smoke): every instance and every haze cell is a pure function of (art cell or slot, shared time), the same convention as the rain
 * (glsl.mjs): world tiles of slots indexed by gl_InstanceID, whole cycles per hour, hashed birth gates, the oblique lift.
 * Ported from the research mock-ups (snow.py, sand.py, dust.py, embers.py); every pass writes (add, k) for the weather blend.
 */
import { GLSL_COMMON, GLSL_SHAPES } from "./glsl.mjs";

export const PART_VERT = `#version 300 es
precision highp float;
precision highp int;
in vec2 aVertexPosition;
in vec2 aCorner;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform vec2 uScreen;
uniform float uTime;
uniform int uKind;           // 1 snow, 2 grit, 3 dust, 4 embers, 5 wind (lines, debris)
uniform vec4 uTiles;         // first tile x, y; tiles across, down
uniform float uTileSz;       // art px per tile (embers: the source cell)
uniform vec4 uPer;           // slots per tile per layer (snow: mid, far, near, spindrift)
uniform vec4 uDens;          // live slots per tile per layer (fractional)
uniform vec4 uDensR[12];     // per layer: the density then / now at ages 0..10 s ([11]: the largest), exactly 1 when steady (D7); embers .w: the big-spark share then
uniform vec4 uOrigin;        // scene rect x, y; art px (scene px); art cells per grid square
uniform vec2 uWindDir;       // unit (sand: the sand's direction)
uniform vec2 uWindK;         // art px / s at factor 1 (this kind's speed), gust amount
uniform vec2 uView;          // lift, squash
uniform vec4 uVF;            // snow: fall speeds mid, far, near; grit: hop, length; embers: swarm floor, big sparks; wind: line gate, line length, bob
uniform float uI;            // presence x performance
uniform float uPx;           // art px per device px now (the quads' antialiasing margin)
out vec2 vArt;
out vec2 vScr;
flat out vec4 vA;
flat out vec4 vB;
flat out ivec2 vK;
flat out float vFade;
${GLSL_COMMON}

void hide() { gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); vArt = vec2(0.0); vScr = vec2(0.0); vA = vec4(0.0); vB = vec4(0.0); vK = ivec2(0); vFade = 0.0; }
// D7: a slot is gated by the density at its BIRTH (a strength ramp turns no particle on or off mid-life); one born denser than now
// fades with the ratio (rB), so a falling density thins the air smoothly. Steady: every ratio is exactly 1 (the same gates, alpha)
vec4 agoR(float tau) { float a = clamp(tau, 0.0, 9.999); int i = int(a); return uDensR[i] + (uDensR[i + 1] - uDensR[i]) * (a - float(i)); }
float rB = 1.0;
float bornDens(float dens, int layer, float tau) { vec4 r = agoR(tau); rB = layer == 0 ? r.x : layer == 1 ? r.y : layer == 2 ? r.z : r.w; return dens * rB; }
float gateOf(int j, float dens, int key, int ty, int ci, int sd) {
  if ( float(j) >= ceil(dens) ) return 0.0;
  float g = float(j) < floor(dens) ? 1.0 : fract(dens);
  return hu(key, ty * 53 + ci, sd + 8) < g ? 1.0 : 0.0;
}
// one slot's life: kc0 .. kc0 + kcr cycles per hour (whole cycles: seamless at the hour wrap); returns tau, sets life and cycle
float lifeOf(int key, int tx, int ty, int j, int sd, float kc0, float kcr, out float life, out int ci) {
  float kc = kc0 + floor(hu(key, ty, sd) * kcr);
  life = 3600.0 / kc;
  float u = (uTime + hu(tx, ty * 64 + j, sd + 1) * life) / life;
  ci = int(mod(floor(u), kc));
  return fract(u) * life;
}
vec2 windAt(vec2 g, float lag) {
  float G = gustAt(g / uOrigin.w, uWindDir, uTime - lag, uSeed);
  return uWindDir * uWindK.x * windFactor(G, uWindK.y) + 0.6 * vortexAt(g);
}

void main() {
  int per = int(uPer.x + uPer.y + uPer.z + uPer.w);
  int i = gl_InstanceID, tile = i / per, k = i - tile * per;
  int ntx = int(uTiles.z);
  int tx = int(uTiles.x) + tile % ntx, ty = int(uTiles.y) + tile / ntx;
  int layer = k < int(uPer.x) ? 0 : k < int(uPer.x + uPer.y) ? 1 : k < int(uPer.x + uPer.y + uPer.z) ? 2 : 3;
  int j = layer == 0 ? k : layer == 1 ? k - int(uPer.x) : layer == 2 ? k - int(uPer.x + uPer.y) : k - int(uPer.x + uPer.y + uPer.z);
  float dens = layer == 0 ? uDens.x : layer == 1 ? uDens.y : layer == 2 ? uDens.z : uDens.w;
  int sd = uSeed * 7 + uKind * 101 + layer * 13;
  int key = tx * 64 + j;
  float TS = uTileSz, lift = uView.x;
  float life; int ci;
  vec2 lo, hi;
  vFade = 1.0;
  vK = ivec2(uKind, layer);
  // the antialiasing margin round a particle's shape: a shape reaches at most a device px past its edge (cov: half a px of widening,
  // half a px of soft edge); each kind adds its own reach (radius + soft edge + offset) below, so the quads stay tight at any zoom
  float M_ = 1.2 * uPx + 0.2;
  if ( uKind == 1 && layer < 3 ) {
    // SNOW flakes: 2 .. 3.3 s lives, falling with sway and a swirl, carried by the wind (lag 0.6 s)
    float tau = lifeOf(key, tx, ty, j, sd, 1080.0, 721.0, life, ci);
    if ( gateOf(j, bornDens(dens, layer, tau), key, ty, ci, sd) < 0.5 ) { hide(); return; }
    float h0 = hu(key, ty * 977 + ci, sd + 2), h1 = hu(key, ty * 977 + ci, sd + 3), h2 = hu(key, ty * 977 + ci, sd + 4);
    float h3 = hu(key, ty * 977 + ci, sd + 5), h4 = hu(key, ty * 977 + ci, sd + 6), h5 = hu(key, ty * 977 + ci, sd + 7);
    vec2 g = (vec2(float(tx), float(ty)) + vec2(h0, h1)) * TS;
    if ( g.x < 0.0 || g.y < 0.0 || g.x >= uArtSize.x || g.y >= uArtSize.y || openAt(g, false) < 0.5 ) { hide(); return; }
    float vf = (layer == 0 ? uVF.x : layer == 1 ? uVF.y : uVF.z) * (0.75 + 0.5 * h2);
    float z0 = vf * life * 0.95, z = z0 - vf * tau;
    if ( z <= 0.0 ) { hide(); return; }
    float rem = z / vf;
    float G = gustAt(g / uOrigin.w, uWindDir, uTime - 0.6, uSeed);
    vec2 W = uWindDir * uWindK.x * windFactor(G, uWindK.y) + 0.6 * vortexAt(g);
    float A = 2.0 + 5.0 * h3, fq = 0.3 + 0.5 * h4;
    float sway = A * sin(6.283185 * fq * tau + 6.28 * h5);
    float sw = 5.0 * sin(g.y / 23.0 + 6.283185 * uTime / 5.0 + g.x / 61.0) * (0.4 + clamp(G, 0.0, 1.2));
    float X = g.x - W.x * rem * (0.85 + 0.3 * h3) + sway + sw;
    float Yg = g.y - W.y * rem + 0.35 * sway * cos(6.283185 * fq * tau);
    float Y = Yg - lift * z;
    vFade = min(1.0, tau / 0.3) * min(1.0, rem / 0.25);
    vA = vec4(X, Y, X, Yg); vB = vec4(h4, h5, z, 0.0);
    float rr = layer == 2 ? 3.1 : 1.2, ys = layer == 0 && z < 26.0 ? Yg : Y;   // (the shadow only while it shows: low flakes)
    lo = vec2(X, min(Y, ys)) - M_ - rr; hi = vec2(X, max(Y, ys)) + M_ + rr;
  } else if ( uKind == 1 ) {
    // SPINDRIFT: snow blown along the ground in strong gusts, thin low runs
    float tau = lifeOf(key, tx, ty, j, sd, 2160.0, 1441.0, life, ci);
    if ( gateOf(j, bornDens(dens, layer, tau), key, ty, ci, sd) < 0.5 || tau >= 0.9 ) { hide(); return; }
    vec2 g = (vec2(float(tx), float(ty)) + vec2(hu(key, ty * 7 + ci, sd + 2), hu(key, ty * 7 + ci, sd + 3))) * TS;
    float G = gustAt(g / uOrigin.w, uWindDir, uTime - 0.2, uSeed);
    if ( G <= 0.45 || openAt(g, true) < 0.5 ) { hide(); return; }
    vec2 W = uWindDir * uWindK.x * windFactor(G, uWindK.y) + 0.6 * vortexAt(g);
    vec2 p1 = g + W * 2.2 * tau + vec2(0.0, sin(tau * 7.0 + float(j)) * 1.5 - lift);
    float ln = 4.0 + 6.0 * min(G, 1.2);
    vec2 p0 = p1 - uWindDir * ln;
    vFade = min(1.0, tau / 0.15) * min(1.0, (0.9 - tau) / 0.2);
    vA = vec4(p0, p1); vB = vec4(0.0);
    lo = min(p0, p1) - M_ - 0.6; hi = max(p0, p1) + M_ + 0.6;
  } else if ( uKind == 2 ) {
    // GRIT: sand hopping along the ground (saltation), fast, in the waves
    float tau = lifeOf(key, tx, ty, j, sd, 4320.0, 3241.0, life, ci);
    if ( gateOf(j, bornDens(dens, layer, tau), key, ty, ci, sd) < 0.5 ) { hide(); return; }
    float h0 = hu(key, ty * 977 + ci, sd + 2), h1 = hu(key, ty * 977 + ci, sd + 3), h2 = hu(key, ty * 977 + ci, sd + 4);
    float h3 = hu(key, ty * 977 + ci, sd + 5), h4 = hu(key, ty * 977 + ci, sd + 6);
    vec2 s = (vec2(float(tx), float(ty)) + vec2(h0, h1)) * TS;
    float fr = clamp(gustAt(s / uOrigin.w, uWindDir, uTime - tau, uSeed), 0.0, 1.2);
    if ( h2 >= (0.25 + 0.75 * fr) * min(1.0, uI) ) { hide(); return; }
    float spd = uWindK.x * (1.2 + 0.8 * h3) * (0.5 + 0.8 * fr);
    vec2 X = s + uWindDir * spd * tau;
    if ( X.x < 0.0 || X.y < 0.0 || X.x >= uArtSize.x || X.y >= uArtSize.y || openAt(X, true) < 0.5 ) { hide(); return; }
    float hop = uVF.x * abs(sin(tau * (5.0 + 4.0 * h4) + h3 * 6.28)) * h4;
    vec2 p1 = X - vec2(0.0, lift * (1.0 + hop));
    vec2 p0 = p1 - uWindDir * (2.0 + uVF.y * fr);
    vFade = min(1.0, tau / 0.06) * min(1.0, (life - tau) / 0.06);
    vA = vec4(p0, p1); vB = vec4(0.0);
    lo = min(p0, p1) - M_ - 0.6; hi = max(p0, p1) + M_ + 0.6;
  } else if ( uKind == 3 ) {
    // DUST motes: 5 .. 10 s lives, slow Brownian drift in calm air, glinting in the sun shafts
    float tau = lifeOf(key, tx, ty, j, sd, 360.0, 361.0, life, ci);
    if ( gateOf(j, bornDens(dens, layer, tau), key, ty, ci, sd) < 0.5 ) { hide(); return; }
    float h[9];
    for ( int q = 0; q < 9; q++ ) h[q] = hu(key, ty * 977 + ci, sd + 2 + q);
    vec2 s = (vec2(float(tx), float(ty)) + vec2(h[0], h[1])) * TS;
    float z = 6.0 + 50.0 * h[2], T6 = tau * 6.28;
    float bx = 4.0 * sin(T6 * (0.07 + 0.06 * h[3]) + h[4] * 6.28) + 2.0 * sin(T6 * (0.19 + 0.12 * h[5]) + h[6] * 6.28) + 0.6 * sin(T6 * (0.5 + 0.2 * h[7]) + h[7] * 6.28);
    float by = 3.0 * sin(T6 * (0.06 + 0.05 * h[5]) + h[7] * 6.28) + 1.6 * sin(T6 * (0.17 + 0.1 * h[3]) + h[8] * 6.28);
    float bz = 3.0 * sin(T6 * (0.08 + 0.06 * h[8]) + h[4] * 6.28);
    vec2 g = s + uWindDir * uWindK.x * tau + vec2(bx, by);
    if ( g.x < 0.0 || g.y < 0.0 || g.x >= uArtSize.x || g.y >= uArtSize.y || openAt(g, true) < 0.5 ) { hide(); return; }
    vec2 P = g - vec2(0.0, lift * (z + bz));
    float age = tau / life;
    vFade = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.8, 1.0, age));
    float lit = smoothstep(0.55, 0.7, shaftAt(P));
    float tw = 0.5 + 0.5 * sin(6.283185 * (0.25 + 0.5 * h[3]) * uTime + 6.28 * h[4]);
    vA = vec4(P, 0.0, 0.0); vB = vec4(lit * smoothstep(0.55, 0.85, tw), h[6] > 0.93 ? 1.0 : 0.0, 0.0, 0.0);
    float rr = vB.y > 0.5 ? 2.5 : vB.x > 0.001 ? 2.35 : 1.2;        // (near: out of focus; lit: its glow; else the speck alone)
    lo = P - M_ - rr; hi = P + M_ + rr;
  } else if ( uKind == 5 && layer == 0 ) {
    // WIND LINES: in a gust, a light 1-px stroke runs downwind from its slot, curving (two sines), drawn over the last 0.45-0.75 s
    // of its path; it grows from its start and in its last half retracts from the tail, the head fading last. Only where the gust at its birth is strong enough.
    float tau = lifeOf(key, tx, ty, j, sd, 1440.0, 961.0, life, ci);
    if ( gateOf(j, bornDens(dens, layer, tau), key, ty, ci, sd) < 0.5 ) { hide(); return; }
    float h[6];
    for ( int q = 0; q < 6; q++ ) h[q] = hu(key, ty * 977 + ci, sd + 2 + q);
    float ll = 0.7 + 0.5 * h[2];
    if ( tau >= ll ) { hide(); return; }
    vec2 s = (vec2(float(tx), float(ty)) + vec2(h[0], h[1])) * TS;
    float G = gustAt(s / uOrigin.w, uWindDir, uTime - tau, uSeed);
    if ( G <= 0.42 + 0.3 * h[3] + uVF.x || s.x < 0.0 || s.y < 0.0 || s.x >= uArtSize.x || s.y >= uArtSize.y || openAt(s, false) < 0.5 ) { hide(); return; }
    float v = 1.6 * uWindK.x * windFactor(clamp(G, 0.0, 1.2), uWindK.y);     // the air itself: faster than what it carries
    float b = v * tau, a = v * max(tau - (0.45 + 0.30 * h[4]) * uVF.y, 0.0);
    if ( b - a < 1.0 ) { hide(); return; }
    vec2 S = s - vec2(0.0, lift * (10.0 + 14.0 * h[4]));
    vA = vec4(S, a, b); vB = vec4(h[2] * 6.28 + tau * 2.0, h[3] * 6.28, tau / ll, 0.0);
    vec2 P0 = S + uWindDir * a, P1 = S + uWindDir * b;
    lo = min(P0, P1) - 6.9 - M_; hi = max(P0, P1) + 6.9 + M_;
  } else if ( uKind == 5 ) {
    // DEBRIS: leaves and bits tumbling with the wind, bouncing more in the gusts, flipping (light / dark side), each with its ground
    // shadow; anchored at mid-life like the sparks, so they come in from upwind and from everywhere, born and gone by pixel dropout
    float tau = lifeOf(key, tx, ty, j, sd, 1200.0, 1201.0, life, ci);
    if ( gateOf(j, bornDens(dens, layer, tau), key, ty, ci, sd) < 0.5 ) { hide(); return; }
    float h[8];
    for ( int q = 0; q < 8; q++ ) h[q] = hu(key, ty * 977 + ci, sd + 2 + q);
    float age = tau / life;
    if ( hu(key, int(floor(uTime * 12.0)), sd + 21) <= smoothstep(0.75, 1.0, age) ) { hide(); return; }
    if ( hu(key, int(floor(uTime * 12.0)), sd + 22) >= smoothstep(0.0, 0.12, age) ) { hide(); return; }
    vec2 a0 = (vec2(float(tx), float(ty)) + vec2(h[0], h[1])) * TS;
    float Gm = clamp(gustAt(a0 / uOrigin.w, uWindDir, uTime - tau + 0.5 * life, uSeed), 0.0, 1.2);
    float v = uWindK.x * windFactor(Gm, uWindK.y) * (0.7 + 0.5 * h[2]);
    vec2 WN = vec2(-uWindDir.y, uWindDir.x);
    vec2 Xg = a0 + uWindDir * v * (tau - 0.5 * life) + WN * 6.0 * sin(tau * (0.8 + h[6]) + h[3] * 6.28);
    if ( Xg.x < 0.0 || Xg.y < 0.0 || Xg.x >= uArtSize.x || Xg.y >= uArtSize.y || openAt(Xg, true) < 0.5 ) { hide(); return; }
    float bob = uVF.z * abs(sin(tau * (1.5 + 2.0 * h[3]) + h[4] * 6.28)) * (0.4 + Gm);
    vec2 P = Xg - vec2(0.0, lift * (2.0 + bob + 8.0 * h[5]));
    // (it flips: the side seen is the sign of this sine, its width its size; it turns slowly in the plane of the screen)
    float flip = sin(tau * (9.0 + 8.0 * h[2]) + h[6] * 6.28), spin = h[4] * 6.28 + tau * (1.5 + 2.5 * h[3]) * (h[2] > 0.5 ? 1.0 : -1.0);
    vA = vec4(P, Xg); vB = vec4(floor(h[7] * 5.99), flip, h[5] > 0.8 ? 2.0 : h[5] > 0.35 ? 1.0 : 0.0, spin);
    lo = min(P, Xg) - M_ - 1.35; hi = max(P, Xg) + M_ + 1.35;
  } else {
    // EMBERS: a wind-borne field. Every slot's spark crosses its tile in the middle of its life, blown along the wind with a sway,
    // so sparks come in from upwind and from everywhere in view and drift through; swarms (a slow patchy field drifting with the
    // wind x the travelling gust fronts) decide which slots carry a spark this cycle (fixed per cycle: no pop mid-flight). Born and
    // gone by pixel dropout, cooling through the ember ramp.
    float tau = lifeOf(key, tx, ty, j, sd, 1080.0, 1081.0, life, ci);
    float h[9];
    for ( int q = 0; q < 9; q++ ) h[q] = hu(key, ty * 977 + ci, sd + 2 + q);
    vec2 a0 = (vec2(float(tx), float(ty)) + vec2(h[0], h[1])) * TS;
    // (the cheap tests first: the density gate and the dropout; the swarm and gust fields only for the slots left)
    if ( gateOf(j, bornDens(dens, layer, tau), key, ty, ci, sd) < 0.5 ) { hide(); return; }
    float age = tau / life;
    if ( hu(key, int(floor(uTime * 15.0)), sd + 21) <= smoothstep(0.7, 1.0, age) ) { hide(); return; }    // dies by pixel dropout
    if ( hu(key, int(floor(uTime * 15.0)), sd + 22) >= smoothstep(0.0, 0.15, age) ) { hide(); return; }   // and is born the same way
    float tm = uTime - tau + 0.5 * life;
    float Gm = clamp(gustAt(a0 / uOrigin.w, uWindDir, tm, uSeed), 0.0, 1.2);
    float sw = drift2a(a0 / 170.0, uWindDir * uWindK.x / 170.0, tm, 60.0, uSeed + 170);
    float pr = uVF.x + (1.0 - uVF.x) * clamp(1.6 * smoothstep(0.3, 0.7, sw) * (0.25 + 0.75 * Gm), 0.0, 1.0);
    if ( h[2] >= pr ) { hide(); return; }
    // depth, continuous 0 (far, dim) .. 1 (near, bright): the same wind seen with parallax, so far sparks cross the screen slower,
    // sway less and fly lower; the fragment makes them smaller, more transparent, cooler and duller
    float dp = hu(key, ty * 977 + ci, sd + 12), par = 0.4 + 0.6 * dp;
    float drag = 0.8 + 0.5 * h[4], span = uWindK.x * drag * life * (0.45 + 0.8 * Gm) * par;
    vec2 WN = vec2(-uWindDir.y, uWindDir.x);
    float tp = max(tau - 0.07, 0.0);
    float turb = par * 9.0 * sin(tau * (1.7 + 1.5 * h[5]) + h[6] * 6.28) + 4.0 * sin(tau * (4.3 + 3.0 * h[7]) + h[3] * 6.28);
    float turbp = par * 9.0 * sin(tp * (1.7 + 1.5 * h[5]) + h[6] * 6.28) + 4.0 * sin(tp * (4.3 + 3.0 * h[7]) + h[3] * 6.28);
    vec2 Xg = a0 + uWindDir * span * (age - 0.5) + WN * turb;
    vec2 Xgp = a0 + uWindDir * span * (tp / life - 0.5) + WN * turbp;
    if ( Xg.x < 0.0 || Xg.y < 0.0 || Xg.x >= uArtSize.x || Xg.y >= uArtSize.y || openAt(Xg, true) < 0.5 ) { hide(); return; }
    float z = 8.0 + 55.0 * h[3] + 6.0 * sin(tau * (2.0 + 2.0 * h[8]) + h[5] * 6.28) + 8.0 * age;
    float zp = 8.0 + 55.0 * h[3] + 6.0 * sin(tp * (2.0 + 2.0 * h[8]) + h[5] * 6.28) + 8.0 * tp / life;
    vec2 P = Xg - vec2(0.0, lift * z * par), Pp = Xgp - vec2(0.0, lift * zp * par);
    float fl = hu(key, int(floor(uTime * 10.0)), sd + 20);
    float cI = clamp(floor(age * 2.6 + fl * 1.2 + h[8] * 0.8 - 0.4), 0.0, 4.0);
    // big sparks: the share grows 0 -> 15 % with uVF.y 0 -> 1 (the threshold is exactly 1.0 at 0, which no hash passes, and 0.85 at 1)
    float big = h[7] > 0.85 + 0.15 * (1.0 - agoR(tau).w) && cI < 2.0 && dp > 0.6 ? 1.0 : 0.0;
    float low = z * par < 22.0 && cI < 3.0 && dp > 0.5 ? 2.0 : 0.0;
    vA = vec4(P, Pp); vB = vec4(Xg, cI, big + low + 4.0 * floor(dp * 15.99));   // flags + 4 x depth (0..15)
    lo = min(min(P, Pp), Xg) - M_ - 2.3; hi = max(max(P, Pp), Xg) + M_ + 2.3;
  }
  vFade *= min(1.0, 1.0 / rB);
  vec2 a = mix(lo, hi, aCorner);
  vArt = a;
  vec2 world = uOrigin.xy + a * uOrigin.z;
  vec3 tp3 = translationMatrix * vec3(world, 1.0);
  vScr = tp3.xy / uScreen;
  gl_Position = vec4((projectionMatrix * tp3).xy, 0.0, 1.0);
}`;

export const PART_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vArt;
in vec2 vScr;
flat in vec4 vA;
flat in vec4 vB;
flat in ivec2 vK;
flat in float vFade;
uniform float uAlpha;
uniform sampler2D uDepth;
uniform float uDepthElev;
uniform int uHasDepth;
uniform int uSeed;
uniform vec2 uWindDir;
out vec4 fragColor;
float hu(int x, int y, int s) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(s) * 1274126177u;
  h = (h ^ (h >> 13u)) * 1103515245u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967296.0;
}
${GLSL_SHAPES}
const vec3 OCHRE = vec3(0.82, 0.62, 0.36);
const vec3 DUST = vec3(0.93, 0.86, 0.70);
vec3 leaf(float i) { return i < 0.5 ? vec3(0.78, 0.55, 0.20) : i < 1.5 ? vec3(0.62, 0.38, 0.14) : i < 2.5 ? vec3(0.55, 0.62, 0.22) : i < 3.5 ? vec3(0.85, 0.72, 0.30) : i < 4.5 ? vec3(0.45, 0.50, 0.20) : vec3(0.86, 0.85, 0.80); }
vec3 ember(float i) { return i < 0.5 ? vec3(1.0, 0.96, 0.76) : i < 1.5 ? vec3(1.0, 0.82, 0.29) : i < 2.5 ? vec3(1.0, 0.54, 0.14) : i < 3.5 ? vec3(0.82, 0.25, 0.11) : vec3(0.45, 0.16, 0.10); }
// the shapes laid so far, faded in / out by vFade, then the layer's alpha
void out_() {
  if ( K_ > 0.9995 && dot(A_, vec3(1.0)) < 0.0005 ) discard;
  float a = uAlpha * vFade;
  fragColor = vec4(A_ * a, 1.0 - a * (1.0 - K_));
}
// a soft dot: coverage at p of a disc of radius r at c (edge soft over soft art px or a device px)
float dotC(vec2 p, vec2 c, float r, float soft) { return cov(length(p - c) - r, r, soft); }

// Every particle is a SHAPE drawn per screen pixel (2026-11-09): round flakes and motes, antialiased strokes, tumbling leaves, glowing
// sparks with trails, at the particle's continuous position (no whole art cells, no dithered halos)
void main() {
  if ( uHasDepth == 1 && step(uDepthElev, (254.5 / 255.0) - texture(uDepth, vScr).b) < 0.5 ) discard;
  vec2 p = vArt, fw = fwidth(vArt);
  AA = max(max(fw.x, fw.y), 1e-3);
  int kind = vK.x, layer = vK.y;
  if ( kind == 1 && layer < 3 ) {
    vec2 P = vA.xy;
    if ( layer == 1 ) { lay(dotC(p, P, 0.42, 0.3) * 0.75, vec3(0.80, 0.85, 0.93)); out_(); return; }       // far: a small dim flake
    if ( layer == 0 ) {
      // its shadow on the ground (shows the height), then the flake: round, a touch longer down the screen as it falls, bright core
      if ( vB.z < 26.0 ) lay(dotC(p, vA.zw, 0.6, 0.5) * 0.28 * (1.0 - vB.z / 26.0), vec3(0.0));
      bool big = vB.x > 0.72;
      float r = big ? 0.85 : 0.6;
      vec2 q = p - P; q.y /= 1.2;
      float c = cov(length(q) - r, r, 0.35);
      vec3 col = mix(vec3(0.84, 0.88, 0.96), vec3(0.98, 0.99, 1.0), smoothstep(r, 0.2 * r, length(q)));
      lay(c * (big ? 1.0 : mix(0.8, 0.95, vB.y)), col);
      out_(); return;
    }
    // near: a large soft flake close to the camera, out of focus, with a faint halo
    float d = length(p - P - 0.5);
    lay(cov(d - 1.9, 1.9, 1.4) * 0.35, vec3(0.85, 0.89, 0.97));
    lay(cov(d - 1.1, 1.1, 0.6) * 0.9, vec3(0.94, 0.95, 1.0));
    out_(); return;
  }
  if ( kind == 1 ) {
    // spindrift: a thin streak of blown snow, denser toward its head, broken softly along its length
    float t, d = segT(p, vA.xy, vA.zw, t);
    float brk = smoothstep(0.25, 0.6, n1(t * 5.0 + vA.x * 0.37, uSeed + 412));
    lay(cov(d - 0.38, 0.38, 0.3) * (0.25 + 0.6 * t) * mix(0.55, 1.0, brk), vec3(0.93, 0.95, 1.0));
    out_(); return;
  }
  if ( kind == 2 ) {
    // grit: a short ochre stroke, brighter at its head
    float t, d = segT(p, vA.xy, vA.zw, t);
    lay(cov(d - 0.42, 0.42, 0.3) * mix(0.55, 0.8, t), min(vec3(1.0), OCHRE * (0.9 + 0.35 * t) * 1.15));
    out_(); return;
  }
  if ( kind == 3 ) {
    float e = vB.x;
    vec3 dullA = DUST * 0.55, brA = vec3(1.0, 0.97, 0.85);
    vec2 P = vA.xy + 0.5;
    if ( vB.y > 0.5 ) { lay(cov(length(p - P - 0.5) - 1.0, 1.0, 0.9) * 0.3, mix(dullA, brA, e) * 2.0); out_(); return; }   // near: out of focus
    // a mote: a soft speck, catching the light in the sun shafts (a little brighter, a faint glow)
    glow(brA * 0.12 * e * cov(length(p - P) - 1.3, 1.3, 1.0));
    lay(dotC(p, P, 0.48, 0.3) * mix(0.5, 1.0, e), (mix(dullA, brA, e) + 0.08 * e) / mix(0.5, 1.0, e));
    out_(); return;
  }
  if ( kind == 5 && layer == 0 ) {
    // a wind line: an antialiased stroke along its curved path, light over what is under it; it grows from its start, retracts from
    // its tail in its last half, the head fading last, the tail thinning out
    vec2 e = p - vA.xy, wn = vec2(-uWindDir.y, uWindDir.x);
    float s = dot(e, uWindDir), lat = dot(e, wn);
    float w = 4.5 * sin(s / 21.0 + vB.x) + 1.8 * sin(s / 8.3 + vB.y);
    float dw = 4.5 / 21.0 * cos(s / 21.0 + vB.x) + 1.8 / 8.3 * cos(s / 8.3 + vB.y);
    float dl = abs(lat - w) / sqrt(1.0 + dw * dw);
    float f = (vA.w - s) / max(vA.w - vA.z, 1.0), age = vB.z;      // f: 0 at the head .. 1 at the tail
    float L = max(vA.w - vA.z, 1.0), ff = 1.0 / L;
    float len = smoothstep(-ff, ff, (1.0 - smoothstep(0.45, 1.0, age)) - f) * smoothstep(-ff, ff, f - 0.9 * smoothstep(0.8, 1.0, age));
    float ends = smoothstep(-0.5, 0.5, s - vA.z) * smoothstep(-0.5, 0.5, vA.w - s);
    float o = f < 0.5 ? 1.0 : clamp(1.5 - 1.2 * f, 0.0, 1.0);
    float hw = mix(0.42, 0.25, f);
    lay(cov(dl - hw, hw, 0.3) * 0.65 * o * len * ends, vec3(1.077));
    out_(); return;
  }
  if ( kind == 5 ) {
    // debris: a small leaf or bit tumbling (it turns, and flips: its width is the flip's cosine, its side light or dark), and its soft
    // ground shadow (shows the height)
    lay(dotC(p, vA.zw, 0.55 + 0.25 * vB.z, 0.5) * 0.3, vec3(0.0));
    float fl = vB.y, sz = vB.z;
    vec3 col = leaf(vB.x) * (fl > 0.0 ? 1.0 : 0.72);
    vec2 d = p - vA.xy;
    float a = vB.w, ca = cos(a), sa = sin(a);
    vec2 q = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y);
    float L = 0.6 + 0.45 * sz, Wd = (0.45 + 0.15 * sz) * max(abs(fl), 0.22);
    float el = length(q / vec2(L, Wd)) - 1.0;
    lay(cov(el * min(L, Wd), min(L, Wd), 0.25), col);
    out_(); return;
  }
  // EMBERS: depth: far sparks are a dim, cool, dull, see-through speck; near ones bright and opaque with a trail, a glow and, the big
  // ones, a larger core; a faint warm glow on the ground under low near sparks
  vec2 P = vA.xy;
  float ci = vB.z, fl = mod(vB.w, 4.0), dp = floor(vB.w / 4.0) / 15.0;
  float al = mix(0.28, 1.0, dp);
  vec3 col = ember(min(ci + (dp < 0.35 ? 1.0 : 0.0), 4.0));
  col = mix(mix(vec3(dot(col, vec3(0.3, 0.5, 0.2))), col, 0.55) * vec3(0.85, 0.8, 0.9), col, dp);
  if ( fl >= 2.0 ) glow(vec3(0.10, 0.04, 0.0) * dotC(p, vB.xy, 1.3, 1.1));                        // the glow on the ground
  if ( ci < 3.0 && dp > 0.55 ) glow(vec3(0.22, 0.09, 0.02) * dp * cov(length(p - P) - 1.5, 1.5, 1.4));   // the glow round it
  if ( dp >= 0.3 ) {
    float t, d = segT(p, vA.zw, P, t);
    lay(cov(d - 0.35, 0.35, 0.3) * al * 0.85 * t, ember(min(ci + 1.0, 4.0)));                       // the trail, cooling behind
  }
  float big = mod(fl, 2.0) > 0.5 ? 1.0 : 0.0;
  lay(dotC(p, P + vec2(0.5 * big, 0.0), 0.5 + 0.3 * big, 0.3) * al, col);
  out_();
}`;


/* ================================================================== HAZE (sand haze, dust haze, ember smoke): above tokens */

export const HAZE_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform float uTime;
uniform float uK;
uniform float uQ;            // the frame guard's detail 0.35..1 (weatherQ)
uniform float uAlpha;
uniform vec4 uSandH;        // presence x density, 3-band look (lit / shadow), -, -
uniform vec4 uSandW;        // sand direction x, y; speed (art px / s); -
uniform vec4 uDustH;        // presence, wind x, y (art px / s), -
uniform vec4 uSmoke;        // presence, 2-band look, wind x, y (art px / s)
uniform vec3 uAvg;          // the map's average colour
uniform float uCps;
out vec4 fragColor;
${GLSL_COMMON}
const vec3 OCHRE = vec3(0.82, 0.62, 0.36);
const vec3 DUST = vec3(0.93, 0.86, 0.70);
vec4 mixTo(vec4 f, vec3 col, float m) { return vec4(f.rgb * (1.0 - m) + col * m, f.a * (1.0 - m)); }

// the smooth fields (scales of 30+ cells) once per evaluation point
float sDens = 0.0, sLit = 0.0, sLitW = 1.0, dH = 0.0, mH = 0.0;
void smoothFields(vec2 c) {
  if ( uSandH.x > 0.0 ) {
    // sand billows in flat see-through bands, the waves passing; a lit side and a shadow side (one step toward the light; the frame
    // guard fades the sides out between q 0.8 and 0.5 and then skips their second sample)
    vec2 v = uSandW.xy * uSandW.z * 0.8 / 58.0;
    float bil = drift3a(c / 58.0, v, uTime, 40.0, uSeed + 121);
    sLitW = uQ >= 1.0 ? 1.0 : smoothstep(0.5, 0.8, uQ);
    sLit = uSandH.y > 0.0 && sLitW > 0.0 ? bil - drift3a((c + 3.0) / 58.0, v, uTime, 40.0, uSeed + 121) : 0.0;
    float pr = dot(c, uSandW.xy), ac = -c.x * uSandW.y + c.y * uSandW.x;
    float rag = 140.0 * (fbm2(vec2(ac / 95.0, pr / 300.0), uSeed + 141) - 0.5);
    float fr = clamp(gustEnv(uTime - (pr + rag) / (uCps * 4.0), uSeed), 0.0, 1.2);
    sDens = clamp(0.05 + 0.85 * fr * (0.25 + bil) + 0.15 * bil - 0.08, 0.0, 1.0) * uSandH.x;
  }
  if ( uDustH.x > 0.0 ) dH = drift3a(vec2(c.x / 80.0, c.y / 55.0), uDustH.yz * 1.2 / vec2(80.0, 55.0), uTime, 60.0, uSeed + 182);
  if ( uSmoke.x > 0.0 ) mH = drift3a(vec2(c.x / 48.0, c.y / 30.0), uSmoke.zw * 0.9 / vec2(48.0, 30.0), uTime, 40.0, uSeed + 151);
}
// a soft staircase: whole levels with a smooth rise between them (the bands stay, their edges are never cells)
float stairs(float x, float n) { x = clamp(x, 0.0, n); float i = floor(x); return min(n, i + smoothstep(0.3, 0.7, x - i)); }
float lv3(float l, float a, float b, float c) { return l < 1.0 ? a * l : l < 2.0 ? mix(a, b, l - 1.0) : mix(b, c, l - 2.0); }
vec4 cellHaze(vec2 c) {
  vec4 f = vec4(0.0, 0.0, 0.0, 1.0);
  if ( c.x < 0.0 || c.y < 0.0 || c.x >= uArtSize.x || c.y >= uArtSize.y ) return f;
  float op = openS(c, true);
  if ( op <= 0.0 ) return f;
  // (the smooth stand-in for the old per-cell dither; the frame guard eases it to its mean between q 0.85 and 0.5, skipped below)
  float hw = uQ >= 1.0 ? 1.0 : smoothstep(0.5, 0.85, uQ);
  float nz = hw >= 1.0 ? vnoise(c / 2.6, uSeed + 997) : hw > 0.0 ? mix(0.5, vnoise(c / 2.6, uSeed + 997), hw) : 0.5;
  if ( uSandH.x > 0.0 ) {
    float dens = sDens, lit = sLit;
    float l = stairs(dens * 3.2 + (nz - 0.5) * 0.2, 3.0);
    float m = mix(lv3(l, 0.20, 0.34, 0.34), lv3(l, 0.32, 0.55, 0.78), uSandH.y);
    // the lit / shadow sides grow with the 3-band look (uSandH.y 0..1): mix(0.02, mix(0.02, x, t), y) = mix(0.02, x, t * y), so y 0
    // and 1 are the old off / full sides bit for bit (t * 1.0 == t, t * 0.0 == 0) and nothing steps in between
    float dd = lit >= 0.0 ? mix(0.02, 0.09, smoothstep(0.0, 0.008, lit) * uSandH.y) : mix(0.02, -0.06, smoothstep(0.0, 0.008, -lit) * uSandH.y);
    if ( sLitW < 1.0 ) dd = mix(0.02, dd, sLitW);
    if ( m > 0.0 ) f = mixTo(f, clamp(uAvg * 0.35 + OCHRE * 0.75 + dd, 0.0, 1.0), m);
  }
  if ( uDustH.x > 0.0 ) {
    float l = stairs((dH - 0.44) * 7.0 + (nz - 0.5) * 0.2, 2.0);
    float m = l < 1.0 ? 0.09 * l : mix(0.09, 0.17, l - 1.0);
    if ( m > 0.0 ) f = mixTo(f, clamp(uAvg * 0.4 + DUST * 0.7, 0.0, 1.0), m * uDustH.x);
  }
  if ( uSmoke.x > 0.0 ) {
    float l = stairs((mH - 0.42) * 6.0 + (nz - 0.5) * 0.2, 2.0);
    float a = mix(0.13, 0.22, uSmoke.y), b = mix(0.13, 0.40, uSmoke.y);
    float m = l < 1.0 ? a * l : mix(a, b, l - 1.0);
    if ( m > 0.0 ) f = mixTo(f, vec3(0.20, 0.17, 0.16), m * uSmoke.x);
  }
  return mix(vec4(0.0, 0.0, 0.0, 1.0), f, op);
}

// ---- main (the direct pass: one evaluation per screen px at its own point; cells.mjs makes the cached pair from the above)
void main() {
  vec2 c = vCell;
  smoothFields(c);
  vec4 f = cellHaze(c);
  fragColor = vec4(f.rgb * uAlpha, 1.0 - uAlpha * (1.0 - f.a));
}`;
