/**
 * Cosmetic token animations, in the same motion language as the pins. Nothing here touches a TokenDocument or any other document.
 *
 *  - drop   a token placed on the map falls, squashes, bounces (createToken)
 *  - hop    a token being moved hops (optional)
 *  - pop    a token that becomes visible (`hidden` -> false) pops in with a spring overshoot
 *  - ghost  a token that becomes hidden (`hidden` -> true) leaves a ghost copy that squashes and puffs away; players could not
 *           otherwise see the token leave, because Foundry stops drawing it at once. Only vision-based changes are ignored.
 *  - lock   the punchy squeeze and recoil of a token that has just been targeted, plus a hand-inked reticle that idles while targeted
 *  - enter  a combatant hops with a shockwave ring (and an initiative number) when it joins a combat or the combat starts
 *
 * Only visuals move: the token's mesh (and with it the dynamic ring) is offset, scaled about the bottom-centre of the token's footprint
 * and tilted, and the token container is lifted so bars, nameplate and effects follow. Foundry resets those transforms whenever it
 * refreshes a token, so the pose is re-captured and re-applied inside the `refreshToken` hook in the same frame, and restored at the end by
 * raising Foundry's own refresh flags. Hooks only (no method wrappers), so it cannot conflict with modules that wrap Token.
 */
import { sceneConfig, reducedMotion } from "./config.mjs";
import { shadowTextures } from "./pin-art.mjs";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const SPRING = { K: 700, C: 22 };   // squash spring: ~23% overshoot, settles in ~0.5 s (same as the pins)
const ROT = { K: 480, C: 13 };      // wobble spring after impact
const MAX_BURST = 25;               // more tokens than this at once: no animation at all
const STAGGER = 0.075, MAX_DELAY = 0.75;
const INK = 0x15110F, CREAM = 0xFFF3E2;
const TAU = Math.PI * 2;

const ACTIVE = new Set();           // running mesh effects (Drop)
const BY_TOKEN = new Map();         // Token placeable -> Drop
const GHOSTS = new Set();
const POPUPS = new Set();
const RETICLES = new Map();         // `${tokenId}|${userId}` -> Reticle
let ticking = false;
const bursts = {};                  // per kind: { t, n }

function tick(frames) {
  const dt = Math.min(frames / 60, 0.05);
  for ( const d of ACTIVE ) d.update(dt);
  for ( const g of GHOSTS ) g.update(dt);
  for ( const p of POPUPS ) p.update(dt);
  for ( const r of RETICLES.values() ) r.update(dt);
  if ( !ACTIVE.size && !GHOSTS.size && !POPUPS.size && !RETICLES.size ) stopTicker();
}
function startTicker() { if ( !ticking && canvas.app?.ticker ) { canvas.app.ticker.add(tick); ticking = true; } }
function stopTicker() { if ( ticking ) { canvas.app?.ticker?.remove(tick); ticking = false; } }

/** Stagger index of the next item in a burst of the same kind: `null` = too many at once, skip them all. */
function nextBurstIndex(kind) {
  const now = performance.now(), b = bursts[kind] ??= { t: 0, n: 0 };
  if ( now - b.t > 300 ) b.n = 0;
  b.t = now;
  const i = b.n++;
  return i >= MAX_BURST ? null : i;
}

/** Offset, scale and tilt a display object about the ground point (gx, gy), from the base transform `b` Foundry gave it. */
function place(obj, b, p, gx, gy) {
  const rotated = Math.abs(b.rot) > 0.001;       // a rotated mesh squashes along its own axes, so keep it uniform there
  const u = Math.sqrt(p.sx * p.sy), sx = rotated ? u : p.sx, sy = rotated ? u : p.sy;
  const rx = (b.px - gx) * sx, ry = (b.py - gy) * sy, c = Math.cos(p.rot), s = Math.sin(p.rot);
  obj.position.set(gx + rx * c - ry * s, gy + rx * s + ry * c + p.y);
  obj.scale.set(b.sx * sx, b.sy * sy);
  obj.rotation = b.rot + p.rot;
}

/** Put an effect object in the primary group right next to a token's mesh in the sort order (`step` -1 = under it, +1 = over it). */
function sortNextTo(obj, token, step) {
  const m = token.mesh;
  Object.assign(obj, { elevation: m.elevation ?? token.document.elevation ?? 0, sortLayer: m.sortLayer ?? 700, sort: (m.sort ?? 0) + step, _lastSortedIndex: 0 });
  canvas.primary.addChild(obj);
}

