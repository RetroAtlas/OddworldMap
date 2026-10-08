import { test } from "node:test";
import assert from "node:assert/strict";
import {
  camCell,
  camCenter,
  cellAt,
  cellCentre,
  centerCam,
  computeConnections,
  computeEntryPaths,
  destOf,
  destTrusted,
  wayThrough,
  findTlv,
  focusZoom,
  formatHash,
  hashToDraw,
  isLoopback,
  lineRuns,
  offScreen,
  drawBox,
  markerCentre,
  nearestCam,
  screenRuns,
  parseHash,
  patrolZone,
  sligBounds,
  resolveTarget,
  snapTarget,
  zoomAt,
} from "../../public/js/model.js";
import { ZOOM_MIN, ZOOM_MAX, MAX_ROUTE_PTS } from "../../public/js/config.js";
import {
  AO_GEOMETRY,
  AE_GEOMETRY,
  SYNTH_GEOMETRY,
  dataset,
  level,
  path,
  pitches,
  tlv,
} from "./fixtures.js";

// the dataset destOf looks a destination's partner up in, with the level and
// path it stands on. The dataset holds nothing but that path, and the path
// holds no objects, so no destination can land on a partner here
const HERE_PATH = path(15, [], [{ cell: 0, name: "XXP15C01" }], 1, 1);
const HERE = [dataset([level("R1", HERE_PATH)]), { short: "R1" }, HERE_PATH];

// a TLV moved to world position (x, y); SYNTH_GEOMETRY cells are 400x200 units
const at = (t, x, y) => ({ ...t, x1: x, y1: y, x2: x + 10, y2: y + 10 });

test("destOf: primary destination wins when it leads elsewhere", () => {
  const t = tlv("Door", { to_level: "R2", to_path: 1, to_cam: 3 });
  assert.deepEqual(destOf(t, ...HERE), { lv: "R2", pa: 1, ca: 3, target: null });
});

test("destOf: an uncorroborated destination still answers, and destTrusted refuses it", () => {
  const [data, lvl] = HERE;
  const t = tlv("Door", { to_level: "R2", to_path: 1, to_cam: 3, "target_door#": 4 });
  const d = destOf(t, ...HERE);
  assert.deepEqual(d, {
    lv: "R2",
    pa: 1,
    ca: 3,
    target: { name: "Door", field: "door#", value: 4 },
  });
  assert.equal(destTrusted(d, data, lvl), false);
});

test("destOf: self destination falls through to the alternate", () => {
  const t = tlv("WellExpress", {
    to_level: "R1",
    to_path: 15,
    to_cam: 1,
    alt_level: "R2",
    alt_path: 2,
    alt_cam: 4,
  });
  assert.deepEqual(destOf(t, ...HERE), { lv: "R2", pa: 2, ca: 4, target: null });
});

test("destOf: a paired target keeps even a same-path destination", () => {
  const t = tlv("Door", { to_level: "R1", to_path: 15, to_cam: 2, "target_door#": 4 });
  assert.deepEqual(destOf(t, ...HERE), {
    lv: "R1",
    pa: 15,
    ca: 2,
    target: { name: "Door", field: "door#", value: 4 },
  });
});

test("destOf: pair number 0 is a value target like any other", () => {
  // ~200 placeholder pairs are numbered 0 on both sides; the engine's arrival
  // hunt looks for door number 0 exactly as it would for any other number
  const door = tlv("Door", { to_level: "R2", to_path: 1, to_cam: 2, "target_door#": 0 });
  assert.deepEqual(destOf(door, ...HERE), {
    lv: "R2",
    pa: 1,
    ca: 2,
    target: { name: "Door", field: "door#", value: 0 },
  });
  const tp = tlv("Teleporter", { to_level: "R2", to_path: 1, to_cam: 2, "target_tp#": 0 });
  assert.deepEqual(destOf(tp, ...HERE), {
    lv: "R2",
    pa: 1,
    ca: 2,
    target: { name: "Teleporter", field: "tp#", value: 0 },
  });
});

test("destOf: a well's bounce-back yields to the ride, even within the path", () => {
  // switch off, most express wells drop you back out of the same well; that
  // bounce names the well's own camera (and its own well id). The enabled ride
  // wins — including a local ride to another camera of the same path
  const cams = [
    { cell: 0, name: "XXP15C01" },
    { cell: 1, name: "XXP15C02" },
  ];
  const well = at(
    tlv("WellExpress", {
      to_level: "R1",
      to_path: 15,
      to_cam: 1,
      alt_level: "R1",
      alt_path: 15,
      alt_cam: 2,
      "well#": 3,
      "target_well#": 3,
      "alt_target_well#": 12,
    }),
    50,
    20,
  ); // cell 0 -> C01: the primary names its own camera
  const P = path(15, [well], cams, 2, 1);
  assert.deepEqual(destOf(well, dataset([level("R1", P)]), { short: "R1" }, P), {
    lv: "R1",
    pa: 15,
    ca: 2,
    target: { field: "well#", value: 12 },
  });
});

test("destOf: a launcher well (every state bounces) keeps no pairing", () => {
  // wells whose only destination is their own camera exit within their screen;
  // they must not read as self-referencing scenery (no loopback flag)
  const launcher = at(
    tlv("WellExpress", { to_level: "R1", to_path: 15, to_cam: 1, "well#": 3, "target_well#": 3 }),
    50,
    20,
  );
  const P = path(15, [launcher], [{ cell: 0, name: "XXP15C01" }], 1, 1);
  const D = dataset([level("R1", P)]);
  assert.deepEqual(destOf(launcher, D, { short: "R1" }, P), {
    lv: "R1",
    pa: 15,
    ca: 1,
    target: null,
  });
  assert.equal(isLoopback(launcher, D, { short: "R1" }, P), false);
});

