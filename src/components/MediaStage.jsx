export function MediaStage({
  media,
  videoRef,
  muted,
  isPlaying,
  onLoadedMetadata,
  onTimeUpdate,
  onPlay,
  onPause,
  onVideoError,
  onImageError,
}) {
  return (
    <div className="media-stage" aria-label={`${media.name} 预览`}>
      {media.kind === "video" ? (
        <video
          key={media.src}
          ref={videoRef}
          className="wallpaper-media"
          src={media.src}
          muted={muted}
          loop
          playsInline
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          onPlay={onPlay}
          onPause={onPause}
          onError={onVideoError}
        />
      ) : (
        <img
          key={media.src}
          className={`wallpaper-media wallpaper-image ${isPlaying ? "is-playing" : ""}`}
          src={media.src}
          alt="用户上传的壁纸预览"
          onError={onImageError}
        />
      )}
    </div>
  );
}
