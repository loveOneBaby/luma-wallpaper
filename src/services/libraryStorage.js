import { getBridge } from "./desktopBridge.js";

const DATABASE_NAME = "luma-wallpaper-library";
const DATABASE_VERSION = 1;
const STORE_NAME = "library";
const STATE_KEY = "current";

let databasePromise;
let saveQueue = Promise.resolve();

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地媒体库"));
    request.onblocked = () => reject(new Error("本地媒体库正被其他窗口占用"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

  return databasePromise;
}

async function readIndexedDbState() {
  const database = await openDatabase();
  if (!database) return null;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
    request.onerror = () => reject(request.error ?? new Error("无法读取本地媒体库"));
    request.onsuccess = () => resolve(request.result ?? null);
  });
}

async function writeIndexedDbState(state) {
  const database = await openDatabase();
  if (!database) return { ok: false, reason: "unavailable" };

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(state, STATE_KEY);
    transaction.oncomplete = () => resolve({ ok: true });
    transaction.onerror = () => reject(transaction.error ?? new Error("无法保存本地媒体库"));
    transaction.onabort = () => reject(transaction.error ?? new Error("本地媒体库保存已取消"));
  });
}

/**
 * Loads library state from Electron's validated native-path store when the
 * bridge is available, otherwise from IndexedDB for the browser build.
 */
export async function loadLibraryState() {
  const bridge = getBridge();
  if (bridge?.loadLibraryState) {
    const result = await bridge.loadLibraryState();
    return result?.state ?? result ?? null;
  }
  return readIndexedDbState();
}

/**
 * Writes are serialized so a slower IndexedDB transaction cannot overwrite a
 * newer favorite/selection change. Electron persists only validated native
 * path descriptors supplied by useMediaLibrary.
 */
export function saveLibraryState(state) {
  const bridge = getBridge();
  const write = () =>
    bridge?.saveLibraryState ? bridge.saveLibraryState(state) : writeIndexedDbState(state);

  saveQueue = saveQueue.catch(() => undefined).then(write);
  return saveQueue;
}
