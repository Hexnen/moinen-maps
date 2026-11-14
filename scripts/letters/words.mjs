/* LETR vocabulary (WORD): from a sound kind, a loudness and a language to a fitting comic onomatopoeia. Pure: no DOM, no Foundry.
   The engine letters any text it is handed; this layer only DECIDES the text (and the mood / sound / motion that fit it):
     const w = L.word("crack", { loud: 0.8, lang: "pl", seed });     // -> { text: "KRAKT!", mood: "crack", sound, play, ... }
     L.play(w.text, { ...w.play, space: "world", at });              // or simply: L.sfx("crack", { loud: 0.8, space: "world", at })
   Plain text keeps working exactly as before: L.play("KRAK!", ...) never goes through this file.

   Words: our own, BUILT from the sound (attack + lasting part + cut-off), never a dictionary word nor one letter from one (DICT and
   refusal() below; the short ICONIC list is the exception, ALLOW the comic's K-respellings, VOICE the voice kinds' interjections).
   ENGLISH IS THE MASTER (THWAK, FWOOSH, SKROOMM, KA-THOOM); Polish follows it in Polish spelling (SZSZT, SZKLANG, WZIUUM, KRUNCZ).
   NO Polish diacritics anywhere (the vocabulary review, 2026-11-13). Template marks:
     "+" after a letter = a stretch point (callers' words only; the built-in banks have none).
     "-" joins syllables (KA-BUM, TRA-TA-TA); streams split on it.
   Tiers: s (quiet: loud < 0.34), m (normal), l (loud: >= 0.67). DURATION alone stretches a word, on its lasting letters only; at the
   very top a prefix (the sound's own lead-in, PREFIXES: KA-BUM, KRA-KA-BUM) may be added; "!" goes 0..2 by loudness, capped per kind.
   ADDING A KIND (the follow-up material / debris / shock-wave / fire-ladder kinds plug in here): a K() row in KINDS, its HOLD classes,
   CHAR, KIND_ENV, FLOW style if it lasts, a BANK row in both languages (2-4 words per tier), its lead-in on PREFIXES, any shared word
   on SHARED, and the perc / repeat / maxBangs / run lists if they apply; then words-reviewed.mjs and `node scripts/letters/check.mjs`. */
import { rng } from "./rng.mjs";
import { magnitudeOf } from "./size.mjs";

/* characters every engine font letters (own glyph, synthesised Polish letter or fallback): words outside this set are refused */
export const RENDERABLE = /^[A-Z0-9ĄĆĘŁŃÓŚŹŻ!?\-+\x27.,…×–%:/ ]+$/u;
export const MAX_LEN = 22;

/* ---------- sound kinds: what it is, the engine mood, the base sound (loud comes from the call), motion, stretch, prefixes ----------
   group: hit | break | blast | motion | element | power | device | voice | animal | vehicle | weapon | weather.  stretch = how many extra letters a full-loud word gets. */
const K = (group, pl, en, mood, sound, motion, stretch = 2, pre = null, alias = []) => ({ group, label: { pl, en }, mood, sound, motion, stretch, pre, alias });
export const KINDS = {
  /* hits */
  punch:   K("hit", "cios", "punch", "impact", { sharp: 0.8, long: 0.15, pitch: 0, rough: 0.35 }, { in: ["slam", "pop"], hold: ["shake", "boil"], out: ["shatter", "pop"] }, 2, null, ["hit", "blow", "kick", "strike"]),
  smash:   K("hit", "miażdżenie", "smash", "crash", { sharp: 0.9, long: 0.45, pitch: -0.2, rough: 0.75 }, { in: ["slam"], hold: ["rattle", "shake"], out: ["shatter", "burst"] }, 3, null, ["heavy", "slam", "crush"]),
  slap:    K("hit", "klaps", "slap", "impact", { sharp: 0.55, long: 0.2, pitch: 0.1, rough: 0.2 }, { in: ["pop", "slam"], hold: ["shake", "wobble"], out: ["pop"] }, 2),
  thud:    K("hit", "łomot", "thud", "impact", { sharp: 0.4, long: 0.1, pitch: -0.6, rough: 0.5 }, { in: ["drop", "slam"], hold: ["wobble", "rattle"], out: ["fall", "droop"] }, 2, null, ["fall", "down", "body"]),
  stomp:   K("hit", "tupnięcie", "stomp", "impact", { sharp: 0.35, long: 0.3, pitch: -0.7, rough: 0.6 }, { in: ["drop", "slam"], hold: ["rattle", "shake"], out: ["fall", "pop"] }, 2, null, ["step", "footstep"]),
  clang:   K("hit", "brzęk", "clang", "crack", { sharp: 0.9, long: 0.4, pitch: 0.3, rough: 0.2 }, { in: ["slam", "pop"], hold: ["buzz", "shake"], out: ["pop", "dissolve"] }, 2, null, ["metal", "block", "shield", "parry"]),
  slash:   K("hit", "cięcie", "slash", "crack", { sharp: 1, long: 0.3, pitch: 0.2, rough: 0.5 }, { in: ["zip", "crackIn"], hold: ["shake"], out: ["shatter", "zipout"] }, 2, null, ["cut", "claw"]),
  bite:    K("hit", "ugryzienie", "bite", "crack", { sharp: 0.7, long: 0.2, pitch: -0.1, rough: 0.6 }, { in: ["slam", "pop"], hold: ["shake", "rattle"], out: ["pop", "shatter"] }, 2, null, ["chomp", "crunch", "chew"]),
  /* breaking */
  crack:   K("break", "trzask", "crack", "crack", { sharp: 0.95, long: 0.2, pitch: 0.1, rough: 0.55 }, { in: ["crackIn", "slam"], hold: ["shake"], out: ["shatter"] }, 2, null, ["snap", "break"]),
  shatter: K("break", "stłuczenie", "shatter", "crack", { sharp: 1, long: 0.45, pitch: 0.4, rough: 0.4 }, { in: ["crackIn", "pop"], hold: ["buzz", "shake"], out: ["shatter"] }, 2, null, ["glass", "smash-glass"]),
  crash:   K("break", "łoskot", "crash", "crash", { sharp: 0.7, long: 0.6, pitch: -0.6, rough: 0.85 }, { in: ["drop", "slam"], hold: ["rattle"], out: ["fall"] }, 3, null, ["collapse", "rubble", "wreck", "destroy"]),
  crumble: K("break", "kruszenie", "crumble", "crash", { sharp: 0.4, long: 0.75, pitch: -0.5, rough: 1 }, { in: ["grow", "drop"], hold: ["wobble", "rattle"], out: ["droop", "fall"] }, 3, null, ["decay", "erode", "grind"]),
  rumble:  K("break", "dudnienie", "rumble", "crash", { sharp: 0.35, long: 0.95, pitch: -0.8, rough: 1 }, { in: ["grow"], hold: ["rattle"], out: ["fall"] }, 3, null, ["quake", "earthquake", "tremor"]),
  creak:   K("break", "skrzypienie", "creak", "tick", { sharp: 0.6, long: 0.7, pitch: 0.2, rough: 0.7 }, { in: ["pop", "grow"], hold: ["wobble"], out: ["dissolve"] }, 3, null, ["door", "wood"]),
  scrape:  K("break", "zgrzyt", "scrape", "whoosh", { sharp: 0.6, long: 0.85, pitch: -0.2, rough: 0.95 }, { in: ["zip"], hold: ["rattle"], out: ["zipout"] }, 3, null, ["drag", "screech", "grind-metal"]),
  /* blasts and shots */
  boom:    K("blast", "wybuch", "boom", "boom", { sharp: 0.45, long: 0.55, pitch: -0.2, rough: 0.6 }, { in: ["slam"], hold: ["throb", "shake"], out: ["burst"] }, 3, null, ["explosion", "blast", "explode", "bomb"]),
  whump:   K("blast", "podmuch", "whump", "boom", { sharp: 0.15, long: 0.45, pitch: -0.7, rough: 0.4 }, { in: ["grow"], hold: ["throb"], out: ["dissolve"] }, 2, null, ["gust", "pressure", "airblast"]),
  thunder: K("blast", "grzmot", "thunder", "boom", { sharp: 0.7, long: 0.8, pitch: -0.4, rough: 0.8 }, { in: ["slam", "crackIn"], hold: ["rattle", "shake"], out: ["burst", "fall"] }, 3, null, ["lightning-strike"]),
  zap:     K("blast", "porażenie", "zap", "zap", { sharp: 1, long: 0.3, pitch: 0.3, rough: 0.5 }, { in: ["pop"], hold: ["buzz"], out: ["dissolve"] }, 2, null, ["electric", "electricity", "lightning", "shock", "spark"]),
  beam:    K("blast", "promień", "beam", "zap", { sharp: 0.8, long: 0.6, pitch: 0.4, rough: 0.3 }, { in: ["zip", "pop"], hold: ["buzz"], out: ["zipout", "dissolve"] }, 3, null, ["laser", "energy", "ray", "eyebeam"]),
  gunfire: K("blast", "seria", "gunfire", "impact", { sharp: 0.9, long: 0.5, pitch: 0, rough: 0.5 }, { in: ["slam"], hold: ["shake", "rattle"], out: ["pop"] }, 2, null, ["burst", "autofire", "machinegun", "machine-gun", "rattle"]),
  ricochet:K("blast", "rykoszet", "ricochet", "whoosh", { sharp: 0.85, long: 0.6, pitch: 0.6, rough: 0.2 }, { in: ["zip", "pop"], hold: ["boil"], out: ["zipout"] }, 3, null, ["deflect", "bounce-off"]),
  /* KINDS1 (2026-11-13): the blast's wave, the flier's sonic boom, a blast without fire (the owner's pick KROOM / KRUUM) */
  shockwave: K("blast", "fala uderzeniowa", "shock wave", "boom", { sharp: 0.15, long: 0.6, pitch: -0.7, rough: 0.4 }, { in: ["grow"], hold: ["throb"], out: ["dissolve"] }, 3, null, ["shock-wave", "blastwave", "blast-wave", "pressure-wave"]),
  sonicboom: K("blast", "grom dźwiękowy", "sonic boom", "boom", { sharp: 0.85, long: 0.5, pitch: -0.4, rough: 0.6 }, { in: ["slam", "crackIn"], hold: ["shake"], out: ["burst"] }, 3, null, ["sonic-boom", "sound-barrier", "supersonic"]),
  concussion: K("blast", "suchy wybuch", "dry blast", "boom", { sharp: 0.5, long: 0.5, pitch: -0.5, rough: 0.7 }, { in: ["slam"], hold: ["shake", "throb"], out: ["burst", "dissolve"] }, 3, null, ["fireless", "fireless-blast", "dry-blast"]),
  /* KINDS1: what arrives and what comes down: the impact at the target by material, debris by material and size */
  impact:  K("impact", "trafienie", "impact", "impact", { sharp: 0.9, long: 0.1, pitch: 0.1, rough: 0.5 }, { in: ["slam", "pop"], hold: ["shake"], out: ["pop", "shatter"] }, 1, null, ["bullet-hit", "bullethit", "projectile-hit"]),
  debris:  K("impact", "odłamki", "debris", "crash", { sharp: 0.6, long: 0.3, pitch: -0.2, rough: 0.9 }, { in: ["drop"], hold: ["rattle"], out: ["fall"] }, 1, null, ["chunks", "fragments", "falling-debris"]),
  /* motion */
  whoosh:  K("motion", "świst", "whoosh", "whoosh", { sharp: 0.2, long: 0.8, pitch: 0, rough: 0.2 }, { in: ["zip"], hold: ["boil"], out: ["zipout"] }, 3, null, ["swing", "dash", "dodge", "swoosh"]),
  zoom:    K("motion", "pęd", "zoom", "whoosh", { sharp: 0.35, long: 0.85, pitch: 0.3, rough: 0.35 }, { in: ["zip"], hold: ["boil"], out: ["zipout"] }, 3, null, ["fly", "flight", "flyby", "speed"]),
  bounce:  K("motion", "skok", "bounce", "tick", { sharp: 0.2, long: 0.5, pitch: 0.7, rough: 0.1 }, { in: ["pop", "rise"], hold: ["wobble", "boil"], out: ["rise", "pop"] }, 3, null, ["jump", "leap", "spring", "boing"]),
  teleport:K("motion", "teleport", "teleport", "zap", { sharp: 0.5, long: 0.25, pitch: 0.5, rough: 0.2 }, { in: ["pop"], hold: ["buzz", "boil"], out: ["dissolve", "pop"] }, 2, null, ["blink", "vanish", "appear", "portal"]),
  wind:    K("motion", "wiatr", "wind", "whoosh", { sharp: 0.1, long: 1, pitch: 0.1, rough: 0.3 }, { in: ["zip", "grow"], hold: ["boil"], out: ["zipout", "dissolve"] }, 3, null, ["gale", "howl", "breeze"]),
  /* elements */
  fire:    K("element", "ogień", "fire", "fire", { sharp: 0.3, long: 0.7, pitch: 0.6, rough: 0.45 }, { in: ["pop", "rise"], hold: ["flicker"], out: ["rise"] }, 3, null, ["flame", "flames", "burn", "ignite", "blaze", "fireball"]),
  crackle: K("element", "trzaskanie", "crackle", "fire", { sharp: 0.85, long: 0.3, pitch: 0.4, rough: 0.7 }, { in: ["pop"], hold: ["flicker"], out: ["dissolve"] }, 2, null, ["burning", "sizzle", "embers"]),
  hiss:    K("element", "syk", "hiss", "whoosh", { sharp: 0.2, long: 0.8, pitch: -0.3, rough: 0.55 }, { in: ["zip", "pop"], hold: ["boil"], out: ["dissolve"] }, 3, null, ["steam", "gas", "leak", "spray", "pipe"]),
  splash:  K("element", "plusk", "splash", "splash", { sharp: 0.25, long: 0.5, pitch: 0.2, rough: 0.3 }, { in: ["pop"], hold: ["wobble"], out: ["fall"] }, 2, null, ["water", "wave", "dive"]),
  squish:  K("element", "plaśnięcie", "squish", "splash", { sharp: 0.2, long: 0.4, pitch: -0.4, rough: 0.6 }, { in: ["pop", "slam"], hold: ["wobble"], out: ["fall", "droop"] }, 2, null, ["goo", "slime", "squelch", "gore", "mud"]),
  drip:    K("element", "kapanie", "drip", "splash", { sharp: 0.4, long: 0.2, pitch: 0.3, rough: 0 }, { in: ["drop", "pop"], hold: ["boil"], out: ["fall"] }, 2, null, ["drop", "leak-drop"]),
  /* powers */
  powerup: K("power", "ładowanie", "power-up", "powerup", { sharp: 0.3, long: 0.8, pitch: 0.9, rough: 0.2 }, { in: ["grow", "rise"], hold: ["throb"], out: ["rise"] }, 3, null, ["charge", "power", "transform", "arcane", "hum"]),
  psychic: K("power", "telepatia", "psychic", "powerup", { sharp: 0.15, long: 0.9, pitch: 0.5, rough: 0.1 }, { in: ["grow"], hold: ["throb", "boil"], out: ["dissolve", "rise"] }, 3, null, ["mind", "telepathy", "telekinesis", "psionic"]),
  chime:   K("power", "dzwonienie", "chime", "heal", { sharp: 0.6, long: 0.5, pitch: 0.7, rough: 0 }, { in: ["pop", "rise"], hold: ["boil", "throb"], out: ["rise", "dissolve"] }, 2, null, ["magic", "sparkle", "shimmer", "idea", "ding", "bell"]),
  fizzle:  K("power", "zgaśnięcie", "fizzle", "fail", { sharp: 0.4, long: 0.5, pitch: -0.8, rough: 0.5 }, { in: ["pop"], hold: ["wobble", "buzz"], out: ["droop", "dissolve"] }, 3, null, ["fizz", "fail-power", "misfire", "dud", "fuse"]),
  whiff:   K("power", "pudło", "whiff", "fail", { sharp: 0.2, long: 0.5, pitch: -0.5, rough: 0.1 }, { in: ["zip", "pop"], hold: ["wobble"], out: ["droop", "zipout"] }, 3, null, ["miss", "fail", "flop"]),
  /* devices */
  click:   K("device", "kliknięcie", "click", "tick", { sharp: 0.7, long: 0, pitch: 0, rough: 0.1 }, { in: ["pop"], hold: ["boil"], out: ["dissolve", "pop"] }, 1, null, ["tick", "switch", "trigger", "lock"]),
  beep:    K("device", "pikanie", "beep", "tick", { sharp: 0.5, long: 0.2, pitch: 0.4, rough: 0 }, { in: ["pop"], hold: ["boil", "buzz"], out: ["dissolve"] }, 2, null, ["blip", "alarm-beep", "computer"]),
  engine:  K("device", "silnik", "engine", "whoosh", { sharp: 0.4, long: 0.8, pitch: 0.1, rough: 0.8 }, { in: ["zip"], hold: ["rattle", "boil"], out: ["zipout"] }, 3, null, ["motor", "car", "vehicle", "rev"]),
  siren:   K("device", "syrena", "siren", "zap", { sharp: 0.4, long: 0.9, pitch: 0.5, rough: 0.2 }, { in: ["pop", "grow"], hold: ["buzz", "throb"], out: ["dissolve"] }, 2, null, ["alarm"]),
  /* voices */
  roar:    K("voice", "ryk", "roar", "roar", { sharp: 0.55, long: 0.9, pitch: 0.2, rough: 0.85 }, { in: ["grow"], hold: ["rattle", "shake"], out: ["shrink", "shatter"] }, 3, null, ["growl", "beast", "monster", "battlecry"]),
  pain:    K("voice", "ból", "pain", "pain", { sharp: 0.6, long: 0.45, pitch: -0.5, rough: 0.6 }, { in: ["slam", "pop"], hold: ["wobble", "shake"], out: ["fall", "droop"] }, 3, null, ["hurt", "scream", "ouch", "wound"]),
  effort:  K("voice", "wysiłek", "effort", "pain", { sharp: 0.7, long: 0.4, pitch: -0.1, rough: 0.85 }, { in: ["pop", "crackIn"], hold: ["buzz", "rattle"], out: ["droop", "dissolve"] }, 3, null, ["grunt", "strain", "push", "lift", "stress"]),
  relief:  K("voice", "ulga", "relief", "heal", { sharp: 0.05, long: 0.6, pitch: 0.4, rough: 0 }, { in: ["rise", "pop"], hold: ["throb", "boil"], out: ["rise", "dissolve"] }, 3, null, ["phew", "heal", "rest", "regain"]),
  sigh:    K("voice", "westchnienie", "sigh", "fail", { sharp: 0.1, long: 0.9, pitch: -0.9, rough: 0.3 }, { in: ["drop"], hold: ["wobble"], out: ["droop", "fall"] }, 3, null, ["exhausted", "tired", "groan", "out"]),
  cheer:   K("voice", "wiwat", "cheer", "powerup", { sharp: 0.5, long: 0.4, pitch: 0.8, rough: 0.2 }, { in: ["grow", "rise"], hold: ["throb"], out: ["rise"] }, 3, null, ["triumph", "yes", "victory", "hooray"]),
  laugh:   K("voice", "śmiech", "laugh", "tick", { sharp: 0.4, long: 0.5, pitch: 0.3, rough: 0.3 }, { in: ["pop"], hold: ["wobble", "boil"], out: ["pop", "rise"] }, 1, null, ["giggle", "chuckle", "evil-laugh"]),
  shush:   K("voice", "uciszenie", "shush", "whoosh", { sharp: 0.3, long: 0.7, pitch: -0.2, rough: 0.2 }, { in: ["pop"], hold: ["boil"], out: ["dissolve"] }, 3, null, ["quiet", "silence", "hush", "whisper"]),
  heartbeat:K("voice", "puls", "heartbeat", "impact", { sharp: 0.3, long: 0.3, pitch: -0.3, rough: 0.3 }, { in: ["pop"], hold: ["throb"], out: ["dissolve"] }, 1, null, ["heart", "pulse", "tension"]),
  /* animals (2026-11-13: the user asked for a dog, a cat, a rat, a snake, an elephant) */
  bark:      K("animal", "szczekanie", "bark", "roar", { sharp: 0.8, long: 0.15, pitch: 0.1, rough: 0.6 }, { in: ["pop", "slam"], hold: ["shake"], out: ["pop"] }, 1, null, ["dog", "woof"]),
  snarl:     K("animal", "warczenie", "snarl", "roar", { sharp: 0.3, long: 0.8, pitch: -0.6, rough: 0.9 }, { in: ["grow"], hold: ["rattle", "shake"], out: ["shrink"] }, 3, null, ["dog-growl", "growling", "warkot"]),
  meow:      K("animal", "miauczenie", "meow", "heal", { sharp: 0.2, long: 0.5, pitch: 0.5, rough: 0.2 }, { in: ["rise", "pop"], hold: ["wobble"], out: ["droop"] }, 2, null, ["cat", "mew"]),
  purr:      K("animal", "mruczenie", "purr", "heal", { sharp: 0.1, long: 0.95, pitch: -0.4, rough: 0.6 }, { in: ["grow"], hold: ["throb", "rattle"], out: ["dissolve"] }, 3, null, ["cat-purr"]),
  cathiss:   K("animal", "prychanie", "cat hiss", "crack", { sharp: 0.7, long: 0.4, pitch: 0.4, rough: 0.7 }, { in: ["pop", "crackIn"], hold: ["shake"], out: ["pop"] }, 2, null, ["cat-hiss", "spit"]),
  squeak:    K("animal", "pisk", "squeak", "tick", { sharp: 0.6, long: 0.2, pitch: 1, rough: 0.2 }, { in: ["pop"], hold: ["wobble"], out: ["pop"] }, 1, null, ["rat", "mouse"]),
  snakehiss: K("animal", "syczenie", "snake hiss", "whoosh", { sharp: 0.3, long: 0.9, pitch: 0.3, rough: 0.5 }, { in: ["zip", "grow"], hold: ["wobble", "boil"], out: ["dissolve"] }, 3, null, ["snake", "serpent", "viper"]),
  trumpet:   K("animal", "trąbienie", "trumpet", "roar", { sharp: 0.6, long: 0.7, pitch: 0.8, rough: 0.6 }, { in: ["grow", "rise"], hold: ["shake"], out: ["shrink"] }, 3, null, ["elephant"]),
  /* vehicles */
  plane:     K("vehicle", "samolot", "plane", "whoosh", { sharp: 0.1, long: 1, pitch: 0.2, rough: 0.4 }, { in: ["zip", "grow"], hold: ["buzz"], out: ["zipout"] }, 3, null, ["airplane", "aircraft", "jet", "takeoff"]),
  helicopter:K("vehicle", "helikopter", "helicopter", "whoosh", { sharp: 0.5, long: 1, pitch: -0.2, rough: 0.6 }, { in: ["grow"], hold: ["rattle", "throb"], out: ["zipout"] }, 1, null, ["chopper", "rotor"]),
  /* weapons (firearms of every size, energy, melee, thrown, explosive) */
  pistol:    K("weapon", "pistolet", "pistol", "impact", { sharp: 0.95, long: 0.1, pitch: 0.2, rough: 0.3 }, { in: ["slam", "pop"], hold: ["shake"], out: ["pop"] }, 1, null, ["handgun", "revolver", "gunshot", "gun", "shot"]),   // the review (2026-11-13): gunshot merged into pistol
  rifle:     K("weapon", "karabin", "rifle", "crack", { sharp: 1, long: 0.2, pitch: 0, rough: 0.4 }, { in: ["slam", "crackIn"], hold: ["shake"], out: ["pop", "shatter"] }, 1, null, ["sniper", "carbine"]),
  shotgun:   K("weapon", "strzelba", "shotgun", "boom", { sharp: 0.8, long: 0.3, pitch: -0.4, rough: 0.7 }, { in: ["slam"], hold: ["shake"], out: ["burst"] }, 2, null, ["scattergun"]),
  minigun:   K("weapon", "działko", "minigun", "impact", { sharp: 0.7, long: 1, pitch: 0.1, rough: 0.8 }, { in: ["slam"], hold: ["rattle", "shake"], out: ["pop"] }, 3, null, ["gatling", "chaingun", "rotary"]),
  /* energy weapons: a laser pistol (a short, high, electric shot whose pitch falls: hard start, brief fizz) and a heavy blaster
     (a low, thick, rough energy blast); the held beam stays "beam" */
  laserpistol: K("weapon", "pistolet laserowy", "laser pistol", "zap", { sharp: 0.95, long: 0.2, pitch: 0.9, rough: 0.15 }, { in: ["zip", "pop"], hold: ["buzz"], out: ["zipout"] }, 1, null, ["laser-pistol", "raygun", "phaser", "pew"]),
  blaster:   K("weapon", "ciężki blaster", "heavy blaster", "zap", { sharp: 0.6, long: 0.4, pitch: -0.3, rough: 0.6 }, { in: ["slam", "pop"], hold: ["buzz", "shake"], out: ["burst"] }, 2, null, ["plasma", "plasma-cannon", "railgun", "energy-cannon"]),
  silenced:  K("weapon", "tłumik", "silenced", "tick", { sharp: 0.6, long: 0.1, pitch: 0.2, rough: 0.2 }, { in: ["pop"], hold: ["flicker"], out: ["pop"] }, 1, null, ["suppressed", "silencer"]),
  sword:     K("weapon", "miecz", "sword", "crack", { sharp: 0.9, long: 0.5, pitch: 0.6, rough: 0.2 }, { in: ["zip", "crackIn"], hold: ["shake"], out: ["shatter", "zipout"] }, 2, null, ["blade", "katana"]),
  arrow:     K("weapon", "strzała", "arrow", "whoosh", { sharp: 0.6, long: 0.3, pitch: 0.3, rough: 0.1 }, { in: ["zip"], hold: ["wobble"], out: ["zipout"] }, 2, null, ["bow", "bolt", "crossbow"]),
  thrown:    K("weapon", "rzut", "thrown", "impact", { sharp: 0.7, long: 0.2, pitch: -0.2, rough: 0.3 }, { in: ["zip", "slam"], hold: ["wobble"], out: ["fall"] }, 1, null, ["throw", "knife", "shuriken", "dagger"]),
  grenade:   K("weapon", "granat", "grenade", "boom", { sharp: 0.5, long: 0.6, pitch: -0.4, rough: 0.7 }, { in: ["slam"], hold: ["throb", "shake"], out: ["burst"] }, 3, null, ["frag", "mine"]),
  rocket:    K("weapon", "rakieta", "rocket", "fire", { sharp: 0.3, long: 0.9, pitch: 0.2, rough: 0.7 }, { in: ["zip", "grow"], hold: ["boil", "shake"], out: ["burst", "zipout"] }, 3, null, ["missile", "launcher", "bazooka", "rpg"]),
  /* KINDS1: the rest of a shot: the bullet passing a token (a near miss), spent casings, an empty or jammed gun */
  whizz:     K("weapon", "świst kuli", "whizz", "whoosh", { sharp: 0.7, long: 0.2, pitch: 0.8, rough: 0.1 }, { in: ["zip"], hold: ["boil"], out: ["zipout"] }, 2, null, ["whiz", "near-miss", "nearmiss", "bullet-pass"]),
  casings:   K("weapon", "łuski", "casings", "tick", { sharp: 0.7, long: 0.5, pitch: 0.8, rough: 0.1 }, { in: ["drop", "pop"], hold: ["rattle"], out: ["fall"] }, 1, null, ["casing", "brass", "shell-casings", "spent-shells"]),
  dryfire:   K("weapon", "suchy strzał", "dry fire", "tick", { sharp: 0.6, long: 0, pitch: 0.1, rough: 0.1 }, { in: ["pop"], hold: ["flicker"], out: ["droop"] }, 1, null, ["dry-fire", "empty-gun", "jammed"]),
  reload:    K("weapon", "przeładowanie", "reload", "tick", { sharp: 0.9, long: 0.2, pitch: 0.2, rough: 0.2 }, { in: ["pop"], hold: ["flicker"], out: ["pop"] }, 1, null, ["cock", "rack", "magazine"]),
  /* sirens, cars, a walking machine, tools (2026-11-13: the user's second list) */
  ambulance: K("device", "karetka", "ambulance", "zap", { sharp: 0.4, long: 0.9, pitch: 0.6, rough: 0.2 }, { in: ["pop", "grow"], hold: ["buzz", "throb"], out: ["dissolve"] }, 2, null, ["ems", "medic"]),
  police:    K("device", "policja", "police", "zap", { sharp: 0.4, long: 0.9, pitch: 0.7, rough: 0.2 }, { in: ["pop", "grow"], hold: ["buzz", "throb"], out: ["dissolve"] }, 2, null, ["cops", "patrol"]),
  firetruck: K("device", "straż pożarna", "fire engine", "zap", { sharp: 0.5, long: 0.9, pitch: 0.3, rough: 0.4 }, { in: ["grow"], hold: ["throb", "shake"], out: ["dissolve"] }, 2, null, ["fire-engine", "firefighters", "firebrigade"]),
  fastcar:   K("vehicle", "wyścigówka", "fast car", "whoosh", { sharp: 0.6, long: 0.6, pitch: 0.5, rough: 0.5 }, { in: ["zip"], hold: ["buzz"], out: ["zipout"] }, 3, null, ["racecar", "sportscar", "speeding"]),
  clunker:   K("vehicle", "gruchot", "old clunker", "crash", { sharp: 0.5, long: 0.7, pitch: -0.3, rough: 1 }, { in: ["drop", "pop"], hold: ["rattle", "wobble"], out: ["droop", "fall"] }, 1, null, ["oldcar", "jalopy", "banger"]),
  mech:      K("vehicle", "maszyna krocząca", "walking machine", "crash", { sharp: 0.6, long: 0.4, pitch: -0.6, rough: 0.7 }, { in: ["drop", "slam"], hold: ["shake"], out: ["fall"] }, 1, null, ["walker", "robot", "mecha"]),
  drill:     K("device", "wiertarka", "drill", "zap", { sharp: 0.5, long: 1, pitch: 0.7, rough: 0.7 }, { in: ["grow"], hold: ["buzz", "rattle"], out: ["shrink"] }, 3, null, ["powerdrill", "boring"]),
  hammer:    K("device", "młotek", "hammer", "impact", { sharp: 0.9, long: 0.15, pitch: 0.2, rough: 0.3 }, { in: ["slam"], hold: ["shake"], out: ["pop"] }, 1, null, ["hammering", "nail", "pound"]),
  /* weather */
  hail:      K("weather", "grad", "hail", "tick", { sharp: 0.8, long: 0.9, pitch: 0.3, rough: 0.6 }, { in: ["drop", "pop"], hold: ["rattle"], out: ["pop"] }, 1, null, ["hailstorm", "sleet"]),
  rain:      K("weather", "deszcz", "rain", "splash", { sharp: 0.2, long: 1, pitch: 0, rough: 0.5 }, { in: ["drop"], hold: ["boil"], out: ["dissolve"] }, 3, null, ["downpour", "drizzle", "shower"]),
  storm:     K("weather", "burza", "storm", "boom", { sharp: 0.5, long: 1, pitch: -0.3, rough: 0.8 }, { in: ["grow", "slam"], hold: ["shake", "throb"], out: ["burst", "dissolve"] }, 3, null, ["thunderstorm", "tempest"]),
  tornado:   K("weather", "tornado", "tornado", "whoosh", { sharp: 0.3, long: 1, pitch: -0.2, rough: 0.9 }, { in: ["grow"], hold: ["shake", "boil"], out: ["zipout", "shrink"] }, 3, null, ["twister", "whirlwind", "cyclone"])
};
/* repeating sounds: an escalation adds a syllable (TRA-TA-TA -> TRA-TA-TA-TA) instead of stretching letters */
for ( const id of ["gunfire", "laugh", "drip", "stomp", "beep", "bark", "squeak", "helicopter", "reload", "clunker", "mech", "hammer", "hail", "crackle", "siren", "ambulance", "police", "debris", "casings", "dryfire"] ) KINDS[id].repeat = "last";     // one more of the last syllable
for ( const id of ["heartbeat", "firetruck"] ) KINDS[id].repeat = "pair";                              // one more BA-DUM
/* PERCUSSIVE sounds (the review, rule 7): a click, a drip, a hammer, a reload, a heartbeat, a gun rattle, hail, a footstep, a shot.
   Their length is MORE HITS, never a stretched vowel (no KLAAAK, no TONK-TOOONK): perc kinds are never stretched; a repeating one
   gets more syllables when it lasts longer. */
