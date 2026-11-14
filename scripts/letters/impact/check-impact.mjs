// LETR impact frames: node checks of the pure parts (plans, limits, the photosensitivity guard, the clock, the shapes) and of the
// player on a fake browser (lifecycle, cleanup, the watchdog, hit-stop and punch undone). Run alone: node scripts/letters/impact/check-impact.mjs
// (prints "impact: N checks, F failed"); scripts/letters/check.mjs runs it as section 8f.
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { planImpact, safety, modeFor, frameAt, punchAt, pick, tierOf, stepOf, STEP_AT, peakOf, SERIES_STEP, SERIES_MAX, isFlash, localRadius, isRed, safeColor, SAFE_RED, TICK, LIMITS, FRAMES, FRAME_IDS, KINDS, KIND_IDS, TONES } from "./plan.mjs";
import * as G from "./shapes.mjs";
import { bigTone, dotsReach, burstR, floorOf, paintFrame, backClip, panelOf, panelPoly, localPanelR, blowUp, figureMask, inkPixels, PAINTERS } from "./draw.mjs";

export async function run(ok) {
  const P0 = { enabled: true, motion: "full", flashes: true, photosafe: true, impact: "full" };
  const fullN = (p) => p.frames.filter((f) => f.full).length;
  /* counted here on its own (not through plan.mjs isFlash): a drawing that is full-field or changes the scene's brightness behind it */
  const changesScene = (f) => !!f.full || f.back === "bw" || f.back === "bwinv" || f.back === "split";
  const flashN = (p) => p.frames.filter(changesScene).length;
  const shown = (p) => p.frames.filter((f) => f.type !== "rest");

  /* 1. the tables are whole */
  for ( const id of FRAME_IDS ) {
    const f = FRAMES[id];
    ok(PAINTERS.includes(id), `impact: frame type ${id} has no painter`);
    ok(f.pl && f.en, `impact: frame type ${id} has no label`);
    if ( f.full ) ok(f.safe && FRAMES[f.safe] && !FRAMES[f.safe].full, `impact: full frame ${id} has no safe twin that is not itself full`);
    if ( f.back === "bwinv" || f.back === "split" ) ok(f.full, `impact: ${id} inverts the scene but is not counted as a full frame`);
  }
  ok(FRAME_IDS.length >= 14, "impact: at least 14 frame types");
  /* FXI-ENGINE (ADVI 9): a drawing that changes the scene's brightness is either a counted full-field frame or local: its change stays
     inside a panel of at most localArea. Before: "ink" and "shatter" turned the WHOLE view black and white, uncounted. */
  for ( const id of FRAME_IDS ) {
    const f = FRAMES[id];
    if ( f.back === "bw" || f.back === "bwinv" || f.back === "split" ) ok(f.full || f.local, `impact: ${id} changes the whole scene's brightness but is neither full nor local`);
    ok(isFlash({ ...f, type: id }) === (f.full || f.back === "bw" || f.back === "bwinv" || f.back === "split"), `impact: ${id} flash class`);
  }
  ok(STEP_AT.length === 5 && STEP_AT.includes(0.35) && STEP_AT.includes(0.85) && STEP_AT.includes(1.35), "impact: six steps, the old bounds 0.35 / 0.85 / 1.35 kept");
  ok([0, 0.34, 0.35, 0.59, 0.6, 0.84, 0.85, 1.34, 1.35, 1.69, 1.7, 2].map(stepOf).join() === "0,0,1,1,2,2,3,3,4,4,5,5", "impact: stepOf bounds");
  for ( const id of KIND_IDS ) {
    const K = KINDS[id];
    ok(K.steps.length === 6 && K.tiers.length === 4 && TONES[K.tone] && K.pl && K.en, `impact: kind ${id} has six strengths (four old tiers as a view), a tone and labels`);
    K.steps.forEach((t, i) => { for ( const s of t ) ok(FRAMES[s.type], `impact: kind ${id} step ${i} names an unknown frame ${s.type}`); });
    /* stronger = at least as long, and the strongest uses a full frame */
    const len = K.steps.map((t) => t.reduce((a, s) => a + s.ticks, 0));
    ok(len.every((v, i) => i === 0 || v >= len[i - 1]), `impact: kind ${id} does not get longer with strength (${len})`);
    ok(K.steps[5].some((s) => FRAMES[s.type].full) && K.steps[4].some((s) => FRAMES[s.type].full), `impact: kind ${id} at full strength has no full-field frame`);
    ok(!K.steps[0].some((s) => FRAMES[s.type].full && id !== "crit"), `impact: kind ${id} at its weakest already fills the frame`);
    /* the callers' bound: under 0.85 no full-field frame (the critical aside) */
    for ( const i of [0, 1, 2] ) ok(id === "crit" || !K.steps[i].some((s) => FRAMES[s.type].full), `impact: kind ${id} step ${i} (under 0.85) fills the frame`);
    /* FXI-ENGINE (ADVI 3): blows BUILD: no two steps of a kind are the same drawings */
    const seqs = K.steps.map((t) => t.map((s) => `${s.type}${s.ticks}${s.stop ? "s" : ""}${s.punch}`).join(","));
    ok(new Set(seqs).size === 6, `impact: kind ${id} has two steps with the same drawings`);
    /* a scratch does nothing to the scene (hit, heavy and the area kinds): no flash drawing in steps 0 and 1 */
    if ( ["hit", "heavy", "blast", "slash", "landing", "shock", "word"].includes(id) ) for ( const i of [0, 1] ) ok(!K.steps[i].some((s) => isFlash({ ...FRAMES[s.type], type: s.type })), `impact: kind ${id} step ${i} changes the scene`);
  }
  /* the ladder the owner names (a scratch, a solid hit, a heavy hit, a knock-down, a critical): every rung a different set, and longer or
     with more full-field force than the one before */
  {
    const ladder = [pick({ type: "damage", share: 0.05 }), pick({ type: "damage", share: 0.2 }), pick({ type: "damage", share: 0.45 }), pick({ type: "damage", share: 0.4, fatal: true }), pick({ type: "damage", share: 0.4, crit: true })];
    const plans = ladder.map((x) => planImpact({ ...x, seed: 3, dir: 0 }));
    ok(new Set(plans.map((p) => p.frames.map((f) => f.type).join())).size === 5, `impact: the ladder's rungs are not all different (${plans.map((p) => p.kind + p.step).join(" ")})`);
    const force = (p) => p.frames.filter((f) => f.full).length * 100 + p.frames.filter((f) => f.stop).reduce((a, f) => a + f.ticks, 0) * 5 + p.ticks;
    ok(plans.every((p, i) => i === 0 || force(p) > force(plans[i - 1])), `impact: the ladder does not escalate (${plans.map(force)})`);
    ok(!plans[0].frames.some(isFlash), "impact: a scratch changes the scene");
  }

  /* 2. plans: limits, determinism */
  for ( const kind of KIND_IDS ) for ( const m of [0, 0.2, 0.5, 0.9, 1.2, 1.6, 2, 9, -3, NaN] ) for ( const seed of [1, "a", "roll:xyz"] ) {
    const p = planImpact({ kind, magnitude: m, seed, dir: 30 });
    ok(p.ticks >= 1 && p.ticks <= LIMITS.maxTicks && Math.abs(p.ms - p.ticks * TICK) < 1e-9, `impact: ${kind} m=${m} lasts ${p.ticks} ticks (limit ${LIMITS.maxTicks})`);
    ok(p.frames.every((f) => f.ticks >= 1 && f.ticks <= LIMITS.maxFrameTicks), `impact: ${kind} m=${m} a drawing is held too long`);
    ok(p.frames.filter((f) => f.stop).reduce((a, f) => a + f.ticks, 0) <= LIMITS.maxStopTicks, `impact: ${kind} m=${m} hit-stop over the limit`);
    ok(p.magnitude >= 0 && p.magnitude <= 2 && p.tier === tierOf(p.magnitude), `impact: ${kind} m=${m} magnitude not clamped`);
    const q = planImpact({ kind, magnitude: m, seed, dir: 30 });
    ok(JSON.stringify(p) === JSON.stringify(q), `impact: ${kind} m=${m} seed=${seed} is not the same plan twice`);
  }
  ok(JSON.stringify(planImpact({ kind: "hit", magnitude: 1.5, seed: "a" }).frames.map((f) => f.seed)) !== JSON.stringify(planImpact({ kind: "hit", magnitude: 1.5, seed: "b" }).frames.map((f) => f.seed)), "impact: another seed draws other shapes");
  ok(planImpact({ kind: "nope" }).kind === "hit" && planImpact({}).frames.length > 0, "impact: an unknown kind is a hit");
  /* a caller's own sequence: unknown names dropped, the limits still hold */
  {
    const p = planImpact({ frames: ["slam", "nope", { type: "shadow", ticks: 99, stop: true }, ...Array(40).fill("pop")] });
    ok(p.frames[0].type === "slam" && p.frames[1].type === "shadow" && p.frames[1].ticks === LIMITS.maxFrameTicks && p.ticks === LIMITS.maxTicks, "impact: a custom sequence is cut to the limits");
    ok(planImpact({ frames: ["nope"] }).frames[0].type === "pop", "impact: a sequence of unknown frames is one pop");
    ok(planImpact({ kind: "crit", magnitude: 2, hitstop: false }).frames.every((f) => !f.stop), "impact: hitstop: false holds nothing");
    ok(planImpact({ kind: "crit", magnitude: 2, punch: false }).frames.every((f) => !f.punch), "impact: punch: false moves nothing");
    const d = planImpact({ frames: [{ type: "slam", ticks: 400 }], demo: true });
    ok(d.ticks === LIMITS.galleryTicks, "impact: a gallery frame is held at most galleryTicks");
  }
  ok(planImpact({ dir: 90 }).dir === Math.PI / 2 && planImpact({}).dir === null, "impact: dir in degrees -> radians, none = null");
  ok(planImpact({ colors: ["#123456", "#abcdef"] }).tone.a === "#123456" && planImpact({ tone: "volt" }).tone.a === TONES.volt.a && planImpact({ kind: "slash" }).tone.a === TONES.blood.a, "impact: colours from the call, a tone name, or the kind");

  /* FIN-ENGINE (FXIT-E1 c): a blow's place in a series raises its strength (the same for every caller), capped; peakMs = the blow's tick */
  {
    const b = (s) => planImpact({ kind: "hit", magnitude: 0.4, seed: 2, series: s });
    ok(Math.abs(b(2).magnitude - (0.4 + 2 * SERIES_STEP)) < 1e-9 && b(0).magnitude === 0.4 && b(99).magnitude === b(SERIES_MAX).magnitude && b(-3).magnitude === 0.4 && planImpact({ magnitude: 1.95, series: 4 }).magnitude === 2, "impact: series raises the strength by SERIES_STEP per place, capped");
    ok(b(SERIES_MAX).step > b(0).step, "impact: a series climbs the steps");
    for ( const kind of KIND_IDS ) for ( const m of [0.3, 1, 1.9] ) { const p = planImpact({ kind, magnitude: m, seed: 4 }); ok(p.peakMs === peakOf(p).tick * TICK && p.peakMs < p.ms, `impact: ${kind} m=${m} peakMs is the blow's tick`); }
  }

  /* 3. modes */
  ok(modeFor({ ...P0, enabled: false }) === "off" && modeFor({ ...P0, impact: "off" }) === "off", "impact: the master switch and the own switch turn it off");
  ok(modeFor({ ...P0, motion: "reduced" }) === "static" && modeFor({ ...P0, motion: "auto" }, { osReduced: true }) === "static" && modeFor(P0, { callerReduced: true }) === "static", "impact: reduced motion (setting, OS, caller) = one still drawing");
  ok(modeFor({ ...P0, motion: "full" }, { osReduced: true }) === "full", "impact: motion 'full' overrides the OS switch (as for words)");
  /* FXI-ENGINE (WIRE1-2, WIRE1-3): a caller can only lower */
  ok(modeFor({ ...P0, motion: "auto" }, { osReduced: true, callerReduced: false }) === "static", "impact: a caller's reduced: false overrules the OS reduced-motion switch");
  ok(modeFor(P0, { callerGentle: true }) === "local" && modeFor({ ...P0, impact: "local" }, { callerGentle: false }) === "local" && modeFor({ ...P0, impact: "off" }, { callerGentle: true }) === "off" && modeFor(P0, { callerGentle: true, callerReduced: true }) === "static", "impact: gentle: true lowers to the gentle variant and never raises");
  ok(modeFor({ ...P0, flashes: false }) === "local" && modeFor({ ...P0, motion: "gentle" }) === "local" && modeFor({ ...P0, impact: "local" }) === "local", "impact: flashes off / gentle motion / impact local = the gentle variant");
  ok(modeFor(P0) === "full", "impact: default is full");

  /* 4. the guard */
  for ( const kind of KIND_IDS ) for ( const m of [0.2, 0.6, 1.1, 1.7, 2] ) {
    const mk = () => planImpact({ kind, magnitude: m, seed: 5, dir: 10 });
    const raw = mk();
    /* photosafe: at most fullPerImpact full frames, timing unchanged, the dropped ones became their twins */
    const log = [], a = safety(mk(), P0, { flashLog: log, now: 5000, t0: 5000 });
    ok(fullN(a) <= LIMITS.fullPerImpact && flashN(a) <= LIMITS.fullPerImpact, `impact: ${kind} m=${m} shows ${flashN(a)} flash drawings under the guard`);
    ok(a.ticks === raw.ticks && a.frames.length === raw.frames.length && a.frames.every((f, i) => f.ticks === raw.frames[i].ticks), `impact: ${kind} m=${m} the guard changed the timing`);
    ok(log.length === flashN(a) && log.every((t) => t >= 5000 && t <= 5000 + a.ms), `impact: ${kind} m=${m} flash drawings are logged at their times`);
    ok(a.frames.every((f, i) => f.type === raw.frames[i].type || f.type === FRAMES[raw.frames[i].type].safe), `impact: ${kind} m=${m} a dropped frame is not its safe twin`);
    if ( raw.frames.some((f) => f.type === "slam") && fullN(a) ) ok(a.frames.some((f) => f.type === "slam"), `impact: ${kind} m=${m} the slam is the frame that is kept`);
    /* a second impact in the same second gets no full frame at all; a third one 1.2 s later does again */
    const spent = log.length;
    const b = safety(mk(), P0, { flashLog: log, now: 5300, t0: 5300 });
    ok(flashN(b) <= Math.max(0, LIMITS.fullPerSec - spent), `impact: ${kind} m=${m} a second impact within the second overspends the budget`);
    if ( spent >= LIMITS.fullPerSec ) ok(flashN(b) === 0, `impact: ${kind} m=${m} a second impact within the second still shows ${flashN(b)} flash drawings`);
    const c = safety(mk(), P0, { flashLog: log, now: 5000 + a.ms + 1300, t0: 5000 + a.ms + 1300 });
    ok(flashN(c) === Math.min(flashN(raw), LIMITS.fullPerImpact) || flashN(b) > 0, `impact: ${kind} m=${m} the budget does not come back after a second`);
    /* in ANY rolling second: never more than fullPerSec */
    for ( const t of log ) ok(log.filter((x) => x >= t && x < t + LIMITS.windowMs).length <= LIMITS.fullPerSec, `impact: ${kind} m=${m} more than ${LIMITS.fullPerSec} full frames in one second`);
    /* words' flash frames use the same log */
    const d = safety(mk(), P0, { flashLog: [4900, 5100], now: 5000, t0: 5000 });
    ok(flashN(d) === 0, `impact: ${kind} m=${m} ignores the words' flash frames in the shared log`);
    /* preview spends nothing */
    const lg = []; safety(mk(), P0, { flashLog: lg, now: 0, t0: 0, preview: true });
    ok(lg.length === 0, "impact: a preview plan spends flash budget");
    /* guard off: untouched */
    const e = safety(mk(), { ...P0, photosafe: false }, { flashLog: [], now: 0, t0: 0 });
    ok(fullN(e) === fullN(raw), `impact: ${kind} m=${m} photosafe off still drops frames`);
    /* the gentle variant: no full frame, no hit-stop, no inverted scene */
    for ( const [pr, gen] of [[{ ...P0, flashes: false }], [{ ...P0, motion: "gentle" }], [{ ...P0, impact: "local" }], [P0, true]] ) {
      const glog = [];
      const g = safety(mk(), pr, { flashLog: glog, now: 0, t0: 0, callerGentle: gen });
      ok(g.mode === "local" && fullN(g) === 0 && g.frames.every((f) => !f.stop && f.back !== "bwinv" && f.back !== "split") && g.ticks === raw.ticks, `impact: ${kind} m=${m} gentle variant not gentle`);
      /* the gentle variant's panels still change the scene: the guard counts them too */
      ok(flashN(g) <= LIMITS.fullPerImpact && glog.length === flashN(g), `impact: ${kind} m=${m} gentle variant: ${flashN(g)} uncounted panel flashes`);
      if ( pr.motion === "gentle" ) ok(g.frames.every((f) => !f.punch && f.back !== "chroma"), `impact: ${kind} m=${m} gentle motion still punches or splits`);
    }
    /* reduced motion: one still drawing, no punch, no hit-stop, nothing done to the scene */
    const s = safety(mk(), { ...P0, motion: "reduced" }, { flashLog: [], now: 0, t0: 0 });
    const s1 = shown(s);
    ok(s.mode === "static" && s1.length === 1 && s.frames.every((f) => !f.punch && !f.stop && !f.back && !f.full) && s1[0].ticks <= LIMITS.maxFrameTicks && s.ticks <= LIMITS.maxTicks, `impact: ${kind} m=${m} reduced motion is not one still drawing`);
    /* FXI-ENGINE (ADVI 14): the still drawing stands at the instant of the full plan's blow, not earlier */
    { const pk = peakOf(raw), at = s.frames[0].type === "rest" ? s.frames[0].ticks : 0;
      ok(at === Math.min(pk.tick, LIMITS.maxTicks - s1[0].ticks), `impact: ${kind} m=${m} the still drawing starts at tick ${at}, the blow at ${pk.tick}`); }
    const o = safety(mk(), { ...P0, enabled: false }, {});
    ok(o.mode === "off" && o.frames.length === 0 && o.ms === 0, "impact: off = no drawings");
  }
  ok(isRed(TONES.blood.a) && !isRed(TONES.hero.a) && !isRed(TONES.fire.a) && !isRed("#0b0b10") && !isRed(undefined), "impact: saturated red is recognised");

  /* 5. the clock and the punch */
  {
    const p = planImpact({ kind: "crit", magnitude: 2, seed: 3, dir: 0 });
    ok(frameAt(p, -1) === -1 && frameAt(p, NaN) === -1 && frameAt(p, 0) === 0 && frameAt(p, p.ms - 0.01) === p.frames.length - 1 && frameAt(p, p.ms) === -1, "impact: frameAt edges");
    let a = 0;
    p.frames.forEach((f, i) => { ok(frameAt(p, a + 0.01) === i && frameAt(p, a + f.ticks * TICK - 0.01) === i, `impact: frameAt drawing ${i}`); a += f.ticks * TICK; });
    for ( let i = 0; i < p.frames.length; i++ ) for ( let k = 0; k < 4; k++ ) {
      const q = punchAt(p, i, k);
      if ( !p.frames[i].punch ) { ok(q === null, "impact: a drawing without punch moves"); continue; }
      ok(Math.hypot(q.x, q.y) <= LIMITS.punchMax + 1e-9 && q.s >= 1 && (q.s - 1) / 2 >= Math.hypot(q.x, q.y) - 1e-9, `impact: punch ${i}/${k} beyond the limit or past its zoom margin`);
      if ( k === 0 ) ok(q.x > 0 && Math.abs(q.y) < 1e-9, "impact: the first kick goes along the blow");
    }
    ok(p.frames.some((f) => f.punch > 0) && p.frames.some((f) => f.stop), "impact: a critical punches and holds");
  }
  ok(Math.abs(Math.PI * localRadius(1920, 1080) ** 2 / (1920 * 1080) - LIMITS.localArea) < 1e-9, "impact: the gentle panel's disc is localArea of the viewport");

  /* 6. picking by the event */
  ok(pick({ type: "roll", crit: true }).kind === "crit" && tierOf(pick({ type: "roll", crit: true }).magnitude) === 3, "impact: a critical roll is the strongest critical");
  ok(pick({ type: "damage", share: 0.05 }).kind === "hit" && tierOf(pick({ type: "damage", share: 0.05 }).magnitude) <= 1, "impact: a scratch is a small hit");
  ok(pick({ type: "damage", share: 0.5 }).kind === "heavy" && pick({ type: "damage", share: 0.5 }).magnitude > pick({ type: "damage", share: 0.1 }).magnitude, "impact: more damage = heavier");
  ok(pick({ type: "damage", fatal: true, share: 0.3 }).kind === "ko" && pick({ type: "damage", cut: true }).kind === "slash" && pick({ type: "damage", energy: true }).kind === "shock", "impact: fatal / cut / energy");
  ok(pick({ type: "blast", area: 1 }).kind === "blast" && pick({ type: "blast", area: 5 }).magnitude > pick({ type: "blast", area: 1 }).magnitude && pick({ type: "landing" }).kind === "landing" && pick({ type: "word" }).kind === "word", "impact: blast, landing, word");
  for ( const e of [{}, { share: 99 }, { type: "blast", area: 1e9 }, { type: "roll", magnitude: -5 }] ) { const r = pick(e); ok(r.magnitude >= 0 && r.magnitude <= 2 && KINDS[r.kind], `impact: pick(${JSON.stringify(e)}) out of range`); }

  /* 7. shapes: seeded, finite, where they should be */
  {
    const fin = (p) => p.every(Number.isFinite);
    const s1 = G.star(7, { cx: 100, cy: 100, r: 50, spikes: 12 }), s2 = G.star(7, { cx: 100, cy: 100, r: 50, spikes: 12 }), s3 = G.star(8, { cx: 100, cy: 100, r: 50, spikes: 12 });
    ok(JSON.stringify(s1) === JSON.stringify(s2) && JSON.stringify(s1) !== JSON.stringify(s3) && s1.length === 48 && fin(s1), "impact: star seeded, 2 points per spike");
    const b = G.boundsOf(s1); ok(b.x0 > 100 - 50 * 1.9 && b.x1 < 100 + 50 * 1.9 && G.areaOf(s1) > 0.2 * Math.PI * 2500 && G.areaOf(s1) < Math.PI * 2500 * 2.2, "impact: star size");
    const st = G.star(7, { cx: 0, cy: 0, r: 50, spikes: 12, stretch: 2, ang: 0, long: 0, jitter: 0 }), sb = G.boundsOf(st);
    ok(sb.x1 - sb.x0 > (sb.y1 - sb.y0) * 1.6, "impact: a stretched star is longer along the blow");
    const fl = G.focusLines(3, { cx: 500, cy: 300, rIn: 120, rOut: 1200, n: 50 });
    ok(fl.length === 50 && fl.every((t) => fin(t) && Math.hypot(t[4] - 500, t[5] - 300) >= 120 * 0.84 && Math.hypot(t[0] - 500, t[1] - 300) > 1199), "impact: focus lines stop outside the clear middle and start outside the picture");
    const sl = G.speedLines(3, { cx: 500, cy: 300, ang: 0, W: 1000, H: 600, n: 40, gap: 80 });
    ok(sl.length === 40 && sl.every((q) => fin(q) && Math.abs((q[1] + q[3]) / 2 - 300) >= 79), "impact: speed lines leave the band round the subject clear");
    const sp = G.splat(3, { cx: 0, cy: 0, r: 100, n: 30, ang: 0, spread: 0.8 });
    ok(sp.blobs.length + sp.drops.length === 32 && sp.blobs.every((c) => c[2] > 0 && fin(c)) && sp.drops.every(fin), "impact: splash blobs and drops");
    const right = [...sp.blobs.map((c) => c[0]), ...sp.drops.map((d) => d[0])].filter((x) => x > 0).length;
    ok(right > 20, "impact: a splash is thrown along the blow");
    const dt = G.dots(3, { cx: 0, cy: 0, r0: 40, r1: 300, pitch: 16, ang: 0, fan: 1 });
    ok(dt.length > 50 && dt.every(([x, y, r]) => r > 0 && r <= 8 && Math.hypot(x, y) >= 40 && Math.hypot(x, y) <= 300 && Math.abs(Math.atan2(y, x)) <= 1.0001), "impact: halftone dots inside the fan, shrinking");
    const near = dt.filter(([x, y]) => Math.hypot(x, y) < 100), far = dt.filter(([x, y]) => Math.hypot(x, y) > 240);
    ok(Math.min(...near.map((d) => d[2])) > Math.max(...far.map((d) => d[2])), "impact: dots shrink away from the centre");
    const tr = G.tear(3, { cx: 500, cy: 300, ang: 0.3, W: 1000, H: 600, w: 30 });
    ok(fin(tr.band) && fin(tr.sideA) && fin(tr.sideB) && G.areaOf(tr.sideA) > 1000 * 600 * 0.4 && G.areaOf(tr.band) > 0, "impact: tear band and halves");
    ok(JSON.stringify(G.tear(3, { cx: 500, cy: 300, ang: 0.3, W: 1000, H: 600, w: 30 }).sideA) === JSON.stringify(tr.sideA), "impact: the split backdrop and the drawn tear share one line");
    const cr = G.cracks(3, { cx: 0, cy: 0, r: 200, w: 8, n: 9 });
    ok(cr.cracks.length === 9 && cr.cracks.every(fin) && cr.shards.every((s) => s.length === 6 && fin(s)), "impact: cracks and shards");
    const rg = G.rings(3, { r: 100, w: 10, n: 2 });
    ok(rg.length >= 6 && rg.every((a) => a.r > 0 && a.w > 0 && a.a1 > a.a0), "impact: rings");
  }

  /* 8. painting on a recording context: every type draws, a full frame fills the picture, the gentle panel stays inside its area */
  {
    /* a recording 2D context that also measures how much of the picture each colour covers (polygons by their area, discs and
       ellipses by theirs, strokes by length x width, pictures by their box; overlaps counted twice: an upper bound) */
    const mkCtx = (cv = null) => {
      const log = { rects: [], fills: 0, strokes: 0, clips: 0, pts: [], ops: [], depth: 0, area: new Map() };
      let sub = [], subs = [], circ = 0, len = 0, last = null;
      const stack = [], st = { det: 1 };
      const add = (color, a) => { if ( !(a > 0) ) return; const k = String(color); log.area.set(k, (log.area.get(k) ?? 0) + a * st.det); };
      const closeSub = () => { if ( sub.length >= 6 ) subs.push(sub); sub = []; };
      const over = (t) => (t.globalCompositeOperation ?? "source-over") !== "destination-out";
      const ctx = new Proxy({ log, canvas: cv }, { get: (t, k) => {
        if ( k in t ) return t[k];
        if ( k === "fillRect" ) return (x, y, w, h) => { log.rects.push([x, y, w, h, t.fillStyle]); if ( over(t) ) add(t.fillStyle, Math.abs(w * h)); if ( cv ) cv.__color = t.fillStyle; };
        if ( k === "beginPath" ) return () => { sub = []; subs = []; circ = 0; len = 0; last = null; };
        if ( k === "closePath" ) return () => { closeSub(); };
        if ( k === "fill" ) return () => { log.fills++; log.ops.push(t.globalCompositeOperation ?? "source-over"); closeSub(); if ( over(t) ) add(t.fillStyle, subs.reduce((a, p) => a + G.areaOf(p), 0) + circ); };
        if ( k === "stroke" ) return () => { log.strokes++; add(t.strokeStyle, len * (t.lineWidth ?? 1)); };
        if ( k === "clip" ) return () => { log.clips++; };
        if ( k === "save" ) return () => { log.depth++; stack.push(st.det); };
        if ( k === "restore" ) return () => { log.depth--; st.det = stack.pop() ?? 1; };
        if ( k === "scale" ) return (a, b) => { st.det *= Math.abs(a * b); };
        if ( k === "moveTo" ) return (x, y) => { log.pts.push(x, y); closeSub(); sub = [x, y]; last = [x, y]; };
        if ( k === "lineTo" ) return (x, y) => { log.pts.push(x, y); if ( last ) len += Math.hypot(x - last[0], y - last[1]); sub.push(x, y); last = [x, y]; };
        if ( k === "arc" ) return (x, y, r, a0 = 0, a1 = Math.PI * 2) => { const sw = Math.min(Math.PI * 2, Math.abs(a1 - a0)); circ += 0.5 * r * r * sw; len += r * sw; };
        if ( k === "ellipse" ) return (x, y, rx, ry, rot, a0 = 0, a1 = Math.PI * 2) => { const sw = Math.min(Math.PI * 2, Math.abs(a1 - a0)); circ += 0.5 * rx * ry * sw; len += Math.max(rx, ry) * sw; };
        if ( k === "drawImage" ) return (...a) => { const src = a[0], w = a.length >= 9 ? a[7] : a[3], h = a.length >= 9 ? a[8] : a[4]; if ( src?.__color && over(t) ) add(src.__color, Math.abs((w ?? src.width) * (h ?? src.height))); };
        return () => {};
      }, set: (t, k, v) => ((t[k] = v), true) });
      return ctx;
    };
    const fakeCanvas = (w, h) => { const c = { width: w, height: h }; c.getContext = () => mkCtx(c); return c; };
    const redShare = (ctx, W = 1600, H = 900) => [...ctx.log.area].filter(([c]) => isRed(c)).reduce((a, [, v]) => a + v, 0) / (W * H);
    const env = (o = {}) => ({ W: 1600, H: 900, cx: 800, cy: 450, hx: 760, hy: 450, R: 50, dir: 0, mag: 1.4, step: 4, kind: "hit", tone: TONES.blood, sil: null, local: null, redOk: false, makeCanvas: fakeCanvas, ...o });
    for ( const type of FRAME_IDS ) for ( const dir of [0, null] ) {
      const ctx = mkCtx(), e = env({ dir }), f = { type, seed: 99, back: FRAMES[type].back, full: FRAMES[type].full };
      if ( type === "rest" ) { ok(paintFrame(ctx, e, f) === true && ctx.log.fills + ctx.log.strokes + ctx.log.rects.length === 0, "impact: rest paints nothing"); continue; }
      ok(paintFrame(ctx, e, f) === true && ctx.log.fills + ctx.log.strokes + ctx.log.rects.length > 0, `impact: ${type} paints nothing (dir ${dir})`);
      ok(ctx.log.depth === 0, `impact: ${type} leaves the context saved (dir ${dir})`);
      ok(ctx.log.pts.every(Number.isFinite), `impact: ${type} draws a non-finite point (dir ${dir})`);
      const field = ctx.log.rects.find((r) => r[0] === 0 && r[1] === 0 && r[2] === 1600 && r[3] === 900);
      if ( ["shadow", "glare", "swap", "window"].includes(type) ) ok(!!field, `impact: ${type} does not fill the frame`);
      else ok(!field, `impact: ${type} fills the frame but is not listed for it`);
      if ( field ) ok(!isRed(field[4]), `impact: ${type} fills the frame with saturated red under the guard (${field[4]})`);
      /* FXI-ENGINE (ADVI 9): where a drawing changes the scene: a full-field frame anywhere; any other drawing only inside a panel of at
         most localArea (before: ink and shatter turned the whole view black and white, uncounted) */
      const clip = backClip(e, f);
      if ( f.back && f.back !== "chroma" ) ok(f.full || (clip && G.areaOf(clip) <= LIMITS.localArea * 1600 * 900 * 1.0001), `impact: ${type} changes the scene over ${clip ? (G.areaOf(clip) / (1600 * 900)).toFixed(2) : "all"} of the view without being a full-field frame`);
      /* the gentle variant: clipped to the panel, the panel inside localArea */
      const cl = mkCtx(), el = env({ dir, local: { r: localRadius(1600, 900) } });
      paintFrame(cl, el, f);
      ok(cl.log.clips >= 1 && cl.log.depth === 0, `impact: ${type} gentle variant is not clipped to its panel`);
      ok(G.areaOf(panelOf(el, f)) <= LIMITS.localArea * 1600 * 900, `impact: ${type} gentle panel larger than localArea`);
      if ( f.back ) ok(JSON.stringify(backClip(el, f)) === JSON.stringify(panelOf(el, f)), `impact: ${type} gentle variant changes the scene outside its panel`);
    }
    /* FXI-ENGINE (ADVI 18): under the guard saturated red covers at most LIMITS.redArea of ANY drawing (the knock-out's shadow frame put
       red spikes over the black field), for every frame type, red accents, strengths, a small and a big subject, with and without a
       picture; the guard off keeps the red */
    {
      const src = fakeCanvas(64, 64);
      const pic = { src, sx: 0, sy: 0, sw: 64, sh: 64, w: 90, h: 90, rot: 0 };
      let worst = 0, worstAt = "";
      for ( const type of FRAME_IDS ) for ( const tone of [TONES.blood, { a: "#ff0000", b: "#ee1111" }, { a: "#ffd400", b: "#e3202a" }] ) for ( const o of [{}, { sil: pic }, { R: 420, mag: 2, step: 5 }, { step: 1, mag: 0.4, sil: pic }, { dir: null, sil: pic }] ) {
        const ctx = mkCtx(), e = env({ tone, ...o });
        paintFrame(ctx, e, { type, seed: 7, back: FRAMES[type].back, full: FRAMES[type].full });
        const r = redShare(ctx);
        if ( r > worst ) { worst = r; worstAt = `${type} ${tone.a}/${tone.b} ${JSON.stringify(Object.keys(o))}`; }
      }
      ok(worst <= LIMITS.redArea, `impact: under the guard saturated red covers ${(worst * 100).toFixed(1)} % of a drawing (${worstAt}; limit ${LIMITS.redArea * 100} %)`);
      const raw = mkCtx(); paintFrame(raw, env({ redOk: true, tone: TONES.blood }), { type: "shadow", seed: 7 });
      ok(redShare(raw) > LIMITS.redArea, "impact: the guard off keeps the red (the measure sees red at all)");
      ok(isRed("#e3202a") && isRed("#ff0000") && isRed("#c80000") && isRed("rgb(230, 20, 30)") && !isRed(SAFE_RED) && !isRed(TONES.fire.a) && !isRed(TONES.hero.a) && safeColor("#ff0000") === SAFE_RED && safeColor("#ffd400") === "#ffd400", "impact: saturated red (R / (R+G+B) >= 0.7) and its safe crimson");
    }
    /* red may fill the frame only with the guard off */
    { const ctx = mkCtx(); paintFrame(ctx, env({ redOk: true }), { type: "swap", seed: 1 }); ok(isRed(ctx.log.rects[0][4]), "impact: guard off: the swap frame takes the red accent"); }
    ok(!isRed(bigTone(env())[0]) && isRed(bigTone(env())[1]) && isRed(bigTone(env({ redOk: true }))[0]) && bigTone(env({ tone: TONES.hero }))[0] === TONES.hero.a, "impact: under the guard the wide star of a frame-filling drawing is not saturated red (red moves to the core)");
    ok(dotsReach(env(), 5000) ** 2 * Math.PI <= 0.2501 * 1600 * 900 && dotsReach(env(), 120) === 120, "impact: the halftone stays inside a quarter of the picture whatever the size of the subject");
    ok(burstR(env({ R: 900, mag: 2 })) ** 2 * Math.PI <= 0.1601 * 1600 * 900 && burstR(env({ R: 50, mag: 1 })) < burstR(env({ R: 900, mag: 2 })), "impact: the star of a big subject stays inside a sixth of the picture");
    ok(backClip(env(), { type: "tear", seed: 4, back: "split" })?.length > 8 && backClip(env(), { type: "slam", seed: 4, back: "bwinv" }) === null && backClip(env(), { type: "pop", seed: 4, back: null }) === null, "impact: the split frame clips the scene's change; a full slam changes all of it");
    for ( const R of [10, 50, 300, 2000] ) ok(G.areaOf(panelPoly(env({ R, mag: 2 }), { type: "ink", seed: 3 })) <= LIMITS.localArea * 1600 * 900 && localPanelR(env({ R })) > 0, `impact: the black-and-white panel round the blow stays inside localArea (subject radius ${R})`);
    /* FXI-ENGINE (ADVI 3): a weak blow keeps the struck figure in sight: its star is small (under the figure's own size), a strong one is big */
    { const pic = { w: 120, h: 120 };
      ok(burstR(env({ R: 60, sil: pic, step: 1, mag: 0.45 })) < 60 && burstR(env({ R: 60, sil: pic, step: 2, mag: 0.7 })) < burstR(env({ R: 60, sil: pic, step: 3, mag: 1 })), "impact: the star grows with the step, a scratch's star is smaller than the figure");
      ok(burstR(env({ R: 60, sil: pic, step: 2, mag: 0.62 })) < burstR(env({ R: 60, sil: pic, step: 2, mag: 0.84 })), "impact: inside one step a stronger blow draws a bigger star (a series builds)"); }
    /* FIN-ENGINE (FXIT-E2, ADVI 16): sized from the subject on screen: a 20 px token at a far zoom gets a star of a few token widths, not one
       sized for the viewport; an ordinary token (~100 px) keeps the view's floor; no subject keeps it too */
    for ( const st of [1, 2, 4] ) {
      const pic = { w: 20, h: 20 }, small = burstR(env({ R: 10, sil: pic, step: st, mag: 1 })), u = 900;
      ok(small <= Math.max(10 * 4, u * 0.03) * 1.0001 && small >= u * 0.03 * 0.5 - 1e-9, `impact: step ${st}: a 20 px token's star radius ${small.toFixed(0)} px (a few token widths, legible)`);
      ok(burstR(env({ R: 50, sil: { w: 100, h: 100 }, step: st, mag: 1 })) === Math.max(50 * (st <= 1 ? 0.5 : st === 2 ? 0.85 : 1.6), u * (st <= 1 ? 0.04 : st === 2 ? 0.07 : 0.13)), `impact: step ${st}: an ordinary token keeps the view's floor`);
    }
    ok(burstR(env({ R: 0, step: 4, mag: 1 })) === 900 * 0.13 && floorOf(env({ R: 0 }), 0.2, 9) === 900 * 0.2, "impact: no subject: the view's floor");
    ok(localPanelR(env({ R: 10, mag: 1 })) < localPanelR(env({ R: 50, mag: 1 })) && localPanelR(env({ R: 10, mag: 1 })) <= Math.max(10 * 5, 27) + 1e-9, "impact: the black-and-white panel of a far-zoom token stays round it");
    /* the silhouette: enlarged to its share of the frame, never shrunk */
    ok(blowUp(env()) === 1 && blowUp(env({ sil: { w: 40, h: 40 } })) > 3 && blowUp(env({ sil: { w: 900, h: 900 } })) === 1 && blowUp(env({ sil: { w: 1, h: 1 } })) === 8, "impact: silhouette blow-up range");
    { const src = fakeCanvas(64, 64); const ctx = mkCtx(); const e = env({ sil: { src, sx: 0, sy: 0, sw: 64, sh: 64, w: 80, h: 80, rot: 0 } });
      for ( const type of ["shadow", "glare", "swap", "slam", "smear", "chroma"] ) ok(paintFrame(ctx, e, { type, seed: 5 }) && ctx.log.depth === 0, `impact: ${type} with a silhouette`);
      /* FIN-ENGINE: the figure (cut-out, tints) of one picture is worked out once and shared by every impact on it */
      { const src2 = fakeCanvas(64, 64); let made = 0; const mk2 = (w, h) => { made++; return fakeCanvas(w, h); };
        const ea = env({ makeCanvas: mk2, sil: { src: src2, sx: 0, sy: 0, sw: 64, sh: 64, w: 80, h: 80, rot: 0 } });
        paintFrame(mkCtx(), ea, { type: "shadow", seed: 5 }); const first = made; made = 0;
        const eb = env({ makeCanvas: mk2, sil: { src: src2, sx: 0, sy: 0, sw: 64, sh: 64, w: 80, h: 80, rot: 0 } });
        paintFrame(mkCtx(), eb, { type: "shadow", seed: 5 });
        ok(first > 1 && made <= 1, `impact: a second impact on the same picture reuses its figure (${first} canvases, then ${made})`); }
      ok(e._tints.size >= 3, "impact: silhouette tints are cached per colour"); }
    /* FXI-ENGINE (builder's list): a ROUND portrait token is not an inked disc: its background is cut away by the rim's colour, the
       head and shoulders stay; a figure with its own transparent background keeps its alpha; a busy picture keeps the disc */
    {
      const S = 96, mk = (paint) => { const d = new Uint8ClampedArray(S * S * 4); for ( let y = 0; y < S; y++ ) for ( let x = 0; x < S; x++ ) { const c = paint(x + 0.5, y + 0.5); if ( c ) d.set(c, (y * S + x) * 4); } return d; };
      const C = S / 2, inDisc = (x, y, r = C - 1) => Math.hypot(x - C, y - C) <= r;
      const portrait = mk((x, y) => {
        if ( !inDisc(x, y) ) return null;
        if ( Math.hypot(x - C, y - C) > C - 5 ) return [216, 194, 122, 255];                          // the rim
        if ( Math.hypot((x - C) / 22, (y - C * 0.9) / 27) <= 1 ) return [233, 191, 152, 255];       // the face
        if ( y > C * 1.45 && Math.abs(x - C) < 40 ) return [122, 31, 43, 255];                      // the shoulders
        return [80 + y * 0.4, 110 + y * 0.3, 150, 255];                                             // a gradient background
      });
      const m = figureMask(portrait, S, S);
      const share = m.mask.reduce((a, v) => a + v, 0) / (Math.PI * (C - 1) ** 2);
      ok(m.round && m.kind === "disc" && m.cut && share > 0.15 && share < 0.6, `impact: a round portrait's background is cut away (figure ${(share * 100).toFixed(0)} % of the disc)`);
      ok(m.mask[Math.round(C * 0.9) * S + Math.round(C)] === 1 && m.mask[Math.round(C * 0.35) * S + Math.round(C * 0.4)] === 0, "impact: the face stays, the background goes");
      const fig = mk((x, y) => (Math.hypot((x - C) / 20, (y - C) / 40) <= 1 ? [200, 30, 40, 255] : null));
      const mf = figureMask(fig, S, S);
      ok(!mf.round && mf.kind === "alpha" && mf.mask.reduce((a, v) => a + v, 0) > 1500, "impact: a figure with its own background keeps its alpha");
      let s0 = 11; const rnd = () => ((s0 = (s0 * 16807) % 2147483647) / 2147483647);
      const busy = mk((x, y) => (inDisc(x, y) ? [rnd() * 255, rnd() * 255, rnd() * 255, 255] : null));
      const mb = figureMask(busy, S, S);
      ok(mb.round && !mb.cut, "impact: a busy round picture keeps its disc (nothing guessed away)");
      const art = inkPixels(portrait, S, S, m.mask, false), neg = inkPixels(portrait, S, S, m.mask, true);
      let inkN = 0, papN = 0, flip = 0;
      for ( let i = 0; i < S * S; i++ ) if ( m.mask[i] ) { if ( art[i * 4] < 40 ) inkN++; else papN++; if ( (art[i * 4] < 40) !== (neg[i * 4] < 40) ) flip++; }
      ok(inkN > 0 && papN > inkN * 0.5 && flip === inkN + papN, "impact: the inked picture has ink and paper, and its negative swaps them");
    }
  }

  /* FXI-ENGINE (ADVI 12, WIRE1-4): the per-client choice full / local / off is a row of the engine's own settings window */
  {
    const { SETTINGS, DEFAULTS } = await import("../prefs.mjs");
    const { STRINGS } = await import("../strings.mjs");
    const ui = fs.readFileSync(new URL("../ui.mjs", import.meta.url), "utf8");
    ok(SETTINGS.impact?.type === "pick" && SETTINGS.impact.choices.join() === "full,local,off" && DEFAULTS.impact === "full", "impact: the setting impact = full | local | off, default full");
    ok(/\["flashes", "photosafe", "impact",/.test(ui), "impact: the impact row sits in the settings window's Access group");
    for ( const lang of ["en", "pl"] ) for ( const k of ["Name", "Hint", "full", "local", "off"] ) ok(typeof STRINGS[lang][`LETR.Settings.impact.${k}`] === "string", `impact: setting words ${lang} ${k}`);
  }

  /* 9. the player on a fake browser (its own process: it replaces globals) */
  if ( !process.env.LETR_IMPACT_LIFE ) {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--life"], { encoding: "utf8", env: { ...process.env, LETR_IMPACT_LIFE: "1" }, timeout: 120000 });
    for ( const l of (r.stdout ?? "").split("\n").filter((x) => x.startsWith("FAIL")) ) console.log(l);
    ok(r.status === 0, `impact life: ${(r.stdout ?? "").trim().split("\n").at(-1)} ${r.stderr ? r.stderr.slice(0, 400) : ""}`);
  }
}

/* ---------- the player's lifecycle on the engine's fake browser (testenv.mjs) ---------- */
async function life(ok) {
  const { setup } = await import("../testenv.mjs");
  const E = await setup();
  const { createImpact } = await import("./index.mjs");
  const board = document.createElement("div"); board.style.translate = "1px 2px"; board.style.scale = "";
  document.getElementById = (id) => (id === "board" ? board : null);
  document.createElementNS = (ns, t) => { const el = document.createElement(t); el.querySelectorAll = () => [{ setAttribute() {} }, { setAttribute() {} }]; return el; };
  let started = true, stops = 0, starts = 0;
  globalThis.canvas ??= {};
  canvas.app = { ...(canvas.app ?? {}), ticker: { get started() { return started; }, stop() { started = false; stops++; }, start() { started = true; starts++; } }, view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } };
  const P = { enabled: true, motion: "full", flashes: true, photosafe: true };
  const tools = { state: { flashLog: [] } };
  const I = createImpact({ get prefs() { return P; } }, tools);
  const kids = () => document.body.children.flatMap((r) => r.children ?? []).length;
  const liveCv = () => E.stats.liveCanvases.size;

  /* a critical: runs its ticks, then everything is gone */
  let h = I.play({ kind: "crit", magnitude: 2, seed: 1, dir: 0, subject: { x: 800, y: 450 } });
  ok(h.alive && h.plan.frames.length >= 5 && I.busy, "impact life: a critical starts");
  ok(h.plan.frames.filter((f) => f.full).length <= 2 && tools.state.flashLog.length === h.plan.frames.filter((f) => f.full).length, "impact life: the guard ran on the engine's own flash log");
  await E.tick(60);
  ok(h.isReady && h.idx >= 0 && kids() === 1, "impact life: the first drawing is up");
  let sawStop = false, sawPunch = false, maxCv = 0;
  for ( let t = 0; t < h.plan.ms + 80; t += 16 ) { await E.tick(16); if ( !started ) sawStop = true; if ( board.style.translate !== "1px 2px" ) sawPunch = true; maxCv = Math.max(maxCv, liveCv()); }
  ok(sawStop && sawPunch, "impact life: the critical held the ticker and shoved the board");
  ok(!h.alive && (await h.finished) === "done" && !I.busy, "impact life: it ends by itself");
  ok(kids() === 0 && liveCv() === 0, `impact life: nothing left (${kids()} nodes, ${liveCv()} canvases)`);
  ok(started && stops === starts && board.style.translate === "1px 2px" && board.style.scale === "", "impact life: ticker running, the board's own transform back");
  ok(maxCv <= h.plan.frames.length + 2, "impact life: at most one canvas per drawing");
  ok(I.stats.played === 1 && I.stats.last.why === "done" && I.stats.last.frames === h.plan.frames.length, "impact life: stats");

  /* stop() in the middle of a hit-stop frees everything at once */
  await E.tick(1500);
  h = I.play({ kind: "ko", magnitude: 2, seed: 2, subject: { x: 100, y: 100 } });
  for ( let i = 0; i < 20 && started; i++ ) await E.tick(16);
  ok(!started, "impact life: the knock-out holds the ticker");
  h.stop();
  ok(started && !h.alive && kids() === 0 && liveCv() === 0 && (await h.finished) === "stopped", "impact life: stop() frees the ticker and the layer");

  /* the watchdog: the frame loop dies (a hidden tab), the timer still ends the impact */
  await E.tick(1500);
  const raf0 = globalThis.requestAnimationFrame;
  h = I.play({ kind: "crit", magnitude: 2, seed: 3, subject: { x: 100, y: 100 } });
  await E.tick(50);
  globalThis.requestAnimationFrame = () => 0;
  await E.tick(h.plan.ms + 400);
  globalThis.requestAnimationFrame = raf0;
  ok(!h.alive && started && kids() === 0 && liveCv() === 0 && board.style.translate === "1px 2px", "impact life: the watchdog ends an impact whose frame loop died");

  /* one at a time: weaker refused, stronger replaces */
  await E.tick(1500);
  const a = I.play({ kind: "hit", magnitude: 1, seed: 4 }); await E.tick(20);
  const b = I.play({ kind: "hit", magnitude: 0.5, seed: 5 });
  ok(!b.alive && (await b.finished) === "busy" && a.alive, "impact life: a weaker impact during another is not shown");
  const c = I.play({ kind: "hit", magnitude: 1.8, seed: 6 });
  ok(c.alive && !a.alive && (await a.finished) === "replaced", "impact life: a stronger one takes over");
  await E.tick(700);
  ok(!c.alive && kids() === 0 && liveCv() === 0, "impact life: clean after a take-over");

  /* a shared start: nothing before startAt, the same drawing at the same instant, late = not shown */
  await E.tick(1500);
  const t0 = performance.now() + 200;
  h = I.play({ kind: "heavy", magnitude: 1.2, seed: 7, startAt: t0 });
  await E.tick(150);
  ok(h.alive && h.idx === -1 && h.plan.frames.every((f) => f.cv), "impact life: before startAt nothing shows and every drawing is painted ahead");
  await E.tick(50 + 16 + 2.5 * TICK);
  ok(h.idx === frameAt(h.plan, performance.now() - t0) || h.idx === frameAt(h.plan, performance.now() - t0 - 16), `impact life: on the shared clock (drawing ${h.idx})`);
  await E.tick(700);
  const late = I.play({ kind: "hit", magnitude: 1, startAt: performance.now() - 2000 });
  ok(!late.alive && (await late.finished) === "late" && kids() === 0, "impact life: an impact whose time is over is not shown");

  /* modes: off, reduced, gentle */
  await E.tick(1500);
  P.enabled = false; const off = I.play({ kind: "crit", magnitude: 2 });
  ok(off.off && !off.alive && (await off.finished) === "off" && kids() === 0, "impact life: lettering off = no impact"); P.enabled = true;
  await I.setMode("off"); ok(I.mode() === "off" && I.play({ kind: "crit", magnitude: 2 }).off, "impact life: its own switch off"); await I.setMode("full");
  P.motion = "reduced"; h = I.play({ kind: "crit", magnitude: 2, seed: 8 });
  ok(h.mode === "static" && h.plan.frames.filter((f) => f.type !== "rest").length === 1, "impact life: reduced motion = one drawing");
  stops = 0; await E.tick(400);
  ok(!h.alive && stops === 0 && board.style.translate === "1px 2px", "impact life: reduced motion never holds or shoves"); P.motion = "full";
  P.flashes = false; h = I.play({ kind: "crit", magnitude: 2, seed: 9 });
  ok(h.mode === "local" && h.plan.frames.every((f) => !f.full && !f.stop) && h.env.local.r <= localRadius(innerWidth, innerHeight) + 1e-6, "impact life: flashes off = the gentle variant in its panel");
  await E.tick(700); P.flashes = true;

  /* prepare: painted ahead, played later, canvases reused; an unplayed one can be dropped by playing nothing */
  await E.tick(1500);
  const pr = I.prepare({ kind: "blast", magnitude: 1.5, seed: 10, subject: { x: 500, y: 400 } });
  ok(pr.plan.frames.every((f) => f.cv) && tools.state.flashLog.filter((t) => t > performance.now() - 100).length === 0, "impact life: prepare paints every drawing and spends no flash budget");
  const before = I.stats.painted;
  h = pr.play();
  await E.tick(h.plan.ms + 100);
  ok(!h.alive && I.stats.painted === before && liveCv() === 0, "impact life: a prepared impact is not painted again and leaves nothing");

  /* a hidden token: not shown to this client */
  canvas.ready = true; canvas.stage = { scale: { x: 1 }, toGlobal: (p) => p };
  const tok = { center: { x: 10, y: 10 }, document: { documentName: "Token", hidden: true }, visible: false };
  const hid = I.play({ kind: "crit", magnitude: 2, subject: tok });
  ok(!hid.alive && (await hid.finished) === "hidden", "impact life: an impact on a token this client cannot see is not shown");
  tok.visible = true; tok.document.hidden = false;
  await E.tick(1500);
  h = I.play({ kind: "hit", magnitude: 1, subject: tok, seed: 11 });
  ok(h.alive && h.env.cx >= 10, "impact life: a visible token is the subject"); h.stop();
  /* FXI-ENGINE (WIRE1-1): a `from` token this user cannot see gives no direction (it would tell where it stands) */
  { const att = { center: { x: 400, y: 10 }, document: { documentName: "Token", hidden: false }, visible: false };
    h = I.play({ kind: "hit", magnitude: 1, subject: tok, from: att, seed: 12 });
    ok(h.alive && h.env.dir == null, "impact life: an attacker this user cannot see gives no direction"); h.stop();
    att.visible = true;
    h = I.play({ kind: "hit", magnitude: 1, subject: tok, from: att, seed: 13 });
    ok(h.alive && Number.isFinite(h.env.dir) && Math.abs(Math.abs(h.env.dir) - Math.PI) < 0.01, `impact life: a visible attacker gives the direction (${h.env.dir})`); h.stop();
    att.visible = false;
    h = I.play({ kind: "hit", magnitude: 1, subject: tok, from: att, vision: "none", seed: 14 });
    ok(h.alive && Number.isFinite(h.env.dir), "impact life: vision: none shows the hidden attacker's direction (the caller's choice)"); h.stop(); }
  /* FXI-ENGINE (WIRE1-3, WIRE1-2): a caller's gentle: true gives the gentle variant; reduced: false does not overrule the OS switch */
  h = I.play({ kind: "crit", magnitude: 2, seed: 15, gentle: true });
  ok(h.mode === "local" && h.plan.frames.every((f) => !f.full && !f.stop), "impact life: gentle: true = the gentle variant"); h.stop();
  { const mm = globalThis.matchMedia; globalThis.matchMedia = (q) => ({ matches: /reduce/.test(q) });
    P.motion = "auto"; h = I.play({ kind: "crit", magnitude: 2, seed: 16, reduced: false });
    ok(h.mode === "static", "impact life: reduced: false does not overrule the OS reduced-motion switch"); h.stop();
    globalThis.matchMedia = mm; P.motion = "full"; }

  /* FIN-ENGINE: a series planned ahead (every blow called at once with its own startAt, apart in time) plays EVERY blow; one at a time
     still holds for windows that overlap (seen live: the ladder's first four blows were "replaced" by the critical before they began) */
  await E.tick(1500);
  { const t0 = performance.now() + 100, hs = [0.4, 0.9, 1.5].map((m, i) => I.play({ kind: "hit", magnitude: m, seed: 30 + i, startAt: t0 + i * 700, subject: { x: 400, y: 300 } }));
    ok(hs.every((x) => x.alive) && I.busy, "impact life: three blows scheduled apart are all alive");
    const over = I.play({ kind: "hit", magnitude: 0.2, seed: 40, startAt: t0 + 700 + 20 });
    ok(!over.alive && (await over.finished) === "busy", "impact life: a weaker blow overlapping a scheduled one is refused");
    await E.tick(2400);
    const why = await Promise.all(hs.map((x) => x.finished));
    ok(why.every((w) => w === "done"), `impact life: every scheduled blow played (${why.join(",")})`);
    ok(kids() === 0 && liveCv() === 0 && started, "impact life: clean after a series"); }
  /* FIN-ENGINE: painting ahead is shared out per display frame over every waiting impact (live: five blows called at once painted five
     full-view drawings in one frame = a 70 ms frame) */
  await E.tick(1500);
  { const t0 = performance.now() + 2000, p0 = I.stats.painted;
    const hs = [0.4, 0.7, 1.0, 1.3, 1.7].map((m, i) => I.play({ kind: "crit", magnitude: m, seed: 50 + i, startAt: t0 + i * 900, subject: { x: 400, y: 300 } }));
    await E.tick(16);
    const n1 = I.stats.painted - p0;
    ok(hs.every((x) => x.alive) && n1 >= 1 && n1 <= 2, `impact life: at most two drawings painted ahead per frame over five waiting impacts (${n1})`);
    await E.tick(1500);
    ok(hs.every((x) => x.plan.frames.every((f) => f.cv)), "impact life: every waiting impact is still painted in time");
    I.stopAll(); }
  /* FIN-ENGINE: blowAt = the instant of the blow: the impact starts peakMs earlier */
  await E.tick(1500);
  { const at = performance.now() + 300;
    h = I.play({ kind: "hit", magnitude: 1.5, seed: 21, blowAt: at, subject: { x: 300, y: 300 } });
    ok(h.alive && h.plan.peakMs > 0 && Math.abs(h.t0 - (at - h.plan.peakMs)) < 1e-6, `impact life: blowAt starts the impact ${h.plan.peakMs} ms before the blow`);
    /* seen live: with blowAt alone drawing 0 stood on screen from the call until the blow */
    let early = -1; while ( performance.now() < h.t0 - 20 ) { await E.tick(16); if ( h.idx >= 0 ) { early = performance.now(); break; } }
    ok(early < 0, `impact life: nothing shows before a blowAt impact's start (shown ${early < 0 ? "never" : Math.round(h.t0 - early) + " ms early"})`);
    await E.tick(60); ok(h.idx >= 0, "impact life: then it shows"); h.stop(); }
  /* FIN-ENGINE (FXIS-E3): keep a rectangle readable: every drawing and the scene's change get a hole there, following it */
  await E.tick(1500);
  { const box = { x: 700, y: 400, w: 200, h: 80 };
    h = I.play({ kind: "crit", magnitude: 2, seed: 22, subject: { x: 800, y: 440 }, keep: box, keepPad: 4 });
    let holes = 0, backHoles = 0, frames = 0, follow = false;
    for ( let t = 0; t < h.plan.ms + 60 && h.alive; t += 16 ) {
      await E.tick(16);
      const f = h.plan.frames[h.idx]; if ( !f?.cv ) continue; frames++;
      const cp = String(f.cv.style.clipPath ?? "");
      if ( /evenodd/.test(cp) && /M(696|716).0 396.0 H(904|924).0 V484.0 H(696|716).0 Z/.test(cp) ) holes++;
      if ( h.back.style.display !== "none" && /evenodd/.test(String(h.back.style.clipPath)) && /M(696|716).0 396.0/.test(String(h.back.style.clipPath)) ) backHoles++;
      else if ( h.back.style.display !== "none" ) backHoles -= 100;
      if ( t > 100 && !follow ) { box.x = 720; await E.tick(16); follow = String(h.plan.frames[h.idx]?.cv?.style.clipPath ?? "").includes("M716.0 396.0"); }
    }
    ok(frames > 3 && holes >= frames - 2, `impact life: keep cuts the box out of every drawing (${holes}/${frames})`);
    ok(backHoles >= 0, "impact life: keep cuts the box out of the scene's change too");
    ok(follow, "impact life: the kept box is followed when it moves");
    ok(kids() === 0 || h.alive, "impact life: keep leaves nothing");
    const g = I.play({ kind: "hit", magnitude: 1, seed: 23 }); await E.tick(60);
    ok(!String(g.plan.frames[g.idx]?.cv?.style.clipPath ?? "").includes("evenodd"), "impact life: no keep, no hole"); g.stop(); }

  /* scene change */
  h = I.play({ kind: "hit", magnitude: 1.9, seed: 12 }); await E.tick(30); I.stopAll();
  ok(!h.alive && kids() === 0 && started, "impact life: stopAll");
}

if ( process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href ) {
  let n = 0, failed = 0;
  const ok = (c, msg) => { n++; if ( !c ) { failed++; console.log("FAIL", msg); } };
  if ( process.argv.includes("--life") ) await life(ok); else await run(ok);
  console.log(`impact${process.argv.includes("--life") ? " life" : ""}: ${n} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
