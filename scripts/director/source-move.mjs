import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as Dir from "./core.mjs";
import * as M from "./move-core.mjs";
import { emit, isLeader, killed, isOn, publicName, registerPlay, myMode, R, HOOK } from "./director.mjs";
import { Screen } from "./stage.mjs";
import { safeRect } from "./overlay.mjs";
import { extendSection } from "../workspace/registry.mjs";
import { esc, optRange, optSelect, optCheck, optHint, isEcho, writeControl } from "../workspace/ui.mjs";

/**
 * DIRECTOR SOURCE: TOKEN MOVEMENT AND COMBAT TURNS.
 *
 *  - A token's MOVE (Foundry's "moveToken", on the leader) becomes a "move" event when it matters (move-core moveWeight): the active
 *    combatant's move always, a long move of a GM-moved token, a push / teleport more; the party exploring only as a marker (setting).
 *    A take-over FOLLOWS the token while it walks (a spring camera with a little look-ahead, the token's own animation on every client)
 *    and lets go a moment after it stops; the camera then returns to the player's view.
 *  - A COMBAT TURN: every client shows the turn BANNER at once (the combat update reaches everyone at the same moment: no socket), and
 *    the leader sends a "turn" event: the camera goes to the active combatant (on your own turn it stays on your token: setting).
 *    Turns and the active combatant's moves share one LANE per combat: the next turn supersedes a waiting one, a move of the active
 *    combatant carries on from the turn shot on screen (no return between), and the lane is exempt from the cooldown downgrades.
 *  - Per client (play handler "move"): nothing when this player moved it, when it is already on this player's screen, or when the
 *    token is not in this player's sight (hidden, out of vision); the follow stops where the token leaves the player's sight; a soft
 *    marker of a move only where the player sees its destination.
 * Idle: no ticker listener, no timer; one ticker listener only while a follow take-over plays.
 */

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const F = (k, data) => game.i18n.format(`MOINENMAPS.${k}`, data);
const grid = () => canvas?.dimensions?.size ?? canvas?.grid?.size ?? 100;
const live = () => !killed() && isOn() && canvas?.ready && isLeader();
const KEY = "dirMove";
let setCache = null;
export const moveSettings = () => (setCache ??= M.sanitizeSet((() => { try { return game.settings.get(MODULE_ID, KEY); } catch { return null; } })()));

/** The started combat whose tokens are on the viewed scene (or an unlinked one), or null. */
function combatHere() {
  const c = game.combats?.viewed ?? game.combat;
  if ( !c?.started ) return null;
  return !c.scene || c.scene.id === canvas.scene?.id ? c : null;
}
const sizePx = (d) => ({ w: (Number(d.width) || 1) * grid(), h: (Number(d.height) || 1) * grid() });

/* ---------------------------------------------------------------- the leader: events */

function onMoveToken(doc, movement, operation, user) {
  if ( !live() || doc.parent?.id !== canvas.scene?.id || !movement?.passed?.waypoints?.length ) return;
  const S = moveSettings(); if ( !S.move ) return;
  const g = grid(), { w: wpx, h: hpx } = sizePx(doc);
  const wps = movement.passed.waypoints;
  const { p, len } = M.pathOf(movement.origin, wps, wpx, hpx);
  if ( p.length < 4 ) return;
  const combat = combatHere(), active = !!combat && combat.combatant?.tokenId === doc.id;
  const player = !!doc.actor?.hasPlayerOwner;
  const byOwner = !!user && !user.isGM && !!doc.testUserPermission?.(user, "OWNER");
  const acts = CONFIG.Token?.movement?.actions ?? {};
  const teleport = wps.some((q) => !!acts[q?.action]?.teleport);
  const forced = wps.some((q) => q?.action === "displace") || (player && !byOwner && !!combat && !active);
  const { w, free } = M.moveWeight({ d: len / g, moveSq: S.moveSq, combat: !!combat, active: active && S.turns, player, byOwner, forced, teleport, party: S.party, takeAt: R().takeAt });
  if ( !(w > 0) ) return;
  const dest = { x: p[p.length - 2], y: p[p.length - 1] };
  const anim = Number(movement.animation?.duration);
  const dur = Number.isFinite(anim) && anim > 0 ? anim : (len / g / (CONFIG.Token?.movement?.defaultSpeed || 6)) * 1000;
  emit({
    kind: "move", src: "move", id: `mv-${movement.id ?? doc.id}`.slice(0, 40), weight: w, box: M.pathBox(p, g), x: dest.x, y: dest.y, tokens: [doc.id],
    who: doc.hidden ? "gm" : "all", path: M.thinPath(p, 24), dur: Math.min(7000, dur + 700),
    lane: active ? `cbt-${combat.id}` : `mv-${doc.id}`, free, quick: true,
    caption: { key: teleport ? "DirMove.cap.teleport" : forced ? "DirMove.cap.pushed" : "DirMove.cap.move", data: { token: doc.id, name: publicName(doc) } },
    play: { by: "move", follow: doc.id, not: user?.id ? [user.id] : [] }
  });
}

