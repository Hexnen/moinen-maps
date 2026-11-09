// The blast presets (bomb, grenade), the pure parts:   node dev/presets-boom.test.mjs
//   A. the shock dust: one fire-layer dust stroke "shock" at the impact, at least its level's haze long (core SHOCK_HAZE = dust-model
//      KIND.shock.haze), surviving the fire layer's cleaning unchanged
//   B. the shock field: every cell kicked when the front reaches it (shockAt, monotone in the distance), emitters on rings heading back
//      at the centre (thrown outward), deterministic; an area of blasts only ends its puffs (puffEnd) long before its haze, a mixed one
//      never; the kind table carries linW / haze for shock only
//   C. the accents: the bomb's fall (shadow from -1200, the bomb seen only near the end, nothing after T0), the grenade's arc ending
//      where its bounce starts and the bounce ending on the mark, a click throw draws no arc; deterministic, empty outside the spans
//   D. the cues: a screen cue's shake / flash decay to nothing by their span's end; a light cue dropped when the firing has a burst
//   E. the wiring: the accents load for blast records too (accents-wire hasAccents), the shadows / flash / shake are drawn by accents.mjs
import * as C from "../scripts/presets/core.mjs";
import { BUILTIN } from "../scripts/presets/defs.mjs";
import * as FM from "../scripts/fire/model.mjs";
import * as D from "../scripts/fire/dust-model.mjs";
import * as A from "../scripts/presets/accents-core.mjs";
import { readFileSync } from "node:fs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const RECT = { x: 0, y: 0, width: 3000, height: 2000 };
const ENV = { grid: 100, rect: RECT, now: 1_800_000_000_000, wind: { dir: 45, speed: 0.4 } };
const get = (id) => BUILTIN.find((d) => d.id === id);
const G = { bomb: { a: [1500, 1000], b: null }, grenade: { a: [900, 1100], b: [1500, 1000] } };
const fire = (id, seed = 7, g = G[id], opts = {}) => C.expand(get(id), g, { seed, ...opts }, ENV);

/* A */
ok(JSON.stringify(C.SHOCK_HAZE) === JSON.stringify([0, ...[1, 2, 3].map((lv) => D.look({ dk: "shock", lv }).haze)]), "core SHOCK_HAZE = dust-model KIND.shock.haze");
for ( const id of ["bomb", "grenade"] ) for ( const seed of [1, 7, 99] ) for ( const power of [-1, 0, 1] ) {
  const P = fire(id, seed, G[id], { power }), dust = P.fire.filter((f) => f.k === "dust");
  ok(dust.length === 1 && dust[0].dk === "shock", `${id}/${seed}/${power}: one shock dust stroke`);
  const s = dust[0];
  ok(Math.hypot(s.p[0] - P.at[0], s.p[1] - P.at[1]) < 1, `${id}/${seed}: at the impact`);
  ok(s.q >= P.t0 && s.q < P.t0 + 200, `${id}/${seed}: kicked just after T0 (${s.q - P.t0} ms)`);
  ok(s.o - s.q >= C.SHOCK_HAZE[s.lv] * 1000, `${id}/${seed}/${power}: lives its haze (${(s.o - s.q) / 1000} s, lv ${s.lv})`);
  ok(P.pending.dust.length === 0, `${id}/${seed}: nothing left pending for the dust`);
  const { key, ...raw } = s, c = FM.cleanStroke({ ...raw, id: "ftest" });
  ok(c && c.k === "dust" && c.dk === "shock" && c.lv === s.lv && c.r === s.r && c.q === s.q && c.o === s.o && JSON.stringify(c.p) === JSON.stringify(s.p), `${id}/${seed}: survives cleaning`);
}
ok((fire("bomb").fire.find((f) => f.k === "dust").o - fire("bomb").fire.find((f) => f.k === "dust").q) / 1000 >= 300, "a bomb's haze lingers ~5 min");

