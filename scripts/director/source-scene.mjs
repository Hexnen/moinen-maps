import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as Cin from "../destruction/cinematic-core.mjs";
import * as Dir from "./core.mjs";
import * as SC from "./scene-core.mjs";
import { Screen, clientOpts } from "./stage.mjs";
import { HOOK, R, gmState, myMode, killed, isOn, busy, holds, cameraHeld, typing, escTaken } from "./director.mjs";
import { isOrbit } from "../zones/orbit.mjs";
import * as Reveal from "../net/reveal.mjs";

/**
 * DIRECTOR SOURCE: SCENE TRANSITIONS (each client on its own; no socket, no leader). See scene-core.mjs for the idea.
 *
 *  - canvasTearDown (a change to ANOTHER scene, not a redraw of this one): the DIP veil fades in over the frozen picture Foundry keeps
 *    of the old scene while the new one loads. Nothing waits on it: it is one DOM element with a CSS fade, the load runs as before.
 *    A scene with Foundry's own transition (fade, swirl, ...) keeps it: no dip then.
 *  - canvasReady: the ARRIVAL. The camera is put on the establishing shot's start (behind the veil / before Foundry's transition takes
 *    its picture), the title card comes up over the dark, the veil lifts once the module's own reveal of the baked layers is done (at
 *    most holdMs after ready: the canvas is live and takes input all along), the camera glides into the player's own view, the bars go.
 *  - The player keeps control: Esc or a click cuts the arrival (the camera is back in the player's view at once), the wheel, the right
 *    button or the pan keys take the camera where it is. A player who is busy, chose the soft form, or has the intensity near zero gets
 *    the soft form: a short dip and a small title, no camera move. Reduced motion: no camera move.
 *  - Nothing to leak: the title is what the navigation bar already shows the player for the scene it is viewing (or the GM's own card
 *    title); the wide start frames only what this player may see (the whole map without token vision, the reach of their own vision
 *    with it - fog and vision are drawn by Foundry over every frame of it, and the veil only lifts after vision has been worked out).
 *  - Orbit: a player who follows their character up starts close on it and the camera pulls back into space; a landing starts high
 *    and comes down onto it; the Orbit scene opened by hand pulls back too.
 *  - While an arrival plays the director's take-overs come as soft shots (director.mjs `holds`), so two takes never fight.
 * Hook "moinenMapsDirector": "arrival" ({ scene, form, title, move }) and "arrivalEnd" ({ scene, why }).
 */

const SKEY = "dirArrival", FLAG = "dirScene", LAST = "mm-dir-last-scene";
const setting = (k) => { try { return game.settings.get(MODULE_ID, k); } catch { return undefined; } };
const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
export const settings = () => SC.cleanSettings(setting(SKEY));
const grid = () => canvas?.dimensions?.size ?? 100;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const PAN_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Numpad8", "Numpad2", "Numpad4", "Numpad6"]);

function registerSettings() {
  game.settings.register(MODULE_ID, SKEY, { scope: "world", config: false, type: Object, default: { ...SC.DEFAULTS } });
}

/* ---------------------------------------------------------------- the tab's last scene (a reload of the same scene is no arrival) */

const lastSeen = () => { try { return sessionStorage.getItem(LAST); } catch { return null; } };
const setLastSeen = (id) => { try { sessionStorage.setItem(LAST, id); } catch { /* blocked */ } };
let pageFirst = true;                    // no scene drawn yet in this page (a login, a new tab or a reload)

/* ---------------------------------------------------------------- the DOM: the veil and the title card */

