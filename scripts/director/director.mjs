import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import { sharedNow } from "../shared-clock.mjs";
import * as Cin from "../destruction/cinematic-core.mjs";
import * as Dir from "./core.mjs";
import { Screen, clientOpts } from "./stage.mjs";
import * as Ov from "./overlay.mjs";

/**
 * THE DIRECTOR (runtime): events -> shots -> every client's screen.
 *
 *  - EVENTS come from the module's own features (sources.mjs), from other modules (api.director.emit / the hook below) and from the
 *    GM's bar ("cut to"). They go to the LEADER (the active GM; with no GM online the first active user), whose Queue (core.mjs) merges
 *    events close in time and place, ranks them, keeps cooldowns and the rest between take-overs, and plans SHOTS.
 *  - A SHOT record goes to every client over the module socket with its start on the SHARED clock (shared-clock.mjs), so all of them
 *    play it at the same moment; once sent nobody needs the leader any more (a GM who leaves mid-shot changes nothing).
 *  - Each client decides from what IT may see (core decide()): a player whose vision does not reach the place, or a shot of a hidden
 *    token / a GM-only thing, gets nothing; a busy player (dragging, measuring, panning) or one who chose "soft" gets the soft form.
 *  - A TAKE-OVER drives the shared screen engine (stage.mjs Screen, the old cinematic effects): bars, vignette, camera to the place,
 *    flash and shake on an impact, the caption, and the camera back to where the player had it. Esc or a click cuts it short (the camera
 *    returns); the wheel or a drag takes the camera (it stays where the player puts it).
 *  - The destruction show (cinematic.mjs) owns the screen while it plays: the director waits, and a shot on screen when it starts hands
 *    it its home view.
 * Hook "moinenMapsDirector" (kind, data): "event" (leader: an event entered the queue), "shot" (a client starts a shot: { shot, form }),
 * "end" ({ shot, form, why }), "skip", "state". Other modules may also CALL it: Hooks.callAll("moinenMapsDirector", "emit", event).
 * Kill switch: CONFIG.moinenMaps.noDirector = true (nothing is planned or played; the destruction show is not affected).
 * World switch "directorOn" (the GM: workspace section + bar), OFF by default (also in worlds that never touched it): while off nothing
 * is planned, sent or played (cut to included); only the GM's local test shot works. The destruction show never depends on it.
 */
export const HOOK = "moinenMapsDirector";
const CHANNEL = `module.${MODULE_ID}`;
const SLACK = 450;                       // ms between planning a shot and its start (the socket has to reach everyone)
const CUE_AFTER = 2200;                  // ms a cued take-over stays on the result after its cue (a soft one a little longer)
const CUE_MAX = 4500;                    // ms after the camera arrived: a cue that has not landed by then lands anyway

/**
 * CUES: name -> (shot) => Promise (or a value) that resolves when THIS client reaches the shot's moment (e.g. "dice": the roll's 3D dice
 * have landed here). It may resolve with { impact: false } (no flash/shake: a miss). A source registers its cue on every client.
 */
const cues = new Map();
export function registerCue(name, fn) { if ( typeof name === "string" && typeof fn === "function" ) cues.set(name, fn); }

export const killed = () => !!globalThis.CONFIG?.moinenMaps?.noDirector;
const setting = (k) => { try { return game.settings.get(MODULE_ID, k); } catch { return undefined; } };
/** The GM's world switch (default off). */
export const isOn = () => setting("directorOn") === true;
/** GM: switch the director on / off for the world (on also drops an old "enabled: false" override so on means on). */
export async function setOn(on) {
  if ( !game.user.isGM ) return;
  if ( on ) { const b = Dir.sanitize(setting("director")); if ( b.over.enabled === false ) { delete b.over.enabled; await game.settings.set(MODULE_ID, "director", b); } }
  await game.settings.set(MODULE_ID, "directorOn", !!on);
}
const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);

/* ---------------------------------------------------------------- settings */

function registerSettings() {
  const D = (k) => `MOINENMAPS.Dir.set.${k}`;
  game.settings.register(MODULE_ID, "director", { scope: "world", config: false, type: Object, default: { v: 1, preset: "standard", over: {} }, onChange: () => { rCache = null; tell("state"); } });
  game.settings.register(MODULE_ID, "directorOn", { scope: "world", config: false, type: Boolean, default: false, onChange: (v) => { if ( !v ) skipHere(null); tell("state"); } });
  game.settings.register(MODULE_ID, "directorGm", { scope: "world", config: false, type: Object, default: { paused: false, k: 1 }, onChange: () => tell("state") });
  game.settings.register(MODULE_ID, "dirMode", {
    name: D("mode"), hint: D("modeHint"), scope: "client", config: true, type: String, default: "auto",
    choices: { auto: D("modeAuto"), full: D("modeFull"), soft: D("modeSoft"), off: D("modeOff") }, onChange: () => tell("state")
  });
  game.settings.register(MODULE_ID, "dirIntensity", {
    name: D("intensity"), hint: D("intensityHint"), scope: "client", config: true, type: Number, default: 1, range: { min: 0, max: 1, step: 0.05 }, onChange: () => tell("state")
  });
}

