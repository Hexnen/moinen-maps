/**
 * Shows the zones on the map: a soft tint per zone (neighbours never share a tint), the borders as a dark line with a light dotted
 * line over it (the way printed action maps mark zone borders), and a numbered badge in each zone. While a token is selected the
 * badges show how far each zone is from it and what reaching it costs (the scene's movement preset).
 *
 * One container in the primary group above the roads (245) and districts (250), under tiles, drawings and tokens.
 */

import { cornerPoint } from "./geometry.mjs";

/** A badge's radius on screen (CSS pixels): drawn once at this size, scaled by 1 / zoom. */
const BADGE_R = 19;

const TINTS = [0xd9a441, 0x5aa9c9, 0x9bc46b, 0xc97b9b, 0x8c7bd1, 0xd47a4a, 0x6fc2b0];

function trace(G, p) { G.moveTo(p[0], p[1]); for ( let i = 2; i < p.length; i += 2 ) G.lineTo(p[i], p[i + 1]); }

function ring(G, p) { G.moveTo(p[0], p[1]); for ( let i = 2; i < p.length; i += 2 ) G.lineTo(p[i], p[i + 1]); G.closePath(); }

function dashed(G, p, dash, gap) {
  let on = true, left = dash;
  G.moveTo(p[0], p[1]);
  for ( let i = 2; i < p.length; i += 2 ) {
    let ax = p[i - 2], ay = p[i - 1];
    const bx = p[i], by = p[i + 1];
    let seg = Math.hypot(bx - ax, by - ay);
    while ( seg > 1e-9 ) {
      const t = Math.min(seg, left), f = t / seg;
      const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
      if ( on ) G.lineTo(x, y); else G.moveTo(x, y);
      ax = x; ay = y; seg -= t; left -= t;
      if ( left <= 1e-6 ) { on = !on; left = on ? dash : gap; }
    }
  }
}

/** Greedy colouring: each zone takes the first tint none of its neighbours has. */
function tints(Z) {
  const out = new Map();
  for ( const z of Z.zones ) {
    const used = new Set([...Z.adj.get(z.id).keys()].map((n) => out.get(n)));
    let k = 0; while ( used.has(k) && k < TINTS.length - 1 ) k++;
    out.set(z.id, k);
  }
  return out;
}

const hex = (css) => Number.parseInt(String(css).slice(1), 16) || 0xf3e7c9;

/** A closed ring [x, y, ...] walked at an even step: [[x, y], ...]. */
function resample(r, step) {
  const out = [], n = r.length;
  let carry = 0;
  for ( let i = 0; i < n; i += 2 ) {
    const ax = r[i], ay = r[i + 1], bx = r[(i + 2) % n], by = r[(i + 3) % n];
    const L = Math.hypot(bx - ax, by - ay);
    let d = carry;
    while ( d < L ) { out.push([ax + ((bx - ax) * d) / L, ay + ((by - ay) * d) / L]); d += step; }
    carry = d - L;
  }
  return out;
}

export class ZoneDisplay {
  constructor() {
    this.root = new PIXI.Container();
    this.root.eventMode = "none";
    this.root.interactiveChildren = false;
    Object.assign(this.root, { elevation: 0, sortLayer: 258, sort: 0, _lastSortedIndex: 0 });
    this.fill = new PIXI.Graphics();
    this.lines = new PIXI.Graphics();
    this.badges = new PIXI.Container();
    // the zone under the cursor: an effect inside it (masked to the zone) and its bright border
    this.hi = new PIXI.Container();
    this.hiFx = new PIXI.Graphics();
    this.hiMask = new PIXI.Graphics();
    this.hiLine = new PIXI.Graphics();
    // patterns (hatch, dots) fade in from the border, strongest in the corners: baked on a canvas (see edgePattern)
    this.hiSoft = new PIXI.Sprite(PIXI.Texture.EMPTY);
    this.hi.addChild(this.hiFx, this.hiMask, this.hiSoft, this.hiLine);
    this.hiFx.mask = this.hiMask;
    this.root.addChild(this.fill, this.hi, this.lines, this.badges);
    this.hoverId = -1;
    canvas.primary.addChild(this.root);
    // any zoom (wheel, smooth zoom, pan animations): badges follow the same frame, whatever moved the stage
    this.watch = () => { const z = canvas.stage?.scale.x; if ( z && z !== this.zoom && this.root.visible ) this.onZoom(z); };
    canvas.app.ticker.add(this.watch);
  }

