import { TrafficSim, buildNetwork, catchUp, carPose, EPOCH, DT } from "./traffic.mjs";
import { carTexture, shadowTexture, beamTexture, glowTexture } from "./art.mjs";
import { reducedMotion } from "../config.mjs";
import { perfLow } from "../perf-mode.mjs";

/**
 * Draws the traffic: pooled sprites in one container (primary group, just above the districts' tint and under tiles and
 * tokens), driven by one ticker callback. Positions come from the deterministic simulation (traffic.mjs) at the server time,
 * interpolated between steps, so every client shows the same cars. Nothing here writes a document or takes a pointer event.
 */

const FADE_EPOCH = 2.5;          // seconds the old epoch's cars take to fade out
const CATCHUP_MS = 9;          // per frame, while a simulation catches up with the clock

const now = () => (game.time?.serverTime ?? Date.now()) / 1000;

class CarSprite extends PIXI.Container {
  constructor(beams) {
    super();
    this.eventMode = "none";
    this.interactiveChildren = false;
    this.shadow = this.addChild(new PIXI.Sprite(shadowTexture()));
    this.shadow.anchor.set(0.5);
    this.body = this.addChild(new PIXI.Sprite(PIXI.Texture.EMPTY));
    this.body.anchor.set(0.5);
    this.tails = [0, 1].map(() => { const s = this.addChild(new PIXI.Sprite(glowTexture())); s.anchor.set(0.5); s.blendMode = PIXI.BLEND_MODES.ADD; return s; });
    // the beam lives in a separate container above the cars so beams are not hidden under the next car's body
    this.beam = beams.addChild(new PIXI.Sprite(beamTexture()));
    this.beam.anchor.set(0, 0.5); this.beam.blendMode = PIXI.BLEND_MODES.ADD; this.beam.visible = false;
    this.key = "";
  }

  dress(c, style) {
    const key = `${style}|${c.type}|${c.color}|${c.len.toFixed(2)}`;
    if ( key === this.key ) return;
    this.key = key;
    const tex = carTexture(c.type, c.color, style);
    this.body.texture = tex;
    const k = c.len / tex.mmLen;
    this.body.scale.set(k);
    this.k = k;
    const sh = this.shadow.texture.mmInner;
    this.shadow.scale.set((c.len * 1.08) / sh.w, (c.wid * 1.25) / sh.h);
    this.shadow.position.set(c.len * 0.06, c.wid * 0.18);
    for ( const [i, s] of this.tails.entries() ) { s.position.set(-c.len * 0.5, (i ? 1 : -1) * c.wid * 0.33); s.scale.set((c.wid * 0.5) / 32); }
  }

  destroy() { this.beam.destroy(); super.destroy({ children: true }); }
}

export class TrafficView {
  constructor() {
    this.root = new PIXI.Container();
    this.root.eventMode = "none"; this.root.interactiveChildren = false;
    Object.assign(this.root, { elevation: 0, sortLayer: 255, sort: 0, _lastSortedIndex: 0 });
    this.carsLayer = this.root.addChild(new PIXI.Container());
    this.beams = this.root.addChild(new PIXI.Container());
    canvas.primary.addChild(this.root);
    this.pools = [[], []];         // current epoch, fading epoch
    this.sim = null; this.old = null; this.oldFade = 0;
    this.net = null; this.T = null; this.key = "";
    this.shown = true;
    this.stats = { frameMs: 0, cars: 0, visible: 0 };
    this._tick = () => this.tick();
    canvas.app.ticker.add(this._tick);
  }

  /** New roads or traffic settings: a new network, and a simulation that catches up from the start of the epoch. */
  configure(R, g, rect, sceneKey) {
    this.T = R.traffic;
    this.key = sceneKey;
    this.net = buildNetwork(R, g, rect);
    this.g = g;
    // the cars of the old roads keep driving (on their own network) until the new simulation has caught up, then fade out
    if ( this.sim?.ready ) { this.old = this.sim; this.oldFade = Infinity; this.pools.reverse(); this.#hideAll(0); }
    else if ( this.old && this.oldFade === Infinity ) this.#hideAll(0);       // edited again while catching up: keep showing the old cars
    else { this.old = null; this.#hideAll(0); this.#hideAll(1); }
    this.sim = null;
    this.handover = true;
  }

  /** Only how the cars look changed (lights, style, who sees them): nothing to simulate again. */
  restyle(R) { this.T = R.traffic; for ( const pool of this.pools ) for ( const s of pool ) s.key = ""; }

  set visible(v) { this.shown = v; this.root.visible = v; }

  #hideAll(i) { for ( const s of this.pools[i] ) { s.visible = false; s.beam.visible = false; } }

  #ensure(i, n) {
    const pool = this.pools[i];
    while ( pool.length < n ) { const s = new CarSprite(this.beams); this.carsLayer.addChild(s); pool.push(s); }
    return pool;
  }

  /** The night factor 0..1 for headlights. */
  #night() {
    const m = this.T?.lights;
    if ( m === "on" ) return 1;
    if ( m === "off" ) return 0;
    const d = canvas.environment?.darknessLevel ?? canvas.darknessLevel ?? 0;
    return Math.min(1, Math.max(0, (d - 0.35) / 0.3));
  }

