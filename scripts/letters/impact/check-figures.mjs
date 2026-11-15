// LETR IMPACT3 (1.9.20): the figures take part in the impact frames (their own art inverted / posterised / inked / in its own colours,
// a lit rim on their true outline, flares, knock-back echoes, the frame's shake and the held palette jumps). Checks: the ladders as
// designed (every rung escalates, every drawing inside the guard, the hit-stop on the figures), the safety limits of every new effect at
// every step (gentle and reduced seats get rims only, the figures' area cap, no saturated red from any art, no change of the scene),
// seat equality (plans with the figures' part are one pure function of the call; a hidden token never takes part), the table settings
// full / local / off, and the cost (a picture's art is worked out once, a bounded number of draw calls per drawing).
// Run from check-impact.mjs (`run`), or alone: node scripts/letters/impact/check-figures.mjs -> "impact figures: N checks, F failed".
import { fileURLToPath, pathToFileURL } from "node:url";
import { planImpact, safety, isFlash, peakOf, FRAMES, KINDS, KIND_IDS, LIMITS, TONES, FIG, FIG_BRIGHT, isRed, TICK } from "./plan.mjs";
import { paintFrame, figTreat, invPixels, postPixels, origPixels, redSafePixels, rimColor, ENLARGED } from "./draw.mjs";

const P0 = { enabled: true, motion: "full", flashes: true, photosafe: true, impact: "full" };
const MAGS = [0.2, 0.45, 0.7, 1.1, 1.5, 1.9];   // one per step

