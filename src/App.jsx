import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  ArrowsOutIcon,
  CheckIcon,
  CloudArrowUpIcon,
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
  const [statusMessage, setStatusMessage] = useState("");
  const [isConflictOpen, setConflictOpen] = useState(() => (
    import.meta.env.DEV
      && new URLSearchParams(window.location.search).get("previewState") === "conflict"
  ));

  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const objectUrlsRef = useRef(new Set());
  const statusTimerRef = useRef(null);

  const media = items.find((item) => item.id === selectedId) ?? items[0];
  const platform = getDesktopPlatform();

  const progress = useMemo(
    () => (duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0),
    [currentTime, duration],
  );

  const showStatus = useCallback((state, message) => {
    window.clearTimeout(statusTimerRef.current);
    setApplyState(state);
    setStatusMessage(message);
    statusTimerRef.current = window.setTimeout(() => {
      setApplyState("idle");
      setStatusMessage("");
    }, state === "success" ? 7200 : 4600);
  }, []);

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
    const nextItems = Array.from(fileList ?? [])
      .filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"))
      .map((file) => {
        const src = URL.createObjectURL(file);
        objectUrlsRef.current.add(src);
        return {
          id: createId(),
          src,
          name: file.name,
          kind: file.type.startsWith("video/") ? "video" : "image",
          favorite: false,
          objectUrl: true,
          isDemo: false,
          file,
        };
      });

    if (!nextItems.length) return;
    setItems((previous) => [...previous, ...nextItems]);
    selectMedia(nextItems[0].id, nextItems);
    setLibraryOpen(true);
  }, [selectMedia]);

  const addDesktopFiles = useCallback((files) => {
    const nextItems = (files ?? []).map((file) => ({
      id: createId(),
      src: file.url,
      name: file.name,
      kind: file.kind,
      favorite: false,
      objectUrl: false,
      isDemo: false,
      filePath: file.path,
    }));

    if (!nextItems.length) return;
    setItems((previous) => [...previous, ...nextItems]);
    selectMedia(nextItems[0].id, nextItems);
    setLibraryOpen(true);
  }, [selectMedia]);

  const openFilePicker = useCallback(async () => {
    try {
      const desktopFiles = await pickDesktopMedia();
      if (desktopFiles !== null) {
        addDesktopFiles(desktopFiles);
        return;
      }
    } catch (error) {
      showStatus("error", error instanceof Error ? error.message : "无法打开文件");
      return;
    }
    fileInputRef.current?.click();
  }, [addDesktopFiles, showStatus]);

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
    setStatusMessage(
      force
        ? "正在重新应用壁纸…"
        : media.kind === "video"
          ? "正在启动动态壁纸…"
          : "正在设置桌面壁纸…",
    );
    const result = await applyDesktopWallpaper(media, { force });
    if (result.status === "conflict") setConflictOpen(true);
    showStatus(result.status, result.message);
  }, [applyState, media, showStatus]);

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

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    addBrowserFiles(event.dataTransfer.files);
  };

  return (
    <main
      ref={stageRef}
      className={`app-shell ${isDragging ? "is-dragging" : ""} ${isFocusMode ? "is-focus-mode" : ""} ${isLibraryOpen ? "has-library-open" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
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
          />
        ) : (
          <img
            key={media.src}
            className={`wallpaper-media wallpaper-image ${isPlaying ? "is-playing" : ""}`}
            src={media.src}
            alt="用户上传的壁纸预览"
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

      {statusMessage ? (
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
          className={`status-toast liquid-glass is-${applyState}`}
          role="status"
          aria-live="polite"
        >
          {applyState === "applying" && <SpinnerGapIcon size={19} weight="bold" aria-hidden="true" />}
          {applyState === "success" && <CheckIcon size={19} weight="bold" aria-hidden="true" />}
          {(applyState === "error" || applyState === "unsupported" || applyState === "conflict") && (
            <WarningCircleIcon size={19} weight="bold" aria-hidden="true" />
          )}
          <span>{statusMessage}</span>
          {applyState === "success" && platform ? (
            <button className="status-action" type="button" onClick={() => setConflictOpen(true)}>
              未生效？
            </button>
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
        <div className="drop-message liquid-glass">
          <CloudArrowUpIcon size={30} weight="regular" aria-hidden="true" />
          <span>松开即可加入媒体库</span>
        </div>
      </div>
    </main>
  );
}
