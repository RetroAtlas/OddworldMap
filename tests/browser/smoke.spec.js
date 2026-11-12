import { test, expect } from "@playwright/test";
import { POLL, trackErrors, settle, settleAny, spotOf } from "./helpers.js";

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

test("a bare link's path rests fitted to the map's box as it stands beside the sidebar", async ({
  page,
}) => {
  // a slide of the sidebar is held at its first frame, were the boot to start one
  await page.addInitScript(() =>
    document.addEventListener(
      "transitionrun",
      (e) => {
        if (e.target.id === "sidebar") for (const a of e.target.getAnimations()) a.pause();
      },
      true,
    ),
  );
  await page.goto("/#AO/R1/19");
  await settle(page, { game: "AO", level: "R1", path: 19 });
  const r = await page.evaluate(async () => {
    const st = await import(new URL("js/data/state.js", location.href).href);
    return { cam: { ...st.state.cam }, hash: location.hash };
  });
  // three screens in a row and the fit's margin, in a box 1030 wide
  expect(r.cam.z).toBe(1030 / 1304);
  expect(r.cam.x).toBeCloseTo(-100, 6);
  expect(r.cam.y).toBeCloseTo(-335.77, 2);
  expect(r.hash).toBe("#AO/R1/19");
});

// the default boot once its own hash has come back: Rupture Farms' first path, not moved
async function unmoved(page) {
  await page.goto("/");
  await settleAny(page);
  await page.waitForFunction(() => location.hash === "#AO/R1/15", null, POLL);
}

test("a path not moved since it opened is linked by its path alone", async ({ page }) => {
  const errors = trackErrors(page);
  await unmoved(page);
  expect(errors).toEqual([]);
});

test("a pan gives a path's link its view", async ({ page }) => {
  const errors = trackErrors(page);
  await unmoved(page);
  await page.keyboard.press("ArrowRight");
  const viewed = () => /^#AO\/R1\/15\/\d+\/\d+\/\d\.\d\d$/.test(location.hash);
  await page.waitForFunction(viewed, null, POLL);
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
    const nav = await import(u("navigation/navigate.js"));
    return { hash: location.hash, view: nav.viewHash() };
  });
  expect(r.view).toBe(TRIP_HASH);
  expect(r.hash).toBe(TRIP_HASH);
  expect(errors).toEqual([]);
});

