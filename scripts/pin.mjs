import { sceneConfig, pinTypeOf, reducedMotion } from "./config.mjs";
import { applyPinText } from "./labels.mjs";
import { enforce, isHidden } from "./filter.mjs";
import { shadowTextures, burstTexture, pinTextures, PPU, FW, FH, OX, OY, VARIANTS } from "./pin-art.mjs";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

const HEAD_Y = 0.67;        // head centre above the tip, in units of S
const UNIT = 1.3;           // pin height (S) relative to the note's iconSize
const SPRING = { K: 700, C: 22 };   // squash spring: ~23% overshoot, settles in ~0.5s
const ROT = { K: 480, C: 13 };      // wobble spring after impact

/** All live pins share one ticker callback. */
const PINS = new Set();
let ticking = false;
function sharedTick(dtFrames) {
  const dt = Math.min(dtFrames / 60, 0.05);
  const now = performance.now() / 1000;
  for ( const pin of PINS ) {
    if ( pin.destroyed || !pin.parent ) { PINS.delete(pin); continue; }
    pin.tick(dt, now);
  }
  if ( !PINS.size && ticking ) { canvas.app?.ticker?.remove(sharedTick); ticking = false; }
}
function register(pin) {
  PINS.add(pin);
  if ( !ticking && canvas.app?.ticker ) { canvas.app.ticker.add(sharedTick); ticking = true; }
}

const hashVariant = (id) => { let h = 0; for ( const c of String(id ?? "") ) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % VARIANTS; };

/** Pin visual attached to a Note placeable. The tip of the pin sits exactly on the note's coordinates. */
class Pin extends PIXI.Container {
  constructor(note) {
    super();
    this.note = note;
    this.eventMode = "none";
    this.variant = hashVariant(note.document.id);
    const tex = pinTextures(this.variant);
    const st = shadowTextures();
    this.shadow = this.addChild(new PIXI.Container());
    this.pen = this.shadow.addChild(new PIXI.Sprite(st.pen));
    this.core = this.shadow.addChild(new PIXI.Sprite(st.core));
    for ( const s of [this.pen, this.core] ) { s.anchor.set(0.5); s.blendMode = PIXI.BLEND_MODES.MULTIPLY; }
    this.ripple = this.addChild(new PIXI.Graphics());
    this.ripple.visible = false;
    // `body` is the animated part; its origin is the pin's tip so squash/stretch stays anchored to the ground
    this.body = this.addChild(new PIXI.Container());
    const layer = (t) => {
      const s = this.body.addChild(new PIXI.Sprite(t));
      s.anchor.set(OX / FW, OY / FH);
      return s;
    };
    this.halo = layer(tex.halo);
    this.fill = layer(tex.fill);
    this.gloss = layer(tex.gloss);
    this.ink = layer(tex.ink);
    this.burst = layer(tex.burst);
    this.halo.alpha = 0;
    this.glyph = this.body.addChild(new PIXI.Sprite());
    this.glyph.anchor.set(0.5);
    this.glyph.tint = 0x1b1411;
    this.layers = [this.halo, this.fill, this.gloss, this.ink, this.burst];
    this.phase = Math.random() * Math.PI * 2;
    this.tilt = Math.random() < 0.5 ? -1 : 1;
    this.anim = null;
    this.S = 40;
    this.hv = 0;            // eased hover/selection amount
    this.idleK = 0;         // eased idle amplitude (fades in after an animation ends)
    this._hid = isHidden(note.document);   // the user's pin filter: hidden pins shrink away, shown ones drop back in
    this.pres = this._hid ? 0 : 1;         // 0 = gone, 1 = fully present
    this._shadowS = 0;
    this._glyphSrc = null;
    register(this);
  }

  get cfg() { return sceneConfig(this.note.document.parent); }

  destroy(opts) {
    PINS.delete(this);
    super.destroy(opts);
  }

