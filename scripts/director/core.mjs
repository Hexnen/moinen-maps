/**
 * DIRECTOR, the pure parts (no Foundry, no PIXI; node-testable: dev/director.test.mjs).
 *
 * The director turns EVENTS (something happened on the map: kind, weight, place, tokens, caption) into SHOTS (what the players are shown):
 *   - a TAKE-OVER (big events): the player's camera is taken (letterbox, pan/zoom to the place, screen effects) and RETURNED afterwards;
 *   - a SOFT shot (small events, or when the player is busy / opted for soft): no camera move, a ping on the spot or an arrow on the
 *     screen edge pointing to it, plus a caption.
 * One client plans (the leader: the active GM), every client plays the same shot record at the same shared-clock moment and decides
 * for itself, from what IT may see, whether to show it as planned, softer, or not at all (decide()).
 */
export const VERSION = 1;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------------------------------------------------------- event kinds */

/**
 * Every kind the director knows: `pri` breaks ties between equal weights, `hold` the base time a take-over stays on the place (ms),
 * `impact` = the shot has a hit (flash + shake when the camera arrives), `group` the source toggle it belongs to.
 * `fresh` = news at a place just shown (damage after the attack, a pushed roll): never dropped as "just shown", soft at least.
 */
export const KINDS = Object.freeze({
  destruction: { pri: 5, hold: 1700, impact: true, group: "destruction", icon: "fa-solid fa-house-crack" },
  carry: { pri: 6, hold: 1600, impact: true, group: "destruction", icon: "fa-solid fa-hand-fist" },
  plough: { pri: 7, hold: 1900, impact: true, group: "destruction", icon: "fa-solid fa-person-falling-burst" },
  flood: { pri: 4, hold: 2000, impact: false, group: "destruction", icon: "fa-solid fa-water" },
  fire: { pri: 4, hold: 1500, impact: false, group: "fire", icon: "fa-solid fa-fire" },
  quake: { pri: 6, hold: 1300, impact: true, group: "zones", icon: "fa-solid fa-house-chimney-crack" },
  zoneState: { pri: 2, hold: 1200, impact: false, group: "zones", icon: "fa-solid fa-vector-square" },
  orbitUp: { pri: 8, hold: 1700, impact: true, group: "orbit", icon: "fa-solid fa-rocket" },
  orbitDown: { pri: 8, hold: 1700, impact: true, group: "orbit", icon: "fa-solid fa-meteor" },
  altitude: { pri: 3, hold: 1100, impact: false, group: "altitude", icon: "fa-solid fa-feather" },
  floor: { pri: 2, hold: 1100, impact: false, group: "altitude", icon: "fa-solid fa-stairs" },
  move: { pri: 3, hold: 1400, impact: false, group: null, icon: "fa-solid fa-person-running" },
  turn: { pri: 6, hold: 1500, impact: false, group: null, icon: "fa-solid fa-hourglass-half" },
  attack: { pri: 6, hold: 3200, impact: true, group: "attacks", icon: "fa-solid fa-burst", fresh: true },
  damage: { pri: 6, hold: 1600, impact: true, group: "attacks", icon: "fa-solid fa-heart-crack", fresh: true },
  roll: { pri: 2, hold: 2600, impact: false, group: "rolls", icon: "fa-solid fa-dice", fresh: true },
  cut: { pri: 9, hold: 1800, impact: false, group: null, icon: "fa-solid fa-video" },
  custom: { pri: 3, hold: 1500, impact: false, group: null, icon: "fa-solid fa-film" }
});
export const KIND_IDS = Object.keys(KINDS);
/** The source toggles of the settings (one per group of kinds). */
export const GROUPS = ["destruction", "fire", "zones", "orbit", "altitude", "attacks", "rolls"];
const kindOf = (k) => KINDS[k] ?? KINDS.custom;

/* ---------------------------------------------------------------- settings (world) */

