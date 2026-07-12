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
  return Array.isArray(files) ? files : [];
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
