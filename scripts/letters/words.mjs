/* LETR vocabulary (WORD): from a sound kind, a loudness and a language to a fitting comic onomatopoeia. Pure: no DOM, no Foundry.
   The engine letters any text it is handed; this layer only DECIDES the text (and the mood / sound / motion that fit it):
     const w = L.word("crack", { loud: 0.8, lang: "pl", seed });     // -> { text: "TRZAAASK!", mood: "crack", sound, play, ... }
     L.play(w.text, { ...w.play, space: "world", at });              // or simply: L.sfx("crack", { loud: 0.8, space: "world", at })
   Plain text keeps working exactly as before: L.play("KRAK!", ...) never goes through this file.

   Words: our own lists (EN: the American comic idiom; PL: Polish comic and everyday onomatopoeia, written the Polish way: ŁUP, BĘC,
   TRACH, ŁUBUDU, CIACH, ŚWIST, BRZDĘK, IJO-IJO, CIII). Template marks:
     "+" after a letter = a stretch point: the louder the sound, the more of that letter (TRZA+SK -> TRZASK / TRZAAASK); several marks
         share the stretch. A template without "+" is stretched on its last vowel (or its trailing R/S/Z/H/M/F run) when needed.
     "-" joins syllables (KA-BUM, TRA-TA-TA); streams split on it.
   Tiers: s (quiet: loud < 0.34), m (normal), l (loud: >= 0.67). On top of the tier: stretch grows with loudness; at the very top a
   prefix (KA-, TRA-TA-) may be added; quiet words drop their "!". */
import { rng } from "./rng.mjs";
import { magnitudeOf } from "./size.mjs";

/* characters every engine font letters (own glyph, synthesised Polish letter or fallback): words outside this set are refused */
export const RENDERABLE = /^[A-Z0-9ĄĆĘŁŃÓŚŹŻ!?\-+\x27.,…×–%:/ ]+$/u;
export const MAX_LEN = 22;

/* ---------- sound kinds: what it is, the engine mood, the base sound (loud comes from the call), motion, stretch, prefixes ----------
   group: hit | break | blast | motion | element | power | device | voice.  stretch = how many extra letters a full-loud word gets. */
const K = (group, pl, en, mood, sound, motion, stretch = 2, pre = null, alias = []) => ({ group, label: { pl, en }, mood, sound, motion, stretch, pre, alias });
export const KINDS = {
  /* hits */
  punch:   K("hit", "cios", "punch", "impact", { sharp: 0.8, long: 0.15, pitch: 0, rough: 0.35 }, { in: ["slam", "pop"], hold: ["shake", "boil"], out: ["shatter", "pop"] }, 2, { pl: ["TRA-"], en: ["KA-"] }, ["hit", "blow", "kick", "strike"]),
  smash:   K("hit", "miażdżenie", "smash", "crash", { sharp: 0.9, long: 0.45, pitch: -0.2, rough: 0.75 }, { in: ["slam"], hold: ["rattle", "shake"], out: ["shatter", "burst"] }, 3, { pl: ["TRA-TA-"], en: ["KA-"] }, ["heavy", "slam", "crush"]),
  slap:    K("hit", "klaps", "slap", "impact", { sharp: 0.55, long: 0.2, pitch: 0.1, rough: 0.2 }, { in: ["pop", "slam"], hold: ["shake", "wobble"], out: ["pop"] }, 2),
  thud:    K("hit", "łomot", "thud", "impact", { sharp: 0.4, long: 0.1, pitch: -0.6, rough: 0.5 }, { in: ["drop", "slam"], hold: ["wobble", "rattle"], out: ["fall", "droop"] }, 2, null, ["fall", "down", "body"]),
  stomp:   K("hit", "tupnięcie", "stomp", "impact", { sharp: 0.35, long: 0.3, pitch: -0.7, rough: 0.6 }, { in: ["drop", "slam"], hold: ["rattle", "shake"], out: ["fall", "pop"] }, 2, null, ["step", "footstep"]),
  clang:   K("hit", "brzęk", "clang", "crack", { sharp: 0.9, long: 0.4, pitch: 0.3, rough: 0.2 }, { in: ["slam", "pop"], hold: ["buzz", "shake"], out: ["pop", "dissolve"] }, 2, { en: ["KA-"] }, ["metal", "block", "shield", "parry"]),
  slash:   K("hit", "cięcie", "slash", "crack", { sharp: 1, long: 0.3, pitch: 0.2, rough: 0.5 }, { in: ["zip", "crackIn"], hold: ["shake"], out: ["shatter", "zipout"] }, 2, null, ["cut", "blade", "claw", "sword"]),
  bite:    K("hit", "ugryzienie", "bite", "crack", { sharp: 0.7, long: 0.2, pitch: -0.1, rough: 0.6 }, { in: ["slam", "pop"], hold: ["shake", "rattle"], out: ["pop", "shatter"] }, 2, null, ["chomp", "crunch", "chew"]),
  /* breaking */
  crack:   K("break", "trzask", "crack", "crack", { sharp: 0.95, long: 0.2, pitch: 0.1, rough: 0.55 }, { in: ["crackIn", "slam"], hold: ["shake"], out: ["shatter"] }, 2, null, ["snap", "break"]),
  shatter: K("break", "stłuczenie", "shatter", "crack", { sharp: 1, long: 0.45, pitch: 0.4, rough: 0.4 }, { in: ["crackIn", "pop"], hold: ["buzz", "shake"], out: ["shatter"] }, 2, null, ["glass", "smash-glass"]),
  crash:   K("break", "łoskot", "crash", "crash", { sharp: 0.7, long: 0.6, pitch: -0.6, rough: 0.85 }, { in: ["drop", "slam"], hold: ["rattle"], out: ["fall"] }, 3, { pl: ["TRA-TA-"], en: ["KA-", "KRA-"] }, ["collapse", "rubble", "wreck", "destroy"]),
  crumble: K("break", "kruszenie", "crumble", "crash", { sharp: 0.4, long: 0.75, pitch: -0.5, rough: 1 }, { in: ["grow", "drop"], hold: ["wobble", "rattle"], out: ["droop", "fall"] }, 3, null, ["decay", "erode", "grind"]),
  rumble:  K("break", "dudnienie", "rumble", "crash", { sharp: 0.35, long: 0.95, pitch: -0.8, rough: 1 }, { in: ["grow"], hold: ["rattle"], out: ["fall"] }, 3, null, ["quake", "earthquake", "tremor"]),
  creak:   K("break", "skrzypienie", "creak", "tick", { sharp: 0.6, long: 0.7, pitch: 0.2, rough: 0.7 }, { in: ["pop", "grow"], hold: ["wobble"], out: ["dissolve"] }, 3, null, ["squeak", "door", "wood"]),
  scrape:  K("break", "zgrzyt", "scrape", "whoosh", { sharp: 0.6, long: 0.85, pitch: -0.2, rough: 0.95 }, { in: ["zip"], hold: ["rattle"], out: ["zipout"] }, 3, null, ["drag", "screech", "grind-metal"]),
  /* blasts and shots */
  boom:    K("blast", "wybuch", "boom", "boom", { sharp: 0.45, long: 0.55, pitch: -0.2, rough: 0.6 }, { in: ["slam"], hold: ["throb", "shake"], out: ["burst"] }, 3, { pl: ["KA-", "TRA-TA-"], en: ["KA-", "KRA-"] }, ["explosion", "blast", "explode", "bomb", "grenade"]),
  whump:   K("blast", "podmuch", "whump", "boom", { sharp: 0.15, long: 0.45, pitch: -0.7, rough: 0.4 }, { in: ["grow"], hold: ["throb"], out: ["dissolve"] }, 2, null, ["gust", "shockwave", "pressure", "airblast"]),
  thunder: K("blast", "grzmot", "thunder", "boom", { sharp: 0.7, long: 0.8, pitch: -0.4, rough: 0.8 }, { in: ["slam", "crackIn"], hold: ["rattle", "shake"], out: ["burst", "fall"] }, 3, { pl: ["TRA-TA-"], en: ["KRA-KA-"] }, ["storm", "lightning-strike"]),
  zap:     K("blast", "porażenie", "zap", "zap", { sharp: 1, long: 0.3, pitch: 0.3, rough: 0.5 }, { in: ["pop"], hold: ["buzz"], out: ["dissolve"] }, 2, { en: ["KA-"] }, ["electric", "electricity", "lightning", "shock", "spark"]),
  beam:    K("blast", "promień", "beam", "zap", { sharp: 0.8, long: 0.6, pitch: 0.4, rough: 0.3 }, { in: ["zip", "pop"], hold: ["buzz"], out: ["zipout", "dissolve"] }, 3, { en: ["KA-"] }, ["laser", "energy", "ray", "eyebeam", "blaster"]),
  gunshot: K("blast", "strzał", "gunshot", "impact", { sharp: 0.9, long: 0.15, pitch: 0.1, rough: 0.4 }, { in: ["slam"], hold: ["shake"], out: ["pop"] }, 1, null, ["gun", "shot", "pistol", "rifle"]),
  gunfire: K("blast", "seria", "gunfire", "impact", { sharp: 0.9, long: 0.5, pitch: 0, rough: 0.5 }, { in: ["slam"], hold: ["shake", "rattle"], out: ["pop"] }, 2, null, ["burst", "autofire", "machinegun", "machine-gun", "rattle"]),
  ricochet:K("blast", "rykoszet", "ricochet", "whoosh", { sharp: 0.85, long: 0.6, pitch: 0.6, rough: 0.2 }, { in: ["zip", "pop"], hold: ["boil"], out: ["zipout"] }, 3, null, ["deflect", "bounce-off"]),
  /* motion */
  whoosh:  K("motion", "świst", "whoosh", "whoosh", { sharp: 0.2, long: 0.8, pitch: 0, rough: 0.2 }, { in: ["zip"], hold: ["boil"], out: ["zipout"] }, 3, null, ["swing", "dash", "dodge", "swoosh", "throw"]),
  zoom:    K("motion", "pęd", "zoom", "whoosh", { sharp: 0.35, long: 0.85, pitch: 0.3, rough: 0.35 }, { in: ["zip"], hold: ["boil"], out: ["zipout"] }, 3, { en: ["KA-"] }, ["fly", "flight", "flyby", "speed", "jet", "takeoff"]),
  bounce:  K("motion", "skok", "bounce", "tick", { sharp: 0.2, long: 0.5, pitch: 0.7, rough: 0.1 }, { in: ["pop", "rise"], hold: ["wobble", "boil"], out: ["rise", "pop"] }, 3, null, ["jump", "leap", "spring", "boing"]),
  teleport:K("motion", "teleport", "teleport", "zap", { sharp: 0.5, long: 0.25, pitch: 0.5, rough: 0.2 }, { in: ["pop"], hold: ["buzz", "boil"], out: ["dissolve", "pop"] }, 2, null, ["blink", "vanish", "appear", "portal"]),
  wind:    K("motion", "wiatr", "wind", "whoosh", { sharp: 0.1, long: 1, pitch: 0.1, rough: 0.3 }, { in: ["zip", "grow"], hold: ["boil"], out: ["zipout", "dissolve"] }, 3, null, ["gale", "howl", "breeze", "tornado"]),
  /* elements */
  fire:    K("element", "ogień", "fire", "fire", { sharp: 0.3, long: 0.7, pitch: 0.6, rough: 0.45 }, { in: ["pop", "rise"], hold: ["flicker"], out: ["rise"] }, 3, { en: ["KA-"] }, ["flame", "flames", "burn", "ignite", "blaze", "fireball"]),
  crackle: K("element", "trzaskanie", "crackle", "fire", { sharp: 0.85, long: 0.3, pitch: 0.4, rough: 0.7 }, { in: ["pop"], hold: ["flicker"], out: ["dissolve"] }, 2, null, ["burning", "sizzle", "embers"]),
  hiss:    K("element", "syk", "hiss", "whoosh", { sharp: 0.2, long: 0.8, pitch: -0.3, rough: 0.55 }, { in: ["zip", "pop"], hold: ["boil"], out: ["dissolve"] }, 3, null, ["steam", "gas", "snake", "leak", "spray"]),
  splash:  K("element", "plusk", "splash", "splash", { sharp: 0.25, long: 0.5, pitch: 0.2, rough: 0.3 }, { in: ["pop"], hold: ["wobble"], out: ["fall"] }, 2, null, ["water", "wave", "dive"]),
  squish:  K("element", "plaśnięcie", "squish", "splash", { sharp: 0.2, long: 0.4, pitch: -0.4, rough: 0.6 }, { in: ["pop", "slam"], hold: ["wobble"], out: ["fall", "droop"] }, 2, null, ["goo", "slime", "squelch", "gore", "mud"]),
  drip:    K("element", "kapanie", "drip", "splash", { sharp: 0.4, long: 0.2, pitch: 0.3, rough: 0 }, { in: ["drop", "pop"], hold: ["boil"], out: ["fall"] }, 2, null, ["drop", "leak-drop"]),
  /* powers */
  powerup: K("power", "ładowanie", "power-up", "powerup", { sharp: 0.3, long: 0.8, pitch: 0.9, rough: 0.2 }, { in: ["grow", "rise"], hold: ["throb"], out: ["rise"] }, 3, { en: ["KA-"] }, ["charge", "power", "transform", "arcane", "hum"]),
  psychic: K("power", "telepatia", "psychic", "powerup", { sharp: 0.15, long: 0.9, pitch: 0.5, rough: 0.1 }, { in: ["grow"], hold: ["throb", "boil"], out: ["dissolve", "rise"] }, 3, null, ["mind", "telepathy", "telekinesis", "psionic"]),
  chime:   K("power", "dzwonienie", "chime", "heal", { sharp: 0.6, long: 0.5, pitch: 0.7, rough: 0 }, { in: ["pop", "rise"], hold: ["boil", "throb"], out: ["rise", "dissolve"] }, 2, null, ["magic", "sparkle", "shimmer", "idea", "ding", "bell"]),
  fizzle:  K("power", "zgaśnięcie", "fizzle", "fail", { sharp: 0.4, long: 0.5, pitch: -0.8, rough: 0.5 }, { in: ["pop"], hold: ["wobble", "buzz"], out: ["droop", "dissolve"] }, 3, null, ["fizz", "fail-power", "misfire", "dud", "fuse"]),
  whiff:   K("power", "pudło", "whiff", "fail", { sharp: 0.2, long: 0.5, pitch: -0.5, rough: 0.1 }, { in: ["zip", "pop"], hold: ["wobble"], out: ["droop", "zipout"] }, 3, null, ["miss", "fail", "flop"]),
  /* devices */
  click:   K("device", "kliknięcie", "click", "tick", { sharp: 0.7, long: 0, pitch: 0, rough: 0.1 }, { in: ["pop"], hold: ["boil"], out: ["dissolve", "pop"] }, 1, null, ["tick", "switch", "trigger", "cock", "lock"]),
  beep:    K("device", "pikanie", "beep", "tick", { sharp: 0.5, long: 0.2, pitch: 0.4, rough: 0 }, { in: ["pop"], hold: ["boil", "buzz"], out: ["dissolve"] }, 2, null, ["blip", "alarm-beep", "computer"]),
  engine:  K("device", "silnik", "engine", "whoosh", { sharp: 0.4, long: 0.8, pitch: 0.1, rough: 0.8 }, { in: ["zip"], hold: ["rattle", "boil"], out: ["zipout"] }, 3, null, ["motor", "car", "vehicle", "rev"]),
  siren:   K("device", "syrena", "siren", "zap", { sharp: 0.4, long: 0.9, pitch: 0.5, rough: 0.2 }, { in: ["pop", "grow"], hold: ["buzz", "throb"], out: ["dissolve"] }, 2, null, ["alarm", "police", "ambulance"]),
  /* voices */
  roar:    K("voice", "ryk", "roar", "roar", { sharp: 0.55, long: 0.9, pitch: 0.2, rough: 0.85 }, { in: ["grow"], hold: ["rattle", "shake"], out: ["shrink", "shatter"] }, 3, null, ["growl", "beast", "monster", "battlecry"]),
  pain:    K("voice", "ból", "pain", "pain", { sharp: 0.6, long: 0.45, pitch: -0.5, rough: 0.6 }, { in: ["slam", "pop"], hold: ["wobble", "shake"], out: ["fall", "droop"] }, 3, null, ["hurt", "scream", "ouch", "wound"]),
  effort:  K("voice", "wysiłek", "effort", "pain", { sharp: 0.7, long: 0.4, pitch: -0.1, rough: 0.85 }, { in: ["pop", "crackIn"], hold: ["buzz", "rattle"], out: ["droop", "dissolve"] }, 3, null, ["grunt", "strain", "push", "lift", "stress"]),
  relief:  K("voice", "ulga", "relief", "heal", { sharp: 0.05, long: 0.6, pitch: 0.4, rough: 0 }, { in: ["rise", "pop"], hold: ["throb", "boil"], out: ["rise", "dissolve"] }, 3, null, ["phew", "heal", "rest", "regain"]),
  sigh:    K("voice", "westchnienie", "sigh", "fail", { sharp: 0.1, long: 0.9, pitch: -0.9, rough: 0.3 }, { in: ["drop"], hold: ["wobble"], out: ["droop", "fall"] }, 3, null, ["exhausted", "tired", "groan", "out"]),
  cheer:   K("voice", "wiwat", "cheer", "powerup", { sharp: 0.5, long: 0.4, pitch: 0.8, rough: 0.2 }, { in: ["grow", "rise"], hold: ["throb"], out: ["rise"] }, 3, null, ["triumph", "yes", "victory", "hooray"]),
  laugh:   K("voice", "śmiech", "laugh", "tick", { sharp: 0.4, long: 0.5, pitch: 0.3, rough: 0.3 }, { in: ["pop"], hold: ["wobble", "boil"], out: ["pop", "rise"] }, 1, null, ["giggle", "chuckle", "evil-laugh"]),
  shush:   K("voice", "uciszenie", "shush", "whoosh", { sharp: 0.3, long: 0.7, pitch: -0.2, rough: 0.2 }, { in: ["pop"], hold: ["boil"], out: ["dissolve"] }, 3, null, ["quiet", "silence", "hush", "whisper"]),
  heartbeat:K("voice", "puls", "heartbeat", "impact", { sharp: 0.3, long: 0.3, pitch: -0.3, rough: 0.3 }, { in: ["pop"], hold: ["throb"], out: ["dissolve"] }, 1, null, ["heart", "pulse", "tension"])
};
/* repeating sounds: an escalation adds a syllable (TRA-TA-TA -> TRA-TA-TA-TA) instead of stretching letters */
for ( const id of ["gunfire", "laugh", "drip", "stomp", "beep"] ) KINDS[id].repeat = "last";     // one more of the last syllable
for ( const id of ["siren", "heartbeat"] ) KINDS[id].repeat = "pair";                              // one more WEE-OO / BA-DUM
/* the SUSTAIN of each sound (see "WHERE a word stretches" below): which letter classes may repeat, in order */
const HOLD = {
  punch: "V F M", smash: "V M R", slap: "V S", thud: "V M", stomp: "V M", clang: "V M", slash: "V S H", bite: "V R",
  crack: "R V", shatter: "S Z V", crash: "V S H R", crumble: "R V S", rumble: "R M V", creak: "V R", scrape: "R Z S V",
  boom: "V M", whump: "V M F", thunder: "R V M", zap: "Z V", beam: "Z V M", gunshot: "V M", gunfire: "V", ricochet: "V M",
  whoosh: "V S Z F", zoom: "V R M", bounce: "V M", teleport: "V F", wind: "V S H",
  fire: "V R F", crackle: "S R V", hiss: "S Z F V", splash: "V S H", squish: "V S H", drip: "V",
  powerup: "M V Z", psychic: "M V", chime: "V M", fizzle: "Z S F V", whiff: "F V S",
  click: "V", beep: "V", engine: "R V M", siren: "V",
  roar: "R V", pain: "V R", effort: "V M H", relief: "V F H", sigh: "V H", cheer: "V", laugh: "V", shush: "S H V", heartbeat: "V"
};
for ( const [id, h] of Object.entries(HOLD) ) KINDS[id].hold = h.split(" ");
export const KIND_IDS = Object.keys(KINDS);
export const GROUPS = { hit: { pl: "uderzenia", en: "hits" }, break: { pl: "pękanie", en: "breaking" }, blast: { pl: "wybuchy", en: "blasts" },
  motion: { pl: "ruch", en: "motion" }, element: { pl: "żywioły", en: "elements" }, power: { pl: "moce", en: "powers" },
  device: { pl: "urządzenia", en: "devices" }, voice: { pl: "głosy", en: "voices" } };

