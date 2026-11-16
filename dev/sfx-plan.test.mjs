// MAPPLAN: a page's table picture and a seat's layout of it made in SLICES (scripts/sfx/sfx-plan.mjs, sfx-table.mjs pagePlanner,
// sfx-seat.mjs seatLayouter) - the same picture as planned at once, every word on time. Live 2026-11-16 (MAPCOST) each bomb of a volley
// cost every seat one timer task of 44-75 ms (its whole page planned at its first word) and 13-16 ms of seat layout.
// On the real engine in node (scripts/letters/testenv.mjs), the take's scene (The Warehouse, grid 350), the builtin presets' pages.
//   PLANNER  pagePlanner run unit by unit, and with a word asked for early (upTo + early), gives planPage's table and ledger (steps 1-3)
//   LAYOUTER seatLayouter fed a picture's words one by one gives seatLayout's Map; cut after n words: seatLayout's first n places
//   JOB      a job run in slices - any slicing, a word asked for early, the live deps changing meanwhile, another reader or writer of the
//            ledger in between (settled first) - leaves planPage's table, ledger and both seats' layouts; a word read right after its part
//            is planned stands where the whole layout puts it
//   TIME     on a virtual clock: a word asked 140 ms ahead goes on before its instant - with idle moments, with none (timeouts), with no
//            slice at all (the guard), on a slow seat -; a word asked late goes on in the same call, with only its part planned; a slice
//            not due is one unit long past SLICE_MS at most
//   ORDER    the builtin presets' pages come in the layout's order (the sliced layout is the one used), a page that does not is laid out
//            whole, the same places
//   WARM     a moment's words settled ahead (sfx-table warmMoment) leave nothing but the engine's settle memo: the events, the ledger and
//            `recent` untouched, planMoment's picture the same with and without it - and no fresh settle left inside the flush
//   SOURCE   sfx.mjs: every reader and writer of the ledger settles the pictures in flight; a job's deps are frozen at its start; a word
//            is asked for 140 ms ahead and played at the table's instant as before
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const PG = await imp("scripts/sfx/sfx-page.mjs"), T = await imp("scripts/sfx/sfx-table.mjs"), SEAT = await imp("scripts/sfx/sfx-seat.mjs"), PLAN = await imp("scripts/sfx/sfx-plan.mjs");
const { setup } = await imp("scripts/letters/testenv.mjs");
const { sizeFor } = await imp("scripts/letters/size.mjs");
const PC = await imp("scripts/presets/core.mjs"), { BUILTIN } = await imp("scripts/presets/defs.mjs"), FM = await imp("scripts/fire/model.mjs");
const MC = await imp("scripts/presets/meteor-core.mjs"), { fallAt } = await imp("scripts/presets/landing-fx.mjs");
const E = await setup({ gm: true });
const L = E.engine; L.lookStyle("invincible");

let n = 0; const failed = [];
const ok = (c, m) => { if ( c ) { n++; if ( process.env.PLAN_VERBOSE ) console.log("  ok", m); } else failed.push(m); };

const WG = 350, AT = { x: 2555, y: 3885 }, CAM = { x: 2555, y: 3780 }, PIN = { x0: 2111, y0: 3468, x1: 2439, y1: 3879 }, T0 = 1_800_000_000_000;
const TOK = []; for ( let i = 0; i < 14; i++ ) { const x = 1500 + ((i * 733) % 2400), y = 3000 + ((i * 419) % 1500); TOK.push({ x0: x, y0: y, x1: x + WG, y1: y + WG }); }
const near = (list, v) => (v ? list.filter((b) => !(b.x1 < v.x0 || b.x0 > v.x1 || b.y1 < v.y0 || b.y0 > v.y1)) : list.slice());
const panelsOf = (W, H) => [[0, 0, 40, H], [45, 0.27 * H, 140, 0.44 * H], [W - 190, 0, W - 30, 0.16 * H], [W - 30, 0, W, H], [0.13 * W, H - 48, 0.75 * W, H], [W - 330, H - 60, W - 30, H]];
const SEATS = [{ name: "gm", W: 1600, H: 900, z: 0.6 }, { name: "p1", W: 1366, H: 768, z: 0.7314285714285714 }];
const viewOf = (S) => ({ x0: CAM.x - S.W / 2 / S.z, y0: CAM.y - S.H / 2 / S.z, x1: CAM.x + S.W / 2 / S.z, y1: CAM.y + S.H / 2 / S.z });
const UP = [{ box: { x0: 2900, y0: 3300, x1: 3300, y1: 3450 }, life: [T0 - 500, T0 + 2500] }];
const ctxOf = (S) => { const view = viewOf(S); return { view, panels: panelsOf(S.W, S.H).map((r) => ({ x0: view.x0 + r[0] / S.z, y0: view.y0 + r[1] / S.z, x1: view.x0 + r[2] / S.z, y1: view.y0 + r[3] / S.z })), pins: [PIN], tokens: near(TOK, view), zoom: S.z, up: UP }; };
const seatOf = (S) => ({ vw: S.W, vh: S.H, zoom: S.z, scale: 1 });

