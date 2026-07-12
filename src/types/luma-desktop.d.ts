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
}

export interface LumaDesktopBridge {
  readonly isDesktop: true;
  readonly platform: string;
  pickMedia(): Promise<PickMediaResult | DesktopMediaFile[] | null>;
  resolveDroppedMedia(files: File[]): Promise<ResolveDroppedMediaResult | null>;
  setWallpaper(request: SetWallpaperRequest): Promise<SetWallpaperResult>;
  getUpdateState(): Promise<UpdateState | null>;
  installUpdate(): Promise<{ ok: boolean; message?: string }>;
  onUpdateState(callback: (state: UpdateState) => void): () => void;
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
}

declare global {
  interface Window {
    lumaDesktop?: LumaDesktopBridge | null;
    lumaWallpaper?: LumaWallpaperBridge | null;
  }
}
