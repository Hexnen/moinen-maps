// LETR ENGVIEW (1.9.18): one table picture from the public API alone. Own process on the fake browser (testenv.mjs):
//   node check-engview.mjs --engine              this folder; prints "engview-engine: N checks, F failed"
//   node check-engview.mjs --engine <letters>    the same checks on another engine folder (1.9.17: the new points fail)
// E2 a lasting sound on the event's clock (`startAt`): a seat joining late shows the same phrases at the same instants and places, in
//    every style (the legacy run too), with a level that is a function of the event's age, and on two seats with other windows and zooms
// E3 an explicit view for the size model: L.sizeOf / L.measure / L.play with `view` give every seat the same size, whatever its window,
//    zoom, density and its own words up; without a view nothing changes; a view equal to the seat's own reproduces it
// E4 streams honour a caller's view and scale as a word does; L.streamUnit names the sizes the syllables are played with
// E1 L.measure gives the standing footprint (stand: hold poses, life, keyline, rim, duplicate block) and the entrance's ink reach: measured
//    against the INK each painted picture lays down (a recording context's bounds in the sprite's real transform), every frame, for a
//    spread of words, both faces, both motion types, world and screen, a turned word, the legacy style
// E5 the impact's strength ladders from the running engine (L.impact.tierOf / stepOf / tiers): the same as the plans it draws
// E6 `ceilK` stays unread (sizes unchanged) and a caller who passes it is told once (console), and L.measure lists it as unread
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

/* a 2D context that records only the bounds of the ink it lays down (canvas px): fills by their path's points, strokes widened by half
   the line width (a mitre join up to its limit), images and rectangles by their corners; transparent paint is skipped */
