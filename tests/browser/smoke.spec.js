import { test, expect } from "@playwright/test";
import { trackErrors, settle, settleAny } from "./helpers.js";

// The door below is pinned like an anchor: AO R1 P15's one followable at that
// spot, centre world (9781,786) — window-interior on both axes, which is what
// makes the view hash reproduce exactly.
const TRIP_HASH = "#AO/R1/15/9781/786/1.00";
const DOOR = { name: "Door", world: [9769, 774, 9793, 798] };

test("boot on an empty hash paints a map and no console errors", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await settleAny(page);
  const sample = await page.evaluate(() => {
    const cv = document.getElementById("cv");
    const ctx = cv.getContext("2d");
    const colors = new Set();
    for (let gy = 1; gy < 12; gy++)
      for (let gx = 1; gx < 16; gx++) {
        const d = ctx.getImageData(
          Math.round((cv.width * gx) / 16),
          Math.round((cv.height * gy) / 12),
          1,
          1,
        ).data;
        colors.add(`${d[0]},${d[1]},${d[2]}`);
      }
    return colors.size;
  });
  expect(sample, "distinct sampled canvas colors").toBeGreaterThanOrEqual(4);
  expect(errors).toEqual([]);
});

test("a view permalink lands where it points and reproduces itself", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/${TRIP_HASH}`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  // a plain view hash is never rewritten, so asserting location.hash alone would
  // be vacuous — the round trip is parse -> apply -> format landing on the same string
  const r = await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const nav = await import(u("navigate.js"));
    return { hash: location.hash, view: nav.viewHash() };
  });
  expect(r.view).toBe(TRIP_HASH);
  expect(r.hash).toBe(TRIP_HASH);
  expect(errors).toEqual([]);
});

test("clicking a door follows it to the level and path it names", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/${TRIP_HASH}`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  const pt = await page.evaluate(async (d) => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("state.js"));
    const model = await import(u("model.js"));
    const t = st.state.path.tlvs.find(
      (t) => t.name === d.name && t.x1 === d.world[0] && t.y1 === d.world[1],
    );
    const [cx, cy] = model.markerCentre(t, st.LAYOUT);
    const r = document.getElementById("cv").getBoundingClientRect();
    const { cam } = st.state;
    return { x: r.left + (cx - cam.x) * cam.z, y: r.top + (cy - cam.y) * cam.z };
  }, DOOR);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction(() => location.hash.startsWith("#AO/R1/16/"));
  expect(errors).toEqual([]);
});

test("?embed=1 hides the chrome and offers the way to the full site", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/?embed=1#AO/R2/1/554/287/1.00");
  await settle(page, { game: "AO", level: "R2", path: 1 });
  for (const el of await page.locator(".chrome").all()) await expect(el).toBeHidden();
  await expect(page.locator("#openSiteBtn")).toBeVisible();
  expect(errors).toEqual([]);
});

test("search moves the view to what it finds", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/${TRIP_HASH}`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  const before = await page.evaluate(async () => {
    const st = await import(new URL("js/state.js", location.href).href);
    return { hash: location.hash, cam: { ...st.state.cam } };
  });
  await page.fill("#searchInput", "lcdstatusboard");
  await page.waitForSelector("#searchResults .hit"); // results render on a debounce
  await page.press("#searchInput", "Enter");
  await page.waitForFunction((h) => location.hash !== h, before.hash);
  const after = await page.evaluate(async () => {
    const st = await import(new URL("js/state.js", location.href).href);
    return { ...st.state.cam };
  });
  expect(after).not.toEqual(before.cam);
  expect(errors).toEqual([]);
});

test("a settings toggle survives a reload", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await settleAny(page);
  await expect(page.locator("body")).toHaveClass(/fullnames/);
  await page.click("#settingsBtn");
  await page.uncheck("#sFullNames");
  await page.click("#settingsClose");
  await page.reload();
  await settleAny(page);
  // the persisted value must drive boot on its own, before the dialog is opened
  await expect(page.locator("body")).not.toHaveClass(/fullnames/);
  await page.click("#settingsBtn");
  await expect(page.locator("#sFullNames")).not.toBeChecked();
  expect(errors).toEqual([]);
});
