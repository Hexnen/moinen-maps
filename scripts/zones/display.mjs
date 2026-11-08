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
    this.Z = Z; this.look = look;
    if ( !Z || !Z.zones.length ) return;
    const tint = tints(Z), light = hex(look.color);
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
    // by 1 / zoom every frame (follow), so it keeps its size smoothly while zooming; in the corner it glides to its new spot.
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
    if ( this.lineZoom && Math.abs(Math.log(zoom / this.lineZoom)) > 0.08 ) this.drawLines(zoom);
  }

  /** Scale every badge to its size on screen; `snap` puts them straight on their spot (a fresh render), else they glide there. */
  follow(zoom, snap) {
    this.zoom = zoom;
    const px = 1 / Math.max(0.05, zoom), corner = this.look?.place === "corner";
    for ( const it of this.items ?? [] ) {
      const rw = Math.min(BADGE_R * px, Math.max(8 * px, it.z.label.r * 0.8));     // the badge's radius in scene pixels
      it.b.scale.set(rw / BADGE_R);
      // the corner spot depends on the badge's size: looked up on a coarse ladder of sizes (cached), reached by gliding
      const key = Math.exp(Math.round(Math.log(rw * 1.5 + 3 * px) / 0.06) * 0.06);
      it.at = corner ? cornerPoint(it.z, key) : it.z.label;
      if ( snap || !corner ) it.b.position.set(it.at.x, it.at.y);
    }
    if ( corner && !snap ) this.#glide();
  }

  #gliding = false;
  #glide() {
    if ( this.#gliding ) return;
    this.#gliding = true;
    const tick = () => {
      let moving = false;
      for ( const it of this.items ?? [] ) {
        if ( it.b.destroyed || !it.at ) continue;
        const dx = it.at.x - it.b.x, dy = it.at.y - it.b.y;
        if ( Math.abs(dx) + Math.abs(dy) < 0.05 ) { it.b.position.set(it.at.x, it.at.y); continue; }
        it.b.position.set(it.b.x + dx * 0.22, it.b.y + dy * 0.22);
        moving = true;
      }
      if ( !moving || this.root.destroyed ) { canvas.app.ticker.remove(tick); this.#gliding = false; }
    };
    canvas.app.ticker.add(tick);
  }

  set visible(v) { this.root.visible = v; }

  destroy() { canvas.app?.ticker?.remove(this.watch); if ( !this.root.destroyed ) this.root.destroy({ children: true }); }
}