/** the page of a builtin preset fired at AT (as dev/sfx-same.test.mjs builds the bomb's) */
function pageOf(preset, seed, at = AT, t0 = T0) {
  const ENV = { grid: WG, rect: { x: 0, y: 0, width: 7000, height: 7000 }, now: t0, wind: { dir: 0, speed: 0.4 } };
  const def = BUILTIN.find((q) => q.id === preset), plan = PC.expand(def, { a: [at.x, at.y], b: [at.x + 900, at.y - 500] }, { seed, aftermath: 6 }, ENV), strokes = new Map(), f = [];
  const b0 = plan.pending.burst?.[0];
  for ( const r of plan.fire ) {
    const rec = { ...r };
    if ( b0 && /^debris\./.test(rec.key ?? "") ) { const dd = Math.hypot(rec.p[0] - b0.x, rec.p[1] - b0.y), j = (FM.hash4(plan.seed, dd | 0, 3) - 0.5) * 160;
      const q = Math.round(plan.t0 + (b0.at ?? 0) + Math.min(1600, 280 + 520 * Math.sqrt(dd / WG) + j)), dq = q - rec.q; rec.q = q; if ( rec.o !== undefined ) rec.o += dq; }
    const st = { id: `f-${rec.key}`, ...rec }; strokes.set(st.id, st); f.push({ id: st.id, key: rec.key });
  }
  const debris = plan.fire.filter((r) => /^debris\./.test(r.key ?? ""));
  for ( const b of plan.pending.burst ?? [] ) { const q = Math.round(plan.t0 + (b.at ?? 0));
    const db = debris.filter((r) => r.q >= q).map((r) => [r.p[0] - b.x, r.p[1] - b.y, r.q - q]).flat();
    const st = { id: `f-burst.${b.id}`, k: "burst", p: [b.x, b.y], r: b.r, lv: b.lv, q, wd: 0, ws: 0.4, ...(db.length ? { db } : {}) }; strokes.set(st.id, st); f.push({ id: st.id, key: `burst.${b.id}` }); }
  const rec = { id: `fid-${preset}-${seed}-${Math.round(at.x)}`, preset, t0: plan.t0, seed: plan.seed, size: plan.size, power: plan.power, at: plan.at, dir: plan.dir, gesture: plan.gesture, walk: plan.walk,
    d: plan.destruction.map((r, i) => ({ id: `d${i}`, key: r.key, at: Math.round(plan.t0 + (r.at ?? 0)) })), f, pending: { ...plan.pending, burst: [] } };
  return { rec, pg: PG.firingPage(rec, { grid: WG, strokes, wayOf: MC.wayOf, headAt: MC.headAt, fallAt, lift: 0.5 }), ground: "stone" };
}
const PRESETS = [];
for ( const q of BUILTIN ) { try { const p = pageOf(q.id, 777); if ( (p.pg?.words?.length ?? 0) > 1 ) PRESETS.push(q.id); } catch { /* a preset without a page here */ } }