let rCache = null;
/** The director's resolved settings (world). */
export const R = () => (rCache ??= Dir.resolve(setting("director")));
export const gmState = () => ({ paused: false, k: 1, ...(setting("directorGm") ?? {}) });
/** This client's mode: "full" | "soft" | "bar" (GM: only the bar's status line) | "off". */
export function myMode() {
  const m = setting("dirMode") ?? "auto";
  if ( m !== "auto" ) return m;
  return game.user?.isGM ? "bar" : "full";
}
/** The look of the take-overs: a cinematic preset (shipped or the GM's own) resolved to values. */
function lookValues() {
  const users = Object.fromEntries(Object.entries(setting("cinUserPresets") ?? {}).map(([id, u]) => [id, u?.values ?? {}]));
  return Cin.resolve({ preset: R().look, over: {} }, users);
}

/* ---------------------------------------------------------------- the leader */

const queue = new Dir.Queue();
let pumpTimer = 0;
let showOn = false;                      // a destruction show owns the screen (moinenMapsCinematic start .. end)
const lastEvents = [];                   // the leader's last events (cut to: "the last event")

export function leaderId() {
  const users = game.users?.contents ?? [];
  return game.users?.activeGM?.id ?? Dir.leaderOf(users.map((u) => ({ id: u.id, active: u.active, isGM: u.isGM })));
}
export const isLeader = () => !!game.user && leaderId() === game.user.id;
const grid = () => canvas?.dimensions?.size ?? canvas?.grid?.size ?? 100;

/**
 * Emit an event (any client, any module): { kind, weight 0..1, x, y | box {x0,y0,x1,y1} (scene px), tokens [ids], caption (string or
 * { key, data }), who ("all" | "gm"), force }. The leader queues it; another client sends it to the leader. Returns the normalised event.
 */
export function emit(e) {
  if ( killed() || !isOn() || !canvas?.scene ) return null;
  const ev = Dir.normEvent({ scene: canvas.scene.id, ...e }, sharedNow());
  if ( !ev ) return null;
  if ( isLeader() ) enqueue(ev);
  else { const to = leaderId(); if ( to ) game.socket?.emit(CHANNEL, { t: "dir", op: "event", ev, to }, { recipients: [to] }); }   // (to the leader only)
  return ev;
}
function enqueue(ev) {
  if ( killed() || !isOn() ) return;
  const r = R();
  if ( !ev.force && (!r.enabled || !Dir.sourceOn(r, ev.kind)) ) return;
  if ( ev.who === "gm" && !game.users.some((u) => u.active && u.isGM) ) return;   // a GM-only thing with no GM online: nobody may watch it
  ev.t = sharedNow();                                      // (the leader's moment: the merge window counts from arrival)
  lastEvents.push(ev); while ( lastEvents.length > 8 ) lastEvents.shift();
  queue.push(ev, r, grid());
  Hooks.callAll(HOOK, "event", ev);
  if ( showOn && !ev.force ) { schedulePump(400); return; }
  schedulePump();
}
function schedulePump(ms = null) {
  clearTimeout(pumpTimer); pumpTimer = 0;
  if ( !queue.buckets.length ) return;
  const due = queue.due(R()), wait = ms ?? Math.max(0, due - sharedNow());
  pumpTimer = setTimeout(pump, Math.min(Math.max(16, wait), 1000));
}
function pump() {
  pumpTimer = 0;
  if ( !isLeader() || killed() || !isOn() ) { queue.clear(); return; }
  const now = sharedNow(), st = gmState();
  if ( showOn ) {                                          // the show owns the screen: forced cuts wait for it too; the rest goes stale
    queue.buckets = queue.buckets.filter((b) => now - b.t0 <= R().stale);
    schedulePump(400); return;
  }
  const shots = queue.pump(R(), { now: now + SLACK, paused: st.paused }, grid());
  for ( const s of shots ) { s.k = Dir.clamp(Number(st.k ?? 1), 0, 1); s.by = game.user.id; send(s); }
  if ( queue.buckets.length ) schedulePump(250);
}
function send(shot) {
  // a GM-only shot (a hidden token, a GM-only thing) never goes over the wire to a player: the server's custom socket honours
  // { recipients }, so it reaches only the other GMs online (none: it stays here)
  if ( shot.who === "gm" ) {
    const gms = game.users.filter((u) => u.active && u.isGM && u.id !== game.user.id).map((u) => u.id);
    if ( gms.length ) game.socket?.emit(CHANNEL, { t: "dir", op: "shot", shot }, { recipients: gms });
  } else game.socket?.emit(CHANNEL, { t: "dir", op: "shot", shot });
  receive(shot);
}

