import { getBridge } from "./desktopBridge.js";

const DATABASE_NAME = "luma-wallpaper-library";
const DATABASE_VERSION = 2;
const LEGACY_STORE_NAME = "library";
const STATE_STORE_NAME = "library-state";
const BLOB_STORE_NAME = "library-blobs";
const STATE_KEY = "current";
const MIN_STORAGE_RESERVE_BYTES = 2 * 1024 * 1024;
const DATABASE_OPEN_TIMEOUT_MS = 4_000;

let databasePromise;
let saveQueue = Promise.resolve();
let knownStorageRevision = null;

function normalizeStorageRevision(value) {
  return typeof value === "string" && value ? value : null;
}

function createStorageRevision() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function storageRevisionsMatch(expectedRevision, currentRevision) {
  return normalizeStorageRevision(expectedRevision) === normalizeStorageRevision(currentRevision);
}

function requestResult(request, fallbackMessage) {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error(fallbackMessage));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionResult(transaction, fallbackMessage) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(fallbackMessage));
    transaction.onabort = () => reject(transaction.error ?? new Error(fallbackMessage));
  });
}

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    const finishWithError = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(error);
    };
    const timeout = window.setTimeout(
      () => finishWithError(new Error("本地媒体库打开超时，请关闭其他旧版本页面后重试")),
      DATABASE_OPEN_TIMEOUT_MS,
    );
    request.onerror = () => finishWithError(request.error ?? new Error("无法打开本地媒体库"));
    request.onblocked = () => finishWithError(new Error("本地媒体库正被其他窗口占用"));
    request.onupgradeneeded = () => {
      const database = request.result;
      // Keep the v1 store long enough to migrate its single, whole-library
      // record. New writes use separate metadata and Blob stores.
      if (!database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        database.createObjectStore(LEGACY_STORE_NAME);
      }
      if (!database.objectStoreNames.contains(STATE_STORE_NAME)) {
        database.createObjectStore(STATE_STORE_NAME);
      }
      if (!database.objectStoreNames.contains(BLOB_STORE_NAME)) {
        database.createObjectStore(BLOB_STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };
  }).catch((error) => {
    databasePromise = undefined;
    throw error;
  });

  return databasePromise;
}

/**
 * Converts the hook's in-memory browser state into small mutable metadata and
 * immutable Blob records. Blob IDs are stable, so favorite/selection changes
 * never clone every uploaded file again.
 */
export function splitLibraryStateForStorage(state) {
  const blobs = new Map();
  const items = (Array.isArray(state?.items) ? state.items : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const metadata = { ...item };
    if (item.file instanceof Blob && typeof item.id === "string" && item.id) {
      blobs.set(item.id, item.file);
      metadata.blobId = item.id;
    }
    delete metadata.file;
    return [metadata];
  });

  return {
    metadata: {
      ...state,
      version: 2,
      items,
    },
    blobs,
  };
}

/** Reattaches Blob records and ignores corrupt metadata that lost its Blob. */
export function mergeLibraryStateWithBlobs(metadata, blobs) {
  if (!metadata || typeof metadata !== "object") return null;
  const items = (Array.isArray(metadata.items) ? metadata.items : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    if (!item.blobId) return [{ ...item }];
    const file = blobs.get(item.blobId);
    if (!(file instanceof Blob)) return [];
    const restored = { ...item, file };
    delete restored.blobId;
    return [restored];
  });
  return { ...metadata, items };
}

export async function estimateLibraryStorage(
  requiredBytes = 0,
  storage = globalThis.navigator?.storage,
) {
  if (!storage?.estimate) return null;
  try {
    const estimate = await storage.estimate();
    const quota = Number(estimate?.quota);
    const usage = Number(estimate?.usage);
    if (!Number.isFinite(quota) || !Number.isFinite(usage)) return null;
    const availableBytes = Math.max(0, quota - usage);
    const requestedBytes = Math.max(0, Number(requiredBytes) || 0);
    const reserveBytes =
      requestedBytes === 0
        ? 0
        : Math.max(
            MIN_STORAGE_RESERVE_BYTES,
            Math.min(32 * 1024 * 1024, Math.ceil(requestedBytes * 0.05)),
          );
    return {
      quotaBytes: quota,
      usageBytes: usage,
      availableBytes,
      requiredBytes: requestedBytes,
      enough: availableBytes >= requestedBytes + reserveBytes,
    };
  } catch {
    // Estimation is advisory. IndexedDB remains the source of truth.
    return null;
  }
}

