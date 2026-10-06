import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import { DEFAULT_CATS, seedView, settleAny, trackErrors } from "./helpers.js";
import { canonical } from "../../public/js/reliveexport.js";

const DIGESTS = JSON.parse(
  readFileSync(new URL("../fixtures/relive-digests.json", import.meta.url), "utf8"),
);

// the exports fold under one control, closed at boot
async function download(page, selector) {
  if (!(await page.locator("#exportMenu").evaluate((d) => d.open)))
    await page.click("#exportMenu > summary");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(selector)]);
  return dl;
}

// the page's module singletons, stashed once so every poll below stays a
// synchronous read
async function attach(page) {
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    window.__st = (await import(u("state.js"))).state;
    window.__nav = await import(u("navigate.js"));
    window.__model = await import(u("model.js"));
    window.__edits = await import(u("edits.js"));
    window.__applied = location.hash;
    window.addEventListener("hashchange", () => (window.__applied = location.hash));
    const replace = history.replaceState.bind(history);
    history.replaceState = (...args) => {
      replace(...args);
      window.__applied = location.hash;
    };
  });
}
const editOn = (page) => page.evaluate(() => window.__st.edit);

// the setting that arms the mode, seeded before any module runs, beside the
// quiet view whose markers the clicks land on
const armEditing = async (page) => {
  await seedView(page, { cats: DEFAULT_CATS });
  await page.addInitScript(() =>
    localStorage.setItem("owm:settings", JSON.stringify({ editObjects: true })),
  );
};

// centre the standing path's first Door by setting the camera itself, the way
// settle() does, so no scheduled hash write can re-apply under the click; returns
// where the door is on the screen. A jump's own pushed write is flushed first and
// the re-apply of a hash it changed waited for: a hashchange still queued when
// the camera is set would re-fit the view from under the click that follows
const aimAtDoor = (page) =>
  page.evaluate(async () => {
    const st = window.__st;
    const render = await import(new URL("js/render.js", location.href).href);
    const stateModule = await import(new URL("js/state.js", location.href).href);
    window.__nav.flushHash();
    while (location.hash !== window.__applied)
      await new Promise((r) => window.addEventListener("hashchange", r, { once: true }));
    const t = st.path.tlvs.find((o) => o.name === "Door" && o.fields);
    const [cx, cy] = window.__model.markerCentre(t, stateModule.LAYOUT);
    const cv = document.getElementById("cv");
    Object.assign(
      st.cam,
      window.__model.centerCam({ x: cx, y: cy, z: 2 }, cv.clientWidth, cv.clientHeight),
    );
    render.draw();
    const r = cv.getBoundingClientRect();
    return {
      x: r.left + (cx - st.cam.x) * st.cam.z,
      y: r.top + (cy - st.cam.y) * st.cam.z,
      x1: t.x1,
      y1: t.y1,
      camera: t.fields.camera,
    };
  });

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

// the camera of the standing path's first Door, as the page sees it now
const doorCamera = (page, d) =>
  page.evaluate((d) => {
    const st = window.__st;
    const t = st.path.tlvs.find((o) => o.name === "Door" && o.x1 === d.x1 && o.y1 === d.y1);
    return {
      camera: t.fields.camera,
      toCam: t.extra.to_cam,
      edited: window.__edits.pathEdited(st.path),
    };
  }, d);

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

const pub = (f) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), "utf8"));

// a Door of MI P1 no other Door shares an origin with, so its store key is bare
function uniqueDoor() {
  const path = pub("map_data_ae.json")
    .levels.find((l) => l.short === "MI")
    .paths.find((p) => p.id === 1);
  const doors = path.tlvs.filter((t) => t.name === "Door");
  return doors.find((d) => doors.every((o) => o === d || o.x1 !== d.x1 || o.y1 !== d.y1));
}

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
  await settleAny(page);
  await expect(page.locator(".toast", { hasText: "no longer match the map data" })).toBeVisible();
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
  await settleAny(page);
  await expect(
    page.locator(".toast", { hasText: "1 saved edit not applied: the editor data did not load" }),
  ).toBeVisible();
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
  // the sheet lands after the first paint; the canvas is read only once it has
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
