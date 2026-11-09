// The explosion fire "burst" (scripts/fire/burst-model.mjs + its hooks in model.mjs / fire.mjs), the pure part:   node dev/burst-model.test.mjs
//   A. strokes: a burst keeps one point, its level, colour and debris (capped, integers); fire / smoke keep their own gr / ot only when
//      given (a stroke without them is byte-identical to before); the flag round trip
//   B. areas: a burst is an area of its own (never merged, not even with another burst on the same spot); strokes with their own
//      timing merge only with strokes timed the same; a stroke without gr / ot keeps the area key it had
//   C. time: a burst lives its own life from q (on -> gone, the GM purges it), a taken-back one fades out in BURST_FADE; reduced motion
//      shows none; a stroke's own grow / out changes its end
//   D. the motion: deterministic, every body inside its area at every frame, the guard thins only the sparks (the lobes stay), nothing
//      before the impact or after the life, debris lands where its fire catches
//   E. the light: 0 before q, a peak at ~50 ms, decays, 0 at the end; taken back -> 0 within BURST_FADE
//   F. the Fire panel (section 13 of dev/presets-design.md): burningAt / putOutPlan reach a preset's timed fire (o in the future),
//      drop one not caught yet, never a burst; fire.mjs list() / clear() / the row edits use them (source check)
//   G. a timed fire (a preset's: written with q and o in the future) catches at q and grows in, burns, and goes out only at o - it is
//      never drawn before it catches (it was: "out" from its first write); a put-out (o = now) behaves as before
import * as M from "../scripts/fire/model.mjs";
import * as B from "../scripts/fire/burst-model.mjs";
import { readFileSync } from "node:fs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const geo = { ap: 3, ox: 100, oy: 100, grid: 96 };
const P = M.cleanParams();
const V = { lift: 0.5, squash: 0.8 };
const burst = (id, extra = {}) => M.cleanStroke({ id, k: "burst", p: [1600, 1500, 9, 9], r: 160, lv: 3, q: 10000, wd: 90, ws: 0.3, ...extra });
const fire = (id, p, extra = {}) => M.cleanStroke({ id, k: "fire", p, r: 40, lv: 2, sm: 2, q: 1000, wd: 0, ws: 0, ...extra });

/* A */
{
  const s = burst("b1", { c: "#3366ff", db: [100, 50, 400, -80, 30, 900, 1.6, 2.4], st: "fireball", e: 1, tn: 0.5, gr: 0.3 });
  ok(s && s.k === "burst" && s.p.length === 2 && s.lv === 3 && s.c === "#3366ff", "burst kept: one point, level, colour");
  ok(JSON.stringify(s.db) === JSON.stringify([100, 50, 400, -80, 30, 900]), "debris: whole triples, integers (a broken tail dropped)");
  ok(s.st === undefined && s.e === undefined && s.tn === undefined && s.gr === undefined, "fire-only fields dropped from a burst");
  const many = burst("b2", { db: Array.from({ length: 100 * 3 }, (_, i) => i) });
  ok(many.db.length === B.MAX_DEBRIS * 3, "debris capped at MAX_DEBRIS");
  ok(M.cleanStroke({ id: "b3", k: "burst", p: [1, 2], lv: 9 }).lv === 3, "level clamped");
  const f0 = fire("f0", [10, 10]), f1 = fire("f1", [10, 10], { gr: 0.333, ot: 99 });
  ok(!("gr" in f0) && !("ot" in f0), "a fire without gr / ot has none (identity)");
  ok(f1.gr === 0.33 && f1.ot === 10, "gr rounded, ot clamped to LIMITS.out");
  ok(fire("f2", [1, 1], { gr: null }).gr === undefined && fire("f3", [1, 1], { gr: "x" }).gr === undefined, "a bad gr is dropped");
  ok(M.cleanStroke({ id: "s1", k: "smoke", p: [1, 1], gr: 1 }).gr === 1, "smoke keeps gr");
  const back = M.strokesOf(JSON.parse(JSON.stringify({ b1: s, f1 })));
  ok(JSON.stringify(back.find((x) => x.id === "b1")) === JSON.stringify(s) && JSON.stringify(back.find((x) => x.id === "f1")) === JSON.stringify(f1), "flag round trip");
}

