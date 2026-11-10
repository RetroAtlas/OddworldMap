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

// a Paramonian rolling ball, drawn far larger than the rectangle that places it
const BALL = { game: "AO", level: "F2", path: 4, x1: 284, y1: 696, x2: 308, y2: 720 };

// a Rupture Farms light effect under the Before Packaging walkway
const LIGHT = { game: "AO", level: "R1", path: 15, x1: 4405, y1: 233, x2: 4429, y2: 257 };

// the pulley of the Mines' first lift, three screens above the lift's rect, and a band
// of the top wheel's frame between the two ropes
const PULLEY = { game: "AE", level: "MI", path: 1, x1: 4025, y1: 925, x2: 4049, y2: 949 };
const WHEEL = { x1: 4032, y1: 900, x2: 4046, y2: 920 };

// a Bonewerkz crate whose rect starts a unit above BWP04C06, the camera holding its
// midpoint, a band of BWP04C03 its frame reaches into from that anchor, and a band of
// the drill beside it, another hazard
const CRATE = { game: "AE", level: "BW", path: 4, x1: 611, y1: 1039, x2: 635, y2: 1063 };
const ABOVE_CRATE = { x1: 595, y1: 998, x2: 625, y2: 1018 };
const DRILL = { x1: 495, y1: 957, x2: 525, y2: 973 };

test("the patrol pens draw their posts with the markers off", async ({ page }) => {
  const errors = trackErrors(page);
  await seedView(page, { show: { objects: true, markers: false, pens: true }, cats: ALL_CATS });
  await page.goto(`/?embed=1#AE/MI/1/${BOUND.x1 + 12}/${BOUND.y1 - 10}/1.00`);
  await settle(page, BOUND);
  await settleArtwork(page);
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
    const sidebar = await import(u("chrome/sidebar.js"));
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
  await settleArtwork(page);
  const withWheel = await pixels(page, WHEEL);
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const sidebar = await import(u("chrome/sidebar.js"));
    sidebar.toggleShow("objects");
  });
  expect(await pixels(page, WHEEL)).not.toEqual(withWheel);
  expect(errors).toEqual([]);
});

test("a falling item is drawn on the screen of the camera that builds it, not the one its anchor lies in", async ({
  page,
}) => {
  const errors = trackErrors(page);
  // the clock stopped, so both paints draw tick 0 and the drill holds still
  await page.addInitScript(() =>
    localStorage.setItem("owm:settings", JSON.stringify({ animate: false })),
  );
  await seedView(page, { show: { objects: true }, cats: ALL_CATS });
  await page.goto(`/?embed=1#AE/BW/4/${CRATE.x1 + 12}/${CRATE.y1 - 20}/1.00`);
  await settle(page, CRATE);
  await settleArtwork(page);
  const above = await pixels(page, ABOVE_CRATE);
  const drill = await pixels(page, DRILL);
  // the hazards hidden with the objects still shown, so the masks over the sprites stay
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const config = await import(u("config.js"));
    const render = await import(u("painter/render.js"));
    config.CATS.find((c) => c.key === "hazard").on = false;
    render.draw();
  });
  const changed = (a, b) => a.filter((v, i) => v !== b[i]).length;
  expect(changed(await pixels(page, DRILL), drill)).toBeGreaterThan(0);
  expect(changed(await pixels(page, ABOVE_CRATE), above)).toBe(0);
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
  await settleArtwork(page);
  const client = await page.evaluate(async (w) => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("data/state.js"));
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

test("a sprite larger than its rectangle is hovered over its whole image", async ({ page }) => {
  const errors = trackErrors(page);
  await seedView(page, { show: { objects: true }, cats: ALL_CATS });
  await page.goto(`/?embed=1#AO/F2/4/${BALL.x1 + 12}/${BALL.y1 + 12}/1.60`);
  await settle(page, BALL);
  await settleArtwork(page);
  // a point inside the drawn sprite but clear of the placed rectangle
  const spot = await page.evaluate(async (b) => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("data/state.js"));
    const spritepaint = await import(u("painter/spritepaint.js"));
    const model = await import(u("model/model.js"));
    const t = st.state.path.tlvs.find((o) => o.name === "RollingBall" && o.x1 === b.x1);
    const [marker, sprite] = spritepaint.hitBoxes(t, st.LAYOUT);
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
  await settleArtwork(page);
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
    const render = await import(new URL("js/painter/render.js", location.href).href);
    render.draw();
  });
  expect(pink(await pixels(page, band))).toBeGreaterThan(0);
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
    const st = await import(u("data/state.js"));
    const { path } = st.state;
    const c = path.cams.find((c) => c.masks);
    const im = new Image();
    im.src = new URL(c.masks[0][1], location.href).href;
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
      const st = await import(u("data/state.js"));
      const render = await import(u("painter/render.js"));
      const spriteart = await import(u("painter/spriteart.js"));
      await spriteart.preloadPath(st.state.path);
      render.draw();
      const z = st.state.cam.z;
      const x = Math.round((st.dX(p.x) - st.state.cam.x) * z),
        y = Math.round((st.dY(p.y) - st.state.cam.y) * z);
      return [...document.getElementById("cv").getContext("2d").getImageData(x, y, 1, 1).data];
    }, at);
  const toggle = (key) =>
    page.evaluate(async (k) => {
      const sidebar = await import(new URL("js/chrome/sidebar.js", location.href).href);
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
