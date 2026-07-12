import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen } from "electron";
import {
  getAutoUpdateState,
  initializeAutoUpdates,
  installDownloadedUpdate,
  stopAutoUpdates,
} from "./auto-update.mjs";
import { attachWindowToWorkerW } from "./windows-workerw.mjs";
import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  kindFromExtension,
} from "../shared/mediaExtensions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

// Wallpaper verification polling. Tried in order; once a match is seen, the
// stability delay re-checks to catch wallpaper utilities that immediately
// reclaim the desktop.
const VERIFICATION_DELAYS_MS = [120, 350, 700];
const VERIFICATION_STABILITY_DELAY_MS = 1200;
const PLAYBACK_TIMEOUT_MS = 4000;
const MAX_DROPPED_PATHS = 100;
const MAIN_WINDOW_BOUNDS = {
  width: 1280,
  height: 820,
  minWidth: 900,
  minHeight: 620,
};
const DEMO_FILES_BY_KEY = new Map([
  ["ocean-morning-video", "ocean-morning.mp4"],
  ["ocean-morning-image", "ocean-morning.png"],
]);
const mediaFilesByToken = new Map();
const mediaTokensByPath = new Map();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "luma-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

let mainWindow = null;
let wallpaperWindow = null;
let wallpaperMedia = null;
let wallpaperModulePromise = null;
const playbackWaiters = new Map();

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function comparablePath(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) return "";

  let normalized = path.resolve(filePath.trim());
  try {
    normalized = fs.realpathSync.native(normalized);
  } catch {
    // The operating system can briefly report a path before it is resolvable.
  }

  normalized = path.normalize(normalized);
  if (process.platform !== "win32") return normalized;

  return normalized
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/i, "")
    .toLowerCase();
}

function sameFilePath(leftPath, rightPath) {
  try {
    const leftStat = fs.statSync(leftPath);
    const rightStat = fs.statSync(rightPath);
    if (!leftStat.isFile() || !rightStat.isFile()) return false;
    if (leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino) return true;
  } catch {
    // Fall through to a normalized path comparison.
  }

  return comparablePath(leftPath) === comparablePath(rightPath);
}

function waitForPlayback(token, timeout = PLAYBACK_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      playbackWaiters.delete(token);
      resolve({ status: "timeout" });
    }, timeout);

    playbackWaiters.set(token, {
      resolve: (result) => {
        clearTimeout(timer);
        playbackWaiters.delete(token);
        resolve(result);
      },
    });
  });
}

function settlePlayback(token, result) {
  playbackWaiters.get(token)?.resolve(result);
}

async function loadWallpaperModule() {
  wallpaperModulePromise ??= import("wallpaper");
  return wallpaperModulePromise;
}

function mediaKind(filePath) {
  return kindFromExtension(filePath);
}

function mediaUrl(filePath) {
  let token = mediaTokensByPath.get(filePath);
  if (!token) {
    token = crypto.randomUUID();
    mediaTokensByPath.set(filePath, token);
    mediaFilesByToken.set(token, filePath);
  }

  return `luma-media://local/${token}/${encodeURIComponent(path.basename(filePath))}`;
}

function mediaDescriptor(filePath) {
  return {
    path: filePath,
    identity: comparablePath(filePath),
    url: mediaUrl(filePath),
    name: path.basename(filePath),
    kind: mediaKind(filePath),
  };
}

function isMainWindowSender(event) {
  return Boolean(
    mainWindow && !mainWindow.isDestroyed() && event?.sender?.id === mainWindow.webContents.id,
  );
}

