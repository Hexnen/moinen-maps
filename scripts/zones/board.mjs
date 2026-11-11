import { MODULE_ID } from "../config.mjs";
import * as Zones from "./zones.mjs";
import * as BC from "./board-core.mjs";
import * as HL from "./highlight.mjs";
import * as Interact from "./interact.mjs";
import { BoardLayer, markToken, layoutToken, dimToken } from "./board-layer.mjs";

/**
 * Interaction on the map, wired (dev/zones-api.md 25-33): what a combat module shows and senses ON the map instead of in a panel.
 *
 *  - api.markTokens(spec)     marks on tokens for chosen users: in reach with a label (a hit chance), out of reach dimmed with a
 *                             reason under the pointer, the one chosen, caught in an area, state chips, a bar; parts that show only
 *                             while the pointer is on the token (the expected damage)
 *  - api.link(spec)           a line from one token to another (or to a zone) with a reticle on the target, for chosen users
 *  - api.pickMove(opts)       picking where to move: the route, the price and what waits on the way under the pointer, one click
 *  - api.pickArea(opts)       picking where an area goes: the zones it covers and everyone in them under the pointer
 *  - api.areaPreview(spec)    the same as a standing show; api.warn(spec) a warning on a zone or a border
 *  - api.menu(spec)           a menu at a token, a door, a wall or a zone; api.onContext(fn) a right click on one of them
 *  - api.intent(spec)         what this user has armed, shown to the GMs only
 *
 * Nothing here is stored: marks, lines and menus are a show. Nothing here reads a rule: every text and number is the caller's.
 * WHO SEES WHAT is the caller's (`users`, as for highlights: only a GM's client can show something to others, and it goes to the
 * named users alone). On its own the map only holds back: what names a token hidden from players never goes to a player, and a
 * client never draws a line from a token its user cannot see.
 */

const CHANNEL = `module.${MODULE_ID}`;
const L = (k, d) => (d ? game.i18n.format(`MOINENMAPS.Zones.board.${k}`, d) : game.i18n.localize(`MOINENMAPS.Zones.board.${k}`));
const me = () => game.user?.id ?? null;
const sceneId = () => canvas.scene?.id ?? null;
const isGM = (id) => !!game.users?.get?.(id)?.isGM;
const gmIds = () => (game.users?.filter?.((u) => u.isGM) ?? []).map((u) => u.id);
const emit = (msg, recipients = null) => { try { game.socket?.emit(CHANNEL, { t: "board", scene: sceneId(), ...msg }, ...(recipients ? [{ recipients }] : [])); } catch ( err ) { console.warn(`${MODULE_ID} | zones: socket`, err); } };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const docOf = (w) => { const id = BC.tokenIdOf(w); return id ? canvas.scene?.tokens?.get(id) ?? null : null; };
const objOf = (id) => { const t = canvas.scene?.tokens?.get(id)?.object; return t && !t.destroyed ? t : null; };
const hiddenTok = (id) => canvas.scene?.tokens?.get(id)?.hidden === true;
const view = () => canvas?.app?.view ?? null;

/* ---------------------------------------------------------------- kept sets (token marks, links): local store + what was sent */

/** One kind of show kept by id: what is on this client's screen and what this client sent to others. */
class Kept {
  constructor(op) { this.op = op; this.map = new Map(); this.sent = new Map(); this.seq = 0; this.auto = 0; }
  /** Show a cleaned spec here and / or send it (a GM's call) to the users it names. Returns its id. */
  put(spec) {
    if ( spec.users && !game.user?.isGM ) spec.users = null;
    spec.id ??= `${me() ?? "x"}.${this.op}${++this.auto}`;
    const aud = HL.audience(spec.users, me(), gmIds()), old = this.sent.get(spec.id);
    if ( old ) {
      const still = aud.remote === "all" ? null : new Set(aud.remote ?? []);
      const gone = old.remote === "all" ? (aud.remote === "all" ? [] : "all") : old.remote.filter((u) => still && !still.has(u));
      if ( gone === "all" ) emit({ op: this.op, del: [spec.id] }); else if ( gone.length ) emit({ op: this.op, del: [spec.id] }, gone);
    }
    if ( aud.remote ) { this.sent.set(spec.id, { spec, remote: aud.remote }); this.deliver(spec, aud.remote); } else this.sent.delete(spec.id);
    if ( aud.local ) this.map.set(spec.id, { spec, from: null, seq: ++this.seq }); else this.map.delete(spec.id);
    return spec.id;
  }
  /** Over the socket: as it is to GMs; to players without what names a token hidden from them. */
  deliver(spec, remote) {
    const { users, ...wire } = spec, lean = BC.stripForPlayers(wire, hiddenTok);
    if ( lean === wire ) { emit({ op: this.op, set: [wire] }, remote === "all" ? null : remote); return; }
    const ids = remote === "all" ? (game.users?.filter?.((u) => u.id !== me()) ?? []).map((u) => u.id) : remote;
    const gms = ids.filter(isGM), pls = ids.filter((id) => !isGM(id));
    if ( gms.length ) emit({ op: this.op, set: [wire] }, gms);
    if ( pls.length ) emit(lean ? { op: this.op, set: [lean] } : { op: this.op, del: [spec.id] }, pls);
  }
  /** Take sets away (as clearHighlights): an id, { id }, { prefix }, nothing (what this client made), { all: true }. How many went here. */
  clear(o = {}) {
    const f = typeof o === "string" ? { id: o } : (o ?? {});
    const match = (id) => (f.id == null || id === f.id) && (f.prefix == null || id.startsWith(f.prefix));
    for ( const [id, s] of [...this.sent] ) { if ( !match(id) ) continue; emit({ op: this.op, del: [id] }, s.remote === "all" ? null : s.remote); this.sent.delete(id); }
    let n = 0;
    const mineOnly = !(f.all || f.id != null || f.prefix != null);
    for ( const [id, r] of [...this.map] ) { if ( !match(id) || (mineOnly && r.from != null) ) continue; this.map.delete(id); n++; }
    return n;
  }
  /** A message from a GM's client: sets put or taken away. True when something changed here. */
  take(msg, sender, clean) {
    let any = false;
    for ( const id of Array.isArray(msg.del) ? msg.del : [] ) { const r = this.map.get(String(id)); if ( r && r.from != null ) { this.map.delete(String(id)); any = true; } }
    for ( const raw of Array.isArray(msg.set) ? msg.set : [] ) { const s = clean(raw, me()); if ( !s?.id ) continue; s.users = null; this.map.set(s.id, { spec: s, from: sender, seq: ++this.seq }); any = true; }
    return any;
  }
  /** A client opened this scene: it gets again what was meant for it. */
  hello(sender) { for ( const s of this.sent.values() ) if ( s.remote === "all" || s.remote.includes(sender) ) this.deliver(s.spec, [sender]); }
  rows() { return [...this.map.values()].sort((a, b) => a.spec.order - b.spec.order || a.seq - b.seq); }
  drop() { for ( const [id, s] of this.sent ) emit({ op: this.op, del: [id] }, s.remote === "all" ? null : s.remote); this.sent.clear(); this.map.clear(); }
}
const MARKS = new Kept("tm"), LINKS = new Kept("ln");

