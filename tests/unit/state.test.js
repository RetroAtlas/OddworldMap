import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setGeometry,
  setSpacing,
  cellOrigin,
  dX,
  dY,
  wX,
  wY,
  gX,
  gY,
  CELL_W,
  CELL_H,
  worldLen,
  routeTotal,
} from "../../public/js/data/state.js";
import { AO_GEOMETRY, AE_GEOMETRY, SYNTH_GEOMETRY } from "./fixtures.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("AO: the visible window maps 1:1 onto the cell", () => {
  setGeometry(AO_GEOMETRY);
  assert.equal(dX(256), 0); // window left edge -> cell left edge
  assert.equal(dY(120), 0);
  assert.equal(dX(256 + 368), 368); // window right edge -> cell right edge
  assert.equal(dX(2 * 1024 + 256 + 100), 2 * 368 + 100); // cell 2, 100 units into the window
  assert.equal(dY(3 * 480 + 120 + 50), 3 * 240 + 50);
});

test("AO: cross-cell spans compress the hidden margins", () => {
  setGeometry(AO_GEOMETRY);
  // 100 units into cell 0's window -> the same point one cell over is one cell width away
  assert.equal(dX(1024 + 256 + 100) - dX(256 + 100), 368);
});

test("AE: the visible window maps 1:1 onto the cell", () => {
  setGeometry(AE_GEOMETRY);
  assert.equal(dX(0), 0); // no window offset: the cell corner is the screen corner
  assert.equal(dY(0), 0);
  assert.equal(dX(368), 368); // window right edge -> cell right edge
  assert.equal(dY(240), 240);
  assert.equal(dX(375), 368); // the 7 units of slack fold onto the next cell's corner
  assert.equal(dY(260), 240);
  assert.equal(dX(2 * 375 + 100), 2 * 368 + 100);
});

test("world<->draw round-trips inside the visible window", () => {
  for (const g of [AO_GEOMETRY, AE_GEOMETRY, SYNTH_GEOMETRY]) {
    setGeometry(g);
    for (const cell of [0, 1, 5]) {
      const wx = cell * g.worldW + g.winX + g.visW / 3;
      const wy = cell * g.worldH + g.winY + g.visH / 3;
      close(wX(dX(wx)), wx);
      close(wY(dY(wy)), wy);
    }
  }
});

test("gX/gY: position within the screen, in grid squares", () => {
  setGeometry(AO_GEOMETRY);
  assert.equal(gX(256), 0); // the visible window's left edge, not the cell's
  assert.equal(gY(120), 0);
  assert.equal(gX(256 + 25), 1);
  close(gX(2 * 1024 + 256 + 368), 368 / 25); // window right edge, any cell
  setGeometry(AE_GEOMETRY); // no window offset: the cell edge is the screen edge
  assert.equal(gX(0), 0);
  assert.equal(gX(3 * 375 + 50), 2);
  assert.equal(gY(4 * 260 + 130), 5.2);
});

test("worldLen reads draw-space lengths as world units", () => {
  for (const g of [AO_GEOMETRY, AE_GEOMETRY, SYNTH_GEOMETRY]) {
    setGeometry(g); // a screen's interior is 1:1 whatever the pitch around it
    assert.equal(worldLen(3, 4), 5);
    assert.equal(worldLen(0, -240), 240); // sign-insensitive, like a length should be
  }
});

test("routeTotal sums polyline legs in world units", () => {
  setGeometry(AO_GEOMETRY);
  assert.equal(routeTotal([{ x: 3, y: 4 }]), 0); // a single waypoint has no legs
  assert.equal(
    routeTotal([
      { x: 0, y: 0 },
      { x: 30, y: 40 },
      { x: 30, y: 100 },
    ]),
    110,
  );
  setGeometry(AE_GEOMETRY);
  close(
    routeTotal([
      { x: 0, y: 0 },
      { x: 0, y: 240 },
    ]),
    240,
  );
});

test("setGeometry updates the exported cell-size live bindings", () => {
  setGeometry(SYNTH_GEOMETRY); // cell size differs from both games and the defaults
  assert.equal(CELL_W, 300);
  assert.equal(CELL_H, 150);
  setGeometry(AO_GEOMETRY);
  assert.equal(CELL_W, 368);
});

test("cellW/cellH space screens out, they do not scale what is inside one", () => {
  setGeometry(SYNTH_GEOMETRY); // 200x100 window laid out at a 300x150 pitch
  assert.equal(dX(400 + 40 + 30), 300 + 30); // cell 1, 30 units into the window
  assert.equal(dY(200 + 20 + 30), 150 + 30);
  assert.equal(dX(40 + 200) - dX(40), 200); // the window keeps its own width
});

test("spacing lays screens at the cell's own pitch, packing folds it away", () => {
  setGeometry(AO_GEOMETRY);
  assert.equal(dX(256), 0); // packed: the window's corner is the cell's
  assert.equal(dX(1024 + 256), 368);
  setSpacing(true);
  assert.equal(CELL_W, 1024); // spaced: the pitch is the cell
  assert.equal(CELL_H, 480);
  // the transform degenerates to a translation, draw space becoming world space
  assert.equal(dX(256), 0);
  assert.equal(dX(1024 + 256), 1024);
  assert.equal(dY(120), 0);
  assert.equal(dY(480 + 120), 480);
  // a screen's interior is still 1:1, which is what keeps a link's zoom meaning
  // the same thing either way
  assert.equal(dX(256 + 100) - dX(256), 100);
  setSpacing(false);
  assert.equal(CELL_W, 368);
  assert.equal(dX(1024 + 256), 368);
});

test("a draw point survives a change of pitch through the world point it names", () => {
  for (const g of [AO_GEOMETRY, AE_GEOMETRY]) {
    for (const spacedFirst of [false, true]) {
      setGeometry(g);
      setSpacing(spacedFirst);
      // a point inside a window, which is all a route waypoint or a view can be
      for (const cell of [0, 1, 4]) {
        const before = {
          x: dX(cell * g.worldW + g.winX + 40),
          y: dY(cell * g.worldH + g.winY + 30),
        };
        const world = { x: wX(before.x), y: wY(before.y) };
        setSpacing(!spacedFirst);
        const after = { x: dX(world.x), y: dY(world.y) };
        setSpacing(spacedFirst);
        assert.deepEqual({ x: dX(world.x), y: dY(world.y) }, before, "and back again");
        assert.ok(Number.isFinite(after.x) && Number.isFinite(after.y));
      }
    }
  }
  setSpacing(false);
});

test("cellOrigin: a screen sits inside its cell, never on the cell's own corner", () => {
  setGeometry(AO_GEOMETRY);
  assert.deepEqual(cellOrigin(), [0, 0]); // packed: the fold leaves the two the same point
  setSpacing(true);
  assert.deepEqual(cellOrigin(), [-256, -120]);
  // which is where the transform puts the cell's corner, so the grid drawn from
  // it frames the screen rather than butting against it
  assert.equal(dX(0), cellOrigin()[0]);
  assert.equal(dY(0), cellOrigin()[1]);
  assert.equal(dX(1024), 1 * 1024 + cellOrigin()[0]);
  // the screen's own corner stays where the artwork is drawn
  assert.equal(dX(256), 0);
  setSpacing(false);
  assert.equal(dX(0), -256); // packed the cell corner has no place of its own
  assert.deepEqual(cellOrigin(), [0, 0]);
});
