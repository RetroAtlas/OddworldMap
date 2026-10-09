import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { DEFAULT_CATS, seedView, settle, trackErrors } from "./helpers.js";

const pub = (name) => readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8");
const CACHE_NAME = /^const CACHE_NAME = "([^"]+)";$/m.exec(pub("sw.js"))[1];
const [SHEET] = JSON.parse(pub("sprites_ao.json")).sheets;

const VIEW = { game: "AO", level: "R1", path: 15 };
// an Oddysee screen the view never shows, and a stale set of each game
const CAMERA = "cams/ao/F1/F1P01C01.png";
const OLD_AO = ["cams/ao/sprites/000000000000/0.png", "cams/ao/sprites/000000000000/1.png"];
const OLD_AE = ["cams/ae/sprites/000000000000/0.png"];

test("storing a game's sprite sheet retires that game's other sets and nothing else", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedView(page, { cats: DEFAULT_CATS });
  await page.goto("/#AO/R1/15/9781/786/1.00");
  await settle(page, VIEW);
  await page.click("#settingsBtn");
  await page.check("#sCacheMap");
  await page.click("#settingsClose");
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  // the worker walks the cache in insertion order, so seeded ahead of the old
  // set, the camera and the other game's set have been passed by the time that
  // set is gone
  await page.evaluate(
    async ({ name, sheet, seeded }) => {
      const cache = await caches.open(name);
      await cache.delete(new URL(sheet, location.href).href);
      for (const f of seeded) await cache.put(new URL(f, location.href).href, new Response(f));
    },
    { name: CACHE_NAME, sheet: SHEET, seeded: [CAMERA, ...OLD_AE, ...OLD_AO] },
  );
  await page.evaluate(async () => {
    const sidebar = await import(new URL("js/sidebar.js", location.href).href);
    sidebar.toggleShow("objects");
  });

  const stored = () =>
    page.evaluate(
      async ({ name, camera }) => {
        const keys = await (await caches.open(name)).keys();
        return keys
          .map((k) => new URL(k.url).pathname.slice(1))
          .filter((p) => p === camera || p.includes("/sprites/"))
          .sort();
      },
      { name: CACHE_NAME, camera: CAMERA },
    );
  await expect.poll(stored, { timeout: 20000 }).toEqual([CAMERA, ...OLD_AE, SHEET].sort());
  expect(errors).toEqual([]);
});
