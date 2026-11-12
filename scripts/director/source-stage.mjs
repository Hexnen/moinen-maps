import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as SC from "./stage-core.mjs";
import * as AC from "./action-core.mjs";
import { killed, isOn, myMode, R, HOOK, registerStager, registerVeto, cameraHeld, busy, holds, takeLook, zoomLocked, typing, escTaken } from "./director.mjs";
import { Screen, clientOpts } from "./stage.mjs";
import { freeRect } from "./overlay.mjs";
import { restyle } from "./screen.mjs";
import { extendSection } from "../workspace/registry.mjs";
import { esc, optRange, optSelect, optCheck, optHint, isEcho, writeControl } from "../workspace/ui.mjs";
import { FOLLOW, followOf } from "../zones/board-core.mjs";
import { chipSpot } from "../zones/room.mjs";

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
 * Idle: hooks only; no ticker, no timer. While the camera is parked away: a keydown listener and the chip (placed again on a 300 ms timer while it shows).
 */

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const KEY = "dirStage";
let setCache = null;
export const stageSettings = () => (setCache ??= SC.sanitizeStage((() => { try { return game.settings.get(MODULE_ID, KEY); } catch { return null; } })()));
const grid = () => canvas?.dimensions?.size ?? canvas?.grid?.size ?? 100;
/** Where the stage frames: the map less Foundry's interface AND the open windows (a sheet, a roll dialog): never a combatant under a window. */
const stageRect = () => { const r = freeRect(); return { x: r.x, y: r.y, w: r.w, h: r.h }; };

/**
 * HOW MUCH THE CAMERA FOLLOWS, per client (the player's own switch; dev/zones-api.md 30):
 *   "all"   every beat of the fight as described above
 *   "turn"  only the START OF A TURN, and only when the active combatant is OFF SCREEN: the view slides by the least that brings it
 *           in, at the zoom the player has; moves and attacks come as markers; on the player's own turn the same for their own token
 *   "off"   the camera is never moved; every beat comes as a marker
 * The client setting `dirFollow` holds the user's choice; "auto" (its default) means what a combat module said with camera({ default })
 * on this client, and "all" when none did.
 */
const FOLLOW_KEY = "dirFollow";
let followDefault = "all";
const followChoice = () => { try { const v = game.settings.get(MODULE_ID, FOLLOW_KEY); return FOLLOW.includes(v) ? v : "auto"; } catch { return "auto"; } };
export const follow = () => followOf(followChoice(), followDefault);
/** For the stage's own beats (a fight nobody drives) the action camera is the full stage: "all". */
const stageFollow = () => { const f = follow(); return f === "action" ? "all" : f; };
/**
 * camera()                          -> { follow (in force), choice (the user's: "auto" | "all" | "turn" | "off"), default }
 * camera({ follow: "turn" })        the user's choice, kept in the client setting (a switch on a combat module's dock calls this)
 * camera({ default: "turn" })       what "auto" means on this client until reload (a combat module says it on `ready`)
 */
export function camera(o = null) {
  if ( o && typeof o === "object" ) {
    if ( "driver" in o ) setDriver(o.driver);
    if ( o.default === "action" || o.default === "all" || o.default === "turn" || o.default === "off" ) followDefault = o.default;
    if ( FOLLOW.includes(o.follow) && o.follow !== followChoice() ) { try { game.settings.set(MODULE_ID, FOLLOW_KEY, o.follow); } catch { /* not registered */ } }
    if ( follow() !== "action" ) shotEnd();                                    // (the action camera was switched down or off: the view goes back)
    if ( follow() === "off" && (st.parked || st.home) ) { st.parked = null; sync(); }
    tell();
  }
  return { follow: follow(), choice: o && FOLLOW.includes(o.follow) ? o.follow : followChoice(), default: followDefault, driver };
}

/**
 * A DRIVEN FIGHT (dev/zones-api.md 38): a combat module that runs the fight itself says so on each client (camera({ driver: id })) and
 * names what to frame (frame()). While it is set and a started combat is on this scene, the director's own beats of that fight (the
 * turn, the combatants' moves, rolls, attacks and damage) do not play on this client, and the stage's own turn handling stands down:
 * one camera, the caller's. camera({ driver: null }) gives the fight back to the director.
 */
let driver = null;
function setDriver(id) {
  const next = typeof id === "string" && id ? id : null;
  if ( next === driver ) return;
  driver = next;
  shotEnd();
  clearTimeout(lingerT); lingerT = 0;
  if ( !beat && !homing ) { SC.frameSettle(st); sync(); }
}
const fightTokens = (c) => new Set((c?.combatants?.contents ?? [...(c?.combatants ?? [])]).map((cb) => cb.tokenId).filter(Boolean));
const vetoShot = (shot) => { if ( !driver ) return false; const c = combatHere(); return !!c && SC.drivenShot(shot, c.id, fightTokens(c)); };

