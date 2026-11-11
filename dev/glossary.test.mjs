// The Polish interface speaks ONE vocabulary (the glossary of invincible-plus-ultra: dev/glossary-pl.md there):   node dev/glossary.test.mjs
// 1) no Polish string of lang/pl.json (or a Polish literal in scripts/) uses a variant the glossary rejected. The rules are
//    dev/glossary-banned.mjs, a verbatim COPY of invincible-plus-ultra/scripts/i18n/glossary-banned.mjs (its check compares the copies:
//    change that file first, then copy it here);
// 2) the rules words of the zones and the director are the glossary's, each rendered one way;
// 3) nothing depends on the language of a label: the system's damage card is recognised in every language it can be written in, and no
//    script compares a stored text with one localize() call;
// 4) every Polish string keeps the placeholders of its English twin.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { BANNED, bannedIn } = await import(pathToFileURL(path.join(root, "dev/glossary-banned.mjs")).href);
const R = await import(pathToFileURL(path.join(root, "scripts/director/rolls-core.mjs")).href);
let n = 0, failed = 0;
const ok = (c, m) => { n++; if ( !c ) { failed++; if ( failed <= 40 ) console.error(`FAIL ${m}`); } };
const flat = (o, p = "", out = {}) => { for ( const [k, v] of Object.entries(o) ) { const kk = p ? `${p}.${k}` : k; if ( v && typeof v === "object" ) flat(v, kk, out); else out[kk] = v; } return out; };
const PL = flat(JSON.parse(fs.readFileSync(path.join(root, "lang/pl.json"), "utf8"))), EN = flat(JSON.parse(fs.readFileSync(path.join(root, "lang/en.json"), "utf8")));
const P = (k) => PL[`MOINENMAPS.${k}`];

// ---- 1) banned variants
ok(BANNED.length > 20, "the banned list is loaded");
for ( const [k, v] of Object.entries(PL) ) {
  if ( typeof v !== "string" ) continue;
  for ( const h of bannedIn(v, k) ) ok(false, `${k}: "${h.hit}" (${h.id}) -> ${h.use}   in: ${v.slice(0, 120)}`);
  ok(true, k);
}
const walk = (d, out = []) => { for ( const f of fs.readdirSync(d) ) { const p = path.join(d, f); if ( fs.statSync(p).isDirectory() ) walk(p, out); else if ( /\.(mjs|js)$/.test(f) ) out.push(p); } return out; };
const sources = walk(path.join(root, "scripts")).map((p) => [path.relative(root, p).split(path.sep).join("/"), fs.readFileSync(p, "utf8")]);
const STR = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
for ( const [f, src] of sources ) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  for ( const s of code.matchAll(STR) ) {
    const t = s[1] ?? s[2] ?? s[3];
    if ( !t || !/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(t) || !/\p{L}{3,} \p{L}{2,}/u.test(t) ) continue;       // a Polish phrase, not a search alias or a glyph
    for ( const h of bannedIn(t, f) ) ok(false, `${f}: "${h.hit}" (${h.id}) -> ${h.use}   in: ${t.slice(0, 120)}`);
    ok(true, f);
  }
}
// the rules themselves bite (a rule that stopped matching would pass everything)
for ( const [bad, id] of [["Przesuń token", "A8"], ["po pushu", "A7"], ["pchnięty rzut", "A7"], ["Wybierz stunty", "A6"], ["rzut na Charyzmę", "A3"]] )
  ok(bannedIn(bad).some((h) => h.id === id) || bannedIn(bad).length > 0, `the banned list catches "${bad}"`);
for ( const fine of ["Odepchnięcie: Atom Eve", "każdy przepchnięty żeton", "Przesuń żeton", "Forsowanie"] ) ok(!bannedIn(fine).length, `"${fine}" is fine`);

