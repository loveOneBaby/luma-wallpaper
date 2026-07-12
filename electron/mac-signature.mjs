import { spawnSync } from "node:child_process";

const DEVELOPER_ID_APPLICATION_OID = "1.2.840.113635.100.6.1.13";
const DEVELOPER_ID_INTERMEDIATE_OID = "1.2.840.113635.100.6.2.6";

function runCodesign(args, runner) {
  try {
    return runner("/usr/bin/codesign", args, { encoding: "utf8" });
  } catch {
    return null;
  }
}

export function hasValidDeveloperIdApplicationSignature(appBundlePath, runner = spawnSync) {
  if (typeof appBundlePath !== "string" || !appBundlePath.trim()) return false;

  const verification = runCodesign(
    ["--verify", "--deep", "--strict", "--verbose=2", appBundlePath],
    runner,
  );
  if (!verification || verification.error || verification.signal || verification.status !== 0) {
    return false;
  }

  const inspection = runCodesign(["-d", "-r-", "--verbose=4", appBundlePath], runner);
  if (!inspection || inspection.error || inspection.signal || inspection.status !== 0) return false;

  const details = `${inspection.stdout ?? ""}\n${inspection.stderr ?? ""}`;
  const authority = details.match(/^Authority=(Developer ID Application:.+)$/m)?.[1];
  const teamIdentifier = details.match(/^TeamIdentifier=([^\s]+)$/m)?.[1];
  const requirement = details.match(/^designated\s*=>\s*(.+)$/m)?.[1];
  const authorityTeamIdentifier = authority?.match(/\(([A-Z0-9]+)\)\s*$/)?.[1];

  return Boolean(
    authority &&
    teamIdentifier &&
    teamIdentifier !== "not" &&
    teamIdentifier !== "not-set" &&
    authorityTeamIdentifier === teamIdentifier &&
    requirement?.includes("anchor apple generic") &&
    requirement.includes(DEVELOPER_ID_APPLICATION_OID) &&
    requirement.includes(DEVELOPER_ID_INTERMEDIATE_OID),
  );
}
