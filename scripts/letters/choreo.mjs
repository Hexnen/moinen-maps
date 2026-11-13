/* LETR choreo: one word, several beats. Parts of a word arrive at their own times (a small "RAKA" before a big "BOOM"), each
   syllable of a repeated word hits on its own beat ("BLAM BLAM BLAM" inside one word), letters are typed on one by one, a number
   is counted in. Pure; called by design.mjs while a plan is made (README "Motion: choreography").

   How it works: the word is split into groups of letters, each group gets its own small entrance (built by the same timeline code
   as a whole word, with its own randomness) and its own arrival time; the entrance pictures are then sampled on a 1-tick grid and
   merged where nothing changes, so the result stays on twos (or the chosen `on`) with ones only for accents. Groups already in
   place are knocked by each later hit (overlapping action). Everything is deterministic for the plan's seed. */
import { rng } from "./rng.mjs";
import { TICK_MS } from "./move.mjs";

const L0 = () => ({ v: 1, x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 });

/* the groups of letters: [{ from, to (exclusive), scale, at (ms, -1 = already there), in, body }] or null */
export function groupsOf(chars, opts, syllablesOf) {
  const parts = opts.parts, n = chars.length;
  const beat = Number.isFinite(opts.beat) && opts.beat > 0 ? opts.beat : 170;
  if ( opts.typeOn ) {
    const rate = typeof opts.typeOn === "number" && opts.typeOn > 0 ? opts.typeOn : TICK_MS * 2;
    const g = []; let k = 0;
    chars.forEach((ch, i) => { if ( ch === " " ) return; g.push({ from: i, to: i + 1, scale: 1, at: k++ * rate, type: true }); });
    if ( g.length ) g[g.length - 1].body = true;
    return g.length > 1 ? g : null;
  }
  if ( !parts ) return null;
  /* letter ranges of the texts, matched in order (spaces and dashes between them belong to the part before) */
  const match = (texts) => {
    const out = []; let i = 0;
    for ( const t of texts ) {
      const want = [...String(t).toLocaleUpperCase("pl").replace(/\s+/g, "")];
      while ( i < n && (chars[i] === " ") ) i++;
      const from = i; let j = 0;
      while ( i < n && j < want.length ) { if ( chars[i] === " " ) { i++; continue; } if ( chars[i] !== want[j] ) return null; i++; j++; }
      if ( j < want.length ) return null;
      while ( i < n && (chars[i] === "-" || chars[i] === " ") ) i++;
      out.push({ from, to: i });
    }
    if ( out.length ) out[out.length - 1].to = n;
    return out.length ? out : null;
  };
  const sylls = () => match(syllablesOf(chars.join("")).map((s) => s.replace(/-/g, "")));
  let g = null;
  if ( parts === "syllables" || parts === true ) {
    g = sylls();
    g?.forEach((p, k) => Object.assign(p, { scale: 1, at: k * beat }));
  } else if ( parts === "prefix" ) {
    g = sylls();
    if ( g && g.length > 1 ) {
      const last = g.length - 1;
      g.forEach((p, k) => Object.assign(p, k < last ? { scale: 0.55, at: k * Math.min(beat, TICK_MS * 3), in: "pop" } : { scale: 1, at: (last - 1) * Math.min(beat, TICK_MS * 3) + beat }));
    }
  } else if ( Array.isArray(parts) && parts.length ) {
    const texts = parts.map((p) => (typeof p === "string" ? p : p?.text ?? ""));
    g = match(texts);
    g?.forEach((p, k) => {
      const o = typeof parts[k] === "object" ? parts[k] : {};
      Object.assign(p, { scale: Number.isFinite(o.scale) && o.scale > 0 ? o.scale : 1, at: Number.isFinite(o.at) ? o.at : k * beat, in: o.in });
    });
  }
  if ( !g || g.length < 2 ) return null;
  /* the body: the last part that arrives, unless one is bigger */
  let body = g.length - 1;
  g.forEach((p, k) => { if ( p.scale > g[body].scale + 1e-6 ) body = k; });
  g[body].body = true;
  return g;
}