  /** Re-apply size/colour/glyph. Cheap: no geometry is redrawn, only sprites are rescaled. */
  redraw() {
    const cfg = this.cfg;
    const doc = this.note.document;
    const S = doc.iconSize * cfg.size * UNIT;
    const noteTint = doc.texture.tint;
    const type = pinTypeOf(doc);
    const own = doc.flags?.["moinen-maps"]?.color;
    let tint;
    if ( type ) tint = Color.from(own || type.color);           // standalone pin: its own colour
    else tint = cfg.useNoteTint && noteTint && noteTint.valueOf() !== 0xFFFFFF ? noteTint : Color.from(cfg.color);
    this.burst.texture = burstTexture(type?.glyph, this.variant);
    const sc = S / PPU;
    for ( const s of this.layers ) s.scale.set(sc);
    this.fill.tint = tint;
    this.S = S;

    // glyph (the note's own icon, shown on the cream burst)
    const showGlyph = cfg.glyph === "note" && !!doc.texture.src && !type;
    const key = showGlyph ? `${doc.texture.src}|${S}` : "";
    if ( key !== this._glyphKey ) {
      this._glyphKey = key;
      this.glyph.visible = false;
    }
    if ( showGlyph && !this.glyph.visible && this._glyphLoading !== key ) {
      this._glyphLoading = key;
      const src = doc.texture.src;
      this._glyphSrc = src;
      foundry.canvas.loadTexture(src).then((t) => {
        if ( this.destroyed || this._glyphSrc !== src || !t?.valid ) return;
        this.glyph.texture = t;
        const target = S * 0.17, m = Math.max(t.width, t.height) || 1;
        this.glyph.scale.set(target / m);
        this.glyph.position.set(0, -S * HEAD_Y);
        this.glyph.visible = true;
      }).catch(() => {});
    }

    // ground shadow: pre-rendered sprites, only resized here; ripple Graphics is redrawn only when the size changes
    this.shadow.visible = cfg.shadow;
    this.pen.width = S * 0.78; this.pen.height = S * 0.24;
    this.core.width = S * 0.34; this.core.height = S * 0.1;
    this.shadow.position.x = S * 0.05;
    this._pen0 = this.pen.scale.x; this._pen1 = this.pen.scale.y; this._core0 = this.core.scale.x; this._core1 = this.core.scale.y;
    if ( this._shadowS !== S ) {
      this._shadowS = S;
      this.ripple.clear().lineStyle(Math.max(1.5, S * 0.03), 0xFFFFFF, 0.9).drawEllipse(0, 0, S * 0.3, S * 0.1);
    }
  }

  /** Falling in: anticipation-free drop with gravity, impact squash, spring overshoot, one or two settling bounces. */
  drop() {
    const cfg = this.cfg;
    if ( !cfg.drop || reducedMotion() ) return;   // reduced motion: the pin simply appears
    const h = this.S * 1.6 * cfg.dropHeight;
    this.anim = { kind: "drop", y: -h, vy: 0, h0: h, q: 0, qv: 0, r: 0, rv: 0, t: 0, landed: false, e: 0.1 + 0.34 * cfg.bounce, hits: 0 };
    this.applyPose(this.anim, 0, 0);
  }

  /**
   * The pin filter: a hidden pin shrinks into its tip and fades, a shown one drops back in (or just fades in with reduced motion / drops off).
   * Returns false while the pin is gone, so the rest of the tick is skipped.
   */
  stepPresence(dt) {
    const note = this.note, hid = isHidden(note.document), still = reducedMotion();
    if ( hid !== this._hid ) {
      this._hid = hid;
      if ( !hid ) {
        if ( note.isVisible ) note.visible = true;
        const cfg = this.cfg;
        if ( !still && cfg.drop ) { this.pres = 1; this.drop(); }       // reuse the bouncy drop; it fades the pin in itself
        else if ( still ) this.pres = 1;
      }
    }
    const target = hid ? 0 : 1;
    if ( this.pres !== target ) {
      this.pres = still ? target : target > this.pres ? Math.min(1, this.pres + dt / 0.3) : Math.max(0, this.pres - dt / 0.22);
    }
    const k = this.pres;
    if ( k === 0 ) { if ( note.visible ) note.visible = false; return false; }
    const e = k * k * (3 - 2 * k);
    this.scale.set(0.35 + 0.65 * e); this.alpha = e;
    return true;
  }

  /** Move hop: crouch, spring up, land softly. */
  hop() {
    const cfg = this.cfg;
    if ( !cfg.hop || reducedMotion() || this.anim?.kind === "drop" ) return;
    const h = this.S * 0.32, g = this.S * 36;
    this.anim = { kind: "hop", y: 0, vy: -Math.sqrt(2 * g * h), h0: h, q: -0.2 * cfg.squeeze, qv: 0, r: 0, rv: 0, t: 0, landed: false, e: 0, hits: 0 };
  }

