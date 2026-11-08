import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { settleAny, trackErrors } from "./helpers.js";
import { canonical } from "../../public/js/reliveexport.js";
import { DIGESTS, aimAtDoor, armEditing, attach, doorCamera, download } from "./edithelpers.js";

const pub = (f) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), "utf8"));

// a Door of MI P1 no other Door shares an origin with, so its store key is bare
function uniqueDoor() {
  const path = pub("map_data_ae.json")
    .levels.find((l) => l.short === "MI")
    .paths.find((p) => p.id === 1);
  const doors = path.tlvs.filter((t) => t.name === "Door");
  return doors.find((d) => doors.every((o) => o === d || o.x1 !== d.x1 || o.y1 !== d.y1));
}

test("edits stay on the device: a reload keeps them, any way in applies them, forgetting clears them", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await armEditing(page);
  await page.goto("/#AE");
  await settleAny(page);
  await attach(page);
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__st.edit === true);
  const door = await aimAtDoor(page);
  await page.mouse.click(door.x, door.y);
  const input = page.locator('#editBody input[data-field="camera"]');
  await input.fill(String(door.camera + 2));
  await input.press("Tab");
  await page.waitForFunction((c) => window.__st.sel?.fields.camera === c, door.camera + 2);
  // the store holds the difference, keyed by the object's origin
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("owm:edits")));
  const [key, delta] = Object.entries(stored.AE["MI/1"].objects)[0];
  expect(key.startsWith(`Door@${door.x1},${door.y1}`)).toBe(true);
  expect(delta).toEqual({ fields: { camera: door.camera + 2 } });

  // a reload applies it before the map is shown, marks and all
  await page.reload();
  await settleAny(page);
  await attach(page);
  expect(await doorCamera(page, door)).toEqual({
    camera: door.camera + 2,
    toCam: door.camera + 2,
    edited: true,
  });
  await expect(page.locator("#placeEdited")).toBeVisible();

  // so does a link into a game still in flight
  await page.goto("/#AO");
  await settleAny(page);
  await attach(page);
  await page.evaluate(() => {
    location.hash = "#AE/MI/1";
  });
  await page.waitForFunction(() => window.__st.data?.id === "AE" && window.__st.path?.id === 1);
  expect((await doorCamera(page, door)).camera).toBe(door.camera + 2);

  // an embed shows the disc's data
  await page.goto("/?embed=1#AE");
  await settleAny(page);
  await attach(page);
  expect(await doorCamera(page, door)).toEqual({
    camera: door.camera,
    toCam: door.camera,
    edited: false,
  });

  // forgetting takes two presses and leaves the device clean
  await page.goto("/#AE");
  await settleAny(page);
  await attach(page);
  await page.click("#settingsBtn");
  await expect(page.locator("#editsCount")).toHaveText("1 object edited on 1 path");
  await page.click("#editsForget");
  await expect(page.locator("#editsForget")).toHaveText("press again to forget");
  await page.click("#editsForget");
  await expect(page.locator("#editsHeld")).toBeHidden();
  await page.click("#settingsClose");
  expect(await page.evaluate(() => localStorage.getItem("owm:edits"))).toBeNull();
  expect((await doorCamera(page, door)).edited).toBe(false);
  const plain = await download(page, "#exportJsonBtn");
  expect(plain.suggestedFilename()).toBe("oddworld-ae-MI-P1.json");
  const digest = createHash("sha256")
    .update(canonical(JSON.parse(readFileSync(await plain.path(), "utf8"))))
    .digest("hex");
  expect(digest).toBe(DIGESTS.AE["MI P1"]);
  expect(errors).toEqual([]);
});

// the labels are awaited before stored deltas apply, so the outcome cannot ride
// the boot's own fetch race
test("a stored edit whose label a rebuild removed is dropped at boot, with a toast", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const door = uniqueDoor();
  const labels = pub("enum_labels_ae.json");
  const [field, gameType] = Object.entries(pub("field_types_ae.json").Door).find(
    ([, gt]) => labels[gt],
  );
  const value = +Object.keys(labels[gameType]).find((v) => +v !== door.fields[field]);
  delete labels[gameType][String(value)];
  await page.route("**/enum_labels_ae.json", (route) => route.fulfill({ json: labels }));
  await page.addInitScript((seed) => localStorage.setItem("owm:edits", JSON.stringify(seed)), {
    AE: { "MI/1": { objects: { [`Door@${door.x1},${door.y1}`]: { fields: { [field]: value } } } } },
  });
  await page.goto("/#AE");
  await expect(page.locator(".toast", { hasText: "no longer match the map data" })).toBeVisible();
  await settleAny(page);
  await attach(page);
  const now = await page.evaluate(
    (d) => {
      const t = window.__st.path.tlvs.find((o) => o.x1 === d.x1 && o.y1 === d.y1);
      return { value: t.fields[d.field], edited: window.__edits.pathEdited(window.__st.path) };
    },
    { x1: door.x1, y1: door.y1, field },
  );
  expect(now).toEqual({ value: door.fields[field], edited: false });
  expect(await page.evaluate(() => localStorage.getItem("owm:edits"))).toBeNull();
  expect(errors).toEqual([]);
});

// a table that did not load can validate nothing, so the deltas wait rather
// than pass on shape alone
test("a stored edit boots unapplied, and says so, when a field table does not load", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const door = uniqueDoor();
  const seed = {
    AE: {
      "MI/1": {
        objects: { [`Door@${door.x1},${door.y1}`]: { fields: { camera: door.fields.camera + 1 } } },
      },
    },
  };
  await page.route("**/enum_labels_ae.json", (route) =>
    route.fulfill({ contentType: "application/json", body: "not json" }),
  );
  await page.addInitScript((s) => localStorage.setItem("owm:edits", JSON.stringify(s)), seed);
  await page.goto("/#AE");
  await expect(
    page.locator(".toast", { hasText: "1 saved edit not applied: the editor data did not load" }),
  ).toBeVisible();
  await settleAny(page);
  await attach(page);
  const now = await page.evaluate(
    (d) => {
      const t = window.__st.path.tlvs.find((o) => o.x1 === d.x1 && o.y1 === d.y1);
      return { camera: t.fields.camera, edited: window.__edits.pathEdited(window.__st.path) };
    },
    { x1: door.x1, y1: door.y1 },
  );
  expect(now).toEqual({ camera: door.fields.camera, edited: false });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("owm:edits")))).toEqual(seed);
  expect(errors).toEqual([]);
});
