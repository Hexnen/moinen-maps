/**
 * The publish rule between clients on different bake versions (scripts/destruction/bake-policy.mjs): simulated clients react to every
 * manifest write (an echo) and to reloads as destruction.mjs does; the scene must settle after a few writes, never ping-pong.
 * Run: node dev/bake-policy.test.mjs
 */
import assert from "node:assert/strict";
import { manifestRule, mayPublish, Breaker, verOf, compatible, BAKE_VERSIONS, strokeVersion, olderLook, parseEntry, entryString, rebakeOrder, entryChoice, chunkChanged, plainCurrent, awaitChunk, AWAIT_LOAD, AWAIT_WARM, localUnverified, verifyVerdict } from "../scripts/destruction/bake-policy.mjs";

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("ok  ", name); } catch ( err ) { console.error("FAIL", name, err); process.exitCode = 1; } };

test("rules", () => {
  assert.equal(manifestRule(null, "29:1:a"), "none");
  assert.equal(manifestRule("29:1:a", "29:1:a"), "same");
  assert.equal(manifestRule("30:1:a", "29:1:a"), "newer");
  assert.equal(manifestRule("24:1:a", "29:1:a"), "older");
  assert.equal(manifestRule("29:1:b", "29:1:a"), "other");
  assert.equal(mayPublish("30:1:a", "29:1:a"), false);
  assert.equal(mayPublish("29:1:a", "29:1:a"), true);
  assert.equal(mayPublish("24:1:a", "29:1:a"), true);
  assert.equal(verOf("x"), -1);
});

/** A client as destruction.mjs behaves: on load or on a manifest it sees, it bakes and publishes only where the rules allow. */
function client(version, scene, clock) {
  const breaker = new Breaker({ now: () => clock.t });
  const base = `${version}:1:768x512:abc`;
  return {
    bakes: 0, writes: 0,
    react(kind) {
      const rule = manifestRule(scene.manifest, base);
      if ( rule === "same" || rule === "newer" ) return;                 // shown from the manifest: nothing to bake here
      if ( !breaker.hit("bake", scene.key) ) return;
      this.bakes++;
      if ( !mayPublish(scene.manifest, base) || !breaker.hit("publish", scene.key) ) return;
      scene.manifest = base; this.writes++; scene.writes++;
      scene.echo(this);
      void kind;
    }
  };
}

function run(versions, rounds = 200) {
  const clock = { t: 0 }, scene = { manifest: "24:1:768x512:abc", key: "k", writes: 0, clients: [] };
  scene.echo = (from) => { for ( const c of scene.clients ) if ( c !== from ) queue.push(c); };
  const queue = [];
  scene.clients = versions.map((v) => client(v, scene, clock));
  for ( let r = 0; r < rounds; r++ ) {
    clock.t += 5000;
    // every client reloads now and then, and reacts to every echo
    scene.clients[r % scene.clients.length].react("load");
    let guard = 0;
    while ( queue.length && guard++ < 50 ) queue.shift().react("echo");
  }
  return scene;
}

test("two clients on different versions settle (the newer one publishes once, the older one never overwrites it)", () => {
  const s = run([28, 29]);
  assert.ok(s.writes <= 2, `writes ${s.writes}`);
  assert.equal(s.manifest.split(":")[0], "29");
  assert.ok(s.clients[0].writes <= 1);           // only before the newer manifest was there
  assert.ok(s.clients[0].bakes <= 1 && s.clients[1].bakes <= 1, `bakes ${s.clients.map((c) => c.bakes)}`);
});

test("three clients, one of them older than the manifest already there", () => {
  const s = run([23, 29, 29]);
  assert.ok(s.writes <= 2, `writes ${s.writes}`);
  assert.equal(s.manifest.split(":")[0], "29");
});

test("the breaker stops a loop it cannot otherwise see (the same key published again and again)", () => {
  const clock = { t: 0 }, b = new Breaker({ now: () => clock.t });
  let ok = 0;
  for ( let i = 0; i < 20; i++ ) { clock.t += 1000; if ( b.hit("publish", "k") ) ok++; }
  assert.equal(ok, 2);
  assert.ok(b.tripped);
  b.reset();
  assert.ok(b.hit("publish", "k"));
  // spread over time (one every 3 min) it never trips
  const c = new Breaker({ now: () => clock.t });
  for ( let i = 0; i < 10; i++ ) { clock.t += 180000; assert.ok(c.hit("bake", "k")); }
});

