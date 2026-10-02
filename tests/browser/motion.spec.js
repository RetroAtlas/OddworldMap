import { test, expect } from "@playwright/test";
import { seedView, settle, trackErrors } from "./helpers.js";

// the sleeping slig at the mouth of the Mines, read off the shipped data: its
// marker box and where its sprite stands
const SLIG = { game: "AE", level: "MI", path: 1, x1: 1400, y1: 700, x2: 1424, y2: 724 };
// the pulley of the Mines' first lift, three screens above the lift's rect, and a band
// of the top wheel's frame between the two ropes
const PULLEY = { game: "AE", level: "MI", path: 1, x1: 4025, y1: 925, x2: 4049, y2: 949 };
const WHEEL = { x1: 4032, y1: 900, x2: 4046, y2: 920 };

// the canvas pixels under a world rectangle, as [r, g, b, a] rows
async function pixels(page, rect) {
  return page.evaluate(async (r) => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("state.js"));
    const cv = document.getElementById("cv");
    const ctx = cv.getContext("2d");
    const z = st.state.cam.z;
    const x = (st.dX(r.x1) - st.state.cam.x) * z,
      y = (st.dY(r.y1) - st.state.cam.y) * z;
    const w = (st.dX(r.x2) - st.dX(r.x1)) * z,
      h = (st.dY(r.y2) - st.dY(r.y1)) * z;
    return [...ctx.getImageData(Math.round(x), Math.round(y), Math.round(w), Math.round(h)).data];
  }, rect);
}

const ALL_CATS = {
  board: true,
  mud: true,
  door: true,
  cont: true,
  switch: true,
  hazard: true,
  enemy: true,
  pickup: true,
  screen: true,
  nav: true,
  meta: true,
};

