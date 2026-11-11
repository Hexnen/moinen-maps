import { MODULE_ID } from "../config.mjs";
import { emit, isLeader, killed, isOn, publicName, registerCue } from "./director.mjs";
import { audience, rollFacts, rollEvent, damageFacts, damageEvent, isDamageFlavor } from "./rolls-core.mjs";

/**
 * ROLLS AND DAMAGE of the Invincible system, a source of the director (spec section 3: an attacker -> target shot, captions with the
 * result). Pure parts: rolls-core.mjs.
 *
 *  - The roller's client (preCreateChatMessage) writes who rolled at whom into the roll's message: flags.moinen-maps.dr = { a: the
 *    attacker's token, t: the targeted tokens } (the targets exist only on the roller's client; a pushed roll, a new message, keeps the
 *    targets of the roll it pushes when nothing is targeted now).
 *  - The LEADER (createChatMessage) turns a Year Zero roll into an event: an ATTACK (the roll carries damage or an attack type) frames the
 *    attacker and the target(s), any other roll is a small "roll" event (soft at most). It is CUED ("dice"): on each client the hit
 *    (flash, shake: not on a miss) and the result caption wait until that client's Dice So Nice dice have landed, so nobody reads the
 *    result before the dice show it; until then the caption is "attacker -> target". The comic splash of Invincible Plus Ultra pops at
 *    the token after the dice too: the camera is already there, and holds on the result while it plays.
 *  - A "Damage Taken" card (the GM applies the damage) is a DAMAGE event on the target: "-3 Health", broken, a critical injury.
 *
 * Privacy: the event follows the MESSAGE: a public roll is for everyone; a roll whispered to the GM or blind is GM-only (it never goes
 * to a player); a self roll or one whispered to players only makes nothing. Hidden tokens never go into a public event (a hidden
 * attacker is "someone", a hidden target is left out), names travel only when every player may read them, and every shot is STRICT:
 * a player sees it only when its focus token is visible to them (vision, detection), and gets the soft form at that token when another
 * one (the attacker in the dark) is not.
 */

const SYSTEM = "invincible";
const FLAG = "dr";
const live = () => !killed() && isOn() && canvas?.ready && game.system?.id === SYSTEM && isLeader();
const grid = () => canvas?.dimensions?.size ?? 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DSN_MAX = 9000;                    // ms: the dice of a roll never hold a shot's result longer than this

function tokenBox(d) { const g = grid(), w = (d.width ?? 1) * g, h = (d.height ?? 1) * g; return { x0: d.x, y0: d.y, x1: d.x + w, y1: d.y + h }; }
const onScene = (id) => (id ? canvas.scene?.tokens?.get(id) ?? null : null);

/* ---------------------------------------------------------------- the roller's client: who at whom */

const lastTargets = new Map();           // speaker actor id -> { a, t, at } (a push keeps the targets of the roll it pushes)
function attackerOf(speaker, actor) {
  const sc = canvas.scene;
  if ( !sc || (speaker?.scene && speaker.scene !== sc.id) ) return null;
  if ( speaker?.token && sc.tokens.get(speaker.token) ) return speaker.token;
  const mine = canvas.tokens?.controlled?.find((t) => t.actor && actor && t.actor.id === actor.id);
  if ( mine ) return mine.id;
  return actor?.getActiveTokens?.(false, true)?.find((d) => d.parent === sc)?.id ?? null;
}
function onPreCreate(message) {
  try {
    if ( killed() || !isOn() || game.system?.id !== SYSTEM || !canvas?.ready ) return;
    const roll = message.rolls?.[0], f = rollFacts(roll);
    if ( !f ) return;
    const actor = message.speakerActor ?? null;
    const a = attackerOf(message.speaker, actor);
    let t = [...(game.user.targets ?? [])].filter((tk) => tk.document?.parent === canvas.scene && tk.id !== a).map((tk) => tk.id).slice(0, 8);
    const prev = actor ? lastTargets.get(actor.id) : null;
    if ( !t.length && f.pushed && prev && Date.now() - prev.at < 180000 ) t = prev.t;
    message.updateSource({ [`flags.${MODULE_ID}.${FLAG}`]: { a, t, s: canvas.scene.id } });
  } catch ( err ) { console.warn(`${MODULE_ID} | director rolls (preCreate)`, err); }
}

/* ---------------------------------------------------------------- the leader: events */

