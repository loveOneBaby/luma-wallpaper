import assert from "node:assert/strict";
import test from "node:test";
import { hasSafeMediaDimensions, validateBrowserFiles } from "../src/services/mediaValidation.js";

test("accepts common 8K media dimensions and rejects oversized decode surfaces", () => {
  assert.equal(hasSafeMediaDimensions(7_680, 4_320), true);
  assert.equal(hasSafeMediaDimensions(8_193, 1_080), false);
  assert.equal(hasSafeMediaDimensions(8_000, 8_000), false);
  assert.equal(hasSafeMediaDimensions(0, 1_080), false);
});

test("an aborted import batch is cancelled before browser decoders are allocated", async () => {
  const controller = new globalThis.AbortController();
  controller.abort();
  const results = await validateBrowserFiles([{ name: "large-video.mp4", size: 10_000 }], {
    signal: controller.signal,
  });
  assert.deepEqual(results, [{ kind: null, reason: "cancelled" }]);
});