test("visual compatibility of bake versions follows the declared chain only", () => {
  const T = { 31: { compat: 30 }, 30: { compat: 29 }, 29: {}, 28: { compat: 27 } };
  assert.ok(compatible(30, 31, T));
  assert.ok(compatible(29, 31, T));
  assert.ok(!compatible(28, 31, T));            // 29 declared nothing: the chain stops there
  assert.ok(!compatible(31, 30, T));            // never a newer one as compatible with an older
  assert.ok(compatible(31, 31, T));
  for ( const [v, e] of Object.entries(BAKE_VERSIONS) ) assert.ok(e.compat < Number(v), `version ${v} points forward`);
});

/* ---------------------------------------------------------------- version pinning (0.4.2) */

test("per-kind versions: a tear-only bump makes only tears look older", () => {
  const T = { 10: { kinds: ["global"] }, 11: { kinds: ["gash"] }, 12: { kinds: ["cause"] }, 13: { kinds: ["collapse", "cracks"] } };
  assert.equal(strokeVersion("gash", false, 13, T), 11);
  assert.equal(strokeVersion("blast", false, 13, T), 10);
  assert.equal(strokeVersion("blast", true, 13, T), 12);
  assert.equal(strokeVersion("cracks", true, 13, T), 13);
  assert.ok(olderLook(10, "gash", false, 13, T));
  assert.ok(!olderLook(10, "blast", false, 13, T));
  assert.ok(olderLook(11, "blast", true, 13, T));
  // every entry of the real table names what it touched once 0.4.2's mapping ran (entries without kinds count as global)
  for ( const [v, e] of Object.entries(BAKE_VERSIONS) ) if ( Number(v) >= 25 ) assert.ok(Array.isArray(e.kinds) && e.kinds.length, `version ${v} has no kinds`);
});

test("entries: 0.4.1 'sig:id' take the manifest's version, 0.4.2 'sig:id:ver' their own", () => {
  assert.deepEqual(parseEntry("abc:d0123456789abcd", 44), { sig: "abc", id: "d0123456789abcd", ver: 44 });
  assert.deepEqual(parseEntry(entryString("abc", "d0123456789abcd", 52), 44), { sig: "abc", id: "d0123456789abcd", ver: 52 });
  assert.equal(parseEntry("nonsense"), null);
});

test("rebake order: nearest first, each followed by the strokes that read it, no repeats", () => {
  const order = rebakeOrder([{ objId: "a", index: 0, dist: 1, dependents: ["c"] }, { objId: "b", index: 1, dist: 0, dependents: ["c"] }, { objId: "c", index: 2, dist: 1 }]);
  assert.deepEqual(order, ["b", "c", "a"]);
});

/**
 * A scene of 240 strokes under version pinning: a stroke is baked when it has no entry or its signature changed (never because of
 * the bake version). A signature is a stroke's own inputs plus the OWN signatures of the older strokes it reads (substrate.mjs).
 */
test("240 strokes: ten version bumps bake nothing; one tear's cause changed bakes it and the strokes that read it", () => {
  let seed = 3; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const strokes = Array.from({ length: 240 }, (_, i) => ({ id: `s${i}`, kind: ["blast", "gash", "cracks", "collapse"][i % 4], cause: i % 7, deps: [] }));
  strokes.forEach((s, i) => { for ( let j = Math.max(0, i - 6); j < i; j++ ) if ( rnd() < 0.3 ) s.deps.push(j); });
  const own = (s) => `${s.id}|${s.kind}|${s.cause}`;
  const sigs = () => strokes.map((s) => `${own(s)}<${s.deps.map((j) => own(strokes[j])).join(",")}`);
  let version = 44;
  const manifest = new Map(sigs().map((sig, i) => [strokes[i].id, { sig, ver: version }]));
  const load = () => {
    const now = sigs(); let bakes = 0;
    now.forEach((sig, i) => { const e = manifest.get(strokes[i].id); if ( !e || e.sig !== sig ) { bakes++; manifest.set(strokes[i].id, { sig, ver: version }); } });
    return bakes;
  };
  let total = 0;
  for ( let b = 0; b < 10; b++ ) { version++; total += load(); }
  assert.equal(total, 0, "a version bump re-baked strokes");
  const tear = strokes.findIndex((s) => s.kind === "gash" && strokes.some((q) => q.deps.includes(strokes.indexOf(s))));
  const readers = strokes.filter((q) => q.deps.includes(tear)).length;
  strokes[tear].cause = (strokes[tear].cause + 1) % 7;
  assert.equal(load(), 1 + readers);
  assert.equal(load(), 0);
});

