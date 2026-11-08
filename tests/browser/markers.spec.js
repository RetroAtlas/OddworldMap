import { expect, test } from "@playwright/test";
import { ALL_CATS, BOUND, pixels, seedView, settle, trackErrors } from "./helpers.js";

// a bird portal's exit in Necrum, pointed at by an arrow and by nothing else
const EXIT = { game: "AE", level: "NE", path: 2, x1: 650, y1: 440, x2: 674, y2: 464 };

test("an arrival only an arrow points at stays while the arrows are drawn", async ({ page }) => {
  const errors = trackErrors(page);
  await seedView(page, { show: { objects: true, markers: false, conn: true }, cats: ALL_CATS });
  await page.goto(`/?embed=1#AE/NE/2/${EXIT.x1}/${EXIT.y1}/1.00`);
  await settle(page, EXIT);
  const exit = () =>
    page.evaluate(async (e) => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const render = await import(u("render.js"));
      const t = st.state.path.tlvs.find((o) => o.name === "BirdPortalExit" && o.x1 === e.x1);
      return render.objectShown(t);
    }, EXIT);
  expect(await exit()).toBe(true);
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const sidebar = await import(u("sidebar.js"));
    sidebar.toggleShow("conn");
  });
  expect(await exit()).toBe(false);
  expect(errors).toEqual([]);
});

test("the kept set follows the filters: a way out whose category comes on joins it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedView(page, {
    show: { objects: true, markers: false, conn: true },
    cats: { ...ALL_CATS, door: false },
  });
  await page.goto(`/#AE/NE/2/${EXIT.x1}/${EXIT.y1}/1.00`);
  await settle(page, EXIT);
  const exit = () =>
    page.evaluate(async (e) => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const render = await import(u("render.js"));
      const t = st.state.path.tlvs.find((o) => o.name === "BirdPortalExit" && o.x1 === e.x1);
      return render.objectShown(t);
    }, EXIT);
  expect(await exit()).toBe(false);
  // the filter's own checkbox, clicked as the pointer would
  const doors = (on) =>
    page.evaluate((want) => {
      const row = [...document.querySelectorAll("label.checkrow")].find((l) =>
        l.textContent.includes("Doors / Transitions"),
      );
      const cb = row.querySelector("input");
      if (cb.checked !== want) cb.click();
    }, on);
  await doors(true);
  expect(await exit()).toBe(true);
  await doors(false);
  expect(await exit()).toBe(false);
  expect(errors).toEqual([]);
});

test("Markers for the rest needs the objects shown; off, a bound's marker leaves the map", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedView(page, { show: { objects: false, markers: true, wires: false }, cats: ALL_CATS });
  await page.goto(`/?embed=1#AE/MI/1/${BOUND.x1 + 12}/${BOUND.y1 - 10}/1.00`);
  await settle(page, BOUND);
  const markers = page.locator("#tMarkers");
  await expect(markers).toBeDisabled();
  await expect(markers).toBeChecked();
  await expect(page.locator("label:has(#tMarkers)")).toHaveAttribute(
    "title",
    /needs .*Objects as themselves/,
  );
  const withMarker = await pixels(page, BOUND);
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const sidebar = await import(u("sidebar.js"));
    sidebar.toggleShow("objects");
  });
  await expect(markers).toBeEnabled();
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
  // a bound has no sprite, so its marker stays while the toggle is on
  expect(await pixels(page, BOUND)).toEqual(withMarker);
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const sidebar = await import(u("sidebar.js"));
    sidebar.toggleShow("markers");
  });
  await expect(markers).not.toBeChecked();
  await page.evaluate(async () => {
    const render = await import(new URL("js/render.js", location.href).href);
    render.draw();
  });
  expect(await pixels(page, BOUND)).not.toEqual(withMarker);
  const hovered = await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("state.js"));
    const render = await import(u("render.js"));
    const t = st.state.path.tlvs.find((o) => o.name === "SligBoundLeft" && o.x1 === 1175);
    return render.objectShown(t);
  });
  expect(hovered).toBe(false);
  // an open door's type is drawn, so the door stays on the map unseen
  const door = await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("state.js"));
    const render = await import(u("render.js"));
    const t = st.state.path.tlvs.find((o) => o.name === "Door" && o.fields?.start_state === 0);
    return t && render.objectShown(t);
  });
  expect(door).toBe(true);
  // a well has no sprite in Exoddus but is a way out, so it stays as well
  const well = await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("state.js"));
    const render = await import(u("render.js"));
    const t = st.state.path.tlvs.find((o) => o.name === "WellExpress" && o.x1 === 1025);
    return t && render.objectShown(t);
  });
  expect(well).toBe(true);
  // a hand stone shows a hint screen, so it stays to point at too
  const stone = await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("state.js"));
    const render = await import(u("render.js"));
    const t = st.state.path.tlvs.find((o) => o.name === "HandStone");
    return t && render.objectShown(t);
  });
  expect(stone).toBe(true);
  // a screen the game writes on stays too, drawn as its text
  const lcd = await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("state.js"));
    const render = await import(u("render.js"));
    const t = st.state.path.tlvs.find((o) => o.name === "LCD" && o.x1 === 1159);
    return t && render.objectShown(t);
  });
  expect(lcd).toBe(true);
  // a wire's far end stays only while the wiring is drawn
  const light = () =>
    page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const render = await import(u("render.js"));
      const t = st.state.path.tlvs.find((o) => o.name === "StatusLight" && o.x1 === 1800);
      return render.objectShown(t);
    });
  expect(await light()).toBe(false);
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const sidebar = await import(u("sidebar.js"));
    sidebar.toggleShow("wires");
  });
  expect(await light()).toBe(true);
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const sidebar = await import(u("sidebar.js"));
    sidebar.toggleShow("wires");
  });
  expect(await light()).toBe(false);
  // the toggle back on gives the open door its marker again: a drawn box where an unseen rect stood
  const doorBox = () =>
    page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const render = await import(u("render.js"));
      const t = st.state.path.tlvs.find((o) => o.name === "Door" && o.fields?.start_state === 0);
      return render.hitBoxes(t, st.LAYOUT).map((b) => b.drawn);
    });
  expect(await doorBox()).toEqual([false]);
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const sidebar = await import(u("sidebar.js"));
    sidebar.toggleShow("markers");
  });
  expect(await doorBox()).toEqual([true]);
  expect(errors).toEqual([]);
});