for ( const id of ["click", "drip", "hammer", "reload", "heartbeat", "gunfire", "hail", "stomp", "helicopter", "clunker", "mech", "pistol", "rifle", "silenced", "crackle", "squeak", "bark", "laugh", "beep", "impact", "debris", "casings", "dryfire"] ) KINDS[id].perc = true;
/* the "!" cap per kind (the review, rule 8, and the look review: kinds that are never loud never get "!!"): 0 = never "!", 1 = at most one */
for ( const [id, n] of Object.entries({ fizzle: 1, sigh: 0, relief: 0, purr: 0, silenced: 1, drip: 1, shush: 1, whiff: 1, hiss: 1, snakehiss: 1, psychic: 1, meow: 1, squeak: 1, click: 1, beep: 1, rain: 1, heartbeat: 1, creak: 1, reload: 1, crackle: 1, casings: 0, dryfire: 1 }) ) KINDS[id].maxBangs = n;
/* the longest run of one letter (MAX_RUN 6 by default): long steady sounds need more (the review, rule 14: a long hiss must be longer
   than a short loud one) */
for ( const id of ["hiss", "shush", "snakehiss", "rain", "purr", "psychic", "rumble", "engine", "minigun", "drill", "powerup", "wind", "snarl"] ) KINDS[id].run = 10;
/* the SUSTAIN of each sound (see "WHERE a word stretches" below): which letter classes may repeat, in order */
const HOLD = {
  punch: "V F M", smash: "V M R", slap: "V S", thud: "V M", stomp: "V M", clang: "V M", slash: "V S H", bite: "V R",
  crack: "R V", shatter: "S Z V", crash: "V S H R", crumble: "R V S", rumble: "R M V", creak: "V R", scrape: "R Z S V",
  boom: "V M", whump: "V M F", thunder: "R V M", zap: "Z V", beam: "Z V M", gunfire: "V", ricochet: "V M",
  whoosh: "V S Z F", zoom: "V R M", bounce: "V M", teleport: "V F", wind: "V S H",
  fire: "V R F", crackle: "S R V", hiss: "S Z F V", splash: "V S H", squish: "V S H", drip: "V",
  powerup: "M V Z", psychic: "M V", chime: "V M", fizzle: "Z S F V", whiff: "F V S",
  click: "V", beep: "V", engine: "R V M", siren: "V",
  roar: "V R", pain: "V R", effort: "V M H", relief: "V F H", sigh: "V H", cheer: "V", laugh: "V", shush: "S H V", heartbeat: "V",
  bark: "V R F", snarl: "R V", meow: "V M", purr: "R M", cathiss: "S H V", squeak: "V", snakehiss: "S Z V", trumpet: "V R M",
  plane: "V R M", helicopter: "V", pistol: "V M", rifle: "V R", shotgun: "V M", minigun: "R V", blaster: "Z V M", laserpistol: "V R", silenced: "F S H V",
  sword: "M V S", arrow: "F V M", thrown: "F V", grenade: "V M", rocket: "S V M", reload: "V",
  ambulance: "V", police: "V", firetruck: "V M", fastcar: "R V M", clunker: "R V", mech: "V M", drill: "Z V R", hammer: "V",
  hail: "V", rain: "S Z V", storm: "R V M", tornado: "V R S",
  shockwave: "V M F", sonicboom: "V M", concussion: "V M", impact: "V", debris: "V", whizz: "Z S V", casings: "V", dryfire: "V"
};
for ( const [id, h] of Object.entries(HOLD) ) KINDS[id].hold = h.split(" ");
/* percussive kinds keep their HOLD for the accent (where the ring sits) but never stretch: `stretch` = the classes that may repeat */
for ( const id of KIND_LIST() ) KINDS[id].stretchHold = KINDS[id].perc ? [] : KINDS[id].hold;
function KIND_LIST() { return Object.keys(KINDS); }
/* ---------- PREFIXES: the sound's OWN lead-in (the user, 2026-11-13: "Tra ta przed bombą?") ----------
   A prefix is what is heard just before the main sound and belongs to it: the crack of the detonator before the boom (KA-BUM,
   KA-THOOM), the tearing of the surface before a collapse (TRZA-KRUSZ, KA-KROOSH), the lightning's crack before the thunder's
   roll. It is never another sound's signature: no gun rattle (TRA-TA-) in front of a blast, no crash word in front of a punch.
   Each prefix lists why it belongs and the only kinds it may lead; KINDS[id].pre is filled from here and check-words.mjs ties
   every prefix to this table. A kind without an own lead-in has no prefix (a whoosh, a hiss, a voice). */
/* The review (2026-11-13, rules 9 and 10): every lead-in of a bank word is on this table too (a bank word "KA-BUUM" uses KA-, a
   two-phase sound "CHK-CHK-BOOM" uses the pump CHK-CHK-); TRZA- is gone (it is the dictionary word TRZASK cut short), KA- no longer
   leads a beam or a fire (not their own lead-in), the shotgun's own lead-in is its pump. */
export const PREFIXES = {
  pl: {
    "KA-":   { why: "the dry crack that opens a heavy sound: the detonator before the boom, the knuckles before the blow, the impact before a heavy fall or a walking machine's step, the discharge before a heavy blast", kinds: ["punch", "smash", "clang", "boom", "crack", "crash", "thud", "mech", "blaster", "splash", "grenade", "concussion"] },
    "KRA-":  { why: "the crack of a surface giving way before the crash", kinds: ["smash", "crash"] },
    "KRA-KA-": { why: "the lightning's double crack before the thunder's roll", kinds: ["thunder", "storm"] },
    "CZAK-CZAK-": { why: "the pump racked before the shotgun fires (a two-phase sound)", kinds: ["shotgun"] },
    "PTYK-KA-": { why: "the pin's tick and the fuse's crack before the grenade goes off", kinds: ["grenade"] }
  },
  en: {
    "KA-":   { why: "the dry crack that opens a heavy sound: the detonator before the boom, the knuckles before the blow, the impact before a heavy fall or a walking machine's step, the discharge before a heavy blast", kinds: ["punch", "smash", "clang", "boom", "crack", "crash", "thud", "mech", "blaster", "splash", "grenade", "concussion"] },
    "KRA-":  { why: "the crack of a surface giving way before the crash", kinds: ["smash", "crash"] },
    "KRA-KA-": { why: "the lightning's double crack before the thunder's roll", kinds: ["thunder", "storm"] },
    "CHK-CHK-": { why: "the pump racked before the shotgun fires (a two-phase sound)", kinds: ["shotgun"] },
    "PTIK-KA-": { why: "the pin's tick and the fuse's crack before the grenade goes off", kinds: ["grenade"] }
  }
};
for ( const [lang, table] of Object.entries(PREFIXES) ) for ( const [pre, { kinds }] of Object.entries(table) ) for ( const id of kinds ) {
  const k = KINDS[id]; k.pre ??= {}; (k.pre[lang] ??= []).push(pre);
}

export const KIND_IDS = Object.keys(KINDS);
export const GROUPS = { hit: { pl: "uderzenia", en: "hits" }, break: { pl: "pękanie", en: "breaking" }, blast: { pl: "wybuchy", en: "blasts" },
  motion: { pl: "ruch", en: "motion" }, element: { pl: "żywioły", en: "elements" }, power: { pl: "moce", en: "powers" },
  device: { pl: "urządzenia", en: "devices" }, voice: { pl: "głosy", en: "voices" },
  animal: { pl: "zwierzęta", en: "animals" }, vehicle: { pl: "pojazdy", en: "vehicles" }, weapon: { pl: "broń", en: "weapons" },
  weather: { pl: "pogoda", en: "weather" }, impact: { pl: "trafienia", en: "impacts" } };

/* ---------- the word banks: tiers "a|b|c" (s quiet, m normal, l loud); st = stream syllables (default: the quiet words in a row) ----------
   Rewritten by the vocabulary review (2026-11-13, WORD2): ENGLISH IS THE MASTER, Polish follows it by spelling (OO -> UU, EE -> II,
   SH -> SZ, CH -> CZ, V -> W, TH -> T) plus a short native list (BUM, PAF, IJO-IJO, SZSZT); NO Polish diacritics; every word built from
   the sound (attack + lasting part + cut-off), not one letter away from a dictionary word; each kind its own words (SHARE below names
   the only kinds that borrow another kind's words); 2-4 good words per tier, never padded. Length comes from stretching (duration),
   so the banks hold the short forms. */
const B = (s, m, l, st = null) => { const S = s.split("|"); return { s: S, m: m.split("|"), l: l.split("|"), st: st ? st.split("|") : [S.slice(0, 3).join("-")] }; };
/* SHARED: words that several kinds may use, each with its reason (the owner's ruling, 2026-11-13: "napisy mogą się powielać jeśli
   ma to sens albo byłoby na siłę"). The key is the word with repeated letters collapsed and hyphens removed (KRRAKK -> KRAK). Any
   other word shared between kinds of one language fails the check, so a wrong borrowing (a punch word on a plane) cannot come back. */
