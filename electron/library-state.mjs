import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { app } from "electron";
import { state, consts } from "./app-state.mjs";
import {
  comparablePath,
  sameFilePath,
  mediaKind,
  authorizePersistedMedia,
  mediaUrl,
  mediaDescriptor,
  findDemoMedia,
} from "./media-tokens.mjs";

export function libraryStatePath() {
  return path.join(app.getPath("userData"), "library-state.json");
}

export function safeText(value, fallback = "", maxLength = 240) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || fallback;
}

export function emptyPersistedState() {
  return {
    version: consts.LIBRARY_STATE_VERSION,
    library: { items: [], selectedId: null, activeCategory: "all" },
    lastApplied: null,
  };
}

export async function readPersistedState() {
  if (state.persistedStateCache) return state.persistedStateCache;

  try {
    const content = await fsPromises.readFile(libraryStatePath(), "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") throw new Error("状态文件格式无效");
    state.persistedStateCache = {
      ...emptyPersistedState(),
      ...parsed,
      version: consts.LIBRARY_STATE_VERSION,
      library:
        parsed.library && typeof parsed.library === "object"
          ? parsed.library
          : { items: [], selectedId: null, activeCategory: "all" },
    };
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Unable to read saved library state", error);
    state.persistedStateCache = emptyPersistedState();
  }

  authorizePersistedMedia(state.persistedStateCache);

  return state.persistedStateCache;
}

