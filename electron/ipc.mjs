import fs from "node:fs";
import { app, dialog, ipcMain } from "electron";
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from "../shared/mediaExtensions.js";
import { state, consts } from "./app-state.mjs";
import {
  mediaKind,
  authorizeMediaFile,
  mediaDescriptor,
  comparablePath,
  isMainWindowSender,
  releaseMediaTokens,
  enqueueWallpaperOperation,
} from "./media-tokens.mjs";
import {
  loadLibraryState,
  saveLibraryState,
  rememberLastApplied,
  clearLastApplied,
  readPersistedState,
} from "./library-state.mjs";
import {
  resolveMediaRequest,
  destroyWallpaperWindow,
  notifyWallpaperError,
  publishWallpaperRuntime,
  runtimeStateFor,
  sendWallpaperPlaybackControl,
  setImageWallpaper,
  setVideoWallpaper,
  dependencyMessage,
  settlePlayback,
} from "./wallpaper-apply.mjs";
import {
  getAutoUpdateState,
  checkForUpdatesManually,
  installDownloadedUpdate,
  downloadAndInstallUpdate,
} from "./auto-update.mjs";
import { rebuildTrayMenu } from "./tray.mjs";

export function registerIpc() {
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

