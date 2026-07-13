import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { URL } from "node:url";
import {
  acknowledgeUnsignedMacUpdateLaunch,
  recoverAbandonedUnsignedMacUpdate,
  removeUnsignedMacUpdateTree,
  selectUnsignedMacUpdateFile,
  shouldExitForActiveUnsignedMacUpdate,
  UNSIGNED_MAC_UPDATE_DIRECTORY,
  validateUnsignedMacBundleSymlinks,
  validateUnsignedMacZipEntries,
  verifyUnsignedMacUpdateArchive,
} from "../electron/unsigned-mac-update.mjs";

async function runInElectron(source) {
  const electronBinary = (await import("electron")).default;
  return new Promise((resolve, reject) => {
    const child = spawn(electronBinary, ["-e", source], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      if (exitCode === 0) resolve({ stdout, stderr });
      else reject(new Error(`Electron helper failed (${signal ?? exitCode}): ${stderr || stdout}`));
    });
  });
}

function manifestFor(contents = Buffer.from("luma update")) {
  const fileName = "Luma-9.8.7-arm64-mac.zip";
  const sha512 = createHash("sha512").update(contents).digest("base64");
  return {
    contents,
    updateInfo: {
      version: "9.8.7",
      path: fileName,
      sha512,
      files: [
        { url: fileName, sha512, size: contents.length },
        { url: "Luma-9.8.7-arm64-mac.dmg", sha512, size: contents.length },
      ],
    },
  };
}

test("selectUnsignedMacUpdateFile resolves the unique primary ZIP", () => {
  const { updateInfo } = manifestFor();
  assert.deepEqual(selectUnsignedMacUpdateFile(updateInfo), {
    version: "9.8.7",
    fileName: "Luma-9.8.7-arm64-mac.zip",
    sha512: updateInfo.sha512,
    size: 11,
  });
});

test("selectUnsignedMacUpdateFile rejects ambiguous or malformed integrity metadata", () => {
  const { updateInfo } = manifestFor();
  assert.throws(
    () =>
      selectUnsignedMacUpdateFile({
        ...updateInfo,
        files: [...updateInfo.files, { ...updateInfo.files[0], url: "another.zip" }],
      }),
    /只能包含一个 ZIP/,
  );
  assert.throws(() => selectUnsignedMacUpdateFile({ ...updateInfo, path: "../Luma.zip" }), /path/);
  assert.throws(
    () =>
      selectUnsignedMacUpdateFile({
        ...updateInfo,
        files: [{ ...updateInfo.files[0], sha512: "not-base64" }],
      }),
    /Base64/,
  );
  assert.throws(
    () =>
      selectUnsignedMacUpdateFile({
        ...updateInfo,
        files: [{ ...updateInfo.files[0], size: 0 }],
      }),
    /正整数/,
  );
});

test("validateUnsignedMacZipEntries accepts only one contained Luma.app tree", () => {
  assert.equal(
    validateUnsignedMacZipEntries([
      "Luma.app/",
      "Luma.app/Contents/",
      "Luma.app/Contents/MacOS/Luma",
      "Luma.app/Contents/Frameworks/Electron Framework.framework/Versions/Current",
    ]),
    true,
  );
  for (const entries of [
    ["Luma.app/", "../outside"],
    ["Luma.app/", "/tmp/outside"],
    ["Luma.app/", "Luma.app\\Contents\\Info.plist"],
    ["Luma.app/", "Luma.app/Contents/", "Luma.app/Contents"],
    ["Luma.app/", "Luma.app/Contents/\u0001bad"],
    ["Other.app/", "Other.app/Contents/Info.plist"],
  ]) {
    assert.throws(() => validateUnsignedMacZipEntries(entries));
  }
});

test("bundle symlink validation rejects links that leave the physical app tree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "luma-symlink-test-"));
  const bundlePath = path.join(root, "Luma.app");
  const contentsPath = path.join(bundlePath, "Contents");
  const outsidePath = path.join(root, "outside.txt");
  try {
    await mkdir(contentsPath, { recursive: true });
    await writeFile(outsidePath, "outside");
    await symlink(outsidePath, path.join(contentsPath, "escaped-link"));
    await assert.rejects(validateUnsignedMacBundleSymlinks(bundlePath), /应用外部的符号链接/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Electron treats app.asar as an opaque file during validation and cleanup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "luma-electron-asar-test-"));
  const bundlePath = path.join(root, "Luma.app");
  const resourcesPath = path.join(bundlePath, "Contents", "Resources");
  const moduleUrl = new URL("../electron/unsigned-mac-update.mjs", import.meta.url).href;
  try {
    await mkdir(resourcesPath, { recursive: true });
    await writeFile(path.join(resourcesPath, "app.asar"), "physical asar fixture");
    const source = `
      (async () => {
        const updater = await import(${JSON.stringify(moduleUrl)});
        await updater.validateUnsignedMacBundleSymlinks(${JSON.stringify(bundlePath)});
        await updater.removeUnsignedMacUpdateTree(${JSON.stringify(root)});
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    `;
    await runInElectron(source);
    await assert.rejects(access(root), /ENOENT/);
  } finally {
    await removeUnsignedMacUpdateTree(root);
  }
});

