import { useEffect, useRef } from "react";
import { ArrowClockwiseIcon, PowerIcon, SpinnerGapIcon, XIcon } from "@phosphor-icons/react";
import { GlassSurface } from "./GlassSurface.jsx";
import { GLASS_CONFLICT_PANEL } from "./glassPresets.js";

export function ConflictDialog({ applyState, onClose, onRetry }) {
  const isApplying = applyState === "applying";
  const layerRef = useRef(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      layerRef.current?.querySelector("[data-initial-focus]")?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      layerRef.current?.querySelectorAll(
        'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => !element.closest("[inert]") && element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      layerRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={layerRef}
      className="conflict-layer"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <GlassSurface
        {...GLASS_CONFLICT_PANEL}
        as="section"
        className="conflict-panel liquid-glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
        aria-describedby="conflict-description"
      >
        <button
          className="conflict-close"
          type="button"
          onClick={onClose}
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
          <button className="conflict-later" type="button" onClick={onClose}>
            稍后处理
          </button>
          <button
            className="conflict-retry"
            type="button"
            onClick={onRetry}
            disabled={isApplying}
            data-initial-focus
          >
            {isApplying ? (
              <SpinnerGapIcon size={19} weight="bold" aria-hidden="true" />
            ) : (
              <ArrowClockwiseIcon size={19} weight="bold" aria-hidden="true" />
            )}
            <span>我已退出，重新应用</span>
          </button>
        </div>
      </GlassSurface>
    </div>
  );
}