/* ================================================================== mesh effects: drop, hop, pop, lock, enter */

class Drop {
  constructor(token, kind, cfg, delay = 0, ready = false, extra = {}) {
    this.token = token; this.kind = kind; this.cfg = cfg; this.delay = delay;
    this.k = clamp(Number(cfg.intensity ?? 1) || 1, 0.2, 2);
    this.ready = ready; this.age = 0;      // not ready until Foundry has done its first refresh of the token (its mesh holds no real values before that)
    this.number = extra.number ?? null;
    const { width, height } = token.document.getSize();
    this.W = width; this.H = height;
    this.S = height;                         // the unit of the motion: the token's footprint height
    this.tilt = Math.random() < 0.5 ? -1 : 1;
    this.base = null;                        // the mesh/container values Foundry last set (captured, never written back by us)
    this.dirty = true;
    this.pose = { y: 0, sx: 1, sy: 1, rot: 0, alpha: kind === "drop" || kind === "pop" ? 0 : 1 };
    this.dead = false;
    this.t = 0;
    this.ripple = { t: 0, on: false };
    this.rippleWanted = kind === "drop" ? !!cfg.ripple : kind === "enter" ? !!cfg.combatRipple : false;
    this.popped = false;
    const S = this.S, g = S * 36;
    if ( kind === "drop" ) {
      const h = S * 1.5 * cfg.dropHeight;
      this.a = { kind, y: -h, vy: 0, h0: h, q: 0, qv: 0, r: 0, rv: 0, t: 0, landed: false, e: 0.1 + 0.34 * cfg.bounce, hits: 0 };
      this.pose.y = -h;
    } else if ( kind === "hop" || kind === "enter" ) {
      const h = S * (kind === "enter" ? 0.5 * this.k : 0.3);
      this.a = { kind, y: 0, vy: -Math.sqrt(2 * g * h), h0: h, q: -(kind === "enter" ? 0.3 * this.k : 0.2) * cfg.squeeze, qv: 0, r: 0, rv: 0, t: 0, landed: false, e: 0, hits: 0 };
    } else this.a = { kind, y: 0, h0: 0, t: 0 };   // pop and lock are analytic (see poseAnalytic)
    this.#makeShadow();
    ACTIVE.add(this); BY_TOKEN.set(token, this);
    startTicker();
  }