/* ---------------------------------------------------------------- the socket */

function onSocket(msg) {
  if ( !msg || msg.t !== "dir" ) return;
  if ( msg.op === "shot" ) receive(msg.shot);
  else if ( msg.op === "event" ) { if ( isLeader() ) enqueue(Dir.normEvent(msg.ev, sharedNow())); }
  else if ( msg.op === "skip" ) skipHere(msg.id ?? null);
}

/* ---------------------------------------------------------------- play handlers (sources that play their shots their own way) */

/**
 * A source may register a PLAY HANDLER and name it in its events (`play: { by: id, ... }`); every client then asks it, for those shots:
 *   check(shot, form) -> "none" | "soft" | null       only ever a downgrade: what THIS client may or need not see (e.g. "it is on my
 *                                                      screen already", "I moved it myself", "that token is not in my vision");
 *   drive(shot, api)  -> { stop(why) } | null         the camera of a take-over instead of the one framed move (api below);
 *   stay(shot) -> bool                                at its natural end the camera stays where the shot left it (no return);
 *   caption: false                                     no lower third on its take-overs (the source shows its own).
 */
const plays = new Map();
export function registerPlay(id, handler) { if ( typeof id === "string" && handler && typeof handler === "object" ) plays.set(id, handler); }
const playOf = (shot) => (shot?.play?.by ? plays.get(shot.play.by) ?? null : null);

/* ---------------------------------------------------------------- one client: playing shots */

let cur = null;                          // the take-over on screen here: { shot, form, timers, cap, onKey, onPtr, ... }
const softs = new Map();                 // soft shots on screen: id -> { mark, timer }
const seen = new Set();                  // shot ids played here (an echo or a duplicate never plays twice)
const waiting = new Map();               // shot id -> timer until its start
let last = null;                         // the last shot seen here (status)

function receive(shot) {
  if ( killed() || !isOn() || !Dir.validShot(shot) || seen.has(shot.id) || waiting.has(shot.id) ) return;
  if ( !canvas?.ready || shot.scene !== canvas.scene?.id ) return;
  const now = sharedNow();
  if ( now > Dir.shotEnd(shot) - 200 ) return;
  if ( shot.form === "take" && !shot.force ) { /* (nothing: the leader spaces the take-overs) */ }
  const t = setTimeout(() => { waiting.delete(shot.id); start(shot); }, Math.max(0, shot.t0 - now));
  waiting.set(shot.id, t);
}

/** What this client may see of a shot's place: its vision (token vision scenes), the tokens it names, the GM-only flag. */
export function canSee(shot) {
  if ( game.user.isGM ) return true;
  if ( shot.who === "gm" ) return false;
  for ( const id of shot.tokens ?? [] ) {
    const d = canvas.scene?.tokens?.get(id);
    if ( d?.hidden && !d.isOwner ) return false;
  }
  if ( shot.strict && seeTokens(shot) === "none" ) return false;
  const vis = canvas.visibility;
  if ( !vis?.tokenVision ) return true;                    // no token vision on this scene: the players see the whole map
  const b = shot.box, g = grid();
  const pts = [[shot.x, shot.y], [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], [b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]];
  return pts.some(([x, y]) => { try { return vis.testVisibility({ x, y }, { tolerance: g * 0.3 }); } catch { return false; } });
}

/**
 * A strict shot's tokens as this client sees them (Token#visible: vision, detection, hidden): "all", "focus" (the first token is
 * visible, another is not: the soft form at the focus, so the framing never points at what this client cannot see) or "none".
 */
export function seeTokens(shot) {
  if ( game.user.isGM ) return "all";
  const ids = shot.tokens ?? [];
  if ( !ids.length ) return "all";
  const vis = (id) => { const d = canvas.scene?.tokens?.get(id), t = d?.object; return !!t && !!t.visible && !(d.hidden && !d.isOwner); };
  if ( !vis(ids[0]) ) return "none";
  return ids.every(vis) ? "all" : "focus";
}

