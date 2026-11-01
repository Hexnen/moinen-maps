import { edgeCurve, lengths } from "./graph.mjs";
import { KIND_INFO, BODY_TYPES } from "./model.mjs";

/**
 * Traffic: a deterministic simulation of little cars on the road network.
 *
 * Every client runs the same simulation from the same inputs (the scene's roads and traffic settings, the scene id, and the
 * server clock), so everyone sees the same cars in the same places without a single message or document write. To keep that
 * exact, nothing in here uses anything but + - * / sqrt floor and integer maths (no sin, cos, atan2, hypot, exp or pow: those
 * may round differently between browsers), a seeded integer PRNG, and fixed iteration orders.
 *
 * Time is cut into epochs of EPOCH seconds. An epoch starts from a fresh seeded placement and is stepped at DT; a client that
 * joins halfway through steps from the start of the epoch to "now" (a few thousand cheap steps). At an epoch boundary the old
 * cars fade out while the new ones fade in.
 *
 * Network: every road becomes one lane per direction (offset to the right, or left when the scene drives on the left), trimmed
 * back from the junctions; at every node short Bezier "connectors" join the lanes in to the lanes out (a U-turn only at a dead
 * end). A car follows lanes and connectors; it picks its turn when it enters a lane (straight on is likeliest), slows for
 * curves, keeps its distance to the car ahead, and reserves the connector before it enters a junction: connectors that cross or
 * merge are never used at once, and the car that has waited longest goes first.
 */

export const EPOCH = 1200;      // seconds
export const DT = 0.2;          // seconds per step
const WATCHDOG = 15;            // a car waiting this long at a junction stops being polite (but never drives into a crossing car)
const STALL = 25;               // a car that has not moved for this long squeezes through whatever blocks it (no gridlock forever)

/* ---------------------------------------------------------------- deterministic helpers */

export function hash32(...parts) {
  let h = 0x811c9dc5;
  for ( const p of parts ) {
    const s = String(p);
    for ( let i = 0; i < s.length; i++ ) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= 0x2f; h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 step on a state object { r } (integer only). */
function rnd(o) {
  o.r = (o.r + 0x6D2B79F5) | 0;
  let t = Math.imul(o.r ^ (o.r >>> 15), 1 | o.r);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const sq = (x) => x * x;
const dist = (ax, ay, bx, by) => Math.sqrt(sq(ax - bx) + sq(ay - by));

/* ---------------------------------------------------------------- network */

const LANE = 0, CONN = 1;

function makePiece(type, p, extra) {
  const ss = lengths(p);
  return { type, p: Float64Array.from(p), ss, L: ss[ss.length - 1], ...extra };
}

/** Offset a flat polyline sideways by `off` (positive = right of the direction of travel, y down). */
function offsetLine(c, off) {
  const n = c.length >> 1, out = new Array(n * 2);
  for ( let i = 0; i < n; i++ ) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    let dx = c[i1 * 2] - c[i0 * 2], dy = c[i1 * 2 + 1] - c[i0 * 2 + 1];
    const l = Math.sqrt(dx * dx + dy * dy) || 1; dx /= l; dy /= l;
    out[i * 2] = c[i * 2] - dy * off; out[i * 2 + 1] = c[i * 2 + 1] + dx * off;
  }
  return out;
}

const reversed = (c) => { const n = c.length >> 1, o = new Array(n * 2); for ( let i = 0; i < n; i++ ) { o[i * 2] = c[(n - 1 - i) * 2]; o[i * 2 + 1] = c[(n - 1 - i) * 2 + 1]; } return o; };

/** The part of a polyline between arc lengths a and b (deterministic: only linear interpolation). */
function cut(p, ss, a, b) {
  const n = ss.length, out = [];
  const at = (s) => {
    let lo = 0, hi = n - 1;
    while ( hi - lo > 1 ) { const m = (lo + hi) >> 1; if ( ss[m] <= s ) lo = m; else hi = m; }
    const seg = ss[hi] - ss[lo], f = seg > 0 ? (s - ss[lo]) / seg : 0;
    return [p[lo * 2] + (p[hi * 2] - p[lo * 2]) * f, p[lo * 2 + 1] + (p[hi * 2 + 1] - p[lo * 2 + 1]) * f];
  };
  out.push(...at(a));
  for ( let i = 0; i < n; i++ ) if ( ss[i] > a && ss[i] < b ) out.push(p[i * 2], p[i * 2 + 1]);
  out.push(...at(b));
  return out;
}

/** Unit tangent at the start (end = false) or end of a piece. */
function tangent(p, end) {
  const n = p.length >> 1;
  const i = end ? n - 1 : 0, j = end ? Math.max(0, n - 4) : Math.min(n - 1, 3);
  let dx = end ? p[i * 2] - p[j * 2] : p[j * 2] - p[i * 2], dy = end ? p[i * 2 + 1] - p[j * 2 + 1] : p[j * 2 + 1] - p[i * 2 + 1];
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  return [dx / l, dy / l];
}

/** Speed limits along a piece: curves slow a car down, and the limit falls off early enough to brake for the next curve. */
function speedProfile(piece, vtop, g, brake) {
  const p = piece.p, ss = piece.ss, n = ss.length, v = new Float64Array(n);
  const k = Math.max(1, Math.round((g * 0.3) / Math.max(1e-6, piece.L / Math.max(1, n - 1))));
  for ( let i = 0; i < n; i++ ) {
    const a = Math.max(0, i - k), b = Math.min(n - 1, i + k);
    let lim = vtop;
    if ( b - a >= 2 && a !== i && b !== i ) {
      const ax = p[a * 2], ay = p[a * 2 + 1], bx = p[i * 2], by = p[i * 2 + 1], cx = p[b * 2], cy = p[b * 2 + 1];
      const cross = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
      if ( cross > 1e-9 ) {
        const R = (dist(ax, ay, bx, by) * dist(bx, by, cx, cy) * dist(ax, ay, cx, cy)) / (2 * cross);
        lim = Math.min(vtop, vtop * Math.sqrt(R / (1.6 * g)));
      }
    }
    v[i] = Math.max(vtop * 0.22, lim);
  }
  for ( let i = n - 2; i >= 0; i-- ) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * brake * (ss[i + 1] - ss[i])));
  piece.v = v;
}

