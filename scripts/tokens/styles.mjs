/**
 * TOKEN EFFECTS: the pure part (no Foundry, no PIXI; node-tested in dev/tokens-fx.test.mjs).
 *
 *  - the style tables of the four effect sets (enter, leave, idle, death) and of the corpse look
 *  - the built-in values of the scene's `tokens` block and the per-token override flag (`flags.moinen-maps.fx`)
 *  - settings resolution: per-token override > per-scene > built-in (`resolveFx`)
 *  - death detection from plain facts (`deadFrom`) and the system HP path (`hpPathFor`)
 *  - seeds (`seedOf`: the same token always gets the same phase / tilt / pixel order on every client)
 *  - the poses: what the token's mesh does at a moment of an effect, as offsets in units of the token (pure curves, so the same
 *    on every client and testable). A pose is { x, y (units of the token's width / height, y down), sx, sy, rot (rad), alpha,
 *    grey (0..1 desaturation), glow (0..1 additive copy) }; the identity is POSE0.
 */

export const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (u) => 1 - (1 - u) ** 3;
const easeIn = (u) => u * u * u;
const easeInOut = (u) => u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
const backOut = (u, c = 1.70158) => 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2;
/** A damped bounce settling at 1 (0 -> overshoot -> 1). */
const spring = (u, f = 3.2, d = 6) => 1 - Math.exp(-d * u) * Math.cos(f * TAU * u * 0.5);

/* ================================================================== tables */

/** Enter: a token placed on the scene (createToken) and a token revealed (hidden -> false). `legacy` = drawn by token-drop.mjs. */
export const ENTER_STYLES = {
  none:        { dur: 0 },
  drop:        { dur: 0.9, legacy: "drop" },     // the bouncy drop (token-drop.mjs Drop)
  classic:     { dur: 0.3, legacy: "pop" },      // the soft reveal pop (token-drop.mjs Drop "pop")
  fade:        { dur: 0.6 },                     // fade in, dust rising round the feet
  pop:         { dur: 0.5 },                     // pop in from nothing with a squash and a few sparkles
  materialise: { dur: 0.85, pixels: true },      // its pixels gather onto it, then it is solid
  warp:        { dur: 0.7 },                     // a vertical beam of light, a flash, the token inside
  slide:       { dur: 0.55 },                    // slides in from the nearest scene edge
  rise:        { dur: 0.7 },                     // rises out of the ground, clods falling off
  portal:      { dur: 0.85 }                     // a swirl of pixels opens, the token spins out of it
};

/** Leave: a token deleted (deleteToken) or hidden (hidden -> true). Drawn on a cosmetic ghost (Foundry destroys / hides the token). */
export const LEAVE_STYLES = {
  none:     { dur: 0 },
  puff:     { dur: 0.6, legacy: "ghost" },       // the squash and inked puffs (token-drop.mjs Ghost)
  dissolve: { dur: 0.95, pixels: true },         // pixel disintegration, the pixels drift up and drop out
  fade:     { dur: 0.6 },                        // fades out, dust round the feet
  shrink:   { dur: 0.45 },                       // stretches, shrinks to a point and pops with a sparkle
  warp:     { dur: 0.65 },                       // a beam takes it up
  sink:     { dur: 0.75 },                       // sinks into the ground
  burst:    { dur: 0.7, pixels: true },          // bursts into confetti of its own colours
  smoke:    { dur: 0.75 },                       // vanishes in a puff of pixel smoke
  slide:    { dur: 0.5 }                         // slides off towards the nearest scene edge
};

/** Idle: continuous and subtle, the mesh transform only. */
export const IDLE_STYLES = {
  none:    {},
  breathe: {},     // scale y 1 <-> 1.02, x the inverse
  bob:     {},     // floats 1-2 px
  sway:    {},     // a slow lean
  wobble:  {},     // a jelly squash
  hover:   {},     // floats higher, its ground shadow pulses
  flicker: {},     // alpha flickers
  glow:    {},     // an additive copy pulses
  wiggle:  {}      // still until hovered, then a quick wiggle
};

