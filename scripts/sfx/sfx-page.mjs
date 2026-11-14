/* EFFECTS1: the PAGE of a preset firing - one event told as one comic page, the pure part (no Foundry, no PIXI, no DOM: node-tested
   in dev/sfx-page.test.mjs). SPEC-EFFECTS 2.1 / 3.4 / 4.3: a firing letters its LAYERS (not its name), all its strokes are ONE page
   keyed by the firing id, and the page tells the event's story in order (owner, 2026-11-13: «Napisy też powinny przedstawiać tempem i
   charakterem historię zdarzenia. Mają pasować i budować»):
     PRE   the sound before it (a bomb's fall, a rocket's flight, a meteor's descent, a grenade's bounce, a strike's charge) - it BUILDS
     MAIN  the loudest sound, once (one explosion = one word, once)
     WAVE  the pressure in the air, riding out with the ring
     FALL  the debris coming down, big pieces first, then smaller: it RESOLVES (different words: large / medium / small pieces)
     CATCH the first of the firing's fires taking (one for the whole firing)
     OUT   the fires dying one by one: their hisses composed as one arrangement (fewer than the fires, alternating sides, each a little
           smaller and longer, the last one trailing off)
   A word here holds no text: its sound KIND and word options (engine vocabulary 1.7.1+: material, pieces, intensity, stage), its
   moment (shared clock ms), place (a point, a ride along a path, or `screen`: shown generally on the screen, not at a point), rank
   (R1..R5 of SPEC-EFFECTS 2.1) and staging. sfx.mjs writes, places and plays it.
   Owner's answer 3 (binding unless changed): BOOM / BUM only for blasts with fire (the burst), a hero landing THOOM / DUUM (thud), a
   fireless blast KROOM / KRUUM (concussion), a cave-in BTHOOM (sfx-core). */

import { hashStr } from "./sfx-core.mjs";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const h01 = (s) => hashStr(s) / 4294967296;

/** Rank -> the engine's magnitude (0..2) at size 1 (SPEC-EFFECTS 2.1: R5 16-20 % of the view height, R1 3 %). */
export const RANK_MAG = [0, 0.3, 0.5, 0.8, 1.15, 1.5];
/** Roles in drop order (SPEC-EFFECTS 4.2: drop FALL first ... never the MAIN). */
export const DROP_ORDER = ["fall", "catch", "out", "wave", "pre", "main"];
/** a travelling PRE word is gone this long before the MAIN's flash frame (4.4) */
export const PRE_GAP = 90;
/** how long a FALL / CATCH word covered by the story's bigger words waits for room before it is dropped (EFFECTS2, live meteor) */
export const FALL_WAIT_MS = 1000;
/** the shock dust's front time constant per level (fire/dust-model.mjs SHOCK tau, s) and its rim at about 2.2 tau */
export const SHOCK_TAU = [0, 0.2, 0.28, 0.38];
/** at most this many hisses for the fires of one firing (they die one by one: the arrangement, not one per fire) */
export const OUT_MAX = 4;
/** hisses of one firing are at least this far apart (ms) */
export const OUT_GAP = 2600;
/** debris words of one page are at least this far apart (ms): the story steps down, never two landings in one beat */
export const FALL_GAP = 300;
/** how many seeds a page word tries before it gives up avoiding a word its page already said */
export const REWORD = 8;
/**
 * A word its page has not said yet: `write(seed)` -> { text } (the engine's L.word with the word's options), tried on `seed`, then
 * `seed|1`, `seed|2` ... until its text is not in `used` (the texts already written for this page). Pure; the same on every client
 * as long as the page's words are written in the same order. -> the word (the last try when every try repeats).
 */
export function unrepeated(write, seed, used, n = REWORD) {
  let word = null;
  for ( let k = 0; k < n; k++ ) { word = write(k ? `${seed}|${k}` : seed); if ( !used.has(word?.text) ) break; }
  return word;
}

/** The material word of the destruction layer's ground (sfx-core MATS) -> the engine's material (words.mjs MATERIALS). */
export const GROUND_MAT = { grass: "earth", earth: "earth", sand: "earth", snow: "earth", stone: "stone", wood: "wood", metal: "metal", water: "water", auto: "earth" };

const keyOf = (s) => String(s?.key ?? "");
const isFire = (st) => st?.k === "fire";

