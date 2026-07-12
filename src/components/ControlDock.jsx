import {
  ArrowsInIcon,
  ArrowsOutIcon,
  MonitorArrowUpIcon,
  PauseIcon,
  PlayIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { GlassSurface } from "./GlassSurface.jsx";
import { GLASS_CONTROL_DOCK } from "./glassPresets.js";

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return "00:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function ControlDock({
  isPlaying,
  onTogglePlay,
  currentTime,
  duration,
  progress,
  onSeek,
  muted,
  onToggleMute,
  onToggleFullscreen,
  isFullscreen,
  mediaKind,
  platform,
  applyState,
  onApply,
  inert = false,
}) {
  const isApplying = applyState === "applying";
  const isVideo = mediaKind === "video";
  const isDesktop = platform === "darwin" || platform === "win32";

  return (
    <GlassSurface
      {...GLASS_CONTROL_DOCK}
      as="section"
      className="control-dock liquid-glass"
      aria-label="预览控制"
      aria-hidden={inert || undefined}
      inert={inert}
    >
      <button
        className="round-control play-control"
        type="button"
        onClick={onTogglePlay}
        disabled={!isVideo}
        aria-label={!isVideo ? "静态图片无需播放" : isPlaying ? "暂停预览" : "播放预览"}
      >
        {isPlaying ? (
          <PauseIcon size={29} weight="fill" aria-hidden="true" />
        ) : (
          <PlayIcon size={29} weight="fill" aria-hidden="true" />
        )}
      </button>

      <span className="timecode">
        {isVideo ? `${formatTime(currentTime)} / ${formatTime(duration)}` : "静态图片"}
      </span>

      <input
        className="progress-slider"
        type="range"
        min="0"
        max={isVideo ? Math.max(duration, 0.1) : 1}
        step="0.01"
        value={isVideo ? Math.min(currentTime, duration || 0) : 0}
        onInput={onSeek}
        onChange={onSeek}
        style={{ "--progress": `${progress}%` }}
        aria-label="预览进度"
        disabled={!isVideo}
      />

      <button
        className="round-control volume-control"
        type="button"
        onClick={onToggleMute}
        disabled={!isVideo}
        aria-label={!isVideo ? "静态图片没有声音" : muted ? "打开声音" : "静音"}
      >
        {muted ? (
          <SpeakerSlashIcon size={26} weight="regular" aria-hidden="true" />
        ) : (
          <SpeakerHighIcon size={26} weight="regular" aria-hidden="true" />
        )}
      </button>

      <button
        className="fullscreen-control"
        type="button"
        onClick={onToggleFullscreen}
        aria-label={isFullscreen ? "退出全屏预览" : "进入全屏预览"}
      >
        {isFullscreen ? (
          <ArrowsInIcon className="fullscreen-icon" size={24} weight="regular" aria-hidden="true" />
        ) : (
          <ArrowsOutIcon
            className="fullscreen-icon"
            size={24}
            weight="regular"
            aria-hidden="true"
          />
        )}
        <span className="fullscreen-label">{isFullscreen ? "退出全屏" : "全屏预览"}</span>
      </button>

      <button
        className={`apply-button ${isApplying ? "is-applying" : ""} ${!isDesktop ? "is-web-only" : ""}`}
        type="button"
        onClick={onApply}
        disabled={isApplying || !isDesktop}
        aria-label={isDesktop ? "设为壁纸" : "仅 macOS 和 Windows 桌面端可以设置壁纸"}
        title={isDesktop ? undefined : "浏览器可管理和预览；设置壁纸请使用桌面端"}
      >
        {isApplying ? (
          <SpinnerGapIcon size={22} weight="bold" aria-hidden="true" />
        ) : (
          <MonitorArrowUpIcon size={22} weight="regular" aria-hidden="true" />
        )}
        <span>{isDesktop ? "设为壁纸" : "桌面端可设置"}</span>
      </button>
    </GlassSurface>
  );
}
