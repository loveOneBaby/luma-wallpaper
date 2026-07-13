import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  powerMonitor,
  protocol,
  screen,
  session,
  Tray,
} from "electron";
import {
  checkForUpdatesManually,
  getAutoUpdateState,
  initializeAutoUpdates,
  installDownloadedUpdate,
  downloadAndInstallUpdate,
  stopAutoUpdates,
} from "./auto-update.mjs";
import {
  acknowledgeUnsignedMacUpdateLaunch,
  recoverAbandonedUnsignedMacUpdate,
  shouldExitForActiveUnsignedMacUpdate,
} from "./unsigned-mac-update.mjs";
import { resolveMacAppBundlePath } from "./update-support.mjs";
import { attachWindowToWorkerW } from "./windows-workerw.mjs";
import {
  shouldResumeWallpaperPlayback,
  transitionWallpaperPowerState,
} from "./wallpaper-lifecycle.mjs";
import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  kindFromExtension,
} from "../shared/mediaExtensions.js";
import { state, consts, __dirname, appRoot } from "./app-state.mjs";


const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (hasSingleInstanceLock) {
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
}


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

function waitForPlayback(token, timeout = consts.PLAYBACK_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      state.playbackWaiters.delete(token);
      resolve({ status: "timeout" });
    }, timeout);

    state.playbackWaiters.set(token, {
      resolve: (result) => {
        clearTimeout(timer);
        state.playbackWaiters.delete(token);
        resolve(result);
      },
    });
  });
}

function settlePlayback(token, result) {
  state.playbackWaiters.get(token)?.resolve(result);
}

async function loadWallpaperModule() {
  state.wallpaperModulePromise ??= import("wallpaper");
  return state.wallpaperModulePromise;
}

function mediaKind(filePath) {
  return kindFromExtension(filePath);
}

function authorizeMediaFile(filePath) {
  const resolvedPath = fs.realpathSync.native(filePath);
  if (!fs.statSync(resolvedPath).isFile() || !mediaKind(resolvedPath)) {
    throw new Error("仅支持图片或视频文件");
  }

  const identity = comparablePath(resolvedPath);
  if (!identity) throw new Error("无法识别媒体文件");
  state.authorizedMediaIdentities.add(identity);
  state.deferredMediaReleaseIdentities.delete(identity);
  return resolvedPath;
}

function authorizePersistedMedia(state) {
  const persistedPaths = [
    ...(Array.isArray(state?.library?.items)
      ? state.library.items.map((item) => item?.filePath)
      : []),
    state?.lastApplied?.path,
  ];

  for (const persistedPath of persistedPaths) {
    if (typeof persistedPath !== "string" || !persistedPath.trim()) continue;
    try {
      authorizeMediaFile(persistedPath);
    } catch {
      // Missing persisted media is removed during the next library hydration.
    }
  }
}

function mediaUrl(filePath) {
  const identity = comparablePath(filePath);
  let token = state.mediaTokensByPath.get(identity);
  if (!token) {
    token = crypto.randomUUID();
    state.mediaTokensByPath.set(identity, token);
    state.mediaFilesByToken.set(token, { identity, path: filePath });
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
    state.mainWindow && !state.mainWindow.isDestroyed() && event?.sender?.id === state.mainWindow.webContents.id,
  );
}