/* ---------------------------------------------------------------- marks on tokens */

/** token id -> the entry that shows on it now (the sets merged: a later or higher one wins part by part, state chips add up). */
let ON = new Map(), hoverTok = null, tipEl = null, moveRaf = 0, moveAt = null, watching = false;

function compose() {
  const out = new Map();
  for ( const { spec } of MARKS.rows() ) for ( const e of spec.tokens ) {
    const was = out.get(e.token);
    if ( !was ) { out.set(e.token, { ...e, marks: [...e.marks] }); continue; }
    out.set(e.token, {
      token: e.token, state: e.state ?? was.state, color: e.state ? e.color : was.color, label: e.label ?? was.label, tip: e.tip ?? was.tip,
      marks: [...was.marks, ...e.marks.filter((m) => !was.marks.some((q) => q.icon === m.icon))].slice(0, BC.BOARD_LIMITS.marks),
      bar: e.bar ?? was.bar, hover: e.hover ?? was.hover
    });
  }
  for ( const e of out.values() ) e.key = JSON.stringify(e);
  return out;
}
/** The marks as they are now, on every token of the scene. */
function applyMarks() {
  const before = ON;
  ON = compose();
  for ( const t of canvas.tokens?.placeables ?? [] ) {
    const e = ON.get(t.id) ?? null;
    if ( e || before.has(t.id) || t._mmBoard ) markToken(t, e, hoverTok === t.id);
  }
  if ( hoverTok && !ON.has(hoverTok) ) setHoverTok(null, null);
  watch(ON.size > 0);
}
/** One token was drawn or refreshed: its marks are put back / laid out (Foundry sets the picture's tint again on a refresh). */
function onTokenRefresh(t) {
  if ( !ON.size && !t._mmBoard ) return;
  const e = ON.get(t.id) ?? null;
  if ( e || t._mmBoard ) { markToken(t, e, hoverTok === t.id); if ( e?.state === "out" ) dimToken(t, true); }
}

/** The pointer over the marked tokens: what an entry says about its token shows beside the cursor, hover parts show on the token. */
function watch(on) {
  const v = view();
  if ( on === watching || !v?.addEventListener ) return;
  watching = on;
  if ( on ) { v.addEventListener("pointermove", onPointer, { passive: true }); v.addEventListener("pointerleave", onLeave); }
  else { v.removeEventListener("pointermove", onPointer); v.removeEventListener("pointerleave", onLeave); setHoverTok(null, null); }
}
function onPointer(ev) {
  moveAt = { x: ev.clientX, y: ev.clientY };
  if ( moveRaf ) return;
  moveRaf = requestAnimationFrame(() => {
    moveRaf = 0;
    if ( !moveAt || !canvas?.ready || !ON.size ) return;
    const p = canvas.canvasCoordinatesFromClient(moveAt);
    let best = null;
    for ( const id of ON.keys() ) {
      const t = objOf(id);
      if ( !t?.visible || p.x < t.x || p.y < t.y || p.x > t.x + t.w || p.y > t.y + t.h ) continue;
      if ( !best || (t.document?.sort ?? 0) >= (best.document?.sort ?? 0) ) best = t;
    }
    setHoverTok(best?.id ?? null, moveAt);
  });
}
const onLeave = () => { moveAt = null; setHoverTok(null, null); };
function setHoverTok(id, at) {
  if ( id !== hoverTok ) {
    const old = hoverTok;
    hoverTok = id;
    for ( const k of [old, id] ) { const t = k ? objOf(k) : null; if ( t ) markToken(t, ON.get(k) ?? null, k === id); }
    const e = id ? ON.get(id) : null;
    const lines = e ? [(e.hover?.tip ?? e.tip), ...e.marks.map((m) => m.tip)].filter(Boolean) : [];
    if ( !lines.length ) { tipEl?.remove(); tipEl = null; }
    else {
      if ( !tipEl ) { tipEl = document.createElement("div"); tipEl.className = "mm-z-tip mm-z-pick-tip mm-z-board-tip"; document.body.append(tipEl); }
      tipEl.classList?.toggle?.("no", e.state === "out");
      tipEl.innerHTML = lines.map((s, i) => (i ? `<small>${esc(s)}</small>` : `<span>${esc(s)}</span>`)).join("");
    }
    try { Hooks.callAll("moinenMapsTokenHover", id ? canvas.scene?.tokens?.get(id) ?? null : null, e ?? null); } catch {}
  }
  if ( tipEl && at ) Interact.placeTip(tipEl, at);
}

/**
 * Marks on tokens (board-core cleanTokenMarks has the shape):
 *   markTokens({ id?, tokens: [{ token, state: "in" | "out" | "chosen" | "caught", label, tip, color, marks: [name | { icon, color, tip }],
 *                               bar: { value, max, loss, lossMax, gain, color, text }, hover: { label, tip, bar } }], color, users, order })
 * `users` as for highlights (a GM's call; a player's marks stay on the player's own client). The same id again replaces what it
 * showed. Returns the id, or null when the spec names no token.
 */
export function markTokens(spec) {
  const s = BC.cleanTokenMarks(spec, me());
  if ( !s ) return null;
  const id = MARKS.put(s);
  applyMarks();
  return id;
}
/** Take token marks away: (id), ({ id }), ({ prefix }), () what this client made, ({ all: true }). Returns how many sets went here. */
export function clearTokenMarks(o = {}) { const n = MARKS.clear(o); if ( n ) applyMarks(); return n; }
/** The token marks on this client's screen: [{ id, tokens, order, from }]. */
export const tokenMarks = () => MARKS.rows().map((r) => ({ id: r.spec.id, tokens: r.spec.tokens.map((e) => ({ ...e })), order: r.spec.order, from: r.from }));

/* ---------------------------------------------------------------- lines between things */

