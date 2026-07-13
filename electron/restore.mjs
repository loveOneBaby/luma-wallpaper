import { state } from "./app-state.mjs";
import {
  readPersistedState,
  updatePersistedState,
  enqueueWallpaperOperation,
} from "./library-state.mjs";
import {
  resolveMediaRequest,
  setVideoWallpaper,
  publishWallpaperRuntime,
  runtimeStateFor,
  notifyWallpaperError,
  dependencyMessage,
} from "./wallpaper-apply.mjs";

export async function restoreLastVideoWallpaper() {
  if (process.platform !== "darwin" && process.platform !== "win32") return;
  await state.stateWriteQueue;
  const persisted = await readPersistedState();
  const lastApplied = persisted.lastApplied;
  if (!lastApplied || lastApplied.kind !== "video") return;

  try {
    const media = resolveMediaRequest({
      path: lastApplied.path,
      demoKey: lastApplied.demoKey,
    });
    if (media.kind !== "video") throw new Error("上次使用的动态壁纸格式已不受支持");
    await enqueueWallpaperOperation(() => setVideoWallpaper(media));
    publishWallpaperRuntime(runtimeStateFor(media, "running"));
  } catch (error) {
    console.error("Unable to restore the previous video wallpaper", error);
    notifyWallpaperError(dependencyMessage(error), "RESTORE_FAILED");
    await updatePersistedState((current) => ({ ...current, lastApplied: null })).catch(() => {});
    publishWallpaperRuntime({ status: "stopped" });
  }
}
