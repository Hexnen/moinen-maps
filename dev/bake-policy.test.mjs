/**
 * The publish rule between clients on different bake versions (scripts/destruction/bake-policy.mjs): simulated clients react to every
 * manifest write (an echo) and to reloads as destruction.mjs does; the scene must settle after a few writes, never ping-pong.
 * Run: node dev/bake-policy.test.mjs
 */
import assert from "node:assert/strict";
import { manifestRule, mayPublish, Breaker, verOf, compatible, BAKE_VERSIONS, strokeVersion, olderLook, parseEntry, entryString, rebakeOrder } from "../scripts/destruction/bake-policy.mjs";

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

console.log(`${passed} passed${process.exitCode ? ", SOME FAILED" : ""}`);
