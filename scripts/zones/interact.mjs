import { MODULE_ID } from "../config.mjs";
import * as Zones from "./zones.mjs";
import * as HL from "./highlight.mjs";
import { ZoneHighlightLayer } from "./highlight-layer.mjs";
import { pairKey } from "./marks.mjs";

/**
 * Highlights and zone picking, wired (dev/zones-api.md 17-18): the public calls a combat module makes, the module socket that
 * carries a highlight or a pick request to the users it is meant for, and the pointer while a zone is being picked.
 *
 *  - api.highlight(spec) shows a set of zones and borders with colours and labels: on the calling client, and (a GM's call) on the
 *    clients of the users it names. A highlight goes over the socket ONLY to those users (the server honours `recipients`), so a
 *    player's browser never receives what is not meant for it. It belongs to the scene it was made on and is gone when that scene
 *    closes; a client that opens the scene later asks for what is meant for it.
 *  - api.pick(opts) lets this client's user - or, asked by a GM, another user - click one of the allowed zones; the call resolves
 *    with the chosen place, or with why none was chosen.
 *
 * Highlights and picks are not stored anywhere: they are a show, not a state. Nothing here reads a rule.
 */

const CHANNEL = `module.${MODULE_ID}`;
const STORE = new HL.HighlightStore();
/** What this client sent to others: id -> { h (the cleaned highlight), remote ("all" | [userId]) }. */
const SENT = new Map();
let layer = null, autoId = 0, PICK = null, pickSeq = 0, askSeq = 0;
/** Picks asked of other users: request id -> { user, resolve, timer }. */
const ASKED = new Map();

const L = (k, d) => (d ? game.i18n.format(`MOINENMAPS.Zones.${k}`, d) : game.i18n.localize(`MOINENMAPS.Zones.${k}`));
const me = () => game.user?.id ?? null;
const sceneId = () => canvas.scene?.id ?? null;
const gmIds = () => (game.users?.filter?.((u) => u.isGM) ?? []).map((u) => u.id);
const emit = (msg, recipients = null) => { try { game.socket?.emit(CHANNEL, { t: "zones", scene: sceneId(), ...msg }, ...(recipients ? [{ recipients }] : [])); } catch ( err ) { console.warn(`${MODULE_ID} | zones: socket`, err); } };
const wire = (h) => ({ id: h.id, zones: h.zones, borders: h.borders, order: h.order });

/* ---------------------------------------------------------------- drawing */

const idOf = (key) => Zones.zonesApi.idOf(key);
function pairOfIds(a, b) { return Zones.zones()?.adj.get(a)?.has(b) ? pairKey(a, b) : null; }

/** What shows now: the highlights, with the zones a running pick offers laid over them where they carry no highlight of their own. */
function shown() {
  const out = STORE.compose(idOf, pairOfIds);
  if ( PICK ) for ( const [id, e] of PICK.allowed ) {
    const has = out.zones.get(id);
    if ( !has || e.label ) out.zones.set(id, { zone: e.zone, id, color: e.color, style: "fill", label: e.label ?? has?.label ?? null, tip: e.tip ?? has?.tip ?? null, of: "~pick" });
  }
  return out;
}

/** Draw again (cheap when nothing changed: the layer keeps what it drew under one key). */
export function redraw() {
  const Z = Zones.zones();
  if ( !canvas?.ready && !layer ) return;
  if ( !layer ) {
    if ( !Z || (!STORE.size && !PICK) ) return;
    layer = new ZoneHighlightLayer();
  }
  const look = Zones.look();
  const marks = new Map();
  for ( const [pk, m] of Zones.marks()?.borders ?? [] ) if ( Number.isFinite(m.x) ) marks.set(pk, { x: m.x, y: m.y });
  layer.render(Z, Z ? shown() : { zones: new Map(), borders: new Map() }, {
    zoom: canvas.stage?.scale.x ?? 1, key: `${STORE.version}|${Zones.zonesApi.version()}|${PICK?.seq ?? 0}`,
    // (a zone's label goes above its number badge when one shows in the middle of the zone)
    badge: !!look && Zones.visibleToMe() && look.numbers !== "never" && look.place !== "corner",
    pick: PICK?.allowed ?? null, marks
  });
}

/* ---------------------------------------------------------------- highlights */

