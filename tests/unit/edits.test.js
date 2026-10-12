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
  addObject,
  applyFieldEdit,
  applyRectEdit,
  applyStoredEdits,
  canRedo,
  canUndo,
  currentOf,
  duplicateObject,
  editNotes,
  editedFields,
  editedRect,
  fitRect,
  forgetAll,
  freeSpot,
  gameEdits,
  ghostOf,
  hasStoredEdits,
  isAdded,
  isEdited,
  isRemoved,
  materializePath,
  objectKeys,
  pathEdited,
  pristineOf,
  redoEdit,
  editStore,
  removeObject,
  removedObjects,
  restoreEdits,
  restoreObject,
  revertObject,
  revertPath,
  sanitizeEdits,
  undoEdit,
  setEnabled,
  setLevelShort,
  snapRect,
  takeReport,
  typeNames,
  typeTable,
  validAdded,
  validDelta,
  validRect,
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

test("a rect delta moves or resizes the object and keeps the rest of the path by identity", () => {
  restoreEdits({});
  const G = world();
  const [L0] = G.levels,
    P1 = L0.paths[0],
    d = P1.tlvs[0];
  stand(G);
  const n = applyRectEdit(d, [20, 15, 44, 39]);
  assert.deepEqual([n.x1, n.y1, n.x2, n.y2], [20, 15, 44, 39]);
  assert.deepEqual([d.x1, d.y1, d.x2, d.y2], [10, 10, 34, 34]); // the fetched object is untouched
  assert.equal(n.fields, d.fields); // nothing of the archive changed
  assert.deepEqual(n.extra, d.extra);
  assert.equal(state.path.tlvs[1], P1.tlvs[1]);
  assert.equal(state.path.tlvs[2], P1.tlvs[2]);
  assert.deepEqual(editedRect(n), [10, 10, 34, 34]);
  assert.deepEqual(editNotes(n), ["moved"]);
  assert.ok(isEdited(n));
  assert.deepEqual(editedFields(n), {});
  assert.equal(pristineOf(n), d);
  assert.equal(currentOf(d), n);
  assert.ok(pathEdited(state.path));
  assert.deepEqual(editStore().AE["MI/1"].objects["Door@10,10"], { rect: [20, 15, 44, 39] });
  // a resize keeps the corner and says so; a field edit joins the notes, names first
  const r = applyRectEdit(n, [20, 15, 60, 39]);
  assert.deepEqual(editNotes(r), ["moved", "resized"]);
  const f = applyFieldEdit(r, "camera", 18);
  assert.deepEqual(editNotes(f), ["camera", "moved", "resized"]);
  assert.equal(f.extra.to_cam, 18);
  assert.deepEqual([f.x1, f.y1, f.x2, f.y2], [20, 15, 60, 39]);
  // the shipped rect takes the delta away; the field delta stands alone
  const back = applyRectEdit(f, [10, 10, 34, 34]);
  assert.deepEqual(editNotes(back), ["camera"]);
  assert.equal(editedRect(back), null);
  assert.deepEqual(editStore().AE["MI/1"].objects["Door@10,10"], { fields: { camera: 18 } });
  assert.equal(applyFieldEdit(back, "camera", 17), d);
  assert.equal(state.path, P1);
  // the rect already standing is no step and no swap
  const again = applyRectEdit(d, [20, 15, 44, 39]);
  const before = state.path;
  assert.equal(applyRectEdit(again, [20, 15, 44, 39]), again);
  assert.equal(state.path, before);
});

test("a rect delta on an object that archives no fields leaves it without the key", () => {
  restoreEdits({});
  const G = world();
  const h = G.levels[0].paths[0].tlvs[2];
  stand(G);
  const n = applyRectEdit(h, [60, 50, 70, 60]);
  assert.equal("fields" in n, false);
  assert.deepEqual(n.extra, {});
  assert.deepEqual(editNotes(n), ["moved"]);
  assert.equal(validDelta("AE", n, "camera", 1), false);
});

