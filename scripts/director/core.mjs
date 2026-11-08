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
  cut: { pri: 9, hold: 1800, impact: false, group: null, icon: "fa-solid fa-video" },
  custom: { pri: 3, hold: 1500, impact: false, group: null, icon: "fa-solid fa-film" }
});
export const KIND_IDS = Object.keys(KINDS);
/** The source toggles of the settings (one per group of kinds). */
export const GROUPS = ["destruction", "fire", "zones", "orbit", "altitude"];
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
export const BOOLS = { enabled: true, captions: true, softOn: true, src_destruction: true, src_fire: true, src_zones: true, src_orbit: true, src_altitude: true };
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

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const boxOk = (b) => b && [b.x0, b.y0, b.x1, b.y1].every((v) => Number.isFinite(v)) && b.x1 >= b.x0 && b.y1 >= b.y0;
export const boxCentre = (b) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
export const unionBox = (a, b) => (!a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
export const pointBox = (x, y, r = 0) => ({ x0: x - r, y0: y - r, x1: x + r, y1: y + r });

/**
 * An event as the queue takes it, validated: { id, kind, weight 0..1, box (scene px), x, y (its focus), tokens [ids], caption, who
 * ("all" | "gm"), t, src, force }. A place is required: a box, a point (x, y), or both. Null when unusable.
 * `caption` = a plain string, or { key, data } (localised on each client, so every player reads it in their own language).
 */
export function normEvent(e, now = 0) {
  if ( !e || typeof e !== "object" ) return null;
  const kind = KINDS[e.kind] ? e.kind : "custom";
  let box = boxOk(e.box) ? { x0: +e.box.x0, y0: +e.box.y0, x1: +e.box.x1, y1: +e.box.y1 } : null;
  let x = num(e.x), y = num(e.y);
  if ( !Number.isFinite(x) || !Number.isFinite(y) ) { if ( !box ) return null; ({ x, y } = boxCentre(box)); }
  if ( !box ) box = pointBox(x, y, 0);
  const w = num(e.weight);
  const caption = typeof e.caption === "string" ? e.caption.slice(0, 160) : e.caption && typeof e.caption === "object" && typeof e.caption.key === "string" ? { key: e.caption.key, data: e.caption.data && typeof e.caption.data === "object" ? e.caption.data : {} } : null;
  return {
    id: typeof e.id === "string" && e.id ? e.id.slice(0, 40) : `e${Math.round(now)}-${Math.floor(Math.random() * 1e6)}`,
    kind, weight: Number.isFinite(w) ? clamp(w, 0, 1) : 0.5, x, y, box,
    tokens: Array.isArray(e.tokens) ? e.tokens.filter((t) => typeof t === "string").slice(0, 16) : [],
    caption, who: e.who === "gm" ? "gm" : "all", t: Number.isFinite(num(e.t)) ? num(e.t) : now,
    src: typeof e.src === "string" ? e.src.slice(0, 40) : "api", force: !!e.force, scene: typeof e.scene === "string" ? e.scene : null,
    path: Array.isArray(e.path) ? e.path.filter(Number.isFinite).slice(0, 64) : null, dur: Number.isFinite(num(e.dur)) ? clamp(num(e.dur), 0, 8000) : null,
    ref: typeof e.ref === "string" ? e.ref.slice(0, 40) : null,
    lane: typeof e.lane === "string" && e.lane ? e.lane.slice(0, 60) : null, free: !!e.free, quick: !!e.quick, play: cleanPlay(e.play)
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
      if ( !ev.force && (st.paused || now - b.t0 > r.stale || !r.enabled) ) { drop(); continue; }
      let form = ev.force || ev.weight >= r.takeAt ? "take" : ev.weight >= r.softAt && r.softOn ? "soft" : null;
      if ( !form ) { drop(); continue; }
      const near = (h, ms) => h.end > now - ms && h.scene === ev.scene && Math.hypot(h.x - ev.x, h.y - ev.y) <= r.mergeSq * grid;
      if ( form === "take" && !ev.force ) {
        const relay = !!ev.lane && this.lastTake?.lane === ev.lane && this.busyUntil > now;   // the lane's own take-over plays: this one replaces it
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
        if ( this.history.some((h) => near(h, Math.min(r.cooldown, 4000))) ) { drop(); continue; }     // that place was just shown
        if ( this.softLive.length >= 2 ) { keep(); continue; }
      }
      drop();
      const shot = plan(ev, form, r, now, ++this.seq);
      if ( form === "take" ) { this.busyUntil = shot.t0 + shot.len; this.lastTake = { x: ev.x, y: ev.y, end: shot.t0 + shot.len, scene: ev.scene, lane: ev.lane ?? null }; }
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
  let box = null; const tokens = new Set(), kinds = [];
  for ( const e of evs ) { box = unionBox(box, e.box); for ( const t of e.tokens ) tokens.add(t); if ( !kinds.includes(e.kind) ) kinds.push(e.kind); }
  const who = evs.every((e) => e.who === "gm") ? "gm" : "all";
  // a GM-only part is never mixed into what the players get: their box/tokens come from their events only
  const pub = evs.filter((e) => e.who !== "gm");
  let pbox = null; const ptok = new Set();
  for ( const e of pub ) { pbox = unionBox(pbox, e.box); for ( const t of e.tokens ) ptok.add(t); }
  const ph = pub.length ? heaviest(pub) : h;
  return {
    id: b.id, kind: ph.kind, kinds, weight: clamp(Math.max(...(who === "gm" ? evs : pub).map((e) => e.weight)) + 0.06 * ((who === "gm" ? evs : pub).length - 1), 0, 1),
    x: ph.x, y: ph.y, box: who === "gm" ? box : pbox, tokens: [...(who === "gm" ? tokens : ptok)], caption: ph.caption, who,
    n: evs.length, force: evs.some((e) => e.force), scene: b.scene, path: ph.path, dur: ph.dur, ref: ph.ref ?? null,
    lane: ph.lane ?? null, free: evs.every((e) => e.free), quick: !!b.quick, play: ph.play ?? null
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
    lane: ev.lane ?? null, play: ev.play ?? null
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
export function frameShot(shot, view, r, k = 1, limits = [0.1, 3], reduced = false) {
  const b = shot.box, w = Math.max(view.grid ?? 100, b.x1 - b.x0), h = Math.max(view.grid ?? 100, b.y1 - b.y0);
  const fit = Math.min(view.vw / (w * 1.8), view.vh / (h * 1.8));
  const most = view.scale * (1 + (r.zoomIn - 1) * clamp(k, 0, 1)), least = view.scale * 0.7;
  let scale = reduced ? view.scale : clamp(fit, least, most);
  scale = clamp(scale, limits[0], limits[1]);
  const c = boxCentre(b), focus = { x: shot.x, y: shot.y };
  // the focus stays in the middle third of the frame: between the box centre and the focus
  return { x: (c.x + focus.x) / 2, y: (c.y + focus.y) / 2, scale };
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

/** The effective intensity: the player's own times the GM's (bar). */
export const intensity = (mine, gm) => clamp((Number.isFinite(mine) ? mine : 1) * (Number.isFinite(gm) ? gm : 1), 0, 1);
