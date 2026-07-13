import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Electron main-process local module graph links", async () => {
  await assert.doesNotReject(() =>
    build({
      root: projectRoot,
      configFile: false,
      logLevel: "silent",
      build: {
        ssr: path.join(projectRoot, "electron", "main.mjs"),
        write: false,
        rollupOptions: {
          external: (id) => !id.startsWith(".") && !path.isAbsolute(id),
        },
      },
    }),
  );
});
