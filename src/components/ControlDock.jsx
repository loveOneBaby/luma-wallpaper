import {
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
  applyState,
  onApply,
}) {
  const isApplying = applyState === "applying";

  return (
    <GlassSurface
      {...GLASS_CONTROL_DOCK}
      as="section"
      className="control-dock liquid-glass"
      aria-label="预览控制"
    >
      <button
        className="round-control play-control"
        type="button"
        onClick={onTogglePlay}
        aria-label={isPlaying ? "暂停预览" : "播放预览"}
      >
        {isPlaying ? (
          <PauseIcon size={29} weight="fill" aria-hidden="true" />
        ) : (
          <PlayIcon size={29} weight="fill" aria-hidden="true" />
        )}
      </button>

      <span className="timecode">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      <input
        className="progress-slider"
        type="range"
        min="0"
        max={Math.max(duration, 0.1)}
        step="0.01"
        value={Math.min(currentTime, duration || 0)}
        onInput={onSeek}
        onChange={onSeek}
        style={{ "--progress": `${progress}%` }}
        aria-label="预览进度"
      />

      <button
        className="round-control volume-control"
        type="button"
        onClick={onToggleMute}
        aria-label={muted ? "打开声音" : "静音"}
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
        aria-label="全屏预览"
      >
        <ArrowsOutIcon className="fullscreen-icon" size={24} weight="regular" aria-hidden="true" />
        <span className="fullscreen-label">全屏预览</span>
      </button>

      <button
        className={`apply-button ${isApplying ? "is-applying" : ""}`}
        type="button"
        onClick={onApply}
        disabled={isApplying}
        aria-label="设为壁纸"
      >
        {isApplying ? (
          <SpinnerGapIcon size={22} weight="bold" aria-hidden="true" />
        ) : (
          <MonitorArrowUpIcon size={22} weight="regular" aria-hidden="true" />
        )}
        <span>设为壁纸</span>
      </button>
    </GlassSurface>
  );
}