/**
 * GM and players must see the same strokes (0.4.4). A stroke's signature holds the INPUTS of the older strokes it reads, not their looks:
 * a Rebake all that changes an older stroke's look bakes the strokes over it again with the same signature and version but other pixels.
 * The publish used to keep their entries (same signature, same version): the GM showed the new look, a cold player the old chunks.
 */
const FNV = (str) => { let h = 2166136261; for ( let i = 0; i < str.length; i++ ) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return "d" + (h >>> 0).toString(36); };
function scene() {
  // 30 strokes, each reads up to the three before it; a stroke's look is a function of its own data, its code version and the looks it reads
  const strokes = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, kind: ["blast", "gash"][i % 2], deps: [i - 1, i - 2, i - 3].filter((j) => j >= 0 && (i + j) % 4 !== 0) }));
  const sig = (i) => `${strokes[i].id}~${strokes[i].deps.map((j) => strokes[j].id).join("-")}`;
  return { strokes, sig };
}
/** The looks every stroke has when baked with `codeOf(kind)` (the version that touched its kind). */
function looks(sc, codeOf) {
  const look = [];
  sc.strokes.forEach((s, i) => { look[i] = FNV(`${s.id}|${codeOf(s.kind)}|${s.deps.map((j) => look[j]).join(",")}`); });
  return look;
}
/** The persist of destruction.mjs: the manifest after the GM published records `recs` (index -> { id, ver, baked }); chunks: the server's. */
function publish(sc, manifest, recs, chunks, rule) {
  const c = {}, todo = [];
  sc.strokes.forEach((s, i) => {
    const e = manifest[s.id] ? { sig: manifest[s.id].sig, id: manifest[s.id].id, ver: manifest[s.id].ver } : null, r = recs[i], sig = sc.sig(i);
    if ( rule === "old" ) {
      if ( e?.sig === sig && !((r.ver ?? -1) > (e.ver ?? -1) && r.id !== e.id) ) c[s.id] = { sig, id: e.id, ver: e.ver };
      else if ( r.id && chunks.has(r.id) ) c[s.id] = { sig, id: r.id, ver: r.ver };
      else todo.push({ i, s, sig, r, same: null, e });
      return;
    }
    const pick = entryChoice(e, sig, r, (id) => chunks.has(id));
    if ( pick.keep ) c[s.id] = { sig, id: e.id, ver: e.ver };
    else if ( pick.use ) c[s.id] = { sig, id: pick.use.id, ver: pick.use.ver };
    else todo.push({ i, s, sig, r, same: pick.encode, e });
  });
  let encoded = 0, uploaded = 0;
  for ( const q of todo ) {
    const id = q.r.content; encoded++;
    if ( !chunks.has(id) ) { chunks.add(id); uploaded++; }
    q.r.id = id;
    c[q.s.id] = q.same && id === q.same ? { sig: q.sig, id: q.e.id, ver: q.e.ver } : { sig: q.sig, id, ver: q.r.ver };
  }
  return { manifest: c, encoded, uploaded };
}
function world() {
  // published with code 10 for "blast" (an older look) and 11 for "gash" (baked after version 11, which changed the look of blasts only)
  const sc = scene(), chunks = new Set(), ver = (k) => k === "blast" ? 10 : 11;
  const l1 = looks(sc, ver), manifest = {};
  sc.strokes.forEach((s, i) => { manifest[s.id] = { sig: sc.sig(i), id: l1[i], ver: ver(s.kind) }; chunks.add(l1[i]); });
  // Rebake all (every stroke baked again with the code of version 11): the blasts get their new look, the gashes read it
  const l2 = looks(sc, () => 11);
  const recs = sc.strokes.map((s, i) => ({ id: null, ver: 11, baked: true, content: l2[i] }));
  return { sc, chunks, manifest, l1, l2, recs };
}
const player = (sc, manifest) => sc.strokes.map((s) => manifest[s.id].id);

