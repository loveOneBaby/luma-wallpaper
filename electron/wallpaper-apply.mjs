import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserWindow, screen } from "electron";
import { attachWindowToWorkerW } from "./windows-workerw.mjs";
import { shouldResumeWallpaperPlayback } from "./wallpaper-lifecycle.mjs";
import { state, consts, __dirname } from "./app-state.mjs";
import {
  wait,
  comparablePath,
  sameFilePath,
  flushDeferredMediaTokenReleases,
  mediaKind,
  mediaDescriptor,
  findDemoMedia,
  settlePlayback,
  waitForPlayback,
  loadWallpaperModule,
} from "./media-tokens.mjs";
import { safeText } from "./library-state.mjs";
import { hardenWindowNavigation } from "./windows.mjs";

export function resolveMediaRequest(request) {
  if (!request || typeof request !== "object") {
    throw new Error("缺少壁纸文件");
  }

  let filePath = null;
  let isDemo = false;
  if (typeof request.path === "string" && request.path.trim()) {
    const requestedPath = request.path.trim();
    filePath = requestedPath.startsWith("file:")
      ? fileURLToPath(requestedPath)
      : path.resolve(requestedPath);
  } else if (request.demoKey) {
    filePath = findDemoMedia(request.demoKey);
    isDemo = true;
  }

  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error("壁纸文件不存在");
  }

  filePath = fs.realpathSync.native(filePath);
  const kind = mediaKind(filePath);
  if (!kind) throw new Error("仅支持图片或视频文件");
  const identity = comparablePath(filePath);
  if (!isDemo && !state.authorizedMediaIdentities.has(identity)) {
    throw new Error("该文件尚未通过 Luma 的选择或拖放授权");
  }
  return { ...mediaDescriptor(filePath), kind, demoKey: request.demoKey ?? null };
}

export function clearPlaybackTracking(token, result = null) {
  if (!token) return;
  settlePlayback(token, result ?? { status: "error", message: "动态壁纸播放请求已取消" });
  state.playbackWaiters.delete(token);
  state.confirmedPlaybackTokens.delete(token);
  state.reportedPlaybackErrors.delete(token);
}

export function destroyWallpaperWindow({ flushDeferred = true } = {}) {
  const windowToDestroy = state.wallpaperWindow;
  const playbackToken = state.wallpaperMedia?.playbackToken;
  state.wallpaperWindow = null;
  state.wallpaperMedia = null;
  clearPlaybackTracking(playbackToken, {
    status: "error",
    message: "动态壁纸窗口已关闭",
  });
  if (windowToDestroy && !windowToDestroy.isDestroyed()) windowToDestroy.destroy();
  if (flushDeferred) flushDeferredMediaTokenReleases();
}

export function notifyWallpaperError(message, code = "PLAYBACK_FAILED") {
  if (!state.mainWindow || state.mainWindow.isDestroyed() || state.mainWindow.webContents.isDestroyed()) return;
  state.mainWindow.webContents.send("luma:wallpaper-error", {
    code,
    message: safeText(message, "动态壁纸播放已中断", 240),
  });
}

export function publishWallpaperRuntime(runtimeState) {
  if (!state.mainWindow || state.mainWindow.isDestroyed() || state.mainWindow.webContents.isDestroyed()) return;
  state.mainWindow.webContents.send("luma:wallpaper:runtime", runtimeState);
}

export function runtimeStateFor(media, status) {
  if (!media) {
    return { status, kind: null, matchKey: null, name: null, appliedAt: null };
  }
  return {
    status,
    kind: media.kind ?? null,
    matchKey: media.demoKey ? `demo:${media.demoKey}` : (media.path ?? null),
    name: media.name ?? null,
    appliedAt: new Date().toISOString(),
  };
}

export function sendWallpaperPlaybackControl(action, reason) {
  if (
    !state.wallpaperWindow ||
    state.wallpaperWindow.isDestroyed() ||
    state.wallpaperWindow.webContents.isDestroyed()
  ) {
    return;
  }
  state.wallpaperWindow.webContents.send("luma:wallpaper:playback-control", { action, reason });
}

export async function refreshWallpaperPlacement(reason = "display-change") {
  if (!state.wallpaperWindow || state.wallpaperWindow.isDestroyed() || state.wallpaperMedia?.kind !== "video") return;
  try {
    const bounds = screen.getPrimaryDisplay().bounds;
    if (!state.wallpaperWindow || state.wallpaperWindow.isDestroyed()) return;
    state.wallpaperWindow.setBounds(bounds, false);
    if (process.platform === "win32") {
      await attachWindowToWorkerW(state.wallpaperWindow, bounds);
    } else {
      state.wallpaperWindow.showInactive();
    }
  } catch (error) {
    console.error(`Unable to restore wallpaper placement after ${reason}`, error);
    if (!state.isQuitting) notifyWallpaperError(dependencyMessage(error), "DESKTOP_LAYER_FAILED");
  }
}

