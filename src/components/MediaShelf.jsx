import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  HeartIcon,
  ImageIcon,
  PlayIcon,
  TrashIcon,
  VideoCameraIcon,
} from "@phosphor-icons/react";
import { GlassSurface } from "./GlassSurface.jsx";
import { GLASS_MEDIA_SHELF } from "./glassPresets.js";

const CATEGORIES = [
  { id: "all", label: "全部" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "favorite", label: "收藏" },
];

const VIRTUALIZATION_THRESHOLD = 80;
const VIRTUAL_OVERSCAN = 8;
const DESKTOP_TILE_EXTENT = 167;
const COMPACT_TILE_EXTENT = 149;
const MAX_POSTER_CACHE_ENTRIES = 120;
const posterCache = new Map();

function cachePoster(key, poster) {
  if (!key || !poster) return;
  posterCache.delete(key);
  posterCache.set(key, poster);
  while (posterCache.size > MAX_POSTER_CACHE_ENTRIES) {
    posterCache.delete(posterCache.keys().next().value);
  }
}

function LazyVideoPreview({ item }) {
  const previewRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const posterKey = item.sourceKey ?? item.id;
  const [poster, setPoster] = useState(() => item.poster ?? posterCache.get(posterKey));

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(Boolean(entry?.isIntersecting));
      },
      { rootMargin: "160px" },
    );
    observer.observe(preview);
    return () => observer.disconnect();
  }, []);

  const shouldLoad = isVisible && !poster;

  useEffect(() => {
    const video = previewRef.current;
    if (!video || shouldLoad) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }, [shouldLoad]);

  const capturePoster = () => {
    const video = previewRef.current;
    if (!video || poster || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 312;
      canvas.height = 224;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const nextPoster = canvas.toDataURL("image/webp", 0.72);
      cachePoster(posterKey, nextPoster);
      setPoster(nextPoster);
    } catch {
      // Custom desktop schemes or browser privacy rules may make the canvas
      // origin-unclean. The paused video remains a valid visible fallback.
    }
  };

  return (
    <video
      ref={previewRef}
      className="media-tile-preview"
      src={shouldLoad ? item.src : undefined}
      poster={poster}
      muted
      playsInline
      preload={shouldLoad ? "metadata" : "none"}
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = Math.min(0.1, video.duration / 2);
        }
      }}
      onLoadedData={capturePoster}
      onSeeked={capturePoster}
      aria-hidden="true"
    />
  );
}