/** Every numeric value: [default, lo, hi, unit]. */
export const NUM = {
  takeAt: [0.55, 0.05, 1, ""],         // weight from which an event takes the camera over
  softAt: [0.12, 0, 1, ""],            // weight from which an event is shown at all (as a soft shot)
  merge: [450, 0, 3000, "ms"],         // events this close in time (and place) become one shot
  mergeSq: [10, 1, 60, "sq"],          // ... this close in place (grid squares)
  cooldown: [7000, 0, 60000, "ms"],    // the same place is not taken over again within this time (soft at most)
  rest: [1800, 0, 20000, "ms"],        // the camera stays with the player at least this long between two take-overs (a heavier event may break it)
  stale: [5000, 500, 30000, "ms"],     // an event that waited longer than this is dropped
  maxShot: [6500, 2000, 20000, "ms"],  // a take-over never lasts longer than this
  lead: [850, 200, 3000, "ms"],        // the camera's way to the place
  back: [900, 200, 3000, "ms"],        // ... and back to the player's own view
  holdK: [1, 0.3, 3, "x"],             // scales every hold
  zoomIn: [1.6, 1, 3, "x"],            // at most this much closer than the player's own zoom
  softMs: [3600, 1000, 10000, "ms"]    // how long a soft shot stays
};
export const BOOLS = { enabled: true, captions: true, softOn: true, src_destruction: true, src_fire: true, src_zones: true, src_orbit: true, src_altitude: true, src_attacks: true, src_rolls: true };
export const STRS = { look: "epic" };   // the cinematic look preset of the take-overs (cinematic-core presets or a GM preset id)
export const KEYS = [...Object.keys(NUM), ...Object.keys(BOOLS), ...Object.keys(STRS)];
export const DEFAULTS = Object.freeze({ ...Object.fromEntries(Object.entries(NUM).map(([k, v]) => [k, v[0]])), ...BOOLS, ...STRS });

/** The shipped director presets (only what differs from DEFAULTS = "standard"). */
export const PRESETS = Object.freeze({
  calm: { takeAt: 0.8, softAt: 0.2, cooldown: 15000, rest: 6000, zoomIn: 1.25, holdK: 0.8, look: "subtle" },
  standard: {},
  dramatic: { takeAt: 0.4, softAt: 0.08, cooldown: 4000, rest: 900, zoomIn: 2, holdK: 1.25, lead: 750, look: "blockbuster" },
  documentary: { takeAt: 0.65, cooldown: 9000, rest: 3000, zoomIn: 1.3, holdK: 1.4, lead: 1300, back: 1300, look: "documentary" }
});
export const PRESET_IDS = ["calm", "standard", "dramatic", "documentary"];

export function cleanValue(k, v) {
  if ( k in NUM ) { const n = Number(v); return v === null || v === "" || typeof v === "boolean" || !Number.isFinite(n) ? undefined : clamp(n, NUM[k][1], NUM[k][2]); }
  if ( k in BOOLS ) return typeof v === "boolean" ? v : undefined;
  if ( k in STRS ) return typeof v === "string" && /^[\w-]{1,40}$/.test(v) ? v : undefined;
  return undefined;
}
export function cleanPartial(o) {
  const out = {};
  if ( o && typeof o === "object" ) for ( const k of Object.keys(o) ) { if ( !KEYS.includes(k) ) continue; const v = cleanValue(k, o[k]); if ( v !== undefined ) out[k] = v; }
  return out;
}
/** The stored block { v, preset, over } validated; unknown -> the standard preset. */
export function sanitize(c) {
  const out = { v: VERSION, preset: "standard", over: {} };
  if ( !c || typeof c !== "object" ) return out;
  if ( typeof c.preset === "string" && (PRESETS[c.preset] || c.preset === "custom") ) out.preset = c.preset;
  out.over = cleanPartial(c.over);
  return out;
}
/** defaults < preset < overrides; softAt never above takeAt. */
export function resolve(c) {
  const s = sanitize(c);
  const r = { ...DEFAULTS, ...(s.preset === "custom" ? {} : cleanPartial(PRESETS[s.preset])), ...s.over };
  if ( r.softAt > r.takeAt ) r.softAt = r.takeAt;
  return r;
}
/** Is a kind's source switched on? (cut / custom events have no toggle.) */
export const sourceOn = (r, kind) => { const g = kindOf(kind).group; return !g || r[`src_${g}`] !== false; };

/* ---------------------------------------------------------------- events */