const CSS = `
.mm-dir-veil { position: fixed; inset: 0; z-index: 1; pointer-events: none; background: radial-gradient(ellipse at 50% 45%, #0b0a09 0%, #030303 75%); opacity: 0; transition: opacity 280ms ease-out; }
.mm-dir-arr { position: fixed; inset: 0; z-index: 2; pointer-events: none; display: flex; align-items: center; justify-content: center; font-family: var(--font-primary, sans-serif); }
.mm-dir-arr-card { display: flex; flex-direction: column; align-items: center; gap: 0.55rem; transform: translateY(-5vh); color: #f4efe6; text-align: center; max-width: min(86vw, 72rem);
  text-shadow: 0 2px 3px rgba(0,0,0,0.85), 0 0 28px rgba(0,0,0,0.65); }
.mm-dir-arr-kick { font-size: 0.8rem; letter-spacing: 0.46em; text-transform: uppercase; color: #e9c46a; opacity: 0; transform: translateY(8px);
  transition: opacity 700ms ease-out 350ms, transform 1100ms cubic-bezier(0.16, 0.8, 0.3, 1) 350ms; }
.mm-dir-arr-title { font-family: "Modesto Condensed", var(--font-primary, serif); font-size: clamp(2.6rem, 6.4vw, 5.6rem); line-height: 1; letter-spacing: 0.5em; margin-right: -0.5em;
  opacity: 0; filter: blur(10px); transform: scale(1.06);
  transition: opacity 1100ms ease-out, filter 1300ms cubic-bezier(0.16, 0.8, 0.3, 1), letter-spacing 2600ms cubic-bezier(0.16, 0.8, 0.3, 1), margin-right 2600ms cubic-bezier(0.16, 0.8, 0.3, 1), transform 2600ms cubic-bezier(0.16, 0.8, 0.3, 1); }
.mm-dir-arr-rule { height: 1px; width: 0; opacity: 0.9; background: linear-gradient(90deg, rgba(233,196,106,0), #e9c46a 30%, #e9c46a 70%, rgba(233,196,106,0));
  box-shadow: 0 0 10px rgba(233,196,106,0.45); transition: width 1700ms cubic-bezier(0.16, 0.8, 0.3, 1) 200ms; }
.mm-dir-arr-sub { font-size: clamp(0.9rem, 1.4vw, 1.2rem); letter-spacing: 0.18em; color: #ddd5c6; opacity: 0; transition: opacity 900ms ease-out 700ms; }
.mm-dir-arr.is-in .mm-dir-arr-kick { opacity: 0.95; transform: none; }
.mm-dir-arr.is-in .mm-dir-arr-title { opacity: 1; filter: none; letter-spacing: 0.14em; margin-right: -0.14em; transform: none; }
.mm-dir-arr.is-in .mm-dir-arr-rule { width: min(44vw, 32rem); }
.mm-dir-arr.is-in .mm-dir-arr-sub { opacity: 0.9; }
.mm-dir-arr.is-out .mm-dir-arr-card { opacity: 0; transform: translateY(calc(-5vh - 10px)); transition: opacity 650ms ease-in, transform 800ms ease-in; }
.mm-dir-arr.is-out .mm-dir-arr-title { letter-spacing: 0.2em; filter: blur(4px); transition: letter-spacing 800ms ease-in, filter 700ms ease-in; }
.mm-dir-arr.is-cut .mm-dir-arr-card { transition-duration: 260ms; }
.mm-dir-arr.is-paused:not(.is-soft) .mm-dir-arr-card { transform: translateY(-22vh); }
.mm-dir-arr.is-paused.is-out:not(.is-soft) .mm-dir-arr-card { transform: translateY(calc(-22vh - 10px)); }
.mm-dir-arr.is-soft { align-items: flex-start; padding-top: 11vh; }
.mm-dir-arr.is-soft .mm-dir-arr-card { transform: none; gap: 0.3rem; }
.mm-dir-arr.is-soft .mm-dir-arr-title { font-size: clamp(1.4rem, 2.6vw, 2.2rem); }
.mm-dir-arr.is-soft .mm-dir-arr-kick { font-size: 0.66rem; }
.mm-dir-arr.is-soft.is-in .mm-dir-arr-rule { width: min(24vw, 16rem); }
.mm-dir-arr.is-soft.is-out .mm-dir-arr-card { transform: translateY(-8px); }
@media (prefers-reduced-motion: reduce) { .mm-dir-arr-title { filter: none; transform: none; letter-spacing: 0.14em; margin-right: -0.14em; } }
.mm-dir-arr.is-reduced .mm-dir-arr-title { filter: none; transform: none; letter-spacing: 0.14em; margin-right: -0.14em; }
`;
let styled = false;
function ensureStyle() { if ( styled ) return; styled = true; const s = document.createElement("style"); s.textContent = CSS; s.dataset.mmDirArr = ""; document.head.appendChild(s); }
function insert(el) { const ui = document.getElementById("interface"); (ui?.parentNode ?? document.body).insertBefore(el, ui ?? null); }