  /** Physics step for drop/hop. Returns true when finished. */
  stepAnim(a, dt, cfg) {
    const g = this.S * 36, S = this.S;
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for ( let i = 0; i < n; i++ ) {
      a.t += h;
      if ( !a.landed || a.y < 0 ) {
        a.vy += g * h; a.y += a.vy * h;
        if ( a.y >= 0 && a.vy > 0 ) {            // impact
          const v = a.vy, imp = clamp(v / (S * 10), 0, 1.4);
          a.y = 0;
          a.q = Math.min(a.q, -0.5 * imp * cfg.squeeze);
          a.qv = 0;
          if ( a.hits === 0 && a.kind === "drop" ) { a.rv = this.tilt * 3.2 * clamp(imp, 0.3, 1); this.ripple.t = 0; this.ripple.visible = cfg.shadow; }
          a.hits++;
          const nv = v * a.e;
          if ( a.e > 0 && nv > S * 1.6 && a.hits < 4 ) a.vy = -nv; else { a.vy = 0; a.landed = true; }
        }
      }
      // squash and wobble springs
      a.qv += (-SPRING.K * a.q - SPRING.C * a.qv) * h; a.q += a.qv * h;
      a.rv += (-ROT.K * a.r - ROT.C * a.rv) * h; a.r += a.rv * h;
    }
    return a.landed && a.y === 0 && Math.abs(a.q) < 0.004 && Math.abs(a.qv) < 0.08 && Math.abs(a.r) < 0.004 && Math.abs(a.rv) < 0.08;
  }

  /** Write an animation state onto the body transform. */
  applyPose(a, hv, idleK, now = 0, cfg = this.cfg) {
    const S = this.S;
    let y = 0, sx = 1, sy = 1, rot = 0, alpha = 1;
    if ( a ) {
      y = a.y;
      const air = a.y < -0.5 ? clamp(Math.abs(a.vy) / (S * 10), 0, 1) : 0;
      sy = 1 + a.q + 0.16 * air * (0.4 + cfg.bounce * 0.6);
      sx = 1 / Math.sqrt(sy);
      rot = a.r;
      if ( a.kind === "drop" ) {
        rot += this.tilt * 0.14 * clamp(-a.y / a.h0, 0, 1);
        const p = clamp(a.t / 0.16, 0, 1);
        alpha = clamp(a.t / 0.07, 0, 1);
        const pop = 0.55 + 0.45 * easeOutBack(p);
        sx *= pop; sy *= pop;
      }
    } else if ( idleK > 0.001 && cfg.idle !== "none" ) {
      const t = now * cfg.idleSpeed + this.phase, s = cfg.idleStrength * idleK;
      switch ( cfg.idle ) {
        case "breathe": { const w = Math.sin(t * 2); sy = 1 + 0.04 * s * w; sx = 1 - 0.022 * s * w; break; }
        case "bob": y = -S * 0.06 * s * (0.5 + 0.5 * Math.sin(t * 2.2)); break;
        case "sway": rot = 0.09 * s * Math.sin(t * 1.5); break;
        case "pulse": { const w = 0.5 + 0.5 * Math.sin(t * 2.6); sx = sy = 1 + 0.07 * s * w * w; break; }
      }
    }
    // hover lift
    y -= S * 0.05 * hv;
    const hs = 1 + 0.06 * hv;
    const b = this.body;
    b.position.y = y;
    b.scale.set(sx * hs, sy * hs);
    b.rotation = rot;
    b.alpha = alpha;
    // shadow reacts to height and squash: airborne = wider, fainter, drifting away from the light (top-left);
    // impact squash = tighter, darker contact core
    if ( this.shadow.visible ) {
      const lift = clamp(-y / (S * 1.4), 0, 1);
      const sq = clamp(1 - sy, 0, 0.5), wide = clamp(sx - 1, 0, 0.5);
      this.shadow.position.x = S * (0.05 + 0.16 * lift);
      this.pen.scale.set(this._pen0 * (1 + 0.45 * lift + 0.5 * wide), this._pen1 * (1 + 0.45 * lift));
      this.pen.alpha = (1 - 0.75 * lift) * alpha;
      this.core.scale.set(this._core0 * (1 - 0.7 * lift) * (1 - 0.35 * sq), this._core1 * (1 - 0.7 * lift));
      this.core.alpha = clamp((1 - 1.1 * lift) * (1 + 1.4 * sq), 0, 1) * alpha;
    }
  }

