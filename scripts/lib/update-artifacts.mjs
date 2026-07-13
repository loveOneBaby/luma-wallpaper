import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

function parseScalar(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value);
  }
  return value;
}

function parseInteger(rawValue, field, source) {
  const scalar = parseScalar(rawValue);
  if (!/^[1-9][0-9]*$/.test(scalar)) {
    throw new Error(`${source}: ${field} 必须是正整数`);
  }
  const value = Number(scalar);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${source}: ${field} 必须是安全的正整数`);
  }
  return value;
}

export function validateSha512Base64(value, field, source = "update manifest") {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value)) {
    throw new Error(`${source}: ${field} 必须是规范的 SHA-512 Base64 摘要`);
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== value) {
    throw new Error(`${source}: ${field} 必须解码为 64 字节的规范 SHA-512 摘要`);
  }
  return value;
}

/**
 * Parse the deliberately small electron-builder update YAML schema without
 * pulling a YAML runtime into release-verification jobs. Unknown top-level
 * fields are retained as scalar strings; every files[] entry is validated.
 */
export function parseUpdateManifest(text, source = "update manifest") {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error(`${source}: 更新清单为空`);
  }

  const manifest = { files: [] };
  let inFiles = false;
  let currentFile = null;

  for (const [index, originalLine] of text.replace(/\r\n?/g, "\n").split("\n").entries()) {
    if (!originalLine.trim() || originalLine.trimStart().startsWith("#")) continue;

    const indent = originalLine.length - originalLine.trimStart().length;
    const line = originalLine.trim();

    if (indent === 0 && line === "files:") {
      inFiles = true;
      currentFile = null;
      continue;
    }

    if (inFiles && indent > 0) {
      const itemMatch = line.match(/^-\s+url:\s*(.+)$/);
      if (itemMatch) {
        currentFile = { url: parseScalar(itemMatch[1]) };
        manifest.files.push(currentFile);
        continue;
      }

      const fieldMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
      if (!currentFile || !fieldMatch) {
        throw new Error(`${source}:${index + 1}: 无法解析 files 条目`);
      }
      const [, field, rawValue] = fieldMatch;
      currentFile[field] =
        field === "size" ? parseInteger(rawValue, field, source) : parseScalar(rawValue);
      continue;
    }

    inFiles = false;
    currentFile = null;
    const fieldMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!fieldMatch) throw new Error(`${source}:${index + 1}: 无法解析更新清单`);
    const [, field, rawValue] = fieldMatch;
    manifest[field] =
      field === "size" ? parseInteger(rawValue, field, source) : parseScalar(rawValue);
  }

  if (!manifest.version) throw new Error(`${source}: 缺少 version`);
  if (!manifest.files.length) throw new Error(`${source}: files 不能为空`);
  for (const [index, file] of manifest.files.entries()) {
    if (!file.url) throw new Error(`${source}: files[${index}] 缺少 url`);
    if (!file.sha512) throw new Error(`${source}: files[${index}] 缺少 sha512`);
    validateSha512Base64(file.sha512, `files[${index}].sha512`, source);
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error(`${source}: files[${index}] 缺少有效 size`);
    }
  }
  if (manifest.sha512) validateSha512Base64(manifest.sha512, "sha512", source);

  return manifest;
}

/** Restrict update URLs to the flat, relative asset names uploaded to Releases. */
export function normalizeArtifactReference(reference, source = "update manifest") {
  if (typeof reference !== "string" || !reference.trim()) {
    throw new Error(`${source}: 产物 URL 为空`);
  }

  const raw = reference.trim();
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || raw.startsWith("/") || raw.startsWith("\\")) {
    throw new Error(`${source}: 产物 URL 必须是相对文件名：${raw}`);
  }

  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new Error(`${source}: 产物 URL 编码无效：${raw}`);
  }

  if (
    decoded === "." ||
    decoded === ".." ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    decoded.includes("?") ||
    decoded.includes("#") ||
    path.basename(decoded) !== decoded
  ) {
    throw new Error(`${source}: 产物 URL 不能包含目录或查询参数：${raw}`);
  }
  return decoded;
}

function collectArtifactEntries(manifest, source) {
  const entries = new Map();
  for (const file of manifest.files) {
    const name = normalizeArtifactReference(file.url, source);
    if (entries.has(name)) throw new Error(`${source}: 重复引用产物 ${name}`);
    entries.set(name, file);
  }
  return entries;
}

function resolvePrimaryFromEntries(manifest, entries, source, required) {
  if (!manifest.path) {
    if (required) throw new Error(`${source}: 缺少主产物 path`);
    return null;
  }

  const name = normalizeArtifactReference(manifest.path, source);
  const metadata = entries.get(name);
  if (!metadata) throw new Error(`${source}: path 未出现在 files[] 中：${name}`);
  if (manifest.sha512 && manifest.sha512 !== metadata.sha512) {
    throw new Error(`${source}: 顶层 sha512 与主产物不一致`);
  }
  return { name, metadata };
}

export function resolvePrimaryArtifact(manifest, source = "update manifest") {
  const entries = collectArtifactEntries(manifest, source);
  return resolvePrimaryFromEntries(manifest, entries, source, true);
}

export function referencedArtifacts(
  manifest,
  source = "update manifest",
  { requirePrimary = false } = {},
) {
  const entries = collectArtifactEntries(manifest, source);
  resolvePrimaryFromEntries(manifest, entries, source, requirePrimary);
  return entries;
}

export async function hashFile(filePath, algorithm, encoding = "hex") {
  const hash = createHash(algorithm);
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest(encoding);
}

export async function validateManifestArtifacts(manifestPath, artifactDirectory) {
  const source = path.basename(manifestPath);
  const manifest = parseUpdateManifest(await readFile(manifestPath, "utf8"), source);
  const entries = referencedArtifacts(manifest, source, { requirePrimary: true });

  for (const [name, metadata] of entries) {
    const artifactPath = path.join(artifactDirectory, name);
    let artifactStat;
    try {
      artifactStat = await stat(artifactPath);
    } catch {
      throw new Error(`${source}: 引用的产物不存在：${name}`);
    }
    if (!artifactStat.isFile()) throw new Error(`${source}: 引用目标不是文件：${name}`);
    if (artifactStat.size !== metadata.size) {
      throw new Error(
        `${source}: ${name} 大小不一致（清单 ${metadata.size}，实际 ${artifactStat.size}）`,
      );
    }

    const sha512 = await hashFile(artifactPath, "sha512", "base64");
    if (sha512 !== metadata.sha512) throw new Error(`${source}: ${name} 的 sha512 不匹配`);
  }

  return { manifest, artifactNames: [...entries.keys()] };
}