/* B */
{
  const geo = { ap: 3, ox: 0, oy: 0, grid: 96 }, Pp = FM.cleanParams();
  const st = FM.cleanStroke({ id: "s1", k: "dust", dk: "shock", lv: 3, r: 240, s: 1, p: [900, 900], q: 1000, o: 306000, wd: 0, ws: 0 });
  const area = FM.areasOf([st], geo, Pp, 1200).find((a) => a.style === "dust");
  const f1 = FM.raster(area, geo, Pp), f2 = FM.raster(area, geo, Pp);
  ok(Buffer.compare(Buffer.from(f1.cell.buffer), Buffer.from(f2.cell.buffer)) === 0 && Buffer.compare(Buffer.from(f1.em.buffer), Buffer.from(f2.em.buffer)) === 0, "shock field deterministic");
  const L = D.look(st), R = 240 / 3, cx = 300 - area.rect.x0, cy = 300 - area.rect.y0;
  const at = (x, y) => f1.cell[((y | 0) * f1.w + (x | 0)) * 4];
  // (the front reaches farther cells later: along a ray, the kick grows - the warp keeps it ragged, so compare well apart)
  const ray = [0.1, 0.35, 0.6, 0.85].map((f) => at(cx + f * R, cy));
  ok(ray.every((v, i) => i === 0 || v > ray[i - 1]), `kicks grow outward (${ray.map((v) => v.toFixed(2))})`);
  ok(ray[0] >= 0 && ray[0] < 0.1, "the centre is kicked at once");
  ok(Math.abs(D.shockAt(L, R, R) - L.tau * Math.log(1 / (1 - 1 / D.SHOCK_OVER))) < 1e-9 && D.shockAt(L, R, R) < 1.5, `the front reaches the rim in ${D.shockAt(L, R, R).toFixed(2)} s`);
  let inward = 0, nE = f1.emN;
  for ( let i = 0; i < nE; i++ ) {
    const o = ((i >> 10) * f1.emW + (i & 1023) * 3) * 4, x = f1.em[o], y = f1.em[o + 1], hx = f1.em[o + 4], hy = f1.em[o + 5];
    if ( (cx - x) * hx + (cy - y) * hy > 0 ) inward++;
  }
  ok(nE > 30 && inward === nE, `emitters on rings, heading back at the centre (${inward}/${nE})`);
  ok(f1.puffEnd < 40 && f1.puffEnd > D.shockAt(L, R, R) + L.linW, `a blast-only area ends its puffs (${f1.puffEnd.toFixed(1)} s) long before its haze (${L.haze} s)`);
  const car = FM.cleanStroke({ id: "c1", k: "dust", dk: "car", lv: 2, r: 30, p: [800, 900, 1000, 900], q: 1000, wd: 0, ws: 0 });
  const mixed = FM.areasOf([st, car], geo, Pp, 1200).find((a) => a.style === "dust" && a.strokes.length === 2);
  ok(mixed && FM.raster(mixed, geo, Pp).puffEnd >= D.NONE, "an area with another kind never skips its puffs");
  const carA = FM.areasOf([car], geo, Pp, 1200).find((a) => a.style === "dust");
  ok(FM.raster(carA, geo, Pp).puffEnd >= D.NONE, "other kinds: no puffEnd");
  const T = D.kindTable();
  ok(T.length === 6 && D.DUST_KINDS.every((dk, ki) => [1, 2, 3].every((lv) => { const o = (ki * 4 + lv) * 4; return dk === "shock" ? T[5][o] > 0 && T[5][o + 1] > 0 && T[5][o + 2] === Math.fround(D.HAZE_GROW) : T[5][o] === 0 && T[5][o + 1] === 0 && T[5][o + 2] === 0; })), "linW / haze / grow for shock only");
  ok(D.reachCells(st, geo) >= Math.ceil((R + L.aura * 32 * (1 + D.HAZE_GROW)) * 1.35), "the area holds the spread haze");
}

