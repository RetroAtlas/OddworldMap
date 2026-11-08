import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { settleAny, trackErrors } from "./helpers.js";
import { aimAtDoor, aimAtDoorNow, armEditing, attach, download } from "./edithelpers.js";

const routePoints = (page) =>
  page.evaluate(() => (window.__st.route ?? []).reduce((n, s) => n + s.pts.length, 0));

test("a removed object stands as a ghost to restore, and Backspace leaves a route its points", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await armEditing(page);
  await page.goto("/#AE");
  await settleAny(page);
  await attach(page);
  // a route plotted and its tool disarmed stays drawn
  await page.keyboard.press("r");
  await page.waitForFunction(() => window.__st.show.route === true);
  const box = await page.locator("#cv").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2 + 40, box.y + box.height / 2);
  await page.waitForFunction(
    () => (window.__st.route ?? []).reduce((n, s) => n + s.pts.length, 0) === 2,
  );
  await page.keyboard.press("r");
  await page.waitForFunction(() => window.__st.show.route === false);
  expect(await routePoints(page)).toBe(2);

  // Backspace with a selection removes the object and leaves the route alone
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__st.edit === true);
  const door = await aimAtDoor(page);
  await page.mouse.click(door.x, door.y);
  await expect(page.locator("#editPanel")).toBeVisible();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Backspace");
  await page.waitForFunction(() => window.__edits.isRemoved(window.__st.sel));
  expect(await routePoints(page)).toBe(2);
  const gone = await page.evaluate((d) => {
    const st = window.__st;
    return {
      standing: st.path.tlvs.some((o) => o.name === "Door" && o.x1 === d.x1 && o.y1 === d.y1),
      ghosts: window.__edits.removedObjects(st.path).length,
      stored: Object.values(JSON.parse(localStorage.getItem("owm:edits")).AE["MI/1"].objects),
      disabled: document.querySelector("#editBody fieldset")?.disabled,
    };
  }, door);
  expect(gone).toEqual({ standing: false, ghosts: 1, stored: [{ removed: true }], disabled: true });
  await expect(page.locator("#editTitle")).toContainText("removed on this device");
  await expect(page.locator('#editBody [data-action="restore"]')).toBeVisible();
  await expect(page.locator('#editBody [data-action="remove"]')).toHaveCount(0);
  await expect(page.locator("#editBody .ep-foot")).toContainText("1 removed on this path");

  // the panel's own restore puts the door back, keeps the keyboard on the actions row, and Delete removes it again
  await page.locator('#editBody [data-action="restore"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (d) => window.__st.path.tlvs.some((o) => o.name === "Door" && o.x1 === d.x1 && o.y1 === d.y1),
    door,
  );
  await expect(page.locator('#editBody [data-action="remove"]')).toBeFocused();
  await page.keyboard.press("Delete");
  await page.waitForFunction(() => window.__edits.isRemoved(window.__st.sel));
  await expect(page.locator("#editBody .ep-keys")).toContainText("restore puts it back");
  await page.click("#settingsBtn");
  await expect(page.locator("#editsCount")).toHaveText("1 object edited on 1 path");
  await page.click("#settingsClose");
  await expect(page.locator("#settingsOverlay")).toBeHidden();

  // a ghost takes no second removal, and Backspace over one is the route's again
  await page.keyboard.press("Backspace");
  expect(await routePoints(page)).toBe(1);
  expect(await page.evaluate(() => window.__edits.removedObjects(window.__st.path).length)).toBe(1);
  // and Shift with an arrow over one pans the map, as it does with nothing selected
  const camX = await page.evaluate(() => window.__st.cam.x);
  await page.keyboard.press("Shift+ArrowRight");
  expect(await page.evaluate(() => window.__st.cam.x)).not.toBe(camX);
  expect(await page.evaluate(() => window.__edits.isRemoved(window.__st.sel))).toBe(true);
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await page.evaluate(() => window.__st.cam.x)).toBeCloseTo(camX, 6);
  await page.keyboard.press("Escape");
  await expect(page.locator("#editPanel")).toBeHidden();
  await page.keyboard.press("Backspace");
  expect(await routePoints(page)).toBe(0);
  await page.mouse.move(door.x + 1, door.y + 1);
  await expect(page.locator("#tip")).toContainText("removed on this device");
  await expect(page.locator("#tip")).toContainText("click to select");
  await page.mouse.click(door.x, door.y);
  await expect(page.locator("#editPanel")).toBeVisible();
  expect(await page.evaluate(() => window.__edits.isRemoved(window.__st.sel))).toBe(true);

  // the screen list names the ghost and offers its restore
  await page.keyboard.press("Escape");
  await page.keyboard.press("l");
  await expect(page.locator("#camPanel")).toBeVisible();
  await expect(page.locator("#camPanelTitle")).toContainText("1 removed");
  await expect(page.locator('#camPanel .rowtool[aria-label="Restore Door"]')).toHaveCount(1);
  await page.keyboard.press("Escape");

  // a reload keeps the removal, and a link to the door says so
  const link = await page.evaluate(() =>
    window.__nav.objectHash(window.__edits.removedObjects(window.__st.path)[0]),
  );
  expect(link).toContain(`/Door@${door.x1},${door.y1}`);
  await page.goto("/" + link);
  await page.reload();
  await expect(page.locator(".toast", { hasText: "Door removed on this device" })).toBeVisible();
  await settleAny(page);
  await attach(page);
  expect(await page.evaluate(() => window.__edits.removedObjects(window.__st.path).length)).toBe(1);

  // the screen list's restore puts the door back, and the path is the disc's again
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__st.edit === true);
  await page.keyboard.press("l");
  await page.locator('#camPanel .rowtool[aria-label="Restore Door"]').click();
  await page.waitForFunction(
    (d) => window.__st.path.tlvs.some((o) => o.name === "Door" && o.x1 === d.x1 && o.y1 === d.y1),
    door,
  );
  expect(await page.evaluate(() => window.__edits.pathEdited(window.__st.path))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("owm:edits"))).toBeNull();
  await expect(page.locator('#camPanel .rowtool[aria-label="Restore Door"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the picker adds an object at the view's centre, marked added, exported whole, its category brought back", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await armEditing(page);
  await page.goto("/#AE");
  await settleAny(page);
  await attach(page);
  await expect(page.locator("#editAddBtn")).toBeHidden();
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__st.edit === true);
  const before = await page.evaluate(() => window.__st.path.tlvs.length);
  // the sidebar's button comes with the mode and opens the picker, as n does
  await page.click("#editAddBtn");
  await expect(page.locator("#editTitle")).toContainText("Add an object");
  await page.keyboard.press("Escape");
  await expect(page.locator("#editPanel")).toBeHidden();
  await page.keyboard.press("n");
  await expect(page.locator("#editPanel")).toBeVisible();
  await expect(page.locator("#editTitle")).toContainText("Add an object");
  const filter = page.locator("#editBody .ep-filter");
  await expect(filter).toBeFocused();
  await expect(filter).toHaveValue("");
  await expect(page.locator("#editBody .ep-typerow")).toHaveCount(
    await page.evaluate(() => window.__edits.typeNames(window.__st.data).length),
  );

  // the arrows walk the rows from the filter and back up to it, and leave the map where it is
  const camX = await page.evaluate(() => window.__st.cam.x);
  await filter.press("ArrowDown");
  await expect(page.locator("#editBody .ep-typerow").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#editBody .ep-typerow").nth(1)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(filter).toBeFocused();
  expect(await page.evaluate(() => window.__st.cam.x)).toBe(camX);
  await filter.fill("door");
  const doorTypes = await page.evaluate(() =>
    window.__edits.typeNames(window.__st.data).filter((n) => n.toLowerCase().includes("door")),
  );
  await expect(page.locator("#editBody .ep-typerow")).toHaveCount(doorTypes.length);
  await filter.press("Enter");
  await page.waitForFunction((n) => window.__st.path.tlvs.length === n + 1, before);
  const added = await page.evaluate(() => {
    const st = window.__st;
    const t = st.sel;
    return {
      name: t.name,
      added: window.__edits.isAdded(t),
      notes: window.__edits.editNotes(t),
      last: st.path.tlvs[st.path.tlvs.length - 1] === t,
      rect: [t.x1, t.y1, t.x2, t.y2],
      onScreen: st.path.cams.some(
        (c) => c.cell === window.__model.tlvCell(t, st.path, st.data.geometry),
      ),
      stored: JSON.parse(localStorage.getItem("owm:edits")).AE["MI/1"],
    };
  });
  expect(added.name).toBe("Door");
  expect(added.added).toBe(true);
  expect(added.notes).toEqual(["added"]);
  expect(added.last).toBe(true);
  expect(added.onScreen).toBe(true);
  expect(added.stored.next).toBe(2);
  expect(Object.keys(added.stored.objects)).toEqual(["+1"]);
  expect(added.stored.objects["+1"].name).toBe("Door");
  expect(added.stored.objects["+1"].rect).toEqual(added.rect);
  await expect(page.locator("#editTitle")).toContainText("added on this device");
  await expect(page.locator('#editBody [data-action="remove"]')).toBeVisible();
  await expect(page.locator('#editBody [data-action="revert"]')).toHaveCount(0);
  await expect(page.locator("#editBody .ep-foot")).toContainText("1 added on this path");

  // a second one of the kind steps aside rather than standing on the first
  await page.keyboard.press("n");
  await page.locator("#editBody .ep-filter").fill("door");
  await page.locator("#editBody .ep-filter").press("Enter");
  await page.waitForFunction((n) => window.__st.path.tlvs.length === n + 2, before);
  expect(await page.evaluate(() => [window.__st.sel.x1, window.__st.sel.y1])).toEqual([
    added.rect[0] + 25,
    added.rect[1],
  ]);
  await expect(page.locator("#editBody .ep-foot")).toContainText("2 added on this path");

  // the picker over a selection takes none of the form's keys: Backspace on a focused row removes nothing
  await page.keyboard.press("n");
  await expect(page.locator("#editTitle")).toContainText("Add an object");
  await page.locator("#editBody .ep-filter").press("Enter");
  await expect(page.locator("#editBody .ep-typerow").first()).toBeFocused();
  await page.keyboard.press("Backspace");
  expect(await page.evaluate(() => window.__st.path.tlvs.length)).toBe(before + 2);
  await page.keyboard.press("Escape");
  await expect(page.locator("#editTitle")).toContainText("added on this device");
  const at = await aimAtDoorNow(page);
  await page.mouse.move(at.x, at.y);
  await expect(page.locator("#tip")).toContainText("added on this device");

  // the export carries it with every property of its type
  const json = await download(page, "#exportJsonBtn");
  expect(json.suggestedFilename()).toBe("oddworld-ae-MI-P1-edited.json");
  const doc = JSON.parse(readFileSync(await json.path(), "utf8"));
  const exported = doc.map.cameras
    .flatMap((c) => c.map_objects)
    .find(
      (o) =>
        o.object_structures_type === "Door" &&
        o.properties.xpos === added.rect[0] &&
        o.properties.ypos === added.rect[1],
    );
  expect(exported).toBeTruthy();
  expect(Object.keys(exported.properties).length).toBeGreaterThan(20);

  // a type whose category is off is said so in the picker, and adding one brings the category back
  await page.keyboard.press("Escape");
  await expect(page.locator("#editPanel")).toBeHidden();
  await page.keyboard.press("n");
  await page.locator("#editBody .ep-filter").fill("hoist");
  await expect(page.locator("#editBody .ep-typerow.off")).toHaveCount(1);
  await page.locator("#editBody .ep-filter").press("Enter");
  await page.waitForFunction((n) => window.__st.path.tlvs.length === n + 3, before);
  expect(
    await page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const { CATS } = await import(u("config.js"));
      return CATS.find((c) => c.key === "nav").on;
    }),
  ).toBe(true);
  const hoist = await aimAtDoorNow(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("#editPanel")).toBeHidden();
  await page.mouse.move(hoist.x, hoist.y);
  await expect(page.locator("#tip")).toContainText("Hoist");

  // a pen post the Barriers toggle already draws is not called hidden, and adding one flips no filter
  await page.keyboard.press("p");
  await page.waitForFunction(() => window.__st.show.pens === true);
  await page.keyboard.press("n");
  await page.locator("#editBody .ep-filter").fill("SligBoundLeft");
  await expect(page.locator("#editBody .ep-typerow")).toHaveCount(1);
  await expect(page.locator("#editBody .ep-typerow.off")).toHaveCount(0);
  await page.locator("#editBody .ep-filter").press("Enter");
  await page.waitForFunction((n) => window.__st.path.tlvs.length === n + 4, before);
  expect(
    await page.evaluate(async () => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const { CATS } = await import(u("config.js"));
      return CATS.find((c) => c.key === "meta").on;
    }),
  ).toBe(false);

  // a reload keeps all four, and a revert takes them away
  await page.reload();
  await settleAny(page);
  await attach(page);
  expect(
    await page.evaluate(
      () => window.__st.path.tlvs.filter((t) => window.__edits.isAdded(t)).length,
    ),
  ).toBe(4);
  await page.evaluate(() => window.__edits.revertPath("AE", "MI", 1));
  expect(await page.evaluate(() => localStorage.getItem("owm:edits"))).toBeNull();
  expect(await page.evaluate((n) => window.__st.path.tlvs.length === n, before)).toBe(true);
  expect(errors).toEqual([]);
});

