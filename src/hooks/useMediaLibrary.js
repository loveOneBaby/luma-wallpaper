import { useCallback, useEffect, useRef, useState } from "react";
import demoImage from "../assets/ocean-morning.png";
import demoVideo from "../assets/ocean-morning.mp4";
import { getBridge } from "../services/desktopBridge.js";
import {
  estimateLibraryStorage,
  flushPendingLibrarySaves,
  loadLibraryState,
  saveLibraryState,
} from "../services/libraryStorage.js";
import { pickDesktopMedia, releaseDesktopMedia } from "../services/desktopWallpaper.js";
import { resolveDroppedDesktopMedia } from "../services/desktopUpdates.js";
import { validateBrowserFiles } from "../services/mediaValidation.js";
import { kindFromExtension } from "../../shared/mediaExtensions.js";

const MAX_UPLOAD_BATCH = 100;
const MAX_LIBRARY_ITEMS = 1000;
const VALID_CATEGORIES = new Set(["all", "image", "video", "favorite"]);
const CATEGORY_ALIASES = {
  images: "image",
  videos: "video",
  favorites: "favorite",
};

const DEMO_ITEMS = [
  {
    id: "demo-video",
    src: demoVideo,
    name: "海岸晨光 · 动态",
    kind: "video",
    favorite: true,
    objectUrl: false,
    isDemo: true,
    demoKey: "ocean-morning-video",
    sourceKey: "demo:ocean-morning-video",
    poster: demoImage,
  },
  {
    id: "demo-image",
    src: demoImage,
    name: "海岸晨光 · 静态",
    kind: "image",
    favorite: false,
    objectUrl: false,
    isDemo: true,
    demoKey: "ocean-morning-image",
    sourceKey: "demo:ocean-morning-image",
  },
];

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function browserSourceKey(file, kind) {
  const name = typeof file?.name === "string" ? file.name : "unnamed";
  return `browser:${kind}:${name.toLowerCase()}:${file?.size ?? 0}:${file?.lastModified ?? 0}`;
}

function serializeItem(item, isDesktop) {
  if (item.isDemo) {
    return {
      id: item.id,
      demoKey: item.demoKey,
      favorite: item.favorite,
      isDemo: true,
    };
  }

  if (isDesktop) {
    if (!item.filePath) return null;
    return {
      id: item.id,
      name: item.name,
      kind: item.kind,
      favorite: item.favorite,
      isDemo: false,
      sourceKey: item.sourceKey,
      filePath: item.filePath,
      src: item.src,
    };
  }

  if (!(item.file instanceof Blob)) return null;
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    favorite: item.favorite,
    isDemo: false,
    sourceKey: item.sourceKey,
    file: item.file,
  };
}

function restoreItems(state, objectUrls) {
  const storedItems = Array.isArray(state?.items) ? state.items : [];
  const demos = DEMO_ITEMS.map((demo) => {
    const stored = storedItems.find(
      (item) => item?.id === demo.id || item?.demoKey === demo.demoKey,
    );
    return { ...demo, favorite: stored?.favorite ?? demo.favorite };
  });
  const seenIds = new Set(demos.map((item) => item.id));
  const restored = [];

  for (const item of storedItems) {
    if (!item || item.isDemo || !item.id || seenIds.has(item.id)) continue;
    if (demos.length + restored.length >= MAX_LIBRARY_ITEMS) break;
    const kind = item.kind === "image" || item.kind === "video" ? item.kind : null;
    if (!kind || typeof item.name !== "string") continue;

    if (item.file instanceof Blob) {
      const src = URL.createObjectURL(item.file);
      objectUrls.add(src);
      restored.push({
        id: item.id,
        src,
        name: item.name,
        kind,
        favorite: Boolean(item.favorite),
        objectUrl: true,
        isDemo: false,
        sourceKey: item.sourceKey ?? browserSourceKey(item.file, kind),
        file: item.file,
      });
      seenIds.add(item.id);
      continue;
    }

    const filePath = item.filePath ?? item.path;
    const src = item.src ?? item.url;
    if (typeof filePath !== "string" || typeof src !== "string") continue;
    restored.push({
      id: item.id,
      src,
      name: item.name,
      kind,
      favorite: Boolean(item.favorite),
      objectUrl: false,
      isDemo: false,
      sourceKey: item.sourceKey ?? `desktop:${item.identity ?? filePath}`,
      filePath,
    });
    seenIds.add(item.id);
  }

  return [...demos, ...restored];
}