test("verifyUnsignedMacUpdateArchive checks file name, size, and SHA-512", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "luma-update-test-"));
  try {
    const { contents, updateInfo } = manifestFor();
    const metadata = selectUnsignedMacUpdateFile(updateInfo);
    const archivePath = path.join(temporaryDirectory, metadata.fileName);
    await writeFile(archivePath, contents);
    assert.equal(await verifyUnsignedMacUpdateArchive(archivePath, metadata), archivePath);

    await writeFile(archivePath, "tampered");
    await assert.rejects(verifyUnsignedMacUpdateArchive(archivePath, metadata), /大小/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test(
  "acknowledgeUnsignedMacUpdateLaunch only writes the marker for its matching plan",
  { skip: process.platform !== "darwin" },
  async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "luma-health-test-"));
    const stateDirectory = path.join(userDataPath, UNSIGNED_MAC_UPDATE_DIRECTORY);
    const token = "de305d54-75b4-431b-adb2-eb6b9e546014";
    const markerPath = path.join(stateDirectory, `health-${token}.json`);
    const currentAppPath = "/Applications/Luma.app";
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(
      path.join(stateDirectory, "pending.json"),
      JSON.stringify({
        schemaVersion: 1,
        token,
        currentApp: currentAppPath,
        healthMarker: markerPath,
        expectedBundleId: "com.luma.wallpaper",
        expectedVersion: "9.8.7",
      }),
    );

    try {
      assert.equal(
        await acknowledgeUnsignedMacUpdateLaunch({
          argv: ["Luma", "--luma-update-health-marker", markerPath, "--luma-update-token", token],
          userDataPath,
          currentVersion: "9.8.7",
          currentAppPath,
        }),
        true,
      );
      const marker = JSON.parse(await readFile(markerPath, "utf8"));
      assert.equal(marker.token, token);
      assert.equal(marker.bundleId, "com.luma.wallpaper");
      assert.equal(marker.version, "9.8.7");
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  },
);

test(
  "a matching recovery token may relaunch the old app while the helper finishes",
  { skip: process.platform !== "darwin" },
  async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "luma-relaunch-test-"));
    const stateDirectory = path.join(userDataPath, UNSIGNED_MAC_UPDATE_DIRECTORY);
    const planPath = path.join(stateDirectory, "pending.json");
    const token = "de305d54-75b4-431b-adb2-eb6b9e546016";
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(planPath, JSON.stringify({ schemaVersion: 1, token }));
    const fakeHelper = spawn("/bin/sleep", ["10"], {
      argv0: `luma-mac-update-helper --plan ${planPath}`,
    });
    await new Promise((resolve, reject) => {
      fakeHelper.once("spawn", resolve);
      fakeHelper.once("error", reject);
    });

    try {
      assert.equal(
        await shouldExitForActiveUnsignedMacUpdate({ argv: ["Luma"], userDataPath }),
        true,
      );
      assert.equal(
        await shouldExitForActiveUnsignedMacUpdate({
          argv: ["Luma", "--luma-update-recovery-token", token],
          userDataPath,
        }),
        false,
      );
      assert.equal(
        await shouldExitForActiveUnsignedMacUpdate({
          argv: ["Luma", "--luma-update-recovery-token", randomUUID()],
          userDataPath,
        }),
        true,
      );
    } finally {
      fakeHelper.kill("SIGKILL");
      await rm(userDataPath, { recursive: true, force: true });
    }
  },
);

test(
  "recoverAbandonedUnsignedMacUpdate keeps the running app and removes an abandoned sibling",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "luma-recovery-test-"));
    const userDataPath = path.join(root, "user-data");
    const stateDirectory = path.join(userDataPath, UNSIGNED_MAC_UPDATE_DIRECTORY);
    const currentAppPath = path.join(root, "Luma.app");
    const token = "de305d54-75b4-431b-adb2-eb6b9e546015";
    const candidateApp = path.join(root, `.Luma-update-${token}.app`);
    const healthMarker = path.join(stateDirectory, `health-${token}.json`);
    await mkdir(currentAppPath, { recursive: true });
    await mkdir(candidateApp, { recursive: true });
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(healthMarker, "stale");
    await writeFile(
      path.join(stateDirectory, "pending.json"),
      JSON.stringify({
        schemaVersion: 1,
        token,
        currentApp: currentAppPath,
        candidateApp,
        healthMarker,
      }),
    );

    try {
      assert.equal(
        await recoverAbandonedUnsignedMacUpdate({
          argv: ["Luma"],
          userDataPath,
          currentAppPath,
          logger: { info() {}, warn() {} },
        }),
        true,
      );
      await assert.rejects(readFile(path.join(stateDirectory, "pending.json")), /ENOENT/);
      await assert.rejects(readFile(healthMarker), /ENOENT/);
      await assert.rejects(readFile(candidateApp), /ENOENT|EISDIR/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
