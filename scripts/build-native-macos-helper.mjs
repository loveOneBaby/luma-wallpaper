import { execFile } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const NATIVE_MAC_HELPER_RELATIVE_PATH = path.join(
  "native",
  "luma-mac-update-helper",
);

export function macArchitectureForElectronBuilder(arch) {
  if (arch === 1 || arch === "x64") return "x86_64";
  if (arch === 3 || arch === "arm64") return "arm64";
  throw new Error(`Unsupported macOS helper architecture: ${arch}`);
}

export async function compileNativeMacHelper({ appOutDir, arch, productFilename = "Luma" }) {
  const macArchitecture = macArchitectureForElectronBuilder(arch);
  const sourcePath = path.join(
    repositoryRoot,
    "build",
    "native-macos-updater",
    "Sources",
    "main.swift",
  );
  const resourcesDirectory = path.join(
    appOutDir,
    `${productFilename}.app`,
    "Contents",
    "Resources",
  );
  const outputPath = path.join(resourcesDirectory, NATIVE_MAC_HELPER_RELATIVE_PATH);
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o755 });

  await execFileAsync(
    "/usr/bin/xcrun",
    [
      "--sdk",
      "macosx",
      "swiftc",
      sourcePath,
      "-O",
      "-whole-module-optimization",
      "-target",
      `${macArchitecture}-apple-macos11.0`,
      "-o",
      outputPath,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  await chmod(outputPath, 0o755);

  const { stdout } = await execFileAsync("/usr/bin/lipo", ["-archs", outputPath]);
  const architectures = stdout.trim().split(/\s+/);
  if (!architectures.includes(macArchitecture)) {
    throw new Error(
      `Native macOS update helper was built for ${architectures.join(", ")}, expected ${macArchitecture}`,
    );
  }

  return outputPath;
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  await compileNativeMacHelper({
    appOutDir: context.appOutDir,
    arch: context.arch,
    productFilename: context.packager.appInfo.productFilename,
  });
}
