/**
 * Draws the highlights (highlight.mjs) on the map, over the zones and under the tokens: a highlighted zone gets a wash of its
 * colour and a line along the INSIDE of its outline (so two neighbours in different colours each keep their own), a highlighted
 * border a heavy line in its colour, and either one a small label. While a zone is being picked the zones that cannot be picked
 * are dimmed and the one under the cursor lights up.
 *
 * Every coloured line lies on a dark one, the same two tones the zone borders and badges use, so it reads on light and on dark
 * maps. Line widths and labels keep their size on screen (drawn again when the zoom moved by ~8 %, labels scaled every step); in a
 * zone that is small on screen (far zoomed out) the bands get thinner with it, so they frame the zone instead of filling it.
 *
 * A label takes the spot where it can be read (place.mjs): beside the zone's number badge and icons wherever those sit, clear of
 * the tokens standing in the zone (the highlights are drawn under the tokens), of the passages' marks and of the other labels, in
 * its own zone if it can. It is placed when the highlights are drawn and again when a token moved (place()), not while panning.
 *
 * PERF: nothing is drawn or watched while there is nothing to show (the container is hidden, the ticker callback removed). A
 * redraw happens only when the highlights, the zones, the pick or the zoom step changed (one key), never on a pan.
 */

import { pairKey } from "./marks.mjs";
import { pattern } from "./display.mjs";
import { groups, shortLabel } from "./highlight.mjs";
import { pickSpot, zoneSpots, borderSpots, thin } from "./place.mjs";

