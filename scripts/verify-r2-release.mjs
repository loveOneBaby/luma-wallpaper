#!/usr/bin/env node

import console from "node:console";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseUpdateManifest, referencedArtifacts } from "./lib/update-artifacts.mjs";

// R2 is strongly consistent for reads right after writes, but keep a small
// retry window for transient post-publish propagation through any CDN edge.
const RETRY_DELAYS_MS = [0, 1_000, 2_000, 4_000];

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) throw new Error(`未知参数：${flag}`);
    const key = flag.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} 缺少参数`);
    options[key] = value;
    index += 1;
  }
  for (const required of ["base-url", "local-dir"]) {
    if (!options[required]) throw new Error(`缺少 --${required}`);
  }
  return options;
}

function trimTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (const waitMs of RETRY_DELAYS_MS) {
    if (waitMs) await wait(waitMs);
    try {
      const response = await globalThis.fetch(url, { redirect: "follow", ...options });
      if (response.ok) return response;
      lastError = new Error(`${options.method ?? "GET"} ${url} 返回 HTTP ${response.status}`);
      const retryable =
        response.status === 404
        || response.status === 408
        || response.status === 429
        || response.status >= 500;
      if (!retryable) break;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`无法访问 ${url}`);
}

async function fetchText(baseUrl, name) {
  const response = await fetchWithRetry(`${baseUrl}/${name}`, { method: "GET" });
  return response.text();
}

async function headContentSize(baseUrl, name) {
  const response = await fetchWithRetry(`${baseUrl}/${name}`, { method: "HEAD" });
  const length = Number.parseInt(response.headers.get("Content-Length") ?? "", 10);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(`${name}: 远端未返回有效的 Content-Length`);
  }
  return length;
}

// R2 public objects are anonymously readable; no token is sent on the
// download/manifest URLs (and R2 would reject a Bearer header anyway).
export async function verifyR2Release(options) {
  const baseUrl = trimTrailingSlash(options["base-url"]);
  const localDirectory = path.resolve(options["local-dir"]);
  const names = (await readdir(localDirectory))
    .filter((name) => /^latest(?:-[A-Za-z0-9_-]+)?\.yml$/.test(name))
    .sort();
  if (!names.length) throw new Error(`本地目录中没有更新清单：${localDirectory}`);

  let artifactCount = 0;
  for (const name of names) {
    const localText = await readFile(path.join(localDirectory, name), "utf8");
    const remoteText = await fetchText(baseUrl, name);
    if (remoteText !== localText) {
      throw new Error(`${name}: 远端清单内容与本地不一致`);
    }
    const manifest = parseUpdateManifest(remoteText, name);
    const entries = referencedArtifacts(manifest, name);
    for (const [artifactName, metadata] of entries) {
      const remoteSize = await headContentSize(baseUrl, artifactName);
      if (remoteSize !== metadata.size) {
        throw new Error(
          `${name}: ${artifactName} 大小不一致（清单 ${metadata.size}，远端 ${remoteSize}）`,
        );
      }
      artifactCount += 1;
    }
  }

  return { manifestCount: names.length, artifactCount };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const result = await verifyR2Release(options);
  console.log(
    `✓ ${options["base-url"]}:${result.manifestCount} 份更新清单、${result.artifactCount} 个产物引用均已通过 HTTP 校验。`,
  );
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
