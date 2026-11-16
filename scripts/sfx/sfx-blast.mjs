/* MAPBLAST: a map blast's IMPACT FRAME (the lettering engine's L.impact, kind "blast" / "landing"), the pure part - no Foundry, no engine.
   What it decides, from what every seat shares only (a firing's page, a moment's main event, the shared clock):
     - WHICH blasts get one and HOW STRONG (blastOfPage / blastOfMoment): the frame's strength follows the blast's size by the same
       hierarchy as its word (the page's rank: a grenade, a shell, a bomb, the meteor), so a grenade is a panel round the blast and only a
       bomb or the meteor takes the whole view; a landing is its own kind; a lightning strike has none (it has its own light);
     - THE VOLLEY RULE (volley): of blasts that follow each other within VOLLEY_MS only the first is drawn at its strength (the "lead");
       the others get the engine's flash-free rung (QUIET: lines, a star, a ring - nothing done to the scene, no hit-stop), unless one is
       a whole step stronger than the lead before it. Decided on the blasts' shared moments, the same on every seat;
     - THE CALL (specOf): one seed per blast, the blow at the instant of the main word's contact, the word kept readable on the frame.
   The runtime (sfx.mjs armBlast) adds this seat's own needs, which can only LOWER: its view (a seat that does not have the blast in
   view, or may not see the place, gets none), its opt-outs (no flash -> the gentle variant, no shake -> no shove, reduced motion).
   The engine's own limits stay in charge of everything drawn (two flashes an impact and a second, the photosensitive and reduced seats,
   one impact at a time). The table's switches: the engine's impact frames ("off": none) and the map's lettering (off / destruction at
   size 0: none). */

/** blasts that follow a lead within this long are its volley (ms, shared clock) */
export const VOLLEY_MS = 2500;
/** a follower's strength: the engine's step 1 (no drawing that changes the scene, no hit-stop) */
export const QUIET = 0.5;
/** the engine's strength bounds (L.impact.steps; dev/sfx-blast.test.mjs pins them against the engine) */
export const STEP_AT = [0.35, 0.6, 0.85, 1.35, 1.7];
export const stepOf = (m) => STEP_AT.filter((b) => m >= b).length;
/** a main word's contact after its start when the engine cannot tell (ms: a slam's contact drawing) */
export const CONTACT_MS = 140;
/** how long a blast is remembered for the volley rule (ms: longer than any chain of leads can be) */
export const KEEP_MS = 20000;
/** a firing's frame is asked this long before its main word starts (ms). The engine gives an impact frame's second to the impact: a
    word's own flash accent inside it gives way - but only for an impact it already knows. Asked with the main word (140 ms ahead) a pre
    word that had flashed up to a second before (live: the meteor's descent word) had taken flash slots, on each seat by what THAT seat
    drew, and the frame was thinned on one seat and not on the seat beside it. Asked this far ahead every word round the blow gives way
    on every seat alike, and the engine paints the drawings in idle time (its FEED_EARLY, 1500 ms). */
export const AHEAD_MS = 1400;
/** has a seat's view moved since the frame was asked (the engine reads the blast's place on the screen at the call)? `a`, `b` = { x, y
    (the view's centre, scene px), z (zoom), w (the view's width, scene px) }: more than 2 % of the view's width, or 2 % of zoom */
export const viewMoved = (a, b) => !a || !b || Math.hypot(a.x - b.x, a.y - b.y) > 0.02 * Math.max(1, a.w) || Math.abs(a.z / (b.z || 1) - 1) > 0.02;
/** a painted blast under this radius (grid squares) has no frame: a dab of the brush is not an explosion */
export const MIN_SQ = 0.6;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** the strength at a step's floor + the blast's radius spread inside the step (never into the next step) */
const within = (base, span, rG) => +(base + span * clamp(((Number(rG) || 0) - 0.5) / 3, 0, 1)).toFixed(3);
const degOf = (way) => (way && Number.isFinite(way.ux) && Number.isFinite(way.uy) && (way.ux || way.uy) ? Math.round((Math.atan2(way.uy, way.ux) * 180) / Math.PI) : null);

/**
 * The impact of a firing told as a page (sfx-page firingPage): from its MAIN word (what it is, its rank, where, when - shared) and its
 * record (`rec`: the meteor's accent, its own screen shake). -> { id, kind, magnitude, x, y, r (scene px), t (shared ms: the main word's
 * start), dir? (degrees, the way it came in), shake (the firing shakes the screen itself), soft (never a lead) } | null
 */