/** a world: its ledger and the live values its deps read (a test changes them under a job in flight) */
function world(step = 2) {
  const live = { step, off: 0, tok: TOK, pins: [PIN] };
  const ledger = SEAT.makeLedger(), memo = new Map();
  const base = () => ({ L, sizeFor, grid: WG, sceneId: "vL4Lqhd60r7UHjPT", lang: "en", known: null, ledger, toPerf: (t) => t + live.off, toShared: (t) => t - live.off, layer: { layer: "overlay" },
    step: () => live.step, memo, tokens: (v) => near(live.tok, v), pins: (v) => near(live.pins, v), warn: (m, e) => { throw e ?? new Error(m); } });
  return { live, ledger, base };
}
const located = (tb) => [...tb.values()].filter((q) => q && !q.dropped && !q.screenAt && !q.stream && Number.isFinite(q.x) && Number.isFinite(q.y));
const strip = (k, v) => (k === "group" ? undefined : v);
const sigT = (tb) => JSON.stringify([...tb], strip), sigL = (l) => JSON.stringify(l.list, strip), sigM = (m) => JSON.stringify([...m]);
/** a page already on the table when the page under test is planned (the same in every world) */
const before = (W) => T.planPage(pageOf("bomb", 5, { x: AT.x + 700, y: AT.y - 250 }, T0 - 400), W.base());
/** the page planned AT ONCE, and each seat's whole layout of it */
function atOnce(preset, seed, step) {
  const W = world(step); before(W);
  const p = pageOf(preset, seed), tb = T.planPage(p, W.base());
  const lays = SEATS.map((S) => SEAT.seatLayout(T.seatItems(located(tb), W.base(), seatOf(S)), ctxOf(S)));
  return { W, p, tb, lays, table: sigT(tb), ledger: sigL(W.ledger) };
}

/* ---------------------------------------------------------------- PLANNER */
{
  let same = 0, early = 0, runs = 0, units = 0;
  for ( const preset of PRESETS ) for ( const seed of [777, 12, 4051] ) for ( const step of [1, 2, 3] ) {
    const A = atOnce(preset, seed, step);
    runs++;
    { const W = world(step); before(W); const pl = T.pagePlanner(pageOf(preset, seed), W.base()); let u = 0; while ( pl.step() ) u++; units += u;
      if ( pl.done && sigT(pl.table) === A.table && sigL(W.ledger) === A.ledger && u >= pl.words.length ) same++; }
    { const W = world(step); before(W); const pl = T.pagePlanner(pageOf(preset, seed), W.base()), k = Math.min(1, pl.words.length - 1);
      pl.upTo(k);
      const got = pl.planned > k && pl.planned < pl.words.length + (k === pl.words.length - 1 ? 1 : 0);
      for ( const q of pl.table.values() ) pl.early(q);
      const first = JSON.stringify([...pl.table], strip);
      while ( pl.step() ) { /* the rest */ }
      // (a word drawn at its step early is not changed by the rest of the page)
      const kept = JSON.stringify([...pl.table].slice(0, JSON.parse(first).length), strip) === first;
      if ( got && kept && sigT(pl.table) === A.table && sigL(W.ledger) === A.ledger ) early++; }
  }
  ok(runs >= 18 && same === runs, `PLANNER unit by unit: planPage's table and ledger (${same}/${runs} pages of ${PRESETS.join(", ")} at steps 1-3; ${(units / runs).toFixed(1)} units a page)`);
  ok(early === runs, `PLANNER a word asked for early (upTo, early): planned before the rest, unchanged by the rest, the page's table and ledger as at once (${early}/${runs})`);
}