/* ---------- the word banks: tiers "a|b|c" (s quiet, m normal, l loud); st = stream syllables for repeating sounds ---------- */
const B = (s, m, l, st = null) => ({ s: s.split("|"), m: m.split("|"), l: l.split("|"), ...(st ? { st: st.split("|") } : {}) });
export const BANK = {
  pl: {
    punch:   B("PAC!|PAF!|ŁUP!|BACH!", "ŁUP!|BACH!|TRACH!|ŁUP-ŁUP!|BUCH!|BRAMM!|ŁUBDUMM!", "ŁUUP!|BAACH!|TRAACH!|ŁUP-BACH!|TRA-BRAMM!|BADUMM!", "ŁUP-BACH-PAC|PAC-PAC-ŁUP"),
    smash:   B("ŁUP!|BUCH!|TRACH!", "ŁUBUDU!|TRACH!|BUCH!|GRUCH!|TRZAMM!|BRZDAMM!", "ŁU-BU-DU!|TRA-TA-TRACH!|BU-BUCH!|TRZA-ŁUP!|KA-TRZAMM!|BRZDA-DAMM!"),
    slap:    B("PLASK!|PAC!|KLAP!", "PLASK!|PAC!|CHLAST!", "PLAASK!|CHLAAST!|PLASK-PLASK!"),
    thud:    B("BĘC!|BUCH!|ŁUP!|PUF!|DUMM!", "BĘC!|BUCH!|ŁUBUDU!|GRUCH!|GŁUMM!|DŁUMM!", "BĘĘC!|ŁU-BU-DU!|GRUUCH!|BUUM!|GŁUUMM!"),
    stomp:   B("TUP!|BUM!|TUP-TUP", "TUP!|BUM!|DUM!|ŁUP!", "BUUM!|DUUM!|ŁUUP!|TUP-BUM!", "TUP-TUP-BUM|BUM-BUM-ŁUP"),
    clang:   B("DZYŃ!|BRZDĘK!|BRZDĄK!|DZYNG!", "DZYŃ!|BRZDĘ-DZYŃ!|BRZDĘK!|BRZDĄK!|DZYNG!", "DZYYŃ!|BRZDĘĘK!|BRZDĘK-DZYŃ!|DZY-DZYNG!"),
    slash:   B("CIACH!|CHLAST!|ŚWIU!", "CIACH!|CHLAST!|ŚWIUU!|CIACH-CIACH!", "CIA-CIACH!|CHLAAST!|SZRRAK!|CIACH-CHLAST!"),
    bite:    B("CHRUP!|KŁAP!|HAM!|MLASK!", "CHRUP!|KŁAP!|CHRUP-CHRUP!|MLASK!", "CHRUUP!|KŁAP-KŁAP!|CHRUP-CHRUP!|HAM-HAM!"),
    crack:   B("KRAK!|TRZASK!|PRASK!|TRACH!", "KRAK!|TRZASK!|PRASK!|TRACH!|KRA-KAK!", "TRZA-TRZASK!|KRRA-KAK!|PRA-TRACH!|KRA-KA-TAK!"),
    shatter: B("BRZDĘK!|DZYŃ!|BRZDĄK!", "BRZDĘK!|BRZDĄK!|DZYŃ-DZYŃ!|TRZASK!", "BRZDĘĘK!|TRZASK-BRZDĘK!|DZY-DZY-DZYŃ!|BRZDĄ-BRZDĘK!", "DZYŃ-BRZDĘK-DZYŃ"),
    crash:   B("ŁUP!|GRUCH!|BĘC!|CHRUP!", "ŁUBUDU!|ŁUP-BĘC!|GRUCH!|TRZASK!", "ŁU-BU-DU!|ŁUBUDU-BUM!|GRU-GRUCH!|TRA-TA-ŁUP!", "ŁU-BU-DU|GRUCH-ŁUP-BĘC"),
    crumble: B("KRR|CHRZ|CHRUP", "KRR|CHRRZ|CHRUP-CHRZ|SZURR", "KRR|CHRUP-CHRUP|KRR-CHRRZ", "KRR-CHRZ-KRR"),
    rumble:  B("DUDU|GRRM|BRRUM", "DUDUDUU|GRRUM|BRRUM", "DUDUDUDUU|GRRUUM|BRRUUM|ŁUBUDUDUU", "DU-DU-DU|BRR-DU-DU"),
    creak:   B("SKRZYP|KRRK|SKRZ", "SKRZYP|SKRRZYP|SKRZYP-SKRZYP", "SKRZYYP|SKRZY-SKRZYYP|SKRRZYYP"),
    scrape:  B("SZUR|ZGRZ|SZURR", "SZURR|ZGRRZ|SZUR-SZUR", "SZUURR|ZGRRZ|SZRR", "SZUR-ZGRZ|ZGRZ-ZGRZ-ZGRZ"),
    boom:    B("BUM!|BACH!|BUCH!|PAF!", "BUM!|KABUM!|BUCH!|TRACH!|DŁUMM!|BRUMM!", "KA-BUUM!|KA-BU-BUM!|TRA-TA-BUM!|BUUM!|TRZUUMM!|KA-BRUUMM!", "BUM-BUM-BACH|BACH-BUM-BUM"),
    whump:   B("BUF|HUF|PUF", "BUF|HUF|PUFF", "BUUF!|HUUF!|WUUMF!"),
    thunder: B("TRACH!|BRRUM!|BUM!", "TRACH!|BRRUM!|TRZASK!|ŁU-BU-DU!", "TRA-TA-TRACH!|KRA-BUUM!|BRRU-BU-BUM!|TRZA-BUUM!", "BRR-DU-DU-BUM"),
    zap:     B("BZYK!|BZZT!|ZZYT!", "BZZT!|BZYK!|TRZASK!|ZZYT!|BZZAMM!|DZZYMM!", "BZZT!|TRZA-BZZT!|BZY-BZYK!|KRZZT!|TRZZAMM!", "BZT-BZT-BZZT|TRZ-BZT-TRZ"),
    beam:    B("PIU!|ZIU!|WZIU!|FIU!", "WZIUU!|ZIUUT!|PIUU!|BZYYM!|WZZUMM!|FZZIUMM!", "WZIUUM!|BZZIUUM!|ZIUUT!|WZZYYM!|WZZIUUMM!", "PIU-PIU-PIU|ZIU-ZIU"),
    gunshot: B("PAF!|PIF!|PIF-PAF!|PAC!", "PAF!|BACH!|PIF-PAF!|BUCH!", "BAACH!|PAAF!|BUCH-BACH!|BUUCH!", "PAF-PAF-PAF|PIF-PAF-PIF"),
    gunfire: B("TA-TA!|PAF-PAF!|RA-TA!", "TRA-TA-TA!|RA-TA-TA!|TA-TA-TA-TA!", "TRA-TA-TA-TA-TA!|RA-TA-TA-TA-TA!|TRRA-TA-TA-TA!|BRRT!", "TRA-TA-TA-TA|RA-TA-TA-TA|TA-TA-TA-TA-TA"),
    ricochet:B("PIU!|DZIU!|ZIU!", "PIUU!|DZIUŃ!|ZIUUM!", "PIUUŃ!|DZIUUŃ!|PTIUU!"),
    whoosh:  B("ŚWIU!|FIU!|SZU!|WSZ!|FFRU!", "ŚWIUU!|FIUU!|SZUU!|WSZUU!|WZUUSZ!|FSZUUM!", "ŚWIUU!|FIUU!|WSZUU!|SZSZUUM!|FFRUUSZ!|WSZUUMM!"),
    zoom:    B("WZIU!|ZIUT!|FRR!", "WZIUUM!|ZIUT!|FRUU!|WRRUM!", "WZIUUM!|WRRUUM!|ZZIUUT!|FRRUU!"),
    bounce:  B("HOP!|HYC!|BOING!|BOINK!", "HOP!|BOING!|HYC-HYC!|HOP-SAA!", "BOIING!|HOOP!|HOP-SAA!|BO-BOING!"),
    teleport:B("PUF!|PYK!|SZUP!|WIUP!", "PUF!|WIUP!|SZUP!|FRRT!", "PUUF!|WIUUP!|SZZUUP!|PYK-PUUF!"),
    wind:    B("SZSZ|FIU|UU", "SZUU|WIUU|HUU|FIUU", "SZSZUU|WIUU|HUU|ŁUU", "SZU-SZU-SZU|WIU-WIU"),
    fire:    B("BUCH!|FF!|PUF!|FRR!", "BUCH!|FRUM!|FFUM!|BUCH-FRR!|FRAMM!|FFUMM!", "BUUCH!|FRRUUM!|BU-BUCH!|FFRRUUM!|FFRAAMM!", "FRR-BUCH-FRR"),
    crackle: B("TRZASK|TRZ|PSTRYK|TRZ-TRZ", "TRZASK|PSTRYK-TRZ|TRZ-TRZ-TRZ|PSTRYK", "TRZA-TRZASK|TRZ-PSTRYK|TRZ-TRZ-TRZASK", "TRZ-TRZ-TRZASK|TRZ-TRZ-PSTRYK|PSTRYK-TRZ-TRZ"),
    hiss:    B("FSS|PSST|SS|TSS|SSS|TSS…", "FSS|PSST|TSS|SS|TSSS|FSSS…", "FSS|PSST|SS|PSSST|TSSS…", "SS-TSS-SS|FSS-SSS-PSST"),
    splash:  B("PLUM!|PLUSK!|CHLUP!|CHLAP!", "PLUSK!|CHLUP!|CHLAP!|PLUM!", "PLUUSK!|CHLU-CHLUP!|CHLAAST!|KA-PLUUSK!"),
    squish:  B("CIAP!|CHLAP!|PLAF!|MLASK!", "CIAP!|CHLAP!|MLASK!|CHLUP-CIAP!", "CIAAP!|CHLAAP!|MLAASK!|CIAP-CHLAP!"),
    drip:    B("KAP|KAP-KAP|PLIM", "KAP-KAP-KAP|PLIM|KAP", "KAAP!|PLIM-PLIM!|KAP-KAP-PLUM!", "KAP-KAP-KAP|PLIM-KAP"),
    powerup: B("WUM|BZYM|HMM", "WUUM|WZZUM|HMM|BZYYM|WMM|BZZUMM", "WUUM!|WZZUUM!|WRRUUM!|HAA!|WRRAAMM!", "WUM-WUM-WUM|BZY-BZY-BZYM"),
    psychic: B("MM|WII|HMM", "MM|WII|IIŃ|WMM", "MM|WIIŃ|IIŃ"),
    chime:   B("DZYŃ|DING|BIM|PLING", "DZYŃ|DING|BIM-BAM|DZYŃ-DZYŃ", "DZYYŃ!|DI-DING!|BIM-BAM-BOM|DZYŃ-DZYYŃ!"),
    fizzle:  B("PFF|PSST|FSS|PYK", "PFF|PSST|FSST|PYK-PFF", "PFF|PSST|PFF-PSST"),
    whiff:   B("FIU|FSZ|FF|ŚWIU", "FIUU|ŚWIUU|FFUU|FSZUU", "FIUU|ŚWIUU|FFUU"),
    click:   B("KLIK|PSTRYK|PYK|TIK", "KLIK-KLIK|PSTRYK|CYK-CYK|TRYK", "KLIIK!|PSTRYYK!|KLIK-KLAK!", "TIK-TAK|KLIK-KLIK"),
    beep:    B("PIP|PIK|BIP", "PIP|PIK-PIK|BIP", "PIIP!|PIK-PIK-PIK!|BI-BIIP!", "PIK-PIK-PIK|PIP-PIP"),
    engine:  B("WRR|BRUM|WRUM", "WRRUM|BRRUM|WRR|BRUM-BRUM|WRRAMM|BRRAMM", "WRRUUM!|BRRUUM!|WRR!|WRRAAMM!|BRRUUMM!", "WRR-WRR-WRUM|BRUM-BRUM"),
    siren:   B("IJO-IJO|UIU-UIU", "IJO-IJO-IJO|UIU-UIU-UIU|IIUU", "IJO-IJO-IJO-IJO!|UIU-UIU-UIU-UIU!|IIUU!", "IJO-IJO|UIU-UIU"),
    roar:    B("GRR!|WRR!|RAA!", "GRR!|WRRAA!|RAA!|GRAAU!", "GRRAAU!|WRRAA!|RRAAU!|GRAAH!"),
    pain:    B("AU!|AŁA!|AUĆ!|AJ!", "AA!|AUU!|AŁAA!|UGH!", "AA!|AARGH!|AUU!|AAUĆ!"),
    effort:  B("UFF!|HYP!|NGH!|HYY!", "HYY!|NNGH!|UGHH!|HMMPF!", "HYY!|NNGHH!|AAGH!|HRRAA!"),
    relief:  B("UFF|UF|ACH", "UFF|AACH|HAA|OCH", "UFF|AACH|HAA"),
    sigh:    B("EH…|OCH…|UCH…", "EEH…|OCH…|UUCH…|HAA…", "EEH…|OOCH…|UUCH…"),
    cheer:   B("HA!|JUHU!|JUPI!|HU-HA!", "HURA!|JUHUU!|HA-HA!", "HUURAA!|JUPII!|HURA-HURA!"),
    laugh:   B("HA!|HI-HI|CHA!", "HA-HA!|CHA-CHA!|HI-HI-HI|HE-HE!", "HA-HA-HA-HA!|BUA-HA-HA!|CHA-CHA-CHA!|MUA-HA-HA!", "HA-HA-HA|CHA-CHA-CHA"),
    shush:   B("CII!|SZ!|PSST!", "CII!|SZSZ!|PSST!", "CIII!|SZSZ!|PSSST!"),
    heartbeat:B("PUK|TUK|BUM", "TUK-TUK|BU-BUM|PUK-PUK", "BU-BUM! BU-BUM!|TUK-TUK-TUK-TUK!|BUM-BUM-BUM!", "BU-BUM|TUK-TUK")
  },
  en: {
    punch:   B("POW!|BAM!|WHAP!|WHAK!|BIFF!", "WHAM!|POW!|THWACK!|SMACK!|KA-POW!|KRAWW!|BWAMM!", "KA-POOW!|WHAAM!|THWAACK!|KA-WHAM!|PADOWW!|KA-BWAMM!", "POW-BAM-WHAP|BIFF-WHAK-POW"),
    smash:   B("WHAM!|BLAM!|KRUNCH!", "KRAKOOM!|WHAMM!|SKRAKK!|KA-BLAM!|SKRAMM!|KRANNG!", "KA-KRAKOOM!|KA-WHAAM!|KRA-KA-BLAM!|SKRA-KA-THOOM!|KA-SKRAMM!"),
    slap:    B("SLAP!|SMACK!|THWAP!", "SLAP!|SMACK!|THWAP!", "SLAAP!|SMAACK!|KA-SLAP!"),
    thud:    B("THUD!|THUMP!|FLUMP!|BONK!|DWUM!", "THUD!|THUMP!|WHUMP!|KLUNK!|THWUMM!|DWUMM!", "THUUD!|KA-THUMP!|WHUUMP!|KA-THOOM!|THWUUMM!"),
    stomp:   B("STOMP!|THMP!|TROMP!", "STOMP!|THOOM!|KROMP!", "STOOMP!|THOOM!|KA-STOMP!", "STOMP-STOMP|THOOM-THOOM"),
    clang:   B("CLANG!|TINK!|KLANG!|CLINK!", "CLANG!|KLANG!|SPANG!|KLONG!", "CLAANG!|KA-KLANG!|SPAANNG!|KLA-DANG!"),
    slash:   B("SHINK!|SLASH!|SWIK!", "SHING!|SLASH!|SKRITCH!|SHRAK!", "SHIING!|SLAASH!|SHRA-KAK!|KA-SHING!"),
    bite:    B("CHOMP!|CRUNCH!|SNAP!", "CHOMP!|CRUNCH!|CHO-CHOMP!", "CHOOMP!|CRUUNCH!|CHOMP-CHOMP!"),
    crack:   B("KRAK!|SNAP!|CRACK!|KRIK!", "KRAK!|SNAP!|CRACK!|SKRAK!", "KRRA-KAK!|KA-KRACK!|SKRA-KAK!|CRA-CRACK!"),
    shatter: B("TINK-TINK|KSSH!|CRSSH!|SMASH!", "KRSSHH!|SMASH!|KISSHH!|TINKA-TINK!", "KRSSHH!|KA-SMAASH!|KRA-KSSHH!", "TINK-KSSH-TINK"),
    crash:   B("CRASH!|CRUNCH!|KLUNK!", "CRASH!|KRASH!|CRUNCH!|KA-RASH!", "KRA-KA-THOOM!|KA-RAASH!|CRA-CRAASH!|KRAKATAK!", "KRASH-KLUNK-THUD"),
    crumble: B("KRRK|KRSHK|SKRNCH", "KRR-KRUNK|KRUNK|SKRRNCH", "KRR-KRUUNK|KRUUNK|SKRRNCH", "KRK-KRNCH-KRK"),
    rumble:  B("BRRM|GRMM|DRRM", "BRRUMM|RRUMM|GRROMM", "BRRUUMM|RROUUMM|GRROOMM", "RM-RM-RMM|DRM-DRM-DRM"),
    creak:   B("SKREEK|KREEK|SKREK", "SKRIK|KREEK|SKREEK", "SKRIIK|KREEK|SKREEK"),
    scrape:  B("SKRT|SKRRT|SKREE", "SKRRT|SKRAP|SKREE", "SKRRT|SKRAAP|SKREE", "SKRT-SKRT-SKREE"),
    boom:    B("BOOM!|BAM!|BLAM!|FOOM!", "BOOM!|KABOOM!|BLAM!|KA-BLAM!|THROOMM!|BRWOOM!", "KA-BOOM!|KRA-KABOOM!|KA-BLAAM!|BA-DOOM!|VWAAMM!|KA-THROOMM!", "BOOM-BOOM-BLAM|BLAM-BOOM"),
    whump:   B("FWUMP|WHUMP|PHUF", "WHUMP|FWUMP|WHOOMPH", "WHUUMP!|FWOOMPH!|KA-WHUMP!"),
    thunder: B("KRAK!|BRRM!|BOOM!", "KRA-KOOM!|BRROOM!|KRA-KA-BOOM!", "KRA-KA-BOOM!|KRA-KA-THOOM!|BRRA-KOOM!", "BRR-RRM-BOOM"),
    zap:     B("ZAP!|BZZT!|ZZT!|KZZT!", "ZZAP!|BZZT!|KRZZT!|ZZAKK!|ZWAMM!|TZZAMM!", "KA-ZZAAP!|BZZT!|ZZA-KRAK!|KRZZ-ZAP!|KZZAAMM!", "BZT-BZT-BZZT|ZAK-ZAK-ZAP"),
    beam:    B("ZAP!|PEW!|ZWIP!|VZT!", "VWOOM!|ZZAP!|PEEW!|VRRZZT!|VZWOOMM!", "VWOOM!|SKRA-ZZT!|KA-VWOOM!|VRZZT!|VZWOOMM!|ZWAAMM!", "PEW-PEW-PEW|ZAP-ZAP"),
    gunshot: B("BANG!|BLAM!|POP!|PAK!", "BLAM!|BANG!|KRAK!|BLAM-BLAM!", "BLAAM!|KA-BLAM!|BAANG!|KA-BANG!", "BLAM-BLAM-BLAM|BANG-BANG"),
    gunfire: B("RAT-TAT!|BRAP!|BLAM-BLAM!", "RAT-A-TAT!|BRRAP!|BLAM-BLAM-BLAM!", "RAT-A-TAT-A-TAT!|BRRAT!|BUDDA-BUDDA-BUDDA!", "RAT-TAT-TAT-TAT|BRAT-AT-AT-AT|BUDDA-BUDDA-BUDDA"),
    ricochet:B("PTANG!|PING!|TWANG!", "PTEEW!|PTING!|ZING!", "PTEEWW!|PTIING!|KA-ZIING!"),
    whoosh:  B("WHOOSH|SWISH|FWIP|FWISH|ZWISH", "WHOOSH|SWISH|FWOOSH|SHWOOM|ZWOOSH|FWAASH", "WHOOSH|SWIISH|FWOOSH|SHWOOM|FWAASHH!|ZWOOSHH!"),
    zoom:    B("ZOOM!|ZIP!|VROOM!", "ZOOM!|VROOM!|ZWOOSH!|NYEEW!", "ZOOM!|VROOM!|NYEEOWW!|KA-ZOOM!"),
    bounce:  B("BOING!|BOINK!|HUP!|SPROING!", "BOING!|SPROING!|BOING-OING!|HUP!", "BOIING!|SPROIING!|KA-BOIING!"),
    teleport:B("POP!|VWIP!|FZOOP!|BLIP!", "VWOP!|FZOOP!|SHWUP!|BLIP!", "VWOOP!|FZZOOP!|KA-VWOOP!|SHWUUP!"),
    wind:    B("WHOO|FWSH|SHH", "WHOO|WHEEW|FWOOSH|HOOM", "WHOO|WHEEW|HOO|FWOOSH", "WHOO-WHOO|SHH-WHOO"),
    fire:    B("FOOF!|FWIP!|FUMP!|FWOOSH!", "FWOOSH!|FOOM!|WHOOMF!|FWUMP!|FWAMM!|FRWOOM!", "FWOOSH!|FOOM!|KA-FWOOSH!|WHOOMPF!|FRWOOMM!", "FWUMP-FOOF-FWIP"),
    crackle: B("KRSSH|KRAK-KRIK|SNAP-SNAP|KRK-KRK", "KRSSHH|KRIK-KRAK|SNAP-KRSSH|KRK-KRK-KRK", "KRSSHH|KRSSH-KRIK|SNAP-KRK-KRSSH", "KRK-KRK-SNAP|SNAP-KRIK-POP|KRSSH-KRK"),
    hiss:    B("HISS|TSS|PSST|FSST|SSS|TSS…", "HISS|TSS|PSST|FSSHH|TSSS|FSSS…", "HISS|TSS|PSSHH|PSSST|TSSS…", "SS-TSS-SS|FSS-SSS-PSST"),
    splash:  B("SPLASH!|SPLOSH!|SPLAT!|PLOP!", "SPLASH!|SPLOOSH!|SPLOOT!|SPLOP!", "SPLAASH!|KA-SPLOOSH!|SPLOORSH!|SPLA-SPLASH!"),
    squish:  B("SPLUT!|SQUISH!|SPLORT!|GLORP!", "SQUISH!|SQUELCH!|SPLUT!|GLORP!", "SQUIISH!|SQUEELCH!|SPLOORT!|KA-SQUELCH!"),
    drip:    B("DRIP|PLIP|PLINK", "DRIP-DRIP|PLIP|DRIP", "DRIP-DRIP-DRIP|PLIIP|DRIIP-PLOP", "DRIP-DRIP-DRIP|PLIP-PLINK"),
    powerup: B("VMM|HMM|VWUM", "VWUM|VRRMM|HUMM|SHWAM|VMM|ZWUMM", "VWOOM!|VRRMM!|SHWAAM!|KA-VWOOM!|VWAAMM!", "VWUM-VWUM-VWUM|HMM-HMM-VMM"),
    psychic: B("MM|VRMM|EE", "MM|VREE|WHUMM|EE", "MM|VREE|WHUMM"),
    chime:   B("TING|DING|PLING|TINK", "TING|DING|SHING|TING-A-LING", "TIING!|DIING!|SHIING!|KA-SHING!"),
    fizzle:  B("FZZT|PFFT|FIZZ|PSST", "FZZT|PFFT|FIZZ|SPUT-SPUT", "FZZT|PFFT|FIZZT|SPUT-SPUT-PFFT"),
    whiff:   B("WHIFF|FWIP|SWISH|FFT", "WHIFF|FWIP|SWISH|FFT", "WHIIFF|FWIIP|SWIISH"),
    click:   B("CLICK|KLIK|TIK|SNIK", "CLICK-CLACK|KLICK|TIK-TAK|KA-CHUNK", "KA-CHIINK!|CLICK-CLAACK!|KA-CHUNK!", "TIK-TOK|CLICK-CLICK"),
    beep:    B("BEEP|BLIP|BIP", "BEEP|BEEP-BEEP|BLIP-BLIP", "BEEP!|BEEP-BEEP-BEEP!|BWEEP!", "BEEP-BEEP-BEEP|BLIP-BLIP"),
    engine:  B("VRM|VROOM|BRAP", "VRROOM|BRRAP|NYEEOW|VROOM-VROOM|VRAMM|WRRAMM", "VRROOM!|BRRAAP!|NYEEOWW!|WRRAAMM!|VRRAAMM!", "VRM-VRM-VROOM|BRAP-BRAP"),
    siren:   B("WEE-OO|WOO-WOO", "WEE-OO-WEE-OO|WEEOO|WOO-WOO-WOO", "WEE-OO-WEE-OO!|WEEOO!|WOO!", "WEE-OO|WOO-WOO"),
    roar:    B("GRR!|RAWR!|GRAWR!", "GRR!|RAAH!|RAAWR!|GRAAH!", "GRRAAH!|RRAAUGH!|RAAWR!|HRRAAH!"),
    pain:    B("OW!|OUCH!|OOF!|UNGH!", "ARGH!|AAH!|OWW!|UNGHH!", "AAH!|AARGHH!|AIEE!|NNGAAH!"),
    effort:  B("HUP!|NGH!|HUFF!|HMPF!", "HNNGG!|HRRNGH!|UNNGHH!|HUFF-HUFF!", "HNNGG!|HRRAAH!|GRRAAH!|NNGAAH!"),
    relief:  B("PHEW|AAH|HAH", "PHEW|AAH|HAA|WHEW", "PHEEW|AAH|HAAH"),
    sigh:    B("HH…|UGH…|OOF…|PFF…", "HAAH…|UUGH…|OOF…|PFF…", "HAAH…|UUGH…"),
    cheer:   B("HA!|YIP!|HUH!|WOO!", "WOO-HOO!|WOO!|HOO-HA!|YAHOO!", "YAHOO!|WOO!|YEE-HAAH!|HOO-RAAH!"),
    laugh:   B("HA!|HEH|HEE", "HA-HA!|HEH-HEH|HEE-HEE|HO-HO!", "HA-HA-HA-HA!|BWA-HA-HA!|MWA-HA-HA!|HAW-HAW-HAW!", "HA-HA-HA|HO-HO-HO"),
    shush:   B("SHH!|SHHT!|PSST!", "SHH!|SSHH!|PSST!", "SHH!|SSHH!|PSST!"),
    heartbeat:B("BA-DUM|THUMP|DUB", "BA-DUMP|THUMP-THUMP|LUB-DUB", "BA-DUMP! BA-DUMP!|THUMP-THUMP-THUMP!|BA-BUM-BA-BUM!", "BA-DUM|LUB-DUB")
  }
};

