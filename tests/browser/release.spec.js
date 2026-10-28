import { test, expect } from "@playwright/test";
import { seedView, trackErrors, settle } from "./helpers.js";

// The view below is window-interior on both axes, so its hash reproduces
// exactly; every release shares the base's geometry, so it is the same place
// in each of them.
const VIEW = "#AO/R1/15/9781/786/1.00";

const probe = (page) =>
  page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const { state } = await import(u("state.js"));
    const nav = await import(u("navigate.js"));
    return {
      release: state.data.release?.code ?? null,
      game: state.data.game,
      gameButton: document.querySelector('#gameBtns button[data-key="AO"]').title,
      row: [...document.querySelectorAll("#releaseBtns button")].map(
        (b) => b.textContent + (b.classList.contains("on") ? "*" : ""),
      ),
      tip: document.querySelector("#releaseBtns button.on").title,
      fold: [
        document.querySelector("#releaseMenu").open,
        document.querySelector("#releaseName").textContent,
      ],
      cam: { ...state.cam },
      view: nav.viewHash(),
      regional: state.path.cams.filter((c) =>
        [c.png, ...(c.patches ?? []).map(([, , f]) => f)].some((f) => f?.startsWith("cams/ao/jp/")),
      ).length,
    };
  });

const releaseIs = (page, code) =>
  page.waitForFunction(async (code) => {
    const { state } = await import(new URL("js/state.js", location.href).href);
    return (state.data?.release?.code ?? null) === code;
  }, code);

test("a release link opens the release, and the row swaps releases in place", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/${VIEW}/jp`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  await releaseIs(page, "jp");
  const jp = await probe(page);
  expect(jp.game).toBe("Abe a GoGo");
  expect(jp.gameButton).toBe("Abe a GoGo");
  expect(jp.row).toEqual([
    "USA, Rev 2",
    "USA, first pressing",
    "USA, Rev 1",
    "Europe",
    "France",
    "Germany",
    "Italy",
    "Spain",
    "Japan*",
  ]);
  expect(jp.tip).toMatch(/^Japan: Abe a GoGo, in Japanese\. Japanese text on the signs/);
  expect(jp.fold).toEqual([false, "Japan"]);
  expect(jp.view).toBe(`${VIEW}/jp`);
  expect(jp.regional).toBeGreaterThan(0);

  await page.locator("#releaseMenu > summary").click();
  await page.locator("#releaseBtns button", { hasText: "Europe" }).click();
  await releaseIs(page, "eu");
  await expect(page).toHaveURL(new RegExp(`${VIEW}/eu$`));
  const eu = await probe(page);
  expect(eu.cam).toEqual(jp.cam);
  expect(eu.row).toEqual([
    "USA, Rev 2",
    "USA, first pressing",
    "USA, Rev 1",
    "Europe*",
    "France",
    "Germany",
    "Italy",
    "Spain",
    "Japan",
  ]);
  expect(eu.fold).toEqual([true, "Europe"]);
  expect(eu.regional).toBe(0);

  await page.locator('#releaseBtns button[data-key=""]').click();
  await releaseIs(page, null);
  await expect(page).toHaveURL(new RegExp(`${VIEW}$`));
  const us = await probe(page);
  expect(us.cam).toEqual(jp.cam);
  expect(us.tip).toBe("USA, Rev 2: Abe's Oddysee, in English.");
  expect(us.fold).toEqual([true, "USA, Rev 2"]);
  expect(us.game).toBe("Oddworld: Abe's Oddysee");

  await page.goBack();
  await releaseIs(page, "eu");
  expect(errors).toEqual([]);
});

test("an object link names the base's origin, and opens on the object in any release", async ({
  page,
}) => {
  const errors = trackErrors(page);
  // the European release moves this StartController from (3700,304) to (3707,305)
  await page.goto("/#AO/D1/3/3700/300/1.00/StartController@3700,304/eu");
  await settle(page, { game: "AO", level: "D1", path: 3 });
  await releaseIs(page, "eu");
  await expect(page.locator("#toastStack")).toContainText("marker on StartController");
  const link = await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const { state } = await import(u("state.js"));
    const nav = await import(u("navigate.js"));
    const t = state.path.tlvs.find((o) => o.name === "StartController" && o.x1 === 3707);
    return t && nav.objectHash(t);
  });
  expect(link).toMatch(/\/StartController@3700,304\/eu$/);
  // one the release drops leaves the view on its path and names the release
  await page.goto("/#AO/F1/5/7140/2370/1.00/DeathDrop@7128,2366/eu");
  await settle(page, { game: "AO", level: "F1", path: 5 });
  await expect(page.locator("#toastStack")).toContainText("is not in the Europe release");
  expect(errors).toEqual([]);
});

test("a code the map does not carry lands on the base and says so", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/${VIEW}/us-r3`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  await expect(page.locator("#toastStack")).toContainText("this map carries no us-r3 release");
  expect((await probe(page)).release).toBeNull();
  expect(errors).toEqual([]);
});