/* ---------------------------------------------------------------- LAYOUTER */
{
  let whole = 0, cut = 0, runs = 0;
  for ( const preset of PRESETS ) for ( const step of [1, 2, 3] ) {
    const A = atOnce(preset, 777, step), ws = located(A.tb);
    for ( const [si, S] of SEATS.entries() ) {
      runs++;
      const items = T.seatItems(ws, A.W.base(), seatOf(S)).sort((a, b) => a.prio - b.prio), lay = SEAT.seatLayouter(ctxOf(S));
      let good = true;
      for ( const [i, it] of items.entries() ) {
        lay.add(it);
        // (the first i + 1 places are the whole layout's)
        const full = [...A.lays[si]].filter(([k]) => items.slice(0, i + 1).some((q) => q.key === k));
        if ( JSON.stringify([...lay.out].sort()) !== JSON.stringify(full.sort()) ) good = false;
      }
      if ( good ) cut++;
      if ( sigM(new Map([...lay.out].sort())) === sigM(new Map([...A.lays[si]].sort())) && lay.n === items.length ) whole++;
    }
  }
  ok(runs >= 12 && whole === runs, `LAYOUTER a picture's words added one by one: seatLayout's places (${whole}/${runs} seat layouts)`);
  ok(cut === runs, `LAYOUTER cut after any n words: the whole layout's first n places (${cut}/${runs})`);
  const lay0 = SEAT.seatLayouter({});
  ok(lay0.add({ key: "a", u: 10, box: { x0: 0, y0: 0, x1: 1, y1: 1 }, prio: 0 })?.cap === 10 && lay0.out.size === 1, "LAYOUTER without a view: the table's place, as seatLayout");
}

/* ---------------------------------------------------------------- the virtual seat of a job */
function rig(W, { cost = 0, S = SEATS[0] } = {}) {
  const st = { now: 1000, timers: new Map(), idles: [], stats: {}, S };
  const env = {
    now: () => st.now,
    idle: (fn, ms) => st.idles.push({ fn, by: st.now + ms }),
    timer: (key, ms, fn) => st.timers.set(key, { at: st.now + Math.max(0, ms), fn }),
    untimer: (key) => st.timers.delete(key),
    deps: () => { const b = W.base(), d = PLAN.frozenDeps(b, { ledger: W.ledger, off: W.live.off, steps: new Map([["destruction", W.live.step], ["fire", W.live.step], ["weather", W.live.step]]), tokens: W.live.tok.slice(), pins: W.live.pins.slice() });
      // (a word's unit takes `cost` ms of the virtual clock)
      const word = L.word.bind(L); return { ...d, step: () => d.step("destruction"), L: new Proxy(L, { get: (o, k) => (k === "word" ? (...a) => { st.now += cost; return word(...a); } : typeof o[k] === "function" ? o[k].bind(o) : o[k]) }) }; },
    snap: () => ({ key: st.S.name, ctx: ctxOf(st.S), d: W.base(), seat: seatOf(st.S) }),
    stats: st.stats, warn: (m, e) => { throw e ?? new Error(m); }
  };
  st.plans = PLAN.makePlans(env);
  /** the clock on to `to`: the timers due, and the slices `idleAt(now)` allows ("idle" | "timeout" | null: none) */
  st.run = (to, idleAt = () => "idle", tick = 2) => {
    for ( ; st.now <= to; st.now += tick ) {
      for ( const [k, t] of [...st.timers] ) if ( t.at <= st.now ) { st.timers.delete(k); t.fn(); }
      const due = st.idles.splice(0);
      for ( const i of due ) {
        const mode = idleAt(st.now);
        if ( mode === "idle" ) { const end = st.now + 6; i.fn({ didTimeout: false, timeRemaining: () => Math.max(0, end - st.now) }); }
        else if ( mode === "timeout" && i.by <= st.now ) i.fn({ didTimeout: true, timeRemaining: () => 0 });
        else st.idles.push(i);
      }
    }
  };
  return st;
}

