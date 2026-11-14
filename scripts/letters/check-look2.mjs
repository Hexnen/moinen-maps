// LOOK2: node checks of the Invincible hand after SPEC-LOOK P1-P18 (the face, one keyline round the word, the duplicate, flat faces,
// prefix, sizes and baseline, the vertical column, interlocked rings, colours, optical spacing) and of the frozen legacy look
// "expressive". Called from check.mjs with its counter and the loaded font bank.
import { makePlan, STYLES, NUMBER_RE, TUCK, invPrefix, INV_FLOOR, monotoneSizes, DEFAULT_FACE } from "./design.mjs";
import { createVocab, KIND_IDS, KINDS } from "./words.mjs";
import { paintPicture } from "./paint.mjs";
import { settleCenter, occlusionReport, baseGeometry, pictureGeometry, placedShape, pairGaps, ovalRing, KERN } from "./shape.mjs";
import { bbox } from "./geom.mjs";

/* a recording 2D context: the current path (as a key), the clip stack, and every fill / stroke with its style */
function recorder() {
  const ops = [];
  const st = { path: [], clips: [], stack: [], alpha: 1, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, gco: "source-over", tf: [1, 0, 0, 1, 0, 0] };
  const key = () => st.path.join(";");
  const T = (x, y) => { const [a, b, c, d, e, f] = st.tf; return [Math.round((a * x + c * y + e) * 100) / 100, Math.round((b * x + d * y + f) * 100) / 100]; };
  const mul = (m) => { const [a, b, c, d, e, f] = st.tf, [A, B, C, D, E, F] = m; st.tf = [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f]; };
  const ctx = {
    get fillStyle() { return st.fillStyle; }, set fillStyle(v) { st.fillStyle = v; },
    get strokeStyle() { return st.strokeStyle; }, set strokeStyle(v) { st.strokeStyle = v; },
    get globalAlpha() { return st.alpha; }, set globalAlpha(v) { st.alpha = v; },
    get lineWidth() { return st.lineWidth; }, set lineWidth(v) { st.lineWidth = v; },
    get globalCompositeOperation() { return st.gco; }, set globalCompositeOperation(v) { st.gco = v; },
    lineJoin: "miter", lineCap: "butt", miterLimit: 10, filter: "none",
    save() { st.stack.push({ clips: st.clips.slice(), alpha: st.alpha, fillStyle: st.fillStyle, strokeStyle: st.strokeStyle, lineWidth: st.lineWidth, gco: st.gco, tf: st.tf.slice() }); },
    restore() { const v = st.stack.pop(); if ( v ) Object.assign(st, v); },
    beginPath() { st.path = []; }, moveTo(x, y) { st.path.push("M" + T(x, y)); }, lineTo(x, y) { st.path.push("L" + T(x, y)); }, closePath() { st.path.push("Z"); },
    rect(x, y, w, h) { st.path.push(`R${T(x, y)},${w},${h}`); }, arc() { st.path.push("A"); }, quadraticCurveTo() { st.path.push("Q"); }, bezierCurveTo() { st.path.push("B"); },
    clip() { st.clips.push(key()); }, fill() { ops.push({ op: "fill", path: key(), style: st.fillStyle, a: st.alpha, clips: st.clips.slice(), gco: st.gco }); },
    stroke() { ops.push({ op: "stroke", path: key(), style: st.strokeStyle, a: st.alpha, w: st.lineWidth, clips: st.clips.slice(), gco: st.gco, join: ctx.lineJoin }); },
    translate(x, y) { mul([1, 0, 0, 1, x, y]); }, scale(x, y) { mul([x, 0, 0, y, 0, 0]); }, rotate(r) { const c = Math.cos(r), s = Math.sin(r); mul([c, s, -s, c, 0, 0]); },
    setTransform() { st.tf = [1, 0, 0, 1, 0, 0]; }, resetTransform() { st.tf = [1, 0, 0, 1, 0, 0]; },
    createLinearGradient() { ops.push({ op: "gradient" }); return { addColorStop() {} }; }, createRadialGradient() { ops.push({ op: "gradient" }); return { addColorStop() {} }; },
    drawImage() { ops.push({ op: "image" }); }, fillRect() { ops.push({ op: "fillRect", a: st.alpha }); }, clearRect() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {}, measureText: () => ({ width: 1 })
  };
  return { ops, ctx, make: (w, h) => ({ width: w, height: h, getContext: () => ctx }) };
}