/** The dip: { el, timer }. One at a time; a safety timer never leaves it up (a load that failed never calls canvasReady). */
let veil = null;
function veilIn({ ms = 280, opaque = false } = {}) {
  ensureStyle();
  if ( !veil ) {
    const el = document.createElement("div"); el.className = "mm-dir-veil"; el.dataset.mmDir = "";
    insert(el); veil = { el, timer: 0, gone: 0 };
    if ( !opaque ) void el.offsetWidth;
  }
  clearTimeout(veil.gone); veil.gone = 0;
  veil.el.style.transition = opaque ? "none" : `opacity ${ms}ms ease-out`;
  veil.el.style.opacity = "1";
  clearTimeout(veil.timer);
  veil.timer = setTimeout(() => veilOut(400), 20000);
}
function veilOut(ms = 1000) {
  const v = veil; if ( !v ) return;
  clearTimeout(v.timer);
  if ( ms <= 0 ) { v.el.remove(); veil = null; return; }
  v.el.style.transition = `opacity ${ms}ms cubic-bezier(0.4, 0, 0.2, 1)`;
  v.el.style.opacity = "0";
  clearTimeout(v.gone);
  v.gone = setTimeout(() => { v.el.remove(); if ( veil === v ) veil = null; }, ms + 60);
}

function makeCard({ title, sub, kick, soft, reduced }) {
  ensureStyle();
  const el = document.createElement("div");
  el.className = `mm-dir-arr${soft ? " is-soft" : ""}${reduced ? " is-reduced" : ""}${game.paused ? " is-paused" : ""}`;   // (paused: above Foundry's pause badge) el.dataset.mmDir = "";
  el.innerHTML = `<div class="mm-dir-arr-card">${kick ? `<div class="mm-dir-arr-kick">${esc(kick)}</div>` : ""}<div class="mm-dir-arr-title">${esc(title)}</div>`
    + `<div class="mm-dir-arr-rule"></div>${sub ? `<div class="mm-dir-arr-sub">${esc(sub)}</div>` : ""}</div>`;
  insert(el);
  void el.offsetWidth;
  el.classList.add("is-in");
  let gone = false;
  const remove = () => { if ( gone ) return; gone = true; el.remove(); };
  return { el, remove, out: (ms = 800, cut = false) => { if ( gone ) return; if ( cut ) el.classList.add("is-cut"); el.classList.add("is-out"); setTimeout(remove, ms); } };
}

/* ---------------------------------------------------------------- what this player may see wide */

const sceneBox = () => { const r = canvas.dimensions.sceneRect; return { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height }; };
/** The scene without token vision (everyone sees all of it), else the union of this player's vision shapes; null = nothing seen. */
function seenBox() {
  const sr = sceneBox();
  const tv = canvas.visibility?.tokenVision ?? canvas.scene?.tokenVision;
  if ( game.user.isGM || !tv ) return sr;
  try { canvas.perception.applyRenderFlags(); } catch { /* the next frame does it */ }       // (Foundry does the same before its transitions)
  let b = null;
  for ( const src of canvas.effects?.visionSources ?? [] ) {
    if ( !src?.active ) continue;
    const shape = src.shape ?? src.los;
    const r = shape?.bounds ?? shape?.getBounds?.();
    if ( r && Number.isFinite(r.x) && r.width > 0 && r.height > 0 ) b = Dir.unionBox(b, { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height });
  }
  return SC.clipBox(b, sr, grid());
}

