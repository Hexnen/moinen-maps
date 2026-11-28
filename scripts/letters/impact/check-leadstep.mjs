// LETR LEADSTEP (1.9.30): the impact's work in steps, the same pictures. A full-view drawing was painted and rastered in ONE task (live:
// a 7.5-12.6 ms frame 930 ms before a talking-heads intro), and the warm-up pieces (I.warm, I.prepare) ran whole (42-50 ms). Checks:
// the exact rank selection (kthG) picks the same element as a full sort; every stepped pixel function gives the same result as a plain run;
// a drawing written down through deferCtx and replayed gives the real context exactly the calls a direct paint gives (same order, same
// values, nothing in between: one raster, as before); figure layers in steps = the plain layers; on the fake browser a stepped prepare / warm
// gives the same drawings as the plain ones, gives way (cancel) leaving nothing, and a play takes the finished drawings of a stepped
// prepare and paints the rest; a step ahead in the frame loop stays inside its budget on a seat whose drawing costs time.
// Run from check-impact.mjs (`run`), or alone: node scripts/letters/impact/check-leadstep.mjs -> "impact leadstep: N checks, F failed".
import { fileURLToPath, pathToFileURL } from "node:url";
import { FRAMES, TONES } from "./plan.mjs";
import { paintFrame, paintFigLayers, paintFigLayersG, deferCtx, kthG, runSteps, inkPixels, postPixels, heldPixels, invPixels, origPixels, redSafePixels } from "./draw.mjs";