test("a rect is a place on the grid by column and row, and the shipped one passes whatever it is", () => {
  const P = world().levels[0].paths[0]; // two cells across, one down: 750 by 260
  const geo = AE_GEOMETRY;
  assert.ok(validRect(P, geo, [0, 0, 24, 24]));
  assert.ok(validRect(P, geo, [700, 200, 724, 224]));
  assert.ok(validRect(P, geo, [10, 10, 10, 10])); // the data ships zero sizes
  assert.equal(validRect(P, geo, [750, 0, 774, 24]), false); // the corner a column past the edge
  assert.equal(validRect(P, geo, [740, 0, 764, 24]), false); // the midpoint past it
  assert.equal(validRect(P, geo, [700, 250, 724, 274]), false); // the midpoint a row down
  assert.equal(validRect(P, geo, [-1, 0, 24, 24]), false);
  assert.equal(validRect(P, geo, [0, -1, 24, 24]), false);
  assert.equal(validRect(P, geo, [10, 10, 5, 34]), false); // inside out
  assert.equal(validRect(P, geo, [10, 10, 34.5, 34]), false);
  assert.equal(validRect(P, geo, [10, 10, 34]), false);
  assert.equal(validRect(P, geo, [10, 10, 40000, 34]), false);
  assert.ok(validRect(P, geo, [800, 10, 824, 34], [800, 10, 824, 34])); // the way back
  // on a path of two rows a column past the edge folds into the next row's first cell, and is refused all the same
  const P2 = { id: 3, w: 2, h: 2, cams: [], tlvs: [], lines: [] };
  assert.equal(validRect(P2, geo, [750, 0, 774, 24]), false);
  assert.equal(validRect(P2, geo, [740, 0, 764, 24]), false);
  assert.ok(validRect(P2, geo, [0, 260, 24, 284]));
  assert.ok(validRect(P2, geo, [740, 260, 749, 284]));
  assert.deepEqual(fitRect(P2, geo, [750, 0, 774, 24]), [737, 0, 761, 24]);
  assert.deepEqual(fitRect(P, geo, [750, 0, 774, 24]), [737, 0, 761, 24]);
  assert.deepEqual(fitRect(P, geo, [-5, -5, 19, 19]), [0, 0, 24, 24]);
  assert.deepEqual(fitRect(P, geo, [100, 100, 124, 124]), [100, 100, 124, 124]);
  assert.deepEqual(fitRect(P, geo, [700, 250, 724, 274]), [700, 247, 724, 271]);
  assert.equal(fitRect(P, geo, [0, 0, 1500, 24]), null);
  for (const r of [
    [750, 0, 774, 24],
    [-5, -5, 19, 19],
    [700, 250, 724, 274],
  ])
    assert.ok(validRect(P, geo, fitRect(P, geo, r)));
  const G = world();
  stand(G);
  assert.throws(() => applyRectEdit(G.levels[0].paths[0].tlvs[0], [750, 0, 774, 24]), /grid/);
  assert.equal(G.levels[0], state.lvl); // nothing swapped
});

test("a run of nudges is one step, which a drag, another edit, an undo or a redo ends", () => {
  restoreEdits({});
  const G = world();
  const P1 = G.levels[0].paths[0],
    d = P1.tlvs[0];
  stand(G);
  const nudge = (t, dx) => applyRectEdit(t, [t.x1 + dx, t.y1, t.x2 + dx, t.y2], { merge: true });
  let n = nudge(d, 1);
  n = nudge(n, 1);
  n = nudge(n, 1);
  assert.equal(n.x1, 13);
  assert.ok(undoEdit("AE", "MI", 1));
  assert.equal(state.path, P1); // three nudges, one step
  assert.equal(canUndo("AE", "MI", 1), false);
  // a drag's step stands apart from the nudges after it
  n = applyRectEdit(d, [30, 10, 54, 34]);
  n = nudge(n, 1);
  nudge(n, 1);
  undoEdit("AE", "MI", 1);
  assert.equal(state.path.tlvs[0].x1, 30);
  undoEdit("AE", "MI", 1);
  assert.equal(state.path, P1);
  // a step of another kind ends a run, and undoing it does not reopen the run
  n = nudge(d, 1);
  n = nudge(n, 1);
  applyFieldEdit(n, "camera", 18);
  undoEdit("AE", "MI", 1);
  assert.equal(state.path.tlvs[0].fields.camera, 17);
  assert.equal(state.path.tlvs[0].x1, 12);
  nudge(state.path.tlvs[0], 1);
  assert.equal(canRedo("AE", "MI", 1), false);
  undoEdit("AE", "MI", 1);
  assert.equal(state.path.tlvs[0].x1, 12); // the nudge after the undo was its own step
  undoEdit("AE", "MI", 1);
  assert.equal(state.path, P1);
  // a redo ends a run too
  nudge(d, 1);
  undoEdit("AE", "MI", 1);
  redoEdit("AE", "MI", 1);
  assert.equal(state.path.tlvs[0].x1, 11);
  nudge(state.path.tlvs[0], 1);
  undoEdit("AE", "MI", 1);
  assert.equal(state.path.tlvs[0].x1, 11);
});

