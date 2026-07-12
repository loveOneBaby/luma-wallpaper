import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEMO_VIDEO_START = 6;

/**
 * Owns transport state (play/pause, mute, duration, currentTime) and the
 * underlying <video> ref for the current media. Reacts to media changes by
 * resetting transport — equivalent to the old imperative selectMedia reset,
 * but declared so addBrowserFiles/addDesktopFiles get the reset for free when
 * they update selection.
 */
export function usePlayback({ media }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef(null);

  const progress = useMemo(
    () => (duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0),
    [currentTime, duration],
  );

  // Reset transport when the selected media changes. Comparing media.id (not an
  // isFirstRun boolean) keeps this StrictMode-safe: the ref holds the previous
  // id across the dev double-invoke, so the initial mount never resets and the
  // initial useState values above are preserved verbatim.
  const prevMediaIdRef = useRef(media.id);
  useEffect(() => {
    if (prevMediaIdRef.current === media.id) return;
    prevMediaIdRef.current = media.id;
    setCurrentTime(0);
    setDuration(0);
    setMuted(true);
    setIsPlaying(media.kind === "video");
  }, [media.id, media.kind, media.isDemo]);

  // Drive the underlying <video> from transport state.
  useEffect(() => {
    if (media.kind !== "video" || !videoRef.current) return;
    videoRef.current.muted = muted;
    if (isPlaying) {
      videoRef.current.play().catch(() => setIsPlaying(false));
    } else {
      videoRef.current.pause();
    }
  }, [isPlaying, media.kind, media.src, muted]);

  const togglePlayback = useCallback(() => {
    if (media.kind !== "video") return;
    setIsPlaying((value) => !value);
  }, [media.kind]);

  const toggleMuted = useCallback(() => {
    if (media.kind !== "video") return;
    setMuted((value) => !value);
  }, [media.kind]);

  const seek = useCallback(
    (event) => {
      const nextTime = Number(event.target.value);
      setCurrentTime(nextTime);
      if (media.kind === "video" && videoRef.current) {
        videoRef.current.currentTime = nextTime;
      }
    },
    [media.kind],
  );

  const handleLoadedMetadata = useCallback(
    (event) => {
      const video = event.currentTarget;
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      if (media.isDemo) {
        video.currentTime = Math.min(DEMO_VIDEO_START, video.duration || DEMO_VIDEO_START);
        setCurrentTime(video.currentTime);
      }
      video.muted = muted;
      if (isPlaying) video.play().catch(() => setIsPlaying(false));
    },
    [media.isDemo, muted, isPlaying],
  );

  const handleTimeUpdate = useCallback((event) => {
    setCurrentTime(event.currentTarget.currentTime);
  }, []);

  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleVideoError = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  return {
    isPlaying,
    muted,
    duration,
    currentTime,
    progress,
    videoRef,
    togglePlayback,
    toggleMuted,
    seek,
    handleLoadedMetadata,
    handleTimeUpdate,
    handlePlay,
    handlePause,
    handleVideoError,
  };
}
