import { expect, test } from "@playwright/test";
import { ALL_CATS, POLL, SLIG, TALLY, seedView, settle, spotOf, trackErrors } from "./helpers.js";

// MI P1's families, every one of which lands but the held one before a probe reads
const MI_P1_FAMILIES = [
  "Bomb",
  "Door",
  "Dove",
  "Font",
  "Lift",
  "MIP01",
  "Mudokon",
  "Particles",
  "Rope",
  "Security",
  "Slig",
  "Switch",
  "WorkWheel",
];

const familiesArrived = (page, families) =>
  page.waitForFunction((fs) => {
    const names = performance.getEntriesByType("resource").map((e) => e.name);
    return fs.every((f) => names.some((n) => n.includes(`/cams/ae/sprites/${f}.`)));
  }, families);

const sligNow = (page) =>
  page.evaluate(async (s) => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("data/state.js"));
    const spriteart = await import(u("painter/spriteart.js"));
    const spritepaint = await import(u("painter/spritepaint.js"));
    const motion = await import(u("engine/motion.js"));
    const t = st.state.path?.tlvs.find((o) => o.name === "Slig" && o.x1 === s.x1 && o.y1 === s.y1);
    if (!t) return null;
    return {
      present: spriteart.objectShown(t),
      painted: spritepaint.hitBoxes(t, st.LAYOUT).length > 1,
      running: motion.motionRunning(),
      tick: motion.sceneTick(),
    };
  }, SLIG);

test("a path asks for the sheets of its own families and no other's", async ({ page }) => {
  const errors = trackErrors(page);
  const asked = { ao: new Set(), ae: new Set() };
  page.on("request", (q) => {
    const m = /\/cams\/(ao|ae)\/sprites\/([A-Za-z0-9]+)\./.exec(q.url());
    if (m) asked[m[1]].add(m[2]);
  });
  await seedView(page, { show: { objects: true }, cats: ALL_CATS });
  await page.goto("/?embed=1#AO/R1/15");
  await settle(page, { game: "AO", level: "R1", path: 15 });
  await page.evaluate(() => (location.hash = "#AE/MI/1"));
  await settle(page, { game: "AE", level: "MI", path: 1 });
  expect([...asked.ao].sort()).toEqual([
    "Bomb",
    "BoomMachine",
    "Dove",
    "ElectricWall",
    "Font",
    "Lift",
    "Light",
    "MeatSaw",
    "Mudokon",
    "Particles",
    "R1P15",
    "Rope",
    "Security",
    "Slig",
    "Switch",
    "TrapDoor",
  ]);
  expect([...asked.ae].sort()).toEqual([
    "Bomb",
    "Door",
    "Dove",
    "Font",
    "Lift",
    "MIP01",
    "Mudokon",
    "Particles",
    "Rope",
    "Security",
    "Slig",
    "Switch",
    "WorkWheel",
  ]);
  expect(errors).toEqual([]);
});

for (const [held, route, families] of [
  ["sheets", /\/cams\/ae\/sprites\/Slig\./, MI_P1_FAMILIES.filter((f) => f !== "Slig")],
  ["masks", /\/MIP01C01_fg23\.png$/, MI_P1_FAMILIES],
])
  test(`a path's sprites wait for its ${held}, its objects there all the while, and its scene starts as they appear`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    let release;
    const hold = new Promise((r) => (release = r));
    await page.route(route, async (r) => {
      await hold;
      await r.continue();
    });
    await seedView(page, { show: { objects: true }, cats: ALL_CATS });
    await page.goto(`/?embed=1#AE/MI/1/${SLIG.x1 + 12}/${SLIG.y1 - 10}/1.00`);
    await familiesArrived(page, families);
    await page.waitForTimeout(500);
    expect(await sligNow(page)).toMatchObject({ present: true, painted: false, running: false });
    release();
    await expect.poll(async () => (await sligNow(page)).painted, POLL).toBe(true);
    const after = await sligNow(page);
    expect(after.running).toBe(true);
    expect(after.tick).toBeLessThan(90);
    expect(errors).toEqual([]);
  });

