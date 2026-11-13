/* LETR tools: the engine-wide preferences (one set for every caller, whichever module carries the engine) and what they do to a
   word. Pure: no DOM, no Foundry. tools.mjs registers the settings and feeds their values in; the engine runs the filters
   (engine.mjs `ext`): `resolveOpts` on the call's options, `filterPlan` on the finished plan.

   Settings (namespace "moinen-letters", README "Settings"):
     enabled      master switch: off = no lettering at all on this client (play returns a handle that is already over)
     scale        size multiplier (0.5-2.5) applied AFTER the legibility clamp, so it also grows words held at the floor
     motion       auto (the OS reduced-motion switch) | full (the caller decides) | gentle (smaller moves, no smear frames) | reduced
     flashes      impact (flash) frames on or off
     photosafe    photosensitivity guard: at most 2 flash frames per second on this client, none on a big word, no misregistration
                  flicker (colour plates that jump between drawings)
     palette      mood (the moods' own colours) | contrast (white / yellow letters, black ink, heavier outline, no texture) |
                  cvd (colour-blind safe: the colour families remapped to the Okabe-Ito set, no red-green pairs)
     announce     the lettered word is read to screen readers (a polite live region; the layers stay aria-hidden)
     limitScreen, limitWorld   words alive at once per space */

export const SETTINGS = {
  enabled:     { type: "bool", default: true },
  scale:       { type: "num", default: 1, min: 0.5, max: 2.5, step: 0.05 },
  motion:      { type: "pick", default: "auto", choices: ["auto", "full", "gentle", "reduced"] },
  flashes:     { type: "bool", default: true },
  photosafe:   { type: "bool", default: true },
  palette:     { type: "pick", default: "mood", choices: ["mood", "contrast", "cvd"] },
  announce:    { type: "bool", default: true },
  limitScreen: { type: "num", default: 16, min: 1, max: 32, step: 1 },
  limitWorld:  { type: "num", default: 48, min: 4, max: 96, step: 1 }
};
export const DEFAULTS = Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default]));

/* a value as the setting allows it (a stored value from an older build or a hand-edited one never breaks a word) */
export function clean(key, v) {
  const d = SETTINGS[key];
  if ( !d ) return undefined;
  if ( d.type === "bool" ) return typeof v === "boolean" ? v : d.default;
  if ( d.type === "pick" ) return d.choices.includes(v) ? v : d.default;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(d.min, Math.min(d.max, n)) : d.default;
}
export const cleanAll = (o = {}) => Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, clean(k, o[k])]));

/* ---------- photosensitivity ---------- */
export const PHOTO = {
  maxPerSec: 2,         // flash frames per rolling second on this client (WCAG 2.3.1 allows 3; one in reserve for other effects)
  bigVh: 0.2,           // a flash frame on a word taller than this share of the viewport height is never shown (large-area flash)
  windowMs: 1000
};
/* the flash frames of a plan: [{ i, t }] (index into ent+hold+exit, ms from the word's start) */
export function flashTimes(plan, TICK) {
  const tl = plan.timeline, all = [...tl.ent, ...tl.hold, ...tl.exit], out = [];
  let t = 0;
  for ( let i = 0; i < all.length; i++ ) { if ( all[i].impact ) out.push({ i, t }); t += all[i].ticks * TICK; }
  return out;
}
/* a flash frame becomes an ordinary drawing (same length: the timing of the word does not change) */
function unflash(p, m) { p.impact = false; p.misreg = m; }

/* ---------- motion ---------- */
/* damp every move of the word's pictures toward rest by k (gentle motion): positions, turns and scales; letters keep showing */
export function damp(plan, k) {
  const tl = plan.timeline;
  const s = (v) => (Number.isFinite(v) ? 1 + (v - 1) * k : v), z = (v) => (Number.isFinite(v) ? v * k : v);
  for ( const p of [...tl.ent, ...tl.hold, ...tl.exit] ) {
    p.g.x = z(p.g.x); p.g.y = z(p.g.y); p.g.r = z(p.g.r); p.g.s = s(p.g.s); p.g.sx = s(p.g.sx); p.g.sy = s(p.g.sy);
    for ( const l of p.letters ) { l.x = z(l.x); l.y = z(l.y); l.r = z(l.r); l.s = s(l.s); l.sx = s(l.sx); l.sy = s(l.sy); }
    p.smear = null;
  }
  return plan;
}
/* the reduced flag a word gets: the strongest reduction wins (the caller's own Motion setting, this client's engine setting, the OS) */
export function reducedFor(motion, callerReduced, osReduced) {
  if ( motion === "reduced" ) return true;
  if ( callerReduced === true ) return true;
  if ( motion === "full" ) return callerReduced ?? false;
  return callerReduced ?? !!osReduced;   // auto, gentle
}

