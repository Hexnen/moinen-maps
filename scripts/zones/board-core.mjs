/**
 * Interaction on the map - the pure part (no Foundry, no PIXI): what a set of token marks, a line between two things, a player's
 * armed intention and a menu at a thing are; which of them a user may be sent; the points of a route drawn through the zones.
 * The drawing is board-layer.mjs, the wiring (API, the module socket, the pointer) is board.mjs. For callers: dev/zones-api.md
 * (sections 25-33).
 *
 * The map DRAWS AND SENSES; it decides nothing. Every text, number and colour is the caller's (a combat module): a hit chance over
 * a token, why a target is out of reach, what an action costs. Who is shown what is the caller's too (`users`); the one thing the
 * map does on its own is hold back what names a token that is hidden from players when it sends to players (stripForPlayers).
 */

import { COLORS, colorOf, cleanUsers, zoneKeyOf, borderKeyOf, LIMITS } from "./highlight.mjs";
import { cleanSigns, cleanSign } from "./signs-core.mjs";

const ID_RE = /^[A-Za-z0-9_.:~-]{1,64}$/;
const text = (v, max) => { if ( v == null || v === "" ) return null; const s = String(v).replace(/\s+/g, " ").trim(); return s ? s.slice(0, max) : null; };
const num = (v) => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) ? n : null; };

export const TOKEN_STATES = ["in", "out", "chosen", "caught"];
export const BOARD_LIMITS = Object.freeze({ tokens: 200, marks: 6, links: 40, items: 24, label: 18, tip: 240, title: 60, intentTtl: 20000, intentMax: 120000 });

/**
 * The state marks the map knows how to draw: name -> [Font Awesome glyph, fallback sign, colour]. A caller may also name any
 * Font Awesome class ("fa-solid fa-ghost"): the glyph is looked up in the page (board-layer.mjs), the fallback is its first letter.
 */
export const STATE_MARKS = Object.freeze({
  broken: ["", "✖", COLORS.danger],        // heart-crack
  held: ["", "✊", COLORS.stress],          // hand (grabbed, snared, trapped)
  airborne: ["", "▲", COLORS.move],        // in the air
  barrier: ["", "◈", COLORS.range],        // under a barrier / shield
  reaction: ["", "◎", COLORS.target],      // the target of a reaction
  down: ["", "▬", COLORS.blocked],         // unconscious
  burning: ["", "♨", 0xffa25a],
  hidden: ["", "◌", COLORS.info],
  stunned: ["", "✶", COLORS.stress],
  warn: ["", "!", COLORS.danger]
});

/** The id of a token from whatever names one: an id, a uuid ("Scene.x.Token.y"), a Token, a TokenDocument, { token } or { id }. */
export function tokenIdOf(w) {
  if ( typeof w === "string" ) { const s = w.includes(".") ? w.split(".").pop() : w; return /^[A-Za-z0-9]{1,32}$/.test(s) ? s : null; }
  if ( w && typeof w === "object" ) {
    if ( w.token != null && w.token !== w ) return tokenIdOf(w.token);
    if ( w.document && w.document !== w ) return tokenIdOf(w.document);
    return typeof w.id === "string" ? tokenIdOf(w.id) : null;
  }
  return null;
}

/** A bar over a token, cleaned: { max, value, loss, lossMax, gain, color, text } with 0 <= value <= max; null: nothing to draw. */
export function cleanBar(b) {
  if ( !b || typeof b !== "object" ) return null;
  const max = num(b.max), t = text(b.text, BOARD_LIMITS.label);
  if ( !(max > 0) ) return t ? { max: 0, value: 0, loss: 0, lossMax: 0, gain: 0, color: colorOf(b.color, COLORS.free), text: t } : null;
  const cl = (v, hi) => Math.max(0, Math.min(hi, num(v) ?? 0));
  const value = cl(b.value ?? max, max), loss = cl(b.loss, value), lossMax = Math.max(loss, cl(b.lossMax ?? loss, value)), gain = cl(b.gain, max - value);
  return { max, value, loss, lossMax, gain, color: colorOf(b.color, COLORS.free), text: t };
}
function cleanMark(m) {
  const o = typeof m === "string" ? { icon: m } : m && typeof m === "object" ? m : null;
  const icon = text(o?.icon, 60);
  if ( !icon ) return null;
  return { icon, color: colorOf(o.color, STATE_MARKS[icon]?.[2] ?? COLORS.info), tip: text(o.tip, BOARD_LIMITS.tip) };
}
/** A token's label as its pill shows it: up to BOARD_LIMITS.label characters, a longer one ending in an ellipsis inside that (U116:
 *  a label cut with no sign of it read as another word - "Spor"). */
