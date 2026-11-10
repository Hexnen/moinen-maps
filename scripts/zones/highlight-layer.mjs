/**
 * Draws the highlights (highlight.mjs) on the map, over the zones and under the tokens: a highlighted zone gets a wash of its
 * colour and a line along the INSIDE of its outline (so two neighbours in different colours each keep their own), a highlighted
 * border a heavy line in its colour, and either one a small label. While a zone is being picked the zones that cannot be picked
 * are dimmed and the one under the cursor lights up.
 *
 * Every coloured line lies on a dark one, the same two tones the zone borders and badges use, so it reads on light and on dark
 * maps. Line widths and labels keep their size on screen (drawn again when the zoom moved by ~8 %, labels scaled every step).
 *
 * PERF: nothing is drawn or watched while there is nothing to show (the container is hidden, the ticker callback removed). A
 * redraw happens only when the highlights, the zones, the pick or the zoom step changed (one key), never on a pan.
 */

import { pairKey } from "./marks.mjs";
import { pattern } from "./display.mjs";
import { groups, shortLabel } from "./highlight.mjs";

const INK = 0x15110f, PAPER = 0xf3e7c9;
/** A badge's radius on screen (display.mjs BADGE_R): a label sits just above the zone's badge. */
const BADGE_R = 19;

function ring(G, p) { G.moveTo(p[0], p[1]); for ( let i = 2; i < p.length; i += 2 ) G.lineTo(p[i], p[i + 1]); G.closePath(); }
function fillZone(G, z, color, alpha) {
  for ( const part of z.parts ) {
    G.beginFill(color, alpha);
    ring(G, part[0]);
    for ( const h of part.slice(1) ) { G.beginHole(); ring(G, h); G.endHole(); }
    G.endFill();
  }
}
const closed = (r) => [...r, r[0], r[1]];

export class ZoneHighlightLayer {
  constructor() {
    this.root = new PIXI.Container();
    this.root.eventMode = "none";
    this.root.interactiveChildren = false;
    // in the primary group just above the zones (display.mjs: 258), under tiles, drawings and tokens
    Object.assign(this.root, { elevation: 0, sortLayer: 258, sort: 1, _lastSortedIndex: 0 });
    this.veil = new PIXI.Graphics();
    this.zonesC = new PIXI.Container();
    this.lines = new PIXI.Graphics();
    this.hover = new PIXI.Graphics();
    this.labels = new PIXI.Container();
    this.root.addChild(this.veil, this.zonesC, this.lines, this.hover, this.labels);
    this.root.visible = false;
    canvas.primary.addChild(this.root);
    this.items = [];
    this.watch = () => { const z = canvas.stage?.scale.x; if ( z && z !== this.zoom ) this.onZoom(z); };
    this.watching = false;
  }

  /**
   * @param {object|null} Z        the zones (geometry.mjs buildZones)
   * @param {{zones: Map, borders: Map}} shown   HighlightStore.compose()
   * @param {object} o
   * @param {number} o.zoom
   * @param {string} o.key         changes whenever the zones or the highlights do
   * @param {boolean} o.badge      a number badge sits on the zone's label spot (the label goes above it)
   * @param {Map<number, object>|null} o.pick   while a zone is being picked: the zones that can be (id -> entry); every other is dimmed
   * @param {Map<string, {x, y}>} o.marks   pair key -> where a border's label sits (the GM's mark on it)
   */
  render(Z, shown, { zoom = 1, key = "", badge = true, pick = null, marks = null } = {}) {
    const any = !!Z && (shown.zones.size > 0 || shown.borders.size > 0 || !!pick);
    this.Z = Z; this.shown = shown; this.badge = badge; this.pick = pick; this.marks = marks; this.key = key;
    this.root.visible = any;
    if ( any && !this.watching ) { canvas.app.ticker.add(this.watch); this.watching = true; }
    else if ( !any && this.watching ) { canvas.app.ticker.remove(this.watch); this.watching = false; }
    if ( !any ) { this.#clear(); this.drawnKey = null; return; }
    this.draw(zoom);
  }

  #clear() {
    this.veil.clear(); this.lines.clear(); this.hover.clear();
    for ( const c of this.zonesC.removeChildren() ) c.destroy({ children: true });
    for ( const c of this.labels.removeChildren() ) c.destroy({ children: true });
    this.items = []; this.hoverId = -1;
  }

