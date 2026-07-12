import { contextBridge, ipcRenderer, webUtils } from "electron";

const api = Object.freeze({
  isDesktop: true,
  platform: process.platform,
  pickMedia: () => ipcRenderer.invoke("luma:pick-media"),
  resolveDroppedMedia: (files) => {
    const sourceFiles = Array.from(files ?? []);
    const paths = sourceFiles.flatMap((file) => {
      try {
        const filePath = webUtils.getPathForFile(file);
        return filePath ? [filePath] : [];
      } catch {
        return [];
      }
    });
    return ipcRenderer.invoke("luma:resolve-dropped-media", {
      paths,
      total: sourceFiles.length,
    });
  },
  setWallpaper: (request) => ipcRenderer.invoke("luma:set-wallpaper", request),
  getUpdateState: () => ipcRenderer.invoke("luma:update:get-state"),
  installUpdate: () => ipcRenderer.invoke("luma:update:install"),
  onUpdateState: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("luma:update-state", listener);
    return () => ipcRenderer.removeListener("luma:update-state", listener);
  },
});

contextBridge.exposeInMainWorld("lumaDesktop", api);