/**
 * The page of a firing record. `ctx` = { grid, strokes (Map id -> fire-layer stroke), lift (the view's lift, 0.5), timing (lightning
 * timing(seed, lv) or null), wayOf / headAt (meteor), fallAt (landing) }. -> { fid, main (the MAIN kind or null), owned: { d: Set (the
 * firing's destruction strokes: their entries are part of the page, silent), f: Set (its burst and dust strokes: silent), catch: Set
 * (fire strokes whose own catch word the page replaces), out: Map (fire id -> its out time: the hiss the page arranges) }, words }
 */
export function firingPage(rec, ctx = {}) {
  const grid = ctx.grid || 100, S = ctx.strokes ?? new Map(), fid = String(rec?.id ?? "");
  const out = { fid, main: null, owned: { d: new Set(), f: new Set(), catch: new Set(), out: new Map() }, words: [] };
  if ( !rec || !Number.isFinite(Number(rec.t0)) ) return out;
  const T0 = Number(rec.t0), size = clamp(Number(rec.size) || 1, 0.5, 2), power = Math.round(Number(rec.power) || 0);
  const seed = `${fid}|${rec.seed ?? 0}`;
  const acc = rec.pending?.accent ?? [];
  const accOf = (k) => acc.find((a) => a?.kind === k);
  const fl = (rec.f ?? []).map((e) => ({ ...e, st: S.get(e.id) })).filter((e) => e.st);
  const burst = fl.find((e) => e.st.k === "burst")?.st;
  const shock = fl.filter((e) => e.st.k === "dust" && e.st.dk === "shock").map((e) => e.st).sort((a, b) => (b.r ?? 0) - (a.r ?? 0))[0];
  const fires = fl.filter((e) => isFire(e.st));
  const land = accOf("landing"), strike = accOf("strike"), meteor = accOf("meteor"), rocket = accOf("rocket"), fall = accOf("fallShadow");
  const bounce = accOf("bounce"), ring = accOf("airRing");
  const at = Array.isArray(rec.at) ? { x: rec.at[0], y: rec.at[1] } : burst?.p ? { x: burst.p[0], y: burst.p[1] } : null;
  if ( !at ) return out;
  const W = (w) => { out.words.push({ fid, seed: `${seed}|${w.key}`, ...w }); return w; };
  const sq = grid * size;

  /* ---- MAIN: the loudest sound, once. Its kind follows what makes it (the layers), its rank the strongest layer. */
  let main = null;
  if ( burst ) {
    const lv = clamp(Math.round(burst.lv ?? 2), 1, 3), rG = (burst.r ?? 100) / grid;
    const rank = clamp((lv === 1 ? 3 : lv === 2 ? 4 : 5) + (rG > 2 ? 0 : rG < 0.7 && lv > 1 ? -1 : 0), 3, 5);
    main = { kind: lv === 1 ? "grenade" : "boom", loud: lv === 1 ? 0.55 + 0.15 * power : lv === 2 ? 0.75 : 1, rank, r: burst.r ?? sq, t: Number(burst.q) || T0 };
    // (the meteor: the longest, widest word of the map - prefix and the top tier)
    if ( meteor ) Object.assign(main, { loud: 1, rank: 5, long: 0.85, prefix: true });
    else if ( lv === 3 ) main.prefix = true;
  } else if ( land ) {
    main = { kind: "thud", loud: 0.95, rank: 4, r: 0.7 * sq, t: T0, prefix: true };
  } else if ( strike ) {
    const lv = clamp(Math.round(strike.lv ?? 2), 1, 3);
    main = { kind: "thunder", loud: 0.8 + 0.1 * (lv - 2), rank: lv === 3 ? 5 : 4, r: 0.6 * sq, t: T0 };
  } else if ( shock ) {
    // (a custom preset with only a shock wave: it stands alone, the wave is the main sound, SPEC-EFFECTS F13)
    main = { kind: "shockwave", loud: 0.7, rank: 3, r: shock.r ?? sq, t: Number(shock.q) || T0 };
  }
  if ( !main ) return out;
  out.main = main.kind;
  // the firing's strokes are this page: its damage areas enter silently (crater, lobes, scar, ejecta pocks, shrapnel cracks), its
  // burst and dust strokes are lettered here, its fires keep their burning sound but catch and die as the page arranges
  for ( const d of rec.d ?? [] ) if ( d?.id ) out.owned.d.add(d.id);
  for ( const e of fl ) if ( e.st.k === "burst" || e.st.k === "dust" ) out.owned.f.add(e.id);
  const box = { x0: at.x - main.r, y0: at.y - main.r, x1: at.x + main.r, y1: at.y + main.r };
  // the MAIN word's side: upwind of the fireball (the cap rolls screen-up and the column drifts downwind), at crater height, never
  // above (SPEC-EFFECTS P1 b); a fireless blast or a landing: the side the event did not come from
  const wd = Number(burst?.wd), ws = Number(burst?.ws) || 0;
  const away = Array.isArray(rec.dir) && (rec.dir[0] || rec.dir[1]) ? -Math.sign(rec.dir[0] || 1) : 0;
  const side = burst && ws > 0.05 && Number.isFinite(wd) && Math.abs(Math.cos((wd * Math.PI) / 180)) > 0.2 ? -Math.sign(Math.cos((wd * Math.PI) / 180))
    : away || (h01(`${seed}|side`) < 0.5 ? -1 : 1);
  W({ key: "main", role: "main", kind: main.kind, wo: { loud: main.loud, ...(main.long ? { long: main.long } : {}), ...(main.prefix ? { prefix: true } : {}) },
    t: main.t, x: at.x, y: at.y, r: main.r, box, rank: main.rank, side, ms: main.kind === "boom" || main.kind === "thunder" ? 1100 : 800,
    stage: { in: "slam", push: true, glow: burst ? "auto" : undefined } });

  /* ---- PRE: what comes before, building to the MAIN; a travelling PRE word is gone PRE_GAP before the flash frame */
  const preRide = (pts, kind, wo, rank, extra = {}) => {
    const t = T0 + pts[0].ms;
    W({ key: extra.key ?? `pre|${kind}`, role: "pre", kind, wo, t, x: pts[0].x, y: pts[0].y, r: grid * 0.4, rank, ride: pts.map((q) => ({ x: q.x, y: q.y, ms: q.ms - pts[0].ms })),
      ms: pts.at(-1).ms - pts[0].ms, stage: { in: "grow", out: "dissolve" }, ...extra });
  };
  if ( fall && !meteor ) {
    // a bomb's whistle on the falling body: from the side it comes from, down to just above the impact, growing as it nears
    const d = Array.isArray(fall.from) ? fall.from : [0.5, -0.85], L = Math.hypot(d[0], d[1]) || 1, ux = d[0] / L, uy = d[1] / L;
    const t0 = Math.max(Number(fall.at) || -1200, -1200) + 150, t1 = -PRE_GAP - 60, D = 4.2 * grid;
    const pts = [0, 0.5, 0.8, 1].map((f) => { const k = 1 - f; return { x: at.x - ux * D * k, y: at.y - uy * D * k - grid * (0.9 + 2.6 * k), ms: Math.round(t0 + (t1 - t0) * f) }; });
    preRide(pts, "zoom", { loud: 0.45, long: 0.8 }, 2, { grow: [0.55, 1] });
  }
  if ( rocket && Array.isArray(rocket.to) && Array.isArray(rocket.m) ) {
    const flm = Math.max(150, Number(rocket.fl) || 400), launch = -flm;
    if ( rocket.shot ) {
      // with a shooter: the launch's backblast at the tube's rear (its own source, pointing back), then the flight
      const dx = rocket.to[0] - rocket.m[0], dy = rocket.to[1] - rocket.m[1], L = Math.hypot(dx, dy) || 1;
      const rx = rocket.m[0] - (dx / L) * grid * 0.7, ry = rocket.m[1] - (dy / L) * grid * 0.7;
      W({ key: "pre|launch", role: "pre", kind: "whump", wo: { loud: 0.45 }, t: T0 + launch, x: rx, y: ry, r: grid * 0.4, rank: 2, ms: 500,
        box: { x0: rx - grid * 0.3, y0: ry - grid * 0.3, x1: rx + grid * 0.3, y1: ry + grid * 0.3 }, stage: { in: "pop" }, from: { x: rocket.m[0], y: rocket.m[1] } });
    }
    // the flight: riding behind the rocket along its way (from the view edge without a shooter), gone before the impact
    const t1 = -PRE_GAP - 10, t0 = Math.min(t1 - 120, launch + (rocket.shot ? 60 : 0));
    const pts = [0, 0.35, 0.7, 1].map((f) => { const g = clamp((t0 + (t1 - t0) * f - launch) / flm, 0, 1) * 0.92;
      return { x: rocket.m[0] + (rocket.to[0] - rocket.m[0]) * g, y: rocket.m[1] + (rocket.to[1] - rocket.m[1]) * g - grid * 0.5, ms: Math.round(t0 + (t1 - t0) * f) }; });
    preRide(pts, "rocket", { loud: 0.3, long: clamp(flm / 900, 0.3, 1) }, 2, { grow: [0.7, 1] });
  }
  if ( meteor && ctx.wayOf && ctx.headAt ) {
    // the meteor's descent: riding behind the head down its way, growing fast in the last moments as the head rushes in
    // EFFECTS2: it BUILDS - first a high thin whine far up (a smaller word), then, as the head rushes in for its last stretch, the deep
    // roar (a bigger word): the engine cannot grow a riding word (REQUESTS EFFECTS1-3), so the descent is two words, the second
    // taking over from the first (on the film one riding word stayed tiny at the meteor's zoom and told nothing of the rush)
    const Wy = ctx.wayOf(meteor, grid), lift = ctx.lift ?? 0.5, t0 = Math.max(Wy.at, -1900), t1 = -PRE_GAP - 30, tm = Math.round(t0 + (t1 - t0) * 0.55);
    const seg = (a, b, fs) => fs.map((f) => { const t = a + (b - a) * f, h = ctx.headAt(Wy, t);
      return { x: h.gx - Wy.d[0] * grid * 0.6, y: h.gy - lift * h.z - Wy.d[1] * grid * 0.6, ms: Math.round(t) }; });
    preRide(seg(t0, tm, [0, 0.35, 0.7, 1]), "zoom", { loud: 0.2, long: 0.6 }, 2, { key: "pre|zoom-far", grow: [0.45, 0.7] });
    preRide(seg(tm, t1, [0, 0.4, 0.75, 1]), "zoom", { loud: 0.75, long: 1 }, 3, { key: "pre|zoom", grow: [0.7, 1] });
    // the ground answering: a low rumble at the impact point in the last 900 ms, growing
    W({ key: "pre|rumble", role: "pre", kind: "rumble", wo: { loud: 0.3, long: 0.7 }, t: T0 - 900, x: at.x, y: at.y + grid * 0.6, r: grid * 0.6, rank: 2, ms: 800,
      box: { x0: at.x - grid, y0: at.y - grid * 0.4, x1: at.x + grid, y1: at.y + grid * 0.8 }, stage: { holdKind: "rattle", out: "dissolve" } });
  }
  if ( land && ctx.fallAt ) {
    // the hero's fall: riding the streak down, leaning along it, gone before the pin
    const lift = ctx.lift ?? 0.5, dur = Math.max(1, Number(land.dur) || 1300), t0 = Math.max(Number(land.at) || -1300, -1100), t1 = -PRE_GAP - 20;
    const pts = [0, 0.4, 0.75, 1].map((f) => { const t = t0 + (t1 - t0) * f, u = (t - (Number(land.at) || -dur)) / dur, P = ctx.fallAt(land, u, { grid, ap: 1, lift, squash: 0.8 });
      return { x: P.x + grid * 0.5, y: P.y - lift * P.z - grid * 0.2, ms: Math.round(t) }; });
    preRide(pts, "zoom", { loud: 0.5, long: 0.85 }, 2, { grow: [0.5, 1] });
  }
  if ( bounce ) {
    // a grenade's bounce: two ticks where it hops (repeat is right: the same small knock twice)
    const b0 = Number(bounce.at) || -500, dur = Number(bounce.dur) || 500;
    [0, 0.55].forEach((f, i) => W({ key: `pre|bounce${i}`, role: "pre", kind: "impact", wo: { loud: 0.2 + 0.05 * i, material: "@ground" }, t: T0 + b0 + dur * f,
      x: at.x - (i ? 0.35 : 0.8) * grid * (rec.dir?.[0] ?? 0.7), y: at.y - (i ? 0.35 : 0.8) * grid * (rec.dir?.[1] ?? 0.7) - grid * 0.35, r: grid * 0.2, rank: 1, ms: 300, stage: { in: "pop" } }));
  }
  if ( strike ) {
    // the charge building over the spot: three ticks, each longer (SPEC-EFFECTS P5)
    [-900, -560, -260].forEach((t, i) => W({ key: `pre|charge${i}`, role: "pre", kind: "zap", wo: { loud: 0.12 + 0.08 * i, long: 0.2 + 0.25 * i }, t: T0 + t,
      x: at.x + (i - 1) * grid * 0.45, y: at.y - grid * 0.5, r: grid * 0.25, rank: 1, ms: 260 + 60 * i, stage: { in: "pop" } }));
  }

  /* ---- WAVE: one wave word per firing (shock dust + air ring + burst are one wave), riding out with the front to its reach */
  const waveLv = shock ? clamp(Math.round(shock.lv ?? 2), 1, 3) : ring ? 2 : 0;
  if ( main.kind !== "shockwave" && (waveLv >= 2 || (ring && !burst)) ) {
    const reach = shock ? shock.r ?? 2 * sq : (Number(ring?.reach) || 2.6) * sq, rim = shock ? 2.2 * SHOCK_TAU[waveLv] * 1000 : 560;
    const r0 = Math.max(grid * 0.5, main.r * 0.85), a = Math.PI * (side < 0 ? -0.18 : -0.82);   // (opposite the MAIN word, a little up)
    const ux = Math.cos(a), uy = Math.sin(a), t = (Number(shock?.q) || T0) + 60;
    W({ key: "wave", role: "wave", kind: "shockwave", wo: { loud: 0.45 + 0.12 * waveLv + (meteor ? 0.15 : 0), long: clamp(rim / 1600, 0.3, meteor ? 0.65 : 0.5) }, t, x: at.x + ux * r0, y: at.y + uy * r0,
      r: reach * 0.3, rank: meteor ? 3 : 2, ms: Math.round(rim), wave: { at: { x: at.x, y: at.y }, r0, reach, rim },
      ride: [{ x: at.x + ux * r0, y: at.y + uy * r0, ms: 0 }, { x: at.x + ux * reach * 0.75, y: at.y + uy * reach * 0.75, ms: Math.round(rim * 0.6) }, { x: at.x + ux * reach, y: at.y + uy * reach, ms: Math.round(rim) }],
      stage: { in: "grow", out: "dissolve" } });
  }

  /* ---- FALL: debris coming down after the blast, big pieces first, then smaller (the story resolves): the farthest landings */
  const PIECES = ["large", "medium", "small"];
  const falls = [];
  // (every landing of the firing: a client whose view does not hold the chosen spot letters the landing nearest in time that it
  // can see - live at a close zoom the farthest chunks all landed off the screen and the debris words were dropped: pickSpot)
  const landCands = [];
  if ( meteor && Array.isArray(meteor.rocks) ) for ( const r of meteor.rocks ) if ( Number.isFinite(r[2]) ) landCands.push({ x: r[0], y: r[1], ms: r[2] });
  if ( burst?.db ) for ( let i = 0; i + 2 < burst.db.length; i += 3 ) if ( Number.isFinite(burst.db[i + 2]) ) landCands.push({ x: (burst.p?.[0] ?? at.x) + burst.db[i], y: (burst.p?.[1] ?? at.y) + burst.db[i + 1], ms: burst.db[i + 2] });
  if ( meteor && Array.isArray(meteor.rocks) && meteor.rocks.length ) {
    // the meteor's ejecta: rocks land one by one; five lettered (first, last, three between), from big to small
    const R = meteor.rocks.map((r) => ({ x: r[0], y: r[1], ms: r[2] })).filter((r) => Number.isFinite(r.ms)).sort((a, b) => a.ms - b.ms);
    const n = Math.min(5, R.length), pick = Array.from({ length: n }, (_, i) => R[Math.round((i * (R.length - 1)) / Math.max(1, n - 1))]);
    pick.forEach((q, i) => falls.push({ ...q, pieces: i < 2 ? "large" : i < 4 ? "medium" : "small", kind: "debris" }));
  } else if ( burst && (burst.lv ?? 2) >= 2 ) {
    const d = burst.db ?? [], p = burst.p ?? [at.x, at.y], L = [];
    for ( let i = 0; i + 2 < d.length; i += 3 ) if ( Number.isFinite(d[i + 2]) ) L.push({ x: p[0] + d[i], y: p[1] + d[i + 1], ms: d[i + 2], dist: Math.hypot(d[i], d[i + 1]) });
    const n = (burst.lv ?? 2) >= 3 ? 3 : 2;
    let pick = L.sort((a, b) => b.dist - a.dist).slice(0, n).sort((a, b) => a.ms - b.ms);
    if ( !pick.length ) pick = Array.from({ length: n }, (_, i) => { const a2 = Math.PI * (0.15 + 0.7 * h01(`${seed}|deb${i}`)) + (i % 2 ? Math.PI : 0);
      return { x: at.x + Math.cos(a2) * main.r * 1.3, y: at.y + Math.sin(a2) * main.r, ms: 420 + 340 * i }; });
    pick.forEach((q, i) => falls.push({ ...q, pieces: PIECES[Math.min(2, i + (n === 2 ? 1 : 0))], kind: "debris" }));
  } else if ( burst ) {
    // a grenade: its shrapnel flies on past the blast (far side from the throw), then a little grit comes down
    const d = Array.isArray(rec.dir) ? rec.dir : [1, 0], L = Math.hypot(d[0], d[1]) || 1;
    W({ key: "shrapnel", role: "fall", kind: "whizz", wo: { loud: 0.35 }, t: main.t + 150, x: at.x + (d[0] / L) * main.r * 1.6, y: at.y + (d[1] / L) * main.r * 1.6 - grid * 0.2,
      r: grid * 0.3, rank: 2, ms: 350, stage: { in: "zip" } });
    falls.push({ x: at.x - (d[0] / L) * main.r * 1.3, y: at.y + main.r * 0.9, ms: 520, pieces: "small", kind: "debris" });
  }
  // (one after another, at least FALL_GAP apart: chunks flying out to the same distance land together, the lettering still steps)
  let tPrev = -Infinity;
  falls.forEach((q, i) => W({ key: `fall${i}`, role: "fall", kind: q.kind, wo: { pieces: q.pieces, material: "@ground", loud: clamp(0.5 - 0.08 * i, 0.2, 0.5) },
    t: (tPrev = main.t + Math.max(380 + 160 * i, q.ms, tPrev - main.t + FALL_GAP)), x: q.x, y: q.y, r: grid * (q.pieces === "large" ? 0.5 : q.pieces === "medium" ? 0.38 : 0.28),
    // (EFFECTS2: sized by rank as a share of the view (sfx-events rankSize), so a gentle step down keeps the last one readable - the
    // old 0.85 x 0.88^i on the engine's magnitude put the meteor's last ejecta words under the legible floor; the first stays under the wave)
    rank: q.pieces === "small" ? 1 : 2, shrink: Math.max(0.75, 0.85 * Math.pow(0.94, i)), ms: 700, stage: { in: "pop", out: "fall" }, cands: landCands }));
  if ( land ) {
    // the landing's cracks: ONE word for all the rays, riding out along one of them (the R run = the ray's time)
    const a = Math.PI * (side < 0 ? 0.25 : 0.75), ux = Math.cos(a), uy = Math.sin(a), r0 = main.r * 0.8, r1 = main.r * 2.6;
    W({ key: "cracks", role: "fall", kind: "crack", wo: { loud: 0.55, long: 0.75 }, t: main.t + 80, x: at.x + ux * r0, y: at.y + uy * r0, r: grid * 0.35, rank: 2, ms: 480,
      ride: [{ x: at.x + ux * r0, y: at.y + uy * r0, ms: 0 }, { x: at.x + ux * r1, y: at.y + uy * r1, ms: 470 }], stage: { in: "zip", out: "shards" } });
  }
  if ( strike ) {
    // steam off the scorched spot, rising
    W({ key: "steam", role: "fall", kind: "hiss", wo: { loud: 0.15, long: 0.6 }, t: main.t + 300, x: at.x - side * grid * 0.6, y: at.y - grid * 0.4, r: grid * 0.3, rank: 1, ms: 1200,
      drift: true, stage: { in: "pop", out: "dissolve" } });
  }

  /* ---- the firing's fires: ONE catch (the first to take), and their dying composed as one arrangement */
  const burning = fires.map((e) => e.st).filter((st) => Number.isFinite(Number(st.q)));
  for ( const st of burning ) out.owned.catch.add(st.id);
  const first = burning.slice().sort((a, b) => (a.q - b.q) || (a.id < b.id ? -1 : 1))[0];
  if ( first ) {
    const lv = first.lv ?? 1, p = first.p ?? [at.x, at.y];
    W({ key: "catch", role: "catch", kind: "fire", wo: { stage: "ignite", loud: clamp(0.25 + 0.15 * lv, 0.3, 0.6) }, t: Number(first.q), gate: first.id, x: p[0], y: p[1],
      r: first.r ?? grid * 0.3, rank: lv >= 2 ? 2 : 1, ms: 900, stage: { in: "rise" },
      cands: burning.map((s) => ({ x: s.p?.[0] ?? at.x, y: s.p?.[1] ?? at.y, ms: Number(s.q) - T0, gate: s.id })).sort((a, b) => a.ms - b.ms) });
  }
  arrangeOuts(burning, { seed, grid }).forEach((h, i) => { out.owned.out.set(h.id, h.o); W({ ...h, key: `out${i}` }); });
  // every fire of the firing whose out the page knows: its own hiss is replaced (the arrangement speaks for all of them)
  for ( const st of burning ) if ( Number.isFinite(Number(st.o)) && !out.owned.out.has(st.id) ) out.owned.out.set(st.id, Number(st.o));
  return out;
}

