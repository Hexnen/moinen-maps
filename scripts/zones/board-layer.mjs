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
import { piecesRow } from "./signs-pixi.mjs";

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
function pill(str, color, { size = 14, icon = null, h = 21, pieces = null } = {}) {
  const c = new PIXI.Container(), G = new PIXI.Graphics();
  // (section 40: the words as words and signs, when the caller gave them for these words)
  let T;
  if ( str && pieces?.length ) { const row = piecesRow(pieces, { fontSize: size, fill: PAPER, resolution: res(), glyph: Math.round(size * 0.9) }); T = row.c; T.pivot.x = row.w / 2; T.width0 = row.w; }
  else { T = new PIXI.Text(shortLabel(str ?? ""), { fontFamily: "Signika, sans-serif", fontWeight: "700", fontSize: size, fill: PAPER }); T.resolution = res(); T.anchor.set(0.5, 0.52); }
  let iw = 0, I = null;
  if ( icon ) {
    const [g, font] = glyphOf(icon);
    I = new PIXI.Text(g, { fontFamily: font ? `"${font}"` : "Signika, sans-serif", fontWeight: "900", fontSize: size - 2, fill: color });
    I.resolution = res(); I.anchor.set(0.5, 0.52);
    iw = I.width + (str ? 5 : 0);
  }
  const w = Math.max(22, (str ? T.width0 ?? T.width : 0) + iw + 14);
  G.lineStyle({ width: 1.6, color, alpha: 1 }).beginFill(INK, 0.92).drawRoundedRect(-w / 2, -h / 2, w, h, h / 2).endFill();
  c.addChild(G);
  if ( I ) { I.position.set(-w / 2 + 7 + I.width / 2, 0); c.addChild(I); }
  if ( str ) { T.position.set(iw / 2, 0); c.addChild(T); }
  c.w = w; c.h = h;
  return c;
}

/**
 * Section 42: THE RING AS A METER (U133: the chance of a target, "n of 4"). `of` parts from the top, clockwise, `n` of them full,
 * the rest empty; drawn on G around (cx, cy) at radius r (meterRadius).
 *  - INSIDE the token's square: two tokens side by side (a row, a crowd) never cross rings, and the parts' gaps fall on the top,
 *    right, bottom and left, where two rings would meet edge to edge.
 *  - full: a heavy line in the entry's colour on a dark one; empty: a hairline on a thin dark one. How much of the ring is heavy is
 *    the reading (a quarter, a half, three quarters, all of it): one colour, never a colour alone.
 *  - `chosen`: the full parts heavier with a light line along them and short ticks pointing in from the gaps (a reticle);
 *    `caught` (in an area, not aimed at): the full parts dashed, two dashes each, so a part still reads as one.
 */