const MediaTile = memo(function MediaTile({
  item,
  isSelected,
  isApplied = false,
  missing = false,
  onSelect,
  onToggleFavorite,
  onRemove,
  onRelocate,
  disabled,
}) {
  return (
    <article className={`media-tile ${isSelected ? "is-selected" : ""} ${isApplied ? "is-applied" : ""} ${missing ? "is-missing" : ""}`}>
      {isApplied ? (
        <span className="applied-badge" aria-label="正在使用">
          <span className="applied-dot" aria-hidden="true" />
          正在使用
        </span>
      ) : null}
      <button
        className="media-tile-select"
        type="button"
        onClick={() => onSelect(item.id)}
        disabled={disabled}
        aria-current={isSelected ? "true" : undefined}
        aria-label={`预览 ${item.name}`}
      >
        {item.kind === "video" ? (
          <LazyVideoPreview item={item} />
        ) : (
          <img
            className="media-tile-preview"
            src={item.src}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
        <span className="media-kind-badge" aria-hidden="true">
          {item.kind === "video" ? (
            <PlayIcon size={13} weight="fill" />
          ) : (
            <ImageIcon size={14} weight="fill" />
          )}
        </span>
        <span className="media-tile-gradient" aria-hidden="true" />
        <span className="media-tile-name" title={item.name}>
          {item.name}
        </span>
      </button>

      <button
        className="favorite-button"
        type="button"
        onClick={() => onToggleFavorite(item.id)}
        disabled={disabled}
        aria-label={item.favorite ? `取消收藏 ${item.name}` : `收藏 ${item.name}`}
        aria-pressed={item.favorite}
      >
        <HeartIcon size={17} weight={item.favorite ? "fill" : "bold"} aria-hidden="true" />
      </button>

      {!item.isDemo ? (
        <button
          className="remove-media-button"
          type="button"
          onClick={() => onRemove(item.id)}
          disabled={disabled}
          aria-label={`从媒体库移除 ${item.name}`}
          title="从媒体库移除"
        >
          <TrashIcon size={15} weight="bold" aria-hidden="true" />
        </button>
      ) : null}

      {missing ? (
        <button
          className="relocate-button"
          type="button"
          onClick={() => onRelocate(item.id)}
          disabled={disabled}
          aria-label={`重新定位 ${item.name}`}
        >
          <ArrowClockwiseIcon size={15} weight="bold" aria-hidden="true" />
          重新定位
        </button>
      ) : null}
    </article>
  );
});

export const MediaShelf = memo(function MediaShelf({
  items,
  selectedId,
  activeCategory,
  onCategoryChange,
  onSelect,
  onToggleFavorite,
  onRemove,
  onRelocate,
  onUpload,
  isReady = true,
  inert = false,
  appliedMatchKey = null,
}) {
  const tabRefs = useRef([]);
  const stripRef = useRef(null);
  const scrollFrameRef = useRef(null);
  const [viewport, setViewport] = useState({
    left: 0,
    width: 1_024,
    tileExtent: DESKTOP_TILE_EXTENT,
  });
  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (activeCategory === "favorite") return item.favorite;
        if (activeCategory === "image" || activeCategory === "video") {
          return item.kind === activeCategory;
        }
        return true;
      }),
    [activeCategory, items],
  );

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const measure = () => {
      const tileExtent = window.matchMedia("(max-width: 590px)").matches
        ? COMPACT_TILE_EXTENT
        : DESKTOP_TILE_EXTENT;
      setViewport({ left: strip.scrollLeft, width: strip.clientWidth, tileExtent });
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    observer?.observe(strip);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.cancelAnimationFrame(scrollFrameRef.current);
    };
  }, [activeCategory]);

  const handleStripScroll = (event) => {
    const strip = event.currentTarget;
    window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      setViewport((current) => ({
        ...current,
        left: strip.scrollLeft,
        width: strip.clientWidth,
      }));
    });
  };

  const useVirtualWindow = visibleItems.length > VIRTUALIZATION_THRESHOLD;
  const startIndex = useVirtualWindow
    ? Math.max(0, Math.floor(viewport.left / viewport.tileExtent) - VIRTUAL_OVERSCAN)
    : 0;
  const endIndex = useVirtualWindow
    ? Math.min(
        visibleItems.length,
        Math.ceil((viewport.left + viewport.width) / viewport.tileExtent) + VIRTUAL_OVERSCAN,
      )
    : visibleItems.length;
  const renderedItems = useMemo(
    () => visibleItems.slice(startIndex, endIndex),
    [endIndex, startIndex, visibleItems],
  );

  const handleTabKeyDown = (event, index) => {
    let nextIndex = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % CATEGORIES.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + CATEGORIES.length) % CATEGORIES.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = CATEGORIES.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    onCategoryChange(CATEGORIES[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };

  const activeTabId = `category-tab-${activeCategory}`;

  return (
    <GlassSurface
      {...GLASS_MEDIA_SHELF}
      as="section"
      className="media-shelf liquid-glass"
      aria-label="壁纸素材库"
      aria-busy={!isReady}
      aria-hidden={inert || undefined}
      inert={inert}
    >
      <div className="shelf-heading">
        <div className="shelf-title-block">
          <span className="shelf-eyebrow">MY WALLPAPERS</span>
          <h2>媒体库</h2>
        </div>

        <div className="category-tabs" role="tablist" aria-label="壁纸分类">
          {CATEGORIES.map((category, index) => (
            <button
              key={category.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`category-tab-${category.id}`}
              className={activeCategory === category.id ? "is-active" : ""}
              type="button"
              role="tab"
              disabled={!isReady}
              tabIndex={activeCategory === category.id ? 0 : -1}
              aria-selected={activeCategory === category.id}
              aria-controls="media-library-panel"
              onClick={() => onCategoryChange(category.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      {visibleItems.length > 0 ? (
        <div
          ref={stripRef}
          id="media-library-panel"
          className="media-strip"
          role="tabpanel"
          aria-labelledby={activeTabId}
          onScroll={useVirtualWindow ? handleStripScroll : undefined}
        >
          {startIndex > 0 ? (
            <div aria-hidden="true" style={{ flex: `0 0 ${startIndex * viewport.tileExtent}px` }} />
          ) : null}
          {renderedItems.map((item) => (
            <MediaTile
              key={item.id}
              item={item}
              isSelected={selectedId === item.id}
              isApplied={Boolean(
                appliedMatchKey
                  && ((item.demoKey ? `demo:${item.demoKey}` : item.filePath) === appliedMatchKey),
              )}
              onSelect={onSelect}
              onToggleFavorite={onToggleFavorite}
              onRemove={onRemove}
              onRelocate={onRelocate}
              missing={item.missing === true}
              disabled={!isReady}
            />
          ))}
          {endIndex < visibleItems.length ? (
            <div
              aria-hidden="true"
              style={{ flex: `0 0 ${(visibleItems.length - endIndex) * viewport.tileExtent}px` }}
            />
          ) : null}
        </div>
      ) : (
        <div
          id="media-library-panel"
          className="empty-library"
          role="tabpanel"
          aria-labelledby={activeTabId}
        >
          {activeCategory === "image" ? (
            <ImageIcon size={22} weight="regular" aria-hidden="true" />
          ) : (
            <VideoCameraIcon size={22} weight="regular" aria-hidden="true" />
          )}
          <span>{activeCategory === "favorite" ? "还没有收藏的壁纸" : "这个分类还是空的"}</span>
          <button type="button" onClick={onUpload} disabled={!isReady}>
            上传素材
          </button>
        </div>
      )}
    </GlassSurface>
  );
});
