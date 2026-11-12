/**
 * SIGNS (zones-api.md section 40) - the pure part (no Foundry, no PIXI, no DOM).
 *
 * A text the map draws on a caller's behalf (a menu row's hint, a menu's title and sub line, the price in a move pick's tooltip, a
 * zone's label and tip) is plain text, escaped and cut. A caller that speaks in pictures (a combat module drawing its prices as bars)
 * may hand the map, beside that text, the same thing as PIECES: words and SIGNS in order. Where the map draws the text it draws the
 * pieces instead; the text stays the words (what a plain surface says, and what the map draws when the pieces are bad).
 *
 * The map draws a sign and knows nothing of what it means. A sign is:
 *   { name,             what it is called: its tooltip and its screen-reader name (role="img"); none: it is silent (aria-hidden)
 *     el,               DOM: the caller's own drawing, a small tree { tag: "i" | "b" | "span", cls, text, kids: [tree] } - the
 *                       caller's classes and stylesheet give it its look (the map adds no style of its own to it)
 *     img, w,           DOM without `el`, and the canvas: a picture (a data: image or a path to an svg / png / webp) used as a MASK,
 *                       painted in the colour of the text it stands in (`color` on the canvas); `w`: its width when it is 12 high
 *     icon,             a Font Awesome class ("fa-solid fa-heart"), where there is no `img`
 *     n,                a number (or short text such as "+2") after the picture
 *     color }           the canvas: the colour of the picture (default: the label's text colour)
 * A piece that is a string is words. Text pieces are cut to the field's length together (the names and the drawing never count).
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const text = (v, max) => { if ( v == null || v === "" ) return null; const s = String(v).replace(/\s+/g, " ").trim(); return s ? s.slice(0, max) : null; };

export const SIGN_LIMITS = Object.freeze({ pieces: 10, depth: 3, kids: 4, classes: 8, name: 120, n: 8, nodeText: 8 });
/** the fields of a thing the map draws whose text may come as pieces */
export const SIGN_FIELDS = Object.freeze(["label", "tip", "hint", "cost", "title", "sub"]);
const TAGS = new Set(["i", "b", "span"]);
const CLS_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,47}$/;

/** class names that can stand in an attribute: words of letters, digits, "_" and "-" only, at most SIGN_LIMITS.classes of them */
export function cleanClasses(v) {
  if ( typeof v !== "string" ) return "";
  return v.split(/\s+/).filter((c) => CLS_RE.test(c)).slice(0, SIGN_LIMITS.classes).join(" ");
}
/**
 * A picture's address made safe to stand unquoted inside CSS url(): a data: image (svg, png, webp) or a relative / http(s) path that
 * ends in .svg / .png / .webp. Quotes, brackets, backslashes and white space are percent-encoded (an image address reads them so).
 * null: anything else.
 */
