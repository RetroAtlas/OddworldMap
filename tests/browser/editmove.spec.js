import { expect, test } from "@playwright/test";
import { DEFAULT_CATS, POLL, digest, seedView, settleAny, trackErrors } from "./helpers.js";
import { aimAt, aimAtDoor, aimAtDoorNow, armEditing, attach } from "./edithelpers.js";

// the selected object's rect as the page holds it now
const selRect = (page) =>
  page.evaluate(() => {
    const t = window.__st.sel;
    return [t.x1, t.y1, t.x2, t.y2];
  });

test("the selection drags where the pointer carries it, nudges on the arrows and types its place", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await armEditing(page);
  await page.goto("/#AE");
  await settleAny(page);
  await attach(page);
  // outside the mode Alt with Shift and an arrow does nothing, as any Alt chord
  const camX0 = await page.evaluate(() => window.__st.cam.x);
  await page.keyboard.press("Alt+Shift+ArrowRight");
  expect(await page.evaluate(() => window.__st.cam.x)).toBe(camX0);
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__st.edit === true);
  const door = await aimAtDoor(page);
  const w = door.x2 - door.x1,
    h = door.y2 - door.y1;
  await page.mouse.click(door.x, door.y);
  await expect(page.locator("#editPanel")).toBeVisible();
  await expect(page.locator('#editBody input[data-place="x"]')).toHaveValue(String(door.x1));

  // a drag past the slip carries the door by the pointer's travel, 50 px being 25 units at zoom 2
  await page.mouse.move(door.x, door.y);
  await page.mouse.down();
  await page.mouse.move(door.x + 20, door.y + 8);
  await page.mouse.move(door.x + 50, door.y + 20);
  await page.mouse.up();
  await page.waitForFunction((d) => window.__st.sel?.x1 === d.x1 + 25, door);
  expect(await selRect(page)).toEqual([
    door.x1 + 25,
    door.y1 + 10,
    door.x1 + 25 + w,
    door.y1 + 10 + h,
  ]);
  await expect(page.locator("#editBody .ep-shipped")).toContainText(
    `shipped: ${door.x1},${door.y1}`,
  );
  await page.mouse.move(door.x + 50, door.y + 20);
  await expect(page.locator("#tip")).toContainText("edited on this device: moved");
  await expect(page.locator("#tip")).toContainText("drag to move");

  // a run of nudges is one step, and the chord takes the whole run back
  await page.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.waitForFunction((d) => window.__st.sel?.x1 === d.x1 + 28, door);
  await page.keyboard.press("Control+z");
  await page.waitForFunction((d) => window.__st.sel?.x1 === d.x1 + 25, door);

  // Alt beside Shift nudges by a grid square, the object's own, and that run is one step too
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await page.waitForFunction((d) => window.__st.sel?.x1 === d.x1 + 75, door);
  await page.keyboard.press("Control+z");
  await page.waitForFunction((d) => window.__st.sel?.x1 === d.x1 + 25, door);

  // Escape mid-drag lets the object go where it was, and the panel stays
  const grab = await aimAtDoorNow(page);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 30, grab.y + 30);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await selRect(page))[0]).toBe(door.x1 + 25);
  await expect(page.locator("#editPanel")).toBeVisible();

  // a bare arrow still pans the map rather than the object
  const camBefore = await page.evaluate(() => window.__st.cam.x);
  await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => window.__st.cam.x)).not.toBe(camBefore);
  expect((await selRect(page))[0]).toBe(door.x1 + 25);

  // Shift held through a drag snaps the door off the unsnapped place
  const at = await aimAtDoorNow(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(at.x + 14, at.y);
  await page.mouse.move(at.x + 30, at.y);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.waitForFunction((d) => window.__st.sel?.x1 !== d.x1 + 25, door);
  const snapped = await page.evaluate(() => {
    const t = window.__st.sel;
    return { x1: t.x1, y1: t.y1 };
  });
  expect(snapped.x1).not.toBe(door.x1 + 40);
  expect(snapped.y1).toBe(door.y1 + 10);
  const x1Now = snapped.x1;

  // the Place rows type the position, the size keeping the top-left, and ↺ puts the rect back
  const input = (k) => page.locator(`#editBody input[data-place="${k}"]`);
  await input("w").fill(String(w + 10));
  await input("w").press("Tab");
  await page.waitForFunction((x2) => window.__st.sel?.x2 === x2, x1Now + w + 10);
  expect(await selRect(page)).toEqual([x1Now, door.y1 + 10, x1Now + w + 10, door.y1 + 10 + h]);
  await page.locator("#editBody .ep-shipped .ep-back").click();
  await page.waitForFunction((d) => window.__st.sel?.x1 === d.x1, door);
  expect(await selRect(page)).toEqual([door.x1, door.y1, door.x2, door.y2]);

  // put back as shipped takes every change to the object away in one press, and one undo brings it back
  await input("x").fill(String(door.x1 + 30));
  await input("x").press("Tab");
  await page.waitForFunction((d) => window.__st.sel?.x1 === d.x1 + 30, door);
  const camera = page.locator('#editBody input[data-field="camera"]');
  await camera.fill(String(door.camera + 1));
  await camera.press("Tab");
  await page.waitForFunction((c) => window.__st.sel?.fields.camera === c, door.camera + 1);
  await page.locator('#editBody [data-action="revert"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (d) => window.__st.sel?.x1 === d.x1 && window.__st.sel?.fields.camera === d.camera,
    door,
  );
  await expect(page.locator('#editBody [data-action="revert"]')).toHaveCount(0);
  await expect(page.locator("#editPanel")).toBeFocused();
  await page.keyboard.press("Control+z");
  await page.waitForFunction((d) => window.__st.sel?.x1 === d.x1 + 30, door);
  await page.keyboard.press("Control+Shift+z");
  await page.waitForFunction((d) => window.__st.sel?.x1 === d.x1, door);

  // the permalink names the shipped origin and lands on the object where it now stands
  await input("x").fill(String(door.x1 + 100));
  await input("x").press("Tab");
  await page.waitForFunction((d) => window.__st.sel?.x1 === d.x1 + 100, door);
  const link = await page.evaluate(() => window.__nav.objectHash(window.__st.sel));
  expect(link).toContain(`/Door@${door.x1},${door.y1}`);
  await page.goto("/" + link);
  await page.reload();
  await expect(page.locator(".toast", { hasText: "marker on Door" })).toBeVisible();
  await settleAny(page);
  await attach(page);
  expect(
    await page.evaluate(
      (d) =>
        window.__st.path.tlvs.some(
          (o) => o.name === "Door" && o.x1 === d.x1 + 100 && o.y1 === d.y1,
        ),
      door,
    ),
  ).toBe(true);
  const centre = await page.evaluate(async (d) => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const stateModule = await import(u("data/state.js"));
    const st = stateModule.state;
    const t = st.path.tlvs.find((o) => o.name === "Door" && o.x1 === d.x1 + 100 && o.y1 === d.y1);
    const [cx, cy] = window.__model.markerCentre(t, stateModule.LAYOUT);
    const cv = document.getElementById("cv");
    const c = window.__model.camCenter(st.cam, cv.clientWidth, cv.clientHeight);
    return [Math.round(c.x - cx), Math.round(c.y - cy)];
  }, door);
  expect(centre).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