export const SHARED = {
  pl: {
    BRM: { kinds: ["thunder", "storm", "engine"], why: "a low rolling R-M: thunder, a storm and an idling engine" },
    KRM: { kinds: ["thunder", "storm"], why: "a storm's single word is its thunder" },
    KRAKUM: { kinds: ["thunder", "storm"], why: "a storm's single word is its thunder" },
    KRAGUM: { kinds: ["thunder", "storm"], why: "a storm's single word is its thunder" },
    DUMDUM: { kinds: ["stomp", "mech"], why: "a mech's walk is heavy stomping" },
    SZKLANG: { kinds: ["clang", "sword"], why: "a sword on metal is a clang" },
    RM: { kinds: ["rumble", "engine"], why: "a low rolling hum: a rumble and an idling engine sound the same" },
    WRUM: { kinds: ["rumble", "engine"], why: "a low rolling hum: a rumble and an idling engine sound the same" },
    FZT: { kinds: ["zap", "fizzle"], why: "a fizzle is a small electric zap dying" },
    WZM: { kinds: ["beam", "powerup"], why: "the energy hum of a beam and of a charge" },
    ZM: { kinds: ["beam", "powerup"], why: "the energy hum of a beam and of a charge" },
    WZAM: { kinds: ["beam", "powerup"], why: "the energy hum of a beam and of a charge" },
    FSZ: { kinds: ["whoosh", "rocket"], why: "a rocket passing is a whoosh" },
    ZWUM: { kinds: ["zoom", "powerup"], why: "a rising zoom: something passing fast and a charge rising" },
    WZIUM: { kinds: ["zoom", "plane"], why: "the Polish fly-by (wziuum): a plane passing is a zoom" },
    FST: { kinds: ["hiss", "fizzle", "cathiss"], why: "a short hiss of air: steam, a dying fuse, a cat" },
    WN: { kinds: ["psychic", "fastcar"], why: "a thin whine: a mind's hum and a car going by" },
    PFT: { kinds: ["fizzle", "silenced"], why: "a muffled puff: a dud and a silenced shot" },
    WRM: { kinds: ["engine", "purr"], why: "a purr is a small idling engine" },
    WR: { kinds: ["snarl", "purr", "minigun"], why: "a rolling R: a throat and a spinning barrel" },
    FT: { kinds: ["cathiss", "arrow"], why: "a short puff of air: a cat's spit and an arrow's flight" },
    SZ: { kinds: ["snakehiss", "rain"], why: "a steady hiss: a snake and falling rain" },
    SKRAKT: { kinds: ["crack", "impact"], why: "a hard hit that splits what it strikes: the crack of the struck thing" }
  },
  en: {
    BRM: { kinds: ["thunder", "storm", "engine"], why: "a low rolling R-M: thunder, a storm and an idling engine" },
    KRM: { kinds: ["thunder", "storm"], why: "a storm's single word is its thunder" },
    KRAKOM: { kinds: ["thunder", "storm"], why: "a storm's single word is its thunder" },
    KRAGOM: { kinds: ["thunder", "storm"], why: "a storm's single word is its thunder" },
    SHKLANG: { kinds: ["clang", "sword"], why: "a sword on metal is a clang" },
    RM: { kinds: ["rumble", "engine"], why: "a low rolling hum: a rumble and an idling engine sound the same" },
    FZT: { kinds: ["zap", "fizzle"], why: "a fizzle is a small electric zap dying" },
    VZM: { kinds: ["beam", "powerup"], why: "the energy hum of a beam and of a charge" },
    ZM: { kinds: ["beam", "powerup"], why: "the energy hum of a beam and of a charge" },
    FSH: { kinds: ["whoosh", "wind", "hiss"], why: "moving air: a whoosh, the wind, a leak" },
    FWUF: { kinds: ["fire", "whiff"], why: "a soft puff of air: a flame catching and a near miss" },
    VN: { kinds: ["psychic", "fastcar"], why: "a thin whine: a mind's hum and a car going by" },
    PFT: { kinds: ["fizzle", "silenced"], why: "a muffled puff: a dud and a silenced shot" },
    KTAK: { kinds: ["click", "rifle"], why: "a dry tick: a switch and a rifle's bolt" },
    KROM: { kinds: ["rumble", "concussion"], why: "a low rolling KR-OM: a rumble and a blast without fire (the owner's pick KROOM)" },
    HNH: { kinds: ["pain", "effort"], why: "a held breath through the teeth: pain and strain" },
    PF: { kinds: ["relief", "sigh"], why: "a breath out: relief and a tired sigh" },
    SH: { kinds: ["shush", "rain"], why: "a steady hiss: a hush and falling rain" },
    FSHT: { kinds: ["cathiss", "thrown"], why: "a short hiss of air: a cat's spit and a thing flying by" },
    SHROM: { kinds: ["plane", "rocket"], why: "a jet roar passing: a plane and a rocket" },
    ZR: { kinds: ["minigun", "drill"], why: "a spinning whirr: a barrel and a drill" },
    SKRAKT: { kinds: ["crack", "impact"], why: "a hard hit that splits what it strikes: the crack of the struck thing" }
  }
};
/** the key a word is compared under for sharing (repeated letters collapsed, marks and hyphens removed) */
export const shareKey = (w) => clean(String(w)).replace(/[!?…\x27.,:+\s-]/g, "").replace(/(\p{L})\1+/gu, "$1");
export const BANK = {
  pl: {
    punch:    B("TWAP|TWOP", "BAM|TWAK|BDAM", "TWAKK|KA-BAMM|KA-BDAMM"),
    smash:    B("WRAM|KRUMCZ", "WRAMM|SKRUUM", "SKRUUMM|KA-WRAMM|KRA-WRAMM"),
    slap:     B("PLAP|FLAP", "SPAK|SWAK|FLAPP", "SPAKK|SZWAKK"),
    thud:     B("DUF|TUMF", "TUMP|GDUMP|GDUUMF", "GDUMMP|KA-DUMP"),
    stomp:    B("DROMP|GDROMP", "DROMP-DROMP|GDROMP-GDROMP|DUM-DUM", "DROMP-DROMP-DROMP|GDROMP-GDROMP-GDROMP", "DROMP-DROMP-DROMP"),
    clang:    B("KLANK|KTANG", "SZKLANG|TRANNG", "SZKLAANNG|TRAANNG|KA-KLANNK"),
    slash:    B("SZIK|SWIK", "FSZSZT|SZLIKT", "SZRAKT|SWISZK"),
    bite:     B("KLOMP|SZNAP", "GNAMP|KRONCZ|SZKLOMP", "KRONNCZ|GNARRMP"),
    crack:    B("SKRIK|KRIKT", "KRAK|SKRAK", "KRRAKK|SKRRAKT|KA-KRAKK"),
    shatter:  B("TSIK|KSZIN", "KSZINK|SKRISZ", "SKRAASZ|KSZRAKK"),
    crash:    B("BRAKUM|GRUMSZ", "BRAKUUM|GRUUMSZ", "KA-BRAKUUM|KRA-GRUUMSZ"),
    crumble:  B("SZKRUK|ZGRUK", "KRRUNCZ|ZGRRUK", "ZGRRAKK|SKRRUNCZ"),
    rumble:   B("RRMM|GRMM", "WRRUMM|GRRYMM", "WRRRRUMM|GRRRYMMM"),
    creak:    B("KRII|SKRII", "SKRYYK|KRRIII", "SKRYYYYK|KRRRIII"),
    scrape:   B("SKRRT|KRRT", "SZRRRK|SKRRYT", "SZRRRAKK|SKRRRYT"),
    boom:     B("BUM|FUUM", "TWUUM|BATUUM", "KA-BUUM|KA-TWUUMM|KA-GDUUM"),
    whump:    B("FUMF|WUMF|BWUMF", "FWUMP|FUUMF", "FWUUMPF|FWUUMMF"),
    thunder:  B("BRRMM|KRRMM", "KRAKUUM|KRAGUUM", "KRA-KA-GRRAWUUM|KRA-KA-KRRAWUUM"),   // WORDS3: no BUM (the owner: BUM only for a blast with fire)
    zap:      B("BZT|DZT|FZT", "BZZT|KZZT|DZZT", "BZZAKT|DZZAKT"),
    beam:     B("WZZM|ZZMM", "WZZZMM|ZZAMM", "WZZAAMM|BZZAAMM"),
    gunfire:  B("TRA-TA-TA|DRRT-DRRT", "TRA-TA-TA-TA|DRRT-DRRT-DRRT|RATATATA", "TRA-TA-TA-TA-TA|DRRT-DRRT-DRRT-DRRT|RATATATATA", "TRA-TA-TA|DRRT-DRRT-DRRT"),
    ricochet: B("TSIJUU|PTIJU", "PTIIJUU|SPANNG", "SPAANNG|PTIIIJUUU"),
    whoosh:   B("FSZ|FISZ", "FWUUSZ|FSZUUSZ|WUUSZ", "FWUUUSZ|SZFUUUSZ"),
    zoom:     B("ZWISZ|WZIU", "ZWUUM|WZUUUM|WZIUUM", "ZWUUUMM|WZUUUMM"),
    bounce:   B("BOIP|PONK", "BOINNG|SPROINNG", "BOJOJOINNG|SPROJOINNG"),
    teleport: B("WZIP|FZIP", "WZORP|ZWAP|FWAMF", "WZAMFF|ZWAPP"),
    wind:     B("FSZSZ|HWUU", "SZWUUU|HWUUSZ", "SZWUUUSZ|HWUUUUSZ"),
    fire:     B("FUF|FOF", "FWUUM|FWOOM", "FWUUUMM|FAWUUUSZ"),
    crackle:  B("KRIT-KRAT|TSYK-TSAK", "KRIT-KRAT-KRIT|TSYK-TSAK-TSYK", "KRITTA-KRAT-KRIT|TSYKKA-TSAK", "KRIT-KRAT-TSYK"),
    hiss:     B("FSS|FSST", "PSSS|TSSS", "PFSSST|TSSSST"),
    splash:   B("PLUP|BLUP|PLOP|GLUP", "PLUMP|BLUMP|SPLUMP", "SPLOOSZ|SPLASZ|KA-SPLOOSZ", "GLUB-BLUB-BULP|PLUP-BLUP-PLOP"),
    squish:   B("SZLIP|SZLUP", "SZLORP|SPLORCZ|GLORP", "SZKLORCZ|SPLORRCZ"),
    drip:     B("PLIP-PLIP|PLAP-PLAP", "PLIP-PLIP-PLIP|PLAP-PLIP-PLAP", "PLIP-PLIP-PLIP-PLIP|PLAP-PLAP-PLIP-PLAP", "PLIP-PLIP-PLIP"),
    powerup:  B("WMM|ZMM", "WZMMM|BZMMM", "ZWUUUMM|WZAAMM"),
    psychic:  B("MMNN|HMNN", "WNNNN|MNNNNG", "WNNNNNG|ZNNNNG"),
    chime:    B("TLING|DZING", "DZINNG|TLINNG|TINNG", "DZIIINNG|TLIIINNG"),
    fizzle:   B("PFFT…|FZZT…", "PFSZT…|FSST…", "PFFFT|FZZZT"),
    whiff:    B("FIFF…|FWISZ…", "SWUUF…|FWUFF…", "FWUUUF|SWUUUF"),
    click:    B("TYK|KTYK", "CZYK|KTYKK", "CZYKK|KTYKT"),
    beep:     B("BIP|PIP", "BIP-BIP|PIP-PIP-PIP", "BIP-BIP-BIP|BIIP-BIIP-BIIP", "BIP-BIP-BIP"),
    engine:   B("RRRM|WRRM", "WRRRMM|BRRRMM", "WRRRUUMM|WRRROOMM"),
    siren:    B("IIUU|IJUU", "IIUU-IIUU|IJUU-IJUU", "IIUU-IIUU-IIUU|IIIUUUIIIUUU", "IIUU-IIUU"),
    roar:     B("GRRAH|RRAH", "RRAAGH|GRRAAH|WRRAAH", "GRRAAARRH|WRRAAAGH|BWRRAAAGH"),
    pain:     B("NNGH|HNN|OCH", "AAGH|AARGH|HNNGH", "GRAAAGH|AAARGH"),
    effort:   B("HNH|NNH", "HRRGH|GNNH", "NNNRRAAH|HNNNRRGH"),
    relief:   B("HFF…|FUH…", "PFFF…|FUUUH…", "HFAAH…|PFUUUH…"),
    sigh:     B("HAH…|HOCH…", "HUCH…|HUUH…", "HAACH…|HUUUCH…"),
    cheer:    B("JEEH|UUH", "JEEEA|WUUUH", "JEEEEAA|WUUUUUH"),
    laugh:    B("HA-HA-HA|CHE-CHE", "HA-HA-HA-HA|CHE-CHE-CHE|HI-HI-HI", "BUA-HA-HA-HA|MUA-HA-HA-HA", "HA-HA-HA"),
    shush:    B("SZSZ|PSZT", "SZSZT|PSZSZT", "SZSZSZT|PSSSSSZT"),
    heartbeat:B("BA-DUM|DU-DUM", "BA-DUM-BA-DUM|DU-DUM-DU-DUM", "BA-DUM-BA-DUM-BA-DUM|DU-DUM-DU-DUM-DU-DUM", "BA-DUM"),
    bark:     B("WAF-WAF|HRAU", "WAF-WAF-WAF|HRAU-HRAU|WRAF-WRAF", "WRRAF-WRRAF|WRRAF-WRRAF-WRRAF", "WAF-WAF-WAF"),
    snarl:    B("GRRH|WRRR", "HRRRRR|GRRYYH", "GRRRRRH|HRRRRAGH"),
    meow:     B("MRAOU|MIII", "MNIAOU|MRRAOU", "WRRAAAOU|MRRRAAAOU"),
    purr:     B("MRRR|WRRR", "HRRRM|MRRRMM", "MRRRRRMM|WRRRRRMM"),
    cathiss:  B("HSSS|KHH", "CHHSSS|FFFT", "KHSSSSZ|FFFSSST"),
    squeak:   B("IIK|PII", "IIK-IIK|SKWII|PII-PII", "IIK-IIK-IIK|SKWII-SKWII", "IIK-IIK-IIK"),
    snakehiss:B("SSS|SSSZ", "SSSSSS|SSSSSZ", "SSSSSSSS|SSSSSSSZ"),
    trumpet:  B("PFRU|PRRT", "PFRRAAA|TRUUU|PRRUUU", "TRRUUUUT|PFRRUUUU"),
    plane:    B("NIUM|WZIUM", "NIIIUUM|WZIIUUM", "NIIIIUUUMM|WZIIIUUUMM"),
    helicopter:B("FUP-FUP|WUP-WUP", "FUP-FUP-FUP|WUP-WUP-WUP|TWOP-TWOP-TWOP", "FUP-FUP-FUP-FUP|TWOP-TWOP-TWOP-TWOP", "FUP-FUP-FUP"),
    fastcar:  B("WNNN|WRIIN", "NIIIIAAM|ZRIIIN", "ZRRRIIIIN|NIIIIAAUUM"),
    clunker:  B("PYR-PYR-PYRK|KLENK-KLONK", "PYR-PYR-PYR-PYRK|KLENK-KLONK-KLENK", "PYR-PYR-PYRK-PYRK|KLONK-KLENK-KLONK", "PYR-PYR-PYRK"),
    mech:     B("DUUM-DUUM|WRRT-KLANK", "DUUM-DUUM-DUUM|WRRT-KLANK-WRRT|GDUUM-GDUUM", "GDUUM-GDUUM-GDUUM|WRRT-KLANK-GDUUM", "DUUM-DUUM"),
    drill:    B("WZZZ|WRRZ", "WZZRRRR|WRRZZZT|BZZRRR", "WZZRRRRT|BZZRRRRT"),
    hammer:   B("TONK-TONK|KTANK-KTANK", "TONK-TONK-TONK|KTANK-KTANK-KTANK", "TONK-TONK-TONK-TONK|KTANK-TONK-KTANK", "TONK-TONK-TONK"),
    pistol:   B("PAF|POK", "BANG|BLAM|PAFF", "BLAMM|BANNG"),
    rifle:    B("KTAK|TSZAK", "PTANG|KTAKK", "KTRAKK|PTRZAKK"),
    shotgun:  B("BDUM|BWAMF", "BDUUMF|BRAWUUM", "CZAK-CZAK-BDUUM|CZAK-CZAK-BRAWUUM"),
    minigun:  B("WRRRR|ZRRRR", "BRRRRT|WRRRRT", "DRRRRRRT|BRRRRRRRT"),
    laserpistol:B("ZAT|TZAT", "ZARK|TZAK|FZAT", "SKZARK|KTZAK|ZZARKT", "ZAT-ZAT-ZAT"),
    blaster:  B("FZUM|DZUM", "CZUUM|KZUUM", "KA-CZUUM|SKZAAMM"),
    silenced: B("FUT|PFT", "PFYT|FWUT", "PFFYT|FWUTT"),
    sword:    B("SZING|SZLING", "SZKLINNG|SZINNG", "SZRINNNG|SZKLAANNG"),
    arrow:    B("FYT|FWIT", "TWIP|FFFT|SWIP", "SWIPP|TWIPP"),
    thrown:   B("FWIP|SZWIT", "SZWIK|FSZT", "SZWIKKT|ZWUPP"),
    grenade:  B("KDUMF|PDUMF", "PDUUM|KDUUMF", "PTYK-KA-PDUUM|KA-PDUUMF"),   // KINDS1: its own dry, short frag blast (BDUUM is the owner's cave-in)
    rocket:   B("FSSSZ|FSZUM", "FSZUUUM|FSSSZUM", "FSZRRUUUM|FFSZRRUUUM"),
    reload:   B("TCZYK-TCZAK|KTYK-TCZAK", "TCZYK-TCZAK-TCZYK|KTYK-TCZAK-KTYK", "TCZAK-TCZYK-TCZAK|KTYK-TCZAK-KTYK-TCZAK", "TCZYK-TCZAK"),
    ambulance:B("IJO-IJO|IJOO-IJOO", "IJO-IJO-IJO|IJOO-IJOO-IJOO", "IJO-IJO-IJO-IJO|IJOO-IJOO-IJOO-IJOO", "IJO-IJO"),
    police:   B("WIIU-WIIU|UIIU-UIIU", "WIIU-WIIU-WIIU|UIIU-UIIU-UIIU", "WIIU-WIIU-WIIU-WIIU|UIIU-UIIU-UIIU-UIIU", "WIIU-WIIU"),
    firetruck:B("BUAAP-UUIIUU|BUAAP-BUAAP", "BUAAP-UUIIUU-BUAAP|BUAAP-BUAAP-BUAAP", "UUIIUU-BUAAP-UUIIUU|BUAAAP-BUAAAP", "BUAAP-UUIIUU"),
    hail:     B("TYK-TYK-TYK|PYK-PYK", "TYK-TYK-TYK|PYK-PYK-PYK|TYKATYKATYK", "TYK-TYK-TYK-TYK|PYK-PYK-PYK-PYK", "TYK-TYK-TYK"),
    rain:     B("SZSZSZ|PSZSZ", "TSSSSZ|SSSSSZ", "SSSSSSSZ|PSSSSSSZ"),
    storm:    B("BRRMM|KRRMM", "KRAKUUM|KRAGUUM", "KRA-KA-WRRUMM|KRA-KA-PFRRUMM"),
    tornado:  B("HWRUU|WRRUU", "WRRUUUUSZ|HWRRUUUU", "HWRRRUUUMM|WRRRUUUUSZ"),
    /* KINDS1 (2026-11-13) */
    shockwave:B("HWUMF|FHUMF", "HWUUUMMF|FHUUUMMF", "HWUUUUMMFF|FHWUUUUMMFF"),
    sonicboom:B("KDAKUM|TKAKUM", "KDAKUUM|TKRAKUUM", "KDAKUUUMM|KRABWUUMM"),
    concussion:B("KRUMF|GRUMF", "KRUUM|KRRUUMF", "KRRUUUMM|KA-KRUUM"),
    impact:   B("KTOK|TKAK", "KTOKK|PTOKK", "SKRAKKT|KTRAKKT"),
    debris:   B("TK-KTYK-DUMF|TK-TK-DUMF", "KTAK-KTYK-TK-DUMF|KRAK-TK-DUMF", "KRAK-KLAKATA-DUMF|GDUMF-KRAK-DUMF", "TK-KTYK-TK"),
    whizz:    B("PFWIT|TSIU", "FZWIT|PTSIU|ZWIPT", "TZWIPT|FZZWIPT|PTZIIU"),
    casings:  B("TNK-TNK|KTNK-TK", "TNK-TNK-TNK|TNK-KTSZING|TK-TNK-TSZENG", "TNK-KTSZING-TNK-TK|KTSZING-TSZENG-TNK", "TNK-TNK-TNK"),
    dryfire:  B("TK|KTK", "TCZK|TK-TCZK", "TCZK-TCZK|TK-TCZK-TK", "TK-TCZK"),
  },
  en: {
    punch:    B("THWAP|THOK|POW", "BAM|THWUP|WHAM", "THWAPP|WHAMM|KA-THWAPP"),
    smash:    B("WRAM|KRUMPF", "WRAMM|SKROOSH", "SKROOMM|KA-WRAMM|KRA-WRAMM"),
    slap:     B("FWAP|SHPLAK", "SWAK|SHPLAKK|FWAPP", "SHPLAAKK|SHPLAKK"),
    thud:     B("THUD|THUB|DUMF", "FWUD|THOOM|GDOOMF", "KA-THOOM|THROOMF"),
    stomp:    B("GDUMF|DROMF", "GDUMF-GDUMF|DROMF-DROMF|BDOMF", "GDUMF-GDUMF-GDUMF|BDOMF-BDOMF", "GDUMF-GDUMF-GDUMF"),
    clang:    B("KLANK|KTANG", "KLANG|SHKLANG", "KLANNG|SKLAANNG|KA-KLANNG"),
    slash:    B("SHWIK|SHNIK", "SHRIKT|SHNIKK|SHWIKT", "SHRAKKT|SHNIKKT"),
    bite:     B("KLOMP|CHNAP", "GNAMP|SHKLOMP|GRONCH", "GNARRMP|SHKRONCH|GRONNCH"),
    crack:    B("TSKRIK|TSKRAK", "KRAK|SKRAK|KRAKT", "KRRAKK|SKRRAKT|KA-KRAKK"),
    shatter:  B("TSIK|TSHINK", "KSHINK|SKRISH", "SHKRAASH|KSHRAKK"),
    crash:    B("GROOSH|KRUMF", "KROOSH|BRAKOOSH", "KA-KROOSH|KRA-KROOSH|BRAKKOOSH"),
    crumble:  B("KRUSK|SKRUK", "KRRUNCH|GRRUSK", "GRRAKK|SKRRUNCH"),
    rumble:   B("RRMM|GRMM", "GRROMM|KRROMM", "GRRRROMM|KRRROOMM"),
    creak:    B("KREE|SKREE", "SKREEK|KRREE", "SKRREEK|KRRREE"),
    scrape:   B("SKRRT|KRRT", "SHRRRK|SKRRAT", "SHKRRRAKK|SKRRRAT"),
    boom:     B("BOOM|FOOM", "TWOOM|BADOOM|BTHOOM", "KA-BOOM|BATOOWW|KA-TWOOMM"),
    whump:    B("WUMF|BWUMF", "FWUMP|FWUMF", "FWOOMPF|FWUUMFF"),
    thunder:  B("BRRMM|KRMMM", "KRAKOOM|KRAGOOM", "KRA-KA-GRRAWOOM|KRA-KA-KRRAWOOM"),   // WORDS3: no BOOM (fire blasts only), no landing THOOM, no cave-in BTHOOM
    zap:      B("BZT|FZT", "ZAP|BZZT|KZZT", "BZZAKT|KZZRAKK|ZZAPP"),
    beam:     B("VZZM|ZZMM", "VZZZMM|ZZAMM", "VZZAAMM|VZZAAMM"),
    gunfire:  B("DRRT-DRRT|BUDDA-BUDDA", "DRRT-DRRT-DRRT|BUDDA-BUDDA-BUDDA|BRAKKA-BRAKKA", "BRAKKA-BRAKKA-BRAKKA|DRRT-DRRT-DRRT-DRRT", "DRRT-DRRT-DRRT|BUDDA-BUDDA"),
    ricochet: B("PTWING|PTIK", "PTWEE|PEEYOW", "PTWEEOOW|PTEEYOOW"),
    whoosh:   B("FSHH|VWISH", "FWOOSH|FWAASH", "FWOOOSHH|FSHWOOSH"),
    zoom:     B("VSHOOM|VSHEEN", "ZWAAM|VSHOOM", "ZWAAAMM|VSHOOOM"),
    bounce:   B("BOIP|DWOIP", "BOYOING|DOYOING", "BOYOYOING|DOYOYOING"),
    teleport: B("FZIP|VZIP", "VWORP|ZWAP|FWAMF", "VWAMFF|ZWAPP"),
    wind:     B("FSSHH|HWUU", "SHWOOOH|FWOOOOH", "SHWOOOOHH|FWHOOOOH"),
    fire:     B("FOF|FWUF", "FWOOM|FOOMF", "FWOOOMM|FAWOOOSH"),
    crackle:  B("TSIK-TSAK|KRITZ-KRATZ", "TSIK-TSAK-TSIK|KRITZ-KRATZ-KRITZ", "TSIKKA-TSAK-TSIK|KRITTA-KRATZ", "TSIK-TSAK-KRITZ"),
    hiss:     B("TSSS|FSSH", "FSSSHH|TSSSHT", "TSSSSSHT|FSSSSSHH"),
    splash:   B("PLOP|PLOOP|BLUP", "PLUNK|SPLUMP", "SPLOOSH|KA-SPLOOSH", "GLUB-BLUB-GLUB|PLOP-BLUP-PLOOP"),
    squish:   B("SHLUP|GLURP", "SHLORP|SPLORCH|GLORP", "SPLORRCH|SHKLORCH"),
    drip:     B("PLIP-PLIP|TLIP-PLIP", "PLIP-PLIP-PLIP|TLIP-PLIP-TLIP", "PLIP-PLIP-PLIP-PLIP|TLIP-TLIP-PLIP-PLIP", "PLIP-PLIP-PLIP"),
    powerup:  B("VMM|ZMM", "VZMMM|BZMMM", "VWAAMMM|ZWOOOMM"),
    psychic:  B("MMNN|HMNN", "VNNNN|MNNNNG", "VNNNNNG|ZNNNNG"),
    chime:    B("TLEEN|DLEEN", "TLEENG|DLEENG|SHEENG", "KLEENNG|TLEENNNG"),
    fizzle:   B("PFFT…|FZZT…", "PFZZT…|SZZT…", "PFFFT|SZZZT"),
    whiff:    B("FWIFF…|FFWUF…", "FWOOF…|FWUFF…", "FWOOOF|FWUUFF"),
    click:    B("TCHIK|KTIK", "KLAK|KTAK", "KLAKK|KTAKK"),
    beep:     B("BEEP|BIP", "BEEP-BEEP|BIP-BIP-BIP", "BEEP-BEEP-BEEP|BIP-BIP-BIP-BIP", "BIP-BIP-BIP"),
    engine:   B("RRRM|VRRM", "VRRRMM|VROOM|BRRRMM", "VRRAAMM|VROOOMM"),
    siren:    B("WEEOO|WOOWEE", "WEEOO-WEEOO|WOOWEE-WOOWEE", "WEEOO-WEEOO-WEEOO|WEEEOOOWEEEOOO", "WEEOO-WEEOO"),
    roar:     B("GRRAH|RRAH", "RRAAGH|GRRAAH|HRRAAGH", "GRRAAARRH|WRRAAAGH|BWRRAAGH"),
    pain:     B("NNGH|HNNH|OOF", "AAGH|HNNGH|GHAA", "GRAAAGH|NNAAAGH|AARGH"),
    effort:   B("HNH|NNH|UGH", "HRRGH|GNNH|HUNNGH", "NNNRRAAH|HUNNNRRGH"),
    relief:   B("HFF…|FUH…", "PFFF…|FOOOH…", "HFAAH…|PFOOOH…"),
    sigh:     B("FHUUU…|PFFFF…", "FHOOOH…|HUUUHF…", "FHAAAAH…|HFUUUUH…"),
    cheer:    B("WOOH|YEEOH", "WOOOAH|HWAAAH", "WOOOOAH|YEEEEOOH"),
    laugh:    B("HA-HA-HA|HEH-HEH", "HA-HA-HA-HA|HE-HE-HE|HO-HO-HO", "BWA-HA-HA-HA|MWA-HA-HA-HA", "HA-HA-HA"),
    shush:    B("SHH|PSHT", "SHHHT|PSHHT", "SHHHHT|PSSSHHT"),
    heartbeat:B("BA-DUM|BU-DUM", "BA-DUM-BA-DUM|BU-DUM-BU-DUM", "BA-DUM-BA-DUM-BA-DUM|BU-DUM-BU-DUM-BU-DUM", "BA-DUM"),
    bark:     B("WRAF-WRAF|RRAUF", "WRAF-WRAF-WRAF|RRAUF-RRAUF", "WRRAFF-WRRAFF|GRRAUFF-GRRAUFF", "WRAF-WRAF-WRAF"),
    snarl:    B("GRRH|HRRR", "GRRRRH|KHRRRR", "GRRRROGH|NGRRRAH"),
    meow:     B("NYAOW|MRAU", "NYAAOW|REEOWR", "REEEOOWR|NYAAAAOOW"),
    purr:     B("PRRR|MRRR", "PRRRMM|MRRRM", "PRRRRRMM|MRRRRRMM"),
    cathiss:  B("HSSS|KHH", "KHHSS|FFSST", "KHSSSSH|FFSSSHT"),
    squeak:   B("SKWEE-SKWEE|TSEE", "SKWEE-SKWEE-SKWEE|TSEE-TSEE", "SKWEE-TSEE-SKWEE|TSEE-TSEE-TSEE", "SKWEE-SKWEE-SKWEE"),
    snakehiss:B("SSS|ZSSS", "SSSSSS|ZSSSSS", "SSSSSSSS|ZSSSSSSS"),
    trumpet:  B("PFRU|PRRT", "PFRRAAA|PWAARR", "BWRRAAAAH|PFRRAAAAH"),
    plane:    B("NYOOM|NYEEOW", "NYAAOOM|SHRROOM", "SHRROOOMM|NYEEAAOOMM"),
    helicopter:B("THWUP-THWUP|WOKKA-WOKKA", "THWUP-THWUP-THWUP|WOKKA-WOKKA-WOKKA", "THWUP-WOKKA-THWUP|WOKKA-WOKKA-THWUP", "THWUP-THWUP-THWUP"),
    fastcar:  B("VNNN|VREEN", "VRREEEE|ZREEEEN", "VRRREEEEE|ZRRREEEEOWW"),
    clunker:  B("POTTA-POTTA|POTTA-PAKK", "POTTA-POTTA-POTTA|BRUTTA-PAKK", "POTTA-POTTA-PAKK|BRUTTA-BRUTTA-PAKK", "POTTA-POTTA-PAKK"),
    mech:     B("VRRT-KLANK|KTHOOM", "VRRT-KLANK-VRRT|KTHOOM-KTHOOM", "KTHOOM-KTHOOM-KTHOOM|VRRRT-KLANK-KTHOOM", "VRRT-KLANK"),
    drill:    B("VZZZ|VRRZ", "VZZRRRR|VRRZZZT|ZZRRRR", "VZZRRRRT|BZZRRRRT"),
    hammer:   B("KTOK-KTOK|KTANG-KTANG", "KTOK-KTOK-KTOK|KTANG-KTANG-KTANG", "KTANG-KTOK-KTANG|KTOK-KTOK-KTOK-KTOK", "KTOK-KTOK-KTOK"),
    pistol:   B("PAK|POK", "BANG|BLAM", "BLAMM|BANNG"),
    rifle:    B("KTAK|PTAK", "KPANG|KTAKK", "KTRAKK|PTRAKK"),
    shotgun:  B("BWAMF|BWOMF", "BRAWOOM|BWAAMMF", "CHK-CHK-BRAWOOM|CHK-CHK-BWAMMF"),
    minigun:  B("VRRRR|ZRRRR", "BRRRRT|VRRRRT", "DRRRRRRT|BRRRRRRRT"),
    laserpistol:B("ZAT|TZAT|TSAT", "ZARK|TZAK|FZAT", "SKZARK|KTZAK|ZZARKT", "ZAT-ZAT-ZAT"),
    blaster:  B("FZOM|VZUM", "CHOOM|KSHOOM", "KA-CHOOM|SKZOOMM"),
    silenced: B("FUT|PFT", "PFUT|FWUT", "PFFUT|FWUTT"),
    sword:    B("SHING|SHLING", "SHINNG|SHKLINNG", "SHRINNNG|SHKLAANNG"),
    arrow:    B("FWIP|TSIP", "THWIP|FFFT", "THWIPP|FWIPP"),
    thrown:   B("FWUP|FSHT", "FSHHT|ZWUP", "FSHHHT|ZWUPP"),
    grenade:  B("KDUMF|PDUMF", "KDOOMF|PDOOMF", "PTIK-KA-KDOOMF|KA-PDOOMF"),   // KINDS1: its own dry, short frag blast
    rocket:   B("FSHOOM|SHHROOM", "SHRROOM|FSSHOOM", "SHHRROOOM|FSSHHROOM"),
    reload:   B("TCHAK-TCHAK|SHLUK-KLAK", "TCHAK-TCHAK-TCHAK|SHLUK-KLAK-SHLUK", "TCHAK-SHLUK-TCHAK|SHLUK-KLAK-TCHAK", "TCHAK-TCHAK"),
    ambulance:B("NEEO-WEEO|NAAO-WAAO", "WEEO-NEEO-WEEO|NAAO-WAAO-NAAO", "NEEO-WEEO-NEEO-WEEO|NAAO-WAAO-NAAO-WAAO", "NEEO-WEEO"),
    police:   B("WUP-WUP|BWOOP", "WUP-WUP-WUP|BWOOP-BWOOP", "WUP-WUP-WUP-WUP|BWOOP-BWOOP-WUP", "WUP-WUP-WUP"),
    firetruck:B("BWAAMP-HWAAA|BWAAP-BWAAP", "BWAAMP-HWAAA-BWAAMP|BWAAP-BWAAP-BWAAP", "HWAAA-BWAAMP-HWAAA|BWAAAP-BWAAAP", "BWAAMP-HWAAA"),
    hail:     B("PAK-PAK|TSIK-TSIK", "PAK-PAK-PAK|TSIK-TSIK-TSIK|TAKATAKATAKA", "PAKK-KRAK-PAKK|TAKATAKATAKATAKA", "PAK-PAK-PAK"),
    rain:     B("SHHHH|PSHHH", "KSSHHH|SHHHHHH", "KSSSHHHH|SHHHHHHH"),
    storm:    B("BRRMM|KRMMM", "KRAKOOM|KRAGOOM", "KRA-KA-BWROOMM|KRA-KA-GRROOMM"),
    tornado:  B("HWRROO|VRROO", "VRROOOOSH|HWRROOOO", "SHWRRROOOOMM|VRRROOOOSHH"),
    /* KINDS1 (2026-11-13) */
    shockwave:B("FHOMF|VWOMF", "VWOOOMMF|FHOOOMMF", "VWOOOOMMFF|FHWOOOOMMFF"),
    sonicboom:B("KDAKOM|TKAKOM", "KDAKOOM|TKRAKOOM", "KDAKOOOMM|KRABWOOMM"),
    concussion:B("KROMF|GDROMF", "KROOM|KRROOMF", "KRROOOMM|KA-KROOM"),
    impact:   B("PTOK|TKAK", "KTAKT|PTOKK", "SKRAKKT|KTRAKKT"),
    debris:   B("TK-KTOK-DOMF|TK-TK-DOMF", "KTAK-KTOK-TK-DOMF|KRAK-TK-DOMF", "KRAK-KLAKATA-DOMF|GDOMF-KRAK-DOMF", "TK-KTOK-TK"),
    whizz:    B("PFWIT|TSIW", "FZWIT|PTSIW|ZWIPT", "TZWIPT|FZZWIPT|PTZEEW"),
    casings:  B("TNK-TNK|KTNK-TK", "TNK-TNK-TNK|TNK-KTSHING|TK-TNK-TSHENG", "TNK-KTSHING-TNK-TK|KTSHING-TSHENG-TNK", "TNK-TNK-TNK"),
    dryfire:  B("TK|KTK", "TCHK|TK-TCHK", "TCHK-TCHK|TK-TCHK-TK", "TK-TCHK"),
  }
};