  #makeShadow() {
    const st = shadowTextures();
    const sh = this.shadow = new PIXI.Container();
    this.pen = sh.addChild(new PIXI.Sprite(st.pen)); this.core = sh.addChild(new PIXI.Sprite(st.core));
    for ( const s of [this.pen, this.core] ) { s.anchor.set(0.5); s.blendMode = PIXI.BLEND_MODES.MULTIPLY; }
    const W = this.W;
    this.pen.width = W * 0.86; this.pen.height = W * 0.27; this.core.width = W * 0.42; this.core.height = W * 0.13;
    this.p0 = [this.pen.scale.x, this.pen.scale.y]; this.c0 = [this.core.scale.x, this.core.scale.y];
    this.rip = sh.addChild(new PIXI.Graphics());
    const big = this.kind === "enter";   // a combat entry sends out a wider, heavier shockwave
    this.rip.lineStyle(Math.max(1.5, W * (big ? 0.045 : 0.025)), 0xFFFFFF, 0.9).drawEllipse(0, 0, W * 0.42, W * 0.14);
    this.ripMax = big ? 1.6 + 0.9 * this.k : 1.1;
    this.rip.visible = false;
    sh.visible = false;
    sortNextTo(sh, this.token, -1);          // under its token: same elevation and layer, one step lower
  }

  /** Foundry just refreshed the token (the mesh holds its own values again): capture them and re-apply the pose in the same frame. */
  refreshed() { this.ready = true; this.dirty = true; this.capture(); this.apply(); }

  capture() {
    const t = this.token, m = t.mesh;
    if ( !m || m.destroyed || !this.dirty || !this.ready ) return;
    this.dirty = false;
    this.base = { px: m.position.x, py: m.position.y, sx: m.scale.x, sy: m.scale.y, rot: m.rotation, alpha: m.alpha, cy: t.position.y };
  }

  /** Physics of a drop / hop / enter (identical to the pins). Returns true when settled. */
  step(dt) {
    const a = this.a, cfg = this.cfg, S = this.S, g = S * 36;
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for ( let i = 0; i < n; i++ ) {
      a.t += h;
      if ( !a.landed || a.y < 0 ) {
        a.vy += g * h; a.y += a.vy * h;
        if ( a.y >= 0 && a.vy > 0 ) {
          const v = a.vy, imp = clamp(v / (S * 10), 0, 1.4);
          a.y = 0; a.q = Math.min(a.q, -0.5 * imp * cfg.squeeze * (a.kind === "enter" ? this.k : 1)); a.qv = 0;
          if ( a.hits === 0 && (a.kind === "drop" || a.kind === "enter") ) { a.rv = this.tilt * 3.2 * clamp(imp, 0.3, 1); if ( this.rippleWanted ) { this.ripple.t = 0; this.ripple.on = true; } }
          a.hits++;
          const nv = v * a.e;
          if ( a.e > 0 && nv > S * 1.6 && a.hits < 4 ) a.vy = -nv; else { a.vy = 0; a.landed = true; }
        }
      }
      a.qv += (-SPRING.K * a.q - SPRING.C * a.qv) * h; a.q += a.qv * h;
      a.rv += (-ROT.K * a.r - ROT.C * a.rv) * h; a.r += a.rv * h;
    }
    return a.landed && a.y === 0 && Math.abs(a.q) < 0.004 && Math.abs(a.qv) < 0.08 && Math.abs(a.r) < 0.004 && Math.abs(a.rv) < 0.08;
  }

  poseFrom(a) {
    const S = this.S, p = this.pose;
    const air = a.y < -0.5 ? clamp(Math.abs(a.vy) / (S * 10), 0, 1) : 0;
    let sy = 1 + a.q + 0.16 * air * (0.4 + this.cfg.bounce * 0.6), sx = 1 / Math.sqrt(sy), rot = a.r, alpha = 1;
    if ( a.kind === "drop" ) {
      rot += this.tilt * 0.14 * clamp(-a.y / a.h0, 0, 1);
      alpha = clamp(a.t / 0.07, 0, 1);
      const pop = 0.55 + 0.45 * easeOutBack(clamp(a.t / 0.16, 0, 1));
      sx *= pop; sy *= pop;
    }
    p.y = a.y; p.sx = sx; p.sy = sy; p.rot = rot; p.alpha = alpha;
  }

  /** Pop-in with a spring overshoot, and the locked-on squeeze with a recoil shake. Returns true when finished. */
  poseAnalytic(dt) {
    const p = this.pose, t = this.t += dt, k = this.k;
    if ( this.kind === "pop" ) {
      const s = Math.max(0, 1 - Math.exp(-9 * t) * Math.cos(19 * t));
      p.sx = s * (1 - 0.06 * (s - 1) * k); p.sy = s * (1 + 0.1 * (s - 1) * k); p.alpha = clamp(t / 0.07, 0, 1); p.rot = 0; p.y = 0;
      return t > 0.85;
    }
    // lock: squeezed first, overshoots, settles; a quick sideways shake like a recoil
    const A = 0.15 * k, e = Math.exp(-9 * t);
    p.sy = 1 - A * e * Math.cos(26 * t); p.sx = 1 / Math.sqrt(p.sy); p.rot = 0.07 * k * Math.exp(-13 * t) * Math.sin(58 * t); p.y = 0; p.alpha = 1;
    return t > 0.5;
  }

  update(dt) {
    const t = this.token, m = t.mesh;
    if ( this.dead || t.destroyed || !m || m.destroyed ) return this.end();
    if ( !this.ready ) { this.age += dt; if ( this.age > 2 ) this.ready = true; }   // safety net: no refresh seen, go on with what the mesh holds
    if ( this.dirty ) this.capture();
    if ( this.delay > 0 ) {
      this.delay -= dt;           // staggered: waiting for its turn (a falling token is invisible and parked in the air)
      if ( this.kind === "drop" ) { this.pose.y = -this.a.h0; this.pose.alpha = 0; }
      else if ( this.kind === "pop" ) this.pose.alpha = this.pose.sx = this.pose.sy = 0;
    } else {
      if ( this.kind === "pop" || this.kind === "lock" ) {
        if ( this.poseAnalytic(dt) ) { this.apply(); return this.end(); }
      } else {
        if ( this.kind === "enter" && !this.popped ) { this.popped = true; if ( this.number != null && this.cfg.combatNumber ) spawnNumber(t, this.number); }
        const done = this.step(dt);
        this.poseFrom(this.a);
        if ( this.ripple.on ) this.tickRipple(dt);
        if ( done && !this.ripple.on ) { this.apply(); return this.end(); }
      }
    }
    this.apply();
  }

  tickRipple(dt) {
    const r = this.ripple; r.t += dt;
    const k = r.t / (this.kind === "enter" ? 0.7 : 0.55);
    if ( k >= 1 ) { r.on = false; this.rip.visible = false; return; }
    const e = 1 - (1 - k) ** 3;
    this.rip.visible = true; this.rip.scale.set(0.5 + e * this.ripMax); this.rip.alpha = (1 - k) * (this.kind === "enter" ? 0.75 : 0.55);
  }

  /** Write the pose onto the visuals. Squash and tilt pivot at the bottom-centre of the token's footprint, where it touches the ground. */
  apply() {
    const t = this.token, m = t.mesh, b = this.base, p = this.pose;
    if ( !b || !m || m.destroyed ) return;
    const doc = t.document, gx = doc.x + this.W / 2, gy = doc.y + this.H;
    place(m, b, p, gx, gy);
    m.alpha = b.alpha * p.alpha;
    t.position.y = b.cy + p.y;                    // bars, nameplate and effects fall with the token
    this.#applyShadow(gx, gy);
  }

  #applyShadow(gx, gy) {
    const sh = this.shadow, t = this.token, p = this.pose, S = this.S;
    const wantShadow = !!this.cfg.shadow && this.kind !== "lock";
    const vis = t.visible && t.mesh.visible;
    sh.visible = (wantShadow || this.ripple.on) && vis && (p.alpha > 0 || this.ripple.on);
    if ( !sh.visible ) return;
    const lift = clamp(-p.y / (S * 1.4), 0, 1), sq = clamp(1 - p.sy, 0, 0.5), wide = clamp(p.sx - 1, 0, 0.5);
    sh.position.set(gx + S * (0.05 + 0.16 * lift), gy - this.H * 0.1);
    this.pen.visible = this.core.visible = wantShadow;
    this.pen.scale.set(this.p0[0] * (1 + 0.45 * lift + 0.5 * wide), this.p0[1] * (1 + 0.45 * lift));
    this.pen.alpha = (1 - 0.75 * lift) * p.alpha;
    this.core.scale.set(this.c0[0] * (1 - 0.7 * lift) * (1 - 0.35 * sq), this.c0[1] * (1 - 0.7 * lift));
    this.core.alpha = clamp((1 - 1.1 * lift) * (1 + 1.4 * sq), 0, 1) * p.alpha;
  }

  /** Stop (settled or cut short). The visuals go back to whatever Foundry draws. */
  end() {
    if ( this.dead ) return;
    this.dead = true;
    ACTIVE.delete(this); if ( BY_TOKEN.get(this.token) === this ) BY_TOKEN.delete(this.token);
    if ( this.shadow && !this.shadow.destroyed ) this.shadow.destroy({ children: true });
    const t = this.token;
    if ( t && !t.destroyed && t.mesh && !t.mesh.destroyed ) t.renderFlags?.set({ refreshTransform: true, refreshMesh: true });
  }
}

