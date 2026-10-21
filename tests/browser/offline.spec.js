import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { DEFAULT_CATS, seedView, settle, trackErrors } from "./helpers.js";

const pub = (name) => readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8");
const CACHE_NAME = /^const CACHE_NAME = "([^"]+)";$/m.exec(pub("sw.js"))[1];
const SHEETS = Object.values(JSON.parse(pub("sprites_ao.json")).sheets);

const VIEW = { game: "AO", level: "R1", path: 15 };
// an Oddysee screen the view never shows, a stale Slig sheet of the other game,
// stale sheets of a family no sidecar names and of one the view may not draw, an
// Oddysee file that is no family's sheet, and a stale Oddysee Slig sheet
const CAMERA = "cams/ao/F1/F1P01C01.png";
const OLD_AE = "cams/ae/sprites/Slig.000000000000.png";
const OLD_GONE = "cams/ao/sprites/Gone.000000000000.png";
const OLD_SCRAB = "cams/ao/sprites/Scrab.000000000000.png";
const STRAY = "cams/ao/sprites/000000000000/0.png";
const OLD_AO = "cams/ao/sprites/Slig.000000000000.png";

test("storing a family's sprite sheet retires that family's other sheets and what is no sheet, and nothing else", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const requested = new Set();
  page.on("request", (q) => {
    const p = new URL(q.url()).pathname.slice(1);
    if (p.startsWith("cams/ao/sprites/")) requested.add(p);
  });
  await seedView(page, { cats: DEFAULT_CATS });
  await page.goto("/#AO/R1/15/9781/786/1.00");
  await settle(page, VIEW);
  await page.click("#settingsBtn");
  await page.check("#sCacheMap");
  await page.click("#settingsClose");
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  // the worker walks the cache in insertion order, so seeded ahead of the two it
  // must take, the camera and the others have been passed by the time those are gone
  await page.evaluate(
    async ({ name, sheets, seeded }) => {
      const cache = await caches.open(name);
      for (const f of sheets) await cache.delete(new URL(f, location.href).href);
      for (const f of seeded) await cache.put(new URL(f, location.href).href, new Response(f));
    },
    {
      name: CACHE_NAME,
      sheets: SHEETS,
      seeded: [CAMERA, OLD_AE, OLD_GONE, OLD_SCRAB, STRAY, OLD_AO],
    },
  );
  // the sheets the page asks for pass through the worker, and land before the read
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const sidebar = await import(u("sidebar.js"));
    const st = await import(u("state.js"));
    const render = await import(u("render.js"));
    sidebar.toggleShow("objects");
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await render.preloadPath(st.state.path);
      if (render.artworkReady(st.state.path)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  });
  const families = new Set([...requested].map((p) => p.split("/")[3].split(".")[0]));
  expect(families.has("Slig")).toBe(true);

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
  const kept = [CAMERA, OLD_AE, OLD_GONE, ...(families.has("Scrab") ? [] : [OLD_SCRAB])];
  await expect.poll(stored, { timeout: 20000 }).toEqual([...kept, ...requested].sort());
  expect(errors).toEqual([]);
});

test("storing a release's file retires that file's earlier copies, and nothing else", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const [[x, y, own]] = JSON.parse(pub("release_ao_jp.json")).paths["R1/15"].cams.R1P15C02.patches;
  // a stale copy of the same patch, a patch of the same screen at another
  // place, one of a file of another name the page never asks for, and the
  // base's own picture of the screen
  const OLD = `cams/ao/jp/R1/R1P15C02_${x}_${y}.000000000000.png`;
  const PLACE = `cams/ao/jp/R1/R1P15C02_${x + 16}_${y}.000000000000.png`;
  const OTHER = "cams/ao/jp/R2/R2P01C01_fg37.000000000000.png";
  const BASE = "cams/ao/R1/R1P15C02.png";
  await page.goto("/#AO/R1/15/2470/180/3.00/jp");
  await settle(page, VIEW);
  await page.click("#settingsBtn");
  await page.check("#sCacheMap");
  await page.click("#settingsClose");
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(
    async ({ name, own, seeded }) => {
      const cache = await caches.open(name);
      await cache.delete(new URL(own, location.href).href);
      for (const f of seeded) await cache.put(new URL(f, location.href).href, new Response(f));
      await (await fetch(own)).blob();
    },
    { name: CACHE_NAME, own, seeded: [OLD, PLACE, OTHER, BASE] },
  );
  const stored = () =>
    page.evaluate(
      async ({ name, files }) => {
        const keys = await (await caches.open(name)).keys();
        return keys
          .map((k) => new URL(k.url).pathname.slice(1))
          .filter((p) => files.includes(p))
          .sort();
      },
      { name: CACHE_NAME, files: [own, OLD, PLACE, OTHER, BASE] },
    );
  await expect.poll(stored, { timeout: 20000 }).toEqual([BASE, OTHER, PLACE, own].sort());
  expect(errors).toEqual([]);
});