/* ---------- KINDS1 (2026-11-13, SPEC-KINDS items 1-6): MATERIAL, PIECES, FIRE INTENSITY, TAILS and CHAINS ----------
   MATERIAL is a call-time option (`material`): what is HIT, broken or blown up. It changes the cut-off and the tail of the word, the
   kind keeps its attack. A kind takes it through its VARIANT table (KINDS[id].vary): impact (what arrives at a target), debris (what
   comes down, by material and PIECES size), struck (a blow landing on it: punch smash slap thud), blast (the blast's lead-in from what
   blows up: boom grenade), break (crack crash crumble: wood splinters, metal tears; glass = the shatter words, earth = crumble).
   A material without a row keeps the kind's own words; the word's character (what LOOK draws from) still takes the material.
   FIRE takes `intensity` 1..5 (ember, flame, burning, blaze, inferno) or `stage` "ignite" | "out" (catching fire, put out): each a
   row of the fire table with its own flow style, "!" cap and stretch (the map's fire level picks the row; up = ignite, down = out).
   Rules are the banks' (2-4 words per tier, no diacritic, no dictionary or near word, every syllable reviewed); a hyphenated word in
   a table is one sound's sequence (KTOK-GDOK-KRAK) or the kind's own lead-in (KA-), never another sound's signature. */
export const MATS = ["stone", "wood", "metal", "earth", "water", "glass", "flesh", "shield"];
export const MATERIAL_ALIAS = { concrete: "stone", rock: "stone", brick: "stone", masonry: "stone", asphalt: "stone", tile: "stone",
  timber: "wood", plank: "wood", tree: "wood", door: "wood", furniture: "wood", steel: "metal", iron: "metal", car: "metal", vehicle: "metal",
  armor: "metal", armour: "metal", dirt: "earth", soil: "earth", sand: "earth", grass: "earth", ground: "earth", mud: "earth", snow: "earth",
  liquid: "water", sea: "water", river: "water", lake: "water", window: "glass", ice: "glass", crystal: "glass", body: "flesh", meat: "flesh",
  energy: "shield", forcefield: "shield", "force-field": "shield", barrier: "shield" };
/** the material of a call (`material`: one of MATS or an alias) or null */
export function materialOf(m) { const x = String(m ?? "").toLowerCase().trim(); return MATS.includes(x) ? x : MATERIAL_ALIAS[x] ?? null; }
/* the character a material gives the word (LOOK reads character.material / metal / wet / hard / texture) */
export const MAT_CHAR = { stone: { material: "stone", hard: 1, metal: 0, wet: 0, texture: "jagged" }, wood: { material: "wood", hard: 0.7, metal: 0, wet: 0, texture: "crisp" },
  metal: { material: "metal", hard: 1, metal: 1, wet: 0, texture: "ringing" }, earth: { material: "stone", hard: 0.3, metal: 0, wet: 0, texture: "gritty" },
  water: { material: "water", hard: 0.1, metal: 0, wet: 1, texture: "bubbly" }, glass: { material: "glass", hard: 1, metal: 0.2, wet: 0, texture: "jagged" },
  flesh: { material: "flesh", hard: 0.3, metal: 0, wet: 0.5, texture: "smooth" }, shield: { material: "energy", hard: 0.5, metal: 0.3, electric: 0.8, wet: 0, texture: "ringing" } };
/* PIECES (debris): the size of what comes down picks the tier (small grit and shards, medium bricks and planks, large slabs and beams);
   without it the loudness does. A number 0..1 works as well. */
export const PIECES = { small: "s", tiny: "s", medium: "m", large: "l", big: "l", huge: "l", s: "s", m: "m", l: "l" };
export function piecesOf(p) { if ( Number.isFinite(p) ) return p < 0.34 ? "s" : p < 0.67 ? "m" : "l"; return PIECES[String(p ?? "").toLowerCase()] ?? null; }
/* the fire ladder */
export const FIRE_LEVELS = { ember: 1, flame: 2, burning: 3, blaze: 4, inferno: 5 };
export const FIRE_STAGES = ["ignite", "out"];
export function intensityOf(x) { if ( Number.isFinite(x) ) return Math.max(1, Math.min(5, Math.round(x))); return FIRE_LEVELS[String(x ?? "").toLowerCase()] ?? null; }
/* the variant tables. A string instead of words = that kind's own bank (break on glass = the shatter words) */
export const VARIANTS = {
  en: {
    impact: {
      stone:  B("PTAK|TKAK", "KRAKT|PTAKT", "KRAKK-KRRK|KRAKKT"),
      wood:   B("THOK|TWOK", "KTOKK|GDOKK", "KTOKK-KRRK|GDOKK-KRAK"),
      metal:  B("TNNK|KTANG", "KTANNG|TSANNG", "SKRANNGG|KTRANNG"),
      earth:  B("PFUT|TFUMF", "PFUMF|KFUMF", "GWUMFF|BWUMFF"),
      water:  B("TSIPP|PSIP", "PSHLIP|TSHLUP", "SHPLOOMP|PSHLOOMP"),
      glass:  B("TKSS|TSIK", "PTISSK|KTISSK", "KTISSHK|SKRISSHK"),
      flesh:  B("THK|TWUK", "SHTUK|TWUKK", "THUKSH|SHWUKKSH"),
      shield: B("BWOMM|VWOMM", "VWONNG|ZWONNG", "VWONNGG|ZWAONNGG")
    },
    debris: {
      stone:  B("TK-TK-KTK|TKK-TK", "KTOK-GDOK-KRAK|KTAK-GDOK-TK", "GDOOM-KRRK-DOMF|GDOMF-KRAK-GDOMF", "TK-TK-KTK"),
      wood:   B("KTOK-TK-KTOK|TK-KTOK", "KLOKATA-KTOK|KTOKATA-KTOK", "KRRAK-BDOKK|KRRAK-BDOKK-KTOK", "KTOK-TK-KTOK"),
      metal:  B("TNK-TNNG-TK|TNK-TK-TNK", "KTANG-KLANGATA|KTANG-TNK-KTANG", "GDANNG-SKRREEE|GDANNG-KLANGATA-TNK", "TNK-TNNG-TK"),
      earth:  B("PF-PFT-FUMF|PFT-PF", "FUMF-PFUT-SHHH|PFUT-FUMF", "GWUMF-FSSSHHH|GWUMF-PFUT-FSSHH", "PF-PFT-PF"),
      water:  B("PLIP-PLIP-BLUP|PLIP-BLUP", "SHPLA-PLIP-PLIP|PLIP-BLUP-PLIP", "SHPLUMP-PLIP-PLIP|BLUP-SHPLUMP-PLIP", "PLIP-PLIP-BLUP"),
      glass:  B("TSS-TSIK-TSS|TSIK-TSS", "KSSIK-TSIKKA-TSIK|TSIKKA-TSIK", "KRISSHATA-TSIK|SKRISH-TSIKKA-TSIK", "TSS-TSIK-TSS")
    },
    struck: {
      stone:  B("TKAK|KRAKT", "THWAKRAK|SKRAKT", "KA-SKRAKKT|THWAKRAKK"),
      wood:   B("THOK|GDOK", "TWOKK|KTOKK", "TWOKKT|KA-TWOKK"),
      metal:  B("KTANG|TSANG", "PAKANNG|KWANNG", "SKRAANNGG|KA-KWANNG"),
      earth:  B("TFUMF|PFUMF", "THWUMF|KFUMF", "GWUMMF|KA-THWUMF"),
      water:  B("BLAPSH|TSHLAP", "SPLUMPSH|PLOOMSH", "KA-SPLOOSH|SPLOOMPSH"),
      glass:  B("TKISH|PAKSH", "PAKSSH|KRISSHK", "THWAKRISSH|PAKRISSHK"),
      flesh:  B("THUKSH|TWUKSH", "THWAKSH|WHAMSH", "THWAAKSH|KA-WHAMSH"),
      shield: B("BWOMM|VWOMM", "VWONNG|ZWONNG", "VWONNGG|KA-VWONNG")
    },
    blast: {
      stone:  B("SKRAKOM|KRAKOMF", "KRA-KOOM|SKRRAKOOM", "KA-SKRRAKOOM|SKRRAKOOMM"),
      wood:   B("KRROKOM|BDOKOM", "KRRAKOKOOM|BDOKOOM", "KA-KRRAKOKOOM|BDOKOOMM"),
      metal:  B("BWANGOM|KLANGOM", "BWANNGOOM|KLANGOOM", "KA-BWANNGOOM|BWANNGOOMM"),
      earth:  B("FUMFOM|PFUMFOM", "FWUMFOOM|GWUMFOOM", "KA-FWUMFOOM|FWUMFOOMM"),
      water:  B("PLOOMSH|SHPLOOM", "BWOOSHPLOOM|SHPLOOOM", "KA-BWOOSHPLOOM|SHPLOOMM"),
      glass:  B("KSHRAKOM|TSKRAKOM", "KSSHRAKOOM|KSHRAKOOM", "KA-KSSHRAKOOM|KSSHRAKOOMM")
    },
    break: {
      wood:   B("KRKK|KRRKT", "SKRRAKKT|SPRAKKT", "KRRIKSPRAKK|SKRRAKSPRAK"),
      metal:  B("SHRRAP|SKRRANK", "SHRRRAPT|SKRRINNK", "SKRRREEENK|SHKRRAANNK"),
      glass:  "shatter",
      earth:  "crumble"
    },
    fire: {
      1:      B("TSIK…|TS-TSIK", "TSIK-TS|TSIK-TSIK", "TS-TSIK-TSIK|TSIKKA-TSIK", "TS-TSIK-TS"),
      2:      B("FUFF|FWUH…", "FWUFF|FHUUF", "FWUUFF|FHWUUF"),
      3:      B("FWRR|KRITZ-FWRR", "FWRRR|KRITZ-FWRR-KRAK", "FWRRRR-KRAK|KRITZ-FWRRRR-KRAK"),
      4:      B("FWOORR|HWRROSH", "FWOOORRR|HWRROOOSH", "HWRROOOOSH|FAWOOORRR"),
      5:      B("GWRROOM|GHRROOM", "GWRROOOMM|GHRROOOMM", "GWRROOOOMMM|GHRROOOOMMM"),
      ignite: B("FWUF|FUWOF", "FWOOFF|PFWOOFF", "FAWOOFF|KA-FWOOFF"),
      out:    B("TSSS…|FSSST…", "FSSSHHT…|TSSSHHT…", "PSSSHHH…|PFSSSHHT…")
    }
  },
  pl: {
    impact: {
      stone:  B("KTAK|TKAK", "KRAKT|SKRAKT", "KRAKK-KRRK|KTRAKK"),
      wood:   B("TWOK|KTOK", "KTOKK|TWOKK", "TWOKK-KRRK|KTOKK-KRAK"),
      metal:  B("TNNK|PTANG", "KTANNG|PTANNG", "SKRANNGG|KTRANNG"),
      earth:  B("PFUT|TFUMF", "PFUMF|BFUMF", "GWUMFF|KFUMFF"),
      water:  B("TSIPP|PSIP", "PSZLIP|TSZLUP", "SZPLUUMP|PSZLUUMP"),
      glass:  B("TKSS|TSIK", "KTISSK|TKISSK", "KTISZK|SKRISZK"),
      flesh:  B("TWUK|GWUK", "TWUKSZ|SZWUKK", "TWUKKSZ|SZWUKKSZ"),
      shield: B("WZOMM|BWUMM", "WZONNG|WZANNG", "WZONNGG|WZAONNGG")
    },
    debris: {
      stone:  B("TK-TK-KTK|TKK-TK", "KTOK-GDOK-KRAK|KTAK-GDOK-TK", "GDUUM-KRRK-DUMF|GDUMF-KRAK-GDUMF", "TK-TK-KTK"),
      wood:   B("KTOK-TK-KTOK|TK-KTOK", "KLOKATA-KTOK|KTOKATA-KTOK", "KRRAK-BDOKK|KRRAK-BDOKK-KTOK", "KTOK-TK-KTOK"),
      metal:  B("TNK-TNNG-TK|TNK-TK-TNK", "KTANG-KLANKATA|KTANG-TNK-KTANG", "GDANNG-SKRRIII|GDANNG-KLANKATA-TNK", "TNK-TNNG-TK"),
      earth:  B("PF-PFT-FUMF|PFT-PF", "FUMF-PFUT-SSSZ|PFUT-FUMF", "GWUMF-FSSSSZ|GWUMF-PFUT-FSSZ", "PF-PFT-PF"),
      water:  B("PLIP-PLIP-PLUP|PLIP-PLUP", "SZPLA-PLIP-PLIP|PLIP-PLUP-PLIP", "SZPLUMP-PLIP-PLIP|PLUP-SZPLUMP-PLIP", "PLIP-PLIP-PLUP"),
      glass:  B("TSS-TSIK-TSS|TSIK-TSS", "KSSIK-TSIKKA-TSIK|TSIKKA-TSIK", "KRISZATA-TSIK|SKRISZ-TSIKKA-TSIK", "TSS-TSIK-TSS")
    },
    struck: {
      stone:  B("TKAK|KRAKT", "TWAKRAK|SKRAKT", "KA-SKRAKKT|TWAKRAKK"),
      wood:   B("TWOK|KTOK", "TWOKK|KTOKK", "TWOKKT|KA-TWOKK"),
      metal:  B("KTANG|PTANNG", "PAKANNG|KTANNG", "SKRAANNGG|KA-PAKANNG"),
      earth:  B("TUMF|PFUMF", "TWUMF|KFUMF", "GWUMMF|KA-TWUMF"),
      water:  B("PLAPSZ|BLAPSZ", "SPLUMPSZ|PLUUMSZ", "KA-SPLOOSZ|SPLUUUMSZ"),
      glass:  B("TKISZ|PAKSZ", "PAKSSZ|KRISZK", "TWAKRISZ|PAKRISZK"),
      flesh:  B("TWUKSZ|TWAPSZ", "TWAKSZ|BAMSZ", "TWAAKSZ|KA-BAMSZ"),
      shield: B("WZOMM|BWUMM", "WZONNG|WZANNG", "WZONNGG|KA-WZONNG")
    },
    blast: {
      stone:  B("SKRAKUM|KRAKUMF", "KRRAKUUM|SKRRAKUUM", "KA-SKRRAKUUM|SKRRAKUUMM"),
      wood:   B("KRROKUM|BDOKUM", "KRRAKOKUUM|BDOKUUM", "KA-KRRAKOKUUM|BDOKUUMM"),
      metal:  B("BWANGUM|KLANKUM", "BWANNGUUM|KLANKUUM", "KA-BWANNGUUM|BWANNGUUMM"),
      earth:  B("FUMFUM|PFUMFUM", "FWUMFUUM|GWUMFUUM", "KA-FWUMFUUM|FWUMFUUMM"),
      water:  B("PLUUMSZ|SZPLUUM", "BWUUSZPLUUM|SZPLUUUM", "KA-BWUUSZPLUUM|SZPLUUMM"),
      glass:  B("KSZRAKUM|TSKRAKUM", "KSSZRAKUUM|KSZRAKUUM", "KA-KSSZRAKUUM|KSZRAKUUMM")
    },
    break: {
      wood:   B("KRKK|KRRKT", "SKRRAKKT|SPRAKKT", "KRRIKSPRAKK|SKRRAKSPRAK"),
      metal:  B("SZRRIP|KRRINK", "HRRRAPT|SKRRINNK", "SKRRRIIINK|SZKRRAANNK"),
      glass:  "shatter",
      earth:  "crumble"
    },
    fire: {
      1:      B("TSYK…|TS-TSYK", "TSYK-TS|TSYK-TSYK", "TS-TSYK-TSYK|TSYKKA-TSYK", "TS-TSYK-TS"),
      2:      B("FUF|FWUH…", "FWUFF|FHUUF", "FWUUFF|FHWUUF"),
      3:      B("FWRR|KRIT-FWRR", "FWRRR|KRIT-FWRR-KRAK", "FWRRRR-KRAK|KRIT-FWRRRR-KRAK"),
      4:      B("FWUURR|HWRUSZ", "FWUUURRR|HWRRUUUSZ", "HWRRUUUUSZ|FAWUUURRR"),
      5:      B("GWRRUUM|HRRWUUM", "GWRRUUUMM|HRRWUUUMM", "GWRRUUUUMMM|HRRWUUUUMMM"),
      ignite: B("FWUF|FUWUF", "FWUUFF|PFWUUFF", "FAWUUFF|KA-FWUUFF"),
      out:    B("TSSS…|FSSST…", "FSSSZT…|TSSSZT…", "PSSSZ…|PFSSSZT…")
    }
  }
};
/* which kinds take which table */
/* WORDS3 (2026-11-14): the owner's ruling "BOOM / BUM only for a blast WITH fire" (EFFECTS1 answer 3; thunder: «zmienić»). Only the
   kinds named here may letter BOOM / BUM (any stretch, any lead-in); every other kind, its variant rows, prefixes and flows never do
   (check-words.mjs section 21). The fireless blast is KROOM / KRUUM (concussion), a hero landing THOOM / DUUM, a cave-in BTHOOM /
   BDUUM, thunder KRAKOOM / KRA-KA-GRRAWOOM. Add a kind here only when it is a blast with fire. */