/* ================================================================== ghost: a token that was just hidden */

class Ghost {
  constructor(token, cfg, delay) {
    const m = token.mesh, doc = token.document, { width, height } = doc.getSize();
    this.W = width; this.H = height; this.delay = delay; this.t = 0; this.dead = false; this.k = clamp(Number(cfg.intensity ?? 1) || 1, 0.2, 2);
    this.cfg = cfg;
    // a copy of what was on screen: same texture, transform, tint and alpha as the mesh had a moment ago
    this.base = { px: m.position.x, py: m.position.y, sx: m.scale.x, sy: m.scale.y, rot: m.rotation };
    this.gx = doc.x + width / 2; this.gy = doc.y + height;
    const root = this.root = new PIXI.Container();
    const spr = this.spr = root.addChild(new PIXI.Sprite(m.texture));
    spr.anchor.set(m.anchor.x, m.anchor.y); spr.tint = m.tint; this.alpha0 = clamp(m.alpha || 1, 0.05, 1);
    spr.position.set(this.base.px, this.base.py); spr.scale.set(this.base.sx, this.base.sy); spr.rotation = this.base.rot; spr.alpha = this.alpha0;
    this.pose = { y: 0, sx: 1, sy: 1, rot: 0 };
    // a ring of little inked puffs at the feet
    this.puffs = [];
    const n = 9, r = Math.max(4, width * 0.07);
    for ( let i = 0; i < n; i++ ) {
      const g = root.addChild(new PIXI.Graphics());
      g.lineStyle(Math.max(1.2, r * 0.22), INK, 0.9).beginFill(CREAM, 0.95).drawCircle(0, 0, r * (0.7 + 0.5 * ((i * 7) % 3) / 2)).endFill();
      g.visible = false; g.ang = (i / n) * TAU + 0.3; this.puffs.push(g);
    }
    sortNextTo(root, token, 1);
    root.visible = true;
    GHOSTS.add(this);
    startTicker();
  }