test("destOf: an unpointed state yields to the one that names a partner", () => {
  // the unpointed side finds a placeholder answering as readily as a real partner
  const well = at(
    tlv("WellExpress", {
      to_level: "MI",
      to_path: 1,
      to_cam: 1,
      alt_level: "R1",
      alt_path: 15,
      alt_cam: 1,
      "well#": 6,
      "target_well#": 0,
      "alt_target_well#": 1,
    }),
    50,
    20,
  );
  const partner = at(tlv("WellExpress", { "well#": 1 }), 60, 20); // the same screen
  const P = path(15, [well, partner], [{ cell: 0, name: "XXP15C01" }]);
  const mines = {
    ...level("MI", path(1, [tlv("WellExpress", { "well#": 0 })], [{ cell: 0, name: "XXP01C01" }])),
    id: 1,
  };
  assert.deepEqual(destOf(well, dataset([level("R1", P), mines]), { short: "R1" }, P), {
    lv: "R1",
    pa: 15,
    ca: 1,
    target: { field: "well#", value: 1 },
  });
});

test("destOf: a cross-path well ride carries its arrival well id", () => {
  const t = tlv("WellExpress", { to_level: "R2", to_path: 1, to_cam: 4, "target_well#": 7 });
  assert.deepEqual(destOf(t, ...HERE), {
    lv: "R2",
    pa: 1,
    ca: 4,
    target: { field: "well#", value: 7 },
  });
});

test("resolveTarget: nameless well targets match either well type, camera-only", () => {
  // AO names local wells WellLocal, AE LocalWell; arrival goes by id alone
  const local = at(tlv("LocalWell", { "well#": 7 }), 50, 20); // cell 0 -> C01
  const express = at(tlv("WellExpress", { "well#": 7 }), 450, 20); // cell 1 -> C02
  const cams = [
    { cell: 0, name: "XXP01C01" },
    { cell: 1, name: "XXP01C02" },
  ];
  const P = path(1, [local, express], cams, 2, 1);
  const target = { field: "well#", value: 7 };
  assert.equal(resolveTarget({ ca: 1, target }, P, SYNTH_GEOMETRY), local);
  assert.equal(resolveTarget({ ca: 2, target }, P, SYNTH_GEOMETRY), express);
  // the engine's arrival scan is camera-bounded: no path-wide fallback
  assert.equal(
    resolveTarget({ ca: 2, target: { field: "well#", value: 9 } }, P, SYNTH_GEOMETRY),
    null,
  );
});

test("destOf: hand stone views follow the first viewed camera", () => {
  // AE shape: bare camera ids, viewed within the stone's own path
  const ae = tlv("HandStone", { view1_cam: 50, view2_cam: 53 });
  const P = path(15, [], [{ cell: 0, name: "XXP15C50" }], 1, 1);
  const D = dataset([level("R1", P)]);
  assert.deepEqual(destOf(ae, D, { short: "R1" }, P), { lv: "R1", pa: 15, ca: 50, target: null });
  // AO shape: full level/path/camera triples
  const ao = tlv("HandStone", { view1_level: "F1", view1_path: 2, view1_cam: 5 });
  assert.deepEqual(destOf(ao, ...HERE), { lv: "F1", pa: 2, ca: 5, target: null });
  // a viewed camera the path no longer has, or no selection: nothing to follow
  assert.equal(destOf(tlv("HandStone", { view1_cam: 4 }), D, { short: "R1" }, P), null);
  assert.equal(destOf(ae, D, null, null), null);
});

// the only thing holding this guard: no stone view survives the rest of the
// gauntlet on either game's shipped data, so nothing in the sweeps would fail
// if a caller dropped it
test("wayThrough: a hand stone's view is not a way through", () => {
  const [data, lvl] = HERE;
  const ao = tlv("HandStone", { view1_level: "F1", view1_path: 2, view1_cam: 5 });
  assert.deepEqual(destOf(ao, ...HERE), { lv: "F1", pa: 2, ca: 5, target: null });
  assert.equal(destTrusted(destOf(ao, ...HERE), data, lvl), true);
  assert.equal(wayThrough(ao, ...HERE), null);
  // a real transition comes back, and one the map cannot believe does not
  const go = tlv("PathTransition", { to_level: "R1", to_path: 15, to_cam: 1 });
  assert.deepEqual(wayThrough(go, ...HERE), { lv: "R1", pa: 15, ca: 1, target: null });
  const dead = tlv("Door", { to_level: "R2", to_path: 9, to_cam: 1, "target_door#": 7 });
  assert.equal(wayThrough(dead, ...HERE), null);
});

test("computeEntryPaths: hand stone views are not arrivals", () => {
  const d = dataset([
    level("R1", path(15, [tlv("HandStone", { view1_level: "F1", view1_path: 2, view1_cam: 5 })])),
    level("F1", path(2, [])),
  ]);
  assert.deepEqual(computeEntryPaths(d), {});
});

test("destOf: both destinations self -> primary still returned", () => {
  const t = tlv("Door", { to_level: "R1", to_path: 15, to_cam: 1 });
  assert.deepEqual(destOf(t, ...HERE), { lv: "R1", pa: 15, ca: 1, target: null });
});

test("destOf: travel BirdPortals pair with the exit in the destination camera", () => {
  const travel = tlv("BirdPortal", { portal: "travel", to_level: "R2", to_path: 16, to_cam: 3 });
  assert.deepEqual(destOf(travel, ...HERE), {
    lv: "R2",
    pa: 16,
    ca: 3,
    target: { name: "BirdPortalExit" },
  });
  // rescue/shrykull portals don't traverse, so they carry no destination at all
  assert.equal(destOf(tlv("BirdPortal", { portal: "rescue" }), ...HERE), null);
});