export function pillText(v) {
  const s = text(v, 400);
  return s && s.length > BOARD_LIMITS.label ? `${s.slice(0, BOARD_LIMITS.label - 1).trimEnd()}…` : s;
}
/** The whole label when the pill cuts it ({ full }), for the pointer's tip (section 41); {} when it fits. */
export function fullOf(v) {
  const s = text(v, 120);
  return s && s.length > BOARD_LIMITS.label ? { full: s } : {};
}
function cleanHover(h) {
  if ( !h || typeof h !== "object" ) return null;
  const out = { label: pillText(h.label), ...fullOf(h.label), tip: text(h.tip, BOARD_LIMITS.tip), bar: cleanBar(h.bar) };
  const signs = out.label ? cleanSigns(h.signs, { label: BOARD_LIMITS.label }) : null;
  if ( signs ) out.signs = signs;
  return out.label || out.tip || out.bar ? out : null;
}

/* ---- section 42 (U133): a caller's sign in the token's corner ---- */
/** A badge, cleaned: { sign (one sign of section 40, cleaned), name (what it is called: the sign's own name when not given) }. null:
 *  no sign that draws. */
export function cleanBadge(b) {
  if ( !b || typeof b !== "object" ) return null;
  const sign = cleanSign(b.sign);
  if ( !sign ) return null;
  return { sign, name: text(b.name, 120) ?? sign.name ?? null };
}

/**
 * A set of token marks, cleaned:
 *   { id, tokens: [{ token (id), state: "in" | "out" | "chosen" | "caught" | null, color, label, tip, marks: [{ icon, color, tip }],
 *                    bar, hover: { label, tip, bar, signs? } | null, signs?: { label } (section 40), badge? (section 42) }], users, order }
 * null: no id that can be kept, or no entry that names a token.
 */
export function cleanTokenMarks(spec, me = null) {
  if ( !spec || typeof spec !== "object" ) return null;
  const id = spec.id == null ? null : String(spec.id);
  if ( id != null && !ID_RE.test(id) ) return null;
  const dcol = spec.color, tokens = [], seen = new Set();
  for ( const e of Array.isArray(spec.tokens) ? spec.tokens.slice(0, BOARD_LIMITS.tokens) : [] ) {
    const token = tokenIdOf(e), o = e && typeof e === "object" && !e.documentName && !e.document ? e : {};
    if ( !token || seen.has(token) ) continue;
    seen.add(token);
    const state = TOKEN_STATES.includes(o.state) ? o.state : null;
    tokens.push({
      token, state, color: colorOf(o.color ?? dcol, state === "out" ? COLORS.blocked : state === "caught" ? COLORS.range : COLORS.target),
      label: pillText(o.label), ...fullOf(o.label), tip: text(o.tip, BOARD_LIMITS.tip),
      marks: (Array.isArray(o.marks) ? o.marks : []).map(cleanMark).filter(Boolean).slice(0, BOARD_LIMITS.marks),
      bar: cleanBar(o.bar), hover: cleanHover(o.hover),
      // (section 40: the label as words and signs; the pill shows them, the words stay for the rest)
      ...(o.label && cleanSigns(o.signs, { label: BOARD_LIMITS.label }) ? { signs: cleanSigns(o.signs, { label: BOARD_LIMITS.label }) } : {}),
      // (section 42: a sign in the token's corner; absent: nothing changes)
      ...(cleanBadge(o.badge) ? { badge: cleanBadge(o.badge) } : {})
    });
  }
  if ( !tokens.length ) return null;
  const order = Number.isFinite(Number(spec.order)) ? Number(spec.order) : 0;
  return { id, tokens, users: cleanUsers(spec.users, me), order };
}