/**
 * The hisses of fires dying one by one (owner's answer 5: «nicely arranged»): not one per fire, not only the first and the last - a
 * composed line: at most OUT_MAX hisses at least OUT_GAP apart, spread over the dying (the first and the last fire always), alternating
 * sides of their fires, each a little smaller and longer than the one before, the last trailing off. -> [{ role: "out", ... }]
 */
export function arrangeOuts(fires, { seed = "", grid = 100 } = {}) {
  const dying = fires.filter((s) => Number.isFinite(Number(s.o))).sort((a, b) => (a.o - b.o) || (a.id < b.id ? -1 : 1));
  if ( !dying.length ) return [];
  const pick = [dying[0]];
  const want = Math.min(OUT_MAX, dying.length);
  // (spread over the time the fires take to die: the next one at least OUT_GAP later and nearest to its even share of the span)
  const t0 = dying[0].o, t1 = dying.at(-1).o;
  for ( let k = 1; k < want - 1; k++ ) {
    const target = t0 + ((t1 - t0) * k) / (want - 1);
    const c = dying.filter((s) => s.o - pick.at(-1).o >= OUT_GAP && t1 - s.o >= OUT_GAP && !pick.includes(s)).sort((a, b) => Math.abs(a.o - target) - Math.abs(b.o - target))[0];
    if ( c ) pick.push(c);
  }
  if ( dying.length > 1 && dying.at(-1).o - pick.at(-1).o >= Math.min(OUT_GAP, 800) ) pick.push(dying.at(-1));
  pick.sort((a, b) => a.o - b.o);
  return pick.map((s, i) => {
    const last = i === pick.length - 1 && pick.length > 1, p = s.p ?? [0, 0], c = centre(p);
    const sd = (i % 2 ? 1 : -1) * (h01(`${seed}|outside`) < 0.5 ? 1 : -1);
    return { role: "out", id: s.id, o: Number(s.o), kind: "fire", wo: { stage: "out", loud: clamp(0.32 - 0.05 * i, 0.15, 0.32), long: last ? 1 : clamp(0.45 + 0.12 * i, 0.4, 0.8) },
      t: Number(s.o), x: c.x + sd * grid * 0.35, y: c.y - grid * 0.2, r: s.r ?? grid * 0.3, rank: 1, shrink: Math.pow(0.9, i), ms: last ? 2600 : 1600, drift: true, side: sd,
      stage: { in: "pop", out: "dissolve" } };
  });
}
function centre(p) { let x = 0, y = 0, n = 0; for ( let i = 0; i + 1 < p.length; i += 2 ) { x += p[i]; y += p[i + 1]; n++; } return n ? { x: x / n, y: y / n } : { x: 0, y: 0 }; }