/* ---------------------------------------------------------------- JOB */
{
  let runs = 0, table = 0, ledgers = 0, lays = 0, prefix = 0, blind = 0, froze = 0, sliced = 0;
  const variants = ["idle", "timeout", "settle", "foreign", "changed", "late"];
  for ( const preset of PRESETS ) for ( const seed of [777, 12] ) for ( const step of [1, 2, 3] ) for ( const v of variants ) {
    const A = atOnce(preset, seed, step);
    // (a foreign word written after the page: the same in both worlds)
    const foreign = { key: "foreign", box: { x0: AT.x - 300, y0: AT.y - 700, x1: AT.x + 300, y1: AT.y - 500 }, t0: T0, t1: T0 + 3000 };
    if ( v === "foreign" ) { A.W.ledger.add(foreign); A.ledger = sigL(A.W.ledger); }
    const W = world(step); before(W);
    const R = rig(W, { cost: 4 }), p = pageOf(preset, seed), k = Math.min(1, p.pg.words.length - 1);
    let at = null, placeK = null;
    const fn = () => { at = R.now; const q = p.job?.pl.table.get(p.pg.words[k].key) ?? p.table?.get(p.pg.words[k].key);
      // (its place on this seat, read as soon as its part is planned)
      if ( q?.group ) placeK = [q.key, JSON.stringify(R.plans.layout(q.group, { key: R.S.name, full: () => R.plans && { key: R.S.name, ctx: ctxOf(R.S), d: W.base(), seat: seatOf(R.S) } }).get(q.key))]; };
    R.plans.ask(p, k, v === "late" ? R.now - 40 : R.now + 140, fn);
    if ( v === "changed" ) { W.live.step = step === 3 ? 1 : 3; W.live.off = 7; W.live.tok = TOK.map((b) => ({ x0: b.x0 + 300, y0: b.y0, x1: b.x1 + 300, y1: b.y1 })); W.live.pins = []; }
    if ( v === "settle" ) { R.run(R.now + 6); R.plans.settle(); const mid = sigL(W.ledger) === A.ledger; if ( !mid ) failed.push(`JOB ${preset} ${seed} step ${step}: a reader of the ledger mid-flight sees another ledger than the page planned at once left`); }
    if ( v === "foreign" ) { R.run(R.now + 6); R.plans.settle(); W.ledger.add(foreign); }
    R.run(R.now + 1500, v === "timeout" ? () => "timeout" : () => "idle");
    runs++;
    if ( v === "changed" ) { W.live.step = step; W.live.off = 0; W.live.tok = TOK; W.live.pins = [PIN]; }
    if ( p.table && !p.job && !R.plans.jobs.size && sigT(p.table) === A.table ) table++;
    if ( sigL(W.ledger) === A.ledger ) ledgers++;
    if ( v === "changed" && sigT(p.table ?? new Map()) === A.table ) froze++;
    // (this seat's sliced layout, and the other seat's begun later from the whole group)
    const grp = p.group, l0 = grp?.lay?.L?.out;
    const whole = (S, si) => { R.S = S; const view = R.plans.layout(grp, { key: S.name, full: () => ({ key: S.name, ctx: ctxOf(S), d: W.base(), seat: seatOf(S) }) }); for ( const q of grp.words ) view.get(q.key); return sigM(new Map([...grp.lay.L.out].sort())) === sigM(new Map([...A.lays[si]].sort())); };
    // (the layout reads the seat and the live steps when it BEGINS, as the whole layout did: not compared where the test changed them)
    if ( v === "changed" || (l0 && sigM(new Map([...l0].sort())) === sigM(new Map([...A.lays[0]].sort())) && whole(SEATS[1], 1) && whole(SEATS[0], 0)) ) lays++;
    if ( grp?.lay && !grp.lay.full ) sliced++;
    if ( at !== null && (v === "changed" || !placeK || placeK[1] === JSON.stringify(A.lays[0].get(placeK[0]))) ) prefix++;
    // (the probe is not blind: a writer that does NOT settle first leaves another ledger)
    if ( v === "foreign" ) { const W2 = world(step); before(W2); const R2 = rig(W2, { cost: 4 }), p2 = pageOf(preset, seed); R2.plans.ask(p2, k, R2.now + 140, () => {}); R2.run(R2.now + 6); W2.ledger.add(foreign); R2.run(R2.now + 1500); if ( sigL(W2.ledger) !== A.ledger ) blind++; }
  }
  const nv = runs / variants.length;
  ok(runs >= 60 && table === runs, `JOB in slices (idle moments, timeouts, a reader or a writer of the ledger in between, the live deps changed under it, asked late): planPage's table (${table}/${runs})`);
  ok(ledgers === runs, `JOB the ledger it leaves is the ledger of the page planned at once, a foreign word written after it included (${ledgers}/${runs})`);
  ok(lays === runs, `JOB both seats' layouts of the page - one laid out in slices, one begun later - are seatLayout's (${lays}/${runs})`);
  ok(prefix === runs, `JOB a word read as soon as its part is planned stands where the whole layout puts it (${prefix}/${runs})`);
  ok(froze === nv, `JOB the clock's offset, the size steps, the tokens and the pins changing under a job in flight do not change its picture (${froze}/${nv})`);
  ok(blind === nv, `JOB the probe is not blind: a writer that does not settle first leaves another ledger (${blind}/${nv})`);
  ok(sliced >= runs * 0.5, `JOB the sliced layout is the one used (${sliced}/${runs} layouts added word by word)`);
}