/** One end of a line: { token } | { zone } | { x, y } | null. */
export function cleanEnd(w) {
  if ( w && typeof w === "object" && Number.isFinite(Number(w.x)) && Number.isFinite(Number(w.y)) && !w.document && !w.documentName && w.zone == null && w.token == null ) return { x: Number(w.x), y: Number(w.y) };
  if ( w && typeof w === "object" && w.zone != null && w.token == null ) { const z = zoneKeyOf(w); return z ? { zone: z } : null; }
  // (a bare string that reads as a zone key of this module - "z7" - names a zone; anything else a token)
  if ( typeof w === "string" && /^z\d+(:|$)/.test(w) ) return { zone: zoneKeyOf(w) };
  const t = tokenIdOf(w);
  return t ? { token: t } : null;
}

/**
 * Lines from one thing to another, cleaned:
 *   { id, links: [{ from, to (ends), color, style: "solid" | "dashed", label, head: bool }], users, order }
 */
export function cleanLinks(spec, me = null) {
  if ( !spec || typeof spec !== "object" ) return null;
  const id = spec.id == null ? null : String(spec.id);
  if ( id != null && !ID_RE.test(id) ) return null;
  const rows = Array.isArray(spec.links) ? spec.links : spec.from != null || spec.to != null ? [spec] : [];
  const links = [];
  for ( const e of rows.slice(0, BOARD_LIMITS.links) ) {
    const from = cleanEnd(e?.from), to = cleanEnd(e?.to);
    if ( !to ) continue;
    links.push({ from, to, color: colorOf(e.color ?? spec.color, COLORS.danger), style: (e.style ?? spec.style) === "dashed" ? "dashed" : "solid", label: text(e.label ?? null, LIMITS.label), head: e.head !== false });
  }
  if ( !links.length ) return null;
  const order = Number.isFinite(Number(spec.order)) ? Number(spec.order) : 0;
  return { id, links, users: cleanUsers(spec.users, me), order };
}

/**
 * What goes to PLAYERS of a set of marks or lines: everything that names a token hidden from players is left out (a mark on it; a
 * line to it; of a line FROM it only the far end stays, so the target still shows as aimed at and the origin does not).
 * `hidden(tokenId) -> bool`. Returns the cleaned spec, the same object when nothing was held back, or null when nothing is left.
 */
export function stripForPlayers(spec, hidden) {
  if ( !spec ) return null;
  if ( spec.tokens ) {
    const tokens = spec.tokens.filter((e) => !hidden(e.token));
    return tokens.length === spec.tokens.length ? spec : tokens.length ? { ...spec, tokens } : null;
  }
  if ( spec.links ) {
    let same = true;
    const links = [];
    for ( const l of spec.links ) {
      if ( l.to.token && hidden(l.to.token) ) { same = false; continue; }
      if ( l.from?.token && hidden(l.from.token) ) { same = false; links.push({ ...l, from: null }); continue; }
      links.push(l);
    }
    return same ? spec : links.length ? { ...spec, links } : null;
  }
  return spec;
}

/**
 * A player's armed intention as it goes to the GMs, cleaned: { token (the actor's own token), to (end | null), zones: [key],
 * label, color, ttl (ms) }. null: nothing that can be shown.
 */
export function cleanIntent(o) {
  if ( !o || typeof o !== "object" ) return null;
  const token = tokenIdOf(o.token ?? o.from), to = cleanEnd(o.to);
  const zones = [...new Set((Array.isArray(o.zones) ? o.zones : []).slice(0, 40).map(zoneKeyOf).filter(Boolean))];
  const border = o.border != null ? borderKeyOf(o.border) : null;
  if ( !token && !to && !zones.length && !border ) return null;
  const ttl = num(o.ttl);
  return { token, to, zones, border, label: text(o.label, LIMITS.label), color: colorOf(o.color, COLORS.info), ttl: ttl > 0 ? Math.min(ttl, BOARD_LIMITS.intentMax) : BOARD_LIMITS.intentTtl };
}
/**
 * What the pill over the token of an intention says (a GM's client; nothing aimed at yet): the action's own label, never the user's
 * name glued before it (who armed it is in the pill's tip, "user: label", whole). A label that fits the pill (BOARD_LIMITS.label
 * characters: the sender's business) is shown as it came; a longer one ends in an ellipsis inside that length. No label: the
 * user's name, cut the same way. Neither: null (no pill).
 */
