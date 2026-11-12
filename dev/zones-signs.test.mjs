// Signs (zones-api.md section 40; scripts/zones/signs-core.mjs and where the map takes them: board-core.mjs cleanMenu /
// cleanTokenMarks, highlight.mjs cleanHighlight / cleanPick): a caller's words and pictures where the map draws its text, cleaned so
// that nothing of the caller's can break out of the drawing; and a call without signs is cleaned exactly as before.
//   node dev/zones-signs.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const S = await imp("scripts/zones/signs-core.mjs");
const BC = await imp("scripts/zones/board-core.mjs");
const HL = await imp("scripts/zones/highlight.mjs");

let failed = 0, n = 0;
const check = (ok, msg) => { n++; if ( !ok ) { failed++; console.log(`FAIL ${msg}`); } };
const J = JSON.stringify;

/* ---- A. one sign */
const SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M1.5,3.5L12,3.5L10.5,8.5L0,8.5Z'/%3E%3C/svg%3E";
const quick = { name: "Quick action", el: { tag: "i", cls: "ipu-cost ipu-k-quick" }, img: SVG, w: 12 };
const q = S.cleanSign(quick);
check(q && q.name === "Quick action" && q.el.tag === "i" && q.el.cls === "ipu-cost ipu-k-quick" && q.w === 12, "A1 a sign keeps its name, its drawing and its width");
check(!/["'()\s]/.test(q.img) && q.img.startsWith("data:image/svg+xml,"), "A2 a picture's address has no quote, bracket or space left (it stands unquoted in url())");
check(S.cleanImg("javascript:alert(1)") === null && S.cleanImg("data:text/html,<b>") === null && S.cleanImg("http://x/y.gif") === null && S.cleanImg("modules/a/b.svg") === "modules/a/b.svg", "A3 only an image: data:image svg/png/webp, or a path to an svg/png/webp");
check(S.cleanImg("x.svg) ; background:url(evil.png") === "x.svg%29%20;%20background:url%28evil.png" || S.cleanImg("x.svg) ; background:url(evil.png") === null, "A4 a picture's address cannot close the url() it stands in");
check(S.cleanClasses(`a b" onclick="x c<d e_f g-h`) === "a e_f g-h", "A5 classes: only plain words go through");
const deep = S.cleanSign({ el: { tag: "script", cls: "x", kids: [{ tag: "b", text: "<img src=x>", kids: [{ tag: "span", kids: [{ tag: "i", kids: [{ tag: "i" }] }] }] }] } });
check(deep.el.tag === "i" && deep.el.kids[0].tag === "b" && !J(deep).includes("script") && J(deep).split('"tag"').length - 1 <= S.SIGN_LIMITS.depth, "A6 a drawing: only i / b / span, at most three deep");
check(S.cleanSign({ name: "nothing" }) === null && S.cleanSign(null) === null && S.cleanSign({ n: 3 }).n === "3", "A7 a sign that draws nothing is no sign; a number alone is one");
check(S.cleanSign({ icon: 'fa-solid fa-heart" onmouseover="x' }).icon === "fa-solid fa-heart onmouseoverx", "A8 an icon class keeps no quote");

/* ---- B. pieces */
const P = S.cleanPieces(["Run: ", quick, " ", { name: "Stress: 1", el: { tag: "b", cls: "ipu-stress", kids: [{ tag: "i", cls: "ipu-cost ipu-k-stress" }], text: "1" } }], 24);
check(P.length === 4 && P[0] === "Run: " && typeof P[1] === "object", "B1 words and signs in order");
check(S.cleanPieces(["only words"], 24) === null && S.cleanPieces("text", 24) === null && S.cleanPieces([], 24) === null, "B2 pieces with no sign: none (the text is drawn as before)");
const long = S.cleanPieces(["x".repeat(30), quick, "y".repeat(10)], 24);
check(long[0].length === 24 && long.length === 2, "B3 the words are cut to the field's length together; the signs never count");
const html = S.piecesHtml(["<b>", quick]);
check(html.startsWith("&lt;b&gt;") && html.includes('<i class="ipu-cost ipu-k-quick" role="img" aria-label="Quick action" data-tooltip="Quick action"></i>'), "B4 HTML: words escaped, the caller's drawing with its classes, named (role img, aria-label, tooltip)");
const silent = S.signHtml(S.cleanSign({ el: { tag: "i", cls: "a" } }));
check(silent === '<i class="a" aria-hidden="true"></i>', "B5 a sign without a name is silent");
const own = S.signHtml(S.cleanSign({ img: SVG, w: 8, n: 2, name: 'say "2"' }));
check(own.includes('class="mm-z-sign"') && own.includes("--mm-sign: url(data:image/svg+xml,") && own.includes("aspect-ratio: 8 / 12") && own.includes("<b>2</b>") && own.includes("say &quot;2&quot;"), "B6 the map's own drawing: the picture as a mask with its width, the number after it");
check(S.piecesHtml(null, "<x>") === "&lt;x&gt;", "B7 no pieces: the text, escaped");
check(S.piecesText(P) === "Run: Quick action Stress: 1" && S.piecesText(S.cleanPieces([quick, quick], 9)) === "Quick action, Quick action", "B8 pieces as words: each sign says its name");
check(S.cleanSigns({ hint: [quick], nope: [quick] }, { hint: 24 }).hint.length === 1 && !("nope" in S.cleanSigns({ hint: [quick], nope: [quick] }, { hint: 24 })) && S.cleanSigns({ hint: ["a"] }, { hint: 24 }) === null, "B9 signs of an entry: only the fields the surface draws");
check(S.cleanPieces(Array.from({ length: 30 }, () => quick), 24).length === S.SIGN_LIMITS.pieces, "B10 at most ten pieces");

/* ---- C. where the map takes them */
const items = [{ id: "a", label: "Attack", hint: "Quick", signs: { hint: [quick] } }, { id: "b", label: "Grab", hint: "Full" }];
const M = BC.cleanMenu({ title: "Wall, Armor 2", sub: "Locked, Armor 2", signs: { sub: ["Locked, ", { name: "Armor: 2", n: 2, img: SVG }] }, items });
check(M.items[0].signs.hint[0].name === "Quick action" && !("signs" in M.items[1]) && M.signs.sub.length === 2 && !M.signs.title, "C1 a menu: a row's hint and the sub line take signs; a row without keeps its shape");
const M0 = BC.cleanMenu({ title: "T", items: [{ id: "b", label: "Grab", hint: "Full" }] });
check(J(M0) === J({ title: "T", sub: null, items: [{ id: "b", label: "Grab", icon: null, hint: "Full", tip: null, disabled: false, tone: null, stepper: null, toggle: false, on: false, i: 0 }] }), "C2 a menu without signs is cleaned exactly as before");
const H = HL.cleanHighlight({ id: "h", zones: [{ zone: "z1", label: "Quick", signs: { label: [quick], tip: ["Run: ", quick] } }, { zone: "z2", label: "Full" }] });
check(H.zones[0].signs.label.length === 1 && H.zones[0].signs.tip.length === 2 && !("signs" in H.zones[1]), "C3 a highlight's zone: label and tip take signs");
const PK = HL.cleanPick({ zones: [{ zone: "z1", label: "Quick", tip: "Run", signs: { label: [quick] } }, "z2"] });
check(PK.zones[0].signs.label.length === 1 && !("signs" in PK.zones[1]), "C4 a pick's zone: the same");
const TM = BC.cleanTokenMarks({ id: "m", tokens: [{ token: "abc", label: "good", signs: { label: ["good ", quick] }, hover: { label: "good -2", signs: { label: ["good ", { n: "-2", icon: "fa-burst", name: "Damage: -2" }] } } }, { token: "def", signs: { label: [quick] } }] });
check(TM.tokens[0].signs.label.length === 2 && TM.tokens[0].hover.signs.label[1].icon === "fa-burst" && !("signs" in TM.tokens[1]), "C5 a token's label and its hover label take signs; signs without words are dropped (the words are the fallback)");

console.log(failed ? `${failed} failed of ${n}` : `all ${n} sign checks passed`);
process.exit(failed ? 1 : 0);