export function blastOfPage(pg, rec, grid = 100) {
  const w = (pg?.words ?? []).find((q) => q.role === "main");
  if ( !w || !rec?.id || !Number.isFinite(w.x) || !Number.isFinite(w.y) || !Number.isFinite(Number(w.t)) ) return null;
  const G = grid || 100, r = Number(w.r) > 0 ? Number(w.r) : G, rG = r / G, rank = Number(w.rank) || 3;
  const meteor = (rec.pending?.accent ?? []).some((a) => a?.kind === "meteor");
  let kind = "blast", magnitude, soft = false, dir = degOf(w.way ?? pg.way);
  switch ( w.kind ) {
    case "grenade": case "boom":
      magnitude = meteor ? within(1.8, 0.2, rG) : rank >= 5 ? within(1.42, 0.25, rG) : rank === 4 ? within(1.0, 0.3, rG) : within(0.66, 0.15, rG);
      break;
    // (a body coming down: the blow goes into the ground - screen-down - unless the firing names its way)
    case "thud": kind = "landing"; magnitude = within(1.0, 0.3, rG); dir ??= 90; break;
    // (a wave alone, no fireball: lines and a ring, the scene untouched)
    case "shockwave": magnitude = QUIET; soft = true; break;
    default: return null;                                     // (a lightning strike: its own flash lights the scene - question MAPBLAST-2)
  }
  const shake = (rec.pending?.cue ?? []).some((c) => c?.kind === "screen" && c.shake > 0);
  return { id: `pg|${rec.id}`, kind, magnitude, x: w.x, y: w.y, r, t: Number(w.t), ...(dir != null ? { dir } : {}), shake, soft };
}

/**
 * The impact of a blast that is no preset firing (a painted blast area, a fire layer's burst of its own, a Detonate): `e` = { id, voice
 * (the moment's main voice), x, y, r (scene px), t (shared ms), way? }. Only the explosion voices; sized by its radius in squares; the
 * top step is the meteor's alone. -> as blastOfPage | null
 */
export function blastOfMoment(e, grid = 100) {
  if ( !e || !/^(boom|blast)$/.test(e.voice ?? "") || !Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(Number(e.t)) || !(e.r > 0) ) return null;
  const rG = e.r / (grid || 100);
  if ( rG < MIN_SQ ) return null;
  const magnitude = rG >= 2.2 ? within(1.42, 0.25, rG - 1.7) : rG >= 1.2 ? within(1.0, 0.3, rG - 0.7) : within(0.66, 0.15, rG);
  const dir = degOf(e.way);
  return { id: `m|${e.id}`, kind: "blast", magnitude, x: e.x, y: e.y, r: e.r, t: Number(e.t), ...(dir != null ? { dir } : {}), shake: false, soft: false };
}

/**
 * THE VOLLEY RULE over the blasts known ([{ id, t, magnitude, soft }], any order): -> Map id -> "lead" | "quiet". In the order of their
 * shared moments (ties by id): a blast within VOLLEY_MS after the last lead is quiet unless it is a whole step stronger than that lead;
 * a soft one is always quiet. A blast's answer depends only on the blasts BEFORE it, so a seat that learns of a later one decides the
 * earlier ones alike. Leads inside one window are strictly stronger each time: at most one per step, never a run of equal slams.
 */
export function volley(list) {
  const out = new Map();
  const L = (list ?? []).filter((b) => b && b.id != null && Number.isFinite(b.t)).slice().sort((a, b) => a.t - b.t || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  let last = null;
  for ( const b of L ) {
    if ( out.has(b.id) ) continue;
    if ( b.soft || (last && b.t - last.t < VOLLEY_MS && stepOf(b.magnitude) <= stepOf(last.magnitude)) ) { out.set(b.id, "quiet"); continue; }
    out.set(b.id, "lead"); last = b;
  }
  return out;
}
/** the strength a blast is drawn at: its own as a lead, at most QUIET as a follower */
export const drawnMag = (b, lead) => (lead ? b.magnitude : Math.min(b.magnitude, QUIET));

/** Does a seat have the blast in view? Its centre inside the seat's map view ({ x0, y0, x1, y1 } scene px). */
export const inView = (b, v) => !!v && b.x >= v.x0 && b.x <= v.x1 && b.y >= v.y0 && b.y <= v.y1;

/**
 * The engine call of a blast (L.impact.play's spec). The table's part: kind, strength (lead or quiet), place, radius, seed, the blow's
 * instant, the way it came in. `seat` = this seat's needs, which only lower: noFlash (-> the gentle variant: no full-field drawing, no
 * hit-stop), noShake (-> no shove), reduced (-> one still). A firing that shakes the screen itself is not shoved a second time.
 * `keep`: the word(s) kept readable on the frame (an array the caller fills when the word starts).
 */
export function specOf(b, { lead = true, sceneId = "", blowAt = null, keep = null, seat = {} } = {}) {
  return { kind: b.kind, magnitude: drawnMag(b, lead), subject: { x: b.x, y: b.y }, space: "world", area: b.r, seed: `mapblast|${sceneId}|${b.id}`,
    ...(Number.isFinite(blowAt) ? { blowAt } : {}), ...(keep ? { keep } : {}), ...(Number.isFinite(b.dir) ? { dir: b.dir } : {}),
    ...(b.shake || seat.noShake ? { punch: false } : {}), ...(seat.noFlash ? { gentle: true } : {}), ...(seat.reduced ? { reduced: true } : {}) };
}
