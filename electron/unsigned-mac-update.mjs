import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

export const UNSIGNED_MAC_UPDATE_DIRECTORY = "unsigned-mac-update";
export const UNSIGNED_MAC_HELPER_RELATIVE_PATH = path.join(
  "native",
  "luma-mac-update-helper",
);

const APP_BUNDLE_NAME = "Luma.app";
const BUNDLE_IDENTIFIER = "com.luma.wallpaper";
const EXECUTABLE_NAME = "Luma";
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_SECONDS = 45;
const HELPER_START_TIMEOUT_MS = 5_000;

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

function normalizeFlatAssetName(value, label) {
  const raw = assertNonEmptyString(value, label);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || raw.startsWith("/") || raw.startsWith("\\")) {
    throw new Error(`${label}必须是发布页中的相对文件名`);
  }

  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new Error(`${label}编码无效`);
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
    throw new Error(`${label}不能包含目录或查询参数`);
  }
  return decoded;
}

function normalizeSha512(value, label = "sha512") {
  const encoded = assertNonEmptyString(value, label);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error(`${label}不是规范的 Base64`);
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== encoded) {
    throw new Error(`${label}必须是 64 字节 SHA-512 的规范 Base64`);
  }
  return encoded;
}

function normalizeSize(value, label = "size") {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须是正整数`);
  return value;
}

function isPathInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

async function ensurePrivateDirectory(directoryPath) {
  try {
    const directoryStat = await lstat(directoryPath);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error("更新状态目录无效");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  }
  await chmod(directoryPath, 0o700);
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    timeout: COMMAND_TIMEOUT_MS,
    ...options,
  });
}

async function hashSha512(filePath) {
  const hash = createHash("sha512");
  await new Promise((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
  return hash.digest("base64");
}

async function readPlistValue(plistPath, key) {
  const { stdout } = await run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plistPath]);
  return stdout.trim();
}

export function validateUnsignedMacZipEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("更新 ZIP 为空");
  const seen = new Set();
  for (const rawEntry of entries) {
    const hasControlCharacter =
      typeof rawEntry === "string" &&
      [...rawEntry].some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint <= 31 || codePoint === 127;
      });
    if (typeof rawEntry !== "string" || !rawEntry || hasControlCharacter) {
      throw new Error("更新 ZIP 包含无效文件名");
    }
    const entry = rawEntry.endsWith("/") ? rawEntry.slice(0, -1) : rawEntry;
    const segments = entry.split("/");
    if (
      !entry ||
      rawEntry.startsWith("/") ||
      rawEntry.includes("\\") ||
      segments.some((segment) => !segment || segment === "." || segment === "..") ||
      path.posix.normalize(entry) !== entry ||
      (entry !== APP_BUNDLE_NAME && !entry.startsWith(`${APP_BUNDLE_NAME}/`))
    ) {
      throw new Error("更新 ZIP 包含应用目录以外的路径");
    }
    if (seen.has(entry)) throw new Error("更新 ZIP 包含重复路径");
    seen.add(entry);
  }
  if (!seen.has(APP_BUNDLE_NAME)) throw new Error("更新 ZIP 缺少 Luma.app 根目录");
  return true;
}

async function validateArchiveEntryPaths(archivePath) {
  const { stdout } = await run("/usr/bin/unzip", ["-Z1", archivePath]);
  return validateUnsignedMacZipEntries(stdout.replace(/\r\n?/g, "\n").split("\n").filter(Boolean));
}

async function validateBundleSymlinks(bundlePath) {
  // macOS commonly exposes /var as a symlink to /private/var. Compare every
  // link against the canonical bundle root or valid framework links look like
  // they escape when staging lives in the system temp directory.
  const root = await realpath(bundlePath);
  const queue = [root];

  while (queue.length) {
    const directory = queue.pop();
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const entryPath = path.join(directory, entry.name);
      const entryStat = await lstat(entryPath);
      if (entryStat.isSymbolicLink()) {
        const resolvedTarget = await realpath(entryPath).catch(() => null);
        if (!resolvedTarget || !isPathInside(root, resolvedTarget)) {
          throw new Error(`更新包包含指向应用外部的符号链接：${path.relative(root, entryPath)}`);
        }
      } else if (entryStat.isDirectory()) {
        queue.push(entryPath);
      }
    }
  }
}

export function selectUnsignedMacUpdateFile(updateInfo) {
  if (!updateInfo || typeof updateInfo !== "object") throw new Error("更新清单无效");
  const version = assertNonEmptyString(updateInfo.version, "更新版本");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("更新版本格式无效");
  }

  const primaryName = normalizeFlatAssetName(updateInfo.path, "更新清单 path");
  if (path.extname(primaryName).toLowerCase() !== ".zip") {
    throw new Error("未签名 macOS 更新必须使用 ZIP 主产物");
  }
  if (!Array.isArray(updateInfo.files) || updateInfo.files.length === 0) {
    throw new Error("更新清单 files 不能为空");
  }

  const matchingFiles = updateInfo.files.filter((file) => {
    try {
      return normalizeFlatAssetName(file?.url, "更新文件 URL") === primaryName;
    } catch {
      return false;
    }
  });
  if (matchingFiles.length !== 1) throw new Error("更新清单 path 必须唯一对应 files[] 中的 ZIP");

  const zipEntries = updateInfo.files.filter((file) => {
    try {
      return path.extname(normalizeFlatAssetName(file?.url, "更新文件 URL")).toLowerCase() === ".zip";
    } catch {
      return false;
    }
  });
  if (zipEntries.length !== 1) throw new Error("macOS 更新清单必须且只能包含一个 ZIP");

  const file = matchingFiles[0];
  const sha512 = normalizeSha512(file.sha512, "更新文件 sha512");
  const size = normalizeSize(file.size, "更新文件 size");
  if (updateInfo.sha512 && normalizeSha512(updateInfo.sha512, "顶层 sha512") !== sha512) {
    throw new Error("更新清单顶层 sha512 与 ZIP 不一致");
  }

  return { version, fileName: primaryName, sha512, size };
}

export async function verifyUnsignedMacUpdateArchive(filePath, metadata) {
  const archivePath = path.resolve(assertNonEmptyString(filePath, "更新文件路径"));
  const archiveStat = await stat(archivePath);
  if (!archiveStat.isFile()) throw new Error("下载的更新不是文件");
  if (path.basename(archivePath) !== metadata.fileName) throw new Error("下载文件与更新清单不一致");
  if (archiveStat.size !== metadata.size) throw new Error("下载文件大小与更新清单不一致");
  if ((await hashSha512(archivePath)) !== metadata.sha512) {
    throw new Error("下载文件 SHA-512 校验失败");
  }
  return archivePath;
}

export async function validateUnsignedMacAppBundle(
  bundlePath,
  { version, architecture, expectedBundleIdentifier = BUNDLE_IDENTIFIER } = {},
) {
  const resolvedBundlePath = path.resolve(bundlePath);
  const bundleStat = await lstat(resolvedBundlePath);
  if (!bundleStat.isDirectory() || bundleStat.isSymbolicLink()) throw new Error("更新包中的应用无效");

  await validateBundleSymlinks(resolvedBundlePath);
  const infoPlistPath = path.join(resolvedBundlePath, "Contents", "Info.plist");
  const [identifier, shortVersion, bundleVersion, executableName] = await Promise.all([
    readPlistValue(infoPlistPath, "CFBundleIdentifier"),
    readPlistValue(infoPlistPath, "CFBundleShortVersionString"),
    readPlistValue(infoPlistPath, "CFBundleVersion"),
    readPlistValue(infoPlistPath, "CFBundleExecutable"),
  ]);
  if (identifier !== expectedBundleIdentifier) throw new Error("更新应用的 Bundle ID 不匹配");
  if (shortVersion !== version || bundleVersion !== version) throw new Error("更新应用版本与清单不匹配");
  if (executableName !== EXECUTABLE_NAME) throw new Error("更新应用的主程序名称不正确");

  const executablePath = path.join(resolvedBundlePath, "Contents", "MacOS", executableName);
  const executableStat = await lstat(executablePath);
  if (!executableStat.isFile() || executableStat.isSymbolicLink()) throw new Error("更新应用主程序无效");
  await access(executablePath, 1);

  const expectedArchitecture = architecture === "x64" ? "x86_64" : architecture;
  if (expectedArchitecture !== "arm64" && expectedArchitecture !== "x86_64") {
    throw new Error(`不支持的更新架构：${architecture}`);
  }
  const { stdout: architectureOutput } = await run("/usr/bin/lipo", ["-archs", executablePath]);
  const architectures = architectureOutput.trim().split(/\s+/);
  if (!architectures.includes(expectedArchitecture)) throw new Error("更新应用架构与当前版本不匹配");

  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", resolvedBundlePath]);
  return { bundlePath: resolvedBundlePath, executablePath, version, architecture };
}

async function writeJsonAtomically(filePath, value, mode = 0o600) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, filePath);
    await chmod(filePath, mode);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function reservePendingPlan(planPath) {
  let handle;
  let created = false;
  try {
    handle = await open(planPath, "wx", 0o600);
    created = true;
    await handle.writeFile(
      `${JSON.stringify({ schemaVersion: 0, state: "preparing", pid: process.pid })}\n`,
      "utf8",
    );
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => {});
    handle = null;
    if (created) await rm(planPath, { force: true }).catch(() => {});
    if (error?.code === "EEXIST") {
      throw new Error("检测到未完成的更新，请重新打开 Luma 后再试");
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function prepareUnsignedMacUpdate({
  updateInfo,
  downloadedFile,
  currentAppPath,
  resourcesPath,
  userDataPath,
  architecture,
  oldPid = process.pid,
}) {
  if (process.platform !== "darwin") throw new Error("未签名更新安装器仅支持 macOS");
  const metadata = selectUnsignedMacUpdateFile(updateInfo);
  const archivePath = await verifyUnsignedMacUpdateArchive(downloadedFile, metadata);
  const targetAppPath = path.resolve(assertNonEmptyString(currentAppPath, "当前应用路径"));
  if (path.basename(targetAppPath) !== APP_BUNDLE_NAME) throw new Error("当前应用不是预期的 Luma.app");
  if (targetAppPath.includes("/AppTranslocation/") || targetAppPath.startsWith("/Volumes/")) {
    throw new Error("请先将 Luma 移到“应用程序”文件夹，再安装更新");
  }
  const targetStat = await lstat(targetAppPath);
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new Error("当前应用路径无效");
  const targetParent = path.dirname(targetAppPath);
  await access(targetParent, 3).catch(() => {
    throw new Error("Luma 所在目录不可写，请移动到可写的“应用程序”文件夹后重试");
  });

  const helperPath = path.join(resourcesPath, UNSIGNED_MAC_HELPER_RELATIVE_PATH);
  await access(helperPath, 1).catch(() => {
    throw new Error("当前版本缺少 macOS 更新辅助程序，请手动安装最新版本一次");
  });

  const stateDirectory = path.join(userDataPath, UNSIGNED_MAC_UPDATE_DIRECTORY);
  await ensurePrivateDirectory(stateDirectory);
  const pendingPlanPath = path.join(stateDirectory, "pending.json");
  await reservePendingPlan(pendingPlanPath);

  const token = randomUUID();
  const candidateAppPath = path.join(targetParent, `.Luma-update-${token}.app`);
  const healthMarkerPath = path.join(stateDirectory, `health-${token}.json`);
  const journalPath = path.join(stateDirectory, `journal-${token}.json`);
  const logPath = path.join(userDataPath, "logs", "unsigned-update.log");
  let stagingRoot = null;

  try {
    stagingRoot = await mkdtemp(path.join(stateDirectory, "stage-"));
    await chmod(stagingRoot, 0o700);
    const extractionDirectory = path.join(stagingRoot, "extract");
    await mkdir(extractionDirectory, { mode: 0o700 });
    await mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
    await validateArchiveEntryPaths(archivePath);
    await run("/usr/bin/ditto", ["-x", "-k", archivePath, extractionDirectory]);
    const topLevelEntries = (await readdir(extractionDirectory)).filter((name) => name !== ".DS_Store");
    if (topLevelEntries.length !== 1 || topLevelEntries[0] !== APP_BUNDLE_NAME) {
      throw new Error("更新 ZIP 必须只包含 Luma.app");
    }
    const extractedAppPath = path.join(extractionDirectory, APP_BUNDLE_NAME);
    await validateUnsignedMacAppBundle(extractedAppPath, {
      version: metadata.version,
      architecture,
    });

    await lstat(candidateAppPath)
      .then(() => {
        throw new Error("更新候选应用路径已被占用，请重试");
      })
      .catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    await run("/usr/bin/ditto", [extractedAppPath, candidateAppPath]);
    await validateUnsignedMacAppBundle(candidateAppPath, {
      version: metadata.version,
      architecture,
    });

    const [targetParentRealPath, candidateParentRealPath] = await Promise.all([
      realpath(targetParent),
      realpath(path.dirname(candidateAppPath)),
    ]);
    if (!samePath(targetParentRealPath, candidateParentRealPath)) {
      throw new Error("更新候选应用与当前应用不在同一目录");
    }

    const plan = {
      schemaVersion: 1,
      token,
      oldPid,
      currentApp: targetAppPath,
      candidateApp: candidateAppPath,
      healthMarker: healthMarkerPath,
      journalFile: journalPath,
      logFile: logPath,
      timeoutSeconds: INSTALL_TIMEOUT_SECONDS,
      expectedBundleId: BUNDLE_IDENTIFIER,
      expectedVersion: metadata.version,
    };
    await writeJsonAtomically(pendingPlanPath, plan);
    await rm(stagingRoot, { recursive: true, force: true });
    return { helperPath, planPath: pendingPlanPath, plan };
  } catch (error) {
    await rm(candidateAppPath, { recursive: true, force: true }).catch(() => {});
    if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    await rm(pendingPlanPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function launchUnsignedMacUpdate({ helperPath, planPath }) {
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const child = spawn(helperPath, ["--plan", planPath], {
    detached: true,
    stdio: "ignore",
  });
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", resolve);
    });

    const journalPath = plan.journalFile;
    let exitResult = null;
    const handleExit = (code, signal) => {
      exitResult = { code, signal };
    };
    child.once("exit", handleExit);
    const deadline = Date.now() + HELPER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (exitResult) {
        throw new Error(
          `macOS 更新辅助程序提前退出（${exitResult.signal ?? exitResult.code ?? "unknown"}）`,
        );
      }
      try {
        const journal = JSON.parse(await readFile(journalPath, "utf8"));
        if (journal.token === plan.token && journal.state === "waiting-for-parent") {
          child.removeListener("exit", handleExit);
          child.unref();
          return child.pid;
        }
      } catch (error) {
        if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    child.kill("SIGTERM");
    throw new Error("macOS 更新辅助程序未能启动");
  } catch (error) {
    child.kill("SIGTERM");
    await rm(plan.candidateApp, { recursive: true, force: true }).catch(() => {});
    await rm(plan.healthMarker, { force: true }).catch(() => {});
    await rm(plan.journalFile, { force: true }).catch(() => {});
    await rm(planPath, { force: true }).catch(() => {});
    throw error;
  }
}

function readArgument(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) return null;
  return argv[index + 1];
}

function hasUpdateLaunchArguments(argv) {
  return Boolean(
    readArgument(argv, "--luma-update-token") &&
      readArgument(argv, "--luma-update-health-marker"),
  );
}

async function readPendingPlan(userDataPath) {
  const planPath = path.join(userDataPath, UNSIGNED_MAC_UPDATE_DIRECTORY, "pending.json");
  try {
    return { planPath, plan: JSON.parse(await readFile(planPath, "utf8")) };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return { planPath, plan: null };
    throw error;
  }
}

async function unsignedMacHelperIsRunning(planPath) {
  const { stdout } = await run("/bin/ps", ["-ww", "-axo", "pid=,uid=,command="]);
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : null;
  return stdout.split("\n").some((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match || (expectedUid !== null && Number(match[2]) !== expectedUid)) return false;
    return (
      Number(match[1]) !== process.pid &&
      match[3].includes("luma-mac-update-helper") &&
      match[3].includes("--plan") &&
      match[3].includes(planPath)
    );
  });
}

export async function shouldExitForActiveUnsignedMacUpdate({
  argv = process.argv,
  userDataPath,
}) {
  if (process.platform !== "darwin" || hasUpdateLaunchArguments(argv)) return false;
  const pending = await readPendingPlan(userDataPath);
  const recoveryToken = readArgument(argv, "--luma-update-recovery-token");
  if (recoveryToken && pending?.plan?.token === recoveryToken) return false;
  return pending ? unsignedMacHelperIsRunning(pending.planPath) : false;
}

export async function recoverAbandonedUnsignedMacUpdate({
  argv = process.argv,
  userDataPath,
  currentAppPath,
  logger = console,
}) {
  if (process.platform !== "darwin" || hasUpdateLaunchArguments(argv)) return false;
  const pending = await readPendingPlan(userDataPath);
  if (!pending) return false;
  if (await unsignedMacHelperIsRunning(pending.planPath)) return false;

  const { plan, planPath } = pending;
  const currentPath = path.resolve(currentAppPath);
  const canonicalToken =
    typeof plan?.token === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      plan.token,
    );
  const expectedCandidateName = canonicalToken ? `.Luma-update-${plan.token}.app` : null;
  const candidateIsSafe = Boolean(
    plan?.schemaVersion === 1 &&
      expectedCandidateName &&
      typeof plan.currentApp === "string" &&
      samePath(plan.currentApp, currentPath) &&
      typeof plan.candidateApp === "string" &&
      path.basename(plan.candidateApp) === expectedCandidateName &&
      path.dirname(path.resolve(plan.candidateApp)) === path.dirname(currentPath) &&
      !samePath(plan.candidateApp, currentPath),
  );

  if (candidateIsSafe) {
    await rm(plan.candidateApp, { recursive: true, force: true }).catch((error) =>
      logger.warn?.("Unable to remove an abandoned update candidate", error),
    );
  }
  if (typeof plan?.healthMarker === "string") {
    const expectedStateDirectory = path.dirname(planPath);
    if (path.dirname(path.resolve(plan.healthMarker)) === expectedStateDirectory) {
      await rm(plan.healthMarker, { force: true }).catch(() => {});
    }
  }
  await rm(planPath, { force: true });
  logger.info?.("Recovered an abandoned unsigned macOS update plan");
  return true;
}

export async function acknowledgeUnsignedMacUpdateLaunch({
  argv = process.argv,
  userDataPath,
  currentVersion,
  currentAppPath,
}) {
  if (process.platform !== "darwin") return false;
  const token = readArgument(argv, "--luma-update-token");
  const requestedMarkerPath = readArgument(argv, "--luma-update-health-marker");
  if (!token || !requestedMarkerPath) return false;

  const stateDirectory = path.join(userDataPath, UNSIGNED_MAC_UPDATE_DIRECTORY);
  const planPath = path.join(stateDirectory, "pending.json");
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const expectedMarkerPath = path.join(stateDirectory, `health-${plan.token}.json`);
  if (
    plan.schemaVersion !== 1 ||
    plan.token !== token ||
    plan.expectedBundleId !== BUNDLE_IDENTIFIER ||
    plan.expectedVersion !== currentVersion ||
    !samePath(plan.currentApp, currentAppPath) ||
    !samePath(plan.healthMarker, expectedMarkerPath) ||
    !samePath(requestedMarkerPath, expectedMarkerPath)
  ) {
    throw new Error("更新健康检查参数无效");
  }

  await writeJsonAtomically(expectedMarkerPath, {
    schemaVersion: 1,
    token,
    bundleId: BUNDLE_IDENTIFIER,
    version: currentVersion,
    pid: process.pid,
    healthyAt: new Date().toISOString(),
    hostname: os.hostname(),
  });
  return true;
}
