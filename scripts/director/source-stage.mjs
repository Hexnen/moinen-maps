import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as SC from "./stage-core.mjs";
import { killed, isOn, myMode, R, HOOK, registerStager, cameraHeld, busy } from "./director.mjs";
import { Screen } from "./stage.mjs";
import { freeRect } from "./overlay.mjs";
import { restyle } from "./screen.mjs";
import { extendSection } from "../workspace/registry.mjs";
import { esc, optRange, optSelect, optCheck, optHint, isEcho, writeControl } from "../workspace/ui.mjs";

/**
 * COMBAT STAGE (every client; the leader's events and shots are the director's as before: turn, the active combatant's move, its attack,
 * all on the combat's lane `cbt-<id>`).
 *
 * Without it every beat of a turn was a take-over that went home: turn -> home -> move -> home -> attack -> home, a ping-pong of the
 * camera (13 moves in 35 s for one player in a 5-combatant fight). With it, on this client:
 *  - a beat of the combat lane takes the camera and LEAVES it there (no return): the turn glides calmly to the active combatant (no
 *    letterbox, no zoom pumping; nothing at all when it is already comfortably on screen), its move is followed, its attack framed (in
 *    place when attacker and target are on screen already); the next combatant's turn carries straight on from there;
 *  - the letterbox + vignette only for the big beats: an attack that HITS (setting: hits / every attack / never), with the flash and the
 *    shake as before;
 *  - the camera goes HOME (the player's own view from before the first beat) on the player's own turn (with their token on screen), when
 *    the combat ends, when the director is switched off, or when the player asks: Esc or the "My view" chip while it is parked;
 *  - the player keeps control: Esc during a beat = home, and the rest of that turn comes as markers; moving the camera themselves (wheel,
 *    drag, keys, at any moment) = the camera is theirs, where they put it is their view; the stage leaves them alone for the rest of that
 *    turn and at least `back` seconds; on their own turn their own beats never move the camera (in place when on screen, else a marker);
 *  - what a player may see is decided as before (the director's decide(): hidden, GM-only, vision, strict tokens; the move source's check
 *    for moves); a turn of a combatant this player cannot see does nothing here (the camera stays where it is).
 * Idle: hooks only; no ticker, no timer. While the camera is parked away: a keydown listener and the chip.
 */

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const KEY = "dirStage";
let setCache = null;
export const stageSettings = () => (setCache ??= SC.sanitizeStage((() => { try { return game.settings.get(MODULE_ID, KEY); } catch { return null; } })()));
const grid = () => canvas?.dimensions?.size ?? canvas?.grid?.size ?? 100;
/** Where the stage frames: the map less Foundry's interface AND the open windows (a sheet, a roll dialog): never a combatant under a window. */
const stageRect = () => { const r = freeRect(); return { x: r.x, y: r.y, w: r.w, h: r.h }; };

const st = SC.newStage();
let beat = null;                         // the stage beat on screen here: { id, own }
let homing = false;                      // the stage's own camera move home is under way
let pendingHome = null;                  // go home when the beat on screen ends (own turn / the end of the combat came during it)
const trace = [];                        // the last stage decisions here (checks): [ms, kind, form, why]
const outWhy = () => (st.out && st.out === st.turn ? "out this turn" : "player moved the camera");
const claimed = new Map();               // shot id -> { own } (the takes this client played as stage beats)

/** The started combat whose tokens are on the viewed scene (or an unlinked one), or null. */
function combatHere() {
  const c = game.combats?.viewed ?? game.combat;
  if ( !c?.started ) return null;
  return !c.scene || c.scene.id === canvas.scene?.id ? c : null;
}
const turnKey = (c) => `${c?.round}:${c?.current?.combatantId ?? c?.combatant?.id ?? ""}`;
const ownTurn = (c) => !game.user.isGM && !!c?.combatant?.isOwner;
const on = () => !killed() && isOn() && stageSettings().on && myMode() === "full" && !!canvas?.ready;
const viewNow = () => ({ x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, scale: canvas.stage.scale.x, vw: canvas.app.screen.width, vh: canvas.app.screen.height });
/** The token as this client may see it (visible, not hidden from it), or null. */
function seenTok(id) {
  const d = id ? canvas.scene?.tokens?.get(id) : null, t = d?.object;
  if ( !t || t.destroyed ) return null;
  if ( game.user.isGM ) return t;
  return !d.hidden && t.visible ? t : null;
}
function tokenBox(t, pad = 0) { const d = t.document, g = grid(); return { x0: d.x - pad, y0: d.y - pad, x1: d.x + (d.width || 1) * g + pad, y1: d.y + (d.height || 1) * g + pad }; }
const tell = () => { try { Hooks.callAll(HOOK, "stage", status()); } catch { /* listeners */ } };

