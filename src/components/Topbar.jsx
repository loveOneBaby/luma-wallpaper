import {
  ArrowCircleUpIcon,
  SquaresFourIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
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
  isLibraryReady = true,
  isDesktop = false,
  pendingUpdate = null,
  onReopenUpdate,
  onCheckForUpdates,
  updateState,
  inert = false,
}) {
  const currentCategory = CATEGORIES.some((category) => category.id === activeCategory)
    ? activeCategory
    : "all";

  const isUpdateBusy =
    updateState?.state === "checking" ||
    updateState?.state === "downloading" ||
    updateState?.state === "installing";

  const showUpdatePill = isDesktop && pendingUpdate;
  const showUpdateCheck = isDesktop && !showUpdatePill && !isUpdateBusy && onCheckForUpdates;

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
      </nav>
      <div className="topbar-actions">
        {showUpdatePill ? (
          <button
            className="update-pill"
            type="button"
            onClick={onReopenUpdate}
            disabled={inert}
            aria-label={`新版本${pendingUpdate.version ? ` v${pendingUpdate.version}` : ""} 可用，点击更新`}
          >
            <ArrowCircleUpIcon size={15} weight="bold" aria-hidden="true" />
            新版本{pendingUpdate.version ? ` v${pendingUpdate.version}` : ""}
          </button>
        ) : null}
        {showUpdateCheck ? (
          <button
            className="update-check-button"
            type="button"
            onClick={onCheckForUpdates}
            disabled={inert}
            aria-label="检测更新"
          >
            <ArrowCircleUpIcon size={15} weight="regular" aria-hidden="true" />
            检测更新
          </button>
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
