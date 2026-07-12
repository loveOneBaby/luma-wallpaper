export function MediaStage({
  media,
  videoRef,
  muted,
  onLoadedMetadata,
  onTimeUpdate,
  onPlay,
  onPause,
  onVideoError,
  onImageError,
}) {
  return (
    <div className="media-stage" role="group" aria-label={`${media.name} 预览`}>
      {media.kind === "video" ? (
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
      ) : (
        <img
          key={media.src}
          className="wallpaper-media wallpaper-image"
          src={media.src}
          alt=""
          decoding="async"
          onError={onImageError}
        />
      )}
    </div>
  );
}
