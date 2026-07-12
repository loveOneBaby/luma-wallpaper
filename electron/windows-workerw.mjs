/**
 * WorkerW discovery is an independent, reduced implementation adapted from
 * Flying Bird Wallpaper by OXOYO (MIT). See THIRD_PARTY_NOTICES.md.
 *
 * Unlike the reference implementation, HWND/LONG_PTR values stay pointer-sized
 * so 64-bit Electron window handles are not truncated.
 */

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CHILD = 0x40000000n;
const WS_POPUP = 0x80000000n;
const WS_EX_LAYERED = 0x00080000n;
const WS_EX_TRANSPARENT = 0x00000020n;
const LWA_ALPHA = 0x00000002;
const SW_SHOW = 5;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;
const HWND_BOTTOM = 1n;

let koffiRuntime;
let user32;
let enumWindowsCallback;
let enumWallpaperHost = 0n;

function wide(value) {
  return Buffer.from(`${value}\0`, "utf16le");
}

function isNullHandle(value) {
  return value === null || value === undefined || BigInt(value) === 0n;
}

function nativeWindowHandle(browserWindow) {
  const buffer = browserWindow.getNativeWindowHandle();
  if (buffer.length >= 8) return buffer.readBigUInt64LE(0);
  return BigInt(buffer.readUInt32LE(0));
}

async function getUser32() {
  if (user32) return user32;

  const koffiModule = await import("koffi");
  koffiRuntime = koffiModule.default ?? koffiModule;

  const library = koffiRuntime.load("user32.dll");
  const enumWindowsProto = koffiRuntime.proto(
    "__stdcall",
    "LumaEnumWindowsProc",
    "int32",
    ["uintptr_t", "intptr_t"],
  );
  const longPtrSuffix = process.arch === "ia32" ? "LongW" : "LongPtrW";

  user32 = {
    enumWindowsProto,
    FindWindowW: library.func("FindWindowW", "uintptr_t", ["void *", "void *"]),
    FindWindowExW: library.func("FindWindowExW", "uintptr_t", [
      "uintptr_t",
      "uintptr_t",
      "void *",
      "void *",
    ]),
    SendMessageTimeoutW: library.func("SendMessageTimeoutW", "intptr_t", [
      "uintptr_t",
      "uint32",
      "uintptr_t",
      "intptr_t",
      "uint32",
      "uint32",
      "void *",
    ]),
    EnumWindows: library.func("EnumWindows", "int32", [
      koffiRuntime.pointer(enumWindowsProto),
      "intptr_t",
    ]),
    SetParent: library.func("SetParent", "uintptr_t", ["uintptr_t", "uintptr_t"]),
    GetParent: library.func("GetParent", "uintptr_t", ["uintptr_t"]),
    GetWindowLongPtrW: library.func(`GetWindow${longPtrSuffix}`, "intptr_t", [
      "uintptr_t",
      "int32",
    ]),
    SetWindowLongPtrW: library.func(`SetWindow${longPtrSuffix}`, "intptr_t", [
      "uintptr_t",
      "int32",
      "intptr_t",
    ]),
    SetLayeredWindowAttributes: library.func("SetLayeredWindowAttributes", "int32", [
      "uintptr_t",
      "uint32",
      "uint8",
      "uint32",
    ]),
    SetWindowPos: library.func("SetWindowPos", "int32", [
      "uintptr_t",
      "uintptr_t",
      "int32",
      "int32",
      "int32",
      "int32",
      "uint32",
    ]),
    ShowWindow: library.func("ShowWindow", "int32", ["uintptr_t", "int32"]),
  };

  enumWindowsCallback = koffiRuntime.register(
    (topLevelWindow) => {
      const defView = user32.FindWindowExW(
        topLevelWindow,
        0n,
        wide("SHELLDLL_DefView"),
        null,
      );

      if (!isNullHandle(defView)) {
        const nextWorker = user32.FindWindowExW(
          0n,
          topLevelWindow,
          wide("WorkerW"),
          null,
        );
        if (!isNullHandle(nextWorker)) enumWallpaperHost = BigInt(nextWorker);
      }

      return 1;
    },
    koffiRuntime.pointer(enumWindowsProto),
  );

  return user32;
}

async function findWallpaperHost() {
  const api = await getUser32();
  const progman = api.FindWindowW(wide("Progman"), null);
  if (isNullHandle(progman)) throw new Error("未找到 Windows Progman 桌面窗口");

  // Ask Explorer to create the WorkerW layer behind desktop icons.
  api.SendMessageTimeoutW(BigInt(progman), 0x052c, 0n, 0n, 0, 1000, null);

  enumWallpaperHost = 0n;
  api.EnumWindows(enumWindowsCallback, 0n);

  // Progman is a conservative fallback for Explorer variants without WorkerW.
  return enumWallpaperHost || BigInt(progman);
}

export async function attachWindowToWorkerW(browserWindow, bounds) {
  if (process.platform !== "win32") {
    return { ok: false, message: "WorkerW 仅适用于 Windows" };
  }

  const api = await getUser32();
  const wallpaperHost = await findWallpaperHost();
  const hwnd = nativeWindowHandle(browserWindow);

  api.SetParent(hwnd, wallpaperHost);

  const style = BigInt(api.GetWindowLongPtrW(hwnd, GWL_STYLE));
  api.SetWindowLongPtrW(hwnd, GWL_STYLE, (style | WS_CHILD) & ~WS_POPUP);

  const extendedStyle = BigInt(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  api.SetWindowLongPtrW(
    hwnd,
    GWL_EXSTYLE,
    extendedStyle | WS_EX_LAYERED | WS_EX_TRANSPARENT,
  );
  api.SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);

  const positioned = api.SetWindowPos(
    hwnd,
    HWND_BOTTOM,
    0,
    0,
    Math.max(1, Math.round(bounds.width)),
    Math.max(1, Math.round(bounds.height)),
    SWP_NOACTIVATE | SWP_SHOWWINDOW,
  );
  api.ShowWindow(hwnd, SW_SHOW);

  if (!positioned) throw new Error("WorkerW 已找到，但动态壁纸窗口挂载失败");
  const attachedParent = api.GetParent(hwnd);
  if (isNullHandle(attachedParent) || BigInt(attachedParent) !== wallpaperHost) {
    throw new Error("动态壁纸窗口被其他桌面程序占用，请退出后重试");
  }
  return { ok: true, mode: enumWallpaperHost ? "workerw" : "progman" };
}
