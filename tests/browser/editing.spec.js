import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { DEFAULT_CATS, seedView, settleAny, trackErrors } from "./helpers.js";
import { canonical } from "../../public/js/reliveexport.js";
import { DIGESTS, aimAtDoor, armEditing, attach, doorCamera, download } from "./edithelpers.js";

const editOn = (page) => page.evaluate(() => window.__st.edit);

const doorNow = (page, d) =>
  page.evaluate((d) => {
    const st = window.__st;
    const at = (P) => P.tlvs.find((o) => o.name === "Door" && o.x1 === d.x1 && o.y1 === d.y1);
    const t = at(st.path);
    return {
      camera: t.fields.camera,
      toCam: t.extra.to_cam,
      pristineCamera: at(window.__pristine).fields.camera,
      swapped: st.path !== window.__pristine,
      standing: st.data.levels.includes(st.lvl),
      edited: window.__edits.pathEdited(st.path),
    };
  }, d);

test("the mode selects an object, the form edits it, and every surface follows", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await armEditing(page);
  await page.goto("/#AE");
  await settleAny(page);
  await attach(page);
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__st.edit === true);
  await expect(page.locator("#editBtn")).toHaveAttribute("aria-pressed", "true");

  const door = await aimAtDoor(page);
  await page.mouse.click(door.x, door.y);
  await expect(page.locator("#editPanel")).toBeVisible();
  expect(
    await page.evaluate(() => [window.__st.sel.name, window.__st.sel.x1, window.__st.sel.y1]),
  ).toEqual(["Door", door.x1, door.y1]);
  await page.evaluate(() => {
    window.__pristine = window.__st.path;
  });

  const input = page.locator('#editBody input[data-field="camera"]');
  await input.fill(String(door.camera + 1));
  await input.press("Tab");
  await page.waitForFunction((c) => window.__st.sel?.fields.camera === c, door.camera + 1);
  expect(await doorNow(page, door)).toEqual({
    camera: door.camera + 1,
    toCam: door.camera + 1,
    pristineCamera: door.camera,
    swapped: true,
    standing: true,
    edited: true,
  });
  await expect(page.locator("#editBody .ep-shipped")).toContainText(`shipped: ${door.camera}`);

  // the edit says so wherever the object or its path shows
  await page.mouse.move(door.x, door.y);
  await expect(page.locator("#tip")).toContainText("edited on this device: camera");
  await expect(page.locator("#pathBtns button.on")).toHaveClass(/edited/);
  await expect(page.locator("#placeEdited")).toBeVisible();

  // and every export of the path says so in its name
  const json = await download(page, "#exportJsonBtn");
  expect(json.suggestedFilename()).toBe("oddworld-ae-MI-P1-edited.json");
  const doc = JSON.parse(readFileSync(await json.path(), "utf8"));
  const exported = doc.map.cameras
    .flatMap((c) => c.map_objects)
    .find(
      (o) =>
        o.object_structures_type === "Door" &&
        o.properties.xpos === door.x1 &&
        o.properties.ypos === door.y1,
    );
  expect(exported.properties.Camera).toBe(door.camera + 1);
  expect((await download(page, "#exportBtn")).suggestedFilename()).toBe(
    "oddworld-ae-MI-P1-view-edited.png",
  );

  // a Places hit onto the same path lands on the objects now standing
  await page.fill("#searchInput", "necrum mines");
  await page.waitForSelector("#searchResults .hit");
  await page
    .locator("#searchResults .hit")
    .filter({ has: page.locator(".loc", { hasText: /^AE · MI P1$/ }) })
    .first()
    .click();
  expect((await doorNow(page, door)).camera).toBe(door.camera + 1);

  // a number input takes `e` as an exponent, never as the mode's key
  const again = await aimAtDoor(page); // the jump re-fit the view
  await page.mouse.click(again.x, again.y);
  await expect(page.locator("#editPanel")).toBeVisible();
  await page.locator('#editBody input[data-field="camera"]').focus();
  await page.keyboard.press("e");
  expect(await editOn(page)).toBe(true);

  // the graph covers the map: opening it leaves the mode, and `e` under it is refused
  await page.locator('#editBody input[data-field="camera"]').blur(); // map keys aim at the map
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await page.waitForFunction(() => window.__st.graph === true);
  expect(await editOn(page)).toBe(false);
  await expect(page.locator("#editBtn")).toBeHidden();
  await page.keyboard.press("e");
  expect(await editOn(page)).toBe(false);
  await expect(
    page.locator('#graphPlane .gv-node[data-lv="MI"][data-pa="1"] .gv-ed'),
  ).toBeVisible();
  expect((await download(page, "#graphSvgBtn")).suggestedFilename()).toBe(
    "oddworld-ae-graph-edited.svg",
  );
  await page.keyboard.press("v");
  await page.waitForFunction(() => window.__st.graph === false);

  // a revert puts the pristine path itself back
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__st.edit === true);
  const back = await aimAtDoor(page);
  await page.mouse.click(back.x, back.y);
  await page.locator("#editBody .ep-foot .linkbtn", { hasText: "Revert this path" }).click();
  await page.waitForFunction(() => window.__st.path === window.__pristine);
  expect(await page.evaluate(() => window.__edits.pathEdited(window.__st.path))).toBe(false);
  await expect(page.locator("#placeEdited")).toBeHidden();
  const plain = await download(page, "#exportJsonBtn");
  expect(plain.suggestedFilename()).toBe("oddworld-ae-MI-P1.json");
  const digest = createHash("sha256")
    .update(canonical(JSON.parse(readFileSync(await plain.path(), "utf8"))))
    .digest("hex");
  expect(digest).toBe(DIGESTS.AE["MI P1"]);
  expect(errors).toEqual([]);
});

