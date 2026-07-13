import assert from "node:assert/strict";
import test from "node:test";
import { createWallpaperApplySnapshot } from "../src/services/wallpaperApplyRequest.js";

test("wallpaper recovery snapshot is immutable and independent from library selection", () => {
  const media = {
    id: "first",
    kind: "video",
    filePath: "/wallpapers/first.mp4",
    demoKey: null,
    name: "first.mp4",
    src: "blob:first",
  };
  const snapshot = createWallpaperApplySnapshot(media);

  media.filePath = "/wallpapers/current-selection.mp4";
  media.kind = "image";

  assert.deepEqual(snapshot, {
    kind: "video",
    filePath: "/wallpapers/first.mp4",
    demoKey: null,
    name: "first.mp4",
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.throws(() => {
    snapshot.filePath = "/wallpapers/mutated.mp4";
  }, TypeError);
});

test("invalid media cannot replace the last wallpaper request", () => {
  assert.equal(createWallpaperApplySnapshot(null), null);
  assert.equal(createWallpaperApplySnapshot({ kind: "audio" }), null);
});