/**
 * Show a set of zones and borders (highlight.mjs has the shape):
 *   highlight({ id?, zones: [key | spot | { zone, color, style, label, tip }], borders: [key | [a, b] | { border, color, style, label, tip }],
 *               color, style, borderColor, borderStyle, users, order })
 * `users`: absent - this client only; "all"; "gm"; a user id or a list of them (a GM's call; a player's highlight stays on the
 * player's own client). The same `id` again replaces what it showed, for everyone it was shown to. Returns the id, or null when
 * the spec names nothing.
 */
export function highlight(spec) {
  const h = HL.cleanHighlight(spec, me());
  if ( !h ) return null;
  if ( h.users && !game.user?.isGM ) h.users = null;
  h.id ??= `${me() ?? "x"}.${++autoId}`;
  const aud = HL.audience(h.users, me(), gmIds());
  // the users it was shown to before and is not meant for now lose it
  const old = SENT.get(h.id);
  if ( old ) {
    const still = aud.remote === "all" ? null : new Set(aud.remote ?? []);
    const gone = old.remote === "all" ? (aud.remote === "all" ? [] : "all") : old.remote.filter((u) => still && !still.has(u));
    if ( gone === "all" ) emit({ op: "hl", del: [h.id] });
    else if ( gone.length ) emit({ op: "hl", del: [h.id] }, gone);
  }
  if ( aud.remote ) { SENT.set(h.id, { h, remote: aud.remote }); emit({ op: "hl", set: [wire(h)] }, aud.remote === "all" ? null : aud.remote); }
  else SENT.delete(h.id);
  if ( aud.local ) STORE.set(h, null); else STORE.remove({ id: h.id });
  redraw();
  return h.id;
}

/**
 * Take highlights away: clearHighlights(id), clearHighlights({ id }), clearHighlights({ prefix }) (every id that starts with it),
 * clearHighlights() (everything this client made), clearHighlights({ all: true }) (also what others showed here - on this client
 * only). What this client sent to other users goes from their screens too. Returns how many went from this client's screen.
 */
export function clearHighlights(o = {}) {
  const f = typeof o === "string" ? { id: o } : (o ?? {});
  const match = (id) => (f.id == null || id === f.id) && (f.prefix == null || id.startsWith(f.prefix));
  for ( const [id, s] of [...SENT] ) {
    if ( !match(id) ) continue;
    emit({ op: "hl", del: [id] }, s.remote === "all" ? null : s.remote);
    SENT.delete(id);
  }
  const gone = STORE.remove({ id: f.id ?? null, prefix: f.prefix ?? null, ...(f.all || f.id != null || f.prefix != null ? {} : { from: null }) });
  if ( gone.length ) redraw();
  return gone.length;
}

/** The highlights on this client's screen: [{ id, zones, borders, order, from (null: made here, else the user id of the GM who sent it) }]. */
export const highlights = () => STORE.list().map((h) => ({ id: h.id, zones: h.zones.map((e) => ({ ...e })), borders: h.borders.map((e) => ({ ...e })), order: h.order, from: h.from }));

/**
 * The zones a mover can reach, highlighted with their distance (api.reach counted for the profile): within one movement action
 * in the "move" colour, only with the stress option in the "stress" colour, its own zone outlined; farther zones are left out
 * unless `beyond: true` (grey, dashed). opts: { id = "reach", users, max, beyond, labels = true, order }. Returns the id (null:
 * nowhere to go).
 */
export function showReach(where, profile = {}, { id = "reach", users = null, max = Infinity, beyond = false, labels = true, order = 0 } = {}) {
  const rows = Zones.reach(where, profile, { max });
  const zones = [];
  for ( const r of rows ) {
    const w = r.cost?.within ?? (r.d === 0 ? "free" : "plain");
    if ( w === "no" && !beyond ) continue;
    zones.push({ zone: r.zone, color: w === "free" ? "here" : w === "plain" ? "move" : w === "stress" ? "stress" : "blocked", style: w === "free" ? "outline" : w === "no" ? "dashed" : "fill", label: labels && r.d > 0 ? String(r.d) : null });
  }
  return zones.length ? highlight({ id, zones, users, order }) : null;
}

/* ---------------------------------------------------------------- picking a zone */

/**
 * Let a user pick a zone by clicking it. Resolves - never rejects - with
 *   { ok: true, zone (key), id, spot, place, x, y }                       the place picked and the scene point of the click
 *   { ok: false, reason: "cancelled" | "replaced" | "noZones" | "sceneChanged" | "timeout" | "userGone" | "notGM" | "noScene" }
 * opts: { zones: [key | spot | { zone | spot, label, tip, color }] (absent: any zone), title, hint, color, timeout (ms),
 *         user (a user or user id: ask that user - a GM's call; absent: this client's user) }
 * A spot string in `zones` ("z3:elevated", "z3:f2") is the place the answer carries; a bare key answers with the zone's ground
 * level. The zones on offer are shown in their colour with their label (a highlight already on a zone stays, unless the entry
 * brings a label of its own); the others are dimmed. A click on a zone on offer picks it; Escape, a right-click or the Cancel
 * button gives it up; a new pick replaces a running one. Right-drag still pans, the wheel still zooms.
 */
