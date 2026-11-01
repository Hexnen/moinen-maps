/**
 * The road network as a graph: nodes (junctions, bends where the style changes, dead ends) joined by edges (smooth roads).
 * Pure geometry, no Foundry or PIXI: everything works in scene pixels and takes the grid size as `g`.
 *
 * In memory:  G = { nodes: Map<id, {id, x, y}>, edges: Map<id, Edge>, next: id counter }
 *             Edge = { id, a, b, pts: [x0, y0, ..., xn, yn] control points INCLUDING both ends (ends sit on nodes a and b),
 *                      k: kind, w: width in grid squares, l: lanes (1|2), o: one-way a->b (0|1) }
 * The drawn road is a Catmull-Rom curve through the control points (`curve`), so a few points make a smooth road.
 *
 * Editing (`addStroke`, `erase`, `removeEdge`, `restyle`) always ends with `normalize`, which merges nodes that touch, drops
 * slivers and joins two edges of the same style meeting end to end, so the graph stays small and clean.
 */

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------------------------------------------------------- polylines */

/** Catmull-Rom (uniform) through flat control points, a point about every `step` px. Ends are kept exactly. */
export function curve(pts, step) {
  const n = pts.length >> 1;
  if ( n < 2 ) return pts.slice();
  if ( n === 2 ) return resample(pts, step);
  const out = [];
  const P = (i) => { i = Math.max(0, Math.min(n - 1, i)); return [pts[i * 2], pts[i * 2 + 1]]; };
  const cr = (a, b, c, d, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); };
  for ( let i = 0; i < n - 1; i++ ) {
    const [ax, ay] = P(i - 1), [bx, by] = P(i), [cx, cy] = P(i + 1), [dx, dy] = P(i + 2);
    // sqrt, not hypot: the traffic is built from this curve and must come out bit-identical on every client
    const k = Math.max(1, Math.ceil(Math.sqrt((cx - bx) * (cx - bx) + (cy - by) * (cy - by)) / step));
    for ( let q = 0; q < k; q++ ) { const t = q / k; out.push(cr(ax, bx, cx, dx, t), cr(ay, by, cy, dy, t)); }
  }
  out.push(pts[n * 2 - 2], pts[n * 2 - 1]);
  return out;
}

/** Cumulative lengths of a flat polyline. */
export function lengths(p) {
  const n = p.length >> 1, ss = new Float64Array(n);
  for ( let i = 1; i < n; i++ ) ss[i] = ss[i - 1] + Math.sqrt((p[i * 2] - p[i * 2 - 2]) ** 2 + (p[i * 2 + 1] - p[i * 2 - 1]) ** 2);
  return ss;
}

/** Evenly spaced points (about every `step`) along a flat polyline, ends kept. */
export function resample(p, step) {
  const n = p.length >> 1;
  if ( n < 2 ) return p.slice();
  const ss = lengths(p), L = ss[n - 1];
  const k = Math.max(1, Math.round(L / step)), out = [];
  let j = 1;
  for ( let q = 0; q <= k; q++ ) {
    const s = (L * q) / k;
    while ( j < n - 1 && ss[j] < s ) j++;
    const seg = ss[j] - ss[j - 1], f = seg > 0 ? (s - ss[j - 1]) / seg : 0;
    out.push(p[j * 2 - 2] + (p[j * 2] - p[j * 2 - 2]) * f, p[j * 2 - 1] + (p[j * 2 + 1] - p[j * 2 - 1]) * f);
  }
  return out;
}

/** Point at arc length s of a polyline with cumulative lengths ss: [x, y, segment index]. */
export function pointAtS(p, ss, s) {
  const n = ss.length;
  if ( s <= 0 ) return [p[0], p[1], 0];
  if ( s >= ss[n - 1] ) return [p[n * 2 - 2], p[n * 2 - 1], n - 2];
  let lo = 0, hi = n - 1;
  while ( hi - lo > 1 ) { const m = (lo + hi) >> 1; if ( ss[m] <= s ) lo = m; else hi = m; }
  const seg = ss[hi] - ss[lo], f = seg > 0 ? (s - ss[lo]) / seg : 0;
  return [p[lo * 2] + (p[hi * 2] - p[lo * 2]) * f, p[lo * 2 + 1] + (p[hi * 2 + 1] - p[lo * 2 + 1]) * f, lo];
}