export const FIRE_BLASTS = ["boom"];
export const VARY = { impact: ["impact"], debris: ["debris"], struck: ["punch", "smash", "slap", "thud"], blast: ["boom"], break: ["crack", "crash", "crumble"], fire: ["fire"] };
for ( const [table, ids] of Object.entries(VARY) ) for ( const id of ids ) KINDS[id].vary = table;
KINDS.debris.sized = true;
/* a fire row behaves like its own sound: ember ticks (percussive, never "!"), a quiet steady flame, a crackling fire, a blaze in
   gusts, an inferno's drone (long runs); catching fire swells, put out fades with no "!" */
export const VARIANT_META = { fire: {
  1: { perc: true, repeat: "last", maxBangs: 0, flow: "crackle", env: "beat", hold: ["V"] },
  2: { maxBangs: 1, flow: "steady", env: "fade", hold: ["V", "H", "F"] },
  3: { flow: "crackle", env: "swell", hold: ["R", "V"] },
  4: { flow: "gust", env: "swell", hold: ["V", "R", "S"] },
  5: { flow: "drone", env: "swell", hold: ["V", "R", "M"], run: 10 },
  ignite: { env: "swell", hold: ["V", "F"] },
  out: { maxBangs: 0, flow: "steady", env: "fade", hold: ["S", "H", "Z"], run: 10 }
} };
/* ---------- TAILS: the twin of PREFIXES. A sound's OWN aftermath, each with its reason: what follows it by itself (the wave and the
   falling debris after a blast, the tinkle after glass, the casings after a burst, the chips knocked off a wall). `t` ms after the sound
   starts, `rel` its loudness against the sound's, `place` where it belongs (source, target, ring, around, feet), `skip` materials where
   it does not happen. L.vocab.tails(kind, o) lists them; L.chain(kind, { tails: true }) letters them in order. ---------- */
export const TAILS = {
  boom:      [{ kind: "shockwave", t: 60, rel: 0.75, place: "ring", why: "the pressure wave rolls out of every blast" },
              { kind: "debris", t: 450, rel: 0.55, place: "around", why: "what the blast threw up comes down" }],
  grenade:   [{ kind: "whizz", t: 150, rel: 0.5, place: "around", why: "a frag grenade's shrapnel flies past" },
              { kind: "debris", t: 450, rel: 0.35, pieces: "small", place: "around", why: "grit and small stones thrown by the grenade land" }],
  concussion:[{ kind: "shockwave", t: 50, rel: 0.8, place: "ring", why: "a blast without fire is mostly its pressure wave" },
              { kind: "debris", t: 420, rel: 0.5, place: "around", why: "what the blast threw up comes down" }],
  sonicboom: [{ kind: "shockwave", t: 90, rel: 0.7, place: "ring", why: "the sonic boom's front passes over as a wave" }],
  crash:     [{ kind: "debris", t: 350, rel: 0.6, place: "around", why: "a collapse ends in falling rubble" }],
  smash:     [{ kind: "debris", t: 300, rel: 0.45, pieces: "small", place: "around", why: "a smashed thing sheds pieces" }],
  shatter:   [{ kind: "debris", t: 200, rel: 0.45, material: "glass", pieces: "small", place: "around", why: "broken glass tinkles down" }],
  crumble:   [{ kind: "debris", t: 300, rel: 0.4, pieces: "small", place: "around", why: "crumbling masonry trickles down" }],
  impact:    [{ kind: "debris", t: 120, rel: 0.35, pieces: "small", place: "target", skip: ["water", "flesh", "shield"], why: "a hit knocks chips off what it hits" }],
  gunfire:   [{ kind: "casings", t: 150, rel: 0.4, place: "feet", why: "spent casings ring on the ground under the gun" }],
  minigun:   [{ kind: "casings", t: 200, rel: 0.45, place: "feet", why: "a stream of spent casings pours from the gun" }],
  rifle:     [{ kind: "casings", t: 350, rel: 0.3, place: "feet", why: "the spent casing ejected after the shot" }],
  pistol:    [{ kind: "casings", t: 250, rel: 0.3, place: "feet", why: "the spent casing ejected after the shot" }]
};
/* ---------- CHAINS: an event told in order (the owner: the lettering tells the story of the event by tempo and character: it builds,
   peaks, develops and resolves). Each step: kind, t (ms from the start), rel (loudness against the chain's), role (build | peak | develop
   | resolve), place (source | target | ring | around | feet | bounce | behind: the caller maps each to a point with `places`), and any
   word option (material, pieces, intensity, stage, long). L.chain(name | steps | kind, opts) letters one; L.vocab.chain plans one. */
export const ROLES = ["build", "peak", "develop", "resolve"];
export const PLACES = ["source", "target", "ring", "around", "feet", "bounce", "behind"];
export const CHAINS = {
  explosion: { why: "a blast on the map: the blast, its wave, then the debris coming down from big to small", steps: [
    { kind: "boom", t: 0, rel: 1, role: "peak", place: "source" },
    { kind: "shockwave", t: 60, rel: 0.75, role: "develop", place: "ring" },
    { kind: "debris", t: 420, rel: 0.6, pieces: "large", role: "develop", place: "around" },
    { kind: "debris", t: 760, rel: 0.45, pieces: "medium", role: "resolve", place: "around" },
    { kind: "debris", t: 1150, rel: 0.3, pieces: "small", role: "resolve", place: "around" }] },
  grenade: { why: "the pin, two bounces, the blast, its shrapnel, the grit coming down", steps: [
    { kind: "click", t: 0, rel: 0.25, role: "build", place: "source" },
    { kind: "impact", t: 500, rel: 0.3, role: "build", place: "bounce" },
    { kind: "impact", t: 760, rel: 0.25, role: "build", place: "bounce" },
    { kind: "grenade", t: 1000, rel: 1, role: "peak", place: "target" },
    { kind: "whizz", t: 1150, rel: 0.5, role: "develop", place: "around" },
    { kind: "debris", t: 1450, rel: 0.35, pieces: "small", role: "resolve", place: "around" }] },
  collapse: { why: "a wall or a building gives way: the warning crumble, the crash, the rubble settling from big to small", steps: [
    { kind: "crumble", t: 0, rel: 0.5, role: "build", place: "source" },
    { kind: "crash", t: 500, rel: 1, role: "peak", place: "source" },
    { kind: "debris", t: 900, rel: 0.65, pieces: "large", role: "develop", place: "around" },
    { kind: "debris", t: 1300, rel: 0.45, pieces: "medium", role: "resolve", place: "around" },
    { kind: "debris", t: 1800, rel: 0.3, pieces: "small", role: "resolve", place: "around" }] },
  sonicboom: { why: "a flier passing the sound barrier: the approach, the double crack, the wave", steps: [
    { kind: "zoom", t: 0, rel: 0.5, role: "build", place: "source" },
    { kind: "sonicboom", t: 300, rel: 1, role: "peak", place: "source" },
    { kind: "shockwave", t: 400, rel: 0.7, role: "develop", place: "ring" }] },
  shot: { why: "one shot: the report at the muzzle, the impact at the target by its material", steps: [
    { kind: "pistol", t: 0, rel: 1, role: "peak", place: "source" },
    { kind: "impact", t: 80, rel: 0.55, role: "resolve", place: "target" }] },
  miss: { why: "a missed shot: the report, the bullet passing the target, the impact on what is behind it", steps: [
    { kind: "pistol", t: 0, rel: 1, role: "peak", place: "source" },
    { kind: "whizz", t: 60, rel: 0.5, role: "develop", place: "target" },
    { kind: "impact", t: 160, rel: 0.45, role: "resolve", place: "behind" }] },
  burst: { why: "a burst of fire: the rattle at the muzzle, impacts at the target, casings at the shooter's feet", steps: [
    { kind: "gunfire", t: 0, rel: 1, role: "peak", place: "source" },
    { kind: "impact", t: 100, rel: 0.5, role: "develop", place: "target" },
    { kind: "casings", t: 180, rel: 0.35, role: "resolve", place: "feet" }] },
  ignite: { why: "a fire catching and growing to a blaze", steps: [
    { kind: "fire", stage: "ignite", t: 0, rel: 0.7, role: "build", place: "source" },
    { kind: "fire", intensity: 2, t: 450, rel: 0.5, role: "build", place: "source" },
    { kind: "fire", intensity: 3, t: 1200, rel: 0.65, role: "develop", place: "source" },
    { kind: "fire", intensity: 4, t: 2200, rel: 1, role: "peak", place: "source" }] },
  fireout: { why: "a fire put out: it sinks, hisses, and leaves embers", steps: [
    { kind: "fire", intensity: 3, t: 0, rel: 1, role: "peak", place: "source" },
    { kind: "fire", intensity: 2, t: 900, rel: 0.6, role: "develop", place: "source" },
    { kind: "fire", stage: "out", t: 1700, rel: 0.55, role: "resolve", place: "source" },
    { kind: "fire", intensity: 1, t: 2700, rel: 0.3, role: "resolve", place: "source" }] }
};
/* the keys of a chain step that are word options or step data (the rest of a step goes to L.play) */
export const STEP_KEYS = ["kind", "t", "rel", "loud", "long", "role", "place", "why", "material", "pieces", "intensity", "stage", "template", "prefix", "bangs", "skip"];

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
/** normalise a word for the engine: NFC, Polish upper case, one line, single spaces */
export const clean = (t) => String(t ?? "").normalize("NFC").toLocaleUpperCase("pl").replace(/\s+/g, " ").trim();
/* ONLY ONOMATOPOEIA (the user's rule, 2026-11-13): every word must imitate the sound itself, never a noun, verb or other word
   that names a sound ("CHRZĘST" names a crunch; it is not one).
   NO DICTIONARY WORDS (the user's ruling, 2026-11-13: "wiele z nich to po prostu słowa ... ciach to słowo"): a sound word must not be
   a word of the language at all, not even an imitative interjection from the dictionary (CIACH, TRZASK, PLUSK, BĘC, CRACK, SPLASH),
   nor an ordinary word that happens to look like a sound (BRAM, GROCH, DOOM, BROOM). It is BUILT from the sound in the comic's
   manner: an attack, a lasting part, a cut-off (a blade: SZSZT, FSZSZT, SWISZK; a blow: TWOOM, WRAMM, SKROOSHH).
   DICT = the deny list, checked on the whole word and on every syllable with repeated letters collapsed (CIAACH -> CIACH).
   Short function syllables (TA, DA, NA, TO, A, I) are not on it: a gun's TA-TA-TA is not a pronoun.
   ICONIC = the short, explicit exception list ("jako wyjątek, bo są ikoniczne i dobrze brzmią"): classic comic sounds kept although
   they are dictionary words; every one has a reason; the user rules on this list. check-words.mjs keeps every other dictionary word
   out of the banks, stream syllables, flows and prefixes; add() refuses them. NAMING is the old name of DICT (kept for callers). */
export const DICT = {
  pl: [
    "ACH", "AHA", "AJ", "AJAJ", "AŁA", "AU", "AUĆ", "BACH", "BAM", "BĘC", "BIM", "BOM", "BRR", "BRUM", "BRZDĄK", "BRZDĘK",
    "BUCH", "BUM", "BUMS", "BZIK", "BZYK", "CHLAP", "CHLAST", "CHLUP", "CHLUST", "CHRUP", "CHRUM", "CHRZĘST", "CIACH", "CII",
    "CIT", "CMOK", "CYK", "CYT", "DING", "DONG", "DRYŃ", "DZYŃ", "DZYŃDZYŃ", "ECH", "EJ", "FIU", "FRR", "FRU", "HA", "HAU",
    "HE", "HEJ", "HI", "HM", "HOP", "HOPSA", "HU", "HURA", "HYC", "JUHU", "JUPI", "KAP", "KLAP", "KLAPS", "KLIK", "KŁAP",
    "KUKU", "ŁUBU", "ŁUBUDU", "ŁUP", "MIAU", "MLASK", "MU", "OCH", "OJ", "OJEJ", "PAC", "PAF", "PIF", "PIFPAF", "PIK",
    "PLASK", "PLUM", "PLUSK", "PRASK", "PRAST", "PST", "PSTRYK", "PUF", "PUK", "SZAST", "SZUR", "ŚWIST", "ŚMIG", "TIK",
    "TIKTAK", "TRACH", "TRZASK", "TRZESZCZ", "TRZEŚ", "TUP", "UCH", "UF", "UPS", "WIO", "ZGRZYT", "SKRZYP", "SYK", "HUK",
    "ŁOMOT", "ŁOSKOT", "SZUM", "SZELEST", "BRZĘK", "PISK", "GWIZD", "JĘK", "KRZYK", "ŚMIECH", "WRZASK", "GRZMOT", "WYBUCH",
    "STRZAŁ", "KRACH", "SKOK", "STUKOT", "TUPOT", "BULGOT", "CHLUPOT", "STUK", "TAK", "JEST", "NIE", "DOBRA", "BIJ", "BUJ",
    "PUFF", "PŁASK", "KLEKS", "KWIK", "GDAK", "KWA", "BEE", "MEE", "IHAA", "PRR", "SZSZ", "PSYK", "TFU", "FE", "BLE", "BUU",
    "BRAM", "BRAK", "KRAN", "TRAM", "GRAM", "DRAM", "KRAJ", "GRAD", "BRUD", "TRUP", "KRUK", "DRUK", "GRUBY", "GRUZ", "BRAT",
    "BRAĆ", "PRAĆ", "KRAĆ", "TRAF", "TROP", "DRAP", "GRAB", "KRAB", "KRUP", "KRAM", "KIT", "KLIP", "FLET", "DRON", "GROM",
    "RAM", "RAN", "RUM", "KROK", "SKRA", "TYP", "PIT", "DUMA", "BUDA", "DOM", "DYM", "TUM", "TOM", "DUP", "BUT", "KOT",
    "KOK", "KUK", "TUK", "TOK", "BOK", "BAK", "PAK", "KIP", "TIP", "DŁUG", "GŁUP", "TŁUM", "BRUK", "MIAŁ", "PSIK", "KICZ",
    "SYCZ", "GRA", "GRY", "GROCH", "KRY", "FOCH", "PUCH", "PRAŁ", "TRYK", "SZTUK", "PSU", "TLA", "WRON", "GRON", "BROM",
    "TY", "WY", "BY", "NIM", "DRAN", "BRON"
  ],
  en: [
    "BANG", "BOOM", "POW", "THUD", "WHAM", "ZAP", "BAM", "CRASH", "SMASH", "SPLASH", "CRUNCH", "CRACK", "SNAP", "SLAP",
    "SLASH", "CLICK", "POP", "HISS", "WHOOSH", "SWISH", "SWOOSH", "THUMP", "STOMP", "CHOMP", "DRIP", "DROP", "FIZZ",
    "FIZZLE", "SQUISH", "SQUELCH", "ZOOM", "CLANG", "CLINK", "CLANK", "CLUNK", "CLACK", "CLOCK", "WHIFF", "HUFF", "PUFF",
    "SMACK", "SPLAT", "BEEP", "BLEEP", "HUP", "TROMP", "BONK", "BOING", "THWACK", "WHACK", "KNOCK", "TAP", "RAP", "BLIP",
    "PING", "DING", "DONG", "TING", "TINK", "TWANG", "ZING", "ZIP", "VROOM", "PLAT", "PLASH", "SWASH", "FROM", "WHO", "SHOO",
    "SHE", "FEE", "CHAMP", "BOOK", "SWOOP", "VIP", "ZOON", "FROSH", "HEW", "HOOF", "SNIT", "SNITCH", "RAM", "RAN", "BRR",
    "GRR", "ARGH", "UGH", "OUCH", "OW", "OOF", "PHEW", "WHEW", "AHA", "HA", "HAH", "HEH", "HEE", "HO", "HOH", "HUH", "HMM",
    "HM", "SHH", "SHUSH", "PSST", "PST", "TSK", "OOPS", "YES", "YEAH", "WOW", "YAY", "YIPPEE", "WOOHOO", "HOORAY", "YAHOO",
    "PLOP", "PLONK", "THUNK", "SPLOSH", "SLOSH", "WHIZ", "WHIZZ", "WHIRR", "WHIR", "BUZZ", "HUM", "PURR", "ROAR", "GROWL",
    "HOWL", "CREAK", "SQUEAK", "SCRAPE", "CRUMBLE", "RUMBLE", "TINKLE", "JINGLE", "CRACKLE", "SIZZLE", "SPUTTER", "WHIP",
    "BLAST", "BURST", "KICK", "PUNCH", "HIT", "SOCK", "BIFF", "BOP", "CHUG", "GLUG", "GULP", "BURP", "SNORT", "SNORE", "SOB",
    "SIGH", "GASP", "GROAN", "MOAN", "WAIL", "SCREAM", "SHRIEK", "GIGGLE", "CHUCKLE", "LAUGH", "CHEER", "BLARE", "HONK",
    "TOOT", "CHIRP", "TWEET", "SPLUTTER", "PEW", "BAA", "BOO", "DOOM", "BROOM", "ROOM", "GLOOM", "BLOOM", "VOOM", "WHOMP",
    "WHUMP", "THWOMP", "BLAM", "BRAP", "DRAG", "BRAG", "CRAG", "GRAB", "CRAB", "SCRAP", "STRAP", "STROP", "STUMP", "TRAMP",
    "DUMP", "DAMP", "BUMP", "JUMP", "LUMP", "PUMP", "RUMP", "SLUMP", "WOMP", "CHOP", "SHOP", "SHOCK", "SHACK", "SHAM",
    "SHIM", "SWIM", "SWAM", "WHIM", "DRUM", "DRAM", "TRAM", "CRAM", "SCRAM", "SCAM", "SLAM", "CLAM", "GRAM", "PRAM", "SHIP",
    "SKIP", "SCREECH", "SCRITCH", "SCRATCH", "CRICK", "TRICK", "BRICK", "PRICK", "TICK", "LICK", "SLICK", "FLICK", "FLASH",
    "FLESH", "PLUSH", "BLUSH", "BRUSH", "CRUSH", "GUSH", "HUSH", "MUSH", "RUSH", "SLUSH", "FLUSH", "WHOOP", "HOOP", "LOOP",
    "POOP", "HOOT", "SHOOT", "BOOT", "ROOT", "FOOT", "SOOT", "ZOOT", "GOAT", "BOAT", "LOOM", "WOMB", "TOMB", "BOMB", "COMB",
    "PLINK", "PLUNK", "DUNK", "BUNK", "SKUNK", "FUNK", "JUNK", "HUNK", "SPUNK", "CHUNK", "TRUNK", "DRUNK", "SHRUNK", "SUNK",
    "STUNK", "DUB", "DUMB", "DUN", "DUD", "BUD", "MUD", "CUD", "SPUD", "STUD", "SCUD", "GLUM", "GUM", "SUM", "YUM", "RUM",
    "TUM", "CHUM", "PLUM", "SLUM", "SCUM", "STRUM", "THRUM", "BRUM", "WEE", "WOO", "WAH", "YAH", "HAY", "HEY", "HOY", "OY",
    "OH", "AH", "EH", "UH", "UM", "ER", "TAT", "RAT", "BAT", "CAT", "FAT", "HAT", "MAT", "PAT", "SAT", "VAT", "CHAT", "BRAT",
    "DRAT", "GNAT", "SPAT", "FLAT", "SLAT", "THAT", "WHAT", "MEOW", "MEW", "MIAOW", "WOOF", "ARF", "BARK", "YAP", "YIP",
    "HASH", "SIS", "PANG", "BONG", "BOSH", "SHANK", "PROW", "GROW", "TWIT", "CHEEP", "NEIGH", "TRUMP", "HAIL", "RAIN",
    "PATTER", "DRILL", "WHIRL", "WHEE", "NEE", "NAH", "WOOT", "KAPOW", "ACH", "BRA", "BROW", "FOP", "HOW", "PONG", "POM",
    "TROW", "WHEN", "WHOM", "WOE", "PAM", "FA", "MI", "GROOM", "BROOK", "CROOK", "POOT", "POT", "TOT", "BOT"
  ]
};
/* the review (2026-11-13, section 0 A and the unfortunate readings): plain words found in the old banks, and words a sound must
   never read as */
