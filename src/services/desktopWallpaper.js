import { getBridge } from "./desktopBridge.js";

export function getDesktopPlatform() {
  const bridge = getBridge();
  return bridge?.platform ?? null;
}

export async function pickDesktopMedia() {
  const bridge = getBridge();
  if (!bridge?.pickMedia) return null;

  const result = await bridge.pickMedia();
  const files = Array.isArray(result) ? result : result?.files;
  return {
    canceled: Array.isArray(result) ? false : result?.canceled === true,
    files: Array.isArray(files) ? files : [],
    duplicateCount: Number.isFinite(result?.duplicateCount)
      ? Math.max(0, Math.floor(result.duplicateCount))
      : 0,
    rejectedCount: Number.isFinite(result?.rejectedCount)
      ? Math.max(0, Math.floor(result.rejectedCount))
      : 0,
  };
}

export function subscribeWallpaperRuntime(callback) {
  const bridge = getBridge();
  if (typeof callback !== "function") return () => {};
  if (bridge?.onPlaybackError) return bridge.onPlaybackError(callback);
  return () => {};
}

export function subscribeWallpaperRuntimeState(callback) {
  const bridge = getBridge();
  if (typeof callback !== "function") return () => {};
  if (bridge?.onWallpaperRuntime) return bridge.onWallpaperRuntime(callback);
  return () => {};
}

export async function stopDesktopWallpaper() {
  const bridge = getBridge();
  if (!bridge?.stopWallpaper) return { ok: false };
  return bridge.stopWallpaper();
}

export async function pauseDesktopWallpaper() {
  const bridge = getBridge();
  if (!bridge?.pauseWallpaper) return { ok: false };
  return bridge.pauseWallpaper();
}

export async function resumeDesktopWallpaper() {
  const bridge = getBridge();
  if (!bridge?.resumeWallpaper) return { ok: false };
  return bridge.resumeWallpaper();
}

export async function releaseDesktopMedia(paths) {
  const bridge = getBridge();
  if (!bridge?.releaseMedia) return { ok: false, released: 0 };
  return bridge.releaseMedia(Array.from(paths ?? []).filter(Boolean));
}

export async function applyDesktopWallpaper(media, { force = false } = {}) {
  const bridge = getBridge();
  if (!bridge?.setWallpaper) {
    return {
      status: "unsupported",
      message: "浏览器仅支持管理与预览，请在 macOS 或 Windows 桌面端设置壁纸",
    };
  }

  if (!media.filePath && !media.demoKey) {
    return {
      status: "error",
      message: "请通过桌面端的上传按钮重新选择这个文件",
    };
  }

  try {
    const result = await bridge.setWallpaper({
      path: media.filePath ?? null,
      kind: media.kind,
      demoKey: media.demoKey ?? null,
      force,
    });

    if (result?.ok === false) {
      if (result.conflict) {
        return {
          status: "conflict",
          message: result.message ?? "桌面层可能被其他壁纸软件占用",
        };
      }
      return { status: "error", message: result.message ?? "设置失败，请重试" };
    }

    if (result?.conflict || result?.verified === false) {
      return {
        status: "conflict",
        message: result.message ?? "壁纸可能被其他软件覆盖",
      };
    }

    return {
      status: "success",
      message:
        result?.message ?? (media.kind === "video" ? "动态壁纸已开始播放" : "桌面壁纸已设置"),
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "设置失败，请重试",
    };
  }
}
