/* LETR tools: the engine's windows (loaded on first use, never in node).
   - Designer (GM): type a word, pick mood or own sound, look, motion, place; scrub the timeline picture by picture; new seed; save as a
     named style (world) or as a macro; play it here or show it to everyone.
   - Settings (everyone): the engine-wide client settings of prefs.mjs.
   - Letter this now (GM, Shift+L): a small box at the cursor; Enter shows the word to everyone at the selected tokens or the cursor. */
import { setPrefs, cursorPoint } from "./tools.mjs";
import { SETTINGS, DEFAULTS, STYLE_NAME } from "./prefs.mjs";
import { MOODS, MOOD_IDS, FONTS, COLORS, TICK } from "./design.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;
const T = (k, d) => (d ? game.i18n.format(`LETR.${k}`, d) : game.i18n.localize(`LETR.${k}`));
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const FONT_NAMES = { bangers: "Bangers", anton: "Anton", titan: "Titan One", bungee: "Bungee", blackops: "Black Ops One", sigmar: "Sigmar",
  knewave: "Knewave", wetpaint: "Rubik Wet Paint", patrick: "Patrick Hand" };
const SOUND = ["loud", "sharp", "long", "pitch", "rough", "peak"];
const moodLabel = (id) => { const k = `LETR.Mood.${id}`; return game.i18n.has(k) ? game.i18n.localize(k) : (MOODS[id]?.label ?? id); };
const palLabel = (id) => { const k = `LETR.Palette.${id}`; return game.i18n.has(k) ? game.i18n.localize(k) : id; };

/* the stylesheet and the comic face for the word fields, from this copy's folder */
function ensureStyles(state) {
  if ( document.getElementById("moinen-letters-tools-css") ) return;
  const link = document.createElement("link");
  link.id = "moinen-letters-tools-css"; link.rel = "stylesheet"; link.href = new URL("tools.css", state.base).href;
  const face = document.createElement("style");
  face.textContent = `@font-face { font-family: "LETR Bangers"; src: url("${new URL(FONTS.bangers.file, state.base).href}") format("truetype"); font-display: swap; }`;
  document.head.append(link, face);
}