/* ---------- palettes ---------- */
const OI = { orange: "#e69f00", sky: "#56b4e9", green: "#009e73", yellow: "#f0e442", blue: "#0072b2", red: "#d55e00", pink: "#cc79a7" };
/* the high-contrast palette: light fill, black ink and extrusion, black outer line */
export const CONTRAST = { fill: ["#ffffff", "#fff8b8", "#ffe14a"], ext: "#000000", out2: "#000000", ink: "#000000" };
/* colour-blind safe families (Okabe & Ito 2008): every family keeps its meaning by hue groups that stay apart for protan, deutan and
   tritan viewers; red-green pairs (blood vs mint, toxic vs hot) become vermillion vs blue / yellow vs purple */
const cv = (fill, ext) => ({ fill, ext, out2: "#ffffff", ink: "#1b1020" });
export const CVD = {
  hot: cv(["#fff3b0", OI.yellow, OI.orange], "#5a3a00"), ember: cv(["#ffe2a0", OI.orange, "#a35a00"], "#3a2000"),
  rust: cv(["#ffd2a8", OI.red, "#8a3a00"], "#331200"), earth: cv(["#f3dcb0", "#c79a4a", "#7a5420"], "#3a2a10"),
  primary: cv(["#9fd8ff", OI.blue, "#003f66"], "#001a33"), punch: cv(["#ffffff", "#f0e8ff", "#c8b8e8"], "#2a2350"),
  pop: cv(["#ffe9f5", OI.pink, "#8a3a6a"], "#3a0a2a"), ice: cv(["#ffffff", "#bfe6ff", OI.sky], "#0a2c4a"),
  bone: cv(["#fffdf2", "#efe4c4", "#c4a979"], "#4a3420"), stone: cv(["#eeeeee", "#a8a8a8", "#5e5e5e"], "#222222"),
  toxic: cv(["#fbf6b0", OI.yellow, "#9a8a00"], "#3a3300"), beast: cv(["#f5d8ea", OI.pink, "#7a2a5a"], "#2a0a20"),
  air: cv(["#ffffff", "#cfe9fa", OI.sky], "#123a5a"), volt: cv(["#ffffff", OI.yellow, OI.orange], "#3a2a00"),
  plasma: cv(["#f5e0ff", OI.pink, "#5a2a8a"], "#200a40"), gold: cv(["#fffbe0", OI.yellow, "#b88a00"], "#4a3000"),
  soft: cv(["#ffffff", "#ececf2", "#bcbccc"], "#3a3a50"), blood: cv(["#ffc9a8", OI.red, "#7a2a00"], "#2a0a00"),
  bruise: cv(["#e8d8ff", "#9a7ad8", "#4a2a8a"], "#1e0a34"), mint: cv(["#e0f3ff", OI.sky, OI.blue], "#002a4a"),
  water: cv(["#e8f6ff", OI.sky, OI.blue], "#002a4a"), dull: cv(["#ececec", "#a6a6a6", "#666666"], "#2a2a2a"),
  inv: cv(["#fffdf2", "#f0ead0", "#d8cfa8"], "#1c3b7a")   // LOOK: the Invincible style's family (pale faces, a deep block)
};
const CVD_FALLBACK = cv(["#ffffff", OI.sky, OI.blue], "#002a4a");

/* ---------- the hand: a pinned look given as the handle's id string (F18) or a partial object ---------- */
export const HAND_KEYS = ["font", "treat", "env", "colorFam", "outline", "fill"];
export function handFrom(h) {
  if ( h == null ) return null;
  if ( typeof h === "string" ) {
    const parts = h.split("/");
    const o = {};
    HAND_KEYS.forEach((k, i) => { if ( parts[i] ) o[k] = parts[i]; });
    return Object.keys(o).length ? o : null;
  }
  return typeof h === "object" ? h : null;
}
export const handId = (h) => HAND_KEYS.map((k) => h[k]).join("/");

/* ---------- options: a saved style under the call, the hand id string, the engine-wide preferences ---------- */
/* returns the options the engine plays (a new object; never the caller's), or null when lettering is off on this client */
export function resolveOpts(opts, prefs, styles = {}, env = {}) {
  if ( !prefs.enabled && !opts?.force ) return null;
  let o = { ...(opts ?? {}) };
  const st = typeof o.style === "string" ? styles[o.style] : (o.style && typeof o.style === "object" ? o.style : null);
  if ( st ) {
    const { label, name, ...rest } = st;
    o = { ...rest, ...o, sound: o.sound ?? rest.sound, hand: o.hand ?? rest.hand };
    if ( rest.font && !o.hand ) o.hand = { font: rest.font };
  }
  if ( o.font && typeof o.font === "string" ) o.hand = { ...(handFrom(o.hand) ?? {}), font: o.font };
  if ( o.hand != null ) {
    const h = handFrom(o.hand);
    if ( h ) {
      o.hand = h;
      /* a hand that names a colour family but carries no palette: the palette is drawn from that family (plan filter) */
      if ( h.colorFam && !h.pal && !o.palette ) o.palette = h.colorFam;
    } else delete o.hand;
  }
  o.reduced = reducedFor(prefs.motion, opts?.reduced, env.osReduced);
  o._k = prefs.scale;
  return o;
}

