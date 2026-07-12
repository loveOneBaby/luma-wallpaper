import { CloudArrowUpIcon } from "@phosphor-icons/react";
import { GlassSurface } from "./GlassSurface.jsx";
import { GLASS_DROP_MESSAGE } from "./glassPresets.js";

export function DropLayer({ visible }) {
  return (
    <div className="drop-layer" aria-hidden={!visible}>
      <GlassSurface {...GLASS_DROP_MESSAGE} className="drop-message liquid-glass">
        <div className="drop-icon" aria-hidden="true">
          <CloudArrowUpIcon size={31} weight="regular" />
        </div>
        <div className="drop-copy">
          <strong>松开即可加入媒体库</strong>
          <span>支持图片与视频，可一次拖入多个文件</span>
        </div>
      </GlassSurface>
    </div>
  );
}
