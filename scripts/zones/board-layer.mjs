/**
 * Draws what board.mjs shows on the map above the tokens: marks on tokens (a ring, a label, a bar, state chips, dimming), lines
 * from one thing to another with a reticle on the target, and the route of a move under the pointer.
 *
 * The look is the highlights' (highlight-layer.mjs): a coloured line on a dark one, light text on a dark pill rimmed in the colour,
 * the same named colours. Everything keeps its size on screen; on a token that is small on screen it shrinks with the token.
 *
 * PERF: a token's marks are children of the token itself, so they follow it for free while it moves; they are built when the marks
 * change and laid out again only when the zoom changes. Lines and the route are one Graphics each, drawn again when they change, at
 * a zoom step, and (lines only) on a frame in which one of their tokens moved. Nothing runs per frame while nothing moves: no
 * ticker, no filter, no mask, no texture of its own. Dimming is a tint on the token's own mesh (no extra draw).
 */

import { pattern, iconFont } from "./display.mjs";
import { STATE_MARKS, pullIn, bowed } from "./board-core.mjs";
import { shortLabel } from "./highlight.mjs";

const INK = 0x15110f, PAPER = 0xf3e7c9, DIM = 0x5d5a63;
const res = () => Math.min(4, Math.max(2, 2 * (globalThis.devicePixelRatio || 1)));
const zoomNow = () => Math.max(0.05, canvas.stage?.scale.x ?? 1);

