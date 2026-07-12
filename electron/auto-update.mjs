import path from "node:path";
import { spawnSync } from "node:child_process";
import { app } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_CHECK_DELAY_MS = 6_000;

let initialized = false;
let updateReady = false;
let sawAvailableUpdate = false;
let lastProgress = -1;
let startupTimer = null;
let intervalTimer = null;
let getMainWindow = () => null;
let beforeInstall = () => {};

let updateState = {
  state: "idle",
  supported: false,
  currentVersion: app.getVersion(),
};

function mainWindowCanReceiveUpdates() {
  const window = getMainWindow();
  return window && !window.isDestroyed() && !window.webContents.isDestroyed()
    ? window
    : null;
}

function publishState(nextState) {
  updateState = {
    ...updateState,
    ...nextState,
    currentVersion: app.getVersion(),
  };
  mainWindowCanReceiveUpdates()?.webContents.send("luma:update-state", updateState);
  return updateState;
}

function conciseError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "更新失败");
  return message
    .replace(/https?:\/\/\S+/g, "更新服务器")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function hasDeveloperIdSignature() {
  if (process.platform !== "darwin") return true;

  const appBundlePath = path.resolve(path.dirname(process.execPath), "../..");
  const result = spawnSync(
    "/usr/bin/codesign",
    ["-dv", "--verbose=4", appBundlePath],
    { encoding: "utf8" },
  );
  const details = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const teamIdentifier = details.match(/TeamIdentifier=([^\s]+)/)?.[1];
  return Boolean(teamIdentifier && teamIdentifier !== "not" && teamIdentifier !== "not-set");
}

function updaterSupport() {
  if (!app.isPackaged) return { supported: false, reason: "development" };
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return { supported: false, reason: "platform" };
  }
  if (process.platform === "darwin" && !hasDeveloperIdSignature()) {
    return { supported: false, reason: "mac-signature-required" };
  }
  return { supported: true, reason: null };
}

async function checkForUpdates() {
  if (!updateState.supported || updateReady) return updateState;

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    if (sawAvailableUpdate) {
      publishState({ state: "error", message: conciseError(error) || "更新下载失败" });
    } else {
      publishState({ state: "idle", lastError: conciseError(error) });
    }
  }
  return updateState;
}

export function initializeAutoUpdates(options = {}) {
  if (initialized) return updateState;
  initialized = true;
  getMainWindow = typeof options.getMainWindow === "function"
    ? options.getMainWindow
    : getMainWindow;
  beforeInstall = typeof options.beforeInstall === "function"
    ? options.beforeInstall
    : beforeInstall;

  const support = updaterSupport();
  publishState({
    state: support.supported ? "idle" : "unsupported",
    supported: support.supported,
    reason: support.reason,
  });
  if (!support.supported) return updateState;

  autoUpdater.allowPrerelease = false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.logger = console;

  autoUpdater.on("checking-for-update", () => {
    publishState({ state: "checking", message: "正在检查更新…" });
  });

  autoUpdater.on("update-available", (info) => {
    sawAvailableUpdate = true;
    lastProgress = -1;
    publishState({
      state: "available",
      version: info?.version ?? null,
      message: `发现 Luma v${info?.version ?? "新版本"}，正在下载…`,
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
    });
  });

  autoUpdater.on("update-not-available", () => {
    sawAvailableUpdate = false;
    publishState({ state: "idle", version: null, percent: null, message: null });
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateReady = true;
    publishState({
      state: "ready",
      version: info?.version ?? updateState.version ?? null,
      percent: 100,
      message: `Luma v${info?.version ?? updateState.version ?? "新版本"} 已准备好`,
    });
  });

  autoUpdater.on("error", (error) => {
    if (sawAvailableUpdate) {
      publishState({ state: "error", message: conciseError(error) || "更新下载失败" });
    } else {
      publishState({ state: "idle", lastError: conciseError(error) });
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

export async function installDownloadedUpdate() {
  if (!updateState.supported || !updateReady) {
    return { ok: false, message: "更新尚未下载完成" };
  }

  publishState({ state: "installing", message: "正在关闭旧版本并安装更新…" });
  beforeInstall();

  setTimeout(() => {
    if (process.platform === "win32") autoUpdater.quitAndInstall(true, true);
    else autoUpdater.quitAndInstall();
  }, 160);

  return { ok: true };
}

export function stopAutoUpdates() {
  if (startupTimer) clearTimeout(startupTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  startupTimer = null;
  intervalTimer = null;
}
