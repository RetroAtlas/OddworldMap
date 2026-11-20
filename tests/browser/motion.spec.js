import { expect, test } from "@playwright/test";
import { FLASH_MS } from "../../public/js/config.js";
import {
  ALL_CATS,
  POLL,
  SLIG,
  TALLY,
  WELL,
  digest,
  pixels,
  seedView,
  settle,
  settleArtwork,
  spotOf,
  trackErrors,
} from "./helpers.js";

// a Zulag 4 slig whose beat spans two screens, walking from its first tick
const WALKER = { game: "AO", level: "R2", path: 14, x1: 503, y1: 194, x2: 527, y2: 218 };

// the Mines board above the slig, a panel 203 wide the lcd brain writes across
const LCD = { game: "AE", level: "MI", path: 1, x1: 1159, y1: 625, x2: 1362, y2: 645 };

// the well's mouth and the air its leaves cross, down to the foot of its screen
const LEAVES = { x1: 850, y1: 870, x2: 960, y2: 1015 };

// the Free-Fire Zone hint fly, which spells SNEAK IN AND OUT OF SHADOWS
const HINT = { game: "AO", level: "E1", path: 1, x1: 5464, y1: 174, x2: 5488, y2: 198 };

// the hint fly as the page has it: its point, the box its flies were last drawn in and the box
// about the sprites of the flies its brain has out, on the page, how many are out, and whether
// the brain hears a chant
const hintFly = (page) =>
  page.evaluate(async (h) => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("data/state.js"));
    const spriteart = await import(u("painter/spriteart.js"));
    const spritepaint = await import(u("painter/spritepaint.js"));
    const motion = await import(u("engine/motion.js"));
    const t = st.state.path.tlvs.find((o) => o.name === "HintFly" && o.x1 === h.x1);
    const [r] = spriteart.paintedSprites.get(t);
    const cv = document.getElementById("cv").getBoundingClientRect();
    const { cam } = st.state;
    const onPage = (b) =>
      b && {
        x: cv.left + (b.x - cam.x) * cam.z,
        y: cv.top + (b.y - cam.y) * cam.z,
        w: b.w * cam.z,
        h: b.h * cam.z,
      };
    const set = spriteart.setOf(st.state.data);
    const brain = motion.brainAt(r, set, motion.motionRunning() ? motion.sceneTick() : 0).state;
    const [wide, tall] = set.anims.HintFly.frames[0].slice(3);
    const xs = brain.fx.map((f) => st.dX(f.x)),
      ys = brain.fx.map((f) => st.dY(f.y));
    const x = Math.min(...xs),
      y = Math.min(...ys);
    return {
      point: onPage({ x: st.dX(t.x1), y: st.dY(t.y1), w: 0, h: 0 }),
      box: onPage(spritepaint.spriteBoxes.get(t)),
      flies: onPage({ x, y, w: Math.max(...xs) + wide - x, h: Math.max(...ys) + tall - y }),
      out: brain.fx.length,
      chant: brain.chant,
    };
  }, HINT);
// the Free-Fire Zone with its hint fly drawn, the Displays alone shown
async function atHint(page, zoom) {
  await seedView(page, { show: { objects: true }, cats: { screen: true } });
  await page.goto(`/#AO/E1/1/${HINT.x1}/${HINT.y1}/${zoom}`);
  await settle(page, HINT);
  await settleArtwork(page);
}
const ticksOn = async (page, ticks) => {
  await page.evaluate(async () => {
    window.__motion ??= await import(new URL("js/engine/motion.js", location.href).href);
  });
  const from = await page.evaluate(() => window.__motion.sceneTick());
  await page.waitForFunction(
    ([from, ticks]) => window.__motion.sceneTick() >= from + ticks,
    [from, ticks],
    POLL,
  );
};

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