/* C */
const env = { ap: 3, ox: 0, oy: 0, grid: 100, lift: 0.5, squash: 0.8, q: 1, seed: 7 };
const snap = (items, t) => { const F = A.draw(items, 0, t, env, A.newFrame()); return JSON.stringify([F.px, F.shade, F.glows, F.shakes, F.flashes]); };
const count = (F) => F.px.reduce((a, l) => a + l.length / 2, 0);
{
  const P = fire("bomb"), items = A.itemsOf({ ...P, f: [] }), fall = items.find((a) => a.kind === "fallShadow");
  ok(fall && fall.at === -1200 && fall.dur === 1200, "the bomb's fall from -1200");
  const F0 = A.draw([fall], 0, -1100, env, A.newFrame()), F1 = A.draw([fall], 0, -150, env, A.newFrame());
  ok(F0.shade[0].length + F0.shade[1].length > 0 && count(F0) === 0, "early: a faint shadow, the bomb not seen yet");
  ok(F1.shade[1].length / 2 > (F0.shade[1].length / 2) && count(F1) > 10, `late: a darker core (${F0.shade[1].length / 2} -> ${F1.shade[1].length / 2} cells) and the bomb`);
  const r0 = F0.shade[0].length + F0.shade[1].length, xs = (F) => { const l = [...F.shade[0], ...F.shade[1]].filter((_, i) => i % 2 === 0); return Math.max(...l) - Math.min(...l); };
  ok(r0 > 0 && xs(F1) < xs(F0), `the shadow tightens (${xs(F0)} -> ${xs(F1)} cells wide)`);
  ok(snap([fall], -400) === snap([fall], -400), "fall deterministic");
  const Fa = A.draw([fall], 0, 1, env, A.newFrame());
  ok(count(Fa) === 0 && !Fa.shade[0].length && !Fa.live, "nothing of the fall after T0");
}
{
  const P = fire("grenade"), items = A.itemsOf({ ...P, f: [] }), arc = items.find((a) => a.kind === "throwArc"), bo = items.find((a) => a.kind === "bounce");
  ok(arc && bo && arc.at + arc.dur === bo.at && bo.at + bo.dur === 0, "the arc ends where the bounce starts, the bounce at T0");
  const T = A.throwOf(arc.from, arc.to, 100);
  ok(T && T.back > 0 && Math.hypot(T.land[0] - P.at[0], T.land[1] - P.at[1]) <= 0.35 * T.L + 1e-6, "it lands short of its mark");
  const cen = (F) => { const l = F.px[8]; let x = 0, y = 0; for ( let i = 0; i < l.length; i += 2 ) { x += l[i]; y += l[i + 1]; } return [x / (l.length / 2), y / (l.length / 2)]; };
  const fa = A.draw([arc], 0, bo.at - 1, env, A.newFrame()), fb = A.draw([bo], 0, bo.at, env, A.newFrame());
  const [ax, ay] = cen(fa), [bx, by] = cen(fb);
  ok(Math.hypot(ax - bx, ay - by) < 4, `no jump from the arc to the bounce (${Math.hypot(ax - bx, ay - by).toFixed(1)} cells)`);
  const fe = A.draw([bo], 0, -5, env, A.newFrame()), [ex, ey] = cen(fe);
  ok(Math.hypot(ex - P.at[0] / 3, ey - P.at[1] / 3) < 4, "it lies on the mark at the end");
  const mid = A.draw([arc], 0, arc.at + arc.dur / 2, env, A.newFrame()), [mx, my] = cen(mid);
  ok(my < (arc.from[1] + T.land[1]) / 2 / 3 - 0.35 * T.L * 0.5 / 3, `the arc rises (${my.toFixed(0)} vs ground ${((arc.from[1] + T.land[1]) / 6).toFixed(0)})`);
  ok(mid.shade[0].length + mid.shade[1].length > 0, "its shadow runs under it");
  ok(snap(items, -700) === snap(items, -700) && snap(items, -200) === snap(items, -200), "grenade accents deterministic");
  const click = fire("grenade", 7, { a: [1500, 1000], b: null }), ci = A.itemsOf({ ...click, f: [] }), carc = ci.find((a) => a.kind === "throwArc");
  ok(count(A.draw([carc], 0, carc.at + 300, env, A.newFrame())) === 0, "a click throw: no arc");
  ok(count(A.draw([ci.find((a) => a.kind === "bounce")], 0, -300, env, A.newFrame())) > 0, "a click throw: it still drops on the mark");
  const sp = items.map(A.spanOf).filter(Boolean), hi = Math.max(...sp.map((s) => s[1])), lo = Math.min(...sp.map((s) => s[0]));
  const b4 = A.draw(items, 0, lo - 1, env, A.newFrame()), af = A.draw(items, 0, hi + 1, env, A.newFrame());
  ok(count(b4) === 0 && b4.live && count(af) === 0 && !af.shakes.length && !af.live, "nothing before / after the spans");
}

