import { test, expect } from "@playwright/test";
import { trackErrors, seedView, settle, probeAnchor } from "./helpers.js";

// The alignment and scale anchors from docs/viewer-geometry.md, as pinned numbers. Every value
// here is a literal, verified once by eye against the artwork at the named
// permalink and then frozen — never regenerate them from model.js, which is what
// they test. `rel` is where the marker draws inside its screen's 368x240 window,
// measured from the screen's draw origin; `camAt` is the settled view offset at
// 1280x720.
const ANCHORS = [
  {
    title: "AO R2 P1 C03 — the LCDStatusBoard box sits on the LED digit panel",
    hash: "#AO/R2/1/554/287/1.00",
    game: "AO",
    level: "R2",
    path: 1,
    camAt: [-342, -193],
    cam: { png: "cams/ao/R2/R2P01C03.png", origin: [0, 0] },
    cats: { board: true },
    show: {},
    boxes: [{ name: "LCDStatusBoard", world: [542, 275, 566, 299], rel: [286, 155, 24, 24] }],
    lines: [],
  },
  {
    title: "AE MI P1 C24 — the HandStone box sits on the QuikSave stone",
    hash: "#AE/MI/1/3862/1212/1.00",
    game: "AE",
    level: "MI",
    path: 1,
    camAt: [3152, 772],
    cam: { png: "cams/ae/MI/MIP01C24.png", origin: [3680, 960] },
    cats: { switch: true },
    show: {},
    boxes: [{ name: "HandStone", world: [3850, 1200, 3874, 1224], rel: [100, 160, 24, 24] }],
    lines: [],
  },
  {
    title: "AE SV P7 C09 — the floor line lies along the walkway deck, 200 down",
    hash: "#AE/SV/7/934/1160/1.00",
    game: "AE",
    level: "SV",
    path: 7,
    camAt: [280, 720],
    cam: { png: "cams/ae/SV/SVP07C09.png", origin: [736, 960] },
    cats: {},
    show: { coll: true },
    boxes: [],
    lines: [{ world: [750, 1240, 1100, 1240], rel: [0, 200, 350, 200] }],
  },
  {
    title: "AE MI P1 C04 — the wide LCD covers the black panel, the board the square under it",
    hash: "#AE/MI/1/934/1420/1.00",
    game: "AE",
    level: "MI",
    path: 1,
    camAt: [280, 960],
    cam: { png: "cams/ae/MI/MIP01C04.png", origin: [736, 1200] },
    cats: { screen: true, board: true },
    show: {},
    boxes: [
      { name: "LCD", world: [888, 1404, 1083, 1424], rel: [138, 104, 195, 20] },
      { name: "LCDStatusBoard", world: [991, 1445, 1015, 1469], rel: [241, 145, 24, 24] },
    ],
    lines: [],
  },
];

for (const a of ANCHORS) {
  test(a.title, async ({ page }) => {
    const errors = trackErrors(page);
    await seedView(page, { show: a.show, cats: a.cats });
    await page.goto(`/?embed=1${a.hash}`);
    await settle(page, a);
    const r = await probeAnchor(page, a);

    expect(r.cam).toEqual({ x: a.camAt[0], y: a.camAt[1], z: 1 });
    for (const [i, b] of a.boxes.entries())
      expect(r.boxes[i], b.name).toEqual({ name: b.name, found: true, rel: b.rel });
    for (const [i, l] of a.lines.entries())
      expect(r.lines[i]).toEqual({ found: true, pieces: 1, on: true, rel: l.rel });

    expect(r.artwork.sampled, "artwork sample points").toBeGreaterThanOrEqual(12);
    expect(r.artwork.mismatches, "artwork under the markers").toEqual([]);
    for (const m of r.markers)
      expect(m.differing, `${m.name} drawn on its pinned outline`).toBeGreaterThanOrEqual(9);

    expect(errors).toEqual([]);
  });
}