export async function writePersistedState(nextState) {
  const targetPath = libraryStatePath();
  const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fsPromises.writeFile(temporaryPath, `${JSON.stringify(nextState, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fsPromises.rename(temporaryPath, targetPath);
  } finally {
    await fsPromises.rm(temporaryPath, { force: true }).catch(() => {});
  }
  state.persistedStateCache = nextState;
}

export function updatePersistedState(mutator) {
  const operation = state.stateWriteQueue.then(async () => {
    const current = await readPersistedState();
    const next = await mutator(structuredClone(current));
    await writePersistedState(next);
    return next;
  });
  state.stateWriteQueue = operation.catch(() => {});
  return operation;
}

export function enqueueWallpaperOperation(operation) {
  const queuedOperation = state.wallpaperOperationQueue.then(operation, operation);
  state.wallpaperOperationQueue = queuedOperation.catch(() => {});
  return queuedOperation;
}

export function sanitizeLibraryForStorage(request, { allowedIdentities = null } = {}) {
  const requestedItems = Array.isArray(request?.items)
    ? request.items.slice(0, consts.MAX_LIBRARY_ITEMS)
    : [];
  const storedItems = [];
  const seenIds = new Set();
  const seenSources = new Set();

  for (const item of requestedItems) {
    if (!item || typeof item !== "object") continue;
    let id = safeText(item.id, crypto.randomUUID(), 120);
    if (seenIds.has(id)) id = crypto.randomUUID();

    const demoKey = safeText(item.demoKey, "", 120);
    if (item.isDemo === true && consts.DEMO_FILES_BY_KEY.has(demoKey)) {
      const sourceKey = `demo:${demoKey}`;
      if (seenSources.has(sourceKey)) continue;
      const demoPath = findDemoMedia(demoKey);
      const kind = demoPath ? mediaKind(demoPath) : demoKey.endsWith("-video") ? "video" : "image";
      storedItems.push({
        id,
        name: safeText(item.name, kind === "video" ? "海岸晨光 · 动态" : "海岸晨光 · 静态"),
        kind,
        favorite: item.favorite === true,
        isDemo: true,
        demoKey,
        sourceKey,
        filePath: null,
      });
      seenIds.add(id);
      seenSources.add(sourceKey);
      continue;
    }

    const requestedPath = safeText(item.filePath ?? item.path, "", 4096);
    if (!requestedPath) continue;
    try {
      const filePath = fs.realpathSync.native(requestedPath);
      const kind = mediaKind(filePath);
      const identity = comparablePath(filePath);
      const sourceKey = `desktop:${identity}`;
      if (
        !kind ||
        !fs.statSync(filePath).isFile() ||
        (allowedIdentities && !allowedIdentities.has(identity)) ||
        seenSources.has(sourceKey)
      )
        continue;
      storedItems.push({
        id,
        name: path.basename(filePath),
        kind,
        favorite: item.favorite === true,
        isDemo: false,
        demoKey: null,
        sourceKey,
        filePath,
      });
      seenIds.add(id);
      seenSources.add(sourceKey);
    } catch {
      // Keep moved/inaccessible media marked as missing so the user can
      // re-locate it instead of silently losing it from the library.
      const fallbackSource = item.sourceKey ?? `desktop:${requestedPath}`;
      if (seenSources.has(fallbackSource)) continue;
      const fallbackKind = mediaKind(requestedPath) ?? (item.kind === "video" ? "video" : "image");
      storedItems.push({
        id,
        name: safeText(item.name, path.basename(requestedPath) || "未知素材", 240),
        kind: fallbackKind,
        favorite: item.favorite === true,
        isDemo: false,
        demoKey: null,
        sourceKey: fallbackSource,
        filePath: requestedPath,
        missing: true,
      });
      seenIds.add(id);
      seenSources.add(fallbackSource);
    }
  }

  const selectedId = safeText(request?.selectedId, "", 120);
  const selectedExists = storedItems.some((item) => item.id === selectedId);
  const categories = new Set(["all", "image", "video", "favorite"]);
  const activeCategory = categories.has(request?.activeCategory) ? request.activeCategory : "all";
  return {
    items: storedItems,
    selectedId: selectedExists ? selectedId : (storedItems[0]?.id ?? null),
    activeCategory,
  };
}

export function hydrateLibraryState(storedLibrary) {
  const sanitized = sanitizeLibraryForStorage(storedLibrary);
  const items = sanitized.items.flatMap((item) => {
    if (item.isDemo) {
      const demoPath = findDemoMedia(item.demoKey);
      if (!demoPath || !mediaKind(demoPath)) return [];
      return [{ ...item, src: mediaUrl(demoPath) }];
    }

    try {
      const descriptor = mediaDescriptor(item.filePath);
      return [
        {
          ...item,
          kind: descriptor.kind,
          name: descriptor.name,
          filePath: descriptor.path,
          src: descriptor.url,
        },
      ];
    } catch {
      return [];
    }
  });
  const selectedId = items.some((item) => item.id === sanitized.selectedId)
    ? sanitized.selectedId
    : (items[0]?.id ?? null);
  return {
    version: consts.LIBRARY_STATE_VERSION,
    items,
    selectedId,
    activeCategory: sanitized.activeCategory,
  };
}

export async function loadLibraryState() {
  await state.stateWriteQueue;
  const persisted = await readPersistedState();
  const hydrated = hydrateLibraryState(persisted.library);
  const cleanedLibrary = sanitizeLibraryForStorage(hydrated);
  if (JSON.stringify(cleanedLibrary) !== JSON.stringify(persisted.library)) {
    await updatePersistedState((current) => ({ ...current, library: cleanedLibrary }));
  }
  return hydrated;
}

export async function saveLibraryState(request) {
  await state.stateWriteQueue;
  await readPersistedState();
  const library = sanitizeLibraryForStorage(request, {
    allowedIdentities: state.authorizedMediaIdentities,
  });
  for (const item of library.items) {
    if (item.filePath) state.deferredMediaReleaseIdentities.delete(comparablePath(item.filePath));
  }
  await updatePersistedState((current) => ({
    ...current,
    version: consts.LIBRARY_STATE_VERSION,
    library,
  }));
  return { ok: true, saved: library.items.length };
}

export async function rememberLastApplied(media) {
  const demoKey = [...consts.DEMO_FILES_BY_KEY.keys()].find((key) => {
    const demoPath = findDemoMedia(key);
    return demoPath ? sameFilePath(demoPath, media.path) : false;
  });
  await updatePersistedState((current) => ({
    ...current,
    lastApplied: {
      kind: media.kind,
      path: demoKey ? null : media.path,
      demoKey: demoKey ?? null,
      appliedAt: new Date().toISOString(),
    },
  }));
}

export async function clearLastApplied() {
  await updatePersistedState((current) => ({ ...current, lastApplied: null }));
}

