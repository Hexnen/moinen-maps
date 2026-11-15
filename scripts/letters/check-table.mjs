// ENGTABLE (1.9.16): every preference of the engine is the TABLE's (the owner: «wszystko mg wybiera dla stołu. wszystko»).
// Run by check.mjs; alone: `node check-table.mjs`. On a fake Foundry with v14's settings semantics (world values in Setting documents
// only a GM may write, onChange and create/update/delete hooks on every seat, pre-hooks on the writing seat, client values in
// localStorage "<ns>.<key>" as JSON), two seats in one process (two instances of tools.mjs, a GM and a player, each with its own
// browser storage, hooks and accessibility signals):
//   1 inventory: no client-scope preference remains; every preference is a table key; the guard is no setting
//   2 a seat's own signals: system reduced motion and Foundry photosensitive mode apply on that seat only; the guard always on
//   3 today's defaults: what a seat applies at the table's defaults equals 1.9.14's defaults (no picture changes; fingerprints apart)
//   4 a player cannot change any (setTable refused, a direct write stopped on his seat, the impact switch refused)
//   5 a GM change reaches the second seat live, on its next word, for every preference
//   6 migration from old client values (the GM's become the table's once; plus-ultra's old copy first; players' untouched, told once)
//   7 the situations: maps alone, plus-ultra alone, both (ENGDROP 1.9.19: no bridge; plus-ultra 136+ keeps no copy and writes none;
//     the old copy `lettersTable` read from its document by the migration, with or without plus-ultra; an OLDER plus-ultra (132-135,
//     the GMALL mirror) next to this engine: its mirror inert, its window's changes taken into the table, nothing written back)
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = new URL("./", import.meta.url);
const NS = "moinen-letters", PU = "invincible-plus-ultra";
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export async function run(ok, ctx = {}) {
  const P = await import("./prefs.mjs");
  const D = await import("./design.mjs");
  let fontsApi = ctx.fontsApi;
  if ( !fontsApi ) {
    const { FontBank } = await import("./fontbank.mjs");
    const bank = new FontBank();
    for ( const [id, f] of Object.entries(D.FONTS) ) { if ( !f.file || f.custom ) continue; const b = fs.readFileSync(new URL(f.file, HERE)); bank.add(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); }
    fontsApi = { adv: (f, c) => bank.adv(f, c) };
  }

  /* ---------------- 1. inventory ---------------- */
  {
    /* the preferences of 1.9.14 (its client settings, plus movement and face), frozen here since ENGDROP removed their description */
    const legacy = ["enabled", "scale", "motion", "flashes", "photosafe", "impact", "palette", "announce", "limitScreen", "limitWorld", "movement", "face"];
    ok(legacy.filter((k) => k !== "photosafe").every((k) => P.TABLE_KEYS.includes(k)) && P.TABLE_KEYS.length === legacy.length - 1, `table: every preference of 1.9.14 is a table key (${P.TABLE_KEYS.join(", ")})`);
    ok(["SETTINGS", "WORLD_KEYS", "scopeOf", "DEFAULTS", "clean", "cleanAll"].every((n) => !(n in P)), "table: the legacy description of the old client settings is gone (ENGDROP)");
    ok(!("photosafe" in P.TABLE), "table: the photosensitivity guard is no setting at all");
    const tsrc = fs.readFileSync(new URL("tools.mjs", HERE), "utf8"), isrc = fs.readFileSync(new URL("impact/index.mjs", HERE), "utf8");
    const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    ok(!/scope\s*:\s*["']client["']|scopeOf\(/.test(code(tsrc)), "table: tools.mjs registers no client setting");
    ok(!/\.register\(/.test(code(isrc)) && !/scope\s*:\s*["']client["']/.test(code(isrc)), "table: the impact frames register no setting of their own (their switch is the table's)");
    ok(P.TABLE.motion.choices.join() === "auto,gentle,reduced" && P.cleanTableValue("motion", "full") === "auto", "table: the table offers Full (auto) / Gentle / Reduced; an old 'full' reads as auto");
  }

  /* ---------------- 2. a seat's own signals ---------------- */
  {
    const t = P.TABLE_DEFAULTS;
    ok(P.reducedFor(P.seatPrefs(t, { osReduced: true }).motion, undefined, true) === true && P.reducedFor(P.seatPrefs(t, {}).motion, undefined, false) === false, "table: a seat whose system asks for reduced motion gets it at the table's Full");
    ok(P.reducedFor(P.seatPrefs({ ...t, motion: "full" }, { osReduced: true }).motion, undefined, true) === true, "table: a stored 'full' never overrides a seat's reduced motion");
    ok(P.seatPrefs({ ...t, motion: "gentle" }, { osReduced: true }).motion === "gentle" && P.reducedFor("gentle", undefined, true) === true, "table: Gentle at the table + reduced seat = reduced there");
    ok(P.seatPrefs(t, { photosensitive: true }).flashes === false && P.seatPrefs(t, {}).flashes === true && P.seatPrefs({ ...t, flashes: false }, {}).flashes === false, "table: Foundry's photosensitive mode on a seat = no flash frames there (the table's choice elsewhere)");
    ok([{}, { photosafe: false }, { flashes: false }, { motion: "reduced" }].every((x) => P.seatPrefs({ ...t, ...x }, { photosensitive: !!x.flashes }).photosafe === true), "table: the guard is pinned on for every table and every seat");
    const { modeFor } = await import("./impact/plan.mjs");
    ok(modeFor({ ...P.seatPrefs(t, { photosensitive: true }) }, {}) === "local" && modeFor(P.seatPrefs(t, {}), {}) === "full" && modeFor(P.seatPrefs(t, { osReduced: true }), { osReduced: true }) === "static", "table: impact frames on a photosensitive seat stay in a panel, on a reduced seat one still drawing");
  }

  /* ---------------- 3. today's defaults ---------------- */
  {
    /* 1.9.14's defaults, frozen (its prefs.mjs DEFAULTS) */
    const now = P.seatPrefs(P.TABLE_DEFAULTS, {}), old = { enabled: true, scale: 1, motion: "auto", flashes: true, photosafe: true, impact: "full", palette: "mood", announce: true, limitScreen: 16, limitWorld: 48, movement: "smooth", face: "league" };
    const keys = Object.keys(old);
    ok(keys.every((k) => now[k] === old[k]), `table: what a seat applies at the table's defaults = 1.9.14's defaults (${keys.filter((k) => now[k] !== old[k]).join(", ") || "all equal"})`);
    ok(JSON.stringify(P.resolveOpts({ mood: "boom", seed: 3 }, now, {}, {})) === JSON.stringify(P.resolveOpts({ mood: "boom", seed: 3 }, old, {}, {})), "table: options resolve alike at the defaults");
  }

  /* ---------------- 4-7. two seats on a fake Foundry ---------------- */
  await seats(ok, { P, D, fontsApi });

  /* ---------------- source: no bridge, nothing written into another module's namespace ---------------- */
  {
    const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const tsrc = code(fs.readFileSync(new URL("tools.mjs", HERE), "utf8"));
    ok(!/bridgeOut|bridgeIn|bridged|PU_MOD|puTable/.test(tsrc) && !/settings\.set\(\s*(PU|["']invincible-plus-ultra)/.test(tsrc), "table: no bridge to plus-ultra's old mirror, no write into its namespace (ENGDROP)");
  }
}

/* =============================================================== the fake Foundry */
class LS { constructor(o = {}) { this.m = new Map(Object.entries(o).map(([k, v]) => [k, JSON.stringify(v)])); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
function makeWorld() {
  const world = { store: new Map(), seats: [], cur: null };
  world.with = (seat, fn) => {
    const prev = world.cur;
    world.cur = seat;
    Object.assign(globalThis, { game: seat.game, Hooks: seat.Hooks, localStorage: seat.ls, ui: seat.ui, matchMedia: seat.matchMedia });
    try { return fn(); } finally { if ( prev ) { world.cur = prev; Object.assign(globalThis, { game: prev.game, Hooks: prev.Hooks, localStorage: prev.ls, ui: prev.ui, matchMedia: prev.matchMedia }); } }
  };
  /* async work of one seat: globals stay that seat's until the work settles (the test runs seat by seat) */
  world.run = async (seat, fn) => { world.cur = null; world.with(seat, () => {}); world.cur = seat; Object.assign(globalThis, { game: seat.game, Hooks: seat.Hooks, localStorage: seat.ls, ui: seat.ui, matchMedia: seat.matchMedia }); const r = await fn(); await tick(5); return r; };
  return world;
}
function makeSeat(world, { name, gm, ls = {}, osReduced = false, modules = ["moinen-maps"] }) {
  const reg = new Map(), menus = new Map(), hooks = {}, notes = [];
  let hid = 0;
  const Hooks = {
    on: (k, fn) => { (hooks[k] ??= []).push({ id: ++hid, fn }); return hid; },
    once: (k, fn) => { (hooks[k] ??= []).push({ id: ++hid, fn, once: true }); return hid; },
    off: (k, id) => { hooks[k] = (hooks[k] ?? []).filter((h) => h.id !== id); },
    callAll: (k, ...a) => { for ( const h of [...(hooks[k] ?? [])] ) { if ( h.once ) Hooks.off(k, h.id); h.fn(...a); } return true; },
    call: (k, ...a) => { for ( const h of [...(hooks[k] ?? [])] ) { if ( h.once ) Hooks.off(k, h.id); if ( h.fn(...a) === false ) return false; } return true; }
  };
  const seat = { name, gm, reg, menus, Hooks, notes, ls: new LS(ls), sig: { osReduced }, ui: { notifications: { info: (m) => notes.push(String(m)), warn: (m) => notes.push(String(m)), error: (m) => notes.push(`ERR ${m}`) } } };
  seat.matchMedia = (q) => ({ matches: /reduced-motion/.test(q) ? seat.sig.osReduced : false, addEventListener() {} });
  const settings = {
    settings: reg, menus,
    register: (ns, k, o) => reg.set(`${ns}.${k}`, { ...o, namespace: ns, key: k, id: `${ns}.${k}`, scope: o.scope ?? "client" }),
    registerMenu: (ns, k, o) => menus.set(`${ns}.${k}`, o),
    get(ns, k) {
      const id = `${ns}.${k}`, cfg = reg.get(id);
      if ( !cfg ) throw new Error(`"${id}" is not a registered game setting`);
      if ( cfg.scope === "client" ) { const raw = seat.ls.getItem(id); if ( raw === null ) return clone(cfg.default); try { return JSON.parse(raw); } catch { return raw; } }
      return world.store.has(id) ? clone(world.store.get(id)) : clone(cfg.default);
    },
    async set(ns, k, v) {
      const id = `${ns}.${k}`, cfg = reg.get(id);
      if ( !cfg ) throw new Error(`"${id}" is not a registered game setting`);
      if ( cfg.scope === "client" ) { seat.ls.setItem(id, JSON.stringify(v)); cfg.onChange?.(v); Hooks.callAll("clientSettingChanged", id, v, {}); return v; }
      const had = world.store.has(id), doc = { key: id, value: v };
      /* v14: the writing seat's pre-hooks may stop it (create then returns no document: Foundry's set reads .value of it) */
      if ( Hooks.call(had ? "preUpdateSetting" : "preCreateSetting", doc, { value: v }, {}, name) === false ) { if ( had ) return clone(world.store.get(id)); throw new TypeError("Cannot read properties of undefined (reading 'value')"); }
      if ( !seat.gm ) { seat.ui.notifications.error("lacks permission"); throw new Error(`User ${name} lacks permission to ${had ? "update" : "create"} Setting`); }
      world.store.set(id, clone(v));
      world.writes.push([name, id, clone(v)]);
      for ( const s of world.seats ) world.with(s, () => { s.reg.get(id)?.onChange?.(clone(v)); s.Hooks.callAll(had ? "updateSetting" : "createSetting", { key: id, value: clone(v) }, {}, name); });
      return v;
    },
    /* a reset (Foundry deletes the document; no onChange) */
    async reset(ns, k) { const id = `${ns}.${k}`; if ( !seat.gm || !world.store.has(id) ) return; world.store.delete(id); for ( const s of world.seats ) world.with(s, () => s.Hooks.callAll("deleteSetting", { key: id }, {}, name)); },
    storage: { get: (w) => (w === "world" ? { getSetting: (key) => (world.store.has(key) ? { key, value: clone(world.store.get(key)) } : null) } : null) }
  };
  seat.game = {
    user: { id: name, name, isGM: gm }, users: { get: () => null }, ready: false, settings, keybindings: { register() {} },
    i18n: { lang: "en", format: (k) => k, localize: (k) => k, has: () => false, translations: {} },
    socket: { emit() {}, on() {} }, time: { serverTime: 0 },
    modules: new Map(modules.map((id) => [id, { id, active: true }]))
  };
  world.seats.push(seat);
  return seat;
}
function fakeEngine(D, fontsApi) {
  const ext = { opts: [], plan: [], start: [], preview: [] };
  const L = {
    _ext: ext, limits: { screen: 16, world: 48 }, version: "test", _mode: "smooth", _face: "league",
    stream: () => ({}), gridClock() {},
    motionMode(m) { if ( m ) L._mode = m; return L._mode; }, invFace(f) { if ( f ) L._face = f; return L._face; },
    /* the engine's play path as far as the preferences reach: options filter, plan, plan filter */
    play(text, opts = {}) {
      let o = { ...opts };
      for ( const f of ext.opts ) { const r = f(o); if ( r === null ) return { off: true }; if ( r ) o = r; }
      const plan = D.makePlan(text, { ...o, look: { style: "invincible", face: L._face, motion: L._mode, ...(o.look ?? {}) } }, fontsApi, []);
      for ( const f of ext.plan ) f(plan, { opts: o, size: 40, space: "screen" });
      return { off: false, plan, opts: o };
    }
  };
  return L;
}
let inst = 0;
async function bootSeat(world, seat, D, fontsApi) {
  const T = await import(`./tools.mjs?seat=${++inst}`);
  const L = fakeEngine(D, fontsApi);
  seat.T = T; seat.L = L;
  globalThis.foundry ??= { applications: { api: { ApplicationV2: class {} } }, utils: { expandObject: (o) => o, mergeObject: (a, b) => Object.assign(a, b) } };
  globalThis.document ??= { addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {} }), body: { appendChild() {} } };
  seat.game.settings.register("core", "photosensitiveMode", { scope: "client", default: false });
  world.with(seat, () => {
    T.init({ engine: () => Promise.resolve(L), _engine: L, build: { version: "test", hash: null, module: null } });
    T.state.clock.start = () => {};
    seat.Hooks.callAll("setup");
  });
  const { createImpact } = await import("./impact/index.mjs");
  seat.I = createImpact(L, T);
  return seat;
}
async function readyAll(world) { for ( const s of world.seats ) { s.game.ready = true; await world.run(s, async () => { s.Hooks.callAll("ready"); await tick(10); }); } }

/* =============================================================== 4-7 */
async function seats(ok, { P, D, fontsApi }) {
  const saved = { game: globalThis.game, Hooks: globalThis.Hooks, localStorage: globalThis.localStorage, ui: globalThis.ui, matchMedia: globalThis.matchMedia, foundry: globalThis.foundry, document: globalThis.document, warn: console.warn, info: console.info };
  console.warn = () => {}; console.info = () => {};
  try {
    /* ----- a world from 1.9.14: the GM's own old client values, a player's own ----- */
    const world = makeWorld(); world.writes = [];
    const OLD_GM = { [`${NS}.impact`]: "local", [`${NS}.motion`]: "full", [`${NS}.scale`]: 1.4, [`${NS}.photosafe`]: false, [`${NS}.limitWorld`]: 30 };
    const OLD_PL = { [`${NS}.palette`]: "cvd", [`${NS}.flashes`]: false };
    const gm = makeSeat(world, { name: "GM", gm: true, ls: OLD_GM });
    const pl = makeSeat(world, { name: "Player", gm: false, ls: OLD_PL });
    await bootSeat(world, gm, D, fontsApi); await bootSeat(world, pl, D, fontsApi);

    /* 1. inventory, as registered */
    const regs = [...gm.reg.values(), ...pl.reg.values()].filter((c) => c.namespace === NS);
    ok(regs.length > 0 && regs.every((c) => c.scope === "world"), `table: no client-scope preference remains (registered: ${[...new Set(regs.map((c) => `${c.key}:${c.scope}`))].join(", ")})`);
    ok(["table", "movement", "face"].every((k) => gm.reg.has(`${NS}.${k}`)) && !["enabled", "scale", "motion", "flashes", "photosafe", "impact", "palette", "announce", "limitScreen", "limitWorld"].some((k) => gm.reg.has(`${NS}.${k}`)), "table: the table object, movement and face registered; none of the old client keys (an older mirror finds nothing to write)");
    ok(gm.menus.get("moinen-maps.letters")?.restricted === false, "table: one menu for everyone (a player opens the window read-only)");

    /* 6. migration */
    await readyAll(world);
    const tbl = () => world.store.get(`${NS}.table`);
    ok(tbl()?.impact === "local" && tbl()?.scale === 1.4 && tbl()?.motion === "auto" && tbl()?.limitWorld === 30, `table: migration: the GM's old values became the table's, Full as auto (${JSON.stringify(tbl())})`);
    ok(tbl() && !("photosafe" in tbl()) && gm.T.state.prefs.photosafe === true, "table: migration: the old guard switch (off) is dropped; the guard is on");
    ok(tbl()?.palette === "mood" && tbl()?.flashes === true, "table: migration: a player's old values are not taken");
    ok(world.store.get(`${NS}.tableMigrated`) === 1, "table: migration marked done");
    const nw = world.writes.length;
    await world.run(gm, () => gm.T.migrate());
    ok(world.writes.length === nw, "table: a second migration writes nothing");
    ok(pl.ls.getItem(`${NS}.palette`) === JSON.stringify("cvd") && gm.ls.getItem(`${NS}.scale`) === "1.4", "table: old browser values stay where they were (unused)");
    ok(pl.notes.filter((m) => /Settings\.Moved/.test(m)).length === 1, "table: the player whose own old values differed is told once");
    await world.run(pl, async () => { pl.Hooks.callAll("ready"); await tick(10); });
    ok(pl.notes.filter((m) => /Settings\.Moved/.test(m)).length === 1, "table: ... only once");
    ok(pl.T.state.table.scale === 1.4 && pl.T.state.prefs.impact === "local", "table: the player's seat applies the migrated table");

    /* 4. a player cannot change any */
    {
      const before = JSON.stringify([...world.store]); pl.notes.length = 0;
      const r = await world.run(pl, () => pl.T.setTable({ scale: 2.5, enabled: false, movement: "stepped" }));
      ok(r === false && JSON.stringify([...world.store]) === before, "table: a player's setTable writes nothing (refused)");
      ok(pl.notes.some((m) => /Settings\.Refused/.test(m)), "table: ... and he is told the GM chooses");
      let threw = false, got = null;
      try { got = await world.run(pl, () => pl.game.settings.set(NS, "table", { ...tbl(), scale: 2.5 })); } catch { threw = true; }
      ok(JSON.stringify([...world.store]) === before && (threw || got?.scale === 1.4) && !pl.notes.some((m) => /^ERR/.test(m)), "table: a player's direct write of the table is stopped on his seat (nothing sent, no error on his screen)");
      try { await world.run(pl, () => pl.game.settings.set(NS, "movement", "stepped")); } catch {}
      ok(JSON.stringify([...world.store]) === before, "table: ... also of movement");
      const m = await world.run(pl, () => pl.I.setMode("off"));
      ok(m === "local" && JSON.stringify([...world.store]) === before, "table: a player's impact switch is refused (the table's mode stays)");
    }

    /* 5. a GM change reaches the second seat live, on its next word */
    {
      const word = (s, t = "KRAK!", o = {}) => world.with(s, () => s.L.play(t, { mood: "crack", seed: "w1", ...o }));
      const set = (v) => world.run(gm, () => gm.T.setTable(v));
      await set({ scale: 1.7 });
      ok(word(pl).opts._k === 1.7 && word(gm).opts._k === 1.7, "table live: size reaches the player's next word");
      await set({ palette: "contrast" });
      ok(word(pl).plan.hand.hiContrast === true, "table live: colours (high contrast) reach the player's next word");
      await set({ palette: "mood", motion: "gentle" });
      { const w = word(pl, "WHAM!", { mood: "impact", in: "slam" }); ok(w.opts.reduced === false && (w.plan.motion ? w.plan.motion.damp === 0.45 : true) && [...w.plan.timeline.ent, ...w.plan.timeline.hold].every((p) => !p.smear), "table live: Gentle reaches the player's next word (damped, no smear)"); }
      await set({ motion: "reduced" });
      ok(word(pl).opts.reduced === true && word(gm).opts.reduced === true, "table live: Reduced reaches every seat");
      await set({ motion: "auto" });
      ok(word(pl).opts.reduced === false, "table live: Full again");
      /* flash frames: a word that carries one (legacy style, impact mood) */
      let fw = null; for ( let i = 0; i < 300 && !fw; i++ ) { const w = word(pl, "POW!", { mood: "impact", seed: `fl${i}`, look: { style: "expressive" } }); if ( P.flashTimes(w.plan, D.TICK).length ) fw = `fl${i}`; }
      ok(!!fw, "table live: test material (a word with a flash frame)");
      if ( fw ) {
        pl.T.state.flashLog.length = 0;
        await set({ flashes: false });
        ok(P.flashTimes(word(pl, "POW!", { mood: "impact", seed: fw, look: { style: "expressive" } }).plan, D.TICK).length === 0, "table live: flash frames off reach the player's next word");
        await set({ flashes: true });
        pl.T.state.flashLog.length = 0;
        ok(P.flashTimes(word(pl, "POW!", { mood: "impact", seed: fw, look: { style: "expressive" } }).plan, D.TICK).length > 0, "table live: flash frames back");
      }
      await set({ impact: "off" });
      ok(world.with(pl, () => pl.I.mode()) === "off", "table live: impact frames off reach the player's seat");
      await set({ impact: "full" });
      await set({ announce: false });
      ok(pl.T.state.prefs.announce === false, "table live: screen reading reaches the player's seat");
      await set({ announce: true, limitScreen: 5, limitWorld: 12 });
      ok(pl.L.limits.screen === 5 && pl.L.limits.world === 12, "table live: limits reach the player's engine");
      await set({ movement: "stepped", face: "anton" });
      ok(pl.L._mode === "stepped" && pl.L._face === "anton" && word(pl).plan.hand.font === "anton", "table live: motion type and face reach the player's next word");
      await set({ enabled: false });
      ok(word(pl).off === true && word(gm).off === true, "table live: lettering off reaches every seat");
      await set({ ...P.TABLE_DEFAULTS });
      ok(word(pl).off === false && pl.T.state.table.scale === 1 && pl.L._face === "league", "table live: the defaults back");
      /* a reset that deletes the document (no onChange in Foundry) is followed too */
      await set({ scale: 2 });
      await world.run(gm, () => gm.game.settings.reset(NS, "table"));
      ok(pl.T.state.table.scale === 1, "table live: a deleted table document (reset) is followed on every seat");
    }

    /* 2. seat signals on a live table */
    {
      pl.sig.osReduced = true;
      world.with(pl, () => pl.T.readPrefs());
      const wp = world.with(pl, () => pl.L.play("KRAK!", { mood: "crack", seed: 2 })), wg = world.with(gm, () => gm.L.play("KRAK!", { mood: "crack", seed: 2 }));
      ok(wp.opts.reduced === true && wg.opts.reduced === false && pl.T.state.table.motion === "auto", "table seat: the player's system reduced motion gives him the calm picture, the GM keeps full, the table unchanged");
      pl.sig.osReduced = false;
      await world.run(pl, () => pl.game.settings.set("core", "photosensitiveMode", true));
      ok(pl.T.state.prefs.flashes === false && gm.T.state.prefs.flashes === true && world.with(pl, () => pl.I.mode()) === "full" && pl.T.state.table.flashes === true, "table seat: Foundry photosensitive mode: no flash frames on that seat only");
      const { modeFor } = await import("./impact/plan.mjs");
      ok(modeFor(pl.T.state.prefs, {}) === "local" && modeFor(gm.T.state.prefs, {}) === "full", "table seat: ... and its impact frames stay in a panel");
      await world.run(pl, () => pl.game.settings.set("core", "photosensitiveMode", false));
      ok(pl.T.state.prefs.flashes === true, "table seat: ... off again");
    }

    /* 7. situations: maps alone (above: no plus-ultra key, no bridge writes) */
    ok(!world.writes.some(([, id]) => id.startsWith(`${PU}.`)), "table: maps alone: nothing written outside the engine's namespace");
  } finally {
    await tick(600);   /* each booted seat says hello 500 ms after ready: let it run on the fake table, not on the restored globals */
    Object.assign(globalThis, { game: saved.game, Hooks: saved.Hooks, localStorage: saved.localStorage, ui: saved.ui, matchMedia: saved.matchMedia, foundry: saved.foundry, document: saved.document });
    console.warn = saved.warn; console.info = saved.info;
  }
  await situations(ok, { P, D, fontsApi, saved: null });
}

/* =============================================================== 7: the situations (ENGDROP 1.9.19: no bridge)
   A world from GMALL: plus-ultra's old copy `lettersTable` (the GM's choices made in its window) lies in the world, the engine has not
   migrated. Opened with maps alone (nobody registers the copy), plus-ultra 136+ alone or both (it registers the copy, written by nobody,
   only while the engine has not migrated): the engine's migration reads the copy's DOCUMENT in every case. Then an OLDER plus-ultra
   (132-135: the copy always registered, its window writes it, its mirror would write the engine's old client keys). */
async function situations(ok, { P, D, fontsApi }) {
  const saved = { game: globalThis.game, Hooks: globalThis.Hooks, localStorage: globalThis.localStorage, ui: globalThis.ui, matchMedia: globalThis.matchMedia, foundry: globalThis.foundry, document: globalThis.document, warn: console.warn, info: console.info };
  console.warn = () => {}; console.info = () => {};
  const OLD = { enabled: true, motion: "gentle", scale: 1.2, palette: "cvd", flashes: true, impact: "local", announce: true, limitScreen: 16, limitWorld: 48 };
  const told = (s, re) => s.notes.filter((m) => re.test(m)).length;
  try {
    for ( const [label, modules, registers] of [["maps alone", ["moinen-maps"], false], ["plus-ultra alone", [PU], true], ["both", ["moinen-maps", PU], true]] ) {
      const world = makeWorld(); world.writes = [];
      world.store.set(`${PU}.lettersTable`, clone(OLD));
      const gm = makeSeat(world, { name: "GM", gm: true, modules, ls: { [`${NS}.scale`]: 2 } }), pl = makeSeat(world, { name: "Player", gm: false, modules, ls: { [`${NS}.palette`]: "contrast" } });
      if ( registers ) for ( const s of [gm, pl] ) s.game.settings.register(PU, "lettersTable", { scope: "world", config: false, type: Object, default: {} });
      await bootSeat(world, gm, D, fontsApi); await bootSeat(world, pl, D, fontsApi);
      const host = modules.includes("moinen-maps") ? "moinen-maps" : PU;
      ok(gm.menus.has(`${host}.letters`) && gm.T.state.host === host, `table ${label}: the window's menu sits in ${host}'s settings`);
      await readyAll(world);
      const tbl = () => world.store.get(`${NS}.table`);
      ok(tbl()?.scale === 1.2 && tbl()?.palette === "cvd" && tbl()?.motion === "gentle" && tbl()?.impact === "local", `table ${label}: migration takes plus-ultra's old copy from its document, over the GM's browser values (${JSON.stringify(tbl())})`);
      ok(pl.T.state.prefs.palette === "cvd" && pl.T.state.prefs.scale === 1.2, `table ${label}: the player's seat applies it`);
      ok(told(pl, /Settings\.Moved/) === 1, `table ${label}: the player whose own old values differ is told once, by the engine`);
      await world.run(gm, () => gm.T.setTable({ palette: "contrast", flashes: false }));
      await tick(10);
      ok(pl.T.state.prefs.palette === "contrast" && pl.T.state.prefs.flashes === false, `table ${label}: a GM change reaches the player's seat`);
      ok(!world.writes.some(([, id]) => id.startsWith(`${PU}.`)) && JSON.stringify(world.store.get(`${PU}.lettersTable`)) === JSON.stringify(OLD), `table ${label}: nothing written into plus-ultra's namespace; its old copy stays as it was`);
      ok(told(gm, /Settings\.OldPlusUltra/) === 0, `table ${label}: no 'older plus-ultra' notice on a current install`);
      ok(!world.writes.some(([who]) => who === "Player"), `table ${label}: the player's seat writes nothing`);
    }

    for ( const migrated of [true, false] ) {
      const label = `older plus-ultra, ${migrated ? "engine migrated before" : "first run of the engine"}`;
      const world = makeWorld(); world.writes = [];
      world.store.set(`${PU}.lettersTable`, clone(OLD));
      if ( migrated ) { world.store.set(`${NS}.table`, { ...Object.fromEntries(P.TABLE_OBJECT.map((k) => [k, P.TABLE_DEFAULTS[k]])), scale: 1.3 }); world.store.set(`${NS}.tableMigrated`, 1); }
      const modules = ["moinen-maps", PU];
      const gm = makeSeat(world, { name: "GM", gm: true, modules }), pl = makeSeat(world, { name: "Player", gm: false, modules });
      /* GMALL's registration: always, with its mirror on change (it writes the engine's old client keys only when they are registered) */
      for ( const s of [gm, pl] ) s.game.settings.register(PU, "lettersTable", { scope: "world", config: false, type: Object, default: {},
        onChange: () => { if ( s.reg.has(`${NS}.enabled`) ) s.notes.push("ERR mirror wrote"); } });
      await bootSeat(world, gm, D, fontsApi); await bootSeat(world, pl, D, fontsApi);
      await readyAll(world);
      const tbl = () => world.store.get(`${NS}.table`);
      const base = migrated ? 1.3 : 1.2;
      ok(tbl()?.scale === base && pl.T.state.table.scale === base, `table ${label}: every seat on the engine's table (size ${base}: ${migrated ? "the old copy is not taken again" : "migrated from the old copy"})`);
      ok(told(gm, /Settings\.OldPlusUltra/) === (migrated ? 1 : 0) && told(pl, /Settings\.OldPlusUltra/) === 0, `table ${label}: the GM is told at once to update plus-ultra only where it can be known (registered after the engine migrated)`);
      /* the older window writes its copy: one key changed (size) next to its stale others (colours, motion) */
      const w0 = world.writes.length;
      await world.run(gm, () => gm.game.settings.set(PU, "lettersTable", { ...OLD, scale: 0.8 }));
      await tick(10);
      ok(tbl()?.scale === 0.8 && pl.T.state.prefs.scale === 0.8, `table ${label}: a change made in the older window reaches the table and the player's seat (no GM choice lost)`);
      if ( migrated ) ok(tbl()?.palette === "mood" && tbl()?.motion === "auto" && tbl()?.impact === "full", `table ${label}: only the key that write changed is taken; the older window's stale values do not undo the table (${JSON.stringify(tbl())})`);
      ok(told(gm, /Settings\.OldPlusUltra/) === 1, `table ${label}: the GM is told once`);
      await world.run(gm, () => gm.T.setTable({ impact: "off" }));
      await tick(10);
      ok(world.writes.slice(w0).filter(([, id]) => id.startsWith(`${PU}.`)).length === 1 && world.store.get(`${PU}.lettersTable`).impact === "local",`table ${label}: the engine writes nothing back into the older copy (no mirror)`);
      ok(pl.T.state.prefs.impact === "off" && world.with(pl, () => pl.I.mode()) === "off", `table ${label}: the engine window's change reaches the player`);
      ok(!pl.reg.has(`${NS}.enabled`) && !pl.notes.some((m) => /^ERR/.test(m)) && !gm.notes.some((m) => /^ERR/.test(m)), `table ${label}: the older mirror finds no engine client key to write (inert, no error)`);
      const n = world.writes.length; await tick(20);
      ok(world.writes.length === n && !world.writes.some(([who]) => who === "Player"), `table ${label}: no write loop; the player's seat writes nothing`);
    }
  } finally {
    await tick(600);   /* each booted seat says hello 500 ms after ready: let it run on the fake table, not on the restored globals */
    Object.assign(globalThis, { game: saved.game, Hooks: saved.Hooks, localStorage: saved.localStorage, ui: saved.ui, matchMedia: saved.matchMedia, foundry: saved.foundry, document: saved.document });
    console.warn = saved.warn; console.info = saved.info;
  }
}

if ( process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] ) {
  let n = 0, failed = 0;
  await run((c, m) => { n++; if ( !c ) { failed++; console.log("FAIL", m); } else if ( process.env.LETR_VERBOSE ) console.log("ok  ", m); });
  console.log(`table: ${n} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