/**
 * The way a WAVE word rides out on THIS client's screen (EFFECTS1, live: a fixed angle sent it under the combat panel and through the
 * main word): from the fireball's rim (`r0`) to the wave's reach (`reach`, scene px) along the free direction - away from the boxes
 * `avoid` (the main word as placed here, other words up), off the interface panels `ui`, inside the view `v`; screen-up preferred (a
 * pressure wave read rising off the blast). `wb` = { w, h } the word's box (scene px). -> { a, ride: [{x, y, ms}] }
 */
export function waveRide(at, r0, reach, rim, { avoid = [], ui = [], v = null, wb = { w: 300, h: 100 } } = {}) {
  const box = (x, y) => ({ x0: x - wb.w / 2, y0: y - wb.h / 2, x1: x + wb.w / 2, y1: y + wb.h / 2 });
  const ov = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const A = wb.w * wb.h || 1;
  let best = null;
  for ( let k = 0; k < 16; k++ ) {
    const a = (k / 16) * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
    let pen = uy > 0.2 ? 0.25 : 0;                                       // (screen-up preferred)
    for ( const f of [0.35, 0.7, 1] ) {
      const d = r0 + (reach - r0) * f, b = box(at.x + ux * d, at.y + uy * d);
      pen += (avoid.reduce((s, q) => s + ov(b, q), 0) * 3 + ui.reduce((s, q) => s + ov(b, q), 0) * 4) / A;
      if ( v ) pen += (1 - ov(b, v) / A) * 2;
    }
    if ( !best || pen < best.pen - 1e-9 ) best = { a, ux, uy, pen };
  }
  const p = (f, ms) => ({ x: at.x + best.ux * (r0 + (reach - r0) * f), y: at.y + best.uy * (r0 + (reach - r0) * f), ms });
  return { a: best.a, pen: best.pen, ride: [p(0, 0), p(0.75, Math.round(rim * 0.6)), p(1, Math.round(rim))] };
}

