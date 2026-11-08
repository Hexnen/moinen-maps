/**
 * Shows the zones on the map: a soft tint per zone (neighbours never share a tint), the borders as a dark line with a light dotted
 * line over it (the way printed action maps mark zone borders), and a numbered badge in each zone. While a token is selected the
 * badges show how far each zone is from it and what reaching it costs (the scene's movement preset).
 *
 * One container in the primary group above the roads (245) and districts (250), under tiles, drawings and tokens.
 */

import { cornerPoint } from "./geometry.mjs";
import { pairKey } from "./marks.mjs";

/** Zone states as a tint over the zone (colour, alpha). */
const STATE_TINT = { fire: [0xff5a1f, 0.3], dark: [0x05050a, 0.45], ice: [0xbfe8ff, 0.3], flooded: [0x2f7fd6, 0.32], wrecked: [0x6b5b4b, 0.32], lowgrav: [0xb48cff, 0.2], water: [0x2f7fd6, 0.18] };
/** Icons under a zone's number: Font Awesome glyphs when that font is loaded, emoji otherwise. */
const ICONS = [
  ["building", "\uf1ad", "🏢"], ["tall", "\uf1bb", "🌲"], ["water", "\uf773", "🌊"],
  ["wrecked", "\ue3b1", "🏚"], ["fire", "\uf06d", "🔥"], ["dark", "\uf186", "🌑"], ["ice", "\uf2dc", "❄"], ["flooded", "\ue50e", "🌊"], ["lowgrav", "\uf56b", "🪶"]
];
const ICON_COLOR = { fire: 0xffa25a, dark: 0xb9b3d6, ice: 0xbfe8ff, flooded: 0x8cc4ff, water: 0x8cc4ff, wrecked: 0xc9b69a, lowgrav: 0xd2b8ff };
let faFamily;
function iconFont() {
  if ( faFamily !== undefined ) return faFamily;
  faFamily = null;
  for ( const f of ["Font Awesome 6 Pro", "Font Awesome 6 Free", "Font Awesome 7 Pro", "Font Awesome 7 Free"] ) {
    try { if ( document.fonts.check(`900 16px "${f}"`) && [...document.fonts].some((ff) => ff.family.replace(/"/g, "") === f && ff.status === "loaded") ) { faFamily = f; break; } } catch {}
  }
  return faFamily;
}
/** Wall kinds: [under-line width, light line width, dark core width] in multiples of the border width. */
const WALL = { door: [1.7, 1.0, 0], locked: [1.7, 1.0, 0], wall: [1.7, 1.0, 0], outer: [2.3, 1.5, 0], reinforced: [2.7, 1.7, 0.55] };

/** A badge's radius on screen (CSS pixels): drawn once at this size, scaled by 1 / zoom. */
const BADGE_R = 19;

const TINTS = [0xd9a441, 0x5aa9c9, 0x9bc46b, 0xc97b9b, 0x8c7bd1, 0xd47a4a, 0x6fc2b0];

function trace(G, p) { G.moveTo(p[0], p[1]); for ( let i = 2; i < p.length; i += 2 ) G.lineTo(p[i], p[i + 1]); }

function ring(G, p) { G.moveTo(p[0], p[1]); for ( let i = 2; i < p.length; i += 2 ) G.lineTo(p[i], p[i + 1]); G.closePath(); }

/** A polyline drawn as a repeating pattern of on/off lengths: [on, off] dashes, [0.01, gap] dots (round caps), [a, b, c, d] dash-dot. */
function pattern(G, p, pat) {
  let k = 0, on = true, left = pat[0];
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
      if ( left <= 1e-6 ) { k = (k + 1) % pat.length; on = k % 2 === 0; left = pat[k]; if ( on ) G.moveTo(x, y); }
    }
  }
}

/**
 * A copy of a polyline that wanders slowly to either side (for the hand-drawn border): an offset along the normal that changes with
 * the distance walked (wavelengths of ~40 and ~17 screen px), different per seed. Ends stay put.
 */
function wobble(p, amp, seed, px) {
  const out = p.slice(), n = p.length;
  let s = 0;
  for ( let i = 2; i < n - 2; i += 2 ) {
    s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    const dx = p[i + 2] - p[i - 2], dy = p[i + 3] - p[i - 1], L = Math.hypot(dx, dy) || 1;
    const u = s / px, off = amp * (Math.sin(u / 6.4 + seed * 2.1) * 0.7 + Math.sin(u / 2.7 + seed * 5.3) * 0.3);
    out[i] += (-dy / L) * off; out[i + 1] += (dx / L) * off;
  }
  return out;
}

/** The badge under a zone number: its outline in the ring colour over a dark fill ("plain": no badge). */
function badgeShape(G, shape, ring, fill, capFill = null) {
  if ( shape === "plain" ) return;
  const r = BADGE_R;
  G.lineStyle({ width: r * 0.16, color: ring, alpha: 0.95, join: PIXI.LINE_JOIN.ROUND });
  G.beginFill(0x15110f, fill);
  if ( shape === "square" ) G.drawRoundedRect(-r * 0.92, -r * 0.92, r * 1.84, r * 1.84, r * 0.28);
  else if ( shape === "hex" ) G.drawPolygon([...Array(6)].flatMap((_, i) => { const a = Math.PI / 6 + (i * Math.PI) / 3; return [Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05]; }));
  else if ( shape === "diamond" ) G.drawPolygon([0, -r * 1.25, r * 1.25, 0, 0, r * 1.25, -r * 1.25, 0]);
  // a comic caption box: yellow (or the distance colour), square corners, a black frame and a hard offset shadow
  else if ( shape === "caption" ) {
    G.lineStyle(0); G.beginFill(0x15110f, 0.9).drawRect(-r * 1.05 + r * 0.18, -r * 0.8 + r * 0.18, r * 2.1, r * 1.6).endFill();
    G.lineStyle({ width: r * 0.12, color: 0x15110f, alpha: 1, join: PIXI.LINE_JOIN.MITER });
    G.beginFill(capFill ?? 0xf7d64a, 1).drawRect(-r * 1.05, -r * 0.8, r * 2.1, r * 1.6);
  }
  else G.drawCircle(0, 0, r);
  G.endFill();
}

/** A zone number written as asked: 7, VII or G (27 -> AA). */
export function numeral(n, format) {
  if ( format === "roman" && n < 4000 ) {
    let out = "";
    for ( const [v, sym] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] ) while ( n >= v ) { out += sym; n -= v; }
    return out;
  }
  if ( format === "letters" ) { let out = ""; while ( n > 0 ) { n--; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); } return out; }
  return String(n);
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
    this.states = new PIXI.Graphics();
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
    this.root.addChild(this.fill, this.states, this.hi, this.lines, this.badges);
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
   * @param {object} [o.marks]                 Marks.resolve(): borders (walls, doors) and zone features / states
   */
  render(Z, look, g, { dist = null, bands = null, here = -1, hover = -1, editing = false, zoom = 1, marks = null } = {}) {
    const F = this.fill;
    F.clear(); this.lines.clear(); this.states.clear();
    this.M = marks; this.editing = editing;
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
    // zone states (and water) as a tint of their own over the zone
    for ( const z of Z.zones ) {
      const p = marks?.zones.get(z.id);
      if ( !p ) continue;
      for ( const k of ["water", "flooded", "wrecked", "ice", "lowgrav", "fire", "dark"] ) {
        if ( !p[k] ) continue;
        const [c, a] = STATE_TINT[k];
        for ( const part of z.parts ) {
          this.states.beginFill(c, k === "fire" ? Math.min(0.55, a + 0.02 * (p.fire - 6)) : a);
          ring(this.states, part[0]);
          for ( const h of part.slice(1) ) { this.states.beginHole(); ring(this.states, h); this.states.endHole(); }
          this.states.endFill();
        }
      }
    }
    this.drawLines(zoom);

    // badges: the zone's number, or its distance from the selected token. Each badge is drawn once at its size ON SCREEN and scaled
    // by 1 / zoom every frame (follow), so it keeps its size smoothly while zooming, on a spot that stays put.
    const numbered = (id) => look.numbers === "always" || (look.numbers === "hover" && id === hover);
    const res = Math.min(4, Math.max(2, 2 * (globalThis.devicePixelRatio || 1)));
    // the icons keep one spot: under the badge's place whenever a badge can show there (numbers always / on hover, distances),
    // so a number appearing on hover never pushes them down
    this.#icons(Z, marks, res, () => !!dist || look.numbers !== "never");
    if ( look.numbers === "never" && !dist ) { this.follow(zoom, true); return; }
    for ( const z of Z.zones ) {
      const d = dist ? dist.get(z.id) : null;
      const band = bands?.get(z.id), blocked = band?.key === "blocked";
      if ( d == null && !blocked && !numbered(z.id) ) continue;
      const text = blocked ? "×" : d != null ? String(d) : numeral(z.id + 1, look.numFormat);
      const b = new PIXI.Container();
      const G = new PIXI.Graphics();
      const numCol = look.numColor ? hex(look.numColor) : light, ringBase = look.ringColor ? hex(look.ringColor) : light;
      const ringCol = band ? band.color : ringBase, shape = look.numShape ?? "circle";
      badgeShape(G, shape, ringCol, d != null || blocked ? 0.85 : 0.6, band ? band.color : null);
      b.addChild(G);
      // long numerals (roman) shrink to fit; a plain number gets a dark outline instead of a badge
      const size = BADGE_R * (text.length > 3 ? 0.62 : text.length > 2 ? 0.78 : text.length > 1 ? 1.0 : 1.2) * (shape === "plain" ? 1.25 : 1);
      const t = new PIXI.Text(text, { fontFamily: "Signika, sans-serif", fontWeight: "700", fontSize: Math.round(size), fill: shape === "caption" ? 0x15110f : d != null || blocked ? ringCol : numCol, align: "center", ...(shape === "caption" ? { fontFamily: "'Bangers', 'Comic Sans MS', Signika, sans-serif", fontWeight: "700", letterSpacing: 1 } : {}),
        ...(shape === "plain" ? { stroke: 0x15110f, strokeThickness: Math.round(BADGE_R * 0.28), lineJoin: "round" } : {}) });
      t.resolution = res; t.anchor.set(0.5, 0.52);
      b.addChild(t);
      b.alpha = d == null && dist && !blocked ? 0.45 : 1;
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
    const px = 1 / Math.max(0.05, zoom), ink = look.ink, w = 5.5 * px * ink, col = hex(look.color), a = Math.min(1, 0.95 * ink);
    const R = { cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND };
    const stroke = (width, color, alpha, draw) => { Ln.lineStyle({ width, color, alpha, ...R }); for ( const p of Z.core ) draw(p); };
    const under = (k = 1) => stroke(w * k, 0x15110f, Math.min(1, 0.55 * ink), (p) => trace(Ln, p));
    switch ( look.lineStyle ) {
      case "solid": under(); stroke(w * 0.45, col, a, (p) => trace(Ln, p)); break;
      case "dotted": under(0.8); stroke(w * 0.5, col, a, (p) => pattern(Ln, p, [0.01 * px, 7 * px])); break;
      case "dashdot": under(); stroke(w * 0.45, col, a, (p) => pattern(Ln, p, [14 * px, 5 * px, 0.01 * px, 5 * px])); break;
      // two light lines: a wide light line split by a dark core
      case "double": under(1.5); stroke(w * 0.95, col, a, (p) => trace(Ln, p)); stroke(w * 0.35, 0x15110f, Math.min(1, 0.8 * ink), (p) => trace(Ln, p)); break;
      // a soft halo in the border colour around a thin bright core, no dark under-line
      case "glow": stroke(w * 3.2, col, 0.1 * a, (p) => trace(Ln, p)); stroke(w * 1.9, col, 0.18 * a, (p) => trace(Ln, p)); stroke(w * 0.4, col, a, (p) => trace(Ln, p)); break;
      // hand-drawn: two thin, slightly wandering passes
      case "sketch": under(0.7); stroke(w * 0.3, col, 0.8 * a, (p) => trace(Ln, wobble(p, 1.8 * px, 1, px))); stroke(w * 0.25, col, 0.65 * a, (p) => trace(Ln, wobble(p, 2.2 * px, 2, px))); break;
      // comic panels: every border is a gutter of paper between two black panel frames; the zones' outer edges are a frame alone
      case "comic": {
        const gw = Math.max(11, 17 * ink) * px, fw = Math.max(2, 3.5 * ink) * px;
        const outer = (width, color) => { Ln.lineStyle({ width, color, alpha: 1, ...R }); for ( const br of Z.borders ) if ( br.b < 0 || br.edge ) { Ln.moveTo(br.pts[0], br.pts[1]); Ln.lineTo(br.pts[2], br.pts[3]); } };
        outer(fw * 2.2, 0x15110f);
        stroke(gw + fw * 2, 0x15110f, 1, (p) => trace(Ln, p));
        stroke(gw, col, 1, (p) => trace(Ln, p));
        break;
      }
      default: under(); stroke(w * 0.45, col, a, (p) => pattern(Ln, p, [11 * px, 7 * px]));
    }
    this.#walls(Ln, px, w, col);
  }

  /** Walls over the borders the GM marked (thicker, solid), and a door symbol across a door; sizes on screen like the lines. */
  #walls(Ln, px, w, col) {
    const M = this.M, Z = this.Z;
    if ( !M?.borders.size ) return;
    const R = { cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND };
    const segs = new Map();
    for ( const br of Z.borders ) {
      if ( br.edge || br.b < 0 ) continue;
      const m = M.borders.get(pairKey(br.a, br.b));
      if ( m ) (segs.get(m) ?? segs.set(m, []).get(m)).push(br.pts);
    }
    // walls stand out from the plain borders whatever the line width is set to
    const bw = Math.max(w, 7 * px);
    for ( const pass of [0, 1, 2] ) {
      for ( const [m, list] of segs ) {
        const k = WALL[m.kind][pass];
        if ( !k ) continue;
        Ln.lineStyle({ width: bw * k, color: pass === 1 ? (m.kind === "reinforced" ? 0xcfd6dc : col) : 0x15110f, alpha: pass === 0 ? 0.8 : 1, ...R });
        for ( const s of list ) { Ln.moveTo(s[0], s[1]); Ln.lineTo(s[2], s[3]); }
      }
    }
    // doors: a short plank across the wall where the mark sits, a locked one red with a keyhole
    for ( const [m, list] of segs ) {
      if ( m.kind !== "door" && m.kind !== "locked" ) continue;
      let best = list[0], bd = Infinity;
      for ( const s of list ) { const d = Math.hypot((s[0] + s[2]) / 2 - m.x, (s[1] + s[3]) / 2 - m.y); if ( d < bd ) { bd = d; best = s; } }
      const ux0 = best[2] - best[0], uy0 = best[3] - best[1], L = Math.hypot(ux0, uy0) || 1, ux = ux0 / L, uy = uy0 / L;
      const hl = 9 * px, hw = 4.5 * px, x = m.x, y = m.y;
      const quad = [x - ux * hl - uy * hw, y - uy * hl + ux * hw, x + ux * hl - uy * hw, y + uy * hl + ux * hw, x + ux * hl + uy * hw, y + uy * hl - ux * hw, x - ux * hl + uy * hw, y - uy * hl - ux * hw];
      Ln.lineStyle({ width: 2 * px, color: 0x15110f, alpha: 1, ...R });
      Ln.beginFill(m.kind === "locked" ? 0xb8402e : 0x9a6a3a, 1).drawPolygon(quad).endFill();
      if ( m.kind === "locked" ) { Ln.lineStyle(0); Ln.beginFill(0xf3e7c9, 1).drawCircle(x, y, 1.8 * px).endFill(); }
    }
  }

  /** A row of small icons under a zone's number: its features and states (the terrain only for the GM while editing). */
  #icons(Z, M, res, hasBadge) {
    if ( !M?.zones.size ) return;
    const fa = iconFont();
    for ( const z of Z.zones ) {
      const p = M.zones.get(z.id);
      if ( !p ) continue;
      const parts = ICONS.filter(([k]) => p[k]).map(([k, g, e]) => ({ k, s: fa ? g : e }));
      const terrain = this.editing && p.terrain ? p.terrain : null;
      if ( !parts.length && !terrain ) continue;
      const row = new PIXI.Container();
      const size = 15, gap = 4;
      let x = 0;
      const back = new PIXI.Graphics();
      row.addChild(back);
      for ( const it of parts ) {
        const t = new PIXI.Text(it.s, { fontFamily: fa ? `"${fa}"` : "sans-serif", fontWeight: "900", fontSize: size, fill: ICON_COLOR[it.k] ?? 0xf3e7c9 });
        t.mmKey = it.k;
        t.resolution = res; t.anchor.set(0, 0.5); t.position.set(x, 0);
        row.addChild(t); x += t.width + gap;
        if ( it.k === "building" && p.floors && !p.wrecked ) {
          const n = new PIXI.Text(`${p.floors + 1}`, { fontFamily: "Signika, sans-serif", fontWeight: "700", fontSize: 12, fill: 0xf3e7c9 });
          n.resolution = res; n.anchor.set(0, 0.5); n.position.set(x - 2, 1); n.mmKey = "building"; row.addChild(n); x += n.width + gap;
        }
        if ( it.k === "fire" ) {
          const n = new PIXI.Text(String(p.fire), { fontFamily: "Signika, sans-serif", fontWeight: "700", fontSize: 12, fill: 0xffa25a });
          n.mmKey = "fire";
          n.resolution = res; n.anchor.set(0, 0.5); n.position.set(x - 2, 1); row.addChild(n); x += n.width + gap;
        }
      }
      if ( terrain ) {
        const n = new PIXI.Text(game.i18n.localize(`MOINENMAPS.Zones.terrainShort.${terrain}`), { fontFamily: "Signika, sans-serif", fontWeight: "600", fontSize: 11, fill: 0xd8ccb0 });
        n.mmKey = "terrain";
        n.resolution = res; n.anchor.set(0, 0.5); n.position.set(x, 0); row.addChild(n); x += n.width + gap;
      }
      x -= gap;
      back.beginFill(0x15110f, 0.7).drawRoundedRect(-5, -11, x + 10, 22, 8).endFill();
      for ( const c of row.children ) c.x -= x / 2;
      this.badges.addChild(row);
      // under the badge when there is one, else on the zone's spot
      this.items.push({ b: row, z, at: null, dy: hasBadge(z.id) ? BADGE_R + 15 : 0, icons: true });
    }
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
      const s = rw / BADGE_R;
      it.b.scale.set(s);
      if ( snap || !it.at ) it.at = corner ? cornerPoint(it.z, Math.min(it.z.label.r * 0.9, g * 0.55)) : it.z.label;
      it.b.position.set(it.at.x, it.at.y + (it.dy ?? 0) * s);
    }
  }

  /** The icon under a point of the canvas view (CSS px from its top left): { key, z } or null. */
  iconAt(x, y) {
    if ( !this.root.visible ) return null;
    for ( const it of this.items ?? [] ) {
      if ( !it.icons || !it.b.visible ) continue;
      for ( const c of it.b.children ) {
        if ( !c.mmKey ) continue;
        const r = c.getBounds();
        if ( x >= r.x - 2 && x <= r.x + r.width + 2 && y >= r.y - 2 && y <= r.y + r.height + 2 ) return { key: c.mmKey, z: it.z };
      }
    }
    return null;
  }

  set visible(v) { this.root.visible = v; }

  destroy() { canvas.app?.ticker?.remove(this.watch); if ( !this.root.destroyed ) { this.#softTex(); this.root.destroy({ children: true }); } }
}
