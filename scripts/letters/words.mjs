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
export const RENDERABLE = /^[A-Z0-9ĄĆĘŁŃÓŚŹŻ!?\-+'.,…×–%:/ ]+$/u;
export const MAX_LEN = 22;

/* ---------- sound kinds: what it is, the engine mood, the base sound (loud comes from the call), motion, stretch, prefixes ----------
   group: hit | break | blast | motion | element | power | device | voice.  stretch = how many extra letters a full-loud word gets. */
const K = (group, pl, en, mood, sound, motion, stretch = 2, pre = null, alias = []) => ({ group, label: { pl, en }, mood, sound, motion, stretch, pre, alias });
export const KINDS = {
  /* hits */
  punch:   K("hit", "cios", "punch", "impact", { sharp: 0.8, long: 0.15, pitch: 0, rough: 0.35 }, { in: ["slam", "pop"], hold: ["shake", "boil"], out: ["shatter", "pop"] }, 2, { pl: ["TRA-"], en: ["KA-"] }, ["hit", "blow", "kick", "strike"]),
  smash:   K("hit", "miażdżenie", "smash", "crash", { sharp: 0.9, long: 0.45, pitch: -0.2, rough: 0.75 }, { in: ["slam"], hold: ["rattle", "shake"], out: ["shatter", "burst"] }, 3, { pl: ["TRA-TA-"], en: ["KA-"] }, ["heavy", "slam", "crush"]),
  slap:    K("hit", "klaps", "slap", "impact", { sharp: 0.55, long: 0.2, pitch: 0.1, rough: 0.2 }, { in: ["pop", "slam"], hold: ["shake", "wobble"], out: ["pop"] }, 2),
  thud:    K("hit", "łomot", "thud", "impact", { sharp: 0.3, long: 0.35, pitch: -0.6, rough: 0.5 }, { in: ["drop", "slam"], hold: ["wobble", "rattle"], out: ["fall", "droop"] }, 2, null, ["fall", "down", "body"]),
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
export const KIND_IDS = Object.keys(KINDS);
export const GROUPS = { hit: { pl: "uderzenia", en: "hits" }, break: { pl: "pękanie", en: "breaking" }, blast: { pl: "wybuchy", en: "blasts" },
  motion: { pl: "ruch", en: "motion" }, element: { pl: "żywioły", en: "elements" }, power: { pl: "moce", en: "powers" },
  device: { pl: "urządzenia", en: "devices" }, voice: { pl: "głosy", en: "voices" } };

/* ---------- the word banks: tiers "a|b|c" (s quiet, m normal, l loud); st = stream syllables for repeating sounds ---------- */
const B = (s, m, l, st = null) => ({ s: s.split("|"), m: m.split("|"), l: l.split("|"), ...(st ? { st: st.split("|") } : {}) });
export const BANK = {
  pl: {
    punch:   B("PAC!|PAF!|ŁUP!|BACH!", "ŁU+P!|BA+CH!|TRA+CH!|ŁUP-ŁUP!|BU+CH!", "ŁU+U+P!|BA+A+CH!|TRA+A+CH!|ŁUP-BA+CH!", "ŁUP-BACH-PAC|PAC-PAC-ŁUP"),
    smash:   B("ŁUP!|BUCH!|TRACH!", "ŁUBU+DU!|TRA+CH!|BU+CH!|ŁOMO+T!", "ŁU-BU-DU+!|TRA-TA-TRA+CH!|BU-BU+CH!|TRZA-ŁU+P!"),
    slap:    B("PLASK!|PAC!|KLAP!", "PLA+SK!|PA+C!|CHLA+ST!", "PLA+A+SK!|CHLA+A+ST!|PLASK-PLA+SK!"),
    thud:    B("BĘC!|BUCH!|ŁUP!|PUF!", "BĘ+C!|BU+CH!|ŁUBU+DU!|GRU+CH!", "BĘ+Ę+C!|ŁU-BU-DU+!|GRU+U+CH!|BU+U+M!"),
    stomp:   B("TUP!|BUM!|TUP-TUP", "TU+P!|BU+M!|DU+M!|ŁU+P!", "BU+U+M!|DU+U+M!|ŁU+U+P!|TUP-BU+M!", "TUP-TUP-BUM|BUM-BUM-ŁUP"),
    clang:   B("DZYŃ!|BRZDĘK!|BRZĘK!|DZYNG!", "DZY+Ń!|BRZĘ+K!|BRZDĘ+K!|BRZDĄ+K!|DZY+NG!", "DZY+Y+Ń!|BRZDĘ+Ę+K!|BRZĘK-DZY+Ń!|DZY-DZY+NG!"),
    slash:   B("CIACH!|CHLAST!|SZAST!", "CIA+CH!|CHLA+ST!|ŚWI+ST!|SZAST-PRA+ST!", "CIA-CIA+CH!|CHLA+A+ST!|SZRRRA+K!|CIACH-CHLA+ST!"),
    bite:    B("CHRUP!|KŁAP!|HAM!|MLASK!", "CHRU+P!|KŁA+P!|CHRUP-CHRUP!|MLA+SK!", "CHRU+U+P!|KŁAP-KŁA+P!|CHRUP-CHRU+P!|HAM-HA+M!"),
    crack:   B("KRAK!|TRZASK!|PRASK!|TRACH!", "KRA+K!|TRZA+SK!|PRA+SK!|TRA+CH!|CHRZĘ+ST!", "TRZA-TRZA+SK!|KRRRA-KA+K!|PRA-TRA+CH!|KRA-KA-TA+K!"),
    shatter: B("BRZDĘK!|DZYŃ!|BRZĘK!", "BRZDĘ+K!|BRZĘ+K!|DZYŃ-DZY+Ń!|TRZA+SK!", "BRZDĘ+Ę+K!|TRZASK-BRZDĘ+K!|DZY-DZY-DZY+Ń!|BRZĘ-BRZDĘ+K!", "DZYŃ-BRZDĘK-DZYŃ"),
    crash:   B("ŁUP!|GRUCH!|ŁOMOT!|CHRUP!", "ŁUBU+DU!|ŁOMO+T!|GRU+CH!|TRZA+SK!", "ŁU-BU-DU+!|ŁUBUDU-BU+M!|GRU-GRU+CH!|TRA-TA-ŁU+P!", "ŁU-BU-DU|GRUCH-ŁUP-BĘC"),
    crumble: B("KRRR|CHRZĘST|CHRUP", "KRRR+R|CHRZĘ+ST|CHRUP-CHRZĘST|SZUR+R", "KRRRR+R+R|CHRZĘ+Ę+ST|KRRR-CHRZĘ+ST", "KRR-CHRZ-KRR"),
    rumble:  B("DUDU|GRRM|BRRUM", "DUDUDU+U|GRRRU+M|BRRRU+M", "DUDUDUDU+U|GRRRRU+U+M|BRRRRU+U+M|ŁUBUDUDU+U", "DU-DU-DU|BRR-DU-DU"),
    creak:   B("SKRZYP|KRRK|TRZESZCZ", "SKRZY+P|TRZE+SZCZ|SKRZYP-SKRZY+P", "SKRZY+Y+P|TRZE+E+SZCZ|SKRRRZY+Y+P"),
    scrape:  B("SZUR|ZGRZYT|SZURR", "SZU+RR|ZGRZY+T|SZUR-SZU+R", "SZU+U+RRR|ZGRZY+Y+T|ZGRRRZY+Y+T", "SZUR-ZGRZYT|ZGRZ-ZGRZ-ZGRZYT"),
    boom:    B("BUM!|BACH!|BUCH!|PAF!", "BU+M!|KABU+M!|BU+CH!|TRA+CH!", "KA-BU+U+M!|KA-BU-BU+M!|TRA-TA-BU+M!|BU+U+U+M!", "BUM-BUM-BACH|BACH-BUM-BUM"),
    whump:   B("BUF|HUF|PUF", "BU+F|HU+F|PU+FF", "BU+U+F!|HU+U+F!|WU+U+MF!"),
    thunder: B("TRACH!|BRRUM!|BUM!", "TRA+CH!|BRRRU+M!|TRZA+SK!|ŁU-BU-DU!", "TRA-TA-TRA+CH!|KRA-BU+U+M!|BRRRU-BU-BU+M!|TRZA-BU+U+M!", "BRR-DU-DU-BUM"),
    zap:     B("BZYK!|BZZT!|ZZYT!", "BZZZ+T!|BZY+K!|TRZA+SK!|ZZZY+T!", "BZZZZ+Z+T!|TRZA-BZZZ+T!|BZY-BZY+K!|KRZZZ+ZT!", "BZT-BZT-BZZT|TRZ-BZT-TRZ"),
    beam:    B("PIU!|ZIU!|WZIU!|FIU!", "WZIU+U!|ZIU+UT!|PIU+U!|BZYY+M!", "WZIU+U+UM!|BZZZIU+U+M!|ZIU+U+UT!|WZZZYY+Y+M!", "PIU-PIU-PIU|ZIU-ZIU"),
    gunshot: B("PAF!|PIF!|PIF-PAF!|HUK!", "PA+F!|BA+CH!|PIF-PA+F!|HU+K!", "BA+A+CH!|PA+A+F!|BUCH-BA+CH!|HU+U+K!", "PAF-PAF-PAF|PIF-PAF-PIF"),
    gunfire: B("TA-TA!|PAF-PAF!|RA-TA!", "TRA-TA-TA!|RA-TA-TA!|TA-TA-TA-TA!", "TRA-TA-TA-TA-TA!|RA-TA-TA-TA-TA!|TRRR+A-TA-TA-TA!|BRRRR+T!", "TRA-TA-TA-TA|RA-TA-TA-TA|TA-TA-TA-TA-TA"),
    ricochet:B("PIU!|DZIU!|ZIU!", "PIU+U!|DZIU+Ń!|ZIU+UM!", "PIU+U+UŃ!|DZIU+U+Ń!|PTIU+U+U!"),
    whoosh:  B("ŚWIST!|FIU!|SZU!|WSZ!", "ŚWI+ST!|FIU+U!|SZU+U!|WSZU+U!", "ŚWI+I+ST!|FIU+U+U!|WSZU+U+U!|SZSZU+U+UM!"),
    zoom:    B("WZIU!|ZIUT!|FRR!", "WZIU+UM!|ZIU+T!|FRU+U!|WRRRU+M!", "WZIU+U+U+M!|WRRRU+U+M!|ZZZIU+U+T!|FRRRU+U+U!"),
    bounce:  B("HOP!|HYC!|BOING!|BOINK!", "HO+P!|BOI+NG!|HYC-HYC!|HOP-SA+A!", "BOI+I+NG!|HO+O+P!|HOP-SA+A+A!|BO-BOI+NG!"),
    teleport:B("PUF!|PYK!|SZUP!|WIUP!", "PU+F!|WIU+P!|SZU+P!|FRRT!", "PU+U+F!|WIU+U+P!|SZZZU+U+P!|PYK-PU+U+F!"),
    wind:    B("SZSZ|FIU|UUU", "SZU+U|WIU+U|HU+U|FIU+U", "SZSZU+U+U|WIU+U+U|HUU+U+U|ŁUU+U+U", "SZU-SZU-SZU|WIU-WIU"),
    fire:    B("BUCH!|FFF!|PUF!|FRR!", "BU+CH!|FRU+M!|FFFU+M!|BUCH-FRR!", "BU+U+CH!|FRRRU+U+M!|BU-BU+CH!|FFFRRU+U+M!", "FRR-BUCH-FRR"),
    crackle: B("TRZASK|TRZESZCZ|PSTRYK|TRZ-TRZ", "TRZA+SK|TRZE+SZCZ|TRZ-TRZ-TRZ|PSTRY+K", "TRZA-TRZA+SK|TRZE+E+SZCZ|TRZ-TRZ-TRZA+SK", "TRZ-TRZ-TRZASK|TRZESZCZ-TRZ|PSTRYK-TRZ-TRZ"),
    hiss:    B("SYK|PSST|SSS|TSS", "SSSY+K|PSSS+T|SYYY+K|SSSS+S", "SSSSY+Y+K|PSSSS+S+T|SSSSS+S+S"),
    splash:  B("PLUM!|PLUSK!|CHLUP!|CHLAP!", "PLU+SK!|CHLU+P!|CHLA+P!|PLU+M!", "PLU+U+SK!|CHLU-CHLU+P!|CHLA+A+ST!|KA-PLU+U+SK!"),
    squish:  B("CIAP!|CHLAP!|PLAF!|MLASK!", "CIA+P!|CHLA+P!|MLA+SK!|CHLUP-CIAP!", "CIA+A+P!|CHLA+A+P!|MLA+A+SK!|CIAP-CHLA+P!"),
    drip:    B("KAP|KAP-KAP|PLIM", "KAP-KAP-KAP|PLI+M|KA+P", "KA+A+P!|PLIM-PLI+M!|KAP-KAP-PLU+M!", "KAP-KAP-KAP|PLIM-KAP"),
    powerup: B("WUM|BZYM|HMM", "WU+UM|WZZZU+M|HMMM+M|BZYYY+M", "WU+U+UM!|WZZZU+U+UM!|WRRRU+U+M!|HAAA+A+A!", "WUM-WUM-WUM|BZY-BZY-BZYM"),
    psychic: B("MMM|WIII|HMMM", "MMMM+M|WIII+I|IIII+Ń|WMMM+M", "MMMMM+M+M|WIIII+I+IŃ|IIIII+I+IŃ"),
    chime:   B("DZYŃ|DING|BIM|PLING", "DZY+Ń|DI+NG|BIM-BAM|DZYŃ-DZYŃ", "DZY+Y+Ń!|DI-DI+NG!|BIM-BAM-BO+M|DZYŃ-DZY+Y+Ń!"),
    fizzle:  B("PFF|PSST|FSS|PYK", "PFFF+F|PSSS+T|SSSY+K|PYK-PFF", "PFFFF+F+F|PSSSS+S+T|PFF-PSSS+T"),
    whiff:   B("FIU|ŚWIST|FFF|ŚMIG", "FIU+U|ŚWI+ST|FFFU+U|ŚMI+G", "FIU+U+U|ŚWI+I+ST|FFFU+U+U"),
    click:   B("KLIK|PSTRYK|PYK|TIK", "KLIK-KLIK|PSTRY+K|CYK-CYK|TRYK", "KLI+I+K!|PSTRY+Y+K!|KLIK-KLA+K!", "TIK-TAK|KLIK-KLIK"),
    beep:    B("PIP|PIK|BIP", "PI+P|PIK-PIK|BI+P", "PI+I+P!|PIK-PIK-PI+K!|BI-BI+I+P!", "PIK-PIK-PIK|PIP-PIP"),
    engine:  B("WRR|BRUM|WRUM", "WRRRU+M|BRRRU+M|WRRRR+R|BRUM-BRUM", "WRRRRU+U+M!|BRRRRU+U+M!|WRRRR+R+R!", "WRR-WRR-WRUM|BRUM-BRUM"),
    siren:   B("IJO-IJO|UIU-UIU", "IJO-IJO-IJO|UIU-UIU-UIU|IIII+UUU", "IJO-IJO-IJO-IJO!|UIU-UIU-UIU-UIU!|IIIII+UUUU!", "IJO-IJO|UIU-UIU"),
    roar:    B("GRR!|WRR!|RAA!", "GRRR+R!|WRRRA+A!|RAA+A!|GRAA+U!", "GRRRRA+A+U!|WRRRRA+A+A!|RRRAAA+A+U!|GRAAA+A+H!"),
    pain:    B("AU!|AŁA!|AUĆ!|AJ!", "AAA+A!|AU+U!|AŁA+A!|UGH!", "AAAA+A+A!|AAARGH!|AUU+U+U!|AAA+A+UĆ!"),
    effort:  B("UFF!|HYP!|NGH!|HYY!", "HYYY+Y!|NNGH!|UGHH!|HMMPF!", "HYYYY+Y+Y!|NNNGHH+H!|AAA+A+GH!|HRRRAAA+A!"),
    relief:  B("UFF|UF|ACH", "UFF+F|AAA+CH|HAA+A|OCH", "UFFF+F+F|AAAA+A+CH|HAAA+A+A"),
    sigh:    B("EH…|OCH…|UCH…", "EEE+H…|OCH…|UUU+CH…|HAA+A…", "EEEE+E+H…|OOO+O+CH…|UUUU+U+CH…"),
    cheer:   B("HA!|HEJ!|JEST!|TAK!", "HURA!|HU+RA!|JE+ST!|HA-HA!", "HU+U+RA+A!|JEEE+E+ST!|HURA-HU+RA!"),
    laugh:   B("HA!|HI-HI|CHA!", "HA-HA!|CHA-CHA!|HI-HI-HI|HE-HE!", "HA-HA-HA-HA!|BUA-HA-HA!|CHA-CHA-CHA!|MUA-HA-HA!", "HA-HA-HA|CHA-CHA-CHA"),
    shush:   B("CIII!|SZSZ!|PSST!", "CII+I!|SZSZSZ!|PSSS+T!", "CIIII+I+I!|SZSZSZSZ!|PSSSS+S+T!"),
    heartbeat:B("PUK|TUK|BUM", "TUK-TUK|BU-BUM|PUK-PUK", "BU-BUM! BU-BUM!|TUK-TUK-TUK-TUK!|BUM-BUM-BUM!", "BU-BUM|TUK-TUK")
  },
  en: {
    punch:   B("POW!|BAM!|WHAP!|SOCK!|BIFF!", "WHA+M!|PO+W!|THWA+CK!|SMA+CK!|KA-PO+W!", "KA-PO+O+W!|WHA+A+M!|THWA+A+CK!|KA-WHA+M!", "POW-BAM-WHAP|BIFF-SOCK-POW"),
    smash:   B("WHAM!|BLAM!|KRUNCH!", "KRAKO+OM!|WHA+MM!|SKRA+KK!|KA-BLA+M!", "KA-KRAKO+O+OM!|KA-WHA+A+M!|KRA-KA-BLA+M!|SKRA-KA-THO+O+M!"),
    slap:    B("SLAP!|SMACK!|THWAP!", "SLA+P!|SMA+CK!|THWA+P!", "SLA+A+P!|SMA+A+CK!|KA-SLA+P!"),
    thud:    B("THUD!|THUMP!|FLUMP!|BONK!", "THU+D!|THU+MP!|WHU+MP!|KLU+NK!", "THU+U+D!|KA-THU+MP!|WHU+U+MP!|KA-THO+O+M!"),
    stomp:   B("STOMP!|THMP!|TROMP!", "STO+MP!|THO+OM!|KRO+MP!", "STO+O+MP!|THO+O+OM!|KA-STO+MP!", "STOMP-STOMP|THOOM-THOOM"),
    clang:   B("CLANG!|TINK!|KLANG!|CLINK!", "CLA+NG!|KLA+NG!|SPA+NG!|KLO+NG!", "CLA+A+NG!|KA-KLA+NG!|SPA+A+NNG!|KLA-DA+NG!"),
    slash:   B("SHINK!|SLASH!|SWIK!", "SHI+NG!|SLA+SH!|SKRI+TCH!|SHRA+K!", "SHI+I+NG!|SLA+A+SH!|SHRA-KA+K!|KA-SHI+NG!"),
    bite:    B("CHOMP!|CRUNCH!|SNAP!", "CHO+MP!|CRU+NCH!|GNA+SH!", "CHO+O+MP!|CRU+U+NCH!|CHOMP-CHO+MP!"),
    crack:   B("KRAK!|SNAP!|CRACK!|KRIK!", "KRA+K!|SNA+P!|CRA+CK!|SKRA+K!", "KRRRA-KA+K!|KA-KRA+CK!|SKRA-KA+K!|CRA-CRA+CK!"),
    shatter: B("TINKLE|KSSH!|CRSSH!|SMASH!", "KRSSH+H!|SMA+SH!|KISSHH+H!|TINKA-TINK!", "KRSSHH+H+H!|KA-SMA+A+SH!|KRA-KSSHH+H!", "TINK-KSSH-TINK"),
    crash:   B("CRASH!|CRUNCH!|KLUNK!", "CRA+SH!|KRA+SH!|CRU+NCH!|KA-RA+SH!", "KRA-KA-THO+O+M!|KA-RA+A+SH!|CRA-CRA+A+SH!|KRAKATA+K!", "KRASH-KLUNK-THUD"),
    crumble: B("KRRK|CRMBL|SKRNCH", "KRRRMBL|CRU+MBLE|SKRRRNCH", "KRRRRRMBL|CRU+U+MBLE|SKRRRRRNCH", "KRK-CRMBL-KRK"),
    rumble:  B("RMBL|GRMM|DRRM", "RU+MBLE|RRRU+MBL|GRRRO+MM", "RU+U+MBLE|RRRU+U+MBLE|GRRRRO+O+MM", "RM-BL-RMBL|DRM-DRM-DRM"),
    creak:   B("CREAK|KREEK|SKREK", "CREA+K|KREE+K|SKREE+K", "CREA+A+K|KREE+E+K|SKREEE+E+K"),
    scrape:  B("SKRT|SCRAPE|SKREE", "SKRRR+T|SCRA+PE|SKREE+E", "SKRRRR+R+T|SCRA+A+PE|SKREE+E+E", "SKRT-SKRT-SKREE"),
    boom:    B("BOOM!|BAM!|BLAM!|FOOM!", "BO+OM!|KABO+OM!|BLA+M!|KA-BLA+M!", "KA-BO+O+OM!|KRA-KABO+OM!|KA-BLA+A+M!|BA-DO+O+OM!", "BOOM-BOOM-BLAM|BLAM-BOOM"),
    whump:   B("FWUMP|WHUMP|PHUF", "WHU+MP|FWU+MP|WHOO+MPH", "WHU+U+MP!|FWOO+O+MPH!|KA-WHU+MP!"),
    thunder: B("KRAK!|BRRM!|BOOM!", "KRA-KO+OM!|BRRRO+OM!|KRA-KA-BOOM!", "KRA-KA-BO+O+OM!|KRA-KA-THO+O+OM!|BRRRA-KO+O+OM!", "BRR-RUM-BLE-BOOM"),
    zap:     B("ZAP!|BZZT!|ZZT!|KZZT!", "ZZA+P!|BZZZ+T!|KRZZ+T!|ZZA+KK!", "KA-ZZA+A+P!|BZZZZZ+Z+T!|ZZZA-KRA+K!|KRZZZ-ZA+P!", "BZT-BZT-BZZT|ZAK-ZAK-ZAP"),
    beam:    B("ZAP!|PEW!|ZWIP!|VZT!", "VWO+OM!|ZZZA+P!|PE+EW!|VRRZZ+T!", "VWO+O+OM!|SKRA-ZZZ+ZT!|KA-VWO+O+OM!|VRZZZZ+Z+T!", "PEW-PEW-PEW|ZAP-ZAP"),
    gunshot: B("BANG!|BLAM!|POP!|PAK!", "BLA+M!|BA+NG!|KRA+K!|BLAM-BLAM!", "BLA+A+M!|KA-BLA+M!|BA+A+NG!|KA-BA+NG!", "BLAM-BLAM-BLAM|BANG-BANG"),
    gunfire: B("RAT-TAT!|BRAP!|BLAM-BLAM!", "RAT-A-TAT!|BRRRA+P!|BLAM-BLAM-BLAM!", "RAT-A-TAT-A-TAT!|BRRRRR+AT!|BUDDA-BUDDA-BUDDA!", "RAT-TAT-TAT-TAT|BRAT-AT-AT-AT|BUDDA-BUDDA-BUDDA"),
    ricochet:B("PTANG!|PING!|TWANG!", "PTE+EW!|PTI+NG!|ZI+NG!", "PTEE+E+EWW!|PTI+I+NG!|KA-ZI+I+NG!"),
    whoosh:  B("WHOOSH|SWISH|FWIP|WHIP", "WHOO+SH|SWI+SH|FWOO+SH|SHWOO+M", "WHOOO+O+SH|SWIII+I+SH|FWOOO+O+SH|SHWOOO+O+M"),
    zoom:    B("ZOOM!|ZIP!|VROOM!", "ZOO+M!|VROO+M!|ZWOO+SH!|NYEE+EW!", "ZOOO+O+M!|VROOO+O+M!|NYEEE+E+OWW!|KA-ZOO+O+M!"),
    bounce:  B("BOING!|BOINK!|HUP!|SPROING!", "BOI+NG!|SPROI+NG!|BOING-OING!|HU+P!", "BOI+I+I+NG!|SPROI+I+NG!|KA-BOI+I+NG!"),
    teleport:B("POP!|VWIP!|FZOOP!|BLIP!", "VWO+P!|FZOO+P!|SHWU+P!|BLI+P!", "VWOOO+O+P!|FZZZOO+O+P!|KA-VWO+O+P!|SHWUU+U+P!"),
    wind:    B("WHOO|FWSH|SHHH", "WHOO+OO|WHEE+EW|FWOO+SH|HOO+OM", "WHOOO+O+OO|WHEEE+E+EW|HOOO+O+OWL|FWOOO+O+SH", "WHOO-WHOO|SHH-WHOO"),
    fire:    B("FOOF!|FWIP!|FUMP!|FWOOSH!", "FWOO+SH!|FOO+M!|WHOO+MF!|FWU+MP!", "FWOOO+O+SH!|FOOO+O+M!|KA-FWOO+SH!|WHOOO+O+MPF!", "FWUMP-FOOF-FWIP"),
    crackle: B("KRSSH|CRACKLE|SNAP-SNAP|KRK-KRK", "KRSSH+H|CRA+CKLE|SNAP-CRACKLE|KRK-KRK-KRK", "KRSSHH+H+H|CRA+A+CKLE|SNAP-KRK-KRSSH", "KRK-KRK-SNAP|SNAP-CRACKLE-POP|KRSSH-KRK"),
    hiss:    B("HISS|TSS|PSST|FSST", "HISSS+S|TSSS+S|PSSSS+T|FSSS+HH", "HISSSS+S+S|TSSSS+S+S|PSSSSS+S+SHH"),
    splash:  B("SPLASH!|SPLOSH!|SPLAT!|PLOP!", "SPLA+SH!|SPLOO+SH!|SPLOO+T!|SPLO+P!", "SPLA+A+SH!|KA-SPLOO+SH!|SPLOO+O+RSH!|SPLA-SPLA+SH!"),
    squish:  B("SPLUT!|SQUISH!|SPLORT!|GLORP!", "SQUI+SH!|SQUE+LCH!|SPLU+T!|GLO+RP!", "SQUI+I+SH!|SQUE+E+LCH!|SPLO+O+RT!|KA-SQUE+LCH!"),
    drip:    B("DRIP|PLIP|PLINK", "DRIP-DRIP|PLI+P|DRI+P", "DRIP-DRIP-DRIP|PLI+I+P|DRI+I+P-PLOP", "DRIP-DRIP-DRIP|PLIP-PLINK"),
    powerup: B("VMM|HMMM|VWUM", "VWU+M|VRRRMM|HUMMM+M|SHWA+M", "VWOO+O+OM!|VRRRRMM+M+M!|SHWAA+A+M!|KA-VWO+O+OM!", "VWUM-VWUM-VWUM|HMM-HMM-VMMM"),
    psychic: B("MMM|VRMM|EEEE", "MMMM+M|VREEE+E|WHUMMM+M|EEEEE+E", "MMMMM+M+M|VREEEE+E+E|WHUMMMM+M+M"),
    chime:   B("TING|DING|PLING|TINK", "TI+NG|DI+NG|SHI+NG|TING-A-LING", "TI+I+NG!|DI+I+NG!|SHI+I+NG!|KA-SHI+NG!"),
    fizzle:  B("FZZT|PFFT|FIZZ|PSST", "FZZZ+T|PFFF+T|FIZZZ+Z|SPUT-SPUT", "FZZZZ+Z+T|PFFFF+F+T|FIZZZZ+Z+LE|SPUT-SPUT-PFFT"),
    whiff:   B("WHIFF|FWIP|SWISH|FFT", "WHI+FF|FWI+P|SWI+SH|FFFT", "WHI+I+FF|FWI+I+P|SWI+I+SH"),
    click:   B("CLICK|KLIK|TIK|SNIK", "CLICK-CLACK|KLI+CK|TIK-TAK|KA-CHUNK", "KA-CHI+I+NK!|CLICK-CLA+A+CK!|KA-CHU+NK!", "TIK-TOK|CLICK-CLICK"),
    beep:    B("BEEP|BLIP|BIP", "BEE+P|BEEP-BEEP|BLIP-BLIP", "BEEE+E+P!|BEEP-BEEP-BEE+P!|BWEE+E+P!", "BEEP-BEEP-BEEP|BLIP-BLIP"),
    engine:  B("VRM|VROOM|BRAP", "VRRRO+OM|BRRRA+P|NYEE+OW|VROOM-VROOM", "VRRRRO+O+OM!|BRRRRA+A+P!|NYEEE+E+OWW!", "VRM-VRM-VROOM|BRAP-BRAP"),
    siren:   B("WEE-OO|WOO-WOO", "WEE-OO-WEE-OO|WEEE+OOO|WOO-WOO-WOO", "WEE-OO-WEE-OO!|WEEE+E+OOOO!|WOOO+O+OOO!", "WEE-OO|WOO-WOO"),
    roar:    B("GRR!|RAWR!|GROWL", "GRRR+R!|ROA+R!|RAA+WR!|GRAA+H!", "GRRRRRA+A+H!|ROOO+A+AR!|RAAAA+A+WR!|RRROAA+A+R!"),
    pain:    B("OW!|OUCH!|OOF!|UNGH!", "ARGH!|AA+AH!|OWW+W!|UNGHH!", "AAAA+A+AH!|AAARGH+H!|AIEE+E+E!|NNGAAA+A+AH!"),
    effort:  B("HUP!|NGH!|HUFF!|HMPF!", "HNNG+G!|HRRR+NGH!|UNNGH+H!|HUFF-HUFF!", "HNNNNG+G+G!|HRRRAA+A+AH!|GRRRAA+A+AH!|NNNGAA+A+AH!"),
    relief:  B("PHEW|AAH|HAH", "PHE+W|AAA+AH|HAAA+A|WHEW", "PHEE+E+EW|AAAA+A+AH|HAAAA+A+AH"),
    sigh:    B("SIGH…|UGH…|OOF…|MEH…", "HAA+AH…|UU+UGH…|OO+OF…|PFFF+F…", "HAAAA+A+AH…|UUUU+U+UGH…|HAAA+A+AAH…"),
    cheer:   B("HA!|YES!|HUH!|WOO!", "YE+S!|WOO+OO!|HOO-HA!|YEAH!", "YEEE+E+S!|WOOO+O+OO!|YEE-HA+A+AH!|HOO-RA+A+AH!"),
    laugh:   B("HA!|HEH|HEE", "HA-HA!|HEH-HEH|HEE-HEE|HO-HO!", "HA-HA-HA-HA!|BWA-HA-HA!|MWA-HA-HA!|HAW-HAW-HAW!", "HA-HA-HA|HO-HO-HO"),
    shush:   B("SHH!|SHUSH!|PSST!", "SHHH+H!|SSHH+H!|PSSS+T!", "SHHHH+H+H!|SSSHHH+H+H!|PSSSS+S+T!"),
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
/** is every character of the word lettered by every font? (beyond this pure set, check.mjs proves it per font) */
export const renderable = (t) => { const w = clean(t).replace(/\+/g, ""); return w.length > 0 && w.length <= MAX_LEN + 8 && RENDERABLE.test(w); };

/** stretch a template: every "+" repeats the letter before it; `extra` extra letters are shared by all marks (BO+O+M, 3 -> BOOOOOM) */
export function expand(tpl, extra) {
  const marks = (tpl.match(/\+/g) ?? []).length;
  const total = Math.max(0, Math.min(MAX_EXTRA, Math.round(extra)));
  if ( !marks ) return total > 0 ? stretchText(tpl, total) : tpl;
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
  return spill > 0 ? stretchText(out, spill) : out;
}
/** stretch any word (also a caller's plain text) by `extra` letters, one letter at a time onto the shortest stretchable run: the
    vowels of the last syllable first, then its R/S/Z/H/M/F/N/W runs (BZZT -> BZZZZT, KRIK -> KRRIIIIK), then earlier syllables'
    vowels; no run longer than MAX_RUN. Digits and words without a stretchable letter come back unchanged. */
export function stretchText(text, extra) {
  let n = Math.max(0, Math.min(MAX_EXTRA, Math.round(extra)));
  const t = String(text ?? "");
  if ( !n || /\d/.test(t) ) return t;
  /* runs of the LAST syllable only (a prefix KA- or an earlier TRA- never stretches): [{ ch, len, prio }]; prio 0 = vowel,
     1 = a hummable consonant (R S Z H M F N W). The vowel run takes the stretch up to MAX_RUN, then the consonants up to SPILL_RUN. */
  const runs = [];
  for ( const c of t ) { const r = runs.at(-1); if ( r && r.ch === c ) r.len++; else runs.push({ ch: c, len: 1 }); }
  let lastSyl = 0; runs.forEach((r, i) => { if ( r.ch === "-" || r.ch === " " ) lastSyl = i + 1; });
  runs.forEach((r, i) => { r.prio = i < lastSyl ? 9 : VOW.includes(r.ch) ? 0 : ("RSZHMFNW".includes(r.ch) ? 1 : 9); });
  const cand = runs.map((r, i) => [r, i]).filter(([r]) => r.prio < 9);
  if ( !cand.length ) return t;
  /* a vowelless word (BZZT, PSST) stretches its consonants up to MAX_RUN like a vowel */
  const vowelless = !cand.some(([r]) => r.prio === 0);
  cand.sort((a, b) => a[0].prio - b[0].prio || b[1] - a[1]);
  for ( const [r] of cand ) { const cap = r.prio === 0 || vowelless ? MAX_RUN : SPILL_RUN; const add = Math.min(n, Math.max(0, cap - r.len)); r.len += add; n -= add; if ( !n ) break; }
  return runs.map((r) => r.ch.repeat(r.len)).join("");
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
  const pickMotion = (k, R) => ({ in: R.pick(k.motion.in), holdKind: R.pick(k.motion.hold), out: R.pick(k.motion.out) });

  /** One word. o: { lang, loud | magnitude, seed, step (n-th repeat of the same sound: louder, longer), avoid (texts or templates
      to skip), template (pin a template: the same word, only its stretch follows the loudness), prefix (true / false / a string),
      stream (true: syllables for L.stream) }. -> { text, kind, lang, tier, loud, template, syllables?, mood, sound, motion, play } */
  function word(kind, o = {}) {
    const id = kindOf(kind), k = kinds[id], lang = langOf(o.lang, langs());
    const step = Math.max(0, Number.isFinite(o.step) ? Math.floor(o.step) : 0);
    const base = loudOf(o), loudEff = base + 0.15 * step, loud = clamp01(loudEff);
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
    /* stretch: none when quiet, up to the kind's stretch at full loudness; repeats past full loudness keep growing (MOVE's escalation) */
    const extra = k.stretch * Math.max(0, loud - 0.3) / 0.7 + Math.max(0, loudEff - 1) * 2 + (Number.isFinite(o.stretchAdd) ? o.stretchAdd : 0);
    let text = capRuns(clean(expand(tpl, o.stream ? 0 : extra)));
    /* prefix at the very top (a seeded coin), or when asked */
    const pres = k.pre?.[usedLang] ?? [];
    const wantPre = o.prefix === false ? false : (typeof o.prefix === "string" ? o.prefix : (o.prefix === true || (loudEff >= 0.92 && R.chance(0.5))) && pres.length ? R.pick(pres) : false);
    if ( wantPre && !o.stream && !text.includes("-") ) text = clean(wantPre) + text;
    if ( !o.stream ) {
      if ( loud < 0.2 ) text = text.replace(/!+$/, "");
      else if ( loud >= 0.9 && !/[!?…]$/.test(text) ) text += "!";
    }
    if ( !seeded ) { const r = recent.get(mem) ?? []; r.push(clean(tpl), text); while ( r.length > 4 ) r.shift(); recent.set(mem, r); }
    const sound = { ...k.sound, loud: Math.max(0.1, Math.min(1, 0.15 + 0.85 * loud)) };
    const motion = pickMotion(k, R);
    const out = { text, kind: id, lang: usedLang, tier: usedTier, loud, step, template: tpl, prefix: wantPre && !o.stream && !text.startsWith(clean(expand(tpl, 0)).slice(0, 1)) ? wantPre : null, mood: k.mood, sound, motion,
      play: { mood: k.mood, sound, in: motion.in, holdKind: motion.holdKind, out: motion.out, magnitude: Math.round(Math.max(0, (loud - 0.1) / 0.6) * 100) / 100 } };
    if ( o.stream ) out.syllables = text.split(/[-\s]+/).filter(Boolean);
    return out;
  }

  /** n words of one sound for a series or an escalation. o.grow: "stretch" (default: one template, each step louder and longer, a
      prefix from step 2 when the kind has one) or "vary" (a different word each step, rising tiers). Never the same text twice in a row. */
  function series(kind, n, o = {}) {
    const out = [];
    const first = word(kind, { ...o, step: 0 });
    out.push(first);
    const k = kinds[first.kind];
    for ( let i = 1; i < Math.max(1, n); i++ ) {
      const prev = out[i - 1];
      /* a repeating sound (gunfire, laughter, a siren) grows by one more syllable, not by longer letters: RA-TA -> RA-TA-TA */
      if ( k.repeat && o.grow !== "vary" && !/\s/.test(prev.text) ) {
        const end = (prev.text.match(/[!?…]*$/) ?? [""])[0], body = prev.text.slice(0, prev.text.length - end.length);
        const syls = clean(expand(first.template, 0)).replace(/[!?…]+$/, "").split("-");
        const syl = syls.length === 1 ? syls[0] : k.repeat === "pair" && syls.at(-1) !== syls.at(-2) ? syls.slice(-2).join("-") : syls.at(-1);
        const next = `${body}-${syl}${end || (i >= 2 ? "!" : "")}`;
        if ( next.replace(/[!?…]/g, "").length <= MAX_LEN ) { out.push({ ...word(kind, { ...o, step: i, template: first.template }), text: next, prefix: null }); continue; }
      }
      const w = o.grow === "vary"
        ? word(kind, { ...o, seed: o.seed != null ? `${o.seed}:${i}` : undefined, step: i, avoid: [...(o.avoid ?? []), prev.template, prev.text] })
        : word(kind, { ...o, step: i, template: first.template, stretchAdd: i, prefix: o.prefix ?? (prev.prefix || (i >= 2 ? true : false)) });
      /* stretch mode never shrinks; when the letters are all at their longest the word gains a "!" (at most three) */
      if ( o.grow !== "vary" && (w.text === prev.text || w.text.length < prev.text.length) ) {
        const more = capRuns(clean(stretchText(prev.text, 1)));
        w.text = more !== prev.text ? more : (/!{3}$/.test(prev.text) ? prev.text : prev.text.replace(/[!?…]*$/, (m) => (m.startsWith("!") ? m : "") + "!"));
        w.prefix = prev.prefix;
      } else if ( w.text === prev.text ) w.text = capRuns(clean(stretchText(w.text, 1)));
      out.push(w);
    }
    return out;
  }
  /** grow a caller's own text for the n-th repeat (MOVE): stretch marks or the last vowel, louder each step */
  const grow = (text, step = 1, o = {}) => capRuns(clean(expand(String(text).normalize("NFC").toLocaleUpperCase("pl"), Math.max(0, step) * (o.per ?? 1))));
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
      if ( !renderable(t) || t.replace(/\+/g, "").length > MAX_LEN ) { refused.push(String(w)); return; }
      (cur[tier] ??= []); if ( !cur[tier].includes(t) ) cur[tier].push(t);
    };
    if ( Array.isArray(words) ) {
      const sorted = [...words].sort((a, b) => clean(a).length - clean(b).length);
      sorted.forEach((w, i) => put(sorted.length < 3 ? "m" : (["s", "m", "l"][Math.min(2, Math.floor((3 * i) / sorted.length))]), w));
    } else for ( const t of ["s", "m", "l", "st"] ) for ( const w of words?.[t] ?? [] ) put(t, w);
    B0[id] = cur;
    if ( refused.length ) warn(`refused:${L}:${id}:${refused.join()}`, `refused words for ${L}/${id} (characters the fonts cannot letter, or longer than ${MAX_LEN}): ${refused.join(", ")}`);
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

  return { word, series, grow, syllables, add, define, remove, list, all, choices, reset, kindOf, langs,
    number: formatNumber, range: formatRange, stretch: stretchText, expand, renderable, groups: GROUPS,
    get kinds() { return Object.keys(kinds); }, get aliases() { return Object.fromEntries(alias); } };
}
