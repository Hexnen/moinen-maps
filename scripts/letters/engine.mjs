/* LETR engine: fonts, the picture scheduler, the two players (screen = HTML layer over the interface, world = PIXI on the canvas)
   and the public API (see README.md). Works without Foundry for the screen space (gallery page, node-free browser tests). */
import { makePlan, MOODS, MOOD_IDS, TICK, FONTS, syllablesOf, STYLES, INV_FACES, DEFAULT_FACE } from "./design.mjs";
import { FontBank } from "./fontbank.mjs";
import { paintPicture, inkPad, rimPx, extrasPad } from "./paint.mjs";
import { settleCenter } from "./shape.mjs";
import { sizeFor, SIZE, magnitudeOf, limits as sizeLimits } from "./size.mjs";
import { onOf, stepT, easeOf, orientAngle, pathSpec, pathPoints, pathAt, orbitAt, bendLayout, addTrail, TICK_MS } from "./move.mjs";
import { rng, hash } from "./rng.mjs";
import { makeSustain, AMBIENT_MAX } from "./sustain.mjs";
import { createVocab } from "./words.mjs";
import { MOTION_MODES, DEFAULT_MOTION, playOpts, trackPose, trackReach, holdEnergy, gridQ, gridAge, gridCeil, exitReach, trackSpan, LIFE_REACH } from "./motion.mjs";

export const VERSION = "1.9.26";   // 1.9.26 = CRITFREEZE: impact frames stop holding the page as a blow lands (live, a critical with two figures: 0.57 s of its 0.7 s of painting was the software raster of its figure layers, and its arts were 3 jobs of ~31 ms in the last frames before the word). A figure layer is painted on a plain 2D context (shown, never read: the same draws, the graphics card rasters it; 38 -> 12 ms a drawing live), and I.warmFor(spec) works a named blow's arts out in the page's idle moments before its instant is known (nothing painted, shown or counted; I.play then queues no job). No drawing, plan or timing changes. 1.9.25 = MAPBURN: a caller's score for a sustained run (L.sustain `words(k, ms, level)` may return { text, treat, level, scale, colors } beside mood / ms / accent: the phrase's own treatment, loudness, size share and face, so a run can build - a fire climbing from ember ticks to a roar; calls that do not return them are unchanged). 1.9.24 = ENG24: impact frames on a loaded or cold seat show the same drawings as on the others (the arts a plan needs are worked out between frames before they are due, drawings painted and rastered ahead, a late seat shows what it passed within a bounded lag and never skips a flash; one idle rehearsal per page warms the painters); every plan carries tableMs (the table's length before this seat's safety); steps 0 / 1 / 2 last 6 / 8 / 10 ticks. 1.9.23 = IMPACT5: the impact frame is a sakuga cut for its whole length (the star figure cut in, enlarged and moving; ordinary seats share 25 % of min(W, H)^2 for the figures, the same picture on every seat; no pink from turned colours; the art worked out ahead). 1.9.22 = ENGPINK: no colour the engine picks by itself is pink or magenta (the owner: no pink lettering): the invincible violet family (power, mind) is blue-violet #7258ff on #1e1258 (was #b36dff), the legacy colour families lose their pink and purple-pink members (punch, pop, beast, plasma, bruise, ember, toxic, gold), the colour-blind palette gives pop / beast / plasma Okabe-Ito bluish green and bruise a blue-violet (no reddish purple), the legacy colour plates are cyan and yellow, the impact frames' "void" tone is blue-violet and their guarded red plate a red, and computed shades (hue jitter, per-letter colours, rainbow fills, a backdrop opposite hue, block shading) step out of the band (design.mjs PINK / isPink / unpinkHsl, check-pink.mjs). A caller's own colours are left alone. Lettering in other colours draws exactly what it drew.
// 1.9.21 = IMPACT4: impact frames turn the tokens' own colours at their own luminance (hue negative, hue cycle, duotone: no flash at any size or zoom), slice the true negative along the blow, pop the figures, show the token's own art in the enlarged frames, light a portrait's own figure, and follow the tokens while they react; the strongest impacts are a one-second cut (24 ticks, hit-stop 8), still at most two flash drawings. Nothing outside impact frames draws differently. 1.9.20 = IMPACT3: the tokens take part in the impact frames (the struck target, the attacker and any `also` tokens drawn at their true place in a colour negative, posterised to ink / accent / paper, inked black and white or in their own colours, with a lit rim round their real outline, knock-back echoes and flares from the contact point; brightness-changing art only on small figures, at most 2.5 % of the view; rims only on a photosensitive seat); each kind's six-step ladder rebuilt in hand-drawn timing (held drawings, palette jumps, a kick back against the blow, the hit-stop on a figure drawing), seeded so hits differ; frame types fig and cracks; options also / figures and per-frame fig / kick. Nothing outside impact frames draws differently. 1.9.19 = ENGDROP: the bridge to invincible-plus-ultra's old GMALL mirror and the legacy description of the old client settings (prefs SETTINGS / WORLD_KEYS / scopeOf / DEFAULTS / clean / cleanAll) are gone; one settings model (TABLE); the migration reads plus-ultra's old copy from its world document (also with maps alone); an older plus-ultra next to this engine: its window's changes are taken into the table, nothing written back, the GM told once; the settings window redesigned (aligned control column, short row labels, sizes as percent, quieter hints). No picture changes. 1.9.18 = ENGVIEW: one table picture from the public API alone: an explicit view {vw, vh, zoom, alive, dpr} for L.sizeOf / L.measure / L.play / L.stream / L.sustain (every seat the same size, whatever its window, zoom and words up); L.measure gives the standing footprint and the entrance ink reach (stand / standBox / inkReach / inkReachBox / ink / rim / life); L.streamUnit; a stream honours scale and view; the legacy sustain styles run on the event clock (startAt); L.impact.tierOf / stepOf / tiers / seriesBoost; ceilK named as unread (one warning, measure.unread). No existing call draws differently. 1.9.17 = SUSTAINGAP 1.9.15 merged with ENGTABLE 1.9.16. 1.9.16 = ENGTABLE (1.9.15 left to the parallel sustain-spacing branch): every preference is the TABLE's, chosen by the GM (one world setting `table` + `movement` + `face`; no client setting any more; players read-only; live on every seat's next word); a seat's own system reduced motion and Foundry photosensitive mode still apply on that seat; the photosensitivity guard is no setting and always on; the GM's old client values migrate once (plus-ultra's table first); a bridge keeps plus-ultra's GMALL mirror table equal until it is dropped; the settings window is the table's (GM edits and saves for everyone, a player reads). At the default values every seat draws what 1.9.14 drew. 1.9.15 = SUSTAINGAP (1.9.16 = ENGTABLE, a parallel branch): a sustained sound reads as one run, its phrases never pile: each phrase is seated by its own measured ink (entrance, hold, turn, keyline, rim, picture, exit while legible) in two seats round one split line, the run moved as one block inside the view and a caller's `room`; echo copies and shed fragments (one per syllable) beyond the run's edge or left out when there is no room; `startAt` joins a run on the event's clock on every seat; stream syllables up at once stand in staggered lanes; a word drawn in by parts stands in its hold's first pose until the hold (it was thrown away by decaying holds); the legacy styles keep the 1.9.14 sustain (sustain-legacy.mjs). 1.9.14 = ENGWORDS 1.9.13 merged with RIMUNDER 1.9.12. 1.9.13 = ENGWORDS (1.9.12 left to the parallel RIMUNDER branch): both deny lists read both languages (crossRefusal, CROSS: a word may not read as a word of the other language either); the words that did were replaced (pl hero going down KA-DUMP -> the owner's landing KA-DUUM, BOINNG, TINNG, HAH, HUUH, UUH, MIII, SPLASZ, TWAK, SZNAP, SWISZK; en PTAK, PTAKT, SHTUK, BUDDA, GRROMM); only those kinds and tiers letter other words. 1.9.12 = RIMUNDER: an invincible word on the map gets the letterer's holding line, an ink rim UNDER the whole lettering (letters and their coloured duplicate block together, counters open, round joins), so it reads on bright, mid, busy and fire-lit ground while ink on a dark floor stays next to invisible; look.rim ink|paper|none, default ink in world space (no backdrop), none on the screen; a world word asked with rim none, every screen word and the legacy styles draw exactly what they drew. (1.9.13 = ENGWORDS, a parallel branch.) 1.9.11 = ENGREG: one rule picks the engine copy on every seat (after init, highest VERSION, then the more recently synced content; L.build, L.seats() names a seat on another build), the table's own minimum-filter clock (clock.mjs) under the stepped grid and L.net (L.clock), a caller's ceiling share `ceil` reaches the size model (`ceilK` stays unread: today's pictures unchanged), L.measure (the real hold box and entrance reach before placing), a settle memo and faster mark rows (many words planned in one frame: same pictures, a fraction of the time). 1.9.10 = HOLDS: a held invincible word lives as long as it stands (after its sound's own body the lettering keeps moving in the manner of the sound: echo, settle, hum, sag, slosh, rumble, breath; small, inside its placement, the same on every seat, still under reduced motion; smooth and stepped). (1.9.9 = KEEPBOX, a parallel branch.) 1.9.8 = KERNEX: punctuation never reads as a diacritic of its neighbour (a mark keeps the hand's gap from every letter beside, under or over it; at least 1.5 px in small pictures; invincible style only). 1.9.7 = FONTSEL: the invincible style in League Gothic (default) or Anton, world setting face, per-face tuning, optical sizes. 1.9.6 = WORDS3 merged (thunder without BOOM/BUM; FIRE_BLASTS check). 1.9.5 = MODE 1.9.2 (table motion type set by the GM, shared grid clock L.gridClock) merged with LOOK3 1.9.4. 1.9.4 = LOOK3 + the owner's 20 % for a linked three; 1.9.3 = LOOK3 (1.9.2 = MODE, a parallel branch): interlocked O staggered (first up, second down, third up; two O always, three rarely, four never), first letter as tall as its neighbour, no hole before the last letter (union-keyline pairs part only as far as a touch). 1.9.1 = FIN-ENGINE: FXI-ENGINE 1.8.2 (impact frames: every scene change counted by the guard, six-step ladder, red-safe, gentle per call, settings row) merged onto MOTION2 1.9.0; plan.contactMs, per-word flash:false, impact size from the subject, impact keep rect. 1.9.0 = MOTION2 (contract v10): invincible motion as per-frame tracks from a sound-family table (motion.mjs), pictures shared by key, smooth|stepped switch (look.motion, L.motionMode), reduced exit = fade. 1.8.1 = LOOK2 1.8.0 + IMPACT/KINDS1 merged. LOOK2 (contract v9): invincible = tall tight flat lettering (Anton, one union keyline, optical kerning, flat palettes, joined OO, tucked prefix, vertical column), legacy look frozen as style "expressive"; v7+v8 merged: MOVE (contract v7, 1.5.0: travel, choreography, rates, escalation, shards, push, glow, continuous sounds) + LOOK (contract v8, 1.6.0: lines, backdrops, deformation, fills, legibility, accent, look styles, sound->look); 1.4.1 TOOL; 1.3.1 WORD; 1.2.1 FXLE | 1.7.2 IMPACT merged (impact frames, impact/, L.impact); 1.7.1 KINDS1: material, impact, debris, shock wave, fire ladder, chain + TAILS, whizz, casings, dry fire, grenade. v7+v8 merged: MOVE (contract v7, 1.5.0: travel, choreography, rates, escalation, shards, push, glow, continuous sounds) + LOOK (contract v8, 1.6.0: lines, backdrops, deformation, fills, legibility, accent, look styles, sound->look); 1.4.1 TOOL; 1.3.1 WORD; 1.2.1 FXLE 1.9.9 = KEEPBOX: impact frames give identical pictures on every seat from identical calls (one at a time on time windows, the guard on every planned call, a word's own flash gives way inside an impact's second, no drawing skipped on a slow seat); a kept word is drawn ON the impact with a rim round its letters instead of a box cut into the drawing. 1.9.8 = KERNEX: punctuation never reads as a diacritic of its neighbour (a mark keeps the hand's gap from every letter beside, under or over it; at least 1.5 px in small pictures; invincible style only). 1.9.7 = FONTSEL: the invincible style in League Gothic (default) or Anton, world setting face, per-face tuning, optical sizes. 1.9.6 = WORDS3 merged (thunder without BOOM/BUM; FIRE_BLASTS check). 1.9.5 = MODE 1.9.2 (table motion type set by the GM, shared grid clock L.gridClock) merged with LOOK3 1.9.4. 1.9.4 = LOOK3 + the owner's 20 % for a linked three; 1.9.3 = LOOK3 (1.9.2 = MODE, a parallel branch): interlocked O staggered (first up, second down, third up; two O always, three rarely, four never), first letter as tall as its neighbour, no hole before the last letter (union-keyline pairs part only as far as a touch). 1.9.1 = FIN-ENGINE: FXI-ENGINE 1.8.2 (impact frames: every scene change counted by the guard, six-step ladder, red-safe, gentle per call, settings row) merged onto MOTION2 1.9.0; plan.contactMs, per-word flash:false, impact size from the subject, impact keep rect. 1.9.0 = MOTION2 (contract v10): invincible motion as per-frame tracks from a sound-family table (motion.mjs), pictures shared by key, smooth|stepped switch (look.motion, L.motionMode), reduced exit = fade. 1.8.1 = LOOK2 1.8.0 + IMPACT/KINDS1 merged. LOOK2 (contract v9): invincible = tall tight flat lettering (Anton, one union keyline, optical kerning, flat palettes, joined OO, tucked prefix, vertical column), legacy look frozen as style "expressive"; v7+v8 merged: MOVE (contract v7, 1.5.0: travel, choreography, rates, escalation, shards, push, glow, continuous sounds) + LOOK (contract v8, 1.6.0: lines, backdrops, deformation, fills, legibility, accent, look styles, sound->look); 1.4.1 TOOL; 1.3.1 WORD; 1.2.1 FXLE | 1.7.2 IMPACT merged (impact frames, impact/, L.impact); 1.7.1 KINDS1: material, impact, debris, shock wave, fire ladder, chain + TAILS, whizz, casings, dry fire, grenade. v7+v8 merged: MOVE (contract v7, 1.5.0: travel, choreography, rates, escalation, shards, push, glow, continuous sounds) + LOOK (contract v8, 1.6.0: lines, backdrops, deformation, fills, legibility, accent, look styles, sound->look); 1.4.1 TOOL; 1.3.1 WORD; 1.2.1 FXLE
/* Where a word is drawn. World layers live in the canvas (scene coordinates); screen layers are HTML over the page.
   primary = the scene's own sorted group (lit and darkened by the scene's lighting like tokens are); sortLayer: Foundry's tiles 500,
   drawings 600, tokens 700, core weather 1000; moinen-maps: water 240, roads 245, destruction 247-248, districts 250, fire ground 256,
   zones 258, under-smoke 750, fire smoke 800, its weather 990-997. */
export const LAYERS = {
  ground:  { space: "world", group: "primary", sortLayer: 259, elevation: 0, pl: "Na ziemi (pod żetonami)", en: "On the ground (under tokens)" },
  tokens:  { space: "world", group: "primary", sortLayer: 760, elevation: 0, pl: "Nad żetonami (pod dymem i pogodą)", en: "Over tokens (under smoke and weather)" },
  weather: { space: "world", group: "primary", sortLayer: 1100, elevation: Infinity, pl: "Nad pogodą i dymem (w świetle sceny)", en: "Over weather and smoke (in the scene's light)" },
  overlay: { space: "world", group: "interface", pl: "Nad całą sceną i oświetleniem", en: "Over the whole scene and its lighting" },
  top:     { space: "world", group: "stage", pl: "Nad wszystkim na płótnie (też linijki, kursory)", en: "Over everything on the canvas (rulers, cursors too)" },
  hud:     { space: "screen", z: 5, pl: "Nad mapą, pod paskami i oknami", en: "Over the map, under the bars and windows" },
  ui:      { space: "screen", z: 80, pl: "Nad paskami (czat, makra), pod oknami", en: "Over the bars (chat, hotbar), under windows" },
  screen:  { space: "screen", z: 1000, pl: "Nad całym interfejsem", en: "Over the whole interface" }
};
const defaults = { world: "overlay", screen: "screen" };
const warned = new Set();
const warnOnce = (key, ...msg) => { if ( warned.has(key) ) return; warned.add(key); console.warn(...msg); };
const FIRST_MS = 6;           // FXLE F3: new words are prepared and get their first picture within this much per frame (at least one)
const MAX_CHARS = 160;        // FXLE F3: longer text is cut (a word that long is unreadable and costs seconds to letter)
const FUTURE_MS = 60000;      // FXLE F6: a startAt further ahead than this is another clock's time: ignored, with a warning
/* FXLE F19/F20: options checked before use; a bad number is dropped (default used) with one warning per option */
function cleanOpts(o) {
  const c = { ...(o && typeof o === "object" ? o : {}) };
  const fix = (k, ok) => {
    if ( c[k] === undefined || c[k] === null ) { delete c[k]; return; }
    if ( typeof c[k] === "number" && Number.isFinite(c[k]) && ok(c[k]) ) return;
    warnOnce(`opt:${k}`, `LETR | option ${k} = ${String(c[k])} ignored (not a usable number)`);
    delete c[k];
  };
  fix("size", (v) => v > 0); fix("hold", (v) => v >= 0); fix("tempo", (v) => v > 0); fix("rotation", () => true); fix("maxWidth", (v) => v > 0);
  fix("delay", (v) => v >= 0); fix("startAt", () => true); fix("scale", (v) => v > 0); fix("span", (v) => v > 0); fix("zIndex", () => true);
  fix("elevation", () => true);
  fix("ceil", (v) => v > 0 && v <= 1);   // ENGREG: a caller's share of the size ceiling (0..1]
  /* ENGVIEW (1.9.18): `ceilK` was never read (ENGREG-1): it stays unread so no size changes, and a caller who passes it is told once */
  if ( c.ceilK !== undefined && !c._stream ) warnOnce("opt:ceilK", "LETR | option ceilK is NOT read (it never reached the size model; sizes are as without it): pass `ceil` (0..1] for a share of the size ceiling (manual 6)");
  /* ENGVIEW: an explicit view for the size model ({ vw, vh, zoom, alive, dpr }), read instead of this seat's window */
  if ( c.view !== undefined ) c.view = cleanView(c.view);
  if ( c.view === null ) delete c.view;
  if ( c.pixel != null && typeof c.pixel !== "boolean" ) {
    if ( !(typeof c.pixel === "number" && Number.isFinite(c.pixel) && c.pixel >= 0.25) ) { warnOnce("opt:pixel", `LETR | option pixel = ${String(c.pixel)} ignored (art px size must be >= 0.25 scene px); using the grid's art pixel`); c.pixel = !!c.pixel; }
  }
  if ( Number.isFinite(c.startAt) && c.startAt > performance.now() + FUTURE_MS ) {
    warnOnce("opt:startAt", "LETR | startAt is far in the future: it must be this page's performance.now() (see README 'Several clients'); ignored");
    delete c.startAt;
  }
  if ( c.mood != null && c.mood !== "auto" && !Object.hasOwn(MOODS, c.mood) ) { warnOnce(`mood:${c.mood}`, `LETR | unknown mood "${String(c.mood)}", using auto`); c.mood = "auto"; }
  return c;
}
/* ENGVIEW (1.9.18): a caller's view for the size model and L.measure: { vw, vh (CSS px: the usable width and the height of the window the
   word is sized for), zoom (world words: the canvas scale), alive (world words up at that moment: the crowd's share), dpr (device pixels
   per CSS px: the rim's pixel floor) }. A field left out is this seat's live value, except `alive` (0) and `dpr` (1): a view names the
   table's picture, so nothing of this seat's own words or screen density slips in. null when unusable (one warning). */