/* ---------------------------------------------------------------- the orbit follow */

let follow = null;                      // { scene, token, dir, at }: this player's character just moved scenes with orbit.mjs
function onCreateToken(doc, options) {
  const o = options?.mmOrbit;
  if ( !o || game.user.isGM || !doc.actor || game.user.character !== doc.actor ) return;
  if ( canvas.scene?.id !== o.from ) return;               // (orbit.mjs follows only from the scene the token left)
  follow = { scene: doc.parent.id, token: doc.id, dir: o.dir === "down" ? "down" : "up", at: performance.now() };
}

/* ---------------------------------------------------------------- the arrival */

let A = null;                           // the arrival on screen: { scene, form, timers, card, home, taken, done, ... }

function lookOf(k, reduced) {
  const users = Object.fromEntries(Object.entries(setting("cinUserPresets") ?? {}).map(([id, u]) => [id, u?.values ?? {}]));
  const look = Cin.resolve({ preset: R().look, over: {} }, users);
  return { ...Dir.lookFor(look, k, reduced), camMode: "frame", camHold: 0, camOn: true, fx: true, flOn: false, shOn: false, smOn: false, camEase: 1, lbIn: Math.max(look.lbIn, 700), lbOut: Math.max(look.lbOut, 900) };
}

/** The glide: our own CanvasAnimation under animatePan's name (Screen.stopCamera / the player's input stop it), the zoom on a log scale. */
function glide(from, to, ms) {
  const CA = foundry.canvas.animation.CanvasAnimation;
  const p = { t: 0 }, l0 = Math.log(from.scale), l1 = Math.log(to.scale);
  const ease = (t) => { const s = t * t * (3 - 2 * t), o = 1 - (1 - t) ** 3; return 0.45 * s + 0.55 * o; };
  return CA.animate([{ parent: p, attribute: "t", to: 1 }], {
    name: "canvas.animatePan", duration: ms,
    ontick: () => { const e = ease(p.t); canvas.pan({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, scale: Math.exp(l0 + (l1 - l0) * e) }); }
  });
}

function nativeTransition(scene) {
  const t = canvas._viewOptions?.transition ?? scene?.transition;
  if ( !t?.type || !(t.type in (CONFIG.Canvas?.sceneTransitions ?? {})) ) return false;
  return !(t.activeOnly && !scene.active);
}

/**
 * Play the arrival on the scene on screen: form "full" | "soft"; `forced` = the GM's test (plays whatever the settings and the mode).
 */
