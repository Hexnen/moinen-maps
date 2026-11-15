/* LETR: continuous sounds (README "Motion: continuous sounds"). A sound that lasts an unknown time (a fire, an engine, a siren, a held
   beam, wind, a hum, sustained gunfire, grinding, the steady hiss of a pipe) is lettered as a PHRASE SCORE, not one static word and
   not one word replayed on a timer: overlapping phrases, each a different treatment of the same sound (breath, stretch, split into its
   syllables, shed fragments drifting off, an accent, an echo), the order seeded and never the same treatment twice in a row; a level
   (0..1, live) sets how big, how often and how busy; when the sound stops, the words still up play their exits and a small tail
   trails off. Mode "ambient" is the quiet permanent case (a hissing pipe on a map): one small hollow word now and then, only while its
   spot is in view, at most a few on screen at once for the whole scene, slow and on threes (cheap enough for a whole session).
   Built on play(): every phrase is an ordinary word (same layers, sizes, visibility, reduced motion, limits, clean-up).
   SUSTAINGAP (1.9.15): the run is laid out by the INK each word draws (E.boxOf: entrance, hold and life poses + keyline, rim and
   duplicate block), never by a guessed em: two seats on either side of one split line (the lower seat's top and the upper seat's bottom
   a small gap apart), so a phrase entering never lands on the one leaving, whatever the size, face, motion type or treatment; echo
   copies and shed fragments go past the run's edge on the drift side (never over a phrase); a run kept in view (or in a caller's
   `room`) moves as ONE block; `startAt` puts the score on the event's clock (every seat: the same phrases at the same instants). */
import { rng, hash } from "./rng.mjs";
import { makeSustainLegacy } from "./sustain-legacy.mjs";
import { rowOut } from "./motion.mjs";

/* at most this many ambient words up at once per space (all ambient sources of a scene share it: readable, never nagging) */
export const AMBIENT_MAX = { world: 3, screen: 2 };
/* SUSTAINGAP: the run's spacing, in cap heights of the words concerned: the air between the two seats (each side keeps its share),
   between the run's edge and a fragment or echo copy, and between fragments side by side */
const SPLIT_K = 0.8;
export const RUN_GAP = { seat: 0.14, edge: 0.12, side: 0.25 };
const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5);
/* the treatments of one phrase (README); ambient uses only the quiet ones */
const LIVE = ["breath", "stretch", "split", "shed", "accent", "echo"];
const QUIET = ["breath", "stretch", "shed"];
/* MOTION2 (SPEC-MOTION 5.9): in the invincible style the phrases follow the sound's flow style (words.mjs FLOW), not one pool for every
   kind: a steady sound never accents or slams, a cycle is always split on its beat, a crackle pops; each phrase moves by the kind's own
   row of the motion table (motion.mjs) instead of random entrances, holds and exits */
export const TREAT_BY_FLOW = { steady: ["breath", "stretch"], drone: ["breath", "stretch", "echo"], crackle: ["breath", "shed", "accent", "split"],
  gust: ["breath", "stretch", "shed"], cycle: ["split"], mix: LIVE };
const FUTURE_MS = 60000;
const DRAWN_OUT = new Set(["shards", "crumble", "shatter"]);
/* a fragment's text: one of the word's syllables, or for a one-syllable word its last letters (never a copy of the whole word) */
export function fragmentsOf(text, syllables, n) {
  const clean = (t) => String(t).replace(/[-!?.]+$/g, "").replace(/^[-!?.]+/g, "");
  const syl = (syllables ?? []).map(clean).filter(Boolean);
  if ( syl.length > 1 ) return Array.from({ length: n }, (_, j) => syl[Math.min(syl.length - 1, j % syl.length)]);
  const w = clean(text), tail = w.length > 3 ? w.slice(-3) : w;
  return Array.from({ length: n }, () => tail || w || String(text));
}

