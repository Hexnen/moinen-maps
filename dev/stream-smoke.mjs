/**
 * Live smoke test of the destruction streaming, run in a GM's Foundry console on a TEST world (it paints one small stroke and undoes
 * it):  await (await import("/modules/moinen-maps/dev/stream-smoke.mjs")).run()
 * Checks that status() answers after load, after a bake and after the publish, that the stroke went up as exactly one chunk named
 * in the manifest, and that the undo leaves the manifest without it. Resolves with { ok, steps }.
 */
export async function run({ wait = 4000 } = {}) {
  const D = game.modules.get("moinen-maps").api.destruction, steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (name, fn) => { try { const v = fn(); steps.push({ name, ok: !!v, v }); } catch ( err ) { steps.push({ name, ok: false, error: String(err) }); } };
  check("status after load", () => { const s = D.status(); return typeof s.source === "string" && s.error === "" && !!s.hash; });
  D.net.reset();
  const r = canvas.dimensions.sceneRect;
  D.paint(r.x + r.width * 0.5, r.y + r.height * 0.5, 25, { level: 2, type: "blast" });
  await sleep(600);
  check("status after the bake", () => { const s = D.status(); return /baked 1/.test(s.source) && !s.error; });
  await sleep(wait);
  // the newest stroke: layout 3 keeps the strokes under their own key (place `s`), layout 2 in the array `o`
  const F = canvas.scene.flags["moinen-maps"], f = F.destruction;
  const objs = F.destructionObjects ? Object.values(F.destructionObjects).sort((a, b) => a.s - b.s) : f.o;
  const id = objs.at(-1).id;
  check("status after the publish", () => { const s = D.status(); return !s.error && s.baked?.v === 2; });
  check("one chunk uploaded", () => D.net.stats().uploads === 1);
  check("manifest names the stroke", () => typeof f.baked?.c?.[id] === "string");
  // undo through the editor host: the last stroke goes
  const { undoLast } = await import("/modules/moinen-maps/scripts/destruction/destruction.mjs");
  undoLast();
  await sleep(wait);
  check("undo leaves the manifest without it", () => !canvas.scene.flags["moinen-maps"].destruction.baked?.c?.[id]);
  check("status after the undo", () => !D.status().error);
  return { ok: steps.every((s) => s.ok), steps };
}