let layer = null, linkRaf = 0;
const ensureLayer = () => (layer && !layer.root.destroyed ? layer : (layer = canvas?.ready && canvas.interface ? new BoardLayer() : null));
const involved = new Set();
/** An end as a point with the rim a line stops at; null: not there, or a token this user does not see. */
function endPoint(e) {
  if ( !e ) return null;
  if ( e.token ) {
    const t = objOf(e.token);
    if ( !t || !(t.visible || t.controlled) ) return null;
    involved.add(e.token);
    return { x: t.x + t.w / 2, y: t.y + t.h / 2, r: Math.max(t.w, t.h) / 2, token: true };
  }
  if ( e.zone ) { const Z = Zones.zones(), id = Zones.zonesApi.idOf(e.zone), z = Z && id >= 0 ? Z.zones[id] : null; return z ? { x: z.label.x, y: z.label.y, r: 0 } : null; }
  return { x: e.x, y: e.y, r: 0 };
}
function drawLinks() {
  involved.clear();
  const out = [];
  for ( const { spec } of LINKS.rows() ) for ( const l of spec.links ) {
    const b = endPoint(l.to);
    if ( !b ) continue;
    out.push({ a: endPoint(l.from), b, color: l.color, style: l.style, label: l.label, head: l.head });
  }
  if ( !out.length && !layer ) return;
  ensureLayer()?.setLinks(out);
}
/** A token of a line moved (or came into sight): the lines follow on the next frame, once. */
function linksSoon() { if ( linkRaf || !LINKS.map.size ) return; linkRaf = requestAnimationFrame(() => { linkRaf = 0; if ( canvas?.ready ) drawLinks(); }); }

/**
 * A line from one thing to another, with a reticle on its target:
 *   link({ id?, from, to, color, style: "solid" | "dashed", label, head, users, order })      or { id, links: [{ from, to, ... }] }
 * `from` / `to`: a token (id, uuid, Token, TokenDocument), { zone }, { x, y }; `from` may be absent (the target alone is marked).
 * A client draws the line only from a token its user sees, and nothing when it does not see the target. Returns the id or null.
 */
export function link(spec) {
  const s = BC.cleanLinks(spec, me());
  if ( !s ) return null;
  const id = LINKS.put(s);
  drawLinks();
  return id;
}
export function clearLinks(o = {}) { const n = LINKS.clear(o); if ( n ) drawLinks(); return n; }
export const links = () => LINKS.rows().map((r) => ({ id: r.spec.id, links: r.spec.links.map((l) => ({ ...l })), order: r.spec.order, from: r.from }));

/* ---------------------------------------------------------------- a move under the pointer */

const at = (key) => { const Z = Zones.zones(), id = Zones.zonesApi.idOf(key), z = Z && id >= 0 ? Z.zones[id] : null; return z ? { x: z.label.x, y: z.label.y } : null; };
const zoomU = () => 1 / Math.max(0.05, canvas.stage?.scale.x ?? 1);

/** The plan a move entry is drawn from: the caller's own (a plan, or the zones it enters in order), else the map's route there. */
function planFor(tok, raw, spot, profile) {
  try {
    if ( raw?.route && typeof raw.route === "object" && Array.isArray(raw.route.steps) ) return raw.route;
    if ( Array.isArray(raw?.route) && raw.route.length ) {
      const pl = Zones.zonesApi.planAlong(tok, raw.route, { profile });
      if ( pl ) return pl;
      // the caller's way is the caller's: where the map would not walk it (through a wall), it is still drawn, border by border
      const start = Zones.zonesApi.zoneOfToken(tok)?.zone ?? null, zones = [start], steps = [];
      for ( const w of raw.route ) {
        const k = HL.zoneKeyOf(w), prev = zones[zones.length - 1];
        if ( !k || !prev ) return null;
        if ( k === prev ) continue;
        const br = Zones.zonesApi.borderBetween(prev, k);
        steps.push({ kind: br ? "border" : "edge", zone: k, border: br });
        zones.push(k);
      }
      return steps.length ? { zones, steps } : null;
    }
    return Zones.zonesApi.plan(tok, spot, { ...(profile ?? {}), force: true }) ?? Zones.zonesApi.plan(tok, spot, profile ?? {});
  } catch { return null; }
}
/** What waits on a route as the map itself knows it (a caller that names hazards replaces these): blocked borders, burning zones. */
function ownHazards(plan) {
  const out = [];
  for ( const s of plan?.steps ?? [] ) {
    if ( s.kind === "border" && s.border?.blocked ) {
      const d = s.border.doorway, locked = d && (d.state === "locked" || d.state === "sealed") && s.border.wall?.state === "intact";
      out.push({ border: s.border.key, text: locked ? L("haz.locked", { armor: s.border.armor }) : L("haz.wall", { armor: s.border.armor }), color: "danger", icon: locked ? "fa-solid fa-lock" : "warn" });
    }
    if ( s.kind !== "level" && s.zone ) { const f = Zones.zonesApi.zone(s.zone)?.states?.fire; if ( f ) out.push({ zone: s.zone, text: L("haz.fire", { n: f }), color: "danger", icon: "burning" }); }
  }
  return out;
}
/** Draw a route with what waits on it. */
function showRoute(tok, plan, hazards, color) {
  const lay = ensureLayer();
  if ( !lay ) return;
  if ( !plan?.steps?.length ) { lay.setRoute(null); return; }
  const t = tok.object, start = t ? Zones.tokenCenter(t) : { x: tok.x, y: tok.y }, endKey = plan.zones?.[plan.zones.length - 1] ?? null, end = endKey ? at(endKey) : null, u = zoomU();
  // where each border is crossed: at its door or wall mark when it has one (that is the way through), else where the straight way
  // to the next zone passes it (a long border's own label point may lie far off the way)
  const Zs = Zones.zones(), cross = new Map();
  let here = start;
  const steps = plan.steps.map((s) => {
    if ( s.kind === "edge" ) { const b = at(s.zone); if ( b ) here = b; return s; }
    if ( s.kind !== "border" || !s.border?.key ) return s;
    let p = Number.isFinite(s.border.x) ? { x: s.border.x, y: s.border.y } : null;
    if ( !(s.border.wall || s.border.doorway) || !p ) {
      const [ia, ib] = s.border.key.split("|").map((k) => Zones.zonesApi.idOf(k)), target = at(s.zone) ?? end;
      const segs = (Zs?.borders ?? []).filter((br) => !br.edge && ((br.a === ia && br.b === ib) || (br.a === ib && br.b === ia))).map((br) => br.pts);
      p = (target ? BC.crossing(here, target, segs) : null) ?? p;
    }
    if ( !p ) return s;
    cross.set(s.border.key, p); here = p;
    return { ...s, border: { ...s.border, x: p.x, y: p.y } };
  });
  const runs = BC.routeRuns(start, steps, end, at), marks = [...cross.values()];
  const chips = [], used = [];
  for ( const h of hazards ?? [] ) {
    let p = null;
    const bk = h.border != null ? HL.borderKeyOf(h.border) : null, zk = bk ? null : HL.zoneKeyOf(h.zone ?? h);
    if ( bk ) { const [a, b] = bk.split("|"), br = cross.get(bk) ?? cross.get(`${b}|${a}`) ?? Zones.zonesApi.borderBetween(a, b); if ( br && Number.isFinite(br.x) ) p = { x: br.x, y: br.y - 17 * u }; }
    else if ( zk ) {
      // on the route inside that zone: between where it is entered and where it is left (or the route's end)
      const i = steps.findIndex((s) => s.zone === zk && s.kind !== "level"), into = i >= 0 ? steps[i] : null, next = steps.slice(i + 1).find((s) => s.kind === "border" && s.border);
      const a = into?.border && Number.isFinite(into.border.x) ? into.border : at(zk), b = next?.border ?? at(zk);
      if ( a && b ) p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 15 * u };
    }
    if ( !p || !h.text ) continue;
    while ( used.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 20 * u) ) p = { x: p.x, y: p.y - 24 * u };
    used.push(p);
    chips.push({ x: p.x, y: p.y, text: String(h.text).slice(0, 28), color: HL.colorOf(h.color, HL.COLORS.danger), icon: h.icon ?? "warn" });
  }
  lay.setRoute({ runs, color, marks, chips });
}

