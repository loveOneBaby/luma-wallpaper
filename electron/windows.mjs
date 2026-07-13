import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, session } from "electron";
import { state, consts, __dirname, appRoot } from "./app-state.mjs";

export function trustedDevServerUrl(value) {
  if (app.isPackaged || typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    const trustedHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (parsed.protocol !== "http:" || !trustedHost || parsed.username || parsed.password)
      return null;
    return parsed.href;
  } catch {
    return null;
  }
}


export function hardenWindowNavigation(browserWindow, allowedUrl) {
  const allowed = new URL(allowedUrl);
  const isAllowedNavigation = (targetUrl) => {
    try {
      const target = new URL(targetUrl);
      if (allowed.protocol === "http:") return target.origin === allowed.origin;
      return target.protocol === "file:" && target.pathname === allowed.pathname;
    } catch {
      return false;
    }
  };

  browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  browserWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl)) event.preventDefault();
  });
  browserWindow.webContents.on("will-redirect", (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl)) event.preventDefault();
  });
  browserWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
}


export function showMainWindow() {
  if (!app.isReady()) {
    app
      .whenReady()
      .then(showMainWindow)
      .catch((error) => console.error(error));
    return;
  }
  if (!state.mainWindow || state.mainWindow.isDestroyed()) {
    createMainWindow().catch((error) => console.error("Unable to create the main window", error));
    return;
  }
  if (state.mainWindow.isMinimized()) state.mainWindow.restore();
  state.mainWindow.show();
  state.mainWindow.focus();
}


export function configureSessionSecurity() {
  const permitsFullscreen = (webContents, permission) =>
    permission === "fullscreen" &&
    state.mainWindow &&
    !state.mainWindow.isDestroyed() &&
    webContents?.id === state.mainWindow.webContents.id;
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    Boolean(permitsFullscreen(webContents, permission)),
  );
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(Boolean(permitsFullscreen(webContents, permission)));
  });
}


export async function createMainWindow() {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.show();
    state.mainWindow.focus();
    return state.mainWindow;
  }

  const nextWindow = new BrowserWindow({
    ...consts.MAIN_WINDOW_BOUNDS,
    show: false,
    backgroundColor: "#78dce5",
    title: "Luma",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  state.mainWindow = nextWindow;
  nextWindow.once("ready-to-show", () => nextWindow.show());
  nextWindow.on("close", (event) => {
    if (process.platform === "win32" && !state.isQuitting && state.tray && !state.tray.isDestroyed()) {
      event.preventDefault();
      nextWindow.hide();
    }
  });
  nextWindow.on("closed", () => {
    if (state.mainWindow === nextWindow) state.mainWindow = null;
  });

  const devServerUrl = trustedDevServerUrl(process.env.VITE_DEV_SERVER_URL);
  const productionEntry = path.join(appRoot, "dist", "index.html");
  const targetUrl = devServerUrl ?? pathToFileURL(productionEntry).href;
  hardenWindowNavigation(nextWindow, targetUrl);
  if (devServerUrl) await nextWindow.loadURL(devServerUrl);
  else await nextWindow.loadFile(productionEntry);

  return nextWindow;
}