test("Patrols boots greyed for a visitor who keeps the animation off", async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() =>
    localStorage.setItem("owm:settings", JSON.stringify({ animate: false })),
  );
  await seedView(page, { show: { objects: true, patrols: true }, cats: ALL_CATS });
  await page.goto(`/#AE/MI/1/${SLIG.x1}/${SLIG.y1}/1.00`);
  await settle(page, SLIG);
  await expect(page.locator("#tPatrols")).toBeDisabled();
  await expect(page.locator("label:has(#tPatrols)")).toHaveAttribute(
    "title",
    "“Patrols” needs “Animate the objects” on in Settings.",
  );
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
    window.__motion = await import(new URL("js/engine/motion.js", location.href).href);
  });
  await page.waitForFunction(() => window.__motion.patrolTick() > 70);
  const spots = await page.evaluate(async (w) => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("data/state.js"));
    const spritepaint = await import(u("painter/spritepaint.js"));
    const model = await import(u("model/model.js"));
    const t = st.state.path.tlvs.find((o) => o.name === "Slig" && o.x1 === w.x1 && o.y1 === w.y1);
    const r = document.getElementById("cv").getBoundingClientRect();
    const client = (b) => ({
      x: r.left + (b.x + b.w / 2 - st.state.cam.x) * st.state.cam.z,
      y: r.top + (b.y + b.h / 2 - st.state.cam.y) * st.state.cam.z,
    });
    const placed = model.drawBox(t, st.LAYOUT);
    const standing = spritepaint.standingBox(t, st.LAYOUT);
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

test("a paint that is no frame of the live view leaves the hover its boxes", async ({ page }) => {
  const errors = trackErrors(page);
  await seedView(page, { show: { objects: true, patrols: true }, cats: ALL_CATS });
  await page.goto(`/?embed=1#AO/R2/14/${WALKER.x1 + 12}/${WALKER.y1 + 40}/1.00`);
  await settle(page, WALKER);
  await page.evaluate(async () => {
    window.__motion = await import(new URL("js/engine/motion.js", location.href).href);
  });
  // far enough for the slig to stand off the mark a first frame draws it on
  await page.waitForFunction(() => window.__motion.patrolTick() > 20, null, POLL);
  const boxes = await page.evaluate(async (w) => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("data/state.js"));
    const render = await import(u("painter/render.js"));
    const spritepaint = await import(u("painter/spritepaint.js"));
    const model = await import(u("model/model.js"));
    const t = st.state.path.tlvs.find((o) => o.name === "Slig" && o.x1 === w.x1 && o.y1 === w.y1);
    const read = () => ({
      sprite: { ...spritepaint.spriteBoxes.get(t) },
      standing: spritepaint.standingBox(t, st.LAYOUT),
    });
    const live = read();
    // an export's paint, into a canvas of its own
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    render.paint(canvas.getContext("2d"), { x: 0, y: 0, z: 1 }, 64, 64, 1, false);
    return { live, after: read(), placed: model.drawBox(t, st.LAYOUT) };
  }, WALKER);
  expect(boxes.live.standing.x).not.toBe(boxes.placed.x);
  expect(boxes.after).toEqual(boxes.live);
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
    window.__motion = await import(new URL("js/engine/motion.js", location.href).href);
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
    const sidebar = await import(u("chrome/sidebar.js"));
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

// whether the engine's clock is running on the page
const running = (page) =>
  page.evaluate(async () => {
    const motion = await import(new URL("js/engine/motion.js", location.href).href);
    return motion.motionRunning();
  });
// what the device holds of the settings, there before the page's first script
const keeping = (page, settings) =>
  page.addInitScript(
    (kept) => localStorage.setItem("owm:settings", JSON.stringify(kept)),
    settings,
  );
// the slig's screen with the objects shown, over what the device holds of the settings
async function atSlig(page, settings) {
  if (settings) await keeping(page, settings);
  await seedView(page, { show: { objects: true }, cats: ALL_CATS });
  await page.goto(`/#AE/MI/1/${SLIG.x1}/${SLIG.y1}/1.00`);
  await settle(page, SLIG);
  await settleArtwork(page);
}

test("Reduce motion, set where the system allows motion, stops the clock", async ({ page }) => {
  const errors = trackErrors(page);
  await atSlig(page);
  await expect.poll(() => running(page), POLL).toBe(true);
  await page.click("#settingsBtn");
  await page.check("#sReduceMotion");
  expect(await running(page)).toBe(false);
  expect(errors).toEqual([]);
});

test("a stored choice to allow motion runs the clock on a system that asks to reduce it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await atSlig(page, { reduceMotion: false });
  await ticksOn(page, 3);
  expect(errors).toEqual([]);
});

test("a visitor whose stored settings predate Reduce motion follows the system as it changes", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await atSlig(page, { fullNames: false });
  expect(await running(page)).toBe(false);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(() => running(page), POLL).toBe(true);
  expect(errors).toEqual([]);
});