// (null, "" and booleans are "missing", not 0: an event that crossed the socket as JSON has `dur: null` where the sender had none, and
// Number(null) === 0 would have cut every shot emitted on another client down to the minimum hold)
const num = (v) => (v === null || v === undefined || v === "" || typeof v === "boolean" ? NaN : Number.isFinite(Number(v)) ? Number(v) : NaN);
const boxOk = (b) => b && [b.x0, b.y0, b.x1, b.y1].every((v) => Number.isFinite(v)) && b.x1 >= b.x0 && b.y1 >= b.y0;
export const boxCentre = (b) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
export const unionBox = (a, b) => (!a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
export const pointBox = (x, y, r = 0) => ({ x0: x - r, y0: y - r, x1: x + r, y1: y + r });

/** A caption: a plain string, or { key, data, kick? } (kick: an optional key for the small line above, formatted with the same data). */
function normCaption(c) {
  if ( typeof c === "string" ) return c.slice(0, 160);
  if ( !c || typeof c !== "object" || typeof c.key !== "string" ) return null;
  const out = { key: c.key, data: c.data && typeof c.data === "object" ? c.data : {} };
  if ( typeof c.kick === "string" ) out.kick = c.kick;
  return out;
}

/**
 * An event as the queue takes it, validated: { id, kind, weight 0..1, box (scene px), x, y (its focus), tokens [ids], caption, who
 * ("all" | "gm"), t, src, force }. A place is required: a box, a point (x, y), or both. Null when unusable.
 * `caption` = a plain string, or { key, data } (localised on each client, so every player reads it in their own language).
 * A CUED event (`cue`: a name registered with the director's registerCue) has a moment each client finds for itself (a roll's dice
 * landing on THAT client): the hit and the `after` caption (the result) wait for it. `strict`: every token of `tokens` must be visible
 * to a client (the first one is the focus: when only another one is not, the client gets the soft form; when the focus is not, nothing).
 */
export function normEvent(e, now = 0) {
  if ( !e || typeof e !== "object" ) return null;
  const kind = KINDS[e.kind] ? e.kind : "custom";
  let box = boxOk(e.box) ? { x0: +e.box.x0, y0: +e.box.y0, x1: +e.box.x1, y1: +e.box.y1 } : null;
  let x = num(e.x), y = num(e.y);
  if ( !Number.isFinite(x) || !Number.isFinite(y) ) { if ( !box ) return null; ({ x, y } = boxCentre(box)); }
  if ( !box ) box = pointBox(x, y, 0);
  const w = num(e.weight);
  const caption = normCaption(e.caption);
  return {
    id: typeof e.id === "string" && e.id ? e.id.slice(0, 40) : `e${Math.round(now)}-${Math.floor(Math.random() * 1e6)}`,
    kind, weight: Number.isFinite(w) ? clamp(w, 0, 1) : 0.5, x, y, box,
    tokens: Array.isArray(e.tokens) ? e.tokens.filter((t) => typeof t === "string").slice(0, 16) : [],
    caption, who: e.who === "gm" ? "gm" : "all", t: Number.isFinite(num(e.t)) ? num(e.t) : now,
    src: typeof e.src === "string" ? e.src.slice(0, 40) : "api", force: !!e.force, scene: typeof e.scene === "string" ? e.scene : null,
    path: Array.isArray(e.path) ? e.path.filter(Number.isFinite).slice(0, 64) : null, dur: Number.isFinite(num(e.dur)) ? clamp(num(e.dur), 0, 8000) : null,
    ref: typeof e.ref === "string" ? e.ref.slice(0, 40) : null,
    lane: typeof e.lane === "string" && e.lane ? e.lane.slice(0, 60) : null, free: !!e.free, quick: !!e.quick, play: cleanPlay(e.play), cue: typeof e.cue === "string" && e.cue ? e.cue.slice(0, 24) : null, after: normCaption(e.after), strict: !!e.strict
  };
}
/**
 * Event fields for sources that need more than "a place" (all optional):
 *   lane  - a newer event of the same lane supersedes the lane's pending ones, and may replace the lane's take-over that plays now
 *           (the camera goes on from where it is: a token's next move, the next combat turn);
 *   free  - the "same place again", "just got the camera back" and ping-pong downgrades do not apply (the source paces itself);
 *   quick - decided after a short merge window (QUICK ms) instead of `merge` (things that are already moving on the screen);
 *   play  - how each client plays it: { by: a play handler id (director.mjs registerPlay), ...its own plain data }, passed on as is.
 */
export const QUICK = 120;
/** ms more a lane event may wait (before it is stale) behind its lane's cued take-over: the dice of an attack are not cut off. */
export const CUED_WAIT = 6000;
function cleanPlay(p) {
  if ( !p || typeof p !== "object" || Array.isArray(p) || typeof p.by !== "string" ) return null;
  const out = {};
  for ( const [k, v] of Object.entries(p).slice(0, 16) ) {
    if ( typeof v === "string" ) out[k] = v.slice(0, 80);
    else if ( typeof v === "number" ? Number.isFinite(v) : typeof v === "boolean" ) out[k] = v;
    else if ( Array.isArray(v) ) out[k] = v.filter((q) => typeof q === "string" || Number.isFinite(q)).slice(0, 64);
  }
  return out;
}

/** Weight of a damage area from its size (scene px, the larger side) and the grid: one square ~0.2, six or more ~1. */
export const sizeWeight = (size, grid, k = 1) => clamp((0.08 + 0.15 * (Math.max(0, size) / Math.max(1, grid))) * k, 0, 1);

/* ---------------------------------------------------------------- the queue (the leader's) */

/**
 * Pending events gather in BUCKETS: an event joins a bucket of the same scene whose first event is at most `merge` ms older and whose
 * focus is within `mergeSq` squares; a bucket is decided once its merge window is over. Decisions keep a short history (where and when
 * the camera went) for the cooldown, the rest between take-overs and no ping-pong between two places.
 */
export class Queue {
  constructor() { this.buckets = []; this.history = []; this.busyUntil = 0; this.lastTake = null; this.softLive = []; this.seq = 0; }

  push(ev, r, grid = 100) {
    if ( !ev ) return null;
    const dist = r.mergeSq * grid;
    if ( ev.lane ) this.buckets = this.buckets.filter((q) => !q.events.every((e) => e.lane === ev.lane));   // (superseded: the lane's newer event wins)
    let b = !ev.force && this.buckets.find((q) => q.scene === ev.scene && !q.force && ev.t - q.t0 <= r.merge && Math.hypot(q.x - ev.x, q.y - ev.y) <= dist);
    if ( !b ) { b = { id: ev.id, t0: ev.t, scene: ev.scene, events: [], x: ev.x, y: ev.y, force: ev.force, quick: ev.quick }; this.buckets.push(b); }
    b.events.push(ev);
    const h = heaviest(b.events);
    b.x = h.x; b.y = h.y;
    return b;
  }
  /** The earliest moment a decision is due (ms), or null when nothing waits. */
  due(r) {
    if ( !this.buckets.length ) return null;
    return Math.min(...this.buckets.map((b) => b.t0 + win(b, r)));
  }
  clear() { this.buckets = []; }
  /** Forget a take-over that was cut short (skip): the camera is free again from `now`. */
  release(now) { this.busyUntil = Math.min(this.busyUntil, now); }

  /**
   * Decide every bucket whose window is over. Returns the shots to send (plan() records), in start order. `st` = { paused, now }.
   * A bucket that cannot play yet (the camera is taken) waits until it is stale.
   */
  pump(r, st, grid = 100) {
    const now = st.now, out = [];
    this.softLive = this.softLive.filter((s) => s.end > now);
    const ready = this.buckets.filter((b) => now >= b.t0 + win(b, r)).sort((a, b) => bucketRank(b) - bucketRank(a) || a.t0 - b.t0);
    for ( const b of ready ) {
      const ev = merged(b), keep = () => {};
      const drop = () => { this.buckets = this.buckets.filter((q) => q !== b); };
      // (a lane's next event waiting for the lane's cued take-over - a turn during an attack's dice - may wait that long more)
      const stale = r.stale + (ev.lane && this.lastTake?.cued && this.lastTake.lane === ev.lane && this.busyUntil > b.t0 ? CUED_WAIT : 0);
      if ( !ev.force && (st.paused || now - b.t0 > stale || !r.enabled) ) { drop(); continue; }
      let form = ev.force || ev.weight >= r.takeAt ? "take" : ev.weight >= r.softAt && r.softOn ? "soft" : null;
      if ( !form ) { drop(); continue; }
      const wanted = form;
      const near = (h, ms) => h.end > now - ms && h.scene === ev.scene && Math.hypot(h.x - ev.x, h.y - ev.y) <= r.mergeSq * grid;
      if ( form === "take" && !ev.force ) {
        // the lane's own take-over plays: this one replaces it - unless that one is CUED (a roll waiting for its dice: the next turn or
        // move of the lane waits for the result instead of cutting it off)
        const relay = !!ev.lane && this.lastTake?.lane === ev.lane && !this.lastTake.cued && this.busyUntil > now;
        if ( this.busyUntil > now && !relay ) { keep(); continue; }                           // a take-over is on: wait (until stale)
        const heavy = ev.weight >= 0.9 || ev.free;
        if ( relay ) { /* (the camera is already with this lane) */ }
        else if ( ev.free ) { /* (the source paces itself) */ }
        else if ( this.history.some((h) => h.form === "take" && near(h, r.cooldown)) ) form = "soft";               // the same place again: no second take-over
        else if ( this.lastTake && now - this.lastTake.end < r.rest && !heavy ) form = "soft";                  // the player just got the camera back
        else if ( this.pingPong(ev, now, r, grid) && !heavy ) form = "soft";                                    // back to where it was a moment ago
      }
      if ( form === "soft" ) {
        if ( !r.softOn ) { drop(); continue; }
        if ( this.busyUntil > now ) { keep(); continue; }                                     // after the take-over that plays now
        // that place was just shown: dropped - unless it is news there (damage, a push: a fresh kind) or it would have taken the camera
        // (a take-over turned soft by the cooldown / rest is a big event: it never vanishes without a trace)
        if ( wanted !== "take" && !kindOf(ev.kind).fresh && this.history.some((h) => near(h, Math.min(r.cooldown, 4000))) ) { drop(); continue; }
        if ( this.softLive.length >= 2 ) { keep(); continue; }
      }
      drop();
      const shot = plan(ev, form, r, now, ++this.seq);
      if ( form === "take" ) { this.busyUntil = shot.t0 + shot.len; this.lastTake = { x: ev.x, y: ev.y, end: shot.t0 + shot.len, scene: ev.scene, lane: ev.lane ?? null, cued: !!ev.cue }; }
      else this.softLive.push({ end: shot.t0 + shot.len });
      this.history.push({ form, x: ev.x, y: ev.y, scene: ev.scene, end: shot.t0 + shot.len });
      while ( this.history.length > 24 ) this.history.shift();
      out.push(shot);
    }
    return out;
  }
  /** A take-over to place B right after one at place A that came from B a moment before: A -> B -> A ping-pong. */
  pingPong(ev, now, r, grid) {
    const takes = this.history.filter((h) => h.form === "take" && h.end > now - r.cooldown * 2);
    if ( takes.length < 2 ) return false;
    const a = takes.at(-1), b = takes.at(-2), d = r.mergeSq * grid;
    return Math.hypot(b.x - ev.x, b.y - ev.y) <= d && Math.hypot(a.x - ev.x, a.y - ev.y) > d;
  }
}
/** A bucket's merge window: none for a forced one, short for a quick one. */
const win = (b, r) => (b.force ? 0 : b.quick ? Math.min(r.merge, QUICK) : r.merge);
const heaviest = (evs) => evs.reduce((a, b) => (b.weight > a.weight || (b.weight === a.weight && kindOf(b.kind).pri > kindOf(a.kind).pri) ? b : a));
const bucketRank = (b) => { const h = heaviest(b.events); return (b.force ? 10 : 0) + h.weight + kindOf(h.kind).pri / 100; };

/** One event out of a bucket: the heaviest one's place and caption, the union of the boxes and tokens, a little weight for each extra event. */
export function merged(b) {
  const evs = b.events, h = heaviest(evs);
  let box = null; const tokens = new Set();
  for ( const e of evs ) { box = unionBox(box, e.box); for ( const t of e.tokens ) tokens.add(t); }
  const who = evs.every((e) => e.who === "gm") ? "gm" : "all";
  // a GM-only part is never mixed into what the players get: their box/tokens/kinds/count come from their events only
  const pub = evs.filter((e) => e.who !== "gm"), seen = who === "gm" ? evs : pub, kinds = [];
  for ( const e of seen ) if ( !kinds.includes(e.kind) ) kinds.push(e.kind);
  let pbox = null; const ptok = new Set();
  for ( const e of pub ) { pbox = unionBox(pbox, e.box); for ( const t of e.tokens ) ptok.add(t); }
  const ph = pub.length ? heaviest(pub) : h;
  return {
    id: b.id, kind: ph.kind, kinds, weight: clamp(Math.max(...(who === "gm" ? evs : pub).map((e) => e.weight)) + 0.06 * ((who === "gm" ? evs : pub).length - 1), 0, 1),
    x: ph.x, y: ph.y, box: who === "gm" ? box : pbox, tokens: [...(who === "gm" ? tokens : ptok)], caption: ph.caption, who,
    n: seen.length, force: evs.some((e) => e.force), scene: b.scene, path: ph.path, dur: ph.dur, ref: ph.ref ?? null,
    lane: ph.lane ?? null, free: evs.every((e) => e.free), quick: !!b.quick, play: ph.play ?? null, cue: ph.cue ?? null, after: ph.after ?? null, strict: !!ph.strict
  };
}

/**
 * The shot record every client plays: { v, id, form, kind, kinds, weight, x, y, box, tokens, caption, who, scene, t0 (ms, the sender's
 * clock; the sender turns it into shared ms), lead, hold, back, len, impact (ms after t0, or -1) }.
 */
export function plan(ev, form, r, now, seq = 0) {
  const k = kindOf(ev.kind);
  const hold = Math.round(clamp((ev.dur ?? k.hold) * r.holdK * (0.8 + 0.4 * ev.weight), 600, 8000));
  const lead = Math.round(r.lead), back = Math.round(r.back);
  let len = form === "take" ? Math.min(r.maxShot, lead + hold + back) : Math.round(r.softMs);
  const shot = {
    v: VERSION, id: `${ev.id}-${form[0]}`, form, kind: ev.kind, kinds: ev.kinds ?? [ev.kind], weight: ev.weight, x: ev.x, y: ev.y, box: ev.box, tokens: ev.tokens,
    caption: ev.caption, who: ev.who, scene: ev.scene, path: ev.path ?? null, t0: now, lead, hold: form === "take" ? len - lead - back : len, back, len,
    impact: form === "take" && k.impact ? Math.round(lead * 0.92) : -1, n: ev.n ?? 1, force: !!ev.force, ref: ev.ref ?? null,
    lane: ev.lane ?? null, play: ev.play ?? null, cue: ev.cue ?? null, after: ev.after ?? null, strict: !!ev.strict
  };
  return shot;
}
export const validShot = (s) => !!s && typeof s === "object" && s.v === VERSION && typeof s.id === "string" && (s.form === "take" || s.form === "soft")
  && Number.isFinite(s.t0) && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.len) && s.len > 0 && boxOk(s.box);
