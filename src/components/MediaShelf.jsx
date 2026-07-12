import {
  HeartIcon,
  ImageIcon,
  PlayIcon,
  VideoCameraIcon,
} from "@phosphor-icons/react";
import { GlassSurface } from "./GlassSurface.jsx";

const CATEGORIES = [
  { id: "all", label: "全部" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "favorite", label: "收藏" },
];

function MediaTile({ item, isSelected, onSelect, onToggleFavorite }) {
  return (
    <article className={`media-tile ${isSelected ? "is-selected" : ""}`}>
      <button
        className="media-tile-select"
        type="button"
        onClick={() => onSelect(item.id)}
        aria-current={isSelected ? "true" : undefined}
        aria-label={`预览 ${item.name}`}
      >
        {item.kind === "video" ? (
          <video className="media-tile-preview" src={item.src} muted preload="metadata" />
        ) : (
          <img className="media-tile-preview" src={item.src} alt="" />
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
        aria-label={item.favorite ? `取消收藏 ${item.name}` : `收藏 ${item.name}`}
        aria-pressed={item.favorite}
      >
        <HeartIcon size={17} weight={item.favorite ? "fill" : "bold"} aria-hidden="true" />
      </button>
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
  onUpload,
}) {
  const visibleItems = items.filter((item) => {
    if (activeCategory === "favorite") return item.favorite;
    if (activeCategory === "image" || activeCategory === "video") {
      return item.kind === activeCategory;
    }
    return true;
  });

  return (
    <GlassSurface
      as="section"
      width={null}
      height={null}
      borderRadius={null}
      borderWidth={0.075}
      brightness={65}
      opacity={0.88}
      blur={10}
      displace={0.55}
      backgroundOpacity={0.045}
      saturation={1.4}
      distortionScale={-145}
      redOffset={-5}
      greenOffset={10}
      blueOffset={21}
      mixBlendMode="screen"
      className="media-shelf liquid-glass"
      aria-label="壁纸素材库"
    >
      <div className="shelf-heading">
        <div className="shelf-title-block">
          <span className="shelf-eyebrow">MY WALLPAPERS</span>
          <h2>媒体库</h2>
        </div>

        <div className="category-tabs" role="tablist" aria-label="壁纸分类">
          {CATEGORIES.map((category) => (
            <button
              key={category.id}
              className={activeCategory === category.id ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={activeCategory === category.id}
              onClick={() => onCategoryChange(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      {visibleItems.length > 0 ? (
        <div className="media-strip" role="tabpanel">
          {visibleItems.map((item) => (
            <MediaTile
              key={item.id}
              item={item}
              isSelected={selectedId === item.id}
              onSelect={onSelect}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </div>
      ) : (
        <div className="empty-library" role="tabpanel">
          {activeCategory === "image" ? (
            <ImageIcon size={22} weight="regular" aria-hidden="true" />
          ) : (
            <VideoCameraIcon size={22} weight="regular" aria-hidden="true" />
          )}
          <span>{activeCategory === "favorite" ? "还没有收藏的壁纸" : "这个分类还是空的"}</span>
          <button type="button" onClick={onUpload}>上传素材</button>
        </div>
      )}
    </GlassSurface>
  );
}
