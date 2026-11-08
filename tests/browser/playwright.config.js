import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT = 8917;

export default defineConfig({
  testDir: ".",
  fullyParallel: true, // every test opens its own page, so a file's tests need no order
  retries: 0, // a flake must surface as red, not be retried away
  timeout: process.env.CI ? 20_000 : 10_000, // a test waits on the engine's clock for a few seconds at most; past this it has hung
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["./budget.js"]], // the budget reporter fails a run on a passed test over the budget
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1, // the renderer multiplies by DPR unrounded; 1 keeps canvas px = CSS px
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `python3 tests/browser/serve.py ${PORT} public`,
    cwd: ROOT,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false, // a stray server from another tree must not serve this suite
    stdout: "ignore",
    stderr: "ignore",
  },
});
