// With no build step, a syntax error or stale reference in the viewer only
// surfaces when that code path runs in a browser; linting every file is the
// safety net.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "tools/*", "!tools/levelpages.js", "!tools/pixels.js"] },
  js.configs.recommended,
  {
    files: ["public/js/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: globals.browser,
    },
  },
  {
    files: ["tools/levelpages.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: globals.node,
    },
  },
  {
    // the pixel proof: a Node script whose page.evaluate bodies run in the browser
    files: ["tools/pixels.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ["public/sw.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "script",
      globals: globals.serviceworker,
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: globals.node,
    },
  },
  {
    // Playwright specs: Node test files whose page.evaluate bodies run in the browser
    files: ["tests/browser/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
