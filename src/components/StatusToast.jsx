import {
  CheckIcon,
  DownloadSimpleIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { GlassSurface } from "./GlassSurface.jsx";
import { GLASS_STATUS_TOAST } from "./glassPresets.js";

export function StatusToast({
  feedback,
  platform,
  hasWallpaperRecovery = false,
  wallpaperRuntime = { status: "stopped" },
  onReportConflict,
  onStopWallpaper,
  onPauseWallpaper,
  onResumeWallpaper,
  onInstallUpdate,
  onDismissUpdate,
  onRetryUpdate,
  onCheckForUpdates,
  onUndoRemove,
  onConfirmStartup,
  inert = false,
}) {
  const isDesktop = platform === "darwin" || platform === "win32";
  const showPersistentRecovery = hasWallpaperRecovery && isDesktop;
  const runtimeActive =
    isDesktop && (wallpaperRuntime.status === "running" || wallpaperRuntime.status === "paused");

  if (!feedback?.message) {
    if (runtimeActive) {
      const isVideo = wallpaperRuntime.kind === "video";
      const isPaused = wallpaperRuntime.status === "paused";
      return (
        <GlassSurface
          {...GLASS_STATUS_TOAST}
          className="wallpaper-running liquid-glass"
          role="status"
          aria-hidden={inert || undefined}
          inert={inert}
        >
          <span className="applied-dot" aria-hidden="true" />
          <span>{isVideo ? (isPaused ? "动态壁纸已暂停" : "动态壁纸运行中") : "桌面壁纸已设置"}</span>
          {isVideo ? (
            <>
              <button
                className="status-action"
                type="button"
                onClick={isPaused ? onResumeWallpaper : onPauseWallpaper}
                disabled={inert}
              >
                {isPaused ? "继续" : "暂停"}
              </button>
              <button
                className="status-action"
                type="button"
                onClick={onStopWallpaper}
                disabled={inert}
              >
                停止
              </button>
            </>
          ) : null}
          {showPersistentRecovery ? (
            <button
              className="status-action"
              type="button"
              onClick={onReportConflict}
              disabled={inert}
            >
              未生效？
            </button>
          ) : null}
        </GlassSurface>
      );
    }
    if (!showPersistentRecovery) return null;
    return (
      <GlassSurface
        {...GLASS_STATUS_TOAST}
        as="button"
        className="wallpaper-recovery liquid-glass"
        type="button"
        onClick={onReportConflict}
        aria-label="壁纸未生效，打开恢复帮助"
        aria-hidden={inert || undefined}
        inert={inert}
        disabled={inert}
      >
        <WarningCircleIcon size={15} weight="regular" aria-hidden="true" />
        <span>未生效？</span>
      </GlassSurface>
    );
  }

  const isBusy = feedback.tone === "applying" || feedback.tone === "installing";
  const isPositive = feedback.tone === "success" || feedback.tone === "info";
  const isWarning =
    feedback.tone === "error" ||
    feedback.tone === "unsupported" ||
    feedback.tone === "conflict" ||
    feedback.tone === "warning";

  const showRecovery =
    feedback.source === "wallpaper" && feedback.tone === "success" && isDesktop;
  const showUpdateActions =
    feedback.source === "update"
    && (feedback.updateState?.state === "available" || feedback.updateState?.state === "ready");
  const showUpdateErrorActions =
    feedback.source === "update"
    && Boolean(feedback.updateState)
    && (feedback.tone === "error" || feedback.tone === "warning");

  return (
    <GlassSurface
      {...GLASS_STATUS_TOAST}
      className={`status-toast liquid-glass is-${feedback.tone}`}
      role="region"
      aria-label="状态通知"
      aria-hidden={inert || undefined}
      inert={inert}
    >
      {isBusy && <SpinnerGapIcon size={19} weight="bold" aria-hidden="true" />}
      {feedback.tone === "updating" && (
        <DownloadSimpleIcon size={19} weight="bold" aria-hidden="true" />
      )}
      {isPositive && <CheckIcon size={19} weight="bold" aria-hidden="true" />}
      {isWarning && <WarningCircleIcon size={19} weight="bold" aria-hidden="true" />}
      <span>{feedback.message}</span>
      {showRecovery ? (
        <button className="status-action" type="button" onClick={onReportConflict}>
          未生效？
        </button>
      ) : null}
      {showUpdateActions ? (
        <>
          <button className="status-action status-update" type="button" onClick={onInstallUpdate}>
            {feedback.updateState?.state === "available" ? "更新" : "重启并更新"}
          </button>
          <button
            className="status-dismiss"
            type="button"
            onClick={onDismissUpdate}
            aria-label="稍后更新"
          >
            <XIcon size={15} weight="bold" aria-hidden="true" />
          </button>
        </>
      ) : null}
      {showUpdateErrorActions ? (
        <>
          <button className="status-action status-update" type="button" onClick={onRetryUpdate}>
            重试
          </button>
          <button className="status-action" type="button" onClick={onCheckForUpdates}>
            手动检查
          </button>
        </>
      ) : null}
      {feedback.undoRemove && feedback.source === "library" ? (
        <button className="status-action status-update" type="button" onClick={onUndoRemove}>
          撤销
        </button>
      ) : null}
      {feedback.startupPrompt ? (
        <>
          <button className="status-action status-update" type="button" onClick={onConfirmStartup}>
            是
          </button>
          <button
            className="status-action"
            type="button"
            onClick={onDismissUpdate}
          >
            稍后
          </button>
        </>
      ) : null}
    </GlassSurface>
  );
}