/* the player at work: a button held on the board, the wheel a moment ago, the pan keys held */
const input = { down: 0, wheel: 0, downAt: 0 };
/** Other parts of the director that own the screen for a moment (the scene arrival): while any holds it, take-overs come soft. */
export const holds = new Set();
const PAN_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Numpad8", "Numpad2", "Numpad4", "Numpad6"]);
export function busy({ ignoreHolds = false } = {}) {
  if ( !ignoreHolds && holds.size ) return true;
  if ( input.down > 0 && performance.now() - input.downAt < 15000 ) return true;          // (a lost pointerup never keeps a player "busy" for good)
  if ( performance.now() - input.wheel < 1200 ) return true;
  const keys = game.keyboard?.downKeys;
  if ( keys ) for ( const k of keys ) if ( PAN_KEYS.has(k) ) return true;
  if ( canvas?.controls?.ruler?.active ) return true;
  return false;
}
function wireInput() {
  const board = () => document.getElementById("board");
  window.addEventListener("pointerdown", (ev) => { if ( ev.target === board() ) { input.down++; input.downAt = performance.now(); } }, true);
  const up = () => { input.down = 0; };
  window.addEventListener("pointerup", up, true); window.addEventListener("pointercancel", up, true); window.addEventListener("blur", up);
  window.addEventListener("wheel", (ev) => { if ( ev.target === board() ) input.wheel = performance.now(); }, { capture: true, passive: true });
}

/** The context decide() needs, for this client now. */
function ctxOf(shot) {
  const mode = myMode(), opts = clientOpts();
  return {
    killed: killed(), mode: mode === "bar" ? "soft" : mode, gm: game.user.isGM, visible: canSee(shot), busy: busy() || (!!shot.strict && seeTokens(shot) !== "all"), show: showOn || Screen.owner === "show",
    k: Dir.intensity(Number(setting("dirIntensity")), shot.k), camera: !opts.noCamera || mode === "full", softOn: mode !== "bar" ? true : false
  };
}

function start(shot) {
  if ( killed() || !isOn() || !canvas?.ready || shot.scene !== canvas.scene?.id ) return;
  seen.add(shot.id); if ( seen.size > 200 ) seen.delete(seen.values().next().value);
  const ctx = ctxOf(shot);
  let form = Dir.decide(shot, ctx);
  const ph = playOf(shot);
  if ( ph?.check && form !== "none" ) {
    try { const f = ph.check(shot, form); if ( f === "none" || (f === "soft" && form === "take") ) form = f; } catch ( err ) { console.error(`${MODULE_ID} | director play`, err); form = "none"; }
  }
  last = { id: shot.id, kind: shot.kind, form, planned: shot.form, at: sharedNow(), caption: captionText(shot) };
  if ( form === "none" ) { tell("state"); return; }
  const late = sharedNow() - shot.t0;
  if ( form === "take" && late > shot.lead + shot.hold * 0.5 ) form = "soft";
  Hooks.callAll(HOOK, "shot", { shot, form });
  if ( form === "take" ) playTake(shot, ctx, Math.max(0, late)); else playSoft(shot, Math.max(0, late));
  tell("state");
}

/**
 * The caption text of a shot for this client: { kick, title, icon }. Token names only when this user may see them (`token` with its
 * public `name`, `target` with `tname`). `c` = another caption of the shot (a cued shot's `after`); its optional `kick` key replaces the
 * kind's name on the small line.
 */
export function captionText(shot, c = shot.caption) {
  const kind = Dir.KINDS[shot.kind] ? shot.kind : "custom";
  let kick = T(`Dir.kind.${kind}`);
  const icon = Dir.KINDS[kind].icon;
  let title = "";
  if ( typeof c === "string" ) title = c;
  else if ( c?.key ) {
    const data = { ...(c.data ?? {}) };
    if ( data.token !== undefined ) data.token = tokenName(data.token, data.name);
    if ( data.target !== undefined ) data.target = tokenName(data.target, data.tname);
    delete data.name; delete data.tname;
    const key = `MOINENMAPS.${c.key}`;
    title = game.i18n.has(key) ? game.i18n.format(key, data) : "";
    const kk = c.kick ? `MOINENMAPS.${c.kick}` : null;
    if ( kk && game.i18n.has(kk) ) kick = game.i18n.format(kk, data);
  }
  if ( shot.n > 1 && !title ) title = game.i18n.format("MOINENMAPS.Dir.cap.many", { n: shot.n });
  return { kick, title, icon };
}
function tokenName(id, fallback) {
  const d = canvas.scene?.tokens?.get(id);
  if ( !d ) return fallback || T("Dir.someone");
  if ( game.user.isGM ) return d.name;
  const t = d.object, M = CONST.TOKEN_DISPLAY_MODES;
  if ( d.hidden && !d.isOwner ) return T("Dir.someone");
  if ( t && !t.visible ) return T("Dir.someone");
  return d.isOwner || [M.ALWAYS, M.HOVER].includes(d.displayName) ? d.name : T("Dir.someone");
}