export function inkRecorder() {
  const made = [];
  const make = (w, h) => {
    const B = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const st = { tf: [1, 0, 0, 1, 0, 0], stack: [], alpha: 1, lw: 1, join: "miter", ml: 10, pts: [], clip: { x0: 0, y0: 0, x1: w, y1: h } };   // nothing lands outside the canvas
    const T = (x, y) => { const [a, b, c, d, e, f] = st.tf; return [a * x + c * y + e, b * x + d * y + f]; };
    const mul = (m) => { const [a, b, c, d, e, f] = st.tf, [A, Bb, C, D, E, F] = m; st.tf = [a * A + c * Bb, b * A + d * Bb, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f]; };
    const scl = () => Math.sqrt(Math.abs(st.tf[0] * st.tf[3] - st.tf[1] * st.tf[2])) || 1;
    const add = (x, y, r = 0) => {
      let a0 = x - r, a1 = x + r, b0 = y - r, b1 = y + r; const c = st.clip;
      if ( c ) { a0 = Math.max(a0, c.x0); a1 = Math.min(a1, c.x1); b0 = Math.max(b0, c.y0); b1 = Math.min(b1, c.y1); if ( a0 > a1 || b0 > b1 ) return; }
      B.x0 = Math.min(B.x0, a0); B.x1 = Math.max(B.x1, a1); B.y0 = Math.min(B.y0, b0); B.y1 = Math.max(B.y1, b1);
    };
    const pt = (x, y) => st.pts.push(T(x, y));
    const ctx = {
      canvas: { width: w, height: h },
      get globalAlpha() { return st.alpha; }, set globalAlpha(v) { st.alpha = v; },
      get lineWidth() { return st.lw; }, set lineWidth(v) { st.lw = v; },
      get lineJoin() { return st.join; }, set lineJoin(v) { st.join = v; },
      get miterLimit() { return st.ml; }, set miterLimit(v) { st.ml = v; },
      fillStyle: "#000", strokeStyle: "#000", lineCap: "butt", globalCompositeOperation: "source-over", filter: "none", shadowBlur: 0, shadowColor: "", imageSmoothingEnabled: true,
      save() { st.stack.push({ tf: st.tf.slice(), alpha: st.alpha, lw: st.lw, join: st.join, ml: st.ml, clip: st.clip }); },
      restore() { const v = st.stack.pop(); if ( v ) Object.assign(st, v); },
      beginPath() { st.pts = []; }, moveTo: pt, lineTo: pt, closePath() {},
      quadraticCurveTo(a, b, x, y) { pt(a, b); pt(x, y); }, bezierCurveTo(a, b, c, d, x, y) { pt(a, b); pt(c, d); pt(x, y); },
      arc(x, y, r) { pt(x - r, y - r); pt(x + r, y + r); pt(x - r, y + r); pt(x + r, y - r); }, arcTo(a, b, x, y) { pt(a, b); pt(x, y); },
      ellipse(x, y, rx, ry) { const r = Math.max(rx, ry); pt(x - r, y - r); pt(x + r, y + r); pt(x - r, y + r); pt(x + r, y - r); },
      rect(x, y, ww, hh) { pt(x, y); pt(x + ww, y); pt(x + ww, y + hh); pt(x, y + hh); },
      fill() { if ( st.alpha > 0 && ctx.globalCompositeOperation !== "destination-out" ) for ( const [x, y] of st.pts ) add(x, y); },
      stroke() { if ( st.alpha <= 0 || ctx.globalCompositeOperation === "destination-out" ) return; const r = (st.lw / 2) * scl() * (st.join === "miter" ? Math.max(1, st.ml) : 1); for ( const [x, y] of st.pts ) add(x, y, r); },
      clip() { if ( !st.pts.length ) return; const xs = st.pts.map((p) => p[0]), ys = st.pts.map((p) => p[1]), c = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }, o = st.clip; st.clip = o ? { x0: Math.max(o.x0, c.x0), x1: Math.min(o.x1, c.x1), y0: Math.max(o.y0, c.y0), y1: Math.min(o.y1, c.y1) } : c; }, fillRect(x, y, ww, hh) { if ( st.alpha > 0 ) for ( const [X, Y] of [[x, y], [x + ww, y], [x + ww, y + hh], [x, y + hh]] ) { const q = T(X, Y); add(q[0], q[1]); } },
      strokeRect() {}, clearRect() {},
      drawImage(img, ...a) {
        if ( st.alpha <= 0 ) return;
        /* a source rect (9 args) or the whole image; a recorded canvas brings only its own ink */
        const [sx, sy, sw, sh] = a.length >= 8 ? a.slice(0, 4) : [0, 0, img.width, img.height];
        const [dx, dy, dw, dh] = a.length >= 8 ? a.slice(4) : a.length >= 4 ? a : [a[0], a[1], img.width, img.height];
        const ib = img.__ink; let u0 = sx, v0 = sy, u1 = sx + sw, v1 = sy + sh;
        if ( ib ) { if ( !Number.isFinite(ib.x0) ) return; u0 = Math.max(u0, ib.x0); v0 = Math.max(v0, ib.y0); u1 = Math.min(u1, ib.x1); v1 = Math.min(v1, ib.y1); if ( u0 > u1 || v0 > v1 ) return; }
        const mx = (u) => dx + ((u - sx) / (sw || 1)) * dw, my = (v) => dy + ((v - sy) / (sh || 1)) * dh;
        for ( const [X, Y] of [[mx(u0), my(v0)], [mx(u1), my(v0)], [mx(u1), my(v1)], [mx(u0), my(v1)]] ) { const q = T(X, Y); add(q[0], q[1]); }
      },
      translate(x, y) { mul([1, 0, 0, 1, x, y]); }, scale(x, y = x) { mul([x, 0, 0, y, 0, 0]); }, rotate(r) { const c = Math.cos(r), s = Math.sin(r); mul([c, s, -s, c, 0, 0]); },
      transform(a, b, c, d, e, f) { mul([a, b, c, d, e, f]); }, setTransform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) { st.tf = typeof a === "object" ? [1, 0, 0, 1, 0, 0] : [a, b, c, d, e, f]; }, resetTransform() { st.tf = [1, 0, 0, 1, 0, 0]; },
      setLineDash() {}, createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createPattern: () => "pat",
      getImageData: (x, y, ww, hh) => ({ data: new Uint8ClampedArray(Math.max(4, ww * hh * 4)) }), putImageData() {}, measureText: () => ({ width: 1 }), fillText() {}, strokeText() {}
    };
    const cv = { width: w, height: h, getContext: () => ctx, __ink: B };
    Object.defineProperty(ctx.canvas, "__ink", { value: B });
    made.push(cv); return cv;
  };
  return { made, make, boundsOf: (cv) => cv.__ink };
}