/* ---------- numbers: quantities, multipliers, ranges (REQUESTS ldic 6) ---------- */
const NUM = {
  pl: { dec: ",", group: " ", groupFrom: 10000, units: [[1e9, " MLD"], [1e6, " MLN"], [1e3, " TYS."]] },
  en: { dec: ".", group: ",", groupFrom: 1000, units: [[1e9, "B"], [1e6, "M"], [1e3, "K"]] }
};
/** A number for lettering. o: { lang, sign: "auto" | "always" | "never", digits (max decimals, 1), group: true (thousands separator:
    PL space from 10 000, EN comma from 1,000), compact: false | true | threshold (1.2K / 1,2 TYS.), times: false | "after" | "before"
    (3× / ×3), percent: false }. Minus is "-" (the engine's auto mood reads a leading - as pain, + as heal). */
export function formatNumber(n, o = {}) {
  const lang = NUM[o.lang] ? o.lang : (String(o.lang ?? "").startsWith("pl") ? "pl" : "en"), F = NUM[lang];
  let x = Number(n);
  if ( !Number.isFinite(x) ) return "?";
  const neg = x < 0; x = Math.abs(x);
  const digits = Number.isInteger(o.digits) ? Math.max(0, Math.min(3, o.digits)) : 1;
  let unit = "";
  const cmp = o.compact === true ? 1e4 : (Number.isFinite(o.compact) ? o.compact : Infinity);
  if ( x >= cmp ) for ( const [v, u] of F.units ) if ( x >= v * 0.9995 ) { x /= v; unit = u; break; }
  let s = x.toFixed(digits);
  if ( s.includes(".") ) s = s.replace(/0+$/, "").replace(/\.$/, "");
  let [int, frac] = s.split(".");
  if ( o.group !== false && int.length > 3 && Number(int) >= F.groupFrom ) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, F.group);
  s = int + (frac ? F.dec + frac : "") + unit + (o.percent ? "%" : "");
  if ( neg && s !== "0" ) s = "-" + s;
  else if ( o.sign === "always" && Number(n) > 0 ) s = "+" + s;
  if ( o.sign === "never" ) s = s.replace(/^[+-]/, "");
  if ( o.times === "before" ) s = "×" + s; else if ( o.times ) s = s + "×";
  return s;
}
/** a range "2–4" (en dash, no spaces); both ends formatted like formatNumber; equal ends give one number */
export function formatRange(a, b, o = {}) {
  const lo = formatNumber(a, { ...o, times: false }), hi = formatNumber(b, { ...o, times: false, sign: o.sign === "always" ? "auto" : o.sign });
  const s = Number(a) === Number(b) ? lo : `${lo}–${hi}`;
  return o.times === "before" ? "×" + s : o.times ? s + "×" : s;
}

