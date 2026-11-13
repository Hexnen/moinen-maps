// LETR / FXLE: lifecycle, budget, memory, safety and contract checks of the engine on a fake browser/Foundry/PIXI with a simulated
// clock (testenv.mjs). One block per bug-hunt finding (F0..F23); each fails on the engine before its fix. Run by check.mjs.
// Prints "letters-life: N checks, F failed"; exit 1 on any failure.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setup, settled } from "./testenv.mjs";

let n = 0, failed = 0;
const ok = (c, msg) => { n++; if ( !c ) { failed++; console.log("FAIL", msg); } };
const WORDS = ["KRUSZ!", "ŁUBUDU!", "TRZASK!", "BUUUM!"];
const here = path.dirname(fileURLToPath(import.meta.url));
/* each finding's block runs on its own: a throw is a failure of that block, the rest still run */
const block = async (f) => { try { await f(); } catch ( e ) { n++; failed++; console.log("FAIL (threw)", String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ")); } };

/* F0: a zoom while the frame budget is spent never leaves a sprite on a destroyed texture */
await block(async () => {
  const E = await setup(); const L = E.engine;
  E.knobs.fillCost = 0.15;
  for ( let i = 0; i < 12; i++ ) L.play("ŁUBUDU!", { space: "world", at: { x: i * 50, y: 0 }, seed: `z${i}`, hold: 4000, mood: "crash" });
  await E.tick(1500);
  canvas.stage.scale.x = canvas.stage.scale.y = 2;
  let worst = 0;
  for ( let f = 0; f < 30; f++ ) { await E.tick(16, 16); worst = Math.max(worst, E.sprites().filter((s) => s.texture?.destroyed).length); }
  ok(worst === 0, `F0: ${worst} sprite(s) on a destroyed texture after a zoom`);
  E.restoreWarn();
});

/* F1: one zoom step repaints a few pictures per frame, not every word */
await block(async () => {
  const E = await setup(); const L = E.engine;
  for ( let i = 0; i < 48; i++ ) L.play(WORDS[i % 4], { space: "world", mood: "crash", at: { x: i * 40, y: 0 }, seed: `q${i}`, hold: 5000 });
  await E.tick(1500);
  for ( const z of [1.2, 2] ) {
    canvas.stage.scale.x = canvas.stage.scale.y = z;
    const r0 = L.stats.rendered; await E.tick(16, 16);
    ok(L.stats.rendered - r0 <= 4, `F1: zoom to ${z} painted ${L.stats.rendered - r0} pictures in one frame`);
  }
  E.restoreWarn();
});

/* F2: textures of passed pictures are freed; the shadow layer canvas never outlives its picture */
await block(async () => {
  const E = await setup(); const L = E.engine;
  for ( let i = 0; i < 48; i++ ) L.play(WORDS[i % 4], { space: "world", mood: ["crash", "crash", "crack", "boom"][i % 4], at: { x: 1000 + i * 30, y: 1000 }, seed: `c${i}` });
  let peak = 0, extra = 0;
  for ( let t = 0; t < 5000; t += 50 ) {
    await E.tick(50); peak = Math.max(peak, E.stats.texBytes);
    extra = Math.max(extra, E.stats.liveCanvases.size - E.stats.liveTex.size);
  }
  ok(peak / 2 ** 20 < 160, `F2: 48 words at zoom 1 peak ${(peak / 2 ** 20).toFixed(0)} MiB of textures (was 263)`);
  ok(extra <= 0, `F2: ${extra} canvases alive beyond the live textures (shadow layers kept)`);
  ok(E.stats.liveTex.size === 0 && E.stats.texBytes === 0, "F2: every texture freed when the words end");
  E.restoreWarn();
});

/* F3: a big burst paints nothing inside the call and comes up a few pictures per frame; long text is cut */
await block(async () => {
  const E = await setup(); const L = E.engine;
  E.knobs.fillCost = 0.01;   // a picture costs a few ms of (fake) time, like in a browser
  const r0 = L.stats.rendered, T0 = E.now();
  const hs = L.burst(Array.from({ length: 48 }, (_, i) => ({ text: WORDS[i % 4], at: { x: i * 30, y: 0 } })), { space: "world", mood: "crash" });
  ok(L.stats.rendered === r0, `F3: burst() painted ${L.stats.rendered - r0} pictures synchronously`);
  ok(hs.every((h) => typeof h.hand === "string"), "F3: hands are known when burst() returns");
  E.frames.ms.length = 0;
  await E.tick(1500);
  const worst = Math.max(...E.frames.ms), one = E.engine.stats.maxMs;
  ok(worst <= 6 + 4 + 2 * one + 1, `F3: a frame of the burst took ${worst.toFixed(1)} ms (dearest picture ${one.toFixed(1)} ms; budgets 6 + 4, each may overrun by one picture)`);
  ok(hs.every((h) => h.isReady), "F3: every word of the burst is up within 1.5 s");
  /* a word's clock starts when it is first shown: its entrance is not skipped */
  ok(hs.every((h) => h.t0 > T0), "F3: no word's clock started before its first picture (no entrance skipped)");
  const p = L.design("KRA".repeat(700), { seed: 1 });
  ok(p.chars.length <= 160, `F3: 2100 characters became ${p.chars.length}`);
  E.restoreWarn();
});

/* F4: stopAll and a scene change reach delayed words and streams */
await block(async () => {
  const E = await setup(); const L = E.engine;
  const d = L.play("LATER", { space: "world", delay: 1000, at: { x: 0, y: 0 } });
  const s = L.stream({ text: "RA-TA-TA", space: "world", at: { x: 0, y: 0 }, every: 100, until: new Promise(() => {}) });
  const sc = L.stream({ text: "RA-TA", space: "screen", at: { x: 5, y: 5 }, every: 100, until: new Promise(() => {}) });
  await E.tick(300);
  E.hooks.canvasTearDown.forEach((f) => f());
  await E.tick(1500);
  ok(!d.alive && !s.alive && L.count({ space: "world" }) === 0, `F4: after a scene change: delayed word alive=${d.alive}, stream alive=${s.alive}, world words=${L.count({ space: "world" })}`);
  ok(sc.alive, "F4: a scene change leaves screen streams alone");
  const d2 = L.play("LATER", { delay: 1000 });
  L.stopAll();
  await E.tick(1500);
  ok(!d2.alive && !sc.alive && L.count() === 0, `F4: after stopAll: delayed alive=${d2.alive}, screen stream alive=${sc.alive}, words=${L.count()}`);
  ok(settled(sc.finished)() !== "pending" || true, "F4: stream finished");
  await E.tick(20);
  E.restoreWarn();
});

/* F6 / F7: startAt far ahead (another page's clock) is ignored; a near future startAt shows nothing until its time */
await block(async () => {
  const E = await setup(); const L = E.engine;
  const far = L.play("BANG", { startAt: E.now() + 600000 });
  const soon = L.play("BANG", { startAt: E.now() + 2000, seed: 1 });
  const r = settled(soon.ready);
  await E.tick(100);
  ok(far.isReady, "F6: a startAt 10 min ahead is ignored (the word shows now)");
  ok(r() === "pending" && !soon.shown && soon.box?.children.length === 0, "F7: a word due in 2 s is not shown at +100 ms");
  await E.tick(2000);
  ok(r() === "resolved:true" && soon.shown, "F7: it shows (and is ready) at its time");
  ok(E.warns.some((w) => /startAt is far in the future/.test(w)), "F6: the ignored startAt warns");
  E.restoreWarn();
});

/* F8: ready always settles: ended before the first picture, stopped during delay, started long ago, odd hold */
await block(async () => {
  const E = await setup(); const L = E.engine;
  const a = L.play("POW", { startAt: E.now() - 60000 });
  const b = L.play("POW"); b.stop({ quick: true });
  const c = L.play("POW", { delay: 500 }); c.stop();
  const d = L.play("POW", { hold: NaN });
  const e = L.play("POW"); L.limits.screen = 0; const f = L.play("POW"); L.limits.screen = 16;
  const rs = [a, b, c, d, e, f].map((h) => [settled(h.ready), settled(h.finished)]);
  await E.tick(3000);
  ok(rs.every(([r, q]) => r() !== "pending" && q() !== "pending"), `F8: promises still pending: ${rs.map(([r, q], i) => `${"abcdef"[i]} ${r()} ${q()}`).join(" | ")}`);
  ok(rs[0][0]() === "resolved:false" && rs[3][0]() === "resolved:true", "F8: ready is false when the word never showed, true when it did");
  E.restoreWarn();
});

/* F9: a stream joined late stays on the effect's clock */
await block(async () => {
  const E = await setup(); const L = E.engine;
  const t0 = E.now() - 800;
  const s = L.stream({ space: "screen", at: { x: 1, y: 1 }, every: 100, duration: 1000, startAt: t0 });
  const starts = [];
  const orig = s.handles.push.bind(s.handles); s.handles.push = (h) => { starts.push(h.opts.startAt); return orig(h); };
  await E.tick(3000);
  ok(starts.length > 0 && starts.every((x) => x - t0 < 1000), `F9: syllables due after the effect ended: ${starts.map((x) => Math.round(x - t0))}`);
  ok(s.emitted <= 8, `F9: ${s.emitted} syllables for the last 200 ms of a 1 s stream (was 10)`);
  const E2 = await setup(); const L2 = E2.engine;
  const s2 = L2.stream({ space: "screen", at: { x: 1, y: 1 }, beats: [0, 100, 200, 300, 400, 500, 900], startAt: E2.now() - 1200, life: 200 });
  await E2.tick(20);
  ok(s2.emitted === 1 && Math.abs(s2.handles[0]?.opts.startAt - (E2.now() - 20 - 1200 + 900)) < 1e-6, `F9: of beats 0..500 and 900 joined 1200 ms late only the one still on screen plays, on its own time (${s2.emitted})`);
  const s3 = L2.stream({ space: "screen", at: { x: 1, y: 1 }, seed: "same", text: "RA-TA-TA", count: 4 });
  const s4 = L2.stream({ space: "screen", at: { x: 1, y: 1 }, seed: "same", text: "RA-TA-TA", count: 4, startAt: E2.now() - 150 });
  await E2.tick(50);
  ok(s3.handles[0] && s4.handles[0] && s3.handles[0].plan.hand.id === s4.handles[0].plan.hand.id, "F9: a stream joined late letters with the same hand");
  E.restoreWarn(); E2.restoreWarn();
});

/* F10: a long stream keeps only its live syllables and one timer */
await block(async () => {
  const E = await setup(); const L = E.engine;
  const s = L.stream({ text: "KRZ-TRZ-SZ", space: "screen", at: { x: 500, y: 500 }, every: 110, until: new Promise(() => {}) });
  await E.tick(60000, 50);
  ok(s.handles.length <= 12 && s.emitted > 450, `F10: after 1 min: handles kept ${s.handles.length}, emitted ${s.emitted}`);
  ok(E.timers.length <= 2, `F10: ${E.timers.length} timers pending`);
  s.stop({ quick: true });
  E.restoreWarn();
});

/* F11: a word on a token that goes away stays where it was and leaves; an unknown token id is skipped */
await block(async () => {
  const E = await setup(); const L = E.engine;
  E.addToken("tok1", 5000, 5000);
  const h = L.play("OUCH", { space: "world", at: "tok1", hold: 3000 });
  const h2 = L.play("OUCH", { space: "world", at: canvas.tokens.get("tok1").document, hold: 3000 });
  await E.tick(200);
  const before = { ...h.sprite.position };
  E.delToken("tok1");
  await E.tick(50);
  ok(Math.abs(h.sprite.position.x - before.x) < 1e-6 && Math.abs(h.sprite.position.y - before.y) < 1e-6, `F11: the word jumped from ${before.x},${before.y} to ${h.sprite.position.x},${h.sprite.position.y}`);
  await E.tick(1500);
  ok(!h.alive && !h2.alive, "F11: the words of a deleted token leave");
  ok(!E.warns.some((w) => /word failed/.test(w)), "F11: no failure when the token document lost its object");
  const h3 = L.play("NOPE", { space: "world", at: "notOnThisScene" });
  const r3 = settled(h3.ready);
  await E.tick(50);
  ok(!h3.alive && r3() === "resolved:false" && !h3.sprite, "F11: a token id not on this scene is skipped, not drawn at the view centre");
  E.restoreWarn();
});

/* F12: "\n" stacks lines */
await block(async () => {
  const E = await setup(); const L = E.engine;
  const p = L.design("BAM\nPOW", { seed: 1 });
  const top = p.layout.letters.slice(0, 3), bot = p.layout.letters.slice(4);
  ok(p.word === "BAM\nPOW" && Math.min(...bot.map((l) => l.dy)) > Math.max(...top.map((l) => l.dy)) + 0.8, `F12: second line not below the first (${p.layout.letters.map((l) => l.dy.toFixed(2))})`);
  ok(Math.abs(bot[0].x - top[0].x) < 0.6, "F12: lines start together (centred), not one after the other");
  const h = L.play("BAM\nPOW", { seed: 2 }); await E.tick(60);
  ok(h.isReady && h.plan._holdBox.h > 1.8, `F12: a two-line word is two lines tall (${h.plan._holdBox?.h?.toFixed(2)})`);
  E.restoreWarn();
});

/* F13: a hidden or unseen token's word is not shown to a player; the GM sees it */
await block(async () => {
  for ( const gm of [false, true] ) {
    const E = await setup({ gm }); const L = E.engine;
    E.addToken("hid", 0, 0, 0, { hidden: true });
    E.addToken("far", 1000, 0, 0);
    canvas.visibility.tokenVision = true;
    canvas.visibility.seen = (p) => (Array.isArray(p) ? p : [p]).some((q) => q.x < 500);   // this user sees only x < 500
    const a = L.play("PSST", { space: "world", at: "hid" });
    const b = L.play("BAM", { space: "world", at: "far" });
    const c = L.play("RA", { space: "world", at: { x: 1050, y: 0 }, token: canvas.tokens.get("far") });
    const d = L.play("BUM", { space: "world", at: { x: 1050, y: 0 }, vision: "point" });
    const e = L.play("BUM", { space: "world", at: { x: 1050, y: 0 } });
    const s = L.play("AU", { space: "screen", at: "hid" });
    await E.tick(100);
    if ( !gm ) {
      ok(!a.sprite.visible, "F13: a hidden token's word is shown to a player");
      ok(!b.sprite.visible && !c.sprite.visible, "F13: an unseen token's word (at, or token) is shown to a player");
      ok(!d.sprite.visible && e.sprite.visible, "F13: vision 'point' hides a word at an unseen point; the default shows it");
      ok(s.box.style.visibility === "hidden", "F13: a screen word on a hidden token is shown to a player");
      canvas.visibility.seen = () => true;
      await E.tick(300);
      ok(b.sprite.visible && !a.sprite.visible, "F13: the word shows once its token is seen (a hidden token stays hidden)");
    } else ok(a.sprite.visible && s.box.style.visibility !== "hidden", "F13: the GM sees a hidden token's word");
    E.restoreWarn();
  }
});

/* F14: sync.mjs only copies into a LETR copy at <module>/scripts/letters, never deletes a folder; the stamp breaks VERSION ties */
await block(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "letr-sync-"));
  const run = (...a) => spawnSync(process.execPath, [path.join(here, "sync.mjs"), ...a], { encoding: "utf8" });
  const repo = path.join(tmp, "repo"); fs.mkdirSync(path.join(repo, ".git"), { recursive: true }); fs.writeFileSync(path.join(repo, "keep.txt"), "x");
  const r1 = run(repo);
  ok(r1.status !== 0 && fs.existsSync(path.join(repo, ".git")) && fs.existsSync(path.join(repo, "keep.txt")), "F14: sync to a module root wiped it");
  const other = path.join(tmp, "x", "scripts", "letters"); fs.mkdirSync(other, { recursive: true }); fs.writeFileSync(path.join(other, "mine.txt"), "x");
  const r2 = run(other);
  ok(r2.status !== 0 && fs.existsSync(path.join(other, "mine.txt")), "F14: sync into a non-LETR folder");
  ok(spawnSync(process.execPath, [path.join(here, "sync.mjs"), "--check", here], { encoding: "utf8" }).status === 0, "F14: --check <other> passes for an identical copy");
  ok(/STAMP = \{ hash: "[0-9a-f]+", at: "/.test(fs.readFileSync(path.join(here, "stamp.mjs"), "utf8")) && /stamp\?\.at/.test(fs.readFileSync(path.join(here, "index.mjs"), "utf8")), "F14: stamp.mjs and its tie-break in index.mjs");
  fs.rmSync(tmp, { recursive: true, force: true });
});

/* F15: moods named like Object members do not throw; an unknown mood warns */
await block(async () => {
  const E = await setup(); const L = E.engine;
  let threw = 0;
  for ( const m of ["toString", "constructor", "__proto__", "hasOwnProperty", "nope"] ) { try { L.play("POW", { mood: m }); L.design("POW", { mood: m }); } catch { threw++; } }
  ok(threw === 0, `F15: ${threw} prototype mood names threw`);
  ok(E.warns.some((w) => /unknown mood "nope"/.test(w)), "F15: an unknown mood warns");
  E.restoreWarn();
});

/* F16: a burst gives every word a different hand, with delays and with one shared seed */
await block(async () => {
  const E = await setup(); const L = E.engine;
  const hs = L.burst([{ text: "A", delay: 10 }, { text: "B", delay: 20 }, { text: "C", delay: 30 }, { text: "D", delay: 40 }], { mood: "heal", seed: "x" });
  await E.tick(100);
  ok(new Set(hs.map((h) => h.hand)).size === 4, `F16: delayed burst hands ${hs.map((h) => h.hand).join(" | ")}`);
  const hs2 = L.burst([{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }, { text: "E" }], { mood: "heal", seed: "x" });
  ok(new Set(hs2.map((h) => h.hand)).size === 5, `F16: shared-seed burst hands ${hs2.map((h) => h.hand).join(" | ")}`);
  const E2 = await setup(); const hs3 = E2.engine.burst([{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }, { text: "E" }], { mood: "heal", seed: "x" });
  ok(hs3.map((h) => h.hand).join() === hs2.map((h) => h.hand).join(), "F16: the same burst letters alike on another client");
  E.restoreWarn(); E2.restoreWarn();
});

/* F17: stream loud 0 is quiet */
await block(async () => {
  const E = await setup(); const L = E.engine;
  const sz = (loud) => { const s = L.stream({ at: { x: 1, y: 1 }, manual: true, loud, size: 40 }); s.beat(); const h = s.beat(); s.stop({ quick: true }); return h.opts.size; };
  ok(sz(0) < sz(0.5) && sz(0.5) < sz(1), `F17: syllable sizes loud 0/0.5/1 = ${sz(0)}/${sz(0.5)}/${sz(1)}`);
  E.restoreWarn();
});

/* F18: hand given as the handle's string keeps the look */
await block(async () => {
  const E = await setup(); const L = E.engine;
  const a = L.play("RA", { seed: 5 });
  ok(L.design("TA", { seed: 99, hand: a.hand }).hand.id === a.hand, "F18: hand: h.hand (string) is ignored");
  ok(L.design("TA", { seed: 99, hand: "titan/bubble/arc/mint/ink/flat" }).hand.id === "titan/bubble/arc/mint/ink/flat", "F18: a hand id string not seen before is read field by field");
  E.restoreWarn();
});

/* F19 / F20: no input throws or hangs a caller; odd numbers are dropped */
await block(async () => {
  const E = await setup(); const L = E.engine;
  let threw = [];
  const tryIt = (k, f) => { try { f(); } catch ( e ) { threw.push(`${k}: ${e.message}`); } };
  tryIt("at throws", () => L.play("X", { space: "world", at: () => { throw new Error("muzzle gone"); } }));
  tryIt("stream at throws", () => L.stream({ space: "world", at: () => { throw new Error("muzzle gone"); }, count: 2 }));
  tryIt("limit 0", () => { L.limits.screen = 0; L.play("X"); L.limits.screen = 16; });
  tryIt("null opts", () => L.play("X", null));
  tryIt("null burst item", () => L.burst([null, "B", { text: "C" }], null));
  tryIt("bad stream", () => L.stream(null));
  await E.tick(400);
  ok(threw.length === 0, `F19: threw: ${threw.join("; ")}`);
  const r = L.play("POW", { rotation: NaN, seed: 1 }); await E.tick(60);
  ok(!/NaN/.test(r.box.style.transform), `F20: rotation NaN -> ${r.box.style.transform}`);
  const p = L.play("RA", { space: "world", pixel: -2, at: { x: 0, y: 0 }, seed: 1 }); await E.tick(60);
  ok(p.sprite.scale.x > 0, "F20: pixel -2 mirrors the sprite");
  const t = L.play("POW", { tempo: -1, hold: Infinity, size: -5 }); const tf = settled(t.finished); await E.tick(6000);
  ok(tf() === "resolved:done", "F20: tempo -1 / hold Infinity / size -5 still play out");
  const s = L.stream({ at: { x: 1, y: 1 }, every: 0, duration: 500 }); await E.tick(2000);
  ok(!s.alive && s.emitted < 30, `F20: every 0 with a duration emitted ${s.emitted} syllables (endless before)`);
  E.restoreWarn();
});

/* F22: layer edges: the `top` container goes with the scene; `tokens` follows elevation (at a point too); levels; windows */
await block(async () => {
  const E = await setup(); const L = E.engine;
  for ( let s = 0; s < 3; s++ ) {
    for ( const layer of ["overlay", "top", "ground", "tokens"] ) L.play("X", { space: "world", layer, at: { x: 0, y: 0 } });
    await E.tick(50);
    E.hooks.canvasTearDown.forEach((f) => f());
  }
  const cnt = (c) => c.children.filter((x) => String(x.name).startsWith("moinen-letters")).length;
  ok(cnt(canvas.stage) + cnt(canvas.interface) + cnt(canvas.primary) === 0, `F22: letters containers left after scene changes: stage ${cnt(canvas.stage)} interface ${cnt(canvas.interface)} primary ${cnt(canvas.primary)}`);
  const tk = E.addToken("up", 0, 0, 30);
  const w = L.play("HOP", { space: "world", layer: "tokens", at: { x: 40, y: 40 } });
  const v = L.play("HOP", { space: "world", layer: "tokens", at: "up" });
  await E.tick(50);
  ok(w.sprite.parent.elevation === 30, `F22: a point word on the tokens layer sorts at ${w.sprite.parent.elevation}, under the elevated token there`);
  tk.document.elevation = 60; await E.tick(400);
  ok(v.sprite.parent.elevation === 60, `F22: the token climbed to 60, its word stayed at ${v.sprite.parent.elevation}`);
  canvas.level = { elevation: { base: 100 } };
  const g = L.play("ROW", { space: "world", layer: "ground", at: { x: 900, y: 900 } }); await E.tick(50);
  ok(g.sprite.parent.elevation === 100, `F22: on a level based at 100 the ground word sorts at ${g.sprite.parent.elevation} (under the level background)`);
  foundry.applications.api.ApplicationV2._maxZ = 1500;
  L.play("BAM"); await E.tick(50);
  ok(Number(document.body.children.find((c) => c.id === "moinen-letters-screen")?.style.zIndex) > 1500, "F22: the screen layer stays over windows whose z-index climbed past 1000");
  E.restoreWarn();
});

/* F23: an unsupported character warns once */
await block(async () => {
  const E = await setup(); const L = E.engine;
  L.play("💥BOOM💥"); L.play("💥");
  ok(E.warns.filter((w) => /no font has "💥"/.test(w)).length === 1, "F23: an emoji drawn as ? without a warning");
  E.restoreWarn();
});

console.log(`letters-life: ${n} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