export const shotEnd = (s) => s.t0 + s.len;

/* ---------------------------------------------------------------- one client: how it plays a shot */

/**
 * What this client shows of a shot: "take" | "soft" | "none". ctx = {
 *   killed, mode ("full" | "soft" | "off": the player's choice), gm (this client is a GM), visible (the place is in this client's vision /
 *   explored and not hidden), busy (the player is dragging, measuring, panning), show (a cinematic show owns the screen), k (the
 *   effective intensity), camera (the take-over may move this client's camera) }.
 */
export function decide(shot, ctx) {
  if ( ctx.killed || ctx.mode === "off" ) return "none";
  if ( shot.who === "gm" && !ctx.gm ) return "none";
  if ( !ctx.visible ) return "none";
  if ( ctx.show ) return "none";
  if ( shot.form === "soft" ) return ctx.softOn === false ? "none" : "soft";
  if ( ctx.mode === "soft" || !ctx.camera || ctx.busy || !(ctx.k >= 0.15) ) return ctx.softOn === false ? "none" : "soft";
  return "take";
}

/** The camera target of a take-over: centre and zoom framing `box` (scene px) on a screen vw x vh, from the player's zoom `z0`. */
export function frameShot(shot, view0, r, k = 1, limits = [0.1, 3], reduced = false) {
  // `view0.rect` ({ x, y, w, h } screen px): the part of the screen not covered by windows / the interface - the box is framed into it
  const rc = view0.rect && view0.rect.w > 0 && view0.rect.h > 0 ? view0.rect : null;
  const view = rc ? { ...view0, vw: rc.w, vh: rc.h } : view0;
  const b = shot.box, w = Math.max(view.grid ?? 100, b.x1 - b.x0), h = Math.max(view.grid ?? 100, b.y1 - b.y0);
  const fit = Math.min(view.vw / (w * 1.8), view.vh / (h * 1.8));
  const most = view.scale * (1 + (r.zoomIn - 1) * clamp(k, 0, 1)), least = view.scale * 0.7;
  let scale = reduced ? view.scale : clamp(fit, least, most);
  // the box's own extent (no padding) inside the frame less the letterbox bars: a little further out (down to half the player's
  // zoom) when that is what it takes to keep it whole (an attacker and its target both on screen)
  const MX = 0.06, MY = 0.32, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const whole = Math.min(view.vw / Math.max(1, bw) * (1 - MX), view.vh / Math.max(1, bh) * (1 - MY));
  if ( !reduced && whole < scale && whole >= view.scale * 0.5 ) scale = whole;
  scale = clamp(scale, limits[0], limits[1]);
  const c = boxCentre(b), focus = { x: shot.x, y: shot.y };
  // the focus stays in the middle third of the frame: between the box centre and the focus, while the whole box fits
  const keep = (v, lo, hi, half, mk) => { const m = half * mk; return hi - lo <= 2 * (half - m) ? clamp(v, hi - half + m, lo + half - m) : v; };
  const hw = view.vw / (2 * scale), hh = view.vh / (2 * scale);
  const out = { x: keep((c.x + focus.x) / 2, b.x0, b.x1, hw, MX), y: keep((c.y + focus.y) / 2, b.y0, b.y1, hh, MY), scale };
  // (the camera centre is the screen centre: shift it so that the framed point lands in the middle of the free rect)
  if ( rc ) { out.x += (view0.vw / 2 - (rc.x + rc.w / 2)) / scale; out.y += (view0.vh / 2 - (rc.y + rc.h / 2)) / scale; }
  return out;
}