/* the plan as this client shows it: palette, gentle motion, flash frames (photosensitivity guard), misregistration flicker.
   ctx = { prefs, colors (the COLORS table), rngPick(seed, n), flashLog (array of past flash times, ms, this client), now (ms),
           t0 (the word's start on that clock), capPx (the word's cap height on screen, CSS px), vh (viewport height), preview } */
export function filterPlan(plan, opts, ctx) {
  const P = ctx.prefs, H = plan.hand;
  /* a palette by family name: one of the family's palettes, the same one on every client (from the seed) */
  if ( opts.palette && ctx.colors?.[opts.palette] && !(Array.isArray(opts.colors) && opts.colors.length) ) {
    const fam = ctx.colors[opts.palette], pal = fam[(plan.seed >>> 0) % fam.length];
    H.colorFam = opts.palette;
    H.pal = { ...pal, fill: pal.fill.slice(), out2: Array.isArray(pal.out2) ? pal.out2[(plan.seed >>> 3) % pal.out2.length] : pal.out2 };
    H.ink = pal.ink ?? H.ink;
  }
  const own = Array.isArray(opts.colors) && opts.colors.length;
  if ( P.palette === "contrast" && !H.hiContrast ) {   // once per hand (a stream pins the filtered hand of its first syllable)
    H.hiContrast = true;
    H.pal = { ...H.pal, fill: own ? H.pal.fill : CONTRAST.fill.slice(), ext: CONTRAST.ext, out2: CONTRAST.out2 };
    H.ink = CONTRAST.ink; H.pal.ink = CONTRAST.ink;
    H.inkW *= 1.3; H.out2W = Math.max(H.out2W, 0.06); H.tex = "none"; H.hatch = false;
    if ( H.outline === "inner" ) H.outline = "color";
    if ( H.shadow ) H.shadow = { ...H.shadow, a: Math.max(H.shadow.a, 0.6) };
  } else if ( P.palette === "cvd" && !own ) {
    const c = CVD[H.colorFam] ?? CVD_FALLBACK;
    H.pal = { ...H.pal, fill: c.fill.slice(), ext: c.ext, out2: H.pal.out2 === "#1b1020" ? "#1b1020" : c.out2 };
  }
  H.id = handId(H);
  if ( P.motion === "gentle" && !opts.reduced ) damp(plan, 0.45);
  /* flash frames and colour plates */
  const tl = plan.timeline, all = [...tl.ent, ...tl.hold, ...tl.exit];
  const plates = all.filter((p) => !p.impact).map((p) => p.misreg).filter((m) => m > 0);
  const steady = plates.length ? Math.min(...plates) : 0;
  if ( P.photosafe ) for ( const p of all ) if ( !p.impact ) p.misreg = steady;   // no plates jumping between drawings
  const fl = flashTimes(plan, ctx.TICK ?? 1000 / 24);
  if ( fl.length ) {
    const big = (ctx.capPx ?? 0) > (ctx.vh ?? Infinity) * PHOTO.bigVh;
    const log = ctx.flashLog ?? [];
    for ( const f of fl ) {
      const p = all[f.i];
      if ( !P.flashes || (P.photosafe && big) ) { unflash(p, steady); continue; }
      if ( !P.photosafe || ctx.preview ) continue;
      const at = (ctx.t0 ?? 0) + f.t;
      const old = (ctx.now ?? at) - PHOTO.windowMs * 2;
      for ( let i = log.length - 1; i >= 0; i-- ) if ( log[i] < old ) log.splice(i, 1);
      if ( log.filter((x) => Math.abs(x - at) < PHOTO.windowMs).length >= PHOTO.maxPerSec ) unflash(p, steady);
      else log.push(at);
    }
  }
  return plan;
}

/* ---------- styles (named saved looks): what a style may carry ---------- */
export const STYLE_KEYS = ["label", "mood", "sound", "palette", "colors", "font", "hand", "in", "out", "holdKind", "tempo", "hold", "magnitude",
  "scale", "space", "layer", "fit", "rotation", "pixel", "look", "backdrop", "arrange"];   // LOOK: look (incl. look.style), backdrop, arrange
export function cleanStyle(s) {
  if ( !s || typeof s !== "object" ) return null;
  const o = {};
  for ( const k of STYLE_KEYS ) if ( s[k] !== undefined && s[k] !== null && s[k] !== "" ) o[k] = JSON.parse(JSON.stringify(s[k]));
  return o;
}
export const STYLE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.:-]{0,47}$/u;
