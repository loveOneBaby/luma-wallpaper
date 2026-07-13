import { ArrowCircleUpIcon, CloudArrowUpIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { GlassSurface } from "./GlassSurface.jsx";
import { GLASS_LIBRARY_BUTTON, GLASS_UPLOAD_BUTTON } from "./glassPresets.js";

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
        <GlassSurface
          {...GLASS_UPLOAD_BUTTON}
          as="button"
          className="upload-button liquid-glass"
          type="button"
          onClick={onUpload}
          disabled={!isLibraryReady}
          aria-label={isLibraryReady ? "上传图片或视频" : "正在恢复媒体库"}
          title={isLibraryReady ? undefined : "正在恢复媒体库，请稍候"}
        >
          <CloudArrowUpIcon size={22} weight="regular" aria-hidden="true" />
          <span>上传图片或视频</span>
        </GlassSurface>
        <span className="platforms">{platformLabel}</span>
      </div>
    </header>
  );
}