  update(dt) {
    if ( this.dead || this.root.destroyed ) return this.end();
    if ( this.delay > 0 ) { this.delay -= dt; return; }       // staggered bulk hide: the token lingers, then leaves in turn
    const t = this.t += dt, dur = 0.5, k = this.k;
    const ant = 0.09;                                        // anticipation: a quick stretch before the squash
    const p = this.pose, W = this.W;
    if ( t < ant ) { const u = t / ant; p.sy = 1 + 0.12 * k * u; p.sx = 1 - 0.06 * k * u; }
    else { const u = clamp((t - ant) / (dur - ant), 0, 1), e = u * u; p.sy = (1 + 0.12 * k) * (1 - e) + 0.03 * e; p.sx = (1 - 0.06 * k) * (1 - e) + 1.25 * e; }
    const fade = clamp((t - ant) / (dur - ant), 0, 1);
    this.spr.alpha = this.alpha0 * (1 - fade ** 1.4);
    place(this.spr, this.base, p, this.gx, this.gy);
    const u = clamp(t / (dur + 0.1), 0, 1), e = 1 - (1 - u) ** 3;
    for ( const g of this.puffs ) {
      g.visible = u > 0.05 && u < 1;
      g.position.set(this.gx + Math.cos(g.ang) * W * (0.2 + 0.55 * e), this.gy - this.H * 0.1 + Math.sin(g.ang) * W * (0.07 + 0.16 * e) - e * W * 0.12);
      g.scale.set(0.5 + e); g.alpha = 1 - u;
    }
    if ( t >= dur + 0.1 ) this.end();
  }

  end() {
    if ( this.dead ) return;
    this.dead = true; GHOSTS.delete(this);
    if ( !this.root.destroyed ) this.root.destroy({ children: true });   // the shared texture is not destroyed
  }
}

/* ================================================================== reticle: a hand-inked "locked on" mark */