/* D */
{
  const P = fire("bomb"), rec0 = { ...P, f: [] }, rec1 = { ...P, f: [{ id: "x", key: "burst.burst" }] };
  const i0 = A.itemsOf(rec0), i1 = A.itemsOf(rec1);
  ok(i0.some((c) => c.kind === "light") && !i1.some((c) => c.kind === "light"), "the light cue is left to the burst when there is one");
  const sc = i1.find((c) => c.kind === "screen");
  ok(sc && sc.x === P.at[0] && sc.y === P.at[1] && sc.shake === 0.9 && sc.flash === 0.6, "the screen cue placed at the impact");
  const s = A.spanOf(sc), at = (t) => A.draw([sc], 0, t, env, A.newFrame());
  const pk = at(40), mid = at(400), end = at(s[1] - 1);
  ok(pk.shakes[2] > 0 && pk.flashes[2] > 0.3, `shake and flash at the blast (${pk.shakes[2]?.toFixed(2)} px, ${pk.flashes[2]?.toFixed(2)})`);
  ok(at(0).flashes.length === 0 || at(0).flashes[2] === 0, "the flash eases in (none at t 0)");
  ok(mid.shakes[2] < pk.shakes[2] && !mid.flashes.length, "the shake dies away, the flash is gone");
  ok(end.shakes[2] < 0.01, "the shake ends at its span's end");
  const g = A.itemsOf({ ...fire("grenade"), f: [{ key: "burst.burst" }] }).find((c) => c.kind === "screen");
  ok(g && A.spanOf(g)[1] < s[1] && g.flash === 0, "a grenade's cue: shorter, no flash");
  const lt = i0.find((c) => c.kind === "light"), L1 = A.draw([lt], 0, 100, env, A.newFrame()), L2 = A.draw([lt], 0, lt.decay - 50, env, A.newFrame());
  ok(L1.glows.length === 5 && L2.glows[3] < L1.glows[3], "a light cue's glow decays");
}

/* E */
{
  // (accents-wire.mjs imports the runtime - Foundry: its two record tests are taken out of its source and run here)
  const wire = readFileSync(new URL("../scripts/presets/accents-wire.mjs", import.meta.url), "utf8");
  const pick = (name) => { const i = wire.indexOf(`export const ${name} = `), j = wire.indexOf("\n", i); return i < 0 ? "null" : wire.slice(i + `export const ${name} = `.length, j).replace(/;\s*$/, ""); };
  const KINDS = eval(wire.match(/const KINDS = (\[[^\]]+\]);/)?.[1] ?? "[]");
  const hasAccents = eval(pick("hasAccents")), hasGun = eval(pick("hasGun"));
  ok(/if \( !hasAccents\(data\?\.rec\) \) return;/.test(wire), "the wire loads the accents for any record with them");
  const P = fire("bomb"), Gn = fire("grenade");
  ok(hasAccents(P) && hasAccents(Gn) && !hasGun(P), "blast records load the accents (not as guns)");
  ok(!hasAccents({ pending: { accent: [], cue: [] } }), "nothing to play: not loaded");
  const ac = readFileSync(new URL("../scripts/presets/accents.mjs", import.meta.url), "utf8");
  const da = readFileSync(new URL("../scripts/fire/dust-art.mjs", import.meta.url), "utf8"), ba = readFileSync(new URL("../scripts/fire/burst-art.mjs", import.meta.url), "utf8");
  ok(/int st = int\(th\.x\), cnt = t > uPuffEnd \? 0 : int\(th\.y\);/.test(da) && /uPuffEnd: field\.puffEnd \?\? 1e9/.test(da), "the haze's minutes skip the emitters (puffEnd)");
  ok(/if \( k5\.x > 0\.0 && b > ke \+ k5\.x \) continue;/.test(da), "a blast's lazy puffs stop after linW");
  ok(/hl = 1\.0 - smoothstep\(0\.42 \* k5\.y, k5\.y, a\)/.test(da) && /\(hz > 0\.0 && band > 0 \? 8 : 0\)/.test(da) && /HAZE\[au\]/.test(da), "the haze thins over its second half, its own veil (A bit 8)");
  ok(/MOTES of a blast's HAZE/.test(da) && /if \( mD > 0\.03 && G == 0 && chip == 0 \)/.test(da), "the haze's motes (the weather dust's way)");
  ok(/this\.puffEnd < 1e8 \? Math\.max\(this\.maxKick \+ 30/.test(da), "reduced motion: a blast's haze still thins on the clock");
  ok(/float pool = uAge < 0\.0 \? -1\.0 :/.test(ba), "burst: no heat pool before the impact");
  ok(/A\.itemsOf\(rec\)/.test(ac) && /shadeG\.beginFill\(A\.SHADE/.test(ac) && /function flash\(/.test(ac) && /noFlash/.test(ac) && /rumble\(F\.kicks, F\.shakes/.test(ac), "accents.mjs takes itemsOf, draws shadows, flash (opt-out), shake");
}

console.log(fails ? `${fails}/${n} FAILED` : `ok presets-boom: ${n}/${n} checks`);
process.exit(fails ? 1 : 0);
