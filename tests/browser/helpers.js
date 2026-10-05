// Shared plumbing for the browser suite. Geometry and pixel reads run inside one
// page.evaluate against the page's own live module singletons and come back as
// plain data, so every assertion happens in Node where a failure prints both sides.

import { CATS } from "../../public/js/config.js";

// every key explicit, so a future default flip cannot move a test
export const QUIET_SHOW = {
  spaced: false,
  grid: false,
  coll: false,
  fg: false,
  conn: false,
  wires: false,
  pens: false,
  labels: false,
  dim: false,
  objects: false,
  patrols: false,
  markers: true,
};
export const NO_CATS = {
  board: false,
  mud: false,
  door: false,
  cont: false,
  switch: false,
  hazard: false,
  enemy: false,
  pickup: false,
  screen: false,
  nav: false,
  scenery: false,
  meta: false,
};

// the categories as config.js ships them
export const DEFAULT_CATS = Object.fromEntries(CATS.map((c) => [c.key, c.on]));

export function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return errors;
}

// seed the display/filter snapshot before any module runs, the way a remembered
// visit would; rememberView defaults on, so the sidebar applies it at boot
export async function seedView(page, { show = {}, cats = {} } = {}) {
  await page.addInitScript((view) => localStorage.setItem("owm:view", JSON.stringify(view)), {
    show: { ...QUIET_SHOW, ...show },
    cats: { ...NO_CATS, ...cats },
  });
}

// imports resolve through location.href so they hit the same module instances
// the page booted
export async function settle(page, { game, level, path }) {
  await page.evaluate(
    async (sel) => {
      const u = (m) => new URL("js/" + m, location.href).href;
      const st = await import(u("state.js"));
      const render = await import(u("render.js"));
      const cv = document.getElementById("cv");
      const deadline = Date.now() + 30000;
      const there = () =>
        st.state.data?.id === sel.game &&
        st.state.lvl?.short === sel.level &&
        st.state.path?.id === sel.path &&
        cv.clientWidth > 0;
      while (!there()) {
        if (Date.now() > deadline) throw new Error(`settle timeout at ${location.hash}`);
        await new Promise(requestAnimationFrame);
      }
      await render.preloadPath(st.state.path);
      if (!render.artworkReady(st.state.path)) throw new Error("artwork did not load");
      render.draw();
    },
    { game, level, path },
  );
}

// the same settle for wherever boot lands, when the test pins no place
export async function settleAny(page) {
  await page.evaluate(async () => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("state.js"));
    const render = await import(u("render.js"));
    const cv = document.getElementById("cv");
    const deadline = Date.now() + 30000;
    while (!(st.state.path && cv.clientWidth > 0)) {
      if (Date.now() > deadline) throw new Error("settle timeout");
      await new Promise(requestAnimationFrame);
    }
    await render.preloadPath(st.state.path);
    if (!render.artworkReady(st.state.path)) throw new Error("artwork did not load");
    render.draw();
  });
}