/* ---------------------------------------------------------------- the style of a stage beat (director.mjs registerStager) */

function styleOf(shot) {
  if ( !on() || !shot?.lane ) return null;
  const c = combatHere();
  if ( !c || shot.lane !== `cbt-${c.id}` ) return null;
  if ( st.combat !== c.id ) { st.combat = c.id; st.turn = turnKey(c); }
  const own = ownTurn(c), S = stageSettings(), kind = shot.kind;
  let cam = null;                        // a turn's calm camera (null: it stays)
  let away = false;                      // the player's own attack off screen: the camera goes to the hit and RETURNS
  const take = () => { SC.beatStart(st, viewNow(), !!beat); claimed.set(shot.id, { own: false }); return "take"; };
  function check0(form, ph) {
    if ( own ) {
      // the player's own turn: the camera is theirs. Their own turn shot does nothing (the stage went home on the turn change), their
      // own beats play in place when on screen; their own ATTACK on a target off screen cuts to the hit and comes back (they see their
      // blow land: the camera returns to their view after the result); any other own beat off screen is a marker
      if ( kind === "turn" ) return ["none", "own turn"];
      if ( ph?.check ) { const f = ph.check(shot, form); if ( f === "none" ) { if ( kind === "move" ) keepOwnInFrame(shot); return ["none", "own: play check"]; } }
      // (in place when the tokens' middles are on screen: the box shrunk by a third of a square, no margin)
      const rect = stageRect(), v = viewNow(), q = grid() * 0.35, b = shot.box, inner = { x0: b.x0 + q, y0: b.y0 + q, x1: Math.max(b.x0 + q, b.x1 - q), y1: Math.max(b.y0 + q, b.y1 - q) };
      if ( !SC.comfortable(inner, v, rect, 0) ) {
        if ( kind !== "attack" ) return ["soft", "own, off screen"];
        away = true;
        claimed.set(shot.id, { own: true });
        return ["take", "own attack, there and back"];
      }
      claimed.set(shot.id, { own: true });
      return ["take", "own, in place"];
    }
    if ( kind === "turn" ) {
      const t = seenTok(shot.play?.turn);
      if ( !t ) return ["none", "not in sight"];                                // (the camera stays where it is)
      if ( SC.beatForm(st, performance.now(), S.back * 1000) === "soft" ) return ["soft", outWhy()];
      // (the stage zoom: the zoom now while it is near the player's own - no re-zoom after an attack - else theirs)
      const v = viewNow(), scale = st.parked && st.home ? SC.stageZoom(v.scale, st.home.scale) : v.scale;
      cam = SC.turnCamera(tokenBox(t, grid() * 0.5), v, stageRect(), scale, R().lead);
      return cam ? [take(), "glide"] : ["none", "on screen"];                  // (comfortably on screen: nothing moves)
    }
    if ( ph?.check ) { const f = ph.check(shot, form); if ( f === "none" ) return ["none", "play check"]; if ( f === "soft" ) return ["soft", "play check"]; }
    if ( SC.beatForm(st, performance.now(), S.back * 1000) === "soft" ) return ["soft", outWhy()];
    return [take(), "beat"];
  }
  const res = (f, why) => { trace.push([Math.round(performance.now()), shot.kind, f, why]); if ( trace.length > 30 ) trace.shift(); return f; };
  return {
    check(form0, ph) { const [f, why] = check0(form0, ph); return res(f, why); },
    get home() { return own ? null : st.home; },
    barsLater: true,
    get stay() { return !own && !away; },
    drive(sh, api) {
      if ( kind === "turn" ) {
        if ( cam ) Screen.panTo({ x: cam.x, y: cam.y, scale: cam.scale, duration: Math.min(cam.ms, sh.lead + sh.hold - 250) });
        return { stop() {} };
      }
      if ( kind === "attack" ) {
        // in place when attacker and target are on screen already; else framed at the STAGE ZOOM (within a narrow band of the player's
        // own: the zoom does not pump out and back in with every attack of a fight), the target whole and the attacker in when it fits.
        // The bars: at the hit (onHit) or on arrival.
        if ( !own || away ) {
          const base = own ? api.from.scale : (st.home?.scale ?? api.from.scale), v = viewNow();
          const tb = Array.isArray(sh.tokens) && sh.tokens.length ? seenTok(sh.tokens[0]) : null;     // (the focus: the target, first token)
          const focus = tb ? tokenBox(tb, grid() * 0.3) : { x0: sh.x - grid() / 2, y0: sh.y - grid() / 2, x1: sh.x + grid() / 2, y1: sh.y + grid() / 2 };
          const c = SC.attackCamera(sh.box, focus, v, stageRect(), api.reduced ? v.scale : base, api.reduced ? [1, 1] : SC.ZOOM_BAND);
          if ( c ) Screen.panTo({ x: c.x, y: c.y, scale: api.reduced ? v.scale : c.scale, duration: api.reduced ? api.lead * 1.25 : api.lead });
        }
        if ( S.bars === "attacks" ) api.at(Math.round(sh.lead * 0.7), () => Screen.revealBars?.());
        return { stop() {} };
      }
      return null;                                                                // (a move: the move source's follow)
    },
    onHit() { if ( kind === "attack" && S.bars === "hits" ) Screen.revealBars?.(); }
  };
}

