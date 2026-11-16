/* GMALLMAPS: the map lettering's options are the TABLE's (owner, 2026-11-15: «wszystko mg wybiera dla stołu. wszystko»). Pure: no
   Foundry, no PIXI, no DOM (node-tested in dev/sfx-prefs.test.mjs); sfx.mjs registers the settings, sfx-table-ui.mjs is the window.
     sfxLetters        which sounds are lettered: all / big only / off           (was a CLIENT setting + the world switch sfxLettersWorld)
     sfxWordsWorld     the word set: English / Polish, named by a GM's seat (MAPWIN: never a seat's own language; wordsOf)   (a seat's own override sfxWords is gone)
     sfxLayer          where the words are drawn among the canvas layers           (was a CLIENT setting)
     sfxSize*          the size step per group, 0..3 (SFXSIZE; already world)
     sfxOn*            MAPSWITCH: the on / off switch per group (destruction, fire, weather, tokens); off letters nothing of the group
   Every one is a WORLD setting, written by a GM only (a player's write is cancelled on its own seat: guardWrite), applied live on every
   seat (onChange on create / update, deleteSetting back to the default), shown read-only to players in the same window.
   What stays each seat's own (not a table option): its performance mode (fewer side words up on a slow machine), its system's reduced
   motion (when "Respect reduced motion" is on), the lettering engine's seat signals (reduced motion, Foundry's photosensitive mode).
   MIGRATION once per world, by the first GM seat after the update (marker sfxTableMigrated): a value the world does not hold yet is taken
   from that GM's own old client value (localStorage "moinen-maps.<key>"); the old world switch "for everyone" off wins (lettering off);
   a GM's own word set (not "game language") becomes the table's. Players' old values are not taken (each is told once if his differed). */
import { SIZE_GROUPS, SIZE_SETTING, ON_SETTING, SIZE_DEFAULT, stepOf, stepWith, shownPair } from "./sfx-size.mjs";

/** The engine's world layers (LETR contract v3), bottom to top. */
export const LAYER_IDS = ["ground", "tokens", "weather", "overlay", "top"];
export const LETTERS = ["all", "big", "off"];
export const WORDS = ["auto", "en", "pl"];
/** MAPWIN: the word sets a GM can choose (the window's choices). "auto" is no choice: it is only what a world holds before a GM's seat
    named a set (a new world, a deleted document, a macro), and it never means "this seat's interface language" - a table with seats in
    two languages would letter two different words for one moment (ADVM 11). Until a GM's seat names the set (sfx.mjs fixWords: at ready,
    and at once whenever the value turns "auto" again) EVERY seat letters SHARED_WORDS. */
export const WORD_SETS = ["en", "pl"];
export const SHARED_WORDS = "en";
/** the word set every seat letters for a stored value: the set itself, anything else (not named yet) the shared one */
export const wordsOf = (stored) => (WORD_SETS.includes(stored) ? stored : SHARED_WORDS);
/** the word set a GM's seat names for the table from its own interface language (Polish -> "pl", any other -> "en") */
export const wordsFor = (guiLang) => (String(guiLang ?? "").toLowerCase().startsWith("pl") ? "pl" : "en");
/** The values the window's "Defaults" fills in: every key's default, the word set named from the GM's language (never "auto"). */
export const defaultsFor = (guiLang) => Object.fromEntries(Object.keys(TABLE).map((k) => [k, k === "sfxWordsWorld" ? wordsFor(guiLang) : TABLE[k].def]));
/** What a window shows and edits of the stored values: each made legal, the word set as every seat letters it (wordsOf). */
export const shownOf = (get) => {
  const o = Object.fromEntries(Object.keys(TABLE).map((k) => [k, k === "sfxWordsWorld" ? wordsOf(get(k)) : clean(k, get(k))]));
  // (MAPSWITCH: a group's switch and its slider 1..3 as the tabs show them - a stored size 0 reads as switched off)
  for ( const g of SIZE_GROUPS ) { const p = shownPair(o[ON_SETTING[g]], o[SIZE_SETTING[g]]); o[ON_SETTING[g]] = p.on; o[SIZE_SETTING[g]] = p.size; }
  return o;
};
/** The keys whose edited value differs from what the table holds (the window's "unsaved" list; both as shownOf gives them). */
export const changedKeys = (edited, table) => Object.keys(TABLE).filter((k) => k in edited && !same(edited[k], table[k]));

/** every table key of the map lettering with its default and its legal values (the window's rows, in order) */
export const TABLE = {
  sfxLetters: { def: "all", choices: LETTERS },
  sfxWordsWorld: { def: "auto", choices: WORDS },
  sfxLayer: { def: "overlay", choices: LAYER_IDS },
  ...Object.fromEntries(SIZE_GROUPS.map((g) => [SIZE_SETTING[g], { def: SIZE_DEFAULT, range: [0, 3] }])),
  ...Object.fromEntries(SIZE_GROUPS.map((g) => [ON_SETTING[g], { def: true, bool: true }]))
};
export const TABLE_KEYS = Object.keys(TABLE);
export const MIGRATED_KEY = "sfxTableMigrated", MIGRATION = 1;
/** the old per-seat (client) keys and the old world switch, read only by the migration */
export const OLD_CLIENT = { sfxLetters: "sfxLetters", sfxLayer: "sfxLayer", sfxWords: "sfxWordsWorld" };
export const OLD_WORLD_SWITCH = "sfxLettersWorld";
export const NOTICE_LS = "moinen-maps.sfxTableNotice";