test("the mark is offered while a release is in hand, and its toggle takes it away", async ({
  page,
}) => {
  const errors = trackErrors(page);
  // the European release drops a DeathDrop on this path and adds one of its own
  await page.goto("/#AO/F1/5/8100/2300/1.20/eu");
  await settle(page, { game: "AO", level: "F1", path: 5 });
  await releaseIs(page, "eu");
  const row = page.locator("#releaseRow");
  const tag = page.locator("#placeRelease");
  await expect(row).toBeVisible();
  await expect(tag).toBeVisible();
  await expect(tag).toHaveText("eu");
  await expect(page.locator("#pathBtns button.released")).not.toHaveCount(0);
  await row.locator("input").uncheck();
  await expect(tag).toBeHidden();
  await expect(page.locator("#pathBtns button.released")).toHaveCount(0);
  await row.locator("input").check();
  await expect(tag).toBeVisible();
  // the canvas's name is the sentence the status region says once the steps settle
  await expect(page.locator("#cv")).toHaveAttribute(
    "aria-label",
    /Abe's Oddysee, Europe, .*changed in the Europe release/,
  );
  await page.locator("#releaseMenu > summary").click();
  await page.locator('#releaseBtns button[data-key=""]').click();
  await releaseIs(page, null);
  await expect(row).toBeHidden();
  await expect(tag).toBeHidden();
  expect(errors).toEqual([]);
});

