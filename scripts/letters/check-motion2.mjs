// LETR MOTION2: checks of the invincible style's motion (motion.mjs + design.mjs trackTimeline + the engine's track player), as
// measurements of SPEC-MOTION section 6 and SPEC-LOOK P16. Pure part: run(ok, { bank, fontsApi }) from check.mjs. Engine part (fake
// browser of testenv.mjs, its own process because it replaces globals): `node check-motion2.mjs --engine`, prints
// "motion2-engine: N checks, F failed".
import { fileURLToPath } from "node:url";
import { FAMILIES, KIND_MOTION, MOOD_KIND, TRACK_IN, TRACK_HOLD, TRACK_OUT, IN_ALIAS, HOLD_ALIAS, OUT_ALIAS, motionOf, playOpts,
  entranceKeys, exitKeys, keysEnd, holdPose, trackPose, gridAge, letterDrawings, roleLetters, MOTION_MODES, DEFAULT_MOTION } from "./motion.mjs";

const TICK = 1000 / 24, F60 = 1000 / 60;
/* the size of a pose along each axis (the neighbour-frame ratio compares these) */
const dims = (p) => [p.s * p.sx, p.s * p.sy];
const ratio = (a, b) => Math.max(a[0] / b[0], b[0] / a[0], a[1] / b[1], b[1] / a[1]);
const amp = (p) => Math.abs(p.s - 1) + Math.abs(p.sx - 1) + Math.abs(p.sy - 1) + Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.r);

