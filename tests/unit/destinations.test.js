import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEntryPaths,
  destOf,
  destTrusted,
  isLoopback,
  resolveTarget,
  wayThrough,
} from "../../public/js/model/model.js";
import { SYNTH_GEOMETRY, at, dataset, level, path, tlv } from "./fixtures.js";

// the dataset destOf looks a destination's partner up in, with the level and
// path it stands on. The dataset holds nothing but that path, and the path
// holds no objects, so no destination can land on a partner here
const HERE_PATH = path(15, [], [{ cell: 0, name: "XXP15C01" }], 1, 1);
const HERE = [dataset([level("R1", HERE_PATH)]), { short: "R1" }, HERE_PATH];

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
