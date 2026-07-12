import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Injects a strict Content-Security-Policy meta into the built index.html
// only. Dev is left without a CSP so Vite's inline React-Refresh preamble runs
// unhindered; the production bundle has no inline scripts, so script-src stays
// strict 'self'. (A static meta in index.html would either break dev or
// require 'unsafe-inline' in production — this avoids both.)
function cspMetaPlugin() {
  let isBuild = false;
  return {
    name: "luma-csp-meta",
    config(_, { command }) {
      isBuild = command === "build";
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (!isBuild) return html;
        const policy = [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: luma-media:",
          "media-src 'self' blob: luma-media: data:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "object-src 'none'",
        ].join("; ");
        const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
        return html.replace(/(<meta charset="[^"]*"\s*\/?>)/, `$1\n    ${tag}`);
      },
    },
  };
}

export default defineConfig({
  base: "./",
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(), cspMetaPlugin()],
});
