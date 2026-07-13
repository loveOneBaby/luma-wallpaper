import assert from "node:assert/strict";
import test from "node:test";
import { getUpdaterSupport, resolveMacAppBundlePath } from "../electron/update-support.mjs";

test("resolves the app bundle from the packaged macOS executable", () => {
  assert.equal(
    resolveMacAppBundlePath("/Applications/Luma.app/Contents/MacOS/Luma"),
    "/Applications/Luma.app",
  );
});

test("reports Developer ID integrity for a signed macOS package", () => {
  let checkedPath = null;
  const support = getUpdaterSupport(
    {
      isPackaged: true,
      platform: "darwin",
      execPath: "/Applications/Luma.app/Contents/MacOS/Luma",
    },
    (appBundlePath) => {
      checkedPath = appBundlePath;
      return true;
    },
  );

  assert.equal(checkedPath, "/Applications/Luma.app");
  assert.deepEqual(support, {
    supported: true,
    reason: null,
    signed: true,
    integrity: "developer-id",
  });
});

test("keeps unsigned macOS self-distribution supported but marks integrity unverified", () => {
  assert.deepEqual(
    getUpdaterSupport(
      {
        isPackaged: true,
        platform: "darwin",
        execPath: "/Applications/Luma.app/Contents/MacOS/Luma",
      },
      () => false,
    ),
    {
      supported: true,
      reason: null,
      signed: false,
      integrity: "unverified",
    },
  );
});

test("development and unsupported platforms do not enable updates", () => {
  assert.equal(
    getUpdaterSupport({ isPackaged: false, platform: "darwin", execPath: "" }).supported,
    false,
  );
  assert.equal(
    getUpdaterSupport({ isPackaged: true, platform: "linux", execPath: "/tmp/luma" }).reason,
    "platform",
  );
});
