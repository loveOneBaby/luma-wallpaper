import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  ArrowsOutIcon,
  CheckIcon,
  CloudArrowUpIcon,
  DownloadSimpleIcon,
  MonitorArrowUpIcon,
  PauseIcon,
  PlayIcon,
  PowerIcon,
  SpinnerGapIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  SquaresFourIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import demoImage from "./assets/ocean-morning.png";
import demoVideo from "./assets/ocean-morning.mp4";
import { GlassSurface } from "./components/GlassSurface.jsx";
import { MediaShelf } from "./components/MediaShelf.jsx";
import {
  applyDesktopWallpaper,
  getDesktopPlatform,
  pickDesktopMedia,
} from "./services/desktopWallpaper.js";
import {
  getDesktopUpdateState,
  installDesktopUpdate,
  resolveDroppedDesktopMedia,
  subscribeDesktopUpdates,
} from "./services/desktopUpdates.js";

const IMAGE_EXTENSIONS = new Set([
  "avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "tif", "tiff", "webp",
]);
const VIDEO_EXTENSIONS = new Set(["avi", "m4v", "mkv", "mov", "mp4", "webm", "wmv"]);

const DEMO_ITEMS = [
  {
    id: "demo-video",
    src: demoVideo,
    name: "海岸晨光 · 动态",
    kind: "video",
    favorite: true,
    objectUrl: false,
    isDemo: true,
    demoKey: "ocean-morning-video",
    sourceKey: "demo:ocean-morning-video",
  },
  {
    id: "demo-image",
    src: demoImage,
    name: "海岸晨光 · 静态",
    kind: "image",
    favorite: false,
    objectUrl: false,
    isDemo: true,
    demoKey: "ocean-morning-image",
    sourceKey: "demo:ocean-morning-image",
  },
];

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return "00:00";

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getPlatformLabel(platform) {
  if (platform === "darwin") return "macOS 桌面端";
  if (platform === "win32") return "Windows 桌面端";
  return "Web · Windows · macOS";
}

function browserMediaKind(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) return null;
  const extension = file.name?.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

function browserSourceKey(file, kind) {
  return `browser:${kind}:${file.name.toLowerCase()}:${file.size}:${file.lastModified ?? 0}`;
}

