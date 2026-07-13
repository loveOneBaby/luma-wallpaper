import { app, dialog, powerMonitor, protocol, screen } from "electron";
import { initializeAutoUpdates, stopAutoUpdates } from "./auto-update.mjs";
import {
  acknowledgeUnsignedMacUpdateLaunch,
  recoverAbandonedUnsignedMacUpdate,
  shouldExitForActiveUnsignedMacUpdate,
} from "./unsigned-mac-update.mjs";
import { resolveMacAppBundlePath } from "./update-support.mjs";
import { transitionWallpaperPowerState } from "./wallpaper-lifecycle.mjs";
import { state } from "./app-state.mjs";
import { registerMediaProtocol } from "./media-tokens.mjs";
import { readPersistedState } from "./library-state.mjs";
import {
  destroyWallpaperWindow,
  publishWallpaperRuntime,
  runtimeStateFor,
  sendWallpaperPlaybackControl,
  scheduleWallpaperPlacementRefresh,
  dependencyMessage,
} from "./wallpaper-apply.mjs";
import { registerIpc } from "./ipc.mjs";
import { createMainWindow, configureSessionSecurity, showMainWindow } from "./windows.mjs";
import { createWindowsTray } from "./tray.mjs";
import { restoreLastVideoWallpaper } from "./restore.mjs";


const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (hasSingleInstanceLock) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "luma-media",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}


async function publishLastAppliedRuntime() {
  const persisted = await readPersistedState();
  const lastApplied = persisted.lastApplied;
  if (!lastApplied) {
    publishWallpaperRuntime({ status: "stopped" });
    return;
  }
  if (lastApplied.kind === "image") {
    publishWallpaperRuntime({
      status: "running",
      kind: "image",
      matchKey: lastApplied.demoKey ? `demo:${lastApplied.demoKey}` : (lastApplied.path ?? null),
      name: null,
      appliedAt: lastApplied.appliedAt ?? null,
    });
  }
  // video restore is handled by restoreLastVideoWallpaper()
}

function registerDisplayLifecycle() {
  screen.on("display-added", () => scheduleWallpaperPlacementRefresh("display-added"));
  screen.on("display-removed", () => scheduleWallpaperPlacementRefresh("display-removed"));
  screen.on("display-metrics-changed", () =>
    scheduleWallpaperPlacementRefresh("display-metrics-changed"),
  );
  const handlePowerEvent = (eventName) => {
    const transition = transitionWallpaperPowerState(state.wallpaperPowerState, eventName);
    state.wallpaperPowerState = {
      sleeping: transition.sleeping,
      locked: transition.locked,
      suspended: transition.suspended,
    };
    if (transition.command === "pause") {
      if (state.displayRefreshTimer) clearTimeout(state.displayRefreshTimer);
      state.displayRefreshTimer = null;
      sendWallpaperPlaybackControl("pause", eventName);
      if (state.wallpaperMedia) publishWallpaperRuntime(runtimeStateFor(state.wallpaperMedia, "paused"));
      return;
    }
    if (transition.refreshPlacement) scheduleWallpaperPlacementRefresh(eventName);
    if (state.wallpaperMedia && !state.wallpaperPowerState.suspended) {
      publishWallpaperRuntime(runtimeStateFor(state.wallpaperMedia, "running"));
    }
  };
  powerMonitor.on("suspend", () => handlePowerEvent("suspend"));
  powerMonitor.on("lock-screen", () => handlePowerEvent("lock-screen"));
  powerMonitor.on("resume", () => handlePowerEvent("resume"));
  powerMonitor.on("unlock-screen", () => handlePowerEvent("unlock-screen"));
}

async function startApplication() {
  if (process.platform === "win32") app.setAppUserModelId("com.luma.wallpaper");
  if (
    await shouldExitForActiveUnsignedMacUpdate({
      argv: process.argv,
      userDataPath: app.getPath("userData"),
    })
  ) {
    state.isQuitting = true;
    app.quit();
    return;
  }
  configureSessionSecurity();
  registerMediaProtocol();
  registerIpc();
  registerDisplayLifecycle();
  await createWindowsTray();
  await createMainWindow();
  const acknowledgedUpdate = await acknowledgeUnsignedMacUpdateLaunch({
    argv: process.argv,
    userDataPath: app.getPath("userData"),
    currentVersion: app.getVersion(),
    currentAppPath: resolveMacAppBundlePath(process.execPath),
  });
  if (!acknowledgedUpdate) {
    await recoverAbandonedUnsignedMacUpdate({
      argv: process.argv,
      userDataPath: app.getPath("userData"),
      currentAppPath: resolveMacAppBundlePath(process.execPath),
    });
  }
  initializeAutoUpdates({
    getMainWindow: () => state.mainWindow,
    beforeInstall: () => {
      state.isQuitting = true;
      destroyWallpaperWindow();
    },
  });
  restoreLastVideoWallpaper().catch((error) =>
    console.error("Unable to restore the video wallpaper", error),
  );
  publishLastAppliedRuntime().catch(() => {});

  app.on("activate", showMainWindow);
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app
    .whenReady()
    .then(startApplication)
    .catch((error) => {
      console.error("Luma failed to start", error);
      dialog.showErrorBox("Luma 无法启动", dependencyMessage(error));
      state.isQuitting = true;
      app.exit(1);
    });
}

app.on("before-quit", () => {
  state.isQuitting = true;
  stopAutoUpdates();
  if (state.displayRefreshTimer) clearTimeout(state.displayRefreshTimer);
  state.displayRefreshTimer = null;
  destroyWallpaperWindow();
  if (state.tray && !state.tray.isDestroyed()) state.tray.destroy();
  state.tray = null;
});

app.on("window-all-closed", () => {
  if (process.platform === "win32") {
    if (!state.tray || state.tray.isDestroyed()) app.quit();
    return;
  }
  if (process.platform !== "darwin") app.quit();
});