export async function probeAnchor(page, anchor) {
  return await page.evaluate(async (a) => {
    const u = (m) => new URL("js/" + m, location.href).href;
    const st = await import(u("state.js"));
    const model = await import(u("model.js"));
    const render = await import(u("render.js"));
    const config = await import(u("config.js"));
    const { state } = st;
    const z = state.cam.z;
    const [ox, oy] = a.cam.origin;

    // pinned geometry, matched by name + world rect (names repeat within a path)
    const boxes = a.boxes.map((b) => {
      const t = state.path.tlvs.find(
        (t) =>
          t.name === b.name &&
          t.x1 === b.world[0] &&
          t.y1 === b.world[1] &&
          t.x2 === b.world[2] &&
          t.y2 === b.world[3],
      );
      if (!t) return { name: b.name, found: false, rel: null };
      const d = model.drawBox(t, st.LAYOUT);
      return { name: b.name, found: true, rel: [d.x - ox, d.y - oy, d.w, d.h] };
    });
    const lines = a.lines.map((l) => {
      const raw = state.path.lines.find(
        (r) =>
          r[0] === l.world[0] && r[1] === l.world[1] && r[2] === l.world[2] && r[3] === l.world[3],
      );
      if (!raw) return { found: false, pieces: 0, on: false, rel: null };
      const runs = model.lineRuns(raw[0], raw[1], raw[2], raw[3], st.LAYOUT);
      const r = runs[0];
      return {
        found: true,
        pieces: runs.length,
        on: r.on,
        rel: [r.x1 - ox, r.y1 - oy, r.x2 - ox, r.y2 - oy],
      };
    });

    // a probe canvas holding what the anchor screen should look like bare: the
    // committed PNG named by the pin (not by state — a swapped cam must fail here)
    const img = new Image();
    img.src = new URL(a.cam.png, location.href).href;
    await img.decode();
    const pc = document.createElement("canvas");
    pc.width = 368;
    pc.height = 240;
    const pctx = pc.getContext("2d");
    pctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--map-bg");
    pctx.fillRect(0, 0, 368, 240);
    pctx.imageSmoothingEnabled = false;
    pctx.drawImage(img, 0, 0, 368, 240, 0, 0, 368, 240);
    const bare = pctx.getImageData(0, 0, 368, 240).data;

    // repaint and read the live canvas in the same task, so nothing interleaves
    render.draw();
    const cv = document.getElementById("cv");
    const sx = (ox - state.cam.x) * z;
    const sy = (oy - state.cam.y) * z;
    const live = cv.getContext("2d").getImageData(sx, sy, 368, 240).data;
    const px = (data, x, y) => {
      const i = (y * 368 + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };

    // artwork identity: fixed-grid points no drawn marker or line piece reaches
    const obstacles = state.path.tlvs
      .filter((t) => config.markerShown(t))
      .map((t) => {
        const d = model.drawBox(t, st.LAYOUT);
        return [d.x - ox - 32, d.y - oy - 32, d.x + d.w - ox + 32, d.y + d.h - oy + 32];
      });
    if (state.show.coll)
      for (const [x1, y1, x2, y2] of state.path.lines)
        for (const r of model.lineRuns(x1, y1, x2, y2, st.LAYOUT))
          obstacles.push([
            Math.min(r.x1, r.x2) - ox - 6,
            Math.min(r.y1, r.y2) - oy - 6,
            Math.max(r.x1, r.x2) - ox + 6,
            Math.max(r.y1, r.y2) - oy + 6,
          ]);
    const clear = (x, y) =>
      obstacles.every(([a1, b1, a2, b2]) => x < a1 || x > a2 || y < b1 || y > b2);
    const mismatches = [];
    let sampled = 0;
    for (let y = 8; y <= 232; y += 16)
      for (let x = 8; x <= 360; x += 16) {
        if (!clear(x, y)) continue;
        sampled++;
        const c = px(live, x, y);
        const p = px(bare, x, y);
        if (c.some((v, i) => Math.abs(v - p[i]) > 2) && mismatches.length < 5)
          mismatches.push({ x, y, live: c, bare: p });
      }

    // marker presence: the pinned perimeter must differ from the bare artwork
    const differsAt = (x, y) => {
      const c = px(live, Math.round(x), Math.round(y));
      const p = px(bare, Math.round(x), Math.round(y));
      return c.some((v, i) => Math.abs(v - p[i]) > 10);
    };
    const markers = [];
    for (const b of a.boxes) {
      const [x, y, w, h] = b.rel;
      const pts = [0, 0.25, 0.5, 0.75, 1].flatMap((f) => [
        [x + f * w, y],
        [x + f * w, y + h],
      ]);
      pts.push([x, y + h / 2], [x + w, y + h / 2]);
      markers.push({
        name: b.name,
        total: pts.length,
        differing: pts.filter((p) => differsAt(...p)).length,
      });
    }
    for (const l of a.lines) {
      const [x1, y1, x2] = l.rel;
      const pts = Array.from({ length: 12 }, (_, i) => [x1 + 8 + ((x2 - x1 - 16) / 11) * i, y1]);
      markers.push({
        name: "line",
        total: 12,
        differing: pts.filter((p) => differsAt(...p)).length,
      });
    }

    return { cam: { ...state.cam }, boxes, lines, artwork: { sampled, mismatches }, markers };
  }, anchor);
}