/* ---- the take-over */

function playTake(shot, ctx, late = 0) {
  endTake("replaced", { quiet: true });
  const dr = R(), opts = clientOpts(), reduced = !!opts.reduced;
  const look = { ...Dir.lookFor(lookValues(), ctx.k, reduced), camMode: "frame", camHold: 0, camOn: true, fx: true };
  const v = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, scale: canvas.stage.scale.x, vw: canvas.app.screen.width, vh: canvas.app.screen.height, grid: grid() };
  const lim = [CONFIG.Canvas?.minZoom ?? 0.1, CONFIG.Canvas?.maxZoom ?? 3];
  const home = Screen.home;                                 // (a shot or the show before: its home view is the player's own)
  if ( !Screen.begin({ r: look }, { owner: "director", guard: false, frame: false, opts: { noCamera: false, allow: ["camera"] } }) ) return;
  const from = home ?? { x: v.x, y: v.y, scale: v.scale };
  const target = Dir.frameShot(shot, { ...v, ...from }, dr, ctx.k, lim, reduced);
  const lead = Math.max(250, shot.lead - late);
  const c = cur = { shot, form: "take", timers: [], cap: null, t0: performance.now() - late, done: false };
  const at = (ms, fn) => c.timers.push(setTimeout(() => { if ( cur === c && !c.done ) { try { fn(); } catch ( err ) { console.error(`${MODULE_ID} | director`, err); endTake("error"); } } }, Math.max(0, ms - late)));
  const ph = playOf(shot);
  if ( ph?.drive ) {
    // the source's own camera (e.g. following a token): it gets the framed target, the time it has to get there and the end
    try {
      c.drv = ph.drive(shot, { target, from: { x: v.x, y: v.y, scale: v.scale }, home: from, lead, late, reduced, k: ctx.k, limits: lim, grid: grid(), r: dr,
        cameraOn: () => cur === c && !c.done && !c.taken && Screen.owner === "director", end: (why = "done") => { if ( cur === c && !c.done ) endTake(why); }, at });
    } catch ( err ) { console.error(`${MODULE_ID} | director drive`, err); c.drv = null; }
  }
  c.stay = !!ph?.stay?.(shot);
  if ( !c.drv ) Screen.panTo({ x: target.x, y: target.y, scale: target.scale, duration: reduced ? lead * 1.25 : lead });
  // a carried token / a path: the camera drifts along it during the hold (half the way: the frame already holds both ends)
  if ( !c.drv && shot.path?.length >= 4 && !reduced ) {
    const p = shot.path, ex = p[p.length - 2], ey = p[p.length - 1];
    at(shot.lead, () => Screen.panTo({ x: (target.x + ex) / 2, y: (target.y + ey) / 2, scale: target.scale, duration: Math.max(400, shot.hold * 0.8) }));
  }
  const hit = () => { if ( c.hit ) return; c.hit = true; if ( shot.impact >= 0 && Screen.owner === "director" ) Screen.impact({ x: shot.x, y: shot.y, size: Math.max(shot.box.x1 - shot.box.x0, shot.box.y1 - shot.box.y0) }); };
  // a destruction stroke: the hit lands when THIS client's entry of it starts (its data comes after the save and the bake), and the
  // camera stays until the entry has played (at most EXTRA longer than planned); without one the hit lands as the camera arrives
  const entry = shot.cue ? null : entryState(shot.ref);
  if ( shot.ref && entry !== null ) {
    c.watch = setInterval(() => {
      if ( cur !== c || c.done ) return clearInterval(c.watch);
      const e = entryState(shot.ref);
      if ( e === "anim" && !c.hit ) { hit(); c.minEnd = performance.now() + Math.min(1400, shot.hold); }
      else if ( e === "settled" && !c.hit && performance.now() - c.t0 > shot.lead ) hit();      // (it played before this client got here)
    }, 60);
    c.timers.push(c.watch);
    at(shot.lead + 1500, () => hit());                                                           // (never without the hit)
  } else if ( shot.cue && cues.has(shot.cue) ) {
    // a cued shot (a roll: the dice landing on THIS client): the hit and the result caption wait for the cue, never before the camera
    // is there; then the camera stays CUE_AFTER on the result (also when that ends the shot earlier than planned)
    c.pending = true;
    const arrive = shot.impact >= 0 ? shot.impact : Math.round(shot.lead * 0.92);
    const land = (res) => {
      if ( cur !== c || c.done || !c.pending ) return;
      c.pending = false;
      const go = () => {
        if ( cur !== c || c.done ) return;
        if ( shot.impact >= 0 && res?.impact !== false ) { c.hit = false; hit(); }
        if ( dr.captions && shot.after ) { c.cap?.out(260); c.cap = Ov.caption({ ...captionText(shot, shot.after), lb: Screen.debug?.()?.bars ? look.lbHeight : 0, hint: T("Dir.cutHint") }); }
        c.minEnd = performance.now() + CUE_AFTER;
        c.timers.push(setTimeout(() => { if ( cur === c && !c.done && performance.now() - c.t0 < plannedEnd ) endTake("done"); }, CUE_AFTER));
      };
      const wait = c.t0 + arrive - performance.now();
      if ( wait > 0 ) c.timers.push(setTimeout(go, wait)); else go();
    };
    c.hit = true;                                                                                // (no hit on arrival: the cue lands it)
    Promise.resolve().then(() => cues.get(shot.cue)(shot)).then(land, () => land(null));
    at(shot.lead + CUE_MAX, () => land(null));                                                   // (never without the result)
  } else if ( shot.impact >= 0 ) at(shot.impact, hit);
  if ( dr.captions && ph?.caption !== false && (captionText(shot).title || shot.after) ) at(Math.round(shot.lead * 0.45), () => {
    if ( c.cap ) return;                                                                         // (the cue landed first: its caption is up)
    const t = captionText(shot);
    if ( t.title ) c.cap = Ov.caption({ ...t, lb: Screen.debug?.()?.bars ? look.lbHeight : 0, hint: T("Dir.cutHint") });
  });
  const EXTRA = 2200, plannedEnd = shot.lead + shot.hold;
  const ending = () => {
    const now = performance.now(), wait = Math.max(c.minEnd ?? 0, (shot.ref && entry !== null && !c.hit) || c.pending ? c.t0 + plannedEnd + 600 : 0) - now;
    if ( wait > 30 && now - c.t0 < plannedEnd + EXTRA ) { c.timers.push(setTimeout(() => { if ( cur === c && !c.done ) ending(); }, Math.min(wait, 250))); return; }
    endTake("done");
  };
  at(plannedEnd, ending);
  // the player: Esc or a click on the map cuts the shot short (the camera returns); the wheel or another button takes the camera
  c.onKey = (ev) => { if ( ev.key === "Escape" && cur === c ) { ev.preventDefault(); ev.stopImmediatePropagation(); endTake("cut"); } };
  c.onPtr = (ev) => {
    if ( cur !== c || ev.target !== document.getElementById("board") ) return;
    if ( ev.type === "wheel" || ev.button !== 0 ) { Screen.stopCamera("player"); c.taken = true; return; }
    ev.preventDefault(); ev.stopImmediatePropagation(); endTake("cut");
  };
  window.addEventListener("keydown", c.onKey, true);
  window.addEventListener("pointerdown", c.onPtr, true);
  window.addEventListener("wheel", c.onPtr, { capture: true, passive: true });
}
/** The take-over ends here: "done" (its time), "cut" (Esc / a click: quick return), "skip" (the GM), "show", "replaced", "scene", "error". */
function endTake(why, { quiet = false } = {}) {
  const c = cur; if ( !c || c.done ) return;
  c.done = true; cur = null;
  try { c.drv?.stop?.(why); } catch ( err ) { console.error(`${MODULE_ID} | director drive`, err); }
  if ( c.stay && why === "done" && Screen.owner === "director" ) Screen.stopCamera("stay");   // (the camera stays where the shot left it)
  for ( const t of c.timers ) clearTimeout(t);
  if ( c.watch ) clearInterval(c.watch);
  window.removeEventListener("keydown", c.onKey, true);
  window.removeEventListener("pointerdown", c.onPtr, true);
  window.removeEventListener("wheel", c.onPtr, true);
  c.cap?.out(why === "cut" || why === "skip" ? 250 : 420);
  if ( why !== "replaced" && why !== "show" && Screen.owner === "director" ) {
    if ( why === "scene" || why === "error" ) Screen.end({ immediate: true });
    else Screen.end({ backMs: why === "done" ? c.shot.back : 450, hold: 0 });
  }
  if ( !quiet ) Hooks.callAll(HOOK, "end", { shot: c.shot, form: "take", why });
  tell("state");
}

