/**
 * DESTRUCTION PRESETS, the firings runtime: the pure parts (P6 of dev/presets-design.md, G9). No Foundry here: node-tested.
 *  - TIMELINE: what of a firing record plays when (shared clock): its impact at T0 and the parts the layers do not play by themselves
 *    (record.pending: burst, dust, accent, cue - P3 to P5 play them). A client that joins late, or reloads, plays what is still to
 *    come at its moment; a cue that has passed is dropped (no shake, flash or sound after the fact); a part with a length that is
 *    still running is handed over late, with how far it is (its layer shows its pose of now); one that is over is dropped.
 *  - PURGE: when a record may go (the GM writes its deletion): every fire / smoke stroke it named is gone from the scene (the fire
 *    layer purges its own put-out strokes), its damage has entered and every part is over, plus a tail. A firing whose fire burns
 *    without an end ("no end" aftermath) stays until the GM puts it out.
 *  - UNDO: what an undo of a record writes (fire / smoke: out from now, or dropped when it has not caught yet).
 *  - FIRES: the fire / smoke strokes of the scene's firings that are timed to go out (the fire layer's list and clear() see only
 *    strokes without an out time), so they can be listed and put out through the records.
 */

export const PARTS = ["burst", "dust", "accent", "cue"];
/** After the last thing of a firing ends, its record stays this long (ms): a late chunk, the going-out of its last fire. */
export const TAIL_MS = 10000;
/** A destruction stroke's entry is over (and settled for anyone joining) this long after its start (destruction ENTRY_WINDOW). */
export const ENTRY_MS = 8000;
/** A part without a length of its own is "running" this long after its moment (late joiners still get it). */
export const PART_MS = 1500;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** How long a pending part lasts (ms after its moment): its dur / life, the span of its hits or points, else PART_MS (a cue: 0). */
export function spanOf(part, item) {
  if ( part === "cue" ) return Math.max(0, num(item?.decay) ?? 0);
  const hitT = (list) => (Array.isArray(list) && list.length ? Math.max(0, ...list.map((h) => num(h?.[2]) ?? 0)) : 0);
  const own = num(item?.dur) ?? num(item?.life) ?? PART_MS;
  return Math.max(0, hitT(item?.hits) + hitT(item?.pts) + own);
}

/** Every timed thing of a record: [{ part, i, item, t (shared ms), end }] sorted by t; the impact first among equals. */
export function timeline(rec) {
  const t0 = num(rec?.t0); if ( t0 === null ) return [];
  const out = [{ part: "impact", i: 0, item: null, t: t0, end: t0 }];
  for ( const part of PARTS ) {
    const L = rec.pending?.[part];
    if ( !Array.isArray(L) ) continue;
    L.forEach((item, i) => { const t = t0 + (num(item?.at) ?? 0); out.push({ part, i, item, t, end: t + spanOf(part, item) }); });
  }
  return out.sort((a, b) => a.t - b.t || (a.part === "impact" ? -1 : b.part === "impact" ? 1 : 0));
}

/**
 * What this client does with a record at `now`: [{ ...event, wait (ms from now, >= 0), late (ms past its moment, 0 = on time) }].
 * Past cues and the past impact are dropped; a running part is given at once with `late`; a finished one is dropped.
 */
export function schedule(rec, now) {
  const out = [];
  for ( const e of timeline(rec) ) {
    if ( e.t >= now ) { out.push({ ...e, wait: e.t - now, late: 0 }); continue; }
    if ( e.part === "cue" || e.part === "impact" ) continue;
    if ( now < e.end ) out.push({ ...e, wait: 0, late: now - e.t });
  }
  return out;
}

/** When the record's own things are over (shared ms): its parts, its damage entries (d[].at, else T0), plus ENTRY_MS for the damage. */
export function overAt(rec) {
  const t0 = num(rec?.t0) ?? 0;
  let end = t0;
  for ( const e of timeline(rec) ) end = Math.max(end, e.end);
  for ( const d of Array.isArray(rec?.d) ? rec.d : [] ) end = Math.max(end, (num(d?.at) ?? t0) + ENTRY_MS);
  if ( !(rec?.d?.length) ) end = Math.max(end, t0 + ENTRY_MS);
  return end;
}

/**
 * May the record go? `fires` the scene's fire strokes (flag object, id -> stroke). -> { done: true } | { done: false, next: shared ms
 * to look again (null: not before the fire layer changes - a fire without an end, or one still to be purged by its layer) }.
 */
export function purgeState(rec, fires, now, tail = TAIL_MS) {
  const F = fires && typeof fires === "object" ? fires : {};
  const left = (Array.isArray(rec?.f) ? rec.f : []).map((q) => F[q?.id]).filter((s) => s && typeof s === "object");
  const over = overAt(rec) + tail;
  if ( left.length ) {
    // the fire layer deletes a stroke once it has gone out (its purge): look again after the last out time, or when it changes
    const outs = left.map((s) => num(s.o));
    if ( outs.some((o) => o === null) ) return { done: false, next: null };
    return { done: false, next: Math.max(over, Math.max(...outs) + tail) };
  }
  return now >= over ? { done: true } : { done: false, next: over };
}

/**
 * The fire-layer writes of an undo at `now` (`fires` the scene's fire strokes): a stroke that has not caught yet is dropped, one that
 * burns goes out from now (its own going-out), one already out stays as it is. -> { put: [ids], drop: [ids] }.
 */
export function undoFires(rec, fires, now) {
  const F = fires && typeof fires === "object" ? fires : {}, put = [], drop = [];
  for ( const q of Array.isArray(rec?.f) ? rec.f : [] ) {
    const s = F[q?.id]; if ( !s || typeof s !== "object" ) continue;
    if ( (num(s.q) ?? 0) > now ) drop.push(q.id);
    else if ( !((num(s.o) ?? Infinity) <= now) ) put.push(q.id);
  }
  return { put, drop };
}

/**
 * The fire / smoke strokes of the scene's firings that still burn at `now`: [{ id, fid, preset, k, o (null: no end), q }]. A stroke
 * with an out time in the future is one the fire layer's own list and clear() do not reach.
 */
export function burning(recs, fires, now) {
  const F = fires && typeof fires === "object" ? fires : {}, out = [];
  for ( const r of recs ?? [] ) for ( const q of Array.isArray(r?.f) ? r.f : [] ) {
    const s = F[q?.id]; if ( !s || typeof s !== "object" ) continue;
    const o = num(s.o);
    if ( o !== null && o <= now ) continue;
    out.push({ id: q.id, fid: r.id, preset: r.preset, k: s.k, o, q: num(s.q) });
  }
  return out;
}

/** A record's state for a list: "coming" (before T0), "playing", "burning" (its fire still on), "settled"; `partial` when strokes it named are gone early. */
export function stateOf(rec, fires, destructionIds, now) {
  const F = fires ?? {}, t0 = num(rec?.t0) ?? 0;
  const fLeft = (rec?.f ?? []).filter((q) => F[q?.id]), dLeft = (rec?.d ?? []).filter((q) => destructionIds?.has?.(q?.id));
  const partial = dLeft.length < (rec?.d?.length ?? 0) || (now < overAt(rec) && fLeft.length < (rec?.f?.length ?? 0));
  const state = now < t0 ? "coming" : now < overAt(rec) ? "playing" : burning([rec], F, now).length ? "burning" : "settled";
  return { state, partial };
}
