import { CloudArrowUpIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { GlassSurface } from "./GlassSurface.jsx";
import { GLASS_LIBRARY_BUTTON, GLASS_UPLOAD_BUTTON } from "./glassPresets.js";

export function Topbar({ isLibraryOpen, onToggleLibrary, onUpload, platformLabel }) {
  return (
    <header className="topbar">
      <div className="brand">Luma</div>
      <div className="topbar-actions">
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
          aria-label="上传图片或视频"
        >
          <CloudArrowUpIcon size={22} weight="regular" aria-hidden="true" />
          <span>上传图片或视频</span>
        </GlassSurface>
        <span className="platforms">{platformLabel}</span>
      </div>
    </header>
  );
}
