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
  if (platform === "darwin") return "macOS 桌面端 · 当前设置主屏幕";
  if (platform === "win32") return "Windows 桌面端 · 当前设置主屏幕";
  return "Web 预览模式";
}

export function App() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stageRef = useRef(null);

  // Hook chain is dependency-ordered and acyclic: status has no args (media is
  // passed to handleApplyWallpaper at the call site), library consumes status's
  // feedback helpers, and playback consumes library's derived media.
  const {
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
  } = useWallpaperStatus();

  const {
    items,
    media,
    isHydrated,
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
    removeMedia,
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
    handleVideoError,
  } = usePlayback({ media });

  const platform = getDesktopPlatform();

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        if (!stageRef.current?.requestFullscreen) throw new Error("fullscreen-unavailable");
        await stageRef.current.requestFullscreen();
        setLibraryOpen(false);
      }
    } catch {
      showFeedback("warning", "无法进入全屏，请检查浏览器或系统权限", {
        source: "preview",
      });
    }
  }, [setLibraryOpen, showFeedback]);

  // Esc closes the shelf; the modal owns its own Escape handling and focus
  // trap. Space toggles video playback unless an interactive control is active.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setLibraryOpen(false);
      }
      if (event.code !== "Space" || isConflictOpen) return;
      if (event.target instanceof Element) {
        const interactive = event.target.closest(
          'button, input, select, textarea, a, [contenteditable="true"], [role="button"]',
        );
        if (interactive) return;
      }
      event.preventDefault();
      togglePlayback();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isConflictOpen, setLibraryOpen, togglePlayback]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === stageRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  return (
    <main
      ref={stageRef}
      className={`app-shell ${isDragging ? "is-dragging" : ""} ${isFullscreen ? "is-focus-mode" : ""} ${isLibraryOpen ? "has-library-open" : ""}`}
      onDragEnter={isConflictOpen ? undefined : handleDragEnter}
      onDragOver={isConflictOpen ? undefined : handleDragOver}
      onDragLeave={isConflictOpen ? undefined : handleDragLeave}
      onDrop={isConflictOpen ? undefined : handleDrop}
    >
      <MediaStage
        media={media}
        videoRef={videoRef}
        muted={muted}
        isApplied={Boolean(
          appliedMatchKey
            && media
            && ((media.demoKey ? `demo:${media.demoKey}` : media.filePath) === appliedMatchKey),
        )}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={handlePlay}
        onPause={handlePause}
        onVideoError={() => {
          handleVideoError();
          showFeedback("error", "视频无法预览，可能是不支持的编码", {
            source: "upload",
          });
        }}
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
        pendingUpdate={pendingUpdate}
        onReopenUpdate={reopenUpdate}
        isLibraryReady={isHydrated}
        inert={isFullscreen || isConflictOpen}
      />

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*,video/*"
        multiple
        disabled={!isHydrated}
        tabIndex="-1"
        aria-hidden="true"
        onChange={(event) => {
          void addBrowserFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <StatusToast
        feedback={feedback}
        platform={platform}
        hasWallpaperRecovery={hasWallpaperRecovery}
        wallpaperRuntime={wallpaperRuntime}
        onReportConflict={() => setConflictOpen(true)}
        onStopWallpaper={handleStopWallpaper}
        onPauseWallpaper={handlePauseWallpaper}
        onResumeWallpaper={handleResumeWallpaper}
        onInstallUpdate={handleInstallUpdate}
        onDismissUpdate={dismissUpdate}
        onRetryUpdate={handleRetryUpdate}
        onCheckForUpdates={handleCheckForUpdates}
        inert={isFullscreen || isConflictOpen}
      />

      <div className="file-name" title={media.name} aria-hidden="true">
        {media.name}
      </div>

      {isLibraryOpen ? (
        <MediaShelf
          items={items}
          selectedId={selectedId}
          activeCategory={activeCategory}
          appliedMatchKey={appliedMatchKey}
          onCategoryChange={setActiveCategory}
          onSelect={setSelectedId}
          onToggleFavorite={toggleFavorite}
          onRemove={removeMedia}
          onUpload={openFilePicker}
          isReady={isHydrated}
          inert={isConflictOpen}
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
        isFullscreen={isFullscreen}
        mediaKind={media.kind}
        platform={platform}
        applyState={applyState}
        onApply={() => handleApplyWallpaper(media, false)}
        inert={isConflictOpen}
      />

      {isConflictOpen ? (
        <ConflictDialog
          applyState={applyState}
          onClose={() => setConflictOpen(false)}
          onRetry={retryLastWallpaper}
        />
      ) : null}

      <DropLayer visible={isDragging} />

      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {isConflictOpen
          ? ""
          : isDragging
            ? "可以松开鼠标上传图片或视频"
            : (feedback?.message ?? "")}
      </div>
    </main>
  );
}