DICT.pl.push("PTAK", "FACH", "BRACH", "TRIK", "TRAK", "TUF", "GIN", "WRYL", "PRUL", "SPI", "SWING", "PING", "LAL", "MRU", "CHE", "FU",
  "FIK", "GRO", "NEF", "KROM", "CISZA", "GRUPA", "GRUSZA", "KUFA", "FUCHA", "PUPA", "FLASZA", "DRAKA", "BROSZA", "PACHA", "BRYT",
  "KRUSZ", "KRZYCZ", "GRYZ", "PLASK", "KLAPS", "SZAST", "SWIST", "SZUM", "BRZDEK", "BRZEK", "BRUM", "FIU", "MIAU", "HAU", "AUC",
  "BANG", "KAKA", "FUK", "KURWA", "CHUJ", "HUJ", "PIZDA", "JEB", "DUPA", "KUTAS", "CIPA", "SRA", "SZMATA", "KAL", "GOWNO",
  "PLUSK", "CHLUST", "CHLAP", "TRZASK", "ZGRZYT", "SKRZYP", "KLAK", "KLIK", "TIK", "TAK", "BRZDAK", "DZWIEK", "STUK", "PUK",
  "BULGOT", "SPLOT", "PLOT", "SKOK", "SKRAJ", "GRAM", "DRUM", "PROM", "BRAMA",
  "KRAM", "BOMBA", "TAKT", "TEKST", "PUNKT", "BLASK", "WRZASK", "PISK", "KLANG");
DICT.en.push("DOING", "BOINK", "BRUNCH", "SPLOTCH", "FEW", "TROOP", "TROP", "KLICK", "KLIK", "GROK", "DONK", "TAKA",
  "YEOW", "HOOAH", "EEP", "THEE", "SHEESH", "CLIT", "COCK", "DICK", "SHIT", "FUCK", "DAMN", "PISS", "TWAT", "CUNT", "PRICK",
  "KOOK", "TWERP", "PEW", "PLINK", "SPLASH", "SPLISH", "SPLOOSH", "PLUNK", "CHUNK", "CLUNK", "CHINK", "CLINK", "TICK", "TOCK",
  "SKID", "SKIT", "SKUNK", "TRUNK", "STRUNK", "DRUNK", "SPANK", "SPRING", "TWANG", "TWING", "BROOK", "BLOCK",
  "CLOCK", "FLOCK", "SMOCK", "STOCK", "SHOCK", "CROCK", "FROCK", "WHIRR", "VROOM", "BEEP", "BLAM", "PLOP", "GRR", "HA", "HE");
export const NAMING = DICT;
/* ICONIC: the short explicit exception list (the owner's ruling: "jako wyjątek, bo są ikoniczne i dobrze brzmią"), each with its
   reason; raised to about 16 by the review (2026-11-13, provisional WORD2 questions): water, the comic gunshot, the beep, the engine,
   the laugh and the growl cannot be lettered without them. TRACH, BACH and CHLUP are NOT exceptions (dictionary interjections). */
export const ICONIC = {
  pl: {
    BUM: "the classic boom (BUM!, KA-BUM!), short and round",
    BAM: "the classic hit",
    PAF: "the classic shot / punch",
    SZSZ: "the Polish hush, also the only way to letter a steady rush of rain or air (SZSZSZ)",
    HA: "the laugh (HA-HA-HA): a laugh cannot be written otherwise",
    BANG: "the comic gunshot, read the same in Polish comics"
  },
  en: {
    POW: "the classic punch (the owner's example)",
    THUD: "the classic dull fall (the owner's example)",
    BAM: "the classic hit",
    BOOM: "the classic blast",
    BANG: "the classic gunshot",
    ZAP: "the classic electric shot",
    WHAM: "the classic heavy blow",
    SHH: "the classic hush; also the only way to letter a steady rush of rain or air (SHHHH)",
    PLOP: "the small drop into water (the owner's water family)",
    PLUNK: "the heavy drop into water (the owner's water family)",
    SPLOOSH: "the big splash (the owner's water family)",
    BLAM: "the real comic gunshot, more useful than BANG",
    BEEP: "the device beep: every built substitute (BWEEP, PWEEP) reads worse",
    VROOM: "the engine: every built substitute (VROON, ZROOM) reads worse",
    HA: "the laugh (HA-HA-HA): a laugh cannot be written otherwise",
    GRR: "the growl: a growl cannot be written otherwise"
  }
};
/* VOICE: the short voice list (the review, section 4, provisional WORD2 question): a laugh, a cry of pain or effort is an interjection
   by nature; these pass ONLY in the voice kinds (group "voice"), each with its reason */
export const VOICE = {
  pl: { HE: "a giggle (HE-HE-HE)", HI: "a high giggle (HI-HI-HI)", CHE: "a dry chuckle (CHE-CHE)", OCH: "a groan of effort or a sigh", UCH: "a sigh of relief or tiredness" },
  en: { HE: "a giggle (HE-HE-HE)", HEH: "a dry chuckle (HEH-HEH)", HO: "a deep laugh (HO-HO-HO)", ARGH: "a cry of pain", UGH: "a grunt of effort", OOF: "a blow to the body" }
};
/* ALLOW: built sounds that the near-dictionary refusal below would catch: the comic's K-respellings of a sound (the owner's own KRAK and
   FWOOOSH; provisional WORD2 question: allowed by explicit list) and a few built words that only happen to be one letter from a word */
export const ALLOW = {
  pl: {
    KRAK: "the owner's own example; the comic's crack",
    KLANK: "metal on metal, the comic's K-spelling",
    KRUNCZ: "the crunch, the comic's K-spelling in Polish letters",
    SKRAK: "a built crack (SK + RA + K), only one letter from SKRA",
    GLUP: "the owner's water family (a bubble going under), although it is one letter from GŁUP",
    PLUP: "the owner's water family (a small drop)",
    PLUMP: "the owner's water family (a heavy drop)",
    DZING: "the Polish comic chime (DZYN without its diacritic), one letter from the loan DING only",
    BLAM: "the comic gunshot read the same in Polish comics (iconic in English), one letter from BRAM only",
    KRUM: "the owner's fixed pick KRUUM for a blast without fire (2026-11-13), one vowel from the plain word KROM only"
  },
  en: {
    KRAK: "the owner's own example; the comic's crack",
    FWOOSH: "the owner's own example FWOOOSH",
    KROOSH: "the comic's crash (KA-KROOSH, the owner's example)",
    KRUNCH: "the comic's crunch",
    KLANK: "the comic's clank",
    KLANG: "the comic's clang",
    SKRAK: "a built crack (SK + RA + K)",
    SKREE: "the owner's own example SKREE-",
    KLAK: "the comic's clack of a switch or a latch",
    GLUB: "the owner's water family (a bubble)",
    SPLUMP: "the owner's water family (a heavy drop)",
    PLIP: "a single drip, one letter from the iconic PLOP",
    THWIP: "the classic snap of a bowstring or a web line",
    CHOOM: "the owner's own example CHOOM!! (a heavy energy blast)",
    SKROOM: "the owner's own example SKROOMM!! (a heavy smash), one vowel from SCRAM only"
  }
};
/* refused only as a whole word (also on DICT; kept for callers) */
export const NAMING_WORD = { pl: ["TAK", "JEST", "HEJ", "DOBRA", "NIE", "UPS"], en: ["YES", "YEAH", "NO", "MEH", "OOPS", "WOW"] };
/* ---------- the refusal: dictionary words, near-dictionary words, respellings (the review, rules 3 and 4) ----------
   Every form is compared in a CANONICAL spelling: diacritics stripped (sound words never have them, the deny list may), English
   respellings folded (CK -> K, C -> K, QU -> KW, WH -> HW, PH -> F: KRAK = CRACK, HWOOSH = WHOOSH), then:
   1. EXACT: a syllable or the whole word equals a denied word. Repeated letters are collapsed (CIAAACH -> CIACH), except for a denied
      word that is itself written with a double letter (BAA, BOOM, GRR, SHH): that one matches only the doubled spelling (runs capped at
      two), so BAA no longer blocks every BA (BA-DUM) and GRR no longer blocks every GRRRR-free HRRO (the collapse side effects).
   2. NEAR: a syllable or the whole word (4+ letters) one letter away from a denied word of 4+ letters as a reader sees it (near1
      below: PLOSK ~ PLUSK, TRZAK ~ TRZASK, BWEEP ~ BEEP, THUM ~ THUMP, DLIP ~ DRIP), or a denied 3-letter word with a K or T stuck on
      (DIKT ~ DICK). An ICONIC word with a cut-off added at its end (SZSZT) and the neighbours of the denied word an ALLOWed
      respelling stands for (KRAKT, KRRAKK next to CRACK = KRAK) are the comic's own family and pass; a letter changed or put inside an
      ICONIC word is still near (BWEEP ~ BEEP, BRANG ~ BANG).
   ICONIC passes everywhere, VOICE only in voice kinds, ALLOW passes the respelling and NEAR tests (not a literal dictionary word). */
const DIA = { "Ą": "A", "Ć": "C", "Ę": "E", "Ł": "L", "Ń": "N", "Ó": "O", "Ś": "S", "Ź": "Z", "Ż": "Z" };
export const DIACRITICS = /[ĄĆĘŁŃÓŚŹŻ]/u;
const strip = (s) => String(s).replace(/[ĄĆĘŁŃÓŚŹŻ]/gu, (c) => DIA[c]);
const fold = (s, L) => (L === "en" ? strip(s).replace(/CK/g, "K").replace(/QU/g, "KW").replace(/C(?!H)/g, "K").replace(/WH/g, "HW").replace(/PH/g, "F") : strip(s));
const cap2 = (s) => s.replace(/(\p{L})\1{2,}/gu, "$1$1");
const one = (s) => s.replace(/(\p{L})\1+/gu, "$1");
/* the syllables of a word, marks removed */
const sylls = (w) => clean(String(w).replace(/\+/g, "")).replace(/[!?…\x27.,:]/g, "").split(/[-\s]+/).filter(Boolean);
const syllablesFlat = (w) => sylls(w).map(one);
const flat = (x) => one(clean(x));
const CONS = /^[BCDFGHJKLMNPQRSTVWXZ]$/;
/* one letter away IN THE WAY A READER STILL SEES THE WORD (PLOSK = PLUSK, TRZAK = TRZASK, DLIP = DRIP, THUM = THUMP, SPLASK = PLASK):
   a vowel for a vowel (in a 4-letter word only one that sounds alike: KLYK = KLIK), R for L or a consonant for its voiced/voiceless
   twin, a letter dropped or added inside or at the end, an S stuck in front. A changed or added first letter reads as another word
   and is not "near" (WRAM is not TRAM, CZUM is not SZUM), nor is any other consonant swap (THWAP is not THWACK). */
const VOWELS = "AEIOUY", ALIKE = new Set(["IY", "YI", "OU", "UO", "RL", "LR", "PB", "BP", "TD", "DT", "KG", "GK", "FV", "VF", "FW", "WF", "SZ", "ZS"]);
function near1(a, b) {
  if ( a === b ) return true;
  const la = a.length, lb = b.length; if ( Math.abs(la - lb) > 1 ) return false;
  let i = 0; while ( i < la && i < lb && a[i] === b[i] ) i++;
  if ( la === lb ) {
    if ( a.slice(i + 1) !== b.slice(i + 1) || i === 0 ) return false;
    const x = a[i], y = b[i];
    if ( VOWELS.includes(x) && VOWELS.includes(y) ) return la >= 5 || ALIKE.has(x + y);   // a short word: only a vowel that sounds alike (KLYK = KLIK)
    return ALIKE.has(x + y);                                                              // R for L, a voiced for a voiceless twin
  }
  const [lo, sh] = la > lb ? [a, b] : [b, a];
  if ( lo.slice(i + 1) !== sh.slice(i) ) return false;
  return i > 0 || lo[0] === "S";
}
const TABLES = {};
function tables(L) {
  if ( TABLES[L] ) return TABLES[L];
  const keys = (o) => new Set(Object.keys(o ?? {}).map((k) => one(fold(k, L))));
  const icon = keys(ICONIC[L]);
  const single = new Set(), dbl = new Set(), long = [], longD = [], three = new Set(), raw = new Set();
  for ( const e of [...(DICT[L] ?? []), ...(NAMING_WORD[L] ?? [])] ) {
    const f = fold(clean(e), L), c1 = one(f), c2 = cap2(f);
    raw.add(one(clean(e)));
    if ( c1 !== c2 ) dbl.add(c2); else single.add(c1);
    if ( c1 !== c2 ) { if ( c2.length >= 4 ) longD.push(c2); }       // a doubled word is near only to its doubled spelling
    else if ( c1.length >= 4 ) long.push(c1); else if ( c1.length === 3 ) three.add(c1);
  }
  const allow = keys(ALLOW[L]);
  /* a denied word that an ALLOWed respelling stands for (CRACK for KRAK): its neighbours are the comic's family (KRAKT, KRRAKK) */
  const allowNear = new Set(long.filter((d) => allow.has(d)));
  return (TABLES[L] = { single, dbl, long, longD, three, raw, icon, voice: keys(VOICE[L]), allow, allowNear });
}
/** why a form (a syllable, or the syllables joined) is refused: { why: "word" | "near", like } | null */
function refuse(x, L, T) {
  const f = fold(x, L), c1 = one(f), c2 = cap2(f);
  const exact = T.single.has(c1) || T.dbl.has(c2);
  if ( exact && T.raw.has(one(x)) ) return { why: "word", like: c1 };   // literally a dictionary word (never allowed)
  if ( T.allow.has(c1) ) return null;
  if ( exact ) return { why: "word", like: c1 };                              // a respelling of one (KREEK, HWOOSH)
  if ( c2.length >= 4 ) for ( const d of T.longD ) if ( near1(c2, d) && !(T.icon.has(one(d)) && c2.startsWith(d)) ) return { why: "near", like: d };
  if ( c1.length >= 4 ) {
    for ( const d of T.long ) if ( near1(c1, d) && !T.allowNear.has(d) && !(T.icon.has(d) && c1.startsWith(d)) ) return { why: "near", like: d };
    const head = c1.slice(0, -1);
    if ( c1.length === 4 && T.three.has(head) && /[KT]/.test(c1.at(-1)) ) return { why: "near", like: head };
  }
  return null;
}
function check(word, lang, o = {}) {
  const langs = lang ? [lang] : Object.keys(DICT);
  const raw = sylls(word);
  if ( !raw.length ) return null;
  const group = o.group ?? KINDS[o.kind]?.group;
  for ( const L of langs ) {
    const T = tables(L), ok = (x) => { const c = one(fold(x, L)); return T.icon.has(c) || (group === "voice" && T.voice.has(c)); };
    const whole = raw.join("");
    if ( ok(whole) || raw.every(ok) ) continue;                       // HA-HA-HA, SHHH-SHHHHH: iconic syllables only
    if ( raw.length > 1 ) { const r = refuse(whole, L, T); if ( r ) return { part: raw.map(one).join("-"), ...r }; }
    for ( const x of raw ) if ( !ok(x) ) { const r = refuse(x, L, T); if ( r ) return { part: one(x), ...r }; }
  }
  return null;
}
/** is this a dictionary word or a near-dictionary word (not a built onomatopoeia)? -> the offending part or null. Checks the whole
    word (syllables joined) and every syllable. o.kind / o.group: the voice list passes in voice kinds. */
export function naming(word, lang = null, o = {}) { return check(word, lang, o)?.part ?? null; }
/** can the word be SAID (the review, rule 12, 13)? -> what is wrong, or null. Per syllable: no Polish diacritic; English never "II"
    (a long i is EE); a doubled letter may open a syllable only when it lasts (SSST, MMM, RRMM; never VVRT, WWI, HHY); a syllable with
    a vowel has no consonant pile of 5+ letters, no plosive-R/L-plosive (KRKAK, KRCH) and no three plosives in a row; a syllable without
    a vowel is one clear lasting sound with at most two letters before and after it (BZZT, PSST, HMM, GRRMM, NNGH, PFFT, CHK). */
export function sayable(word, lang = "en") {
  for ( const raw of sylls(word) ) {
    if ( DIACRITICS.test(raw) ) return `${raw}: a Polish diacritic`;
    if ( lang === "en" && /II/.test(raw) ) return `${raw}: II (English writes a long i as EE)`;
    const lead = raw.match(/^(\p{L})\1/u);
    if ( lead && !/[SZRMNFAEIOUY]/.test(lead[1]) ) return `${raw}: opens with a doubled ${lead[1]}`;
    const c = one(raw);
    if ( /[AEIOUY]/.test(c) ) {
      for ( const pile of c.split(/[AEIOUY]+/) ) {
        if ( pile.length >= 5 ) return `${raw}: consonant pile ${pile}`;
        if ( /[BDGKPT][RL][BCDGKPT]/.test(pile) ) return `${raw}: ${pile} cannot be said`;
        if ( /[BDGKPT]{3}/.test(pile) ) return `${raw}: three plosives ${pile}`;
      }
    } else if ( !/^(?:CZ|SZ|SH|TS|[BCDFGHKPTVWS]){0,2}[RMNSZFH]{1,3}(?:CH|[KTPGH]){0,2}$/.test(c) && !/^[BCDFGHKNPST]{2,4}$/.test(c) ) return `${raw}: no vowel and no one clear lasting sound`;
  }
  return null;
}
/** the same refusal, with its reason, for sheets and checks: { part, why: "word" | "near" } or null */
export function refusal(word, lang, o = {}) { return check(word, lang, o); }
/** is every character of the word lettered by every font? (beyond this pure set, check.mjs proves it per font) */
export const renderable = (t) => { const w = clean(t).replace(/\+/g, ""); return w.length > 0 && w.length <= MAX_LEN + 8 && RENDERABLE.test(w); };

/* ---------- WHERE a word stretches (the user's question: which letters to repeat so the word describes the sound) ----------
   A sound has an ATTACK (its start: plosives K T P B D G C, the "K" of KRAK), a SUSTAIN (what lasts) and a CUTOFF (its end: the "K"
   of KRAK, the "T" of BZZT). Comic letterers lengthen only the sustain: BOOOOM (the resonance), BZZZZT (the buzz), GRRRR (the growl),
   SSSS (the hiss), HMMMM (the hum), FFFUUU (the air); never the attack or the cutoff (no KKKRAK, no BOOMMM-as-a-bang). So every
   letter belongs to a sustain CLASS and every sound kind lists, in order, which classes are its sustain:
     V vowels (A E I O U Y)         resonance, ringing, voice, open boom     R  rolling, growl, engine, grinding, rasp
     Z buzz (Z, the Z of RZ)        electricity, insects, energy            S  hiss (S; Polish SZ as an S run: SSSSZ; English SH -> SHHH)
     M hum (M N, the N of NG)       drone, charge, mind, the tail of a boom  F  air (F; W only at a syllable's end after a vowel: POOWW)
     H  breath (H, the H of CH)     no diacritic letter is in any class (sound words have none)
   The stretch goes to the LAST run of the first listed class found in the word's LAST syllable (a prefix KA- or a first TRA- never
   stretches), up to MAX_RUN letters; what does not fit spills only FORWARD into the run right after it when that run is also one of
   the kind's classes (up to SPILL_RUN: BUUUMMM), never backward. Letters outside every class
   (plosives, affricates CZ DZ, L J) never repeat. A word with none of its kind's classes falls back to V R Z S M F H.
   A "+" in a CALLER's word (L.vocab.add) still marks an explicit stretch point and wins over the rule; the built-in banks have no "+". */