/** A destruction stroke on this client's display: null (no display / unknown), "none" (not on screen yet), "anim" (its entry plays), "settled". */
function entryState(id) {
  if ( !id ) return null;
  const d = moduleApi.destruction?.display?.(); if ( !d?.order ) return null;
  const gs = d.order.filter((g) => g.objId === id);
  return !gs.length ? "none" : gs.some((g) => g.anim) ? "anim" : "settled";
}

/* ---- the soft form */

function playSoft(shot, late = 0) {
  if ( myMode() === "bar" ) return;                       // the GM's default: the bar's status line only
  const t = captionText(shot), dr = R();
  const label = t.title && shot.caption?.kick ? `${t.kick} · ${t.title}` : (t.title || t.kick);   // (a caption with its own kick: "Push · ...")
  const mark = Ov.marker({ x: shot.x, y: shot.y, text: dr.captions ? label : "", icon: t.icon, onClick: () => lookAt(shot) });
  const s = { shot, mark, timer: setTimeout(() => endSoft(shot.id, "done"), Math.max(400, shot.len - late)) };
  softs.set(shot.id, s);
  if ( shot.cue && cues.has(shot.cue) && shot.after ) {        // a cued soft shot: the label turns into the result when the cue lands
    let landed = false;
    const land = () => {
      if ( landed || softs.get(shot.id) !== s ) return;
      landed = true;
      if ( dr.captions ) { const a = captionText(shot, shot.after); mark.setText?.(a.title ? `${a.kick} · ${a.title}` : a.kick); }
      clearTimeout(s.timer); s.timer = setTimeout(() => endSoft(shot.id, "done"), CUE_AFTER + 600);
    };
    Promise.resolve().then(() => cues.get(shot.cue)(shot)).then(land, land);
    setTimeout(land, CUE_MAX);
  }
}
function endSoft(id, why) {
  const s = softs.get(id); if ( !s ) return;
  softs.delete(id); clearTimeout(s.timer);
  s.mark.out();
  Hooks.callAll(HOOK, "end", { shot: s.shot, form: "soft", why });
}
/** The player clicked a soft shot's arrow: the camera goes there (theirs: no return). */
function lookAt(shot) {
  endSoft(shot.id, "look");
  canvas.animatePan({ x: shot.x, y: shot.y, duration: 700 });
}

