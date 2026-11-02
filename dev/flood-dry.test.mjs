/** A flooded hole whose pixels are not there yet is retried with a bounded backoff (flood-core dryDelay), never left dry for good. */
import assert from "node:assert/strict";
import * as FC from "../scripts/destruction/flood-core.mjs";

const ds = Array.from({ length: FC.DRY_TRIES }, (_, n) => FC.dryDelay(n));
assert.ok(ds.every((d) => Number.isFinite(d) && d > 0), "every try has a delay");
assert.ok(ds.every((d, i) => i === 0 || d >= ds[i - 1]), "the delay never shrinks");
assert.ok(Math.max(...ds) <= 4000, "capped at 4 s");
assert.equal(FC.dryDelay(FC.DRY_TRIES), null, "bounded: null once the tries are used up");
assert.equal(FC.dryDelay(-1), null);
const total = ds.reduce((a, b) => a + b, 0);
assert.ok(total >= 20000 && total <= 40000, `total wait ${total} ms covers a slow cold load but is bounded`);
console.log(`ok dry-hole backoff: ${ds.join(",")} ms (total ${total})`);