test("a stored rect applies where it is a place on the grid and differs from the shipped one", () => {
  restoreEdits({
    AE: {
      "MI/1": {
        objects: {
          "Door@10,10": { rect: [20, 15, 44, 39] },
          "Door@400,10": { rect: [400, 10, 424, 34], fields: { camera: 3 } }, // the rect as shipped
          "Hoist@50,50": { rect: [750, 50, 760, 60] }, // off the grid
        },
      },
    },
  });
  const G = world();
  assert.deepEqual(applyStoredEdits(G), { applied: 2, dropped: 2 });
  const P = G.levels[0].paths[0];
  assert.equal(P.tlvs[0].x1, 20);
  assert.equal(P.tlvs[1].fields.camera, 3);
  assert.equal(P.tlvs[1].x1, 400);
  assert.equal(P.tlvs[2].x1, 50);
  assert.deepEqual(editStore().AE["MI/1"].objects, {
    "Door@10,10": { rect: [20, 15, 44, 39] },
    "Door@400,10": { fields: { camera: 3 } },
  });
  restoreEdits({});
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
  const rects = {
    AE: {
      "MI/1": {
        objects: {
          "Door@10,10": { rect: [20, 15, 44, 39] },
          "Door@400,10": { fields: { camera: 3 }, rect: [1, 2, 3] },
          "Hoist@50,50": { rect: [10, 10, 5, 34] },
          "Hoist@1,1": { rect: [0, 0, 1.5, 2] },
          "Hoist@2,2": { rect: [0, 0, 40000, 2] },
          "Zone@0,0": {},
          "Zone@1,1": "junk",
        },
      },
    },
  };
  assert.deepEqual(sanitizeEdits(JSON.stringify(rects)), {
    AE: {
      "MI/1": {
        objects: {
          "Door@10,10": { rect: [20, 15, 44, 39] },
          "Door@400,10": { fields: { camera: 3 } },
        },
      },
    },
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

test("a moved object exports where it now stands, listed under the camera its midpoint falls in", () => {
  restoreEdits({});
  const G = load("map_data_ae.json"),
    side = load("relive_export_ae.json");
  setLevelShort("AE", side.level_short);
  const L = G.levels.find((l) => l.short === "MI"),
    P = L.paths.find((p) => p.id === 1);
  state.games = [G];
  state.data = G;
  state.lvl = L;
  state.path = P;
  state.sel = null;
  const d = P.tlvs.find((t) => t.name === "Door");
  const { worldW } = G.geometry;
  const rect = fitRect(P, G.geometry, [d.x1 + worldW, d.y1, d.x2 + worldW, d.y2]);
  assert.notEqual(rect[0], d.x1);
  applyRectEdit(d, rect);
  const { doc, manifest } = exportPath("AE", G.geometry, state.lvl, state.path, side);
  assert.equal(manifest.missing.size, 0);
  const holds = (c) =>
    c.map_objects.some(
      (o) =>
        o.object_structures_type === "Door" &&
        o.properties.xpos === rect[0] &&
        o.properties.ypos === rect[1] &&
        o.properties.width === d.x2 - d.x1,
    );
  const cam = doc.map.cameras.find(holds);
  assert.ok(cam, "the moved door is in the document once");
  assert.equal(doc.map.cameras.filter(holds).length, 1);
  assert.equal(cam.x, Math.floor(Math.floor((rect[0] + rect[2]) / 2) / worldW));
  assert.equal(cam.y, Math.floor(Math.floor((rect[1] + rect[3]) / 2) / G.geometry.worldH));
  assert.equal(
    doc.map.cameras.some((c) =>
      c.map_objects.some((o) => o.properties.xpos === d.x1 && o.properties.ypos === d.y1),
    ),
    false,
    "nothing stands at the shipped spot",
  );
  revertPath("AE", "MI", 1);
  assert.equal(state.path, P);
  const digests = JSON.parse(
    readFileSync(new URL("../fixtures/relive-digests.json", import.meta.url), "utf8"),
  );
  const { doc: back } = exportPath("AE", G.geometry, state.lvl, state.path, side);
  assert.equal(createHash("sha256").update(canonical(back)).digest("hex"), digests.AE["MI P1"]);
});

test("a snapped rect puts its midpoint where the engine's grid stands a sprite, by scale and camera", () => {
  const ao = { worldW: 1024, worldH: 480 };
  const full = { name: "Slig", fields: { scale: 0 } },
    half = { name: "Slig", fields: { scale: 1 } };
  assert.deepEqual(snapRect("AE", AE_GEOMETRY, full, [100, 50, 124, 74]), [100, 50, 124, 74]);
  assert.deepEqual(snapRect("AE", AE_GEOMETRY, full, [105, 50, 129, 74]), [100, 50, 124, 74]);
  assert.deepEqual(snapRect("AE", AE_GEOMETRY, full, [115, 50, 139, 74]), [125, 50, 149, 74]);
  assert.deepEqual(snapRect("AE", AE_GEOMETRY, half, [105, 50, 129, 74]), [111, 50, 135, 74]);
  assert.deepEqual(snapRect("AO", ao, full, [1324, 50, 1348, 74]), [1327, 50, 1351, 74]);
  assert.deepEqual(snapRect("AO", ao, full, [300, 50, 324, 74]), [303, 50, 327, 74]);
  assert.deepEqual(
    snapRect("AE", AE_GEOMETRY, { name: "Hoist" }, [105, 50, 129, 74]),
    [100, 50, 124, 74],
  );
});

test("one object goes back as shipped in one step, fields and rect alike", () => {
  restoreEdits({});
  const G = world();
  const P1 = G.levels[0].paths[0],
    d = P1.tlvs[0];
  stand(G);
  let n = applyFieldEdit(d, "camera", 18);
  n = applyRectEdit(n, [20, 15, 44, 39]);
  applyFieldEdit(P1.tlvs[1], "camera", 3);
  assert.deepEqual(editNotes(n), ["camera", "moved"]);
  assert.equal(revertObject(n), d);
  assert.equal(state.path.tlvs[0], d);
  assert.equal(state.path.tlvs[1].fields.camera, 3);
  assert.deepEqual(Object.keys(editStore().AE["MI/1"].objects), ["Door@400,10"]);
  assert.ok(undoEdit("AE", "MI", 1));
  assert.deepEqual(editNotes(state.path.tlvs[0]), ["camera", "moved"]);
  assert.ok(redoEdit("AE", "MI", 1));
  assert.equal(state.path.tlvs[0], d);
  const before = state.path;
  assert.equal(revertObject(d), d);
  assert.equal(state.path, before);
  assert.equal(revertObject(state.path.tlvs[1]), P1.tlvs[1]);
  assert.equal(state.path, P1);
});

test("a removed object leaves the standing path as a ghost carrying its deltas, and comes back as edited", () => {
  restoreEdits({});
  const G = world();
  const [L0] = G.levels,
    P1 = L0.paths[0],
    d = P1.tlvs[0];
  stand(G);
  const n = applyRectEdit(d, [20, 15, 44, 39]);
  state.sel = n;
  assert.equal(removeObject(n), null);
  assert.equal(state.path.tlvs.length, 2);
  assert.equal(
    state.path.tlvs.find((t) => pristineOf(t) === d),
    undefined,
  );
  assert.equal(state.path.tlvs[0], P1.tlvs[1]);
  assert.equal(state.path.tlvs[1], P1.tlvs[2]);
  const [g] = removedObjects(state.path);
  assert.equal(removedObjects(state.path).length, 1);
  assert.ok(isRemoved(g));
  assert.equal(isRemoved(d), false);
  assert.equal(pristineOf(g), d);
  assert.deepEqual([g.x1, g.y1, g.x2, g.y2], [20, 15, 44, 39]);
  assert.deepEqual(editNotes(g), ["moved"]);
  assert.equal(state.sel, g);
  assert.equal(currentOf(d), null);
  assert.equal(ghostOf(d, state.path), g);
  assert.ok(pathEdited(state.path));
  assert.deepEqual(editStore().AE["MI/1"].objects["Door@10,10"], {
    rect: [20, 15, 44, 39],
    removed: true,
  });
  assert.deepEqual(removedObjects(P1), []);
  // a ghost takes no edit but its restore, and removing it again is no step
  assert.throws(() => applyFieldEdit(g, "camera", 18), /removed/);
  assert.throws(() => applyRectEdit(g, [30, 15, 54, 39]), /removed/);
  assert.throws(() => revertObject(g), /removed/);
  const standing = state.path;
  assert.equal(removeObject(g), null);
  assert.equal(state.path, standing);
  // a handle taken before the removal is refused like the ghost, and removing it again is no step
  assert.throws(() => applyRectEdit(n, [60, 10, 84, 34]), /removed/);
  assert.throws(() => applyFieldEdit(n, "camera", 18), /removed/);
  assert.throws(() => revertObject(n), /removed/);
  assert.equal(removeObject(n), null);
  assert.equal(state.path, standing);
  assert.deepEqual(gameEdits("AE"), { objects: 1, paths: 1 });
  // another path's edit leaves this one standing as it is
  stand(G, 2);
  applyFieldEdit(state.path.tlvs[1], "camera", 19);
  assert.equal(state.lvl.paths[0], standing);
  stand(G);
  state.sel = ghostOf(d, state.path);
  // an edit on the path stands a fresh ghost, and the selection follows it
  applyFieldEdit(state.path.tlvs[0], "camera", 3);
  assert.notEqual(state.sel, g);
  assert.ok(isRemoved(state.sel));
  assert.equal(pristineOf(state.sel), d);
  // the restore stands the object back where its deltas left it
  const back = restoreObject(state.sel);
  assert.deepEqual([back.x1, back.y1], [20, 15]);
  assert.deepEqual(editNotes(back), ["moved"]);
  assert.equal(isRemoved(back), false);
  assert.equal(state.sel, back);
  assert.equal(state.path.tlvs[0], back);
  assert.deepEqual(removedObjects(state.path), []);
  assert.equal(restoreObject(back), back); // nothing to restore: no step
  // undo removes it again and the ghost is selected once more
  assert.ok(undoEdit("AE", "MI", 1));
  assert.ok(isRemoved(state.sel));
  assert.equal(state.sel, removedObjects(state.path)[0]);
  undoEdit("AE", "MI", 1); // the other door's camera
  undoEdit("AE", "MI", 1); // the removal
  assert.equal(state.path.tlvs[0].x1, 20);
  undoEdit("AE", "MI", 1); // the move
  assert.equal(state.path, P1);
  assert.equal(state.sel, d);
  // a field-less object removed and the path reverted
  removeObject(P1.tlvs[2]);
  const [h] = removedObjects(state.path);
  assert.equal("fields" in h, false);
  assert.deepEqual(editNotes(h), []);
  revertPath("AE", "MI", 1);
  assert.equal(state.path, P1);
  restoreEdits({});
});

test("a stored removal applies to an object that exists and is dropped with one that does not", () => {
  restoreEdits({
    AE: {
      "MI/1": {
        objects: {
          "Door@10,10": { removed: true, fields: { camera: 5 } },
          "Door@999,999": { removed: true },
        },
      },
    },
  });
  const G = world();
  assert.deepEqual(applyStoredEdits(G), { applied: 2, dropped: 1 });
  const P = G.levels[0].paths[0];
  assert.equal(P.tlvs.length, 2);
  const [g] = removedObjects(P);
  assert.equal(g.fields.camera, 5);
  assert.deepEqual(Object.keys(editStore().AE["MI/1"].objects), ["Door@10,10"]);
  restoreEdits({});
  const kept = {
    AE: {
      "MI/1": {
        objects: {
          "Door@10,10": { removed: true },
          "Hoist@50,50": { removed: true, rect: [60, 50, 70, 60] },
        },
      },
    },
  };
  assert.deepEqual(sanitizeEdits(JSON.stringify(kept)), kept);
  assert.deepEqual(
    sanitizeEdits(
      JSON.stringify({
        AE: {
          "MI/1": { objects: { "Door@10,10": { removed: 1 }, "Door@400,10": { removed: "yes" } } },
        },
      }),
    ),
    {},
  );
});

test("a free spot keeps the rect's screen and stands on nothing exactly", () => {
  const G = world();
  const geo = G.geometry;
  const on = (...tlvs) => ({ ...G.levels[0].paths[0], tlvs });
  const P = G.levels[0].paths[0];
  // the rect itself where nothing stands there, else to the right of what does
  assert.deepEqual(freeSpot(P, geo, [100, 100, 124, 124]), [100, 100, 124, 124]);
  assert.deepEqual(freeSpot(P, geo, [10, 10, 34, 34]), [35, 10, 59, 34]);
  assert.deepEqual(freeSpot(P, geo, [400, 10, 424, 34]), [425, 10, 449, 34]);
  // a right spot whose midpoint leaves the screen gives way to the left one, then below, then above
  assert.deepEqual(freeSpot(on(door(340, 10)), geo, [340, 10, 364, 34]), [315, 10, 339, 34]);
  assert.deepEqual(freeSpot(on(door(0, 10), door(25, 10)), geo, [0, 10, 24, 34]), [0, 35, 24, 59]);
  assert.deepEqual(
    freeSpot(on(door(340, 230), door(315, 230)), geo, [340, 230, 364, 254]),
    [340, 205, 364, 229],
  );
  // every spot beside taken: the ring one grid unit further out
  assert.deepEqual(
    freeSpot(
      on(door(100, 100), door(125, 100), door(75, 100), door(100, 125), door(100, 75)),
      geo,
      [100, 100, 124, 124],
    ),
    [150, 100, 174, 124],
  );
  // a zone no spot beside keeps on its screen lands over it, a grid unit on
  const zone = { ...plain("InvisibleZone", 10, 0), x2: 360, y2: 250 };
  assert.deepEqual(freeSpot(on(zone), geo, [10, 0, 360, 250]), [35, 0, 385, 250]);
  // one nothing shifts on its screen is the rect itself, fitted, and null past the grid
  const whole = { ...plain("InvisibleZone", 0, 0), x2: 749, y2: 519 };
  assert.deepEqual(freeSpot(on(whole), geo, [0, 0, 749, 519]), [0, 0, 749, 519]);
  assert.equal(freeSpot(P, geo, [0, 0, 1600, 10]), null);
});

test("an added object follows the shipped ones with its type's defaults, keyed past every number handed out", () => {
  restoreEdits({});
  const G = world();
  const P1 = G.levels[0].paths[0];
  stand(G);
  assert.deepEqual(typeNames(G), ["DemoSpawnPoint", "Door", "Hoist"]);
  assert.deepEqual(typeTable(G).Door.defaults, DOOR);
  assert.deepEqual(typeTable(G).Door.size, [24, 24]);
  assert.equal(typeTable(G).Hoist.fields, null);
  const n = addObject("Door", [100, 100, 124, 124]);
  assert.equal(state.path.tlvs.length, 4);
  assert.equal(state.path.tlvs[3], n);
  assert.equal(state.path.tlvs[0], P1.tlvs[0]);
  assert.deepEqual(
    { ...n, extra: undefined },
    {
      t: 5,
      name: "Door",
      x1: 100,
      y1: 100,
      x2: 124,
      y2: 124,
      fields: DOOR,
      extra: undefined,
    },
  );
  assert.equal(n.extra.to_cam, 17);
  assert.ok(isAdded(n));
  assert.ok(isEdited(n));
  assert.deepEqual(editNotes(n), ["added"]);
  assert.deepEqual(editedFields(n), {});
  assert.equal(editedRect(n), null);
  assert.equal(pristineOf(n), n);
  assert.equal(currentOf(n), n);
  assert.ok(pathEdited(state.path));
  assert.deepEqual(editStore().AE["MI/1"], {
    next: 2,
    objects: { "+1": { name: "Door", rect: [100, 100, 124, 124], fields: DOOR } },
  });
  assert.deepEqual(gameEdits("AE"), { objects: 1, paths: 1 });
  // its fields and rect edit like any object's, the entry staying whole
  const f = applyFieldEdit(n, "camera", 18);
  assert.notEqual(f, n);
  assert.equal(currentOf(n), f);
  assert.equal(f.fields.camera, 18);
  assert.equal(f.extra.to_cam, 18);
  assert.deepEqual(editedFields(f), {});
  assert.deepEqual(editNotes(f), ["added"]);
  const back = applyFieldEdit(f, "camera", 17);
  assert.equal(editStore().AE["MI/1"].objects["+1"].fields.camera, 17);
  assert.throws(() => applyFieldEdit(back, "door_type", 9), /not a value/);
  const m = applyRectEdit(back, [200, 100, 224, 124]);
  assert.deepEqual(editStore().AE["MI/1"].objects["+1"].rect, [200, 100, 224, 124]);
  assert.deepEqual(editNotes(m), ["added"]);
  assert.throws(() => applyRectEdit(m, [750, 0, 774, 24]), /grid/);
  // a second addition takes the next number, and a removal leaves no ghost and hands no number back
  const h = addObject("Hoist", [60, 60, 70, 70]);
  assert.equal("fields" in h, false);
  assert.deepEqual(h.extra, {});
  assert.equal(editStore().AE["MI/1"].next, 3);
  assert.equal(removeObject(currentOf(n)), null);
  assert.deepEqual(removedObjects(state.path), []);
  assert.deepEqual(Object.keys(editStore().AE["MI/1"].objects), ["+2"]);
  assert.equal(currentOf(n), null);
  const again = addObject("Door", [100, 100, 124, 124], { camera: 3 });
  assert.equal(editStore().AE["MI/1"].next, 4);
  assert.equal(again.fields.camera, 3);
  assert.deepEqual(Object.keys(editStore().AE["MI/1"].objects), ["+2", "+3"]);
  assert.equal(state.path.tlvs[3], currentOf(h));
  assert.equal(state.path.tlvs[4], again);
  assert.throws(() => addObject("Slig", [0, 0, 24, 24]), /not a type/);
  assert.throws(() => addObject("Door", [750, 0, 774, 24]), /grid/);
  assert.throws(() => addObject("Door", [0, 0, 24, 24], { camera: 1.5 }), /not a value/);
  // every addition and removal is a step
  undoEdit("AE", "MI", 1);
  assert.deepEqual(Object.keys(editStore().AE["MI/1"].objects), ["+2"]);
  undoEdit("AE", "MI", 1);
  assert.ok(currentOf(n));
  redoEdit("AE", "MI", 1);
  assert.equal(currentOf(n), null);
  revertPath("AE", "MI", 1);
  assert.equal(state.path, P1);
  // a number handed out this session never comes round again, though the entry went and came back
  addObject("Door", [100, 100, 124, 124]);
  assert.deepEqual(Object.keys(editStore().AE["MI/1"].objects), ["+4"]);
  assert.equal(editStore().AE["MI/1"].next, 5);
  restoreEdits({});
});

test("every stored shape applies at once, and a counter below the numbers present is raised past them", () => {
  restoreEdits({
    AE: {
      "MI/1": {
        next: 2,
        objects: {
          "Door@10,10": { fields: { camera: 5 }, rect: [20, 15, 44, 39] },
          "Door@400,10": { removed: true, fields: { camera: 7 } },
          "Hoist@50,50": { rect: [60, 50, 70, 60] },
          "+1": { name: "Door", rect: [100, 100, 124, 124] },
          "+4": { name: "Hoist", rect: [200, 100, 210, 110] },
        },
      },
    },
  });
  const G = world();
  assert.deepEqual(applyStoredEdits(G), { applied: 7, dropped: 0 });
  const P = G.levels[0].paths[0];
  assert.deepEqual(
    P.tlvs.map((t) => [t.name, t.x1]),
    [
      ["Door", 20],
      ["Hoist", 60],
      ["Door", 100],
      ["Hoist", 200],
    ],
  );
  assert.equal(P.tlvs[0].fields.camera, 5);
  assert.equal(P.tlvs[2].fields.camera, 17);
  const [g] = removedObjects(P);
  assert.equal(g.x1, 400);
  assert.equal(g.fields.camera, 7);
  assert.equal(editStore().AE["MI/1"].next, 5);
  assert.deepEqual(gameEdits("AE"), { objects: 5, paths: 1 });
  restoreEdits({});
});

test("the type table reads the pristine placements whatever stands", () => {
  restoreEdits({});
  const G = world();
  stand(G);
  const before = JSON.stringify(typeTable(G));
  removeObject(state.path.tlvs[2]);
  applyFieldEdit(state.path.tlvs[0], "camera", 3);
  applyRectEdit(state.path.tlvs[1], [500, 10, 524, 34]);
  addObject("Door", [100, 100, 124, 124], { camera: 3 });
  assert.equal(JSON.stringify(typeTable(G)), before);
  assert.deepEqual(typeNames(G), ["DemoSpawnPoint", "Door", "Hoist"]);
  const H = world();
  H.levels[0].paths[0].tlvs.splice(2, 1); // a game that never placed a Hoist
  assert.equal(typeTable(H).Hoist, undefined);
  restoreEdits({});
});

test("a stored addition applies as the game can hold it, and the counter runs past every number", () => {
  restoreEdits({
    AE: {
      "MI/1": {
        objects: {
          "+1": {
            name: "Door",
            rect: [100, 100, 124, 124],
            fields: { camera: 3, bogus: 1, door_type: 9 },
          },
          "+2": { name: "Slig", rect: [100, 100, 124, 124] },
          "+3": { name: "Door", rect: [750, 0, 774, 24] },
          "+5": { name: "Hoist", rect: [60, 60, 70, 70], fields: { camera: 1 } },
          "Door@10,10": { fields: { camera: 5 } },
        },
      },
    },
  });
  const G = world();
  assert.deepEqual(applyStoredEdits(G), { applied: 3, dropped: 2 });
  const P = G.levels[0].paths[0];
  assert.equal(P.tlvs.length, 5);
  assert.equal(P.tlvs[3].name, "Door");
  assert.deepEqual(P.tlvs[3].fields, { ...DOOR, camera: 3 });
  assert.equal(P.tlvs[4].name, "Hoist");
  assert.equal("fields" in P.tlvs[4], false);
  assert.deepEqual(editStore().AE["MI/1"], {
    next: 6,
    objects: {
      "+1": { name: "Door", rect: [100, 100, 124, 124], fields: { ...DOOR, camera: 3 } },
      "+5": { name: "Hoist", rect: [60, 60, 70, 70] },
      "Door@10,10": { fields: { camera: 5 } },
    },
  });
  assert.equal(validAdded(G, P, { name: "Nope", rect: [0, 0, 1, 1] }), null);
  restoreEdits({});
  const kept = {
    AE: {
      "MI/1": {
        next: 4,
        objects: {
          "+1": { name: "Door", rect: [1, 2, 3, 4], fields: { camera: 3 } },
          "+3": { name: "Hoist", rect: [1, 2, 3, 4] },
        },
      },
    },
  };
  assert.deepEqual(sanitizeEdits(JSON.stringify(kept)), kept);
  const noisy = {
    AE: {
      "MI/1": {
        next: "7",
        objects: {
          "+1": { name: "Door", rect: [1, 2, 3] },
          "+2": { name: "Door Two", rect: [1, 2, 3, 4] },
          "+3": { rect: [1, 2, 3, 4] },
          "+x": { name: "Door", rect: [1, 2, 3, 4] },
          "+4": { name: "Door", rect: [1, 2, 3, 4], fields: { camera: 1.5, scale: 1 } },
        },
      },
    },
  };
  assert.deepEqual(sanitizeEdits(JSON.stringify(noisy)), {
    AE: {
      "MI/1": { objects: { "+4": { name: "Door", rect: [1, 2, 3, 4], fields: { scale: 1 } } } },
    },
  });
});

for (const [g, lv, pa] of [
  ["AO", "R1", 15],
  ["AE", "MI", 1],
]) {
  test(`${g}: an added object exports with every property of its type, listed under its own camera`, () => {
    restoreEdits({});
    const G = load(`map_data_${g.toLowerCase()}.json`),
      side = load(`relive_export_${g.toLowerCase()}.json`);
    setLevelShort(g, side.level_short);
    const L = G.levels.find((l) => l.short === lv),
      P = L.paths.find((p) => p.id === pa);
    state.games = [G];
    state.data = G;
    state.lvl = L;
    state.path = P;
    state.sel = null;
    const door = addObject("Door", [400, 300, 424, 324]);
    const zone = addObject("InvisibleZone", [100, 100, 200, 150]);
    assert.equal("fields" in zone, false);
    const { doc, manifest } = exportPath(g, G.geometry, state.lvl, state.path, side);
    assert.equal(manifest.missing.size, 0);
    const find = (o) =>
      doc.map.cameras.find((c) =>
        c.map_objects.some(
          (m) =>
            m.properties.xpos === o.x1 &&
            m.properties.ypos === o.y1 &&
            m.object_structures_type === side.schema.structures[String(o.t)].name,
        ),
      );
    const dc = find(door),
      zc = find(zone);
    assert.ok(dc && zc);
    // Oddysee lists a rect by its corner, Exoddus by its midpoint
    const anchor = g === "AO" ? door.x1 : Math.floor((door.x1 + door.x2) / 2);
    assert.equal(dc.x, Math.floor(anchor / G.geometry.worldW));
    const exported = dc.map_objects.find(
      (m) => m.properties.xpos === door.x1 && m.properties.ypos === door.y1,
    );
    const props = side.schema.structures[String(door.t)].properties.map((p) => p.name);
    assert.ok(props.length > 10);
    for (const name of props) assert.ok(name in exported.properties, `${name} exported`);
    assert.deepEqual(
      Object.keys(zc.map_objects.find((m) => m.properties.xpos === zone.x1).properties),
      ["xpos", "ypos", "width", "height"],
    );
    revertPath(g, lv, pa);
    const digests = JSON.parse(
      readFileSync(new URL("../fixtures/relive-digests.json", import.meta.url), "utf8"),
    );
    const { doc: back } = exportPath(g, G.geometry, state.lvl, state.path, side);
    assert.equal(
      createHash("sha256").update(canonical(back)).digest("hex"),
      digests[g][`${lv} P${pa}`],
    );
  });
}

test("a duplicate stands beside its original as an added copy of it, fields as they stand", () => {
  restoreEdits({});
  const G = world();
  const P1 = G.levels[0].paths[0],
    d = P1.tlvs[0];
  stand(G);
  const edited = applyFieldEdit(d, "camera", 18);
  const copy = duplicateObject(edited);
  assert.ok(isAdded(copy));
  assert.equal(copy.name, "Door");
  assert.deepEqual([copy.x1, copy.y1, copy.x2, copy.y2], [35, 10, 59, 34]);
  assert.deepEqual(copy.fields, { ...DOOR, camera: 18 });
  assert.equal(copy.extra.to_cam, 18);
  assert.equal(state.path.tlvs[3], copy);
  assert.deepEqual(editStore().AE["MI/1"].objects["+1"], {
    name: "Door",
    rect: [35, 10, 59, 34],
    fields: { ...DOOR, camera: 18 },
  });
  // a wide object's copy clears its original, and a copy of a copy numbers on
  const wide = applyRectEdit(P1.tlvs[1], [400, 10, 500, 34]);
  const wideCopy = duplicateObject(wide);
  assert.deepEqual([wideCopy.x1, wideCopy.x2], [501, 601]);
  const again = duplicateObject(copy);
  assert.equal(again.x1, 60);
  assert.deepEqual(
    Object.keys(editStore().AE["MI/1"].objects).filter((k) => k[0] === "+"),
    ["+1", "+2", "+3"],
  );
  // a copy keeps its original's screen: to the left where the right spot would leave it
  const edge = applyRectEdit(currentOf(wide), [340, 10, 364, 34]);
  const beside = duplicateObject(edge);
  assert.deepEqual([beside.x1, beside.y1, beside.x2, beside.y2], [315, 10, 339, 34]);
  // a field-less copy, a ghost refused, and every copy a step
  const h = duplicateObject(P1.tlvs[2]);
  assert.equal("fields" in h, false);
  removeObject(currentOf(d));
  assert.throws(() => duplicateObject(removedObjects(state.path)[0]), /removed/);
  assert.throws(() => duplicateObject(edited), /removed/); // a handle from before the removal
  for (let i = 0; i < 9; i++) assert.ok(undoEdit("AE", "MI", 1), `step ${i}`);
  assert.equal(canUndo("AE", "MI", 1), false);
  assert.equal(state.path, P1);
  restoreEdits({});
});