/* ---------------------------------------------------------------- GM controls (the bar) */

/** Skip: the take-over on screen ends everywhere (the camera returns), soft shots go, the queue is emptied. During a show: Reveal now. */
export async function skip() {
  if ( !game.user.isGM ) return false;
  if ( showOn || Screen.owner === "show" ) { await moduleApi.destruction?.cinematic?.skip?.(); return true; }
  const id = cur?.shot?.id ?? null;
  game.socket?.emit(CHANNEL, { t: "dir", op: "skip", id });
  skipHere(id);
  Hooks.callAll(HOOK, "skip", { id });
  return true;
}
function skipHere(id) {
  if ( isLeader() ) { queue.clear(); queue.release(sharedNow()); }
  for ( const [sid, t] of waiting ) { clearTimeout(t); waiting.delete(sid); seen.add(sid); }
  if ( cur ) endTake("skip");
  for ( const sid of [...softs.keys()] ) endSoft(sid, "skip");
}
export async function setPaused(paused) { if ( game.user.isGM ) await game.settings.set(MODULE_ID, "directorGm", { ...gmState(), paused: !!paused }); }
export async function setGmIntensity(k) { if ( game.user.isGM ) await game.settings.set(MODULE_ID, "directorGm", { ...gmState(), k: Dir.clamp(Number(k), 0, 1) }); }

/**
 * Cut to (GM): a forced take-over of a token ({ token: id }), a spot ({ x, y }) or "last" (the last event the director got). It plays
 * even when the director is paused and breaks the rest between take-overs; the players' vision still decides what they see.
 */
export function cutTo(target) {
  if ( !game.user.isGM || !canvas?.scene ) return null;
  let e = null;
  if ( target === "last" ) {
    const ev = lastEvents.at(-1) ?? lastShotEvent;
    if ( !ev ) return null;
    e = { ...ev, id: undefined, force: true, weight: 1, t: undefined };
  } else if ( target?.token ) {
    const d = canvas.scene.tokens.get(target.token); if ( !d ) return null;
    const t = d.object, c = t?.center ?? { x: d.x + (d.width * grid()) / 2, y: d.y + (d.height * grid()) / 2 }, r = grid() * Math.max(d.width, d.height) * 1.5;
    e = { kind: "cut", weight: 1, x: c.x, y: c.y, box: Dir.pointBox(c.x, c.y, r), tokens: [d.id], caption: { key: "Dir.cap.cutToken", data: { token: d.id, name: publicName(d) } }, who: d.hidden ? "gm" : "all", force: true };
  } else if ( Number.isFinite(target?.x) && Number.isFinite(target?.y) ) {
    e = { kind: "cut", weight: 1, x: target.x, y: target.y, box: Dir.pointBox(target.x, target.y, grid() * 3), caption: target.caption ?? null, force: true };
  }
  return e ? emit(e) : null;
}
let lastShotEvent = null;
/** A token's name when every player may read it (the display mode shows it to all), else nothing: it never travels to the players. */
export function publicName(d) {
  const M = CONST.TOKEN_DISPLAY_MODES;
  return !d.hidden && [M.ALWAYS, M.HOVER].includes(d.displayName) ? d.name : "";
}

