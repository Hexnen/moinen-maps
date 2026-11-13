/* LETR move: words that travel (paths, thrown arcs, beams, orbits around a moving centre), the stepped clock (ones / twos / threes)
   and the re-timing of a plan's pictures for a chosen frame rate. Pure: no DOM, no Foundry, no PIXI (README "Motion: travel").

   Units: a path or orbit lives in the space of the word (scene px for world words, CSS px for screen words); angles in radians
   inside, degrees in the options. Every function is deterministic for its inputs, so a seeded word moves the same on every client. */

export const TICK_MS = 1000 / 24;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (Number.isFinite(v) ? v : d);

/* ---------- the stepped clock ----------
   `on` = drawings held 1, 2 or 3 ticks of 24 fps (ones = 24 drawings a second, twos = 12, threes = 8). 0 = the engine's own mix
   (twos, ones only for accents, threes for heavy words). `fps: 24 | 12 | 8` is the same thing said as a rate. */
export function onOf(o) {
  let v = o?.on;
  if ( typeof v === "string" ) v = { ones: 1, twos: 2, threes: 3 }[v] ?? Number(v);
  if ( !Number.isFinite(v) && Number.isFinite(o?.fps) && o.fps > 0 ) v = 24 / o.fps;
  if ( !Number.isFinite(v) || v <= 0 ) return 0;
  return clamp(Math.round(v), 1, 3);
}
/* time held on the drawing grid: motion that is drawn (a word travelling, an orbit turning) jumps from pose to pose like the
   pictures do, instead of gliding (Spider-Verse: the whole move is on twos, not only the drawing) */
export const stepT = (t, on) => { const q = (on || 2) * TICK_MS; return Math.floor(t / q) * q; };

export const EASE = {
  linear: (u) => u,
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
  inout: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)),
  snap: (u) => 1 - (1 - u) ** 3,                // fast start, long settle: a thrown thing
  whip: (u) => (u < 0.25 ? 0.4 * (u / 0.25) ** 2 : 0.4 + 0.6 * EASE.out((u - 0.25) / 0.75))
};
export const easeOf = (e) => (typeof e === "function" ? e : EASE[e] ?? EASE.inout);

/* ---------- orientation ----------
   tangent: the word lies along its motion (may read upside down); lean: it tilts toward the motion but stays readable (flipped when
   going left, at most `max`); none: upright. Returns the word's rotation in radians. */
export function orientAngle(a, mode, max = 0.9) {
  if ( mode === "tangent" ) return a;
  if ( mode !== "lean" ) return 0;
  let r = Math.atan2(Math.sin(a), Math.cos(a));
  if ( r > Math.PI / 2 ) r -= Math.PI; else if ( r < -Math.PI / 2 ) r += Math.PI;
  return clamp(r * 0.75, -max, max);
}

/* ---------- paths ----------
   spec: { points: [p0, p1, ...] } (two or more; "smooth" curve through them or "line" segments), or { from, to, arc } (a thrown arc:
   `arc` = its peak height as a fraction of the distance, always bulging screen-up; negative = down), or a function (u) => { x, y }.
   `resolve(p)` turns a point-like (point, token, function) into { x, y } NOW (null when gone), so the ends may move while it flies. */
