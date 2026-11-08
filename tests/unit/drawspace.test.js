import { test } from "node:test";
import assert from "node:assert/strict";
import {
  camCell,
  cellAt,
  cellCentre,
  drawBox,
  lineRuns,
  markerCentre,
  nearestCam,
  offScreen,
  patrolZone,
  screenRuns,
  sligBounds,
  snapTarget,
} from "../../public/js/model.js";
import { AE_GEOMETRY, AO_GEOMETRY, SYNTH_GEOMETRY, path, pitches, tlv } from "./fixtures.js";

test("camCell: zero-padded C## suffix lookup, null for unknown or missing ids", () => {
  const P = path(
    1,
    [],
    [
      { cell: 0, name: "XXP01C01" },
      { cell: 3, name: "XXP01C12" },
    ],
    2,
    2,
  );
  assert.equal(camCell(P, 1), 0);
  assert.equal(camCell(P, 12), 3);
  assert.equal(camCell(P, 7), null);
  assert.equal(camCell(P, null), null);
});

test("cellAt: draw-space point to grid cell, null anywhere outside the grid", () => {
  const P = path(1, [], [], 3, 2);
  const cell = (x, y) => cellAt(x, y, P, SYNTH_GEOMETRY); // 300x150 draw cells
  assert.equal(cell(0, 0), 0);
  assert.equal(cell(750, 20), 2); // row 0, col 2
  assert.equal(cell(450, 200), 4); // row 1, col 1
  // the margins must not fold into a neighbouring row's edge cell:
  // col -1 is not "last cell of the row above", col w is not "first of the next"
  assert.equal(cell(-1, 200), null);
  assert.equal(cell(910, 20), null);
  assert.equal(cell(450, -5), null);
  assert.equal(cell(450, 301), null);
});

test("cellCentre: the middle of a cell's window, not of the cell", () => {
  const P = path(1, [], [], 3, 2);
  // 300x150 cells showing a 200x100 window at +40/+20
  assert.deepEqual(cellCentre(0, P, SYNTH_GEOMETRY), [100, 50]);
  assert.deepEqual(cellCentre(4, P, SYNTH_GEOMETRY), [400, 200]); // row 1, col 1
});

test("nearestCam: the screen nearest a point the keyboard did not aim", () => {
  const cam = (cell) => ({ cell, name: `C0${cell}` });
  const P = path(1, [], [cam(0), cam(2), cam(5)], 3, 2);
  const near = (x, y, p = P) => nearestCam(x, y, p, SYNTH_GEOMETRY);
  // a point inside a camera's own cell picks it
  assert.equal(near(110, 60).cell, 0);
  // and a point over an empty cell still answers, with the screen it is closest to
  assert.equal(near(400, 200).cell, 5); // cell 4 holds none; 5 is next door
  assert.equal(near(100, 200).cell, 0); // cell 3 holds none; 0 is above it
  // far outside the grid altogether
  assert.equal(near(-9000, -9000).cell, 0);
  assert.equal(near(9000, 9000).cell, 5);
  assert.equal(near(0, 0, path(1, [], [], 3, 2)), null);
});

// AO's window is 368x240 at +256/+120 of a 1024x480 cell, so 656x240 of slack
const box = (x, y, w = 10, h = 10) => ({ x1: x, y1: y, x2: x + w, y2: y + h });

test("screenRuns: the draw-space parts of a marker that cover screen", () => {
  const runs = (t) => screenRuns(t, AO_GEOMETRY);
  // wholly inside one window: one run per axis, the marker's own extent
  assert.deepEqual(runs(box(300, 200, 50, 20)).xs, [[44, 94]]);
  assert.deepEqual(runs(box(300, 200, 50, 20)).ys, [[80, 100]]);
  // reaching past the window's right edge: the run stops at the edge
  assert.deepEqual(runs(box(600, 200, 100, 20)).xs, [[344, 368]]);
  // wholly in the slack: nothing covers screen
  assert.deepEqual(runs(box(700, 200, 50, 20)).xs, []);
  assert.deepEqual(runs(box(300, 40, 50, 20)).ys, []);
  // crossing the slack into the next window: touching runs, so nothing is lost
  assert.deepEqual(runs(box(600, 200, 700, 20)).xs, [
    [344, 368],
    [368, 388],
  ]);
});