export async function run(ok, { bank, fontsApi }) {
  const { makePlan, MOOD_IDS } = await import("./design.mjs");
  const { createVocab, KIND_IDS } = await import("./words.mjs");
  const plan = (t, o = {}) => makePlan(t, o, fontsApi, []);
  const inv = (t, o = {}, mode = "smooth") => plan(t, { ...o, look: { style: "invincible", motion: mode, ...(o.look ?? {}) } });
  const entMs = (p) => p.timeline.ent.reduce((a, q) => a + q.ticks * TICK, 0);
  const V = createVocab();
  const words = [];
  for ( const id of KIND_IDS ) for ( const loud of [0.35, 0.9] ) {
    const w = V.word(id, { lang: loud > 0.5 ? "en" : "pl", loud, seed: `m2${id}${loud}` });
    words.push({ id, loud, w, po: playOpts(w) });
  }

  /* ---------- 1. the table: every kind has a row, every name is a track motion, aliases land in the lists ---------- */
  {
    const missing = KIND_IDS.filter((k) => !KIND_MOTION[k]);
    ok(!missing.length, `motion2 table: kinds without a motion row: ${missing.join(" ")}`);
    const bad = [];
    for ( const [k, r] of [...Object.entries(FAMILIES), ...Object.entries(KIND_MOTION).map(([k, r]) => [k, { ...FAMILIES[r.family], ...r }])] ) {
      if ( !TRACK_IN.includes(r.in) ) bad.push(`${k}.in=${r.in}`);
      if ( !TRACK_HOLD.includes(r.hold) ) bad.push(`${k}.hold=${r.hold}`);
      if ( !TRACK_OUT.includes(r.out) ) bad.push(`${k}.out=${r.out}`);
      if ( !(r.ms?.[0] > 0 && r.ms[1] >= r.ms[0]) ) bad.push(`${k}.ms`);
    }
    ok(!bad.length, `motion2 table: names outside the track's lists: ${bad.join(" ")}`);
    ok(Object.values(KIND_MOTION).every((r) => FAMILIES[r.family]), "motion2 table: every row names a family");
    /* built-in moods name their typical kind; a registered mood (L.registerMood) moves like the mood it extends */
    const { MOODS } = await import("./design.mjs");
    const kindOfMood = (m) => MOOD_KIND[MOODS[m]?.base ?? m];
    ok(MOOD_IDS.every((m) => KIND_MOTION[kindOfMood(m)]), `motion2 table: every mood has a typical kind (${MOOD_IDS.filter((m) => !KIND_MOTION[kindOfMood(m)]).join(" ")})`);
    ok(Object.values(IN_ALIAS).every((v) => TRACK_IN.includes(v)) && Object.values(HOLD_ALIAS).every((v) => TRACK_HOLD.includes(v)) && Object.values(OUT_ALIAS).every((v) => TRACK_OUT.includes(v)), "motion2 table: legacy motion names map onto track motions");
    ok(MOTION_MODES.includes(DEFAULT_MOTION), "motion2: the default mode is one of the modes");
  }

  /* ---------- 2. deterministic: the seed never changes a kind's row (SPEC-MOTION 6.2: every kind, 50 seeds) ---------- */
  {
    let diff = 0;
    for ( const id of KIND_IDS ) {
      const key = (s) => { const m = motionOf({ kind: id, seed: s, sound: { loud: 0.7, long: 0.5, sharp: 0.7 } }); return [m.in, m.hold, m.out, m.holdMs, m.flash, m.travel, m.rate].join("|"); };
      const k0 = key(1);
      for ( let s = 2; s <= 50; s++ ) if ( key(s * 7919) !== k0 ) { diff++; break; }
    }
    ok(diff === 0, `motion2 determinism: ${diff} kinds whose row changes with the seed`);
    /* on whole plans: the vocabulary's word of one kind keeps its motion across seeds */
    let pdiff = 0;
    for ( const id of KIND_IDS.filter((k, i) => i % 3 === 0) ) {
      const ks = new Set();
      for ( let s = 0; s < 5; s++ ) { const w = V.word(id, { lang: "en", loud: 0.7, seed: `det${id}${s}` }); const p = inv(w.text, { ...playOpts(w), seed: `det${s}` }); ks.add([p.motion.in, p.motion.hold, p.motion.out].join("|")); }
      if ( ks.size !== 1 ) pdiff++;
    }
    ok(pdiff === 0, `motion2 determinism: ${pdiff} kinds whose plans move differently per seed`);
    const a = inv("KRAK!", { kind: "crack", seed: 3 }), b = inv("KRAK!", { kind: "crack", seed: 3 });
    ok(JSON.stringify(a) === JSON.stringify(b), "motion2 determinism: a plan is reproducible");
  }

  /* ---------- 3. the contradictions are gone (SPEC-MOTION 4, 6.4) ---------- */
  {
    let fx = 0, mis = 0, speed = 0, boomBurst = 0, crackWhole = 0, crackN = 0, contact = 0, contactN = 0, track = 0;
    for ( const { id, w, po } of words ) for ( const mode of MOTION_MODES ) {
      const q = inv(w.text, { ...po, seed: `c${id}` }, mode), m = q.motion;
      if ( !q.timeline.track || !m ) { track++; continue; }
      const all = [...q.timeline.ent, ...q.timeline.hold, ...q.timeline.exit];
      /* no sparks / Kirby krackle / impact lines / burst / speed lines drawn into an invincible picture: motion is the pose */
      if ( all.some((x) => x.fx?.length) ) fx++;
      if ( all.some((x) => x.misreg) ) mis++;
      if ( all.some((x) => x.fx?.some((f) => f.t === "speed" || f.type === "speed")) && m.travel === "none" ) speed++;
      if ( m.family === "boom" && (["release", "shards", "crumble"].includes(m.out) || q.timeline.exit.some((x) => x.shards)) ) boomBurst++;
      if ( m.in === "crackIn" ) {
        crackN++;
        const first = q.timeline.ent.find((x) => !x.impact);
        if ( first && first.key === "base" && !first.shards && q.timeline.ent.some((x) => x.key === "crack") ) crackWhole++;
      }
      /* instant attacks: the first entrance picture is the contact (an accent, a smear, or the word at its contact pose: no wind-up) */
      if ( ["dry", "ring"].includes(m.family) && m.in === "slam" ) {
        contactN++;
        const k = entranceKeys(m), p0 = trackPose({ ...m, entKeys: k, exitKeys: exitKeys(m) }, 0, keysEnd(k), 400);
        if ( p0.s >= 1.2 ) contact++;
      }
    }
    ok(track === 0, `motion2: ${track} invincible plans without a motion track`);
    ok(fx === 0, `motion2 contradictions: ${fx} invincible plans draw effects (sparks, krackle, lines, burst) into a picture`);
    ok(mis === 0, `motion2 contradictions: ${mis} invincible plans with plates off register`);
    ok(speed === 0, `motion2 contradictions: ${speed} plans with speed lines and no travel`);
    ok(boomBurst === 0, `motion2 exits: ${boomBurst} booms leave by bursting into pieces (smoke-off, not a second explosion)`);
    ok(crackN > 0 && crackWhole === crackN, `motion2 crack: ${crackWhole}/${crackN} cracking entrances land whole and crack after`);
    ok(contactN > 0 && contact === contactN, `motion2 slam: ${contact}/${contactN} slams are at their biggest on the first frame`);
  }

  /* ---------- 4. per-frame tracking of entrance and hold (60 fps smooth, ones in stepped; SPEC-MOTION 5.10, 6.3, 6.10) ---------- */
  const track = (q) => ({ m: q.motion, ent: entMs(q), hold: q.holdMs, contact: leadContact(q) });
  /* the leading contact pictures (an impact accent, a smear multiple): a step under them is bridged by the drawing */
  function leadContact(q) { let ms = 0; for ( const x of q.timeline.ent ) { if ( !(x.impact || x.smear) ) break; ms += x.ticks * TICK; } return ms; }
  {
    const worst = [];
    let slamBig = 0, slamN = 0, popOk = 0, popN = 0;
    for ( const { id, w, po } of words ) for ( const mode of MOTION_MODES ) {
      const q = inv(w.text, { ...po, seed: `f${id}` }, mode), T = track(q), m = T.m;
      if ( !m || m.in === "choreo" ) continue;
      const step = mode === "smooth" ? F60 : TICK;
      let prev = null, bad = 0;
      for ( let t = 0; t <= T.ent + step; t += step ) {
        const tq = mode === "stepped" ? gridAge(0, t, TICK) : t;
        const p = trackPose(m, t, T.ent, T.hold, null, { W: 3, H: 1 }, tq), d = dims(p);
        if ( prev && t > T.contact + 1e-6 ) { const r = ratio(d, prev); if ( r > 1.4 + 1e-9 ) bad = Math.max(bad, r); }
        prev = d;
      }
      if ( bad ) worst.push(`${id}/${mode}/${m.in} ${bad.toFixed(2)}`);
      if ( m.in === "slam" ) {
        slamN++;
        const s0 = Math.max(...dims(trackPose(m, 0, T.ent, T.hold)));
        let mx = 0; for ( let t = F60; t < T.ent; t += F60 ) mx = Math.max(mx, ...dims(trackPose(m, t, T.ent, T.hold)));
        if ( s0 >= mx ) slamBig++;
      }
      if ( m.in === "pop" ) {
        popN++;
        /* ADVT2 9: a pop never stands small and then jumps: half size or more on the first frame, 0.8 by 50 ms */
        if ( trackPose(m, 0, T.ent, T.hold).s >= 0.5 && trackPose(m, 50, T.ent, T.hold).s >= 0.8 ) popOk++;
      }
    }
    ok(worst.length === 0, `motion2 entrance: scale ratio between neighbouring frames above 1.4 outside a contact picture: ${worst.slice(0, 8).join(", ")}`);
    ok(slamN > 0 && slamBig === slamN, `motion2 slam: ${slamBig}/${slamN} slams biggest on the first frame (contact, no wind-up showing the word)`);
    ok(popN > 0 && popOk === popN, `motion2 pop: ${popOk}/${popN} pops at least half size at once and 0.8 by 50 ms`);
  }
  /* the hold's envelope: falls for hits, rises for swells, steady stays within 15 % (window peaks over the hold) */
  {
    const peaks = (m, H, n = 6) => { const out = []; for ( let j = 0; j < n; j++ ) { let a = 0; for ( let t = j * H / n; t < (j + 1) * H / n; t += 4 ) a = Math.max(a, amp(holdPose(m, t, H))); out.push(a); } return out; };
    const bad = [];
    for ( const id of ["punch", "hammer", "thud", "smash", "clang", "boom", "grenade", "splash"] ) {
      const m = motionOf({ kind: id, sound: { loud: 0.8, long: 0.6 } }), P = peaks(m, m.holdMs);
      if ( m.hold === "beat" ) continue;
      if ( !P.every((v, i) => i === 0 || v <= P[i - 1] * 1.1 + 0.004) || !(P[P.length - 1] < P[0]) ) bad.push(`${id}(${m.hold}: ${P.map((v) => v.toFixed(3)).join(" ")})`);
    }
    for ( const id of ["powerup", "snarl", "cheer"] ) {
      const m = motionOf({ kind: id, sound: { loud: 0.8, long: 0.6 } }), P = peaks(m, m.holdMs);
      if ( !(P[P.length - 1] > P[0] * 1.5) ) bad.push(`${id}(${m.hold} does not rise)`);
    }
    for ( const id of ["purr", "siren", "engine", "rumble"] ) {
      const m = motionOf({ kind: id, sound: { loud: 0.6, long: 0.8 } }), P = peaks(m, m.holdMs, 4), mx = Math.max(...P), mn = Math.min(...P);
      if ( !(mn >= mx * 0.85) ) bad.push(`${id}(${m.hold} not steady: ${P.map((v) => v.toFixed(3)).join(" ")})`);
    }
    ok(!bad.length, `motion2 hold envelope: ${bad.join("; ")}`);
    /* hold length follows the sound: a rumble holds at least 3x a punch (SPEC-MOTION 6.3) */
    const hp = inv(V.word("punch", { lang: "en", loud: 0.8, seed: "hp" }).text, { ...playOpts(V.word("punch", { lang: "en", loud: 0.8, seed: "hp" })), seed: "hp" }).holdMs;
    const wr = V.word("rumble", { lang: "en", loud: 0.8, seed: "hr" }), hr = inv(wr.text, { ...playOpts(wr), seed: "hr" }).holdMs;
    ok(hr >= 3 * hp, `motion2 hold length: rumble ${Math.round(hr)} ms : punch ${Math.round(hp)} ms (at least 3 : 1)`);
  }
  /* rhythm: the size / height signal repeats at the kind's own period (siren, heartbeat, helicopter; within one drawing) */
  {
    const period = (m, H, sig) => {
      const ts = []; let a = sig(holdPose(m, 0, H)), b = sig(holdPose(m, 1, H));
      for ( let t = 2; t < H; t++ ) { const c = sig(holdPose(m, t, H)); if ( b > a && b >= c && b > 1e-4 ) ts.push(t - 1); a = b; b = c; }
      return ts;
    };
    for ( const [id, sig, every] of [["siren", (p) => p.s - 1, 1], ["heartbeat", (p) => p.s - 1, 2], ["helicopter", (p) => -p.y, 1]] ) {
      const m = motionOf({ kind: id, sound: { long: 1 } }), ts = period(m, 4000, sig);
      const gaps = []; for ( let i = every; i < ts.length; i += every ) gaps.push(ts[i] - ts[i - every]);
      gaps.sort((x, y) => x - y);
      const med = gaps[gaps.length >> 1] ?? 0;
      ok(gaps.length >= 2 && Math.abs(med - m.period) <= TICK, `motion2 rhythm: ${id} repeats every ${med} ms (its period ${m.period} ms)`);
    }
  }
  /* letter roles: in a hiss, a growl, an engine, a ring only the sustained run moves (others under 20 % of it; SPEC-MOTION 6.7) */
  {
    const bad = [];
    for ( const [id, text] of [["hiss", "PSSSSHH"], ["snarl", "GRRRRR"], ["engine", "VRRRMMM"], ["clang", "KLANNNG"]] ) {
      const chars = [...text], m = motionOf({ kind: id, chars, mode: "stepped", sound: { loud: 0.7 } }), D = letterDrawings(m, chars.length, chars);
      if ( !D.length ) { bad.push(`${id}: no drawings`); continue; }
      const run = new Set(m.run), mv = (i) => Math.max(...D.map((l) => Math.abs(l[i].x) + Math.abs(l[i].y) + Math.abs(l[i].r) + Math.abs(l[i].sy - 1)));
      const inR = Math.max(...[...run].map(mv)), outR = Math.max(0, ...chars.map((c, i) => (run.has(i) ? 0 : mv(i))));
      if ( !(run.size < chars.length && inR > 0 && outR < 0.2 * inR) ) bad.push(`${id}: run ${[...run].join(",")} in ${inR.toFixed(3)} out ${outR.toFixed(3)}`);
    }
    ok(!bad.length, `motion2 letter roles: ${bad.join("; ")}`);
    ok(JSON.stringify(roleLetters([..."SSSS"], null, "run")) === "[0,1,2,3]" && roleLetters([..."KA-BOOM"], [0, 0, 0, 0, 1, 1, 0], "vowel").join() === "4,5", "motion2 letter roles: run and vowel pickers");
    ok(letterDrawings(motionOf({ kind: "hiss", chars: [..."SSS"] }), 3).length === 0, "motion2 smooth mode: no letter vibration drawings");
  }
  /* reduced motion: fade in, still, fade out in 300-400 ms (REQUESTS FXLT2-4) */
  {
    let bad = 0;
    for ( const id of ["punch", "boom", "crack", "whoosh", "hiss"] ) {
      const w = V.word(id, { lang: "en", loud: 0.8, seed: "rd" }), q = inv(w.text, { ...playOpts(w), seed: "rd", reduced: true }), m = q.motion;
      const xl = keysEnd(m.exitKeys);
      if ( !(m.in === "fade" && m.hold === "still" && m.out === "fade" && xl >= 300 && xl <= 400 && !m.flash && q.timeline.exit.length === 1 && !q.timeline.exit[0].shards) ) bad++;
      const p = trackPose(m, 0, 0, 100, 0, {}, 0), e = trackPose(m, 200, 0, 100, 0);
      if ( !(p.s === 1 && p.sx === 1 && e.x === 0 && e.y === 0 && e.s === 1 && e.a < 1 && e.a > 0) ) bad++;
    }
    ok(bad === 0, `motion2 reduced: ${bad} reduced words do not exit by a plain 300-400 ms fade`);
  }
  /* shared pictures: a smooth word is one hold painting (+ an accent, + a crack); stepped adds only its letter drawings */
  {
    let bad = [];
    for ( const { id, w, po } of words ) {
      const q = inv(w.text, { ...po, seed: `k${id}` }), m = q.motion, all = [...q.timeline.ent, ...q.timeline.hold, ...q.timeline.exit];
      const keys = new Set(all.map((x) => x.key).filter((k) => !/^x\d$/.test(k)));
      if ( all.some((x) => x.key == null) || keys.size > (m.in === "crackIn" ? 3 : 2) ) bad.push(`${id}:${[...keys].join("/")}`);
    }
    ok(!bad.length, `motion2 shared pictures: smooth plans with more paintings than hold + accent (+ crack) (exit pieces apart): ${bad.slice(0, 6).join(" ")}`);
  }
  /* streams: a hiss stream syllable never slams; the stepped mode only changes drawings on the grid (pure: gridAge) */
  {
    const m = motionOf({ kind: "hiss", syllable: true }), mb = motionOf({ kind: "boom", syllable: true });
    ok(m.in === "grow" && m.out === "trailOff" && !m.flash && mb.in !== "slam" && !mb.flash, `motion2 stream: hiss syllable ${m.in}/${m.out}, boom syllable ${mb.in}`);
    let off = 0;
    for ( const t0 of [0, 17, 1003.3, 5123.9] ) for ( let a = 0; a < 2000; a += 7 ) { const g = gridAge(t0, a, 2 * TICK); if ( g > a + 1e-6 || Math.abs(((t0 + g) / (2 * TICK)) - Math.round((t0 + g) / (2 * TICK))) > 1e-6 ) off++; }
    ok(off === 0, `motion2 grid: ${off} sampled ages map off the page clock's shared grid`);
  }
  /* FIN-ENGINE (FXIS-E1 / FXIT-E3, FXIS-E2, FXIS-E4): the word's official contact instant, flash: false, reduced lands on the same contact */
  {
    const bad = [], badF = [], badR = [], badRA = [], badPose = [];
    for ( const { id, w, po } of words ) for ( const mode of MOTION_MODES ) {
      const q = inv(w.text, { ...po, seed: `ct${id}` }, mode), m = q.motion, E = entMs(q);
      if ( !(Number.isFinite(q.contactMs) && q.contactMs >= 0 && q.contactMs <= E + 1e-6) ) { bad.push(`${id}/${mode} ${q.contactMs} of ${E}`); continue; }
      /* what the contact IS: a slam squashes, a drop lands, a pop / burst is at its biggest, a fly-by has arrived */
      if ( m.in !== "choreo" ) {
        const P = (t) => trackPose(m, t, E, q.holdMs, null, {}, t), c = P(q.contactMs);
        let mx = 0; for ( let t = 0; t <= E; t += 4 ) mx = Math.max(mx, P(t).s);
        if ( m.in === "slam" && !(c.sy < 1 && c.sx > 1) ) badPose.push(`${id} slam not squashed at contact`);
        if ( m.in === "drop" && !(Math.abs(c.y) < 0.05 && c.sy < 0.9) ) badPose.push(`${id} drop not landed at contact (y ${c.y.toFixed(2)})`);
        if ( ["pop", "burstIn"].includes(m.in) && !(c.s >= mx - 1e-6) ) badPose.push(`${id} ${m.in} not biggest at contact (${c.s.toFixed(2)} < ${mx.toFixed(2)})`);
        if ( m.in === "zip" && !(Math.abs(c.x) < 0.2) ) badPose.push(`${id} zip not arrived at contact`);
      }
      /* flash: false: no accent picture, the contact one tick earlier when there was one */
      const f = inv(w.text, { ...po, seed: `ct${id}`, flash: false }, mode), had = q.timeline.ent.some((x) => x.impact);
      if ( f.timeline.ent.some((x) => x.impact) || f.motion.flash || Math.abs(f.contactMs - (q.contactMs - (had ? TICK : 0))) > 0.02 ) badF.push(`${id}/${mode} ${q.contactMs}->${f.contactMs}`);
      /* reduced: the same contact as the full seat (with and without the accent), the word invisible before its fade and whole at contact */
      for ( const [full, o] of [[q, {}], [f, { flash: false }]] ) {
        const r = inv(w.text, { ...po, seed: `ct${id}`, reduced: true, ...o }, mode), rm = r.motion;
        if ( Math.abs(r.contactMs - full.contactMs) > 1e-6 ) { badR.push(`${id}/${mode}${o.flash === false ? "/F" : ""} ${full.contactMs} vs reduced ${r.contactMs}`); continue; }
        const RE = entMs(r), a = (t) => trackPose(rm, t, RE, r.holdMs, null, {}, t).a;
        if ( !(a(r.contactMs) > 0.999 && (r.contactMs <= 150 || a(r.contactMs - 150) < 1e-6) && rm.in === "fade") ) badRA.push(`${id}/${mode}`);
      }
    }
    ok(!bad.length, `fin contact: plan.contactMs missing or outside the entrance: ${bad.slice(0, 6).join(", ")}`);
    ok(!badPose.length, `fin contact: the contact key is not the hit: ${badPose.slice(0, 6).join(", ")}`);
    ok(!badF.length, `fin flash:false: accent kept or contact not moved by its tick: ${badF.slice(0, 6).join(", ")}`);
    ok(!badR.length, `fin reduced: a reduced word's contact differs from the full seat's: ${badR.slice(0, 6).join(", ")}`);
    ok(!badRA.length, `fin reduced: the fade does not end on the contact (invisible before, whole at it): ${badRA.slice(0, 6).join(", ")}`);
    /* the legacy style: the first picture with the squash's burst (callers' old guess), flash: false keeps the timing */
    const lg = plan("BLAM!", { mood: "impact", seed: 11, look: { style: "expressive" }, in: "slam" }), lgF = plan("BLAM!", { mood: "impact", seed: 11, look: { style: "expressive" }, in: "slam", flash: false });
    let at = 0; for ( const x of lg.timeline.ent ) { if ( x.fx?.some((g) => g.k === "burst") ) break; at += x.ticks * TICK; }
    ok(Math.abs(lg.contactMs - at) < 0.01 && lgF.contactMs === lg.contactMs && !lgF.timeline.ent.some((x) => x.impact) && entMs(lgF) === entMs(lg), `fin contact legacy: ${lg.contactMs} (burst picture at ${at.toFixed(1)}), flash:false ${lgF.contactMs}`);
  }
  /* the legacy styles stay on their own timeline (the freeze itself is check-look2's P17 and the fingerprint) */
  {
    const c = plan("KRAK!", { mood: "crack", seed: 4, look: { style: "comic" } }), e = plan("KRAK!", { mood: "crack", seed: 4, look: { style: "expressive" } });
    ok(!c.motion && !c.timeline.track && !e.motion && !e.timeline.track, "motion2: comic / expressive plans carry no motion track");
  }
}

