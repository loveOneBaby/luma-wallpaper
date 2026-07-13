import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Windows installer name is stable and Electron security fuses are enabled", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  const artifactPattern = packageJson.build?.win?.artifactName;
  assert.equal(artifactPattern, "Luma-${version}-${arch}-Setup.${ext}");
  const expanded = artifactPattern
    .replace("${version}", packageJson.version)
    .replace("${arch}", "x64")
    .replace("${ext}", "exe");
  assert.equal(expanded, `Luma-${packageJson.version}-x64-Setup.exe`);
  assert.doesNotMatch(expanded, /\s/);

  assert.deepEqual(packageJson.build?.electronFuses, {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    resetAdHocDarwinSignature: true,
  });
});

test("all third-party GitHub Actions are pinned to full commit SHAs", async () => {
  const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");
  const workflowNames = (await readdir(workflowDirectory)).filter((name) => name.endsWith(".yml"));
  assert.ok(workflowNames.length > 0);

  for (const workflowName of workflowNames) {
    const workflow = await readFile(path.join(workflowDirectory, workflowName), "utf8");
    for (const match of workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
      const reference = match[1];
      if (reference.startsWith("./")) continue;
      const separator = reference.lastIndexOf("@");
      assert.ok(separator > 0, `${workflowName}: Action 缺少版本：${reference}`);
      assert.match(
        reference.slice(separator + 1),
        /^[0-9a-f]{40}$/,
        `${workflowName}: Action 必须固定到完整 commit SHA：${reference}`,
      );
    }
  }
});

test("npm is locked to the official registry and install-time audit is not disabled", async () => {
  const npmrc = await readFile(path.join(repositoryRoot, ".npmrc"), "utf8");
  assert.match(npmrc, /^registry=https:\/\/registry\.npmjs\.org\/$/m);
  assert.doesNotMatch(npmrc, /^audit=false$/m);
});

test("macOS release validates the notarized app bundle instead of an unstapled DMG", async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, ".github", "workflows", "release.yml"),
    "utf8",
  );
  assert.match(workflow, /xcrun stapler validate "\$APP_PATH"/);
  assert.doesNotMatch(workflow, /xcrun stapler validate "\$dmg"/);
  assert.match(workflow, /no Developer ID integrity verification/);
  assert.doesNotMatch(workflow, /cannot auto-update on macOS/);
});