// the map's box takes a new size a frame before its observer reports it, as it
// does while the sidebar slides: whatever moves the view in between keeps it on
// its spot
test("a view placed while the map's box resizes holds its spot", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/${TRIP_HASH}`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  const view = await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const nav = await import(u("navigation/navigate.js"));
    const main = document.getElementById("main");
    const frame = () => new Promise(requestAnimationFrame);
    main.style.flex = `0 0 ${main.clientWidth - 40}px`;
    await nav.applyHash();
    await frame();
    await frame();
    return nav.viewHash();
  });
  expect(view).toBe(TRIP_HASH);
  expect(errors).toEqual([]);
});

test("Gaps between screens flipped while the map's box resizes keeps the view's middle", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto(`/${TRIP_HASH}`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  const view = await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("data/state.js"));
    const nav = await import(u("navigation/navigate.js"));
    const main = document.getElementById("main");
    const frame = () => new Promise(requestAnimationFrame);
    main.style.flex = `0 0 ${main.clientWidth - 40}px`;
    nav.setPitch(!st.isSpaced());
    await frame();
    await frame();
    nav.setPitch(!st.isSpaced());
    await frame();
    await frame();
    return nav.viewHash();
  });
  expect(view).toBe(TRIP_HASH);
  expect(errors).toEqual([]);
});

test("a link into a level's later path fetches none of the level's first path's screens", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const first = [];
  page.on("request", (q) => {
    if (/\/cams\/ae\/MI\/MIP01C/.test(q.url())) first.push(q.url());
  });
  await page.goto("/#AE/MI/4");
  await settle(page, { game: "AE", level: "MI", path: 4 });
  expect(first).toEqual([]);
  expect(errors).toEqual([]);
});

test("a link naming a path its level lacks selects nothing on the way", async ({ page }) => {
  const errors = trackErrors(page);
  const brewery = [];
  page.on("request", (q) => {
    if (/\/cams\/ae\/BR\//.test(q.url())) brewery.push(q.url());
  });
  await page.goto("/#AE/BR/99");
  await settle(page, { game: "AE", level: "MI", path: 1 });
  expect(brewery).toEqual([]);
  await page.evaluate(() => (location.hash = "#AE/BR/98"));
  await page.waitForTimeout(500);
  const at = await page.evaluate(async () => {
    const { state } = await import(new URL("js/data/state.js", location.href).href);
    return [state.lvl.short, state.path.id, state.lvl.paths.includes(state.path)];
  });
  expect(at).toEqual(["MI", 1, true]);
  expect(brewery).toEqual([]);
  expect(errors).toEqual([]);
});

// the page at the pinned door, and where on it the door is drawn
async function atDoor(page) {
  await page.goto(`/${TRIP_HASH}`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  return spotOf(page, DOOR);
}

test("clicking a door follows it to the level and path it names", async ({ page }) => {
  const errors = trackErrors(page);
  const pt = await atDoor(page);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction(() => location.hash.startsWith("#AO/R1/16/"));
  expect(errors).toEqual([]);
});

test("the numbers panel counts the screen a follow lands on", async ({ page }) => {
  const errors = trackErrors(page);
  const pt = await atDoor(page);
  await page.click("#numbersBtn");
  await page.locator("#numbersTypes label", { hasText: /^\s*Door$/ }).click();
  // the follow's own hash comes back as a hashchange, which selects the path again
  await page.evaluate(() => {
    window.__echoed = false;
    window.addEventListener("selection-changed", (e) => (window.__echoed ||= e.detail.fromHash));
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction(() => window.__echoed, null, POLL);
  // the door it comes out of stands on the screen under the view's centre
  await expect(page.locator("#numbersBody .np-n").first()).toHaveText("1", { timeout: 1 });
  expect(errors).toEqual([]);
});

// a screen of the standing path as the page draws it
const screenBox = (page, name) =>
  page.evaluate(async (name) => {
    const st = await import(new URL("js/data/state.js", location.href).href);
    const { cam, path } = st.state;
    const c = path.cams.find((c) => c.name === name);
    const r = document.getElementById("cv").getBoundingClientRect();
    const x = r.left + ((c.cell % path.w) * st.LAYOUT.cellW - cam.x) * cam.z,
      y = r.top + (Math.floor(c.cell / path.w) * st.LAYOUT.cellH - cam.y) * cam.z;
    return { x, y, right: x + st.LAYOUT.visW * cam.z, foot: y + st.LAYOUT.visH * cam.z };
  }, name);

test.describe("in a box under two screens wide", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a path opens on the screen it is entered on, at its art's own size", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/#AE/MI/1");
    await settle(page, { game: "AE", level: "MI", path: 1 });
    const cam = await page.evaluate(async () => {
      const st = await import(new URL("js/data/state.js", location.href).href);
      return { ...st.state.cam };
    });
    // Abe's first screen in the Mines, MIP01C04 in the grid's third column and sixth
    // row, in the middle of the box clear of the chip row and the minimap
    expect(cam).toEqual({ x: 725, y: 935, z: 1 });
    expect(errors).toEqual([]);
  });

  test("a path transition's follow opens the path on the screen it lands on", async ({ page }) => {
    const errors = trackErrors(page);
    // the transition at the left edge of R1 P18, which leads back to R1 P16's seventh screen
    await page.goto("/#AO/R1/18/184/242/1.00");
    await settle(page, { game: "AO", level: "R1", path: 18 });
    const pt = await spotOf(page, { name: "PathTransition", world: [113, 120] });
    await page.mouse.click(pt.x, pt.y);
    await settle(page, { game: "AO", level: "R1", path: 16 });
    const { x, y, right, foot } = await screenBox(page, "R1P16C07");
    expect(Math.min(x, y, 390 - right, 844 - foot)).toBeGreaterThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test("the screen a path opens on stands clear of the chip row, the help line and the minimap", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const clear = async (path, name) => {
      await settle(page, { game: "AO", level: "R1", path });
      const screen = await screenBox(page, name);
      for (const id of ["chipRow", "help", "minimap"]) {
        const box = await page.locator(`#${id}`).boundingBox();
        const apart =
          screen.right <= box.x ||
          box.x + box.width <= screen.x ||
          screen.foot <= box.y ||
          box.y + box.height <= screen.y;
        expect(apart, `${name} and #${id}`).toBe(true);
      }
    };
    // Rupture Farms' first path is entered at the top of its screens, its twentieth at their
    // foot, above the minimap on a phone held upright and beside it on one on its side
    await page.goto("/#AO/R1/15");
    await clear(15, "R1P15C01");
    await page.goto("/#AO/R1/20");
    await clear(20, "R1P20C01");
    await page.setViewportSize({ width: 844, height: 390 });
    await page.reload();
    await clear(20, "R1P20C01");
    expect(errors).toEqual([]);
  });
});