/**
 * Pick where a token moves, with the move shown under the pointer: its route through the zones, its price, what waits on the way.
 * One click confirms. opts: everything api.pick takes, plus
 *   token                the mover (required)
 *   profile              its mover profile (section 14): what the map's own route and reach are counted for
 *   zones                the zones on offer: [{ zone | spot, label, tip, color, cost, route, hazards, more }] - `cost`: the price in the
 *                        caller's words ("quick action · 1 stress"); `route`: the zones it enters in order (or a plan) when it is not
 *                        the map's own shortest; `hazards`: [{ zone | border, text, color, icon }] what waits on the way (absent: what
 *                        the map knows - a blocked border with its Armor, a burning zone; []: nothing); `more`: there is another way
 *                        to make this move (a right click on the zone answers with `alt: true`).
 *                        Absent: what api.reach gives for the profile, priced in movement actions.
 *   intent               true | { label }: the GMs see where this user points (section 32)
 * Resolves like api.pick; a yes also carries `alt` (true: the user asked for another way), `route` (the zones entered) and `entry`
 * (the caller's own entry).
 */
export function pickMove(opts = {}) {
  const tok = docOf(opts.token);
  if ( !tok ) return Promise.resolve({ ok: false, reason: "noToken" });
  const profile = opts.profile ?? {};
  let entries = opts.zones;
  if ( !Array.isArray(entries) ) {
    entries = [];
    for ( const r of Zones.zonesApi.reach(tok, profile) ) {
      const w = r.cost?.within ?? "plain";
      if ( !(r.d > 0) || w === "no" ) continue;
      entries.push({ zone: r.zone, label: String(r.d), color: w === "stress" ? "stress" : "move", cost: w === "stress" ? L("move.costStress", { n: r.cost.stressActions }) : L("move.cost", { n: r.cost?.actions ?? 1 }) });
    }
  }
  const raws = new Map();
  for ( const e of entries ) { const k = HL.zoneKeyOf(e); if ( k && !raws.has(k) ) raws.set(k, e && typeof e === "object" ? e : {}); }
  const plans = new Map(), ver = Zones.zonesApi.version();
  const planOf = (e) => { const k = `${e.zone}|${Zones.zonesApi.version() === ver ? 0 : Zones.zonesApi.version()}`; if ( !plans.has(k) ) plans.set(k, planFor(tok, raws.get(e.zone), e.spot ?? e.zone, profile)); return plans.get(k); };
  const hazardsOf = (e) => { const raw = raws.get(e.zone); return Array.isArray(raw?.hazards) ? raw.hazards : ownHazards(planOf(e)); };
  const wantIntent = !!opts.intent, ilabel = opts.intent && typeof opts.intent === "object" ? opts.intent.label : null;
  const ext = {
    hover(e) {
      if ( !e ) { layer?.setRoute(null); if ( wantIntent ) intent({ token: tok.id, label: ilabel ?? opts.title ?? null }); return; }
      showRoute(tok, planOf(e), hazardsOf(e), e.color);
      if ( wantIntent ) intent({ token: tok.id, to: { zone: e.zone }, zones: [e.zone], label: ilabel ?? opts.title ?? null, color: e.color });
    },
    tip(e) {
      const raw = raws.get(e.zone) ?? {}, hz = hazardsOf(e);
      return `${raw.cost ? `<span class="mm-z-cost">${esc(String(raw.cost).slice(0, 60))}</span>` : ""}${hz.filter((h) => h.text).map((h) => `<small class="mm-z-haz"><i class="fa-solid fa-triangle-exclamation" inert></i> ${esc(String(h.tip ?? h.text).slice(0, 120))}</small>`).join("")}${raw.more ? `<small class="mm-z-alt">${esc(L("move.alt"))}</small>` : ""}`;
    },
    alt: (e) => raws.get(e.zone)?.more === true,
    end(result) {
      layer?.setRoute(null);
      if ( wantIntent ) intent(null);
      if ( !result?.ok ) return result;
      const e = { zone: result.zone, spot: result.spot }, pl = planOf(e);
      return { ...result, alt: result.alt === true, route: pl?.zones?.slice(1) ?? null, entry: raws.get(result.zone) ?? null };
    }
  };
  if ( wantIntent ) intent({ token: tok.id, label: ilabel ?? opts.title ?? null });
  return Interact.pick({ color: "move", ...opts, zones: entries, user: null, _ext: ext });
}

/* ---------------------------------------------------------------- areas, warnings */

/** The tokens standing in zones (on the level of `place` when one is given, else on every level), as this user may know them: [TokenDocument]. */
function tokensIn(keys, place = null) {
  const out = [], seen = new Set(), gm = !!game.user?.isGM;
  for ( const k of keys ) {
    const where = !place ? k : place.level && place.level !== "ground" ? { zone: k, level: place.level, floor: place.floor } : `${k}:ground`;
    for ( const r of Zones.zonesApi.tokensInZone(where) ) {
      const d = r.token;
      if ( !d || seen.has(d.id) ) continue;
      // (a player's client: only the tokens that player sees)
      if ( !gm && (d.hidden || !(d.object?.visible)) ) continue;
      seen.add(d.id); out.push(d);
    }
  }
  return out;
}
/** Entries of token marks for the tokens an area catches. `tokens`: true | (tokenDoc) => false | true | { label, color, tip }. */
function caughtMarks(docs, tokens, color) {
  const out = [];
  for ( const d of docs ) {
    let o = true;
    if ( typeof tokens === "function" ) { try { o = tokens(d); } catch { o = true; } }
    if ( o === false || o == null ) continue;
    out.push({ token: d.id, state: "caught", color, ...(o && typeof o === "object" ? o : {}) });
  }
  return out;
}

/**
 * Show an area: the zones it covers and the tokens standing in them (allies too).
 *   areaPreview({ id = "area", zones: [key | spot | { zone, label, tip, color }] | at + radius, color = "range", style, users, order,
 *                 tokens = true | false | (tokenDoc) => false | true | { label, color, tip }, level: place | token })
 * `at` + `radius`: the zones within `radius` borders of `at` (api.zonesWithin). `level`: only the tokens on that level are caught
 * (a token, a place, a spot); absent: every level. Returns { id, zones: [key], tokens: [tokenId] } or null. Take it away with
 * api.clearArea(id). Sent to `users` like a highlight; what names a token hidden from players does not go to players.
 */