test("resolveTarget: name-only targets match only inside the stated camera", () => {
  const exitA = at(tlv("BirdPortalExit"), 50, 20); // cell 0 -> C01
  const exitB = at(tlv("BirdPortalExit"), 450, 20); // cell 1 -> C02
  const cams = [
    { cell: 0, name: "XXP01C01" },
    { cell: 1, name: "XXP01C02" },
  ];
  const target = { name: "BirdPortalExit" };
  const P = path(1, [exitA, exitB], cams, 2, 1);
  assert.equal(resolveTarget({ ca: 2, target }, P, SYNTH_GEOMETRY), exitB);
  assert.equal(resolveTarget({ ca: 1, target }, P, SYNTH_GEOMETRY), exitA);
  // dangling camera or exit-less destination: no path-wide fallback for name-only
  assert.equal(resolveTarget({ ca: 9, target }, P, SYNTH_GEOMETRY), null);
  const noExitInC2 = path(1, [exitA], cams, 2, 1);
  assert.equal(resolveTarget({ ca: 2, target }, noExitInC2, SYNTH_GEOMETRY), null);
  // two candidates in the stated camera: ambiguous, no first-of-many guess
  const exitB2 = at(tlv("BirdPortalExit"), 460, 40);
  const twoInC2 = path(1, [exitA, exitB, exitB2], cams, 2, 1);
  assert.equal(resolveTarget({ ca: 2, target }, twoInC2, SYNTH_GEOMETRY), null);
});

test("destOf: no or incomplete destination -> null", () => {
  assert.equal(destOf(tlv("Slig"), ...HERE), null);
  assert.equal(destOf(tlv("Door", { to_level: "R2" }), ...HERE), null); // path missing
});

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

test("resolveTarget: matches inside the destination camera before anything else", () => {
  // same door# in two cameras: the destination camera's copy must win
  const a = at(tlv("Door", { "door#": 1 }), 50, 20); // cell 0 -> C01
  const b = at(tlv("Door", { "door#": 1 }), 450, 20); // cell 1 -> C02
  const P = path(
    1,
    [a, b],
    [
      { cell: 0, name: "XXP01C01" },
      { cell: 1, name: "XXP01C02" },
    ],
    2,
    1,
  );
  const target = { name: "Door", field: "door#", value: 1 };
  assert.equal(resolveTarget({ ca: 2, target }, P, SYNTH_GEOMETRY), b);
  assert.equal(resolveTarget({ ca: 1, target }, P, SYNTH_GEOMETRY), a);
});

test("resolveTarget: path-wide fallback when the destination camera has no match", () => {
  const a = at(tlv("Door", { "door#": 5 }), 50, 20); // cell 0, not the target cam
  const P = path(
    1,
    [a],
    [
      { cell: 0, name: "XXP01C01" },
      { cell: 1, name: "XXP01C02" },
    ],
    2,
    1,
  );
  assert.equal(
    resolveTarget({ ca: 2, target: { name: "Door", field: "door#", value: 5 } }, P, SYNTH_GEOMETRY),
    a,
  );
  assert.equal(
    resolveTarget({ ca: 2, target: { name: "Door", field: "door#", value: 9 } }, P, SYNTH_GEOMETRY),
    null,
  );
});

test("resolveTarget: pair number 0 matches the 0-numbered partner, camera-only", () => {
  const zero = at(tlv("Door", { "door#": 0 }), 50, 20); // cell 0 -> C01
  const five = at(tlv("Door", { "door#": 5 }), 60, 120); // cell 0 too
  const stray = at(tlv("Door", { "door#": 0 }), 450, 20); // cell 1 -> C02
  const cams = [
    { cell: 0, name: "XXP01C01" },
    { cell: 1, name: "XXP01C02" },
  ];
  const target = { name: "Door", field: "door#", value: 0 };
  // the 0-numbered door wins over a same-camera neighbor with a real number
  const P = path(1, [five, zero, stray], cams, 2, 1);
  assert.equal(resolveTarget({ ca: 1, target }, P, SYNTH_GEOMETRY), zero);
  // no 0-numbered door in the stated camera: no path-wide fallback for 0
  const onlyFive = path(1, [five, stray], cams, 2, 1);
  assert.equal(resolveTarget({ ca: 1, target }, onlyFive, SYNTH_GEOMETRY), null);
  assert.equal(resolveTarget({ ca: 9, target }, P, SYNTH_GEOMETRY), null); // dangling camera
});

test("resolveTarget: no paired target -> null", () => {
  const P = path(1, [at(tlv("Door", { "door#": 1 }), 50, 20)], [], 1, 1);
  assert.equal(resolveTarget({ ca: 1, target: null }, P, SYNTH_GEOMETRY), null);
  assert.equal(resolveTarget(null, P, SYNTH_GEOMETRY), null);
});

test("isLoopback: a door whose destination resolves to itself", () => {
  const self = at(
    tlv("Door", { to_level: "R1", to_path: 15, to_cam: 1, "door#": 1, "target_door#": 1 }),
    50,
    20,
  );
  const P = path(15, [self], [{ cell: 0, name: "XXP15C01" }], 1, 1);
  assert.equal(isLoopback(self, dataset([level("R1", P)]), { short: "R1" }, P), true);
});

test("isLoopback: paired doors and cross-path/same-cam neighbors are not loopbacks", () => {
  const cams = [
    { cell: 0, name: "XXP15C01" },
    { cell: 1, name: "XXP15C02" },
  ];
  // a proper pair across cameras: each resolves to the other
  const a = at(
    tlv("Door", { to_level: "R1", to_path: 15, to_cam: 2, "door#": 1, "target_door#": 1 }),
    50,
    20,
  );
  const b = at(
    tlv("Door", { to_level: "R1", to_path: 15, to_cam: 1, "door#": 1, "target_door#": 1 }),
    450,
    20,
  );
  // same camera, but the target is the neighbor's door#, not its own
  const c = at(
    tlv("Door", { to_level: "R1", to_path: 15, to_cam: 1, "door#": 2, "target_door#": 3 }),
    60,
    120,
  );
  const e = at(
    tlv("Door", { to_level: "R1", to_path: 15, to_cam: 1, "door#": 3, "target_door#": 2 }),
    160,
    120,
  );
  // would resolve to itself, but the destination is another path: gate rejects
  const f = at(
    tlv("Door", { to_level: "R1", to_path: 16, to_cam: 1, "door#": 9, "target_door#": 9 }),
    250,
    120,
  );
  // dangling destination camera: the path-wide fallback lands on the door
  // itself, but that's unresolvable data, not a self-reference
  const g = at(
    tlv("Door", { to_level: "R1", to_path: 15, to_cam: 9, "door#": 4, "target_door#": 4 }),
    350,
    120,
  );
  const P = path(15, [a, b, c, e, f, g], cams, 2, 1);
  const D = dataset([level("R1", P)]);
  for (const t of [a, b, c, e, f, g]) assert.equal(isLoopback(t, D, { short: "R1" }, P), false);
});