/** a value made legal for its key (anything else: the default) */
export function clean(key, v) {
  const d = TABLE[key]; if ( !d ) return v;
  if ( d.range ) return stepOf(v ?? d.def);
  if ( d.bool ) return v !== false && v !== "false" && v !== 0;
  return d.choices.includes(v) ? v : d.def;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The table's lettering as every seat applies it, read from the WORLD values only (`get(key)` gives the stored or default value).
    MAPWIN: nothing of the seat goes in - not its interface language either (wordsOf). */
export function tableOf(get) {
  const v = (k) => clean(k, get(k));
  return {
    mode: v("sfxLetters"),
    lang: wordsOf(get("sfxWordsWorld")),
    layer: v("sfxLayer"),
    // (MAPSWITCH: the step a group letters at - 0 while its switch is off; `on` = the switch as the tabs show it)
    steps: Object.fromEntries(SIZE_GROUPS.map((g) => [g, stepWith(v(ON_SETTING[g]), v(SIZE_SETTING[g]))])),
    on: Object.fromEntries(SIZE_GROUPS.map((g) => [g, shownPair(v(ON_SETTING[g]), v(SIZE_SETTING[g])).on]))
  };
}

/** May this seat write a table key? Only a GM. -> true (allowed), false (cancel: the seat's own write of a table option) */
export const mayWrite = (key, isGM) => !TABLE_KEYS.includes(key) && key !== MIGRATED_KEY ? true : !!isGM;

/** The words of a moment THIS seat draws of the table's (sfx.mjs flushMoment): "big only" keeps the main words of big sounds, its
    performance mode fewer side words and fewer words up. Same rule as before GMALLMAPS, now fed the TABLE's mode. */
export function shareOf(placed, { big, caps, alive, capWords }) {
  let mine = big ? placed.filter((w) => w.role === "main" && (w.loud ?? 1) >= 0.2 + 0.8 * 0.34 - 1e-9) : placed;
  const secs = mine.filter((w) => w.role === "sec").sort((a, b) => a.t - b.t).slice(0, caps.sec);
  return capWords([...mine.filter((w) => w.role !== "sec"), ...secs], caps.alive - alive);
}

/**
 * The migration's writes (pure). `world(key)` = the stored world value or undefined when the world holds no document for the key;
 * `local(key)` = this GM seat's old client value or undefined; `done` = the marker's value.
 * -> { run (false: nothing to do), writes: { key: value } (only values that differ from the table's present value), from: { key: why } }
 */
export function migrationPlan({ world, local, done = 0 }) {
  const out = { run: (Number(done) || 0) < MIGRATION, writes: {}, from: {} };
  if ( !out.run ) return out;
  const present = (k) => clean(k, world(k) ?? TABLE[k].def);
  const take = (k, v, why) => { const c = clean(k, v); if ( c === v && !same(c, present(k)) && world(k) === undefined ) { out.writes[k] = c; out.from[k] = why; } };
  // the GM's own old seat values (a world value already stored is the table's: kept)
  const lt = local("sfxLetters"); if ( lt !== undefined ) take("sfxLetters", lt, "gm");
  const ly = local("sfxLayer"); if ( ly !== undefined ) take("sfxLayer", ly, "gm");
  // (a GM's own word set over the world's: his choice becomes the table's; "game language" kept the world's)
  const wd = local("sfxWords");
  if ( wd === "en" || wd === "pl" ) { if ( !same(wd, present("sfxWordsWorld")) ) { out.writes.sfxWordsWorld = wd; out.from.sfxWordsWorld = "gm"; } }
  // the old switch "for everyone" off: no lettering on any screen, whatever a seat chose - the table's letters are off
  if ( world(OLD_WORLD_SWITCH) === false && present("sfxLetters") !== "off" && world("sfxLetters") === undefined ) { out.writes.sfxLetters = "off"; out.from.sfxLetters = "world"; }
  return out;
}

/** a player's old seat values that differ from the table (he is told once that the GM chooses them now) */
export function playerDiffers(local, table) {
  const t = { sfxLetters: table.mode, sfxLayer: table.layer };
  for ( const k of ["sfxLetters", "sfxLayer"] ) { const v = local(k); if ( v !== undefined && clean(k, v) === v && v !== t[k] ) return true; }
  const w = local("sfxWords"); return (w === "en" || w === "pl") && w !== table.lang;
}

/** a raw localStorage entry as Foundry's client settings store it (JSON text) -> its value, undefined when absent */
export function parseLocal(raw) {
  if ( raw === null || raw === undefined ) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}
/** a world Setting document's value (v14 holds it parsed; an older or hand-made store the JSON text) */
export function docValue(doc) {
  if ( !doc ) return undefined;
  const v = doc.value;
  if ( typeof v === "string" ) { try { return JSON.parse(v); } catch { return v; } }
  return v;
}