  tick() {
    if ( !this.shown || !this.net || !this.T?.on || !this.net.lanes.length ) { if ( this.sim ) { this.sim = null; this.old = null; this.#hideAll(0); this.#hideAll(1); } return; }
    const t0 = performance.now();
    const t = now();
    const epoch = Math.floor(t / EPOCH);
    const tIn = t - epoch * EPOCH;
    const step = Math.floor(tIn / DT);
    const alpha = Math.min(1, Math.max(0, (tIn - step * DT) / DT));
    if ( !this.sim || this.sim.epoch !== epoch || this.sim.step > step + 2 ) {
      if ( this.handover ) this.handover = false;     // keep the old roads' cars (configure) until this one is ready
      else if ( this.sim?.ready && this.sim.epoch === epoch - 1 ) { this.old = this.sim; this.oldFade = t; this.pools.reverse(); }
      else { this.old = null; this.#hideAll(1); }
      // performance mode Low: at most 15 cars on this client (its own simulation; nothing shared changes)
      this.sim = new TrafficSim(this.net, perfLow() && this.T ? { ...this.T, max: Math.min(this.T.max ?? 15, 15) } : this.T, this.key, epoch);
      this.sim.ready = false;
      this.#hideAll(0);
    }
    const sim = this.sim;
    const was = sim.ready;
    sim.ready = catchUp(sim, step, sim.ready ? 30 : CATCHUP_MS) || sim.ready;
    if ( sim.ready && !was && this.old && this.oldFade === Infinity ) this.oldFade = t - FADE_EPOCH * 0.7;   // a quick cross-fade
    const night = this.#night(), calm = reducedMotion();
    const view = this.#viewRect();
    let visible = 0;
    if ( sim.ready ) visible += this.#draw(0, sim, sim.step === step ? alpha : 1, 1, night, calm, view, t);
    if ( this.old ) {
      const f = this.oldFade === Infinity ? 1 : 1 - (t - this.oldFade) / FADE_EPOCH;
      if ( f <= 0 ) { this.old = null; this.#hideAll(1); }
      else {
        const ot = t - this.old.epoch * EPOCH, os = Math.floor(ot / DT);
        catchUp(this.old, os, 4);
        visible += this.#draw(1, this.old, this.old.step === os ? Math.min(1, (ot - os * DT) / DT) : 1, f, night, calm, view, t);
      }
    }
    this.stats.frameMs = performance.now() - t0;
    this.stats.cars = sim.cars.length; this.stats.visible = visible;
  }

  #viewRect() {
    const scr = canvas.app.renderer.screen;
    const a = canvas.stage.toLocal({ x: 0, y: 0 }), b = canvas.stage.toLocal({ x: scr.width, y: scr.height });
    const m = this.g * 2;
    return { x0: Math.min(a.x, b.x) - m, y0: Math.min(a.y, b.y) - m, x1: Math.max(a.x, b.x) + m, y1: Math.max(a.y, b.y) + m };
  }

  #draw(i, sim, alpha, fade, night, calm, view, t) {
    const pool = this.#ensure(i, sim.cars.length);
    const style = this.T.style;
    let n = 0;
    for ( let k = 0; k < pool.length; k++ ) {
      const spr = pool[k], c = sim.cars[k];
      const pose = c ? carPose(sim, c, alpha) : null;
      if ( !pose || pose.alpha <= 0 || pose.x < view.x0 || pose.x > view.x1 || pose.y < view.y0 || pose.y > view.y1 ) {
        spr.visible = false; spr.beam.visible = false; continue;
      }
      n++;
      spr.visible = true;
      spr.dress(c, style);
      spr.position.set(pose.x, pose.y);
      spr.alpha = pose.alpha * fade;
      // a little life: the body sways on rough ground and pitches when braking (display only)
      let rot = pose.heading;
      if ( !calm ) {
        const rough = pose.piece.kind === "dirt" ? 2.2 : pose.piece.kind === "cobble" ? 1.6 : 0.6;
        const sp = Math.min(1, c.v / Math.max(1e-6, pose.piece.vtop));
        const ph = c.id * 1.7 + sim.epoch;
        rot += Math.sin(t * 7.3 + ph) * 0.012 * rough * sp;
        spr.body.scale.set(spr.k * (c.brk ? 0.985 : 1), spr.k * (1 + Math.sin(t * 11 + ph) * 0.012 * rough * sp));
      }
      spr.rotation = rot;
      const brake = c.brk || c.v < this.g * 0.05;
      for ( const s of spr.tails ) { s.alpha = Math.max(night * 0.55, brake ? 0.85 : 0); s.visible = s.alpha > 0.01; }
      if ( night > 0.01 ) {
        const b = spr.beam;
        b.visible = true;
        b.position.set(pose.x + Math.cos(pose.heading) * c.len * 0.48, pose.y + Math.sin(pose.heading) * c.len * 0.48);
        b.rotation = pose.heading;
        b.scale.set((c.len * 2.2) / 160, (c.wid * 2.6) / 96);
        b.alpha = night * 0.85 * spr.alpha * (calm ? 1 : 0.93 + Math.sin(t * 13 + c.id) * 0.03);
      } else spr.beam.visible = false;
    }
    return n;
  }

  /** Where every car is (for tests and other modules): [{ id, x, y, heading, piece }] at this moment. */
  snapshot() {
    const sim = this.sim; if ( !sim?.ready ) return [];
    const t = now(), tIn = t - sim.epoch * EPOCH, step = Math.floor(tIn / DT);
    const alpha = sim.step === step ? Math.min(1, (tIn - step * DT) / DT) : 1;
    return sim.cars.map((c) => { const p = carPose(sim, c, alpha); return p ? { id: c.id, x: p.x, y: p.y, heading: p.heading, piece: p.piece.id, s: p.s } : { id: c.id, hidden: true }; });
  }

  destroy() {
    canvas.app?.ticker?.remove(this._tick);
    for ( const pool of this.pools ) for ( const s of pool ) s.destroy();
    this.pools = [[], []];
    if ( !this.root.destroyed ) this.root.destroy({ children: true });
    this.sim = this.old = this.net = null;
  }
}