/* FONTSEL: run once per invincible face (check.mjs loops INV_FACES); the face-free parts (the expressive freeze) only on `first` */
export function checkLook2(ok0, bank, face = DEFAULT_FACE, first = true) {
  const ok = (c, m) => ok0(c, `[${face}] ${m}`);
  const fontsApi = { adv: (f, c) => bank.adv(f, c) };
  const plan = (t, o = {}) => makePlan(t, o, fontsApi, []);
  const inv = (t, o = {}) => plan(t, { ...o, look: { style: "invincible", face, ...(o.look ?? {}) } });
  const V = createVocab();
  const vocab = [];
  for ( const id of KIND_IDS ) for ( const loud of [0.35, 0.7, 0.95] ) for ( const lang of ["en", "pl"] ) {
    const w = V.word(id, { lang, loud, seed: `lk2${id}${loud}` });
    if ( !NUMBER_RE.test(w.text) ) vocab.push({ id, w, p: () => inv(w.text, { ...w.play, seed: `lk2${id}${loud}${lang}` }),
      /* MOTION2: smear echoes are drawings of the stepped mode only (the smooth mode moves one picture) */
      ps: () => inv(w.text, { ...w.play, seed: `lk2${id}${loud}${lang}`, look: { motion: "stepped" } }) });
  }
  const ink = (c) => /[\p{L}\p{N}]/u.test(c);

  /* P17: "expressive" is a style and draws exactly what "comic" draws (the legacy look, frozen) */
  if ( first ) {
    ok(STYLES.includes("expressive"), "expressive: a named style");
    let same = 0, all = 0;
    for ( const t of ["KA-BOOM!", "KRAK!", "WHOOOOM", "BZZZT"] ) for ( const m of ["boom", "crack", "whoosh", "zap", "splash"] ) {
      all++;
      const a = plan(t, { mood: m, seed: `ex${t}${m}`, look: { style: "comic" } }), b = plan(t, { mood: m, seed: `ex${t}${m}`, look: { style: "expressive" } });
      settleCenter(a, bank); settleCenter(b, bank);
      const ra = recorder(), rb = recorder();
      for ( const q of [...a.timeline.ent, ...a.timeline.hold] ) paintPicture(a, bank, q, 64, ra.make);
      for ( const q of [...b.timeline.ent, ...b.timeline.hold] ) paintPicture(b, bank, q, 64, rb.make);
      if ( JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(ra.ops) === JSON.stringify(rb.ops) ) same++;
    }
    ok(same === all, `expressive: ${same}/${all} plans and drawings identical to comic`);
    ok(!plan("KRAK!", { mood: "crack", seed: 3, look: { style: "expressive" } }).hand.keyline, "expressive: keeps the per-letter outline (no union keyline)");
  }

  /* P1, P14: one tall narrow face; no Michroma / Squada unless look.font asks; letters about half a cap wide */
  {
    const fonts = new Set(), widths = [];
    for ( const v of vocab ) { const p = v.p(); fonts.add(p.hand.font); p.layout.letters.forEach((l, i) => { if ( ink(p.chars[i]) && !l.ring && !/[MW]/.test(p.chars[i]) ) widths.push(l.w / l.s); }); }
    ok(fonts.size === 1 && fonts.has(face), `face: the Invincible hand letters in one face (${[...fonts]})`);
    const mean = widths.reduce((a, b) => a + b, 0) / widths.length;
    ok(mean >= 0.45 && mean <= 0.6, `face: mean letter advance ${mean.toFixed(3)} cap (0.45-0.6)`);
    ok(inv("KRAK", { mood: "crack", seed: 1, look: { font: "michroma" } }).hand.font === "michroma", "face: look.font still wins");
    let bad = 0, n = 0; const ex = [];
    for ( const v of vocab.filter((x, k) => k % 2 === 0) ) { const p = v.p(); settleCenter(p, bank); for ( const r of occlusionReport(p, bank) ) { n++; if ( !r.ok ) { bad++; if ( ex.length < 4 ) ex.push(`${p.word}:${r.ch}`); } } }
    ok(bad <= n * 0.01, `face: ${bad} of ${n} letters of vocabulary words unreadable in their word (${ex.join(" ")})`);
  }

  /* P2, P3: one keyline round the word; every line drawn inside a letter is clipped to that letter (never on a neighbour's face);
     no boil; thin line; round joins */
  {
    let viol = 0, pics = 0, rimFirst = 0, thick = 0, words = 0; const ex = [];
    for ( const [t, m, o] of [["KRAK!!", "impact", {}], ["SKREE-", "crack", {}], ["KA-THOOM!", "boom", {}], ["WHOOOOM", "whoosh", {}], ["CRUNCH!", "crash", {}], ["KA-BLAM!", "boom", { sound: { loud: 0.95 } }], ["CHOOM!", "boom", { arrange: "vertical" }]] ) {
      const p = inv(t, { mood: m, seed: `kl${t}`, ...o }); settleCenter(p, bank); words++;
      ok(p.hand.keyline === "union" && p.hand.inkW >= 0.012 && p.hand.inkW <= 0.018, `keyline: ${t} union, inkW ${p.hand.inkW}`);
      for ( const q of [...p.timeline.ent, ...p.timeline.hold] ) {
        if ( q.impact || q.shards ) continue;
        const r = recorder(); paintPicture(p, bank, q, 150, r.make); pics++;
        const firstFace = r.ops.findIndex((x) => x.op === "fill" && x.clips.length && x.gco === "source-over");
        const inked = r.ops.filter((x) => x.op === "stroke" && x.style === p.hand.ink);
        /* an ink line drawn while no clip is active is an outline of the whole word (or of its duplicate): before any face */
        for ( const [k, x] of r.ops.entries() ) {
          if ( x.op !== "stroke" || x.style !== p.hand.ink || /[AQB]/.test(x.path) ) continue;   // (effects: dust puffs, sparks are not letters)
          if ( !x.clips.length ) { if ( firstFace >= 0 && k > firstFace ) { viol++; if ( ex.length < 3 ) ex.push(`${t}: ink outline after the faces`); } continue; }
          if ( !x.clips.includes(x.path) ) { viol++; if ( ex.length < 3 ) ex.push(`${t}: ink line outside its letter's clip`); }
          if ( x.join !== "round" ) thick++;
        }
        if ( inked.length && !inked[0].clips.length ) rimFirst++;
      }
    }
    ok(viol === 0, `keyline: ${viol} ink lines could land on another letter (${ex.join("; ")})`);
    ok(rimFirst === pics, `keyline: the word's keyline comes first in ${rimFirst}/${pics} pictures`);
    ok(thick === 0, `keyline: ${thick} letter lines with mitred (spiky) joins`);
    /* no boil: two hold drawings in the same pose have the same outline */
    /* MOTION2: the smooth mode has one hold picture; stepped mode redraws the hold (letters that move): compare two of its drawings at rest */
    const p = inv("KRAK!", { mood: "crack", seed: 5, holdKind: "shake", look: { motion: "stepped" } }); settleCenter(p, bank);
    const a = pictureGeometry(p, bank, { ...p.timeline.hold[0], g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 }, letters: p.timeline.hold[0].letters.map((l) => ({ ...l, x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 })) });
    const b = pictureGeometry(p, bank, { ...p.timeline.hold[1], g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 }, letters: p.timeline.hold[1].letters.map((l) => ({ ...l, x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 })) });
    ok(JSON.stringify(a) === JSON.stringify(b), "keyline: no line boil in the Invincible hand (the stems stay straight)");
    void words;
  }

  /* P4, P5, P15: one flat duplicate (or a flat heavy block), no soft shadow, flat faces, no gradients, no plates off register, smear =
     outline-only echoes */
  {
    let grad = 0, soft = 0, misreg = 0, multiExt = 0, smearFills = 0, smears = 0, n = 0;
    for ( const v of vocab.filter((x, k) => k % 3 === 0) ) {
      const p = v.p(), H = p.hand; n++;
      if ( H.shadow ) soft++;
      if ( new Set(H.pal.fill).size !== 1 ) grad++;
      for ( const q of [...p.timeline.ent, ...p.timeline.hold, ...p.timeline.exit] ) if ( q.misreg ) misreg++;
      const pst = v.ps(), sm = pst.timeline.ent.find((q) => q.smear);
      if ( sm && smears < 12 ) {
        smears++; settleCenter(pst, bank);
        const r = recorder(); paintPicture(pst, bank, sm, 80, r.make);
        const r0 = recorder(); paintPicture(pst, bank, { ...sm, smear: null }, 80, r0.make);
        smearFills += r.ops.filter((x) => x.op === "fill").length - r0.ops.filter((x) => x.op === "fill").length;
        if ( r.ops.some((x) => x.op === "gradient") ) grad++;
      }
      if ( n < 40 ) {
        settleCenter(p, bank); const r = recorder(); paintPicture(p, bank, p.timeline.hold[0], 80, r.make);
        if ( r.ops.some((x) => x.op === "gradient") ) grad++;
        if ( r.ops.some((x) => x.op === "fill" && x.a < 1 && (x.style === H.pal.ext || /^rgba\(14,8,26/.test(String(x.style)))) ) soft++;
        const blockFills = new Set(r.ops.filter((x) => x.op === "fill" && !x.clips.length && x.style !== H.ink && x.gco === "source-over").map((x) => x.style));
        if ( blockFills.size > 1 ) multiExt++;
      }
    }
    ok(grad === 0, `duplicate: ${grad} gradients in the Invincible hand (flat faces only)`);
    ok(soft === 0, `duplicate: ${soft} soft (see-through) shadows`);
    ok(misreg === 0, `duplicate: ${misreg} pictures with colour plates off register`);
    ok(multiExt === 0, `duplicate: ${multiExt} words whose duplicate has more than one colour`);
    ok(smears > 0 && smearFills === 0, `smear: ${smearFills} filled copies in ${smears} smear frames (outline-only echoes)`);
    const heavy = inv("KRRRUMBLE", { mood: "crash", seed: 2, character: { heavy: 1, hard: 0.9 } });
    ok(heavy.hand.block === "heavy" && Math.abs(heavy.hand.depthAng - Math.PI / 2) < 1e-9, `duplicate: a heavy sound gets the flat block straight down (${heavy.hand.block})`);
    const dup = inv("KRAK!", { mood: "crack", seed: 2 });
    ok(dup.hand.block === "dup" && dup.hand.depth >= 0.06 && dup.hand.depth <= 0.1 && Math.cos(dup.hand.depthAng) > 0 && Math.sin(dup.hand.depthAng) > 0, `duplicate: one copy down-right 0.06-0.10 cap (${dup.hand.depth.toFixed(3)})`);
  }

  /* P6: an open (hollow) letter is a white face with a rim in the word's colour, used by rule */
  {
    const p = inv("FIUUU", { mood: "whoosh", seed: 1 }); settleCenter(p, bank);
    ok(p.hand.fill === "hollow" && p.hand.hollowPaper === "#ffffff", `hollow: an airy sound is lettered open (${p.hand.fill})`);
    const r = recorder(); paintPicture(p, bank, p.timeline.hold[0], 80, r.make);
    ok(r.ops.some((x) => x.op === "stroke" && x.style === p.hand.pal.fill[1] && x.clips.length) && r.ops.some((x) => x.op === "fill" && x.style === "#ffffff" && x.clips.length), "hollow: white face, rim in the word's colour, inside the letter");
    const k = inv("KA-BLAM!", { mood: "boom", seed: 1, sound: { loud: 0.95 } });
    ok(k.hand.hollowPre && k.hand.fill !== "hollow", "hollow: a loud body gets an open prefix");
    let hol = 0; for ( const v of vocab ) if ( v.p().hand.fill === "hollow" ) hol++;
    ok(hol > 0 && hol < vocab.length * 0.35, `hollow: ${hol} of ${vocab.length} vocabulary words open (by rule, not everywhere)`);
  }

  /* P7: every hyphen lead-in of up to five letters is a small prefix on the body's top line, overlapped by the first body letter */
  {
    let n = 0, big = 0, top = 0, over = 0, worst = 0; const ex = [];
    const texts = vocab.map((v) => [v.w.text, v.w.play, v.id]).concat([["KA-THOOM!", { mood: "boom" }], ["RAKA-BOOM", { mood: "boom" }], ["BA-DUMM", { mood: "impact" }]]);
    for ( const [t, play] of texts ) {
      const want = invPrefix([...t]);
      if ( !want ) continue;
      const p = inv(t, { ...play, seed: `pf${t}` });
      if ( p.groups ) continue;   // a caller's own parts size the word (MOVE)
      settleCenter(p, bank); n++;
      const L = p.layout.letters, pre = p.layout.pre ?? 0;
      if ( pre !== want && !(pre === 0 && Math.max(...p.accent.slice(0, want)) >= 0.95) ) { big++; ex.push(`${t}: no prefix`); continue; }
      if ( !pre ) continue;
      const body = Math.max(...L.slice(pre).map((l) => l.s)), r = Math.max(...L.slice(0, pre).map((l) => l.s)) / body;
      worst = Math.max(worst, r); if ( r > 0.42 ) { big++; ex.push(`${t} ${r.toFixed(2)}`); }
      const topOf = (l) => -0.5 + l.dy - 0.5 * l.s;
      if ( Math.abs(topOf(L[0]) - topOf(L[pre])) > 0.02 ) top++;
      const a = placedShape(p, bank, pre - 1, L[pre - 1].x), b = placedShape(p, bank, pre, L[pre].x);
      if ( !(bbox(b).x0 < bbox(a).x1) && !L[pre].pushed ) { over++; ex.push(`tuck ${t}`); }   // (the reader may part them: legible first)
    }
    ok(n >= 6 && big === 0, `prefix: ${big} of ${n} hyphen lead-ins not small (max ratio ${worst.toFixed(2)}; ${ex.slice(0, 3).join(", ")})`);
    ok(top === 0, `prefix: ${top} prefixes not on the body's top line`);
    ok(over === 0, `prefix: ${over} prefixes not tucked under the first body letter (${ex.slice(-3).join(", ")})`);
  }
  /* P8: a tail never drops so far that it reads as lower case (floor under the word's peak) */
  {
    const sz = monotoneSizes([..."THWAPPPP!"], [0.7, 0.8, 0.9, 1, 0.6, 0.5, 0.4, 0.3, 1]);
    ok(Math.min(...sz.slice(0, 8)) >= INV_FLOOR - 1e-9 && INV_FLOOR >= 0.78 && INV_FLOOR <= 0.86, `P8 floor: ${sz.map((v) => v.toFixed(2)).join(" ")}`);
    let low = 0, nn = 0;
    for ( const v of vocab ) {
      const p = inv(v.w.text, { ...v.w.play, seed: `fl${v.id}` }); if ( p.groups || p.hand.number ) continue;
      const L = p.layout.letters, pre = p.layout.pre ?? 0, ch = p.chars;
      const idx = [...L.keys()].filter((i) => i >= pre && /[\p{L}\p{N}]/u.test(ch[i]));
      if ( !idx.length ) continue; nn++;
      const top = Math.max(...idx.map((i) => L[i].s));
      if ( idx.some((i) => L[i].s < (INV_FLOOR - 0.01) * top) ) low++;
    }
    ok(nn > 50 && low === 0, `P8 floor: ${low} of ${nn} vocabulary words have a body letter under ${INV_FLOOR} of the peak`);
  }
  /* P7: a rhythm (repeated segments) is not a lead-in; a multi-part lead-in is one prefix */
  {
    const want = { "BIP-BIP-BIP-BIP!": 0, "BA-DUM-BA-DUM!": 0, "WUP-WUP-WUUUP!": 0, "THWUP-WOKKA-THWUP": 0, "BWA-HA-HA-HA!": 0,
      "NEEO-WEEO-WEEOO!": 0, "BDOMF-BDOMF": 0, "KRA-KA-BOOOMM!": 7, "KA-THOOM!": 3, "RAKA-BOOM": 5, "KER-SPLAT": 4, "SKREE-": 0,
      "TSIKKA-TSAK-TSIK!": 0, "PTIK-KA-BOOM!": 8 };
    for ( const [t, e] of Object.entries(want) ) ok(invPrefix([...t]) === e, `prefix rule ${t}: ${invPrefix([...t])}, want ${e}`);
    const p = inv("BIP-BIP-BIP-BIP!", { mood: "zap", seed: 3 });
    ok((p.layout.pre ?? 0) === 0, "prefix: a rhythm word gets no small first part");
  }

  /* P8: one straight baseline, sizes rise to one peak and fall, no letter under 0.85 of its neighbour, upright; "!" as tall as its letter */
  {
    let base = 0, ratio = 0, modal = 0, tilt = 0, marks = 0, n = 0; const ex = [];
    for ( const v of vocab ) {
      const p = v.p(); if ( p.hand.number ) continue; n++;
      const L = p.layout.letters, pre = p.layout.pre ?? 0, ch = p.chars;
      const idx = [...L.keys()].filter((i) => i >= pre && ink(ch[i]) && ch[i] !== " ");
      const words = []; let cur = [];
      for ( let i = pre; i < L.length; i++ ) { if ( ch[i] === " " || ch[i] === "\n" ) { if ( cur.length ) words.push(cur); cur = []; } else if ( ink(ch[i]) ) cur.push(i); }
      if ( cur.length ) words.push(cur);
      if ( p.hand.env === "flat" || p.hand.env === "swell" || p.hand.env === "shrink" ) {
        /* LOOK3: interlocked O's stand off the line on purpose (up, down: check-look3 measures that stagger); the rest share one line */
        const bottoms = idx.filter((i) => !(p.layout.lines?.length > 1) && !(L[i].ring && /\p{L}/u.test(ch[i]))).map((i) => -0.5 + L[i].dy + 0.5 * L[i].s);
        if ( bottoms.length && Math.max(...bottoms) - Math.min(...bottoms) > 1e-6 ) { base++; if ( ex.length < 3 ) ex.push(`base ${p.word}`); }
      }
      for ( const wd of words ) {
        const s = wd.map((i) => L[i].s);
        for ( let k = 1; k < s.length; k++ ) if ( Math.min(s[k], s[k - 1]) < 0.85 * Math.max(s[k], s[k - 1]) - 1e-9 ) { ratio++; if ( ex.length < 3 ) ex.push(`ratio ${p.word}`); }
        const pk = s.indexOf(Math.max(...s));
        for ( let k = 1; k < s.length; k++ ) if ( (k <= pk && s[k] < s[k - 1] - 1e-9) || (k > pk && s[k] > s[k - 1] + 1e-9) ) { modal++; if ( ex.length < 3 ) ex.push(`peak ${p.word}`); break; }
      }
      if ( L.some((l) => Math.abs(l.rot) > 1e-9) ) tilt++;
      for ( let i = 1; i < L.length; i++ ) if ( /[!?]/.test(ch[i]) && ink(ch[i - 1]) && Math.abs(L[i].s - L[i - 1].s) > 1e-9 ) marks++;
    }
    ok(base === 0, `baseline: ${base} words off one straight baseline (${ex.join(", ")})`);
    ok(ratio === 0, `sizes: ${ratio} neighbours under 0.85 of each other`);
    ok(modal === 0, `sizes: ${modal} words with more than one peak`);
    ok(tilt === 0, `sizes: ${tilt} words with leaning letters`);
    ok(marks === 0, `sizes: ${marks} marks not as tall as their letter`);
    void n;
  }

  /* P9: the vertical column: tight (no wider than 1.1x its widest letter), rows tucked (pitch < 0.9 of the row), no hyphen row, no jitter */
  {
    for ( const t of ["KA-BOOM!", "CHOOM", "KRAAAK!", "WHAM", "BLAM-BLAM"] ) {
      const p = inv(t, { mood: "impact", seed: `v${t}`, arrange: "vertical" }); settleCenter(p, bank);
      const L = p.layout.letters, rows = p.layout.lines ?? [];
      ok(p.layout.arrange === "vertical" && rows.length >= 3, `vertical ${t}: a column (${rows.length} rows)`);
      const sh = L.map((l, i) => placedShape(p, bank, i, l.x));
      const body = [...L.keys()].filter((i) => sh[i] && !/[!?]/.test(p.chars[i]) && L[i].row > (p.layout.pre ? 0 : -1));
      const wid = Math.max(...body.map((i) => bbox(sh[i]).x1 - bbox(sh[i]).x0));
      const all = bbox(body.flatMap((i) => sh[i]));
      ok(all.x1 - all.x0 <= 1.1 * wid + 1e-6, `vertical ${t}: column ${(all.x1 - all.x0).toFixed(2)} wide, widest letter ${wid.toFixed(2)}`);
      for ( let k = 1; k < rows.length; k++ ) { const h = Math.max(...L.slice(rows[k].from, rows[k].to + 1).map((l) => l.s)); ok(rows[k].y - rows[k - 1].y < 0.9 * h + 1e-9, `vertical ${t}: row ${k} pitch ${(rows[k].y - rows[k - 1].y).toFixed(2)} >= 0.9 x ${h.toFixed(2)}`); }
      ok(!p.chars.some((c, i) => c === "-" && sh[i]), `vertical ${t}: no hyphen drawn`);
      const cx = body.map((i) => (bbox(sh[i]).x0 + bbox(sh[i]).x1) / 2);
      ok(Math.max(...cx) - Math.min(...cx) < 0.12, `vertical ${t}: letters on one axis (spread ${(Math.max(...cx) - Math.min(...cx)).toFixed(3)})`);
    }
    ok(TUCK >= 0.1 && TUCK <= 0.18, "vertical: rows tucked 0.10-0.18");
  }

  /* P10: interlocked O: the face's own O widened (same stroke), one size, crossing with air on both sides; no copy in the counters */
  {
    const O = bank.glyph(face, "O"), R = ovalRing(face, bank), ob = bbox(O.contours), rb = bbox(R.contours);
    ok(rb.y0 === ob.y0 && rb.y1 === ob.y1 && rb.x1 - rb.x0 >= 3 * R.stroke + 2 * R.gap - 1e-9, `rings: the face's O widened to hold a stroke (${(rb.x1 - rb.x0).toFixed(3)} >= ${(3 * R.stroke + 2 * R.gap).toFixed(3)})`);
    ok(R.link > R.stroke && R.link < (rb.x1 - rb.x0) - 2 * R.stroke + 1e-9, "rings: the link leaves air on both sides of each crossing stroke");
    for ( const [t, m] of [["WHOOM", "whoosh"], ["KA-THOOM!", "boom"], ["BOOM!", "boom"]] ) {   // LOOK3: a pair (four O never link)
      const p = inv(t, { mood: m, seed: `r${t}` }); settleCenter(p, bank);
      const L = p.layout.letters, rs = [...L.keys()].filter((i) => L[i].ring);
      ok(rs.length >= 2 && new Set(rs.map((i) => L[i].s.toFixed(6))).size === 1, `rings ${t}: linked, one size`);
      const b = baseGeometry(p, bank); ok(rs.every((i) => b[i].gl === R), `rings ${t}: drawn with the face's own (widened) O`);
      for ( const i of rs ) if ( L[i].link != null ) {
        const a = placedShape(p, bank, L[i].link, L[L[i].link].x), c = placedShape(p, bank, i, L[i].x), ba = bbox(a), bc = bbox(c);
        const sAir = (bc.x0 - ba.x0) / L[i].s;
        ok(Math.abs(sAir - R.link) < 1e-6, `rings ${t}: ring ${i} stands at its link distance (${sAir.toFixed(3)})`);
      }
      const r = recorder(); paintPicture(p, bank, p.timeline.hold[0], 120, r.make);
      ok(r.ops.some((x) => x.op === "fill" && x.gco === "destination-out"), `rings ${t}: the duplicate is cut out of the counters`);
    }
  }

  /* P11: colours by the sound, flat and saturated, no palette for more than a quarter of the kinds */
  {
    const by = new Map();
    for ( const id of KIND_IDS ) { const w = V.word(id, { lang: "en", loud: 0.7, seed: `c${id}` }); const p = inv(w.text, { ...w.play, seed: `c${id}` }); by.set(p.hand.invPal, (by.get(p.hand.invPal) ?? []).concat(id)); }
    const max = Math.max(...[...by.values()].map((v) => v.length));
    ok(max <= KIND_IDS.length / 4, `colours: the biggest palette holds ${max} of ${KIND_IDS.length} kinds (${[...by].map(([k, v]) => `${k} ${v.length}`).join(", ")})`);
    ok(by.size >= 8, `colours: ${by.size} palettes in use across the kinds`);
    const pal = (id) => { const w = V.word(id, { lang: "en", loud: 0.8, seed: 1 }); return inv(w.text, { ...w.play, seed: 1 }).hand.invPal; };
    ok(["yellow", "orange"].includes(pal("boom")) && ["orange", "yellow"].includes(pal("fire")) && pal("splash") === "blue" && pal("zap") === "cyan" && pal("pain") === "red" && ["white", "red"].includes(pal("punch")) && pal("clang") === "steel", `colours: the character table (boom ${pal("boom")}, fire ${pal("fire")}, splash ${pal("splash")}, zap ${pal("zap")}, pain ${pal("pain")}, punch ${pal("punch")}, clang ${pal("clang")})`);
  }

  /* P18: optical spacing: tight, pair-aware; the optical gap of a word's pairs is even, open pairs tuck in, no row closer than a touch */
  {
    let spread = 0, close = 0, n = 0, tighter = 0, pairs = 0; const ex = [];
    for ( const v of vocab.filter((x, k) => k % 2 === 0) ) {
      const p = v.p(); if ( p.layout.arrange === "vertical" ) continue;
      settleCenter(p, bank); n++;
      const L = p.layout.letters, ch = p.chars, pre = p.layout.pre ?? 0, G = p.hand.kern.gap;
      const sh = L.map((l, i) => placedShape(p, bank, i, l.x)), mean = [];
      for ( let i = 1; i < L.length; i++ ) {
        if ( !sh[i] || !sh[i - 1] || L[i].link === i - 1 || i === pre || L[i].pushed ) continue;
        const g = pairGaps(sh[i - 1], sh[i]), live = g.rows.filter((d) => d != null); if ( !live.length ) continue;
        const h = Math.min(L[i].s, L[i - 1].s), open = KERN.open * h;
        mean.push(g.rows.reduce((a, d) => a + (d == null ? open : Math.min(open, d)), 0) / g.rows.length / h);
        if ( Math.min(...live) < KERN.touch * h - 1e-6 ) { close++; if ( ex.length < 3 ) ex.push(`${p.word} ${ch[i - 1]}${ch[i]}`); }
        pairs++;
        if ( bank.adv(face, ch[i - 1]) && L[i].x - L[i - 1].x < L[i - 1].w + 1e-9 ) tighter++;
      }
      if ( mean.length >= 2 ) { const m = mean.reduce((a, b) => a + b, 0) / mean.length, sd = Math.sqrt(mean.reduce((a, b) => a + (b - m) ** 2, 0) / mean.length); if ( sd > 0.03 ) { spread++; if ( ex.length < 5 ) ex.push(`${p.word} sd ${sd.toFixed(3)}`); } }
      void G;
    }
    ok(spread <= n * 0.05, `spacing: ${spread} of ${n} words with uneven optical gaps (sd > 0.03 cap; ${ex.join(", ")})`);
    ok(close === 0, `spacing: ${close} pairs closer than a touch`);
    ok(tighter >= pairs * 0.9, `spacing: ${tighter} of ${pairs} pairs set tighter than their advance (the owner: too loose)`);
    /* open pairs tuck: A-V and T-A sit closer (advance distance) than H-N at the same size */
    const d = (t) => { const p = inv(t, { mood: "impact", seed: 1, sound: { loud: 0.5, peak: 0.5 } }); settleCenter(p, bank); const L = p.layout.letters; return (L[1].x + L[1].w / 2 - (L[0].x + L[0].w / 2)) / L[0].s - (bank.adv(face, t[0]) + bank.adv(face, t[1])) / 2; };
    ok(d("AV") < d("HN") && d("TA") < d("HN") && d("LT") < d("HN"), `spacing: open pairs tuck in (AV ${d("AV").toFixed(3)}, TA ${d("TA").toFixed(3)}, LT ${d("LT").toFixed(3)} vs HN ${d("HN").toFixed(3)})`);
  }
  /* P12, P13 (the vocabulary's side, read only here): "!!" only for the loudest words, under a quarter of all words over the tiers;
     no Polish diacritics in any sound word */
  {
    let bb = 0, n = 0, below = 0, dia = 0;
    for ( const loud of [0.3, 0.6, 0.8, 1] ) for ( const id of KIND_IDS ) for ( const lang of ["pl", "en"] ) for ( let s = 0; s < 3; s++ ) {
      const t = V.word(id, { lang, loud, seed: `bang${id}${s}` }).text; n++;
      if ( /!!/.test(t) ) { bb++; if ( loud < 0.85 ) below++; }
      if ( /[ĄĆĘŁŃÓŚŹŻ]/u.test(t) ) dia++;
    }
    ok(bb / n < 0.25 && below === 0, `marks: "!!" on ${(100 * bb / n).toFixed(1)} % of words, ${below} under loud 0.85`);
    ok(dia === 0, `marks: ${dia} sound words with Polish diacritics`);
  }
  void KINDS;
}
