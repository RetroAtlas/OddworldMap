import { test, expect } from "@playwright/test";
import { POLL, trackErrors, settle } from "./helpers.js";

// a phone's width, where the drawer starts closed over the map
test.use({ viewport: { width: 600, height: 900 } });

test("the / key opens the closed drawer and focuses the search box", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/#AE/MI/1/1412/712/1.00");
  await settle(page, { game: "AE", level: "MI", path: 1 });
  const drawer = () => page.evaluate(() => document.body.classList.contains("menu-open"));
  expect(await drawer()).toBe(false);
  await page.keyboard.press("/");
  expect(await drawer()).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("searchInput");
  expect(errors).toEqual([]);
});

// the drawer open at a phone's width with one of its controls focused
async function drawerHolding(page, selector) {
  await page.goto("/#AE/MI/1/1412/712/1.00");
  await settle(page, { game: "AE", level: "MI", path: 1 });
  await page.keyboard.press("/");
  await page.focus(selector);
}

test("a path change with a scope button focused closes the drawer onto the menu button", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await drawerHolding(page, "#scopeBar button");
  await page.keyboard.press("]");
  await page.waitForFunction(() => !document.body.classList.contains("menu-open"), null, POLL);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("menuBtn");
  expect(errors).toEqual([]);
});

test("a path change with nothing focused closes the drawer onto the menu button", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await drawerHolding(page, "#searchInput");
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("]");
  await page.waitForFunction(() => !document.body.classList.contains("menu-open"), null, POLL);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("menuBtn");
  expect(errors).toEqual([]);
});

test("a path change with the gear button focused closes the drawer onto the menu button", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await drawerHolding(page, "#settingsBtn");
  await page.keyboard.press("]");
  await page.waitForFunction(() => !document.body.classList.contains("menu-open"), null, POLL);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("menuBtn");
  expect(errors).toEqual([]);
});
