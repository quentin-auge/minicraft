// Celestial chunk queue: prune-exempt pending builds draining nearest-first
// under a reserved cap, so a fast ascent converges instead of restarting at
// every window crossing (three-free, `node` direct).
import assert from "node:assert/strict";
import {
  chunkKeyOf, parseQueueKey, queueDist2,
  queueCelestialKeys, takeCelestialBatch, dropQueued,
} from "../../../src/render/celestialQueue.js";

const built = new Set();
const builtHas = (ck) => built.has(ck);

// Keys round-trip chunk coords, distance is XZ-centered and monotonic.
{
  assert.equal(chunkKeyOf(3, -5), "3_-5", "key shape");
  assert.deepEqual(parseQueueKey("3_-5"), [3, -5], "key parses");
  assert.deepEqual(parseQueueKey("-12_7"), [-12, 7], "negatives parse");
  const d0 = queueDist2(0, 0, chunkKeyOf(0, 0));
  const d1 = queueDist2(0, 0, chunkKeyOf(10, 0));
  const d2 = queueDist2(0, 0, chunkKeyOf(-11, 0));
  assert.ok(d0 < d1 && d0 < d2, "center chunk nearest");
  assert.equal(d1, d2, "symmetric chunks tie");
  console.log("PASS celestial-queue-keys");
}

// Queueing dedupes across both queues and skips built chunks.
{
  const pending = new Set();
  const inWindow = new Set(["0_0"]);
  const coords = [[8, 0, 8], [24, 5, 8], [8, 0, 8], [200, 0, 200]];
  const added = queueCelestialKeys(pending, inWindow, builtHas, coords);
  assert.equal(added, 2, "one windowed, one duplicate dropped");
  assert.ok(pending.has("0_0") === false, "windowed key not queued");
  assert.ok(pending.has("1_0") && pending.has("12_12"), "far keys queued");
  assert.equal(queueCelestialKeys(pending, inWindow, builtHas, coords), 0, "re-queue adds nothing");
  built.add("12_12");
  assert.equal(queueCelestialKeys(pending, new Set(), builtHas, [[200, 0, 200]]), 0, "built key never queues");
  built.clear();
  console.log("PASS celestial-queue-add");
}

// Batches come out nearest-first, capped, skipping built.
{
  const pending = new Set(["10_0", "2_0", "5_0", "0_20"]);
  built.add("2_0");
  const b1 = takeCelestialBatch(pending, builtHas, 0, 0, 2);
  assert.deepEqual(b1, ["5_0", "10_0"], "nearest first, built skipped, capped");
  assert.ok(!pending.has("2_0"), "built key evicted from the set");
  const b2 = takeCelestialBatch(pending, builtHas, 0, 0, 10);
  assert.deepEqual(b2, ["0_20"], "remainder drains");
  assert.equal(pending.size, 0, "set empty");
  assert.deepEqual(takeCelestialBatch(new Set(), builtHas, 0, 0, 2), [], "empty set");
  assert.deepEqual(takeCelestialBatch(new Set(["1_1"]), builtHas, 0, 0, 0), [], "zero cap");
  built.clear();
  console.log("PASS celestial-queue-batch");
}

// Prune truth table: built drops, window keeps, pinned keeps, else drops.
{
  const keep = new Set(["0_0"]);
  const pinnedHas = (ck) => ck === "9_9";
  assert.equal(dropQueued("0_0", keep, pinnedHas, builtHas), false, "window kept");
  assert.equal(dropQueued("9_9", keep, pinnedHas, builtHas), false, "pinned kept past the window");
  assert.equal(dropQueued("7_7", keep, pinnedHas, builtHas), true, "far unpinned dropped");
  built.add("0_0");
  assert.equal(dropQueued("0_0", keep, pinnedHas, builtHas), true, "built dropped even in-window");
  built.clear();
  console.log("PASS celestial-queue-prune");
}
