/** A flooded hole whose pixels are not there yet is retried with a backoff that settles into a slow cadence (flood-core dryDelay), never left dry for good. */
import assert from "node:assert/strict";
import * as FC from "../scripts/destruction/flood-core.mjs";

const ds = Array.from({ length: FC.DRY_TRIES }, (_, n) => FC.dryDelay(n));
assert.ok(ds.every((d) => Number.isFinite(d) && d > 0), "every try has a delay");
assert.ok(ds.every((d, i) => i === 0 || d >= ds[i - 1]), "the delay never shrinks");
assert.ok(Math.max(...ds) <= 4000, "capped at 4 s");
assert.equal(FC.dryDelay(FC.DRY_TRIES), FC.DRY_SLOW, "past the quick tries: a slow retry, not an end");
assert.equal(FC.dryDelay(FC.DRY_TRIES + 500), FC.DRY_SLOW, "it never ends while the hole is dry (a shell can stay unswapped for minutes)");
assert.ok(FC.DRY_SLOW >= 4000 && FC.DRY_SLOW <= 10000, "slow, but a recovery is seen within seconds");
assert.equal(FC.dryDelay(-1), null);
const total = ds.reduce((a, b) => a + b, 0);
assert.ok(total >= 20000 && total <= 40000, `the quick tries cover a slow cold load (${total} ms)`);
console.log(`ok dry-hole backoff: ${ds.join(",")} ms (total ${total}), then every ${FC.DRY_SLOW} ms for ever`);
