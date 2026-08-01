import { ImageIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

export function MediaStage({
  media,
  videoRef,
  muted,
  isPlaying = false,
  isApplied = false,
  onLoadedMetadata,
  onTimeUpdate,
  onPlay,
  onPause,
  onVideoError,
  onImageError,
}) {
  const [mediaLoadFailed, setMediaLoadFailed] = useState(false);

  useEffect(() => {
    setMediaLoadFailed(false);
  }, [media.id, media.src, media.kind]);

  return (
    <div className="media-stage" role="group" aria-label={`${media.name} 预览`}>
      {isApplied ? (
        <span className="applied-badge" aria-label="正在使用">
          <span className="applied-dot" aria-hidden="true" />
          正在使用
        </span>
      ) : null}
      {media.kind === "video" ? (
        <>
          <video
            key={media.src}
            ref={videoRef}
            className="wallpaper-media"
            src={media.src}
            poster={media.poster}
            muted={muted}
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            onPlay={onPlay}
            onPause={onPause}
            onError={onVideoError}
          />
          {!isPlaying && media.poster ? (
            <img className="video-poster-overlay" src={media.poster} alt="" aria-hidden="true" />
          ) : null}
        </>
      ) : (
        (mediaLoadFailed ? (
          <div className="wallpaper-image-fallback" aria-label="图片预览失败" role="status">
            <ImageIcon size={28} weight="fill" aria-hidden="true" />
            <span>图片预览失败</span>
          </div>
        ) : (
          <img
            key={media.src}
            className="wallpaper-media wallpaper-image"
            src={media.src}
            alt=""
            decoding="async"
            onError={() => {
              setMediaLoadFailed(true);
              onImageError?.();
            }}
          />
        ))
      )}
    </div>
  );
}
