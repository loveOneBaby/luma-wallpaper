import { useCallback, useEffect, useRef, useState } from "react";
import { applyDesktopWallpaper } from "../services/desktopWallpaper.js";
import {
  getDesktopUpdateState,
  installDesktopUpdate,
  subscribeDesktopUpdates,
} from "../services/desktopUpdates.js";

// Toast auto-dismiss durations (ms). Success lingers a touch longer than
// warnings/errors so a positive result stays readable.
const FEEDBACK_DURATION_SUCCESS_MS = 6200;
const FEEDBACK_DURATION_DEFAULT_MS = 4800;
const FEEDBACK_DURATION_UPDATE_ERROR_MS = 7200;

/**
 * Owns the feedback toast, wallpaper-apply state, the conflict recovery
 * dialog, and the desktop auto-update subscription. Takes no arguments so it
 * can sit at the top of the hook chain: media is passed to
 * `handleApplyWallpaper(media, force)` at the call site instead of being
 * captured in a closure, which keeps this hook independent of the media
 * library.
 */
export function useWallpaperStatus() {
  const [feedback, setFeedback] = useState(null);
  const [applyState, setApplyState] = useState("idle");
  const [isConflictOpen, setConflictOpen] = useState(
    () =>
      import.meta.env.DEV &&
      new URLSearchParams(window.location.search).get("previewState") === "conflict",
  );

  const statusTimerRef = useRef(null);
  const readyUpdateRef = useRef(null);

  const showFeedback = useCallback((tone, message, options = {}) => {
    const source = options.source ?? "system";
    // Named ttlMs (not `duration`) to avoid shadowing the playback duration
    // state that consumers of these hooks also hold.
    const ttlMs = options.persistent
      ? null
      : (options.duration ??
        (tone === "success" ? FEEDBACK_DURATION_SUCCESS_MS : FEEDBACK_DURATION_DEFAULT_MS));
    window.clearTimeout(statusTimerRef.current);
    if (source !== "wallpaper") {
      setApplyState((state) => (state === "applying" ? state : "idle"));
    }
    setFeedback({ tone, message, source, ...options });
    if (ttlMs !== null) {
      statusTimerRef.current = window.setTimeout(() => {
        if (source === "wallpaper") setApplyState("idle");
        const readyUpdate = readyUpdateRef.current;
        setFeedback(
          readyUpdate
            ? {
                tone: "success",
                message: readyUpdate.message ?? "新版本已准备好",
                source: "update",
                persistent: true,
                updateState: readyUpdate,
              }
            : null,
        );
      }, ttlMs);
    }
  }, []);

  const showApplyStatus = useCallback(
    (state, message, options = {}) => {
      setApplyState(state);
      showFeedback(state, message, { ...options, source: "wallpaper" });
    },
    [showFeedback],
  );

  const showUploadResult = useCallback(
    ({ added, duplicates = 0, rejected = 0 }) => {
      if (added > 0) {
        const skipped = duplicates + rejected;
        showFeedback(
          skipped > 0 ? "warning" : "success",
          `已添加 ${added} 个素材${skipped > 0 ? `，跳过 ${skipped} 个` : ""}`,
          { source: "upload" },
        );
        return;
      }
      if (duplicates > 0) {
        showFeedback("info", "这个素材已经在媒体库中", { source: "upload" });
        return;
      }
      showFeedback("error", "没有可用素材，请拖入支持的图片或视频", { source: "upload" });
    },
    [showFeedback],
  );

  const handleApplyWallpaper = useCallback(
    async (media, force = false) => {
      if (applyState === "applying") return;
      window.clearTimeout(statusTimerRef.current);
      if (force) setConflictOpen(false);
      setApplyState("applying");
      setFeedback({
        tone: "applying",
        source: "wallpaper",
        message: force
          ? "正在重新应用壁纸…"
          : media.kind === "video"
            ? "正在启动动态壁纸…"
            : "正在设置桌面壁纸…",
      });
      const result = await applyDesktopWallpaper(media, { force });
      if (result.status === "conflict") setConflictOpen(true);
      showApplyStatus(result.status, result.message);
    },
    [applyState, showApplyStatus],
  );

  const handleInstallUpdate = useCallback(async () => {
    readyUpdateRef.current = null;
    showFeedback("installing", "正在关闭旧版本并安装更新…", {
      source: "update",
      persistent: true,
    });
    try {
      const result = await installDesktopUpdate();
      if (result?.ok === false) {
        showFeedback("error", result.message ?? "更新尚未准备好", { source: "update" });
      }
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : "无法开始安装更新", {
        source: "update",
      });
    }
  }, [showFeedback]);

  const dismissUpdate = useCallback(() => {
    readyUpdateRef.current = null;
    setFeedback(null);
  }, []);

  useEffect(() => {
    let active = true;
    const handleUpdateState = (state) => {
      if (!active || !state?.state) return;
      if (state.state === "available" || state.state === "downloading") {
        showFeedback("updating", state.message ?? "正在下载新版本…", {
          source: "update",
          persistent: true,
          updateState: state,
        });
      } else if (state.state === "ready") {
        readyUpdateRef.current = state;
        showFeedback("success", state.message ?? "新版本已准备好", {
          source: "update",
          persistent: true,
          updateState: state,
        });
      } else if (state.state === "installing") {
        readyUpdateRef.current = null;
        showFeedback("installing", state.message ?? "正在安装更新…", {
          source: "update",
          persistent: true,
          updateState: state,
        });
      } else if (state.state === "error" && state.message) {
        showFeedback("error", `更新失败：${state.message}`, {
          source: "update",
          duration: FEEDBACK_DURATION_UPDATE_ERROR_MS,
        });
      }
    };

    const unsubscribe = subscribeDesktopUpdates(handleUpdateState);
    getDesktopUpdateState()
      .then(handleUpdateState)
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [showFeedback]);

  // Clear any pending toast timer on unmount.
  useEffect(
    () => () => {
      window.clearTimeout(statusTimerRef.current);
    },
    [],
  );

  return {
    feedback,
    applyState,
    isConflictOpen,
    setConflictOpen,
    showFeedback,
    showUploadResult,
    handleApplyWallpaper,
    handleInstallUpdate,
    dismissUpdate,
  };
}
