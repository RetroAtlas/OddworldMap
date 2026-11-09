import { DEFAULT_CATS, seedView } from "./helpers.js";

// the exports fold under one control, closed at boot
export async function download(page, selector) {
  if (!(await page.locator("#exportMenu").evaluate((d) => d.open)))
    await page.click("#exportMenu > summary");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(selector)]);
  return dl;
}

// the page's module singletons, stashed once so every later poll is a synchronous read
export async function attach(page) {
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

// the setting that arms the mode, seeded before any module runs, beside the
// quiet view whose markers the clicks land on
export const armEditing = async (page) => {
  await seedView(page, { cats: DEFAULT_CATS });
  await page.addInitScript(() =>
    localStorage.setItem("owm:settings", JSON.stringify({ editObjects: true })),
  );
};

// centre the standing path's first object of a name by setting the camera itself, the way
// settle() does, so no scheduled hash write can re-apply under the click; returns
// where it is on the screen. A jump's own pushed write is flushed first and
// the re-apply of a hash it changed waited for: a hashchange still queued when
// the camera is set would re-fit the view from under the click that follows
export const aimAt = (page, name) =>
  page.evaluate(async (name) => {
    const st = window.__st;
    const render = await import(new URL("js/render.js", location.href).href);
    const stateModule = await import(new URL("js/state.js", location.href).href);
    window.__nav.flushHash();
    while (location.hash !== window.__applied)
      await new Promise((r) => window.addEventListener("hashchange", r, { once: true }));
    const t = st.path.tlvs.find((o) => o.name === name && o.fields);
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
      x2: t.x2,
      y2: t.y2,
      camera: t.fields.camera,
    };
  }, name);
export const aimAtDoor = (page) => aimAt(page, "Door");

// the camera of the standing path's first Door, as the page sees it now
export const doorCamera = (page, d) =>
  page.evaluate((d) => {
    const st = window.__st;
    const t = st.path.tlvs.find((o) => o.name === "Door" && o.x1 === d.x1 && o.y1 === d.y1);
    return { camera: t.fields.camera, edited: window.__edits.pathEdited(st.path) };
  }, d);

// where the selected door's centre is on the screen now, after a move
export const aimAtDoorNow = (page) =>
  page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const stateModule = await import(u("state.js"));
    const st = stateModule.state;
    const [cx, cy] = window.__model.markerCentre(st.sel, stateModule.LAYOUT);
    const r = document.getElementById("cv").getBoundingClientRect();
    return { x: r.left + (cx - st.cam.x) * st.cam.z, y: r.top + (cy - st.cam.y) * st.cam.z };
  });