function play(form, { forced = false } = {}) {
  endArrival("replaced", { quiet: true });
  const scene = canvas.scene, s = settings(), opts = clientOpts(), reduced = !!opts.reduced;
  const k = Dir.intensity(Number(setting("dirIntensity")), Number(gmState().k));
  const flag = SC.cleanSceneFlag(scene.getFlag(MODULE_ID, FLAG));
  const orbit = isOrbit(scene);
  const { title, sub } = SC.titleOf({ name: scene.name, navName: scene.navName, orbit }, flag, s.names);
  const st = canvas.stage, app = canvas.app;
  const home = { x: st.pivot.x, y: st.pivot.y, scale: st.scale.x };
  const fl = follow && follow.scene === scene.id && performance.now() - follow.at < 20000 ? follow : null;
  follow = null;
  let move = !s.shot || form === "soft" ? "none" : fl ? (fl.dir === "up" ? "rise" : "descend") : orbit ? "rise" : "establish";
  const tk = fl ? canvas.tokens?.get(fl.token) : null;
  const centre = tk?.center ? { x: tk.center.x, y: tk.center.y } : { x: home.x, y: home.y };
  const lim = [CONFIG.Canvas?.minZoom ?? 0.1, CONFIG.Canvas?.maxZoom ?? 3];
  let start = SC.startView({ home: { ...home, ...centre }, vw: app.screen.width, vh: app.screen.height, box: move === "establish" ? seenBox() : null, clip: sceneBox(), move, k, reduced, limits: lim });
  if ( start.move !== "none" && typeof canvas._constrainView === "function" ) { const c = canvas._constrainView(start); start = { ...start, x: c.x, y: c.y, scale: c.scale }; }
  move = start.move;
  const gMs = SC.glideMs(start, home, s.glideMs, app.screen.width);
  const kick = !fl ? "" : fl.dir === "down" ? T("Dir.kind.orbitDown") : T("Dir.kind.orbitUp");
  const card = s.card && !!title;
  const native = !veil && nativeTransition(scene);
  const a = A = { scene: scene.id, form, timers: [], card: null, home, start, taken: false, done: false, screen: false, t0: performance.now(), move, title, forced };
  const at = (ms, fn) => a.timers.push(setTimeout(() => { if ( A === a && !a.done ) { try { fn(); } catch ( err ) { console.error(`${MODULE_ID} | director arrival`, err); endArrival("error"); } } }, Math.max(0, ms)));
  holds.add("arrival");

  // the screen: bars + vignette of the director's look, the camera on the start (the session's home = the player's own view)
  if ( form === "full" ) {
    a.screen = Screen.begin({ r: lookOf(k, reduced) }, { owner: "arrival", guard: false, frame: false, opts: { noCamera: false, allow: ["camera"] } });
    if ( a.screen && move !== "none" ) canvas.pan({ x: start.x, y: start.y, scale: start.scale });
  }

  // the veil lifts when the module's reveal is done (never later than holdMs) and, with Foundry's own transition, when that is over
  const hasVeil = !!veil;
  const tl = SC.timeline({ form, settings: s, glide: gMs, veil: hasVeil, card, reduced });
  Hooks.callAll(HOOK, "arrival", { scene: scene.id, form, title: card ? title : "", move, native });
  if ( card ) at(tl.cardAt, () => { a.card = makeCard({ title, sub, kick, soft: form === "soft", reduced }); });
  let lifted = false;
  const lift = () => {
    if ( lifted || A !== a || a.done ) return;
    lifted = true;
    if ( hasVeil ) veilOut(tl.veilMs);
    if ( a.screen && Screen.owner === "arrival" && move !== "none" && !a.taken ) glide(start, home, gMs);
    // (from now: the card stays its time from when it came up, but is read over the map at least 1.4 s once the dip lifted)
    const el = performance.now() - a.t0, cardOut = card ? Math.max(tl.cardOut - el, 1400) : 0;
    if ( card ) at(cardOut, () => a.card?.out(800));
    at(Math.max(gMs, cardOut - 300), () => { if ( a.screen && Screen.owner === "arrival" ) Screen.end({ hold: 0, backMs: a.taken ? null : 500 }); });
    at(Math.max(gMs + 900, card ? cardOut + 820 : 0, hasVeil ? tl.veilMs + 80 : 0) + 200, () => endArrival("done"));
  };
  const waitShown = (fn) => {
    // Foundry's own transition: the canvas root is shown when it is over; the module's reveal: whenRevealed
    let n = 0;
    const poll = () => { if ( A !== a || a.done ) return; if ( canvas.root?.visible || ++n > 240 ) fn(); else a.timers.push(setTimeout(poll, 50)); };
    poll();
  };
  waitShown(() => {
    const t = performance.now() - a.t0, minAt = Math.max(0, tl.veilAt - t), cap = Math.max(minAt, s.holdMs - t);
    let go = false;
    const fire = () => { if ( go ) return; go = true; lift(); };
    at(cap, fire);
    if ( Reveal.holding() ) Reveal.whenRevealed(() => { if ( A === a ) { const t2 = performance.now() - a.t0; at(Math.max(0, tl.veilAt - t2), fire); } });
    else at(minAt, fire);
  });

  // the player: Esc / a click cuts it (the camera is back at once); the wheel, another button or a pan key takes the camera
  a.onKey = (ev) => {
    if ( A !== a ) return;
    // (Esc as during a take-over: left to a text field; with a window / menu open it cuts AND goes on to Foundry, which closes them)
    if ( ev.key === "Escape" ) { if ( typing(ev) ) return; cut(); if ( !escTaken() ) { ev.preventDefault(); ev.stopImmediatePropagation(); } }
    else if ( PAN_KEYS.has(ev.code) && !ev.target?.closest?.("input, textarea, [contenteditable]") ) takeCamera();
  };
  a.onPtr = (ev) => {
    if ( A !== a || ev.target !== document.getElementById("board") ) return;
    if ( ev.type === "wheel" || ev.button !== 0 ) { takeCamera(); return; }
    ev.preventDefault(); ev.stopImmediatePropagation(); cut();
  };
  window.addEventListener("keydown", a.onKey, true);
  window.addEventListener("pointerdown", a.onPtr, true);
  window.addEventListener("wheel", a.onPtr, { capture: true, passive: true });
  return a;
}

