/* LMAP: the sound-effect WORDS of the map's destruction and fire (pure: node-tested in dev/sfx-letters.test.mjs).
   A VOICE is what kind of sound it is (a blast's boom, a cave-in's crash, a crack, a hiss ...); each voice has words in three sizes
   (s = small, m = medium, l = large) in two word sets: the comic idiom of the reference sheets ("en") and Polish comic onomatopoeia
   ("pl"). A "+" after a letter stretches it: the louder / longer the sound, the more of that letter (BO+M -> BOOOM).
   Every word here is our own list of common onomatopoeia; nothing is taken from the reference pictures but the idea. */

export const VOICES = {
  //            mood used by the lettering engine, its base sound (loud is set by the event's size), priority (a cluster's main word is
  //            its loudest voice), how much a big sound stretches its word, its MOTION (the engine's entrance / hold / exit chosen for
  //            the sound: a blast slams in and bursts, a cave-in drops and falls, a crack cracks in and shatters, fire pops up, flickers
  //            and rises away, a hiss zips in and dissolves)
  boom:    { mood: "boom",    sound: { sharp: 0.55, long: 0.55, pitch: -0.2, rough: 0.7 },  prio: 10, stretch: 3, motion: { in: "slam", hold: "throb", out: "burst" } },
  crash:   { mood: "crash",   sound: { sharp: 0.7,  long: 0.6,  pitch: -0.6, rough: 0.85 }, prio: 9,  stretch: 2, motion: { in: "drop", hold: "rattle", out: "fall" } },
  zap:     { mood: "zap",     sound: { sharp: 1,    long: 0.3,  pitch: 0.3,  rough: 0.5 },  prio: 8,  stretch: 2, motion: { in: "pop", hold: "buzz", out: "dissolve" } },
  thud:    { mood: "impact",  sound: { sharp: 0.45, long: 0.25, pitch: -0.5, rough: 0.5 },  prio: 7,  stretch: 2, motion: { in: "slam", hold: "shake", out: "pop" } },
  gun:     { mood: "impact",  sound: { sharp: 0.9,  long: 0.15, pitch: 0.1,  rough: 0.4 },  prio: 7,  stretch: 0, motion: { in: "slam", hold: "shake", out: "pop" } },
  fire:    { mood: "fire",    sound: { sharp: 0.3,  long: 0.7,  pitch: 0.6,  rough: 0.45 }, prio: 6,  stretch: 3, motion: { in: "pop", hold: "flicker", out: "rise" } },
  splash:  { mood: "splash",  sound: { sharp: 0.25, long: 0.5,  pitch: 0.2,  rough: 0.3 },  prio: 6,  stretch: 2, motion: { in: "pop", hold: "wobble", out: "fall" } },
  arcane:  { mood: "powerup", sound: { sharp: 0.3,  long: 0.75, pitch: 0.7,  rough: 0.2 },  prio: 6,  stretch: 3, motion: { in: "grow", hold: "throb", out: "rise" } },
  slash:   { mood: "crack",   sound: { sharp: 1,    long: 0.35, pitch: 0.2,  rough: 0.6 },  prio: 5,  stretch: 2, motion: { in: "zip", hold: "shake", out: "shatter" } },
  crack:   { mood: "crack",   sound: { sharp: 0.95, long: 0.2,  pitch: 0.1,  rough: 0.55 }, prio: 4,  stretch: 1, motion: { in: "crackIn", hold: "shake", out: "shatter" } },
  rumble:  { mood: "crash",   sound: { sharp: 0.35, long: 0.95, pitch: -0.8, rough: 1 },    prio: 4,  stretch: 3, motion: { in: "grow", hold: "rattle", out: "fall" } },
  decay:   { mood: "crack",   sound: { sharp: 0.4,  long: 0.75, pitch: -0.5, rough: 1 },    prio: 3,  stretch: 3, motion: { in: "grow", hold: "wobble", out: "droop" } },
  hiss:    { mood: "whoosh",  sound: { sharp: 0.2,  long: 0.8,  pitch: -0.8, rough: 0.55 }, prio: 3,  stretch: 2, motion: { in: "zip", hold: "boil", out: "dissolve" } },
  drag:    { mood: "whoosh",  sound: { sharp: 0.6,  long: 0.85, pitch: -0.2, rough: 0.95 }, prio: 3,  stretch: 3, motion: { in: "zip", hold: "rattle", out: "zipout" } },
  engine:  { mood: "whoosh",  sound: { sharp: 0.4,  long: 0.8,  pitch: 0.1,  rough: 0.8 },  prio: 3,  stretch: 3, motion: { in: "zip", hold: "boil", out: "zipout" } },
  whump:   { mood: "boom",    sound: { sharp: 0.15, long: 0.45, pitch: -0.7, rough: 0.4 },  prio: 2,  stretch: 2, motion: { in: "grow", hold: "throb", out: "dissolve" } },
  roar:    { mood: "fire",    sound: { sharp: 0.35, long: 1,    pitch: 0.3,  rough: 0.85 }, prio: 2,  stretch: 3, motion: { in: "grow", hold: "flicker", out: "rise" } },
  crackle: { mood: "fire",    sound: { sharp: 0.85, long: 0.1,  pitch: 0.4,  rough: 0.7 },  prio: 1,  stretch: 0, motion: { in: "pop", hold: "flicker", out: "dissolve" } }
};

