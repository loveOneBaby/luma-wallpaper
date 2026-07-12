import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  normalizeArtifactReference,
  parseUpdateManifest,
  referencedArtifacts,
  validateManifestArtifacts,
} from "../scripts/lib/update-artifacts.mjs";

function sha512Base64(content) {
  return createHash("sha512").update(content).digest("base64");
}

function manifestFor(name, content, overrides = {}) {
  const size = overrides.size ?? content.length;
  const sha512 = overrides.sha512 ?? sha512Base64(content);
  return [
    "version: 0.1.5",
    "files:",
    `  - url: ${name}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${name}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-07-12T00:00:00.000Z'",
    "",
  ].join("\n");
}

test("parses an electron-builder manifest and preserves every file entry", () => {
  const content = Buffer.from("installer");
  const manifest = parseUpdateManifest(manifestFor("Luma-0.1.5-x64-Setup.exe", content));
  assert.equal(manifest.version, "0.1.5");
  assert.deepEqual([...referencedArtifacts(manifest).keys()], ["Luma-0.1.5-x64-Setup.exe"]);
});

test("rejects absolute URLs and path traversal in update references", () => {
  assert.throws(() => normalizeArtifactReference("https://example.com/Luma.exe"), /相对文件名/);
  assert.throws(() => normalizeArtifactReference("../Luma.exe"), /不能包含目录/);
  assert.throws(() => normalizeArtifactReference("folder/Luma.exe"), /不能包含目录/);
});

test("verifies referenced artifact size and sha512", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "luma-update-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const name = "Luma-0.1.5-x64-Setup.exe";
  const content = Buffer.from("signed-installer-content");
  const manifestPath = path.join(directory, "latest.yml");
  await writeFile(path.join(directory, name), content);
  await writeFile(manifestPath, manifestFor(name, content));

  const result = await validateManifestArtifacts(manifestPath, directory);
  assert.deepEqual(result.artifactNames, [name]);
});

test("fails when a manifest references a missing or changed artifact", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "luma-update-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const name = "Luma-0.1.5-x64-Setup.exe";
  const content = Buffer.from("expected");
  const manifestPath = path.join(directory, "latest.yml");
  await writeFile(manifestPath, manifestFor(name, content));
  await assert.rejects(validateManifestArtifacts(manifestPath, directory), /产物不存在/);

  await writeFile(path.join(directory, name), Buffer.from("tampered"));
  await writeFile(
    manifestPath,
    manifestFor(name, Buffer.from("tampered"), { sha512: sha512Base64(content) }),
  );
  await assert.rejects(validateManifestArtifacts(manifestPath, directory), /sha512 不匹配/);
});
