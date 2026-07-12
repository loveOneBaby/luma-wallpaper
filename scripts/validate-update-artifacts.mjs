#!/usr/bin/env node

import console from "node:console";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateManifestArtifacts } from "./lib/update-artifacts.mjs";

function parseArguments(argv) {
  let directory = "release";
  const manifests = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--dir") {
      directory = argv[index + 1];
      index += 1;
    } else {
      manifests.push(argv[index]);
    }
  }
  if (!directory) throw new Error("--dir 需要目录参数");
  return { directory: path.resolve(directory), manifests };
}

export async function main(argv = process.argv.slice(2)) {
  const { directory, manifests: requestedManifests } = parseArguments(argv);
  const directoryStat = await stat(directory);
  if (!directoryStat.isDirectory()) throw new Error(`产物目录不存在：${directory}`);

  const manifests = requestedManifests.length
    ? requestedManifests.map((manifest) => path.resolve(manifest))
    : (await readdir(directory))
        .filter((name) => /^latest(?:-[A-Za-z0-9_-]+)?\.yml$/.test(name))
        .sort()
        .map((name) => path.join(directory, name));

  if (!manifests.length) throw new Error(`未在 ${directory} 找到更新清单`);
  let totalArtifacts = 0;
  for (const manifestPath of manifests) {
    const result = await validateManifestArtifacts(manifestPath, directory);
    totalArtifacts += result.artifactNames.length;
    console.log(`✓ ${path.basename(manifestPath)} → ${result.artifactNames.join(", ")}`);
  }
  console.log(`已验证 ${manifests.length} 份更新清单、${totalArtifacts} 个产物引用。`);
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