test("undo and redo step a path's edits, on the keys and in the panel", async ({ page }) => {
  const errors = trackErrors(page);
  await armEditing(page);
  await page.goto("/#AE");
  await settleAny(page);
  await attach(page);
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__st.edit === true);
  const door = await aimAtDoor(page);
  await page.mouse.click(door.x, door.y);
  const camera = () => page.locator('#editBody input[data-field="camera"]');
  const cam = () => page.evaluate(() => window.__st.sel.fields.camera);
  for (const v of [door.camera + 1, door.camera + 2]) {
    await camera().fill(String(v));
    await camera().press("Tab");
    await page.waitForFunction((c) => window.__st.sel?.fields.camera === c, v);
  }
  // the chord acts once the keyboard has left the panel's fields
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+z");
  expect(await cam()).toBe(door.camera + 1);
  await page.keyboard.press("Control+Shift+z");
  expect(await cam()).toBe(door.camera + 2);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  expect(await cam()).toBe(door.camera);
  expect(await page.evaluate(() => window.__edits.pathEdited(window.__st.path))).toBe(false);
  await page.keyboard.press("Control+z"); // the trail's floor: nothing to step back to
  expect(await cam()).toBe(door.camera);
  await expect(page.locator("#editBody .ep-foot .linkbtn", { hasText: "undo" })).toBeDisabled();
  await expect(page.locator("#editBody .ep-foot .linkbtn", { hasText: "redo" })).toBeEnabled();
  const plain = await download(page, "#exportJsonBtn");
  expect(plain.suggestedFilename()).toBe("oddworld-ae-MI-P1.json");
  const digest = createHash("sha256")
    .update(canonical(JSON.parse(readFileSync(await plain.path(), "utf8"))))
    .digest("hex");
  expect(digest).toBe(DIGESTS.AE["MI P1"]);
  // in a field the chord is the browser's, and the trail is not spent
  await camera().focus();
  await page.keyboard.press("Control+z");
  expect(await cam()).toBe(door.camera);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+y");
  expect(await cam()).toBe(door.camera + 1);
  await page.locator("#editBody .ep-foot .linkbtn", { hasText: "undo" }).click();
  expect(await cam()).toBe(door.camera);
  expect(errors).toEqual([]);
});