/** Distance from a point to the start (first `upTo` px) of a polyline: sqrt only. */
function distToPrefix(x, y, p, upTo) {
  let best = Infinity, acc = 0;
  const n = p.length >> 1;
  for ( let i = 0; i < n - 1 && acc <= upTo; i++ ) {
    const ax = p[i * 2], ay = p[i * 2 + 1], vx = p[i * 2 + 2] - ax, vy = p[i * 2 + 3] - ay, L2 = vx * vx + vy * vy;
    let t = L2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = sq(x - ax - vx * t) + sq(y - ay - vy * t);
    if ( d < best ) best = d;
    acc += Math.sqrt(L2);
  }
  return Math.sqrt(best);
}

/**
 * How far back from each junction a road's lanes stop: until the road is clear of every other road meeting there (an acute
 * crossing needs much more room than a square one). Map `${edgeId}:a|b` -> distance along the centre line.
 */
function junctionTrims(edges, nodes, g) {
  const out = new Map();
  const arms = new Map();
  for ( const e of edges ) {
    const c = edgeCurve(e, g).p;
    for ( const end of ["a", "b"] ) {
      const n = nodes.get(e[end]);
      if ( !n || n.deg < 3 ) continue;
      let l = arms.get(n.id); if ( !l ) arms.set(n.id, l = []);
      l.push({ e, end, p: end === "a" ? c : reversed(c) });
    }
  }
  for ( const [id, list] of arms ) {
    const n = nodes.get(id);
    for ( const arm of list ) {
      const p = arm.p, ss = lengths(p), L = ss[ss.length - 1];
      // roads meeting at a very shallow angle run side by side for a long way; the junction box stays compact anyway
      const cap = Math.min(L * 0.45, Math.max(n.trim, g * 1.6));
      let trim = Math.min(n.trim, cap);
      for ( let i = 0; i < ss.length && ss[i] <= cap; i++ ) {
        if ( ss[i] < n.trim ) continue;
        // both lanes' points here must be clear of the other roads' bodies (plus half a car)
        const j = Math.min(ss.length - 1, i + 1), k = Math.max(0, i - 1);
        let tx = p[j * 2] - p[k * 2], ty = p[j * 2 + 1] - p[k * 2 + 1];
        const tl = Math.sqrt(tx * tx + ty * ty) || 1; tx /= tl; ty /= tl;
        const off = (arm.e.w * g) / 4;
        const pts = [p[i * 2] - ty * off, p[i * 2 + 1] + tx * off, p[i * 2] + ty * off, p[i * 2 + 1] - tx * off];
        let clear = true;
        for ( const o of list ) {
          if ( o === arm ) continue;
          const need = (o.e.w * g) / 2 + g * 0.18;
          const reach = ss[i] + need * 3;
          if ( distToPrefix(pts[0], pts[1], o.p, reach) < need || distToPrefix(pts[2], pts[3], o.p, reach) < need ) { clear = false; break; }
        }
        trim = ss[i];
        if ( clear ) break;
      }
      out.set(`${arm.e.id}:${arm.end}`, trim);
    }
  }
  return out;
}