test("screenRuns: whole is nothing drawn anywhere the marker is not", () => {
  const whole = (t) => screenRuns(t, AO_GEOMETRY).whole;
  assert.equal(whole(box(300, 200, 50, 20)), true); // inside one window
  assert.equal(whole(box(600, 200, 700, 20)), true); // straddling two, slack crossed whole
  assert.equal(whole(box(600, 200, 100, 20)), false); // stops inside the slack
  assert.equal(whole(box(700, 200, 50, 20)), false); // never reaches a window
  // the measure is the drawn extent, not the world span the slack inflates
  assert.equal(box(600, 200, 700, 20).x2 - box(600, 200, 700, 20).x1, 700);
});

test("drawBox: framed by the screen it covers, not by the marker's own ends", () => {
  const b = (t) => drawBox(t, AO_GEOMETRY);
  // wholly inside one window: the marker's own extent, at its own position
  assert.deepEqual(b(box(300, 200, 50, 20)), { x: 44, y: 80, w: 50, h: 20 });
  // reaching past the window's right edge: the overhang trails the screen
  assert.deepEqual(b(box(600, 200, 100, 20)), { x: 344, y: 80, w: 100, h: 20 });
  // starting in the slack: the overhang leads the screen it reaches, so the
  // box keeps its extent and still contains the part drawn on that screen
  assert.deepEqual(b(box(1200, 200, 100, 20)), { x: 288, y: 80, w: 100, h: 20 });
  // crossing the slack whole: the fold takes the width the packing denies it
  assert.deepEqual(b(box(600, 200, 700, 20)).w, 44);
  // covering no screen at all: only its own frame to answer to, folded onto
  // the neighbour the packing lands it on
  assert.deepEqual(b(box(700, 200, 50, 20)), { x: 444, y: 80, w: 50, h: 20 });
});

test("drawBox: spaced, nothing is folded away and the box is the marker", () => {
  const [, g] = pitches(AO_GEOMETRY);
  // at the cell's own pitch the transform is a translation, so a box is its
  // world rect moved by the window's offset however many windows it crosses:
  // the slack inside it is canvas, not something to fold out of the width
  for (const t of [box(300, 200, 50, 20), box(600, 200, 700, 20), box(700, 200, 50, 20)])
    assert.deepEqual(drawBox(t, g), {
      x: t.x1 - g.winX,
      y: t.y1 - g.winY,
      w: t.x2 - t.x1,
      h: t.y2 - t.y1,
    });
});

test("markerCentre: the middle of the drawn box", () => {
  assert.deepEqual(markerCentre(box(300, 200, 50, 20), AO_GEOMETRY), [69, 90]);
  assert.deepEqual(markerCentre(box(1200, 200, 100, 20), AO_GEOMETRY), [338, 90]);
});

test("lineRuns: a collision line split where it leaves the screen", () => {
  const runs = (x1, y1, x2, y2) => lineRuns(x1, y1, x2, y2, AO_GEOMETRY);
  const shape = (rs) => rs.map((r) => [r.x1, r.y1, r.x2, r.y2, r.on]);
  // wholly inside one window: one piece, undivided
  assert.deepEqual(shape(runs(300, 200, 500, 200)), [[44, 80, 244, 80, true]]);
  // running off the window's right edge: solid to the edge, dotted past it
  assert.deepEqual(shape(runs(500, 200, 700, 200)), [
    [244, 80, 368, 80, true],
    [368, 80, 444, 80, false],
  ]);
  // crossing the slack whole: the fold takes no draw space, so it stays one piece
  assert.deepEqual(shape(runs(500, 200, 1400, 200)), [[244, 80, 488, 80, true]]);
  // never on screen at all
  assert.deepEqual(shape(runs(700, 200, 900, 200)), [[444, 80, 644, 80, false]]);
  // vertical, off the bottom edge
  assert.deepEqual(shape(runs(300, 300, 300, 400)), [
    [44, 180, 44, 240, true],
    [44, 240, 44, 280, false],
  ]);
});

test("lineRuns: a piece in the slack keeps the frame of the screen it left", () => {
  const runs = (x1, y1, x2, y2) => lineRuns(x1, y1, x2, y2, AO_GEOMETRY);
  const shape = (rs) => rs.map((r) => [r.x1, r.y1, r.x2, r.y2, r.on]);
  // AO's slack runs 624..1280, straddling the cell boundary at 1024. Taking
  // each end's own cell would run these backwards, across most of a screen
  assert.deepEqual(shape(runs(900, 200, 1100, 200)), [[644, 80, 844, 80, false]]);
  assert.deepEqual(shape(runs(950, 200, 1790, 200)), [
    [38, 80, 368, 80, false],
    [368, 80, 736, 80, true],
    [736, 80, 878, 80, false],
  ]);
  // an overhang is 1:1 with its own world span, whichever side it hangs off
  const [lead] = runs(4092, 200, 4424, 200);
  assert.equal(lead.x2 - lead.x1, 4352 - 4092);
  // a line ending exactly on a window edge covers none of that screen, so what
  // it leaves behind is an overhang and not a fold
  assert.deepEqual(shape(runs(500, 200, 624, 200)), [[244, 80, 368, 80, true]]);
  assert.deepEqual(shape(runs(500, 200, 700, 200)), [
    [244, 80, 368, 80, true],
    [368, 80, 444, 80, false],
  ]);
});

