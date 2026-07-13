const APPLY_REQUEST_FIELDS = ["kind", "filePath", "demoKey", "name"];

/**
 * Capture only the stable fields needed to repeat a wallpaper request. Library
 * items may later be selected, edited, or removed, so recovery must never hold
 * the mutable object owned by the media shelf.
 */
export function createWallpaperApplySnapshot(media) {
  if (!media || (media.kind !== "image" && media.kind !== "video")) return null;

  const snapshot = {};
  for (const field of APPLY_REQUEST_FIELDS) {
    if (media[field] !== undefined) snapshot[field] = media[field];
  }
  return Object.freeze(snapshot);
}