/** The glyph of a mark: [text, fontFamily | null]. A known name, a Font Awesome class looked up in the page, else its first letter. */
const glyphs = new Map();
export function glyphOf(icon) {
  const fa = iconFont();
  const known = STATE_MARKS[icon];
  if ( known ) return fa ? [known[0], fa] : [known[1], null];
  if ( glyphs.has(icon) ) return glyphs.get(icon);
  let out = [String(icon).replace(/^fa-(solid|regular|light|duotone|brands)\s+/, "").replace(/^fa-/, "").slice(0, 1).toUpperCase() || "?", null];
  if ( fa && /(^|\s)fa-/.test(icon) && typeof document?.createElement === "function" && typeof getComputedStyle === "function" ) {
    try {
      const i = document.createElement("i");
      i.className = icon; i.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
      document.body.append(i);
      const c = getComputedStyle(i, "::before").content ?? "";
      i.remove();
      // (Font Awesome 6.7+ writes the glyph, a slash and its alternative text: "X" / "")
      const m = /^\s*(["'])(.*?)\1/.exec(c), ch = m ? m[2] : "";
      if ( ch ) out = [ch, fa];
    } catch {}
  }
  glyphs.set(icon, out);
  return out;
}

/** A pill: light text on a dark ground rimmed in a colour. Returns the container (its middle at 0, 0) with `.w`, `.h`. */
function pill(str, color, { size = 14, icon = null, h = 21 } = {}) {
  const c = new PIXI.Container(), G = new PIXI.Graphics();
  const T = new PIXI.Text(shortLabel(str ?? ""), { fontFamily: "Signika, sans-serif", fontWeight: "700", fontSize: size, fill: PAPER });
  T.resolution = res(); T.anchor.set(0.5, 0.52);
  let iw = 0, I = null;
  if ( icon ) {
    const [g, font] = glyphOf(icon);
    I = new PIXI.Text(g, { fontFamily: font ? `"${font}"` : "Signika, sans-serif", fontWeight: "900", fontSize: size - 2, fill: color });
    I.resolution = res(); I.anchor.set(0.5, 0.52);
    iw = I.width + (str ? 5 : 0);
  }
  const w = Math.max(22, (str ? T.width : 0) + iw + 14);
  G.lineStyle({ width: 1.6, color, alpha: 1 }).beginFill(INK, 0.92).drawRoundedRect(-w / 2, -h / 2, w, h, h / 2).endFill();
  c.addChild(G);
  if ( I ) { I.position.set(-w / 2 + 7 + I.width / 2, 0); c.addChild(I); }
  if ( str ) { T.position.set(iw / 2, 0); c.addChild(T); }
  c.w = w; c.h = h;
  return c;
}

/* ---------------------------------------------------------------- marks on a token */

/** How big one overlay unit is on this token, in scene px: a screen pixel, held between two shares of the token's width. */
const unitOf = (t, zoom) => Math.max(t.w / 230, Math.min(1 / zoom, t.w / 58));

/**
 * Put an entry's marks on a token (board-core cleanTokenMarks entry; null: take them off). `hover`: the pointer is on the token
 * (its hover parts show). Built again only when the entry or `hover` changed.
 */
export function markToken(t, e, hover = false) {
  if ( !t || t.destroyed ) return;
  const key = e ? `${e.key}|${hover ? 1 : 0}` : null;
  if ( t._mmBoard && !t._mmBoard.destroyed && t._mmBoard.key === key ) { layoutToken(t); return; }
  if ( t._mmBoard ) { if ( !t._mmBoard.destroyed ) t._mmBoard.destroy({ children: true }); t._mmBoard = null; }
  dimToken(t, !!e && e.state === "out");
  if ( !e ) return;
  const c = new PIXI.Container();
  c.eventMode = "none"; c.interactiveChildren = false; c.key = key; c.e = e;
  c.ring = c.addChild(new PIXI.Graphics());
  const label = (hover && e.hover?.label) || e.label, bar = (hover && e.hover?.bar) || e.bar;
  c.label = label ? c.addChild(pill(label, e.color, { size: 15, h: 23, icon: e.state === "out" ? "fa-solid fa-ban" : null })) : e.state === "out" ? c.addChild(pill("", e.color, { size: 14, icon: "fa-solid fa-ban" })) : null;
  if ( bar ) {
    const b = c.bar = c.addChild(new PIXI.Container());
    b.spec = bar; b.G = b.addChild(new PIXI.Graphics());
    if ( bar.text ) {
      b.T = b.addChild(new PIXI.Text(bar.text, { fontFamily: "Signika, sans-serif", fontWeight: "700", fontSize: 11, fill: PAPER, stroke: INK, strokeThickness: 3, lineJoin: "round" }));
      b.T.resolution = res(); b.T.anchor.set(0.5, 0.5);
    }
  }
  c.chips = e.marks.map((m) => {
    const ch = new PIXI.Container(), G = new PIXI.Graphics(), [g, font] = glyphOf(m.icon);
    G.lineStyle({ width: 1.5, color: m.color, alpha: 1 }).beginFill(INK, 0.92).drawCircle(0, 0, 10).endFill();
    const T = new PIXI.Text(g, { fontFamily: font ? `"${font}"` : "Signika, sans-serif", fontWeight: "900", fontSize: 11, fill: m.color });
    T.resolution = res(); T.anchor.set(0.5, 0.5);
    ch.addChild(G, T);
    return c.addChild(ch);
  });
  t._mmBoard = t.addChild(c);
  layoutToken(t);
}

/** A token out of reach steps back: its picture is tinted dark (Foundry sets the tint again on a refresh: board.mjs re-applies). */
export function dimToken(t, on) {
  const m = t?.mesh;
  if ( !m || m.destroyed ) return;
  if ( on ) { m.tint = DIM; t._mmDim = true; }
  else if ( t._mmDim ) { t._mmDim = false; try { m.tint = t.document?.texture?.tint ?? 0xffffff; } catch { m.tint = 0xffffff; } }
}

/** Sizes and places for the zoom as it is (line widths and pills keep their size on screen). */
export function layoutToken(t) {
  const c = t?._mmBoard;
  if ( !c || c.destroyed ) return;
  const zoom = zoomNow(), u = unitOf(t, zoom), e = c.e, w = t.w, h = t.h;
  if ( c.u === u && c.tw === w && c.th === h && c.alt === !!t._mmAlt ) return;
  c.u = u; c.tw = w; c.th = h; c.alt = !!t._mmAlt;
  const R = c.ring, cx = w / 2, cy = h / 2, r = Math.max(w, h) / 2 + 3 * u;
  R.clear();
  if ( e.state === "in" || e.state === "chosen" || e.state === "caught" ) {
    const strong = e.state === "chosen";
    R.lineStyle({ width: (strong ? 8 : 6) * u, color: INK, alpha: 0.7 }).drawCircle(cx, cy, r);
    if ( e.state === "caught" ) {
      // a dashed ring: caught in an area, not aimed at
      R.lineStyle({ width: 3 * u, color: e.color, alpha: 1, cap: PIXI.LINE_CAP.ROUND });
      const n = 14;
      for ( let i = 0; i < n; i++ ) { const a0 = (i / n) * Math.PI * 2, a1 = a0 + (Math.PI * 2 / n) * 0.58; R.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r); R.arc(cx, cy, r, a0, a1); }
    } else {
      R.lineStyle({ width: (strong ? 4.5 : 3) * u, color: e.color, alpha: 1 }).drawCircle(cx, cy, r);
      if ( strong ) {
        // the one chosen: four ticks pointing in, a thin light line on the ring
        R.lineStyle({ width: 1.2 * u, color: PAPER, alpha: 0.9 }).drawCircle(cx, cy, r);
        R.lineStyle({ width: 4.5 * u, color: e.color, alpha: 1, cap: PIXI.LINE_CAP.ROUND });
        for ( const a of [0, 0.5, 1, 1.5] ) { const dx = Math.cos(a * Math.PI), dy = Math.sin(a * Math.PI); R.moveTo(cx + dx * (r + 2 * u), cy + dy * (r + 2 * u)); R.lineTo(cx + dx * (r + 9 * u), cy + dy * (r + 9 * u)); }
      }
    }
  }
  // above the token, bottom up: (the altitude tag of zones.mjs when it shows,) the bar, the label
  let y = c.alt ? -18 * Math.max(0.6, Math.min(2, w / 100)) : -3 * u;
  if ( c.bar ) {
    const b = c.bar, s = b.spec, bw = Math.max(54, Math.min(120, w / u)), bh = s.max > 0 ? 8 : 0, G = b.G;
    G.clear();
    if ( bh ) {
      const x0 = -bw / 2, f = (v) => (bw - 2) * (v / s.max);
      G.lineStyle({ width: 1, color: PAPER, alpha: 0.75 }).beginFill(INK, 0.92).drawRoundedRect(x0, -bh / 2, bw, bh, 3).endFill();
      G.lineStyle(0);
      const keep = s.value - s.lossMax;
      if ( keep > 0 ) G.beginFill(s.color, 1).drawRect(x0 + 1, -bh / 2 + 1, f(keep), bh - 2).endFill();
      // what may be lost (paler), what is expected to be lost (full red, a light line where it starts)
      if ( s.lossMax > s.loss ) G.beginFill(0xe06666, 0.45).drawRect(x0 + 1 + f(keep), -bh / 2 + 1, f(s.lossMax - s.loss), bh - 2).endFill();
      if ( s.loss > 0 ) G.beginFill(0xe06666, 1).drawRect(x0 + 1 + f(s.value - s.loss), -bh / 2 + 1, f(s.loss), bh - 2).endFill();
      if ( s.gain > 0 ) G.beginFill(0xd8ffd0, 0.9).drawRect(x0 + 1 + f(s.value), -bh / 2 + 1, f(s.gain), bh - 2).endFill();
      if ( s.lossMax > 0 ) G.lineStyle({ width: 1, color: PAPER, alpha: 0.9 }).moveTo(x0 + 1 + f(keep), -bh / 2).lineTo(x0 + 1 + f(keep), bh / 2);
    }
    if ( b.T ) b.T.position.set(0, bh ? -bh / 2 - 7 : -6);
    const tall = bh + (b.T ? 13 : 0);
    b.scale.set(u); b.position.set(cx, y - (bh / 2) * u);
    y -= (tall + 3) * u;
  }
  if ( c.label ) { c.label.scale.set(u); c.label.position.set(cx, y - (c.label.h / 2) * u); }
  // state chips: down the right edge (Foundry's own effect icons run down the left)
  c.chips.forEach((ch, i) => { ch.scale.set(u); ch.position.set(w - 1 * u, 10 * u + i * 22 * u); });
}

/** Take the marks off a token. */
export const unmarkToken = (t) => markToken(t, null);

/* ---------------------------------------------------------------- lines and the route (one layer above the tokens) */

export class BoardLayer {
  constructor() {
    this.root = new PIXI.Container();
    this.root.eventMode = "none"; this.root.interactiveChildren = false;
    this.root.zIndex = 900;
    this.linksG = this.root.addChild(new PIXI.Graphics());
    this.routeG = this.root.addChild(new PIXI.Graphics());
    this.pills = this.root.addChild(new PIXI.Container());
    this.routePills = this.root.addChild(new PIXI.Container());
    canvas.interface.addChild(this.root);
    this.links = []; this.route = null; this.zoom = 0;
  }

  /**
   * @param {Array} links   [{ a: {x, y, r} | null, b: {x, y, r, token: bool}, color, style, label, head }] in scene px (r: the rim to stop at)
   */
  setLinks(links) { this.links = links ?? []; this.drawLinks(); }

  drawLinks() {
    const G = this.linksG, zoom = zoomNow(), u = 1 / zoom;
    this.zoom = zoom;
    G.clear();
    for ( const c of this.pills.removeChildren() ) c.destroy({ children: true });
    const cap = { cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND };
    for ( const l of this.links ) {
      const b = l.b;
      // the target: a reticle around it (a ring and four ticks)
      if ( b.r > 0 ) {
        const r = b.r + 5 * u;
        G.lineStyle({ width: 6 * u, color: INK, alpha: 0.7 }).drawCircle(b.x, b.y, r);
        G.lineStyle({ width: 3 * u, color: l.color, alpha: 1, ...cap }).drawCircle(b.x, b.y, r);
        for ( const a of [0.25, 0.75, 1.25, 1.75] ) { const dx = Math.cos(a * Math.PI), dy = Math.sin(a * Math.PI); G.moveTo(b.x + dx * (r - 5 * u), b.y + dy * (r - 5 * u)); G.lineTo(b.x + dx * (r + 6 * u), b.y + dy * (r + 6 * u)); }
      }
      let mid = { x: b.x, y: b.y - (b.r + 18 * u) };
      if ( l.a ) {
        const a = l.a, [sx, sy] = pullIn(b.x, b.y, a.x, a.y, a.r + 4 * u), [ex, ey] = pullIn(a.x, a.y, b.x, b.y, b.r + 12 * u);
        const pts = bowed(sx, sy, ex, ey, 0.1);
        G.lineStyle({ width: 8 * u, color: INK, alpha: 0.72, ...cap }); G.moveTo(pts[0], pts[1]); for ( let i = 2; i < pts.length; i += 2 ) G.lineTo(pts[i], pts[i + 1]);
        G.lineStyle({ width: 3.6 * u, color: l.color, alpha: 1, ...cap });
        if ( l.style === "dashed" ) pattern(G, pts, [10 * u, 8 * u]); else { G.moveTo(pts[0], pts[1]); for ( let i = 2; i < pts.length; i += 2 ) G.lineTo(pts[i], pts[i + 1]); }
        if ( l.head ) this.#head(G, pts, l.color, u);
        // (the label rides the line; on a line too short to carry it - two tokens side by side - it goes under the target)
        const m = Math.floor(pts.length / 4) * 2;
        mid = Math.hypot(ex - sx, ey - sy) < 70 * u ? { x: b.x, y: b.y + b.r + 20 * u } : { x: pts[m], y: pts[m + 1] };
      }
      if ( l.label ) { const p = this.pills.addChild(pill(l.label, l.color, { size: 13 })); p.scale.set(u); p.position.set(mid.x, mid.y); }
    }
    this.#show();
  }

  /** An arrow head at the end of a polyline. */
  #head(G, pts, color, u) {
    const n = pts.length, ex = pts[n - 2], ey = pts[n - 1];
    let i = n - 4;
    while ( i > 0 && Math.hypot(ex - pts[i], ey - pts[i + 1]) < 6 * u ) i -= 2;
    const dx = ex - pts[i], dy = ey - pts[i + 1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, L = 15 * u, W = 7.5 * u;
    const tip = [ex + ux * 7 * u, ey + uy * 7 * u], bx = tip[0] - ux * L, by = tip[1] - uy * L;
    G.lineStyle({ width: 2.2 * u, color: INK, alpha: 0.85, join: PIXI.LINE_JOIN.ROUND });
    G.beginFill(color, 1).moveTo(tip[0], tip[1]).lineTo(bx - uy * W, by + ux * W).lineTo(bx + uy * W, by - ux * W).closePath().endFill();
  }

  /**
   * The route of a move under the pointer.
   * @param {object|null} r   { runs: [{ pts, jump }], color, marks: [{ x, y }] (where borders are crossed), chips: [{ x, y, text, color, icon }] }
   */
  setRoute(r) { this.route = r; this.drawRoute(); }

  drawRoute() {
    const G = this.routeG, r = this.route, u = 1 / zoomNow();
    G.clear();
    for ( const c of this.routePills.removeChildren() ) c.destroy({ children: true });
    if ( r ) {
      const cap = { cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND };
      const line = (pts) => { G.moveTo(pts[0], pts[1]); for ( let i = 2; i < pts.length; i += 2 ) G.lineTo(pts[i], pts[i + 1]); };
      for ( const run of r.runs ) { G.lineStyle({ width: 9 * u, color: INK, alpha: 0.7, ...cap }); line(run.pts); }
      for ( const run of r.runs ) {
        G.lineStyle({ width: 4.2 * u, color: r.color, alpha: 1, ...cap });
        if ( run.jump ) pattern(G, run.pts, [0.01, 10 * u]); else line(run.pts);
      }
      const last = r.runs[r.runs.length - 1];
      if ( last ) this.#head(G, last.pts, r.color, u);
      G.lineStyle({ width: 1.6 * u, color: INK, alpha: 0.9 });
      for ( const m of r.marks ?? [] ) G.beginFill(PAPER, 1).drawCircle(m.x, m.y, 4.2 * u).endFill();
      for ( const ch of r.chips ?? [] ) { const p = this.routePills.addChild(pill(ch.text, ch.color, { size: 13, icon: ch.icon ?? "warn" })); p.scale.set(u); p.position.set(ch.x, ch.y); }
    }
    this.#show();
  }

  #show() { this.root.visible = this.links.length > 0 || !!this.route; }

  /** The zoom moved: pills keep their size at once, lines are drawn again after a step of ~8 %. */
  onZoom() {
    if ( !this.root.visible ) return;
    const zoom = zoomNow();
    if ( zoom === this.zoom ) return;
    if ( Math.abs(Math.log(zoom / (this.zoom || zoom))) > 0.08 ) { this.drawLinks(); this.drawRoute(); return; }
    const u = 1 / zoom;
    for ( const p of this.pills.children ) p.scale.set(u);
    for ( const p of this.routePills.children ) p.scale.set(u);
  }

  destroy() { if ( !this.root.destroyed ) this.root.destroy({ children: true }); }
}