// the slig's screen with nothing shown but the artwork, over what the device holds of the settings
async function quietSlig(page, settings) {
  if (settings) await keeping(page, settings);
  await seedView(page);
  await page.goto(`/#AE/MI/1/${SLIG.x1}/${SLIG.y1}/1.00`);
  await settle(page, SLIG);
}
// how long the stylesheet gives the sidebar's slide
const slide = (page) =>
  page.evaluate(() => getComputedStyle(document.getElementById("sidebar")).transitionDuration);

test("a stored choice to reduce motion stills the sidebar's slide from the boot, where the system allows motion", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await quietSlig(page, { reduceMotion: true });
  expect(await slide(page)).toBe("0s");
  expect(errors).toEqual([]);
});

test("a stored choice to allow motion leaves the sidebar its slide from the boot, where the system asks to reduce it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await quietSlig(page, { reduceMotion: false });
  expect(await slide(page)).toBe("0.18s");
  expect(errors).toEqual([]);
});

test("Reduce motion set back to what the system asks takes the choice's key off the root", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await quietSlig(page, { reduceMotion: true });
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-motion", "reduce");
  await page.click("#settingsBtn");
  await page.uncheck("#sReduceMotion");
  await expect(root).not.toHaveAttribute("data-motion");
  expect(errors).toEqual([]);
});

test("the Reduce motion row is ticked as the system asks and follows its change, where nothing is stored", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await quietSlig(page);
  await page.click("#settingsBtn");
  const row = page.locator("#sReduceMotion");
  await expect(row).not.toBeChecked();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(row).toBeChecked();
  expect(errors).toEqual([]);
});

test("the Reduce motion row says what the system asks while the choice stands against it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await quietSlig(page, { reduceMotion: false });
  await page.click("#settingsBtn");
  await expect(page.locator("label:has(#sReduceMotion) .st-def")).toHaveText("on in your system");
  expect(errors).toEqual([]);
});

// a link to the slig opened with motion reduced by the visitor's choice
async function linkedSlig(page) {
  await keeping(page, { reduceMotion: true });
  await seedView(page);
  await page.goto(`/#AE/MI/1/${SLIG.x1}/${SLIG.y1}/1.00/Slig@${SLIG.x1},${SLIG.y1}`);
  await settle(page, SLIG);
}
// the canvas about its middle, where a ring lands, after a paint of its own: its pixels as one
// digest, and how many of them are the ring's colour
const ringRead = (page) =>
  page.evaluate(async () => {
    const render = await import(new URL("js/painter/render.js", location.href).href);
    render.draw();
    const cv = document.getElementById("cv");
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-rgb")
      .split(",")
      .map(Number);
    const { data } = cv
      .getContext("2d")
      .getImageData(Math.round(cv.width / 2) - 110, Math.round(cv.height / 2) - 110, 220, 220);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4)
      if (accent.every((c, k) => Math.abs(data[i + k] - c) < 24)) lit++;
    const hash = await crypto.subtle.digest("SHA-256", data);
    const digest = [...new Uint8Array(hash)]
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return { digest, lit };
  });

test("with motion reduced, the ring on a linked object stands as it was first drawn", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await linkedSlig(page);
  const drawn = await ringRead(page);
  expect(drawn.lit).toBeGreaterThan(100);
  // a pulse would have swung the ring's radius well within this
  await page.waitForTimeout(300);
  expect((await ringRead(page)).digest).toBe(drawn.digest);
  expect(errors).toEqual([]);
});

test("with motion reduced, the ring on a linked object goes at once when the pointer lets it go", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.clock.install();
  await linkedSlig(page);
  expect((await ringRead(page)).lit).toBeGreaterThan(100);
  await page.clock.fastForward(FLASH_MS + 100);
  await page.mouse.move(40, 300);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  expect((await ringRead(page)).lit).toBe(0);
  expect(errors).toEqual([]);
});

// a Mines door whose partner stands below it on its own screen
const DOOR = { game: "AE", level: "MI", path: 1, name: "Door", world: [3650, 860] };