test("Rebake all: a cold player sees the GM's look, also for the strokes that only read a changed look", () => {
  const w = world();
  const dependents = w.sc.strokes.filter((s, i) => s.kind === "gash" && w.l1[i] !== w.l2[i]).length;
  assert.ok(dependents >= 5, "the scene has strokes whose look changes only through what they read");
  // the old rule: the entries of the strokes whose own version did not change stay (what the 0.4.3 publish did)
  const old = publish(w.sc, w.manifest, w.recs.map((r) => ({ ...r })), new Set(w.chunks), "old");
  assert.ok(player(w.sc, old.manifest).some((id, i) => id !== w.l2[i]), "the old rule leaves players stale chunks (the bug)");
  const fix = publish(w.sc, w.manifest, w.recs, new Set(w.chunks), "new");
  assert.deepEqual(player(w.sc, fix.manifest), w.l2, "every stroke's chunk is the GM's look");
});

test("Rebake all of what nothing changed: the same bytes, no new entry, no upload", () => {
  const w = world();
  const same = looks(w.sc, (k) => k === "blast" ? 10 : 11);
  const recs = w.sc.strokes.map((s, i) => ({ id: null, ver: i % 2 ? 11 : 10, baked: true, content: same[i] }));
  const r = publish(w.sc, w.manifest, recs, new Set(w.chunks), "new");
  assert.deepEqual(r.manifest, w.manifest, "the manifest is the one it was");
  assert.equal(r.uploaded, 0);
  assert.equal(r.encoded, w.sc.strokes.length, "every fresh bake is compared by its chunk id");
});

test("a record read back from a chunk (not baked here) never replaces a newer entry of an equal version; never downgrades", () => {
  const e = { sig: "a", id: "d1", ver: 10 };
  assert.deepEqual(entryChoice(e, "a", { id: "d0", ver: 10 }), { keep: true });
  assert.deepEqual(entryChoice(e, "a", { id: null, ver: 9, baked: true }), { keep: true });
  assert.deepEqual(entryChoice(e, "a", { id: "d1", ver: 10, baked: true }), { keep: true });
  assert.deepEqual(entryChoice(e, "a", { id: null, ver: 10, baked: true }), { encode: "d1" });
  assert.deepEqual(entryChoice(e, "a", { id: null, ver: 11, baked: true }), { encode: null });
  assert.deepEqual(entryChoice(e, "a", { id: "d2", ver: 10, baked: true }, (id) => id === "d2"), { use: { id: "d2", ver: 10 } });
  assert.deepEqual(entryChoice(e, "b", { id: null, ver: 10, baked: true }), { encode: null });
  assert.deepEqual(entryChoice(null, "a", { id: "d3", ver: 10 }, () => true), { use: { id: "d3", ver: 10 } });
  assert.deepEqual(entryChoice(null, "a", { id: null, ver: 10, baked: true }), { encode: null });
});

test("warm refresh: a record whose entry names another chunk under the same signature is refetched (never one baked here, never another signature)", () => {
  const e = { sig: "a", id: "d2", ver: 10 };
  assert.equal(chunkChanged({ id: "d1", ver: 10 }, e, "a"), true, "same signature, new chunk id");
  assert.equal(chunkChanged({ id: "d2", ver: 10 }, e, "a"), false, "the chunk it shows");
  assert.equal(chunkChanged({ id: "d1", ver: 10 }, e, "b"), false, "another signature: the remote-change path re-bakes or fetches it");
  assert.equal(chunkChanged({ id: null, ver: 10 }, e, "a"), false, "no chunk of its own (a legacy sheet)");
  assert.equal(chunkChanged({ id: "d1", ver: 10, baked: true }, e, "a"), false, "baked here (the GM publishes it)");
  assert.equal(chunkChanged(undefined, e, "a"), false);
  assert.equal(chunkChanged({ id: "d1" }, undefined, "a"), false, "no entry any more");
});