export function pathSpec(spec) {
  if ( typeof spec === "function" ) return { fn: spec };
  return spec && typeof spec === "object" ? spec : null;
}
export function pathPoints(spec, resolve) {
  if ( spec.fn ) return null;
  if ( Array.isArray(spec.points) && spec.points.length >= 2 ) {
    const pts = spec.points.map(resolve);
    return pts.every(Boolean) ? { pts, kind: spec.curve === "line" ? "line" : "smooth" } : null;
  }
  const a = resolve(spec.from), b = resolve(spec.to);
  if ( !a || !b ) return null;
  const arc = num(spec.arc, 0);
  if ( !arc ) return { pts: [a, b], kind: "line" };
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
  let nx = dy / d, ny = -dx / d;                       // a normal of the travel
  if ( ny > 0 || (Math.abs(ny) < 1e-9 && nx > 0) ) { nx = -nx; ny = -ny; }   // the one pointing screen-up
  const k = 2 * arc * d;                               // the control point twice the peak height out
  return { pts: [a, { x: (a.x + b.x) / 2 + nx * k, y: (a.y + b.y) / 2 + ny * k }, b], kind: "quad" };
}
/* the point and the tangent angle at u in [0, 1] */
export function pathAt(P, u, spec) {
  u = clamp(u, 0, 1);
  if ( spec?.fn ) {
    const p = spec.fn(u), q = spec.fn(Math.min(1, u + 1e-3)), r = spec.fn(Math.max(0, u - 1e-3));
    return p ? { x: p.x, y: p.y, a: q && r ? Math.atan2(q.y - r.y, q.x - r.x) : 0 } : null;
  }
  const { pts, kind } = P;
  if ( kind === "quad" ) {
    const [a, c, b] = pts, v = 1 - u;
    const x = v * v * a.x + 2 * u * v * c.x + u * u * b.x, y = v * v * a.y + 2 * u * v * c.y + u * u * b.y;
    const tx = 2 * v * (c.x - a.x) + 2 * u * (b.x - c.x), ty = 2 * v * (c.y - a.y) + 2 * u * (b.y - c.y);
    return { x, y, a: Math.atan2(ty, tx) };
  }
  /* by length: each segment gets its share of u by its chord */
  const L = []; let tot = 0;
  for ( let i = 1; i < pts.length; i++ ) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); L.push(l); tot += l; }
  if ( tot <= 1e-9 ) return { x: pts[0].x, y: pts[0].y, a: 0 };
  let d = u * tot, i = 0;
  while ( i < L.length - 1 && d > L[i] ) { d -= L[i]; i++; }
  const f = L[i] > 0 ? clamp(d / L[i], 0, 1) : 0;
  const p0 = pts[i], p1 = pts[i + 1];
  if ( kind === "line" || pts.length === 2 ) return { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f, a: Math.atan2(p1.y - p0.y, p1.x - p0.x) };
  /* Catmull-Rom through the points (the ends repeat) */
  const pm = pts[i - 1] ?? p0, p2 = pts[i + 2] ?? p1;
  const cr = (a0, a1, a2, a3, t) => 0.5 * ((2 * a1) + (-a0 + a2) * t + (2 * a0 - 5 * a1 + 4 * a2 - a3) * t * t + (-a0 + 3 * a1 - 3 * a2 + a3) * t * t * t);
  const dcr = (a0, a1, a2, a3, t) => 0.5 * ((-a0 + a2) + 2 * (2 * a0 - 5 * a1 + 4 * a2 - a3) * t + 3 * (-a0 + 3 * a1 - 3 * a2 + a3) * t * t);
  return { x: cr(pm.x, p0.x, p1.x, p2.x, f), y: cr(pm.y, p0.y, p1.y, p2.y, f), a: Math.atan2(dcr(pm.y, p0.y, p1.y, p2.y, f), dcr(pm.x, p0.x, p1.x, p2.x, f)) };
}

/* ---------- orbits ----------
   o: { radius, period (ms per turn), dir (1 clockwise on screen, -1 counter), phase (deg where it starts, 0 = right, -90 = top),
   squash (the orbit's height / width: < 1 for an oblique view), breathe (radius swell, fraction) }.
   Returns where the word is at t ms and the direction it moves (radians). */
export function orbitAt(o, t, c, R) {
  const dir = o.dir < 0 ? -1 : 1, period = Math.max(200, num(o.period, 2600)), sq = clamp(num(o.squash, 1), 0.2, 1.5);
  const ph = (num(o.phase, -90) * Math.PI) / 180 + (dir * TAU * t) / period;
  const r = R * (1 + num(o.breathe, 0.06) * Math.sin((TAU * t) / (period * 1.7)));
  const cs = Math.cos(ph), sn = Math.sin(ph);
  return { x: c.x + r * cs, y: c.y + r * sn * sq, a: Math.atan2(dir * cs * sq, -dir * sn), ph };
}

/* ---------- bending a word around its orbit (text on a circle) ----------
   The word's own envelope becomes an arc whose radius is the orbit's radius in word units, so the ring of letters lies on the
   circle; tops outward when it turns clockwise, inward when counter-clockwise (the word always reads in its direction of travel).
   Returns the offset (word units) from the picture's centre to the point of the word that sits on the circle. */
