/**
 * Shows the zones on the map: a soft tint per zone (neighbours never share a tint), the borders as a dark line with a light dotted
 * line over it (the way printed action maps mark zone borders), and a numbered badge in each zone. While a token is selected the
 * badges show how far each zone is from it and what reaching it costs (the scene's movement preset).
 *
 * One container in the primary group above the roads (245) and districts (250), under tiles, drawings and tokens.
 */

import { cornerPoint } from "./geometry.mjs";

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

export class ZoneDisplay {
  constructor() {
    this.root = new PIXI.Container();
    this.root.eventMode = "none";
    this.root.interactiveChildren = false;
    Object.assign(this.root, { elevation: 0, sortLayer: 258, sort: 0, _lastSortedIndex: 0 });
    this.fill = new PIXI.Graphics();
    this.lines = new PIXI.Graphics();
    this.badges = new PIXI.Container();
    this.root.addChild(this.fill, this.lines, this.badges);
    canvas.primary.addChild(this.root);
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
    this.zoom = zoom;
    const F = this.fill, Ln = this.lines;
    F.clear(); Ln.clear();
    for ( const c of this.badges.removeChildren() ) c.destroy({ children: true });
    if ( !Z || !Z.zones.length ) return;
    const tint = tints(Z), ink = look.ink, light = hex(look.color);
    const fillA = Math.min(1, look.fill * (editing ? 0.75 : 0.6));
    // lines and badges keep their size on screen (zones are big areas: sizes taken from the grid were specks on small-grid maps)
    const px = 1 / Math.max(0.05, zoom);

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

    // borders: dark under-line, light dots on top
    if ( ink > 0 ) {
      const w = 5.5 * px * ink;
      Ln.lineStyle({ width: w, color: 0x15110f, alpha: Math.min(1, 0.55 * ink), cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
      for ( const p of Z.core ) trace(Ln, p);
      Ln.lineStyle({ width: w * 0.45, color: light, alpha: Math.min(1, 0.95 * ink), cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
      for ( const p of Z.core ) dashed(Ln, p, 11 * px, 7 * px);
    }

    // badges: the zone's number, or its distance from the selected token
    // which zones get their number: all, only the one under the cursor, or none (distances around a selected token always show)
    const numbered = (id) => look.numbers === "always" || (look.numbers === "hover" && id === hover);
    if ( look.numbers === "never" && !dist ) return;
    for ( const z of Z.zones ) {
      const d = dist ? dist.get(z.id) : null;
      if ( d == null && !numbered(z.id) ) continue;
      const band = bands?.get(z.id);
      const text = d != null ? String(d) : String(z.id + 1);
      const r = Math.min(19 * px, Math.max(8 * px, z.label.r * 0.8));
      const b = new PIXI.Container();
      const G = new PIXI.Graphics();
      const ringCol = band ? band.color : light;
      G.lineStyle({ width: r * 0.16, color: ringCol, alpha: 0.95 });
      G.beginFill(0x15110f, d != null ? 0.85 : 0.6).drawCircle(0, 0, r).endFill();
      b.addChild(G);
      const t = new PIXI.Text(text, { fontFamily: "Signika, sans-serif", fontWeight: "700", fontSize: Math.round(r * (text.length > 1 ? 1.0 : 1.2)), fill: d != null ? ringCol : light, align: "center" });
      t.resolution = Math.min(8, Math.max(2, 3 * zoom)); t.anchor.set(0.5, 0.52);
      b.addChild(t);
      // the zone's middle, or its top-left corner (clear of the borders by a little more than the badge)
      const at = look.place === "corner" ? cornerPoint(z, r * 1.5 + 3 * px) : z.label;
      b.position.set(at.x, at.y);
      b.alpha = d == null && dist ? 0.45 : 1;
      this.badges.addChild(b);
    }
  }

  set visible(v) { this.root.visible = v; }

  destroy() { if ( !this.root.destroyed ) this.root.destroy({ children: true }); }
}