/* ---------------------------------------------------------------- beats on screen, the player, the camera home */

function onDirector(kind, d) {
  if ( kind === "shot" && d?.form === "take" ) {
    const cl = claimed.get(d.shot?.id);
    if ( cl ) beat = { id: d.shot.id, own: cl.own };
    else if ( beat ) { beat = null; st.parked = null; }       // another take-over replaced our beat: it returns to that beat's home (the player's view)
    sync();
  } else if ( kind === "end" && d?.form === "take" ) {
    if ( beat && d.shot?.id === beat.id ) {
      const b = beat; beat = null; claimed.delete(b.id);
      if ( !b.own ) SC.beatEnd(st, d.why, !!d.taken, viewNow(), performance.now());
      if ( pendingHome ) { const to = pendingHome; pendingHome = null; if ( st.parked || to.force ) afterScreen(() => goHome(to.to ?? st.home)); }
    }
    sync();
  } else if ( kind === "state" && d && !d.on && (st.parked || st.combat) ) endStage();
  else if ( kind === "skip" ) {
    // the GM's skip: a beat on screen ended "skip" and went home already; one that ended a moment ago left the camera parked - the GM
    // skipping now means the same (the players get their own view back), not "nothing to skip"
    if ( !beat && !homing && st.parked && st.home && on() ) { trace.push([Math.round(performance.now()), "skip", "home", "GM skip while parked"]); if ( trace.length > 30 ) trace.shift(); afterScreen(() => goHome(st.home)); }
  }
}

/**
 * The player moved the camera (Foundry's canvasPan, not a shot / the stage's own move): it is theirs now. Pans that do not change the view
 * are not moves (something on this world calls canvas.pan() with the current view now and then).
 */
let lastPan = null;
function onPan(c, p) {
  const v = { x: Number(p?.x), y: Number(p?.y), scale: Number(p?.scale) };
  if ( ![v.x, v.y, v.scale].every(Number.isFinite) ) return;
  const moved = !lastPan || Math.hypot(v.x - lastPan.x, v.y - lastPan.y) * v.scale > 1.5 || Math.abs(v.scale / lastPan.scale - 1) > 0.004;
  lastPan = v;
  // (a pan of a shot or of the stage's own move is not the player's. But once a beat has ended and left the camera parked - the
  // director's screen only fades its bars out, its camera is stopped - a wheel / drag / pan IS the player's, at once: before, the
  // ~0.6 s fade swallowed it and the next turn took the camera anyway)
  if ( !moved || !st.combat || homing || beat ) return;
  if ( Screen.owner && Screen.debug?.()?.cameraOn ) return;
  if ( st.parked || st.home ) { SC.ownMove(st, performance.now()); sync(); } else st.ownAt = performance.now();
}