export function scheduleWallpaperPlacementRefresh(reason, delay = consts.DISPLAY_REFRESH_DELAY_MS) {
  if (state.displayRefreshTimer) clearTimeout(state.displayRefreshTimer);
  state.displayRefreshTimer = setTimeout(() => {
    state.displayRefreshTimer = null;
    if (state.wallpaperPowerState.suspended) return;
    refreshWallpaperPlacement(reason)
      .then(() => {
        if (shouldResumeWallpaperPlayback(state.wallpaperPowerState)) {
          sendWallpaperPlaybackControl("resume", reason);
        }
      })
      .catch((error) => console.error(error));
  }, delay);
  state.displayRefreshTimer.unref?.();
}

export async function setImageWallpaper(media) {
  // wallpaper is ESM; keep it lazy so Electron can still start without loading
  // platform-specific native helpers until an image is actually selected.
  const wallpaperModule = await loadWallpaperModule();
  const setWallpaper = wallpaperModule.setWallpaper ?? wallpaperModule.default?.setWallpaper;
  if (typeof setWallpaper !== "function") {
    throw new Error("wallpaper 模块没有提供 setWallpaper() API");
  }

  await setWallpaper(media.path);
  // Keep an existing video wallpaper alive until the native image API has
  // actually succeeded. A permission/API failure should not tear down the
  // user's last working desktop background.
  destroyWallpaperWindow();

  const getWallpaper = wallpaperModule.getWallpaper ?? wallpaperModule.default?.getWallpaper;
  const getScreens = wallpaperModule.screens ?? wallpaperModule.default?.screens;
  if (typeof getWallpaper !== "function") {
    return { verified: null, verification: "unverified", code: "VERIFY_UNAVAILABLE" };
  }

  const readVerification = async () => {
    const current =
      process.platform === "darwin" ? await getWallpaper({ screen: "all" }) : await getWallpaper();
    const currentPaths = (Array.isArray(current) ? current : [current]).filter(
      (currentPath) => typeof currentPath === "string" && currentPath.trim(),
    );

    if (!currentPaths.length) return { status: "unverified" };
    if (
      currentPaths.some((currentPath) => {
        try {
          return fs.statSync(currentPath).isDirectory();
        } catch {
          return false;
        }
      })
    ) {
      return { status: "unverified" };
    }

    if (process.platform === "darwin" && typeof getScreens === "function") {
      const screens = await getScreens();
      if (Array.isArray(screens) && screens.length !== currentPaths.length) {
        return { status: "partial" };
      }
    }

    return {
      status: currentPaths.every((currentPath) => sameFilePath(currentPath, media.path))
        ? "match"
        : "mismatch",
    };
  };

  try {
    let firstMatch = false;
    let sawMismatch = false;
    for (const delay of consts.VERIFICATION_DELAYS_MS) {
      await wait(delay);
      const check = await readVerification();
      if (check.status === "match") {
        firstMatch = true;
        break;
      }
      if (check.status === "mismatch") sawMismatch = true;
      if (check.status === "partial") {
        return { verified: null, verification: "unverified", code: "VERIFY_PARTIAL" };
      }
    }

    if (!firstMatch) {
      return sawMismatch
        ? { verified: false, verification: "conflict", code: "VERIFY_MISMATCH" }
        : { verified: null, verification: "unverified", code: "VERIFY_UNAVAILABLE" };
    }

    // A second check catches wallpaper utilities that immediately reclaim the desktop.
    await wait(consts.VERIFICATION_STABILITY_DELAY_MS);
    const stableCheck = await readVerification();
    if (stableCheck.status === "match") {
      return { verified: true, verification: "verified", code: "OK" };
    }
    if (stableCheck.status === "mismatch") {
      return { verified: false, verification: "conflict", code: "WALLPAPER_OVERRIDDEN" };
    }
    return { verified: null, verification: "unverified", code: "VERIFY_UNAVAILABLE" };
  } catch (error) {
    console.warn("Wallpaper verification was unavailable", error);
    return { verified: null, verification: "unverified", code: "VERIFY_UNAVAILABLE" };
  }
}