/* ======================================================================= designer */
class Designer extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "moinen-letters-designer", tag: "div", classes: ["letr-app", "letr-designer"],
    window: { title: "LETR.Designer.Title", icon: "fa-solid fa-burst", resizable: true },
    position: { width: 940, height: 660 },
    actions: {
      prev: Designer.#prev, next: Designer.#next, play: Designer.#togglePlay, reroll: Designer.#reroll, drawWord: Designer.#drawWord, backdrop: Designer.#backdrop,
      playHere: Designer.#playHere, showAll: Designer.#showAll, saveStyle: Designer.#saveStyle, deleteStyle: Designer.#deleteStyle,
      macro: Designer.#macro, copy: Designer.#copy, pal: Designer.#pal
    }
  };

  constructor(state, o = {}) {
    super(o);
    this.state = state;
    this.L = state.engine;
    this.f = { text: o.text ?? "KRAK!", style: "", mood: "auto", own: false, sound: { loud: 0.7, sharp: 0.7, long: 0.3, pitch: 0, rough: 0.4, peak: 0.3 },
      font: "", palette: "", in: "", holdKind: "", out: "", tempo: 1, hold: "", space: "world", layer: "", kind: "", magnitude: 0.5, scale: 1,
      seed: rndSeed(), ...(o.form ?? {}) };
    this.pic = 0; this.playing = true; this.paper = true; this.cache = new Map(); this.t0 = 0; this.raf = 0;
  }

  /* ---------- the form as engine options ---------- */
  opts() {
    const f = this.f, o = { seed: f.seed };
    if ( f.style ) o.style = f.style;
    if ( f.mood !== "auto" ) o.mood = f.mood;
    if ( f.own ) o.sound = { ...f.sound };
    if ( f.font ) o.font = f.font;
    if ( f.palette ) o.palette = f.palette;
    for ( const k of ["in", "holdKind", "out"] ) if ( f[k] ) o[k] = f[k];
    if ( f.tempo !== 1 ) o.tempo = f.tempo;
    if ( Number(f.hold) > 0 ) o.hold = Number(f.hold);
    o.space = f.space;
    if ( f.layer ) o.layer = f.layer;
    if ( f.magnitude !== 0.5 ) o.magnitude = f.magnitude;
    if ( f.scale !== 1 ) o.scale = f.scale;
    return o;
  }
  /* what a call (code, macro, style) carries: the look without the per-call seed */
  lookOpts() { const { seed, ...o } = this.opts(); return o; }

  async _renderHTML() {
    ensureStyles(this.state);
    const f = this.f, L = this.L;
    const sel = (name, items, cur, auto) => `<select name="${name}">${auto ? `<option value="">${esc(auto)}</option>` : ""}${items.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const mn = L.motionNames();
    const range = (name, min, max, step, v, label, hint) => `<label class="letr-range"><span>${esc(label)}</span><input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${v}"${hint ? ` data-tooltip="${esc(hint)}"` : ""}><output>${fmt(v)}</output></label>`;
    const styles = L.styles();
    const pals = Object.keys(COLORS);
    const root = document.createElement("div");
    root.className = "letr-d";
    root.innerHTML = `
      <section class="letr-d-stage" aria-label="${esc(T("Designer.Preview"))}">
        <div class="letr-panel${this.paper ? "" : " is-map"}" data-el="panel"><div class="letr-panel-art" data-el="art"></div></div>
        <div class="letr-strip" data-el="strip" role="slider" tabindex="0" aria-label="${esc(T("Designer.TimelineLabel"))}" aria-valuemin="1"></div>
        <div class="letr-transport">
          <button type="button" class="letr-ib" data-action="prev" data-tooltip="${esc(T("Designer.Prev"))}" aria-label="${esc(T("Designer.Prev"))}"><i class="fa-solid fa-backward-step"></i></button>
          <button type="button" class="letr-ib letr-ib-main" data-action="play" data-el="playbtn" data-tooltip="${esc(T("Designer.PlayPause"))}" aria-label="${esc(T("Designer.PlayPause"))}"><i class="fa-solid fa-pause"></i></button>
          <button type="button" class="letr-ib" data-action="next" data-tooltip="${esc(T("Designer.Next"))}" aria-label="${esc(T("Designer.Next"))}"><i class="fa-solid fa-forward-step"></i></button>
          <span class="letr-frame" data-el="frame" aria-live="off"></span>
          <label class="letr-seed" data-tooltip="${esc(T("Designer.Seed"))}"><i class="fa-solid fa-seedling" aria-hidden="true"></i><input type="text" name="seed" value="${esc(f.seed)}" aria-label="${esc(T("Designer.Seed"))}" spellcheck="false"></label>
          <button type="button" class="letr-ib" data-action="reroll" data-tooltip="${esc(T("Designer.Reroll"))}" aria-label="${esc(T("Designer.Reroll"))}"><i class="fa-solid fa-dice"></i></button>
          <button type="button" class="letr-ib" data-action="backdrop" data-tooltip="${esc(T("Designer.Backdrop"))}" aria-label="${esc(T("Designer.Backdrop"))}"><i class="fa-solid fa-circle-half-stroke"></i></button>
        </div>
        <p class="letr-meta" data-el="meta"></p>
        <p class="letr-note" data-el="note" hidden></p>
      </section>
      <section class="letr-d-form">
        <div class="letr-word"><label for="letr-word-in">${esc(T("Designer.Word"))}</label>
          <input id="letr-word-in" type="text" name="text" value="${esc(f.text)}" placeholder="${esc(T("Designer.WordPh"))}" maxlength="80" spellcheck="false" autocomplete="off"></div>
        <div class="letr-row letr-style-row"><label>${esc(T("Designer.Kind"))}</label>${this.kindSelect()}
          <button type="button" class="letr-ib" data-action="drawWord" data-el="draw" data-tooltip="${esc(T("Designer.DrawWord"))}" aria-label="${esc(T("Designer.DrawWord"))}"${f.kind ? "" : " disabled"}><i class="fa-solid fa-shuffle"></i></button></div>
        <div class="letr-row letr-style-row"><label>${esc(T("Designer.Style"))}</label>${sel("style", styles.map((s) => [s.name, s.label ?? s.name]), f.style, T("Designer.StyleNone"))}
          <button type="button" class="letr-ib" data-action="saveStyle" data-tooltip="${esc(T("Designer.SaveStyleHint"))}" aria-label="${esc(T("Designer.SaveStyle"))}"><i class="fa-solid fa-floppy-disk"></i></button>
          <button type="button" class="letr-ib letr-danger" data-action="deleteStyle" data-el="delstyle" data-tooltip="${esc(T("Designer.DeleteStyle"))}" aria-label="${esc(T("Designer.DeleteStyle"))}"${f.style ? "" : " disabled"}><i class="fa-solid fa-trash"></i></button></div>
        <fieldset><legend>${esc(T("Designer.Sound"))}</legend>
          <div class="letr-row"><label>${esc(T("Designer.Mood"))}</label>${sel("mood", MOOD_IDS.map((m) => [m, moodLabel(m)]), f.mood, null).replace("<select name=\"mood\">", `<select name="mood"><option value="auto"${f.mood === "auto" ? " selected" : ""}>${esc(moodLabel("auto"))}</option>`)}</div>
          <label class="letr-check"><input type="checkbox" name="own"${f.own ? " checked" : ""}> ${esc(T("Designer.OwnSound"))}</label>
          <div class="letr-sound" data-el="sound">${SOUND.map((k) => range(`sound.${k}`, k === "pitch" ? -1 : 0, 1, 0.05, f.sound[k], T(`Designer.${k}`))).join("")}</div>
        </fieldset>
        <fieldset><legend>${esc(T("Designer.Look"))}</legend>
          <div class="letr-row"><label>${esc(T("Designer.Font"))}</label>${sel("font", Object.keys(FONTS).map((k) => [k, FONT_NAMES[k] ?? k]), f.font, T("Designer.FontAuto"))}</div>
          <div class="letr-row letr-row-top"><label>${esc(T("Designer.Palette"))}</label>
            <div class="letr-swatches" role="radiogroup" aria-label="${esc(T("Designer.Palette"))}" data-el="pals">
              <button type="button" role="radio" class="letr-sw is-auto" data-action="pal" data-pal="" aria-checked="${!f.palette}" data-tooltip="${esc(T("Designer.PaletteAuto"))}" aria-label="${esc(T("Designer.PaletteAuto"))}"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
              ${pals.map((p) => { const c = COLORS[p][0].fill; return `<button type="button" role="radio" class="letr-sw" data-action="pal" data-pal="${esc(p)}" aria-checked="${f.palette === p}" style="--a:${c[0]};--b:${c[1]};--c:${c[2]}" data-tooltip="${esc(palLabel(p))}" aria-label="${esc(palLabel(p))}"></button>`; }).join("")}
            </div></div>
        </fieldset>
        <fieldset><legend>${esc(T("Designer.Motion"))}</legend>
          <div class="letr-grid3">
            <label>${esc(T("Designer.In"))}${sel("in", mn.in.map((k) => [k, k]), f.in, T("Designer.KindAuto"))}</label>
            <label>${esc(T("Designer.Hold"))}${sel("holdKind", mn.hold.map((k) => [k, k]), f.holdKind, T("Designer.KindAuto"))}</label>
            <label>${esc(T("Designer.Out"))}${sel("out", mn.out.map((k) => [k, k]), f.out, T("Designer.KindAuto"))}</label>
          </div>
          ${range("tempo", 0.5, 2, 0.05, f.tempo, T("Designer.Tempo"))}
          <div class="letr-row"><label>${esc(T("Designer.HoldMs"))}</label><input type="number" name="hold" min="0" max="10000" step="50" value="${esc(f.hold)}" placeholder="${esc(T("Designer.Auto"))}"></div>
        </fieldset>
        <fieldset><legend>${esc(T("Designer.Place"))}</legend>
          <div class="letr-row"><label>${esc(T("Designer.Space"))}</label>
            <div class="letr-seg" role="radiogroup" aria-label="${esc(T("Designer.Space"))}">
              <label><input type="radio" name="space" value="world"${f.space === "world" ? " checked" : ""}><span><i class="fa-solid fa-map" aria-hidden="true"></i> ${esc(T("Designer.World"))}</span></label>
              <label><input type="radio" name="space" value="screen"${f.space === "screen" ? " checked" : ""}><span><i class="fa-solid fa-display" aria-hidden="true"></i> ${esc(T("Designer.Screen"))}</span></label>
            </div></div>
          <div class="letr-row"><label>${esc(T("Designer.Layer"))}</label><span data-el="layer">${this.layerSelect()}</span></div>
          ${range("magnitude", 0, 2, 0.05, f.magnitude, T("Designer.Magnitude"))}
          ${range("scale", 0.25, 3, 0.05, f.scale, T("Designer.Scale"))}
        </fieldset>
      </section>
      <footer class="letr-d-foot">
        <button type="button" class="letr-ib" data-action="copy" data-tooltip="${esc(T("Designer.CopyHint"))}" aria-label="${esc(T("Designer.Copy"))}"><i class="fa-solid fa-code"></i></button>
        <button type="button" class="letr-ib" data-action="macro" data-tooltip="${esc(T("Designer.MacroHint"))}" aria-label="${esc(T("Designer.Macro"))}"><i class="fa-solid fa-terminal"></i></button>
        <span class="letr-sp"></span>
        <button type="button" class="letr-btn" data-action="playHere" data-tooltip="${esc(T("Designer.PlayHereHint"))}"><i class="fa-solid fa-eye"></i> ${esc(T("Designer.PlayHere"))}</button>
        <button type="button" class="letr-btn letr-primary" data-action="showAll" data-tooltip="${esc(T("Designer.ShowAllHint"))}"><i class="fa-solid fa-tower-broadcast"></i> ${esc(T("Designer.ShowAll"))}</button>
      </footer>`;
    return root;
  }
  _replaceHTML(result, content) { content.replaceChildren(result); }

  /* WORD's vocabulary: a sound kind gives a fitting word (in the table's language) and its mood */
  kindSelect() {
    const list = this.L.vocab?.list?.(game.i18n.lang) ?? [];
    const groups = new Map();
    for ( const k of list ) { if ( !groups.has(k.groupLabel) ) groups.set(k.groupLabel, []); groups.get(k.groupLabel).push(k); }
    return `<select name="kind"><option value="">${esc(T("Designer.KindNone"))}</option>${[...groups].map(([g, ks]) => `<optgroup label="${esc(g)}">${ks.map((k) => `<option value="${esc(k.id)}"${k.id === this.f.kind ? " selected" : ""}>${esc(k.label)}</option>`).join("")}</optgroup>`).join("")}</select>`;
  }
  drawWord() {
    const f = this.f;
    if ( !f.kind || !this.L.word ) return;
    try {
      const w = this.L.word(f.kind, { lang: game.i18n.lang, loud: f.own ? f.sound.loud : undefined, avoid: [f.text] });
      f.text = w.text;
      const mood = w.play?.mood ?? w.mood;
      if ( MOOD_IDS.includes(mood) ) f.mood = mood;
      if ( Number.isFinite(w.play?.magnitude) ) f.magnitude = w.play.magnitude;
      const el = this.element;
      el.querySelector('input[name="text"]').value = f.text;
      el.querySelector('select[name="mood"]').value = f.mood;
      const mg = el.querySelector('input[name="magnitude"], range-picker[name="magnitude"]');
      if ( mg ) { mg.value = f.magnitude; const out = mg.closest(".letr-range")?.querySelector("output"); if ( out ) out.textContent = fmt(f.magnitude); }
      this.replan();
    } catch ( e ) { console.warn("LETR | word of a kind", e); }
  }

  layerSelect() {
    const ch = this.L.layerChoices(this.f.space, game.i18n.lang);
    const def = this.L.defaults[this.f.space];
    if ( this.f.layer && !ch[this.f.layer] ) this.f.layer = "";
    return `<select name="layer"><option value="">${esc(ch[def] ?? def)}</option>${Object.entries(ch).filter(([k]) => k !== def).map(([k, l]) => `<option value="${esc(k)}"${k === this.f.layer ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  }

  _onRender() {
    const el = this.element;
    this.$ = (k) => el.querySelector(`[data-el="${k}"]`);
    const form = el.querySelector(".letr-d-form"), seed = el.querySelector('input[name="seed"]');
    const onInput = (e) => this.#read(e.target);
    form.addEventListener("input", onInput); form.addEventListener("change", onInput);
    seed.addEventListener("change", (e) => { this.f.seed = e.target.value.trim() || rndSeed(); e.target.value = this.f.seed; this.replan(); });
    const strip = this.$("strip");
    const at = (e) => { const r = strip.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width; let a = 0; for ( const c of this.cells ) { a += c.w; if ( x * this.total < a ) return c.i; } return this.cells.length - 1; };
    strip.addEventListener("pointerdown", (e) => { strip.setPointerCapture(e.pointerId); this.pause(); this.go(at(e)); const mv = (ev) => this.go(at(ev)); strip.addEventListener("pointermove", mv); strip.addEventListener("pointerup", () => strip.removeEventListener("pointermove", mv), { once: true }); });
    strip.addEventListener("keydown", (e) => {
      const k = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, Home: -1e9, End: 1e9 }[e.key];
      if ( k == null ) { if ( e.key === " " ) { e.preventDefault(); this.togglePlay(); } return; }
      e.preventDefault(); this.pause(); this.go(Math.max(0, Math.min(this.cells.length - 1, this.pic + k)));
    });
    const word = el.querySelector('input[name="text"]');
    word.addEventListener("keydown", (e) => { if ( e.key === "Enter" ) { e.preventDefault(); Designer.#playHere.call(this); } });
    this.ro?.disconnect(); this.ro = new ResizeObserver(() => this.paint(true)); this.ro.observe(this.$("panel"));
    this.replan();
    word.focus(); word.select();
  }
  _onClose() { cancelAnimationFrame(this.raf); this.ro?.disconnect(); this.cache.clear(); }

  #read(t) {
    const f = this.f, n = t.name;
    if ( !n || n === "seed" ) return;
    if ( n.startsWith("sound.") ) f.sound[n.slice(6)] = Number(t.value);
    else if ( n === "own" ) f.own = t.checked;
    else if ( ["tempo", "magnitude", "scale"].includes(n) ) f[n] = Number(t.value);
    else if ( n === "space" ) { if ( !t.checked ) return; f.space = t.value; this.$("layer").innerHTML = this.layerSelect(); }
    else if ( n === "kind" ) { f.kind = t.value; this.$("draw").disabled = !f.kind; if ( f.kind ) return this.drawWord(); return; }
    else if ( n === "style" ) { f.style = t.value; this.$("delstyle").disabled = !f.style; this.applyStyle(t.value); }
    else f[n] = t.value;
    const out = t.closest(".letr-range")?.querySelector("output"); if ( out ) out.textContent = fmt(t.value);
    clearTimeout(this.rt); this.rt = setTimeout(() => this.replan(), n === "text" ? 120 : 40);
  }
  /* a style picked: its look fills the form (what it does not set goes back to auto) */
  applyStyle(name) {
    const s = name ? this.L.style(name) : null;
    if ( !s ) return;
    const f = this.f;
    Object.assign(f, { mood: s.mood ?? "auto", own: !!s.sound, font: s.font ?? (typeof s.hand === "object" ? "" : ""), palette: s.palette ?? "", in: s.in ?? "", holdKind: s.holdKind ?? "",
      out: s.out ?? "", tempo: s.tempo ?? 1, hold: s.hold ?? "", magnitude: s.magnitude ?? 0.5, scale: s.scale ?? 1, space: s.space ?? f.space, layer: s.layer ?? "" });
    if ( s.sound ) Object.assign(f.sound, s.sound);
    this.style = name;
    this.render();   // the form shows the style's values
  }

  /* ---------- plan, pictures, timeline ---------- */
  replan() {
    const { plan } = this.L.planFor(this.f.text || "?", { ...this.opts() });
    this.plan = plan; this.cache.clear();
    const tl = plan.timeline;
    this.pics = [...tl.ent.map((p) => ({ p, part: "ent" })), ...tl.hold.map((p) => ({ p, part: "hold" })), ...tl.exit.map((p) => ({ p, part: "exit" }))];
    this.cells = this.pics.map((x, i) => ({ i, w: x.p.ticks, part: x.part, flash: !!x.p.impact, smear: !!x.p.smear }));
    this.total = this.cells.reduce((a, c) => a + c.w, 0);
    if ( !this.f.own ) { for ( const k of SOUND ) this.f.sound[k] = Math.round(plan.sound[k] * 100) / 100; this.syncSound(); }
    this.element.querySelector(".letr-sound").classList.toggle("is-off", !this.f.own);
    this.element.querySelectorAll(".letr-sound input").forEach((i) => (i.disabled = !this.f.own));
    this.strip();
    this.meta();
    this.pic = Math.min(this.pic, this.pics.length - 1);
    this.t0 = performance.now();
    if ( this.playing ) this.loop(); else this.go(this.pic);
  }
  syncSound() {
    for ( const k of SOUND ) { const i = this.element.querySelector(`input[name="sound.${k}"]`); if ( !i ) continue; i.value = this.f.sound[k]; i.parentElement.querySelector("output").textContent = fmt(this.f.sound[k]); }
  }
  strip() {
    const s = this.$("strip");
    s.style.gridTemplateColumns = this.cells.map((c) => `${c.w}fr`).join(" ");
    s.replaceChildren(...this.cells.map((c) => {
      const d = document.createElement("span");
      d.className = `letr-cell is-${c.part}${c.flash ? " is-flash" : ""}${c.smear ? " is-smear" : ""}`;
      if ( c.flash ) d.innerHTML = '<i class="fa-solid fa-bolt" aria-hidden="true"></i>';
      return d;
    }));
    s.setAttribute("aria-valuemax", String(this.cells.length));
  }
  meta() {
    const p = this.plan, tech = Object.entries(p.timeline.tech ?? {}).filter(([, v]) => v).map(([k]) => k);
    const ms = Math.round(p.timeline.ent.reduce((a, q) => a + q.ticks * TICK, 0) + Math.max(p.holdMs, p.timeline.hold.reduce((a, q) => a + q.ticks * TICK, 0)));
    this.$("meta").innerHTML = `<span><b>${esc(moodLabel(p.mood))}</b> · ${esc(p.timeline.kinds.in)} → ${esc(p.timeline.kinds.hold)} → ${esc(p.timeline.kinds.out)} · ${esc(T("Designer.Timeline", { ms, n: this.pics.length }))}</span>
      <span><b>${esc(T("Designer.Hand"))}</b> <code>${esc(p.hand.id)}</code></span>${tech.length ? `<span><b>${esc(T("Designer.Tech"))}</b> ${esc(tech.join(", "))}</span>` : ""}`;
    const red = this.state.prefs.motion === "reduced" || (this.state.prefs.motion !== "full" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    const note = this.$("note"); note.hidden = !red; note.textContent = red ? T("Designer.Reduced") : "";
  }
  picture(i) {
    let c = this.cache.get(i);
    const panel = this.$("panel"), W = panel.clientWidth, H = panel.clientHeight;
    const key = `${W}x${H}`;
    if ( c && c.key === key ) return c;
    const dpr = devicePixelRatio || 1, hb = this.plan._holdBox ?? { w: 3, h: 1 };
    const cap = Math.min(H * 0.26, (W * 0.74) / Math.max(1, hb.w)) ;
    const r = this.L._paint(this.plan, this.pics[i].p, cap * this.plan.sizeK * dpr);
    c = { ...r, dpr, key };
    c.canvas.style.width = `${c.canvas.width / dpr}px`; c.canvas.style.height = `${c.canvas.height / dpr}px`;
    c.canvas.style.left = `${W / 2 - c.ax / dpr}px`; c.canvas.style.top = `${H / 2 - c.ay / dpr}px`;
    this.cache.set(i, c);
    return c;
  }
  paint(resized) {
    if ( !this.pics ) return;
    if ( resized ) this.cache.clear();
    const c = this.picture(this.pic);
    this.$("art").replaceChildren(c.canvas);
    const cells = this.$("strip").children;
    for ( let k = 0; k < cells.length; k++ ) cells[k].classList.toggle("is-now", k === this.pic);
    const x = this.pics[this.pic], at = this.cells.slice(0, this.pic).reduce((a, q) => a + q.w * TICK, 0);
    const part = T(`Designer.Part.${x.part}`) + (x.p.impact ? ` · ${T("Designer.Flash")}` : "") + (x.p.smear ? ` · ${T("Designer.Smear")}` : "");
    this.$("frame").textContent = T("Designer.Frame", { i: this.pic + 1, n: this.pics.length, ms: Math.round(at), part });
    const s = this.$("strip"); s.setAttribute("aria-valuenow", String(this.pic + 1)); s.setAttribute("aria-valuetext", this.$("frame").textContent);
  }
  go(i) { this.pic = Math.max(0, Math.min(this.pics.length - 1, i)); this.paint(); }
  /* playback: entrance, the hold cycled for the hold time, exit, a beat of empty paper, again */
  loop() {
    cancelAnimationFrame(this.raf);
    const tl = this.plan.timeline, ms = (a) => a.reduce((s, q) => s + q.ticks * TICK, 0);
    const eN = tl.ent.length, hN = tl.hold.length, entMs = ms(tl.ent), cyc = ms(tl.hold), holdMs = Math.max(cyc, this.plan.holdMs), exMs = ms(tl.exit);
    const step = () => {
      if ( !this.playing || !this.element?.isConnected ) return;
      const t = (performance.now() - this.t0) % (entMs + holdMs + exMs + 600);
      let i = -1;
      if ( t < entMs ) { let a = 0; for ( let k = 0; k < eN; k++ ) { a += tl.ent[k].ticks * TICK; if ( t < a ) { i = k; break; } } }
      else if ( t < entMs + holdMs ) { const x = (t - entMs) % cyc; let a = 0; for ( let k = 0; k < hN; k++ ) { a += tl.hold[k].ticks * TICK; if ( x < a ) { i = eN + k; break; } } }
      else if ( t < entMs + holdMs + exMs ) { let a = entMs + holdMs; for ( let k = 0; k < tl.exit.length; k++ ) { a += tl.exit[k].ticks * TICK; if ( t < a ) { i = eN + hN + k; break; } } }
      if ( i < 0 ) { this.$("art").replaceChildren(); for ( const c of this.$("strip").children ) c.classList.remove("is-now"); }
      else if ( i !== this.pic || !this.$("art").firstChild ) { this.pic = i; this.paint(); }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
    this.playIcon();
  }
  pause() { this.playing = false; cancelAnimationFrame(this.raf); this.playIcon(); }
  togglePlay() { if ( this.playing ) { this.pause(); this.go(this.pic); } else { this.playing = true; this.t0 = performance.now(); this.loop(); } }
  playIcon() { const b = this.$("playbtn"); if ( b ) b.firstElementChild.className = `fa-solid ${this.playing ? "fa-pause" : "fa-play"}`; }

  /* ---------- actions ---------- */
  static #prev() { this.pause(); this.go(this.pic - 1); }
  static #next() { this.pause(); this.go(this.pic + 1); }
  static #togglePlay() { this.togglePlay(); }
  static #drawWord() { this.drawWord(); }
  static #reroll() { this.f.seed = rndSeed(); this.element.querySelector('input[name="seed"]').value = this.f.seed; this.replan(); }
  static #backdrop() { this.paper = !this.paper; this.$("panel").classList.toggle("is-map", !this.paper); }
  static #pal(e, btn) {
    this.f.palette = btn.dataset.pal;
    for ( const b of this.$("pals").children ) b.setAttribute("aria-checked", String(b === btn));
    this.replan();
  }
  /* where a word goes when it is played from here: the selected tokens (map), else the view centre (map) or the screen centre */
  target() {
    const toks = canvas?.tokens?.controlled ?? [];
    if ( this.f.space === "world" ) return canvas?.ready ? (toks[0] ? { at: toks[0].document } : { at: { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y } }) : null;
    return {};
  }
  static #playHere() {
    const where = this.target(); if ( !where ) return;
    if ( !this.state.prefs.enabled ) ui.notifications.info(T("Settings.Off"));
    this.L.play(this.f.text || "?", { ...this.opts(), ...where });
  }
  static #showAll() {
    const o = this.lookOpts();
    const toks = canvas?.tokens?.controlled ?? [];
    if ( this.f.space === "world" && !toks.length && canvas?.ready ) this.L.letterNow(this.f.text || "?", { ...o, point: { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y } });
    else if ( this.f.space === "screen" ) this.L.net.play(this.f.text || "?", o);
    else this.L.letterNow(this.f.text || "?", o);
    ui.notifications.info(T("Designer.Sent"));
  }
  static async #saveStyle() {
    const cur = this.f.style;
    const r = await DialogV2.prompt({
      window: { title: T("Designer.SaveStyle"), icon: "fa-solid fa-floppy-disk" }, classes: ["letr-app", "letr-dialog"],
      content: `<div class="letr-dlg"><label>${esc(T("Designer.StyleName"))}<input type="text" name="name" value="${esc(cur || (this.f.text || T("Designer.Untitled")).slice(0, 40))}" maxlength="48" autofocus required></label>
        <p class="hint">${esc(T("Designer.StyleNameHint"))}</p>
        <label class="letr-check"><input type="checkbox" name="pin" checked> ${esc(T("Designer.PinHand"))}</label><p class="hint">${esc(T("Designer.PinHandHint"))}</p></div>`,
      ok: { label: T("Designer.SaveStyle"), icon: "fa-solid fa-floppy-disk", callback: (ev, b) => ({ name: b.form.elements.name.value.trim(), pin: b.form.elements.pin.checked }) },
      rejectClose: false
    });
    if ( !r?.name ) return;
    if ( !STYLE_NAME.test(r.name) ) { ui.notifications.warn(T("Designer.StyleBad")); return; }
    const style = { label: r.name, ...this.lookOpts() };
    delete style.style;
    if ( r.pin ) {
      /* the look as drawn before this client's colour settings (contrast / colour-blind palettes apply on each viewer's side) */
      const raw = this.L._plan(this.f.text || "?", { ...this.opts(), hand: undefined, ...(this.f.font ? { hand: { font: this.f.font } } : {}) });
      const { hiContrast, id, ...hand } = raw.hand;
      style.hand = hand; delete style.palette;
      if ( this.f.palette ) { const fam = COLORS[this.f.palette]; const pal = fam[(raw.seed >>> 0) % fam.length]; hand.colorFam = this.f.palette; hand.pal = { ...pal, fill: pal.fill.slice(), out2: pal.out2[0] }; hand.ink = pal.ink; }
    }
    try { await this.L.saveStyle(r.name, style); } catch ( e ) { ui.notifications.error(e.message); return; }
    this.f.style = r.name;
    ui.notifications.info(T("Designer.StyleSaved", { name: r.name }));
    this.render();
  }
  static async #deleteStyle() {
    const n = this.f.style; if ( !n ) return;
    const ok = await DialogV2.confirm({ window: { title: T("Designer.DeleteStyle") }, content: `<p>${esc(n)}</p>`, rejectClose: false });
    if ( !ok ) return;
    await this.L.deleteStyle(n);
    this.f.style = "";
    ui.notifications.info(T("Designer.StyleDeleted", { name: n }));
    this.render();
  }
  code(fn = "letterNow") {
    const o = this.lookOpts();
    return `const L = await globalThis.MoinenLetters?.engine();\nif ( L ) L.${fn}(${JSON.stringify(this.f.text || "?")}, ${JSON.stringify(o)});`;
  }
  static async #macro() {
    const name = `${T("Designer.Untitled")}: ${this.f.text || "?"}`.slice(0, 60);
    const m = await Macro.create({ name, type: "script", img: "icons/svg/sound.svg", command: `// ${T("Now.Hint")}\n${this.code("letterNow")}` });
    if ( m ) { ui.notifications.info(T("Designer.MacroMade", { name })); m.sheet?.render(true); }
  }
  static async #copy() {
    await game.clipboard.copyPlainText(this.code("net.play"));
    ui.notifications.info(T("Designer.Copied"));
  }
}
const rndSeed = () => Math.random().toString(36).slice(2, 8);
const fmt = (v) => { const n = Number(v); return Number.isInteger(n) ? String(n) : n.toFixed(2); };

