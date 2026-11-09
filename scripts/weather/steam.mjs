import { fireWet } from "../wind.mjs";

/**
 * STEAM where rain or snow meets fire (research D9 / 0.2 #10): white-grey puffs born over the burning cells of each fire area, rising
 * (screen-up, by the view lift), drifting with the wind, swelling and thinning out; they mix with the fire's own smoke (drawn just
 * above it). All on the GPU: per area one instanced quad mesh over a lattice of slots on its fire box (2 slots per quarter square);
 * each slot lives 1.8-3.3 s on a whole number of cycles per hour, is born at a hashed cell of its tile and draws only when that cell
 * BURNS (the area's own field texture, R heat, read in the vertex shader) and its hash is under the steam share. The CPU writes a few
 * uniforms per area per frame; no per-cell work, nothing read back. Drawn per screen px at the puff's continuous point (2026-11-09:
 * no whole art cells, no stepped alpha or tones; a soft antialiased rim), lit from the up-left.
 * COST: nothing while there is no rain / snow over fire (the meshes are hidden, the ticker returns at once; made only on first use).
 */
const VERT = `#version 300 es
precision highp float;
precision highp int;
in vec2 aVertexPosition;
in vec2 aCorner;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform sampler2D uField;    // the fire area's field (R heat), W x H cells from uRect.xy
uniform vec4 uRect;          // the field's origin (world cells), its size
uniform vec4 uBox;           // the fire box (world cells): x0, y0, x1, y1
uniform vec3 uGeo;           // scene x, y of art cell 0; scene px per art cell
uniform float uTime;         // shared s, mod 3600
uniform float uSteam;        // 0..1
uniform float uU;            // art cells per grid square / 32
uniform vec2 uWind;          // the scene wind (art cells / s)
uniform float uLift;         // the view lift
uniform float uTS;           // the slot tile (art cells)
uniform int uNX;             // tiles across
uniform int uSeed;
out vec2 vC;
flat out vec4 vP;            // centre (art cells), radius, opacity
flat out float vH;
uint hh(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float hu(int a, int b, int c) { return float(hh(uint(a) * 0x9E3779B1u ^ uint(b) * 0x85EBCA77u ^ (uint(c) * 0x2545F491u + uint(uSeed) * 0x27d4eb2fu)) >> 8) / 16777216.0; }
void hide() { gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); vC = vec2(0.0); vP = vec4(0.0); vH = 0.0; }
void main() {
  int i = gl_InstanceID, slot = i % 2, tile = i / 2, tx = tile % uNX, ty = tile / uNX, key = tx * 7 + slot;
  float kc = 1090.0 + floor(hu(key, ty, 1) * 900.0), life = 3600.0 / kc;
  float u = (uTime + hu(key, ty, 2) * life) / life, f = fract(u), tau = f * life;
  int ci = int(mod(floor(u), kc));
  vec2 b = uBox.xy + (vec2(float(tx), float(ty)) + vec2(hu(key, ty * 977 + ci, 3), hu(key, ty * 977 + ci, 4))) * uTS;
  ivec2 q = ivec2(floor(b - uRect.xy));
  if ( b.x >= uBox.z || b.y >= uBox.w || q.x < 0 || q.y < 0 || q.x >= int(uRect.z) || q.y >= int(uRect.w) ) { hide(); return; }
  float heat = texelFetch(uField, q, 0).r;
  float h = hu(key, ty * 977 + ci, 5);
  if ( heat < 0.15 || h >= uSteam * (0.22 + 0.38 * heat) ) { hide(); return; }
  float h2 = hu(key, ty * 977 + ci, 6), h3 = hu(key, ty * 977 + ci, 7);
  // rising from just above the flames, slowing a little; drifting downwind with a sway
  float z = (10.0 + 14.0 * h2) * uU + (14.0 + 10.0 * h3) * uU * tau * (1.0 - 0.2 * f);
  vec2 d = uWind * tau * 0.8 + vec2(3.0 * uU * sin(6.2832 * (0.4 * tau + h3)), 0.0);
  vec2 c = b + d - vec2(0.0, uLift * z);
  float r = (2.0 + 6.0 * pow(f, 0.7)) * uU * (0.8 + 0.4 * h2);
  float a = 0.6 * smoothstep(0.0, 0.2, f) * pow(1.0 - f, 1.4) * (0.6 + 0.4 * heat);
  vec2 e = vec2(r * 0.8 + 3.0, r * 1.6 + 3.0);
  vec2 w = c - e + aCorner * (2.0 * e);
  vC = w; vP = vec4(c, r, a); vH = h3;
  vec2 world = uGeo.xy + w * uGeo.z;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(world, 1.0)).xy, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vC;
flat in vec4 vP;
flat in float vH;
uniform float uAlpha;
out vec4 o;
float hc(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + vH * 91.7) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hc(i), hc(i + vec2(1.0, 0.0)), f.x), mix(hc(i + vec2(0.0, 1.0)), hc(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  if ( vP.w <= 0.0 ) discard;
  // a WISP, not a ball: taller than wide, leaning with its sway, eaten by noise into strands and holes
  vec2 p = vC, q = p - vP.xy;
  q.x -= 0.35 * q.y * (vH - 0.5);
  vec2 d = q / vec2(vP.z * 0.65, vP.z * 1.45);
  float n = vn(p / max(1.5, vP.z * 0.35)), n2 = vn(vec2(p.x / max(1.0, vP.z * 0.2), p.y / max(2.0, vP.z * 0.9)) + 7.3);
  float r = length(d) + 0.55 * (n - 0.5) + 0.45 * (n2 - 0.5);
  float rim = 1.0 - smoothstep(1.0 - max(1.5 * fwidth(r), 0.06), 1.0, r);   // (a soft edge, at least a device px)
  if ( rim <= 0.0 ) discard;
  // lit from the up-left: light, mid and shade blending; thinner toward the rim
  float l = clamp(-0.7 * (d.x + d.y) + 0.4 * (n - 0.5), -1.0, 1.0);
  vec3 c = mix(vec3(0.70, 0.73, 0.78), vec3(0.84, 0.86, 0.90), smoothstep(-0.42, -0.18, l));
  c = mix(c, vec3(0.95, 0.96, 0.97), smoothstep(0.13, 0.37, l));
  float a = vP.w * mix(1.0, 0.4, smoothstep(0.3, 0.9, r));
  a = min(0.46, 1.1 * a) * smoothstep(0.03, 0.12, a) * rim * uAlpha;
  if ( a <= 0.002 ) discard;
  o = vec4(c * a, a);
}`;

