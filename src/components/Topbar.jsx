import { ArrowCircleUpIcon, SquaresFourIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { GlassSurface } from "./GlassSurface.jsx";
import { GLASS_LIBRARY_BUTTON } from "./glassPresets.js";

const CATEGORIES = [
  { id: "all", label: "全部" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "favorite", label: "收藏" },
];

export function Topbar({
  isLibraryOpen,
  onToggleLibrary,
  onUpload,
  mediaName = "未选择壁纸",
  mediaKind = "image",
  mediaDurationLabel = "",
  activeCategory = "all",
  onCategoryChange,
  platformLabel,
  pendingUpdate = null,
  onReopenUpdate,
  isLibraryReady = true,
  inert = false,
}) {
  const currentCategory = CATEGORIES.some((category) => category.id === activeCategory)
    ? activeCategory
    : "all";

  return (
    <header className="topbar" aria-hidden={inert || undefined} inert={inert}>
      <div className="brand">Luma</div>
      <div className="topbar-current" aria-hidden="true">
        <span>‹</span>
        <strong>{mediaName}</strong>
        <span>
          · {mediaKind === "video" ? "动态视频" : "静态图片"}
          {mediaDurationLabel ? ` · ${mediaDurationLabel}` : ""}
        </span>
        <span>›</span>
      </div>
      <nav className="topbar-categories" aria-label="快速分类">
        {CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            className={currentCategory === category.id ? "is-active" : ""}
            onClick={() => onCategoryChange?.(category.id)}
            disabled={!isLibraryReady}
            aria-pressed={currentCategory === category.id}
          >
            {category.label}
          </button>
        ))}
        <SquaresFourIcon size={21} weight="regular" aria-hidden="true" />
      </nav>
      <div className="topbar-actions">
        {pendingUpdate ? (
          <GlassSurface
            {...GLASS_LIBRARY_BUTTON}
            as="button"
            className="update-pill liquid-glass"
            type="button"
            onClick={onReopenUpdate}
            aria-label={`新版本${pendingUpdate.version ? ` v${pendingUpdate.version}` : ""} 可用`}
          >
            <ArrowCircleUpIcon size={18} weight="regular" aria-hidden="true" />
            <span>新版本{pendingUpdate.version ? ` v${pendingUpdate.version}` : ""}</span>
          </GlassSurface>
        ) : null}
        <GlassSurface
          {...GLASS_LIBRARY_BUTTON}
          as="button"
          className={`library-button liquid-glass ${isLibraryOpen ? "is-active" : ""}`}
          type="button"
          onClick={onToggleLibrary}
          aria-expanded={isLibraryOpen}
          aria-label="媒体库"
        >
          <SquaresFourIcon
            size={21}
            weight={isLibraryOpen ? "fill" : "regular"}
            aria-hidden="true"
          />
          <span>媒体库</span>
        </GlassSurface>
        <button
          className="upload-button"
          type="button"
          onClick={onUpload}
          disabled={!isLibraryReady}
          aria-label={isLibraryReady ? "添加素材" : "正在恢复媒体库"}
          title={isLibraryReady ? undefined : "正在恢复媒体库，请稍候"}
        >
          <UploadSimpleIcon size={22} weight="regular" aria-hidden="true" />
          <span>添加素材</span>
        </button>
        <span className="platforms">{platformLabel}</span>
      </div>
    </header>
  );
}