test("the mode draws every marker, whatever Markers for the rest says", async ({ page }) => {
  const errors = trackErrors(page);
  await seedView(page, {
    show: { objects: true, markers: false, wires: false },
    cats: DEFAULT_CATS,
  });
  // the clock stopped, so only the mode's own repaint can change the canvas
  await page.addInitScript(() =>
    localStorage.setItem("owm:settings", JSON.stringify({ editObjects: true, animate: false })),
  );
  await page.goto("/#AE/MI/1");
  await settleAny(page);
  // the sheets land after the first paint; the canvas is read only once they have
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
  // a spawner has no sprite, no wire drawn and no way out: unseen until the mode wants it
  const boxes = () =>
    page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const render = await import(u("render.js"));
      const t = st.state.path.tlvs.find((o) => o.name === "SligSpawner");
      return {
        shown: render.objectShown(t),
        drawn: render.hitBoxes(t, st.LAYOUT).map((b) => b.drawn),
      };
    });
  // the canvas under the spawner's rect, read after the paint the mode flip schedules
  const pixels = async () => {
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    return page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const t = st.state.path.tlvs.find((o) => o.name === "SligSpawner");
      const cv = document.getElementById("cv");
      const z = st.state.cam.z;
      const x = (st.dX(t.x1) - st.state.cam.x) * z,
        y = (st.dY(t.y1) - st.state.cam.y) * z;
      const w = (st.dX(t.x2) - st.dX(t.x1)) * z,
        h = (st.dY(t.y2) - st.dY(t.y1)) * z;
      const px = cv
        .getContext("2d")
        .getImageData(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
      return [...px.data];
    });
  };
  expect(await boxes()).toEqual({ shown: false, drawn: [false] });
  const bare = await pixels();
  await page.keyboard.press("e");
  await page.waitForFunction(
    () => document.getElementById("editBtn").getAttribute("aria-pressed") === "true",
  );
  expect(await boxes()).toEqual({ shown: true, drawn: [true] });
  expect(await pixels()).not.toEqual(bare);
  await page.keyboard.press("e");
  await page.waitForFunction(
    () => document.getElementById("editBtn").getAttribute("aria-pressed") !== "true",
  );
  expect(await boxes()).toEqual({ shown: false, drawn: [false] });
  expect(await pixels()).toEqual(bare);
  expect(errors).toEqual([]);
});

test("editing waits behind a setting, and the data never does", async ({ page }) => {
  const errors = trackErrors(page);
  await seedView(page, { cats: DEFAULT_CATS });
  await page.goto("/#AE");
  await settleAny(page);
  await attach(page);
  await expect(page.locator("#editBtn")).toBeHidden();
  await page.keyboard.press("e");
  expect(await editOn(page)).toBe(false);

  // the setting reveals the button and lets the key in
  await page.click("#settingsBtn");
  await expect(page.locator("#editsHeld")).toBeHidden();
  await page.check("#sEditObjects");
  await page.click("#settingsClose");
  await expect(page.locator("#settingsOverlay")).toBeHidden(); // the fade still takes clicks
  await expect(page.locator("#editBtn")).toBeVisible();
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__st.edit === true);
  const door = await aimAtDoor(page);
  await page.mouse.click(door.x, door.y);
  const input = page.locator('#editBody input[data-field="camera"]');
  await input.fill(String(door.camera + 2));
  await input.press("Tab");
  await page.waitForFunction((c) => window.__st.sel?.fields.camera === c, door.camera + 2);

  // off again: the mode leaves and the button goes, the edit stands, marked and counted
  await page.click("#settingsBtn");
  await page.uncheck("#sEditObjects");
  expect(await editOn(page)).toBe(false);
  await expect(page.locator("#editPanel")).toBeHidden();
  await expect(page.locator("#editsCount")).toHaveText("1 object edited on 1 path");
  await page.click("#settingsClose");
  await expect(page.locator("#editBtn")).toBeHidden();
  await page.keyboard.press("e");
  expect(await editOn(page)).toBe(false);
  expect(await doorCamera(page, door)).toEqual({
    camera: door.camera + 2,
    toCam: door.camera + 2,
    edited: true,
  });
  await expect(page.locator("#placeEdited")).toBeVisible();

  // a reload applies the edit with the setting still off
  await page.reload();
  await settleAny(page);
  await attach(page);
  await expect(page.locator("#editBtn")).toBeHidden();
  expect((await doorCamera(page, door)).edited).toBe(true);
  expect((await download(page, "#exportJsonBtn")).suggestedFilename()).toBe(
    "oddworld-ae-MI-P1-edited.json",
  );
  await page.click("#settingsBtn");
  await page.check("#sEditObjects");
  await page.click("#settingsClose");
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__st.edit === true);
  expect(errors).toEqual([]);
});

test("an embed shows the shipped map: no button, and the key is refused", async ({ page }) => {
  const errors = trackErrors(page);
  await armEditing(page);
  await page.goto("/?embed=1#AE");
  await settleAny(page);
  await attach(page);
  await expect(page.locator("#editBtn")).toBeHidden();
  await page.keyboard.press("e");
  expect(await editOn(page)).toBe(false);
  expect(errors).toEqual([]);
});
