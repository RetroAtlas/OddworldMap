import { test } from "node:test";
import assert from "node:assert/strict";
import { pathFit } from "../../public/js/model/opening.js";
import { ZOOM_MIN } from "../../public/js/config.js";
import { SYNTH_GEOMETRY, path, pitches } from "./fixtures.js";

// a cell's corner relative to its screen's, as state.js's cellOrigin has it
const originOf = (layout) =>
  layout.cellW === layout.worldW ? [-layout.winX, -layout.winY] : [0, 0];
const [PACKED, SPACED] = pitches(SYNTH_GEOMETRY);

test("the fit holds the whole grid in the middle of the canvas, a margin about it", () => {
  const P = path(1, [], [], 3, 2); // 900x300 packed
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
  const P = path(1, [], [], 40, 40);
  assert.equal(pathFit(P, 100, 100, PACKED, [0, 0]).z, ZOOM_MIN);
});
