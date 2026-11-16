/**
 * MAPPLAN: a page's table picture and a seat's layout of it, made in SLICES (pure: the clock, the idle moments and the timers are the
 * caller's; no Foundry, no DOM).
 *
 * Live 2026-11-16 (MAPCOST): each bomb of a volley cost every seat a timer task of 44-75 ms - its whole page planned at its first word
 * (about eleven fresh engine settles, two measures a word, the main word's side) -, then 13-16 ms of seat layout: 3-5 frames over 50 ms a
 * volley with lettering on, 0-2 with it off. The work is the same; it now runs as UNITS of a few ms (sfx-table pagePlanner: a word, the
 * main word's side, a word's size step; sfx-seat seatLayouter: one word's place), a slice at a time between frames, the words due first
 * planned first. What the table shows does not change:
 *   - the picture starts at the instant it started before (the page's first word, or the idle moment before it), from what every seat
 *     shares AS IT STOOD THEN (frozenDeps: the clock's offset, the size steps, the shared tokens and pins), the pictures in the order
 *     their pages began, and is finished before anything else WRITES the ledger (settle); a READER gets the ledger as the whole
 *     picture will leave it for the time it asks about (read) - sfx.mjs wraps its ledger in both: the same picture as planned at once;
 *   - a word is asked for when it was before (140 ms ahead of its instant); what it needs is finished at once when the slices would
 *     not make it in time (PLAN_GUARD and what is left of it, measured), so no word starts later than it did;
 *   - the seat layout lays a page's words out in the order it always did, from ONE reading of the seat's view, panels, pins, tokens and
 *     words up (`snap`) - the first words of a page as soon as they are planned, the rest when they come; a page whose words do not come
 *     in the layout's order is laid out whole, as before.
 * dev/sfx-plan.test.mjs: the same tables, ledgers and layouts as planned at once, whatever the slices and whoever reads the ledger
 * between them; every word on time on a virtual clock.
 */
import * as T from "./sfx-table.mjs";
import * as SEAT from "./sfx-seat.mjs";

export const SLICE_MS = 8;        // a slice stops before a unit that would take it past this (ms; a unit is 2-8 ms)
export const SLICE_WAIT = 32;     // the longest a slice waits for an idle moment (ms) ...
export const SLICE_URGENT = 8;    // ... while a picture is still planned or a word of it is due soon
export const PLAN_GUARD = 16;     // what a word needs is ready this long before its instant (plus what is left of it, measured), else at once
export const UNIT_MS = 6;         // a unit's cost before any was measured (ms)
export const LEDGER_MAX = 200;    // sfx-seat makeLedger's own length

/** The deps a picture planned over several slices reads: `base` (sfx-table's deps) with the clock's offset, the size steps, the shared
    tokens and pins AS THEY STAND NOW (tokens / pins: every one of the scene, cut to a view on each call as the live lists were), and the
    ledger itself (`ledger`: not the caller's settling wrapper). */
export function frozenDeps(base, { ledger, off, steps, tokens = [], pins = [] }) {
  const near = (list, v) => (v ? list.filter((b) => !(b.x1 < v.x0 || b.x0 > v.x1 || b.y1 < v.y0 || b.y0 > v.y1)) : list.slice());
  const st = steps instanceof Map ? steps : new Map(Object.entries(steps ?? {}));
  return { ...base, ledger, toPerf: (t) => t + off, step: (g) => (st.has(g) ? st.get(g) : base.step(g)), tokens: (v) => near(tokens, v), pins: (v) => near(pins, v) };
}

/**
 * env: { ledger (sfx-seat makeLedger: the table's own, not the caller's settling wrapper), now() (ms), idle(fn, timeoutMs) (calls fn(deadline | null) in an idle moment, at the latest timeoutMs from now), timer(key, ms,
 *        fn), untimer(key), deps() -> the frozen deps of a job begun now, snap(grp) -> { key, ctx (seatLayouter's: view, panels, pins,
 *        tokens, zoom, up), d (sfx-table deps), seat (seatItem's: vw, vh, zoom, scale) } this seat as it stands now, stats ({ planN,
 *        planMs, planMax, sliceMax, planForced, planForcedMax, planPeek, planPeekMax, seatMs, seatN, seatMax }), warn(msg, err) }
 */