/** A test take-over on this client only (the settings panel's button): the look and timings at the view centre. */
export function preview() {
  if ( !canvas?.ready || killed() ) return false;
  const c = canvas.stage.pivot, g = grid();
  const ev = Dir.normEvent({ kind: "custom", weight: 1, x: c.x + g * 2, y: c.y + g, box: Dir.pointBox(c.x + g * 2, c.y + g, g * 2.5), caption: { key: "Dir.cap.test", data: {} }, scene: canvas.scene.id, force: true }, sharedNow());
  const shot = Dir.plan({ ...ev, kinds: ["custom"], n: 1 }, "take", R(), sharedNow(), 0);
  shot.impact = Math.round(shot.lead * 0.92); shot.k = gmState().k; shot.id = `test-${Math.round(performance.now())}`;
  const ctx = { ...ctxOf(shot), visible: true, busy: false, camera: true, mode: "full" };
  if ( Dir.decide(shot, ctx) !== "take" ) return false;
  seen.add(shot.id);
  playTake(shot, ctx, 0);
  return true;
}

/* ---------------------------------------------------------------- the destruction show and the scene */

function onShow(kind) {
  if ( kind === "start" ) {
    showOn = true;
    if ( cur ) endTake("show");                            // (the show's begin took this shot's home view)
    for ( const id of [...softs.keys()] ) endSoft(id, "show");
  } else if ( kind === "end" ) {
    showOn = false;
    if ( isLeader() ) { queue.release(sharedNow()); queue.lastTake = { x: NaN, y: NaN, end: sharedNow(), scene: canvas.scene?.id }; schedulePump(); }
  }
  tell("state");
}
function onTearDown() {
  for ( const [, t] of waiting ) clearTimeout(t);
  waiting.clear();
  if ( cur ) endTake("scene");
  for ( const id of [...softs.keys()] ) endSoft(id, "scene");
  Ov.clearAll();
  // (the take-over of the old scene is over on every client that leaves it: the new scene's events must not wait for its planned end)
  queue.clear(); queue.release(sharedNow()); queue.lastTake = null; clearTimeout(pumpTimer); pumpTimer = 0;
  showOn = false;
}

const tell = (kind) => { try { Hooks.callAll(HOOK, kind, status()); } catch { /* listeners */ } };

/** What the director is doing on this client (the GM bar, the checks). */
export function status() {
  return {
    killed: killed(), on: isOn(), leader: leaderId(), isLeader: isLeader(), enabled: R().enabled, paused: gmState().paused, k: gmState().k, mode: myMode(), show: showOn,
    take: cur ? { id: cur.shot.id, kind: cur.shot.kind, taken: !!cur.taken } : null, soft: [...softs.keys()], waiting: [...waiting.keys()], last,
    queued: queue.buckets.length, screen: Screen.owner
  };
}

/* ---------------------------------------------------------------- wiring */

export const directorApi = {
  emit, cutTo, skip, preview, setOn, isOn, setPaused, setGmIntensity, status, settings: R, captionText, canSee, busy, leaderId, isLeader, killed, registerPlay, registerCue, seeTokens,
  /** For the checks: the overlays, the queue. */
  _debug: () => ({ overlay: Ov.debug(), queue: { buckets: queue.buckets.length, busyUntil: queue.busyUntil, history: queue.history.slice(-6) }, cur: cur ? { id: cur.shot.id, timers: cur.timers.length } : null, screen: Screen.debug?.() ?? null }),
  _receive: receive
};
moduleApi.director = directorApi;

Hooks.once("init", registerSettings);
Hooks.once("ready", () => {
  game.socket?.on(CHANNEL, onSocket);
  wireInput();
  Hooks.on("moinenMapsCinematic", onShow);
  Hooks.on("canvasTearDown", onTearDown);
  Hooks.on(HOOK, (kind, data) => { if ( kind === "emit" && data && typeof data === "object" ) emit(data); });
  Hooks.on("userConnected", () => { tell("state"); if ( isLeader() ) schedulePump(); });
});
// (the shots planned by this leader stay "the last event" for cut to after the queue forgot them)
Hooks.on(HOOK, (kind, data) => { if ( kind === "shot" && data?.shot ) lastShotEvent = { kind: data.shot.kind, x: data.shot.x, y: data.shot.y, box: data.shot.box, tokens: data.shot.tokens, caption: data.shot.caption, who: data.shot.who }; });
