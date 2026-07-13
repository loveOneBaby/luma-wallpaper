const video = document.querySelector("#wallpaper-video");
const status = document.querySelector("#wallpaper-status");

let currentUrl = "";
let currentMedia = null;
let powerSuspended = false;

function showStatus(message = "") {
  status.textContent = message;
  status.hidden = !message;
}

function reportPlaybackState(statusValue, message) {
  if (!currentMedia?.playbackToken) return;
  window.lumaWallpaper.reportPlaybackState({
    token: currentMedia.playbackToken,
    status: statusValue,
    message,
  });
}

async function applyMedia(media) {
  currentMedia = media;
  if (!media?.url) {
    showStatus("无法载入动态壁纸");
    reportPlaybackState("error", "无法载入动态壁纸");
    return;
  }

  if (media.url !== currentUrl) {
    currentUrl = media.url;
    video.pause();
    video.src = media.url;
    video.load();
  }

  if (powerSuspended) {
    video.pause();
    showStatus();
    return;
  }

  try {
    await video.play();
    showStatus();
    if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      reportPlaybackState("playing");
    }
  } catch {
    showStatus("动态壁纸播放已暂停");
    reportPlaybackState("error", "动态壁纸播放已暂停");
  }
}

video.addEventListener("error", () => {
  showStatus("无法播放此视频");
  reportPlaybackState("error", "无法播放此视频");
});
video.addEventListener("playing", () => {
  showStatus();
  reportPlaybackState("playing");
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentUrl && !powerSuspended) video.play().catch(() => {});
});

function handlePlaybackControl(control) {
  if (control?.action === "pause") {
    powerSuspended = true;
    video.pause();
    return;
  }
  if (control?.action !== "resume") return;
  powerSuspended = false;
  if (currentUrl) video.play().catch(() => showStatus("动态壁纸播放已暂停"));
}

const unsubscribe = window.lumaWallpaper.onMediaChanged(applyMedia);
const unsubscribePlaybackControl = window.lumaWallpaper.onPlaybackControl(handlePlaybackControl);
window.addEventListener(
  "beforeunload",
  () => {
    unsubscribe();
    unsubscribePlaybackControl();
  },
  { once: true },
);

window.lumaWallpaper
  .getMedia()
  .then(applyMedia)
  .catch(() => showStatus("无法载入动态壁纸"));