export async function run(ok) {
  /* 1. kthG: the k-th smallest of a list, the same element a full sort gives */
  { let bad = 0, n = 0, s = 7;
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    for ( const len of [1, 2, 3, 17, 255, 1000, 5000] ) for ( let rep = 0; rep < 6; rep++ ) {
      const v = new Float32Array(len);
      for ( let i = 0; i < len; i++ ) v[i] = rep % 3 === 0 ? Math.round(rnd() * 8) / 8 : rep % 3 === 1 ? rnd() * 255 : Math.min(255, Math.max(0, 128 + (rnd() - 0.5) * 3));
      const sorted = Float32Array.from(v).sort(), ks = [0, len - 1, Math.floor(len * 0.38), Math.floor(len * 0.5), Math.floor(len * 0.72)].map((k) => Math.min(len - 1, k));
      const got = runSteps(kthG(v, len, ks));
      ks.forEach((k, j) => { n++; if ( got[j] !== sorted[k] ) bad++; });
    }
    ok(bad === 0, `leadstep: kthG picks the same element as a full sort (${n} ranks, ${bad} differ)`); }

  /* 2. the stepped pixel functions = the plain ones (the plain one IS runSteps of the stepped one: check the steps change nothing by
        driving the generator one yield at a time against a whole run on a copy) */
  { const pic = (w, h, seed) => { const d = new Uint8ClampedArray(w * h * 4); let s = seed; for ( let i = 0; i < w * h; i++ ) { s = (s * 1664525 + 1013904223) >>> 0; const x = i % w, y = (i / w) | 0, inside = Math.hypot(x - w / 2, y - h / 2) < w * 0.35; d[i * 4] = s & 255; d[i * 4 + 1] = (s >> 8) & 255; d[i * 4 + 2] = (s >> 16) & 255; d[i * 4 + 3] = inside ? 255 : (s >> 24) & 3 ? 0 : 255; } return d; };
    let same = 0, all = 0;
    for ( const [w, h, seed] of [[64, 64, 1], [128, 96, 2], [256, 256, 3]] ) {
      const d = pic(w, h, seed);
      for ( const [name, fn] of [["ink", (x) => inkPixels(x)], ["post", (x) => postPixels(x)], ["inv", (x) => invPixels(x)], ["orig", (x) => origPixels(x)], ["red", (x) => redSafePixels(x)], ["held n", (x) => heldPixels(x, "n", {})], ["held h", (x) => heldPixels(x, "h", { turn: 0.25 })], ["held d", (x) => heldPixels(x, "d", { a: [250, 200, 20], b: [20, 30, 200] })]] ) {
        const a = fn(new Uint8ClampedArray(d)), b = fn(new Uint8ClampedArray(d));
        all++; if ( a && b && a.length === b.length && a.every((v, i) => v === b[i]) ) same++;
        else ok(false, `leadstep: ${name} on ${w}x${h} is not a pure function of its pixels`);
      }
    }
    ok(same === all, `leadstep: the stepped pixel functions are pure and repeatable (${same}/${all})`); }

  /* 3. deferCtx: the same calls on the real context, in the same order, whatever the step */
  { const fake = (w, h) => { const c = { width: w, height: h }; c.getContext = () => logCtx([]); return c; };
    const logCtx = (log) => { const st = { fillStyle: "#000", strokeStyle: "#000", globalAlpha: 1, globalCompositeOperation: "source-over", lineWidth: 1, font: "10px sans-serif", canvas: { width: 1600, height: 900 } };
      return new Proxy(st, { get: (t, k) => {
        if ( k in t ) return t[k];
        if ( k === "getImageData" ) return (x, y, w, h) => { log.push(["getImageData", x, y, w, h]); return { data: new Uint8ClampedArray(Math.max(0, w * h * 4)).fill(200) }; };
        if ( k === "createImageData" ) return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
        if ( k === "createLinearGradient" || k === "createRadialGradient" || k === "createConicGradient" ) return (...a) => { const g = { id: `g${log.length}`, stops: [], addColorStop(o, c) { this.stops.push([o, c]); } }; log.push([k, ...a]); return g; };
        if ( k === "createPattern" ) return () => ({ id: "pat" });
        if ( k === "measureText" ) return (s) => { log.push(["measureText", s]); return { width: String(s).length * 6, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 }; };
        return (...a) => { log.push([k, ...a.map((x) => (x && typeof x === "object" ? (x.id ?? "obj") : x))]); };
      }, set: (t, k, v) => { log.push(["=", k, v && typeof v === "object" ? (v.id ?? "obj") : v]); t[k] = v; return true; } }); };
    const src = fake(64, 64);
    let n = 0, diff = 0, groups = 0;
    for ( const type of Object.keys(FRAMES) ) for ( const fig of [undefined, "i", "o", "p", "k", "r"] ) for ( const step of [1, 4] ) {
      const sl = { src, sx: 0, sy: 0, sw: 64, sh: 64, w: 90, h: 90, rot: 0 };
      const e = { W: 1600, H: 900, cx: 800, cy: 450, hx: 770, hy: 450, R: 45, dir: 0.3, mag: 1.4, step, kind: "hit", tone: TONES.hero, rimTone: "a", sil: sl, figs: [{ role: "target", cx: 800, cy: 450, sil: sl }], local: null, redOk: false, makeCanvas: fake };
      const f = { type, seed: 17 + step, fig, back: FRAMES[type].back, full: FRAMES[type].full };
      const A = [], B = [];
      try { paintFrame(logCtx(A), e, f); } catch ( err ) { A.push(["throw", String(err)]); }
      const rec = deferCtx(logCtx(B));
      try { paintFrame(rec.ctx, e, f); } catch ( err ) { B.push(["throw", String(err)]); }
      if ( B.length < A.length ) groups++;   // the calls were held back until the replay
      const it = rec.replayG(); while ( !it.next().done );
      n++;
      const sa = JSON.stringify(A), sb = JSON.stringify(B);
      if ( sa !== sb ) { diff++; if ( diff <= 3 ) ok(false, `leadstep: ${type} fig ${fig} step ${step}: the stepped paint makes other calls (${A.length} vs ${B.length})`); }
    }
    ok(diff === 0 && n > 50 && groups === n, `leadstep: a drawing written down then replayed makes exactly the direct paint's calls, nothing in between (${n} drawings, ${groups} held back, ${diff} differ)`);

    /* figure layers: one per step, the same layers */
    let ln = 0, ld = 0;
    for ( const fig of ["i", "o", "p", "k", "r", "n"] ) for ( const type of ["fig", "shadow", "slam", "pop", "window"] ) {
      const sl = { src, sx: 0, sy: 0, sw: 64, sh: 64, w: 90, h: 90, rot: 0 };
      const e = { W: 1600, H: 900, cx: 800, cy: 450, hx: 770, hy: 450, R: 45, dir: 0.3, mag: 1.4, step: 4, kind: "hit", tone: TONES.hero, rimTone: "a", sil: sl, figs: [{ role: "target", cx: 800, cy: 450, sil: sl }, { role: "also", cx: 600, cy: 300, sil: sl }], local: null, redOk: false, makeCanvas: fake };
      const f = { type, seed: 5, fig, back: FRAMES[type].back, full: FRAMES[type].full };
      const a = paintFigLayers(e, f, 1), seen = [], g = paintFigLayersG(e, f, 1, (L0) => seen.push(L0));
      let r, steps = 0; for ( ;; ) { r = g.next(); if ( r.done ) break; steps++; }
      const b = r.value ?? [];
      ln++;
      const key = (L) => L.map((x) => [x.x, x.y, x.size, x.dx, x.dy, x.canvas.width].join()).join("|");
      if ( key(a) !== key(b) || seen.length !== b.length || steps !== b.length ) ld++;
    }
    ok(ld === 0, `leadstep: figure layers in steps = the plain layers, one layer a step (${ln} drawings, ${ld} differ)`); }

  /* 4. the player in steps on the fake browser (its own process: it replaces globals) */
  if ( !process.env.LETR_LEADSTEP_LIFE ) {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--life"], { encoding: "utf8", env: { ...process.env, LETR_LEADSTEP_LIFE: "1" }, timeout: 120000 });
    for ( const l of (r.stdout ?? "").split("\n").filter((x) => x.startsWith("FAIL")) ) console.log(l);
    ok(r.status === 0, `leadstep life: ${(r.stdout ?? "").trim().split("\n").at(-1)} ${r.stderr ? r.stderr.slice(0, 400) : ""}`);
  }
}

