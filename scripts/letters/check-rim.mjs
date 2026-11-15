// RIMUNDER: node checks for the invincible word's rim UNDER the lettering (`look.rim`, design.mjs INV_RIM / invRim, paint.mjs paintRim).
// ADVX 18: a word lettered on the map got lost among the map's own drawings; the old opt-in light outline (`look.outline: "sticker"`)
// was stroked OVER the duplicate block, which vanished. The rim is the letterer's holding line round the WHOLE lettering, painted under
// it. Measured here on a recording 2D context (its own path bookkeeping, not paint.mjs's): defaults per space, the paint order (every
// rim stroke before the block's first fill, the keyline and the letters), the rim reaching round letters AND block, counters left open,
// pixel floors and caps, picture extents, every picture of the timeline (both faces, both motion types, reduced), the MOVE echo, and
// that a call without the rim (screen space, `rim: "none"`, legacy styles) draws exactly what it drew before (same plan, same draw log).
// Called from check.mjs; standalone: node check-rim.mjs [<letters folder of another engine>] (an engine without the rim fails).
import { pathToFileURL } from "node:url";

export async function run(ok, { bank, fontsApi, dir = null, verbose = !!process.env.LETR_VERBOSE }) {
  const at = (f) => (dir ? new URL(f, dir).href : new URL(`./${f}`, import.meta.url).href);
  const D = await import(at("design.mjs")), P = await import(at("paint.mjs")), S = await import(at("shape.mjs"));
  const { makePlan, INV_FACES = ["anton"], INV_RIM = null } = D, { paintPicture } = P, { settleCenter } = S;
  const say = (...a) => { if ( verbose ) console.log("  rim:", ...a); };
  const plan = (t, o = {}) => { const p = makePlan(t, o, fontsApi, []); settleCenter(p, bank); return p; };
  const inv = (face, extra = {}) => ({ style: "invincible", face, motion: "smooth", ...extra });

  /* a recording context: every fill / stroke with its colour, width, transformed path (subpaths, bbox) */
  function recorder() {
    const ops = [];
    let tf = [1, 0, 0, 1, 0, 0], sub = [], cur = null, st = { fs: "#000", ss: "#000", lw: 1, ga: 1, gco: "source-over" };
    const stack = [];
    const T = (x, y) => [tf[0] * x + tf[2] * y + tf[4], tf[1] * x + tf[3] * y + tf[5]];
    const mul = (m) => { const [a, b, c, d, e, f] = tf, [A, B, C, D2, E, F] = m; tf = [a * A + c * B, b * A + d * B, a * C + c * D2, b * C + d * D2, a * E + c * F + e, b * E + d * F + f]; };
    const box = () => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for ( const s of sub ) for ( const [x, y] of s ) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { x0, y0, x1, y1 }; };
    const rec = (k) => ops.push({ k, fs: st.fs, ss: st.ss, lw: st.lw, ga: st.ga, gco: st.gco, n: sub.length, box: box(), sig: JSON.stringify(sub.map((s) => s.map(([x, y]) => [Math.round(x * 100), Math.round(y * 100)]))) });
    const ctx = {
      get fillStyle() { return st.fs; }, set fillStyle(v) { st.fs = typeof v === "string" ? v : "grad"; },
      get strokeStyle() { return st.ss; }, set strokeStyle(v) { st.ss = typeof v === "string" ? v : "grad"; },
      get lineWidth() { return st.lw; }, set lineWidth(v) { st.lw = v; },
      get globalAlpha() { return st.ga; }, set globalAlpha(v) { st.ga = v; },
      get globalCompositeOperation() { return st.gco; }, set globalCompositeOperation(v) { st.gco = v; },
      lineJoin: "miter", lineCap: "butt", miterLimit: 10, filter: "none",
      save() { stack.push({ tf: tf.slice(), st: { ...st } }); }, restore() { const v = stack.pop(); if ( v ) { tf = v.tf; st = v.st; } },
      beginPath() { sub = []; cur = null; }, moveTo(x, y) { cur = [T(x, y)]; sub.push(cur); }, lineTo(x, y) { if ( !cur ) { cur = []; sub.push(cur); } cur.push(T(x, y)); },
      closePath() {}, rect(x, y, w, h) { sub.push([T(x, y), T(x + w, y), T(x + w, y + h), T(x, y + h)]); cur = null; },
      arc(x, y, r) { sub.push([T(x - r, y - r), T(x + r, y + r)]); cur = null; }, ellipse(x, y, rx, ry) { sub.push([T(x - rx, y - ry), T(x + rx, y + ry)]); cur = null; },
      quadraticCurveTo(a, b, x, y) { ctx.lineTo(x, y); }, bezierCurveTo(a, b, c, d, x, y) { ctx.lineTo(x, y); },
      clip() { rec("clip"); }, fill() { rec("fill"); }, stroke() { rec("stroke"); },
      translate(x, y) { mul([1, 0, 0, 1, x, y]); }, scale(x, y) { mul([x, 0, 0, y, 0, 0]); }, rotate(r) { const c = Math.cos(r), s = Math.sin(r); mul([c, s, -s, c, 0, 0]); },
      setTransform() { tf = [1, 0, 0, 1, 0, 0]; }, resetTransform() { tf = [1, 0, 0, 1, 0, 0]; }, setLineDash() {},
      createLinearGradient() { return { addColorStop() {} }; }, createRadialGradient() { return { addColorStop() {} }; }, createPattern() { return "pat"; },
      drawImage() { ops.push({ k: "img" }); }, fillRect() { ops.push({ k: "fr" }); }, strokeRect() {}, clearRect() {},
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }), putImageData() {}, measureText: () => ({ width: 1 }), fillText() {}, strokeText() {}
    };
    const canvases = [];
    return { ops, canvases, make: (w, h) => { const c = { width: w, height: h, getContext: () => ctx }; canvases.push(c); return c; } };
  }
  const draw = (p, pic, S) => { const r = recorder(); const out = paintPicture(p, bank, pic, S, r.make); return { ...r, out }; };
  const sig = (r) => r.ops.map((o) => `${o.k}|${o.fs}|${o.ss}|${o.lw}|${o.ga}|${o.gco}|${o.sig ?? ""}`).join("\n");

  ok(!!INV_RIM && typeof D.invRim === "function" && typeof P.rimPx === "function", "rim: the engine has look.rim (INV_RIM, invRim, rimPx)");
  if ( !INV_RIM ) return;
  const { rimPx } = P;

  /* 1. defaults and choices */
  {
    const bad = [];
    const H = (o) => plan("KA-WRAAMM!", { mood: "impact", seed: "rim-d", ...o }).hand.halo ?? "none";
    for ( const face of INV_FACES ) {
      const L = inv(face);
      const want = [
        [{ space: "world", look: L }, "ink"], [{ space: "screen", look: L }, "none"], [{ look: L }, "none"],
        [{ space: "world", look: { ...L, rim: "none" } }, "none"], [{ space: "world", look: { ...L, rim: false } }, "none"],
        [{ space: "world", look: { ...L, rim: "paper" } }, "paper"], [{ space: "screen", look: { ...L, rim: "ink" } }, "ink"],
        [{ space: "screen", look: { ...L, rim: true } }, "ink"], [{ space: "world", look: { ...L, rim: "auto" } }, "ink"],
        [{ space: "screen", look: { ...L, rim: "auto" } }, "none"], [{ space: "world", look: { ...L, rim: "bogus" } }, "ink"],
        [{ space: "world", look: { ...L, backdrop: "star" } }, "none"], [{ space: "world", look: { ...L, backdrop: "star", rim: "ink" } }, "ink"],
        [{ space: "world", look: { ...L, motion: "stepped" } }, "ink"], [{ space: "world", reduced: true, look: L }, "ink"]
      ];
      for ( const [o, w] of want ) { const g = H(o); if ( g !== w ) bad.push(`${face} ${JSON.stringify(o)} -> ${g} (want ${w})`); }
    }
    for ( const style of ["comic", "expressive"] ) for ( const rim of [undefined, "ink", "paper"] ) {
      const g = H({ space: "world", look: { style, rim } });
      if ( g !== "none" ) bad.push(`${style} rim ${rim} -> ${g}`);
    }
    ok(!bad.length, `rim defaults: world ink, screen none, explicit choices win, a backdrop turns the default off, legacy styles never${bad.length ? ": " + bad.slice(0, 5).join("; ") : ""}`);
  }

  /* 2.-6. paint order, reach, counters, floors, extents: a sweep of words x faces x sizes */
  const words = [["KA-WRAAMM!", "impact"], ["BOOM!", "boom"], ["FWOOSH", "whoosh"], ["SKRAKK!", "crack"], ["KRA-THOOOM!!", "boom"], ["-7", "impact"], ["ZBURZENIE!", "crack"], ["THWAP", "impact"]];
  const sizes = [12, 18, 28, 48, 96, 220];
  const order = [], reach = [], holes = [], floors = [], fit = [], paperBad = [], keepBad = [];
  let n = 0;
  for ( const face of INV_FACES ) for ( const [t, mood] of words ) for ( const rim of ["ink", "paper"] ) {
    const p = plan(t, { mood, seed: `rim-${t}`, space: "world", look: inv(face, { rim }) });
    /* a shattering word's hold may be a shard picture (painted from its rest picture at another scale): judge the rest picture */
    const H = p.hand, pic = p.timeline.hold.find((q) => !q.shards) ?? { ...p.timeline.hold[0], shards: null };
    for ( const S of sizes ) {
      n++;
      const r = draw(p, pic, S), ops = r.ops.filter((o) => o.k === "fill" || o.k === "stroke");
      const s0 = r.out.S;   // the painted scale (MAX_SIDE may lower it)
      const R = rimPx(S < 80 ? { ...H, inkW: Math.max(H.inkW * Math.max(0.38, S / 80), Math.min(H.inkW, 1.6 / Math.max(1, S))) } : H, s0);
      /* the rim strokes: ink (and paper) strokes wider than any keyline, before anything else of the word */
      const isRim = (o) => o.k === "stroke" && ((o.ss === H.ink && Math.abs(o.lw / 2 - R.outer) < 0.01) || (o.ss === INV_RIM.paperColor && Math.abs(o.lw / 2 - R.key - R.paper) < 0.01));
      const rims = ops.filter(isRim);
      const firstBlock = rims.length ? ops.findIndex((o, i) => i > ops.indexOf(rims[0]) && o.k === "fill" && o.fs === H.pal.ext) : -1;
      const lastRim = Math.max(...rims.map((o) => ops.indexOf(o)));
      if ( !rims.length || firstBlock < 0 || lastRim > firstBlock || ops.slice(0, ops.indexOf(rims[0])).some((o) => o.k === "fill") )
        order.push(`${face} ${t} ${rim} S${S}: rim ops ${rims.length}, last rim op ${lastRim}, first block fill ${firstBlock}`);
      /* widths: ink band = whole reach; paper band inside it */
      const inkS = rims.find((o) => o.ss === H.ink), papS = rims.find((o) => o.ss === INV_RIM.paperColor);
      if ( !inkS ) { floors.push(`${face} ${t} ${rim} S${S}: no ink rim of reach ${R.outer.toFixed(2)} px (S ${s0}; ink strokes ${ops.filter((o) => o.k === "stroke" && o.ss === H.ink).slice(0, 3).map((o) => (o.lw / 2).toFixed(2)).join(" ")})`); continue; }
      const band = rim === "ink" ? R.ink : R.paper;
      const spec = rim === "ink" ? INV_RIM.ink : INV_RIM.paper;
      if ( band < spec.min - 1e-9 || band > spec.max + 1e-9 ) floors.push(`${face} ${t} ${rim} S${S}: band ${band.toFixed(2)} outside [${spec.min}, ${spec.max}]`);
      if ( rim === "paper" && (!papS || papS.lw >= inkS.lw || ops.indexOf(papS) < ops.indexOf(inkS)) ) paperBad.push(`${face} ${t} S${S}`);
      if ( rim === "ink" && papS ) paperBad.push(`${face} ${t} ink rim has paper S${S}`);
      /* reach: the rim's path covers the letters AND the block (the duplicate's offset), and nothing farther */
      const keyline = ops.find((o) => o.k === "stroke" && o.ss === H.ink && Math.abs(o.lw - 2 * R.key) < 0.01 && ops.indexOf(o) > firstBlock);
      if ( keyline ) {
        const kb = keyline.box, rb = inkS.box, dx = Math.cos(H.depthAng) * H.depth * s0, dy = Math.sin(H.depthAng) * H.depth * s0;
        const e = 0.6;
        const want = { x0: kb.x0 + Math.min(0, dx), y0: kb.y0 + Math.min(0, dy), x1: kb.x1 + Math.max(0, dx), y1: kb.y1 + Math.max(0, dy) };
        if ( Math.abs(rb.x0 - want.x0) > e || Math.abs(rb.y0 - want.y0) > e || Math.abs(rb.x1 - want.x1) > e || Math.abs(rb.y1 - want.y1) > e )
          reach.push(`${face} ${t} S${S}: rim path ${JSON.stringify(rb)} vs letters+block ${JSON.stringify(want)}`);
        /* inside the picture: the rim's stroke (path box + half width) never leaves the canvas */
        const cv = r.out.canvas;
        if ( rb.x0 - inkS.lw / 2 < -0.5 || rb.y0 - inkS.lw / 2 < -0.5 || rb.x1 + inkS.lw / 2 > cv.width + 0.5 || rb.y1 + inkS.lw / 2 > cv.height + 0.5 )
          fit.push(`${face} ${t} ${rim} S${S}: rim ${JSON.stringify(rb)} +${(inkS.lw / 2).toFixed(1)} outside ${cv.width}x${cv.height}`);
        /* counters open: the rim's path holds only outer outlines (as many subpaths per offset as the keyline has outer ones) */
        const kSub = JSON.parse(keyline.sig), area = (s) => { let a = 0; for ( let i = 0; i < s.length; i++ ) { const [x1, y1] = s[i], [x2, y2] = s[(i + 1) % s.length]; a += x1 * y2 - x2 * y1; } return a / 2; };
        const rSub = JSON.parse(inkS.sig);
        const sign = Math.sign(area(kSub.reduce((m, s) => (Math.abs(area(s)) > Math.abs(area(m)) ? s : m), kSub[0])));
        const neg = rSub.filter((s) => Math.abs(area(s)) > 4e4 && Math.sign(area(s)) !== sign).length;
        if ( neg ) holes.push(`${face} ${t} S${S}: ${neg} counter outlines in the rim's path`);
      } else reach.push(`${face} ${t} S${S}: no keyline found`);
    }
  }
  ok(!order.length, `rim under: every rim stroke comes before the duplicate block's first fill (the block and the letters are never covered), ${n} pictures${order.length ? ": " + order.slice(0, 4).join("; ") : ""}`);
  ok(!reach.length, `rim reach: the rim's outline spans the letters AND their block, no farther${reach.length ? ": " + reach.slice(0, 3).join("; ") : ""}`);
  ok(!holes.length, `rim counters: the rim follows only outer outlines (an O's hole, an A's eye show the ground)${holes.length ? ": " + holes.slice(0, 3).join("; ") : ""}`);
  ok(!floors.length, `rim widths: pixel floors and caps hold at ${sizes.join("/")} px${floors.length ? ": " + floors.slice(0, 4).join("; ") : ""}`);
  ok(!fit.length, `rim extents: the picture grows by the rim, nothing is cut at its edge${fit.length ? ": " + fit.slice(0, 3).join("; ") : ""}`);
  ok(!paperBad.length, `rim paper: an ink line round a paper band, ink painted first; the ink rim has no paper${paperBad.length ? ": " + paperBad.slice(0, 3).join("; ") : ""}`);
  say(`swept ${n} pictures`);

  /* 7. every picture of the timeline, both faces x both motion types x reduced; the MOVE echo gets none */
  {
    const bad = [];
    for ( const face of INV_FACES ) for ( const motion of ["smooth", "stepped"] ) for ( const reduced of [false, true] ) {
      const p = plan("KRA-KA-THOOM!", { mood: "boom", seed: "rim-tl", space: "world", reduced, look: inv(face, { motion }) });
      const pics = [...p.timeline.ent, ...p.timeline.hold, ...p.timeline.exit].filter((q) => !q.shards && !q.impact);
      for ( const q of pics ) {
        const r = draw(p, q, 40), H = p.hand, R = rimPx(H, r.out.S);
        if ( !r.ops.some((o) => o.k === "stroke" && o.ss === H.ink && Math.abs(o.lw / 2 - R.outer) < 0.01) ) { bad.push(`${face} ${motion} reduced=${reduced} picture ${pics.indexOf(q)}`); break; }
      }
      const echo = Object.create(p, { hollow: { value: true } });
      const r = draw(echo, p.timeline.hold[0], 40), R = rimPx(p.hand, r.out.S);
      if ( r.ops.some((o) => o.k === "stroke" && Math.abs(o.lw / 2 - R.outer) < 0.01) ) bad.push(`${face} ${motion}: the MOVE echo got a rim`);
    }
    ok(!bad.length, `rim timeline: every entrance, hold and exit picture carries it, smooth and stepped, reduced too; never on an echo${bad.length ? ": " + bad.join("; ") : ""}`);
  }

  /* 8. calls without the rim draw what they drew: a world word with rim "none" = the same word on the screen (plan and draw log),
        and the legacy styles' world words are untouched by the rim option */
  {
    const bad = [];
    let m = 0;
    for ( const face of INV_FACES ) for ( const [t, mood] of words ) for ( const motion of ["smooth", "stepped"] ) {
      const a = plan(t, { mood, seed: `rim-n-${t}`, space: "world", look: inv(face, { motion, rim: "none" }) });
      const b = plan(t, { mood, seed: `rim-n-${t}`, space: "screen", look: inv(face, { motion }) });
      if ( JSON.stringify(a) !== JSON.stringify(b) ) bad.push(`${face} ${t} ${motion}: plan differs`);
      for ( const S of [20, 64] ) for ( const q of [a.timeline.ent[0], a.timeline.hold[0], a.timeline.exit.at(-1)].filter(Boolean) ) {
        m++;
        const i = a.timeline.ent.includes(q) ? ["ent", a.timeline.ent.indexOf(q)] : a.timeline.hold.includes(q) ? ["hold", 0] : ["exit", a.timeline.exit.length - 1];
        if ( sig(draw(a, q, S)) !== sig(draw(b, b.timeline[i[0]][i[1]], S)) ) bad.push(`${face} ${t} ${motion} S${S} ${i[0]}: draw log differs`);
      }
    }
    for ( const style of ["comic", "expressive"] ) for ( const [t, mood] of words.slice(0, 4) ) {
      const a = plan(t, { mood, seed: `rim-l-${t}`, space: "world", look: { style } }), b = plan(t, { mood, seed: `rim-l-${t}`, space: "world", look: { style, rim: "paper" } });
      if ( JSON.stringify(a) !== JSON.stringify(b) || sig(draw(a, a.timeline.hold[0], 48)) !== sig(draw(b, b.timeline.hold[0], 48)) ) bad.push(`${style} ${t}: rim option changed a legacy word`);
    }
    ok(!bad.length, `rim off: a world word with rim "none" draws exactly the screen word (${m} pictures), legacy styles ignore the option${bad.length ? ": " + bad.slice(0, 4).join("; ") : ""}`);
  }

  /* 9. the cost of the rim stays one path: one ink stroke (plus one paper stroke), whatever the block's depth or the picture's size */
  {
    const bad = [];
    for ( const face of INV_FACES ) for ( const S of [24, 96, 300] ) for ( const rim of ["ink", "paper"] ) {
      const p = plan("KRA-THOOOM!!", { mood: "boom", seed: "rim-cost", magnitude: 1.6, space: "world", look: inv(face, { rim }) });
      const r = draw(p, p.timeline.hold[0], S), R = rimPx(p.hand, r.out.S);
      const k = r.ops.filter((o) => o.k === "stroke" && ((o.ss === p.hand.ink && Math.abs(o.lw / 2 - R.outer) < 0.01) || (o.ss === INV_RIM.paperColor && Math.abs(o.lw / 2 - R.key - R.paper) < 0.01))).length;
      if ( k !== (rim === "ink" ? 1 : 2) ) bad.push(`${face} S${S} ${rim}: ${k} rim strokes`);
    }
    ok(!bad.length, `rim cost: one stroke per band (no per-step or per-letter painting)${bad.length ? ": " + bad.join("; ") : ""}`);
  }
}

if ( import.meta.url === pathToFileURL(process.argv[1]).href ) {
  const fs = await import("node:fs"), path = await import("node:path");
  const dir = process.argv[2] ? pathToFileURL(path.resolve(process.argv[2]) + "/").href : new URL("./", import.meta.url).href;
  const { FontBank } = await import(new URL("fontbank.mjs", dir).href), { FONTS } = await import(new URL("design.mjs", dir).href);
  const bank = new FontBank();
  for ( const [id, f] of Object.entries(FONTS) ) { const b = fs.readFileSync(new URL(f.file, dir)); bank.add(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); }
  const fontsApi = { adv: (f, c) => bank.adv(f, c) };
  let pass = 0, fail = 0;
  const ok = (c, m) => { if ( c ) pass++; else { fail++; console.log("FAIL", m); } if ( process.env.LETR_VERBOSE && c ) console.log("ok  ", m); };
  await run(ok, { bank, fontsApi, dir });
  console.log(`check-rim: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
