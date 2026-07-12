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
  onReportConflict,
  onInstallUpdate,
  onDismissUpdate,
}) {
  if (!feedback?.message) return null;

  const isBusy = feedback.tone === "applying" || feedback.tone === "installing";
  const isPositive = feedback.tone === "success" || feedback.tone === "info";
  const isWarning =
    feedback.tone === "error" ||
    feedback.tone === "unsupported" ||
    feedback.tone === "conflict" ||
    feedback.tone === "warning";

  const showRecovery = feedback.source === "wallpaper" && feedback.tone === "success" && platform;
  const showUpdateActions = feedback.source === "update" && feedback.updateState?.state === "ready";

  return (
    <GlassSurface
      {...GLASS_STATUS_TOAST}
      className={`status-toast liquid-glass is-${feedback.tone}`}
      role="status"
      aria-live="polite"
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
            重启并更新
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
    </GlassSurface>
  );
}
