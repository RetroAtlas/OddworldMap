// This map's half of the style proof: its interface states, and how the page is opened for one.

/** Where the pointer rests while a state is read: the sidebar's top corner, off every button. */
export const REST = { x: 1, y: 1 };

const WIDE = { viewport: { width: 1280, height: 720 } };
const BIG = { viewport: { width: 1600, height: 900 } };
const PHONE = { viewport: { width: 600, height: 900 } };
const MI = "#AE/MI/1/1412/712/1.00";
const R1 = "#AO/R1/15/9781/786/1.00";

const click = (id) => (p) => p.click(id);
const key = (k) => (p) => p.keyboard.press(k);
const typeCard = (p) =>
  p.evaluate(() =>
    window.dispatchEvent(new CustomEvent("typecard-open", { detail: { type: "Door" } })),
  );
// the feed's first entries are no flagship, so the flagship tag's foil and the entry's sheen show
// only with the other kinds switched off
const flagships = async (p) => {
  await p.click("#whatsnewBtn");
  await p.waitForSelector("#whatsnewOverlay.open");
  for (const tag of ["new", "improved", "fixed"])
    await p.click(`#whatsnewFilter .wn-chip[data-tag="${tag}"]`);
};
const pickTypes = async (p) => {
  await p.click("#numbersBtn");
  for (const i of [0, 1]) await p.locator("#numbersTypes input").nth(i).check();
};
const at = (p) => {
  if (!p.at) throw new Error("no door, well or hoist in view to aim at");
  return p.at;
};
const hover = (p) => p.mouse.move(at(p).x, at(p).y);
const select = (p) => p.mouse.click(at(p).x, at(p).y);

// a view with the objects shown, the steps that open what the state shows, and what then stands
export const states = [
  { name: "the map", screen: WIDE, hash: MI, stands: "#cv" },
  {
    name: "the world graph",
    screen: WIDE,
    hash: MI,
    steps: click("#graphBtn"),
    stands: "body.graph",
  },
  { name: "the screen list", screen: WIDE, hash: MI, steps: key("l"), stands: "#camPanel" },
  { name: "the numbers panel", screen: WIDE, hash: MI, steps: pickTypes, stands: ".np-name" },
  {
    name: "the place panel",
    screen: WIDE,
    hash: MI,
    steps: click("#placeBtn"),
    stands: "#placePanel",
  },
  {
    name: "search hits",
    screen: WIDE,
    hash: MI,
    steps: (p) => p.fill("#searchInput", "door"),
    stands: "#searchResults .hit",
  },
  {
    name: "the settings dialog",
    screen: WIDE,
    hash: MI,
    steps: click("#settingsBtn"),
    stands: "#settingsOverlay.open",
  },
  {
    name: "What's New",
    screen: WIDE,
    hash: MI,
    steps: click("#whatsnewBtn"),
    stands: "#whatsnewOverlay.open",
  },
  {
    name: "What's New's flagships",
    screen: WIDE,
    hash: MI,
    steps: flagships,
    stands: ".wn-entry.wn-flagship",
  },
  {
    name: "the shortcuts",
    screen: WIDE,
    hash: MI,
    steps: key("?"),
    stands: "#shortcutsOverlay.open",
  },
  {
    name: "About",
    screen: WIDE,
    hash: MI,
    steps: click("#aboutBtn"),
    stands: "#aboutOverlay.open",
  },
  {
    name: "the type card",
    screen: WIDE,
    hash: MI,
    steps: typeCard,
    stands: "#typeCardOverlay.open",
  },
  { name: "a tooltip", screen: WIDE, hash: MI, steps: hover, stands: "#tip", held: true },
  {
    name: "the edit panel",
    screen: WIDE,
    hash: MI,
    edit: true,
    steps: select,
    stands: "#editPanel",
  },
  {
    name: "the type picker",
    screen: WIDE,
    hash: MI,
    edit: true,
    steps: async (p) => {
      await select(p);
      await p.keyboard.press("n");
    },
    stands: "#editBody .ep-types",
  },
  { name: "the route planner", screen: WIDE, hash: MI, steps: key("r"), stands: "#routeBar" },
  {
    name: "a wide screen's route planner",
    screen: BIG,
    hash: MI,
    steps: key("r"),
    stands: "#routeBar",
  },
  {
    name: "a release",
    screen: WIDE,
    hash: `${R1}/jp`,
    show: { release: true },
    stands: "#placeRelease",
  },
  { name: "an embed", screen: WIDE, hash: MI, embed: true, stands: "body.embed" },
  { name: "a phone", screen: PHONE, hash: MI, stands: "#cv" },
  {
    name: "a phone's drawer",
    screen: PHONE,
    hash: MI,
    steps: click("#menuBtn"),
    stands: "body.menu-open",
  },
];

/** Open a state's page at a tree: seeded, settled with both games in, aimed at a door, the mode armed. */
export async function open(page, { base, modules }, state) {
  await page.addInitScript(
    ({ show, edit }) => {
      localStorage.setItem("owm:view", JSON.stringify({ show }));
      localStorage.setItem("owm:settings", JSON.stringify({ animate: false, editObjects: edit }));
    },
    { show: { objects: true, ...state.show }, edit: !!state.edit },
  );
  await page.goto(`${base}/${state.embed ? "?embed=1" : ""}${state.hash}`);
  page.at = await page.evaluate(async (modules) => {
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
}

/** The page's layout at rest after a step: two frames. */
export const settled = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