test("with motion reduced, the ring where a followed door lands stands at full strength for its time, then goes", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.clock.install();
  await keeping(page, { reduceMotion: true });
  await seedView(page, { cats: { door: true } });
  await page.goto(`/#AE/MI/1/${DOOR.world[0] + 12}/${DOOR.world[1] + 12}/1.00`);
  await settle(page, DOOR);
  const door = await spotOf(page, DOOR);
  // the page's clock stands from here, so the ring's time is the test's to run
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.mouse.click(door.x, door.y);
  // off the map, so no hover's outline is in the reads
  await page.mouse.move(40, 300);
  const landed = (await ringRead(page)).lit;
  expect(landed).toBeGreaterThan(100);
  // the view settles by a hundredth of zoom as the follow's hash comes back, so the ring is held
  // to its count within a tenth, which a ring half faded falls far short of
  await page.clock.fastForward(FLASH_MS / 2);
  expect((await ringRead(page)).lit).toBeGreaterThan(landed * 0.9);
  await page.clock.fastForward(FLASH_MS);
  expect((await ringRead(page)).lit).toBe(0);
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
      const st = await import(u("data/state.js"));
      const render = await import(u("painter/render.js"));
      const spriteart = await import(u("painter/spriteart.js"));
      await spriteart.preloadPath(st.state.path);
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
    window.__motion = await import(new URL("js/engine/motion.js", location.href).href);
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

test("a well lets a leaf go once its screen's clock runs, drawn over the artwork about its mouth", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedView(page, { show: { objects: true, markers: false }, cats: { door: true } });
  await page.goto(`/#AE/MI/1/${WELL.x1 + 12}/${WELL.y1 - 20}/2.00`);
  await settle(page, WELL);
  const bare = await digest(page, LEAVES);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(() => digest(page, LEAVES), POLL).not.toBe(bare);
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

test("a hint fly's sprites hang from their flies' points, corner to point", async ({ page }) => {
  const errors = trackErrors(page);
  // a standing clock, so the swarm is drawn as its brain's first step leaves it
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedView(page, { show: { objects: true } });
  await page.goto(`/#AO/E1/1/${HINT.x1}/${HINT.y1}/1.00`);
  await settle(page, HINT);
  await settleArtwork(page);
  const AROUND = { x1: HINT.x1 - 48, y1: HINT.y1 - 48, x2: HINT.x1 + 48, y2: HINT.y1 + 48 };
  // the view on whole pixels, so a texel is a pixel
  const redraw = (displays) =>
    page.evaluate(async (displays) => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("data/state.js"));
      const { CATS } = await import(u("config.js"));
      const render = await import(u("painter/render.js"));
      CATS.find((c) => c.key === "screen").on = displays;
      st.state.cam.x = Math.round(st.state.cam.x);
      st.state.cam.y = Math.round(st.state.cam.y);
      render.draw();
    }, displays);
  await redraw(false);
  const bare = await pixels(page, AROUND);
  // the Displays come on, and with them the hint fly alone
  await redraw(true);
  const lit = await pixels(page, AROUND);
  // where each fly's sprite should have lit a pixel: its corner, and the texels its frame holds
  const flies = await page.evaluate(
    async ([h, around]) => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("data/state.js"));
      const spriteart = await import(u("painter/spriteart.js"));
      const motion = await import(u("engine/motion.js"));
      const t = st.state.path.tlvs.find((o) => o.name === "HintFly" && o.x1 === h.x1);
      const [r] = spriteart.paintedSprites.get(t);
      const set = spriteart.setOf(st.state.data);
      const [fly] = motion.resolveEffects(r, set, 0);
      const frame = fly.anim.frames[fly.frame];
      const tile = spriteart.processedFrame(set.sheets[frame[0]], frame, true, fly.rgb);
      const { data } = tile.getContext("2d").getImageData(0, 0, tile.width, tile.height);
      const texels = [];
      for (let i = 0; i < data.length; i += 4)
        if (data[i + 3]) texels.push([(i / 4) % tile.width, Math.floor(i / 4 / tile.width)]);
      return motion
        .resolveEffects(r, set, 0)
        .flatMap((f) => texels.map(([x, y]) => [f.x - around.x1 + x, f.y - around.y1 + y]));
    },
    [HINT, AROUND],
  );
  const across = AROUND.x2 - AROUND.x1;
  const changed = [];
  for (let i = 0; i < lit.length; i += 4)
    if (lit.slice(i, i + 4).some((v, k) => v !== bare[i + k]))
      changed.push([(i / 4) % across, Math.floor(i / 4 / across)]);
  const sorted = (points) => [...new Set(points.map(([x, y]) => `${x},${y}`))].sort();
  expect(flies.length).toBeGreaterThan(20);
  expect(sorted(changed)).toEqual(sorted(flies));
  expect(errors).toEqual([]);
});