const INK = 0x15110f, PAPER = 0xf3e7c9;
/** A badge's radius on screen (display.mjs BADGE_R): a zone's label shrinks with the zone as its badge does. */
const BADGE_R = 19;
/** A label's height on screen. */
const LABEL_H = 21;

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
    /** The spot each label has now (label key -> index of its spot): kept while tokens move, so a label does not hop about. */
    this.spots = new Map();
    this.watch = () => { const z = canvas.stage?.scale.x; if ( z && z !== this.zoom ) this.onZoom(z); };
    this.watching = false;
  }

  /**
   * @param {object|null} Z        the zones (geometry.mjs buildZones)
   * @param {{zones: Map, borders: Map}} shown   HighlightStore.compose()
   * @param {object} o
   * @param {number} o.zoom
   * @param {string} o.key         changes whenever the zones or the highlights do
   * @param {Map<number, object>|null} o.pick   while a zone is being picked: the zones that can be (id -> entry); every other is dimmed
   * @param {Map<string, {x, y}>} o.marks   pair key -> where a border's label sits (the GM's mark on it)
   * @param {() => {boxes: Array, tokens: Array}} o.blocks   what the labels keep clear of, asked when they are placed: `boxes` what
   *        sits on the zones (display.mjs boxes(): { zone, kind, x0, y0, x1, y1 }), `tokens` the tokens this user sees ({ x0, y0, x1, y1 })
   * @param {(x: number, y: number) => number} o.zoneAt   the zone at a scene point (-1: none)
   */
  render(Z, shown, { zoom = 1, key = "", pick = null, marks = null, blocks = null, zoneAt = null } = {}) {
    const any = !!Z && (shown.zones.size > 0 || shown.borders.size > 0 || !!pick);
    if ( Z !== this.Z ) this.spots.clear();
    this.Z = Z; this.shown = shown; this.pick = pick; this.marks = marks; this.key = key; this.blocks = blocks; this.zoneAt = zoneAt;
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
    const dk = `${this.key}|${zoom}`;
    this.lineZoom = zoom;
    if ( dk === this.drawnKey ) { this.zoom = zoom; this.place(); return; }
    this.drawnKey = dk;
    const hov = this.hoverId ?? -1;
    this.#clear();
    const Z = this.Z, px = 1 / Math.max(0.05, zoom), byId = new Map(Z.zones.map((z) => [z.id, z]));
    const R = { cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND };
    // how much thinner the bands of a zone are drawn: by the room it has on screen
    const kOf = (z) => thin(z.label.r * zoom);

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
      const rings = zs.map((z) => [kOf(z), z.parts.flatMap((part) => part)]);
      const stroke = (w, color, alpha, dash = null) => {
        for ( const [k, list] of rings ) {
          band.lineStyle({ width: w * px * k, color, alpha, ...R });
          // (dashes shorten less than the band thins: they stay dashes)
          for ( const r of list ) { if ( dash ) pattern(band, closed(r), dash.map((d) => d * px * Math.max(0.65, k))); else ring(band, r); }
        }
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
      // (a border is a thing to look at: it thins with its smaller zone, but less than a zone's band)
      const kB = new Map([...segs.keys()].map((e) => [e, Math.max(0.6, Math.min(kOf(byId.get(e.a)), kOf(byId.get(e.b))))]));
      for ( const [w, col, a] of [[12, null, 0.8], [6.5, 1, 1], [1.6, PAPER, 0.75]] ) {
        for ( const [e, list] of segs ) {
          if ( e.style === "dashed" && col === PAPER ) continue;
          const k = kB.get(e);
          L.lineStyle({ width: w * px * k, color: col === 1 ? e.color : col ?? INK, alpha: a, ...R });
          for ( const s of list ) {
            if ( e.style === "dashed" && col === 1 ) pattern(L, s, [9 * px * k, 9 * px * k]);
            else { L.moveTo(s[0], s[1]); L.lineTo(s[2], s[3]); }
          }
        }
      }
      for ( const [e, list] of segs ) {
        if ( !e.label ) continue;
        // where the GM's mark sits, else the middle of the longest stretch; `u`: which way the border runs there
        let at = this.marks?.get(pairKey(e.a, e.b)) ?? null, u = null, bd = Infinity;
        if ( at ) { for ( const s of list ) { const d = Math.hypot((s[0] + s[2]) / 2 - at.x, (s[1] + s[3]) / 2 - at.y); if ( d < bd ) { bd = d; u = s; } } }
        else { let best = 0; for ( const s of list ) { const d = Math.hypot(s[2] - s[0], s[3] - s[1]); if ( d >= best ) { best = d; u = s; at = { x: (s[0] + s[2]) / 2, y: (s[1] + s[3]) / 2 }; } } }
        if ( !at ) continue;
        const len = u ? Math.hypot(u[2] - u[0], u[3] - u[1]) : 0;
        this.#label(e, at, 0, -1, `b${pairKey(e.a, e.b)}`, len > 1e-6 ? { x: (u[2] - u[0]) / len, y: (u[3] - u[1]) / len } : { x: 1, y: 0 });
      }
    }

    for ( const e of this.shown.zones.values() ) {
      const z = byId.get(e.id);
      if ( z && e.label ) this.#label(e, z.label, z.label.r, z.id, `z${z.id}`);
    }
    for ( const k of [...this.spots.keys()] ) if ( !this.items.some((it) => it.key === k) ) this.spots.delete(k);
    this.zoom = zoom;
    this.place();
    this.setHover(hov, true);
  }

  /**
   * Every label takes its spot (place.mjs): the zones' labels first, then the borders'. Called when the highlights are drawn and
   * when what they must keep clear of moved (a token); cheap, and nothing is drawn again.
   */
  place() {
    if ( !this.items.length ) return;
    const zoom = this.zoom ?? 1, px = 1 / Math.max(0.05, zoom);
    const B = this.blocks?.() ?? {}, boxes = B.boxes ?? [], zoneAt = this.zoneAt;
    // a token hides a label; a badge, an icon row, a passage's mark or another label only makes both hard to read
    const blocks = [...(B.tokens ?? []).map((t) => ({ ...t, w: 3 })), ...boxes.map((b) => ({ ...b, w: 2 }))];
    for ( const it of [...this.items].sort((a, b) => (b.zoneId >= 0) - (a.zoneId >= 0)) ) {
      const s = this.#scale(it, px), half = { w: (it.w / 2) * s, h: (LABEL_H / 2) * s };
      let cands;
      if ( it.zoneId >= 0 ) {
        // what sits on the zone's middle (its badge - or its icons where no badge shows), and how far the icons reach under it
        const mine = boxes.filter((b) => b.zone === it.zoneId && b.kind !== "pass"), on = (b) => b.x0 <= it.at.x && b.x1 >= it.at.x && b.y0 <= it.at.y && b.y1 >= it.at.y;
        const mid = mine.filter(on), clear = mid.length ? Math.max(...mid.map((b) => (b.y1 - b.y0) / 2)) / s : 0;
        const under = mine.filter((b) => !on(b) && b.x0 <= it.at.x && b.x1 >= it.at.x && b.y0 > it.at.y), below = under.length ? (Math.max(...under.map((b) => b.y1)) - it.at.y) / s : 0;
        cands = zoneSpots(it.w, clear, below);
      }
      else cands = borderSpots(it.w, it.u);
      const inside = it.zoneId >= 0 && zoneAt ? (x, y) => zoneAt(x, y) === it.zoneId : null;
      const i = pickSpot(it.at, half, cands.map((c) => ({ dx: c.dx * s, dy: c.dy * s })), blocks, inside, this.spots.get(it.key) ?? -1);
      this.spots.set(it.key, i);
      it.dx = cands[i].dx; it.dy = cands[i].dy;
      const x = it.at.x + it.dx * s, y = it.at.y + it.dy * s;
      blocks.push({ x0: x - half.w, y0: y - half.h, x1: x + half.w, y1: y + half.h, w: 2 });
    }
    this.follow(zoom);
  }
  #scale(it, px) { return it.r > 0 ? Math.min(BADGE_R * px, Math.max(8 * px, it.r * 0.8)) / BADGE_R : px; }

  /** A label: light text on a dark pill rimmed in the highlight's colour (the look of the altitude tag on a token). */
  #label(e, at, r, zoneId, key, u = null) {
    const c = new PIXI.Container(), G = new PIXI.Graphics();
    const T = new PIXI.Text(shortLabel(e.label), { fontFamily: "Signika, sans-serif", fontWeight: "700", fontSize: 14, fill: PAPER });
    T.resolution = Math.min(4, Math.max(2, 2 * (globalThis.devicePixelRatio || 1)));
    T.anchor.set(0.5, 0.52);
    const w = Math.max(22, T.width + 14);
    G.lineStyle({ width: 1.6, color: e.color, alpha: 1 }).beginFill(INK, 0.9).drawRoundedRect(-w / 2, -LABEL_H / 2, w, LABEL_H, 10).endFill();
    c.addChild(G, T);
    this.labels.addChild(c);
    this.items.push({ c, at, dx: 0, dy: 0, r, zoneId, key, w, u });
  }

  /** Labels keep their size on screen; in a zone smaller than a badge they shrink with it (as the badges do). */
  follow(zoom) {
    this.zoom = zoom;
    const px = 1 / Math.max(0.05, zoom);
    for ( const it of this.items ) {
      const s = this.#scale(it, px);
      it.c.scale.set(s * (it.zoneId >= 0 && it.zoneId === this.hoverId ? 1.18 : 1));
      it.c.position.set(it.at.x + it.dx * s, it.at.y + it.dy * s);
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
      const zoom = this.lineZoom ?? this.zoom ?? 1, px = 1 / Math.max(0.05, zoom), J = { join: PIXI.LINE_JOIN.ROUND }, k = Math.max(0.6, thin(z.label.r * zoom));
      fillZone(H, z, e.color, 0.34);
      const rings = z.parts.flatMap((part) => part);
      for ( const [w, col, a] of [[10, INK, 0.7], [6, e.color, 1], [2, 0xffffff, 0.95]] ) { H.lineStyle({ width: w * px * k, color: col, alpha: a, ...J }); for ( const r of rings ) ring(H, r); }
    }
    this.follow(this.zoom ?? 1);
  }

  destroy() {
    if ( this.watching ) canvas.app?.ticker?.remove(this.watch);
    this.watching = false;
    if ( !this.root.destroyed ) this.root.destroy({ children: true });
  }
}