export function areaPreview(spec = {}) {
  const id = spec.id == null ? "area" : String(spec.id), color = spec.color ?? "range";
  let zones = Array.isArray(spec.zones) ? spec.zones : null;
  if ( !zones && spec.at != null ) zones = Zones.zonesApi.zonesWithin(spec.at, Math.max(0, Number(spec.radius) || 0)).map((r) => r.zone);
  if ( !zones?.length ) return null;
  const hid = Interact.highlight({ id, zones, color, style: spec.style ?? "fill", users: spec.users, order: spec.order ?? 20 });
  if ( !hid ) return null;
  const keys = [...new Set(zones.map(HL.zoneKeyOf).filter(Boolean))], place = spec.level != null ? Zones.zonesApi.place(spec.level) : null;
  const docs = spec.tokens === false ? [] : tokensIn(keys, place), rows = caughtMarks(docs, spec.tokens ?? true, color);
  if ( rows.length ) markTokens({ id, tokens: rows, users: spec.users, order: spec.order ?? 20 }); else clearTokenMarks(id);
  return { id, zones: keys, tokens: rows.map((r) => r.token) };
}
export function clearArea(id = "area") { return Interact.clearHighlights(String(id)) + clearTokenMarks(String(id)); }

/**
 * Pick where an area effect goes; under the pointer: the zones it would cover and everyone in them. opts: everything api.pick
 * takes (zones: the places it may be put), plus
 *   radius    how many borders out from the zone under the pointer it reaches (0: that zone alone)
 *   area      (zoneKey, place) => [zoneKey, ...]: the caller's own shape (replaces `radius`)
 *   areaColor "range"; tokens: as areaPreview; token + intent: as pickMove (the GMs see where it is being put)
 *   anyLevel  true: tokens on every level of the covered zones are caught; default: those on the level the area is put on
 * A yes also carries `area: [key]` and `caught: [tokenId]` (as this user sees them).
 */
export function pickArea(opts = {}) {
  const color = opts.areaColor ?? "range", n = Math.max(0, Number(opts.radius) || 0);
  let last = { area: [], caught: [] };
  const areaOf = (e) => {
    const place = Zones.zonesApi.place(e.spot ?? e.zone);
    let keys = null;
    if ( typeof opts.area === "function" ) { try { keys = opts.area(e.zone, place); } catch { keys = null; } }
    keys = (Array.isArray(keys) ? keys.map(HL.zoneKeyOf).filter(Boolean) : Zones.zonesApi.zonesWithin(e.zone, n).map((r) => r.zone));
    return { keys, place };
  };
  const tok = docOf(opts.token), wantIntent = !!opts.intent && !!tok, ilabel = opts.intent && typeof opts.intent === "object" ? opts.intent.label : null;
  const clear = () => { Interact.clearHighlights("~area"); clearTokenMarks("~area"); };
  const ext = {
    hover(e) {
      if ( !e ) { clear(); last = { area: [], caught: [] }; if ( wantIntent ) intent({ token: tok.id, label: ilabel ?? opts.title ?? null }); return; }
      const { keys, place } = areaOf(e);
      const docs = opts.tokens === false ? [] : tokensIn(keys, opts.anyLevel === true ? null : place), rows = caughtMarks(docs, opts.tokens ?? true, color);
      Interact.highlight({ id: "~area", zones: keys, color, style: "fill", order: 1000 });
      if ( rows.length ) markTokens({ id: "~area", tokens: rows, order: 1000 }); else clearTokenMarks("~area");
      last = { area: keys, caught: rows.map((r) => r.token) };
      if ( wantIntent ) intent({ token: tok.id, to: { zone: e.zone }, zones: keys, label: ilabel ?? opts.title ?? null, color });
    },
    tip: () => (last.caught.length ? `<small class="mm-z-haz">${esc(L("area.caught", { n: last.caught.length }))}</small>` : ""),
    end(result) { const got = last; clear(); if ( wantIntent ) intent(null); return result?.ok ? { ...result, area: got.area, caught: got.caught } : result; }
  };
  return Interact.pick({ color: "target", ...opts, user: null, _ext: ext });
}

/**
 * A warning on zones or borders (where a turn would end in fire, a zone about to collapse, in reach of someone holding):
 *   warn({ id = "warn", zones: [key | { zone, text, tip, icon, color }], borders: [key | { border, text, tip, icon, color }], users, order })
 * A dashed band in the danger colour and a chip with a warning sign and the caller's words. It is a highlight: take it away with
 * api.clearHighlights(id). Returns the id or null.
 */
export function warn(spec = {}) {
  const row = (k) => (e) => (e && typeof e === "object" && !Array.isArray(e) ? { ...e, label: e.label ?? e.text ?? null, icon: e.icon ?? "warn" } : { [k]: e, icon: "warn" });
  return Interact.highlight({
    id: spec.id == null ? "warn" : spec.id, zones: (spec.zones ?? []).map(row("zone")), borders: (spec.borders ?? []).map(row("border")),
    color: spec.color ?? "danger", style: "dashed", borderColor: spec.color ?? "danger", borderStyle: "dashed", users: spec.users, order: spec.order ?? 50
  });
}

/* ---------------------------------------------------------------- a menu at a thing on the map */

let MENU = null;
/** The box of a thing on the map in client px: a token, a border's mark, a zone's middle, a point. */
function anchorBox(a) {
  const c = (p) => canvas.clientCoordinatesFromCanvas(p);
  if ( a?.client ) return { x0: a.client.x, y0: a.client.y, x1: a.client.x, y1: a.client.y };
  const t = a?.token ? objOf(BC.tokenIdOf(a.token)) : null;
  if ( t ) { const p = c({ x: t.x, y: t.y }), q = c({ x: t.x + t.w, y: t.y + t.h }); return { x0: p.x, y0: p.y, x1: q.x, y1: q.y }; }
  let pt = null;
  if ( a?.border != null ) { const k = HL.borderKeyOf(a.border), [za, zb] = (k ?? "").split("|"), br = k ? Zones.zonesApi.borderBetween(za, zb) : null; if ( br ) pt = { x: br.x, y: br.y }; }
  if ( !pt && a?.zone != null ) pt = at(HL.zoneKeyOf(a.zone) ?? "");
  if ( !pt && Number.isFinite(a?.x) && Number.isFinite(a?.y) ) pt = { x: a.x, y: a.y };
  if ( !pt ) return null;
  const p = c(pt);
  return { x0: p.x - 14, y0: p.y - 14, x1: p.x + 14, y1: p.y + 14 };
}