/* ---------------------------------------------------------------- TIME */
{
  const page = () => pageOf("bomb", 777);
  const go = (opt, idleAt, lead = 140) => { const W = world(2); before(W); const R = rig(W, opt), p = page(); let at = null, planned = null; const t = R.now + lead;
    R.plans.ask(p, 1, t, () => { at = R.now; planned = p.job ? p.job.pl.planned : p.pg.words.length; });
    const sync = at !== null; R.run(t + 400, idleAt);
    return { at, t, sync, planned, words: p.pg.words.length, stats: R.stats, done: !!p.table && !R.plans.jobs.size, R }; };
  const a = go({ cost: 5 }, () => "idle");
  ok(a.at !== null && a.at <= a.t - PLAN.PLAN_GUARD && !a.sync && !(a.stats.planForced > 0) && a.done, `TIME idle moments: the word goes on ${a.t - a.at} ms before its instant, nothing finished at once`);
  ok(a.stats.sliceMax <= PLAN.SLICE_MS + 5 + 1e-9 && a.stats.planMax <= 5 + 1e-9 && a.stats.planN >= a.words, `TIME a slice is one unit past SLICE_MS at most (longest ${a.stats.sliceMax} ms, longest unit ${a.stats.planMax} ms, ${a.stats.planN} units)`);
  const b = go({ cost: 5 }, () => "timeout");
  ok(b.at !== null && b.at <= b.t - PLAN.PLAN_GUARD && b.done && b.stats.sliceMax <= PLAN.SLICE_MS + 5 + 1e-9, `TIME no idle moment (timeouts only): ${b.t - b.at} ms before its instant, slices of ${b.stats.sliceMax} ms at most`);
  const c = go({ cost: 5 }, () => null);
  ok(c.at !== null && c.at <= c.t && c.stats.planForced === 1 && c.planned === 2 && c.planned < c.words, `TIME no slice at all: the guard plans the word's part at once, ${c.t - c.at} ms before its instant (${c.planned} of ${c.words} words planned then)`);
  const d = go({ cost: 30 }, () => "timeout");
  ok(d.at !== null && d.at <= d.t, `TIME a slow seat (30 ms a word): still ${d.t - d.at} ms before its instant`);
  const e = go({ cost: 5 }, () => "idle", -40);
  ok(e.sync && e.planned === 2 && e.planned < e.words && e.done, `TIME asked late: the word goes on in the same call with only its part planned (${e.planned} of ${e.words} words), the rest in slices`);
  // (a second word of the page asked while the job runs, and one asked after it: at once)
  { const W = world(2); before(W); const R = rig(W, { cost: 5 }), p = page(); const seen = [];
    R.plans.ask(p, 1, R.now + 140, () => seen.push(["pre", R.now]));
    R.plans.ask(p, 0, R.now + 1190, () => seen.push(["main", R.now]));
    R.run(R.now + 600);
    let late = false; R.plans.ask(p, p.pg.words.length - 1, R.now + 140, () => { late = true; });
    ok(seen.length === 2 && late && !!p.table, `TIME every word of a page asked for goes on once (${seen.map((q) => q[0]).join(", ")}; a word asked after the picture is whole: in the same call)`); }
}