test("?embed=1 hides the chrome and offers the way to the full site", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/?embed=1#AO/R2/1/554/287/1.00");
  await settle(page, { game: "AO", level: "R2", path: 1 });
  for (const el of await page.locator(".chrome").all()) await expect(el).toBeHidden();
  await expect(page.locator("#openSiteBtn")).toBeVisible();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  expect(errors).toEqual([]);
});

test("search moves the view to what it finds", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/${TRIP_HASH}`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  const before = await page.evaluate(async () => {
    const st = await import(new URL("js/data/state.js", location.href).href);
    return { hash: location.hash, cam: { ...st.state.cam } };
  });
  await page.fill("#searchInput", "lcdstatusboard");
  await page.waitForSelector("#searchResults .hit"); // results render on a debounce
  await page.press("#searchInput", "Enter");
  await page.waitForFunction((h) => location.hash !== h, before.hash);
  const after = await page.evaluate(async () => {
    const st = await import(new URL("js/data/state.js", location.href).href);
    return { ...st.state.cam };
  });
  expect(after).not.toEqual(before.cam);
  expect(errors).toEqual([]);
});

test("the box's clear button shows for as long as it holds text, and the keyboard reaches it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto(`/${TRIP_HASH}`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  const box = page.locator("#searchInput");
  const clear = page.locator("#searchClear");
  await expect(clear).toBeHidden();
  await box.fill("mudokon");
  await expect(clear).toBeVisible();
  await page.waitForSelector("#searchResults .hit"); // results render on a debounce
  await box.blur();
  await expect(box).not.toBeFocused();
  await expect(clear).toBeVisible();
  await expect(clear).toHaveAccessibleName("Clear the search");
  // Tab reaches it from the box, and Enter empties the box and gives it the focus
  await box.focus();
  await page.keyboard.press("Tab");
  await expect(clear).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
  await expect(clear).toBeHidden();
  await expect(page.locator("#searchResults .hit")).toHaveCount(0);
  // a scope chosen goes with the text, as it does under Escape
  await box.fill("mudokon");
  await page.locator("#scopeBar button").nth(2).click();
  await clear.click();
  await box.fill("mudokon");
  await expect(page.locator("#scopeBar button.on")).toHaveText("All");
  // deleting the text by hand hides it too
  await box.fill("");
  await expect(clear).toBeHidden();
  await box.fill("mudokon");
  await box.press("Escape");
  await expect(clear).toBeHidden();
  await expect(box).not.toBeFocused();
  expect(errors).toEqual([]);
});

test("a scope button keeps the focus through the path change that rebuilds it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto(`/${TRIP_HASH}`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  const game = page.locator("#scopeBar button").nth(1);
  await game.focus();
  await page.keyboard.press("]");
  await page.waitForFunction(() => location.hash.startsWith("#AO/R1/16"));
  await expect(page.locator("#scopeBar button").nth(1)).toBeFocused();
  await expect(page.locator("#scopeBar button").nth(3)).toHaveText("P16");
  expect(errors).toEqual([]);
});

test("a switch clicked leaves the keys to the map, and a text field keeps its own", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto(`/${TRIP_HASH}`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  await page.locator("#tGrid").click();
  await expect(page.locator("#tGrid")).toBeFocused();
  await page.keyboard.press("c");
  await expect(page.locator("#tColl")).toBeChecked();
  const cam = () =>
    page.evaluate(async () => {
      const st = await import(new URL("js/data/state.js", location.href).href);
      return { ...st.state.cam };
    });
  const before = await cam();
  await page.keyboard.press("ArrowLeft");
  expect((await cam()).x).toBeLessThan(before.x);
  await page.locator("#searchInput").focus();
  await page.keyboard.type("c");
  await expect(page.locator("#tColl")).toBeChecked();
  await expect(page.locator("#searchInput")).toHaveValue("c");
  // a / typed in another field stays typing rather than reaching for the search box
  await page.locator("#numbersBtn").click();
  await page.locator("#numbersFilter").focus();
  await page.keyboard.press("/");
  await expect(page.locator("#numbersFilter")).toHaveValue("/");
  await expect(page.locator("#searchInput")).not.toBeFocused();
  expect(errors).toEqual([]);
});

test("a toggle's key lights its cap until the key is let go, though Shift, Cmd or a lost focus came between", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto(`/${TRIP_HASH}`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  const cap = page.locator("label:has(#tGrid) kbd");
  const lit = () => cap.evaluate((k) => k.classList.contains("held"));
  const hold = async () => {
    await page.keyboard.down("KeyG");
    expect(await lit()).toBe(true);
  };
  await hold();
  await page.keyboard.up("KeyG");
  expect(await lit()).toBe(false);
  await hold();
  await page.keyboard.down("Shift");
  await page.keyboard.up("KeyG");
  await page.keyboard.up("Shift");
  expect(await lit()).toBe(false);
  await hold();
  await page.keyboard.down("Meta");
  await page.keyboard.up("Meta");
  expect(await lit()).toBe(false);
  await page.keyboard.up("KeyG");
  await hold();
  await page.evaluate(() => dispatchEvent(new Event("blur")));
  expect(await lit()).toBe(false);
  await page.keyboard.up("KeyG");
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

test("the display keeps only the switches set away from their defaults", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/${TRIP_HASH}`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  const kept = () => page.evaluate(() => JSON.parse(localStorage.getItem("owm:view")));
  const hoists = page.locator("#filterBox label", { hasText: "Hoists / edges" });
  await page.keyboard.press("g");
  expect(await kept()).toEqual({ show: { grid: false }, cats: {} });
  await page.keyboard.press("c");
  expect(await kept()).toEqual({ show: { grid: false, coll: true }, cats: {} });
  await page.keyboard.press("g");
  expect(await kept()).toEqual({ show: { coll: true }, cats: {} });
  await page.keyboard.press("m"); // the ruler is a tool, never kept
  expect(await kept()).toEqual({ show: { coll: true }, cats: {} });
  await hoists.click();
  expect(await kept()).toEqual({ show: { coll: true }, cats: { nav: true } });
  await page.reload();
  await settle(page, { game: "AO", level: "R1", path: 15 });
  // the untouched switches stand at their defaults, the chosen ones as chosen
  await expect(page.locator("#tGrid")).toBeChecked();
  await expect(page.locator("#tLabels")).toBeChecked();
  await expect(page.locator("#tColl")).toBeChecked();
  await expect(hoists.locator("input")).toBeChecked();
  expect(await kept()).toEqual({ show: { coll: true }, cats: { nav: true } });
  await page.locator("#tReset").click();
  expect(await kept()).toEqual({ show: {}, cats: { nav: true } });
  await page.locator("#fAll").click();
  expect(await kept()).toEqual({ show: {}, cats: { nav: true, meta: true } });
  await page.locator("#fReset").click();
  expect(await kept()).toEqual({ show: {}, cats: {} });
  expect(errors).toEqual([]);
});