/** Death: a token becomes dead / defeated. `end` = the pose it ends in (the corpse "body" look keeps it); `gone` = the body is gone. */
export const DEATH_STYLES = {
  none:         { dur: 0 },
  fall:         { dur: 0.85 },                   // falls over sideways with a bounce and dust
  collapse:     { dur: 0.7 },                    // squashes and sinks
  grey:         { dur: 1.0, skullRise: true },   // fades to grey, a skull rises
  disintegrate: { dur: 1.2, pixels: true, gone: true },   // falls apart into pixels / ashes
  explode:      { dur: 0.7, pixels: true, gone: true },   // bursts into sparkles and a bone-white puff (no gore)
  soul:         { dur: 1.4 },                    // a pale wisp of it rises and fades
  petrify:      { dur: 1.0, cracks: true },      // turns to stone, cracks spread
  ragdoll:      { dur: 0.9 },                    // slumps forward
  melt:         { dur: 1.2, gone: false }        // melts into a puddle
};

/** What a dead token looks like after its animation (and on every later draw, statically). */
export const CORPSE_STYLES = ["body", "mark", "fade", "none"];
/** How a revived token comes back. */
export const REVIVE_STYLES = ["stand", "instant"];
/** When idle plays. */
export const IDLE_WHEN = ["always", "still", "outOfCombat"];

/* ================================================================== settings */

/** The new keys of the scene's `tokens` block (config.mjs DEFAULTS.tokens holds them too; the older keys live only there). */
export const FX_DEFAULTS = {
  enterStyle: "drop",          // placed on the scene (createToken; needs tokens.enabled)
  revealStyle: "classic",      // revealed (hidden -> false; needs tokens.hide)
  leaveStyle: "puff",          // deleted
  hideStyle: "puff",           // hidden (needs tokens.hide)
  speed: 1,                    // tempo of the enter / leave / death animations (0.5 slow .. 2 fast)
  idleStyle: "none", idleAmp: 1, idleSpeed: 1, idleWhen: "still", idleTurn: true,
  death: true, deathStyle: "fall", corpse: "body", revive: "stand",
  deathDefeated: true,         // the combatant's "defeated" toggle counts as death
  deathStatus: true,           // the core "dead" status effect (CONFIG.specialStatusEffects.DEFEATED) counts as death
  deathHp: false,              // hit points at 0 count as death (see hpPathFor)
  hpPath: ""                   // the actor's HP property; "" = the known path of the game system
};

/** Per-token override keys (flags.moinen-maps.fx.<key>) -> the scene key they replace, and the table of valid values. */
export const OVERRIDES = {
  enter:  { key: "enterStyle",  values: ENTER_STYLES },
  reveal: { key: "revealStyle", values: ENTER_STYLES },
  leave:  { key: "leaveStyle",  values: LEAVE_STYLES },
  hide:   { key: "hideStyle",   values: LEAVE_STYLES },
  idle:   { key: "idleStyle",   values: IDLE_STYLES },
  death:  { key: "deathStyle",  values: DEATH_STYLES },
  corpse: { key: "corpse",      values: Object.fromEntries(CORPSE_STYLES.map((c) => [c, {}])) }
};
export const OVERRIDE_KEYS = Object.keys(OVERRIDES);

const NUM = { speed: [0.25, 3], idleAmp: [0, 3], idleSpeed: [0.1, 4], intensity: [0.2, 2] };
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

/** Is `v` a style of the table behind the override / scene key `k`? */
export function validStyle(k, v) {
  const o = OVERRIDES[k] ?? Object.values(OVERRIDES).find((x) => x.key === k);
  return !!o && typeof v === "string" && own(o.values, v);
}

/**
 * The effective token-effect settings of one token: built-in < the scene's `tokens` block < the token's own override flag.
 * Anything invalid on a level (an unknown style, a non-number) is ignored there, so a hand-edited flag never breaks a token.
 * @param {object} [scene]   the scene's resolved `tokens` block (config.mjs sceneConfig(scene).tokens) or a raw stored one
 * @param {object} [token]   the token's `flags.moinen-maps.fx`
 * @param {object} [builtin] defaults (FX_DEFAULTS merged with the older keys)
 */