/* ---------- text helpers ---------- */
const VOW = "AEIOUYĄĘÓ";
/** normalise a word for the engine: NFC, Polish upper case, one line, single spaces */
export const clean = (t) => String(t ?? "").normalize("NFC").toLocaleUpperCase("pl").replace(/\s+/g, " ").trim();
/* ONLY ONOMATOPOEIA (the user's rule, 2026-11-13): every word must imitate the sound itself, never a noun, verb or other word
   that names a sound ("CHRZĘST" names a crunch; it is not one). NAMING = words that only name a sound: refused in any syllable
   (compared with repeated letters collapsed: ŚWIIIST -> ŚWIST). NAMING_WORD = refused only as a whole word (TAK is a word, but
   TIK-TAK imitates a clock). check-words.mjs keeps them out of the banks; add() refuses them. BORDERLINE = words kept on purpose
   because they are also used as interjections that imitate the sound (or are English imitative words); the user may rule on them. */
export const NAMING = {
  pl: ["CHRZĘST", "CHRZĘŚCI", "ŁOMOT", "ŁOSKOT", "ŚWIST", "ŚWISZCZ", "ZGRZYT", "TRZESZCZ", "SKWIERCZ", "SYK", "HUK", "SZUM", "SZELEST", "BRZĘK",
    "BRZĘCZ", "ŚMIG", "GRZMOT", "SKOK", "KRACH", "PISK", "WYBUCH", "STUKOT", "TUPOT", "BULGOT", "CHLUPOT", "SZAST", "PRAST", "JĘK", "WRZASK",
    "KRZYK", "ŚMIECH", "BICIE", "STRZAŁ", "CIĘCIE", "PĘKNIĘCIE", "TRZASKANIE"],
  en: ["SIGH", "GASP", "GROAN", "GROWL", "CRACKLE", "CRUMBLE", "RUMBLE", "TINKLE", "SCRAPE", "CREAK", "SHUSH", "SPUTER", "SHATER", "SPARKLE",
    "SHIMER", "SCREAM", "EXPLOSION", "GNASH", "SOCK", "WHIP", "CHUCKLE", "GIGLE", "SNORE", "SOB", "HOWL", "SHRIEK", "LAUGH", "CHEER", "PUNCH", "KICK", "ROAR", "RUMBL", "CRUMBL", "RMBL", "CRMBL", "KRMBL"]
};
export const NAMING_WORD = { pl: ["TAK", "JEST", "HEJ", "DOBRA", "NIE", "UPS"], en: ["YES", "YEAH", "NO", "MEH", "OOPS", "WOW"] };
export const BORDERLINE = {
  pl: {
    TRZASK: "rzeczownik, ale też wykrzyknik naśladujący trzask (\"i drzwi trzask!\"), krótki i ostry jak sam dźwięk",
    PLUSK: "rzeczownik, ale też wykrzyknik naśladujący wpadnięcie do wody (\"plusk!\")",
    SKRZYP: "wykrzyknik naśladujący skrzypienie (\"skrzyp, skrzyp\"), zarazem rdzeń czasownika",
    BRZDĘK: "wykrzyknik dźwiękonaśladowczy (brzdęk!), nie nazwa", BRZDĄK: "wykrzyknik dźwiękonaśladowczy (brzdąk! struny, metal)",
    GRUCH: "wykrzyknik naśladujący głuche gruchnięcie (rdzeń czasownika gruchnąć)",
    CHRUP: "wykrzyknik naśladujący chrupnięcie (\"chrup!\")", MLASK: "wykrzyknik naśladujący mlaśnięcie", PSTRYK: "wykrzyknik naśladujący pstryknięcie",
    KŁAP: "wykrzyknik naśladujący kłapnięcie szczęk", KLAP: "wykrzyknik naśladujący klapnięcie", SZUR: "wykrzyknik naśladujący szuranie (\"szur, szur\")",
    HOP: "wykrzyknik towarzyszący skokowi (\"hop!\"), nie naśladuje samego dźwięku", HYC: "wykrzyknik skoku (\"hyc!\")", SA: "\"hop-sa\": wykrzyknik skoku",
    HURA: "okrzyk radości: sam dźwięk głosu wiwatu, nie jego nazwa", JUHU: "okrzyk radości (głos)", JUPI: "okrzyk radości (głos)",
    CIACH: "wykrzyknik naśladujący cięcie (\"ciach!\")", CHLAST: "wykrzyknik naśladujący chlaśnięcie", PRASK: "wykrzyknik naśladujący trzaśnięcie",
    BĘC: "wykrzyknik naśladujący upadek (\"bęc!\")", ŁUP: "wykrzyknik naśladujący uderzenie", ŁUBUDU: "wykrzyknik naśladujący łoskot upadku"
  },
  en: {
    CRASH: "imitative English word (the spelling is the sound), the standard comic effect", SMASH: "imitative, standard comic effect",
    SPLASH: "imitative", CRUNCH: "imitative", CRACK: "imitative", SNAP: "imitative", SLAP: "imitative", SLASH: "imitative (blade swish)",
    CLICK: "imitative", BANG: "imitative", BOOM: "imitative", POP: "imitative", HISS: "imitative", WHOOSH: "imitative", SWISH: "imitative",
    THUD: "imitative", THUMP: "imitative", STOMP: "imitative stamp of a foot", CHOMP: "imitative bite", DRIP: "imitative", FIZ: "imitative (FIZZ)",
    SQUISH: "imitative", SQUELCH: "imitative", ZAP: "comic imitative coinage", ZOM: "imitative (ZOOM)", CLANG: "imitative", CLINK: "imitative",
    WHIF: "comic miss sound (WHIFF), also a noun 'a smell'", HUF: "breath sound (HUFF), also a verb", SMACK: "imitative", SPLAT: "imitative",
    BEP: "imitative (BEEP)", HUP: "grunt of effort", TROMP: "imitative heavy step"
  }
};
/* the syllables of a word with repeated letters collapsed (ŚWIIIST -> ŚWIST, BRZĘĘK -> BRZĘK) */
const syllablesFlat = (w) => clean(String(w).replace(/\+/g, "")).replace(/[!?…\x27.,:]/g, "").split(/[-\s]+/).filter(Boolean).map((x) => x.replace(/(\p{L})\1+/gu, "$1"));
/** is this a naming word (not an onomatopoeia)? -> the offending part or null */
export function naming(word, lang = null) {
  const langs = lang ? [lang] : Object.keys(NAMING);
  const syl = syllablesFlat(word), whole = syl.join("-");
  for ( const L of langs ) {
    const deny = new Set((NAMING[L] ?? []).map((x) => x.replace(/(\p{L})\1+/gu, "$1")));
    for ( const x of syl ) if ( deny.has(x) ) return x;
    if ( (NAMING_WORD[L] ?? []).map((x) => x.replace(/(\p{L})\1+/gu, "$1")).includes(whole) ) return whole;
  }
  return null;
}
/** is every character of the word lettered by every font? (beyond this pure set, check.mjs proves it per font) */
export const renderable = (t) => { const w = clean(t).replace(/\+/g, ""); return w.length > 0 && w.length <= MAX_LEN + 8 && RENDERABLE.test(w); };

