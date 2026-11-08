/**
 * Zones from loose pencil lines (pure geometry, no Foundry): the GM scribbles lines freely, and every area that the lines close off
 * becomes a zone. Lines may overshoot (the bits sticking out are ignored, and `trim` removes them), cross each other or themselves,
 * and nearly touch (an end that stops just short of another line is joined to it).
 *
 *   const Z = buildZones(strokes, { snap, minArea });
 *   Z.zones      [{ id, rings: [[x, y, ...] outer, ...holes], area, cx, cy, label: {x, y, r}, faces: [faceIndex...] }]
 *   Z.adj        Map zoneId -> Map(neighbourZoneId -> shared border length)
 *   Z.borders    [{ a, b, pts: [x1, y1, x2, y2] }]      one per graph edge between two different zones (b = -1: the outside)
 *   Z.core       [[x, y, ...], ...]                      the lines that bound zones, as chains (what `trim` keeps)
 *   zoneAt(Z, x, y) -> zone id or -1;  distances(Z, from) -> Map zoneId -> borders crossed on the shortest route
 *
 * Method: all segments are cut at every crossing into a planar graph; ends that stop within `snap` of a line get a joining segment;
 * dangling edges are pruned (repeatedly drop vertices of degree 1); the faces of what is left are traced with half-edges (at every
 * vertex take the next edge clockwise); edges with the same face on both sides (a bridge, a line inside one zone) are pruned too.
 * A face of another component lying inside a zone is a hole of that zone. Faces smaller than `minArea` merge into the neighbour they
 * share the most border with (a sliver where two strokes cross twice is not a zone).
 */

const EPS = 1e-9;

/* ---------------------------------------------------------------- small helpers */

