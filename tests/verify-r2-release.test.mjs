import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyR2Release } from "../scripts/verify-r2-release.mjs";

function digest(content, algorithm, encoding) {
  return createHash(algorithm).update(content).digest(encoding);
}

function buildManifest(artifactName, artifact) {
  return [
    "version: 0.1.6",
    "files:",
    `  - url: ${artifactName}`,
    `    sha512: ${digest(artifact, "sha512", "base64")}`,
    `    size: ${artifact.length}`,
    `path: ${artifactName}`,
    `sha512: ${digest(artifact, "sha512", "base64")}`,
    "releaseDate: '2026-07-13T00:00:00.000Z'",
    "",
  ].join("\n");
}

async function prepareDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "luma-r2-test-"));
  const artifactName = "Luma-0.1.6-x64-Setup.exe";
  const artifact = Buffer.from("installer-payload");
  const manifestName = "latest.yml";
  const manifest = Buffer.from(buildManifest(artifactName, artifact));
  await writeFile(path.join(directory, artifactName), artifact);
  await writeFile(path.join(directory, manifestName), manifest);
  return { directory, artifactName, artifact, manifestName, manifest };
}

function installFetchMock({ artifact, manifest, manifestName, artifactName }) {
  const originalFetch = globalThis.fetch;
  const headRequests = [];
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    if (requestUrl.endsWith(`/${manifestName}`)) {
      if (options.method === "HEAD") {
        return new globalThis.Response(null, {
          status: 200,
          headers: { "Content-Length": String(manifest.length) },
        });
      }
      return new globalThis.Response(manifest, { status: 200 });
    }
    if (requestUrl.endsWith(`/${artifactName}`)) {
      if (options.method === "HEAD") {
        headRequests.push(artifactName);
        return new globalThis.Response(null, {
          status: 200,
          headers: { "Content-Length": String(artifact.length) },
        });
      }
      return new globalThis.Response(artifact, { status: 200 });
    }
    return new globalThis.Response("not found", { status: 404 });
  };
  return {
    originalFetch,
    headRequests,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test("verifies R2 manifests and referenced artifacts over HTTP", async (context) => {
  const fixture = await prepareDirectory();
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const mock = installFetchMock(fixture);
  context.after(mock.restore);

  const result = await verifyR2Release({
    "base-url": "https://r2.test",
    "local-dir": fixture.directory,
  });
  assert.deepEqual(result, { manifestCount: 1, artifactCount: 1 });
  assert.deepEqual(mock.headRequests, [fixture.artifactName]);
});

test("fails when the remote manifest text diverges from the local copy", async (context) => {
  const fixture = await prepareDirectory();
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith(`/${fixture.manifestName}`)) {
      return new globalThis.Response(
        Buffer.from(buildManifest(fixture.artifactName, Buffer.from("different-payload"))),
        { status: 200 },
      );
    }
    return new globalThis.Response("not found", { status: 404 });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    verifyR2Release({ "base-url": "https://r2.test", "local-dir": fixture.directory }),
    /远端清单内容与本地不一致/,
  );
});

test("fails when a referenced artifact reports the wrong size", async (context) => {
  const fixture = await prepareDirectory();
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    if (requestUrl.endsWith(`/${fixture.manifestName}`)) {
      return new globalThis.Response(fixture.manifest, { status: 200 });
    }
    if (requestUrl.endsWith(`/${fixture.artifactName}`) && options.method === "HEAD") {
      return new globalThis.Response(null, {
        status: 200,
        headers: { "Content-Length": String(fixture.artifact.length + 999) },
      });
    }
    return new globalThis.Response("not found", { status: 404 });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    verifyR2Release({ "base-url": "https://r2.test", "local-dir": fixture.directory }),
    /大小不一致/,
  );
});
