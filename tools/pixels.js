// npm run pixels [-- <ref>] [--dump <dir>]: what the painter draws over a matrix of views at the
// working tree and at a ref, HEAD unless one is named, with the clock stopped, hashed in the page:
// the map canvas, the minimap, an export paint of the same camera and every object's standing and
// hit boxes. The ref is served straight from the repository, so nothing is checked out or stored.
// A view may first prepare a transient (a hover, a selection, a carried object, a ghost, the ruler,
// a route) through the page's own modules. The run names every view whose hashes differ and fails
// on one; --dump writes each view's canvas for both trees.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fromRef, fromTree, refExists, refModules, serve, treeModules } from "./trees.js";

const args = process.argv.slice(2);
const dumpAt = args.indexOf("--dump");
const DUMP = dumpAt >= 0 ? args.splice(dumpAt, 2)[1] : null;
const REF = args[0] ?? "HEAD";

const MI = "#AE/MI/1/1412/712/1.00";
const R1 = "#AO/R1/15/9781/786/1.00";
const VIEWS = [
  { hash: R1, show: { objects: true, coll: true, conn: true } },
  { hash: MI, show: { objects: true, fg: true, wires: true, pens: true } },
  { hash: "#AO/R2/14/515/234/1.00", show: { objects: true, patrols: true, grid: true } },
  { hash: "#AE/NE/2/662/452/0.50", show: { objects: false, markers: true, labels: true } },
  { hash: `${R1}/jp`, show: { objects: true } },
  { hash: "#AO/R1/15/5554/728/0.15", show: { objects: true } },
  { hash: "#AO/R1/16/3537/696/0.18", show: { objects: true, fg: true } },
  { hash: "#AO/F2/2/4548/1183/0.15", show: { objects: true } },
  { hash: "#AO/R2/18/4993/250/0.15", show: { objects: true, dim: true, fg: true } },
  { hash: "#AO/R2/7/2504/707/0.27", show: { objects: true, patrols: true } },
  { hash: "#AO/R6/6/965/1202/0.31", show: { objects: true } },
  { hash: "#AE/BW/7/1521/791/0.41", show: { objects: true } },
  { hash: "#AE/MI/4/2251/1812/0.21", show: { objects: true, fg: true } },
  { hash: "#AE/BW/4/1475/1030/0.40", show: { objects: true, patrols: true } },
  { hash: "#AE/FD/2/1137/1141/0.37", show: { objects: true } },
  { hash: "#AE/BW/3/2038/503/0.36", show: { objects: true, dim: true, fg: true } },
  { hash: "#AE/BA/7/1312/514/0.67", show: { objects: true } },
  { hash: "#AE/MI/1/1412/712/0.10", show: { objects: true } },
  {
    hash: "#AE/NE/2/662/452/0.50",
    show: { objects: true, spaced: true, conn: true, labels: true },
  },
  { hash: MI, show: { objects: true, conn: true, wires: true }, prep: "highlight" },
  { hash: MI, show: { objects: true, conn: true, wires: true }, prep: "conn" },
  { hash: MI, show: { objects: true, conn: true, wires: true }, prep: "wire" },
  { hash: MI, show: { objects: true, pens: true }, prep: "patrol" },
  { hash: MI, show: { objects: true }, prep: "select" },
  { hash: MI, show: { objects: true }, prep: "carried" },
  { hash: MI, show: { objects: true }, prep: "ghost" },
  { hash: MI, show: { objects: true }, prep: "ruler" },
  { hash: R1, show: { objects: true }, prep: "route" },
  { hash: R1, show: { objects: false, markers: true }, prep: "select" },
];
const QUIET = {
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

// one view at one tree: a path standing, the canvas at rest for three frames, the artwork landed,
// the transient prepared, one paint with the clock stopped, and the hashes read in the page
async function capture(browser, port, modules, view) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.addInitScript(
    (show) => {
      localStorage.setItem("owm:view", JSON.stringify({ show }));
      localStorage.setItem("owm:settings", JSON.stringify({ animate: false }));
    },
    { ...QUIET, ...view.show },
  );
  await page.goto(`http://127.0.0.1:${port}/?embed=1${view.hash}`);
  const result = await page.evaluate(
    async ({ prep, dump, modules }) => {
      const u = (m) => {
        if (!modules[m]) throw new Error(`${m} is not under js/ in this tree`);
        return new URL("js/" + modules[m], location.href).href;
      };
      const st = await import(u("state.js"));
      const render = await import(u("render.js"));
      const spriteart = await import(u("spriteart.js"));
      const spritepaint = await import(u("spritepaint.js"));
      const edits = await import(u("edits.js"));
      const motion = await import(u("motion.js"));
      const model = await import(u("model.js"));
      const cv = document.getElementById("cv");
      const frame = () => new Promise(requestAnimationFrame);
      const deadline = Date.now() + 30000;
      while (!(st.state.path && cv.clientWidth > 0) && Date.now() < deadline) await frame();
      if (!st.state.path) throw new Error(`no path stood within the deadline at ${location.hash}`);
      let width = cv.clientWidth,
        still = 0;
      while (still < 3) {
        if (Date.now() > deadline)
          throw new Error(`the canvas never came to rest at ${location.hash}`);
        await frame();
        if (cv.clientWidth === width) still++;
        else {
          width = cv.clientWidth;
          still = 0;
        }
      }
      // the sprites' art is asked for a frame after the paint that wants it
      for (let i = 0; i < 40 && !spriteart.artworkReady(st.state.path); i++) {
        await spriteart.preloadPath(st.state.path);
        render.draw();
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!spriteart.artworkReady(st.state.path))
        throw new Error(`the art did not land at ${location.hash}`);
      const path = st.state.path;
      // the object a step works on stands inside the view, or the step would show nothing
      const cam = st.state.cam;
      const right = cam.x + cv.clientWidth / cam.z,
        bottom = cam.y + cv.clientHeight / cam.z;
      const inView = (t) =>
        st.dX(t.x1) >= cam.x &&
        st.dX(t.x2) <= right &&
        st.dY(t.y1) >= cam.y &&
        st.dY(t.y2) <= bottom;
      const first = (what, pred) => {
        const t = path.tlvs.find((t) => inView(t) && pred(t));
        if (!t) throw new Error(`no ${what} in view ${location.hash}`);
        return t;
      };
      // a door before a well before a hoist: the first two have their category on, so a ghost of one draws
      const door = () => {
        for (const name of ["Door", "WellExpress"]) {
          const t = path.tlvs.find((t) => inView(t) && t.name === name);
          if (t) return t;
        }
        return first("door, well or hoist", (t) => t.name === "Hoist");
      };
      const select = (t) => (st.state.sel = t);
      const steps = {
        highlight: () => render.setHighlight(door()),
        conn: () => render.setConnFocus(door()),
        wire: () => render.setWireFocus(first("switch", (t) => /Switch|Lever/.test(t.name))),
        patrol: () => {
          const pen = (t) => model.patrolZone(t, path, st.LAYOUT, st.state.data.id);
          render.setPatrol(pen(first("penned slig", (t) => t.name === "Slig" && pen(t))));
        },
        select: () => select(door()),
        carried: () => {
          const o = door();
          select(o);
          render.setCarried([o.x1 + 30, o.y1 + 10, o.x2 + 30, o.y2 + 10]);
        },
        ghost: async () => {
          const data = await import(u("data.js"));
          const side = await data.loadEditorData(st.state.data.id);
          if (!side) throw new Error("the editor sidecar did not load");
          edits.setLevelShort(st.state.data.id, side.level_short);
          st.state.edit = true;
          edits.removeObject(door());
        },
        ruler: () => {
          const o = door();
          st.state.ruler = {
            x1: st.dX(o.x1),
            y1: st.dY(o.y1),
            x2: st.dX(o.x2 + 200),
            y2: st.dY(o.y2 + 100),
          };
        },
        route: () => {
          const o = door();
          const pt = (dx, dy) => ({ x: st.dX(o.x1 + dx), y: st.dY(o.y1 + dy) });
          st.state.route = [
            { lv: st.state.lvl.short, pa: path.id, pts: [pt(0, 0), pt(300, 50), pt(600, -40)] },
          ];
        },
      };
      if (prep) {
        await steps[prep]();
        await frame();
      }
      await new Promise((r) => setTimeout(r, 300));
      if (motion.motionRunning()) throw new Error(`the clock runs at ${location.hash}`);
      render.draw();
      const sha = async (bytes) =>
        [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      const canvasHash = (c) => sha(c.getContext("2d").getImageData(0, 0, c.width, c.height).data);
      const off = document.createElement("canvas");
      off.width = 800;
      off.height = 600;
      render.paint(off.getContext("2d"), { ...st.state.cam }, 800, 600, 1, false);
      const boxes = path.tlvs.map((t) => [
        spritepaint.standingBox(t, st.LAYOUT),
        spritepaint.hitBoxes(t, st.LAYOUT),
      ]);
      return {
        canvas: await canvasHash(cv),
        minimap: await canvasHash(document.getElementById("minimap")),
        export: await canvasHash(off),
        boxes: await sha(new TextEncoder().encode(JSON.stringify(boxes))),
        png: dump ? cv.toDataURL("image/png") : null,
      };
    },
    { prep: view.prep ?? null, dump: !!DUMP, modules },
  );
  await ctx.close();
  return result;
}

const KEYS = ["canvas", "minimap", "export", "boxes"];
if (!(await refExists(REF))) {
  console.error(`no such ref: ${REF}`);
  process.exit(2);
}
const browser = await chromium.launch();
const tree = await serve(fromTree);
const ref = await serve(fromRef(REF));
const [treeMods, refMods] = await Promise.all([treeModules(), refModules(REF)]);
let differing = 0;
try {
  if (DUMP) await mkdir(DUMP, { recursive: true });
  for (const [i, view] of VIEWS.entries()) {
    const name = `${view.hash} ${view.prep ?? "plain"}`;
    const [a, b] = await Promise.all([
      capture(browser, tree.address().port, treeMods, view),
      capture(browser, ref.address().port, refMods, view),
    ]);
    if (DUMP)
      for (const [side, got] of [
        ["tree", a],
        ["ref", b],
      ])
        await writeFile(
          join(DUMP, `${String(i).padStart(2, "0")}-${view.prep ?? "plain"}.${side}.png`),
          Buffer.from(got.png.split(",")[1], "base64"),
        );
    const differs = KEYS.filter((k) => a[k] !== b[k]);
    if (differs.length) differing++;
    console.log(differs.length ? `DIFF ${name}: ${differs.join(", ")}` : `ok   ${name}`);
  }
  console.log(
    differing
      ? `${differing} of ${VIEWS.length} views differ between ${REF} and the working tree`
      : `${VIEWS.length} views draw alike at ${REF} and the working tree`,
  );
  process.exitCode = differing ? 1 : 0;
} catch (e) {
  console.error(e.message);
  process.exitCode = 2;
} finally {
  await browser.close();
  tree.close();
  ref.close();
}