test("Rebake all is independent of the order of its batches: a plain look under a newer stroke is only ever one the current code baked", () => {
  // strokes 0..N-1; stroke i reads the older strokes in deps[i]. A stroke's chunk = its own look + the plain looks it was baked over.
  const N = 24, NOW = 5, deps = Array.from({ length: N }, (_, i) => [i - 1, i - 3, i - 7].filter((j) => j >= 0 && i % 3 !== 0));
  const oldVer = (i) => (i % 4 === 0 ? NOW : 3);            // a few strokes were baked by the current code already
  const rebake = (order, batch, rule) => {
    const have = Array.from({ length: N }, (_, i) => ({ ver: oldVer(i), look: oldVer(i) === NOW ? `f${i}` : `o${i}` })), out = {};
    for ( let b = 0; b < order.length; b += batch ) {
      const part = order.slice(b, b + batch), plain = {};
      // wave 0: the plain looks the batch reads (a stroke without a look to lend is baked plain, with the current code)
      for ( const i of part ) for ( const j of deps[i] ) if ( !(plainCurrent(have[j].ver, rule === "new", NOW)) ) plain[j] = `f${j}`;
      for ( const i of part ) {
        const read = deps[i].map((j) => plain[j] ?? have[j].look);
        out[i] = `f${i}|${read.join(",")}`;
      }
      for ( const i of part ) if ( !deps[i].length ) have[i] = { ver: NOW, look: `f${i}` };   // a stroke that reads nothing: its final look is its plain look
    }
    return JSON.stringify(out);
  };
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const orders = Array.from({ length: 12 }, () => [...Array(N).keys()].sort(() => rnd() - 0.5));
  const oldRule = new Set(orders.map((o) => rebake(o, 5, "old"))), newRule = new Set(orders.map((o) => rebake(o, 5, "new")));
  assert.ok(oldRule.size > 1, "the old rule lends older looks: different batches give different chunks");
  assert.equal(newRule.size, 1, "the current-code rule gives the same chunks for any order");
  assert.equal(new Set([3, 7, 24].map((n) => rebake(orders[0], n, "new"))).size, 1, "and any batch size");
  assert.equal(plainCurrent(3, false, 5), true); assert.equal(plainCurrent(3, true, 5), false); assert.equal(plainCurrent(5, true, 5), true);
});

test("warm player: waits for the GM's chunk of a freshly painted stroke, bakes only as a last resort, and checks a local bake against the GM's chunk", () => {
  // the player's decision at time t: the stroke has no entry in the manifest until the GM publishes (at `publishAt`)
  const timeline = (firstLoad, publishAt, localId) => {
    const wait = awaitChunk(firstLoad), seen = 0, log = { bakedAt: null, tookChunk: false, swap: false };
    if ( publishAt <= seen + wait ) { log.tookChunk = true; return log; }                 // the manifest arrives while waiting: fetched, no bake
    log.bakedAt = seen + wait;                                                           // last resort: baked here, the record has no chunk of its own
    const r = { id: null, baked: true, sprites: [{}] }, e = { sig: "s", id: "dGM" };
    assert.equal(chunkChanged(r, e, "s"), false, "chunkChanged alone never replaces a local bake");
    assert.equal(localUnverified(r, e, "s"), true, "but the manifest arriving later makes it checked");
    log.swap = verifyVerdict(localId, e) === "swap";
    return log;
  };
  assert.deepEqual(timeline(false, 25000, "x"), { bakedAt: null, tookChunk: true, swap: false }, "a GM that needs 25 s: no bake on a warm player");
  assert.deepEqual(timeline(false, 55000, "x"), { bakedAt: null, tookChunk: true, swap: false });
  assert.equal(timeline(false, 90000, "dGM").bakedAt, AWAIT_WARM, "a GM that never comes: the last resort after the warm wait");
  assert.equal(timeline(true, 25000, "x").bakedAt, AWAIT_LOAD, "a scene load keeps its short wait");
  assert.equal(timeline(false, 90000, "dGM").swap, false, "a local bake equal to the GM's chunk adopts its id");
  assert.equal(timeline(false, 90000, "dOther").swap, true, "a local bake that differs is replaced by the GM's chunk");
  assert.ok(AWAIT_WARM > 30000 && AWAIT_LOAD < AWAIT_WARM);
});

test("localUnverified: only a record baked here with pixels, for the entry's own signature", () => {
  const e = { sig: "a", id: "d1" }, r = { id: null, baked: true, sprites: [{ img: 1 }] };
  assert.equal(localUnverified(r, e, "a"), true);
  assert.equal(localUnverified({ ...r, id: "d1" }, e, "a"), false, "it has a chunk already (chunkChanged covers it)");
  assert.equal(localUnverified({ ...r, baked: false }, e, "a"), false, "loaded from a chunk");
  assert.equal(localUnverified({ ...r, shell: true }, e, "a"), false, "a shell has no pixels here");
  assert.equal(localUnverified({ ...r, sprites: Object.assign([], { lean: true }) }, e, "a"), false, "let go of its pixels");
  assert.equal(localUnverified(r, e, "b"), false, "another signature");
  assert.equal(localUnverified(r, undefined, "a"), false, "no entry yet");
  assert.equal(verifyVerdict(null, e), "swap", "nothing encoded: take the GM's chunk");
});

console.log(`${passed} passed${process.exitCode ? ", SOME FAILED" : ""}`);
