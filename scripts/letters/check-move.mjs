// LETR: node checks of the motion layer (move.mjs, choreo.mjs, shards.mjs and the engine's travel, push, echoes, escalation, glow,
// frame rates, reduced motion and clean-up). Run by check.mjs (one count for both); needs no browser: a small fake document, PIXI
// and Foundry canvas on a simulated clock are set up here, AFTER check.mjs's own checks.
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { onOf, stepT, pathPoints, pathAt, orbitAt, orientAngle, bendLayout, retime, TICK_MS } from "./move.mjs";
import { groupsOf, countFrames } from "./choreo.mjs";
import { shardPieces, pieceAt } from "./shards.mjs";
import { makePlan, syllablesOf, TICK } from "./design.mjs";
import { paintPicture } from "./paint.mjs";
import { pictureGeometry, settleCenter } from "./shape.mjs";

export async function run(ok, { bank, fontsApi }) {
  const plan = (t, o = {}) => makePlan(t, o, fontsApi, []);
  const ms = (a) => a.reduce((s, q) => s + q.ticks * TICK, 0);
  const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

  /* ---------- 1. the stepped clock and frame rates ---------- */
  ok(onOf({ on: 1 }) === 1 && onOf({ on: "threes" }) === 3 && onOf({ fps: 12 }) === 2 && onOf({ fps: 24 }) === 1 && onOf({ fps: 8 }) === 3 && onOf({}) === 0 && onOf({ on: 9 }) === 3, "move: on / fps map to ones, twos, threes");
  ok(stepT(100, 2) === 2 * TICK_MS && stepT(80, 2) === 0 && stepT(130, 3) === 3 * TICK_MS, "move: motion time is held on the drawing grid");
  for ( const seed of ["r1", "r2", "r3"] ) for ( const mood of ["impact", "crack", "fire", "whoosh"] ) {
    const base = plan("THWACK!", { mood, seed }), one = plan("THWACK!", { mood, seed, on: 1 }), three = plan("THWACK!", { mood, seed, on: 3 });
    const all = (p) => [...p.timeline.ent, ...p.timeline.hold, ...p.timeline.exit];
    ok(all(one).every((q) => q.ticks === 1), `rate: on ones every drawing lasts one tick (${mood})`);
    ok(near(ms(one.timeline.ent), ms(base.timeline.ent), 1e-6) && near(ms(one.timeline.exit), ms(base.timeline.exit), 1e-6), `rate: ones keep the entrance and exit length (${mood})`);
    ok(one.timeline.hold.length <= 8 && new Set(one.timeline.ent.map((q) => q.boil)).size >= one.timeline.ent.length * 0.8, `rate: ones are new drawings, the cached hold stays small (${mood})`);
    ok(all(three).filter((q) => !q.impact && q.ticks !== 1).every((q) => q.ticks % 3 === 0 && q.ticks <= 6) && three.timeline.hold.every((q) => q.ticks % 3 === 0), `rate: on threes drawings are held 3 or 6 ticks, accents stay (${mood})`);
    ok(JSON.stringify(plan("THWACK!", { mood, seed, on: 1 })) === JSON.stringify(one), `rate: a re-timed plan is reproducible (${mood})`);
    ok(JSON.stringify(plan("THWACK!", { mood, seed, on: 2 })) === JSON.stringify(base), `rate: on twos = the default plan (${mood})`);
  }
  ok(plan("POW", { mood: "impact", seed: 1, on: 1, reduced: true }).on === undefined, "rate: reduced motion ignores the rate");

  /* ---------- 2. paths and orbits (pure) ---------- */
  {
    const r = (p) => p;
    for ( const [a, b] of [[{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 100, y: 0 }, { x: 0, y: 0 }], [{ x: 0, y: 50 }, { x: 80, y: -30 }]] ) {
      const P = pathPoints({ from: a, to: b, arc: 0.3 }, r);
      const mid = pathAt(P, 0.5), e0 = pathAt(P, 0), e1 = pathAt(P, 1);
      ok(near(e0.x, a.x) && near(e0.y, a.y) && near(e1.x, b.x) && near(e1.y, b.y), "path: a thrown arc starts and ends at its points");
      ok(mid.y < (a.y + b.y) / 2 - 10, `path: a thrown arc bulges screen-up whichever way it is thrown (${mid.y.toFixed(1)})`);
    }
    const S = pathPoints({ points: [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }] }, r);
    ok(near(pathAt(S, 0.5).x, 50, 3) && near(pathAt(S, 0.5).y, 40, 3) && near(pathAt(S, 1).x, 100), "path: a smooth curve passes through its points");
    ok(pathPoints({ from: { x: 0, y: 0 }, to: null }, (p) => p) === null, "path: a gone end gives no path (the word keeps its last place)");
    const c = { x: 500, y: 300 };
    for ( const dir of [1, -1] ) for ( const t of [0, 300, 900, 1700] ) {
      const o = orbitAt({ dir, period: 2000, phase: -90, breathe: 0 }, t, c, 120);
      ok(near(Math.hypot(o.x - c.x, o.y - c.y), 120, 1e-6), "orbit: the word stays on its circle");
      const radial = Math.atan2(o.y - c.y, o.x - c.x);
      ok(near(Math.abs(Math.cos(o.a - radial)), 0, 1e-6), "orbit: it moves along the circle (tangent)");
      const o2 = orbitAt({ dir, period: 2000, phase: -90, breathe: 0 }, t + 20, c, 120);
      ok(Math.cos(Math.atan2(o2.y - o.y, o2.x - o.x) - o.a) > 0.99, "orbit: the reported direction is where it goes");
    }
    ok(orbitAt({ dir: 1, period: 2000, phase: -90 }, 500, c, 100).x > c.x && orbitAt({ dir: -1, period: 2000, phase: -90 }, 500, c, 100).x < c.x, "orbit: dir 1 turns clockwise on screen, -1 counter-clockwise");
    for ( let a = -Math.PI; a <= Math.PI; a += 0.2 ) { const l = orientAngle(a, "lean", 0.9); ok(Math.abs(l) <= 0.9 + 1e-9, "orient: lean stays readable (never past its limit)"); }
    ok(orientAngle(Math.PI, "lean") === 0 || near(orientAngle(Math.PI, "lean"), 0) , "orient: going left a leaning word is not upside down");
    ok(orientAngle(1.2, "none") === 0 && orientAngle(1.2, "tangent") === 1.2, "orient: none / tangent");
    const p = plan("WHOOOSH", { mood: "whoosh", seed: 4 });
    const E = bendLayout(p, 3, 1), E2 = bendLayout(plan("WHOOOSH", { mood: "whoosh", seed: 4 }), 3, -1);
    ok(E.kind === "arc" && near(E.W / E.ang, 3, 1e-9) && E2.ang < 0 && p.bent.dir === 1, "orbit: a bent word's arc has the orbit's radius (clockwise: tops out, counter: tops in)");
  }

  /* ---------- 3. choreography ---------- */
  {
    const sy = (t) => syllablesOf(t);
    const pre = plan("RAKABOOM!", { mood: "boom", seed: 11, parts: "prefix" });
    const lay = pre.layout.letters;
    ok(pre.groups?.length === 3 && pre.groups[2].body && lay[0].s < lay[5].s * 0.8, "choreo: a prefix is smaller than the body");
    const e0 = pre.timeline.ent[0];
    ok(e0.letters.slice(4).every((l) => !l.v) && e0.letters.slice(0, 2).some((l) => l.v), "choreo: the prefix arrives before the body");
    const visFrom = (p, i) => { let a = 0; for ( const q of p.timeline.ent ) { if ( q.letters[i].v ) return a; a += q.ticks; } return Infinity; };
    const bl = plan("BLAM BLAM BLAM", { mood: "impact", seed: 12, parts: "syllables", beat: 250 });
    const t1 = visFrom(bl, 0), t2 = visFrom(bl, 5), t3 = visFrom(bl, 10);
    ok(t1 < t2 && t2 < t3 && t3 - t2 >= 4, `choreo: each syllable lands on its own beat (${t1},${t2},${t3} ticks)`);
    for ( const p of [pre, bl, plan("KA-THOOM", { mood: "boom", seed: 13, parts: [{ text: "KA", scale: 0.5 }, { text: "THOOM", at: 250 }] })] ) {
      const ent = p.timeline.ent;
      ok(ent.every((q) => Number.isInteger(q.ticks) && q.ticks >= 1 && q.ticks <= 6) && ent.filter((q) => q.ticks === 1).length <= 3, `choreo: stays stepped (${ent.map((q) => q.ticks).join("")})`);
    }
    /* a later hit knocks the parts already there */
    const hitT = t2; let a = 0, knocked = false;
    for ( const q of bl.timeline.ent ) { if ( a >= hitT && a < hitT + 4 && q.letters[0].v && (q.letters[0].y !== 0 || q.letters[0].r !== 0) ) knocked = true; a += q.ticks; }
    ok(knocked, "choreo: a later syllable's hit knocks the earlier ones");
    const ty = plan("KLIK-KLIK", { mood: "tick", seed: 14, typeOn: true });
    const order = [...Array(ty.chars.length).keys()].filter((i) => ty.chars[i] !== " ").map((i) => visFrom(ty, i));
    ok(order.every((v, i) => i === 0 || v > order[i - 1]) && ty.timeline.ent.every((q) => q.ticks >= 2), "choreo: typed on letter by letter, on twos");
    const cn = plan("12", { mood: "impact", seed: 15, countIn: true });
    const counts = cn.timeline.ent.filter((q) => q.count != null).map((q) => q.count);
    ok(counts.length >= 3 && counts[0] === 0 && counts.every((v, i) => i === 0 || v >= counts[i - 1]) && counts.at(-1) <= 12, `choreo: a number counts up into its value (${counts})`);
    ok(cn.timeline.ent.filter((q) => q.count != null).some((q) => q.letters.some((l) => l.ch)), "choreo: counted pictures draw other digits");
    const ch = plan("-7", { mood: "pain", seed: 16, countIn: { from: 0, steps: 4 } });
    ok(ch.timeline.ent.filter((q) => q.count != null).length === 4, "choreo: countIn steps");
    { const r = { width: 0 }; const make = (w, h) => ({ width: w, height: h, getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {})), set: (t, k, v) => ((t[k] = v), true) }) });
      let bad = 0; for ( const q of [...cn.timeline.ent, ...pre.timeline.ent, ...ty.timeline.ent] ) { const x = paintPicture(q.count != null ? cn : q.letters.length === pre.chars.length ? pre : ty, bank, q, 60, make); if ( !(x.canvas.width > 2) ) bad++; } ok(bad === 0, "choreo: every choreographed picture paints"); void r; }
    const mg = plan("BAM BAM BAM", { mood: "impact", seed: 17, parts: [{ text: "BAM", at: -1 }, { text: "BAM", at: -1 }, { text: "BAM", at: 0 }] });
    ok(mg.timeline.ent[0].letters.slice(0, 7).filter((l, i) => mg.chars[i] !== " ").every((l) => l.v) && !mg.timeline.ent[0].letters[8].v || mg.timeline.ent[0].letters[8].s !== 1, "choreo: merged repeats already there, only the newest lands");
    ok(groupsOf([..."BOOM"], { parts: ["XX", "YY"] }, sy) === null && groupsOf([..."BOOM"], { parts: "syllables" }, sy) === null, "choreo: parts that do not match, or one part only, change nothing");
    ok(plan("RAKABOOM", { mood: "boom", seed: 18, parts: "prefix", reduced: true }).groups === undefined, "choreo: reduced motion shows the word at once");
    ok(JSON.stringify(plan("RAKABOOM", { mood: "boom", seed: 19, parts: "prefix" })) === JSON.stringify(plan("RAKABOOM", { mood: "boom", seed: 19, parts: "prefix" })), "choreo: reproducible for a seed");
    ok(JSON.stringify(plan("RAKABOOM", { mood: "boom", seed: 19 }).hand) === JSON.stringify(plan("RAKABOOM", { mood: "boom", seed: 19, parts: "prefix" }).hand), "choreo: parts do not change the hand of a seeded word");
  }

  /* ---------- 4. shards: the letters themselves break, fly, bounce ---------- */
  {
    let found = null;
    for ( let i = 0; i < 40 && !found; i++ ) { const p = plan("KRAK!", { mood: "crack", seed: `sh${i}`, out: "shards" }); if ( p.timeline.kinds.out === "shards" ) found = p; }
    ok(!!found, "shards: the exit can be asked for by name");
    const sh = found.timeline.exit.filter((q) => q.shards);
    ok(sh.length >= 6 && sh[0].shards.t === 0 && sh.every((q, i) => i === 0 || q.shards.t > sh[i - 1].shards.t) && ms(found.timeline.exit) <= 800, "shards: cracks first, then the pieces fly frame after frame");
    settleCenter(found, bank);
    const rest = { ...found.timeline.hold[0], g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 } };
    const geo = pictureGeometry(found, bank, rest);
    const P = shardPieces(geo, 1234, 0.7), P2 = shardPieces(geo, 1234, 0.7);
    ok(P.length >= geo.length * 3 && JSON.stringify(P) === JSON.stringify(P2), `shards: every letter breaks into pieces, reproducibly (${P.length})`);
    ok(new Set(P.map((q) => q.i)).size === geo.length, "shards: every letter takes part");
    let fly = 0, under = 0, still = 0;
    for ( const q of P ) {
      const a = pieceAt(q, 0.25), b = pieceAt(q, 0.6), c = pieceAt(q, 2.5), d = pieceAt(q, 2.6);
      if ( Math.hypot(a.dx, a.dy) > 0.2 ) fly++;
      for ( const m of [a, b, c] ) if ( q.cy + m.dy > q.floor + 1e-6 ) under++;
      if ( Math.hypot(d.dx - c.dx, d.dy - c.dy) < 0.05 ) still++;
    }
    ok(fly >= P.length * 0.9 && under === 0 && still >= P.length * 0.8, `shards: pieces fly, never sink under their floor, come to rest (${fly}/${under}/${still})`);
    const ups = P.filter((q) => pieceAt(q, 0.12).dy < 0).length;
    ok(ups >= P.length * 0.6, "shards: thrown up first (gravity brings them down)");
    let calls = 0;
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => { calls++; })), set: (t, k, v) => ((t[k] = v), true) });
    const make = (w, h) => ({ width: w, height: h, getContext: () => ctx });
    const pics = sh.map((q) => paintPicture(found, bank, q, 90, make));
    ok(pics.every((r) => r.canvas.width > 50 && Number.isFinite(r.ax)) && !found._shardSrc, "shards: pictures paint from the word at rest, which is not kept");
  }

  /* ---------- 4b. ADVT (token-reaction review): living holds, real exits, a readable anticipation ---------- */
  {
    let dead = [], antics = 0, blobs = 0, shat = 0, shatPieces = 0, bursts = 0, burstPieces = 0;
    for ( const mood of ["impact", "boom", "crack", "crash", "zap", "fire", "whoosh", "roar", "splash"] ) for ( let i = 0; i < 12; i++ ) {
      const p = plan(i % 2 ? "BACH!" : "UFF!", { mood, seed: `advt${mood}${i}`, magnitude: 0.6 });
      /* consecutive hold drawings (the cycle wraps) must differ visibly: a move of 0.04 units or more, or another effect layer */
      const H = p.timeline.hold, d = (a, b) => Math.max(...["x", "y", "r", "s", "sx", "sy"].map((k) => Math.abs((a.g[k] ?? (k[0] === "s" ? 1 : 0)) - (b.g[k] ?? (k[0] === "s" ? 1 : 0)))),
        ...a.letters.map((l, j) => Math.max(Math.abs((l.x ?? 0) - (b.letters[j].x ?? 0)), Math.abs((l.y ?? 0) - (b.letters[j].y ?? 0)), Math.abs((l.r ?? 0) - (b.letters[j].r ?? 0)))));
      const fxk = (q) => q.fx.map((f) => f.k).join();
      const live = H.filter((q, j) => { const n = H[(j + 1) % H.length]; return d(q, n) >= 0.04 || fxk(q) !== fxk(n); }).length;
      if ( H.length > 1 && live < H.length - 1 ) dead.push(`${mood}/${p.timeline.kinds.hold}`);
      const e0 = p.timeline.ent[0];
      if ( p.timeline.kinds.in === "slam" || p.timeline.kinds.in === "punch" ) { antics++; if ( (e0.g.s ?? 1) * Math.min(e0.g.sx ?? 1, e0.g.sy ?? 1) < 0.55 ) blobs++; }
      if ( p.timeline.kinds.out === "shatter" ) { shat++; if ( p.timeline.exit.filter((q) => q.shards).length >= 5 ) shatPieces++; }
      if ( p.timeline.kinds.out === "burst" ) { bursts++; if ( p.timeline.exit.filter((q) => q.shards?.mode === "burst").length >= 5 ) burstPieces++; }
    }
    ok(dead.length === 0, `ADVT 8: every hold keeps moving (a drawing in two travels or turns visibly) ${dead.slice(0, 6).join(" ")}`);
    ok(blobs === 0, `ADVT 10: the wind-up pose stays readable (never squeezed to a blob: ${blobs}/${antics})`);
    ok(shat === 0 || shatPieces === shat, `ADVT 9: "shatter" breaks the real letters into flying pieces (${shatPieces}/${shat})`);
    ok(bursts === 0 || burstPieces === bursts, `ADVT 9: "burst" blows the word apart from its middle (${burstPieces}/${bursts})`);
    const bp = plan("BUM!", { mood: "boom", seed: "advt-burst", out: "burst" });
    ok(bp.timeline.exit.some((q) => q.shards?.mode === "burst") && bp.timeline.exit.some((q) => q.fx.some((f) => f.k === "puff")), "ADVT 9: a burst exit flies apart in a puff cloud");
    const sp = plan("KRAK!", { mood: "crack", seed: "advt-sh", out: "shatter" });
    ok(sp.timeline.exit.filter((q) => q.shards).length >= 6, "ADVT 9: out: shatter asks for the shards exit");
    settleCenter(bp, bank);
    const geo = pictureGeometry(bp, bank, { ...bp.timeline.hold[0], g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 } });
    const B = shardPieces(geo, 77, 0.7, null, "burst"), cx = geo.flatMap((l) => l.cs).reduce((a, c, _, A) => a + c[0] / A.length, 0);
    const outward = B.filter((q) => Math.sign(pieceAt(q, 0.2).dx) === Math.sign(q.cx - cx) || Math.abs(q.cx - cx) < 0.2).length;
    ok(outward >= B.length * 0.8, `ADVT 9: burst pieces fly outward from the middle (${outward}/${B.length})`);
    /* ADVM 8: a big explosion's burst exit is a performance (>= 0.45 s), not two frames of halftone */
    const big = plan("KABOOM!", { mood: "boom", seed: "advm8", magnitude: 1, out: "burst" });
    const exMs = big.timeline.exit.reduce((a, q) => a + q.ticks, 0) * 1000 / 24;
    ok(exMs >= 450, `ADVM 8: a big boom's burst exit lasts ${exMs | 0} ms (>= 450)`);
    /* ADVM 7: the drop entrance keeps ONE word: every letter shows in every drawing, the letters stay near one line, no jump */
    let bad = [];
    for ( let i = 0; i < 10; i++ ) {
      const p = plan(i % 2 ? "GRUUUCH!" : "ŁUP!", { mood: "crash", seed: `advm7${i}`, in: "drop", magnitude: 0.4 + 0.06 * i });
      let prevMid = null;
      for ( const [j, q] of p.timeline.ent.entries() ) {
        const ys = q.letters.map((l) => (l.y ?? 0) + (q.g.y ?? 0)), mid = ys.reduce((a, y) => a + y, 0) / ys.length;
        if ( q.letters.some((l) => l.v === 0) ) bad.push(`${i}.${j} hidden letter`);
        if ( Math.max(...ys) - Math.min(...ys) > 1.3 ) bad.push(`${i}.${j} stair ${(Math.max(...ys) - Math.min(...ys)).toFixed(2)}`);
        if ( prevMid !== null && Math.abs(mid - prevMid) > 1.0 ) bad.push(`${i}.${j} jump ${Math.abs(mid - prevMid).toFixed(2)}`);
        prevMid = mid;
      }
    }
    ok(bad.length === 0, `ADVM 7: the drop entrance is one coherent word across its drawings ${bad.slice(0, 5).join(", ")}`);
    /* ADVM 7: a quiet word's slam never overshoots bigger than a loud one's */
    const smearS = (m) => Math.max(...plan("TUP!", { mood: "impact", seed: "advm7s", in: "slam", magnitude: m }).timeline.ent.map((q) => q.g.s ?? 1));
    ok(smearS(0.05) <= 1.35 && smearS(0.05) < smearS(1), `ADVM 7: a quiet slam overshoots less (${smearS(0.05).toFixed(2)} vs ${smearS(1).toFixed(2)})`);
  }

  /* ---------- 5. the engine: travel, push, echoes, escalation, glow, clean-up (fake browser + Foundry on a simulated clock) ---------- */
  const E = await fakeEngine();
  const L = E.engine;
  {
    /* orbit around a moving centre, for as long as a Promise */
    let end; const until = new Promise((r) => (end = r));
    let cx = 2000;
    const center = () => ({ x: cx, y: 1500 });
    const h = L.play("WHOOOSH", { mood: "whoosh", space: "world", orbit: { center, radius: 300, period: 2000 }, until, seed: "o1" });
    await E.tick(50);
    let maxErr = 0, moved = 0, last = null, steps = new Set();
    for ( let i = 0; i < 90; i++ ) {
      cx += 6; await E.tick(17);
      const p = h.lastPos, k = h.size * h.plan.sizeK;
      const mid = { x: p.x - Math.cos(h.lastRot) * h.offset.x * k + Math.sin(h.lastRot) * h.offset.y * k, y: p.y - Math.sin(h.lastRot) * h.offset.x * k - Math.cos(h.lastRot) * h.offset.y * k };
      maxErr = Math.max(maxErr, Math.abs(Math.hypot(mid.x - cx, mid.y - 1500) - 300) / 300);
      if ( last && (last.x !== p.x || last.y !== p.y) ) moved++;
      steps.add(Math.round(Math.atan2(mid.y - 1500, mid.x - cx) * 1000));
      last = { ...p };
    }
    ok(h.alive && maxErr < 0.1, `travel: an orbiting word circles its MOVING centre (radius error ${(maxErr * 100).toFixed(1)} %)`);
    ok(h.plan.bent && h.plan.layout.E.kind === "arc", "travel: the orbiting word is bent around its circle");
    ok(steps.size < 90 * 0.7, `travel: the orbit turns on the drawing grid, not every frame (${steps.size} poses in 90 frames)`);
    ok(h.plan.timeline.hold.some((q) => q.fx.some((f) => f.k === "swirl")), "travel: an orbiting word trails swirl lines");
    end(); await E.tick(1500);
    ok(!h.alive, "travel: the orbit ends with its Promise");
    /* a path: from a token to a moving point, arriving where the target is */
    const tok = E.addToken("tA", 1000, 1000);
    let tx = 3000;
    const p = L.play("BONK!", { mood: "impact", space: "world", path: { from: tok, to: () => ({ x: tx, y: 1200 }), arc: 0.3 }, seed: "p1", hold: 500 });
    await E.tick(30);
    const start = { ...p.lastPos };
    let top = Infinity; for ( let i = 0; i < 40; i++ ) { await E.tick(20); top = Math.min(top, p.lastPos.y); tx += 2; }
    await E.tick(p.entMs + p.holdMs - 830 + 90);
    ok(Math.hypot(start.x - 1050, start.y - 1050) < 120, "travel: a path starts at its token");
    ok(Math.hypot(p.lastPos.x - tx, p.lastPos.y - 1200) < 60 && top < 1000, `travel: it arcs up and arrives where the (moving) target is (${p.lastPos.x | 0},${p.lastPos.y | 0} vs ${tx},1200)`);
    await E.tick(1500);
    /* reduced motion: no travel, no echoes, no push */
    const r = L.play("WHOOSH", { mood: "whoosh", space: "world", reduced: true, orbit: { center: { x: 2000, y: 1500 }, radius: 200 }, echo: 2, seed: "r1", hold: 400 });
    await E.tick(30); const r0 = { ...r.lastPos }; await E.tick(300);
    ok(r.lastPos.x === r0.x && r.lastPos.y === r0.y && !r.echo && !r.plan.bent, "travel: reduced motion stays put (no orbit, no echoes)");
    await E.tick(1500);
  }
  {
    /* push: a blast shoves its neighbours outward, never the far ones */
    const a = L.play("POW!", { mood: "impact", space: "world", at: { x: 1900, y: 1500 }, seed: "pa", hold: 3000 });
    const b = L.play("ZAP!", { mood: "zap", space: "world", at: { x: 2600, y: 1500 }, seed: "pb", hold: 3000 });
    const far = L.play("klik", { mood: "tick", space: "world", at: { x: 9000, y: 1500 }, seed: "pc", hold: 3000 });
    await E.tick(200);
    const a0 = { ...a.lastPos }, b0 = { ...b.lastPos }, f0 = { ...far.lastPos };
    const n = L.push({ x: 2250, y: 1500 }, { space: "world", radius: 600, force: 150 });
    await E.tick(600);
    const pa = a.sprite.position, pb = b.sprite.position;
    ok(n === 2 && pa.x < a0.x - 30 && pb.x > b0.x + 30 && far.sprite.position.x === f0.x, `push: words near the blast move away from it (${n}: ${(pa.x - a0.x) | 0}, ${(pb.x - b0.x) | 0})`);
    const bl = L.play("KABOOM!", { mood: "boom", space: "world", push: true, at: { x: 1850, y: 1600 }, seed: "pk", hold: 400 });
    const before = a.knocks.length; await E.tick(900);
    ok(a.knocks.length === before + 1 && !bl.knocks?.length, "push: a word played with push shoves the others at its contact (not itself)");
    L.stopAll({ quick: true }); await E.tick(50);
  }
  {
    /* echoes: n smaller hollow copies after the landing, gone with the word */
    const h = L.play("BOOM", { mood: "boom", space: "world", at: { x: 2000, y: 1500 }, echo: 3, seed: "e1", hold: 500 });
    await E.tick(50); await E.tick(h.entMs + 850);   // entMs is known once the word is prepared (the next frame)
    ok(h.echoes?.length === 3 && h.echoes.every((c) => c.isEcho && c.plan.hollow && c.plan.hand.id === h.plan.hand.id), "echo: three hollow echoes in the word's own hand");
    ok(h.echoes[1].size < h.echoes[0].size || h.echoes[1].opts.scale < h.echoes[0].opts.scale, "echo: each echo smaller than the one before");
    await E.tick(3000);
    ok(L.count({ space: "world" }) === 0, "echo: echoes end on their own");
    const h2 = L.play("BOOM", { mood: "boom", space: "world", at: { x: 2000, y: 1500 }, echo: 3, seed: "e2", hold: 500 });
    await E.tick(80); L.stopAll(); await E.tick(3000);
    ok(L.count() === 0 && !h2.echoes, "echo: stopAll before the landing means no echoes later");
  }
  {
    /* escalation: same source, same word, within the window */
    const tok = E.addToken("tE", 2000, 2000);
    const hs = [];
    for ( let i = 0; i < 5; i++ ) { hs.push(L.play("BAM!", { mood: "impact", space: "world", at: tok, escalate: true, seed: `esc${i}`, hold: 900 })); await E.tick(300); }
    ok(hs.map((h) => h.escalation.n).join() === "1,2,3,4,5", `escalate: counts the repeats (${hs.map((h) => h.escalation.n)})`);
    ok(hs[1].plan.word === "BAM! BAM!" && hs[2].plan.word === "BAM! BAM! BAM!" && /×5/.test(hs[4].plan.word), `escalate: merges, then counts (${hs.map((h) => h.plan.word).join(" | ")})`);
    ok(hs[2].plan.hand.id === hs[0].plan.hand.id && hs.slice(0, 4).every((h) => !h.alive) && hs[4].alive, "escalate: the merged word keeps the look and replaces the one before");
    ok(hs[4].size > hs[0].size, "escalate: it grows");
    const other = L.play("BAM!", { mood: "impact", space: "world", at: E.addToken("tF", 4000, 2000), escalate: true, seed: "x" });
    ok(other.escalation.n === 1, "escalate: another source starts at one");
    await E.tick(2400);
    ok(L.play("BAM!", { mood: "impact", space: "world", at: tok, escalate: true, seed: "late" }).escalation.n === 1, "escalate: after the window it starts over");
    ok(L.play("BAM!", { mood: "impact", space: "world", at: tok, escalate: { n: 4 }, seed: "fixed" }).escalation.n === 4, "escalate: a caller may set the level (the same on every client)");
    L.stopAll(); await E.tick(50);
    ok(L.escalation.size === 0, "escalate: stopAll clears the memory");
  }
  {
    /* glow: a light in the illumination layer + a bloom behind the word, both freed with the word */
    E.setDark(0.8);
    const h = L.play("FWOOOSH", { mood: "fire", space: "world", at: { x: 2000, y: 1500 }, glow: "auto", seed: "g1", hold: 600 });
    await E.tick(100);
    const lights = E.illum.children[0]?.children ?? [];
    ok(!!h.glow && lights.length === 1 && h.glow.bloom.parent === h.sprite.parent && h.glow.bloom.blendMode === "add", "glow: a fire word in the dark lights the scene and blooms");
    await E.tick(80);
    ok(h.glow.light.alpha > 0 && h.glow.light.position.x === h.sprite.position.x, "glow: the light follows the word");
    E.setDark(0);
    const g2 = L.play("FWOOOSH", { mood: "fire", space: "world", at: { x: 2000, y: 1500 }, glow: "auto", seed: "g2", hold: 600 });
    const g3 = L.play("POW", { mood: "impact", space: "world", at: { x: 2000, y: 1500 }, glow: "auto", seed: "g3", hold: 600 });
    await E.tick(100);
    ok(!g2.glow && !g3.glow, "glow: auto stays off in daylight and for moods that do not burn");
    /* Foundry empties the illumination container on a lighting refresh: the glow goes back in */
    E.illum.removeChild(E.illum.children[0]); E.Hooks.callAll("lightingRefresh");
    ok(E.illum.children.length === 1, "glow: re-attached after a lighting refresh");
    await E.tick(2500);
    ok(!h.alive && h.glow === null && (E.illum.children[0]?.children.length ?? 0) === 0, "glow: freed with the word");
  }
  {
    /* clean-up: stopAll and a scene change end everything this layer adds (orbits for ever, echoes pending, glows, knocks) */
    E.setDark(0.9);
    L.play("WHOOSH", { mood: "whoosh", space: "world", orbit: { center: { x: 2000, y: 1500 } }, loop: true, seed: "c1", glow: true });
    L.play("BOOM", { mood: "boom", space: "world", at: { x: 2000, y: 1500 }, echo: 4, push: true, seed: "c2" });
    L.play("KRAK", { mood: "crack", space: "world", path: { from: { x: 0, y: 0 }, to: { x: 4000, y: 3000 }, loop: true }, loop: true, out: "shards", seed: "c3" });
    await E.tick(300);
    E.Hooks.callAll("canvasTearDown");
    await E.tick(3000);
    ok(L.count() === 0 && E.liveTex() === 0, `clean-up: a scene change ends orbits, paths, echoes and glows (${L.count()} words, ${E.liveTex()} textures left)`);
    L.play("WHOOSH", { mood: "whoosh", space: "screen", orbit: { center: { x: 800, y: 400 } }, loop: true, seed: "c4", glow: true });
    L.play("BOOM", { mood: "boom", space: "screen", at: { x: 800, y: 400 }, echo: 4, seed: "c5" });
    await E.tick(300); L.stopAll(); await E.tick(3000);
    ok(L.count() === 0, "clean-up: stopAll ends screen orbits and echoes");
    /* streams on an orbit and along a path: syllables ride them */
    let end; const until = new Promise((r) => (end = r));
    const s = L.stream({ text: "WHU-UU-UUM", space: "world", orbit: { center: { x: 2000, y: 1500 }, radius: 400, period: 2000 }, every: 200, until, seed: "s1" });
    const b = L.stream({ text: "BZ-ZZT", space: "world", path: { from: { x: 0, y: 0 }, to: { x: 1000, y: 0 } }, every: 200, count: 3, seed: "s2", orient: "lean" });
    await E.tick(900);
    ok(s.handles.length >= 4 && s.handles.every((h) => h.travel?.kind === "orbit" && Math.abs(h.travel.R - 400) < 1e-9), "stream: orbit syllables ride one ring");
    const ph = s.handles.map((h) => h.travel.spec.phase);
    ok(ph.every((v, i) => i === 0 || v > ph[i - 1]), "stream: each syllable joins the ring where the head is");
    ok(b.handles.every((h) => h.travel?.kind === "path"), "stream: path syllables ride the path");
    end(); await E.tick(3000);
    ok(L.count() === 0, "stream: orbit syllables end with the stream");
  }
  {
    /* ADVT 10/9: the picture clock. A slow seat sees the same drawings for the same beats: no entrance or exit drawing is skipped,
       the wind-up lasts as long as on a fast seat (within a frame), the exit plays to its end */
    const seq = async (step) => {
      const h = L.play("UFF!", { mood: "impact", space: "world", at: { x: 2000, y: 1500 }, in: "slam", out: "shatter", seed: "clock", hold: 300 });
      const seen = [], t0 = performance.now(); let first = null, second = null;
      while ( h.alive ) { await E.tick(step, step); if ( h.lastIdx != null && seen.at(-1) !== h.lastIdx ) { seen.push(h.lastIdx); if ( seen.length === 1 ) first = performance.now(); if ( seen.length === 2 ) second = performance.now(); } if ( performance.now() - t0 > 8000 ) break; }
      return { h, seen, antic: second - first };
    };
    const fast = await seq(17), slow = await seq(70);
    const eN = fast.h.eN, x0 = eN + fast.h.hN, xN = x0 + fast.h.plan.timeline.exit.length;
    const all = (r) => { const ent = r.seen.filter((i) => i < eN), ex = r.seen.filter((i) => i >= x0); return ent.length === eN && ent.every((v, i) => v === i) && ex.length === xN - x0 && ex.every((v, i) => v === x0 + i); };
    ok(all(fast) && all(slow), `ADVT 10: every entrance and exit drawing shows, in order, on a fast and on a slow seat (${slow.seen.join(",")})`);
    ok(Math.abs(fast.antic - slow.antic) <= 70 + 1, `ADVT 10: the wind-up lasts the same on both seats (${fast.antic | 0} vs ${slow.antic | 0} ms)`);
    /* ADVT 1: words stay in the view (its insets too): a word at the very edge is moved in, a travelling word is not */
    E.setView(true);
    L.viewInset({ top: 60, right: 8, bottom: 60, left: 8 });
    const edge = [L.play("RAAA!", { mood: "roar", space: "world", at: { x: 1200 + 5, y: 1050 + 5 }, seed: "v1", hold: 900 }),
      L.play("BĘC!", { mood: "impact", space: "world", at: { x: 2790, y: 1940 }, seed: "v2", hold: 900 }),
      L.play("HUH", { mood: "tick", space: "screen", at: { x: 1595, y: 4 }, seed: "v3", hold: 900 })];
    const mid = L.play("POW!", { mood: "impact", space: "world", at: { x: 2000, y: 1500 }, seed: "v4", hold: 900 });
    const trav = L.play("ZIP", { mood: "whoosh", space: "world", path: { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }, seed: "v5", hold: 900 });
    await E.tick(400);
    const inside = (h) => { const k = h.size * h.plan.sizeK, b = h.plan._holdBox, v = h.space === "world" ? { x0: 1208, y0: 1110, x1: 2792, y1: 1890 } : { x0: 8, y0: 60, x1: 1592, y1: 840 };
      const X = h.lastPos.x, Y = h.lastPos.y; return X - b.w / 2 * k >= v.x0 - 1 && X + b.w / 2 * k <= v.x1 + 1 && Y - b.h / 2 * k >= v.y0 - 1 && Y + b.h / 2 * k <= v.y1 + 1; };
    ok(edge.every(inside), `ADVT 1: a word at the view's edge is moved inside it, letterbox insets included (${edge.map((h) => `${h.lastPos.x | 0},${h.lastPos.y | 0}`).join(" ")})`);
    ok(mid.lastPos.x === 2000 && mid.lastPos.y === 1500, "ADVT 1: a word well inside the view stays where it was put");
    ok(trav.lastPos.x < 120 && trav.lastPos.y > -60, "ADVT 1: a travelling word keeps its path (may leave the view)");
    const off = L.play("RAAA!", { mood: "roar", space: "world", at: { x: 1205, y: 1055 }, seed: "v6", hold: 900, keepInView: false });
    await E.tick(100);
    ok(off.lastPos.x === 1205, "ADVT 1: keepInView: false leaves the word where it was put");
    L.viewInset(null); E.setView(false);
    L.stopAll({ quick: true }); await E.tick(50);
  }
  {
    /* continuous sounds: a phrase score that stays interesting while the sound lasts and ends cleanly (sustain.mjs) */
    let end; const until = new Promise((r) => (end = r));
    let sx = 1700;
    const s = L.sustain({ text: "FRRRSSHH", mood: "fire", space: "world", at: () => ({ x: sx, y: 1500 }), level: 0.7, until, seed: "fire1" });
    let up = 0, samples = 0, follow = 0, follows = 0;
    for ( let i = 0; i < 80; i++ ) {
      await E.tick(100, 25); sx += 4;
      if ( i > 4 ) { samples++; if ( s.handles.some((h) => h.isReady) ) up++; }
      for ( const h of s.handles ) if ( h.lastPos && !h.travel ) { follows++; if ( Math.abs(h.lastPos.x - sx) < 160 ) follow++; }
    }
    const kinds = s.history.map((q) => q.kind);
    ok(s.phrases >= 6 && up >= samples * 0.95, `sustain: a lasting sound is always lettered, phrase after phrase (${s.phrases} phrases, up ${up}/${samples})`);
    ok(new Set(kinds).size >= 4 && kinds.every((k, i) => i === 0 || k !== kinds[i - 1]), `sustain: the phrases change treatment, never the same twice running (${kinds.join(" ")})`);
    ok(new Set(s.history.map((q) => q.text)).size >= 2, `sustain: the word itself breathes (${[...new Set(s.history.map((q) => q.text))].join(" ")})`);
    ok(follows > 0 && follow >= follows * 0.9, `sustain: the words follow a moving source (${follow}/${follows})`);
    const n0 = s.phrases; s.level(0.1); await E.tick(3000, 25); const slow = s.phrases - n0; s.level(1); const n1 = s.phrases; await E.tick(3000, 25);
    ok(s.phrases - n1 > slow, `sustain: louder = more often (${slow} quiet vs ${s.phrases - n1} loud phrases in 3 s)`);
    end(); await E.tick(50, 25);
    ok(!s.alive, "sustain: it stops when its Promise settles");
    await E.tick(4000, 25);
    ok(s.handles.length === 0 && L.count() === 0, `sustain: it ends cleanly (exits, a tail, then nothing: ${L.count()} words left)`);
    const s2 = L.sustain({ text: "FRRRSSHH", mood: "fire", space: "world", at: { x: 1700, y: 1500 }, level: 0.7, seed: "fire1" });
    await E.tick(4000, 25);
    ok(JSON.stringify(s2.history) === JSON.stringify(s.history.slice(0, s2.history.length)), "sustain: the same seed gives the same score");
    /* riding an orbit around a moving centre */
    const so = L.sustain({ text: "WHUUUM", mood: "whoosh", space: "world", at: { x: 2000, y: 1500 }, orbit: { center: () => ({ x: sx, y: 1500 }), radius: 260 }, level: 0.6, seed: "orb" });
    await E.tick(1500, 25);
    ok(so.handles.length > 0 && so.handles.every((h) => !h.plan || h.travel?.kind === "orbit" || h.travel?.kind === "path"), "sustain: phrases ride an orbit");
    L.stopAll(); await E.tick(3000, 25);
    ok(!s2.alive && !so.alive && L.count() === 0, "sustain: stopAll ends continuous sounds");
    /* ambient: the steady hiss of pipes all over a map: quiet, never more than a few at once, only where the view is */
    E.setView(true);
    const pipes = [];
    for ( let i = 0; i < 12; i++ ) pipes.push(L.sustain({ mode: "ambient", text: "PSSSS", mood: "whoosh", space: "world", at: { x: 1300 + (i % 4) * 400, y: 1200 + Math.floor(i / 4) * 300 }, seed: `pipe${i}` }));
    const far = L.sustain({ mode: "ambient", text: "PSSSS", space: "world", at: { x: 9000, y: 9000 }, seed: "pipeFar" });
    let peak = 0, mags = [];
    for ( let i = 0; i < 600; i++ ) { await E.tick(100, 100); peak = Math.max(peak, L.count({ space: "world" })); }
    for ( const p of pipes ) for ( const q of p.history ) void q;
    const spoke = pipes.filter((p) => p.phrases > 0).length;
    ok(peak <= L.ambientMax.world + 2, `sustain ambient: at most ${L.ambientMax.world} hisses (plus their drifting wisps) at once on the whole map (peak ${peak})`);
    ok(spoke >= 9, `sustain ambient: every pipe gets its turn in a minute (${spoke}/12)`);
    ok(far.phrases === 0, "sustain ambient: a pipe out of view stays silent (costs nothing)");
    ok(pipes.every((p) => p.history.every((q) => ["breath", "stretch", "shed"].includes(q.kind))), "sustain ambient: only quiet treatments");
    E.Hooks.callAll("canvasTearDown"); await E.tick(3000, 50);
    ok(pipes.every((p) => !p.alive) && L.count() === 0 && E.liveTex() === 0, "sustain ambient: a scene change ends every source, nothing left");
    E.setView(false);
  }
  /* the hand of a seeded word is the same with every motion option (escalation's merge pins it on purpose) */
  {
    const base = L.design("POW!", { mood: "impact", seed: "same" }).hand.id;
    ok(["parts", "typeOn", "countIn", "on"].every((k) => L.design("POW!", { mood: "impact", seed: "same", [k]: k === "parts" ? "syllables" : k === "on" ? 1 : true }).hand.id === base), "determinism: motion options never change a seeded word's look");
  }
  E.restore();
}