test("Ctrl+D puts a copy of the selection beside it, as an added object one undo takes away", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await armEditing(page);
  await page.goto("/#AE");
  await settleAny(page);
  await attach(page);
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__st.edit === true);
  const before = await page.evaluate(() => window.__st.path.tlvs.length);
  const door = await aimAtDoor(page);
  await page.mouse.click(door.x, door.y);
  await expect(page.locator("#editPanel")).toBeVisible();
  await expect(page.locator('#editBody [data-action="duplicate"]')).toBeVisible();
  await page.evaluate(() => document.activeElement?.blur());
  // a held key repeats its keydown; one press, one copy
  await page.keyboard.down("Control");
  await page.keyboard.down("d");
  await page.keyboard.down("d");
  await page.keyboard.up("d");
  await page.keyboard.up("Control");
  await page.waitForFunction((n) => window.__st.path.tlvs.length === n + 1, before);
  const copy = await page.evaluate((d) => {
    const st = window.__st;
    const t = st.sel;
    const original = st.path.tlvs.find((o) => o.name === "Door" && o.x1 === d.x1 && o.y1 === d.y1);
    return {
      added: window.__edits.isAdded(t),
      name: t.name,
      rect: [t.x1, t.y1, t.x2, t.y2],
      camera: t.fields.camera,
      sameFields: JSON.stringify(t.fields) === JSON.stringify(original.fields),
      stored: Object.values(JSON.parse(localStorage.getItem("owm:edits")).AE["MI/1"].objects),
    };
  }, door);
  expect(copy.added).toBe(true);
  expect(copy.name).toBe("Door");
  expect(copy.rect).toEqual([door.x1 + 25, door.y1, door.x2 + 25, door.y2]);
  expect(copy.camera).toBe(door.camera);
  expect(copy.sameFields).toBe(true);
  expect(copy.stored).toHaveLength(1);
  await expect(page.locator("#editTitle")).toContainText("added on this device");
  await page.keyboard.press("Control+z");
  await page.waitForFunction((n) => window.__st.path.tlvs.length === n, before);
  expect(await page.evaluate(() => localStorage.getItem("owm:edits"))).toBeNull();
  expect(errors).toEqual([]);
});
