/**
 * A STAND-IN LEADER's shots (pure; node-testable: dev/director-fix2.test.mjs).
 *
 * When no GM views the players' scene (or the GM tab is hidden), a PLAYER's client leads: it plans the shots of the module's own sources
 * (turns, moves, attacks, damage, destruction, zones, orbit ...) for the whole table. A shot record from that client is not trusted the
 * way a GM's is: a macro on it could send anything. Every receiving client therefore plays a stand-in's shot only in the form a GM-less
 * table needs, and never more:
 *  - nothing while the GM's pause is on, nothing GM-only, nothing scheduled far ahead;
 *  - the timing of an ordinary shot (lead / back / length within the settings, a take-over at most maxShot);
 *  - captions only from the director's own strings (a free text, or a foreign key, is never a take-over: soft at most, and short);
 *  - a lane only when it names a combat / a token of this scene;
 *  - the pace of the queue: at most 10 shots in 10 s, and take-overs outside a combat lane at most 3 in 10 s and `rest` apart.
 */

const CAP_KEY = /^(Dir|DirMove|DirStage)\.[A-Za-z0-9_.]+$/;
const KEYS_OK = new Set(["key", "data", "kick"]);
const STR_MAX = 60, TEXT_MAX = 80;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** A caption from a stand-in: a director key with plain short data, or a short text (`free`: true). null when unusable. */
export function cleanCaption(c) {
  if ( c === null || c === undefined || c === false ) return { c: null, free: false };
  if ( typeof c === "string" ) return { c: c.slice(0, TEXT_MAX), free: true };
  if ( typeof c !== "object" || typeof c.key !== "string" || !CAP_KEY.test(c.key) ) return { c: null, free: true };
  if ( Object.keys(c).some((k) => !KEYS_OK.has(k)) ) return { c: null, free: true };
  if ( c.kick !== undefined && (typeof c.kick !== "string" || !CAP_KEY.test(c.kick)) ) return { c: null, free: true };
  const data = {};
  for ( const [k, v] of Object.entries(c.data && typeof c.data === "object" ? c.data : {}).slice(0, 12) ) {
    if ( typeof v === "string" ) data[k] = v.slice(0, STR_MAX);
    else if ( typeof v === "number" && Number.isFinite(v) ) data[k] = v;
    else if ( typeof v === "boolean" ) data[k] = v;
  }
  return { c: { key: c.key, data, ...(c.kick ? { kick: c.kick } : {}) }, free: false };
}

/**
 * The shot as this client plays it when a stand-in (non-GM) leader sent it, or null (not at all).
 * ctx = { now (shared ms), paused (the GM's pause), r (the director's resolved settings), lanes (Set of valid lane ids), log (this
 * client's record of the stand-in's shots: [{ t, take, lane }], kept by the caller; this function appends) }.
 */
export function standInShot(shot, { now, paused, r, lanes = new Set(), log = [] }) {
  if ( !shot || typeof shot !== "object" ) return null;
  if ( paused ) return null;
  if ( shot.who !== "all" ) return null;                                       // (a GM-only shot is never a stand-in's business)
  if ( !Number.isFinite(shot.t0) || shot.t0 > now + 3000 ) return null;      // (not planned far ahead: the leader sends ~SLACK before the start)
  while ( log.length && now - log[0].t > 10000 ) log.shift();
  if ( log.length >= 10 ) return null;
  const s = { ...shot, force: false };
  const lead = clamp(Number(s.lead) || 0, 200, 3000), back = clamp(Number(s.back) || 0, 200, 3000);
  s.lead = Math.round(lead); s.back = Math.round(back);
  // caption + the cued result: the director's own strings only
  const cap = cleanCaption(s.caption), aft = cleanCaption(s.after);
  s.caption = cap.c; s.after = aft.c;
  let take = s.form === "take";
  if ( cap.free || aft.free ) take = false;
  // a lane only when it names a started combat / a token of this scene (the combat stage and the move follow trust it)
  if ( s.lane && !lanes.has(s.lane) ) { s.lane = null; s.free = false; }
  if ( take && !s.lane ) {
    const takes = log.filter((e) => e.take && !e.lane);
    if ( takes.length >= 3 || (takes.length && now - takes[takes.length - 1].t < Math.max(0, r?.rest ?? 0)) ) take = false;
  }
  if ( take ) {
    s.form = "take";
    s.len = Math.round(clamp(Number(s.len) || 0, lead + back + 300, Math.max(lead + back + 300, r?.maxShot ?? 6500)));
    s.hold = s.len - s.lead - s.back;
    s.impact = Number.isFinite(s.impact) && s.impact >= 0 ? Math.round(Math.min(s.impact, s.len)) : -1;
  } else {
    s.form = "soft";
    s.len = Math.round(clamp(Number(s.len) || 0, 400, Math.max(1000, (r?.softMs ?? 3600) * 1.5)));
    s.hold = s.len; s.impact = -1;
  }
  if ( !Number.isFinite(s.weight) ) s.weight = 0.5;
  s.weight = clamp(s.weight, 0, 0.85);
  log.push({ t: now, take: s.form === "take", lane: s.lane ?? null });
  return s;
}
