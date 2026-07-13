import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import electronUpdater from "electron-updater";
import { getUpdaterSupport, resolveMacAppBundlePath } from "./update-support.mjs";
import {
  launchUnsignedMacUpdate,
  prepareUnsignedMacUpdate,
  selectUnsignedMacUpdateFile,
} from "./unsigned-mac-update.mjs";

const { autoUpdater } = electronUpdater;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_CHECK_DELAY_MS = 6_000;
// Grace period before quitting/installing so the UI can show the installing state.
const INSTALL_GRACE_MS = 160;
// Truncate scrubbed error messages so update failures stay readable.
const ERROR_MESSAGE_MAX_LENGTH = 180;
const MAX_LOG_SIZE_BYTES = 1024 * 1024;
const LOG_VALUE_MAX_LENGTH = 2000;

let initialized = false;
let updateReady = false;
let sawAvailableUpdate = false;
let manualCheckInFlight = false;
let checkPromise = null;
let lastProgress = -1;
let startupTimer = null;
let intervalTimer = null;
let getMainWindow = () => null;
let beforeInstall = () => {};
let updateLogger = console;
let useUnsignedMacInstaller = false;
let availableUpdateInfo = null;
let downloadedUpdateFile = null;

let updateState = {
  state: "idle",
  supported: false,
  currentVersion: app.getVersion(),
  reason: null,
  message: null,
  lastError: null,
  lastCheckedAt: null,
  signed: null,
  integrity: null,
};

function mainWindowCanReceiveUpdates() {
  const window = getMainWindow();
  return window && !window.isDestroyed() && !window.webContents.isDestroyed() ? window : null;
}

function publishState(nextState) {
  updateState = {
    ...updateState,
    ...nextState,
    currentVersion: app.getVersion(),
  };
  updateLogger.info?.("state", updateState.state, {
    version: updateState.version ?? null,
    percent: updateState.percent ?? null,
    reason: updateState.reason ?? null,
    lastError: updateState.lastError ?? null,
  });
  mainWindowCanReceiveUpdates()?.webContents.send("luma:update-state", updateState);
  return updateState;
}

function conciseError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "更新失败");
  return message
    .replace(/https?:\/\/\S+/g, "更新服务器")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ERROR_MESSAGE_MAX_LENGTH);
}

function serializeLogValue(value) {
  let serialized;
  if (value instanceof Error) serialized = value.stack || value.message;
  else if (typeof value === "string") serialized = value;
  else {
    try {
      serialized = JSON.stringify(value);
    } catch {
      serialized = String(value);
    }
  }

  try {
    return String(serialized)
      .replace(/(authorization\s*[:=]\s*)([^\s,}]+)/gi, "$1[redacted]")
      .replace(/(bearer\s+)[a-z0-9._~-]+/gi, "$1[redacted]")
      .replace(/([?&](?:token|access_token|password)=)[^&\s]+/gi, "$1[redacted]")
      .slice(0, LOG_VALUE_MAX_LENGTH);
  } catch {
    return "[unserializable]";
  }
}

function createPersistentLogger() {
  const logDirectory = path.join(app.getPath("userData"), "logs");
  const logPath = path.join(logDirectory, "auto-update.log");
  try {
    fs.mkdirSync(logDirectory, { recursive: true });
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > MAX_LOG_SIZE_BYTES) {
      fs.rmSync(`${logPath}.1`, { force: true });
      fs.renameSync(logPath, `${logPath}.1`);
    }
  } catch (error) {
    console.warn("Unable to prepare the auto-update log", error);
  }

  const write = (level, values) => {
    const line = `${new Date().toISOString()} [${level}] ${values
      .map(serializeLogValue)
      .join(" ")}\n`;
    try {
      fs.appendFileSync(logPath, line, "utf8");
    } catch {
      // Console output remains available if the user-data directory is read-only.
    }
    const consoleMethod =
      level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    consoleMethod(...values);
  };

  return {
    debug: (...values) => write("debug", values),
    info: (...values) => write("info", values),
    warn: (...values) => write("warn", values),
    error: (...values) => write("error", values),
  };
}

