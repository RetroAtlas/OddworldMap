import { expect, test } from "@playwright/test";
import { ALL_CATS, SLIG, pixels, seedView, settle, trackErrors } from "./helpers.js";

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
  // the sidecar and the sheets land, then a paint carries the sprite
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

test("while the sidecar is still coming, nothing stands where a sprite will", async ({ page }) => {
  const errors = trackErrors(page);
  await seedView(page, { show: { objects: false }, cats: ALL_CATS });
  await page.goto(`/?embed=1#AE/MI/1/${SLIG.x1 + 12}/${SLIG.y1 - 10}/1.00`);
  await settle(page, SLIG);
  const marker = await pixels(page, SLIG);
  let release;
  const held = new Promise((r) => (release = r));
  await page.route(/sprites_ae\.json$/, async (route) => {
    await held;
    await route.continue();
  });
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const sidebar = await import(u("sidebar.js"));
    sidebar.toggleShow("objects");
  });
  const bare = await pixels(page, SLIG);
  const corner = (px) => px.slice(0, 4);
  expect(corner(bare)).not.toEqual(corner(marker));
  // an export would wait: the artwork is not ready without the sidecar
  expect(
    await page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const render = await import(u("render.js"));
      return render.artworkReady(st.state.path);
    }),
  ).toBe(false);
  const landed = page.waitForResponse(/sprites_ae\.json$/);
  release();
  await landed;
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
  expect(await pixels(page, SLIG)).not.toEqual(bare);
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
  // a second of repaints passes with the failure known, and nothing asks again
  await page.evaluate(async () => {
    const render = await import(new URL("js/render.js", location.href).href);
    for (let i = 0; i < 60; i++) {
      render.draw();
      await new Promise(requestAnimationFrame);
    }
  });
  expect(asks.length).toBe(1);
  // with the sidecar failed the slig stays on the map, as its marker: the same
  // pixels the objects off would paint
  expect(
    await page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const render = await import(u("render.js"));
      const t = st.state.path.tlvs.find((o) => o.name === "Slig");
      return render.objectShown(t);
    }),
  ).toBe(true);
  const fallen = await pixels(page, SLIG);
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const sidebar = await import(u("sidebar.js"));
    sidebar.toggleShow("objects");
  });
  expect(await pixels(page, SLIG)).toEqual(fallen);
  // the toggle coming on again is the one deliberate retry
  const second = page.waitForResponse(/sprites_ae\.json$/);
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const sidebar = await import(u("sidebar.js"));
    sidebar.toggleShow("objects");
  });
  await second;
  expect(asks.length).toBe(2);
  expect(errors.filter((e) => !/404|Failed to load/.test(e))).toEqual([]);
});

test("a sidecar of another shape is refused, and the objects stand as markers", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.route(/sprites_ae\.json$/, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sheets: ["cams/ae/sprites/000000000000/0.png"],
        anims: {},
        font: { sheet: 0 },
      }),
    }),
  );
  await seedView(page, { show: { objects: true }, cats: ALL_CATS });
  const landed = page.waitForResponse(/sprites_ae\.json$/);
  await page.goto(`/?embed=1#AE/MI/1/${SLIG.x1 + 12}/${SLIG.y1 - 10}/1.00`);
  await settle(page, SLIG);
  await landed;
  const drawn = await page.evaluate(async (s) => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("state.js"));
    const render = await import(u("render.js"));
    const t = st.state.path.tlvs.find((o) => o.name === "Slig" && o.x1 === s.x1 && o.y1 === s.y1);
    return render.hitBoxes(t, st.LAYOUT).map((b) => b.drawn);
  }, SLIG);
  expect(drawn).toEqual([true]);
  expect(errors).toEqual([]);
});

test("a view that opens with the objects shown asks for the sprite table beside the map data", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const order = [];
  page.on("request", (q) => {
    if (/map_data_ae\.json|sprites_ae\.json/.test(q.url()))
      order.push("ask " + q.url().split("/").pop());
  });
  page.on("response", (r) => {
    if (/map_data_ae\.json/.test(r.url())) order.push("got " + r.url().split("/").pop());
  });
  await seedView(page, { show: { objects: true }, cats: ALL_CATS });
  await page.goto(`/?embed=1#AE/MI/1/${SLIG.x1}/${SLIG.y1}/1.00`);
  await settle(page, SLIG);
  expect(order.indexOf("ask sprites_ae.json")).toBeGreaterThan(-1);
  expect(order.indexOf("ask sprites_ae.json")).toBeLessThan(order.indexOf("got map_data_ae.json"));
  expect(order.filter((o) => o === "ask sprites_ae.json")).toHaveLength(1);
  expect(errors).toEqual([]);
});