const hashStr = (s) => { let h = 7; for ( const c of String(s) ) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

class Reticle {
  constructor(token, user, cfg, index) {
    this.token = token; this.user = user; this.cfg = cfg; this.index = index; this.dead = false;
    this.state = "in"; this.t = 0; this.spin = 0;
    const { width, height } = token.document.getSize();
    const R = Math.max(width, height) * 0.58 + index * Math.max(5, width * 0.05);
    const color = cfg.reticleUser === false ? Color.from(cfg.reticleColor || "#e5322d").valueOf() : Color.from(user.color ?? "#e5322d").valueOf();
    const g = this.g = new PIXI.Container();
    g.addChild(this.#draw(R, color, hashStr(user.id) + index, cfg.reticleStyle, width));
    g.position.set(width / 2, height / 2);
    g.eventMode = "none";
    token.addChild(g);
    g.zIndex = 5000;
    this.k = clamp(Number(cfg.intensity ?? 1) || 1, 0.2, 2);
    this.phase = (hashStr(user.id) % 100) / 16;
    this.update(0);
  }

  #draw(R, color, seed, style, W) {
    const gr = new PIXI.Graphics();
    let a = seed >>> 0;
    const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const ph = [rnd() * TAU, rnd() * TAU], w = Math.max(2.5, W * 0.035);
    const pts = [];
    const n = 44;
    for ( let i = 0; i <= n; i++ ) { const t = i / n * TAU, r = R * (1 + 0.018 * Math.sin(2 * t + ph[0]) + 0.012 * Math.sin(5 * t + ph[1])); pts.push([Math.cos(t) * r, Math.sin(t) * r]); }
    // two passes, the way the pins are inked: a chunky dark line, then the colour inside it
    for ( const [lw, col, al] of [[w * 2.1, INK, 0.9], [w, color, 1]] ) {
      gr.lineStyle({ width: lw, color: col, alpha: al, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
      if ( style === "brackets" ) {
        const s = R * 0.86, L = R * 0.5;
        for ( const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] ) { gr.moveTo(sx * s, sy * (s - L)); gr.lineTo(sx * s, sy * s); gr.lineTo(sx * (s - L), sy * s); }
      } else {
        // a broken ring with four ticks pointing in
        for ( let q = 0; q < 4; q++ ) {
          const from = Math.floor(n * (q / 4) + n * 0.04), to = Math.floor(n * ((q + 1) / 4) - n * 0.04);
          gr.moveTo(...pts[from]); for ( let i = from + 1; i <= to; i++ ) gr.lineTo(...pts[i]);
          const ang = q * Math.PI / 2 + Math.PI / 4 * 0 , cx = Math.cos(q * Math.PI / 2), cy = Math.sin(q * Math.PI / 2);
          gr.moveTo(cx * R * 0.72, cy * R * 0.72); gr.lineTo(cx * R * 1.12, cy * R * 1.12); void ang;
        }
      }
    }
    return gr;
  }

  release() { if ( this.state !== "out" ) { this.state = "out"; this.t = 0; } }

  update(dt) {
    const g = this.g;
    if ( this.dead || g.destroyed || this.token.destroyed ) return this.end();
    this.t += dt;
    const k = this.k;
    if ( this.state === "in" ) {
      const u = clamp(this.t / 0.2, 0, 1), s = 1 + 0.9 * (1 - easeOutBack(u));
      g.scale.set(s); g.alpha = clamp(u * 3, 0, 1); g.rotation = (1 - u) * -0.9;
      if ( u >= 1 ) this.state = "idle";
    } else if ( this.state === "idle" ) {
      g.rotation = this.t * 0.35 * (this.index % 2 ? -1 : 1) + this.phase;
      g.scale.set(1 + 0.03 * k * Math.sin(this.t * 3 + this.phase)); g.alpha = 1;
    } else {
      const u = clamp(this.t / 0.28, 0, 1);
      g.rotation += dt * 14 * (1 - u); g.scale.set(1 + 0.6 * u); g.alpha = 1 - u;
      if ( u >= 1 ) this.end();
    }
  }

  end() {
    if ( this.dead ) return;
    this.dead = true;
    for ( const [key, r] of RETICLES ) if ( r === this ) RETICLES.delete(key);
    if ( this.g && !this.g.destroyed ) this.g.destroy({ children: true });
  }
}

/* ================================================================== floating initiative number */

class Popup {
  constructor(token, text) {
    const { width, height } = token.document.getSize(), doc = token.document;
    this.t = 0; this.dead = false;
    this.x = doc.x + width / 2; this.y = doc.y - height * 0.05; this.rise = Math.max(30, height * 0.7);
    const size = Math.max(20, height * 0.38);
    const t = this.text = new PIXI.Text(String(text), new PIXI.TextStyle({ fontFamily: CONFIG.defaultFontFamily, fontWeight: "800", fontSize: size, fill: CREAM, stroke: INK, strokeThickness: Math.max(4, size * 0.22), lineJoin: "round" }));
    t.anchor.set(0.5, 1); t.resolution = Math.max(2, window.devicePixelRatio || 1); t.position.set(this.x, this.y); t.eventMode = "none";
    t.zIndex = 9000;
    canvas.interface.addChild(t);
    POPUPS.add(this); startTicker();
  }
  update(dt) {
    if ( this.dead || this.text.destroyed ) return this.end();
    const t = this.t += dt, u = clamp(t / 1.0, 0, 1), e = 1 - (1 - u) ** 3;
    this.text.y = this.y - e * this.rise;
    this.text.scale.set(clamp(easeOutBack(clamp(t / 0.18, 0, 1)), 0, 1.3));
    this.text.alpha = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
    if ( u >= 1 ) this.end();
  }
  end() { if ( this.dead ) return; this.dead = true; POPUPS.delete(this); if ( !this.text.destroyed ) this.text.destroy(); }
}
function spawnNumber(token, n) { if ( n !== null && n !== undefined && token.visible ) new Popup(token, Number.isInteger(n) ? n : Math.round(n * 10) / 10); }

/* ================================================================== hooks */

const tokenCfg = (doc) => sceneConfig(doc.parent).tokens;

/** Is this animation on for this token and this client? `flag` names the per-effect switch in the Tokens settings. */
function allowed(token, c, flag = "enabled") {
  if ( !c?.[flag] || reducedMotion() ) return false;
  if ( c.who === "gm" && !game.user.isGM ) return false;
  const owned = !!token.document.actor?.hasPlayerOwner;
  if ( c.filter === "player" && !owned ) return false;
  if ( c.filter === "npc" && owned ) return false;
  return true;
}

/** Start a mesh effect. A falling token is never interrupted; anything else yields to the newer effect. */
function startFx(token, kind, c, delay = 0, ready = false, extra = {}) {
  if ( !token?.mesh || token.mesh.destroyed || token.destroyed ) return null;
  const cur = BY_TOKEN.get(token);
  if ( cur ) { if ( cur.kind === "drop" ) return null; cur.end(); }
  return new Drop(token, kind, c, delay, ready, extra);
}

function startDrop(token, ready = false) {
  const c = tokenCfg(token.document);
  if ( !token.mesh || token.mesh.destroyed || BY_TOKEN.has(token) || !allowed(token, c) ) return;
  const idx = nextBurstIndex("drop");
  if ( idx === null ) return;                                  // a mass drop: skip, never lag
  startFx(token, "drop", c, Math.min(idx * STAGGER, MAX_DELAY), ready);
}

/** A token was created during this session (never fires for tokens that merely load with the scene). */
export function onCreateToken(doc) {
  if ( doc.parent?.id !== canvas.scene?.id ) return;
  doc._mmDrop = Date.now();
  const t = doc.object;
  // already drawn AND positioned by Foundry's first refresh? then it is ready now; otherwise drawToken / refreshToken will start it
  if ( t?.mesh && !t.destroyed && !t.renderFlags?.size && Math.abs(t.mesh.position.x - t.center.x) < 1 && Math.abs(t.mesh.position.y - t.center.y) < 1 ) { doc._mmDrop = 0; startDrop(t, true); }
}
export function onDrawToken(token) {
  const doc = token.document;
  if ( doc._mmDrop && Date.now() - doc._mmDrop < 3000 ) { doc._mmDrop = 0; startDrop(token); }
  // a redraw drops our children: bring back the reticles of a token that is still targeted
  if ( token.targeted?.size ) for ( const u of token.targeted ) addReticle(u, token, true);
}

/** Foundry has just applied its refresh flags to this token: its mesh and container hold their own values again. */
export function onRefreshToken(token, flags) {
  const d = BY_TOKEN.get(token);
  if ( d && flags && (flags.refreshMesh || flags.refreshPosition || flags.refreshSize || flags.refreshRotation || flags.refreshTransform || flags.refresh || flags.redraw) ) d.refreshed();
  if ( token.targeted?.size && tokenCfg(token.document).hideNative && tokenCfg(token.document).target && token.target ) token.target.visible = false;
}

export function onUpdateToken(doc, changes) {
  const t = doc.object; if ( !t ) return;
  if ( "hidden" in changes && doc.parent?.id === canvas.scene?.id ) return onHiddenChanged(t, doc.hidden);
  const moved = "x" in changes || "y" in changes || "elevation" in changes;
  if ( !moved ) return;
  const d = BY_TOKEN.get(t);
  if ( d ) { if ( d.kind === "drop" ) d.end(); return; }        // dragged away while falling: the movement animation takes over
  const c = tokenCfg(doc);
  if ( c.hop && allowed(t, c) && !("elevation" in changes) ) startFx(t, "hop", c, 0, true);
}

/**
 * Only the document's own `hidden` flag, never vision. Hiding: a ghost of what this client was just seeing leaves the stage. Unhiding: the real
 * token pops in. The ghost is only made from a token this client can see right now, so nothing is revealed that the player could not see.
 */
function onHiddenChanged(token, hidden) {
  const c = tokenCfg(token.document);
  if ( !allowed(token, c, "hide") ) return;
  const idx = nextBurstIndex(hidden ? "hide" : "unhide");
  if ( idx === null ) return;
  const delay = Math.min(idx * STAGGER, MAX_DELAY);
  if ( hidden ) {
    const m = token.mesh;
    if ( !m || m.destroyed || !token.visible || !m.visible || !m.renderable ) return;
    new Ghost(token, c, delay);
  } else startFx(token, "pop", c, delay, true);
}

export function onDeleteToken(doc) {
  const t = doc.object, d = BY_TOKEN.get(t); if ( d ) d.end();
  for ( const [key, r] of RETICLES ) if ( r.token === t ) r.end();
}

/* ---- targeting ---- */

function addReticle(user, token, quiet = false) {
  const c = tokenCfg(token.document);
  if ( !allowed(token, c, "target") || !token.mesh || token.destroyed ) return;
  const key = `${token.id}|${user.id}`;
  if ( RETICLES.has(key) && !RETICLES.get(key).dead ) return;
  const index = [...RETICLES.values()].filter((r) => r.token === token && !r.dead).length;   // several users on one token: concentric rings
  const r = new Reticle(token, user, c, index);
  RETICLES.set(key, r);
  if ( quiet ) { r.state = "idle"; r.t = 0; }
  else if ( !BY_TOKEN.has(token) ) startFx(token, "lock", c, 0, true);   // the punchy "locked on" squeeze
  startTicker();
}

export function onTargetToken(user, token, targeted) {
  if ( !token || token.document.parent?.id !== canvas.scene?.id ) return;
  if ( targeted ) addReticle(user, token);
  else { const r = RETICLES.get(`${token.id}|${user.id}`); r?.release(); }
}

/* ---- combat ---- */

function enterToken(cb, delay, withNumber) {
  const t = cb.token?.object, c = t ? tokenCfg(t.document) : null;
  if ( !t || !t.mesh || !allowed(t, c, "combat") ) return;
  startFx(t, "enter", c, delay, true, { number: withNumber ? cb.initiative : null });
}

export function onCreateCombatant(cb) {
  const combat = cb.combat;
  if ( !combat || combat.scene?.id !== canvas.scene?.id ) return;
  const idx = nextBurstIndex("combat"); if ( idx === null ) return;
  enterToken(cb, tokenCfg(canvas.scene).combatStagger ? Math.min(idx * STAGGER, MAX_DELAY) : 0, true);
}

/** Combat starts: the field wakes up, highest initiative first. */
export function onUpdateCombat(combat, changes) {
  if ( !("round" in changes) || changes.round !== 1 || combat.scene?.id !== canvas.scene?.id ) return;
  const list = [...combat.combatants].filter((cb) => cb.token?.object).sort((a, b) => (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity));
  if ( list.length > MAX_BURST ) return;
  const stagger = tokenCfg(canvas.scene).combatStagger;
  list.forEach((cb, i) => enterToken(cb, stagger ? Math.min(i * 0.09, 1) : 0, true));
}

/* ---- lifecycle ---- */

export function teardownTokenDrops() {
  for ( const d of [...ACTIVE] ) d.end();      // restores any token that is still alive, destroys every shadow
  for ( const g of [...GHOSTS] ) g.end();
  for ( const p of [...POPUPS] ) p.end();
  for ( const r of [...RETICLES.values()] ) r.end();
  BY_TOKEN.clear(); RETICLES.clear(); stopTicker();
  for ( const k of Object.keys(bursts) ) delete bursts[k];
}
export const _tokenDrops = () => ({ active: ACTIVE.size, ghosts: GHOSTS.size, popups: POPUPS.size, reticles: RETICLES.size, ticking });
/** Test helper: advance everything by `n` steps of `frames` frames (the ticker is paused while a browser tab is hidden). */
export const _stepAll = (n = 1, frames = 3) => { for ( let i = 0; i < n; i++ ) tick(frames); };