/**
 * A menu at a token, a door, a wall, a zone or a point; its entries are the caller's.
 *   const r = await api.menu({ token | border | zone | x, y | client: { x, y }, title, sub,
 *     items: [{ id, label, icon, hint, tip, disabled: true | "why not", tone, run() }
 *             | { id, label, icon, stepper: { value, min, max }, onStep(value, delta) -> value? }
 *             | { id, label, icon, toggle: true, on, onToggle(on) -> on? } | { separator: true }] });
 *   // { ok: true, id, index }  |  { ok: false, reason: "cancelled" | "replaced" | "noItems" | "noAnchor" | "sceneChanged" }
 * A plain entry closes the menu (its `run()` is called, the promise resolves with its id); a stepper and a toggle keep it open and
 * tell the caller each change. It stands beside the thing, follows the map, and closes on Escape, a click elsewhere or a new menu.
 * This client only. Digits 1-9 pick the plain entries in order.
 */
export function menu(spec = {}) {
  const M = BC.cleanMenu(spec);
  if ( !M ) return Promise.resolve({ ok: false, reason: "noItems" });
  if ( !canvas?.ready || typeof document?.createElement !== "function" ) return Promise.resolve({ ok: false, reason: "noAnchor" });
  const anchor = { token: spec.token ?? null, border: spec.border ?? null, zone: spec.zone ?? null, x: spec.x, y: spec.y, client: spec.client ?? null };
  if ( !anchorBox(anchor) ) return Promise.resolve({ ok: false, reason: "noAnchor" });
  closeMenu("replaced");
  const raw = Array.isArray(spec.items) ? spec.items : [];
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "mm-z-menu"; el.setAttribute("role", "menu");
    let n = 0;
    const rows = M.items.map((it) => {
      if ( it.separator ) return `<hr>`;
      const icon = it.icon ? `<i class="${esc(/(^|\s)fa-/.test(it.icon) ? it.icon : `fa-solid fa-${it.icon}`)}" inert></i>` : `<i inert></i>`;
      const tone = it.tone != null ? ` style="--mm-tone: #${it.tone.toString(16).padStart(6, "0")}"` : "";
      const why = typeof it.disabled === "string" ? `<small>${esc(it.disabled)}</small>` : "";
      const tipA = it.tip ? ` data-tooltip="${esc(it.tip)}" data-tooltip-direction="RIGHT"` : "";
      if ( it.stepper ) return `<div class="mm-z-menu-row is-step" data-i="${it.i}"${tone}${tipA}>${icon}<span class="lb">${esc(it.label)}</span><button type="button" data-step="-1" aria-label="-">−</button><output>${esc(it.stepper.value)}</output><button type="button" data-step="1" aria-label="+">+</button></div>`;
      if ( it.toggle ) return `<button type="button" role="menuitemcheckbox" aria-checked="${it.on}" class="mm-z-menu-row is-toggle${it.on ? " is-on" : ""}" data-i="${it.i}"${tone}${tipA}${it.disabled ? " disabled" : ""}>${icon}<span class="lb">${esc(it.label)}${why}</span><i class="fa-solid fa-check ck" inert></i></button>`;
      const key = !it.disabled && n < 9 ? ++n : 0;
      return `<button type="button" role="menuitem" class="mm-z-menu-row" data-i="${it.i}"${key ? ` data-key="${key}"` : ""}${tone}${tipA}${it.disabled ? ` disabled aria-disabled="true"` : ""}>${icon}<span class="lb">${esc(it.label)}${why}</span>${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ""}${key ? `<kbd>${key}</kbd>` : ""}</button>`;
    }).join("");
    el.innerHTML = `${M.title ? `<header><b>${esc(M.title)}</b>${M.sub ? `<small>${esc(M.sub)}</small>` : ""}</header>` : ""}<div class="mm-z-menu-list">${rows}</div>`;
    document.body.append(el);
    const place = () => {
      const b = anchorBox(anchor);
      if ( !b ) { closeMenu("cancelled"); return; }
      const r = el.getBoundingClientRect?.() ?? { width: 220, height: 200 }, s = BC.menuSpot(b, r.width || 220, r.height || 200, Number(globalThis.innerWidth) || 1600, Number(globalThis.innerHeight) || 900);
      el.style.left = `${s.x}px`; el.style.top = `${s.y}px`;
    };
    const byI = (i) => M.items.find((it) => it.i === i);
    const choose = (it) => { const src = raw[it.i]; closeMenu(null, { ok: true, id: it.id, index: it.i }); try { src?.run?.(); } catch ( err ) { console.warn(`${MODULE_ID} | zones: menu`, err); } };
    const onClick = async (ev) => {
      const rowEl = ev.target?.closest?.("[data-i]");
      if ( !rowEl ) return;
      ev.preventDefault?.(); ev.stopPropagation?.();
      const it = byI(Number(rowEl.dataset.i)), src = raw[it?.i];
      if ( !it || it.disabled ) return;
      if ( it.stepper ) {
        const d = Number(ev.target.closest?.("[data-step]")?.dataset.step);
        if ( !d ) return;
        let v = BC.stepValue(it.stepper, d);
        if ( v === it.stepper.value ) return;
        try { const got = await src?.onStep?.(v, d); if ( Number.isFinite(Number(got)) && got !== true ) v = Number(got); else if ( got === false ) return; } catch ( err ) { console.warn(`${MODULE_ID} | zones: menu`, err); return; }
        it.stepper.value = v;
        const o = rowEl.querySelector?.("output"); if ( o ) o.textContent = String(v);
        return;
      }
      if ( it.toggle ) {
        let on = !it.on;
        try { const got = await src?.onToggle?.(on); if ( typeof got === "boolean" ) on = got; } catch ( err ) { console.warn(`${MODULE_ID} | zones: menu`, err); return; }
        it.on = on; rowEl.classList?.toggle?.("is-on", on); rowEl.setAttribute?.("aria-checked", String(on));
        return;
      }
      choose(it);
    };
    const onKey = (ev) => {
      if ( ev.key === "Escape" ) { ev.preventDefault(); ev.stopPropagation(); closeMenu("cancelled"); return; }
      const a = document.activeElement;
      if ( a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName ?? "")) ) return;
      if ( /^[1-9]$/.test(ev.key) && !ev.ctrlKey && !ev.altKey && !ev.metaKey ) {
        let k = 0;
        const it = M.items.find((q) => !q.separator && !q.stepper && !q.toggle && !q.disabled && ++k === Number(ev.key));
        if ( it ) { ev.preventDefault(); ev.stopPropagation(); choose(it); }
      }
    };
    const outside = (ev) => { if ( !el.contains?.(ev.target) ) closeMenu("cancelled"); };
    const onPan = () => place();
    el.addEventListener("click", onClick);
    el.addEventListener("contextmenu", (ev) => ev.preventDefault?.());
    window.addEventListener("keydown", onKey, true);
    const arm = setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    Hooks.on("canvasPan", onPan);
    MENU = { el, resolve, off: () => { clearTimeout(arm); el.removeEventListener("click", onClick); window.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", outside, true); Hooks.off("canvasPan", onPan); } };
    place();
  });
}
/** Close the open menu (true when there was one). */
export function closeMenu(reason = "cancelled", result = null) {
  const m = MENU;
  if ( !m ) return false;
  MENU = null;
  try { m.off(); } catch {}
  m.el.remove();
  m.resolve(result ?? { ok: false, reason: reason ?? "cancelled" });
  return true;
}
export const menuOpen = () => !!MENU;