export const WORDS = {
  en: {
    boom:    { s: ["BLAM!", "BANG!", "POW!", "BAM!"], m: ["BO+M!", "KABO+M!", "BLA+MM!", "KA-BLA+M!"], l: ["KA-BO+O+M!", "KRA-KABO+M!", "BRA-KO+O+M!", "KA-THO+O+M!"] },
    crash:   { s: ["THUD!", "CRUNCH!", "KLUNK!", "THUMP!"], m: ["CRA+SH!", "CRU+NCH!", "SMA+SH!", "KRA+-THUD!"], l: ["KRAKATA+K!", "KA-RA+SH!", "KRA-KA-THO+M!", "CRA-CRA+SH!"] },
    zap:     { s: ["ZAK!", "BZZT!", "KZT!"], m: ["ZZA+KK!", "KRZZ+T!", "BZZZA+K!"], l: ["KRA-KA-BO+M!", "ZZZA-KRA+K!", "KA-ZZA+P!"] },
    thud:    { s: ["THUD!", "WHAM!", "BONK!"], m: ["THO+M!", "WHA+M!", "WHU+MP!"], l: ["KA-THO+O+M!", "WHA+A+M!", "THU+U+D!"] },
    gun:     { s: ["BLAM BLAM", "RAT-TAT!", "BRAP!"], m: ["BLAM\nBLAM\nBLAM", "RAT-A-TAT-TAT!", "BRRRAT!"], l: ["BLAM\nBLAM\nBLAM\nBLAM", "RATATATATAT!", "BRRRRRAT!"] },
    fire:    { s: ["FOOF!", "FWIP!", "FUMP!"], m: ["FWOO+SH!", "FO+OM!", "WHOO+MF!"], l: ["FWOO+O+SH!", "WHOO+O+MPF!", "VRA-WHOO+M!"] },
    splash:  { s: ["SPLAT!", "SPLOT!", "BLOOP!"], m: ["SPLOO+SH!", "SPLA+SH!", "SPLOO+T!"], l: ["KA-SPLOO+O+SH!", "SPLA-SPLA+SH!", "SPLOO+O+ORSH!"] },
    arcane:  { s: ["VWIP!", "SHWM!", "VMM"], m: ["VWOO+M!", "WHU+MM!", "SHHWA+M!"], l: ["VWAA+A+M!", "VWO+O+O+M!", "SHHWA+A+MM!"] },
    slash:   { s: ["SKRITCH!", "SLASH!", "SHRAK!"], m: ["SKRI+I+TCH!", "SHRA+KK!", "KERZA+K!"], l: ["SKRRRRA+K!", "SHRA-KA+K!", "KER-ZA+A+K!"] },
    crack:   { s: ["KRAK!", "SNAP!", "KRIK!", "TIK!"], m: ["KRA+K!", "KRRAK!", "CRA+CK!", "SHRAKK!"], l: ["KRRRA-KA+K!", "KKKA-RA+CK!", "KRAKATA+K!"] },
    rumble:  { s: ["RMBL", "GRMM", "DRUM"], m: ["RU+MBLE", "THRRRU+M", "GRRRO+MM"], l: ["RU+U+MBLE", "THRRRU+U+M", "GRRRRO+O+MM"] },
    decay:   { s: ["SKRNCH", "KRRK", "CRMBL"], m: ["KRRRMBL", "CRU+MBLE", "SKRRRNCH"], l: ["KRRRRRMBL", "CRU+U+MBLE", "SKRRRRRNCH"] },
    hiss:    { s: ["TSS", "PSST", "FSST"], m: ["PSSS+H", "TSSS+S", "FSSS+HH"], l: ["PSSSS+S+HH", "TSSSS+S+S", "FSSSS+S+HHH"] },
    drag:    { s: ["SKRT", "SCRP", "SKREE"], m: ["SKRRR+T", "SKREE+E", "SCRAA+PE"], l: ["SKRRRRR+T", "SKREE+E+E", "SCRAA+A+PE"] },
    engine:  { s: ["VRM", "BRAP", "VROOM"], m: ["VRRRO+OM", "BRRRA+P", "NYEE+OW"], l: ["VRRRRO+O+OM", "BRRRRRA+P", "NYEEE+E+OWW"] },
    whump:   { s: ["FWUMP", "WHUMP", "PHUF"], m: ["WHU+MP", "FWU+MP", "WHOO+MPH"], l: ["WHU+U+MP", "FWOO+O+MPH", "WHOO+O+MPH"] },
    roar:    { s: ["FRRSH", "WHRR", "FWRR"], m: ["FRRRRSH+HH", "WHRRR+R", "VRRROO+AR"], l: ["FRRRRRSH+H+HH", "WHRRRR+R+R", "VRRRROO+O+AR"] },
    crackle: { s: ["KRSSH", "KRK-KRK", "SNAP-SNAP", "CRACKLE", "KRIK"], m: ["KRSSH", "KRK-KRK", "SNAP-SNAP", "CRACKLE"], l: ["KRSSH", "KRK-KRK", "CRACKLE"] }
  },
  pl: {
    boom:    { s: ["BACH!", "PAF!", "BUM!", "TRACH!"], m: ["BU+M!", "BU-BU+M!", "TRA+CH!", "BU+CH!"], l: ["KA-BU+U+M!", "ŁUBUDU+!", "BU+U+U+M!", "TRA-TA-BU+M!"] },
    crash:   { s: ["ŁUP!", "BĘC!", "CHRUP!", "GRUCH!"], m: ["ŁUBU+DU!", "TRZA+SK!", "KRA+CH!", "GRU+CH!"], l: ["ŁU-BU-DU+!", "KRA-KA-TA+K!", "GRU+U+CH!", "TRA-TA-TRZA+SK!"] },
    zap:     { s: ["BZYK!", "BZZT!", "TRZ!"], m: ["BZZZ+T!", "TRZA+SK!", "ZZZA+P!"], l: ["TRA-TA-BU+M!", "TRZA-TRZA+SK!", "BZZZZA+P!"] },
    thud:    { s: ["ŁUP!", "BĘC!", "BUCH!"], m: ["ŁU+UP!", "BU+CH!", "GRU+CH!"], l: ["ŁU+U+UP!", "BU+U+CH!", "GRU+U+U+CH!"] },
    gun:     { s: ["PAF PAF", "TA-TA!", "PIF-PAF!"], m: ["PAF\nPAF\nPAF", "TRA-TA-TA!", "RATATATA!"], l: ["PAF\nPAF\nPAF\nPAF", "TRA-TA-TA-TA-TA!", "RATATATATA!"] },
    fire:    { s: ["PUF!", "FFU!", "BUCH!"], m: ["FRU+U+M!", "BU+CH!", "WHU+UF!"], l: ["FRU+U+U+M!", "BU-BU+CH!", "WHU+U+UF!"] },
    splash:  { s: ["PLUM!", "CHLUP!", "PLASK!"], m: ["PLU+SK!", "CHLU+P!", "CHLA+ST!"], l: ["PLU+U+SK!", "CHLU-CHLU+P!", "CHLA+A+ST!"] },
    arcane:  { s: ["WUM!", "SZUM!", "WIU!"], m: ["WU+U+M!", "SZU+UM!", "WRRU+M!"], l: ["WU+U+U+M!", "SZU+U+U+M!", "WRRRU+U+M!"] },
    slash:   { s: ["CIACH!", "SZRAK!", "CHLAST!"], m: ["CIA+CH!", "SZRRRA+K!", "CHLA+ST!"], l: ["SZRRRA-KA+K!", "CIA-CIA+CH!", "CHLA-CHLA+ST!"] },
    crack:   { s: ["KRAK!", "TRZASK!", "CHRUP!", "PYK!"], m: ["TRZA+SK!", "KRA+K!", "CHRZĘ+ST!"], l: ["TRZA-TRZA+SK!", "KRRRA-KA+K!", "KRA-KA-TA+K!"] },
    rumble:  { s: ["DUDU", "GRRM", "BRUM"], m: ["DUDUDU+DU", "GRRRU+UM", "BRRRU+UM"], l: ["DUDUDUDU+DU", "GRRRRU+U+UM", "BRRRRU+U+UM"] },
    decay:   { s: ["KRRR", "CHRZĘST", "SZURR"], m: ["KRRRR+R", "CHRZĘ+ST", "SZURRR+R"], l: ["KRRRRR+R+R", "CHRZĘ+Ę+ST", "SZURRRR+R+R"] },
    hiss:    { s: ["PSST", "SYK", "TSS"], m: ["PSSS+S", "SSSY+K", "SYYY+K"], l: ["PSSSS+S+S", "SSSSY+Y+K", "SYYYY+Y+K"] },
    drag:    { s: ["SZUR", "ZGRZYT", "SKRZYP"], m: ["SZUUU+RR", "ZGRZY+YT", "SKRZYY+P"], l: ["SZUUUU+U+RR", "ZGRZYY+Y+YT", "SKRZYYY+Y+P"] },
    engine:  { s: ["WRR", "BRUM", "WRUM"], m: ["WRRRU+UM", "BRRRU+UM", "WRRRR+R"], l: ["WRRRRU+U+UM", "BRRRRU+U+UM", "WRRRRR+R+R"] },
    whump:   { s: ["BUF", "HUF", "PUF"], m: ["BU+UF", "HU+UF", "PUFF"], l: ["BU+U+UF", "HU+U+UF", "PU+U+FF"] },
    roar:    { s: ["FRRR", "HUUU", "SZUM"], m: ["FRRRR+R", "HUUUU+U", "SZUUU+M"], l: ["FRRRRR+R+R", "HUUUUU+U+U", "SZUUUU+U+M"] },
    crackle: { s: ["TRZ-TRZ", "TRZASK", "PSTRYK", "TRZESZCZ"], m: ["TRZ-TRZ", "TRZASK", "TRZESZCZ"], l: ["TRZ-TRZ", "TRZESZCZ"] }
  }
};

