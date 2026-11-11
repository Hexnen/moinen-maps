// Zones, the map API under attack (ledger D70-D87 of the combat project, "Adversary 7"): what the fixes of those defects must keep.
// Calls that must come back (planAlong), drags and level changes that must be asked, ids that are never given twice, reach counted
// from the mover's level, the route and the area a pick answers with, an intention said again, shows / picks / menus that end with
// the thing or the user they hang on, clears that name nothing, inverses with a token gone, bad input.
// Every case runs in its own node process (a hang is a failed case, and the module state of one case never reaches the next) with
// the stand-in Foundry of dev/zones-adv7-kit.mjs.   node dev/zones-adv7.test.mjs [case]
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const me = fileURLToPath(import.meta.url), one = process.argv[2] ?? null;

const CASES = {
  /* D70: planAlong for an end this way of moving cannot be at comes back with null (it used to loop for ever) */
  async D70(K) {
    const { api, makeScene, open, ROW, check, J } = K;
    const sc = makeScene(ROW, [["t1", 0, 0], ["t3", 450, 50, { floor: 2 }], ["t4", 800, 100, { alt: "elevated", air: true }]]);
    open(sc);
    const T = (id) => sc.tokens.get(id);
    check(api.planAlong("z4", ["z4", "z5"], { end: { level: "elevated" } }) === null && api.plan("z4", "z5:elevated", { way: "walk" }) === null, "a walker asked to end in the air over open ground: planAlong null, as plan");
    check(api.planAlong(T("t1"), ["z1"], { end: { level: "underground" } }) === null, "a walker asked to end underground in its own zone: null");
    check(api.planAlong("z4", ["z4", "z5"], { profile: { way: "swim" }, end: { level: "underground" } }) === null, "a swimmer asked to end underground: null");
    check(api.planAlong(T("t4"), ["z5", "z4"], {}) === null && api.plan(T("t4"), "z4", { way: "walk" }) === null, "a walker that hangs in the air has no plan along a chain either (no level steps that go nowhere)");
    check(api.planAlong("z4", ["z4", "z5"], { end: "elevated" })?.end?.spot === "z5" && api.planAlong("z4", ["z4", "z5"], { end: { level: "bogus" } })?.end?.spot === "z5", "an `end` that is no object, or a level that is none, is read as the ground (as api.place reads it)");
    const a = api.planAlong("z4", ["z4", "z5"], {}), b = api.planAlong(T("t3"), ["z3"], { end: { level: "ground" } }), c = api.planAlong(T("t4"), ["z5", "z4"], { forced: true });
    check(a?.total === 1 && b?.total === 2 && J(b.steps.map((s) => s.to)) === J(["z3:f1", "z3"]), "the chains that can be walked are as before: one border; two floors down");
    check(c?.forced === true && c.total === 1 && c.end.airborne === true, "a forced chain of a mover in the air is still laid out (nobody walks stairs while thrown)");
    check(api.planAlong("z4", ["z4", "z5"], { profile: { way: "burrow" }, end: { level: "underground" } })?.end?.spot === "z5:underground", "a burrower may end underground");
  },

  /* D71: leaving the zones and coming back into one is a change of zone: held and asked */
  async D71(K) {
    const { api, makeScene, open, ROW, as, tick, check } = K;
    const sc = makeScene(ROW, [["t1", 0, 0], ["t2", 100, 0], ["t9", 100, -300], ["t8", 300, 0, { alt: "sky" }]]);
    open(sc);
    const T = (id) => sc.tokens.get(id), where = (id) => api.zoneOfToken(T(id))?.spot ?? "none";
    const asked = [];
    api.tactical({ confirm: (ctx) => { asked.push(ctx); return false; } });
    as("p1");
    let u = await T("t2").update({ x: 850, y: 50 }); await tick();
    check(!u && asked.length === 1 && asked[0].to.spot === "z5" && where("t2") === "z1", "a straight drag into another zone is held and asked");
    asked.length = 0;
    u = await T("t1").update({ x: 100, y: -300 }); await tick();
    check(!u && asked.length === 1 && asked[0].to.zone === null && asked[0].plan === null && asked[0].reachable === false && where("t1") === "z1", "a drop outside every zone is held and asked: to.zone null, no plan, not reachable; the token stays");
    asked.length = 0;
    u = await T("t9").update({ x: 850, y: 50 }); await tick();
    check(!u && asked.length === 1 && asked[0].from.zone === null && asked[0].to.spot === "z5" && asked[0].plan === null && where("t9") === "none", "a drop into a zone from outside the zones is held and asked: from.zone null, no plan");
    asked.length = 0;
    u = await T("t9").update({ x: 300, y: -300 }); await tick();
    const v = await T("t1").update({ x: 50, y: 50 }); await tick();
    const w = await T("t8").update({ x: 850, y: 50 }); await tick();
    check(!!u && !!v && !!w && !asked.length, "not asked: a drag outside the zones, a drag inside one zone, a token on an off-map level");
    api.tactical({ confirm: () => true });
    u = await T("t1").update({ x: 100, y: -300 }); await tick(20);
    check(!u && where("t1") === "z1", "a yes to a drop outside the zones moves nothing (there is no plan to move along)");
    // the GM's own drop out of the zones or into them is a placement (as with Alt): written, the caller told, undone by its inverse
    as("gm"); asked.length = 0;
    const placed = [];
    api.tactical({ gm: true, confirm: (ctx) => { asked.push(ctx); return false; }, place: (ctx) => placed.push(ctx) });
    u = await T("t1").update({ x: 100, y: -300 }); await tick();
    check(!!u && !asked.length && placed.length === 1 && placed[0].free === true && placed[0].from.spot === "z1" && placed[0].to.zone === null && where("t1") === "none", "the GM drops a token outside the zones: placed, not asked, place(ctx) told");
    u = await T("t1").update({ x: 850, y: 50 }); await tick();
    check(!!u && !asked.length && placed.length === 2 && placed[1].to.spot === "z5", "the GM drops it back into a zone: placed the same way");
    const back = await api.apply(placed[1].inverse), back2 = await api.apply(placed[0].inverse);
    check(back.ok && back2.ok && where("t1") === "z1" && T("t1").x === 50 && T("t1").y === 50, "the two inverses put it back where it stood");
    u = await T("t1").update({ x: 850, y: 50 }); await tick();
    check(!u && asked.length === 1 && placed.length === 2, "the GM's drag from zone to zone is still asked");
    api.tactical({ gm: true, free: false, confirm: (ctx) => { asked.push(ctx); return false; }, place: (ctx) => placed.push(ctx) });
    u = await T("t1").update({ x: 100, y: -300 }); await tick();
    check(!u && asked.length === 2 && placed.length === 2, "with the free placement switched off the GM's drop outside the zones is asked like a player's");
    api.tactical(false);
  },

  /* D72: Alt is not believed held after the window lost the focus; the gesture itself still works */
  async D72(K) {
    const { api, makeScene, open, ROW, as, tick, win, keyboard, check } = K;
    const sc = makeScene(ROW, [["t1", 650, 50], ["t2", 650, 100], ["t3", 700, 0]]);
    open(sc);
    const T = (id) => sc.tokens.get(id);
    const asked = [], placed = [];
    api.tactical({ gm: true, confirm: (ctx) => { asked.push(ctx.to.spot); return false; }, place: (ctx) => placed.push(ctx) });
    as("gm");
    win.fire("keydown", { altKey: true, key: "Alt" }); keyboard.alt = true;
    win.fire("blur", {}); keyboard.alt = false;                                   // Alt+Tab: no key-up ever arrives
    let u = await T("t1").update({ x: 850, y: 50 }); await tick();
    check(!u && asked.length === 1 && !placed.length, "after Alt+Tab the GM's plain drag is asked, not placed for free");
    win.fire("keydown", { altKey: true, key: "Alt" });
    win.fire("pointerup", { altKey: false, button: 0 });                          // the drop itself says Alt is up (a key-up lost to another window)
    u = await T("t1").update({ x: 850, y: 50 }); await tick();
    check(!u && asked.length === 2 && !placed.length, "the release of the pointer says whether Alt is held: up at the drop is a priced drag");
    win.fire("pointerup", { altKey: true, button: 0 });
    u = await T("t2").update({ x: 850, y: 100 }); await tick();
    check(!!u && placed.length === 1 && placed[0].free === true && placed[0].inverse.skipMissing === true && asked.length === 2, "Alt held at the drop places the token free of cost and tells the caller (its inverse skips a token that is gone)");
    win.fire("pointerup", { altKey: false, button: 0 }); keyboard.alt = true;
    u = await T("t3").update({ x: 850, y: 0 }); await tick();
    check(!!u && placed.length === 2, "Foundry's own keyboard saying Alt is held is enough");
    keyboard.alt = false; api.tactical(false);
  },

  /* D73: a level change is held with x / y in the same update too */
  async D73(K) {
    const { api, makeScene, open, ROW, as, tick, check } = K;
    const sc = makeScene(ROW, [["t1", 650, 50], ["t2", 650, 100], ["t5", 700, 0]]);
    open(sc);
    const T = (id) => sc.tokens.get(id), where = (id) => api.zoneOfToken(T(id))?.spot;
    const asked = [];
    let yes = false;
    api.tactical({ levels: true, confirm: (ctx) => { asked.push(ctx); return yes; } });
    as("p1");
    let u = await T("t1").update({ x: T("t1").x + 1, "flags.moinen-maps.alt": "elevated" }); await tick();
    check(!u && asked.length === 1 && asked[0].level === true && asked[0].to.spot === "z4:elevated" && where("t1") === "z4" && T("t1").x === 650, "one pixel of movement beside a level change: held and asked as a level change, nothing written");
    yes = true;
    u = await T("t2").update({ x: 660, "flags.moinen-maps.alt": "elevated" }); await tick(20);
    check(asked.length === 2 && where("t2") === "z4:elevated" && T("t2").x === 660, "a yes writes the update as it was asked for (the level and the position)");
    yes = false; asked.length = 0;
    u = await T("t5").update({ x: 850, y: 0, "flags.moinen-maps.alt": "elevated" }); await tick();
    check(!u && asked.length === 1 && !asked[0].level && asked[0].to.spot === "z5:elevated" && where("t5") === "z4", "a drag into another zone that also sets a level is asked about the place it asks for");
    u = await T("t5").update({ x: 705, y: 0 }); await tick();
    check(!!u && asked.length === 1, "a drag inside the zone with no level in it still goes through");
    api.tactical({ confirm: () => false });                                       // an older caller: levels are not held
    u = await T("t5").update({ x: 710, "flags.moinen-maps.alt": "elevated" }); await tick();
    check(!!u && where("t5") === "z4:elevated", "without `levels: true` a level change inside the zone is not held, with or without x / y");
    api.tactical(false);
  },

  /* D74: an id of the registry is never given twice */
  async D74(K) {
    const { api, makeScene, open, ROW, MOD, check, J } = K;
    const sc = makeScene(ROW, []);
    open(sc);
    const a = await api.addZoneState("z1", { id: "s2", kind: "smoke" }), b = await api.addZoneState("z2", { kind: "fire", level: 2 }), c = await api.addZoneState("z3", { kind: "dark" });
    const ids = api.zoneStates().map((s) => s.id);
    check(new Set(ids).size === 3 && a.result.id === "s2" && b.result.id !== "s2" && c.result.id !== "s2", `after a caller's own id s2 the next ids pass it: ${J(ids)}`);
    const rm = await api.apply(c.inverse);
    check(rm.ok && rm.result.kind === "dark" && J(api.zoneStates().map((s) => s.kind).sort()) === J(["fire", "smoke"]), "the inverse of the third add removes the third state");
    const e = await api.addEdge({ id: "e9", kind: "portal", a: "z1", b: "z5" }), f = await api.addEdge({ kind: "tunnel", a: "z1", b: "z4" });
    check(e.result.id === "e9" && Number(f.result.id.slice(1)) > 9, "the same counter stays ahead of a caller's edge id");
    // a scene saved while the counter lagged behind an id in use (the old bug): the id in use is passed over
    const flag = JSON.parse(J(sc.flags[MOD].zones));
    delete flag.pn;
    const sc2 = makeScene(flag, []);
    open(sc2);
    const before = api.zoneStates().map((s) => s.id), d = await api.addZoneState("z5", { kind: "dark" });
    check(before.length === 2 && !before.includes(d.result?.id) && !api.edges().some((x) => x.id === d.result?.id), `a counter that lags behind the stored ids passes them over: ${d.result?.id} beside ${J(before)}`);
    const again = await api.addZoneState("z5", { id: before[0], kind: "ice" });
    check(again.ok === false && again.reason === "idTaken", "a caller's id that is in use is refused");
  },

  /* D75: reach counts from the level the mover is on, as plan and moveCost do */
  async D75(K) {
    const { api, makeScene, open, ROW, check, J, tick, moveTo, click } = K;
    const sc = makeScene(ROW, [["t3", 450, 50, { floor: 2 }], ["t4", 800, 100, { alt: "elevated", air: true }], ["t6", 650, 50], ["t7", 650, 100, { alt: "elevated", air: true }]]);
    open(sc);
    const T = (id) => sc.tokens.get(id), walk = { way: "walk", speed: 1 }, fly = { way: "flight", speed: 2 };
    await api.setBorderState("z2|z3", { door: { state: "open" } });
    const row = api.reach(T("t3"), walk).find((x) => x.zone === "z2"), mc = api.moveCost(T("t3"), "z2", walk);
    check(row && row.d === mc.cost.total && row.d === 3 && row.cost.within === mc.cost.within && row.cost.within === "no", "a walker on the second floor: reach says what moveCost says (two floors down and a border: 3, not within one action)");
    check(J(api.reach(T("t3"), walk)[0]) === J({ zone: "z3", id: 2, d: 0, cost: api.moves.costOf(0, api.profile(walk)) }), "the mover's own zone is the first row, d 0");
    check(J(api.reach(T("t4"), walk).map((x) => x.zone)) === J(["z5"]) && api.plan(T("t4"), "z4", walk) === null, "a walker hanging in the air is offered no zone it has no plan to");
    const flat = api.reach(T("t3"), walk, { flat: true }).find((x) => x.zone === "z2");
    check(flat?.d === 1 && flat.cost.within === "plain" && api.reach(T("t4"), walk, { flat: true }).some((x) => x.zone === "z4"), "`flat: true`: the borders alone from the ground of the zone, as it was");
    check(J(api.reach(T("t6"), walk)) === J(api.reach(T("t6"), walk, { flat: true })) && J(api.reach(T("t7"), fly)) === J(api.reach(T("t7"), fly, { flat: true })), "on the ground, and for a flyer in the air, nothing changes");
    check(J(api.reach(T("t3"), walk, { max: 1 }).map((x) => x.zone)) === J(["z3", "z2"]), "`max` still counts borders and edges (the stairs are not counted against it)");
    const pr = api.pickMove({ token: "t4", profile: walk, banner: false });
    moveTo(700, 100); click(700, 100);
    const res = await Promise.race([pr, tick(30).then(() => null)]);
    check(res && res.ok === false && res.reason === "noZones", "pickMove's own offer for the walker in the air: nothing to offer");
    check(api.showReach(T("t4"), walk, { id: "r" }) !== null && J(api.highlights().find((h) => h.id === "r").zones.map((z) => z.zone)) === J(["z5"]), "showReach draws the same rows");
  },

  /* D76: with no route of the caller's, pickMove draws and answers the map's own route (the one the price is counted on) */
  async D76(K) {
    const { api, makeScene, open, GRID, check, J, tick, moveTo, click } = K;
    const sc = makeScene(GRID([[500, 50, "wall"]]), [["t1", 200, 0]]);
    open(sc);
    const T = sc.tokens.get("t1"), walk = { way: "walk", speed: 3 }, want = J(api.plan(T, "z2", walk).zones.slice(1));
    let pr = api.pickMove({ token: "t1", profile: walk, banner: false });
    moveTo(750, 50); click(750, 50);
    let r = await Promise.race([pr, tick(30).then(() => null)]);
    check(r?.ok && J(r.route) === want && r.entry.label === "3", `the map's own offer answers the way round the wall it priced: ${J(r?.route)}`);
    pr = api.pickMove({ token: "t1", profile: walk, zones: [{ zone: "z2", cost: "1 quick action" }], banner: false });
    moveTo(750, 50); click(750, 50);
    r = await Promise.race([pr, tick(30).then(() => null)]);
    check(r?.ok && J(r.route) === want, "an entry that names no route: the same");
    pr = api.pickMove({ token: "t1", profile: { way: "walk", speed: 1, edges: false }, zones: [{ zone: "z2", route: ["z2"] }], banner: false });
    moveTo(750, 50); click(750, 50);
    r = await Promise.race([pr, tick(30).then(() => null)]);
    check(r?.ok && J(r.route) === J(["z2"]), "the caller's own way through the wall is still the caller's");
    // a zone this mover cannot walk to at all (walled off): the way that tries every border is drawn, so something shows
    const sc2 = makeScene(GRID([[500, 50, "wall"], [750, 100, "wall"]]), [["t1", 200, 0]]);
    open(sc2);
    pr = api.pickMove({ token: "t1", profile: walk, zones: [{ zone: "z2" }], banner: false });
    moveTo(750, 50); click(750, 50);
    r = await Promise.race([pr, tick(30).then(() => null)]);
    check(api.plan(sc2.tokens.get("t1"), "z2", walk) === null && r?.ok && J(r.route) === J(["z2"]), "where the mover has no route, the forced way is drawn and answered");
  },

  /* D77: pickArea answers for the zone that was clicked */
  async D77(K) {
    const { api, makeScene, open, ROW, check, J, raf, flushRaf, moveTo, click } = K;
    const sc = makeScene(ROW, [["t2", 850, 50], ["t3", 450, 50], ["t6", 850, 100, { alt: "elevated", air: true }]]);
    open(sc);
    raf.mode = "queue";
    let pr = api.pickArea({ zones: ["z3", "z4", "z5"], radius: 0, banner: false });
    moveTo(450, 150); flushRaf();
    moveTo(850, 150); click(850, 150);                                            // on to z5 and a click before the next frame
    let r = await pr; flushRaf();
    check(r.ok && r.zone === "z5" && J(r.area) === J(["z5"]) && J(r.caught) === J(["t2"]), `a click before the next hover frame: ${J({ zone: r.zone, area: r.area, caught: r.caught })}`);
    pr = api.pickArea({ zones: ["z3", "z4", "z5"], radius: 0, banner: false });
    click(850, 150);                                                              // a tap: the pointer never moved
    r = await pr; flushRaf();
    check(r.ok && J(r.area) === J(["z5"]) && J(r.caught) === J(["t2"]), "a tap with no pointer movement carries the area and who is caught");
    pr = api.pickArea({ zones: ["z5"], radius: 1, anyLevel: true, tokens: (d) => d.id !== "t2", banner: false });
    click(850, 150);
    r = await pr; flushRaf();
    check(r.ok && J(r.area) === J(["z5", "z4"]) && J(r.caught) === J(["t6"]), "radius, anyLevel and the caller's `tokens` are counted the same way at the click");
    check(api.highlights().length === 0 && api.tokenMarks().length === 0, "nothing of the area stays on the map after the pick");
    raf.mode = "now";
  },

  /* D78: an intention said again is sent again and stands; a GM who opens the scene later is sent it (zones-api.md 32) */
  async D78(K) {
    const { api, makeScene, open, ROW, as, takeSent, onSocket, tick, check, J } = K;
    const sc = makeScene(ROW, [["t3", 450, 50], ["t1", 850, 50]]);
    open(sc);
    const wire = () => takeSent().filter((x) => x.msg.op === "intent");
    const relay = () => { const m = wire(); as("gm"); for ( const x of m ) onSocket(x.msg, "p1"); as("p1"); return m; };
    const gmSees = () => { as("gm"); const n = api.intents().length; as("p1"); return n; };
    as("p1"); takeSent();
    check(api.intent(null) === true && wire().length === 0, "null with nothing standing sends nothing");
    const spec = { token: "t3", to: "t1", label: "Strike", ttl: 400 };
    api.intent(spec); await tick(60);
    const first = relay();
    check(first.length === 1 && J(first[0].to) === J(["gm", "gm2"]) && gmSees() === 1, "said: one message, to the GMs alone");
    await tick(250);
    const ret = api.intent(spec); await tick(60);
    const second = relay();
    check(ret === true && second.length === 1 && second[0].msg.intent.ttl === 400, "the same intention said again is sent again");
    await tick(250);
    check(gmSees() === 1, "620 ms after the first say, 310 after the second (ttl 400): it still stands on the GM's map");
    // a GM opens the scene later: it says hello, and is sent what stands with the ttl that is left
    onSocket({ t: "board", op: "hello", scene: "scene1" }, "gm2");
    const late = wire();
    check(late.length === 1 && J(late[0].to) === J(["gm2"]) && late[0].msg.intent.token === "t3" && late[0].msg.intent.ttl > 0 && late[0].msg.intent.ttl < 400, `a GM who opens the scene later is sent it at once, for the time left (${late[0]?.msg.intent.ttl} of 400 ms)`);
    onSocket({ t: "board", op: "hello", scene: "scene1" }, "p2"); onSocket({ t: "board", op: "hello", scene: "other" }, "gm2");
    check(wire().length === 0, "never to a player who opens the scene, nor to a GM on another scene");
    await tick(450);
    check(gmSees() === 0, "not said again: gone from the GM's map after the ttl");
    onSocket({ t: "board", op: "hello", scene: "scene1" }, "gm2");
    check(wire().length === 0, "an intention whose ttl is over is not sent to a late GM");
    // at most one message per 150 ms; of what is said in between the last goes
    api.intent({ ...spec, label: "A" }); api.intent({ ...spec, label: "B" }); api.intent({ ...spec, label: "C" });
    await tick(220);
    const burst = wire().map((m) => m.msg.intent.label);
    check(J(burst) === J(["A", "C"]), `three says at once: the first now, the last 150 ms later (${J(burst)})`);
    api.intent(null); await tick(200);
    const off = wire();
    check(off.length === 1 && off[0].msg.intent === null, "null takes it away");
    check(api.intent({ label: "nothing named" }) === false, "a spec that names nothing: false");
    // the sender leaves the scene with one standing: the GMs of that scene are told it is over; a late GM of the new scene gets nothing
    await tick(200); api.intent(spec); await tick(60); wire();
    open(makeScene(ROW, [["t3", 450, 50]], "scene2")); as("p1");
    const left = wire();
    check(left.length === 1 && left[0].msg.intent === null && left[0].msg.scene === "scene1", "the sender leaves the scene: the GMs there are told the intention is over");
    onSocket({ t: "board", op: "hello", scene: "scene2" }, "gm2");
    check(wire().length === 0, "and it is not sent to a GM who opens the new scene");
  },

  /* D79: the level of an area preview may be named by a token id or a level word; an unknown one catches nobody */
  async D79(K) {
    const { api, makeScene, open, ROW, check, J } = K;
    const sc = makeScene(ROW, [["t3", 450, 50], ["t6", 450, 50, { floor: 2 }], ["t7", 450, 100, { alt: "elevated", air: true }]]);
    open(sc);
    const T = (id) => sc.tokens.get(id), caught = (level) => J(api.areaPreview({ id: "a", at: "z3", radius: 0, tokens: true, ...(level === undefined ? {} : { level }) })?.tokens);
    check(caught(T("t3")) === J(["t3"]) && caught("t3") === J(["t3"]) && caught(T("t3").uuid) === J(["t3"]), "level: a TokenDocument, its id, its uuid - the same tokens");
    check(caught("t6") === J(["t6"]) && caught("z3:f2") === J(["t6"]) && caught("f2") === J(["t6"]) && caught({ level: "floor", floor: 2 }) === J(["t6"]), "a token upstairs, a spot, a level word, a place: that floor");
    check(caught("ground") === J(["t3"]) && caught("elevated") === J(["t7"]) && caught(api.place("z3")) === J(["t3"]), "the level words ground and elevated; a place");
    check(caught(undefined) === J(["t3", "t6", "t7"]) && caught(null) === J(["t3", "t6", "t7"]), "no level named: every level");
    check(caught("nobody") === J([]) && api.highlights().some((h) => h.id === "a"), "a level that names nothing (a token that is gone): the zones show, nobody is ringed");
    api.clearArea("a");
  },

  /* D80: a menu at a token and a pick for a token end with the token */
  async D80(K) {
    const { api, makeScene, open, ROW, check, J, tick, win, moveTo, click, deleteToken } = K;
    const sc = makeScene(ROW, [["t1", 650, 50], ["t2", 850, 50], ["t3", 450, 50], ["t4", 250, 50]]);
    open(sc);
    const mp = api.menu({ token: "t2", title: "T2", items: [{ id: "hit", label: "Hit" }] });
    deleteToken(sc, "t1");
    check(api.menuOpen(), "another token deleted: the menu stays");
    deleteToken(sc, "t2");
    win.fire("keydown", { key: "1" });
    const got = await Promise.race([mp, tick(20).then(() => "pending")]);
    check(!api.menuOpen() && J(got) === J({ ok: false, reason: "noAnchor" }), "the menu at a token closes when that token is deleted: noAnchor");
    const zm = api.menu({ zone: "z5", items: [{ id: "x", label: "X" }] });
    deleteToken(sc, "t4");
    check(api.menuOpen(), "a menu at a zone is not a token's");
    api.closeMenu(); await zm;
    const pr = api.pickMove({ token: "t3", profile: { way: "air", speed: 2 }, zones: [{ zone: "z5", cost: "quick" }], banner: false });
    deleteToken(sc, "t3");
    moveTo(850, 150); click(850, 150);
    const res = await Promise.race([pr, tick(20).then(() => "pending")]);
    check(!api.picking() && J(res) === J({ ok: false, reason: "noToken" }), "pickMove ends when its mover is deleted: noToken");
    const sc2 = makeScene(ROW, [["t1", 650, 50], ["t2", 850, 50]]);
    open(sc2);
    const pa = api.pickArea({ zones: ["z5"], radius: 0, token: "t1", banner: false });
    deleteToken(sc2, "t2");
    check(api.picking(), "an area pick does not end with some other token");
    deleteToken(sc2, "t1");
    check(J(await Promise.race([pa, tick(20).then(() => "pending")])) === J({ ok: false, reason: "noToken" }), "pickArea with a token ends when that token is deleted");
    const pb = api.pick({ zones: ["z5"], banner: false });
    deleteToken(sc2, "t9");
    check(api.picking(), "a plain pick is nobody's");
    api.cancelPick(); await pb;
  },

  /* D81: a pick that never began says nothing to the GMs */
  async D81(K) {
    const { api, makeScene, open, ROW, as, takeSent, tick, check, J, moveTo, click } = K;
    const sc = makeScene(ROW, [["t3", 450, 50]]);
    open(sc);
    as("p1"); takeSent();
    const wire = () => takeSent().filter((m) => m.msg.op === "intent").map((m) => (m.msg.intent ? m.msg.intent.label : null));
    const res = await api.pickMove({ token: "t3", zones: [], intent: { label: "Move" } });
    await tick(300);
    check(res.ok === false && res.reason === "noZones" && J(wire()) === J([]), "pickMove with nothing to offer: noZones, no intention sent");
    const ra = await api.pickArea({ zones: [], token: "t3", intent: { label: "Blast" } });
    await tick(300);
    check(ra.ok === false && J(wire()) === J([]), "pickArea with nothing to offer: the same");
    const pr = api.pickMove({ token: "t3", zones: [{ zone: "z5" }], intent: { label: "Move" }, banner: false });
    await tick(20);
    check(J(wire()) === J(["Move"]), "a pick that runs says the intention once it runs");
    moveTo(850, 150); click(850, 150); await pr; await tick(400);
    check(wire().at(-1) === null, "and takes it away when it ends");
  },

  /* D82: a clear that names no set takes nothing away; an empty list under an id in use replaces the set */
  async D82(K) {
    const { api, makeScene, open, ROW, as, takeSent, check, J } = K;
    const sc = makeScene(ROW, [["t1", 650, 50], ["t3", 450, 50]]);
    open(sc);
    as("gm");
    api.markTokens({ id: "a.one", tokens: ["t3"] }); api.markTokens({ id: "b.two", tokens: ["t1"], users: "all" });
    api.highlight({ id: "h.one", zones: ["z1"] }); api.highlight({ id: "h.two", zones: ["z2"], users: "all" });
    api.link({ id: "l.one", links: [{ from: "t1", to: "t3" }] });
    takeSent();
    const none = api.markTokens({ id: "c.three", tokens: [] });
    let n = 0;
    for ( const bad of [none, null, 5, false, { id: null }, { prefix: undefined }, [], ["a.one"]] ) n += api.clearTokenMarks(bad) + api.clearHighlights(bad) + api.clearLinks(bad);
    check(none === null && n === 0 && api.tokenMarks().length === 2 && api.highlights().length === 2 && api.links().length === 1 && takeSent().length === 0, "clearing with null, a number, { id: null }, a list: nothing goes, nothing is sent");
    api.markTokens({ id: "ipu.reach", tokens: [{ token: "t3", state: "in", label: "72%" }], users: "all" }); takeSent();
    const again = api.markTokens({ id: "ipu.reach", tokens: [] }), del = takeSent().filter((m) => m.msg.op === "tm" && m.msg.del?.includes("ipu.reach"));
    check(again === null && !api.tokenMarks().some((s) => s.id === "ipu.reach") && del.length === 1, "markTokens with no token under an id in use: the set goes, here and where it was sent");
    check(api.highlight({ id: "h.two", zones: [] }) === null && !api.highlights().some((h) => h.id === "h.two") && takeSent().some((m) => m.msg.op === "hl" && m.msg.del?.includes("h.two")), "highlight with nothing under an id in use: the same");
    check(api.link({ id: "l.one", links: [] }) === null && api.links().length === 0, "link with no line under an id in use: the same");
    check(api.markTokens({ id: "bad id!", tokens: [] }) === null && api.tokenMarks().length === 2, "an id that is none names no set");
    check(api.clearTokenMarks("a.one") === 1 && api.clearTokenMarks({ prefix: "b." }) === 1 && api.clearHighlights() === 1 && api.highlights().length === 0, "an id, a prefix and no argument (what this client made) clear as before");
    api.markTokens({ id: "x", tokens: ["t1"] });
    check(api.clearTokenMarks({ all: true }) === 1 && api.clearTokenMarks({ id: undefined, all: true }) === 0, "{ all: true } takes everything");
  },

  /* D83: a question does not outlive the other side or the scene */
  async D83(K) {
    const { api, makeScene, open, ROW, GRID, as, takeSent, onSocket, tick, win, users, els, check, J } = K;
    const sc = makeScene(ROW, [["t1", 650, 50]]), sc2 = makeScene(GRID(), [["u1", 200, 0]], "scene2");
    open(sc);
    // (a) the asked side: the GM who asked leaves
    as("p1"); takeSent();
    onSocket({ t: "zones", op: "pick", scene: "scene1", rid: "gm.1", pick: { zones: ["z5"], title: "Where?" } }, "gm");
    Hooks.callAll("userConnected", users.get("gm2"), false);
    check(api.picking(), "(a) another GM leaving does not end the pick");
    users.get("gm").active = false; Hooks.callAll("userConnected", users.get("gm"), false); await tick();
    check(!api.picking() && !els.some((e) => !e.gone && e.className === "mm-z-pick") && takeSent().some((m) => m.msg.op === "picked" && m.msg.result.reason === "userGone"), "(a) the GM who asked left: the pick ends on the asked client (userGone)");
    const own = api.pick({ zones: ["z5"], banner: false });
    Hooks.callAll("userConnected", users.get("gm"), false);
    check(api.picking(), "(a) this user's own pick is nobody else's");
    api.cancelPick(); await own; users.get("gm").active = true;
    // (b) the asking side: the GM changes scene while the player is still choosing
    as("gm"); takeSent();
    const pr = api.pick({ zones: ["z5"], user: "p1", title: "Where?" });
    await tick(5);
    const rid = takeSent().find((m) => m.msg.op === "pick")?.msg.rid;
    open(sc2);
    const mid = await Promise.race([pr, tick(20).then(() => "pending")]);
    const told = takeSent().filter((m) => m.msg.op === "pickCancel" && m.msg.rid === rid && J(m.to) === J(["p1"]));
    check(J(mid) === J({ ok: false, reason: "sceneChanged" }) && told.length === 1, "(b) the asking GM changes scene: sceneChanged, and the asked user is told to stop");
    onSocket({ t: "zones", op: "picked", scene: "scene1", rid, result: { ok: true, zone: "z5", id: 4, spot: "z5" } }, "p1");
    check(J(await pr) === J({ ok: false, reason: "sceneChanged" }), "(b) a late answer changes nothing");
    // (c) a context handler that answers after the scene changed
    open(sc); as("gm");
    const rc = (x, y) => { const ev = { button: 2, clientX: x, clientY: y, target: K.view, stopImmediatePropagation() {}, preventDefault() {} }; win.fire("pointerdown", ev); win.fire("pointerup", ev); };
    let give = null, done = null;
    const off = api.onContext((ctx) => (ctx.kind === "zone" ? new Promise((res) => { give = res; }) : null));
    rc(900, 150); await tick(5);
    open(sc2);
    give({ title: "Zone V", items: [{ id: "burn", label: "Set on fire" }], done: (r, ctx) => { done = { r, zone: ctx.zone }; } }); await tick(10);
    check(!api.menuOpen() && J(done) === J({ r: { ok: false, reason: "sceneChanged" }, zone: "z5" }), "(c) a menu spec that arrives after the scene changed opens nothing; done is told sceneChanged");
    give = null; done = null;
    rc(900, 150); await tick(5);
    give({ title: "Zone", items: [{ id: "burn", label: "Set on fire" }], done: (r) => { done = r; } }); await tick(10);
    const up = api.menuOpen();
    win.fire("keydown", { key: "1" }); await tick(10);
    check(up && done?.ok === true && done.id === "burn", "(c) on the scene it was asked on, a late spec still opens its menu");
    // a right press that is still down when the scene changes is forgotten
    const ev = { button: 2, clientX: 900, clientY: 150, target: K.view, stopImmediatePropagation() {}, preventDefault() {} };
    give = null; win.fire("pointerdown", ev);
    open(sc);
    win.fire("pointerup", { ...ev, target: K.view }); give?.({ items: [{ id: "a", label: "A" }] }); await tick(10);
    check(!api.menuOpen(), "(c) a right press held across a scene change opens nothing");
    off();
  },

  /* D84: what a user showed here goes when that user reloads or leaves */
  async D84(K) {
    const { api, makeScene, open, ROW, as, takeSent, onSocket, users, check, J } = K;
    const sc = makeScene(ROW, [["t3", 450, 50], ["t1", 850, 50]]);
    open(sc);
    as("gm"); takeSent();
    const show = () => {
      as("gm"); takeSent();
      api.markTokens({ id: "x.marks", tokens: [{ token: "t3", state: "in", label: "40%" }], users: "all" });
      api.link({ id: "x.line", from: "t3", to: "t1", users: "all" });
      api.highlight({ id: "x.zone", zones: ["z5"], users: "all" });
      const out = takeSent();
      api.clearTokenMarks({ all: true }); api.clearLinks({ all: true }); api.clearHighlights({ all: true }); takeSent();      // (one process plays both clients)
      as("p1");
      for ( const m of out ) onSocket(m.msg, "gm");
    };
    const seen = () => [api.tokenMarks().length, api.links().length, api.highlights().length];
    show();
    api.markTokens({ id: "mine", tokens: ["t1"] });
    onSocket({ t: "board", op: "tm", scene: "scene1", set: [{ id: "y.marks", tokens: [{ token: "t1", state: "in" }] }] }, "gm2");
    check(J(seen()) === J([3, 1, 1]), "the player sees the GM's marks, line and highlight, its own marks and another GM's");
    onSocket({ t: "board", op: "hello", scene: "scene1" }, "gm"); onSocket({ t: "zones", op: "hello", scene: "scene1" }, "gm");
    check(J(seen()) === J([2, 0, 0]) && J(api.tokenMarks().map((s) => s.id).sort()) === J(["mine", "y.marks"]), "the GM's client says hello anew (a reload): its shows go; the player's own and the other GM's stay");
    // what a page load sent BEFORE its own hello is its own: it stays (another module's canvasReady may run before the map's)
    onSocket({ t: "board", op: "tm", scene: "scene1", b: "page2", set: [{ id: "z.marks", tokens: [{ token: "t3", state: "in" }] }] }, "gm");
    onSocket({ t: "zones", op: "hl", scene: "scene1", b: "page2", set: [{ id: "z.zone", zones: ["z4"] }] }, "gm");
    onSocket({ t: "board", op: "hello", scene: "scene1", b: "page2" }, "gm"); onSocket({ t: "zones", op: "hello", scene: "scene1", b: "page2" }, "gm");
    check(api.tokenMarks().some((s) => s.id === "z.marks") && api.highlights().some((h) => h.id === "z.zone"), "sets a page sent before its own hello stay");
    onSocket({ t: "board", op: "hello", scene: "scene1", b: "page3" }, "gm"); onSocket({ t: "zones", op: "hello", scene: "scene1", b: "page3" }, "gm");
    check(!api.tokenMarks().some((s) => s.id === "z.marks") && !api.highlights().some((h) => h.id === "z.zone"), "the next page load's hello takes them");
    show();                                                                       // (emptying the GM's side took this process' other sets too)
    const had = J(seen());
    Hooks.callAll("userConnected", users.get("gm"), false);
    check(had === J([1, 1, 1]) && J(seen()) === J([0, 0, 0]), "the GM disconnects: the same");
    // an intention on a GM's map is kept by its own clock, not dropped by the sender's hello
    as("gm");
    onSocket({ t: "board", op: "intent", scene: "scene1", intent: { token: "t3", to: "t1", label: "Strike", ttl: 5000 } }, "p1");
    onSocket({ t: "board", op: "hello", scene: "scene1" }, "p1");
    check(api.intents().length === 1 && api.links().some((l) => l.id === "~intent.p1"), "a player's hello leaves that player's intention on the GM's map (its ttl ends it)");
    Hooks.callAll("userConnected", users.get("p1"), false);
    check(api.intents().length === 0 && !api.links().some((l) => l.id === "~intent.p1"), "the player leaving takes it along");
  },

  /* D85: the inverse of a move puts back the tokens that still exist; a move goes on without a token that was deleted on the way */
  async D85(K) {
    const { api, makeScene, open, ROW, check, J, deleteToken, takeEvents } = K;
    const sc = makeScene(ROW, [["t1", 650, 50], ["t2", 650, 100], ["t5", 700, 0], ["t6", 250, 50], ["t7", 250, 100]]);
    open(sc);
    const T = (id) => sc.tokens.get(id), where = (id) => api.zoneOfToken(T(id))?.spot;
    const mv = await api.move(T("t1"), "z5", { profile: { way: "walk", speed: 3 }, group: [T("t2")], wait: false });
    check(mv.ok && mv.done === 1 && mv.inverse.skipMissing === true && mv.inverse.rows.length === 2, "a hero and a minion move: one inverse for both, marked skipMissing");
    deleteToken(sc, "t2");
    const strict = await api.apply({ op: "tokens", rows: mv.inverse.rows });
    check(strict.ok === false && strict.reason === "noToken" && J(strict.missing) === J(["t2"]) && where("t1") === "z5", "a plain tokens op with a token that is gone: all or nothing (noToken, the missing ids named)");
    const back = await api.apply(mv.inverse);
    check(back.ok && back.changed === true && J(back.missing) === J(["t2"]) && where("t1") === "z4" && T("t1").x === 650, "the inverse puts the hero back and names the minion that is gone");
    const redo = await api.apply(back.inverse);
    check(redo.ok && where("t1") === "z5" && back.inverse.rows.length === 1, "the inverse of that inverse knows only the tokens it moved");
    deleteToken(sc, "t1");
    const none = await api.apply(mv.inverse);
    check(none.ok && none.changed === false && J(none.missing) === J(["t1", "t2"]), "every token of an inverse gone: ok, nothing changed");
    // a token of the group deleted while the move runs: the move goes on without it and ends properly
    takeEvents();
    let off = api.beforeStep((ctx) => { if ( ctx.index === 1 ) deleteToken(sc, "t7"); });
    const m2 = await api.move(T("t6"), "z4", { profile: { way: "through", speed: 3 }, group: [T("t7")], wait: false });
    off();
    const ev = takeEvents().filter((e) => e.type === "moveEnded");
    check(m2.ok && m2.done === 2 && m2.stopped === null && where("t6") === "z4" && ev.length === 1, "a group member deleted on the way: the move goes on and ends (moveEnded is told)");
    const b2 = await api.apply(m2.inverse);
    check(b2.ok && J(b2.missing) === J(["t7"]) && where("t6") === "z2", "and its inverse brings the mover back");
    // the mover itself deleted on the way: the move stops there, nothing throws
    off = api.beforeStep((ctx) => { if ( ctx.index === 1 ) deleteToken(sc, "t6"); });
    let m3 = null, threw = null;
    try { m3 = await api.move(T("t6"), "z5", { profile: { way: "through", speed: 3 }, wait: false }); } catch ( err ) { threw = err; }
    off();
    check(!threw && m3?.ok && m3.done === 1 && m3.stopped?.reason === "noToken" && takeEvents().some((e) => e.type === "moveEnded" && e.stopped?.reason === "noToken"), "the mover deleted on the way: stopped noToken after the steps taken, moveEnded told");
    // a write the server refuses stops the move like a stop
    const upd = sc.updateEmbeddedDocuments;
    sc.updateEmbeddedDocuments = async () => { throw new Error("refused"); };
    let m4 = null;
    try { m4 = await api.move(T("t5"), "z5", { profile: { way: "walk", speed: 3 }, wait: false }); } catch ( err ) { threw = err; }
    const w4 = await api.apply({ op: "tokens", rows: [{ id: "t5", x: 0, y: 0 }] });
    sc.updateEmbeddedDocuments = upd;
    check(!threw && m4?.ok && m4.done === 0 && m4.stopped?.reason === "error" && m4.inverse === null && w4.ok === false && w4.reason === "error", "a token write that is refused: the move stops with reason error, a tokens op answers error; nothing rejects");
  },

  /* D86: bad input fails cleanly */
  async D86(K) {
    const { api, makeScene, open, ROW, check, J } = K;
    const sc = makeScene(ROW, [["t1", 650, 50]]);
    open(sc);
    const out = [];
    for ( const op of [{ op: "tokens", rows: [null] }, { op: "tokens", rows: [{ x: 1 }] }, { op: "tokens", rows: "t1" }, { op: "tokens" }, { op: "batch" }, { op: "batch", ops: 5 }, { op: "tokens", rows: [{ id: "t1", x: 0 }], options: 5, move: {} }] ) {
      try { const r = await api.apply(op); out.push(r.ok ? "ok" : r.reason); } catch ( err ) { out.push(`threw ${err.message}`); }
    }
    check(J(out) === J(["badOp", "badOp", "badOp", "badOp", "badOp", "badOp", "ok"]), `malformed tokens and batch ops answer badOp: ${J(out)}`);
    const inBatch = await api.apply({ op: "batch", ops: [{ op: "zone", zone: "z1", patch: { dark: true } }, { op: "tokens", rows: [null] }] });
    check(inBatch.ok === false && inBatch.reason === "badOp" && inBatch.at === 1 && !api.zone("z1").states.dark, "inside a batch: refused with its index, what was done is taken back");
    const empty = await api.apply({ op: "batch", ops: [] }), rest = await api.restoreBorders();
    check(empty.ok && empty.changed === false && J(empty.inverse) === J({ op: "batch", ops: [] }) && rest.ok && rest.changed === false, "a batch of nothing: ok, changed false (restoreBorders with nothing to restore)");
    await api.setBorderState("z2|z3", { door: { state: "open" } });
    const same = await api.apply({ op: "batch", ops: [{ op: "border", border: "z2|z3", door: { state: "open" } }] }), diff = await api.apply({ op: "batch", ops: [{ op: "border", border: "z2|z3", door: { state: "open" } }, { op: "border", border: "z2|z3", door: { state: "locked" } }] });
    check(same.ok && same.changed === false && diff.ok && diff.changed === true, "a batch says changed only when one of its writes changed something");
    let w = "x";
    try { w = [api.warn({ id: "w", zones: 5 }), api.warn({ id: "w", borders: "z1|z2" }), api.warn(null), api.warn(7), api.warn({ zones: [null] })]; } catch ( err ) { w = `threw ${err.message}`; }
    check(J(w) === J([null, null, null, null, null]), `warn with zones or borders that are no list, or no spec: null (${J(w)})`);
    check(api.warn({ id: "w", zones: [{ zone: "z4", text: "Fire" }] }) === "w" && api.clearHighlights("w") === 1, "a proper warning still shows");
  },

  /* D87: the reach cache keeps the answers of two ways of moving apart */
  async D87(K) {
    const { api, makeScene, open, ROW, check, J } = K;
    const sc = makeScene(ROW, []);
    open(sc);
    await api.addEdge({ kind: "portal", a: "z1", b: "z5", ways: ["flight"] });
    const fresh = J(api.reach("z1", { way: "flight", speed: 1 }).map((x) => x.zone));
    const leap = J(api.reach("z1", { way: "leap", speed: 1, edges: ["portal"] }).map((x) => x.zone)), flight = J(api.reach("z1", { way: "flight", speed: 1, edges: ["portal"] }).map((x) => x.zone));
    check(flight === fresh && leap !== flight && JSON.parse(flight).includes("z5") && !JSON.parse(leap).includes("z5"), "a flyer-only portal: the leaper asked first does not answer for the flyer asked second (edges as a list)");
    check(J(api.reach("z1", { way: "flight", speed: 1, edges: ["tunnel"] }).map((x) => x.zone)) === leap && J(api.reach("z1", { way: "flight", speed: 1, edges: false }).map((x) => x.zone)) === leap, "a list without that kind, and no edges at all: the portal is not used");
    check(api.plan("z1", "z5", { way: "flight", edges: ["portal"] })?.edges === 1 && (api.plan("z1", "z5", { way: "leap", edges: ["portal"] })?.edges ?? 0) === 0, "the plans agree");
  }
};

if ( one ) {
  const K = await import("./zones-adv7-kit.mjs");
  try { await CASES[one](K); }
  catch ( err ) { K.check(false, `${one} threw: ${err?.stack ?? err}`); }
  process.exit(K.failures() ? 1 : 0);
}

let failed = 0, n = 0;
for ( const name of Object.keys(CASES) ) {
  const r = spawnSync(process.execPath, ["--max-old-space-size=512", me, name], { encoding: "utf8", timeout: 60000 });
  const lines = (r.stdout ?? "").split("\n").filter((l) => /^(ok  |FAIL)/.test(l));
  for ( const l of lines ) { n++; if ( l.startsWith("FAIL") ) failed++; console.log(`${l.slice(0, 4)} ${name}: ${l.slice(5)}`); }
  if ( r.status !== 0 && !lines.some((l) => l.startsWith("FAIL")) ) { failed++; console.log(`FAIL ${name}: the case ${r.signal ? `did not come back (${r.signal})` : "died"}${r.stderr ? `\n${r.stderr.split("\n").slice(0, 12).join("\n")}` : ""}`); }
}
console.log(failed ? `${failed} failed` : `all zones adversary-7 checks passed (${n})`);
process.exit(failed ? 1 : 0);
