// Single source of truth for supported media extensions, shared by the
// renderer (Vite-bundled) and the Electron main process (packaged via
// build.files -> shared/**/*). Stored dotless so the same sets work for kind
// detection and for openDialog filters (which expect dotless extensions).

export const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "tif",
  "tiff",
  "webp",
]);

export const VIDEO_EXTENSIONS = new Set(["avi", "m4v", "mkv", "mov", "mp4", "webm", "wmv"]);

/**
 * Resolve "image" | "video" | null from a filename or path. Accepts both a
 * bare extension ("mp4") and a full path ("/a/b/foo.mp4"); matches the last
 * dot-delimited segment so it stays correct for dotted extensions too.
 * @param {string} filenameOrPath
 * @returns {"image" | "video" | null}
 */
export function kindFromExtension(filenameOrPath) {
  if (typeof filenameOrPath !== "string" || !filenameOrPath) return null;
  const lower = filenameOrPath.toLowerCase();
  const dotIndex = lower.lastIndexOf(".");
  if (dotIndex < 0) return null;
  const extension = lower.slice(dotIndex + 1);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}
