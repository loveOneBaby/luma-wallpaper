const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "lumaWallpaper",
  Object.freeze({
    getMedia: () => ipcRenderer.invoke("luma:wallpaper:get-media"),
    reportPlaybackState: (payload) => {
      if (!payload || typeof payload !== "object") return;
      ipcRenderer.send("luma:wallpaper:playback-state", payload);
    },
    onMediaChanged: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, media) => callback(media);
      ipcRenderer.on("luma:wallpaper:media-changed", listener);
      return () => ipcRenderer.removeListener("luma:wallpaper:media-changed", listener);
    },
    onPlaybackControl: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, control) => callback(control);
      ipcRenderer.on("luma:wallpaper:playback-control", listener);
      return () => ipcRenderer.removeListener("luma:wallpaper:playback-control", listener);
    },
  }),
);