const meterHeavy = (e, u) => (e.state === "chosen" ? 8.5 : 7) * u;
const meterRadius = (w, h, e, u) => Math.min(w, h) / 2 - (meterHeavy(e, u) + 4 * u) / 2 - 0.5 * u;
function meterRing(G, cx, cy, r, m, e, u) {
  const seg = (Math.PI * 2) / m.of, gap = Math.min(0.42, seg * 0.26), strong = e.state === "chosen", dashed = e.state === "caught";
  const heavy = meterHeavy(e, u), thin = 1.6 * u;
  const arc = (a0, a1) => { G.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r); G.arc(cx, cy, r, a0, a1); };
  const part = (i, width, col, alpha, dash) => {
    const a0 = -Math.PI / 2 + i * seg + gap / 2, a1 = a0 + seg - gap;
    G.lineStyle({ width, color: col, alpha, cap: PIXI.LINE_CAP.BUTT });
    if ( !dash ) { arc(a0, a1); return; }
    const k = 2, step = (a1 - a0) / k;
    for ( let j = 0; j < k; j++ ) arc(a0 + j * step + (j ? step * 0.14 : 0), a0 + (j + 1) * step - (j + 1 < k ? step * 0.14 : 0));
  };
  // (the dark under everything first, then the colour: a dark line never cuts across a coloured one)
  for ( let i = 0; i < m.of; i++ ) part(i, i < m.n ? heavy + 4 * u : thin + 2.4 * u, INK, i < m.n ? 0.85 : 0.6, false);
  for ( let i = 0; i < m.of; i++ ) part(i, i < m.n ? heavy : thin, e.color, i < m.n ? 1 : 0.85, dashed && i < m.n);
  if ( strong ) {
    for ( let i = 0; i < m.n; i++ ) part(i, 1.4 * u, PAPER, 0.9, false);
    const r0 = r - heavy / 2 + 1 * u, r1 = r0 - 7 * u, ticks = (width, color, alpha) => {
      G.lineStyle({ width, color, alpha, cap: PIXI.LINE_CAP.ROUND });
      for ( let i = 0; i < m.of; i++ ) { const a = -Math.PI / 2 + i * seg, dx = Math.cos(a), dy = Math.sin(a); G.moveTo(cx + dx * r0, cy + dy * r0); G.lineTo(cx + dx * r1, cy + dy * r1); }
    };
    ticks(7 * u, INK, 0.85); ticks(4 * u, e.color, 1);
  }
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
  // (a label moved by the layout keeps its spot while the marks are built again - the pointer came onto the token - until the next layout)
  const shift = t._mmBoard?.shift ?? null;
  if ( t._mmBoard ) { dropLift(t._mmBoard); if ( !t._mmBoard.destroyed ) t._mmBoard.destroy({ children: true }); t._mmBoard = null; }
  dimToken(t, !!e && e.state === "out");
  if ( !e ) return;
  const c = new PIXI.Container();
  c.eventMode = "none"; c.interactiveChildren = false; c.key = key; c.e = e; c.shift = shift;
  c.ring = c.addChild(new PIXI.Graphics());
  const hl = hover && e.hover?.label, label = hl || e.label, bar = (hover && e.hover?.bar) || e.bar, pieces = hl ? e.hover.signs?.label : e.signs?.label;
  c.label = label ? c.addChild(pill(label, e.color, { size: 15, h: 23, icon: e.state === "out" ? "fa-solid fa-ban" : null, pieces })) : e.state === "out" ? c.addChild(pill("", e.color, { size: 14, icon: "fa-solid fa-ban" })) : null;
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
  // (section 42: the ring when it is a meter is lifted with the label, over a neighbour's picture that overlaps the square. Without
  //  a meter, exactly as before: the ring stays with its token)
  if ( c.label || e.meter ) liftLabel(c, { ring: !!e.meter });
  layoutToken(t);
}

/* ---- U125 (a): the labels above every token's picture. A token's pill used to be drawn with its token, so a token drawn later
   cut it away (a boxed-in token's label lifted over a neighbour, its tie line going under that neighbour's picture). The pill and
   its tie line now live in one container of the interface group above the token layer (zIndex 901, over the lines' layer), placed
   at the token's spot on every layout; the token's own container keeps the ring, the bar and the chips. A label is shown only while
   its token is. */