function takeCamera() {
  const a = A; if ( !a || a.taken ) return;
  a.taken = true;
  if ( a.screen && Screen.owner === "arrival" ) Screen.stopCamera("player");
}

/** Esc / a click: everything goes quickly, the camera is in the player's own view at once (unless the player took it). */
function cut() {
  const a = A; if ( !a || a.done ) return;
  veilOut(220);
  a.card?.out(300, true);
  if ( a.screen && Screen.owner === "arrival" ) {
    if ( !a.taken ) { try { foundry.canvas.animation.CanvasAnimation.terminateAnimation("canvas.animatePan"); } catch { /* none */ } }
    Screen.end({ hold: 0, backMs: a.taken ? null : 380 });
  }
  endArrival("cut");
}

/** The arrival ends here: "done", "cut", "replaced", "scene" (torn down), "show" / "shot" (someone else took the screen), "error". */
function endArrival(why, { quiet = false } = {}) {
  const a = A; if ( !a || a.done ) return;
  a.done = true; A = null;
  for ( const t of a.timers ) clearTimeout(t);
  window.removeEventListener("keydown", a.onKey, true);
  window.removeEventListener("pointerdown", a.onPtr, true);
  window.removeEventListener("wheel", a.onPtr, true);
  holds.delete("arrival");
  const ours = a.screen && Screen.owner === "arrival";
  if ( why === "scene" || why === "error" ) { a.card?.remove(); if ( ours ) Screen.end({ immediate: true }); if ( why === "error" ) veilOut(300); }
  else if ( why === "replaced" ) a.card?.remove();                        // (the next play begins the screen anew)
  else if ( why === "show" || why === "shot" ) { a.card?.out(400, true); veilOut(300); }
  else if ( why === "done" ) { a.card?.remove(); if ( veil ) veilOut(300); if ( ours ) Screen.end({ hold: 0 }); }
  if ( !quiet ) Hooks.callAll(HOOK, "arrivalEnd", { scene: a.scene, why });
}

/* ---------------------------------------------------------------- the hooks */

function ctxFor(scene, { forced = false } = {}) {
  const prev = lastSeen(), mode = myMode();
  return {
    killed: killed() || (!forced && !isOn()), settings: settings(), sceneOff: SC.cleanSceneFlag(scene?.getFlag?.(MODULE_ID, FLAG)).off, mode,
    fresh: prev !== scene?.id, first: pageFirst && !prev, busy: busy({ ignoreHolds: true }) || cameraHeld(), screen: !!Screen.owner && Screen.owner !== "arrival",
    k: Dir.intensity(Number(setting("dirIntensity")), Number(gmState().k)), forced
  };
}

