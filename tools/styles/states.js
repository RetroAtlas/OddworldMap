// This map's half of the style proof: its interface states, and how the page is opened for one.

/** Where the pointer rests while a state is read: the sidebar's top corner, off every button. */
export const REST = { x: 1, y: 1 };

const WIDE = { viewport: { width: 1280, height: 720 } };
const BIG = { viewport: { width: 1600, height: 900 } };
const PHONE = { viewport: { width: 600, height: 900 } };
const MI = "#AE/MI/1/1412/712/1.00";
const R1 = "#AO/R1/15/9781/786/1.00";
const DOORS = "#AE/MI/1/3662/872/1.00";
// an edit on every door of the path DOORS opens on, so the marks show wherever a door does
const EDITS = {
  AE: {
    "MI/1": {
      objects: Object.fromEntries(
        [
          [3650, 860],
          [3650, 960],
          [3925, 960],
          [3925, 860],
          [5025, 960],
          [5025, 860],
          [850, 1740],
        ].map(([x, y]) => [`Door@${x},${y}`, { fields: { door_number: 9 } }]),
      ),
    },
  },
};

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
// the panels and the hits that carry a path's edit or release marks, then the tip over an object
const marks = async (p) => {
  await p.keyboard.press("l");
  await p.click("#placeBtn");
  await p.fill("#searchInput", "door");
  await p.waitForSelector("#searchResults .hit");
  await hover(p);
};
// a hover that has to scroll its anchor into view hides the tip it shows, since the scroll's own event
// lands after the pointer's: the anchor is brought into view and settled first
const anchoredTip = async (p) => {
  const label = p.locator("label:has(#tLabels)");
  await label.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await settled(p);
  await label.hover();
};
// one more toast than stand at once, so the badge that counts the waiting shows
const toasts = (p) =>
  p.evaluate(async (path) => {
    const { toast } = await import(new URL("js/" + path, location.href).href);
    for (const msg of ["One", "Two", "Three", "Four"]) toast(msg);
  }, p.modules["toast.js"]);

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
    name: "an anchored tip",
    screen: WIDE,
    hash: MI,
    steps: anchoredTip,
    stands: "#anchorTip .detail",
    held: true,
  },
  {
    name: "an edited path",
    screen: WIDE,
    hash: DOORS,
    edits: EDITS,
    steps: marks,
    stands: "#tip .edited",
    held: true,
  },
  {
    name: "the fields picker",
    screen: WIDE,
    hash: MI,
    settings: { fieldPrefs: { mode: "more", byType: {} } },
    steps: click("#fieldPanel .fp-type > summary"),
    stands: "#fieldPanel .fp-fields .checkrow",
  },
  {
    name: "standing toasts",
    screen: WIDE,
    hash: MI,
    steps: toasts,
    stands: "#toastStack .toast-more",
  },
  {
    name: "the offline rows",
    screen: WIDE,
    hash: MI,
    settings: { cacheMap: true },
    worker: false,
    steps: click("#settingsBtn"),
    stands: "#oflRows .ofl-row",
  },
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
    steps: marks,
    stands: "#placeRelease",
    held: true,
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
  { name: "a phone's screen list", screen: PHONE, hash: MI, steps: key("l"), stands: "#camPanel" },
  {
    name: "a phone's place panel",
    screen: PHONE,
    hash: MI,
    steps: click("#placeBtn"),
    stands: "#placePanel",
  },
];

/** Open a state's page at a tree: seeded, settled with both games in, aimed at a door, the mode armed. */
export async function open(page, { base, modules }, state) {
  page.modules = modules;
  // the offline rows read the store the worker fills for a while after boot, so the state that
  // shows them opens its page with no service worker, and both trees read an empty store
  if (state.worker === false)
    await page.addInitScript(() => {
      delete Navigator.prototype.serviceWorker;
    });
  await page.addInitScript(
    ({ show, settings, edits }) => {
      localStorage.setItem("owm:view", JSON.stringify({ show }));
      localStorage.setItem("owm:settings", JSON.stringify(settings));
      if (edits) localStorage.setItem("owm:edits", JSON.stringify(edits));
    },
    {
      show: { objects: true, ...state.show },
      settings: { animate: false, editObjects: !!state.edit || !!state.edits, ...state.settings },
      edits: state.edits,
    },
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
