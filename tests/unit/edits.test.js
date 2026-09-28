// The edit model: a delta never touches a fetched object, a path with deltas
// stands as a new object over the pristine one, a path whose deltas are gone
// stands as the pristine object itself, and every swap re-points the selection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { state } from "../../public/js/state.js";
import { setFieldTypes, setEnumLabels } from "../../public/js/fields.js";
import { pathVisible, revealPath } from "../../public/js/pathvisible.js";
import { deriveExtra } from "../../public/js/extra.js";
import { exportPath, canonical } from "../../public/js/reliveexport.js";
import {
  applyFieldEdit,
  applyStoredEdits,
  canRedo,
  canUndo,
  currentOf,
  editedFields,
  forgetAll,
  gameEdits,
  hasStoredEdits,
  materializePath,
  objectKeys,
  pathEdited,
  pristineOf,
  redoEdit,
  editStore,
  restoreEdits,
  revertPath,
  sanitizeEdits,
  undoEdit,
  setEnabled,
  setLevelShort,
  takeReport,
  validDelta,
} from "../../public/js/edits.js";
import { AE_GEOMETRY } from "./fixtures.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), "utf8"));

const SHORT = { 0: "ST", 1: "MI", 2: "NE" };
setLevelShort("AE", SHORT);
// one typed field, so the label guard has something to refuse
setFieldTypes({ AE: { Door: { door_type: "DoorTypes" } } });
setEnumLabels({ AE: { DoorTypes: { 0: "normal", 1: "hub" } } });

const DOOR = {
  level: 1,
  path: 1,
  camera: 17,
  scale: 0,
  door_number: 1,
  switch_id: 0,
  target_door_id: 0,
  door_type: 0,
};
const door = (x1, y1, f = {}) => {
  const t = { t: 5, name: "Door", x1, y1, x2: x1 + 24, y2: y1 + 24, fields: { ...DOOR, ...f } };
  return { ...t, extra: deriveExtra("AE", t, SHORT) };
};
const plain = (name, x1, y1) => ({ t: 1, name, x1, y1, x2: x1 + 10, y2: y1 + 10, extra: {} });

// a two-path Exoddus level shaped like the map data, the second path a demo copy
function world() {
  const p1 = {
    id: 1,
    w: 2,
    h: 1,
    cams: [],
    tlvs: [door(10, 10), door(400, 10, { door_number: 2 }), plain("Hoist", 50, 50)],
    lines: [],
  };
  const p2 = {
    id: 2,
    w: 1,
    h: 1,
    cams: [],
    tlvs: [plain("DemoSpawnPoint", 0, 0), door(20, 20)],
    lines: [],
  };
  return {
    id: "AE",
    game: "Abe's Exoddus",
    geometry: AE_GEOMETRY,
    levels: [{ id: 1, short: "MI", name: "Mines", paths: [p1, p2] }],
  };
}
function stand(G, pa = 1) {
  state.games = [G];
  state.data = G;
  state.lvl = G.levels[0];
  state.path = G.levels[0].paths.find((P) => P.id === pa);
  state.sel = null;
}

test("a path without deltas materializes as itself", () => {
  const P = world().levels[0].paths[0];
  assert.equal(materializePath("AE", P, undefined), P);
  assert.equal(materializePath("AE", P, { objects: { "Door@10,10": { fields: {} } } }), P);
  assert.equal(pathEdited(P), false);
});

test("an edit stands as a new path whose other objects keep their identity", () => {
  const G = world();
  const [L0] = G.levels,
    P1 = L0.paths[0],
    d = P1.tlvs[0];
  stand(G);
  const n = applyFieldEdit(d, "camera", 18);
  assert.notEqual(n, d);
  assert.equal(n.fields.camera, 18);
  assert.equal(n.extra.to_cam, 18); // the bucket follows the archive
  assert.equal(d.fields.camera, 17); // the fetched object is untouched
  assert.notEqual(state.path, P1);
  assert.equal(state.path.tlvs[0], n);
  assert.equal(state.path.tlvs[1], P1.tlvs[1]);
  assert.equal(state.path.tlvs[2], P1.tlvs[2]);
  assert.notEqual(state.lvl, L0);
  assert.equal(G.levels[0], state.lvl);
  assert.equal(state.lvl.paths[1], L0.paths[1]); // the untouched path by identity too
  assert.deepEqual(editedFields(n), { camera: 18 });
  assert.deepEqual(editedFields(d), {});
  assert.equal(pristineOf(n), d);
  assert.equal(currentOf(d), n);
  assert.ok(pathEdited(state.path));
  assert.deepEqual(gameEdits("AE"), { objects: 1, paths: 1 });
  for (const k of Object.keys(n.extra)) assert.ok(!(k in n.fields), k);
  // a second edit to the same object stands the path anew, its fields following
  const after = state.path;
  const n2 = applyFieldEdit(n, "door_number", 2);
  assert.notEqual(state.path, after);
  assert.equal(n2.fields.door_number, 2);
  assert.equal(n2.fields.camera, 18);
  assert.deepEqual(editedFields(n2), { camera: 18, door_number: 2 });
  assert.equal(applyFieldEdit(n2, "door_number", 1).fields.camera, 18);
  // the shipped value takes the delta away and the pristine objects come back
  assert.equal(applyFieldEdit(n, "camera", 17), d);
  assert.equal(state.path, P1);
  assert.equal(state.lvl, L0);
  assert.equal(G.levels[0], L0);
  assert.deepEqual(gameEdits("AE"), { objects: 0, paths: 0 });
});

