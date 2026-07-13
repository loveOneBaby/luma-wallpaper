/**
 * Type declarations for the Electron preload bridges exposed on
 * `window.lumaDesktop` (main window) and `window.lumaWallpaper` (desktop-layer
 * video window). The renderer is plain JS with checkJs disabled, so these exist
 * only to give editor IntelliSense and document the IPC contract — they do not
 * enforce types at build time.
 */

export type MediaKind = "image" | "video";

export interface DesktopMediaFile {
  path: string;
  identity: string;
  url: string;
  name: string;
  kind: MediaKind;
}

export interface LibraryItemState {
  id: string;
  name?: string;
  kind?: MediaKind;
  favorite: boolean;
  isDemo: boolean;
  demoKey?: string | null;
  sourceKey?: string;
  filePath?: string | null;
  src?: string;
}

export interface LibraryState {
  version: 1;
  items: LibraryItemState[];
  selectedId: string | null;
  activeCategory: "all" | "image" | "video" | "favorite" | "images" | "videos" | "favorites";
}

export type WallpaperVerification = "verified" | "conflict" | "unverified" | "playing";

export interface SetWallpaperRequest {
  path: string | null;
  kind: MediaKind;
  demoKey: string | null;
  force: boolean;
}

export interface SetWallpaperResult {
  ok?: boolean;
  platform?: string;
  mode?: MediaKind;
  verified?: boolean | null;
  verification?: WallpaperVerification;
  code?: string;
  conflict?: boolean;
  retryable?: boolean;
  conflictPossible?: boolean;
  message?: string;
}

export interface ResolveDroppedMediaResult {
  files: DesktopMediaFile[];
  duplicateCount: number;
  rejectedCount: number;
}

export interface PickMediaResult {
  canceled: boolean;
  files: DesktopMediaFile[];
  duplicateCount?: number;
  rejectedCount?: number;
}

export type UpdateStateValue =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error"
  | "unsupported";

export interface UpdateState {
  state?: UpdateStateValue;
  supported?: boolean;
  reason?: string | null;
  currentVersion?: string;
  version?: string | null;
  percent?: number | null;
  message?: string | null;
  lastError?: string | null;
  lastCheckedAt?: string | null;
  signed?: boolean | null;
  integrity?:
    "developer-id" | "unverified" | "platform-managed" | "development" | "unsupported" | null;
}

export interface LumaDesktopBridge {
  readonly isDesktop: true;
  readonly platform: string;
  pickMedia(): Promise<PickMediaResult | DesktopMediaFile[] | null>;
  resolveDroppedMedia(files: File[]): Promise<ResolveDroppedMediaResult | null>;
  loadLibraryState(): Promise<LibraryState>;
  saveLibraryState(state: LibraryState): Promise<{ ok: boolean; saved: number }>;
  releaseMedia(paths: string[]): Promise<{ ok: boolean; released: number }>;
  setWallpaper(request: SetWallpaperRequest): Promise<SetWallpaperResult>;
  getUpdateState(): Promise<UpdateState | null>;
  checkForUpdates(): Promise<UpdateState | null>;
  installUpdate(): Promise<{ ok: boolean; message?: string }>;
  downloadAndInstallUpdate(): Promise<{ ok: boolean; message?: string }>;
  getOpenAtLogin(): Promise<{ supported: boolean; openAtLogin: boolean }>;
  setOpenAtLogin(openAtLogin: boolean): Promise<{
    ok: boolean;
    supported: boolean;
    openAtLogin: boolean;
  }>;
  onUpdateState(callback: (state: UpdateState) => void): () => void;
  onPlaybackError(callback: (error: { code: string; message: string }) => void): () => void;
  onWallpaperRuntimeState?(
    callback: (error: { code?: string; message?: string } | string) => void,
  ): () => void;
}

export interface WallpaperMedia extends DesktopMediaFile {
  playbackToken?: string;
}

export interface LumaWallpaperBridge {
  getMedia(): Promise<WallpaperMedia | null>;
  reportPlaybackState(payload: {
    token: string;
    status: "playing" | "error";
    message?: string;
  }): void;
  onMediaChanged(callback: (media: WallpaperMedia | null) => void): () => void;
  onPlaybackControl(
    callback: (control: { action: "pause" | "resume"; reason?: string }) => void,
  ): () => void;
}

declare global {
  interface Window {
    lumaDesktop?: LumaDesktopBridge | null;
    lumaWallpaper?: LumaWallpaperBridge | null;
  }
}