/* per-letter size factors for the layout */
export const letterScales = (n, groups) => {
  if ( !groups ) return null;
  const s = new Array(n).fill(1);
  for ( const p of groups ) for ( let i = p.from; i < p.to; i++ ) s[i] = p.scale;
  return s;
};

/* a group transform (the whole-word g of an entrance picture) as per-letter transforms around the group's centre */
function gToLetter(g, lx, ly, cx, cy) {
  const k = g.s ?? 1, kx = k * (g.sx ?? 1), ky = k * (g.sy ?? 1);
  return { x: (lx - cx) * (kx - 1) + (g.x ?? 0), y: (ly - cy) * (ky - 1) + (g.y ?? 0), r: g.r ?? 0, s: k, sx: g.sx ?? 1, sy: g.sy ?? 1 };
}
const compose = (a, b) => ({ v: a.v && b.v ? 1 : 0, x: a.x + b.x, y: a.y + b.y, r: a.r + b.r, s: a.s * b.s, sx: a.sx * b.sx, sy: a.sy * b.sy });

/* The choreographed entrance. `build(nLetters, R, kind)` = the timeline builder (design.buildTimeline) for one group's entrance;
   `layout` = the plan's letters (positions for group centres); returns the new entrance pictures. */
export function choreoEntrance(groups, layout, seed, build, mk, o = {}) {
  const n = layout.letters.length;
  const R = rng((seed ^ 0x5bd1e995) >>> 0);
  const on = o.on || 2;
  /* each group's own entrance, its arrival in ticks, its centre */
  const G = groups.map((p, k) => {
    const len = p.to - p.from;
    let ent;
    if ( p.type ) ent = [{ ticks: on, g: { s: 1.3, sx: 0.92, sy: 1.12 }, letters: [L0()], fx: [] }, { ticks: on, g: { s: 0.94, sx: 1.06 }, letters: [L0()], fx: [] }];
    else ent = build(len, rng(R.seed()), p.in).ent;
    if ( !p.body ) ent = ent.filter((q) => !q.impact).map((q) => ({ ...q, smear: null, fx: q.fx.filter((f) => f.k === "burst" || f.k === "sparks") }));
    const ls = layout.letters.slice(p.from, p.to);
    const x0 = Math.min(...ls.map((l) => l.x)), x1 = Math.max(...ls.map((l) => l.x + l.w));
    const at = p.at < 0 ? -1 : Math.max(0, Math.round(p.at / TICK_MS));
    const ends = []; let a = 0; for ( const q of ent ) { a += q.ticks; ends.push(a); }
    return { p, ent, ends, len: a, at, cx: (x0 + x1) / 2, cy: -0.5 };
  });
  const T = Math.max(...G.map((g) => (g.at < 0 ? 0 : g.at + g.len)));
  /* knocks: when a later group lands (its first picture), groups already in place jump (2 ticks) and settle back (2 ticks) */
  const hits = G.filter((g) => g.at > 0).map((g) => g.at);
  const knockSeed = R.seed();
  const frames = [];
  for ( let t = 0; t < T; t++ ) {
    const st = G.map((g) => {
      if ( g.at < 0 ) return "in";
      const l = t - g.at;
      if ( l < 0 ) return "wait";
      const i = g.ends.findIndex((e) => l < e);
      return i < 0 ? "in" : i;
    });
    const hit = hits.findIndex((h) => t >= h && t < h + 4);
    const knock = hit < 0 ? -1 : (t - hits[hit] < 2 ? hit * 2 : hit * 2 + 1);
    const bk = G.findIndex((g) => g.p.body), bs = st[bk], bq = typeof bs === "number" ? G[bk].ent[bs] : null;
    frames.push({ t, key: st.join(",") + "|" + knock, st, knock, hitAt: hit < 0 ? -1 : hits[hit], accent: !!bq && (bq.impact || !!bq.smear || bq.ticks === 1) });
  }
  /* merge equal neighbours; a 1-tick drawing that is not an accent (flash, smear, snap of the body) is folded into the next one,
     so the word stays on twos (or the chosen rate) */
  let runs = [];
  for ( const f of frames ) { const last = runs[runs.length - 1]; if ( last && last.key === f.key ) last.ticks++; else runs.push({ ...f, ticks: 1 }); }
  const minT = Math.max(1, on);
  for ( let i = 0; i < runs.length - 1; i++ ) if ( runs[i].ticks < minT && !runs[i].accent ) { runs[i + 1].ticks += runs[i].ticks; runs[i] = null; }
  runs = runs.filter(Boolean);
  if ( runs.length > 1 && runs.at(-1).ticks < minT ) { runs.at(-2).ticks += runs.at(-1).ticks; runs.pop(); }
  runs = runs.flatMap((r) => { const out = []; let k = r.ticks; while ( k > 6 ) { out.push({ ...r, ticks: 4 }); k -= 4; } out.push({ ...r, ticks: k }); return out; });
  return runs.map((f) => {
    const p = mk(f.ticks);
    p.letters = []; for ( let i = 0; i < n; i++ ) p.letters.push({ ...L0(), v: 0 });
    G.forEach((g, k) => {
      const s = f.st[k];
      if ( s === "wait" ) return;
      const q = s === "in" ? null : g.ent[s];
      for ( let i = g.p.from; i < g.p.to; i++ ) {
        const L = layout.letters[i];
        let A = L0();
        if ( q ) {
          const own = q.letters[i - g.p.from] ?? L0();
          A = compose(compose(L0(), { ...gToLetter(q.g, L.x + L.w / 2, -0.5 + L.dy, g.cx, g.cy), v: 1 }), { ...L0(), ...own });
        } else if ( f.knock >= 0 && g.at < f.hitAt ) {
          /* knocked by the later hit: up and tilted, then a small settle the other way (follow-through) */
          const R2 = rng((knockSeed ^ (i * 2654435761) ^ (f.knock * 40503)) >>> 0);
          A = f.knock % 2 === 0 ? { ...L0(), y: -R2.f(0.05, 0.11), r: R2.f(-0.09, 0.09), x: R2.f(-0.03, 0.03) } : { ...L0(), y: R2.f(0.01, 0.03), r: R2.f(-0.03, 0.03) };
        }
        p.letters[i] = A;
      }
      if ( q && g.p.body ) {
        if ( q.impact ) p.impact = true;
        if ( q.smear ) p.smear = q.smear;
      }
      if ( q ) for ( const fx of q.fx ?? [] ) if ( !p.fx.some((x) => x.k === fx.k) ) p.fx.push({ ...fx });
    });
    if ( p.impact ) p.ticks = 1;
    p.choreo = true;
    return p;
  });
}

