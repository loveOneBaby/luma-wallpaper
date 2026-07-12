/**
 * Resolve the desktop preload bridge, or null when running on the web (where
 * `window.lumaDesktop` is not exposed). Centralized here so the wallpaper and
 * update service modules share a single definition.
 * @returns {import("../types/luma-desktop").LumaDesktopBridge | null}
 */
export function getBridge() {
  return typeof window === "undefined" ? null : (window.lumaDesktop ?? null);
}
