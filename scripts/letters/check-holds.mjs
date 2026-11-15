// LETR HOLDS (1.9.10): a held word in the invincible style lives for as long as it stands, in the manner of its sound (motion.mjs
// LIFE / lifePose), small enough to stay readable and inside its placement, the same on every seat, still under reduced motion.
// Pure part: run(ok, { fontsApi }) from check.mjs. Engine part (fake browser of testenv.mjs, own process): `node check-holds.mjs
// --engine`, prints "holds-engine: N checks, F failed". `node check-holds.mjs --engine <other letters folder>` runs the engine part on
// another engine (1.9.8: the still-hold checks fail).
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const TICK = 1000 / 24, F60 = 1000 / 60;
/* the word as a W x H box (cap heights) under a pose: its four corners; how far a pose moves them from another pose */
const W = 3.5, HH = 1;
const corners = (p) => [[-W / 2, -HH / 2], [W / 2, -HH / 2], [-W / 2, HH / 2], [W / 2, HH / 2]].map(([cx, cy]) => {
  const x = cx * p.s * p.sx, y = cy * p.s * p.sy, c = Math.cos(p.r), s = Math.sin(p.r);
  return [x * c - y * s + p.x, x * s + y * c + p.y];
});
const moved = (a, b) => { const A = corners(a), B = corners(b); return Math.max(0.1 * Math.abs((a.a ?? 1) - (b.a ?? 1)), ...A.map((q, i) => Math.hypot(q[0] - B[i][0], q[1] - B[i][1]))); };   // a flicker of alpha counts
const REST = { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1, a: 1, d: 0 };
/* the longest stretch (ms) in which the word's corners stay within `eps` cap heights of where they were at its start */
function stillest(poseAt, from, to, eps = 0.007) {
  const P = []; for ( let t = from; t < to; t += F60 ) P.push(poseAt(t));
  let best = 0;
  for ( let i = 0; i < P.length; i++ ) { let j = i + 1; while ( j < P.length && moved(P[j], P[i]) < eps ) j++; best = Math.max(best, (j - i) * F60); }
  return best;
}
/* the hold kinds the callers pin (token reactions, older callers: legacy names map onto the track's) */
const PINS = [null, "shake", "rattle", "wobble", "boil", "buzz", "throb"];
const STILL_MAX = 480;   // ms: the longest a held word may stand without a visible change (1 px at a 150 px cap)