// a two-camera destination path holding one door, for the trust tests
const AWAY = (doorNo) =>
  path(
    1,
    [at(tlv("Door", { "door#": doorNo }), 450, 20)],
    [
      { cell: 0, name: "R2P01C01" },
      { cell: 1, name: "R2P01C02" },
    ],
    2,
    1,
  );
const trustData = (doorNo) => dataset([level("R1", path(15, [])), level("R2", AWAY(doorNo))]);
const HOME = { short: "R1" };

test("destTrusted: a link naming no partner is trusted wherever it points", () => {
  const d = { lv: "ZZ", pa: 1, ca: null, target: null };
  assert.equal(destTrusted(d, trustData(1), HOME), true);
});

test("destTrusted: a cross-level partner must be at the destination", () => {
  const d = { lv: "R2", pa: 1, ca: 2, target: { name: "Door", field: "door#", value: 7 } };
  assert.equal(destTrusted(d, trustData(7), HOME), true);
  assert.equal(destTrusted(d, trustData(3), HOME), false);
  const gone = { ...d, pa: 9 }; // a path the game never shipped
  assert.equal(destTrusted(gone, trustData(7), HOME), false);
});

test("destTrusted: the address an unpointed side keeps corroborates nothing", () => {
  // a placeholder well sits at that address and answers to it
  const opener = (id, short) => ({
    ...level(short, path(1, [tlv("WellExpress", { "well#": 0 })], [{ cell: 0, name: "XXP01C01" }])),
    id,
  });
  const data = dataset([level("R1", path(15, [])), opener(1, "MI"), opener(2, "R2")]);
  const to = (lv) => ({ lv, pa: 1, ca: 1, target: { field: "well#", value: 0 } });
  assert.equal(destTrusted(to("MI"), data, HOME), false);
  // the same numbers are evidence once a field was set: Monsaic Lines rides to
  // Paramonia's first screen with an arrival well of 0
  assert.equal(destTrusted(to("R2"), data, HOME), true);
});

test("destTrusted: within a level the stated camera stands on its own", () => {
  // resolveTarget is camera-bounded, so an unresolved partner is no evidence
  const d = { lv: "R1", pa: 15, ca: 2, target: { name: "Door", field: "door#", value: 7 } };
  assert.equal(destTrusted(d, trustData(1), HOME), true);
  const gone = { ...d, pa: 9 };
  assert.equal(destTrusted(gone, trustData(1), HOME), false);
});

test("computeEntryPaths: a dead destination marks no arrival", () => {
  const phantom = (extra) => level("R1", path(15, [tlv("Door", extra)]));
  const away = (doorNo) => level("R2", AWAY(doorNo));
  const entries = (extra, doorNo) => computeEntryPaths(dataset([phantom(extra), away(doorNo)]));
  const link = { to_level: "R2", to_path: 1, to_cam: 2, "door#": 1, "target_door#": 7 };
  assert.deepEqual([...entries(link, 7).R2], [1]);
  assert.deepEqual(entries(link, 3), {}); // the partner isn't there
  assert.deepEqual(entries({ ...link, to_path: 9 }, 7), {}); // nor is the path
  assert.deepEqual(entries({ to_level: "ZZ", to_path: 1 }, 7), {}); // nor the level
});

test("computeEntryPaths: cross-level links and AbeStart mark entries", () => {
  const data = dataset([
    level(
      "R1",
      path(15, [
        tlv("AbeStart"),
        tlv("Door", { to_level: "R2", to_path: 1 }),
        tlv("Door", { to_level: "R1", to_path: 16 }), // same level: not an entry
        tlv("WellExpress", { alt_level: "L1", alt_path: 5 }),
      ]),
    ),
    level("R2", path(1, [])),
    level("L1", path(5, [])),
  ]);
  const entries = computeEntryPaths(data);
  assert.deepEqual([...entries.R1], [15]); // AbeStart only, not the same-level door
  assert.deepEqual([...entries.R2], [1]);
  assert.deepEqual([...entries.L1], [5]);
});

// two-camera stage shared by the connection-graph tests
const CONN_CAMS = [
  { cell: 0, name: "XXP15C01" },
  { cell: 1, name: "XXP15C02" },
];
const R1 = { short: "R1" };
const conn = (P, ...elsewhere) =>
  computeConnections(dataset([level("R1", P), ...elsewhere]), R1, P);

test("computeConnections: a mutual door pair consolidates to one two-way edge", () => {
  const a = at(
    tlv("Door", { to_level: "R1", to_path: 15, to_cam: 2, "door#": 1, "target_door#": 1 }),
    50,
    20,
  );
  const b = at(
    tlv("Door", { to_level: "R1", to_path: 15, to_cam: 1, "door#": 1, "target_door#": 1 }),
    450,
    20,
  );
  const P = path(15, [a, b, tlv("Slig")], CONN_CAMS, 2, 1);
  assert.deepEqual(conn(P), [{ src: a, dst: b, twoWay: true }]);
});