export async function run(ok) {
  /* 1. the tables */
  ok(FRAMES.fig && FRAMES.fig.back === null && !FRAMES.fig.full && FRAMES.cracks && FRAMES.cracks.back === null && !FRAMES.cracks.full, "figures: fig and cracks leave the scene alone (no flash class)");
  for ( const id of KIND_IDS ) {
    const K = KINDS[id];
    K.steps.forEach((st, i) => {
      for ( const s of st ) if ( s.fig !== undefined ) ok(Object.hasOwn(FIG, s.fig), `figures: ${id} step ${i} names an unknown figure treatment ${s.fig}`);
      /* designed inside the guard: a lone impact is never thinned (at most fullPerImpact flash drawings) */
      const fl = st.filter((s) => isFlash({ ...FRAMES[s.type], type: s.type })).length;
      ok(fl <= LIMITS.fullPerImpact, `figures: ${id} step ${i} lists ${fl} flash drawings (the guard would thin it)`);
    });
    if ( id === "word" ) continue;
    /* every rung lets the figures take part; from step 3 the hit-stop holds on the figures, their palette jumps (at least one negative /
       posterised drawing after the blow), the figure stands in its own colours on the scene's negative */
    K.steps.forEach((st, i) => ok(st.some((s) => s.fig), `figures: ${id} step ${i} leaves the figures out`));
    for ( const i of [3, 4, 5] ) {
      const st = K.steps[i], pk = peakOf({ frames: st });
      ok(st.some((s) => s.type === "fig" && s.stop) || id === "slash" && i === 3 && st.some((s) => s.stop && s.fig), `figures: ${id} step ${i}: the hit-stop does not hold on the figures`);
      ok(st.slice(pk.index + 1).some((s) => s.fig === "i" || s.fig === "p"), `figures: ${id} step ${i}: no palette jump after the blow`);
      ok(st.some((s) => (s.type === "slam" || s.type === "tear" || s.type === "window") && s.fig === "o"), `figures: ${id} step ${i}: the figures do not stand in their own colours on the negative`);
    }
    for ( const i of [4, 5] ) ok(K.steps[i].some((s) => s.kick === -1) && K.steps[i].filter((s) => s.punch > 0).length >= 2, `figures: ${id} step ${i}: the frame does not shake (punch then kick back)`);
    /* the figures' part builds: palette drawings (i, p, k) never fewer at a stronger step */
    const jumps = K.steps.map((st) => st.filter((s) => FIG_BRIGHT.has(s.fig)).length);
    ok(jumps.every((v, i) => i === 0 || v >= jumps[i - 1]), `figures: ${id}: the figures' palette jumps do not build with the strength (${jumps})`);
    /* the strongest is plainly the most: the longest, the most palette jumps, a full hit-stop */
    const st5 = K.steps[5];
    ok(st5.reduce((a, s) => a + s.ticks, 0) === LIMITS.maxTicks && st5.filter((s) => s.stop).reduce((a, s) => a + s.ticks, 0) >= 3, `figures: ${id} step 5 is not the longest held cut`);
  }
  { const c5 = KINDS.crit.steps[5], spect = (st) => st.filter((s) => s.fig).length + st.filter((s) => s.punch > 0).length + st.filter((s) => FRAMES[s.type].full).length;
    ok(KIND_IDS.every((id) => spect(KINDS[id].steps[5]) <= spect(c5)), "figures: the strongest critical is the most spectacular picture of all kinds"); }
  /* frames differ from hit to hit: the palette order and the rim's accent change with the seed (the same seed, the same everywhere) */
  { const seqs = new Set(), tones = new Set();
    for ( let i = 0; i < 24; i++ ) { const p = planImpact({ kind: "hit", magnitude: 1.5, seed: `hit:${i}` }); seqs.add(p.frames.map((f) => f.fig ?? "-").join("")); tones.add(p.rimTone); }
    ok(seqs.size >= 2 && tones.size === 2, `figures: the palette and the rim's accent vary from hit to hit (${seqs.size} orders, ${tones.size} accents)`);
    ok(JSON.stringify(planImpact({ kind: "crit", magnitude: 1.9, seed: "x" })) === JSON.stringify(planImpact({ kind: "crit", magnitude: 1.9, seed: "x" })), "figures: same call, same plan (figures included)"); }
  /* a caller's own sequence gets the figures' part by rule; a caller can only lower */
  { const p = planImpact({ frames: ["lines", { type: "window", ticks: 2, punch: 1 }, "chroma", { type: "lines", ticks: 2 }], seed: 4 });
    ok(p.frames.map((f) => f.fig).join() === "r,o,i,p" || p.frames.map((f) => f.fig).join() === "r,o,p,i", `figures: a caller's sequence gets rim, own colours, then the palette jumps (${p.frames.map((f) => f.fig)})`);
    const q = planImpact({ frames: [{ type: "pop", fig: "k" }, "fade"], seed: 4 });
    ok(q.frames[0].fig === "k" && !q.frames[1].fig, "figures: a caller's own fig per drawing is kept");
    ok(planImpact({ kind: "crit", magnitude: 2, figures: false }).frames.every((f) => !f.fig), "figures: figures: false = none");
    ok(planImpact({ kind: "crit", magnitude: 2, figures: "rim" }).frames.every((f) => !f.fig || f.fig === "r"), "figures: figures: 'rim' = rims only");
    ok(planImpact({ kind: "crit", magnitude: 2, figures: true }).frames.some((f) => f.fig === "i" || f.fig === "p"), "figures: figures: true raises nothing beyond the default"); }

  /* 2. safety of every new effect at every step */
  for ( const kind of KIND_IDS ) for ( const m of MAGS ) for ( const seed of [1, "b", "roll:77"] ) {
    const mk = () => planImpact({ kind, magnitude: m, seed, dir: 20 });
    const full = safety(mk(), P0, { flashLog: [], now: 0, t0: 0 });
    ok(full.frames.filter(isFlash).length <= LIMITS.fullPerImpact, `figures: ${kind} m=${m} flash drawings over the guard`);
    ok(full.frames.every((f) => f.type !== "fig" && f.type !== "cracks" || (!f.back && !f.full)), `figures: ${kind} m=${m} a figures' drawing changes the scene`);
    for ( const pr of [{ ...P0, impact: "local" }, { ...P0, flashes: false }, { ...P0, motion: "gentle" }] ) {
      const g = safety(mk(), pr, { flashLog: [], now: 0, t0: 0 });
      ok(g.frames.every((f) => !f.fig || f.fig === "r"), `figures: ${kind} m=${m} gentle (${JSON.stringify(pr).slice(0, 40)}): the figures' art changes brightness`);
      ok(g.frames.every((f) => !f.kick || f.punch > 0), `figures: ${kind} m=${m} gentle: a kick without a punch`);
    }
    const s = safety(mk(), { ...P0, motion: "reduced" }, { flashLog: [], now: 0, t0: 0 });
    ok(s.frames.every((f) => !f.fig || f.fig === "r") && s.frames.filter((f) => f.type !== "rest").length === 1, `figures: ${kind} m=${m} reduced motion: one still drawing, rims only`);
    const o = safety(mk(), { ...P0, impact: "off" }, {});
    ok(o.frames.length === 0, `figures: ${kind} m=${m} off draws figures`);
    /* the guard over a series (a second blow in the same second) still holds with the figures */
    const log = []; safety(mk(), P0, { flashLog: log, now: 1000, t0: 1000 }); const b = safety(mk(), P0, { flashLog: log, now: 1300, t0: 1300 });
    for ( const t of log ) ok(log.filter((x) => x >= t && x < t + LIMITS.windowMs).length <= LIMITS.fullPerSec, `figures: ${kind} m=${m} more than ${LIMITS.fullPerSec} flash drawings in a second`);
    ok(b.frames.every((f) => f.fig === undefined || Object.hasOwn(FIG, f.fig)), "figures: a thinned impact keeps valid figure treatments");
  }
  /* the area cap: the figures' art may change brightness only while they cover at most figArea of the view */
  { const W = 1600, H = 900, sil = (w) => ({ src: {}, sx: 0, sy: 0, sw: 64, sh: 64, w, h: w, rot: 0 });
    const env = (figs, o = {}) => ({ W, H, figs, local: null, ...o });
    const f = { type: "fig", fig: "i", seed: 1 };
    const small = env([{ role: "target", cx: 800, cy: 450, sil: sil(100), area: 0.78 }]);
    ok(figTreat(small, f).each[0] === "i", "figures: a token of 100 px keeps its negative");
    const big = env([{ role: "target", cx: 800, cy: 450, sil: sil(320), area: 0.78 }]);
    ok(figTreat(big, f).each[0] === "r", "figures: a token of 320 px on a 1600 x 900 view (over figArea) gets the rim only");
    const many = env([0, 1, 2, 3].map((i) => ({ role: i ? "also" : "target", cx: 200 * i, cy: 450, sil: sil(140), area: 0.78 })));
    const tm = figTreat(many, f);
    ok(tm.each[0] === "i" && tm.each.includes("r") && tm.area <= LIMITS.figArea * 1600 * 900, `figures: four tokens share the area cap, the struck one first, the rest get the rim (${tm.each}, ${(tm.area / (1600 * 900) * 100).toFixed(2)} %)`);
    for ( const n of [1, 2, 3, 5, 8] ) for ( const w of [40, 90, 150, 260] ) { const tt = figTreat(env(Array.from({ length: n }, (_, i) => ({ role: i ? "also" : "target", cx: 100 * i, cy: 450, sil: sil(w), area: 0.9 }))), f);
      ok(tt.area <= LIMITS.figArea * 1600 * 900 + 1e-6, `figures: ${n} figures of ${w} px: art changes over ${(tt.area / (1600 * 900) * 100).toFixed(2)} % of the view (cap ${LIMITS.figArea * 100} %)`); }
    ok(figTreat({ ...small, local: { r: 100 } }, f).each.every((x) => x === "r"), "figures: the gentle panel draws rims only");
    ok(figTreat(small, { ...f, fig: "o" }).each[0] === "o" && figTreat(big, { ...f, fig: "o" }).each[0] === "o", "figures: their own colours are no change of their art (no cap)");
    ok(figTreat(small, { ...f, fig: undefined }) === null && figTreat(env([]), f) === null, "figures: no treatment or no figure = nothing");
    for ( const t of ENLARGED ) ok(figTreat(small, { ...f, type: t }) === null, `figures: ${t} shows the struck figure enlarged: no second copy at its place`);
    const two = env([{ role: "target", cx: 800, cy: 450, sil: sil(100), area: 0.78 }, { role: "from", cx: 300, cy: 450, sil: sil(100), area: 0.78 }]);
    ok(figTreat(two, { ...f, type: "shadow" }).list.length === 1 && figTreat(two, { ...f, type: "shadow" }).list[0].role === "from", "figures: on a black frame the attacker stands at its place beside the enlarged struck figure");
  }
  /* no saturated red from any art: a cyan costume inverts to red, a red one stays red: both become the deep crimson */
  { const px = [[0, 255, 255, 255], [255, 0, 0, 255], [20, 230, 220, 255], [250, 60, 70, 255], [255, 255, 255, 255], [12, 12, 16, 255], [200, 30, 30, 0], [90, 200, 60, 255], [255, 120, 140, 255]];
    const d = new Uint8ClampedArray(px.flat()), n = px.length;
    const red = (o) => { let c = 0; for ( let i = 0; i < o.length; i += 4 ) if ( o[i + 3] > 0 && isRed(`rgb(${o[i]}, ${o[i + 1]}, ${o[i + 2]})`) ) c++; return c; };
    const inv = invPixels(d), org = origPixels(d), pst = postPixels(d, n, 1, new Uint8Array(n).fill(1).map((v, i) => (px[i][3] > 40 ? 1 : 0)), null, [255, 212, 0]);
    ok(red(inv) === 0 && red(org) === 0 && red(pst) === 0, `figures: no saturated red from the figures' art (inv ${red(inv)}, own ${red(org)}, post ${red(pst)})`);
    ok(inv[4] === 0 && inv[5] === 255 && inv[6] === 255 || isRed(`rgb(${inv[4]},${inv[5]},${inv[6]})`) === false, "figures: the negative of red is cyan");
    ok(inv[16] === 0 && inv[17] === 0 && inv[18] === 0 && inv[20] > 230, "figures: the negative swaps white and black");
    ok(inv[27] === 0 && org[27] === 0, "figures: transparent stays transparent");
    const tones = new Set(); for ( let i = 0; i < pst.length; i += 4 ) if ( pst[i + 3] ) tones.add(`${pst[i]},${pst[i + 1]},${pst[i + 2]}`);
    ok(tones.size === 3, `figures: posterised to three flat tones (${tones.size})`);
    const q = redSafePixels(new Uint8ClampedArray([255, 0, 0, 255, 120, 10, 10, 255])); ok(!isRed(`rgb(${q[0]},${q[1]},${q[2]})`) && !isRed(`rgb(${q[4]},${q[5]},${q[6]})`), "figures: red made safe keeps under the line");
    for ( const tone of Object.values(TONES).concat([{ a: "#ff0000", b: "#ee1111" }, { a: "#e3202a", b: "#ffd400" }]) ) for ( const rt of ["a", "b"] )
      ok(!isRed(rimColor({ tone, rimTone: rt, redOk: false })), `figures: the rim's accent is never saturated red under the guard (${tone.a}/${tone.b} ${rt})`);
  }

  /* 3. painting with figures on a recording context: every drawing type, every figure treatment, bounded draw calls, nothing left saved */
  { let made = 0;
    const mkCtx = (cv) => { const log = { draws: 0, depth: 0, pts: [] }; return new Proxy({ log, canvas: cv }, { get: (t, k) => {
      if ( k in t ) return t[k];
      if ( k === "drawImage" ) return () => { log.draws++; };
      if ( k === "save" ) return () => { log.depth++; };
      if ( k === "restore" ) return () => { log.depth--; };
      if ( k === "getImageData" ) return (x, y, w, h) => { const d = new Uint8ClampedArray(w * h * 4); for ( let i = 0; i < w * h; i++ ) { const xx = i % w, yy = (i / w) | 0; if ( Math.hypot(xx - w / 2, yy - h / 2) < w / 2 - 1 ) d.set([40 + xx, 200 - yy, 220, 255], i * 4); } return { data: d }; };
      if ( k === "createImageData" ) return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if ( k === "moveTo" || k === "lineTo" ) return (x, y) => log.pts.push(x, y);
      return () => {};
    }, set: (t, k, v) => ((t[k] = v), true) }); };
    const fake = (w, h) => { made++; const c = { width: w, height: h }; c.getContext = () => mkCtx(c); return c; };
    const src = fake(128, 128);
    const sil = (w, x) => ({ src, sx: 0, sy: 0, sw: 128, sh: 128, w, h: w, rot: 0.3 });
    const figs = [{ role: "target", cx: 900, cy: 450, sil: sil(110) }, { role: "from", cx: 500, cy: 400, sil: sil(90) }, { role: "also", cx: 1100, cy: 500, sil: sil(80) }];
    const env = (o = {}) => ({ W: 1600, H: 900, cx: 900, cy: 450, hx: 850, hy: 440, R: 55, dir: 0.2, mag: 1.6, step: 4, kind: "hit", tone: TONES.hero, rimTone: "a", sil: figs[0].sil, figs, local: null, redOk: false, makeCanvas: fake, ...o });
    let worst = 0;
    for ( const type of Object.keys(FRAMES) ) for ( const fig of [...Object.keys(FIG), undefined] ) for ( const o of [{}, { local: { r: 300 } }, { dir: null }] ) {
      const ctx = mkCtx(null), e = env(o), bare = mkCtx(null);
      ok(paintFrame(ctx, e, { type, seed: 9, fig, back: FRAMES[type].back, full: FRAMES[type].full }) === true && ctx.log.depth === 0, `figures: ${type} with fig ${fig} paints and restores`);
      ok(ctx.log.pts.every(Number.isFinite), `figures: ${type} with fig ${fig} draws a non-finite point`);
      paintFrame(bare, env({ ...o, figs: [] }), { type, seed: 9, back: FRAMES[type].back, full: FRAMES[type].full });
      worst = Math.max(worst, ctx.log.draws - bare.log.draws);
    }
    /* cost: per figure at most 2 rims x 12 copies + its art; the echoes and the enlarged silhouettes of the frames add a bounded few */
    ok(worst <= 3 * 26 + 4, `figures: the figures add at most ${3 * 26 + 4} picture draws to a drawing with three figures (${worst})`);
    /* a picture's art (negative, own colours, inked, posterised) is worked out once and shared by every impact and drawing on it */
    const src2 = fake(96, 96), figs2 = [{ role: "target", cx: 900, cy: 450, sil: { src: src2, sx: 0, sy: 0, sw: 96, sh: 96, w: 100, h: 100, rot: 0 } }];
    made = 0; paintFrame(mkCtx(null), env({ figs: figs2, sil: figs2[0].sil }), { type: "fig", seed: 3, fig: "p" }); const first = made;
    made = 0; paintFrame(mkCtx(null), env({ figs: figs2, sil: figs2[0].sil }), { type: "fig", seed: 4, fig: "i" }); paintFrame(mkCtx(null), env({ figs: figs2, sil: figs2[0].sil }), { type: "fig", seed: 5, fig: "p" });
    ok(first > 0 && made <= 2, `figures: the figures' art is reused across impacts (${first} canvases, then ${made})`);
  }

  /* 4. the player on a fake browser: which figures take part on a seat (its own process: it replaces globals) */
  if ( !process.env.LETR_FIG_LIFE ) {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--life"], { encoding: "utf8", env: { ...process.env, LETR_FIG_LIFE: "1" }, timeout: 120000 });
    for ( const l of (r.stdout ?? "").split("\n").filter((x) => x.startsWith("FAIL")) ) console.log(l);
    ok(r.status === 0, `figures life: ${(r.stdout ?? "").trim().split("\n").at(-1)} ${r.stderr ? r.stderr.slice(0, 400) : ""}`);
  }
}