function emitTurn(combat, cur) {
  const S = moveSettings(); if ( !S.turns ) return;
  const cb = combat.combatant, d = cb?.token;
  if ( !d || d.parent?.id !== canvas.scene?.id ) return;
  const g = grid(), { w, h } = sizePx(d), c = { x: d.x + w / 2, y: d.y + h / 2 };
  const at = Math.round(Number(combat._stats?.modifiedTime) || Date.now()).toString(36);
  emit({
    kind: "turn", src: "turns", id: `tn-${combat.id}-${cur.round}-${cur.turn}-${at}`.slice(0, 40), weight: 0.75, box: Dir.pointBox(c.x, c.y, Math.max(w, h) / 2 + g * 2.5), x: c.x, y: c.y,
    tokens: [d.id], who: cb.hidden || d.hidden ? "gm" : "all", lane: `cbt-${combat.id}`, free: true, quick: true,
    caption: { key: "DirMove.cap.turn", data: { cname: cb.hidden ? "" : cb.name } }, play: { by: "move", turn: d.id }
  });
}

/* ---------------------------------------------------------------- every client: how a move / turn shot plays here */

let curLane = null;                      // the lane of the take-over on this screen (a later shot of it is judged from the camera now)
function viewFor(shot) {
  const st = canvas.stage, vw = canvas.app.screen.width, vh = canvas.app.screen.height;
  // (it returns there: the home of a take-over of another lane, or of the scene arrival whose wide start is on screen now)
  if ( Screen.owner && Screen.home && (Screen.owner !== "director" || !shot.lane || curLane !== shot.lane) ) return { ...Screen.home, vw, vh };
  return { x: st.pivot.x, y: st.pivot.y, scale: st.scale.x, vw, vh };
}
const sees = (x, y) => { try { return canvas.visibility.testVisibility({ x, y }, { tolerance: grid() * 0.3 }); } catch { return false; } };
/** The token as this client may see it: the placeable when it is visible here (a GM sees every token), else null. */
function seen(id) {
  const d = canvas.scene?.tokens?.get(id), t = d?.object;
  if ( !t || t.destroyed ) return null;
  if ( game.user.isGM ) return t;
  return !d.hidden && t.visible ? t : null;
}
function tokenBox(t, pad = 0) { const { x, y } = t.document, { w, h } = sizePx(t.document); return { x0: x - pad, y0: y - pad, x1: x + w + pad, y1: y + h + pad }; }