  /**
   * @param {object|null} Z            buildZones() result
   * @param {object} look              Model.cleanLook()
   * @param {number} g                 grid size in pixels
   * @param {object} [o]
   * @param {Map<number, number>} [o.dist]     zone -> distance from the selected token
   * @param {Map<number, object>} [o.bands]    zone -> preset band
   * @param {number} [o.here]                  the selected token's zone
   * @param {number} [o.hover]                the zone under the cursor (numbers "hover")
   * @param {boolean} [o.editing]              the GM is drawing: stronger tints so new zones show at once
   */
  render(Z, look, g, { dist = null, bands = null, here = -1, hover = -1, editing = false, zoom = 1 } = {}) {
    const F = this.fill;
    F.clear(); this.lines.clear();
    for ( const c of this.badges.removeChildren() ) c.destroy({ children: true });
    this.items = [];
    this.g = g;
    this.Z = Z; this.look = look;
    this.drawHover(this.hoverId, zoom);
    if ( !Z || !Z.zones.length ) return;
    const tint = tints(Z), light = hex(look.color);
    this.tintOf = (id) => TINTS[tint.get(id) ?? 0];
    const fillA = Math.min(1, look.fill * (editing ? 0.75 : 0.6));

    // tints (holes cut out), and the reach of the selected token
    for ( const z of Z.zones ) {
      const band = bands?.get(z.id);
      const color = band ? band.color : TINTS[tint.get(z.id)];
      const a = band ? Math.max(fillA, 0.12) * (band.key === "far" ? 0.5 : 1) : fillA;
      if ( a <= 0 ) continue;
      for ( const part of z.parts ) {
        F.beginFill(color, z.id === here ? Math.min(1, a * 1.8) : a);
        ring(F, part[0]);
        for ( const h of part.slice(1) ) { F.beginHole(); ring(F, h); F.endHole(); }
        F.endFill();
      }
    }
    this.drawLines(zoom);

    // badges: the zone's number, or its distance from the selected token. Each badge is drawn once at its size ON SCREEN and scaled
    // by 1 / zoom every frame (follow), so it keeps its size smoothly while zooming, on a spot that stays put.
    const numbered = (id) => look.numbers === "always" || (look.numbers === "hover" && id === hover);
    if ( look.numbers === "never" && !dist ) return;
    const res = Math.min(4, Math.max(2, 2 * (globalThis.devicePixelRatio || 1)));
    for ( const z of Z.zones ) {
      const d = dist ? dist.get(z.id) : null;
      if ( d == null && !numbered(z.id) ) continue;
      const band = bands?.get(z.id);
      const text = d != null ? String(d) : String(z.id + 1);
      const b = new PIXI.Container();
      const G = new PIXI.Graphics();
      const ringCol = band ? band.color : light;
      G.lineStyle({ width: BADGE_R * 0.16, color: ringCol, alpha: 0.95 });
      G.beginFill(0x15110f, d != null ? 0.85 : 0.6).drawCircle(0, 0, BADGE_R).endFill();
      b.addChild(G);
      const t = new PIXI.Text(text, { fontFamily: "Signika, sans-serif", fontWeight: "700", fontSize: Math.round(BADGE_R * (text.length > 1 ? 1.0 : 1.2)), fill: d != null ? ringCol : light, align: "center" });
      t.resolution = res; t.anchor.set(0.5, 0.52);
      b.addChild(t);
      b.alpha = d == null && dist ? 0.45 : 1;
      this.badges.addChild(b);
      this.items.push({ b, z, at: null });
    }
    this.follow(zoom, true);
  }

