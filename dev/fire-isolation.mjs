// Fire and smoke: does an edit touch ONLY the area(s) it overlaps? (lane GM page, browser side)
//   const I = await import("/modules/moinen-maps/dev/fire-isolation.mjs"); await I.run()
// Places three separate fires and one big one (at rest), then paints a new fire elsewhere, adds a stroke onto the big fire,
// undoes it, erases a bit of the big fire, changes one stroke's level and one stroke's colour. After each edit (fields settled) it
// reports per area: the mesh / field kept or rebuilt, the art passes (a rebuilt area re-renders), and how many light sources were
// replaced. `ok` = every area the edit does not overlap kept its mesh, field and lights.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = () => game.modules.get("moinen-maps").api.fire;

const SEP = [[[200, 300], [300, 310]], [[700, 300], [800, 320]], [[1200, 300], [1290, 290]]];
const BIG = [[250, 800], [500, 760], [800, 820], [1100, 780]];

// settled = nothing pending and the display's area set (ids + keys) unchanged for 800 ms (a worker field can land a frame late)
const sig = () => [...(api().display()?.areas ?? [])].map(([id, a]) => id + "=" + a.key).join("|");
async function settle() {
  let last = sig(), since = performance.now();
  for ( let k = 0; k < 600; k++ ) {
    await wait(20);
    const s = sig();
    if ( s !== last || (api().status().pending ?? 0) > 0 ) { last = s; since = performance.now(); }
    else if ( performance.now() - since > 800 ) return;
  }
}
function snap() {
  const d = api().display(), out = new Map();
  if ( !d ) return out;
  for ( const [id, a] of d.areas ) out.set(id, { mesh: a.mesh, field: a.field, key: a.key, rect: a.area.rect, lights: new Set(d.lights.sourcesOf?.(id) ?? []) });
  out.allLights = new Set(d.lights.sources);
  return out;
}
const hit = (r, x0, y0, x1, y1, geo) => {
  const c = (x, y) => [(x - geo.ox) / geo.ap, (y - geo.oy) / geo.ap];
  const [a, b] = c(x0, y0), [e, f] = c(x1, y1);
  return !(Math.max(a, e) < r.x0 || Math.min(a, e) > r.x1 || Math.max(b, f) < r.y0 || Math.min(b, f) > r.y1);
};
function diff(before, after, box) {
  const geo = api().display()?.geo, rows = [];
  let ok = true;
  for ( const [id, b] of before ) {
    const a = after.get(id), touched = box && geo ? hit(b.rect, ...box, geo) : false;
    const kept = !!a && a.mesh === b.mesh && a.field === b.field;
    const lightsKept = !!a && [...b.lights].every((s) => a.lights.has(s)) && [...a.lights].every((s) => b.lights.has(s));
    rows.push({ id, touched, kept, lightsKept, gone: !a });
    if ( !touched && (!kept || !lightsKept) ) ok = false;
  }
  for ( const id of after.keys() ) if ( !before.has(id) ) rows.push({ id, created: true });
  const replacedLights = [...before.allLights].filter((s) => !after.allLights.has(s)).length;
  return { ok, replacedLights, rows };
}

export async function run() {
  const R = await import("/modules/moinen-maps/dev/fire-rec.mjs");
  await R.prep(); await R.wipe();
  await R.place([...SEP.map((pts) => ({ pts, r: 30, lv: 2, sm: 1, e: 1 })), { pts: BIG, r: 40, lv: 2, sm: 2, e: 1 }]);
  await settle();
  const F = api(), res = {};
  const step = async (name, box, fn) => { const b = snap(); await fn(); await settle(); res[name] = diff(b, snap(), box); };
  await step("paintElsewhere", [1500, 750, 1600, 760], () => F.paint([[1500, 750], [1600, 760]], { level: 2, smoke: 1 }));
  await step("addOntoBig", [600, 750, 700, 800], () => F.paint([[600, 780], [700, 790]], { level: 3, smoke: 2 }));
  await step("undo", [600, 750, 700, 800], () => F.undo());
  await step("erase", [480, 740, 540, 800], () => F.erase(510, 770, 40));
  const big = F.list().find((s) => s.p[0] === BIG[0][0]), sep0 = F.list().find((s) => s.p[0] === SEP[0][0][0]);
  await step("levelOfBig", [250, 700, 1100, 850], () => F.setLevels(big.id, { level: 3 }));
  await step("colourOfSep0", [200, 280, 300, 330], () => F.setColor(sep0.id, "#3a7bff"));
  return res;
}