test("lineRuns: a diagonal is cut on whichever axis leaves the window first", () => {
  // from inside the window to beyond its right edge, descending as it goes: the
  // cut lands on the x edge at world 624, two thirds along, and the piece
  // endpoints are the transform's own rather than a lerp of the drawn ends
  const rs = lineRuns(524, 200, 674, 260, AO_GEOMETRY);
  assert.equal(rs.length, 2);
  assert.deepEqual([rs[0].on, rs[1].on], [true, false]);
  assert.deepEqual([rs[0].x1, rs[0].y1], [268, 80]);
  assert.ok(Math.abs(rs[0].x2 - 368) < 1e-9 && Math.abs(rs[0].y2 - 120) < 1e-9);
  assert.deepEqual([rs[1].x2, rs[1].y2], [418, 140]);
  // the pieces meet: no gap opens at the boundary
  assert.deepEqual([rs[0].x2, rs[0].y2], [rs[1].x1, rs[1].y1]);
});

test("lineRuns: the fold answers to the axes it crosses, not the ones it travels", () => {
  // descending as it crosses the slack between two windows, its y staying
  // inside one window throughout: that travel is screen distance the packing
  // folds nothing out of, so it cannot speak for whether the crossing has room
  const line = [500, 200, 1396, 312];
  const packed = lineRuns(...line, AO_GEOMETRY);
  const spaced = lineRuns(...line, { ...AO_GEOMETRY, cellW: 1024, cellH: 480 });
  // packed the crossing has no draw space, so the line stays the floor it is
  assert.deepEqual(
    packed.map((r) => r.on),
    [true],
  );
  assert.deepEqual([packed[0].x1, packed[0].y1, packed[0].x2, packed[0].y2], [244, 80, 484, 192]);
  // spaced the slack is canvas, and the crossing draws over it dotted
  assert.deepEqual(
    spaced.map((r) => r.on),
    [true, false, true],
  );
  // every piece starts where the last ended, at either pitch
  for (const rs of [packed, spaced])
    rs.slice(1).forEach((r, i) => assert.deepEqual([r.x1, r.y1], [rs[i].x2, rs[i].y2]));
});

test("offScreen: no part of the marker is on any screen", () => {
  assert.equal(offScreen(box(300, 200), AO_GEOMETRY), false);
  assert.equal(offScreen(box(2 * 1024 + 300, 3 * 480 + 200), AO_GEOMETRY), false); // any cell
  assert.equal(offScreen(box(700, 200), AO_GEOMETRY), true); // between two windows
  assert.equal(offScreen(box(300, 40), AO_GEOMETRY), true); // above one
  // an anchor in the slack whose span reaches its window is drawn, not lost
  assert.equal(offScreen(box(250, 200, 50, 20), AO_GEOMETRY), false);
  assert.equal(offScreen({ x1: 0, y1: 0, x2: 10, y2: 10 }, AE_GEOMETRY), false);
});

test("snapTarget: shown objects' centers and collision ends, within tolerance", () => {
  const door = { ...tlv("Door"), x1: 256 + 100, y1: 120 + 50, x2: 256 + 110, y2: 120 + 60 };
  const zone = { ...tlv("ShadowZone"), x1: 256 + 200, y1: 120 + 50, x2: 256 + 210, y2: 120 + 60 };
  const P = path(1, [door, zone]);
  P.lines = [[256, 120, 256 + 50, 120, 0]]; // draw-space (0,0)→(50,0)
  const snap = (pt, lines) => snapTarget(pt, P, 8, AO_GEOMETRY, lines);
  assert.deepEqual(snap({ x: 100, y: 52 }), { x: 105, y: 55 }); // the door's center
  assert.equal(snap({ x: 96, y: 55 }), null); // a pixel past the radius
  assert.equal(snap({ x: 205, y: 55 }), null); // the zone's category is off
  assert.equal(snap({ x: 2, y: 2 }), null); // lines not drawn, ends inert
  assert.deepEqual(snap({ x: 2, y: 2 }, true), { x: 0, y: 0 });
  assert.deepEqual(snap({ x: 48, y: 3 }, true), { x: 50, y: 0 }); // nearer end wins
});

