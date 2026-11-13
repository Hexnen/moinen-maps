/* LETR tools: the authoring API. Module authors, the GM (designer window, macros) and later moinen-pixel-vfx (a style per power)
   add their own moods, palettes, fonts and named styles at runtime. Pure except registerFont's loading (fetch + the engine's font
   bank). The tables live in design.mjs (MOODS, COLORS, FONTS) and are extended in place, so every plan sees them at once.

     L.registerMood("frost", { extends: "crack", label: "ice cracking", sound: { pitch: 0.3 }, colors: { ice: 4 } })
     L.registerPalette("venom", [["#e8ffb0", "#9be22a", "#2f6e1f"]])            // or full { fill, ext, out2: [..], ink } entries
     await L.registerFont("grit", { url: "modules/x/fonts/Grit.ttf", sharp: 0.8 })
     L.registerStyle("thor-hammer", { mood: "zap", palette: "volt", hand: "bangers/jag/zig/volt/sticker/vgrad", magnitude: 0.9 })
     L.play("KRAKA-THOOM!", { style: "thor-hammer", space: "world", at: token })

   Styles registered here live on this client for this session; L.saveStyle (GM) also stores them in the world (tools.mjs). */
import { MOODS, MOOD_IDS, COLORS, FONTS } from "./design.mjs";
import { cleanStyle, STYLE_NAME } from "./prefs.mjs";

