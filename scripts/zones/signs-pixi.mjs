/**
 * SIGNS on the canvas (zones-api.md section 40): a row of words and signs (signs-core.mjs cleanPieces) as one PIXI container, for
 * the labels the map writes on zones. A sign's picture is a mask painted in one colour (the sign's `color`, else the row's text
 * colour); its width is known before the picture loads, so a label never changes its size when the picture arrives. A sign with
 * an icon draws that Font Awesome glyph; a sign with neither draws its number, or its name.
 */
import { glyphOf } from "./board-layer.mjs";

/** a painted picture: one texture per picture, colour and height (the pictures are few: a caller's handful of marks) */
const TEX = new Map();
function paintedTexture(img, w, color, hPx) {
  const key = `${img}|${color}|${hPx}`;
  if ( TEX.has(key) ) return TEX.get(key);
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(hPx * w / 12)); cv.height = hPx;
  const tex = PIXI.Texture.from(cv);
  if ( typeof Image !== "function" ) return tex;
  const im = new Image();
  im.onload = () => {
    try {
      const g = cv.getContext("2d");
      g.clearRect(0, 0, cv.width, cv.height);
      g.drawImage(im, 0, 0, cv.width, cv.height);
      g.globalCompositeOperation = "source-in";
      g.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
      g.fillRect(0, 0, cv.width, cv.height);
      tex.baseTexture.update();
    } catch { /* a picture that cannot be painted stays empty: its place is kept */ }
  };
  im.src = img;
  if ( TEX.size > 200 ) TEX.delete(TEX.keys().next().value);
  TEX.set(key, tex);
  return tex;
}

/**
 * A row: { c (PIXI.Container, its middle at y 0, starting at x 0), w (its width) }.
 * style: { fontFamily, fontSize, fill (the text colour, a number), resolution, glyph (the picture's height in px), gap }
 */
export function piecesRow(pieces, { fontFamily = "Signika, sans-serif", fontSize = 14, fill = 0xf3e7c9, resolution = 2, glyph = 12, gap = 3 } = {}) {
  const c = new PIXI.Container();
  let x = 0;
  const put = (o, w) => { o.position.x = x + (o.anchor ? w * o.anchor.x : 0); c.addChild(o); x += w; };
  const words = (s, bold = true, color = fill, size = fontSize) => {
    const T = new PIXI.Text(s, { fontFamily, fontWeight: bold ? "700" : "400", fontSize: size, fill: color });
    T.resolution = resolution; T.anchor.set(0, 0.52);
    return T;
  };
  pieces.forEach((p, i) => {
    if ( i > 0 && typeof p !== "string" && typeof pieces[i - 1] !== "string" ) x += gap;      // two signs side by side: a little air
    if ( typeof p === "string" ) { const T = words(p); put(T, T.width); return; }
    const color = p.color ?? fill;
    if ( p.img ) {
      const S = new PIXI.Sprite(paintedTexture(p.img, p.w ?? 12, color, Math.round(glyph * resolution)));
      S.width = glyph * (p.w ?? 12) / 12; S.height = glyph; S.anchor.set(0, 0.5);
      put(S, S.width);
    } else if ( p.icon ) {
      const [g, font] = glyphOf(p.icon);
      const I = new PIXI.Text(g, { fontFamily: font ? `"${font}"` : fontFamily, fontWeight: "900", fontSize: Math.round(glyph * 0.95), fill: color });
      I.resolution = resolution; I.anchor.set(0, 0.52);
      put(I, I.width);
    }
    const n = p.n ?? (!p.img && !p.icon ? p.name : null);
    if ( n ) { if ( p.img || p.icon ) x += 2; const T = words(String(n), true, fill, Math.round(fontSize * 0.93)); put(T, T.width); }
  });
  return { c, w: x };
}
