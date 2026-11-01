/**
 * The publish rule between clients on different bake versions (scripts/destruction/bake-policy.mjs): simulated clients react to every
 * manifest write (an echo) and to reloads as destruction.mjs does; the scene must settle after a few writes, never ping-pong.
 * Run: node dev/bake-policy.test.mjs
 */
import assert from "node:assert/strict";
import { manifestRule, mayPublish, Breaker, verOf } from "../scripts/destruction/bake-policy.mjs";

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

console.log(`${passed} passed${process.exitCode ? ", SOME FAILED" : ""}`);