/** Runs `fn` once the director's ending take-over has left the screen (its bars slide out first), unless a new beat began meanwhile. */
function afterScreen(fn, t0 = performance.now()) {
  if ( beat ) return;
  if ( Screen.owner === "director" && performance.now() - t0 < 1500 ) { setTimeout(() => afterScreen(fn, t0), 80); return; }
  fn();
}
/** The camera to `to` (a view) in a calm move; the player's wheel / click / key stops it (Screen's abort guard). */
function goHome(to, ms = null) {
  if ( !to || !canvas?.ready ) return;
  if ( cameraHeld() ) { st.parked = null; sync(); return; }       // (Hot Pan / LockView hold the camera: never pull it off their view)
  const v = viewNow();
  st.parked = null;
  if ( SC.sameView(v, to) ) { sync(); return; }
  const screens = Math.hypot(to.x - v.x, to.y - v.y) * v.scale / Math.max(1, Math.hypot(v.vw, v.vh)), back = R().back;
  const dur = ms ?? Math.round(SC.clamp(back * (0.85 + 0.6 * screens), back * 0.8, back * 1.6));
  const look = { fx: true, camOn: true, camMode: "frame", lbOn: false, vgOn: false, shOn: false, flOn: false, smOn: false, camEase: 0.85 };
  if ( !Screen.begin({ r: look }, { owner: "stage", guard: true, frame: false, home: { x: to.x, y: to.y, scale: to.scale }, opts: { noCamera: false, allow: ["camera"] } }) ) return;
  homing = true; sync();
  Screen.end({ backMs: dur, hold: 0 }).finally(() => {
    homing = false;
    if ( st.combat && !SC.sameView(viewNow(), to, 12) ) SC.ownMove(st, performance.now());   // (the player stopped it: the camera is theirs)
    sync();
  });
}

/**
 * The player's OWN token moved on their own turn (they moved it: the move source shows them nothing): when it ends near the edge of
 * the free screen - under the hotbar's edge, behind the sidebar - the camera reframes it calmly, the smallest shift that brings it
 * well inside (as a camera operator keeps the acting character in frame). Not while the player is at work on the board (dragging,
 * the wheel, the ruler), nor when the camera is held, a beat plays, or the turn has moved on.
 */
function keepOwnInFrame(shot) {
  const id = shot.tokens?.[0], turn = st.turn, t = seenTok(id);
  if ( !t ) return;
  const done = Promise.race([Promise.resolve(t.movementAnimationPromise ?? null).catch(() => null), new Promise((res) => setTimeout(res, 4000))]);
  done.then(() => setTimeout(() => {
    if ( !on() || st.turn !== turn || beat || homing || cameraHeld() || busy() ) return;
    const tk = seenTok(id); if ( !tk ) return;
    const v = viewNow(), rect = stageRect(), b = tokenBox(tk, grid() * 0.5);
    if ( SC.comfortable(b, v, rect, 0.08) ) return;
    trace.push([Math.round(performance.now()), "move", "reframe", "own token near the edge"]); if ( trace.length > 30 ) trace.shift();
    goHome(SC.ownHome(v, b, rect, v, 0.2));
  }, 250));
}

/** The stage is over here (the combat ended, the director or the stage was switched off): home if the camera is parked away. */
function endStage() {
  if ( beat ) { pendingHome = { to: st.home ? { ...st.home } : null, force: true }; }
  const go = SC.stageEnd(st);
  claimed.clear();
  if ( go && !beat ) afterScreen(() => goHome(go.to));
  sync();
}