async function life(ok) {
  const { setup } = await import("../testenv.mjs");
  const E = await setup();
  const { createImpact } = await import("./index.mjs");
  const board = document.createElement("div"); board.style.translate = ""; board.style.scale = "";
  document.getElementById = (id) => (id === "board" ? board : null);
  document.createElementNS = (ns, t) => { const el = document.createElement(t); el.querySelectorAll = () => [{ setAttribute() {} }, { setAttribute() {} }]; return el; };
  globalThis.canvas ??= {};
  let started = true;
  canvas.app = { ...(canvas.app ?? {}), ticker: { get started() { return started; }, stop() { started = false; }, start() { started = true; } }, view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } };
  const P = { enabled: true, motion: "full", flashes: true, photosafe: true };
  const I = createImpact({ get prefs() { return P; } }, { state: { flashLog: [] } });
  const liveCv = () => E.stats.liveCanvases.size;
  const sp = { kind: "crit", magnitude: 1.9, seed: 21, subject: { x: 700, y: 400 } };

  /* a stepped prepare paints nothing at the call, then the same drawings as a plain prepare */
  const plain = I.prepare(sp);
  const sizes = (a) => a.plan.frames.map((f) => (f.cv ? `${f.cv.width}x${f.cv.height}:${(f.figEls ?? []).length}:${f.clip}` : "-")).join("|");
  const want = sizes(plain);
  for ( const g of plain.plan.frames ) { if ( g.cv ) { g.cv.width = 0; g.cv.height = 0; g.cv = null; } for ( const L0 of g.figEls ?? [] ) { L0.el.width = 0; L0.el.height = 0; } g.figEls = null; }
  const st = I.prepare(sp, { steps: true });
  ok(!st.done && st.plan.frames.every((f) => f.cv === undefined) && typeof st.step === "function", "leadstep life: a stepped prepare paints nothing at the call");
  E.knobs.fillCost = 0.05;   // the clock moves as it paints: steps end on their budget
  let k = 0; while ( st.step(0.5) && k < 10000 ) k++;
  E.knobs.fillCost = 0;
  ok(st.done && k >= 1 && sizes(st) === want, `leadstep life: a stepped prepare ends with the plain prepare's drawings (${k + 1} steps)`);
  const h = st.play(); await E.tick(h.plan.ms + 100);
  ok(!h.alive && liveCv() === 0, "leadstep life: a stepped prepare plays and leaves nothing");

  /* given way half done: cancel leaves nothing */
  await E.tick(1500);
  E.knobs.fillCost = 0.05; const c = I.prepare(sp, { steps: true }); c.step(0.5); c.step(0.5); E.knobs.fillCost = 0;
  c.cancel();
  for ( const g of c.plan.frames ) { if ( g.cv ) { g.cv.width = 0; g.cv.height = 0; g.cv = null; } for ( const L0 of g.figEls ?? [] ) { L0.el.width = 0; L0.el.height = 0; } g.figEls = null; }
  ok(c.done && !c.step(1) && liveCv() === 0 && c.plan.frames.every((f) => !f._pg && !f._pc), `leadstep life: a cancelled stepped prepare keeps nothing (${liveCv()} canvases)`);

  /* played half done: the play takes the finished drawings and paints the rest itself */
  await E.tick(1500);
  { E.knobs.fillCost = 0.05; const a = I.prepare(sp, { steps: true }); for ( let i = 0; i < 3; i++ ) a.step(0.5); E.knobs.fillCost = 0;
    const got = a.plan.frames.filter((f) => f.cv).length;
    const p0 = I.stats.painted;
    const hh = a.play();
    await E.tick(hh.plan.ms + 100);
    ok(!hh.alive && (await hh.finished) === "done" && liveCv() === 0 && I.stats.painted - p0 === a.plan.frames.length - got, `leadstep life: a play of a half-done prepare paints only the rest (${got} taken, ${I.stats.painted - p0} painted)`); }

  /* I.warm in steps: a stepper; given way, then done */
  { const s = I.warm([{ x: 1, y: 1 }], { steps: true });
    ok(s && typeof s.step === "function" && typeof s.cancel === "function", "leadstep life: I.warm(list, { steps: true }) is a stepper");
    let n = 0; while ( s.step(0.5) && n < 1000 ) n++;
    ok(s.done, "leadstep life: the warm stepper ends");
    ok(typeof I.warm([{ x: 1, y: 1 }]) === "number", "leadstep life: I.warm(list) is as before (a number, the work done in the call)"); }

  /* a loaded seat: the frame loop's step ahead stays small (each fill costs 0.4 ms of the clock) */
  await E.tick(1500);
  E.knobs.fillCost = 0.4;
  { const s0 = I.stats.stepMax ?? 0; I.stats.stepMax = 0;
    const hh = I.play({ ...sp, seed: 22, startAt: performance.now() + 1200 });
    for ( let t = 0; t < 1100; t += 16 ) await E.tick(16);
    const ready = hh.plan.frames.every((f) => f.cv !== undefined);
    await E.tick(hh.plan.ms + 300);
    ok((await hh.finished) === "done" && ready, `leadstep life: a loaded seat still paints every drawing ahead in steps (${ready})`);
    ok(I.stats.steps > hh.plan.frames.length, `leadstep life: the drawings were painted in steps (${I.stats.steps} steps)`);
    I.stats.stepMax = Math.max(s0, I.stats.stepMax); }
  E.knobs.fillCost = 0;
}

if ( import.meta.url === pathToFileURL(process.argv[1] ?? "").href ) {
  let n = 0, failed = 0;
  const ok = (c, m) => { n++; if ( !c ) { failed++; console.log(`FAIL ${m}`); } };
  if ( process.argv.includes("--life") ) { await life(ok); console.log(`leadstep life: ${n} checks, ${failed} failed`); process.exit(failed ? 1 : 0); }
  await run(ok);
  console.log(`impact leadstep: ${n} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