const handler = {
  caption: false,                                        // (the banner / the motion itself says it; soft markers keep their label)
  check(shot, form) {
    const p = shot.play ?? {};
    if ( Array.isArray(p.not) && p.not.includes(game.user.id) ) return "none";    // I moved it myself
    const id = p.follow ?? p.turn, t = id ? seen(id) : null;
    if ( !t ) return "none";                                                       // not in my sight (hidden, out of vision, gone)
    if ( form === "soft" && p.follow && !game.user.isGM && canvas.visibility?.tokenVision && !sees(shot.x, shot.y) ) return "none";   // (the marker would show where it went)
    const box = p.follow ? shot.box : tokenBox(t, grid() * 0.5);
    if ( M.inView(box, viewFor(shot), safeRect(), 12) ) return "none";             // it is on my screen already
    return null;
  },
  drive(shot, api) {
    const id = shot.play?.follow; if ( !id ) return null;                          // (a turn: the framed move to the combatant)
    const g = api.grid, app = canvas.app;
    const scale1 = M.followScale(api.home.scale, app.screen.width, app.screen.height, g, api.r.zoomIn, api.k, api.reduced, api.limits);
    const centre = (t) => { const c = t.center; return { x: c.x, y: c.y }; };
    const t0 = seen(id);
    const st = M.followInit(t0 ? centre(t0) : null, { x: shot.x, y: shot.y });
    const settleMs = Math.round(700 * (api.r.holdK ?? 1));
    let settleAt = null, lost = !t0;
    const tick = () => {
      const t = seen(id), here = t ? centre(t) : null;
      if ( !here ) lost = true;                                                    // left my sight: the camera stays where I last saw it
      const v = M.followStep(st, lost ? null : here, app.ticker.deltaMS, { from: api.from, lead: api.lead, scale0: api.from.scale, scale1, ahead: g * 1.5, smoothS: api.reduced ? 0.6 : 0.32 });
      if ( api.cameraOn() ) canvas.pan(v);
      const moving = !lost && !!t && t.animationContexts?.has?.(t.movementAnimationName);
      const now = performance.now();
      if ( moving ) settleAt = null; else settleAt ??= now + (lost ? 350 : settleMs);
      if ( settleAt !== null && now >= settleAt && st.t >= api.lead ) api.end("done");
    };
    app.ticker.add(tick, null, PIXI.UPDATE_PRIORITY.NORMAL);
    return { stop: () => app.ticker.remove(tick) };
  },
  stay(shot) {
    const id = shot.play?.turn; if ( !id || game.user.isGM || !moveSettings().ownStay ) return false;
    return !!canvas.scene?.tokens?.get(id)?.isOwner;
  }
};

/* ---------------------------------------------------------------- the turn banner (every client, from the combat update itself) */

