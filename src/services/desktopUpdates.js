import { getBridge } from "./desktopBridge.js";

export async function resolveDroppedDesktopMedia(fileList) {
  const bridge = getBridge();
  if (!bridge?.resolveDroppedMedia) return null;
  return bridge.resolveDroppedMedia(Array.from(fileList ?? []));
}

export async function getDesktopUpdateState() {
  const bridge = getBridge();
  if (!bridge?.getUpdateState) return null;
  return bridge.getUpdateState();
}

export function subscribeDesktopUpdates(callback) {
  const bridge = getBridge();
  if (!bridge?.onUpdateState || typeof callback !== "function") return () => {};
  return bridge.onUpdateState(callback);
}

export async function installDesktopUpdate() {
  const bridge = getBridge();
  if (!bridge?.installUpdate) {
    return { ok: false, message: "当前环境不支持自动更新" };
  }
  return bridge.installUpdate();
}
