// LETR ENGREG (1.9.11): the engine's plumbing callers rely on. Own process on the fake browser (testenv.mjs):
//   node check-engreg.mjs --engine              this folder; prints "engreg-engine: N checks, F failed"
//   node check-engreg.mjs --engine <letters>    the same checks on another engine folder (1.9.10: every point fails)
// 1 which copy wins: one rule after "init", not the first caller's; L.build says what runs; seats tell the GM their build
// 2 the shared clock: the default grid clock agrees between seats to ~2 ms (one late ping answer, a late joiner, a sleeping tab)
// 3 a caller's ceiling share: `ceil` reaches the size model; `ceilK` (what callers pass today) still changes nothing
// 4 measuring before placing: L.measure gives the box and the entrance reach the word then really has
// 5 many words planned in one frame: one settle per word for measure + play; the memo hands back exactly what a fresh settle makes
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export async function engineChecks(dir) {
  let n = 0, failed = 0;
  const ok = (c, msg) => { n++; if ( !c ) { failed++; console.log("FAIL", msg); } else if ( process.env.LETR_VERBOSE ) console.log("ok  ", msg); };
  const U = (f) => pathToFileURL(path.join(dir, f)).href;
  const imp = async (f, q = "") => { try { return await import(U(f) + q); } catch ( e ) { return null; } };
  const { setup } = await import(U("testenv.mjs"));
  const section = async (name, f) => { try { await f(); } catch ( e ) { ok(false, `${name}: threw ${e?.stack?.split("\n").slice(0, 3).join(" | ") ?? e}`); } };

  /* ---------- 1. which copy wins ---------- */
  await section("registry", async () => {
    const E = await setup();
    const hooks = {};
    globalThis.Hooks = { on: (k, f) => (hooks[k] ??= []).push({ f }), once: (k, f) => (hooks[k] ??= []).push({ f, once: true }),
      callAll: (k, ...a) => { const l = hooks[k] ?? []; hooks[k] = l.filter((x) => !x.once); l.forEach((x) => x.f(...a)); } };
    globalThis.game = { user: { id: "gm1", isGM: true }, i18n: { lang: "en" } };   // before "init": no modules yet
    delete globalThis.MoinenLetters;
    const fake = (v) => () => ({ version: v, ready: async () => true });
    const host = "http://seat.test/modules/";
    await imp("index.mjs", "?reg=1");
    const REG = globalThis.MoinenLetters;
    ok(!!REG, "registry: index.mjs registers its copy");
    REG.copies.push({ version: "1.0.0", stamp: { hash: "aaaa", at: "2020-01-01T00:00:00Z" }, base: `${host}invincible-plus-ultra/scripts/letters/`, create: fake("1.0.0") });
    /* a caller asks before Foundry's "init" (module code at load time), then the other module's newer copy registers */
    const early = REG.engine();
    const madeEarly = !!REG._engine;
    REG.copies.push({ version: "99.0.0", stamp: { hash: "bbbb", at: "2026-01-01T00:00:00Z" }, base: `${host}moinen-maps/scripts/letters/`, create: fake("99.0.0") });
    globalThis.game.modules = new Map([["moinen-maps", { active: true }], ["invincible-plus-ultra", { active: true }]]);
    Hooks.callAll("init");
    const L = await Promise.race([early, new Promise((r) => setTimeout(() => r(null), 3000))]);
    ok(!madeEarly, "registry: a caller before init does not fix the engine (the choice waits for every copy)");
    ok(L?.version === "99.0.0", `registry: the highest VERSION wins whoever asked first (got ${L?.version})`);
    const b = REG.build ?? L?.build;
    ok(!!b && b.version === "99.0.0" && b.module === "moinen-maps" && Array.isArray(b.copies) && b.copies.length === 3, `registry: L.build / MoinenLetters.build name the version, module and the copies seen (${JSON.stringify(b)?.slice(0, 160)})`);
    ok(L?.build?.version === "99.0.0", "registry: the engine object itself carries build");
    delete globalThis.MoinenLetters;

    /* an older registry loaded first (its first-come rule) is replaced by this copy's rule while no engine was made */
    const oldReg = { copies: [], _engine: null, async engine() { if ( !this._engine ) { const best = this.copies[0]; this._engine = best.create(best.base); } return this._engine; }, get version() { return this._engine?.version ?? null; } };
    globalThis.MoinenLetters = oldReg;
    oldReg.copies.push({ version: "1.0.0", stamp: { hash: "cc", at: "2020" }, base: `${host}invincible-plus-ultra/scripts/letters/`, create: fake("1.0.0") });
    await imp("index.mjs", "?reg=2");
    oldReg.copies.push({ version: "50.0.0", stamp: { hash: "dd", at: "2025" }, base: `${host}moinen-maps/scripts/letters/`, create: fake("50.0.0") });
    const L2 = await oldReg.engine();
    ok(L2?.version === "50.0.0", `registry: an older first copy's registry takes this copy's rule (got ${L2?.version})`);
    delete globalThis.MoinenLetters;

    /* equal VERSION, different content: the more recently synced; equal content: the canonical module */
    const R = await imp("registry.mjs");
    ok(!!R?.chooseCopy, "registry: the rule is one pure function (registry.mjs chooseCopy)");
    if ( R?.chooseCopy ) {
      const a = { version: "2.0.0", stamp: { hash: "x1", at: "2026-01-02" }, base: `${host}invincible-plus-ultra/scripts/letters/` };
      const c = { version: "2.0.0", stamp: { hash: "x2", at: "2026-01-01" }, base: `${host}moinen-maps/scripts/letters/` };
      const r1 = R.chooseCopy([c, a]), r2 = R.chooseCopy([a, c]);
      ok(r1.best === a && r2.best === a && !!r1.warn, "registry: equal VERSION, different content: the more recently synced, in any load order, with a warning");
      const d = { ...c, stamp: { hash: "x1", at: "2026-01-02" } };
      ok(R.chooseCopy([a, d]).best === d && R.chooseCopy([d, a]).best === d, "registry: equal content: the canonical module's copy (moinen-maps), in any load order");
      ok(R.carrierUrl("http://h:30001/pre/modules/moinen-maps/scripts/letters/", "invincible-plus-ultra") === "http://h:30001/pre/modules/invincible-plus-ultra/scripts/letters/index.mjs", "registry: the other carrier's copy is found next to this one (route prefix kept)");
    }
    E.restoreWarn();
  });

  /* ---------- 1b. seats tell the GM their build ---------- */
  await section("seats", async () => {
    const E = await setup({ gm: true });
    const T = await imp("tools.mjs", "?seats=1");
    const N = await imp("net.mjs");
    ok(typeof N?.helloMsg === "function" && typeof N?.checkHello === "function", "seats: a hello message carries a seat's build (net.mjs)");
    if ( !T?._net?.seatsList || !N?.helloMsg ) { ok(false, "seats: L.seats() lists the builds of the seats"); E.restoreWarn(); return; }
    const sent = [], warned = [];
    globalThis.game = { user: { id: "gm1", name: "GM", isGM: true }, i18n: { lang: "en", format: (k) => k }, users: new Map([["gm1", { id: "gm1", name: "GM", isGM: true }], ["p1", { id: "p1", name: "Player 1", isGM: false }], ["p2", { id: "p2", name: "Player 2", isGM: false }]]),
      modules: new Map([["moinen-maps", { active: true }]]), socket: { emit: (ch, m) => sent.push(m), on() {} } };
    globalThis.ui = { notifications: { warn: (t) => warned.push(t) } };
    T._net.state.host = "moinen-maps";
    T._net.state.reg = { build: { version: "1.9.11", hash: "h111", module: "moinen-maps" } };
    T._net.onSocket(N.helloMsg({ version: "1.9.11", hash: "h111", module: "moinen-maps" }, "p1", false, false), "p1");
    ok(sent.some((m) => m.op === "hello" && m.reply && m.version === "1.9.11"), "seats: the GM's seat answers a newcomer with its own build");
    T._net.onSocket(N.helloMsg({ version: "1.9.9", hash: "h099", module: "invincible-plus-ultra" }, "p2", false, false), "p2");
    const rows = T._net.seatsList();
    const p1 = rows.find((r) => r.user === "p1"), p2 = rows.find((r) => r.user === "p2");
    ok(p1?.same === true && p2?.same === false && p2?.version === "1.9.9", `seats: L.seats() names each seat's build and whether it is the GM's (${JSON.stringify(rows.map((r) => [r.user, r.version, r.same]))})`);
    ok(warned.length === 1 && /Seats\.Differ|1\.9\.9/.test(warned[0]), `seats: a seat on another build is named on the GM's seat once (${warned.length})`);
    T._net.onSocket(N.helloMsg({ version: "1.9.9", hash: "h099" }, "p2", false, false), "p2");
    ok(warned.length === 1, "seats: ... and not again for the same build");
    T._net.onSocket(N.helloMsg({ version: "1.9.9", hash: "h099" }, "p1", false, false), "p2");
    ok(T._net.seatsList().find((r) => r.user === "p1")?.version === "1.9.11", "seats: a hello in another user's name is ignored");
    /* words stay GM only: a player's word is still refused */
    let played = 0; T._net.state.engine = { play: () => { played++; return { finished: Promise.resolve() }; } };
    T._net.onSocket({ t: "letr", v: 1, op: "play", id: "x1", at: 1, text: "KRAK", opts: {} }, "p1");
    ok(played === 0, "seats: TOOL-8 kept: a player's word is refused");
    delete globalThis.ui;
    E.restoreWarn();
  });

  /* ---------- 2. the shared clock ---------- */
  await section("clock", async () => {
    /* two seats of one table: page clocks with different origins, the server's clock = page + trueOff. Every ping takes ~1 ms each
       way; seat B's last ping answer came back 60 ms late (a busy frame), seat C joined a minute later, seat D's tab slept 900 ms
       after its pings (its page clock stood still while the server's went on). The error of a seat = what its grid clock believes
       the server's time is, minus the truth. */
    const SEATS = [
      { id: "A", trueOff: 5.2e7 - 1000, delays: [[1, 1], [1, 1.2], [0.8, 1], [1, 1], [1, 1.1], [0.9, 1]] },
      { id: "B", trueOff: 5.2e7 - 31234.6, delays: [[1, 1], [1, 1.2], [0.8, 1], [1, 1], [1, 1.1], [1, 60]] },
      { id: "C", trueOff: 5.2e7 - 87000.3, delays: [[1.1, 1], [1, 1], [9, 1], [1, 1], [1, 1.3], [1, 1]] },
      { id: "D", trueOff: 5.2e7 - 4400.9, delays: [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1]], sleep: 900 }
    ];
    const errs = {};
    for ( const S of SEATS ) {
      const E = await setup({ gm: false });
      let P = 2000 + Math.random() * 100, wallOff = 1.79e12;
      const step = { up: 1, down: 1 };
      globalThis.performance.now = () => P;
      const realDate = Date.now; Date.now = () => Math.floor(P + wallOff);
      const time = { dts: [], t: null, sync() {   // Foundry v14 helpers/time.mjs GameTime#sync (Cristian, mean of the last four)
        const t0 = Date.now(); let ans = null; game.socket.emit("time", (x) => (ans = x)); const t1 = Date.now();
        if ( this.dts.length >= 4 ) this.dts.shift(); this.dts.push(t1 - t0);
        const dt = Math.round(this.dts.reduce((a, b) => a + b, 0) / (this.dts.length * 2));
        this.t = { serverTime: ans.serverTime, clientTime: t1 - dt };
      }, get serverTime() { return this.t.serverTime + (Date.now() - this.t.clientTime); } };
      globalThis.game = { user: { id: `u${S.id}`, isGM: false }, i18n: { lang: "en" }, time,
        socket: { emit(name, cb) { if ( name !== "time" ) return; P += step.up; const s = Math.floor(P + S.trueOff); P += step.down; cb({ serverTime: s }); }, on() {} } };
      const T = await imp("tools.mjs", `?clock=${S.id}`);
      let gridFn = null; const g0 = E.engine.gridClock; E.engine.gridClock = (f) => { if ( typeof f === "function" ) gridFn = f; return g0(f); };
      T.install(E.engine, E.engine.base);
      for ( const [up, down] of S.delays ) {
        step.up = up; step.down = down; time.sync();
        step.up = up; step.down = down; await T._net?.state?.clock?.ping?.();
        P += 1000;
      }
      if ( S.sleep ) { P -= S.sleep; wallOff += S.sleep; }   // the page clock stood still S.sleep ms; the wall (and the server) went on
      const believe = gridFn ? gridFn() : null;
      errs[S.id] = believe == null ? NaN : believe - (S.trueOff + (S.sleep ?? 0));
      Date.now = realDate;
      E.restoreWarn();
    }
    const v = Object.values(errs), spread = Math.max(...v) - Math.min(...v);
    if ( process.env.LETR_VERBOSE ) console.log("clock errors per seat (ms):", JSON.stringify(errs));
    ok(v.every((e) => Number.isFinite(e) && Math.abs(e) <= 2.5), `clock: every seat's grid clock within 2.5 ms of the server's (${Object.entries(errs).map(([k, e]) => `${k} ${e.toFixed(1)}`).join(", ")})`);
    ok(spread <= 3, `clock: seats agree on the instant within 3 ms (spread ${spread.toFixed(1)} ms; one late answer, a late joiner, a sleeping tab)`);

    const C = await imp("clock.mjs");
    ok(!!C?.makeClock, "clock: the engine has its own table clock (clock.mjs), no other module needed");
    if ( C?.makeClock ) {
      /* a server restart (its clock counts from its start) / a jump: the next answer that cannot agree starts the estimate again */
      let P = 0, off = 1e6;
      const k = C.makeClock({ now: () => P, wall: () => P, ping: (cb) => { P += 1; const s = P + off; P += 1; cb(s); } });
      for ( let i = 0; i < 4; i++ ) { await k.ping(); P += 500; }
      off = 3e3;   // the server restarted
      await k.ping();
      ok(Math.abs(k.offset() - off) <= 1.5 && k.state().resets === 1, `clock: a server restart is followed at the next answer (error ${(k.offset() - off).toFixed(2)} ms)`);
      ok(Math.abs(k.toPage(k.toServer(1234.5)) - 1234.5) < 1e-9 && Math.abs(k.serverNow() - (P + k.offset())) < 1e-9, "clock: toPage / toServer / serverNow are one clock");
    }
  });

  /* ---------- 3. a caller's ceiling share ---------- */
  await section("ceil", async () => {
    const E = await setup(); const L = E.engine; L.lookStyle("invincible");
    canvas.stage.scale.set(2, 2);
    const base = { mood: "boom", seed: "c1", space: "world", at: { x: 2000, y: 1500 }, magnitude: 1.4, area: 900 };
    const z0 = L.sizeOf("KA-BOOM!", base), zK = L.sizeOf("KA-BOOM!", { ...base, ceilK: 0.4 }), zC = L.sizeOf("KA-BOOM!", { ...base, ceil: 0.4 });
    ok(z0.clamp === "ceil" || z0.clamp === "width", `ceil: the sample word is held at its ceiling (${z0.clamp})`);
    ok(zK.px === z0.px, `ceil: ceilK (what callers pass today) still changes nothing (${zK.px.toFixed(2)} vs ${z0.px.toFixed(2)} px)`);
    ok(zC.px < z0.px * 0.7, `ceil: ceil 0.4 takes a share of the ceiling (${zC.px.toFixed(1)} px of ${z0.px.toFixed(1)})`);
    const h = L.play("KA-BOOM!", { ...base, ceil: 0.4 }); await E.tick(200);
    ok(Math.abs(h.sizeInfo.px - zC.px) < 0.01, `ceil: the played word has the size sizeOf promised (${h.sizeInfo?.px?.toFixed(2)})`);
    const N = await imp("net.mjs");
    ok(N.OP_KEYS.includes("ceil"), "ceil: travels with L.net");
    L.stopAll(); await E.tick(1000); E.restoreWarn();
  });

  /* ---------- 4. measuring before placing ---------- */
  await section("measure", async () => {
    const E = await setup(); const L = E.engine; L.lookStyle("invincible");
    ok(typeof L.measure === "function", "measure: L.measure exists in the engine itself (no tools needed)");
    if ( typeof L.measure !== "function" ) { E.restoreWarn(); return; }
    const tok = E.addToken("t1", 1800, 1400);
    for ( const [text, o] of [["KRAKOOM!", { kind: "thunder", mood: "boom", magnitude: 1.2 }], ["THWAK!", { kind: "punch", mood: "crack", at: tok.document }], ["-7", { mood: "impact", at: { x: 2100, y: 1600 } }]] ) {
      const opts = { seed: `m${text}`, space: "world", at: { x: 2000, y: 1500 }, reduced: false, ...o };
      const m = L.measure(text, opts);
      const h = L.play(text, opts); await E.tick(400);
      const hb = h.plan._holdBox, k = h.size * h.plan.sizeK;
      ok(Math.abs(m.hold.w - hb.w * k) < 1e-6 && Math.abs(m.hold.h - hb.h * k) < 1e-6, `measure: ${text} hold box = the played word's (${m.hold.w.toFixed(2)} x ${m.hold.h.toFixed(2)})`);
      const e = h.reach ?? null;
      if ( e ) ok(Math.abs(m.reach.l - e.l * k) < 1e-6 && Math.abs(m.reach.u - e.u * k) < 1e-6 && Math.abs(m.reach.d - e.d * k) < 1e-6, `measure: ${text} reach = the engine's own reach of the played word`);
      ok(m.reach.l >= m.hold.w / 2 && m.reach.u >= m.hold.h / 2 && m.reachBox.x0 <= m.box.x0 && m.reachBox.y1 >= m.box.y1, `measure: ${text} the entrance reach holds the hold box`);
      const cy = h.lastPos?.y;
      if ( Number.isFinite(cy) && !h.track ) ok(Math.abs((m.box.y0 + m.box.y1) / 2 - cy) < 0.5, `measure: ${text} the box sits where the word is placed (anchor)`);
      ok(m.contactMs === h.plan.contactMs, `measure: ${text} contactMs is the played plan's`);
      h.stop({ quick: true });
    }
    E.restoreWarn();
  });

  /* ---------- 5. many words planned together ---------- */
  await section("plan cost", async () => {
    const S = await imp("shape.mjs");
    ok(!!S?.SETTLE, "plan cost: the settle is memoised (shape.mjs SETTLE)");
    if ( !S?.SETTLE ) return;
    const E = await setup(); const L = E.engine; L.lookStyle("invincible");
    const words = ["KA-BOOM!", "KRAKT!", "THWUP!", "ZBURZENIE!", "BADOOOM!", "-12", "KRA-KA-GRRAWOOM!", "SPLOOSH", "PTOK!", "GRRRAAAH!", "WHUMP", "TSSSS"];
    const f0 = S.SETTLE.fresh, r0 = S.SETTLE.reused;
    const hs = words.map((t, i) => { const o = { seed: `pc${i}`, space: "world", at: { x: 1500 + i * 60, y: 1500 }, magnitude: 0.4 + (i % 4) * 0.3, reduced: false }; L.measure(t, o); return L.play(t, o); });
    await E.tick(600);
    ok(S.SETTLE.fresh - f0 === words.length && S.SETTLE.reused - r0 >= words.length, `plan cost: measure + play of ${words.length} words = one fresh settle each (${S.SETTLE.fresh - f0} fresh, ${S.SETTLE.reused - r0} reused)`);
    for ( const h of hs ) h.stop({ quick: true });
    /* exactness: a reused settle = a fresh settle, plan and centre, every style */
    const { makePlan } = await import(U("design.mjs"));
    const fontsApi = { adv: (f, c) => L._bank.adv(f, c) };
    let same = 0, all = 0;
    for ( const style of ["invincible", "comic", "expressive"] ) for ( const t of words ) for ( const face of ["league", "anton"] ) {
      const o = { seed: `x${t}`, magnitude: 0.8, look: { style, face, motion: "smooth" } };
      S.SETTLE.on = false; const a = makePlan(t, o, fontsApi, []); S.settleCenter(a, L._bank);
      S.SETTLE.on = true; const b = makePlan(t, o, fontsApi, []); S.settleCenter(b, L._bank); const c = makePlan(t, o, fontsApi, []); S.settleCenter(c, L._bank);
      const j = (p) => JSON.stringify(p) + JSON.stringify(p._center) + JSON.stringify(p._holdBox);
      all++; if ( j(a) === j(b) && j(b) === j(c) ) same++;
    }
    ok(same === all, `plan cost: a reused settle equals a fresh one (${same} of ${all} plans)`);
    /* rowExtents: the sorted-rows walk = the plain one */
    const naive = (cs, ys) => { const mn = ys.map(() => Infinity), mx = ys.map(() => -Infinity);
      for ( const c of cs ) for ( let i = 0, nn = c.length; i < nn; i += 2 ) { const j = (i + 2) % nn, x1 = c[i], y1 = c[i + 1], x2 = c[j], y2 = c[j + 1]; if ( y1 === y2 ) continue; const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
        for ( let k = 0; k < ys.length; k++ ) { const y = ys[k]; if ( y < lo || y >= hi ) continue; const x = x1 + (y - y1) * (x2 - x1) / (y2 - y1); if ( x < mn[k] ) mn[k] = x; if ( x > mx[k] ) mx[k] = x; } }
      return { mn, mx }; };
    let eq = 0; const R = (s) => () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    for ( let t = 0; t < 200; t++ ) {
      const r = R(t + 1), cs = [];
      for ( let c = 0; c < 1 + (t % 3); c++ ) { const pts = []; for ( let q = 0; q < 6 + (t % 40); q++ ) pts.push(r() * 2 - 1, Math.round(r() * 40) / 40); cs.push(pts); }
      const ys = []; for ( let q = 0; q < 30; q++ ) ys.push(r() * 2 - 1); for ( const c of cs ) for ( let q = 1; q < c.length; q += 2 ) ys.push(c[q], c[q] - 1e-7);
      const A = naive(cs, ys), B = S._rowExtents(cs, ys);
      if ( A.mn.every((v, k) => Object.is(v, B.mn[k])) && A.mx.every((v, k) => Object.is(v, B.mx[k])) ) eq++;
    }
    ok(eq === 200, `plan cost: rowExtents gives the same rows as the plain walk (${eq} of 200 random outlines)`);
    E.restoreWarn();
  });

  console.log(`engreg-engine: ${n} checks, ${failed} failed`);
  return failed;
}

if ( process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--engine") ) {
  const other = process.argv.slice(2).find((a) => !a.startsWith("--"));
  process.exit((await engineChecks(other ? path.resolve(other) : path.dirname(fileURLToPath(import.meta.url)))) ? 1 : 0);
}