/* Counting a number in: the digits run from `from` to the word's number on twos, small and jittery, before the word lands.
   Each picture gives letters a `ch` (the digit drawn in that slot this picture); slots a shorter number does not use are hidden. */
export function countFrames(chars, opts, seed, mk, on = 2) {
  const s = chars.join("");
  const m = /\d+/.exec(s);
  if ( !m ) return null;
  const to = Number(m[0]), slots = m[0].length, start = m.index;
  const c = typeof opts.countIn === "object" ? opts.countIn : {};
  const from = Number.isFinite(c.from) ? Math.max(0, Math.floor(c.from)) : 0;
  if ( from === to ) return null;
  const steps = Math.max(2, Math.min(Number.isFinite(c.steps) ? c.steps : 7, Math.abs(to - from)));
  const R = rng((seed ^ 0x27d4eb2f) >>> 0);
  const out = [];
  for ( let k = 0; k < steps; k++ ) {
    const u = k / steps, e = 1 - (1 - u) * (1 - u);
    const v = Math.round(from + (to - from) * e);
    const ds = String(Math.abs(v)).padStart(slots, " ").slice(-slots);
    const p = mk(on);
    p.g = { ...p.g, s: 0.78 + 0.08 * u, x: R.f(-0.03, 0.03), y: R.f(-0.04, 0.04) };
    p.letters = chars.map((ch, i) => {
      if ( i < start || i >= start + slots ) return L0();
      const d = ds[i - start];
      return d === " " ? { ...L0(), v: 0 } : { ...L0(), ch: d, r: R.f(-0.06, 0.06) };
    });
    p.count = v;
    out.push(p);
  }
  return out;
}