/* ---------- a fake browser + PIXI + Foundry canvas, simulated clock ---------- */
async function fakeEngine() {
  const saved = {}; for ( const k of ["performance", "setTimeout", "clearTimeout", "requestAnimationFrame", "document", "HTMLElement", "PIXI", "canvas", "Hooks", "fetch", "innerWidth", "innerHeight", "devicePixelRatio", "matchMedia"] ) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  let T = 1000; const timers = []; let tid = 0, raf = [];
  Object.defineProperty(globalThis, "performance", { value: { now: () => T }, configurable: true, writable: true });
  const realST = saved.setTimeout.value;
  globalThis.setTimeout = (f, ms = 0) => { const id = ++tid; timers.push({ id, at: T + Math.max(0, +ms || 0), f }); return id; };
  globalThis.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if ( i >= 0 ) timers.splice(i, 1); };
  globalThis.requestAnimationFrame = (f) => { raf.push(f); return raf.length; };
  const flush = () => new Promise((r) => realST(r, 0));
  async function tick(ms, step = 17) {
    const end = T + ms;
    while ( T < end ) {
      T = Math.min(end, T + step);
      for ( ;; ) { timers.sort((a, b) => a.at - b.at || a.id - b.id); const t = timers[0]; if ( !t || t.at > T ) break; timers.shift(); t.f(); }
      const fr = raf; raf = []; for ( const f of fr ) f(T);
      await flush();
    }
  }
  const live = new Set();
  const mkCtx = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : k === "getImageData" ? (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(0, w * h * 4) | 0) }) : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  class El { constructor(tag) { this.tagName = tag.toUpperCase(); this.style = {}; this.children = []; this.parentNode = null; }
    setAttribute() {} appendChild(c) { c.remove?.(); this.children.push(c); c.parentNode = this; return c; }
    replaceChildren(...cs) { for ( const c of this.children ) c.parentNode = null; this.children = []; for ( const c of cs ) this.appendChild(c); }
    remove() { if ( this.parentNode ) { const p = this.parentNode; p.children = p.children.filter((x) => x !== this); this.parentNode = null; } }
    get isConnected() { let p = this; while ( p ) { if ( p === globalThis.document.body ) return true; p = p.parentNode; } return false; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 1600, height: 900 }; } }
  class Cnv extends El { constructor() { super("canvas"); this.width = 300; this.height = 150; this._c = mkCtx(); } getContext() { return this._c; } }
  globalThis.HTMLElement = El;
  globalThis.document = { body: new El("body"), createElement: (t) => (t === "canvas" ? new Cnv() : new El(t)), getElementById: () => null };
  globalThis.innerWidth = 1600; globalThis.innerHeight = 900; globalThis.devicePixelRatio = 1;
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.fetch = async (u) => { const b = fs.readFileSync(fileURLToPath(u)); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; };
  const pt = () => ({ x: 0, y: 0, set(x, y = x) { this.x = x; this.y = y; } });
  class DO { constructor() { this.parent = null; this.destroyed = false; this.position = pt(); this.scale = pt(); this.scale.set(1); this.anchor = pt(); this.rotation = 0; this.alpha = 1; this.zIndex = 0; }
    destroy() { this.destroyed = true; this.parent?.removeChild(this); } }
  class Container extends DO { constructor() { super(); this.children = []; }
    addChild(c) { c.parent?.removeChild(c); this.children.push(c); c.parent = this; return c; }
    addChildAt(c, i) { c.parent?.removeChild(c); this.children.splice(i, 0, c); c.parent = this; return c; }
    getChildIndex(c) { return this.children.indexOf(c); }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parent = null; }
    sortChildren() {}
    destroy(o) { if ( o?.children ) for ( const c of [...this.children] ) c.destroy(o); super.destroy(); } }
  class BaseTexture { constructor(src) { this.source = src; } destroy() { this.destroyed = true; } }
  class Texture { constructor(bt) { this.baseTexture = bt; live.add(this); } destroy(base) { if ( base ) this.baseTexture?.destroy(); this.destroyed = true; live.delete(this); } }
  Texture.EMPTY = { empty: true };
  class Sprite extends Container { constructor(t) { super(); this.texture = t; } }
  globalThis.PIXI = { Container, Sprite, Texture, BaseTexture, SCALE_MODES: { NEAREST: 0, LINEAR: 1 }, BLEND_MODES: { ADD: "add", MAX_COLOR: "max", NORMAL: "normal" } };
  const hooks = {};
  globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), callAll: (n, ...a) => (hooks[n] ?? []).forEach((f) => f(...a)) };
  const tokens = new Map();
  const stage = new Container(); stage.pivot = { x: 2000, y: 1500 }; stage.toGlobal = (p) => ({ x: p.x - 2000 + 800, y: p.y - 1500 + 450 });
  const illum = new Container();
  const env = { darknessLevel: 0 };
  globalThis.canvas = { ready: true, grid: { size: 100 }, stage, primary: new Container(), interface: new Container(), environment: env, effects: { illumination: { lights: illum } },
    tokens: { get: (id) => tokens.get(id), placeables: [] }, app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } } };
  stage.addChild(canvas.primary); stage.addChild(canvas.interface);
  const addToken = (id, x, y) => { const doc = { documentName: "Token", id, x, y, elevation: 0, width: 1, height: 1 }; const t = { id, document: doc, center: { x: x + 50, y: y + 50 }, x, y }; doc.object = t; tokens.set(id, t); return t; };
  const url = new URL("./engine.mjs", import.meta.url).href + "?move-check";
  const { createEngine } = await import(url);
  const engine = createEngine(new URL("./", import.meta.url).href);
  await engine.ready();
  const restore = () => { for ( const [k, d] of Object.entries(saved) ) { if ( d ) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } };
  const setView = (on) => { if ( on ) stage.toLocal = (p) => ({ x: p.x + 2000 - 800, y: p.y + 1500 - 450 }); else delete stage.toLocal; };
  return { engine, tick, addToken, hooks, Hooks: globalThis.Hooks, illum, setDark: (v) => (env.darknessLevel = v), setView, liveTex: () => live.size, restore };
}
void pathToFileURL;