export async function run(ok, { fontsApi }) {
  const M = await import("./motion.mjs");
  const { makePlan } = await import("./design.mjs");
  const { KIND_IDS } = await import("./words.mjs");
  const plan = (t, o = {}) => makePlan(t, o, fontsApi, []);
  const rows = [];
  for ( const kind of KIND_IDS ) for ( const pin of PINS ) for ( const [loud, long] of [[0.4, 0.2], [0.9, 0.8]] ) {
    const m = M.motionOf({ kind, seed: 7, dir: 1, sound: { loud, long }, pin: pin ? { holdKind: pin } : {} });
    rows.push({ kind, pin, loud, long, m });
  }

  /* 1. alive: a hold of 1.0, 1.5 and 3 s (callers keep words up for reading) never stands still longer than STILL_MAX after the
        entrance; at the natural length too (the sound's own body counts) */
  {
    const bad = [];
    for ( const { kind, pin, m } of rows ) for ( const H of [1000, 1500, 3000] ) {
      const s = stillest((t) => M.holdPose(m, t, H), 0, H);
      if ( s > STILL_MAX ) bad.push(`${kind}${pin ? `/${pin}` : ""}(${m.hold}${m.life ? `+${m.life}` : ""}) ${Math.round(s)} ms of ${H}`);
    }
    ok(!bad.length, `holds alive: held words standing still over ${STILL_MAX} ms: ${[...new Set(bad)].slice(0, 8).join(", ")}${bad.length > 8 ? ` (+${bad.length - 8})` : ""}`);
  }
  /* 2. readable and placed: the life alone never moves a corner more than LIFE_REACH (cap heights), never turns over 0.03 rad, never
        scales over LIFE_REACH.s; the track's reach (keepInView) covers it; the whole hold pose of a word with life reaches no farther
        than the same hold without its life plus LIFE_REACH */
  {
    const bad = [], R = M.LIFE_REACH;
    for ( const { kind, pin, m } of rows ) {
      if ( !m.life ) continue;
      const bare = { ...m, life: null };
      let lim = 0, bareMax = 0, withMax = 0;
      for ( let t = 0; t < 4000; t += 10 ) {
        const l = M.lifePose(m, t, 4000, { ...REST });
        const sc = l.s * Math.max(l.sx, l.sy);
        if ( Math.abs(l.x) > R.xy + 1e-9 || Math.abs(l.y) > R.xy + 1e-9 || Math.abs(l.r) > 0.03 || sc > R.s + 1e-9 || l.s * Math.min(l.sx, l.sy) < 2 - R.s - 1e-9 ) lim++;
        bareMax = Math.max(bareMax, moved(M.holdPose(bare, t, 4000), REST)); withMax = Math.max(withMax, moved(M.holdPose(m, t, 4000), REST));
      }
      const lifeCorner = (R.s - 1) * Math.hypot(W, HH) / 2 + R.xy + 0.03 * W / 2;
      if ( lim ) bad.push(`${kind}${pin ? `/${pin}` : ""}: ${lim} samples outside the reach`);
      if ( withMax > bareMax + lifeCorner + 1e-6 ) bad.push(`${kind}${pin ? `/${pin}` : ""}: corners ${withMax.toFixed(3)} > ${bareMax.toFixed(3)} + ${lifeCorner.toFixed(3)}`);
      const e = M.trackReach({ ...m, entKeys: M.entranceKeys(m) }, W, HH), e0 = M.trackReach({ ...m, life: null, entKeys: M.entranceKeys(m) }, W, HH);
      if ( !(e.l >= W / 2 * R.s + R.xy - 1e-9 && e.u >= HH / 2 * R.s + R.xy - 1e-9 && e.l >= e0.l && e.u >= e0.u) ) bad.push(`${kind}: trackReach does not cover the life`);
    }
    ok(!bad.length, `holds reach: ${bad.slice(0, 6).join("; ")}`);
  }
  /* 3. the natural body is the sound's: inside the first half of its natural length (or the hit's own envelope, when a caller pins a short
        one on a long sound) a hit's hold is exactly the old envelope (no life yet) */
  {
    let diff = 0, n = 0;
    for ( const { m } of rows ) {
      if ( !m.life || m.hold === "still" ) continue;
      const bare = { ...m, life: null };
      for ( let t = 0; t < Math.min(0.5 * m.bodyMs, { recoil: 220, rattle: 340, wobble: 520, roll: 500, sputter: 0 }[m.hold] ?? Infinity); t += 7 ) { n++; if ( moved(M.holdPose(m, t, m.bodyMs), M.holdPose(bare, t, m.bodyMs)) > 1e-12 ) diff++; }
    }
    ok(n > 1000 && diff === 0, `holds body: ${diff} of ${n} poses inside the sound's own body changed by the life`);
  }
  /* 4. fits the sound: the families live differently. heavy settles DOWN onto its base (squash at the low point, slow beats >= 450 ms),
        dry answers in short sharp echoes (rise within a tick), metal hums (width and height breathe against each other), a break leans
        one way, water sloshes (height breathes), and a heavy beat is slower than a ring's */
  {
    const sig = (kind, pin) => {
      const m = M.motionOf({ kind, seed: 11, dir: 1, sound: { loud: 0.8, long: 0.5 }, pin: pin ? { holdKind: pin } : {} });
      const S = []; for ( let t = 0; t < 4000; t += 5 ) S.push({ t, p: M.lifePose(m, t, 4000, { ...REST }) });
      return { m, S };
    };
    const peaksOf = (S, f) => { const o = []; for ( let i = 1; i < S.length - 1; i++ ) { const a = f(S[i - 1].p), b = f(S[i].p), c = f(S[i + 1].p); if ( b > a && b >= c && b > 0.004 ) o.push(S[i].t); } return o; };
    const heavy = sig("thud"), dry = sig("punch"), ring = sig("clang"), brk = sig("crack"), water = sig("splash"), crash = sig("crash", "wobble");
    const lifeKinds = new Set([heavy.m.life, dry.m.life, ring.m.life, brk.m.life, water.m.life]);
    ok(lifeKinds.size === 5, `holds manner: heavy ${heavy.m.life}, dry ${dry.m.life}, ring ${ring.m.life}, break ${brk.m.life}, water ${water.m.life} (five different lives)`);
    ok(crash.m.life === "settle", `holds manner: a token knock-down (crash pinned to wobble) settles like a heavy hit (${crash.m.life})`);
    /* heavy: every downward bump comes with a squash; the beats are slow */
    const hp = peaksOf(heavy.S, (p) => p.y), squashAt = hp.every((t) => { const q = heavy.S.find((x) => x.t === t).p; return q.sy < 1 && q.sx > 1; });
    const gaps = hp.slice(1).map((t, i) => t - hp[i]);
    ok(hp.length >= 3 && squashAt && Math.min(...gaps) >= 450, `holds manner: heavy settles down with a squash, ${hp.length} beats, shortest gap ${Math.min(...gaps)} ms`);
    /* dry: each echo rises to its top within a tick (sharp), then decays */
    const dp = peaksOf(dry.S, (p) => p.s - 1 - 0.012);
    let sharp = 0;
    for ( const t of dp ) { const top = dry.S.find((x) => x.t === t).p.s; const before = dry.S.find((x) => x.t === Math.max(0, t - 40)).p.s; if ( top - before > 0.6 * 0.02 * 0.5 ) sharp++; }
    ok(dp.length >= 2 && sharp >= dp.length - 1, `holds manner: dry echoes rise within a tick (${sharp} of ${dp.length})`);
    /* ring: width and height move against each other */
    const anti = ring.S.filter(({ p }) => Math.abs(p.sx - 1) > 0.004).every(({ p }) => Math.sign(p.sx - 1) === -Math.sign(p.sy - 1));
    ok(ring.S.some(({ p }) => Math.abs(p.sx - 1) > 0.01) && anti, "holds manner: metal hums (width against height)");
    /* break: it leans one way (sign of the reading direction) and stays leaning */
    const late = brk.S.filter(({ t }) => t > 1500);
    ok(late.every(({ p }) => p.r * brk.m.dir > 0.005), "holds manner: a broken word leans and stays leaning");
    /* water: the height breathes */
    ok(Math.max(...water.S.map(({ p }) => p.sy)) > 1.015 && Math.min(...water.S.map(({ p }) => p.sy)) < 0.985, "holds manner: water sloshes (height breathes)");
    /* nothing faster than an echo: the life never changes a corner by more than 0.02 cap heights per 60 fps frame (no flicker) */
    let fast = 0;
    for ( const { m } of rows ) { if ( !m.life ) continue; let prev = M.lifePose(m, 0, 3000, { ...REST }); for ( let t = F60; t < 3000; t += F60 ) { const p = M.lifePose(m, t, 3000, { ...REST }); if ( moved(p, prev) > 0.02 ) fast++; prev = p; } }
    ok(fast === 0, `holds calm: ${fast} frames where the life jumps over 0.02 cap heights`);
  }
  /* 5. same on every seat: the life is a function of the plan and the age only (same seed = same poses; another seed = another phase) */
  {
    const a = M.motionOf({ kind: "thud", seed: 5, sound: { loud: 0.8 } }), b = M.motionOf({ kind: "thud", seed: 5, sound: { loud: 0.8 } }), c = M.motionOf({ kind: "thud", seed: 905, sound: { loud: 0.8 } });
    let same = true, other = false;
    for ( let t = 0; t < 3000; t += 13 ) { const p = M.holdPose(a, t, 3000), q = M.holdPose(b, t, 3000), r = M.holdPose(c, t, 3000); if ( JSON.stringify(p) !== JSON.stringify(q) ) same = false; if ( moved(p, r) > 1e-6 ) other = true; }
    ok(same && other, "holds seats: the same plan lives the same at the same age; another seed only shifts the phase");
    const src = (await import("node:fs")).readFileSync(fileURLToPath(new URL("./motion.mjs", import.meta.url)), "utf8");
    const body = src.slice(src.indexOf("export function lifePose"), src.indexOf("/* ---------- 3. the pose"));
    ok(body.length > 200 && !/Math\.random|performance\.now|Date\.now/.test(body), "holds seats: lifePose reads no random number and no clock");
  }
  /* 6. reduced motion: still; stream syllables and the legacy styles: no life */
  {
    const r = M.motionOf({ kind: "thud", reduced: true }), s = M.motionOf({ kind: "thud", syllable: true });
    ok(!r.life && !s.life && stillest((t) => M.holdPose(r, t, 3000), 0, 3000) >= 2999 - F60, "holds reduced: a reduced word stands still; a stream syllable has no life");
    const w = plan("THROOMF!", { kind: "crash", seed: "rd", hold: 1500, reduced: true, look: { style: "invincible" } });
    ok(w.motion && !w.motion.life, "holds reduced: a reduced invincible plan carries no life");
    const x = plan("THROOMF!", { kind: "crash", seed: "lx", hold: 1500, look: { style: "expressive" } });
    ok(!x.motion, "holds legacy: expressive carries no track (its frozen timeline; its own breathing layer in the engine)");
    const sm = plan("THROOMF!", { kind: "crash", seed: "st", hold: 1500, look: { style: "invincible", motion: "stepped" } });
    const sw = plan("THROOMF!", { kind: "crash", seed: "st", hold: 1500, look: { style: "invincible", motion: "smooth" } });
    ok(sm.motion.life === "settle" && sw.motion.life === "settle" && sm.motion.bodyMs === sw.motion.bodyMs, "holds modes: smooth and stepped carry the same life");
    const tp = plan("THROOMF!", { kind: "crash", seed: "tp", hold: 1500, tempo: 2, look: { style: "invincible" } });
    ok(tp.motion.bodyMs === Math.round(M.motionOf({ kind: "crash", sound: tp.sound }).holdMs / 2), `holds tempo: the body follows the tempo (${tp.motion.bodyMs})`);
  }
}

