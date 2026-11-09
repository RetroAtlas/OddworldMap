import { expect, test } from "@playwright/test";
import {
  ALL_CATS,
  BOUND,
  pixels,
  seedView,
  settle,
  settleArtwork,
  trackErrors,
} from "./helpers.js";

// a bird portal's exit in Necrum, pointed at by an arrow and by nothing else
const EXIT = { game: "AE", level: "NE", path: 2, x1: 650, y1: 440, x2: 674, y2: 464 };

test("the Connections switch stands as the seed set it and follows its toggle", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedView(page, { show: { objects: true, markers: false, conn: true }, cats: ALL_CATS });
  await page.goto(`/?embed=1#AE/NE/2/${EXIT.x1}/${EXIT.y1}/1.00`);
  await settle(page, EXIT);
  await expect(page.locator("#tConn")).toBeChecked();
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const sidebar = await import(u("sidebar.js"));
    sidebar.toggleShow("conn");
  });
  await expect(page.locator("#tConn")).not.toBeChecked();
  expect(errors).toEqual([]);
});

test("a click on the Doors / Transitions row flips its switch and its category, and back", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedView(page, {
    show: { objects: true, markers: false, conn: true },
    cats: { ...ALL_CATS, door: false },
  });
  await page.goto(`/#AE/NE/2/${EXIT.x1}/${EXIT.y1}/1.00`);
  await settle(page, EXIT);
  // the filter's own switch, clicked as the pointer would
  const doors = page.locator("label.checkrow", { hasText: "Doors / Transitions" });
  const box = doors.locator("input");
  const doorOn = () =>
    page.evaluate(async () => {
      const { CATS } = await import(new URL("js/config.js", location.href).href);
      return CATS.find((c) => c.key === "door").on;
    });
  await expect(box).not.toBeChecked();
  expect(await doorOn()).toBe(false);
  await doors.click();
  await expect(box).toBeChecked();
  expect(await doorOn()).toBe(true);
  await doors.click();
  await expect(box).not.toBeChecked();
  expect(await doorOn()).toBe(false);
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
  await settleArtwork(page);
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
  expect(errors).toEqual([]);
});