let designer = null;
export function openDesigner(state, o = {}) {
  if ( designer?.rendered ) { if ( o.text ) { designer.f.text = o.text; designer.render(); } designer.bringToFront(); return designer; }
  designer = new Designer(state, o);
  designer.render({ force: true });
  return designer;
}

/* ======================================================================= settings */
class Settings extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "moinen-letters-settings", tag: "form", classes: ["letr-app", "letr-settings"],
    window: { title: "LETR.Settings.Title", icon: "fa-solid fa-burst", contentClasses: ["standard-form"] },
    position: { width: 520, height: "auto" },
    form: { handler: Settings.#save, submitOnChange: false, closeOnSubmit: true },
    actions: { reset: Settings.#reset, try: Settings.#try }
  };
  constructor(state) { super(); this.state = state; this.v = { ...state.prefs }; }
  async _renderHTML() {
    ensureStyles(this.state);
    const v = this.v, f = foundry.applications.fields;
    const group = (k) => {
      const d = SETTINGS[k];
      let input;
      if ( d.type === "bool" ) input = f.createCheckboxInput({ name: k, value: v[k] });
      else if ( d.type === "pick" ) input = f.createSelectInput({ name: k, value: v[k], options: d.choices.map((c) => ({ value: c, label: T(`Settings.${k}.${c}`) })) });
      else { input = document.createElement("range-picker"); input.name = k; input.setAttribute("min", d.min); input.setAttribute("max", d.max); input.setAttribute("step", d.step); input.setAttribute("value", v[k]); }
      return f.createFormGroup({ label: T(`Settings.${k}.Name`), hint: T(`Settings.${k}.Hint`), input }).outerHTML;
    };
    const root = document.createElement("div");
    root.className = "letr-s";
    root.innerHTML = `
      <fieldset><legend>${esc(T("Settings.Groups.Show"))}</legend>${["enabled", "scale", "motion"].map(group).join("")}</fieldset>
      <fieldset><legend>${esc(T("Settings.Groups.Access"))}</legend>${["flashes", "photosafe", "palette", "announce"].map(group).join("")}</fieldset>
      <fieldset><legend>${esc(T("Settings.Groups.Limits"))}</legend>${["limitScreen", "limitWorld"].map(group).join("")}</fieldset>
      <footer class="form-footer">
        <button type="button" data-action="reset"><i class="fa-solid fa-arrow-rotate-left"></i> ${esc(T("Settings.Reset"))}</button>
        <button type="button" data-action="try"><i class="fa-solid fa-burst"></i> ${esc(T("Settings.Try"))}</button>
        <button type="submit"><i class="fa-solid fa-floppy-disk"></i> ${esc(T("Settings.Save"))}</button>
      </footer>`;
    return root;
  }
  _replaceHTML(result, content) { content.replaceChildren(result); }
  values() {
    const fd = new foundry.applications.ux.FormDataExtended(this.element).object;
    const o = {}; for ( const k of Object.keys(SETTINGS) ) if ( k in fd ) o[k] = fd[k];
    return o;
  }
  static async #save() { await setPrefs(this.values()); }
  static #reset() { this.v = { ...DEFAULTS }; this.render(); }
  /* a sample with the values in the window (saved first: the sample is what the settings will do) */
  static async #try() {
    await setPrefs(this.values());
    const L = this.state.engine;
    if ( !this.state.prefs.enabled ) { ui.notifications.info(T("Settings.Off")); return; }
    L.burst([{ text: "KRAK!", mood: "crack", at: { x: innerWidth * 0.36, y: innerHeight * 0.4 } }, { text: "BUM!", mood: "boom", at: { x: innerWidth * 0.62, y: innerHeight * 0.46 }, delay: 260 }], { space: "screen" });
  }
}
let settingsApp = null;
export function openSettings(state) {
  if ( settingsApp?.rendered ) { settingsApp.bringToFront(); return settingsApp; }
  settingsApp = new Settings(state);
  settingsApp.render({ force: true });
  return settingsApp;
}