test("a second edit on another path keeps the first path standing as it is", () => {
  const G = world();
  const [L0] = G.levels;
  stand(G);
  applyFieldEdit(state.path.tlvs[0], "camera", 18);
  const edited1 = state.path;
  stand(G, 2);
  applyFieldEdit(state.path.tlvs[1], "camera", 19);
  assert.equal(state.lvl.paths[0], edited1);
  assert.equal(state.lvl.paths[1].tlvs[1].fields.camera, 19);
  forgetAll();
  assert.deepEqual(gameEdits("AE"), { objects: 0, paths: 0 });
  assert.equal(G.levels[0], L0);
  assert.equal(pathEdited(L0.paths[0]), false);
});

test("every swap re-points the selection, and a revert swaps the pristine objects back", () => {
  const G = world();
  const [L0] = G.levels,
    P1 = L0.paths[0],
    d = P1.tlvs[0];
  stand(G);
  state.sel = d;
  const n = applyFieldEdit(d, "camera", 18);
  assert.equal(state.sel, n);
  revertPath("AE", "MI", 1);
  assert.equal(state.sel, d);
  assert.equal(state.path, P1);
  assert.equal(G.levels[0], L0);
  assert.equal(pathEdited(state.path), false);
});

test("a demo path's reveal survives the swap in both directions", () => {
  const G = world();
  const P2 = G.levels[0].paths[1];
  assert.equal(pathVisible(P2), false);
  revealPath(P2);
  stand(G, 2);
  applyFieldEdit(state.path.tlvs[1], "camera", 3);
  assert.notEqual(state.path, P2);
  assert.ok(pathVisible(state.path));
  revertPath("AE", "MI", 2);
  assert.equal(state.path, P2);
  assert.ok(pathVisible(P2));
});

test("one guard decides a delta: the field, the word's range and the labels", () => {
  const d = world().levels[0].paths[0].tlvs[0];
  assert.ok(validDelta("AE", d, "camera", 5));
  assert.ok(validDelta("AE", d, "camera", -32768));
  assert.ok(validDelta("AE", d, "door_type", 1));
  assert.equal(validDelta("AE", d, "camera", 40000), false);
  assert.equal(validDelta("AE", d, "camera", 1.5), false);
  assert.equal(validDelta("AE", d, "camera", "5"), false);
  assert.equal(validDelta("AE", d, "no_such_field", 1), false);
  assert.equal(validDelta("AE", d, "door_type", 9), false); // typed, and nothing labels 9
  assert.equal(validDelta("AE", plain("Hoist", 0, 0), "camera", 1), false); // no archive at all
  // the value that shipped passes whatever the labels say: the way back is never refused
  const unlabelled = door(10, 10, { door_type: 9 });
  assert.ok(validDelta("AE", unlabelled, "door_type", 9));
  assert.equal(validDelta("AE", unlabelled, "door_type", 8), false);
  const G = world();
  stand(G);
  assert.throws(() => applyFieldEdit(G.levels[0].paths[0].tlvs[0], "door_type", 9), /not a value/);
  assert.throws(
    () => applyFieldEdit(G.levels[0].paths[0].tlvs[0], "camera", 1, { game: "AO" }),
    /level map/,
  );
  assert.equal(G.levels[0], state.lvl); // nothing swapped
});

test("objects with one origin are told apart by their order", () => {
  const P = { id: 1, tlvs: [door(10, 10), door(400, 10), door(10, 10, { door_number: 7 })] };
  assert.deepEqual([...objectKeys(P).values()], ["Door@10,10#1", "Door@400,10", "Door@10,10#2"]);
});

