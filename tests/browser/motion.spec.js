import { expect, test } from "@playwright/test";
import { ALL_CATS, SLIG, TALLY, pixels, seedView, settle, trackErrors } from "./helpers.js";

// a Zulag 4 slig whose beat spans two screens, walking from its first tick
const WALKER = { game: "AO", level: "R2", path: 14, x1: 503, y1: 194, x2: 527, y2: 218 };

// the Mines board above the slig, a panel 203 wide the lcd brain writes across
const LCD = { game: "AE", level: "MI", path: 1, x1: 1159, y1: 625, x2: 1362, y2: 645 };

test("Patrols needs the objects shown: greyed and refusing its key until they are, then following them", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedView(page, { show: { objects: false, patrols: false }, cats: ALL_CATS });
  await page.goto(`/#AE/MI/1/${SLIG.x1}/${SLIG.y1}/1.00`);
  await settle(page, SLIG);
  const patrols = page.locator("#tPatrols");
  await expect(patrols).toBeDisabled();
  await expect(page.locator("label:has(#tPatrols)")).toHaveAttribute(
    "title",
    /needs .*Objects as themselves/,
  );
  await page.keyboard.press("b");
  await expect(patrols).not.toBeChecked();
  await expect(page.locator("#toastStack")).toContainText("needs");
  await page.keyboard.press("o");
  await expect(patrols).toBeEnabled();
  await page.keyboard.press("b");
  await expect(patrols).toBeChecked();
  await page.keyboard.press("o");
  await expect(patrols).toBeDisabled();
  await expect(patrols).toBeChecked();
  await expect(page.locator("#shortcutsBody")).toContainText("patrols");
  // the Animate setting is a need too, from boot and on every flip
  await page.keyboard.press("o");
  await expect(patrols).toBeEnabled();
  await page.click("#settingsBtn");
  await page.uncheck("#sAnimate");
  await expect(patrols).toBeDisabled();
  await expect(page.locator("label:has(#tPatrols)")).toHaveAttribute(
    "title",
    "“Patrols” needs “Animate the objects” on in Settings.",
  );
  await page.check("#sAnimate");
  await expect(patrols).toBeEnabled();
  await page.click("#settingsClose");
  expect(errors).toEqual([]);
});