/* B */
{
  const b1 = burst("b1"), b2 = burst("b2"), f = fire("f", [1600, 1500]);
  const A = M.areasOf([b1, b2, f], geo, P, 10500);
  const bs = A.filter((a) => a.style === "burst");
  ok(bs.length === 2 && bs.every((a) => a.strokes.length === 1), "two bursts on one spot: two areas, never merged");
  ok(A.filter((a) => a.style === "fire").length === 1, "the fire under them: its own area");
  const r = M.raster(bs[0], geo, P);
  ok(r.style === "burst" && r.w === bs[0].rect.x1 - bs[0].rect.x0 && r.h === bs[0].rect.y1 - bs[0].rect.y0 && r.R > 50, "raster: the burst's descriptor");
  // timing: the same spot, one with its own gr -> two areas; both own -> one
  const g1 = fire("g1", [400, 400], { gr: 0.3 }), g2 = fire("g2", [410, 400]), g3 = fire("g3", [420, 400], { gr: 0.3 });
  ok(M.areasOf([g1, g2], geo, P, 5000).length === 2, "own timing does not merge with the scene's");
  const A3 = M.areasOf([g1, g3], geo, P, 5000);
  ok(A3.length === 1 && JSON.stringify(A3[0].tm) === JSON.stringify([0.3, undefined]) || (A3.length === 1 && A3[0].tm?.[0] === 0.3), "the same own timing merges; the area carries it");
  // identity: the keys of strokes without gr / ot do not change with the code that knows gr / ot (no tm on the area, no key part)
  const k = M.areasOf([g2], geo, P, 5000)[0];
  ok(k.tm === undefined && !/gr|\/0\.3/.test(k.key), "a plain area has no tm and no timing in its key");
  // phase is not in a burst's key (on -> out after a take-back must not rebuild it)
  const ka = M.areasOf([b1], geo, P, 10500)[0].key, kb = M.areasOf([b1], geo, P, 11000)[0].key;
  ok(ka === kb, "a burst's key holds while it plays");
}

/* C */
{
  const b = burst("b1"), end = 10000 + B.BURST_LV.life[3] * 1000;
  ok(M.phaseOf(b, 9000, geo, P) === "on" && M.phaseOf(b, 12000, geo, P) === "on" && M.phaseOf(b, end + 1, geo, P) === "gone", "a burst: on through its life, then gone");
  ok(M.goneAt([b], end + 1, geo, P).length === 1 && M.goneAt([b], end - 1, geo, P).length === 0, "the GM purges it after its life");
  ok(M.phaseOf(b, 12000, geo, P, true) === "gone", "reduced motion: no fireball");
  const t = { ...b, o: 11000 };
  ok(M.phaseOf(t, 11500, geo, P) === "out" && M.phaseOf(t, 11000 + B.BURST_FADE * 1000 + 1, geo, P) === "gone", "taken back: fades in BURST_FADE");
  const f = fire("f", [500, 500], { o: 20000 }), fq = fire("fq", [500, 500], { o: 20000, ot: 0.5 });
  const e1 = M.nextChange([f], 19999, geo, P), e2 = M.nextChange([fq], 19999, geo, P);
  ok(e2 < e1, "own `ot` shortens the going-out");
  const g = fire("g", [500, 500]), gq = fire("gq", [500, 500], { gr: 0.3 });
  ok(M.nextChange([gq], 1001, geo, P) < M.nextChange([g], 1001, geo, P), "own `gr` shortens the growing-in");
}