/** The word set for a language setting: "en" / "pl", or "auto" (the game's language: Polish -> "pl", any other -> "en"). */
export const langOf = (setting, gameLang = "en") => (setting === "en" || setting === "pl" ? setting : String(gameLang).toLowerCase().startsWith("pl") ? "pl" : "en");

/** A word template stretched: every "+" repeats the letter before it `extra` more times (BO+M, 2 -> BOOOM). */
export function expand(tpl, extra) {
  // the stretch is SHARED by the word's "+" marks (KA-BO+O+M at 3 -> KA-BOOOOOM, not two letters stretched three times each)
  const marks = (tpl.match(/\+/g) ?? []).length, total = Math.max(marks ? 1 : 0, Math.min(5, Math.round(extra)));
  let out = "", k = 0, given = 0;
  for ( let i = 0; i < tpl.length; i++ ) {
    const c = tpl[i];
    if ( c === "+" ) { k++; const n = Math.round((total * k) / marks) - given; given += n; const prev = out[out.length - 1]; if ( prev ) out += prev.repeat(n); continue; }
    out += c;
  }
  return out;
}

/** The size tier of a magnitude 0..1. */
export const tierOf = (m) => (m < 0.34 ? "s" : m < 0.67 ? "m" : "l");

/**
 * The word for a voice at magnitude `m` (0..1): from the bank by `h` (an integer hash: the same everywhere), skipping the words in
 * `taken` (other words of the same moment), stretched by how loud it is.
 */
export function wordFor(voice, m, h, lang = "en", taken = null) {
  const bank = (WORDS[lang] ?? WORDS.en)[voice] ?? WORDS.en[voice] ?? WORDS.en.crack;
  const list = bank[tierOf(m)];
  const V = VOICES[voice] ?? VOICES.crack;
  const extra = V.stretch * Math.max(0, m - 0.2) / 0.8;
  for ( let i = 0; i < list.length; i++ ) {
    const w = expand(list[(h + i) % list.length], extra);
    if ( !taken?.has(w) ) return w;
  }
  return expand(list[h % list.length], extra);
}
