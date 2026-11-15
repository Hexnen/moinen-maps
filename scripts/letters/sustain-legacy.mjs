/* LETR: continuous sounds, the LEGACY score (engine 1.9.14, frozen): the comic and expressive styles keep exactly this run (its seats,
   fragments and echoes), so their pictures do not change (SUSTAINGAP 1.9.15 lays out the invincible run in sustain.mjs).
   README "Motion: continuous sounds". A sound that lasts an unknown time (a fire, an engine, a siren, a held
   beam, wind, a hum, sustained gunfire, grinding, the steady hiss of a pipe) is lettered as a PHRASE SCORE, not one static word and
   not one word replayed on a timer: overlapping phrases, each a different treatment of the same sound (breath, stretch, split into its
   syllables, shed fragments drifting off, an accent, an echo), the order seeded and never the same treatment twice in a row; a level
   (0..1, live) sets how big, how often and how busy; when the sound stops, the words still up play their exits and a small tail
   trails off. Mode "ambient" is the quiet permanent case (a hissing pipe on a map): one small hollow word now and then, only while its
   spot is in view, at most a few on screen at once for the whole scene, slow and on threes (cheap enough for a whole session).
   Built on play(): every phrase is an ordinary word (same layers, sizes, visibility, reduced motion, limits, clean-up). */
import { rng, hash } from "./rng.mjs";
import { AMBIENT_MAX } from "./sustain.mjs";
const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5);
/* the treatments of one phrase (README); ambient uses only the quiet ones */
const LIVE = ["breath", "stretch", "split", "shed", "accent", "echo"];
const QUIET = ["breath", "stretch", "shed"];
/* MOTION2 (SPEC-MOTION 5.9): in the invincible style the phrases follow the sound's flow style (words.mjs FLOW), not one pool for every
   kind: a steady sound never accents or slams, a cycle is always split on its beat, a crackle pops; each phrase moves by the kind's own
   row of the motion table (motion.mjs) instead of random entrances, holds and exits */
const TREAT_BY_FLOW = { steady: ["breath", "stretch"], drone: ["breath", "stretch", "echo"], crackle: ["breath", "shed", "accent", "split"],
  gust: ["breath", "stretch", "shed"], cycle: ["split"], mix: LIVE };