test("a creature on patrol is hovered where it stands, not where its marker was placed", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedView(page, { show: { objects: true, patrols: true }, cats: ALL_CATS });
  await page.goto(`/?embed=1#AO/R2/14/${WALKER.x1 + 12}/${WALKER.y1 + 40}/1.00`);
  await settle(page, WALKER);
  // let it walk a while by the patrol clock; it keeps going, so the hover
  // follows the read at once
  await page.evaluate(async () => {
    window.__motion = await import(new URL("js/motion.js", location.href).href);
  });
  await page.waitForFunction(() => window.__motion.patrolTick() > 70);
  const spots = await page.evaluate(async (w) => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("state.js"));
    const render = await import(u("render.js"));
    const model = await import(u("model.js"));
    const t = st.state.path.tlvs.find((o) => o.name === "Slig" && o.x1 === w.x1 && o.y1 === w.y1);
    const r = document.getElementById("cv").getBoundingClientRect();
    const client = (b) => ({
      x: r.left + (b.x + b.w / 2 - st.state.cam.x) * st.state.cam.z,
      y: r.top + (b.y + b.h / 2 - st.state.cam.y) * st.state.cam.z,
    });
    const placed = model.drawBox(t, st.LAYOUT);
    const standing = render.standingBox(t, st.LAYOUT);
    return { placed: client(placed), standing: client(standing) };
  }, WALKER);
  const tip = page.locator("#tip");
  await page.mouse.move(spots.standing.x, spots.standing.y);
  await expect(tip).toContainText("Slig (503,194)");
  await page.mouse.move(spots.placed.x, spots.placed.y);
  // nothing stands at the placed spot now: a hidden tip keeps its last text
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.getElementById("tip");
        return el.style.display === "none" || !el.textContent.includes("Slig (503,194)");
      }),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test("the clock runs with the objects shown, stops with the setting, and the patrols count from their turn", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedView(page, { show: { objects: true, patrols: true }, cats: ALL_CATS });
  await page.goto(`/#AE/MI/1/${SLIG.x1}/${SLIG.y1}/1.00`);
  await settle(page, SLIG);
  await page.evaluate(async () => {
    window.__motion = await import(new URL("js/motion.js", location.href).href);
  });
  const read = () =>
    page.evaluate(() => {
      const m = window.__motion;
      return { running: m.motionRunning(), scene: m.sceneTick(), patrol: m.patrolTick() };
    });
  await page.waitForFunction(() => window.__motion.sceneTick() > 10);
  const a = await read();
  expect(a.running).toBe(true);
  // the setting stops the clock where it stands
  await page.click("#settingsBtn");
  await page.uncheck("#sAnimate");
  const b = await read();
  expect(b.running).toBe(false);
  await page.waitForTimeout(200);
  expect((await read()).scene).toBe(b.scene);
  await page.check("#sAnimate");
  await page.click("#settingsClose");
  await page.waitForFunction((was) => window.__motion.sceneTick() > was + 5, b.scene);
  // the patrols count from their toggle's turn while the scene keeps counting
  const before = await read();
  const after = await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const sidebar = await import(u("sidebar.js"));
    sidebar.toggleShow("patrols");
    sidebar.toggleShow("patrols");
    const m = window.__motion;
    return { scene: m.sceneTick(), patrol: m.patrolTick() };
  });
  expect(after.patrol).toBeLessThan(before.patrol);
  expect(after.scene).toBeGreaterThanOrEqual(before.scene);
  // a path change starts the scene over
  await page.keyboard.press("]");
  await page.waitForFunction(() => location.hash.startsWith("#AE/MI/7"));
  await page.waitForFunction((was) => window.__motion.sceneTick() < was, before.scene);
  expect(errors).toEqual([]);
});

test("the Mines LCD scrolls its message into its panel once the scene has run past the lead, the tally board beside it counting", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedView(page, { show: { objects: true }, cats: { screen: true, board: true } });
  await page.goto(`/#AE/MI/1/${LCD.x1 + 100}/${LCD.y1}/1.00`);
  await settle(page, LCD);
  const draw = () =>
    page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const render = await import(u("render.js"));
      await render.preloadPath(st.state.path);
      render.draw();
    });
  // with the clock stopped the panel shows its first tick, which is the lead: bare artwork,
  // while the tally board beside it already counts, in red
  await page.click("#settingsBtn");
  await page.uncheck("#sAnimate");
  await draw();
  const bare = await pixels(page, LCD);
  const tallyStill = await pixels(page, TALLY);
  const red = (px) => {
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] > 120 && px[i] > px[i + 1] + 60) n++;
    return n;
  };
  expect(red(tallyStill)).toBeGreaterThan(20);
  await page.check("#sAnimate");
  await page.click("#settingsClose");
  await page.evaluate(async () => {
    window.__motion = await import(new URL("js/motion.js", location.href).href);
  });
  // the first letter enters the right edge on tick 36; by 90 a few words are across the panel
  await page.waitForFunction(() => window.__motion.sceneTick() > 90);
  await draw();
  const written = await pixels(page, LCD);
  expect(written).not.toEqual(bare);
  // the glyphs are green, drawn additively over the panel's dark art
  const lit = [];
  for (let i = 0; i < written.length; i += 4)
    if (written[i + 1] > bare[i + 1] + 40 && written[i + 1] > written[i] + 20) lit.push(i / 4);
  expect(lit.length).toBeGreaterThan(20);
  const at = await page.evaluate(() => window.__motion.sceneTick());
  await page.waitForFunction((was) => window.__motion.sceneTick() > was + 6, at);
  await draw();
  expect(await pixels(page, LCD)).not.toEqual(written);
  // the board's digits stand still but flicker
  const tallyRunning = await pixels(page, TALLY);
  expect(red(tallyRunning)).toBeGreaterThan(20);
  expect(tallyRunning).not.toEqual(tallyStill);
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