/* ---------- the engine part (fake browser): paintings per word, the stepped grid on screen, sustain, streams ---------- */
async function engineChecks() {
  let n = 0, failed = 0;
  const ok = (c, msg) => { n++; if ( !c ) { failed++; console.log("FAIL", msg); } else if ( process.env.LETR_VERBOSE ) console.log("ok  ", msg); };
  const { setup } = await import("./testenv.mjs");
  const block = async (f) => { try { await f(); } catch ( e ) { n++; failed++; console.log("FAIL (threw)", String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ")); } };

  /* one painting for the hold (paint once, move the sprite): at most 3 paintings per word, none after the entrance */
  await block(async () => {
    const E = await setup(); const L = E.engine; L.lookStyle("invincible");
    for ( const [kind, mag] of [["punch", 1.2], ["boom", 1.6], ["whoosh", 0.8], ["hiss", 0.6], ["siren", 0.7], ["thud", 1]] ) {
      const r0 = L.stats.rendered;
      const h = L.sfx(kind, { lang: "en", seed: `p${kind}`, magnitude: mag, space: "world", at: { x: 2000, y: 1500 } });
      let afterEnt = 0, entR = null;
      for ( let t = 0; t < 6000 && h.alive; t += 16 ) { await E.tick(16, 16); if ( h.t0 != null && h.entMs != null && E.now() - h.t0 > h.entMs + 50 ) { entR ??= L.stats.rendered; afterEnt = L.stats.rendered - entR; } }
      const painted = L.stats.rendered - r0;
      ok(painted >= 1 && painted <= 3, `motion2 engine: ${kind} painted ${painted} pictures (one hold painting moved by the sprite; at most 3)`);
      ok(afterEnt === 0, `motion2 engine: ${kind} painted ${afterEnt} pictures after its entrance`);
    }
    ok(E.stats.liveTex.size === 0, `motion2 engine: ${E.stats.liveTex.size} textures alive after the words ended (shared paintings freed once)`);
    E.restoreWarn();
  });

  /* smooth: the sprite's scale changes on every frame of the entrance (60 fps); stepped: only when the page clock crosses the grid */
  await block(async () => {
    const E = await setup(); const L = E.engine; L.lookStyle("invincible");
    for ( const mode of ["smooth", "stepped"] ) {
      const h = L.play("BLAM!", { kind: "punch", seed: `g${mode}`, magnitude: 1.2, space: "world", at: { x: 2000, y: 1500 }, look: { style: "invincible", motion: mode } });
      const rows = [];
      for ( let t = 0; t < 1400 && h.alive; t += 1000 / 60 ) { await E.tick(1000 / 60, 1000 / 60); if ( h.sprite && h.t0 != null ) rows.push({ T: E.now(), age: E.now() - h.t0, sx: h.sprite.scale.x, sy: h.sprite.scale.y, x: h.sprite.position.x }); }
      let changes = 0, offGrid = 0, frames = 0;
      for ( let i = 1; i < rows.length; i++ ) {
        if ( rows[i].age > h.entMs + h.holdMs ) break;
        frames++;
        const ch = Math.abs(rows[i].sx - rows[i - 1].sx) > 1e-9 || Math.abs(rows[i].sy - rows[i - 1].sy) > 1e-9;
        if ( !ch ) continue;
        changes++;
        const q = rows[i].age < h.entMs ? TICK : 2 * TICK;
        /* the drawn channels changed: a grid instant of the page clock must lie in (previous frame, this frame] */
        if ( Math.floor((rows[i].T + 1e-6) / q) === Math.floor((rows[i - 1].T + 1e-6) / q) && Math.floor((rows[i].T + 1e-6) / TICK) === Math.floor((rows[i - 1].T + 1e-6) / TICK) ) offGrid++;
      }
      if ( mode === "smooth" ) ok(frames > 10 && changes >= Math.min(frames, Math.floor(h.entMs / (1000 / 60))) - 1, `motion2 engine smooth: the scale changed on ${changes} of ${frames} frames (every entrance frame)`);
      else ok(changes > 2 && offGrid === 0, `motion2 engine stepped: ${offGrid} of ${changes} drawn changes off the shared grid`);
      if ( mode === "stepped" ) ok(Number.isFinite(h.t0) && Math.abs(h.t0 / (2 * TICK) - Math.round(h.t0 / (2 * TICK))) < 1e-6, `motion2 engine stepped: the word starts on the grid (t0 ${h.t0})`);
    }
    E.restoreWarn();
  });

  /* FIN-ENGINE: L.contactAt / h.contactAt: smooth = start + contactMs, stepped = the next 24 Hz grid instant; the squash shows there */
  await block(async () => {
    const E = await setup(); const L = E.engine; L.lookStyle("invincible");
    for ( const mode of ["smooth", "stepped"] ) for ( const flash of [undefined, false] ) {
      const st = E.now() + 200.3;
      const h = L.play("BLAM!", { kind: "punch", seed: `ca${mode}`, magnitude: 1.2, space: "world", at: { x: 2000, y: 1500 }, startAt: st, flash, look: { style: "invincible", motion: mode } });
      const c = L.contactAt(h), want = st + h.plan.contactMs;
      if ( mode === "smooth" ) ok(Math.abs(c - want) < 1e-6 && h.contactAt === c, `fin contactAt smooth: ${c} = start + ${h.plan.contactMs}`);
      else ok(c >= want - 1e-6 && c < want + TICK && Math.abs(c / TICK - Math.round(c / TICK)) < 1e-6 && h.contactAt === c, `fin contactAt stepped: ${c} on the grid after start + ${h.plan.contactMs}`);
      ok(L.contactAt(h.plan, 1000) >= 1000 + h.plan.contactMs - 1e-6 && L.contactAt({}) === null && L.contactAt(h.plan) === null, "fin contactAt: a plan with a start; nothing without one");
      /* the squash (lowest sy/sx of the sprite) shows on the first frame at or after contactAt */
      let best = Infinity, bestT = null;
      for ( let t = 0; t < 900 && h.alive; t += 1000 / 60 ) { await E.tick(1000 / 60, 1000 / 60); if ( h.sprite && h.shown && E.now() >= st ) { const q = h.sprite.scale.y / h.sprite.scale.x; if ( q < best - 1e-9 ) { best = q; bestT = E.now(); } } }
      ok(bestT != null && bestT >= c - 1e-6 && bestT < c + 1000 / 60 + 1e-6, `fin contact on screen (${mode}${flash === false ? ", flash:false" : ""}): squash at ${bestT?.toFixed(1)}, contactAt ${c.toFixed(1)}`);
      h.stop({ quick: true }); await E.tick(50);
    }
    E.restoreWarn();
  });

  /* L.motionMode switches the default; look.motion wins per word; comic words carry no track */
  await block(async () => {
    const E = await setup(); const L = E.engine; L.lookStyle("invincible");
    ok(L.motionMode() === DEFAULT_MOTION && L.motionModes.join() === MOTION_MODES.join(), "motion2 engine: L.motionMode() reports the default");
    L.motionMode("stepped");
    const a = L.play("ZAP!", { kind: "zap", seed: "mm", space: "world", at: { x: 2000, y: 1500 } });
    const b = L.play("ZAP!", { kind: "zap", seed: "mm", space: "world", at: { x: 2100, y: 1500 }, look: { style: "invincible", motion: "smooth" } });
    const c = L.play("ZAP!", { kind: "zap", seed: "mm", space: "world", at: { x: 2200, y: 1500 }, look: { style: "comic" } });
    await E.tick(400);
    ok(a.plan?.motion?.mode === "stepped" && b.plan?.motion?.mode === "smooth" && c.plan && !c.plan.motion, `motion2 engine: modes ${a.plan?.motion?.mode} / ${b.plan?.motion?.mode} / comic ${c.plan?.motion ? "track" : "none"}`);
    L.motionMode("bogus");
    ok(L.motionMode() === "stepped", "motion2 engine: an unknown mode is ignored");
    L.stopAll?.(); await E.tick(3000);
    E.restoreWarn();
  });

  /* streams and sustain follow the kind: a hiss stream never slams; a steady sustain never accents (60 s of phrases) */
  await block(async () => {
    const E = await setup(); const L = E.engine; L.lookStyle("invincible");
    const s = L.stream({ kind: "hiss", lang: "en", seed: "st", space: "world", at: { x: 2000, y: 1500 }, magnitude: 1, count: 6 });
    const ins = new Set();
    for ( let t = 0; t < 1500; t += 16 ) { await E.tick(16, 16); for ( const h of s.handles ?? [] ) if ( h.plan?.motion ) ins.add(h.plan.motion.in); }
    ok(ins.size > 0 && !ins.has("slam") && !ins.has("pop"), `motion2 engine: hiss stream syllables enter by ${[...ins].join(",") || "nothing seen"} (never slam or pop)`);
    s?.stop?.(); await E.tick(2000);
    const su = L.sustain({ kind: "hiss", lang: "en", space: "world", at: { x: 2000, y: 1500 }, level: 0.9, seed: "sus", look: { style: "invincible" } });
    const seen = new Set();
    for ( let t = 0; t < 60000; t += 500 ) { await E.tick(500, 50); for ( const x of su.history ?? [] ) seen.add(x.kind); }
    su.stop?.(); await E.tick(3000);
    ok(seen.size > 0 && !seen.has("accent") && [...seen].every((k) => ["breath", "stretch"].includes(k)), `motion2 engine: steady sustain treatments over 60 s: ${[...seen].join(",")}`);
    E.restoreWarn();
  });

  console.log(`motion2-engine: ${n} checks, ${failed} failed`);
  return failed;
}

if ( process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--engine") ) process.exit((await engineChecks()) ? 1 : 0);