test("stored deltas apply where they still answer to an object and are dropped where they do not", () => {
  restoreEdits({
    AE: {
      "MI/1": {
        objects: {
          "Door@10,10": { fields: { camera: 20, no_such: 1, door_type: 9 } },
          "Door@400,10": { fields: { camera: 17 } }, // what the disc now ships
          "Door@999,999": { fields: { camera: 1 } },
        },
      },
    },
  });
  assert.ok(hasStoredEdits("AE"));
  setEnabled(false);
  assert.equal(hasStoredEdits("AE"), false);
  setEnabled(true);
  const G = world();
  const P1 = G.levels[0].paths[0];
  assert.deepEqual(applyStoredEdits(G), { applied: 1, dropped: 4 });
  assert.deepEqual(takeReport("AE"), { applied: 1, dropped: 4, unapplied: 0 });
  assert.equal(editStore().AE["MI/1"].objects["Door@400,10"], undefined);
  assert.equal(takeReport("AE"), null);
  assert.notEqual(G.levels[0].paths[0], P1);
  assert.equal(G.levels[0].paths[0].tlvs[0].fields.camera, 20);
  assert.equal(P1.tlvs[0].fields.camera, 17);
  assert.deepEqual(gameEdits("AE"), { objects: 1, paths: 1 });
  restoreEdits({});
  assert.equal(hasStoredEdits("AE"), false);
});

test("the stored shape is read by shape alone, and anything else in it is dropped", () => {
  assert.deepEqual(sanitizeEdits(null), {});
  assert.deepEqual(sanitizeEdits("{not json"), {});
  assert.deepEqual(sanitizeEdits('"a string"'), {});
  assert.deepEqual(sanitizeEdits("[]"), {});
  const kept = {
    AE: { "MI/1": { objects: { "Door@10,10#2": { fields: { camera: 20, scale: -1 } } } } },
  };
  assert.deepEqual(sanitizeEdits(JSON.stringify(kept)), kept);
  const noisy = {
    AE: {
      "MI/1": {
        objects: {
          "Door@10,10": { fields: { camera: 20, bad: 1.5, big: 40000, word: "x" } },
          "not a key": { fields: { camera: 1 } },
          "Zone@0,0": { fields: {} },
        },
      },
      "mi/x": { objects: { "Door@1,1": { fields: { camera: 1 } } } },
      "NE/2": "junk",
    },
    ao: { "R1/1": { objects: { "Door@1,1": { fields: { camera: 1 } } } } },
    AO: null,
  };
  assert.deepEqual(sanitizeEdits(JSON.stringify(noisy)), {
    AE: { "MI/1": { objects: { "Door@10,10": { fields: { camera: 20 } } } } },
  });
});

test("a step undoes to the pristine path itself and redoes to the edit, a new step clearing the redo", () => {
  restoreEdits({});
  const G = world();
  const [L0] = G.levels,
    P1 = L0.paths[0],
    d = P1.tlvs[0];
  stand(G);
  const n = applyFieldEdit(d, "camera", 18);
  assert.ok(canUndo("AE", "MI", 1));
  assert.equal(canRedo("AE", "MI", 1), false);
  assert.ok(undoEdit("AE", "MI", 1));
  assert.equal(state.path, P1);
  assert.equal(state.lvl, L0);
  assert.equal(pathEdited(P1), false);
  assert.equal(canUndo("AE", "MI", 1), false);
  assert.ok(canRedo("AE", "MI", 1));
  assert.ok(redoEdit("AE", "MI", 1));
  assert.notEqual(state.path, P1);
  assert.equal(state.path.tlvs[0].fields.camera, 18);
  assert.equal(state.path.tlvs[0].extra.to_cam, 18);
  assert.equal(pristineOf(state.path.tlvs[0]), pristineOf(n));
  undoEdit("AE", "MI", 1);
  applyFieldEdit(d, "camera", 19); // a new step after an undo
  assert.equal(canRedo("AE", "MI", 1), false);
  assert.equal(state.path.tlvs[0].fields.camera, 19);
  // an edit to the value already standing is no step and no swap
  const before = state.path;
  applyFieldEdit(state.path.tlvs[0], "camera", 19);
  assert.equal(state.path, before);
  undoEdit("AE", "MI", 1);
  assert.equal(state.path, P1);
  assert.equal(undoEdit("AE", "MI", 1), false);
  assert.equal(state.path, P1);
});