function persistenceFailureMessage(reason) {
  if (reason === "quota") return "媒体库未保存：浏览器可用空间不足，请移除部分素材后重试";
  if (reason === "unavailable") return "媒体库未保存：当前环境无法使用本地存储";
  if (reason === "stale") return "媒体库已在另一个 Luma 页面更新，请刷新后再继续编辑";
  return "媒体库未保存：写入本地存储失败，请稍后重试";
}

/** Owns the uploaded media library, persistence, selection and ingestion. */
export function useMediaLibrary({ showFeedback, showUploadResult }) {
  const [items, setItems] = useState(() => DEMO_ITEMS.map((item) => ({ ...item })));
  const [selectedId, setSelectedId] = useState(DEMO_ITEMS[0].id);
  const [activeCategory, setActiveCategory] = useState("all");
  const [isLibraryOpen, setLibraryOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isPersistenceEnabled, setPersistenceEnabled] = useState(false);
  const [persistenceState, setPersistenceState] = useState({ status: "idle", reason: null });

  const fileInputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const objectUrlsRef = useRef(new Set());
  const itemsRef = useRef(items);
  const sourceKeysRef = useRef(new Set(items.map((item) => item.sourceKey).filter(Boolean)));
  const storageWarningRef = useRef(null);
  const importQueueRef = useRef(Promise.resolve());
  const validationAbortRef = useRef(new AbortController());
  const persistenceTimerRef = useRef(null);
  const persistenceSnapshotRef = useRef(null);
  const persistenceSequenceRef = useRef(0);
  const persistenceItemsRef = useRef(items);
  const mountedRef = useRef(true);

  const commitItems = useCallback((nextItems) => {
    itemsRef.current = nextItems;
    sourceKeysRef.current = new Set(nextItems.map((item) => item.sourceKey).filter(Boolean));
    setItems(nextItems);
  }, []);

  const ensureHydrated = useCallback(() => {
    if (isHydrated) return true;
    showFeedback("info", "正在恢复媒体库，请稍候", {
      source: "library",
      duration: 2200,
    });
    return false;
  }, [isHydrated, showFeedback]);

  const enqueueImport = useCallback((operation) => {
    const queued = importQueueRef.current.catch(() => undefined).then(operation);
    importQueueRef.current = queued.catch(() => undefined);
    return queued;
  }, []);

  useEffect(() => {
    itemsRef.current = items;
    sourceKeysRef.current = new Set(items.map((item) => item.sourceKey).filter(Boolean));
  }, [items]);

  useEffect(() => {
    mountedRef.current = true;
    if (validationAbortRef.current.signal.aborted) {
      validationAbortRef.current = new AbortController();
    }
    return () => {
      mountedRef.current = false;
      validationAbortRef.current.abort();
    };
  }, []);

  const media = items.find((item) => item.id === selectedId) ?? items[0];

  useEffect(() => {
    let active = true;
    loadLibraryState()
      .then((state) => {
        if (!active) return;
        setPersistenceEnabled(true);
        if (!state) return;
        const restoredObjectUrls = new Set();
        let restored;
        try {
          restored = restoreItems(state, restoredObjectUrls);
        } catch (error) {
          restoredObjectUrls.forEach((url) => URL.revokeObjectURL(url));
          throw error;
        }
        if (!active) {
          restoredObjectUrls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }
        restoredObjectUrls.forEach((url) => objectUrlsRef.current.add(url));
        commitItems(restored);
        const retainedSourceKeys = new Set(restored.map((item) => item.sourceKey).filter(Boolean));
        const truncatedDesktopPaths = [
          ...new Set(
            (Array.isArray(state.items) ? state.items : [])
              .filter((item) => {
                const filePath = item?.filePath ?? item?.path;
                if (typeof filePath !== "string") return false;
                const sourceKey = item.sourceKey ?? `desktop:${item.identity ?? filePath}`;
                return !retainedSourceKeys.has(sourceKey);
              })
              .map((item) => item.filePath ?? item.path),
          ),
        ];
        if (truncatedDesktopPaths.length > 0) {
          void releaseDesktopMedia(truncatedDesktopPaths).catch(() => undefined);
        }
        setSelectedId(
          restored.some((item) => item.id === state.selectedId) ? state.selectedId : restored[0].id,
        );
        const restoredCategory = CATEGORY_ALIASES[state.activeCategory] ?? state.activeCategory;
        if (VALID_CATEGORIES.has(restoredCategory)) {
          setActiveCategory(restoredCategory);
        }
      })
      .catch((error) => {
        if (active) {
          const blocked = /占用|超时/.test(error instanceof Error ? error.message : "");
          showFeedback(
            "warning",
            blocked
              ? "媒体库正在被其他 Luma 页面占用，请关闭旧页面后刷新"
              : "未能恢复上次的媒体库，本次仍可正常使用",
            {
              source: "library",
            },
          );
        }
      })
      .finally(() => {
        if (active) setIsHydrated(true);
      });
    return () => {
      active = false;
    };
  }, [commitItems, showFeedback]);

  const persistCurrentSnapshot = useCallback(
    async ({ silent = false } = {}) => {
      const snapshot = persistenceSnapshotRef.current;
      if (!snapshot) return { ok: true };
      const sequence = ++persistenceSequenceRef.current;
      if (mountedRef.current) {
        setPersistenceState((current) => ({ ...current, status: "saving" }));
      }
      const result = await saveLibraryState(snapshot);
      if (sequence !== persistenceSequenceRef.current) return result;

      if (result?.ok === false) {
        const reason = result.reason ?? "write-failed";
        if (mountedRef.current) setPersistenceState({ status: "unsaved", reason });
        if (!silent && storageWarningRef.current !== reason) {
          storageWarningRef.current = reason;
          showFeedback("error", persistenceFailureMessage(reason), {
            source: "library",
            duration: 7_200,
          });
        }
        return result;
      }

      if (mountedRef.current) setPersistenceState({ status: "saved", reason: null });
      if (!silent && storageWarningRef.current) {
        storageWarningRef.current = null;
        showFeedback("success", "媒体库已重新保存", { source: "library" });
      }
      return result;
    },
    [showFeedback],
  );

  const flushPersistence = useCallback(
    ({ silent = false } = {}) => {
      window.clearTimeout(persistenceTimerRef.current);
      persistenceTimerRef.current = null;
      return persistCurrentSnapshot({ silent }).finally(() => flushPendingLibrarySaves());
    },
    [persistCurrentSnapshot],
  );

  useEffect(() => {
    if (!isHydrated || !isPersistenceEnabled) return undefined;
    const isDesktop = Boolean(getBridge()?.isDesktop);
    persistenceSnapshotRef.current = {
      version: 2,
      items: items.map((item) => serializeItem(item, isDesktop)).filter(Boolean),
      selectedId,
      activeCategory,
    };
    window.clearTimeout(persistenceTimerRef.current);
    const mediaChanged = persistenceItemsRef.current !== items;
    persistenceItemsRef.current = items;
    if (mediaChanged) {
      persistenceTimerRef.current = null;
      void persistCurrentSnapshot();
      return undefined;
    }
    persistenceTimerRef.current = window.setTimeout(() => {
      persistenceTimerRef.current = null;
      void persistCurrentSnapshot();
    }, 180);
    return () => window.clearTimeout(persistenceTimerRef.current);
  }, [activeCategory, isHydrated, isPersistenceEnabled, items, persistCurrentSnapshot, selectedId]);

  useEffect(() => {
    const handlePageHide = () => {
      if (persistenceSnapshotRef.current) void flushPersistence({ silent: true });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && persistenceSnapshotRef.current) {
        void flushPersistence({ silent: true });
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (persistenceSnapshotRef.current) void flushPersistence({ silent: true });
    };
  }, [flushPersistence]);

  const addBrowserFiles = useCallback(
    (fileList) => {
      const sourceFiles = Array.from(fileList ?? []);
      if (!sourceFiles.length) return Promise.resolve();
      if (!ensureHydrated()) return Promise.resolve();

      return enqueueImport(async () => {
        if (itemsRef.current.length >= MAX_LIBRARY_ITEMS) {
          showUploadResult({
            added: 0,
            rejected: sourceFiles.length,
            reason: "library-full",
          });
          return;
        }

        const files = sourceFiles.slice(0, MAX_UPLOAD_BATCH);
        let rejected = Math.max(0, sourceFiles.length - MAX_UPLOAD_BATCH);
        let firstRejectionReason = rejected > 0 ? "too-many" : null;

        const newFileBytes = files.reduce((total, file) => {
          const kind = kindFromExtension(file?.name);
          if (!kind || sourceKeysRef.current.has(browserSourceKey(file, kind))) return total;
          return total + (Number(file?.size) || 0);
        }, 0);
        const storageEstimate = await estimateLibraryStorage(newFileBytes);
        if (storageEstimate && !storageEstimate.enough) {
          showFeedback("error", "浏览器可用空间不足，这批素材尚未添加", {
            source: "upload",
            duration: 7_200,
          });
          return;
        }

        if (files.length > 4) {
          showFeedback("info", `正在检查 ${files.length} 个素材…`, {
            source: "upload",
            persistent: true,
          });
        }
        let validation;
        try {
          validation = await validateBrowserFiles(files, {
            signal: validationAbortRef.current.signal,
          });
        } catch {
          showFeedback("error", "素材检查失败，请重新选择文件", { source: "upload" });
          return;
        }
        const nextItems = [];
        let duplicates = 0;
        let libraryFull = false;

        files.forEach((file, index) => {
          const result = validation[index];
          if (!result?.kind) {
            rejected += 1;
            firstRejectionReason ??= result?.reason ?? "invalid";
            return;
          }
          const sourceKey = browserSourceKey(file, result.kind);
          if (sourceKeysRef.current.has(sourceKey)) {
            duplicates += 1;
            return;
          }
          if (itemsRef.current.length + nextItems.length >= MAX_LIBRARY_ITEMS) {
            rejected += 1;
            libraryFull = true;
            return;
          }

          sourceKeysRef.current.add(sourceKey);
          const src = URL.createObjectURL(file);
          objectUrlsRef.current.add(src);
          nextItems.push({
            id: createId(),
            src,
            name: file.name,
            kind: result.kind,
            favorite: false,
            objectUrl: true,
            isDemo: false,
            sourceKey,
            file,
          });
        });

        showUploadResult({
          added: nextItems.length,
          duplicates,
          rejected,
          reason: libraryFull ? "library-full" : firstRejectionReason,
        });
        if (nextItems.length === 0 && firstRejectionReason === "resolution") {
          showFeedback("error", "素材分辨率过高，请使用最长边不超过 8192 像素的文件", {
            source: "upload",
          });
        }
        if (!nextItems.length) return;
        commitItems([...itemsRef.current, ...nextItems]);
        setSelectedId(nextItems[0].id);
        setLibraryOpen(true);
      });
    },
    [commitItems, enqueueImport, ensureHydrated, showFeedback, showUploadResult],
  );

  const addDesktopFiles = useCallback(
    (files, counts = {}) => {
      const sourceFiles = Array.from(files ?? []);
      if (!ensureHydrated()) return Promise.resolve();

      return enqueueImport(async () => {
        const candidateFiles = sourceFiles.slice(0, MAX_UPLOAD_BATCH);
        let duplicates = counts.duplicateCount ?? 0;
        let rejected =
          (counts.rejectedCount ?? 0) + Math.max(0, sourceFiles.length - MAX_UPLOAD_BATCH);
        let libraryFull = false;
        const nextItems = [];

        for (const file of candidateFiles) {
          const sourceKey = `desktop:${file.identity ?? file.path}`;
          if (sourceKeysRef.current.has(sourceKey)) {
            duplicates += 1;
            continue;
          }
          if (itemsRef.current.length + nextItems.length >= MAX_LIBRARY_ITEMS) {
            rejected += 1;
            libraryFull = true;
            continue;
          }
          sourceKeysRef.current.add(sourceKey);
          nextItems.push({
            id: createId(),
            src: file.url,
            name: file.name,
            kind: file.kind,
            favorite: false,
            objectUrl: false,
            isDemo: false,
            sourceKey,
            filePath: file.path,
          });
        }

        if (nextItems.length > 0) {
          commitItems([...itemsRef.current, ...nextItems]);
          setSelectedId(nextItems[0].id);
          setLibraryOpen(true);
        }

        const releasePaths = [
          ...new Set(
            sourceFiles
              .filter((file) => {
                const sourceKey = `desktop:${file.identity ?? file.path}`;
                return !sourceKeysRef.current.has(sourceKey);
              })
              .map((file) => file.path)
              .filter(Boolean),
          ),
        ];
        if (releasePaths.length > 0) {
          await releaseDesktopMedia(releasePaths).catch(() => undefined);
        }

        showUploadResult({
          added: nextItems.length,
          duplicates,
          rejected,
          reason: libraryFull
            ? "library-full"
            : sourceFiles.length > MAX_UPLOAD_BATCH
              ? "too-many"
              : null,
        });
      });
    },
    [commitItems, enqueueImport, ensureHydrated, showUploadResult],
  );

  const openFilePicker = useCallback(async () => {
    if (!ensureHydrated()) return;
    try {
      const desktopSelection = await pickDesktopMedia();
      if (desktopSelection !== null) {
        if (desktopSelection.canceled) return;
        await addDesktopFiles(desktopSelection.files, {
          duplicateCount: desktopSelection.duplicateCount,
          rejectedCount: desktopSelection.rejectedCount,
        });
        return;
      }
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : "无法打开文件", {
        source: "upload",
      });
      return;
    }
    fileInputRef.current?.click();
  }, [addDesktopFiles, ensureHydrated, showFeedback]);

  const selectMedia = useCallback(
    (id) => {
      if (ensureHydrated()) setSelectedId(id);
    },
    [ensureHydrated],
  );

  const changeCategory = useCallback(
    (category) => {
      if (ensureHydrated()) setActiveCategory(category);
    },
    [ensureHydrated],
  );

  const toggleFavorite = useCallback(
    (id) => {
      if (!ensureHydrated()) return;
      commitItems(
        itemsRef.current.map((item) =>
          item.id === id ? { ...item, favorite: !item.favorite } : item,
        ),
      );
    },
    [commitItems, ensureHydrated],
  );

  const removeMedia = useCallback(
    (id) => {
      if (!ensureHydrated()) return;
      const previous = itemsRef.current;
      const index = previous.findIndex((item) => item.id === id);
      const item = previous[index];
      if (!item || item.isDemo) return;

      const remaining = previous.filter((entry) => entry.id !== id);
      sourceKeysRef.current.delete(item.sourceKey);
      commitItems(remaining);
      if (selectedId === id) {
        setSelectedId(remaining[Math.min(index, remaining.length - 1)]?.id ?? DEMO_ITEMS[0].id);
      }
      if (item.objectUrl) {
        objectUrlsRef.current.delete(item.src);
        window.setTimeout(() => URL.revokeObjectURL(item.src), 0);
      } else if (item.filePath) {
        window.setTimeout(() => {
          void releaseDesktopMedia([item.filePath]);
        }, 0);
      }
      showFeedback("success", `已移除 ${item.name}`, { source: "library" });
    },
    [commitItems, ensureHydrated, selectedId, showFeedback],
  );

  const relocateMedia = useCallback(
    async (id) => {
      const target = itemsRef.current.find((item) => item.id === id);
      if (!target) return;
      try {
        const result = await pickDesktopMedia();
        if (result.canceled || !result.files.length) return;
        const file = result.files[0];
        const sourceKey = `desktop:${file.identity ?? file.path}`;
        const nextItems = itemsRef.current.map((item) => (
          item.id === id
            ? {
                ...item,
                filePath: file.path,
                src: file.url,
                name: file.name,
                kind: file.kind,
                sourceKey,
                missing: false,
                objectUrl: false,
              }
            : item
        ));
        sourceKeysRef.current.delete(target.sourceKey);
        commitItems(nextItems);
        showFeedback("success", `已重新定位为 ${file.name}`, { source: "library" });
      } catch (error) {
        showFeedback("error", error instanceof Error ? error.message : "无法重新定位文件", {
          source: "library",
        });
      }
    },
    [commitItems, showFeedback],
  );

  const handleDrop = useCallback(
    async (event) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      const files = Array.from(event.dataTransfer.files ?? []);
      if (!files.length) return;
      if (!ensureHydrated()) return;

      try {
        const desktopResult = await resolveDroppedDesktopMedia(files);
        if (desktopResult !== null) {
          await addDesktopFiles(desktopResult.files, desktopResult);
          return;
        }
        await addBrowserFiles(files);
      } catch (error) {
        showFeedback("error", error instanceof Error ? error.message : "无法导入拖入的素材", {
          source: "upload",
        });
      }
    },
    [addBrowserFiles, addDesktopFiles, ensureHydrated, showFeedback],
  );

  const handleDragEnter = useCallback(
    (event) => {
      event.preventDefault();
      if (!event.dataTransfer.types?.includes("Files") || !isHydrated) return;
      dragDepthRef.current += 1;
      event.dataTransfer.dropEffect = "copy";
      setIsDragging(true);
    },
    [isHydrated],
  );

  const handleDragOver = useCallback((event) => {
    event.preventDefault();
    if (event.dataTransfer.types?.includes("Files")) event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((event) => {
    event.preventDefault();
    if (!event.dataTransfer.types?.includes("Files")) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }, []);

  useEffect(
    () => () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  return {
    items,
    media,
    isHydrated,
    persistenceState,
    selectedId,
    setSelectedId: selectMedia,
    activeCategory,
    setActiveCategory: changeCategory,
    isLibraryOpen,
    setLibraryOpen,
    isDragging,
    fileInputRef,
    addBrowserFiles,
    openFilePicker,
    toggleFavorite,
    removeMedia,
    relocateMedia,
    handleDrop,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
  };
}