/* E: { play, now, streams, vocab(), pointOf(space, at), inView(space, p, pad), syllablesOf, boxOf(h), viewBox(space) } from the engine */
export function makeSustain(E) {
  const ambientUp = { world: new Set(), screen: new Set() };
  /* the legacy styles (comic, expressive: frozen) keep the 1.9.14 run unchanged */
  const legacy = makeSustainLegacy(E, ambientUp);
  return function sustain(o0 = {}) {
    const o = { ...(o0 && typeof o0 === "object" ? o0 : {}) };
    if ( E.styleOf?.(o) !== "invincible" ) return legacy(o0);
    const space = o.space === "world" ? "world" : "screen";
    const ambient = o.mode === "ambient";
    const seed = o.seed ?? `u${(Math.random() * 1e9) | 0}`;
    const R = rng(hash(`${seed}:sustain`));
    const reduced = !!(o.reduced ?? (() => { try { return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })());
    let level = clamp01(typeof o.level === "number" ? o.level : ambient ? 0.2 : 0.6);
    /* SUSTAINGAP: the event's clock (this page's performance.now()): the score's instants count from it, a seat that joins late skips
       the phrases already over and joins the current one mid-life */
    let startAt = Number.isFinite(o.startAt) && !ambient ? o.startAt : undefined;
    if ( startAt > E.now() + FUTURE_MS ) startAt = undefined;
    const clocked = startAt !== undefined;
    const t0 = clocked ? startAt : E.now();
    const lvAt = (T) => { if ( typeof o.level === "function" ) { try { return clamp01(o.level(T - t0)); } catch { return level; } } return level; };
    const lv = () => lvAt(E.now());
    const handles = [], timers = new Set(), history = [];
    let cur = null, alive = true, k = 0, hand = null, last = null, lastKind = null, done, phrases = 0;
    const inv = true;
    const finished = new Promise((r) => (done = r));
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if ( alive ) fn(); }, Math.max(0, ms)); timers.add(id); };
    const track = (h) => {
      if ( !h ) return h;
      handles.push(h);
      h.finished.then(() => { const j = handles.indexOf(h); if ( j >= 0 ) handles.splice(j, 1); ambientUp[space].delete(h); if ( !alive && !handles.length ) done("done"); });
      return h;
    };
    /* the unit of spacing: a grid square (world) or 4 % of the screen height */
    const U = () => (space === "world" ? (globalThis.canvas?.grid?.size ?? 100) * 0.5 : (globalThis.innerHeight ?? 800) * 0.04) * (Number.isFinite(o.spread) ? o.spread : 1);
    const src = () => { const p = E.pointOf(space, o.at); if ( p ) last = p; return p; };
    /* the drift of shed fragments: rising for fire, hiss, steam, hum (default), along `dir` (degrees) when given */
    const drift = (Number.isFinite(o.dir) ? o.dir : -90) * Math.PI / 180;
    const up = Math.sin(drift) <= 0;   // fragments and echo copies leave by the run's top (else by its bottom)

    /* ---------- the run's layout (SUSTAINGAP) ----------
       seat 0 (even phrases) below, seat 1 (odd) above, on either side of one split line (an offset from the source by the phrase's size):
       a phrase's centre is its own ink reach plus its share of the gap away from that line. */
    const seat = [null, null];
    /* the split line's offset from the source: 0.8 of a phrase's cap height above it (by each phrase's own size: nothing carried over
       from the run's past, so every seat, one joining late too, seats a phrase at the same place) */
    const splitOf = (b) => -SPLIT_K * b.k;
    const box = (h) => { try { return E.boxOf?.(h) ?? null; } catch { return null; } };
    const fallbackK = () => (Number.isFinite(o.size) && o.size > 0 ? o.size : 1.6 * U());
    /* the room the run keeps to: the view (unless keepInView: false) and the caller's `room` (extents round the source, or a rect) */
    const roomAt = (p) => {
      let r = null;
      if ( o.keepInView !== false ) { try { r = E.viewBox?.(space) ?? null; } catch { r = null; } }
      let c = o.room;
      if ( typeof c === "function" ) { try { c = c(); } catch { c = null; } }
      if ( c && typeof c === "object" && p ) {
        const q = [c.x0, c.y0, c.x1, c.y1].every(Number.isFinite) ? c : { x0: p.x - (c.left ?? Infinity), y0: p.y - (c.up ?? Infinity), x1: p.x + (c.right ?? Infinity), y1: p.y + (c.down ?? Infinity) };
        r = r ? { x0: Math.max(r.x0, q.x0), y0: Math.max(r.y0, q.y0), x1: Math.min(r.x1, q.x1), y1: Math.min(r.y1, q.y1) } : q;
      }
      return r;
    };
    const gapOf = (b) => RUN_GAP.seat * 0.5 * (b?.k ?? fallbackK());
    const fin = (v) => (Number.isFinite(v) ? v : 0);
    /* a phrase's ink round its centre, and how far its exit takes it toward the split line (lower seat: up, upper seat: down) and
       away from it, while it is still legible */
    const toward = (b, s) => fin(s ? b.ed : b.eu), away = (b, s) => fin(s ? b.eu : b.ed);
    const up0 = () => box(seat[0]?.alive ? seat[0] : null), up1 = () => box(seat[1]?.alive ? seat[1] : null);
    /* how tall a phrase still to come may stand: the tallest phrase up now (ink + exit), at least 2.4 caps; read from the phrases up,
       never from the run's past, so a seat that joins late lays the run out the same */
    const tallest = () => {
      const bs = [up0(), up1()].filter(Boolean), k = bs[0]?.k ?? fallbackK();
      return Math.max(2.4 * k, ...bs.map((b) => b.u + b.d + fin(b.eu) + fin(b.ed)));
    };
    const seatH = (b, s) => (b ? b.u + b.d + toward(b, s) + away(b, s) : tallest());
    /* the split line now (absolute y): the run's base line, moved as one block to stay inside its room (both seats read the same) */
    const splitNow = (p, b) => {
      const y00 = p.y + splitOf(b);
      let y = y00;
      const r = roomAt(p);
      if ( r ) {
        const b0 = up0(), b1 = up1();
        const top = y - gapOf(b1 ?? b0) - seatH(b1, 1), bot = y + gapOf(b0 ?? b1) + seatH(b0, 0);
        if ( bot > r.y1 ) y -= bot - r.y1;
        const top2 = top + (y - y00);
        if ( top2 < r.y0 ) y += r.y0 - top2;   // the top wins: a run taller than its room overflows downwards (never onto itself)
      }
      return y;
    };
    /* where phrase `ph` (seat s, horizontal offset dx) stands now */
    const seatAt = (ph) => () => {
      const p = src() ?? last; if ( !p ) return null;
      const b = box(ph.h);
      if ( !b ) { const em = fallbackK(); return { x: p.x + ph.dx, y: p.y + (ph.s ? -1.05 : 0.1) * em }; }
      const y0 = splitNow(p, b), g = gapOf(b);
      let x = p.x + ph.dx;
      const r = roomAt(p);
      if ( r ) { if ( x + b.r > r.x1 ) x = r.x1 - b.r; if ( x - b.l < r.x0 ) x = Math.min(r.x0 + b.l, (r.x0 + r.x1) / 2); }
      return { x, y: ph.s ? y0 - g - toward(b, 1) - b.d : y0 + g + toward(b, 0) + b.u };
    };
    /* the run's edge on the drift side (absolute y): past the seat on that side, its phrase's exit included */
    const edgeNow = (p) => {
      const b0 = up0(), b1 = up1(), y0 = splitNow(p, b0 ?? b1 ?? { k: fallbackK() });
      if ( up ) return y0 - gapOf(b1 ?? b0) - Math.max(seatH(b1, 1), tallest());
      return y0 + gapOf(b0 ?? b1) + Math.max(seatH(b0, 0), tallest());
    };

    /* WORD's continuous-sound flow (contract v5 corrections, `L.flow`): onset, body segments for ever, tail; WORD owns the text,
       loudness, accent and how long each segment is the current one, MOVE where and how it moves */
    let flow = null;
    const flowOf = () => {
      if ( flow !== null ) return flow;
      try { const V = E.vocab(); flow = o.kind != null && typeof V?.flow === "function" ? V.flow(o.kind, { lang: o.lang, seed, loud: level, magnitude: o.magnitude, style: o.style, material: o.material, intensity: o.intensity, stage: o.stage }) : false; } catch { flow = false; }
      return flow;
    };
    const seg = (q) => (q?.text ? { text: q.text, mood: q.mood, kmood: q.play?.mood, accent: q.accent, ms: q.ms, loud: q.loud } : null);
    /* the text of phrase i: the caller's function, WORD's flow, a vocabulary word, or the caller's text breathing */
    const textAt = (i, L, extra, T) => {
      if ( typeof o.words === "function" ) { try { const w = o.words(i, T - t0, L); if ( w ) return typeof w === "string" ? { text: w } : w; } catch {} }
      const F = flowOf();
      if ( F ) { try { const w = seg(i === 0 ? F.onset : F.at(i - 1)); if ( w ) return w; } catch {} }
      const V = E.vocab();
      if ( o.kind != null && V ) {
        try {
          if ( typeof V.sustain === "function" ) { const w = V.sustain(o.kind, { seed, lang: o.lang, level: L, k: i, t: T - t0 }); if ( w?.text ) return w; }
          const w = V.word(o.kind, { seed: `${seed}:${i % 3}`, lang: o.lang, loud: L });
          return { text: extra && V.stretch ? V.stretch(w.text, extra) : w.text, kmood: w.mood };
        } catch {}
      }
      const t = String(o.text ?? "SSSS");
      return { text: extra && V?.stretch ? V.stretch(t, extra) : t };
    };
    /* the run lays itself out (and keeps itself in view as one block): its words are not moved one by one by the engine */
    const common = () => ({
      space, layer: o.layer, zIndex: o.zIndex, token: o.token, vision: o.vision, elevation: o.elevation, colors: o.colors, pixel: o.pixel,
      fit: o.fit, size: o.size, span: o.span, area: o.area, reduced: o.reduced, keepInView: ambient ? o.keepInView : false, pushable: o.pushable, glow: o.glow,
      maxWidth: o.maxWidth, on: ambient ? 3 : o.on, fps: ambient ? undefined : o.fps, hand: hand ?? o.hand ?? undefined, mood: o.mood
    });
    /* orbit / path: each phrase rides it, joining where the sound is now on the ring (as a stream's syllables do) */
    const travel = (T) => {
      if ( o.orbit ) {
        const ob = o.orbit, period = Math.max(300, ob.period ?? 2600), dir = ob.dir < 0 ? -1 : 1;
        return { orbit: { ...ob, center: ob.center ?? o.at, phase: (Number.isFinite(ob.phase) ? ob.phase : -90) + (dir * 360 * (T - t0)) / period } };
      }
      if ( o.path ) return { path: o.path };
      return null;
    };
    const magOf = (L, k = 1) => (Number.isFinite(o.magnitude) ? o.magnitude : 0.12 + 0.7 * L) * k;

    /* every seeded choice of phrase i at its instant T (the same on every seat, also for a phrase a late seat skips) */
    function decide(i, T) {
      const L = lvAt(T);
      const fstyle = inv ? (flowOf() || null)?.style ?? null : null;
      const allowed = inv && fstyle && TREAT_BY_FLOW[fstyle] ? TREAT_BY_FLOW[fstyle] : null;
      const pool0 = ambient ? QUIET.filter((t) => !allowed || allowed.includes(t) || t === "breath") : (allowed ?? LIVE);
      const okT = (t) => !(t === "accent" && L < 0.45) && !(reduced && (t === "shed" || t === "echo" || t === "split"));
      let pool = pool0.filter((t) => t !== lastKind && okT(t));
      if ( !pool.length && allowed ) pool = pool0.filter(okT);   // a cycle repeats its split
      const kind = i === 0 ? (allowed?.length === 1 && !reduced ? allowed[0] : "breath") : (o.treatments ? R.pick(o.treatments.filter((t) => t !== lastKind)) ?? "breath" : (R.pick(pool) ?? "breath"));
      lastKind = kind;
      const w = textAt(i, L, kind === "stretch" ? 1 + Math.round(2 * L) : 0, T);
      const side = i % 2 ? 1 : -1, u = U();
      const dxR = R.f(0.1, 0.6), dyR = ambient ? R.f(0.05, 0.45) : R.f(0, 0.12);
      const segMs = Number.isFinite(w.ms) && w.ms > 0 ? Math.max(500, Math.min(4000, w.ms)) : null;   // WORD's "current for" time
      const life = ambient ? R.f(1500, 2400) : segMs ? Math.round(segMs * 1.35) : Math.round((1300 + 1100 * (1 - L)) * R.f(0.85, 1.15));
      const rot = side * R.f(1, 6);
      const pick = { in: R.pick(["pop", "rise", "grow"]), hold: R.pick(["boil", "wobble", "throb"]), out: R.pick(["dissolve", "rise"]), out2: R.pick(["dissolve", "shrink"]), out3: R.pick(["burst", "pop"]) };
      const nShed = kind === "shed" ? (ambient ? 1 : 1 + Math.round(2 * L)) : 0;
      const fan = Array.from({ length: nShed }, () => R.f(-0.12, 0.12));
      const gap = ambient ? R.f(o.gap?.[0] ?? 4500, o.gap?.[1] ?? 11000) : (segMs ?? life * R.f(0.55, 0.8) / (0.75 + 0.5 * L)) * (reduced ? 1.6 : 1);
      return { i, T, L, kind, w, side, u, dx: side * dxR * u, dyR, life, rot, pick, nShed, fan, gap };
    }

    function phrase(T) {
      const p0 = src();
      if ( !p0 && !last ) { stop(); return; }                                       // the source is gone
      const i = k;
      if ( ambient ) {
        /* quiet and permanent: only when its spot is in view and the scene's ambient budget has room; otherwise look again later */
        const busy = ambientUp[space].size >= (o.max ?? AMBIENT_MAX[space]);
        if ( busy || !E.inView(space, p0 ?? last, U() * 2) ) { later(() => phrase(E.now()), R.f(900, 2200)); return; }
      }
      const d = decide(i, T);
      k++; phrases++;
      playPhrase(d);
      later(() => phrase(T + d.gap), T + d.gap - E.now());
    }
    function playPhrase(d) {
      const { i, L, kind, w, side, u, life } = d;
      const tr = travel(d.T);
      const s = ambient ? -1 : i % 2;
      const ph = { s, dx: tr ? 0 : d.dx, h: null };
      /* the phrase before leaves as this one comes (its exit plays under the new entrance, in the OTHER seat: never a pile of words) */
      let at;
      if ( tr ) at = undefined;
      else if ( ambient ) { const dy = -d.dyR * u; at = () => { const p = src() ?? last; return p ? { x: p.x + ph.dx, y: p.y + dy } : null; }; }
      else at = seatAt(ph);
      const base = { ...common(), ...(tr ?? { at }), seed: `${seed}:${i}`, mood: w.mood ?? o.mood ?? w.kmood, hold: life, rotation: d.rot, accent: w.accent };
      if ( clocked ) base.startAt = d.T;
      if ( inv ) base.kind = o.kind;
      /* MOTION2: invincible phrases keep the kind's motion; only an accent is pinned (a slam) */
      /* (the upper seat never breaks into pieces that fall through the lower one: a drawn shards / crumble exit becomes a clean cut there) */
      const pinOut = s === 1 && DRAWN_OUT.has(rowOut(o.kind, base.mood)) ? "cut" : undefined;
      const P = (txt, q) => E.play(txt, inv && kind !== "accent" ? { ...q, in: i === 0 && o.in ? o.in : undefined, holdKind: o.holdKind, out: pinOut } : q);
      let h = null;
      switch ( kind ) {
        case "breath":
          h = P(w.text, { ...base, magnitude: magOf(L), in: i === 0 ? (o.in ?? (ambient ? "rise" : "grow")) : d.pick.in, holdKind: o.holdKind ?? d.pick.hold, out: d.pick.out, tempo: ambient ? 0.7 : 1, hollow: ambient ? (o.hollow ?? true) : o.hollow });
          break;
        case "stretch":
          h = P(w.text, { ...base, magnitude: magOf(L, 1.1), in: "grow", holdKind: "throb", out: ambient ? "dissolve" : d.pick.out2, tempo: ambient ? 0.7 : 0.9, hollow: ambient ? (o.hollow ?? true) : o.hollow });
          break;
        case "split":
          h = P(w.text, { ...base, magnitude: magOf(L), parts: "syllables", beat: Math.round(130 + 120 * (1 - L)), holdKind: "boil", out: "dissolve" });
          break;
        case "accent":
          h = E.play(w.text, { ...base, magnitude: magOf(L, 1.45), in: "slam", holdKind: "shake", out: d.pick.out3, hold: Math.round(life * 0.7) });
          break;
        case "echo":
          h = P(w.text, { ...base, magnitude: magOf(L), in: "pop", holdKind: "boil", out: "dissolve" });
          /* the copies that answer it stand past the run's edge, one beyond the other (smaller, hollow, fading): never over a phrase */
          if ( h && !reduced ) for ( let j = 1; j <= 2; j++ ) later(() => echoCopy(h, ph, w.text, j, d), d.T + 230 + 160 * (j - 1) - E.now());
          break;
        case "shed": {
          /* the word stays small and fragments of it come off and drift away (steam off a pipe, sparks off a fire) */
          h = P(w.text, { ...base, magnitude: magOf(L, 0.85), in: "pop", holdKind: "boil", out: "dissolve", tempo: ambient ? 0.7 : 1, hollow: ambient ? (o.hollow ?? true) : o.hollow });
          const syl = E.syllablesOf(w.text), nF = syl.length > 1 ? Math.min(d.nShed, syl.length) : Math.min(1, d.nShed);
          const frags = fragmentsOf(w.text, syl, nF);
          for ( let j = 0; j < nF; j++ ) later(() => shed(frags[j], ph, j, d, nF), d.T + life * (0.2 + 0.22 * j) - E.now());
          break;
        }
      }
      ph.h = h;
      history.push({ kind, text: w.text }); if ( history.length > 32 ) history.shift();   // the last phrases (tests, the designer)
      if ( cur?.alive && cur !== h ) cur.stop();
      cur = h;
      if ( h && s >= 0 ) seat[s] = h;
      if ( h ) { track(h); if ( ambient ) ambientUp[space].add(h); if ( !hand && h.plan ) hand = h.plan.hand; }
    }
    /* the satellites of a phrase (echo copies, shed fragments) stand past the run's edge on the drift side (never over a phrase): each
       is placed once its own ink is known (its first point until then) and stays there */
    function echoCopy(h, ph, text, j, d) {
      const pb = box(h); if ( !pb || !h.alive ) return;
      const sh = 0.74 ** j, k0 = pb.k, g = RUN_GAP.edge * k0;
      const prev = j > 1 ? ph.copies?.[j - 1] : null;
      if ( j > 1 && !prev?.h ) return;
      const c = { h: null, x: null, y: null };
      (ph.copies ??= [])[j] = c;
      const r = roomAt(src() ?? last), estH = (pb.u + pb.d) * sh;
      const at = () => {
        if ( c.y !== null ) return { x: c.x, y: c.y };
        const p = src() ?? last; if ( !p ) return null;
        const pbx = prev ? box(prev.h) : null;
        const y0 = prev && prev.y !== null && pbx ? (up ? prev.y - pbx.u - g : prev.y + pbx.d + g) : (up ? edgeNow(p) - g : edgeNow(p) + g);
        const x = p.x + ph.dx + (j % 2 ? 1 : -1) * 0.12 * (pb.l + pb.r), b = box(c.h);
        if ( !b ) return { x, y: up ? y0 - estH / 2 : y0 + estH / 2 };
        c.x = x; c.y = up ? y0 - b.d : y0 + b.u;
        return { x: c.x, y: c.y };
      };
      const q = at();
      if ( !q || (r && (up ? q.y - estH * 0.6 < r.y0 : q.y + estH * 0.6 > r.y1)) ) return;   // no room past the run's edge: the phrase plays alone
      c.h = track(E.play(text, { ...common(), seed: `${seed}:${d.i}:echo${j}`, at, scale: sh, magnitude: magOf(d.L), in: "pop", holdKind: "boil", out: "dissolve", hold: 240,
        hollow: true, rotation: d.rot + (j % 2 ? 4 : -4), ...(clocked ? { startAt: d.T + 230 + 160 * (j - 1) } : {}) }));
    }
    /* a fragment rises from its own part of the word (syllable j over column j of the phrase) past the run's edge and drifts off,
       the fragments of one phrase fanning apart */
    function shed(text, ph, j, d, n) {
      const SC = 0.6, pb = box(ph.h), k0 = pb?.k ?? fallbackK(), g = RUN_GAP.edge * k0;
      const W = pb ? pb.l + pb.r : 4 * k0, estH = pb ? (pb.u + pb.d) * SC : 2 * k0 * SC;
      const a = drift + (j - (n - 1) / 2) * 0.45 + d.fan[j];
      const f = { h: null, from: null, to: null };
      const point = () => {
        if ( f.from ) return f;
        const p = src() ?? last; if ( !p ) return null;
        const b = box(f.h), H = b ? b.u + b.d : estH, e = edgeNow(p);
        const cx = p.x + ph.dx + (pb ? (pb.r - pb.l) / 2 : 0) - W / 2 + ((j + 0.5) * W) / n;
        const from = { x: cx, y: up ? e - g - (b ? b.d : H / 2) : e + g + (b ? b.u : H / 2) };
        const dist = Math.max(d.u * 2.6, 2.4 * H), to = { x: from.x + Math.cos(a) * dist, y: from.y + Math.sin(a) * dist };
        if ( b ) { f.from = from; f.to = to; }
        return { from, to };
      };
      const q0 = point(), r = roomAt(src() ?? last);
      if ( !q0 || (r && (up ? q0.from.y - estH / 2 < r.y0 : q0.from.y + estH / 2 > r.y1)) ) return;   // no room past the edge: no fragment
      f.h = track(E.play(text, { ...common(), seed: `${seed}:shed${d.i}:${j}`, path: { from: () => point()?.from ?? null, to: () => point()?.to ?? null, duration: 900, ease: "out", orient: "none" },
        magnitude: magOf(d.L, 0.45), scale: SC, in: "pop", holdKind: "boil", out: "dissolve", hold: 600, hollow: ambient ? (o.hollow ?? true) : undefined,
        ...(clocked ? { startAt: d.T + d.life * (0.2 + 0.22 * j) } : {}) }));
    }
    /* the end: the words up play their exits; a live sound leaves a small tail trailing off along its drift, from the run's edge */
    function stop(q = {}) {
      if ( !alive ) return;
      alive = false; E.streams.delete(s);
      for ( const id of timers ) clearTimeout(id);
      timers.clear();
      if ( q.quick ) for ( const h of [...handles] ) h.stop({ quick: true });
      else {
        const p = src() ?? last, e = p && !ambient ? edgeNow(p) : null;
        for ( const h of [...handles] ) h.stop();
        if ( !ambient && !reduced && phrases > 0 && p ) {
          const F = flowOf(), tail = F ? seg(F.tail) : null, u = U();
          if ( tail ) shedTail(tail.text, u, true, e);
          else { const syl = E.syllablesOf(textAt(k, lv(), 0, E.now()).text); shedTail(syl.at(-1) ?? "S", u, false, e); }
        }
      }
      if ( !handles.length ) done(q.quick ? "stopped" : "done");
    }
    function shedTail(t, u, given, edge) {
      const p = last; if ( !p ) return;
      const a = drift, d = u * 2.6, k0 = fallbackK();
      const y = Number.isFinite(edge) ? edge + (up ? -1 : 1) * (RUN_GAP.edge * k0 + k0 * 0.75) : p.y - u * 0.3;
      const h = E.play(given ? String(t) : `${String(t).replace(/[-!?.]+$/g, "")}...`, { ...common(), at: undefined, seed: `${seed}:tail`, path: { from: { x: p.x, y }, to: { x: p.x + Math.cos(a) * d, y: y + Math.sin(a) * d }, duration: 1100, ease: "out", orient: "none" },
        magnitude: magOf(lv(), 0.5), scale: 0.75, in: "pop", holdKind: "boil", out: "dissolve", hold: 700 });
      if ( h ) { handles.push(h); h.finished.then(() => { const j = handles.indexOf(h); if ( j >= 0 ) handles.splice(j, 1); if ( !handles.length ) done("done"); }); }
    }
    const s = {
      space, handles, history, finished, stop, mode: ambient ? "ambient" : "live",
      get alive() { return alive; }, get phrases() { return phrases; },
      /* the sound's loudness now (0..1): bigger, more often, busier; a caller may also pass `level` as a function of ms */
      level(v) { if ( v !== undefined ) level = clamp01(v); return lv(); }
    };
    E.streams.add(s);
    const startIn = Number.isFinite(o.delay) && o.delay > 0 ? o.delay : 0;
    if ( ambient ) {
      /* ambient sources start spread out (many pipes on one map do not all hiss at once) */
      later(() => phrase(E.now()), startIn + R.f(0, o.gap?.[1] ?? 6000));
    } else {
      /* on the event's clock: the phrases whose time is over are decided (the same seeded choices) but not drawn */
      let T = t0 + startIn, replay = null;
      if ( clocked ) {
        const nowT = E.now();
        for ( let guard = 0; guard < 10000; guard++ ) {
          const d = decide(k, T);
          if ( T + d.gap + 450 >= nowT ) { replay = d; break; }   // still up (or to come): drawn, joining its own timeline
          k++; T += d.gap;
        }
      }
      if ( replay ) { const d = replay; k++; phrases++; playPhrase(d); later(() => phrase(d.T + d.gap), d.T + d.gap - E.now()); }
      else later(() => phrase(T), T - E.now());
    }
    try { if ( o.until && typeof o.until.then === "function" ) o.until.then(() => stop(), () => stop()); } catch {}
    return s;
  };
}