  /** Borders: dark under-line, light dots on top; widths in screen pixels (drawn again when the zoom moved, see onZoom). */
  drawLines(zoom) {
    const Ln = this.lines, Z = this.Z, look = this.look;
    Ln.clear();
    this.lineZoom = zoom;
    if ( !Z || !look || look.ink <= 0 ) return;
    Ln.alpha = look.lineAlpha ?? 1;
    const px = 1 / Math.max(0.05, zoom), ink = look.ink, w = 5.5 * px * ink;
    Ln.lineStyle({ width: w, color: 0x15110f, alpha: Math.min(1, 0.55 * ink), cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
    for ( const p of Z.core ) trace(Ln, p);
    Ln.lineStyle({ width: w * 0.45, color: hex(look.color), alpha: Math.min(1, 0.95 * ink), cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
    for ( const p of Z.core ) dashed(Ln, p, 11 * px, 7 * px);
  }

  /** Every zoom / pan step: badges follow at once (cheap), the border lines are drawn again once the zoom moved by ~8 %. */
  onZoom(zoom) {
    if ( !this.items?.length && !this.Z ) return;
    this.follow(zoom, false);
    if ( this.lineZoom && Math.abs(Math.log(zoom / this.lineZoom)) > 0.08 ) { this.drawLines(zoom); this.drawHover(this.hoverId, zoom); }
  }

  /**
   * Light the zone under the cursor (look.hoverHi): a bright border and, inside it, the chosen effect - an inner glow, hatching,
   * crosshatching or dots - clipped to the zone by a mask. Sizes in screen pixels. Cheap: only this layer is drawn again.
   */
  drawHover(id, zoom = this.zoom ?? 1) {
    this.hoverId = id;
    const F = this.hiFx, M = this.hiMask, L = this.hiLine;
    F.clear(); M.clear(); L.clear();
    const look = this.look, z = id >= 0 ? this.Z?.zones.find((q) => q.id === id) : null;
    if ( !look?.hoverHi || !z ) { this.#softTex(); return; }
    // the effect inside and the bright border have their own opacity
    this.hiFx.alpha = this.hiSoft.alpha = look.hoverAlpha ?? 1;
    this.hiLine.alpha = look.hoverLineAlpha ?? 1;
    const px = 1 / Math.max(0.05, zoom), light = hex(look.color);
    const rings = z.parts.flatMap((part) => part);
    // the mask: the zone itself (holes cut out)
    for ( const part of z.parts ) {
      M.beginFill(0xffffff, 1); ring(M, part[0]);
      for ( const h of part.slice(1) ) { M.beginHole(); ring(M, h); M.endHole(); }
      M.endFill();
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for ( const r of rings ) for ( let i = 0; i < r.length; i += 2 ) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
    const fx = look.hoverFx;
    if ( fx === "glow" ) {
      // strokes along the border, wide and faint to narrow and bright; the mask keeps their inner half: a glow from the edge inward
      // in the zone's own tint (a light glow vanished on light maps), brightest at the edge
      const c = this.tintOf?.(id) ?? light;
      for ( const [w, a] of [[64, 0.1], [44, 0.13], [28, 0.17], [14, 0.24], [6, 0.32]] ) {
        F.lineStyle({ width: w * px, color: c, alpha: a, join: PIXI.LINE_JOIN.ROUND });
        for ( const r of rings ) { ring(F, r); }
      }
    }
    if ( fx === "hatch" || fx === "crosshatch" || fx === "dots" ) {
      // fixed on the map (grid units), baked once per zone and look: zooming only scales it, nothing is redrawn or jumps
      const key = `${id}|${fx}|${look.color}`;
      if ( key !== this.#patKey || this.Z !== this.#patZ ) {
        this.#softTex();
        this.#edgePattern(z, rings, (this.g ?? 100) / 50, [x0, y0, x1, y1], fx, light);
        this.#patKey = key; this.#patZ = this.Z;
      } else this.hiSoft.visible = true;
    } else this.#softTex();
    // the border: a soft halo and a bright line
    L.lineStyle({ width: 7 * px, color: 0x15110f, alpha: 0.45, join: PIXI.LINE_JOIN.ROUND });
    for ( const r of rings ) ring(L, r);
    L.lineStyle({ width: 10 * px, color: light, alpha: 0.22, join: PIXI.LINE_JOIN.ROUND });
    for ( const r of rings ) ring(L, r);
    L.lineStyle({ width: 3 * px, color: light, alpha: 0.95, join: PIXI.LINE_JOIN.ROUND });
    for ( const r of rings ) ring(L, r);
  }

  /**
   * Hatch / crosshatch / dots, baked on a small 2D canvas at screen resolution: the pattern (two-tone, so it reads on light and dark
   * maps) is kept only inside the zone, as a light band along the whole border and a strong patch in every corner (where the border
   * turns sharply), fading to nothing towards the middle. Shown as a plain sprite (a sprite MASK turned the zone white in Foundry's
   * primary group).
   */
  #edgePattern(z, rings, u, [x0, y0, x1, y1], fx, light) {
    const band = 40 * u, cornerR = Math.min(90 * u, z.label.r * 1.6);
    const w = x1 - x0, h = y1 - y0;
    const k = Math.min(3, 2048 / Math.max(1, w, h));               // canvas pixels per scene pixel (sharp up to ~3x zoom)
    const W = Math.max(2, Math.ceil(w * k) + 2), H = Math.max(2, Math.ceil(h * k) + 2);
    const mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"); x.setTransform(k, 0, 0, k, 1 - x0 * k, 1 - y0 * k); return [c, x]; };
    const path = new Path2D();
    for ( const r of rings ) { path.moveTo(r[0], r[1]); for ( let i = 2; i < r.length; i += 2 ) path.lineTo(r[i], r[i + 1]); path.closePath(); }

    // 1. the strength: light band + corner patches, inside the zone only
    const [mc, m] = mk();
    m.clip(path, "evenodd");
    m.globalCompositeOperation = "lighter";
    m.strokeStyle = "#fff"; m.lineJoin = "round";
    for ( const [bw, a] of [[2, 0.1], [1.3, 0.1], [0.7, 0.12]] ) { m.globalAlpha = a; m.lineWidth = band * bw; m.stroke(path); }
    const step = 6 * u, reach = Math.max(2, Math.round(30 * u / step));
    for ( const r of rings ) {
      const P = resample(r, step), n = P.length;
      if ( n < 2 * reach + 3 ) continue;
      const turn = new Float32Array(n);
      for ( let i = 0; i < n; i++ ) {
        const A = P[(i - reach + n) % n], B = P[i], C = P[(i + reach) % n];
        let t = Math.abs(Math.atan2(C[1] - B[1], C[0] - B[0]) - Math.atan2(B[1] - A[1], B[0] - A[0]));
        if ( t > Math.PI ) t = 2 * Math.PI - t;
        turn[i] = t;
      }
      for ( let i = 0; i < n; i++ ) {
        const t = turn[i];
        if ( t < 0.5 ) continue;                                     // under ~30 degrees: a bend, not a corner
        let peak = true;
        for ( let j = 1; j <= reach && peak; j++ ) if ( turn[(i + j) % n] > t || turn[(i - j + n) % n] >= t ) peak = false;
        if ( !peak ) continue;
        const [x, y] = P[i], g = m.createRadialGradient(x, y, 0, x, y, cornerR);
        g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(255,255,255,0.45)"); g.addColorStop(1, "rgba(255,255,255,0)");
        m.globalAlpha = Math.min(1, 0.35 + (t - 0.5) * 0.9);
        m.fillStyle = g; m.fillRect(x - cornerR, y - cornerR, 2 * cornerR, 2 * cornerR);
      }
    }

    // 2. the pattern, then kept by the strength (destination-in)
    const [pc, c] = mk();
    const css = (n, a) => `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    const len = w + h;
    if ( fx === "dots" ) {
      const gap = 12 * u, r = 1.7 * u;
      const dots = (rad) => { c.beginPath(); for ( let y = y0, row = 0; y <= y1; y += gap, row++ ) for ( let x = x0 + (row % 2 ? gap / 2 : 0); x <= x1; x += gap ) { c.moveTo(x + rad, y); c.arc(x, y, rad, 0, 2 * Math.PI); } c.fill(); };
      c.fillStyle = css(0x15110f, 0.42); dots(r + 1.1 * u);
      c.fillStyle = css(light, 0.9); dots(r);
    } else {
      const gap = 11 * u;
      const hatch = () => {
        c.beginPath();
        for ( let s = -len; s <= len; s += gap ) { c.moveTo(x0 + s, y0); c.lineTo(x0 + s + len, y0 + len); }
        if ( fx === "crosshatch" ) for ( let s = 0; s <= 2 * len; s += gap ) { c.moveTo(x0 + s, y0); c.lineTo(x0 + s - len, y0 + len); }
        c.stroke();
      };
      c.strokeStyle = css(0x15110f, 0.4); c.lineWidth = 2.8 * u; hatch();
      c.strokeStyle = css(light, 0.85); c.lineWidth = 1.2 * u; hatch();
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "destination-in";
    c.drawImage(mc, 0, 0);

    const S = this.hiSoft;
    S.texture = PIXI.Texture.from(pc);
    S.position.set(x0 - 1 / k, y0 - 1 / k); S.scale.set(1 / k);
    S.visible = true;
  }

  /** Drop the soft mask's texture (a new one is drawn per hovered zone and zoom step). */
  #patKey = null; #patZ = null;
  #softTex() {
    this.#patKey = null;
    const S = this.hiSoft;
    if ( S.texture !== PIXI.Texture.EMPTY ) { S.texture.destroy(true); S.texture = PIXI.Texture.EMPTY; }
    S.visible = false;
  }

  /**
   * Scale every badge to its size on screen. Its spot is fixed on the map: the centre, or in the corner a point found for a badge of
   * about half a grid square (not for its size at this zoom), so zooming only scales the badge around a spot that never moves.
   */
  follow(zoom, snap) {
    this.zoom = zoom;
    const px = 1 / Math.max(0.05, zoom), corner = this.look?.place === "corner", g = this.g ?? 100;
    for ( const it of this.items ?? [] ) {
      const rw = Math.min(BADGE_R * px, Math.max(8 * px, it.z.label.r * 0.8));     // the badge's radius in scene pixels
      it.b.scale.set(rw / BADGE_R);
      if ( snap || !it.at ) {
        it.at = corner ? cornerPoint(it.z, Math.min(it.z.label.r * 0.9, g * 0.55)) : it.z.label;
        it.b.position.set(it.at.x, it.at.y);
      }
    }
  }

  set visible(v) { this.root.visible = v; }

  destroy() { canvas.app?.ticker?.remove(this.watch); if ( !this.root.destroyed ) { this.#softTex(); this.root.destroy({ children: true }); } }
}
