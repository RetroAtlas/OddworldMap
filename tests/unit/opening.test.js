import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { minimapScale, opensWhole, pathFit, screenView } from "../../public/js/model/opening.js";
import { ENTRY_CLEAR, FIT_ZOOM_MIN, FIT_ZOOM_NARROW, ZOOM_MIN } from "../../public/js/config.js";
import { SYNTH_GEOMETRY, path, pitches } from "./fixtures.js";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));

// a cell's corner relative to its screen's, as state.js's cellOrigin has it
const originOf = (layout) =>
  layout.cellW === layout.worldW ? [-layout.winX, -layout.winY] : [0, 0];
const [PACKED, SPACED] = pitches(SYNTH_GEOMETRY); // 200x100 screens, 300x150 and 400x200 apart
const { top: TOP, side: SIDE, bottom: BOTTOM } = ENTRY_CLEAR;
// a w x h grid with a screen in every cell, or in the cells named
const grid = (w, h, cells = [...Array(w * h).keys()]) =>
  path(
    1,
    [],
    cells.map((cell) => ({ cell, name: `C${cell}` })),
    w,
    h,
  );

test("the fit holds the whole grid in the middle of the canvas, a margin about it", () => {
  const P = grid(3, 2); // 900x300 packed
  assert.deepEqual(pathFit(P, 1100, 500, PACKED, [0, 0]), { x: -100, y: -100, z: 1 });
  // the tighter axis decides the zoom, and the other keeps the grid centred
  assert.deepEqual(pathFit(P, 550, 500, PACKED, [0, 0]), { x: -100, y: -350, z: 0.5 });
  // spaced apart the grid is the cells', which start ahead of their screens
  const fit = pathFit(P, 1400, 900, SPACED, originOf(SPACED)); // 1200x400 cells from -40/-20
  assert.equal(fit.z, 1);
  assert.equal(fit.x + 700, -40 + 600);
  assert.equal(fit.y + 450, -20 + 200);
});

test("the fit stops at the manual zoom's floor", () => {
  assert.equal(pathFit(grid(40, 40), 100, 100, PACKED, [0, 0]).z, ZOOM_MIN);
});

test("a path opens whole where its fit reaches the floor, which a narrow canvas sets higher", () => {
  // a canvas two screens wide or more: a w-wide strip fits at 900 / (300w + 200)
  const wide = (w) => opensWhole(grid(w, 1), 900, 2000, PACKED);
  assert.equal(900 / (300 * 16 + 200) >= FIT_ZOOM_MIN, true);
  assert.equal(wide(16), true);
  assert.equal(900 / (300 * 17 + 200) >= FIT_ZOOM_MIN, false);
  assert.equal(wide(17), false);
  // under two screens wide the floor is the narrow one: 399 / (300w + 200)
  const narrow = (w) => opensWhole(grid(w, 1), 399, 2000, PACKED);
  assert.equal(399 / (300 * 1 + 200) >= FIT_ZOOM_NARROW, true);
  assert.equal(narrow(1), true);
  assert.equal(narrow(2), false);
  // and two screens wide exactly is no longer narrow: three in a row fit at 0.36 there
  assert.equal(opensWhole(grid(3, 1), 400, 2000, PACKED), true);
  assert.equal(opensWhole(grid(3, 1), 399, 2000, PACKED), false);
});

test("under the floor a path still opens whole where one screen would come out no larger", () => {
  // four screens fit a 230x200 canvas at 0.2875, and one beside their minimap at 0.12
  const P = grid(2, 2);
  assert.equal(pathFit(P, 230, 200, PACKED, [0, 0]).z, 0.2875);
  assert.equal(screenView(P, 0, 230, 200, PACKED).z, 0.12);
  assert.equal(opensWhole(P, 230, 200, PACKED), true);
  // 60 px wider the one screen comes out at 0.42, and the path opens on it
  assert.equal(opensWhole(P, 290, 200, PACKED), false);
});

test("one screen is shown whole inside the canvas clear of the furniture, at its art's size at most", () => {
  const z = (cw, ch) => screenView(grid(1, 1), 0, cw, ch, PACKED).z; // a 200x100 screen
  assert.equal(z(200 + 2 * SIDE, 800), 1);
  assert.equal(z(100 + 2 * SIDE, 800), 0.5); // the width decides
  assert.equal(z(800, 25 + TOP + BOTTOM), 0.25); // the height decides
  assert.equal(z(2000, 1200), 1); // room to spare still stops at the art's own size
  assert.equal(z(2 * SIDE, 800), ZOOM_MIN); // and no room at all at the manual floor
});