/* ---------- WHERE a word stretches (the user's question: which letters to repeat so the word describes the sound) ----------
   A sound has an ATTACK (its start: plosives K T P B D G C, the "K" of KRAK), a SUSTAIN (what lasts) and a CUTOFF (its end: the "K"
   of KRAK, the "T" of BZZT). Comic letterers lengthen only the sustain: BOOOOM (the resonance), BZZZZT (the buzz), GRRRR (the growl),
   SSSS (the hiss), HMMMM (the hum), FFFUUU (the air); never the attack or the cutoff (no KKKRAK, no BOOMMM-as-a-bang). So every
   letter belongs to a sustain CLASS and every sound kind lists, in order, which classes are its sustain:
     V vowels (A E I O U Y Ą Ę Ó)  resonance, ringing, voice, open boom     R  rolling, growl, engine, grinding, rasp
     Z buzz (Z Ż Ź, the Z of RZ)    electricity, insects, energy            S  hiss (S Ś, Polish SZ as a pair: SZSZSZ; English SH -> SHHH)
     M hum (M N Ń, the N of NG)     drone, charge, mind, the tail of a boom  F  air (F W)   H  breath (H, the H of CH)
   The stretch goes to the LAST run of the first listed class found in the word's LAST syllable (a prefix KA- or a first TRA- never
   stretches), up to MAX_RUN letters; what does not fit spills only FORWARD into the run right after it when that run is also one of
   the kind's classes (up to SPILL_RUN: BUUUMMM), never backward. Letters outside every class
   (plosives, affricates CZ DZ, L J) never repeat. A word with none of its kind's classes falls back to V R Z S M F H.
   A "+" in a CALLER's word (L.vocab.add) still marks an explicit stretch point and wins over the rule; the built-in banks have no "+". */
export const CLASSES = { V: "AEIOUYĄĘÓ", R: "R", Z: "ZŻŹ", S: "SŚ", M: "MNŃ", F: "FW", H: "H" };
export const DEFAULT_HOLD = ["V", "R", "Z", "S", "M", "F", "H"];
const DIGRAPHS = { pl: { SZ: { cls: "S", rep: "SZ" }, RZ: { cls: "Z", rep: "Z", lead: "R" }, CH: { cls: "H", rep: "H", lead: "C" }, CZ: { cls: null }, DZ: { cls: null }, DŹ: { cls: null }, DŻ: { cls: null } },
  en: { SH: { cls: "S", rep: "H", lead: "S" }, NG: { cls: "M", rep: "N", tail: "G" }, CH: { cls: null }, TH: { cls: null }, CK: { cls: null }, PH: { cls: "F", rep: "F", lead: "P" }, WH: { cls: null } } };
/** split a word into sound units (letters, or digraphs of the language) with their sustain class */
export function units(text, lang = "pl") {
  const D = DIGRAPHS[lang] ?? DIGRAPHS.pl, ch = [...String(text)], out = [];
  for ( let i = 0; i < ch.length; i++ ) {
    const two = ch[i] + (ch[i + 1] ?? "");
    if ( D[two] ) { out.push({ t: two, ...D[two], n: 1 }); i++; continue; }
    const cls = Object.entries(CLASSES).find(([, s]) => s.includes(ch[i]))?.[0] ?? null;
    out.push({ t: ch[i], cls, rep: ch[i], n: 1 });
  }
  /* merge repeats of one unit into a run (UUU, SZSZ) */
  const runs = [];
  for ( const u of out ) { const r = runs.at(-1); if ( r && r.t === u.t ) r.n++; else runs.push({ ...u }); }
  return runs;
}
const renderRun = (r) => {
  if ( !r.cls || r.rep === r.t ) return r.t.repeat(r.n);
  if ( r.rep === "SZ" ) return "SZ".repeat(r.n);
  if ( r.tail ) return r.rep.repeat(r.n) + r.tail;              // NG -> NNNG
  if ( r.lead != null && r.rep ) return r.lead + r.rep.repeat(r.n);   // SH -> SHHH, RZ -> RZZZ, CH -> CHHH
  return r.t.repeat(r.n);
};
/** index of the sustain run: the last run of the first class of `hold` (then of the default order) in the last syllable, or -1 */
export function sustainOf(runs, last, hold = DEFAULT_HOLD) {
  for ( const cls of [...hold, ...DEFAULT_HOLD.filter((c) => !hold.includes(c))] ) {
    for ( let i = runs.length - 1; i >= last; i-- ) if ( runs[i].cls === cls ) return i;
  }
  return -1;
}
/** stretch a word by `extra` letters on its sustain (see above). hold = the kind's classes in order; lang picks the digraphs. */
export function stretchText(text, extra, hold = DEFAULT_HOLD, lang = "pl") {
  const pl = stretchPlan(text, extra, hold, lang);
  return pl ? pl.runs.map(renderRun).join("") : String(text ?? "");
}
/** the stretch as sound units: { before, runs (after), last (first unit of the last syllable), target } or null (nothing to stretch);
    check-words.mjs proves the rule on it (which units grew) */
export function stretchPlan(text, extra, hold = DEFAULT_HOLD, lang = "pl") {
  let n = Math.max(0, Math.min(MAX_EXTRA, Math.round(extra)));
  const t = String(text ?? "");
  if ( !n || /\d/.test(t) ) return null;
  const runs = units(t, lang), before = runs.map((r) => ({ ...r }));
  let last = 0; runs.forEach((r, i) => { if ( r.t === "-" || r.t === " " ) last = i + 1; });
  /* the target: the last run of the first listed class in the last syllable; what does not fit spills only FORWARD into the run
     right after it when that run is also a listed sustain class (BUUUMMM, SZUUUMMM), never backward (no FFFSSS, no WWRRR) */
  const target = sustainOf(runs, last, hold);
  if ( target < 0 ) return null;
  const cap = (r, max) => Math.floor(max / (r.rep === "SZ" ? 2 : 1));
  const r = runs[target], nx = runs[target + 1];
  const tail = nx?.cls && nx.cls !== "V" && r.cls === "V" && hold.includes(nx.cls);
  /* the comic's manner: a ringing vowel followed by a continuant of the sound (M N W R S Z...) shares the stretch with it, one
     letter in three goes to the consonant (TWOOMM, BAAMM, POOWW: the hum or the air after the ring); otherwise only the overflow */
  const share = tail ? Math.floor(n / 3) : 0;
  const add = Math.max(0, Math.min(n - share, cap(r, MAX_RUN) - r.n)); r.n += add; n -= add;
  if ( n > 0 && nx?.cls && hold.includes(nx.cls) ) nx.n += Math.max(0, Math.min(n, cap(nx, SPILL_RUN) - nx.n));
  return { before, runs, last, target };
}
/** stretch a template: a CALLER's "+" marks are explicit stretch points (shared stretch); without marks the sustain rule above */
export function expand(tpl, extra, hold = DEFAULT_HOLD, lang = "pl") {
  const marks = (tpl.match(/\+/g) ?? []).length;
  const total = Math.max(0, Math.min(MAX_EXTRA, Math.round(extra)));
  if ( !marks ) return total > 0 ? stretchText(tpl, total, hold, lang) : tpl;
  let out = "", k = 0, given = 0, spill = 0;
  for ( const c of tpl ) {
    if ( c === "+" ) {
      k++; const n = Math.round((total * k) / marks) - given; given += n;
      const prev = [...out].at(-1); if ( !prev || n <= 0 ) continue;
      const run = (out.match(new RegExp(`${prev}+$`, "u")) ?? [""])[0].length;
      const fit = Math.max(0, Math.min(n, MAX_RUN - run));
      out += prev.repeat(fit); spill += n - fit;
      continue;
    }
    out += c;
  }
  return spill > 0 ? stretchText(out, spill, hold, lang) : out;
}
/* ---------- the exclamation scale 0..2 (the user's rule: the number of "!" is part of how the word shows the sound; the comic
   grades them up to two: POW!  TWOOM!!  FWOOOSH!!) ----------
   0  quiet, or a soft sustained sound that is not loud (a hum, wind, a sigh, a pipe hissing)   SSSS   HMMM   UFF
   1  an ordinary sound, or a loud one with a soft onset                                          KRAK!  ŁUP!   POW!
   2  loud                                                                                        BUUMM!! TRACH!! SKRAMM!!
   loud < 0.25 -> 0; < 0.6 -> 1; else 2; then one less for a soft onset (the kind's sharp < 0.35) unless very loud (>= 0.78), and
   one less for a long sound that is not loud (long > 0.7 and loud < 0.6). A word ending in "…" trails off and keeps it (no "!").
   bangs: 0..2 forces (a larger number is 2). */
