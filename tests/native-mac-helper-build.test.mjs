import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  NATIVE_MAC_HELPER_RELATIVE_PATH,
  macArchitectureForElectronBuilder,
} from "../scripts/build-native-macos-helper.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("native macOS helper architecture mapping matches electron-builder", () => {
  assert.equal(macArchitectureForElectronBuilder(1), "x86_64");
  assert.equal(macArchitectureForElectronBuilder(3), "arm64");
  assert.equal(macArchitectureForElectronBuilder("x64"), "x86_64");
  assert.equal(macArchitectureForElectronBuilder("arm64"), "arm64");
  assert.throws(() => macArchitectureForElectronBuilder(0), /Unsupported/);
});

test("native macOS helper is installed at the stable runtime resource path", async () => {
  assert.equal(
    NATIVE_MAC_HELPER_RELATIVE_PATH,
    path.join("native", "luma-mac-update-helper"),
  );

  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(packageJson.build?.afterPack, "scripts/build-native-macos-helper.mjs");

  const helperSource = await readFile(
    path.join(repositoryRoot, "build/native-macos-updater/Sources/main.swift"),
    "utf8",
  );
  assert.match(helperSource, /--luma-update-recovery-token/);
});