test("computeConnections: asymmetric chains stay directed", () => {
  // stacked double doors and teleporter cycles: A→B while B→C, never merged
  const a = at(
    tlv("Door", { to_level: "R1", to_path: 15, to_cam: 2, "door#": 1, "target_door#": 2 }),
    50,
    20,
  );
  const b = at(
    tlv("Door", { to_level: "R1", to_path: 15, to_cam: 1, "door#": 2, "target_door#": 3 }),
    450,
    20,
  );
  const c = at(tlv("Door", { "door#": 3 }), 60, 120); // no destination of its own
  const P = path(15, [a, b, c], CONN_CAMS, 2, 1);
  assert.deepEqual(conn(P), [
    { src: a, dst: b, twoWay: false },
    { src: b, dst: c, twoWay: false },
  ]);
});

test("computeConnections: mutual well pair by well# consolidates", () => {
  const a = at(
    tlv("WellExpress", {
      to_level: "R1",
      to_path: 15,
      to_cam: 2,
      "well#": 3,
      "target_well#": 5,
    }),
    50,
    20,
  );
  const b = at(
    tlv("WellExpress", {
      to_level: "R1",
      to_path: 15,
      to_cam: 1,
      "well#": 5,
      "target_well#": 3,
    }),
    450,
    20,
  );
  const P = path(15, [a, b], CONN_CAMS, 2, 1);
  assert.deepEqual(conn(P), [{ src: a, dst: b, twoWay: true }]);
});

test("computeConnections: loopbacks, views and self-resolvers yield nothing", () => {
  const loop = at(
    tlv("Door", { to_level: "R1", to_path: 15, to_cam: 1, "door#": 1, "target_door#": 1 }),
    50,
    20,
  );
  const stone = tlv("HandStone", { view1_cam: 1 }); // a sight, not a transition
  // dangling camera: the path-wide fallback resolves to the door itself
  const selfR = at(
    tlv("Door", { to_level: "R1", to_path: 15, to_cam: 9, "door#": 4, "target_door#": 4 }),
    450,
    20,
  );
  const P = path(15, [loop, stone, selfR], CONN_CAMS, 2, 1);
  assert.deepEqual(conn(P), []);
});

test("computeConnections: off-path destinations become labelled stubs", () => {
  const door = at(tlv("Door", { to_level: "R2", to_path: 1, to_cam: 3 }), 50, 20);
  const P = path(15, [door], CONN_CAMS, 2, 1);
  assert.deepEqual(conn(P, level("R2", path(1, []))), [{ src: door, label: "R2 P1" }]);
});

test("computeConnections: a cross-level destination without its partner draws nothing", () => {
  const door = at(
    tlv("Door", { to_level: "R2", to_path: 1, to_cam: 3, "door#": 1, "target_door#": 2 }),
    50,
    20,
  );
  const P = path(15, [door], CONN_CAMS, 2, 1);
  const away = (doorNo) =>
    path(1, [tlv("Door", { "door#": doorNo })], [{ cell: 0, name: "R2P01C03" }]);
  assert.deepEqual(conn(P, level("R2", away(9))), []);
  assert.deepEqual(conn(P, level("R2", away(2))), [{ src: door, label: "R2 P1" }]);
});

test("computeConnections: an untargeted same-path destination points at its camera", () => {
  const door = at(tlv("Door", { to_level: "R1", to_path: 15, to_cam: 2 }), 50, 20);
  const P = path(15, [door], CONN_CAMS, 2, 1);
  assert.deepEqual(conn(P), [{ src: door, cell: 1 }]);
  // the same destination naming a camera missing from the grid: nothing to draw
  const dangling = at(tlv("Door", { to_level: "R1", to_path: 15, to_cam: 9 }), 50, 20);
  const P2 = path(15, [dangling], CONN_CAMS, 2, 1);
  assert.deepEqual(conn(P2), []);
});

test("computeConnections: launcher wells don't arrow at their own camera", () => {
  // destOf strips a launcher's pairing and returns its own screen; the graph
  // must not reintroduce the self-reference as a camera edge
  const launcher = at(
    tlv("WellExpress", { to_level: "R1", to_path: 15, to_cam: 1, "well#": 3, "target_well#": 3 }),
    50,
    20,
  );
  const P = path(15, [launcher], CONN_CAMS, 2, 1);
  assert.deepEqual(conn(P), []);
});

test("zoomAt keeps the world point under the anchor fixed", () => {
  const cam = { x: 100, y: 50, z: 0.5 };
  const [px, py] = [200, 120];
  const out = zoomAt(cam, 1.25, px, py);
  assert.equal(out.z, 0.625);
  assert.ok(Math.abs(cam.x + px / cam.z - (out.x + px / out.z)) < 1e-9);
  assert.ok(Math.abs(cam.y + py / cam.z - (out.y + py / out.z)) < 1e-9);
});

test("the focus zoom fits a few screens and clamps at both ends", () => {
  // screens, not cells: the 200x100 window, so FOCUS_SCREENS 2.6 -> 520x260
  const zoom = (cw, ch) => focusZoom(cw, ch, SYNTH_GEOMETRY);
  assert.equal(zoom(1040, 520), 1.6); // large canvas: clamps at FOCUS_ZOOM_MAX
  assert.equal(zoom(260, 130), 0.5); // small canvas: clamps at FOCUS_ZOOM_MIN
  assert.equal(zoom(520, 260), 1); // in between: exactly FOCUS_SCREENS across
  // a jump to a point puts it at the middle of the canvas whichever zoom won
  assert.deepEqual(centerCam({ x: 500, y: 300, z: zoom(260, 130) }, 260, 130), {
    x: 240,
    y: 170,
    z: 0.5,
  });
});

test("zoomAt clamps to the manual zoom range", () => {
  assert.equal(zoomAt({ x: 0, y: 0, z: 3 }, 100, 0, 0).z, ZOOM_MAX);
  assert.equal(zoomAt({ x: 0, y: 0, z: 0.05 }, 0.001, 0, 0).z, ZOOM_MIN);
});