async function life(ok) {
  const { setup } = await import("../testenv.mjs");
  const E = await setup();
  globalThis.HTMLCanvasElement = document.createElement("canvas").constructor;
  const { createImpact } = await import("./index.mjs");
  const board = document.createElement("div");
  document.getElementById = (id) => (id === "board" ? board : null);
  document.createElementNS = (ns, t) => { const el = document.createElement(t); el.querySelectorAll = () => [{ setAttribute() {} }, { setAttribute() {} }]; return el; };
  let started = true;
  canvas.app = { ...(canvas.app ?? {}), ticker: { get started() { return started; }, stop() { started = false; }, start() { started = true; } }, view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } };
  canvas.stage.scale.x = 1;
  const P = { enabled: true, motion: "full", flashes: true, photosafe: true };
  const I = createImpact({ get prefs() { return P; } }, { state: { flashLog: [] } });
  const tok = (id, x, y, more = {}) => {
    const t = E.addToken(id, x, y, 0, more.doc ?? {});
    const src = document.createElement("canvas"); src.width = 128; src.height = 128;
    t.mesh = { width: 100, height: 100, rotation: 0, scale: { x: more.flip ? -1 : 1, y: 1 }, texture: { baseTexture: { resource: { source: src } }, frame: { x: 0, y: 0, width: 128, height: 128 } } };
    t.visible = more.visible ?? true; t.w = 100; t.h = 100;
    return t;
  };
  const tgt = tok("t1", 1900, 1400), att = tok("a1", 1500, 1400), hid = tok("h1", 2200, 1400, { visible: false }), gmHid = tok("g1", 2100, 1600, { doc: { hidden: true } }), flip = tok("f1", 1700, 1600, { flip: true });
  let h = I.play({ kind: "crit", magnitude: 1.9, seed: 1, subject: tgt, from: att, also: [hid, gmHid, flip, tgt] });
  ok(h.alive, "figures life: an impact with figures starts");
  const roles = h.env.figs.map((g) => g.role + ":" + (g.id ?? "")).join(",");
  ok(roles === "target:t1,from:a1,also:f1", `figures life: the struck token, the attacker and the visible also-tokens take part, each once; a token this seat cannot see does not (${roles})`);
  ok(h.env.figs.find((g) => g.id === "f1")?.flipX === true, "figures life: a mirrored token is drawn mirrored");
  const tc = h.env.figs[0];
  ok(Math.abs(tc.cx - 750) < 1e-6 && Math.abs(tc.cy - 400) < 1e-6 && tc.sil.w === 100, `figures life: the struck figure stands at its own place and size (${tc.cx},${tc.cy} ${tc.sil.w})`);
  h.stop();
  /* a hidden attacker: no direction and no figure (its outline would tell where it stands) */
  att.visible = false;
  h = I.play({ kind: "crit", magnitude: 1.9, seed: 2, subject: tgt, from: att });
  ok(h.alive && h.env.figs.length === 1 && h.env.dir == null, "figures life: a hidden attacker gives neither a direction nor a figure"); h.stop();
  att.visible = true;
  /* a GM seat sees a GM-hidden token; a player seat must not */
  game.user.isGM = true;
  h = I.play({ kind: "crit", magnitude: 1.9, seed: 3, subject: tgt, also: [gmHid] }); ok(h.env.figs.some((g) => g.id === "g1"), "figures life: the GM's seat draws a GM-hidden token it sees"); h.stop();
  game.user.isGM = false;
  h = I.play({ kind: "crit", magnitude: 1.9, seed: 3, subject: tgt, also: [gmHid] }); ok(!h.env.figs.some((g) => g.id === "g1"), "figures life: a player's seat never draws a hidden token"); h.stop();
  /* the plan is the same on both seats (only the figures each may see differ): GM and player planned alike */
  { game.user.isGM = true; const a = I.plan({ kind: "ko", magnitude: 1.6, seed: "s", subject: tgt, from: gmHid }); game.user.isGM = false; const b = I.plan({ kind: "ko", magnitude: 1.6, seed: "s", subject: tgt, from: gmHid });
    ok(JSON.stringify(a.frames) === JSON.stringify(b.frames), "figures life: the GM's and a player's plans are the same drawings with the same figures' part"); }
  /* figures: false = none at all; the settings */
  h = I.play({ kind: "crit", magnitude: 1.9, seed: 4, subject: tgt, from: att, figures: false }); ok(h.env.figs.length === 0 && h.plan.frames.every((f) => !f.fig), "figures life: figures: false"); h.stop();
  P.flashes = false; h = I.play({ kind: "crit", magnitude: 1.9, seed: 5, subject: tgt, from: att }); ok(h.mode === "local" && h.plan.frames.every((f) => !f.fig || f.fig === "r"), "figures life: a seat without flashes (photosensitive) gets rims only"); h.stop(); P.flashes = true;
  P.motion = "reduced"; h = I.play({ kind: "crit", magnitude: 1.9, seed: 6, subject: tgt, from: att }); ok(h.mode === "static" && h.plan.frames.every((f) => !f.fig || f.fig === "r"), "figures life: reduced motion: the still drawing with rims"); h.stop(); P.motion = "full";
  await I.setMode("off"); ok(I.play({ kind: "crit", magnitude: 1.9, subject: tgt }).off, "figures life: off = nothing"); await I.setMode("full");
  /* runs and leaves nothing */
  await E.tick(1500);
  h = I.play({ kind: "crit", magnitude: 1.9, seed: 7, subject: tgt, from: att, also: [flip] });
  for ( let t = 0; t < h.plan.ms + 100; t += 16 ) await E.tick(16);
  ok(!h.alive && (await h.finished) === "done" && started && document.body.children.flatMap((r) => r.children ?? []).length === 0, "figures life: a critical with three figures plays out and leaves nothing");
}

if ( process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href ) {
  let n = 0, failed = 0;
  const ok = (c, msg) => { n++; if ( !c ) { failed++; console.log("FAIL", msg); } };
  if ( process.argv.includes("--life") ) await life(ok); else await run(ok);
  console.log(`impact figures${process.argv.includes("--life") ? " life" : ""}: ${n} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
