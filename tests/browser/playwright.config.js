import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT = 8917;

export default defineConfig({
  testDir: ".",
  workers: 1, // one shared static server; determinism over speed
  retries: 0, // a flake must surface as red, not be retried away
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1, // the renderer multiplies by DPR unrounded; 1 keeps canvas px = CSS px
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `python3 -m http.server ${PORT} -d public`,
    cwd: ROOT,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false, // a stray server from another tree must not serve this suite
    stdout: "ignore",
    stderr: "ignore",
  },
});
