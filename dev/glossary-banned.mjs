/* The banned variants of dev/glossary-pl.md, as data: a Polish interface string that matches `re` fails scripts/i18n/check-glossary.mjs.
   Each rule: { id (the glossary's conflict or entry), re, use (what to write instead), allow? (keys where the word is right) }.
   Placeholders ({name}, ${n}) are removed from a string before it is tested. The same file is copied into the sibling modules
   (moinen-maps, invincible-splash, invincible-balancer: dev/glossary-banned.mjs there); check-glossary compares the copies when it finds them.
   When the glossary changes, change THIS file first. Pure data. */
export const BANNED = Object.freeze([
  { id: "A1", re: /(?<!\p{L})(Resolve|RESOLVE)(?!\p{L})/u, use: "Determinacja" },
  { id: "A1", re: /(?<!\p{L})(Wol[aięąo]|Hart(u|em)?)(?!\p{L})/u, use: "Determinacja" },
  { id: "A2", re: /(?<!\p{L})(Health|HEALTH)(?!\p{L})/u, use: "Zdrowie" },
  { id: "A3", re: /Charyzm|CHARYZM|Obecnoś|OBECNOŚ/u, use: "Prezencja", allow: [/^INVINCIBLE\.Ability\.Cha\./] },
  { id: "A4", re: /walk\p{L}* wręcz/iu, use: "Walka (atrybut), bijatyka (starcie wręcz)" },
  { id: "A5", re: /Zręcznoś|ZRĘCZNOŚ/u, use: "Zwinność", allow: [/^INVINCIBLE\.Ability\.Dex\./] },
  { id: "A6", re: /(?<!\p{L})stunt/iu, use: "wyczyn" },
  { id: "A7", re: /(?<!\p{L})push|(?<!\p{L})pchnię[tc]/iu, use: "forsować rzut / forsowanie / rzut forsowany" },
  { id: "A8", re: /slugfest/iu, use: "Bijatyka" },
  { id: "A9", re: /obrażeni\p{L}* krytyczn|krytyczn\p{L}* (ran|obrażeni)|(?<!\p{L})krytyk/iu, use: "rana krytyczna; Próg rany" },
  { id: "A10", re: /(?<!\p{L})BN(?!\p{L})/u, use: "NPC" },
  { id: "A11", re: /sługusi(?!\p{L})|pachoł/iu, use: "sługusy (niemęskoosobowe)" },
  { id: "A12", re: /(?<!\p{L})token/iu, use: "żeton" },
  { id: "A13", re: /(?<!\p{L})GM(?!\p{L})/u, use: "MG (nieodmienne)" },
  { id: "A14", re: /poziom\p{L}* (Główn|Ogromn|Potworn)/u, use: "Większy / Potężny / Monstrualny" },
  { id: "A15", re: /Kosmiczn\p{L}* (mistrz|champion)/iu, use: "Kosmiczny czempion" },
  { id: "A17", re: /wad\p{L}* charakteru/iu, use: "Słabość" },
  { id: "A19", re: /w ruinie|zniszcz\p{L}* stref|stref\p{L}* (jest |została |już )?zniszcz/iu, use: "zdemolować strefę / demolka strefy / zdemolowana" },
  { id: "A20", re: /wysoko (na|w) niebie/iu, use: "Ponad chmurami" },
  { id: "A21", re: /wyniesi/iu, use: "Na wysokości" },
  { id: "A22", re: /Wyrzucon|[Ww]ypadł/u, use: "Wylosowano / Rzut K66: {n}" },
  { id: "A23", re: /(?<!\p{L})\d*D(6|66|3)(?![\p{L}\d])|(?<!\p{L})\d*k(6|66|3)(?![\p{L}\d])/u, use: "K6, K66, K3" },
  { id: "A24", re: /kostk|kostek/iu, use: "kość, kości" },
  { id: "A25", re: /generator(?! liczb)/iu, use: "kreator postaci" },
  { id: "A26", re: /Challenge Rating|Time Limit|(?<!\p{L})(CR|TL|PT)(?!\p{L})|poziom\p{L}* trudności/iu, use: "Stopień wyzwania (SW), Limit czasu (LC)" },
  { id: "A27", re: /pułapk/iu, use: "Uwięzienie / Uwięziony / Wydostań się" },
  { id: "A28", re: /losowani\p{L}* inicjatyw|inicjatyw\p{L}* nie rzucon|rzu\p{L}* na inicjatyw/iu, use: "dobieranie inicjatywy, karta inicjatywy" },
  { id: "A30", re: /wyposażeni/iu, use: "Sprzęt" },
  { id: "A31", re: /z ograniczeniem/iu, use: "Reglamentowany (R)" },
  { id: "A32", re: /(?<=[\p{Ll},;:)] \(?)(Tw[oó][ijm]|Ciebie|Tobie|Tobą)/u, use: "ty, twój małą literą" },
  { id: "A33", re: /akcj\p{L}* (szybk|pełn)/iu, use: "szybka akcja, pełna akcja" },
  { id: "B6", re: /bez wolnej akcji/iu, use: "dostępna akcja" },
  { id: "B7", re: /ważn\p{L}* (NPC|relacj|posta\p{L}+ niezależn)/iu, use: "Kluczowy (Key), Znaczący NPC (Major)" },
  { id: "38", re: /(?<!\p{L})bonus/iu, use: "premia" },
  { id: "110", re: /bazow\p{L}* obrażeni|obrażeni\p{L}* bazow/iu, use: "obrażenia podstawowe" },
  { id: "149", re: /sztuczk\p{L}* strzeleck/iu, use: "Popisowy strzał" },
  { id: "152", re: /śmierteln\p{L}* cios/iu, use: "Zabójcze trafienie" },
  { id: "R5", re: /Deklaruję/u, use: "Zadeklaruj" },
  { id: "R12", re: /(?<!\p{L})HUD(?!\p{L})|(?<!\p{L})dock(?!\p{L})/iu, use: "panel / pasek akcji" },
  { id: "R10", re: /(?<!\p{L})(Fighting|Agility|Strength|Intuition|Presence|Stress|Minions|Drawback|Wreck Zone|Double Damage|Knockback|Bang Heads|Deadly Hit|Trick Shot)(?!\p{L})/u, use: "polski termin z glosariusza" },
]);
const strip = (s) => String(s).replace(/\$\{[^}]*\}/g, " ").replace(/\{[\w.]+\}/g, " ");
/** The banned variants a Polish string uses: [{ id, use, hit }]. `key` lets a rule's allow-list apply. */
export function bannedIn(text, key = "") {
  const t = strip(text), out = [];
  for (const r of BANNED) {
    if (r.allow?.some((a) => a.test(key))) continue;
    const m = r.re.exec(t);
    if (m) out.push({ id: r.id, use: r.use, hit: m[0] });
  }
  return out;
}