/* ENGVIEW: L.measure's lazy ink fields, read through a shared prototype; the thunk sits under a symbol (not enumerated, not in JSON) */
const INK_OF = Symbol("letr.inkOf"), INK_MEMO = Symbol("letr.inkMemo");
const inkArgs = ([f, plan, track, pixel, reducedMotion, rotation, path, orbit, unit, S, cx, cy]) => f({ plan, track, pixel, reducedMotion, opts: { rotation, path, orbit } }, unit, S, cx, cy);
const MEASURE_INK = {};
for ( const k of ["stand", "standBox", "inkReach", "inkReachBox", "ink", "rim", "life"] )
  Object.defineProperty(MEASURE_INK, k, { get() { return (this[INK_MEMO] ??= inkArgs(this[INK_OF]))[k]; }, enumerable: true });
const VIEW_KEYS = { vw: (v) => v >= 200, vh: (v) => v >= 200, zoom: (v) => v > 0, alive: (v) => v >= 0, dpr: (v) => v > 0 };
function cleanView(v) {
  if ( !v || typeof v !== "object" ) { warnOnce("opt:view", `LETR | option view = ${String(v)} ignored (an object { vw, vh, zoom, alive, dpr })`); return null; }
  const out = {};
  for ( const [k, ok] of Object.entries(VIEW_KEYS) ) {
    if ( v[k] == null ) continue;
    if ( typeof v[k] === "number" && Number.isFinite(v[k]) && ok(v[k]) ) out[k] = v[k];
    else warnOnce(`opt:view.${k}`, `LETR | option view.${k} = ${String(v[k])} ignored (not a usable number); this seat's value is used`);
  }
  out.alive ??= 0; out.dpr ??= 1;
  return out;
}
const BUDGET_MS = 4;          // pre-render budget per animation frame, shared by every live word
const MAX_REDRAWS = 3;        // stale (zoomed / resized) pictures drawn again per frame, at most, also within the time budget
const MEMORY_MS = 6000;       // a hand used this recently is avoided by unseeded words
const GLOW_MOODS = new Set(["fire", "zap", "powerup"]);   // glow: "auto" lights these (world: when the scene is dark)