/** The screen effects of a take-over, scaled by the intensity `k` and calmed by reduced motion: the look values `r` (cinematic-core). */
export function lookFor(look, k = 1, reduced = false) {
  const q = clamp(k, 0, 1);
  return { ...look, shIntensity: look.shIntensity * q * (reduced ? 0 : 1), flIntensity: look.flIntensity * q * (reduced ? 0 : 1), vgStrength: look.vgStrength * (0.4 + 0.6 * q),
    lbHeight: look.lbHeight * (0.55 + 0.45 * q), shOn: look.shOn && !reduced, flOn: look.flOn && !reduced, smOn: false };
}

/**
 * Where a soft shot's marker goes on screen: { on: true, x, y } when the focus (screen px `p`) is inside the screen less `m`, else the
 * point on the inset border along the ray from the screen centre (arrow) and its angle (rad): { on: false, x, y, a }.
 */
export function edgeSpot(p, w, h, m = 56) {
  if ( p.x >= m && p.x <= w - m && p.y >= m && p.y <= h - m ) return { on: true, x: p.x, y: p.y, a: 0 };
  const cx = w / 2, cy = h / 2, dx = p.x - cx, dy = p.y - cy;
  const sx = dx ? (w / 2 - m) / Math.abs(dx) : Infinity, sy = dy ? (h / 2 - m) / Math.abs(dy) : Infinity, s = Math.min(sx, sy);
  return { on: false, x: cx + dx * s, y: cy + dy * s, a: Math.atan2(dy, dx) };
}