export function pick(opts = {}) {
  const user = opts?.user?.id ?? opts?.user ?? null;
  if ( user && user !== me() ) return askUser(user, opts);
  const P = HL.cleanPick(opts);
  if ( !P ) return Promise.resolve({ ok: false, reason: "noZones" });
  return pickHere(P);
}
export const picking = () => !!PICK;
/** Give up the pick running on this client (`user`: the pick a GM asked of that user). True when there was one. */
export function cancelPick({ user = null } = {}) {
  const u = user?.id ?? user;
  if ( u && u !== me() ) {
    let any = false;
    for ( const [rid, a] of ASKED ) if ( a.user === u ) { any = true; emit({ op: "pickCancel", rid }, [u]); }
    return any;
  }
  if ( !PICK ) return false;
  endPick({ ok: false, reason: "cancelled" });
  return true;
}

/** The zones a pick offers, by their id now: id -> entry. */
function allowedOf(P) {
  const allowed = new Map();
  if ( P.zones ) for ( const e of P.zones ) { const id = idOf(e.zone); if ( id >= 0 ) allowed.set(id, e); }
  else for ( const z of Zones.zones()?.zones ?? [] ) { const key = Zones.zonesApi.keyOf(z.id); allowed.set(z.id, { zone: key, spot: key, label: null, tip: null, color: P.color }); }
  return allowed;
}

function pickHere(P) {
  if ( PICK ) endPick({ ok: false, reason: "replaced" });
  const Z = Zones.zones();
  if ( !Z || !canvas?.ready ) return Promise.resolve({ ok: false, reason: "noZones" });
  const allowed = allowedOf(P);
  if ( !allowed.size ) return Promise.resolve({ ok: false, reason: "noZones" });
  return new Promise((resolve) => {
    PICK = { P, allowed, resolve, seq: ++pickSeq, offs: [], hover: -1, down: null, rdown: null, raf: 0, at: null, banner: null, tip: null };
    startPick();
    redraw();
  });
}

