import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Images have no real timeline; simulate a 20s looping progress so the dock
// slider and timecode stay meaningful for static wallpapers.
const IMAGE_LOOP_DURATION = 20;
const DEMO_VIDEO_START = 6;
const PROGRESS_TICK_MS = 100;

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
  const [duration, setDuration] = useState(IMAGE_LOOP_DURATION);
  const [currentTime, setCurrentTime] = useState(DEMO_VIDEO_START);
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
    setCurrentTime(media.isDemo && media.kind === "video" ? DEMO_VIDEO_START : 0);
    setDuration(media.kind === "image" ? IMAGE_LOOP_DURATION : 0);
    setMuted(true);
    setIsPlaying(true);
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
  }, [isPlaying, media, muted]);

  // Simulated playback progress for static images.
  useEffect(() => {
    if (media.kind !== "image" || !isPlaying) return undefined;
    const timer = window.setInterval(() => {
      setCurrentTime((value) => (value + 0.1 >= IMAGE_LOOP_DURATION ? 0 : value + 0.1));
    }, PROGRESS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [isPlaying, media.kind]);

  const togglePlayback = useCallback(() => {
    setIsPlaying((value) => !value);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((value) => !value);
  }, []);

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
      setDuration(video.duration || IMAGE_LOOP_DURATION);
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
  };
}