/**
 * The safe rect of the screen, worked out (overlay.safeRect measures, this decides): { x, y, w, h } in client px.
 *   vw, vh   the window
 *   ui       Foundry's own interface as measured: { mid: { left, right } | null (#ui-middle), top (the navigation's bottom edge | null),
 *            bot (the hotbar's top edge | null) } - the navigation counts while it ends in the upper third, the hotbar while it starts
 *            in the lower third; a column / row pair that leaves less than the least stretch is not counted (the whole window)
 *   insets   what other modules declared to the zones API ({ top, right, bottom, left } px in from that side of the window)
 * A DECLARED inset always counts, however large (U70: a bottom inset of 60 % of the window or more used to be dropped whole, so the
 * camera framed its subject under an action dock with its panels open and the "My view" chip stood on the dock). Only when the
 * declared insets of one direction leave less than the least stretch the director can work with (`minW` x `minH`) are they given
 * up, and only by what that stretch needs, each side in proportion to what it took: the stretch stays between the declared bars, as
 * clear of them as the window allows, and is never the whole window again.
 */
export function safeBox(vw, vh, ui = null, insets = null, { minW = 300, minH = 240 } = {}) {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const mid = ui?.mid && n(ui.mid.right) - n(ui.mid.left) > 0 ? ui.mid : null;
  let x0 = mid ? Math.max(0, n(mid.left)) : 0, x1 = mid ? Math.min(vw, n(mid.right)) : vw, y0 = 0, y1 = vh;
  if ( ui?.top != null && n(ui.top) < vh / 3 ) y0 = Math.max(y0, n(ui.top));
  if ( ui?.bot != null && n(ui.bot) > vh * 2 / 3 ) y1 = Math.min(y1, n(ui.bot));
  if ( x1 - x0 < minW ) { x0 = 0; x1 = vw; }
  if ( y1 - y0 < minH ) { y0 = 0; y1 = vh; }
  const fit = (lo, hi, a, b, size, min) => {
    let p = Math.max(lo, Math.min(a, size)), q = Math.min(hi, Math.max(size - b, 0));
    if ( q - p >= min || hi - lo <= min ) return q - p >= min ? [p, q] : [lo, hi];
    const ca = p - lo, cb = hi - q, give = min - (q - p);                 // (ca + cb >= give: the stretch without them is over min)
    p -= give * ca / (ca + cb); q = p + min;
    return [Math.round(p), Math.round(q)];
  };
  [x0, x1] = fit(x0, x1, n(insets?.left), n(insets?.right), vw, minW);
  [y0, y1] = fit(y0, y1, n(insets?.top), n(insets?.bottom), vh, minH);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * fxz: where the GM's director bar stands (bar.mjs measures, this decides): { x, bottom } in client px (left edge; distance of its
 * bottom edge to the window's). Bottom left, right of Foundry's left column - and right of the players list where that list reaches
 * the bar's row (#players lies in the left column but is wider than the scene controls, so the column's own edge put the bar over it);
 * lifted above the hotbar when it would sit on it; kept left of the right column. A spot that would lie over a panel another module
 * declared (zones uiAvoid: a tactics dock) is traded for the row right above the players list, at its left edge, when that one is clear.
 *   env { vw, vh, w, h, col, players, right, hot (client rects or null), avoid [{ x0, y0, x1, y1 }] }
 */