function registerMediaProtocol() {
  protocol.handle("luma-media", (request) => {
    const requestUrl = new URL(request.url);
    const [, token] = requestUrl.pathname.split("/");
    const mediaEntry = state.mediaFilesByToken.get(token);
    const filePath = mediaEntry?.path;

    if (!filePath || !fs.existsSync(filePath) || !mediaKind(filePath)) {
      if (mediaEntry) {
        state.mediaFilesByToken.delete(token);
        state.mediaTokensByPath.delete(mediaEntry.identity);
      }
      return new Response("Media not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).href, { headers: request.headers });
  });
}

function releaseMediaTokens(requestedPaths) {
  const activeIdentity = comparablePath(state.wallpaperMedia?.path);
  let released = 0;
  for (const requestedPath of Array.isArray(requestedPaths) ? requestedPaths : []) {
    const identity = comparablePath(requestedPath);
    if (!identity) continue;
    if (identity === activeIdentity) {
      state.deferredMediaReleaseIdentities.add(identity);
      continue;
    }
    const token = state.mediaTokensByPath.get(identity);
    if (!token) continue;
    state.mediaTokensByPath.delete(identity);
    state.mediaFilesByToken.delete(token);
    released += 1;
  }
  return released;
}

function flushDeferredMediaTokenReleases() {
  const activeIdentity = comparablePath(state.wallpaperMedia?.path);
  let released = 0;
  for (const identity of [...state.deferredMediaReleaseIdentities]) {
    if (identity === activeIdentity) continue;
    state.deferredMediaReleaseIdentities.delete(identity);
    const token = state.mediaTokensByPath.get(identity);
    if (!token) continue;
    state.mediaTokensByPath.delete(identity);
    state.mediaFilesByToken.delete(token);
    released += 1;
  }
  return released;
}

function findDemoMedia(demoKey) {
  const fileName = consts.DEMO_FILES_BY_KEY.get(String(demoKey ?? ""));
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

function libraryStatePath() {
  return path.join(app.getPath("userData"), "library-state.json");
}

function safeText(value, fallback = "", maxLength = 240) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || fallback;
}

function emptyPersistedState() {
  return {
    version: consts.LIBRARY_STATE_VERSION,
    library: { items: [], selectedId: null, activeCategory: "all" },
    lastApplied: null,
  };
}

async function readPersistedState() {
  if (state.persistedStateCache) return state.persistedStateCache;

  try {
    const content = await fsPromises.readFile(libraryStatePath(), "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") throw new Error("状态文件格式无效");
    state.persistedStateCache = {
      ...emptyPersistedState(),
      ...parsed,
      version: consts.LIBRARY_STATE_VERSION,
      library:
        parsed.library && typeof parsed.library === "object"
          ? parsed.library
          : { items: [], selectedId: null, activeCategory: "all" },
    };
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Unable to read saved library state", error);
    state.persistedStateCache = emptyPersistedState();
  }

  authorizePersistedMedia(state.persistedStateCache);

  return state.persistedStateCache;
}

async function writePersistedState(nextState) {
  const targetPath = libraryStatePath();
  const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fsPromises.writeFile(temporaryPath, `${JSON.stringify(nextState, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fsPromises.rename(temporaryPath, targetPath);
  } finally {
    await fsPromises.rm(temporaryPath, { force: true }).catch(() => {});
  }
  state.persistedStateCache = nextState;
}

function updatePersistedState(mutator) {
  const operation = state.stateWriteQueue.then(async () => {
    const current = await readPersistedState();
    const next = await mutator(structuredClone(current));
    await writePersistedState(next);
    return next;
  });
  state.stateWriteQueue = operation.catch(() => {});
  return operation;
}

function enqueueWallpaperOperation(operation) {
  const queuedOperation = state.wallpaperOperationQueue.then(operation, operation);
  state.wallpaperOperationQueue = queuedOperation.catch(() => {});
  return queuedOperation;
}

function sanitizeLibraryForStorage(request, { allowedIdentities = null } = {}) {
  const requestedItems = Array.isArray(request?.items)
    ? request.items.slice(0, consts.MAX_LIBRARY_ITEMS)
    : [];
  const storedItems = [];
  const seenIds = new Set();
  const seenSources = new Set();

  for (const item of requestedItems) {
    if (!item || typeof item !== "object") continue;
    let id = safeText(item.id, crypto.randomUUID(), 120);
    if (seenIds.has(id)) id = crypto.randomUUID();

    const demoKey = safeText(item.demoKey, "", 120);
    if (item.isDemo === true && consts.DEMO_FILES_BY_KEY.has(demoKey)) {
      const sourceKey = `demo:${demoKey}`;
      if (seenSources.has(sourceKey)) continue;
      const demoPath = findDemoMedia(demoKey);
      const kind = demoPath ? mediaKind(demoPath) : demoKey.endsWith("-video") ? "video" : "image";
      storedItems.push({
        id,
        name: safeText(item.name, kind === "video" ? "海岸晨光 · 动态" : "海岸晨光 · 静态"),
        kind,
        favorite: item.favorite === true,
        isDemo: true,
        demoKey,
        sourceKey,
        filePath: null,
      });
      seenIds.add(id);
      seenSources.add(sourceKey);
      continue;
    }

    const requestedPath = safeText(item.filePath ?? item.path, "", 4096);
    if (!requestedPath) continue;
    try {
      const filePath = fs.realpathSync.native(requestedPath);
      const kind = mediaKind(filePath);
      const identity = comparablePath(filePath);
      const sourceKey = `desktop:${identity}`;
      if (
        !kind ||
        !fs.statSync(filePath).isFile() ||
        (allowedIdentities && !allowedIdentities.has(identity)) ||
        seenSources.has(sourceKey)
      )
        continue;
      storedItems.push({
        id,
        name: path.basename(filePath),
        kind,
        favorite: item.favorite === true,
        isDemo: false,
        demoKey: null,
        sourceKey,
        filePath,
      });
      seenIds.add(id);
      seenSources.add(sourceKey);
    } catch {
      // Keep moved/inaccessible media marked as missing so the user can
      // re-locate it instead of silently losing it from the library.
      const fallbackSource = item.sourceKey ?? `desktop:${requestedPath}`;
      if (seenSources.has(fallbackSource)) continue;
      const fallbackKind = mediaKind(requestedPath) ?? (item.kind === "video" ? "video" : "image");
      storedItems.push({
        id,
        name: safeText(item.name, path.basename(requestedPath) || "未知素材", 240),
        kind: fallbackKind,
        favorite: item.favorite === true,
        isDemo: false,
        demoKey: null,
        sourceKey: fallbackSource,
        filePath: requestedPath,
        missing: true,
      });
      seenIds.add(id);
      seenSources.add(fallbackSource);
    }
  }

  const selectedId = safeText(request?.selectedId, "", 120);
  const selectedExists = storedItems.some((item) => item.id === selectedId);
  const categories = new Set(["all", "image", "video", "favorite"]);
  const activeCategory = categories.has(request?.activeCategory) ? request.activeCategory : "all";
  return {
    items: storedItems,
    selectedId: selectedExists ? selectedId : (storedItems[0]?.id ?? null),
    activeCategory,
  };
}

function hydrateLibraryState(storedLibrary) {
  const sanitized = sanitizeLibraryForStorage(storedLibrary);
  const items = sanitized.items.flatMap((item) => {
    if (item.isDemo) {
      const demoPath = findDemoMedia(item.demoKey);
      if (!demoPath || !mediaKind(demoPath)) return [];
      return [{ ...item, src: mediaUrl(demoPath) }];
    }

    try {
      const descriptor = mediaDescriptor(item.filePath);
      return [
        {
          ...item,
          kind: descriptor.kind,
          name: descriptor.name,
          filePath: descriptor.path,
          src: descriptor.url,
        },
      ];
    } catch {
      return [];
    }
  });
  const selectedId = items.some((item) => item.id === sanitized.selectedId)
    ? sanitized.selectedId
    : (items[0]?.id ?? null);
  return {
    version: consts.LIBRARY_STATE_VERSION,
    items,
    selectedId,
    activeCategory: sanitized.activeCategory,
  };
}

async function loadLibraryState() {
  await state.stateWriteQueue;
  const persisted = await readPersistedState();
  const hydrated = hydrateLibraryState(persisted.library);
  const cleanedLibrary = sanitizeLibraryForStorage(hydrated);
  if (JSON.stringify(cleanedLibrary) !== JSON.stringify(persisted.library)) {
    await updatePersistedState((current) => ({ ...current, library: cleanedLibrary }));
  }
  return hydrated;
}

async function saveLibraryState(request) {
  await state.stateWriteQueue;
  await readPersistedState();
  const library = sanitizeLibraryForStorage(request, {
    allowedIdentities: state.authorizedMediaIdentities,
  });
  for (const item of library.items) {
    if (item.filePath) state.deferredMediaReleaseIdentities.delete(comparablePath(item.filePath));
  }
  await updatePersistedState((current) => ({
    ...current,
    version: consts.LIBRARY_STATE_VERSION,
    library,
  }));
  return { ok: true, saved: library.items.length };
}

async function rememberLastApplied(media) {
  const demoKey = [...consts.DEMO_FILES_BY_KEY.keys()].find((key) => {
    const demoPath = findDemoMedia(key);
    return demoPath ? sameFilePath(demoPath, media.path) : false;
  });
  await updatePersistedState((current) => ({
    ...current,
    lastApplied: {
      kind: media.kind,
      path: demoKey ? null : media.path,
      demoKey: demoKey ?? null,
      appliedAt: new Date().toISOString(),
    },
  }));
}

async function clearLastApplied() {
  await updatePersistedState((current) => ({ ...current, lastApplied: null }));
}

async function publishLastAppliedRuntime() {
  const persisted = await readPersistedState();
  const lastApplied = persisted.lastApplied;
  if (!lastApplied) {
    publishWallpaperRuntime({ status: "stopped" });
    return;
  }
  if (lastApplied.kind === "image") {
    publishWallpaperRuntime({
      status: "running",
      kind: "image",
      matchKey: lastApplied.demoKey ? `demo:${lastApplied.demoKey}` : (lastApplied.path ?? null),
      name: null,
      appliedAt: lastApplied.appliedAt ?? null,
    });
  }
  // video restore is handled by restoreLastVideoWallpaper()
}

function resolveMediaRequest(request) {
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

function clearPlaybackTracking(token, result = null) {
  if (!token) return;
  settlePlayback(token, result ?? { status: "error", message: "动态壁纸播放请求已取消" });
  state.playbackWaiters.delete(token);
  state.confirmedPlaybackTokens.delete(token);
  state.reportedPlaybackErrors.delete(token);
}

function destroyWallpaperWindow({ flushDeferred = true } = {}) {
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

function notifyWallpaperError(message, code = "PLAYBACK_FAILED") {
  if (!state.mainWindow || state.mainWindow.isDestroyed() || state.mainWindow.webContents.isDestroyed()) return;
  state.mainWindow.webContents.send("luma:wallpaper-error", {
    code,
    message: safeText(message, "动态壁纸播放已中断", 240),
  });
}

function publishWallpaperRuntime(state) {
  if (!state.mainWindow || state.mainWindow.isDestroyed() || state.mainWindow.webContents.isDestroyed()) return;
  state.mainWindow.webContents.send("luma:wallpaper:runtime", state);
}

function runtimeStateFor(media, status) {
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

function sendWallpaperPlaybackControl(action, reason) {
  if (
    !state.wallpaperWindow ||
    state.wallpaperWindow.isDestroyed() ||
    state.wallpaperWindow.webContents.isDestroyed()
  ) {
    return;
  }
  state.wallpaperWindow.webContents.send("luma:wallpaper:playback-control", { action, reason });
}

async function refreshWallpaperPlacement(reason = "display-change") {
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

function scheduleWallpaperPlacementRefresh(reason, delay = consts.DISPLAY_REFRESH_DELAY_MS) {
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

async function setImageWallpaper(media) {
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

function createWallpaperWindow(bounds) {
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

async function activateVideoWallpaper(media, playbackToken) {
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

async function setVideoWallpaper(media, { force = false } = {}) {
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
    if (!state.wallpaperWindow || event.sender.id !== state.wallpaperWindow.webContents.id) return;
    if (!payload || payload.token !== state.wallpaperMedia?.playbackToken) return;
    if (payload.status !== "playing" && payload.status !== "error") return;

    if (payload.status === "playing") state.confirmedPlaybackTokens.add(payload.token);
    settlePlayback(payload.token, {
      status: payload.status,
      message: typeof payload.message === "string" ? payload.message : undefined,
    });
    if (
      payload.status === "error" &&
      state.confirmedPlaybackTokens.has(payload.token) &&
      !state.reportedPlaybackErrors.has(payload.token)
    ) {
      state.reportedPlaybackErrors.add(payload.token);
      notifyWallpaperError(payload.message, "PLAYBACK_INTERRUPTED");
    }
  });

  ipcMain.handle("luma:pick-media", async (event) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口选择文件");
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

    const result = state.mainWindow
      ? await dialog.showOpenDialog(state.mainWindow, options)
      : await dialog.showOpenDialog(options);
    return {
      canceled: result.canceled,
      files: result.canceled
        ? []
        : result.filePaths
            .filter((filePath) => mediaKind(filePath))
            .flatMap((filePath) => {
              try {
                return [mediaDescriptor(authorizeMediaFile(filePath))];
              } catch {
                return [];
              }
            }),
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
    const limitedPaths = requestedPaths.slice(0, consts.MAX_DROPPED_PATHS);
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
        const authorizedPath = authorizeMediaFile(filePath);
        seen.add(identity);
        files.push(mediaDescriptor(authorizedPath));
      } catch {
        rejectedCount += 1;
      }
    }

    return { files, duplicateCount, rejectedCount };
  });

  ipcMain.handle("luma:library:load", async (event) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口读取媒体库");
    return loadLibraryState();
  });

  ipcMain.handle("luma:library:save", async (event, state) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口保存媒体库");
    return saveLibraryState(state);
  });

  ipcMain.handle("luma:media:release", (event, payload) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口释放媒体");
    return { ok: true, released: releaseMediaTokens(payload?.paths) };
  });

  ipcMain.handle("luma:set-wallpaper", async (event, request) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口设置壁纸");
    if (process.platform !== "darwin" && process.platform !== "win32") {
      return {
        ok: false,
        platform: process.platform,
        message: "当前桌面端仅支持 macOS 和 Windows",
      };
    }

    return enqueueWallpaperOperation(async () => {
      try {
        await state.stateWriteQueue;
        await readPersistedState();
        const media = resolveMediaRequest(request);
        const result =
          media.kind === "video"
            ? await setVideoWallpaper(media, { force: request.force === true })
            : await setImageWallpaper(media);
        const conflict = result?.verified === false;
        try {
          await rememberLastApplied(media);
        } catch (error) {
          console.warn("Unable to remember the last applied wallpaper", error);
        }

        publishWallpaperRuntime(runtimeStateFor(media, "running"));

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
  });

  ipcMain.handle("luma:update:get-state", (event) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口读取更新状态");
    return getAutoUpdateState();
  });

  ipcMain.handle("luma:update:check", (event) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口检查更新");
    return checkForUpdatesManually();
  });

  ipcMain.handle("luma:update:install", (event) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口安装更新");
    return installDownloadedUpdate();
  });

  ipcMain.handle("luma:update:download-install", (event) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口下载并安装更新");
    return downloadAndInstallUpdate();
  });

  ipcMain.handle("luma:startup:get", (event) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口读取启动设置");
    return { supported: app.isPackaged, openAtLogin: app.getLoginItemSettings().openAtLogin };
  });

  ipcMain.handle("luma:startup:set", (event, openAtLogin) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口修改启动设置");
    if (!app.isPackaged) return { ok: false, supported: false, openAtLogin: false };
    app.setLoginItemSettings({ openAtLogin: openAtLogin === true, path: process.execPath });
    rebuildTrayMenu();
    return { ok: true, supported: true, openAtLogin: app.getLoginItemSettings().openAtLogin };
  });

  ipcMain.handle("luma:wallpaper:get-media", (event) => {
    if (!state.wallpaperWindow || event.sender.id !== state.wallpaperWindow.webContents.id) return null;
    return state.wallpaperMedia;
  });

  ipcMain.handle("luma:wallpaper:stop", (event) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口停止动态壁纸");
    return enqueueWallpaperOperation(async () => {
      destroyWallpaperWindow();
      await clearLastApplied().catch(() => {});
      publishWallpaperRuntime({ status: "stopped" });
      return { ok: true };
    });
  });

  ipcMain.handle("luma:wallpaper:pause", (event) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口暂停动态壁纸");
    sendWallpaperPlaybackControl("pause", "user");
    if (state.wallpaperMedia) publishWallpaperRuntime(runtimeStateFor(state.wallpaperMedia, "paused"));
    return { ok: true };
  });

  ipcMain.handle("luma:wallpaper:resume", (event) => {
    if (!isMainWindowSender(event)) throw new Error("不允许从当前窗口恢复动态壁纸");
    sendWallpaperPlaybackControl("resume", "user");
    if (state.wallpaperMedia) publishWallpaperRuntime(runtimeStateFor(state.wallpaperMedia, "running"));
    return { ok: true };
  });
}

function trustedDevServerUrl(value) {
  if (app.isPackaged || typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    const trustedHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (parsed.protocol !== "http:" || !trustedHost || parsed.username || parsed.password)
      return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function hardenWindowNavigation(browserWindow, allowedUrl) {
  const allowed = new URL(allowedUrl);
  const isAllowedNavigation = (targetUrl) => {
    try {
      const target = new URL(targetUrl);
      if (allowed.protocol === "http:") return target.origin === allowed.origin;
      return target.protocol === "file:" && target.pathname === allowed.pathname;
    } catch {
      return false;
    }
  };

  browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  browserWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl)) event.preventDefault();
  });
  browserWindow.webContents.on("will-redirect", (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl)) event.preventDefault();
  });
  browserWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

function showMainWindow() {
  if (!app.isReady()) {
    app
      .whenReady()
      .then(showMainWindow)
      .catch((error) => console.error(error));
    return;
  }
  if (!state.mainWindow || state.mainWindow.isDestroyed()) {
    createMainWindow().catch((error) => console.error("Unable to create the main window", error));
    return;
  }
  if (state.mainWindow.isMinimized()) state.mainWindow.restore();
  state.mainWindow.show();
  state.mainWindow.focus();
}

function rebuildTrayMenu() {
  if (!state.tray || state.tray.isDestroyed()) return;
  const startupSupported = app.isPackaged;
  const openAtLogin = startupSupported && app.getLoginItemSettings().openAtLogin;
  state.tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 Luma", click: showMainWindow },
      { type: "separator" },
      {
        label: "开机自动启动",
        type: "checkbox",
        checked: openAtLogin,
        enabled: startupSupported,
        click: (menuItem) => {
          app.setLoginItemSettings({ openAtLogin: menuItem.checked, path: process.execPath });
          rebuildTrayMenu();
        },
      },
      { type: "separator" },
      {
        label: "退出 Luma",
        click: () => {
          state.isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

async function createWindowsTray() {
  if (process.platform !== "win32" || state.tray) return;
  let trayImage = nativeImage.createEmpty();
  try {
    if (!app.isPackaged) {
      const developmentIcon = path.join(appRoot, "build", "icon-64-preview.png");
      if (fs.existsSync(developmentIcon)) {
        trayImage = nativeImage.createFromPath(developmentIcon).resize({ width: 20, height: 20 });
      }
    }
    if (trayImage.isEmpty()) trayImage = await app.getFileIcon(process.execPath, { size: "small" });
    state.tray = new Tray(trayImage);
    state.tray.setToolTip("Luma 动态壁纸");
    state.tray.on("double-click", showMainWindow);
    rebuildTrayMenu();
  } catch (error) {
    state.tray = null;
    console.error("Unable to create the Windows state.tray icon", error);
  }
}

function configureSessionSecurity() {
  const permitsFullscreen = (webContents, permission) =>
    permission === "fullscreen" &&
    state.mainWindow &&
    !state.mainWindow.isDestroyed() &&
    webContents?.id === state.mainWindow.webContents.id;
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    Boolean(permitsFullscreen(webContents, permission)),
  );
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(Boolean(permitsFullscreen(webContents, permission)));
  });
}

function registerDisplayLifecycle() {
  screen.on("display-added", () => scheduleWallpaperPlacementRefresh("display-added"));
  screen.on("display-removed", () => scheduleWallpaperPlacementRefresh("display-removed"));
  screen.on("display-metrics-changed", () =>
    scheduleWallpaperPlacementRefresh("display-metrics-changed"),
  );
  const handlePowerEvent = (eventName) => {
    const transition = transitionWallpaperPowerState(state.wallpaperPowerState, eventName);
    state.wallpaperPowerState = {
      sleeping: transition.sleeping,
      locked: transition.locked,
      suspended: transition.suspended,
    };
    if (transition.command === "pause") {
      if (state.displayRefreshTimer) clearTimeout(state.displayRefreshTimer);
      state.displayRefreshTimer = null;
      sendWallpaperPlaybackControl("pause", eventName);
      if (state.wallpaperMedia) publishWallpaperRuntime(runtimeStateFor(state.wallpaperMedia, "paused"));
      return;
    }
    if (transition.refreshPlacement) scheduleWallpaperPlacementRefresh(eventName);
    if (state.wallpaperMedia && !state.wallpaperPowerState.suspended) {
      publishWallpaperRuntime(runtimeStateFor(state.wallpaperMedia, "running"));
    }
  };
  powerMonitor.on("suspend", () => handlePowerEvent("suspend"));
  powerMonitor.on("lock-screen", () => handlePowerEvent("lock-screen"));
  powerMonitor.on("resume", () => handlePowerEvent("resume"));
  powerMonitor.on("unlock-screen", () => handlePowerEvent("unlock-screen"));
}

async function restoreLastVideoWallpaper() {
  if (process.platform !== "darwin" && process.platform !== "win32") return;
  await state.stateWriteQueue;
  const persisted = await readPersistedState();
  const lastApplied = persisted.lastApplied;
  if (!lastApplied || lastApplied.kind !== "video") return;

  try {
    const media = resolveMediaRequest({
      path: lastApplied.path,
      demoKey: lastApplied.demoKey,
    });
    if (media.kind !== "video") throw new Error("上次使用的动态壁纸格式已不受支持");
    await enqueueWallpaperOperation(() => setVideoWallpaper(media));
    publishWallpaperRuntime(runtimeStateFor(media, "running"));
  } catch (error) {
    console.error("Unable to restore the previous video wallpaper", error);
    notifyWallpaperError(dependencyMessage(error), "RESTORE_FAILED");
    await updatePersistedState((current) => ({ ...current, lastApplied: null })).catch(() => {});
    publishWallpaperRuntime({ status: "stopped" });
  }
}

async function createMainWindow() {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.show();
    state.mainWindow.focus();
    return state.mainWindow;
  }

  const nextWindow = new BrowserWindow({
    ...consts.MAIN_WINDOW_BOUNDS,
    show: false,
    backgroundColor: "#78dce5",
    title: "Luma",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  state.mainWindow = nextWindow;
  nextWindow.once("ready-to-show", () => nextWindow.show());
  nextWindow.on("close", (event) => {
    if (process.platform === "win32" && !state.isQuitting && state.tray && !state.tray.isDestroyed()) {
      event.preventDefault();
      nextWindow.hide();
    }
  });
  nextWindow.on("closed", () => {
    if (state.mainWindow === nextWindow) state.mainWindow = null;
  });

  const devServerUrl = trustedDevServerUrl(process.env.VITE_DEV_SERVER_URL);
  const productionEntry = path.join(appRoot, "dist", "index.html");
  const targetUrl = devServerUrl ?? pathToFileURL(productionEntry).href;
  hardenWindowNavigation(nextWindow, targetUrl);
  if (devServerUrl) await nextWindow.loadURL(devServerUrl);
  else await nextWindow.loadFile(productionEntry);

  return nextWindow;
}

async function startApplication() {
  if (process.platform === "win32") app.setAppUserModelId("com.luma.wallpaper");
  if (
    await shouldExitForActiveUnsignedMacUpdate({
      argv: process.argv,
      userDataPath: app.getPath("userData"),
    })
  ) {
    state.isQuitting = true;
    app.quit();
    return;
  }
  configureSessionSecurity();
  registerMediaProtocol();
  registerIpc();
  registerDisplayLifecycle();
  await createWindowsTray();
  await createMainWindow();
  const acknowledgedUpdate = await acknowledgeUnsignedMacUpdateLaunch({
    argv: process.argv,
    userDataPath: app.getPath("userData"),
    currentVersion: app.getVersion(),
    currentAppPath: resolveMacAppBundlePath(process.execPath),
  });
  if (!acknowledgedUpdate) {
    await recoverAbandonedUnsignedMacUpdate({
      argv: process.argv,
      userDataPath: app.getPath("userData"),
      currentAppPath: resolveMacAppBundlePath(process.execPath),
    });
  }
  initializeAutoUpdates({
    getMainWindow: () => state.mainWindow,
    beforeInstall: () => {
      state.isQuitting = true;
      destroyWallpaperWindow();
    },
  });
  restoreLastVideoWallpaper().catch((error) =>
    console.error("Unable to restore the video wallpaper", error),
  );
  publishLastAppliedRuntime().catch(() => {});

  app.on("activate", showMainWindow);
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app
    .whenReady()
    .then(startApplication)
    .catch((error) => {
      console.error("Luma failed to start", error);
      dialog.showErrorBox("Luma 无法启动", dependencyMessage(error));
      state.isQuitting = true;
      app.exit(1);
    });
}

app.on("before-quit", () => {
  state.isQuitting = true;
  stopAutoUpdates();
  if (state.displayRefreshTimer) clearTimeout(state.displayRefreshTimer);
  state.displayRefreshTimer = null;
  destroyWallpaperWindow();
  if (state.tray && !state.tray.isDestroyed()) state.tray.destroy();
  state.tray = null;
});

app.on("window-all-closed", () => {
  if (process.platform === "win32") {
    if (!state.tray || state.tray.isDestroyed()) app.quit();
    return;
  }
  if (process.platform !== "darwin") app.quit();
});