// the Mines' mouth at the art's own size, with what the page asks for as it comes: the
// path's screens by address, and how many sheets and masks
const MOUTH = `/?embed=1#AE/MI/1/${SLIG.x1 + 12}/${SLIG.y1 - 10}/1.00`;
const MI_P1_SCREENS = 31;
function asking(page) {
  const asked = { screens: [], art: 0 };
  page.on("request", (q) => {
    const url = q.url();
    if (/\/sprites\/|_fg\d+\.png$/.test(url)) asked.art++;
    else if (/\/cams\/ae\/MI\/MIP01C\d+\.png$/.test(url)) asked.screens.push(url);
  });
  return asked;
}
// the addresses of the screens showing in the view
const showingNow = (page) =>
  page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("data/state.js"));
    const order = await import(u("painter/artorder.js"));
    const cv = document.getElementById("cv");
    const { x, y, z } = st.state.cam;
    const view = { x, y, w: cv.clientWidth / z, h: cv.clientHeight / z };
    return st.state.path.cams
      .filter((c) => order.showing(c.cell, st.state.path, st.LAYOUT, view))
      .map((c) => new URL(c.png, location.href).href)
      .sort();
  });

// requests matching a route held back until let go: the first to come, or every one
function hold(page, route, every = false) {
  const h = { reached: false };
  const open = new Promise((r) => (h.release = r));
  page.route(route, async (r) => {
    const held = every || !h.reached;
    h.reached = true;
    if (held) await open;
    await r.continue();
  });
  return h;
}

test("a view asks for the screens showing in it, then the sprite art, then the rest of its path", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const asked = asking(page);
  // the first screen asked for is held, and after it the Slig's sheet
  const screen = hold(page, /\/MIP01C\d+\.png$/);
  const sheet = hold(page, /\/cams\/ae\/sprites\/Slig\./);
  await seedView(page, { show: { objects: true }, cats: ALL_CATS });
  await page.goto(MOUTH);
  await expect.poll(() => screen.reached, POLL).toBe(true);
  await page.waitForTimeout(400);
  const showing = await showingNow(page);
  expect(showing.length).toBeLessThan(MI_P1_SCREENS);
  expect([...asked.screens].sort()).toEqual(showing);
  expect(asked.art).toBe(0);
  screen.release();
  await expect.poll(() => sheet.reached, POLL).toBe(true);
  await page.waitForTimeout(400);
  expect([...asked.screens].sort()).toEqual(showing);
  sheet.release();
  await expect.poll(() => asked.screens.length, POLL).toBe(MI_P1_SCREENS);
  expect(errors).toEqual([]);
});

test("with the objects off the rest of a path follows the screens in view", async ({ page }) => {
  const errors = trackErrors(page);
  const asked = asking(page);
  const screen = hold(page, /\/MIP01C\d+\.png$/);
  await seedView(page, { show: { objects: false }, cats: ALL_CATS });
  await page.goto(MOUTH);
  await expect.poll(() => screen.reached, POLL).toBe(true);
  await page.waitForTimeout(400);
  expect([...asked.screens].sort()).toEqual(await showingNow(page));
  screen.release();
  await expect.poll(() => asked.screens.length, POLL).toBe(MI_P1_SCREENS);
  expect(asked.art).toBe(0);
  expect(errors).toEqual([]);
});

test("with the sprite table lost the rest of a path still follows the screens in view", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const asked = asking(page);
  await page.route(/\/sprites_ae\.json$/, (r) => r.fulfill({ status: 404 }));
  await seedView(page, { show: { objects: true }, cats: ALL_CATS });
  await page.goto(MOUTH);
  await expect.poll(() => asked.screens.length, POLL).toBe(MI_P1_SCREENS);
  expect(asked.art).toBe(0);
  expect(errors.filter((e) => !/404|Failed to load/.test(e))).toEqual([]);
});

test("a screen of the view that fails holds nothing back", async ({ page }) => {
  const errors = trackErrors(page);
  const asked = asking(page);
  let failed = false;
  await page.route(/\/MIP01C\d+\.png$/, (r) => {
    const first = !failed;
    failed = true;
    return first ? r.fulfill({ status: 404 }) : r.continue();
  });
  await seedView(page, { show: { objects: true }, cats: ALL_CATS });
  await page.goto(MOUTH);
  await expect.poll(() => asked.screens.length, POLL).toBe(MI_P1_SCREENS);
  expect(errors.filter((e) => !/404|Failed to load/.test(e))).toEqual([]);
});