export function barSpot({ vw, vh, w = 400, h = 32, col = null, players = null, right = null, hot = null, avoid = [] } = {}) {
  const ok = (r) => r && r.width > 0 && r.height > 0;
  const over = (x, bottom, b) => { const y1 = vh - bottom, y0 = y1 - h; return b.x0 < x + w && b.x1 > x && b.y0 < y1 && b.y1 > y0; };
  const blocks = (Array.isArray(avoid) ? avoid : []).filter((b) => b && [b.x0, b.y0, b.x1, b.y1].every(Number.isFinite));
  const clear = (x, bottom) => !blocks.some((b) => over(x, bottom, b)) && !(ok(players) && over(x, bottom, { x0: players.left, y0: players.top, x1: players.right, y1: players.bottom }));
  const keepLeft = (x) => (ok(right) ? Math.max(8, Math.min(x, Math.round(right.left) - w - 12)) : x);
  let bottom = 10, x = ok(col) ? Math.round(col.right + 12) : 100;
  if ( ok(players) && players.top < vh - bottom && players.bottom > vh - bottom - h ) x = Math.max(x, Math.round(players.right + 12));
  x = keepLeft(x);
  if ( ok(hot) && x < hot.right && x + w > hot.left && vh - bottom - h < hot.bottom ) {
    bottom = Math.round(vh - hot.top + 8);
    x = keepLeft(Math.max(8, Math.round(hot.left)));
  }
  if ( clear(x, bottom) || !ok(players) ) return { x, bottom };
  const up = { x: keepLeft(Math.max(8, Math.round(players.left))), bottom: Math.round(vh - players.top + 8) };
  return clear(up.x, up.bottom) ? up : { x, bottom };
}

