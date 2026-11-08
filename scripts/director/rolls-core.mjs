/**
 * The ROLLS source of the director, the pure parts (no Foundry; node-testable: dev/director-rolls.test.mjs). The runtime is
 * source-rolls.mjs. A roll of the Invincible system (a Year Zero roll: successes = sixes, an attack carries its damage in the options)
 * becomes one CUED director event: the camera goes to the attacker and the target while the dice roll, and the result (hit / miss, damage,
 * stunts) lands on each client when ITS dice land. A "Damage Taken" card becomes a damage event on the target.
 */
import { clamp, unionBox, boxCentre, pointBox } from "./core.mjs";

/**
 * Who may watch a roll, from its chat message: "all" (public), "gm" (whispered to a GM / blind: only the GMs ever get a shot) or null
 * (a self roll, or one whispered to players only: nobody else gets anything). `gmIds` = the ids of the GM users.
 */
export function audience({ whisper = [], blind = false, gmIds = [] } = {}) {
  const w = Array.isArray(whisper) ? whisper : [];
  if ( !w.length && !blind ) return "all";
  if ( blind || w.some((id) => gmIds.includes(id)) ) return "gm";
  return null;
}

/** The facts of a Year Zero roll (YearZeroRoll or its JSON-like shape): null when it is not one. */
export function rollFacts(roll) {
  if ( !roll || typeof roll !== "object" ) return null;
  const n = Number(roll.successCount);
  if ( !Number.isFinite(n) ) return null;
  const o = roll.options ?? {};
  const dmg = Number(roll.attackDamage ?? o.damage) || 0;
  const attack = dmg > 0 || ["slugfest", "shooting", "charge"].includes(o.attackType);
  return {
    n: Math.max(0, Math.round(n)), attack, dmg: Math.max(0, Math.round(dmg)),
    stunts: attack && n > 0 && dmg > 0 ? Math.max(0, Math.round(n) - 1) : 0,
    pushed: (Number(roll.pushCount) || 0) > 0, pushable: !!roll.pushable
  };
}

/** A roll's flavor as a short plain caption part (no markup, at most 40 characters). */
export function shortText(s, max = 40) {
  const t = String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * The director event of a roll. `who` from audience(); `attacker` / `targets`: { id, name (public name or ""), box } of the tokens the
 * players may see (hidden ones are left out by the caller: a hidden attacker is "someone", a hidden target is not shown); `grid` px.
 * Returns null when nothing may be shown (no audience, no place). The first token is the FOCUS (the target; without one the attacker).
 */
export function rollEvent(f, { id, who, attacker = null, targets = [], what = "", grid = 100 } = {}) {
  if ( !f || !who ) return null;
  const tg = targets.filter((t) => t && t.box);
  const at = attacker?.box ? attacker : null;
  const focus = tg[0] ?? at;
  if ( !focus ) return null;
  let box = null;
  for ( const t of [at, ...tg] ) if ( t ) box = unionBox(box, t.box);
  box = unionBox(box, pointBox(boxCentre(focus.box).x, boxCentre(focus.box).y, grid * 0.5));
  const c = boxCentre(focus.box);
  const data = { token: at?.id ?? null, name: at?.name ?? "", target: tg[0]?.id ?? null, tname: tg[0]?.name ?? "", more: Math.max(0, tg.length - 1), n: f.n, dmg: f.dmg, s: f.stunts, what: shortText(what) };
  const tokens = [focus.id, ...[at, ...tg].filter((t) => t && t !== focus).map((t) => t.id)];
  const base = { id, who, box, x: c.x, y: c.y, tokens, cue: "dice", strict: true, src: "rolls" };
  const pushKick = f.pushed ? "Dir.cap.kPushed" : undefined;
  if ( f.attack ) {
    const names = !tg.length ? "Dir.cap.atkSolo" : tg.length > 1 ? "Dir.cap.atkMore" : "Dir.cap.atk";
    const res = f.n <= 0 ? "Dir.cap.miss" : !f.dmg ? "Dir.cap.hitNoDmg" : f.stunts ? "Dir.cap.hitStunts" : "Dir.cap.hit";
    const weight = tg.length ? clamp(0.68 + 0.04 * Math.min(3, tg.length - 1) + (f.n >= 3 ? 0.08 : 0), 0, 0.95) : 0.42;
    return { ...base, kind: "attack", weight, caption: { key: names, data, kick: pushKick }, after: { key: res, data, kick: names } };
  }
  const weight = 0.18 + (f.n >= 3 ? 0.04 : 0);
  return { ...base, kind: "roll", weight, caption: { key: "Dir.cap.roll", data, kick: pushKick }, after: { key: f.n > 0 ? "Dir.cap.rollOk" : "Dir.cap.rollFail", data, kick: "Dir.cap.roll" } };
}

/**
 * The facts of a "Damage Taken" card: the system writes "<p><strong>Name</strong> took <strong>3</strong> damage.</p>" and a second
 * <p> for a critical injury; Plus Ultra (when on) adds flags { from, to, max } of the Health. -> { dmg, from, to, max, crit, broken }.
 */
export function damageFacts(content, puFlags = null) {
  const html = String(content ?? "");
  const paras = html.match(/<p[\s>][\s\S]*?<\/p>/gi) ?? [];
  const nums = [...(paras[0] ?? html).matchAll(/<strong>\s*(\d+)\s*<\/strong>/gi)].map((m) => Number(m[1]));
  const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
  const from = num(puFlags?.from), to = num(puFlags?.to), max = num(puFlags?.max);
  let dmg = nums.length ? nums[nums.length - 1] : null;
  if ( from !== null && to !== null && from > to && dmg === null ) dmg = from - to;
  const crit = paras.length >= 2;
  return { dmg, from, to, max, crit, broken: crit || (to !== null && to <= 0) };
}

/** The director event of a damage card on the target `t` ({ id, name, box }), or null. */
export function damageEvent(f, { id, who, t, grid = 100 } = {}) {
  if ( !f || !who || !t?.box ) return null;
  const c = boxCentre(t.box);
  const share = f.dmg !== null && f.max ? clamp(f.dmg / f.max, 0, 1) : 0.25;
  const weight = clamp(0.5 + 0.3 * share + (f.broken ? 0.12 : 0) + (f.crit ? 0.12 : 0), 0, 1);
  const key = f.dmg === null ? "Dir.cap.dmgAny" : f.crit ? "Dir.cap.dmgCrit" : f.broken ? "Dir.cap.dmgBroken" : "Dir.cap.dmg";
  return {
    id, who, kind: "damage", src: "rolls", weight, box: unionBox(t.box, pointBox(c.x, c.y, grid)), x: c.x, y: c.y, tokens: [t.id], strict: true,
    caption: { key, data: { token: t.id, name: t.name ?? "", dmg: f.dmg ?? 0 } }
  };
}