test("a saved switch stays saved until it is set again, though it matches the default", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto(`/${TRIP_HASH}`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  const kept = () => page.evaluate(() => JSON.parse(localStorage.getItem("owm:view")));
  // a switch saved at its default, which is what a choice made against another
  // default leaves
  await page.evaluate(() =>
    localStorage.setItem("owm:view", JSON.stringify({ show: { grid: true }, cats: {} })),
  );
  await page.reload();
  await settle(page, { game: "AO", level: "R1", path: 15 });
  await expect(page.locator("#tGrid")).toBeChecked();
  await page.keyboard.press("c");
  expect(await kept()).toEqual({ show: { grid: true, coll: true }, cats: {} });
  await page.keyboard.press("g");
  expect(await kept()).toEqual({ show: { grid: false, coll: true }, cats: {} });
  await page.keyboard.press("g");
  expect(await kept()).toEqual({ show: { coll: true }, cats: {} });
  await page.locator("#tReset").click();
  expect(await kept()).toEqual({ show: {}, cats: {} });
  expect(errors).toEqual([]);
});

test("the settings dialog's switches stand after a reload as they were set, Show more reaching the field picks' mode and back", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await settleAny(page);
  const kept = () => page.evaluate(() => JSON.parse(localStorage.getItem("owm:settings")));
  await page.click("#settingsBtn");
  await page.uncheck("#sFullNames");
  await page.check("#sDemoPaths");
  await page.check("#sFullNames");
  await page.check("#sShowMore");
  expect((await kept()).fieldPrefs.mode).toBe("more");
  await page.uncheck("#sShowMore");
  await page.click("#settingsClose");
  await page.reload();
  await settleAny(page);
  await page.click("#settingsBtn");
  // the untouched settings stand at their defaults, the chosen one as chosen
  await expect(page.locator("#sFullNames")).toBeChecked();
  await expect(page.locator("#sAnimate")).toBeChecked();
  await expect(page.locator("#sDemoPaths")).toBeChecked();
  await expect(page.locator("#sShowMore")).not.toBeChecked();
  expect(errors).toEqual([]);
});