/** fxz (U192): the bottom edge of the interface's top row for safeBox's `ui.top`: the navigation and the map's own orbit strip ("ORBITA",
 * GM only, under a combat module's initiative bar), whichever reaches lower; null when neither shows. Rects: client boxes or null. */
export function topEdge(...rects) {
  const b = rects.filter((r) => r && r.height > 0 && r.width > 0 && Number.isFinite(r.bottom)).map((r) => r.bottom);
  return b.length ? Math.max(...b) : null;
}

/** The phase of a shot at `now`: "wait" | "lead" | "hold" | "back" | "over". */
export function phaseAt(s, now) {
  const t = now - s.t0;
  if ( t < 0 ) return "wait";
  if ( t >= s.len ) return "over";
  if ( s.form === "soft" ) return "hold";
  return t < s.lead ? "lead" : t < s.lead + s.hold ? "hold" : "back";
}

/** The leader: the active GM; with no GM online, the first active user by id (so a player-only table still gets its shots). */
export function leaderOf(users) {
  const act = users.filter((u) => u.active);
  const gm = act.filter((u) => u.isGM).sort((a, b) => (a.id < b.id ? -1 : 1));
  if ( gm.length ) return gm[0].id;
  return act.sort((a, b) => (a.id < b.id ? -1 : 1))[0]?.id ?? null;
}

/**
 * The director's leader, every client computing the same answer from what all of them know (users' activity: active, GM, the scene
 * they view; and each client's own announcement over the socket: its tab visible or not, when it came online).
 * `users` = [{ id, active, isGM, viewed }], `scene` = the players' scene (the active one), `states` = Map id -> { vis, since }.
 * Ranked: on the players' scene first (a GM preparing another scene must not silence the director: a player on the scene stands in),
 * then a visible tab (a background tab's timers are throttled), a GM before a player, then the one online the longest (a second GM
 * logging in does not take the lead over), then the id. An unknown state counts as "visible, online since just now" (a client that
 * has not announced itself yet never takes the lead from one that has; the new client itself waits a moment before it leads).
 */
export function pickLeader(users, { scene = null, states = null } = {}) {
  const act = users.filter((u) => u.active);
  if ( !act.length ) return null;
  const st = (u) => states?.get?.(u.id) ?? null;
  const on = (u) => !scene || !u.viewed || u.viewed === scene;
  const vis = (u) => st(u)?.vis !== false;
  const since = (u) => (Number.isFinite(st(u)?.since) ? st(u).since : Infinity);
  const key = (u) => [on(u) ? 0 : 1, vis(u) ? 0 : 1, u.isGM ? 0 : 1, since(u)];
  const cmp = (a, b) => { const ka = key(a), kb = key(b); for ( let i = 0; i < ka.length; i++ ) if ( ka[i] !== kb[i] ) return ka[i] - kb[i]; return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; };
  // (a GM on the scene with a hidden tab still leads over a player only while no visible client is on the scene)
  return [...act].sort(cmp)[0].id;
}

/**
 * An event that came from a PLAYER's client (another module, a macro): it may ask for a shot, never command one. No `force` (the GM's
 * pause and the cooldowns apply), no lane / free (a combat lane is the director's own), weight below "heavy". `null` when unusable.
 */
export function fromPlayer(ev) {
  if ( !ev ) return null;
  return { ...ev, force: false, free: false, lane: null, quick: false, weight: Math.min(ev.weight, 0.85) };
}

/** The effective intensity: the player's own times the GM's (bar). */
export const intensity = (mine, gm) => clamp((Number.isFinite(mine) ? mine : 1) * (Number.isFinite(gm) ? gm : 1), 0, 1);