test("camCenter and centerCam invert each other", () => {
  const cam = { x: 100, y: 200, z: 1.25 };
  assert.deepEqual(camCenter(cam, 800, 600), { x: 420, y: 440, z: 1.25 });
  assert.deepEqual(centerCam(camCenter(cam, 800, 600), 800, 600), cam);
});

// a link read the way applyHash reads one: parsed, then resolved to draw space.
// The links here are written and read in AO's geometry, whose window offset and
// cell margins put draw space and world space far enough apart that a missing
// conversion shows
const readHash = (h) => {
  const p = parseHash(h);
  return p && { ...p, ...hashToDraw(p, AO_GEOMETRY) };
};

test("a permalinked center survives a change of viewport, a corner would not", () => {
  const desktop = [1512, 900],
    phone = [390, 700];
  const cam = { x: 0, y: 0, z: 1.29 }; // whatever the sender was looking at
  const link = formatHash(AO_GEOMETRY, "AO", "R2", 1, camCenter(cam, ...desktop));
  assert.equal(link, "#AO/R2/1/1498/709/1.29"); // the middle of the sender's window
  // holding that center costs the recipient a different corner, by half the
  // difference in window size — more than a 368-unit cell horizontally, which
  // is what a link carrying the corner would misplace them by instead
  const got = centerCam(readHash(link).view, ...phone);
  assert.equal(Math.round(got.x - cam.x), 435);
  assert.equal(Math.round(got.y - cam.y), 78);
});

test("formatHash writes world coordinates, rounded, and zoom to two decimals", () => {
  // draw (177.4, 54.6) sits in cell 0, whose window starts at world (256, 120)
  assert.equal(
    formatHash(AO_GEOMETRY, "AO", "R2", 1, { x: 177.4, y: 54.6, z: 2.234 }),
    "#AO/R2/1/433/175/2.23",
  );
});

test("an unreadable or non-positive zoom drops the whole view", () => {
  assert.equal(parseHash("#AO/R2/1/10/20/junk").view, null);
  assert.equal(parseHash("#AO/R2/1/10/junk/1.00").view, null);
  assert.equal(parseHash("#AO/R2/1/10/20/0").view, null);
  assert.deepEqual(parseHash("#AO/R2/1/10/20/0.50").view, { x: 10, y: 20, z: 0.5 });
});

test("parseHash round-trips a formatted hash (against the rounded values)", () => {
  const p = parseHash(formatHash(AO_GEOMETRY, "AO", "R2", 1, { x: 177.4, y: 54.6, z: 2.234 }));
  assert.deepEqual(p, {
    game: "AO",
    level: "R2",
    path: 1,
    view: { x: 433, y: 175, z: 2.23 },
    obj: null,
    route: null,
    routeLost: 0,
    graph: false,
  });
  // the world point the link names, back in the space the renderer works in
  assert.deepEqual(hashToDraw(p, AO_GEOMETRY).view, { x: 177, y: 55, z: 2.23 });
});

// deliberately a bare word at the tail, where an older viewer's parse ignores it
// and opens the map at the view the link names
test("the world graph rides the hash as a token of its own", () => {
  const h = formatHash(
    AO_GEOMETRY,
    "AO",
    "R2",
    1,
    { x: 177.4, y: 54.6, z: 2.234 },
    null,
    null,
    true,
  );
  assert.equal(h, "#AO/R2/1/433/175/2.23/graph");
  assert.equal(parseHash(h).graph, true);
  assert.equal(parseHash("#AO/R2/1/433/175/2.23").graph, false);
});

test("permalinks can carry an object, identified by name and origin", () => {
  const h = formatHash(
    AO_GEOMETRY,
    "AO",
    "R1",
    18,
    { x: 177.4, y: 54.6, z: 2.234 },
    { name: "Door", x1: 8746, y1: 1232 },
  );
  assert.equal(h, "#AO/R1/18/433/175/2.23/Door@8746,1232");
  assert.deepEqual(parseHash(h).obj, { name: "Door", x1: 8746, y1: 1232 });
  assert.equal(parseHash("#AO/R1/18/433/175/2.23").obj, null);
  assert.equal(parseHash("#AO/R1/18/433/175/2.23/garbage!").obj, null);
});

test("parseHash: case-insensitive, partial and garbage inputs", () => {
  assert.equal(parseHash(""), null);
  assert.equal(parseHash("#"), null);
  assert.deepEqual(parseHash("#ao/r2/1"), {
    game: "AO",
    level: "R2",
    path: 1,
    view: null,
    obj: null,
    route: null,
    routeLost: 0,
    graph: false,
  });
  assert.deepEqual(parseHash("#AO"), {
    game: "AO",
    level: "",
    path: NaN,
    view: null,
    obj: null,
    route: null,
    routeLost: 0,
    graph: false,
  });
  // x/y without z: the view is ignored as a whole
  assert.deepEqual(parseHash("#AO/R2/1/10/20"), {
    game: "AO",
    level: "R2",
    path: 1,
    view: null,
    obj: null,
    route: null,
    routeLost: 0,
    graph: false,
  });
  assert.ok(Number.isNaN(parseHash("#AO/R2/junk").path));
});

test("a permalinked object is found by name and origin, whatever its capitals", () => {
  const tlvs = [at(tlv("Door"), 100, 200), at(tlv("Mudokon"), 479, 1735)];
  const find = (name, x1, y1) => findTlv(tlvs, { name, x1, y1 });
  assert.equal(find("Mudokon", 479, 1735), tlvs[1]);
  assert.equal(find("mudokon", 479, 1735), tlvs[1]); // a link put through a lowercaser
  assert.equal(find("Mudokon", 479, 1736), null); // the object moved in a rebuild
  assert.equal(find("Door", 479, 1735), null); // something else stands there now
});