/**
 * Build the drivable network of a roads set.
 * `rect` is the scene rectangle (dead ends near its border are "portals": cars drive off the map there and come back in later).
 */
export function buildNetwork(R, g, rect) {
  const G = R.G, T = R.traffic, side = T.side === "left" ? -1 : 1;
  const v0 = T.speed * g * 1.4;
  const brake = g * 1.3;
  const pieces = [];
  const nodes = new Map();          // node id -> { id, x, y, deg, in: [lane], out: [lane], conns: [], portal }
  const edges = [...G.edges.values()].filter((e) => KIND_INFO[e.k]?.cars);
  for ( const e of edges ) for ( const id of [e.a, e.b] ) {
    if ( !nodes.has(id) ) { const n = G.nodes.get(id); nodes.set(id, { id, x: n.x, y: n.y, deg: 0, maxW: 0, in: [], out: [], conns: [], portal: false }); }
  }
  for ( const e of edges ) {
    const A = nodes.get(e.a), B = nodes.get(e.b);
    A.deg++; B.deg++;
    A.maxW = Math.max(A.maxW, e.w); B.maxW = Math.max(B.maxW, e.w);
  }
  for ( const n of nodes.values() ) {
    n.trim = n.deg >= 3 ? (n.maxW * g) / 2 + g * 0.06 : n.deg === 2 ? n.maxW * g * 0.3 : n.maxW * g * 0.42;
    const m = g * 0.6;
    n.portal = n.deg === 1 && !!rect && (n.x <= rect.x + m || n.y <= rect.y + m || n.x >= rect.x + rect.width - m || n.y >= rect.y + rect.height - m);
  }
  const trims = junctionTrims(edges, nodes, g);
  let totalLen = 0;
  for ( const e of edges ) {
    const c = edgeCurve(e, g).p, A = nodes.get(e.a), B = nodes.get(e.b);
    const off = (e.w * g) / 4;
    const kv = v0 * KIND_INFO[e.k].speed;
    const dirs = e.o ? [1] : [1, -1];
    for ( const dir of dirs ) {
      const base = dir === 1 ? c : reversed(c);
      const line = e.o ? base.slice() : offsetLine(base, off * side);
      const ss = lengths(line), L = ss[ss.length - 1];
      const from = dir === 1 ? A : B, to = dir === 1 ? B : A;
      // portals are not trimmed at all: the car drives right off the edge of the map
      const ta = trims.get(`${e.id}:a`) ?? A.trim, tb = trims.get(`${e.id}:b`) ?? B.trim;
      let t0 = from.portal ? 0 : (dir === 1 ? ta : tb), t1 = to.portal ? 0 : (dir === 1 ? tb : ta);
      if ( L - t0 - t1 < g * 0.25 ) { const f = Math.max(0, (L - g * 0.25) / Math.max(1e-6, t0 + t1)); t0 *= f; t1 *= f; }
      const lane = makePiece(LANE, cut(line, ss, t0, L - t1), { edge: e.id, dir, from: from.id, to: to.id, kind: e.k, vtop: kv, next: [], w: e.w });
      speedProfile(lane, kv, g, brake);
      lane.id = pieces.length; pieces.push(lane);
      from.out.push(lane); to.in.push(lane);
      totalLen += lane.L;
    }
  }
  // connectors
  for ( const n of nodes.values() ) {
    for ( const I of n.in ) {
      if ( n.portal ) { I.exit = true; continue; }
      for ( const O of n.out ) {
        const uturn = O.edge === I.edge && O.dir !== I.dir;
        if ( uturn && n.deg > 1 ) continue;
        const [t0x, t0y] = tangent(I.p, true), [t3x, t3y] = tangent(O.p, false);
        const x0 = I.p[I.p.length - 2], y0 = I.p[I.p.length - 1], x3 = O.p[0], y3 = O.p[1];
        const d = dist(x0, y0, x3, y3);
        const h = uturn ? I.w * g * 0.7 : d * 0.42;
        const x1 = x0 + t0x * h, y1 = y0 + t0y * h, x2 = x3 - t3x * h, y2 = y3 - t3y * h;
        const pts = [];
        const N = 12;
        for ( let i = 0; i <= N; i++ ) {
          const t = i / N, u = 1 - t, a = u * u * u, b = 3 * u * u * t, cc = 3 * u * t * t, dd = t * t * t;
          pts.push(a * x0 + b * x1 + cc * x2 + dd * x3, a * y0 + b * y1 + cc * y2 + dd * y3);
        }
        const dot = t0x * t3x + t0y * t3y;
        const C = makePiece(CONN, pts, { node: n.id, from: I.id, out: O.id, dot, uturn, vtop: Math.min(I.vtop, O.vtop), turn: t0x * t3y - t0y * t3x });
        speedProfile(C, C.vtop, g, brake);
        C.id = pieces.length; pieces.push(C);
        I.next.push(C.id); n.conns.push(C);
      }
      if ( !I.next.length ) I.exit = true;   // a one-way road into a dead end: cars leave the map there
    }
    // which connectors may not be used at the same time: they cross or come close, or they merge into one lane
    for ( const C of n.conns ) C.conflicts = [];
    const carW = g * 0.3;
    for ( let i = 0; i < n.conns.length; i++ ) for ( let j = i + 1; j < n.conns.length; j++ ) {
      const A = n.conns[i], B = n.conns[j];
      if ( A.from === B.from ) continue;           // one queue: the following distance handles it
      let clash = A.out === B.out;
      if ( !clash ) {
        const pa = A.p, pb = B.p;
        outer: for ( let a = 1; a < (pa.length >> 1) - 1; a++ ) for ( let b = 1; b < (pb.length >> 1) - 1; b++ ) {
          if ( sq(pa[a * 2] - pb[b * 2]) + sq(pa[a * 2 + 1] - pb[b * 2 + 1]) < carW * carW ) { clash = true; break outer; }
        }
      }
      if ( clash ) { A.conflicts.push(B.id); B.conflicts.push(A.id); }
    }
  }
  const lanes = pieces.filter((p) => p.type === LANE);
  const entries = lanes.filter((l) => nodes.get(l.from)?.portal);
  return { pieces, lanes, entries, nodes, totalLen, v0, brake, g };
}