export function resolveFx(scene = {}, token = {}, builtin = FX_DEFAULTS) {
  const out = { ...builtin };
  for ( const [k, v] of Object.entries(scene ?? {}) ) {
    if ( v === undefined || v === null ) continue;
    if ( k in NUM ) { const n = Number(v); if ( Number.isFinite(n) ) out[k] = clamp(n, ...NUM[k]); continue; }
    if ( Object.values(OVERRIDES).some((o) => o.key === k) ) { if ( validStyle(k, v) ) out[k] = v; continue; }
    if ( k === "idleWhen" ) { if ( IDLE_WHEN.includes(v) ) out[k] = v; continue; }
    if ( k === "revive" ) { if ( REVIVE_STYLES.includes(v) ) out[k] = v; continue; }
    out[k] = v;
  }
  for ( const k of OVERRIDE_KEYS ) if ( own(token, k) && validStyle(k, token[k]) ) out[OVERRIDES[k].key] = token[k];
  return out;
}

/** Which overrides a token flag really holds (valid ones), e.g. for the per-token list. */
export const overridesOf = (flag) => Object.fromEntries(OVERRIDE_KEYS.filter((k) => own(flag, k) && validStyle(k, flag[k])).map((k) => [k, flag[k]]));

/* ================================================================== death */

/** The HP property of known game systems (hit points that reach 0). Invincible: `derived.health` (0 = broken). */
export const HP_PATHS = {
  invincible: "system.derived.health.value",
  dnd5e: "system.attributes.hp.value",
  pf2e: "system.attributes.hp.value",
  pf1: "system.attributes.hp.value",
  a5e: "system.attributes.hp.value",
  sw5e: "system.attributes.hp.value",
  swade: "system.wounds.value"     // wounds count up; not used for "<= 0" (see hpDead)
};
export const hpPathFor = (systemId, custom = "") => (custom && String(custom).trim()) || HP_PATHS[systemId] || "";

/** A numeric HP at 0 or below counts as death; a missing or non-numeric value never does. SWADE wounds count up and are skipped. */
export function hpDead(hp, path = "") {
  if ( /wounds/.test(path) ) return false;
  const n = typeof hp === "number" ? hp : (typeof hp === "string" && hp.trim() !== "" ? Number(hp) : NaN);
  return Number.isFinite(n) && n <= 0;
}

/**
 * Is a token dead by the rule of its scene? `facts` = { defeated (combatant flag), status (has the core dead status), hp (value or
 * undefined), hpPath }. `rule` = the resolved settings (deathDefeated, deathStatus, deathHp).
 */
export function deadFrom(facts = {}, rule = FX_DEFAULTS) {
  if ( rule.deathDefeated && facts.defeated ) return true;
  if ( rule.deathStatus && facts.status ) return true;
  if ( rule.deathHp && hpDead(facts.hp, facts.hpPath) ) return true;
  return false;
}

/** What a state change means: "die" (play the death), "revive", or null (no change). `prev` undefined = first sight (never animated). */
export function deathTransition(prev, now) {
  if ( prev === undefined || prev === now ) return null;
  return now ? "die" : "revive";
}

/* ================================================================== seeds */