/**
 * The spot a FALL / CATCH word letters on THIS client (pure): its own when it is in the view `v`, else the candidate (a landing, a
 * fire) in view nearest to its moment and not used yet by the page (`used`: a Set of "x,y"); null when none is in view. -> { x, y, ms,
 * gate? } */
/** A riding word's way kept inside the view `v` (scene px) with room for its box `bw` x `bh` (pure): a sound coming from beyond the
    edge (the meteor high up, the hero falling from above the screen) is lettered at the edge it comes through, never cut by it
    (EFFECTS2: live, the meteor's far whine and the hero's fall rode in half off the top of the screen). Times are kept. */
export function rideInView(path, v, bw = 0, bh = 0) {
  if ( !v || !Array.isArray(path) ) return path;
  const mx = Math.min(bw * 0.55, (v.x1 - v.x0) * 0.45), my = Math.min(bh * 0.75, (v.y1 - v.y0) * 0.45);
  return path.map((q) => ({ ...q, x: clamp(q.x, v.x0 + mx, v.x1 - mx), y: clamp(q.y, v.y0 + my, v.y1 - my) }));
}
export function pickSpot(w, v, used = new Set(), T0 = 0) {
  return pickSpots(w, v, used, T0, 1)[0] ?? null;
}
/** The spots a FALL / CATCH word may take on this client, best first (its own, then the candidates in view nearest to its moment),
    at most `n`, distinct: when the first is covered by the story's bigger words still on screen the next is tried (EFFECTS2: live, four
    of the meteor's debris words were dropped under the main word and the wave). */
