/* global process */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

function subscribe(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

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
  loadLibraryState: () => ipcRenderer.invoke("luma:library:load"),
  saveLibraryState: (state) => ipcRenderer.invoke("luma:library:save", state),
  releaseMedia: (paths) => ipcRenderer.invoke("luma:media:release", { paths }),
  setWallpaper: (request) => ipcRenderer.invoke("luma:set-wallpaper", request),
  getUpdateState: () => ipcRenderer.invoke("luma:update:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("luma:update:check"),
  installUpdate: () => ipcRenderer.invoke("luma:update:install"),
  getOpenAtLogin: () => ipcRenderer.invoke("luma:startup:get"),
  setOpenAtLogin: (openAtLogin) => ipcRenderer.invoke("luma:startup:set", openAtLogin === true),
  onUpdateState: (callback) => subscribe("luma:update-state", callback),
  onPlaybackError: (callback) => subscribe("luma:wallpaper-error", callback),
});

contextBridge.exposeInMainWorld("lumaDesktop", api);