/* names that would collide with Object.prototype members (BUGH F15) or the auto mood */
const RESERVED = new Set(["auto", "constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
  "toLocaleString", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);
export const ID = /^[a-z][a-z0-9_-]{0,31}$/;
const okId = (id) => typeof id === "string" && ID.test(id) && !RESERVED.has(id);
const isHex = (c) => typeof c === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
const SOUND_KEYS = ["loud", "sharp", "long", "pitch", "rough", "peak"];
const WEIGHTS = ["fonts", "treat", "env", "colors", "tex", "in", "hold", "out"];

/* weights: { name: positive number }, names known to the engine (an unknown font / colour family would break a plan) */
function weights(w, known, what) {
  if ( !w || typeof w !== "object" ) return null;
  const o = {};
  for ( const [k, v] of Object.entries(w) ) {
    if ( known && !Object.hasOwn(known, k) ) throw new Error(`LETR | unknown ${what} "${k}"`);
    if ( Number.isFinite(v) && v >= 0 ) o[k] = v;
  }
  if ( !Object.values(o).some((v) => v > 0) ) throw new Error(`LETR | ${what}: at least one weight above 0`);
  return o;
}

/* a mood: everything optional except where nothing is inherited; `extends` copies an existing mood first */
export function registerMood(id, def = {}) {
  if ( !okId(id) ) throw new Error(`LETR | mood id "${id}": a-z, 0-9, _ or -, starting with a letter, not a reserved name`);
  const base = def.extends ? MOODS[def.extends] : MOODS.impact;
  if ( def.extends && !Object.hasOwn(MOODS, def.extends) ) throw new Error(`LETR | mood "${def.extends}" to extend does not exist`);
  const m = JSON.parse(JSON.stringify(base));
  m.label = String(def.label ?? m.label);
  if ( def.sound ) for ( const k of SOUND_KEYS ) if ( Number.isFinite(def.sound[k]) ) m.sound[k] = k === "pitch" ? Math.max(-1, Math.min(1, def.sound[k])) : Math.max(0, Math.min(1, def.sound[k]));
  const known = { fonts: FONTS, colors: COLORS };
  for ( const k of WEIGHTS ) if ( def[k] ) m[k] = weights(def[k], known[k] ?? null, k);
  if ( Number.isFinite(def.hold_ms ?? def.holdMs) ) m.hold_ms = Math.max(100, Math.min(10000, def.hold_ms ?? def.holdMs));
  if ( def.fx && typeof def.fx === "object" ) m.fx = { ...def.fx };
  m.custom = true;
  MOODS[id] = m;
  if ( !MOOD_IDS.includes(id) ) MOOD_IDS.push(id);
  return id;
}

/* a palette family: an array of entries, each [light, mid, dark] or { fill: [3], ext, out2: [..], ink } */
export function registerPalette(id, list) {
  if ( !okId(id) ) throw new Error(`LETR | palette id "${id}": a-z, 0-9, _ or -, starting with a letter`);
  const arr = Array.isArray(list) && list.length && (Array.isArray(list[0]) || typeof list[0] === "object") ? list : [list];
  const out = arr.map((e) => {
    const fill = Array.isArray(e) ? e : e?.fill;
    if ( !Array.isArray(fill) || !fill.length || !fill.every(isHex) ) throw new Error(`LETR | palette "${id}": fill must be 1-3 #hex colours`);
    const f = [fill[0], fill[1] ?? fill[0], fill[2] ?? fill[1] ?? fill[0]];
    const ext = isHex(e.ext) ? e.ext : shade(f[2], -0.55);
    const out2 = (Array.isArray(e.out2) ? e.out2 : [e.out2]).filter(isHex);
    return { fill: f, ext, out2: out2.length ? out2 : ["#ffffff"], ink: isHex(e.ink) ? e.ink : "#1b1020" };
  });
  COLORS[id] = out;
  return id;
}
/* lighten (+) / darken (-) a #hex by k */
export function shade(hex, k) {
  let h = hex.replace("#", ""); if ( h.length === 3 ) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h, 16), ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k));
  return `#${ch.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}

/* a font: { url | buffer, weight 0..1, sharp 0..1, track, slant }. `bank` = the engine's FontBank. The font letters Polish capitals
   from its own glyphs or, where it has none, synthesises them (base letter + accent) like the bundled ones. */
export async function registerFont(id, def, bank) {
  if ( !okId(id) ) throw new Error(`LETR | font id "${id}": a-z, 0-9, _ or -, starting with a letter`);
  let buf = def?.buffer;
  if ( !buf && def?.url ) { const r = await fetch(def.url); if ( !r.ok ) throw new Error(`LETR | font "${id}": ${r.status}`); buf = await r.arrayBuffer(); }
  if ( !(buf instanceof ArrayBuffer) ) throw new Error(`LETR | font "${id}": give url or buffer (ArrayBuffer)`);
  bank.add(id, buf);
  const n = (v, d, a = 0, b = 1) => (Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d);
  FONTS[id] = { file: def.url ?? `buffer:${id}`, weight: n(def.weight, 0.8), sharp: n(def.sharp, 0.5), track: n(def.track, -0.03, -0.1, 0.1), slant: n(def.slant, 0.06, -0.3, 0.3), custom: true };
  return id;
}

/* named styles (looks) */
export function makeStyles() {
  const table = {};
  return {
    table,
    register(name, style) {
      if ( typeof name !== "string" || !STYLE_NAME.test(name) || RESERVED.has(name) ) throw new Error(`LETR | style name "${name}"`);
      const s = cleanStyle(style);
      if ( !s ) throw new Error(`LETR | style "${name}": give an object`);
      if ( s.mood && s.mood !== "auto" && !Object.hasOwn(MOODS, s.mood) ) throw new Error(`LETR | style "${name}": unknown mood "${s.mood}"`);
      if ( s.palette && !Object.hasOwn(COLORS, s.palette) ) throw new Error(`LETR | style "${name}": unknown palette "${s.palette}"`);
      if ( s.font && !Object.hasOwn(FONTS, s.font) ) throw new Error(`LETR | style "${name}": unknown font "${s.font}"`);
      table[name] = s;
      return name;
    },
    remove(name) { const had = Object.hasOwn(table, name); delete table[name]; return had; },
    list() { return Object.entries(table).map(([name, s]) => ({ name, ...s })); },
    get(name) { return Object.hasOwn(table, name) ? table[name] : null; },
    /* replace the styles that came from the world setting (the others, registered by code, stay) */
    syncWorld(obj, fromWorld) {
      for ( const n of fromWorld ) if ( !obj?.[n] ) delete table[n];
      fromWorld.clear();
      for ( const [n, s] of Object.entries(obj ?? {}) ) { try { this.register(n, s); fromWorld.add(n); } catch ( e ) { console.warn(e.message); } }
    }
  };
}

/* the vocabulary a designer offers: entrance / hold / exit kinds across every mood */
export function motionNames() {
  const u = (k) => [...new Set(MOOD_IDS.flatMap((m) => Object.keys(MOODS[m][k] ?? {})))].sort();
  return { in: u("in"), hold: u("hold"), out: u("out") };
}
