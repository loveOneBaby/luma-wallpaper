import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { kindFromExtension } from "../shared/mediaExtensions.js";
import { state, consts, appRoot } from "./app-state.mjs";

export function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function comparablePath(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) return "";

  let normalized = path.resolve(filePath.trim());
  try {
    normalized = fs.realpathSync.native(normalized);
  } catch {
    // The operating system can briefly report a path before it is resolvable.
  }

  normalized = path.normalize(normalized);
  if (process.platform !== "win32") return normalized;

  return normalized
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/i, "")
    .toLowerCase();
}

export function sameFilePath(leftPath, rightPath) {
  try {
    const leftStat = fs.statSync(leftPath);
    const rightStat = fs.statSync(rightPath);
    if (!leftStat.isFile() || !rightStat.isFile()) return false;
    if (leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino) return true;
  } catch {
    // Fall through to a normalized path comparison.
  }

  return comparablePath(leftPath) === comparablePath(rightPath);
}

export function waitForPlayback(token, timeout = consts.PLAYBACK_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      state.playbackWaiters.delete(token);
      resolve({ status: "timeout" });
    }, timeout);

    state.playbackWaiters.set(token, {
      resolve: (result) => {
        clearTimeout(timer);
        state.playbackWaiters.delete(token);
        resolve(result);
      },
    });
  });
}

export function settlePlayback(token, result) {
  state.playbackWaiters.get(token)?.resolve(result);
}

export async function loadWallpaperModule() {
  state.wallpaperModulePromise ??= import("wallpaper");
  return state.wallpaperModulePromise;
}

export function mediaKind(filePath) {
  return kindFromExtension(filePath);
}

export function authorizeMediaFile(filePath) {
  const resolvedPath = fs.realpathSync.native(filePath);
  if (!fs.statSync(resolvedPath).isFile() || !mediaKind(resolvedPath)) {
    throw new Error("仅支持图片或视频文件");
  }

  const identity = comparablePath(resolvedPath);
  if (!identity) throw new Error("无法识别媒体文件");
  state.authorizedMediaIdentities.add(identity);
  state.deferredMediaReleaseIdentities.delete(identity);
  return resolvedPath;
}

export function authorizePersistedMedia(state) {
  const persistedPaths = [
    ...(Array.isArray(state?.library?.items)
      ? state.library.items.map((item) => item?.filePath)
      : []),
    state?.lastApplied?.path,
  ];

  for (const persistedPath of persistedPaths) {
    if (typeof persistedPath !== "string" || !persistedPath.trim()) continue;
    try {
      authorizeMediaFile(persistedPath);
    } catch {
      // Missing persisted media is removed during the next library hydration.
    }
  }
}

export function mediaUrl(filePath) {
  const identity = comparablePath(filePath);
  let token = state.mediaTokensByPath.get(identity);
  if (!token) {
    token = crypto.randomUUID();
    state.mediaTokensByPath.set(identity, token);
    state.mediaFilesByToken.set(token, { identity, path: filePath });
  }

  return `luma-media://local/${token}/${encodeURIComponent(path.basename(filePath))}`;
}

export function mediaDescriptor(filePath) {
  return {
    path: filePath,
    identity: comparablePath(filePath),
    url: mediaUrl(filePath),
    name: path.basename(filePath),
    kind: mediaKind(filePath),
  };
}

export function isMainWindowSender(event) {
  return Boolean(
    state.mainWindow && !state.mainWindow.isDestroyed() && event?.sender?.id === state.mainWindow.webContents.id,
  );
}

export function registerMediaProtocol() {
  protocol.handle("luma-media", (request) => {
    const requestUrl = new URL(request.url);
    const [, token] = requestUrl.pathname.split("/");
    const mediaEntry = state.mediaFilesByToken.get(token);
    const filePath = mediaEntry?.path;

    if (!filePath || !fs.existsSync(filePath) || !mediaKind(filePath)) {
      if (mediaEntry) {
        state.mediaFilesByToken.delete(token);
        state.mediaTokensByPath.delete(mediaEntry.identity);
      }
      return new Response("Media not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).href, { headers: request.headers });
  });
}

export function releaseMediaTokens(requestedPaths) {
  const activeIdentity = comparablePath(state.wallpaperMedia?.path);
  let released = 0;
  for (const requestedPath of Array.isArray(requestedPaths) ? requestedPaths : []) {
    const identity = comparablePath(requestedPath);
    if (!identity) continue;
    if (identity === activeIdentity) {
      state.deferredMediaReleaseIdentities.add(identity);
      continue;
    }
    const token = state.mediaTokensByPath.get(identity);
    if (!token) continue;
    state.mediaTokensByPath.delete(identity);
    state.mediaFilesByToken.delete(token);
    released += 1;
  }
  return released;
}

export function flushDeferredMediaTokenReleases() {
  const activeIdentity = comparablePath(state.wallpaperMedia?.path);
  let released = 0;
  for (const identity of [...state.deferredMediaReleaseIdentities]) {
    if (identity === activeIdentity) continue;
    state.deferredMediaReleaseIdentities.delete(identity);
    const token = state.mediaTokensByPath.get(identity);
    if (!token) continue;
    state.mediaTokensByPath.delete(identity);
    state.mediaFilesByToken.delete(token);
    released += 1;
  }
  return released;
}

export function findDemoMedia(demoKey) {
  const fileName = consts.DEMO_FILES_BY_KEY.get(String(demoKey ?? ""));
  if (!fileName) return null;

  // Two supported flows: a packaged app resolves demo media from the
  // extraResources "demo-assets" directory (process.resourcesPath); the dev
  // workflow resolves it from the source tree. The earlier dist/assets +
  // hashed-filename fallbacks were dead in both supported flows and have been
  // removed — running `electron` against a built dist without electron-builder
  // packaging is not a supported configuration.
  const directCandidates = [
    path.join(process.resourcesPath, "demo-assets", fileName),
    path.join(appRoot, "src", "assets", fileName),
  ];
  return directCandidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

