import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Centralised mutable state + constants shared across the Electron main
 * process modules. Every domain module imports `{ state, consts }` and
 * accesses e.g. `state.mainWindow` / `consts.VERIFICATION_DELAYS_MS`.
 * This avoids circular imports: no domain module imports from main.mjs.
 */

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const appRoot = path.resolve(__dirname, "..");

export const consts = Object.freeze({
  VERIFICATION_DELAYS_MS: [120, 350, 700],
  VERIFICATION_STABILITY_DELAY_MS: 1200,
  PLAYBACK_TIMEOUT_MS: 4000,
  MAX_DROPPED_PATHS: 100,
  MAX_LIBRARY_ITEMS: 1000,
  LIBRARY_STATE_VERSION: 1,
  DISPLAY_REFRESH_DELAY_MS: 650,
  MAIN_WINDOW_BOUNDS: {
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
  },
  DEMO_FILES_BY_KEY: new Map([
    ["ocean-morning-video", "ocean-morning.mp4"],
    ["ocean-morning-image", "ocean-morning.png"],
  ]),
});

export const state = {
  // Window + app lifecycle
  mainWindow: null,
  wallpaperWindow: null,
  wallpaperMedia: null,
  wallpaperModulePromise: null,
  tray: null,
  isQuitting: false,

  // Timers + queues
  displayRefreshTimer: null,
  stateWriteQueue: Promise.resolve(),
  wallpaperOperationQueue: Promise.resolve(),
  wallpaperTransitionInProgress: false,
  wallpaperPowerState: { sleeping: false, locked: false, suspended: false },

  // Playback tracking
  playbackWaiters: new Map(),
  confirmedPlaybackTokens: new Set(),
  reportedPlaybackErrors: new Set(),

  // Media token / authorisation tables
  mediaFilesByToken: new Map(),
  mediaTokensByPath: new Map(),
  authorizedMediaIdentities: new Set(),
  deferredMediaReleaseIdentities: new Set(),

  // Library persistence cache
  persistedStateCache: null,
};
