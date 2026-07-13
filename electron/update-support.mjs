import path from "node:path";
import { hasValidDeveloperIdApplicationSignature } from "./mac-signature.mjs";

export function resolveMacAppBundlePath(execPath) {
  if (typeof execPath !== "string" || !execPath.trim()) return null;
  return path.resolve(path.dirname(execPath), "../..");
}

/**
 * Determine update support and expose package integrity separately. An
 * unsigned macOS build remains supported by product decision, while callers
 * can surface that it has no Developer ID integrity verification.
 */
export function getUpdaterSupport(
  { isPackaged, platform, execPath },
  signatureVerifier = hasValidDeveloperIdApplicationSignature,
) {
  if (!isPackaged) {
    return { supported: false, reason: "development", signed: null, integrity: "development" };
  }
  if (platform !== "darwin" && platform !== "win32") {
    return { supported: false, reason: "platform", signed: null, integrity: "unsupported" };
  }
  if (platform === "darwin") {
    const appBundlePath = resolveMacAppBundlePath(execPath);
    const signed = Boolean(appBundlePath && signatureVerifier(appBundlePath));
    return {
      supported: true,
      reason: null,
      signed,
      integrity: signed ? "developer-id" : "unverified",
    };
  }
  return { supported: true, reason: null, signed: null, integrity: "platform-managed" };
}
