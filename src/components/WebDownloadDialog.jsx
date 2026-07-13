import { XIcon } from "@phosphor-icons/react";
import { GlassSurface } from "./GlassSurface.jsx";
import { GLASS_CONFLICT_PANEL } from "./glassPresets.js";

const RELEASES_URL = "https://github.com/loveOneBaby/luma-wallpaper/releases/latest";

export function WebDownloadDialog({ open, onClose, inert = false }) {
  if (!open) return null;
  return (
    <div
      className="conflict-layer"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <GlassSurface
        {...GLASS_CONFLICT_PANEL}
        as="section"
        className="conflict-panel liquid-glass web-download-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="web-download-title"
        aria-describedby="web-download-description"
        inert={inert}
      >
        <button className="conflict-close" type="button" onClick={onClose} aria-label="关闭">
          <XIcon size={18} weight="bold" aria-hidden="true" />
        </button>

        <div className="conflict-copy">
          <span className="conflict-eyebrow">DESKTOP APP</span>
          <h2 id="web-download-title">下载桌面端设置壁纸</h2>
          <p id="web-download-description">
            浏览器仅能管理与预览素材，设置壁纸请用桌面端。选择你的系统下载：
          </p>
        </div>

        <div className="web-download-actions">
          <a
            className="web-download-link"
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            macOS
          </a>
          <a
            className="web-download-link"
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Windows
          </a>
        </div>
      </GlassSurface>
    </div>
  );
}