async function readIndexedDbState() {
  const database = await openDatabase();
  if (!database) return null;

  const stateTransaction = database.transaction(STATE_STORE_NAME, "readonly");
  const metadata = await requestResult(
    stateTransaction.objectStore(STATE_STORE_NAME).get(STATE_KEY),
    "无法读取本地媒体库",
  );

  if (metadata) {
    knownStorageRevision = normalizeStorageRevision(metadata.storageRevision);
    const blobIds = [
      ...new Set(
        (Array.isArray(metadata.items) ? metadata.items : [])
          .map((item) => item?.blobId)
          .filter(Boolean),
      ),
    ];
    const blobs = new Map();
    if (blobIds.length > 0) {
      const blobTransaction = database.transaction(BLOB_STORE_NAME, "readonly");
      const store = blobTransaction.objectStore(BLOB_STORE_NAME);
      const records = await Promise.all(
        blobIds.map(async (id) => [id, await requestResult(store.get(id), "无法读取媒体文件")]),
      );
      records.forEach(([id, blob]) => {
        if (blob instanceof Blob) blobs.set(id, blob);
      });
    }
    return mergeLibraryStateWithBlobs(metadata, blobs);
  }

  // Version 1 stored the complete state (including every Blob) under one key.
  const legacyTransaction = database.transaction(LEGACY_STORE_NAME, "readonly");
  const legacyState = await requestResult(
    legacyTransaction.objectStore(LEGACY_STORE_NAME).get(STATE_KEY),
    "无法读取旧版媒体库",
  );
  knownStorageRevision = null;
  if (!legacyState) return null;

  // Migration is best-effort: the v1 state can still be restored even if the
  // browser is too close to quota to rewrite it immediately.
  await writeIndexedDbState(legacyState).catch(() => undefined);
  return legacyState;
}

async function readStoredBlobIds(database) {
  const transaction = database.transaction(BLOB_STORE_NAME, "readonly");
  const keys = await requestResult(
    transaction.objectStore(BLOB_STORE_NAME).getAllKeys(),
    "无法检查本地媒体文件",
  );
  return new Set(keys);
}

async function writeIndexedDbState(state) {
  const database = await openDatabase();
  if (!database) return { ok: false, reason: "unavailable" };

  const { metadata, blobs } = splitLibraryStateForStorage(state);
  const storedBlobIds = await readStoredBlobIds(database);
  const newBlobs = [...blobs].filter(([id]) => !storedBlobIds.has(id));
  const newBlobBytes = newBlobs.reduce((total, [, blob]) => total + (blob.size || 0), 0);
  const storageEstimate = await estimateLibraryStorage(newBlobBytes);
  if (storageEstimate && !storageEstimate.enough) {
    return { ok: false, reason: "quota", ...storageEstimate };
  }

  const transaction = database.transaction(
    [STATE_STORE_NAME, BLOB_STORE_NAME, LEGACY_STORE_NAME],
    "readwrite",
  );
  const stateStore = transaction.objectStore(STATE_STORE_NAME);
  const blobStore = transaction.objectStore(BLOB_STORE_NAME);
  const currentMetadata = await requestResult(stateStore.get(STATE_KEY), "无法检查媒体库版本");
  const currentRevision = normalizeStorageRevision(currentMetadata?.storageRevision);
  if (!storageRevisionsMatch(knownStorageRevision, currentRevision)) {
    await transactionResult(transaction, "无法检查媒体库版本");
    return { ok: false, reason: "stale" };
  }

  const nextRevision = createStorageRevision();
  stateStore.put({ ...metadata, storageRevision: nextRevision }, STATE_KEY);
  newBlobs.forEach(([id, blob]) => blobStore.put(blob, id));
  storedBlobIds.forEach((id) => {
    if (!blobs.has(id)) blobStore.delete(id);
  });
  transaction.objectStore(LEGACY_STORE_NAME).delete(STATE_KEY);
  await transactionResult(transaction, "无法保存本地媒体库");
  knownStorageRevision = nextRevision;
  return { ok: true, revision: nextRevision };
}

function failedSaveResult(error) {
  const name = error?.name;
  if (name === "QuotaExceededError") return { ok: false, reason: "quota", error };
  if (name === "InvalidStateError" || name === "NotAllowedError") {
    return { ok: false, reason: "unavailable", error };
  }
  return { ok: false, reason: "write-failed", error };
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
 * Writes are serialized so a slower transaction cannot overwrite a newer
 * favorite/selection change. Browser Blob records are written only once.
 */
export function saveLibraryState(state) {
  const bridge = getBridge();
  const write = async () => {
    try {
      return bridge?.saveLibraryState
        ? await bridge.saveLibraryState(state)
        : await writeIndexedDbState(state);
    } catch (error) {
      return failedSaveResult(error);
    }
  };

  saveQueue = saveQueue.catch(() => undefined).then(write);
  return saveQueue;
}

/** Lets page lifecycle handlers wait for all transactions already in flight. */
export function flushPendingLibrarySaves() {
  return saveQueue.catch(() => undefined);
}