/** A stable 31-bit seed of a string (a token id): the same on every client and every load. */
export function seedOf(s) {
  let h = 2166136261;
  for ( const c of String(s ?? "") ) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return (h >>> 0) & 0x7fffffff;
}
/** 0..1 from a seed and a salt (deterministic). */
export function rand01(seed, salt = 0) {
  let h = (Math.imul(seed | 0, 374761393) + Math.imul(salt | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** The idle phase (0..TAU) of a token: desynchronises tokens with the same idle. */
export const phaseOf = (id) => rand01(seedOf(id), 7) * TAU;
/** Which way a token falls / tilts (-1 | 1). */
export const tiltOf = (id) => rand01(seedOf(id), 11) < 0.5 ? -1 : 1;

/** Stagger a burst: index -> delay (s); null past the cap (more tokens than that at once are not animated). */
export const MAX_BURST = 25;
export function burstDelay(i, step = 0.075, max = 0.75, cap = MAX_BURST) { return i >= cap ? null : Math.min(i * step, max); }

/** The scene edge nearest to a token (for slide in / off): unit direction from the token towards it. */
export function nearestEdge(cx, cy, rect) {
  const d = [[cx - rect.x, -1, 0], [rect.x + rect.width - cx, 1, 0], [cy - rect.y, 0, -1], [rect.y + rect.height - cy, 0, 1]];
  d.sort((a, b) => a[0] - b[0]);
  return { dx: d[0][1], dy: d[0][2], dist: Math.max(0, d[0][0]) };
}

/* ================================================================== poses */

export const POSE0 = Object.freeze({ x: 0, y: 0, sx: 1, sy: 1, rot: 0, alpha: 1, grey: 0, glow: 0 });
export const pose = (p = {}) => ({ ...POSE0, ...p });
/** Write `p` into `out` (reuse an object; no allocation per frame). */
export function setPose(out, p) { out.x = p.x ?? 0; out.y = p.y ?? 0; out.sx = p.sx ?? 1; out.sy = p.sy ?? 1; out.rot = p.rot ?? 0; out.alpha = p.alpha ?? 1; out.grey = p.grey ?? 0; out.glow = p.glow ?? 0; return out; }

/**
 * The token at moment u (0..1) of an ENTER style. ctx = { tilt, dir: {dx, dy} (slide), k (intensity) }. At u = 1 every style is
 * the identity (the token as Foundry draws it).
 */
export function enterPose(style, u, ctx = {}, out = pose()) {
  u = clamp(u, 0, 1);
  const k = ctx.k ?? 1, tilt = ctx.tilt ?? 1;
  setPose(out, POSE0);
  switch ( style ) {
    case "fade": out.alpha = easeOut(u); out.y = 0.04 * (1 - easeOut(u)); break;
    case "pop": {
      // nothing -> overshoot with a squash (wide and short) -> a stretch -> rest
      const s = u < 0.45 ? backOut(u / 0.45, 2.4) : 1;
      const q = u < 0.45 ? 0 : Math.exp(-7 * (u - 0.45)) * Math.sin((u - 0.45) * 22) * 0.16 * k;
      out.sx = Math.max(0, s) * (1 + q); out.sy = Math.max(0, s) * (1 - q);
      out.alpha = clamp(u / 0.12, 0, 1); break;
    }
    case "materialise": out.alpha = u < 0.7 ? 0 : easeOut((u - 0.7) / 0.3); out.glow = u < 0.7 ? 0 : (1 - (u - 0.7) / 0.3) * 0.8; break;
    case "warp": {
      // hidden in the beam, appears stretched up at the flash, settles
      const a = (u - 0.35) / 0.65;
      out.alpha = u < 0.35 ? 0 : clamp(a * 3, 0, 1);
      out.sy = u < 0.35 ? 1 : 1 + 0.5 * (1 - easeOut(clamp(a, 0, 1))) * k; out.sx = 1 / Math.sqrt(out.sy);
      out.glow = u < 0.35 ? 0 : (1 - clamp(a * 1.6, 0, 1)); break;
    }
    case "slide": {
      const e = easeOut(u), dx = ctx.dir?.dx ?? 0, dy = ctx.dir?.dy ?? 0, far = 1.6;
      out.x = dx * far * (1 - e); out.y = dy * far * (1 - e);
      out.alpha = clamp(u / 0.35, 0, 1);
      out.rot = -dx * 0.12 * (1 - e) * k; break;
    }
    case "rise": {
      // grows up out of the ground: height from 0, a little overshoot, wobble
      const e = u < 0.75 ? backOut(u / 0.75, 1.6) : 1;
      out.sy = Math.max(0.001, e); out.sx = 1 + 0.25 * (1 - clamp(u / 0.75, 0, 1));
      out.alpha = clamp(u / 0.1, 0, 1); out.rot = 0.05 * tilt * Math.sin(u * 18) * (1 - u); break;
    }
    case "portal": {
      const a = clamp((u - 0.3) / 0.7, 0, 1), e = backOut(a, 1.4);
      out.sx = out.sy = Math.max(0, e); out.rot = tilt * (1 - easeOut(a)) * TAU * 0.75;
      out.alpha = a > 0 ? clamp(a * 4, 0, 1) : 0; out.glow = a > 0 ? (1 - a) * 0.6 : 0; break;
    }
    default: break;   // none / legacy: identity
  }
  if ( u >= 1 ) setPose(out, POSE0);   // every style lands exactly on the token as Foundry draws it
  return out;
}

/** The ghost at moment u (0..1) of a LEAVE style. At u = 1 the ghost is gone (alpha 0 or size 0). */
export function leavePose(style, u, ctx = {}, out = pose()) {
  u = clamp(u, 0, 1);
  const k = ctx.k ?? 1, tilt = ctx.tilt ?? 1;
  setPose(out, POSE0);
  switch ( style ) {
    case "dissolve": out.alpha = u < 0.15 ? 1 - u / 0.15 * 0.2 : u < 0.3 ? 0.8 * (1 - (u - 0.15) / 0.15) : 0; out.glow = u < 0.3 ? u / 0.3 * 0.5 : 0; break;
    case "fade": out.alpha = 1 - u; out.y = -0.03 * easeOut(u); break;
    case "shrink": {
      // a quick stretch up (anticipation), then shrinks to nothing
      const a = 0.25;
      if ( u < a ) { const v = u / a; out.sy = 1 + 0.18 * k * v; out.sx = 1 - 0.1 * k * v; }
      else { const v = easeIn((u - a) / (1 - a)); out.sy = (1 + 0.18 * k) * (1 - v); out.sx = (1 - 0.1 * k) * (1 - v); }
      out.glow = u > 0.6 ? (u - 0.6) / 0.4 : 0; out.alpha = u > 0.92 ? (1 - u) / 0.08 : 1; break;
    }
    case "warp": {
      const a = clamp((u - 0.15) / 0.45, 0, 1);
      out.sy = 1 + 1.4 * easeIn(a) * k; out.sx = Math.max(0, 1 - easeIn(a)); out.y = -0.5 * easeIn(a);
      out.glow = clamp(u / 0.25, 0, 1) * (1 - a * 0.3); out.alpha = u > 0.6 ? 0 : 1; break;
    }
    case "sink": {
      const e = easeIn(u);
      out.sy = Math.max(0, 1 - e); out.sx = 1 + 0.12 * Math.sin(u * 30) * (1 - u) * k; out.alpha = u > 0.95 ? 0 : 1; break;
    }
    case "burst": { const a = clamp(u / 0.18, 0, 1); out.sx = out.sy = 1 + 0.15 * a * k; out.alpha = u < 0.18 ? 1 : 0; out.glow = a * 0.7; break; }
    case "smoke": out.alpha = u < 0.25 ? 1 : Math.max(0, 1 - (u - 0.25) / 0.2); out.sy = 1 - 0.1 * clamp(u / 0.25, 0, 1); out.sx = 1 + 0.06 * clamp(u / 0.25, 0, 1); break;
    case "slide": {
      const e = easeIn(u), dx = ctx.dir?.dx ?? 0, dy = ctx.dir?.dy ?? 0, far = 1.6;
      out.x = dx * far * e; out.y = dy * far * e; out.rot = dx * 0.12 * e * k; out.alpha = 1 - clamp((u - 0.6) / 0.4, 0, 1); break;
    }
    case "puff": default: out.alpha = 1 - u; break;
  }
  if ( u >= 1 ) out.alpha = 0;
  void tilt;
  return out;
}

/** The end pose of a death style (where the animation leaves the body; the "body" corpse keeps it). */
export function deathEnd(style, tilt = 1) {
  switch ( style ) {
    case "fall": return pose({ rot: tilt * Math.PI * 0.47, sy: 0.96 });
    case "collapse": return pose({ sx: 1.16, sy: 0.52 });
    case "ragdoll": return pose({ rot: tilt * 0.42, sx: 1.06, sy: 0.82 });
    case "melt": return pose({ sx: 1.32, sy: 0.24 });
    case "disintegrate": case "explode": return pose({ alpha: 0 });
    default: return pose();
  }
}

/** The body at moment u (0..1) of a DEATH style; at u = 1 it is deathEnd() with grey 1 (the colour drains as it dies). */
export function deathPose(style, u, ctx = {}, out = pose()) {
  u = clamp(u, 0, 1);
  const k = ctx.k ?? 1, tilt = ctx.tilt ?? 1;
  setPose(out, POSE0);
  const g = easeInOut(clamp((u - 0.15) / 0.75, 0, 1));
  out.grey = g;
  switch ( style ) {
    case "fall": {
      // a stagger back (anticipation), then it topples with a bounce on the ground
      const a = 0.18;
      if ( u < a ) { out.rot = -tilt * 0.12 * k * easeOut(u / a); out.sy = 1 + 0.05 * (u / a); }
      else {
        const v = (u - a) / (1 - a), end = Math.PI * 0.47;
        const fallU = clamp(v / 0.55, 0, 1), land = v > 0.55 ? (v - 0.55) / 0.45 : 0;
        const r = v <= 0.55 ? -0.12 * k + (end + 0.12 * k) * easeIn(fallU) : end - 0.16 * Math.exp(-6 * land) * Math.abs(Math.sin(land * 9));
        out.rot = tilt * r; out.sy = v > 0.55 ? 0.96 + 0.04 * Math.exp(-8 * land) * Math.cos(land * 18) : 1;
      }
      break;
    }
    case "collapse": {
      const e = spring(u, 1.6, 5);
      out.sy = lerp(1, 0.52, e); out.sx = lerp(1, 1.16, e); break;
    }
    case "grey": out.alpha = 1 - 0.15 * g; break;
    case "disintegrate": out.alpha = u < 0.25 ? 1 : Math.max(0, 1 - (u - 0.25) / 0.35); out.sy = 1 - 0.1 * clamp(u / 0.6, 0, 1); break;
    case "explode": {
      // swells, trembles, gone in a flash
      const a = clamp(u / 0.3, 0, 1);
      out.sx = out.sy = 1 + 0.18 * easeIn(a) * k; out.rot = 0.04 * Math.sin(u * 90) * a * k;
      out.glow = a; out.alpha = u < 0.3 ? 1 : 0; out.grey = 0; break;
    }
    case "soul": out.alpha = 1 - 0.1 * g; out.sy = 1 - 0.04 * g; break;   // the wisp is a separate copy (runtime)
    case "petrify": out.rot = u < 0.5 ? 0.02 * Math.sin(u * 70) * (1 - u * 2) * k : 0; out.grey = easeOut(clamp(u / 0.6, 0, 1)); break;
    case "ragdoll": {
      const e = spring(u, 2.2, 4.5);
      out.rot = tilt * 0.42 * e; out.sy = lerp(1, 0.82, e); out.sx = lerp(1, 1.06, e); break;
    }
    case "melt": {
      const e = easeIn(clamp(u / 0.9, 0, 1));
      out.sy = lerp(1, 0.24, e); out.sx = lerp(1, 1.32, e) + 0.03 * Math.sin(u * 25) * (1 - u); break;
    }
    default: out.grey = 0; break;
  }
  if ( u >= 1 ) { setPose(out, deathEnd(style, tilt)); out.grey = DEATH_STYLES[style]?.dur ? 1 : 0; }
  return out;
}

/**
 * The settled look of a dead token (applied statically on every draw, so a reload or a scene switch never replays the death):
 * { pose, grey, alpha, skull, cracks }. `gm` = the viewer is a GM (a faded corpse stays faintly visible to the GM so it can be picked).
 */
export function corpseLook(style, corpse, tilt = 1, gm = false) {
  const d = DEATH_STYLES[style] ?? DEATH_STYLES.fall;
  if ( corpse === "none" ) return { pose: pose(), skull: false, cracks: false };
  if ( corpse === "fade" ) return { pose: pose({ alpha: gm ? 0.22 : 0, grey: 1 }), skull: false, cracks: false };
  if ( corpse === "mark" ) return { pose: pose({ grey: 1, alpha: 0.85 }), skull: true, cracks: !!d.cracks };
  // body: the end pose of the animation, greyed; a body that is gone leaves faint remains
  const p = deathEnd(style, tilt);
  p.grey = 1;
  p.alpha = d.gone ? 0.35 : 0.85;
  return { pose: p, skull: true, cracks: !!d.cracks };
}

/** Standing up again: from the corpse pose `from` back to the identity, with a little hop at the end. */
export function revivePose(from, u, out = pose()) {
  u = clamp(u, 0, 1);
  const e = easeOut(u), hop = u > 0.6 ? Math.sin((u - 0.6) / 0.4 * Math.PI) : 0;
  out.x = lerp(from.x, 0, e); out.y = lerp(from.y, 0, e) - 0.08 * hop;
  out.sx = lerp(from.sx, 1, e); out.sy = lerp(from.sy, 1, e) + 0.06 * hop; out.rot = lerp(from.rot, 0, e);
  out.alpha = lerp(Math.max(from.alpha, 0.35), 1, e); out.grey = lerp(from.grey, 0, e); out.glow = 0.5 * hop;
  return out;
}

/**
 * The idle offset at time t (s) for a phase. amp scales the motion (1 = the designed subtle amount), speed the tempo. `hover` =
 * the pointer is over the token (wiggle). Returns the pose and, for "hover", the ground shadow pulse in `out.shadow` (0..1).
 */
export function idlePose(style, t, phase = 0, amp = 1, speed = 1, out = pose(), hover = false) {
  setPose(out, POSE0); out.shadow = 0;
  const w = TAU * 0.28 * speed, s = Math.sin(t * w + phase);
  switch ( style ) {
    case "breathe": out.sy = 1 + 0.02 * amp * (0.5 + 0.5 * s); out.sx = 1 - 0.008 * amp * (0.5 + 0.5 * s); break;
    case "bob": out.y = -0.015 * amp * (0.5 + 0.5 * s); break;
    case "sway": out.rot = 0.035 * amp * Math.sin(t * w * 0.7 + phase); break;
    case "wobble": { const q = 0.025 * amp * Math.sin(t * w * 2.2 + phase); out.sy = 1 + q; out.sx = 1 - q * 0.8; break; }
    case "hover": out.y = -0.04 * amp - 0.02 * amp * (0.5 + 0.5 * s); out.shadow = 0.5 + 0.5 * s; break;
    case "flicker": {
      // mostly steady, now and then two quick dips (deterministic in t)
      const c = Math.floor(t * 3 * speed + phase), f = rand01(c | 0, 3) < 0.18 ? 0.55 + 0.3 * rand01(c | 0, 5) : 1;
      out.alpha = 1 - (1 - f) * Math.min(1, amp); break;
    }
    case "glow": out.glow = 0.25 * amp * (0.5 + 0.5 * s); break;
    case "wiggle": if ( hover ) out.rot = 0.08 * amp * Math.sin(t * 26) ; break;
    default: break;
  }
  return out;
}

/** Is a pose the identity (nothing to draw)? */
export const isIdentity = (p) => Math.abs(p.x) < 1e-4 && Math.abs(p.y) < 1e-4 && Math.abs(p.sx - 1) < 1e-4 && Math.abs(p.sy - 1) < 1e-4
  && Math.abs(p.rot) < 1e-4 && Math.abs(p.alpha - 1) < 1e-4 && p.grey < 1e-3 && p.glow < 1e-3;

/** Duration of a style at a speed (s). */
export function durationOf(table, style, speed = 1) { return (table[style]?.dur ?? 0) / clamp(Number(speed) || 1, 0.25, 3); }

/* ================================================================== small pixel art */

/** A 7x7 skull for the corpse badge: 1 = bone, 2 = ink (eyes, nose, teeth gaps). */
export const SKULL = [
  "0111110",
  "1111111",
  "1221221",
  "1111111",
  "0112110",
  "0121210",
  "0011100"
];

/** Crack lines over a petrified token, in a unit square: polylines from a seed (deterministic). */
export function crackLines(seed, n = 4) {
  const out = [];
  for ( let i = 0; i < n; i++ ) {
    let x = 0.2 + 0.6 * rand01(seed, i * 13 + 1), y = 0.15 + 0.7 * rand01(seed, i * 13 + 2), a = rand01(seed, i * 13 + 3) * TAU;
    const pts = [[x, y]], steps = 3 + Math.floor(rand01(seed, i * 13 + 4) * 3);
    for ( let j = 0; j < steps; j++ ) {
      a += (rand01(seed, i * 13 + 5 + j) - 0.5) * 1.4;
      x = clamp(x + Math.cos(a) * 0.09, 0.05, 0.95); y = clamp(y + Math.sin(a) * 0.09, 0.05, 0.95);
      pts.push([x, y]);
    }
    out.push(pts);
  }
  return out;
}