function onTearDown(_c, options = {}) {
  endArrival("scene");
  const next = options?.nextScene ?? null, mode = myMode();
  const nextOff = SC.cleanSceneFlag(next?.getFlag?.(MODULE_ID, FLAG)).off;
  if ( SC.dipOnTearDown({ killed: killed() || !isOn(), settings: settings(), mode, from: canvas.scene?.id, to: next?.id, nextOff, native: next ? nativeTransition(next) : false }) ) veilIn({ ms: 280 });
  else if ( veil ) veilOut(0);
}
/** The first draw of the page (a login, a reload, a new tab): the board is black anyway; the veil starts opaque so nothing flashes. */
function onInit() {
  if ( !pageFirst || veil ) return;
  const scene = canvas.scene; if ( !scene ) return;
  const c = ctxFor(scene), s = c.settings;
  if ( SC.decideArrival({ ...c, busy: false, screen: false }) !== "none" && s.dip ) veilIn({ opaque: true });
}
function onReady() {
  const scene = canvas.scene;
  if ( !scene ) { if ( veil ) veilOut(300); return; }
  const c = ctxFor(scene);
  pageFirst = false;
  setLastSeen(scene.id);
  // sketch-reveal plays its own scene transition on this client (its overlay is up from canvasInit): that is the opening, with its own
  // title; ours under it would never be seen (one owner of the arrival)
  const form = document.querySelector(".sketch-reveal-overlay.sr-transition") ? "none" : SC.decideArrival(c);
  if ( form === "none" ) { if ( veil ) veilOut(450); return; }
  try { play(form); } catch ( err ) { console.error(`${MODULE_ID} | director arrival`, err); endArrival("error"); if ( veil ) veilOut(300); }
}

/* ---------------------------------------------------------------- api, wiring */

/** The GM's test (the settings panel): the arrival of the scene on screen, here only, full form. */
export function testArrival() {
  if ( !canvas?.ready || killed() ) return false;
  const c = ctxFor(canvas.scene, { forced: true });
  const form = SC.decideArrival(c);
  if ( form === "none" ) return false;
  veilIn({ opaque: true });
  play(form, { forced: true });
  return true;
}
export const arrivalApi = {
  test: testArrival, settings, cut: () => cut(),
  status: () => (A ? { scene: A.scene, form: A.form, move: A.move, title: A.title, taken: A.taken, screen: A.screen, owner: Screen.owner } : null),
  _debug: () => ({ veil: !!veil, veilOpacity: veil ? getComputedStyle(veil.el).opacity : null, cards: document.querySelectorAll(".mm-dir-arr").length, veils: document.querySelectorAll(".mm-dir-veil").length,
    arrival: !!A, holds: [...holds], follow, last: lastSeen(), pageFirst, start: A?.start ?? null, home: A?.home ?? null })
};

export function registerSceneSource() {
  Hooks.once("init", registerSettings);
  Hooks.on("canvasTearDown", onTearDown);
  Hooks.on("canvasInit", onInit);
  Hooks.on("canvasReady", onReady);
  Hooks.on("createToken", onCreateToken);
  // someone else takes the screen: the destruction show, or a director take-over (a forced cut: holds make the others soft)
  Hooks.on("moinenMapsCinematic", (kind) => { if ( kind === "start" && A ) endArrival("show"); });
  Hooks.on(HOOK, (kind, data) => {
    if ( kind === "shot" && data?.form === "take" && A ) endArrival("shot");
    else if ( kind === "state" && A && !isOn() && !A.forced ) cut();                                  // (the GM switched the director off)
  });
  if ( moduleApi.director ) moduleApi.director.arrival = arrivalApi;
}
