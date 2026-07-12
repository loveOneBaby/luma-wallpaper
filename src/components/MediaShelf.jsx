import { useEffect, useRef, useState } from "react";
import { HeartIcon, ImageIcon, PlayIcon, TrashIcon, VideoCameraIcon } from "@phosphor-icons/react";
import { GlassSurface } from "./GlassSurface.jsx";
import { GLASS_MEDIA_SHELF } from "./glassPresets.js";

const CATEGORIES = [
  { id: "all", label: "全部" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "favorite", label: "收藏" },
];

function LazyVideoPreview({ item }) {
  const previewRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setIsVisible(true);
        observer.disconnect();
      },
      { rootMargin: "160px" },
    );
    observer.observe(preview);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={previewRef}
      className="media-tile-preview"
      src={isVisible ? item.src : undefined}
      poster={item.poster}
      muted
      playsInline
      preload={isVisible ? "auto" : "none"}
      aria-hidden="true"
    />
  );
}

function MediaTile({ item, isSelected, onSelect, onToggleFavorite, onRemove, disabled }) {
  return (
    <article className={`media-tile ${isSelected ? "is-selected" : ""}`}>
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
    </article>
  );
}

export function MediaShelf({
  items,
  selectedId,
  activeCategory,
  onCategoryChange,
  onSelect,
  onToggleFavorite,
  onRemove,
  onUpload,
  isReady = true,
  inert = false,
}) {
  const tabRefs = useRef([]);
  const visibleItems = items.filter((item) => {
    if (activeCategory === "favorite") return item.favorite;
    if (activeCategory === "image" || activeCategory === "video") {
      return item.kind === activeCategory;
    }
    return true;
  });

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
          id="media-library-panel"
          className="media-strip"
          role="tabpanel"
          aria-labelledby={activeTabId}
        >
          {visibleItems.map((item) => (
            <MediaTile
              key={item.id}
              item={item}
              isSelected={selectedId === item.id}
              onSelect={onSelect}
              onToggleFavorite={onToggleFavorite}
              onRemove={onRemove}
              disabled={!isReady}
            />
          ))}
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
}
