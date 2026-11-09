import { test, expect } from "@playwright/test";
import { trackErrors, settle } from "./helpers.js";

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
