// LETR / SUSTAINGAP: a continuous sound (L.sustain) and a stream (L.stream) read as one living run: no two of its words overlap
// while both are legible, at every size, in both faces of the invincible style, both motion types, reduced motion, world and screen,
// for every sustained kind of the vocabulary (words.mjs FLOW); a run kept in view or in a caller's room moves as one block; on the
// event's clock (startAt) every seat shows the same phrases at the same instants.
// Measured on the fake browser from what is DRAWN: each word's painted picture rectangle (keyline, rim, duplicate block included) in
// its sprite's real transform (or its screen box's CSS transform), rotated rectangles clipped against each other each frame.
// `node check-sustain.mjs --engine` prints "sustain-engine: N checks, F failed"; `node check-sustain.mjs --engine <other letters folder>`
// runs it on another engine (1.9.14: the overlap checks fail). LETR_VERBOSE=1 prints every run's worst overlap.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* how much two words of one run may overlap while both are legible: a share of the smaller picture rectangle (the rectangle holds
   a few transparent pixels round the ink, and a rotated word's corner is empty) */
export const OVERLAP_TOL = 0.04;
/* a word counts as legible from this opacity up (an exit that fades is over for the reader below it) */
export const LEGIBLE_ALPHA = 0.5;

const area = (P) => { let a = 0; for ( let i = 0; i < P.length; i++ ) { const p = P[i], q = P[(i + 1) % P.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; };
const signed = (P) => { let a = 0; for ( let i = 0; i < P.length; i++ ) { const p = P[i], q = P[(i + 1) % P.length]; a += p.x * q.y - q.x * p.y; } return a; };
/* Sutherland-Hodgman: convex subject clipped by convex clip */
export function clipArea(A, B) {
  let out = A; const sg = Math.sign(signed(B)) || 1;
  for ( let i = 0; i < B.length && out.length; i++ ) {
    const P1 = B[i], P2 = B[(i + 1) % B.length];
    const inside = (p) => sg * ((P2.x - P1.x) * (p.y - P1.y) - (P2.y - P1.y) * (p.x - P1.x)) >= 0;
    const cut = (p, q) => { const a1 = P2.y - P1.y, b1 = P1.x - P2.x, c1 = a1 * P1.x + b1 * P1.y, a2 = q.y - p.y, b2 = p.x - q.x, c2 = a2 * p.x + b2 * p.y, d = a1 * b2 - a2 * b1; return { x: (b2 * c1 - b1 * c2) / d, y: (a1 * c2 - a2 * c1) / d }; };
    const inp = out; out = [];
    for ( let j = 0; j < inp.length; j++ ) { const p = inp[j], q = inp[(j + 1) % inp.length], pi = inside(p), qi = inside(q); if ( pi ) { out.push(p); if ( !qi ) out.push(cut(p, q)); } else if ( qi ) out.push(cut(p, q)); }
  }
  return out.length > 2 ? area(out) : 0;
}
/* the drawn rectangle of a word (world: its sprite and texture; screen: its box's CSS transform and canvas) and its opacity */
export function drawnOf(h) {
  if ( !h?.alive || !h.shown?.canvas ) return null;
  const cv = h.shown.canvas;
  if ( h.sprite ) {
    const sp = h.sprite; if ( !sp.visible ) return null;
    const ax = sp.anchor.x * cv.width, ay = sp.anchor.y * cv.height, c = Math.cos(sp.rotation || 0), s = Math.sin(sp.rotation || 0);
    const P = [[-ax, -ay], [cv.width - ax, -ay], [cv.width - ax, cv.height - ay], [-ax, cv.height - ay]].map(([x, y]) => { x *= sp.scale.x; y *= sp.scale.y; return { x: sp.position.x + x * c - y * s, y: sp.position.y + x * s + y * c }; });
    return { P, a: sp.alpha ?? 1 };
  }
  if ( h.box ) {
    const tf = String(h.box.style.transform ?? ""), m = tf.match(/translate\(([-\d.]+)px,([-\d.]+)px\) rotate\(([-\d.]+)rad\)(?: scale\(([-\d.]+)(?:,([-\d.]+))?\))?/);
    if ( !m || h.box.style.visibility === "hidden" ) return null;
    const X = +m[1], Y = +m[2], r = +m[3], sx = m[4] ? +m[4] : 1, sy = m[5] ? +m[5] : sx, c = Math.cos(r), s = Math.sin(r);
    const L = parseFloat(cv.style.left) || 0, T = parseFloat(cv.style.top) || 0, W = parseFloat(cv.style.width) || 0, H = parseFloat(cv.style.height) || 0;
    const P = [[L, T], [L + W, T], [L + W, T + H], [L, T + H]].map(([x, y]) => { x *= sx; y *= sy; return { x: X + x * c - y * s, y: Y + x * s + y * c }; });
    const op = h.box.style.opacity; return { P, a: op === undefined || op === "" ? 1 : +op };
  }
  return null;
}
const roleOf = (h) => { const s = String(h.opts?.seed ?? ""); return s.includes(":tail") ? "tail" : s.includes("echo") ? "echo" : s.includes(":shed") ? "frag" : "word"; };

async function engineChecks(dir) {
  let n = 0, failed = 0;
  const ok = (c, msg) => { n++; if ( !c ) { failed++; console.log("FAIL", msg); } else if ( process.env.LETR_VERBOSE ) console.log("ok  ", msg); };
  /* the fake browser's macrotask flush on setImmediate (setTimeout(0) is up to 16 ms on Windows; this suite runs many seconds of runs) */
  globalThis.__letrRealST = (f) => setImmediate(f);
  const { setup } = await import(pathToFileURL(path.join(dir, "testenv.mjs")).href);
  const { FLOW } = await import(pathToFileURL(path.join(dir, "words.mjs")).href);
  const block = async (name, f) => { try { await f(); } catch ( e ) { n++; failed++; console.log("FAIL (threw)", name, String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ")); } };

  /* one run: its words sampled every frame; returns the worst overlap of two legible words and where */
  async function runOf(o) {
    const E = await setup(); const L = E.engine;
    L.lookStyle(o.style ?? "invincible"); L.invFace?.(o.face ?? "league"); L.motionMode?.(o.motion ?? "smooth");
    if ( o.view ) { canvas.stage.pivot.x = o.view.x; canvas.stage.pivot.y = o.view.y; }
    /* the fake stage maps world to screen only one way: the inverse, for the engine's view rectangle */
    canvas.stage.toLocal ??= (p) => ({ x: (p.x - 800) / canvas.stage.scale.x + canvas.stage.pivot.x, y: (p.y - 450) / canvas.stage.scale.x + canvas.stage.pivot.y });
    const at = o.at ?? { x: 2000, y: 1500 };
    const common = { kind: o.kind, lang: "en", space: o.space ?? "world", at, seed: o.seed ?? `sg-${o.kind}`, size: o.size, reduced: o.reduced, ...(o.extra ?? {}) };
    const run = o.stream ? L.stream({ dir: -90, ...common }) : L.sustain({ level: o.level ?? 0.8, keepInView: false, ...common });
    const seen = new Set(), stats = { worst: 0, where: "", frames: 0, words: 0, outside: 0, boxes: [] };
    const end = E.now() + (o.ms ?? 5000);
    while ( E.now() < end ) {
      await E.tick(33, 33);
      for ( const h of run.handles ) { seen.add(h); for ( const c of h.echoes ?? [] ) seen.add(c); }
      const live = [];
      for ( const h of seen ) { const d = drawnOf(h); if ( d && d.a >= LEGIBLE_ALPHA ) live.push({ h, ...d }); }
      stats.frames++;
      if ( o.inside ) for ( const w of live ) { const y0 = Math.min(...w.P.map((p) => p.y)); if ( y0 < o.inside.y0 - 2 ) stats.outside++; }
      for ( let i = 0; i < live.length; i++ ) for ( let j = i + 1; j < live.length; j++ ) {
        const A = live[i], B = live[j];
        const f = clipArea(A.P, B.P) / Math.max(1e-9, Math.min(area(A.P), area(B.P)));
        if ( f > stats.worst ) { stats.worst = f; stats.where = `${((E.now() - end + (o.ms ?? 5000)) / 1000).toFixed(2)}s ${roleOf(A.h)} ${A.h.text} / ${roleOf(B.h)} ${B.h.text}`; }
      }
      if ( o.sample ) o.sample(E, live, run);
    }
    stats.words = seen.size;
    stats.history = (run.history ?? []).map((q) => `${q.kind}:${q.text}`);
    run.stop({ quick: true }); await E.tick(66, 33);
    E.restoreWarn?.();
    return stats;
  }
  const say = (o, r) => `${o.stream ? "stream" : "sustain"} ${o.kind} ${o.space ?? "world"} ${o.size}px ${o.face ?? "league"} ${o.motion ?? "smooth"}${o.reduced ? " reduced" : ""}${o.level != null ? ` level ${o.level}` : ""}: worst overlap ${(r.worst * 100).toFixed(1)} %${r.worst > OVERLAP_TOL ? ` (${r.where})` : ""} over ${r.words} words`;
  const noPile = async (o) => { const r = await runOf(o); ok(r.words >= 3 && r.worst <= OVERLAP_TOL, say(o, r)); return r; };

  /* 1. every sustained kind of the vocabulary, today's size, League Gothic, smooth */
  for ( const kind of Object.keys(FLOW) ) await block(kind, () => noPile({ kind, size: 58 }));
  /* 2. the sounds a map letters most (fire, hiss, a hum, an engine, a siren, wind, a storm) x the GM's size steps x faces x motion types */
  for ( const kind of ["fire", "hiss", "powerup", "engine", "siren", "wind", "storm"] ) for ( const size of [41, 58, 82] ) for ( const face of ["league", "anton"] ) for ( const motion of ["smooth", "stepped"] )
    await block(kind, () => noPile({ kind, size, face, motion, ms: 4000 }));
  /* 3. the map's burning fire exactly as it calls it (its treatments, its glow, quiet and loud) */
  for ( const size of [41, 58, 82] ) for ( const level of [0.3, 1] ) for ( const motion of ["smooth", "stepped"] )
    await block("burn", () => noPile({ kind: "fire", size, level, motion, extra: { treatments: ["breath", "stretch", "split", "shed", "accent"], glow: "auto", area: 120 }, ms: 4000 }));
  /* 4. reduced motion, quiet, the screen */
  for ( const kind of ["fire", "hiss", "powerup"] ) {
    await block(kind, () => noPile({ kind, size: 58, reduced: true }));
    await block(kind, () => noPile({ kind, size: 58, level: 0.2 }));
    for ( const size of [40, 56, 78] ) await block(kind, () => noPile({ kind, size, space: "screen", at: { x: 800, y: 500 }, ms: 4000 }));
  }
  /* 5. the view's edge: a run kept in view (keepInView default) near the top of the view stays whole, as one block, never piled */
  for ( const kind of ["fire", "powerup"] ) for ( const size of [58, 82] ) await block(kind, async () => {
    const top = 1500 - 450;   // the fake view: y 1050..1950 at zoom 1
    const o = { kind, size, at: { x: 2000, y: top + 30 }, extra: { keepInView: true }, inside: { y0: top } };
    const r = await runOf(o);
    ok(r.words >= 3 && r.worst <= OVERLAP_TOL && r.outside === 0, `${say(o, r)}; kept in view at the top edge: ${r.outside} word-frames above the view`);
  });
  /* 6. a caller's room: a run told to stay within `room` (extents round the source) stays there when it fits, and never piles when not */
  for ( const kind of ["fire", "hiss"] ) await block(kind, async () => {
    const o = { kind, size: 58, at: { x: 2000, y: 1500 }, extra: { room: { up: 200, down: 400, left: 400, right: 400 } }, inside: { y0: 1300 } };
    const r = await runOf(o);
    ok(r.words >= 3 && r.worst <= OVERLAP_TOL && r.outside === 0, `${say(o, r)}; inside a room 200 up: ${r.outside} word-frames above it`);
    const o2 = { kind, size: 58, extra: { room: { up: 60, down: 60, left: 300, right: 300 } } };
    const r2 = await runOf(o2);
    ok(r2.words >= 3 && r2.worst <= OVERLAP_TOL, `${say(o2, r2)}; a room too small for two seats: never piled`);
  });
  /* 7. streams: syllables up at once stand one beyond the other (a gun's rounds, a crackle, a hiss) */
  for ( const kind of ["gunfire", "minigun", "hiss", "fire", "siren"] ) for ( const size of [30, 45, 63] ) for ( const motion of ["smooth", "stepped"] ) {
    await block(kind, () => noPile({ kind, size, motion, stream: true, extra: { duration: 2500 }, ms: 3500 }));
    await block(kind, () => noPile({ kind, size, motion, face: "anton", stream: true, extra: { beats: [0, 90, 180, 300, 420, 470, 600, 700] }, ms: 2500 }));
  }
  for ( const kind of ["gunfire", "hiss"] ) await block(kind, () => noPile({ kind, size: 45, stream: true, space: "screen", at: { x: 800, y: 600 }, extra: { duration: 2000 }, ms: 3000 }));

  /* 8. one run on two seats (other clock origins, one joining 2.5 s late): on the event's clock both show the same phrase at the same
     instant, at the same place round the source */
  await block("seats", async () => {
    const shots = [];
    for ( const seatN of [0, 1] ) {
      const E = await setup(); const L = E.engine; L.lookStyle("invincible");
      if ( seatN ) await E.tick(2500 + 137, 33);            // this seat's page clock is 2.637 s ahead: it joins the same event late
      const start = E.now() - (seatN ? 2500 : 0);          // the event's instant on this page's clock
      const s = L.sustain({ kind: "fire", lang: "en", space: "world", at: { x: 2000, y: 1500 }, level: 0.8, seed: "two-seats", size: 58, keepInView: false, startAt: start });
      const got = new Map();
      for ( let t = 0; t < 6000; t += 33 ) {
        await E.tick(33, 33);
        const age = Math.round((E.now() - start) / 100) * 100;
        if ( age < 3000 || age > 5500 || got.has(age) ) continue;
        const words = s.handles.filter((h) => roleOf(h) === "word" && h.sprite?.visible && (h.sprite.alpha ?? 1) >= LEGIBLE_ALPHA).map((h) => `${h.text}@${Math.round(h.sprite.position.y - 1500)}`).sort();
        got.set(age, words.join(" "));
      }
      shots.push(got); s.stop({ quick: true }); E.restoreWarn?.();
    }
    let same = 0, cmp = 0, first = "";
    for ( const [age, w] of shots[0] ) if ( shots[1].has(age) ) { cmp++; const w2 = shots[1].get(age); const sameT = w.replace(/@-?\d+/g, "") === w2.replace(/@-?\d+/g, ""); const yy = (q) => (q.match(/@(-?\d+)/g) ?? []).map((x) => +x.slice(1)); const dy = yy(w).every((y, i) => Math.abs(y - (yy(w2)[i] ?? 1e9)) <= 3); if ( sameT && dy ) same++; else if ( !first ) first = `${age} ms: "${w}" vs "${w2}"`; }
    ok(cmp >= 15 && same >= cmp - 2, `sustain seats: on the event's clock a seat joining 2.5 s late shows the same phrases at the same place (${same}/${cmp} instants alike${first ? `; first differing ${first}` : ""})`);
  });

  /* 9. a word drawn in by parts (a split phrase, `parts`) stands in its hold's first pose until the hold begins: the hold's decaying
     envelopes read at a negative time threw it hundreds of cap heights away and seven times its size (1.9.14: recoil, throb, roll) */
  for ( const [t, k] of [["KA-BUM", "explosion"], ["KRA-KA-DOOM", "thunder"], ["TIK-TAK", "clock"], ["CLANG-CLANG", "bell"], ["THUD-THUD", "step"]] ) await block(t, async () => {
    const E = await setup(); const L = E.engine; L.lookStyle("invincible");
    const h = await L.play(t, { kind: k, parts: "syllables", seed: `sg-parts-${t}`, at: { x: 2000, y: 1500 }, space: "world", size: 58 });
    let mx = 0, ms = 0;
    for ( let f = 0; f < 45; f++ ) { await E.tick(33, 33); const sp = h.sprite; if ( !sp?.visible ) continue; mx = Math.max(mx, Math.hypot(sp.position.x - 2000, sp.position.y - 1500)); ms = Math.max(ms, Math.abs(sp.scale.y)); }
    const cap = h.size * h.plan.sizeK;
    ok(mx / cap <= 0.5 && ms <= 1.6, `parts ${t} (${k}, hold ${h.track?.hold}): stays at its place while drawn in by parts (max ${(mx / cap).toFixed(2)} cap off, scale ${ms.toFixed(2)})`);
    E.restoreWarn?.();
  });

  /* 10. (1.9.25 MAPBURN) a caller's score: `words` may give each phrase its own treatment, loudness, size share and face; a call
     whose function returns none of them letters exactly what it did (the same words, sizes and places as with a plain string) */
  await block("score", async () => {
    const mk = async (words) => {
      const E = await setup(); const L = E.engine; L.lookStyle("invincible");
      const s = L.sustain({ kind: "fire", lang: "en", space: "world", fit: "world", at: () => ({ x: 2000, y: 1500 }), seed: "sg-score", size: 60, keepInView: false, level: 0.6, startAt: E.now(), words });
      const rows = new Map();
      for ( let t = 0; t < 6000; t += 33 ) { await E.tick(33, 33); for ( const h of s.handles ) if ( h.text && h.sprite?.visible && !rows.has(h) ) rows.set(h, { text: h.text, size: h.size, col: h.opts?.colors?.[0] ?? null, slam: h.opts?.in === "slam", y: Math.round(h.sprite.position.y) }); }
      s.stop({ quick: true }); E.restoreWarn?.();
      return [...rows.values()];
    };
    const T4 = ["TIK", "FWUFF", "KRAKK", "GROOOM!"];
    const sc = (i) => ({ text: T4[i % 4], mood: "fire", ms: 900, scale: [0.5, 0.65, 0.8, 1][i % 4], colors: [["#ffc530", "#ffd83a", "#ffe566", "#fff9dc"][i % 4]], level: [0.2, 0.4, 0.6, 0.9][i % 4], treat: i % 4 === 3 ? "accent" : "breath" });
    const a = await mk(sc);
    const by = (t) => a.filter((r) => r.text === t);
    ok(a.length >= 5 && by("TIK").length && by("GROOOM!").length, `sustain score: the caller's phrases are lettered (${a.map((r) => r.text).join(" ")})`);
    ok(by("TIK").every((r) => Math.abs(r.size - 30) < 0.01) && by("FWUFF").every((r) => Math.abs(r.size - 39) < 0.01) && by("GROOOM!").every((r) => Math.abs(r.size - 60) < 0.01), `sustain score: each phrase at its own share of the run's size (${a.map((r) => r.size.toFixed(0)).join(" ")})`);
    ok(by("TIK").every((r) => r.col === "#ffc530") && by("GROOOM!").every((r) => r.col === "#fff9dc"), "sustain score: each phrase in its own face");
    ok(by("GROOOM!").every((r) => r.slam) && by("TIK").every((r) => !r.slam), "sustain score: the phrase's own treatment (the accent slams in, the others do not)");
    const plain = await mk((i) => T4[i % 4]), obj = await mk((i) => ({ text: T4[i % 4] }));
    ok(plain.length >= 3 && JSON.stringify(plain) === JSON.stringify(obj), "sustain score: a function that gives only the text letters as before (string and { text } alike)");
    ok(plain.every((r) => r.size <= 60.01 && r.col === null) && plain.filter((r) => Math.abs(r.size - 60) < 0.01).length >= 3, `sustain score: with no share and no face the run's own size and palette (${plain.map((r) => `${r.size.toFixed(1)}/${r.col}`).join(" ")})`);
  });

  console.log(`sustain-engine: ${n} checks, ${failed} failed`);
  return failed;
}
if ( process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--engine") ) {
  const other = process.argv.slice(2).find((a) => !a.startsWith("--"));
  process.exit((await engineChecks(other ? path.resolve(other) : path.dirname(fileURLToPath(import.meta.url)))) ? 1 : 0);
}