test("snapTarget: a line's end in the slack snaps where the line is drawn", () => {
  // running off the window's right edge and into the slack, which straddles a
  // cell boundary: the end is drawn at 844, hanging off the screen it left,
  // while the transform alone would put it at 188, back over that screen
  const P = path(1, []);
  P.lines = [[500, 200, 1100, 200, 0]];
  assert.deepEqual(snapTarget({ x: 844, y: 80 }, P, 8, AO_GEOMETRY, true), { x: 844, y: 80 });
  assert.equal(snapTarget({ x: 188, y: 80 }, P, 8, AO_GEOMETRY, true), null);
});

test("patrolZone: the pen between the id-matched bound pair, window-bounded, the last of a side winning", () => {
  const at = (name, cellX, off, fields) => ({
    ...tlv(name),
    x1: cellX * 1024 + 256 + off,
    y1: 120 + 50,
    x2: cellX * 1024 + 256 + off + 24,
    y2: 120 + 74,
    fields,
  });
  const slig = at("Slig", 1, 100, { slig_bound_persist_id: 5 });
  const P = path(
    1,
    [
      slig,
      at("SligBoundLeft", 0, 40, { slig_id: 5 }),
      at("SligBoundRight", 2, 200, { slig_id: 5 }),
      at("SligBoundLeft", 1, 10, { slig_id: 9 }), // another pen's id
      at("SligBoundRight", 4, 10, { slig_id: 5 }), // 3 cells out: past AO's window
    ],
    [],
    5,
    1,
  );
  assert.deepEqual(patrolZone(slig, P, AO_GEOMETRY, "AO"), { x1: 40, x2: 936, y1: 50, y2: 74 });
  // drawn in the layout it is handed: spaced, the slack at the two cell
  // boundaries the pen crosses is canvas, and the pen is wider by both
  const [, spaced] = pitches(AO_GEOMETRY);
  assert.deepEqual(patrolZone(slig, P, spaced, "AO"), { x1: 40, x2: 2248, y1: 50, y2: 74 });
  // AE's wider window lets the far bound in, and of two Rights the engine keeps the later
  assert.deepEqual(patrolZone(slig, P, AO_GEOMETRY, "AE"), { x1: 40, x2: 1482, y1: 50, y2: 74 });

  // AE names the bound-side key like the Slig's own; spawners are penned too
  const spawner = at("SligSpawner", 1, 100, { slig_bound_persist_id: 7 });
  const P2 = path(
    2,
    [
      spawner,
      at("SligBoundLeft", 0, 60, { slig_bound_persist_id: 7 }),
      at("SligBoundRight", 4, 80, { slig_bound_persist_id: 7 }),
    ],
    [],
    5,
    1,
  );
  assert.equal(patrolZone(spawner, P2, AO_GEOMETRY, "AO"), null); // right bound out of window
  assert.deepEqual(sligBounds(spawner, P2, AO_GEOMETRY, "AO"), { left: P2.tlvs[1], right: null });
  assert.deepEqual(patrolZone(spawner, P2, AO_GEOMETRY, "AE"), {
    x1: 60,
    x2: 4 * 368 + 80,
    y1: 50,
    y2: 74,
  });

  // no pen for the idless, the non-slig, or an inside-out pair
  assert.equal(patrolZone(at("Slig", 1, 0, {}), P, AO_GEOMETRY, "AO"), null);
  assert.equal(
    patrolZone(at("Mudokon", 1, 0, { slig_bound_persist_id: 5 }), P, AO_GEOMETRY, "AO"),
    null,
  );
  const P3 = path(
    3,
    [at("SligBoundLeft", 2, 0, { slig_id: 5 }), at("SligBoundRight", 0, 0, { slig_id: 5 }), slig],
    [],
    5,
    1,
  );
  assert.equal(patrolZone(slig, P3, AO_GEOMETRY, "AO"), null);

  // a game the window table does not name is refused, whatever the object asked about
  assert.throws(() => patrolZone(slig, P, AO_GEOMETRY), /not a game this table names/);
  assert.throws(() => patrolZone(tlv("Door"), P, AO_GEOMETRY, "XX"), /not a game this table names/);
});