test("a percent-encoded fragment is read the same as a bare one", () => {
  const h = "#AO/R6/6/-329/568/1.60/Mudokon@479,1735/route=n2;sR6.6;620,411;563,472;end";
  assert.deepEqual(parseHash("#" + encodeURIComponent(h.slice(1))), parseHash(h));
  // a stray % that isn't an escape must not throw the whole link away
  assert.deepEqual(parseHash("#AO/R2/1/10/20/1.00/100%").view, { x: 10, y: 20, z: 1 });
});

test("permalinks can carry a route of waypoints, rounded like the view", () => {
  const route = [
    {
      lv: "R2",
      pa: 1,
      pts: [
        { x: 10.4, y: 21.6 },
        { x: -30, y: 40 },
      ],
    },
  ];
  const h = formatHash(AO_GEOMETRY, "AO", "R2", 1, { x: 177.4, y: 54.6, z: 2.234 }, null, route);
  assert.equal(h, "#AO/R2/1/433/175/2.23/route=n2;sR2.1;266,142;-430,160;end");
  assert.deepEqual(readHash(h).route, [
    {
      lv: "R2",
      pa: 1,
      pts: [
        { x: 10, y: 22 },
        { x: -30, y: 40 },
      ],
    },
  ]);
  assert.equal(parseHash(h).routeLost, 0);
  assert.equal(
    formatHash(AO_GEOMETRY, "AO", "R2", 1, { x: 0, y: 0, z: 1 }, null, []),
    "#AO/R2/1/256/120/1.00",
  );
});

test("object and route segments coexist, matched by shape in either order", () => {
  const obj = { name: "Door", x1: 8746, y1: 1232 };
  const one = [{ lv: "R1", pa: 18, pts: [{ x: 1, y: 2 }] }];
  const h = formatHash(AO_GEOMETRY, "AO", "R1", 18, { x: 0, y: 0, z: 1 }, obj, one);
  assert.equal(h, "#AO/R1/18/256/120/1.00/Door@8746,1232/route=n1;sR1.18;257,122;end");
  assert.deepEqual(parseHash(h).obj, obj);
  assert.deepEqual(readHash(h).route, one);
  const swapped = readHash("#AO/R1/18/256/120/1.00/route=n1;sR1.18;257,122;end/Door@8746,1232");
  assert.deepEqual(swapped.obj, obj);
  assert.deepEqual(swapped.route, one);
  // an unknown segment in between bothers neither
  const padded = readHash("#AO/R1/18/256/120/1.00/garbage!/route=n1;sR1.18;257,122;end");
  assert.equal(padded.obj, null);
  assert.deepEqual(padded.route, one);
});

test("route segment is all-or-nothing: any malformed token drops the whole route", () => {
  const at = (seg) => parseHash(`#AO/R2/1/0/0/1.00/${seg}`).route;
  assert.equal(at("route="), null);
  assert.equal(at("route=n2;sR2.1;1,2;junk;end"), null);
  assert.equal(at("route=n1;sR2.1;1.5,2;end"), null);
  assert.equal(at("route=n3;sR2.1;1,2;;3,4;end"), null);
  assert.equal(at("route=sR2.1;1,2;end"), null); // nothing leading the body
  assert.equal(at("route=2;sR2.1;1,2;end"), null); // a bare number is not the count
  assert.equal(at("route=n0;sR2.1;end"), null); // a count with nothing to count
  // a pathless body — pairs before any segment marker — reads as no route
  assert.equal(at("route=n1;1,2;end"), null);
  assert.deepEqual(at("route=n1;sR2.1;1,2;end"), [{ lv: "R2", pa: 1, pts: [{ x: 1, y: 2 }] }]);
  const pairs = (n) => Array.from({ length: n }, (_, i) => `${i},${i}`).join(";");
  assert.equal(
    at(`route=n${MAX_ROUTE_PTS};sR2.1;${pairs(MAX_ROUTE_PTS)};end`)[0].pts.length,
    MAX_ROUTE_PTS,
  );
  assert.equal(at(`route=n${MAX_ROUTE_PTS + 1};sR2.1;${pairs(MAX_ROUTE_PTS + 1)};end`), null);
});

test("a route link cut short keeps the waypoints that arrived and counts the rest", () => {
  const at = (seg) => parseHash(`#AO/R2/1/0/0/1.00/${seg}`);
  const seg1 = (pts) => [{ lv: "R2", pa: 1, pts }];
  const three = "route=n3;sR2.1;1,2;3,4;5,6";
  // only the marker lost: every pair before it is whole
  assert.deepEqual(
    at(`${three};en`).route,
    seg1([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ]),
  );
  assert.equal(at(`${three};en`).routeLost, 0);
  // a cut inside the last pair leaves one that still reads as legal: unread
  assert.deepEqual(
    at(three).route,
    seg1([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]),
  );
  assert.equal(at(three).routeLost, 1);
  assert.deepEqual(
    at("route=n9;sR2.1;1,2;3,4;5,").route,
    seg1([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]),
  );
  assert.equal(at("route=n9;sR2.1;1,2;3,4;5,").routeLost, 7);
  // the marker vouches for the count, so one that disagrees is a hand edit
  assert.equal(at("route=n2;sR2.1;1,2;3,4;5,6;end").route, null);
  assert.equal(at("route=n4;sR2.1;1,2;3,4;5,6;end").route, null);
  // more pairs than the count claims, marker or not
  assert.equal(at("route=n1;sR2.1;1,2;3,4;5,6").route, null);
  // cut down to the head alone: a smaller count with nothing under it
  assert.equal(at("route=n1").route, null);
  assert.equal(at("route=n1").routeLost, 0);
});

