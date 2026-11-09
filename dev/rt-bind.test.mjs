// rt-bind.mjs: binding back after a ticker-side pass into an own render texture (clouds.mjs, cells.mjs).   node dev/rt-bind.test.mjs
// Regression for "Cannot read properties of null (reading 'resolution')" at CloudDisplay.draw on every scene load with clouds (GM and
// players, 2026-11-09): Foundry's hover alpha test (TextureLoader.getTextureAlphaData) leaves renderer.renderTexture.current pointing
// at a render texture it has destroyed; binding that back threw in PIXI's bind (it reads current.baseTexture.resolution).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bindBack } from "../scripts/weather/rt-bind.mjs";

// a stand-in for PIXI 7's RenderTextureSystem.bind: it reads the target's baseTexture.resolution, as the real one does
const sys = () => {
  const calls = [];
  return { calls, current: null, bind(t = null, sf, df) { if ( t ) void t.baseTexture.resolution; this.current = t; calls.push([t, sf, df]); } };
};
const sf = { x: 0, y: 0, width: 10, height: 10 }, df = { x: 0, y: 0, width: 10, height: 10 };

// a live target: bound back with its frames
{ const RT = sys(), live = { baseTexture: { resolution: 1 } };
  bindBack(RT, live, sf, df);
  assert.deepEqual(RT.calls, [[live, sf, df]]); }
// the screen: bound back with its frames
{ const RT = sys();
  bindBack(RT, null, sf, df);
  assert.deepEqual(RT.calls, [[null, sf, df]]); }
// a destroyed target (PIXI's Texture.destroy nulls baseTexture): the old code threw; now the screen, default frames
{ const RT = sys(), dead = { baseTexture: null };
  assert.throws(() => RT.bind(dead, sf, df), /resolution/);
  RT.calls.length = 0;
  assert.doesNotThrow(() => bindBack(RT, dead, sf, df));
  assert.deepEqual(RT.calls, [[null, undefined, undefined]]);
  assert.equal(RT.current, null); }

// both ticker-side passes bind back through it (none binds the saved target straight back)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for ( const f of ["scripts/weather/clouds.mjs", "scripts/weather/cells.mjs"] ) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  assert.ok(/bindBack\(RT, cur, sf, df\)/.test(src), `${f}: binds back through bindBack`);
  assert.ok(!/RT\.bind\(cur\b/.test(src), `${f}: no direct RT.bind(cur, ...)`);
}
console.log("rt-bind: ok (live / screen / destroyed target; clouds.mjs + cells.mjs use it)");