function endPick(result) {
  const p = PICK;
  if ( !p ) return;
  PICK = null;
  for ( const off of p.offs ) { try { off(); } catch {} }
  cancelAnimationFrame(p.raf);
  p.banner?.remove(); p.tip?.remove();
  document.body.classList.remove("mm-z-picking", "mm-z-pick-ok", "mm-z-pick-no");
  layer?.setHover(-1);
  redraw();
  p.resolve(result);
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function startPick() {
  const p = PICK, view = canvas.app.view;
  // the banner: what is asked, how to answer, a way out
  const el = p.banner = document.createElement("div");
  el.className = "mm-z-pick";
  el.setAttribute("role", "status");
  el.innerHTML = `<i class="fa-solid fa-location-crosshairs" inert></i>
    <span class="mm-z-pick-text"><b>${esc(p.P.title ?? L("pick.title"))}</b><small>${esc(p.P.hint ?? L("pick.hint"))}</small></span>
    <button type="button" data-act="cancel">${esc(L("pick.cancel"))} <kbd>Esc</kbd></button>`;
  el.querySelector("button").addEventListener("click", () => endPick({ ok: false, reason: "cancelled" }));
  document.body.append(el);
  document.body.classList.add("mm-z-picking");

  const world = (ev) => canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
  const zoneAt = (pt) => Zones.zonesApi.zoneAt(pt.x, pt.y);
  const setHover = (id, at) => {
    const ok = p.allowed.has(id);
    document.body.classList.toggle("mm-z-pick-ok", ok);
    document.body.classList.toggle("mm-z-pick-no", !ok && id >= 0);
    if ( id < 0 ) { p.hover = -1; layer?.setHover(-1); p.tip?.remove(); p.tip = null; return; }
    if ( !p.tip ) { p.tip = document.createElement("div"); p.tip.className = "mm-z-tip mm-z-pick-tip"; document.body.append(p.tip); p.hover = -2; }
    if ( id !== p.hover ) {
      p.hover = id; layer?.setHover(ok ? id : -1);
      // beside the cursor: the zone's name with what the caller said about it
      const e = ok ? p.allowed.get(id) : null, sh = e ? shown().zones.get(id) : null;
      const label = e?.label ?? sh?.label ?? null, tip = e?.tip ?? sh?.tip ?? null;
      p.tip.classList.toggle("no", !e);
      p.tip.innerHTML = e ? `<b>${esc(L("zone.title", { n: Zones.zoneName(id) }))}</b>${label ? ` · ${esc(label)}` : ""}${tip ? `<small>${esc(tip)}</small>` : ""}` : esc(L("pick.notHere"));
    }
    p.tip.style.left = `${at.x + 16}px`; p.tip.style.top = `${at.y + 18}px`;
  };
  const onMove = (ev) => {
    p.at = { x: ev.clientX, y: ev.clientY };
    if ( p.raf ) return;
    p.raf = requestAnimationFrame(() => { p.raf = 0; if ( PICK !== p || !p.at || !canvas.ready ) return; setHover(zoneAt(canvas.canvasCoordinatesFromClient(p.at)), p.at); });
  };
  const onLeave = () => { p.at = null; setHover(-1, { x: 0, y: 0 }); };
  // a left press is the pick's (no token is selected or dragged under it); a right press still pans when dragged
  const onDown = (ev) => {
    if ( ev.button === 2 ) { p.rdown = { x: ev.clientX, y: ev.clientY }; return; }
    if ( ev.button !== 0 ) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    p.down = { x: ev.clientX, y: ev.clientY };
  };
  const onUp = (ev) => {
    if ( ev.button === 2 ) {
      const r = p.rdown; p.rdown = null;
      if ( r && Math.hypot(ev.clientX - r.x, ev.clientY - r.y) < 5 && ev.target === view ) endPick({ ok: false, reason: "cancelled" });
      return;
    }
    if ( ev.button !== 0 || !p.down ) return;
    const d = p.down; p.down = null;
    if ( Math.hypot(ev.clientX - d.x, ev.clientY - d.y) >= 6 ) return;
    const pt = world(ev), id = zoneAt(pt), e = p.allowed.get(id);
    if ( !e ) return;
    const place = Zones.placeOf(e.spot) ?? Zones.placeOf(e.zone);
    endPick({ ok: true, zone: e.zone, id, spot: place?.spot ?? e.zone, place, x: pt.x, y: pt.y });
  };
  const onKey = (ev) => { if ( ev.key === "Escape" ) { ev.preventDefault(); ev.stopPropagation(); endPick({ ok: false, reason: "cancelled" }); } };
  const onCtx = (ev) => ev.preventDefault();
  view.addEventListener("pointerdown", onDown, true);
  view.addEventListener("pointermove", onMove, { passive: true });
  view.addEventListener("pointerleave", onLeave);
  view.addEventListener("contextmenu", onCtx);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKey, true);
  p.offs.push(
    () => view.removeEventListener("pointerdown", onDown, true), () => view.removeEventListener("pointermove", onMove), () => view.removeEventListener("pointerleave", onLeave),
    () => view.removeEventListener("contextmenu", onCtx), () => window.removeEventListener("pointerup", onUp), () => window.removeEventListener("keydown", onKey, true)
  );
  if ( p.P.timeout ) { const t = setTimeout(() => { if ( PICK === p ) endPick({ ok: false, reason: "timeout" }); }, p.P.timeout); p.offs.push(() => clearTimeout(t)); }
}

/** A GM asks another user to pick: the request goes to that user alone, the answer comes back the same way. */
function askUser(user, opts) {
  if ( !game.user?.isGM ) return Promise.resolve({ ok: false, reason: "notGM" });
  const u = game.users?.get?.(user);
  if ( !u?.active ) return Promise.resolve({ ok: false, reason: "userGone" });
  if ( !HL.cleanPick(opts) ) return Promise.resolve({ ok: false, reason: "noZones" });
  const rid = `${me()}.${++askSeq}`, t = Number(opts.timeout);
  return new Promise((resolve) => {
    const a = { user, resolve, timer: 0 };
    // (the asked client runs the timeout too; this one a little later, in case the answer never comes)
    if ( Number.isFinite(t) && t > 0 ) a.timer = setTimeout(() => answer(rid, { ok: false, reason: "timeout" }), t + 3000);
    ASKED.set(rid, a);
    emit({ op: "pick", rid, pick: { zones: opts.zones ?? null, title: opts.title ?? null, hint: opts.hint ?? null, color: opts.color ?? null, timeout: opts.timeout ?? 0 } }, [user]);
  });
}
function answer(rid, result) {
  const a = ASKED.get(rid);
  if ( !a ) return;
  ASKED.delete(rid);
  clearTimeout(a.timer);
  a.resolve(result);
}