// a link cut short by a chat client can still read as a well-formed route:
// "…;405,578" truncated to "…;405,57" is a valid pair, and "…;129,586" cut to
// "…;12" arrives after exactly twelve pairs. What the reader is shown must
// therefore be a leading stretch of what the sender plotted, never a leg they
// never clicked, and the tally must square with the count the link leads with.
test("every prefix of a route link parses as a prefix of the route, or as none", () => {
  const pts =
    "620,411;563,472;602,585;522,578;505,681;398,688;350,680;256,676;182,676;110,684;61,684;60,578;129,586;222,583;294,583;405,578"
      .split(";")
      .map((p) => ({ x: +p.split(",")[0], y: +p.split(",")[1] }));
  const route = [{ lv: "R6", pa: 6, pts }];
  const full = formatHash(AO_GEOMETRY, "AO", "R6", 6, { x: -120, y: 226, z: 1.29 }, null, route);
  assert.deepEqual(readHash(full).route, route);
  assert.equal(parseHash(full).routeLost, 0);
  for (let cut = full.indexOf("route=") + 6; cut < full.length; cut++) {
    const { route: got, routeLost: lost } = readHash(full.slice(0, cut));
    const where = `prefix of length ${cut}`;
    if (!got) {
      assert.equal(lost, 0, `${where} claims losses with nothing to show`);
      continue;
    }
    assert.equal(got.length, 1, `${where} invented a segment`);
    assert.deepEqual(got[0].pts, pts.slice(0, got[0].pts.length), `${where} altered the route`);
    assert.equal(got[0].pts.length + lost, pts.length, `${where} miscounted what it lost`);
  }
});

test("a multi-path route round-trips, and a seam can stand empty", () => {
  const route = [
    {
      lv: "R1",
      pa: 15,
      pts: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    },
    { lv: "R1", pa: 16, pts: [{ x: 5, y: 6 }] },
    { lv: "BA", pa: 2, pts: [] },
  ];
  const h = formatHash(AO_GEOMETRY, "AO", "R1", 16, { x: 0, y: 0, z: 1 }, null, route);
  assert.equal(
    h,
    "#AO/R1/16/256/120/1.00/route=n3;sR1.15;257,122;259,124;sR1.16;261,126;sBA.2;end",
  );
  assert.deepEqual(readHash(h).route, route);
  assert.equal(parseHash(h).routeLost, 0);
  // codes read back uppercased, the way the game and level codes do
  assert.deepEqual(readHash(h.toLowerCase()).route, route);
});

test("malformed bodies drop the route whole; cuts keep the prefix", () => {
  const at = (seg) => parseHash(`#AO/R2/1/0/0/1.00/${seg}`);
  assert.equal(at("route=n2;1,2;3,4;end").route, null); // a pair before any segment
  assert.equal(at("route=n2;sR1.15;1,2;junk;3,4;end").route, null);
  assert.equal(at("route=n1;sR1.15;1,2;3,4;end").route, null); // more than the count
  const full = "route=n3;sR1.15;1,2;3,4;sBA.2;5,6";
  assert.deepEqual(at(`${full};end`).route, [
    {
      lv: "R1",
      pa: 15,
      pts: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    },
    { lv: "BA", pa: 2, pts: [{ x: 5, y: 6 }] },
  ]);
  // the cut drops the unproven last pair; the opened segment survives, empty
  assert.deepEqual(at(full).route, [
    {
      lv: "R1",
      pa: 15,
      pts: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    },
    { lv: "BA", pa: 2, pts: [] },
  ]);
  assert.equal(at(full).routeLost, 1);
});

test("every prefix of a multi-path route link parses as a prefix of it, or as none", () => {
  const route = [
    {
      lv: "R6",
      pa: 6,
      pts: [
        { x: 620, y: 411 },
        { x: 563, y: 472 },
        { x: 602, y: 585 },
      ],
    },
    {
      lv: "R1",
      pa: 15,
      pts: [
        { x: 129, y: 586 },
        { x: 222, y: 583 },
      ],
    },
    {
      lv: "BA",
      pa: 2,
      pts: [
        { x: 405, y: 578 },
        { x: 12, y: 9 },
      ],
    },
  ];
  const total = 7;
  const full = formatHash(AO_GEOMETRY, "AO", "BA", 2, { x: -120, y: 226, z: 1.29 }, null, route);
  assert.deepEqual(readHash(full).route, route);
  for (let cut = full.indexOf("route=") + 6; cut < full.length; cut++) {
    const { route: got, routeLost: lost } = readHash(full.slice(0, cut));
    const where = `prefix of length ${cut}`;
    if (!got) {
      assert.equal(lost, 0, `${where} claims losses with nothing to show`);
      continue;
    }
    const n = got.reduce((k, s) => k + s.pts.length, 0);
    assert.equal(n + lost, total, `${where} miscounted what it lost`);
    for (let i = 0; i < got.length; i++) {
      assert.equal(
        `${got[i].lv} ${got[i].pa}`,
        `${route[i].lv} ${route[i].pa}`,
        `${where} invented a seam`,
      );
      const expect = i < got.length - 1 ? route[i].pts : route[i].pts.slice(0, got[i].pts.length);
      assert.deepEqual(got[i].pts, expect, `${where} altered segment ${i}`);
    }
  }
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

test("a segment always names its path, so undo across a seam cannot rebind it", () => {
  // undo across a seam leaves exactly this: the route on R1 P15, you on P16
  const route = [{ lv: "R1", pa: 15, pts: [{ x: 1, y: 2 }] }];
  const h = formatHash(AO_GEOMETRY, "AO", "R1", 16, { x: 0, y: 0, z: 1 }, null, route);
  assert.equal(h, "#AO/R1/16/256/120/1.00/route=n1;sR1.15;257,122;end");
  assert.deepEqual(readHash(h).route, route);
});

test("the route token refuses a marker flood", () => {
  const markers = Array.from({ length: MAX_ROUTE_PTS + 1 }, () => "sR1.1").join(";");
  assert.equal(parseHash(`#AO/R2/1/0/0/1.00/route=n1;${markers};1,2;end`).route, null);
});