/** The part of a polyline between arc lengths s0 < s1. */
export function slice(p, ss, s0, s1) {
  const n = ss.length, out = [];
  const a = pointAtS(p, ss, s0), b = pointAtS(p, ss, s1);
  out.push(a[0], a[1]);
  for ( let i = 0; i < n; i++ ) if ( ss[i] > s0 + 1e-6 && ss[i] < s1 - 1e-6 ) out.push(p[i * 2], p[i * 2 + 1]);
  out.push(b[0], b[1]);
  return out;
}

/** Nearest point of a polyline to (x, y): { d, s, x, y }. */
export function nearestOn(p, ss, x, y) {
  let best = { d: Infinity, s: 0, x: p[0], y: p[1] };
  const n = p.length >> 1;
  if ( n === 1 ) return { d: Math.hypot(x - p[0], y - p[1]), s: 0, x: p[0], y: p[1] };
  for ( let i = 0; i < n - 1; i++ ) {
    const ax = p[i * 2], ay = p[i * 2 + 1], vx = p[i * 2 + 2] - ax, vy = p[i * 2 + 3] - ay, L2 = vx * vx + vy * vy;
    const t = L2 > 0 ? clamp(((x - ax) * vx + (y - ay) * vy) / L2, 0, 1) : 0;
    const px = ax + vx * t, py = ay + vy * t, d = Math.hypot(x - px, y - py);
    if ( d < best.d ) best = { d, s: ss[i] + (ss[i + 1] - ss[i]) * t, x: px, y: py };
  }
  return best;
}

