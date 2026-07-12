import { useCallback, useEffect, useRef, useState } from "react";
import demoImage from "../assets/ocean-morning.png";
import demoVideo from "../assets/ocean-morning.mp4";
import { pickDesktopMedia } from "../services/desktopWallpaper.js";
import { resolveDroppedDesktopMedia } from "../services/desktopUpdates.js";
import { kindFromExtension } from "../../shared/mediaExtensions.js";

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
  return `browser:${kind}:${file.name.toLowerCase()}:${file.size}:${file.lastModified ?? 0}`;
}

/**
 * Owns the media library: items, selection, category, library open state, and
 * click/drag upload ingestion (browser object URLs + desktop native paths).
 * Playback reset is delegated to usePlayback (it reacts to media.id change),
 * so selection here is a plain setSelectedId.
 */
export function useMediaLibrary({ showFeedback, showUploadResult }) {
  const [items, setItems] = useState(DEMO_ITEMS);
  const [selectedId, setSelectedId] = useState(DEMO_ITEMS[0].id);
  const [activeCategory, setActiveCategory] = useState("all");
  const [isLibraryOpen, setLibraryOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const objectUrlsRef = useRef(new Set());

  const media = items.find((item) => item.id === selectedId) ?? items[0];

  const addBrowserFiles = useCallback(
    (fileList) => {
      const existingKeys = new Set(items.map((item) => item.sourceKey).filter(Boolean));
      const batchKeys = new Set();
      const nextItems = [];
      let duplicates = 0;
      let rejected = 0;

      for (const file of Array.from(fileList ?? [])) {
        if (!file || !Number.isFinite(file.size) || file.size <= 0) {
          rejected += 1;
          continue;
        }
        const kind = kindFromExtension(file.name);
        if (!kind) {
          rejected += 1;
          continue;
        }
        const sourceKey = browserSourceKey(file, kind);
        if (existingKeys.has(sourceKey) || batchKeys.has(sourceKey)) {
          duplicates += 1;
          continue;
        }
        batchKeys.add(sourceKey);
        const src = URL.createObjectURL(file);
        objectUrlsRef.current.add(src);
        nextItems.push({
          id: createId(),
          src,
          name: file.name,
          kind,
          favorite: false,
          objectUrl: true,
          isDemo: false,
          sourceKey,
          file,
        });
      }

      showUploadResult({ added: nextItems.length, duplicates, rejected });
      if (!nextItems.length) return;
      setItems((previous) => [...previous, ...nextItems]);
      setSelectedId(nextItems[0].id);
      setLibraryOpen(true);
    },
    [items, showUploadResult],
  );

  const addDesktopFiles = useCallback(
    (files, counts = {}) => {
      const existingKeys = new Set(items.map((item) => item.sourceKey).filter(Boolean));
      const batchKeys = new Set();
      let duplicates = counts.duplicateCount ?? 0;
      const nextItems = [];

      for (const file of files ?? []) {
        const sourceKey = `desktop:${file.identity ?? file.path}`;
        if (existingKeys.has(sourceKey) || batchKeys.has(sourceKey)) {
          duplicates += 1;
          continue;
        }
        batchKeys.add(sourceKey);
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

      showUploadResult({
        added: nextItems.length,
        duplicates,
        rejected: counts.rejectedCount ?? 0,
      });
      if (!nextItems.length) return;
      setItems((previous) => [...previous, ...nextItems]);
      setSelectedId(nextItems[0].id);
      setLibraryOpen(true);
    },
    [items, showUploadResult],
  );

  const openFilePicker = useCallback(async () => {
    try {
      const desktopFiles = await pickDesktopMedia();
      if (desktopFiles !== null) {
        if (desktopFiles.length > 0) addDesktopFiles(desktopFiles);
        return;
      }
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : "无法打开文件", {
        source: "upload",
      });
      return;
    }
    fileInputRef.current?.click();
  }, [addDesktopFiles, showFeedback]);

  const toggleFavorite = useCallback((id) => {
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, favorite: !item.favorite } : item)),
    );
  }, []);

  const handleDrop = useCallback(
    async (event) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      const files = Array.from(event.dataTransfer.files ?? []);
      if (!files.length) return;

      try {
        const desktopResult = await resolveDroppedDesktopMedia(files);
        if (desktopResult !== null) {
          addDesktopFiles(desktopResult.files, desktopResult);
          return;
        }
        addBrowserFiles(files);
      } catch (error) {
        showFeedback("error", error instanceof Error ? error.message : "无法导入拖入的素材", {
          source: "upload",
        });
      }
    },
    [addBrowserFiles, addDesktopFiles, showFeedback],
  );

  const handleDragEnter = useCallback((event) => {
    event.preventDefault();
    if (!event.dataTransfer.types?.includes("Files")) return;
    dragDepthRef.current += 1;
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  }, []);

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

  // Revoke object URLs created for browser uploads when the library unmounts.
  useEffect(
    () => () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  return {
    items,
    media,
    selectedId,
    setSelectedId,
    activeCategory,
    setActiveCategory,
    isLibraryOpen,
    setLibraryOpen,
    isDragging,
    fileInputRef,
    addBrowserFiles,
    addDesktopFiles,
    openFilePicker,
    toggleFavorite,
    handleDrop,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
  };
}
