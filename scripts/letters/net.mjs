/* LETR tools: the networking helper. One call plays the same word on every client, in step:

     L.net.play("KRAK!", { mood: "crack", space: "world", at: token })      // -> the local Handle; every other client plays it too
     L.net.burst([{ text: "ŁUP!", at: a }, { text: "TRZASK!", at: b }], { mood: "crash", space: "world" })
     L.net.stream({ text: "RA-TA-TA", space: "world", at: tokenA, to: tokenB, every: 90, duration: 1800 })
     L.net.stop(h.netId)                                                     // a loop word, everywhere

   - the same look everywhere: a seed is made once (`net:<id>`) unless you give one;
   - in step: the start is stamped on a SHARED clock (Foundry's game.time.serverTime: the server's clock, kept in sync by Foundry's
     own ping on every client); each client turns it into its own `delay` (still ahead) or `startAt` (already running: joins
     part-way). performance.now() is per page and must never cross the wire (BUGH F6). `lead` (default 120 ms) starts everyone,
     the sender included, a little later so nobody joins late;
   - only what can travel is sent: tokens become their ids (and are looked up again on each client: a word for a token on another
     scene is skipped there), functions and Promises (`at` as a function, `until`, `parent`) are refused with one warning;
     `reduced` never travels (each client follows its own motion setting);
   - a world word goes only to clients viewing the same scene.
   - GM only (user ruling, TOOL-8): only a GM sends. On a player's client `L.net.play / burst / stream` refuse quietly (one console
     line, no throw) and return a handle that is already over (`refused: "gm-only"`), `burst` returns []; every receiving client
     also drops a message whose sender is not a GM user, so a modified client cannot push words to the table.
   Own sockets: `L.net.sharedNow()` is the shared clock, `L.net.local(sharedT)` -> { delay } | { startAt } for L.play. */

export const OP_KEYS = ["mood", "sound", "space", "at", "size", "magnitude", "area", "span", "token", "scale", "fit", "maxWidth", "anchor", "from",
  "seed", "hold", "tempo", "rotation", "colors", "palette", "style", "font", "hand", "avoid", "layer", "zIndex", "loop", "in", "out", "holdKind",
  "pixel", "alt", "dir", "delay", "vision", "elevation", "kind", "vocabMotion", "flash"];   // MOTION2: the kind picks the invincible motion; FIN-ENGINE: flash: false (a caller's impact on the contact)
export const STREAM_KEYS = ["text", "syllables", "to", "every", "beats", "count", "duration", "life", "travel", "spread", "loud", "swing", "manual"];
export const MAX_TEXT = 160;

const isDoc = (a) => a && typeof a === "object" && (a.documentName === "Token" || a.document?.documentName === "Token");
/* a value that can travel: tokens -> { token: id }, points / numbers / strings / plain data as they are; functions -> undefined */
export function wireValue(v, key, warn) {
  if ( v == null ) return v;
  if ( typeof v === "function" || typeof v?.then === "function" ) { warn?.(key); return undefined; }
  if ( isDoc(v) ) return { token: v.document?.id ?? v.id };
  if ( typeof v === "object" && !Array.isArray(v) && v.object && v.documentName ) return { token: v.id };
  if ( typeof v === "number" || typeof v === "string" || typeof v === "boolean" ) return v;
  if ( Array.isArray(v) ) return v.map((x) => wireValue(x, key, warn));
  if ( typeof v === "object" ) {
    if ( Number.isFinite(v.x) && Number.isFinite(v.y) && Object.keys(v).every((k) => k === "x" || k === "y") ) return { x: v.x, y: v.y };
    try { return JSON.parse(JSON.stringify(v)); } catch { warn?.(key); return undefined; }
  }
  return undefined;
}
/* the options of one call as they travel */
export function wireOpts(opts = {}, keys = OP_KEYS, warn) {
  const o = {};
  for ( const k of keys ) if ( opts[k] !== undefined ) { const v = wireValue(opts[k], k, warn); if ( v !== undefined ) o[k] = v; }
  for ( const k of ["until", "parent"] ) if ( opts[k] != null ) warn?.(k);
  if ( typeof opts.at === "function" ) warn?.("at");
  if ( typeof opts.loud === "function" && keys.includes("loud") ) delete o.loud;
  return o;
}
/* back on a client: { token: id } -> that client's token (or null when it is not on its scene) */
export function unwire(o, findToken) {
  const back = (v) => {
    if ( v && typeof v === "object" && !Array.isArray(v) && typeof v.token === "string" && Object.keys(v).length === 1 ) return findToken(v.token) ?? null;
    if ( Array.isArray(v) ) return v.map(back);
    return v;
  };
  const r = {};
  for ( const [k, v] of Object.entries(o ?? {}) ) r[k] = back(v);
  return r;
}
/* the options name a token this client does not have (another scene): the word is skipped */
export const missingToken = (wire, back) => ["at", "token", "to", "area"].some((k) => wire[k]?.token && !back[k]);

/* the shared moment `sharedT` as this client's start: still ahead -> { delay }, already running -> { startAt } (performance clock) */
export function localStart(sharedT, sharedNowMs, perfNowMs) {
  const d = sharedT - sharedNowMs;
  return d >= 0 ? { delay: d } : { startAt: perfNowMs + d };
}

/* a short random id */
export const netId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;

/* a message is sound: known op, text limits, plain options; returns a cleaned copy or null */
export function checkMsg(m) {
  if ( !m || typeof m !== "object" || m.t !== "letr" || typeof m.id !== "string" || m.id.length > 64 ) return null;
  if ( !["play", "burst", "stream", "stop"].includes(m.op) ) return null;
  if ( m.op !== "stop" && !Number.isFinite(m.at) ) return null;
  const txt = (s) => String(s ?? "").slice(0, MAX_TEXT);
  if ( m.op === "play" ) return { ...m, text: txt(m.text), opts: m.opts && typeof m.opts === "object" ? m.opts : {} };
  if ( m.op === "burst" ) {
    if ( !Array.isArray(m.items) || m.items.length > 24 ) return null;
    return { ...m, items: m.items.map((it) => ({ ...(it && typeof it === "object" ? it : {}), text: txt(it?.text) })), common: m.common && typeof m.common === "object" ? m.common : {} };
  }
  if ( m.op === "stream" ) return { ...m, opts: { ...(m.opts ?? {}), text: m.opts?.text != null ? txt(m.opts.text) : undefined } };
  return m;
}

/* senders over their rate: at most `n` messages per second each (a runaway macro does not flood every client) */
export function rateGate(n = 30) {
  const seen = new Map();
  return (who, t) => {
    const a = (seen.get(who) ?? []).filter((x) => t - x < 1000);
    if ( a.length >= n ) { seen.set(who, a); return false; }
    a.push(t); seen.set(who, a); return true;
  };
}

/* GM only (TOOL-8): a message counts only when its sender is a GM user of this world (`getUser(id)` -> the User or undefined) */
export const senderIsGM = (senderId, getUser) => typeof senderId === "string" && senderId.length > 0 && !!getUser?.(senderId)?.isGM;

/* what a refused send returns: a handle that is already over, shaped like the engine's (play) or a stream's */
export function refusedHandle(text, netId = null) {
  return { id: null, netId, text: String(text ?? ""), alive: false, off: true, refused: "gm-only", hand: null, isReady: false,
    ready: Promise.resolve(false), finished: Promise.resolve("evicted"), handles: [], stop() {}, moveTo() {}, setLoud() {} };
}
