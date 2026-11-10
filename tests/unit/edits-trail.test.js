import { test } from "node:test";
import assert from "node:assert/strict";
import { state } from "../../public/js/data/state.js";
import {
  applyFieldEdit,
  applyRectEdit,
  canRedo,
  canUndo,
  editNotes,
  editStore,
  editedFields,
  forgetAll,
  pathEdited,
  pristineOf,
  redoEdit,
  restoreEdits,
  revertObject,
  revertPath,
  undoEdit,
} from "../../public/js/data/edits.js";
import { stand, world } from "./aeworld.js";

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
