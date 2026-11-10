// npm run styles [-- <ref>] [--dump <dir>]: what the stylesheet shows over a set of interface
// states at the working tree and at a ref, HEAD unless one is named: the computed style of every
// element of the page and of every pseudo-element it draws, hashed in the page, with the clock
// stopped and motion reduced. The ref is served straight from the repository, so nothing is checked
// out or stored. A state may first open a panel, a dialog or a mode through the page's own
// controls. The run names every state in which an element shows differently, with the properties,
// and fails on one; --dump writes each state's element list for both trees.
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
const WIDE = { width: 1280, height: 720 };
const PHONE = { width: 600, height: 900 };
const click = (id) => (p) => p.click(id);
const key = (k) => (p) => p.keyboard.press(k);
const typeCard = (p) =>
  p.evaluate(() =>
    window.dispatchEvent(new CustomEvent("typecard-open", { detail: { type: "Door" } })),
  );
const pickTypes = async (p) => {
  await p.click("#numbersBtn");
  for (const i of [0, 1]) await p.locator("#numbersTypes input").nth(i).check();
};
// a state is a view with the objects shown, what the page is then asked to open and what shows
// once it stands
const STATES = [
  { name: "the map", hash: MI, size: WIDE },
  { name: "the world graph", hash: MI, size: WIDE, act: click("#graphBtn"), stands: "body.graph" },
  { name: "the screen list", hash: MI, size: WIDE, act: key("l"), stands: "#camPanel" },
  { name: "the numbers panel", hash: MI, size: WIDE, act: pickTypes, stands: ".np-name" },
  { name: "the place panel", hash: MI, size: WIDE, act: click("#placeBtn"), stands: "#placePanel" },
  {
    name: "search hits",
    hash: MI,
    size: WIDE,
    act: (p) => p.fill("#searchInput", "door"),
    stands: "#searchResults .hit",
  },
  {
    name: "the settings dialog",
    hash: MI,
    size: WIDE,
    act: click("#settingsBtn"),
    stands: "#settingsOverlay.open",
  },
  {
    name: "What's New",
    hash: MI,
    size: WIDE,
    act: click("#whatsnewBtn"),
    stands: "#whatsnewOverlay.open",
  },
  { name: "the shortcuts", hash: MI, size: WIDE, act: key("?"), stands: "#shortcutsOverlay.open" },
  { name: "About", hash: MI, size: WIDE, act: click("#aboutBtn"), stands: "#aboutOverlay.open" },
  { name: "the type card", hash: MI, size: WIDE, act: typeCard, stands: "#typeCardOverlay.open" },
  {
    name: "a tooltip",
    hash: MI,
    size: WIDE,
    act: (p, at) => p.mouse.move(at.x, at.y),
    stands: "#tip",
  },
  {
    name: "the edit panel",
    hash: MI,
    size: WIDE,
    edit: true,
    act: (p, at) => p.mouse.click(at.x, at.y),
    stands: "#editPanel",
  },
  {
    name: "the type picker",
    hash: MI,
    size: WIDE,
    edit: true,
    act: async (p, at) => {
      await p.mouse.click(at.x, at.y);
      await p.keyboard.press("n");
    },
    stands: "#editBody .ep-types",
  },
  { name: "the route planner", hash: MI, size: WIDE, act: key("r"), stands: "#routeBar" },
  {
    name: "a wide screen's route planner",
    hash: MI,
    size: { width: 1600, height: 900 },
    act: key("r"),
    stands: "#routeBar",
  },
  {
    name: "a release",
    hash: `${R1}/jp`,
    size: WIDE,
    show: { release: true },
    stands: "#placeRelease",
  },
  { name: "an embed", hash: MI, size: WIDE, embed: true, stands: "body.embed" },
  { name: "a phone", hash: MI, size: PHONE },
  {
    name: "a phone's drawer",
    hash: MI,
    size: PHONE,
    act: click("#menuBtn"),
    stands: "body.menu-open",
  },
];
const frames = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// one state at one tree: the page settled with the objects shown, the first door in view found
// for a pointer to aim at, the mode armed, the state opened and standing, and every element's
// style hashed
async function capture(browser, port, modules, state) {
  const ctx = await browser.newContext({
    viewport: state.size,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.addInitScript(
    ({ show, edit }) => {
      localStorage.setItem("owm:view", JSON.stringify({ show }));
      localStorage.setItem("owm:settings", JSON.stringify({ animate: false, editObjects: edit }));
    },
    { show: { objects: true, ...state.show }, edit: !!state.edit },
  );
  await page.goto(`http://127.0.0.1:${port}/${state.embed ? "?embed=1" : ""}${state.hash}`);
  const door = await page.evaluate(async (modules) => {
    const u = (m) => {
      if (!modules[m]) throw new Error(`${m} is not under js/ in this tree`);
      return new URL("js/" + modules[m], location.href).href;
    };
    const st = await import(u("state.js"));
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
    // the other game lands behind the first paint and grows the sidebar's rows
    while (st.state.games.length < 2 && Date.now() < deadline) await frame();
    if (st.state.games.length < 2)
      throw new Error(`the other game never landed at ${location.hash}`);
    // the first door, well or hoist in view, for a pointer to hover or select
    const cam = st.state.cam;
    const right = cam.x + cv.clientWidth / cam.z,
      bottom = cam.y + cv.clientHeight / cam.z;
    const inView = (t) =>
      st.dX(t.x1) >= cam.x && st.dX(t.x2) <= right && st.dY(t.y1) >= cam.y && st.dY(t.y2) <= bottom;
    const t = ["Door", "WellExpress", "Hoist"]
      .map((name) => st.state.path.tlvs.find((t) => inView(t) && t.name === name))
      .find(Boolean);
    if (!t) return null;
    const [cx, cy] = model.markerCentre(t, st.LAYOUT);
    const r = cv.getBoundingClientRect();
    return { x: r.left + (cx - cam.x) * cam.z, y: r.top + (cy - cam.y) * cam.z };
  }, modules);
  if (state.edit) {
    await page.keyboard.press("e");
    await page.waitForSelector("body.editing");
  }
  if (state.act) {
    if (state.act.length > 1 && !door) throw new Error(`no door in view at ${state.hash}`);
    await state.act(page, door);
  }
  if (state.stands) await page.waitForSelector(state.stands, { state: "visible", timeout: 10000 });
  await page.waitForTimeout(400);
  // every element and the pseudo-elements it draws, hashed as the state stands, with motion allowed and
  // every animation held, and with the hover, focus and active rules forced; the texts stay for a
  // difference's detail
  await page.evaluate(() => {
    const pathOf = (el) => {
      const parts = [];
      for (let e = el; e; e = e.parentElement) {
        const i = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0;
        parts.unshift(`${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}[${i}]`);
      }
      return parts.join(">");
    };
    // the custom properties come in the order their sheets landed, so the list is sorted
    const text = (cs) =>
      Array.from(cs)
        .sort()
        .map((p) => `${p}=${cs.getPropertyValue(p)}`)
        .join("\0");
    const sha = async (s) =>
      [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    window.__styleText = new Map();
    window.__snap = async (suffix) => {
      const out = {};
      // the toasts come and go on their own clock, so they are no part of a state
      for (const el of document.querySelectorAll("html, body, body *")) {
        if (el.closest("#toastStack")) continue;
        const key = pathOf(el);
        const reads = [[key, null]];
        for (const pseudo of ["::before", "::after"])
          if (getComputedStyle(el, pseudo).content !== "none") reads.push([key + pseudo, pseudo]);
        for (const [k, pseudo] of reads) {
          const s = text(getComputedStyle(el, pseudo));
          window.__styleText.set(k + suffix, s);
          out[k + suffix] = await sha(s);
        }
      }
      return out;
    };
  });
  const plain = await page.evaluate(() => window.__snap(""));
  // the rules reduced motion switches off, read with every animation held at its first frame
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await frames(page);
  const motion = await page.evaluate(() => window.__snap(" motion"));
  // a forced hover would start the transitions the two reads above already compare
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const ids = [];
  const walk = (n) => {
    if (n.nodeType === 1) ids.push(n.nodeId);
    (n.children ?? []).forEach(walk);
  };
  walk(root);
  for (const nodeId of ids)
    await cdp.send("CSS.forcePseudoState", {
      nodeId,
      forcedPseudoClasses: ["hover", "focus", "focus-visible", "active"],
    });
  await frames(page);
  const forced = await page.evaluate(() => window.__snap(" forced"));
  const styles = { ...plain, ...motion, ...forced };
  const detail = (keys) =>
    page.evaluate(
      (keys) =>
        Object.fromEntries(
          keys
            .filter((k) => window.__styleText.has(k))
            .map((k) => [
              k,
              Object.fromEntries(
                window.__styleText
                  .get(k)
                  .split("\0")
                  .map((d) => [d.slice(0, d.indexOf("=")), d.slice(d.indexOf("=") + 1)]),
              ),
            ]),
        ),
      keys,
    );
  return { styles, detail, close: () => ctx.close() };
}

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
  for (const [i, state] of STATES.entries()) {
    const [a, b] = await Promise.all([
      capture(browser, tree.address().port, treeMods, state),
      capture(browser, ref.address().port, refMods, state),
    ]);
    if (DUMP)
      for (const [side, got] of [
        ["tree", a],
        ["ref", b],
      ])
        await writeFile(
          join(
            DUMP,
            `${String(i).padStart(2, "0")}-${state.name.replace(/\W+/g, "-")}.${side}.json`,
          ),
          JSON.stringify(got.styles, null, 1),
        );
    const keys = [...new Set([...Object.keys(a.styles), ...Object.keys(b.styles)])];
    const differs = keys.filter((k) => a.styles[k] !== b.styles[k]);
    if (differs.length) {
      differing++;
      console.log(`DIFF ${state.name}: ${differs.length} of ${keys.length} elements`);
      const [da, db] = await Promise.all([
        a.detail(differs.slice(0, 6)),
        b.detail(differs.slice(0, 6)),
      ]);
      for (const k of differs.slice(0, 6)) {
        const x = db[k],
          y = da[k];
        if (!x || !y) {
          console.log(`  ${k}: only at ${x ? REF : "the working tree"}`);
          continue;
        }
        const props = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(
          (p) => x[p] !== y[p],
        );
        console.log(`  ${k}`);
        for (const p of props.slice(0, 4)) console.log(`      ${p}: ${x[p]} -> ${y[p]}`);
      }
    } else console.log(`ok   ${state.name}: ${keys.length} elements`);
    await Promise.all([a.close(), b.close()]);
  }
  console.log(
    differing
      ? `${differing} of ${STATES.length} states differ between ${REF} and the working tree`
      : `${STATES.length} states show alike at ${REF} and the working tree`,
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