export function intentPill(label, userName) {
  const s = text(label, LIMITS.label) ?? text(userName, 80), max = BOARD_LIMITS.label;
  if ( !s ) return null;
  const cps = [...s];
  return cps.length <= max ? s : `${cps.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * A menu at a thing on the map, cleaned:
 *   { title, sub, items: [{ id, label, icon, hint, tip, disabled: false | true | "reason", tone, stepper: { value, min, max } | null,
 *                           toggle: bool, on: bool, i (its place in the caller's list) }] }
 * An item is a plain choice (picking it closes the menu), a stepper (- value +, the menu stays) or a toggle (the menu stays).
 * null: no item.
 */
export function cleanMenu(spec) {
  if ( !spec || typeof spec !== "object" ) return null;
  const items = [];
  (Array.isArray(spec.items) ? spec.items : []).slice(0, BOARD_LIMITS.items).forEach((e, i) => {
    if ( !e || typeof e !== "object" ) return;
    if ( e.separator ) { if ( items.length && !items[items.length - 1].separator ) items.push({ separator: true, i }); return; }
    const label = text(e.label, 60);
    if ( !label ) return;
    const st = e.stepper && typeof e.stepper === "object" ? { value: num(e.stepper.value) ?? 0, min: num(e.stepper.min) ?? -Infinity, max: num(e.stepper.max) ?? Infinity } : null;
    // (section 40: the hint as words and signs; its words cut to the hint's 24 characters, the drawing and the names never counted)
    const signs = cleanSigns(e.signs, { hint: 24 });
    items.push({
      id: e.id == null ? `i${i}` : String(e.id).slice(0, 64), label, icon: text(e.icon, 60), hint: text(e.hint, 24), tip: text(e.tip, BOARD_LIMITS.tip),
      disabled: e.disabled === true ? true : text(e.disabled, 120) ?? false, tone: e.tone == null ? null : colorOf(e.tone, COLORS.info),
      stepper: st, toggle: e.toggle === true, on: e.on === true, i,
      ...(signs ? { signs } : {})
    });
  });
  while ( items.length && items[items.length - 1].separator ) items.pop();
  if ( !items.some((it) => !it.separator) ) return null;
  const top = cleanSigns(spec.signs, { title: BOARD_LIMITS.title, sub: 80 });
  return { title: text(spec.title, BOARD_LIMITS.title), sub: text(spec.sub, 80), items, ...(top ? { signs: top } : {}) };
}
/** A stepper's next value: one step up or down inside its limits. */
export const stepValue = (st, d) => Math.max(st.min, Math.min(st.max, st.value + (d > 0 ? 1 : -1)));

/**
 * The points of a route drawn on the map: from where the mover stands, through the place each border is crossed at, to where the
 * route ends. `steps`: a plan's steps ({ kind: "border" | "edge" | "level", zone, border: { x, y } }); `at(zoneKey) -> { x, y }` the
 * middle of a zone. Returns [{ pts: [x, y, ...], jump: bool }]: one run per stretch walked, a `jump` run for a passage (drawn apart).
 */
export function routeRuns(start, steps, end, at) {
  const runs = [];
  let cur = [start.x, start.y], here = start;
  const push = (p) => { if ( Math.hypot(p.x - here.x, p.y - here.y) > 0.5 ) { cur.push(p.x, p.y); here = p; } };
  for ( const s of steps ?? [] ) {
    if ( s.kind === "border" && s.border && Number.isFinite(s.border.x) ) push({ x: s.border.x, y: s.border.y });
    else if ( s.kind === "edge" ) {
      const b = at(s.zone);
      if ( !b ) continue;
      if ( cur.length >= 4 ) runs.push({ pts: cur, jump: false });
      runs.push({ pts: [here.x, here.y, b.x, b.y], jump: true });
      cur = [b.x, b.y]; here = b;
    }
  }
  if ( end ) push(end);
  if ( cur.length >= 4 ) runs.push({ pts: cur, jump: false });
  return runs;
}

/**
 * Where a route crosses a border: the point of the border's stretches (`segs`: [[x0, y0, x1, y1], ...]) that the straight way from
 * `a` to `b` passes through, else the point of them nearest to that way. null: no stretch.
 */
export function crossing(a, b, segs) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const toWay = (p) => { const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0; return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)); };
  const onSeg = (s, p) => { const ex = s[2] - s[0], ey = s[3] - s[1], l2 = ex * ex + ey * ey, t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((p.x - s[0]) * ex + (p.y - s[1]) * ey) / l2)) : 0; return { x: s[0] + ex * t, y: s[1] + ey * t }; };
  let best = null, bd = Infinity, hit = null, ht = Infinity;
  for ( const s of segs ?? [] ) {
    if ( !s || s.length < 4 ) continue;
    const ex = s[2] - s[0], ey = s[3] - s[1], den = dx * ey - dy * ex;
    if ( Math.abs(den) > 1e-9 ) {
      const t = ((s[0] - a.x) * ey - (s[1] - a.y) * ex) / den, v = ((s[0] - a.x) * dy - (s[1] - a.y) * dx) / den;
      if ( t >= 0 && t <= 1 && v >= 0 && v <= 1 && t < ht ) { ht = t; hit = { x: a.x + dx * t, y: a.y + dy * t }; }
    }
    for ( const q of [a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }] ) { const p = onSeg(s, q), d = toWay(p); if ( d < bd ) { bd = d; best = p; } }
  }
  return hit ?? best;
}

/** The end of a segment pulled in by `d` (so an arrow stops at a token's rim): [x, y]. */
export function pullIn(ax, ay, bx, by, d) {
  const len = Math.hypot(bx - ax, by - ay);
  if ( !(len > 1e-6) || d <= 0 ) return [bx, by];
  const k = Math.max(0, len - Math.min(d, len * 0.45)) / len;
  return [ax + (bx - ax) * k, ay + (by - ay) * k];
}

/**
 * A gentle arc between two points as a polyline (a line between two tokens reads better bowed than straight, and two opposite
 * lines do not lie on each other): [x, y, ...] with `n` segments, bowed by `bow` of its length to the left of its direction.
 */
export function bowed(ax, ay, bx, by, bow = 0.12, n = 14) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  if ( !(len > 1e-6) ) return [ax, ay, bx, by];
  const cx = (ax + bx) / 2 + (dy / len) * len * bow, cy = (ay + by) / 2 - (dx / len) * len * bow, out = [];
  for ( let i = 0; i <= n; i++ ) { const t = i / n, u = 1 - t; out.push(u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by); }
  return out;
}

/** Where a menu's box goes: beside its anchor box (right, else left), kept inside the window. All in client px. */
export function menuSpot(anchor, w, h, vw, vh, gap = 10, pad = 8) {
  let x = anchor.x1 + gap;
  if ( x + w > vw - pad ) x = anchor.x0 - gap - w;
  if ( x < pad ) x = Math.max(pad, Math.min(vw - pad - w, (anchor.x0 + anchor.x1) / 2 - w / 2));
  const y = Math.max(pad, Math.min(vh - pad - h, anchor.y0));
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * How the camera follows a fight on one client, from the user's choice ("auto": the default in force):
 *   "action"  the action camera (zones-api 39): in a fight a combat module drives, its moments are shot; without one, as "all"
 *   "all" | "turn" | "off"  zones-api 30 and 38.
 */
export const FOLLOW = ["auto", "action", "all", "turn", "off"];
const FOLLOWS = ["action", "all", "turn", "off"];
export const followOf = (choice, dflt = "all") => (FOLLOWS.includes(choice) ? choice : FOLLOWS.includes(dflt) ? dflt : "all");