export function bendLayout(plan, Ru, dir) {
  const W = plan.layout.W;
  const ang = Math.min(1.6 * Math.PI, W / Math.max(0.5, Ru));
  plan.layout.E = { kind: "arc", W, ang: dir < 0 ? -ang : ang, rot: 0 };
  plan.bent = { R0: W / plan.layout.E.ang, dir: dir < 0 ? -1 : 1 };
  return plan.layout.E;
}

/* ---------- re-timing a timeline for a frame rate ----------
   threes: every drawing that is not an accent (a 1-tick smear, snap or flash) is held 3 or 6 ticks;
   ones: every drawing is split into 1-tick drawings, each a new drawing (fresh line boil); moving poses get in-betweens toward the
   next pose, held key poses (4+ ticks) and the hold's shakes are re-drawn in place (on ones a held pose still boils).
   `seed()` gives new boil seeds; the timeline is changed in place and returned. */
const LETTER = ["x", "y", "r", "s", "sx", "sy"];
function lerpPic(a, b, f, seed) {
  const q = { ...a, ticks: 1, g: { ...a.g }, letters: a.letters.map((l) => ({ ...l })), fx: a.fx.map((x) => ({ ...x, seed: seed() })), smear: null, boil: seed() };
  if ( b && f > 0 ) {
    for ( const k of ["x", "y", "r", "s", "sx", "sy"] ) q.g[k] = a.g[k] + ((b.g[k] ?? a.g[k]) - a.g[k]) * f;
    q.letters.forEach((l, i) => { const m = b.letters[i]; if ( !m || !m.v || !l.v ) return; for ( const k of LETTER ) l[k] = l[k] + ((m[k] ?? l[k]) - l[k]) * f; });
    q.dissolve = (a.dissolve ?? 0) + ((b.dissolve ?? 0) - (a.dissolve ?? 0)) * f;
  }
  return q;
}
export function retime(tl, on, seed) {
  if ( !on || on === 2 ) return tl;
  const accent = (p) => p.impact || (p.ticks === 1);
  if ( on === 3 ) {
    for ( const p of [...tl.ent, ...tl.hold, ...tl.exit] ) if ( !accent(p) || tl.hold.includes(p) ) p.ticks = clamp(Math.round(p.ticks / 3) * 3, 3, 6);
    tl.on = 3;
    return tl;
  }
  const split = (arr, next, interp) => {
    const out = [];
    arr.forEach((p, j) => {
      if ( p.impact || p.ticks <= 1 ) { out.push(p); return; }
      const b = interp && p.ticks < 4 ? next(j) : null;
      for ( let k = 0; k < p.ticks; k++ ) {
        const q = k === 0 ? { ...p, ticks: 1 } : lerpPic(p, b, b ? k / p.ticks : 0, seed);
        if ( k > 0 ) q.reseed = p.reseed;
        out.push(q);
      }
    });
    return out;
  };
  tl.ent = split(tl.ent, (j) => tl.ent[j + 1] ?? tl.hold[0], true);
  /* the hold cycle stays a small cycle (it is cached while the word lives): at most 8 drawings on ones */
  const hold = split(tl.hold, () => null, false);
  tl.hold = hold.slice(0, 8);
  tl.exit = split(tl.exit, (j) => tl.exit[j + 1] ?? null, true);
  tl.on = 1;
  return tl;
}

/* ---------- trails of a travelling word (secondary layer) ----------
   speed lines behind a word on a path; for a word bent on an orbit, swirl arcs along its circle behind it. Added to the hold and
   the last entrance pictures, each with its own seed (they are redrawn with the line boil). */
export function addTrail(plan, kind, dir, seed) {
  const tl = plan.timeline;
  const pics = [...tl.ent.slice(-2), ...tl.hold];
  for ( const p of pics ) {
    if ( p.impact ) continue;
    if ( kind === "orbit" && plan.bent ) p.fx.push({ k: "swirl", a: 0.9, R0: plan.bent.R0, dir: plan.bent.dir, seed: seed() });
    else p.fx.push({ k: "speed", a: 0.55, dir, seed: seed() });
  }
}