/* the review (2026-11-13, rule 1): sound words have NO Polish diacritics, so no diacritic letter is a lasting class either */
export const CLASSES = { V: "AEIOUY", R: "R", Z: "Z", S: "S", M: "MN", F: "FW", H: "H" };
export const DEFAULT_HOLD = ["V", "R", "Z", "S", "M", "F", "H"];
/* digraphs. Polish SZ lengthens as an S run with one SZ at its end (SSSSZ: the review, rule 14), never SZSZSZ; English PH is not a
   lasting sound (the review, rule 5: PHAKK stretched to PFAAAAKK); English SH -> SHHH, NG -> NNNG */
const DIGRAPHS = { pl: { SZ: { cls: "S", rep: "S", tail: "Z" }, RZ: { cls: "Z", rep: "Z", lead: "R" }, CH: { cls: "H", rep: "H", lead: "C" }, CZ: { cls: null }, DZ: { cls: null } },
  en: { SH: { cls: "S", rep: "H", lead: "S" }, NG: { cls: "M", rep: "N", tail: "G" }, CH: { cls: null }, TH: { cls: null }, CK: { cls: null }, PH: { cls: null }, WH: { cls: null } } };
/** split a word into sound units (letters, or digraphs of the language) with their sustain class. W is a lasting letter only at the end
    of a syllable after a vowel (POOWW, BATOOWW: the review, rule 6), never THWWWIT or FWWWOOP. */
