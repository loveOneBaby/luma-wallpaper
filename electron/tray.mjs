import fs from "node:fs";
import path from "node:path";
import { app, Menu, nativeImage, Tray } from "electron";
import { state, appRoot } from "./app-state.mjs";
import { showMainWindow } from "./windows.mjs";

export function rebuildTrayMenu() {
  if (!state.tray || state.tray.isDestroyed()) return;
  const startupSupported = app.isPackaged;
  const openAtLogin = startupSupported && app.getLoginItemSettings().openAtLogin;
  state.tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 Luma", click: showMainWindow },
      { type: "separator" },
      {
        label: "开机自动启动",
        type: "checkbox",
        checked: openAtLogin,
        enabled: startupSupported,
        click: (menuItem) => {
          app.setLoginItemSettings({ openAtLogin: menuItem.checked, path: process.execPath });
          rebuildTrayMenu();
        },
      },
      { type: "separator" },
      {
        label: "退出 Luma",
        click: () => {
          state.isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

export async function createWindowsTray() {
  if (process.platform !== "win32" || state.tray) return;
  let trayImage = nativeImage.createEmpty();
  try {
    if (!app.isPackaged) {
      const developmentIcon = path.join(appRoot, "build", "icon-64-preview.png");
      if (fs.existsSync(developmentIcon)) {
        trayImage = nativeImage.createFromPath(developmentIcon).resize({ width: 20, height: 20 });
      }
    }
    if (trayImage.isEmpty()) trayImage = await app.getFileIcon(process.execPath, { size: "small" });
    state.tray = new Tray(trayImage);
    state.tray.setToolTip("Luma 动态壁纸");
    state.tray.on("double-click", showMainWindow);
    rebuildTrayMenu();
  } catch (error) {
    state.tray = null;
    console.error("Unable to create the Windows state.tray icon", error);
  }
}