/** Douglas-Peucker on a flat polyline (ends kept). */
export function simplify(p, tol) {
  const n = p.length >> 1;
  if ( n < 3 ) return p.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while ( stack.length ) {
    const [a, b] = stack.pop();
    const ax = p[a * 2], ay = p[a * 2 + 1], dx = p[b * 2] - ax, dy = p[b * 2 + 1] - ay, len = Math.hypot(dx, dy);
    let max = 0, idx = -1;
    for ( let i = a + 1; i < b; i++ ) {
      const d = len > 0 ? Math.abs((p[i * 2] - ax) * dy - (p[i * 2 + 1] - ay) * dx) / len : Math.hypot(p[i * 2] - ax, p[i * 2 + 1] - ay);
      if ( d > max ) { max = d; idx = i; }
    }
    if ( max > tol && idx > 0 ) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for ( let i = 0; i < n; i++ ) if ( keep[i] ) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

/** A shaky freehand line to a few smooth control points. */
export function smoothStroke(raw, g) {
  let p = resample(raw, g * 0.12);
  // a few passes of a moving average, ends pinned
  for ( let pass = 0; pass < 3; pass++ ) {
    const q = p.slice(), n = p.length >> 1;
    for ( let i = 1; i < n - 1; i++ ) {
      q[i * 2] = (p[i * 2 - 2] + 2 * p[i * 2] + p[i * 2 + 2]) / 4;
      q[i * 2 + 1] = (p[i * 2 - 1] + 2 * p[i * 2 + 1] + p[i * 2 + 3]) / 4;
    }
    p = q;
  }
  return simplify(p, g * 0.06);
}

/** Intersections of segment ab with segment cd: { t, u } (fractions) or null. */
function segX(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
  if ( Math.abs(den) < 1e-9 ) return null;
  const qx = cx - ax, qy = cy - ay, t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

const bbox = (p, pad = 0) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( let i = 0; i < p.length; i += 2 ) { if ( p[i] < x0 ) x0 = p[i]; if ( p[i] > x1 ) x1 = p[i]; if ( p[i + 1] < y0 ) y0 = p[i + 1]; if ( p[i + 1] > y1 ) y1 = p[i + 1]; }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
};
const overlap = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** All crossings of polyline P with polyline Q: [{ sp, sq, x, y }] in arc lengths. */
function crossings(P, Pss, Q, Qss) {
  const out = [];
  if ( !overlap(bbox(P), bbox(Q)) ) return out;
  const np = P.length >> 1, nq = Q.length >> 1;
  for ( let i = 0; i < np - 1; i++ ) {
    const ax = P[i * 2], ay = P[i * 2 + 1], bx = P[i * 2 + 2], by = P[i * 2 + 3];
    const sx0 = Math.min(ax, bx), sx1 = Math.max(ax, bx), sy0 = Math.min(ay, by), sy1 = Math.max(ay, by);
    for ( let j = 0; j < nq - 1; j++ ) {
      const cx = Q[j * 2], cy = Q[j * 2 + 1], dx = Q[j * 2 + 2], dy = Q[j * 2 + 3];
      if ( Math.max(cx, dx) < sx0 || Math.min(cx, dx) > sx1 || Math.max(cy, dy) < sy0 || Math.min(cy, dy) > sy1 ) continue;
      const h = segX(ax, ay, bx, by, cx, cy, dx, dy);
      if ( h ) out.push({ sp: Pss[i] + (Pss[i + 1] - Pss[i]) * h.t, sq: Qss[j] + (Qss[j + 1] - Qss[j]) * h.u, x: ax + (bx - ax) * h.t, y: ay + (by - ay) * h.t });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- the graph */

export const emptyGraph = () => ({ nodes: new Map(), edges: new Map(), next: 1 });

export function cloneGraph(G) {
  return {
    nodes: new Map([...G.nodes].map(([k, n]) => [k, { ...n }])),
    edges: new Map([...G.edges].map(([k, e]) => [k, { ...e, pts: e.pts.slice() }])),
    next: G.next
  };
}

/** The dense centre line of an edge (cached on the edge until its points change). */
export function edgeCurve(e, g) {
  const key = `${g}|${e.pts.join(",")}`;
  if ( e._ck !== key ) {
    const c = curve(e.pts, g * 0.08);
    Object.defineProperties(e, { _ck: { value: key, writable: true, configurable: true }, _c: { value: { p: c, ss: lengths(c) }, writable: true, configurable: true } });
  }
  return e._c;
}

export const degree = (G, id) => { let d = 0; for ( const e of G.edges.values() ) { if ( e.a === id ) d++; if ( e.b === id ) d++; } return d; };
export function incident(G, id) { const out = []; for ( const e of G.edges.values() ) if ( e.a === id || e.b === id ) out.push(e); return out; }

function addNode(G, x, y) { const id = G.next++; G.nodes.set(id, { id, x, y }); return id; }
function addEdge(G, a, b, pts, style) {
  const id = G.next++;
  const A = G.nodes.get(a), B = G.nodes.get(b);
  const p = pts.slice(); p[0] = A.x; p[1] = A.y; p[p.length - 2] = B.x; p[p.length - 1] = B.y;
  const e = { id, a, b, pts: p, k: style.k, w: style.w, l: style.l, o: style.o ? 1 : 0 };
  G.edges.set(id, e);
  return e;
}
const styleOf = (e) => ({ k: e.k, w: e.w, l: e.l, o: e.o });

/** Control points for a piece of dense curve: simplified tightly so the Catmull-Rom curve through them retraces it. */
const controls = (dense, g) => simplify(dense, g * 0.025);

/**
 * Split edge e at arc lengths `cuts` (on its dense curve). Each cut becomes a node (an existing one when `nodeAt` gives an id).
 * Returns the node ids in the order of `cuts`.
 */
function splitEdge(G, e, cuts, g) {
  const { p, ss } = edgeCurve(e, g), L = ss[ss.length - 1];
  const list = cuts.map((c, i) => ({ ...c, i })).filter((c) => c.s > 1e-3 && c.s < L - 1e-3).sort((a, b) => a.s - b.s);
  const ids = new Array(cuts.length);
  cuts.forEach((c, i) => { if ( c.s <= 1e-3 ) ids[i] = e.a; else if ( c.s >= L - 1e-3 ) ids[i] = e.b; });
  if ( !list.length ) return ids;
  G.edges.delete(e.id);
  let prevS = 0, prevNode = e.a;
  for ( const c of list ) {
    const [x, y] = pointAtS(p, ss, c.s);
    const nid = c.node ?? addNode(G, x, y);
    ids[c.i] = nid;
    if ( c.s - prevS > 1e-3 ) addEdge(G, prevNode, nid, controls(slice(p, ss, prevS, c.s), g), styleOf(e));
    prevS = c.s; prevNode = nid;
  }
  addEdge(G, prevNode, e.b, controls(slice(p, ss, prevS, L), g), styleOf(e));
  return ids;
}

/** The nearest node within r of (x, y), or null. */
export function nearestNode(G, x, y, r) {
  let best = null, bd = r;
  for ( const n of G.nodes.values() ) { const d = Math.hypot(n.x - x, n.y - y); if ( d <= bd ) { bd = d; best = n; } }
  return best;
}

/** The nearest point on any edge within r of (x, y): { e, s, x, y, d } or null. */
export function nearestEdge(G, x, y, r, g, filter) {
  let best = null;
  for ( const e of G.edges.values() ) {
    if ( filter && !filter(e) ) continue;
    const c = edgeCurve(e, g), h = nearestOn(c.p, c.ss, x, y);
    if ( h.d <= r && (!best || h.d < best.d) ) best = { e, ...h };
  }
  return best;
}

/** Where a point would attach: an existing node, a point on an edge, or nothing. */
export function snapTarget(G, x, y, r, g) {
  const n = nearestNode(G, x, y, r);
  if ( n ) return { kind: "node", node: n.id, x: n.x, y: n.y };
  const h = nearestEdge(G, x, y, r, g);
  if ( h ) {
    // close to an end of the edge: that end's node is the better target
    const L = h.e._c.ss[h.e._c.ss.length - 1];
    if ( h.s < r ) { const a = G.nodes.get(h.e.a); return { kind: "node", node: a.id, x: a.x, y: a.y }; }
    if ( L - h.s < r ) { const b = G.nodes.get(h.e.b); return { kind: "node", node: b.id, x: b.x, y: b.y }; }
    return { kind: "edge", edge: h.e.id, s: h.s, x: h.x, y: h.y };
  }
  return null;
}

/** Resolve a snap target to a node id (splitting an edge when the target is on one). */
function attach(G, t, x, y, g) {
  if ( !t ) return addNode(G, x, y);
  if ( t.kind === "node" ) return G.nodes.has(t.node) ? t.node : addNode(G, x, y);
  let e = G.edges.get(t.edge), s = t.s;
  if ( !e ) {
    // split meanwhile by a crossing: the piece that now holds the point
    const h = nearestEdge(G, t.x, t.y, 2, g);
    if ( !h ) return addNode(G, x, y);
    e = h.e; s = h.s;
  }
  const near = s < g * 0.15 ? e.a : (edgeCurve(e, g).ss.at(-1) - s < g * 0.15 ? e.b : null);
  if ( near != null ) return near;
  return splitEdge(G, e, [{ s }], g)[0];
}

/**
 * Add a road drawn as control points `ctrl` with a style. Its ends join a node or road within `snapR`; wherever it crosses a road
 * both are split there and share a junction. Returns the ids of the new edges.
 */
export function addStroke(G, ctrl, style, g, snapR) {
  if ( ctrl.length < 4 ) return [];
  const sx = ctrl[0], sy = ctrl[1], ex = ctrl[ctrl.length - 2], ey = ctrl[ctrl.length - 1];
  const tStart = snapTarget(G, sx, sy, snapR, g), tEnd = snapTarget(G, ex, ey, snapR, g);
  const pts = ctrl.slice();
  if ( tStart ) { pts[0] = tStart.x; pts[1] = tStart.y; }
  if ( tEnd ) { pts[pts.length - 2] = tEnd.x; pts[pts.length - 1] = tEnd.y; }
  const dense = curve(pts, g * 0.08), dss = lengths(dense), L = dss[dss.length - 1];
  if ( L < g * 0.3 ) return [];

  // crossings with the existing roads (not where the stroke starts or ends: that is the snap)
  const hits = [];
  for ( const e of [...G.edges.values()] ) {
    const c = edgeCurve(e, g);
    for ( const h of crossings(dense, dss, c.p, c.ss) ) {
      if ( h.sp < snapR || h.sp > L - snapR ) continue;
      hits.push({ ...h, e: e.id });
    }
  }
  hits.sort((a, b) => a.sp - b.sp);
  // crossings close together along the stroke (a crossing right at a junction) become one
  const groups = [];
  for ( const h of hits ) {
    const last = groups[groups.length - 1];
    if ( last && h.sp - last.sp < snapR * 0.8 ) last.items.push(h); else groups.push({ sp: h.sp, items: [h] });
  }

  const startId = attach(G, tStart, sx, sy, g);
  const endIdPending = tEnd;
  const cutNodes = [];
  for ( const grp of groups ) {
    const h0 = grp.items[0];
    // a crossing next to an existing node joins that node instead of making a sliver
    const near = nearestNode(G, h0.x, h0.y, snapR * 0.8);
    let nid = near?.id;
    for ( const h of grp.items ) {
      const e = G.edges.get(h.e);
      if ( !e ) {
        // the edge was split already (it crossed twice): find the piece that now holds this point
        const hit = nearestEdge(G, h.x, h.y, 1.5, g);
        if ( !hit ) continue;
        const ids = splitEdge(G, hit.e, [{ s: hit.s, node: nid }], g);
        nid ??= ids[0];
        continue;
      }
      if ( nid != null && (e.a === nid || e.b === nid) ) continue;
      const c = edgeCurve(e, g), at = nearestOn(c.p, c.ss, h.x, h.y);
      const ids = splitEdge(G, e, [{ s: at.s, node: nid }], g);
      nid ??= ids[0];
    }
    if ( nid == null ) nid = addNode(G, h0.x, h0.y);
    cutNodes.push({ s: grp.sp, node: nid });
  }
  const endId = attach(G, endIdPending, ex, ey, g);

  // the stroke itself, split at the junctions
  const made = [];
  const chain = [{ s: 0, node: startId }, ...cutNodes, { s: L, node: endId }];
  for ( let i = 0; i < chain.length - 1; i++ ) {
    const a = chain[i], b = chain[i + 1];
    if ( a.node === b.node && b.s - a.s < g * 1.5 ) continue;
    if ( b.s - a.s < 1e-3 ) continue;
    const piece = controls(slice(dense, dss, a.s, b.s), g);
    made.push(addEdge(G, a.node, b.node, piece, style).id);
  }
  normalize(G, g);
  return made.filter((id) => G.edges.has(id));
}

/** Erase where a brush of radius r went along the flat path `path`: edges are cut, their pieces stay. */
export function erase(G, path, r, g) {
  const bb = bbox(path, r + g * 2);
  let changed = false;
  for ( const e of [...G.edges.values()] ) {
    const c = edgeCurve(e, g);
    if ( !overlap(bbox(c.p), bb) ) continue;
    const reach = r + (e.w * g) * 0.25;
    const step = Math.max(g * 0.04, reach * 0.25);
    const d = resample(c.p, step), n = d.length >> 1;
    const gone = new Uint8Array(n);
    let any = false;
    const pss = lengths(path), single = path.length === 2;
    for ( let i = 0; i < n; i++ ) {
      const x = d[i * 2], y = d[i * 2 + 1];
      const dist = single ? Math.hypot(x - path[0], y - path[1]) : nearestOn(path, pss, x, y).d;
      if ( dist <= reach ) { gone[i] = 1; any = true; }
    }
    if ( !any ) continue;
    changed = true;
    G.edges.delete(e.id);
    // runs of kept points become edges; an end that was cut gets a new dead-end node
    let i = 0;
    while ( i < n ) {
      if ( gone[i] ) { i++; continue; }
      let j = i;
      while ( j + 1 < n && !gone[j + 1] ) j++;
      const piece = d.slice(i * 2, j * 2 + 2);
      if ( j > i && lengths(piece).at(-1) >= g * 0.25 ) {
        const a = i === 0 ? e.a : addNode(G, piece[0], piece[1]);
        const b = j === n - 1 ? e.b : addNode(G, piece[piece.length - 2], piece[piece.length - 1]);
        addEdge(G, a, b, controls(piece, g), styleOf(e));
      }
      i = j + 1;
    }
  }
  if ( changed ) normalize(G, g);
  return changed;
}

export function removeEdge(G, id, g) { if ( !G.edges.delete(id) ) return false; normalize(G, g); return true; }

export function restyle(G, id, style, g) {
  const e = G.edges.get(id); if ( !e ) return false;
  Object.assign(e, { k: style.k, w: style.w, l: style.l, o: style.o ? 1 : 0 });
  normalize(G, g);
  return true;
}

/** Turn a one-way road around. */
export function reverseEdge(G, id) {
  const e = G.edges.get(id); if ( !e ) return false;
  const p = [];
  for ( let i = (e.pts.length >> 1) - 1; i >= 0; i-- ) p.push(e.pts[i * 2], e.pts[i * 2 + 1]);
  e.pts = p; [e.a, e.b] = [e.b, e.a];
  return true;
}

const sameStyle = (a, b) => a.k === b.k && Math.abs(a.w - b.w) < 1e-6 && a.l === b.l && a.o === b.o;

/**
 * Tidy up: merge nodes closer than a quarter square, drop slivers and orphans, and join two edges of one style that meet end to
 * end at a node nothing else uses (so an eraser cut that was painted over again heals into one road).
 */
export function normalize(G, g) {
  const mergeR = g * 0.25;
  // merge close nodes
  const ids = [...G.nodes.keys()];
  for ( let i = 0; i < ids.length; i++ ) {
    const A = G.nodes.get(ids[i]); if ( !A ) continue;
    for ( let j = i + 1; j < ids.length; j++ ) {
      const B = G.nodes.get(ids[j]); if ( !B ) continue;
      if ( Math.hypot(A.x - B.x, A.y - B.y) > mergeR ) continue;
      for ( const e of G.edges.values() ) {
        if ( e.a === B.id ) { e.a = A.id; e.pts[0] = A.x; e.pts[1] = A.y; }
        if ( e.b === B.id ) { e.b = A.id; e.pts[e.pts.length - 2] = A.x; e.pts[e.pts.length - 1] = A.y; }
      }
      G.nodes.delete(B.id);
    }
  }
  // slivers: very short edges, or a loop too small to drive
  for ( const e of [...G.edges.values()] ) {
    const L = edgeCurve(e, g).ss.at(-1);
    if ( L < g * 0.2 || (e.a === e.b && L < g * 2) ) G.edges.delete(e.id);
  }
  // join edges through degree-2 nodes when the style matches and the direction of a one-way road agrees
  let again = true;
  while ( again ) {
    again = false;
    for ( const n of G.nodes.values() ) {
      const inc = incident(G, n.id);
      if ( inc.length !== 2 || inc[0] === inc[1] || inc[0].id === inc[1].id ) continue;
      let [e1, e2] = inc;
      if ( e1.a === e1.b || e2.a === e2.b || !sameStyle(e1, e2) ) continue;
      // one-way roads must keep their direction: one has to run into n and the other out of it
      if ( e1.o ) {
        if ( e2.b === n.id && e1.a === n.id ) [e1, e2] = [e2, e1];
        else if ( !(e1.b === n.id && e2.a === n.id) ) continue;
      }
      // orient e1 to end at n, e2 to start at n
      const flip = (e) => { const p = []; for ( let i = (e.pts.length >> 1) - 1; i >= 0; i-- ) p.push(e.pts[i * 2], e.pts[i * 2 + 1]); return { a: e.b, b: e.a, pts: p }; };
      const o1 = e1.b === n.id ? { a: e1.a, b: e1.b, pts: e1.pts } : flip(e1);
      const o2 = e2.a === n.id ? { a: e2.a, b: e2.b, pts: e2.pts } : flip(e2);
      // the joint stays a control point, so the curve still passes through it
      const pts = o1.pts.concat(o2.pts.slice(2));
      G.edges.delete(e1.id); G.edges.delete(e2.id); G.nodes.delete(n.id);
      const id = G.next++;
      G.edges.set(id, { id, a: o1.a, b: o2.b, pts, k: e1.k, w: e1.w, l: e1.l, o: e1.o });
      again = true;
      break;
    }
  }
  // orphans
  const used = new Set();
  for ( const e of G.edges.values() ) { used.add(e.a); used.add(e.b); }
  for ( const id of [...G.nodes.keys()] ) if ( !used.has(id) ) G.nodes.delete(id);
}

/** Bounding box of the whole network, padded by the widest road. */
export function graphBounds(G, g) {
  let bb = null;
  for ( const e of G.edges.values() ) {
    const b = bbox(edgeCurve(e, g).p, (e.w * g) / 2 + g * 0.3);
    bb = bb ? { x0: Math.min(bb.x0, b.x0), y0: Math.min(bb.y0, b.y0), x1: Math.max(bb.x1, b.x1), y1: Math.max(bb.y1, b.y1) } : b;
  }
  return bb;
}

export { bbox, overlap };
