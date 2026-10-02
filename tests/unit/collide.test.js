import { test } from "node:test";
import assert from "node:assert/strict";
import {
  moveOnLine,
  nextLine,
  onEndOfLine,
  prevLine,
  raycast,
  raycastDiag,
  raycastDown,
  tlvAt,
  wallHit,
} from "../../public/js/collide.js";

// a floor, a wall up from its end, a ledge off the wall's top, and a slope back down
const LINES = [
  [0, 100, 100, 100, 0],
  [100, 100, 100, 50, 1],
  [100, 50, 200, 50, 0],
  [200, 50, 250, 100, 0],
];
const LINKS = [
  [-1, 1],
  [0, 2],
  [1, 3],
  [2, -1],
];
const near = (a, b) => Math.abs(a - b) < 1e-9;

test("raycast: the nearest crossing of an asked type, a parallel line never counting", () => {
  assert.deepEqual(raycast(LINES, 50, 0, 50, 200, [0]), { line: 0, x: 50, y: 100 });
  assert.equal(raycast(LINES, 0, 100, 100, 100, [0]), null, "a ray along the floor misses it");
  assert.deepEqual(raycast(LINES, 50, 75, 150, 75, [1]), { line: 1, x: 100, y: 75 });
  assert.equal(raycast(LINES, 50, 75, 150, 75, [0]), null, "the wall is not a floor");
  assert.deepEqual(
    raycast(LINES, 225, 0, 225, 200, [0]),
    { line: 3, x: 225, y: 75 },
    "a slope interpolates",
  );
});

test("raycastDown and raycastDiag: the vertical probe's nearest y, and the diagonal's crossing with its line", () => {
  assert.equal(raycastDown(LINES, 50, 0, 200, [0]), 100);
  assert.equal(raycastDown(LINES, 150, 0, 200, [0]), 50);
  assert.equal(raycastDown(LINES, 225, 0, 200, [0]), 75);
  const hit = raycastDiag(LINES, 210, 0, 240, 120, [0]);
  assert.ok(near(hit.x, 230) && near(hit.y, 80), `${hit.x} ${hit.y}`);
  assert.deepEqual(hit.line, [200, 50, 250, 100]);
});

test("wallHit and onEndOfLine: the probe above the feet against the plane's walls, and the floor a grid ahead of the snapped foot", () => {
  assert.equal(wallHit(LINES, 90, 100, 25, 15, false), true);
  assert.equal(wallHit(LINES, 50, 100, 25, 15, false), false, "fifteen units short of it");
  assert.equal(
    wallHit(LINES, 90, 100, 25, 15, true),
    false,
    "a background probe asks the background's wall types",
  );
  assert.equal(
    onEndOfLine("AE", LINES, 20, 100, false, true, 1),
    true,
    "nothing a grid left of the floor's start",
  );
  assert.equal(onEndOfLine("AE", LINES, 20, 100, false, false, 1), false);
});

test("nextLine and prevLine: the links first, else a line whose matching end lies within eight units, Exoddus wanting the same type", () => {
  assert.equal(nextLine(LINES, LINKS, 0, false), 1);
  assert.equal(prevLine(LINES, LINKS, 1, false), 0);
  assert.equal(nextLine(LINES, LINKS, 3, false), null, "the chain ends");
  assert.equal(
    nextLine(LINES, null, 0, false),
    null,
    "the wall is another type, so Exoddus does not step onto it",
  );
  assert.equal(nextLine(LINES, null, 0, true), 1, "Oddysee does");
  assert.equal(prevLine(LINES, null, 2, false), null);
  assert.equal(prevLine(LINES, null, 2, true), 1);
  assert.equal(nextLine(LINES, null, 2, false), 3, "the slope shares the ledge's type");
});

test("moveOnLine: a stride along the line, carried onto the linked line past either end, null where the chain ends", () => {
  assert.deepEqual(moveOnLine(LINES, LINKS, 0, 50, 100, 10, false), { line: 0, x: 60, y: 100 });
  assert.deepEqual(
    moveOnLine(LINES, LINKS, 0, 90, 100, 20, false),
    { line: 1, x: 100, y: 90 },
    "ten up the wall",
  );
  assert.deepEqual(
    moveOnLine(LINES, LINKS, 1, 100, 60, 20, false),
    { line: 2, x: 110, y: 50 },
    "over the top onto the ledge",
  );
  const slope = moveOnLine(LINES, LINKS, 2, 190, 50, 20, false);
  assert.equal(slope.line, 3);
  assert.ok(
    near(slope.x, 200 + 10 / Math.SQRT2) && near(slope.y, 50 + 10 / Math.SQRT2),
    "ten units down the slope",
  );
  assert.equal(moveOnLine(LINES, LINKS, 3, 240, 90, 50, false), null, "off the slope's end");
  assert.deepEqual(
    moveOnLine(LINES, LINKS, 2, 105, 50, -10, false),
    { line: 1, x: 100, y: 55 },
    "backwards off the ledge, five down the wall",
  );
});

test("tlvAt: the first object of the name whose rectangle meets the probe, edges inclusive", () => {
  const tlvs = [{ name: "T", x1: 10, y1: 10, x2: 20, y2: 20 }];
  assert.equal(tlvAt(tlvs, 20, 5, 30, 10, "T"), tlvs[0], "touching at a corner counts");
  assert.equal(tlvAt(tlvs, 21, 5, 30, 10, "T"), null);
  assert.equal(tlvAt(tlvs, 20, 5, 30, 10, "U"), null);
});

// the slope's end with a line nine units on, one eight units on, and a wall down from that one's end
const NEAR = [...LINES, [259, 100, 320, 100, 0], [258, 100, 300, 100, 0], [300, 100, 300, 150, 1]];
const NEAR_LINKS = [...LINKS.slice(0, 3), [2, -1], [-1, -1], [3, 6], [5, -1]];

test("nextLine: the eight-unit neighbour is taken and a nine-unit one is not, in array order", () => {
  assert.equal(
    nextLine(NEAR, null, 3, false),
    5,
    "the line nine units on is passed over for the one eight on",
  );
  assert.equal(prevLine(NEAR, null, 5, false), 3);
  assert.equal(
    prevLine(NEAR, null, 4, false),
    null,
    "nothing ends within eight units of the nine-unit line's start",
  );
});

test("moveOnLine: a stride back off a vertical line's start lands on the line before it, either way the wall runs", () => {
  assert.deepEqual(
    moveOnLine(NEAR, NEAR_LINKS, 1, 100, 95, -10, false),
    { line: 0, x: 95, y: 100 },
    "down an upward wall onto the floor",
  );
  assert.deepEqual(
    moveOnLine(NEAR, NEAR_LINKS, 6, 300, 105, -10, false),
    { line: 5, x: 295, y: 100 },
    "up a downward wall onto the ledge",
  );
  assert.deepEqual(
    moveOnLine(NEAR, NEAR_LINKS, 6, 300, 140, 20, false),
    null,
    "and off the downward wall's end",
  );
});

test("raycast: a crossing whose determinant is under a unit is skipped as parallel", () => {
  assert.equal(raycast([[0, 0, 1, 1, 0]], 0, 0.5, 0.5, 0.5, [0]), null);
  assert.deepEqual(
    raycast([[0, 0, 10, 10, 0]], 0, 5, 10, 5, [0]),
    { line: 0, x: 5, y: 5 },
    "a longer line crosses",
  );
});