let LIFT = null;
function liftRoot() {
  const ui = canvas?.interface;
  if ( !ui ) return null;
  if ( LIFT && !LIFT.destroyed && LIFT.parent === ui ) return LIFT;
  // (the interface group, after the token layer: a token object drawn later erases what lies under its shape in this group - its
  //  void mesh lets the picture of the primary group show through - so a pill inside an earlier token was cut away; out here it is
  //  not, and like the rest of the interface it is not lit, so it stays crisp in a dark or coloured scene. Just above the lines' layer)
  LIFT = new PIXI.Container();
  LIFT.eventMode = "none"; LIFT.interactiveChildren = false;
  LIFT.zIndex = 901;
  ui.addChild(LIFT);
  ui.sortDirty = true;
  return LIFT;
}
function liftLabel(c, { ring = false } = {}) {
  const root = liftRoot();
  if ( !root ) return;                                                                           // (no primary group: the label stays with its token)
  const L = c.lift = root.addChild(new PIXI.Container());
  L.eventMode = "none"; L.interactiveChildren = false;
  // (bottom up: the ring as a meter, the pill)
  if ( ring && c.ring ) L.addChild(c.ring);
  if ( c.label ) L.addChild(c.label);
  c.once?.("destroyed", () => dropLift(c));
  syncLift(c);
}
function dropLift(c) {
  const L = c?.lift;
  if ( !L ) return;
  c.lift = null;
  if ( !L.destroyed ) L.destroy({ children: true });
}
/** The lifted label stands where its token stands now (the token's animated spot) and shows while the token and its marks do. */
function syncLift(c) {
  const L = c?.lift, t = c?.parent;
  if ( !L || L.destroyed ) return;
  if ( !t || t.destroyed || c.destroyed ) { dropLift(c); return; }
  L.position.set(t.x, t.y);
  L.visible = !!t.visible && c.visible !== false && t.renderable !== false;
  L.alpha = t.alpha ?? 1;
}
/** One token's lifted label follows it (a refresh of the token: it walks, it is shown or hidden). */
export const followToken = (t) => { if ( t?._mmBoard?.lift ) syncLift(t._mmBoard); };
/** Every lifted label of every marked token, put back with its token (board.mjs: on each layout, after a pan, while tokens move). */
export function syncLifted() {
  if ( !LIFT || LIFT.destroyed ) return;
  for ( const t of canvas.tokens?.placeables ?? [] ) if ( t._mmBoard?.lift ) syncLift(t._mmBoard);
  // (a label whose token went without telling: its container was destroyed with the token)
  for ( const L of [...LIFT.children] ) if ( L.destroyed || !L.children.length ) L.destroy?.({ children: true });
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
  if ( (e.state === "in" || e.state === "chosen" || e.state === "caught") && e.meter ) meterRing(R, cx, cy, meterRadius(w, h, e, u), e.meter, e, u);
  else if ( e.state === "in" || e.state === "chosen" || e.state === "caught" ) {
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
  if ( c.label ) { c.label.scale.set(u); c.labelBase = { x: cx, y: y - (c.label.h / 2) * u, top: y }; placeLabel(c); }
  // state chips: down the right edge (Foundry's own effect icons run down the left)
  c.chips.forEach((ch, i) => { ch.scale.set(u); ch.position.set(w - 1 * u, 10 * u + i * 22 * u); });
}

/**
 * The label's spot after the layout of all the labels (board.mjs, room.mjs spreadLabels): moved by (dx, dy) scene px from where it
 * stands alone. A label moved off its token is tied to it by a thin line in its colour (which token it speaks of stays plain).
 */
export function shiftLabel(t, dx = 0, dy = 0) {
  const c = t?._mmBoard;
  if ( !c || c.destroyed || !c.label ) return;
  const s = c.shift ?? { dx: 0, dy: 0 };
  syncLift(c);
  if ( Math.abs(s.dx - dx) < 0.01 && Math.abs(s.dy - dy) < 0.01 ) return;
  c.shift = { dx, dy };
  placeLabel(c);
}
function placeLabel(c) {
  const b = c.labelBase, s = c.shift ?? { dx: 0, dy: 0 }, u = c.u ?? 1;
  if ( !b ) return;
  syncLift(c);
  c.label.position.set(b.x + s.dx, b.y + s.dy);
  const far = Math.hypot(s.dx, s.dy) > 4 * u;
  // (the tie line goes with the label: lifted above the pictures it crosses, under the pill itself)
  const host = c.lift && !c.lift.destroyed ? c.lift : c;
  if ( c.leader && c.leader.parent !== host ) { c.leader.destroy?.(); c.leader = null; }
  const G = c.leader ??= typeof host.addChildAt === "function" ? host.addChildAt(new PIXI.Graphics(), host === c ? 1 : 0) : host.addChild(new PIXI.Graphics());
  G.visible = true; G.clear();
  const hw = (c.label.w / 2) * u, hh = (c.label.h / 2) * u, lx = b.x + s.dx, ly = b.y + s.dy;
  if ( !far ) {
    // U125 (a): at home a small tail under the pill points down at its own token (tokens that touch: the pill between two reads as
    // the lower one's, the one it points at)
    const tw = 5 * u, th = 5 * u, y0 = ly + hh - 1.2 * u;
    G.lineStyle({ width: 1.6 * u, color: c.e.color, alpha: 1, join: PIXI.LINE_JOIN?.MITER }).beginFill(INK, 0.92).moveTo(lx - tw, y0).lineTo(lx, y0 + th).lineTo(lx + tw, y0).endFill();
    G.lineStyle(0);
    return;
  }
  // U125 (a): from the pill's edge nearest its token to the token's rim on the side that faces the pill (a dot there): a label moved
  // up a row ties to the top, one beside a panel to the side that comes out from under it, one under its token to the bottom
  const tw = c.tw ?? 0, th = c.th ?? 0, cx0 = tw / 2, cy0 = th / 2, R = Math.max(tw, th) / 2 + 3 * u;
  const dl = Math.hypot(lx - cx0, ly - cy0) || 1;
  const ex = cx0 + ((lx - cx0) / dl) * R, ey = Math.min(cy0 + ((ly - cy0) / dl) * R, ly > cy0 ? Infinity : b.top);
  const px = Math.max(lx - hw + hh, Math.min(lx + hw - hh, ex)), py = Math.max(ly - hh, Math.min(ly + hh, ey));
  G.lineStyle({ width: 4 * u, color: INK, alpha: 0.7, cap: PIXI.LINE_CAP.ROUND }).moveTo(px, py).lineTo(ex, ey);
  G.lineStyle({ width: 1.8 * u, color: c.e.color, alpha: 1, cap: PIXI.LINE_CAP.ROUND }).moveTo(px, py).lineTo(ex, ey);
  G.lineStyle(0).beginFill(c.e.color, 1).drawCircle(ex, ey, 2.6 * u).endFill();
}
/** Where a token's label stands now, in scene px (null: it has none): { x0, y0, x1, y1 } and where it would stand alone. */
export function labelBoxOf(t) {
  const c = t?._mmBoard;
  if ( !c || c.destroyed || !c.label || !c.labelBase ) return null;
  const u = c.u ?? 1, s = c.shift ?? { dx: 0, dy: 0 }, x = t.x + c.labelBase.x, y = t.y + c.labelBase.y, hw = (c.label.w / 2) * u, hh = (c.label.h / 2) * u;
  return { x, y, w: hw * 2, h: hh * 2, x0: x + s.dx - hw, y0: y + s.dy - hh, x1: x + s.dx + hw, y1: y + s.dy + hh };
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

  /** The lines' pills as they stand, in scene px: [{ x0, y0, x1, y1 }] (the tokens' labels keep clear of them: room.mjs). */
  pillBoxes() {
    if ( !this.root.visible ) return [];
    return this.pills.children.map((p) => { const s = p.scale?.x ?? 1, hw = ((p.w ?? 0) / 2) * s, hh = ((p.h ?? 0) / 2) * s; return { x0: p.position.x - hw, y0: p.position.y - hh, x1: p.position.x + hw, y1: p.position.y + hh }; });
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
      for ( const ch of r.chips ?? [] ) { const p = this.routePills.addChild(pill(ch.text, ch.color, { size: 13, icon: ch.icon ?? "warn", pieces: ch.pieces })); p.scale.set(u); p.position.set(ch.x, ch.y); }
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