const st = SC.newStage();
let beat = null;                         // the stage beat on screen here: { id, own }
let homing = false;                      // the stage's own camera move home is under way
let pendingHome = null;                  // go home when the beat on screen ends (own turn / the end of the combat came during it)
const trace = [];                        // the last stage decisions here (checks): [ms, kind, form, why]
/** The user moved the camera themselves. In a driven fight that is quiet for the "leave alone" seconds only (the rest of the turn is
    silenced by "My view", Esc or a click alone: the action camera would else be lost to a glance elsewhere after a turn began). */
const ownNow = () => { const now = performance.now(); if ( driver ) { st.ownAt = now; st.parked = null; st.home = null; } else SC.ownMove(st, now); };
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
  const fw = stageFollow();
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
        if ( kind !== "attack" || fw !== "all" ) return ["soft", fw === "all" ? "own, off screen" : `own, off screen (follow ${fw})`];
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
      if ( fw === "off" ) return ["soft", "follow off"];
      if ( SC.beatForm(st, performance.now(), S.back * 1000) === "soft" ) return ["soft", outWhy()];
      if ( fw === "turn" ) {
        // only when the active combatant is off screen: the least slide that brings it in, at the zoom the player has
        const v = viewNow(), rect = stageRect(), b = tokenBox(t, 0);
        if ( SC.comfortable(b, v, rect, 0) ) return ["none", "on screen (follow turn)"];
        const to = SC.ownHome(v, tokenBox(t, grid() * 0.5), rect, v, 0.12);
        const screens = Math.hypot(to.x - v.x, to.y - v.y) * v.scale / Math.max(1, Math.hypot(v.vw, v.vh)), lead = R().lead;
        cam = { ...to, ms: Math.round(SC.clamp(lead * (0.85 + 0.6 * screens), lead * 0.8, lead * 1.6)) };
        return [take(), "glide (follow turn)"];
      }
      // (the stage zoom: the zoom now while it is near the player's own - no re-zoom after an attack - else theirs)
      const v = viewNow(), scale = st.parked && st.home ? SC.stageZoom(v.scale, st.home.scale) : v.scale;
      cam = SC.turnCamera(tokenBox(t, grid() * 0.5), v, stageRect(), scale, R().lead);
      return cam ? [take(), "glide"] : ["none", "on screen"];                  // (comfortably on screen: nothing moves)
    }
    if ( ph?.check ) { const f = ph.check(shot, form); if ( f === "none" ) return ["none", "play check"]; if ( f === "soft" ) return ["soft", "play check"]; }
    if ( fw !== "all" ) return ["soft", `follow ${fw}`];
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
  dropRest();
  if ( st.parked || st.home ) { ownNow(); sync(); } else st.ownAt = performance.now();
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
  const seq = beginSeq;
  Screen.end({ backMs: dur, hold: 0 }).finally(() => {
    homing = false;
    if ( seq !== beginSeq ) { sync(); return; }                                                // (a shot took the move over: not the player's hand)
    if ( st.combat && !SC.sameView(viewNow(), to, 12) ) ownNow();   // (the player stopped it: the camera is theirs)
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

/* ---------------------------------------------------------------- frame(): what a combat module names (dev/zones-api.md 38) */

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const idOf = (w) => (typeof w === "string" ? w.split(".").pop() : w?.document?.id ?? w?.id ?? null);
let frameSeq = 0, lingerT = 0, glides = 0;
const frames = [];                       // the last frame decisions here (checks): [ms, why, answer]
/** The scene box of a zone's label point (a zone is framed by where its badge stands), or null. */
function zoneBox(key) {
  try {
    const zs = moduleApi.zones, p = zs?.place?.(key), z = p ? zs.zones?.()?.zones?.find((q) => q.id === p.id) : null;
    const at = z ? { x: z.label?.x ?? z.cx, y: z.label?.y ?? z.cy } : null, g = grid();
    return at && Number.isFinite(at.x) && Number.isFinite(at.y) ? { x0: at.x - g * 0.75, y0: at.y - g * 0.75, x1: at.x + g * 0.75, y1: at.y + g * 0.75 } : null;
  } catch { return null; }
}
/** While the token walks (a move of several stretches too): resolves when it has stood still for a moment, 6 s at most. */
async function settled(id) {
  const t0 = performance.now();
  await sleep(350);
  let still = 0;
  while ( performance.now() - t0 < 6000 && still < 2 ) {
    const t = seenTok(id); if ( !t ) return;
    if ( t.animationContexts?.has?.(t.movementAnimationName) ) { still = 0; await Promise.race([Promise.resolve(t.movementAnimationPromise ?? null).catch(() => null), sleep(2500)]); }
    else still++;
    await sleep(120);
  }
}
/** The boxes other modules asked the map to keep clear of (zones api `uiAvoids`, client px), or none. */
function avoidBoxes() { try { return moduleApi.zones?.uiAvoids?.() ?? []; } catch { return []; } }
/** What a running move pick adds to a frame of its mover (zones api `_pickFrame`), or null. */
function pickFrameFor(id) { try { return moduleApi.zones?._pickFrame?.(id) ?? null; } catch { return null; } }
/**
 * frame({ tokens, zones, points, fit = true, level = "turn", hand = false, after, why })
 *   tokens  token ids / documents / placeables, THE FOCUS FIRST (where it lands); one this client's canvas does not draw (hidden from
 *           this user, out of its sight) is left out, and a frame whose focus is such a token does nothing ("unseen"): the view never
 *           moves toward what this user cannot see, whatever the caller names
 *   zones   zone keys (framed by their label point); points [{ x, y }] scene px
 *   fit     bring all of them in when they fit at the user's zoom (the zoom is never changed); false: the focus alone; "near": the
 *           focus and as many of the others, in the order given, as fit with it
 *   level   "turn" (plays for "turn" and "all") | "all" (only for a user who chose "all")
 *   hand    it answers the user's own act on this client (a unit chosen, a target walked to): the quiet time after the user's own
 *           camera move does not stop it, and it leaves no "My view" to go back to
 *   after   a token (id): wait until it has stopped walking, then frame
 * -> Promise<{ ok: true, moved, whole? } | { ok: false, reason: "off" | "level" | "held" | "busy" | "hand" | "unseen" | "noSubject" | "noScene" | "covered" | "replaced" }>
 * This client's view only; nothing is sent to anybody.
 */
export async function frame(spec = {}) {
  const mine = ++frameSeq, why = typeof spec?.why === "string" ? spec.why.slice(0, 24) : "";
  const say = (r) => { frames.push([Math.round(performance.now()), why, r.ok ? (r.moved ? "moved" : "there") : r.reason]); if ( frames.length > 40 ) frames.shift(); return r; };
  const no = (reason) => say({ ok: false, reason });
  try {
    if ( !spec || typeof spec !== "object" || !canvas?.ready || !canvas.scene ) return no("noScene");
    if ( killed() ) return no("off");
    const level = spec.level === "all" ? "all" : "turn", hand = spec.hand === true;
    const gate = () => SC.frameGate(st, { follow: follow(), level, hand, now: performance.now(), backMs: stageSettings().back * 1000, busy: busy(), held: cameraHeld(), screen: !!Screen.owner && !homing });
    /* a shot on screen (the action camera, section 39): the user's own act ends it at once; anything else waits until the view is back */
    if ( act && !act.done ) { if ( hand ) leave(act, "hand"); else { for ( let i = 0; i < 3 && act && !act.done; i++ ) await actIdle(); if ( mine !== frameSeq ) return no("replaced"); if ( !canvas?.ready ) return no("noScene"); } }
    if ( hand ) dropRest();
    let g = gate(); if ( g ) return no(g);
    if ( spec.after ) { await settled(idOf(spec.after)); if ( mine !== frameSeq ) return no("replaced"); if ( !canvas?.ready ) return no("noScene"); g = gate(); if ( g ) return no(g); }
    /* what calls for a frame (a turn change, a card) usually redraws the surfaces in the same moment: a glide begun inside that
       hitch loses its first frames. Wait until the page draws evenly again (two even frames; at most CALM_MS), then look again. */
    if ( !clientOpts().reduced ) { await calm(); if ( mine !== frameSeq ) return no("replaced"); if ( !canvas?.ready ) return no("noScene"); g = gate(); if ( g ) return no(g); }
    const ids = (Array.isArray(spec.tokens) ? spec.tokens : []).map(idOf).filter(Boolean).slice(0, 12), pad = grid() * 0.5;
    const boxes = SC.frameSubjects(ids, (id) => { const t = seenTok(id); return t ? tokenBox(t, pad) : null; });
    if ( !boxes ) return no("unseen");
    // uxd (U142): a frame of the mover of a running move pick that names no zones takes the pick's nearest zones along (zones/interact
    // pickFrame), so a combat module's "show my unit" and the pick's own frame ask for one view
    let zones = Array.isArray(spec.zones) ? spec.zones : [], fit = spec.fit === "near" ? "near" : spec.fit !== false;
    if ( !zones.length && ids.length ) { const add = pickFrameFor(ids[0]); if ( add ) { zones = add.zones; fit = add.fit; } }
    for ( const k of zones.slice(0, 8) ) { const b = zoneBox(k); if ( b ) boxes.push(b); }
    for ( const p of (Array.isArray(spec.points) ? spec.points : []).slice(0, 8) ) if ( Number.isFinite(p?.x) && Number.isFinite(p?.y) ) boxes.push({ x0: p.x - pad, y0: p.y - pad, x1: p.x + pad, y1: p.y + pad });
    if ( !boxes.length ) return no("noSubject");
    const free = freeRect();
    if ( free.covered ) return no("covered");                                    // (a window covers the map: nothing is moved behind it)
    // uxd (U142): and not under a panel another module asked the map to keep clear of (a GM's desk, a challenges band)
    const rect = SC.avoidRect(free, avoidBoxes());
    const v = viewNow(), plan = SC.framePlan(boxes, v, rect, { fit });
    if ( !plan ) return no("noSubject");
    if ( !plan.moved ) return say({ ok: true, moved: false });
    const lim = typeof canvas._constrainView === "function" ? canvas._constrainView({ x: plan.x, y: plan.y, scale: plan.scale }) : plan;
    const to = { x: lim.x, y: lim.y, scale: v.scale };
    if ( SC.sameView(v, to, 2) ) return say({ ok: true, moved: false });         // (the scene's edge: it cannot come further in)
    const c = combatHere();
    st.combat ??= c?.id ?? "frame";
    if ( c && st.turn === null ) st.turn = turnKey(c);
    SC.frameStart(st, v, hand);
    const seq0 = beginSeq;
    const arrived = await glideTo(to, plan.ms);
    if ( seq0 !== beginSeq ) return no("replaced");                              // (a shot took the screen meanwhile: its own end settles the view)
    if ( mine === frameSeq || arrived ) SC.frameEnd(st, to, arrived, hand, performance.now());
    clearTimeout(lingerT); lingerT = 0;
    if ( st.parked ) lingerT = setTimeout(() => { lingerT = 0; if ( beat || homing || rest || act ) return; SC.frameSettle(st); sync(); }, SC.LINGER_MS);
    sync();
    return say({ ok: true, moved: true, whole: !!plan.whole, arrived });
  } catch ( err ) { console.error(`${MODULE_ID} | frame`, err); return no("error"); }
}
/* ---------------------------------------------------------------- shot(): the action camera of a driven fight (dev/zones-api.md 39) */

let act = null;                          // the beat on screen here: { key, beat, plan, home, away, phase: "go" | "hold" | "back", timers, done }
let rest = null;                         // the camera waits at the pair for the result of exchange `key`: { key, timer }
let beginSeq = 0, shotSeq = 0;
const shots = [];                        // the last shot decisions here (checks): [ms, beat, key, answer]
const coming = new Map();                // key -> beats of it that wait for an even frame rate before they take the screen
const idlers = [];                       // frame() calls that wait for the beat on screen to be over
const actIdle = () => (act && !act.done ? new Promise((res) => { idlers.push(res); setTimeout(res, 6000); }) : Promise.resolve());
function dropRest() { if ( rest ) { clearTimeout(rest.timer); rest = null; } }
const handBusy = () => busy({ ignoreHolds: true }) || [...holds].some((h) => h !== "action");

/** Everything of a beat taken off (listeners, timers); whoever waited for it goes on. Nothing of the screen is touched here. */
function cleanup(a) {
  a.done = true;
  for ( const t of a.timers ) clearTimeout(t);
  clearTimeout(a.endT); clearInterval(a.walk);
  if ( a.onKey ) {
    window.removeEventListener("keydown", a.onKey, true);
    window.removeEventListener("pointerdown", a.onPtr, true);
    window.removeEventListener("pointerup", a.onUp, true);
    window.removeEventListener("wheel", a.onPtr, true);
  }
  if ( act === a ) { act = null; holds.delete("action"); }
  for ( const r of idlers.splice(0) ) { try { r(); } catch { /* a waiter */ } }
}
/**
 * The beat leaves the screen: "done" (its time: the view goes home, or waits at the pair when the result is still to come), "cut"
 * (Esc / a click: home fast, nothing more this turn), "taken" (the user's wheel or drag: the camera is theirs where it stands),
 * "hand" (the user's own act on the dock: it stops where it is), "end" (the caller: home fast), "lost" (the map's own take-over or
 * the show took the screen: that one returns to the user's view), "scene".
 */
function leave(a, why) {
  if ( !a || a.done || (a.phase === "back" && why !== "scene" && why !== "lost") ) return;
  shots.push([Math.round(performance.now()), a.beat, a.key, `end:${why}`]); if ( shots.length > 40 ) shots.shift();
  const mine = Screen.owner === "action";
  if ( !mine || why === "lost" ) { cleanup(a); st.parked = null; st.home = null; sync(); return; }
  if ( why === "scene" ) { cleanup(a); Screen.end({ immediate: true }); st.parked = null; st.home = null; sync(); return; }
  if ( why === "taken" || why === "hand" ) {
    Screen.stopCamera("player"); Screen.end({ backMs: 250, hold: 0 }); cleanup(a);
    if ( why === "taken" ) ownNow(); else { st.parked = null; st.home = null; }
    sync(); return;
  }
  if ( why === "done" && a.plan.rest ) {
    // the result is still to come: the camera stays at the pair, the bars go, "My view" stands by; home by itself after TIMES.rest
    Screen.stopCamera("stay"); Screen.end({ backMs: 300, hold: 0 }); cleanup(a);
    const v = viewNow(); st.parked = { x: v.x, y: v.y, scale: v.scale };
    dropRest();
    rest = { key: a.key, timer: setTimeout(() => { rest = null; if ( !act && !beat && !homing && st.parked && st.home && !cameraHeld() ) goHome(st.home, AC.TIMES.back); }, AC.TIMES.rest) };
    sync(); return;
  }
  if ( why === "cut" ) st.out = st.turn;
  for ( const t of a.timers ) clearTimeout(t);
  clearTimeout(a.endT); clearInterval(a.walk);
  a.phase = "back";
  const ms = !a.away ? 300 : why === "done" ? AC.TIMES.back : AC.TIMES.cut;
  Screen.end({ backMs: ms, hold: 0 }).finally(() => {
    if ( a.done ) return;                                                        // (a newer beat carried on from here)
    cleanup(a);
    if ( a.tookBack ) ownNow(); else { st.parked = null; st.home = null; }
    sync();
  });
  sync();
}
/** The caller (or the stage) ends whatever shot plays or waits here: the view goes back to the user's, fast. Nothing is marked. */
export function shotEnd() {
  if ( act && !act.done ) { leave(act, "end"); return true; }
  if ( rest ) { dropRest(); if ( st.parked && st.home && !beat && !homing ) goHome(st.home, AC.TIMES.cut); return true; }
  return false;
}
/**
 * shot({ key, beat, tokens, zones, still, why })   (dev/zones-api.md 39; the beats and how each is played: action-core.mjs)
 *   key     the exchange the beat belongs to (the caller's id of it): beats of one key are one piece of staging
 *   beat    "open" | "hit" | "miss" | "kill" | "reveal" | "move" | "close"
 *   tokens  THE FOCUS FIRST (the target of a blow, the one revealed, the one who walks), then who else belongs in the frame (the
 *           attacker); a token this client's canvas does not show to this user is left out, and a beat whose focus is such a token
 *           does not play ("unseen"), exactly as frame()
 *   zones   zone keys to hold in the frame with them (where a walk goes)
 *   still   the user has something to answer: the beat plays its effects in place when its focus is on screen and moves nothing
 * -> Promise<{ ok: true, played: "take" | "place" | "joined" | "back" | "none" } | { ok: false, reason: "off" | "level" | "held" |
 *    "busy" | "covered" | "hand" | "unseen" | "noSubject" | "noScene" | "noBeat" | "replaced" | "error" }>
 * This client's view only; nothing is sent to anybody.
 */
export async function shot(spec = {}) {
  const name = AC.BEATS.includes(spec?.beat) ? spec.beat : null, key = typeof spec?.key === "string" ? spec.key.slice(0, 80) : "";
  const say = (r) => { shots.push([Math.round(performance.now()), name, key, r.ok ? r.played : r.reason]); if ( shots.length > 40 ) shots.shift(); return r; };
  const no = (reason) => say({ ok: false, reason });
  try {
    if ( !name ) return no("noBeat");
    if ( !canvas?.ready || !canvas.scene ) return no("noScene");
    if ( killed() ) return no("off");
    if ( name === "close" ) {
      if ( coming.get(key) ) return say({ ok: true, played: "none" });                              // (a result of this exchange is on its way to the screen)
      if ( rest && rest.key === key && !act ) { shotEnd(); return say({ ok: true, played: "back" }); }
      return say({ ok: true, played: "none" });
    }
    const joins = () => !!key && !!act && !act.done && act.key === key && act.phase !== "back";
    const join = () => { if ( AC.RANK[name] > AC.RANK[act.beat] ) act.up(name); return say({ ok: true, played: "joined", lands: act.landed ? 0 : Math.max(0, Math.round((act.landAt ?? 0) - performance.now())) }); };
    if ( joins() ) return join();
    const gate = () => AC.shotGate({ out: st.out, turn: st.turn }, { follow: follow(), held: cameraHeld(), screen: !!Screen.owner && Screen.owner !== "action" && !homing, covered: !!freeRect().covered });
    let g = gate(); if ( g ) return no(g);
    const mine = ++shotSeq, { look, reduced } = takeLook();
    /* (a camera that waits at the pair for exactly this result is there already: the beat lands at once) */
    if ( !reduced && !(rest && rest.key === key && st.parked) ) {
      coming.set(key, (coming.get(key) ?? 0) + 1);
      try { await calm(); } finally { const n = (coming.get(key) ?? 1) - 1; if ( n > 0 ) coming.set(key, n); else coming.delete(key); }
      if ( mine !== shotSeq ) return no("replaced"); if ( !canvas?.ready ) return no("noScene"); if ( joins() ) return join(); g = gate(); if ( g ) return no(g);
    }
    const ids = (Array.isArray(spec.tokens) ? spec.tokens : []).map(idOf).filter(Boolean).slice(0, 12), pad = grid() * 0.5;
    const boxes = SC.frameSubjects(ids, (id) => { const t = seenTok(id); return t ? tokenBox(t, pad) : null; });
    if ( !boxes ) return no("unseen");
    if ( !boxes.length ) return no("noSubject");
    for ( const k of (Array.isArray(spec.zones) ? spec.zones : []).slice(0, 4) ) { const b = zoneBox(k); if ( b ) boxes.push(b); }
    const rect = freeRect(), v = viewNow(), S = stageSettings();
    const prev = act && !act.done ? act : null;
    const resting = !prev && !!rest && !!st.parked && !!st.home && SC.sameView(v, st.parked, 12);
    const home = prev?.home ?? (resting ? { ...st.home } : { x: v.x, y: v.y, scale: v.scale });
    const noZoom = reduced || name === "move" || zoomLocked();
    let cam = spec.still === true ? null : AC.shotCamera(boxes, v, rect, { base: home.scale, reduced: noZoom });
    /* a beat that would move the view needs the user's hand free; else it plays in place when there is something to see */
    const handFree = !handBusy() && performance.now() - st.ownAt >= S.back * 1000;
    let quiet = spec.still === true;
    if ( cam && !handFree ) { cam = null; quiet = true; }
    if ( quiet && !resting && !prev && !AC.inSight(boxes[0], v, rect) ) return no("hand");
    const away = !!cam || resting || !!prev?.away;
    const planOf = (b) => AC.beatPlan(b, { bars: S.bars, away, still: quiet, reduced });
    const plan = planOf(name);
    if ( !cam && !away && !plan.bars && !plan.impact ) return say({ ok: true, played: "place", lands: 0 });      // it is on screen as it stands: nothing to add
    /* the beat takes the screen */
    if ( prev ) cleanup(prev);
    dropRest(); clearTimeout(lingerT); lingerT = 0; beginSeq++;
    const c = combatHere();
    st.combat ??= c?.id ?? "frame";
    if ( c && st.turn === null ) st.turn = turnKey(c);
    if ( !Screen.begin({ r: look }, { owner: "action", guard: false, frame: false, home: away ? { ...home } : null, barsLater: true, opts: { noCamera: !away, allow: ["camera"] } }) ) return no("error");
    st.home = away ? { ...home } : null;
    st.parked = away ? (cam ? { x: cam.x, y: cam.y, scale: cam.scale } : { x: v.x, y: v.y, scale: v.scale }) : null;
    holds.add("action");
    const a = act = { key, beat: name, plan, home, away, phase: "go", timers: [], done: false, landed: false, focus: boxes[0] };
    const live = () => act === a && !a.done && a.phase !== "back";
    const guard = (fn) => () => { if ( !live() ) return; if ( Screen.owner !== "action" ) { leave(a, "lost"); return; } try { fn(); } catch ( err ) { console.error(`${MODULE_ID} | shot`, err); leave(a, "scene"); } };
    const at = (ms, fn) => a.timers.push(setTimeout(guard(fn), Math.max(0, ms)));
    const lim = [CONFIG.Canvas?.minZoom ?? 0.1, CONFIG.Canvas?.maxZoom ?? 3];
    const walker = name === "move" ? ids[0] : null;
    const land = () => {
      const p = a.plan, f = a.focus;
      a.landed = true; a.phase = "hold";
      if ( p.bars ) Screen.revealBars?.();
      if ( p.impact ) Screen.impact({ x: (f.x0 + f.x1) / 2, y: (f.y0 + f.y1) / 2, size: p.impact > 1 ? 1e6 : 0 });
      if ( p.push && !zoomLocked() ) { const q = AC.pushCamera(f, viewNow(), lim); if ( q ) Screen.panTo({ ...q, duration: Math.round(p.hold * 0.85) }); }
      clearTimeout(a.endT);
      if ( p.follow && walker ) {
        // somebody walks: the frame is kept on the token until it stands (a calm re-frame when it nears the edge), 8 s at most
        let stood = 0; const t0 = performance.now();
        clearInterval(a.walk);
        a.walk = setInterval(guard(() => {
          const t = seenTok(walker), moving = !!t && !!t.animationContexts?.has?.(t.movementAnimationName);
          if ( t && a.away ) {
            const o = t.center, half = Math.max(t.w ?? grid(), t.h ?? grid()) / 2 + pad, b = { x0: o.x - half, y0: o.y - half, x1: o.x + half, y1: o.y + half }, vv = viewNow();
            if ( !SC.comfortable(b, vv, freeRect(), 0.1) ) { const to = SC.ownHome(vv, b, freeRect(), vv, 0.22); Screen.panTo({ x: to.x, y: to.y, scale: vv.scale, duration: 420 }); }
          }
          stood = moving ? 0 : stood + 1;
          if ( !t || stood >= 3 || performance.now() - t0 > 8000 ) { clearInterval(a.walk); a.endT = setTimeout(guard(() => leave(a, "done")), p.hold); }
        }), 160);
      } else a.endT = setTimeout(guard(() => leave(a, "done")), p.hold);
    };
    a.up = (b) => { a.beat = b; a.plan = planOf(b); if ( a.landed ) land(); };
    if ( cam ) Screen.panTo({ x: cam.x, y: cam.y, scale: cam.scale, duration: cam.ms });
    if ( name === "open" && plan.bars ) at((cam?.ms ?? 0) * 0.6, () => Screen.revealBars?.());
    const landMs = cam ? Math.round(cam.ms * 0.92) : AC.TIMES.inPlace;
    a.landAt = performance.now() + landMs;                                                      // U125 (e): the caller is told when the blow lands (`lands`)
    at(landMs, land);
    if ( away ) {
      // the user: Esc or a click on the map cuts the shot (the view goes home, nothing more this turn); the wheel or a drag takes the
      // camera (it stays where the user puts it). The input is never swallowed, as in the director's own take-overs.
      a.onKey = (ev) => { if ( ev.key !== "Escape" || !live() || typing(ev) ) return; leave(a, "cut"); if ( !escTaken() ) { ev.preventDefault(); ev.stopImmediatePropagation(); } };
      a.onPtr = (ev) => {
        if ( a.done || ev.target !== document.getElementById("board") ) return;
        if ( a.phase === "back" ) { a.tookBack = true; Screen.stopCamera("player"); return; }
        if ( ev.type === "wheel" || ev.button !== 0 ) { leave(a, "taken"); return; }
        a.press = { x: ev.clientX, y: ev.clientY, t: performance.now() };
        Screen.stopCamera("player");                                                            // (frozen under the pointer)
      };
      a.onUp = (ev) => {
        const p = a.press; if ( a.done || !p || ev.button !== 0 || a.phase === "back" ) return;
        a.press = null;
        const click = Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < 6 && performance.now() - p.t < 450;
        if ( !click ) { leave(a, "taken"); return; }
        const to = { ...a.home };
        leave(a, "cut");
        homing = true; const seq = beginSeq;                                                     // (the way home is the stage's, not the user's hand)
        Promise.resolve(canvas.animatePan({ ...to, duration: AC.TIMES.cut })).catch(() => {}).finally(() => { if ( seq === beginSeq ) homing = false; sync(); });
      };
      window.addEventListener("keydown", a.onKey, true);
      window.addEventListener("pointerdown", a.onPtr, true);
      window.addEventListener("pointerup", a.onUp, true);
      window.addEventListener("wheel", a.onPtr, { capture: true, passive: true });
    }
    sync();
    return say({ ok: true, played: cam ? "take" : "place", lands: landMs });
  } catch ( err ) { console.error(`${MODULE_ID} | shot`, err); return no("error"); }
}

/** Resolves once two animation frames in a row came evenly (under CALM_FRAME ms apart), or after CALM_MS. */
const CALM_MS = 700, CALM_FRAME = 50;
function calm() {
  return new Promise((res) => {
    const t0 = performance.now(); let last = t0, even = 0, done = false;
    const end = () => { if ( !done ) { done = true; clearTimeout(tm); res(); } };
    const tm = setTimeout(end, CALM_MS + 300);                                    // (a hidden tab draws no frames)
    const step = () => { if ( done ) return; const now = performance.now(); even = now - last < CALM_FRAME ? even + 1 : 0; last = now; if ( even >= 2 || now - t0 > CALM_MS ) end(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
/** The view to `to` in a calm move that the user's wheel / click / key stops; no motion for a user who asked for reduced motion. -> arrived */
async function glideTo(to, ms) {
  if ( clientOpts().reduced ) { canvas.pan({ ...to }); return true; }
  const look = { fx: true, camOn: true, camMode: "frame", lbOn: false, vgOn: false, shOn: false, flOn: false, smOn: false, camEase: 0.85 };
  if ( !Screen.begin({ r: look }, { owner: "stage", guard: true, frame: false, home: { x: to.x, y: to.y, scale: to.scale }, opts: { noCamera: false, allow: ["camera"] } }) ) return false;
  glides++; homing = true; sync();
  try { await Screen.end({ backMs: ms, hold: 0 }); } finally { if ( --glides <= 0 ) { glides = 0; homing = false; } }   // (a newer frame may have taken the move over)
  return SC.sameView(viewNow(), to, 12);
}

/** The stage is over here (the combat ended, the director or the stage was switched off): home if the camera is parked away. */
function endStage() {
  shotEnd();                                                              // (a shot always gives the view back, also in a driven fight)
  if ( beat ) { pendingHome = { to: st.home ? { ...st.home } : null, force: true }; }
  const go = SC.stageEnd(st);
  claimed.clear();
  clearTimeout(lingerT); lingerT = 0;
  if ( go && !beat && !driver ) afterScreen(() => goHome(go.to));       // (a driven fight never sends the view back by itself)
  sync();
}

function onUpdateCombat(combat, changed) {
  if ( !changed || !("turn" in changed || "round" in changed || "started" in changed) ) return;
  if ( st.combat === combat.id && !combat.started ) { endStage(); return; }
  if ( driver ) {
    // a driven fight: the caller frames the turn; here only the turn is kept (a "My view" asked for holds for the rest of that turn)
    if ( combat === combatHere() ) { const key = turnKey(combat); if ( key !== st.turn ) { st.combat = combat.id; SC.turnChange(st, key, false, false); } }
    return;
  }
  if ( !on() || combat !== combatHere() ) return;
  if ( st.combat !== combat.id ) { if ( st.combat ) endStage(); st.combat = combat.id; }
  const key = turnKey(combat);
  if ( key === st.turn ) return;
  const own = ownTurn(combat), turned = SC.turnChange(st, key, own, !!beat && !beat.own), fw = stageFollow();
  if ( fw !== "all" ) {
    // the player's switch: the view is theirs. On their own turn it moves only when their token is off screen ("turn"), by the least
    // that brings it in; it never goes back to an earlier view by itself
    if ( own && fw === "turn" ) {
      const t = seenTok(combat.combatant?.tokenId), v = viewNow(), rect = stageRect();
      if ( t && !SC.comfortable(tokenBox(t, 0), v, rect, 0) ) { const to = SC.ownHome(v, tokenBox(t, grid() * 0.5), rect, v, 0.12); if ( beat ) pendingHome = { to, force: true }; else afterScreen(() => goHome(to)); st.home = { ...to }; }
    }
    if ( own || fw === "off" ) st.parked = null;
  }
  else if ( turned?.home ) {
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
  if ( act ) leave(act, "scene");
  dropRest();
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
let chip = null, keyOn = false, chipTick = null;
/**
 * Bottom centre of the free stage: above whatever is declared at the bottom (an action dock), never on it. Then (zones-api 41) clear
 * of what another module asked the map's floating things to keep clear of (uiAvoid: a banner at the bottom centre, a panel), of the
 * labels the map draws on the board (a target's pill, a zone's warning) and of Foundry's movement ruler: the first free spot along
 * the bottom of the stage, a row or two higher, else the top centre (room.mjs chipSpot).
 */
function chipAvoid() {
  const out = [];
  try {
    const z = globalThis.game?.modules?.get?.("moinen-maps")?.api?.zones;
    out.push(...(z?.uiAvoids?.() ?? []), ...(z?.mapLabels?.() ?? []));
  } catch { /* no zones API: the stage's own bottom centre */ }
  try { for ( const e of document.querySelectorAll("#measurement > *, #measurement .waypoint-label") ) { const r = e.getBoundingClientRect(); if ( r.width > 0 && r.height > 0 ) out.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }); } } catch { /* */ }
  return out;
}
function placeChip() {
  if ( !chip ) return;
  const r = stageRect(), box = chip.getBoundingClientRect?.(), w = box?.width || 150, h = box?.height || 24;
  const s = chipSpot(r, w, h, chipAvoid());
  chip.style.left = `${Math.round(s.x + w / 2)}px`; chip.style.top = `${Math.round(s.y)}px`;
}
function showChip() {
  if ( chip?.isConnected ) { placeChip(); return; }
  if ( !document.querySelector("style[data-mm-dst]") ) { const s = document.createElement("style"); s.textContent = CSS; s.dataset.mmDst = ""; document.head.appendChild(s); }
  const r = stageRect();
  chip = document.createElement("div");
  chip.className = "mm-dst-chip"; chip.dataset.mmDst = ""; chip.setAttribute("role", "button");
  chip.innerHTML = `<i class="fa-solid fa-house" inert></i><span>${esc(T("DirStage.chip"))}</span><kbd>Esc</kbd>`;
  chip.addEventListener("pointerdown", (ev) => { ev.preventDefault(); ev.stopPropagation(); backHome(); });
  document.body.appendChild(chip);
  placeChip();
  restyle(chip); chip.classList.add("is-in");
  // a declared bar may grow under the chip while it shows (an action dock that opens): it is placed again a few times a second, only
  // while it is on screen (the stage stays hooks-only when the camera is not parked away)
  clearInterval(chipTick); chipTick = setInterval(placeChip, 300);
}
function hideChip() { const c = chip; chip = null; c?.remove(); clearInterval(chipTick); chipTick = null; }
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
function backHome() { if ( cameraHeld() ) { sync(); return; } dropRest(); st.out = st.turn; goHome(st.home); }
/** The parked-state UI follows the state: the chip and the Esc listener only while the camera is parked away and nothing plays. */
let resync = 0;
function sync() {
  const want = !!st.parked && !!st.home && !beat && !homing && (on() || (!!driver && !killed())) && !cameraHeld(), parked = want && !Screen.owner;
  clearTimeout(resync); resync = 0;
  if ( want && !parked ) resync = setTimeout(sync, 150);        // (the beat's bars are still sliding out: once the screen is free)
  if ( parked ) { showChip(); if ( !keyOn ) { window.addEventListener("keydown", onKey, true); keyOn = true; } }
  else { hideChip(); if ( keyOn ) { window.removeEventListener("keydown", onKey, true); keyOn = false; } }
  tell();
}

/* ---------------------------------------------------------------- settings + the panel */

function registerSettings() {
  game.settings.register(MODULE_ID, KEY, { scope: "world", config: false, type: Object, default: { ...SC.STAGE_DEFAULTS }, onChange: () => { setCache = null; if ( !stageSettings().on ) endStage(); } });
  game.settings.register(MODULE_ID, FOLLOW_KEY, {
    name: T("DirStage.follow"), hint: T("DirStage.followHint"), scope: "client", config: true, type: String, default: "auto",
    choices: Object.fromEntries(FOLLOW.map((v) => [v, T(`DirStage.follow_${v}`)])), onChange: () => { if ( follow() === "off" ) { st.parked = null; } sync(); }
  });
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
  return { on: on(), combat: st.combat, turn: st.turn, home: st.home, parked: st.parked, out: st.out, beat: beat?.id ?? null, homing, chip: !!chip, follow: follow(), driver,
    shot: act && !act.done ? { key: act.key, beat: act.beat, phase: act.phase, away: act.away } : null, rest: rest?.key ?? null };
}
Hooks.once("init", registerSettings);
Hooks.once("ready", () => {
  registerStager(styleOf);
  registerVeto(vetoShot);
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

export const stageSource = { settings: stageSettings, status, camera, follow, frame, shot, shotEnd, home: () => backHome(), _debug: () => ({ st: { ...st }, trace: trace.slice(), frames: frames.slice(), shots: shots.slice(), beat, pendingHome, homing, claimed: [...claimed.keys()] }) };
moduleApi.directorStage = stageSource;
