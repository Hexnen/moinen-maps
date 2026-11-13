/* LETR vocabulary (WORD): from a sound kind, a loudness and a language to a fitting comic onomatopoeia. Pure: no DOM, no Foundry.
   The engine letters any text it is handed; this layer only DECIDES the text (and the mood / sound / motion that fit it):
     const w = L.word("crack", { loud: 0.8, lang: "pl", seed });     // -> { text: "SKRAAASK!", mood: "crack", sound, play, ... }
     L.play(w.text, { ...w.play, space: "world", at });              // or simply: L.sfx("crack", { loud: 0.8, space: "world", at })
   Plain text keeps working exactly as before: L.play("KRAK!", ...) never goes through this file.

   Words: our own, BUILT from the sound (attack + lasting part + cut-off), never a dictionary word (DICT below; the short ICONIC list
   is the exception): EN in the American comic manner (THWAK, FWOOSH, SKROOMM), PL written the Polish way (SZSZT, ŚWISZK, DZĘNK,
   KRCHUSZ, WZUUSZ). Template marks:
     "+" after a letter = a stretch point: the louder the sound, the more of that letter (SKRA+SK -> SKRASK / SKRAAASK); several marks
         share the stretch. A template without "+" is stretched on its last vowel (or its trailing R/S/Z/H/M/F run) when needed.
     "-" joins syllables (KA-BUM, TRA-TA-TA); streams split on it.
   Tiers: s (quiet: loud < 0.34), m (normal), l (loud: >= 0.67). On top of the tier: stretch grows with loudness; at the very top a
   prefix (the sound's own lead-in, PREFIXES: KA-BUM, TRZA-KRUSZ) may be added; quiet words drop their "!". */
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
  whump:   K("blast", "podmuch", "whump", "boom", { sharp: 0.15, long: 0.45, pitch: -0.7, rough: 0.4 }, { in: ["grow"], hold: ["throb"], out: ["dissolve"] }, 2, null, ["gust", "shockwave", "pressure", "airblast"]),
  thunder: K("blast", "grzmot", "thunder", "boom", { sharp: 0.7, long: 0.8, pitch: -0.4, rough: 0.8 }, { in: ["slam", "crackIn"], hold: ["rattle", "shake"], out: ["burst", "fall"] }, 3, null, ["lightning-strike"]),
  zap:     K("blast", "porażenie", "zap", "zap", { sharp: 1, long: 0.3, pitch: 0.3, rough: 0.5 }, { in: ["pop"], hold: ["buzz"], out: ["dissolve"] }, 2, null, ["electric", "electricity", "lightning", "shock", "spark"]),
  beam:    K("blast", "promień", "beam", "zap", { sharp: 0.8, long: 0.6, pitch: 0.4, rough: 0.3 }, { in: ["zip", "pop"], hold: ["buzz"], out: ["zipout", "dissolve"] }, 3, null, ["laser", "energy", "ray", "eyebeam"]),
  gunshot: K("blast", "strzał", "gunshot", "impact", { sharp: 0.9, long: 0.15, pitch: 0.1, rough: 0.4 }, { in: ["slam"], hold: ["shake"], out: ["pop"] }, 1, null, ["gun", "shot"]),
  gunfire: K("blast", "seria", "gunfire", "impact", { sharp: 0.9, long: 0.5, pitch: 0, rough: 0.5 }, { in: ["slam"], hold: ["shake", "rattle"], out: ["pop"] }, 2, null, ["burst", "autofire", "machinegun", "machine-gun", "rattle"]),
  ricochet:K("blast", "rykoszet", "ricochet", "whoosh", { sharp: 0.85, long: 0.6, pitch: 0.6, rough: 0.2 }, { in: ["zip", "pop"], hold: ["boil"], out: ["zipout"] }, 3, null, ["deflect", "bounce-off"]),
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
  pistol:    K("weapon", "pistolet", "pistol", "impact", { sharp: 0.95, long: 0.1, pitch: 0.2, rough: 0.3 }, { in: ["slam", "pop"], hold: ["shake"], out: ["pop"] }, 1, null, ["handgun", "revolver"]),
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
for ( const id of ["gunfire", "laugh", "drip", "stomp", "beep", "bark", "squeak", "helicopter", "reload", "clunker", "mech", "hammer", "hail"] ) KINDS[id].repeat = "last";     // one more of the last syllable
for ( const id of ["siren", "heartbeat", "ambulance", "police", "firetruck"] ) KINDS[id].repeat = "pair";                              // one more WEE-OO / BA-DUM
/* the SUSTAIN of each sound (see "WHERE a word stretches" below): which letter classes may repeat, in order */
const HOLD = {
  punch: "V F M", smash: "V M R", slap: "V S", thud: "V M", stomp: "V M", clang: "V M", slash: "V S H", bite: "V R",
  crack: "R V", shatter: "S Z V", crash: "V S H R", crumble: "R V S", rumble: "R M V", creak: "V R", scrape: "R Z S V",
  boom: "V M", whump: "V M F", thunder: "R V M", zap: "Z V", beam: "Z V M", gunshot: "V M", gunfire: "V", ricochet: "V M",
  whoosh: "V S Z F", zoom: "V R M", bounce: "V M", teleport: "V F", wind: "V S H",
  fire: "V R F", crackle: "S R V", hiss: "S Z F V", splash: "V S H", squish: "V S H", drip: "V",
  powerup: "M V Z", psychic: "M V", chime: "V M", fizzle: "Z S F V", whiff: "F V S",
  click: "V", beep: "V", engine: "R V M", siren: "V",
  roar: "R V", pain: "V R", effort: "V M H", relief: "V F H", sigh: "V H", cheer: "V", laugh: "V", shush: "S H V", heartbeat: "V",
  bark: "V R F", snarl: "R V", meow: "V M", purr: "R M", cathiss: "S H V", squeak: "V", snakehiss: "S Z V", trumpet: "V R M",
  plane: "V R M", helicopter: "V", pistol: "V M", rifle: "V R", shotgun: "V M", minigun: "R V", blaster: "Z V M", laserpistol: "V Z", silenced: "F S H V",
  sword: "S V M", arrow: "F V M", thrown: "F V", grenade: "V M", rocket: "S V M", reload: "V",
  ambulance: "V", police: "V", firetruck: "V M", fastcar: "R V M", clunker: "R V", mech: "V M", drill: "Z V R", hammer: "V",
  hail: "V", rain: "S Z V", storm: "R V M", tornado: "V R S"
};
for ( const [id, h] of Object.entries(HOLD) ) KINDS[id].hold = h.split(" ");
/* ---------- PREFIXES: the sound's OWN lead-in (the user, 2026-11-13: "Tra ta przed bombą?") ----------
   A prefix is what is heard just before the main sound and belongs to it: the crack of the detonator before the boom (KA-BUM,
   KA-THOOM), the tearing of the surface before a collapse (TRZA-KRUSZ, KA-KROOSH), the lightning's crack before the thunder's
   roll. It is never another sound's signature: no gun rattle (TRA-TA-) in front of a blast, no crash word in front of a punch.
   Each prefix lists why it belongs and the only kinds it may lead; KINDS[id].pre is filled from here and check-words.mjs ties
   every prefix to this table. A kind without an own lead-in has no prefix (a whoosh, a hiss, a voice). */
