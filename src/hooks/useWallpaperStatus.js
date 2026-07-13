import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyDesktopWallpaper,
  pauseDesktopWallpaper,
  resumeDesktopWallpaper,
  setOpenAtLoginDesktop,
  stopDesktopWallpaper,
  subscribeWallpaperRuntime,
  subscribeWallpaperRuntimeState,
} from "../services/desktopWallpaper.js";
import {
  checkForUpdatesDesktop,
  downloadAndInstallDesktopUpdate,
  getDesktopUpdateState,
  subscribeDesktopUpdates,
} from "../services/desktopUpdates.js";
import { createWallpaperApplySnapshot } from "../services/wallpaperApplyRequest.js";

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
  const [hasWallpaperRecovery, setHasWallpaperRecovery] = useState(false);
  const [wallpaperRuntime, setWallpaperRuntime] = useState({ status: "stopped" });
  const [appliedMatchKey, setAppliedMatchKey] = useState(null);
  const [pendingUpdate, setPendingUpdate] = useState(null);
  const [isConflictOpen, setConflictOpen] = useState(
    () =>
      import.meta.env.DEV &&
      new URLSearchParams(window.location.search).get("previewState") === "conflict",
  );

  const statusTimerRef = useRef(null);
  const readyUpdateRef = useRef(null);
  const pendingUpdateRef = useRef(null);
  const lastNoticeKeyRef = useRef(null);
  const applyInFlightRef = useRef(false);
  const lastApplyRequestRef = useRef(null);

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
    ({ added, duplicates = 0, rejected = 0, reason = null }) => {
      if (added > 0) {
        const skipped = duplicates + rejected;
        if (reason === "library-full") {
          showFeedback(
            "warning",
            `已添加 ${added} 个素材，媒体库已达 1000 个上限${skipped > 0 ? `，跳过 ${skipped} 个` : ""}`,
            { source: "upload" },
          );
          return;
        }
        showFeedback(
          skipped > 0 ? "warning" : "success",
          `已添加 ${added} 个素材${skipped > 0 ? `，跳过 ${skipped} 个` : ""}`,
          { source: "upload" },
        );
        return;
      }
      if (reason === "library-full") {
        showFeedback("warning", "媒体库最多保存 1000 个素材，请先移除不需要的内容", {
          source: "upload",
        });
        return;
      }
      if (duplicates > 0) {
        showFeedback("info", "这个素材已经在媒体库中", { source: "upload" });
        return;
      }
      if (reason === "too-many") {
        showFeedback("warning", "单次最多上传 100 个素材", { source: "upload" });
        return;
      }
      if (reason === "too-large") {
        showFeedback("error", "文件过大：图片上限 100 MB，视频上限 1 GB", {
          source: "upload",
        });
        return;
      }
      if (reason === "decode") {
        showFeedback("error", "浏览器无法解码这个素材，请换用常见格式或编码", {
          source: "upload",
        });
        return;
      }
      showFeedback("error", "没有可用素材，请拖入支持的图片或视频", { source: "upload" });
    },
    [showFeedback],
  );

  const handleApplyWallpaper = useCallback(
    async (media, force = false) => {
      if (applyInFlightRef.current) return;
      const request = force ? lastApplyRequestRef.current : createWallpaperApplySnapshot(media);
      if (!request) {
        showApplyStatus("error", "没有可重新应用的壁纸，请先选择并设置一个素材");
        return;
      }

      if (!force) lastApplyRequestRef.current = request;
      applyInFlightRef.current = true;
      window.clearTimeout(statusTimerRef.current);
      if (force) setConflictOpen(false);
      setApplyState("applying");
      setFeedback({
        tone: "applying",
        source: "wallpaper",
        message: force
          ? "正在重新应用壁纸…"
          : request.kind === "video"
            ? "正在启动动态壁纸…"
            : "正在设置桌面壁纸…",
      });
      try {
        const result = await applyDesktopWallpaper(request, { force });
        if (result.status === "conflict") setConflictOpen(true);
        if (result.status === "success") {
          setHasWallpaperRecovery(true);
          const matchKey = request.demoKey
            ? `demo:${request.demoKey}`
            : (request.filePath ?? null);
          setAppliedMatchKey(matchKey);
          setWallpaperRuntime({ status: "running", kind: request.kind, matchKey });
          if (
            request.kind === "video"
            && typeof localStorage !== "undefined"
            && !localStorage.getItem("luma.asked-startup")
          ) {
            localStorage.setItem("luma.asked-startup", "1");
            showFeedback("info", "开机自动启动 Luma，继续播放动态壁纸？", {
              source: "startup",
              persistent: true,
              startupPrompt: true,
            });
          }
        }
        showApplyStatus(result.status, result.message);
      } finally {
        applyInFlightRef.current = false;
      }
    },
    [showApplyStatus, showFeedback],
  );

  const retryLastWallpaper = useCallback(
    () => handleApplyWallpaper(null, true),
    [handleApplyWallpaper],
  );

  const handleInstallUpdate = useCallback(async () => {
    readyUpdateRef.current = null;
    showFeedback("updating", "正在准备更新…", {
      source: "update",
      persistent: true,
    });
    try {
      const result = await downloadAndInstallDesktopUpdate();
      if (result?.ok === false) {
        showFeedback("error", result.message ?? "更新失败", { source: "update" });
      }
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : "无法开始更新", {
        source: "update",
      });
    }
  }, [showFeedback]);

  const dismissUpdate = useCallback(() => {
    readyUpdateRef.current = null;
    setFeedback(null);
  }, []);

  const reopenUpdate = useCallback(() => {
    const pending = pendingUpdateRef.current;
    if (!pending) return;
    readyUpdateRef.current = pending.state === "ready" ? pending : null;
    showFeedback("success", pending.message ?? "发现新版本", {
      source: "update",
      persistent: true,
      updateState: pending,
    });
  }, [showFeedback]);

  const handleCheckForUpdates = useCallback(async () => {
    lastNoticeKeyRef.current = null;
    showFeedback("updating", "正在检查更新…", { source: "update", persistent: true });
    try {
      await checkForUpdatesDesktop();
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : "检查更新失败", {
        source: "update",
      });
    }
  }, [showFeedback]);

  const handleRetryUpdate = useCallback(async () => {
    const pending = pendingUpdateRef.current;
    if (pending?.state === "available" || pending?.state === "ready") {
      return handleInstallUpdate();
    }
    return handleCheckForUpdates();
  }, [handleInstallUpdate, handleCheckForUpdates]);

  const handleConfirmStartup = useCallback(async () => {
    try {
      await setOpenAtLoginDesktop(true);
      showFeedback("success", "已设置开机自动启动", { source: "startup" });
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : "无法设置开机自启", {
        source: "startup",
      });
    }
  }, [showFeedback]);

  useEffect(() => {
    let active = true;
    lastNoticeKeyRef.current = null;
    const handleUpdateState = (state) => {
      if (!active || !state?.state) return;
      if (state.state === "available") {
        pendingUpdateRef.current = state;
        setPendingUpdate(state);
        showFeedback("success", state.message ?? "发现新版本", {
          source: "update",
          persistent: true,
          updateState: state,
        });
      } else if (state.state === "downloading") {
        showFeedback("updating", state.message ?? "正在下载新版本…", {
          source: "update",
          persistent: true,
          updateState: state,
        });
      } else if (state.state === "ready") {
        readyUpdateRef.current = state;
        pendingUpdateRef.current = state;
        setPendingUpdate(state);
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
      } else if (state.state === "unsupported") {
        const message = state.message ?? "当前版本暂不支持自动更新，请手动下载安装新版本";
        const noticeKey = `unsupported:${state.reason ?? message}`;
        if (noticeKey === lastNoticeKeyRef.current) return;
        lastNoticeKeyRef.current = noticeKey;
        showFeedback("warning", message, {
          source: "update",
          duration: FEEDBACK_DURATION_UPDATE_ERROR_MS,
          updateState: state,
        });
      } else if (state.state === "idle" && state.lastError) {
        const noticeKey = `idle-error:${state.lastError}`;
        if (noticeKey === lastNoticeKeyRef.current) return;
        lastNoticeKeyRef.current = noticeKey;
        showFeedback("error", `更新检查失败：${state.lastError}`, {
          source: "update",
          duration: FEEDBACK_DURATION_UPDATE_ERROR_MS,
          updateState: state,
        });
      } else if (state.state === "error" && (state.message || state.lastError)) {
        const message = state.message ?? state.lastError;
        const noticeKey = `error:${message}`;
        if (noticeKey === lastNoticeKeyRef.current) return;
        lastNoticeKeyRef.current = noticeKey;
        showFeedback("error", `更新失败：${message}`, {
          source: "update",
          duration: FEEDBACK_DURATION_UPDATE_ERROR_MS,
          updateState: state,
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

  useEffect(() => {
    const unsubscribe = subscribeWallpaperRuntime((payload) => {
      const detail = typeof payload === "string" ? payload : payload?.message;
      showFeedback("error", `动态壁纸已停止${detail ? `：${detail}` : "，请重新应用"}`, {
        source: "wallpaper-runtime",
        duration: FEEDBACK_DURATION_UPDATE_ERROR_MS,
      });
    });
    return () => unsubscribe?.();
  }, [showFeedback]);

  useEffect(() => {
    const unsubscribe = subscribeWallpaperRuntimeState((state) => {
      setWallpaperRuntime(state);
      setAppliedMatchKey(state.status === "stopped" ? null : (state.matchKey ?? null));
    });
    return () => unsubscribe?.();
  }, []);

  const handleStopWallpaper = useCallback(async () => {
    window.clearTimeout(statusTimerRef.current);
    setFeedback({
      tone: "applying",
      source: "wallpaper",
      message: "正在停止动态壁纸…",
    });
    try {
      await stopDesktopWallpaper();
      setAppliedMatchKey(null);
      setHasWallpaperRecovery(false);
      setWallpaperRuntime({ status: "stopped" });
      showFeedback("success", "动态壁纸已停止", { source: "wallpaper" });
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : "无法停止动态壁纸", {
        source: "wallpaper",
      });
    }
  }, [showFeedback]);

  const handlePauseWallpaper = useCallback(async () => {
    try {
      await pauseDesktopWallpaper();
    } catch {
      // Best-effort; the runtime-state event drives the UI.
    }
  }, []);

  const handleResumeWallpaper = useCallback(async () => {
    try {
      await resumeDesktopWallpaper();
    } catch {
      // Best-effort; the runtime-state event drives the UI.
    }
  }, []);

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
    hasWallpaperRecovery,
    isConflictOpen,
    setConflictOpen,
    showFeedback,
    showUploadResult,
    handleApplyWallpaper,
    retryLastWallpaper,
    wallpaperRuntime,
    appliedMatchKey,
    handleStopWallpaper,
    handlePauseWallpaper,
    handleResumeWallpaper,
    handleInstallUpdate,
    dismissUpdate,
    pendingUpdate,
    reopenUpdate,
    handleRetryUpdate,
    handleCheckForUpdates,
    handleConfirmStartup,
  };
}