async function checkForUpdates({ manual = false } = {}) {
  if (!updateState.supported || updateReady) return { ...updateState };
  if (checkPromise) return checkPromise;

  manualCheckInFlight = manual;
  publishState({
    state: "checking",
    message: "正在检查更新…",
    lastError: null,
    lastCheckedAt: new Date().toISOString(),
  });
  checkPromise = (async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      const lastError = conciseError(error) || "更新检查失败";
      publishState({
        state: manual || sawAvailableUpdate ? "error" : "idle",
        message: manual || sawAvailableUpdate ? lastError : null,
        lastError,
      });
    } finally {
      manualCheckInFlight = false;
      checkPromise = null;
    }
    return { ...updateState };
  })();
  return checkPromise;
}

export function initializeAutoUpdates(options = {}) {
  if (initialized) return updateState;
  initialized = true;
  getMainWindow =
    typeof options.getMainWindow === "function" ? options.getMainWindow : getMainWindow;
  beforeInstall =
    typeof options.beforeInstall === "function" ? options.beforeInstall : beforeInstall;
  updateLogger = createPersistentLogger();
  autoUpdater.logger = updateLogger;

  const support = getUpdaterSupport({
    isPackaged: app.isPackaged,
    platform: process.platform,
    execPath: process.execPath,
  });
  publishState({
    state: support.supported ? "idle" : "unsupported",
    supported: support.supported,
    reason: support.reason,
    signed: support.signed,
    integrity: support.integrity,
    message: null,
    lastError: null,
    version: null,
    percent: null,
  });
  if (!support.supported) return updateState;
  if (process.platform === "darwin" && !support.signed) {
    useUnsignedMacInstaller = true;
    updateLogger.warn(
      "macOS package has no valid Developer ID Application signature; using the self-distribution installer without publisher identity verification",
    );
  }

  autoUpdater.allowPrerelease = false;
  autoUpdater.autoDownload = false;
  // Squirrel.Mac rejects ad-hoc builds because every version has a different
  // designated requirement. The unsigned path must never let Squirrel start.
  autoUpdater.autoInstallOnAppQuit = !useUnsignedMacInstaller;
  autoUpdater.autoRunAppAfterInstall = true;

  autoUpdater.on("checking-for-update", () => {
    publishState({ state: "checking", message: "正在检查更新…", lastError: null });
  });

  autoUpdater.on("update-available", (info) => {
    sawAvailableUpdate = true;
    lastProgress = -1;
    availableUpdateInfo = info ?? null;
    downloadedUpdateFile = null;
    publishState({
      state: "available",
      version: info?.version ?? null,
      message: `发现 Luma v${info?.version ?? "新版本"}`,
      lastError: null,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0)));
    if (percent === lastProgress) return;
    lastProgress = percent;
    publishState({
      state: "downloading",
      percent,
      message: `正在下载 Luma v${updateState.version ?? "新版本"} · ${percent}%`,
      lastError: null,
    });
  });

  autoUpdater.on("update-not-available", () => {
    sawAvailableUpdate = false;
    availableUpdateInfo = null;
    downloadedUpdateFile = null;
    publishState({
      state: "idle",
      version: null,
      percent: null,
      message: null,
      lastError: null,
      lastCheckedAt: new Date().toISOString(),
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    if (useUnsignedMacInstaller) {
      try {
        selectUnsignedMacUpdateFile(info);
        if (typeof info?.downloadedFile !== "string" || !info.downloadedFile.trim()) {
          throw new Error("更新下载完成，但没有找到本地 ZIP");
        }
        availableUpdateInfo = info;
        downloadedUpdateFile = info.downloadedFile;
      } catch (error) {
        updateReady = false;
        const lastError = conciseError(error) || "更新清单无效";
        publishState({ state: "error", message: lastError, lastError });
        return;
      }
    }
    updateReady = true;
    publishState({
      state: "ready",
      version: info?.version ?? updateState.version ?? null,
      percent: 100,
      message: `Luma v${info?.version ?? updateState.version ?? "新版本"} 已准备好`,
      lastError: null,
    });
  });

  autoUpdater.on("error", (error) => {
    const lastError = conciseError(error) || "更新失败";
    if (sawAvailableUpdate || manualCheckInFlight) {
      publishState({ state: "error", message: lastError, lastError });
    } else {
      publishState({ state: "idle", message: null, lastError });
    }
  });

  startupTimer = setTimeout(() => {
    checkForUpdates();
  }, STARTUP_CHECK_DELAY_MS);
  startupTimer.unref?.();

  intervalTimer = setInterval(() => {
    checkForUpdates();
  }, CHECK_INTERVAL_MS);
  intervalTimer.unref?.();

  return updateState;
}

export function getAutoUpdateState() {
  return { ...updateState };
}

export function checkForUpdatesManually() {
  return checkForUpdates({ manual: true });
}

export async function installDownloadedUpdate() {
  if (!updateState.supported || !updateReady) {
    return { ok: false, message: "更新尚未下载完成" };
  }
  // Consume the ready state synchronously so two IPC calls cannot prepare or
  // launch competing installers against the same application bundle.
  updateReady = false;

  if (useUnsignedMacInstaller) {
    publishState({
      state: "installing",
      message: "正在校验并准备更新…",
      lastError: null,
    });
    try {
      const preparedUpdate = await prepareUnsignedMacUpdate({
        updateInfo: availableUpdateInfo,
        downloadedFile: downloadedUpdateFile,
        currentAppPath: resolveMacAppBundlePath(process.execPath),
        resourcesPath: process.resourcesPath,
        userDataPath: app.getPath("userData"),
        architecture: process.arch,
      });
      await launchUnsignedMacUpdate(preparedUpdate);
      publishState({
        state: "installing",
        message: "正在关闭旧版本并安装更新…",
        lastError: null,
      });
      beforeInstall();
      setTimeout(() => app.quit(), INSTALL_GRACE_MS);
      return { ok: true };
    } catch (error) {
      const lastError = conciseError(error) || "无法启动 macOS 更新安装程序";
      publishState({ state: "error", message: lastError, lastError });
      return { ok: false, message: lastError };
    }
  }

  publishState({
    state: "installing",
    message: "正在关闭旧版本并安装更新…",
    lastError: null,
  });
  beforeInstall();

  setTimeout(() => {
    try {
      if (process.platform === "win32") autoUpdater.quitAndInstall(true, true);
      else autoUpdater.quitAndInstall();
    } catch (error) {
      const lastError = conciseError(error) || "无法启动更新安装程序";
      publishState({ state: "error", message: lastError, lastError });
    }
  }, INSTALL_GRACE_MS);

  return { ok: true };
}

export async function downloadAndInstallUpdate() {
  if (!updateState.supported) {
    return { ok: false, message: "当前版本暂不支持自动更新" };
  }
  if (updateState.state === "downloading" || updateState.state === "installing") {
    return { ok: false, message: "更新正在进行中" };
  }

  try {
    if (!updateReady) {
      publishState({
        state: "downloading",
        percent: 0,
        message: `正在下载 Luma v${updateState.version ?? "新版本"}…`,
        lastError: null,
      });
      await autoUpdater.downloadUpdate();
    }
    return installDownloadedUpdate();
  } catch (error) {
    const lastError = conciseError(error) || "更新下载失败";
    updateReady = false;
    publishState({ state: "error", message: lastError, lastError });
    return { ok: false, message: lastError };
  }
}

export function stopAutoUpdates() {
  if (startupTimer) clearTimeout(startupTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  startupTimer = null;
  intervalTimer = null;
}
