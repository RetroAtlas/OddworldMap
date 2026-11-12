import { test } from "node:test";
import assert from "node:assert/strict";
import { artSettled, nearestFirst, showing, wanted } from "../../public/js/painter/artorder.js";
import { SYNTH_GEOMETRY, path, pitches } from "./fixtures.js";

const [PACKED, SPACED] = pitches(SYNTH_GEOMETRY); // 200x100 screens, 300x150 and 400x200 apart
const P = path(1, [], [], 3, 2);

test("a screen shows where more than a sliver of it lies in the view", () => {
  const view = { x: 300, y: 150, w: 200, h: 100 }; // cell 4's screen exactly
  const shows = (cell, v = view) => showing(cell, P, PACKED, v);
  assert.equal(shows(4), true);
  for (const cell of [0, 1, 2, 3, 5]) assert.equal(shows(cell), false); // a screen away each way
  // a tenth of a screen's side is the sliver: cell 3's screen ends at x 200
  assert.equal(shows(3, { ...view, x: 181 }), false);
  assert.equal(shows(3, { ...view, x: 179 }), true);
  // cell 5's starts at x 600
  assert.equal(shows(5, { ...view, w: 319 }), false);
  assert.equal(shows(5, { ...view, w: 321 }), true);
  // cell 1's ends at y 100
  assert.equal(shows(1, { ...view, y: 91 }), false);
  assert.equal(shows(1, { ...view, y: 89 }), true);
  // and from cell 1's view, cell 4's starts at y 150
  assert.equal(shows(4, { ...view, y: 0, h: 159 }), false);
  assert.equal(shows(4, { ...view, y: 0, h: 161 }), true);
  // a view holding the whole path shows every screen
  for (let cell = 0; cell < 6; cell++)
    assert.equal(shows(cell, { x: -50, y: -50, w: 1000, h: 400 }), true);
});

test("zoomed in past a screen, the sliver is a tenth of the view", () => {
  // a view 50 wide over the right end of cell 4's screen, which ends at x 500
  const view = (x) => ({ x, y: 160, w: 50, h: 30 });
  assert.equal(showing(4, P, PACKED, view(494)), true); // 6 of its 50 show the screen
  assert.equal(showing(4, P, PACKED, view(496)), false);
  // and one 30 tall over its foot, which ends at y 250
  const low = (y) => ({ x: 310, y, w: 200, h: 30 });
  assert.equal(showing(4, P, PACKED, low(244)), true);
  assert.equal(showing(4, P, PACKED, low(248)), false);
});

test("a screen is where the pitch in force lays it", () => {
  // spaced apart, cell 4's screen starts at (400, 200), where packed it starts at (300, 150)
  const view = { x: 400, y: 200, w: 200, h: 100 };
  assert.equal(showing(4, P, SPACED, view), true);
  assert.equal(showing(4, P, PACKED, { x: 510, y: 260, w: 200, h: 100 }), false);
});

test("the sprite art holds the other screens back only while it is wanted and coming", () => {
  const waiting = { objects: true, gated: false, sidecar: "in", shown: false, artIn: false };
  assert.equal(artSettled(waiting), false);
  assert.equal(artSettled({ ...waiting, sidecar: "coming" }), false);
  assert.equal(artSettled({ ...waiting, artIn: true }), true);
  assert.equal(artSettled({ ...waiting, shown: true }), true); // a place that has drawn its sprites
  assert.equal(artSettled({ ...waiting, sidecar: "failed" }), true);
  assert.equal(artSettled({ ...waiting, objects: false }), true);
  // under the zoom that asks for none of it, the sidecar's arrival is not waited for either
  assert.equal(artSettled({ ...waiting, sidecar: "coming", gated: true }), true);
  // an arrival counts only once the sidecar says what the art is
  assert.equal(artSettled({ ...waiting, sidecar: "coming", artIn: true, shown: true }), false);
});

test("the screens out of view come nearest the view's middle first", () => {
  const cams = [0, 1, 2, 3, 5].map((cell) => ({ cell }));
  const order = (view, layout = PACKED, of = cams) =>
    nearestFirst(of, P, layout, view).map((c) => c.cell);
  assert.deepEqual(order({ x: 300, y: 150, w: 200, h: 100 }), [1, 3, 5, 0, 2]); // from cell 4
  assert.deepEqual(order({ x: 0, y: 0, w: 200, h: 100 }), [0, 3, 1, 2, 5]); // from cell 0
  // the middle of a view wider or taller than a screen, not its corner
  assert.deepEqual(order({ x: 0, y: 0, w: 800, h: 100 }), [1, 0, 2, 3, 5]);
  const column = [{ cell: 1 }, { cell: 4 }];
  assert.deepEqual(order({ x: 300, y: 0, w: 200, h: 220 }, PACKED, column), [1, 4]);
  assert.deepEqual(order({ x: 300, y: 0, w: 200, h: 280 }, PACKED, column), [4, 1]);
  // by where the pitch in force stands each screen
  const pair = [{ cell: 1 }, { cell: 2 }];
  assert.deepEqual(order({ x: 480, y: 0, w: 200, h: 100 }, PACKED, pair), [2, 1]);
  assert.deepEqual(order({ x: 480, y: 0, w: 200, h: 100 }, SPACED, pair), [1, 2]);
  // the list handed in is left as it was
  assert.deepEqual(
    cams.map((c) => c.cell),
    [0, 1, 2, 3, 5],
  );
});

// a 3x2 path of six screens, and one camera that draws none, seen from cell 4
const SCREENS = path(
  1,
  [],
  [...[0, 1, 2, 3, 4, 5].map((cell) => ({ cell, png: `c${cell}.png` })), { cell: 6 }],
  3,
  3,
);
const FROM_4 = { x: 300, y: 150, w: 200, h: 100 };
const want = (asked, arrived, settled, view = FROM_4) =>
  [
    ...wanted(SCREENS, PACKED, view, {
      asked: (c) => asked.includes(c.cell),
      arrived: (c) => arrived.includes(c.cell),
      settled,
    }),
  ]
    .map((c) => c.cell)
    .sort();
const never = () => assert.fail("the sprite art was asked about before the view's screens were in");

test("a paint asks for the screens showing in its view, and nothing else until they are in", () => {
  assert.deepEqual(want([], [], never), [4]);
  assert.deepEqual(want([4], [], never), [4]);
});

test("the rest waits for the sprite art, then comes nearest first, four in flight at a time", () => {
  assert.deepEqual(
    want([4], [4], () => false),
    [4],
  );
  // of 1, 3, 5, 0, 2 by nearness, the first four
  assert.deepEqual(
    want([4], [4], () => true),
    [0, 1, 3, 4, 5],
  );
  // two still in flight leave room for two more
  assert.deepEqual(
    want([4, 1, 3], [4], () => true),
    [0, 4, 5],
  );
  assert.deepEqual(
    want([4, 1, 3, 5, 0], [4], () => true),
    [4],
  );
  // and one that has arrived gives its place up
  assert.deepEqual(
    want([4, 1, 3, 5, 0], [4, 1], () => true),
    [2, 4],
  );
});

test("a view over no screen of the path's goes straight to the rest", () => {
  // from the camera that draws none: of 3, 0, 4, 1, 5, 2 by nearness, the first four
  const FROM_6 = { x: 0, y: 300, w: 200, h: 100 };
  assert.deepEqual(
    want([], [], () => true, FROM_6),
    [0, 1, 3, 4],
  );
});

test("once every screen has been asked for, a paint asks for none", () => {
  assert.deepEqual(want([0, 1, 2, 3, 4, 5], [], never), []);
});