export async function engineChecks(dir) {
  let n = 0, failed = 0;
  const ok = (c, msg) => { n++; if ( !c ) { failed++; console.log("FAIL", msg); } else if ( process.env.LETR_VERBOSE ) console.log("ok  ", msg); };
  const U = (f) => pathToFileURL(path.join(dir, f)).href;
  globalThis.__letrRealST = (f) => setImmediate(f);
  const { setup } = await import(U("testenv.mjs"));
  const section = async (name, f) => { if ( process.env.LETR_ONLY && !process.env.LETR_ONLY.split(",").includes(name) ) return; try { await f(); } catch ( e ) { ok(false, `${name}: threw ${e?.stack?.split("\n").slice(0, 3).join(" | ") ?? e}`); } };
  const W0 = { x: 2000, y: 1500 };
  /* a seat: its own window, zoom, density, page clock origin and words of its own up */
  const seat = async ({ w = 1600, h = 900, zoom = 1, dpr = 1, ahead = 0, own = 0, style = "invincible", face = "league", motion = "smooth" } = {}) => {
    const E = await setup(); const L = E.engine;
    L.lookStyle(style); L.invFace?.(face); L.motionMode?.(motion);
    globalThis.innerWidth = w; globalThis.innerHeight = h; globalThis.devicePixelRatio = dpr; canvas.stage.scale.x = zoom; canvas.stage.scale.y = zoom;
    canvas.stage.toLocal ??= (p) => ({ x: (p.x - 800) / canvas.stage.scale.x + canvas.stage.pivot.x, y: (p.y - 450) / canvas.stage.scale.x + canvas.stage.pivot.y });
    if ( ahead ) await E.tick(ahead, 33);
    for ( let i = 0; i < own; i++ ) L.play("TIK", { space: "world", at: { x: 400 + 60 * i, y: 300 }, seed: `own${i}`, hold: 60000 });
    if ( own ) await E.tick(200, 33);
    return { E, L };
  };
  const warns = () => { const got = [], w0 = console.warn; console.warn = (...a) => got.push(a.join(" ")); return { got, done: () => { console.warn = w0; } }; };
  const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
  const sameObj = (a, b, tol) => a && b && Object.keys(a).every((k) => near(a[k], b[k], tol));
  const TABLE = { vw: 1600, vh: 900, zoom: 0.43, alive: 2 };

  /* ---------- E3: an explicit view ---------- */
  await section("view", async () => {
    const calls = [
      ["KA-BOOM!", { space: "world", at: W0, magnitude: 1.4, area: 300, seed: "v1" }], ["KRAK!", { space: "world", at: W0, seed: "v2" }],
      ["FWOOSH", { space: "world", at: W0, kind: "fire", magnitude: 0.3, seed: "v3", reduced: false }], ["KRA-KA-GRRAWOOM!", { space: "screen", at: { x: 800, y: 300 }, kind: "thunder", seed: "v4", reduced: false }],
      ["THWAK!", { space: "world", at: W0, ceil: 0.6, magnitude: 1, seed: "v5", reduced: false, rotation: 6 }]
    ];
    const seats = [{}, { w: 1366, h: 768, zoom: 0.9, dpr: 2, own: 14 }, { w: 2560, h: 1300, zoom: 0.25, dpr: 1.25, own: 3 }];
    const got = [];
    for ( const s of seats ) {
      const { E, L } = await seat(s);
      got.push(calls.map(([t, o]) => {
        const z = L.sizeOf(t, { ...o, view: TABLE }), m = L.measure(t, { ...o, view: TABLE }), z0 = L.sizeOf(t, o), m0 = L.measure(t, o);
        /* the seat's own view, named: reproduces the call without a view */
        const own = { vw: z0.view?.vw, vh: innerHeight, zoom: o.space === "world" ? canvas.stage.scale.x : undefined, alive: o.space === "world" ? L.count({ space: "world" }) : 0, dpr: devicePixelRatio };
        const zs = L.sizeOf(t, { ...o, view: own });
        return { z, m: m && { unit: m.unit, px: m.px, hold: m.hold, reach: m.reach, stand: m.stand, inkReach: m.inkReach, rim: m.rim }, z0, zs, m0u: m0?.unit };
      }));
      L.stopAll(); E.restoreWarn?.();
    }
    for ( let i = 0; i < calls.length; i++ ) {
      const [a, b, c] = got.map((g) => g[i]), t = calls[i][0];
      ok(near(a.z.size, b.z.size) && near(a.z.size, c.z.size) && a.z.clamp === b.z.clamp && a.z.clamp === c.z.clamp && near(a.z.px, c.z.px), `E3 ${t}: L.sizeOf with the table's view gives three seats (1600x900 z1 / 1366x768 z0.9 dpr2 14 words up / 2560x1300 z0.25) one size (${a.z.size.toFixed(2)} ${b.z.size.toFixed(2)} ${c.z.size.toFixed(2)}, ${a.z.clamp})`);
      ok(sameObj(a.m.hold, b.m.hold) && sameObj(a.m.reach, c.m.reach) && sameObj(a.m.stand, b.m.stand) && sameObj(a.m.stand, c.m.stand) && sameObj(a.m.inkReach, b.m.inkReach) && near(a.m.rim, c.m.rim), `E3 ${t}: L.measure with the table's view: the same hold box, reach, stand and ink reach on every seat (stand l ${a.m.stand.l.toFixed(2)} / ${b.m.stand.l.toFixed(2)} / ${c.m.stand.l.toFixed(2)})`);
      ok(near(b.zs.size, b.z0.size) && near(c.zs.size, c.z0.size) && b.zs.clamp === b.z0.clamp, `E3 ${t}: a view naming the seat's own window, zoom, words up and density reproduces the call without one (${b.z0.size.toFixed(2)} = ${b.zs.size.toFixed(2)})`);
      if ( calls[i][1].space === "world" ) ok(!near(b.z0.size, c.z0.size, 1e-3) || a.z0.clamp === null, `E3 ${t}: without a view each seat sizes for its own window (${b.z0.size.toFixed(1)} vs ${c.z0.size.toFixed(1)}): the view is what makes them equal`);
    }
    /* a played word keeps the table's size, also when this seat zooms; a view's bad field warns once and falls back to the seat's */
    for ( const s of seats.slice(0, 2) ) {
      const { E, L } = await seat(s);
      const h = L.play("KA-BOOM!", { space: "world", at: W0, magnitude: 1.4, seed: "vp", view: TABLE });
      await E.tick(200, 33);
      const s0 = h.size; canvas.stage.scale.x = canvas.stage.scale.y = 1.7; await E.tick(200, 33);
      ok(near(h.size, L.sizeOf("KA-BOOM!", { space: "world", magnitude: 1.4, seed: "vp", view: TABLE }).size) && near(h.size, s0), `E3 play with a view: the word is drawn at the table's world size (${s0.toFixed(2)}) and keeps it when this seat zooms (${h.size.toFixed(2)})`);
      L.stopAll(); E.restoreWarn?.();
    }
    {
      const { E, L } = await seat({ w: 1366, h: 768 });
      const wv = warns();
      const z = L.sizeOf("KRAK!", { space: "screen", seed: "vb", view: { vh: "big", vw: 1366 } }), z0 = L.sizeOf("KRAK!", { space: "screen", seed: "vb" });
      const z2 = L.sizeOf("KRAK!", { space: "screen", seed: "vb", view: 7 });
      wv.done();
      ok(near(z.size, z0.size) && near(z2.size, z0.size) && wv.got.some((m) => /view\.vh/.test(m)) && wv.got.some((m) => /option view/.test(m)), `E3 a bad view field is ignored with one warning (this seat's value is used): ${wv.got.length} warnings`);
      E.restoreWarn?.();
    }
  });

  /* ---------- E4: streams ---------- */
  await section("stream", async () => {
    const run = async (s, o) => {
      const { E, L } = await seat(s);
      const st = L.stream({ kind: "gunfire", lang: "en", space: "world", at: W0, dir: -90, beats: [0, 90, 180, 300, 420], seed: "st", keepInView: false, loud: (i) => 0.7 + 0.3 * Math.sin(i * 1.7), ...o });
      const seen = new Map();
      for ( let f = 0; f < 30; f++ ) { await E.tick(33, 33); for ( const h of st.handles ) if ( !seen.has(h.opts.seed) ) seen.set(h.opts.seed, { size: h.size, opt: h.opts.size, word: L.sizeOf(h.text, { space: "world", size: h.opts.size, magnitude: h.opts.magnitude, fit: h.opts.fit, scale: h.opts.scale, view: h.opts.view, seed: h.opts.seed, hand: h.opts.hand }).size }); }
      const u = L.streamUnit({ kind: "gunfire", space: "world", at: W0, ...o });
      st.stop({ quick: true }); L.stopAll(); E.restoreWarn?.();
      return { seen: [...seen.values()], u };
    };
    const o = { view: TABLE, magnitude: 0.6, area: 80 };
    const a = await run({}, o), b = await run({ w: 1366, h: 768, zoom: 0.9, dpr: 2, own: 10 }, o), c = await run({ w: 2560, h: 1300, zoom: 0.25 }, o);
    ok(a.seen.length >= 4 && a.seen.every((x, i) => near(x.size, b.seen[i]?.size) && near(x.size, c.seen[i]?.size)), `E4 a stream with the table's view: every syllable the same size on three seats (${a.seen.map((x) => x.size.toFixed(1)).join(" ")} / ${b.seen.map((x) => x.size.toFixed(1)).join(" ")})`);
    const n0 = await run({}, { magnitude: 0.6, area: 80 }), n1 = await run({ w: 1366, h: 768, zoom: 2.4 }, { magnitude: 0.6, area: 80 });
    ok(n0.seen.some((x, i) => !near(x.size, n1.seen[i]?.size, 1e-3)), `E4 without a view each seat clamps the syllables to its own zoom (${n0.seen[0]?.size.toFixed(1)} vs ${n1.seen[0]?.size.toFixed(1)})`);
    const loud = (i) => Math.max(0, Math.min(1, 0.7 + 0.3 * Math.sin(i * 1.7)));
    ok(a.seen.every((x, i) => near(x.opt, a.u.sizeOf(i, loud(i)))), `E4 L.streamUnit names the size every syllable is played with (unit ${a.u.unit.toFixed(2)}; ${a.seen.map((x) => x.opt.toFixed(1)).join(" ")})`);
    const sc = await run({}, { ...o, scale: 0.5 });
    ok(sc.seen.length >= 4 && sc.seen.every((x, i) => x.size < a.seen[i].size && near(x.size, x.word)) && a.seen.every((x) => near(x.size, x.word)), `E4 a stream honours a caller's scale as a word does: each syllable is the size L.sizeOf gives that word with the same options (${sc.seen[0]?.size.toFixed(1)} = ${sc.seen[0]?.word.toFixed(1)} at 0.5 against ${a.seen[0]?.size.toFixed(1)})`);
    const fx = await run({}, { size: 30, fit: "world" });
    ok(near(fx.u.unit, 30) && fx.seen.every((x, i) => near(x.size, fx.u.sizeOf(i, loud(i)))), `E4 a stream's explicit unit with fit world: syllables drawn at exactly streamUnit's sizes`);
  });

  /* ---------- E2: a lasting sound on the event's clock ---------- */
  await section("sustain", async () => {
    const shotsOf = async (style, seats, extra = {}, sizes = true) => {
      const shots = [];
      for ( const [i, s] of seats.entries() ) {
        const late = i ? 2508 : 0;   // on the 33 ms frame grid, so both seats are sampled at the same ages
        const { E, L } = await seat({ ...s, style, ahead: (s.ahead ?? 0) + late + (i ? 132 : 0) });
        const start = E.now() - late;
        const st = L.sustain({ kind: "fire", lang: "en", space: "world", at: W0, seed: `two-${style}`, size: 58, keepInView: false, startAt: start, ...extra });
        const got = new Map();
        for ( let t = 0; t < 6600; t += 33 ) {
          await E.tick(33, 33);
          const age = Math.round(E.now() - start);
          /* from 1 s after the late seat joins: a phrase the seat on time had already left (exit running) is not drawn by the late
             seat (it joins at the phrases still up or to come, as the invincible run does), so the first moments may lack a fading word */
          if ( age < 3508 || age > 6000 || got.has(age) ) continue;
          const words = st.handles.filter((h) => !/:tail|echo|:shed/.test(String(h.opts?.seed)) && (h.sprite?.visible) && (h.sprite.alpha ?? 1) >= 0.5).map((h) => `${h.text}@${Math.round(h.sprite.position.y - 1500)}#${h.size.toFixed(1)}`).sort();
          got.set(age, words.join(" "));
        }
        shots.push(got); st.stop({ quick: true }); L.stopAll(); E.restoreWarn?.();
      }
      let same = 0, cmp = 0, first = "";
      const yy = (q) => (q.match(/@(-?\d+)/g) ?? []).map((x) => +x.slice(1)), ss = (q) => (q.match(/#([\d.]+)/g) ?? []).map((x) => +x.slice(1));
      for ( const [age, w] of shots[0] ) for ( const other of shots.slice(1) ) if ( other.has(age) ) {
        cmp++; const w2 = other.get(age);
        const sameT = w.replace(/[@#][-\d.]+/g, "") === w2.replace(/[@#][-\d.]+/g, ""), dy = yy(w).every((y, i) => Math.abs(y - (yy(w2)[i] ?? 1e9)) <= 3), dsz = ss(w).every((s, i) => Math.abs(s - (ss(w2)[i] ?? 1e9)) <= 0.15);
        if ( sameT && dy && (dsz || !sizes) ) same++; else if ( !first ) first = `${age} ms: "${w}" vs "${w2}"`;
      }
      return { same, cmp, first };
    };
    const lvl = (ms) => 0.35 + 0.6 * Math.min(1, ms / 4000);   // the level as a function of the event's age (ms since startAt)
    /* without a view only the phrases and places are the event's: a legacy word's size follows the words this seat has up (its own
       catch-up started fewer), so sizes are compared with a view below */
    for ( const style of ["invincible", "comic", "expressive"] ) {
      const r = await shotsOf(style, [{}, {}], { level: lvl }, style === "invincible");
      ok(r.cmp >= 60 && r.same === r.cmp, `E2 ${style}: a seat joining 2.5 s late (page clock 2.64 s ahead) shows the same phrases at the same places${style === "invincible" ? " and sizes" : ""} as the seat on time (level a function of the event's age; ${r.same}/${r.cmp} instants alike${r.first ? `; first differing ${r.first}` : ""})`);
    }
    /* the table's view: two seats with other windows and zooms, one late: the same phrases, places AND sizes */
    for ( const style of ["invincible", "comic", "expressive"] ) {
      const r = await shotsOf(style, [{}, { w: 1366, h: 768, zoom: 0.6, dpr: 2, own: 6 }], { level: lvl, view: TABLE });
      ok(r.cmp >= 60 && r.same === r.cmp, `E2 ${style} + view: a late seat with another window and zoom shows the same phrases at the same places and sizes (${r.same}/${r.cmp}${r.first ? `; first differing ${r.first}` : ""})`);
    }
    /* the level function is read with the phrase's own age: what a late seat asks for a past phrase is the age it had then */
    {
      const { E, L } = await seat({ ahead: 3000 });
      const asked = [];
      const st = L.sustain({ kind: "fire", lang: "en", space: "world", at: W0, seed: "lv", size: 58, keepInView: false, startAt: E.now() - 2500, level: (ms) => { asked.push(ms); return 0.6; } });
      await E.tick(100, 33);
      ok(asked.length >= 2 && asked[0] === 0 && asked.every((v, i) => !i || v >= asked[i - 1] - 1e-9) && asked.some((v) => v > 0 && v < 2500), `E2 the level is asked with each phrase's own age, from 0 (${asked.slice(0, 6).map((v) => Math.round(v)).join(", ")} ...)`);
      st.stop({ quick: true }); E.restoreWarn?.();
    }
  });

  /* ---------- E1: the standing footprint and the entrance's ink reach, against the ink drawn ---------- */
  await section("stand", async () => {
    const { paintPicture } = await import(U("paint.mjs"));
    const words = [["KA-BOOM!", "explosion"], ["KRAK!", "crack"], ["THWAK!", "punch"], ["FWOOOSH", "fire"], ["KLANGG!", "bell"], ["SPLOOSH", "splash"], ["ZZAP!", "zap"], ["BTHOOM!!", "cavein"]];
    let worstOut = 0, worstOutR = 0, slack = [], cases = 0, oldMiss = 0, frames = 0, lives = 0, rims = 0;
    const inkOf = (L, h) => {
      const c = h.shown; if ( !c?.canvas ) return null;
      const rec = inkRecorder();
      const r = paintPicture(h.plan, L._bank, h.pics[c.idx], c.want, rec.make);
      const Bk = rec.boundsOf(r.canvas);
      if ( !Number.isFinite(Bk.x0) ) return null;
      const P = [[Bk.x0, Bk.y0], [Bk.x1, Bk.y0], [Bk.x1, Bk.y1], [Bk.x0, Bk.y1]];
      if ( h.sprite ) {
        const sp = h.sprite; if ( !sp.visible || (sp.alpha ?? 1) < 0.02 ) return null;
        const cs = Math.cos(sp.rotation || 0), sn = Math.sin(sp.rotation || 0);
        return P.map(([x, y]) => { x = (x - r.ax) * sp.scale.x; y = (y - r.ay) * sp.scale.y; return { x: sp.position.x + x * cs - y * sn, y: sp.position.y + x * sn + y * cs }; });
      }
      const tf = String(h.box.style.transform ?? ""), m = tf.match(/translate\(([-\d.]+)px,([-\d.]+)px\) rotate\(([-\d.]+)rad\)(?: scale\(([-\d.]+)(?:,([-\d.]+))?\))?/);
      if ( !m || h.box.style.visibility === "hidden" || +(h.box.style.opacity ?? 1) < 0.02 ) return null;
      const X = +m[1], Y = +m[2], rr = +m[3], sx = m[4] ? +m[4] : 1, sy = m[5] ? +m[5] : sx, cs = Math.cos(rr), sn = Math.sin(rr), k = c.rs;
      return P.map(([x, y]) => { x = ((x - r.ax) / k) * sx; y = ((y - r.ay) / k) * sy; return { x: X + x * cs - y * sn, y: Y + x * sn + y * cs }; });
    };
    const combos = [];
    for ( const [t, kind] of words ) for ( const face of ["league", "anton"] ) for ( const motion of ["smooth", "stepped"] ) for ( const space of ["world", "screen"] ) combos.push({ t, kind, face, motion, space, style: "invincible" });
    for ( const [t, kind] of words.slice(0, 4) ) { combos.push({ t, kind, face: "league", motion: "smooth", space: "world", style: "invincible", rotation: 8, zoom: 0.5 }); combos.push({ t, kind, face: "league", motion: "smooth", space: "world", style: "comic" }); combos.push({ t, kind, face: "league", motion: "smooth", space: "screen", style: "comic", rotation: -5 }); }
    for ( const cmb of combos ) {
      const { E, L } = await seat({ style: cmb.style, face: cmb.face, motion: cmb.motion, zoom: cmb.zoom ?? 1 });
      const at = cmb.space === "world" ? W0 : { x: 800, y: 450 };
      const o = { kind: cmb.kind, space: cmb.space, at, seed: `st-${cmb.t}`, reduced: false, magnitude: 0.8, hold: 1500, rotation: cmb.rotation ?? 0, keepInView: false };
      const m = L.measure(cmb.t, o);
      const h = L.play(cmb.t, o);
      cases++;
      if ( m.life ) lives++; if ( m.rim > 0 ) rims++;
      const unit = m.unit, sb = m.standBox, rb = m.inkReachBox;
      let worstAt = "", out = 0, outR = 0, hx0 = Infinity, hx1 = -Infinity, hy0 = Infinity, hy1 = -Infinity, miss = false;
      for ( let f = 0; f < 70; f++ ) {
        await E.tick(33, 33);
        if ( h.t0 == null || !h.shown ) continue;
        const age = E.now() - h.t0 - (h.lag || 0);
        if ( age > h.entMs + h.holdMs ) break;
        const P = inkOf(L, h); if ( !P ) continue;
        frames++;
        const x0 = Math.min(...P.map((p) => p.x)), x1 = Math.max(...P.map((p) => p.x)), y0 = Math.min(...P.map((p) => p.y)), y1 = Math.max(...P.map((p) => p.y));
        const oR = Math.max(rb.x0 - x0, x1 - rb.x1, rb.y0 - y0, y1 - rb.y1);
        if ( oR > outR ) { outR = oR; worstAt = `${Math.round(age)} ms pic ${h.shown.idx} ink ${[x0, y0, x1, y1].map(Math.round)} reach ${[rb.x0, rb.y0, rb.x1, rb.y1].map(Math.round)}`; }
        if ( age >= h.entMs + 40 ) {
          out = Math.max(out, sb.x0 - x0, x1 - sb.x1, sb.y0 - y0, y1 - sb.y1);
          hx0 = Math.min(hx0, x0); hx1 = Math.max(hx1, x1); hy0 = Math.min(hy0, y0); hy1 = Math.max(hy1, y1);
          if ( x0 < m.box.x0 - 0.5 || x1 > m.box.x1 + 0.5 || y0 < m.box.y0 - 0.5 || y1 > m.box.y1 + 0.5 ) miss = true;
        }
      }
      if ( miss ) oldMiss++;
      const px = cmb.space === "world" ? (cmb.zoom ?? 1) : 1;   // world units -> screen px
      worstOut = Math.max(worstOut, out * px); worstOutR = Math.max(worstOutR, outR * px);
      if ( Number.isFinite(hx0) ) slack.push(Math.max(hx0 - sb.x0, sb.x1 - hx1, hy0 - sb.y0, sb.y1 - hy1) / unit);
      if ( process.env.LETR_VERBOSE ) console.log(`  stand ${cmb.style} ${cmb.t} ${cmb.face} ${cmb.motion} ${cmb.space} rot ${cmb.rotation ?? 0}: out ${(out * px).toFixed(2)} px, reach out ${(outR * px).toFixed(2)} px, slack ${(slack.at(-1) ?? 0).toFixed(2)} cap, life ${!!m.life}, rim ${m.rim.toFixed(3)}${outR > 0.5 ? ` (worst reach at ${worstAt})` : ""}`);
      L.stopAll(); E.restoreWarn?.();
    }
    slack.sort((a, b) => a - b);
    ok(cases >= 70 && frames > 2000 && worstOut <= 2, `E1 ${cases} words (8 texts x 2 faces x 2 motion types x world/screen, turned, zoomed, the legacy style): the standing ink of every hold frame (${frames} frames) stays inside L.measure's standBox (worst ${worstOut.toFixed(2)} px outside)`);
    ok(worstOutR <= 2, `E1 every entrance and hold frame's ink stays inside L.measure's inkReachBox (worst ${worstOutR.toFixed(2)} px outside)`);
    ok(slack.length && slack[Math.floor(slack.length / 2)] <= 0.35, `E1 the standBox is close to the ink: median ${slack[Math.floor(slack.length / 2)]?.toFixed(2)} cap, worst ${slack.at(-1)?.toFixed(2)} cap of air on its widest side`);
    ok(oldMiss >= cases * 0.8, `E1 the bare hold box (m.box) does not hold the standing ink for ${oldMiss} of ${cases} words: callers needed this`);
    ok(lives > 10 && rims > 10, `E1 measured words carry a life (${lives}) and a rim (${rims}) where the engine draws them`);
    /* the numbers callers mirrored, read from the measure */
    const { E, L } = await seat({});
    const MO = await import(U("motion.mjs")), PA = await import(U("paint.mjs"));
    const m = L.measure("THWAK!", { kind: "punch", space: "world", at: W0, seed: "mir", reduced: false, hold: 1500 });
    const S = m.unit * 1 * 1;
    ok(m.life && m.life.xy === MO.LIFE_REACH.xy && m.life.s === MO.LIFE_REACH.s, `E1 m.life is the engine's own life reach (${JSON.stringify(m.life)})`);
    ok(near(m.rim, PA.rimPx(m.plan.hand, S).outer / S) && m.rim > 0.07, `E1 m.rim is the engine's rim at the drawn size (${m.rim.toFixed(4)} cap: keyline + band)`);
    const ms = L.measure("THWAK!", { kind: "punch", space: "screen", at: { x: 800, y: 450 }, seed: "mir", reduced: false });
    ok(ms.rim === 0 && ms.ink.l < m.ink.l, `E1 a screen word has no rim (m.rim 0; ink ${ms.ink.l.toFixed(3)} < world ${m.ink.l.toFixed(3)} cap)`);
    const mr = L.measure("THWAK!", { kind: "punch", space: "world", at: W0, seed: "mir", reduced: true });
    ok(mr.life === null, "E1 reduced motion: no life (m.life null)");
    E.restoreWarn?.();
  });

  /* ---------- E5: the impact's ladders ---------- */
  await section("impact", async () => {
    const { E, L } = await seat({});
    const PL = await import(U("impact/plan.mjs")), IX = await import(U("impact/index.mjs"));
    const I = IX.attachImpact(L, null);
    ok(typeof I?.tierOf === "function" && typeof I?.stepOf === "function" && Array.isArray(I?.tiers), "E5 L.impact offers tierOf / stepOf / tiers / seriesBoost");
    let bad = 0;
    for ( let m = 0; m <= 2.0001; m += 0.01 ) for ( const series of [0, 1, 3] ) {
      const p = PL.planImpact({ kind: "hit", magnitude: m, series });
      const eff = Math.min(2, m + I.seriesBoost(series));
      if ( p.tier !== I.tierOf(eff) || p.step !== I.stepOf(eff) ) bad++;
    }
    ok(bad === 0, `E5 every plan's tier and step equal L.impact.tierOf / stepOf of its strength (series included): ${bad} differ`);
    ok(I.tiers.every((b, i) => I.tierOf(b - 1e-9) === i && I.tierOf(b) === i + 1) && I.steps.every((b, i) => I.stepOf(b - 1e-9) === i && I.stepOf(b) === i + 1), `E5 the bounds tables are the functions' bounds (tiers ${I.tiers.join(" / ")})`);
    E.restoreWarn?.();
  });

  /* ---------- E6: ceilK ---------- */
  await section("ceilK", async () => {
    const { E, L } = await seat({});
    const wv = warns();
    const a = L.sizeOf("KA-BOOM!", { space: "world", magnitude: 1.4, seed: "ck", ceilK: 0.4 }), b = L.sizeOf("KA-BOOM!", { space: "world", magnitude: 1.4, seed: "ck" });
    const m = L.measure("KA-BOOM!", { space: "world", magnitude: 1.4, seed: "ck", ceilK: 0.4 });
    L.sizeOf("KA-BOOM!", { space: "world", seed: "ck", ceilK: 0.9 });
    const c = L.sizeOf("KA-BOOM!", { space: "world", magnitude: 1.4, seed: "ck", ceil: 0.4 });
    wv.done();
    ok(near(a.size, b.size) && c.size < b.size, `E6 ceilK changes no size (${a.size.toFixed(1)} = ${b.size.toFixed(1)}); ceil does (${c.size.toFixed(1)})`);
    ok(wv.got.filter((x) => /ceilK is NOT read/.test(x)).length === 1, `E6 a caller passing ceilK is told once on this page (${wv.got.filter((x) => /ceilK/.test(x)).length} warnings)`);
    ok(JSON.stringify(m.unread) === '["ceilK"]', `E6 L.measure lists ceilK as unread (${JSON.stringify(m.unread)})`);
    E.restoreWarn?.();
    const s2 = await seat({}); const w2 = warns();
    const st = s2.L.stream({ kind: "gunfire", lang: "en", space: "world", at: W0, beats: [0, 90], seed: "ckst" });
    await s2.E.tick(300, 33); st.stop({ quick: true }); w2.done();
    ok(!w2.got.some((x) => /ceilK/.test(x)), "E6 a stream without ceilK says nothing (the engine no longer passes it to its syllables)");
    s2.E.restoreWarn?.();
  });

  console.log(`engview-engine: ${n} checks, ${failed} failed`);
  return failed;
}
if ( process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--engine") ) {
  const other = process.argv.slice(2).find((a) => !a.startsWith("--"));
  process.exit((await engineChecks(other ? path.resolve(other) : path.dirname(fileURLToPath(import.meta.url)))) ? 1 : 0);
}
