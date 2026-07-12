#!/usr/bin/env node

import console from "node:console";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  hashFile,
  parseUpdateManifest,
  referencedArtifacts,
  validateManifestArtifacts,
} from "./lib/update-artifacts.mjs";

const RETRY_DELAYS_MS = [0, 1_000, 2_000, 4_000, 8_000];

function parseArguments(argv) {
  const options = { token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) throw new Error(`未知参数：${flag}`);
    const key = flag.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} 缺少参数`);
    options[key] = value;
    index += 1;
  }
  for (const required of ["repo", "tag", "local-dir"]) {
    if (!options[required]) throw new Error(`缺少 --${required}`);
  }
  return options;
}

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (const waitMs of RETRY_DELAYS_MS) {
    if (waitMs) await wait(waitMs);
    try {
      const response = await globalThis.fetch(url, { redirect: "follow", ...options });
      if (response.ok) return response;
      lastError = new Error(`${options.method ?? "GET"} ${url} 返回 HTTP ${response.status}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`无法访问 ${url}`);
}

function requestHeaders(token, api = false) {
  return {
    Accept: api ? "application/vnd.github+json" : "application/octet-stream",
    "User-Agent": "luma-release-verifier",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(api ? { "X-GitHub-Api-Version": "2022-11-28" } : {}),
  };
}

// Release asset download URLs (github.com/<owner>/<repo>/releases/download/<tag>/<file>)
// reject the auto-generated GITHUB_TOKEN Bearer header with HTTP 401. For a public
// repo the anonymous redirect (302 -> CDN) confirms downloadability; API calls
// still authenticate through requestHeaders(token).
function downloadHeaders() {
  return requestHeaders(null);
}

async function fetchApiJson(apiPath, token) {
  const response = await fetchWithRetry(`https://api.github.com${apiPath}`, {
    headers: requestHeaders(token, true),
  });
  return response.json();
}

async function resolveTagCommit(repo, tag, token) {
  let object = (await fetchApiJson(`/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`, token))
    .object;
  for (let depth = 0; object?.type === "tag" && depth < 5; depth += 1) {
    object = (await fetchApiJson(`/repos/${repo}/git/tags/${object.sha}`, token)).object;
  }
  if (object?.type !== "commit" || !object.sha) throw new Error(`无法解析标签 ${tag} 的提交`);
  return object.sha;
}

async function localFiles(directory) {
  const names = [];
  for (const name of await readdir(directory)) {
    if ((await stat(path.join(directory, name))).isFile()) names.push(name);
  }
  return names.sort();
}

export async function verifyGitHubRelease(options) {
  const localDirectory = path.resolve(options["local-dir"]);
  const localNames = await localFiles(localDirectory);
  if (!localNames.length) throw new Error(`本地产物目录为空：${localDirectory}`);

  const manifestNames = localNames.filter((name) => /^latest(?:-[A-Za-z0-9_-]+)?\.yml$/.test(name));
  if (!manifestNames.length) throw new Error("本地产物中没有更新清单");
  for (const name of manifestNames) {
    await validateManifestArtifacts(path.join(localDirectory, name), localDirectory);
  }

  if (options["expected-sha"]) {
    const tagCommit = await resolveTagCommit(options.repo, options.tag, options.token);
    if (tagCommit !== options["expected-sha"]) {
      throw new Error(`标签提交不一致：期望 ${options["expected-sha"]}，实际 ${tagCommit}`);
    }
  }

  const release = await fetchApiJson(
    `/repos/${options.repo}/releases/tags/${encodeURIComponent(options.tag)}`,
    options.token,
  );
  if (release.draft || release.prerelease) throw new Error(`${options.tag} 不是正式公开 Release`);

  const assets = new Map((release.assets ?? []).map((asset) => [asset.name, asset]));
  const remoteNames = [...assets.keys()].sort();
  const missing = localNames.filter((name) => !assets.has(name));
  const unexpected = remoteNames.filter((name) => !localNames.includes(name));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Release 产物集合不一致；缺少 [${missing.join(", ")}]，多出 [${unexpected.join(", ")}]`,
    );
  }

  await Promise.all(
    localNames.map(async (name) => {
      const localPath = path.join(localDirectory, name);
      const localStat = await stat(localPath);
      const asset = assets.get(name);
      if (asset.size !== localStat.size) {
        throw new Error(`${name} 上传后大小不一致（本地 ${localStat.size}，远端 ${asset.size}）`);
      }
      if (!asset.digest?.startsWith("sha256:")) {
        throw new Error(`${name} 的 GitHub API 响应缺少 sha256 digest`);
      }
      const localDigest = await hashFile(localPath, "sha256", "hex");
      if (asset.digest !== `sha256:${localDigest}`) throw new Error(`${name} 上传后 sha256 不一致`);
      await fetchWithRetry(asset.browser_download_url, {
        method: "HEAD",
        headers: downloadHeaders(),
      });
    }),
  );

  for (const manifestName of manifestNames) {
    const asset = assets.get(manifestName);
    const response = await fetchWithRetry(asset.browser_download_url, {
      headers: downloadHeaders(),
    });
    const remoteText = await response.text();
    const localText = await readFile(path.join(localDirectory, manifestName), "utf8");
    if (remoteText !== localText) throw new Error(`${manifestName} 远端内容与本地不一致`);

    const manifest = parseUpdateManifest(remoteText, manifestName);
    for (const [name, metadata] of referencedArtifacts(manifest, manifestName)) {
      const referencedAsset = assets.get(name);
      if (!referencedAsset) throw new Error(`${manifestName} 远端引用不存在：${name}`);
      if (referencedAsset.size !== metadata.size) {
        throw new Error(`${manifestName} 远端引用大小不一致：${name}`);
      }
    }
  }

  return { assetCount: localNames.length, manifestCount: manifestNames.length };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const result = await verifyGitHubRelease(options);
  console.log(
    `✓ ${options.repo}@${options.tag}：${result.assetCount} 个远端产物、${result.manifestCount} 份更新清单均已验证。`,
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
