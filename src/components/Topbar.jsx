import { ArrowCircleUpIcon, SquaresFourIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { GlassSurface } from "./GlassSurface.jsx";
import { GLASS_LIBRARY_BUTTON } from "./glassPresets.js";

export function Topbar({
  isLibraryOpen,
  onToggleLibrary,
  onUpload,
  platformLabel,
  pendingUpdate = null,
  onReopenUpdate,
  isLibraryReady = true,
  inert = false,
}) {
  return (
    <header className="topbar" aria-hidden={inert || undefined} inert={inert}>
      <div className="brand">Luma</div>
      <div className="topbar-current" aria-hidden="true">
        <span>‹</span>
        <strong>海岸晨光</strong>
        <span>· 动态视频 · 00:20</span>
        <span>›</span>
      </div>
      <nav className="topbar-categories" aria-label="快速分类">
        <button type="button">全部</button>
        <button type="button">图片</button>
        <button type="button">视频</button>
        <button type="button">收藏</button>
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