/* ---------------------------------------------------------------- ORDER */
{
  const cls = (w) => (w.role === "main" ? 0 : w.role === "pre" ? 1 : w.wave || w.kind === "shockwave" ? 2 : 3);
  const inOrder = PRESETS.filter((id) => pageOf(id, 777).pg.words.every((w, i, a) => i === 0 || cls(a[i - 1]) <= cls(w)));
  ok(inOrder.includes("bomb") && inOrder.length === PRESETS.length, `ORDER the builtin presets' pages come in the layout's order (${inOrder.join(", ")} of ${PRESETS.join(", ")})`);
  // (a page whose words do not: laid out whole, the same places)
  const W = world(2); before(W);
  const p = pageOf("bomb", 777); p.pg = { ...p.pg, words: [...p.pg.words.slice(1), p.pg.words[0]] };
  const A = (() => { const W1 = world(2); before(W1); const p1 = pageOf("bomb", 777); p1.pg = { ...p1.pg, words: [...p1.pg.words.slice(1), p1.pg.words[0]] }; const tb = T.planPage(p1, W1.base());
    return { table: sigT(tb), lay: SEAT.seatLayout(T.seatItems(located(tb), W1.base(), seatOf(SEATS[0])), ctxOf(SEATS[0])) }; })();
  const R = rig(W, { cost: 4 }); R.plans.ask(p, 0, R.now + 140, () => {}); R.run(R.now + 1500);
  ok(!!p.table && sigT(p.table) === A.table && p.group.lay?.full === true && sigM(new Map([...p.group.lay.L.out].sort())) === sigM(new Map([...A.lay].sort())), "ORDER a page whose main word comes last: laid out whole, seatLayout's places");
}

/* ---------------------------------------------------------------- WARM */
{
  const { SETTLE } = await imp("scripts/letters/shape.mjs");
  const due = (tag) => [{ key: `a${tag}`, voice: "crash", x: 2400, y: 3600, r: 320, t: 5000 }, { key: `b${tag}`, voice: "crash", x: 3900, y: 4300, r: 180, t: 5010 }, { key: `c${tag}`, voice: "fire", x: 1700, y: 4200, r: 200, t: 5020 }];
  const plan = (sceneId, warm) => {
    const W = world(3); before(W);
    const d = { ...W.base(), sceneId }, evs = due(""), recent = [{ x: 0, y: 0, reach: 10, t: 0, prio: 0, voice: "crash" }];
    const l0 = sigL(W.ledger), e0 = JSON.stringify(evs), r0 = JSON.stringify(recent);
    let steps = 0, clean = true;
    if ( warm ) {
      const it = T.warmMoment(evs.map((e) => ({ ...e })), { ...d, ledger: { count: (...a) => W.ledger.count(...a), boxes: (...a) => W.ledger.boxes(...a), add: () => { clean = false; } }, memo: new Map(), warn: () => {} }, recent.map((r) => ({ ...r })));
      while ( !it.next().done ) steps++;
      clean = clean && sigL(W.ledger) === l0 && JSON.stringify(evs) === e0 && JSON.stringify(recent) === r0;
    }
    const f0 = SETTLE.fresh, out = T.planMoment(evs, d, recent);
    return { sig: JSON.stringify(out.map((q) => q.placed), strip), ledger: sigL(W.ledger), fresh: SETTLE.fresh - f0, steps, clean, words: out.reduce((a, q) => a + (q.specs ?? 0), 0) };
  };
  // (two scenes: other seeds, so each run meets an engine memo that does not hold its words yet)
  const cold = plan("warm-scene-A", false), warmA = plan("warm-scene-A", false);
  const w = plan("warm-scene-B", true), ref = (() => { const { SETTLE: S2 } = { SETTLE }; S2.on = false; try { return plan("warm-scene-B", false); } finally { S2.on = true; } })();
  ok(cold.words >= 2 && cold.fresh >= cold.words && warmA.fresh === 0 && warmA.sig === cold.sig, `WARM the probe: a moment of ${cold.words} words settles ${cold.fresh} plans fresh when the engine does not hold them, none the second time`);
  ok(w.clean && w.steps >= w.words && w.words >= 2, `WARM warming a moment (${w.steps} steps) leaves its events, the ledger and the caller's recent list untouched`);
  ok(w.fresh === 0 && w.words === cold.words, `WARM after it the moment's planning settles nothing fresh (${w.fresh}; ${cold.fresh} without)`);
  ok(w.sig === ref.sig && w.ledger === ref.ledger, "WARM the moment's picture and ledger are the ones planned without it (the engine's memo off)");
}