  tick(dt, now) {
    const cfg = this.cfg;
    const note = this.note;
    if ( !this.stepPresence(dt) ) return;
    // hover / selection feedback, eased
    const controlled = note.controlled || note.isPreview;
    const over = note.hover || note.layer?.highlightObjects;
    const target = controlled ? 1 : over ? 0.75 : 0;
    this.hv += (target - this.hv) * Math.min(1, dt * 14);
    if ( Math.abs(this.hv - target) < 0.002 ) this.hv = target;
    if ( cfg.glow && this.hv > 0 ) {
      const colors = CONFIG.Canvas?.dispositionColors ?? {};
      const tint = controlled ? (note.document.locked ? colors.HOSTILE : colors.CONTROLLED) : 0xFFFFFF;
      this.halo.tint = tint ?? 0xFF9829;
      this.halo.alpha = this.hv * (controlled ? 0.95 : 0.7);
    } else this.halo.alpha = 0;

    const a = this.anim;
    if ( a ) {
      if ( this.stepAnim(a, dt, cfg) ) { this.anim = null; this.idleK = 0; }
      this.applyPose(this.anim ?? null, this.hv, 0, now, cfg);
    } else {
      const still = cfg.idle === "none" || reducedMotion();
      if ( still && this.hv === 0 && this.body.position.y === 0 && this.body.scale.x === 1 && this.body.rotation === 0 ) { this.updateRipple(dt); return; }
      this.idleK = still ? 0 : Math.min(1, this.idleK + dt * 1.6);
      this.applyPose(null, this.hv, this.idleK, now, cfg);
    }
    this.updateRipple(dt);
  }

  updateRipple(dt) {
    const r = this.ripple;
    if ( !r.visible ) return;
    r.t += dt;
    const k = r.t / 0.55;
    if ( k >= 1 ) { r.visible = false; return; }
    const e = 1 - (1 - k) ** 3;
    r.scale.set(0.5 + e * 1.1);
    r.alpha = (1 - k) * 0.55;
  }
}

/** Put the hit area (the note's control icon) and the tooltip on the pin head rather than the tip. */
function syncLayout(note, pin) {
  const S = pin.S, ci = note.controlIcon;
  ci.position.set(0, -S * HEAD_Y);
  ci.scale.set(pin.cfg.size * 0.9);   // hit area ~ the pin head
  ci.border.visible = false;                  // the pin's own glow replaces the square border
  const doc = note.document, cfg = pin.cfg;
  const tt = note.tooltip;
  applyPinText(note, cfg);
  if ( tt && pinTypeOf(doc) && !doc.text ) tt.visible = false;
  if ( tt ) {
    const A = CONST.TEXT_ANCHOR_POINTS, head = -S * HEAD_Y, pad = 8;
    switch ( doc.textAnchor ) {
      case A.TOP: tt.position.set(0, -S * 1.03 - pad); break;
      case A.BOTTOM: tt.position.set(0, pad); break;
      case A.LEFT: tt.position.set(-S * 0.4 - pad, head); break;
      case A.RIGHT: tt.position.set(S * 0.4 + pad, head); break;
      default: tt.position.set(0, head);
    }
  }
}

export function attachPin(note) {
  if ( note._mmPin && !note._mmPin.destroyed ) return note._mmPin;
  if ( !sceneConfig(note.document.parent).enabled || !note.controlIcon ) return null;
  const pin = note._mmPin = note.addChildAt(new Pin(note), 0);
  note.controlIcon.icon.visible = false;
  note.controlIcon.bg.visible = false;
  pin.redraw();
  syncLayout(note, pin);
  return pin;
}

export function detachPin(note) {
  const pin = note._mmPin;
  if ( !pin ) return;
  pin.destroy({ children: true });
  note._mmPin = null;
  const ci = note.controlIcon;
  if ( ci && !ci.destroyed ) { ci.icon.visible = true; ci.bg.visible = true; ci.border.visible = true; ci.scale.set(1); ci.position.set(0, 0); }
  note.renderFlags?.set({ refreshTooltip: true });
}

export function refreshPins() {
  for ( const note of canvas.notes?.placeables ?? [] ) {
    if ( sceneConfig(note.document.parent).enabled ) {
      const pin = attachPin(note);
      if ( pin ) { pin.redraw(); syncLayout(note, pin); }
    } else detachPin(note);
  }
}

export function onDrawNote(note) {
  const pin = attachPin(note);
  if ( !pin ) return;
  // freshly created note (dropped on the map) -> play the drop animation
  const fresh = note.document._mmFresh;
  if ( fresh && Date.now() - fresh < 3000 ) { note.document._mmFresh = 0; pin.drop(); }
}

/** Runs for every client when a note is created; the placeable may or may not be drawn yet. */
export function onCreateNote(doc) {
  doc._mmFresh = Date.now();
  const pin = doc.object?._mmPin;
  if ( pin && !pin.destroyed ) { doc._mmFresh = 0; pin.drop(); }
}

export function onRefreshNote(note) {
  enforce(note);
  const pin = note._mmPin;
  if ( !pin || pin.destroyed ) return;
  pin.redraw();
  syncLayout(note, pin);
}

export function onUpdateNote(doc, changed) {
  const pin = doc.object?._mmPin;
  if ( pin && ("x" in changed || "y" in changed) ) pin.hop();
}