/* ---------------------------------------------------------------- a right click on a thing of the map */

const CONTEXT = new Set();
let ctxOn = false, CTX = null;
/** What lies under a client point: the topmost token this user sees, else a border near it, else the zone. */
function thingAt(client) {
  const p = canvas.canvasCoordinatesFromClient(client), Z = Zones.zones();
  let tok = null;
  for ( const t of canvas.tokens?.placeables ?? [] ) {
    if ( !t.visible || p.x < t.x || p.y < t.y || p.x > t.x + t.w || p.y > t.y + t.h ) continue;
    if ( !tok || (t.document?.sort ?? 0) >= (tok.document?.sort ?? 0) ) tok = t;
  }
  const base = { x: p.x, y: p.y, client: { x: client.x, y: client.y }, place: Z ? Zones.zonesApi.placeAt(p.x, p.y) : null };
  if ( tok ) return { kind: "token", token: tok.document, zone: Zones.zonesApi.zoneOfToken(tok.document)?.zone ?? null, ...base };
  if ( Z ) {
    const b = Zones.zonesApi.borderAt(p.x, p.y, Zones.gridSize() * 0.3 * Math.max(1, zoomU()));
    const ka = b ? Zones.zonesApi.keyOf(b.a) : null, kb = b ? Zones.zonesApi.keyOf(b.b) : null;
    if ( ka && kb ) { const br = Zones.zonesApi.borderBetween(ka, kb); if ( br && (br.wall || br.doorway) ) return { kind: "border", border: br, zone: null, ...base }; }
    if ( base.place?.zone ) return { kind: "zone", zone: base.place.zone, ...base };
  }
  return null;
}
function onCtxDown(ev) {
  if ( ev.button !== 2 || ev.target !== view() || !CONTEXT.size || !canvas?.ready || Interact.picking() || Zones.editing() ) return;
  let thing = null;
  try { thing = thingAt({ x: ev.clientX, y: ev.clientY }); } catch { thing = null; }
  if ( !thing ) return;
  const ctx = { ...thing, shift: !!ev.shiftKey, alt: !!ev.altKey, ctrl: !!(ev.ctrlKey || ev.metaKey) };
  let got = null;
  for ( const fn of [...CONTEXT] ) { try { got = fn(ctx); } catch ( err ) { console.warn(`${MODULE_ID} | zones: context`, err); got = null; } if ( got ) break; }
  if ( !got ) return;
  // this right click is the caller's: Foundry does not open its own (the token HUD), the map's own menus stay shut
  ev.stopImmediatePropagation(); ev.preventDefault();
  CTX = { ctx, got, x: ev.clientX, y: ev.clientY, drag: false, id: ev.pointerId };
  window.addEventListener("pointermove", onCtxMove, true);
  window.addEventListener("pointerup", onCtxUp, true);
}
/** (a right press that turns into a drag still moves the map, as everywhere else) */
function onCtxMove(ev) {
  const c = CTX;
  if ( !c ) return;
  const dx = ev.clientX - c.x, dy = ev.clientY - c.y;
  if ( !c.drag && Math.hypot(dx, dy) < 5 ) return;
  c.drag = true;
  const s = canvas.stage.scale.x;
  canvas.pan({ x: canvas.stage.pivot.x - dx / s, y: canvas.stage.pivot.y - dy / s });
  c.x = ev.clientX; c.y = ev.clientY;
}
function onCtxUp(ev) {
  const c = CTX;
  if ( !c || ev.button !== 2 ) return;
  CTX = null;
  window.removeEventListener("pointermove", onCtxMove, true);
  window.removeEventListener("pointerup", onCtxUp, true);
  ev.stopImmediatePropagation?.(); ev.preventDefault?.();
  if ( c.drag || c.got === true ) return;
  Promise.resolve(c.got).then((spec) => {
    if ( !spec || spec === true || typeof spec !== "object" ) return;
    const anchor = c.ctx.kind === "token" ? { token: c.ctx.token } : c.ctx.kind === "border" ? { border: c.ctx.border.key } : { x: c.ctx.x, y: c.ctx.y };
    return menu({ ...anchor, ...spec }).then((r) => { try { spec.done?.(r, c.ctx); } catch ( err ) { console.warn(`${MODULE_ID} | zones: context`, err); } });
  }).catch((err) => console.warn(`${MODULE_ID} | zones: context`, err));
}
/**
 * Be asked about every right click on a token, a wall or door, or a zone of the map (this client):
 *   const off = api.onContext((ctx) => null | true | menuSpec | Promise<menuSpec | null>);
 *   ctx = { kind: "token" | "border" | "zone", token (TokenDocument), border (section 5 object), zone (key), place, x, y, client, shift, alt, ctrl }
 * Answer at once (the click is claimed or not while the button goes down): nothing - not mine, Foundry and the map do what they
 * always did (the token HUD, the GM's zone menu); `true` - handled by the caller; a menu spec (api.menu's, without the anchor; or a
 * promise of one) - the map opens that menu at the thing when the button comes up, `spec.done(result, ctx)` is told the answer.
 * Not asked while a zone is being picked or the GM edits the zones. A right DRAG that starts on a claimed thing still pans.
 */
export function onContext(fn) {
  if ( typeof fn !== "function" ) return () => {};
  CONTEXT.add(fn);
  if ( !ctxOn && typeof window?.addEventListener === "function" ) { window.addEventListener("pointerdown", onCtxDown, true); ctxOn = true; }
  return () => { CONTEXT.delete(fn); if ( !CONTEXT.size && ctxOn ) { window.removeEventListener("pointerdown", onCtxDown, true); ctxOn = false; } };
}

/* ---------------------------------------------------------------- what a user has armed, for the GMs */