test.describe("Objects as themselves", () => {
  test("the toggle swaps a marker for the game's sprite, fetching the sidecar once, and leaves the console clean", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const sidecar = [];
    page.on("request", (q) => {
      if (/sprites_ae\.json$/.test(q.url())) sidecar.push(q.url());
    });
    await seedView(page, { show: { objects: false }, cats: ALL_CATS });
    // a view hash centred on the slig, zoom 1, so canvas pixels are world units
    await page.goto(`/?embed=1#AE/MI/1/${SLIG.x1 + 12}/${SLIG.y1 - 10}/1.00`);
    await settle(page, SLIG);
    const before = await pixels(page, SLIG);
    expect(sidecar).toHaveLength(0);

    await page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const sidebar = await import(u("sidebar.js"));
      sidebar.toggleShow("objects");
    });
    // the sidecar and the sheet land, then a paint carries the sprite
    await page.waitForFunction(() => document.getElementById("tObjects").checked);
    await page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const render = await import(u("render.js"));
      const deadline = Date.now() + 20000;
      // the painter asks for the sheets through preloadPath once the sidecar is in
      while (Date.now() < deadline) {
        await render.preloadPath(st.state.path);
        if (render.artworkReady(st.state.path)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      render.draw();
    });
    await page.waitForTimeout(400);
    await page.evaluate(async () => {
      const render = await import(new URL("js/render.js", location.href).href);
      render.draw();
    });
    const after = await pixels(page, SLIG);
    expect(sidecar).toHaveLength(1);
    expect(after).not.toEqual(before);
    // the marker's own outline colour (the enemies' purple) is gone from the box's corner
    const corner = (px) => px.slice(0, 4);
    expect(corner(after)).not.toEqual(corner(before));
    expect(errors).toEqual([]);
  });

  test("a sidecar that fails to load is asked for once, the objects fall back to markers, and the toggle retries", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const asks = [];
    await page.route(/sprites_ae\.json$/, (route) => {
      asks.push(route.request().url());
      route.fulfill({ status: 404, body: "" });
    });
    await seedView(page, { show: { objects: true }, cats: ALL_CATS });
    const first = page.waitForResponse(/sprites_ae\.json$/);
    await page.goto(`/?embed=1#AE/MI/1/${SLIG.x1 + 12}/${SLIG.y1 - 10}/1.00`);
    await settle(page, SLIG);
    await first;
    // a second of the clock passes with the failure known, and nothing asks again
    await page.evaluate(async () => {
      window.__motion = await import(new URL("js/motion.js", location.href).href);
    });
    const tick = await page.evaluate(() => window.__motion.motionTick());
    await page.waitForFunction((was) => window.__motion.motionTick() > was + 30, tick);
    expect(asks.length).toBe(1);
    // with the sidecar failed the slig stays on the map, as its marker: the same
    // pixels the objects off would paint
    const fallen = await pixels(page, SLIG);
    await page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const sidebar = await import(u("sidebar.js"));
      sidebar.toggleShow("objects");
    });
    expect(await pixels(page, SLIG)).toEqual(fallen);
    // the toggle coming on again is the one deliberate retry
    const second = page.waitForRequest(/sprites_ae\.json$/);
    await page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const sidebar = await import(u("sidebar.js"));
      sidebar.toggleShow("objects");
    });
    await second;
    expect(asks.length).toBe(2);
    expect(errors.filter((e) => !/404|Failed to load/.test(e))).toEqual([]);
  });

  test("a lift's top wheel is drawn at its pulley, screens above the lift's own rect", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await seedView(page, { show: { objects: true }, cats: ALL_CATS });
    await page.goto(`/?embed=1#AE/MI/1/${PULLEY.x1 + 12}/${PULLEY.y1 + 12}/1.00`);
    await settle(page, PULLEY);
    await page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const render = await import(u("render.js"));
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        await render.preloadPath(st.state.path);
        if (render.artworkReady(st.state.path)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      render.draw();
    });
    const withWheel = await pixels(page, WHEEL);
    await page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const sidebar = await import(u("sidebar.js"));
      sidebar.toggleShow("objects");
    });
    expect(await pixels(page, WHEEL)).not.toEqual(withWheel);
    expect(errors).toEqual([]);
  });

  test("Dim backgrounds dims the foreground masks drawn over the sprites too", async ({ page }) => {
    const errors = trackErrors(page);
    // no categories on: with the objects off every marker draws, and one could cover the pixel
    await seedView(page, {
      show: { objects: true, dim: true, labels: false, grid: false },
    });
    await page.goto("/?embed=1#AO/R1/15");
    await settle(page, { game: "AO", level: "R1", path: 15 });
    // a point inside a piece of foreground: the first opaque pixel of the first mask
    const at = await page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const { path } = st.state;
      const c = path.cams.find((c) => c.fg);
      const im = new Image();
      im.src = new URL(c.fg, location.href).href;
      await im.decode();
      const oc = document.createElement("canvas");
      oc.width = im.naturalWidth;
      oc.height = im.naturalHeight;
      const octx = oc.getContext("2d");
      octx.drawImage(im, 0, 0);
      const px = octx.getImageData(0, 0, oc.width, oc.height).data;
      let i = 0;
      while (i < px.length && px[i + 3] === 0) i += 4;
      const p = i / 4;
      const L = st.LAYOUT;
      const x = (c.cell % path.w) * L.worldW + L.winX + ((p % oc.width) * L.visW) / oc.width;
      const y =
        Math.floor(c.cell / path.w) * L.worldH +
        L.winY +
        (Math.floor(p / oc.width) * L.visH) / oc.height;
      return { x, y };
    });
    await page.evaluate((p) => {
      location.hash = `#AO/R1/15/${p.x}/${p.y}/1.00`;
    }, at);
    await settle(page, { game: "AO", level: "R1", path: 15 });
    const read = () =>
      page.evaluate(async (p) => {
        const u = (m) => new URL("js/" + m, location.href).href;
        const st = await import(u("state.js"));
        const render = await import(u("render.js"));
        await render.preloadPath(st.state.path);
        render.draw();
        const z = st.state.cam.z;
        const x = Math.round((st.dX(p.x) - st.state.cam.x) * z),
          y = Math.round((st.dY(p.y) - st.state.cam.y) * z);
        return [...document.getElementById("cv").getContext("2d").getImageData(x, y, 1, 1).data];
      }, at);
    const toggle = (key) =>
      page.evaluate(async (k) => {
        const sidebar = await import(new URL("js/sidebar.js", location.href).href);
        sidebar.toggleShow(k);
      }, key);
    // the foreground is the same art as the screen beneath it, so a dimmed mask
    // reads as the dimmed screen does, give or take the compositing's rounding
    const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 3);
    const dimmedOverSprites = await read();
    await toggle("objects");
    const dimmedScreen = await read();
    expect(close(dimmedOverSprites, dimmedScreen), `${dimmedOverSprites} vs ${dimmedScreen}`).toBe(
      true,
    );
    await toggle("dim");
    expect(close(await read(), dimmedScreen)).toBe(false);
    expect(errors).toEqual([]);
  });

  test("the o key flips the toggle and the shortcuts dialog lists it", async ({ page }) => {
    const errors = trackErrors(page);
    await seedView(page, { show: { objects: false }, cats: ALL_CATS });
    await page.goto(`/#AE/MI/1/${SLIG.x1}/${SLIG.y1}/1.00`);
    await settle(page, SLIG);
    await page.keyboard.press("o");
    await expect(page.locator("#tObjects")).toBeChecked();
    await page.keyboard.press("o");
    await expect(page.locator("#tObjects")).not.toBeChecked();
    await expect(page.locator("#shortcutsBody")).toContainText("objects as themselves");
    expect(errors).toEqual([]);
  });
});