test("with the clock stopped the rest of a path still follows its sprite art", async ({ page }) => {
  const errors = trackErrors(page);
  const asked = asking(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedView(page, { show: { objects: true }, cats: ALL_CATS });
  await page.goto(MOUTH);
  await expect.poll(() => asked.screens.length, POLL).toBe(MI_P1_SCREENS);
  expect(errors).toEqual([]);
});

// from the door of Rupture Farms' first path that leads to its second, what a way there
// asks for of the second's nine screens while every one of them is held
async function landing(page, go) {
  const errors = trackErrors(page);
  const asked = [];
  page.on("request", (q) => /\/R1P16C\d+\.png$/.test(q.url()) && asked.push(q.url()));
  const screens = hold(page, /\/R1P16C\d+\.png$/, true);
  await page.goto("/#AO/R1/15/9781/786/1.00");
  await settle(page, { game: "AO", level: "R1", path: 15 });
  await go();
  await expect.poll(() => screens.reached, POLL).toBe(true);
  await page.waitForTimeout(400);
  const showing = await showingNow(page);
  expect(showing.length).toBeLessThan(9);
  expect([...asked].sort()).toEqual(showing);
  screens.release();
  expect(errors).toEqual([]);
}

test("a followed door asks first for the screens showing where it lands", async ({ page }) => {
  await landing(page, async () => {
    const pt = await spotOf(page, { name: "Door", world: [9769, 774] });
    await page.mouse.click(pt.x, pt.y);
  });
});

test("a search hit asks first for the screens showing where it lands", async ({ page }) => {
  await landing(page, async () => {
    await page.fill("#searchInput", "MeatSaw");
    const hit = page.locator("#searchResults .hit", {
      has: page.locator(".loc", { hasText: /R1 P16$/ }),
    });
    await hit.first().click();
  });
});

test("an edit that brings a family in leaves the path's sprites drawn while its sheet comes", async ({
  page,
}) => {
  const errors = trackErrors(page);
  let release;
  const held = new Promise((r) => (release = r));
  const slogs = [];
  await page.route(/\/cams\/ae\/sprites\/Slog\./, async (route) => {
    slogs.push(route.request().url());
    await held;
    await route.continue();
  });
  await seedView(page, { show: { objects: true }, cats: ALL_CATS });
  await page.addInitScript(() =>
    localStorage.setItem("owm:settings", JSON.stringify({ editObjects: true })),
  );
  await page.goto(`/#AE/MI/1/${SLIG.x1 + 12}/${SLIG.y1 - 10}/1.00`);
  await settle(page, SLIG);
  await page.evaluate(async () => {
    window.__state = (await import(new URL("js/data/state.js", location.href).href)).state;
  });
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__state.edit === true);
  const paintedAsSprite = () =>
    page.evaluate(async (s) => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("data/state.js"));
      const render = await import(u("painter/render.js"));
      const spritepaint = await import(u("painter/spritepaint.js"));
      render.draw();
      const t = st.state.path.tlvs.find((o) => o.name === "Slig" && o.x1 === s.x1 && o.y1 === s.y1);
      return spritepaint.hitBoxes(t, st.LAYOUT).length > 1;
    }, SLIG);
  expect(await paintedAsSprite()).toBe(true);
  await page.evaluate(async (s) => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("data/state.js"));
    const edits = await import(u("data/edits.js"));
    const rect = edits.freeSpot(st.state.path, st.state.data.geometry, [
      s.x1 + 100,
      s.y1,
      s.x2 + 100,
      s.y2,
    ]);
    edits.addObject("Slog", rect);
  }, SLIG);
  await expect.poll(() => slogs.length, POLL).toBeGreaterThan(0);
  expect(await paintedAsSprite()).toBe(true);
  release();
  expect(errors).toEqual([]);
});

test("a sheet that fails leaves its objects as markers, and the map asking again brings their sprites", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release;
  const hold = new Promise((r) => (release = r));
  let refuse = true;
  await page.route(/\/cams\/ae\/sprites\/Slig\./, async (route) => {
    if (!refuse) return route.continue();
    await hold;
    return route.fulfill({ status: 404, body: "" });
  });
  await seedView(page, { show: { objects: true }, cats: ALL_CATS });
  await page.goto(`/?embed=1#AE/MI/1/${SLIG.x1 + 12}/${SLIG.y1 - 10}/1.00`);
  await familiesArrived(
    page,
    MI_P1_FAMILIES.filter((f) => f !== "Slig"),
  );
  const drawn = () =>
    page.evaluate(async (s) => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("data/state.js"));
      const spritepaint = await import(u("painter/spritepaint.js"));
      const t = st.state.path.tlvs.find((o) => o.name === "Slig" && o.x1 === s.x1 && o.y1 === s.y1);
      return spritepaint.hitBoxes(t, st.LAYOUT).map((b) => b.drawn);
    }, SLIG);
  release();
  await expect.poll(drawn, POLL).toEqual([true]);
  refuse = false;
  const back = page.waitForResponse(
    (r) => /\/cams\/ae\/sprites\/Slig\./.test(r.url()) && r.status() === 200,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await back;
  await expect.poll(drawn, POLL).toEqual([false, true]);
  expect(errors.filter((e) => !/404|Failed to load/.test(e))).toEqual([]);
});

