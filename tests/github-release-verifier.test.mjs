import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyGitHubRelease } from "../scripts/verify-github-release.mjs";

function digest(content, algorithm, encoding) {
  return createHash(algorithm).update(content).digest(encoding);
}

test("verifies release assets through GitHub API metadata and HTTP", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "luma-release-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));

  const artifactName = "Luma-0.1.5-x64-Setup.exe";
  const artifact = Buffer.from("installer");
  const manifestName = "latest.yml";
  const manifest = Buffer.from(
    [
      "version: 0.1.5",
      "files:",
      `  - url: ${artifactName}`,
      `    sha512: ${digest(artifact, "sha512", "base64")}`,
      `    size: ${artifact.length}`,
      `path: ${artifactName}`,
      `sha512: ${digest(artifact, "sha512", "base64")}`,
      "releaseDate: '2026-07-12T00:00:00.000Z'",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(directory, artifactName), artifact);
  await writeFile(path.join(directory, manifestName), manifest);

  const assets = [
    { name: artifactName, content: artifact },
    { name: manifestName, content: manifest },
  ].map(({ name, content }, index) => ({
    id: index + 1,
    name,
    size: content.length,
    digest: `sha256:${digest(content, "sha256", "hex")}`,
    browser_download_url: `https://downloads.test/${name}`,
  }));

  const originalFetch = globalThis.fetch;
  const headRequests = [];
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    if (requestUrl.includes("/git/ref/tags/v0.1.5")) {
      return new globalThis.Response(
        JSON.stringify({ object: { type: "commit", sha: "a".repeat(40) } }),
        { status: 200 },
      );
    }
    if (requestUrl.includes("/releases/tags/v0.1.5")) {
      return new globalThis.Response(JSON.stringify({ draft: false, prerelease: false, assets }), {
        status: 200,
      });
    }
    const asset = assets.find((candidate) => candidate.browser_download_url === requestUrl);
    if (!asset) return new globalThis.Response("not found", { status: 404 });
    if (options.method === "HEAD") {
      headRequests.push(asset.name);
      return new globalThis.Response(null, { status: 200 });
    }
    return new globalThis.Response(asset.name === manifestName ? manifest : artifact, {
      status: 200,
    });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await verifyGitHubRelease({
    repo: "loveOneBaby/luma-wallpaper",
    tag: "v0.1.5",
    "expected-sha": "a".repeat(40),
    "local-dir": directory,
    token: "test-token",
  });
  assert.deepEqual(result, { assetCount: 2, manifestCount: 1 });
  assert.deepEqual(headRequests.sort(), [artifactName, manifestName].sort());
});