test("the minimap's scale is the tighter of its box's two sides", () => {
  assert.equal(minimapScale(grid(5, 1), PACKED), 180 / 1500); // the width decides
  assert.equal(minimapScale(grid(1, 5), PACKED), 120 / 750); // the height decides
  assert.equal(minimapScale(grid(1, 5), SPACED), 120 / 1000); // by the pitch in force
});

// the minimap of a 5x5 grid of these screens is 180x90 px, of a 5x3 one 180x54
const ABOVE = (mapH) => ENTRY_CLEAR.mapBottom + mapH;

test("inside screens that outgrow the canvas, the one sits in the middle of its clear stretch", () => {
  const P = grid(5, 5);
  // cell (2, 2): its screen spans 600..800 by 300..400
  const cam = screenView(P, 12, 316 + 2 * SIDE, 216 + TOP + ABOVE(90), PACKED);
  assert.deepEqual(cam, { x: 700 - 158 - SIDE, y: 350 - 108 - TOP, z: 1 });
});

test("at the edge of a path's screens the view stops there, where that shows more of them", () => {
  const P = grid(5, 5);
  const [cw, ch] = [416, 316 + TOP + ABOVE(90)];
  // the corner screen starts where the clear stretch does, its neighbours filling the rest
  assert.deepEqual(screenView(P, 0, cw, ch, PACKED), { x: -SIDE, y: -TOP, z: 1 });
  // and the far corner's ends where it ends: the screens reach 1400 and 700
  const far = screenView(P, 24, cw, ch, PACKED);
  assert.equal(far.x + cw - SIDE, 1400);
  assert.equal(far.y + ch - ABOVE(90), 700);
});

test("a screen with no other row of screens in view sits mid-stretch, not against their edge", () => {
  // a row of five, and one screen two rows down at its far end, out of a narrow view
  const P = grid(5, 3, [0, 1, 2, 3, 4, 14]);
  const cam = screenView(P, 0, 200 + 2 * SIDE, 300 + TOP + ABOVE(54), PACKED);
  assert.equal(cam.x, -SIDE);
  assert.equal(cam.y + TOP + 150, 50); // the screen's middle at the clear stretch's
  // with the next column in view the stretch stops at the row's first screen, as before,
  // and the row still sits mid-stretch
  const wide = screenView(P, 0, 416, 300 + TOP + ABOVE(54), PACKED);
  assert.equal(wide.x, -SIDE);
  assert.equal(wide.y + TOP + 150, 50);
});

test("rows that would fit the stretch give way to the one screen where the other shows none", () => {
  // two rows, the second's one screen at its far end: its minimap is 180x36
  const cam = screenView(grid(5, 2, [0, 9]), 0, 216, 300 + TOP + ABOVE(36), PACKED);
  assert.equal(cam.y + TOP + 150, 50);
  // with its screen below the first the two sit in the stretch's middle together
  const both = screenView(grid(1, 2), 0, 200 + 2 * SIDE, 300 + TOP + ABOVE(120), PACKED);
  assert.equal(both.y, -25 - TOP);
});

test("a screen is in view only where more than a fifth of both its sides is", () => {
  // one far along the entry's row and one far down its column, neither in a view of one screen
  const apart = grid(5, 5, [0, 4, 20]);
  const cam = screenView(apart, 0, 316 + 2 * SIDE, 216 + TOP + ABOVE(90), PACKED);
  assert.deepEqual(cam, { x: -58 - SIDE, y: -58 - TOP, z: 1 });
  // 40 px of the next screen along is a strip, and a pixel more stops the view at the edge
  const row = grid(5, 1); // its minimap is 180x18
  const across = (cw) => screenView(row, 0, cw + 2 * SIDE, 100 + TOP + ABOVE(18), PACKED).x;
  assert.equal(across(340), -70 - SIDE);
  assert.equal(across(341), -SIDE);
  // 20 px of the next screen down likewise, by the pitch in force
  const column = grid(1, 3); // its minimap is 80x120
  const down = (ch, layout) =>
    screenView(column, 0, 200 + 2 * SIDE, ch + TOP + ABOVE(120), layout).y;
  assert.equal(down(170, PACKED), -35 - TOP);
  assert.equal(down(171, PACKED), -TOP);
  assert.equal(down(190, SPACED), -45 - TOP); // spaced, the next starts 200 down
});