const now = () => performance.now();
const reducedPref = () => { try { return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const makeCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

export function createEngine(base) {
  const bank = new FontBank();
  let readyP = null;
  const clips = new Set();
  const pending = new Set();    // FXLE F4: words not live yet (waiting for `delay` or fonts, or queued for the frame loop)
  const queue = [];             // FXLE F3: planned words waiting to be prepared in the frame loop, oldest first
  const streams = new Set();    // FXLE F4: running streams (stopAll and a scene change stop them)
  const hands = new Map();      // FXLE F18: recent hands by id, so `hand: h.hand` (the string) pins the exact look
  const memory = [];            // [{ id, t }]
  const escMem = new Map();     // escalation: key (space|source|word) -> { n, t, win, h } (README "Motion: escalation")
  let glowLayer = null;         // world glow: the lights of self-lit words, in Foundry's illumination container
  let raf = 0, seq = 0;
  const limits = { screen: 16, world: 48 };
  /* v5 tools (tools.mjs): engine-wide preferences and saved styles. opts filters run on each call's options (null = lettering is
     off on this client), plan filters on the planned word once its size is known (palette, motion, flash guard), start hooks once
     a word is up */
  const ext = { opts: [], plan: [], start: [], preview: [] };   // ENGREG: preview = the tools' plan filter without side effects (L.measure)
  const filterOpts = (opts) => { for ( const f of ext.opts ) { const o = f(opts); if ( o === null ) return null; if ( o ) opts = o; } return opts; };

  function ready() {
    readyP ??= Promise.all(Object.entries(FONTS).filter(([, f]) => !f.custom).map(async ([id, f]) => {
      try { const r = await fetch(new URL(f.file, base)); if ( !r.ok ) throw new Error(r.status); bank.add(id, await r.arrayBuffer()); }
      catch ( e ) { console.warn(`LETR | font ${id} not loaded`, e); }
    })).then(() => {
      if ( !bank.has("bangers") && !bank.has("anton") ) throw new Error("LETR: no font could be loaded");
      /* a font that failed to load is dropped from every mood's choices */
      for ( const m of Object.values(MOODS) ) for ( const k of Object.keys(m.fonts) ) if ( !bank.has(k) ) m.fonts[k] = 0;
      warmUp();
      return true;
    });
    return readyP;
  }
  /* ENGREG (1.9.11): the first words of a session paid the font's cold costs (the reader's glyphs, outline caches: a dozen words
     planned together took about twice their warm time). A few words are settled while the page is idle, one per idle callback, so
     the first real moment finds the caches warm. Only caches fill; no plan of a later word changes. Browsers only
     (requestIdleCallback), never in node checks. */
  const WARM = ["ABCDEFGHIJKLM!", "NOPQRSTUVWXYZ?", "KA-BOOM!", "0123456789-"];
  function warmUp() {
    const ric = globalThis.requestIdleCallback;
    if ( typeof ric !== "function" ) return;
    const jobs = [];
    for ( const face of INV_FACES ) if ( bank.has(face) ) for ( const w of WARM ) jobs.push({ look: { style: "invincible", face } , w });
    if ( defLook !== "invincible" ) for ( const w of WARM.slice(0, 2) ) jobs.push({ look: { style: defLook }, w });
    const next = () => { const j = jobs.shift(); if ( !j ) return; try { settleCenter(mk(j.w, { seed: "letr-warm", look: { ...j.look, motion: "smooth" } }, fontsApi, []), bank); } catch {} ric(next, { timeout: 4000 }); };
    ric(next, { timeout: 4000 });
  }
  const fontsApi = { adv: (font, ch) => bank.adv(font, ch) };
  /* LOOK: the lettering tradition every call gets unless it names one (opts.look.style, or TOOL's built-in styles "invincible" /
     "comic"): "invincible" in a world of the Invincible system (the book's own lettering), "comic" elsewhere; L.lookStyle(name)
     changes it for this client */
  let defLook = globalThis.game?.system?.id === "invincible" ? "invincible" : "comic";
  /* MOTION2: how the invincible style moves on this client: "smooth" (default) or "stepped" (A/B for the owner, MOTION2-1); a call's
     look.motion wins */
  let defMotion = DEFAULT_MOTION;
  /* FONTSEL (1.9.7): the invincible style's face on this client (the table's setting `face`, set by the GM); a call's look.face wins.
     A face whose file did not load falls back to the other one (the plan never names a face the bank cannot draw) */
  let defFace = DEFAULT_FACE;
  const faceOk = (f) => (bank.has(f) ? f : INV_FACES.find((x) => bank.has(x)) ?? f);
  const withFace = (o) => (o.look.style === "invincible" ? { ...o, look: { ...o.look, face: faceOk(INV_FACES.includes(o.look.face) ? o.look.face : defFace) } } : o);
  const withMotion = (o0) => { const o = withFace(o0); return o.look.style === "invincible" && !MOTION_MODES.includes(o.look.motion) ? { ...o, look: { ...o.look, motion: defMotion } } : o; };
  const mk = (t, o, f, m) => {
    if ( o?.look?.style ) return makePlan(t, withMotion(o), f, m);
    const ls = typeof o?.style === "string" && STYLES.includes(o.style) ? o.style : defLook;   // TOOL's built-in style names too
    return makePlan(t, withMotion({ ...o, look: { ...(o?.look ?? {}), style: ls } }), f, m);
  };
  const lookStyle = (name) => { if ( STYLES.includes(name) ) defLook = name; return defLook; };
  const motionMode = (name) => { if ( MOTION_MODES.includes(name) ) defMotion = name; return defMotion; };
  const invFace = (name) => { if ( INV_FACES.includes(name) ) defFace = name; return defFace; };
  /* MODE (1.9.2): the stepped grid's clock. Without it the grid sits on this page's performance.now(), whose origin differs on every
     seat, so a stepped word's drawings (and its contact, L.contactAt) fell 0..41.7 ms apart between seats that share a start. The
     tools hand in `() => sharedNow - performance.now()` (the world's shared clock): every seat then draws on the SAME instants.
     The offset is taken modulo 250 ms (the common multiple of the grids on ones, twos and threes) and fixed per word at its start. */
  let gridClockFn = null;
  const GRID_LCM = 6 * TICK;
  const gridOff = () => {
    if ( !gridClockFn ) return 0;
    try { const v = gridClockFn(); return Number.isFinite(v) ? ((v % GRID_LCM) + GRID_LCM) % GRID_LCM : 0; } catch { return 0; }
  };
  const gridClock = (fn) => { if ( fn === null || typeof fn === "function" ) gridClockFn = fn; return gridOff(); };

  /* ---------- placement ---------- */
  /* a token reference: a Token, a TokenDocument or a token id (a string is always read as a token id) */
  const isToken = (a) => !!a && (typeof a === "string" || a.document?.documentName === "Token" || a.documentName === "Token");
  /* FXLE F11: the token's placeable on this scene, or null when it is gone (deleted, another scene, destroyed) */
  const tokenObj = (a) => {
    let t = null;
    if ( typeof a === "string" ) t = globalThis.canvas?.tokens?.get?.(a) ?? null;
    else if ( a?.documentName === "Token" ) t = a.object ?? null;
    else t = a ?? null;
    return t && !t.destroyed && t.center && t.document ? t : null;
  };
  /* the point a word sits at; FXLE F11/F19: a token that is gone keeps the last known point (h.gone is set and the word leaves),
     an `at` function that throws or returns nothing keeps the last point too */
  function atOf(h) {
    if ( typeof h.at !== "function" ) return h.at;
    try { return h.at(); } catch ( e ) { warnOnce("at-throws", "LETR | an `at` function threw; the word keeps its last point", e); return null; }
  }
  function worldPoint(h) {
    const a = atOf(h);
    if ( isToken(a) ) {
      const t = tokenObj(a);
      if ( !t ) { h.gone = true; return h.lastP ?? null; }
      const d = t.document;
      return (h.lastP = { x: t.center.x, y: (d.y ?? t.y) - (canvas.grid?.size ?? 100) * 0.08 });
    }
    if ( a && Number.isFinite(a.x) && Number.isFinite(a.y) ) return (h.lastP = { x: a.x, y: a.y });
    if ( h.lastP ) return h.lastP;
    const r = globalThis.canvas?.stage ? canvas.stage.pivot : { x: 0, y: 0 };
    return { x: r.x, y: r.y };
  }
  function screenPoint(h) {
    const a = atOf(h);
    if ( isToken(a) ) {
      if ( !globalThis.canvas?.stage ) { h.gone = true; return h.lastS ?? null; }
      const w = worldPoint({ at: a }); if ( !w ) { h.gone = true; return h.lastS ?? null; }
      const g = canvas.stage.toGlobal(w), r = canvas.app.view.getBoundingClientRect();
      return (h.lastS = { x: r.left + g.x, y: r.top + g.y });
    }
    if ( a && Number.isFinite(a.x) && Number.isFinite(a.y) ) return (h.lastS = { x: a.x, y: a.y });
    if ( h.lastS ) return h.lastS;
    return { x: innerWidth / 2, y: innerHeight * 0.42 };
  }

  /* ---------- who may see a word (FXLE F13) ----------
     A word that belongs to a token (`at` = a token, or `token`) is shown only while that token is visible to this user: a hidden
     token's word is never shown to players, nor one whose token this user cannot see (vision, fog). `vision: "point"` also hides a
     world word whose point this user cannot see; `vision: "none"` shows it always. The GM sees what the GM sees on the canvas. */
  const SEEN_MS = 120;
  function wordToken(h) {
    const a = h.opts.token ?? (typeof h.at === "function" ? null : h.at);
    return isToken(a) ? a : null;
  }
  function computeSeen(h) {
    const C = globalThis.canvas, user = globalThis.game?.user;
    if ( h.opts.vision === "none" || !C?.ready || !user ) return true;
    const gm = !!user.isGM;
    const noVision = () => !C.visibility?.tokenVision || (gm && !C.effects?.visionSources?.some?.((s) => s.active));
    const ref = wordToken(h);
    if ( ref ) {
      const t = tokenObj(ref);
      if ( !t ) return h.seen ?? false;              // gone: keep the last answer (the word is leaving)
      const d = t.document;
      if ( t.controlled || t.isPreview ) return true;
      if ( d.hidden && !gm ) return false;
      if ( noVision() ) return true;
      if ( t.vision?.active ) return true;
      try { return !!C.visibility.testVisibility(d.getVisibilityTestPoints?.() ?? t.center, { tolerance: 0, object: t }); } catch { return true; }
    }
    if ( h.opts.vision === "point" && h.space === "world" && h.lastP ) {
      if ( noVision() ) return true;
      try { return !!C.visibility.testVisibility(h.lastP, { tolerance: (C.grid?.size ?? 100) * 0.25 }); } catch { return true; }
    }
    return true;
  }
  function seenOf(h, t) {
    if ( h.seenAt != null && t - h.seenAt < SEEN_MS ) return h.seen;
    h.seenAt = t; h.seen = computeSeen(h);
    return h.seen;
  }

  /* ---------- display layers (README "Layers") ---------- */
  const screenLayers = new Map(), worldLayers = new Map();
  const layerOf = (h) => {
    const want = h.opts.layer ?? defaults[h.space];
    const L = LAYERS[want];
    if ( L && L.space === h.space ) return want;
    if ( h.opts.layer && !warned.has(want) ) { warned.add(want); console.warn(`LETR | unknown ${h.space} layer "${want}", using "${defaults[h.space]}"`); }
    return defaults[h.space];
  };
  function ensureLayer(h) {
    if ( h.opts.parent instanceof HTMLElement ) return h.opts.parent;
    const key = layerOf(h);
    let el = screenLayers.get(key);
    if ( !el?.isConnected ) {
      el = document.createElement("div");
      el.id = `moinen-letters-${key}`;
      el.className = "moinen-letters-layer";
      el.setAttribute("aria-hidden", "true");
      Object.assign(el.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: String(LAYERS[key].z), overflow: "hidden", contain: "strict" });
      document.body.appendChild(el);
      screenLayers.set(key, el);
    }
    if ( key === "screen" ) screenZ(el);
    return el;
  }
  /* FXLE F22: app windows climb in z-index (ApplicationV2._maxZ + 1 per bring-to-front, from 100): the `screen` layer stays above
     the highest window, under tooltips (9999) and notifications */
  function screenZ(el = screenLayers.get("screen")) {
    if ( !el ) return;
    const top = Number(globalThis.foundry?.applications?.api?.ApplicationV2?._maxZ) || 0;
    const z = String(Math.min(9990, Math.max(LAYERS.screen.z, top + 1)));
    if ( el.style.zIndex !== z ) el.style.zIndex = z;
  }
  /* FXLE F22: the elevation a primary-group word sorts at: never under the current v14 level's own background (level base elevation);
     `tokens` at the token's live elevation (the `at` token, or `token`), at a point the highest token covering that point; `elevation`
     overrides */
  function elevationOf(h, key, L) {
    if ( L.group !== "primary" ) return 0;
    if ( Number.isFinite(h.opts.elevation) ) return h.opts.elevation;
    if ( L.elevation === Infinity ) return Infinity;
    const base = Number(globalThis.canvas?.level?.elevation?.base) || 0;
    if ( key !== "tokens" ) return Math.max(base, L.elevation ?? 0);
    const ref = wordToken(h);
    if ( ref ) { const t = tokenObj(ref); if ( t ) return Math.max(base, Number(t.document.elevation) || 0); }
    const p = h.lastP;
    let e = base;
    if ( p ) for ( const t of globalThis.canvas?.tokens?.placeables ?? [] ) {
      const b = t.bounds; if ( !b || !(Number(t.document?.elevation) > e) ) continue;
      if ( p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height ) e = Number(t.document.elevation);
    }
    return e;
  }
  /* a primary-group word moves to the container of its new elevation when that changes (token climbs, level switch); checked every few frames */
  function refreshElevation(h, t) {
    if ( h.space !== "world" || !h.sprite || (h.opts.parent && h.opts.parent.addChild) ) return;
    if ( h.elevAt != null && t - h.elevAt < 250 ) return;
    h.elevAt = t;
    const key = layerOf(h), L = LAYERS[key];
    if ( L.group !== "primary" ) return;
    if ( elevationOf(h, key, L) === h.elev ) return;
    const parent = ensureWorld(h);
    if ( h.sprite.parent !== parent ) parent.addChild(h.sprite);
  }
  function ensureWorld(h) {
    if ( h.opts.parent && h.opts.parent.addChild ) return h.opts.parent;
    const key = layerOf(h), L = LAYERS[key];
    const elev = elevationOf(h, key, L);
    h.elev = elev;
    const id = `${key}@${elev}`;
    let c = worldLayers.get(id);
    if ( !c || c.destroyed || !c.parent ) {
      c = new PIXI.Container();
      c.name = `moinen-letters-${id}`;
      c.sortableChildren = true;
      c.eventMode = "none";
      if ( L.group === "primary" ) { Object.assign(c, { elevation: elev, sortLayer: L.sortLayer, sort: 0, _lastSortedIndex: 0 }); canvas.primary.addChild(c); canvas.primary.sortDirty = true; }
      else if ( L.group === "stage" ) { c.zIndex = 1e6; canvas.stage.addChild(c); }
      else { c.zIndex = 900; canvas.interface.addChild(c); canvas.interface.sortChildren?.(); }
      worldLayers.set(id, c);
    }
    if ( L.group === "stage" && canvas.stage.children.at(-1) !== c ) canvas.stage.addChild(c);   // stays the last child (drawn last)
    return c;
  }

  /* ---------- size (README "Size"; the model is size.mjs) ---------- */
  const usableW = () => { const sb = document.getElementById("sidebar")?.getBoundingClientRect(); return Math.max(320, innerWidth - (sb && sb.left > innerWidth * 0.5 ? sb.width : 0)); };
  /* the radius (world units) of an event's footprint: a number, { radius }, { w, h }, or a placeable / document with bounds */
  function areaOf(a) {
    if ( a == null ) return 0;
    if ( Number.isFinite(a) ) return Math.max(0, a);
    if ( Number.isFinite(a.radius) ) return a.radius;
    const b = a.bounds ?? a.object?.bounds ?? a;
    if ( Number.isFinite(b.width) && Number.isFinite(b.height) ) return Math.max(b.width, b.height) / 2;
    if ( Number.isFinite(b.w) && Number.isFinite(b.h) ) return Math.max(b.w, b.h) / 2;
    return 0;
  }
  function tokenSpanOf(h) {
    if ( Number.isFinite(h.opts.span) && h.opts.span > 0 ) return h.opts.span;   // the size of whatever makes the sound, world units
    const a = h.opts.token ?? (typeof h.at === "function" ? null : h.at);
    if ( !isToken(a) || !globalThis.canvas?.grid ) return 0;
    const t = tokenObj(a), d = t?.document; if ( !d ) return 0;
    return Math.max(d.width ?? 1, d.height ?? 1) * canvas.grid.size;
  }
  /* ENGVIEW: the zoom a word is sized for: the caller's view, else this seat's canvas */
  const zoomOf = (o) => o?.view?.zoom ?? (globalThis.canvas?.stage?.scale?.x || 1);
  function sizeCtx(h) {
    const world = h.space === "world", v = h.opts.view;
    return {
      space: h.space, size: h.opts.size, magnitude: h.opts.magnitude, area: world ? areaOf(h.opts.area) : 0, tokenSpan: world ? h.tokenSpan : 0,
      grid: globalThis.canvas?.grid?.size ?? 100, zoom: world ? zoomOf(h.opts) : 1, vw: v?.vw ?? usableW(), vh: v?.vh ?? innerHeight,
      scale: h.opts.scale ?? 1, sizeK: h.plan.sizeK, aspect: h.plan._holdBox?.w ?? 3, fit: h.opts.fit ?? "legible",
      alive: world ? (v ? v.alive : h.worldAlive ?? 0) : 0, pixel: h.pixel ? artPx(h) : 0,
      /* ENGREG (1.9.11): the caller's share of the ceiling, by its own name `ceil`. The older name `ceilK` never reached the model
         (callers pass it today and their pictures must not change), so it stays unread here */
      ceilK: h.opts.ceil
    };
  }
  /* sizes follow zoom and viewport live (pixel words keep the size they started with: whole art pixels) */
  function resize(h, first) {
    if ( !first && (h.pixel || h.opts.fit === "exact") ) return;
    if ( h.opts.fit === "exact" ) {
      h.size = (h.opts.size ?? (h.space === "world" ? (globalThis.canvas?.grid?.size ?? 100) * 0.6 : 72)) * (h.opts.scale ?? 1) * (h.opts._k ?? 1);
      h.sizeInfo = { size: h.size, px: null, natural: h.size, clamp: null, fit: "exact" };
      return;
    }
    const info = sizeFor(sizeCtx(h));
    h.sizeInfo = info;
    h.size = info.size * (h.opts._k ?? 1);   // the user's size setting, after the legibility clamp (tools)
  }

  /* ---------- pictures ---------- */
  /* pixel mode: one texel per art pixel (the pixel-vfx grid: 32 art px per grid square), shown with nearest-neighbour scaling */
  const artPx = (h) => (typeof h.opts.pixel === "number" ? h.opts.pixel : (canvas?.grid?.size ?? 100) / 32);
  function renderScale(h) {
    const dpr = globalThis.devicePixelRatio || 1;
    if ( h.pixel ) return 1 / artPx(h);
    if ( h.space === "world" ) return Math.max(0.05, (canvas?.stage?.scale?.x || 1)) * dpr;
    return dpr;
  }
  function pxPerUnit(h, rs) {
    let S = h.size * h.plan.sizeK * rs;
    const hb = h.plan._holdBox;
    if ( h.opts.maxWidth && hb?.w ) S = Math.min(S, (h.opts.maxWidth * rs) / hb.w);
    return Math.max(4, S);
  }
  function picture(h, idx, sync) {
    const rs = renderScale(h);
    let c = h.cache[idx];
    /* drawn again when the wanted texel size drifted (zoom, resize): up by 15 % at most, so a small picture is never blown up */
    /* F1: a drifted picture is only marked stale and stays on screen (scaled) until the frame budget lets it be drawn again,
       so one zoom step never repaints every word in the same frame; the old texture is freed once the new one is shown (F0) */
    if ( c && !h.pixel ) { const w = pxPerUnit(h, rs); c.stale = w > c.want * 1.15 || w < c.want * 0.5; }
    if ( c && !(c.stale && sync) ) return c;
    if ( !sync ) return null;
    const old = c;
    const p = h.pics[idx];
    const t0 = now();
    const want = pxPerUnit(h, rs);
    const r = paintPicture(h.plan, bank, p, want, makeCanvas);
    r.rs = rs * (r.S / want);          // texels per display unit actually used (lower when a huge word hit the side cap)
    r.want = want; r.size0 = h.size;   // drawn for this size; place() scales by h.size / size0 until it is drawn again
    r.idx = idx;
    if ( old ) { if ( h.shown === old ) (h.retired ??= []).push(old); else dropPic(old); }
    if ( h.pixel ) hardAlpha(r.canvas);
    r.ms = now() - t0;
    if ( h.space === "world" ) {
      r.tex = new PIXI.Texture(new PIXI.BaseTexture(r.canvas, { scaleMode: h.pixel ? PIXI.SCALE_MODES.NEAREST : PIXI.SCALE_MODES.LINEAR }));
    } else {
      r.canvas.style.position = "absolute";
      const k = r.rs;
      r.canvas.style.width = `${r.canvas.width / k}px`; r.canvas.style.height = `${r.canvas.height / k}px`;
      r.canvas.style.left = `${-r.ax / k}px`; r.canvas.style.top = `${-r.ay / k}px`;
      if ( h.pixel ) r.canvas.style.imageRendering = "pixelated";
    }
    h.cache[idx] = r;
    /* MOTION2: every picture of the same key is this painting (one painting, one texture upload) */
    const key = h.keyIdx ? keyOf(p) : null;
    if ( key != null ) for ( const j of h.keyIdx.get(key) ?? [] ) h.cache[j] = r;
    stats.rendered++; stats.ms += r.ms; if ( r.ms > stats.maxMs ) stats.maxMs = r.ms;
    return r;
  }
  /* 1-bit alpha for pixel art (no soft edge between art pixels) */
  function hardAlpha(cnv) {
    const ctx = cnv.getContext("2d"), d = ctx.getImageData(0, 0, cnv.width, cnv.height), a = d.data;
    for ( let i = 3; i < a.length; i += 4 ) { if ( a[i] < 110 ) a[i] = 0; else { const k = 255 / a[i]; a[i - 3] = Math.min(255, a[i - 3] * k); a[i - 2] = Math.min(255, a[i - 2] * k); a[i - 1] = Math.min(255, a[i - 1] * k); a[i] = 255; } }
    ctx.putImageData(d, 0, 0);
  }
  function dropPic(c) { try { c.tex?.destroy(true); } catch {} if ( c.canvas ) { c.canvas.width = 0; c.canvas.height = 0; c.canvas.remove?.(); } }
  const stats = { rendered: 0, ms: 0, maxMs: 0 };

  /* ---------- schedule of one word ---------- */
  function scheduleOf(h) {
    const tl = h.plan.timeline;
    const pics = [...tl.ent, ...tl.hold, ...tl.exit];
    const eN = tl.ent.length, hN = tl.hold.length;
    h.pics = pics; h.eN = eN; h.hN = hN;
    h.entMs = tl.ent.reduce((a, p) => a + p.ticks * TICK, 0);
    const cycle = tl.hold.reduce((a, p) => a + p.ticks * TICK, 0);
    h.cycle = cycle;
    h.holdMs = Math.max(cycle, h.plan.holdMs);
    h.exitMs = tl.exit.reduce((a, p) => a + p.ticks * TICK, 0);
    /* MOTION2: a track word (invincible style): pictures with the same key are one painting; the motion is a pose per frame */
    h.track = h.plan.motion ?? null;
    if ( h.track ) {
      h.keyIdx = new Map();
      pics.forEach((p, i) => { const k = keyOf(p); if ( k == null ) return; if ( !h.keyIdx.has(k) ) h.keyIdx.set(k, []); h.keyIdx.get(k).push(i); });
      h.gridQ = gridQ(h.plan.on || 2);
    }
  }
  /* a picture's sharing key: an impact accent the flash guard turned off looks like the word itself */
  const keyOf = (p) => (p.key == null ? null : p.key === "impact" && !p.impact ? "base" : p.key);
  /* MOTION2: which picture a track word shows at age t: the entrance and exit by their ticks, the hold picture, and in stepped mode the
     letters' drawings on the shared grid while the hold's motion still has energy */
  function trackPicAt(h, t) {
    const tl = h.plan.timeline;
    const exitStart = h.exitAt ?? (h.loop ? Infinity : h.entMs + h.holdMs);
    if ( t < exitStart ) {
      if ( t < h.entMs ) { let a = 0; for ( let i = 0; i < h.eN; i++ ) { a += tl.ent[i].ticks * TICK; if ( t < a ) return i; } }
      if ( h.hN > 1 ) {
        const ht = t - h.entMs, m = h.track;
        if ( holdEnergy(m, ht, h.holdMs) >= 0.25 ) {
          const q = (m.rate || 2) * TICK, ga = gridAge((h.t0 ?? 0) + (h.lag || 0) + (h.goff || 0), t, q) - h.entMs;
          return h.eN + 1 + (Math.floor(Math.max(0, ga) / q) % (h.hN - 1));
        }
      }
      return h.eN;
    }
    let a = exitStart; for ( let i = 0; i < tl.exit.length; i++ ) { a += tl.exit[i].ticks * TICK; if ( t < a ) return h.eN + h.hN + i; }
    return -1;
  }
  /* which picture is up at time t (ms since start); -1 = finished */
  function picAt(h, t) {
    if ( h.track ) return trackPicAt(h, t);
    const tl = h.plan.timeline;
    const exitStart = h.exitAt ?? (h.loop ? Infinity : h.entMs + h.holdMs);
    if ( t < exitStart ) {
      if ( t < h.entMs ) { let a = 0; for ( let i = 0; i < h.eN; i++ ) { a += tl.ent[i].ticks * TICK; if ( t < a ) return i; } }
      let x = (t - h.entMs) % h.cycle, a = 0; for ( let i = 0; i < h.hN; i++ ) { a += tl.hold[i].ticks * TICK; if ( x < a ) return h.eN + i; } return h.eN;
    }
    let a = exitStart; for ( let i = 0; i < tl.exit.length; i++ ) { a += tl.exit[i].ticks * TICK; if ( t < a ) return h.eN + h.hN + i; }
    return -1;
  }
  /* ADVT 10/9: the picture clock. A word's pictures run on its own age (wall time minus the time it lost waiting for a late picture):
     an entrance or exit picture is never skipped and a late one starts from its beginning, so every seat sees the same drawings for
     the same beats (a slow seat runs a few frames longer instead of jumping over the anticipation or blinking out of the exit). */
  const ageOf = (h, t) => t - h.t0 - (h.lag || 0);
  function picStart(h, i) {
    const tl = h.plan.timeline;
    if ( i < h.eN ) { let a = 0; for ( let k = 0; k < i; k++ ) a += tl.ent[k].ticks * TICK; return a; }
    const x0 = h.eN + h.hN, exitStart = h.exitAt ?? (h.loop ? Infinity : h.entMs + h.holdMs);
    let a = exitStart; for ( let k = x0; k < i; k++ ) a += tl.exit[k - x0].ticks * TICK; return a;
  }
  /* the picture to show now: picAt, except that a skipped entrance/exit picture comes first (and the clock waits for it) */
  function pictureNow(h, t) {
    let age = ageOf(h, t), idx = picAt(h, age);
    const last = h.lastIdx, x0 = h.eN + h.hN, xN = x0 + h.plan.timeline.exit.length;
    if ( last != null && !h.quick && !h.track ) {   // MOTION2: a track word's clock never waits (its pictures are few and shared)
      let want = null;
      if ( last < h.eN - 1 && (idx > last + 1 || idx < 0) && h.exitAt == null ) want = last + 1;                  // inside the entrance
      else if ( (idx < 0 || idx > x0) && last < xN - 1 ) {                                                    // inside the exit
        const exp = last >= x0 ? last + 1 : x0;
        if ( idx < 0 ? exp < xN : idx > exp ) want = exp;
      }
      if ( want != null ) { h.lag = (h.lag || 0) + (age - picStart(h, want)); age = picStart(h, want); idx = want; }
    }
    return { idx, age };
  }
  function nextIdx(h, t) { const cur = picAt(h, t); for ( let dt = 40; dt < 360; dt += 40 ) { const n = picAt(h, t + dt); if ( n !== cur && n >= 0 && !h.cache[n] ) return n; } return -1; }

  function show(h, c) {
    if ( h.shown === c ) return;
    h.shown = c;
    /* F2: free what will not be shown again: the replaced (stale) picture, the entrance once the hold runs, everything before the
       current picture once the exit runs (the hold cycle stays cached: it loops) */
    if ( h.retired ) { for ( const o of h.retired ) if ( o !== c && !h.cache.includes(o) ) dropPic(o); h.retired = null; }
    const i = c.idx ?? -1, exitFrom = h.eN + h.hN;
    if ( h.keyIdx ) {
      /* MOTION2: shared pictures: free a painting only when no drawing still to come uses it (the index shown, not the one painted) */
      const at = h.atIdx ?? i, keep = new Set(h.cache.slice(Math.max(0, at)).filter(Boolean)); keep.add(c);
      for ( let j = 0; j < at; j++ ) { const o = h.cache[j]; if ( o && !keep.has(o) && (j < h.eN || at >= exitFrom) ) { dropPic(o); for ( let k = 0; k < h.cache.length; k++ ) if ( h.cache[k] === o ) h.cache[k] = null; } }
    } else {
      const upTo = i >= exitFrom ? i : Math.min(i, h.eN);   // entrance pictures go as soon as they are passed
      for ( let j = 0; j < upTo; j++ ) { const o = h.cache[j]; if ( o && o !== c && (j < h.eN || i >= exitFrom) ) { dropPic(o); h.cache[j] = null; } }
    }
    if ( h.space === "world" ) {
      h.sprite.texture = c.tex;
      h.sprite.anchor.set(c.ax / c.canvas.width, c.ay / c.canvas.height);
    } else {
      h.box.replaceChildren(c.canvas);
    }
  }
  /* ---------- travel (move.mjs): paths, thrown arcs, beams, orbits around a moving centre ---------- */
  /* a point-like NOW in this word's space: the centre of a token (not the spot above it), a point, a function */
  function pointOf(space, a) {
    if ( a == null ) return null;
    const v = typeof a === "function" ? a() : a;
    if ( v == null ) return null;
    if ( isToken(v) ) {
      const t = tokenObj(v); if ( !t?.center ) return null;
      if ( space === "world" ) return { x: t.center.x, y: t.center.y };
      const g = canvas.stage.toGlobal(t.center), r = canvas.app.view.getBoundingClientRect();
      return { x: r.left + g.x, y: r.top + g.y };
    }
    return Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null;
  }
  function setupTravel(h) {
    const o = h.opts;
    const raw = o.orbit ? o.orbit : o.path;
    if ( !raw ) return;
    const kind = o.orbit ? "orbit" : "path";
    const spec = kind === "orbit" ? { ...raw } : (Array.isArray(raw) ? { points: raw } : pathSpec(raw));
    if ( !spec ) return;
    const R = rng((h.plan.seed ^ 0x2c1b3c6d) >>> 0);
    const tr = h.travel = { kind, spec, on: h.plan.on || 2, orient: spec.orient ?? (kind === "orbit" ? "bend" : "lean") };
    const unit = () => h.size * h.plan.sizeK;
    if ( kind === "orbit" ) {
      tr.center = spec.center ?? h.at;
      tr.dir = spec.dir < 0 ? -1 : 1;
      tr.period = Math.max(300, spec.period ?? 2600);
      tr.phase = Number.isFinite(spec.phase) ? spec.phase : -90 + R.f(-40, 40);
      tr.squash = spec.squash ?? 1; tr.breathe = spec.breathe ?? 0.06;
      const c = typeof tr.center === "function" ? null : tr.center;
      const span = h.space === "world" ? (Number.isFinite(o.span) && o.span > 0 ? o.span : isToken(c) ? Math.max(tokenObj(c)?.document?.width ?? 1, tokenObj(c)?.document?.height ?? 1) * (canvas.grid?.size ?? 100) : 0) : 0;
      tr.R = Number.isFinite(spec.radius) && spec.radius > 0 ? spec.radius : span ? span * 0.85 : areaOf(o.area) || unit() * 2.6;
      tr.bend = tr.orient === "bend" && !h.reducedMotion;
      if ( tr.bend ) {
        /* the word lies on the circle: bend it with the orbit's radius in its own units (twice: the bend changes its width, so
           its size, so its units) */
        for ( let k = 0; k < 2; k++ ) { bendLayout(h.plan, tr.R / unit(), tr.dir); delete h.plan._center; settleCenter(h.plan, bank); resize(h, true); }
        h.offset = { x: h.plan._center[0] - h.plan.layout.W / 2, y: h.plan._center[1] + 0.5 };
      }
      if ( Number.isFinite(spec.turns) && spec.turns > 0 && !h.loop ) h.holdMs = Math.max(h.holdMs, spec.turns * tr.period - h.entMs);
      if ( spec.trail !== false && !h.reducedMotion && !h.track ) addTrail(h.plan, "orbit", 1, () => R.seed());   // MOTION2: no lines popping beside a track word
    } else {
      tr.dur = Math.max(50, spec.duration ?? (h.entMs + h.holdMs));
      tr.loop = !!spec.loop;
      if ( !tr.loop && !h.loop && tr.dur > h.entMs + h.holdMs ) h.holdMs = tr.dur - h.entMs;
      tr.ease = easeOf(spec.ease ?? (spec.arc ? "linear" : "inout"));
      tr.spin = Number.isFinite(spec.spin) ? spec.spin : 0;
      const P = pathPoints(spec, (a) => pointOf(h.space, a)), q = P || spec.fn ? pathAt(P, 0.02, spec) : null;
      const a0 = q ? q.a : 0, r0 = orientAngle(a0, tr.orient);
      if ( spec.trail !== false && !h.reducedMotion && !tr.spin && !h.track ) addTrail(h.plan, "path", Math.cos(a0 - r0) >= 0 ? 1 : -1, () => R.seed());
    }
  }
  /* where a travelling word is at t ms of its life: { x, y, rot } (null: its path or centre is gone and it never had a place) */
  function travelPose(h, t) {
    const tr = h.travel;
    const tt = h.reducedMotion ? 0 : h.track ? Math.max(0, t) : stepT(Math.max(0, t), tr.on);   // MOTION2: a track word travels at the display rate
    if ( tr.kind === "orbit" ) {
      const c = pointOf(h.space, tr.center) ?? tr.lastC ?? (h.space === "world" ? worldPoint({ at: null }) : screenPoint({ at: null }));
      tr.lastC = c;
      const o = orbitAt(tr, tt, c, tr.R);
      return (tr.last = { x: o.x, y: o.y, rot: tr.bend ? o.a : orientAngle(o.a, tr.orient) });
    }
    const P = pathPoints(tr.spec, (a) => pointOf(h.space, a));
    if ( !P && !tr.spec.fn ) return tr.last ?? null;
    let u = h.reducedMotion ? 1 : tt / tr.dur;
    u = tr.loop ? u % 1 : Math.min(1, u);
    const q = pathAt(P, tr.ease(u), tr.spec);
    if ( !q ) return tr.last ?? null;
    return (tr.last = { x: q.x, y: q.y, rot: orientAngle(q.a, tr.orient) + tr.spin * Math.PI * 2 * u });
  }

  /* ---------- knocks: a word pushed aside by a later blast (L.push, play's `push`) ---------- */
  function knockOf(h, t) {
    let x = 0, y = 0, r = 0, s = 1;
    for ( const k of h.knocks ) {
      const u = Math.min(1, (h.track ? t - k.t0 : stepT(t - k.t0, h.plan.on || 2)) / k.dur);
      const e = (1 - (1 - u) ** 3) * (1 + 0.22 * Math.sin(Math.PI * u));   // out fast, overshoot, settle (follow-through)
      x += k.dx * e; y += k.dy * e; r += k.dr * e;
      if ( u < 1 ) s *= 1 + 0.16 * (1 - u) * Math.sin(Math.PI * Math.min(1, u * 2.5));   // the blow squashes it bigger for a moment
    }
    return { x, y, r, s };
  }

  /* ---------- ADVT 1: a word stays inside the view ----------
     The reach of a word around its place (units, from its centre): its hold box, how far its hold drawings move, and how far its
     entrance drawings move (up to 1.2 units: a drop from far above may start outside), plus the ink's outline. Exits may leave. */
  let viewInset = { top: 8, right: 8, bottom: 8, left: 8 };
  function reachOf(h) {
    const hb = h.plan._holdBox ?? { w: 3, h: 1 }, tl = h.plan.timeline;
    /* MOTION2: a track word's reach = its entrance poses around the hold box (the first entrance frame inside the view, FXLD2-4) */
    if ( h.track ) { const e = trackReach(h.track, hb.w, hb.h), pad = 0.18; return { l: e.l + pad, r: e.r + pad, u: e.u + pad, d: e.d + pad }; }
    let l = hb.w / 2, r = hb.w / 2, u = hb.h / 2, d = hb.h / 2;
    const take = (p, cap) => {
      const g = p.g ?? {}, sc = Math.min(1.5, Math.abs((g.s ?? 1) * Math.max(g.sx ?? 1, g.sy ?? 1)));
      const gx = Math.max(-cap, Math.min(cap, g.x ?? 0)), gy = Math.max(-cap, Math.min(cap, g.y ?? 0));
      l = Math.max(l, hb.w / 2 * sc - gx); r = Math.max(r, hb.w / 2 * sc + gx); u = Math.max(u, hb.h / 2 * sc - gy); d = Math.max(d, hb.h / 2 * sc + gy);
    };
    for ( const p of tl.hold ) take(p, 3);
    for ( const p of tl.ent ) take(p, 1.2);
    /* ADVM 7: letters that fall in or rise in from above / below (their own offsets, em) are kept inside the view from the first drawing */
    for ( const p of tl.ent ) for ( const q of p.letters ?? [] ) {
      if ( q.v === 0 || !Number.isFinite(q.y) ) continue;
      const gy = p.g?.y ?? 0, y = Math.max(-3, Math.min(3, q.y + gy));
      u = Math.max(u, hb.h / 2 - y); d = Math.max(d, hb.h / 2 + y);
    }
    const pad = 0.18;
    return { l: l + pad, r: r + pad, u: u + pad, d: d + pad };
  }
  /* SUSTAINGAP: how far a started word's INK reaches from the point it is placed at, in its space's units ({ l, r, u, d, k }): its
     entrance, hold and life poses around the letters (reachOf without the view pad) plus the keyline, rim and duplicate block (paint
     inkPad); null until the word is prepared (its track is not known before). Runs of phrases and stream syllables are spaced by it. */
  function inkBoxOf(h) {
    if ( !h?.plan || !(h.sprite || h.box) ) return null;
    if ( h._ink && h._ink.size === h.size && (h._ink.pic || !h.shown) ) return h._ink;
    const e = { ...reachOf(h) }, k = h.size * h.plan.sizeK, ip = inkPad(h.plan.hand, pxPerUnit(h, renderScale(h))), pad = 0.18;
    /* (a track word whose parts or letters are drawn in from their own offsets, a split phrase's syllables dropping in one by one: the
       pictures carry those offsets, the track does not) */
    if ( h.track ) {
      const hb = h.plan._holdBox ?? { w: 3, h: 1 }, tl = h.plan.timeline;
      for ( const p of [...(tl?.ent ?? []), ...(tl?.hold ?? [])] ) for ( const q of p.letters ?? [] ) {
        if ( !Number.isFinite(q.y) || q.y === 0 ) continue;
        const y = Math.max(-3, Math.min(3, q.y));
        e.u = Math.max(e.u, hb.h / 2 - y + pad); e.d = Math.max(e.d, hb.h / 2 + y + pad);
      }
    }
    /* (the picture as drawn: what it carries around its letters beyond the keyline and rim, a glow, puffs, sparks, is drawn ink too;
       measured on the first picture shown, at the hold box's scale) */
    const c = h.shown;
    if ( c?.canvas && Number.isFinite(c.ax) && c.rs > 0 ) {
      const hb = h.plan._holdBox ?? { w: 3, h: 1 }, u = (h.size / (c.size0 || h.size)) / c.rs / k;
      const m = { l: c.ax * u - hb.w / 2 - ip.l, r: (c.canvas.width - c.ax) * u - hb.w / 2 - ip.r, u: c.ay * u - hb.h / 2 - ip.u, d: (c.canvas.height - c.ay) * u - hb.h / 2 - ip.d };
      for ( const q of ["l", "r", "u", "d"] ) if ( m[q] > 0 ) e[q] += m[q];
    }
    /* (a track word turned: its own rotation and its poses' turns, over the whole entrance and hold) */
    if ( h.track && Number.isFinite(h.entMs) && Number.isFinite(h.holdMs) ) {
      const hb = h.plan._holdBox ?? { w: 3, h: 1 }, W = hb.w + ip.l + ip.r, H = hb.h + ip.u + ip.d;
      const sp = trackSpan(h.track, W, H, h.entMs, h.holdMs, h.rot || 0, (ip.r - ip.l) / 2, (ip.d - ip.u) / 2);
      for ( const q of ["l", "r", "u", "d"] ) e[q] = Math.max(e[q], sp[q] - ip[q] + pad);
    }
    /* (eu / ed: how much further its exit takes it up / down while legible; a track word only: the legacy timeline is not measured) */
    const x = h.track ? exitReach(h.track, h.plan._holdBox?.h ?? 1) : { u: 0, d: 0, drawn: false };
    return (h._ink = { l: (e.l - pad + ip.l) * k, r: (e.r - pad + ip.r) * k, u: (e.u - pad + ip.u) * k, d: (e.d - pad + ip.d) * k, eu: x.u * k, ed: x.d * k, drawn: x.drawn, k, size: h.size, pic: !!c?.canvas });
  }
  /* the visible rectangle in the word's space (world: scene coordinates), minus the insets (sidebar, letterbox, set by L.viewInset) */
  function viewRect(h) {
    const ins = typeof viewInset === "function" ? (viewInset(h.space) ?? {}) : viewInset;
    const sb = globalThis.document?.getElementById?.("sidebar")?.getBoundingClientRect?.();
    const W = globalThis.innerWidth, H = globalThis.innerHeight;
    if ( !Number.isFinite(W) || !Number.isFinite(H) ) return null;
    const right = W - (sb && sb.left > W * 0.5 ? sb.width : 0);
    const L = ins.left ?? 0, T = ins.top ?? 0, R = right - (ins.right ?? 0), B = H - (ins.bottom ?? 0);
    if ( h.space === "screen" ) return { x0: L, y0: T, x1: R, y1: B };
    const st = globalThis.canvas?.stage, view = globalThis.canvas?.app?.view;
    if ( !st?.toLocal || !view?.getBoundingClientRect ) return null;
    const vr = view.getBoundingClientRect(), a = st.toLocal({ x: L - vr.left, y: T - vr.top }), b = st.toLocal({ x: R - vr.left, y: B - vr.top });
    return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
  }
  /* how far to move a word placed at X, Y (its centre) so that its reach fits the view; a word bigger than the view is centred */
  function viewShift(h, X, Y, rot) {
    if ( h.travel || h.opts.keepInView === false || h.opts.parent ) return null;
    const v = viewRect(h); if ( !v ) return null;
    const e = h.reach ??= reachOf(h), k = h.size * h.plan.sizeK;
    const c = Math.abs(Math.cos(rot)), sn = Math.abs(Math.sin(rot));
    const l = (e.l * c + Math.max(e.u, e.d) * sn) * k, r = (e.r * c + Math.max(e.u, e.d) * sn) * k;
    const u = (e.u * c + Math.max(e.l, e.r) * sn) * k, d = (e.d * c + Math.max(e.l, e.r) * sn) * k;
    const fit = (p, lo, hi, a, b) => (hi - lo < a + b ? (lo + hi) / 2 + (a - b) / 2 - p : p - a < lo ? lo + a - p : p + b > hi ? hi - b - p : 0);
    return { dx: fit(X, v.x0, v.x1, l, r), dy: fit(Y, v.y0, v.y1, u, d) };
  }

  function place(h) {
    const t = now(), seen = seenOf(h, t);
    let p, trot = 0;
    if ( h.travel ) { p = travelPose(h, t - (h.t0 ?? t)); if ( !p ) return; trot = p.rot; }
    else { p = h.space === "world" ? worldPoint(h) : screenPoint(h); if ( !p ) return; }
    const k = h.size * h.plan.sizeK;
    /* the anchor offset turns with the travel (a word bent on an orbit keeps its middle on the circle) */
    const c = Math.cos(trot), sn = Math.sin(trot), ox = h.offset.x * k, oy = h.offset.y * k;
    let X = p.x + ox * c - oy * sn, Y = p.y + ox * sn + oy * c;
    const vs = viewShift(h, X, Y, h.rot + trot);
    if ( vs ) { X += vs.dx; Y += vs.dy; }
    h.lastPos = { x: X, y: Y }; h.lastRot = h.rot + trot;
    let kr = 0, ks = 1, ksx = 1, ksy = 1, alpha = 1, dark = 0;
    if ( h.knocks?.length ) { const q = knockOf(h, t); X += q.x; Y += q.y; kr = q.r; ks = q.s; }
    /* MOTION2: a track word's pose (motion.mjs): smooth per display frame; stepped mode reads its drawn channels on the shared grid */
    if ( h.track && h.t0 != null ) {
      const age = ageOf(h, t), hb = h.plan._holdBox ?? { w: 3, h: 1 };
      /* stepped: the entrance on ones (the contact needs every drawing), the hold and exit on the shared grid of twos */
      const tq = h.track.mode === "stepped" ? gridAge(h.t0 + (h.lag || 0) + (h.goff || 0), age, age < h.entMs ? TICK : h.gridQ) : age;
      const P = trackPose(h.track, Math.max(0, age), h.entMs, h.holdMs, h.exitAt, { W: hb.w, H: hb.h }, Math.max(0, tq));
      const r0 = h.rot + trot, cr = Math.cos(r0), sr = Math.sin(r0);
      X += (P.x * cr - P.y * sr) * k; Y += (P.x * sr + P.y * cr) * k;
      kr += P.r; ks *= P.s; ksx = P.sx; ksy = P.sy; alpha = P.a; dark = P.d;
    }
    /* ADVT 8 / ADVD 6: a held word keeps breathing: a slow sway, swell and bob over its whole hold (on the drawing grid), on top of
       its hold drawings, so a 2-3 s hold is never a still picture at viewing size; not for reduced motion, travel or pixel words */
    if ( !h.reducedMotion && !h.travel && !h.pixel && !h.track && h.t0 != null && h.entMs != null ) {
      const ag = ageOf(h, t) - h.entMs;
      if ( ag > 0 ) {
        const u = stepT(ag, h.plan.on || 2) / 1000, ph = (h.plan.seed % 628) / 100, f = Math.min(1, ag / 300) * (0.7 + 0.6 * (h.plan.sound?.loud ?? 0.5));
        kr += f * 0.04 * Math.sin(u * 3.3 + ph); ks *= 1 + f * 0.035 * Math.sin(u * 4.6 + ph * 1.7); Y += f * 0.05 * k * Math.sin(u * 2.7 + ph * 0.6);
      }
    }
    const rot = h.rot + trot + kr;
    if ( h.space === "world" ) {
      h.sprite.visible = seen;
      h.sprite.position.set(X, Y);
      h.sprite.rotation = rot;
      if ( h.shown ) { const b = (1 / h.shown.rs) * (h.size / h.shown.size0) * ks; h.sprite.scale.set(b * ksx, b * ksy); }
      if ( h.track ) {
        h.sprite.alpha = Math.max(0, Math.min(1, alpha)) * (h.opts.hollow ? 0.85 : 1);
        const g = Math.round(255 * (1 - 0.75 * Math.max(0, Math.min(1, dark)))); h.sprite.tint = (g << 16) | (g << 8) | g;
      }
      if ( h.glow ) { placeGlow(h, X, Y, rot, ks, t); h.glow.bloom.visible = seen; if ( h.glow.light ) h.glow.light.visible = seen; }
    } else {
      const vis = seen ? "" : "hidden";
      if ( h.box.style.visibility !== vis ) h.box.style.visibility = vis;
      const f = (h.shown ? h.size / h.shown.size0 : 1) * ks;
      if ( h.track ) {
        h.box.style.transform = `translate(${X.toFixed(1)}px,${Y.toFixed(1)}px) rotate(${rot.toFixed(4)}rad) scale(${(f * ksx).toFixed(4)},${(f * ksy).toFixed(4)})`;
        const op = (Math.max(0, Math.min(1, alpha)) * (h.opts.hollow ? 0.85 : 1)).toFixed(3);
        if ( h.box.style.opacity !== op ) h.box.style.opacity = op;
        if ( !h.glow && !h.opts.glow ) { const fl = dark > 0.01 ? `brightness(${(1 - 0.75 * Math.min(1, dark)).toFixed(3)})` : ""; if ( h.box.style.filter !== fl ) h.box.style.filter = fl; }
      } else
      h.box.style.transform = `translate(${X.toFixed(1)}px,${Y.toFixed(1)}px) rotate(${rot.toFixed(4)}rad)${Math.abs(f - 1) > 1e-3 ? ` scale(${f.toFixed(4)})` : ""}`;
    }
  }

  /* ---------- self-lit words (glow): fire and zap that light up a dark scene ----------
     world: a soft copy of the word's silhouette goes into Foundry's illumination (MAX blend, like a light: the darkness lifts where
     the word is, so the word shows in full colour and lights the ground around it) and an additive bloom sits behind the word in its
     own layer; both follow it and flicker on the drawing grid. screen: a CSS glow around the word. README "Motion: glow". */
  const sceneDark = () => { try { return globalThis.canvas?.environment?.darknessLevel ?? globalThis.canvas?.scene?.environment?.darknessLevel ?? 0; } catch { return 0; } };
  function glowWanted(h) {
    const g = h.opts.glow;
    if ( !g ) return null;
    const auto = g === "auto";
    if ( auto && !GLOW_MOODS.has(h.plan.mood) ) return null;
    if ( auto && h.space === "world" && sceneDark() < 0.25 ) return null;
    const o = typeof g === "object" ? g : {};
    return { color: o.color ?? h.plan.hand.pal.fill[1], strength: Number.isFinite(o.strength) ? o.strength : 1, light: o.light !== false };
  }
  function ensureGlowLayer() {
    const host = globalThis.canvas?.effects?.illumination?.lights;
    if ( !host ) return null;
    if ( !glowLayer || glowLayer.destroyed ) { glowLayer = new PIXI.Container(); glowLayer.name = "moinen-letters-glow"; glowLayer.eventMode = "none"; }
    if ( glowLayer.parent !== host ) host.addChild(glowLayer);
    return glowLayer;
  }
  const mixHex = (a, b, f) => { const c = (x, s) => (x >> s) & 255, m = (s) => Math.round(c(a, s) + (c(b, s) - c(a, s)) * f) << s; return m(16) | m(8) | m(0); };
  const hexOf = (c) => { const m = /^#?([\da-f]{6})$/i.exec(String(c).trim()); return m ? parseInt(m[1], 16) : 0xffd060; };
  function makeGlow(h) {
    const w = h.glowWant; h.glowWant = null;
    const S = Math.max(6, pxPerUnit(h, renderScale(h)) / 4);
    const pic = paintPicture(h.plan, bank, { ...h.plan.timeline.hold[0], fx: [], dissolve: 0 }, S, makeCanvas);
    const pad = Math.ceil(S * 0.9), cnv = makeCanvas(pic.canvas.width + pad * 2, pic.canvas.height + pad * 2), ctx = cnv.getContext("2d");
    try { ctx.filter = `blur(${Math.max(1, S * 0.28).toFixed(1)}px)`; } catch {}
    ctx.drawImage(pic.canvas, pad, pad);
    try { ctx.filter = "none"; } catch {}
    ctx.globalCompositeOperation = "source-in"; ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cnv.width, cnv.height);
    const ax = (pic.ax + pad) / cnv.width, ay = (pic.ay + pad) / cnv.height, S2 = pic.S;
    dropPic(pic);
    const tex = new PIXI.Texture(new PIXI.BaseTexture(cnv));
    const col = hexOf(w.color);
    const bloom = new PIXI.Sprite(tex); bloom.anchor.set(ax, ay); bloom.blendMode = PIXI.BLEND_MODES.ADD; bloom.tint = col; bloom.eventMode = "none";
    const parent = h.sprite.parent;
    if ( parent ) { bloom.zIndex = h.sprite.zIndex - 0.5; parent.addChildAt(bloom, Math.max(0, parent.getChildIndex(h.sprite))); }
    let light = null;
    const lay = w.light ? ensureGlowLayer() : null;
    if ( lay ) { light = new PIXI.Sprite(tex); light.anchor.set(ax, ay); light.blendMode = PIXI.BLEND_MODES.MAX_COLOR ?? PIXI.BLEND_MODES.ADD; light.tint = mixHex(col, 0xffffff, 0.45); light.eventMode = "none"; lay.addChild(light); }
    h.glow = { tex, cnv, bloom, light, S: S2, strength: w.strength, seed: h.plan.seed, flick: h.plan.mood === "zap" ? 0.45 : 0.22 };
  }
  function glowCss(h, w) {
    const k = Math.min(48, h.size * h.plan.sizeK), c = w.color;
    h.box.style.filter = `drop-shadow(0 0 ${(k * 0.1).toFixed(1)}px ${c}) drop-shadow(0 0 ${(k * 0.32 * w.strength).toFixed(1)}px ${c})`;
  }
  function placeGlow(h, X, Y, rot, ks, t) {
    const g = h.glow, sc = ((h.size * h.plan.sizeK) / g.S) * ks;
    const dark = Math.min(1, Math.max(0, sceneDark()));
    /* flicker per drawing (on the drawing grid, seeded: the same on every client), fading in with the entrance and out with the exit */
    const step = Math.floor(stepT(t - h.t0, h.plan.on || 2) / TICK_MS);
    const fl = h.reducedMotion ? 1 : 1 - g.flick + g.flick * ((hash(`${g.seed}:${step}`) % 1000) / 1000);
    const ex = h.exitAt != null || (!h.loop && ageOf(h, t) > h.entMs + h.holdMs) ? Math.max(0, 1 - (ageOf(h, t) - (h.exitAt ?? h.entMs + h.holdMs)) / Math.max(1, h.exitMs)) : 1;
    const ent = Math.min(1, ageOf(h, t) / Math.max(1, h.entMs * 0.6));
    const a = g.strength * fl * ex * ent;
    for ( const [sp, k, al] of [[g.bloom, 1.15, (0.18 + 0.55 * dark) * a], [g.light, 1.6, Math.min(1, 0.95 * a)]] ) {
      if ( !sp || sp.destroyed ) continue;
      sp.position.set(X, Y); sp.rotation = rot; sp.scale.set(sc * k); sp.alpha = al;
    }
  }
  function dropGlow(h) {
    const g = h.glow; if ( !g ) return;
    h.glow = null;
    for ( const sp of [g.bloom, g.light] ) { try { sp?.destroy({ texture: false }); } catch {} }
    try { g.tex.destroy(true); } catch {}
    g.cnv.width = 0; g.cnv.height = 0;
  }

  /* ---------- push: a later blast shoves the words around it aside (README "Motion: push") ---------- */
  function push(at, o = {}) {
    const space = o.space === "world" ? "world" : "screen";
    const P = pointOf(space, at);
    if ( !P ) return 0;
    const unit = space === "world" ? (globalThis.canvas?.grid?.size ?? 100) : Math.max(60, innerHeight * 0.085);
    const radius = Number.isFinite(o.radius) && o.radius > 0 ? o.radius : unit * 3, force = Number.isFinite(o.force) ? o.force : unit * 0.9;
    const R = rng(hash(`${o.seed ?? ""}:${Math.round(P.x)}:${Math.round(P.y)}`));
    let n = 0;
    for ( const h of [...clips].sort((a, b) => (a.id < b.id ? -1 : 1)) ) {
      if ( h.space !== space || h === o.except || !h.alive || !h.lastPos || h.opts.pushable === false || h.reducedMotion ) continue;
      const dx = h.lastPos.x - P.x, dy = h.lastPos.y - P.y, d = Math.hypot(dx, dy);
      if ( d > radius ) continue;
      const f = force * (1 - d / radius) ** 0.7, a = d > 1e-3 ? Math.atan2(dy, dx) : R.f(0, Math.PI * 2);
      const k = h.size * h.plan.sizeK;
      (h.knocks ??= []).push({ t0: now(), dx: Math.cos(a) * f, dy: Math.sin(a) * f, dr: (Math.cos(a) >= 0 ? 1 : -1) * Math.min(0.55, (f / Math.max(1, k)) * 0.22), dur: 320 });
      /* old knocks are folded into the word's offset (a bounded list) */
      while ( h.knocks.length > 6 ) { const old = h.knocks.shift(); h.offset = { x: h.offset.x + old.dx / k, y: h.offset.y + old.dy / k }; h.rot += old.dr; }
      n++;
    }
    kick();
    return n;
  }

  /* ---------- echoes: copies of a word that answer it, smaller and hollow, fading (README "Motion: choreography") ---------- */
  function spawnEcho(h, k) {
    const e = h.echo, p = h.lastPos;
    if ( !p ) return;
    const unit = h.size * h.plan.sizeK, a = (e.dir * Math.PI) / 180;
    const d = e.gap * unit * k * (1 + 0.15 * (k - 1));
    const o = h.opts;
    const c = play(h.text, {
      mood: h.plan.mood, space: h.space, layer: o.layer, fit: o.fit, magnitude: o.magnitude, area: o.area, span: h.tokenSpan || o.span, size: o.size, colors: o.colors, pixel: o.pixel, parent: o.parent, sound: o.sound,
      scale: (o.scale ?? 1) * e.shrink ** k, at: { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d }, hand: h.plan.hand,
      seed: o.seed != null ? `${o.seed}:echo${k}` : undefined, in: "pop", holdKind: "boil", out: "dissolve", hold: e.hold, tempo: o.tempo, on: o.on, fps: o.fps,
      reduced: false, hollow: e.hollow, rotation: ((h.lastRot ?? h.rot) * 180) / Math.PI + (k % 2 ? 4 : -4), zIndex: o.zIndex
    });
    c.isEcho = true;
    (h.echoes ??= []).push(c);
  }

  /* ---------- escalation: the same sound on the same source within a short time grows, merges ("BAM BAM BAM") and counts ("BAM ×5")
     Memory per client, keyed by space + source + the word; pass `escalate: { n }` for a level the caller decides (the same everywhere). */
  function sourceKey(at, space) {
    if ( at == null ) return "view";
    if ( typeof at === "function" ) return null;
    if ( typeof at === "string" ) return at;
    if ( isToken(at) ) return tokenObj(at)?.id ?? at.id ?? null;
    if ( Number.isFinite(at.x) ) { const g = space === "world" ? (globalThis.canvas?.grid?.size ?? 100) : 64; return `${Math.round(at.x / g)},${Math.round(at.y / g)}`; }
    return null;
  }
  function escalate(h, opts) {
    const e = opts.escalate;
    if ( !e ) return opts;
    const cfg = typeof e === "object" ? e : typeof e === "string" ? { key: e } : {};
    const win = Number.isFinite(cfg.window) ? cfg.window : 1600, max = Math.max(1, cfg.max ?? 3), mode = cfg.mode ?? "auto";
    const base = h.text.trim();
    const norm = base.toLocaleUpperCase("pl").replace(/[^\p{L}\p{N}]/gu, "");
    const src = cfg.key ?? opts.source ?? sourceKey(h.at, h.space);
    if ( src == null && !Number.isFinite(cfg.n) ) return opts;
    const key = `${h.space}|${src}|${norm}`, t = now();
    for ( const [k, v] of escMem ) if ( t - v.t > v.win * 2 ) escMem.delete(k);
    const prev = escMem.get(key);
    const n = Number.isFinite(cfg.n) ? Math.max(1, Math.floor(cfg.n)) : prev && t - prev.t <= win ? prev.n + 1 : 1;
    escMem.set(key, { n, t, win, h });
    const m = n < 2 ? "first" : mode === "auto" ? (n <= max ? "merge" : "count") : mode;
    h.escalation = { key, n, mode: m };
    if ( n < 2 ) return opts;
    const o = { ...opts }, k = n - 1;
    o.magnitude = Math.min(2, magnitudeOf(opts.magnitude) + Math.min(0.9, 0.2 * k));
    o.scale = (opts.scale ?? 1) * Math.min(1.45, 1 + 0.08 * k);
    const live = prev?.h && prev.h !== h && prev.h.alive && prev.h.plan ? prev.h : null;
    if ( live ) { o.hand = live.plan.hand; if ( typeof h.at !== "function" ) h.at = live.at; }
    if ( m === "merge" ) {
      const reps = Math.min(n, max), beat = opts.beat ?? 150;
      h.text = Array(reps).fill(base).join(" ");
      /* the repeats already up stay where they are; only the newest lands (on its own beat), knocking them */
      o.parts = Array.from({ length: reps }, (_, i) => ({ text: base, at: live ? (i < reps - 1 ? -1 : 0) : i * beat }));
    } else if ( m === "count" ) {
      h.text = `${base} ×${n}`;
      o.parts = [{ text: base, at: live ? -1 : 0 }, { text: `×${n}`, at: live ? 0 : 170, scale: 0.85 }];
    }
    if ( live ) live.stop({ quick: m !== "grow" });
    return o;
  }

  /* FXLE F4/F8: every way a word ends goes through here: it leaves the live set AND the waiting/queued set, its timer is cleared,
     every picture (cached and retired) is freed, and BOTH promises settle (ready with false when it never showed) */
  function finish(h, why) {
    if ( !h.alive ) return;
    h.alive = false;
    clips.delete(h); pending.delete(h);
    if ( h.timer ) { clearTimeout(h.timer); h.timer = 0; }
    for ( const c of new Set(h.cache) ) if ( c ) dropPic(c);   // MOTION2: a shared painting is freed once
    h.cache.length = 0;
    if ( h.retired ) { for ( const c of h.retired ) dropPic(c); h.retired = null; }
    dropGlow(h);
    if ( h.plan?._shardSrc ) { for ( const c of h.plan._shardSrc.values() ) dropPic(c); h.plan._shardSrc.clear(); }
    if ( h.space === "world" ) { try { h.sprite?.destroy({ children: true, texture: false }); } catch {} }
    else h.box?.remove();
    if ( !h.isReady ) h._ready(false);
    h._done(why);
  }

  /* FXLE F3: a new word gets ready here, in the frame loop and within the first-picture budget: its geometry, size, schedule, sprite
     or box, the limit; then its first picture is painted when it is due. A big burst so comes up over a few frames instead of
     blocking the page in one call. Without `startAt` a word's clock starts when its first picture is shown (no entrance is skipped). */
  function prepare(h) {
    const opts = h.opts, space = h.space;
    if ( space === "world" && !globalThis.canvas?.ready ) { finish(h, "evicted"); return; }
    if ( isToken(h.at) && !tokenObj(h.at) ) { warnOnce("tok-missing", "LETR | a word's token is not on this scene; the word is skipped"); finish(h, "evicted"); return; }
    settleCenter(h.plan, bank);
    /* an orbit (or a looping path) tied to a Promise lasts as long as the thing it circles: until the Promise settles */
    h.loop = !!opts.loop || (!!opts.until?.then && opts.loop !== false && !!(opts.orbit || opts.path?.loop));
    h.tokenSpan = tokenSpanOf(h);
    h.worldAlive = space === "world" ? count({ space: "world" }) : 0;
    resize(h, true);
    if ( ext.plan.length ) { for ( const f of ext.plan ) f(h.plan, h); h.hand = h.plan.hand.id; }
    h.rot = ((opts.rotation ?? 0) * Math.PI) / 180;
    const anchor = opts.anchor ?? (isToken(h.at) ? "bottom" : "center");
    h.offset = { x: 0, y: anchor === "bottom" ? -(h.plan._holdBox.h / 2 + 0.1) : 0 };
    scheduleOf(h);
    if ( space === "world" ) worldPoint(h); else screenPoint(h);   // first known point (elevation at a point, F11)
    /* move (README "Motion"): travel, echoes, push, glow */
    const reduced = h.reducedMotion;
    if ( opts.path || opts.orbit ) { h.offset = { x: 0, y: 0 }; setupTravel(h); }
    if ( opts.echo && !reduced ) {
      const e = typeof opts.echo === "object" ? opts.echo : { n: opts.echo === true ? 2 : Number(opts.echo) };
      h.echo = { n: Math.max(1, Math.min(5, Math.floor(e.n ?? 2) || 2)), k: 1, every: e.every ?? 190, first: e.first ?? 70, gap: e.gap ?? 1.0, shrink: e.shrink ?? 0.74, hold: e.hold ?? 240, hollow: e.hollow ?? true,
        dir: Number.isFinite(e.dir) ? e.dir : Number.isFinite(h.fromDeg) ? h.fromDeg + 180 : 62 };
    }
    if ( opts.push && !reduced ) {
      const q = typeof opts.push === "object" ? opts.push : {}, unit = h.size * h.plan.sizeK;
      h.pushCfg = { radius: q.radius ?? Math.max(unit * 4.5, areaOf(opts.area) * 1.6), force: q.force ?? unit * 2, seed: opts.seed };
      /* at the contact: the first picture with an impact flash or a burst (else half-way through the entrance) */
      const ent = h.plan.timeline.ent; let a = 0, at = null;
      for ( const p of ent ) { if ( p.impact || p.fx?.some((f) => f.k === "burst") ) { at = a * TICK; break; } a += p.ticks; }
      h.pushT = at ?? h.entMs * 0.5;
    }
    const gw = glowWanted(h);
    /* the limit: the oldest word of the same space leaves at once (a limit under 1 lets no word in) */
    const lim = Math.max(0, Math.floor(Number(limits[space]) || 0));
    if ( lim < 1 ) { finish(h, "evicted"); return; }
    const same = [...clips].filter((c) => c.space === space);
    while ( same.length && same.length >= lim ) same.shift().stop({ quick: true, why: "evicted" });
    if ( space === "world" ) {
      const parent = ensureWorld(h);
      h.sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
      h.sprite.eventMode = "none";
      h.sprite.zIndex = opts.zIndex ?? h.seq;
      h.sprite.rotation = h.rot;
      if ( opts.hollow ) h.sprite.alpha = 0.85;
      parent.addChild(h.sprite);
      if ( gw ) h.glowWant = gw;
    } else {
      const lay = ensureLayer(h);
      h.box = document.createElement("div");
      h.box.className = "moinen-letter";
      Object.assign(h.box.style, { position: "absolute", left: "0", top: "0", width: "0", height: "0", zIndex: String(opts.zIndex ?? h.seq), willChange: "transform" });
      if ( opts.hollow ) h.box.style.opacity = "0.85";
      lay.appendChild(h.box);
      if ( gw ) glowCss(h, gw);
    }
    pending.delete(h);
    clips.add(h);
    /* startAt: a performance.now() time on this page's clock (an effect's own t0): the word joins its timeline there */
    h.t0 = Number.isFinite(opts.startAt) ? opts.startAt : null;
    /* MOTION2 (stepped): a word starts on the shared drawing grid, so every word's drawings change on the same instants */
    if ( h.track?.mode === "stepped" ) {
      h.goff = gridOff();   // MODE: the shared grid's phase on this page, fixed for the word's life
      if ( h.t0 == null ) h.t0 = gridCeil(now() + h.goff, h.gridQ) - h.goff;
    }
  }

  /* ---------- the one animation loop ---------- */
  function frame() {
    raf = 0;
    const t = now();
    let budget = BUDGET_MS, first = FIRST_MS, firstN = 0;
    const firstOk = () => first > 0 || firstN === 0;
    /* new words, oldest first */
    while ( queue.length && firstOk() ) {
      const h = queue.shift(); if ( !h.alive ) continue;
      const t1 = now();
      try { prepare(h); } catch ( e ) { console.warn("LETR | word failed", e); finish(h, "evicted"); }
      first -= now() - t1;
      if ( !h.alive ) continue;
      firstN++;   // its first picture is painted below in this frame when it is due (charged to the same budget)
    }
    let worldN = 0; for ( const h of clips ) if ( h.space === "world" ) worldN++;
    let redraws = 0, painted = 0, forced = 0;
    if ( clips.size ) screenZ();
    for ( const h of [...clips] ) {
      try {
        if ( !h.shown ) {
          /* FXLE F7: a word with a future startAt shows nothing (and is not ready) until its time; its first picture is drawn ahead */
          if ( h.t0 != null && t < h.t0 ) { if ( !h.cache[0] && budget > 0 ) { const t1 = now(); picture(h, 0, true); budget -= now() - t1; } continue; }
          if ( !(first > 0 || painted === 0) ) continue;
          const idx = h.t0 == null ? 0 : picAt(h, t - h.t0);
          if ( idx < 0 ) { finish(h, h.stopWhy ?? "done"); continue; }
          if ( h.space === "world" ) h.worldAlive = worldN;
          resize(h, false);
          const t1 = now();
          const c = picture(h, idx, true);
          first -= now() - t1; painted++;
          if ( h.t0 == null ) h.t0 = now();
          h.atIdx = idx; show(h, c); place(h); h.lastIdx = idx;
          if ( !h.isReady ) { h.isReady = true; h._ready(true); for ( const f of ext.start ) { try { f(h); } catch ( e ) { console.warn("LETR | start hook", e); } } }
          continue;
        }
        const { idx, age } = pictureNow(h, t);
        if ( idx < 0 ) { finish(h, h.stopWhy ?? "done"); continue; }
        if ( h.space === "world" ) h.worldAlive = worldN;
        resize(h, false);
        refreshElevation(h, t);
        place(h);
        if ( h.gone && h.stopWhy == null ) h.stop();   // F11: its token went away: the word plays its exit where it last was
        let c = picture(h, idx, false);
        if ( c?.stale && budget > 0 && redraws < MAX_REDRAWS ) { redraws++; const t1 = now(); c = picture(h, idx, true); budget -= now() - t1; }
        const timed = idx < h.eN || idx >= h.eN + h.hN;   // an entrance / exit drawing: its beat matters
        /* not pre-rendered: draw it now unless the frame is over budget (then the older picture stays; an entrance or exit drawing is
           drawn anyway, two per frame at most: holding the previous one would stretch the wind-up or freeze the exit) */
        if ( !c && (budget > 0 || (timed && forced < 2)) ) { if ( budget <= 0 ) forced++; const t1 = now(); c = picture(h, idx, true); budget -= now() - t1; }
        if ( c ) {
          h.atIdx = idx;
          const was = h.shown; show(h, c); if ( was !== h.shown ) place(h);
          if ( was !== h.shown && timed && idx !== h.lastIdx && !h.track ) {
            /* a late drawing starts from its beginning (a frame of slack): the next one is not cut short */
            const late = age - picStart(h, idx);
            if ( late > TICK ) h.lag = (h.lag || 0) + late - TICK / 2;
          }
          h.lastIdx = idx;
        } else if ( timed && idx !== h.lastIdx && h.lastIdx != null && !h.track ) h.lag = (h.lag || 0) + (age - picStart(h, idx));   // waiting: the clock waits too
        /* move: a blast pushes its neighbours at its contact, echoes answer after the landing, a self-lit word gets its glow */
        if ( h.pushT != null && age >= h.pushT && h.lastPos ) { h.pushT = null; push({ ...h.lastPos }, { ...h.pushCfg, space: h.space, except: h }); }
        if ( h.echo && h.echo.k <= h.echo.n && !h.stopWhy && age >= h.entMs + h.echo.first + (h.echo.k - 1) * h.echo.every ) { spawnEcho(h, h.echo.k); h.echo.k++; }
        if ( h.glowWant && h.sprite && (budget > 0 || !h.glowTried) ) { h.glowTried = true; const t1 = now(); try { makeGlow(h); } catch ( e ) { h.glowWant = null; console.warn("LETR | glow", e); } budget -= now() - t1; }
      } catch ( e ) { console.warn("LETR | word failed", e); finish(h, "evicted"); }
    }
    /* pre-render what comes next, nearest first */
    for ( const h of clips ) {
      if ( budget <= 0 ) break;
      if ( h.t0 == null ) continue;
      const n = nextIdx(h, ageOf(h, t));
      if ( n >= 0 ) { const t1 = now(); picture(h, n, true); budget -= now() - t1; }
    }
    if ( clips.size || queue.length ) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if ( !raf ) raf = requestAnimationFrame(frame); };

  /* ---------- API ---------- */
  /* FXLE F3: a text longer than MAX_CHARS is cut (with an ellipsis) */
  function textOf(text) {
    const s = String(text ?? ""), cps = [...s];
    if ( cps.length <= MAX_CHARS ) return s;
    warnOnce("long-text", `LETR | text longer than ${MAX_CHARS} characters is cut`);
    return cps.slice(0, MAX_CHARS - 1).join("") + "…";
  }
  /* FXLE F18: `hand` may be a handle's `hand` string: the recent hand of that id (the exact look), else design.mjs reads the id */
  function handOpt(o) {
    if ( typeof o.hand === "string" ) { const x = hands.get(o.hand); return x ? { ...o, hand: x } : o; }
    if ( o.hand != null && typeof o.hand !== "object" ) { const c = { ...o }; delete c.hand; return c; }
    return o;
  }
  function remember(hand) { hands.delete(hand.id); hands.set(hand.id, hand); if ( hands.size > 128 ) hands.delete(hands.keys().next().value); }
  /* FXLE F23: a character no font can letter is drawn as "?": say so once per character */
  function warnGlyphs() { if ( bank.missing?.size ) for ( const ch of bank.missing ) warnOnce(`glyph:${ch}`, `LETR | no font has "${ch}" (U+${ch.codePointAt(0).toString(16).toUpperCase()}); drawn as "?"`); }
  const settle = (p, f) => { try { if ( p && typeof p.then === "function" ) p.then(f, f); } catch {} };

  function play(text, opts0 = {}) {
    let opts = filterOpts(handOpt(cleanOpts(opts0)));
    if ( opts === null ) return offHandle(text, opts0);
    const space = opts.space === "world" ? "world" : "screen";
    if ( !readyP ) ready();
    let done, rdy;
    const h = {
      id: `letr${++seq}`, seq, text: textOf(text), space, opts, alive: true, isReady: false, cache: [], shown: null, timer: 0,
      ready: new Promise((r) => (rdy = r)), finished: new Promise((r) => (done = r)),
      stop(o = {}) {
        if ( !h.alive ) return;
        h.stopWhy = o.why ?? "stopped";
        if ( o.quick || !h.shown || h.t0 == null ) { finish(h, h.stopWhy); return; }   // nothing on screen yet: it simply ends
        const t = ageOf(h, now()), natural = h.loop ? Infinity : h.entMs + h.holdMs;
        if ( !(h.exitAt != null && h.exitAt <= t) && t < natural ) h.exitAt = t;
        h.loop = false;
        kick();
      },
      moveTo(at) { h.at = at; h.gone = false; },
      /* FIN-ENGINE: this page's performance.now() of the word's contact (null until its start is known) */
      get contactAt() { return contactAt(h); }
    };
    h._done = done; h._ready = rdy;
    h.at = opts.at;
    h.pixel = space === "world" && !!opts.pixel;
    /* plan the word (cheap, synchronous when it starts now: `hand` and `plan` are set on return); the heavy part waits for the frame loop */
    const start = () => {
      h.timer = 0;
      if ( !h.alive ) return;
      try {
        if ( space === "world" && !globalThis.canvas?.ready ) { finish(h, "evicted"); return; }
        /* escalation (the same sound again on the same source) may change the text, its parts, size, place and hand */
        opts = escalate(h, opts); h.opts = opts;
        const reduced = opts.reduced ?? reducedPref();
        h.reducedMotion = !!reduced;
        let from = opts.from;
        if ( from && typeof from === "object" ) {
          if ( Number.isFinite(from.x) && Number.isFinite(from.y) ) { const p = space === "world" ? worldPoint(h) : screenPoint(h); from = p ? Math.atan2(from.y - p.y, from.x - p.x) * 180 / Math.PI : null; }
          else from = null;
        } else if ( from != null && !Number.isFinite(from) ) from = null;
        for ( let i = memory.length - 1; i >= 0; i-- ) if ( now() - memory[i].t > MEMORY_MS ) memory.splice(i, 1);
        const mem = opts.seed == null ? memory.map((m) => m.id) : [];
        const grp = opts._group;
        const avoid = [...(Array.isArray(opts.avoid) ? opts.avoid : []), ...(grp?.used ?? [])];
        let plan = mk(h.text, { ...opts, avoid, reduced, from }, fontsApi, mem);
        /* FXLE F16: a burst guarantees a different hand per word, also when its items have delays or share one seed */
        for ( let r = 1; grp && grp.used.includes(plan.hand.id) && r <= 6; r++ )
          plan = mk(h.text, { ...opts, avoid, reduced, from, seed: opts.seed != null ? `${opts.seed}~${r}` : undefined }, fontsApi, mem);
        if ( grp ) grp.used.push(plan.hand.id);
        h.plan = plan; h.fromDeg = Number.isFinite(from) ? from : null;
        if ( opts.seed == null ) memory.push({ id: plan.hand.id, t: now() });
        h.hand = plan.hand.id;
        remember(plan.hand);
        warnGlyphs();
        queue.push(h);
        kick();
      } catch ( e ) { console.warn("LETR | word failed", e); finish(h, "evicted"); }
    };
    pending.add(h);
    settle(opts.until, () => h.stop());
    const go = () => { if ( bank.has("bangers") || bank.has("anton") ) start(); else readyP.then(start, (e) => { console.warn("LETR", e); finish(h, "evicted"); }); };
    if ( opts.delay > 0 ) h.timer = setTimeout(() => { h.timer = 0; if ( h.alive ) go(); }, opts.delay); else go();
    return h;
  }
  /* FIN-ENGINE (FXIS-E1 / FXIT-E3): when a word's contact shows, on this page's performance.now() clock. x = a handle or a plan;
     startAt = the word's start (default: the handle's own start once known). Smooth motion and the legacy pictures: start + contactMs;
     stepped motion: the next instant of the shared 24 Hz grid at or after it (its entrance is drawn on ones). null when unknown. */
  function contactAt(x, startAt) {
    const plan = x?.plan ?? (x?.timeline ? x : null);
    if ( !plan || !Number.isFinite(plan.contactMs) ) return null;
    const t0 = Number.isFinite(startAt) ? startAt : x?.plan && Number.isFinite(x.t0) ? x.t0 + (x.lag || 0) : Number.isFinite(x?.opts?.startAt) ? x.opts.startAt : null;
    if ( t0 == null ) return null;
    const t = t0 + plan.contactMs;
    if ( !(plan.motion?.mode === "stepped" && plan.motion.in !== "fade") ) return t;
    const g = Number.isFinite(x?.goff) ? x.goff : gridOff();   // MODE: the shared grid (same instant on every seat)
    return Math.ceil((t + g) / TICK - 1e-9) * TICK - g;
  }
  /* lettering is off on this client (tools: the master switch): a handle that is already over */
  function offHandle(text, opts) {
    return { id: `letr${++seq}`, seq, text: textOf(text), space: opts?.space === "world" ? "world" : "screen", opts: opts ?? {}, alive: false, off: true, hand: null,
      isReady: false, ready: Promise.resolve(false), finished: Promise.resolve("evicted"), stop() {}, moveTo() {} };
  }

  /* ---------- streams: a sound that repeats or lasts as long as an effect (ratatata of a gun, a crackling fire) ---------- */
  /* one syllable's natural size: the model's size for this stream (token, area, magnitude; a screen stream: the view's height), 62 % of a
     whole word; play() then clamps every syllable to the legible range (on the caller's view, else with the live zoom) */
  const STREAM_UNIT = 0.62;
  function streamUnitOf(o) {
    const space = o.space === "world" ? "world" : "screen";
    const view = o.view !== undefined ? cleanView(o.view) : null;
    const fake = { space, opts: { magnitude: o.magnitude, area: o.area, span: o.span, token: o.token ?? (isToken(o.at) ? o.at : null), ...(view ? { view } : {}) }, at: o.at, pixel: false, plan: { sizeK: 1, _holdBox: { w: 1.2 } } };
    fake.tokenSpan = space === "world" ? tokenSpanOf(fake) : 0;
    const c = sizeCtx(fake); c.fit = "world";
    return sizeFor(c).natural * 0.62;   // = STREAM_UNIT (the literal stays: callers pin it)
  }
  /* syllable i's share of the unit: loudness 0..1 (0.85 .. 1.1), the first syllable 15 % bigger */
  const sylK = (i, loud) => (0.85 + 0.25 * loud) * (i === 0 ? 1.15 : 1);
  /* ENGVIEW (1.9.18): what a stream's syllables are played with, for a caller that plans with them (no mirrored 0.62 / 0.85 / 1.15):
     { unit (the stream's syllable unit: `size` when given, else the engine's), sizeOf(i, loud = 1): the `size` syllable i is played with
     (before the clamp, like a word's `size`), fit, view } */
  function streamUnit(o0 = {}) {
    const o = o0 && typeof o0 === "object" ? o0 : {};
    const unit = Number.isFinite(o.size) && o.size > 0 ? o.size : streamUnitOf(o);
    const lv = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1);
    return { unit, sizeOf: (i = 1, loud = 1) => unit * sylK(Math.max(0, Math.floor(i) || 0), lv(loud)), fit: o.fit ?? "legible", view: o.view !== undefined ? cleanView(o.view) : null };
  }
  function stream(o0 = {}) {
    const o = { ...(o0 && typeof o0 === "object" ? o0 : {}) };
    /* WORD (v5): a sound kind instead of a text: the vocabulary gives the syllables and the mood */
    if ( o.kind != null && o.text == null && !(Array.isArray(o.syllables) && o.syllables.length) ) { const w = vocab.word(o.kind, { ...o, stream: true }); Object.assign(o, { mood: o.mood ?? w.mood, syllables: w.syllables }); }
    /* FXLE F20: numbers checked; a bad one is ignored with one warning */
    const num = (k, ok, d) => {
      if ( o[k] == null ) return d;
      if ( typeof o[k] === "number" && Number.isFinite(o[k]) && ok(o[k]) ) return o[k];
      warnOnce(`stream:${k}`, `LETR | stream option ${k} = ${String(o[k])} ignored (not a usable number)`);
      return d;
    };
    const space = o.space === "world" ? "world" : "screen";
    const syl = Array.isArray(o.syllables) && o.syllables.length ? o.syllables.map(String) : syllablesOf(o.text ?? "RA-TA-TA");
    const every = num("every", (v) => v >= 20, 110), life = num("life", (v) => v > 0, o.orbit ? 720 : o.path ? 520 : 340);
    const on = onOf(o) || 2;   // travel of the syllables steps on the drawing grid (README "Motion: frame rate")
    let orbitR = null;
    const cnt = num("count", (v) => v >= 0, undefined), duration = num("duration", (v) => v > 0, undefined), delay = num("delay", (v) => v >= 0, 0);
    const fixedSize = num("size", (v) => v > 0, undefined);
    let startAt = num("startAt", () => true, undefined);
    if ( startAt > now() + FUTURE_MS ) { warnOnce("opt:startAt", "LETR | startAt is far in the future: it must be this page's performance.now(); ignored"); startAt = undefined; }
    const mood = cleanOpts({ mood: o.mood ?? "impact" }).mood;
    const seedBase = o.seed ?? `s${(Math.random() * 1e9) | 0}`;
    const handles = [], timers = new Set();
    let k = 0, emitted = 0, hand = null, alive = true, done;
    const finished = new Promise((r) => (done = r));
    const srcH = { at: o.at };   // keeps the last point of a moving source, and notices a source token that went away (F11)
    const src = () => (space === "world" ? worldPoint(srcH) : screenPoint(srcH));
    const dirAt = (p) => {
      let to = null;
      try { to = typeof o.to === "function" ? o.to() : o.to; } catch { to = null; }
      if ( to ) { const q = isToken(to) ? (space === "world" ? worldPoint({ at: to }) : screenPoint({ at: to })) : to; if ( q && p && Number.isFinite(q.x) && Number.isFinite(q.y) ) return Math.atan2(q.y - p.y, q.x - p.x); }
      return ((Number.isFinite(o.dir) ? o.dir : -90) * Math.PI) / 180;
    };
    const tokenRef = o.token ?? (isToken(o.at) ? o.at : undefined);
    /* one syllable's natural size: the model's size for this stream (token, area, magnitude), 62 % of a whole word; play() then
       clamps every syllable to the legible range with the live zoom */
    const streamUnit = () => streamUnitOf({ ...o, space, token: tokenRef ?? null });
    /* ENGVIEW: a caller's view and scale reach every syllable, as they reach a single word (sizes for the view, not this seat's window) */
    const view = o.view !== undefined ? cleanView(o.view) : null;
    if ( o.ceilK !== undefined ) warnOnce("opt:ceilK", "LETR | option ceilK is NOT read (it never reached the size model; sizes are as without it): pass `ceil` (0..1] for a share of the size ceiling (manual 6)");
    /* the stream's one hand = the first syllable's, the same on every client whenever it joins (FXLE F9) */
    const handOf = () => {
      if ( hand ) return hand;
      try { hand = mk(syl[0], { mood, seed: `${seedBase}:0`, colors: o.colors, style: o.style, look: o.look }, fontsApi, []).hand; remember(hand); } catch { hand = null; }
      return hand;
    };
    /* SUSTAINGAP: lanes. Syllables that are up at the same time stand one beyond the other along the stream's direction, never on
       each other: syllable j takes the nearest lane whose last syllable is no longer legible at j's instant (decided from the
       schedule, so a seat that joins late puts every syllable in the same lane). Lanes stand in two staggered columns side by side
       (lane j in column j % 2, half a step further out than lane j - 1), so a fast stream's trail is half as long; a column's lanes are
       a step apart: the biggest syllable's ink along the direction, plus air, plus how much further an older syllable has flown. A
       trail kept in view (the default) that reaches the view's edge goes on behind its source; the lanes lay the syllables out
       themselves, the engine does not move them one by one. */
    const lanes = !o.orbit && !o.path, laneOf = [], laneBusy = [], laneT = [];
    const LEGIBLE_MS = life + 260;   // a syllable's entrance + hold + the legible start of its exit
    let laneStep = 0, laneW = 0, minBeat = every;
    const laneFor = (j) => {
      while ( laneOf.length <= j ) {
        const jj = laneOf.length, t = laneT[jj];
        if ( !Number.isFinite(t) ) return 0;
        let s = 0; while ( s < laneBusy.length && laneBusy[s] > t ) s++;
        laneBusy[s] = t + LEGIBLE_MS; laneOf.push(s);
      }
      return laneOf[j];
    };
    const beat = (text, when, idx) => {
      if ( !alive ) return null;
      try {
        const i = idx ?? k; k = i + 1;
        if ( !Number.isFinite(laneT[i]) ) laneT[i] = when ?? now();
        const word = text != null ? String(text) : (syl[i === 0 ? 0 : 1 + ((i - 1) % Math.max(1, syl.length - 1))] ?? syl[0]);
        const p0 = src();
        if ( srcH.gone || !p0 ) { if ( srcH.gone ) stop(); return null; }
        const lane = lanes && handOf()?.style === "invincible" ? laneFor(i) : -1, hb = { h: null };   // (the legacy styles: frozen, no lanes)
        /* (in lanes: along the stream's own direction, no alternating spread; the columns give the stagger) */
        const ang = dirAt(p0) + (lane >= 0 ? 0 : (((i % 2) ? 1 : -1) * (Number.isFinite(o.spread) ? o.spread : 10) * Math.PI) / 180);
        const unit = fixedSize ?? streamUnit();
        const travel = (Number.isFinite(o.travel) ? o.travel : lane >= 0 ? 0.45 : 1.6) * unit, side = lane >= 0 ? 0 : ((i % 3) - 1) * unit * 0.25, t0 = when ?? now();
        /* FXLE F17: loud 0 is quiet (it was read as "not given") */
        let lv = 1;
        if ( typeof o.loud === "function" ) { try { lv = o.loud(i); } catch { lv = 1; } } else if ( o.loud != null ) lv = o.loud;
        const loud = Number.isFinite(lv) ? Math.max(0, Math.min(1, lv)) : 1;
        const at = () => {
          const p = src() ?? p0, u = Math.min(1, stepT(Math.max(0, now() - t0), on) / (life + 200));
          const e = 1 - (1 - u) * (1 - u);
          let along = unit * 0.5 + travel * e, lat = side;
          if ( lane >= 0 ) {
            const b = inkBoxOf(hb.h);
            if ( b ) {
              const c = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang));
              /* (an older syllable in the same column has flown at most the whole travel further out) */
              laneStep = Math.max(laneStep, c * (b.l + b.r) + sn * (b.u + b.d) + 0.25 * b.k + travel);
              laneW = Math.max(laneW, sn * (b.l + b.r) + c * (b.u + b.d) + 0.25 * b.k);
            }
            const step = laneStep || unit * 2.6, W = laneW || unit * 4.5;
            /* rows forward as far as the room goes (the view, unless keepInView: false), the rest behind the source */
            let F = Infinity;
            if ( o.keepInView !== false ) {
              const v = viewRect({ space });
              if ( v ) {
                const dx = Math.cos(ang), dy = Math.sin(ang);
                const reach = Math.min(dx > 1e-6 ? (v.x1 - p.x) / dx : dx < -1e-6 ? (v.x0 - p.x) / dx : Infinity, dy > 1e-6 ? (v.y1 - p.y) / dy : dy < -1e-6 ? (v.y0 - p.y) / dy : Infinity);
                F = Math.max(1, Math.floor((reach - unit * 0.5 - step / 2) / (step / 2)) + 1);
              }
            }
            const row = lane < F ? lane : F - 1 - lane;
            along += row * (step / 2);
            lat = (((row % 2) + 2) % 2 ? 0.5 : -0.5) * W;
          }
          return { x: p.x + Math.cos(ang) * along - Math.sin(ang) * lat, y: p.y + Math.sin(ang) * along + Math.cos(ang) * lat };
        };
        /* upright by default (to read); `orient: "lean"` tilts each syllable toward where it flies, "tangent" lays it along */
        const tilt = o.orient && !o.orbit && !o.path ? (orientAngle(ang, o.orient) * 180) / Math.PI : 0;
        /* orbit: each syllable joins the ring where the stream's head is now and rides it; path: each rides the path over its life */
        let travel2 = null;
        if ( o.orbit ) {
          const ob = o.orbit, period = Math.max(300, ob.period ?? 2600), dir = ob.dir < 0 ? -1 : 1;
          const tb = Array.isArray(o.beats) ? (o.beats[i] ?? 0) : o.manual ? stepT(Math.max(0, (when ?? now()) - tStart), on) : i * every;
          orbitR ??= Number.isFinite(ob.radius) && ob.radius > 0 ? ob.radius : (Number.isFinite(o.span) && o.span > 0 ? o.span * 0.85 : areaOf(o.area) || unit * 3.4);
          travel2 = { orbit: { ...ob, center: ob.center ?? o.at, radius: orbitR, phase: (Number.isFinite(ob.phase) ? ob.phase : -90) + (dir * 360 * tb) / period } };
        } else if ( o.path ) travel2 = { path: o.path };
        /* MOTION2: an invincible stream's syllables take their motion from the kind (motion.mjs, syllable rows): no forced slam / shake */
        const inv = handOf()?.style === "invincible";
        const h = play(word, { _stream: i === 0 ? syl.join(" ") : true, alt: i === 0 ? o.alt : undefined, palette: o.palette, mood, space, size: unit * sylK(i, loud), magnitude: o.magnitude, fit: o.fit, ceil: o.ceil, ceilK: o.ceilK ?? 0.55, ...(view ? { view } : {}), ...(o.scale != null ? { scale: o.scale } : {}), seed: `${seedBase}:${i}`, hand: handOf() ?? undefined,
          in: inv ? o.in : o.in ?? "slam", out: inv ? o.out : o.out ?? "pop", holdKind: inv ? o.holdKind : "shake", kind: inv ? o.kind : undefined, look: inv ? o.look : undefined, hold: life, tempo: o.tempo ?? 1.6, at, pixel: o.pixel, rotation: (Number.isFinite(o.rotation) ? o.rotation : 0) + tilt + (((i * 7) % 5) - 2) * 3,
          zIndex: o.zIndex, reduced: o.reduced, parent: o.parent, colors: o.colors, layer: o.layer, startAt: when, token: tokenRef, vision: o.vision, elevation: o.elevation, ...(lane >= 0 ? { keepInView: false } : {}),
          on: o.on, fps: o.fps, glow: o.glow, ...travel2 });
        hb.h = h;
        emitted++;
        /* FXLE F10: only the syllables still alive are kept */
        handles.push(h);
        h.finished.then(() => { const j = handles.indexOf(h); if ( j >= 0 ) handles.splice(j, 1); });
        return h;
      } catch ( e ) { warnOnce("stream-beat", "LETR | a stream syllable failed", e); return null; }
    };
    const later = (fn, when) => { const id = setTimeout(() => { timers.delete(id); fn(); }, Math.max(0, when - now())); timers.add(id); };
    const stop = (q = {}) => {
      if ( !alive ) return;
      alive = false; streams.delete(s);
      for ( const id of timers ) clearTimeout(id);
      timers.clear();
      if ( q.quick ) for ( const h of [...handles] ) h.stop({ quick: true });
      Promise.all(handles.map((h) => h.finished)).then(() => done(q.quick ? "stopped" : "done"));
    };
    const s = { space, handles, finished, beat: (text) => beat(text), stop, get alive() { return alive; }, get emitted() { return emitted; } };
    streams.add(s);
    /* FXLE F9: on the effect's clock: a stream joined late skips the syllables whose life is already over and each syllable joins
       its own timeline at its due time; a duration counts from startAt */
    const tStart = Number.isFinite(startAt) ? startAt : now() + delay;
    const over = (when) => when + life + 200 < now();
    if ( Array.isArray(o.beats) ) {
      const bs = o.beats.filter((ms) => Number.isFinite(ms) && ms >= 0).sort((a, b) => a - b);
      bs.forEach((ms, j) => { laneT[j] = tStart + ms; if ( j ) minBeat = Math.min(minBeat, Math.max(1, ms - bs[j - 1])); });
      bs.forEach((ms, j) => { const when = tStart + ms; if ( !over(when) ) later(() => beat(undefined, when, j), when); });
      later(() => stop(), tStart + (bs.at(-1) ?? 0) + 20);
    } else if ( !o.manual ) {
      const n = cnt != null ? Math.floor(cnt) : (duration ? Math.max(1, Math.floor(duration / every)) : o.until ? Infinity : 6);
      const timeOf = (j) => tStart + every * (j + (o.swing && j % 2 ? 0.15 : 0));
      if ( o.swing ) minBeat = every * 0.85;
      for ( let j = 0; j < Math.min(n, 100000) && laneT.length < 100000; j++ ) { if ( laneT[j] !== undefined ) continue; laneT[j] = timeOf(j); if ( j > 2 && timeOf(j) > now() + 4 * LEGIBLE_MS ) break; }
      let j = Math.max(0, Math.floor((now() - life - 200 - tStart) / every) - 1);
      while ( j < n && over(timeOf(j)) ) j++;
      const tick = (i) => { if ( !alive ) return; if ( i >= n ) { stop(); return; } beat(undefined, timeOf(i), i); later(() => tick(i + 1), timeOf(i + 1)); };
      later(() => tick(j), timeOf(j));
    }
    settle(o.until, () => stop());
    return s;
  }

  function burst(items, common = {}) {
    const group = { used: [] };
    const c = common && typeof common === "object" ? common : {};
    return (Array.isArray(items) ? items : []).map((it, i) => {
      const item = it && typeof it === "object" ? it : { text: it };
      /* FXLE F16: a shared seed gives each item its own (still identical on every client) */
      const seed = item.seed ?? (c.seed != null ? `${c.seed}:${i}` : undefined);
      return play(item.text, { ...c, ...item, seed, avoid: [...(Array.isArray(c.avoid) ? c.avoid : []), ...(Array.isArray(item.avoid) ? item.avoid : [])], _group: group });
    });
  }

  async function still(text, opts0 = {}) {
    await ready();
    const opts = filterOpts(handOpt(cleanOpts({ ...opts0, force: true }))) ?? {};
    const plan = mk(textOf(text), { ...opts, reduced: true }, fontsApi, []);
    for ( const f of ext.plan ) f(plan, { opts: { ...opts, reduced: true }, still: true });
    settleCenter(plan, bank);
    const dpr = opts.dpr ?? (globalThis.devicePixelRatio || 1);
    const S = Math.max(4, (opts.size ?? 72) * plan.sizeK * dpr);
    const p = plan.motion ? { ...plan.timeline.hold[0], shards: null } : plan.timeline.hold[0];   // MOTION2: a break's still is the whole word
    return paintPicture(plan, bank, opts.picture ? opts.picture(plan) : p, S, makeCanvas).canvas;
  }

  function design(text, opts = {}) {
    const plan = mk(textOf(text), handOpt(cleanOpts(opts)), fontsApi, []);
    return JSON.parse(JSON.stringify(plan));
  }

  /* the size a word would get right now, and why (for callers and tests): { size, px, natural, clamp, fit, sizeK } */
  function sizeOf(text, opts0 = {}) {
    const opts = filterOpts(handOpt(cleanOpts({ ...opts0, force: true }))) ?? {};
    const space = opts.space === "world" ? "world" : "screen";
    const plan = mk(textOf(text), { ...opts, reduced: true }, fontsApi, []);
    try { settleCenter(plan, bank); } catch {}
    const h = { space, opts, at: opts.at, plan, pixel: space === "world" && !!opts.pixel };
    h.tokenSpan = space === "world" ? tokenSpanOf(h) : 0; h.worldAlive = space === "world" ? count({ space: "world" }) : 0;
    resize(h, true);
    /* ENGVIEW: the legible range this size was held to (cap height in CSS px on the view: floor, ceiling and what bounds the ceiling) and
       the view it was sized for (`opts.view`, else this seat's): a caller reads the engine's limits instead of re-deriving them */
    const c = sizeCtx(h), lim = sizeLimits(c);
    return { ...h.sizeInfo, size: h.size, sizeK: plan.sizeK, floor: lim.floor, ceil: lim.ceil, ceilBy: lim.by, view: viewUsed(c, opts) };
  }
  /* ENGVIEW: the view a size was taken for, as the size model saw it (`own` true = nothing from a caller's view) */
  const viewUsed = (c, opts) => ({ vw: c.vw, vh: c.vh, zoom: c.zoom, alive: c.alive, dpr: opts.view ? opts.view.dpr : (globalThis.devicePixelRatio || 1), own: !opts.view });

  /* ENGREG (1.9.11): the box a word will really occupy, BEFORE it is placed: the same planning as play() (style, the table's settings,
     face, motion type, this seat's size model with its view and zoom), settled once (the settle memo: the play() of the same call
     reuses the work). In the word's own space: world units for space "world", CSS px for "screen". null when lettering is off here.
       hold   { w, h }        the rest picture's ink box
       reach  { l, r, u, d }  how far the word goes from its centre during its entrance and hold (outline pad included)
       box / reachBox         those two around the point the word is placed at (`at`; a token word sits above its point: anchor)
       unit                   one cap height in the word's space (size * sizeK; maxWidth applied), px its cap height on screen
       contactMs              the contact pose after the start (plan.contactMs), plan the settled plan (read only)
     Every seat gets the same box from the same call when the call names its own `reduced` (the table's: false) and the seats share
     view size and zoom; a seat's own reduced motion changes the entrance (a fade: smaller reach). */
  function measure(text, opts0 = {}) {
    const opts = filterOpts(handOpt(cleanOpts({ ...opts0, force: true })));
    if ( opts === null ) return null;
    const space = opts.space === "world" ? "world" : "screen";
    const reduced = opts.reduced ?? reducedPref();
    const from = Number.isFinite(opts.from) ? opts.from : null;
    const plan = mk(textOf(text), { ...opts, reduced, from }, fontsApi, []);
    settleCenter(plan, bank);
    const h = { space, opts, at: opts.at, plan, pixel: space === "world" && !!opts.pixel, reducedMotion: !!reduced };
    h.tokenSpan = space === "world" ? tokenSpanOf(h) : 0; h.worldAlive = space === "world" ? count({ space: "world" }) : 0;
    resize(h, true);
    for ( const f of ext.preview ) { try { f(plan, opts); } catch {} }
    h.track = plan.motion ?? null;
    const hb = plan._holdBox ?? { w: 3, h: 1 };
    let unit = h.size * plan.sizeK;
    if ( opts.maxWidth && hb.w ) unit = Math.min(unit, opts.maxWidth / hb.w);
    const e = reachOf(h);
    const anchor = opts.anchor ?? (isToken(opts.at) ? "bottom" : "center");
    const oy = anchor === "bottom" ? -(hb.h / 2 + 0.1) * unit : 0;
    let p = null;
    try { p = space === "world" ? worldPoint(h) : screenPoint(h); } catch { p = null; }
    const cx = p?.x ?? 0, cy = (p?.y ?? 0) + oy;
    const zoom = space === "world" ? zoomOf(opts) : 1;
    const r = (v) => Math.round(v * 1000) / 1000;
    const m = {
      __proto__: MEASURE_INK,
      version: VERSION, text: textOf(text), space, anchor, at: p ? { x: r(p.x), y: r(p.y) } : null,
      size: h.size, sizeK: plan.sizeK, unit, px: unit * zoom, clamp: h.sizeInfo?.clamp ?? null, fit: h.sizeInfo?.fit ?? null,
      hold: { w: hb.w * unit, h: hb.h * unit },
      reach: { l: e.l * unit, r: e.r * unit, u: e.u * unit, d: e.d * unit },
      box: { x0: cx - hb.w / 2 * unit, y0: cy - hb.h / 2 * unit, x1: cx + hb.w / 2 * unit, y1: cy + hb.h / 2 * unit },
      reachBox: { x0: cx - e.l * unit, y0: cy - e.u * unit, x1: cx + e.r * unit, y1: cy + e.d * unit },
      contactMs: Number.isFinite(plan.contactMs) ? plan.contactMs : null, reduced: !!reduced, plan
    };
    /* ENGVIEW (1.9.18): the word's INK, standing and arriving, so a caller mirrors none of the engine's tables (LIFE_REACH, INV_RIM, the
       keyline, the duplicate block). Computed on first read (a caller that does not read them pays nothing). In the word's space, from
       the word's centre (the box's centre), turned by its `rotation`:
         stand / standBox  how far the standing word's ink goes over its whole hold: the hold poses and the life of a held word, the keyline,
                           second outline, rim (world words), duplicate block, a backdrop or effects of its hold pictures
         inkReach / inkReachBox  the same from the first entrance drawing on (entrance poses and travel, an entrance smear)
         ink   { l, r, u, d }  cap heights drawn round the letters' box at rest (keyline .. duplicate block, rim and extras)
         rim   cap heights the rim (keyline + band) reaches past the letters' outline at the drawn size; 0 without a rim
         life  { xy, s } how far the life of a held word moves it (cap heights, scale), null when the word has none
       The pixel floors of the keyline and rim count at the drawn size: unit x zoom x dpr (`opts.view.dpr`, else this seat's). */
    const dpr = opts.view ? opts.view.dpr : (globalThis.devicePixelRatio || 1);
    const S = Math.max(4, unit * zoom * (space === "world" ? dpr : (globalThis.devicePixelRatio || 1)));
    if ( opts.view ) m.view = viewUsed(sizeCtx(h), opts);
    if ( opts.ceilK !== undefined ) m.unread = ["ceilK"];
    /* the ink fields are getters on a shared prototype (no per-call property definitions: the old fields cost what they cost) */
    /* only what the ink needs is kept (not the measured word itself: a measure result stays as light as before) */
    m[INK_OF] = [inkMeasure, plan, h.track, h.pixel, h.reducedMotion, opts.rotation, opts.path, opts.orbit, unit, S, cx, cy];
    return m;
  }
  /* ENGVIEW: the standing and arriving ink of a measured word (see measure). `h` = the measure's word (plan settled, track, size), `unit` its
     cap height in its space, S its drawn px per cap, (cx, cy) its centre. Pure arithmetic on the plan: no picture is painted. */
  function inkMeasure(h, unit, S, cx, cy) {
    const plan = h.plan, H = plan.hand, tl = plan.timeline, hb = plan._holdBox ?? { w: 3, h: 1 };
    const rot = ((h.opts.rotation ?? 0) * Math.PI) / 180;
    const ip = inkPad(H, S), hold = { l: 0, r: 0, u: 0, d: 0 }, all = { l: 0, r: 0, u: 0, d: 0 };
    const grow = (o, q) => { for ( const k of ["l", "r", "u", "d"] ) o[k] = Math.max(o[k], q[k]); };
    for ( const p of tl.hold ) grow(hold, extrasPad(plan, p));
    grow(all, hold); for ( const p of tl.ent ) grow(all, extrasPad(plan, p, true));
    const padOf = (x) => ({ l: ip.l + x.l, r: ip.r + x.r, u: ip.u + x.u, d: ip.d + x.d });
    const P = padOf(hold), PA = padOf(all);
    /* a box W x Hh (caps) whose centre is (bx, by) off the word's centre, scaled s, turned a, moved (ox, oy): its reach round the centre */
    const turned = (W, Hh, bx, by, s, sx, sy, a, ox, oy, o) => {
      const c = Math.cos(a), sn = Math.sin(a);
      for ( const [x, y] of [[-W / 2, -Hh / 2], [W / 2, -Hh / 2], [W / 2, Hh / 2], [-W / 2, Hh / 2]] ) {
        const X = ox + (x + bx) * s * sx * c - (y + by) * s * sy * sn, Y = oy + (x + bx) * s * sx * sn + (y + by) * s * sy * c;
        o.l = Math.max(o.l, -X); o.r = Math.max(o.r, X); o.u = Math.max(o.u, -Y); o.d = Math.max(o.d, Y);
      }
      return o;
    };
    const W = (pd) => hb.w + pd.l + pd.r, Hh = (pd) => hb.h + pd.u + pd.d, bx = (pd) => (pd.r - pd.l) / 2, by = (pd) => (pd.d - pd.u) / 2;
    /* letters drawn in from their own offsets (parts, a count-in, a split): the pictures carry those offsets, the track does not */
    const lettersY = (pics, o, pd) => {
      const ys = new Set();
      for ( const p of pics ) for ( const q of p.letters ?? [] ) { if ( !Number.isFinite(q.y) || q.y === 0 || q.v === 0 ) continue; ys.add(Math.max(-3, Math.min(3, q.y + (h.track ? 0 : p.g?.y ?? 0)))); }
      for ( const y of ys ) turned(W(pd), Hh(pd), bx(pd), by(pd) + y, 1, 1, 1, rot, 0, 0, o);   // the whole row moved by y, turned with the word
    };
    const stand = { l: 0, r: 0, u: 0, d: 0 }, reach = { l: 0, r: 0, u: 0, d: 0 };
    const tr = h.track;
    let life = null;
    if ( tr ) {
      const ent = tl.ent.reduce((a, p) => a + p.ticks * TICK, 0), holdMs = Math.max(tl.hold.reduce((a, p) => a + p.ticks * TICK, 0), plan.holdMs ?? 0);
      grow(stand, trackSpan(tr, W(P), Hh(P), ent, holdMs, rot, bx(P), by(P), ent));
      grow(reach, trackSpan(tr, W(PA), Hh(PA), ent, holdMs, rot, bx(PA), by(PA), 0));
      /* the life between the samples: its whole reach (LIFE_REACH), turned with the word */
      if ( tr.life ) {
        life = { ...LIFE_REACH };
        for ( const [ox, oy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] ) turned(W(P), Hh(P), bx(P), by(P), LIFE_REACH.s, 1, 1, rot, ox * LIFE_REACH.xy, oy * LIFE_REACH.xy, stand);
      }
      lettersY(tl.hold, stand, P); lettersY([...tl.ent, ...tl.hold], reach, PA);
    } else {
      /* the legacy styles: each hold / entrance picture's own transform (as reachOf reads them) and the held word's breathing (place) */
      const br = !h.reducedMotion && !h.pixel && !h.opts.path && !h.opts.orbit ? 0.7 + 0.6 * (plan.sound?.loud ?? 0.5) : 0;
      const pic = (p, cap, pd, o) => {
        const g = p.g ?? {}, gx = Math.max(-cap, Math.min(cap, g.x ?? 0)), gy = Math.max(-cap, Math.min(cap, g.y ?? 0)), s0 = Math.min(1.5, Math.abs(g.s ?? 1));
        for ( const da of br ? [-0.04 * br, 0, 0.04 * br] : [0] ) for ( const dy of br ? [-0.05 * br, 0.05 * br] : [0] )
          turned(W(pd), Hh(pd), bx(pd), by(pd), s0 * (1 + 0.035 * br), Math.abs(g.sx ?? 1), Math.abs(g.sy ?? 1), rot + (g.r ?? 0) + da, gx, gy + dy, o);
      };
      for ( const p of tl.hold ) pic(p, 3, P, stand);
      for ( const p of tl.hold ) pic(p, 3, PA, reach);
      for ( const p of tl.ent ) pic(p, 1.2, PA, reach);
      lettersY(tl.ent, reach, PA);
    }
    const sc = (o) => ({ l: o.l * unit, r: o.r * unit, u: o.u * unit, d: o.d * unit });
    const bxOf = (o) => ({ x0: cx - o.l * unit, y0: cy - o.u * unit, x1: cx + o.r * unit, y1: cy + o.d * unit });
    return { stand: sc(stand), standBox: bxOf(stand), inkReach: sc(reach), inkReachBox: bxOf(reach), ink: P,
      rim: H.halo ? rimPx(H, S).outer / S : 0, life };
  }

  /* FXLE F4: stopAll and a scene change reach every word, also those still waiting (delay, fonts, queued), and every stream */
  function stopAll(o = {}) {
    const quick = o.quick ?? true;
    for ( const s of [...streams] ) if ( !o.space || s.space === o.space ) s.stop({ quick });
    for ( const h of [...clips, ...pending] ) if ( !o.space || h.space === o.space ) h.stop({ quick });
    for ( const k of [...escMem.keys()] ) if ( !o.space || k.startsWith(`${o.space}|`) ) escMem.delete(k);   // escalation starts over
  }
  function count(o = {}) { let n = 0; for ( const h of clips ) if ( !o.space || h.space === o.space ) n++; return n; }

  /* FXLE F22: on a scene change our layer containers go too (the `top` one lives on canvas.stage, which Foundry keeps) */
  function tearDown() {
    for ( const s of [...streams] ) if ( s.space === "world" ) s.stop({ quick: true });
    for ( const h of [...clips, ...pending] ) if ( h.space === "world" ) h.stop({ quick: true, why: "evicted" });
    for ( const c of worldLayers.values() ) { try { if ( !c.destroyed ) { c.parent?.removeChild(c); c.destroy({ children: true }); } } catch {} }
    worldLayers.clear();
    for ( const k of [...escMem.keys()] ) if ( k.startsWith("world|") ) escMem.delete(k);
    try { glowLayer?.destroy({ children: true }); } catch {}
    glowLayer = null;
  }
  try { globalThis.Hooks?.on?.("canvasTearDown", tearDown); } catch {}
  /* Foundry empties the illumination container on every lighting refresh: the glow of self-lit words goes back in */
  try { globalThis.Hooks?.on?.("lightingRefresh", () => { if ( glowLayer && !glowLayer.destroyed && glowLayer.children.length ) ensureGlowLayer(); }); } catch {}
  /* settings helpers: choices for game.settings.register, per space */
  const layerChoices = (space = "world", lang = globalThis.game?.i18n?.lang) => Object.fromEntries(Object.entries(LAYERS).filter(([, v]) => v.space === space).map(([k, v]) => [k, lang === "pl" ? v.pl : v.en]));

  /* WORD (v5): the vocabulary layer (words.mjs): a sound kind + loudness + language -> a fitting word; sfx() letters it */
  const vocab = createVocab();
  /* KINDS1: material (what is hit), pieces (debris size), intensity / stage (the fire ladder) are word options, not play options */
  const VOCAB_KEYS = ["kind", "loud", "lang", "step", "template", "prefix", "material", "pieces", "intensity", "stage", "long", "duration", "bangs"];
  function sfx(kind, opts = {}) {
    const w = vocab.word(kind, opts);
    const rest = Object.fromEntries(Object.entries(opts).filter(([k]) => !VOCAB_KEYS.includes(k)));
    const h = play(w.text, { ...playOpts(w), ...rest, sound: { ...w.play.sound, ...(opts.sound ?? {}) }, magnitude: opts.magnitude ?? w.play.magnitude });
    h.word = w;
    return h;
  }
  /* KINDS1: an event told in order (words.mjs CHAINS / TAILS): vocab.chain plans the words and times, each step is one play() on the
     event's clock (startAt + t, else delay + t), placed by `places[step.place]` (source, target, ring, around, feet, bounce, behind),
     else at `at`. Not networked: each client calls it with the same seed and startAt (L.net is for single words). */
  const CHAIN_KEYS = ["places", "tempo", "tails"];
  function chain(spec, opts = {}) {
    const steps = vocab.chain(spec, opts);
    const rest = Object.fromEntries(Object.entries(opts).filter(([k]) => !VOCAB_KEYS.includes(k) && !CHAIN_KEYS.includes(k) && k !== "magnitude" && k !== "delay" && k !== "startAt"));
    const t0 = Number.isFinite(opts.startAt) ? opts.startAt : null, d0 = Number.isFinite(opts.delay) && opts.delay > 0 ? opts.delay : 0;
    const handles = steps.map((s) => {
      const at = opts.places?.[s.place] ?? rest.at;
      const when = t0 != null ? { startAt: t0 + s.t } : (d0 + s.t > 0 ? { delay: d0 + s.t } : {});
      const h = play(s.word.text, { ...playOpts(s.word), ...rest, ...s.play, ...(at !== undefined ? { at } : {}), ...(opts.seed != null ? { seed: `${opts.seed}|${s.i}` } : {}), ...when });
      h.word = s.word; h.step = s;
      return h;
    });
    return { steps, handles, stop(o) { for ( const h of handles ) h.stop?.(o); } };
  }

  /* continuous sounds (sustain.mjs, README "Motion: continuous sounds"): a phrase score over play(); stopAll and a scene change stop
     them like streams */
  const styleOf = (o) => (STYLES.includes(o?.look?.style) ? o.look.style : typeof o?.style === "string" && STYLES.includes(o.style) ? o.style : defLook);
  const sustain = makeSustain({ play, now, streams, vocab: () => vocab, pointOf, syllablesOf, styleOf, boxOf: inkBoxOf, viewBox: (space) => viewRect({ space }),
    inView: (space, p, pad = 0) => { const v = viewRect({ space }); return !v || !p || (p.x >= v.x0 - pad && p.x <= v.x1 + pad && p.y >= v.y0 - pad && p.y <= v.y1 + pad); } });
  const api = {
    version: VERSION, base, limits, stats, defaults, layers: LAYERS, layerChoices,
    moods: MOOD_IDS.map((id) => ({ id, label: MOODS[id].label, sound: { ...MOODS[id].sound } })),
    ready, play, stream, streamUnit, burst, still, design, stopAll, count, sizeOf, measure, contactAt, sizeModel: SIZE, lookStyle, lookStyles: STYLES.slice(), motionMode, motionModes: MOTION_MODES.slice(), invFace, invFaces: INV_FACES.slice(), gridClock,
    vocab, word: vocab.word, sfx, number: vocab.number, range: vocab.range, flow: vocab.flow, chain,
    /* v6 (MOVE): push words aside, the escalation memory, the parts of the view words keep clear of (px from each edge: a letterbox,
       a bar; or a function (space) => insets; null = the default 8 px) */
    viewInset(v) { if ( v !== undefined ) viewInset = v ?? { top: 8, right: 8, bottom: 8, left: 8 }; return viewInset; },
    sustain, ambientMax: AMBIENT_MAX,
    push, escalation: { get: (key) => escMem.get(key)?.n ?? 0, clear: () => escMem.clear(), get size() { return escMem.size; } },
    async gallery(o = {}) { const g = await import("./gallery.mjs"); return g.gallery(api, o); },
    /* for tests and the gallery page */
    _ext: ext, _settle: (plan) => settleCenter(plan, bank),
    _bank: bank, _plan: (t, o = {}) => mk(t, o, fontsApi, []), _paint: (plan, p, S) => { settleCenter(plan, bank); return paintPicture(plan, bank, p, S, makeCanvas); }
  };
  /* MOTION2: L.word's play options name the kind (the invincible motion table) and keep the vocabulary's own motion picks for the
     legacy style (vocabMotion), so `L.play(w.text, w.play)` moves like `L.sfx` */
  api.word = (kind, o) => { const w = vocab.word(kind, o); w.play = playOpts(w); return w; };
  return api;
}