const CSS = `
.mm-dmv { position: fixed; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; font-family: var(--font-primary, sans-serif); }
.mm-dmv-b { position: absolute; left: 50%; top: var(--mm-dmv-top, 5vh); transform: translate(-50%, 0); display: grid; justify-items: center; gap: 0.1rem;
  padding: 0.5rem 4.5rem 0.6rem; color: #f4efe6; text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 0 16px rgba(0,0,0,0.55); white-space: nowrap; }
.mm-dmv-b::before { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(90deg, rgba(10,8,6,0) 0%, rgba(10,8,6,0.78) 22%, rgba(10,8,6,0.78) 78%, rgba(10,8,6,0) 100%);
  transform: scaleX(0); transition: transform 520ms cubic-bezier(0.16, 0.8, 0.3, 1); }
.mm-dmv-b::after { content: ""; position: absolute; left: 18%; right: 18%; bottom: 0; height: 1px; background: linear-gradient(90deg, transparent, #e9c46a, transparent);
  transform: scaleX(0); transition: transform 760ms cubic-bezier(0.16, 0.8, 0.3, 1) 120ms; }
.mm-dmv-kick { font-size: 0.7rem; letter-spacing: 0.34em; text-transform: uppercase; color: #e9c46a; opacity: 0; transform: translateY(-5px);
  transition: opacity 380ms ease-out 80ms, transform 560ms cubic-bezier(0.16, 0.8, 0.3, 1) 80ms; display: flex; align-items: center; gap: 0.6em; }
.mm-dmv-kick > i { font-size: 0.8em; }
.mm-dmv-name { font-family: "Modesto Condensed", var(--font-primary, serif); font-size: clamp(1.5rem, 3vw, 2.6rem); line-height: 1.05; letter-spacing: 0.05em; opacity: 0;
  transform: translateY(8px) scale(0.98); filter: blur(3px); transition: opacity 460ms ease-out 160ms, transform 700ms cubic-bezier(0.16, 0.8, 0.3, 1) 160ms, filter 460ms ease-out 160ms; }
.mm-dmv-sub { margin-top: 0.15rem; padding: 0.1rem 0.7rem; font-size: 0.68rem; letter-spacing: 0.28em; text-transform: uppercase; color: #1a140c; background: #e9c46a; border-radius: 2px;
  opacity: 0; transform: scale(0.9); transition: opacity 360ms ease-out 420ms, transform 520ms cubic-bezier(0.2, 1.4, 0.4, 1) 420ms; }
.mm-dmv-tag { margin-top: 0.15rem; font-size: 0.62rem; letter-spacing: 0.2em; text-transform: uppercase; color: #cfc8bb; opacity: 0; transition: opacity 360ms ease-out 420ms; }
.mm-dmv-b.is-round .mm-dmv-kick { font-size: 0.86rem; color: #f2cf73; }
.mm-dmv-b.is-in::before, .mm-dmv-b.is-in::after { transform: scaleX(1); }
.mm-dmv-b.is-in .mm-dmv-kick { opacity: 0.95; transform: none; }
.mm-dmv-b.is-in .mm-dmv-name { opacity: 1; transform: none; filter: none; }
.mm-dmv-b.is-in .mm-dmv-sub, .mm-dmv-b.is-in .mm-dmv-tag { opacity: 1; transform: none; }
.mm-dmv-b.is-out { opacity: 0; transform: translate(-50%, -14px); transition: opacity 420ms ease-in, transform 520ms ease-in; }
.mm-dmv-b.is-calm, .mm-dmv-b.is-calm * { transition-property: opacity !important; filter: none !important; }
.mm-dmv-b.is-calm { transform: translate(-50%, 0); }
.mm-dmv-b.is-calm .mm-dmv-kick, .mm-dmv-b.is-calm .mm-dmv-name, .mm-dmv-b.is-calm .mm-dmv-sub { transform: none; }
.mm-dmv-b.is-calm::before, .mm-dmv-b.is-calm::after { transform: none; opacity: 0; transition: opacity 400ms ease-out; }
.mm-dmv-b.is-calm.is-in::before, .mm-dmv-b.is-calm.is-in::after { opacity: 1; }
`;
let root = null, banner = null;
function host() {
  if ( !document.querySelector("style[data-mm-dmv]") ) { const s = document.createElement("style"); s.textContent = CSS; s.dataset.mmDmv = ""; document.head.appendChild(s); }
  if ( root?.isConnected ) return root;
  const ui = document.getElementById("interface");
  root = document.createElement("div"); root.className = "mm-dmv"; root.dataset.mmDmv = "";
  (ui?.parentNode ?? document.body).insertBefore(root, ui ?? null);
  return root;
}
function dropBanner(ms = 0) {
  const b = banner; banner = null; if ( !b ) return;
  clearTimeout(b.timer);
  const gone = () => { b.el.remove(); if ( root && !root.children.length ) { root.remove(); root = null; } };
  if ( ms ) { b.el.classList.add("is-out"); setTimeout(gone, ms); } else gone();
}
/** The banner's top edge: under Foundry's top navigation, at least 3 % down. */
function bannerTop() {
  const nav = document.getElementById("navigation")?.getBoundingClientRect?.();
  let top = Math.max(nav?.height && nav.bottom < innerHeight / 3 ? nav.bottom + 8 : 0, innerHeight * 0.03);
  // below anything else another module put across the top centre (an initiative bar, a HUD): the first free 48 px down the middle
  // (the banner is centred on the window: three columns across its width are probed)
  const cx = innerWidth / 2, OPEN = new Set(["board", "interface", "ui-top", "ui-middle", "ui-left", "ui-right"]);
  const freeAt = (x, y) => { const el = document.elementFromPoint(x, y); return !el || el === document.body || el === document.documentElement || OPEN.has(el.id) || el.tagName === "CANVAS"; };
  const free = (y) => freeAt(cx, y) && freeAt(cx - 170, y) && freeAt(cx + 170, y);
  let run = 0;
  for ( let y = 0; y < innerHeight * 0.4; y += 6 ) {
    if ( free(y) ) { run += 6; if ( run >= 48 ) { top = Math.max(top, y - run + 6 + 8); break; } } else run = 0;
  }
  return Math.min(top, innerHeight * 0.4);
}
/** Shows a banner { kick, name, sub, tag, round, icon } for `ms`; a new one replaces the one on screen at once. */
export function showBanner({ kick, name = "", sub = "", tag = "", round = false, icon = "fa-solid fa-hourglass-half", ms = 2400 }) {
  dropBanner(0);
  const reduced = (() => { try { return game.settings.get(MODULE_ID, "cinReduced") === "on" || (game.settings.get(MODULE_ID, "cinReduced") === "auto" && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch { return false; } })();
  const el = document.createElement("div");
  el.className = `mm-dmv-b${round ? " is-round" : ""}${reduced ? " is-calm" : ""}`;
  el.style.setProperty("--mm-dmv-top", `${Math.round(bannerTop())}px`);
  el.innerHTML = `<div class="mm-dmv-kick"><i class="${esc(icon)}" inert></i><span>${esc(kick)}</span></div>${name ? `<div class="mm-dmv-name">${esc(name)}</div>` : ""}`
    + `${sub ? `<div class="mm-dmv-sub">${esc(sub)}</div>` : ""}${tag ? `<div class="mm-dmv-tag">${esc(tag)}</div>` : ""}`;
  host().appendChild(el);
  void el.offsetWidth;
  el.classList.add("is-in");
  banner = { el, timer: setTimeout(() => { if ( banner?.el === el ) dropBanner(520); }, ms) };
  return el;
}
const bannerOn = () => !killed() && isOn() && moveSettings().banner && myMode() !== "off" && canvas?.ready;

/**
 * Another module that already announces it on this client: invincible-plus-ultra shows "Combat begins" / "Round N" (combatBannerEnabled)
 * and a "Your turn" message (turnMessage). Then that banner is theirs and ours stays away (no two titles at once).
 */
function announcedElsewhere(b) {
  if ( !game.modules.get("invincible-plus-ultra")?.active ) return false;
  const get = (k) => { try { return game.settings.get("invincible-plus-ultra", k); } catch { return undefined; } };
  if ( b.kick !== "turn" && get("combatBannerEnabled") !== false && (b.kick !== "round" || get("combatBannerRounds") !== "edges") ) return true;
  return b.mine && get("turnMessage") !== false;
}
const lastTurn = new Map();              // combat id -> "round:combatant" announced (an update that changes nothing else is not a turn)
function onUpdateCombat(combat, changed) {
  if ( !changed || !("turn" in changed || "round" in changed) || !combat.started ) return;
  const cur = combat.current, key = `${cur?.round}:${cur?.combatantId}`;
  if ( lastTurn.get(combat.id) === key ) return;
  lastTurn.set(combat.id, key);
  onTurnChange(combat, combat.previous, cur);
}
function onTurnChange(combat, prev, cur) {
  if ( combat !== combatHere() ) return;
  if ( bannerOn() ) {
    const cb = combat.combatant, visible = !!cb && (game.user.isGM || (!cb.hidden && !cb.token?.hidden));
    const b = M.bannerFor(prev, cur, { name: cb?.name, visible, mine: !game.user.isGM && !!cb?.isOwner });
    if ( b && (b.title || b.kick !== "turn") && !announcedElsewhere(b) ) {
      const kick = b.kick === "start" ? F("DirMove.b.start", { n: b.round }) : F("DirMove.b.round", { n: b.round });
      showBanner({ kick, name: b.title ?? "", sub: b.mine ? T("DirMove.b.mine") : "", tag: game.user.isGM && (cb?.hidden || cb?.token?.hidden) ? T("DirMove.b.hidden") : "", round: b.kick !== "turn",
        icon: b.kick === "start" ? "fa-solid fa-swords" : "fa-solid fa-hourglass-half", ms: b.kick === "turn" ? 2300 : 2900 });
    }
  }
  if ( live() ) emitTurn(combat, cur);
}
function onDeleteCombat(combat) {
  if ( !combat?.started || !bannerOn() || announcedElsewhere({ kick: "end" }) ) return;
  if ( combat.scene && combat.scene.id !== canvas.scene?.id ) return;
  showBanner({ kick: T("DirMove.b.endKick"), name: T("DirMove.b.end"), round: true, icon: "fa-solid fa-flag-checkered", ms: 2400 });
}

/* ---------------------------------------------------------------- settings + the panel of the Director section */

function registerSettings() {
  game.settings.register(MODULE_ID, KEY, { scope: "world", config: false, type: Object, default: { ...M.SET_DEFAULTS }, onChange: () => { setCache = null; } });
}
function renderPanel(hostEl) {
  const s0 = moveSettings();
  hostEl.innerHTML = `<div class="mm-ws-form mm-dmv-panel">
    ${optCheck({ name: "move", label: T("DirMove.move"), checked: s0.move, hint: T("DirMove.moveHint") })}
    ${optRange({ name: "moveSq", label: T("DirMove.moveSq"), value: s0.moveSq, min: M.MOVE_SQ[1], max: M.MOVE_SQ[2], step: 1, hint: T("DirMove.moveSqHint") })}
    ${optSelect({ name: "party", label: T("DirMove.party"), value: s0.party, options: M.PARTY.map((v) => [v, T(`DirMove.party_${v}`)]), hint: T("DirMove.partyHint") })}
    ${optCheck({ name: "turns", label: T("DirMove.turns"), checked: s0.turns, hint: T("DirMove.turnsHint") })}
    ${optCheck({ name: "ownStay", label: T("DirMove.ownStay"), checked: s0.ownStay, hint: T("DirMove.ownStayHint") })}
    ${optCheck({ name: "banner", label: T("DirMove.banner"), checked: s0.banner, hint: T("DirMove.bannerHint") })}
    ${optHint(T("DirMove.panelHint"))}</div>`;
  const ctl = (n) => hostEl.querySelector(`[name="${n}"]`);
  const refresh = () => { const s = moveSettings(); for ( const k of Object.keys(M.SET_DEFAULTS) ) { const c = ctl(k); if ( c && !c.contains(document.activeElement) ) writeControl(c, s[k]); } };
  const onChange = (ev) => {
    if ( isEcho() || !game.user.isGM ) return;
    const c = ev.target.closest?.("[name]"); if ( !c || !(c.name in M.SET_DEFAULTS) ) return;
    const v = c.matches("input[type=checkbox]") ? c.checked : c.name === "moveSq" ? Number(c.value) : c.value;
    const next = M.sanitizeSet({ ...moveSettings(), [c.name]: v });
    if ( JSON.stringify(next) === JSON.stringify(moveSettings()) ) { refresh(); return; }
    game.settings.set(MODULE_ID, KEY, next);
  };
  hostEl.addEventListener("change", onChange);
  const hook = Hooks.on("updateSetting", (s) => { if ( s.key === `${MODULE_ID}.${KEY}` ) { setCache = null; refresh(); } });
  return () => { hostEl.removeEventListener("change", onChange); Hooks.off("updateSetting", hook); hostEl.innerHTML = ""; };
}

/* ---------------------------------------------------------------- wiring */

Hooks.once("init", registerSettings);
Hooks.once("ready", () => {
  registerPlay("move", handler);
  Hooks.on("moveToken", onMoveToken);
  // (updateCombat, not combatTurnChange: the active GM gets combatTurnChange only after awaiting the turn events - a system's
  // initiative dialog can hold it for seconds - while every other client already has it)
  Hooks.on("updateCombat", onUpdateCombat);
  Hooks.on("deleteCombat", (c) => { lastTurn.delete(c.id); onDeleteCombat(c); });
  Hooks.on("canvasTearDown", () => { dropBanner(0); curLane = null; });
  Hooks.on(HOOK, (kind, data) => {
    if ( kind === "shot" && data?.form === "take" ) curLane = data.shot?.lane ?? null;
    else if ( kind === "end" && data?.form === "take" ) curLane = null;
  });
});
extendSection("director", { panels: [{ id: "dirMove", title: "MOINENMAPS.DirMove.title", icon: "fa-solid fa-person-running", open: false, mount: (h) => renderPanel(h) }] });

export const moveSource = { settings: moveSettings, showBanner, _debug: () => ({ curLane, banner: !!banner, root: !!root }) };
moduleApi.directorMove = moveSource;
