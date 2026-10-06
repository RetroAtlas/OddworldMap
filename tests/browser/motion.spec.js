import { test, expect } from "@playwright/test";
import { seedView, settle, trackErrors } from "./helpers.js";

// the sleeping slig at the mouth of the Mines, read off the shipped data: its
// marker box and where its sprite stands
const SLIG = { game: "AE", level: "MI", path: 1, x1: 1400, y1: 700, x2: 1424, y2: 724 };
// a Zulag 4 slig whose beat spans two screens, walking from its first tick
const WALKER = { game: "AO", level: "R2", path: 14, x1: 503, y1: 194, x2: 527, y2: 218 };
// a Paramonian rolling ball, drawn far larger than the rectangle that places it
const BALL = { game: "AO", level: "F2", path: 4, x1: 284, y1: 696, x2: 308, y2: 720 };
// a Rupture Farms light effect under the Before Packaging walkway
const LIGHT = { game: "AO", level: "R1", path: 15, x1: 4405, y1: 233, x2: 4429, y2: 257 };
// the pulley of the Mines' first lift, three screens above the lift's rect, and a band
// of the top wheel's frame between the two ropes
const PULLEY = { game: "AE", level: "MI", path: 1, x1: 4025, y1: 925, x2: 4049, y2: 949 };
const WHEEL = { x1: 4032, y1: 900, x2: 4046, y2: 920 };
// a bird portal's exit in Necrum, pointed at by an arrow and by nothing else
const EXIT = { game: "AE", level: "NE", path: 2, x1: 650, y1: 440, x2: 674, y2: 464 };
// the slig's left bound, a marker with no sprite
const BOUND = { game: "AE", level: "MI", path: 1, x1: 1175, y1: 700, x2: 1199, y2: 724 };

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
  scenery: true,
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

  test("while the sidecar is still coming, nothing stands where a sprite will", async ({
    page,
  }) => {
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
    // a second of the clock passes with the failure known, and nothing asks again
    await page.evaluate(async () => {
      window.__motion = await import(new URL("js/motion.js", location.href).href);
    });
    const tick = await page.evaluate(() => window.__motion.motionTick());
    await page.waitForFunction((was) => window.__motion.motionTick() > was + 30, tick);
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
      return { placed: client(placed), standing: client(standing), walked: standing.x - placed.x };
    }, WALKER);
    expect(Math.abs(spots.walked)).toBeGreaterThan(30);
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

  test("the patrol pens draw their posts with the markers off", async ({ page }) => {
    const errors = trackErrors(page);
    await seedView(page, { show: { objects: true, markers: false, pens: true }, cats: ALL_CATS });
    await page.goto(`/?embed=1#AE/MI/1/${BOUND.x1 + 12}/${BOUND.y1 - 10}/1.00`);
    await settle(page, BOUND);
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
    // a post is drawn in the enemies' purple, which the mine's artwork does not carry
    const purple = (px) => {
      let n = 0;
      for (let i = 0; i < px.length; i += 4)
        if (px[i] > 150 && px[i] < 230 && px[i + 1] < 140 && px[i + 2] > 200) n++;
      return n;
    };
    const post = { x1: BOUND.x1 - 2, y1: BOUND.y1 - 30, x2: BOUND.x1 + 2, y2: BOUND.y2 };
    expect(purple(await pixels(page, post))).toBeGreaterThan(0);
    await page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const sidebar = await import(u("sidebar.js"));
      sidebar.toggleShow("pens");
    });
    expect(purple(await pixels(page, post))).toBe(0);
    expect(errors).toEqual([]);
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

  test("over a sprite's image, the hover names what the eye sees before an unseen rectangle beneath", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await seedView(page, { show: { objects: true, markers: false }, cats: ALL_CATS });
    // the lift's rope runs over a lift stop two screens up, whose rectangle draws nothing
    const spot = { x: 4038, y: 992 };
    await page.goto(`/?embed=1#AE/MI/1/${spot.x}/${spot.y}/1.00`);
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
    const client = await page.evaluate(async (w) => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const r = document.getElementById("cv").getBoundingClientRect();
      return {
        x: r.left + (st.dX(w.x) - st.state.cam.x) * st.state.cam.z,
        y: r.top + (st.dY(w.y) - st.state.cam.y) * st.state.cam.z,
      };
    }, spot);
    await page.mouse.move(client.x, client.y);
    const tip = page.locator("#tip");
    await expect(tip).toContainText("LiftPoint (4000,980)");
    await expect(tip).toContainText("LiftPoint (4000,1500)");
    expect((await tip.textContent()).indexOf("LiftPoint (4000,1500)")).toBeLessThan(
      (await tip.textContent()).indexOf("LiftPoint (4000,980)"),
    );
    expect(errors).toEqual([]);
  });

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

  test("a sprite larger than its rectangle is hovered over its whole image", async ({ page }) => {
    const errors = trackErrors(page);
    await seedView(page, { show: { objects: true }, cats: ALL_CATS });
    await page.goto(`/?embed=1#AO/F2/4/${BALL.x1 + 12}/${BALL.y1 + 12}/1.60`);
    await settle(page, BALL);
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
    // a point inside the drawn sprite but clear of the placed rectangle
    const spot = await page.evaluate(async (b) => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const render = await import(u("render.js"));
      const model = await import(u("model.js"));
      const t = st.state.path.tlvs.find((o) => o.name === "RollingBall" && o.x1 === b.x1);
      const [marker, sprite] = render.hitBoxes(t, st.LAYOUT);
      if (!sprite) return null;
      const r = document.getElementById("cv").getBoundingClientRect();
      const client = (x, y) => ({
        x: r.left + (x - st.state.cam.x) * st.state.cam.z,
        y: r.top + (y - st.state.cam.y) * st.state.cam.z,
      });
      const outside = (x, y) =>
        x < marker.x - 6 || x > marker.x + Math.max(marker.w, 10) + 6 || y < marker.y - 6;
      for (const [x, y] of [
        [sprite.x + 3, sprite.y + 3],
        [sprite.x + sprite.w - 3, sprite.y + 3],
        [sprite.x + 3, sprite.y + sprite.h - 3],
      ])
        if (outside(x, y))
          return {
            ...client(x, y),
            area: sprite.w * sprite.h,
            placed: model.drawBox(t, st.LAYOUT).w,
          };
      return null;
    }, BALL);
    expect(spot).not.toBeNull();
    await page.mouse.move(spot.x, spot.y);
    await expect(page.locator("#tip")).toContainText(`RollingBall (${BALL.x1},${BALL.y1})`);
    expect(errors).toEqual([]);
  });

  test("the scenery carries no label until the setting asks, then it does", async ({ page }) => {
    const errors = trackErrors(page);
    await seedView(page, { show: { objects: true, labels: true }, cats: ALL_CATS });
    await page.goto(`/#AO/R1/15/${LIGHT.x1 + 30}/${LIGHT.y1}/2.00`);
    await settle(page, LIGHT);
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
    // the label's colour is the Scenery filter's own, nowhere in the artwork above the light
    const pink = (px) => {
      let n = 0;
      for (let i = 0; i < px.length; i += 4)
        if (px[i] > 220 && px[i + 1] > 150 && px[i + 1] < 200 && px[i + 2] > 170) n++;
      return n;
    };
    const band = { x1: LIGHT.x1, y1: LIGHT.y1 - 8, x2: LIGHT.x1 + 60, y2: LIGHT.y1 - 1 };
    expect(pink(await pixels(page, band))).toBe(0);
    await page.click("#settingsBtn");
    await page.check("#sLabelScenery");
    await page.click("#settingsClose");
    await page.evaluate(async () => {
      const render = await import(new URL("js/render.js", location.href).href);
      render.draw();
    });
    expect(pink(await pixels(page, band))).toBeGreaterThan(0);
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
    // a screen the game writes on stays too, though the map cannot draw it yet
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
    expect(after.patrol).toBeLessThan(2);
    expect(after.scene).toBeGreaterThanOrEqual(before.scene);
    // a path change starts the scene over
    await page.keyboard.press("]");
    await page.waitForFunction(() => location.hash.startsWith("#AE/MI/2"));
    await page.waitForFunction((was) => window.__motion.sceneTick() < was, before.scene);
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