function onUpdateCombat(combat, changed) {
  if ( !changed || !("turn" in changed || "round" in changed || "started" in changed) ) return;
  if ( st.combat === combat.id && !combat.started ) { endStage(); return; }
  if ( !on() || combat !== combatHere() ) return;
  if ( st.combat !== combat.id ) { if ( st.combat ) endStage(); st.combat = combat.id; }
  const key = turnKey(combat);
  if ( key === st.turn ) return;
  const own = ownTurn(combat), act = SC.turnChange(st, key, own, !!beat && !beat.own);
  if ( act?.home ) {
    // own turn: home, with the player's own token comfortably on screen; after the beat on screen (an attack's result) when one plays
    const t = seenTok(combat.combatant?.tokenId), to = SC.ownHome(st.home, t ? tokenBox(t, grid() * 0.5) : null, stageRect(), viewNow());
    if ( beat ) pendingHome = { to, force: true }; else afterScreen(() => goHome(to));
    st.home = { ...to };
  }
  sync();
}
function onDeleteCombat(combat) { if ( st.combat === combat?.id ) endStage(); }
function onTearDown() {
  clearTimeout(resync); resync = 0;
  Object.assign(st, SC.newStage()); beat = null; pendingHome = null; homing = false; claimed.clear(); sync();
}

/* ---- parked: Esc and the "My view" chip */

const CSS = `
.mm-dst-chip { position: fixed; z-index: 60; transform: translate(-50%, 0); display: flex; align-items: center; gap: 0.5em; padding: 0.28rem 0.75rem 0.3rem;
  font: 0.72rem/1.2 var(--font-primary, sans-serif); letter-spacing: 0.12em; text-transform: uppercase; color: #f4efe6; background: rgba(12, 10, 8, 0.72);
  border: 1px solid rgba(233, 196, 106, 0.45); border-radius: 999px; box-shadow: 0 2px 10px rgba(0,0,0,0.45); cursor: pointer; pointer-events: auto;
  opacity: 0; transition: opacity 320ms ease-out 450ms; }
.mm-dst-chip.is-in { opacity: 0.92; }
.mm-dst-chip:hover { opacity: 1; border-color: #e9c46a; }
.mm-dst-chip i { color: #e9c46a; }
.mm-dst-chip kbd { font: inherit; font-size: 0.62rem; letter-spacing: 0.08em; padding: 0 0.35em; border: 1px solid rgba(244, 239, 230, 0.4); border-radius: 3px; }
`;
let chip = null, keyOn = false;
function showChip() {
  if ( chip?.isConnected ) return;
  if ( !document.querySelector("style[data-mm-dst]") ) { const s = document.createElement("style"); s.textContent = CSS; s.dataset.mmDst = ""; document.head.appendChild(s); }
  const r = stageRect();
  chip = document.createElement("div");
  chip.className = "mm-dst-chip"; chip.dataset.mmDst = ""; chip.setAttribute("role", "button");
  chip.innerHTML = `<i class="fa-solid fa-house" inert></i><span>${esc(T("DirStage.chip"))}</span><kbd>Esc</kbd>`;
  chip.style.left = `${Math.round(r.x + r.w / 2)}px`; chip.style.top = `${Math.round(r.y + r.h - 40)}px`;
  chip.addEventListener("pointerdown", (ev) => { ev.preventDefault(); ev.stopPropagation(); backHome(); });
  document.body.appendChild(chip);
  restyle(chip); chip.classList.add("is-in");
}
function hideChip() { const c = chip; chip = null; c?.remove(); }
/** Esc while parked: only when nothing else wants it (a focused text field, an open window). */
function onKey(ev) {
  if ( ev.key !== "Escape" || !st.parked || beat || homing || cameraHeld() ) return;
  const a = document.activeElement;
  if ( a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) ) return;
  if ( [...(foundry.applications.instances?.values?.() ?? [])].some((w) => w.hasFrame && w.rendered && !w.minimized) ) return;
  ev.preventDefault(); ev.stopImmediatePropagation();
  backHome();
}
/** The player asked for their view back: home now, the rest of this turn as markers. */
function backHome() { if ( cameraHeld() ) { sync(); return; } st.out = st.turn; goHome(st.home); }
/** The parked-state UI follows the state: the chip and the Esc listener only while the camera is parked away and nothing plays. */
let resync = 0;
function sync() {
  const want = !!st.parked && !!st.home && !beat && !homing && on() && !cameraHeld(), parked = want && !Screen.owner;
  clearTimeout(resync); resync = 0;
  if ( want && !parked ) resync = setTimeout(sync, 150);        // (the beat's bars are still sliding out: once the screen is free)
  if ( parked ) { showChip(); if ( !keyOn ) { window.addEventListener("keydown", onKey, true); keyOn = true; } }
  else { hideChip(); if ( keyOn ) { window.removeEventListener("keydown", onKey, true); keyOn = false; } }
  tell();
}