/* E: { play, now, streams, vocab(), pointOf(space, at), inView(space, p, pad), syllablesOf } from the engine */
export function makeSustainLegacy(E, ambientUp) {
  return function sustain(o0 = {}) {
    const o = { ...(o0 && typeof o0 === "object" ? o0 : {}) };
    const space = o.space === "world" ? "world" : "screen";
    const ambient = o.mode === "ambient";
    const seed = o.seed ?? `u${(Math.random() * 1e9) | 0}`;
    const R = rng(hash(`${seed}:sustain`));
    const reduced = !!(o.reduced ?? (() => { try { return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })());
    let level = clamp01(typeof o.level === "number" ? o.level : ambient ? 0.2 : 0.6);
    /* ENGVIEW (1.9.18): `startAt` (this page's performance.now() of the event's start) puts a live run on the event's clock, as the
       invincible run does since 1.9.15: every phrase's choices are drawn from the seed at its own instant (clockedPhrase below), so a seat
       that joins late skips the phrases already over and joins the current one mid-life. Without `startAt` the run is the 1.9.14 one. */
    const T_ = Number.isFinite(o.startAt) && !ambient && o.startAt <= E.now() + 60000 ? o.startAt : undefined;
    const clocked = T_ !== undefined;
    const lv = (T = E.now()) => { if ( typeof o.level === "function" ) { try { return clamp01(o.level(T - t0)); } catch { return level; } } return level; };
    const handles = [], timers = new Set(), history = [];
    let cur = null, alive = true, k = 0, hand = null, last = null, lastKind = null, done, phrases = 0;
    const t0 = clocked ? T_ : E.now();
    const inv = E.styleOf?.(o) === "invincible";
    const finished = new Promise((r) => (done = r));
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if ( alive ) fn(); }, Math.max(0, ms)); timers.add(id); };
    const track = (h) => {
      if ( !h ) return h;
      handles.push(h);
      h.finished.then(() => { const j = handles.indexOf(h); if ( j >= 0 ) handles.splice(j, 1); ambientUp[space].delete(h); if ( !alive && !handles.length ) done("done"); });
      return h;
    };
    /* the unit of spacing: a grid square (world) or 4 % of the screen height */
    const U = () => (space === "world" ? (globalThis.canvas?.grid?.size ?? 100) * 0.5 : (Number.isFinite(o.view?.vh) && o.view.vh >= 200 ? o.view.vh : globalThis.innerHeight ?? 800) * 0.04) * (Number.isFinite(o.spread) ? o.spread : 1);
    const src = () => { const p = E.pointOf(space, o.at); if ( p ) last = p; return p; };
    const near = (dx, dy) => () => { const p = src() ?? last; return p ? { x: p.x + dx, y: p.y + dy } : null; };
    /* the drift of shed fragments: rising for fire, hiss, steam, hum (default), along `dir` (degrees) when given */
    const drift = (Number.isFinite(o.dir) ? o.dir : -90) * Math.PI / 180;

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
    const textAt = (i, L, extra, T = E.now()) => {
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
    const common = () => ({
      space, layer: o.layer, zIndex: o.zIndex, token: o.token, vision: o.vision, elevation: o.elevation, colors: o.colors, pixel: o.pixel,
      fit: o.fit, size: o.size, span: o.span, area: o.area, reduced: o.reduced, keepInView: o.keepInView, pushable: o.pushable, glow: o.glow,
      on: ambient ? 3 : o.on, fps: ambient ? undefined : o.fps, hand: hand ?? o.hand ?? undefined, mood: o.mood,
      /* ENGVIEW: a caller's view and ceiling share reach every phrase (nothing changes for a call without them) */
      ...(o.view ? { view: o.view } : {}), ...(o.ceil != null ? { ceil: o.ceil } : {})
    });
    /* orbit / path: each phrase rides it, joining where the sound is now on the ring (as a stream's syllables do) */
    const travel = (T = E.now()) => {
      if ( o.orbit ) {
        const ob = o.orbit, period = Math.max(300, ob.period ?? 2600), dir = ob.dir < 0 ? -1 : 1;
        return { orbit: { ...ob, center: ob.center ?? o.at, phase: (Number.isFinite(ob.phase) ? ob.phase : -90) + (dir * 360 * (T - t0)) / period } };
      }
      if ( o.path ) return { path: o.path };
      return null;
    };
    const magOf = (L, k = 1) => (Number.isFinite(o.magnitude) ? o.magnitude : 0.12 + 0.7 * L) * k;

    function phrase() {
      const p0 = src();
      if ( !p0 && !last ) { stop(); return; }                                       // the source is gone
      const L = lv(), i = k;
      if ( ambient ) {
        /* quiet and permanent: only when its spot is in view and the scene's ambient budget has room; otherwise look again later */
        const busy = ambientUp[space].size >= (o.max ?? AMBIENT_MAX[space]);
        if ( busy || !E.inView(space, p0 ?? last, U() * 2) ) { later(phrase, R.f(900, 2200)); return; }
      }
      k++; phrases++;
      /* the treatment: seeded, never the same twice in a row; loud live sounds may accent, quiet ones never */
      const fstyle = inv ? (flowOf() || null)?.style ?? null : null;
      const allowed = inv && fstyle && TREAT_BY_FLOW[fstyle] ? TREAT_BY_FLOW[fstyle] : null;
      const pool0 = ambient ? QUIET.filter((t) => !allowed || allowed.includes(t) || t === "breath") : (allowed ?? LIVE);
      const okT = (t) => !(t === "accent" && L < 0.45) && !(reduced && (t === "shed" || t === "echo" || t === "split"));
      let pool = pool0.filter((t) => t !== lastKind && okT(t));
      if ( !pool.length && allowed ) pool = pool0.filter(okT);   // a cycle repeats its split
      const kind = i === 0 ? (allowed?.length === 1 && !reduced ? allowed[0] : "breath") : (o.treatments ? R.pick(o.treatments.filter((t) => t !== lastKind)) ?? "breath" : (R.pick(pool) ?? "breath"));
      lastKind = kind;
      const w = textAt(i, L, kind === "stretch" ? 1 + Math.round(2 * L) : 0);
      const side = i % 2 ? 1 : -1, u = U();
      const tr = travel();
      /* two seats, one above the other, taken in turn: the phrase that leaves plays its exit in one while the next one enters in the
         other (live sounds; ambient phrases come one at a time after long gaps) */
      const em = Number.isFinite(cur?.size) && cur.size > 0 ? cur.size : 1.6 * u;   // the height of the words up (their em, px)
      const dy0 = ambient ? -R.f(0.05, 0.45) * u : (i % 2 ? -1.05 : 0.1) * em - R.f(0, 0.12) * u;
      const dx = tr ? 0 : side * R.f(0.1, 0.6) * u, dy = tr ? 0 : dy0;
      const segMs = Number.isFinite(w.ms) && w.ms > 0 ? Math.max(500, Math.min(4000, w.ms)) : null;   // WORD's "current for" time
      const life = ambient ? R.f(1500, 2400) : segMs ? Math.round(segMs * 1.35) : Math.round((1300 + 1100 * (1 - L)) * R.f(0.85, 1.15));
      const base = { ...common(), ...(tr ?? { at: near(dx, dy) }), seed: `${seed}:${i}`, mood: w.mood ?? o.mood ?? w.kmood, hold: life, rotation: side * R.f(1, 6), accent: w.accent };
      if ( inv ) base.kind = o.kind;
      /* MOTION2: invincible phrases keep the kind's motion; only an accent is pinned (a slam) */
      const P = (txt, q) => E.play(txt, inv && kind !== "accent" ? { ...q, in: i === 0 && o.in ? o.in : undefined, holdKind: o.holdKind, out: undefined } : q);
      let h = null;
      switch ( kind ) {
        case "breath":
          h = P(w.text, { ...base, magnitude: magOf(L), in: i === 0 ? (o.in ?? (ambient ? "rise" : "grow")) : R.pick(["pop", "rise", "grow"]), holdKind: o.holdKind ?? R.pick(["boil", "wobble", "throb"]), out: R.pick(["dissolve", "rise"]), tempo: ambient ? 0.7 : 1, hollow: ambient ? (o.hollow ?? true) : o.hollow });
          break;
        case "stretch":
          h = P(w.text, { ...base, magnitude: magOf(L, 1.1), in: "grow", holdKind: "throb", out: ambient ? "dissolve" : R.pick(["dissolve", "shrink"]), tempo: ambient ? 0.7 : 0.9, hollow: ambient ? (o.hollow ?? true) : o.hollow });
          break;
        case "split":
          h = P(w.text, { ...base, magnitude: magOf(L), parts: "syllables", beat: Math.round(130 + 120 * (1 - L)), holdKind: "boil", out: "dissolve" });
          break;
        case "accent":
          h = E.play(w.text, { ...base, magnitude: magOf(L, 1.45), in: "slam", holdKind: "shake", out: R.pick(["burst", "pop"]), hold: Math.round(life * 0.7) });
          break;
        case "echo":
          h = P(w.text, { ...base, magnitude: magOf(L), in: "pop", holdKind: "boil", out: "dissolve", echo: { n: 2, dir: (drift * 180) / Math.PI, every: 160 } });
          break;
        case "shed": {
          /* the word stays small and fragments of it come off and drift away (steam off a pipe, sparks off a fire) */
          h = P(w.text, { ...base, magnitude: magOf(L, 0.85), in: "pop", holdKind: "boil", out: "dissolve", tempo: ambient ? 0.7 : 1, hollow: ambient ? (o.hollow ?? true) : o.hollow });
          const syl = E.syllablesOf(w.text), n = ambient ? 1 : 1 + Math.round(2 * L);
          for ( let j = 0; j < n; j++ ) later(() => shed(syl[Math.min(syl.length - 1, j % syl.length)] ?? w.text, dx, dy, j, L), life * (0.2 + 0.22 * j));
          break;
        }
      }
      history.push({ kind, text: w.text }); if ( history.length > 32 ) history.shift();   // the last phrases (tests, the designer)
      /* the phrase before leaves as this one comes (its exit plays under the new entrance: a cross-fade, never a pile of words) */
      if ( cur?.alive && cur !== h ) cur.stop();
      cur = h;
      if ( h ) { track(h); if ( ambient ) ambientUp[space].add(h); if ( !hand && h.plan ) hand = h.plan.hand; }
      /* the next phrase overlaps this one (live: the sound never stops while it lasts) or comes after a quiet gap (ambient) */
      const gap = ambient ? R.f(o.gap?.[0] ?? 4500, o.gap?.[1] ?? 11000) : (segMs ?? life * R.f(0.55, 0.8) / (0.75 + 0.5 * L)) * (reduced ? 1.6 : 1);
      later(phrase, gap);
    }
    /* ENGVIEW: the clocked run (startAt). Every seeded choice of phrase i is drawn at its instant T, in one fixed order, so a seat that
       skips phrases (joining late) draws the same choices for the ones it shows; the seat's spacing is the phrase's own size (`size`, else
       1.6 units), never the size of a word this seat happened to have up. */
    function decideC(i, T) {
      const L = lv(T);
      const fstyle = inv ? (flowOf() || null)?.style ?? null : null;
      const allowed = inv && fstyle && TREAT_BY_FLOW[fstyle] ? TREAT_BY_FLOW[fstyle] : null;
      const pool0 = allowed ?? LIVE;
      const okT = (t) => !(t === "accent" && L < 0.45) && !(reduced && (t === "shed" || t === "echo" || t === "split"));
      let pool = pool0.filter((t) => t !== lastKind && okT(t));
      if ( !pool.length && allowed ) pool = pool0.filter(okT);
      const kind = i === 0 ? (allowed?.length === 1 && !reduced ? allowed[0] : "breath") : (o.treatments ? R.pick(o.treatments.filter((t) => t !== lastKind)) ?? "breath" : (R.pick(pool) ?? "breath"));
      lastKind = kind;
      const w = textAt(i, L, kind === "stretch" ? 1 + Math.round(2 * L) : 0, T);
      const side = i % 2 ? 1 : -1, u = U(), em = Number.isFinite(o.size) && o.size > 0 ? o.size : 1.6 * u;
      const dyR = R.f(0, 0.12), dxR = R.f(0.1, 0.6);
      const segMs = Number.isFinite(w.ms) && w.ms > 0 ? Math.max(500, Math.min(4000, w.ms)) : null;
      const life = segMs ? Math.round(segMs * 1.35) : Math.round((1300 + 1100 * (1 - L)) * R.f(0.85, 1.15));
      const rot = side * R.f(1, 6);
      const pick = { in: R.pick(["pop", "rise", "grow"]), hold: R.pick(["boil", "wobble", "throb"]), out: R.pick(["dissolve", "rise"]), out2: R.pick(["dissolve", "shrink"]), out3: R.pick(["burst", "pop"]) };
      const nShed = kind === "shed" ? 1 + Math.round(2 * L) : 0;
      const sheds = Array.from({ length: 3 }, () => ({ a: drift + R.f(-0.45, 0.45), d: u * R.f(2.2, 3.4) })).slice(0, nShed);
      const gap = (segMs ?? life * R.f(0.55, 0.8) / (0.75 + 0.5 * L)) * (reduced ? 1.6 : 1);
      return { i, T, L, kind, w, side, u, dx: side * dxR * u, dy: (i % 2 ? -1.05 : 0.1) * em - dyR * u, life, rot, pick, sheds, gap };
    }
    function playC(d) {
      const { i, L, kind, w, life, pick } = d;
      const tr = travel(d.T), dx = tr ? 0 : d.dx, dy = tr ? 0 : d.dy;
      const base = { ...common(), ...(tr ?? { at: near(dx, dy) }), seed: `${seed}:${i}`, mood: w.mood ?? o.mood ?? w.kmood, hold: life, rotation: d.rot, accent: w.accent, startAt: d.T };
      if ( inv ) base.kind = o.kind;
      const P = (txt, q) => E.play(txt, inv && kind !== "accent" ? { ...q, in: i === 0 && o.in ? o.in : undefined, holdKind: o.holdKind, out: undefined } : q);
      let h = null;
      switch ( kind ) {
        case "breath": h = P(w.text, { ...base, magnitude: magOf(L), in: i === 0 ? (o.in ?? "grow") : pick.in, holdKind: o.holdKind ?? pick.hold, out: pick.out, tempo: 1, hollow: o.hollow }); break;
        case "stretch": h = P(w.text, { ...base, magnitude: magOf(L, 1.1), in: "grow", holdKind: "throb", out: pick.out2, tempo: 0.9, hollow: o.hollow }); break;
        case "split": h = P(w.text, { ...base, magnitude: magOf(L), parts: "syllables", beat: Math.round(130 + 120 * (1 - L)), holdKind: "boil", out: "dissolve" }); break;
        case "accent": h = E.play(w.text, { ...base, magnitude: magOf(L, 1.45), in: "slam", holdKind: "shake", out: pick.out3, hold: Math.round(life * 0.7) }); break;
        case "echo": h = P(w.text, { ...base, magnitude: magOf(L), in: "pop", holdKind: "boil", out: "dissolve", echo: { n: 2, dir: (drift * 180) / Math.PI, every: 160 } }); break;
        case "shed": {
          h = P(w.text, { ...base, magnitude: magOf(L, 0.85), in: "pop", holdKind: "boil", out: "dissolve", tempo: 1, hollow: o.hollow });
          const syl = E.syllablesOf(w.text);
          d.sheds.forEach((q, j) => later(() => {
            const t = String(syl[Math.min(syl.length - 1, j % syl.length)] ?? w.text).replace(/[-!?.]+$/g, "") || String(w.text);
            track(E.play(t, { ...common(), seed: `${seed}:shed${i}:${j}`, path: { from: near(dx, dy), to: near(dx + Math.cos(q.a) * q.d, dy + Math.sin(q.a) * q.d), duration: 900, ease: "out", orient: "none" },
              magnitude: magOf(L, 0.45), scale: 0.7, in: "pop", holdKind: "boil", out: "dissolve", hold: 600, startAt: d.T + life * (0.2 + 0.22 * j) }));
          }, d.T + life * (0.2 + 0.22 * j) - E.now()));
          break;
        }
      }
      history.push({ kind, text: w.text }); if ( history.length > 32 ) history.shift();
      if ( cur?.alive && cur !== h ) cur.stop();
      cur = h;
      if ( h ) { track(h); if ( !hand && h.plan ) hand = h.plan.hand; }
    }
    function phraseC(T) {
      if ( !src() && !last ) { stop(); return; }
      const d = decideC(k, T);
      k++; phrases++;
      playC(d);
      later(() => phraseC(T + d.gap), T + d.gap - E.now());
    }
    function shed(text, dx, dy, j, L) {
      const u = U(), a = drift + R.f(-0.45, 0.45), d = u * R.f(2.2, 3.4);
      const t = String(text).replace(/[-!?.]+$/g, "") || String(text);
      track(E.play(t, { ...common(), seed: `${seed}:shed${k}:${j}`, path: { from: near(dx, dy), to: near(dx + Math.cos(a) * d, dy + Math.sin(a) * d), duration: 900, ease: "out", orient: "none" },
        magnitude: magOf(L, 0.45), scale: 0.7, in: "pop", holdKind: "boil", out: "dissolve", hold: 600, hollow: ambient ? (o.hollow ?? true) : undefined }));
    }
    /* the end: the words up play their exits; a live sound leaves a small tail trailing off along its drift */
    function stop(q = {}) {
      if ( !alive ) return;
      alive = false; E.streams.delete(s);
      for ( const id of timers ) clearTimeout(id);
      timers.clear();
      if ( q.quick ) for ( const h of [...handles] ) h.stop({ quick: true });
      else {
        for ( const h of [...handles] ) h.stop();
        if ( !ambient && !reduced && phrases > 0 && (src() ?? last) ) {
          const F = flowOf(), tail = F ? seg(F.tail) : null, u = U();
          if ( tail ) shedTail(tail.text, u, true);
          else { const syl = E.syllablesOf(textAt(k, lv(), 0).text); shedTail(syl.at(-1) ?? "S", u); }
        }
      }
      if ( !handles.length ) done(q.quick ? "stopped" : "done");
    }
    function shedTail(t, u, given = false) {
      const p = last; if ( !p ) return;
      const a = drift, d = u * 2.6;
      const h = E.play(given ? String(t) : `${String(t).replace(/[-!?.]+$/g, "")}...`, { ...common(), at: undefined, seed: `${seed}:tail`, path: { from: { x: p.x, y: p.y - u * 0.3 }, to: { x: p.x + Math.cos(a) * d, y: p.y - u * 0.3 + Math.sin(a) * d }, duration: 1100, ease: "out", orient: "none" },
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
    if ( clocked ) {
      /* ENGVIEW: on the event's clock: the phrases whose time is over are decided (the same seeded choices) but not drawn */
      let T = t0 + startIn, replay = null;
      const nowT = E.now();
      for ( let guard = 0; guard < 10000; guard++ ) {
        const d = decideC(k, T);
        if ( T + d.gap + 450 >= nowT ) { replay = d; break; }   // still up (or to come): drawn, joining its own timeline
        k++; T += d.gap;
      }
      if ( replay ) {
        const d = replay;
        later(() => { if ( !alive ) return; k++; phrases++; playC(d); later(() => phraseC(d.T + d.gap), d.T + d.gap - E.now()); }, d.T - E.now());
      }
    }
    /* ambient sources start spread out (many pipes on one map do not all hiss at once) */
    else later(phrase, ambient ? startIn + R.f(0, o.gap?.[1] ?? 6000) : startIn);
    try { if ( o.until && typeof o.until.then === "function" ) o.until.then(() => stop(), () => stop()); } catch {}
    return s;
  };
}