/** Signed area of a closed ring [x, y, ...] (positive = clockwise on screen, where y grows downward). */
export function ringArea(p) {
  let a = 0;
  for ( let i = 0, n = p.length; i < n; i += 2 ) {
    const j = (i + 2) % n;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return a / 2;
}

export function pointInRing(p, x, y) {
  let inside = false;
  for ( let i = 0, n = p.length, j = n - 2; i < n; j = i, i += 2 ) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ( (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi ) inside = !inside;
  }
  return inside;
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L > EPS ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + dx * t, y = ay + dy * t;
  return { d: Math.hypot(px - x, py - y), x, y, t };
}

/** Ramer-Douglas-Peucker on an open polyline. */
export function simplify(p, tol) {
  const n = p.length >> 1;
  if ( n <= 2 ) return p.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while ( stack.length ) {
    const [a, b] = stack.pop();
    let best = -1, bd = tol;
    for ( let i = a + 1; i < b; i++ ) {
      const d = distToSeg(p[i * 2], p[i * 2 + 1], p[a * 2], p[a * 2 + 1], p[b * 2], p[b * 2 + 1]).d;
      if ( d > bd ) { bd = d; best = i; }
    }
    if ( best >= 0 ) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for ( let i = 0; i < n; i++ ) if ( keep[i] ) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

/** Proper or touching intersection of segments ab and cd: [t on ab, u on cd] or null. Parallel segments never intersect here. */
function segX(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx;
  if ( Math.abs(den) < EPS ) return null;
  const qx = cx - ax, qy = cy - ay;
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  const e = 1e-7;
  if ( t < -e || t > 1 + e || u < -e || u > 1 + e ) return null;
  return [Math.max(0, Math.min(1, t)), Math.max(0, Math.min(1, u))];
}

/** A uniform grid of segment ids over their bounding boxes. */
class SegGrid {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(i, j) { return i * 73856093 ^ j * 19349663; }
  add(id, x0, y0, x1, y1) {
    const c = this.cell;
    for ( let i = Math.floor(Math.min(x0, x1) / c); i <= Math.floor(Math.max(x0, x1) / c); i++ ) {
      for ( let j = Math.floor(Math.min(y0, y1) / c); j <= Math.floor(Math.max(y0, y1) / c); j++ ) {
        const k = this.key(i, j); let a = this.map.get(k); if ( !a ) this.map.set(k, a = []); a.push(id);
      }
    }
  }
  near(x0, y0, x1, y1, out = new Set()) {
    const c = this.cell;
    for ( let i = Math.floor(Math.min(x0, x1) / c); i <= Math.floor(Math.max(x0, x1) / c); i++ ) {
      for ( let j = Math.floor(Math.min(y0, y1) / c); j <= Math.floor(Math.max(y0, y1) / c); j++ ) {
        const a = this.map.get(this.key(i, j)); if ( a ) for ( const id of a ) out.add(id);
      }
    }
    return out;
  }
}

/**
 * A smoothed copy of a line (0 = as drawn, 1 = very smooth): resampled every `step` pixels, then moving-average passes. The ends stay
 * where they are (lines still meet where they met); a closed line (ends together) is smoothed all the way round.
 */
export function smoothLine(p, amount, step) {
  const passes = Math.round(Math.max(0, Math.min(1, amount)) * 14);
  if ( !passes || p.length < 6 ) return p;
  // resample
  const q = [p[0], p[1]];
  let carry = 0;
  for ( let i = 2; i < p.length; i += 2 ) {
    const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1], L = Math.hypot(bx - ax, by - ay);
    let s = step - carry;
    while ( s < L ) { q.push(ax + ((bx - ax) * s) / L, ay + ((by - ay) * s) / L); s += step; }
    carry = L - (s - step);
  }
  q.push(p[p.length - 2], p[p.length - 1]);
  const n = q.length >> 1;
  if ( n < 3 ) return p;
  const closed = Math.hypot(q[0] - q[q.length - 2], q[1] - q[q.length - 1]) < step * 0.5;
  let a = q;
  for ( let k = 0; k < passes; k++ ) {
    const b = a.slice();
    for ( let i = 0; i < n; i++ ) {
      let im = i - 1, ip = i + 1;
      if ( closed ) { if ( i === 0 || i === n - 1 ) { im = n - 2; ip = 1; } }
      else if ( i === 0 || i === n - 1 ) continue;
      b[i * 2] = (a[im * 2] + 2 * a[i * 2] + a[ip * 2]) / 4;
      b[i * 2 + 1] = (a[im * 2 + 1] + 2 * a[i * 2 + 1] + a[ip * 2 + 1]) / 4;
    }
    if ( closed ) { b[(n - 1) * 2] = b[0]; b[(n - 1) * 2 + 1] = b[1]; }
    a = b;
  }
  return simplify(a, step * 0.05);
}

/* ---------------------------------------------------------------- the planar graph */

/**
 * Segments of the strokes, with joining segments for ends that stop just short of a line.
 * @returns {{segs: number[][], strokeOf: number[]}}  seg = [ax, ay, bx, by]
 */
function collectSegments(strokes, snap) {
  const segs = [], strokeOf = [], arcAt = [];
  strokes.forEach((p, s) => {
    let arc = 0;
    for ( let i = 2; i < p.length; i += 2 ) {
      const L = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
      if ( L < EPS ) continue;
      segs.push([p[i - 2], p[i - 1], p[i], p[i + 1]]); strokeOf.push(s); arcAt.push([arc, arc + L]);
      arc += L;
    }
  });
  if ( !(snap > 0) || !segs.length ) return { segs, strokeOf };
  const grid = new SegGrid(Math.max(snap * 4, 1));
  segs.forEach((g, i) => grid.add(i, g[0], g[1], g[2], g[3]));
  const joins = [];
  strokes.forEach((p, s) => {
    if ( p.length < 4 ) return;
    // stroke length, to skip the stroke's own segments right next to the end being joined
    let total = 0; for ( let i = 2; i < p.length; i += 2 ) total += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    for ( const atStart of [true, false] ) {
      const x = atStart ? p[0] : p[p.length - 2], y = atStart ? p[1] : p[p.length - 1];
      let best = null;
      for ( const id of grid.near(x - snap, y - snap, x + snap, y + snap) ) {
        if ( strokeOf[id] === s ) {
          const [a0, a1] = arcAt[id], far = atStart ? a0 : total - a1;
          if ( far < snap * 3 ) continue;
        }
        const g = segs[id], h = distToSeg(x, y, g[0], g[1], g[2], g[3]);
        if ( h.d <= snap && (!best || h.d < best.d) ) best = h;
      }
      // a real gap: join it (an end already on a line is joined by the crossing test)
      if ( best && best.d > 1e-6 ) {
        // reach a little past the line, so the crossing test always finds it
        const dx = best.x - x, dy = best.y - y, L = Math.hypot(dx, dy), k = (L + Math.min(1, snap * 0.05)) / L;
        joins.push([x, y, x + dx * k, y + dy * k]);
      }
    }
  });
  for ( const j of joins ) { segs.push(j); strokeOf.push(-1); }
  return { segs, strokeOf };
}

/** Cut every segment at its crossings; merge vertices closer than `merge`. Returns { V: [[x, y]], E: [[a, b]] } without duplicates. */
function planarize(segs, merge, isEdge = null) {
  const n = segs.length;
  const cuts = segs.map(() => [0, 1]);
  let cell = 0; for ( const g of segs ) cell += Math.hypot(g[2] - g[0], g[3] - g[1]);
  cell = Math.max(cell / Math.max(1, n) * 2, merge * 4, 1);
  const grid = new SegGrid(cell);
  segs.forEach((g, i) => grid.add(i, g[0], g[1], g[2], g[3]));
  for ( let i = 0; i < n; i++ ) {
    const a = segs[i];
    for ( const j of grid.near(a[0], a[1], a[2], a[3]) ) {
      if ( j <= i ) continue;
      const b = segs[j];
      if ( Math.max(a[0], a[2]) < Math.min(b[0], b[2]) - EPS || Math.max(b[0], b[2]) < Math.min(a[0], a[2]) - EPS ) continue;
      if ( Math.max(a[1], a[3]) < Math.min(b[1], b[3]) - EPS || Math.max(b[1], b[3]) < Math.min(a[1], a[3]) - EPS ) continue;
      const x = segX(a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]);
      if ( x ) { cuts[i].push(x[0]); cuts[j].push(x[1]); }
    }
  }
  // vertices, merged on a hash grid of size `merge`
  const V = [], vmap = new Map(), m = Math.max(merge, 1e-6);
  const vid = (x, y) => {
    const i = Math.round(x / m), j = Math.round(y / m);
    for ( let di = -1; di <= 1; di++ ) for ( let dj = -1; dj <= 1; dj++ ) {
      const list = vmap.get(`${i + di},${j + dj}`);
      if ( list ) for ( const id of list ) if ( Math.hypot(V[id][0] - x, V[id][1] - y) <= m ) return id;
    }
    const id = V.length; V.push([x, y]);
    const k = `${i},${j}`; let l = vmap.get(k); if ( !l ) vmap.set(k, l = []); l.push(id);
    return id;
  };
  const E = [], seen = new Set(), edgeE = [];
  for ( let i = 0; i < n; i++ ) {
    const g = segs[i], ts = [...new Set(cuts[i])].sort((p, q) => p - q);
    let prev = vid(g[0] + (g[2] - g[0]) * ts[0], g[1] + (g[3] - g[1]) * ts[0]);
    for ( let k = 1; k < ts.length; k++ ) {
      const v = vid(g[0] + (g[2] - g[0]) * ts[k], g[1] + (g[3] - g[1]) * ts[k]);
      if ( v !== prev ) {
        const key = prev < v ? `${prev},${v}` : `${v},${prev}`;
        if ( !seen.has(key) ) { seen.add(key); E.push([prev, v]); edgeE.push(isEdge?.[i] ? 1 : 0); }
      }
      prev = v;
    }
  }
  return { V, E, edgeE };
}

/** Drop vertices of degree <= 1 until none is left; returns the surviving edges' indices. */
function pruneDangling(V, E, alive) {
  const deg = new Int32Array(V.length), inc = V.map(() => []);
  E.forEach((e, i) => { if ( !alive[i] ) return; deg[e[0]]++; deg[e[1]]++; inc[e[0]].push(i); inc[e[1]].push(i); });
  const stack = [];
  for ( let v = 0; v < V.length; v++ ) if ( deg[v] === 1 ) stack.push(v);
  while ( stack.length ) {
    const v = stack.pop();
    if ( deg[v] !== 1 ) continue;
    for ( const i of inc[v] ) {
      if ( !alive[i] ) continue;
      alive[i] = 0;
      const o = E[i][0] === v ? E[i][1] : E[i][0];
      deg[v]--; deg[o]--;
      if ( deg[o] === 1 ) stack.push(o);
    }
  }
}

/**
 * Faces of the graph made of the alive edges. Half-edge 2i runs E[i][0] -> E[i][1], 2i+1 back. Returns { faceOf (per half-edge),
 * faces: [{ hes: [half-edge ids], ring: [x, y, ...], area }] }.
 */
function traceFaces(V, E, alive) {
  const out = V.map(() => []);
  E.forEach((e, i) => {
    if ( !alive[i] ) return;
    out[e[0]].push(2 * i); out[e[1]].push(2 * i + 1);
  });
  const from = (h) => E[h >> 1][h & 1], to = (h) => E[h >> 1][(h & 1) ^ 1];
  const ang = new Float64Array(E.length * 2);
  for ( let v = 0; v < V.length; v++ ) {
    for ( const h of out[v] ) { const w = V[to(h)]; ang[h] = Math.atan2(w[1] - V[v][1], w[0] - V[v][0]); }
    out[v].sort((a, b) => ang[a] - ang[b]);
  }
  const pos = new Int32Array(E.length * 2);
  for ( let v = 0; v < V.length; v++ ) out[v].forEach((h, k) => { pos[h] = k; });
  // next(h): arriving at v along h, leave by the outgoing edge just before the way back (twin) in angle order
  const next = (h) => { const t = h ^ 1, v = from(t), list = out[v]; return list[(pos[t] - 1 + list.length) % list.length]; };
  const faceOf = new Int32Array(E.length * 2).fill(-1), faces = [];
  for ( let i = 0; i < E.length; i++ ) {
    if ( !alive[i] ) continue;
    for ( const h0 of [2 * i, 2 * i + 1] ) {
      if ( faceOf[h0] >= 0 ) continue;
      const f = faces.length, hes = [], ring = [];
      let h = h0, guard = 0;
      do {
        faceOf[h] = f; hes.push(h);
        const p = V[from(h)]; ring.push(p[0], p[1]);
        h = next(h);
      } while ( h !== h0 && ++guard < 1e6 );
      faces.push({ hes, ring, area: ringArea(ring) });
    }
  }
  return { faceOf, faces, from, to };
}

/* ---------------------------------------------------------------- zones */

/** A point well inside a polygon with holes (a coarse "pole of inaccessibility"), and its distance to the nearest border. */
function labelPoint(rings) {
  const o = rings[0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( let i = 0; i < o.length; i += 2 ) { x0 = Math.min(x0, o[i]); x1 = Math.max(x1, o[i]); y0 = Math.min(y0, o[i + 1]); y1 = Math.max(y1, o[i + 1]); }
  const inside = (x, y) => pointInRing(o, x, y) && !rings.slice(1).some((h) => pointInRing(h, x, y));
  const clear = (x, y) => {
    let d = Infinity;
    for ( const r of rings ) for ( let i = 0, n = r.length; i < n; i += 2 ) { const j = (i + 2) % n; d = Math.min(d, distToSeg(x, y, r[i], r[i + 1], r[j], r[j + 1]).d); }
    return d;
  };
  let best = null;
  const scan = (ax, ay, bx, by, N) => {
    for ( let i = 0; i <= N; i++ ) for ( let j = 0; j <= N; j++ ) {
      const x = ax + ((bx - ax) * (i + 0.5)) / (N + 1), y = ay + ((by - ay) * (j + 0.5)) / (N + 1);
      if ( !inside(x, y) ) continue;
      const r = clear(x, y);
      if ( !best || r > best.r ) best = { x, y, r };
    }
  };
  scan(x0, y0, x1, y1, 16);
  if ( best ) { const w = (x1 - x0) / 8, h = (y1 - y0) / 8; scan(best.x - w, best.y - h, best.x + w, best.y + h, 8); }
  if ( !best ) { let cx = 0, cy = 0; for ( let i = 0; i < o.length; i += 2 ) { cx += o[i]; cy += o[i + 1]; } best = { x: cx / (o.length / 2), y: cy / (o.length / 2), r: 0 }; }
  return best;
}

/**
 * Build the zones of a set of strokes.
 * @param {number[][]} strokes           flat polylines [x, y, ...] in scene pixels
 * @param {object} [o]
 * @param {number} [o.snap=0]            an end this close to a line is joined to it
 * @param {number} [o.merge]             vertices this close are one (default snap / 20, at least 0.01)
 * @param {number} [o.minArea=0]         smaller zones merge into their neighbour (a small zone with no neighbour is no zone)
 * @param {{x, y, width, height}} [o.edge]   the map's edge: it closes zones like a line where lines reach it, but an area bounded by
 *                                       the edge alone (the rest of the map around the drawn zones) is not a zone
 */
export function buildZones(strokes, { snap = 0, merge, minArea = 0, edge = null } = {}) {
  const clean = strokes.filter((p) => Array.isArray(p) && p.length >= 4);
  const edgeAt = edge && edge.width > 0 && edge.height > 0 ? clean.length : -1;
  if ( edgeAt >= 0 ) { const { x, y, width: w, height: h } = edge; clean.push([x, y, x + w, y, x + w, y + h, x, y + h, x, y]); }
  const { segs, strokeOf } = collectSegments(clean, snap);
  const isEdge = strokeOf.map((s) => (s === edgeAt && edgeAt >= 0 ? 1 : 0));
  const P = planarize(segs, merge ?? Math.max(0.01, snap / 20), isEdge);
  const { V, E } = P, edgeE = P.edgeE;
  const alive = new Uint8Array(E.length).fill(1);
  pruneDangling(V, E, alive);
  // bridges (the same face on both sides) go too, then whatever they left dangling; repeat until stable
  let T;
  for ( let guard = 0; guard < 50; guard++ ) {
    T = traceFaces(V, E, alive);
    let cut = 0;
    for ( let i = 0; i < E.length; i++ ) if ( alive[i] && T.faceOf[2 * i] === T.faceOf[2 * i + 1] ) { alive[i] = 0; cut++; }
    if ( !cut ) break;
    pruneDangling(V, E, alive);
  }
  const { faces, faceOf } = T;

  // connected components (by alive edges); the outer face of each is the one with the opposite sign (negative area: anticlockwise)
  const comp = new Int32Array(V.length).fill(-1), adjV = V.map(() => []);
  E.forEach((e, i) => { if ( alive[i] ) { adjV[e[0]].push(e[1]); adjV[e[1]].push(e[0]); } });
  let nc = 0;
  for ( let v = 0; v < V.length; v++ ) {
    if ( comp[v] >= 0 || !adjV[v].length ) continue;
    const st = [v]; comp[v] = nc;
    while ( st.length ) { const u = st.pop(); for ( const w of adjV[u] ) if ( comp[w] < 0 ) { comp[w] = nc; st.push(w); } }
    nc++;
  }
  const faceComp = faces.map((f) => comp[E[f.hes[0] >> 1][f.hes[0] & 1]]);
  // a face bounded by the map's edge alone is the rest of the map, not a zone: it counts as the outside
  const bounded = faces.map((f) => f.area > 0 && !(edgeAt >= 0 && f.hes.every((h) => edgeE[h >> 1])));

  // holes: the outer face of a component that lies inside a bounded face of another component
  const container = faces.map(() => -1);   // outer face -> the bounded face around it (-1: the real outside)
  faces.forEach((f, i) => {
    if ( bounded[i] ) return;
    const x = f.ring[0], y = f.ring[1];
    let best = -1;
    faces.forEach((g, j) => {
      if ( !bounded[j] || faceComp[j] === faceComp[i] ) return;
      if ( pointInRing(g.ring, x, y) && (best < 0 || g.area < faces[best].area) ) best = j;
    });
    container[i] = best;
  });
  // what a face stands for: a bounded face itself, an outer face its container (or -1)
  const owner = faces.map((f, i) => bounded[i] ? i : container[i]);

  // union-find of bounded faces: slivers merge into the neighbour with the longest shared border
  const parent = faces.map((_, i) => i);
  const find = (i) => { while ( parent[i] !== i ) i = parent[i] = parent[parent[i]]; return i; };
  const shared = (fi) => {
    const m = new Map();
    for ( const h of faces[fi].hes ) {
      const o = owner[faceOf[h ^ 1]], a = V[E[h >> 1][0]], b = V[E[h >> 1][1]];
      const k = o < 0 ? -1 : find(o);
      if ( k === find(fi) ) continue;
      m.set(k, (m.get(k) ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    return m;
  };
  if ( minArea > 0 ) {
    const order = faces.map((f, i) => i).filter((i) => bounded[i]).sort((a, b) => faces[a].area - faces[b].area);
    for ( const i of order ) {
      const r = find(i);
      let area = 0; faces.forEach((f, j) => { if ( bounded[j] && find(j) === r ) area += f.area; });
      if ( area >= minArea ) continue;
      let best = null, bl = 0;
      for ( const [k, L] of shared(i) ) if ( k >= 0 && L > bl ) { bl = L; best = k; }
      if ( best != null ) parent[r] = find(best);
    }
  }

  // zones: groups of bounded faces, numbered top to bottom, left to right
  const groups = new Map();
  faces.forEach((f, i) => { if ( !bounded[i] ) return; const r = find(i); let g = groups.get(r); if ( !g ) groups.set(r, g = []); g.push(i); });
  const holesOf = new Map();   // bounded face -> [outer rings of components inside it]
  faces.forEach((f, i) => { if ( !bounded[i] && container[i] >= 0 ) { let l = holesOf.get(container[i]); if ( !l ) holesOf.set(container[i], l = []); l.push(f.ring); } });
  const groupArea = (fl) => { let a = 0; for ( const fi of fl ) { a += faces[fi].area; for ( const h of holesOf.get(fi) ?? [] ) a += ringArea(h); } return a; };
  // still too small (nothing to merge into): not a zone
  if ( minArea > 0 ) for ( const [r, fl] of [...groups] ) if ( groupArea(fl) < minArea ) groups.delete(r);
  let zones = [...groups.values()].map((fl) => {
    const parts = fl.map((fi) => [faces[fi].ring, ...(holesOf.get(fi) ?? [])]);
    let area = 0; for ( const fi of fl ) { area += faces[fi].area; for ( const h of holesOf.get(fi) ?? [] ) area += ringArea(h); }   // hole rings run the other way
    const main = parts.reduce((a, b) => (ringArea(b[0]) > ringArea(a[0]) ? b : a));
    const label = labelPoint(main);
    return { faces: fl, parts, rings: main, area, label, cx: label.x, cy: label.y };
  });
  const rowH = zones.length ? Math.sqrt(zones.reduce((s, z) => s + z.area, 0) / zones.length) : 1;
  zones.sort((a, b) => (Math.round(a.cy / rowH) - Math.round(b.cy / rowH)) || (a.cx - b.cx));
  const zoneOfFace = new Int32Array(faces.length).fill(-1);
  zones.forEach((z, id) => { z.id = id; for ( const fi of z.faces ) zoneOfFace[fi] = id; });
  const zoneOfOwner = (o) => (o < 0 ? -1 : zoneOfFace[o]);

  // borders and adjacency
  const adj = new Map(zones.map((z) => [z.id, new Map()]));
  const borders = [];
  E.forEach((e, i) => {
    if ( !alive[i] ) return;
    const a = zoneOfOwner(owner[faceOf[2 * i]]), b = zoneOfOwner(owner[faceOf[2 * i + 1]]);
    if ( a === b ) return;                        // inside a merged zone
    const p = V[e[0]], q = V[e[1]], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    borders.push({ a: Math.max(a, b), b: Math.min(a, b), pts: [p[0], p[1], q[0], q[1]], len: L, edge: !!edgeE[i] });
    if ( a >= 0 && b >= 0 ) {
      adj.get(a).set(b, (adj.get(a).get(b) ?? 0) + L);
      adj.get(b).set(a, (adj.get(b).get(a) ?? 0) + L);
    }
  });

  // the lines that bound zones, as chains between vertices of degree != 2 (what trimming keeps)
  const keep = new Uint8Array(E.length);
  // (the map's edge is no pencil line: never kept, never drawn)
  E.forEach((e, i) => { if ( alive[i] && !edgeE[i] && zoneOfOwner(owner[faceOf[2 * i]]) !== zoneOfOwner(owner[faceOf[2 * i + 1]]) ) keep[i] = 1; });
  const core = chains(V, E, keep);

  for ( const z of zones ) delete z.faces;
  return { zones, adj, borders, core, stats: { segments: segs.length, vertices: V.length, edges: E.length, kept: keep.reduce((s, k) => s + k, 0) } };
}

/** Kept edges joined into polylines that run between vertices of degree != 2 (a closed loop stays one ring, first point repeated). */
function chains(V, E, keep) {
  const inc = V.map(() => []);
  E.forEach((e, i) => { if ( keep[i] ) { inc[e[0]].push(i); inc[e[1]].push(i); } });
  const used = new Uint8Array(E.length), out = [];
  const walk = (v, i) => {
    const p = [V[v][0], V[v][1]];
    let u = v;
    for ( ;; ) {
      used[i] = 1;
      const w = E[i][0] === u ? E[i][1] : E[i][0];
      p.push(V[w][0], V[w][1]);
      if ( inc[w].length !== 2 || w === v ) break;
      const j = inc[w][0] === i ? inc[w][1] : inc[w][0];
      if ( used[j] ) break;
      u = w; i = j;
    }
    return p;
  };
  for ( let v = 0; v < V.length; v++ ) if ( inc[v].length && inc[v].length !== 2 ) for ( const i of inc[v] ) if ( !used[i] ) out.push(walk(v, i));
  for ( let i = 0; i < E.length; i++ ) if ( keep[i] && !used[i] ) out.push(walk(E[i][0], i));
  return out;
}

/**
 * The top-left-most point of a zone where a badge of radius `minR` fits (clear of every border by `minR`): scans the zone's
 * bounding box and keeps the inside point closest to its top-left corner. Falls back to the label point. Cached per zone and radius.
 */
export function cornerPoint(zone, minR) {
  const key = Math.round(minR * 4) / 4;
  zone._corner ??= new Map();
  if ( zone._corner.has(key) ) return zone._corner.get(key);
  const rings = zone.rings, o = rings[0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( let i = 0; i < o.length; i += 2 ) { x0 = Math.min(x0, o[i]); x1 = Math.max(x1, o[i]); y0 = Math.min(y0, o[i + 1]); y1 = Math.max(y1, o[i + 1]); }
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const inside = (x, y) => pointInRing(o, x, y) && !rings.slice(1).some((r) => pointInRing(r, x, y));
  const clearOf = (x, y, need) => {
    for ( const r of rings ) for ( let i = 0, n = r.length; i < n; i += 2 ) { const j = (i + 2) % n; if ( distToSeg(x, y, r[i], r[i + 1], r[j], r[j + 1]).d < need ) return false; }
    return true;
  };
  // candidates ordered by closeness to the top-left corner; the first that fits wins
  const N = 28, cand = [];
  for ( let i = 0; i <= N; i++ ) for ( let j = 0; j <= N; j++ ) {
    const x = x0 + (w * i) / N, y = y0 + (h * j) / N;
    cand.push([(x - x0) / w + (y - y0) / h, x, y]);
  }
  cand.sort((a, b) => a[0] - b[0]);
  let best = null;
  for ( const [, x, y] of cand ) if ( inside(x, y) && clearOf(x, y, minR) ) { best = { x, y }; break; }
  best ??= { x: zone.label.x, y: zone.label.y };
  zone._corner.set(key, best);
  return best;
}

/* ---------------------------------------------------------------- queries */

/** The zone at a point (-1: outside every zone). */
export function zoneAt(Z, x, y) {
  if ( !Z ) return -1;
  for ( const z of Z.zones ) {
    for ( const part of z.parts ) {
      if ( pointInRing(part[0], x, y) && !part.slice(1).some((h) => pointInRing(h, x, y)) ) return z.id;
    }
  }
  return -1;
}

/**
 * Borders crossed on the shortest route from zone `from` to every zone it can reach (BFS). `blocked(a, b)` (optional) closes a border.
 * @returns {Map<number, number>}
 */
export function distances(Z, from, blocked = null) {
  const d = new Map();
  if ( !Z || from < 0 || !Z.adj.has(from) ) return d;
  d.set(from, 0);
  const q = [from];
  for ( let k = 0; k < q.length; k++ ) {
    const a = q[k];
    for ( const b of Z.adj.get(a).keys() ) {
      if ( d.has(b) || blocked?.(a, b) ) continue;
      d.set(b, d.get(a) + 1); q.push(b);
    }
  }
  return d;
}

/** Zones between two points (null when either is outside every zone or there is no route). */
export function zoneDistance(Z, ax, ay, bx, by) {
  const a = zoneAt(Z, ax, ay), b = zoneAt(Z, bx, by);
  if ( a < 0 || b < 0 ) return null;
  return distances(Z, a).get(b) ?? null;
}