test("a font that fails leaves the tally boards it writes as markers", async ({ page }) => {
  const errors = trackErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(/\/cams\/ae\/sprites\/Font\./, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await seedView(page, { show: { objects: true }, cats: ALL_CATS });
  await page.goto(`/?embed=1#AE/MI/1/${TALLY.x1 + 16}/${TALLY.y1 + 30}/1.00`);
  const drawn = () =>
    page.evaluate(async (b) => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("data/state.js"));
      const spritepaint = await import(u("painter/spritepaint.js"));
      const t = st.state.path?.tlvs.find(
        (o) => o.name === "LCDStatusBoard" && o.x1 === b.x1 && o.y1 === b.y1,
      );
      return t ? spritepaint.hitBoxes(t, st.LAYOUT).map((x) => x.drawn) : null;
    }, TALLY);
  await expect.poll(drawn, POLL).toEqual([true]);
  expect(errors.filter((e) => !/404|Failed to load/.test(e))).toEqual([]);
});

test.describe("below the zoom a creature reads at", () => {
  const FAR = `#AE/MI/1/${SLIG.x1 + 12}/${SLIG.y1 - 10}/0.08`;
  const record = (page) => {
    const asked = { sheets: 0, masks: 0 };
    page.on("request", (q) => {
      if (/\/cams\/[^/]+\/sprites\//.test(q.url())) asked.sheets++;
      if (/_fg\d+\.png$/.test(q.url())) asked.masks++;
    });
    return asked;
  };
  const screensIn = async (page) => {
    await page.evaluate(async () => {
      window.__state = (await import(new URL("js/data/state.js", location.href).href)).state;
    });
    await page.waitForFunction(() => {
      const p = window.__state.path;
      const names = new Set(performance.getEntriesByType("resource").map((e) => e.name));
      return (
        p?.id === 1 &&
        p.cams.filter((c) => c.png).every((c) => names.has(new URL(c.png, location.href).href))
      );
    });
    await page.waitForTimeout(500);
  };
  const slig = (page) =>
    page.evaluate(async (s) => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("data/state.js"));
      const render = await import(u("painter/render.js"));
      const spriteart = await import(u("painter/spriteart.js"));
      const spritepaint = await import(u("painter/spritepaint.js"));
      const motion = await import(u("engine/motion.js"));
      render.draw();
      const t = st.state.path.tlvs.find((o) => o.name === "Slig" && o.x1 === s.x1 && o.y1 === s.y1);
      return {
        present: spriteart.objectShown(t),
        painted: spritepaint.hitBoxes(t, st.LAYOUT).length > 1,
        running: motion.motionRunning(),
      };
    }, SLIG);
  const zoomTo = (page, z) =>
    page.evaluate(async (z) => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("data/state.js"));
      const model = await import(u("model/model.js"));
      const render = await import(u("painter/render.js"));
      const cv = document.getElementById("cv");
      const c = model.camCenter(st.state.cam, cv.clientWidth, cv.clientHeight);
      Object.assign(
        st.state.cam,
        model.centerCam({ x: c.x, y: c.y, z }, cv.clientWidth, cv.clientHeight),
      );
      render.draw();
    }, z);

  test.describe("in a box the path outgrows there", () => {
    test.use({ viewport: { width: 400, height: 300 } });

    test("the rest of a path follows the screens in view, no sprite art being waited for", async ({
      page,
    }) => {
      const errors = trackErrors(page);
      const asked = asking(page);
      await seedView(page, { show: { objects: true }, cats: ALL_CATS });
      await page.goto(`/?embed=1#AE/MI/1/${SLIG.x1 + 12}/${SLIG.y1 - 10}/0.11`);
      await expect.poll(() => asked.screens.length, POLL).toBe(MI_P1_SCREENS);
      expect((await showingNow(page)).length).toBeLessThan(MI_P1_SCREENS);
      expect(asked.art).toBe(0);
      expect(errors).toEqual([]);
    });
  });

  test("a path asks for no sprites or masks until the view reaches it, and keeps them after", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const asked = record(page);
    await seedView(page, { show: { objects: true }, cats: ALL_CATS });
    await page.goto(`/?embed=1${FAR}`);
    await screensIn(page);
    expect(asked).toEqual({ sheets: 0, masks: 0 });
    expect(await slig(page)).toEqual({ present: true, painted: false, running: false });
    await zoomTo(page, 0.2);
    await expect.poll(async () => (await slig(page)).painted, POLL).toBe(true);
    expect(asked.sheets).toBeGreaterThan(0);
    expect(asked.masks).toBeGreaterThan(0);
    await zoomTo(page, 0.08);
    expect(await slig(page)).toEqual({ present: true, painted: true, running: true });
    expect(errors).toEqual([]);
  });

  test("an export there still waits for the path's sprites and draws them", async ({ page }) => {
    const errors = trackErrors(page);
    const asked = record(page);
    await seedView(page, { show: { objects: true }, cats: ALL_CATS });
    await page.goto(`/?embed=1${FAR}`);
    await screensIn(page);
    expect(asked).toEqual({ sheets: 0, masks: 0 });
    // no live paint till the read, as in a hidden tab: an image is complete before its load event
    const exported = await page.evaluate(async (s) => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("data/state.js"));
      const render = await import(u("painter/render.js"));
      const spriteart = await import(u("painter/spriteart.js"));
      const spritepaint = await import(u("painter/spritepaint.js"));
      const motion = await import(u("engine/motion.js"));
      const frame = window.requestAnimationFrame;
      const held = [];
      window.requestAnimationFrame = (cb) => held.push(cb);
      try {
        await spriteart.preloadPath(st.state.path);
        const ready = spriteart.artworkReady(st.state.path);
        const oc = document.createElement("canvas");
        oc.width = 640;
        oc.height = 480;
        render.paint(oc.getContext("2d"), { ...st.state.cam }, 640, 480, 1, false);
        const t = st.state.path.tlvs.find(
          (o) => o.name === "Slig" && o.x1 === s.x1 && o.y1 === s.y1,
        );
        return {
          ready,
          painted: spritepaint.hitBoxes(t, st.LAYOUT).length > 1,
          running: motion.motionRunning(),
        };
      } finally {
        window.requestAnimationFrame = frame;
        for (const cb of held) frame(cb);
      }
    }, SLIG);
    expect(exported).toEqual({ ready: true, painted: true, running: false });
    expect(asked.sheets).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("the foreground toggle still asks for its masks there, the sheets waiting", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const asked = record(page);
    await seedView(page, { show: { objects: true, fg: true }, cats: ALL_CATS });
    await page.goto(`/?embed=1${FAR}`);
    await screensIn(page);
    expect(asked.masks).toBeGreaterThan(0);
    expect(asked.sheets).toBe(0);
    expect(errors).toEqual([]);
  });

  test("turning the objects on there asks for the path's sprites at once", async ({ page }) => {
    const errors = trackErrors(page);
    const asked = record(page);
    await seedView(page, { show: { objects: false }, cats: ALL_CATS });
    await page.goto(`/?embed=1${FAR}`);
    await screensIn(page);
    await page.evaluate(async () => {
      const sidebar = await import(new URL("js/chrome/sidebar.js", location.href).href);
      sidebar.toggleShow("objects");
    });
    await expect.poll(async () => (await slig(page)).painted, POLL).toBe(true);
    expect(asked.sheets).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("the edit mode asks for the path's sprites there", async ({ page }) => {
    const errors = trackErrors(page);
    const asked = record(page);
    await seedView(page, { show: { objects: true }, cats: ALL_CATS });
    await page.addInitScript(() =>
      localStorage.setItem("owm:settings", JSON.stringify({ editObjects: true })),
    );
    await page.goto(`/${FAR}`);
    await screensIn(page);
    expect(asked.sheets).toBe(0);
    await page.keyboard.press("e");
    await page.waitForFunction(() => window.__state.edit === true);
    await expect.poll(async () => (await slig(page)).painted, POLL).toBe(true);
    expect(asked.sheets).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
