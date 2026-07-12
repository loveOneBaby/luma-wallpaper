import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "release/**", "build/**", ".qa/**"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // React 19 automatic JSX runtime — no need to import React in scope.
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },
  {
    files: ["electron/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 2023,
      sourceType: "module",
    },
  },
  // wallpaper-renderer.mjs runs in the desktop-layer renderer (browser) context,
  // not the Node main process, so it needs browser globals on top of the above.
  {
    files: ["electron/wallpaper-renderer.mjs"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["shared/**/*.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      sourceType: "module",
    },
  },
  {
    files: ["vite.config.mjs", "eslint.config.js"],
    languageOptions: {
      globals: globals.node,
      sourceType: "module",
    },
  },
];
