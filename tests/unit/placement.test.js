import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cameraAt,
  clipBox,
  frameRect,
  joinBoxes,
  pixelAt,
} from "../../public/js/painter/placement.js";
import { AO_GEOMETRY, pitches } from "./fixtures.js";

// a frame as the sidecar carries it: its sheet and corner there, its size, its offset
const frame = (w, h, xoff, yoff) => ["Sheet", 0, 0, w, h, xoff, yoff];
const FULL = { scale: 1 },
  HALF = { scale: 0.5 };
const [AO, AE] = [false, true];

test("cameraAt: the window of the cell a point falls in, in world and in draw space", () => {
  const [packed, spaced] = pitches(AO_GEOMETRY);
  const window = { wx: 1280, wy: 600 };
  assert.deepEqual(cameraAt(packed, 1400, 700), { ...window, dx: 368, dy: 240 });
  assert.deepEqual(cameraAt(spaced, 1400, 700), { ...window, dx: 1024, dy: 480 });
  // the slack either side of a window is its cell's own
  for (const [x, y] of [
    [1024, 480],
    [2047.9, 959.9],
  ])
    assert.deepEqual(cameraAt(packed, x, y), { ...window, dx: 368, dy: 240 });
});

test("pixelAt: a world point cut to whole units, from its camera's corner", () => {
  const [packed] = pitches(AO_GEOMETRY);
  const cam = cameraAt(packed, 1400, 700);
  assert.deepEqual(pixelAt(cam, 1400.9, 700.2), [488, 340]);
  assert.deepEqual(pixelAt(cam, 1270, 590), [358, 230], "the slack before the window runs back");
});

test("frameRect: an offset is rounded toward the point and a size is kept", () => {
  assert.deepEqual(frameRect(frame(18, 39, 24, 1), FULL, false, AE), { x: 24, y: 1, w: 18, h: 39 });
  assert.deepEqual(frameRect(frame(21, 80, -10, -79), FULL, false, AE), {
    x: -9,
    y: -78,
    w: 21,
    h: 80,
  });
});

test("frameRect: a flip measures back from the point by the offset and the size together", () => {
  const f = frame(21, 80, -10, -79);
  assert.deepEqual(frameRect(f, FULL, true, AO), { x: -12, y: -78, w: 21, h: 80 });
  assert.deepEqual(frameRect(f, { ...FULL, flipY: true }, false, AO), {
    x: -9,
    y: -2,
    w: 21,
    h: 80,
  });
});

test("frameRect: at half scale the offset is a unit higher, and Exoddus's size a pixel larger", () => {
  const f = frame(21, 80, -10, -79);
  assert.deepEqual(frameRect(f, HALF, false, AO), { x: -4, y: -40, w: 10, h: 40 });
  assert.deepEqual(frameRect(f, HALF, false, AE), { x: -4, y: -40, w: 11, h: 41 });
  assert.deepEqual(frameRect(f, HALF, true, AO), { x: -6, y: -40, w: 10, h: 40 });
  assert.deepEqual(frameRect(f, HALF, true, AE), { x: -7, y: -40, w: 11, h: 41 });
  // any other scale takes the unit and not the pixel
  assert.deepEqual(frameRect(frame(10, 20, 10, -20), { scale: 1.5 }, false, AE), {
    x: 15,
    y: -30,
    w: 15,
    h: 30,
  });
});

test("frameRect: a copy truncates its offset and size, and a bare sprite reads no offset", () => {
  const f = frame(9, 7, -7, -9);
  const copy = { scale: 0.35, copy: true };
  assert.deepEqual(frameRect(f, copy, false, AE), { x: -2, y: -3, w: 3, h: 2 });
  assert.deepEqual(frameRect(f, copy, true, AE), { x: -1, y: -3, w: 3, h: 2 });
  assert.deepEqual(frameRect(f, { ...copy, flipY: true }, false, AE), { x: -2, y: 1, w: 3, h: 2 });
  assert.deepEqual(frameRect(f, { scale: 0.35, bare: true }, false, AE), {
    x: 0,
    y: 0,
    w: 9,
    h: 7,
  });
});

test("clipBox: the part inside the camera's window, and null where none is", () => {
  const cam = { dx: 368, dy: 240 };
  const clip = (x, y, w, h) => clipBox({ x, y, w, h }, cam, AO_GEOMETRY);
  assert.deepEqual(clip(400, 250, 30, 20), { x: 400, y: 250, w: 30, h: 20 });
  assert.deepEqual(clip(360, 230, 20, 30), { x: 368, y: 240, w: 12, h: 20 });
  assert.deepEqual(clip(720, 470, 40, 40), { x: 720, y: 470, w: 16, h: 10 });
  assert.equal(clip(340, 250, 28, 20), null, "a box that ends on the window's edge");
  assert.equal(clip(736, 250, 28, 20), null, "a box that starts on the far one");
  assert.equal(clip(400, 220, 30, 20), null);
  assert.equal(clip(400, 480, 30, 20), null);
});

test("joinBoxes: the box about two, whichever way round", () => {
  const a = { x: 10, y: 40, w: 20, h: 10 },
    b = { x: 25, y: 5, w: 14, h: 30 };
  assert.deepEqual(joinBoxes(a, b), { x: 10, y: 5, w: 29, h: 45 });
  assert.deepEqual(joinBoxes(b, a), { x: 10, y: 5, w: 29, h: 45 });
});