// a viewer from before releases reads only owm:edits and writes back what its
// sanitizer kept, so a release's edits must never land under that key
test("an edit in a release keeps a store of its own, and survives a reload", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/${VIEW}/eu`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  await releaseIs(page, "eu");
  const nudge = () =>
    page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const { state } = await import(u("state.js"));
      const edits = await import(u("edits.js"));
      const data = await import(u("data.js"));
      edits.setLevelShort("AO", (await data.loadEditorData("AO")).level_short);
      const t = state.path.tlvs.find((o) => o.name === "Door");
      edits.applyRectEdit(t, [t.x1 + 1, t.y1, t.x2 + 1, t.y2]);
      return { x1: t.x1, y1: t.y1 };
    });
  const stores = () =>
    page.evaluate(() =>
      Object.fromEntries(
        Object.keys(localStorage)
          .filter((k) => k.startsWith("owm:edits"))
          .map((k) => [k, JSON.parse(localStorage.getItem(k))]),
      ),
    );
  const door = await nudge();
  const key = `Door@${door.x1},${door.y1}`;
  const eu = await stores();
  expect(Object.keys(eu)).toEqual(["owm:edits:eu"]);
  expect(eu["owm:edits:eu"].AO["R1/15"].objects[key].rect[0]).toBe(door.x1 + 1);

  await page.locator("#releaseMenu > summary").click();
  await page.locator('#releaseBtns button[data-key=""]').click();
  await releaseIs(page, null);
  const shipped = await page.evaluate(async (x1) => {
    const { state } = await import(new URL("js/state.js", location.href).href);
    return state.path.tlvs.some((o) => o.name === "Door" && o.x1 === x1);
  }, door.x1);
  expect(shipped).toBe(true);
  await nudge();
  const both = await stores();
  expect(Object.keys(both).sort()).toEqual(["owm:edits", "owm:edits:eu"]);
  expect(both["owm:edits:eu"]).toEqual(eu["owm:edits:eu"]);

  await page.goto(`/${VIEW}/eu`);
  await page.reload();
  await settle(page, { game: "AO", level: "R1", path: 15 });
  await releaseIs(page, "eu");
  const moved = await page.evaluate(async (x1) => {
    const { state } = await import(new URL("js/state.js", location.href).href);
    return state.path.tlvs.some((o) => o.name === "Door" && o.x1 === x1);
  }, door.x1 + 1);
  expect(moved).toBe(true);
  expect(errors).toEqual([]);
});

test("a patched screen paints the base's picture with the release's patches over it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedView(page, { show: { release: false } });
  await page.goto(`/${VIEW}/jp`);
  await settle(page, { game: "AO", level: "R1", path: 15 });
  await releaseIs(page, "jp");
  const seen = await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const { state, LAYOUT } = await import(u("state.js"));
    const render = await import(u("render.js"));
    const cam = state.path.cams.find((c) => c.patches);
    const decoded = async (src) => {
      const im = new Image();
      im.src = new URL(src, location.href).href;
      await im.decode();
      return im;
    };
    const canvas = (...draws) => {
      const oc = document.createElement("canvas");
      oc.width = LAYOUT.visW;
      oc.height = LAYOUT.visH;
      for (const [im, x, y] of draws) oc.getContext("2d").drawImage(im, x, y);
      return oc;
    };
    const base = await decoded(cam.png);
    const patches = await Promise.all(
      cam.patches.map(async ([x, y, f]) => [await decoded(f), x, y]),
    );
    const want = canvas([base, 0, 0], ...patches);
    const under = canvas([base, 0, 0]);
    // the painter's own frame at zoom 1, the screen's corner at the canvas's
    await render.preloadPath(state.path);
    const got = canvas();
    const x = (cam.cell % state.path.w) * LAYOUT.cellW,
      y = Math.floor(cam.cell / state.path.w) * LAYOUT.cellH;
    render.paint(got.getContext("2d"), { x, y, z: 1 }, LAYOUT.visW, LAYOUT.visH, 1, false);
    const px = (oc) => oc.getContext("2d").getImageData(0, 0, oc.width, oc.height).data;
    const differ = (a, b) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
    // at a third of the size, the same picture standing as the camera's whole
    // screen, an image, has to paint alike
    const third = () => {
      const oc = document.createElement("canvas");
      oc.width = Math.ceil(LAYOUT.visW / 3);
      oc.height = Math.ceil(LAYOUT.visH / 3);
      render.paint(oc.getContext("2d"), { x, y, z: 1 / 3 }, oc.width, oc.height, 1, false);
      return oc;
    };
    const patched = third();
    const own = { png: cam.png, patches: cam.patches };
    cam.png = URL.createObjectURL(await new Promise((done) => want.toBlob(done)));
    delete cam.patches;
    await render.preloadPath(state.path);
    const whole = third();
    Object.assign(cam, own);
    return {
      name: cam.name,
      offWant: differ(px(got), px(want)),
      offBase: differ(px(got), px(under)),
      offWhole: differ(px(patched), px(whole)),
    };
  });
  expect(seen.offWant).toBe(0);
  expect(seen.offBase).toBeGreaterThan(0);
  expect(seen.offWhole).toBe(0);
  expect(errors).toEqual([]);
});
