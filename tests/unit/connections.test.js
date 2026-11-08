import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeConnections } from "../../public/js/model.js";
import { at, dataset, level, path, tlv } from "./fixtures.js";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));

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

test("computeConnections: a path transition's stub points out of its screen", () => {
  const away = level("R2", path(1, []));
  // in its own screen's slack, left of the window
  const left = at(tlv("PathTransition", { to_level: "R2", to_path: 1 }), 10, 60);
  const P = path(15, [left], CONN_CAMS, 2, 1);
  assert.deepEqual(conn(P, away), [{ src: left, label: "R2 P1", dir: [-1, 0] }]);
  // in an empty cell under the path's one camera, which is then the screen it leaves
  const below = at(tlv("PathTransition", { to_level: "R2", to_path: 1 }), 135, 205);
  const P2 = path(15, [below], [CONN_CAMS[0]], 1, 2);
  assert.deepEqual(conn(P2, away), [{ src: below, label: "R2 P1", dir: [0, 1] }]);
});

// the shipped transitions by the way their stubs point, so a geometry change
// shows: an Oddysee transition sits in its screen's slack on the side it leads
// to, an Exoddus one in the empty cell beside its screen
test("computeConnections: the shipped path transitions point out of their screens", () => {
  const name = ([dx, dy]) => (dx < 0 ? "left" : dx > 0 ? "right" : dy < 0 ? "up" : "down");
  const found = {};
  const where = {};
  for (const file of ["map_data_ao.json", "map_data_ae.json"]) {
    const data = load(file);
    const counts = { left: 0, right: 0, up: 0, down: 0 };
    for (const L of data.levels)
      for (const P of L.paths)
        for (const e of computeConnections(data, L, P)) {
          if (e.label === undefined) continue;
          const id = `${L.short} P${P.id} ${e.src.name} -> ${e.label}`;
          assert.equal("dir" in e, e.src.name === "PathTransition", id);
          if (!e.dir) continue;
          counts[name(e.dir)]++;
          (where[`${L.short} P${P.id} -> ${e.label}`] ??= []).push(name(e.dir));
        }
    found[data.id] = counts;
  }
  assert.deepEqual(found, {
    AO: { left: 27, right: 24, up: 3, down: 1 },
    AE: { left: 0, right: 2, up: 0, down: 1 },
  });
  assert.deepEqual(where["R1 P18 -> R1 P16"], ["left"]); // the slack left of its screen
  assert.deepEqual(where["E1 P4 -> L1 P1"], ["down"]); // the slack under its screen
  assert.deepEqual(where["MI P3 -> MI P4"], ["right"]); // the empty cell right of its screen
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