/* ---------- the engine part (fake browser): the sprite keeps moving through a long hold; stepped only on the shared grid; reduced still;
   frame cost with many words standing ---------- */
async function engineChecks(dir) {
  let n = 0, failed = 0;
  const ok = (c, msg) => { n++; if ( !c ) { failed++; console.log("FAIL", msg); } else if ( process.env.LETR_VERBOSE ) console.log("ok  ", msg); };
  const { setup } = await import(pathToFileURL(path.join(dir, "testenv.mjs")).href);
  const block = async (f) => { try { await f(); } catch ( e ) { n++; failed++; console.log("FAIL (threw)", String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ")); } };
  const spritePose = (h) => ({ x: h.sprite.position.x, y: h.sprite.position.y, r: h.sprite.rotation, sx: h.sprite.scale.x, sy: h.sprite.scale.y });
  const pxMoved = (a, b, k) => { const w = 1.75 * k, hh = 0.5 * k; return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) + w * Math.abs(a.r - b.r) + w * Math.abs(a.sx / b.sx - 1) + hh * Math.abs(a.sy / b.sy - 1); };

  for ( const mode of ["smooth", "stepped"] ) await block(async () => {
    const E = await setup(); const L = E.engine; L.lookStyle("invincible");
    for ( const [kind, text, pin] of [["crash", "THROOMF!", "wobble"], ["punch", "KRAKK!", "rattle"], ["thud", "THUDD!", null], ["clang", "KLANNG!", null], ["crack", "KRAK!", null], ["splash", "SPLOOSH!", null]] ) {
      const h = L.play(text, { kind, holdKind: pin ?? undefined, seed: `hl${kind}${mode}`, magnitude: 1, hold: 1500, space: "world", at: { x: 2000, y: 1500 }, look: { style: "invincible", motion: mode } });
      const rows = [];
      for ( let t = 0; t < 4000 && h.alive; t += F60 ) { await E.tick(F60, F60); if ( h.sprite && h.t0 != null && h.shown ) rows.push({ T: E.now(), age: E.now() - h.t0, p: spritePose(h), k: h.size * h.plan.sizeK, size: h.size }); }
      const hold = rows.filter((r) => r.age > h.entMs + 50 && r.age < h.entMs + h.holdMs);
      /* the longest stretch of the hold in which the sprite moved less than 1 px (cap 150 px equivalent: k scales) */
      let still = 0;
      for ( let i = 0; i < hold.length; i++ ) { let j = i + 1; const k = 150 / hold[i].k; while ( j < hold.length && pxMoved(hold[j].p, hold[i].p, hold[i].k) * k < 1 ) j++; still = Math.max(still, hold[Math.min(j, hold.length - 1)].T - hold[i].T); }
      ok(hold.length > 40 && still <= STILL_MAX + 2 * TICK, `holds engine ${mode}: ${kind} in a 1.5 s hold stood still ${Math.round(still)} ms at most (${hold.length} frames)`);
      if ( mode === "stepped" ) {
        /* drawn channels (scale, turn) change only when the shared grid of twos is crossed */
        let off = 0, ch = 0;
        for ( let i = 1; i < hold.length; i++ ) {
          const a = hold[i - 1], b = hold[i];
          if ( Math.abs(a.p.sx - b.p.sx) < 1e-9 && Math.abs(a.p.sy - b.p.sy) < 1e-9 && Math.abs(a.p.r - b.p.r) < 1e-9 ) continue;
          if ( Math.abs(a.size - b.size) > 1e-9 ) continue;   // the size model's own drift (zoom, crowd), not the motion
          ch++;
          /* a grid instant in [previous frame, this frame] (a frame that lands exactly on the instant may show it or the next one) */
          if ( Math.floor((b.T + 1e-6) / (2 * TICK)) === Math.floor((a.T - 1e-6) / (2 * TICK)) ) off++;
        }
        ok(ch > 3 && off === 0, `holds engine stepped: ${kind} hold: ${off} of ${ch} drawn changes off the shared grid of twos`);
      }
    }
    /* reduced motion: still through the hold */
    const r = L.play("THROOMF!", { kind: "crash", seed: "hr", hold: 1500, reduced: true, space: "world", at: { x: 2000, y: 1500 }, look: { style: "invincible", motion: mode } });
    const rr = [];
    for ( let t = 0; t < 3000 && r.alive; t += F60 ) { await E.tick(F60, F60); if ( r.sprite && r.t0 != null && r.shown ) rr.push({ age: E.now() - r.t0, p: spritePose(r) }); }
    const rh = rr.filter((x) => x.age > r.entMs + 50 && x.age < r.entMs + r.holdMs);
    ok(rh.length > 40 && rh.every((x) => pxMoved(x.p, rh[0].p, 1) < 1e-6), `holds engine ${mode}: a reduced word stands still through its hold (${rh.length} frames)`);
    L.stopAll?.(); await E.tick(3000);
    E.restoreWarn();
  });

  /* two seats (two engines, other page clock origins, other frame rates) show the same pose at the same age of the word */
  await block(async () => {
    const poses = [];
    for ( const [origin, step] of [[0, F60], [777.7, 1000 / 144]] ) {
      const E = await setup(); const L = E.engine; L.lookStyle("invincible");
      await E.tick(origin, 50);
      const st = E.now() + 100;
      const h = L.play("THROOMF!", { kind: "crash", holdKind: "wobble", seed: "seat", magnitude: 1, hold: 1500, startAt: st, space: "world", at: { x: 2000, y: 1500 }, look: { style: "invincible", motion: "smooth" } });
      const got = new Map();
      for ( let t = 0; t < 2400 && h.alive; t += step ) { await E.tick(step, step); if ( h.sprite && h.shown ) { const a = Math.round(E.now() - st); if ( a % 50 === 0 ) got.set(a, spritePose(h)); } }
      poses.push(got);
      L.stopAll?.(); await E.tick(2000); E.restoreWarn();
    }
    let n2 = 0, worst = 0;
    for ( const [a, p] of poses[0] ) { const q = poses[1].get(a); if ( !q ) continue; n2++; worst = Math.max(worst, Math.abs(p.r - q.r), Math.abs(p.sx - q.sx), Math.abs(p.sy - q.sy), Math.abs(p.y - q.y) / 100); }
    ok(n2 >= 5 && worst < 1e-3, `holds engine seats: two seats (60 / 144 fps, other clock origins) at the same ages: ${n2} samples, worst ${worst.toExponential(1)}`);
  });

  /* frame cost: 40 words standing at once; the per-frame work of placing them (the pose) with and without the life */
  await block(async () => {
    const M = await import(pathToFileURL(path.join(dir, "motion.mjs")).href);
    const ms = M.motionOf({ kind: "crash", seed: 3, sound: { loud: 0.9, long: 0.6 } });
    if ( !ms.life ) { ok(false, "holds cost: this engine has no life to measure"); return; }
    ms.entKeys = M.entranceKeys(ms); ms.exitKeys = M.exitKeys(ms);
    const bare = { ...ms, life: null };
    const time = (m) => { const t0 = process.hrtime.bigint(); let acc = 0; for ( let f = 0; f < 600; f++ ) for ( let w = 0; w < 40; w++ ) acc += M.trackPose(m, 400 + ((f * F60 + w * 13) % 1300), 300, 1500, null, { W: 3.5, H: 1 }).s; return [Number(process.hrtime.bigint() - t0) / 1e6 / 600, acc]; };
    time(ms); time(bare);
    const [a] = time(ms), [b] = time(bare);
    if ( process.env.LETR_VERBOSE ) console.log(`holds cost: 40 words, pose per frame ${a.toFixed(4)} ms with life, ${b.toFixed(4)} ms without`);
    ok(a < 0.5, `holds cost: 40 standing words cost ${a.toFixed(4)} ms of pose per frame (without the life ${b.toFixed(4)} ms; budget 0.5 ms)`);
    /* and no painting: a long hold paints nothing after its entrance */
    const E = await setup(); const L = E.engine; L.lookStyle("invincible");
    const hs = []; for ( let i = 0; i < 40; i++ ) hs.push(L.play("THROOMF!", { kind: "crash", holdKind: "wobble", seed: `c${i}`, magnitude: 0.8, hold: 1500, space: "world", at: { x: 1400 + (i % 8) * 150, y: 1200 + Math.floor(i / 8) * 120 }, look: { style: "invincible" } }));
    await E.tick(900, F60);
    const r0 = L.stats.rendered; await E.tick(900, F60); const r1 = L.stats.rendered;
    ok(r1 - r0 === 0, `holds cost: 40 words in their hold painted ${r1 - r0} pictures in 0.9 s (the life only moves the sprite)`);
    L.stopAll?.(); await E.tick(3000); E.restoreWarn();
  });

  console.log(`holds-engine: ${n} checks, ${failed} failed`);
  return failed;
}
/* `node check-holds.mjs --pure`: the pure part alone (fonts from this folder) */
if ( process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--pure") ) {
  const fs = await import("node:fs"); const { FontBank } = await import("./fontbank.mjs"); const { FONTS } = await import("./design.mjs");
  const bank = new FontBank();
  for ( const [id, f] of Object.entries(FONTS) ) { const b = fs.readFileSync(new URL(f.file, import.meta.url)); bank.add(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); }
  let n = 0, failed = 0;
  await run((c, msg) => { n++; if ( !c ) { failed++; console.log("FAIL", msg); } else if ( process.env.LETR_VERBOSE ) console.log("ok  ", msg); }, { fontsApi: { adv: (f, c) => bank.adv(f, c) } });
  console.log(`holds-pure: ${n} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
if ( process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--engine") ) {
  const other = process.argv.slice(2).find((a) => !a.startsWith("--"));
  process.exit((await engineChecks(other ? path.resolve(other) : path.dirname(fileURLToPath(import.meta.url)))) ? 1 : 0);
}