/* ---------------------------------------------------------------- the simulation */

const WEIGHTS = { compact: 3, sedan: 4, van: 2, pickup: 2, truck: 1, bus: 0.6, taxi: 1 };
export const BODY = {
  compact: { len: 0.8, wid: 0.44 }, sedan: { len: 1, wid: 0.46 }, van: { len: 1.1, wid: 0.5 }, pickup: { len: 1.1, wid: 0.48 },
  truck: { len: 1.5, wid: 0.54 }, bus: { len: 2.1, wid: 0.56 }, taxi: { len: 1, wid: 0.46 }
};
export const PALETTE_SIZE = 9;

export class TrafficSim {
  /**
   * @param net     the network (buildNetwork)
   * @param T       traffic settings
   * @param key     anything that identifies the scene (mixed into the seed)
   * @param epoch   the epoch index (whole EPOCHs since 1970 on the server clock)
   */
  constructor(net, T, key, epoch) {
    this.net = net; this.T = T; this.epoch = epoch;
    this.g = net.g;
    this.step = 0;
    this.r = { r: hash32(key, T.seed, epoch) | 0 };
    const kinds = T.kinds.length ? T.kinds : ["sedan"];
    this.kinds = kinds; this.kindW = kinds.map((k) => WEIGHTS[k] ?? 1);
    this.kindSum = this.kindW.reduce((a, b) => a + b, 0);
    const want = Math.round((T.density * net.totalLen) / (this.g * 7));
    this.count = net.lanes.length ? Math.min(T.max, want) : 0;
    this.cars = [];
    for ( let i = 0; i < this.count; i++ ) {
      const c = { id: i, piece: -1, s: 0, v: 0, next: -1, res: -1, wait: 0, age: 0, hidden: 0, stall: 0, ghost: 0, r: { r: hash32(key, T.seed, epoch, "car", i) | 0 },
        type: "sedan", color: 0, len: 0, wid: 0, f: 1, pp: -1, ps: 0, brk: false, jump: true };
      this.cars.push(c);
      this.#dress(c);
      this.#place(c, false);
    }
  }