export const MAX_BANGS = 2;
export function bangsFor(loud, sharp, long, force = null) {
  if ( Number.isFinite(force) ) return Math.max(0, Math.min(MAX_BANGS, Math.round(force)));
  if ( loud < 0.25 ) return 0;
  let n = loud < 0.6 ? 1 : 2;
  if ( sharp < 0.35 && loud < 0.78 ) n--;
  if ( long > 0.7 && loud < 0.6 ) n--;
  return Math.max(0, Math.min(MAX_BANGS, n));
}
/** duration 0..1 from the call: `long` (0 short .. 1 long) or `duration` (ms: 100 ms -> 0, 2 s -> 1); null = not given */
export function longOf(o = {}) {
  if ( Number.isFinite(o.long) ) return clamp01(o.long);
  if ( Number.isFinite(o.duration) ) return clamp01((o.duration - 100) / 1900);
  return null;
}
/** no letter repeated more than MAX_RUN times in a row (a stretched loud template stays readable) */
export const MAX_RUN = 6;
export const MAX_EXTRA = 12;
export const SPILL_RUN = 3;
export const capRuns = (t) => String(t).replace(/(\p{L})\1{6,}/gu, (m, c) => c.repeat(MAX_RUN));
const tierOf = (loud) => (loud < 0.34 ? "s" : loud < 0.67 ? "m" : "l");
const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** loudness 0..1 from the call: `loud` wins, else `magnitude` (0..2 or tiny..epic, the engine's size input), else 0.4 */
export function loudOf(o = {}) {
  if ( Number.isFinite(o.loud) ) return clamp01(o.loud);
  if ( o.magnitude != null ) return clamp01(0.1 + 0.6 * magnitudeOf(o.magnitude));
  return 0.4;              // = the engine's normal magnitude 0.5
}
/** "pl" | "en" | any registered language; "auto" / nothing = the game's language (Polish -> pl, a registered code -> it, else en) */
export function langOf(lang, known = ["pl", "en"]) {
  let l = lang && lang !== "auto" ? String(lang) : String(globalThis.game?.i18n?.lang ?? "en");
  l = l.toLowerCase();
  if ( known.includes(l) ) return l;
  const short = l.split(/[-_]/)[0];
  return known.includes(short) ? short : "en";
}

/* ---------- ACCENT: where the sound is loud inside the word (the seam with LOOK's per-letter size) ----------
   accentOf(text, { kind | mood, lang }) -> { accent: number[] (one 0..1 weight per character of the engine's normalised word:
   NFC, Polish upper case, single spaces; the same characters as plan.chars), peak: 0..1 (where the loudest letter sits), env }.
   1 = the loud peak, ~0.55 = a quiet lead-in (a prefix KA-, the first TRA- of TRA-TA-TRACH), lower = a fading tail; spaces 0.
   The shape follows the sound's envelope (ENV of the kind, or of the mood for plain text):
     hit    the attack and the start of the sustain are the peak, the stretched sustain decays (KRAK: K R A peak, K 0.7)
     swell  quiet attack, the sustain rises to the peak at its end (GRRRAAAH, WRRRUM: the growl/engine builds)
     fade   peak at the start, the sustain fades away (UUUFFF, PSSSS…, OCH…)
     arc    rises to the middle of the sustain then falls (a fly-by: WZIUUUM, WHOOOOSH, a ricochet)
     beat   every syllable has its own onset accent (TRA-TA-TA, HA-HA-HA, BU-BUM), the last one a little stronger
   "!" carries the peak weight, "…" a tail weight. In the main syllable: attack = letters before the sustain run, sustain = the run
   (sustainOf, the same rule as stretching), cutoff = the letters after it. */
export const ENVS = ["hit", "swell", "fade", "arc", "beat"];
/* CONTINUOUS sounds: the default flow style of a kind (see flow() in createVocab); a kind not listed: repeat -> cycle, long -> drone, else crackle */
export const FLOW_STYLES = ["steady", "drone", "crackle", "gust", "cycle"];
export const FLOW = { hiss: "steady", shush: "steady", fizzle: "steady", psychic: "steady",
  engine: "drone", rumble: "drone", powerup: "drone", beam: "drone", thunder: "drone", zoom: "drone",
  fire: "crackle", crackle: "crackle", scrape: "crackle", zap: "crackle", crumble: "crackle", creak: "crackle",
  wind: "gust", whoosh: "gust", sigh: "gust",
  siren: "cycle", gunfire: "cycle", heartbeat: "cycle", laugh: "cycle", beep: "cycle", drip: "cycle", roar: "drone" };
/* ---------- CHARACTER: what the sound is LIKE, so the lettering's look can fit it (the user: "napisy mają pasować wyglądem do
   dźwięków, które opisują"; the drawing is LOOK's, these are the facts it chooses from) ----------
   word.character = { hard, sharp, heavy, wet, metal, electric, heat, sustain, rough, pitch, contour, material, texture }
     hard     0 soft .. 1 hard          (a pillow thump .. a rock crack)
     sharp    0 dull .. 1 sharp attack  (the kind's sound.sharp)
     heavy    0 light .. 1 heavy        (a tick .. a falling wall; a louder word a little heavier)
     wet      0 dry .. 1 wet            (splash, squish, drip)
     metal    0 .. 1 metallic ring      (clang, ricochet, chime, a gun)
     electric 0 .. 1 electric / energy  (zap, beam, power-up)
     heat     -1 cold .. 0 .. 1 hot     (wind, a glass tinkle .. fire, a blast)
     sustain  0 short .. 1 sustained    (this word's duration, the same as word.long)
     rough    0 clean .. 1 gritty/noisy (sound.rough)
     pitch    -1 low .. 1 high          (sound.pitch)
     contour  "fall" | "rise" | "arc" | "pulse" | "steady"   (how it moves in time; from the accent envelope)
     material one of MATERIALS: what makes the sound (stone wood glass metal water fire air flesh energy mind machine voice rubber)
     texture  one of TEXTURES: its surface (crisp jagged gritty smooth ringing billowy bubbly shaky)
   Per kind in CHAR below (hard heavy wet metal electric heat material texture); plain text gets the character of its mood. */
export const MATERIALS = ["stone", "wood", "glass", "metal", "water", "fire", "air", "flesh", "energy", "mind", "machine", "voice", "rubber"];
export const TEXTURES = ["crisp", "jagged", "gritty", "smooth", "ringing", "billowy", "bubbly", "shaky"];
const CHAR = {
  punch: ".7 .6 0 0 0 0 flesh crisp", smash: ".9 .9 0 .2 0 0 stone jagged", slap: ".4 .3 .1 0 0 0 flesh crisp",
  thud: ".4 .9 0 0 0 0 flesh smooth", stomp: ".7 .9 0 0 0 0 stone gritty", clang: "1 .6 0 1 0 0 metal ringing",
  slash: ".8 .3 0 .6 0 0 metal crisp", bite: ".7 .4 .3 0 0 0 flesh jagged",
  crack: "1 .4 0 0 0 0 stone jagged", shatter: "1 .3 0 .2 0 -.2 glass jagged", crash: ".9 1 0 .3 0 0 stone jagged",
  crumble: ".6 .7 0 0 0 0 stone gritty", rumble: ".5 1 0 0 0 0 stone shaky", creak: ".6 .4 0 0 0 0 wood gritty",
  scrape: ".8 .5 0 .6 0 .1 metal gritty",
  boom: ".6 1 0 0 0 .7 fire billowy", whump: ".3 .8 0 0 0 .2 air billowy", thunder: ".6 1 .1 0 .5 0 air shaky",
  zap: ".8 .2 0 .2 1 .2 energy jagged", beam: ".5 .4 0 0 .8 .4 energy smooth", gunshot: "1 .5 0 .7 0 .3 metal crisp",
  gunfire: "1 .5 0 .7 0 .3 metal crisp", ricochet: "1 .2 0 1 0 0 metal ringing",
  whoosh: "0 .3 0 0 0 0 air smooth", zoom: ".2 .4 0 0 0 0 air smooth", bounce: ".2 .3 0 0 0 0 rubber bubbly",
  teleport: ".3 .1 0 0 .6 -.2 energy smooth", wind: "0 .2 0 0 0 -.5 air smooth",
  fire: ".3 .5 0 0 0 1 fire billowy", crackle: ".7 .2 0 0 .2 .8 fire gritty", hiss: ".2 .1 .3 0 0 .3 air smooth",
  splash: ".1 .5 1 0 0 0 water bubbly", squish: ".1 .4 1 0 0 0 flesh bubbly", drip: ".3 .1 1 0 0 -.2 water bubbly",
  powerup: ".4 .6 0 0 .7 .3 energy smooth", psychic: ".1 .3 0 0 .4 0 mind smooth", chime: ".8 .1 0 1 0 -.3 metal ringing",
  fizzle: ".2 .1 .2 0 .5 -.3 energy gritty", whiff: "0 .1 0 0 0 0 air smooth",
  click: ".9 .1 0 .5 0 0 machine crisp", beep: ".6 .1 0 .3 .6 0 machine crisp", engine: ".6 .8 0 .7 .2 .4 machine shaky",
  siren: ".5 .4 0 .4 .5 0 machine smooth",
  roar: ".4 .9 .1 0 0 .3 voice gritty", pain: ".4 .5 0 0 0 0 voice shaky", effort: ".5 .7 0 0 0 0 voice gritty",
  relief: "0 .3 0 0 0 0 voice smooth", sigh: "0 .2 0 0 0 0 voice smooth", cheer: ".3 .3 0 0 0 .2 voice bubbly",
  laugh: ".3 .3 0 0 0 0 voice bubbly", shush: "0 .1 0 0 0 0 voice smooth", heartbeat: ".4 .6 .3 0 0 .2 flesh smooth"
};
for ( const [id, s] of Object.entries(CHAR) ) {
  const [hard, heavy, wet, metal, electric, heat, material, texture] = s.split(" ");
  KINDS[id].char = { hard: +hard, heavy: +heavy, wet: +wet, metal: +metal, electric: +electric, heat: +heat, material, texture };
}
/** the kind a plain text of a mood resembles (for its character) */
export const MOOD_KIND = { impact: "punch", crack: "crack", crash: "crash", boom: "boom", roar: "roar", fire: "fire", whoosh: "whoosh",
  zap: "zap", tick: "click", pain: "pain", powerup: "powerup", heal: "relief", splash: "splash", fail: "fizzle" };
const CONTOUR = { hit: "fall", swell: "rise", fade: "fall", arc: "arc", beat: "pulse" };
/** the character of a sound: o = { kind | mood, loud, long, env, def (a kind definition, for kinds made with define()) } */
export function characterOf(o = {}) {
  const k = o.def ?? KINDS[o.kind] ?? KINDS[MOOD_KIND[o.mood]] ?? KINDS.punch;
  const c = k.char ?? KINDS.punch.char, s = k.sound ?? {};
  const loud = Number.isFinite(o.loud) ? o.loud : 0.4, long = Number.isFinite(o.long) ? o.long : (s.long ?? 0.3);
  const env = o.env ?? k.env ?? "hit";
  const r2c = (x) => Math.round(Math.max(0, Math.min(1, x)) * 100) / 100;
  return { hard: c.hard, sharp: r2c(s.sharp ?? 0.5), heavy: r2c(c.heavy + 0.2 * (loud - 0.4)), wet: c.wet, metal: c.metal, electric: c.electric,
    heat: c.heat, sustain: r2c(long), rough: r2c(s.rough ?? 0.3), pitch: Math.max(-1, Math.min(1, s.pitch ?? 0)),
    contour: (FLOW[o.kind] === "steady" || o.steady) ? "steady" : CONTOUR[env] ?? "fall", material: c.material, texture: c.texture };
}
const KIND_ENV = {
  hit: "punch smash slap thud stomp clang slash bite crack shatter crash boom thunder zap gunshot splash squish drip click teleport bounce chime pain cheer",
  swell: "rumble crumble powerup roar engine fire psychic effort",
  fade: "sigh fizzle whiff relief hiss shush whump",
  arc: "whoosh zoom ricochet wind beam scrape creak",
  beat: "gunfire laugh heartbeat beep siren crackle"
};
for ( const [env, ids] of Object.entries(KIND_ENV) ) for ( const id of ids.split(" ") ) KINDS[id].env = env;
/** the envelope of a plain text's mood (callers that pass their own text: the engine's mood decides) */
export const MOOD_ENV = { impact: "hit", crack: "hit", crash: "hit", boom: "hit", zap: "hit", splash: "hit", pain: "hit", tick: "hit",
  roar: "swell", fire: "swell", powerup: "swell", whoosh: "arc", heal: "fade", fail: "fade" };
const r2 = (x) => Math.round(x * 100) / 100;
export function accentOf(text, o = {}) {
  const word = clean(text), chars = [...word];
  const k = o.kind ? KINDS[o.kind] : null;
  const env = o.env ?? k?.env ?? MOOD_ENV[o.mood] ?? "hit";
  const hold = o.hold ?? k?.hold ?? DEFAULT_HOLD, lang = o.lang === "en" ? "en" : "pl";
  const acc = new Array(chars.length).fill(0);
  /* syllables by character index (split on - and spaces) */
  const syl = []; let cur = null;
  chars.forEach((c, i) => { if ( c === "-" || c === " " ) { cur = null; return; } if ( !cur ) { cur = { a: i, b: i }; syl.push(cur); } cur.b = i; });
  if ( !syl.length ) return { accent: acc, peak: 0.5, env };
  const letterIdx = (s) => { const out = []; for ( let i = s.a; i <= s.b; i++ ) if ( /[\p{L}\d]/u.test(chars[i]) ) out.push(i); return out; };
  /* one syllable shaped by the envelope; top = its peak weight */
  const shape = (s, top, e) => {
    const L = letterIdx(s); if ( !L.length ) { for ( let i = s.a; i <= s.b; i++ ) acc[i] = top * 0.8; return; }
    const sub = chars.slice(L[0], L.at(-1) + 1).join("");
    const runs = units(sub, lang);
    const t = sustainOf(runs, 0, hold);
    /* map runs back to character indices */
    let pos = L[0]; const spans = runs.map((r) => { const len = [...r.t].length * r.n; const sp = [pos, pos + len - 1]; pos += len; return sp; });
    const [sa, sb] = t >= 0 ? spans[t] : [L[0], L[0]];
    for ( let i = L[0]; i <= L.at(-1); i++ ) {
      const inS = i >= sa && i <= sb, u = sb > sa ? (i - sa) / (sb - sa) : 0;
      let w;
      if ( e === "hit" ) w = i < sa ? 1 : inS ? 1 - 0.4 * u : 0.7;
      else if ( e === "swell" ) w = i < sa ? 0.6 : inS ? 0.65 + 0.35 * (sb > sa ? u : 1) : 0.9;
      else if ( e === "fade" ) w = i < sa ? 1 : inS ? 0.9 - 0.55 * u : 0.35;
      else if ( e === "arc" ) w = i < sa ? 0.6 : inS ? (sb > sa ? 0.65 + 0.35 * Math.sin(Math.PI * u) : 1) : 0.6;
      else w = i === L[0] ? 1 : inS ? 0.85 : 0.75;                       // beat: the onset of each syllable
      acc[i] = top * w;
    }
    for ( let i = s.a; i <= s.b; i++ ) if ( !/[\p{L}\d]/u.test(chars[i]) ) acc[i] = top * (chars[i] === "…" ? 0.3 : e === "fade" ? 0.5 : 1);
  };
  if ( env === "beat" ) syl.forEach((s, j) => shape(s, j === syl.length - 1 ? 1 : 0.9, "beat"));
  else {
    syl.slice(0, -1).forEach((s) => shape(s, 0.55, "hit"));                // lead-in syllables (a prefix, TRA- of TRA-TA-TRACH)
    shape(syl.at(-1), 1, env);
  }
  /* trailing marks after the last syllable */
  for ( let i = syl.at(-1).b + 1; i < chars.length; i++ ) if ( chars[i] !== " " && chars[i] !== "-" ) acc[i] = chars[i] === "…" ? 0.3 : (env === "fade" ? 0.5 : 1);
  const accent = acc.map(r2);
  /* peak: the centre of the loudest letters (>= 0.97 of the max), as a 0..1 position along the word */
  const mx = Math.max(...accent), top = accent.map((w, i) => (w >= mx * 0.97 && /[\p{L}\d]/u.test(chars[i]) ? i : -1)).filter((i) => i >= 0);
  const peak = chars.length > 1 && top.length ? r2((top.reduce((a, b) => a + b, 0) / top.length) / (chars.length - 1)) : 0.5;
  return { accent, peak, env };
}

/* ---------- the vocabulary: one instance per engine (callers and other modules add / override words on the shared engine) ---------- */
export function createVocab() {
  const kinds = JSON.parse(JSON.stringify(KINDS));
  const bank = JSON.parse(JSON.stringify(BANK));
  const alias = new Map();
  const reAlias = () => { alias.clear(); for ( const [id, k] of Object.entries(kinds) ) { alias.set(id, id); for ( const a of k.alias ?? [] ) if ( !alias.has(a) ) alias.set(a, id); } };
  reAlias();
  const recent = new Map();        // unseeded only: `${kind}|${lang}` -> last texts (never the same twice in a row)
  const warned = new Set();
  const warn = (k, msg) => { if ( warned.has(k) ) return; warned.add(k); try { console.warn(`LETR vocabulary: ${msg}`); } catch {} };
  const langs = () => Object.keys(bank);

  function kindOf(kind) {
    const id = alias.get(String(kind ?? "").toLowerCase().trim());
    if ( id ) return id;
    warn(`kind:${kind}`, `unknown sound kind "${kind}", using "punch"`);
    return "punch";
  }
  /* a kind's templates in a language, falling back tier -> neighbour tiers -> English */
  function listOf(id, lang, tier) {
    const order = { s: ["s", "m", "l"], m: ["m", "s", "l"], l: ["l", "m", "s"], st: ["st"] }[tier];
    for ( const L of [lang, "en"] ) { const b = bank[L]?.[id]; if ( !b ) continue; for ( const t of order ) if ( b[t]?.length ) return { list: b[t], lang: L, tier: t }; }
    return { list: [], lang, tier };
  }
  /* the accent of a word's FINAL text (after stretch, prefix, "!"): word.accent / word.peak, sound.peak and play.accent */
  const withAccent = (w) => {
    const k = kinds[w.kind] ?? {};
    const a = accentOf(w.text, { env: k.env, hold: k.hold, lang: w.lang });
    const sound = { ...w.sound, peak: a.peak };
    const character = characterOf({ def: k, kind: w.kind, loud: w.loud, long: w.long, env: a.env, steady: w.style === "steady" });
    return Object.assign(w, { accent: a.accent, peak: a.peak, env: a.env, character, sound, play: { ...w.play, sound, accent: a.accent, character } });
  };
  const pickMotion = (k, R) => ({ in: R.pick(k.motion.in), holdKind: R.pick(k.motion.hold), out: R.pick(k.motion.out) });

  /** One word. o: { lang, loud | magnitude (how LOUD), long | duration (how LONG: separate from loudness), bangs (0..2, force the
      "!" count), seed, step (n-th repeat of the same sound: louder, longer), avoid (texts or templates to skip), template (pin a
      template), prefix (true / false / a string), stream (true: syllables for L.stream) }.
      -> { text, kind, lang, tier, loud, long, bangs, step, template, prefix, syllables?, mood, sound, motion, play, accent, peak, env, character }
      Loudness picks the tier (the word), the "!" count, the prefix and the size; duration alone decides how much the word stretches. */
  function word(kind, o = {}) {
    const id = kindOf(kind), k = kinds[id], lang = langOf(o.lang, langs());
    const step = Math.max(0, Number.isFinite(o.step) ? Math.floor(o.step) : 0);
    const base = loudOf(o), loudEff = base + 0.15 * step, loud = clamp01(loudEff);
    /* duration: the caller's, else the kind's natural length (a crack is short, wind is long), a loud sound ringing a little longer */
    const asked = longOf(o);
    const long = clamp01((asked ?? clamp01(k.sound.long + 0.15 * (loud - 0.4))) + 0.12 * step);
    const seeded = o.seed != null;
    const R = rng(seeded ? `${o.seed}|${id}|${lang}` : (Math.random() * 4294967296) >>> 0);
    const tier = o.stream ? "st" : tierOf(loud);
    let { list, lang: usedLang, tier: usedTier } = listOf(id, lang, tier);
    if ( o.stream && !list.length ) ({ list, lang: usedLang, tier: usedTier } = listOf(id, lang, tierOf(loud)));
    const avoid = new Set([...(o.avoid ?? [])].map((x) => clean(x)));
    const mem = `${id}|${usedLang}`;
    if ( !seeded ) for ( const t of recent.get(mem) ?? [] ) avoid.add(t);
    let tpl = o.template != null ? clean(o.template) : null;
    if ( !tpl ) {
      const ok = list.filter((t) => !avoid.has(clean(t)) && !avoid.has(clean(t).replace(/\+/g, "")));
      tpl = R.pick(ok.length ? ok : list) ?? id.toUpperCase();
    }
    /* the template without its ending; the ending is decided below (the "!" scale, or "…" for a sound that trails off) */
    const trails = /…$/.test(tpl) && loud < 0.6;        // a trailing sound said loud loses its "…" and gets the "!" scale
    const core = clean(tpl).replace(/[!?…]+$/, "");
    /* stretch from DURATION only: nothing for a short sound (long <= 0.3: THUD!, POW!), up to (kind stretch + 1) extra letters for the
       longest; the templates already carry the comic's usual doubling (TWOOM-like OO, MM), so a normal sound stays near it */
    const extra = (k.stretch + 1) * Math.max(0, long - 0.3) / 0.7 + (Number.isFinite(o.stretchAdd) ? o.stretchAdd : 0);
    let text = capRuns(clean(expand(core, o.stream ? 0 : extra, k.hold ?? DEFAULT_HOLD, usedLang)));
    /* prefix at the very top (a seeded coin), or when asked */
    const pres = k.pre?.[usedLang] ?? [];
    const wantPre = o.prefix === false ? false : (typeof o.prefix === "string" ? o.prefix : (o.prefix === true || (loudEff >= 0.92 && R.chance(0.5))) && pres.length ? R.pick(pres) : false);
    if ( wantPre && !o.stream && !text.includes("-") ) text = clean(wantPre) + text;
    const bangs = o.stream ? 0 : (trails && !Number.isFinite(o.bangs) ? 0 : bangsFor(loud, k.sound.sharp, long, o.bangs));
    if ( !o.stream ) text += trails && !bangs ? "…" : "!".repeat(bangs);
    if ( !seeded ) { const r = recent.get(mem) ?? []; r.push(clean(tpl), text); while ( r.length > 4 ) r.shift(); recent.set(mem, r); }
    const sound = { ...k.sound, loud: Math.max(0.1, Math.min(1, 0.15 + 0.85 * loud)), long };
    const motion = pickMotion(k, R);
    const out = { text, kind: id, lang: usedLang, tier: usedTier, loud, long, bangs, step, template: tpl, prefix: wantPre && !o.stream && !text.startsWith(core.slice(0, 1)) ? wantPre : null, mood: k.mood, sound, motion,
      play: { mood: k.mood, sound, in: motion.in, holdKind: motion.holdKind, out: motion.out, magnitude: Math.round(Math.max(0, (loud - 0.1) / 0.6) * 100) / 100 } };
    if ( o.stream ) out.syllables = text.split(/[-\s]+/).filter(Boolean);
    return withAccent(out);
  }

  /** n words of one sound for a series or an escalation. o.grow: "stretch" (default: one template, each step louder and longer, a
      prefix from step 2 when the kind has one) or "vary" (a different word each step, rising tiers). Never the same text twice in a row. */
  function series(kind, n, o = {}) {
    const out = [];
    const first = word(kind, { ...o, step: 0 });
    out.push(first);
    const k = kinds[first.kind];
    const core0 = clean(first.template).replace(/[!?…]+$/, "");
    const pre0 = first.prefix ? [...clean(first.prefix)].length : 0;
    let plain = (first.prefix ? clean(first.prefix) : "") + core0;
    const add0 = Math.max(0, [...first.text.replace(/[!?…]+$/, "")].length - pre0 - [...core0].length);
    for ( let i = 1; i < Math.max(1, n); i++ ) {
      const prev = out[i - 1];
      /* a repeating sound (gunfire, laughter, a siren) grows by one more syllable, not by longer letters: RA-TA -> RA-TA-TA */
      if ( k.repeat && o.grow !== "vary" && !/\s/.test(prev.text) ) {
        const end = (prev.text.match(/[!?…]*$/) ?? [""])[0], body = prev.text.slice(0, prev.text.length - end.length);
        const syls = clean(first.template).replace(/[!?…]+$/, "").split("-");
        const syl = syls.length === 1 ? syls[0] : k.repeat === "pair" && syls.at(-1) !== syls.at(-2) ? syls.slice(-2).join("-") : syls.at(-1);
        const grown = `${plain}-${syl}`;
        const next = capRuns(clean(stretchText(grown, add0 + i, k.hold ?? DEFAULT_HOLD, first.lang))) + (end || (i >= 2 ? "!" : ""));
        if ( next.replace(/[!?…]/g, "").length <= MAX_LEN ) { plain = grown; out.push(withAccent({ ...word(kind, { ...o, step: i, template: first.template }), text: next, prefix: null })); continue; }
      }
      if ( o.grow === "vary" ) {
        const w = word(kind, { ...o, seed: o.seed != null ? `${o.seed}:${i}` : undefined, step: i, avoid: [...(o.avoid ?? []), prev.template, prev.text] });
        if ( w.text === prev.text ) w.text = capRuns(clean(stretchText(w.text, 1, k.hold ?? DEFAULT_HOLD, w.lang)));
        out.push(withAccent(w)); continue;
      }
      /* stretch mode: each step is ONE notch more than the last (so a long escalation keeps growing instead of jumping to the
         ceiling): one more sustain letter; when the sustain is full, one more "!" (at most 2); then the prefix (from step 2 on,
         when the kind has one); then an echo of the plain word in front (KRAK-KRAAAAAK!!!). Never shorter, never the same twice. */
      const w = word(kind, { ...o, step: i, template: first.template, prefix: false });
      const hold = k.hold ?? DEFAULT_HOLD;
      let pre = prev.prefix ? clean(prev.prefix) : "";
      const end = (prev.text.match(/[!?…]*$/) ?? [""])[0];
      let bangs = (end.match(/!/g) ?? []).length, body = prev.text.slice(pre.length, prev.text.length - end.length);
      const pres = k.pre?.[prev.lang] ?? [];
      let notch = false;
      const longer = capRuns(clean(stretchText(body, 1, hold, prev.lang)));
      if ( !pre && i >= 2 && o.prefix !== false && pres.length ) pre = clean(typeof o.prefix === "string" ? o.prefix : pres[i % pres.length]);
      else if ( longer !== body ) body = longer;
      else if ( bangs < MAX_BANGS ) { bangs++; notch = true; }
      else if ( `${pre}${core0}-${body}`.length <= MAX_LEN ) body = `${core0}-${body}`;
      if ( !notch && w.bangs > bangs ) bangs = Math.min(MAX_BANGS, bangs + 1);
      w.text = pre + body + (bangs ? "!".repeat(bangs) : end === "…" ? "…" : "");
      w.prefix = pre || null; w.bangs = bangs;
      out.push(withAccent(w));
    }
    return out;
  }
  /** CONTINUOUS sounds (a fire burning, an engine, a siren, a held beam, wind, a hum, a hail of bullets, the steady hiss of a pipe):
      a FLOW of words that lasts as long as the sound, never one word repeated and never one endless run of a letter.
      flow(kind, { lang, seed, loud, style, duration (ms, for take()) }) -> { kind, lang, style, onset, at(i), tail, take(ms) }
        onset   the word the sound starts with (its attack, a little louder)
        at(i)   the i-th body segment (i = 0, 1, 2 ... forever; deterministic for a seed, never the same text twice in a row)
        tail    the word it ends with (quiet, trailing "…", or the cutoff)
        take(ms) onset + as many body segments as fill ms + tail, each with its start t and length ms
      A segment: { phase: "onset" | "body" | "tail", i, t, ms, text, loud, long, bangs, accent, peak, env, play } (play = L.play options).
      How the words evolve, by STYLE (the kind's default, or o.style):
        steady  a constant quiet sound (a pipe hissing, a hum): long quiet words of the sound's sustain with a slow breath in their
                length (SSSS, TSSSSS, FSSS…), no "!", now and then a small sputter (PSST); loudness wavers by +-0.05 only
        drone   a held mechanical/energy sound (engine, beam, power, rumble): one family of words whose sustain swells and sinks on
                a slow wave (WRRUM, WRRRRAMM, BRRUMM), the crest of a swell may get one "!"
        crackle irregular bursts over a bed (fire, crackling, grinding, sparks): a quiet stretched bed word, then 1-3 short pops
                (TRZ-TRZ!, PSTRYK), irregular, louder and quieter
        gust    waves (wind, a long whoosh): rising long word with "!" at a crest, short trailing word at a trough
        cycle   a pattern (siren, gunfire, heartbeat, laughter, beeps, drips): the kind's syllable in groups of 2-4 that vary in count
                and accent (TA-TA-TA, TA-TA!, TA-TA-TA-TA), a siren alternating its rise and fall
      The vocabulary only says WHAT is lettered WHEN; how the segments move, overlap or cross-fade is MOVE's (API-CONTRACT v5). */
  function flow(kind, o = {}) {
    const id = kindOf(kind), k = kinds[id], lang = langOf(o.lang, langs());
    const style = FLOW_STYLES.includes(o.style) ? o.style : (FLOW[id] ?? (k.repeat ? "cycle" : k.sound.long >= 0.6 ? "drone" : "crackle"));
    const seed = o.seed ?? ((Math.random() * 4294967296) >>> 0);
    const base = loudOf({ loud: o.loud ?? (style === "steady" ? 0.15 : undefined), magnitude: o.magnitude });
    const hold = k.hold ?? DEFAULT_HOLD, phase = rng(`${seed}|phase`)() * 6.28;
    const pool = (t) => { const b = bank[lang]?.[id] ?? bank.en?.[id] ?? {}; return [...(b[t] ?? [])]; };
    const plainOf = (t) => clean(t).replace(/[!?…]+$/, "");
    const seg = (phase, i, text, loud, long, bangs, ms) => withAccent({ phase, i, t: 0, ms: Math.round(ms), text, kind: id, lang, loud, long, bangs, style,
      mood: k.mood, sound: { ...k.sound, loud: Math.max(0.1, Math.min(1, 0.15 + 0.85 * loud)), long },
      play: { mood: k.mood, in: k.motion.in[0], holdKind: k.motion.hold[0], out: k.motion.out[0], magnitude: Math.round(Math.max(0, (loud - 0.1) / 0.6) * 100) / 100 } });
    const end = (b, trail) => (b ? "!".repeat(b) : trail ? "…" : "");
    const body = (i) => {
      const R = rng(`${seed}|flow|${id}|${lang}|${i}`);
      const wave = Math.sin(i * 0.9 + phase);
      const fam = [...pool("m"), ...pool("s")].map(plainOf).filter((t) => !t.includes("-") || style === "cycle");
      const st = [...pool("st"), ...pool("s")].map(plainOf);
      if ( style === "steady" ) {
        const loud = clamp01(base + 0.05 * wave);
        if ( i % 5 === 4 ) { const t = R.pick(st.filter((x) => x.length <= 6)) ?? R.pick(fam); return seg("body", i, t.split("-")[0], loud, 0.2, 0, 500); }
        const t = R.pick(fam.filter((x) => !x.includes("-"))) ?? fam[0];
        return seg("body", i, capRuns(clean(stretchText(t, 3 + Math.round(2 * (wave + 1)), hold, lang))), loud, 1, 0, 1100 + 250 * wave);
      }
      if ( style === "drone" ) {
        const loud = clamp01(base + 0.18 * wave), t = fam[Math.floor(i / 3) % Math.max(1, fam.length)] ?? R.pick(fam);
        const bangs = wave > 0.85 && loud >= 0.45 ? 1 : 0;
        return seg("body", i, capRuns(clean(stretchText(t, 1 + Math.round(2 * (wave + 1)), hold, lang))) + end(bangs, false), loud, 0.6 + 0.4 * (wave + 1) / 2, bangs, 800 + 200 * wave);
      }
      if ( style === "gust" ) {
        const loud = clamp01(base + 0.25 * wave), t = R.pick(fam), crest = wave > 0.5, trough = wave < -0.5;
        const bangs = crest && loud >= 0.45 ? 1 : 0;
        return seg("body", i, capRuns(clean(stretchText(t, crest ? 6 : trough ? 0 : 3, hold, lang))) + end(bangs, trough), loud, crest ? 1 : 0.5, bangs, crest ? 1300 : 800);
      }
      if ( style === "cycle" ) {
        const unit = plainOf(R.pick(pool("m")) ?? id).split("-"), syl = k.repeat === "pair" && unit.length >= 2 ? unit.slice(-2).join("-") : unit.at(-1);
        const n = 2 + ((i * 7 + R.i(0, 2)) % 3), accent = R.chance(0.3) ? 1 : 0, loud = clamp01(base + (accent ? 0.2 : 0) + 0.08 * wave);
        let m = n, text;
        do { text = Array.from({ length: m }, () => syl).join("-"); m--; } while ( text.length > MAX_LEN - 1 && m >= 1 );
        return seg("body", i, text + end(accent, false), loud, 0.3, accent, 160 * text.split("-").length + 200);
      }
      /* crackle: even segments a quiet bed, odd ones 1-3 pops */
      if ( i % 2 === 0 ) { const t = R.pick(fam); return seg("body", i, capRuns(clean(stretchText(t, 2 + R.i(0, 2), hold, lang))) , clamp01(base - 0.1), 0.8, 0, 700); }
      const pops = Array.from({ length: R.i(1, 3) }, () => R.pick(st).split("-")[0]).join("-"), loud = clamp01(base + R.f(0, 0.3));
      const bangs = loud >= 0.5 ? 1 : 0;
      return seg("body", i, pops + end(bangs, false), loud, 0.1, bangs, 300 + 120 * pops.split("-").length);
    };
    const cache = new Map();
    const at = (i) => {
      if ( cache.has(i) ) return cache.get(i);
      const s0 = body(i), prev = i > 0 ? at(i - 1) : null;
      if ( prev && prev.text === s0.text ) {
        const m = (s0.text.match(/[!?…]*$/) ?? [""])[0], core = s0.text.slice(0, s0.text.length - m.length);
        const alt = capRuns(clean(stretchText(core, 1, hold, lang)));
        /* the same text twice: one sustain letter more, else one less, else the neighbour word of the family */
        const less = core.replace(/(\p{L})\1{2,}/u, (r) => r.slice(1));
        s0.text = (alt !== core ? alt : less !== core ? less : body(i + 1000).text.replace(/[!?…]+$/, "")) + m;
        withAccent(s0);
      }
      cache.set(i, s0); if ( cache.size > 64 ) cache.delete(cache.keys().next().value);
      return s0;
    };
    const w0 = word(id, { lang, seed: `${seed}|onset`, loud: clamp01(base + 0.15), long: 0.3, prefix: false });
    const onset = seg("onset", -1, w0.text, w0.loud, w0.long, w0.bangs, 450);
    const t0 = plainOf(R0(seed).pick(pool("s")) ?? w0.template);
    const tail = seg("tail", -1, capRuns(clean(stretchText(t0, 3, hold, lang))) + "…", clamp01(base * 0.6), 1, 0, 900);
    function take(ms = o.duration ?? 4000) {
      const out = [{ ...onset, t: 0 }]; let t = onset.ms;
      for ( let i = 0; t < ms - tail.ms || i < 1; i++ ) { const s1 = at(i); out.push({ ...s1, t }); t += s1.ms; if ( i > 2000 ) break; }
      out.push({ ...tail, t });
      /* the onset and the tail never repeat their neighbour either */
      for ( const j of [1, out.length - 1] ) if ( out[j] && out[j].text === out[j - 1].text ) {
        const m = (out[j].text.match(/[!?…]*$/) ?? [""])[0], core = out[j].text.slice(0, out[j].text.length - m.length);
        const alt = capRuns(clean(stretchText(core, 1, hold, lang)));
        out[j] = withAccent({ ...out[j], text: (alt !== core ? alt : core.replace(/(\p{L})\1+/u, (r) => r.slice(1))) + m });
      }
      return out;
    }
    return { kind: id, lang, style, onset, tail, at, take };
  }
  const R0 = (seed) => rng(`${seed}|tail`);
  /** grow a caller's own text for the n-th repeat (MOVE): its "+" marks, else its sustain (o.kind's classes, else V R Z S M F H) */
  const grow = (text, step = 1, o = {}) => { const k = o.kind ? kinds[kindOf(o.kind)] : null; return capRuns(clean(expand(String(text).normalize("NFC").toLocaleUpperCase("pl"), Math.max(0, step) * (o.per ?? 1), k?.hold ?? DEFAULT_HOLD, langOf(o.lang, langs())))); };
  /** the accent of any text: o.kind (its envelope and sustain classes), else o.mood (plain text), o.env / o.hold override */
  /** the character of a sound kind (or of a mood, for plain text): what the look should fit */
  const character = (o = {}) => characterOf({ ...o, def: o.kind ? kinds[kindOf(o.kind)] : undefined, kind: o.kind ? kindOf(o.kind) : undefined });
  const accent = (text, o = {}) => { const k = o.kind ? kinds[kindOf(o.kind)] : null; return accentOf(text, { mood: o.mood, lang: o.lang, env: o.env ?? k?.env, hold: o.hold ?? k?.hold }); };
  /** syllables for L.stream({ kind }) */
  const syllables = (kind, o = {}) => word(kind, { ...o, stream: true }).syllables;

  /** add words. lang: "pl" | "en" | a new code. words: an array (spread over the tiers by length: short = quiet) or { s, m, l, st }.
      o.replace: true replaces that kind's words in that language. Unrenderable or too long words are refused (returned in `refused`). */
  function add(lang, kind, words, o = {}) {
    const L = String(lang).toLowerCase();
    let id = alias.get(String(kind).toLowerCase());
    if ( !id ) { define(kind, {}); id = String(kind).toLowerCase(); }
    const B0 = (bank[L] ??= {});
    const cur = o.replace ? { s: [], m: [], l: [] } : JSON.parse(JSON.stringify(B0[id] ?? { s: [], m: [], l: [] }));
    const refused = [];
    const put = (tier, w) => {
      const t = clean(w);
      if ( !renderable(t) || t.replace(/\+/g, "").length > MAX_LEN || naming(t) ) { refused.push(String(w)); return; }
      (cur[tier] ??= []); if ( !cur[tier].includes(t) ) cur[tier].push(t);
    };
    if ( Array.isArray(words) ) {
      const sorted = [...words].sort((a, b) => clean(a).length - clean(b).length);
      sorted.forEach((w, i) => put(sorted.length < 3 ? "m" : (["s", "m", "l"][Math.min(2, Math.floor((3 * i) / sorted.length))]), w));
    } else for ( const t of ["s", "m", "l", "st"] ) for ( const w of words?.[t] ?? [] ) put(t, w);
    B0[id] = cur;
    if ( refused.length ) warn(`refused:${L}:${id}:${refused.join()}`, `refused words for ${L}/${id} (characters the fonts cannot letter, longer than ${MAX_LEN}, or a word that names a sound instead of imitating it): ${refused.join(", ")}`);
    return { kind: id, lang: L, counts: { s: cur.s.length, m: cur.m.length, l: cur.l.length }, refused };
  }
  /** a new sound kind, or change an existing one: { group, label: { pl, en }, mood, sound, motion: { in:[], hold:[], out:[] }, stretch,
      pre: { pl:[], en:[] }, alias: [] }. Missing fields come from the existing kind or from "punch". */
  function define(kind, def = {}) {
    const id = String(kind).toLowerCase().trim();
    const baseK = kinds[id] ?? kinds.punch;
    kinds[id] = { ...JSON.parse(JSON.stringify(baseK)), ...JSON.parse(JSON.stringify(def)), label: { ...(kinds[id] ? baseK.label : { pl: id, en: id }), ...(def.label ?? {}) } };
    if ( !kinds[id].group ) kinds[id].group = "hit";
    reAlias();
    return id;
  }
  function remove(lang, kind, words) {
    const id = alias.get(String(kind).toLowerCase()); const b = bank[String(lang).toLowerCase()]?.[id]; if ( !b ) return 0;
    const drop = new Set([...words].map(clean)); let n = 0;
    for ( const t of Object.keys(b) ) { const before = b[t].length; b[t] = b[t].filter((w) => !drop.has(clean(w)) && !drop.has(clean(w).replace(/\+/g, ""))); n += before - b[t].length; }
    return n;
  }
  /** the kinds for a picker: [{ id, label, group, groupLabel, mood, counts: { pl, en } }] (labels in `lang`) */
  const list = (lang) => {
    const l = langOf(lang, ["pl", "en"]);
    return Object.entries(kinds).map(([id, k]) => ({ id, label: k.label?.[l] ?? k.label?.en ?? id, group: k.group, groupLabel: GROUPS[k.group]?.[l] ?? k.group, mood: k.mood,
      counts: Object.fromEntries(langs().map((L) => [L, ["s", "m", "l"].reduce((s, t) => s + (bank[L]?.[id]?.[t]?.length ?? 0), 0)])) }));
  };
  /** every word of a kind in a language (templates, all tiers): for sheets and pickers */
  const all = (kind, lang) => { const id = kindOf(kind); const b = bank[lang]?.[id] ?? {}; return { s: [...(b.s ?? [])], m: [...(b.m ?? [])], l: [...(b.l ?? [])], st: [...(b.st ?? [])] }; };
  const choices = (lang) => Object.fromEntries(list(lang).map((k) => [k.id, k.label]));
  const reset = () => { Object.keys(kinds).forEach((k) => delete kinds[k]); Object.assign(kinds, JSON.parse(JSON.stringify(KINDS))); Object.keys(bank).forEach((k) => delete bank[k]); Object.assign(bank, JSON.parse(JSON.stringify(BANK))); recent.clear(); reAlias(); };

  return { word, series, flow, grow, syllables, add, define, remove, list, all, choices, reset, kindOf, langs,
    number: formatNumber, range: formatRange, stretch: stretchText, expand, renderable, naming, bangs: bangsFor, accent, character, envs: ENVS, materials: MATERIALS, textures: TEXTURES, groups: GROUPS, classes: CLASSES,
    get kinds() { return Object.keys(kinds); }, get aliases() { return Object.fromEntries(alias); } };
}
