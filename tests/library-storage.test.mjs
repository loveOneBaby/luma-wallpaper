import assert from "node:assert/strict";
import { Blob } from "node:buffer";
import test from "node:test";
import {
  estimateLibraryStorage,
  mergeLibraryStateWithBlobs,
  splitLibraryStateForStorage,
  storageRevisionsMatch,
} from "../src/services/libraryStorage.js";

test("browser library storage separates immutable Blobs from mutable metadata", () => {
  const file = new Blob(["wallpaper"], { type: "image/png" });
  const state = {
    version: 1,
    selectedId: "uploaded-image",
    activeCategory: "favorite",
    items: [
      { id: "demo-image", isDemo: true, favorite: false },
      {
        id: "uploaded-image",
        name: "ocean.png",
        kind: "image",
        favorite: true,
        file,
      },
    ],
  };

  const { metadata, blobs } = splitLibraryStateForStorage(state);
  assert.equal(metadata.version, 2);
  assert.equal(metadata.items[1].file, undefined);
  assert.equal(metadata.items[1].blobId, "uploaded-image");
  assert.equal(blobs.get("uploaded-image"), file);

  const restored = mergeLibraryStateWithBlobs(metadata, blobs);
  assert.equal(restored.items[1].file, file);
  assert.equal(restored.items[1].blobId, undefined);
  assert.equal(restored.selectedId, state.selectedId);
  assert.equal(restored.activeCategory, state.activeCategory);
});

test("library restore skips only corrupt entries whose Blob record is missing", () => {
  const metadata = {
    version: 2,
    items: [
      { id: "demo-image", isDemo: true },
      { id: "missing-upload", kind: "image", blobId: "missing-upload" },
    ],
  };

  assert.deepEqual(mergeLibraryStateWithBlobs(metadata, new Map()).items, [
    { id: "demo-image", isDemo: true },
  ]);
});

test("storage estimate keeps a reserve and reports insufficient upload space", async () => {
  const ample = await estimateLibraryStorage(10, {
    estimate: async () => ({ quota: 10_000_000, usage: 1_000_000 }),
  });
  assert.equal(ample.enough, true);

  const full = await estimateLibraryStorage(2_000_000, {
    estimate: async () => ({ quota: 4_000_000, usage: 1_000_000 }),
  });
  assert.equal(full.availableBytes, 3_000_000);
  assert.equal(full.enough, false);

  const metadataOnly = await estimateLibraryStorage(0, {
    estimate: async () => ({ quota: 100, usage: 100 }),
  });
  assert.equal(metadataOnly.enough, true);
});

test("storage revisions reject stale cross-tab snapshots", () => {
  assert.equal(storageRevisionsMatch("revision-a", "revision-a"), true);
  assert.equal(storageRevisionsMatch("revision-a", "revision-b"), false);
  assert.equal(storageRevisionsMatch(null, undefined), true);
});