test("screens the clear stretch holds sit in its middle, whatever grid lies empty about them", () => {
  // five screens along the last row of a 5x3 grid, the rows above holding none
  const P = grid(5, 3, [10, 11, 12, 13, 14]);
  const [cw, ch] = [416, 500 + TOP + ABOVE(54)];
  const cam = screenView(P, 10, cw, ch, PACKED);
  assert.equal(cam.x, -SIDE); // outgrown: stopped at the first screen
  assert.equal(cam.y + TOP + 250, 350); // held: the row's middle at the clear stretch's
  // spaced apart the screens stand further apart and the same holds
  assert.equal(screenView(P, 10, cw, ch, SPACED).y + TOP + 250, 450);
});

test("the minimap is passed above, or beside where that leaves the screen larger", () => {
  const P = grid(5, 5);
  // a canvas too short to hold a screen above the minimap at its own size
  const [cw, ch] = [600, 240];
  // beside it the stretch is 8..402 by 52..204, and cell (2, 2) sits in its middle
  assert.deepEqual(screenView(P, 12, cw, ch, PACKED), { x: 600 - 105, y: 300 - 78, z: 1 });
  // with the height to spare it is passed above, the screen free of the width
  const tall = screenView(P, 12, cw, 100 + TOP + ABOVE(90), PACKED);
  assert.equal(tall.z, 1);
  assert.ok((400 - tall.y) * tall.z <= 100 + TOP);
});

// ---- the shipped data -----------------------------------------------------

const CANVASES = [
  [280, 180],
  [320, 240],
  [320, 480],
  [320, 568],
  [360, 640],
  [390, 664],
  [390, 844],
  [430, 932],
  [568, 320],
  [594, 390],
  [518, 950],
  [600, 400],
  [774, 700],
  [1030, 600],
  [1030, 720],
  [1670, 950],
];
const GAMES = ["ao", "ae"].map((id) => load(`map_data_${id}.json`));
const pathsOf = (data) =>
  data.levels.flatMap((L) => L.paths.map((P) => [`${L.short} P${P.id}`, P]));

for (const data of GAMES) {
  test(`${data.id}: whichever screen a path opens on is whole in view and clear of the furniture`, () => {
    const eps = 1e-9;
    for (const layout of pitches(data.geometry))
      for (const [cw, ch] of CANVASES)
        for (const [name, P] of pathsOf(data)) {
          const s = minimapScale(P, layout);
          const mapW = Math.round(P.w * layout.cellW * s),
            mapH = Math.round(P.h * layout.cellH * s);
          for (const c of P.cams) {
            const at = `${name} cell ${c.cell} at ${cw}x${ch}, pitch ${layout.cellW}`;
            const cam = screenView(P, c.cell, cw, ch, layout);
            // the screen in canvas pixels
            const x = ((c.cell % P.w) * layout.cellW - cam.x) * cam.z,
              y = (Math.floor(c.cell / P.w) * layout.cellH - cam.y) * cam.z;
            const right = x + layout.visW * cam.z,
              foot = y + layout.visH * cam.z;
            assert.ok(x >= SIDE - eps && right <= cw - SIDE + eps, at);
            assert.ok(y >= TOP - eps && foot <= ch - BOTTOM + eps, at);
            // and left of the minimap in the lower right corner, or above it
            const { mapRight, mapBottom } = ENTRY_CLEAR;
            assert.ok(
              right <= cw - mapRight - mapW + eps || foot <= ch - mapBottom - mapH + eps,
              at,
            );
          }
        }
  });

  test(`${data.id}: a path that opens on one screen shows it larger than its fit would`, () => {
    for (const layout of pitches(data.geometry))
      for (const [cw, ch] of CANVASES)
        for (const [name, P] of pathsOf(data)) {
          if (opensWhole(P, cw, ch, data.geometry)) continue;
          const fit = pathFit(P, cw, ch, layout, originOf(layout));
          const one = screenView(P, P.cams[0].cell, cw, ch, layout);
          assert.ok(one.z > fit.z, `${name} at ${cw}x${ch}`);
        }
  });
}

test("a phone opens two paths whole, a window of 1280x720 beside the sidebar every one", () => {
  const paths = GAMES.flatMap((data) => pathsOf(data).map(([name, P]) => [name, P, data]));
  const whole = (cw, ch) =>
    paths.filter(([, P, data]) => opensWhole(P, cw, ch, data.geometry)).map(([name]) => name);
  assert.deepEqual(whole(390, 844), ["F1 P6", "F1 P7"]); // the two paths one screen wide
  assert.equal(whole(1030, 720).length, paths.length);
  assert.equal(whole(1116, 650).length, paths.length);
});