export class SteamLayer {
  constructor() {
    this.root = new PIXI.Container(); this.root.eventMode = "none";
    Object.assign(this.root, { elevation: 0, sortLayer: 801, sort: 0, _lastSortedIndex: 0 });   // (just above the fire's smoke, 800)
    canvas.primary.addChild(this.root);
    this.meshes = new Map();          // fire area id -> { mesh, fm (the fire mesh it reads) }
    this.prog = PIXI.Program.from(VERT, FRAG, "moinen-maps-weather-steam");
    this.stats = { areas: 0, inst: 0 };
    this._tick = () => this.tick(); this.ticking = false;
    this.now = () => Date.now(); this.view = () => ({ lift: 0.5 }); this.wind = () => [0, 0];
  }

  arm(on) { if ( on === this.ticking ) return; this.ticking = on; if ( on ) canvas.app.ticker.add(this._tick); else canvas.app.ticker.remove(this._tick); }

  /** The steam mesh of a fire area (made on first use; remade when the fire area's mesh was rebuilt). */
  meshOf(id, a, geo) {
    let e = this.meshes.get(id);
    if ( e && e.fm === a.mesh ) return e.mesh;
    if ( e ) { this.root.removeChild(e.mesh); e.mesh.geometry.destroy(); e.mesh.destroy(); }
    const g = new PIXI.Geometry()
      .addAttribute("aVertexPosition", [0, 0, 1, 0, 1, 1, 0, 1], 2)
      .addAttribute("aCorner", [0, 0, 1, 0, 1, 1, 0, 1], 2)
      .addIndex([0, 1, 2, 0, 2, 3]);
    g.instanced = true; g.instanceCount = 0;
    const r = a.area.rect, b = a.area.box ?? r, u = geo.grid / geo.ap / 32, TS = Math.max(4, Math.round(8 * u));
    const nx = Math.max(1, Math.ceil((b.x1 - b.x0) / TS)), ny = Math.max(1, Math.ceil((b.y1 - b.y0) / TS));
    const mesh = new PIXI.Mesh(g, new PIXI.Shader(this.prog, {
      uField: a.mesh.fieldTex, uRect: new Float32Array([r.x0, r.y0, a.mesh.W, a.mesh.H]), uBox: new Float32Array([b.x0, b.y0, b.x1, b.y1]),
      uGeo: new Float32Array([geo.ox, geo.oy, geo.ap]), uTime: 0, uSteam: 0, uU: u, uWind: new Float32Array(2), uLift: 0.5, uTS: TS, uNX: nx,
      uSeed: (a.area.seed ?? 1) % 65536, uAlpha: 1, translationMatrix: new PIXI.Matrix().toArray(true)
    }));
    mesh.state.blendMode = PIXI.BLEND_MODES.NORMAL; mesh.eventMode = "none";
    mesh.slots = nx * ny * 2;
    this.root.addChild(mesh);
    this.meshes.set(id, { mesh, fm: a.mesh });
    return mesh;
  }

  tick() {
    const F = game.modules.get("moinen-maps")?.api?.fire?.display?.(), wet = fireWet();
    const areas = F?.areas, geo = F?.geo;
    const on = !!areas?.size && wet.steam > 0.001 && !!geo;
    this.root.visible = on;
    if ( !on ) { this.stats.inst = 0; return; }
    if ( F.above && this.root.elevation !== F.above.elevation ) { this.root.elevation = F.above.elevation; canvas.primary.sortDirty = true; }
    const t = (this.now() / 1000) % 3600, lift = this.view().lift ?? 0.5, [wx, wy] = this.wind();
    let inst = 0;
    for ( const [id, a] of areas ) {
      if ( !a.mesh?.isArt || !a.mesh.fieldTex ) continue;
      const m = this.meshOf(id, a, geo), u = m.shader.uniforms;
      m.visible = a.mesh.visible;
      if ( !m.visible ) continue;
      u.uTime = t; u.uSteam = wet.steam; u.uLift = lift; u.uWind[0] = wx; u.uWind[1] = wy; u.uAlpha = a.mesh.worldAlpha ?? 1;
      m.geometry.instanceCount = m.slots; inst += m.slots;
    }
    for ( const [id, e] of this.meshes ) if ( !areas.has(id) ) { this.root.removeChild(e.mesh); e.mesh.geometry.destroy(); e.mesh.destroy(); this.meshes.delete(id); }
    this.stats.areas = this.meshes.size; this.stats.inst = inst;
  }

  destroy() {
    this.arm(false);
    for ( const e of this.meshes.values() ) { e.mesh.geometry.destroy(); e.mesh.destroy(); }
    this.meshes.clear();
    this.root.parent?.removeChild(this.root); this.root.destroy();
  }
}