export function App() {
  const [items, setItems] = useState(DEMO_ITEMS);
  const [selectedId, setSelectedId] = useState(DEMO_ITEMS[0].id);
  const [activeCategory, setActiveCategory] = useState("all");
  const [isLibraryOpen, setLibraryOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [duration, setDuration] = useState(20);
  const [currentTime, setCurrentTime] = useState(6);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [applyState, setApplyState] = useState("idle");
  const [feedback, setFeedback] = useState(null);
  const [isConflictOpen, setConflictOpen] = useState(() => (
    import.meta.env.DEV
      && new URLSearchParams(window.location.search).get("previewState") === "conflict"
  ));

  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const objectUrlsRef = useRef(new Set());
  const statusTimerRef = useRef(null);
  const dragDepthRef = useRef(0);
  const readyUpdateRef = useRef(null);

  const media = items.find((item) => item.id === selectedId) ?? items[0];
  const platform = getDesktopPlatform();

  const progress = useMemo(
    () => (duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0),
    [currentTime, duration],
  );

  const showFeedback = useCallback((tone, message, options = {}) => {
    const source = options.source ?? "system";
    const duration = options.persistent
      ? null
      : options.duration ?? (tone === "success" ? 6200 : 4800);
    window.clearTimeout(statusTimerRef.current);
    if (source !== "wallpaper") {
      setApplyState((state) => (state === "applying" ? state : "idle"));
    }
    setFeedback({ tone, message, source, ...options });
    if (duration !== null) {
      statusTimerRef.current = window.setTimeout(() => {
        if (source === "wallpaper") setApplyState("idle");
        const readyUpdate = readyUpdateRef.current;
        setFeedback(readyUpdate ? {
          tone: "success",
          message: readyUpdate.message ?? "新版本已准备好",
          source: "update",
          persistent: true,
          updateState: readyUpdate,
        } : null);
      }, duration);
    }
  }, []);

  const showApplyStatus = useCallback((state, message, options = {}) => {
    setApplyState(state);
    showFeedback(state, message, { ...options, source: "wallpaper" });
  }, [showFeedback]);

  const showUploadResult = useCallback(({ added, duplicates = 0, rejected = 0 }) => {
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
  }, [showFeedback]);

  const selectMedia = useCallback((id, nextItems = null) => {
    const source = nextItems ?? items;
    const nextMedia = source.find((item) => item.id === id);
    if (!nextMedia) return;

    setSelectedId(id);
    setCurrentTime(nextMedia.isDemo && nextMedia.kind === "video" ? 6 : 0);
    setDuration(nextMedia.kind === "image" ? 20 : 0);
    setMuted(true);
    setIsPlaying(true);
  }, [items]);

  const addBrowserFiles = useCallback((fileList) => {
    const existingKeys = new Set(items.map((item) => item.sourceKey).filter(Boolean));
    const batchKeys = new Set();
    const nextItems = [];
    let duplicates = 0;
    let rejected = 0;

    for (const file of Array.from(fileList ?? [])) {
      const kind = browserMediaKind(file);
      if (!kind) {
        rejected += 1;
        continue;
      }
      const sourceKey = browserSourceKey(file, kind);
      if (existingKeys.has(sourceKey) || batchKeys.has(sourceKey)) {
        duplicates += 1;
        continue;
      }
      batchKeys.add(sourceKey);
      const src = URL.createObjectURL(file);
      objectUrlsRef.current.add(src);
      nextItems.push({
        id: createId(),
        src,
        name: file.name,
        kind,
        favorite: false,
        objectUrl: true,
        isDemo: false,
        sourceKey,
        file,
      });
    }

    showUploadResult({ added: nextItems.length, duplicates, rejected });
    if (!nextItems.length) return;
    setItems((previous) => [...previous, ...nextItems]);
    selectMedia(nextItems[0].id, nextItems);
    setLibraryOpen(true);
  }, [items, selectMedia, showUploadResult]);

  const addDesktopFiles = useCallback((files, counts = {}) => {
    const existingKeys = new Set(items.map((item) => item.sourceKey).filter(Boolean));
    const batchKeys = new Set();
    let duplicates = counts.duplicateCount ?? 0;
    const nextItems = [];

    for (const file of files ?? []) {
      const sourceKey = `desktop:${file.identity ?? file.path}`;
      if (existingKeys.has(sourceKey) || batchKeys.has(sourceKey)) {
        duplicates += 1;
        continue;
      }
      batchKeys.add(sourceKey);
      nextItems.push({
        id: createId(),
        src: file.url,
        name: file.name,
        kind: file.kind,
        favorite: false,
        objectUrl: false,
        isDemo: false,
        sourceKey,
        filePath: file.path,
      });
    }

    showUploadResult({
      added: nextItems.length,
      duplicates,
      rejected: counts.rejectedCount ?? 0,
    });
    if (!nextItems.length) return;
    setItems((previous) => [...previous, ...nextItems]);
    selectMedia(nextItems[0].id, nextItems);
    setLibraryOpen(true);
  }, [items, selectMedia, showUploadResult]);

  const openFilePicker = useCallback(async () => {
    try {
      const desktopFiles = await pickDesktopMedia();
      if (desktopFiles !== null) {
        if (desktopFiles.length > 0) addDesktopFiles(desktopFiles);
        return;
      }
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : "无法打开文件", {
        source: "upload",
      });
      return;
    }
    fileInputRef.current?.click();
  }, [addDesktopFiles, showFeedback]);

  const togglePlayback = useCallback(() => {
    setIsPlaying((value) => !value);
  }, []);

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
  }, []);

  const handleApplyWallpaper = useCallback(async (force = false) => {
    if (applyState === "applying") return;
    window.clearTimeout(statusTimerRef.current);
    if (force) setConflictOpen(false);
    setApplyState("applying");
    setFeedback({
      tone: "applying",
      source: "wallpaper",
      message:
        force
          ? "正在重新应用壁纸…"
          : media.kind === "video"
            ? "正在启动动态壁纸…"
            : "正在设置桌面壁纸…",
    });
    const result = await applyDesktopWallpaper(media, { force });
    if (result.status === "conflict") setConflictOpen(true);
    showApplyStatus(result.status, result.message);
  }, [applyState, media, showApplyStatus]);

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
        showFeedback("error", `更新失败：${state.message}`, { source: "update", duration: 7200 });
      }
    };

    const unsubscribe = subscribeDesktopUpdates(handleUpdateState);
    getDesktopUpdateState().then(handleUpdateState).catch(() => {});
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [showFeedback]);

  useEffect(() => {
    if (media.kind !== "video" || !videoRef.current) return;

    videoRef.current.muted = muted;
    if (isPlaying) {
      videoRef.current.play().catch(() => setIsPlaying(false));
    } else {
      videoRef.current.pause();
    }
  }, [isPlaying, media, muted]);

  useEffect(() => {
    if (media.kind !== "image" || !isPlaying) return undefined;

    const timer = window.setInterval(() => {
      setCurrentTime((value) => (value + 0.1 >= 20 ? 0 : value + 0.1));
    }, 100);

    return () => window.clearInterval(timer);
  }, [isPlaying, media.kind]);

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
  }, [togglePlayback]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) setIsFocusMode(false);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(statusTimerRef.current);
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  const handleLoadedMetadata = (event) => {
    const video = event.currentTarget;
    setDuration(video.duration || 20);
    if (media.isDemo) {
      video.currentTime = Math.min(6, video.duration || 6);
      setCurrentTime(video.currentTime);
    }
    video.muted = muted;
    if (isPlaying) video.play().catch(() => setIsPlaying(false));
  };

  const handleSeek = (event) => {
    const nextTime = Number(event.target.value);
    setCurrentTime(nextTime);
    if (media.kind === "video" && videoRef.current) {
      videoRef.current.currentTime = nextTime;
    }
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (!files.length) return;

    try {
      const desktopResult = await resolveDroppedDesktopMedia(files);
      if (desktopResult !== null) {
        addDesktopFiles(desktopResult.files, desktopResult);
        return;
      }
      addBrowserFiles(files);
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : "无法导入拖入的素材", {
        source: "upload",
      });
    }
  };

  const handleDragEnter = (event) => {
    event.preventDefault();
    if (!event.dataTransfer.types?.includes("Files")) return;
    dragDepthRef.current += 1;
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    if (!event.dataTransfer.types?.includes("Files")) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  };

  return (
    <main
      ref={stageRef}
      className={`app-shell ${isDragging ? "is-dragging" : ""} ${isFocusMode ? "is-focus-mode" : ""} ${isLibraryOpen ? "has-library-open" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer.types?.includes("Files")) event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="media-stage" aria-label={`${media.name} 预览`}>
        {media.kind === "video" ? (
          <video
            key={media.src}
            ref={videoRef}
            className="wallpaper-media"
            src={media.src}
            muted={muted}
            loop
            playsInline
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={() => showFeedback("error", "视频无法预览，可能是不支持的编码", {
              source: "upload",
            })}
          />
        ) : (
          <img
            key={media.src}
            className={`wallpaper-media wallpaper-image ${isPlaying ? "is-playing" : ""}`}
            src={media.src}
            alt="用户上传的壁纸预览"
            onError={() => showFeedback("error", "图片无法预览，请检查文件格式", {
              source: "upload",
            })}
          />
        )}
      </div>

      <div className="ambient-shade" aria-hidden="true" />

      <header className="topbar">
        <div className="brand">Luma</div>

        <div className="topbar-actions">
          <GlassSurface
            as="button"
            width={null}
            height={null}
            borderRadius={null}
            borderWidth={0.11}
            brightness={72}
            opacity={0.86}
            blur={8}
            displace={0.45}
            backgroundOpacity={0.04}
            saturation={1.35}
            distortionScale={-105}
            redOffset={-4}
            greenOffset={8}
            blueOffset={18}
            mixBlendMode="screen"
            className={`library-button liquid-glass ${isLibraryOpen ? "is-active" : ""}`}
            type="button"
            onClick={() => setLibraryOpen((value) => !value)}
            aria-expanded={isLibraryOpen}
            aria-label="媒体库"
          >
            <SquaresFourIcon size={21} weight={isLibraryOpen ? "fill" : "regular"} aria-hidden="true" />
            <span>媒体库</span>
          </GlassSurface>
          <GlassSurface
            as="button"
            width={null}
            height={null}
            borderRadius={null}
            borderWidth={0.1}
            brightness={70}
            opacity={0.86}
            blur={8}
            displace={0.35}
            backgroundOpacity={0.04}
            saturation={1.35}
            distortionScale={-115}
            redOffset={-3}
            greenOffset={9}
            blueOffset={19}
            mixBlendMode="screen"
            className="upload-button liquid-glass"
            type="button"
            onClick={openFilePicker}
            aria-label="上传图片或视频"
          >
            <CloudArrowUpIcon size={22} weight="regular" aria-hidden="true" />
            <span>上传图片或视频</span>
          </GlassSurface>
          <span className="platforms">{getPlatformLabel(platform)}</span>
        </div>
      </header>

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

      {feedback?.message ? (
        <GlassSurface
          width={null}
          height={null}
          borderRadius={null}
          borderWidth={0.1}
          brightness={68}
          opacity={0.84}
          blur={9}
          backgroundOpacity={0.05}
          saturation={1.35}
          distortionScale={-100}
          redOffset={-2}
          greenOffset={8}
          blueOffset={17}
          mixBlendMode="screen"
          className={`status-toast liquid-glass is-${feedback.tone}`}
          role="status"
          aria-live="polite"
        >
          {(feedback.tone === "applying" || feedback.tone === "installing") && (
            <SpinnerGapIcon size={19} weight="bold" aria-hidden="true" />
          )}
          {feedback.tone === "updating" && (
            <DownloadSimpleIcon size={19} weight="bold" aria-hidden="true" />
          )}
          {(feedback.tone === "success" || feedback.tone === "info") && (
            <CheckIcon size={19} weight="bold" aria-hidden="true" />
          )}
          {(
            feedback.tone === "error"
            || feedback.tone === "unsupported"
            || feedback.tone === "conflict"
            || feedback.tone === "warning"
          ) && (
            <WarningCircleIcon size={19} weight="bold" aria-hidden="true" />
          )}
          <span>{feedback.message}</span>
          {feedback.source === "wallpaper" && feedback.tone === "success" && platform ? (
            <button className="status-action" type="button" onClick={() => setConflictOpen(true)}>
              未生效？
            </button>
          ) : null}
          {feedback.source === "update" && feedback.updateState?.state === "ready" ? (
            <>
              <button className="status-action status-update" type="button" onClick={handleInstallUpdate}>
                重启并更新
              </button>
              <button
                className="status-dismiss"
                type="button"
                onClick={() => {
                  readyUpdateRef.current = null;
                  setFeedback(null);
                }}
                aria-label="稍后更新"
              >
                <XIcon size={15} weight="bold" aria-hidden="true" />
              </button>
            </>
          ) : null}
        </GlassSurface>
      ) : null}

      <div className="file-name" title={media.name}>
        {media.name}
      </div>

      {isLibraryOpen ? (
        <MediaShelf
          items={items}
          selectedId={selectedId}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          onSelect={selectMedia}
          onToggleFavorite={(id) => {
            setItems((previous) => previous.map((item) => (
              item.id === id ? { ...item, favorite: !item.favorite } : item
            )));
          }}
          onUpload={openFilePicker}
        />
      ) : null}

      <GlassSurface
        as="section"
        width={null}
        height={null}
        borderRadius={null}
        borderWidth={0.09}
        brightness={64}
        opacity={0.9}
        blur={11}
        displace={0.65}
        backgroundOpacity={0.035}
        saturation={1.42}
        distortionScale={-155}
        redOffset={-6}
        greenOffset={10}
        blueOffset={22}
        mixBlendMode="screen"
        className="control-dock liquid-glass"
        aria-label="预览控制"
      >
        <button
          className="round-control play-control"
          type="button"
          onClick={togglePlayback}
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
          onInput={handleSeek}
          onChange={handleSeek}
          style={{ "--progress": `${progress}%` }}
          aria-label="预览进度"
        />

        <button
          className="round-control volume-control"
          type="button"
          onClick={() => setMuted((value) => !value)}
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
          onClick={toggleFullscreen}
          aria-label="全屏预览"
        >
          <ArrowsOutIcon className="fullscreen-icon" size={24} weight="regular" aria-hidden="true" />
          <span className="fullscreen-label">全屏预览</span>
        </button>

        <button
          className={`apply-button ${applyState === "applying" ? "is-applying" : ""}`}
          type="button"
          onClick={() => handleApplyWallpaper(false)}
          disabled={applyState === "applying"}
          aria-label="设为壁纸"
        >
          {applyState === "applying" ? (
            <SpinnerGapIcon size={22} weight="bold" aria-hidden="true" />
          ) : (
            <MonitorArrowUpIcon size={22} weight="regular" aria-hidden="true" />
          )}
          <span>设为壁纸</span>
        </button>
      </GlassSurface>

      {isConflictOpen ? (
        <div
          className="conflict-layer"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setConflictOpen(false);
          }}
        >
          <GlassSurface
            as="section"
            width={null}
            height={null}
            borderRadius={null}
            borderWidth={0.085}
            brightness={67}
            opacity={0.88}
            blur={10}
            displace={0.5}
            backgroundOpacity={0.05}
            saturation={1.38}
            distortionScale={-135}
            redOffset={-4}
            greenOffset={9}
            blueOffset={20}
            mixBlendMode="screen"
            className="conflict-panel liquid-glass"
            role="dialog"
            aria-modal="true"
            aria-labelledby="conflict-title"
            aria-describedby="conflict-description"
          >
            <button
              className="conflict-close"
              type="button"
              onClick={() => setConflictOpen(false)}
              aria-label="关闭冲突提示"
            >
              <XIcon size={18} weight="bold" aria-hidden="true" />
            </button>

            <div className="conflict-icon" aria-hidden="true">
              <PowerIcon size={28} weight="duotone" />
            </div>

            <div className="conflict-copy">
              <span className="conflict-eyebrow">WALLPAPER CHECK</span>
              <h2 id="conflict-title">壁纸没有生效？</h2>
              <p id="conflict-description">
                其他壁纸软件可能占用了桌面层。请完全退出后，再重新应用当前壁纸。
              </p>
            </div>

            <div className="conflict-actions">
              <button className="conflict-later" type="button" onClick={() => setConflictOpen(false)}>
                稍后处理
              </button>
              <button
                className="conflict-retry"
                type="button"
                onClick={() => handleApplyWallpaper(true)}
                disabled={applyState === "applying"}
                autoFocus
              >
                {applyState === "applying" ? (
                  <SpinnerGapIcon size={19} weight="bold" aria-hidden="true" />
                ) : (
                  <ArrowClockwiseIcon size={19} weight="bold" aria-hidden="true" />
                )}
                <span>我已退出，重新应用</span>
              </button>
            </div>
          </GlassSurface>
        </div>
      ) : null}

      <div className="drop-layer" aria-hidden={!isDragging}>
        <GlassSurface
          width={null}
          height={null}
          borderRadius={null}
          borderWidth={0.08}
          brightness={70}
          opacity={0.9}
          blur={10}
          displace={0.62}
          backgroundOpacity={0.045}
          saturation={1.4}
          distortionScale={-150}
          redOffset={-5}
          greenOffset={10}
          blueOffset={21}
          mixBlendMode="screen"
          className="drop-message liquid-glass"
        >
          <div className="drop-icon" aria-hidden="true">
            <CloudArrowUpIcon size={31} weight="regular" />
          </div>
          <div className="drop-copy">
            <strong>松开即可加入媒体库</strong>
            <span>支持图片与视频，可一次拖入多个文件</span>
          </div>
        </GlassSurface>
      </div>

      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {isDragging ? "可以松开鼠标上传图片或视频" : feedback?.source === "upload" ? feedback.message : ""}
      </div>
    </main>
  );
}