export function makePlans(env) {
  const jobs = new Map(), stats = env.stats ?? {};
  let pumpOn = false, settling = false, unitMs = UNIT_MS;
  const bump = (k, v) => { stats[k] = (stats[k] ?? 0) + v; };
  const peak = (k, v) => { stats[k] = Math.max(stats[k] ?? 0, v); };

  /** the job of a page whose table picture is not whole yet (made on first need; null: the picture is whole) */
  function job(p) {
    if ( p.table ) return null;
    if ( p.job ) return p.job;
    // (the pictures in flight come first - `open`: this page is planned against their whole pictures, as before; its own deps are read now)
    const d = env.deps();
    const j = { p, d, pl: T.pagePlanner(p, d), idx: new Map(p.pg.words.map((w, i) => [w.key, i])), ts: p.pg.words.map((w) => (Number.isFinite(w.t) ? d.toPerf(w.t) : Infinity)), grown: 0, at: [], want: -1, waits: [] };
    // (the page's located words are one picture: a seat lays them out together - sfx-seat seatLayout: each keeps its side of what it
    // letters, none onto another; the group fills as the words are planned, in page order)
    p.group = { words: [], page: true, job: j };
    p.job = j; jobs.set(p, j);
    tableDone(j);
    return j;
  }
  /** the table picture of a job is whole: every word in its group, the page holds its table */
  function tableDone(j) {
    if ( !j.pl.done || j.p.table ) return;
    while ( growOne(j) ) { /* the rest of the group */ }
    j.p.table = j.pl.table;
  }
  /** the next word the table holds so far into the page's group, drawn at its step first (pagePlanner early) -> was there one? */
  function growOne(j) {
    if ( j.grown >= j.pl.table.size ) return false;
    let i = 0, e = null;
    for ( const q of j.pl.table ) if ( i++ === j.grown ) { e = q; break; }
    j.grown++;
    const [key, q] = e, grp = j.p.group;
    if ( q && !q.dropped && !q.screenAt && !q.stream && Number.isFinite(q.x) && Number.isFinite(q.y) ) {
      j.pl.early(q);
      q.group = grp; grp.words.push(q); j.at.push(j.idx.get(key) ?? j.at.length);
    }
    return true;
  }
  /** has the job planned page word `k` (and every word before it), each in the group at its step? */
  const has = (j, k) => !!j.p.table || (j.pl.planned > k && j.grown >= j.pl.table.size);
  /** one unit of a job: toward the word wanted first (the table up to it, its group, this seat's layout up to it), then the rest of the
      table, then the rest of the layout -> is more left? */
  function unit(j) {
    const pl = j.pl, k = Math.min(j.want, pl.words.length - 1);
    // (the tables in the order their pages began: an older picture still in flight is finished first)
    const f = pl.done ? null : open(j);
    if ( f ) { f.pl.step(); tableDone(f); return true; }
    if ( !pl.done && pl.planned <= k ) { pl.step(); tableDone(j); return true; }
    if ( growOne(j) ) return true;
    if ( k >= 0 && layOne(j, k) ) return true;
    if ( !pl.done ) { pl.step(); tableDone(j); return true; }
    return layOne(j, Infinity);
  }
  function runUnit(j) {
    const t0 = env.now();
    let more = false;
    try { more = unit(j); } catch ( err ) { env.warn?.("a page's planning failed", err); more = false; }
    const ms = env.now() - t0;
    unitMs += (Math.min(40, ms) - unitMs) * 0.2;
    bump("planN", 1); bump("planMs", ms); peak("planMax", ms);
    if ( !more ) { jobs.delete(j.p); if ( j.p.table ) j.p.job = null; }
    return more;
  }
  /** the oldest job before `j` whose table is not whole yet (null: none) */
  function open(j) {
    for ( const q of jobs.values() ) { if ( q === j ) return null; if ( !q.p.table ) return q; }
    return null;
  }
  /** the table pictures in flight, each finished at once, oldest first (before a writer of the ledger, or a reader it cannot answer) */
  function settle() {
    if ( !jobs.size || settling ) return;
    settling = true;
    try { for ( const j of jobs.values() ) settleOne(j); } finally { settling = false; }
  }
  function settleOne(j) {
    if ( j.p.table ) return;
    const t0 = env.now();
    try { while ( j.pl.step() ) { /* every unit left */ } } catch ( err ) { env.warn?.("a page's planning failed", err); j.pl.done = true; }
    tableDone(j);
    bump("planForced", 1); peak("planForcedMax", env.now() - t0);
  }
  /** one job's table at once (the older pictures in flight first) */
  function settleJob(j) {
    for ( const q of jobs.values() ) { if ( q === j ) break; settleOne(q); }
    settleOne(j);
  }
  /**
   * A READER of the ledger's words up during [t0, t1) (`fn(ledger)` reads it: boxes / count), while a picture is in flight. A page word
   * not planned yet starts at its own moment or later, so one whose moment is t1 or later cannot be up in the window: the picture is
   * planned only up to the last word that can (often two words of nine: a run of fire asks for the next second, a bomb's blast is 1.2 s
   * away), and the reader gets the ledger AS THE WHOLE PICTURE WILL LEAVE IT for that window - the planned words at their step's size
   * (the entries the picture writes at its end), in the same order. Anything it cannot answer exactly (two pictures in flight, a word
   * of the window still to come, a ledger so full that the words to come may push a word of the window out): the pictures at once.
   */
  function read(t0, t1, fn) {
    const raw = env.ledger;
    if ( !jobs.size || settling ) return fn(raw);
    let j = null, n = 0;
    for ( const q of jobs.values() ) if ( !q.p.table ) { j ??= q; n++; }
    if ( !j ) return fn(raw);
    const ws = j.pl.words;
    let k = -1;
    for ( let i = 0; i < ws.length; i++ ) if ( !(ws[i].t >= t1) ) k = i;
    if ( n > 1 || k >= ws.length - 1 || !Number.isFinite(t1) ) { settle(); return fn(raw); }
    const a = env.now(), was = j.pl.planned;
    try { j.pl.upTo(k); while ( growOne(j) ) { /* the planned words at their step */ } } catch ( err ) { env.warn?.("a page's planning failed", err); settle(); return fn(raw); }
    if ( j.pl.planned > was ) { bump("planPeek", 1); peak("planPeekMax", env.now() - a); }
    if ( j.pl.done ) { tableDone(j); return fn(raw); }
    const tmp = SEAT.makeLedger(LEDGER_MAX);
    tmp.list.push(...raw.list);
    for ( const q of j.pl.table.values() ) if ( j.pl.isPlaced(q) ) tmp.add({ key: q.key, page: j.p.rec.id, box: T.lifeBox(q), t0: q.ts, t1: q.ts + T.lifeMs(q), main: q.role === "main" });
    // (the words still to come each add an entry: the oldest entries they may push out of a full ledger must not be of this window)
    const cut = tmp.list.length + (ws.length - j.pl.planned) - LEDGER_MAX;
    if ( cut > 0 && tmp.list.slice(0, cut).some((q) => q.t1 > t0 && q.t0 < t1) ) { settle(); return fn(raw); }
    return fn(tmp);
  }
  /** how long the units still between a job and its page word `k` take, by the units measured so far (ms) - the older pictures in
      flight first */
  const left = (q) => (q.p.table ? 0 : 2 * (q.pl.words.length - q.pl.planned) + 2);
  function est(j, k) {
    if ( has(j, k) ) return 0;
    let u = 2 * Math.max(0, Math.min(k, j.pl.words.length - 1) + 1 - j.pl.planned) + 2;
    for ( const q of jobs.values() ) { if ( q === j ) break; u += left(q); }
    return unitMs * u;
  }

  /* ---- this seat's layout of a page's group, a word at a time */
  function layBegin(grp, s = env.snap(grp)) {
    grp.seatKey = s.key;
    bump("seatN", 1);
    return (grp.lay = { ctx: s.ctx, d: s.d, seat: s.seat, L: SEAT.seatLayouter(s.ctx), n: 0, i: 0, full: false });
  }
  /** the next word of a page group laid out; a page whose words do not come in the layout's order: all of them at once, as before */
  function layAdd(grp) {
    const lay = grp.lay, w = grp.words[lay.n], t0 = env.now();
    lay.n++;
    if ( w && w.text && Number.isFinite(w.x) ) {
      const it = T.seatItem(w, lay.i++, lay.d, lay.seat);
      if ( (it.prio ?? 9) < lay.L.last ) {
        if ( grp.job ) settleJob(grp.job);
        lay.L = { out: SEAT.seatLayout(T.seatItems(grp.words, lay.d, lay.seat), lay.ctx), last: Infinity };
        lay.full = true; lay.n = grp.words.length;
      } else lay.L.add(it);
    }
    const ms = env.now() - t0;
    bump("seatMs", ms); peak("seatMax", ms);
  }
  /** this seat's layout of the next word of a page's group, among those of the page words up to `k` -> did it work? */
  function layOne(j, k) {
    const grp = j.p.group;
    let n = 0;
    while ( n < j.at.length && j.at[n] <= k ) n++;
    if ( !grp.lay ) { if ( !n ) return false; layBegin(grp); return true; }
    if ( grp.lay.full || grp.lay.n >= n ) return false;
    layAdd(grp);
    return true;
  }
  /** a page group's layout for the seat as it stands (`s`: env.snap's reading, made by the caller): begun again when the seat's key
      changed, as the whole layout was; -> { get(key) }: a word's place, laid out now when no slice did it before (with every word before it) */
  function layout(grp, s) {
    if ( !grp.lay || grp.seatKey !== s.key ) layBegin(grp, typeof s.full === "function" ? s.full() : s);
    return (grp.view ??= { get: (key) => {
      const lay = grp.lay, i = grp.words.findIndex((w) => (w.key ?? `${w.seed}|${w.role}`) === key);
      const n = i < 0 ? grp.words.length : i + 1;
      while ( !lay.full && lay.n < n ) layAdd(grp);
      return lay.L.out.get(key);
    } });
  }

  /* ---- the slices */
  /** the next slice: in an idle moment, at the latest SLICE_WAIT (SLICE_URGENT: a picture still planned, a word of it due soon) from now */
  function pump() {
    if ( pumpOn || !jobs.size ) return;
    const now = env.now();
    let urgent = false;
    for ( const j of jobs.values() ) if ( !j.p.table || j.waits.length || j.ts.some((t) => t > now - 20 && t < now + 400) ) urgent = true;
    pumpOn = true;
    env.idle((dl) => { pumpOn = false; slice(dl); }, urgent ? SLICE_URGENT : SLICE_WAIT);
  }
  function slice(dl = null) {
    const t0 = env.now();
    for ( ;; ) {
      // (the job a word waits for first, else the oldest)
      let j = null;
      for ( const q of jobs.values() ) if ( !j || (q.waits.length && !j.waits.length) ) j = q;
      if ( !j ) break;
      runUnit(j);
      for ( const q of new Set([...jobs.values(), j]) ) serve(q);
      const now = env.now();
      // (a word due before another slice could bring what it needs: on, without a break)
      if ( j.waits.some((w) => now + PLAN_GUARD + 1.3 * est(j, w.k) >= w.t) ) continue;
      if ( now - t0 + Math.min(unitMs, 6) > SLICE_MS ) break;
      if ( dl && !dl.didTimeout && !(dl.timeRemaining() > 1) ) break;
    }
    peak("sliceMax", env.now() - t0);
    pump();
  }
  /** the words of a job whose part of the table is planned: on with them */
  function serve(j) {
    if ( !j.waits.length ) return;
    const ready = j.waits.filter((w) => has(j, w.k));
    if ( !ready.length ) return;
    j.waits = j.waits.filter((w) => !ready.includes(w));
    for ( const w of ready ) {
      w.done = true;
      env.untimer?.(w.key);
      try { w.fn(); } catch ( err ) { env.warn?.("a page's word failed", err); }
    }
  }
  /** a word's part of the table at once (the slices did not make it in time, or there was no time for slices) */
  function force(j, w) {
    if ( w.done ) return;
    const t0 = env.now();
    let n = 0;
    j.want = Math.max(j.want, w.k);
    while ( !has(j, w.k) && jobs.has(j.p) && runUnit(j) ) n++;
    if ( n ) { bump("planForced", 1); peak("planForcedMax", env.now() - t0); }
    for ( const q of new Set([...jobs.values(), j]) ) serve(q);
  }
  /**
   * Page word `k` of page `p`, due at `t` (the caller's clock), asked for now: `fn` runs as soon as the table holds the word (and every
   * word before it) - at once when it does already -, at the latest PLAN_GUARD and the measured rest of its part before `t`.
   */
  function ask(p, k, t, fn, key = `pgw|${p.rec?.id}|${k}`) {
    const j = job(p);
    if ( !j || has(j, k) ) { fn(); return; }
    j.want = Math.max(j.want, k);
    const w = { k, t: Number.isFinite(t) ? t : env.now(), fn, done: false, key };
    j.waits.push(w);
    const ms = w.t - PLAN_GUARD - 1.3 * est(j, k) - env.now();
    if ( !(ms > 2) ) { force(j, w); pump(); return; }
    env.timer(key, ms, () => { force(j, w); pump(); });
    pump();
  }
  return { jobs, job, has, settle, settleJob, read, ask, pump, slice, layout, clear: () => jobs.clear(), unitMs: () => unitMs };
}