/* D */
{
  const b = burst("b1", { db: [200, 60, 600, -150, 120, 1200] });
  const area = M.areasOf([b], geo, P, 10100)[0], f = M.raster(area, geo, P);
  const frame = (a, det = 1) => { const o = B.burstAt(f, a, V, [0, 0], det); return { lob: Array.from(o.lob), spk: Array.from(o.spk), dbr: Array.from(o.dbr), n: [...o.n] }; };
  ok(JSON.stringify(frame(1.25)) === JSON.stringify(frame(1.25)), "deterministic");
  ok(frame(-0.01).n.every((x) => x === 0) && frame(B.BURST_LV.life[3] + 0.01).n.every((x) => x === 0), "nothing before the impact or after the life");
  let inside = true, maxL = 0, lobesAlways = true;
  for ( let a = 0; a <= B.BURST_LV.life[3]; a += 1 / 12 ) {
    for ( const V2 of [{ lift: 0.1, squash: 1 }, V, { lift: 0.8, squash: 0.6 }] ) {
      const o = B.burstAt(f, a, V2, [0, 0], 1);
      for ( let i = 0; i < o.n[0]; i++ ) {
        const x = o.lob[i * 8], y = o.lob[i * 8 + 1], r = o.lob[i * 8 + 2];
        if ( x - r < 0 || y - r < 0 || x + r > f.w || y + r > f.h ) inside = false;
      }
      for ( let i = 0; i < o.n[1]; i++ ) { const x = o.spk[i * 4], y = o.spk[i * 4 + 1]; if ( x < 0 || y < 0 || x >= f.w || y >= f.h ) inside = false; }
      for ( let i = 0; i < o.n[2]; i++ ) { const x = o.dbr[i * 8], y = o.dbr[i * 8 + 1]; if ( x < 0 || y < 0 || x >= f.w || y >= f.h ) inside = false; }
      maxL = Math.max(maxL, o.n[0]);
    }
    if ( a > 0.05 && a < B.BURST_LV.life[3] * 0.5 && B.burstAt(f, a, V, [0, 0], 1).n[0] === 0 ) lobesAlways = false;
  }
  ok(inside, "every lobe, spark and chunk stays inside its area (any view lift)");
  ok(maxL <= B.MAX_LOBES && maxL > 20, `lobes within the cap (${maxL})`);
  ok(lobesAlways, "the fireball never vanishes mid-life");
  const full = frame(0.4, 1), low = frame(0.4, 0.25);
  ok(low.n[0] === full.n[0] && JSON.stringify(low.lob) === JSON.stringify(full.lob), "the guard never touches the lobes (the silhouette)");
  ok(low.n[1] < full.n[1], "the guard thins the sparks");
  // debris: in flight, then landed at its offset at its time
  const d = frame(0.3);
  ok(d.n[2] === 2 && d.dbr[4] === 1, "the debris flies");
  const L = B.burstAt(f, 0.61, V, [0, 0], 1);
  ok(L.dbr[4] === 2 && Math.abs(L.dbr[2] - (f.c[0] + 200 / geo.ap)) < 0.01 && Math.abs(L.dbr[3] - (f.c[1] + 60 / geo.ap)) < 0.01, "a chunk lands where its fire catches");
  // the colour sinks: early mean heat > late mean heat; the heat in 0..1
  const heat = (a) => { const o = B.burstAt(f, a, V, [0, 0], 1); let s = 0, c = 0; for ( let i = 0; i < o.n[0]; i++ ) if ( o.lob[i * 8 + 5] === 0 ) { s += o.lob[i * 8 + 3]; c++; } return s / Math.max(1, c); };
  ok(heat(0.05) > 0.95 && heat(0.6) < heat(0.2) && heat(3) < 0.1, "the fireball cools from white-hot to smoke");
  // L1: no stem, mostly surge; L3: a stem
  const kinds = (st, a) => { const ar = M.areasOf([st], geo, P, 10100)[0], o = B.burstAt(M.raster(ar, geo, P), a, V); const k = [0, 0, 0]; for ( let i = 0; i < o.n[0]; i++ ) k[o.lob[i * 8 + 5]]++; return k; };
  ok(kinds(burst("g", { lv: 1, r: 50 }), 0.5)[1] === 0 && kinds(burst("g", { lv: 1, r: 50 }), 0.5)[2] >= 8, "L1: no stem, a ground surge");
  ok(kinds(b, 1.5)[1] >= 5, "L3: a stem under the cap");
}