  /** Everything, at this zoom (line widths are screen pixels). */
  draw(zoom) {
    const dk = `${this.key}|${zoom}|${this.badge}`;
    this.lineZoom = zoom;
    if ( dk === this.drawnKey ) { this.follow(zoom); return; }
    this.drawnKey = dk;
    const hov = this.hoverId ?? -1;
    this.#clear();
    const Z = this.Z, px = 1 / Math.max(0.05, zoom), byId = new Map(Z.zones.map((z) => [z.id, z]));
    const R = { cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND };

    // picking: what cannot be picked steps back
    if ( this.pick ) for ( const z of Z.zones ) if ( !this.pick.has(z.id) ) fillZone(this.veil, z, INK, 0.34);

    // zones: per colour and style one wash and one inner line (masked to its own zones, so only the inside half of a stroke shows)
    for ( const grp of groups(this.shown.zones) ) {
      const zs = grp.ids.map((id) => byId.get(id)).filter(Boolean);
      if ( !zs.length ) continue;
      const C = new PIXI.Container(), fill = new PIXI.Graphics(), band = new PIXI.Graphics(), mask = new PIXI.Graphics();
      C.addChild(fill, band, mask);
      band.mask = mask;
      for ( const z of zs ) fillZone(mask, z, 0xffffff, 1);
      if ( grp.style === "fill" ) for ( const z of zs ) fillZone(fill, z, grp.color, 0.2);
      const rings = zs.flatMap((z) => z.parts.flatMap((part) => part));
      const stroke = (w, color, alpha, dash = null) => {
        band.lineStyle({ width: w * px, color, alpha, ...R });
        for ( const r of rings ) { if ( dash ) pattern(band, closed(r), dash.map((d) => d * px)); else ring(band, r); }
      };
      // (widths are doubled: the mask keeps the half inside the zone)
      if ( grp.style === "fill" ) { stroke(34, grp.color, 0.1); stroke(20, grp.color, 0.16); }
      stroke(13, INK, 0.62);
      stroke(7.5, grp.color, 1, grp.style === "dashed" ? [11, 8] : null);
      this.zonesC.addChild(C);
    }

    // borders: the stretches between the two zones, a heavy coloured line on a dark one
    if ( this.shown.borders.size ) {
      const segs = new Map();
      for ( const br of Z.borders ) {
        if ( br.edge || br.b < 0 || br.a < 0 ) continue;
        const e = this.shown.borders.get(pairKey(br.a, br.b));
        if ( e ) (segs.get(e) ?? segs.set(e, []).get(e)).push(br.pts);
      }
      const L = this.lines;
      for ( const [w, col, a] of [[12, null, 0.8], [6.5, 1, 1], [1.6, PAPER, 0.75]] ) {
        for ( const [e, list] of segs ) {
          if ( e.style === "dashed" && col === PAPER ) continue;
          L.lineStyle({ width: w * px, color: col === 1 ? e.color : col ?? INK, alpha: a, ...R });
          for ( const s of list ) {
            if ( e.style === "dashed" && col === 1 ) pattern(L, s, [9 * px, 9 * px]);
            else { L.moveTo(s[0], s[1]); L.lineTo(s[2], s[3]); }
          }
        }
      }
      for ( const [e, list] of segs ) {
        if ( !e.label ) continue;
        // where the GM's mark sits, else the middle of the longest stretch
        let at = this.marks?.get(pairKey(e.a, e.b)) ?? null;
        if ( !at ) { let best = 0; for ( const s of list ) { const d = Math.hypot(s[2] - s[0], s[3] - s[1]); if ( d >= best ) { best = d; at = { x: (s[0] + s[2]) / 2, y: (s[1] + s[3]) / 2 }; } } }
        if ( at ) this.#label(e, at, 0, 0);
      }
    }

    for ( const e of this.shown.zones.values() ) {
      const z = byId.get(e.id);
      if ( z && e.label ) this.#label(e, z.label, this.badge ? -(BADGE_R + 14) : 0, z.label.r, z.id);
    }
    this.follow(zoom);
    this.setHover(hov, true);
  }

  /** A label: light text on a dark pill rimmed in the highlight's colour (the look of the altitude tag on a token). */
  #label(e, at, dy, r, zoneId = -1) {
    const c = new PIXI.Container(), G = new PIXI.Graphics();
    const T = new PIXI.Text(shortLabel(e.label), { fontFamily: "Signika, sans-serif", fontWeight: "700", fontSize: 13, fill: PAPER });
    T.resolution = Math.min(4, Math.max(2, 2 * (globalThis.devicePixelRatio || 1)));
    T.anchor.set(0.5, 0.52);
    const w = Math.max(22, T.width + 14);
    G.lineStyle({ width: 1.6, color: e.color, alpha: 1 }).beginFill(INK, 0.9).drawRoundedRect(-w / 2, -10.5, w, 21, 10).endFill();
    c.addChild(G, T);
    this.labels.addChild(c);
    this.items.push({ c, at, dy, r, zoneId });
  }

  /** Labels keep their size on screen; in a zone smaller than a badge they shrink with it (as the badges do). */
  follow(zoom) {
    this.zoom = zoom;
    const px = 1 / Math.max(0.05, zoom);
    for ( const it of this.items ) {
      const s = it.r ? Math.min(BADGE_R * px, Math.max(8 * px, it.r * 0.8)) / BADGE_R : px;
      it.c.scale.set(s * (it.zoneId >= 0 && it.zoneId === this.hoverId ? 1.18 : 1));
      it.c.position.set(it.at.x, it.at.y + it.dy * s);
    }
  }

  onZoom(zoom) {
    if ( !this.root.visible ) return;
    if ( this.lineZoom && Math.abs(Math.log(zoom / this.lineZoom)) > 0.08 ) this.draw(zoom);
    else this.follow(zoom);
  }

  /** While picking: the zone under the cursor (-1: none, or one that cannot be picked). Only this part is drawn again. */
  setHover(id, force = false) {
    if ( id === this.hoverId && !force ) return;
    this.hoverId = id;
    const H = this.hover;
    H.clear();
    const z = id >= 0 ? this.Z?.zones.find((q) => q.id === id) : null, e = z ? this.pick?.get(id) : null;
    if ( z && e ) {
      const px = 1 / Math.max(0.05, this.lineZoom ?? this.zoom ?? 1), J = { join: PIXI.LINE_JOIN.ROUND };
      fillZone(H, z, e.color, 0.26);
      const rings = z.parts.flatMap((part) => part);
      for ( const [w, col, a] of [[10, INK, 0.7], [6, e.color, 1], [2, 0xffffff, 0.95]] ) { H.lineStyle({ width: w * px, color: col, alpha: a, ...J }); for ( const r of rings ) ring(H, r); }
    }
    this.follow(this.zoom ?? 1);
  }

  destroy() {
    if ( this.watching ) canvas.app?.ticker?.remove(this.watch);
    this.watching = false;
    if ( !this.root.destroyed ) this.root.destroy({ children: true });
  }
}