/* ---------------------------------------------------------------- SOURCE */
{
  const src = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8");
  const fac = src.slice(src.indexOf("const ledger = {"), src.indexOf("};", src.indexOf("const ledger = {")));
  ok(/const tableLedger = SEAT\.makeLedger\(\);/.test(src) && (fac.match(/plans\.settle\(\); (return )?tableLedger\./g) ?? []).length === 7 && /clear: \(\) => \{ plans\.clear\(\); tableLedger\.clear\(\); \}/.test(fac)
    && ["list", "add", "boxes", "count", "has", "get", "prune"].every((k) => new RegExp(`(get )?${k}[:(]`).test(fac)), "SOURCE every reader and writer of the map's ledger first settles the pictures in flight");
  ok(/function tdeps\(\) \{\s*return \{ L, sizeFor: engineSizeFor, grid: grid\(\), sceneId: canvas\.scene\?\.id \?\? "", lang: lang\(\), known, ledger, toPerf, toShared,/.test(src), "SOURCE the moments and every other planner get that settling ledger");
  ok(/deps: \(\) => PLAN\.frozenDeps\(tdeps\(\), \{ ledger: tableLedger, off: toPerf\(0\), steps: new Map\(SZ\.SIZE_GROUPS\.map\(\(g\) => \[g, stepFor\(g\)\]\)\), tokens: sharedTokens\(null\), pins: sharedPins\(null\) \}\)/.test(src),
    "SOURCE a job's deps are frozen at its start: the clock's offset, the size steps, every shared token and pin");
  ok(src.includes("const t = toPerf(w.t), lead = 140;") && src.includes("later(`pg|${rec.id}|${w.key}`, t - lead - performance.now(), () => pageWord(p, w, t));")
    && /const here = \{ still: p\.still \? p\.still\(\) : true, up: alive\.size \};\s*plans\.ask\(p, p\.pg\.words\.indexOf\(w\), t, \(\) => pageWordNow\(p, w, here\)/.test(src), "SOURCE a page word is asked for 140 ms ahead as before; what the seat decides by is read then");
  ok(/const oo = \{ \.\.\.o, at: sh\(at\), startAt: w\.t, reduced: reducedMotion\(\) \};/.test(src) && /const wait = w\.t - performance\.now\(\);\s*if \( wait > 4 \) later\(/.test(src), "SOURCE a word is played at the table's instant (startAt), as before");
  ok(/function uiBoxes\(force = false\) \{\s*const now = performance\.now\(\);\s*if \( !force && now - uiCache\.t < UI_MS \) return uiCache\.boxes;/.test(src) && /if \( wait > 30 && performance\.now\(\) \+ wait - uiCache\.t >= UI_MS \) warmUi\(wait - 25\);/.test(src),
    "SOURCE the walk over the seat's panels is made in an idle moment before a word only when the kept one would be too old at its instant");
}

{
  const src = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8");
  const wm = src.slice(src.indexOf("function warmMoment() {"), src.indexOf("function warmMoment() {") + 1600);
  ok(/pending\.push\(e\);[\s\S]{0,260}warmMoment\(\);\n\}/.test(src) && /gatherTimer = 0; warmGen\+\+;/.test(src) && wm.includes("pending.map((e) => ({ ...e }))") && wm.includes("add: () => null") && wm.includes("memo: new Map()") && wm.includes("recent.map((r) => ({ ...r }))"),
    "SOURCE a moment is warmed while its events are gathered - on copies, a memo of its own, the ledger only read - and the flush ends it");
}

if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-plan: ${failed.length} failed, ${n} passed`); process.exit(1); }
console.log(`sfx-plan: ${n} checks passed`);