export function units(text, lang = "en") {
  const D = DIGRAPHS[lang] ?? DIGRAPHS.en, ch = [...String(text)], out = [];
  for ( let i = 0; i < ch.length; i++ ) {
    const two = ch[i] + (ch[i + 1] ?? "");
    if ( D[two] ) { out.push({ t: two, ...D[two], n: 1 }); i++; continue; }
    let cls = Object.entries(CLASSES).find(([, s]) => s.includes(ch[i]))?.[0] ?? null;
    if ( ch[i] === "W" ) {
      let j = i; while ( ch[j] === "W" ) j++;
      const end = j >= ch.length || /[^\p{L}]/u.test(ch[j]), afterVowel = i > 0 && CLASSES.V.includes(ch[i - 1]);
      if ( !(end && afterVowel) ) cls = null;
    }
    if ( lang === "en" && ch[i] === "I" ) cls = null;   // English short I is clipped and a long one is written EE (never SHNIIIK)
    out.push({ t: ch[i], cls, rep: ch[i], n: 1 });
  }
  /* merge repeats of one unit into a run (UUU, SZSZ) */
  const runs = [];
  for ( const u of out ) { const r = runs.at(-1); if ( r && r.t === u.t ) r.n++; else runs.push({ ...u }); }
  runs.forEach((r) => { r.n0 = r.n; });
  return runs;
}
const renderRun = (r) => {
  if ( !r.cls || r.rep === r.t ) return r.t.repeat(r.n);
  const n0 = r.n0 ?? r.n, add = Math.max(0, r.n - n0);
  if ( r.t === "SZ" ) return add ? "S".repeat(add + n0) + "Z" : "SZ".repeat(n0);  // SZ -> SSSSZ, a stretched SZSZ -> SSSSSZ
  if ( r.tail ) return r.rep.repeat(add) + r.t.repeat(n0);         // NG -> NNNG
  if ( r.lead != null && r.rep ) return r.t.repeat(n0) + r.rep.repeat(add);   // SH -> SHHH, RZ -> RZZZ, CH -> CHHH
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
export function stretchText(text, extra, hold = DEFAULT_HOLD, lang = "en", maxRun = MAX_RUN) {
  const pl = stretchPlan(text, extra, hold, lang, maxRun);
  return pl ? pl.runs.map(renderRun).join("") : String(text ?? "");
}
/** the stretch as sound units: { before, runs (after), last (first unit of the last syllable), target } or null (nothing to stretch);
    check-words.mjs proves the rule on it (which units grew). An EMPTY hold = a percussive sound: never stretched. */
export function stretchPlan(text, extra, hold = DEFAULT_HOLD, lang = "en", maxRun = MAX_RUN) {
  let n = Math.max(0, Math.min(MAX_EXTRA, Math.round(extra)));
  const t = String(text ?? "");
  if ( !n || /\d/.test(t) || (Array.isArray(hold) && !hold.length) ) return null;
  const runs = units(t, lang), before = runs.map((r) => ({ ...r }));
  let last = 0; runs.forEach((r, i) => { if ( r.t === "-" || r.t === " " ) last = i + 1; });
  /* the target: the last run of the first listed class in the last syllable; what does not fit spills only FORWARD into the run
     right after it when that run is also a listed sustain class (BUUUMMM, SZUUUMMM), never backward (no FFFSSS, no WWRRR) */
  const target = sustainOf(runs, last, hold);
  if ( target < 0 ) return null;
  const cap = (r, max) => (r.t === "SZ" ? max - 1 : max);
  const r = runs[target], nx = runs[target + 1];
  const tail = nx?.cls && nx.cls !== "V" && r.cls === "V" && hold.includes(nx.cls);
  /* the comic's manner: a ringing vowel followed by a continuant of the sound (M N W R S Z...) shares the stretch with it, one
     letter in three goes to the consonant (TWOOMM, BAAMM, POOWW: the hum or the air after the ring); otherwise only the overflow */
  const share = tail ? Math.floor(n / 3) : 0;
  const add = Math.max(0, Math.min(n - share, cap(r, maxRun) - r.n)); r.n += add; n -= add;
  if ( n > 0 && nx?.cls && hold.includes(nx.cls) ) nx.n += Math.max(0, Math.min(n, cap(nx, SPILL_RUN) - nx.n));
  return { before, runs, last, target };
}
/** stretch a template: a CALLER's "+" marks are explicit stretch points (shared stretch); without marks the sustain rule above */
export function expand(tpl, extra, hold = DEFAULT_HOLD, lang = "en", maxRun = MAX_RUN) {
  const marks = (tpl.match(/\+/g) ?? []).length;
  const total = Math.max(0, Math.min(MAX_EXTRA, Math.round(extra)));
  if ( !marks ) return total > 0 ? stretchText(tpl, total, hold, lang, maxRun) : tpl;
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
  return spill > 0 ? stretchText(out, spill, hold, lang, maxRun) : out;
}
/* ---------- the exclamation scale 0..2 (the user's rule: the number of "!" is part of how the word shows the sound; the comic
   grades them up to two: POW!  TWOOM!!  FWOOOSH!!) ----------
   0  quiet, or a soft sustained sound that is not loud (a hum, wind, a sigh, a pipe hissing)   SSSS   HMMM   UFF
   1  an ordinary sound, or a loud one with a soft onset                                          KRAK!  PAF!   POW!
   2  very loud with a sharp onset (the look review: "!!" only from about 0.85)                   BUUMM!! KRAKK!! SKRAMM!!
   loud < 0.25 -> 0; < 0.85 -> 1; else 2 when the onset is sharp (the kind's sharp >= 0.5) or the sound is at the very top (>= 0.95),
   else 1; one less for a soft onset (sharp < 0.35) or a long sound (long > 0.7) that is not loud (loud < 0.6). Then the kind's cap
   (maxBangs: kinds that are never loud, a sigh, a purr, a drip, never "!!"). A word ending in "…" trails off and keeps it (no "!").
   bangs: 0..2 forces (a larger number is 2; the kind's cap still holds). */
export const MAX_BANGS = 2;
export function bangsFor(loud, sharp, long, force = null, cap = MAX_BANGS) {
  const top = Math.max(0, Math.min(MAX_BANGS, Number.isFinite(cap) ? cap : MAX_BANGS));
  if ( Number.isFinite(force) ) return Math.max(0, Math.min(top, Math.round(force)));
  if ( loud < 0.25 ) return 0;
  let n = loud < 0.85 ? 1 : (sharp >= 0.5 || loud >= 0.95 ? 2 : 1);
  if ( sharp < 0.35 && loud < 0.6 ) n--;
  else if ( long > 0.7 && loud < 0.6 ) n--;
  return Math.max(0, Math.min(top, n));
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
export const capRuns = (t, max = MAX_RUN) => String(t).replace(new RegExp(`(\\p{L})\\1{${max},}`, "gu"), (m, c) => c.repeat(max));
/* the stretch classes of a kind (empty for a percussive kind: never stretched) and its longest run */
const holdOf = (k) => k?.stretchHold ?? k?.hold ?? DEFAULT_HOLD;
const runOf = (k) => k?.run ?? MAX_RUN;
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
   1 = the loud peak, ~0.55 = a quiet lead-in (a prefix KA-, the first syllables of a repeat), lower = a fading tail; spaces 0.
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
export const FLOW_STYLES = ["steady", "drone", "crackle", "gust", "cycle", "mix"];
export const FLOW = { hiss: "steady", shush: "steady", fizzle: "steady", psychic: "steady",
  engine: "drone", rumble: "drone", powerup: "drone", beam: "drone", thunder: "drone", zoom: "drone",
  fire: "crackle", crackle: "crackle", scrape: "crackle", zap: "crackle", crumble: "crackle", creak: "crackle",
  wind: "gust", whoosh: "gust", sigh: "gust",
  siren: "cycle", gunfire: "cycle", heartbeat: "cycle", laugh: "cycle", beep: "cycle", drip: "cycle", roar: "drone",
  purr: "steady", snakehiss: "steady", snarl: "drone", plane: "drone", minigun: "drone", rocket: "drone", trumpet: "gust",
  helicopter: "cycle", laserpistol: "cycle", bark: "cycle", squeak: "cycle", meow: "gust", reload: "cycle",
  ambulance: "cycle", police: "cycle", firetruck: "cycle", fastcar: "gust", clunker: "cycle", mech: "cycle", drill: "drone", hammer: "cycle",
  hail: "crackle", rain: "steady", storm: "mix", tornado: "mix",
  shockwave: "gust", debris: "crackle", casings: "cycle", dryfire: "cycle" };
/* composite sounds (mix): the parts a storm or a tornado is made of, the first is the bed, the others come and go */
export const MIX = { storm: ["rain", "wind", "thunder"], tornado: ["wind", "rumble", "crash"] };
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
     material one of MATERIALS: what makes the sound (stone wood glass metal water fire air flesh energy mind machine voice rubber animal)
     texture  one of TEXTURES: its surface (crisp jagged gritty smooth ringing billowy bubbly shaky)
   Per kind in CHAR below (hard heavy wet metal electric heat material texture); plain text gets the character of its mood. */
export const MATERIALS = ["stone", "wood", "glass", "metal", "water", "fire", "air", "flesh", "energy", "mind", "machine", "voice", "rubber", "animal"];
export const TEXTURES = ["crisp", "jagged", "gritty", "smooth", "ringing", "billowy", "bubbly", "shaky"];
const CHAR = {
  punch: ".7 .6 0 0 0 0 flesh crisp", smash: ".9 .9 0 .2 0 0 stone jagged", slap: ".4 .3 .1 0 0 0 flesh crisp",
  thud: ".4 .9 0 0 0 0 flesh smooth", stomp: ".7 .9 0 0 0 0 stone gritty", clang: "1 .6 0 1 0 0 metal ringing",
  slash: ".8 .3 0 .6 0 0 metal crisp", bite: ".7 .4 .3 0 0 0 flesh jagged",
  crack: "1 .4 0 0 0 0 stone jagged", shatter: "1 .3 0 .2 0 -.2 glass jagged", crash: ".9 1 0 .3 0 0 stone jagged",
  crumble: ".6 .7 0 0 0 0 stone gritty", rumble: ".5 1 0 0 0 0 stone shaky", creak: ".6 .4 0 0 0 0 wood gritty",
  scrape: ".8 .5 0 .6 0 .1 metal gritty",
  boom: ".6 1 0 0 0 .7 fire billowy", whump: ".3 .8 0 0 0 .2 air billowy", thunder: ".6 1 .1 0 .5 0 air shaky",
  zap: ".8 .2 0 .2 1 .2 energy jagged", beam: ".5 .4 0 0 .8 .4 energy smooth",
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
  laugh: ".3 .3 0 0 0 0 voice bubbly", shush: "0 .1 0 0 0 0 voice smooth", heartbeat: ".4 .6 .3 0 0 .2 flesh smooth",
  bark: ".4 .5 .1 0 0 0 animal gritty", snarl: ".5 .6 .2 0 0 .2 animal gritty", meow: ".1 .1 0 0 0 0 animal smooth",
  purr: "0 .2 0 0 0 .3 animal shaky", cathiss: ".3 .1 .1 0 0 0 animal jagged", squeak: ".2 0 0 0 0 0 animal crisp",
  snakehiss: ".1 .1 .1 0 0 -.2 animal smooth", trumpet: ".3 .9 0 .2 0 0 animal ringing",
  plane: ".4 .8 0 .6 0 .2 machine smooth", helicopter: ".5 .7 0 .6 0 0 machine shaky",
  pistol: "1 .3 0 .7 0 .3 metal crisp", rifle: "1 .45 0 .7 0 .3 metal jagged", shotgun: "1 .8 0 .6 0 .4 metal jagged",
  minigun: ".9 .7 0 .8 0 .5 machine shaky", blaster: ".8 .7 0 .2 .8 .6 energy jagged", laserpistol: ".5 .1 0 0 1 .3 energy crisp", silenced: ".6 .2 0 .5 0 0 metal smooth",
  sword: ".9 .4 0 1 0 0 metal ringing", arrow: ".5 .1 0 0 0 0 wood crisp", thrown: ".6 .3 0 .3 0 0 wood crisp",
  grenade: ".7 1 0 .3 0 .8 fire jagged", rocket: ".4 .7 0 .2 0 .9 fire billowy", reload: ".9 .2 0 1 0 0 machine crisp",
  ambulance: ".5 .4 0 .45 .5 0 machine smooth", police: ".5 .4 0 .4 .6 .1 machine smooth", firetruck: ".6 .6 0 .5 .4 .2 machine ringing",
  fastcar: ".6 .6 0 .7 0 .3 machine smooth", clunker: ".6 .6 0 .8 0 .1 machine shaky", mech: "1 1 0 1 .3 0 machine jagged",
  drill: ".8 .3 0 .8 .4 .2 machine gritty", hammer: "1 .5 0 .9 0 0 metal ringing", hail: ".7 .2 .4 0 0 -.6 water crisp",
  rain: "0 .3 1 0 0 -.3 water smooth", storm: ".5 1 .7 0 .5 -.2 air shaky", tornado: ".6 1 0 0 0 0 air billowy",
  shockwave: ".2 1 0 0 0 .3 air billowy", sonicboom: ".7 1 0 0 0 0 air shaky", concussion: ".7 1 0 0 0 0 stone billowy",
  impact: ".9 .5 0 .2 0 0 stone crisp", debris: ".8 .6 0 .2 0 0 stone gritty",
  whizz: ".6 .05 0 .4 0 0 metal smooth", casings: ".7 .05 0 1 0 .2 metal ringing", dryfire: ".8 .05 0 .6 0 0 machine crisp"
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
  hit: "punch smash slap thud stomp clang slash bite crack shatter crash boom thunder zap splash squish drip click teleport bounce chime pain cheer",
  swell: "rumble crumble powerup roar engine fire psychic effort",
  fade: "sigh fizzle whiff relief hiss shush whump",
  arc: "whoosh zoom ricochet wind beam scrape creak",
  beat: "gunfire laugh heartbeat beep siren crackle"
};
KIND_ENV.hit += " bark squeak pistol rifle shotgun blaster laserpistol silenced sword thrown grenade";
KIND_ENV.swell += " snarl trumpet minigun rocket";
KIND_ENV.fade += " cathiss snakehiss";
KIND_ENV.arc += " meow plane arrow";
KIND_ENV.beat += " purr helicopter reload ambulance police firetruck clunker mech hammer hail";
KIND_ENV.arc += " fastcar"; KIND_ENV.swell += " drill storm tornado"; KIND_ENV.fade += " rain";
KIND_ENV.hit += " sonicboom concussion impact dryfire"; KIND_ENV.arc += " shockwave whizz"; KIND_ENV.beat += " debris casings";   // KINDS1
for ( const [env, ids] of Object.entries(KIND_ENV) ) for ( const id of ids.split(" ") ) KINDS[id].env = env;
/** the envelope of a plain text's mood (callers that pass their own text: the engine's mood decides) */
export const MOOD_ENV = { impact: "hit", crack: "hit", crash: "hit", boom: "hit", zap: "hit", splash: "hit", pain: "hit", tick: "hit",
  roar: "swell", fire: "swell", powerup: "swell", whoosh: "arc", heal: "fade", fail: "fade" };
const r2 = (x) => Math.round(x * 100) / 100;
export function accentOf(text, o = {}) {
  const word = clean(text), chars = [...word];
  const k = o.kind ? KINDS[o.kind] : null;
  const env = o.env ?? k?.env ?? MOOD_ENV[o.mood] ?? "hit";
  const hold = o.hold ?? k?.hold ?? DEFAULT_HOLD, lang = o.lang === "pl" ? "pl" : "en";
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
    syl.slice(0, -1).forEach((s) => shape(s, 0.55, "hit"));                // lead-in syllables (a prefix KA-, the first syllables of a repeat)
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
  /* a kind's templates in a language, falling back tier -> neighbour tiers -> English; v = a variant row (KINDS1) instead of the bank */
  const ORDER = { s: ["s", "m", "l"], m: ["m", "s", "l"], l: ["l", "m", "s"], st: ["st"] };
  function listOf(id, lang, tier, v = null) {
    if ( v?.words ) { for ( const t of ORDER[tier] ) if ( v.words[t]?.length ) return { list: v.words[t], lang: v.lang, tier: t }; }
    for ( const L of [lang, "en"] ) { const b = bank[L]?.[id]; if ( !b ) continue; for ( const t of ORDER[tier] ) if ( b[t]?.length ) return { list: b[t], lang: L, tier: t }; }
    return { list: [], lang, tier };
  }
  /* KINDS1: the variant of a call: a material row (impact, debris, struck, blast, break) or a fire row (intensity, stage) ->
     { table, key, meta, words, lang } (words = a tier object in `lang`, or English when the language has no row) or null */
  function variantOf(id, o, lang) {
    const table = kinds[id]?.vary; if ( !table ) return null;
    const key = table === "fire" ? (FIRE_STAGES.includes(o.stage) ? o.stage : intensityOf(o.intensity)) : materialOf(o.material);
    if ( key == null ) return null;
    const rowOf = (L) => { const r = VARIANTS[L]?.[table]?.[key]; return typeof r === "string" ? bank[L]?.[r] : r; };
    const L = rowOf(lang) ? lang : rowOf("en") ? "en" : null;
    return L ? { table, key: String(key), meta: VARIANT_META[table]?.[key] ?? null, words: rowOf(L), lang: L } : null;
  }
  /* the kind as a variant row makes it behave (an ember is percussive, an inferno drones) */
  const effective = (k, meta) => (meta ? { ...k, ...meta, stretchHold: meta.perc ? [] : (meta.hold ?? k.stretchHold), hold: meta.hold ?? k.hold } : k);
  const keOf = (w) => { const k = kinds[w.kind] ?? {}; return effective(k, w.variant != null ? VARIANT_META[k.vary]?.[w.variant] ?? null : null); };
  /* the accent of a word's FINAL text (after stretch, prefix, "!"): word.accent / word.peak, sound.peak and play.accent */
  const withAccent = (w) => {
    const k = keOf(w);
    const a = accentOf(w.text, { env: k.env, hold: k.hold, lang: w.lang });
    const sound = { ...w.sound, peak: a.peak };
    const character = characterOf({ def: k, kind: w.kind, loud: w.loud, long: w.long, env: a.env, steady: w.style === "steady" });
    if ( w.material && MAT_CHAR[w.material] ) Object.assign(character, MAT_CHAR[w.material]);   // KINDS1: what is hit shows
    return Object.assign(w, { accent: a.accent, peak: a.peak, env: a.env, character, sound, play: { ...w.play, sound, accent: a.accent, character } });
  };
  const pickMotion = (k, R) => ({ in: R.pick(k.motion.in), holdKind: R.pick(k.motion.hold), out: R.pick(k.motion.out) });

  /** One word. o: { lang, loud | magnitude (how LOUD), long | duration (how LONG: separate from loudness), bangs (0..2, force the
      "!" count), seed, step (n-th repeat of the same sound: louder, longer), avoid (texts or templates to skip), template (pin a
      template), prefix (true / false / a string), stream (true: syllables for L.stream) }.
      -> { text, kind, lang, tier, loud, long, bangs, step, template, prefix, syllables?, mood, sound, motion, play, accent, peak, env, character }
      Loudness picks the tier (the word), the "!" count, the prefix and the size; duration alone decides how much the word stretches. */
  function word(kind, o = {}) {
    const id = kindOf(kind), lang = langOf(o.lang, langs());
    const v = variantOf(id, o, lang), k = effective(kinds[id], v?.meta), material = materialOf(o.material);
    const step = Math.max(0, Number.isFinite(o.step) ? Math.floor(o.step) : 0);
    const base = loudOf(o), loudEff = base + 0.15 * step, loud = clamp01(loudEff);
    /* duration: the caller's, else the kind's natural length (a crack is short, wind is long), a loud sound ringing a little longer */
    const asked = longOf(o);
    const long = clamp01((asked ?? clamp01(k.sound.long + 0.15 * (loud - 0.4))) + 0.12 * step);
    const seeded = o.seed != null;
    const R = rng(seeded ? `${o.seed}|${id}|${lang}` : (Math.random() * 4294967296) >>> 0);
    const tier = o.stream ? "st" : (k.sized && piecesOf(o.pieces)) || tierOf(loud);       // KINDS1: debris pieces pick the tier
    let { list, lang: usedLang, tier: usedTier } = listOf(id, lang, tier, v);
    if ( o.stream && !list.length ) ({ list, lang: usedLang, tier: usedTier } = listOf(id, lang, tierOf(loud), v));
    const avoid = new Set([...(o.avoid ?? [])].map((x) => clean(x)));
    const mem = `${id}|${usedLang}|${v?.key ?? ""}`;
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
    let text = capRuns(clean(expand(core, o.stream ? 0 : extra, holdOf(k), usedLang, runOf(k))), runOf(k));
    /* a percussive repeating sound lasts longer by MORE HITS (TOK-TOK -> TOK-TOK-TOK-TOK), never by a stretched vowel */
    if ( k.perc && k.repeat && !o.stream ) {
      const sy = core.split("-"), unit = k.repeat === "pair" && sy.length >= 2 ? sy.slice(-2).join("-") : sy.at(-1);   // a heartbeat adds BA-DUM, not DUM
      const more = Math.round(2 * Math.max(0, long - 0.3) / 0.7) / (unit.includes("-") ? 2 : 1);
      for ( let j = 0; j < more && (text + "-" + unit).length <= MAX_LEN; j++ ) text += "-" + unit;
    }
    /* prefix at the very top (a seeded coin), or when asked; never one that makes the final text a dictionary word (KA-POW = KAPOW) */
    const pres = k.pre?.[usedLang] ?? [];
    let wantPre = o.prefix === false ? false : (typeof o.prefix === "string" ? o.prefix : (o.prefix === true || (loudEff >= 0.92 && R.chance(0.5))) && pres.length ? R.pick(pres) : false);
    if ( wantPre && !o.stream && !text.includes("-") && typeof o.prefix !== "string" && naming(clean(wantPre) + text, usedLang, { group: k.group }) ) wantPre = false;
    let usedPre = null;
    if ( wantPre && !o.stream && !text.includes("-") ) { text = clean(wantPre) + text; usedPre = wantPre; }
    const bangs = o.stream ? 0 : (trails && !Number.isFinite(o.bangs) ? 0 : bangsFor(loud, k.sound.sharp, long, o.bangs, k.maxBangs));
    if ( !o.stream ) text += trails && !bangs ? "…" : "!".repeat(bangs);
    if ( !seeded ) { const r = recent.get(mem) ?? []; r.push(clean(tpl), text); while ( r.length > 4 ) r.shift(); recent.set(mem, r); }
    const sound = { ...k.sound, loud: Math.max(0.1, Math.min(1, 0.15 + 0.85 * loud)), long };
    const motion = pickMotion(k, R);
    const out = { text, kind: id, lang: usedLang, tier: usedTier, loud, long, bangs, step, template: tpl, prefix: usedPre, material, variant: v?.key ?? null, mood: k.mood, sound, motion,
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
    const k = keOf(first);
    const core0 = clean(first.template).replace(/[!?…]+$/, "");
    const pre0 = first.prefix ? [...clean(first.prefix)].length : 0;
    /* a percussive repeating sound may already have more hits than its template (a long one): grow from what was shown */
    let plain = k.perc && k.repeat ? first.text.replace(/[!?…]+$/, "") : (first.prefix ? clean(first.prefix) : "") + core0;
    const add0 = Math.max(0, [...first.text.replace(/[!?…]+$/, "")].length - pre0 - [...core0].length);
    for ( let i = 1; i < Math.max(1, n); i++ ) {
      const prev = out[i - 1];
      /* a repeating sound (gunfire, laughter, a siren) grows by one more syllable, not by longer letters: RA-TA -> RA-TA-TA */
      if ( k.repeat && o.grow !== "vary" && !/\s/.test(prev.text) ) {
        const end = (prev.text.match(/[!?…]*$/) ?? [""])[0], body = prev.text.slice(0, prev.text.length - end.length);
        const syls = clean(first.template).replace(/[!?…]+$/, "").split("-");
        const syl = syls.length === 1 ? syls[0] : k.repeat === "pair" && syls.at(-1) !== syls.at(-2) ? syls.slice(-2).join("-") : syls.at(-1);
        const grown = `${plain}-${syl}`;
        const tail = end || (i >= 2 && (k.maxBangs ?? MAX_BANGS) > 0 ? "!" : "");
        let next = capRuns(clean(stretchText(grown, add0 + i, holdOf(k), first.lang, runOf(k))), runOf(k)) + tail;
        if ( next.replace(/[!?…]/g, "").length > MAX_LEN ) next = clean(grown) + tail;   // one more syllable matters more than longer letters
        if ( next.replace(/[!?…]/g, "").length <= MAX_LEN ) { plain = grown; out.push(withAccent({ ...word(kind, { ...o, step: i, template: first.template }), text: next, prefix: null })); continue; }
      }
      if ( o.grow === "vary" ) {
        const w = word(kind, { ...o, seed: o.seed != null ? `${o.seed}:${i}` : undefined, step: i, avoid: [...(o.avoid ?? []), prev.template, prev.text] });
        if ( w.text === prev.text ) w.text = capRuns(clean(stretchText(w.text, 1, holdOf(k), w.lang, runOf(k))), runOf(k));
        if ( w.text === prev.text ) { const m = (w.text.match(/[!?…]*$/) ?? [""])[0]; w.text = `${w.text.slice(0, w.text.length - m.length).split("-").at(-1)}-${w.text}`; }
        out.push(withAccent(w)); continue;
      }
      /* stretch mode: each step is ONE notch more than the last (so a long escalation keeps growing instead of jumping to the
         ceiling): one more sustain letter; when the sustain is full, one more "!" (at most 2); then the prefix (from step 2 on,
         when the kind has one); then an echo of the plain word in front (KRAK-KRAAAAAK!!!). Never shorter, never the same twice. */
      const w = word(kind, { ...o, step: i, template: first.template, prefix: false });
      const hold = holdOf(k), maxB = Math.min(MAX_BANGS, k.maxBangs ?? MAX_BANGS);
      let pre = prev.prefix ? clean(prev.prefix) : "";
      const end = (prev.text.match(/[!?…]*$/) ?? [""])[0];
      let bangs = (end.match(/!/g) ?? []).length, body = prev.text.slice(pre.length, prev.text.length - end.length);
      const pres = k.pre?.[prev.lang] ?? [];
      let notch = false;
      const longer = capRuns(clean(stretchText(body, 1, hold, prev.lang, runOf(k))), runOf(k));
      const nextPre = !pre && i >= 2 && o.prefix !== false && pres.length ? clean(typeof o.prefix === "string" ? o.prefix : pres[i % pres.length]) : "";
      if ( nextPre && !body.includes("-") && !naming(nextPre + body, prev.lang, { group: k.group }) ) pre = nextPre;
      else if ( longer !== body ) body = longer;
      else if ( bangs < maxB ) { bangs++; notch = true; }
      else if ( `${pre}${core0}-${body}`.length <= MAX_LEN ) body = `${core0}-${body}`;
      if ( !notch && w.bangs > bangs ) bangs = Math.min(maxB, bangs + 1);
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
    const id = kindOf(kind), lang = langOf(o.lang, langs());
    const v = variantOf(id, o, lang), k = effective(kinds[id], v?.meta), material = materialOf(o.material);      // KINDS1: a material or fire row flows too
    const style = FLOW_STYLES.includes(o.style) ? o.style : (v?.meta?.flow ?? FLOW[id] ?? (k.repeat ? "cycle" : k.sound.long >= 0.6 ? "drone" : "crackle"));
    const seed = o.seed ?? ((Math.random() * 4294967296) >>> 0);
    const base = loudOf({ loud: o.loud ?? (style === "steady" ? 0.15 : undefined), magnitude: o.magnitude });
    const subs = {};
    const hold = holdOf(k), mr = runOf(k), phase = rng(`${seed}|phase`)() * 6.28;
    const S = (t, n) => capRuns(clean(stretchText(t, n, hold, lang, mr)), mr);
    const pool = (t) => { const b = v?.words ?? bank[lang]?.[id] ?? bank.en?.[id] ?? {}; return [...(b[t] ?? [])]; };
    const plainOf = (t) => clean(t).replace(/[!?…]+$/, "");
    /* a kind's "!" cap holds in its flow too (KINDS1: an ember never shouts) */
    const seg = (phase, i, text, loud, long, bangs, ms) => (Number.isFinite(k.maxBangs) && bangs > k.maxBangs ? seg0(phase, i, text.replace(/!+$/, "!".repeat(k.maxBangs)), loud, long, k.maxBangs, ms) : seg0(phase, i, text, loud, long, bangs, ms));
    const seg0 = (phase, i, text, loud, long, bangs, ms) => withAccent({ phase, i, t: 0, ms: Math.round(ms), text, kind: id, lang, loud, long, bangs, style, material, variant: v?.key ?? null,
      mood: k.mood, sound: { ...k.sound, loud: Math.max(0.1, Math.min(1, 0.15 + 0.85 * loud)), long },
      play: { mood: k.mood, in: k.motion.in[0], holdKind: k.motion.hold[0], out: k.motion.out[0], magnitude: Math.round(Math.max(0, (loud - 0.1) / 0.6) * 100) / 100 } });
    const end = (b, trail) => (b ? "!".repeat(b) : trail ? "…" : "");
    const body = (i) => {
      const R = rng(`${seed}|flow|${id}|${lang}|${i}`);
      const wave = Math.sin(i * 0.9 + phase);
      let fam = [...pool("m"), ...pool("s")].map(plainOf).filter((t) => !t.includes("-") || style === "cycle");
      if ( !fam.length ) fam = [...new Set([...pool("m"), ...pool("s")].map((t) => plainOf(t).split("-")[0]))];   // a kind of hits only (KRIT-KRAT): one hit
      const st = [...pool("st"), ...pool("s")].map(plainOf);
      if ( style === "mix" ) {
        /* a composite sound: the bed part most of the time, the other parts come in turns, now and then a peak */
        const parts = (MIX[id] ?? [id]).filter((x) => kinds[x]);
        const pick = parts.length < 2 ? parts[0] : i % 4 === 3 ? parts[1 + R.i(0, parts.length - 2)] : i % 2 ? parts[1] : parts[0];
        const sub = (subs[pick] ??= flow(pick, { lang, seed: `${seed}|${pick}`, loud: o.loud, magnitude: o.magnitude }));
        const x = sub.at(i);
        return withAccent({ ...x, phase: "body", i, of: id, part: pick, style: "mix" });
      }
      if ( style === "steady" ) {
        const loud = clamp01(base + 0.05 * wave);
        if ( i % 5 === 4 ) { const t = R.pick(st.filter((x) => x.length <= 6)) ?? R.pick(fam); return seg("body", i, t.split("-")[0], loud, 0.2, 0, 500); }
        const t = R.pick(fam.filter((x) => !x.includes("-"))) ?? fam[0];
        return seg("body", i, S(t, 3 + Math.round((mr > MAX_RUN ? 3 : 2) * (wave + 1))), loud, 1, 0, 1100 + 250 * wave);
      }
      if ( style === "drone" ) {
        const loud = clamp01(base + 0.18 * wave), t = fam[Math.floor(i / 3) % Math.max(1, fam.length)] ?? R.pick(fam);
        const bangs = wave > 0.85 && loud >= 0.45 ? 1 : 0;
        return seg("body", i, S(t, 1 + Math.round(2 * (wave + 1))) + end(bangs, false), loud, 0.6 + 0.4 * (wave + 1) / 2, bangs, 800 + 200 * wave);
      }
      if ( style === "gust" ) {
        const loud = clamp01(base + 0.25 * wave), t = R.pick(fam), crest = wave > 0.5, trough = wave < -0.5;
        const bangs = crest && loud >= 0.45 ? 1 : 0;
        return seg("body", i, S(t, crest ? 6 : trough ? 0 : 3) + end(bangs, trough), loud, crest ? 1 : 0.5, bangs, crest ? 1300 : 800);
      }
      if ( style === "cycle" ) {
        const unit = plainOf(R.pick(pool("m")) ?? id).split("-"), syl = k.repeat === "pair" && unit.length >= 2 ? unit.slice(-2).join("-") : unit.at(-1);
        const n = 2 + ((i * 7 + R.i(0, 2)) % 3), accent = R.chance(0.3) ? 1 : 0, loud = clamp01(base + (accent ? 0.2 : 0) + 0.08 * wave);
        let m = n, text;
        do { text = Array.from({ length: m }, () => syl).join("-"); m--; } while ( text.length > MAX_LEN - 1 && m >= 1 );
        return seg("body", i, text + end(accent, false), loud, 0.3, accent, 160 * text.split("-").length + 200);
      }
      /* crackle: even segments a quiet bed, odd ones 1-3 pops */
      /* (the review, rule 16: a short hit kind's bed is not a long stretched word; only a lasting sound stretches its bed) */
      if ( i % 2 === 0 ) { const t = R.pick(fam); return seg("body", i, S(t, k.sound.long >= 0.5 ? 2 + R.i(0, 2) : 0), clamp01(base - 0.1), k.sound.long >= 0.5 ? 0.8 : 0.3, 0, 700); }
      const pops = Array.from({ length: R.i(1, 3) }, () => R.pick(st).split("-")[0]).join("-"), loud = clamp01(base + R.f(0, 0.3));
      const bangs = loud >= 0.5 ? 1 : 0;
      return seg("body", i, pops + end(bangs, false), loud, 0.1, bangs, 300 + 120 * pops.split("-").length);
    };
    const cache = new Map();
    let first = null;   // the onset: the first body segment must not repeat it either
    const at = (i) => {
      if ( cache.has(i) ) return cache.get(i);
      const s0 = body(i), prev = i > 0 ? at(i - 1) : first;
      if ( prev && prev.text === s0.text ) {
        const m = (s0.text.match(/[!?…]*$/) ?? [""])[0], core = s0.text.slice(0, s0.text.length - m.length);
        const alt = S(core, 1);
        /* the same text twice: one sustain letter more, else one less, else the neighbour word of the family */
        const less = core.replace(/(\p{L})\1{2,}/u, (r) => r.slice(1));
        let other = alt !== core ? alt : less !== core ? less : null;
        for ( let j = 1; other == null && j <= 6; j++ ) { const x = body(i + 1000 * j).text.replace(/[!?…]+$/, ""); if ( x !== core ) other = x; }
        s0.text = (other ?? `${core.split("-").at(-1)}-${core}`) + m;
        withAccent(s0);
      }
      cache.set(i, s0); if ( cache.size > 64 ) cache.delete(cache.keys().next().value);
      return s0;
    };
    const w0 = word(id, { lang, seed: `${seed}|onset`, loud: clamp01(base + 0.15), long: 0.3, prefix: false, material: o.material, intensity: o.intensity, stage: o.stage });
    const onset = seg("onset", -1, w0.text, w0.loud, w0.long, w0.bangs, 450);
    first = onset;
    const t0 = plainOf(R0(seed).pick(pool("s")) ?? w0.template);
    const tail = seg("tail", -1, S(t0, 3) + "…", clamp01(base * 0.6), 1, 0, 900);
    function take(ms = o.duration ?? 4000) {
      const out = [{ ...onset, t: 0 }]; let t = onset.ms;
      for ( let i = 0; t < ms - tail.ms || i < 1; i++ ) { const s1 = at(i); out.push({ ...s1, t }); t += s1.ms; if ( i > 2000 ) break; }
      out.push({ ...tail, t });
      /* the onset and the tail never repeat their neighbour either */
      for ( const j of [1, out.length - 1] ) if ( out[j] && out[j].text === out[j - 1].text ) {
        const m = (out[j].text.match(/[!?…]*$/) ?? [""])[0], core = out[j].text.slice(0, out[j].text.length - m.length);
        const alt = S(core, 1);
        out[j] = withAccent({ ...out[j], text: (alt !== core ? alt : core.replace(/(\p{L})\1+/u, (r) => r.slice(1))) + m });
      }
      return out;
    }
    return { kind: id, lang, style, material, variant: v?.key ?? null, onset, tail, at, take };
  }
  /** KINDS1: a sound's own aftermath (TAILS) for a call: [{ kind, t, rel, place, why, material, pieces? }] (skipped where it does not happen) */
  function tails(kind, o = {}) {
    const id = kindOf(kind), mat = materialOf(o.material);
    return (TAILS[id] ?? []).filter((x) => !(mat && x.skip?.includes(mat))).map(({ skip, ...x }) => ({ ...x, material: x.material ?? o.material ?? null }));
  }
  /** KINDS1: an event told in order. spec: a CHAINS name ("explosion", "grenade", "collapse", "sonicboom", "shot", "miss", "burst",
      "ignite", "fireout"), an array of steps ({ kind, t, rel | loud, role, place, material, pieces, intensity, stage, long, ...play
      options }), or one kind (that sound and its TAILS). o: { lang, seed, loud | magnitude (the chain's loudness: a step's loud = rel x
      it), tempo (2 = twice as fast), material (the default of every step), tails (true: each step's TAILS too) }.
      -> [{ i, t, kind, role, place, why, tailOf, word, play }] sorted by t (play = the step's own L.play options). Pure and seeded. */
  function chain(spec, o = {}) {
    const one = typeof spec === "string" && !CHAINS[spec];
    let steps = Array.isArray(spec) ? spec.map((s) => (typeof s === "string" ? { kind: s } : { ...s }))
      : typeof spec === "string" && CHAINS[spec] ? CHAINS[spec].steps.map((s) => ({ ...s }))
      : Array.isArray(spec?.steps) ? spec.steps.map((s) => ({ ...s }))
      : spec != null ? [{ kind: String(spec), t: 0, rel: 1, role: "peak", place: "source" }] : [];
    if ( o.tails === true || (one && o.tails !== false) ) steps = steps.flatMap((s) => [s, ...tails(s.kind, { material: s.material ?? o.material })
      .map((x) => ({ ...x, t: (s.t ?? 0) + x.t, rel: (s.rel ?? 1) * x.rel, role: x.t >= 300 ? "resolve" : "develop", tailOf: kindOf(s.kind) }))]);
    const tempo = Number.isFinite(o.tempo) && o.tempo > 0 ? o.tempo : 1, base = loudOf(o);
    const order = steps.map((s, i) => ({ s, i, t: Math.max(0, Math.round((Number.isFinite(s.t) ? s.t : 0) / tempo)) })).sort((a, b) => a.t - b.t || a.i - b.i);
    let prev = null;
    return order.map(({ s, i, t }) => {
      const loud = clamp01(Number.isFinite(s.loud) ? s.loud : base * (Number.isFinite(s.rel) ? s.rel : 1));
      const make = (n) => word(s.kind, { lang: o.lang, seed: o.seed != null ? `${o.seed}|chain|${i}${n ? `|${n}` : ""}` : undefined, loud, long: s.long, material: s.material ?? o.material,
        pieces: s.pieces, intensity: s.intensity, stage: s.stage, template: s.template, prefix: s.prefix, bangs: s.bangs });
      let w = make(0);
      for ( let n = 1; n < 6 && prev && w.text === prev && s.template == null; n++ ) w = make(n);   // two bounces in a row are two different words
      prev = w.text;
      const play = Object.fromEntries(Object.entries(s).filter(([key]) => !STEP_KEYS.includes(key) && key !== "tailOf"));
      return { i, t, kind: w.kind, role: ROLES.includes(s.role) ? s.role : null,
        place: PLACES.includes(s.place) ? s.place : "source", why: s.why ?? null, tailOf: s.tailOf ?? null, word: w, play };
    });
  }
  /** KINDS1: the variant rows of a kind in a language, for sheets and pickers: { table, rows: { key: { s, m, l, st, from? } } } or null */
  function variants(kind, lang = "en") {
    const id = kindOf(kind), table = kinds[id]?.vary; if ( !table ) return null;
    const L = VARIANTS[lang] ? lang : "en", rows = {};
    for ( const [key, r] of Object.entries(VARIANTS[L][table] ?? {}) ) { const b = typeof r === "string" ? bank[L]?.[r] : r; if ( b ) rows[key] = { s: [...b.s], m: [...b.m], l: [...b.l], st: [...(b.st ?? [])], ...(typeof r === "string" ? { from: r } : {}) }; }
    return { table, rows };
  }
  const R0 = (seed) => rng(`${seed}|tail`);
  /** grow a caller's own text for the n-th repeat (MOVE): its "+" marks, else its sustain (o.kind's classes, else V R Z S M F H) */
  const grow = (text, step = 1, o = {}) => { const k = o.kind ? kinds[kindOf(o.kind)] : null; return capRuns(clean(expand(String(text).normalize("NFC").toLocaleUpperCase("pl"), Math.max(0, step) * (o.per ?? 1), k ? holdOf(k) : DEFAULT_HOLD, langOf(o.lang, langs()), runOf(k))), runOf(k)); };
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
      if ( !renderable(t) || t.replace(/\+/g, "").length > MAX_LEN || DIACRITICS.test(t) || naming(t, DICT[L] ? L : null, { group: kinds[id]?.group }) ) { refused.push(String(w)); return; }
      (cur[tier] ??= []); if ( !cur[tier].includes(t) ) cur[tier].push(t);
    };
    if ( Array.isArray(words) ) {
      const sorted = [...words].sort((a, b) => clean(a).length - clean(b).length);
      sorted.forEach((w, i) => put(sorted.length < 3 ? "m" : (["s", "m", "l"][Math.min(2, Math.floor((3 * i) / sorted.length))]), w));
    } else for ( const t of ["s", "m", "l", "st"] ) for ( const w of words?.[t] ?? [] ) put(t, w);
    B0[id] = cur;
    if ( refused.length ) warn(`refused:${L}:${id}:${refused.join()}`, `refused words for ${L}/${id} (characters the fonts cannot letter, longer than ${MAX_LEN}, a Polish diacritic, or a dictionary or near-dictionary word): ${refused.join(", ")}`);
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

  return { word, series, flow, grow, syllables, add, define, remove, list, all, choices, reset, kindOf, langs, tails, chain, variants,
    hitMaterials: MATS, fireLevels: FIRE_LEVELS, chains: Object.keys(CHAINS),
    number: formatNumber, range: formatRange, stretch: stretchText, expand, renderable, naming, bangs: bangsFor, accent, character, envs: ENVS, materials: MATERIALS, textures: TEXTURES, groups: GROUPS, classes: CLASSES,
    get kinds() { return Object.keys(kinds); }, get aliases() { return Object.fromEntries(alias); } };
}