test("a snapshot is the entry as it stood: the step after it cannot reach back", () => {
  restoreEdits({});
  const G = world();
  const P1 = G.levels[0].paths[0];
  stand(G);
  applyFieldEdit(P1.tlvs[0], "camera", 18);
  const first = state.path;
  applyFieldEdit(P1.tlvs[0], "door_number", 5); // writes into the same live delta
  assert.notEqual(state.path, first); // a second edit to the object stands the path anew
  assert.deepEqual(editedFields(state.path.tlvs[0]), { camera: 18, door_number: 5 });
  assert.equal(state.path.tlvs[0].fields.door_number, 5);
  assert.equal(state.path.tlvs[0].fields.camera, 18);
  assert.deepEqual(editedFields(first.tlvs[0]), { camera: 18 }); // the earlier materialization keeps its own
  undoEdit("AE", "MI", 1);
  assert.deepEqual(editedFields(state.path.tlvs[0]), { camera: 18 });
  assert.equal(state.path.tlvs[0].fields.door_number, 1);
  undoEdit("AE", "MI", 1);
  assert.equal(state.path, P1);
});

test("a revert is one step: an undo brings every delta back, a redo reverts again", () => {
  restoreEdits({});
  const G = world();
  const P1 = G.levels[0].paths[0];
  stand(G);
  applyFieldEdit(P1.tlvs[0], "camera", 18);
  applyFieldEdit(P1.tlvs[1], "camera", 3);
  revertPath("AE", "MI", 1);
  assert.equal(state.path, P1);
  assert.ok(undoEdit("AE", "MI", 1));
  assert.equal(state.path.tlvs[0].fields.camera, 18);
  assert.equal(state.path.tlvs[1].fields.camera, 3);
  assert.ok(redoEdit("AE", "MI", 1));
  assert.equal(state.path, P1);
  revertPath("AE", "MI", 1); // a revert of nothing is not a step
  assert.equal(canUndo("AE", "MI", 1), true);
  assert.equal(canRedo("AE", "MI", 1), false);
});

test("each path keeps its own trail, and forgetting all empties every one", () => {
  restoreEdits({});
  const G = world();
  const [L0] = G.levels;
  stand(G);
  applyFieldEdit(L0.paths[0].tlvs[0], "camera", 18);
  stand(G, 2);
  applyFieldEdit(state.path.tlvs[1], "camera", 3);
  assert.equal(undoEdit("AE", "MI", 1), true);
  assert.equal(state.lvl.paths[0], L0.paths[0]);
  assert.equal(state.lvl.paths[1].tlvs[1].fields.camera, 3);
  assert.equal(undoEdit("AE", "NE", 9), false); // no trail, no swap
  assert.ok(canUndo("AE", "MI", 2));
  forgetAll();
  assert.equal(canUndo("AE", "MI", 1) || canRedo("AE", "MI", 1) || canUndo("AE", "MI", 2), false);
  assert.equal(G.levels[0], L0);
});

test("on the shipped data an edited export carries the edit and the reverted one hashes to the fixture", () => {
  const G = load("map_data_ae.json"),
    side = load("relive_export_ae.json");
  const digests = JSON.parse(
    readFileSync(new URL("../fixtures/relive-digests.json", import.meta.url), "utf8"),
  );
  setLevelShort("AE", side.level_short);
  const L = G.levels.find((l) => l.short === "MI"),
    P = L.paths.find((p) => p.id === 1);
  state.games = [G];
  state.data = G;
  state.lvl = L;
  state.path = P;
  const d = P.tlvs.find((t) => t.name === "Door");
  const n = applyFieldEdit(d, "camera", d.fields.camera + 1);
  const at = (doc) =>
    doc.map.cameras
      .flatMap((c) => c.map_objects)
      .find(
        (o) =>
          o.object_structures_type === "Door" &&
          o.properties.xpos === d.x1 &&
          o.properties.ypos === d.y1,
      );
  const { doc } = exportPath("AE", G.geometry, state.lvl, state.path, side);
  assert.equal(at(doc).properties.Camera, d.fields.camera + 1);
  assert.equal(n.extra.to_cam, d.fields.camera + 1);
  revertPath("AE", "MI", 1);
  assert.equal(state.path, P);
  const { doc: back } = exportPath("AE", G.geometry, state.lvl, state.path, side);
  assert.equal(createHash("sha256").update(canonical(back)).digest("hex"), digests.AE["MI P1"]);
  // the revert was a step: one undo brings the edit back, and the trail then
  // steps it away again to the fixture
  assert.ok(undoEdit("AE", "MI", 1));
  const { doc: again } = exportPath("AE", G.geometry, state.lvl, state.path, side);
  assert.equal(at(again).properties.Camera, d.fields.camera + 1);
  assert.ok(undoEdit("AE", "MI", 1));
  assert.equal(state.path, P);
  const { doc: fixture } = exportPath("AE", G.geometry, state.lvl, state.path, side);
  assert.equal(createHash("sha256").update(canonical(fixture)).digest("hex"), digests.AE["MI P1"]);
});
