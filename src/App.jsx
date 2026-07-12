import { useCallback, useEffect, useRef, useState } from "react";
import { ConflictDialog } from "./components/ConflictDialog.jsx";
import { ControlDock } from "./components/ControlDock.jsx";
import { DropLayer } from "./components/DropLayer.jsx";
import { MediaShelf } from "./components/MediaShelf.jsx";
import { MediaStage } from "./components/MediaStage.jsx";
import { StatusToast } from "./components/StatusToast.jsx";
import { Topbar } from "./components/Topbar.jsx";
import { useMediaLibrary } from "./hooks/useMediaLibrary.js";
import { usePlayback } from "./hooks/usePlayback.js";
import { useWallpaperStatus } from "./hooks/useWallpaperStatus.js";
import { getDesktopPlatform } from "./services/desktopWallpaper.js";

function getPlatformLabel(platform) {
  if (platform === "darwin") return "macOS 桌面端";
  if (platform === "win32") return "Windows 桌面端";
  return "Web · Windows · macOS";
}

export function App() {
  const [isFocusMode, setIsFocusMode] = useState(false);
  const stageRef = useRef(null);

  // Hook chain is dependency-ordered and acyclic: status has no args (media is
  // passed to handleApplyWallpaper at the call site), library consumes status's
  // feedback helpers, and playback consumes library's derived media.
  const {
    feedback,
    applyState,
    isConflictOpen,
    setConflictOpen,
    showFeedback,
    showUploadResult,
    handleApplyWallpaper,
    handleInstallUpdate,
    dismissUpdate,
  } = useWallpaperStatus();

  const {
    items,
    media,
    selectedId,
    setSelectedId,
    activeCategory,
    setActiveCategory,
    isLibraryOpen,
    setLibraryOpen,
    isDragging,
    fileInputRef,
    addBrowserFiles,
    openFilePicker,
    toggleFavorite,
    handleDrop,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
  } = useMediaLibrary({ showFeedback, showUploadResult });

  const {
    isPlaying,
    muted,
    duration,
    currentTime,
    progress,
    videoRef,
    togglePlayback,
    toggleMuted,
    seek,
    handleLoadedMetadata,
    handleTimeUpdate,
    handlePlay,
    handlePause,
  } = usePlayback({ media });

  const platform = getDesktopPlatform();

  const toggleFullscreen = useCallback(async () => {
    setLibraryOpen(false);
    setIsFocusMode((value) => !value);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await stageRef.current?.requestFullscreen();
      }
    } catch {
      // Fullscreen can be declined by the browser; the preview remains usable.
    }
  }, [setLibraryOpen]);

  // Esc exits focus mode and the conflict dialog; Space toggles playback
  // unless an input/button is focused.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsFocusMode(false);
        setConflictOpen(false);
      }
      const tag = event.target?.tagName;
      if (event.code !== "Space" || tag === "INPUT" || tag === "BUTTON") return;
      event.preventDefault();
      togglePlayback();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlayback, setConflictOpen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) setIsFocusMode(false);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  return (
    <main
      ref={stageRef}
      className={`app-shell ${isDragging ? "is-dragging" : ""} ${isFocusMode ? "is-focus-mode" : ""} ${isLibraryOpen ? "has-library-open" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <MediaStage
        media={media}
        videoRef={videoRef}
        muted={muted}
        isPlaying={isPlaying}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={handlePlay}
        onPause={handlePause}
        onVideoError={() =>
          showFeedback("error", "视频无法预览，可能是不支持的编码", { source: "upload" })
        }
        onImageError={() =>
          showFeedback("error", "图片无法预览，请检查文件格式", { source: "upload" })
        }
      />

      <div className="ambient-shade" aria-hidden="true" />

      <Topbar
        isLibraryOpen={isLibraryOpen}
        onToggleLibrary={() => setLibraryOpen((value) => !value)}
        onUpload={openFilePicker}
        platformLabel={getPlatformLabel(platform)}
      />

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*,video/*"
        multiple
        tabIndex="-1"
        aria-hidden="true"
        onChange={(event) => {
          addBrowserFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <StatusToast
        feedback={feedback}
        platform={platform}
        onReportConflict={() => setConflictOpen(true)}
        onInstallUpdate={handleInstallUpdate}
        onDismissUpdate={dismissUpdate}
      />

      <div className="file-name" title={media.name}>
        {media.name}
      </div>

      {isLibraryOpen ? (
        <MediaShelf
          items={items}
          selectedId={selectedId}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          onSelect={setSelectedId}
          onToggleFavorite={toggleFavorite}
          onUpload={openFilePicker}
        />
      ) : null}

      <ControlDock
        isPlaying={isPlaying}
        onTogglePlay={togglePlayback}
        currentTime={currentTime}
        duration={duration}
        progress={progress}
        onSeek={seek}
        muted={muted}
        onToggleMute={toggleMuted}
        onToggleFullscreen={toggleFullscreen}
        applyState={applyState}
        onApply={() => handleApplyWallpaper(media, false)}
      />

      {isConflictOpen ? (
        <ConflictDialog
          applyState={applyState}
          onClose={() => setConflictOpen(false)}
          onRetry={() => handleApplyWallpaper(media, true)}
        />
      ) : null}

      <DropLayer visible={isDragging} />

      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {isDragging
          ? "可以松开鼠标上传图片或视频"
          : feedback?.source === "upload"
            ? feedback.message
            : ""}
      </div>
    </main>
  );
}