  #dress(c) {
    let x = rnd(c.r) * this.kindSum, k = 0;
    while ( k < this.kinds.length - 1 && x >= this.kindW[k] ) { x -= this.kindW[k]; k++; }
    c.type = this.kinds[k];
    c.color = Math.floor(rnd(c.r) * PALETTE_SIZE);
    const B = BODY[c.type] ?? BODY.sedan, size = this.T.size * this.g;
    c.len = size * B.len; c.wid = size * B.wid;
    c.f = 0.86 + rnd(c.r) * 0.24;
  }

  /** Is there room for a car of length len at (piece, s)? Checked against every car, by distance on the map. */
  #free(piece, s, len) {
    const [x, y] = posOn(this.net.pieces[piece], s);
    for ( const o of this.cars ) {
      if ( o.piece < 0 || o.hidden > 0 ) continue;
      const [ox, oy] = posOn(this.net.pieces[o.piece], o.s);
      const need = (len + o.len) * 0.5 + this.g * 0.25;
      if ( sq(x - ox) + sq(y - oy) < need * need ) return false;
    }
    return true;
  }

  /** Put a car somewhere free: at a map-edge entry (preferEdge) or anywhere on a lane. */
  #place(c, preferEdge) {
    const net = this.net;
    c.piece = -1;
    if ( !net.lanes.length ) return false;
    if ( preferEdge && net.entries.length ) {
      for ( let tries = 0; tries < 3; tries++ ) {
        const L = net.entries[Math.floor(rnd(this.r) * net.entries.length)];
        if ( L.L > c.len && this.#free(L.id, c.len * 0.5, c.len * 1.6) ) return this.#enter(c, L.id, c.len * 0.5);
      }
    }
    for ( let tries = 0; tries < 12; tries++ ) {
      let x = rnd(this.r) * net.totalLen, L = net.lanes[0];
      for ( const l of net.lanes ) { if ( x < l.L ) { L = l; break; } x -= l.L; }
      if ( L.L < c.len * 2 ) continue;
      const s = c.len + rnd(this.r) * (L.L - c.len * 2);
      if ( this.#free(L.id, s, c.len * 1.6) ) return this.#enter(c, L.id, s);
    }
    return false;
  }

  #enter(c, lane, s) {
    c.piece = lane; c.s = s; c.v = 0; c.res = -1; c.wait = 0; c.age = 0; c.hidden = 0; c.stall = 0; c.ghost = 0; c.jump = true;
    this.#chooseNext(c);
    return true;
  }

  /** Pick the connector at the end of the car's lane: straight on is likeliest, a sharp turn least likely. */
  #chooseNext(c) {
    const lane = this.net.pieces[c.piece];
    c.next = -1;
    if ( !lane.next.length ) return;
    let sum = 0;
    const w = lane.next.map((id) => { const C = this.net.pieces[id]; const x = 0.25 + sq(C.dot + 1); sum += x; return x; });
    let x = rnd(c.r) * sum, k = 0;
    while ( k < w.length - 1 && x >= w[k] ) { x -= w[k]; k++; }
    c.next = lane.next[k];
  }

  /** Can car c go into connector C now? */
  /** Don't block the box: is there room for the whole car on the road out of connector C? */
  #room(c, C, byPiece) {
    const O = this.net.pieces[C.out];
    let room = O.L, queued = 0;
    const onOut = byPiece.get(O.id);
    if ( onOut ) for ( const o of onOut ) room = Math.min(room, o.s - o.len * 0.5);
    const onC = byPiece.get(C.id);
    if ( onC ) for ( const o of onC ) queued += o.len + this.g * 0.14;
    for ( const o of this.cars ) if ( o !== c && o.res === C.id && o.piece !== C.id ) queued += o.len + this.g * 0.14;
    const need = Math.min(c.len + this.g * 0.14, O.L * 0.8);
    return room - queued >= need || (!onOut?.length && queued === 0);
  }

  #mayEnter(c, C, byNode, byPiece) {
    // a car stuck for long stops being polite (room on the way out, who waited longer), but never drives into a crossing car
    const stuck = c.wait > WATCHDOG;
    if ( !stuck && !this.#room(c, C, byPiece) ) return false;
    const list = byNode.get(C.node);
    if ( !list ) return true;
    for ( const o of list ) {
      if ( o === c ) continue;
      const oc = o.piece >= 0 && this.net.pieces[o.piece].type === CONN ? o.piece : o.res;
      const want = oc >= 0 ? oc : o.next;
      if ( want < 0 || want === C.id ) continue;
      if ( !C.conflicts.includes(want) ) continue;
      if ( oc >= 0 ) return false;                                         // in the junction, or has it reserved
      // waiting at a conflicting stop line for longer (ties: the lower id)
      // (only to one that could go: a car whose way out is full must not hold the junction up)
      if ( !stuck && o.wait > 0.4 && (o.wait > c.wait || (o.wait === c.wait && o.id < c.id)) && this.#room(o, this.net.pieces[want], byPiece) ) return false;
    }
    return true;
  }

  /** Distance to the car ahead along the way this car will go (from its front to the other's rear), and that car's speed. */
  #leader(c, byPiece) {
    const net = this.net;
    let piece = net.pieces[c.piece], acc = -c.s, first = true, hops = 0;
    const reach = c.v * c.v / (2 * net.brake) + c.len * 3 + this.g;
    while ( piece && hops < 3 ) {
      // on a connector, a car ahead on a sibling connector (out of the same lane) is still in front while the two run together
      const lists = [byPiece.get(piece.id)];
      if ( piece.type === CONN ) for ( const sib of net.pieces[piece.from].next ) if ( sib !== piece.id ) lists.push(byPiece.get(sib));
      let best = null;
      for ( const list of lists ) {
        if ( !list ) continue;
        for ( const o of list ) {
          if ( o === c ) continue;
          if ( first && (o.s < c.s || (o.s === c.s && o.id < c.id)) ) continue;
          if ( !best || o.s < best.s ) best = o;
        }
      }
      if ( best ) return { gap: acc + best.s - (c.len + best.len) * 0.5, v: best.v };
      acc += piece.L;
      if ( acc > reach ) break;
      const nextId = piece.type === LANE ? (c.res >= 0 ? c.res : c.next) : piece.out;
      if ( piece.type === LANE ) {
        // a car that just turned off the same lane the other way is still in front of us for a moment
        let best = null;
        for ( const sib of piece.next ) {
          if ( sib === nextId ) continue;
          const list = byPiece.get(sib);
          if ( list ) for ( const o of list ) if ( o.s < o.len + this.g * 0.6 && (!best || o.s < best.s) ) best = o;
        }
        if ( best ) {
          const gap = acc + best.s - (c.len + best.len) * 0.5;
          const own = nextId >= 0 ? byPiece.get(nextId) : null;
          let ownBest = null;
          if ( own ) for ( const o of own ) if ( !ownBest || o.s < ownBest.s ) ownBest = o;
          if ( !ownBest || ownBest.s > best.s ) return { gap, v: best.v };
        }
      }
      piece = nextId >= 0 ? net.pieces[nextId] : null;
      first = false; hops++;
    }
    return null;
  }

  /** One step of DT seconds. */
  advance() {
    const net = this.net, P = net.pieces, g = this.g, dt = DT;
    const accel = g * 0.9, hard = g * 4.5, gapMin = g * 0.14;
    this.step++;
    // who is where
    const byPiece = new Map(), byNode = new Map();
    for ( const c of this.cars ) {
      c.pp = c.piece; c.ps = c.s; c.jump = false;
      if ( c.piece < 0 || c.hidden > 0 ) continue;
      let l = byPiece.get(c.piece); if ( !l ) byPiece.set(c.piece, l = []); l.push(c);
      const p = P[c.piece];
      const node = p.type === CONN ? p.node : (c.next >= 0 ? P[c.next].node : null);
      if ( node != null ) { let m = byNode.get(node); if ( !m ) byNode.set(node, m = []); m.push(c); }
    }
    for ( const c of this.cars ) {
      // off the map, waiting to come back
      if ( c.piece < 0 || c.hidden > 0 ) {
        c.hidden -= dt;
        if ( c.hidden <= 0 ) { this.#dress(c); if ( !this.#place(c, true) ) c.hidden = 1; }
        continue;
      }
      c.age += dt;
      const p = P[c.piece];
      const vdes = p.vtop * c.f;
      const vHere = sampleV(p, c.s) * c.f;
      let target = Math.min(vdes, vHere);
      const toEnd = p.L - c.s;
      if ( p.type === LANE ) {
        if ( p.exit ) { /* drives off the map: no stop */ }
        else if ( c.next >= 0 ) {
          const C = P[c.next];
          if ( c.res < 0 ) {
            const stopDist = (c.v * c.v) / (2 * net.brake) + g * 0.4;
            if ( toEnd <= stopDist ) {
              if ( c.ghost > 0 || this.#mayEnter(c, C, byNode, byPiece) ) c.res = C.id;
            }
          }
          const vEnd = c.res >= 0 ? C.v[0] * c.f : 0;
          target = Math.min(target, Math.sqrt(vEnd * vEnd + 2 * net.brake * Math.max(0, toEnd - g * 0.04)));
        } else target = Math.min(target, Math.sqrt(2 * net.brake * Math.max(0, toEnd - g * 0.04)));
      }
      // gridlock breaker: a car that has not moved for STALL seconds squeezes through for a few seconds, ignoring the others
      const lead = c.ghost > 0 ? null : this.#leader(c, byPiece);
      let room = Infinity;
      if ( lead ) {
        const gap = lead.gap - gapMin;
        room = Math.max(0, gap + gapMin * 0.5);
        target = Math.min(target, gap > 0 ? Math.sqrt(lead.v * lead.v + 2 * net.brake * gap) : 0);
      }
      const dv = target - c.v;
      const nv = dv > 0 ? c.v + Math.min(dv, accel * dt) : c.v + Math.max(dv, -hard * dt);
      c.brk = dv < -accel * dt * 0.5 || nv < c.v - g * 0.02;
      c.v = Math.max(0, nv);
      let move = Math.min(c.v * dt, room);
      if ( move < c.v * dt ) c.v = move / dt;
      c.s += move;
      // over the end of the piece
      let guard = 0;
      while ( c.s > P[c.piece].L && guard++ < 4 ) {
        const cur = P[c.piece];
        if ( cur.type === LANE ) {
          if ( cur.exit ) { c.piece = -1; c.hidden = 1 + rnd(c.r) * 5; break; }
          // on the connector the turn is made: the next one is chosen when the car reaches its new lane
          if ( c.res >= 0 ) { c.s -= cur.L; c.piece = c.res; c.res = -1; c.next = -1; c.wait = 0; }
          else { c.s = cur.L; c.v = 0; break; }
        } else {
          c.s -= cur.L; c.piece = cur.out; c.res = -1;
          this.#chooseNext(c);
        }
      }
      if ( c.ghost > 0 ) c.ghost -= dt;
      if ( c.piece >= 0 && c.v < g * 0.05 ) { c.stall += dt; if ( c.stall > STALL ) { c.ghost = 4; c.stall = 0; } } else c.stall = 0;
      if ( c.piece >= 0 && P[c.piece].type === LANE && c.v < g * 0.05 && P[c.piece].L - c.s < g * 0.5 && c.next >= 0 && c.res < 0 ) c.wait += dt;
      else if ( c.piece >= 0 && P[c.piece].type === LANE && c.res >= 0 ) c.wait = 0;
    }
  }
}

/** Speed limit at arc length s of a piece. */
function sampleV(p, s) {
  const ss = p.ss, n = ss.length;
  if ( s <= 0 ) return p.v[0];
  if ( s >= p.L ) return p.v[n - 1];
  let lo = 0, hi = n - 1;
  while ( hi - lo > 1 ) { const m = (lo + hi) >> 1; if ( ss[m] <= s ) lo = m; else hi = m; }
  return Math.min(p.v[lo], p.v[hi]);
}

/** Point at arc length s of a piece (clamped). */
export function posOn(p, s) {
  const ss = p.ss, n = ss.length, q = p.p;
  if ( s <= 0 ) return [q[0], q[1]];
  if ( s >= p.L ) return [q[n * 2 - 2], q[n * 2 - 1]];
  let lo = 0, hi = n - 1;
  while ( hi - lo > 1 ) { const m = (lo + hi) >> 1; if ( ss[m] <= s ) lo = m; else hi = m; }
  const seg = ss[hi] - ss[lo], f = seg > 0 ? (s - ss[lo]) / seg : 0;
  return [q[lo * 2] + (q[hi * 2] - q[lo * 2]) * f, q[lo * 2 + 1] + (q[hi * 2 + 1] - q[lo * 2 + 1]) * f];
}

/**
 * Where a car is drawn between two steps (alpha 0..1 of the way from the previous step to the current one): a point, the
 * heading (display only, so atan2 is fine here) and how visible it is.
 */
export function carPose(sim, c, alpha) {
  const P = sim.net.pieces;
  if ( c.piece < 0 || c.hidden > 0 ) return null;
  let piece = P[c.piece], s = c.s;
  if ( !c.jump && c.pp >= 0 && alpha < 1 ) {
    if ( c.pp === c.piece ) s = c.ps + (c.s - c.ps) * alpha;
    else {
      const prev = P[c.pp];
      const linked = prev.type === LANE ? prev.next.includes(c.piece) : prev.out === c.piece;
      if ( linked ) {
        const total = (prev.L - c.ps) + c.s, d = total * alpha;
        if ( d < prev.L - c.ps ) { piece = prev; s = c.ps + d; } else s = d - (prev.L - c.ps);
      }
    }
  }
  const [x, y] = posOn(piece, s);
  const h = c.len * 0.35;
  const [fx, fy] = along(sim, piece, s + h, c), [bx, by] = along(sim, piece, s - h, c);
  const heading = Math.atan2(fy - by, fx - bx);
  // fade in when it appears, fade out when it drives off the map or into a one-way dead end
  let a = Math.min(1, (c.age + alpha * DT) / 0.8);
  if ( piece.type === LANE && piece.exit ) a = Math.min(a, Math.max(0, (piece.L - s) / (c.len * 1.5)));
  return { x, y, heading, alpha: a, piece, s };
}

/** A point at arc length s, carried over into the piece before or after when s runs off this one. */
function along(sim, piece, s, c) {
  const P = sim.net.pieces;
  if ( s > piece.L ) {
    const nextId = piece.type === LANE ? (c.res >= 0 ? c.res : c.next) : piece.out;
    if ( nextId >= 0 ) return posOn(P[nextId], s - piece.L);
  } else if ( s < 0 ) {
    const prevId = piece.type === CONN ? piece.from : (c.pp >= 0 && c.pp !== piece.id ? c.pp : -1);
    if ( prevId >= 0 ) { const pr = P[prevId]; return posOn(pr, pr.L + s); }
  }
  return posOn(piece, s);
}

/** Bring a simulation to `step`, spending at most `budgetMs`; true when it got there. */
export function catchUp(sim, step, budgetMs) {
  if ( sim.step >= step ) return true;
  const t0 = performance.now();
  while ( sim.step < step ) {
    sim.advance();
    if ( (sim.step & 15) === 0 && performance.now() - t0 > budgetMs ) return sim.step >= step;
  }
  return true;
}

/** A fingerprint of the state (to compare clients). */
export function fingerprint(sim) {
  let h = 0x811c9dc5;
  for ( const c of sim.cars ) {
    for ( const v of [c.piece, Math.round(c.s * 1000), Math.round(c.v * 1000)] ) { h ^= v & 0xffff; h = Math.imul(h, 0x01000193); h ^= v >>> 16; h = Math.imul(h, 0x01000193); }
  }
  return (h >>> 0).toString(16);
}

export { BODY_TYPES };