/* ---------------------------------------------------------------- settings + the panel */

function registerSettings() {
  game.settings.register(MODULE_ID, KEY, { scope: "world", config: false, type: Object, default: { ...SC.STAGE_DEFAULTS }, onChange: () => { setCache = null; if ( !stageSettings().on ) endStage(); } });
}
function renderPanel(hostEl) {
  const s0 = stageSettings();
  hostEl.innerHTML = `<div class="mm-ws-form mm-dst-panel">
    ${optCheck({ name: "on", label: T("DirStage.on"), checked: s0.on, hint: T("DirStage.onHint") })}
    ${optSelect({ name: "bars", label: T("DirStage.bars"), value: s0.bars, options: SC.BARS.map((v) => [v, T(`DirStage.bars_${v}`)]), hint: T("DirStage.barsHint") })}
    ${optRange({ name: "back", label: T("DirStage.back"), value: s0.back, min: SC.BACK[1], max: SC.BACK[2], step: 1, hint: T("DirStage.backHint") })}
    ${optHint(T("DirStage.panelHint"))}</div>`;
  const ctl = (n) => hostEl.querySelector(`[name="${n}"]`);
  const refresh = () => { const s = stageSettings(); for ( const k of Object.keys(SC.STAGE_DEFAULTS) ) { const c = ctl(k); if ( c && !c.contains(document.activeElement) ) writeControl(c, s[k]); } };
  const onChange = (ev) => {
    if ( isEcho() || !game.user.isGM ) return;
    const c = ev.target.closest?.("[name]"); if ( !c || !(c.name in SC.STAGE_DEFAULTS) ) return;
    const v = c.matches("input[type=checkbox]") ? c.checked : c.name === "back" ? Number(c.value) : c.value;
    const next = SC.sanitizeStage({ ...stageSettings(), [c.name]: v });
    if ( JSON.stringify(next) === JSON.stringify(stageSettings()) ) { refresh(); return; }
    game.settings.set(MODULE_ID, KEY, next);
  };
  hostEl.addEventListener("change", onChange);
  const hook = Hooks.on("updateSetting", (s) => { if ( s.key === `${MODULE_ID}.${KEY}` ) { setCache = null; refresh(); } });
  return () => { hostEl.removeEventListener("change", onChange); Hooks.off("updateSetting", hook); hostEl.innerHTML = ""; };
}

/* ---------------------------------------------------------------- wiring */

export function status() {
  return { on: on(), combat: st.combat, turn: st.turn, home: st.home, parked: st.parked, out: st.out, beat: beat?.id ?? null, homing, chip: !!chip };
}
Hooks.once("init", registerSettings);
Hooks.once("ready", () => {
  registerStager(styleOf);
  Hooks.on(HOOK, onDirector);
  Hooks.on("updateCombat", onUpdateCombat);
  Hooks.on("deleteCombat", onDeleteCombat);
  Hooks.on("canvasPan", onPan);
  Hooks.on("canvasTearDown", onTearDown);
  // (Hot Pan / LockView switched on while parked: the chip and the parked Esc go)
  const held = () => { if ( st.parked || chip ) sync(); };
  Hooks.on("updateSetting", held); Hooks.on("clientSettingChanged", held); Hooks.on("updateScene", held);
});
extendSection("director", { panels: [{ id: "dirStage", title: "MOINENMAPS.DirStage.title", icon: "fa-solid fa-clapperboard", open: false, mount: (h) => renderPanel(h) }] });

export const stageSource = { settings: stageSettings, status, home: () => backHome(), _debug: () => ({ st: { ...st }, trace: trace.slice(), beat, pendingHome, homing, claimed: [...claimed.keys()] }) };
moduleApi.directorStage = stageSource;