function registerMediaProtocol() {
  protocol.handle("luma-media", (request) => {
    const requestUrl = new URL(request.url);
    const [, token] = requestUrl.pathname.split("/");
    const filePath = mediaFilesByToken.get(token);

    if (!filePath || !fs.existsSync(filePath)) {
      return new Response("Media not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).href, { headers: request.headers });
  });
}

function findDemoMedia(demoKey) {
  const fileName = DEMO_FILES_BY_KEY.get(String(demoKey ?? ""));
  if (!fileName) return null;

  // Two supported flows: a packaged app resolves demo media from the
  // extraResources "demo-assets" directory (process.resourcesPath); the dev
  // workflow resolves it from the source tree. The earlier dist/assets +
  // hashed-filename fallbacks were dead in both supported flows and have been
  // removed — running `electron` against a built dist without electron-builder
  // packaging is not a supported configuration.
  const directCandidates = [
    path.join(process.resourcesPath, "demo-assets", fileName),
    path.join(appRoot, "src", "assets", fileName),
  ];
  return directCandidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function resolveMediaRequest(request) {
  if (!request || typeof request !== "object") {
    throw new Error("缺少壁纸文件");
  }

  let filePath = null;
  if (typeof request.path === "string" && request.path.trim()) {
    const requestedPath = request.path.trim();
    filePath = requestedPath.startsWith("file:")
      ? fileURLToPath(requestedPath)
      : path.resolve(requestedPath);
  } else if (request.demoKey) {
    filePath = findDemoMedia(request.demoKey);
  }

  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error("壁纸文件不存在");
  }

  const kind = mediaKind(filePath);
  if (!kind) throw new Error("仅支持图片或视频文件");
  return { ...mediaDescriptor(filePath), kind };
}

function destroyWallpaperWindow() {
  const windowToDestroy = wallpaperWindow;
  wallpaperWindow = null;
  wallpaperMedia = null;
  if (windowToDestroy && !windowToDestroy.isDestroyed()) windowToDestroy.destroy();
}

async function setImageWallpaper(media) {
  destroyWallpaperWindow();

  // wallpaper is ESM; keep it lazy so Electron can still start without loading
  // platform-specific native helpers until an image is actually selected.
  const wallpaperModule = await loadWallpaperModule();
  const setWallpaper = wallpaperModule.setWallpaper ?? wallpaperModule.default?.setWallpaper;
  if (typeof setWallpaper !== "function") {
    throw new Error("wallpaper 模块没有提供 setWallpaper() API");
  }

  await setWallpaper(media.path);

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
    for (const delay of VERIFICATION_DELAYS_MS) {
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
    await wait(VERIFICATION_STABILITY_DELAY_MS);
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

async function setVideoWallpaper(media, { force = false } = {}) {
  if (force) destroyWallpaperWindow();
  const playbackToken = crypto.randomUUID();
  wallpaperMedia = { ...media, playbackToken };
  const playbackResultPromise = waitForPlayback(playbackToken);

  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    const bounds = screen.getPrimaryDisplay().bounds;
    wallpaperWindow.webContents.send("luma:wallpaper:media-changed", wallpaperMedia);
    if (process.platform === "win32") {
      await attachWindowToWorkerW(wallpaperWindow, bounds);
    } else {
      wallpaperWindow.showInactive();
    }
    const playbackResult = await playbackResultPromise;
    if (playbackResult.status === "error") {
      throw new Error(playbackResult.message || "动态壁纸无法播放");
    }
    return playbackResult.status === "playing"
      ? { verified: true, verification: "playing", code: "OK" }
      : { verified: null, verification: "unverified", code: "VERIFY_UNAVAILABLE" };
  }

  const bounds = screen.getPrimaryDisplay().bounds;
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
      preload: path.join(__dirname, "wallpaper-preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Electron ESM preloads require an unsandboxed preload context. The
      // loaded page still has no Node integration and remains isolated.
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  wallpaperWindow = nextWindow;
  nextWindow.setIgnoreMouseEvents(true, { forward: true });
  nextWindow.setMenuBarVisibility(false);

  if (process.platform === "darwin") {
    nextWindow.setHasShadow(false);
    nextWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  }

  nextWindow.on("closed", () => {
    if (wallpaperWindow === nextWindow) {
      wallpaperWindow = null;
      wallpaperMedia = null;
    }
  });

  try {
    await nextWindow.loadFile(path.join(__dirname, "wallpaper.html"));
    if (nextWindow.isDestroyed()) throw new Error("动态壁纸窗口已关闭");

    if (process.platform === "win32") {
      await attachWindowToWorkerW(nextWindow, bounds);
    } else {
      nextWindow.showInactive();
    }
    const playbackResult = await playbackResultPromise;
    if (playbackResult.status === "error") {
      throw new Error(playbackResult.message || "动态壁纸无法播放");
    }
    return playbackResult.status === "playing"
      ? { verified: true, verification: "playing", code: "OK" }
      : { verified: null, verification: "unverified", code: "VERIFY_UNAVAILABLE" };
  } catch (error) {
    if (!nextWindow.isDestroyed()) nextWindow.destroy();
    throw error;
  }
}

function dependencyMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Cannot find package 'wallpaper'")) {
    return "桌面运行时缺少 wallpaper 依赖";
  }
  if (message.includes("Cannot find package 'koffi'")) {
    return "Windows 动态壁纸运行时缺少 koffi 依赖";
  }
  return message;
}

function registerIpc() {
  ipcMain.on("luma:wallpaper:playback-state", (event, payload) => {
    if (!wallpaperWindow || event.sender.id !== wallpaperWindow.webContents.id) return;
    if (!payload || payload.token !== wallpaperMedia?.playbackToken) return;
    if (payload.status !== "playing" && payload.status !== "error") return;

    settlePlayback(payload.token, {
      status: payload.status,
      message: typeof payload.message === "string" ? payload.message : undefined,
    });
  });

  ipcMain.handle("luma:pick-media", async () => {
    const options = {
      title: "选择图片或视频",
      buttonLabel: "添加到媒体库",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "图片与视频",
          extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS],
        },
        { name: "图片", extensions: [...IMAGE_EXTENSIONS] },
        { name: "视频", extensions: [...VIDEO_EXTENSIONS] },
      ],
    };

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return {
      canceled: result.canceled,
      files: result.canceled
        ? []
        : result.filePaths
            .filter((filePath) => mediaKind(filePath))
            .map((filePath) => mediaDescriptor(filePath)),
    };
  });

  ipcMain.handle("luma:resolve-dropped-media", (event, payload) => {
    if (!isMainWindowSender(event)) {
      throw new Error("不允许从当前窗口导入文件");
    }

    const requestedPaths = Array.isArray(payload?.paths)
      ? payload.paths.filter((filePath) => typeof filePath === "string" && filePath.trim())
      : [];
    const total = Number.isFinite(payload?.total)
      ? Math.max(0, Math.floor(payload.total))
      : requestedPaths.length;
    const limitedPaths = requestedPaths.slice(0, MAX_DROPPED_PATHS);
    const seen = new Set();
    const files = [];
    let duplicateCount = 0;
    let rejectedCount =
      Math.max(0, total - requestedPaths.length) +
      Math.max(0, requestedPaths.length - limitedPaths.length);

    for (const requestedPath of limitedPaths) {
      try {
        const filePath = fs.realpathSync.native(requestedPath);
        const identity = comparablePath(filePath);
        if (!identity || seen.has(identity)) {
          duplicateCount += 1;
          continue;
        }
        if (!fs.statSync(filePath).isFile() || !mediaKind(filePath)) {
          rejectedCount += 1;
          continue;
        }
        seen.add(identity);
        files.push(mediaDescriptor(filePath));
      } catch {
        rejectedCount += 1;
      }
    }

    return { files, duplicateCount, rejectedCount };
  });

  ipcMain.handle("luma:set-wallpaper", async (_event, request) => {
    if (process.platform !== "darwin" && process.platform !== "win32") {
      return {
        ok: false,
        platform: process.platform,
        message: "当前桌面端仅支持 macOS 和 Windows",
      };
    }

    try {
      const media = resolveMediaRequest(request);
      const result =
        media.kind === "video"
          ? await setVideoWallpaper(media, { force: request.force === true })
          : await setImageWallpaper(media);
      const conflict = result?.verified === false;

      return {
        ok: true,
        platform: process.platform,
        mode: media.kind,
        verified: result?.verified ?? null,
        verification: result?.verification ?? "unverified",
        code: result?.code ?? "VERIFY_UNAVAILABLE",
        conflict,
        retryable: true,
        conflictPossible: media.kind === "video" || result?.verified !== true,
        message: conflict
          ? "设置后检测到壁纸可能被其他软件覆盖"
          : media.kind === "video"
            ? result?.verified === true
              ? "动态壁纸已启动；若仍未显示，请检查其他壁纸软件"
              : "动态壁纸已启动，但系统无法确认桌面层是否可见"
            : result?.verified === true
              ? "壁纸已设置并完成验证"
              : "壁纸已设置，但系统未返回验证结果",
      };
    } catch (error) {
      console.error("Failed to set wallpaper", error);
      const message = dependencyMessage(error);
      const conflict = message.includes("被其他桌面程序占用");
      return {
        ok: false,
        platform: process.platform,
        conflict,
        retryable: true,
        code: conflict ? "DESKTOP_LAYER_FAILED" : "APPLY_FAILED",
        message,
      };
    }
  });

  ipcMain.handle("luma:update:get-state", (event) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口读取更新状态");
    return getAutoUpdateState();
  });

  ipcMain.handle("luma:update:install", (event) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口安装更新");
    return installDownloadedUpdate();
  });

  ipcMain.handle("luma:wallpaper:get-media", (event) => {
    if (!wallpaperWindow || event.sender.id !== wallpaperWindow.webContents.id) return null;
    return wallpaperMedia;
  });
}

async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  const nextWindow = new BrowserWindow({
    ...MAIN_WINDOW_BOUNDS,
    show: false,
    backgroundColor: "#78dce5",
    title: "Luma",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep the renderer isolated while allowing the .mjs preload bridge.
      sandbox: false,
      webSecurity: true,
    },
  });

  mainWindow = nextWindow;
  nextWindow.once("ready-to-show", () => nextWindow.show());
  nextWindow.on("closed", () => {
    if (mainWindow === nextWindow) mainWindow = null;
    if (process.platform !== "darwin") app.quit();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) await nextWindow.loadURL(devServerUrl);
  else await nextWindow.loadFile(path.join(appRoot, "dist", "index.html"));

  return nextWindow;
}

app.whenReady().then(async () => {
  registerMediaProtocol();
  registerIpc();
  await createMainWindow();
  initializeAutoUpdates({
    getMainWindow: () => mainWindow,
    beforeInstall: destroyWallpaperWindow,
  });

  app.on("activate", () => {
    if (!mainWindow) createMainWindow().catch((error) => console.error(error));
  });
});

app.on("before-quit", () => {
  stopAutoUpdates();
  destroyWallpaperWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
