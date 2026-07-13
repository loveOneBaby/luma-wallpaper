import { kindFromExtension } from "../../shared/mediaExtensions.js";

const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const DEFAULT_VALIDATION_WORKERS = 3;
const MEDIA_VALIDATION_TIMEOUT_MS = 8_000;
const MAX_MEDIA_DIMENSION = 8_192;
const MAX_MEDIA_PIXELS = 40_000_000;

export function hasSafeMediaDimensions(width, height) {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_MEDIA_DIMENSION &&
    height <= MAX_MEDIA_DIMENSION &&
    width * height <= MAX_MEDIA_PIXELS
  );
}

function validateImage(file, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ valid: false, reason: "cancelled" });
      return;
    }

    const src = URL.createObjectURL(file);
    const image = new Image();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", handleAbort);
      image.removeAttribute("src");
      URL.revokeObjectURL(src);
      resolve(result);
    };
    const handleAbort = () => finish({ valid: false, reason: "cancelled" });
    const timer = window.setTimeout(
      () => finish({ valid: false, reason: "decode" }),
      MEDIA_VALIDATION_TIMEOUT_MS,
    );
    image.onload = () =>
      finish(
        hasSafeMediaDimensions(image.naturalWidth, image.naturalHeight)
          ? { valid: true }
          : { valid: false, reason: "resolution" },
      );
    image.onerror = () => finish({ valid: false, reason: "decode" });
    signal?.addEventListener("abort", handleAbort, { once: true });
    image.src = src;
  });
}

function validateVideo(file, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ valid: false, reason: "cancelled" });
      return;
    }

    const src = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      signal?.removeEventListener("abort", handleAbort);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(src);
      resolve(result);
    };
    const handleAbort = () => finish({ valid: false, reason: "cancelled" });
    const timer = window.setTimeout(
      () => finish({ valid: false, reason: "decode" }),
      MEDIA_VALIDATION_TIMEOUT_MS,
    );
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () =>
      finish(
        hasSafeMediaDimensions(video.videoWidth, video.videoHeight)
          ? { valid: true }
          : { valid: false, reason: "resolution" },
      );
    video.onerror = () => finish({ valid: false, reason: "decode" });
    signal?.addEventListener("abort", handleAbort, { once: true });
    video.src = src;
    video.load();
  });
}

async function validateBrowserFile(file, signal) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) {
    return { kind: null, reason: "invalid" };
  }

  const kind = kindFromExtension(file.name);
  if (!kind) return { kind: null, reason: "unsupported" };
  if (
    (kind === "image" && file.size > MAX_IMAGE_BYTES) ||
    (kind === "video" && file.size > MAX_VIDEO_BYTES)
  ) {
    return { kind: null, reason: "too-large" };
  }

  const validation =
    kind === "image" ? await validateImage(file, signal) : await validateVideo(file, signal);
  return validation.valid
    ? { kind, reason: null }
    : { kind: null, reason: validation.reason ?? "decode" };
}

export async function validateBrowserFiles(
  files,
  { signal, workers = DEFAULT_VALIDATION_WORKERS } = {},
) {
  const results = new Array(files.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(files.length, workers));

  async function worker() {
    while (cursor < files.length) {
      const index = cursor;
      cursor += 1;
      if (signal?.aborted) {
        results[index] = { kind: null, reason: "cancelled" };
        continue;
      }
      results[index] = await validateBrowserFile(files[index], signal);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