// ---- 2) the rules words, one way each
const pins = {
  "Zones.alt.sky": "Ponad chmurami", "Zones.area.sky": "Ponad chmurami", "Zones.place.sky": "Ponad chmurami",
  "Zones.altShort.elevated": "Na wysokości", "Zones.reg.at.elevated": "na wysokości",
  "Zones.state.wrecked": "Zdemolowana", "Zones.reg.kind.wrecked": "Zdemolowana", "Zones.terrain.label": "Demolka",
  "Dir.cap.kPushed": "Forsowanie"
};
for ( const [k, v] of Object.entries(pins) ) ok(P(k) === v, `${k} = "${v}" (is "${P(k)}")`);
ok(/wyczyny/.test(P("Dir.cap.hitStunts")), "stunts are 'wyczyny'");
ok(/rana krytyczna/.test(P("Dir.cap.dmgCrit")), "a critical injury is 'rana krytyczna'");
const RULES = [
  [/(?<!\p{L})tokeny?(?!\p{L})|(?<!\p{L})token(a|u|em|ie|ów|om|ach|ami)(?!\p{L})/iu, "żeton"],
  [/(?<!\p{L})GM(?!\p{L})|(?<!\p{L})BN(?!\p{L})/u, "MG / NPC"],
  [/(?<!\p{L})k\d+(?!\p{L})/u, "K6 (capital K)"],
  [/zniszczon\p{L}* stref|stref\p{L}* (jest |staje się )?zniszczon/iu, "strefa zdemolowana"],
  [/trackerz?e? walki|tracker walki/iu, "panel śledzenia walki"],
  [/(?<=[a-ząćęłńóśźż,;:] )(Twój|Twoj|Twoi|Ciebie|Tobie|Ci )/u, "twój / ciebie in lower case inside a sentence"]
];
for ( const [k, v] of Object.entries(PL) ) for ( const [re, use] of RULES ) {
  const t = String(v).replace(/\{[\w.]+\}/g, " ");
  ok(!re.test(t), `${k}: "${re.exec(t)?.[0]}" -> ${use}   in: ${String(v).slice(0, 120)}`);
}

// ---- 3) nothing depends on a label's language
ok(R.isDamageFlavor("Damage Taken") && R.isDamageFlavor("Otrzymane obrażenia") && R.isDamageFlavor(" Damage Taken "), "the damage card is known in English and in Polish, whatever this client speaks");
ok(R.isDamageFlavor("Schaden erlitten", "Schaden erlitten") && !R.isDamageFlavor("Schaden erlitten", "Damage Taken"), "and in the client's own language");
ok(!R.isDamageFlavor("") && !R.isDamageFlavor(null) && !R.isDamageFlavor("Fighting"), "other cards are not damage cards");
{
  const pl = R.damageFacts("<p><strong>Atom Eve</strong>: otrzymane obrażenia: <strong>3</strong>.</p>"), en = R.damageFacts("<p><strong>Atom Eve</strong> took <strong>3</strong> damage.</p>");
  ok(pl.dmg === 3 && en.dmg === 3 && !pl.crit && !en.crit, "the damage is read from a Polish card as from an English one");
  ok(R.damageFacts("<p><strong>7</strong>: otrzymane obrażenia: <strong>2</strong>.</p><p>Rana krytyczna</p>").dmg === 2, "a numeric name is not the damage");
}
for ( const [f, src] of sources ) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  ok(!/(===|!==|==|!=)\s*game\.i18n\.(localize|format)\(|game\.i18n\.(localize|format)\([^)]*\)\s*(===|!==|==|!=)/.test(code), `${f}: a stored text is compared with ONE localize() call (a card written in another language is missed): compare with every rendering`);
}

// ---- 4) placeholders
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
for ( const [k, v] of Object.entries(PL) ) if ( k in EN ) ok(ph(v) === ph(EN[k]), `${k}: placeholders {${ph(v)}} differ from the English {${ph(EN[k])}}`);

if ( failed ) { console.error(`FAIL glossary: ${failed} of ${n} checks failed`); process.exit(1); }
console.log(`OK ${n} checks (glossary)`);