function onCreate(message) {
  try {
    const f0 = message.flags?.[MODULE_ID]?.[FLAG];
    if ( f0 && message.speakerActor ) lastTargets.set(message.speakerActor.id, { ...f0, at: Date.now() });
    if ( !live() ) return;
    const sc = canvas.scene;
    if ( message.speaker?.scene && message.speaker.scene !== sc.id ) return;
    const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
    const who = audience({ whisper: message.whisper, blind: message.blind, gmIds });
    if ( !who ) return;
    const pub = (d) => d && (who === "gm" || !d.hidden);
    const ref = (d) => ({ id: d.id, name: publicName(d), box: tokenBox(d) });

    const f = rollFacts(message.rolls?.[0]);
    if ( f ) {
      const fl = f0 && typeof f0 === "object" && (!f0.s || f0.s === sc.id) ? f0 : {};
      const aDoc = onScene(typeof fl.a === "string" ? fl.a : attackerOf(message.speaker, message.speakerActor));
      const tDocs = (Array.isArray(fl.t) ? fl.t : []).map(onScene).filter((d) => pub(d) && d !== aDoc);
      const attacker = pub(aDoc) ? ref(aDoc) : null;
      const ev = rollEvent(f, { id: `r-${message.id}`, who, attacker, targets: tDocs.map(ref), what: message.flavor, grid: grid() });
      if ( ev ) { withMsg(ev, message.id); emit({ ...ev, ref: message.id, who: ev.who, ...combatLane(ev, aDoc) }); }
      return;
    }
    if ( isDamageCard(message) ) {
      const actor = message.speakerActor;
      const d = onScene(message.speaker?.token) ?? actor?.getActiveTokens?.(false, true)?.find((x) => x.parent === sc) ?? null;
      if ( !pub(d) ) return;
      const ev = damageEvent(damageFacts(message.content, message.flags?.["invincible-plus-ultra"]?.dmg), { id: `g-${message.id}`, who, t: ref(d), grid: grid() });
      if ( ev ) { withMsg(ev, message.id); emit(ev); }
    }
  } catch ( err ) { console.warn(`${MODULE_ID} | director rolls`, err); }
}
/**
 * An ATTACK by the active combatant joins its combat's lane (source-move: `cbt-<combat id>`, free): it carries on from the turn / move
 * take-over still on screen (no return in between) and is not turned soft by the rest after that shot (the source paces itself).
 * The lane's next turn or move waits for the attack's dice (core Queue: a cued take-over is never relayed).
 */
function combatLane(ev, aDoc) {
  if ( ev.kind !== "attack" || !aDoc ) return {};
  const c = game.combats?.viewed ?? game.combat;
  if ( !c?.started || (c.scene && c.scene.id !== canvas.scene?.id) || c.combatant?.tokenId !== aDoc.id ) return {};
  return { lane: `cbt-${c.id}`, free: true };
}
/** The chat message's id into the caption data: each client names the speaker as its own chat card shows it (director tokenName). */
function withMsg(ev, id) { for ( const c of [ev.caption, ev.after] ) if ( c?.data && typeof c.data === "object" ) c.data.msg = id; }
function isDamageCard(message) {
  const fl = String(message.flavor ?? "").trim();
  if ( !fl ) return false;
  if ( message.flags?.["invincible-plus-ultra"]?.dmg ) return true;
  return isDamageFlavor(fl, game.i18n.localize("INVINCIBLE.Chat.DamageInfo.DamageTaken"));
}

/* ---------------------------------------------------------------- every client: the cue */

/**
 * Invincible Plus Ultra announces this roll's result on this client itself (its comic splash at the token + the chat card): then the
 * director keeps its setup line ("Attacker -> Target") and frames the moment, and does not print the result a second time.
 */
function announcedHere(id) {
  if ( !game.modules.get("invincible-plus-ultra")?.active ) return false;
  const get = (k) => { try { return game.settings.get("invincible-plus-ultra", k); } catch { return undefined; } };
  const m = id ? game.messages?.get(id) : null;
  if ( !m || get("splashEnabled") === false || m.visible === false ) return false;
  return (m.author?.id ?? m.user?.id) === game.user.id || get("splashOthers") !== false;
}
/** "dice": resolves when this client's 3D dice of the roll (shot.ref = the message id) have landed (at once without Dice So Nice). */
async function diceCue(shot) {
  const miss = shot.after?.key === "Dir.cap.miss";
  const id = shot.ref, d3 = game.dice3d;
  if ( id && d3?.waitFor3DAnimationByMessageID ) {
    try { await Promise.race([d3.waitFor3DAnimationByMessageID(id), sleep(DSN_MAX)]); } catch { /* (the result shows anyway) */ }
  }
  return { impact: !miss, quiet: announcedHere(id) };
}

export function registerRollsSource() {
  registerCue("dice", diceCue);
  Hooks.on("preCreateChatMessage", onPreCreate);
  Hooks.on("createChatMessage", onCreate);
}
export const _rolls = { lastTargets };