export function cleanImg(v) {
  if ( typeof v !== "string" || v.length > 8000 ) return null;
  const s = v.trim();
  const ok = /^data:image\/(svg\+xml|png|webp)[;,]/i.test(s) || (/^(https?:\/\/|[A-Za-z0-9_./-])/.test(s) && !/^[a-z]+:(?!\/\/)/i.test(s) && /\.(svg|png|webp)(\?[^#]*)?$/i.test(s));
  if ( !ok ) return null;
  return s.replace(/["'()\\\s<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}
function cleanNode(o, depth) {
  if ( !o || typeof o !== "object" || depth > SIGN_LIMITS.depth ) return null;
  const tag = TAGS.has(o.tag) ? o.tag : "i", cls = cleanClasses(o.cls), t = text(o.text, SIGN_LIMITS.nodeText);
  const kids = Array.isArray(o.kids) ? o.kids.slice(0, SIGN_LIMITS.kids).map((k) => cleanNode(k, depth + 1)).filter(Boolean) : [];
  return { tag, cls, ...(t ? { text: t } : {}), ...(kids.length ? { kids } : {}) };
}
const colorNum = (c) => (typeof c === "number" && Number.isFinite(c) ? Math.max(0, Math.min(0xffffff, Math.round(c))) : typeof c === "string" && /^#?[0-9a-f]{6}$/i.test(c.trim()) ? Number.parseInt(c.trim().replace("#", ""), 16) : null);
/** One sign, cleaned; null: it draws nothing (no drawing, no picture, no icon and no number). */
export function cleanSign(o) {
  if ( !o || typeof o !== "object" ) return null;
  const el = cleanNode(o.el, 1), img = cleanImg(o.img), icon = text(o.icon, 60)?.replace(/[^A-Za-z0-9 _-]/g, "") || null;
  const n = text(o.n, SIGN_LIMITS.n), w = Number(o.w), color = colorNum(o.color);
  if ( !el && !img && !icon && !n ) return null;
  return { name: text(o.name, SIGN_LIMITS.name), el, img, w: Number.isFinite(w) && w > 0 ? Math.min(48, w) : 12, icon, n, color };
}
/**
 * Pieces, cleaned: strings (words) and signs in order, the words cut to `max` characters together. null: not a list, or nothing in it
 * draws (the map then draws the field's text as before).
 */
export function cleanPieces(v, max = 60) {
  if ( !Array.isArray(v) ) return null;
  const out = [];
  let room = max;
  for ( const p of v.slice(0, SIGN_LIMITS.pieces) ) {
    if ( typeof p === "string" || typeof p === "number" ) {
      if ( room <= 0 ) continue;
      const s = String(p).replace(/\s+/g, " ");
      if ( !s ) continue;
      const cut = s.slice(0, room); room -= cut.length; out.push(cut);
    } else { const s = cleanSign(p); if ( s ) out.push(s); }
  }
  // (a piece of words standing at either end loses its outer spaces; between signs a space is the caller's)
  while ( out.length && typeof out[0] === "string" && !out[0].trim() ) out.shift();
  while ( out.length && typeof out[out.length - 1] === "string" && !out[out.length - 1].trim() ) out.pop();
  if ( typeof out[0] === "string" ) out[0] = out[0].trimStart();
  if ( typeof out[out.length - 1] === "string" ) out[out.length - 1] = out[out.length - 1].trimEnd();
  return out.some((p) => typeof p !== "string") ? out : null;
}
/** `signs` of an entry: { <field>: pieces } for the fields named (each cut to its own length); null when none draws. */
export function cleanSigns(v, caps) {
  if ( !v || typeof v !== "object" ) return null;
  const out = {};
  for ( const [f, max] of Object.entries(caps) ) { const p = cleanPieces(v[f], max); if ( p ) out[f] = p; }
  return Object.keys(out).length ? out : null;
}

/* ---------------------------------------------------------------- drawing as HTML (escaped) */
const named = (name) => (name ? ` role="img" aria-label="${esc(name)}" data-tooltip="${esc(name)}"` : ` aria-hidden="true"`);
function nodeHtml(n, attrs = "") {
  return `<${n.tag}${n.cls ? ` class="${n.cls}"` : ""}${attrs}>${(n.kids ?? []).map((k) => nodeHtml(k)).join("")}${n.text ? esc(n.text) : ""}</${n.tag}>`;
}
/** One sign as HTML: the caller's own drawing, or the map's (the picture as a mask in the colour of the text, then the number). */
export function signHtml(s) {
  if ( !s ) return "";
  if ( s.el ) return nodeHtml(s.el, named(s.name));
  const pic = s.img ? `<i class="mm-z-sign-g" style="--mm-sign: url(${s.img}); aspect-ratio: ${s.w} / 12"></i>` : s.icon ? `<i class="mm-z-sign-i ${/(^|\s)fa-/.test(s.icon) ? s.icon : `fa-solid fa-${s.icon}`}"></i>` : "";
  return `<span class="mm-z-sign"${named(s.name)}${s.color != null ? ` style="color: #${s.color.toString(16).padStart(6, "0")}"` : ""}>${pic}${s.n ? `<b>${esc(s.n)}</b>` : ""}</span>`;
}
/** Pieces as HTML (words escaped, signs drawn); `fallback`: the field's text, drawn escaped when there are no pieces. */
export function piecesHtml(pieces, fallback = "") {
  if ( !Array.isArray(pieces) || !pieces.length ) return esc(fallback ?? "");
  return pieces.map((p) => (typeof p === "string" ? esc(p) : signHtml(p))).join("");
}
/** Pieces as words: what a sign is called stands where it is drawn ("Quick action, Stress: 1"). */
export function piecesText(pieces, fallback = "") {
  if ( !Array.isArray(pieces) || !pieces.length ) return fallback ?? "";
  let out = "", prevSign = false;
  for ( const p of pieces ) {
    if ( typeof p === "string" ) { out += p; prevSign = false; continue; }
    out += `${prevSign ? ", " : ""}${p.name ?? p.n ?? ""}`; prevSign = true;
  }
  return out.replace(/\s+/g, " ").trim();
}