test("a hint fly hears a chant while the pointer rests on it, and sends out its first word's flies", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await atHint(page, "2.00");
  const resting = await hintFly(page);
  expect([resting.out, resting.chant]).toEqual([20, false]);
  await page.mouse.move(resting.point.x + 2, resting.point.y + 2);
  // sixteen ticks of pause from the step that hears it, then the first word's flies join
  await ticksOn(page, 22);
  const spelling = await hintFly(page);
  expect(spelling.chant).toBe(true);
  expect(spelling.out).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test("a hint fly's chant ends once the pointer has left the map", async ({ page }) => {
  const errors = trackErrors(page);
  await atHint(page, "2.00");
  const { point } = await hintFly(page);
  await page.mouse.move(point.x + 2, point.y + 2);
  await ticksOn(page, 2);
  expect((await hintFly(page)).chant).toBe(true);
  await page.mouse.move(40, 300);
  await ticksOn(page, 2);
  expect((await hintFly(page)).chant).toBe(false);
  expect(errors).toEqual([]);
});

test("a hint fly is pointed at over the box about its flies, past its rect", async ({ page }) => {
  const errors = trackErrors(page);
  // a standing clock, so the swarm keeps the box it was read with
  await page.emulateMedia({ reducedMotion: "reduce" });
  await atHint(page, "2.00");
  const { box, flies, point } = await hintFly(page);
  expect(box).toEqual(flies);
  // the rect's corner is the hint's point, and it answers four units past it
  expect(box.x).toBeLessThan(point.x - 12);
  const tip = page.locator("#tip");
  await page.mouse.move(box.x + 3, box.y + box.h / 2);
  await expect(tip).toContainText("HintFly (5464,174)");
  await page.mouse.move(box.x - 12, box.y + box.h / 2);
  // a hidden tip keeps its last text
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.getElementById("tip");
          return el.style.display === "none" || !el.textContent.includes("HintFly");
        }),
      POLL,
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test.describe("on a touch screen", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  // a finger put down away from the swarm, dragged and lifted, and how far it moved the view
  async function pan(page, from) {
    const view = () =>
      page.evaluate(async () => {
        const st = await import(new URL("js/data/state.js", location.href).href);
        return st.state.cam.y;
      });
    const before = await view();
    const touch = await page.context().newCDPSession(page);
    const at = (dy) => ({ touchPoints: [{ x: from.x, y: from.y - 200 + dy }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", ...at(0) });
    for (const dy of [10, 20, 30, 40])
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", ...at(dy) });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    return (await view()) - before;
  }

  test("a tap on a hint fly is a chant that outlasts the finger, and a pan of the map after it", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await atHint(page, "1.00");
    const { point } = await hintFly(page);
    await page.touchscreen.tap(point.x + 2, point.y + 2);
    // the finger's leaving comes before the tap's click
    await ticksOn(page, 4);
    expect((await hintFly(page)).chant).toBe(true);
    expect(await pan(page, point)).not.toBe(0);
    await ticksOn(page, 4);
    expect((await hintFly(page)).chant).toBe(true);
    expect(errors).toEqual([]);
  });

  test("a tapped hint fly's chant outlasts a key's pan of the map", async ({ page }) => {
    const errors = trackErrors(page);
    await atHint(page, "1.00");
    const { point } = await hintFly(page);
    await page.touchscreen.tap(point.x + 2, point.y + 2);
    await ticksOn(page, 2);
    expect((await hintFly(page)).chant).toBe(true);
    await page.keyboard.press("ArrowLeft");
    await ticksOn(page, 2);
    expect((await hintFly(page)).chant).toBe(true);
    expect(errors).toEqual([]);
  });

  test("a tap elsewhere on the map ends a tapped hint fly's chant", async ({ page }) => {
    const errors = trackErrors(page);
    await atHint(page, "1.00");
    const { point } = await hintFly(page);
    await page.touchscreen.tap(point.x + 2, point.y + 2);
    await ticksOn(page, 2);
    expect((await hintFly(page)).chant).toBe(true);
    await page.touchscreen.tap(point.x + 2, point.y - 200);
    await ticksOn(page, 2);
    expect((await hintFly(page)).chant).toBe(false);
    expect(errors).toEqual([]);
  });
});