/** userId -> { intent, timer } on a GM's client. */
const INTENTS = new Map();
let showIntents = true, intentTimer = 0, intentNext = undefined, intentSent = null;
function drawIntent(uid) {
  const id = `~intent.${uid}`, r = INTENTS.get(uid), it = showIntents ? r?.intent : null;
  if ( !it ) { LINKS.map.delete(id); MARKS.map.delete(id); Interact.clearHighlights(id); drawLinks(); applyMarks(); return; }
  const name = game.users?.get?.(uid)?.name ?? "", label = it.label ? (name ? `${name}: ${it.label}` : it.label) : name || null;
  if ( it.zones.length || it.border ) Interact.highlight({ id, zones: it.zones, borders: it.border ? [it.border] : [], color: it.color, style: "dashed", borderColor: it.color, borderStyle: "dashed", order: 900 });
  else Interact.clearHighlights(id);
  if ( it.to ) { LINKS.map.set(id, { spec: { id, links: [{ from: it.token ? { token: it.token } : null, to: it.to, color: it.color, style: "dashed", label, head: true }], order: 900 }, from: uid, seq: ++LINKS.seq }); MARKS.map.delete(id); }
  else { LINKS.map.delete(id); if ( it.token && label ) MARKS.map.set(id, { spec: { id, tokens: [{ token: it.token, state: null, color: it.color, label: label.slice(0, BC.BOARD_LIMITS.label), tip: label, marks: [], bar: null, hover: null }], order: 900 }, from: uid, seq: ++MARKS.seq }); else MARKS.map.delete(id); }
  drawLinks(); applyMarks();
}
function takeIntent(uid, raw) {
  const old = INTENTS.get(uid);
  if ( old ) clearTimeout(old.timer);
  let it = raw ? BC.cleanIntent(raw) : null;
  // (only about a token that user owns: nobody draws on the GM's map in another's name)
  if ( it?.token ) { const d = canvas.scene?.tokens?.get(it.token), u = game.users?.get?.(uid); if ( !d || !(u?.isGM || d.testUserPermission?.(u, "OWNER")) ) it = null; }
  if ( it ) INTENTS.set(uid, { intent: it, timer: setTimeout(() => takeIntent(uid, null), it.ttl) }); else INTENTS.delete(uid);
  drawIntent(uid);
  try { Hooks.callAll("moinenMapsIntent", uid, it ? { ...it } : null); } catch {}
}
/**
 * Tell the GMs what this user has armed, before anything is declared:
 *   api.intent({ token (the actor's own), to: token | { zone } | { x, y }, zones: [key], border, label, color, ttl = 20000 })     api.intent(null)
 * It goes to the GMs' clients alone (never to another player) and shows there as a dashed line from the token to what is aimed at,
 * dashed outlines on the zones, and the user's name with the label. It fades by itself after `ttl` ms unless said again; null
 * takes it away. Sent at most every 150 ms. It is not drawn on the sender's own screen (a GM's goes to the other GMs). Returns true
 * when it was (or will be) sent.
 */
export function intent(spec) {
  const it = spec ? BC.cleanIntent(spec) : null;
  if ( spec && !it ) return false;
  const key = JSON.stringify(it);
  if ( key === intentSent && intentNext === undefined ) return true;
  intentNext = it;
  if ( intentTimer ) return true;
  const go = () => {
    intentTimer = 0;
    if ( intentNext === undefined ) return;
    const now = intentNext; intentNext = undefined; intentSent = JSON.stringify(now);
    const gms = gmIds().filter((id) => id !== me());
    if ( gms.length ) emit({ op: "intent", intent: now }, gms);
    intentTimer = setTimeout(go, 150);
  };
  go();
  return true;
}
/** A GM's client: the intentions on screen now ([{ user, intent }]); intents(false) hides them here, intents(true) shows them again. */
export function intents(show) {
  if ( typeof show === "boolean" && show !== showIntents ) { showIntents = show; for ( const uid of INTENTS.keys() ) drawIntent(uid); }
  return [...INTENTS].map(([user, r]) => ({ user, intent: { ...r.intent } }));
}

/* ---------------------------------------------------------------- a short word on a token (the map's own feedback) */

let flashSeq = 0;
/** A label on a token for a moment, on this client only (a GM's free placement: "no cost"). */
export function flashToken(token, label, { color = "free", ms = 1400 } = {}) {
  const id = `~flash.${++flashSeq}`;
  if ( !markTokens({ id, tokens: [{ token, label, color }], order: 950 }) ) return;
  setTimeout(() => clearTokenMarks(id), ms);
}

/* ---------------------------------------------------------------- the socket, lifecycle */

function onSocket(msg, sender) {
  if ( !msg || msg.t !== "board" ) return;
  const from = sender ? game.users?.get?.(sender) : null, gm = !!from?.isGM;
  if ( msg.op === "intent" ) { if ( game.user?.isGM && sender && msg.scene === sceneId() ) takeIntent(sender, msg.intent); return; }
  if ( msg.op === "hello" ) { if ( sender && msg.scene === sceneId() ) { MARKS.hello(sender); LINKS.hello(sender); } return; }
  if ( !gm || msg.scene !== sceneId() ) return;
  if ( msg.op === "tm" ) { if ( MARKS.take(msg, sender, BC.cleanTokenMarks) ) applyMarks(); }
  else if ( msg.op === "ln" ) { if ( LINKS.take(msg, sender, BC.cleanLinks) ) drawLinks(); }
}

function onTearDown() {
  closeMenu("sceneChanged");
  MARKS.drop(); LINKS.drop();
  for ( const r of INTENTS.values() ) clearTimeout(r.timer);
  INTENTS.clear();
  ON = new Map(); hoverTok = null; tipEl?.remove(); tipEl = null; watch(false);
  layer?.destroy(); layer = null;
}

export const boardApi = {
  /** Marks on tokens for chosen users (reach, the one chosen, caught in an area, state chips, a bar, parts under the pointer). */
  markTokens, clearTokenMarks, tokenMarks,
  /** A line from one thing to another with a reticle on the target. */
  link, clearLinks, links,
  /** Picking where to move with the route and the price under the pointer; picking where an area goes; an area shown; a warning. */
  pickMove, pickArea, areaPreview, clearArea, warn,
  /** A menu at a thing on the map; being asked about a right click on a token, a border or a zone. */
  menu, closeMenu, menuOpen, onContext,
  /** What this user has armed, for the GMs; a GM's client: the intentions on screen. */
  intent, intents,
  STATE_MARKS: BC.STATE_MARKS, TOKEN_STATES: BC.TOKEN_STATES, boardLib: BC
};

export function registerBoard() {
  Hooks.once("ready", () => game.socket?.on(CHANNEL, onSocket));
  Hooks.on("canvasReady", () => { if ( canvas.scene ) emit({ op: "hello" }); });
  Hooks.on("canvasTearDown", onTearDown);
  Hooks.on("drawToken", onTokenRefresh);
  Hooks.on("refreshToken", (t) => { onTokenRefresh(t); if ( involved.has(t.id) ) linksSoon(); });
  Hooks.on("deleteToken", (doc) => { if ( doc.parent === canvas.scene && (ON.has(doc.id) || involved.has(doc.id)) ) { linksSoon(); } });
  Hooks.on("sightRefresh", () => linksSoon());
  Hooks.on("canvasPan", () => {
    layer?.onZoom();
    if ( ON.size ) for ( const id of ON.keys() ) { const t = objOf(id); if ( t ) layoutToken(t); }
  });
  Hooks.on("moinenMapsZones", (kind) => { if ( kind !== "section" && LINKS.map.size ) linksSoon(); });
  Hooks.on("userConnected", (user, connected) => { if ( !connected && INTENTS.has(user.id) ) takeIntent(user.id, null); });
}