export function pickSpots(w, v, used = new Set(), T0 = 0, n = 6) {
  const inV = (q) => !v || (q.x >= v.x0 && q.x <= v.x1 && q.y >= v.y0 && q.y <= v.y1);
  const k = (q) => `${Math.round(q.x)},${Math.round(q.y)}`;
  const out = [], seen = new Set(used);
  if ( inV(w) && !seen.has(k(w)) ) { out.push({ x: w.x, y: w.y, ms: w.t - T0, gate: w.gate }); seen.add(k(w)); }
  const c = (w.cands ?? []).filter((q) => inV(q)).sort((a, b) => Math.abs(a.ms - (w.t - T0)) - Math.abs(b.ms - (w.t - T0)));
  for ( const q of c ) { if ( out.length >= n ) break; if ( seen.has(k(q)) ) continue; seen.add(k(q)); out.push(q); }
  return out;
}

/** The engine magnitude of a page word: its rank at the firing's size, a FALL / OUT a notch smaller each (shrink). */
export const pageMag = (w, size = 1) => Math.round(clamp(RANK_MAG[clamp(w.rank | 0, 1, 5)] * Math.sqrt(clamp(size, 0.5, 2)) * (w.shrink ?? 1), 0.1, 2) * 100) / 100;
/** The words of a page a client keeps with room for `room` more (drop order of SPEC-EFFECTS 4.2: FALL first, never the MAIN). */
export function keepWords(words, room) {
  if ( !(room > 0) ) return words.filter((w) => w.role === "main").slice(0, 1);
  const keep = (w) => DROP_ORDER.indexOf(w.role);
  return words.slice().sort((a, b) => keep(b) - keep(a) || a.t - b.t).slice(0, Math.max(1, room)).sort((a, b) => a.t - b.t);
}
/** The engine's material for a page word's `@ground` (the ground the firing hit: its crater's material when known). */
export const materialFor = (wo, ground) => (wo?.material === "@ground" ? GROUND_MAT[ground] ?? "earth" : wo?.material);