/* ======================================================================= letter this now */
class Now extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "moinen-letters-now", tag: "form", classes: ["letr-app", "letr-now"],
    window: { title: "LETR.Now.Title", icon: "fa-solid fa-burst", minimizable: false },
    position: { width: 340, height: "auto" },
    form: { handler: Now.#send, submitOnChange: false, closeOnSubmit: true },
    actions: { designer: Now.#designer }
  };
  constructor(state) {
    super();
    this.state = state;
    this.point = cursorPoint();
    this.tokens = (canvas?.tokens?.controlled ?? []).map((t) => t.document);
    const m = state.mouse ?? { x: innerWidth / 2, y: innerHeight / 2 };
    this.options.position.left = Math.max(8, Math.min(innerWidth - 348, m.x + 14));
    this.options.position.top = Math.max(8, Math.min(innerHeight - 200, m.y + 14));
  }
  async _renderHTML() {
    ensureStyles(this.state);
    const s = this.state, last = s.nowLast ?? { text: "", mood: "auto", style: "" };
    const styles = s.engine.styles();
    const where = this.tokens.length ? T("Now.Where.picked", { n: this.tokens.length }) : T("Now.Where.cursor");
    const root = document.createElement("div");
    root.className = "letr-n";
    root.innerHTML = `
      <input type="text" name="text" class="letr-n-word" value="${esc(last.text)}" placeholder="${esc(T("Designer.WordPh"))}" maxlength="80" autocomplete="off" spellcheck="false" aria-label="${esc(T("Designer.Word"))}" required>
      <div class="letr-n-row">
        <select name="mood" aria-label="${esc(T("Designer.Mood"))}" data-tooltip="${esc(T("Designer.Mood"))}"><option value="auto">${esc(moodLabel("auto"))}</option>${MOOD_IDS.map((m) => `<option value="${m}"${m === last.mood ? " selected" : ""}>${esc(moodLabel(m))}</option>`).join("")}</select>
        <select name="style" aria-label="${esc(T("Designer.Style"))}" data-tooltip="${esc(T("Designer.Style"))}"><option value="">${esc(T("Designer.StyleNone"))}</option>${styles.map((x) => `<option value="${esc(x.name)}"${x.name === last.style ? " selected" : ""}>${esc(x.label ?? x.name)}</option>`).join("")}</select>
      </div>
      <div class="letr-n-foot">
        <span class="letr-n-where"><i class="fa-solid ${this.tokens.length ? "fa-users" : "fa-crosshairs"}" aria-hidden="true"></i> ${esc(where)}</span>
        <button type="button" class="letr-ib" data-action="designer" data-tooltip="${esc(T("Now.Designer"))}" aria-label="${esc(T("Now.Designer"))}"><i class="fa-solid fa-sliders"></i></button>
        <button type="submit" class="letr-btn letr-primary" data-tooltip="${esc(T("Now.Send"))}" aria-label="${esc(T("Now.Send"))}"><i class="fa-solid fa-tower-broadcast"></i></button>
      </div>`;
    return root;
  }
  _replaceHTML(result, content) { content.replaceChildren(result); }
  _onRender() { const i = this.element.querySelector('input[name="text"]'); i.focus(); i.select(); }
  static #send(e, form, fd) {
    const o = fd.object, text = String(o.text ?? "").trim();
    if ( !text ) return;
    this.state.nowLast = { text, mood: o.mood, style: o.style };
    const opts = {};
    if ( o.style ) opts.style = o.style;
    if ( o.mood && o.mood !== "auto" ) opts.mood = o.mood;
    this.state.engine.letterNow(text, { ...opts, tokens: this.tokens, point: this.point ?? undefined });
  }
  static #designer() {
    const text = this.element.querySelector('input[name="text"]').value.trim();
    this.close();
    openDesigner(this.state, text ? { text } : {});
  }
}
export function openNow(state) {
  for ( const a of foundry.applications.instances.values() ) if ( a instanceof Now ) a.close();
  const app = new Now(state);
  app.render({ force: true });
  return app;
}