test("a place found by search opens its path whole", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/${TRIP_HASH}`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  await page.fill("#searchInput", "R1 P16");
  const place = page.locator("#searchResults .hit", {
    has: page.locator(".loc", { hasText: /^AO · R1 P16$/ }),
  });
  await place.first().click();
  await settle(page, { game: "AO", level: "R1", path: 16 });
  const zoom = await page.evaluate(async () => {
    const st = await import(new URL("js/data/state.js", location.href).href);
    return st.state.cam.z;
  });
  // ten screens in a row and the fit's margin, in a box 1030 wide
  expect(zoom).toBe(1030 / 3880);
  expect(errors).toEqual([]);
});

test("a follow that lands nowhere on the path in hand leaves the view where it is", async ({
  page,
}) => {
  const errors = trackErrors(page);
  // a door of Necrum Mines' eleventh path naming its own path and a camera the path lacks
  await page.goto("/#AE/MI/11/437/91/1.00");
  await settle(page, { game: "AE", level: "MI", path: 11 });
  const view = () =>
    page.evaluate(async () => {
      const st = await import(new URL("js/data/state.js", location.href).href);
      return { cam: { ...st.state.cam }, hash: location.hash };
    });
  const before = await view();
  const pt = await spotOf(page, { name: "Door", world: [425, 79] });
  await page.evaluate(() => {
    window.__selections = 0;
    window.addEventListener("selection-changed", () => window.__selections++);
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction(() => window.__selections > 0, null, POLL);
  expect(await view()).toEqual(before);
  expect(errors).toEqual([]);
});

test("an embed's way to the full site says the view its frame shows, though the path has not moved", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto("/?embed=1#AO/R1/15");
  await settle(page, { game: "AO", level: "R1", path: 15 });
  await page.dispatchEvent("#openSiteBtn", "pointerdown");
  const link = new URL(await page.locator("#openSiteBtn").getAttribute("href"));
  expect(link.search).toBe("");
  expect(link.hash).toMatch(/^#AO\/R1\/15\/\d+\/\d+\/\d\.\d\d$/);
  expect(errors).toEqual([]);
});

test("the chain button copies the link the address bar holds", async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (t) => ((window.__copied = t), Promise.resolve()) },
    }),
  );
  await unmoved(page);
  await page.click("#copyLinkBtn");
  expect(await page.evaluate(() => window.__copied)).toBe(page.url());
  expect(errors).toEqual([]);
});