/* ---------------------------------------------------------------- the socket */

/** The server adds the sender's user id. Highlights and pick requests are taken from GMs only; an answer only from the user asked. */
function onSocket(msg, sender) {
  if ( !msg || msg.t !== "zones" ) return;
  const from = sender ? game.users?.get?.(sender) : null, gm = !!from?.isGM;
  if ( msg.op === "hl" ) {
    if ( !gm || msg.scene !== sceneId() ) return;
    let any = false;
    for ( const id of Array.isArray(msg.del) ? msg.del : [] ) { const h = STORE.get(String(id)); if ( h && h.from != null ) { STORE.remove({ id: h.id }); any = true; } }
    for ( const raw of Array.isArray(msg.set) ? msg.set : [] ) {
      const h = HL.cleanHighlight(raw, me());
      if ( !h?.id ) continue;
      h.users = null;
      STORE.set(h, sender); any = true;
    }
    if ( any ) redraw();
  }
  // a client opened this scene: it gets again what was meant for it
  else if ( msg.op === "hello" ) {
    if ( !sender || msg.scene !== sceneId() || !SENT.size ) return;
    const set = [...SENT.values()].filter((s) => s.remote === "all" || s.remote.includes(sender)).map((s) => wire(s.h));
    if ( set.length ) emit({ op: "hl", set }, [sender]);
  }
  else if ( msg.op === "pick" ) {
    if ( !gm || typeof msg.rid !== "string" ) return;
    const reply = (result) => emit({ op: "picked", rid: msg.rid, result }, [sender]);
    const P = msg.scene === sceneId() ? HL.cleanPick(msg.pick) : null;
    if ( !P ) { reply({ ok: false, reason: msg.scene === sceneId() ? "noZones" : "noScene" }); return; }
    pickHere(P).then((r) => { if ( PICK?.rid === msg.rid ) PICK.rid = null; reply(r); });
    if ( PICK ) PICK.rid = msg.rid;
  }
  else if ( msg.op === "pickCancel" ) { if ( gm && PICK && PICK.rid === msg.rid ) endPick({ ok: false, reason: "cancelled" }); }
  else if ( msg.op === "picked" ) { const a = ASKED.get(msg.rid); if ( a && a.user === sender ) answer(msg.rid, msg.result && typeof msg.result === "object" ? msg.result : { ok: false, reason: "cancelled" }); }
}

/* ---------------------------------------------------------------- lifecycle */

function onTearDown() {
  if ( PICK ) endPick({ ok: false, reason: "sceneChanged" });
  // what this client showed to others belonged to this scene
  for ( const [id, s] of SENT ) emit({ op: "hl", del: [id] }, s.remote === "all" ? null : s.remote);
  SENT.clear();
  STORE.remove({});
  layer?.destroy(); layer = null;
}

export const interactApi = {
  /** Highlight zones and borders for chosen users; take highlights away; what is highlighted here; a mover's reach, highlighted. */
  highlight, clearHighlights, highlights, showReach,
  /** Let a user pick a zone by click (resolves with the place), give a pick up, whether one runs here. */
  pick, cancelPick, picking,
  HIGHLIGHT_COLORS: HL.COLORS, highlightLib: HL
};

export function registerInteract() {
  Hooks.once("ready", () => game.socket?.on(CHANNEL, onSocket));
  Hooks.on("canvasReady", () => { if ( canvas.scene ) emit({ op: "hello" }); redraw(); });
  Hooks.on("canvasTearDown", onTearDown);
  // the zones were redrawn, their look or their marks changed: the highlights follow
  Hooks.on("moinenMapsZones", (kind) => {
    if ( kind === "section" || !(layer || STORE.size || PICK) ) return;
    // (the zones on offer are kept by id: the GM redrew the lines under a running pick)
    if ( PICK && (kind === "edited" || kind === "loaded") ) {
      PICK.allowed = allowedOf(PICK.P); PICK.seq = ++pickSeq;
      if ( !PICK.allowed.size ) { endPick({ ok: false, reason: "noZones" }); return; }
    }
    redraw();
  });
  // a user who was asked to pick left
  Hooks.on("userConnected", (user, connected) => { if ( connected ) return; for ( const [rid, a] of [...ASKED] ) if ( a.user === user.id ) answer(rid, { ok: false, reason: "userGone" }); });
}
