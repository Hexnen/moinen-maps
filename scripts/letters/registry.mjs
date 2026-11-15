/* LETR (ENGREG 1.9.11): which copy of the engine a page runs. Pure (no Foundry, no DOM); index.mjs applies it.
   The engine folder scripts/letters/ ships in two modules (CARRIERS). When both are active each brings its copy into the page, and
   during every update of one module the two copies are different versions. The rule, the same on every seat:
   1. the choice is made once, after Foundry's "init" (every active module's scripts are loaded then) and after every active
      carrier's copy has been imported (index.mjs imports a missing one itself), never from whichever copy a caller reached first;
   2. the highest VERSION wins; between equal VERSIONs the more recently synced content (stamp.at), then the copy of the canonical
      module (moinen-maps) wins: content only, so every seat that loaded the same files runs the same engine;
   3. the page says what it runs: L.build / MoinenLetters.build (version, content hash, which module's copy, the copies seen), and
      every seat tells the GM its build at ready (L.seats(): a seat that runs another build than the GM's is named on both seats). */
export const CARRIERS = ["moinen-maps", "invincible-plus-ultra"];   // canonical first
export const RULE = 2;   // the registry's own rule revision (1 = the first-come registry before 1.9.11)

export function cmpVer(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for ( let i = 0; i < Math.max(3, pa.length, pb.length); i++ ) if ( (pa[i] || 0) !== (pb[i] || 0) ) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}
/** the module a copy came from (its URL holds modules/<id>/scripts/letters/), else null */
export function moduleOf(base) {
  const m = /\/modules\/([^/]+)\/scripts\/letters\/?$/.exec(String(base ?? "").replace(/[?#].*$/, ""));
  return m ? decodeURIComponent(m[1]) : null;
}
const rank = (c) => { const i = CARRIERS.indexOf(moduleOf(c.base)); return i < 0 ? CARRIERS.length : i; };
/** the copies in the order of the rule (the winner first) */
export function ranked(copies) {
  return (copies ?? []).slice().sort((a, b) => cmpVer(b.version, a.version) || String(b.stamp?.at ?? "").localeCompare(String(a.stamp?.at ?? "")) || rank(a) - rank(b) || String(a.base).localeCompare(String(b.base)));
}
/** the winner and why, plus a warning when two copies of one VERSION differ in content */
export function chooseCopy(copies) {
  const r = ranked(copies), best = r[0] ?? null;
  if ( !best ) return { best: null, why: "none", warn: null };
  const twin = r.find((c) => c !== best && cmpVer(c.version, best.version) === 0 && c.stamp?.hash && best.stamp?.hash && c.stamp.hash !== best.stamp.hash);
  const other = r[1];
  const why = !other ? "only copy" : cmpVer(best.version, other.version) > 0 ? "highest version" : twin ? "same version, more recently synced" : "same content";
  return { best, why, warn: twin ? `two copies of engine ${best.version} differ; using the more recently synced one (${moduleOf(best.base) ?? best.base}). Bump VERSION when the engine changes.` : null };
}
/** what a page runs, for L.build and the seats' hello */
export function buildOf(best, copies, why) {
  return Object.freeze({
    version: best?.version ?? null, hash: best?.stamp?.hash ?? null, at: best?.stamp?.at ?? null, module: moduleOf(best?.base), why: why ?? null,
    copies: Object.freeze((copies ?? []).map((c) => Object.freeze({ version: c.version, hash: c.stamp?.hash ?? null, module: moduleOf(c.base) })))
  });
}
/** the URL of another carrier's index.mjs, next to this copy's own (same server, same route prefix) */
export function carrierUrl(base, id) {
  const s = String(base ?? "");
  if ( !/\/modules\/[^/]+\/scripts\/letters\/?$/.test(s.replace(/[?#].*$/, "")) ) return null;
  return s.replace(/\/modules\/[^/]+\/scripts\/letters\/?(?:[?#].*)?$/, `/modules/${encodeURIComponent(id)}/scripts/letters/index.mjs`);
}
/** two builds the same engine? (version and content) */
export const sameBuild = (a, b) => !!a && !!b && a.version === b.version && (a.hash ?? null) === (b.hash ?? null);
