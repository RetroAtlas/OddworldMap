import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CI runs the browser suite in Playwright's own container image, which carries
// the browser build the pinned @playwright/test expects, so the two versions
// have to move together.
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const workflow = read(".github/workflows/ci.yml");
const pinned = JSON.parse(read("package.json")).devDependencies["@playwright/test"];

test("the browser job runs in Playwright's image at the pinned version and installs no browser", () => {
  assert.match(pinned, /^\d+\.\d+\.\d+$/, "@playwright/test is pinned to an exact version");
  const images = [
    ...workflow.matchAll(/^\s*image: mcr\.microsoft\.com\/playwright:v(\S+)-noble$/gm),
  ].map((m) => m[1]);
  assert.deepEqual(
    images,
    [pinned],
    `the workflow names Playwright's image once, at v${pinned}-noble`,
  );
  assert.doesNotMatch(
    workflow,
    /playwright install/,
    "the image carries the browser, so no step installs one",
  );
});