export const PREFIXES = {
  pl: {
    "KA-":   { why: "the dry crack that opens a heavy sound: the detonator before the boom, the pin or the pump before the shot, the knuckles before the blow", kinds: ["punch", "boom", "shotgun", "grenade"] },
    "TRZA-": { why: "the tearing of the surface that comes before a break, a collapse or the thunder's roll", kinds: ["smash", "crash", "thunder"] }
  },
  en: {
    "KA-":   { why: "the dry crack that opens a heavy sound: the detonator before the boom, the pin or the pump before the shot, the knuckles before the blow, the spark before the zap", kinds: ["punch", "smash", "clang", "boom", "zap", "beam", "fire", "shotgun", "grenade"] },
    "KRA-":  { why: "the crack of a surface giving way before the crash", kinds: ["smash", "crash"] },
    "KRA-KA-": { why: "the lightning's double crack before the thunder's roll", kinds: ["thunder"] }
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
  weather: { pl: "pogoda", en: "weather" } };

/* ---------- the word banks: tiers "a|b|c" (s quiet, m normal, l loud); st = stream syllables for repeating sounds ---------- */
const B = (s, m, l, st = null) => ({ s: s.split("|"), m: m.split("|"), l: l.split("|"), ...(st ? { st: st.split("|") } : {}) });
export const BANK = {
  pl: {
    punch:    B("DŁACH|DŁOP|BRUCH|BAM", "DŁAAP|GŁUUMF|TŁUUP|PAF|BAAM", "DŁUUCH|TŁOOP|GŁU-TŁAAP|BAAM", "DŁACH-DŁOP-BRUUCH"),
    smash:    B("SKRAM|SKRUM|BRZAM", "GRZUUNK|BRZOOSZ|KRCHOOSZ", "BRZOONK|KRCHUUSZ|BRZO-KRCHOOCH", "SKRUM-BRZAAM"),
    slap:     B("PLET|PŁEPS|PLAT", "FLAASK|FLAASZ|FLAAT", "TLAASZ|PLAASZ", "PLET-PŁEPS-PLAAT"),
    thud:     B("TŁUF|DOMP|TŁOM", "DŁUUF|TŁOOF|GŁYYM", "DŁOOMP|DŁUUM|GŁY-GŁUUM", "TŁUF-DOMP-TŁOOM"),
    stomp:    B("TUMP|DROCH|DRUMP", "DROOMP|DRUUCH|GROOMP", "TRUUCH|TUUCH|GRU-DROOM", "TUMP-DROCH-DRUUMP"),
    clang:    B("DZĘNK|KLANK|KLANG", "BRZDZIING|BRZDZYYNK|BRZDZYYNG", "KLIIŃ|GDZĘĘNG|GDZĘ-BRZDZĘĘNK", "KLANK-KLAANG"),
    slash:    B("SZIST|ŚWŚK|ŚWST", "FSZAASZK|CHŚAASZK|CHŚAASZT", "FSZAAST|ŚWIISZK|CHŚI-FSZAAŚK", "SZIST-ŚWŚK-ŚWSST"),
    bite:     B("KŁUPS|GRUP|GRACH", "KŁAAPS|GRAAP|KŁAACH", "KRUUPS|KŁYYP|KRU-CHRYYPS", "KŁUPS-GRUP-GRAACH"),
    crack:    B("TRZAK|TRAK|KRAK", "TRZYYSK|SKRRASK|PRRACH", "TRZAACH|TRZYYCH", "TRZAK-TRAK-KRRAK"),
    shatter:  B("DZĘŃ|DZIŚK|DZISZ", "TRZYŚŚK|TRZYSZSZ|TRZISZSZ", "DZYYNK|CHĘŚŚK|DZY-TRZZINK", "DZIŚK-DZISZSZ"),
    crash:    B("KRRAK|KRROM|BROSZ", "KRROOCH|TRZOOCH|TRZAACH", "KRROOSZ|TRZAAK|TRZO-TRZAAM", "KRROM-BROOSZ"),
    crumble:  B("KROSZ|GRYSZ|SKRUK", "CHRRYCH|CHRRYSZ|KRRYCH", "GRRUSZ|SKRROK|SKRY-SKRRUP", "GRYSZ-SKRRUK"),
    rumble:   B("DRROM|DRRUN|DRRUM", "BRRUN|GRRUM|GRRUN", "WRROM|BRRUN|WRU-WRRUN", "DRROM-DRRUN-DRRUM"),
    creak:    B("SKRYK|KRYK|KRIT", "SKRZIIK|SKRZIIP|SKRZIIT", "KRYYT|KRIIP", "SKRYK-KRYK-KRIIT"),
    scrape:   B("ZGRYT|ZGRUT|SKRYT", "SKRRURZ|ZGRRYRZ|ZGRRYCH", "SZRRUCH|SKRRYCH|SKRY-SKRRUT", "ZGRUT-SKRRYT"),
    boom:     B("DOF|DUF|DUM|BUM", "DOOCH|DROOCH|BROOCH|BUUM", "GDUUCH|DRUUF|DRU-BRUUCH|BUUM", "DOF-DUF-DUUM"),
    whump:    B("WFUMF|FUMF|FWOM", "FWOOF|WFUUM|WFUUF", "WUUMF|WFOOM|WFO-FOOMF", "WFUMF-FUMF-FWOOM"),
    thunder:  B("KRUM|GRAK|DROM", "DRROK|DRROCH|GRROK", "KRROCH|BRRACH|GRU-DRRAK", "KRUM-GRAK-DRROM"),
    zap:      B("KZIK|DZYK|DZZYT", "KZZIT|DZZYP|KZZIP", "TZZIK|DZIIT|DZY-DZIIP", "KZIK-DZYK-DZZYT"),
    beam:     B("WIUM|WIUŃ|WZUŃ", "WIUUT|WZZUM|WZZUT", "BZZIT|BZZIM|WZI-BZZIŃ", "WIUM-WIUŃ-WZZUŃ"),
    gunshot:  B("PACH|TUF|KUCH|PAF", "TUUCH|KAACH|KAAF|PAAF", "KAAM|KAAK|PU-PAAM|PAAF", "PACH-TUF-KUUCH"),
    gunfire:  B("BRA-BRA|RA-RA|TRA", "BRA-BRA-BRA|RA-RA-RA|TRA-DA-TRA", "BRA-BRA-BRA-BRA|RA-RA-RA-RAA|TRAT-DRA-TRAT", "BRA-BRA-BRA|RA-TRAT-RA"),
    ricochet: B("PTIUU|PIUNG|PTING", "PTYYNG|TIUU|TIIŃ", "ZIING|TYYNG|PI-ZIUU", "PIUNG-PTIING"),
    whoosh:   B("WICH|ŚUM|FSZU", "FSIIM|FSSZUU|WUUSZ", "FSZUUM|FIIM|FSU-ŚUUSZ", "WICH-ŚUM-FSZUU"),
    zoom:     B("ZYŃ|ZYM|WRUŃ", "WRUUM|WUUŃ|ZUUŃ", "WUUM|WYYM", "ZYŃ-ZYM-WRUUŃ"),
    bounce:   B("BWOŃ|DINK|PINK", "PIING|PIIŃ|BWOONG", "DYYNK|BWOONK", "BWOŃ-DINK-PIINK"),
    teleport: B("FIF|WYP|WYT", "WYYF|SZWYYF|PUUP", "FUUF|PUUT|SZWU-PIIP", "FIF-WYP-WYYT"),
    wind:     B("SZI|SZO|SZU", "ŚOO|ŚII|WUU", "ŚUU|WOO|WI-FUU", "SZI-SZO-SZUU"),
    fire:     B("FOM|FUM|FOF", "WRUUSZ|WROOSZ|FRAACH", "FAACH|BROOSZ|FA-BRUUSZ", "FOM-FUM-FOOF"),
    crackle:  B("TRIK|KRYT|TRIT", "KRRYK|TRRYT|TRZIIK", "TRZIIT|TSSIK|TSY-TSSIT", "TRIK-KRYT-TRRIT"),
    hiss:     B("FSS|FST|FSST", "FSSZSZ|SZSS", "SZSZT|SST|FSSZSZSZ", "FSS-FST-FSST"),
    splash:   B("BLOSK|PLOSK|PLASZ", "SPLAACH|CHLAASK|SPLAASK", "BLOOSZ|PLOOSZ|CHLA-SPLOOCH", "PLOSK-PLAASZ"),
    squish:   B("MLICH|MLUP|MLIP", "CHLUUSZ|SKLUUSZ|CHLYYSZ", "CHLYYCH|SKLYYP|SKLI-CHLUUCH", "MLICH-MLUP-MLIIP"),
    drip:     B("KLYP-KLYP|TIPK-TIPK|PLIP", "KLYP-KLYP-KLYP|TIPK-TIPK-TIPK|PLIP-PLYK-PLIP", "KLYP-KLYP-KLYP|TIPK-TIPK-TIIPK|PLAP-TLIP-PLAP", "KLYP-KLYP-KLYP|TIPK-PLAP-TIPK"),
    powerup:  B("WRUM|BZMUM|WUM", "WMUMM|HMUMM|HMMUMM", "HMYMM|BZUMM|WRMU-WRYMM", "WRUM-BZMUM-WUMM"),
    psychic:  B("WUŃ|WUM|MUM", "MUŃŃ|WYŃŃ|WYMM", "WMYMM|WMYŃŃ|WMI-WMUMM", "WUŃ-WUM-MUMM"),
    chime:    B("GYŃ|DŹIŃ|TĘŃ", "TYYNG|DŹĘĘNG|TĘĘNG", "TIING|GIIŃ|DZĘ-DZYYNG", "GYŃ-DŹIŃ-TĘĘŃ"),
    fizzle:   B("FSF…|FSYK…|FSYF…", "FSSK…|FSST…|SZSZF…", "FSSYT|SZSZK", "FSF-FSYK-FSSYF"),
    whiff:    B("FSUF…|FSIF…|WIF…", "WUFF…|FFSU…|WWI…", "FFI|WWU|FSI-FFU", "FSUF-FSIF-WIFF"),
    click:    B("KYK|KYT|KLIT", "KLYYT|TKYYT|TKYYK", "KIIK|TIIT", "KYK-KYT-KLIIT"),
    beep:     B("BLIP-BLIP|PYP-PYP|BIP", "BLIP-BLIP-BLIP|PYP-PYP-PYP|BIP-PIUP-BIP", "BLIP-BLIP-BLIP|PYP-PYP-PYP-PYYP|BIIP-PIIP-BIIP", "BLIP-BLIP-BLIP|PYP-BIIP-PYP"),
    engine:   B("DROM|WROM|WRAN", "WRRAM|BRRUN|DRRUN", "DRRUM|GRRUN|GRU-WRRUN", "DROM-WROM-WRRAN"),
    siren:    B("UI-IO|IU-EO", "UI-IO-UI-IO|IU-EO-IU-EO|IO-UI-IO-UI", "UI-IO-UI-IO-UI|IU-EO-IU-EO-IU|UI-IO-UI-IOO", "UI-IO|IU-EO"),
    roar:     B("RAH|GRRAU|ROU", "RROCH|GRROU|GRROH", "RRAU|GRRAH|HRRA-WRRAH", "RAH-GRRAU-RROU"),
    pain:     B("NGH|ORRGH|ORGH", "OORCH|OOGH|AARRGH", "AUURRGH|AUURCH|A-AUUCH", "NGH-ORRGH-OORGH"),
    effort:   B("HNEGH|HNYH|HNYF", "NNEEF|NNEEH|MMYYGH", "NNYYF|NNYYH|NNY-MMEEGH", "HNEGH-HNYH-HNYYF"),
    relief:   B("HFOF…|HFUF…|HFUH…", "HFOOH…|PFOOH…|PFOOF…", "PFUUH|PFUUF|FO-FOOF", "HFOF-HFUF-HFUUH"),
    sigh:     B("HAH…|HOCH…|HUCH…", "HAACH…|HUUH…|HOOH…", "FUUH|FOOH|FA-FUUCH", "HAH-HOCH-HUUCH"),
    cheer:    B("HIUH|JIUH|JAUH", "WIIH|JUUH|JAIIH", "HIIH|JUIIH", "HIUH-JIUH-JAUUH"),
    laugh:    B("HYH-HYH|HHY-HHY|CHYCH", "HYH-HYH-HYH|HHY-HHY-HHY|CHYCH-CHY-CHYCH", "HYH-HYH-HYH-HYH|HHY-HHY-HHY-HHYY|CHE-CHE-KCHE-CHE", "HYH-HYH-HYH|HHY-CHE-HHY"),
    shush:    B("SZT|SZSZT|CISZ", "CISZSZT|PSSZSZ|PSSZSZT", "CISZSZT|PSSZSZ|SZSZSZT|CISZSZ", "SZT-SZSZT-CISZSZ"),
    heartbeat:B("BA-DUM|TUDUM-DUM", "BA-DUM-BA-DUM|DUM-TUDUM-DUM|DUM-BA-DUM-BA", "BA-DUM-BA-DUM-BA|TUDUM-DUM-TUDUM|BA-DUM-BA-DUUM", "BA-DUM|TUDUM-DUM"),
    bark:     B("HŁAU-HŁAU|HWAF-HWAF|RHAU", "HŁAU-HŁAU-HŁAU|HWAF-HWAF-HWAF|RHAU-WRAF-RHAU", "HŁAU-HŁAU-HŁAU|HWAF-HWAF-HWAAF|GHAU-HAŁF-GHAU", "HŁAU-HŁAU-HŁAU|HWAF-GHAU-HWAF"),
    snarl:    B("GRRO|WRROH|GRRAH", "NGRRAM|NGRRAH|WRRACH", "WRROCH|WRRYCH|HRRA-HRRYH", "GRRO-WRROH-GRRAH"),
    meow:     B("MŁIAU|MREAU|MŁEAU", "MRIIAUU|MRIEAUUŁ|MRIAAŁ", "NIIAUU|NIIAA|MŁIA-MRIEAUU", "MREAU-MŁEAUU"),
    purr:     B("MRY|MRYM|MRU", "MRYRR|MRRY|WRRY", "PRURR|MRRYRR|PRU-WRRU", "MRY-MRYM-MRRU"),
    cathiss:  B("CHACH|HCH|CHSZ", "PHASZSZT|HSZSZ|KHACHH", "KHASZSZT|KHASZSZ", "CHACH-HCH-CHSZSZ"),
    squeak:   B("ŚPI-ŚPI|IIK-IIK|PIII", "ŚPI-ŚPI-ŚPI|IIK-IIK-IIK|PIII-ĆWII-PIII", "ŚPI-ŚPI-ŚPI-ŚPI|IIK-IIK-IIK-IIK|SKWI-TSIK-SKWI", "ŚPI-ŚPI-ŚPI|IIK-SKWI-IIK"),
    snakehiss:B("SZIS|SZYS|ŚS", "ŚISZSZ|ŚŚ|ŚYSZSZ", "SYSZSZ|SZSS", "SZIS-SZYS-ŚSS"),
    trumpet:  B("BRÓM|BRÓŁ|PRAAM", "TRÓÓ|PRAA|PRUUM", "PRUUŁ|PRÓÓM|PFRUU-PRÓÓŁ", "BRÓM-BRÓŁ-PRAAM"),
    plane:    B("WRYYŁ|WRYYM|WRYYN", "BRRIIM|BRRIIN|BRRIIŁ", "NIIŁ|BRRUUN|BRRUU-NIIN", "WRYYŁ-WRYYM-WRYYN"),
    helicopter:B("FŁOP-FŁOP|ŁOP-ŁOP|TŁUP", "FŁOP-FŁOP-FŁOP|ŁOP-ŁOP-ŁOP|TŁUP-TŁOP-TŁUP", "FŁOP-FŁOP-FŁOP|ŁOP-ŁOP-ŁOP-ŁOOP|FUP-FUP-CHUP-FUP", "FŁOP-FŁOP-FŁOP|ŁOP-FUP-ŁOP"),
    pistol:   B("KUF|PKUCH|KUCH|PAF", "KAACH|KAAK|KAAF|PAAF", "PKUUF|PKAAF|PKA-PKUUK|PAAF", "KUF-PKUCH-KUUCH"),
    rifle:    B("KTACH|PTYCH|KTYNG", "TRAAK|KTAAK|KRYYK", "KRAAK|PTAAK|PTY-TRAANG", "PTYCH-KTYYNG"),
    shotgun:  B("BUF|BAF|GDOCH|BUM", "GDUUCH|BAAM|BROOF|BUUM", "DOOCH|BRUUCH|DU-GDOOF|BUUM", "BUF-BAF-GDOOCH"),
    minigun:  B("DRYYT|DRYY|WRRRR", "BRRT|BRRYYTT|DRRTT", "WRRT|DRRYYTT", "DRYYT-DRYY-WRR"),
    blaster:  B("WZOMF|WZOCH|DZWUM", "DZWOOCH|DZWOOM|DZWOOMF", "WZZONG|BWOOCH|BZA-BZZUM", "WZOCH-DZWUUM"),
    laserpistol:B("FZEUŚ|TSIIU|FZIU", "DZIIUUŚ|DZIIUU", "TSIIUUSZ|DZIIUUSZ|TSIEU-TSIIUUFT", "FZEUŚ-TSIIU-FZIUU"),
    silenced: B("FTYP|FTUT|FTYT", "FFTUP|FFTP|FFTT", "PSSUT|TFFT", "FTYP-FTUT-FFTYT"),
    sword:    B("DZAŃ|SZIŃ|SZWAŃ", "ŚŚWING|ŚŚWINK|ŚŚWYNG", "SZSZAŃ|ŚŚWYNK|DZI-DZAANK", "DZAŃ-SZIŃ-SZSZWAŃ"),
    arrow:    B("FUP|FIT|FYT", "FFUT|FFUK|FFIP", "FFYP|FFIK|TFY-SZFFIK", "FUP-FIT-FFYT"),
    thrown:   B("ŚWYNK|FWUP|FWYK", "FWWYP|SZTYYNK|ŚWWUP", "FWWUK|SZTUUP|ŚWU-SZTUUNK", "ŚWYNK-FWUP-FWWYK"),
    grenade:  B("GRUCH|BOF|KROF|BUM", "KRUUF|BAAM|KRUUM|BUUM", "BUUF|BAAF|KRO-KRAAF|BUUM", "GRUCH-BOF-KROOF"),
    rocket:   B("SZFYM|SZYSZ|SZUCH", "SZSZFUCH|FSSOM|FSSYM", "SZSZYCH|FSYSZSZ|SZO-FSSUCH", "SZYSZ-SZSZUCH"),
    reload:   B("CZYK-CZYK|CZAK-CZAK|TCZYK", "CZYK-CZYK-CZYK|CZAK-CZAK-CZAK|TCZYK-CZK-TCZYK", "CZYK-CZYK-CZYK|CZAK-CZAK-CZAAK|KRYCZ-KCZAK-KRYCZ", "CZYK-CZYK-CZYK|CZAK-KRYCZ-CZAK"),
    ambulance:B("IIO-EEO|UUO-IIOO", "IIO-EEO-IIO-EEO|UUO-IIOO-UUO-IIOO|EEO-IIO-EEO-IIO", "EEO-IIO-EEO-IIO|IIOO-UUO-IIOO-UUO|IIO-EEO-IIO-EEOO|IIO-EEOO", "IIO-EEO|UUO-IIOO"),
    police:   B("WIIU-UUIU|UIIU-IIUU", "UUIU-WIIU-UUIU|IIUU-UIIU-IIUU|WIIU-UUIU-WIIU", "WIIU-UUIU-WIIU|UIIU-IIUU-UIIU|UUIU-WIIU-UUIUU|WIIU-UUIUU", "WIIU-UUIU|UIIU-IIUU"),
    firetruck:B("BWAAP-ŁAAŁ|OOŁ-ŁUUU", "ŁAAŁ-BWAAP-ŁAAŁ|OOŁ-ŁUUU-OOŁ-ŁUUU|BWAAP-ŁAAŁ-BWAAP", "BWAAP-ŁAAŁ-BWAAP|ŁUUU-OOŁ-ŁUUU-OOŁ|ŁAAŁ-BWAAP-ŁAAŁ|OOŁ-ŁUU|OOŁ-ŁUU-OOŁ-ŁUU", "BWAAP-ŁAAŁ|OOŁ-ŁUUU"),
    fastcar:  B("NIYYU|WRYYM|NIYYM", "NIYYŁ|NIAAM|NIAAŁ", "NIAAUU|WRRYYU|WRRYY-WRRAAU", "NIYYU-WRYYM-NIYYM"),
    clunker:  B("KŁONK-KŁONK|BRRT-BRRT|PTYK", "KŁONK-KŁONK-KŁONK|BRRT-BRRT-BRRT|PTYK-TRRK-PTYK", "KŁONK-KŁONK-KŁONK|BRRT-BRRT-BRRT|PYRK-KLEK-PYRK|KŁONK-KŁOONK", "KŁONK-KŁONK-KŁONK|BRRT-PYRK-BRRT"),
    mech:     B("DŁUM-DŁUM|KCHUM-KCHUM|BDUM", "DŁUM-DŁUM-DŁUM|KCHUM-KCHUM-KCHUM|BDUM-GDUM-BDUM", "DŁUM-DŁUM-DŁUM|KCHUM-KCHUUM|KSZDUM-SZŁUM", "DŁUM-DŁUM-DŁUM|KCHUM-SZŁUM-KCHUM"),
    drill:    B("DZZIŃ|WZII|WRZII", "WRZZYŃ|WZZIIT|DZIIT", "BZZIŃ|WZZIIŃ|WRZZI-WRZZYT", "DZZIŃ-WZII-WRZZII"),
    hammer:   B("TONK-TONK|PONK-PONK|DZONK", "TONK-TONK-TONK|PONK-PONK-PONK|DZONK-TŁONK-DZONK", "TONK-TONK-TONK|PONK-PONK-POONK|GDONK-DŁONK-GDONK", "TONK-TONK-TONK|PONK-GDONK-PONK"),
    hail:     B("KTYK-KTYK|TSIK-TSIK|PIKT", "KTYK-KTYK-KTYK|TSIK-TSIK-TSIK|PIKT-DZYK-PIKT", "KTYK-KTYK-KTYK|TSIK-TSIK-TSIIK|TYKT-TYKK-TYKT", "KTYK-KTYK-KTYK|TSIK-TYKT-TSIK"),
    rain:     B("SYSZ|SZYŚ|SZYS", "FSZUŚŚ|FSZUSS|SŚŚ", "SS|SZUSZSZ|SU-FSZSZSZ", "SYSZ-SZYŚ-SZYSS"),
    storm:    B("DRRUM|GRUUM|DRUUM", "DRRUUSZ|GRRUUCH|DRRUCH", "KRRUCH|GRRUUSZ", "GRUUM-DRRUUM"),
    tornado:  B("HWUUM|WROOM|HWUU", "HWUUSZ|WRUUM|FWOOM", "FWUUM|FWOOSZ|HWOO-SZWOO", "HWUUM-WROOM-HWUU"),
  },
  en: {
    punch:    B("THWUP|BWOMF|THWAP|POW", "KROOP|BWUUK|BWUUM|BAM|POOW", "THWAAK|THWAAM|THWU-THWUUK|POOW", "BWOMF-THWAAP"),
    smash:    B("GRANK|SHKOM|SHKAM", "BRUUNCH|SHKAANCH|BRUUNK", "BROOSH|SKROOM|KRU-KRUUNK", "SHKOM-SHKAAM"),
    slap:     B("PLESH|PLESK|THLET", "THLEESH|THLEESK|SPLEESH", "SPLEESK|THLAASH|THLA-THLEEP", "PLESK-THLEET"),
    thud:     B("THUM|THUD|DOD", "THWUUMP|DWUUMP|DUUM|THUUD", "DOOMP|DWOOMP|THWU-THWOOD|THUUD", "THUM-THUD-DOOD"),
    stomp:    B("TRUM|TROM|TROP", "TRUUP|DRUUP|STROOM", "STROOMP|STRUUP|STRU-DROOMP", "TRUM-TROM-TROOP"),
    clang:    B("KLANK|KLANG|GLANG", "PTIINNG|KLIINNG|GLAANK", "PTIINK|PTIING|PTA-GLAANNG", "KLANG-GLAANG"),
    slash:    B("SWIT|FWAT|SWSHT", "SWIISHT|SHHT|SWSSK", "ZZWT|SWAASHK|FWI-SHIISK", "SWIT-FWAT-SWSHHT"),
    bite:     B("CHROK|CHRAK|KROK", "KRAAK|CHRAANCH|GNAAMP", "KROONCH|GNOONCH|CHA-GNOOMP", "CHROK-CHRAK-KROOK"),
    crack:    B("KRAK|SKRIK|KLICK", "KRRICK|SKRRACK|KRRIK", "KRRACK|SKRRIKT|KRRI-KLIIKT", "KRAK-SKRIK-KLIICK"),
    shatter:  B("KSISH|KRISH|KRING", "SSKREENG|SSKREENK|TSHHING", "TSHHINK|TSHISHHK|TSHI-KREESHH", "KRISH-KRIING"),
    crash:    B("BROSH|KRAM|GRASH", "KROOSHK|KRROONCH|BROONCH", "BROOSHK|BRAASHK|KRO-KRAANCH", "BROSH-KRAM-GRAASH"),
    crumble:  B("CHROK|KRUNK|GRUK", "GRRUNCH|SKRRUNCH|KRRUNCH", "KRRUK|CHRROSH|SKRU-KRRUSH", "CHROK-KRUNK-GRRUK"),
    rumble:   B("DROM|DRON|DRUN", "GRRUM|GRRON|GRRUN", "BRRON|DRRUN|VRRU-VRRON", "DROM-DRON-DRRUN"),
    creak:    B("SKRIK|SKRIT|KREEK", "KREET|SKWEEK|SKWEET", "SKREET|SKWIIT|SKREE-SKWIIK", "SKRIK-SKRIT-KREEK"),
    scrape:   B("SKRAT|ZGRAT|SHRIT", "SHRRITCH|SKRRACH|SKRREECH", "SHRRATCH|ZGRREET|SKREE-SHRREECH", "ZGRAT-SHRRIT"),
    boom:     B("BRAM|THAM|GDOOM|BOOM", "DROOM|BOOM", "GDOOM|GDAAM|THOO-BAAM|BOOM|BRAAM", "BRAM-THAM-GDOOM"),
    whump:    B("FWUMP|WUMPF|FWUMF", "WHUUMPF|FWHUUMPF|FWHOOMPF", "FWHUUMF|FWHOOMP|FWHU-FWUUMPF", "WUMPF-FWUUMF"),
    thunder:  B("KRAK|THRAK|KRAM", "THRROM|THRRAM|THRROK", "BRRAK|BRRAM|KROO-KRROOK", "KRAK-THRAK-KRRAM"),
    zap:      B("BZIK|TZIK|ZAP", "ZZAT|ZZAK|BZZIP|ZZAP", "BZZIT|TZZIP|TZI-KZZAK|ZZAP", "BZIK-TZIK-ZZAP"),
    beam:     B("VZEEM|VWOOM|VWEET", "VWOOT|VWEEM|ZZWEEM", "ZZWEET|PZZOOM|VZOO-PZZOOT", "VZEEM-VWOOM-VWEET"),
    gunshot:  B("KOM|KOK|BAK|BANG", "BOOM|BAAM|PAAK|BAANG", "KAANG|KOONG|PO-KAAM|BAANG", "KOM-KOK-BAAK"),
    gunfire:  B("DRRT-DRRT|DRAKA-DRAKA|TAKA", "DRRT-DRRT-DRRT|DRAKA-DRAKA-DRAKA|TAKA-DAKA-TAKA", "DRRT-DRRT-DRRT|DRAKA-DRAKAA|BRRT-KRRT-BRRT", "DRRT-DRRT-DRRT|DRAKA-BRRT-DRAKA"),
    ricochet: B("PTING|ZWING|ZWIW", "PEEYOOW|PEENG|PIIW", "TEEYOOW|PTEEYOOW|ZWEEYO-TEENG", "PTING-ZWING-ZWIIW"),
    whoosh:   B("FWASH|ZWIM|FWAM", "SHWAASHK|SWIISHK|SHWIISHK", "WHOOSHK|SWOOSHK|FWOO-FWIISH", "FWASH-ZWIM-FWAAM"),
    zoom:     B("VWEEN|VWEEM|ZREEM", "ZREEN|VROON|ZROOM", "ZROON|VREEM|VREE-VWOON", "VWEEN-VWEEM-ZREEM"),
    bounce:   B("SPONK|SPONG|DONK", "BWOONK|BWOONG|BOIINK", "BWOIINK|DOIING|BWOI-DOIINK", "SPONK-SPONG-DOONK"),
    teleport: B("FWIP|FWIT|VIT", "FWOOT|FWOOP|ZHWIIP", "ZHWIIT|SHWIIT|SHWI-SHWOOP", "FWIP-FWIT-VIIT"),
    wind:     B("HWOOH|FWOOH|FWEEH", "SHWEEH|HWOO|HWEE", "SHWEE|SHWOOH|VWOO-VWEE", "HWOOH-FWOOH-FWEEH"),
    fire:     B("FRAF|FROOF|FRAM", "FWROOSH|FWROOMPF|FWOOMPF", "FWROOSH|WROOMPF|FWOO-FWOOSH", "FRAF-FROOF-FRAAM"),
    crackle:  B("KRKAK|KRKAT|KRKIT", "KSHHATCH|KRRATCH|KRRKIK", "KRRKATCH|KSHHITCH|KRKI-TSSKATCH", "KRKAT-KRRKIT"),
    hiss:     B("FSSH|SHSHT|TSSS", "TSST|PSSHHT|TSSHH", "SSHHT|SHSST", "FSSH-SHSHT-TSS"),
    splash:   B("SPLOT|PLUT|BLOSH", "SPLUUTCH|PLAATCH|SPLOOTCH", "BLAATCH|PLOOTCH|SPLRA-PLUUTCH", "SPLOT-PLUT-BLOOSH"),
    squish:   B("GLISH|GLUSH", "SKWUUSH|GLEERCH|SKLIISH", "GLEESH|SKWEETCH|SKWU-SKWUUTCH", "GLUSH-GLIISH"),
    drip:     B("PLOK-PLOK|PLIP-PLIP|DLIP", "PLOK-PLOK-PLOK|PLIP-PLIP-PLIP|DLIP-PLINKT-DLIP", "PLOK-PLOK-PLOK|PLIP-PLIP-PLIIP|TLIP-BLIK-TLIP", "PLOK-PLOK-PLOK|PLIP-TLIP-PLIP"),
    powerup:  B("VWAM|VWOOM|HMAM", "ZWOOMM|HMOOMM|VMOOMM", "VMAMM|ZWAMM|ZWOO-HMOOMM", "VWAM-VWOOM-HMAMM"),
    psychic:  B("HMEEM|HMEEN|HMIM", "HMEENNG|HMINN|VMEENNG", "MMEENNG|VMINNG", "HMEEM-HMEEN-HMIMM"),
    chime:    B("DEENG|PEENG|TEENG", "DEENNG|PEENNG|TLEENG", "TEENNG|TLEENNG|TLI-TLIING", "DEENG-PEENG-TEENG"),
    fizzle:   B("SZT…|FZIT…|PFZIT…", "PFZZT…|PFFIT…|FZZT…", "PFFT|SZZIT", "SZT-FZIT-PFZZIT"),
    whiff:    B("SWOOF…|FWIP…|FWIF…", "FOOFF…|WHOOFF…|FIFF…", "FFIP|FWWOOP|FWOO-SWWIP", "SWOOF-FWIP-FWIFF"),
    click:    B("KLAK|KLAT|TKIT", "TKIIK|KLIIT|KLIIK", "TKAACK|TKIICK|KI-KIIK", "KLAK-KLAT-TKIIT"),
    beep:     B("PWEEP-PWEEP|BWEEP-BWEEP|DWEEP", "PWEEP-PWEEP-PWEEP|BWEEP-BWEEP-BWEEP|DWEEP-BIBIP-DWEEP", "PWEEP-PWEEP-PWEEP|BWEEP-BWEEP-BWEEP|BEEB-TWEEB-BEEB|PWEEP-PWEEEP", "PWEEP-PWEEP-PWEEP|BWEEP-BEEB-BWEEP"),
    engine:   B("BROP|VROON|VROOP", "WRROP|WRRON|WRROM", "VRRAN|VRRON|VRA-VRRAP", "BROP-VROON-VRROOP"),
    siren:    B("AO-OO|YI-WI", "AO-OO-AO-OO|YI-WI-YI-WI|OO-AO-OO-AO", "AO-OO-AO-OO-AO|YI-WI-YI-WI-YI|AO-OO-AO-OO|YI-WII", "AO-OO|YI-WI"),
    roar:     B("RAWH|WRAWH|ROGH", "HRRAWH|WRRAGH|HRRAGH", "WRROGH|RRAWGH|WRO-WRRAH", "RAWH-WRAWH-RROGH"),
    pain:     B("OURGH|NNRGH|NNGH", "AAGH|OUUGH|NNCH", "AAGH|OU-NNCH|OUURGH", "OURGH-NNRGH-NNGH"),
    effort:   B("HRAH|NNAGH|HNEF", "HNEEH|HNAAH|HRAAF", "HNAAF|HREEF|HRE-HRAAGH", "HRAH-NNAGH-HNEEF"),
    relief:   B("HEF…|PFOOF…|PFOOH…", "PFOOW…|FOOH…|FOOF…", "FOOW|FEEW|PFE-FEEH", "HEF-PFOOF-PFOOH"),
    sigh:     B("FOOH…|PHAAH…|HFAAH…", "PFAUUHH…|PFOOHH…|FAUUHH…", "HHAUUH|PFAUUH|FOO-PFOOH", "FOOH-PHAAH-HFAAH"),
    cheer:    B("YOOH|YAOH|HOOAH", "YOOH|WEEAAH|WOOH", "YOOAAH|WEEOOH|HAO-YEEOOH", "YOOH-YAOH-HOOAAH"),
    laugh:    B("BWAH-BWAH|KHAH-KHAH|HRAH", "BWAH-BWAH-BWAH|KHAH-KHAH-KHAH|HRAH-KHEH-HRAH", "BWAH-BWAH-BWAH|KHAH-KHAH-KHAAH|HYAH-HYEH-HYAH", "BWAH-BWAH-BWAH|KHAH-HYAH-KHAH"),
    shush:    B("SHSHT|PSHT|SHHT", "SHHSHHT|SHHT|PSSHHT", "SHHT|SHHSHHT|PSHHT|SHHHT|PSHHHT", "SHSHT-PSHT-SHHT"),
    heartbeat:B("BU-DMP|DMM-TU", "BU-DMP-BU-DMP|DMM-TU-DMM-TU|DMP-BU-DMP-BU", "BU-DMP-BU-DMP-BU|DMM-TU-DMM-TU-DMM|BU-DMP-BU-DMMP", "BU-DMP|DMM-TU"),
    bark:     B("WHRUF-WHRUF|RWOF-RWOF|WROWF", "WHRUF-WHRUF-WHRUF|RWOF-RWOF-RWOF|WROWF-BWARF-WROWF", "WHRUF-WHRUF-WHRUF|RWOF-RWOF-RWOOF|RRUF-GRWUF-RRUF", "WHRUF-WHRUF-WHRUF|RWOF-RRUF-RWOF"),
    snarl:    B("HRRRO|HRRRA|HRRRU", "KHRROGH|GRROGH|NGRRU", "HRRUGH|NGRRA|NGRRRO-KHRRUH", "HRRRO-HRRRA-HRRU"),
    meow:     B("MYEOO|MYEEW|NYEOO", "MRREOOW|MRREEOOW|MYEEOOW", "MRREE|MREOOW|NYEE-MRIAAW", "MYEOO-MYEEW-NYEOO"),
    purr:     B("PRUR|PRRU|BRRU", "PRRA|BRURR|BRURRM", "BRURR|MRURRM|MRU-MRRA", "PRUR-PRRU-BRRU"),
    cathiss:  B("PHAKK|KHASH|KHSHT", "KHASHHT|KHHASHHT|KHHAKK", "HASHHT|KHSHH", "KHASH-KHSHHT"),
    squeak:   B("PWII-PWII|SKRII-SKRII|SKWII", "PWII-PWII-PWII|SKRII-SKRII-SKRII|SKWII-TSKII-SKWII", "PWII-PWII-PWII|SKRII-SKRII-SKRII|KWII-EEP-KWII|PWII-PWIII", "PWII-PWII-PWII|SKRII-KWII-SKRII"),
    snakehiss:B("TSISH|SS|TSS", "SSISHH|SS|SSHH", "TSS|TSISS|TSISHH|TSISHHH", "TSISH-SS-TSS"),
    trumpet:  B("PRUUW|TROOM|PRUUM", "PFROOW|PFROO|PFROOM", "PFRAA|PFRUUM", "PRUUW-TROOM-PRUUM"),
    plane:    B("VRAAM|VRAAN|VRAAW", "NYOOM|NYOON|NYOOW", "WHAAN|WHAAM|WHAA-WHEEM", "VRAAM-VRAAN-VRAAW"),
    helicopter:B("FWUP-FWUP|THWOP-THWOP|WOKKA", "FWUP-FWUP-FWUP|THWOP-THWOP-THWOP|WOKKA-THUP-WOKKA", "FWUP-FWUP-FWUP|THWOP-THWOOP|WUP-WUP-CHUK-WUP", "FWUP-FWUP-FWUP|THWOP-WUP-THWOP"),
    pistol:   B("BLONG|BANG|PTOT", "PTAAT|BAAK|PTOOK|BAANG", "PTAAK|PTAANG|PTO-PAAK|BAANG", "BLONG-BANG-PTOOT"),
    rifle:    B("KRIKT|KSIK|KSICK", "KTAACK|KTIICK|KRAACK", "KRAAK|KTAAK|PTI-KRAAKT", "KRIKT-KSIK-KSIICK"),
    shotgun:  B("BRAM|BRAK|CHKOK|BOOM", "CHKOOM|CHKOOK|CHKAAM|BOOM", "CHKOOM|CHKAAK|CHKOO-KROOSH|BOOM", "BRAM-BRAK-CHKOOK"),
    minigun:  B("VRRR|BRRRT|BRRRP", "DRR|VRRAA|DRRAA", "DRRP|DRRT", "VRRR-BRRRT-BRRP"),
    blaster:  B("ZWOSH|VRASH|ZWASH", "KZZOSH|ZZWOOSH|VRAAMF", "ZZWOMF|KZZOOSH|KZA-KZZOM", "VRASH-ZZWASH"),
    laserpistol:B("PTIOO|ZWEEW|PIOO", "PTIOOSH|PYOOFT|FZIOOSH", "TSIOOSH|FZIOOFT|PTIOO-TZIOO", "PTIOO-ZWEEW-PIOO"),
    silenced: B("FSUP|FSIT|FSUT", "FFSIP|TFFT|TFFP", "TFFIP|TFFIT|FTU-FFTUP", "FSUP-FSIT-FFSUT"),
    sword:    B("ZHING|ZHINK|SHINK", "SHHLEENNG|SHHWEENNG|ZHEENK", "ZHEENG|SHHEENNG|SHI-SHHLANG", "ZHINK-SHHINK"),
    arrow:    B("FWIP|TFIP|THWIP", "TFFUT|FWWIT|TFFIT", "THWWIT|TFFUP|ZWI-THWWEEK", "FWIP-TFIP-THWWIP"),
    thrown:   B("FWUNK|THWIK|FWINK", "SHTIINK|SHWWUNK|THWWINK", "SHWWUP|FWWIK|SHWU-FWWUP", "THWIK-FWWINK"),
    grenade:  B("BAK|BAM|KLOSH|BOOM", "BROOSH|KLOOSH|KROOSH|BOOM", "KROOM|KRAAM|KLOO-KRAAK|BOOM", "BAK-BAM-KLOOSH"),
    rocket:   B("SHOOM|FSOOM|FWEEM", "SHOOSHH|SHHWEEM|SHEESHH", "FSEESHH|SHHWOOM|SHWOO-FWEESHH", "SHOOM-FSOOM-FWEEM"),
    reload:   B("TCHAK-TCHAK|KLAKT-KLAKT|KACHK", "TCHAK-TCHAK-TCHAK|KLAKT-KLAKT-KLAKT|KACHK-SHUKT-KACHK", "TCHAK-TCHAK-TCHAK|KLAKT-KLAAKT|KCHAK-CHK-KCHAK", "TCHAK-TCHAK-TCHAK|KLAKT-KCHAK-KLAKT"),
    ambulance:B("NEEO-WEEO|NAAO-WAAO", "WEEO-NEEO-WEEO|WAAO-NAAO-WAAO|NEEO-WEEO-NEEO", "NEEO-WEEO-NEEO|NAAO-WAAO-NAAO|WEEO-NEEO-WEEOO|NEEO-WEEOO", "NEEO-WEEO|NAAO-WAAO"),
    police:   B("WAOOW-YEEOW|EEOOW-YEEOW", "YEEOW-WAOOW-YEEOW|YEEOW-EEOOW-YEEOW|WAOOW-YEEOW-WAOOW", "WAOOW-YEEOW-WAOOW|EEOOW-YEEOW-EEOOW|WAOOW-YEEOOW|EEOOW-YEEOOW", "WAOOW-YEEOW|EEOOW-YEEOW"),
    firetruck:B("BWAAMP-HWAAA|WAAOOO-HWAAA", "BWAAMP-HWAAA|WAAOOO-HWAAA|HWAAA-BWAAMP", "HWAAA-BWAAMP|HWAAA-WAAOOO|HWAA-BWAAMP-HWAA|BWAAMP-HWAA|WAAOO-HWAA|HWAA-BWAAMP", "BWAAMP-HWAAA|WAAOOO-HWAAA"),
    fastcar:  B("VREEN|VREEM|VREEW", "VRROWW|ZRREEN|ZRREEM", "ZRREEW|NYEEW|VRO-NYEEN", "VREEM-VRREEW"),
    clunker:  B("RATTK-RATTK|KUCHNK-KUCHNK|BRRT", "RATTK-RATTK-RATTK|KUCHNK-KUCHNK|BRRT-PUTK-BRRT", "RATTK-RATTK-RATTK|KUCHNK-KUUCHNK|KLONK-PTUNK-KLONK|RATTK-RRATTK", "RATTK-RATTK-RATTK|KLONK-KUCHNK"),
    mech:     B("VVRT-VVRT|ZZRT-ZZRT|GDOOM", "VVRT-VVRT-VVRT|ZZRT-ZZRT-ZZRT|GDOOM-BDOOM-GDOOM", "VVRT-VVRT-VVRT|ZZRT-ZZRT-ZZRRT|KSHDOM-KTHOOM", "VVRT-VVRT-VVRT|ZZRT-KTHOOM-ZZRT"),
    drill:    B("BZZZN|BZEE|VZZZ", "VRZZEET|VRZZT|VRZZN", "BZZT|BZZ|VRZII-RZZEET", "BZZZN-BZEE-VZZ"),
    hammer:   B("PTONK-PTONK|KTANK-KTANK|TONK", "PTONK-PTONK-PTONK|KTANK-KTANK-KTANK|TONK-KTONG-TONK", "PTONK-PTONK-PTONK|KTANK-KTAANK|DTANK-GTONK-DTANK", "PTONK-PTONK-PTONK|KTANK-DTANK-KTANK"),
    hail:     B("KLIT-KLIT|DIKT-DIKT|KTAK", "KLIT-KLIT-KLIT|DIKT-DIKT-DIKT|KTAK-TIKT-KTAK", "KLIT-KLIT-KLIT|DIKT-DIKT-DIIKT|TSIK-PTIK-TSIK", "KLIT-KLIT-KLIT|DIKT-TSIK-DIKT"),
    rain:     B("PSHSH|FSHSH|SHSH", "PSHOOSSHH|SHOOSSHH|FSHASHH", "TSHASSHH|FSHASSHH|PSHOO-FSHOOSSHH", "PSHSH-FSHSH-SHH"),
    storm:    B("GROOK|DRRUK|BRRUK", "GRRUSH|BRROOSH|GRRAASH", "KRRAAM|KRRAAK|DRAA-KRROOM", "GROOK-DRRUK-BRRUK"),
    tornado:  B("FWAAM|HWOO|SHWAA", "VROOSH|HWOOSH|SHWOOSH", "SHWOOM|HWAA|HWAA-FWOO", "FWAAM-HWOO-SHWAA"),
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
   that names a sound ("CHRZĘST" names a crunch; it is not one).
   NO DICTIONARY WORDS (the user's ruling, 2026-11-13: "wiele z nich to po prostu słowa ... ciach to słowo"): a sound word must not be
   a word of the language at all, not even an imitative interjection from the dictionary (CIACH, TRZASK, PLUSK, BĘC, CRACK, SPLASH),
   nor an ordinary word that happens to look like a sound (BRAM, GROCH, DOOM, BROOM). It is BUILT from the sound in the comic's
   manner: an attack, a lasting part, a cut-off (a blade: SZSZT, FSZSZT, ŚWISZK; a blow: TWOOM, WRAMM, SKROOMM).
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
export const NAMING = DICT;
export const ICONIC = {
  pl: {
    BUM: "the classic boom (BUM!, KA-BUM!), short and round",
    BAM: "the classic hit",
    PAF: "the classic shot / punch"
  },
  en: {
    POW: "the classic punch (the user's example)",
    THUD: "the classic dull fall (the user's example)",
    BAM: "the classic hit",
    BOOM: "the classic blast",
    BANG: "the classic gunshot",
    ZAP: "the classic electric shot",
    WHAM: "the classic heavy blow",
    SHH: "the classic hush; also the only way to letter a steady rush of rain or air (SHHHH)"
  }
};
/* refused only as a whole word (also on DICT; kept for callers) */
export const NAMING_WORD = { pl: ["TAK", "JEST", "HEJ", "DOBRA", "NIE", "UPS"], en: ["YES", "YEAH", "NO", "MEH", "OOPS", "WOW"] };
/* the syllables of a word with repeated letters collapsed (ŚWIIIST -> ŚWIST, BRZĘĘK -> BRZĘK) */
const syllablesFlat = (w) => clean(String(w).replace(/\+/g, "")).replace(/[!?…\x27.,:]/g, "").split(/[-\s]+/).filter(Boolean).map((x) => x.replace(/(\p{L})\1+/gu, "$1"));
/** is this a dictionary word (not a built onomatopoeia)? -> the offending part or null. Checks the whole word (syllables joined)
    and every syllable, repeated letters collapsed; a word or syllable on ICONIC passes. */
const flat = (x) => clean(x).replace(/(\p{L})\1+/gu, "$1");
const DENY = {}, ICON = {};
for ( const L of Object.keys(DICT) ) { DENY[L] = new Set([...DICT[L], ...(NAMING_WORD[L] ?? [])].map(flat)); ICON[L] = new Set(Object.keys(ICONIC[L] ?? {}).map(flat)); }
export function naming(word, lang = null) {
  const langs = lang ? [lang] : Object.keys(DICT);
  const syl = syllablesFlat(word), whole = syl.join("");
  for ( const L of langs ) {
    if ( ICON[L]?.has(whole) ) continue;
    if ( DENY[L]?.has(whole) ) return syl.join("-");
    for ( const x of syl ) if ( DENY[L]?.has(x) && !ICON[L]?.has(x) ) return x;
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
  hail: "crackle", rain: "steady", storm: "mix", tornado: "mix" };
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
  rain: "0 .3 1 0 0 -.3 water smooth", storm: ".5 1 .7 0 .5 -.2 air shaky", tornado: ".6 1 0 0 0 0 air billowy"
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
KIND_ENV.hit += " bark squeak pistol rifle shotgun blaster laserpistol silenced sword thrown grenade";
KIND_ENV.swell += " snarl trumpet minigun rocket";
KIND_ENV.fade += " cathiss snakehiss";
KIND_ENV.arc += " meow plane arrow";
KIND_ENV.beat += " purr helicopter reload ambulance police firetruck clunker mech hammer hail";
KIND_ENV.arc += " fastcar"; KIND_ENV.swell += " drill storm tornado"; KIND_ENV.fade += " rain";
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
    const subs = {};
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
      if ( !renderable(t) || t.replace(/\+/g, "").length > MAX_LEN || naming(t, DICT[L] ? L : null) ) { refused.push(String(w)); return; }
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