/* E */
{
  const b = burst("b1"), L = B.burstLight(b, geo, P);
  ok(L.burst && L.burst.q === 10000 && L.radius > 160 && L.y < 1500, "the light: at the fireball, a big reach");
  const g = (t) => B.burstGain(L.burst, t);
  ok(g(9999) === 0 && g(10050) > g(10010) && g(10050) >= g(10300) && g(10300) > g(12000) && g(10000 + B.BURST_LV.life[3] * 1000) === 0, "flash at 50 ms, decay, 0 at the end");
  const o = B.burstGain({ ...L.burst, o: 10200 }, 10200 + B.BURST_FADE * 1000);
  ok(o === 0, "taken back: dark within BURST_FADE");
}

/* F */
{
  const now = 50000;
  const plain = fire("a", [1, 1]), timed = fire("b", [1, 1], { o: now + 30000 }), out = fire("c", [1, 1], { o: now - 10 }), early = fire("d", [1, 1], { q: now + 5000, o: now + 60000 }), bu = burst("e", { q: now - 100 });
  ok(M.burningAt(plain, now) && M.burningAt(timed, now) && !M.burningAt(out, now) && !M.burningAt(bu, now), "burningAt: no out time or one to come; never a burst");
  ok(M.burningAt(timed, undefined) === false && M.burningAt(plain, undefined), "burningAt without a clock: no out time only (the old rule)");
  const { put, drop } = M.putOutPlan([plain, timed, out, early, bu], now);
  ok(put.map((s) => s.id).join() === "a,b,e" && drop.map((s) => s.id).join() === "d", "putOutPlan: burning ones out, a not-caught one dropped, a burst taken back, an out one left");
  const src = readFileSync(new URL("../scripts/fire/fire.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  ok(/export const list = \(\) => \{ const now = sharedNow\(\); return \[\.\.\.strokes\.values\(\)\]\.filter\(\(s\) => M\.burningAt\(s, now\)\)/.test(src), "fire.mjs list() takes timed fires (burningAt)");
  ok(/export function clear\(\) \{ return remove\(list\(\)\.map/.test(src), "fire.mjs clear() puts out what the list shows");
  ok(/M\.putOutPlan\(/.test(src) && (src.match(/!M\.burningAt\(s, sharedNow\(\)\)/g) ?? []).length === 3, "remove() plans by putOutPlan; the three row edits accept a timed fire");
  ok(!/s\.o === undefined\)\.sort\(M\.byOrder\)/.test(src), "the old o === undefined list is gone");
}

/* G */
{
  const q = 100000, o = q + 30000, t = fire("t", [500, 500], { q, o }), cm = M.nextChange([t], q - 5000, geo, P);
  ok(M.phaseOf(t, q - 1000, geo, P) === "grow" && M.phaseOf(t, q + 10000, geo, P) === "on", "timed fire: grows from q, then burns");
  ok(M.phaseOf(t, o + 10, geo, P) === "out" && M.phaseOf(t, o + 60000, geo, P) === "gone", "timed fire: goes out at o, then gone");
  ok(cm > q && cm < o, "nextChange: the grow-in's end first");
  ok(M.nextChange([t], q + 20000, geo, P) === o - 1, "then its out time");
  const A = M.areasOf([t], geo, P, q - 1000), r = M.raster(A[0], geo, P);
  let lit = 0; for ( let i = 0; i < r.w * r.h; i++ ) if ( r.burn[i] > 0 && !(r.I[i] > q - 1000) ) lit++;
  ok(A[0].phases.t === "grow" && r.burn.some((v) => v > 0) && lit === 0, "before q no cell burns yet (ignite times after now)");
  const put = fire("p", [500, 500], { q: 1000, o: 50000 });
  ok(M.phaseOf(put, 50000, geo, P) === "out" && M.phaseOf(put, 50001, geo, P) === "out", "a put-out (o = now) is out at once, as before");
  ok(M.phaseOf(t, q + 10000, geo, P, true) === "on" && M.phaseOf(t, o + 1, geo, P, true) === "gone", "reduced motion: on until o, then gone");
}

console.log(`${fails ? "FAILED" : "ok"} - ${n - fails}/${n} burst checks`);
process.exit(fails ? 1 : 0);
