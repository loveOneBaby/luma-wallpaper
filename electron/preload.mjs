import { contextBridge, ipcRenderer } from "electron";

const api = Object.freeze({
  isDesktop: true,
  platform: process.platform,
  pickMedia: () => ipcRenderer.invoke("luma:pick-media"),
  setWallpaper: (request) => ipcRenderer.invoke("luma:set-wallpaper", request),
});

contextBridge.exposeInMainWorld("lumaDesktop", api);