test("a carried object stands where the pointer holds it, as its release will stand it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  // every sprite on its first frame, so two reads of one scene agree
  await page.emulateMedia({ reducedMotion: "reduce" });
  await armEditing(page);
  await seedView(page, { show: { objects: true }, cats: DEFAULT_CATS });
  await page.goto("/#AE");
  await settleAny(page);
  await attach(page);
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__st.edit === true);
  const door = await aimAtDoor(page);
  await page.mouse.click(door.x, door.y);
  await expect(page.locator("#editPanel")).toBeVisible();
  // the door and every place the drags below carry it
  const around = { x1: door.x1 - 40, y1: door.y1 - 100, x2: door.x2 + 90, y2: door.y2 + 60 };
  const painted = async () => {
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    return digest(page, around);
  };
  const carry = async (dx, dy) => {
    const at = await aimAtDoorNow(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + dx / 2, at.y + dy / 2);
    await page.mouse.move(at.x + dx, at.y + dy);
  };
  // a first move marks the door edited, so its mark stands in every read below
  await carry(50, 0);
  await page.mouse.up();
  await page.waitForFunction((d) => window.__st.sel?.x1 === d.x1 + 25, door);
  const rest = await painted();

  // carried, the door leaves its place and stands as the release then stands it
  await carry(50, 20);
  const carried = await painted();
  expect(carried).not.toEqual(rest);
  await page.mouse.up();
  await page.waitForFunction((d) => window.__st.sel?.x1 === d.x1 + 50, door);
  const landed = await painted();
  expect(landed).toEqual(carried);

  // let go with Escape, it stands where it was
  await carry(40, 0);
  expect(await painted()).not.toEqual(landed);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await painted()).toEqual(landed);
  expect(errors).toEqual([]);
});

test("a carried object stands in its first frame while the scene runs", async ({ page }) => {
  const errors = trackErrors(page);
  await armEditing(page);
  await seedView(page, { show: { objects: true }, cats: DEFAULT_CATS });
  await page.goto("/#AE");
  await settleAny(page);
  await attach(page);
  await page.evaluate(async () => {
    window.__motion = await import(new URL("js/engine/motion.js", location.href).href);
  });
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__st.edit === true);
  const orb = await aimAt(page, "SecurityOrb");
  // the orb's place and the place the carry below holds it, each padded for the sprite's spill
  const around = (dx, dy) => ({
    x1: orb.x1 + dx - 20,
    y1: orb.y1 + dy - 20,
    x2: orb.x2 + dx + 20,
    y2: orb.y2 + dy + 20,
  });
  const painted = async (rect) => {
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    return digest(page, rect);
  };
  // the same read a few frames of the orb's turn later
  const TURNS = 12;
  const later = async (rect) => {
    const since = await page.evaluate(() => window.__motion.sceneTick());
    await page.waitForFunction((t) => window.__motion.sceneTick() >= t, since + TURNS, POLL);
    return painted(rect);
  };
  await page.mouse.click(orb.x, orb.y);
  await expect(page.locator("#editPanel")).toBeVisible();
  await page.mouse.move(orb.x, orb.y);
  await page.mouse.down();
  await page.mouse.move(orb.x + 30, orb.y + 10);
  await page.mouse.move(orb.x + 60, orb.y + 20);
  const held = await painted(around(30, 10));
  expect(await later(around(30, 10))).toEqual(held);
  // let go with Escape, it turns again where it stood
  await page.keyboard.press("Escape");
  await page.mouse.up();
  const resting = await painted(around(0, 0));
  expect(await later(around(0, 0))).not.toEqual(resting);
  expect(errors).toEqual([]);
});