export function createWallpaperWindow(bounds) {
  const nextWindow = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: "#000000",
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    enableLargerThanScreen: true,
    ...(process.platform === "darwin" ? { type: "desktop" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "wallpaper-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  state.wallpaperWindow = nextWindow;
  hardenWindowNavigation(nextWindow, pathToFileURL(path.join(__dirname, "wallpaper.html")).href);
  nextWindow.setIgnoreMouseEvents(true, { forward: true });
  nextWindow.setMenuBarVisibility(false);

  if (process.platform === "darwin") {
    nextWindow.setHasShadow(false);
    nextWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  }

  nextWindow.on("closed", () => {
    if (state.wallpaperWindow === nextWindow) {
      const closedToken = state.wallpaperMedia?.playbackToken;
      const wasPlaying = state.confirmedPlaybackTokens.has(closedToken);
      state.wallpaperWindow = null;
      state.wallpaperMedia = null;
      if (closedToken) {
        settlePlayback(closedToken, {
          status: "error",
          message: "动态壁纸窗口意外关闭",
        });
        if (!state.isQuitting && wasPlaying && !state.reportedPlaybackErrors.has(closedToken)) {
          state.reportedPlaybackErrors.add(closedToken);
          notifyWallpaperError("动态壁纸窗口意外关闭", "WALLPAPER_WINDOW_CLOSED");
        }
        clearPlaybackTracking(closedToken);
      }
      if (!state.wallpaperTransitionInProgress) flushDeferredMediaTokenReleases();
    }
  });

  return nextWindow;
}

export async function activateVideoWallpaper(media, playbackToken) {
  const playbackResultPromise = waitForPlayback(playbackToken);
  const nextMedia = { ...media, playbackToken };
  const bounds = screen.getPrimaryDisplay().bounds;
  let nextWindow = state.wallpaperWindow;
  let createdWindow = false;

  if (!nextWindow || nextWindow.isDestroyed()) {
    nextWindow = createWallpaperWindow(bounds);
    createdWindow = true;
  }
  state.wallpaperWindow = nextWindow;
  state.wallpaperMedia = nextMedia;

  try {
    if (createdWindow) {
      await nextWindow.loadFile(path.join(__dirname, "wallpaper.html"));
    } else {
      nextWindow.webContents.send("luma:wallpaper:media-changed", nextMedia);
    }
    if (nextWindow.isDestroyed()) throw new Error("动态壁纸窗口已关闭");

    if (process.platform === "win32") {
      await attachWindowToWorkerW(nextWindow, bounds);
    } else {
      nextWindow.showInactive();
    }
    const playbackResult = await playbackResultPromise;
    if (playbackResult.status !== "playing") {
      throw new Error(
        playbackResult.message ||
          (playbackResult.status === "timeout" ? "动态壁纸播放确认超时" : "动态壁纸无法播放"),
      );
    }
    if (state.wallpaperPowerState.suspended) {
      sendWallpaperPlaybackControl("pause", "system-suspended");
    }
    return { verified: true, verification: "playing", code: "OK" };
  } catch (error) {
    clearPlaybackTracking(playbackToken);
    throw error;
  }
}

export async function setVideoWallpaper(media, { force = false } = {}) {
  state.wallpaperTransitionInProgress = true;
  try {
    const previousPlaybackToken = state.wallpaperMedia?.playbackToken;
    const previousMedia =
      previousPlaybackToken && state.confirmedPlaybackTokens.has(previousPlaybackToken)
        ? { ...state.wallpaperMedia }
        : null;

    if (previousPlaybackToken) {
      settlePlayback(previousPlaybackToken, {
        status: "error",
        message: "动态壁纸已切换",
      });
    }
    if (force) destroyWallpaperWindow({ flushDeferred: false });

    const playbackToken = crypto.randomUUID();
    try {
      const result = await activateVideoWallpaper(media, playbackToken);
      clearPlaybackTracking(previousPlaybackToken);
      return result;
    } catch (error) {
      clearPlaybackTracking(playbackToken);

      if (previousMedia) {
        const rollbackToken = crypto.randomUUID();
        try {
          await activateVideoWallpaper(previousMedia, rollbackToken);
          clearPlaybackTracking(previousPlaybackToken);
        } catch (rollbackError) {
          console.error("Unable to restore the previous video wallpaper", rollbackError);
          clearPlaybackTracking(rollbackToken);
          destroyWallpaperWindow({ flushDeferred: false });
        }
      } else {
        destroyWallpaperWindow({ flushDeferred: false });
      }

      throw error;
    }
  } finally {
    state.wallpaperTransitionInProgress = false;
    flushDeferredMediaTokenReleases();
  }
}

export function dependencyMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Cannot find package 'wallpaper'")) {
    return "桌面运行时缺少 wallpaper 依赖";
  }
  if (message.includes("Cannot find package 'koffi'")) {
    return "Windows 动态壁纸运行时缺少 koffi 依赖";
  }
  return message;
}

